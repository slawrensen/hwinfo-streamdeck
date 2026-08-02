// The parent-liveness rules behind the watchdog: EPERM is evidence of life,
// a machine that cannot probe never arms the watchdog, one lost probe is a
// blip, and an app that answers stands the whole thing down for good. These
// rules exist because the naive version (any probe error means the app died)
// exited the plugin 30 seconds after every launch on a user's machine, and
// nothing in our test bed could see it (issue #17).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyProbeError, GONE_STRIKES, ParentLiveness, probeErrorCode } from "../src/parent-liveness";

const err = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

describe("classifyProbeError", () => {
	it("calls only ESRCH gone", () => {
		assert.equal(classifyProbeError(err("ESRCH")), "gone");
	});

	it("treats EPERM as blocked: the process exists, we just cannot open it", () => {
		assert.equal(classifyProbeError(err("EPERM")), "blocked");
	});

	it("treats an unknown or code-less failure as blocked, never as death", () => {
		assert.equal(classifyProbeError(err("EACCES")), "blocked");
		assert.equal(classifyProbeError(new Error("boom")), "blocked");
		assert.equal(classifyProbeError("not an error"), "blocked");
		assert.equal(classifyProbeError(undefined), "blocked");
	});
});

describe("probeErrorCode", () => {
	it("reports the code when there is one", () => {
		assert.equal(probeErrorCode(err("EPERM")), "EPERM");
	});

	it("falls back to the value itself so the log line is never empty", () => {
		assert.match(probeErrorCode(new Error("boom")), /boom/);
	});
});

describe("ParentLiveness", () => {
	it("never arms when the parent could not be probed at startup", () => {
		for (const startup of ["blocked", "gone"] as const) {
			const w = new ParentLiveness(startup);
			assert.equal(w.armed, false, startup);
			// Even a run of gone probes cannot make a disarmed watchdog act.
			for (let i = 0; i < GONE_STRIKES + 3; i++) {
				assert.equal(w.observe("gone"), "stay");
			}
		}
	});

	it("arms when the parent answered at startup", () => {
		assert.equal(new ParentLiveness("alive").armed, true);
	});

	it("stays put while the parent answers", () => {
		const w = new ParentLiveness("alive");
		for (let i = 0; i < 10; i++) {
			assert.equal(w.observe("alive"), "stay");
		}
	});

	it("never acts on blocked probes, however many arrive", () => {
		const w = new ParentLiveness("alive");
		for (let i = 0; i < 10; i++) {
			assert.equal(w.observe("blocked"), "stay");
		}
	});

	it("asks the app only after consecutive gone probes", () => {
		const w = new ParentLiveness("alive");
		for (let i = 1; i < GONE_STRIKES; i++) {
			assert.equal(w.observe("gone"), "stay");
		}
		assert.equal(w.observe("gone"), "confirm-with-app");
	});

	it("resets the strike count when a probe answers again", () => {
		const w = new ParentLiveness("alive");
		assert.equal(w.observe("gone"), "stay");
		assert.equal(w.observe("alive"), "stay");
		// The earlier strike must not count towards the next run.
		assert.equal(w.observe("gone"), "stay");
	});

	it("resets the strike count on a blocked probe too", () => {
		const w = new ParentLiveness("alive");
		assert.equal(w.observe("gone"), "stay");
		assert.equal(w.observe("blocked"), "stay");
		assert.equal(w.observe("gone"), "stay");
	});

	it("stands down for good once the app has answered", () => {
		const w = new ParentLiveness("alive");
		for (let i = 1; i < GONE_STRIKES; i++) {
			w.observe("gone");
		}
		assert.equal(w.observe("gone"), "confirm-with-app");
		w.disarm(); // the app answered: this machine's PID signal lies
		assert.equal(w.armed, false);
		for (let i = 0; i < GONE_STRIKES + 3; i++) {
			assert.equal(w.observe("gone"), "stay");
		}
	});

	it("still reaches the app question when the parent is truly gone", () => {
		// The original purpose survives: a real app death is a run of ESRCH,
		// and the caller then exits when the app cannot answer either.
		const w = new ParentLiveness("alive");
		let action = w.observe("gone");
		for (let i = 1; i < GONE_STRIKES; i++) {
			action = w.observe("gone");
		}
		assert.equal(action, "confirm-with-app");
	});
});
