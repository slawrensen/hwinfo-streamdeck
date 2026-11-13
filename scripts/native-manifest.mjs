// Generates release-native-manifest.json: the complete build facts for the
// shipped native binary, hwsm.node (hash, size, PE
// architecture and hardening, imports and their hints, per-section hashes,
// CodeView and REPRO records, Node-API/protocol/native versions, source
// ids) and the toolchain record of the build (scripts/lib/native-toolchain.mjs).
// The release workflow attaches it next to the plugin package so an
// administrator can verify the exact native binaries a release contains
// without unpacking anything, and scripts/native-drift.mjs compares it with
// the previous release's to say which input moved when bytes move.
//
//   node scripts/native-manifest.mjs [hwsm.node]
//                                    [--toolchain <record.json> | --no-toolchain]
//                                    [--build-manifest <unsigned manifest.json>]
//                                    [--unsigned <dir>] [--signature <signature.json>]
//                                    [--carry-forward <carry-forward.json>]
//
// Layout, append-only: the top-level fields are the version 1 manifest of
// hwsm.node exactly as releases up to 1.7.1 wrote it (readers that know
// only those keep working; `sha256` is always the shipped file);
// manifestVersion 2 adds `binaries` (one full record per shipped binary,
// hwsm.node first) and `toolchain`.
//
// Signed binaries. Each record carries `unsignedSha256` and
// `unsignedByteSize` (the reproduced unsigned build; for an unsigned
// binary, the file itself), `authenticodeNeutralSha256` (the shipped file
// with its CheckSum, certificate directory and certificate table removed,
// scripts/lib/authenticode.mjs) and `signature` (null when unsigned). A
// signed binary is recorded only with --unsigned <dir> holding the unsigned
// build it was made from, whose neutral hash must equal the signed file's,
// and --signature naming the facts the sign job verified
// (scripts/verify-signed-native.mjs). --build-manifest hands in the build
// job's own manifest: its compiler, SDK and toolchain facts carry over (the
// packaging job compiles nothing) and its hashes must be the unsigned
// builds'.
//
// Carried binaries. --carry-forward hands in the build job's
// carry-forward.json (scripts/native-carry-forward.mjs): a binary it marks
// carried is the previous release's unsigned build, shipped because its
// native source did not change, so the build manifest's hash for it is this
// run's rebuild, not the shipped bytes. Its record gains
// `reproducibility` { carriedFrom { release, firstShippedIn, sha256,
// unsignedSha256 }, rebuiltSha256, rebuiltIdentical }, and when hwsm.node
// is carried the version 1 compiler and SDK fields are the previous
// release's, because they describe the shipped hwsm.node. A binary without
// `reproducibility` is this run's build.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { NATIVE_BINARIES } from "./lib/native-binaries.mjs";
import { authenticodeNeutral } from "./lib/authenticode.mjs";
import { collectToolchain } from "./lib/native-toolchain.mjs";
import { parsePe } from "./lib/pe.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => {
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : undefined;
};
const binDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin", "bin");
const targets = {
	"hwsm.node": args[0] && !args[0].startsWith("--") ? path.resolve(args[0]) : path.join(binDir, "hwsm.node")
};
// HWSM_MANIFEST_OUT redirects the file for tests, so a test run never
// overwrites release evidence kept at the repo root.
const outPath = process.env.HWSM_MANIFEST_OUT || path.join(repoRoot, "release-native-manifest.json");
const inCi = Boolean(process.env.GITHUB_RUN_ID);
const refuse = (message) => {
	console.error(`native-manifest: ${message}`);
	process.exit(1);
};
const shown = (file) => path.relative(repoRoot, file) || file;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (flag) => {
	const file = path.resolve(option(flag));
	if (!fs.existsSync(file)) refuse(`${flag} ${shown(file)} not found.`);
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (err) {
		refuse(`${flag} ${shown(file)} is not JSON: ${err.message}`);
	}
};
const unsignedDir = option("--unsigned") ? path.resolve(option("--unsigned")) : null;
const signatureRecord = option("--signature") ? readJson("--signature") : null;
const buildManifest = option("--build-manifest") ? readJson("--build-manifest") : null;
const carryForward = option("--carry-forward") ? readJson("--carry-forward") : null;
if (carryForward !== null && (typeof carryForward.binaries !== "object" || carryForward.binaries === null)) refuse("--carry-forward names a file with no `binaries` map; it must be the build job's carry-forward.json.");
/** The carry-forward record of a binary marked carried, or null. */
const carriedRecord = (file) => {
	const entry = carryForward?.binaries?.[file] ?? null;
	if (entry === null || entry.decision !== "carried") return null;
	for (const field of ["sha256", "rebuiltSha256"]) if (!/^[0-9a-f]{64}$/.test(String(entry[field]))) refuse(`--carry-forward records no ${field} for the carried ${file}.`);
	if (typeof entry.carriedFrom?.release !== "string" || typeof entry.carriedFrom?.firstShippedIn !== "string") refuse(`--carry-forward does not say which release the carried ${file} comes from.`);
	return entry;
};
if (signatureRecord !== null && (typeof signatureRecord.files !== "object" || signatureRecord.files === null)) refuse("--signature names a file with no `files` map; it must be the sign job's signature.json.");

