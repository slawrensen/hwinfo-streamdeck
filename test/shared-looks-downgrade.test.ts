/**
 * "Use it everywhere" across a downgrade (src/ui/shared-looks.ts with the
 * real Sensor Dial appear and sweep paths, src/actions/sensor-dial.ts, and
 * a real StripController on a fake clock).
 *
 * The path: on 1.8 the person presses Use it everywhere (looksResetGen 1)
 * and every visible dial's own Background and Words go, one write each.
 * They go back to 1.7.1, which knows dialBackground and dialAccentWords
 * but not looksGen, and pick Glass, or Tint with Words in the accent color,
 * on a dial. 1.7.1's panel (sdpi-components) sets the one field on the
 * whole stored document and saves it, so every other field rides along.
 * They upgrade to 1.8 again. That pick was made after the reset, and
 * docs/themes.md says "A choice made after that stays": 1.8 must keep it
 * in storage and draw it, whether the global settings arrive before the
 * dial appears (the appear sweep) or after (the start sweep).
 */
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import type { JsonObject } from "@elgato/utils";

import {
	SensorDialAction,
	type InstanceState,
} from "../src/actions/sensor-dial";
import { deriveCapabilities } from "../src/devices";
import {
	SensorType,
	type Reading,
	type SensorSnapshot,
} from "../src/hwinfo/types";
import { poller, type PollerStatus } from "../src/poller";
import { StripController, type StripHost } from "../src/strip/controller";
import { MIN_FRAME_MS, type SchedulerClock } from "../src/strip/scheduler";
import { setFaceFont } from "../src/ui/face-font";
import { NO_OWN_LOOKS, registerLooksPort } from "../src/ui/shared-looks";
import { applyGlobalThemeSettings } from "../src/ui/theme-store";

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
			for (const entry of this.timers)
				if (
					entry[1].at <= end &&
					(next === undefined || entry[1].at < next[1].at)
				)
					next = entry;
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
	return {
		key,
		type: SensorType.Temperature,
		sensorIndex: 0,
		id: 1,
		label,
		unit: "°C",
		value,
		valueMin: value,
		valueMax: value,
		valueAvg: value,
	};
}

function status(pollTime: number, cpu: number, gpu: number): PollerStatus {
	const readings = [
		reading(CPU, cpu, "CPU Package"),
		reading(GPU, gpu, "GPU Temperature"),
	];
	const snapshot: SensorSnapshot = {
		pollTime,
		valueRevision: pollTime,
		version: 1,
		revision: 1,
		sensors: [{ index: 0, id: 0, instance: 0, name: "Fixture" }],
		readings,
		byKey: new Map(readings.map((r) => [r.key, r])),
	};
	return { state: "ok", snapshot, source: "shared-memory" };
}

const PREFIX = "data:image/svg+xml,";

type Handle = {
	readonly id: string;
	readonly device: { readonly id: string; readonly name: string };
	readonly coordinates: { readonly column: number; readonly row: number };
	readonly faces: string[];
	readonly writes: JsonObject[];
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
		isDial: () => true,
		isKey: () => false,
		setFeedback: (feedback) => {
			h.faces.push(decodeURIComponent(feedback.canvas.slice(PREFIX.length)));
			return Promise.resolve();
		},
		setTriggerDescription: () => Promise.resolve(),
		setSettings: (settings) => {
			h.writes.push(structuredClone(settings));
			return Promise.resolve();
		},
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
	sweepLooks(
		gen: number,
		scope: readonly string[] | undefined,
		render: boolean,
	): void;
};

// One plugin process at a time: the looks port the Sensor Dial action
// registers in its constructor (sensor-dial.ts), pointed at the action of
// the process under test.
let running: DialSeam | undefined;
registerLooksPort({
	count: () => NO_OWN_LOOKS,
	sweep: (gen) => running?.sweepLooks(gen, undefined, true),
});

/** One plugin process: a Sensor Dial action with two dials on a +. */
function plugin(): {
	action: DialSeam;
	handles: Handle[];
	appear(h: Handle, settings: Record<string, unknown>): void;
	stop(): void;
} {
	const current = status(1, 50, 40);
	const mocks = [
		mock.method(poller, "getStatus", () => current),
		mock.method(poller, "retain", () => {}),
		mock.method(poller, "release", () => {}),
		mock.method(performance, "now", () => 100_000),
	];
	const action = Object.create(SensorDialAction.prototype) as DialSeam;
	action.instances = new Map();
	action.hidden = new Map();
	action.traceLifecycle = () => {};
	action.traceGesture = () => {};
	const handles = [0, 1].map((c) => handle(`d${c}`, c));
	Object.defineProperty(action, "actions", {
		get: () => handles.filter((h) => action.instances.has(h.id)),
	});
	const clock = new FakeClock();
	action.stripController = new StripController(action.stripHost(), {
		clock,
		capabilities: {
			get: () => deriveCapabilities({ type: 7, columns: 4, rows: 2 }),
		},
		mintId: () => "0123456789abcdef0123456789abcdef",
	});
	running = action;
	return {
		action,
		handles,
		appear(h, settings) {
			action.onWillAppear({
				action: h,
				payload: { settings, coordinates: h.coordinates },
			});
			clock.advance(MIN_FRAME_MS * 3);
		},
		stop() {
			for (const state of action.instances.values())
				if (state.overlayTimer !== null) clearTimeout(state.overlayTimer);
			action.stripController?.dispose();
			for (const m of mocks) m.mock.restore();
			running = undefined;
		},
	};
}

