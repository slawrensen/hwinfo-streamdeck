// The native manifest's facts are release evidence. Runs the real
// scripts/native-manifest.mjs against the built addon (needs bin/hwsm.node,
// like the rest of test:native): under a CI run id
// the script must refuse a compiler version that is not a version (the
// cl.exe banner capture is order-dependent, so a usage line once reached the
// environment), and a bare local run keeps an honest "unknown". The
// shipped binary is described in full (version 2 layout) with the
// toolchain record of the build, and a binary whose hardening, CodeView
// path or trailing bytes would make the record a lie is refused.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs, { existsSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const ROOT = process.cwd();
const script = join(ROOT, "scripts/native-manifest.mjs");
const addon = join(ROOT, "com.lawrensen.hwinfo.sdPlugin/bin/hwsm.node");
const notBuilt = !existsSync(addon) && "bin/hwsm.node not built";
// The generated project is where the script reads the SDK version from; a
// checkout whose addon was copied in has none.
const project = join(ROOT, "native/hwsm/build/hwsm.vcxproj");
// Check the generated build, not binding.gyp's declared intent: Node's
// common.gypi can override target_defaults warning settings.
describe("native compiler warning policy", { skip: !existsSync(project) && "native project not generated" }, () => {
	for (const [dir, target] of [["hwsm", "hwsm"], ["hwsm", "hwsm_test"], ["hwsm", "hwsm_protomm"]] as const) {
		it(`${target} enables level 4 warnings as errors in every configuration`, () => {
			const xml = fs.readFileSync(join(ROOT, `native/${dir}/build/${target}.vcxproj`), "utf8");
			const configurations = [...xml.matchAll(/<ItemDefinitionGroup[^>]*>([\s\S]*?)<\/ItemDefinitionGroup>/g)];
			assert.ok(configurations.length >= 2, "Debug and Release definitions must be present");
			for (const [, configuration] of configurations) {
				assert.match(configuration!, /<WarningLevel>Level4<\/WarningLevel>/);
				assert.match(configuration!, /<TreatWarningAsError>true<\/TreatWarningAsError>/);
			}
		});
	}
});
// Never the repo root: a kept release-native-manifest.json is release evidence.
const outDir = fs.mkdtempSync(join(os.tmpdir(), "hwsm-manifest-"));
const out = join(outDir, "release-native-manifest.json");
after(() => fs.rmSync(outDir, { recursive: true, force: true }));

const quietEnv = (env: Record<string, string | undefined>): Record<string, string | undefined> => ({ ...process.env, GITHUB_RUN_ID: undefined, HWSM_CL_VERSION: undefined, WindowsSDKVersion: undefined, HWSM_MANIFEST_OUT: out, ...env });

function run(env: Record<string, string | undefined>, args: string[] = [addon, "--no-toolchain"]): { status: number | null; stderr: string; stdout: string } {
	fs.rmSync(out, { force: true });
	return spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: "utf8", env: quietEnv(env) });
}

interface BinaryRecord {
	file: string;
	sha256: string;
	byteSize: number;
	machine: string;
	hardening: Record<string, boolean>;
	nativeSourceId: string | null;
	protocolVersion: number | null;
	napiVersion: number | null;
	certificateTable: unknown;
	sections: Array<{ name: string; rawSize: number; sha256: string }>;
	codeView: { guid: string; age: number; path: string };
	reproHash: string | null;
	importHints: Record<string, Record<string, number | null>>;
}
interface Manifest {
	compilerVersion: string;
	windowsSdkVersion: string;
	sha256: string;
	manifestVersion: number;
	binaries: BinaryRecord[];
	toolchain: null | { inputsDigest: string; binaries: Record<string, { inputs: Array<{ root: string; path: string; sha256: string | null }>; inputsDigest: string }> };
}

function manifest(): Manifest {
	return JSON.parse(fs.readFileSync(out, "utf8")) as Manifest;
}

