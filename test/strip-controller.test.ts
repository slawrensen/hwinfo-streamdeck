/**
 * The strip runtime (src/strip/controller.ts) with fake dial handles, a
 * fake panel, a fake clock and the real registry, scheduler, scene and
 * history store: create, edit, stale bases, leave, the departed-context
 * guard, two devices with one group id, a diverging profile copy, the
 * repair of a stale panel write, Control commands, partial groups, inputs,
 * and, throughout, no settings write on appear, reconnect, tick or input.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { JsonObject, JsonValue } from "@elgato/utils";

import { deriveCapabilities, type DeviceCapabilities } from "../src/devices";
import { HistoryStore } from "../src/history/store";
import type { HistoryInterest } from "../src/history/types";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import type { PollerStatus } from "../src/poller";
import { StripController, type StripDialHandle, type StripHost } from "../src/strip/controller";
import { stripGroupKey } from "../src/strip/registry";
import { MIN_FRAME_MS, type SchedulerClock } from "../src/strip/scheduler";
import { stripGroupOf } from "../src/strip/settings";
import { ruleRuntime, type RuleRuntime, type Spec } from "./strip-rule-runtime";
import { NO_SHARED_LOOKS, setSharedLooks, staleLooksReset } from "../src/ui/shared-looks";

class FakeClock implements SchedulerClock {
	t = 1_000_000;
	private seq = 0;
	private readonly timers = new Map<number, { at: number; fn: () => void }>();
	now(): number {
		return this.t;
	}
	setTimeout(fn: () => void, ms: number): unknown {
		const id = ++this.seq;
		this.timers.set(id, { at: this.t + Math.max(0, ms), fn });
		return id;
	}
	clearTimeout(handle: unknown): void {
		this.timers.delete(handle as number);
	}
	advance(ms: number): void {
		const end = this.t + ms;
		for (;;) {
			let next: [number, { at: number; fn: () => void }] | undefined;
			for (const entry of this.timers) if (entry[1].at <= end && (next === undefined || entry[1].at < next[1].at)) next = entry;
			if (next === undefined) break;
			this.timers.delete(next[0]);
			this.t = Math.max(this.t, next[1].at);
			next[1].fn();
		}
		this.t = end;
	}
}

const PLUS: DeviceCapabilities = deriveCapabilities({ type: 7, columns: 4, rows: 2 });
const XL: DeviceCapabilities = deriveCapabilities({ type: 13, columns: 9, rows: 4 });
const MK2: DeviceCapabilities = deriveCapabilities({ type: 0, columns: 5, rows: 3 });

const PREFIX = "data:image/svg+xml,";

class FakeDial implements StripDialHandle {
	readonly feedback: string[] = [];
	readonly triggers: ({ rotate?: string; push?: string; touch?: string; longTouch?: string } | undefined)[] = [];
	readonly writes: JsonObject[] = [];
	readonly device: { readonly id: string };
	readonly coordinates: { readonly column: number; readonly row: number };
	constructor(
		readonly id: string,
		deviceId: string,
		column: number
	) {
		this.device = { id: deviceId };
		this.coordinates = { column, row: 0 };
	}
	setFeedback(feedback: { canvas: string }): Promise<void> {
		assert.ok(feedback.canvas.startsWith(PREFIX), "an SVG data URI, like independent dials send");
		this.feedback.push(decodeURIComponent(feedback.canvas.slice(PREFIX.length)));
		return Promise.resolve();
	}
	setTriggerDescription(descriptions?: { rotate?: string; push?: string; touch?: string; longTouch?: string }): Promise<void> {
		this.triggers.push(descriptions);
		return Promise.resolve();
	}
	setSettings(settings: JsonObject): Promise<void> {
		this.writes.push(structuredClone(settings));
		return Promise.resolve();
	}
	get last(): string | undefined {
		return this.feedback.at(-1);
	}
	get trigger(): { rotate?: string; push?: string; touch?: string; longTouch?: string } | undefined {
		return this.triggers.at(-1);
	}
}

const CPU = "s:1:0:7";
const GPU = "s:2:0:9";

function reading(key: string, value: number, label: string): Reading {
	return { key, type: SensorType.Temperature, sensorIndex: 0, id: 1, label, unit: "°C", value, valueMin: value, valueMax: value, valueAvg: value };
}

function snapshot(pollTime: number, cpu: number, gpu: number): SensorSnapshot {
	const readings = [reading(CPU, cpu, "CPU Package"), reading(GPU, gpu, "GPU Temperature")];
	return { pollTime, valueRevision: pollTime, version: 1, revision: 1, sensors: [{ index: 0, id: 0, instance: 0, name: "Fixture" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) };
}

type Rig = {
	readonly clock: FakeClock;
	readonly ctl: StripController;
	readonly settings: Map<string, Record<string, unknown>>;
	readonly claims: [string, boolean][];
	readonly panel: JsonValue[];
	readonly interest: Map<string, readonly HistoryInterest[]>;
	readonly history: HistoryStore;
	readonly dials: Map<string, FakeDial>;
	panelContext: string | undefined;
	status: PollerStatus;
	poll: number;
	tick(cpu: number, gpu: number): void;
	appear(dial: FakeDial, settings: Record<string, unknown>): void;
	request(context: string, payload: Record<string, unknown>): Record<string, unknown>;
	flush(): void;
	allWrites(): number;
};

function rig(options: { devices?: Record<string, DeviceCapabilities>; ids?: string[] } = {}): Rig {
	const clock = new FakeClock();
	const devices = options.devices ?? { devA: PLUS, devB: PLUS, devX: XL, devK: MK2 };
	const ids = [...(options.ids ?? ["0123456789abcdef0123456789abcdef", "fedcba9876543210fedcba9876543210", "00112233445566778899aabbccddeeff"])];
	const settings = new Map<string, Record<string, unknown>>();
	const claims: [string, boolean][] = [];
	const panel: JsonValue[] = [];
	const interest = new Map<string, readonly HistoryInterest[]>();
	const history = new HistoryStore({ now: () => clock.t });
	const dials = new Map<string, FakeDial>();
	const r: Partial<Rig> & { status: PollerStatus; poll: number; panelContext: string | undefined } = { status: { state: "ok", snapshot: snapshot(1, 50, 40), source: "shared-memory" }, poll: 1, panelContext: undefined };
	const host: StripHost = {
		settingsOf: (context) => settings.get(context),
		stored: (context, doc) => settings.set(context, doc),
		claimChanged: (context, claimed) => claims.push([context, claimed]),
		status: () => r.status,
		history: {
			setInterest: (id, entries) => {
				interest.set(id, entries);
				history.setInterest(id, entries);
			},
			dropInterest: (id) => {
				interest.delete(id);
				history.dropInterest(id);
			},
			view: (key, window, width, now, linked) => history.view(key, window, width, now, linked),
			get revision() {
				return history.revision;
			}
		},
		panelContext: () => r.panelContext,
		sendToPanel: (payload) => panel.push(payload)
	};
	const ctl = new StripController(host, { clock, capabilities: { get: (id) => devices[id] ?? deriveCapabilities({}) }, mintId: () => ids.shift() ?? "ffffffffffffffffffffffffffffffff" });
	Object.assign(r, {
		clock,
		ctl,
		settings,
		claims,
		panel,
		interest,
		history,
		dials,
		tick(this: Rig, cpu: number, gpu: number) {
			this.poll++;
			clock.advance(1000);
			const snap = snapshot(this.poll, cpu, gpu);
			history.ingest({ kind: "ok", at: clock.t, snapshot: snap, source: "shared-memory", evidence: true, stampAdvanced: true, evidenceAgeMs: 0 });
			this.status = { state: "ok", snapshot: snap, source: "shared-memory" };
			ctl.onTick(this.status);
		},
		appear(dial: FakeDial, doc: Record<string, unknown>) {
			dials.set(dial.id, dial);
			settings.set(dial.id, doc);
			ctl.appear(dial, doc);
		},
		request(context: string, payload: Record<string, unknown>) {
			const before = panel.length;
			ctl.handlePi(context, payload);
			const replies = panel.slice(before).filter((p) => typeof p === "object" && p !== null && !Array.isArray(p) && (p.event === "stripEditResult" || p.event === "stripState")) as Record<string, unknown>[];
			const answer = replies.find((p) => p.event === (payload.event === "stripGet" ? "stripState" : "stripEditResult"));
			assert.ok(answer !== undefined, `the plugin answered ${String(payload.event)}`);
			return answer;
		},
		flush() {
			clock.advance(MIN_FRAME_MS * 3);
		},
		allWrites() {
			return [...dials.values()].reduce((n, d) => n + d.writes.length, 0);
		}
	});
	return r as Rig;
}

/** An independent Sensor Dial's own settings (never touched by the strip). */
function individual(column: number): Record<string, unknown> {
	return { readingKey: column % 2 === 0 ? CPU : GPU, label: `Dial ${column}`, dialBackground: "glass", rotationKeys: [CPU, GPU], warnValue: "80", linkId: column === 0 ? "deck" : undefined };
}

/** Four Sensor Dials on a Stream Deck +, independent. */
function plusRow(t: Rig, device = "devA", prefix = "a"): FakeDial[] {
	const out: FakeDial[] = [];
	for (let c = 0; c < 4; c++) {
		const dial = new FakeDial(`${prefix}${c}`, device, c);
		const doc = individual(c);
		if (doc.linkId === undefined) delete doc.linkId;
		t.appear(dial, doc);
		out.push(dial);
	}
	return out;
}

/** Every member's newest slice, left to right: one frame's text. */
function frameOf(dials: readonly FakeDial[]): string {
	return dials.map((d) => d.last ?? "").join("\n");
}

function withoutStrip(doc: Record<string, unknown> | JsonObject | undefined): Record<string, unknown> {
	const { stripGroup: _drop, ...rest } = doc ?? {};
	void _drop;
	return rest;
}

function created(t: Rig, from: FakeDial, layout: "whole" | "split", extra: Record<string, unknown> = {}): Record<string, unknown> {
	const answer = t.request(from.id, { event: "stripCreate", opId: "c1", layout, ...extra });
	assert.equal(answer.ok, true, JSON.stringify(answer));
	t.flush();
	return answer;
}

describe("strip runtime: independent dials", () => {
	it("appear, settings, ticks and Control commands never reach an independent dial", () => {
		const t = rig();
		const dials = plusRow(t);
		t.tick(51, 41);
		t.tick(52, 42);
		t.ctl.settingsChanged("a1", { ...individual(1), label: "edited" });
		t.ctl.restyle();
		t.flush();
		assert.equal(t.ctl.applyControl({ command: "stripInspect", target: "", scope: "current" }), 0, "no strip, nothing reached");
		for (const d of dials) {
			assert.deepEqual(d.feedback, [], `${d.id}: no strip frame`);
			assert.deepEqual(d.triggers, [], `${d.id}: no strip hint`);
			assert.deepEqual(d.writes, [], `${d.id}: no write`);
			assert.equal(t.ctl.claims(d.id), false);
		}
		assert.deepEqual(t.claims, []);
		assert.equal(t.interest.size, 0, "no history interest");
	});
});

