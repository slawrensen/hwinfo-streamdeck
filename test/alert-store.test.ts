/**
 * The in-memory alert store: tracks per action context, measurement identity
 * and set of limits, the tick contract (step, then prune), the hidden window
 * and its marks, the caps, the repaint epoch, and resets on a rule edit.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Reading } from "../src/hwinfo/types";
import { INVALID_OBSERVATION, alertFlags, alertObservation, parseAlertConfig, ruleFor, type AlertConfig, type AlertObservation, type ResolvedRule } from "../src/alerts/rules";
import { AlertStore, HIDDEN_TTL_MS, MAX_CONTEXTS, MAX_HIDDEN, MAX_MEASUREMENTS, STRAY_SLACK, alertIdentityOf } from "../src/alerts/store";
import type { ShownAlert } from "../src/alerts/types";
import { alertLevel } from "../src/ui/format";

const valid = (value: number): AlertObservation => ({ valid: true, value });

function rule(warn: number, crit?: number, hyst = 0): ResolvedRule {
	return { source: "reading", ruleKey: "k", warn, ...(crit !== undefined ? { crit } : {}), below: false, unit: { kind: "captured", unit: "°C" }, hyst };
}

const LEGACY_80: ResolvedRule = { source: "legacy", warn: 80, below: false, unit: { kind: "legacy" }, hyst: 0 };

type TestReading = Pick<Reading, "key" | "aliasOf" | "linkedKeys" | "unit" | "value">;

/** One reading through the path an action takes: resolve, observe, step. */
function stepReading(store: AlertStore, context: string, config: AlertConfig, kind: "key" | "dial", reading: TestReading, slot: number, now: number): ShownAlert {
	const resolved = ruleFor(config, kind, reading, slot);
	return store.step(context, alertIdentityOf(reading), resolved, alertObservation(resolved, reading, false, true), now, config.dwellMs);
}

