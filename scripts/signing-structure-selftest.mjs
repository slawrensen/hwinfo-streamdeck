// CI-only proof that the release's signing checks work on real signtool
// output before any signing credential exists: STRUCTURE, NOT TRUST. On the
// ephemeral GitHub runner it makes a throwaway self-signed code-signing
// certificate in the runner user's own store, signs a copy of the built
// hwsm.node with signtool (no timestamp, no network), and asserts:
//
// 1. each signed copy minus its signature is the unsigned build, and the
//    digest signtool embedded is the Authenticode image digest computed by
//    scripts/lib/authenticode.mjs;
// 2. the signed copies load and pass the ABI check;
// 3. the release's trust checks REFUSE them: Get-AuthenticodeSignature does
//    not report Valid (the root is not trusted), signtool verify /pa fails,
//    and scripts/verify-signed-native.mjs reports problems;
// 4. the packaging gate (scripts/validate-native.mjs), given a manifest that
//    claims the signatures are Valid and timestamped, accepts their
//    structure, and with HWSM_REQUIRE_SIGNED=1 refuses them on the signature
//    status Windows reports (scripts/lib/native-gate-tree.mjs).
//
// A self-signed certificate proves nothing about publisher trust, and this
// run claims nothing about it. It refuses to run anywhere but a GitHub
// Actions Windows runner, so it never touches a developer's certificate
// store; the certificate is deleted at the end either way.
//
//   node scripts/signing-structure-selftest.mjs --hwsm <hwsm.node>
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareSignedToUnsigned } from "./lib/authenticode.mjs";
import { authenticodeSignature, findSigntool, signtoolVerify, windowsPowershellEnv } from "./lib/authenticode-windows.mjs";
import { judgeSignedCopies } from "./lib/native-gate-tree.mjs";
import { verifySigned } from "./verify-signed-native.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.env.GITHUB_ACTIONS !== "true" || !process.env.RUNNER_TEMP || process.platform !== "win32") {
	console.error("signing-structure-selftest: runs only on a GitHub Actions Windows runner (it creates a certificate in the current user's store).");
	process.exit(2);
}
const args = process.argv.slice(2);
const option = (name) => {
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : undefined;
};
const inputs = { "hwsm.node": option("--hwsm") };
for (const [file, from] of Object.entries(inputs)) {
	if (!from || !fs.existsSync(from)) {
		console.error(`signing-structure-selftest: --${file.replace(".node", "")} must name the built ${file}`);
		process.exit(2);
	}
}

const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const ps = (script, env = {}) => {
	const encoded = Buffer.from(`$ErrorActionPreference = 'Stop'; ${script}`, "utf16le").toString("base64");
	const r = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { encoding: "utf8", env: windowsPowershellEnv(env) });
	if (r.status !== 0) throw new Error(`PowerShell failed: ${(r.stderr || r.stdout).trim()}`);
	return r.stdout.trim();
};

const work = path.join(process.env.RUNNER_TEMP, "signing-structure-selftest");
const unsignedDir = path.join(work, "unsigned");
const signedDir = path.join(work, "signed");
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(unsignedDir, { recursive: true });
fs.mkdirSync(signedDir, { recursive: true });
for (const [file, from] of Object.entries(inputs)) {
	fs.copyFileSync(from, path.join(unsignedDir, file));
	fs.copyFileSync(from, path.join(signedDir, file));
}