describe("strip runtime: create, edit and the single writer", () => {
	it("create writes one complete document per dial, keeps every individual field, and paints one slice each", () => {
		const t = rig();
		const dials = plusRow(t);
		const before = dials.map((d) => structuredClone(t.settings.get(d.id)));
		const answer = created(t, dials[0] as FakeDial, "whole");
		assert.equal(answer.rev, 1);
		for (const [i, d] of dials.entries()) {
			assert.equal(d.writes.length, 1, `${d.id}: one write`);
			const doc = d.writes[0] as JsonObject;
			assert.deepEqual(withoutStrip(doc), withoutStrip(before[i]), `${d.id}: individual fields byte for byte`);
			const copy = stripGroupOf(doc.stripGroup);
			assert.ok(copy !== undefined && copy.joined && copy.rev === 1 && copy.id === answer.groupId);
			assert.equal(copy.config.encoders, 4);
			assert.equal(copy.config.window, "5m", "the default window");
			assert.equal(t.ctl.claims(d.id), true);
			assert.equal(d.feedback.length, 1, `${d.id}: one frame`);
			assert.match(d.last ?? "", /^<svg[^>]*viewBox="0 0 200 100"/, "slice-local coordinates");
			// A Trend of one reading takes the scale dial.
			assert.deepEqual(d.trigger, { rotate: "Time window · pressed: scale", push: "Inspect", touch: "Inspect here", longTouch: "Auto scale" });
		}
		assert.deepEqual(
			t.claims,
			dials.map((d) => [d.id, true])
		);
		assert.match(dials[0]?.last ?? "", />CPU Package</, "the pane's title starts in the leftmost slice");
		assert.match(frameOf(dials), />LIVE</, "the live badge is in the frame");
		// The seed comes from the creating dial: its link and its reading,
		// never its Background (a new strip follows the shared one).
		const copy = stripGroupOf(t.settings.get("a0")?.stripGroup);
		assert.equal(copy?.config.background, undefined);
		assert.equal(copy?.config.linkId, "deck");
		assert.deepEqual(
			copy?.config.panes[0].series.map((s) => s.key),
			[CPU]
		);
	});

	it("a stale base is refused and writes nothing; a current base writes rev+1 to every visible member at once", () => {
		const t = rig();
		const dials = plusRow(t);
		const made = created(t, dials[0] as FakeDial, "whole");
		const id = made.groupId as string;
		const ok = t.request("a2", { event: "stripEdit", opId: "e1", groupId: id, baseRev: 1, patch: [{ op: "set", path: "panes.0.style", value: "area" }] });
		assert.equal(ok.ok, true, JSON.stringify(ok));
		assert.equal(ok.rev, 2);
		for (const d of dials) {
			assert.equal(d.writes.length, 2, `${d.id}: create + edit`);
			assert.equal(stripGroupOf(d.writes[1]?.stripGroup)?.rev, 2);
		}
		const writes = t.allWrites();
		const stale = t.request("a1", { event: "stripEdit", opId: "e2", groupId: id, baseRev: 1, patch: [{ op: "set", path: "panes.0.style", value: "heat" }] });
		assert.equal(stale.ok, false);
		assert.equal(stale.reason, "stale");
		assert.equal(stale.rev, 2, "the answer carries the current revision");
		assert.equal((stale.config as JsonObject).panes instanceof Array, true);
		assert.equal(t.allWrites(), writes, "a refused edit writes nothing");
	});

	it("one bad operation refuses the whole patch", () => {
		const t = rig();
		const dials = plusRow(t);
		const made = created(t, dials[0] as FakeDial, "whole");
		const writes = t.allWrites();
		const answer = t.request("a0", { event: "stripEdit", opId: "e1", groupId: made.groupId, baseRev: 1, patch: [{ op: "set", path: "panes.0.style", value: "area" }, { op: "set", path: "panes.0.nonsense", value: 1 }] });
		assert.equal(answer.ok, false);
		assert.equal(answer.reason, "invalid");
		assert.equal(t.allWrites(), writes);
		assert.equal(stripGroupOf(t.settings.get("a3")?.stripGroup)?.config.panes[0].style, "trend", "nothing half-applied");
	});

	it("create refuses a missing dial or one in another strip, and writes nothing", () => {
		const t = rig();
		const dials = plusRow(t).slice(0, 3);
		t.ctl.disappear("a3", 3);
		const missing = t.request("a0", { event: "stripCreate", opId: "c1", layout: "whole" });
		assert.equal(missing.ok, false);
		assert.equal(missing.reason, "incomplete");
		assert.equal(missing.detail, "No Sensor Dial at dial 4");
		const two = t.request("a0", { event: "stripCreate", opId: "c2", layout: "whole", columns: [0, 1] });
		assert.equal(two.ok, true);
		const taken = t.request("a2", { event: "stripCreate", opId: "c3", layout: "whole", columns: [1, 2] });
		assert.equal(taken.ok, false);
		assert.equal(taken.reason, "conflict");
		assert.equal(taken.detail, "Dial 2 is in another strip");
		assert.equal(dials[2]?.writes.length, 0);
	});

	it("a refusal that names more than one dial agrees in number", () => {
		const t = rig();
		const dials = plusRow(t);
		const made = created(t, dials[0] as FakeDial, "whole");
		// Dial 2 leaves; a new strip from its panel over every dial meets
		// the three still in the strip it left.
		assert.equal(t.request("a1", { event: "stripLeave", opId: "l1", groupId: made.groupId }).ok, true);
		const taken = t.request("a1", { event: "stripCreate", opId: "c2", layout: "whole" });
		assert.deepEqual([taken.ok, taken.reason, taken.detail], [false, "conflict", "Dials 1, 3 and 4 are in another strip"]);
		const two = rig();
		plusRow(two);
		two.ctl.disappear("a2", 2);
		two.ctl.disappear("a3", 3);
		const missing = two.request("a0", { event: "stripCreate", opId: "c1", layout: "whole" });
		assert.deepEqual([missing.ok, missing.reason, missing.detail], [false, "incomplete", "No Sensor Dial at dials 3 and 4"]);
	});

	it("appearing, replays, ticks, input, restyle, a page swap and a reconnect never write", () => {
		const t = rig();
		const dials = plusRow(t);
		created(t, dials[0] as FakeDial, "split");
		const writes = t.allWrites();
		for (const d of dials) t.ctl.appear(d, t.settings.get(d.id));
		t.tick(60, 45);
		t.ctl.input("a0", { kind: "dialRotate", column: 0, at: 1, ticks: 1, pressed: false });
		t.ctl.input("a3", { kind: "touchTap", column: 3, at: 2, hold: false, tapPos: [100, 50] });
		t.ctl.restyle();
		t.flush();
		for (const d of dials) t.ctl.disappear(d.id, d.coordinates.column);
		for (const d of dials) t.ctl.appear(d, t.settings.get(d.id));
		t.ctl.deviceGone("devA");
		for (const d of dials) t.ctl.appear(d, t.settings.get(d.id));
		t.tick(61, 46);
		t.flush();
		assert.equal(t.allWrites(), writes);
	});
});

describe("strip runtime: leaving", () => {
	it("a single dial may leave: its document keeps every individual field, the rest show the gap", () => {
		const t = rig();
		const dials = plusRow(t);
		const before = structuredClone(t.settings.get("a2"));
		const made = created(t, dials[0] as FakeDial, "whole");
		t.request("a0", { event: "stripEdit", opId: "e1", groupId: made.groupId, baseRev: 1, patch: [{ op: "set", path: "panes.0.style", value: "area" }] });
		t.flush();
		const framesBefore = (dials[2] as FakeDial).feedback.length;
		const left = t.request("a2", { event: "stripLeave", opId: "l1", groupId: made.groupId });
		assert.equal(left.ok, true, JSON.stringify(left));
		t.flush();
		const doc = (dials[2] as FakeDial).writes.at(-1) as JsonObject;
		assert.deepEqual(withoutStrip(doc), withoutStrip(before), "individual fields byte for byte");
		const copy = stripGroupOf(doc.stripGroup);
		assert.equal(copy?.joined, false, "a dormant copy, kept for Restore");
		assert.equal(copy?.rev, 2);
		assert.deepEqual(t.claims.at(-1), ["a2", false]);
		assert.equal(t.ctl.claims("a2"), false);
		assert.equal((dials[2] as FakeDial).feedback.length, framesBefore, "the strip paints nothing on a dial that left");
		assert.match(frameOf([dials[0], dials[1], dials[3]] as FakeDial[]), /Dial 3 left the strip/, "the gap is named for what it is");
		assert.doesNotMatch(frameOf([dials[0], dials[1], dials[3]] as FakeDial[]), /missing/, "a dial on screen is not missing");
		// Only the leaving dial was written.
		assert.equal((dials[0] as FakeDial).writes.length, 2);
		// Restore puts it back at the group's revision.
		const back = t.request("a2", { event: "stripRestore", opId: "r1", groupId: made.groupId });
		assert.equal(back.ok, true, JSON.stringify(back));
		t.flush();
		assert.equal(t.ctl.claims("a2"), true);
		assert.equal(stripGroupOf((dials[2] as FakeDial).writes.at(-1)?.stripGroup)?.joined, true);
		assert.doesNotMatch((dials[0] as FakeDial).last ?? "", /missing|left the strip/);
	});

	it("leaving every dial disposes the group and drops its history interest", () => {
		const t = rig();
		const dials = plusRow(t);
		const made = created(t, dials[0] as FakeDial, "split");
		const key = stripGroupKey("devA", made.groupId as string);
		assert.ok(t.interest.has(`strip:${key}:0`));
		const all = t.request("a0", { event: "stripLeave", opId: "l1", groupId: made.groupId, columns: "all" });
		assert.equal(all.ok, true);
		for (const d of dials) assert.equal(t.ctl.claims(d.id), false);
		assert.equal([...t.interest.keys()].filter((k) => k.startsWith("strip:")).length, 0);
	});
});

describe("strip runtime: frames", () => {
	it("history interest per series in all three windows under strip:<group>:<pane>", () => {
		const t = rig();
		const dials = plusRow(t);
		const made = created(t, dials[0] as FakeDial, "split", { patch: [{ op: "set", path: "panes.1.series", value: [{ key: GPU }] }] });
		const key = stripGroupKey("devA", made.groupId as string);
		assert.deepEqual(t.interest.get(`strip:${key}:0`), [{ savedKey: CPU, window: ["1m", "5m", "15m"] }]);
		assert.deepEqual(t.interest.get(`strip:${key}:1`), [{ savedKey: GPU, window: ["1m", "5m", "15m"] }]);
		for (const d of dials) t.ctl.disappear(d.id, d.coordinates.column);
		assert.equal(t.interest.size, 0, "dropped when the group has no visible member");
	});

	it("a departed or re-placed context never gets a late frame", () => {
		const t = rig();
		const dials = plusRow(t);
		created(t, dials[0] as FakeDial, "whole");
		t.tick(70, 50);
		// The frame is pending; one dial leaves the page before it is built.
		const a1 = dials[1] as FakeDial;
		const a1Frames = a1.feedback.length;
		t.ctl.disappear("a1", 1);
		t.flush();
		assert.equal(a1.feedback.length, a1Frames, "no frame after disappear");
		// Another context takes column 2 before the old one's disappear.
		const a2 = dials[2] as FakeDial;
		const replacement = new FakeDial("z2", "devA", 2);
		t.appear(replacement, individual(2));
		t.tick(71, 51);
		const a2Frames = a2.feedback.length;
		t.ctl.disappear("a2", 2);
		t.flush();
		assert.equal(a2.feedback.length, a2Frames);
		assert.equal(replacement.feedback.length, 0, "an independent dial on that column gets no strip frame");
	});

	it("identical frames are not resent; a replayed appear resends that dial's slice", () => {
		const t = rig();
		const dials = plusRow(t);
		created(t, dials[0] as FakeDial, "whole");
		const counts = dials.map((d) => d.feedback.length);
		t.ctl.restyle();
		t.flush();
		assert.deepEqual(
			dials.map((d) => d.feedback.length),
			counts,
			"same look, same bytes"
		);
		t.ctl.appear(dials[1] as FakeDial, t.settings.get("a1"));
		t.flush();
		assert.equal((dials[1] as FakeDial).feedback.length, (counts[1] ?? 0) + 1, "a cold app cache gets its frame again");
		assert.equal((dials[0] as FakeDial).feedback.length, counts[0]);
	});

	it("a member that disappears leaves the incomplete face; its return resyncs every slice", () => {
		const t = rig();
		const dials = plusRow(t);
		created(t, dials[0] as FakeDial, "whole");
		const full = dials.map((d) => d.last);
		t.ctl.disappear("a2", 2);
		t.flush();
		assert.match(frameOf([dials[0], dials[1], dials[3]] as FakeDial[]), /Dial 3 missing/);
		t.ctl.appear(dials[2] as FakeDial, t.settings.get("a2"));
		t.flush();
		assert.deepEqual(
			dials.map((d) => d.last),
			full,
			"the same frame as before the gap"
		);
	});

	it("inspect freezes a copy: new data repaints nothing while history keeps collecting", () => {
		const t = rig();
		const dials = plusRow(t);
		created(t, dials[0] as FakeDial, "whole");
		t.tick(60, 45);
		t.tick(62, 46);
		t.flush();
		t.ctl.input("a1", { kind: "dialDown", column: 1, at: 10 });
		t.ctl.input("a1", { kind: "dialUp", column: 1, at: 60 });
		t.flush();
		assert.match(frameOf(dials), /PAUSED/);
		assert.deepEqual((dials[1] as FakeDial).trigger, { rotate: "Move cursor · pressed: scale", push: "Back to live", touch: "Move cursor here", longTouch: "Back to live" });
		const counts = dials.map((d) => d.feedback.length);
		const revision = t.history.revision;
		t.tick(90, 80);
		t.tick(95, 85);
		t.flush();
		assert.ok(t.history.revision > revision, "history keeps collecting");
		assert.deepEqual(
			dials.map((d) => d.feedback.length),
			counts,
			"the paused frame is unchanged"
		);
		t.ctl.input("a2", { kind: "touchTap", column: 2, at: 100, hold: true, tapPos: [10, 10] });
		t.flush();
		assert.match(frameOf(dials), />LIVE</);
		assert.doesNotMatch(frameOf(dials), /PAUSED/);
	});

	it("a group set up for another deck draws an explanation, never a stretched graph", () => {
		const t = rig();
		const xl = Array.from({ length: 6 }, (_, c) => {
			const d = new FakeDial(`x${c}`, "devX", c);
			t.appear(d, individual(c));
			return d;
		});
		created(t, xl[0] as FakeDial, "whole");
		const copy = t.settings.get("x0")?.stripGroup;
		// The same profile on a Stream Deck + (a smaller strip).
		const plus = Array.from({ length: 4 }, (_, c) => {
			const d = new FakeDial(`p${c}`, "devA", c);
			t.appear(d, { ...individual(c), stripGroup: copy });
			return d;
		});
		t.flush();
		for (const d of plus) {
			assert.match(d.last ?? "", /Strip set up for/);
			assert.match(d.last ?? "", /Stream Deck \+ XL \(6 dials\)/);
			assert.deepEqual(d.trigger, { rotate: "No action", push: "No action", touch: "No action", longTouch: "No action" });
		}
		assert.equal(
			plus.reduce((n, d) => n + d.writes.length, 0),
			0
		);
	});
});

