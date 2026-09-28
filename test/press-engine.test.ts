// The tap-vs-hold press engine: exactly one outcome per press, holds fire
// once at the threshold, a consumed hold silences its release, and every
// cancellation path (disappear, disconnect, shutdown, profile transition)
// kills stale timers so a ghost action can never fire later.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PressEngine, type PressOutcome } from "../src/detail/press-engine";

/** Manual timer bed: fires only when the test advances time. */
function timerBed(): { deps: { setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>; clearTimer: (h: ReturnType<typeof setTimeout>) => void }; fire: () => void; pending: () => number } {
	let next = 1;
	const timers = new Map<number, () => void>();
	return {
		deps: {
			setTimer: (fn: () => void): ReturnType<typeof setTimeout> => {
				const id = next++;
				timers.set(id, fn);
				return id as unknown as ReturnType<typeof setTimeout>;
			},
			clearTimer: (h: ReturnType<typeof setTimeout>): void => {
				timers.delete(h as unknown as number);
			}
		},
		fire: (): void => {
			for (const [id, fn] of [...timers]) {
				timers.delete(id);
				fn();
			}
		},
		pending: (): number => timers.size
	};
}

/** A clock-driven bed: a timer fires when the clock reaches it, and a
 * forgetful clear leaves a stale callback to run anyway. */
function clockBed(forgetfulClear = false) {
	let now = 0;
	let next = 1;
	const timers = new Map<number, { at: number; fn: () => void }>();
	const outcomes: PressOutcome[] = [];
	const engine = new PressEngine((_id, outcome) => outcomes.push(outcome), 500, {
		setTimer: (fn, ms) => {
			timers.set(next, { at: now + ms, fn });
			return next++ as unknown as ReturnType<typeof setTimeout>;
		},
		clearTimer: (h) => {
			if (!forgetfulClear) timers.delete(h as unknown as number);
		},
		now: () => now
	});
	const advanceTo = (t: number): void => {
		now = t;
		for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
			if (timer.at <= now) {
				timers.delete(id);
				timer.fn();
			}
		}
	};
	return { engine, outcomes, advanceTo };
}

function harness(): { engine: PressEngine; outcomes: Array<{ id: string; outcome: PressOutcome }>; fire: () => void; pending: () => number } {
	const outcomes: Array<{ id: string; outcome: PressOutcome }> = [];
	const bed = timerBed();
	const engine = new PressEngine((id, outcome) => outcomes.push({ id, outcome }), 500, bed.deps);
	return { engine, outcomes, fire: bed.fire, pending: bed.pending };
}

