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

/** Each job's text under `jobs:`, keyed by job id, in file order, with
 * comment lines dropped (a comment above the next job must neither satisfy
 * nor trip an assertion about this one). */
function jobsOf(workflow: string): Map<string, string> {
	const body = workflow
		.slice(workflow.indexOf("\njobs:\n") + "\njobs:\n".length)
		.split("\n")
		.filter((line) => !/^\s*#/.test(line))
		.join("\n");
	const jobs = new Map<string, string>();
	const starts = [...body.matchAll(/^ {2}([a-z][a-z0-9-]*):\n/gm)];
	starts.forEach((match, i) => jobs.set(match[1]!, body.slice(match.index, i + 1 < starts.length ? starts[i + 1]!.index : body.length)));
	return jobs;
}

/** The text of every `run:` value (inline or block scalar). */
function runBlocks(workflow: string): string[] {
	const lines = workflow.split("\n");
	const blocks: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const match = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[i]!);
		if (!match) continue;
		const indent = match[1]!.length;
		if (match[2] !== "|" && match[2] !== ">") {
			blocks.push(match[2]!);
			continue;
		}
		const block: string[] = [];
		while (i + 1 < lines.length && (lines[i + 1]!.trim() === "" || lines[i + 1]!.search(/\S/) > indent)) block.push(lines[++i]!);
		blocks.push(block.join("\n"));
	}
	return blocks;
}

describe("ci workflow privilege boundary", () => {
	const workflow = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
	it("runs dependency installs and native builds under a read-only token", () => {
		const permissions = workflow.match(/^permissions:\n((?: {2}.*\n)+)/m);
		assert.ok(permissions, "ci.yml must declare workflow-level permissions");
		assert.equal(permissions[1], "  contents: read\n");
		assert.doesNotMatch(workflow, /^ {4}permissions:/m, "no job widens the workflow token");
	});

	it("packs with the locked CLI, gates the bundle, and proves the signing checks on real signtool output", () => {
		assert.doesNotMatch(workflow, /npm (?:i|install) -g/, "no global install: the Elgato CLI is a locked devDependency");
		assert.match(jobsOf(workflow).get("verify") ?? "", /run: node scripts\/bundle-inventory\.mjs/);
		const selftest = jobsOf(workflow).get("signing-structure") ?? "";
		assert.match(selftest, /needs: verify/);
		assert.match(selftest, /run: node scripts\/signing-structure-selftest\.mjs --hwsm built\/hwsm\.node\n/);
		assert.doesNotMatch(selftest, /secrets\.|id-token/, "the selftest needs no credential");
	});
});