describe("strip runtime: copies and devices", () => {
	it("two devices with the same group id are two groups: input and edits never cross", () => {
		const t = rig();
		const a = plusRow(t, "devA", "a");
		const made = created(t, a[0] as FakeDial, "whole");
		const copy = t.settings.get("a0")?.stripGroup;
		const b = Array.from({ length: 4 }, (_, c) => {
			const d = new FakeDial(`b${c}`, "devB", c);
			t.appear(d, { ...individual(c), stripGroup: copy });
			return d;
		});
		t.flush();
		assert.ok(b.every((d) => t.ctl.claims(d.id)));
		t.ctl.input("a0", { kind: "dialDown", column: 0, at: 1 });
		t.ctl.input("a0", { kind: "dialUp", column: 0, at: 40 });
		t.flush();
		assert.match(frameOf(a), /PAUSED/);
		assert.match(frameOf(b), />LIVE</, "the other deck stays live");
		assert.doesNotMatch(frameOf(b), /PAUSED/);
		const edit = t.request("a1", { event: "stripEdit", opId: "e1", groupId: made.groupId, baseRev: 1, patch: [{ op: "set", path: "panes.0.style", value: "area" }] });
		assert.equal(edit.ok, true);
		assert.ok(b.every((d) => d.writes.length === 0), "the other deck's dials are not written");
		assert.equal(stripGroupOf(t.settings.get("b0")?.stripGroup)?.rev, 1);
	});

	it("a profile copy on the same deck diverges: edits reach only the visible copy, and its pause stays with it", () => {
		const t = rig();
		const a = plusRow(t, "devA", "a");
		const made = created(t, a[0] as FakeDial, "whole");
		const copy = t.settings.get("a0")?.stripGroup;
		// Page swap to a copied profile page: the same group id and revision.
		for (const d of a) t.ctl.disappear(d.id, d.coordinates.column);
		const b = Array.from({ length: 4 }, (_, c) => {
			const d = new FakeDial(`b${c}`, "devA", c);
			t.appear(d, { ...individual(c), stripGroup: copy });
			return d;
		});
		t.flush();
		const edit = t.request("b0", { event: "stripEdit", opId: "e1", groupId: made.groupId, baseRev: 1, patch: [{ op: "set", path: "panes.0.style", value: "heat" }] });
		assert.equal(edit.ok, true);
		t.ctl.input("b2", { kind: "dialDown", column: 2, at: 1 });
		t.ctl.input("b2", { kind: "dialUp", column: 2, at: 30 });
		t.flush();
		assert.match(frameOf(b), /PAUSED/);
		// Back to the first page.
		for (const d of b) t.ctl.disappear(d.id, d.coordinates.column);
		for (const d of a) t.ctl.appear(d, t.settings.get(d.id));
		t.flush();
		assert.equal(stripGroupOf(t.settings.get("a0")?.stripGroup)?.rev, 1, "the first page's copy was never written");
		const state = t.request("a1", { event: "stripGet" });
		assert.equal((state.group as JsonObject).rev, 1);
		assert.equal(((state.group as JsonObject).config as JsonObject).panes instanceof Array, true);
		assert.doesNotMatch(frameOf(a), /PAUSED/, "the copy's pause is not inherited");
	});

	it("a returning page restores its own paused view", () => {
		const t = rig();
		const a = plusRow(t);
		created(t, a[0] as FakeDial, "whole");
		t.ctl.input("a2", { kind: "dialDown", column: 2, at: 1 });
		t.ctl.input("a2", { kind: "dialUp", column: 2, at: 30 });
		t.flush();
		for (const d of a) t.ctl.disappear(d.id, d.coordinates.column);
		t.clock.advance(60_000);
		for (const d of a) t.ctl.appear(d, t.settings.get(d.id));
		t.flush();
		assert.match(frameOf(a), /PAUSED/);
	});

	it("deviceGone drops the deck's members: no frame, no interest", () => {
		const t = rig();
		const a = plusRow(t);
		created(t, a[0] as FakeDial, "whole");
		const counts = a.map((d) => d.feedback.length);
		t.ctl.deviceGone("devA");
		t.tick(80, 60);
		t.flush();
		assert.deepEqual(
			a.map((d) => d.feedback.length),
			counts
		);
		assert.equal(t.interest.size, 0);
		assert.equal(t.ctl.claims("a0"), false);
	});

	it("a stale whole-document panel write is repaired in reply; a stale copy on appear is never written", () => {
		const t = rig();
		const a = plusRow(t);
		const made = created(t, a[0] as FakeDial, "whole");
		const oldDoc = structuredClone(t.settings.get("a1") as Record<string, unknown>);
		t.request("a0", { event: "stripEdit", opId: "e1", groupId: made.groupId, baseRev: 1, patch: [{ op: "set", path: "panes.0.style", value: "area" }] });
		const writes = (a[1] as FakeDial).writes.length;
		// The open panel on a1 had the old document and saves an edit of the label.
		const cls = t.ctl.settingsChanged("a1", { ...oldDoc, label: "Renamed" });
		assert.equal(cls, "stale");
		const repaired = (a[1] as FakeDial).writes.at(-1) as JsonObject;
		assert.equal((a[1] as FakeDial).writes.length, writes + 1, "one repair write");
		assert.equal(repaired.label, "Renamed", "the user's edit is kept");
		assert.equal(stripGroupOf(repaired.stripGroup)?.rev, 2, "the group's copy is put back");
		// An echo of that repair changes nothing.
		assert.equal(t.ctl.settingsChanged("a1", repaired), "unrelated");
		assert.equal((a[1] as FakeDial).writes.length, writes + 1);
		// A page swap brings a3 back holding an older copy: no write.
		t.ctl.disappear("a3", 3);
		const all = t.allWrites();
		t.appear(a[3] as FakeDial, oldDoc);
		t.flush();
		assert.equal(t.allWrites(), all);
	});

	it("a pasted differing copy is a conflict, never adopted, until the user chooses", () => {
		const t = rig();
		const a = plusRow(t);
		const made = created(t, a[0] as FakeDial, "whole");
		const pasted = structuredClone(t.settings.get("a1") as Record<string, unknown>);
		const group = pasted.stripGroup as Record<string, unknown>;
		pasted.stripGroup = { ...group, rev: 9, config: { ...(group.config as Record<string, unknown>), window: "15m" } };
		const prior = structuredClone(t.settings.get("a1")?.stripGroup);
		const writes = t.allWrites();
		assert.equal(t.ctl.settingsChanged("a1", pasted), "foreign");
		// The one reply write: the dial's own copy back, the pasted one apart.
		assert.equal(t.allWrites(), writes + 1);
		const moved = (a[1] as FakeDial).writes.at(-1) as JsonObject;
		assert.deepEqual(moved.stripGroup, prior, "the dial keeps its accepted copy");
		assert.deepEqual(moved.stripGroupPasted, pasted.stripGroup, "the pasted copy is kept apart, as pasted");
		const { stripGroupPasted: _p, ...rest } = moved;
		void _p;
		assert.deepEqual(withoutStrip(rest), withoutStrip(pasted), "every other field as the panel wrote it");
		const state = t.request("a1", { event: "stripGet" });
		assert.deepEqual((state.self as JsonObject).foreign, { groupId: made.groupId, rev: 9 });
		assert.equal(((state.group as JsonObject).conflict as JsonObject).kind, "foreign");
		const keep = t.request("a1", { event: "stripResolve", opId: "r1", use: "thisDial" });
		assert.equal(keep.ok, true, JSON.stringify(keep));
		assert.equal(keep.rev, 10);
		for (const d of a) assert.equal(stripGroupOf(t.settings.get(d.id)?.stripGroup)?.config.window, "15m", d.id);
		assert.equal("stripGroupPasted" in (t.settings.get("a1") ?? {}), false, "the choice clears the pasted copy");
	});

	it("a pasted copy is still a question after a restart: never the authority, never a membership, nothing written on appear", () => {
		const t = rig();
		const a = plusRow(t);
		const made = created(t, a[0] as FakeDial, "whole");
		const group = t.settings.get("a1")?.stripGroup as Record<string, unknown>;
		const pasted = { ...(t.settings.get("a1") as Record<string, unknown>), stripGroup: { ...group, rev: 9, config: { ...(group.config as Record<string, unknown>), window: "15m", background: "clear" } } };
		assert.equal(t.ctl.settingsChanged("a1", pasted), "foreign");
		// The panel's store sends the pasted document again before the
		// plugin's reply reaches it: the app stores it and tells the plugin,
		// which keeps it apart again.
		t.settings.set("a1", structuredClone(pasted));
		assert.equal(t.ctl.settingsChanged("a1", structuredClone(pasted)), "foreign");
		assert.deepEqual(t.settings.get("a1")?.stripGroupPasted, pasted.stripGroup);
		assert.equal(stripGroupOf(t.settings.get("a1")?.stripGroup)?.rev, 1);
		// A joined copy pasted onto an independent dial of another deck.
		const solo = new FakeDial("b0", "devB", 0);
		t.appear(solo, individual(0));
		const soloPasted = { ...individual(0), stripGroup: { ...group } };
		assert.equal(t.ctl.settingsChanged("b0", soloPasted), "foreign");
		assert.equal(t.ctl.claims("b0"), false);
		assert.equal("stripGroup" in (t.settings.get("b0") ?? {}), false, "the independent dial stays without a strip copy");
		// Restart: a fresh plugin appears the stored documents.
		const t2 = rig();
		for (const d of [...a, solo]) t2.appear(new FakeDial(d.id, d.device.id, d.coordinates.column), structuredClone(t.settings.get(d.id) as Record<string, unknown>));
		t2.flush();
		const after = t2.request("a0", { event: "stripGet" }).group as JsonObject;
		assert.deepEqual(after.conflict, { kind: "foreign", columns: [1] }, "still a question");
		assert.equal(after.rev, 1, "the pasted revision is not the authority");
		assert.equal((after.config as JsonObject).window, "5m");
		assert.equal((after.config as JsonObject).background, undefined, "a new strip follows the shared Background");
		assert.equal(t2.ctl.claims("b0"), false, "the independent dial does not join on start");
		assert.deepEqual((t2.request("b0", { event: "stripGet" }).self as JsonObject).foreign, { groupId: made.groupId, rev: 1 });
		assert.equal(t2.allWrites(), 0, "appearing writes nothing");
		// A whole document from an older panel view that drops the pasted
		// copy gets it back; keeping the strip's setup ends the question.
		const older = structuredClone(t.settings.get("a1") as Record<string, unknown>);
		delete older.stripGroupPasted;
		t2.settings.set("a1", older);
		t2.ctl.settingsChanged("a1", older);
		assert.deepEqual((t2.dials.get("a1")?.writes.at(-1) as JsonObject).stripGroupPasted, pasted.stripGroup);
		const keep = t2.request("a1", { event: "stripResolve", opId: "r1", use: "group" });
		assert.equal(keep.ok, true, JSON.stringify(keep));
		assert.equal("stripGroupPasted" in (t2.settings.get("a1") ?? {}), false);
		assert.equal((t2.request("a0", { event: "stripGet" }).group as JsonObject).conflict, null);
		assert.equal(stripGroupOf(t2.settings.get("a1")?.stripGroup)?.rev, 1);
	});
});

