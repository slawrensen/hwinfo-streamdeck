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

	it("a replayed keyDown replaces the session; the superseded timer cannot fire", () => {
		const bed = timerBed();
		const outcomes: Array<{ id: string; outcome: PressOutcome }> = [];
		// Keep the first session's timer handle alive past clearTimer by using
		// an evil clear that forgets: the generation check must still refuse.
		const engine = new PressEngine((id, outcome) => outcomes.push({ id, outcome }), 500, {
			setTimer: bed.deps.setTimer,
			clearTimer: () => {}
		});
		engine.keyDown("ctx");
		engine.keyDown("ctx");
		bed.fire(); // both timers fire; only the live generation may act
		assert.deepEqual(outcomes, [{ id: "ctx", outcome: "hold" }]);
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
