// Rebuild the docs gallery from the maintainer's original Stream Deck app captures.
// Run from any directory: node scripts/docs-gallery-images.mjs
// The native PNG and WebP exports preserve every pixel inside the recorded crop.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
const outputDirectory = path.join(root, "docs/assets/img/showcase/gallery");
const frame = { width: 830, height: 450 };
const captures = [
	{
		name: "green-night", originalName: "image(20261025-033735).png",
		sha256: "12902cb2ba8815441976526f9cd64072490a6b001c2129b1dbee467db16b6d89",
		size: [888, 501], left: 29, top: 28,
	},
	{
		name: "green-aurora", originalName: "image(20261025-033807).png",
		sha256: "ac1c55502014de334578289f4d931c8ef40b09c692e59bb19ccdb4984155a1e9",
		size: [944, 495], left: 56, top: 29,
	},
	{
		name: "violet-dusk", originalName: "image(20261025-033834).png",
		sha256: "5dcb0d530d0f59081534ca55976f243257caace83511f733ba9476cea63d53db",
		size: [886, 506], left: 27, top: 38,
	},
	{
		name: "amber-dusk", originalName: "image(20261025-033904).png",
		sha256: "7c5cb39c40a38a1cffce2b1d2b820232562b71f78a6018aefccdcf0fbe23ed26",
		size: [884, 499], left: 26, top: 30,
	},
	{
		name: "cyan-stars", originalName: "image(20261025-033934).png",
		sha256: "976c2a25b2db3a5a4a2749c46dfcf0a35c3c1b1cb29450e9b8ad4b4daaac462c",
		size: [909, 495], left: 36, top: 31,
	},
];

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const relativePath = (file) => path.relative(root, file).split(path.sep).join("/");

async function describeOutput(file, pixelExact) {
	const bytes = await readFile(file);
	const { width, height } = await sharp(bytes).metadata();
	return {
		file: path.basename(file), width, height, bytes: bytes.length,
		sha256: digest(bytes), pixelExact,
	};
}

const manifest = {
	schemaVersion: 1,
	sourceKind: "User-supplied Stream Deck app capture",
	processing: "Deterministic crops only at native size. No generated pixels, repainting, recoloring, compositing, resampling or upscaling. Native PNG and WebP exports are pixel-identical to the source crop. Exact original PNG masters are retained in sources/.",
	rebuild: "node scripts/docs-gallery-images.mjs",
	encoder: { sharp: sharp.versions.sharp, libvips: sharp.versions.vips, libwebp: sharp.versions.webp },
	frame: {
		...frame,
		cropCoordinates: "[left, top, right, bottom], zero-based, right and bottom exclusive",
		keyRows: [[0, 78], [94, 172], [188, 266], [282, 360]],
		keyColumns: [[0, 78], [94, 172], [188, 266], [282, 360], [376, 454], [470, 548], [564, 642], [658, 736], [752, 830]],
		touchStrip: [0, 376, 830, 450],
	},
	rights: {
		credit: "App captures supplied by Stephen Lawrensen.",
		background: "Supplied by maintainer; source background identity not provided.",
		backgroundDownloads: false,
		note: "Color labels describe these captures without asserting an exact theme or background source. These are screenshots with readings, not clean background files. No separate image license is inferred from the repository's software license.",
	},
	assets: [],
};

await mkdir(outputDirectory, { recursive: true });

for (const capture of captures) {
	const sourceFile = path.join(outputDirectory, "sources", `${capture.name}.png`);
	const originalBytes = await readFile(sourceFile);
	assert.equal(digest(originalBytes), capture.sha256, `Original capture changed: ${capture.name}`);
	const metadata = await sharp(originalBytes).metadata();
	assert.deepEqual([metadata.width, metadata.height], capture.size, `Source size changed: ${capture.name}`);
	const crop = { left: capture.left, top: capture.top, ...frame };
	const nativePng = path.join(outputDirectory, `${capture.name}.png`);
	const nativeWebp = path.join(outputDirectory, `${capture.name}.webp`);

	await sharp(originalBytes).extract(crop).png({ compressionLevel: 9 }).toFile(nativePng);
	await sharp(nativePng).webp({ lossless: true, effort: 6 }).toFile(nativeWebp);

	const expectedPixels = await sharp(originalBytes).extract(crop).ensureAlpha().raw().toBuffer();
	for (const file of [nativePng, nativeWebp]) {
		const actualPixels = await sharp(file).ensureAlpha().raw().toBuffer();
		assert.ok(actualPixels.equals(expectedPixels), `Native export changed source pixels: ${file}`);
	}

	manifest.assets.push({
		name: capture.name,
		source: relativePath(sourceFile),
		originalName: capture.originalName,
		sourceSha256: capture.sha256,
		sourceSize: capture.size,
		crop: [capture.left, capture.top, capture.left + frame.width, capture.top + frame.height],
		output: [
			await describeOutput(nativePng, true),
			await describeOutput(nativeWebp, true),
		],
	});
	console.log(`${capture.name}: ${frame.width} x ${frame.height}; native PNG/WebP pixels verified`);
}

await writeFile(path.join(outputDirectory, "provenance.json"), `${JSON.stringify(manifest, null, 2)}\n`);
