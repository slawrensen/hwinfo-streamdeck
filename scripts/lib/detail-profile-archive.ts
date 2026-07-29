/**
 * Deterministic .streamDeckProfile builder for the bundled detail
 * profiles. Same inputs, same bytes, always: GUIDs derive from stable
 * namespaces (SHA-1, RFC 4122 version-5 bits), timestamps are fixed, the
 * ZIP is store-only with a hand-rolled writer (no library, no incidental
 * metadata), and every value comes from the managed-profile registry.
 *
 * Archive shape (v3 profile format, verified against Elgato's own
 * bundled Volume Controller + XL export and a real import on hardware):
 *   package.json
 *   Profiles/<UMBRELLA>.sdProfile/manifest.json
 *   Profiles/<UMBRELLA>.sdProfile/Profiles/<PAGE>/manifest.json
 * GUIDs are UPPERCASE in paths and lowercase inside the JSON, and the
 * umbrella's Pages.Pages must list every page INCLUDING the default (an
 * empty list makes the app reject the import as corrupted).
 *
 * The page never contains reading keys, sensor names, values, device
 * ids or user data: each cell is the hidden detail-slot action with its
 * static role binding, nothing else.
 */
import { createHash } from "node:crypto";

import type { DetailNavRole, ManagedDetailProfile } from "../../src/detail/managed-profiles";

export const PLUGIN_UUID = "com.lawrensen.hwinfo";
export const DETAIL_SLOT_UUID = "com.lawrensen.hwinfo.detail-slot";
/** Every bundle shows this name in the app's per-device profile list. */
export const DETAIL_PROFILE_DISPLAY_NAME = "HWiNFO Details";
/** Fixed environment metadata: the app/OS the canonical import test ran on. */
const APP_VERSION = "7.4.2.22730";
const OS_VERSION = "10.0.19044";

