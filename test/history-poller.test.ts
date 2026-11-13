/**
 * The poller feeds the history store at the designed plug points: once per
 * tick, after the staleness decision, at the tick's single monotonic time.
 * Each test drives its own poller instance with a canned provider and a
 * hand-moved monotonic clock; ticks are called directly, no timers.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import type { HistoryStore } from "../src/history/store";
import { HwinfoError, SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import { BUSY_RETRIES, BUSY_RETRY_MS, poller } from "../src/poller";
import { renderDialTwoRow } from "../src/ui/dial-renderer";
import { KEY_TREND_WIDTH_PX, renderReadingKey } from "../src/ui/key-renderer";
import { loadThemes, resolvePalette } from "../src/ui/themes";

const KEY = "a1:0:7";

type Provider = { source: "shared-memory" | "gadget"; read(): SensorSnapshot | null; close(): void };
type Subject = Pick<typeof poller, "getStatus" | "setIntervalMs" | "setSourceMode" | "setReadingLinks" | "noteWake" | "subscribeSeries" | "getSeries"> & {
	readonly history: HistoryStore;
	openProvider(): Provider;
	tick(polling?: boolean): void;
	stop(): void;
	on(event: "tick", listener: () => void): void;
};

function reading(value: number, over: Partial<Reading> = {}): Reading {
	return { key: KEY, type: SensorType.Temperature, sensorIndex: 0, id: 7, label: "CPU", unit: "°C", value, valueMin: value, valueMax: value, valueAvg: value, ...over };
}

function snapshot(pollTime: number, readings: Reading[], over: Partial<SensorSnapshot> = {}): SensorSnapshot {
	return { pollTime, version: 1, revision: 1, sensors: [{ index: 0, id: 0xa1, instance: 0, name: "CPU" }], readings, byKey: new Map(readings.map((r) => [r.key, r])), ...over };
}

let mono = 0;
let clock: ReturnType<typeof mock.method> | null = null;
beforeEach(() => {
	mono = 100_000;
	clock = mock.method(performance, "now", () => mono);
});
afterEach(() => {
	clock?.mock.restore();
	clock = null;
});

/** A fresh poller whose provider serves `next()` and whose history
 * watches KEY over one minute. */
function fixture(next: () => SensorSnapshot | null, source: Provider["source"] = "shared-memory"): Subject {
	const subject = new (poller.constructor as unknown as { new (): Subject })();
	subject.openProvider = () => ({ source, read: next, close() {} });
	subject.history.setInterest("probe", [{ savedKey: KEY, window: "1m" }]);
	return subject;
}

/** Ticks once at `at` (monotonic ms). */
function tickAt(subject: Subject, at: number): void {
	mono = at;
	subject.tick();
}

function viewOf(subject: Subject, now = mono) {
	const view = subject.history.view(KEY, "1m", 60, now);
	assert.ok(view);
	return view;
}