describe("release workflow privilege boundary", () => {
	const workflow = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");
	const jobs = jobsOf(workflow);
	const job = (id: string): string => {
		const text = jobs.get(id);
		assert.ok(text, `release.yml has a ${id} job`);
		return text;
	};

	it("runs build, sign, package and stage, in that order", () => {
		assert.deepEqual([...jobs.keys()], ["build", "sign", "package", "stage"]);
		assert.match(workflow, /^permissions:\n {2}contents: read\n/m);
	});

	it("validates a data-only tag before npm, and checks the signing mode there", () => {
		const build = job("build");
		assert.match(build, /RELEASE_TAG: \$\{\{ github.ref_name \}\}/);
		const verifyIndex = build.indexOf("node scripts/verify-release-tag.mjs");
		const modeIndex = build.indexOf("node scripts/signing-config-check.mjs --mode");
		const installIndex = build.indexOf("run: npm ci");
		assert.ok(verifyIndex >= 0 && modeIndex >= 0 && installIndex >= 0);
		assert.ok(verifyIndex < installIndex, "release verifier must run before dependency installation");
		assert.ok(modeIndex < installIndex, "a mistyped SIGNING_MODE fails before anything is built");
		assert.match(build, /SIGNING_MODE: \$\{\{ vars.SIGNING_MODE \}\}/);
		// The only ref expression is the env value. Ref text never becomes run
		// script source; action inputs/body receive verified build outputs.
		assert.equal(workflow.match(/\$\{\{ github.ref_name \}\}/g)?.length, 1);
	});

	it("gives write access to the stage job alone, and stage runs no repository code", () => {
		for (const [id, text] of jobs) {
			if (id === "stage") assert.match(text, /permissions:\n {6}contents: write\n/);
			else assert.doesNotMatch(text, /contents: write/, id);
		}
		const stage = job("stage");
		assert.match(stage, /needs: \[build, package\]/);
		assert.doesNotMatch(stage, /run:|actions\/checkout|npm /);
	});

	it("stages the draft whenever package passed, including when signing is off and the sign job is skipped", () => {
		// The implicit success() of a job without a condition covers every
		// upstream job, so the skipped sign job (signing off) would skip stage
		// even after package passed. Each job after sign needs a condition of
		// its own that does not reach past the jobs it names.
		assert.ok(job("stage").includes("\n    if: ${{ !cancelled() && needs.build.result == 'success' && needs.package.result == 'success' }}\n"), "stage must not inherit the skipped sign job's status");
		const order = [...jobs.keys()];
		for (const id of order.slice(order.indexOf("sign") + 1)) assert.match(job(id), /\n {4}if: \$\{\{ !cancelled\(\) && /, `${id} runs after the optional sign job and needs an explicit condition`);
	});

	it("lets only the sign job reach the signing identity, behind the protected environment and the explicit switch", () => {
		for (const [id, text] of jobs) {
			if (id === "sign") continue;
			assert.doesNotMatch(text, /id-token|environment:|secrets\./, id);
		}
		const sign = job("sign");
		assert.match(sign, /\n {4}needs: build\n/);
		assert.match(sign, /\n {4}if: vars\.SIGNING_MODE == 'required'\n/);
		assert.match(sign, /\n {4}environment: release-signing\n/);
		assert.match(sign, /\n {4}permissions:\n {6}contents: read\n {6}id-token: write\n {4}outputs:/);
		assert.doesNotMatch(sign, /npm |npx |cache: npm/, "the sign job installs nothing and runs no npm");
		assert.match(sign, /persist-credentials: false/);
	});

	it("signs through the pinned actions, OIDC only, timestamped, then verifies before anything leaves the job", () => {
		const sign = job("sign");
		const login = sign.indexOf("uses: azure/login@a641126d1b8aa4d1fa005f4f92df94a3a4c4c906 # v3.1.0");
		const signing = sign.indexOf("uses: azure/artifact-signing-action@c7ab2a863ab5f9a846ddb8265964877ef296ee82 # v2.0.0");
		const config = sign.indexOf("run: node scripts/signing-config-check.mjs");
		const expect = sign.indexOf("run: node scripts/authenticode-strip.mjs expect unsigned/hwsm.node");
		const verify = sign.indexOf("run: node scripts/verify-signed-native.mjs --signed signed --unsigned unsigned --out signed/signature.json");
		const upload = sign.indexOf("name: native-signed");
		assert.ok(expect >= 0 && config > expect && login > config && signing > login && verify > signing && upload > verify, "expect, config, login, sign, verify, upload");
		assert.doesNotMatch(sign, /client-secret|azure-password|creds:/, "no stored credential");
		for (const line of ["timestamp-rfc3161: http://timestamp.acs.microsoft.com", "timestamp-digest: SHA256", "file-digest: SHA256", "exclude-environment-credential: true", "exclude-workload-identity-credential: true", "exclude-managed-identity-credential: true", "cache-dependencies: false", "files: ${{ github.workspace }}\\signed\\hwsm.node\n"]) {
			assert.ok(sign.includes(line), line);
		}
		assert.match(sign, /EXPECT_SHA: \$\{\{ needs\.build\.outputs\.unsignedsha \}\}/);
	});

	it("packages only after signing passed, or when signing is not required", () => {
		const pack = job("package");
		assert.match(pack, /\n {4}needs: \[build, sign\]\n/);
		assert.ok(pack.includes("\n    if: ${{ !cancelled() && needs.build.result == 'success' && (needs.sign.result == 'success' || (needs.sign.result == 'skipped' && vars.SIGNING_MODE != 'required')) }}\n"), "a required signature that did not happen never packages");
		assert.match(pack, /\n {4}permissions:\n {6}contents: read\n {4}outputs:/);
	});

	it("packs the exact bytes the earlier jobs produced and qualifies the extracted package", () => {
		const pack = job("package");
		for (const variable of ["HWSM_VENDOR"]) {
			assert.match(pack, new RegExp(`${variable}: \\$\\{\\{ github\\.workspace \\}\\}/\\$\\{\\{ needs\\.sign\\.result == 'success' && 'native-signed' \\|\\| 'native-unsigned' \\}\\}/`));
		}
		assert.ok(pack.includes("HWSM_VENDOR_SHA256: ${{ needs.sign.result == 'success' && needs.sign.outputs.hwsm || needs.build.outputs.unsignedsha }}"));
		assert.match(pack, /EXPECTED: \$\{\{ needs\.build\.outputs\.pluginsha \}\}/);
		assert.match(pack, /run: node scripts\/native-manifest\.mjs --build-manifest native-unsigned\/release-native-manifest\.json --unsigned native-unsigned --carry-forward native-unsigned\/carry-forward\.json\n/);
		assert.match(pack, /run: node scripts\/native-manifest\.mjs --build-manifest native-unsigned\/release-native-manifest\.json --unsigned native-unsigned --carry-forward native-unsigned\/carry-forward\.json --signature native-signed\/signature\.json/);
		assert.match(pack, /HWSM_REQUIRE_SIGNED: \$\{\{ needs\.sign\.result == 'success' && '1' \|\| '' \}\}\n {8}run: node scripts\/validate-native\.mjs/);
		const qualify = /run: node scripts\/qualify\.mjs --stages (\S+) --out qualification-release/.exec(pack);
		assert.ok(qualify, "the package job runs the qualification");
		for (const stage of ["bundle", "pack", "archive", "abi", "recovery", "native-gate", "tree"]) assert.ok(qualify[1]!.split(",").includes(stage), stage);
		assert.ok(qualify[1]!.split(",").includes("native-identity"), "the record says which native bytes were qualified");
		assert.ok(pack.includes("--out qualification-release --native $env:NATIVE_DIR --native-manifest release-native-manifest.json"), "qualified against the files the earlier jobs handed on and the final manifest");
		assert.ok(pack.includes("NATIVE_DIR: ${{ needs.sign.result == 'success' && 'native-signed' || 'native-unsigned' }}"));
		const build = pack.indexOf("run: npm run build");
		const manifest = pack.indexOf("run: node scripts/native-manifest.mjs");
		const gate = pack.indexOf("run: node scripts/validate-native.mjs");
		const qualifyAt = pack.indexOf("run: node scripts/qualify.mjs");
		assert.ok(build >= 0 && manifest > build && gate > manifest && qualifyAt > gate, "build, manifest, gate, then pack and qualify");
	});

	it("never fails open: no continue-on-error, no global installs, and every action pinned to a commit", () => {
		for (const file of [".github/workflows/release.yml", ".github/workflows/ci.yml"]) {
			const text = readFileSync(join(ROOT, file), "utf8");
			for (const [, ref] of text.matchAll(/uses: ([^\s#]+)/g)) assert.match(ref!, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${file}: ${ref}`);
			assert.doesNotMatch(text, /continue-on-error/, file);
			assert.doesNotMatch(text, /npm (?:i|install) -g/, file);
		}
	});

	it("reads the previous release once, held to GitHub's digests, and carries forward before the unsigned hashes are taken", () => {
		const build = job("build");
		const at = (text: string): number => {
			const index = build.indexOf(text);
			assert.ok(index >= 0, text);
			return index;
		};
		const install = at("run: npm ci");
		assert.ok(at("run: node scripts/native-carry-forward.mjs --check-mode") < install, "a mistyped NATIVE_CARRY_FORWARD fails before anything is built");
		const read = at("name: Read the previous release");
		const drift = at("node scripts/native-drift.mjs --previous previous/release-native-manifest.json");
		const staged = at("name: Stage the unsigned native build");
		const carry = at("run: node scripts/native-carry-forward.mjs --dir native-unsigned --previous-dir previous");
		const hashes = at("name: Record the unsigned native hashes");
		const upload = at("name: native-unsigned");
		assert.ok(at("run: node scripts/validate-native.mjs") < read && read < drift && drift < staged && staged < carry && carry < hashes && hashes < upload, "gate, read, drift, stage, carry, hash, upload");
		assert.equal(build.match(/releases\/latest/g)?.length, 1, "one read of the previous release serves the drift check and the carry");
		for (const asset of ["release-native-manifest.json", "com.lawrensen.hwinfo.streamDeckPlugin", "hwsm.pdb"]) assert.ok(build.includes(`"${asset}"`), asset);
		assert.ok(build.includes('if ($asset.digest -and $asset.digest -ne "sha256:$got")'), "every previous asset is held to the digest GitHub records");
		assert.ok(build.includes("$verified[$name] = [bool]$asset.digest"), "the carry step learns which assets a digest actually checked");
		assert.equal(workflow.match(/NATIVE_CARRY_FORWARD: \$\{\{ vars\.NATIVE_CARRY_FORWARD \}\}/g)?.length, 2, "the switch reaches the check and the carry step, through env only");
		assert.match(build, /\n {6}unsignedsha: \$\{\{ steps\.unsigned\.outputs\.hwsm \}\}\n/, "the hashes the sign and package jobs hold the bytes to are taken after the carry");
		assert.ok(job("stage").includes("${{ needs.package.outputs.carried }}"), "the release notes say when a binary is the earlier release's file");
	});

	it("passes expression data to scripts only through env, never into run text", () => {
		for (const file of [".github/workflows/release.yml", ".github/workflows/ci.yml"]) {
			for (const block of runBlocks(readFileSync(join(ROOT, file), "utf8"))) assert.doesNotMatch(block, /\$\{\{/, `${file}: ${block.slice(0, 80)}`);
		}
	});

	it("keeps the unsigned release text when signing is off and names the signer and timestamp when on", () => {
		const stage = job("stage");
		assert.ok(stage.includes("${{ needs.package.outputs.signed == 'true' && format('The native addon is Authenticode-signed by {0} through Azure Artifact Signing, timestamped {1}."));
		assert.ok(stage.includes("|| 'The native addon is unsigned; verify your download against the hashes above with `Get-FileHash <file> -Algorithm SHA256` (PowerShell).' }} Details in [SECURITY.md]"));
		assert.doesNotMatch(stage, /SmartScreen|Smart App Control|antivirus|VirusTotal|Defender/i, "a signature is not a reputation or antivirus claim");
		for (const output of ["sha", "size", "nativesha", "unsignedsha", "signed", "signer", "timestamp", "carried"]) assert.match(job("package"), new RegExp(`\\n {6}${output}: \\$\\{\\{ steps\\.hash\\.outputs\\.${output} \\}\\}\\n`), output);
	});
});

describe("the shipped NOTICE carries every bundled license (external review AX32)", () => {
	// What rollup bundles into bin/plugin.js (measured: @elgato/streamdeck,
	// @elgato/utils, @elgato/schemas, ws, tslib), the sdpi-components client
	// and stores ui/pi-client.js ports, and the icon path data copied from
	// Lucide and Feather into the panels. Each license ships whole, under its own
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
	const header = readFileSync(join(ROOT, "com.lawrensen.hwinfo.sdPlugin/ui/pi-client.js"), "utf8").slice(0, 400);

	it("lists each license once, as a top-level section, with nothing hidden", () => {
		assert.deepEqual(headings, [
			"Lucide license (ISC)",
			"Feather license (MIT), for the `link` icon",
			"Elgato Stream Deck SDK and @elgato/utils license (MIT)",
			"@elgato/schemas license (MIT)",
			"sdpi-components license (MIT)",
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
});