/** One binary's full record, or a refusal that ends the run. */
function describe(binary) {
	const target = targets[binary.file];
	if (!fs.existsSync(target)) refuse(`${shown(target)} not found; run \`npm run build\` first.`);
	const bytes = fs.readFileSync(target);
	let pe;
	try {
		pe = parsePe(bytes);
	} catch (err) {
		refuse(`${shown(target)} could not be parsed as a PE image: ${err.message}`);
	}
	// binding.gyp asks for every one of these (/HIGHENTROPYVA, /DYNAMICBASE,
	// /NXCOMPAT, /guard:cf, /CETCOMPAT, /Brepro). The manifest is published
	// as the record of what shipped, so a binary that lacks one is refused
	// here rather than recorded with a false in it: a flag dropped from the
	// build would otherwise reproduce, pass the drift check (the source id
	// covers binding.gyp, so different bytes are expected) and ship.
	const missingHardening = Object.entries(pe.hardening).filter(([, on]) => !on).map(([name]) => name);
	if (missingHardening.length > 0) refuse(`${path.basename(target)} lacks hardening ${missingHardening.join(", ")}; ${binary.dir}/binding.gyp asks for all of them, so this is a toolchain or flag regression.`);
	// /PDBALTPATH:%_PDB% keeps the build directory out of the binary: the
	// CodeView record names the PDB file alone. A path there (a drive, a
	// directory) is machine-specific and breaks byte reproducibility across
	// checkouts.
	if (pe.codeView === null) refuse(`${path.basename(target)} carries no CodeView (RSDS) debug record; the build must write one that names ${binary.target}.pdb.`);
	if (pe.codeView.path !== `${binary.target}.pdb`) refuse(`${path.basename(target)} names its PDB as ${JSON.stringify(pe.codeView.path)}, not "${binary.target}.pdb"; a directory or drive in the CodeView path is a reproducibility regression (binding.gyp's /PDBALTPATH:%_PDB%).`);
	if (pe.certificateTable === null && pe.overlayBytes !== 0) refuse(`${path.basename(target)} carries ${pe.overlayBytes} bytes after its last section and no certificate table; a linker output has none.`);
	let neutral;
	try {
		neutral = authenticodeNeutral(bytes);
	} catch (err) {
		refuse(`${path.basename(target)} carries a certificate table signing would not produce: ${err.message}`);
	}
	const signed = pe.certificateTable !== null;

	// The unsigned build: the file itself when unsigned and no directory is
	// named; otherwise the named directory's file, which must be unsigned and
	// equal the shipped file once the signature is taken off.
	let unsignedBytes = bytes;
	if (unsignedDir !== null) {
		const unsignedPath = path.join(unsignedDir, binary.file);
		if (!fs.existsSync(unsignedPath)) refuse(`--unsigned ${shown(unsignedDir)} holds no ${binary.file}.`);
		unsignedBytes = fs.readFileSync(unsignedPath);
		let unsignedPe;
		let unsignedNeutral;
		try {
			unsignedPe = parsePe(unsignedBytes);
			unsignedNeutral = authenticodeNeutral(unsignedBytes);
		} catch (err) {
			refuse(`the unsigned ${binary.file} in ${shown(unsignedDir)} is not a linker output: ${err.message}`);
		}
		if (unsignedPe.certificateTable !== null) refuse(`the unsigned ${binary.file} in ${shown(unsignedDir)} already carries a certificate table.`);
		// The gates tie the recorded unsigned hash to the shipped file by
		// taking its signature off (scripts/validate-native.mjs), which gives
		// back the unsigned build only when that build's CheckSum is 0, as
		// the linker writes it without /RELEASE.
		if (signed && sha256(unsignedNeutral) !== sha256(unsignedBytes)) refuse(`the unsigned ${binary.file} in ${shown(unsignedDir)} carries PE CheckSum 0x${unsignedPe.peChecksum.toString(16)}; the linker writes 0 (binding.gyp asks for no /RELEASE), and the packaging gate recovers the unsigned build from the signed file only when it is 0.`);
		if (sha256(unsignedNeutral) !== sha256(neutral)) refuse(`${path.basename(target)} without its signature (${sha256(neutral).slice(0, 12)}…) is not the unsigned build in ${shown(unsignedDir)} (${sha256(unsignedNeutral).slice(0, 12)}…): the shipped file must be that build plus a signature and nothing else.`);
	} else if (signed) {
		refuse(`${path.basename(target)} carries an Authenticode signature; record it with --unsigned <dir> holding the unsigned build it was made from.`);
	}
	// A carried binary is the build carry-forward.json names; the build
	// manifest then describes this run's rebuild of the same source.
	const carried = carriedRecord(binary.file);
	if (carried !== null && carried.sha256 !== sha256(unsignedBytes)) refuse(`--carry-forward records the carried ${binary.file} as ${carried.sha256.slice(0, 12)}…, the unsigned build here is ${sha256(unsignedBytes).slice(0, 12)}…: these are not the bytes the build job carried forward.`);
	if (buildManifest !== null) {
		const built = Array.isArray(buildManifest.binaries) ? buildManifest.binaries.find((entry) => entry?.file === binary.file) : undefined;
		if (built === undefined) refuse(`--build-manifest does not describe ${binary.file}.`);
		const expected = carried !== null ? carried.rebuiltSha256 : sha256(unsignedBytes);
		if (built.sha256 !== expected) refuse(carried !== null ? `--build-manifest records ${binary.file} as ${String(built.sha256).slice(0, 12)}…, --carry-forward records this run's rebuild as ${expected.slice(0, 12)}…: they describe different builds.` : `--build-manifest records ${binary.file} as ${String(built.sha256).slice(0, 12)}…, the unsigned build here is ${sha256(unsignedBytes).slice(0, 12)}…: these are not the bytes the build job produced.`);
	}

	// The signature facts the sign job verified, held to these exact bytes.
	let signature = null;
	const verified = signatureRecord?.files?.[binary.file] ?? null;
	if (signed) {
		if (verified === null) refuse(`${path.basename(target)} is signed, but no --signature facts describe it; pass the sign job's signature.json.`);
		if (verified.signedSha256 !== sha256(bytes) || verified.signedBytes !== bytes.length) refuse(`--signature describes ${binary.file} as ${String(verified.signedSha256).slice(0, 12)}… (${verified.signedBytes} bytes), the shipped file is ${sha256(bytes).slice(0, 12)}… (${bytes.length} bytes).`);
		if (verified.status !== "Valid" || typeof verified.signer?.thumbprint !== "string" || typeof verified.timestamp !== "string") refuse(`--signature does not record a valid, timestamped signature for ${binary.file} (status ${JSON.stringify(verified.status)}).`);
		signature = {
			service: signatureRecord.service ?? null,
			endpoint: signatureRecord.endpoint ?? null,
			account: signatureRecord.account ?? null,
			profile: signatureRecord.profile ?? null,
			action: signatureRecord.action ?? null,
			signtool: signatureRecord.signtool ?? null,
			verifiedOn: signatureRecord.verifiedOn ?? null,
			status: verified.status,
			signatureType: verified.signatureType ?? null,
			signer: verified.signer,
			timestamper: verified.timestamper ?? null,
			timestamp: verified.timestamp,
			digestAlgorithm: verified.digestAlgorithm ?? null,
			imageDigest: verified.imageDigest ?? null,
			certificateTable: pe.certificateTable,
			signedSha256: verified.signedSha256,
			signedBytes: verified.signedBytes
		};
	} else if (verified !== null) {
		refuse(`--signature describes a signature for ${binary.file}, but ${path.basename(target)} carries none.`);
	}

	// Load the exact file being described (win32-x64 only) for its own report.
	let buildInfo = null;
	if (process.platform === "win32" && process.arch === "x64") {
		const require = createRequire(import.meta.url);
		buildInfo = require(target).getBuildInfo();
	}
	const nativeSourceId = buildInfo?.nativeSourceId ?? null;
	return {
		file: binary.file,
		sha256: sha256(bytes),
		byteSize: bytes.length,
		machine: pe.machine,
		linkerVersion: pe.linkerVersion,
		imports: pe.imports,
		delayImports: pe.delayImports,
		hardening: pe.hardening,
		napiVersion: buildInfo?.napiVersion ?? null,
		protocolVersion: buildInfo?.protocolVersion ?? null,
		nativeVersion: buildInfo?.nativeVersion ?? null,
		nativeSourceId,
		compileDefines: ["NAPI_VERSION=8"],
		coffTimestamp: pe.coffTimestamp,
		peChecksum: pe.peChecksum,
		certificateTable: pe.certificateTable,
		sections: pe.sections,
		headersNeutralSha256: pe.headersNeutralSha256,
		codeView: pe.codeView,
		reproHash: pe.reproHash,
		importHints: pe.importHints,
		delayImportHints: pe.delayImportHints,
		unsignedSha256: sha256(unsignedBytes),
		unsignedByteSize: unsignedBytes.length,
		authenticodeNeutralSha256: sha256(neutral),
		signature,
		...(carried === null ? {} : { reproducibility: { carriedFrom: { release: carried.carriedFrom.release, firstShippedIn: carried.carriedFrom.firstShippedIn, sha256: carried.carriedFrom.sha256 ?? null, unsignedSha256: carried.carriedFrom.unsignedSha256 ?? null }, rebuiltSha256: carried.rebuiltSha256, rebuiltIdentical: carried.rebuiltSha256 === sha256(unsignedBytes) } })
	};
}