describe("AlertStore stepping", () => {
	it("files a confirmed alias under its provider's key", () => {
		assert.equal(alertIdentityOf({ key: "1:0:a" }), "1:0:a");
		assert.equal(alertIdentityOf({ key: "g2:abc", aliasOf: "1:0:a" }), "1:0:a");
		const store = new AlertStore();
		store.step("a", alertIdentityOf({ key: "g2:abc", aliasOf: "1:0:a" }), rule(80), valid(85), 0, 0);
		assert.equal(store.shownFor("a", alertIdentityOf({ key: "1:0:a" })).level, "warn");
	});

	it("keeps one track per context and identity", () => {
		const store = new AlertStore();
		assert.deepEqual(store.step("a", "cpu", rule(80), valid(85), 0, 0), { level: "warn", snoozed: null });
		assert.deepEqual(store.step("b", "cpu", rule(80), valid(70), 0, 0), { level: "normal", snoozed: null });
		assert.deepEqual(store.shownFor("a", "cpu"), { level: "warn", snoozed: null });
		assert.deepEqual(store.shownFor("b", "cpu"), { level: "normal", snoozed: null });
		assert.deepEqual(store.shownFor("a", "gpu"), { level: "normal", snoozed: null });
	});

	it("holds only tracks that carry state", () => {
		const store = new AlertStore();
		store.step("a", "cpu", rule(80), valid(70), 0, 0);
		assert.deepEqual(store.size(), { contexts: 0, tracks: 0, hidden: 0 });
		store.step("a", "cpu", rule(80), valid(85), 0, 5000);
		assert.equal(store.has("a", "cpu"), true, "a pending dwell is state");
		store.step("a", "cpu", rule(80), valid(70), 100, 5000);
		assert.deepEqual(store.size(), { contexts: 0, tracks: 0, hidden: 0 });
	});

	it("dwells across ticks and restarts after a gap", () => {
		const store = new AlertStore();
		assert.equal(store.step("a", "cpu", rule(80), valid(85), 0, 2000).level, "normal");
		store.gap("a");
		assert.equal(store.step("a", "cpu", rule(80), valid(85), 2000, 2000).level, "normal");
		assert.equal(store.step("a", "cpu", rule(80), valid(85), 4000, 2000).level, "warn");
	});

	it("a gap shows nothing, keeps the latched level, and spares the identities named", () => {
		const store = new AlertStore();
		store.step("a", "cpu", rule(80), valid(85), 0, 0);
		store.step("a", "gpu", rule(80), valid(85), 0, 0);
		store.gap("a", new Set(["gpu"]));
		assert.equal(store.shownFor("a", "cpu").level, "normal");
		assert.equal(store.shownFor("a", "gpu").level, "warn");
		// Valid data again: the latched level resumes without a dwell.
		assert.equal(store.step("a", "cpu", rule(80), valid(85), 1000, 30_000).level, "warn");
	});

	it("a rule that moves filing with the same comparison key keeps its track; another key, no key, or a track stepped this tick does not move", () => {
		const SAME = "same";
		const moved = new AlertStore();
		moved.step("a", "cpu", LEGACY_80, valid(85), 0, 0, SAME);
		moved.snoozeContext("a", 0, 60_000);
		moved.prune("a", new Set(["cpu"]));
		assert.deepEqual(moved.step("a", "cpu", rule(80), valid(85), 1000, 0, SAME), { level: "normal", snoozed: "warn" }, "moved with its snooze");
		moved.prune("a", new Set(["cpu"]));
		assert.equal(moved.size().tracks, 1);
		for (const alike of ["other", undefined]) {
			const store = new AlertStore();
			store.step("a", "cpu", LEGACY_80, valid(85), 0, 0, SAME);
			store.snoozeContext("a", 0, 60_000);
			store.prune("a", new Set(["cpu"]));
			assert.deepEqual(store.step("a", "cpu", rule(80), valid(85), 1000, 0, alike), { level: "warn", snoozed: null }, `fresh with key ${String(alike)}`);
			store.prune("a", new Set(["cpu"]));
			assert.equal(store.size().tracks, 1, "the old filing's track is dropped at the prune");
		}
		// Two spellings that resolve to different filings in one tick keep
		// one track each: the one stepped this generation is not taken.
		const both = new AlertStore();
		both.step("a", "cpu", LEGACY_80, valid(85), 0, 0, SAME);
		both.snoozeContext("a", 0, 60_000);
		both.step("a", "cpu", rule(80), valid(85), 0, 0, SAME);
		assert.equal(both.size().tracks, 2);
	});

	it("a null rule shows nothing and drops the measurement's tracks at the next prune", () => {
		const store = new AlertStore();
		store.step("a", "cpu", rule(80), valid(85), 0, 0);
		store.prune("a", new Set(["cpu"]));
		const epoch = store.epoch;
		assert.deepEqual(store.step("a", "cpu", null, INVALID_OBSERVATION, 1, 0), { level: "normal", snoozed: null });
		assert.equal(store.has("a", "cpu"), true, "not at once: another spelling may still step it this tick");
		store.prune("a", new Set(["cpu"]));
		assert.equal(store.has("a", "cpu"), false);
		assert.ok(store.epoch > epoch, "the dropped alert repaints");
	});
});

