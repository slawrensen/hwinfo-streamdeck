/**
 * Strip Screens on the strip runtime (src/strip/controller.ts): the real
 * registry, scheduler, scene, slicer and history store over fake dials, a
 * fake clock and a synthetic HWiNFO list, on a Stream Deck + XL and a +.
 * The Screens dial and its hints, the wipe (one slice per frame, its
 * direction, a turn during it cutting to the target, the send order), a
 * fast spin with no backlog, the position line and its critical segment,
 * the name and place for 1.6 s, the automatic cycle (poll-tick timing,
 * wrap, skip, restart, held by inspect, an open panel and HWiNFO stopping),
 * the Control commands, the panel's stripShowScreen and screen state, and
 * throughout: moving between screens never writes a setting.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { JsonObject, JsonValue } from "@elgato/utils";

import { deriveCapabilities, type DeviceCapabilities } from "../src/devices";
import { HistoryStore } from "../src/history/store";
import { SensorType } from "../src/hwinfo/types";
import type { PollerStatus } from "../src/poller";
import { StripController, type StripDialHandle, type StripHost } from "../src/strip/controller";
import { MIN_FRAME_MS, type SchedulerClock } from "../src/strip/scheduler";
import { SCREEN_NAME_MS } from "../src/strip/screens";
import { loadPanelModels } from "./panel-models";
import { snap, type Spec } from "./strip-rule-runtime";

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
	get pending(): number {
		return this.timers.size;
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

type Sent = { readonly context: string; readonly at: number; readonly svg: string };

class Dial implements StripDialHandle {
	readonly feedback: string[] = [];
	readonly triggers: ({ rotate?: string; push?: string; touch?: string; longTouch?: string } | undefined)[] = [];
	readonly writes: JsonObject[] = [];
	readonly coordinates: { column: number; row: number };
	constructor(
		readonly id: string,
		readonly device: { readonly id: string },
		column: number,
		private readonly log: Sent[],
		private readonly clock: FakeClock
	) {
		this.coordinates = { column, row: 0 };
	}
	setFeedback(f: { canvas: string }): Promise<void> {
		const svg = decodeURIComponent(f.canvas.slice("data:image/svg+xml,".length));
		this.feedback.push(svg);
		this.log.push({ context: this.id, at: this.clock.t, svg });
		return Promise.resolve();
	}
	setTriggerDescription(d?: { rotate?: string; push?: string; touch?: string; longTouch?: string }): Promise<void> {
		this.triggers.push(d);
		return Promise.resolve();
	}
	setSettings(settings: JsonObject): Promise<void> {
		this.writes.push(structuredClone(settings));
		return Promise.resolve();
	}
	get last(): string {
		return this.feedback.at(-1) ?? "";
	}
}

const SPECS: Spec[] = [
	{ sensor: "CPU [#0]: Test", label: "CPU Package", unit: "°C", value: 60, type: SensorType.Temperature },
	{ sensor: "CPU [#0]: Test", label: "Core 0 Clock", unit: "MHz", value: 4800 },
	{ sensor: "CPU [#0]: Test", label: "Core 1 Clock", unit: "MHz", value: 4700 },
	{ sensor: "GPU [#0]: Test", label: "GPU Temperature", unit: "°C", value: 55, type: SensorType.Temperature },
	{ sensor: "GPU [#0]: Test", label: "GPU Power", unit: "W", value: 200, type: SensorType.Power }
];
const KEY = Object.fromEntries(snap(SPECS).readings.map((r) => [r.label, r.key])) as Record<string, string>;
const CPU = KEY["CPU Package"] as string;
const GPU_T = KEY["GPU Temperature"] as string;
const GPU_P = KEY["GPU Power"] as string;

const XL: DeviceCapabilities = deriveCapabilities({ type: 13, columns: 9, rows: 4 });
const PLUS: DeviceCapabilities = deriveCapabilities({ type: 7, columns: 4, rows: 2 });

type Op = Record<string, unknown>;
const set = (path: string, value: unknown): Op => ({ op: "set", path, value });

/** Three screens: CPU Package as a Trend; the clocks as a Group filter;
 * the GPU's temperature and power as Meters. */
