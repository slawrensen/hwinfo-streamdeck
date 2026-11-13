// Native packaging gate, part of `npm run release:validate` (and CI): the
// .sdPlugin bundle must carry exactly the release builds of every shipped
// native binary (scripts/lib/native-binaries.mjs: hwsm.node) this
// plugin.js expects. No test builds, no staging
// leftovers, no koffi, no PDB; each addon's own protocol/ABI report must
// match its TypeScript contract, and its source id must be this tree's.
//
// Signed addons: a binary that carries an Authenticode certificate table
// ships only when release-native-manifest.json records that signature and
// the unsigned build it was made from (scripts/native-manifest.mjs
// --unsigned/--signature), the file without its signature hashing to that
// unsigned build, and an unsigned binary must not have a recorded
// signature. HWSM_REQUIRE_SIGNED=1 (the release's packaging job when it
// signs) also requires every binary to be signed, Windows to report the
// signature Valid with a timestamp, and the signer to be the one the
// manifest records; that check needs Windows and fails elsewhere.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { authenticodeStructureProblem, neutralSha256 } from "./lib/authenticode.mjs";
import { authenticodeSignature } from "./lib/authenticode-windows.mjs";
import { NATIVE_BINARIES, TEST_ONLY_NATIVE_FILES, nativeContract, testHookIn, versionResourceString } from "./lib/native-binaries.mjs";
import { parsePe } from "./lib/pe.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sd = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");
const binDir = path.join(sd, "bin");
const canLoad = process.platform === "win32" && process.arch === "x64";

const failures = [];
const fail = (msg) => failures.push(msg);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const requireSigned = process.env.HWSM_REQUIRE_SIGNED === "1";
/** file -> whether bin/ holds it with a certificate table. */
const signedFiles = new Map();

for (const binary of NATIVE_BINARIES) {
	const addonPath = path.join(binDir, binary.file);
	const rel = `bin/${binary.file}`;
	// 1. The addon exists where its loader looks for it.
	if (!fs.existsSync(addonPath)) {
		fail(`${rel} is missing; run \`npm run build:native\` and \`npm run build\`.`);
		continue;
	}
	const bytes = fs.readFileSync(addonPath);
	let expected = null;
	try {
		expected = nativeContract(repoRoot, binary);
	} catch (err) {
		fail(`the native contract in this tree could not be established: ${err?.message ?? err}`);
	}
	// 2. It loads, and its self-report matches the TypeScript contract.
	if (canLoad) {
		try {
			const require = createRequire(import.meta.url);
			const loaded = require(addonPath);
			// A test build adds hooks to the same exports; the release build
			// exports exactly its contract. The names are non-enumerable, so
			// getOwnPropertyNames, never Object.keys.
			const names = Object.getOwnPropertyNames(loaded).sort();
			const hooks = names.filter((name) => name.startsWith("_test"));
			if (hooks.length > 0) fail(`${rel} exports test-only hooks (${hooks.join(", ")}): a test build sits under the shipped name; rebuild with \`npm run build:native\` and \`npm run build\`.`);
			else if (names.join(",") !== binary.exports.join(",")) fail(`${rel} exports ${names.join(", ")}; its contract is ${binary.exports.join(", ")}.`);
			const info = loaded.getBuildInfo();
			if (expected !== null && info.protocolVersion !== expected.protocolVersion) {
				fail(`${rel} protocol ${info.protocolVersion} != TypeScript protocol ${expected.protocolVersion} in ${binary.contract.path} (stale vendored addon?)`);
			}
			if (info.napiVersion !== 8) fail(`${rel} reports Node-API ${info.napiVersion}, expected 8`);
			if (expected !== null && info.nativeVersion !== expected.nativeVersion) {
				fail(`${rel} reports native version ${info.nativeVersion}, ${binary.dir}/${binary.versionHeader} says ${expected.nativeVersion}.`);
			}
			if (info.architecture !== "x64") fail(`${rel} reports architecture ${info.architecture}, expected x64`);
			if (info.nativeSourceId === "unset") {
				fail(`${rel} was built without scripts/native-source-id.mjs (nativeSourceId is 'unset'); rebuild with \`npm run build:native\`.`);
			}
		} catch (err) {
			fail(`${rel} failed to load: ${err?.message ?? err}`);
		}
	}
	// 2b. It was built from THIS tree's native sources. copy-hwsm.mjs vendors
	// whatever build/Release holds, so an edit to the C source followed by
	// `npm run build` alone leaves a stale addon in the pack with a protocol
	// that still matches; the source id is the only fact that tells the two
	// apart, and the addon reports it from getBuildInfo().
	let sourceId = null;
	if (canLoad) {
		try {
			sourceId = createRequire(import.meta.url)(addonPath).getBuildInfo().nativeSourceId;
		} catch {
			// Reported by the load check above.
		}
	}
	if (expected !== null && sourceId !== null && sourceId !== expected.nativeSourceId) {
		fail(`${rel} was built from other native sources (its source id ${sourceId}, this tree's ${expected.nativeSourceId}); rebuild with \`npm run build:native\` and \`npm run build\`.`);
	}
	// 2c. No test hook compiled in, whether or not this host can load it
	// (hwsm's hook sits on its sessions, not on the module exports).
	const hook = testHookIn(bytes);
	if (hook !== null) fail(`${rel} carries the test-only hook ${hook}: a test build sits under the shipped name; rebuild with \`npm run build:native\` and \`npm run build\`.`);
	// 3. Version resource sanity and machine: the strings the .rc embeds
	// must be present, and the image must be x64.
	if (versionResourceString(bytes, "OriginalFilename") !== binary.file) {
		fail(`${rel} has no version resource naming it (OriginalFilename ${JSON.stringify(versionResourceString(bytes, "OriginalFilename"))}).`);
	}
	try {
		const pe = parsePe(bytes);
		if (pe.machine !== "x64") fail(`${rel} is a ${pe.machine} image, expected x64`);
		const layoutProblem = authenticodeStructureProblem(bytes);
		if (layoutProblem !== null) fail(`${rel}: ${layoutProblem}`);
		signedFiles.set(binary.file, pe.certificateTable !== null);
	} catch (err) {
		fail(`${rel} is not a PE image: ${err.message}`);
	}
}

