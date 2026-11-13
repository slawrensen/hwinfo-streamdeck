// The drift classifier (scripts/lib/native-drift.mjs, scripts/native-drift.mjs)
// must name the input that moved when native bytes move with unchanged
// source, fail only when nothing recorded moved, and explain a pre-record
// previous release from its binaries. The 1.7.0 -> 1.7.1 case is the real
// one: test/fixtures/native-drift-1.7.0-1.7.1.json carries both published
// manifests and the PE facts of both released hwsm.node files.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { binariesOf, classifyDrift, describePeDelta, renderDriftMarkdown } from "../scripts/lib/native-drift.mjs";
import { buildPe } from "../scripts/lib/pe-fixture.mjs";
import { PLUGIN_ROOT } from "../scripts/lib/pack-contract.mjs";
import { writeZip } from "../scripts/lib/zip.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const real = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", "native-drift-1.7.0-1.7.1.json"), "utf8"));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "hwinfo-native-drift-"));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const KERNEL32 = "lib/10.0.26100.0/um/x64/kernel32.lib";
function toolchain({ kernel32 = "a".repeat(64), servicing = "10.0.26100.7705", digest = "1".repeat(64), cl = "19.51.36260.0" } = {}) {
	const binary = { target: "hwsm", inputs: [{ root: "<kits>", path: KERNEL32, sha256: kernel32, bytes: 1 }, { root: "<msvc>", path: "lib/x64/libcmt.lib", sha256: "c".repeat(64), bytes: 1 }], excluded: 0, commandLines: { cl: ["/c x"], link: ["/OUT:x"], rc: [] }, commandLinesDigest: "d".repeat(64), inputsDigest: digest };
	return { recordVersion: 1, runnerImage: { os: "win25", version: "20261021.278.1" }, vsInstance: { version: "18.11.12315.225" }, msvc: { toolsVersion: "14.51.36231", clFileVersion: cl, linkFileVersion: "14.51.36260.0" }, windowsSdk: { targetPlatformVersion: "10.0.26100.0", servicingVersion: servicing }, nodeHeaders: { version: "20.20.0", nodeLibSha256: "9".repeat(64), headersDigest: "8".repeat(64), commonGypiSha256: "7".repeat(64) }, nodeGyp: { version: "12.4.0", addonGypiSha256: "6".repeat(64), delayLoadHookSha256: "5".repeat(64) }, env: { CL: null, _CL_: null, LINK: null, _LINK_: null }, tools: [{ root: "<msvc>", path: "bin/hostx64/x64/link.exe", sha256: "4".repeat(64), fileVersion: "14.51.36260.0" }], binaries: { "hwsm.node": binary }, inputsDigest: digest };
}
function v2(sha, { sourceId = "9a59578e9b066121", tc = toolchain(), unsignedSha256, pe = {} } = {}) {
	return { file: "hwsm.node", sha256: sha, nativeSourceId: sourceId, manifestVersion: 2, binaries: [{ file: "hwsm.node", sha256: sha, ...(unsignedSha256 ? { unsignedSha256 } : {}), nativeSourceId: sourceId, nativeVersion: "1.1.0", ...pe }], toolchain: tc };
}
const classOf = (report, file = "hwsm.node") => report.results.find((result) => result.file === file).class;

