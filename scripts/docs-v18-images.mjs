// The 1.8 picture boards (scripts/lib/boards-18.ts): whole decks, key looks
// and Strip display graphs drawn through the production composers from
// FIXED SAMPLE VALUES. No HWiNFO, no Stream Deck app. Writes each board and
// docs/assets/img/renderer-images-1.8.provenance.json, which records every
// board's PNG hash and the hash of each face it drew;
// test/docs-image-provenance.test.ts composes the faces again and holds both.
// Usage: npx tsx scripts/docs-v18-images.mjs [outRoot=the repo] [file filter]
import "./lib/script-failures.mjs";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { BOARD_GLOBALS, BOARDS } from "./lib/boards-18.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] ?? root);
const filter = process.argv[3];
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const assets = [];
for (const board of BOARDS) {
	if (filter !== undefined && !board.file.includes(filter)) continue;
	const png = await board.draw();
	const file = path.join(out, board.file);
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, png);
	const { width, height } = await sharp(png).metadata();
	assets.push({ file: board.file, width, height, sha256: sha256(png), kind: "production-renderer board", sampleData: true, shows: board.shows, faces: board.faces().map((svg) => sha256(svg)) });
	console.log(`wrote ${board.file} (${width}x${height}, ${png.length} B)`);
}

if (filter === undefined) {
	const note = "Fixed sample values through the production key, dial and strip composers, each face painted at its place on the device's published layout. Not device captures.";
	writeFileSync(path.join(out, "docs/assets/img/renderer-images-1.8.provenance.json"), `${JSON.stringify({ version, command: "npx tsx scripts/docs-v18-images.mjs", globals: BOARD_GLOBALS, note, assets }, null, "\t")}\n`);
}
process.exit(0);
