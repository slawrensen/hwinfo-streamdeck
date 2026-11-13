// The sign job's own checks, without a signing service: the configuration
// gate (scripts/signing-config-check.mjs) and the post-signing verification
// (scripts/verify-signed-native.mjs) over synthetic PE32+ images with
// synthetic signatures (scripts/lib/pe-fixture.mjs). Windows' answers
// (signtool, Get-AuthenticodeSignature) are injected, so each way the
// service or the trust chain can let the release down is one case: no
// certificate, no key, no network.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { authenticodeImageDigest } from "../scripts/lib/authenticode.mjs";
import { parseSigntoolVerify } from "../scripts/lib/authenticode-windows.mjs";
import { buildPe, fakeSign } from "../scripts/lib/pe-fixture.mjs";
import { signingConfigProblems, signingModeProblem } from "../scripts/signing-config-check.mjs";
import { verifySigned } from "../scripts/verify-signed-native.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

describe("signing configuration gate", () => {
	const good = {
		AZURE_CLIENT_ID: "11111111-2222-3333-4444-555555555555",
		AZURE_TENANT_ID: "66666666-7777-8888-9999-aaaaaaaaaaaa",
		AZURE_SUBSCRIPTION_ID: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
		ARTIFACT_SIGNING_ENDPOINT: "https://eus.codesigning.azure.net/",
		ARTIFACT_SIGNING_ACCOUNT: "hwinfo-signing",
		ARTIFACT_SIGNING_PROFILE: "hwinfo-public-trust"
	};

	it("accepts a complete configuration, with or without the subject pin", () => {
		assert.deepEqual(signingConfigProblems(good), []);
		assert.deepEqual(signingConfigProblems({ ...good, ARTIFACT_SIGNING_EXPECTED_SUBJECT: "CN=Stephen Lawrensen, O=Stephen Lawrensen, C=US" }), []);
		assert.deepEqual(signingConfigProblems({ ...good, ARTIFACT_SIGNING_ENDPOINT: "https://wus2.codesigning.azure.net" }), []);
	});

	it("names every missing value and never echoes a value", () => {
		const problems = signingConfigProblems({});
		assert.equal(problems.length, 6);
		for (const name of Object.keys(good)) assert.ok(problems.some((p) => p.startsWith(`${name} is not set`)), name);
		const mistyped = signingConfigProblems({ ...good, AZURE_CLIENT_ID: "not-a-guid-secret-value", ARTIFACT_SIGNING_ENDPOINT: "http://eus.codesigning.azure.net/", ARTIFACT_SIGNING_ACCOUNT: "a", ARTIFACT_SIGNING_EXPECTED_SUBJECT: "Stephen" });
		assert.equal(mistyped.length, 4);
		assert.ok(mistyped.every((p) => !p.includes("not-a-guid-secret-value")));
	});

	it("accepts only the signing modes the release understands", () => {
		for (const mode of [undefined, "", "off", "required"]) assert.equal(signingModeProblem(mode), null, String(mode));
		for (const mode of ["Required", "on", "true", " required"]) assert.match(signingModeProblem(mode) ?? "", /must be unset, "off" \(ship unsigned\) or "required"/, mode);
	});

	it("runs as a command for both jobs", () => {
		const script = path.join(ROOT, "scripts", "signing-config-check.mjs");
		const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(AZURE_|ARTIFACT_SIGNING_|SIGNING_MODE)/.test(key)));
		const run = (args, env) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...clean, ...env } });
		assert.equal(run(["--mode"], {}).status, 0);
		assert.equal(run(["--mode"], { SIGNING_MODE: "Required" }).status, 1);
		assert.equal(run([], good).status, 0);
		const missing = run([], { ...good, AZURE_TENANT_ID: "" });
		assert.equal(missing.status, 1);
		assert.match(missing.stderr, /AZURE_TENANT_ID is not set/);
	});
});