describe("AlertStore resets", () => {
	it("starts a track fresh when its rule changes", () => {
		const store = new AlertStore();
		store.step("a", "cpu", rule(80), valid(85), 0, 0);
		store.snoozeContext("a", 0, 60_000);
		assert.equal(store.shownFor("a", "cpu").snoozed, "warn");
		// An edit of the limits: the snooze and the latched level go.
		assert.deepEqual(store.step("a", "cpu", rule(82), valid(85), 1000, 0), { level: "warn", snoozed: null });
		// With a dwell the edited rule waits again from now.
		store.step("a", "cpu", rule(80), valid(85), 2000, 0);
		assert.equal(store.step("a", "cpu", rule(80, undefined, 2), valid(85), 3000, 5000).level, "normal");
	});

	it("keeps tracks when only the dwell changes", () => {
		const store = new AlertStore();
		store.step("a", "cpu", rule(80), valid(85), 0, 0);
		store.snoozeContext("a", 0, 60_000);
		assert.equal(store.step("a", "cpu", rule(80), valid(85), 1000, 30_000).snoozed, "warn");
	});

	it("resolved rules from equal settings keep the track", () => {
		const store = new AlertStore();
		const settings = { alertRules: { cpu: { warn: "80", unit: "°C" } } };
		const reading = { key: "cpu", unit: "°C", value: 85 };
		const first = ruleFor(parseAlertConfig(settings), "dial", reading, 0);
		store.step("a", "cpu", first, valid(85), 0, 0);
		store.snoozeContext("a", 0, 60_000);
		// A settings echo parses to a new object with the same meaning.
		const echoed = ruleFor(parseAlertConfig(JSON.parse(JSON.stringify(settings)) as typeof settings), "dial", reading, 0);
		assert.equal(store.step("a", "cpu", echoed, valid(85), 1000, 0).snoozed, "warn");
	});

	it("reset clears one identity or the whole context", () => {
		const store = new AlertStore();
		store.step("a", "cpu", rule(80), valid(85), 0, 0);
		store.step("a", "gpu", rule(80), valid(85), 0, 0);
		store.reset("a", "cpu");
		assert.equal(store.has("a", "cpu"), false);
		assert.equal(store.has("a", "gpu"), true);
		store.reset("a");
		assert.deepEqual(store.size(), { contexts: 0, tracks: 0, hidden: 0 });
	});

	it("prune with no slack drops identities the action no longer references", () => {
		const store = new AlertStore();
		for (const id of ["cpu", "gpu", "fan"]) store.step("a", id, rule(80), valid(85), 0, 0);
		store.prune("a", new Set(["gpu"]), 0);
		assert.deepEqual(["cpu", "gpu", "fan"].map((id) => store.has("a", id)), [false, true, false]);
	});

	it("prune keeps strays within the slack in a gap, and drops the least recently stepped first", () => {
		const store = new AlertStore();
		store.step("a", "cpu", rule(80), valid(85), 0, 0);
		store.step("a", "fan", rule(80), valid(85), 0, 0);
		store.step("a", "gpu", rule(80), valid(85), 0, 0);
		store.step("a", "cpu", rule(80), valid(85), 1, 0);
		store.prune("a", new Set(["gpu"]), 1);
		// fan was stepped longest ago; cpu stays as a stray that shows nothing.
		assert.deepEqual(["cpu", "gpu", "fan"].map((id) => store.has("a", id)), [true, true, false]);
		assert.deepEqual(store.shownFor("a", "cpu"), { level: "normal", snoozed: null });
		assert.equal(store.snoozeContext("a", 2, 60_000, new Set(["cpu"])), 0, "a stray is not snoozed");
		// Referenced again: the latched level resumes without a new dwell.
		assert.equal(store.step("a", "cpu", rule(80), valid(85), 3, 30_000).level, "warn");
		// The default slack is stats.prune's.
		assert.equal(STRAY_SLACK, 64);
	});
});

