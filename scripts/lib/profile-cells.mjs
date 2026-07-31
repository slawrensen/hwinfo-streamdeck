// Store-only ZIP reading of a shipped detail profile's baked keypad cells,
// shared by the drill-down e2e and the perf harness. The bundled archives
// never compress (detail-profile-archive.ts writes store entries), so a
// local-header walk is the whole reader.
import fs from "node:fs";
import path from "node:path";

export function unzipStore(archive) {
	const files = new Map();
	let pos = 0;
	while (pos + 4 <= archive.length && archive.readUInt32LE(pos) === 0x04034b50) {
		const size = archive.readUInt32LE(pos + 18);
		const nameLen = archive.readUInt16LE(pos + 26);
		const extraLen = archive.readUInt16LE(pos + 28);
		const name = archive.subarray(pos + 30, pos + 30 + nameLen).toString("utf8");
		const start = pos + 30 + nameLen + extraLen;
		files.set(name, Buffer.from(archive.subarray(start, start + size)));
		pos = start + size;
	}
	return files;
}

/** The baked keypad cells of a shipped detail profile: [{coord, settings, uuid}]. */
export function profileCells(pluginDir, name) {
	const archive = fs.readFileSync(path.join(pluginDir, `${name}.streamDeckProfile`));
	const files = unzipStore(archive);
	const pageName = [...files.keys()].find((n) => /Profiles\/.*\/Profiles\/.*manifest\.json$/.test(n));
	const page = JSON.parse(files.get(pageName).toString("utf8"));
	const keypad = page.Controllers.find((c) => c.Type === "Keypad");
	return Object.entries(keypad.Actions).map(([coord, entry]) => ({ coord, settings: entry.Settings, uuid: entry.UUID }));
}
