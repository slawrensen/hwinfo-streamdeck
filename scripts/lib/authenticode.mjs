// Authenticode facts of a PE file, read from its bytes alone: no signtool,
// no certificate store, no network. Pure, builtins only, so the packaging
// gates can run it before `npm ci` and on any OS.
//
// Signing a PE changes exactly three things: the optional header's CheckSum,
// the Certificate Table data directory (index 4, which holds a FILE OFFSET
// and size, not an RVA), and a WIN_CERTIFICATE table appended at an 8-byte
// aligned offset after the image. So the neutral form of a file (CheckSum
// zeroed, directory 4 zeroed, the certificate table and its alignment pad
// cut off) is the same bytes before and after signing, and comparing the
// neutral hash of the signed file with the neutral hash of the reproduced
// unsigned build proves the signature added nothing else.
//
// The Authenticode image digest is the hash a signature commits to (the PE
// headers minus CheckSum and directory 4, then each section's raw data in
// file order, then any bytes after the sections minus the certificate
// table); signedDigest() reads the digest the embedded PKCS#7 SignedData
// carries in its SPC_INDIRECT_DATA content, so the two can be compared
// without trusting the tool that signed. Whether the signer is trusted is a
// separate question that only Windows answers (scripts/lib/authenticode-windows.mjs).
import { createHash } from "node:crypto";

const DIR_SECURITY = 4;
const WIN_CERT_REVISION_2_0 = 0x0200;
const WIN_CERT_TYPE_PKCS_SIGNED_DATA = 0x0002;
const OID_SIGNED_DATA = "1.2.840.113549.1.7.2";
const OID_SPC_INDIRECT_DATA = "1.3.6.1.4.1.311.2.1.4";
const OID_SPC_PE_IMAGE_DATA = "1.3.6.1.4.1.311.2.1.15";
const DIGEST_OIDS = Object.freeze({
	"1.3.14.3.2.26": "sha1",
	"2.16.840.1.101.3.4.2.1": "sha256",
	"2.16.840.1.101.3.4.2.2": "sha384",
	"2.16.840.1.101.3.4.2.3": "sha512"
});
/** No signature carries more entries than this; a walk past it is a malformed table. */
const MAX_CERTIFICATES = 64;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const align8 = (value) => Math.ceil(value / 8) * 8;

/**
 * The offsets Authenticode cares about: the CheckSum field, data directory
 * 4, SizeOfHeaders, the sections (with raw data) in file order, where the
 * image ends, and the certificate table (null when the directory is
 * empty). PE32 and PE32+ both; throws one sentence on a file that is not a
 * PE image or whose headers do not fit in it.
 */
export function peLayout(buf) {
	if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) throw new Error("not a PE image (no MZ header)");
	const lfanew = buf.readUInt32LE(0x3c);
	if (lfanew + 24 > buf.length || buf.readUInt32LE(lfanew) !== 0x00004550) throw new Error("not a PE image");
	const coff = lfanew + 4;
	const numberOfSections = buf.readUInt16LE(coff + 2);
	const sizeOfOptionalHeader = buf.readUInt16LE(coff + 16);
	const opt = coff + 20;
	if (opt + 2 > buf.length) throw new Error("PE headers run past the end of the file");
	const magic = buf.readUInt16LE(opt);
	const dataDirs = magic === 0x20b ? opt + 112 : magic === 0x10b ? opt + 96 : -1;
	if (dataDirs < 0) throw new Error(`unexpected optional-header magic 0x${magic.toString(16)}`);
	const sectionTable = opt + sizeOfOptionalHeader;
	if (dataDirs + (DIR_SECURITY + 1) * 8 > sectionTable || sectionTable + numberOfSections * 40 > buf.length) throw new Error("PE headers run past the end of the file");
	const numberOfDirs = buf.readUInt32LE(dataDirs - 4);
	if (numberOfDirs <= DIR_SECURITY) throw new Error("the optional header has no certificate table directory");
	const sizeOfHeaders = buf.readUInt32LE(opt + 60);
	if (sizeOfHeaders > buf.length || sizeOfHeaders < sectionTable + numberOfSections * 40) throw new Error("SizeOfHeaders does not cover the headers");
	const sections = [];
	for (let i = 0, sec = sectionTable; i < numberOfSections; i++, sec += 40) {
		const rawSize = buf.readUInt32LE(sec + 16);
		const rawPointer = buf.readUInt32LE(sec + 20);
		if (rawSize === 0) continue;
		if (rawPointer + rawSize > buf.length) throw new Error(`section ${buf.toString("latin1", sec, sec + 8).replace(/\0+$/, "")} raw data lies outside the file`);
		sections.push({ name: buf.toString("latin1", sec, sec + 8).replace(/\0+$/, ""), rawPointer, rawSize });
	}
	sections.sort((a, b) => a.rawPointer - b.rawPointer);
	const imageEnd = sections.reduce((end, s) => Math.max(end, s.rawPointer + s.rawSize), sizeOfHeaders);
	const certDirOffset = dataDirs + DIR_SECURITY * 8;
	const certOffset = buf.readUInt32LE(certDirOffset);
	const certSize = buf.readUInt32LE(certDirOffset + 4);
	let certificateTable = null;
	if (certOffset !== 0 || certSize !== 0) {
		if (certOffset + certSize > buf.length) throw new Error("the certificate table lies outside the file");
		certificateTable = { offset: certOffset, size: certSize };
	}
	return { checksumOffset: opt + 64, certDirOffset, sizeOfHeaders, sections, imageEnd, certificateTable };
}