describe("poller feeds history after the staleness decision", () => {
	it("each fresh ok tick adds one sample at the tick's own monotonic time", () => {
		let pollTime = 10;
		let value = 40;
		const subject = fixture(() => snapshot(++pollTime, [reading(++value)]));
		for (const at of [100_000, 101_000, 102_000]) tickAt(subject, at);
		const view = viewOf(subject, 102_500);
		assert.deepEqual([...view.cols.x], [57, 58, 59]);
		assert.deepEqual([...view.cols.last], [41, 42, 43]);
		assert.equal(view.segments.length, 1);
	});

	it("a frozen producer adds nothing and its run ends at the last sample when it goes stale", () => {
		let pollTime = 10;
		let frozen = false;
		const subject = fixture(() => snapshot(frozen ? pollTime : ++pollTime, [reading(40)]));
		tickAt(subject, 100_000);
		tickAt(subject, 101_000);
		frozen = true;
		const revision = subject.history.revision;
		for (let at = 102_000; at <= 116_000; at += 1000) tickAt(subject, at);
		assert.equal(subject.getStatus().state, "ok");
		assert.equal(subject.history.revision, revision, "held ticks are not samples");
		tickAt(subject, 117_000);
		assert.equal(subject.getStatus().state, "stale");
		const view = viewOf(subject, 117_000);
		assert.equal(view.cols.n, 2);
		assert.equal(view.segments[0]?.endReason, "stale");
		assert.equal(view.segments[0]?.x1, (101_000 - (117_000 - 60_000)) / 1000, "the run ends at 101 s, not at the 117 s detection");
	});

	it("a stamp already older than the stale window at first sight publishes stale and records nothing", () => {
		const subject = fixture(() => snapshot(Math.floor(Date.now() / 1000) - 3600, [reading(40)]));
		tickAt(subject, 100_000);
		assert.equal(subject.getStatus().state, "stale");
		assert.equal(viewOf(subject).cols.n, 0);
	});

	it("a skipped read ends the run", () => {
		let pollTime = 10;
		let skip = false;
		const subject = fixture(() => (skip ? null : snapshot(++pollTime, [reading(40)])));
		tickAt(subject, 100_000);
		skip = true;
		tickAt(subject, 101_000);
		skip = false;
		tickAt(subject, 102_000);
		assert.deepEqual(viewOf(subject).segments.map((s) => s.endReason ?? null), ["skipped", null]);
	});

	it("a polling read still busy after every retry ends the run", () => {
		let pollTime = 10;
		let skip = false;
		const subject = fixture(() => (skip ? null : snapshot(++pollTime, [reading(40)])));
		tickAt(subject, 100_000);
		skip = true;
		for (let i = 0; i <= BUSY_RETRIES; i++) {
			mono = 101_000 + i * BUSY_RETRY_MS;
			subject.tick(true);
		}
		skip = false;
		tickAt(subject, 102_000);
		assert.deepEqual(viewOf(subject).segments.map((s) => s.endReason ?? null), ["skipped", null]);
	});

	it("a busy read that clears on a retry keeps the run, and publishes one tick at the retry's own time", async () => {
		let pollTime = 10;
		let busy = 0;
		const subject = fixture(() => (busy-- > 0 ? null : snapshot(pollTime += 2, [reading(40)])));
		const ticks: number[] = [];
		subject.on("tick", () => ticks.push(mono));
		tickAt(subject, 100_000);
		busy = 1;
		mono = 101_000;
		subject.tick(true);
		assert.deepEqual(ticks, [100_000], "the busy read publishes nothing yet");
		mono = 101_025;
		await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_MS * 3));
		assert.deepEqual(ticks, [100_000, 101_025], "the retry publishes the tick");
		const view = viewOf(subject, 101_025);
		assert.deepEqual(view.segments.map((s) => s.endReason ?? null), [null], "no cut");
		assert.equal(view.cols.n, 2);
	});

	it("a retry never outlives the poller, and a regular tick replaces a pending one", async () => {
		let reads = 0;
		const subject = fixture(() => {
			reads++;
			return null;
		});
		mono = 100_000;
		subject.tick(true);
		mono = 100_001;
		subject.tick(true);
		assert.equal(reads, 2);
		subject.stop();
		await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_MS * 3));
		assert.equal(reads, 2, "stop cleared the retry");
	});

	it("a direct tick is judged at once: a page return's caller reads the status right after it", () => {
		let reads = 0;
		const subject = fixture(() => {
			reads++;
			return null;
		});
		const ticks: number[] = [];
		subject.on("tick", () => ticks.push(mono));
		tickAt(subject, 100_000);
		assert.equal(reads, 1);
		assert.equal(ticks.length, 1, "no retry is pending");
	});

	it("a Gadget source never retries: only the shared memory mutex can be busy", () => {
		let reads = 0;
		const subject = fixture(() => {
			reads++;
			return null;
		}, "gadget");
		subject.setSourceMode("gadget");
		const ticks: number[] = [];
		subject.on("tick", () => ticks.push(mono));
		mono = 100_000;
		subject.tick(true);
		assert.equal(reads, 1);
		assert.equal(ticks.length, 1);
	});

	it("a thrown read ends the run even while the status rides on held values", () => {
		let pollTime = 10;
		let busy = false;
		const subject = fixture(() => {
			if (busy) throw new HwinfoError("busy", "synthetic contention");
			return snapshot(++pollTime, [reading(40)]);
		});
		tickAt(subject, 100_000);
		busy = true;
		tickAt(subject, 101_000);
		assert.equal(subject.getStatus().state, "ok", "the transient hold keeps the face");
		busy = false;
		tickAt(subject, 102_000);
		assert.deepEqual(viewOf(subject).segments.map((s) => s.endReason ?? null), ["unavailable", null]);
	});

	it("a tick gap (machine sleep) ends the run; the wake event after it keeps the post-wake run", () => {
		let pollTime = 10;
		const subject = fixture(() => snapshot(++pollTime, [reading(40 + pollTime)]));
		tickAt(subject, 100_000);
		// The overdue tick on resume, then the app's wake event.
		tickAt(subject, 100_000 + 3_600_000);
		const after = subject.history.view(KEY, "1m", 60, 100_000 + 30_000);
		assert.equal(after?.segments[0]?.endReason, "sleep");
		tickAt(subject, 100_000 + 3_601_000);
		subject.noteWake();
		tickAt(subject, 100_000 + 3_602_000);
		const view = viewOf(subject, mono + 500);
		assert.deepEqual(view.segments.map((s) => [s.open, s.endReason ?? null]), [[true, null]], "no pen-up inside the post-wake run");
		assert.equal(view.cols.n, 3, "the first post-wake sample stays in that run");
	});

	it("the wake event ends the run when no tick gap did", () => {
		let pollTime = 10;
		const subject = fixture(() => snapshot(++pollTime, [reading(40 + pollTime)]));
		tickAt(subject, 100_000);
		tickAt(subject, 101_000);
		mono = 101_500;
		subject.noteWake();
		tickAt(subject, 102_000);
		const view = viewOf(subject);
		assert.deepEqual(view.segments.map((s) => s.endReason ?? null), ["sleep", null]);
		assert.equal(view.segments[0]?.x1, (101_000 - (102_000 - 60_000)) / 1000, "the run ends at its last sample");
	});

	it("a page flip (stop, restart at once) keeps the run; a stop longer than the tick gap ends it as stopped", () => {
		let pollTime = 10;
		const subject = fixture(() => snapshot(++pollTime, [reading(40)]));
		tickAt(subject, 100_000);
		mono = 100_200;
		subject.stop();
		tickAt(subject, 100_205);
		assert.equal(viewOf(subject).segments.length, 1);
		mono = 101_000;
		subject.stop();
		tickAt(subject, 120_000);
		assert.deepEqual(viewOf(subject).segments.map((s) => s.endReason ?? null), ["stopped", null]);
	});

	it("an interval change keeps history and moves the tick-gap threshold; the legacy ring still empties", () => {
		let pollTime = 10;
		const subject = fixture(() => snapshot(++pollTime, [reading(40 + pollTime)]));
		subject.subscribeSeries(KEY);
		tickAt(subject, 100_000);
		subject.setIntervalMs(5000);
		assert.deepEqual(subject.getSeries(KEY), [], "1.7.1 contract: the index-spaced ring cannot span a cadence change");
		tickAt(subject, 110_000);
		const view = viewOf(subject);
		assert.equal(view.segments.length, 1, "10 s is inside 3 x 5 s");
		assert.equal(view.cols.n, 2, "the cadence change emptied nothing");
	});

	it("moving Read every from 5 s to 1 s late in a cycle keeps the run (the timer restarts without ticking)", () => {
		let pollTime = 10;
		const subject = fixture(() => snapshot(++pollTime, [reading(40 + pollTime)]));
		subject.setIntervalMs(5000);
		for (let at = 100_000; at <= 130_000; at += 5000) tickAt(subject, at);
		mono = 134_900;
		subject.setIntervalMs(1000);
		tickAt(subject, 135_900);
		tickAt(subject, 136_900);
		const view = viewOf(subject, 137_000);
		assert.deepEqual(view.segments.map((s) => s.endReason ?? null), [null], "5.9 s after the last 5 s tick is still the same run");
		assert.equal(view.cols.n, 9);
	});

	it("a stamp-only sample keeps the stamp's age beside it; a value change between reads is live", () => {
		const wall = 1_800_000_000_000;
		const now = mock.method(Date, "now", () => wall);
		try {
			let revision = 1;
			let value = 40;
			const stamp = wall / 1000 - 12;
			const subject = fixture(() => snapshot(stamp, [reading(value)], { valueRevision: revision }));
			tickAt(subject, 100_000);
			assert.equal(subject.getStatus().state, "ok", "12 s is inside the stale window");
			assert.equal(subject.history.evidenceAgeOf(KEY), 12_000, "first seen 12 s after HWiNFO wrote it");
			assert.deepEqual([...viewOf(subject, 100_500).cols.x], [59], "placed at the tick, not 12 s back");
			revision++;
			value++;
			tickAt(subject, 101_000);
			assert.equal(subject.history.evidenceAgeOf(KEY), 0, "a value seen changing between two reads is evidence of now");
		} finally {
			now.mock.restore();
		}
	});

	/** Ten one-second ticks while the wall clock moves by `jumps` (tick index
	 * to extra milliseconds); HWiNFO stamps each write from the wall clock,
	 * and one write lands just before a jump, so that read carries a
	 * pre-jump stamp. Every window is retained. */
	function wallClockRun(jumps: ReadonlyMap<number, number>): Subject {
		let wall = 1_800_000_000_000;
		const now = mock.method(Date, "now", () => wall);
		try {
			let value = 40;
			let lagged = false;
			let stamp = Math.floor(wall / 1000);
			const subject = fixture(() => snapshot(lagged ? stamp + 1 : (stamp = Math.floor(wall / 1000)), [reading((value += 1 + (value % 3)))]));
			subject.history.setInterest("all-windows", [{ savedKey: KEY, window: ["1m", "5m", "15m"] }]);
			for (let i = 0; i < 10; i++) {
				const jump = jumps.get(i) ?? 0;
				wall += 1000 + jump;
				lagged = jump !== 0;
				tickAt(subject, 100_000 + i * 1000);
			}
			return subject;
		} finally {
			now.mock.restore();
		}
	}
	const HOUR_JUMPS: ReadonlyMap<number, number> = new Map([[3, 3_600_000], [7, -3_600_000]]);

	it("a wall clock jump of an hour either way moves no point", () => {
		const steady = viewOf(wallClockRun(new Map()), 110_000);
		const jumped = viewOf(wallClockRun(HOUR_JUMPS), 110_000);
		assert.equal(jumped.segments.length, 1);
		assert.deepEqual([...jumped.cols.x], [...steady.cols.x]);
		assert.deepEqual([...jumped.cols.last], [...steady.cols.last]);
	});

	it("and the key and two-row dial faces drawn from it are the same bytes in every window", () => {
		const steady = wallClockRun(new Map());
		const jumped = wallClockRun(HOUR_JUMPS);
		const palette = resolvePalette(loadThemes(), "void", null, "normal");
		for (const window of ["1m", "5m", "15m"] as const) {
			const key = (s: Subject) => renderReadingKey({ label: "CPU", valueText: "50", unitText: "°C", statBadge: "", palette, timeline: s.history.view(KEY, window, KEY_TREND_WIDTH_PX, 110_000) });
			const dial = (s: Subject) => renderDialTwoRow({ rows: [{ label: "CPU", valueText: "50", unitText: "°C", selected: true, valueColor: "#FFFFFF", timeline: (w) => s.history.view(KEY, window, w, 110_000) }], footerText: "", palette });
			assert.match(key(jumped), /<path d="M[^"]*" fill="none" stroke=/, `${window}: the key draws its window`);
			assert.equal(key(jumped), key(steady), `${window}: key face`);
			assert.match(dial(jumped), /<path d="M[^"]*" fill="none" stroke=/, `${window}: the dial row draws its window`);
			assert.equal(dial(jumped), dial(steady), `${window}: dial face`);
		}
	});

	it("a pairing change ends a re-bound run at once and adds no sample", () => {
		const alias = "g:CPU:Temp";
		let pollTime = 10;
		const subject = new (poller.constructor as unknown as { new (): Subject })();
		subject.openProvider = () => ({ source: "shared-memory", read: () => snapshot(++pollTime, [reading(40)]), close() {} });
		subject.history.setInterest("probe", [{ savedKey: alias, window: "1m" }]);
		subject.setReadingLinks([{ sharedMemory: KEY, gadget: alias, unit: "°C", sensorType: SensorType.Temperature }]);
		tickAt(subject, 100_000);
		tickAt(subject, 101_000);
		const revision = subject.history.revision;
		subject.setReadingLinks([]);
		assert.equal(subject.history.revision, revision + 1, "one close, no sample");
		const view = subject.history.view(alias, "1m", 60, 102_000);
		assert.equal(view?.cols.n, 2);
		assert.equal(view?.segments[0]?.endReason, "missing");
	});

	it("a cold Gadget source (no change seen yet) records nothing", () => {
		const subject = fixture(() => snapshot(0, [reading(40)], { freshnessRevision: 0 }), "gadget");
		subject.setSourceMode("gadget");
		tickAt(subject, 100_000);
		tickAt(subject, 101_000);
		assert.equal(subject.getStatus().state, "stale");
		assert.equal(viewOf(subject).cols.n, 0);
	});

	it("a Gadget scan that moved any row records every row, an unchanged one included", () => {
		const other = { ...reading(1), key: "g:CPU:Load", id: 8 };
		let revision = 1;
		let load = 1;
		// Two changes inside one second share a Gadget stamp: only the scan
		// revision says the unchanged row was read again.
		const subject = fixture(() => snapshot(1000, [reading(40), { ...other, value: load }], { freshnessRevision: revision }), "gadget");
		subject.setSourceMode("gadget");
		tickAt(subject, 100_000);
		revision++;
		load++;
		tickAt(subject, 101_000);
		tickAt(subject, 102_000);
		assert.deepEqual([...viewOf(subject).cols.last], [40, 40], "two scans with changes, one without");
	});

	it("a poisoned-session reopen over identical bytes adds no sample", () => {
		let invalid = false;
		let opened = 0;
		const subject = new (poller.constructor as unknown as { new (): Subject })();
		subject.history.setInterest("probe", [{ savedKey: KEY, window: "1m" }]);
		subject.openProvider = () => {
			const generation = ++opened;
			return { source: "shared-memory", close() {}, read: () => {
				if (generation === 1 && invalid) throw new HwinfoError("invalid", "synthetic layout reopen");
				return snapshot(700, [reading(40)], { valueRevision: 1, freshnessRevision: 0 });
			} };
		};
		tickAt(subject, 100_000);
		const revision = subject.history.revision;
		invalid = true;
		tickAt(subject, 101_000);
		assert.equal(opened, 2);
		assert.equal(subject.history.revision, revision);
		assert.equal(viewOf(subject).cols.n, 1);
	});
});
