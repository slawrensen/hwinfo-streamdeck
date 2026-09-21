import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
for (const script of ["docs-v17-images.mjs", "dial-color-comparison.mjs", "back-face-sheet.ts", "readability-report.mjs"]) {
	test(`${script} reports an output failure despite the SDK exception logger`, () => {
		const directory = mkdtempSync(path.join(os.tmpdir(), "hwinfo-script-failure-"));
		try {
			const blocker = path.join(directory, "output-is-a-file");
			writeFileSync(blocker, "The generator must fail before rendering.");
			const result = spawnSync(process.execPath, ["--import", "tsx", `scripts/${script}`, blocker], { cwd: root, encoding: "utf8", timeout: 15_000, windowsHide: true });
			assert.equal(result.error, undefined);
			assert.equal(result.signal, null);
			assert.equal(result.status, 1, result.stderr);
			assert.match(result.stderr, /EEXIST/);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
}