/** The WIN_CERTIFICATE entries of the certificate table, each at an 8-byte
 * aligned offset: { offset, length, revision, type }. Empty when unsigned. */
export function listCertificates(buf, layout = peLayout(buf)) {
	const table = layout.certificateTable;
	if (table === null) return [];
	const end = table.offset + table.size;
	const out = [];
	for (let at = table.offset; at < end; ) {
		if (out.length >= MAX_CERTIFICATES) throw new Error("the certificate table never ends");
		if (at + 8 > end) throw new Error(`a WIN_CERTIFICATE header at ${at} runs past the end of the certificate table`);
		const length = buf.readUInt32LE(at);
		if (length < 8 || at + length > end) throw new Error(`the WIN_CERTIFICATE at ${at} claims ${length} bytes, which do not fit the certificate table`);
		out.push({ offset: at, length, revision: buf.readUInt16LE(at + 4), type: buf.readUInt16LE(at + 6) });
		at = align8(at + length);
	}
	return out;
}

/**
 * Why this file's signature layout is not the one signing produces, or
 * null: the certificate table must start 8-byte aligned at or after the end
 * of the image, end the file, be preceded only by fewer than 8 zero bytes
 * of alignment pad, and hold well-formed WIN_CERTIFICATE entries. An
 * unsigned file must end with its last section.
 */
export function authenticodeStructureProblem(buf) {
	let layout;
	try {
		layout = peLayout(buf);
	} catch (err) {
		return err.message;
	}
	const table = layout.certificateTable;
	if (table === null) return buf.length > layout.imageEnd ? `${buf.length - layout.imageEnd} bytes follow the last section and there is no certificate table` : null;
	if (table.size === 0) return "the certificate table directory names an offset but no size";
	if (table.offset % 8 !== 0) return `the certificate table starts at ${table.offset}, which is not 8-byte aligned`;
	if (table.offset < layout.imageEnd) return `the certificate table starts at ${table.offset}, inside the image (which ends at ${layout.imageEnd})`;
	if (table.offset + table.size !== buf.length) return `${buf.length - (table.offset + table.size)} bytes follow the certificate table; it must end the file`;
	const pad = table.offset - layout.imageEnd;
	if (pad >= 8) return `${pad} bytes sit between the last section and the certificate table; signing adds fewer than 8 bytes of alignment pad`;
	if (buf.subarray(layout.imageEnd, table.offset).some((byte) => byte !== 0)) return "the alignment pad before the certificate table is not zero";
	try {
		if (listCertificates(buf, layout).length === 0) return "the certificate table holds no WIN_CERTIFICATE";
	} catch (err) {
		return err.message;
	}
	return null;
}

/**
 * The neutral form: a copy with CheckSum and directory 4 zeroed and the
 * certificate table and its alignment pad removed. For an unsigned file it
 * is the file with CheckSum zeroed. Throws on a layout signing would not
 * produce (see authenticodeStructureProblem).
 */
export function authenticodeNeutral(buf) {
	const problem = authenticodeStructureProblem(buf);
	if (problem !== null) throw new Error(problem);
	const layout = peLayout(buf);
	const out = Buffer.from(buf.subarray(0, layout.imageEnd));
	out.fill(0, layout.checksumOffset, layout.checksumOffset + 4);
	out.fill(0, layout.certDirOffset, layout.certDirOffset + 8);
	return out;
}

/** SHA-256 of the neutral form (hex). */
export function neutralSha256(buf) {
	return sha256(authenticodeNeutral(buf));
}

/**
 * The Authenticode image digest (hex) under `algorithm`: what a signature
 * of this file commits to, computed the way the PE Authenticode format
 * specifies. Signing leaves it unchanged, so the unsigned build and its
 * signed copy share it.
 */
