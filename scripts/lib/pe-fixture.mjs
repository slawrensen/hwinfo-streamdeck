// Builds small, valid PE32+ images for tests of the PE reader
// (scripts/lib/pe.mjs), the drift classifier and the pack gate, so they run
// without a native build. The layout is the one the MSVC linker writes for
// the shipped addons, reduced: headers, a code section, an .rdata section
// holding the import table (with per-name hints) and the debug directory
// (CodeView, REPRO and EX_DLLCHARACTERISTICS records), any extra sections,
// and an optional certificate table after the last section. Test-only.
const FILE_ALIGNMENT = 0x200;
const SECTION_ALIGNMENT = 0x1000;
const OPTIONAL_HEADER_SIZE = 112 + 16 * 8;
const align = (value, to) => Math.ceil(value / to) * to;

/** A GUID's in-memory (little-endian) layout from its string form. */
function guidBytes(text) {
	const hex = text.replaceAll("-", "");
	const b = Buffer.from(hex, "hex");
	return Buffer.concat([Buffer.from(b.subarray(0, 4)).reverse(), Buffer.from(b.subarray(4, 6)).reverse(), Buffer.from(b.subarray(6, 8)).reverse(), b.subarray(8, 16)]);
}

/**
 * @param {object} [options]
 * @param {Buffer} [options.code]                    .text raw data
 * @param {Record<string, Record<string, number>>} [options.imports]  dll -> name -> hint
 * @param {string} [options.pdb]                      CodeView path
 * @param {string} [options.guid]                     CodeView GUID
 * @param {boolean} [options.repro]                   write a REPRO record
 * @param {boolean} [options.cet]                     EX_DLLCHARACTERISTICS CET bit
 * @param {number} [options.dllCharacteristics]
 * @param {number} [options.timestamp]
 * @param {number} [options.checksum]
 * @param {Array<{ name: string, data: Buffer }>} [options.extraSections]
 * @param {Buffer} [options.certificate]              WIN_CERTIFICATE payload appended 8-aligned
 * @param {Buffer} [options.overlay]                  bytes appended after everything else
 */
