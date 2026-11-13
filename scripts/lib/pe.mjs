// Self-contained PE32+ reader for the shipped native binaries (no dumpbin
// dependency): what scripts/native-manifest.mjs records as release evidence
// and what scripts/native-drift.mjs compares when bytes move. Pure, builtins
// only. Every offset the headers hand out is checked against the file
// before it is read, so a truncated or foreign file ends with one sentence,
// not a Buffer range error deep in the walk.
import { createHash } from "node:crypto";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const IMAGE_DEBUG_TYPE_CODEVIEW = 2;
const IMAGE_DEBUG_TYPE_REPRO = 16;
const IMAGE_DEBUG_TYPE_EX_DLLCHARACTERISTICS = 20;
const DIR_IMPORT = 1;
const DIR_SECURITY = 4;
const DIR_DEBUG = 6;
const DIR_DELAY_IMPORT = 13;
/** No shipped binary comes near this; a walk past it is a malformed file. */
const MAX_TABLE_ENTRIES = 65536;

/** Formats a GUID stored in its little-endian in-memory layout. */
function guidString(bytes) {
	const hex = (b) => b.toString("hex").toUpperCase();
	const le = (start, length) => hex(Buffer.from(bytes.subarray(start, start + length)).reverse());
	return `${le(0, 4)}-${le(4, 2)}-${le(6, 2)}-${hex(bytes.subarray(8, 10))}-${hex(bytes.subarray(10, 16))}`;
}

/**
 * Parses a PE32+ image. Returns the facts the release record carries:
 * machine, linker version, import and delay-import DLL names and their
 * per-name hints, hardening flags, COFF timestamp, PE checksum, the
 * certificate table, bytes outside the image and the certificate table,
 * section raw-data hashes, a header hash with the checksum and the
 * certificate directory zeroed (the two fields Authenticode signing
 * rewrites), and the CodeView and REPRO debug records.
 */