describe("signtool verify output", () => {
	it("reads the verdict and the timestamp, and refuses an untimestamped or failed verification", () => {
		const success = "Verifying: x.node\nHash of file (sha256): AB\nThe signature is timestamped: Fri Oct 24 12:00:00 2026\nTimestamp Verified by:\nSuccessfully verified: x.node\n\nNumber of files successfully Verified: 1\nNumber of warnings: 0\nNumber of errors: 0\n";
		assert.deepEqual({ ...parseSigntoolVerify(success, 0), output: "" }, { ok: true, timestamp: "Fri Oct 24 12:00:00 2026", output: "" });
		assert.equal(parseSigntoolVerify(success.replace(/The signature is timestamped.*\n/, "File is not timestamped.\n"), 0).timestamp, null);
		assert.equal(parseSigntoolVerify("SignTool Error: No signature found.\nNumber of errors: 1\n", 1).ok, false);
		assert.equal(parseSigntoolVerify(success, 1).ok, false, "a nonzero exit is a failure whatever the text says");
	});
});

describe("post-signing verification", () => {
	const dirs = [];
	after(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });
	const signer = { subject: "CN=Stephen Lawrensen, O=Stephen Lawrensen, C=US", issuer: "CN=Microsoft ID Verified CS AOC CA 01, O=Microsoft Corporation, C=US", thumbprint: "AB".repeat(20), serialNumber: "33", notBefore: "2026-10-24T00:00:00.0000000Z", notAfter: "2026-10-27T00:00:00.0000000Z" };
	const timestamper = { subject: "CN=Microsoft Public RSA Time Stamping Authority", issuer: "CN=Microsoft Public RSA Timestamping CA 2020", thumbprint: "CD".repeat(20), serialNumber: "34", notBefore: "2025-10-23T00:00:00.0000000Z", notAfter: "2026-10-22T00:00:00.0000000Z" };

	/** Signed and unsigned directories holding the shipped binary. */
	function trees({ tamper = null } = {}) {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "hwinfo-signed-"));
		dirs.push(root);
		const signedDir = path.join(root, "signed");
		const unsignedDir = path.join(root, "unsigned");
		fs.mkdirSync(signedDir);
		fs.mkdirSync(unsignedDir);
		for (const file of ["hwsm.node"]) {
			const unsigned = buildPe({ code: Buffer.from(`unsigned ${file}`), pdb: file.replace(".node", ".pdb") });
			const signed = fakeSign(unsigned, { digestHex: authenticodeImageDigest(unsigned) });
			if (tamper === file) signed[0x200] ^= 0x01;
			fs.writeFileSync(path.join(unsignedDir, file), unsigned);
			fs.writeFileSync(path.join(signedDir, file), signed);
		}
		return { signedDir, unsignedDir };
	}

	/** Windows answering the way it does for a good Artifact Signing signature,
	 * with `overrides` per check. */
	const windows = (overrides = {}) => ({
		findSigntool: () => ({ path: "signtool.exe", sdk: "10.0.26100.0" }),
		fileVersion: () => "10.0.26100.4188",
		signtoolVerify: () => ({ ok: true, timestamp: "Fri Oct 24 12:00:00 2026", output: "Successfully verified" }),
		authenticodeSignature: () => ({ status: "Valid", statusMessage: "Signature verified.", signatureType: "Authenticode", signer, timestamper }),
		...overrides
	});
	const env = { ARTIFACT_SIGNING_ENDPOINT: "https://eus.codesigning.azure.net/", ARTIFACT_SIGNING_ACCOUNT: "acct", ARTIFACT_SIGNING_PROFILE: "prof", SIGNING_ACTION: "azure/artifact-signing-action@c7ab2a863ab5f9a846ddb8265964877ef296ee82", ImageOS: "win25", ImageVersion: "20261021.278.1" };

	it("passes the binary and records the facts the manifest carries", () => {
		const { signedDir, unsignedDir } = trees();
		const { problems, record } = verifySigned({ signedDir, unsignedDir, env, windows: windows() });
		assert.deepEqual(problems, []);
		assert.deepEqual(Object.keys(record.files), ["hwsm.node"]);
		assert.equal(record.service, "Azure Artifact Signing");
		assert.equal(record.account, "acct");
		assert.deepEqual(record.signtool, { sdk: "10.0.26100.0", fileVersion: "10.0.26100.4188" });
		assert.equal(record.verifiedOn.runnerImage, "win25 20261021.278.1");
		const hwsm = record.files["hwsm.node"];
		assert.equal(hwsm.status, "Valid");
		assert.equal(hwsm.signer.thumbprint, signer.thumbprint);
		assert.equal(hwsm.timestamp, "Fri Oct 24 12:00:00 2026");
		assert.equal(hwsm.neutralSha256, hwsm.unsignedSha256);
		assert.equal(hwsm.signedSha256.length, 64);
		assert.equal(hwsm.digestAlgorithm, "sha256");
	});

	it("fails when the signed bytes changed beyond the signature", () => {
		const { signedDir, unsignedDir } = trees({ tamper: "hwsm.node" });
		const { problems } = verifySigned({ signedDir, unsignedDir, env, windows: windows() });
		assert.ok(problems.some((p) => p.startsWith("hwsm.node: the signed file without its signature")), problems.join("\n"));
	});

	it("fails on a signature Windows does not trust, an untimestamped one and a failed signtool run", () => {
		const { signedDir, unsignedDir } = trees();
		const untrusted = verifySigned({ signedDir, unsignedDir, env, windows: windows({ authenticodeSignature: () => ({ status: "UnknownError", statusMessage: "A certificate chain processed, but terminated in a root certificate which is not trusted by the trust provider.", signatureType: "Authenticode", signer, timestamper: null }) }) }).problems;
		assert.ok(untrusted.some((p) => /hwsm\.node: Get-AuthenticodeSignature reports UnknownError/.test(p)));
		assert.ok(untrusted.some((p) => /hwsm\.node: Get-AuthenticodeSignature reports no timestamping certificate/.test(p)));
		const untimestamped = verifySigned({ signedDir, unsignedDir, env, windows: windows({ signtoolVerify: () => ({ ok: true, timestamp: null, output: "Successfully verified" }) }) }).problems;
		assert.ok(untimestamped.some((p) => /signtool reports no timestamp/.test(p)));
		const failed = verifySigned({ signedDir, unsignedDir, env, windows: windows({ signtoolVerify: () => ({ ok: false, timestamp: null, output: "SignTool Error: A certificate chain could not be built to a trusted root authority." }) }) }).problems;
		assert.ok(failed.some((p) => /signtool verify \/pa failed: SignTool Error: A certificate chain/.test(p)));
	});

	it("fails when signtool hashes the file differently from the image digest", () => {
		const { signedDir, unsignedDir } = trees();
		const problems = verifySigned({ signedDir, unsignedDir, env, windows: windows({ signtoolVerify: () => ({ ok: true, timestamp: "now", output: `Hash of file (sha256): ${"EE".repeat(32)}\nSuccessfully verified` }) }) }).problems;
		assert.ok(problems.some((p) => /signtool hashes the file as eeeeeeeeeeee/.test(p)));
	});

	it("holds the signer to EXPECTED_SUBJECT once set", () => {
		const { signedDir, unsignedDir } = trees();
		assert.deepEqual(verifySigned({ signedDir, unsignedDir, env: { ...env, EXPECTED_SUBJECT: signer.subject }, windows: windows() }).problems, []);
		const other = verifySigned({ signedDir, unsignedDir, env: { ...env, EXPECTED_SUBJECT: "CN=Someone Else" }, windows: windows() }).problems;
		assert.equal(other.filter((p) => /EXPECTED_SUBJECT is "CN=Someone Else"/.test(p)).length, 1);
	});

	it("is UNAVAILABLE without signtool, and fails on a missing file", () => {
		const { signedDir, unsignedDir } = trees();
		assert.ok(verifySigned({ signedDir, unsignedDir, env, windows: windows({ findSigntool: () => null }) }).problems.some((p) => p.startsWith("UNAVAILABLE: no Windows SDK signtool.exe")));
		fs.rmSync(path.join(signedDir, "hwsm.node"));
		assert.ok(verifySigned({ signedDir, unsignedDir, env, windows: windows() }).problems.some((p) => /^hwsm\.node: .*hwsm\.node not found$/.test(p)));
	});
});
