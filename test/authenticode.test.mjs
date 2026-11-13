// The Authenticode-neutral identity and the signature digest reader
// (scripts/lib/authenticode.mjs, scripts/authenticode-strip.mjs) over
// synthetic PE32+ images (scripts/lib/pe-fixture.mjs) and synthetic
// signatures: no native build, no certificate, no signtool, no network. The
// release proves "signed file = reproduced unsigned build + signature" with
// these functions, so every way a file could carry more than that is a
// refusal here. The real-signature check against signed executables on the
// machine lives in test/native-manifest.test.ts (test:native).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { authenticodeImageDigest, authenticodeNeutral, authenticodeStructureProblem, compareSignedToUnsigned, listCertificates, neutralSha256, peLayout, signedDigest } from "../scripts/lib/authenticode.mjs";
import { authenticodeBlob, buildPe, fakeSign } from "../scripts/lib/pe-fixture.mjs";
import { run } from "../scripts/authenticode-strip.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// buildPe's fixed layout: e_lfanew 0x40, so the optional header starts at
// 0x58, CheckSum at 0x98 and data directory 4 at 0xe8; the sections follow
// the headers contiguously to the end of the file.
const CHECKSUM = 0x98;
const CERT_DIR = 0xe8;
/** The image digest written out by hand from the specification, for an
 * unsigned buildPe image: everything except CheckSum and directory 4. */
const handDigest = (unsigned, algorithm = "sha256") => createHash(algorithm).update(unsigned.subarray(0, CHECKSUM)).update(unsigned.subarray(CHECKSUM + 4, CERT_DIR)).update(unsigned.subarray(CERT_DIR + 8)).digest("hex");
const signedCopy = (unsigned, options = {}) => fakeSign(unsigned, { digestHex: handDigest(unsigned, options.algorithm), ...options });

describe("authenticode: layout", () => {
	it("finds CheckSum, directory 4, the image end and no certificate table in an unsigned image", () => {
		const unsigned = buildPe();
		const layout = peLayout(unsigned);
		assert.equal(layout.checksumOffset, CHECKSUM);
		assert.equal(layout.certDirOffset, CERT_DIR);
		assert.equal(layout.imageEnd, unsigned.length);
		assert.equal(layout.certificateTable, null);
		assert.deepEqual(listCertificates(unsigned), []);
		assert.equal(authenticodeStructureProblem(unsigned), null);
	});

	it("walks the WIN_CERTIFICATE entries of a signed copy", () => {
		const unsigned = buildPe();
		const signed = signedCopy(unsigned);
		assert.deepEqual(peLayout(signed).certificateTable, { offset: unsigned.length, size: signed.length - unsigned.length });
		const [entry, ...more] = listCertificates(signed);
		assert.deepEqual(more, []);
		assert.equal(entry.offset, unsigned.length);
		assert.equal(entry.revision, 0x0200);
		assert.equal(entry.type, 0x0002);
	});
});

describe("authenticode: the neutral form", () => {
	it("of a signed copy is the unsigned build, byte for byte", () => {
		const unsigned = buildPe({ code: Buffer.from("release code") });
		const signed = signedCopy(unsigned);
		assert.notEqual(signed.readUInt32LE(CHECKSUM), 0, "the signed copy carries a new CheckSum, or the test proves nothing");
		assert.ok(authenticodeNeutral(signed).equals(unsigned));
		assert.equal(neutralSha256(signed), sha256(unsigned));
	});

	it("is idempotent and leaves a checksum-free unsigned image as it is", () => {
		const unsigned = buildPe();
		assert.ok(authenticodeNeutral(unsigned).equals(unsigned));
		const signed = signedCopy(unsigned);
		assert.ok(authenticodeNeutral(authenticodeNeutral(signed)).equals(authenticodeNeutral(signed)));
	});

	it("zeroes a linker-written CheckSum, so neutral-to-neutral is the comparison", () => {
		const withChecksum = buildPe({ checksum: 0x1234 });
		assert.equal(neutralSha256(withChecksum), sha256(buildPe()));
		assert.notEqual(sha256(withChecksum), sha256(buildPe()));
	});

	it("removes the alignment pad signing adds after an image that does not end on 8 bytes", () => {
		// Shorten the last section by 4 bytes: the image now ends 4 bytes
		// before an 8-byte boundary, and signing pads it with 4 zeros (a
		// real signed git.exe has exactly this layout).
		const full = buildPe();
		const unsigned = Buffer.from(full.subarray(0, full.length - 4));
		const lastSection = 0x58 + 240 + 40;
		unsigned.writeUInt32LE(unsigned.readUInt32LE(lastSection + 16) - 4, lastSection + 16);
		assert.equal(unsigned.length % 8, 4);
		const padded = Buffer.concat([unsigned, Buffer.alloc(4)]);
		const signed = fakeSign(unsigned, { digestHex: authenticodeImageDigest(padded) });
		assert.equal(peLayout(signed).certificateTable.offset, unsigned.length + 4);
		assert.ok(authenticodeNeutral(signed).equals(unsigned));
		assert.deepEqual(compareSignedToUnsigned(signed, unsigned).problems, [], "the digest is taken over the pad, as signtool takes it");
	});
});

