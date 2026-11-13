// Carry-forward of unchanged native binaries (scripts/lib/native-carry-forward.mjs,
// scripts/native-carry-forward.mjs): when the previous release recorded the
// same native source id for a binary, the release ships that release's
// exact unsigned binary with its PDB, and keeps this run's rebuild as
// evidence. Anything that does not prove the carried file is the one the
// previous release published is a refusal, never a silent rebuild. Runs on
// synthetic PE32+ images and PDB headers, so no native build is needed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { authenticodeImageDigest } from "../scripts/lib/authenticode.mjs";
import { carryForwardMode, carryForwardRecord, guidBytes, pdbMatches, planCarryForward } from "../scripts/lib/native-carry-forward.mjs";
import { PLUGIN_ROOT } from "../scripts/lib/pack-contract.mjs";
import { buildPe, fakeSign } from "../scripts/lib/pe-fixture.mjs";
import { parsePe } from "../scripts/lib/pe.mjs";
import { writeZip } from "../scripts/lib/zip.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const dirs = [];
after(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });
const temp = () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwinfo-carry-"));
	dirs.push(dir);
	return dir;
};

const HWSM_SOURCE = "9a59578e9b066121";
const NEXT_SOURCE = "9eb8336ed3ab89ee";
const SHIPPED_GUID = "46A9BD55-55B8-CE9F-A61B-826D48FE5A5F";

/** A PDB header good enough for the match: MSF 7.00 magic, then a PDB info
 * stream (version 20000404, signature, age, GUID) somewhere inside. */
function pdbFor(guid, age = 1) {
	const info = Buffer.alloc(28);
	info.writeUInt32LE(20000404, 0);
	info.writeUInt32LE(0x12345678, 4);
	info.writeUInt32LE(age, 8);
	guidBytes(guid).copy(info, 12);
	return Buffer.concat([Buffer.from("Microsoft C/C++ MSF 7.00\r\n\x1aDS\0\0\0", "latin1"), Buffer.alloc(100), info, Buffer.alloc(64)]);
}

/** The shipped 1.7.1-style hwsm.node, this run's rebuild of the same
 * source, a binary the previous release never shipped (next.node, a
 * stand-in for a second addon), and the manifests that describe them. */
