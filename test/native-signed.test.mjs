// Signed native binaries through the real release tools, on the real
// built addon (needs bin/hwsm.node, like the rest of test:native). The signature here is synthetic: a structurally complete
// Authenticode PKCS#7 committing to the addon's real image digest, with no
// certificate (scripts/lib/pe-fixture.mjs fakeSign), so the manifest and
// the packaging gate see exactly the layout signing produces while Windows
// rightly refuses to call it Valid. The last suite reads signatures that
// real signing services put on executables already on the machine (the
// Node runtime running this test, Git) and holds the digest reader to them.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { authenticodeImageDigest, authenticodeNeutral, authenticodeStructureProblem, peLayout, signedDigest } from "../scripts/lib/authenticode.mjs";
import { GATE_INPUTS, judgeSignedCopies } from "../scripts/lib/native-gate-tree.mjs";
import { fakeSign } from "../scripts/lib/pe-fixture.mjs";

const ROOT = process.cwd();
const BIN = path.join(ROOT, "com.lawrensen.hwinfo.sdPlugin", "bin");
const FILES = ["hwsm.node"];
const onWindows = process.platform === "win32" && process.arch === "x64";
const skip = !onWindows ? "win32-x64 only" : FILES.some((file) => !fs.existsSync(path.join(BIN, file))) ? "bin/hwsm.node not built" : false;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const dirs = [];
after(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });
const temp = (prefix) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	dirs.push(dir);
	return dir;
};

const signer = { subject: "CN=Synthetic Test Signer", issuer: "CN=Synthetic Test CA", thumbprint: "AB".repeat(20), serialNumber: "01", notBefore: "2026-10-24T00:00:00.0000000Z", notAfter: "2026-10-27T00:00:00.0000000Z" };

/** unsigned/ (the built addons), signed/ (synthetic signatures over their
 * real image digests) and the signature.json a sign job would write. */
function signedSet() {
	const root = temp("hwinfo-signed-native-");
	const unsignedDir = path.join(root, "unsigned");
	const signedDir = path.join(root, "signed");
	fs.mkdirSync(unsignedDir);
	fs.mkdirSync(signedDir);
	const files = {};
	for (const file of FILES) {
		const unsigned = fs.readFileSync(path.join(BIN, file));
		const signed = fakeSign(unsigned, { digestHex: authenticodeImageDigest(unsigned) });
		fs.writeFileSync(path.join(unsignedDir, file), unsigned);
		fs.writeFileSync(path.join(signedDir, file), signed);
		files[file] = { signedSha256: sha256(signed), signedBytes: signed.length, unsignedSha256: sha256(unsigned), status: "Valid", signatureType: "Authenticode", signer, timestamper: { ...signer, subject: "CN=Synthetic TSA" }, timestamp: "Fri Oct 24 12:00:00 2026", digestAlgorithm: "sha256", imageDigest: authenticodeImageDigest(unsigned) };
	}
	const signature = path.join(root, "signature.json");
	fs.writeFileSync(signature, JSON.stringify({ service: "Azure Artifact Signing", endpoint: "https://eus.codesigning.azure.net/", account: "acct", profile: "prof", action: "azure/artifact-signing-action@c7ab2a863ab5f9a846ddb8265964877ef296ee82", signtool: { sdk: "10.0.26100.0" }, verifiedOn: null, files }));
	return { root, unsignedDir, signedDir, signature };
}

function manifest(args, out) {
	const env = { ...process.env, GITHUB_RUN_ID: undefined, HWSM_CL_VERSION: undefined, HWSM_MANIFEST_OUT: out };
	return spawnSync(process.execPath, [path.join(ROOT, "scripts", "native-manifest.mjs"), ...args, "--no-toolchain"], { cwd: ROOT, encoding: "utf8", env });
}