describe("strip runtime: input and Control commands", () => {
	it("rotation changes the window for this session only", () => {
		const t = rig();
		const a = plusRow(t);
		created(t, a[0] as FakeDial, "whole");
		const writes = t.allWrites();
		t.ctl.input("a3", { kind: "dialRotate", column: 3, at: 1, ticks: 1, pressed: false });
		t.flush();
		const state = t.request("a0", { event: "stripGet" });
		assert.deepEqual((state.group as JsonObject).panes, [{ mode: "live", window: "15m" }]);
		assert.equal(stripGroupOf(t.settings.get("a0")?.stripGroup)?.config.window, "5m", "the saved default is unchanged");
		assert.equal(t.allWrites(), writes);
	});

	it("taps route by group x: each half owns its taps, a seam tap lands once", () => {
		const t = rig();
		const a = plusRow(t);
		created(t, a[0] as FakeDial, "split", { patch: [{ op: "set", path: "panes.1.series", value: [{ key: GPU }] }] });
		// Column 1's right edge is still the left half.
		t.ctl.input("a1", { kind: "touchTap", column: 1, at: 1, hold: false, tapPos: [199, 50] });
		t.flush();
		assert.equal((a[0] as FakeDial).trigger?.push, "Back to live", "left half paused");
		assert.equal((a[2] as FakeDial).trigger?.push, "Inspect", "right half live");
		// Column 2's left edge is the right half.
		t.ctl.input("a2", { kind: "touchTap", column: 2, at: 2, hold: false, tapPos: [0, 50] });
		t.flush();
		assert.equal((a[3] as FakeDial).trigger?.push, "Back to live");
		// A tap whose column is not the one the dial appeared at is dropped.
		t.ctl.input("a3", { kind: "touchTap", column: 1, at: 3, hold: true, tapPos: [0, 50] });
		t.flush();
		assert.equal((a[3] as FakeDial).trigger?.push, "Back to live");
	});

	it("a membership change during a held press consumes it", () => {
		const t = rig();
		const a = plusRow(t);
		created(t, a[0] as FakeDial, "whole");
		t.ctl.input("a0", { kind: "dialDown", column: 0, at: 1 });
		t.ctl.disappear("a3", 3);
		t.ctl.input("a0", { kind: "dialUp", column: 0, at: 50 });
		t.flush();
		assert.equal((a[0] as FakeDial).trigger?.push, "Inspect", "still live");
	});

	it("strip commands reach groups by Link ID, in both halves, and count groups", () => {
		const t = rig();
		const a = plusRow(t);
		created(t, a[0] as FakeDial, "split");
		const x = Array.from({ length: 6 }, (_, c) => {
			const d = new FakeDial(`x${c}`, "devX", c);
			t.appear(d, individual(c + 1));
			return d;
		});
		created(t, x[0] as FakeDial, "whole");
		assert.equal(t.ctl.applyControl({ command: "stripInspect", target: "deck", scope: "current" }), 1, "only the group with Link ID deck");
		t.flush();
		assert.equal((a[0] as FakeDial).trigger?.push, "Back to live");
		assert.equal((a[3] as FakeDial).trigger?.push, "Back to live", "both halves");
		assert.equal((x[0] as FakeDial).trigger?.push, "Inspect");
		assert.equal(t.ctl.applyControl({ command: "stripLive", target: "nothing", scope: "current" }), 0);
		assert.equal(t.ctl.applyControl({ command: "stripToggleInspect", target: "", scope: "current" }), 2);
		t.flush();
		assert.equal((x[0] as FakeDial).trigger?.push, "Back to live", "the + XL group was live, so it pauses");
		assert.equal((a[0] as FakeDial).trigger?.push, "Inspect", "every half of the + group was paused, so it goes live");
		assert.equal((a[3] as FakeDial).trigger?.push, "Inspect");
		// One half paused: the toggle pauses the other, it does not resume.
		t.ctl.input("a3", { kind: "dialDown", column: 3, at: 1 });
		t.ctl.input("a3", { kind: "dialUp", column: 3, at: 40 });
		t.flush();
		assert.equal((a[3] as FakeDial).trigger?.push, "Back to live");
		assert.equal(t.ctl.applyControl({ command: "stripToggleInspect", target: "deck", scope: "current" }), 1);
		t.flush();
		assert.equal((a[0] as FakeDial).trigger?.push, "Back to live");
		assert.equal((a[3] as FakeDial).trigger?.push, "Back to live");
		assert.equal(t.ctl.applyControl({ command: "stripLive", target: "", scope: "current" }), 2);
		t.flush();
		assert.equal((a[0] as FakeDial).trigger?.push, "Inspect");
		assert.equal((x[5] as FakeDial).trigger?.push, "Inspect");
		assert.equal(t.ctl.applyControl({ command: "stripWindowNext", target: "deck", scope: "current" }), 1);
		const state = t.request("a0", { event: "stripGet" });
		assert.deepEqual(
			((state.group as JsonObject).panes as JsonObject[]).map((p) => p.window),
			["15m", "15m"]
		);
		assert.equal(t.allWrites(), 10, "the two creates only");
	});
});

describe("strip runtime: the panel", () => {
	it("a draft previews plugin-drawn slices and is never written; closing the panel drops it", () => {
		const t = rig();
		const a = plusRow(t);
		t.panelContext = "a1";
		const state = t.request("a1", { event: "stripGet", draft: { layout: "split", patch: [{ op: "set", path: "panes.1.style", value: "lanes" }] }, frame: true });
		const preview = state.preview as JsonObject;
		assert.equal(preview.kind, "draft");
		assert.equal((preview.slices as string[]).length, 4);
		assert.ok((preview.slices as string[]).every((s) => s.startsWith("<svg")));
		assert.match(String(preview.frame), /^<svg[^>]*width="800"/);
		assert.deepEqual(
			(state.slots as JsonObject[]).map((s) => s.state),
			["independent", "independent", "independent", "independent"]
		);
		assert.equal(t.allWrites(), 0);
		assert.ok(t.interest.has("strip:draft:a1"));
		t.ctl.panelClosed("a1");
		assert.equal(t.interest.has("strip:draft:a1"), false);
		assert.ok(a.every((d) => d.feedback.length === 0), "a draft never reaches the deck");
	});

	it("the open panel of a member gets a pushed state after every change", () => {
		const t = rig();
		const a = plusRow(t);
		t.panelContext = "a2";
		created(t, a[0] as FakeDial, "whole");
		const pushed = t.panel.filter((p) => (p as JsonObject).event === "stripState" && (p as JsonObject).context === "a2") as JsonObject[];
		assert.ok(pushed.length >= 1);
		const last = pushed.at(-1) as JsonObject;
		assert.equal((last.self as JsonObject).status, "joined");
		assert.deepEqual(
			(last.slots as JsonObject[]).map((s) => s.state),
			["joined", "joined", "joined", "joined"]
		);
		assert.equal((last.preview as JsonObject).kind, "live");
	});

	it("a strip keeps the reading it was made with beside its first pane, so every member's panel reads the same untouched start from the stored strip, whichever dial made it", () => {
		const t = rig();
		const a = plusRow(t);
		created(t, a[0] as FakeDial, "split");
		const state = t.request("a2", { event: "stripGet" }) as { slots: JsonObject[]; group: { config: { panes: { series: { key: string }[]; seed?: string }[] } } };
		assert.deepEqual(
			state.group.config.panes.map((p) => [p.series.map((s) => s.key), p.seed]),
			[
				[[CPU], CPU],
				[[], undefined]
			],
			"the strip made from dial 1 starts with dial 1's reading and keeps it as its start, on dial 3's panel"
		);
		assert.ok(
			state.slots.every((s) => !Object.hasOwn(s, "seedKey")),
			"no dial's own reading stands in for it"
		);
	});

	it("a panel draft is remembered across member panels in memory only, and dropped on Discard", () => {
		const t = rig();
		const a = plusRow(t);
		const draft = { layout: "split", patch: [{ op: "set", path: "panes.1.style", value: "lanes" }], baseRev: 0 };
		t.panelContext = "a0";
		t.request("a0", { event: "stripGet", draft });
		t.ctl.panelClosed("a0");
		// Another dial on the same deck opens: the new-strip draft is there.
		t.panelContext = "a2";
		const other = t.request("a2", { event: "stripGet" });
		assert.deepEqual(other.draft, draft);
		assert.equal((other.preview as JsonObject).kind, "none", "a remembered draft previews only once the panel asks for it");
		assert.equal(t.interest.has("strip:draft:a2"), false);
		// A dial on another deck shares nothing.
		const b = new FakeDial("b0", "devB", 0);
		t.appear(b, individual(0));
		assert.equal(t.request("b0", { event: "stripGet" }).draft, null);
		// Discard on any member forgets it for every member.
		t.request("a2", { event: "stripGet", draft: null });
		assert.equal(t.request("a1", { event: "stripGet" }).draft, null);
		assert.equal(t.allWrites(), 0);
		assert.ok(a.every((d) => d.feedback.length === 0));
	});

	it("making the strip forgets the deck's new-strip draft", () => {
		const t = rig();
		const a = plusRow(t);
		t.request("a0", { event: "stripGet", draft: { layout: "whole", patch: [] } });
		created(t, a[0] as FakeDial, "whole");
		const left = t.request("a2", { event: "stripLeave", opId: "l1", groupId: "0123456789abcdef0123456789abcdef" });
		assert.equal(left.ok, true);
		assert.equal(t.request("a2", { event: "stripGet" }).draft, null, "a dial that leaves finds no stale new-strip draft");
	});

	it("a remembered draft expires after ten minutes", () => {
		const t = rig();
		plusRow(t);
		t.request("a0", { event: "stripGet", draft: { layout: "whole", patch: [] } });
		t.clock.advance(9 * 60_000);
		assert.notEqual(t.request("a1", { event: "stripGet" }).draft, null);
		t.request("a0", { event: "stripGet", draft: { layout: "whole", patch: [] } });
		t.clock.advance(10 * 60_000 + 1);
		assert.equal(t.request("a1", { event: "stripGet" }).draft, null);
	});

	it("the state names the config a draft patches and the dial's stored copy; results carry the stored copy", () => {
		const t = rig();
		const a = plusRow(t);
		const before = t.request("a1", { event: "stripGet" });
		const base = before.base as JsonObject;
		assert.equal(base.layout, "whole");
		assert.equal(base.encoders, 4);
		assert.equal(base.background, undefined, "a new strip keeps no Background of its own (Default), whatever its dial keeps");
		assert.deepEqual(((base.panes as JsonObject[])[0] as JsonObject).series, [{ key: GPU }], "seeded with this dial's reading");
		assert.equal(before.stored, null);
		const answer = created(t, a[1] as FakeDial, "split");
		assert.deepEqual(answer.stored, t.settings.get("a1")?.stripGroup);
		const after = t.request("a1", { event: "stripGet" });
		assert.deepEqual(after.stored, t.settings.get("a1")?.stripGroup);
		assert.equal(after.base, null, "a running strip's base is its group config, sent once");
		assert.equal(((after.group as JsonObject).config as JsonObject).layout, "split", "a member's draft patches the live group");
		// A deck without a strip has nothing to patch.
		const k = new FakeDial("k0", "devK", 0);
		t.appear(k, individual(0));
		assert.equal(t.request("k0", { event: "stripGet" }).base, null);
	});

	it("a dial on a deck without a touch strip is refused", () => {
		const t = rig();
		const k = new FakeDial("k0", "devK", 0);
		t.appear(k, individual(0));
		const answer = t.request("k0", { event: "stripCreate", opId: "c1", layout: "whole" });
		assert.equal(answer.ok, false);
		assert.equal(answer.reason, "device");
		assert.equal(k.writes.length, 0);
	});
});

/** The PAUSED/LIVE badges of every member's newest slice, left to right. */
function badges(dials: readonly FakeDial[]): string[] {
	return dials.flatMap((d) => (d.last ?? "").match(/>(PAUSED[^<]*|LIVE)</g) ?? []).map((m) => m.slice(1, -1).replace(/ .*/, ""));
}

function pausedOn(t: Rig, context: string, column: number): void {
	t.ctl.input(context, { kind: "dialDown", column, at: 10 });
	t.ctl.input(context, { kind: "dialUp", column, at: 60 });
	t.flush();
}