const THREE: Op[] = [
	set("panes.0.series", [{ key: CPU }]),
	{ op: "addScreen", at: 1 },
	set("screens.0.group", { from: "filter", filter: "*clock*", keys: [], view: "auto" }),
	{ op: "addScreen", at: 2 },
	set("screens.1.style", "meters"),
	set("screens.1.series", [{ key: GPU_T }, { key: GPU_P }])
];

function rig(options: { device?: "xl" | "plus"; columns?: number[]; stored?: (column: number) => Record<string, unknown> } = {}) {
	const clock = new FakeClock();
	const caps = options.device === "plus" ? PLUS : XL;
	const encoders = options.device === "plus" ? 4 : 6;
	const columns = options.columns ?? Array.from({ length: encoders }, (_, c) => c);
	const settings = new Map<string, Record<string, unknown>>();
	const history = new HistoryStore({ now: () => clock.t });
	const interest = new Map<string, unknown>();
	const panel: JsonValue[] = [];
	const log: Sent[] = [];
	let status: PollerStatus = { state: "ok", snapshot: snap(SPECS), source: "shared-memory" };
	let panelContext: string | undefined;
	let specs = SPECS;
	const host: StripHost = {
		settingsOf: (c) => settings.get(c),
		stored: (c, d) => settings.set(c, d),
		claimChanged: () => {},
		status: () => status,
		history: {
			setInterest: (id, entries, opts) => {
				interest.set(id, entries);
				history.setInterest(id, entries, opts);
			},
			dropInterest: (id) => {
				interest.delete(id);
				history.dropInterest(id);
			},
			view: (key, window, width, now, linked) => history.view(key, window, width, now, linked),
			refused: (key, window) => history.refused(key, window),
			get revision() {
				return history.revision;
			}
		},
		panelContext: () => panelContext,
		sendToPanel: (p) => panel.push(p)
	};
	const ctl = new StripController(host, { clock, capabilities: { get: () => caps }, mintId: () => "0123456789abcdef0123456789abcdef" });
	const device = { id: "dev" };
	const dials = columns.map((c) => new Dial(`d${c}`, device, c, log, clock));
	for (const d of dials) {
		const doc = options.stored?.(d.coordinates.column) ?? { readingKey: CPU };
		settings.set(d.id, structuredClone(doc));
		ctl.appear(d, structuredClone(doc));
	}
	let poll = 1;
	const r = {
		clock,
		ctl,
		dials,
		log,
		interest,
		panel,
		dial: (column: number): Dial => dials.find((d) => d.coordinates.column === column) as Dial,
		setPanel(context: string | undefined): void {
			if (context === undefined && panelContext !== undefined) {
				const was = panelContext;
				panelContext = undefined;
				ctl.panelClosed(was);
			} else panelContext = context;
		},
		setSpecs(next: Spec[]): void {
			specs = next;
		},
		/** One poll with new producer evidence `ms` after the last. */
		tick(ms = 1000): void {
			poll++;
			clock.advance(ms);
			const s = snap(specs, { pollTime: poll, valueRevision: poll });
			history.ingest({ kind: "ok", at: clock.t, snapshot: s, source: "shared-memory", evidence: true, stampAdvanced: true, evidenceAgeMs: 0 });
			status = { state: "ok", snapshot: s, source: "shared-memory" };
			ctl.onTick(status);
		},
		/** HWiNFO stopped: no shared memory. */
		gone(ms = 1000): void {
			clock.advance(ms);
			status = { state: "unavailable", reason: "not-running", message: "HWiNFO is not running" };
			ctl.onTick(status);
		},
		request(payload: Record<string, unknown>, from = dials[0]?.id ?? ""): Record<string, unknown> {
			const before = panel.length;
			ctl.handlePi(from, payload);
			const want = payload.event === "stripGet" || payload.event === "stripShowScreen" ? "stripState" : "stripEditResult";
			const answer = panel.slice(before).find((p) => typeof p === "object" && p !== null && !Array.isArray(p) && p.event === want) as Record<string, unknown> | undefined;
			assert.ok(answer !== undefined, `answered ${String(payload.event)}`);
			return answer;
		},
		make(patch: Op[]): { groupId: string; rev: number } {
			const made = this.request({ event: "stripCreate", opId: "c", layout: "whole", columns, patch });
			assert.equal(made.ok, true, JSON.stringify(made));
			clock.advance(MIN_FRAME_MS * 3);
			return { groupId: made.groupId as string, rev: made.rev as number };
		},
		edit(groupId: string, baseRev: number, patch: Op[]): number {
			const edited = this.request({ event: "stripEdit", opId: "e", groupId, baseRev, patch });
			assert.equal(edited.ok, true, JSON.stringify(edited));
			clock.advance(MIN_FRAME_MS * 3);
			return edited.rev as number;
		},
		state(): Record<string, unknown> {
			return this.request({ event: "stripGet", requestId: "s" }).group as Record<string, unknown>;
		},
		screenIds(): string[] {
			return (this.state().screens as { screenId: string }[]).map((s) => s.screenId);
		},
		at(): number {
			const g = this.state();
			return this.screenIds().indexOf(g.screen as string);
		},
		turn(column: number, ticks: number, pressed = false): void {
			const ctx = `d${column}`;
			if (pressed) ctl.input(ctx, { kind: "dialDown", column, at: clock.t });
			ctl.input(ctx, { kind: "dialRotate", column, at: clock.t + 1, ticks, pressed });
			if (pressed) ctl.input(ctx, { kind: "dialUp", column, at: clock.t + 2 });
		},
		press(column: number): void {
			ctl.input(`d${column}`, { kind: "dialDown", column, at: clock.t });
			clock.advance(60);
			ctl.input(`d${column}`, { kind: "dialUp", column, at: clock.t });
		},
		writes(): number {
			return dials.reduce((n, d) => n + d.writes.length, 0);
		},
		/** The document the dial at `column` holds now. */
		doc(column: number): Record<string, unknown> {
			return structuredClone(settings.get(`d${column}`) ?? {});
		},
		text(): string {
			return dials.map((d) => d.last).join("\n");
		}
	};
	return r;
}