const records = NATIVE_BINARIES.map(describe);
const hwsm = records[0];

const strip = (v) => (v ?? "").replace(/[\\/]+$/, "");

// Toolchain facts of the version 1 fields. The compiler version comes from
// the build environment (release.yml exports HWSM_CL_VERSION from the
// cl.exe banner); "unknown" is honest for a bare local run, but a release
// run must carry a real version, so anything that does not start with
// major.minor.patch is refused there instead of shipping in the manifest
// (the workflow's capture used to depend on which cl.exe output stream
// arrived first).
// A carried hwsm.node was compiled for the previous release: its compiler
// and SDK are the ones that release recorded.
const hwsmCarried = hwsm.reproducibility !== undefined && carryForward?.previous !== null && carryForward?.previous !== undefined;
const compilerVersion = (hwsmCarried ? carryForward.previous.compilerVersion : buildManifest !== null ? buildManifest.compilerVersion : process.env.HWSM_CL_VERSION) || "unknown";
if (inCi && !/^\d+\.\d+\.\d+/.test(compilerVersion)) refuse(`HWSM_CL_VERSION is ${JSON.stringify(compilerVersion)}, not a compiler version; the workflow must export the real cl.exe version before this step.`);

// node-gyp writes the Windows SDK MSBuild resolved into the generated
// project, which is the exact SDK the addon was built against. The
// developer-shell variable only exists inside a Visual Studio prompt, so it
// is the fallback, not the source.
function sdkVersionFromProject() {
	const vcxproj = path.join(repoRoot, "native", "hwsm", "build", "hwsm.vcxproj");
	if (!fs.existsSync(vcxproj)) return "";
	const m = fs.readFileSync(vcxproj, "utf8").match(/<WindowsTargetPlatformVersion>([^<]+)<\/WindowsTargetPlatformVersion>/);
	return m ? m[1].trim() : "";
}
const windowsSdkVersion = (hwsmCarried ? carryForward.previous.windowsSdkVersion : buildManifest !== null ? buildManifest.windowsSdkVersion : sdkVersionFromProject() || strip(process.env.WindowsSDKVersion)) || "unknown";
if (inCi && windowsSdkVersion === "unknown") {
	console.warn("native-manifest: Windows SDK version not found in native/hwsm/build/hwsm.vcxproj or WindowsSDKVersion; recording \"unknown\".");
}