describe("authenticode: refusals", () => {
	const unsigned = buildPe();
	const signed = signedCopy(unsigned);
	const withDir = (bytes, offset, size) => {
		const copy = Buffer.from(bytes);
		copy.writeUInt32LE(offset, CERT_DIR);
		copy.writeUInt32LE(size, CERT_DIR + 4);
		return copy;
	};
	const cases = [
		["data after the certificate table", Buffer.concat([signed, Buffer.alloc(8)]), /8 bytes follow the certificate table; it must end the file/],
		["bytes after an unsigned image", Buffer.concat([unsigned, Buffer.from("tail")]), /4 bytes follow the last section and there is no certificate table/],
		["a misaligned table", withDir(Buffer.concat([unsigned, Buffer.alloc(4), signed.subarray(unsigned.length)]), unsigned.length + 4, signed.length - unsigned.length), /not 8-byte aligned/],
		["a table inside the image", withDir(signed, unsigned.length - 512, signed.length - unsigned.length + 512), /inside the image/],
		["a pad of 8 bytes or more", (() => { const b = withDir(Buffer.concat([unsigned, Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), signed.subarray(unsigned.length)]), unsigned.length + 8, signed.length - unsigned.length); return b; })(), /8 bytes sit between the last section and the certificate table/],
		["a table that runs past the file", withDir(signed, unsigned.length, signed.length - unsigned.length + 8), /certificate table lies outside the file/],
		["an offset with no size", withDir(unsigned, unsigned.length, 0), /names an offset but no size/],
		["a WIN_CERTIFICATE longer than the table", (() => { const b = Buffer.from(signed); b.writeUInt32LE(signed.length, unsigned.length); return b; })(), /claims \d+ bytes, which do not fit/],
		["a WIN_CERTIFICATE shorter than its header", (() => { const b = Buffer.from(signed); b.writeUInt32LE(4, unsigned.length); return b; })(), /claims 4 bytes/],
		["not a PE image", Buffer.from("plain text, not a module"), /no MZ header/]
	];
	for (const [name, bytes, expected] of cases) {
		it(`refuses ${name}`, () => {
			assert.match(authenticodeStructureProblem(bytes) ?? "", expected);
			assert.throws(() => authenticodeNeutral(bytes), expected);
		});
	}

	it("refuses a nonzero byte inside a short pad", () => {
		const full = buildPe();
		const unsignedShort = Buffer.from(full.subarray(0, full.length - 4));
		const lastSection = 0x58 + 240 + 40;
		unsignedShort.writeUInt32LE(unsignedShort.readUInt32LE(lastSection + 16) - 4, lastSection + 16);
		const shortSigned = fakeSign(unsignedShort, { digestHex: "00".repeat(32) });
		shortSigned[unsignedShort.length + 1] = 0x7f;
		assert.match(authenticodeStructureProblem(shortSigned) ?? "", /alignment pad before the certificate table is not zero/);
	});
});

describe("authenticode: the image digest", () => {
	it("is the specification's digest and does not change when a signature is added", () => {
		const unsigned = buildPe({ code: Buffer.from("digest me") });
		assert.equal(authenticodeImageDigest(unsigned), handDigest(unsigned));
		assert.equal(authenticodeImageDigest(signedCopy(unsigned)), handDigest(unsigned));
		assert.equal(authenticodeImageDigest(unsigned, "sha384"), handDigest(unsigned, "sha384"));
	});

	it("moves with a section byte and with a header byte outside the two signing fields", () => {
		const unsigned = buildPe();
		const sectionByte = Buffer.from(unsigned);
		sectionByte[sectionByte.length - 1] ^= 0x01;
		const headerByte = Buffer.from(unsigned);
		headerByte[0x58 + 70] ^= 0x01;
		assert.notEqual(authenticodeImageDigest(sectionByte), authenticodeImageDigest(unsigned));
		assert.notEqual(authenticodeImageDigest(headerByte), authenticodeImageDigest(unsigned));
	});
});