export function buildPe(options = {}) {
	const {
		code = Buffer.from("fixture code section"),
		imports = { "KERNEL32.dll": { CloseHandle: 137, OpenFileMappingW: 1084 } },
		pdb = "fixture.pdb",
		guid = "3044B6D5-904C-E7B5-7537-7C946EEDD599",
		repro = true,
		cet = true,
		dllCharacteristics = 0x0020 | 0x0040 | 0x0100 | 0x4000,
		timestamp = 0x28c8437f,
		checksum = 0,
		extraSections = [],
		certificate = null,
		overlay = null
	} = options;
	const sectionCount = 2 + extraSections.length;
	const sizeOfHeaders = align(0x40 + 4 + 20 + OPTIONAL_HEADER_SIZE + sectionCount * 40, FILE_ALIGNMENT);
	const textRva = SECTION_ALIGNMENT;
	const rdataRva = textRva + align(Math.max(code.length, 1), SECTION_ALIGNMENT);

	// .rdata: import descriptors, name tables, hint/name entries, DLL names,
	// then the debug directory and its records.
	const dlls = Object.entries(imports);
	let cursor = 0;
	const reserve = (length, alignment = 8) => {
		cursor = align(cursor, alignment);
		const at = cursor;
		cursor += length;
		return at;
	};
	const descriptorsAt = reserve((dlls.length + 1) * 20, 4);
	const tables = dlls.map(([, names]) => reserve((Object.keys(names).length + 1) * 8));
	const hintNames = dlls.map(([, names]) => Object.entries(names).map(([name, hint]) => ({ at: reserve(2 + name.length + 1, 2), name, hint })));
	const dllNames = dlls.map(([dll]) => ({ at: reserve(dll.length + 1, 1), dll }));
	const reproHash = Buffer.concat([guidBytes(guid), Buffer.alloc(16, 0x5a)]);
	const debugRecords = [
		{ type: 2, data: Buffer.concat([Buffer.from("RSDS"), guidBytes(guid), Buffer.from([1, 0, 0, 0]), Buffer.from(`${pdb}\0`, "utf8")]) },
		...(repro ? [{ type: 16, data: Buffer.concat([Buffer.from([reproHash.length, 0, 0, 0]), reproHash]) }] : []),
		{ type: 20, data: Buffer.from([cet ? 1 : 0, 0, 0, 0]) }
	];
	const debugAt = reserve(debugRecords.length * 28, 4);
	const debugData = debugRecords.map((record) => ({ ...record, at: reserve(record.data.length, 4) }));
	const rdata = Buffer.alloc(align(cursor, 16));
	dlls.forEach((_, i) => {
		const d = descriptorsAt + i * 20;
		rdata.writeUInt32LE(rdataRva + tables[i], d);
		rdata.writeUInt32LE(rdataRva + dllNames[i].at, d + 12);
		rdata.writeUInt32LE(rdataRva + tables[i], d + 16);
		hintNames[i].forEach(({ at, name, hint }, j) => {
			rdata.writeBigUInt64LE(BigInt(rdataRva + at), tables[i] + j * 8);
			rdata.writeUInt16LE(hint, at);
			rdata.write(name, at + 2, "latin1");
		});
		rdata.write(dllNames[i].dll, dllNames[i].at, "latin1");
	});

	const sections = [
		{ name: ".text", data: code, rva: textRva, characteristics: 0x60000020 },
		{ name: ".rdata", data: rdata, rva: rdataRva, characteristics: 0x40000040 }
	];
	let nextRva = rdataRva + align(rdata.length, SECTION_ALIGNMENT);
	for (const extra of extraSections) {
		sections.push({ name: extra.name, data: extra.data, rva: nextRva, characteristics: 0x40000040 });
		nextRva += align(Math.max(extra.data.length, 1), SECTION_ALIGNMENT);
	}
	let rawCursor = sizeOfHeaders;
	for (const section of sections) {
		section.rawPointer = rawCursor;
		section.rawSize = align(section.data.length, FILE_ALIGNMENT);
		rawCursor += section.rawSize;
	}
	const rdataSection = sections[1];
	// The debug directory entries point at their records by RVA and by file offset.
	debugRecords.forEach((record, i) => {
		const e = debugAt + i * 28;
		const data = debugData[i];
		rdata.writeUInt32LE(timestamp, e + 4);
		rdata.writeUInt32LE(record.type, e + 12);
		rdata.writeUInt32LE(record.data.length, e + 16);
		rdata.writeUInt32LE(rdataRva + data.at, e + 20);
		rdata.writeUInt32LE(rdataSection.rawPointer + data.at, e + 24);
		record.data.copy(rdata, data.at);
	});

	const imageEnd = rawCursor;
	const certOffset = certificate ? align(imageEnd, 8) : 0;
	const certLength = certificate ? 8 + certificate.length : 0;
	const total = certificate ? certOffset + align(certLength, 8) : imageEnd;
	const out = Buffer.alloc(total);
	out.write("MZ", 0, "latin1");
	out.writeUInt32LE(0x40, 0x3c);
	out.write("PE\0\0", 0x40, "latin1");
	const coff = 0x44;
	out.writeUInt16LE(0x8664, coff);
	out.writeUInt16LE(sections.length, coff + 2);
	out.writeUInt32LE(timestamp, coff + 4);
	out.writeUInt16LE(OPTIONAL_HEADER_SIZE, coff + 16);
	out.writeUInt16LE(0x2022, coff + 18);
	const opt = coff + 20;
	out.writeUInt16LE(0x20b, opt);
	out.writeUInt8(14, opt + 2);
	out.writeUInt8(51, opt + 3);
	out.writeUInt32LE(sections[0].rawSize, opt + 4);
	out.writeBigUInt64LE(0x180000000n, opt + 24);
	out.writeUInt32LE(SECTION_ALIGNMENT, opt + 32);
	out.writeUInt32LE(FILE_ALIGNMENT, opt + 36);
	out.writeUInt16LE(6, opt + 40);
	out.writeUInt16LE(6, opt + 48);
	out.writeUInt32LE(nextRva, opt + 56);
	out.writeUInt32LE(sizeOfHeaders, opt + 60);
	out.writeUInt32LE(checksum, opt + 64);
	out.writeUInt16LE(3, opt + 68);
	out.writeUInt16LE(dllCharacteristics, opt + 70);
	out.writeUInt32LE(16, opt + 108);
	const dirs = opt + 112;
	out.writeUInt32LE(rdataRva + descriptorsAt, dirs + 1 * 8);
	out.writeUInt32LE((dlls.length + 1) * 20, dirs + 1 * 8 + 4);
	if (certificate) {
		out.writeUInt32LE(certOffset, dirs + 4 * 8);
		out.writeUInt32LE(align(certLength, 8), dirs + 4 * 8 + 4);
	}
	out.writeUInt32LE(rdataRva + debugAt, dirs + 6 * 8);
	out.writeUInt32LE(debugRecords.length * 28, dirs + 6 * 8 + 4);
	sections.forEach((section, i) => {
		const h = opt + OPTIONAL_HEADER_SIZE + i * 40;
		out.write(section.name.padEnd(8, "\0").slice(0, 8), h, "latin1");
		out.writeUInt32LE(section.data.length, h + 8);
		out.writeUInt32LE(section.rva, h + 12);
		out.writeUInt32LE(section.rawSize, h + 16);
		out.writeUInt32LE(section.rawPointer, h + 20);
		out.writeUInt32LE(section.characteristics, h + 36);
		section.data.copy(out, section.rawPointer);
	});
	if (certificate) {
		out.writeUInt32LE(certLength, certOffset);
		out.writeUInt16LE(0x0200, certOffset + 4);
		out.writeUInt16LE(0x0002, certOffset + 6);
		certificate.copy(out, certOffset + 8);
	}
	return overlay ? Buffer.concat([out, overlay]) : out;
}