describe("AlertStore snooze", () => {
	it("snoozes every alerting reading of a context at its level", () => {
		const store = new AlertStore();
		store.step("a", "cpu", rule(80, 90), valid(95), 0, 0);
		store.step("a", "gpu", rule(80, 90), valid(85), 0, 0);
		store.step("a", "fan", rule(80, 90), valid(70), 0, 5000);
		assert.equal(store.snoozeContext("a", 100, 300_000), 2);
		assert.deepEqual(store.aggregate("a", ["cpu", "gpu", "fan"]), { level: "normal", snoozed: "crit" });
		assert.deepEqual(store.shownFor("a", "gpu"), { level: "normal", snoozed: "warn" });
	});

	it("snoozes only the identities named, and unsnoozes", () => {
		const store = new AlertStore();
		store.step("a", "cpu", rule(80), valid(85), 0, 0);
		store.step("a", "gpu", rule(80), valid(85), 0, 0);
		assert.equal(store.snoozeContext("a", 0, 300_000, new Set(["gpu"])), 1);
		assert.deepEqual(store.aggregate("a", ["cpu", "gpu"]), { level: "warn", snoozed: "warn" });
		store.unsnoozeContext("a");
		assert.deepEqual(store.shownFor("a", "gpu"), { level: "warn", snoozed: null });
	});

	it("expires only on a valid observation", () => {
		const store = new AlertStore();
		store.step("a", "cpu", rule(80), valid(85), 0, 0);
		store.snoozeContext("a", 0, 1000);
		store.gap("a");
		store.gap("a");
		assert.equal(store.step("a", "cpu", rule(80), valid(85), 5000, 0).level, "warn");
	});

	it("snoozes nothing that does not show", () => {
		const store = new AlertStore();
		store.step("a", "cpu", rule(80), valid(85), 0, 0);
		store.gap("a");
		assert.equal(store.snoozeContext("a", 0, 1000), 0);
		assert.equal(store.snoozeContext("missing", 0, 1000), 0);
	});
});

describe("AlertStore epoch", () => {
	it("bumps on every shown change and on nothing else", () => {
		const store = new AlertStore();
		const epochs: number[] = [];
		const record = (): void => {
			epochs.push(store.epoch);
		};
		store.step("a", "cpu", rule(80), valid(70), 0, 2000);
		record(); // 0: nothing shown
		store.step("a", "cpu", rule(80), valid(85), 1000, 2000);
		record(); // 0: pending only
		store.step("a", "cpu", rule(80), valid(86), 3000, 2000);
		record(); // 1: dwell completed with time
		store.step("a", "cpu", rule(80), valid(87), 4000, 2000);
		record(); // 1: unchanged
		store.snoozeContext("a", 4000, 1000);
		record(); // 2: snoozed
		store.step("a", "cpu", rule(80), valid(87), 5000, 2000);
		record(); // 3: snooze expired with the values unchanged
		store.gap("a");
		record(); // 4: nothing shows in a gap
		store.step("a", "cpu", rule(80), valid(87), 6000, 2000);
		record(); // 5: resumed
		store.prune("a", new Set(["cpu"]));
		record(); // 5: a prune of referenced readings changes nothing
		assert.deepEqual(epochs, [0, 0, 1, 1, 2, 3, 4, 5, 5]);
	});

	it("moves a context's epoch only with its own changes", () => {
		const store = new AlertStore();
		store.step("a", "cpu", rule(80), valid(85), 0, 0);
		const a = store.epochOf("a");
		store.step("b", "cpu", rule(80), valid(85), 0, 0);
		assert.equal(store.epochOf("a"), a);
		assert.notEqual(store.epochOf("b"), store.epochOf("a"));
		// Recovery: the epoch returns to 0, which always means nothing shown.
		store.step("a", "cpu", rule(80), valid(70), 1, 0);
		assert.equal(store.epochOf("a"), 0);
		store.step("a", "cpu", rule(80), valid(85), 2, 0);
		assert.ok(store.epochOf("a") > a, "a new alert never repeats an old epoch");
	});
});