describe("authenticode: the digest a signature commits to", () => {
	it("reads the SPC_INDIRECT_DATA digest and its algorithm", () => {
		const unsigned = buildPe();
		for (const algorithm of ["sha256", "sha384", "sha512", "sha1"]) {
			const digest = signedDigest(signedCopy(unsigned, { algorithm }));
			assert.equal(digest.algorithm, algorithm);
			assert.equal(digest.hex, handDigest(unsigned, algorithm));
			assert.equal(digest.certificate.offset, unsigned.length);
		}
		assert.equal(signedDigest(unsigned), null);
	});

	it("refuses a signature that is not an Authenticode PE signature", () => {
		const unsigned = buildPe();
		const digest = handDigest(unsigned);
		assert.throws(() => signedDigest(fakeSign(unsigned, { blob: authenticodeBlob(digest, { contentOid: "1.2.840.113549.1.7.1" }) })), /not SPC_INDIRECT_DATA/);
		assert.throws(() => signedDigest(fakeSign(unsigned, { blob: authenticodeBlob(digest, { dataOid: "1.3.6.1.4.1.311.2.1.25" }) })), /does not describe a PE image/);
		assert.throws(() => signedDigest(fakeSign(unsigned, { blob: Buffer.from([0x30, 0x03, 0x06, 0x01, 0x2a]) })), /not PKCS#7 signed data|lacks/);
		assert.throws(() => signedDigest(fakeSign(unsigned, { blob: Buffer.from([0x30, 0x84, 0xff, 0xff, 0xff, 0xff]) })), /runs past/);
	});
});

describe("authenticode: signed file against the unsigned build", () => {
	const unsigned = buildPe({ code: Buffer.from("the reproduced build") });

	it("passes a copy that differs only by its signature", () => {
		const signed = signedCopy(unsigned);
		const { problems, facts } = compareSignedToUnsigned(signed, unsigned);
		assert.deepEqual(problems, []);
		assert.equal(facts.unsignedSha256, sha256(unsigned));
		assert.equal(facts.signedSha256, sha256(signed));
		assert.equal(facts.neutralSha256, sha256(unsigned));
		assert.equal(facts.signedDigest, facts.imageDigest);
		assert.equal(facts.digestAlgorithm, "sha256");
		assert.deepEqual(facts.certificateTable, { offset: unsigned.length, size: signed.length - unsigned.length });
	});

	it("fails when the signed bytes carry any other change", () => {
		const tampered = signedCopy(unsigned);
		tampered[0x200] ^= 0x01;
		const problems = compareSignedToUnsigned(tampered, unsigned).problems;
		assert.ok(problems.some((p) => /is not the unsigned build/.test(p)), problems.join("\n"));
		assert.ok(problems.some((p) => /the file's image digest is/.test(p)), problems.join("\n"));
	});

	it("fails when the signature commits to another image", () => {
		const other = fakeSign(unsigned, { digestHex: handDigest(buildPe({ code: Buffer.from("another build") })) });
		assert.ok(compareSignedToUnsigned(other, unsigned).problems.some((p) => /the signature commits to/.test(p)));
	});

	it("fails on an unsigned 'signed' file and on an 'unsigned' build that is already signed", () => {
		assert.ok(compareSignedToUnsigned(unsigned, unsigned).problems.some((p) => /carries no certificate table/.test(p)));
		const signed = signedCopy(unsigned);
		assert.ok(compareSignedToUnsigned(signed, signed).problems.some((p) => /already carries a certificate table/.test(p)));
	});
});

describe("authenticode-strip command", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authenticode-strip-"));
	after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const unsigned = buildPe({ code: Buffer.from("command line build") });
	const signed = signedCopy(unsigned);
	const unsignedPath = path.join(dir, "unsigned.node");
	const signedPath = path.join(dir, "signed.node");
	fs.writeFileSync(unsignedPath, unsigned);
	fs.writeFileSync(signedPath, signed);

	it("prints the neutral hash and writes the neutral bytes", () => {
		const out = path.join(dir, "neutral.node");
		const result = run(["neutral", signedPath, "--out", out]);
		assert.equal(result.code, 0, result.err.join("\n"));
		assert.match(result.out[0], new RegExp(`^${sha256(unsigned)}  signed\\.node`));
		assert.ok(fs.readFileSync(out).equals(unsigned));
	});

	it("compares a signed file with its unsigned build", () => {
		assert.equal(run(["compare", signedPath, unsignedPath]).code, 0);
		const tamperedPath = path.join(dir, "tampered.node");
		const tampered = Buffer.from(signed);
		tampered[0x210] ^= 0x01;
		fs.writeFileSync(tamperedPath, tampered);
		const result = run(["compare", tamperedPath, unsignedPath]);
		assert.equal(result.code, 1);
		assert.match(result.err.join("\n"), /is not unsigned\.node plus a signature/);
	});

	it("checks a file against EXPECT_SHA from the environment only", () => {
		assert.equal(run(["expect", unsignedPath], { EXPECT_SHA: sha256(unsigned) }).code, 0);
		assert.equal(run(["expect", unsignedPath], { EXPECT_SHA: sha256(signed) }).code, 1);
		for (const bad of [undefined, "", sha256(unsigned).toUpperCase(), `${sha256(unsigned)}\n`, "$(whoami)"]) {
			const result = run(["expect", unsignedPath], { EXPECT_SHA: bad });
			assert.equal(result.code, 1, JSON.stringify(bad));
		}
	});

	it("refuses unknown commands, missing files and a file that is not a PE image", () => {
		assert.equal(run(["strip", signedPath]).code, 2);
		assert.equal(run(["neutral"]).code, 2);
		assert.match(run(["neutral", path.join(dir, "absent.node")]).err.join("\n"), /not found/);
		const text = path.join(dir, "text.node");
		fs.writeFileSync(text, "not a module");
		assert.match(run(["neutral", text]).err.join("\n"), /no MZ header/);
	});
});
