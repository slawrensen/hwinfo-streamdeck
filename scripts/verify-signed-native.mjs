// The release's sign job runs this right after the signing service signs
// the native binaries: it holds each signed file to the unsigned build it
// was made from and to what Windows says about its signature, and writes
// the facts the native manifest records (signature.json). Every check must
// pass for every shipped binary (scripts/lib/native-binaries.mjs):
//
// 1. structure: the signed file minus its signature is the unsigned build
//    (neutral hashes equal), the unsigned build carries no signature, and
//    the digest the signature commits to is the Authenticode image digest
//    of both (scripts/lib/authenticode.mjs, bytes only);
// 2. signtool `verify /pa /all /v` succeeds, reports a timestamp, and the
//    file hash it reports is that image digest;
// 3. Get-AuthenticodeSignature reports Valid, an Authenticode signature, a
//    signer and a timestamping certificate;
// 4. the signer subject equals EXPECTED_SUBJECT once that is set (after the
//    first signing), and every binary has the same signer.
//
//   node scripts/verify-signed-native.mjs --signed <dir> --unsigned <dir> --out <signature.json>
//
// Recorded alongside, from the environment: ARTIFACT_SIGNING_ENDPOINT,
// ARTIFACT_SIGNING_ACCOUNT, ARTIFACT_SIGNING_PROFILE and SIGNING_ACTION
// (the pinned action reference). Builtins only: the sign job installs no
// dependencies.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareSignedToUnsigned } from "./lib/authenticode.mjs";
import { authenticodeSignature, fileVersion, findSigntool, signtoolVerify } from "./lib/authenticode-windows.mjs";
import { NATIVE_BINARIES } from "./lib/native-binaries.mjs";

/**
 * Verifies every shipped binary. `windows` supplies the trust checks
 * (injected by the tests). Returns { problems, record }: record is the
 * signature.json content, written only when problems is empty.
 */