describe("strip runtime: an applied change over a paused view", () => {
	it("a paused pane draws the readings an edit just saved, still paused at the same moment", () => {
		const t = rig();
		const dials = plusRow(t);
		const made = created(t, dials[0] as FakeDial, "whole");
		t.tick(60, 45);
		t.tick(62, 46);
		t.flush();
		pausedOn(t, "a1", 1);
		const label = frameOf(dials).match(/>PAUSED ([^<]*)</)?.[1];
		assert.ok(label !== undefined, "paused");
		const ok = t.request("a0", { event: "stripEdit", opId: "e1", groupId: made.groupId, baseRev: 1, patch: [{ op: "set", path: "panes.0.series", value: [{ key: GPU }] }] });
		assert.equal(ok.ok, true, JSON.stringify(ok));
		t.flush();
		t.tick(63, 47);
		t.flush();
		const frame = frameOf(dials);
		assert.match(frame, new RegExp(`>PAUSED ${label}<`), "still paused at the moment it froze");
		assert.match(frame, />GPU Temperature</, "the reading the edit saved");
		assert.doesNotMatch(frame, />CPU Package</, "not the reading it froze with");
		assert.equal(t.request("a0", { event: "stripGet" }).group !== null, true);
	});

	it("a whole strip paused and then split stays paused in both halves; no half keeps the whole strip's copy", () => {
		const t = rig();
		const dials = plusRow(t);
		const made = created(t, dials[0] as FakeDial, "whole");
		t.tick(60, 45);
		t.tick(62, 46);
		t.flush();
		pausedOn(t, "a1", 1);
		const ok = t.request("a0", { event: "stripEdit", opId: "e1", groupId: made.groupId, baseRev: 1, patch: [{ op: "set", path: "layout", value: "split" }, { op: "set", path: "panes.1.series", value: [{ key: GPU }] }] });
		assert.equal(ok.ok, true, JSON.stringify(ok));
		t.flush();
		t.tick(63, 47);
		t.flush();
		assert.deepEqual(badges(dials), ["PAUSED", "PAUSED"], "one badge per half, both paused");
		assert.match(frameOf([dials[2], dials[3]] as FakeDial[]), />GPU Temperature</, "the right half draws its own reading");
		// Back to live works per half as before.
		t.ctl.input("a0", { kind: "dialDown", column: 0, at: 1000 });
		t.ctl.input("a0", { kind: "dialUp", column: 0, at: 1050 });
		t.flush();
		assert.deepEqual(badges(dials), ["LIVE", "PAUSED"]);
	});

	it("an applied window replaces rotation's session window; a change that leaves the window alone keeps it", () => {
		const t = rig();
		const a = plusRow(t);
		const made = created(t, a[0] as FakeDial, "whole");
		t.ctl.input("a3", { kind: "dialRotate", column: 3, at: 1, ticks: 1, pressed: false });
		t.flush();
		const drawn = (): unknown => ((t.request("a0", { event: "stripGet" }).group as JsonObject).panes as JsonObject[])[0]?.window;
		assert.equal(drawn(), "15m", "rotation chose 15 min for this session");
		const style = t.request("a0", { event: "stripEdit", opId: "e1", groupId: made.groupId, baseRev: 1, patch: [{ op: "set", path: "panes.0.style", value: "area" }] });
		assert.equal(style.ok, true);
		t.flush();
		assert.equal(drawn(), "15m", "a style change keeps the session window");
		const ed = t.request("a0", { event: "stripEdit", opId: "e2", groupId: made.groupId, baseRev: 2, patch: [{ op: "set", path: "window", value: "1m" }] });
		assert.equal(ed.ok, true);
		t.flush();
		assert.equal(drawn(), "1m", "the saved window shows");
		assert.match(frameOf(a), />1 min</);
		assert.doesNotMatch(frameOf(a), />15 min</);
	});
});

describe("strip runtime: one revision that only moves up", () => {
	it("a dial hidden through an edit and a leave of every dial: the leave says so, and Restore brings back the newest setup above every revision", () => {
		const t = rig();
		const dials = plusRow(t);
		const made = created(t, dials[0] as FakeDial, "whole");
		const id = made.groupId as string;
		// Dial 3 is hidden by another action of its dial stack.
		const hiddenDoc = structuredClone(t.settings.get("a2") as Record<string, unknown>);
		t.ctl.disappear("a2", 2);
		const ed = t.request("a0", { event: "stripEdit", opId: "e1", groupId: id, baseRev: 1, patch: [{ op: "set", path: "window", value: "15m" }, { op: "set", path: "panes.0.style", value: "area" }] });
		assert.equal(ed.ok, true, JSON.stringify(ed));
		const lv = t.request("a0", { event: "stripLeave", opId: "l1", groupId: id, columns: "all" });
		assert.equal(lv.ok, true, JSON.stringify(lv));
		assert.equal(lv.offscreen, 1, "the reply counts the dial that was off screen");
		t.flush();
		// It comes back with the copy it had: joined, revision 1.
		t.appear(dials[2] as FakeDial, hiddenDoc);
		t.flush();
		assert.equal(t.ctl.claims("a2"), true);
		const rs = t.request("a0", { event: "stripRestore", opId: "r1", groupId: id, columns: "all" });
		assert.equal(rs.ok, true, JSON.stringify(rs));
		assert.equal(rs.rev, 3, "above revision 2, never back to 1");
		for (const d of dials) {
			const c = stripGroupOf(t.settings.get(d.id)?.stripGroup);
			assert.deepEqual([d.id, c?.rev, c?.joined, c?.config.window, c?.config.panes[0].style], [d.id, 3, true, "15m", "area"]);
		}
		// A leave of every dial with all of them on screen counts nobody.
		const all = t.request("a0", { event: "stripLeave", opId: "l2", groupId: id, columns: "all" });
		assert.equal(all.ok, true);
		assert.equal(all.offscreen, undefined);
	});
});

describe("strip runtime: Rejoin after every dial left", () => {
	/** The lane23 line: dial 1 leaves (Independent dials), dial 2's panel
	 * edits the strip twice (rev 2, then rev 3), then Every dial leaves from
	 * dial 1's own line. Dials 2-4 hold a left copy at rev 3, dial 1 holds
	 * its own left copy at rev 1. */
	function everyDialLeftAfterEdits(t: Rig): { readonly dials: FakeDial[]; readonly id: string } {
		const dials = plusRow(t);
		const made = created(t, dials[0] as FakeDial, "whole");
		const id = made.groupId as string;
		const own = t.request("a0", { event: "stripLeave", opId: "l0", groupId: id });
		assert.equal(own.ok, true, JSON.stringify(own));
		const e1 = t.request("a1", { event: "stripEdit", opId: "e1", groupId: id, baseRev: 1, patch: [{ op: "set", path: "panes.0.style", value: "area" }, { op: "set", path: "window", value: "15m" }] });
		assert.equal(e1.ok, true, JSON.stringify(e1));
		const e2 = t.request("a1", { event: "stripEdit", opId: "e2", groupId: id, baseRev: 2, patch: [{ op: "set", path: "decimals", value: "2" }] });
		assert.equal(e2.ok, true, JSON.stringify(e2));
		assert.equal(e2.rev, 3);
		const all = t.request("a0", { event: "stripLeave", opId: "l1", groupId: id, columns: "all" });
		assert.equal(all.ok, true, JSON.stringify(all));
		t.flush();
		for (const d of dials.slice(1)) {
			const c = stripGroupOf(t.settings.get(d.id)?.stripGroup);
			assert.deepEqual([d.id, c?.rev, c?.joined, c?.config.panes[0].style, c?.config.window, c?.config.decimals], [d.id, 3, false, "area", "15m", "2"], "the newest setup is held by dials 2-4");
		}
		// Dial 1's panel shows its one line with Rejoin (and Restore the
		// strip, since no dial of the strip is in it now).
		const st = t.request("a0", { event: "stripGet" }) as { self: { joined: boolean }; group: { live: boolean } | null };
		assert.equal(st.self.joined, false);
		assert.equal(st.group?.live, false, "no dial is in the strip");
		return { dials, id };
	}

	it("Rejoin on the dial that left first brings back the newest setup any visible dial holds, never a lower revision", () => {
		const t = rig();
		const { dials, id } = everyDialLeftAfterEdits(t);
		// Rejoin on dial 1's line (pi-strip.js: columns [self.column]).
		const rj = t.request("a0", { event: "stripRestore", opId: "r0", groupId: id, columns: [0] });
		assert.equal(rj.ok, true, JSON.stringify(rj));
		t.flush();
		const c = stripGroupOf(t.settings.get("a0")?.stripGroup);
		assert.deepEqual(
			{ rev: rj.rev, joined: c?.joined, style: c?.config.panes[0].style, window: c?.config.window, decimals: c?.config.decimals },
			{ rev: Math.max(3, Number(rj.rev)), joined: true, style: "area", window: "15m", decimals: "2" },
			"docs/strip-display.md: Rejoin brings it back with the newest setup any of its dials holds; the revision never goes below 3"
		);
		assert.ok(Number(c?.rev) >= 3, `the stored revision never goes below the newest copy's 3 (got ${String(c?.rev)})`);
		assert.match(dials[0]?.last ?? "", /15 min/, "the rejoined slice draws the newest window");
	});

	it("an edit made on the rejoined dial survives the next Rejoin of another dial", () => {
		const t = rig();
		const { id } = everyDialLeftAfterEdits(t);
		const rj = t.request("a0", { event: "stripRestore", opId: "r0", groupId: id, columns: [0] });
		assert.equal(rj.ok, true, JSON.stringify(rj));
		// The person edits the strip they just rejoined, on dial 1's panel.
		const ed = t.request("a0", { event: "stripEdit", opId: "e3", groupId: id, baseRev: rj.rev, patch: [{ op: "set", path: "decimals", value: "1" }] });
		assert.equal(ed.ok, true, JSON.stringify(ed));
		// Then dial 2 rejoins from its own line.
		const rj2 = t.request("a1", { event: "stripRestore", opId: "r1", groupId: id, columns: [1] });
		assert.equal(rj2.ok, true, JSON.stringify(rj2));
		t.flush();
		for (const ctx of ["a0", "a1"]) {
			const c = stripGroupOf(t.settings.get(ctx)?.stripGroup);
			assert.deepEqual([ctx, c?.joined, c?.config.decimals], [ctx, true, "1"], `${ctx}: the edit made after Rejoin is kept, not overwritten without a word`);
		}
	});

	it("an edit made on a dial that was hidden in its dial stack while every dial left survives the next Restore the strip", () => {
		const t = rig();
		const dials = plusRow(t);
		const made = created(t, dials[0] as FakeDial, "whole");
		const id = made.groupId as string;
		// Dial 3 is hidden by another action of its dial stack (joined, rev 1).
		const hiddenDoc = structuredClone(t.settings.get("a2") as Record<string, unknown>);
		t.ctl.disappear("a2", 2);
		assert.equal(t.request("a0", { event: "stripEdit", opId: "e1", groupId: id, baseRev: 1, patch: [{ op: "set", path: "window", value: "15m" }] }).ok, true);
		assert.equal(t.request("a0", { event: "stripEdit", opId: "e2", groupId: id, baseRev: 2, patch: [{ op: "set", path: "panes.0.style", value: "area" }] }).ok, true);
		const lv = t.request("a0", { event: "stripLeave", opId: "l1", groupId: id, columns: "all" });
		assert.equal(lv.ok, true, JSON.stringify(lv));
		assert.equal(lv.offscreen, 1);
		// It comes back and runs the strip with the copy it had.
		t.appear(dials[2] as FakeDial, hiddenDoc);
		t.flush();
		assert.equal(t.ctl.claims("a2"), true);
		const st = t.request("a2", { event: "stripGet" }) as { group: { rev: number } };
		// The person edits that strip on dial 3's panel.
		const ed = t.request("a2", { event: "stripEdit", opId: "e3", groupId: id, baseRev: st.group.rev, patch: [{ op: "set", path: "decimals", value: "1" }] });
		assert.equal(ed.ok, true, JSON.stringify(ed));
		// Then Restore the strip on dial 1's line.
		const rs = t.request("a0", { event: "stripRestore", opId: "r1", groupId: id, columns: "all" });
		assert.equal(rs.ok, true, JSON.stringify(rs));
		for (const d of dials) {
			const c = stripGroupOf(t.settings.get(d.id)?.stripGroup);
			assert.deepEqual([d.id, c?.joined, c?.config.decimals], [d.id, true, "1"], `${d.id}: the last edit is kept, not overwritten without a word`);
		}
	});

	it("with only the requests the panel sends: an edit on the dial that was hidden while every dial left survives Rejoin on dial 1's line", () => {
		const t = rig();
		const dials = plusRow(t);
		const made = created(t, dials[0] as FakeDial, "whole");
		const id = made.groupId as string;
		const hiddenDoc = structuredClone(t.settings.get("a2") as Record<string, unknown>);
		t.ctl.disappear("a2", 2);
		assert.equal(t.request("a0", { event: "stripEdit", opId: "e1", groupId: id, baseRev: 1, patch: [{ op: "set", path: "window", value: "15m" }] }).ok, true);
		assert.equal(t.request("a0", { event: "stripEdit", opId: "e2", groupId: id, baseRev: 2, patch: [{ op: "set", path: "panes.0.style", value: "area" }] }).ok, true);
		// Independent dials on dial 1 (pi-strip.js:523, no columns).
		const own = t.request("a0", { event: "stripLeave", opId: "l0", groupId: id });
		assert.equal(own.ok, true, JSON.stringify(own));
		// Every dial leaves on dial 1's line (pi-strip.js:2560).
		const lv = t.request("a0", { event: "stripLeave", opId: "l1", groupId: id, columns: "all" });
		assert.equal(lv.ok, true, JSON.stringify(lv));
		assert.equal(lv.offscreen, 1);
		t.appear(dials[2] as FakeDial, hiddenDoc);
		t.flush();
		// Dial 3 runs the strip again, so dial 1's line offers Rejoin and
		// not Restore the strip (pi-strip.js renderRestore, othersIn).
		const s0 = t.request("a0", { event: "stripGet" }) as { group: { live: boolean }; slots: { state: string; self: boolean }[] };
		assert.deepEqual([s0.group.live, s0.slots.map((s) => s.state)], [true, ["dormant", "dormant", "joined", "dormant"]]);
		const st = t.request("a2", { event: "stripGet" }) as { group: { rev: number } };
		const ed = t.request("a2", { event: "stripEdit", opId: "e3", groupId: id, baseRev: st.group.rev, patch: [{ op: "set", path: "decimals", value: "1" }] });
		assert.equal(ed.ok, true, JSON.stringify(ed));
		assert.ok(Number(ed.rev) > 3, `the edit goes above the left copies' revision 3 (got ${String(ed.rev)})`);
		// Rejoin on dial 1's line (pi-strip.js:2559).
		const rj = t.request("a0", { event: "stripRestore", opId: "r1", groupId: id, columns: [0] });
		assert.equal(rj.ok, true, JSON.stringify(rj));
		t.flush();
		for (const d of ["a0", "a2"]) {
			const c = stripGroupOf(t.settings.get(d)?.stripGroup);
			assert.deepEqual([d, c?.joined, c?.config.decimals], [d, true, "1"], `${d}: the last edit is kept`);
		}
	});

	it("Rejoin while a dial that was hidden runs its older copy brings back the newest setup the other left dials hold, above both", () => {
		const t = rig();
		const dials = plusRow(t);
		const made = created(t, dials[0] as FakeDial, "whole");
		const id = made.groupId as string;
		// Dial 4 is hidden by another action of its dial stack (joined, rev 1).
		const hiddenDoc = structuredClone(t.settings.get("a3") as Record<string, unknown>);
		t.ctl.disappear("a3", 3);
		assert.equal(t.request("a0", { event: "stripLeave", opId: "l0", groupId: id }).ok, true);
		assert.equal(t.request("a1", { event: "stripEdit", opId: "e1", groupId: id, baseRev: 1, patch: [{ op: "set", path: "panes.0.style", value: "area" }, { op: "set", path: "window", value: "15m" }] }).ok, true);
		assert.equal(t.request("a0", { event: "stripLeave", opId: "l1", groupId: id, columns: "all" }).offscreen, 1);
		t.appear(dials[3] as FakeDial, hiddenDoc);
		t.flush();
		// Rejoin on dial 1's line: its own copy and dial 4's are revision 1,
		// dials 2 and 3 left with revision 2.
		const rj = t.request("a0", { event: "stripRestore", opId: "r1", groupId: id, columns: [0] });
		assert.equal(rj.ok, true, JSON.stringify(rj));
		assert.equal(rj.rev, 3, "above the left copies' revision 2");
		t.flush();
		const held = dials.map((d) => {
			const c = stripGroupOf(t.settings.get(d.id)?.stripGroup);
			return [d.id, c?.rev, c?.joined, c?.config.panes[0].style, c?.config.window];
		});
		assert.deepEqual(held, [
			["a0", 3, true, "area", "15m"],
			["a1", 2, false, "area", "15m"],
			["a2", 2, false, "area", "15m"],
			["a3", 3, true, "area", "15m"]
		]);
	});
});