// The toolchain record: computed from this tree's build logs unless a
// record file is handed in. A release run must carry one; a checkout whose
// binaries were copied in (no build logs) records null and says so.
let toolchain = null;
if (buildManifest !== null && !option("--toolchain")) {
	toolchain = buildManifest.toolchain ?? null;
	if (toolchain === null && inCi) refuse("--build-manifest carries no toolchain record.");
} else if (option("--toolchain")) {
	toolchain = JSON.parse(fs.readFileSync(path.resolve(option("--toolchain")), "utf8"));
} else if (!args.includes("--no-toolchain")) {
	try {
		toolchain = collectToolchain({ repoRoot, binaries: NATIVE_BINARIES });
	} catch (err) {
		if (inCi) refuse(`the toolchain record could not be collected: ${err.message}`);
		console.log(`native-manifest: no toolchain record (${err.message})`);
	}
}

const manifest = {
	file: hwsm.file,
	sha256: hwsm.sha256,
	byteSize: hwsm.byteSize,
	machine: hwsm.machine,
	linkerVersion: hwsm.linkerVersion,
	imports: hwsm.imports,
	delayImports: hwsm.delayImports,
	hardening: hwsm.hardening,
	napiVersion: hwsm.napiVersion,
	protocolVersion: hwsm.protocolVersion,
	nativeVersion: hwsm.nativeVersion,
	nativeSourceId: hwsm.nativeSourceId,
	compileDefines: hwsm.compileDefines,
	compilerVersion,
	windowsSdkVersion,
	buildNodeVersion: process.version,
	buildWorkflowRun: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
	manifestVersion: 2,
	binaries: records,
	toolchain
};