describe("native-manifest toolchain facts", { skip: notBuilt }, () => {
	it("refuses a compilerVersion that is not a version when GITHUB_RUN_ID is set", () => {
		for (const bad of ["usage: cl [ option... ] filename... [ /link linkoption... ]", "", "unknown", "v19", "19.44"]) {
			const r = run({ GITHUB_RUN_ID: "1", GITHUB_REPOSITORY: "x/y", HWSM_CL_VERSION: bad });
			assert.equal(r.status, 1, JSON.stringify(bad));
			assert.match(r.stderr, /not a compiler version/);
		}
	});
	it("accepts a real compiler version in CI and records the SDK from the generated project", () => {
		const r = run({ GITHUB_RUN_ID: "1", GITHUB_REPOSITORY: "x/y", HWSM_CL_VERSION: "19.44.35228" });
		assert.equal(r.status, 0, r.stderr);
		assert.equal(manifest().compilerVersion, "19.44.35228");
		if (existsSync(project)) assert.match(manifest().windowsSdkVersion, /^10\.0\.\d+\.\d+$/);
		else assert.equal(manifest().windowsSdkVersion, "unknown", "no generated project, no invented SDK version");
	});
	it("still writes an honest unknown for a bare local run", () => {
		const r = run({});
		assert.equal(r.status, 0, r.stderr);
		assert.equal(manifest().compilerVersion, "unknown");
	});
});

describe("native-manifest refuses a file that is not a PE image", { skip: notBuilt }, () => {
	it("reports one line and writes no manifest for a truncated, foreign or header-damaged file", () => {
		const bytes = fs.readFileSync(addon);
		const damaged = Buffer.from(bytes);
		damaged.writeUInt32LE(bytes.length + 4096, 0x3c);
		const cases: Array<[string, Buffer]> = [["truncated", bytes.subarray(0, 200)], ["text", Buffer.from("not a native module at all")], ["lfanew past the end", damaged], ["empty", Buffer.alloc(0)]];
		for (const [name, content] of cases) {
			const file = join(outDir, `not-a-pe-${name.replaceAll(" ", "-")}.node`);
			fs.writeFileSync(file, content);
			const r = run({}, [file, "--no-toolchain"]);
			assert.equal(r.status, 1, name);
			assert.match(r.stderr, /could not be parsed as a PE image/, name);
			assert.doesNotMatch(r.stderr, /RangeError|ERR_OUT_OF_RANGE/, name);
			assert.equal(existsSync(out), false, name);
		}
	});
});

describe("native-manifest hardening record", { skip: notBuilt }, () => {
	it("records every hardening flag binding.gyp asks for as present on both built addons", () => {
		const r = run({});
		assert.equal(r.status, 0, r.stderr);
		const m = manifest();
		for (const hardening of [(m as unknown as { hardening: Record<string, boolean> }).hardening, ...m.binaries.map((binary) => binary.hardening)]) {
			assert.deepEqual(Object.keys(hardening).sort(), ["cetCompat", "controlFlowGuard", "dynamicBase", "highEntropyVa", "nxCompat", "reproducibleLink"]);
			for (const [flag, on] of Object.entries(hardening)) assert.equal(on, true, flag);
		}
	});

	it("refuses to record a binary that lacks one of them", () => {
		// The same addon with Control Flow Guard cleared in its PE header:
		// DllCharacteristics sits 70 bytes into the PE32+ optional header.
		const bytes = fs.readFileSync(addon);
		const optionalHeader = bytes.readUInt32LE(0x3c) + 4 + 20;
		const characteristics = bytes.readUInt16LE(optionalHeader + 70);
		assert.notEqual(characteristics & 0x4000, 0, "the built addon carries CFG, or this test proves nothing");
		bytes.writeUInt16LE(characteristics & ~0x4000, optionalHeader + 70);
		const weakened = join(outDir, "no-cfg-hwsm.node");
		fs.writeFileSync(weakened, bytes);
		const r = run({}, [weakened, "--no-toolchain"]);
		assert.equal(r.status, 1);
		assert.match(r.stderr, /lacks hardening controlFlowGuard/);
		assert.equal(existsSync(out), false, "no manifest is written for a binary the gate refused");
	});
});