function fixture() {
	const shipped = buildPe({ code: Buffer.from("hwsm as 1.7.1 shipped it"), pdb: "hwsm.pdb", guid: SHIPPED_GUID });
	const rebuild = buildPe({ code: Buffer.from("hwsm rebuilt on a newer image"), pdb: "hwsm.pdb", guid: "11111111-2222-3333-4444-555555555555" });
	const next = buildPe({ code: Buffer.from("next"), pdb: "next.pdb", guid: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE" });
	const current = {
		file: "hwsm.node",
		sha256: sha256(rebuild),
		nativeSourceId: HWSM_SOURCE,
		manifestVersion: 2,
		binaries: [
			{ file: "hwsm.node", sha256: sha256(rebuild), unsignedSha256: sha256(rebuild), nativeSourceId: HWSM_SOURCE, nativeVersion: "1.1.0" },
			{ file: "next.node", sha256: sha256(next), unsignedSha256: sha256(next), nativeSourceId: NEXT_SOURCE, nativeVersion: "1.0.0" }
		]
	};
	// The version 1 manifest 1.7.1 published: hwsm.node alone, top level.
	const previous = { file: "hwsm.node", sha256: sha256(shipped), nativeSourceId: HWSM_SOURCE, nativeVersion: "1.1.0", compilerVersion: "19.51.36260", windowsSdkVersion: "10.0.26100.0" };
	return { shipped, rebuild, next, current, previous, rebuilt: new Map([["hwsm.node", rebuild], ["next.node", next]]), members: new Map([["hwsm.node", shipped]]), pdbs: new Map([["hwsm.pdb", pdbFor(SHIPPED_GUID)]]) };
}

const plan = (f, overrides = {}) => planCarryForward({ current: f.current, rebuilt: f.rebuilt, previous: f.previous, previousLabel: "v1.7.1", previousMembers: f.members, previousPdbs: f.pdbs, mode: "on", ...overrides });
const decision = (result, file) => result.decisions.find((entry) => entry.file === file);

describe("native carry-forward: the decision", () => {
	it("ships the previous release's hwsm.node and PDB when its source is unchanged, and keeps the rebuild as evidence", () => {
		const f = fixture();
		const result = plan(f);
		assert.deepEqual(result.problems, []);
		const hwsm = decision(result, "hwsm.node");
		assert.equal(hwsm.decision, "carried");
		assert.ok(hwsm.bytes.equals(f.shipped), "the shipped bytes, not the rebuild");
		assert.ok(hwsm.pdb.equals(f.pdbs.get("hwsm.pdb")));
		assert.deepEqual(hwsm.record, {
			decision: "carried",
			reason: `its native source ${HWSM_SOURCE} is unchanged since v1.7.1`,
			sha256: sha256(f.shipped),
			rebuiltSha256: sha256(f.rebuild),
			carriedFrom: { release: "v1.7.1", firstShippedIn: "v1.7.1", sha256: sha256(f.shipped), unsignedSha256: sha256(f.shipped) }
		});
		const next = decision(result, "next.node");
		assert.equal(next.decision, "rebuilt");
		assert.equal(next.reason, "v1.7.1 did not ship it");
		assert.ok(next.bytes.equals(f.next));
		assert.deepEqual(result.previous, { release: "v1.7.1", compilerVersion: "19.51.36260", windowsSdkVersion: "10.0.26100.0" });
		assert.deepEqual(Object.keys(carryForwardRecord(result, "on").binaries), ["hwsm.node", "next.node"]);
	});

	it("ships the rebuild when the source changed, when switched off, or when there is no previous release", () => {
		const f = fixture();
		const changed = plan(f, { previous: { ...f.previous, nativeSourceId: "0000000000000001" } });
		assert.deepEqual(changed.problems, []);
		assert.equal(decision(changed, "hwsm.node").decision, "rebuilt");
		assert.match(decision(changed, "hwsm.node").reason, /native source changed since v1\.7\.1 \(0000000000000001 -> 9a59578e9b066121\)/);
		const versionMoved = plan(f, { previous: { ...f.previous, nativeVersion: "1.0.9" } });
		assert.match(decision(versionMoved, "hwsm.node").reason, /native version changed/);
		const off = plan(f, { mode: "off" });
		assert.deepEqual(off.decisions.map((entry) => [entry.file, entry.decision, entry.reason]), [["hwsm.node", "rebuilt", "NATIVE_CARRY_FORWARD is off"], ["next.node", "rebuilt", "NATIVE_CARRY_FORWARD is off"]]);
		assert.ok(decision(off, "hwsm.node").bytes.equals(f.rebuild));
		const none = plan(f, { previous: null });
		assert.equal(decision(none, "hwsm.node").reason, "there is no previous release to carry from");
		assert.equal(none.previous, null);
		const noId = plan(f, { previous: { ...f.previous, nativeSourceId: null } });
		assert.match(decision(noId, "hwsm.node").reason, /v1\.7\.1 records no native source id/);
	});

	it("carries a signed previous binary as its unsigned build", () => {
		const f = fixture();
		const signed = fakeSign(f.shipped, { digestHex: authenticodeImageDigest(f.shipped) });
		const previous = { ...f.previous, sha256: sha256(signed), unsignedSha256: sha256(f.shipped) };
		const result = plan(f, { previous, previousMembers: new Map([["hwsm.node", signed]]) });
		assert.deepEqual(result.problems, []);
		const hwsm = decision(result, "hwsm.node");
		assert.ok(hwsm.bytes.equals(f.shipped), "the signature comes off: the release signs (or not) on its own");
		assert.equal(hwsm.record.carriedFrom.sha256, sha256(signed));
		assert.equal(hwsm.record.carriedFrom.unsignedSha256, sha256(f.shipped));
		const wrong = plan(f, { previous: { ...previous, unsignedSha256: "0".repeat(64) }, previousMembers: new Map([["hwsm.node", signed]]) });
		assert.match(wrong.problems.join("\n"), /hwsm\.node from v1\.7\.1 without its signature is [0-9a-f]{12}, its manifest records the unsigned build as 000000000000/);
	});

	it("keeps the release the bytes first shipped in across a chain of carries", () => {
		const f = fixture();
		const previous = { manifestVersion: 2, binaries: [{ file: "hwsm.node", sha256: sha256(f.shipped), unsignedSha256: sha256(f.shipped), nativeSourceId: HWSM_SOURCE, nativeVersion: "1.1.0", reproducibility: { carriedFrom: { release: "v1.7.1", firstShippedIn: "v1.7.1" }, rebuiltSha256: "9".repeat(64) } }] };
		const result = plan(f, { previous, previousLabel: "v1.8.0" });
		assert.deepEqual(result.problems, []);
		assert.deepEqual(decision(result, "hwsm.node").record.carriedFrom, { release: "v1.8.0", firstShippedIn: "v1.7.1", sha256: sha256(f.shipped), unsignedSha256: sha256(f.shipped) });
	});

	it("refuses, rather than rebuilds, when the carried file cannot be proven to be the published one", () => {
		const f = fixture();
		const cases = [
			[{ previousMembers: new Map() }, /v1\.7\.1 shipped hwsm\.node from native source 9a59578e9b066121, the source this build has, but its pack was not read or carries no bin\/hwsm\.node/],
			[{ previous: { ...f.previous, sha256: "0".repeat(64) } }, /bin\/hwsm\.node in v1\.7\.1's pack is [0-9a-f]{12}, its manifest records 000000000000/],
			[{ previousMembers: new Map([["hwsm.node", Buffer.concat([f.shipped, Buffer.from("tail")])]]), previous: { ...f.previous, sha256: sha256(Buffer.concat([f.shipped, Buffer.from("tail")])) } }, /bin\/hwsm\.node in v1\.7\.1's pack: 4 bytes follow the last section/],
			[{ previousPdbs: new Map() }, /v1\.7\.1 attaches no readable hwsm\.pdb/],
			[{ previousPdbs: new Map([["hwsm.pdb", pdbFor("11111111-2222-3333-4444-555555555555")]]) }, /hwsm\.pdb from v1\.7\.1 is not the program database of its hwsm\.node \(CodeView 46A9BD55-55B8-CE9F-A61B-826D48FE5A5F age 1\)/]
		];
		for (const [overrides, pattern] of cases) {
			const result = plan(f, overrides);
			assert.match(result.problems.join("\n"), pattern);
			assert.equal(decision(result, "hwsm.node"), undefined, "no decision for a binary that was refused");
		}
	});

	it("rests a carry only on assets whose digest was checked, when the caller says which", () => {
		const f = fixture();
		const all = new Set(["release-native-manifest.json", "com.lawrensen.hwinfo.streamDeckPlugin", "hwsm.pdb"]);
		assert.deepEqual(plan(f, { previousVerified: all }).problems, []);
		const noPack = plan(f, { previousVerified: new Set(["release-native-manifest.json", "hwsm.pdb"]) });
		assert.match(noPack.problems.join("\n"), /no digest the downloaded com\.lawrensen\.hwinfo\.streamDeckPlugin of v1\.7\.1 was checked against/);
		assert.equal(decision(noPack, "hwsm.node"), undefined);
		assert.equal(decision(noPack, "next.node").decision, "rebuilt", "a binary that is not carried needs no previous asset");
	});

	it("refuses a rebuild that is not the one this run's manifest describes", () => {
		const f = fixture();
		const result = plan(f, { rebuilt: new Map([["hwsm.node", f.next], ["next.node", f.next]]) });
		assert.match(result.problems.join("\n"), /this run's hwsm\.node is [0-9a-f]{12}, its manifest records [0-9a-f]{12}/);
	});
});

describe("native carry-forward: helpers", () => {
	it("reads NATIVE_CARRY_FORWARD as on, off, or a mistake", () => {
		for (const value of [undefined, "", "on"]) assert.equal(carryForwardMode(value), "on", JSON.stringify(value));
		assert.equal(carryForwardMode("off"), "off");
		for (const value of ["Off", "false", "0", "no", " off"]) assert.equal(carryForwardMode(value), null, value);
	});

	it("matches a PDB by the GUID and age of the binary's CodeView record", () => {
		const pe = parsePe(buildPe({ pdb: "hwsm.pdb", guid: SHIPPED_GUID }));
		assert.equal(pdbMatches(pdbFor(SHIPPED_GUID), pe.codeView), true);
		assert.equal(pdbMatches(pdbFor(SHIPPED_GUID, 2), pe.codeView), false, "another age is another link");
		assert.equal(pdbMatches(pdbFor("11111111-2222-3333-4444-555555555555"), pe.codeView), false);
		assert.equal(pdbMatches(Buffer.concat([Buffer.alloc(32), pdbFor(SHIPPED_GUID).subarray(32)]), pe.codeView), false, "not an MSF file");
		assert.equal(pdbMatches(pdbFor(SHIPPED_GUID), null), false);
		assert.throws(() => guidBytes("not-a-guid"), /is not a GUID/);
	});
});

describe("native carry-forward: the release step", () => {
	/** native-unsigned/ as the build job stages it, and previous/ as the
	 * read step leaves it. */
	function stageRun({ status = "read", pack = true, pdb = true, digestVerified = { "release-native-manifest.json": true, "com.lawrensen.hwinfo.streamDeckPlugin": true, "hwsm.pdb": true } } = {}) {
		const f = fixture();
		const root = temp();
		const dir = path.join(root, "native-unsigned");
		const previousDir = path.join(root, "previous");
		fs.mkdirSync(dir);
		fs.mkdirSync(previousDir);
		fs.writeFileSync(path.join(dir, "hwsm.node"), f.rebuild);
		fs.writeFileSync(path.join(dir, "hwsm.pdb"), pdbFor("11111111-2222-3333-4444-555555555555"));
		// The plugin ships hwsm.node alone, and the release step reads the
		// binaries scripts/lib/native-binaries.mjs lists.
		fs.writeFileSync(path.join(dir, "release-native-manifest.json"), JSON.stringify({ ...f.current, binaries: f.current.binaries.filter((record) => record.file === "hwsm.node") }));
		fs.writeFileSync(path.join(previousDir, "release.json"), JSON.stringify({ status, tag: status === "read" ? "v1.7.1" : "", reason: status === "unreadable" ? "HTTP 502" : "", digestVerified }));
		if (status === "read") {
			fs.writeFileSync(path.join(previousDir, "release-native-manifest.json"), JSON.stringify(f.previous));
			if (pack) fs.writeFileSync(path.join(previousDir, "com.lawrensen.hwinfo.streamDeckPlugin"), writeZip([{ name: `${PLUGIN_ROOT}/bin/hwsm.node`, data: f.shipped }, { name: `${PLUGIN_ROOT}/manifest.json`, data: Buffer.from("{}") }]));
			if (pdb) fs.writeFileSync(path.join(previousDir, "hwsm.pdb"), pdbFor(SHIPPED_GUID));
		}
		return { f, dir, previousDir };
	}
	const run = (args, env = {}) => {
		const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "NATIVE_CARRY_FORWARD" && key !== "GITHUB_STEP_SUMMARY" && key !== "GITHUB_ACTIONS"));
		return spawnSync(process.execPath, [path.join(ROOT, "scripts", "native-carry-forward.mjs"), ...args], { encoding: "utf8", env: { ...clean, ...env } });
	};
	const snapshot = (dir) => Object.fromEntries(fs.readdirSync(dir).map((name) => [name, sha256(fs.readFileSync(path.join(dir, name)))]));

	it("swaps the carried binary and its PDB in, moves the rebuild aside, and records every decision", () => {
		const { f, dir, previousDir } = stageRun();
		const rebuiltPdb = fs.readFileSync(path.join(dir, "hwsm.pdb"));
		const r = run(["--dir", dir, "--previous-dir", previousDir]);
		assert.equal(r.status, 0, r.stderr);
		assert.ok(fs.readFileSync(path.join(dir, "hwsm.node")).equals(f.shipped));
		assert.ok(fs.readFileSync(path.join(dir, "hwsm.pdb")).equals(pdbFor(SHIPPED_GUID)));
		assert.ok(fs.readFileSync(path.join(dir, "rebuilt", "hwsm.node")).equals(f.rebuild), "the rebuild is kept as evidence");
		assert.ok(fs.readFileSync(path.join(dir, "rebuilt", "hwsm.pdb")).equals(rebuiltPdb));
		const record = JSON.parse(fs.readFileSync(path.join(dir, "carry-forward.json"), "utf8"));
		assert.equal(record.mode, "on");
		assert.deepEqual(record.previous, { release: "v1.7.1", compilerVersion: "19.51.36260", windowsSdkVersion: "10.0.26100.0" });
		assert.equal(record.binaries["hwsm.node"].decision, "carried");
		assert.equal(record.binaries["hwsm.node"].rebuiltSha256, sha256(f.rebuild));
		assert.deepEqual(Object.keys(record.binaries), ["hwsm.node"]);
		assert.match(r.stdout, /NATIVE CARRY-FORWARD: hwsm\.node carried/);
	});

	it("refuses without changing anything when the carried file cannot be proven", () => {
		for (const options of [{ pack: false }, { pdb: false }]) {
			const { dir, previousDir } = stageRun(options);
			const before = snapshot(dir);
			const r = run(["--dir", dir, "--previous-dir", previousDir]);
			assert.equal(r.status, 1, JSON.stringify(options));
			assert.match(r.stderr, /NATIVE CARRY-FORWARD: refused, nothing changed/);
			assert.match(r.stderr, /Set the repository variable NATIVE_CARRY_FORWARD to off to ship this run's rebuild instead\./);
			assert.deepEqual(snapshot(dir), before);
		}
	});

	it("refuses to carry from an asset GitHub records no digest for", () => {
		const { dir, previousDir } = stageRun({ digestVerified: { "release-native-manifest.json": true, "com.lawrensen.hwinfo.streamDeckPlugin": true, "hwsm.pdb": false } });
		const before = snapshot(dir);
		const r = run(["--dir", dir, "--previous-dir", previousDir]);
		assert.equal(r.status, 1);
		assert.match(r.stderr, /GitHub records no digest the downloaded hwsm\.pdb of v1\.7\.1 was checked against, so a carried hwsm\.node cannot rest on it/);
		assert.deepEqual(snapshot(dir), before);
	});

	it("an unreadable previous release stops the run unless carry-forward is off", () => {
		const { dir, previousDir } = stageRun({ status: "unreadable" });
		const before = snapshot(dir);
		const refused = run(["--dir", dir, "--previous-dir", previousDir]);
		assert.equal(refused.status, 1);
		assert.match(refused.stderr, /The previous release could not be read \(HTTP 502\)/);
		assert.deepEqual(snapshot(dir), before);
		const off = run(["--dir", dir, "--previous-dir", previousDir], { NATIVE_CARRY_FORWARD: "off" });
		assert.equal(off.status, 0, off.stderr);
		assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "carry-forward.json"), "utf8")).binaries["hwsm.node"].reason, "NATIVE_CARRY_FORWARD is off");
	});

	it("with no previous release, ships every rebuild", () => {
		const { f, dir, previousDir } = stageRun({ status: "none" });
		const r = run(["--dir", dir, "--previous-dir", previousDir]);
		assert.equal(r.status, 0, r.stderr);
		assert.ok(fs.readFileSync(path.join(dir, "hwsm.node")).equals(f.rebuild));
		assert.equal(fs.existsSync(path.join(dir, "rebuilt")), false);
	});

	it("--check-mode refuses a value that is neither on nor off", () => {
		assert.equal(run(["--check-mode"]).status, 0);
		assert.equal(run(["--check-mode"], { NATIVE_CARRY_FORWARD: "off" }).status, 0);
		const typo = run(["--check-mode"], { NATIVE_CARRY_FORWARD: "Off" });
		assert.equal(typo.status, 1);
		assert.match(typo.stderr, /NATIVE_CARRY_FORWARD is "Off"; it must be "off", "on" or unset/);
	});
});
