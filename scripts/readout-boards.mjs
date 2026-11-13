// Writes review boards for the strip's large values (Readout: left of the
// graph, values only) and the Scale and grid overlay:
// the member slices of each scene stitched side by side over real touch
// strip pictures (1200 x 100 PNGs, e.g. copies of a profile's strip
// images), rasterized by sharp (librsvg). Renderer samples from synthetic
// history, not device photographs; nothing here is committed.
//   npm run readout-boards -- <pictureDir> <outDir> [id filter]
// A + (800 px) scene takes the middle 800 px of a picture. Prints each
// scene's largest slice and the digit cap height of its large values.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

import { fixtureCase } from "./lib/strip-fixtures.ts";
import { feedbackUri, sliceStrip, svgBytes } from "../src/strip/slicer.ts";
import { digitMetrics } from "../src/strip/readout.ts";
import { setFaceFont } from "../src/ui/face-font.ts";

const [pictureDir, outDir, filter] = process.argv.slice(2);
if (pictureDir === undefined || outDir === undefined) {
	console.error("usage: npm run readout-boards -- <pictureDir> <outDir> [id filter]");
	process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const pictures = readdirSync(pictureDir).filter((f) => f.toLowerCase().endsWith(".png")).sort();
const pick = (word) => pictures.find((f) => f.toUpperCase().includes(word));
const backdrops = [pick("AURORADARK"), pick("AURORALIMB"), pick("CLIFFS")].filter((f) => f !== undefined);
if (backdrops.length === 0) {
	console.error(`no AURORA or CLIFFS pictures in ${pictureDir}`);
	process.exit(2);
}

async function strip(picture, width) {
	const img = sharp(path.join(pictureDir, picture)).resize(1200, 100, { fit: "cover" });
	const left = Math.round((1200 - width) / 2);
	return img.extract({ left, top: 0, width, height: 100 }).png().toBuffer();
}

async function board(c, picture) {
	const r = sliceStrip(c.input);
	const width = c.input.encoders * 200;
	const layers = r.slices.flatMap((svg, i) => (svg === null ? [] : [{ input: Buffer.from(svg), left: i * 200, top: 0 }]));
	const png = await sharp(await strip(picture, width)).composite(layers).png().toBuffer();
	return { png, r };
}

/** The digit size of the largest text in a scene (its readout). */
function largestText(slices) {
	let size = 0;
	for (const svg of slices) for (const m of (svg ?? "").matchAll(/font-size="(\d+)" font-weight="700"/g)) size = Math.max(size, Number(m[1]));
	return size;
}

const scenes = [];
const add = (c, picture, look) => scenes.push({ c, picture, look });
const two = ["cpu", "gpu"];
const three = ["cpu", "gpu", "hot"];
const configs = [
	{ name: "left-1", style: "area", extras: { readout: "left", series: ["cpu"] } },
	{ name: "left-1-scale", style: "area", extras: { readout: "left", axes: true, series: ["cpu"] } },
	{ name: "left-2-compare", style: "compare", extras: { readout: "left", series: two } },
	{ name: "left-2-compare-scale", style: "compare", extras: { readout: "left", axes: true, series: two } },
	{ name: "left-3-compare", style: "compare", extras: { readout: "left", series: three } },
	{ name: "left-3-lanes-scale", style: "lanes", extras: { readout: "left", axes: true, series: ["hot", "load", "power"] } },
	{ name: "only-1", style: "trend", extras: { readout: "only", series: ["cpu"] } },
	{ name: "only-2", style: "compare", extras: { readout: "only", series: two } },
	{ name: "only-3", style: "compare", extras: { readout: "only", series: three } },
	{ name: "only-4", style: "compare", extras: { readout: "only", series: ["cpu", "gpu", "hot", "power"] } },
	{ name: "graph-compare-scale", style: "compare", extras: { axes: true, series: two } },
	{ name: "graph-lanes-scale", style: "lanes", extras: { axes: true, series: ["hot", "load", "power"] } },
	{ name: "graph-heat-scale", style: "heat", extras: { axes: true, series: ["hot"] } },
	// Five values across the strip: a pane holds at most four readings, so
	// five take a split, two in the left half and three in the right.
	{ name: "only-5", style: "compare", extras: { readout: "only", series: two }, right: { readout: "only", series: ["hot", "power", "load"] }, layouts: ["split"] }
];
const looks = [
	{ background: "clear", accent: false },
	{ background: "theme", accent: false },
	{ background: "glass", accent: false },
	{ background: "tint", accent: true },
	{ background: "outline", accent: false }
];
for (const cfg of configs) {
	for (const encoders of [6, 4]) {
		for (const layout of cfg.layouts ?? ["whole", "split"]) {
			for (const look of looks) {
				const c = fixtureCase({ styles: [cfg.style, cfg.style], layout, encoders, background: look.background, accent: look.accent, window: "1m", extras: [cfg.extras, cfg.right ?? cfg.extras] });
				add({ ...c, id: `${cfg.name}-${layout}-${encoders * 200}-${look.background}${look.accent ? "+accent" : ""}` }, backdrops[(scenes.length % backdrops.length)], look);
			}
		}
	}
}

const rows = [];
const cap = digitMetrics().cap;
setFaceFont("tahoma");
for (const s of scenes) {
	if (filter !== undefined && !s.c.id.includes(filter)) continue;
	const { png, r } = await board(s.c, s.picture);
	writeFileSync(path.join(outDir, `${s.c.id}.png`), png);
	const size = largestText(r.slices);
	const max = Math.max(...r.slices.map((svg) => (svg === null ? 0 : Buffer.byteLength(feedbackUri(svg), "utf8"))));
	rows.push({ id: s.c.id, picture: s.picture, size, capPx: Math.round(size * cap * 10) / 10, maxSvg: Math.max(...r.slices.map((svg) => (svg === null ? 0 : svgBytes(svg)))), maxUri: max, bucketPx: r.bucketPx });
}
writeFileSync(path.join(outDir, "readout-boards.csv"), ["id,picture,digitSize,capPx,maxSliceSvgBytes,maxSliceUriBytes,bucketPx", ...rows.map((r) => `${r.id},${r.picture},${r.size},${r.capPx},${r.maxSvg},${r.maxUri},${r.bucketPx}`)].join("\n") + "\n");
console.log(`${rows.length} boards written to ${outDir}`);