describe("AlertStore referenced readings are never evicted (AC-1)", () => {
	for (const count of [STRAY_SLACK + 1, 300]) {
		it(`${count} referenced readings over a legacy limit dwell, alert, keep a snooze and hold the epoch`, () => {
			const store = new AlertStore();
			const config = parseAlertConfig({ warnValue: "80", alertDwellMs: "2000" });
			const readings: TestReading[] = Array.from({ length: count }, (_, i) => ({ key: `1:0:${i.toString(16)}`, unit: "°C", value: 85 }));
			const keep = new Set(readings.map(alertIdentityOf));
			const tick = (now: number): string[] => {
				const out = readings.map((r) => {
					const result = stepReading(store, "dial", config, "dial", r, 0, now);
					return result.snoozed === null ? result.level : `${result.level}/${result.snoozed}`;
				});
				store.prune("dial", keep);
				return out;
			};
			assert.ok(tick(0).every((level) => level === "normal"));
			assert.ok(tick(1000).every((level) => level === "normal"));
			assert.ok(tick(2000).every((level) => level === "warn"), "every reading alerts once the dwell has passed");
			assert.equal(store.snoozeContext("dial", 2000, 900_000), count);
			const epoch = store.epoch;
			for (let now = 3000; now < 30_000; now += 1000) {
				assert.ok(tick(now).every((level) => level === "normal/warn"), `snooze kept at ${now}`);
			}
			assert.equal(store.epoch, epoch, "steady ticks leave the render gate alone");
			assert.deepEqual(store.size(), { contexts: 1, tracks: count, hidden: 0 });
		});
	}

	it("equals alertLevel for every reading at dwell 0 whatever their number", () => {
		let state = 0x18;
		const random = (): number => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
		const store = new AlertStore();
		const config = parseAlertConfig({ warnValue: "80", critValue: "90" });
		const keys = Array.from({ length: 150 }, (_, i) => `1:0:${i.toString(16)}`);
		const keep = new Set(keys);
		for (let tick = 0; tick < 40; tick++) {
			for (const key of keys) {
				const value = random() * 40 + 60;
				assert.equal(stepReading(store, "dial", config, "dial", { key, unit: "°C", value }, 0, tick * 1000).level, alertLevel(value, 80, 90, false));
			}
			store.prune("dial", keep);
		}
	});

	it("the safety bound drops the least recently stepped measurement, not the oldest", () => {
		const store = new AlertStore({ maxMeasurements: 4 });
		store.step("a", "a", rule(80), valid(85), 0, 0);
		store.step("a", "x", rule(80), valid(85), 0, 0);
		for (const id of ["a", "b", "c"]) store.step("a", id, rule(80), valid(85), 1000, 0);
		for (const id of ["a", "b", "c", "d"]) store.step("a", id, rule(80), valid(85), 2000, 0);
		assert.deepEqual(["a", "b", "c", "d", "x"].map((id) => store.has("a", id)), [true, true, true, true, false]);
		assert.equal(MAX_MEASUREMENTS, 4096, "far above any sensor's reading count");
	});
});