describe("native drift classes", () => {
	it("reads a version 1 manifest as a description of hwsm.node alone", () => {
		assert.deepEqual(binariesOf(real["v1.7.1"].manifest).map((record) => [record.file, record.sha256.slice(0, 8)]), [["hwsm.node", "7aa0d75a"]]);
		assert.deepEqual(binariesOf({}), []);
	});

	it("identical bytes, and an unsigned identity that equals the previous bytes", () => {
		assert.equal(classOf(classifyDrift({ previous: v2("a".repeat(64)), current: v2("a".repeat(64)) })), "identical");
		assert.equal(classOf(classifyDrift({ previous: v2("a".repeat(64)), current: v2("b".repeat(64), { unsignedSha256: "a".repeat(64) }) })), "identical", "a signed copy of the same build is not drift");
	});

	it("a binary the previous release did not ship is new", () => {
		const current = v2("a".repeat(64));
		current.binaries.push({ file: "next.node", sha256: "e".repeat(64), nativeSourceId: "9eb8336ed3ab89ee", nativeVersion: "1.0.0" });
		const report = classifyDrift({ previous: real["v1.7.1"].manifest, current });
		assert.equal(classOf(report, "next.node"), "new-binary");
		assert.equal(report.failed, false);
	});

	it("a moved source id means different bytes are expected", () => {
		const report = classifyDrift({ previous: v2("a".repeat(64)), current: v2("b".repeat(64), { sourceId: "0000000000000001" }) });
		assert.equal(classOf(report), "source-changed");
		assert.match(report.results[0].reasons[0], /native source id 9a59578e9b066121 -> 0000000000000001/);
	});

	it("same source with moved inputs names the library and the SDK servicing build that moved", () => {
		const previous = v2("a".repeat(64), { tc: toolchain() });
		const current = v2("b".repeat(64), { tc: toolchain({ kernel32: "b".repeat(64), servicing: "10.0.26100.8249", digest: "2".repeat(64) }) });
		const report = classifyDrift({ previous, current });
		assert.equal(classOf(report), "toolchain-changed");
		assert.equal(report.failed, false);
		const reasons = report.results[0].reasons;
		assert.ok(reasons.includes(`<kits>/${KERNEL32} aaaaaaaaaaaa -> bbbbbbbbbbbb`), reasons.join("\n"));
		assert.ok(reasons.includes('Windows SDK servicing build "10.0.26100.7705" -> "10.0.26100.8249"'), reasons.join("\n"));
		assert.ok(!reasons.some((line) => line.includes("libcmt")), "an input that did not move is not named");
	});

	it("a previous release that carried hwsm.node forward is compared by its rebuild", () => {
		// 1.8.0-style manifest: it shipped 1.7.1's 7aa0d75a and recorded its
		// own rebuild (r...) and that rebuild's toolchain.
		const carriedPrevious = v2("7".repeat(64), { tc: toolchain() });
		carriedPrevious.binaries[0].unsignedSha256 = "7".repeat(64);
		carriedPrevious.binaries[0].reproducibility = { carriedFrom: { release: "v1.7.1", firstShippedIn: "v1.7.1", sha256: "7".repeat(64), unsignedSha256: "7".repeat(64) }, rebuiltSha256: "r".repeat(64), rebuiltIdentical: false };
		const same = classifyDrift({ previous: carriedPrevious, current: v2("r".repeat(64)) });
		assert.equal(classOf(same), "identical", "this build reproduces the previous release's rebuild");
		assert.equal(same.results[0].previousSha256, "r".repeat(64));
		assert.match(same.results[0].reasons[0], /shipped 777777777777, carried forward from v1\.7\.1; compared with that release's rebuild rrrrrrrrrrrr/);
		const unexplained = classifyDrift({ previous: carriedPrevious, current: v2("b".repeat(64)) });
		assert.equal(classOf(unexplained), "unexplained", "same inputs as the recorded rebuild, other bytes");
		assert.equal(unexplained.failed, true);
		const moved = classifyDrift({ previous: carriedPrevious, current: v2("b".repeat(64), { tc: toolchain({ kernel32: "b".repeat(64), digest: "2".repeat(64) }) }) });
		assert.equal(classOf(moved), "toolchain-changed", "the rebuild's toolchain is what the inputs are compared with");
		assert.equal(moved.failed, false);
		assert.equal(classOf(classifyDrift({ previous: carriedPrevious, current: v2("7".repeat(64)) })), "identical", "shipping the same carried bytes again is identical");
	});

	it("same source and same recorded inputs with moved bytes is unexplained and fails", () => {
		const report = classifyDrift({ previous: v2("a".repeat(64)), current: v2("b".repeat(64)) });
		assert.equal(classOf(report), "unexplained");
		assert.equal(report.failed, true);
		assert.match(report.results[0].reasons[0], /same recorded inputs \(inputsDigest 111111111111\)/);
	});

	it("a build with no toolchain record cannot explain a move, and says so", () => {
		const report = classifyDrift({ previous: v2("a".repeat(64)), current: v2("b".repeat(64), { tc: null }) });
		assert.equal(classOf(report), "unrecorded");
		assert.equal(report.failed, false);
	});

	it("explains 1.7.0 -> 1.7.1 from the binaries: .rdata and the headers only, KERNEL32 hints +5", () => {
		const previous = real["v1.7.0"].manifest;
		const current = v2(real["v1.7.1"].manifest.sha256, { pe: real["v1.7.1"].pe });
		const report = classifyDrift({ previous, current, previousPe: new Map([["hwsm.node", real["v1.7.0"].pe]]) });
		assert.equal(classOf(report), "legacy-previous");
		assert.equal(report.failed, false);
		const { pe } = report.results[0];
		assert.deepEqual(pe.sections.differ, [".rdata"]);
		assert.deepEqual(pe.sections.equal, [".text", ".data", ".pdata", ".didat", ".fptable", ".rsrc", ".reloc"]);
		const kernel32 = pe.imports.find((entry) => entry.dll === "KERNEL32.dll");
		assert.deepEqual({ moved: kernel32.moved, uniformShift: kernel32.uniformShift, added: kernel32.added, removed: kernel32.removed }, { moved: 79, uniformShift: 5, added: [], removed: [] });
		assert.equal(pe.imports.find((entry) => entry.dll === "ADVAPI32.dll").moved, 0);
		assert.equal(describePeDelta(pe), "sections .rdata differ (.text, .data, .pdata, .didat, .fptable, .rsrc, .reloc equal); KERNEL32.dll import hints shifted +5 (79 of 79 names); headers differ");
		assert.ok(report.results[0].reasons.some((line) => line.startsWith("previous compiler 19.51.36260, SDK 10.0.26100.0")));
		const markdown = renderDriftMarkdown(report, { previousLabel: "v1.7.0", currentLabel: "v1.7.1" });
		assert.match(markdown, /\| hwsm\.node \| legacy-previous \| `4066d09cf89e` \| `7aa0d75a88f0` \|/);
	});

	it("a pre-record previous release with no binary to compare says that too", () => {
		const report = classifyDrift({ previous: real["v1.7.0"].manifest, current: v2(real["v1.7.1"].manifest.sha256) });
		assert.equal(classOf(report), "legacy-previous");
		assert.ok(report.results[0].reasons.includes("no previous binary was available to compare sections and imports"));
	});
});

describe("native drift command", () => {
	const script = path.join(ROOT, "scripts", "native-drift.mjs");
	const write = (name, value) => {
		const file = path.join(scratch, name);
		fs.writeFileSync(file, typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value));
		return file;
	};
	const run = (args, env = {}) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: undefined, GITHUB_STEP_SUMMARY: undefined, ...env } });

	it("fails on unexplained drift and writes the job summary", () => {
		const summary = write("summary.md", "");
		const r = run(["--current", write("cur.json", v2("b".repeat(64))), "--previous", write("prev.json", v2("a".repeat(64)))], { GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: summary });
		assert.equal(r.status, 1, r.stdout);
		assert.match(r.stderr, /NATIVE DRIFT: bytes moved with unchanged source and unchanged recorded inputs/);
		assert.match(r.stdout, /::error title=native bytes moved::hwsm\.node unexplained/);
		assert.match(fs.readFileSync(summary, "utf8"), /\| hwsm\.node \| unexplained \|/);
	});

	it("passes toolchain-changed with a warning annotation", () => {
		const r = run(["--current", write("cur2.json", v2("b".repeat(64), { tc: toolchain({ cl: "19.51.36300.0", digest: "3".repeat(64) }) })), "--previous", write("prev2.json", v2("a".repeat(64)))], { GITHUB_ACTIONS: "true" });
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, /::warning title=native bytes moved::hwsm\.node toolchain-changed: cl\.exe "19\.51\.36260\.0" -> "19\.51\.36300\.0"/);
	});

	it("treats a missing previous manifest as a notice, not a failure", () => {
		const r = run(["--current", write("cur3.json", v2("b".repeat(64))), "--previous", path.join(scratch, "absent.json")], { GITHUB_ACTIONS: "true" });
		assert.equal(r.status, 0);
		assert.match(r.stdout, /::notice title=native drift check skipped::/);
	});

	it("reads the previous binaries out of the previous release pack", () => {
		const before = buildPe({ pdb: "hwsm.pdb", imports: { "KERNEL32.dll": { CloseHandle: 137, OpenFileMappingW: 1079 } } });
		const pack = write("prev.streamDeckPlugin", writeZip([{ name: `${PLUGIN_ROOT}/bin/hwsm.node`, data: before }, { name: `${PLUGIN_ROOT}/manifest.json`, data: Buffer.from("{}") }]));
		const afterPe = { sections: [{ name: ".text", rawPointer: 512, rawSize: 512, sha256: "0".repeat(64) }], importHints: { "KERNEL32.dll": { CloseHandle: 142, OpenFileMappingW: 1084 } }, headersNeutralSha256: "f".repeat(64) };
		const r = run(["--current", write("cur4.json", v2("b".repeat(64), { pe: afterPe })), "--previous", write("prev4.json", { file: "hwsm.node", sha256: "a".repeat(64), nativeSourceId: "9a59578e9b066121", nativeVersion: "1.1.0" }), "--previous-pack", pack, "--previous-label", "v1.7.1"]);
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, /### Native drift: this build against v1\.7\.1/);
		assert.match(r.stdout, /binary: sections \.text differ \(none equal\); sections removed: \.rdata; KERNEL32\.dll import hints shifted \+5 \(2 of 2 names\); headers differ/);
	});
});
