/**
 * The Sensor Dial's hand-over to the strip (src/actions/sensor-dial.ts with
 * a real StripController on a fake clock): a joined member draws only its
 * slice and never writes on appear, replays, ticks or input; autocycle and
 * the existing Control commands skip it; leaving brings back the dial's own
 * face byte for byte (after the one session-reset hint) and its own
 * settings untouched.
 */
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import streamDeck from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { SensorDialAction, type InstanceState } from "../src/actions/sensor-dial";
import { alertStore } from "../src/alerts/store";
import type { DialControlCommand } from "../src/commands";
import { deriveCapabilities } from "../src/devices";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import { poller, type PollerStatus } from "../src/poller";
import { StripController, type StripHost } from "../src/strip/controller";
import { MIN_FRAME_MS, type SchedulerClock } from "../src/strip/scheduler";
import { stripGroupOf } from "../src/strip/settings";

class FakeClock implements SchedulerClock {
	t = 5_000_000;
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

const CPU = "s:1:0:7";
const GPU = "s:2:0:9";

function reading(key: string, value: number, label: string): Reading {
	return { key, type: SensorType.Temperature, sensorIndex: 0, id: 1, label, unit: "°C", value, valueMin: value, valueMax: value, valueAvg: value };
}

function status(pollTime: number, cpu: number, gpu: number): PollerStatus {
	const readings = [reading(CPU, cpu, "CPU Package"), reading(GPU, gpu, "GPU Temperature")];
	const snapshot: SensorSnapshot = { pollTime, valueRevision: pollTime, version: 1, revision: 1, sensors: [{ index: 0, id: 0, instance: 0, name: "Fixture" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) };
	return { state: "ok", snapshot, source: "shared-memory" };
}

const PREFIX = "data:image/svg+xml,";

type Handle = {
	readonly id: string;
	readonly device: { readonly id: string; readonly name: string };
	readonly coordinates: { readonly column: number; readonly row: number };
	readonly faces: string[];
	readonly writes: JsonObject[];
	readonly hints: unknown[];
	isDial(): boolean;
	isKey(): boolean;
	setFeedback(feedback: { canvas: string }): Promise<void>;
	setTriggerDescription(descriptions?: unknown): Promise<void>;
	setSettings(settings: JsonObject): Promise<void>;
};

function handle(id: string, column: number): Handle {
	const h: Handle = {
		id,
		device: { id: "devA", name: "Fixture +" },
		coordinates: { column, row: 0 },
		faces: [],
		writes: [],
		hints: [],
		isDial: () => true,
		isKey: () => false,
		setFeedback: (feedback) => {
			h.faces.push(decodeURIComponent(feedback.canvas.slice(PREFIX.length)));
			return Promise.resolve();
		},
		setTriggerDescription: (descriptions) => {
			h.hints.push(descriptions);
			return Promise.resolve();
		},
		setSettings: (settings) => {
			h.writes.push(structuredClone(settings));
			return Promise.resolve();
		}
	};
	return h;
}

type Ev = { action: Handle; payload: Record<string, unknown> };
type DialSeam = {
	instances: Map<string, InstanceState>;
	hidden: Map<string, unknown>;
	stripController: StripController | undefined;
	stripHost(): StripHost;
	traceLifecycle(): void;
	traceGesture(): void;
	onWillAppear(ev: Ev): void;
	onWillDisappear(ev: Ev): void;
	deviceDisconnected(deviceId: string): void;
	deviceConnected(deviceId: string): void;
	onDidReceiveSettings(ev: Ev): void;
	onDialRotate(ev: Ev): Promise<void>;
	onDialDown(ev: Ev): Promise<void>;
	onDialUp(ev: Ev): Promise<void>;
	onTouchTap(ev: Ev): Promise<void>;
	onSendToPlugin(ev: Ev): void;
	onPollerTick(status: PollerStatus): void;
	applyControlCommand(command: DialControlCommand): number;
};

function own(column: number): Record<string, unknown> {
	return { readingKey: column % 2 === 0 ? CPU : GPU, label: `Dial ${column}`, rotationKeys: [CPU, GPU], warnValue: "80", autoCycleMs: "1000", dialBackground: "tint" };
}

function fixture(): { action: DialSeam; handles: Handle[]; clock: FakeClock; tick(cpu: number, gpu: number): void; mono: { t: number }; restore(): void } {
	const mono = { t: 100_000 };
	let current = status(1, 50, 40);
	let poll = 1;
	const mocks = [
		mock.method(poller, "getStatus", () => current),
		mock.method(poller, "retain", () => {}),
		mock.method(poller, "release", () => {}),
		mock.method(performance, "now", () => mono.t)
	];
	const action = Object.create(SensorDialAction.prototype) as DialSeam;
	action.instances = new Map();
	action.hidden = new Map();
	action.traceLifecycle = () => {};
	action.traceGesture = () => {};
	const handles = [0, 1, 2, 3].map((c) => handle(`d${c}`, c));
	Object.defineProperty(action, "actions", { get: () => handles.filter((h) => action.instances.has(h.id)) });
	const clock = new FakeClock();
	action.stripController = new StripController(action.stripHost(), { clock, capabilities: { get: () => deriveCapabilities({ type: 7, columns: 4, rows: 2 }) }, mintId: () => "0123456789abcdef0123456789abcdef" });
	return {
		action,
		handles,
		clock,
		mono,
		tick(cpu: number, gpu: number) {
			poll++;
			mono.t += 1000;
			clock.advance(1000);
			current = status(poll, cpu, gpu);
			action.onPollerTick(current);
			action.stripController?.onTick(current);
			clock.advance(MIN_FRAME_MS * 3);
		},
		restore() {
			for (const state of action.instances.values()) if (state.overlayTimer !== null) clearTimeout(state.overlayTimer);
			action.stripController?.dispose();
			for (const m of mocks) m.mock.restore();
		}
	};
}

function appear(f: ReturnType<typeof fixture>, h: Handle, settings: Record<string, unknown>): void {
	f.action.onWillAppear({ action: h, payload: { settings, coordinates: h.coordinates } });
}

function withoutStrip(doc: Record<string, unknown> | undefined): Record<string, unknown> {
	const { stripGroup: _drop, ...rest } = doc ?? {};
	void _drop;
	return rest;
}

describe("a deck reconnects without replaying appearances", () => {
	function joined(): ReturnType<typeof fixture> {
		const f = fixture();
		for (const [c, h] of f.handles.entries()) appear(f, h, own(c));
		f.action.onSendToPlugin({ action: f.handles[0] as Handle, payload: { event: "stripCreate", opId: "c1", layout: "whole" } });
		f.clock.advance(MIN_FRAME_MS * 3);
		return f;
	}
	const writes = (f: ReturnType<typeof fixture>): number => f.handles.reduce((n, h) => n + h.writes.length, 0);

	it("every slice draws again and keeps drawing, with no settings write and no extra retain", () => {
		const f = joined();
		try {
			const before = writes(f);
			const retains = (poller.retain as unknown as { mock: { callCount(): number } }).mock.callCount();
			f.action.deviceDisconnected("devA");
			f.clock.advance(MIN_FRAME_MS * 3);
			const offline = f.handles.map((h) => h.faces.length);
			f.tick(55, 45);
			assert.deepEqual(f.handles.map((h) => h.faces.length), offline, "nothing draws while the deck is away");
			f.action.deviceConnected("devA");
			f.clock.advance(MIN_FRAME_MS * 3);
			const resumed = f.handles.map((h) => h.faces.length);
			assert.ok(f.handles.every((h, i) => h.faces.length > (offline[i] as number)), "every slice resumed");
			f.tick(70, 60);
			assert.ok(f.handles.some((h, i) => h.faces.length > (resumed[i] as number)), "new data draws");
			assert.equal(writes(f), before, "no write");
			assert.equal((poller.retain as unknown as { mock: { callCount(): number } }).mock.callCount(), retains, "no retain");
			assert.ok(f.handles.every((h) => f.action.instances.get(h.id)?.stripJoined === true), "still joined");
		} finally {
			f.restore();
		}
	});

	it("a dial whose document no longer joins the strip takes its own face back", () => {
		const f = joined();
		try {
			f.action.deviceDisconnected("devA");
			const d2 = f.handles[2] as Handle;
			f.action.onDidReceiveSettings({ action: d2, payload: { settings: withoutStrip(f.action.instances.get("d2")?.settings) } });
			f.action.deviceConnected("devA");
			f.clock.advance(MIN_FRAME_MS * 3);
			assert.equal(f.action.instances.get("d2")?.stripJoined, false);
			assert.match(d2.faces.at(-1) ?? "", /Dial 2/, "its own face");
			const rest = [f.handles[0], f.handles[1], f.handles[3]] as Handle[];
			assert.ok(rest.every((h) => f.action.instances.get(h.id)?.stripJoined === true), "the others stay joined");
		} finally {
			f.restore();
		}
	});

	it("an independent dial repaints once, because the touchscreen cache can come back cold, and writes nothing", () => {
		const f = fixture();
		try {
			for (const [c, h] of f.handles.entries()) appear(f, h, own(c));
			f.tick(50, 40);
			const before = f.handles.map((h) => h.faces.length);
			f.action.deviceDisconnected("devA");
			f.action.deviceConnected("devA");
			assert.deepEqual(f.handles.map((h, i) => h.faces.length - (before[i] as number)), [1, 1, 1, 1]);
			assert.equal(writes(f), 0);
		} finally {
			f.restore();
		}
	});

	it("another deck's connect restores nothing here", () => {
		const f = joined();
		try {
			f.action.deviceDisconnected("devA");
			f.action.deviceConnected("devB");
			f.clock.advance(MIN_FRAME_MS * 3);
			const offline = f.handles.map((h) => h.faces.length);
			f.tick(55, 45);
			assert.deepEqual(f.handles.map((h) => h.faces.length), offline);
		} finally {
			f.restore();
		}
	});

	/** The info lines the action logs while `run` runs. */
	function infoLines(run: () => void): string[] {
		const lines: string[] = [];
		const info = mock.method(streamDeck.logger, "info", (line: unknown) => {
			lines.push(String(line));
			return streamDeck.logger;
		});
		try {
			run();
		} finally {
			info.mock.restore();
		}
		return lines;
	}

	it("a deck's first connect after its appearances, as at every plugin start, restores nothing and logs nothing", () => {
		const f = fixture();
		try {
			for (const [c, h] of f.handles.entries()) appear(f, h, own(c));
			f.tick(50, 40);
			const before = f.handles.map((h) => h.faces.length);
			const lines = infoLines(() => f.action.deviceConnected("devA"));
			f.clock.advance(MIN_FRAME_MS * 3);
			assert.deepEqual(f.handles.map((h, i) => h.faces.length - (before[i] as number)), [0, 0, 0, 0], "no dial drew again");
			assert.deepEqual(lines, [], "no Restored line");
			assert.equal(writes(f), 0);
		} finally {
			f.restore();
		}
	});

	it("a deck that disconnected and connects again restores its dials and says so once", () => {
		const f = fixture();
		try {
			for (const [c, h] of f.handles.entries()) appear(f, h, own(c));
			f.tick(50, 40);
			f.action.deviceConnected("devA");
			const before = f.handles.map((h) => h.faces.length);
			f.action.deviceDisconnected("devA");
			const lines = infoLines(() => f.action.deviceConnected("devA"));
			assert.deepEqual(f.handles.map((h, i) => h.faces.length - (before[i] as number)), [1, 1, 1, 1], "every dial repainted");
			assert.deepEqual(lines, ["Restored 4 dials after their deck reconnected"]);
		} finally {
			f.restore();
		}
	});

	it("a later connect with no disconnect heard before it still restores, in case the app missed one", () => {
		const f = fixture();
		try {
			for (const [c, h] of f.handles.entries()) appear(f, h, own(c));
			f.tick(50, 40);
			f.action.deviceConnected("devA");
			const before = f.handles.map((h) => h.faces.length);
			const lines = infoLines(() => f.action.deviceConnected("devA"));
			assert.deepEqual(f.handles.map((h, i) => h.faces.length - (before[i] as number)), [1, 1, 1, 1], "every dial repainted");
			assert.deepEqual(lines, ["Restored 4 dials after their deck reconnected"]);
			assert.equal(writes(f), 0);
		} finally {
			f.restore();
		}
	});

	it("a press held across the disconnect does not misroute the next inputs", async () => {
		const f = fixture();
		try {
			for (const [c, h] of f.handles.entries()) appear(f, h, own(c));
			const d1 = f.handles[1] as Handle;
			await f.action.onDialDown({ action: d1, payload: { coordinates: d1.coordinates } });
			assert.notEqual(f.action.instances.get("d1")?.gesture.downAt, null);
			f.action.deviceDisconnected("devA");
			f.action.deviceConnected("devA");
			assert.equal(f.action.instances.get("d1")?.gesture.downAt, null);
		} finally {
			f.restore();
		}
	});
});

describe("Sensor Dial hand-over to the strip", () => {
	it("a dial that leaves draws its own face again byte for byte, with its own settings untouched", () => {
		const f = fixture();
		try {
			for (const [c, h] of f.handles.entries()) appear(f, h, own(c));
			f.tick(50, 40);
			const independent = f.handles.map((h) => h.faces.at(-1));
			assert.ok(independent.every((face) => typeof face === "string" && face.includes("Dial ")), "each dial drew its own face");
			const original = structuredClone(f.action.instances.get("d2")?.settings) as Record<string, unknown>;
			f.action.onSendToPlugin({ action: f.handles[0] as Handle, payload: { event: "stripCreate", opId: "c1", layout: "whole" } });
			f.clock.advance(MIN_FRAME_MS * 3);
			for (const h of f.handles) assert.equal(stripGroupOf(h.writes.at(-1)?.stripGroup)?.joined, true, h.id);
			const sliceOf = (h: Handle): string | undefined => h.faces.at(-1);
			assert.ok(f.handles.every((h) => !(sliceOf(h) ?? "").includes(`Dial ${h.coordinates.column}`)), "joined dials draw strip slices");
			// Data moves: only the strip paints; autocycle never fires.
			f.tick(51, 41);
			f.tick(52, 42);
			f.tick(50, 40);
			assert.ok(f.handles.every((h) => !h.faces.some((face, i) => i >= 2 && face.includes(`Dial ${h.coordinates.column}`))), "no individual face while joined");
			assert.equal(f.action.instances.get("d2")?.settings.readingKey, CPU, "autocycle left the saved reading alone");
			assert.equal(f.action.instances.get("d1")?.settings.readingKey, GPU);
			// Leave from dial 3's panel.
			f.action.onSendToPlugin({ action: f.handles[2] as Handle, payload: { event: "stripLeave", opId: "l1", groupId: "0123456789abcdef0123456789abcdef" } });
			const d2 = f.handles[2] as Handle;
			assert.deepEqual(withoutStrip(d2.writes.at(-1)), withoutStrip(original), "its own settings, byte for byte");
			assert.equal(stripGroupOf(d2.writes.at(-1)?.stripGroup)?.joined, false);
			assert.match(d2.faces.at(-1) ?? "", /stats reset: left the strip/, "the session-reset hint says why, once");
			assert.doesNotMatch(d2.faces.at(-1) ?? "", /data gap/, "no data gap happened");
			// The hint ends: the face is the one it drew before joining.
			f.mono.t += 2000;
			f.action.onPollerTick(status(99, 50, 40));
			assert.equal(d2.faces.at(-1), independent[2], "the individual face, byte for byte");
			// The dials still in the strip name the gap it left.
			f.clock.advance(MIN_FRAME_MS * 3);
			const rest = [f.handles[0], f.handles[1], f.handles[3]] as Handle[];
			assert.match(rest.map((h) => h.faces.at(-1) ?? "").join("\n"), /Dial 3 left the strip/);
		} finally {
			f.restore();
		}
	});

	it("joined dials never write on appear, replays, ticks, theme or input, and the existing Control commands skip them", async () => {
		const f = fixture();
		try {
			for (const [c, h] of f.handles.entries()) appear(f, h, own(c));
			f.action.onSendToPlugin({ action: f.handles[0] as Handle, payload: { event: "stripCreate", opId: "c1", layout: "split" } });
			f.clock.advance(MIN_FRAME_MS * 3);
			const writes = (): number => f.handles.reduce((n, h) => n + h.writes.length, 0);
			const created = writes();
			assert.equal(created, 4);
			// A replayed appear and a page swap.
			for (const h of f.handles) appear(f, h, f.action.instances.get(h.id)?.settings as Record<string, unknown>);
			for (const h of f.handles) f.action.onWillDisappear({ action: h, payload: { coordinates: h.coordinates } });
			for (const h of f.handles) appear(f, h, (f.action.hidden as Map<string, { state: InstanceState }>).get(h.id)?.state.settings as Record<string, unknown>);
			for (let i = 0; i < 5; i++) f.tick(50 + i, 40 + i);
			const d1 = f.handles[1] as Handle;
			await f.action.onDialRotate({ action: d1, payload: { coordinates: d1.coordinates, ticks: 1, pressed: false } });
			await f.action.onDialDown({ action: d1, payload: { coordinates: d1.coordinates } });
			await f.action.onDialUp({ action: d1, payload: { coordinates: d1.coordinates } });
			await f.action.onTouchTap({ action: d1, payload: { coordinates: d1.coordinates, tapPos: [20, 50], hold: false } });
			f.clock.advance(MIN_FRAME_MS * 3);
			assert.equal(writes(), created, "no write");
			for (const command of ["next", "prev", "cycleStat", "pauseCycle", "pin", "resetStats"] as const) {
				assert.equal(f.action.applyControlCommand({ command, target: "", scope: "all" }), 0, `${command} skips joined dials`);
			}
			assert.equal(f.action.applyControlCommand({ command: "stripToggleInspect", target: "", scope: "current" }), 1, "the strip command reaches the group");
			assert.equal(writes(), created);
			// A threshold edit from the panel of a joined dial keeps the strip
			// copy in the document it writes.
			const doc = { ...(f.action.instances.get("d3")?.settings as Record<string, unknown>), warnValue: "85" };
			f.action.onDidReceiveSettings({ action: f.handles[3] as Handle, payload: { settings: doc } });
			const written = (f.handles[3] as Handle).writes.at(-1);
			assert.equal(written?.warnValue, "85");
			assert.equal(stripGroupOf(written?.stripGroup)?.joined, true, "the strip copy rides along");
		} finally {
			f.restore();
		}
	});

	it("a joined dial's own alerts stop stepping, snooze skips it, and its first step after leaving takes a gap", () => {
		const f = fixture();
		// Whole-context gaps only: each step also gaps the readings it did
		// not find (with the stepped ones excepted).
		const gaps: string[] = [];
		const original = alertStore.gap.bind(alertStore);
		const gap = mock.method(alertStore, "gap", (context: string, except?: ReadonlySet<string>) => {
			if (except === undefined) gaps.push(context);
			original(context, except);
		});
		try {
			for (const [c, h] of f.handles.entries()) appear(f, h, own(c));
			// CPU 90 is past Warn at 80: the CPU dials alert on their own.
			f.tick(90, 40);
			const d0 = f.action.instances.get("d0") as InstanceState;
			// Read through a call, so the asserts below do not narrow it.
			const shown = (): InstanceState["alertShown"] => d0.alertShown;
			assert.equal(shown()?.get(CPU)?.level, "warn", "an independent dial steps its alert");
			f.action.onSendToPlugin({ action: f.handles[0] as Handle, payload: { event: "stripCreate", opId: "c1", layout: "whole" } });
			f.clock.advance(MIN_FRAME_MS * 3);
			assert.equal(shown(), undefined, "the last step is dropped on joining, so the panel reports no frozen level");
			for (let i = 0; i < 8; i++) f.tick(95, 40);
			assert.equal(shown(), undefined, "no step while joined");
			assert.equal(f.action.applyControlCommand({ command: "snoozeAlerts", target: "", scope: "current" }), 0, "snooze skips joined dials");
			assert.equal(f.action.applyControlCommand({ command: "unsnoozeAlerts", target: "", scope: "current" }), 0, "so does ending a snooze");
			assert.ok(
				f.handles.every((h) => !h.faces.some((face, i) => i >= 2 && face.includes(`Dial ${h.coordinates.column}`))),
				"no individual face (and so no alert track or snoozed band) while joined"
			);
			assert.deepEqual(gaps, [], "nothing stepped, so nothing gapped");
			f.action.onSendToPlugin({ action: f.handles[0] as Handle, payload: { event: "stripLeave", opId: "l1", groupId: "0123456789abcdef0123456789abcdef" } });
			assert.deepEqual(gaps, ["d0"], "the time it spent joined is a gap for its alerts");
			assert.equal(shown()?.get(CPU)?.level, "warn", "then it steps the live value again");
		} finally {
			gap.mock.restore();
			f.restore();
		}
	});

	it("an independent dial next to a strip keeps its own path", () => {
		const f = fixture();
		try {
			for (const [c, h] of f.handles.entries()) appear(f, h, own(c));
			f.action.onSendToPlugin({ action: f.handles[0] as Handle, payload: { event: "stripCreate", opId: "c1", layout: "whole", columns: [0, 1, 2] } });
			f.clock.advance(MIN_FRAME_MS * 3);
			const d3 = f.handles[3] as Handle;
			assert.equal(d3.writes.length, 0);
			assert.equal(f.action.applyControlCommand({ command: "cycleStat", target: "", scope: "current" }), 1, "only the independent dial is reached");
			assert.match(d3.faces.at(-1) ?? "", /Dial 3/);
		} finally {
			f.restore();
		}
	});
});