describe("native manifest: signed binaries", { skip }, () => {
	it("records the signed bytes, the unsigned build, the neutral hash and the verified signature", () => {
		const { root, unsignedDir, signedDir, signature } = signedSet();
		const out = path.join(root, "manifest.json");
		const r = manifest([path.join(signedDir, "hwsm.node"), "--unsigned", unsignedDir, "--signature", signature], out);
		assert.equal(r.status, 0, r.stderr);
		const m = JSON.parse(fs.readFileSync(out, "utf8"));
		assert.equal(m.sha256, sha256(fs.readFileSync(path.join(signedDir, "hwsm.node"))), "the version 1 sha256 is the shipped, signed file");
		for (const record of m.binaries) {
			const unsigned = fs.readFileSync(path.join(unsignedDir, record.file));
			const signed = fs.readFileSync(path.join(signedDir, record.file));
			assert.equal(record.sha256, sha256(signed));
			assert.equal(record.byteSize, signed.length);
			assert.equal(record.unsignedSha256, sha256(unsigned));
			assert.equal(record.unsignedByteSize, unsigned.length);
			assert.equal(record.authenticodeNeutralSha256, sha256(unsigned));
			assert.deepEqual(record.certificateTable, { offset: unsigned.length, size: signed.length - unsigned.length });
			assert.equal(record.signature.status, "Valid");
			assert.equal(record.signature.signer.thumbprint, signer.thumbprint);
			assert.equal(record.signature.timestamp, "Fri Oct 24 12:00:00 2026");
			assert.equal(record.signature.service, "Azure Artifact Signing");
			assert.equal(record.signature.signedSha256, sha256(signed));
			assert.equal(record.codeView.path, record.file.replace(".node", ".pdb"), "signing leaves the CodeView record alone");
			assert.match(record.nativeSourceId ?? "", /^[0-9a-f]{16}$/, "the signed file still loads and reports its build");
		}
		assert.match(r.stdout, /signed by CN=Synthetic Test Signer/);
	});

	it("records an unsigned build as its own unsigned identity with no signature", () => {
		const root = temp("hwinfo-unsigned-manifest-");
		const out = path.join(root, "manifest.json");
		const r = manifest([path.join(BIN, "hwsm.node")], out);
		assert.equal(r.status, 0, r.stderr);
		for (const record of JSON.parse(fs.readFileSync(out, "utf8")).binaries) {
			assert.equal(record.unsignedSha256, record.sha256);
			assert.equal(record.authenticodeNeutralSha256, record.sha256, "the linker writes CheckSum 0, so the neutral form is the file");
			assert.equal(record.signature, null);
		}
	});

	it("refuses a signed binary without its unsigned build or without verified signature facts", () => {
		const { root, unsignedDir, signedDir, signature } = signedSet();
		const out = path.join(root, "manifest.json");
		const signed = [path.join(signedDir, "hwsm.node")];
		const noUnsigned = manifest([...signed, "--signature", signature], out);
		assert.equal(noUnsigned.status, 1);
		assert.match(noUnsigned.stderr, /carries an Authenticode signature; record it with --unsigned <dir>/);
		const noFacts = manifest([...signed, "--unsigned", unsignedDir], out);
		assert.equal(noFacts.status, 1);
		assert.match(noFacts.stderr, /is signed, but no --signature facts describe it/);
		assert.equal(fs.existsSync(out), false);
	});

	it("refuses an unsigned build that is not the signed file minus its signature", () => {
		const { root, unsignedDir, signedDir, signature } = signedSet();
		const out = path.join(root, "manifest.json");
		// Another build named as the unsigned one: one byte of its code differs.
		const other = fs.readFileSync(path.join(unsignedDir, "hwsm.node"));
		other[0x400] ^= 0x01;
		fs.writeFileSync(path.join(unsignedDir, "hwsm.node"), other);
		const r = manifest([path.join(signedDir, "hwsm.node"), "--unsigned", unsignedDir, "--signature", signature], out);
		assert.equal(r.status, 1);
		assert.match(r.stderr, /hwsm\.node without its signature \([0-9a-f]{12}…\) is not the unsigned build/);
	});

	it("refuses signature facts for other bytes, and for a binary that carries no signature", () => {
		const { root, unsignedDir, signedDir, signature } = signedSet();
		const out = path.join(root, "manifest.json");
		const facts = JSON.parse(fs.readFileSync(signature, "utf8"));
		facts.files["hwsm.node"].signedSha256 = "0".repeat(64);
		const stale = path.join(root, "stale.json");
		fs.writeFileSync(stale, JSON.stringify(facts));
		const wrong = manifest([path.join(signedDir, "hwsm.node"), "--unsigned", unsignedDir, "--signature", stale], out);
		assert.equal(wrong.status, 1);
		assert.match(wrong.stderr, /--signature describes hwsm\.node as 000000000000/);
		const unsignedShipped = manifest([path.join(unsignedDir, "hwsm.node"), "--unsigned", unsignedDir, "--signature", signature], out);
		assert.equal(unsignedShipped.status, 1);
		assert.match(unsignedShipped.stderr, /--signature describes a signature for hwsm\.node, but hwsm\.node carries none/);
	});

	it("refuses an unsigned build whose CheckSum is not the linker's 0", () => {
		// Without its signature the signed file comes back with CheckSum 0, so
		// the gate could not tie the recorded unsigned hash to the shipped
		// bytes; the manifest refuses to record such a pair.
		const { root, unsignedDir, signedDir, signature } = signedSet();
		const out = path.join(root, "manifest.json");
		const file = path.join(unsignedDir, "hwsm.node");
		const unsigned = fs.readFileSync(file);
		unsigned.writeUInt32LE(0x1234, peLayout(unsigned).checksumOffset);
		fs.writeFileSync(file, unsigned);
		const r = manifest([path.join(signedDir, "hwsm.node"), "--unsigned", unsignedDir, "--signature", signature], out);
		assert.equal(r.status, 1);
		assert.match(r.stderr, /the unsigned hwsm\.node in .* carries PE CheckSum 0x1234; the linker writes 0/);
		assert.equal(fs.existsSync(out), false);
	});

	it("refuses a certificate table followed by more bytes", () => {
		const { root, unsignedDir, signedDir, signature } = signedSet();
		const out = path.join(root, "manifest.json");
		fs.appendFileSync(path.join(signedDir, "hwsm.node"), Buffer.alloc(8));
		const r = manifest([path.join(signedDir, "hwsm.node"), "--unsigned", unsignedDir, "--signature", signature], out);
		assert.equal(r.status, 1);
		assert.match(r.stderr, /hwsm\.node carries a certificate table signing would not produce: 8 bytes follow the certificate table/);
	});

	it("carries the build job's facts over from --build-manifest and holds the unsigned builds to it", () => {
		const { root, unsignedDir, signedDir, signature } = signedSet();
		const build = path.join(root, "build-manifest.json");
		const built = manifest([path.join(unsignedDir, "hwsm.node")], build);
		assert.equal(built.status, 0, built.stderr);
		const buildFacts = JSON.parse(fs.readFileSync(build, "utf8"));
		buildFacts.compilerVersion = "19.51.36260";
		buildFacts.windowsSdkVersion = "10.0.26100.0";
		buildFacts.toolchain = { inputsDigest: "f".repeat(64), binaries: {} };
		fs.writeFileSync(build, JSON.stringify(buildFacts));
		const out = path.join(root, "manifest.json");
		const args = [path.join(signedDir, "hwsm.node"), "--unsigned", unsignedDir, "--signature", signature, "--build-manifest", build];
		const env = { ...process.env, GITHUB_RUN_ID: undefined, HWSM_CL_VERSION: undefined, HWSM_MANIFEST_OUT: out };
		const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "native-manifest.mjs"), ...args], { cwd: ROOT, encoding: "utf8", env });
		assert.equal(r.status, 0, r.stderr);
		const m = JSON.parse(fs.readFileSync(out, "utf8"));
		assert.equal(m.compilerVersion, "19.51.36260");
		assert.equal(m.windowsSdkVersion, "10.0.26100.0");
		assert.equal(m.toolchain.inputsDigest, "f".repeat(64));
		buildFacts.binaries[0].sha256 = "1".repeat(64);
		fs.writeFileSync(build, JSON.stringify(buildFacts));
		const mismatch = spawnSync(process.execPath, [path.join(ROOT, "scripts", "native-manifest.mjs"), ...args], { cwd: ROOT, encoding: "utf8", env });
		assert.equal(mismatch.status, 1);
		assert.match(mismatch.stderr, /--build-manifest records hwsm\.node as 111111111111…, the unsigned build here is/);
	});
});