/** A String entry of a version resource's StringFileInfo, as rc.exe lays it out. */
export function versionStringEntry(key, value) {
	const keyBytes = Buffer.from(`${key}\0`, "utf16le");
	const valueText = `${value}\0`;
	const padded = align(6 + keyBytes.length, 4);
	const valueBytes = Buffer.from(valueText, "utf16le");
	const entry = Buffer.alloc(padded + valueBytes.length);
	entry.writeUInt16LE(entry.length, 0);
	entry.writeUInt16LE(valueText.length, 2);
	entry.writeUInt16LE(1, 4);
	keyBytes.copy(entry, 6);
	valueBytes.copy(entry, padded);
	return entry;
}

// A minimal DER encoder for synthetic Authenticode signatures: just the
// structure scripts/lib/authenticode.mjs reads (ContentInfo -> SignedData
// -> SPC_INDIRECT_DATA -> DigestInfo), no certificate and no signer, so a
// test can sign any PE "structurally" without a key. Windows reports such
// a file as signed but not valid, which is what a negative trust test
// needs.
const DIGEST_ALGORITHM_OIDS = Object.freeze({ sha1: "1.3.14.3.2.26", sha256: "2.16.840.1.101.3.4.2.1", sha384: "2.16.840.1.101.3.4.2.2", sha512: "2.16.840.1.101.3.4.2.3" });

function derLength(length) {
	if (length < 0x80) return Buffer.from([length]);
	const bytes = [];
	for (let value = length; value > 0; value = Math.floor(value / 256)) bytes.unshift(value & 0xff);
	return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/** One DER element: tag byte and the concatenated contents. */
export function der(tag, ...contents) {
	const body = Buffer.concat(contents);
	return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}

/** A DER OBJECT IDENTIFIER from its dotted form. */
export function derOid(dotted) {
	const [a, b, ...rest] = dotted.split(".").map(Number);
	const bytes = [40 * a + b];
	for (const part of rest) {
		const group = [part & 0x7f];
		for (let value = Math.floor(part / 128); value > 0; value = Math.floor(value / 128)) group.unshift(0x80 | (value & 0x7f));
		bytes.push(...group);
	}
	return der(0x06, Buffer.from(bytes));
}

/**
 * A PKCS#7 ContentInfo carrying an Authenticode SPC_INDIRECT_DATA content
 * that commits to `digestHex` under `algorithm`, with an empty signer set.
 * `contentOid` and `dataOid` replace the two OIDs for negative tests.
 */
export function authenticodeBlob(digestHex, { algorithm = "sha256", contentOid = "1.3.6.1.4.1.311.2.1.4", dataOid = "1.3.6.1.4.1.311.2.1.15" } = {}) {
	const algorithmId = der(0x30, derOid(DIGEST_ALGORITHM_OIDS[algorithm]), der(0x05));
	const peImageData = der(0x30, der(0x03, Buffer.from([0x00])), der(0xa0, der(0xa2, der(0x80))));
	const indirect = der(0x30, der(0x30, derOid(dataOid), peImageData), der(0x30, algorithmId, der(0x04, Buffer.from(digestHex, "hex"))));
	const signedData = der(0x30, der(0x02, Buffer.from([1])), der(0x31, algorithmId), der(0x30, derOid(contentOid), der(0xa0, indirect)), der(0x31));
	return der(0x30, derOid("1.2.840.113549.1.7.2"), der(0xa0, signedData));
}

/**
 * Signs `unsigned` the way signtool lays a signature out, with a synthetic
 * blob: zero pad to 8 bytes, a WIN_CERTIFICATE (revision 2.0, PKCS signed
 * data) holding the blob, directory 4 pointing at it, and a new CheckSum.
 * `digestHex` defaults to the digest the caller computes and passes in;
 * the fixture never computes one itself, so a digest bug cannot hide.
 */
export function fakeSign(unsigned, { digestHex, algorithm = "sha256", checksum = 0x0002a5c3, blob } = {}) {
	const lfanew = unsigned.readUInt32LE(0x3c);
	const opt = lfanew + 24;
	const dataDirs = unsigned.readUInt16LE(opt) === 0x20b ? opt + 112 : opt + 96;
	const payload = blob ?? authenticodeBlob(digestHex, { algorithm });
	const certOffset = align(unsigned.length, 8);
	const certLength = 8 + payload.length;
	const out = Buffer.alloc(certOffset + align(certLength, 8));
	unsigned.copy(out, 0);
	out.writeUInt32LE(checksum, opt + 64);
	out.writeUInt32LE(certOffset, dataDirs + 4 * 8);
	out.writeUInt32LE(align(certLength, 8), dataDirs + 4 * 8 + 4);
	out.writeUInt32LE(certLength, certOffset);
	out.writeUInt16LE(0x0200, certOffset + 4);
	out.writeUInt16LE(0x0002, certOffset + 6);
	payload.copy(out, certOffset + 8);
	return out;
}