export function parsePe(buf) {
	const need = (offset, length, what) => {
		if (!Number.isInteger(offset) || offset < 0 || offset + length > buf.length) throw new Error(`${what} lies outside the file`);
	};
	const u16 = (offset, what) => { need(offset, 2, what); return buf.readUInt16LE(offset); };
	const u32 = (offset, what) => { need(offset, 4, what); return buf.readUInt32LE(offset); };
	const u64 = (offset, what) => { need(offset, 8, what); return buf.readBigUInt64LE(offset); };

	if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) throw new Error("not a PE image (no MZ header)");
	const lfanew = buf.readUInt32LE(0x3c);
	if (lfanew + 24 > buf.length || buf.readUInt32LE(lfanew) !== 0x00004550) throw new Error("not a PE image");
	const coff = lfanew + 4;
	const machine = buf.readUInt16LE(coff);
	const numberOfSections = buf.readUInt16LE(coff + 2);
	const coffTimestamp = buf.readUInt32LE(coff + 4);
	const sizeOfOptionalHeader = buf.readUInt16LE(coff + 16);
	const opt = coff + 20;
	if (sizeOfOptionalHeader < 112 + 14 * 8 || opt + sizeOfOptionalHeader + numberOfSections * 40 > buf.length) throw new Error("PE headers run past the end of the file");
	const magic = buf.readUInt16LE(opt);
	if (magic !== 0x20b) throw new Error(`unexpected optional-header magic 0x${magic.toString(16)} (not PE32+)`);
	const linkerVersion = `${buf.readUInt8(opt + 2)}.${buf.readUInt8(opt + 3)}`;
	const sizeOfHeaders = buf.readUInt32LE(opt + 60);
	const checksumOffset = opt + 64;
	const peChecksum = buf.readUInt32LE(checksumOffset);
	const dllCharacteristics = buf.readUInt16LE(opt + 70);
	const dataDirs = opt + 112;
	const dir = (i) => ({ rva: buf.readUInt32LE(dataDirs + i * 8), size: buf.readUInt32LE(dataDirs + i * 8 + 4) });
	if (sizeOfHeaders > buf.length || sizeOfHeaders < opt + sizeOfOptionalHeader + numberOfSections * 40) throw new Error("SizeOfHeaders does not cover the headers");

	const sections = [];
	let imageEnd = sizeOfHeaders;
	for (let i = 0, sec = opt + sizeOfOptionalHeader; i < numberOfSections; i++, sec += 40) {
		const name = buf.toString("latin1", sec, sec + 8).replace(/\0+$/, "");
		const virtualSize = buf.readUInt32LE(sec + 8);
		const virtualAddress = buf.readUInt32LE(sec + 12);
		const rawSize = buf.readUInt32LE(sec + 16);
		const rawPointer = buf.readUInt32LE(sec + 20);
		if (rawSize > 0) need(rawPointer, rawSize, `section ${name} raw data`);
		sections.push({ name, virtualAddress, virtualSize, rawPointer, rawSize, sha256: sha256(buf.subarray(rawPointer, rawPointer + rawSize)) });
		if (rawSize > 0) imageEnd = Math.max(imageEnd, rawPointer + rawSize);
	}
	const rvaToOffset = (rva) => {
		for (const s of sections) {
			if (rva >= s.virtualAddress && rva < s.virtualAddress + s.rawSize) return s.rawPointer + (rva - s.virtualAddress);
		}
		return -1;
	};
	const cstr = (offset) => {
		if (offset < 0 || offset >= buf.length) throw new Error("a name RVA points outside the image");
		let end = offset;
		while (end < buf.length && buf[end] !== 0) end++;
		return buf.toString("latin1", offset, end);
	};
	/** Name -> hint for one import name table (8-byte PE32+ thunks). */
	const hintsOf = (tableRva) => {
		const hints = {};
		const start = tableRva !== 0 ? rvaToOffset(tableRva) : -1;
		if (start < 0) return hints;
		for (let i = 0, at = start; ; i++, at += 8) {
			if (i >= MAX_TABLE_ENTRIES) throw new Error("an import name table never ends");
			const thunk = u64(at, "an import name table");
			if (thunk === 0n) break;
			if ((thunk & 0x8000000000000000n) !== 0n) {
				hints[`#${Number(thunk & 0xffffn)}`] = null;
				continue;
			}
			const entry = rvaToOffset(Number(thunk & 0x7fffffffn));
			if (entry < 0) throw new Error("an import name points outside the image");
			hints[cstr(entry + 2)] = u16(entry, "an import hint");
		}
		return hints;
	};

	const imports = [];
	const importHints = {};
	const imp = dir(DIR_IMPORT);
	const impStart = imp.rva !== 0 ? rvaToOffset(imp.rva) : -1;
	if (impStart >= 0) {
		for (let i = 0, d = impStart; ; i++, d += 20) {
			if (i >= MAX_TABLE_ENTRIES || d + 20 > buf.length) throw new Error("import directory runs past the end of the file");
			const nameRva = buf.readUInt32LE(d + 12);
			if (nameRva === 0 && buf.readUInt32LE(d) === 0) break;
			if (nameRva === 0) continue;
			const name = cstr(rvaToOffset(nameRva));
			imports.push(name);
			const lookup = buf.readUInt32LE(d) || buf.readUInt32LE(d + 16);
			importHints[name] = hintsOf(lookup);
		}
	}
	const delayImports = [];
	const delayImportHints = {};
	const delay = dir(DIR_DELAY_IMPORT);
	const delayStart = delay.rva !== 0 ? rvaToOffset(delay.rva) : -1;
	if (delayStart >= 0) {
		for (let i = 0, d = delayStart; ; i++, d += 32) {
			if (i >= MAX_TABLE_ENTRIES || d + 32 > buf.length) throw new Error("delay-import directory runs past the end of the file");
			const nameRva = buf.readUInt32LE(d + 4);
			if (nameRva === 0) break;
			const name = cstr(rvaToOffset(nameRva));
			delayImports.push(name);
			delayImportHints[name] = hintsOf(buf.readUInt32LE(d + 16));
		}
	}

	let repro = false;
	let reproHash = null;
	let cetCompat = false;
	let codeView = null;
	const dbg = dir(DIR_DEBUG);
	if (dbg.rva !== 0) {
		const base = rvaToOffset(dbg.rva);
		if (base < 0 || base + dbg.size > buf.length) throw new Error("debug directory points outside the image");
		for (let d = base; d + 28 <= base + dbg.size; d += 28) {
			const type = buf.readUInt32LE(d + 12);
			const size = buf.readUInt32LE(d + 16);
			const raw = buf.readUInt32LE(d + 24);
			if (type === IMAGE_DEBUG_TYPE_REPRO) {
				repro = true;
				if (size >= 4) {
					const length = u32(raw, "the REPRO record");
					if (length > 0 && length <= size - 4) {
						need(raw + 4, length, "the REPRO hash");
						reproHash = buf.toString("hex", raw + 4, raw + 4 + length);
					}
				}
			}
			if (type === IMAGE_DEBUG_TYPE_EX_DLLCHARACTERISTICS && raw > 0 && raw + 4 <= buf.length) {
				// Bit 0 = IMAGE_DLLCHARACTERISTICS_EX_CET_COMPAT.
				cetCompat = (buf.readUInt32LE(raw) & 0x01) !== 0;
			}
			if (type === IMAGE_DEBUG_TYPE_CODEVIEW && size >= 24) {
				need(raw, size, "the CodeView record");
				if (u32(raw, "the CodeView signature") === 0x53445352) {
					const end = buf.indexOf(0, raw + 24);
					if (end < 0 || end > raw + size) throw new Error("the CodeView path is not terminated");
					codeView = { guid: guidString(buf.subarray(raw + 4, raw + 20)), age: buf.readUInt32LE(raw + 20), path: buf.toString("utf8", raw + 24, end) };
				}
			}
		}
	}

	// Data directory 4 holds a FILE OFFSET, not an RVA.
	const security = dir(DIR_SECURITY);
	let certificateTable = null;
	if (security.rva !== 0 || security.size !== 0) {
		need(security.rva, security.size, "the certificate table");
		certificateTable = { offset: security.rva, size: security.size };
	}
	const overlayBytes = certificateTable === null
		? buf.length - imageEnd
		: Math.max(0, certificateTable.offset - imageEnd) + (buf.length - (certificateTable.offset + certificateTable.size));

	const headers = Buffer.from(buf.subarray(0, sizeOfHeaders));
	headers.fill(0, checksumOffset, checksumOffset + 4);
	headers.fill(0, dataDirs + DIR_SECURITY * 8, dataDirs + DIR_SECURITY * 8 + 8);

	return {
		machine: machine === 0x8664 ? "x64" : machine === 0xaa64 ? "arm64" : `0x${machine.toString(16)}`,
		linkerVersion,
		imports,
		delayImports,
		hardening: {
			highEntropyVa: (dllCharacteristics & 0x0020) !== 0,
			dynamicBase: (dllCharacteristics & 0x0040) !== 0,
			nxCompat: (dllCharacteristics & 0x0100) !== 0,
			controlFlowGuard: (dllCharacteristics & 0x4000) !== 0,
			cetCompat,
			reproducibleLink: repro
		},
		coffTimestamp,
		peChecksum,
		certificateTable,
		overlayBytes,
		sections: sections.map(({ name, rawPointer, rawSize, sha256: hash }) => ({ name, rawPointer, rawSize, sha256: hash })),
		headersNeutralSha256: sha256(headers),
		codeView,
		reproHash,
		importHints,
		delayImportHints
	};
}
