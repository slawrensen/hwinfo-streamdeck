import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

describe("release input gate", () => {
	let root: string;
	before(() => {
		root = mkdtempSync(join(tmpdir(), "hwinfo-release-input-"));
		mkdirSync(join(root, "scripts"));
		mkdirSync(join(root, "com.lawrensen.hwinfo.sdPlugin"));
		cpSync(join(ROOT, "scripts/verify-release-tag.mjs"), join(root, "scripts/verify-release-tag.mjs"));
	});
	after(() => rmSync(root, { recursive: true, force: true }));

	const datedEntry = "# Changelog\n\n## 1.6.1.0 - 2026-08-11\n\n- entry\n\n## 1.6.0.0 - 2026-08-01\n";
	function run(tag: string, versions: readonly string[] = ["1.6.1.0", "1.6.1", "1.6.1", "1.6.1"], changelog: string | null = datedEntry): { status: number | null; stderr: string } {
		writeFileSync(join(root, "com.lawrensen.hwinfo.sdPlugin/manifest.json"), JSON.stringify({ Version: versions[0] }));
		writeFileSync(join(root, "package.json"), JSON.stringify({ version: versions[1] }));
		writeFileSync(join(root, "package-lock.json"), JSON.stringify({ version: versions[2], packages: { "": { version: versions[3] } } }));
		if (changelog === null) rmSync(join(root, "CHANGELOG.md"), { force: true });
		else writeFileSync(join(root, "CHANGELOG.md"), changelog);
		return spawnSync(process.execPath, [join(root, "scripts/verify-release-tag.mjs")], {
			encoding: "utf8",
			env: { ...process.env, RELEASE_TAG: tag, GITHUB_OUTPUT: join(root, "output") }
		});
	}

	it("accepts an exact supported tag and writes only the verified version", () => {
		const result = run("v1.6.1");
		assert.equal(result.status, 0, result.stderr);
		assert.equal(readFileSync(join(root, "output"), "utf8"), "ver=1.6.1.0\n");
	});

	it("rejects shell syntax as data without executing it or emitting output", () => {
		const outputBefore = readFileSync(join(root, "output"), "utf8");
		for (const tag of ["v$(whoami)", "v`whoami`", 'v1.6.1";exit 0;#', `v$(New-Item '${join(root, "executed")}')`, "v1.6.1\nver=9.9.9.0"]) {
			assert.equal(run(tag).status, 1, tag);
		}
		assert.equal(existsSync(join(root, "executed")), false);
		assert.equal(readFileSync(join(root, "output"), "utf8"), outputBefore);
	});

	it("rejects missing prefixes, leading zeros, whitespace, partial matches and prereleases", () => {
		for (const tag of ["", "1.6.1", "vv1.6.1", "v01.6.1", "v1.06.1", "v1.6.01", "v1.6", "v1.6.1.0", "v1.6.1-rc.1", "v1.6.1+build", " v1.6.1", "v1.6.1\n", "v1.6.1 "]) {
			assert.equal(run(tag).status, 1, JSON.stringify(tag));
		}
	});

	it("rejects a tag whose CHANGELOG entry is missing, undated or for another version", () => {
		const outputBefore = readFileSync(join(root, "output"), "utf8");
		const undated = ["# Changelog\n", "# Changelog\n\n## 1.6.1.0 - Unreleased\n", "# Changelog\n\n## 1.6.0.0 - 2026-08-01\n", "# Changelog\n\n## 1.6.1.0\n", "# Changelog\n\n### 1.6.1.0 - 2026-08-11\n", "# Changelog\n\n## 1.6.10.0 - 2026-08-11\n"];
		for (const changelog of [null, ...undated]) {
			const result = run("v1.6.1", undefined, changelog);
			assert.equal(result.status, 1, JSON.stringify(changelog));
			assert.match(result.stderr, /CHANGELOG.md must carry a dated/);
		}
		assert.equal(readFileSync(join(root, "output"), "utf8"), outputBefore);
		assert.equal(run("v1.6.1").status, 0, "the dated entry restores acceptance");
	});

	it("rejects mismatched manifest, package, and either lockfile version", () => {
		for (let index = 0; index < 4; index++) {
			const versions = ["1.6.1.0", "1.6.1", "1.6.1", "1.6.1"];
			versions[index] = index === 0 ? "1.6.1.1" : "1.6.2";
			assert.equal(run("v1.6.1", versions).status, 1);
		}
	});
});

describe("ci workflow privilege boundary", () => {
	it("runs dependency installs and native builds under a read-only token", () => {
		const workflow = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
		const permissions = workflow.match(/^permissions:\n((?: {2}.*\n)+)/m);
		assert.ok(permissions, "ci.yml must declare workflow-level permissions");
		assert.equal(permissions[1], "  contents: read\n");
		assert.doesNotMatch(workflow, /^ {4}permissions:/m, "no job widens the workflow token");
	});
});

describe("release workflow privilege boundary", () => {
	it("validates a data-only tag before npm and restricts write access to staging", () => {
		const workflow = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");
		const build = workflow.slice(workflow.indexOf("  build:"), workflow.indexOf("  stage:"));
		const stage = workflow.slice(workflow.indexOf("  stage:"));
		assert.match(workflow, /permissions:\s*\n {2}contents: read/);
		assert.match(build, /RELEASE_TAG: \$\{\{ github.ref_name \}\}/);
		const verifyIndex = build.indexOf("node scripts/verify-release-tag.mjs");
		const installIndex = build.indexOf("run: npm ci");
		assert.ok(verifyIndex >= 0, "release verifier command must exist");
		assert.ok(installIndex >= 0, "dependency install command must exist");
		assert.ok(verifyIndex < installIndex, "release verifier must run before dependency installation");
		assert.doesNotMatch(build, /contents: write/);
		assert.match(stage, /needs: build/);
		assert.match(stage, /permissions:\s*\n {6}contents: write/);
		assert.doesNotMatch(stage, /run:|actions\/checkout|npm /);
		// The only ref expression is the env value. Ref text never becomes run
		// script source; action inputs/body receive verified build outputs.
		assert.equal(workflow.match(/\$\{\{ github.ref_name \}\}/g)?.length, 1);
	});
});
