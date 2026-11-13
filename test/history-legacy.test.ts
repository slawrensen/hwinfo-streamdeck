/**
 * Legacy invariance: with no Trend window in force (absent, junk, or set
 * where it is ignored), key and dial faces are byte for byte what 1.7.1
 * composed for the same recorded tick sequence, while the history store
 * retains every window of the same readings beside the legacy rings. The
 * golden was produced by running test/history-legacy-driver.ts against the
 * v1.7.1 sources (tag v1.7.1, bb4aede). Runs in its own process: the driver
 * owns the poller singleton.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { poller } from "../src/poller";
import { DIAL_CASES, KEY_CASES, legacyFaces } from "./history-legacy-driver";

const golden = JSON.parse(readFileSync(new URL("./golden/history-legacy-faces.json", import.meta.url), "utf8")) as Record<string, string>;

describe("faces without a Trend window are the 1.7.1 faces", () => {
	const faces = legacyFaces();

	it("covers every case the golden holds", () => {
		assert.deepEqual(Object.keys(faces).sort(), Object.keys(golden).sort());
		assert.equal(Object.keys(faces).length, Object.keys(KEY_CASES).length + Object.keys(DIAL_CASES).length);
	});

	for (const name of Object.keys(golden)) {
		it(name, () => {
			assert.equal(faces[name], golden[name]);
		});
	}

	it("the history store really held those readings while the faces stayed legacy", () => {
		const diag = poller.history.diagnostics();
		assert.equal(diag.series, 3);
		assert.equal(diag.bytes, 3 * (3168 + 7392 + 7392));
		assert.ok((poller.history.view("a1:0:1", "5m", 128, Math.round(performance.now()))?.cols.n ?? 0) > 0, "the 5m tier has columns");
	});
});
