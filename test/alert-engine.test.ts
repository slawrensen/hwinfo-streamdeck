/**
 * The alert state machine: parity with 1.7.1's alertLevel at dwell 0 and a
 * recovery band of 0, then dwell, recovery bands, invalid observations,
 * snooze expiry and escalation.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FRESH_TRACK, aggregateShown, isIdle, shown, snooze, stepAlert, unsnooze, type AlertLimits, type AlertTrack } from "../src/alerts/engine";
import { INVALID_OBSERVATION, type AlertObservation } from "../src/alerts/rules";
import { alertLevel } from "../src/ui/format";

const valid = (value: number): AlertObservation => ({ valid: true, value });

/** Runs a sequence of [time, value | null] (null = invalid) and returns
 * every intermediate track. */
function run(limits: AlertLimits, dwellMs: number, steps: ReadonlyArray<readonly [number, number | null]>, start: AlertTrack = FRESH_TRACK): AlertTrack[] {
	const tracks: AlertTrack[] = [];
	let track = start;
	for (const [now, value] of steps) {
		track = stepAlert(track, value === null ? INVALID_OBSERVATION : valid(value), limits, now, dwellMs);
		tracks.push(track);
	}
	return tracks;
}

const shownLevels = (tracks: readonly AlertTrack[]): string[] => tracks.map((track) => shown(track).level);