const failures = [];
let thumbprint = null;
try {
	thumbprint = ps("$c = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=hwinfo-streamdeck signing structure selftest (untrusted)' -CertStoreLocation Cert:\\CurrentUser\\My -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -NotAfter (Get-Date).AddDays(1); $c.Thumbprint");
	if (!/^[0-9A-F]{40}$/.test(thumbprint)) throw new Error(`unexpected certificate thumbprint ${JSON.stringify(thumbprint)}`);
	const signtool = findSigntool();
	if (signtool === null) throw new Error("no Windows SDK signtool.exe (x64) on the runner");
	const signed = Object.keys(inputs).map((file) => path.join(signedDir, file));
	const sign = spawnSync(signtool.path, ["sign", "/fd", "SHA256", "/sha1", thumbprint, "/s", "My", ...signed], { encoding: "utf8" });
	console.log(`signtool ${signtool.sdk} sign: exit ${sign.status}\n${(sign.stdout + sign.stderr).trim()}`);
	if (sign.status !== 0) throw new Error("signtool sign failed");

	// 1. Structure.
	for (const file of Object.keys(inputs)) {
		const { problems, facts } = compareSignedToUnsigned(fs.readFileSync(path.join(signedDir, file)), fs.readFileSync(path.join(unsignedDir, file)));
		if (problems.length > 0) failures.push(...problems.map((problem) => `${file}: ${problem}`));
		else console.log(`${file}: signed ${facts.signedSha256} = unsigned ${facts.unsignedSha256} plus a ${facts.digestAlgorithm} signature over ${facts.imageDigest} (certificate table ${facts.certificateTable.offset}+${facts.certificateTable.size})`);
	}
	// 2. The signed copies load.
	const abi = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "abi-check.mjs"), path.join(signedDir, "hwsm.node")], { cwd: repoRoot, encoding: "utf8" });
	console.log(abi.stdout.trim());
	if (abi.status !== 0) failures.push(`the signed copies fail the ABI check: ${abi.stderr.trim()}`);
	// 3. Trust is refused.
	for (const file of Object.keys(inputs)) {
		const status = authenticodeSignature(path.join(signedDir, file));
		console.log(`${file}: Get-AuthenticodeSignature ${status.status} (${status.statusMessage})`);
		if (status.status === "Valid") failures.push(`${file}: Get-AuthenticodeSignature reports Valid for a self-signed certificate; the trust check would not protect the release`);
		if (status.signer?.thumbprint !== thumbprint) failures.push(`${file}: the signer is ${status.signer?.thumbprint ?? "nobody"}, not the selftest certificate`);
		if (signtoolVerify(path.join(signedDir, file), signtool.path).ok) failures.push(`${file}: signtool verify /pa accepts a self-signed certificate`);
	}
	const verdict = verifySigned({ signedDir, unsignedDir });
	if (verdict.problems.length === 0) failures.push("verify-signed-native accepts self-signed, untimestamped binaries");
	else console.log(`verify-signed-native refuses them as it must:\n  ${verdict.problems.join("\n  ")}`);
	if (verdict.problems.some((problem) => /without its signature|commits to|cannot be read/.test(problem))) failures.push("verify-signed-native reports a structure problem on signtool's own output");
	// 4. The packaging gate on the same signed copies, with a manifest that
	// claims their signatures are Valid and timestamped: it accepts the
	// structure, and HWSM_REQUIRE_SIGNED=1 refuses them on Windows' verdict.
	const gate = judgeSignedCopies({ repoRoot, work, signedDir, unsignedDir, signatureRecord: verdict.record });
	console.log(`validate-native on the signed copies:\n${gate.structural.trim()}\nwith HWSM_REQUIRE_SIGNED=1:\n${gate.trust.trim()}`);
	failures.push(...gate.problems);
} catch (err) {
	failures.push(err.message);
} finally {
	if (thumbprint !== null && /^[0-9A-F]{40}$/.test(thumbprint)) {
		try {
			ps("Remove-Item -LiteralPath (Join-Path 'Cert:\\CurrentUser\\My' $env:SELFTEST_THUMBPRINT)", { SELFTEST_THUMBPRINT: thumbprint });
		} catch (err) {
			console.error(`could not remove the selftest certificate: ${err.message}`);
		}
	}
}

if (failures.length > 0) {
	console.error(`SIGNING STRUCTURE SELFTEST: ${failures.length} failure(s)`);
	for (const failure of failures) console.error(`  ${failure}`);
	process.exit(1);
}
console.log("SIGNING STRUCTURE SELFTEST: OK (structure, not trust: real signtool signatures strip back to the unsigned builds, load, pass the packaging gate's structure checks, and are refused as untrusted by verify-signed-native and by the gate with HWSM_REQUIRE_SIGNED=1)");