// 4. Nothing test-only, temporary, or debug-only rides along in the pack.
const walk = (dir) => {
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(p));
		else out.push(p);
	}
	return out;
};
for (const file of walk(sd)) {
	const name = path.basename(file);
	const rel = path.relative(sd, file);
	if (TEST_ONLY_NATIVE_FILES.includes(name)) fail(`test-only addon must not ship: ${rel}`);
	if (name.includes(".staging-")) fail(`staging leftover must not ship: ${rel}`);
	if (name.endsWith(".pdb")) fail(`PDB must not ship: ${rel}`);
	if (name.endsWith(".obj") || name.endsWith(".iobj") || name.endsWith(".ipdb")) fail(`intermediate object must not ship: ${rel}`);
	if (/koffi/i.test(name)) fail(`koffi must not ship: ${rel}`);
}

// 5. The bundled plugin.js must not reference koffi at runtime.
const pluginJs = path.join(binDir, "plugin.js");
if (fs.existsSync(pluginJs) && /require\(["']koffi/.test(fs.readFileSync(pluginJs, "utf8"))) {
	fail("bin/plugin.js references koffi; the shipped runtime must be koffi-free.");
}

// 6. When the native manifest exists it must describe these exact bytes:
// the version 1 fields (hwsm.node) and, in a version 2 manifest, every
// shipped binary. HWSM_NATIVE_MANIFEST names another file (qualify.mjs
// --native-manifest, holding release bytes to their published manifest);
// a named file that does not exist is a failure, not "no manifest".
const manifestPath = process.env.HWSM_NATIVE_MANIFEST ? path.resolve(process.env.HWSM_NATIVE_MANIFEST) : path.join(repoRoot, "release-native-manifest.json");
if (process.env.HWSM_NATIVE_MANIFEST && !fs.existsSync(manifestPath)) fail(`HWSM_NATIVE_MANIFEST names ${manifestPath}, which does not exist.`);
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;
if (manifest === null) {
	for (const [file, signed] of signedFiles) {
		if (signed) fail(`bin/${file} carries an Authenticode signature, and a signed addon ships only with release-native-manifest.json recording that signature and the unsigned build it was made from.`);
	}
}
if (manifest !== null) {
	const regenerate = "regenerate with `node scripts/native-manifest.mjs`";
	const hwsmPath = path.join(binDir, "hwsm.node");
	if (fs.existsSync(hwsmPath)) {
		const actual = sha256(fs.readFileSync(hwsmPath));
		if (manifest.sha256 !== actual) fail(`release-native-manifest.json sha256 ${String(manifest.sha256).slice(0, 12)}… does not match bin/hwsm.node ${actual.slice(0, 12)}…; ${regenerate}.`);
	}
	if (!Array.isArray(manifest.binaries)) {
		fail(`release-native-manifest.json is a version 1 manifest, with no record per binary; ${regenerate}.`);
	} else {
		for (const binary of NATIVE_BINARIES) {
			const record = manifest.binaries.find((entry) => entry?.file === binary.file);
			const addonPath = path.join(binDir, binary.file);
			if (record === undefined) {
				fail(`release-native-manifest.json does not describe ${binary.file}; ${regenerate}.`);
			} else if (fs.existsSync(addonPath)) {
				const bytes = fs.readFileSync(addonPath);
				const actual = sha256(bytes);
				if (record.sha256 !== actual) fail(`release-native-manifest.json records ${binary.file} as ${String(record.sha256).slice(0, 12)}…, bin/${binary.file} is ${actual.slice(0, 12)}…; ${regenerate}.`);
				// 7. Signature presence agrees with the record, and the file
				// without its signature is the unsigned build the record names
				// (the release notes publish that hash as the build this run
				// reproduced). The linker writes CheckSum 0, and native-manifest
				// refuses a signed binary whose unsigned build does not, so the
				// unsigned build of a signed file is exactly its neutral form; an
				// unsigned file is its own unsigned build.
				const signed = signedFiles.get(binary.file);
				const recorded = record.signature ?? null;
				if (signed === true && recorded === null) fail(`bin/${binary.file} carries an Authenticode signature that release-native-manifest.json does not record; ${regenerate} --unsigned <dir> --signature <signature.json>.`);
				if (signed === false && recorded !== null) fail(`release-native-manifest.json records a signature for ${binary.file}, but bin/${binary.file} carries none; ${regenerate}.`);
				if (signed !== undefined && authenticodeStructureProblem(bytes) === null) {
					const neutral = neutralSha256(bytes);
					if (typeof record.authenticodeNeutralSha256 !== "string") fail(`release-native-manifest.json does not record ${binary.file}'s neutral hash; ${regenerate}.`);
					else if (record.authenticodeNeutralSha256 !== neutral) fail(`release-native-manifest.json records ${binary.file}'s neutral hash as ${String(record.authenticodeNeutralSha256).slice(0, 12)}…, bin/${binary.file} without its signature is ${neutral.slice(0, 12)}…; ${regenerate}.`);
					const unsignedBuild = signed ? neutral : actual;
					if (typeof record.unsignedSha256 !== "string") fail(`release-native-manifest.json does not record the unsigned build of ${binary.file}; ${regenerate}${signed ? " --unsigned <dir>" : ""}.`);
					else if (record.unsignedSha256 !== unsignedBuild) fail(`release-native-manifest.json records ${binary.file}'s unsigned build as ${String(record.unsignedSha256).slice(0, 12)}…, but bin/${binary.file}${signed ? " without its signature" : ""} is ${unsignedBuild.slice(0, 12)}…; ${regenerate}.`);
				}
				if (recorded !== null && recorded.signedSha256 !== actual) fail(`release-native-manifest.json records ${binary.file}'s signed bytes as ${String(recorded.signedSha256).slice(0, 12)}…, bin/${binary.file} is ${actual.slice(0, 12)}…; ${regenerate}.`);
			}
		}
	}
}

// 8. HWSM_REQUIRE_SIGNED=1: every binary signed, Windows says Valid with a
// timestamp, and the signer is the one the manifest records. Bytes alone
// cannot answer trust, so off Windows this is UNAVAILABLE, never a pass.
if (requireSigned) {
	if (process.platform !== "win32") {
		fail("UNAVAILABLE: HWSM_REQUIRE_SIGNED=1 needs Windows to check the signatures (Get-AuthenticodeSignature).");
	} else {
		for (const binary of NATIVE_BINARIES) {
			const addonPath = path.join(binDir, binary.file);
			const rel = `bin/${binary.file}`;
			if (!fs.existsSync(addonPath)) continue;
			if (signedFiles.get(binary.file) !== true) {
				fail(`${rel} is not signed (HWSM_REQUIRE_SIGNED=1).`);
				continue;
			}
			let status;
			try {
				status = authenticodeSignature(addonPath);
			} catch (err) {
				fail(`${rel}: the signature could not be checked: ${err.message}`);
				continue;
			}
			if (status.status !== "Valid") fail(`${rel} signature status ${status.status}: ${status.statusMessage}`);
			if (status.timestamper === null) fail(`${rel} signature carries no timestamp.`);
			const recorded = Array.isArray(manifest?.binaries) ? manifest.binaries.find((entry) => entry?.file === binary.file)?.signature?.signer?.thumbprint : undefined;
			if (recorded === undefined) fail(`${rel}: release-native-manifest.json records no signer to hold the signature to.`);
			else if (status.signer?.thumbprint !== recorded) fail(`${rel} is signed by ${status.signer?.thumbprint ?? "nobody"}, release-native-manifest.json records ${recorded}.`);
		}
	}
}

if (failures.length > 0) {
	console.error(`NATIVE VALIDATION: ${failures.length} failure(s)`);
	for (const f of failures) console.error(`  ${f}`);
	process.exit(1);
}
const signedNote = [...signedFiles.values()].some(Boolean) ? `, signed (${[...signedFiles].filter(([, signed]) => signed).map(([file]) => file).join(", ")})${requireSigned ? " and Valid" : ""}` : ", unsigned";
console.log(`NATIVE VALIDATION: OK (${NATIVE_BINARIES.map((binary) => binary.file).join(", ")} present, protocol/ABI and source ids consistent${signedNote}, pack clean)`);