/** What a frame says in words (its text elements). */
const words = (svg: string): string[] => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1] as string);

describe("screens on the strip: the Screens dial and the wipe", () => {
	it("a turn on the last dial moves one screen, right to left, one slice per frame, and writes nothing", () => {
		const t = rig();
		// A minute of history, so every slice of each screen has its lines.
		t.make([...THREE, set("window", "1m")]);
		for (let s = 0; s < 70; s++) t.tick();
		t.turn(5, 1);
		t.clock.advance(1000);
		t.turn(5, -1);
		t.clock.advance(1000);
		const writes = t.writes();
		const from = t.log.length;
		t.turn(5, 1);
		const frames: string[][] = [];
		for (let step = 0; step < 8; step++) {
			const before = t.log.length;
			t.clock.advance(step === 0 ? 0 : MIN_FRAME_MS);
			frames.push(t.log.slice(before).map((s) => s.context));
		}
		assert.deepEqual(frames.slice(0, 6), [["d5"], ["d4"], ["d3"], ["d2"], ["d1"], ["d0"]]);
		assert.deepEqual(frames.slice(6), [[], []], "nothing more once every slice shows the screen");
		const times = t.log.slice(from).map((s) => s.at);
		for (let i = 1; i < times.length; i++) assert.ok((times[i] as number) - (times[i - 1] as number) >= MIN_FRAME_MS, "frames at least 100 ms apart");
		assert.equal(t.at(), 1);
		assert.ok(t.dials.some((d) => words(d.last).some((w) => w.startsWith("*clock*") && w.endsWith("2 of 3"))), "the name and place in the window words");
		assert.equal(t.writes(), writes, "no settings write");
	});

	it("a turn back sweeps left to right; the ends clamp", () => {
		const t = rig();
		// A minute of history, so every slice of each screen has its lines.
		t.make([...THREE, set("window", "1m")]);
		for (let s = 0; s < 70; s++) t.tick();
		t.turn(5, 1);
		t.clock.advance(2000);
		const order = (): string[] => {
			const before = t.log.length;
			for (let i = 0; i < 8; i++) t.clock.advance(MIN_FRAME_MS);
			return t.log.slice(before).map((s) => s.context);
		};
		t.turn(5, -1);
		assert.deepEqual(order(), ["d0", "d1", "d2", "d3", "d4", "d5"]);
		assert.equal(t.at(), 0);
		t.clock.advance(SCREEN_NAME_MS);
		const before = t.log.length;
		t.turn(5, -3);
		t.clock.advance(1000);
		assert.equal(t.at(), 0, "clamped at the first screen");
		assert.equal(t.log.length, before, "nothing to draw");
		t.turn(5, 9);
		t.clock.advance(1000);
		assert.equal(t.at(), 2, "a fast spin right lands on the last screen");
	});

	it("a turn during a wipe cuts straight to the target, every changed slice in one frame, from the right", () => {
		const t = rig();
		t.make(THREE);
		t.clock.advance(1000);
		t.turn(5, 1);
		t.clock.advance(0);
		t.clock.advance(MIN_FRAME_MS);
		t.turn(5, 1);
		const before = t.log.length;
		t.clock.advance(MIN_FRAME_MS);
		const cut = t.log.slice(before).map((s) => s.context);
		assert.ok(cut.length >= 5, `the cut sends every changed slice at once: ${cut.join(",")}`);
		assert.deepEqual(cut, [...cut].sort((a, b) => Number(b.slice(1)) - Number(a.slice(1))), "in the turn's direction");
		assert.equal(t.at(), 2);
		const after = t.log.length;
		t.clock.advance(MIN_FRAME_MS * 5);
		assert.equal(t.log.length, after, "no wipe after the cut");
		assert.ok(/GPU Temp/.test(t.text()), "the Meters screen shows");
	});

	it("a fast spin builds at most one frame per 100 ms and leaves nothing waiting", () => {
		const t = rig();
		const made = t.make(THREE);
		t.edit(made.groupId, made.rev, [{ op: "addScreen", at: 3 }, { op: "addScreen", at: 4 }, { op: "addScreen", at: 5 }, { op: "addScreen", at: 6 }, { op: "addScreen", at: 7 }]);
		assert.equal(t.screenIds().length, 8);
		t.clock.advance(1000);
		const framesBefore = (t.ctl.diagnostics() as { frames: number }).frames;
		const sendsBefore = t.log.length;
		for (let i = 0; i < 40; i++) {
			t.turn(5, i < 20 ? 1 : -1);
			t.clock.advance(8);
		}
		const spun = (t.ctl.diagnostics() as { frames: number }).frames - framesBefore;
		assert.ok(spun <= 5, `${spun} frames in 320 ms`);
		t.clock.advance(SCREEN_NAME_MS + 1000);
		const settled = (t.ctl.diagnostics() as { frames: number }).frames - framesBefore;
		assert.ok(settled <= spun + 8, `${settled} frames in all`);
		assert.equal(t.at(), 0, "20 right and 20 left: back on the first");
		assert.ok(t.log.length - sendsBefore <= 6 * settled);
		const quiet = t.log.length;
		t.clock.advance(5000);
		assert.equal(t.log.length, quiet, "nothing pending after the spin");
		assert.equal(t.writes(), 6 * 2, "create and the one edit only");
	});

	it("the Screens dial's hints say Screen; one screen leaves every hint as it was", () => {
		const t = rig();
		t.make([set("panes.0.series", [{ key: CPU }])]);
		// A Trend of one reading: the pressed turn is its scale.
		const plain = t.dial(5).triggers.at(-1)?.rotate;
		assert.equal(plain, "Time window · pressed: scale");
		const one = t.dial(5).last;
		assert.equal(/<rect x="[^"]*" y="0" width="[^"]*" height="3"/.test(one), false, "one screen: no position line");
		t.turn(5, 1);
		t.clock.advance(1000);
		assert.equal(t.at(), 0);
		assert.equal((t.state().panes as { window: string }[])[0]?.window, "15m", "one screen: the last dial turns the window");
	});

	it("the + with its last dial missing: the rightmost present dial moves screens", () => {
		const t = rig({ device: "plus", columns: [0, 1, 2] });
		t.make(THREE);
		// Each screen draws one reading: its pressed turn is the scale.
		assert.equal(t.dial(2).triggers.at(-1)?.rotate, "Screen · pressed: scale");
		assert.equal(t.dial(1).triggers.at(-1)?.rotate, "Time window · pressed: scale");
		t.turn(1, 1);
		t.clock.advance(1000);
		assert.equal(t.at(), 0, "dial 2's turn is the window");
		t.turn(2, 1);
		const frames: string[][] = [];
		for (let i = 0; i < 5; i++) {
			const before = t.log.length;
			t.clock.advance(i === 0 ? 0 : MIN_FRAME_MS);
			frames.push(t.log.slice(before).map((s) => s.context));
		}
		assert.deepEqual(frames.slice(0, 3), [["d2"], ["d1"], ["d0"]]);
		assert.equal(t.at(), 1);
	});
});