const BASE = {
	theme: "void",
	typeAccents: "on",
	textMode: "theme",
	textFont: "tahoma",
} as const;
/** The global settings: a shared Nebula, and the reset generation. */
const globals = (looksResetGen?: number): Record<string, unknown> => ({
	...BASE,
	keyBackground: "nebula",
	dialBackground: "nebula",
	...(looksResetGen === undefined ? {} : { looksResetGen }),
});
/** A fresh plugin process holds no shared looks until the global settings arrive. */
const freshProcess = (): void => {
	setFaceFont("tahoma");
	applyGlobalThemeSettings(BASE);
};
afterEach(freshProcess);

/** What 1.7.1's panel picks on each dial after the 1.8 reset. */
const PICKS: readonly Record<string, unknown>[] = [
	{ dialBackground: "glass" },
	{ dialBackground: "tint", dialAccentWords: true },
];

/**
 * The stored documents after the 1.8 reset and the 1.7.1 picks: 1.8 swept
 * each dial (Use it everywhere with both on screen), then 1.7.1's panel set
 * its pick on the whole stored document.
 */
function downgradedDocs(): Record<string, unknown>[] {
	freshProcess();
	const p = plugin();
	try {
		applyGlobalThemeSettings(globals());
		p.appear(p.handles[0] as Handle, {
			readingKey: CPU,
			label: "Dial 0",
			dialBackground: "clear",
		});
		p.appear(p.handles[1] as Handle, {
			readingKey: GPU,
			label: "Dial 1",
			dialBackground: "outline",
			dialAccentWords: false,
		});
		// Use it everywhere.
		applyGlobalThemeSettings(globals(1));
		return p.handles.map((h, i) => {
			const swept = h.writes.at(-1);
			assert.ok(
				swept !== undefined &&
					swept.dialBackground === undefined &&
					swept.dialAccentWords === undefined,
				`1.8 swept ${h.id} at the reset: ${JSON.stringify(swept)}`,
			);
			return { ...(swept as Record<string, unknown>), ...PICKS[i] };
		});
	} finally {
		p.stop();
	}
}

/** The face a dial draws for `doc` under the shared Nebula with no reset ever made. */
function faceWithoutReset(
	column: number,
	doc: Record<string, unknown>,
): string | undefined {
	freshProcess();
	applyGlobalThemeSettings(globals());
	const p = plugin();
	try {
		const h = p.handles[column] as Handle;
		p.appear(h, doc);
		return h.faces.at(-1);
	} finally {
		p.stop();
	}
}

function assertKept(
	p: ReturnType<typeof plugin>,
	faces: readonly (string | undefined)[],
	when: string,
): void {
	for (const [i, h] of p.handles.entries()) {
		const pick = PICKS[i] as Record<string, unknown>;
		const dropped = h.writes.filter((w) =>
			Object.keys(pick).some((k) => w[k] !== pick[k]),
		);
		assert.deepEqual(
			dropped,
			[],
			`${when}: 1.8 wrote ${h.id} without the 1.7.1 pick ${JSON.stringify(pick)}`,
		);
		const stored = p.action.instances.get(h.id)?.settings as
			Record<string, unknown> | undefined;
		for (const [k, v] of Object.entries(pick))
			assert.equal(
				stored?.[k],
				v,
				`${when}: ${h.id} keeps ${k} = ${JSON.stringify(v)}`,
			);
		assert.ok(
			faces[i] !== undefined && faces[i] === h.faces.at(-1),
			`${when}: ${h.id} draws its 1.7.1 pick, not the shared Nebula`,
		);
	}
}

describe("a dial look picked under 1.7.1 after a 1.8 Use it everywhere survives the upgrade back to 1.8", () => {
	it("global settings first, then the dials appear (the appear sweep)", () => {
		const docs = downgradedDocs();
		const faces = docs.map((d, i) => faceWithoutReset(i, d));
		freshProcess();
		const p = plugin();
		try {
			applyGlobalThemeSettings(globals(1));
			for (const [i, h] of p.handles.entries())
				p.appear(h, docs[i] as Record<string, unknown>);
			assertKept(p, faces, "appear sweep");
		} finally {
			p.stop();
		}
	});

	it("the dials appear first, then the global settings arrive (the start sweep)", () => {
		const docs = downgradedDocs();
		const faces = docs.map((d, i) => faceWithoutReset(i, d));
		freshProcess();
		const p = plugin();
		try {
			for (const [i, h] of p.handles.entries())
				p.appear(h, docs[i] as Record<string, unknown>);
			applyGlobalThemeSettings(globals(1));
			assertKept(p, faces, "start sweep");
		} finally {
			p.stop();
		}
	});
});
