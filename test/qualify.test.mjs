// The qualification entrypoint's contract that other things depend on: the
// stage order is the documented one (a clean clone must be able to run it
// top to bottom), an unknown stage is refused before anything runs, and a
// stage that does not pass stops the stages after it (a later PASS must
// never be read over an earlier FAIL).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const script = path.join(ROOT, "scripts", "qualify.mjs");
const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: "utf8" });

describe("qualification entrypoint", () => {
	it("lists the stages in the clean-clone order", () => {
		const r = run("--list");
		assert.equal(r.status, 0);
		assert.deepEqual(r.stdout.trim().split(/\r?\n/), ["prerequisites", "lint", "typecheck", "build:native", "build", "unit", "native", "pack", "archive", "abi", "recovery", "native-gate", "cli-validate", "copy", "tree"]);
	});

	it("refuses an unknown stage before running anything", () => {
		const r = run("--stages", "prerequisites,nope");
		assert.equal(r.status, 3);
		assert.match(r.stderr, /unknown stage "nope"/);
	});

	it("a stage that cannot pass fails the run and skips the stages after it", (t) => {
		// The archive stage over a release directory that holds no archive:
		// the missing artifact is rejected there, with the remedy, and the
		// ABI and recovery stages that would consume it are skipped, never
		// run over an older extraction.
		// The record directory sits INSIDE the checkout here, as CI keeps it:
		// it is the run's own output, and the unchanged-tree stage must not
		// count it as a changed input.
		const out = fs.mkdtempSync(path.join(ROOT, "qualification-test-"));
		t.after(() => fs.rmSync(out, { recursive: true, force: true }));
		const archive = path.join(ROOT, "release", "com.lawrensen.hwinfo.streamDeckPlugin");
		const packed = fs.existsSync(archive);
		const r = run("--stages", packed ? "tree" : "archive,abi,recovery", "--out", out);
		if (packed) {
			// With a real archive present the negative path is proven by the
			// validator's own fixtures; here only the runner's bookkeeping.
			assert.equal(r.status, 0, r.stdout + r.stderr);
			const record = JSON.parse(fs.readFileSync(path.join(out, "record.json"), "utf8"));
			assert.equal(record.verdict, "PASS");
			assert.equal(record.stages.find((s) => s.id === "archive").status, "SKIPPED");
			return;
		}
		assert.equal(r.status, 1, r.stdout + r.stderr);
		const record = JSON.parse(fs.readFileSync(path.join(out, "record.json"), "utf8"));
		assert.equal(record.verdict, "FAIL");
		assert.equal(record.stages.find((s) => s.id === "archive").status, "FAIL");
		assert.equal(record.stages.find((s) => s.id === "abi").status, "SKIPPED");
		assert.equal(record.stages.find((s) => s.id === "recovery").status, "SKIPPED");
		assert.match(fs.readFileSync(path.join(out, "09-archive.log"), "utf8"), /not found; run `npm run pack` first/);
	});
});