describe("native manifest: a binary carried forward from the previous release", { skip }, () => {
	// The build job carried hwsm.node forward (scripts/native-carry-forward.mjs):
	// the unsigned directory holds the previous release's file, the build
	// manifest describes this run's rebuild of the same source (a different
	// hash), and carry-forward.json ties the two together.
	function carriedSet() {
		const root = temp("hwinfo-carried-manifest-");
		const unsignedDir = path.join(root, "unsigned");
		fs.mkdirSync(unsignedDir);
		for (const file of FILES) fs.copyFileSync(path.join(BIN, file), path.join(unsignedDir, file));
		const build = path.join(root, "build-manifest.json");
		assert.equal(manifest([path.join(unsignedDir, "hwsm.node")], build).status, 0);
		const buildFacts = JSON.parse(fs.readFileSync(build, "utf8"));
		const carriedSha = buildFacts.binaries[0].sha256;
		const rebuiltSha = "e".repeat(64);
		buildFacts.binaries[0].sha256 = rebuiltSha;
		buildFacts.compilerVersion = "19.52.40000";
		buildFacts.windowsSdkVersion = "10.0.26100.0";
		fs.writeFileSync(build, JSON.stringify(buildFacts));
		const carry = { mode: "on", previous: { release: "v1.7.1", compilerVersion: "19.51.36260", windowsSdkVersion: "10.0.22621.0" }, binaries: { "hwsm.node": { decision: "carried", reason: "unchanged", sha256: carriedSha, rebuiltSha256: rebuiltSha, carriedFrom: { release: "v1.7.1", firstShippedIn: "v1.7.1", sha256: carriedSha, unsignedSha256: carriedSha } } } };
		const carryFile = path.join(root, "carry-forward.json");
		fs.writeFileSync(carryFile, JSON.stringify(carry));
		return { root, unsignedDir, build, carry, carryFile, carriedSha, rebuiltSha };
	}
	const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));

	it("records where the carried binary came from and this run's rebuild, and takes hwsm's compiler facts from that release", () => {
		const { root, unsignedDir, build, carryFile, carriedSha, rebuiltSha } = carriedSet();
		const out = path.join(root, "manifest.json");
		const r = manifest([path.join(unsignedDir, "hwsm.node"), "--build-manifest", build, "--unsigned", unsignedDir, "--carry-forward", carryFile], out);
		assert.equal(r.status, 0, r.stderr);
		const m = JSON.parse(fs.readFileSync(out, "utf8"));
		assert.equal(m.sha256, carriedSha, "the version 1 sha256 is the shipped, carried file");
		assert.deepEqual(m.binaries[0].reproducibility, { carriedFrom: { release: "v1.7.1", firstShippedIn: "v1.7.1", sha256: carriedSha, unsignedSha256: carriedSha }, rebuiltSha256: rebuiltSha, rebuiltIdentical: false });
		assert.equal(m.binaries.length, 1);
		assert.equal(m.compilerVersion, "19.51.36260", "the carried hwsm.node was compiled for v1.7.1");
		assert.equal(m.windowsSdkVersion, "10.0.22621.0");
		assert.match(r.stdout, /carried forward from v1\.7\.1 \(native source unchanged\); this run's rebuild eeeeeeeeeeeeeeee/);
	});

	it("refuses a carried file that is not the one carry-forward.json names, or a build manifest of another rebuild", () => {
		const { root, unsignedDir, build, carry, carryFile } = carriedSet();
		const out = path.join(root, "manifest.json");
		const args = [path.join(unsignedDir, "hwsm.node"), "--build-manifest", build, "--unsigned", unsignedDir, "--carry-forward", carryFile];
		write(carryFile, { ...carry, binaries: { ...carry.binaries, "hwsm.node": { ...carry.binaries["hwsm.node"], sha256: "1".repeat(64) } } });
		const wrongFile = manifest(args, out);
		assert.equal(wrongFile.status, 1);
		assert.match(wrongFile.stderr, /--carry-forward records the carried hwsm\.node as 111111111111…, the unsigned build here is/);
		write(carryFile, { ...carry, binaries: { ...carry.binaries, "hwsm.node": { ...carry.binaries["hwsm.node"], rebuiltSha256: "2".repeat(64) } } });
		const otherRebuild = manifest(args, out);
		assert.equal(otherRebuild.status, 1);
		assert.match(otherRebuild.stderr, /--build-manifest records hwsm\.node as eeeeeeeeeeee…, --carry-forward records this run's rebuild as 222222222222…/);
		const noCarry = manifest(args.slice(0, -2), out);
		assert.equal(noCarry.status, 1, "without carry-forward.json the build manifest's rebuild hash does not describe the carried file");
		assert.match(noCarry.stderr, /these are not the bytes the build job produced/);
		assert.equal(fs.existsSync(out), false);
	});
});

