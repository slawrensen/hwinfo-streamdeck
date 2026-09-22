import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const sourcePath = fileURLToPath(new URL("../scripts/docs-preview-publish.mjs", import.meta.url));
const source = fs.readFileSync(sourcePath, "utf8")
	.replace(/^import .*;\r?\n/gm, "")
	.replaceAll("import.meta.url", "scriptUrl");

test("preview builds preserve earlier stages and identify the current version", () => {
	const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "hwinfo-preview-stage-test-"));
	try {
		const repo = path.join(fixture, "repo");
		const temporary = path.join(fixture, "temp");
		fs.mkdirSync(path.join(repo, "docs", "_includes"), { recursive: true });
		fs.mkdirSync(temporary);
		fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ version: "9.8.7" }));
		fs.writeFileSync(path.join(repo, "docs", "_config.yml"), "baseurl: /hwinfo-streamdeck\ngh_edit_link: true\nexclude:\n  - release/\n");
		fs.writeFileSync(path.join(repo, "docs", "_includes", "head_custom.html"), "<style></style>\n");
		const stages = [];
		const commands = [];
		const run = () => vm.runInNewContext(source, {
			fs, path, os: { tmpdir: () => temporary },
			fileURLToPath: () => path.join(repo, "scripts", "docs-preview-publish.mjs"),
			scriptUrl: "fixture-only",
			console: { error: () => {} },
			execFileSync: (command, args, options) => {
				commands.push([command, ...args]);
				if (command === "git" && args[0] === "rev-parse") return "fixture-branch\n";
				if (command === "git" && args[0] === "ls-files") return "docs/_config.yml\0docs/_includes/head_custom.html\0";
				if (command === "git" && args[0] === "init") stages.push(options.cwd);
				// All external commands, including git push and gh, are inert.
				return "{}";
			}
		}, { filename: sourcePath, timeout: 5000 });
		run();
		fs.writeFileSync(path.join(stages[0], "owned-by-first-run.txt"), "keep");
		run();
		assert.equal(stages.length, 2);
		assert.notEqual(stages[0], stages[1], "concurrent/earlier runs need separate staging directories");
		assert.equal(fs.readFileSync(path.join(stages[0], "owned-by-first-run.txt"), "utf8"), "keep");
		assert.match(fs.readFileSync(path.join(stages[1], "_includes", "head_custom.html"), "utf8"), /9\.8\.7 preview/);
		assert.ok(commands.some(([command, action]) => command === "git" && action === "push"), "exercise the complete production flow with inert transport");
	} finally {
		fs.rmSync(fixture, { recursive: true, force: true });
	}
});