describe("strip runtime: remembered drafts stay with their strip copy", () => {
	it("a same-deck profile copy never finds another copy's draft; the copy it was made in still does", () => {
		const t = rig();
		const a = plusRow(t, "devA", "a");
		const made = created(t, a[0] as FakeDial, "whole");
		const draft = { patch: [{ op: "set", path: "window", value: "15m" }], baseRev: 1 };
		t.request("a0", { event: "stripGet", draft });
		t.ctl.panelClosed("a0");
		assert.deepEqual(t.request("a2", { event: "stripGet" }).draft, draft, "another member of the same copy finds it");
		const copy = t.settings.get("a0")?.stripGroup;
		const page = (from: readonly FakeDial[], to: string): FakeDial[] => {
			for (const d of from) t.ctl.disappear(d.id, d.coordinates.column);
			return Array.from({ length: 4 }, (_, c) => {
				const d = new FakeDial(`${to}${c}`, "devA", c);
				t.appear(d, t.settings.get(d.id) ?? { ...individual(c), stripGroup: copy });
				return d;
			});
		};
		// A copied profile page: the same deck, group id and revision.
		const b = page(a, "b");
		assert.equal(t.request("b1", { event: "stripGet" }).draft, null, "the copy does not inherit the draft");
		// Discard there does not drop the other copy's draft.
		t.request("b1", { event: "stripGet", draft: null });
		const back = page(b, "a");
		assert.deepEqual(t.request("a1", { event: "stripGet" }).draft, draft, "back on the copy it was made in");
		assert.ok([...b, ...back].every((d) => d.writes.length === 0), "drafts write nothing");
		assert.equal(stripGroupOf(t.settings.get("a1")?.stripGroup)?.rev, 1);
		void made;
	});

	it("a new-strip draft is offered only while the dial it was made on is on screen", () => {
		const t = rig();
		const a = plusRow(t, "devA", "a");
		const draft = { layout: "split", patch: [], baseRev: 0 };
		t.request("a0", { event: "stripGet", draft });
		for (const d of a) t.ctl.disappear(d.id, d.coordinates.column);
		const b = new FakeDial("b0", "devA", 0);
		t.appear(b, individual(0));
		assert.equal(t.request("b0", { event: "stripGet" }).draft, null);
		t.appear(a[1] as FakeDial, individual(1));
		t.appear(a[0] as FakeDial, individual(0));
		assert.deepEqual(t.request("a1", { event: "stripGet" }).draft, draft);
	});
});

describe("strip runtime: Use it everywhere (src/ui/shared-looks.ts)", () => {
	const SIX = [0, 1, 2, 3, 4, 5];
	const own = (s: Record<string, unknown>): Record<string, unknown> | undefined => staleLooksReset(s, "dial");
	/** The owner's page (2026-10-26): six dials own Clear, Nebula or Stars, the
	 * whole strip over them keeps its own Clear. */
	function ownersPage(t: Rig): FakeDial[] {
		const looks = ["clear", "clear", "nebula", "clear", "clear", "stars"];
		const dials = SIX.map((c) => {
			const d = new FakeDial(`x${c}`, "devX", c);
			t.appear(d, { readingKey: CPU, label: `Dial ${c}`, dialBackground: looks[c], dialAccentWords: false });
			return d;
		});
		created(t, dials[2] as FakeDial, "whole", { patch: [{ op: "set", path: "background", value: "clear" }] });
		return dials;
	}
	// A painted art piece opens with its opaque base over the slice; Clear
	// draws no backdrop at all.
	const nebulaArt = (d: FakeDial): boolean => /<rect width="200" height="100" fill="#[0-9A-F]{6}"\/>/.test(d.last ?? "") && !(d.last ?? "").includes("data-art=");

	it("a shared Nebula changes nothing on the strip that keeps its own Clear; the reset is one edit, one write per dial, and the strip draws Nebula", () => {
		const t = rig();
		try {
			const dials = ownersPage(t);
			const writesBefore = dials.map((d) => d.writes.length);
			setSharedLooks({ ...NO_SHARED_LOOKS, keyBackground: "nebula", dialBackground: "nebula" });
			t.ctl.restyle();
			t.flush();
			assert.equal(t.ctl.liveConfigs()[0]?.background, "clear");
			assert.ok(!dials.some(nebulaArt), "own Clear: no Nebula on the strip");
			setSharedLooks({ ...NO_SHARED_LOOKS, keyBackground: "nebula", dialBackground: "nebula", resetGen: 1 });
			const written = t.ctl.resetLooks(1, undefined, own);
			assert.deepEqual([...written].sort(), dials.map((d) => d.id));
			dials.forEach((d, i) => assert.equal(d.writes.length, (writesBefore[i] as number) + 1, `${d.id}: exactly one write`));
			for (const d of dials) {
				const doc = d.writes.at(-1) as JsonObject;
				assert.equal(doc.dialBackground, undefined, `${d.id}: its own Background goes`);
				assert.equal(doc.dialAccentWords, undefined, `${d.id}: its own Words go`);
				assert.equal(doc.label, `Dial ${d.coordinates.column}`, "every other field stays");
				const copy = stripGroupOf(doc.stripGroup);
				assert.ok(copy !== undefined && copy.rev === 2 && copy.config.background === undefined && copy.config.accentWords === undefined, JSON.stringify(copy?.config));
			}
			t.flush();
			assert.ok(dials.every(nebulaArt), "every slice draws Nebula now");
			assert.deepEqual(t.ctl.resetLooks(1, undefined, own), [], "a second sweep writes nothing");
		} finally {
			setSharedLooks(NO_SHARED_LOOKS);
		}
	});

	it("a dial that comes back with the strip's older copy takes the group's copy in one write; a choice made after the reset is kept", () => {
		const t = rig();
		try {
			const dials = ownersPage(t);
			const away = dials[5] as FakeDial;
			t.ctl.disappear(away.id, 5);
			setSharedLooks({ ...NO_SHARED_LOOKS, dialBackground: "nebula", resetGen: 1 });
			t.ctl.resetLooks(1, undefined, own);
			assert.equal(stripGroupOf(t.settings.get("x5")?.stripGroup)?.rev, 1, "off screen: not written");
			const writes = away.writes.length;
			t.appear(away, t.settings.get("x5") as Record<string, unknown>);
			t.ctl.resetLooks(1, [away.id], own);
			assert.equal(away.writes.length, writes + 1, "one write on appear");
			const back = away.writes.at(-1) as JsonObject;
			assert.equal(stripGroupOf(back.stripGroup)?.rev, 2);
			assert.equal(back.dialBackground, undefined);
			// A Background picked for the strip after the reset carries its
			// generation and stays through another sweep.
			const id = t.ctl.liveConfigs().length === 1 ? (stripGroupOf(back.stripGroup)?.id as string) : "";
			const edit = t.request("x0", { event: "stripEdit", opId: "after", groupId: id, baseRev: 2, patch: [{ op: "set", path: "background", value: "stars" }] });
			assert.equal(edit.ok, true, JSON.stringify(edit));
			assert.equal(stripGroupOf(t.settings.get("x0")?.stripGroup)?.config.looksGen, 1);
			const total = t.allWrites();
			assert.deepEqual(t.ctl.resetLooks(1, undefined, own), []);
			assert.equal(t.allWrites(), total);
			assert.equal(t.ctl.liveConfigs()[0]?.background, "stars");
		} finally {
			setSharedLooks(NO_SHARED_LOOKS);
		}
	});

	it("an independent dial's own look goes in one write; Default dials and no reset write nothing", () => {
		const t = rig();
		try {
			const dials = plusRow(t);
			t.ctl.settingsChanged("a3", { ...t.settings.get("a3"), dialBackground: "" });
			t.settings.set("a3", { ...t.settings.get("a3"), dialBackground: "" });
			assert.deepEqual(t.ctl.resetLooks(0, undefined, (s) => staleLooksReset(s, "dial", 0)), [], "no reset ever made");
			setSharedLooks({ ...NO_SHARED_LOOKS, resetGen: 1 });
			const written = t.ctl.resetLooks(1, undefined, own);
			assert.deepEqual(written, ["a0", "a1", "a2"]);
			for (const id of written) assert.equal(t.dials.get(id)?.writes.length, 1);
			assert.equal(dials[3]?.writes.length, 0);
		} finally {
			setSharedLooks(NO_SHARED_LOOKS);
		}
	});
});

// ---- the Y scale on the runtime (40-spec-final.md sections 3.4, 5 and 6.2) ----------