export function verifySigned({ signedDir, unsignedDir, env = process.env, windows = { authenticodeSignature, fileVersion, findSigntool, signtoolVerify } }) {
	const problems = [];
	const signtool = windows.findSigntool();
	if (signtool === null) problems.push("UNAVAILABLE: no Windows SDK signtool.exe (x64) on this machine");
	const record = {
		service: "Azure Artifact Signing",
		endpoint: env.ARTIFACT_SIGNING_ENDPOINT || null,
		account: env.ARTIFACT_SIGNING_ACCOUNT || null,
		profile: env.ARTIFACT_SIGNING_PROFILE || null,
		action: env.SIGNING_ACTION || null,
		signtool: signtool === null ? null : { sdk: signtool.sdk, fileVersion: windows.fileVersion(signtool.path) },
		verifiedOn: { os: `${os.platform()} ${os.release()}`, runnerImage: env.ImageOS && env.ImageVersion ? `${env.ImageOS} ${env.ImageVersion}` : null },
		files: {}
	};
	const expectedSubject = env.EXPECTED_SUBJECT || "";
	for (const binary of NATIVE_BINARIES) {
		const signedPath = path.join(signedDir, binary.file);
		const unsignedPath = path.join(unsignedDir, binary.file);
		if (!fs.existsSync(signedPath) || !fs.existsSync(unsignedPath)) {
			problems.push(`${binary.file}: ${fs.existsSync(signedPath) ? unsignedPath : signedPath} not found`);
			continue;
		}
		const { problems: structure, facts } = compareSignedToUnsigned(fs.readFileSync(signedPath), fs.readFileSync(unsignedPath));
		problems.push(...structure.map((problem) => `${binary.file}: ${problem}`));
		const entry = { ...facts, status: null, signatureType: null, signer: null, timestamper: null, timestamp: null };
		record.files[binary.file] = entry;
		if (signtool !== null) {
			const verdict = windows.signtoolVerify(signedPath, signtool.path);
			if (!verdict.ok) problems.push(`${binary.file}: signtool verify /pa failed: ${verdict.output.trim().split(/\r?\n/).filter((line) => /error|warning/i.test(line)).slice(0, 3).join(" ") || "no success line"}`);
			if (verdict.timestamp === null) problems.push(`${binary.file}: signtool reports no timestamp; an Artifact Signing certificate lives 3 days, so an untimestamped signature stops validating`);
			entry.timestamp = verdict.timestamp;
			const reported = /Hash of file \((sha\d+)\):\s*([0-9A-Fa-f]+)/.exec(verdict.output);
			if (reported && facts.imageDigest !== null && reported[1].toLowerCase() === facts.digestAlgorithm && reported[2].toLowerCase() !== facts.imageDigest) problems.push(`${binary.file}: signtool hashes the file as ${reported[2].toLowerCase().slice(0, 12)}, the image digest here is ${facts.imageDigest.slice(0, 12)}`);
		}
		let status = null;
		try {
			status = windows.authenticodeSignature(signedPath);
		} catch (err) {
			problems.push(`${binary.file}: ${err.message}`);
		}
		if (status !== null) {
			Object.assign(entry, { status: status.status, signatureType: status.signatureType, signer: status.signer, timestamper: status.timestamper });
			if (status.status !== "Valid") problems.push(`${binary.file}: Get-AuthenticodeSignature reports ${status.status}: ${status.statusMessage}`);
			if (status.signatureType !== "Authenticode" && status.signatureType !== "") problems.push(`${binary.file}: Get-AuthenticodeSignature reports a ${status.signatureType} signature, not an embedded Authenticode one`);
			if (status.signer === null) problems.push(`${binary.file}: Get-AuthenticodeSignature reports no signer certificate`);
			if (status.timestamper === null) problems.push(`${binary.file}: Get-AuthenticodeSignature reports no timestamping certificate`);
			if (expectedSubject !== "" && status.signer !== null && status.signer.subject !== expectedSubject) problems.push(`${binary.file}: signed by "${status.signer.subject}", EXPECTED_SUBJECT is "${expectedSubject}"`);
		}
	}
	const thumbprints = new Set(Object.values(record.files).map((entry) => entry.signer?.thumbprint).filter(Boolean));
	if (thumbprints.size > 1) problems.push(`the binaries carry different signers (${[...thumbprints].join(", ")})`);
	return { problems, record };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const option = (name) => {
		const at = args.indexOf(name);
		return at >= 0 ? args[at + 1] : undefined;
	};
	const signedDir = option("--signed");
	const unsignedDir = option("--unsigned");
	const out = option("--out");
	if (!signedDir || !unsignedDir || !out) {
		console.error("usage: verify-signed-native.mjs --signed <dir> --unsigned <dir> --out <signature.json>");
		process.exit(2);
	}
	const { problems, record } = verifySigned({ signedDir: path.resolve(signedDir), unsignedDir: path.resolve(unsignedDir) });
	for (const [file, entry] of Object.entries(record.files)) {
		console.log(`${file}: signed ${entry.signedSha256} (${entry.signedBytes} bytes), unsigned ${entry.unsignedSha256}, ${entry.status ?? "status unknown"}, signer ${entry.signer?.subject ?? "none"} ${entry.signer?.thumbprint ?? ""}, timestamped ${entry.timestamp ?? "never"}`);
	}
	if (problems.length > 0) {
		console.error(`SIGNATURE VERIFICATION: ${problems.length} failure(s)`);
		for (const problem of problems) console.error(`  ${problem}`);
		process.exit(1);
	}
	fs.writeFileSync(path.resolve(out), `${JSON.stringify(record, null, "\t")}\n`);
	console.log(`SIGNATURE VERIFICATION: OK (${Object.keys(record.files).join(", ")}: valid, timestamped, and the reproduced unsigned build plus a signature)`);
}