export function authenticodeImageDigest(buf, algorithm = "sha256") {
	const layout = peLayout(buf);
	const hash = createHash(algorithm);
	hash.update(buf.subarray(0, layout.checksumOffset));
	hash.update(buf.subarray(layout.checksumOffset + 4, layout.certDirOffset));
	hash.update(buf.subarray(layout.certDirOffset + 8, layout.sizeOfHeaders));
	let hashed = layout.sizeOfHeaders;
	for (const section of layout.sections) {
		hash.update(buf.subarray(section.rawPointer, section.rawPointer + section.rawSize));
		hashed += section.rawSize;
	}
	const certSize = layout.certificateTable?.size ?? 0;
	const extra = buf.length - certSize - hashed;
	if (extra > 0) hash.update(buf.subarray(hashed, hashed + extra));
	return hash.digest("hex");
}

/** One DER (or BER indefinite-length) element: tag, content bounds, end. */
function readElement(buf, at, limit) {
	if (at + 2 > limit) throw new Error("the signature's DER runs past its end");
	const tag = buf[at];
	if ((tag & 0x1f) === 0x1f) throw new Error("the signature uses a multi-byte DER tag");
	let length = buf[at + 1];
	let start = at + 2;
	if (length === 0x80) {
		if ((tag & 0x20) === 0) throw new Error("the signature gives a primitive element an indefinite length");
		let child = start;
		while (true) {
			if (child + 2 > limit) throw new Error("an indefinite-length element in the signature never ends");
			if (buf[child] === 0 && buf[child + 1] === 0) return { tag, start, end: child, next: child + 2 };
			child = readElement(buf, child, limit).next;
		}
	}
	if (length & 0x80) {
		const bytes = length & 0x7f;
		if (bytes === 0 || bytes > 4 || start + bytes > limit) throw new Error("the signature has a DER length it cannot hold");
		length = 0;
		for (let i = 0; i < bytes; i++) length = length * 256 + buf[start + i];
		start += bytes;
	}
	if (start + length > limit) throw new Error("a DER element of the signature runs past its parent");
	return { tag, start, end: start + length, next: start + length };
}

/** The child elements of a constructed element. */
function childrenOf(buf, element) {
	const out = [];
	for (let at = element.start; at < element.end; ) {
		const child = readElement(buf, at, element.end);
		out.push(child);
		at = child.next;
	}
	return out;
}

function oidOf(buf, element) {
	if (element.tag !== 0x06) throw new Error("the signature has no object identifier where one belongs");
	const bytes = buf.subarray(element.start, element.end);
	if (bytes.length === 0) throw new Error("the signature has an empty object identifier");
	const parts = [];
	let value = 0;
	for (const byte of bytes) {
		value = value * 128 + (byte & 0x7f);
		if ((byte & 0x80) === 0) {
			if (parts.length === 0) parts.push(value < 80 ? Math.floor(value / 40) : 2, value < 80 ? value % 40 : value - 80);
			else parts.push(value);
			value = 0;
		}
	}
	return parts.join(".");
}

function expect(element, tag, what) {
	if (element === undefined || element.tag !== tag) throw new Error(`the signature lacks ${what}`);
	return element;
}

/**
 * The digest the primary embedded signature commits to: { algorithm, hex,
 * certificate: { offset, length } } from the first PKCS_SIGNED_DATA
 * WIN_CERTIFICATE, or null for an unsigned file. Walks ContentInfo ->
 * SignedData -> encapContentInfo (SPC_INDIRECT_DATA) -> DigestInfo. Throws
 * one sentence on a signature it cannot read; it never checks the
 * signature's cryptography or trust.
 */