describe("strip runtime: the held scale, the reserved end column and the scale dial", () => {
	/** The seeded generators of the spec's check (yscale/final/check.mts). */
	function mulberry32(seed: number): () => number {
		let a = seed >>> 0;
		return () => {
			a = (a + 0x6d2b79f5) >>> 0;
			let t = a;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}
	function gauss(rand: () => number): () => number {
		return () => {
			const u = Math.max(1e-12, rand());
			const v = rand();
			return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
		};
	}
	const q = (v: number, step: number): number => Math.round(v / step) * step;
	const r1 = (v: number): number => Number(v.toFixed(1));
	function table(seed: number, fn: (t: number, g: () => number) => number): Map<number, number> {
		const g = gauss(mulberry32(seed));
		const out = new Map<number, number>();
		for (let t = -900; t <= 1200; t++) out.set(t, fn(t, g));
		return out;
	}
	const idle = table(11, (t, g) => r1(q(36.5 + 0.15 * Math.sin((2 * Math.PI * t) / 420) + 0.12 * g(), 0.1)));
	const burstRand = mulberry32(14);
	const bursts: { at: number; len: number; level: number }[] = [];
	for (let at = 30; at < 270; at += 40 + Math.floor(burstRand() * 50)) bursts.push({ at, len: 2 + Math.floor(burstRand() * 7), level: 140 + burstRand() * 15 });
	const power = table(15, (t, g) => {
		const b = bursts.find((x) => t >= x.at && t < x.at + x.len);
		return r1(q(b === undefined ? 30 + 1.5 * g() : b.level + 3 * g(), 0.1));
	});
	/** The first slice's scale ends (x 3, 11 px), top to bottom. */
	const endsOf = (svg: string): string[] =>
		[...svg.matchAll(/<text x="3" y="([\d.]+)"[^>]*font-size="11"[^>]*>([^<]+)<\/text>/g)]
			.map((m) => ({ y: Number(m[1]), text: m[2] as string }))
			.sort((a, b) => a.y - b.y)
			.map((e) => e.text);
	const xOf = (svg: string, text: string): number | undefined => {
		const m = new RegExp(`<text x="([\\d.]+)"[^>]*>${text}</text>`).exec(svg);
		return m === null ? undefined : Number(m[1]);
	};
	function oneReading(label: string, unit: string, type: SensorType, window: "1m" | "5m") {
		const rt = ruleRuntime([{ sensor: "GPU", label, unit, value: 0, type }]);
		const groupId = rt.make([{ op: "set", path: "window", value: window }]);
		return { rt, key: stripGroupKey("devX", groupId) };
	}
	const at = (label: string, unit: string, type: SensorType, value: number): Spec[] => [{ sensor: "GPU", label, unit, value, type }];

	it("29. the seeded idle GPU signal on a 1 min window: 1200 data frames, no scale change and the name never moves", () => {
		const { rt } = oneReading("GPU Temperature", "°C", SensorType.Temperature, "1m");
		const seen = new Set<string>();
		const names = new Set<number | undefined>();
		for (let t = -60; t <= 1200; t++) {
			rt.setSpecs(at("GPU Temperature", "°C", SensorType.Temperature, idle.get(t) as number));
			rt.tick(1000);
			if (t < 0) continue;
			const slice = rt.slices()[0] as string;
			seen.add(endsOf(slice).join(" / "));
			names.add(xOf(slice, "GPU Temperature"));
		}
		assert.deepEqual([...seen], ["39 °C / 34"]);
		assert.ok(!names.has(undefined), "the name is drawn");
		assert.equal(names.size, 1, [...names].join(","));
	});

	it("30. the seeded CPU power signal with 150 W bursts on a 1 min window: the name never moves", () => {
		const { rt } = oneReading("CPU Package Power", "W", SensorType.Power, "1m");
		const names = new Set<number | undefined>();
		for (let t = -60; t <= 1200; t++) {
			rt.setSpecs(at("CPU Package Power", "W", SensorType.Power, power.get(t) as number));
			rt.tick(1000);
			if (t >= 0) names.add(xOf(rt.slices()[0] as string, "CPU Package Power"));
		}
		assert.ok(!names.has(undefined), "the name is drawn");
		assert.equal(names.size, 1, [...names].join(","));
	});

	it("the word tabs follow their words through the runtime on a Clear strip: a scale that grows moves the window's tab with its word at most once, a stale source holds them, a reading gone leaves only the window's tab, the reading back brings them all as they were, and the scale's own words still move as they did", () => {
		const specs = (value: number): Spec[] => at("Pump", "RPM", SensorType.Fan, value);
		const rt = ruleRuntime(specs(0));
		rt.make([
			{ op: "set", path: "background", value: "clear" },
			{ op: "set", path: "window", value: "5m" }
		]);
		const tabsOf = (): string => /<path d="M[^"]*q[^"]*" fill="#[0-9A-F]{6}"[/]>/.exec(rt.slices()[0] as string)?.[0] ?? "(none)";
		const boxes = (path: string): number => (path.match(/q/g) ?? []).length / 4;
		rt.setSpecs(specs(0));
		rt.tick(1000);
		assert.equal(boxes(tabsOf()), 3);
		const places = new Set<string>([tabsOf()]);
		const ends = new Set<string>();
		for (const value of [0, 40, 900, 2800, 12_000, 300, 2800]) {
			rt.setSpecs(specs(value));
			rt.tick(1000);
			assert.equal(boxes(tabsOf()), 3, `at ${value} RPM`);
			places.add(tabsOf());
			ends.add(endsOf(rt.slices()[0] as string).join(" / "));
		}
		assert.ok(places.size <= 2, `the tabs took ${places.size} places`);
		assert.ok(ends.size > 1, "the scale's ends did change");
		const settled = tabsOf();
		rt.stale(1000);
		rt.flush();
		assert.equal(tabsOf(), settled, "a stale source");
		rt.setSpecs([]);
		rt.tick(1000);
		rt.flush();
		assert.equal(boxes(tabsOf()), 1, "the reading gone");
		rt.setSpecs(specs(2800));
		rt.tick(1000);
		rt.flush();
		assert.equal(tabsOf(), settled, "the reading back");
	});

	it("a second unit's reading gone through the runtime restacks a Clear strip's tabs with its words, and they come back as they were", () => {
		const temp: Spec = { sensor: "CPU", label: "CPU Package", unit: "°C", value: 62, type: SensorType.Temperature };
		const power: Spec = { sensor: "CPU", label: "CPU Power", unit: "W", value: 90, type: SensorType.Power };
		const rt = ruleRuntime([temp, power]);
		rt.make([
			{ op: "set", path: "background", value: "clear" },
			{ op: "set", path: "window", value: "5m" },
			{ op: "set", path: "panes.0.style", value: "compare" },
			{ op: "set", path: "panes.0.series", value: [{ key: "f0:0:100" }, { key: "f0:0:101" }] }
		]);
		const tabsOf = (): string => /<path d="M[^"]*q[^"]*" fill="#[0-9A-F]{6}"[/]>/.exec(rt.slices()[0] as string)?.[0] ?? "(none)";
		const boxes = (path: string): number => (path.match(/q/g) ?? []).length / 4;
		for (let k = 0; k < 5; k++) {
			rt.setSpecs([temp, power]);
			rt.tick(1000);
		}
		rt.flush();
		const live = tabsOf();
		assert.equal(boxes(live), 5);
		assert.equal(endsOf(rt.slices()[0] as string).length, 4);
		rt.setSpecs([temp]);
		rt.tick(1000);
		rt.flush();
		assert.equal(boxes(tabsOf()), 3, "power gone: one band's two ends and the window's words");
		assert.equal(endsOf(rt.slices()[0] as string).length, 2);
		rt.setSpecs([temp, power]);
		rt.tick(1000);
		rt.flush();
		assert.equal(tabsOf(), live, "power back");
	});

	it("31. a pressed turn on the idle Trend: wider at once, back to Auto on the way back, and a long touch fits now", () => {
		const { rt, key } = oneReading("GPU Temperature", "°C", SensorType.Temperature, "5m");
		const values = [36.1, 36.5, 36.9, 36.4, 36.6];
		for (let k = 0; k < 60; k++) {
			rt.setSpecs(at("GPU Temperature", "°C", SensorType.Temperature, values[k % values.length] as number));
			rt.tick(2000);
		}
		rt.flush();
		assert.deepEqual(endsOf(rt.slices()[0] as string), ["39 °C", "34"]);
		rt.turn(0, 1, true);
		assert.deepEqual(endsOf(rt.slices()[0] as string), ["42 °C", "32"], "one detent clockwise is wider, at once");
		rt.turn(0, -1, true);
		assert.deepEqual(endsOf(rt.slices()[0] as string), ["39 °C", "34"], "back on the span it started from");
		assert.equal(rt.ctl.viewOf(key)?.scaleTurn[0], null, "the turn ended");
		rt.turn(0, -1, true);
		assert.deepEqual(endsOf(rt.slices()[0] as string), ["37.5 °C", "35.5"]);
		rt.tap(0, 100, 50, true);
		assert.deepEqual(endsOf(rt.slices()[0] as string), ["39 °C", "34"], "a long touch is Auto, now");
	});

	// Spec 5.2 "Back to live (keeps the turned scale)" and 5.3 "At once": a
	// pressed turn made while paused is the scale the live view takes when
	// the pane goes live, on its first frame, and it stays; the 10 s hold is
	// for the data, never for a person's turn.
	for (const [dir, want] of [
		[1, ["42 °C", "32"]],
		[-1, ["37.5 °C", "35.5"]]
	] as const) {
		it(`a pressed turn ${dir > 0 ? "clockwise" : "counterclockwise"} while paused is the live scale once the pane goes live, at once and after`, () => {
			const { rt, key } = oneReading("GPU Temperature", "°C", SensorType.Temperature, "5m");
			const values = [36.1, 36.5, 36.9, 36.4, 36.6];
			const feed = (n: number, ms: number): void => {
				for (let k = 0; k < n; k++) {
					rt.setSpecs(at("GPU Temperature", "°C", SensorType.Temperature, values[k % values.length] as number));
					rt.tick(ms);
				}
				rt.flush();
			};
			feed(60, 2000);
			assert.deepEqual(endsOf(rt.slices()[0] as string), ["39 °C", "34"]);
			rt.press(0);
			assert.equal(rt.ctl.viewOf(key)?.panes[0].mode, "paused");
			rt.turn(0, dir, true);
			assert.deepEqual(endsOf(rt.slices()[0] as string), [...want], "the frozen copy takes the turn at once");
			rt.press(0);
			assert.equal(rt.ctl.viewOf(key)?.panes[0].mode, "live");
			assert.deepEqual(endsOf(rt.slices()[0] as string), [...want], "live again: the turned scale, on the first frame");
			feed(15, 1000);
			assert.deepEqual(endsOf(rt.slices()[0] as string), [...want], "15 s on: no hold brings another scale");
			feed(60, 1000);
			assert.deepEqual(endsOf(rt.slices()[0] as string), [...want], "75 s on: still the turned scale");
			assert.notEqual(rt.ctl.viewOf(key)?.scaleTurn[0], null, "the turn is kept");
		});
	}

	it("a turn ended while paused (out and back) leaves the live view on Auto when the pane goes live", () => {
		const { rt, key } = oneReading("GPU Temperature", "°C", SensorType.Temperature, "5m");
		const values = [36.1, 36.5, 36.9, 36.4, 36.6];
		for (let k = 0; k < 60; k++) {
			rt.setSpecs(at("GPU Temperature", "°C", SensorType.Temperature, values[k % values.length] as number));
			rt.tick(2000);
		}
		rt.flush();
		rt.press(0);
		rt.turn(0, -1, true);
		rt.turn(0, 1, true);
		assert.equal(rt.ctl.viewOf(key)?.scaleTurn[0], null, "the turn ended");
		assert.deepEqual(endsOf(rt.slices()[0] as string), ["39 °C", "34"]);
		rt.press(0);
		assert.deepEqual(endsOf(rt.slices()[0] as string), ["39 °C", "34"], "live again on Auto");
		for (let k = 0; k < 20; k++) {
			rt.setSpecs(at("GPU Temperature", "°C", SensorType.Temperature, values[k % values.length] as number));
			rt.tick(1000);
		}
		rt.flush();
		assert.deepEqual(endsOf(rt.slices()[0] as string), ["39 °C", "34"], "and it holds");
	});

	// Spec 5.3 "a fast spin moves several stops" and "out k and back k
	// return to Auto", at the spacing of the recorded fast spin
	// (test/traces/rapid-rotation.json, 15 to 16 ms): several detents inside
	// one frame (MIN_FRAME_MS), each stepping from the span the one before
	// it set, not from the span the last frame drew.
	const rapid = JSON.parse(readFileSync(new URL("./traces/rapid-rotation.json", import.meta.url), "utf8")) as { events: readonly { mono: number }[] };
	const gaps = rapid.events.slice(1).map((e, i) => e.mono - (rapid.events[i] as { mono: number }).mono);
	function spin(rt: RuleRuntime, ticks: readonly number[]): void {
		rt.ctl.input("x0", { kind: "dialDown", column: 0, at: rt.clock.t });
		ticks.forEach((k, i) => {
			rt.ctl.input("x0", { kind: "dialRotate", column: 0, at: rt.clock.t, ticks: k, pressed: true });
			rt.clock.advance(gaps[i % gaps.length] as number);
		});
		rt.ctl.input("x0", { kind: "dialUp", column: 0, at: rt.clock.t });
		rt.flush();
	}
	function idleTrend(paused: boolean) {
		const { rt, key } = oneReading("GPU Temperature", "°C", SensorType.Temperature, "5m");
		const values = [36.1, 36.5, 36.9, 36.4, 36.6];
		for (let k = 0; k < 60; k++) {
			rt.setSpecs(at("GPU Temperature", "°C", SensorType.Temperature, values[k % values.length] as number));
			rt.tick(2000);
		}
		rt.flush();
		if (paused) rt.press(0);
		assert.equal(rt.ctl.viewOf(key)?.panes[0].mode, paused ? "paused" : "live");
		assert.deepEqual(endsOf(rt.slices()[0] as string), ["39 °C", "34"]);
		return { rt, key };
	}
	// Spec 5.3: the stops run on the 1, 2, 5 rungs from the narrow stop to
	// the wide stop, a percentage's wide stop its domain.
	it("Trend of a steady 3 % reading steps through every rung both ways, from 100 and back, and ends on Auto", () => {
		const usage: Spec[] = [{ sensor: "CPU", label: "CPU Usage", unit: "%", value: 3, type: SensorType.Usage }];
		const rt = ruleRuntime(usage);
		const key = stripGroupKey("devX", rt.make([{ op: "set", path: "window", value: "1m" }]));
		for (let k = 0; k < 70; k++) {
			rt.setSpecs(usage);
			rt.tick(1000);
		}
		rt.flush();
		const top = (): string => endsOf(rt.slices()[0] as string).join(" to ");
		const seen = [top()];
		for (const d of [-1, -1, -1, -1, -1, -1, -1, 1, 1, 1, 1, 1, 1, 1]) {
			rt.turn(0, d, true);
			seen.push(top());
		}
		assert.deepEqual(seen, ["100 % to 0", "50 % to 0", "20 % to 0", "10 % to 0", "5 % to 0", "4.0 % to 2.0", "3.6 % to 2.6", "3.6 % to 2.6", "4.0 % to 2.0", "5 % to 0", "10 % to 0", "20 % to 0", "50 % to 0", "100 % to 0", "100 % to 0"]);
		assert.equal(rt.ctl.viewOf(key)?.scaleTurn[0], null, "back on the start span: the turn ended");
	});

	// Spec 5.2, paused: a pressed turn scales the frozen copy, also when that
	// copy is the paused view a page back restores (VIEW_LINEAGE_TTL_MS).
	it("a paused view restored on a page back takes a pressed turn, and keeps it", () => {
		const { rt, key } = idleTrend(true);
		const dials = rt.dials;
		for (const d of dials) rt.ctl.disappear(d.id);
		rt.clock.advance(2000);
		for (const d of dials) rt.ctl.appear(d, rt.settings.get(d.id));
		rt.flush();
		assert.equal(rt.ctl.viewOf(key)?.panes[0].mode, "paused", "the paused view came back");
		assert.deepEqual(endsOf(rt.slices()[0] as string), ["39 °C", "34"]);
		rt.turn(0, -2, true);
		assert.deepEqual(endsOf(rt.slices()[0] as string), ["37.0 °C", "36.0"], "two detents narrower, at once");
		assert.equal(rt.ctl.viewOf(key)?.scaleTurn[0]?.span, 1);
		rt.setSpecs(at("GPU Temperature", "°C", SensorType.Temperature, 36.5));
		rt.tick(1000);
		rt.flush();
		assert.deepEqual(endsOf(rt.slices()[0] as string), ["37.0 °C", "36.0"], "a data frame later: still the turned scale");
		assert.equal(rt.ctl.viewOf(key)?.scaleTurn[0]?.span, 1, "the turn is kept");
	});

	for (const paused of [false, true]) {
		it(`${paused ? "paused" : "live"}: four pressed detents as fast as the recorded spin step four stops, 34..39 to 0..100`, () => {
			assert.ok(gaps.length > 0 && gaps.every((g) => g > 0 && g < MIN_FRAME_MS), `the trace's detents are inside one frame: ${gaps.join(", ")} ms`);
			const { rt, key } = idleTrend(paused);
			spin(rt, [1, 1, 1, 1]);
			assert.deepEqual(endsOf(rt.slices()[0] as string), ["100 °C", "0"], "32..42 > 25..45 > 0..50 > 0..100");
			assert.equal(rt.ctl.viewOf(key)?.scaleTurn[0]?.span, 100);
		});

		it(`${paused ? "paused" : "live"}: two out and two back as fast as the recorded spin are back on Auto, with no turn held`, () => {
			for (const ticks of [
				[1, 1, -1, -1],
				[-1, -1, 1, 1]
			]) {
				const { rt, key } = idleTrend(paused);
				spin(rt, ticks);
				assert.deepEqual(endsOf(rt.slices()[0] as string), ["39 °C", "34"], ticks.join(" "));
				assert.equal(rt.ctl.viewOf(key)?.scaleTurn[0], null, `${ticks.join(" ")}: the turn ended`);
			}
		});
	}
});

describe("strip runtime: the hold, the reserved widths, the pause and the dial flag (40-spec-final.md 10.2)", () => {
	const endsOf = (svg: string): string[] =>
		[...svg.matchAll(/<text x="3" y="([\d.]+)"[^>]*font-size="11"[^>]*>([^<]+)<\/text>/g)]
			.map((m) => ({ y: Number(m[1]), text: m[2] as string }))
			.sort((a, b) => a.y - b.y)
			.map((e) => e.text);
	const nameX = (svg: string, name: string): number | undefined => {
		const m = new RegExp(`<text x="([\\d.]+)"[^>]*>${name}</text>`).exec(svg);
		return m === null ? undefined : Number(m[1]);
	};
	const power = (value: number): Spec[] => [{ sensor: "CPU", label: "CPU Package Power", unit: "W", value, type: SensorType.Power }];
	/** A one-reading power Trend held at 0 to 250 W after a burst that has
	 * just left the 1 min window: the readings fit in half of it, and the
	 * 10 s hold has begun. */
	function afterBurst() {
		const rt = ruleRuntime(power(30));
		const groupId = rt.make([{ op: "set", path: "window", value: "1m" }]);
		for (let k = 0; k < 30; k++) rt.tick(1000);
		rt.setSpecs(power(150));
		rt.tick(1000);
		rt.setSpecs(power(30));
		for (let k = 0; k < 62; k++) rt.tick(1000);
		rt.flush();
		return { rt, groupId, key: stripGroupKey("devX", groupId) };
	}

	it("a held scale waits out its hold; a changed window starts it over at the target at once", () => {
		const { rt } = afterBurst();
		assert.deepEqual(endsOf(rt.slices()[0] as string), ["250 W", "0"], "held while the hold runs");
		rt.turn(0, 1);
		assert.deepEqual(endsOf(rt.slices()[0] as string), ["250 W", "0"], "the 5 min window still holds the burst");
		rt.turn(0, -1);
		assert.deepEqual(endsOf(rt.slices()[0] as string), ["50 W", "0"], "back on 1 min: the hold starts over at the target");
	});

	it("a changed stored setup (°F, the readings, a typed scale) starts the held scale over too", () => {
		const { rt, groupId } = afterBurst();
		const rev = (rt.request({ event: "stripGet", requestId: "s" }).group as { rev: number }).rev;
		const answer = rt.request({ event: "stripEdit", opId: "e", groupId, baseRev: rev, patch: [{ op: "set", path: "panes.0.overlays.minmax", value: true }] });
		assert.equal(answer.ok, true, JSON.stringify(answer));
		rt.flush();
		assert.deepEqual(endsOf(rt.slices()[0] as string), ["250 W", "0"], "a box that is not the scale's keeps its hold");
		const typed = rt.request({ event: "stripEdit", opId: "e2", groupId, baseRev: rev + 1, patch: [{ op: "set", path: "panes.0.scale.min", value: 0 }] });
		assert.equal(typed.ok, true, JSON.stringify(typed));
		rt.flush();
		assert.deepEqual(endsOf(rt.slices()[0] as string), ["50 W", "0"], "a typed end: the free end takes its target at once");
	});

	it("a detent's way back seeds the held scale with the start span, and the 10 s rule then narrows it", () => {
		const { rt, key } = afterBurst();
		rt.turn(0, -1, true);
		assert.deepEqual(endsOf(rt.slices()[0] as string), ["100 W", "0"], "one detent narrower, at once");
		rt.turn(0, 1, true);
		assert.deepEqual(endsOf(rt.slices()[0] as string), ["250 W", "0"], "back on the start span: the screen it began on");
		assert.equal(rt.ctl.viewOf(key)?.scaleTurn[0], null);
		for (let k = 0; k < 9; k++) rt.tick(1000);
		rt.flush();
		assert.deepEqual(endsOf(rt.slices()[0] as string), ["250 W", "0"], "the hold goes on from there");
		for (let k = 0; k < 3; k++) rt.tick(1000);
		rt.flush();
		assert.deepEqual(endsOf(rt.slices()[0] as string), ["50 W", "0"], "and narrows in one step");
	});

	it("a pause freezes the held scale: its hold never runs out while paused", () => {
		const { rt } = afterBurst();
		rt.press(0);
		for (let k = 0; k < 20; k++) rt.tick(1000);
		rt.flush();
		assert.match(rt.frame(), /PAUSED/);
		assert.deepEqual(endsOf(rt.slices()[0] as string), ["250 W", "0"]);
		rt.press(0);
		rt.tick(1000);
		rt.flush();
		assert.deepEqual(endsOf(rt.slices()[0] as string), ["50 W", "0"], "live again, the hold has run out");
	});

	it("the reserved end column survives window turns and detents: the name never moves", () => {
		const rt = ruleRuntime([{ sensor: "GPU", label: "GPU Temperature", unit: "°C", value: 36.5, type: SensorType.Temperature }]);
		rt.make([{ op: "set", path: "window", value: "5m" }]);
		const values = [36.1, 36.5, 36.9, 36.4];
		for (let k = 0; k < 40; k++) {
			rt.setSpecs([{ sensor: "GPU", label: "GPU Temperature", unit: "°C", value: values[k % values.length] as number, type: SensorType.Temperature }]);
			rt.tick(2000);
		}
		rt.flush();
		const xs = new Set<number | undefined>([nameX(rt.slices()[0] as string, "GPU Temperature")]);
		const seen = new Set<string>([endsOf(rt.slices()[0] as string).join(" / ")]);
		for (const [ticks, pressed] of [[-1, true], [-1, true], [1, false], [1, true], [1, true], [1, true], [-1, false], [-1, true]] as const) {
			rt.turn(0, ticks, pressed);
			const slice = rt.slices()[0] as string;
			xs.add(nameX(slice, "GPU Temperature"));
			seen.add(endsOf(slice).join(" / "));
		}
		assert.ok(seen.size >= 4, `the scale moved: ${[...seen].join(", ")}`);
		assert.ok(!xs.has(undefined), "the name is drawn");
		assert.equal(xs.size, 1, `the name's x: ${[...xs].join(", ")}`);
	});

	it("a Yes/No reading that arrives after the first frame re-sends the hints once: no pressed scale on it", () => {
		const specs = (unit: string): Spec[] => [{ sensor: "CPU", label: "Thermal Throttling", unit, value: 0, type: SensorType.Other }];
		const rt = ruleRuntime(specs("%"));
		rt.make([{ op: "set", path: "window", value: "5m" }]);
		rt.tick(1000);
		rt.flush();
		const hints = (): string[] => rt.dials[0]?.triggers.map((t) => t?.rotate ?? "") ?? [];
		assert.equal(hints().at(-1), "Time window · pressed: scale");
		const before = hints().length;
		rt.setSpecs(specs("Yes/No"));
		for (let k = 0; k < 3; k++) rt.tick(1000);
		rt.flush();
		assert.equal(hints().at(-1), "Time window", "the pane no longer takes the dial");
		assert.equal(hints().length, before + 1, "sent once");
	});
});