function lcg(seed: number): () => number {
	let state = seed >>> 0;
	return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

describe("parity with alertLevel at dwell 0 and recovery 0", () => {
	it("equals alertLevel on every observation of random sequences", () => {
		const random = lcg(0xa1e27);
		const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
		const grid = [-40, -1, 0, 0.5, 1, 20, 50, 70, 79.5, 80, 80.5, 90, 100, 1e6];
		let compared = 0;
		for (let runIndex = 0; runIndex < 1500; runIndex++) {
			const warn = random() < 0.2 ? undefined : pick(grid);
			const crit = random() < 0.2 ? undefined : random() < 0.15 && warn !== undefined ? warn : pick(grid);
			const below = random() < 0.5;
			const limits: AlertLimits = { ...(warn !== undefined ? { warn } : {}), ...(crit !== undefined ? { crit } : {}), below, hyst: 0 };
			const near = [warn, crit].filter((v): v is number => v !== undefined).flatMap((v) => [v, v - 1, v + 1, v - 1e-9, v + 1e-9]);
			let track = FRESH_TRACK;
			let now = Math.floor(random() * 1000);
			for (let i = 0; i < 40; i++) {
				now += Math.floor(random() * 3000);
				const roll = random();
				const value = roll < 0.05 ? Number.NaN : roll < 0.08 ? Number.POSITIVE_INFINITY : roll < 0.11 ? Number.NEGATIVE_INFINITY : roll < 0.55 && near.length > 0 ? pick(near) : roll < 0.8 ? pick(grid) : (random() - 0.3) * 200;
				// The engine sees a non-finite value either as the rule path
				// delivers it (invalid) or raw; both must match alertLevel.
				const observation = Number.isFinite(value) || random() < 0.5 ? valid(value) : INVALID_OBSERVATION;
				track = stepAlert(track, observation, limits, now, 0);
				const expected = alertLevel(value, warn, crit, below);
				assert.equal(shown(track).level, expected, `run ${runIndex} step ${i}: ${JSON.stringify(limits)} value ${value}`);
				if (Number.isFinite(value)) assert.equal(track.level, expected);
				assert.equal(shown(track).snoozed, null);
				compared++;
			}
		}
		assert.equal(compared, 60_000);
	});

	it("holds at each limit exactly as alertLevel does (>=, and <= for a low alarm)", () => {
		const high: AlertLimits = { warn: 80, crit: 90, below: false, hyst: 0 };
		assert.deepEqual(shownLevels(run(high, 0, [[0, 79.999], [1, 80], [2, 89.999], [3, 90], [4, 89.999], [5, 79.999]])), ["normal", "warn", "warn", "crit", "warn", "normal"]);
		const low: AlertLimits = { warn: 1000, crit: 500, below: true, hyst: 0 };
		assert.deepEqual(shownLevels(run(low, 0, [[0, 1000.001], [1, 1000], [2, 500.001], [3, 500], [4, 500.001], [5, 1000.001]])), ["normal", "warn", "warn", "crit", "warn", "normal"]);
	});

	it("goes straight to critical on an inverted pair, as alertLevel does", () => {
		const inverted: AlertLimits = { warn: 80, crit: 70, below: false, hyst: 0 };
		assert.deepEqual(shownLevels(run(inverted, 0, [[0, 69], [1, 75], [2, 85], [3, 69]])), ["normal", "crit", "crit", "normal"]);
	});
});

describe("dwell", () => {
	const limits: AlertLimits = { warn: 80, crit: 90, below: false, hyst: 0 };

	it("shows a level only after it has been entered for dwellMs", () => {
		const tracks = run(limits, 5000, [[1000, 85], [5999, 85], [6000, 85]]);
		assert.deepEqual(shownLevels(tracks), ["normal", "normal", "warn"]);
		assert.equal(tracks[0]?.pending.warn, 1000);
		assert.equal(tracks[2]?.pending.warn, undefined);
	});

	it("restarts after a dip below the limit", () => {
		assert.deepEqual(shownLevels(run(limits, 5000, [[0, 85], [3000, 79], [4000, 85], [8999, 85], [9000, 85]])), ["normal", "normal", "normal", "normal", "warn"]);
	});

	it("restarts after an invalid observation", () => {
		const tracks = run(limits, 5000, [[0, 85], [3000, null], [4000, 85], [8999, 85], [9000, 85]]);
		assert.deepEqual(shownLevels(tracks), ["normal", "normal", "normal", "normal", "warn"]);
		assert.deepEqual(tracks[1]?.pending, {});
	});

	it("dwells each level from its own first entry", () => {
		// Above critical at once: warn and critical wait together.
		assert.deepEqual(shownLevels(run(limits, 2000, [[0, 95], [1999, 95], [2000, 95]])), ["normal", "normal", "crit"]);
		// Warn first, critical later: critical waits its own dwell.
		assert.deepEqual(shownLevels(run(limits, 2000, [[0, 85], [2000, 85], [3000, 95], [4999, 95], [5000, 95]])), ["normal", "warn", "warn", "warn", "crit"]);
		// Critical drops back under its limit before its dwell: warn keeps
		// its own earlier entry and shows on time.
		assert.deepEqual(shownLevels(run(limits, 2000, [[0, 95], [1000, 85], [2000, 85]])), ["normal", "normal", "warn"]);
	});

	it("drops a level at once, without a dwell", () => {
		assert.deepEqual(shownLevels(run(limits, 30_000, [[0, 95], [30_000, 95], [30_001, 85], [30_002, 10]])), ["normal", "crit", "warn", "normal"]);
	});

	it("starts again from a fresh track after a restart", () => {
		const before = run(limits, 5000, [[0, 85], [5000, 85]]);
		assert.equal(shown(before[1]!).level, "warn");
		// A new process has no track: the same reading waits again.
		assert.deepEqual(shownLevels(run(limits, 5000, [[10, 85], [5009, 85], [5010, 85]])), ["normal", "normal", "warn"]);
	});

	it("treats a negative or non-finite dwell as 0", () => {
		assert.equal(shown(run(limits, -5, [[0, 85]])[0]!).level, "warn");
		assert.equal(shown(run(limits, Number.NaN, [[0, 85]])[0]!).level, "warn");
	});
});

describe("recovery band", () => {
	it("holds a high alarm down to limit minus the band, inclusive", () => {
		const limits: AlertLimits = { warn: 80, below: false, hyst: 5 };
		assert.deepEqual(shownLevels(run(limits, 0, [[0, 79.9], [1, 80], [2, 76], [3, 75], [4, 74.999], [5, 79]])), ["normal", "warn", "warn", "warn", "normal", "normal"]);
	});

	it("holds a low alarm up to limit plus the band, inclusive", () => {
		const limits: AlertLimits = { warn: 20, below: true, hyst: 3 };
		assert.deepEqual(shownLevels(run(limits, 0, [[0, 20.1], [1, 20], [2, 23], [3, 23.001], [4, 21]])), ["normal", "warn", "warn", "normal", "normal"]);
	});

	it("steps critical down to warn, then to normal, each by its own band", () => {
		const limits: AlertLimits = { warn: 80, crit: 90, below: false, hyst: 5 };
		assert.deepEqual(shownLevels(run(limits, 0, [[0, 90], [1, 85], [2, 84.999], [3, 75], [4, 74.999]])), ["crit", "crit", "warn", "warn", "normal"]);
	});

	it("never widens entry: a level is entered only at its limit", () => {
		const limits: AlertLimits = { warn: 80, crit: 90, below: false, hyst: 5 };
		assert.deepEqual(shownLevels(run(limits, 0, [[0, 86], [1, 89.999]])), ["warn", "warn"]);
	});

	it("treats a negative or non-finite band as 0", () => {
		for (const hyst of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
			assert.deepEqual(shownLevels(run({ warn: 80, below: false, hyst }, 0, [[0, 80], [1, 79.999]])), ["warn", "normal"], String(hyst));
		}
	});
});

describe("invalid observations", () => {
	const limits: AlertLimits = { warn: 80, crit: 90, below: false, hyst: 0 };

	it("show nothing but keep the latched level", () => {
		const tracks = run(limits, 0, [[0, 95], [1, null], [2, null]]);
		assert.deepEqual(shownLevels(tracks), ["crit", "normal", "normal"]);
		assert.equal(tracks[2]?.level, "crit");
		assert.equal(tracks[2]?.afterGap, true);
	});

	it("resume a level that still holds without a new dwell", () => {
		assert.deepEqual(shownLevels(run(limits, 30_000, [[0, 95], [30_000, 95], [31_000, null], [32_000, 95]])), ["normal", "crit", "normal", "crit"]);
		// Only the warn band still holds: warn, at once.
		assert.deepEqual(shownLevels(run(limits, 30_000, [[0, 95], [30_000, 95], [31_000, null], [32_000, 85]])), ["normal", "crit", "normal", "warn"]);
	});

	it("never start a new alarm: a level not yet latched needs its dwell after the gap", () => {
		assert.deepEqual(shownLevels(run(limits, 5000, [[0, 85], [5000, 85], [5500, null], [6000, 95], [10_999, 95], [11_000, 95]])), ["normal", "warn", "normal", "warn", "warn", "crit"]);
	});

	it("clear a track that held only a pending entry", () => {
		const tracks = run(limits, 5000, [[0, 85], [1000, null]]);
		assert.equal(isIdle(tracks[1]!), true);
	});
});

describe("snooze", () => {
	const limits: AlertLimits = { warn: 80, crit: 90, below: false, hyst: 0 };
	const warned = run(limits, 0, [[0, 85]])[0]!;

	it("silences the current level and names it", () => {
		const snoozed = snooze(warned, 100, 60_000);
		assert.deepEqual(shown(snoozed), { level: "normal", snoozed: "warn" });
		assert.deepEqual(snoozed.snooze, { level: "warn", until: 60_100 });
	});

	it("is a no-op at normal, after an invalid observation, or for a bad length", () => {
		assert.equal(snooze(FRESH_TRACK, 0, 60_000), FRESH_TRACK);
		const gap = stepAlert(warned, INVALID_OBSERVATION, limits, 10, 0);
		assert.equal(snooze(gap, 20, 60_000), gap);
		for (const ms of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(snooze(warned, 20, ms), warned);
	});

	it("ends on recovery", () => {
		const tracks = run(limits, 0, [[1000, 85], [2000, 70], [3000, 85]], snooze(warned, 100, 60_000));
		assert.deepEqual(tracks.map(shown), [
			{ level: "normal", snoozed: "warn" },
			{ level: "normal", snoozed: null },
			{ level: "warn", snoozed: null }
		]);
	});

	it("ends at its end time only on a valid observation", () => {
		const tracks = run(limits, 0, [[59_000, 85], [61_000, null], [70_000, null], [71_000, 85]], snooze(warned, 0, 60_000));
		assert.deepEqual(tracks.map(shown), [
			{ level: "normal", snoozed: "warn" },
			{ level: "normal", snoozed: null },
			{ level: "normal", snoozed: null },
			{ level: "warn", snoozed: null }
		]);
		// Kept through the invalid observations, past its end time.
		assert.deepEqual(tracks[2]?.snooze, { level: "warn", until: 60_000 });
		assert.equal(tracks[3]?.snooze, null);
	});

	it("ends at exactly its end time", () => {
		const start = snooze(warned, 0, 60_000);
		assert.deepEqual(shown(stepAlert(start, valid(85), limits, 59_999, 0)), { level: "normal", snoozed: "warn" });
		assert.deepEqual(shown(stepAlert(start, valid(85), limits, 60_000, 0)), { level: "warn", snoozed: null });
	});

	it("gives way to escalation, after the higher level's dwell", () => {
		const start = snooze(run(limits, 2000, [[0, 85], [2000, 85]])[1]!, 2000, 3_600_000);
		const tracks = run(limits, 2000, [[3000, 95], [4999, 95], [5000, 95]], start);
		assert.deepEqual(tracks.map(shown), [
			{ level: "normal", snoozed: "warn" },
			{ level: "normal", snoozed: "warn" },
			{ level: "crit", snoozed: null }
		]);
	});

	it("keeps silencing a lower level under a critical snooze", () => {
		const critical = run(limits, 0, [[0, 95]])[0]!;
		const tracks = run(limits, 0, [[1000, 85], [2000, 95]], snooze(critical, 0, 60_000));
		assert.deepEqual(tracks.map(shown), [
			{ level: "normal", snoozed: "warn" },
			{ level: "normal", snoozed: "crit" }
		]);
	});

	it("ends at once on unsnooze", () => {
		const snoozed = snooze(warned, 0, 60_000);
		assert.deepEqual(shown(unsnooze(snoozed)), { level: "warn", snoozed: null });
		assert.equal(unsnooze(warned), warned);
	});
});

describe("aggregateShown", () => {
	it("takes the highest shown level and the highest silenced level", () => {
		assert.deepEqual(aggregateShown([]), { level: "normal", snoozed: null });
		assert.deepEqual(
			aggregateShown([
				{ level: "warn", snoozed: null },
				{ level: "normal", snoozed: "crit" },
				{ level: "normal", snoozed: "warn" }
			]),
			{ level: "warn", snoozed: "crit" }
		);
		assert.deepEqual(
			aggregateShown([
				{ level: "crit", snoozed: null },
				{ level: "warn", snoozed: null }
			]),
			{ level: "crit", snoozed: null }
		);
	});
});