describe("screens on the strip: what a screen change leaves and keeps", () => {
	it("leaving a screen ends its inspect; each screen keeps its turned window", () => {
		const t = rig();
		t.make(THREE);
		t.turn(1, 1);
		t.clock.advance(300);
		assert.equal((t.state().panes as { window: string }[])[0]?.window, "15m");
		t.press(0);
		t.clock.advance(300);
		assert.equal(t.dial(0).triggers.at(-1)?.push, "Back to live");
		t.turn(5, 1);
		t.clock.advance(1000);
		assert.equal(t.at(), 1);
		assert.equal(t.dial(0).triggers.at(-1)?.push, "Inspect", "the screen arrived at is live");
		assert.equal((t.state().panes as { window: string }[])[0]?.window, "5m", "the second screen shows the saved window");
		t.turn(5, -1);
		t.clock.advance(1000);
		assert.equal((t.state().panes as { window: string }[])[0]?.window, "15m", "the first screen kept its turned window");
	});

	it("history interest follows the screen on view only", () => {
		const t = rig();
		t.make(THREE);
		const own = [...t.interest.entries()].find(([id]) => id.endsWith(":0"));
		assert.deepEqual((own?.[1] as { savedKey: string }[]).map((e) => e.savedKey), [CPU]);
		t.turn(5, 2);
		t.clock.advance(1000);
		const meters = [...t.interest.entries()].find(([id]) => id.endsWith(":0"));
		assert.deepEqual((meters?.[1] as { savedKey: string }[]).map((e) => e.savedKey), [GPU_T, GPU_P]);
	});

	it("the name and place show for 1.6 s, then one more frame gives the window words back", () => {
		const t = rig();
		t.make(THREE);
		t.clock.advance(1000);
		t.turn(5, 2);
		t.clock.advance(SCREEN_NAME_MS - 100);
		assert.ok(/GPU Temp[^<]* \+1 · 3 of 3/.test(t.text()), "the automatic name keeps its +1");
		const before = t.log.length;
		t.clock.advance(300);
		const after = t.log.slice(before);
		assert.ok(!/ of 3/.test(t.text()), "the name is gone");
		assert.ok(after.length >= 1 && after.length <= 2, `only the slices with the words are sent: ${after.map((s) => s.context).join(",")}`);
		assert.ok(/range 5 min/.test(t.text()), "the Meters window words are back");
	});

	it("a hidden screen past its critical limit dashes its segment in the critical color", () => {
		const t = rig();
		const made = t.make(THREE);
		t.edit(made.groupId, made.rev, [set("screens.1.bands", [{ key: GPU_T, crit: 50, below: false }])]);
		t.tick();
		t.clock.advance(300);
		const line = t.dial(5).last;
		assert.ok(/<path d="M\d+ 0h8v3h-8Z/.test(line), "dashes on the last slice (screen 3's segment)");
		assert.equal(/<path d="M\d+ 0h8v3h-8Z/.test(t.dial(0).last), false, "screen 1's segment is whole");
		t.turn(5, 2);
		t.clock.advance(1000);
		assert.equal(/<path d="M\d+ 0h8v3h-8Z/.test(t.dial(5).last), false, "on view, its segment is lit, not dashed");
	});
});

describe("screens on the strip: the automatic cycle", () => {
	const cycling = (seconds: number) => {
		const t = rig();
		const made = t.make(THREE);
		t.edit(made.groupId, made.rev, [set("screenCycle", seconds)]);
		return t;
	};

	it("timed on poll ticks: every 10 s the next screen, wrapping, with the next wipe, writing nothing", () => {
		const t = cycling(10);
		const writes = t.writes();
		const seen: number[] = [];
		for (let s = 0; s < 31; s++) {
			t.tick();
			seen.push(t.at());
		}
		assert.equal(seen[9], 0);
		assert.equal(seen[11], 1);
		assert.equal(seen[21], 2);
		assert.equal(seen[30], 0, "wraps to the first");
		assert.equal(t.writes(), writes);
	});

	it("skips a screen with nothing to draw", () => {
		const t = rig();
		const made = t.make(THREE);
		t.edit(made.groupId, made.rev, [set("screenCycle", 10), set("screens.0.group", { from: "filter", filter: "*nothing here*", keys: [], view: "auto" })]);
		for (let s = 0; s < 12; s++) t.tick();
		assert.equal(t.at(), 2, "screen 2 matched nothing: the cycle went to screen 3");
	});

	it("any strip input restarts the wait; inspect holds it; HWiNFO stopping stops it", () => {
		const t = cycling(10);
		for (let s = 0; s < 8; s++) t.tick();
		t.turn(1, 1);
		for (let s = 0; s < 8; s++) t.tick();
		assert.equal(t.at(), 0, "the turn at 8 s restarted the wait");
		for (let s = 0; s < 3; s++) t.tick();
		assert.equal(t.at(), 1);
		t.press(0);
		for (let s = 0; s < 25; s++) t.tick();
		assert.equal(t.at(), 1, "held while a pane inspects");
		t.press(0);
		for (let s = 0; s < 9; s++) t.tick();
		assert.equal(t.at(), 1, "one full period after back to live");
		for (let s = 0; s < 3; s++) t.tick();
		assert.equal(t.at(), 2);
		for (let s = 0; s < 25; s++) t.gone();
		assert.equal(t.at(), 2, "HWiNFO stopped: the cycle stops");
	});

	it("an open panel of a member holds it and says so; closing it restarts the wait", () => {
		const t = cycling(10);
		t.setPanel("d2");
		for (let s = 0; s < 25; s++) t.tick();
		assert.equal(t.at(), 0);
		assert.equal(t.state().cycleHeld, true);
		t.setPanel(undefined);
		for (let s = 0; s < 9; s++) t.tick();
		assert.equal(t.at(), 0);
		for (let s = 0; s < 3; s++) t.tick();
		assert.equal(t.at(), 1);
		assert.equal(t.state().cycleHeld, false);
	});
});

describe("screens on the strip: Control commands and the panel", () => {
	it("next and previous wrap, first goes home; a one-screen strip counts as reached and stays", () => {
		const t = rig();
		t.make(THREE);
		const send = (command: "stripScreenNext" | "stripScreenPrev" | "stripScreenFirst"): number => {
			const reached = t.ctl.applyControl({ command, target: "", scope: "current" });
			t.clock.advance(1000);
			return reached;
		};
		const writes = t.writes();
		assert.equal(send("stripScreenNext"), 1);
		assert.equal(t.at(), 1);
		send("stripScreenNext");
		send("stripScreenNext");
		assert.equal(t.at(), 0, "next wraps");
		send("stripScreenPrev");
		assert.equal(t.at(), 2, "previous wraps");
		send("stripScreenFirst");
		assert.equal(t.at(), 0);
		assert.equal(t.writes(), writes);
		const one = rig();
		one.make([set("panes.0.series", [{ key: CPU }])]);
		const frames = one.log.length;
		assert.equal(one.ctl.applyControl({ command: "stripScreenNext", target: "", scope: "current" }), 1);
		one.clock.advance(1000);
		assert.equal(one.log.length, frames, "nothing changed");
	});

	it("the state names every screen, the one on view and the cycle; stripShowScreen shows one and writes nothing", () => {
		const t = rig();
		t.make(THREE);
		const g = t.state();
		const screens = g.screens as { screenId: string; name: string; autoName: string; style: string; index: number }[];
		assert.deepEqual(
			screens.map((s) => [s.index, s.name, s.autoName, s.style]),
			[
				[0, "", "CPU Package", "trend"],
				[1, "", "*clock*", "group"],
				[2, "", "GPU Temperature +1", "meters"]
			]
		);
		assert.ok(screens.every((s) => /^[0-9a-f]{8}$/.test(s.screenId)));
		assert.equal(g.screen, screens[0]?.screenId);
		assert.equal(g.screenCycle, null);
		assert.equal(g.cycleHeld, false);
		const writes = t.writes();
		const shown = t.request({ event: "stripShowScreen", screenId: screens[2]?.screenId }).group as Record<string, unknown>;
		assert.equal(shown.screen, screens[2]?.screenId);
		assert.equal((shown.controls as [string, string][])[0]?.[1], "Time window", "the controls of the screen on view (Meters, dial 1)");
		t.clock.advance(1000);
		assert.ok(/GPU/.test(t.text()));
		const unknown = t.request({ event: "stripShowScreen", screenId: "deadbeef" }).group as Record<string, unknown>;
		assert.equal(unknown.screen, screens[2]?.screenId, "an unknown id is ignored and the state goes again");
		assert.equal(t.writes(), writes);
	});

	it("an edit that removes the screen on view falls back to the first; the screen moves with its id", () => {
		const t = rig();
		const made = t.make(THREE);
		const ids = t.screenIds();
		t.turn(5, 1);
		t.clock.advance(1000);
		const rev = t.edit(made.groupId, made.rev, [{ op: "moveScreen", from: 1, to: 2 }]);
		assert.equal(t.state().screen, ids[1], "the view follows the screen");
		assert.equal(t.at(), 2);
		t.edit(made.groupId, rev, [{ op: "removeScreen", at: 2 }]);
		assert.equal(t.at(), 0);
		assert.equal(t.screenIds().length, 2);
	});
});

/** The panel's screen model (ui/pi-strip-model.js), from the bytes the panel loads. */
type ListedScreen = { id: string; index: number; name: string; autoName: string; style: string };
type PanelScreens = {
	screenListOf(config: unknown, reported?: unknown): ListedScreen[];
	screenPaneOf(config: unknown, index: number): unknown;
	screenNameOf(screen: ListedScreen, raw: unknown, ctx?: { readingOf?: (key: string) => unknown; fahrenheit?: boolean }): string;
};
function panelScreens(): PanelScreens {
	return loadPanelModels<PanelScreens>().hwStripModel;
}

describe("screens: a unit screen's automatic name when the strip shows °F", () => {
	it("the strip and its state name it as the panel's screen list does", () => {
		const t = rig();
		// A Whole strip: Ambient over its default rule (every °C reading), °F ticked under Display, a screen added.
		t.make([set("fahrenheit", true), set("panes.0.style", "ambient"), { op: "addScreen", at: 1 }]);
		for (let s = 0; s < 3; s++) t.tick();
		t.turn(5, 1);
		t.clock.advance(SCREEN_NAME_MS + 500);
		// Back to the first screen: its name and place stand in the window words for 1.6 s.
		t.turn(5, -1);
		t.clock.advance(1000);
		const g = t.state();
		const config = g.config as Record<string, unknown>;
		assert.equal(config.fahrenheit, true);
		const reported = g.screens as ListedScreen[];
		// The panel's screen list, named as ui/pi-strip.js screenNames does.
		const m = panelScreens();
		const fahrenheit = config.fahrenheit === true;
		const names = m.screenListOf(config, reported).map((screen) => m.screenNameOf(screen, m.screenPaneOf(config, screen.index), { readingOf: () => null, fahrenheit }));
		const panelName = names[0] as string;
		const said = t.dials.flatMap((d) => words(d.last)).find((w) => w.endsWith("1 of 2"));
		assert.ok(said !== undefined, `the name and place show on the strip: ${t.dials.flatMap((d) => words(d.last)).join(" | ")}`);
		assert.equal(said, `${panelName} · 1 of 2`, "the strip names the screen as the panel's screen list does");
		assert.equal(reported[0]?.autoName, panelName, "the plugin's reported automatic name is the panel's");
	});
});

describe("screens keep their turned scale (40-spec-final.md 5.4)", () => {
	const endsOf = (svg: string): string[] =>
		[...svg.matchAll(/<text x="3" y="([\d.]+)"[^>]*font-size="11"[^>]*>([^<]+)<\/text>/g)]
			.map((m) => ({ y: Number(m[1]), text: m[2] as string }))
			.sort((a, b) => a.y - b.y)
			.map((e) => e.text);

	it("a screen keeps its turned scale while another is on view, and a stored change drops it", () => {
		const t = rig();
		const made = t.make([set("panes.0.series", [{ key: CPU }]), { op: "addScreen", at: 1, from: "copy" }]);
		for (let k = 0; k < 20; k++) t.tick(2000);
		t.clock.advance(1000);
		const auto = endsOf(t.dial(0).last);
		t.turn(1, 1, true);
		t.clock.advance(1000);
		const turned = endsOf(t.dial(0).last);
		assert.notDeepEqual(turned, auto, "the pressed turn widened the scale");
		t.turn(5, 1);
		t.clock.advance(1000);
		assert.equal(t.at(), 1);
		assert.deepEqual(endsOf(t.dial(0).last), auto, "the second screen is on its automatic scale");
		t.turn(5, -1);
		t.clock.advance(1000);
		assert.equal(t.at(), 0);
		assert.deepEqual(endsOf(t.dial(0).last), turned, "the first screen kept its turned scale");
		t.edit(made.groupId, made.rev, [set("panes.0.overlays.unit", false)]);
		t.tick(2000);
		t.clock.advance(1000);
		assert.deepEqual(endsOf(t.dial(0).last), [(auto[0] as string).replace(" °C", ""), auto[1]], "a stored change drops the turn: Auto, the unit box off");
	});
});

describe("screens: a screen moved stays on the strip", () => {
	it("the first screen of a strip never moved to another, moved later and later again, stays on the strip at each new place", () => {
		const t = rig();
		const made = t.make(THREE);
		const ids = t.screenIds();
		assert.equal(t.at(), 0);
		const rev = t.edit(made.groupId, made.rev, [{ op: "moveScreen", from: 0, to: 1 }]);
		assert.equal(t.state().screen, ids[0], "the strip keeps the screen it showed");
		assert.equal(t.at(), 1);
		t.edit(made.groupId, rev, [{ op: "moveScreen", from: 1, to: 2 }]);
		assert.equal(t.state().screen, ids[0]);
		assert.equal(t.at(), 2);
		t.clock.advance(1000);
		assert.ok(/CPU Package/.test(t.text()), "the strip draws it");
	});

	it("an edit of another screen leaves the first screen of a strip never moved on the strip", () => {
		const t = rig();
		const made = t.make(THREE);
		const ids = t.screenIds();
		t.edit(made.groupId, made.rev, [{ op: "moveScreen", from: 1, to: 2 }]);
		assert.equal(t.state().screen, ids[0]);
		assert.equal(t.at(), 0);
	});

	/** A strip of THREE whose stored copies hold no screen ids, as a hand
	 * edit or a copy from elsewhere leaves them: the plugin keys each
	 * screen by its place until an edit gives them ids. */
	const unmintedRig = () => {
		const first = rig();
		first.make(THREE);
		const unminted = (column: number): Record<string, unknown> => {
			const doc = first.doc(column);
			const config = (doc.stripGroup as { config: { panes: Record<string, unknown>[]; screens?: Record<string, unknown>[] } }).config;
			for (const pane of [config.panes[0], ...(config.screens ?? [])]) delete pane?.screenId;
			return doc;
		};
		const t = rig({ stored: unminted });
		t.clock.advance(MIN_FRAME_MS * 3);
		assert.deepEqual(t.screenIds(), ["@0", "@1", "@2"]);
		return t;
	};

	it("a strip stored with no screen ids: the move that gives them ids keeps the moved screen on the strip", () => {
		const t = unmintedRig();
		t.turn(5, 1);
		t.clock.advance(1000);
		t.turn(5, 1);
		t.clock.advance(1000);
		assert.equal(t.at(), 2);
		const g = t.state();
		t.edit(g.id as string, g.rev as number, [{ op: "moveScreen", from: 2, to: 1 }]);
		const ids = t.screenIds();
		assert.ok(ids.every((id) => /^[0-9a-f]{8}$/.test(id)), JSON.stringify(ids));
		assert.equal(t.at(), 1, "the moved screen stays on the strip at its new place");
		t.clock.advance(1000);
		assert.ok(/GPU/.test(t.text()), "the strip draws it");
	});

	it("a strip stored with no screen ids: a first edit that moves nothing keeps the screen on view", () => {
		const t = unmintedRig();
		t.turn(5, 1);
		t.clock.advance(1000);
		assert.equal(t.at(), 1);
		const g = t.state();
		t.edit(g.id as string, g.rev as number, [set("screens.1.name", "Power")]);
		assert.ok(t.screenIds().every((id) => /^[0-9a-f]{8}$/.test(id)));
		assert.equal(t.at(), 1);
	});
});