export function signedDigest(buf) {
	const layout = peLayout(buf);
	const certificate = listCertificates(buf, layout).find((entry) => entry.revision === WIN_CERT_REVISION_2_0 && entry.type === WIN_CERT_TYPE_PKCS_SIGNED_DATA);
	if (certificate === undefined) {
		if (layout.certificateTable !== null) throw new Error("the certificate table holds no PKCS#7 signed data (revision 2.0, type 2)");
		return null;
	}
	const limit = certificate.offset + certificate.length;
	const contentInfo = expect(readElement(buf, certificate.offset + 8, limit), 0x30, "a ContentInfo sequence");
	const [contentType, explicitContent] = childrenOf(buf, contentInfo);
	if (oidOf(buf, expect(contentType, 0x06, "a content type")) !== OID_SIGNED_DATA) throw new Error("the signature is not PKCS#7 signed data");
	const [signedData] = childrenOf(buf, expect(explicitContent, 0xa0, "its signed data"));
	const signedFields = childrenOf(buf, expect(signedData, 0x30, "a SignedData sequence"));
	const encap = expect(signedFields[2], 0x30, "an encapsulated content");
	const [encapType, encapExplicit] = childrenOf(buf, encap);
	if (oidOf(buf, expect(encapType, 0x06, "an encapsulated content type")) !== OID_SPC_INDIRECT_DATA) throw new Error("the signature's content is not SPC_INDIRECT_DATA (not an Authenticode signature)");
	const [indirect] = childrenOf(buf, expect(encapExplicit, 0xa0, "its SPC_INDIRECT_DATA content"));
	const [data, digestInfo] = childrenOf(buf, expect(indirect, 0x30, "an SpcIndirectDataContent sequence"));
	const [dataType] = childrenOf(buf, expect(data, 0x30, "an SpcAttributeTypeAndOptionalValue"));
	if (oidOf(buf, expect(dataType, 0x06, "a data type")) !== OID_SPC_PE_IMAGE_DATA) throw new Error("the signature does not describe a PE image (SPC_PE_IMAGE_DATA)");
	const [algorithmId, digest] = childrenOf(buf, expect(digestInfo, 0x30, "a DigestInfo"));
	const [algorithmOid] = childrenOf(buf, expect(algorithmId, 0x30, "a digest algorithm"));
	const oid = oidOf(buf, expect(algorithmOid, 0x06, "a digest algorithm identifier"));
	const algorithm = DIGEST_OIDS[oid];
	if (algorithm === undefined) throw new Error(`the signature uses digest algorithm ${oid}, which this check does not know`);
	const value = expect(digest, 0x04, "a digest");
	return { algorithm, hex: buf.toString("hex", value.start, value.end), certificate: { offset: certificate.offset, length: certificate.length } };
}

/**
 * Holds a signed file to the unsigned build it was made from. Returns
 * { problems, facts }: problems is empty when the signed file has a
 * signing-shaped certificate table, its neutral form equals the unsigned
 * build's, the unsigned build carries no certificate table, and the digest
 * the signature commits to equals the Authenticode image digest of both
 * files. Never throws on file content.
 */
export function compareSignedToUnsigned(signed, unsigned) {
	const problems = [];
	const facts = { signedSha256: sha256(signed), signedBytes: signed.length, unsignedSha256: sha256(unsigned), unsignedBytes: unsigned.length, neutralSha256: null, digestAlgorithm: null, signedDigest: null, imageDigest: null, certificateTable: null };
	const unsignedProblem = authenticodeStructureProblem(unsigned);
	if (unsignedProblem !== null) problems.push(`the unsigned build: ${unsignedProblem}`);
	else if (peLayout(unsigned).certificateTable !== null) problems.push("the unsigned build already carries a certificate table");
	const signedProblem = authenticodeStructureProblem(signed);
	if (signedProblem !== null) problems.push(`the signed file: ${signedProblem}`);
	else if (peLayout(signed).certificateTable === null) problems.push("the signed file carries no certificate table");
	if (problems.length > 0) return { problems, facts };
	facts.certificateTable = peLayout(signed).certificateTable;
	const neutralSigned = neutralSha256(signed);
	const neutralUnsigned = neutralSha256(unsigned);
	facts.neutralSha256 = neutralSigned;
	if (neutralSigned !== neutralUnsigned) problems.push(`the signed file without its signature (${neutralSigned.slice(0, 12)}) is not the unsigned build (${neutralUnsigned.slice(0, 12)}): signing changed more than the checksum, the certificate directory and the appended table`);
	let embedded = null;
	try {
		embedded = signedDigest(signed);
	} catch (err) {
		problems.push(`the signature cannot be read: ${err.message}`);
	}
	if (embedded !== null) {
		facts.digestAlgorithm = embedded.algorithm;
		facts.signedDigest = embedded.hex;
		facts.imageDigest = authenticodeImageDigest(signed, embedded.algorithm);
		if (embedded.hex !== facts.imageDigest) problems.push(`the signature commits to ${embedded.algorithm} ${embedded.hex.slice(0, 12)}, the file's image digest is ${facts.imageDigest.slice(0, 12)}`);
		// Signing pads a file whose length is not a multiple of 8 before it
		// hashes it; the digest of the unsigned build is taken over the same
		// zero pad (linker output is FileAlignment-sized, so this is 0).
		const pad = facts.certificateTable.offset - peLayout(signed).imageEnd;
		const unsignedDigest = authenticodeImageDigest(pad > 0 ? Buffer.concat([unsigned, Buffer.alloc(pad)]) : unsigned, embedded.algorithm);
		if (embedded.hex !== unsignedDigest) problems.push(`the signature commits to ${embedded.hex.slice(0, 12)}, the unsigned build's image digest is ${unsignedDigest.slice(0, 12)}`);
	}
	return { problems, facts };
}
