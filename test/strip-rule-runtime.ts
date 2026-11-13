/**
 * A strip runtime on a simulated Stream Deck + XL for the rule styles'
 * tests: a real StripController and HistoryStore over
 * a synthetic HWiNFO list, fake dial handles, and a fake clock. Not a test
 * file itself.
 */
import type { JsonValue } from "@elgato/utils";

import { deriveCapabilities } from "../src/devices";
import { HistoryStore, type HistoryStoreOptions } from "../src/history/store";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import type { PollerStatus } from "../src/poller";
import { StripController, type StripDialHandle, type StripHost } from "../src/strip/controller";
import { MIN_FRAME_MS, type SchedulerClock } from "../src/strip/scheduler";

export type Spec = { sensor: string; label: string; unit: string; value: number; type?: SensorType; machine?: string };

/** A snapshot: readings in the order given, one sensor per distinct name. */
export function snap(specs: readonly Spec[], extra: Partial<SensorSnapshot> = {}): SensorSnapshot {
	const sensors: { index: number; id: number; instance: number; name: string; machine?: string }[] = [];
	const readings: Reading[] = specs.map((s, i) => {
		let index = sensors.findIndex((x) => x.name === s.sensor);
		if (index < 0) {
			index = sensors.length;
			sensors.push({ index, id: 0xf0 + index, instance: 0, name: s.sensor, ...(s.machine === undefined ? {} : { machine: s.machine }) });
		}
		const key = `${(0xf0 + index).toString(16)}:0:${(0x100 + i).toString(16)}`;
		return { key, type: s.type ?? SensorType.Clock, sensorIndex: index, id: 0x100 + i, label: s.label, unit: s.unit, value: s.value, valueMin: s.value, valueMax: s.value, valueAvg: s.value, ...(s.machine === undefined ? {} : { machine: s.machine }) };
	});
	return { pollTime: 1, version: 1, revision: 1, sensors, readings, byKey: new Map(readings.map((r) => [r.key, r])), ...extra };
}

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

class Dial implements StripDialHandle {
	readonly feedback: string[] = [];
	readonly triggers: ({ rotate?: string; push?: string; touch?: string; longTouch?: string } | undefined)[] = [];
	readonly device = { id: "devX" };
	readonly coordinates: { column: number; row: number };
	constructor(
		readonly id: string,
		column: number
	) {
		this.coordinates = { column, row: 0 };
	}
	setFeedback(f: { canvas: string }): Promise<void> {
		this.feedback.push(decodeURIComponent(f.canvas.slice("data:image/svg+xml,".length)));
		return Promise.resolve();
	}
	setTriggerDescription(d?: { rotate?: string; push?: string; touch?: string; longTouch?: string }): Promise<void> {
		this.triggers.push(d);
		return Promise.resolve();
	}
	setSettings(): Promise<void> {
		return Promise.resolve();
	}
}

export type RuleRuntime = ReturnType<typeof build>;

/** The runtime over `specs` (values can move with setSpecs). */
export function ruleRuntime(initial: Spec[], storeOptions: HistoryStoreOptions = {}): RuleRuntime {
	return build(initial, storeOptions);
}

function build(initial: Spec[], storeOptions: HistoryStoreOptions) {
	let specs = initial;
	const clock = new FakeClock();
	const settings = new Map<string, Record<string, unknown>>();
	const interest = new Map<string, { entries: unknown; pool?: string }>();
	const history = new HistoryStore({ now: () => clock.t, ...storeOptions });
	let status: PollerStatus = { state: "ok", snapshot: snap(specs), source: "shared-memory" };
	const panel: JsonValue[] = [];
	const host: StripHost = {
		settingsOf: (c) => settings.get(c),
		stored: (c, d) => settings.set(c, d),
		claimChanged: () => {},
		status: () => status,
		history: {
			setInterest: (id, entries, options) => {
				interest.set(id, { entries, ...(options?.pool === undefined ? {} : { pool: options.pool }) });
				history.setInterest(id, entries, options);
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
		panelContext: () => undefined,
		sendToPanel: (p) => panel.push(p)
	};
	const ctl = new StripController(host, { clock, capabilities: { get: () => deriveCapabilities({ type: 13, columns: 9, rows: 4 }) }, mintId: () => "0123456789abcdef0123456789abcdef" });
	const dials = Array.from({ length: 6 }, (_, c) => new Dial(`x${c}`, c));
	const first = status.state === "ok" ? (status.snapshot.readings[0] as Reading).key : "";
	for (const d of dials) {
		settings.set(d.id, { readingKey: first });
		ctl.appear(d, { readingKey: first });
	}
	let poll = 1;
	return {
		clock,
		ctl,
		dials,
		interest,
		history,
		settings,
		/** One poll with new producer evidence, `ms` after the last. */
		tick(ms = 2000): void {
			poll++;
			clock.advance(ms);
			const s = snap(specs, { pollTime: poll, valueRevision: poll });
			history.ingest({ kind: "ok", at: clock.t, snapshot: s, source: "shared-memory", evidence: true, stampAdvanced: true, evidenceAgeMs: 0 });
			status = { state: "ok", snapshot: s, source: "shared-memory" };
			ctl.onTick(status);
		},
		/** The source goes stale (HWiNFO stopped writing). */
		stale(ms = 2000): void {
			clock.advance(ms);
			history.ingest({ kind: "stale", at: clock.t });
			if (status.state !== "unavailable") status = { state: "stale", snapshot: status.snapshot, source: "shared-memory", staleForMs: ms };
			ctl.onTick(status);
		},
		setSpecs(next: Spec[]): void {
			specs = next;
		},
		flush(): void {
			clock.advance(MIN_FRAME_MS * 3);
		},
		request(payload: Record<string, unknown>): Record<string, unknown> {
			const before = panel.length;
			ctl.handlePi("x0", payload);
			return panel.slice(before).find((p) => typeof p === "object" && p !== null && !Array.isArray(p) && p.event === (payload.event === "stripGet" ? "stripState" : "stripEditResult")) as Record<string, unknown>;
		},
		/** A strip over all six dials with `patch` applied at create. */
		make(patch: readonly { op: "set"; path: string; value: unknown }[]): string {
			const made = this.request({ event: "stripCreate", opId: "c", layout: "whole", patch });
			if (made?.ok !== true) throw new Error(JSON.stringify(made));
			this.flush();
			return made.groupId as string;
		},
		turn(column: number, ticks: number, pressed = false): void {
			if (pressed) ctl.input(`x${column}`, { kind: "dialDown", column, at: clock.t });
			ctl.input(`x${column}`, { kind: "dialRotate", column, at: clock.t + 1, ticks, pressed });
			if (pressed) ctl.input(`x${column}`, { kind: "dialUp", column, at: clock.t + 2 });
			clock.advance(MIN_FRAME_MS * 3);
		},
		press(column: number, long = false): void {
			ctl.input(`x${column}`, { kind: "dialDown", column, at: clock.t });
			clock.advance(long ? 900 : 60);
			ctl.input(`x${column}`, { kind: "dialUp", column, at: clock.t });
			clock.advance(MIN_FRAME_MS * 3);
		},
		tap(column: number, x: number, y: number, hold = false): void {
			ctl.input(`x${column}`, { kind: "touchTap", column, at: clock.t, hold, tapPos: [x, y] });
			clock.advance(MIN_FRAME_MS * 3);
		},
		frame(): string {
			return dials.map((d) => d.feedback.at(-1) ?? "").join("\n");
		},
		slices(): string[] {
			return dials.map((d) => d.feedback.at(-1) ?? "");
		}
	};
}
