// A minimal tree the native packaging gate (scripts/validate-native.mjs)
// runs in: the gate, the libraries it imports, each native binary's
// TypeScript contract and native sources (for the protocol and source id
// checks), and a bin/ holding the binaries to judge. The signing-structure
// selftest runs the gate this way on real signtool output, and the native
// tests on synthetic signatures, so both judge with the same inputs.
// Builtins only.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NATIVE_BINARIES } from "./native-binaries.mjs";

/** Repo-relative paths the gate reads besides bin/ and the manifest. */
export const GATE_INPUTS = Object.freeze([
	"scripts/validate-native.mjs",
	"scripts/lib/native-binaries.mjs",
	"scripts/lib/pe.mjs",
	"scripts/lib/authenticode.mjs",
	"scripts/lib/authenticode-windows.mjs",
	...NATIVE_BINARIES.flatMap((binary) => [binary.contract.path, ...binary.sources.map((source) => `${binary.dir}/${source}`)])
]);

/**
 * Copies GATE_INPUTS from `repoRoot` into `root` and, when `binFrom` names
 * a directory, every shipped binary from it into the plugin's bin/.
 * Returns the bin/ path. The manifest, when one is wanted, goes to
 * <root>/release-native-manifest.json.
 */
export function stageGateTree({ repoRoot, root, binFrom = null }) {
	for (const rel of GATE_INPUTS) {
		fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
		fs.copyFileSync(path.join(repoRoot, rel), path.join(root, rel));
	}
	const bin = path.join(root, "com.lawrensen.hwinfo.sdPlugin", "bin");
	fs.mkdirSync(bin, { recursive: true });
	if (binFrom !== null) for (const binary of NATIVE_BINARIES) fs.copyFileSync(path.join(binFrom, binary.file), path.join(bin, binary.file));
	return bin;
}

/**
 * Runs the packaging gate over signed copies the way a release would see
 * them, and says what is wrong with its verdicts. `signedDir` holds the
 * signed binaries, `unsignedDir` the builds they were made from, and
 * `signatureRecord` the facts scripts/verify-signed-native.mjs recorded
 * (its `files` map). The manifest written for them CLAIMS each signature is
 * Valid and timestamped, as a manifest from a real sign job would, so the
 * gate's own trust check is the only thing that can refuse an untrusted
 * signature:
 *
 * 1. without HWSM_REQUIRE_SIGNED the gate must accept the signed copies
 *    (their layout, the neutral hash, the recorded unsigned build);
 * 2. with HWSM_REQUIRE_SIGNED=1 it must refuse them on what Windows reports
 *    about the signature, and on nothing structural.
 *
 * Returns { problems, structural, trust } (the two gate runs' output).
 * Windows only, like the trust check it exercises.
 */
export function judgeSignedCopies({ repoRoot, work, signedDir, unsignedDir, signatureRecord }) {
	const problems = [];
	const root = path.join(work, "gate");
	fs.rmSync(root, { recursive: true, force: true });
	const bin = stageGateTree({ repoRoot, root, binFrom: signedDir });
	const claim = path.join(work, "claimed-signature.json");
	const files = Object.fromEntries(Object.entries(signatureRecord.files ?? {}).map(([file, entry]) => [file, { ...entry, status: "Valid", timestamp: entry.timestamp ?? "claimed, never timestamped" }]));
	fs.writeFileSync(claim, JSON.stringify({ ...signatureRecord, files }));
	const env = { ...process.env, GITHUB_RUN_ID: undefined, HWSM_CL_VERSION: undefined, HWSM_REQUIRE_SIGNED: undefined, HWSM_NATIVE_MANIFEST: undefined };
	const [first, ...rest] = NATIVE_BINARIES;
	const manifestArgs = [path.join(repoRoot, "scripts", "native-manifest.mjs"), path.join(bin, first.file), ...rest.flatMap((binary) => [`--${binary.target}`, path.join(bin, binary.file)]), "--unsigned", unsignedDir, "--signature", claim, "--no-toolchain"];
	const manifest = spawnSync(process.execPath, manifestArgs, { cwd: repoRoot, encoding: "utf8", env: { ...env, HWSM_MANIFEST_OUT: path.join(root, "release-native-manifest.json") } });
	if (manifest.status !== 0) {
		problems.push(`native-manifest refuses the signed copies: ${(manifest.stderr || manifest.stdout).trim()}`);
		return { problems, structural: "", trust: "" };
	}
	const gate = (extra) => spawnSync(process.execPath, [path.join(root, "scripts", "validate-native.mjs")], { cwd: root, encoding: "utf8", env: { ...env, ...extra } });
	const structural = gate({});
	if (structural.status !== 0) problems.push(`validate-native refuses the signed copies on structure: ${structural.stderr.trim()}`);
	const trust = gate({ HWSM_REQUIRE_SIGNED: "1" });
	if (trust.status === 0) problems.push("validate-native with HWSM_REQUIRE_SIGNED=1 accepts signatures Windows does not report Valid");
	else {
		for (const binary of NATIVE_BINARIES) {
			const verdict = trust.stderr.split(/\r?\n/).find((line) => line.includes(`bin/${binary.file} signature status `));
			if (verdict === undefined || verdict.includes("signature status Valid")) problems.push(`validate-native with HWSM_REQUIRE_SIGNED=1 does not refuse ${binary.file} on its signature status: ${trust.stderr.trim()}`);
		}
		if (/without its signature|neutral hash|unsigned build|certificate table/.test(trust.stderr)) problems.push(`validate-native reports a structure problem on the signed copies: ${trust.stderr.trim()}`);
	}
	return { problems, structural: `${structural.stdout}${structural.stderr}`, trust: `${trust.stdout}${trust.stderr}` };
}