describe("press engine", () => {
	it("a release before the threshold is exactly one tap", () => {
		const { engine, outcomes } = harness();
		engine.keyDown("ctx");
		engine.keyUp("ctx");
		assert.deepEqual(outcomes, [{ id: "ctx", outcome: "tap" }]);
		engine.keyUp("ctx"); // stray second release: nothing
		assert.equal(outcomes.length, 1);
	});

	it("crossing the threshold fires the hold exactly once", () => {
		const { engine, outcomes, fire } = harness();
		engine.keyDown("ctx");
		fire();
		fire(); // no timer left to fire twice
		assert.deepEqual(outcomes, [{ id: "ctx", outcome: "hold" }]);
	});

	it("the release after a consumed hold does nothing", () => {
		const { engine, outcomes, fire } = harness();
		engine.keyDown("ctx");
		fire();
		engine.keyUp("ctx");
		assert.deepEqual(outcomes, [{ id: "ctx", outcome: "hold" }]);
		engine.keyDown("ctx"); // the session is gone: a fresh press starts clean
		engine.keyUp("ctx");
		assert.deepEqual(outcomes, [
			{ id: "ctx", outcome: "hold" },
			{ id: "ctx", outcome: "tap" }
		]);
	});

	it("cancel kills the session with no outcome, and the stale timer stays dead", () => {
		const { engine, outcomes, fire, pending } = harness();
		engine.keyDown("ctx");
		engine.cancel("ctx");
		fire();
		engine.keyUp("ctx");
		assert.equal(outcomes.length, 0);
		assert.equal(pending(), 0);
	});

	// The contract this replaces had a replayed keyDown REPLACE the session,
	// which reset its deadline and let one held press fire a second hold, or
	// act again after settings consumed it (external review AX67). A
	// replayed keyDown is now the same press; the generation check still
	// guards a cancelled session's timer against the next press.
	it("a cancelled session's timer cannot fire into the next press", () => {
		// The first press's timer outlives its clear (a forgetful clear), and
		// comes due while the second press is held: the generation check must
		// refuse it, or the second press would hold 400 ms early.
		const { engine, outcomes, advanceTo } = clockBed(true);
		engine.keyDown("ctx");
		advanceTo(100);
		engine.cancel("ctx");
		advanceTo(400);
		engine.keyDown("ctx");
		advanceTo(500);
		assert.deepEqual(outcomes, [], "the stale timer came due and did nothing");
		advanceTo(900);
		assert.deepEqual(outcomes, ["hold"], "the live press holds at its own deadline");
	});

	it("a release long after a hold or a consume adds nothing", () => {
		for (const consumed of [false, true]) {
			const { engine, outcomes, advanceTo } = clockBed(true);
			engine.keyDown("ctx");
			if (consumed) engine.consume("ctx");
			advanceTo(600);
			engine.keyUp("ctx");
			advanceTo(2000);
			assert.deepEqual(outcomes, consumed ? [] : ["hold"], consumed ? "consumed" : "held");
		}
	});

	it("a repeated keyDown is the same press: one deadline, one hold", () => {
		const { engine, outcomes, fire, pending } = harness();
		engine.keyDown("ctx");
		engine.keyDown("ctx");
		assert.equal(pending(), 1, "no second timer");
		fire();
		engine.keyDown("ctx"); // still held after the hold
		assert.equal(pending(), 0, "the held press cannot re-arm");
		fire();
		engine.keyUp("ctx");
		assert.deepEqual(outcomes, [{ id: "ctx", outcome: "hold" }]);
	});

	it("consume ends a held press with no outcome and keeps it held until its release", () => {
		const { engine, outcomes, fire, pending } = harness();
		engine.keyDown("ctx");
		engine.consume("ctx");
		assert.equal(pending(), 0);
		assert.equal(engine.isDown("ctx"), true);
		engine.keyDown("ctx"); // a repeated down cannot start it again
		fire();
		engine.keyUp("ctx");
		assert.equal(engine.isDown("ctx"), false);
		assert.deepEqual(outcomes, []);
		engine.keyDown("ctx");
		engine.keyUp("ctx");
		assert.deepEqual(outcomes, [{ id: "ctx", outcome: "tap" }], "the next press is a new one");
		engine.consume("idle"); // nothing held: nothing to consume
		assert.equal(engine.isDown("idle"), false);
	});

	// A busy or suspended event loop can deliver the release before the hold
	// timer runs; the time held decides, and the late timer stays silent
	// (external review AX62).
	it("a release at or past the threshold is a hold even if its timer has not run", () => {
		for (const [held, expected] of [
			[0, "tap"],
			[499, "tap"],
			[500, "hold"],
			[501, "hold"],
			[600, "hold"],
			[3_600_000, "hold"]
		] as const) {
			let now = 1000;
			const bed = timerBed();
			const outcomes: PressOutcome[] = [];
			const engine = new PressEngine((_id, outcome) => outcomes.push(outcome), 500, { setTimer: bed.deps.setTimer, clearTimer: () => {}, now: () => now });
			engine.keyDown("ctx");
			now += held;
			engine.keyUp("ctx");
			bed.fire(); // the late callback runs after the release
			assert.deepEqual(outcomes, [expected], `${held} ms`);
		}
	});

	it("two contexts stay independent", () => {
		const { engine, outcomes, fire } = harness();
		engine.keyDown("a");
		engine.keyDown("b");
		engine.keyUp("a"); // tap on a
		fire(); // hold fires on b only
		assert.deepEqual(outcomes, [
			{ id: "a", outcome: "tap" },
			{ id: "b", outcome: "hold" }
		]);
	});
});