fs.writeFileSync(outPath, JSON.stringify(manifest, null, "\t") + "\n");
console.log(`native manifest → ${path.relative(repoRoot, outPath)}`);
for (const record of records) {
	console.log(`  ${record.file} ${record.byteSize} bytes sha256=${record.sha256.slice(0, 16)}… ${record.machine} napi=${record.napiVersion} protocol=${record.protocolVersion} native=${record.nativeVersion} source=${record.nativeSourceId}`);
	console.log(`    hardening: ${Object.entries(record.hardening).filter(([, v]) => v).map(([k]) => k).join(", ")}`);
	console.log(`    imports: ${record.imports.join(", ")} | delay: ${record.delayImports.join(", ")}`);
	console.log(record.signature === null ? "    unsigned" : `    signed by ${record.signature.signer.subject} (${record.signature.signer.thumbprint}), timestamped ${record.signature.timestamp}; unsigned build ${record.unsignedSha256.slice(0, 16)}…`);
	if (record.reproducibility !== undefined) console.log(`    carried forward from ${record.reproducibility.carriedFrom.firstShippedIn} (native source unchanged); this run's rebuild ${record.reproducibility.rebuiltSha256.slice(0, 16)}…`);
}
console.log(`  toolchain: ${toolchain ? `inputsDigest ${toolchain.inputsDigest.slice(0, 16)}…` : "not recorded"}`);