describe("AlertStore spellings of one measurement (AC-2)", () => {
	const group = ["1:0:a", "g2:x"];
	const live: TestReading = { key: "1:0:a", unit: "°C", value: 85, linkedKeys: group };
	const alias: TestReading = { key: "g2:x", aliasOf: "1:0:a", unit: "°C", value: 85, linkedKeys: group };

	it("keeps a track per set of limits when both ends of a link carry their own", () => {
		const config = parseAlertConfig({ alertDwellMs: "2000", alertRules: { "1:0:a": { warn: "80", unit: "°C" }, "g2:x": { warn: "70", unit: "°C" } } });
		const store = new AlertStore();
		const tick = (value: number, now: number): string[] => {
			const out = [alias, live].map((r) => stepReading(store, "dial", config, "dial", { ...r, value }, 0, now).level);
			store.prune("dial", new Set(["1:0:a"]));
			return out;
		};
		assert.deepEqual(tick(85, 0), ["normal", "normal"]);
		assert.deepEqual(tick(85, 1000), ["normal", "normal"]);
		assert.deepEqual(tick(85, 2000), ["warn", "warn"], "neither spelling resets the other's dwell");
		// Between the two limits each spelling follows its own set.
		assert.deepEqual(tick(75, 3000), ["warn", "normal"]);
		assert.deepEqual(store.shownFor("dial", "1:0:a"), { level: "warn", snoozed: null });
		assert.equal(store.snoozeContext("dial", 3000, 900_000), 1, "one reading");
		assert.deepEqual(tick(75, 4000), ["normal", "normal"], "the snooze survives the other spelling's step");
		assert.deepEqual(store.shownFor("dial", "1:0:a"), { level: "normal", snoozed: "warn" });
		// The settings panel says the same thing.
		const note = alertFlags(config, "dial", alias, 0, false).find((flag) => flag.code === "two-limits");
		assert.match(note?.message ?? "", /This reading uses its own limits, and the linked reading uses its own wherever it shows/);
	});

	for (const order of ["slot 0 first", "slot 1 first"] as const) {
		it(`a spelling without limits leaves the track another spelling steps (${order})`, () => {
			for (const dwell of ["0", "2000"]) {
				const config = parseAlertConfig({ warnValue: "80", alertDwellMs: dwell });
				const store = new AlertStore();
				let slot0Warn = 0;
				for (let tick = 0; tick < 10; tick++) {
					const now = tick * 1000;
					// A key: the legacy pair covers slot 0 (the provider key); slot 1
					// shows the same measurement through its alias, with no limits.
					const steps = [(): ShownAlert => stepReading(store, "key", config, "key", live, 0, now), (): ShownAlert => stepReading(store, "key", config, "key", alias, 1, now)];
					const results = order === "slot 0 first" ? steps.map((run) => run()) : steps.reverse().map((run) => run()).reverse();
					if (results[0]?.level === "warn") slot0Warn++;
					assert.equal(results[1]?.level, "normal", "slot 1 has no limits");
					store.prune("key", new Set(["1:0:a"]));
				}
				assert.equal(slot0Warn, dwell === "0" ? 10 : 8, `dwell ${dwell}`);
				assert.deepEqual(store.aggregate("key", ["1:0:a"]), { level: "warn", snoozed: null });
				assert.equal(store.snoozeContext("key", 10_000, 900_000), 1);
			}
		});
	}

	it("drops the old track when a reading's rule moves to another set", () => {
		const store = new AlertStore();
		store.step("a", "cpu", LEGACY_80, valid(85), 0, 0);
		store.prune("a", new Set(["cpu"]));
		// Limits saved for this reading now take over from the legacy pair.
		assert.equal(store.step("a", "cpu", rule(80), valid(85), 1000, 5000).level, "normal");
		store.prune("a", new Set(["cpu"]));
		assert.deepEqual(store.shownFor("a", "cpu"), { level: "normal", snoozed: null }, "the legacy track went");
		assert.equal(store.step("a", "cpu", rule(80), valid(85), 6000, 5000).level, "warn");
	});

	it("keeps referenced tracks that were not stepped this tick", () => {
		const store = new AlertStore();
		store.step("a", "cpu", rule(80), valid(85), 0, 0);
		store.prune("a", new Set(["cpu"]));
		// Data not current: a gap instead of steps, then the tick ends.
		store.gap("a");
		store.prune("a", new Set(["cpu"]));
		assert.equal(store.has("a", "cpu"), true);
		assert.equal(store.step("a", "cpu", rule(80), valid(85), 2000, 30_000).level, "warn", "resumes without a new dwell");
	});
});

