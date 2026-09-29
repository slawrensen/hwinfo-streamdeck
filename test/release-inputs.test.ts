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

	it("accepts a dated heading under CRLF line endings and with trailing whitespace", () => {
		for (const changelog of [datedEntry.replaceAll("\n", "\r\n"), datedEntry.replace("2026-08-11", "2026-08-11  "), datedEntry.replace("2026-08-11", "2026-08-11\t")]) {
			assert.equal(run("v1.6.1", undefined, changelog).status, 0, JSON.stringify(changelog));
		}
	});

	it("rejects mismatched manifest, package, and either lockfile version", () => {
		for (let index = 0; index < 4; index++) {
			const versions = ["1.6.1.0", "1.6.1", "1.6.1", "1.6.1"];
			versions[index] = index === 0 ? "1.6.1.1" : "1.6.2";
			assert.equal(run("v1.6.1", versions).status, 1);
		}
	});
});

// The Marketplace images carry text a PNG check cannot read, so the copy
// gate reads their generator as copy (external review AX55). Run over a
// fixture tree: only the generator's line is asserted here.
describe("release copy gate", () => {
	it("checks the Marketplace image generator's text as copy", () => {
		const root = mkdtempSync(join(tmpdir(), "hwinfo-release-copy-"));
		try {
			mkdirSync(join(root, "scripts"));
			mkdirSync(join(root, "docs"));
			cpSync(join(ROOT, "scripts/validate-release-copy.mjs"), join(root, "scripts/validate-release-copy.mjs"));
			writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.0.0" }));
			writeFileSync(join(root, "scripts/marketplace-shots.mjs"), 'const headline = "Effortless readings";\n');
			const result = spawnSync(process.execPath, [join(root, "scripts/validate-release-copy.mjs")], { encoding: "utf8" });
			assert.match(result.stderr, /FAIL {2}scripts\/marketplace-shots\.mjs:1 {2}"effortless" claim/);
		} finally {
			rmSync(root, { recursive: true, force: true });
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

describe("the shipped NOTICE carries every bundled license (external review AX32)", () => {
	// What rollup bundles into bin/plugin.js (measured: @elgato/streamdeck,
	// @elgato/utils, @elgato/schemas, ws, tslib), the Lit code inside the
	// vendored sdpi-components.js, and the icon path data copied from Lucide
	// and Feather into the panels. Each license ships whole, under its own
	// top-level heading, once, and visible: the file is read as the section
	// list it renders to, so a deleted, demoted, doubled or commented-out
	// license fails (external review AX53).
	const flat = (text: string): string => text.replace(/\s+/g, " ").trim();
	const raw = readFileSync(join(ROOT, "NOTICE.md"), "utf8");
	const headings: string[] = [];
	const sections = new Map<string, string>();
	for (const part of raw.split(/^## /m).slice(1)) {
		const heading = part.slice(0, part.indexOf("\n"));
		headings.push(heading);
		sections.set(heading, flat(part.slice(heading.length + 1)));
	}
	const read = (file: string): string => readFileSync(join(ROOT, "node_modules", file), "utf8");
	const sdk = read("@elgato/streamdeck/LICENSE");
	const mitTerms = sdk.slice(sdk.indexOf("Permission is hereby granted"));
	const header = readFileSync(join(ROOT, "com.lawrensen.hwinfo.sdPlugin/ui/sdpi-components.js"), "utf8").slice(0, 400);

	it("lists each license once, as a top-level section, with nothing hidden", () => {
		assert.deepEqual(headings, [
			"Lucide license (ISC)",
			"Feather license (MIT), for the `link` icon",
			"Elgato Stream Deck SDK and @elgato/utils license (MIT)",
			"@elgato/schemas license (MIT)",
			"sdpi-components license (MIT)",
			"Lit license (BSD-3-Clause), bundled in sdpi-components",
			"ws license (MIT)",
			"tslib license (0BSD)"
		]);
		assert.doesNotMatch(raw, /<!--/, "an HTML comment would hide text from the rendered NOTICE");
	});
	for (const [heading, files] of [
		["Elgato Stream Deck SDK and @elgato/utils license (MIT)", ["@elgato/streamdeck/LICENSE", "@elgato/utils/LICENSE"]],
		["@elgato/schemas license (MIT)", ["@elgato/schemas/LICENSE"]],
		["ws license (MIT)", ["ws/LICENSE"]],
		["tslib license (0BSD)", ["tslib/LICENSE.txt"]]
	] as const) {
		it(`${files.map((f) => f.split("/").slice(0, -1).join("/")).join(" and ")}: the section is exactly the package's license file`, () => {
			for (const file of files) assert.equal(sections.get(heading), flat(read(file)), file);
		});
	}
	it("sdpi-components: its copyright and the complete MIT license", () => {
		assert.match(header, /sdpi-components v[\d.]+, Copyright Corsair Memory Inc\. and other contributors/);
		assert.ok(mitTerms.length > 900, "the MIT terms were found in the SDK's license");
		assert.equal(sections.get("sdpi-components license (MIT)"), flat(`Copyright Corsair Memory Inc. and other contributors\n\n${mitTerms}`));
	});
	it("Feather, for the link icon: its copyright and the complete MIT license", () => {
		assert.equal(sections.get("Feather license (MIT), for the `link` icon"), flat(`Copyright (c) 2013-present Cole Bemis\n\n${mitTerms}`));
	});
	it("Lucide: its copyright and the complete ISC license", () => {
		assert.equal(
			sections.get("Lucide license (ISC)"),
			flat(`Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`)
		);
	});
	it("Lit, inside sdpi-components: its copyright, the three conditions and the disclaimer", () => {
		assert.match(header, /Lit, Copyright 2019 Google LLC, SPDX-License-Identifier: BSD-3-Clause/);
		assert.equal(
			sections.get("Lit license (BSD-3-Clause), bundled in sdpi-components"),
			flat(`Copyright 2019 Google LLC

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`)
		);
	});
});
