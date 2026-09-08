// Status-screen copy: the recovery hint must match the source actually in use.
// Regression guard for v1.1.5 — the dial's stale text used to say "check
// sharing" for every source, wrongly pointing gadget-source dials at Shared
// Memory. statusScreen and statusSentence already branch on source; this locks
// statusDialText to the same behavior.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { HwinfoUnavailableReason, SensorSnapshot } from "../src/hwinfo/types";
import type { PollerStatus } from "../src/poller";
import { keyLabel, statusDialText, statusScreen, statusSentence } from "../src/ui/state-screens";

const EMPTY_SNAPSHOT: SensorSnapshot = {
	pollTime: 1,
	version: 1,
	revision: 0,
	sensors: [],
	readings: [],
	byKey: new Map()
};

function stale(source: "shared-memory" | "gadget"): PollerStatus {
	return { state: "stale", snapshot: EMPTY_SNAPSHOT, source, staleForMs: 20_000 };
}

describe("state-screens: stale recovery hint follows the source", () => {
	it("dial stale on gadget points at Gadget, not Shared Memory", () => {
		const text = statusDialText(stale("gadget"));
		assert.equal(text?.title, "Age unknown");
		assert.equal(text?.value, "check Gadget");
		assert.doesNotMatch(text?.value ?? "", /sharing/i);
	});

	it("dial stale on shared memory still points at sharing", () => {
		const text = statusDialText(stale("shared-memory"));
		assert.equal(text?.value, "check sharing");
	});

	it("key stale screen branches on source", () => {
		assert.deepEqual(statusScreen(stale("gadget"))?.lines, ["Age unknown", "check Gadget"]);
		assert.deepEqual(statusScreen(stale("shared-memory"))?.lines, ["Not updating", "check sharing"]);
	});

	it("PI sentence already branches on source", () => {
		assert.match(statusSentence(stale("gadget")), /Gadget/);
		assert.match(statusSentence(stale("shared-memory")), /Shared Memory/);
	});

	it("withheld Gadget names explain incomplete identity as well as ambiguity", () => {
		const snapshot: SensorSnapshot = { ...EMPTY_SNAPSHOT, blockedReadingCount: 1 };
		const statuses: PollerStatus[] = [
			{ state: "ok", source: "gadget", snapshot },
			{ state: "stale", source: "gadget", snapshot, staleForMs: 20_000 }
		];
		for (const status of statuses) {
			assert.match(statusSentence(status), /Incomplete or ambiguous Gadget names are withheld/);
			assert.match(statusSentence(status), /source names.*unique label.*select it again/);
		}
	});
});

describe("state-screens: every unavailable reason has its own guidance", () => {
	const unavailable = (reason: HwinfoUnavailableReason): PollerStatus => ({ state: "unavailable", reason, message: "" });
	const REASONS: readonly HwinfoUnavailableReason[] = ["unsupported-platform", "not-running", "busy", "gadget-empty", "access-denied", "disabled", "invalid", "bridge-failed"];

	it("key, dial and PI sentence cover all reasons", () => {
		for (const reason of REASONS) {
			const status = unavailable(reason);
			assert.equal(statusScreen(status)?.lines.length, 2, reason);
			assert.ok((statusDialText(status)?.title ?? "") !== "", reason);
			assert.ok(statusSentence(status).length > 20, reason);
		}
	});

	it("open-time contention never claims HWiNFO is not running", () => {
		// The source mutex was busy; that alone does not prove the producer's
		// process state or justify asking the user to restart it.
		const status = unavailable("busy");
		assert.deepEqual(statusScreen(status)?.lines, ["HWiNFO busy", "retrying"]);
		assert.equal(statusDialText(status)?.title, "HWiNFO busy");
		assert.doesNotMatch(statusScreen(status)?.lines.join(" ") ?? "", /Start HWiNFO/);
		assert.doesNotMatch(statusSentence(status), /not running|Start HWiNFO|restart HWiNFO/);
		assert.doesNotMatch(statusSentence(status), /HWiNFO is running/);
		assert.match(statusSentence(status), /busy|retr/i);
	});

	it("a bridge load failure says reinstall, never restart HWiNFO", () => {
		// An AV-quarantined or missing bin/hwsm.node cannot be fixed by
		// restarting HWiNFO; the screens must not borrow "invalid"'s advice.
		const status = unavailable("bridge-failed");
		assert.deepEqual(statusScreen(status)?.lines, ["Bridge failed", "reinstall"]);
		assert.equal(statusDialText(status)?.value, "reinstall it");
		assert.match(statusSentence(status), /[Rr]einstall/);
		assert.match(statusSentence(status), /security.*report|report.*security/);
		assert.doesNotMatch(statusSentence(status), /restore or allow|allow.*antivirus|often.*quarantine/);
		assert.doesNotMatch(statusSentence(status), /restart HWiNFO/);
	});

	it("access denial and persistent empty storage do not claim a particular cause", () => {
		const denied = unavailable("access-denied");
		assert.deepEqual(statusScreen(denied)?.lines, ["Access denied", "check access"]);
		assert.doesNotMatch(statusSentence(denied), /Usually|run both elevated|works across privilege/);
		assert.match(statusSentence(denied), /does not identify/);
		assert.doesNotMatch(statusSentence(unavailable("gadget-empty")), /registry is enabled/);
	});

	it("missing update evidence is not diagnosed as a stalled process", () => {
		assert.equal(statusDialText(stale("shared-memory"))?.title, "No new data");
		assert.match(statusSentence(stale("shared-memory")), /No new Shared Memory.*20s/);
		assert.doesNotMatch(statusSentence(stale("shared-memory")), /HWiNFO stopped updating/);
	});
});

describe("keyLabel salvage", () => {
	it("uses a trimmed custom label, falls back on blank or non-string junk", () => {
		assert.equal(keyLabel(" CCD1 ", "fallback"), "CCD1");
		assert.equal(keyLabel("", "fallback"), "fallback");
		assert.equal(keyLabel("   ", "fallback"), "fallback");
		assert.equal(keyLabel(undefined, "fallback"), "fallback");
		// Settings are untyped JSON at runtime: junk shapes degrade, never throw.
		assert.equal(keyLabel(42, "fallback"), "fallback");
		assert.equal(keyLabel({ junk: true }, "fallback"), "fallback");
		assert.equal(keyLabel(null, "fallback"), "fallback");
	});
});
