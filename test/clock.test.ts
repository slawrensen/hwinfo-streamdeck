// The monotonic clock behind every "how long since X" judgment. The point of
// the module is that a wall-clock correction cannot reach it: a backward jump
// would make the poller's staleness test go negative and hold frozen HWiNFO
// values on screen as if they were live, with no "Not updating" cue, for the
// length of the jump.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { monotonicNow } from "../src/clock";

describe("monotonicNow", () => {
	it("never goes backwards", () => {
		let previous = monotonicNow();
		for (let i = 0; i < 1000; i++) {
			const current = monotonicNow();
			assert.ok(current >= previous, `${current} < ${previous}`);
			previous = current;
		}
	});

	it("ignores the wall clock entirely, including a jump backwards", () => {
		const realDateNow = Date.now;
		try {
			// A machine correcting an hour backwards mid-run: an NTP sync after
			// a bad RTC, a VM resume, a dual-boot UTC fix.
			let fake = realDateNow();
			Date.now = (): number => fake;
			const before = monotonicNow();
			fake -= 3_600_000;
			const after = monotonicNow();
			assert.ok(after >= before, "monotonic reading followed the wall clock backwards");
			assert.ok(after - before < 1_000, `elapsed ${after - before} ms should be a few ms, not an hour`);
		} finally {
			Date.now = realDateNow;
		}
	});

	it("measures real elapsed time", async () => {
		const start = monotonicNow();
		await new Promise((resolve) => setTimeout(resolve, 25));
		const elapsed = monotonicNow() - start;
		// Loose bounds: this asserts the units are milliseconds, not the timer's
		// precision, so a busy CI box cannot make it flaky.
		assert.ok(elapsed >= 15, `elapsed ${elapsed} ms`);
		assert.ok(elapsed < 5_000, `elapsed ${elapsed} ms`);
	});

	it("returns whole milliseconds", () => {
		// One reading, deliberately: comparing two separate readings would be
		// asserting that the clock did not tick between them, which is not a
		// property of this module and fails at random on a busy machine.
		assert.ok(Number.isInteger(monotonicNow()));
	});
});