describe("AlertStore hidden window", () => {
	it("keeps a hidden context's state for 30 minutes of monotonic time", () => {
		assert.equal(HIDDEN_TTL_MS, 30 * 60_000);
		const store = new AlertStore();
		store.step("a", "cpu", rule(80), valid(85), 0, 0);
		store.snoozeContext("a", 0, 3_600_000);
		store.hide("a", 1000);
		store.sweep(1000 + HIDDEN_TTL_MS);
		store.appear("a", 1000 + HIDDEN_TTL_MS);
		assert.deepEqual(store.shownFor("a", "cpu"), { level: "normal", snoozed: "warn" }, "a replayed appear keeps the state");
		assert.deepEqual(store.size(), { contexts: 1, tracks: 1, hidden: 0 });
	});

	it("drops a hidden context past the window, on a sweep or on its return", () => {
		const store = new AlertStore();
		store.step("a", "cpu", rule(80), valid(85), 0, 0);
		store.step("b", "cpu", rule(80), valid(85), 0, 0);
		store.hide("a", 0);
		store.hide("b", 0);
		store.sweep(HIDDEN_TTL_MS + 1);
		assert.equal(store.has("a", "cpu"), false);
		store.step("c", "cpu", rule(80), valid(85), 0, 0);
		store.hide("c", 0);
		store.appear("c", HIDDEN_TTL_MS + 1);
		assert.equal(store.has("c", "cpu"), false);
	});

	it("times a context hidden with no state, so tracks it gains while hidden still expire", () => {
		const store = new AlertStore();
		store.hide("a", 0);
		store.step("a", "cpu", rule(80), valid(85), 10, 0);
		assert.deepEqual(store.size(), { contexts: 1, tracks: 1, hidden: 1 });
		store.sweep(HIDDEN_TTL_MS + 1);
		assert.deepEqual(store.size(), { contexts: 0, tracks: 0, hidden: 1 });
	});

	it("a reset of a hidden context keeps it timed as hidden", () => {
		const store = new AlertStore();
		store.step("a", "cpu", rule(80), valid(85), 0, 0);
		store.hide("a", 0);
		store.reset("a");
		assert.deepEqual(store.size(), { contexts: 0, tracks: 0, hidden: 1 });
		store.step("a", "cpu", rule(80), valid(85), 10, 0);
		store.sweep(HIDDEN_TTL_MS + 1);
		assert.deepEqual(store.size(), { contexts: 0, tracks: 0, hidden: 1 });
	});

	it("an on-screen context is never swept", () => {
		const store = new AlertStore();
		store.step("a", "cpu", rule(80), valid(85), 0, 0);
		store.sweep(10 * HIDDEN_TTL_MS);
		assert.equal(store.has("a", "cpu"), true);
	});

	it("a context still stepped after its sweep stays timed as hidden (AC-4)", () => {
		const store = new AlertStore();
		store.step("dial", "cpu", LEGACY_80, valid(85), 0, 0);
		store.hide("dial", 0);
		store.sweep(HIDDEN_TTL_MS + 1);
		assert.deepEqual(store.size(), { contexts: 0, tracks: 0, hidden: 1 }, "the mark outlives the sweep");
		store.step("dial", "cpu", LEGACY_80, valid(85), HIDDEN_TTL_MS + 1000, 0);
		assert.deepEqual(store.size(), { contexts: 1, tracks: 1, hidden: 1 });
		store.sweep(100 * HIDDEN_TTL_MS);
		assert.deepEqual(store.size(), { contexts: 0, tracks: 0, hidden: 1 }, "the next sweep drops it again");
		// Its return past the window starts fresh and ends the mark.
		store.step("dial", "cpu", LEGACY_80, valid(85), 100 * HIDDEN_TTL_MS + 10, 0);
		store.appear("dial", 100 * HIDDEN_TTL_MS + 20);
		assert.deepEqual(store.size(), { contexts: 0, tracks: 0, hidden: 0 });
		// On screen now: no sweep touches what it gains.
		store.step("dial", "cpu", LEGACY_80, valid(85), 100 * HIDDEN_TTL_MS + 30, 0);
		store.sweep(1000 * HIDDEN_TTL_MS);
		assert.equal(store.has("dial", "cpu"), true);
	});

	it("forget drops the state and the mark", () => {
		const store = new AlertStore();
		store.step("a", "cpu", rule(80), valid(85), 0, 0);
		store.hide("a", 0);
		const epoch = store.epoch;
		store.forget("a");
		assert.deepEqual(store.size(), { contexts: 0, tracks: 0, hidden: 0 });
		assert.ok(store.epoch > epoch);
	});
});