// The gate runs over the same inputs the signing-structure selftest stages.
const STAGED = GATE_INPUTS;

describe("native packaging gate: signed binaries", { skip }, () => {
	/** A staged tree whose bin/ holds the synthetic-signed addons and a
	 * manifest describing them; `edit` may change the manifest. */
	function stagedSigned({ manifestEdit = null, binFrom = "signed" } = {}) {
		const set = signedSet();
		const root = temp("hwinfo-signed-gate-");
		for (const rel of STAGED) {
			fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
			fs.copyFileSync(path.join(ROOT, rel), path.join(root, rel));
		}
		const bin = path.join(root, "com.lawrensen.hwinfo.sdPlugin", "bin");
		fs.mkdirSync(bin, { recursive: true });
		for (const file of FILES) fs.copyFileSync(path.join(binFrom === "signed" ? set.signedDir : set.unsignedDir, file), path.join(bin, file));
		const out = path.join(root, "release-native-manifest.json");
		const r = manifest([path.join(set.signedDir, "hwsm.node"), "--unsigned", set.unsignedDir, "--signature", set.signature], out);
		assert.equal(r.status, 0, r.stderr);
		if (manifestEdit !== null) {
			const m = JSON.parse(fs.readFileSync(out, "utf8"));
			manifestEdit(m, set);
			fs.writeFileSync(out, JSON.stringify(m));
		}
		return root;
	}
	const gate = (root, env = {}) => spawnSync(process.execPath, [path.join(root, "scripts", "validate-native.mjs")], { cwd: root, encoding: "utf8", env: { ...process.env, HWSM_REQUIRE_SIGNED: undefined, HWSM_NATIVE_MANIFEST: undefined, ...env } });

	it("passes signed addons the manifest records with their unsigned builds", () => {
		const r = gate(stagedSigned());
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, /signed \(hwsm\.node\)/);
	});

	it("refuses a signed addon whose signature the manifest does not record", () => {
		const r = gate(stagedSigned({ manifestEdit: (m) => { m.binaries[0].signature = null; } }));
		assert.equal(r.status, 1);
		assert.match(r.stderr, /bin\/hwsm\.node carries an Authenticode signature that release-native-manifest\.json does not record/);
	});

	it("refuses a recorded signature on an addon that carries none", () => {
		const r = gate(stagedSigned({ binFrom: "unsigned", manifestEdit: (m, set) => {
			for (const record of m.binaries) record.sha256 = sha256(fs.readFileSync(path.join(set.unsignedDir, record.file)));
			m.sha256 = m.binaries[0].sha256;
		} }));
		assert.equal(r.status, 1);
		assert.match(r.stderr, /records a signature for hwsm\.node, but bin\/hwsm\.node carries none/);
	});

	it("refuses a recorded neutral hash the signed addon does not have", () => {
		const r = gate(stagedSigned({ manifestEdit: (m) => { m.binaries[0].authenticodeNeutralSha256 = "2".repeat(64); } }));
		assert.equal(r.status, 1);
		assert.match(r.stderr, /records hwsm\.node's neutral hash as 222222222222/);
	});

	it("refuses a recorded unsigned build that is not the signed addon without its signature", () => {
		// The release notes publish unsignedSha256 as the build the run
		// reproduced, so the gate holds it to the shipped bytes.
		const r = gate(stagedSigned({ manifestEdit: (m) => { m.binaries[0].unsignedSha256 = "3".repeat(64); } }));
		assert.equal(r.status, 1);
		assert.match(r.stderr, /records hwsm\.node's unsigned build as 333333333333…, but bin\/hwsm\.node without its signature is [0-9a-f]{12}…/);
	});

	it("refuses a version 2 record without its neutral hash or its unsigned build", () => {
		const noNeutral = gate(stagedSigned({ manifestEdit: (m) => { delete m.binaries[0].authenticodeNeutralSha256; } }));
		assert.equal(noNeutral.status, 1);
		assert.match(noNeutral.stderr, /does not record hwsm\.node's neutral hash/);
		const noUnsigned = gate(stagedSigned({ manifestEdit: (m) => { delete m.binaries[0].unsignedSha256; } }));
		assert.equal(noUnsigned.status, 1);
		assert.match(noUnsigned.stderr, /does not record the unsigned build of hwsm\.node/);
	});

	it("holds an unsigned addon's recorded unsigned build to the addon itself", () => {
		const root = temp("hwinfo-unsigned-record-");
		for (const rel of STAGED) {
			fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
			fs.copyFileSync(path.join(ROOT, rel), path.join(root, rel));
		}
		fs.mkdirSync(path.join(root, "com.lawrensen.hwinfo.sdPlugin", "bin"), { recursive: true });
		for (const file of FILES) fs.copyFileSync(path.join(BIN, file), path.join(root, "com.lawrensen.hwinfo.sdPlugin", "bin", file));
		const out = path.join(root, "release-native-manifest.json");
		assert.equal(manifest([path.join(BIN, "hwsm.node")], out).status, 0);
		assert.equal(gate(root).status, 0, "the manifest of the unsigned build passes as written");
		const m = JSON.parse(fs.readFileSync(out, "utf8"));
		m.binaries[0].unsignedSha256 = "4".repeat(64);
		fs.writeFileSync(out, JSON.stringify(m));
		const r = gate(root);
		assert.equal(r.status, 1);
		assert.match(r.stderr, /records hwsm\.node's unsigned build as 444444444444…, but bin\/hwsm\.node is [0-9a-f]{12}…/);
	});

	it("reads the manifest HWSM_NATIVE_MANIFEST names, and refuses a named one that does not exist", () => {
		// qualify.mjs --native-manifest holds release bytes to their published
		// manifest without copying it over the checkout's own.
		const root = stagedSigned();
		const elsewhere = path.join(temp("hwinfo-named-manifest-"), "published.json");
		fs.renameSync(path.join(root, "release-native-manifest.json"), elsewhere);
		assert.equal(gate(root).status, 1, "without the manifest a signed addon is refused");
		const named = gate(root, { HWSM_NATIVE_MANIFEST: elsewhere });
		assert.equal(named.status, 0, named.stderr);
		const missing = gate(root, { HWSM_NATIVE_MANIFEST: `${elsewhere}.absent` });
		assert.equal(missing.status, 1);
		assert.match(missing.stderr, /HWSM_NATIVE_MANIFEST names .*published\.json\.absent, which does not exist/);
	});

	it("refuses a signed addon with no manifest at all", () => {
		const root = stagedSigned();
		fs.rmSync(path.join(root, "release-native-manifest.json"));
		const r = gate(root);
		assert.equal(r.status, 1);
		assert.match(r.stderr, /bin\/hwsm\.node carries an Authenticode signature, and a signed addon ships only with release-native-manifest\.json/);
	});

	it("judges signed copies the way the signing-structure selftest does: structure accepted, trust refused", () => {
		// The CI selftest hands real signtool output to this same function.
		const set = signedSet();
		const signatureRecord = JSON.parse(fs.readFileSync(set.signature, "utf8"));
		const verdict = judgeSignedCopies({ repoRoot: ROOT, work: temp("hwinfo-judge-"), signedDir: set.signedDir, unsignedDir: set.unsignedDir, signatureRecord });
		assert.deepEqual(verdict.problems, []);
		assert.match(verdict.structural, /NATIVE VALIDATION: OK .*signed \(hwsm\.node\)/);
		assert.match(verdict.trust, /bin\/hwsm\.node signature status (?!Valid)\w+/);
		const unsignedAsSigned = judgeSignedCopies({ repoRoot: ROOT, work: temp("hwinfo-judge-"), signedDir: set.unsignedDir, unsignedDir: set.unsignedDir, signatureRecord });
		assert.match(unsignedAsSigned.problems.join("\n"), /native-manifest refuses the signed copies/, "copies that carry no signature are not judged as signed");
	});

	it("with HWSM_REQUIRE_SIGNED=1, refuses a signature Windows does not report Valid, and an unsigned addon", () => {
		const signedRun = gate(stagedSigned(), { HWSM_REQUIRE_SIGNED: "1" });
		assert.equal(signedRun.status, 1);
		assert.match(signedRun.stderr, /bin\/hwsm\.node signature status (?!Valid)\w+/);
		const root = temp("hwinfo-unsigned-gate-");
		for (const rel of STAGED) {
			fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
			fs.copyFileSync(path.join(ROOT, rel), path.join(root, rel));
		}
		fs.mkdirSync(path.join(root, "com.lawrensen.hwinfo.sdPlugin", "bin"), { recursive: true });
		for (const file of FILES) fs.copyFileSync(path.join(BIN, file), path.join(root, "com.lawrensen.hwinfo.sdPlugin", "bin", file));
		const unsignedRun = gate(root, { HWSM_REQUIRE_SIGNED: "1" });
		assert.equal(unsignedRun.status, 1);
		assert.match(unsignedRun.stderr, /bin\/hwsm\.node is not signed \(HWSM_REQUIRE_SIGNED=1\)/);
		assert.equal(gate(root).status, 0, "the same unsigned tree passes without the requirement");
	});
});

// Real signatures, read-only: the Node runtime running this test (an
// official build is signed through Microsoft's Artifact Signing chain). Its
// embedded digest must be the Authenticode image digest computed here, and
// its neutral form must be a plain linker layout. Git for Windows' git.exe
// was a second sample until the windows-2025 runner's copy (release run
// 43492712685, 2026-11-13) gave a digest this code does not reproduce while
// the copy on my PC matches; that is open for the signing work and does not
// touch an unsigned release.
const realSigned = [process.execPath].filter((file) => {
	try {
		return fs.existsSync(file) && peLayout(fs.readFileSync(file)).certificateTable !== null;
	} catch {
		return false;
	}
});

describe("authenticode digest against real signatures", { skip: !onWindows ? "win32-x64 only" : realSigned.length === 0 ? "no signed executable found (an unofficial Node build?)" : false }, () => {
	for (const file of realSigned) {
		it(`${path.basename(file)}: the embedded digest is the image digest`, () => {
			const bytes = fs.readFileSync(file);
			assert.equal(authenticodeStructureProblem(bytes), null);
			const embedded = signedDigest(bytes);
			assert.ok(embedded !== null);
			assert.equal(embedded.hex, authenticodeImageDigest(bytes, embedded.algorithm));
			const neutral = authenticodeNeutral(bytes);
			assert.equal(peLayout(neutral).certificateTable, null);
			assert.equal(authenticodeStructureProblem(neutral), null, "without its signature the file is a plain image");
		});
	}
});