describe("native-manifest version 2 record", { skip: notBuilt }, () => {
	const sha = (file: string): string => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

	it("keeps the version 1 fields for hwsm.node and describes the binary in full", () => {
		const r = run({});
		assert.equal(r.status, 0, r.stderr);
		const raw = JSON.parse(fs.readFileSync(out, "utf8")) as Record<string, unknown>;
		assert.deepEqual(Object.keys(raw), ["file", "sha256", "byteSize", "machine", "linkerVersion", "imports", "delayImports", "hardening", "napiVersion", "protocolVersion", "nativeVersion", "nativeSourceId", "compileDefines", "compilerVersion", "windowsSdkVersion", "buildNodeVersion", "buildWorkflowRun", "manifestVersion", "binaries", "toolchain"]);
		const m = manifest();
		assert.equal(raw.file, "hwsm.node");
		assert.equal(m.sha256, sha(addon));
		assert.equal(m.manifestVersion, 2);
		assert.deepEqual(m.binaries.map((binary) => binary.file), ["hwsm.node"]);
		for (const [binary, file, stem] of [[m.binaries[0]!, addon, "hwsm"]] as const) {
			assert.equal(binary.sha256, sha(file));
			assert.equal(binary.byteSize, fs.statSync(file).size);
			assert.equal(binary.machine, "x64");
			assert.equal(binary.codeView.path, `${stem}.pdb`);
			assert.match(binary.codeView.guid, /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
			// /Brepro derives the GUID from the content hash: the REPRO hash's
			// first 16 bytes are the GUID in memory order, whose last 8 bytes
			// read the same as the string form's last 16 hex digits.
			assert.equal(binary.reproHash?.slice(16, 32).toUpperCase(), binary.codeView.guid.replaceAll("-", "").slice(16), "the REPRO hash carries the CodeView GUID");
			assert.equal(binary.certificateTable, null, "unsigned build");
			assert.ok(binary.sections.some((section) => section.name === ".text") && binary.sections.every((section) => /^[0-9a-f]{64}$/.test(section.sha256)));
			assert.equal(binary.protocolVersion, 1);
			assert.equal(binary.napiVersion, 8);
			assert.match(binary.nativeSourceId ?? "", /^[0-9a-f]{16}$/);
			assert.ok(Object.keys(binary.importHints["KERNEL32.dll"] ?? {}).length > 0, "per-name import hints");
		}
	});

	it("embeds the toolchain record of this build with no machine path in it", { skip: !existsSync(project) && "no native build logs in this checkout" }, () => {
		const r = run({}, [addon]);
		assert.equal(r.status, 0, r.stderr);
		const text = fs.readFileSync(out, "utf8");
		const m = JSON.parse(text) as Manifest;
		assert.ok(m.toolchain !== null);
		assert.match(m.toolchain.inputsDigest, /^[0-9a-f]{64}$/);
		assert.deepEqual(Object.keys(m.toolchain.binaries), ["hwsm.node"]);
		for (const record of Object.values(m.toolchain.binaries)) {
			assert.ok(record.inputs.some((input) => input.root === "<kits>" && input.path.endsWith("/um/x64/kernel32.lib") && /^[0-9a-f]{64}$/.test(input.sha256 ?? "")), "kernel32.lib as the linker read it");
			assert.ok(record.inputs.every((input) => input.root !== "<repo>" && input.root !== "<windows>"), "repository and system files are left to the source id");
		}
		for (const leak of [ROOT, ROOT.replaceAll("\\", "\\\\"), os.homedir(), os.homedir().replaceAll("\\", "\\\\")]) {
			assert.equal(text.toUpperCase().includes(leak.toUpperCase()), false, `the manifest carries ${leak}`);
		}
	});

	it("refuses a CodeView path that names a directory or a drive", () => {
		const bytes = fs.readFileSync(addon);
		const at = bytes.indexOf(Buffer.from("hwsm.pdb\u0000", "latin1"));
		assert.ok(at > 0, "the built addon names hwsm.pdb, or this test proves nothing");
		Buffer.from("C:\\a.pdb", "latin1").copy(bytes, at);
		const rewritten = join(outDir, "hwsm-abs-pdb.node");
		fs.writeFileSync(rewritten, bytes);
		const r = run({}, [rewritten, "--no-toolchain"]);
		assert.equal(r.status, 1);
		assert.match(r.stderr, /names its PDB as "C:\\\\a\.pdb", not "hwsm\.pdb"/);
		assert.equal(existsSync(out), false);
	});

	it("refuses bytes after the last section of an unsigned binary", () => {
		const padded = join(outDir, "hwsm-overlay.node");
		fs.writeFileSync(padded, Buffer.concat([fs.readFileSync(addon), Buffer.from("appended")]));
		const r = run({}, [padded, "--no-toolchain"]);
		assert.equal(r.status, 1);
		assert.match(r.stderr, /carries 8 bytes after its last section and no certificate table/);
	});

	it("records no toolchain when told not to", () => {
		const r = run({}, [addon, "--no-toolchain"]);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(manifest().toolchain, null);
	});
});