describe("AlertStore caps", () => {
	it("keeps at most 256 contexts with state, dropping the longest-hidden first, then the oldest", () => {
		assert.equal(MAX_CONTEXTS, 256);
		const store = new AlertStore();
		for (let i = 0; i < MAX_CONTEXTS; i++) store.step(`c${i}`, "cpu", rule(80), valid(85), 0, 0);
		store.hide("c10", 50);
		store.hide("c20", 40);
		store.step("new1", "cpu", rule(80), valid(85), 0, 0);
		assert.equal(store.size().contexts, MAX_CONTEXTS);
		assert.equal(store.has("c20", "cpu"), false, "hidden longest goes first");
		assert.equal(store.has("c10", "cpu"), true);
		store.step("new2", "cpu", rule(80), valid(85), 0, 0);
		assert.equal(store.has("c10", "cpu"), false);
		store.step("new3", "cpu", rule(80), valid(85), 0, 0);
		assert.equal(store.has("c0", "cpu"), false, "then the oldest");
		assert.equal(store.has("new3", "cpu"), true);
		assert.equal(store.size().contexts, MAX_CONTEXTS);
	});

	it("hiding actions with no alert state never pushes out one that has it (AC-3)", () => {
		assert.equal(MAX_HIDDEN, 1024);
		const store = new AlertStore();
		const crit: ResolvedRule = { source: "legacy", warn: 80, crit: 90, below: false, unit: { kind: "legacy" }, hyst: 0 };
		store.step("dial-A", "cpu", crit, valid(95), 0, 0);
		store.snoozeContext("dial-A", 0, 3_600_000);
		store.hide("dial-A", 1000);
		// Page flips: far more plain actions disappear than either cap holds.
		for (let i = 0; i < MAX_HIDDEN + MAX_CONTEXTS; i++) store.hide(`plain-${i}`, 2000 + i);
		assert.deepEqual(store.size(), { contexts: 1, tracks: 1, hidden: MAX_HIDDEN });
		store.appear("dial-A", 60_000);
		assert.deepEqual(store.step("dial-A", "cpu", crit, valid(95), 61_000, 0), { level: "normal", snoozed: "crit" }, "the snooze is kept");
	});

	it("over the mark cap with every mark carrying state, the longest hidden loses its state with its mark", () => {
		const store = new AlertStore({ maxHidden: 2 });
		for (const [i, id] of ["a", "b", "c"].entries()) {
			store.step(id, "cpu", rule(80), valid(85), 0, 0);
			store.hide(id, 10 * (i + 1));
		}
		assert.deepEqual(["a", "b", "c"].map((id) => store.has(id, "cpu")), [false, true, true]);
		assert.deepEqual(store.size(), { contexts: 2, tracks: 2, hidden: 2 });
	});

	it("takes smaller caps for tests and stays within them under churn", () => {
		const store = new AlertStore({ maxContexts: 4, maxMeasurements: 3, maxHidden: 6, hiddenTtlMs: 100 });
		for (let i = 0; i < 1000; i++) {
			store.step(`c${i % 9}`, `r${i % 7}`, rule(80), valid(i % 3 === 0 ? 70 : 85), i, i % 2 === 0 ? 0 : 50);
			if (i % 5 === 0) store.hide(`c${(i * 7) % 13}`, i);
			if (i % 7 === 0) store.appear(`c${i % 9}`, i);
			if (i % 4 === 0) store.prune(`c${i % 9}`, new Set([`r${i % 7}`, `r${(i + 1) % 7}`]), i % 3);
			if (i % 11 === 0) store.sweep(i);
			const size = store.size();
			assert.ok(size.contexts <= 4 && size.tracks <= 12 && size.hidden <= 6, JSON.stringify(size));
		}
	});
});