/** RFC 4122 version-5 style GUID from a stable namespace + name. */
export function guidFor(namespace: string, name: string): string {
	const digest = createHash("sha1").update(`${namespace}:${name}`).digest();
	const bytes = Buffer.from(digest.subarray(0, 16));
	bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** One page cell: the hidden slot action with its baked role binding. */
function slotEntry(namespace: string, cellName: string, settings: Record<string, unknown>): Record<string, unknown> {
	return {
		ActionID: guidFor(namespace, cellName),
		LinkedTitle: true,
		Name: "Sensor Detail Slot",
		Plugin: { Name: "HWiNFO Sensors", UUID: PLUGIN_UUID, Version: "1.0" },
		Resources: null,
		Settings: settings,
		State: 0,
		States: [{}],
		UUID: DETAIL_SLOT_UUID
	};
}

/** The page's Actions map, keyed "column,row". Throws on any plan defect
 * (duplicate or out-of-bounds cell) — a generator must fail loudly, not
 * ship a subtly wrong grid. */
export function buildPageActions(profile: ManagedDetailProfile, namespace: string): Record<string, unknown> {
	const { layout } = profile;
	const actions: Record<string, unknown> = {};
	const place = (cell: { column: number; row: number }, cellName: string, settings: Record<string, unknown>): void => {
		if (cell.column < 0 || cell.column >= layout.columns || cell.row < 0 || cell.row >= layout.rows) {
			throw new Error(`${profile.key}: cell ${cell.column},${cell.row} is outside the ${layout.columns}x${layout.rows} grid`);
		}
		const key = `${cell.column},${cell.row}`;
		if (actions[key] !== undefined) {
			throw new Error(`${profile.key}: duplicate cell ${key}`);
		}
		actions[key] = slotEntry(namespace, cellName, settings);
	};
	for (const role of ["back", "title", "previous", "next"] as DetailNavRole[]) {
		const cell = layout.nav[role];
		if (cell !== null) {
			place(cell, `nav:${role}`, { slot: role });
		}
	}
	profile.layout.readings.forEach((cell, index) => {
		place(cell, `reading:${index}`, { slot: "reading", index });
	});
	const expected = layout.columns * layout.rows;
	if (Object.keys(actions).length !== expected) {
		throw new Error(`${profile.key}: ${Object.keys(actions).length} cells mapped, expected ${expected}`);
	}
	return actions;
}

/** Stable JSON: plain JSON.stringify with the insertion order fixed by
 * construction (no sorting — the shape mirrors real exports). */
function jsonBytes(value: unknown): Buffer {
	return Buffer.from(JSON.stringify(value), "utf8");
}

export function buildDetailProfileArchive(profile: ManagedDetailProfile): Buffer {
	const namespace = `${PLUGIN_UUID}.detail:${profile.key}`;
	const umbrella = guidFor(namespace, "umbrella");
	const page = guidFor(namespace, "page-0");
	const umbrellaUpper = umbrella.toUpperCase();
	const pageUpper = page.toUpperCase();

	const packageJson = {
		AppVersion: APP_VERSION,
		DeviceModel: profile.deviceModel,
		DeviceSettings: null,
		FormatVersion: 1,
		OSType: "Windows",
		OSVersion: OS_VERSION,
		RequiredPlugins: [PLUGIN_UUID]
	};
	const umbrellaManifest = {
		Device: { Model: profile.deviceModel, UUID: umbrella },
		Name: DETAIL_PROFILE_DISPLAY_NAME,
		Pages: { Current: "00000000-0000-0000-0000-000000000000", Default: page, Pages: [page] },
		Version: "3.0"
	};
	const controllers: Array<Record<string, unknown>> = [{ Actions: buildPageActions(profile, namespace), Type: "Keypad" }];
	if (profile.encoders > 0) {
		// Dials are deliberately empty: detail navigation must not require
		// them (they stay inert while the detail page is up).
		controllers.push({ Actions: null, Type: "Encoder" });
	}
	const pageManifest = { Controllers: controllers, Icon: "", Name: "" };

	return zipStore([
		{ path: "package.json", data: jsonBytes(packageJson) },
		{ path: `Profiles/${umbrellaUpper}.sdProfile/manifest.json`, data: jsonBytes(umbrellaManifest) },
		{ path: `Profiles/${umbrellaUpper}.sdProfile/Profiles/${pageUpper}/manifest.json`, data: jsonBytes(pageManifest) }
	]);
}

// --- Deterministic store-only ZIP writer -------------------------------

/** Fixed DOS stamp: 2026-01-01 00:00:00, so rebuilds are byte-identical. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

let crcTable: Uint32Array | null = null;

function crc32(data: Buffer): number {
	if (crcTable === null) {
		crcTable = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) {
				c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			}
			crcTable[n] = c >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (const byte of data) {
		crc = (crcTable[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

type ZipEntry = { path: string; data: Buffer };

function zipStore(entries: readonly ZipEntry[]): Buffer {
	const chunks: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;
	for (const entry of entries) {
		const name = Buffer.from(entry.path, "utf8");
		const crc = crc32(entry.data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4); // version needed
		local.writeUInt16LE(0, 6); // flags
		local.writeUInt16LE(0, 8); // method: store
		local.writeUInt16LE(DOS_TIME, 10);
		local.writeUInt16LE(DOS_DATE, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(entry.data.length, 18);
		local.writeUInt32LE(entry.data.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28); // extra length
		chunks.push(local, name, entry.data);

		const dir = Buffer.alloc(46);
		dir.writeUInt32LE(0x02014b50, 0);
		dir.writeUInt16LE(20, 4); // version made by
		dir.writeUInt16LE(20, 6); // version needed
		dir.writeUInt16LE(0, 8);
		dir.writeUInt16LE(0, 10); // store
		dir.writeUInt16LE(DOS_TIME, 12);
		dir.writeUInt16LE(DOS_DATE, 14);
		dir.writeUInt32LE(crc, 16);
		dir.writeUInt32LE(entry.data.length, 20);
		dir.writeUInt32LE(entry.data.length, 24);
		dir.writeUInt16LE(name.length, 28);
		dir.writeUInt16LE(0, 30); // extra
		dir.writeUInt16LE(0, 32); // comment
		dir.writeUInt16LE(0, 34); // disk
		dir.writeUInt16LE(0, 36); // internal attrs
		dir.writeUInt32LE(0, 38); // external attrs
		dir.writeUInt32LE(offset, 42);
		central.push(dir, name);
		offset += 30 + name.length + entry.data.length;
	}
	const centralBytes = Buffer.concat(central);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(0, 4);
	eocd.writeUInt16LE(0, 6);
	eocd.writeUInt16LE(entries.length, 8);
	eocd.writeUInt16LE(entries.length, 10);
	eocd.writeUInt32LE(centralBytes.length, 12);
	eocd.writeUInt32LE(offset, 16);
	eocd.writeUInt16LE(0, 20);
	return Buffer.concat([...chunks, centralBytes, eocd]);
}

/** Minimal store-only ZIP reader for validation tests: local headers are
 * walked directly (the writer above never compresses or adds extras). */
export function unzipStore(archive: Buffer): Map<string, Buffer> {
	const files = new Map<string, Buffer>();
	let pos = 0;
	while (pos + 4 <= archive.length && archive.readUInt32LE(pos) === 0x04034b50) {
		const method = archive.readUInt16LE(pos + 8);
		const size = archive.readUInt32LE(pos + 18);
		const nameLen = archive.readUInt16LE(pos + 26);
		const extraLen = archive.readUInt16LE(pos + 28);
		const name = archive.subarray(pos + 30, pos + 30 + nameLen).toString("utf8");
		if (method !== 0) {
			throw new Error(`${name}: not stored (method ${method})`);
		}
		const start = pos + 30 + nameLen + extraLen;
		files.set(name, Buffer.from(archive.subarray(start, start + size)));
		pos = start + size;
	}
	return files;
}
