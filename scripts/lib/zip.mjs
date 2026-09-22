// A small ZIP reader and writer for the packaging gate and its fixtures.
// The reader walks the central directory (the only authoritative index of
// an archive), so a member that is listed twice, listed under an unsafe
// name, encrypted, or stored with a method this project never ships is
// reported instead of guessed at. Sizes and CRCs come from the central
// directory too, because the Elgato CLI writes local headers with the
// data-descriptor flag (bit 3), where those fields are zero. Every member
// read is inflated in full and checked against its CRC-32 and both sizes.
// ZIP64, multi-disk and encrypted archives are refused: a 300 KB plugin
// never needs them, and refusing keeps the parser honest about what it
// understood. The writer exists for tests (fixtures that must be wrong in
// exactly one way) and mirrors what the reader accepts.
import { inflateRawSync, deflateRawSync } from "node:zlib";

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_DATA_DESCRIPTOR = 0x0008;

let crcTable = null;
export function crc32(data) {
	if (crcTable === null) {
		crcTable = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			crcTable[n] = c >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Lists the central directory. Returns { entries, problems }: `problems` are
 * container-level defects (no directory, ZIP64, a bad signature, a
 * multi-disk archive) that make the listing untrustworthy; the caller
 * treats any problem as a failed archive. Entries carry the central
 * directory's name, method, flags, crc and sizes, and the local header
 * offset, exactly as recorded; nothing here inflates a member.
 */
export function listZip(buffer) {
	const problems = [];
	if (buffer.length < 22) return { entries: [], problems: ["archive is shorter than an end-of-central-directory record"] };
	let eocd = -1;
	for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) {
		if (buffer.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
	}
	if (eocd < 0) return { entries: [], problems: ["no end-of-central-directory record"] };
	if (eocd >= 20 && buffer.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIG) problems.push("ZIP64 archives are not accepted");
	const diskNumber = buffer.readUInt16LE(eocd + 4);
	const directoryDisk = buffer.readUInt16LE(eocd + 6);
	const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
	const entriesTotal = buffer.readUInt16LE(eocd + 10);
	const directorySize = buffer.readUInt32LE(eocd + 12);
	const directoryOffset = buffer.readUInt32LE(eocd + 16);
	const commentLength = buffer.readUInt16LE(eocd + 20);
	if (diskNumber !== 0 || directoryDisk !== 0 || entriesOnDisk !== entriesTotal) problems.push("multi-disk archives are not accepted");
	if (eocd + 22 + commentLength !== buffer.length) problems.push("bytes follow the end-of-central-directory record");
	if (entriesTotal === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) problems.push("ZIP64 archives are not accepted");
	if (directoryOffset + directorySize !== eocd) problems.push("central directory does not end at the end-of-central-directory record");
	if (problems.length > 0) return { entries: [], problems };
	const entries = [];
	let p = directoryOffset;
	for (let i = 0; i < entriesTotal; i++) {
		if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== CENTRAL_SIG) return { entries: [], problems: [`central directory entry ${i} has a bad signature`] };
		const flags = buffer.readUInt16LE(p + 8);
		const method = buffer.readUInt16LE(p + 10);
		const crc = buffer.readUInt32LE(p + 16);
		const compressedSize = buffer.readUInt32LE(p + 20);
		const uncompressedSize = buffer.readUInt32LE(p + 24);
		const nameLength = buffer.readUInt16LE(p + 28);
		const extraLength = buffer.readUInt16LE(p + 30);
		const commentLength2 = buffer.readUInt16LE(p + 32);
		const localHeaderOffset = buffer.readUInt32LE(p + 42);
		const rawName = buffer.subarray(p + 46, p + 46 + nameLength);
		// The Elgato CLI's writer records every size as 0xFFFFFFFF in the
		// central directory and puts the real values in a ZIP64 extended
		// information field (id 0x0001), even for a 300 KB archive. Read that
		// field for exactly the values marked that way, in the order the
		// specification fixes; anything above what a Buffer can address is
		// refused rather than truncated.
		const sizes = { compressedSize, uncompressedSize, localHeaderOffset };
		const extra = buffer.subarray(p + 46 + nameLength, p + 46 + nameLength + extraLength);
		for (let x = 0; x + 4 <= extra.length;) {
			const id = extra.readUInt16LE(x);
			const size = extra.readUInt16LE(x + 2);
			const field = extra.subarray(x + 4, x + 4 + size);
			if (id === 0x0001) {
				let f = 0;
				const take = (key) => {
					if (sizes[key] !== 0xffffffff) return;
					if (f + 8 > field.length) { problems.push(`central directory entry ${i} has a short ZIP64 field`); return; }
					const wide = field.readBigUInt64LE(f);
					f += 8;
					if (wide > BigInt(buffer.length)) { problems.push(`central directory entry ${i} claims ${key} ${wide} beyond the archive`); return; }
					sizes[key] = Number(wide);
				};
				take("uncompressedSize");
				take("compressedSize");
				take("localHeaderOffset");
			}
			x += 4 + size;
		}
		entries.push({ name: rawName.toString("utf8"), rawName, flags, method, crc, ...sizes, encrypted: (flags & FLAG_ENCRYPTED) !== 0 });
		p += 46 + nameLength + extraLength + commentLength2;
	}
	if (p !== eocd) problems.push("central directory size disagrees with its entries");
	if (entries.some((entry) => [entry.compressedSize, entry.uncompressedSize, entry.localHeaderOffset].includes(0xffffffff))) problems.push("a central directory entry marks a ZIP64 size without carrying it");
	if (problems.length > 0) return { entries: [], problems };
	return { entries, problems };
}

/**
 * Reads one member in full: locates its local header, skips the local
 * name and extra fields (the central directory's lengths win over the
 * local ones only for sizes and CRC, which is what the data-descriptor
 * flag means), inflates, and checks CRC-32 and both sizes. Throws on any
 * disagreement, an unsupported method, or encryption.
 */
export function readZipEntry(buffer, entry) {
	if (entry.encrypted) throw new Error(`${entry.name}: encrypted members are not accepted`);
	const h = entry.localHeaderOffset;
	if (h + 30 > buffer.length || buffer.readUInt32LE(h) !== LOCAL_SIG) throw new Error(`${entry.name}: local header not found at the offset the central directory records`);
	const nameLength = buffer.readUInt16LE(h + 26);
	const extraLength = buffer.readUInt16LE(h + 28);
	const localName = buffer.subarray(h + 30, h + 30 + nameLength);
	if (!localName.equals(entry.rawName)) throw new Error(`${entry.name}: local header names a different member`);
	const start = h + 30 + nameLength + extraLength;
	const end = start + entry.compressedSize;
	if (end > buffer.length) throw new Error(`${entry.name}: compressed data runs past the end of the archive`);
	const compressed = buffer.subarray(start, end);
	let data;
	if (entry.method === METHOD_STORE) data = Buffer.from(compressed);
	else if (entry.method === METHOD_DEFLATE) data = inflateRawSync(compressed);
	else throw new Error(`${entry.name}: compression method ${entry.method} is not accepted`);
	if (data.length !== entry.uncompressedSize) throw new Error(`${entry.name}: inflated to ${data.length} bytes, the directory says ${entry.uncompressedSize}`);
	if (crc32(data) !== entry.crc) throw new Error(`${entry.name}: CRC-32 mismatch`);
	return data;
}

/**
 * Writes an archive the reader accepts. `entries` is an array of
 * { name, data, method?, flags? }; the defaults produce what the Elgato CLI
 * produces (deflate, data-descriptor flag, UTF-8 names). Test fixtures pass
 * a `corrupt` hook to damage one field on purpose, and duplicate names are
 * written as given so a fixture can carry the same member twice.
 */
export function writeZip(entries, { corrupt } = {}) {
	const chunks = [];
	const central = [];
	let offset = 0;
	for (const entry of entries) {
		const name = Buffer.from(entry.name, "utf8");
		const method = entry.method ?? METHOD_DEFLATE;
		const flags = entry.flags ?? (FLAG_DATA_DESCRIPTOR | 0x0800);
		const data = Buffer.from(entry.data);
		const packed = method === METHOD_DEFLATE ? deflateRawSync(data) : data;
		const record = { crc: crc32(data), compressedSize: packed.length, uncompressedSize: data.length, method, flags };
		if (corrupt) corrupt(entry.name, record);
		const descriptor = (flags & FLAG_DATA_DESCRIPTOR) !== 0;
		const local = Buffer.alloc(30);
		local.writeUInt32LE(LOCAL_SIG, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(flags, 6);
		local.writeUInt16LE(method, 8);
		local.writeUInt16LE(0, 10);
		local.writeUInt16LE(((2026 - 1980) << 9) | (1 << 5) | 1, 12);
		local.writeUInt32LE(descriptor ? 0 : record.crc, 14);
		local.writeUInt32LE(descriptor ? 0 : record.compressedSize, 18);
		local.writeUInt32LE(descriptor ? 0 : record.uncompressedSize, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);
		chunks.push(local, name, packed);
		let size = 30 + name.length + packed.length;
		if (descriptor) {
			const trailer = Buffer.alloc(16);
			trailer.writeUInt32LE(0x08074b50, 0);
			trailer.writeUInt32LE(record.crc, 4);
			trailer.writeUInt32LE(record.compressedSize, 8);
			trailer.writeUInt32LE(record.uncompressedSize, 12);
			chunks.push(trailer);
			size += 16;
		}
		const dir = Buffer.alloc(46);
		dir.writeUInt32LE(CENTRAL_SIG, 0);
		dir.writeUInt16LE(20, 4);
		dir.writeUInt16LE(20, 6);
		dir.writeUInt16LE(flags, 8);
		dir.writeUInt16LE(method, 10);
		dir.writeUInt16LE(0, 12);
		dir.writeUInt16LE(((2026 - 1980) << 9) | (1 << 5) | 1, 14);
		dir.writeUInt32LE(record.crc, 16);
		dir.writeUInt32LE(record.compressedSize, 20);
		dir.writeUInt32LE(record.uncompressedSize, 24);
		dir.writeUInt16LE(name.length, 28);
		dir.writeUInt16LE(0, 30);
		dir.writeUInt16LE(0, 32);
		dir.writeUInt16LE(0, 34);
		dir.writeUInt16LE(0, 36);
		dir.writeUInt32LE(0, 38);
		dir.writeUInt32LE(offset, 42);
		central.push(dir, name);
		offset += size;
	}
	const directory = Buffer.concat(central);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(EOCD_SIG, 0);
	eocd.writeUInt16LE(0, 4);
	eocd.writeUInt16LE(0, 6);
	eocd.writeUInt16LE(entries.length, 8);
	eocd.writeUInt16LE(entries.length, 10);
	eocd.writeUInt32LE(directory.length, 12);
	eocd.writeUInt32LE(offset, 16);
	eocd.writeUInt16LE(0, 20);
	return Buffer.concat([...chunks, directory, eocd]);
}
