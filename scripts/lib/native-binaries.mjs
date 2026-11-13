// The shipped native binaries, as one list every native script reads:
// native-source-id.mjs (the content hash compiled into each binary),
// copy-hwsm.mjs (vendoring into bin/), validate-native.mjs (the packaging
// gate), native-manifest.mjs (release evidence), native-toolchain.mjs (the
// compiler inputs) and the pack contract. Adding a native binary means
// adding it here and to SHIPPED_MEMBERS in pack-contract.mjs in the same
// change. Builtins only, so the gates can run before `npm ci`. A binary
// reports its source id from getBuildInfo() (hwsm's contract has carried
// nativeSourceId since 1.4).
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * @typedef {object} NativeBinary
 * @property {string} file          shipped file name under bin/
 * @property {string} target        node-gyp target name (also the PDB stem)
 * @property {string} dir           source directory, repo-relative, forward slashes
 * @property {readonly string[]} sources  inputs of the source id, in hash order
 * @property {string} versionHeader header holding the protocol and native version
 * @property {string} macroPrefix   the version header's macro prefix (HWSM)
 * @property {{ path: string, constant: string }} contract  the TypeScript side of the protocol
 * @property {readonly string[]} testVariants  test-only builds that must never ship
 * @property {readonly string[]} exports  the module's own export names, sorted (the release build exports exactly these)
 */

/** @type {readonly NativeBinary[]} */
export const NATIVE_BINARIES = Object.freeze([
	Object.freeze({
		file: "hwsm.node",
		target: "hwsm",
		dir: "native/hwsm",
		sources: Object.freeze(["hwsm.c", "hwsm.rc", "hwsm-version.h", "binding.gyp"]),
		versionHeader: "hwsm-version.h",
		macroPrefix: "HWSM",
		contract: Object.freeze({ path: "src/hwinfo/hwsm-loader.ts", constant: "HWSM_PROTOCOL_VERSION" }),
		testVariants: Object.freeze(["hwsm_test.node", "hwsm_protomm.node"]),
		exports: Object.freeze(["getBuildInfo", "openGadgetKey", "openSharedMemory"])
	})
]);

/** Every test-only native file name, for the pack and packaging gates. */
export const TEST_ONLY_NATIVE_FILES = Object.freeze(NATIVE_BINARIES.flatMap((binary) => binary.testVariants));

/**
 * The name of a test-only hook compiled into a native image, or null. The
 * test build (HWSM_TEST_HOOKS) compiles the same .rc and sources as the
 * release build, so it carries the same OriginalFilename and getBuildInfo();
 * a test build copied over a shipped name is told apart only by its hooks.
 * Their names ("_testControl") sit in the image as the ASCII strings Node-API
 * registers, and a release build carries none. Bytes only, so the pack gate
 * can run it on archive members without loading them.
 */
export function testHookIn(bytes) {
	const match = /_test[A-Z][A-Za-z]*/.exec(Buffer.from(bytes).toString("latin1"));
	return match === null ? null : match[0];
}

/** Matches a test-only native build by name wherever it sits. */
export const TEST_ONLY_NATIVE_PATTERN = new RegExp(NATIVE_BINARIES.flatMap((binary) => binary.testVariants.map((file) => file.replace(/\.node$/, ""))).join("|"), "i");

/** The binary record for a shipped file name, or undefined. */
export function nativeBinary(file) {
	return NATIVE_BINARIES.find((binary) => binary.file === file);
}

/** The built release binary under the node-gyp output directory. */
export function builtPath(repoRoot, binary) {
	return path.join(repoRoot, ...binary.dir.split("/"), "build", "Release", binary.file);
}

/**
 * SHA-256 over the binary's native source inputs (name, NUL, bytes, NUL per
 * input, in list order), first 16 hex digits. Content only: no timestamps
 * and no repository-wide commit id, so TypeScript-only work never moves it.
 * hwsm's value is the same one scripts/lib/soak-producer-freshness.mjs
 * computes.
 */
export function nativeSourceId(repoRoot, binary) {
	const dir = path.join(repoRoot, ...binary.dir.split("/"));
	const hash = createHash("sha256");
	for (const name of binary.sources) {
		hash.update(name);
		hash.update("\0");
		hash.update(fs.readFileSync(path.join(dir, name)));
		hash.update("\0");
	}
	return hash.digest("hex").slice(0, 16);
}

/**
 * The contract a correct build of this tree must report: the protocol the
 * TypeScript side expects (and the native header agrees with), the native
 * version from the header, and the source id. Throws when the two protocol
 * numbers disagree or a fact cannot be read.
 */
export function nativeContract(repoRoot, binary) {
	const header = fs.readFileSync(path.join(repoRoot, ...binary.dir.split("/"), binary.versionHeader), "utf8");
	const contractText = fs.readFileSync(path.join(repoRoot, ...binary.contract.path.split("/")), "utf8");
	const protocolVersion = Number(new RegExp(`export const ${binary.contract.constant} = (\\d+);`).exec(contractText)?.[1]);
	const nativeProtocol = Number(new RegExp(`^#define ${binary.macroPrefix}_PROTOCOL_VERSION (\\d+)$`, "m").exec(header)?.[1]);
	const nativeVersion = new RegExp(`^#define ${binary.macroPrefix}_NATIVE_VERSION_STR "([^"]+)"$`, "m").exec(header)?.[1];
	if (!Number.isSafeInteger(protocolVersion) || protocolVersion < 1 || nativeProtocol !== protocolVersion || !nativeVersion) {
		throw new Error(`${binary.file}: the native contract cannot be established: ${binary.contract.path} ${binary.contract.constant} is ${String(protocolVersion)}, ${binary.dir}/${binary.versionHeader} ${binary.macroPrefix}_PROTOCOL_VERSION is ${String(nativeProtocol)} and ${binary.macroPrefix}_NATIVE_VERSION_STR is ${JSON.stringify(nativeVersion ?? null)}; the two protocol versions must be the same positive integer and the native version string must be present`);
	}
	return { protocolVersion, napiVersion: 8, nativeVersion, nativeSourceId: nativeSourceId(repoRoot, binary) };
}

/** The generated header that carries the source id into the build. */
export function sourceIdHeader(binary, id) {
	return `/* Generated by scripts/native-source-id.mjs; do not edit or commit. */\n#define ${binary.macroPrefix}_SOURCE_ID "${id}"\n`;
}

/**
 * Reads one value of a version resource's StringFileInfo by key, from the
 * raw file bytes: each entry is a String structure (wLength, wValueLength in
 * UTF-16 units, wType, the NUL-terminated UTF-16 key, padding to 32 bits,
 * then the value). Returns the value without trailing NULs, or null when
 * the key is absent or the structure around it does not hold together.
 */
export function versionResourceString(bytes, key) {
	const needle = Buffer.from(`${key}\0`, "utf16le");
	for (let at = bytes.indexOf(needle); at >= 0; at = bytes.indexOf(needle, at + 1)) {
		const start = at - 6;
		if (start < 0) continue;
		const length = bytes.readUInt16LE(start);
		const valueUnits = bytes.readUInt16LE(start + 2);
		const type = bytes.readUInt16LE(start + 4);
		if (type !== 1 || length < 6 + needle.length || start + length > bytes.length) continue;
		const valueStart = start + Math.ceil((6 + needle.length) / 4) * 4;
		const valueEnd = valueStart + valueUnits * 2;
		if (valueEnd > start + length) continue;
		return bytes.toString("utf16le", valueStart, valueEnd).replace(/\0+$/, "");
	}
	return null;
}
