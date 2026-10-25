// Reconstruct the five gallery looks through the unchanged production renderers.
// The source captures remain the authority for visible values and layout.
// Histories and covered wallpaper pixels cannot be recovered from a screenshot.
// node --import tsx scripts/docs-gallery-render.mjs --out .gallery-render-work
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { renderReadingKey } from "../src/ui/key-renderer.ts";
import { renderDial, renderDialOverview, renderDialTwoRow } from "../src/ui/dial-renderer.ts";
import { dialTextColors } from "../src/ui/dial-background.ts";
import { setFaceFont } from "../src/ui/face-font.ts";
import { loadThemes, resolvePalette } from "../src/ui/themes.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(ROOT, "scripts/fixtures/docs-gallery");
const LOOKS = ["cyan-stars", "green-night", "violet-dusk", "amber-dusk", "green-aurora"];
const WIDTH = 830;
const HEIGHT = 450;
const STRIP_SCALE = 824 / 1200;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const readJson = name => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));
const rgb = color => [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
const color = channels => `rgb(${channels.map(channel => Math.max(0, Math.min(255, channel)).toFixed(3)).join(",")})`;
const median = numbers => numbers.sort((a, b) => a - b)[Math.floor(numbers.length / 2)];

function nestedSvg(svg, x, y, width, height, prefix) {
	const namespaced = svg.replace(/id="([^"]+)"/g, `id="${prefix}-$1"`).replace(/url\(#([^)]*)\)/g, `url(#${prefix}-$1)`);
	return namespaced.replace(/<svg\b[^>]*>/, `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="0 0 ${prefix.startsWith("key") ? "144 144" : "200 100"}" overflow="hidden">`);
}

function duskBackground() {
	const model = readJson("dusk-background.json");
	const stops = model.stops.map(stop => `<stop offset="${stop.offset}" stop-color="${color(stop.rgb)}"/>`).join("");
	return `<defs><linearGradient id="dusk-color" gradientUnits="userSpaceOnUse" x1="3" y1="379" x2="827" y2="379">${stops}</linearGradient><linearGradient id="dusk-shade" gradientUnits="userSpaceOnUse" x1="0" y1="379" x2="0" y2="446"><stop stop-color="#000" stop-opacity="${1 - model.topBrightnessFactor}"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs><rect x="3" y="379" width="824" height="${100 * STRIP_SCALE}" fill="url(#dusk-color)"/><rect x="3" y="379" width="824" height="${100 * STRIP_SCALE}" fill="url(#dusk-shade)"/>`;
}

/** A smooth field fitted to visible background colors, not a recovered photo.
 * Exclude bright lettering, its black rim, and exact renderer ink colors before
 * sampling. Bilinear interpolation remains resolution-independent. */
async function sampledBackground(recipe) {
	const { data, info } = await sharp(path.join(ROOT, recipe.source)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
	const foreground = [recipe.palette.accent, recipe.palette.value].map(rgb);
	const track = rgb(recipe.palette.track);
	const pixel = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
	const eligible = c => Math.min(...c) < 165 && Math.max(...c) > 7 && !foreground.some(f => Math.hypot(...c.map((n, i) => n - f[i])) < 23) && Math.hypot(...c.map((n, i) => n - track[i])) > 3;
	const cols = 29;
	const rows = 9;
	const grid = [];
	for (let row = 0; row < rows; row++) {
		const line = [];
		for (let col = 0; col < cols; col++) {
			const cx = 3 + col * 824 / (cols - 1);
			const cy = 379 + row * 67 / (rows - 1);
			const samples = [];
			for (let y = Math.max(379, Math.round(cy - 7)); y <= Math.min(446, Math.round(cy + 7)); y++) {
				for (let x = Math.max(4, Math.round(cx - 16)); x <= Math.min(825, Math.round(cx + 16)); x++) {
					const c = pixel(x, y);
					if (eligible(c)) samples.push(c);
				}
			}
			line.push(samples.length ? [0, 1, 2].map(channel => median(samples.map(c => c[channel]))) : null);
		}
		// A fully covered patch has no recoverable color. Interpolate only from
		// its nearest exposed neighbors instead of sampling the foreground ink.
		const observed = line.map((c, col) => c ? col : -1).filter(col => col >= 0);
		assert(observed.length > 1, `Insufficient background samples for ${recipe.look}, row ${row}`);
		for (let col = 0; col < cols; col++) if (!line[col]) {
			const left = observed.findLast(index => index < col) ?? observed[0];
			const right = observed.find(index => index > col) ?? observed.at(-1);
			const t = left === right ? 0 : (col - left) / (right - left);
			line[col] = line[left].map((c, channel) => c + (line[right][channel] - c) * t);
		}
		grid.push(line);
	}
	let defs = "";
	let body = "";
	for (let row = 0; row < rows; row++) {
		defs += `<linearGradient id="surface-${row}" gradientUnits="userSpaceOnUse" x1="3" y1="0" x2="827" y2="0">${grid[row].map((c, col) => `<stop offset="${col / (cols - 1)}" stop-color="${color(c)}"/>`).join("")}</linearGradient>`;
	}
	for (let row = 0; row < rows - 1; row++) {
		const y = 379 + row * 67 / (rows - 1);
		const nextY = 379 + (row + 1) * 67 / (rows - 1);
		const h = nextY - y + (row === rows - 2 ? 2 : 0.04);
		defs += `<linearGradient id="surface-blend-${row}" gradientUnits="userSpaceOnUse" x1="0" y1="${y}" x2="0" y2="${nextY}"><stop stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient><mask id="surface-mask-${row}" maskUnits="userSpaceOnUse" x="3" y="${y}" width="824" height="${h}"><rect x="3" y="${y}" width="824" height="${h}" fill="url(#surface-blend-${row})"/></mask>`;
		body += `<rect x="3" y="${y}" width="824" height="${h}" fill="url(#surface-${row})"/><rect x="3" y="${y}" width="824" height="${h}" fill="url(#surface-${row + 1})" mask="url(#surface-mask-${row})"/>`;
	}
	// Keep only observed small bright points in regions the rendered text cannot
	// occupy. This does not invent the stars hidden underneath the original UI.
	let stars = "";
	if (recipe.look === "cyan-stars") {
		for (let y = 381; y < 445; y++) for (let x = 6; x < 824; x++) {
			const c = pixel(x, y);
			const sx = (x - 3) / STRIP_SCALE;
			const sy = (y - 379) / STRIP_SCALE;
			const slot = Math.floor(sx / 200);
			const local = sx % 200;
			const single = [0, 3, 5].includes(slot);
			const safe = single ? (sy < 7 || sy > 94 || local > 194 || (sy > 59 && sy < 65)) : (local > 194 || sy < 1);
			if (!safe || Math.min(...c) < 90 || Math.max(...c) - Math.min(...c) > 80) continue;
			const neighbors = [pixel(x - 1, y), pixel(x + 1, y), pixel(x, y - 1), pixel(x, y + 1)];
			if (neighbors.filter(p => Math.min(...p) > 85).length > 1) continue;
			stars += `<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.5" fill="${color(c)}"/>`;
		}
	}
	return { svg: `<defs>${defs}</defs>${body}${stars}`, samples: { columns: cols, rows, colors: grid, stars: (stars.match(/<circle/g) ?? []).length } };
}

export async function composeGallerySvg(recipe) {
	assert(LOOKS.includes(recipe.look));
	assert.equal(recipe.keys.length, 36);
	assert.equal(recipe.dials.length, 6);
	setFaceFont("tahoma");
	const palette = resolvePalette(loadThemes(), recipe.theme, null, "normal");
	assert.deepEqual(palette, recipe.palette, `${recipe.look} must use the shipped palette`);
	const original = fs.readFileSync(path.join(ROOT, recipe.source));
	if (recipe.sourceSha256) assert.equal(hash(original), recipe.sourceSha256, "Reference capture changed");
	const bg = recipe.look.endsWith("dusk") ? { svg: duskBackground(), samples: null } : await sampledBackground(recipe);
	const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" color-interpolation="sRGB"><title>${recipe.look}: production-renderer reconstruction</title><desc>Original visible readings, layout and palette. Background and graph histories reconstructed from the reference capture; not live telemetry.</desc><rect width="830" height="450" fill="#2D2D2D"/><defs><clipPath id="strip-clip"><rect x="3" y="379" width="824" height="68" rx="4"/></clipPath>`];
	for (let i = 0; i < recipe.keys.length; i++) {
		const key = recipe.keys[i];
		assert.equal(key.row, Math.floor(i / 9));
		assert.equal(key.column, i % 9);
		parts.push(`<clipPath id="key-clip-${i}"><rect x="${key.column * 94 + 3}" y="${key.row * 94 + 3}" width="72" height="72" rx="14"/></clipPath>`);
	}
	parts.push("</defs>");
	const histories = new Map();
	for (let i = 0; i < recipe.keys.length; i++) {
		const key = recipe.keys[i];
		const x = key.column * 94;
		const y = key.row * 94;
		const history = key.normalizedHistoryFromRaster;
		if (key.display === "spark") {
			assert.equal(history?.length, 36);
			assert(history.every(Number.isFinite));
			histories.set(key.sensor, history);
		}
		const svg = renderReadingKey({ label: key.label, valueText: key.valueText, unitText: key.unitText, statBadge: "", palette, ...(key.display === "spark" ? { history } : {}), ...(["bar", "ring"].includes(key.display) ? { gauge: { kind: key.display, fraction: key.gaugeFraction, zones: [] } } : {}) });
		parts.push(`<rect x="${x}" y="${y}" width="78" height="78" rx="17" fill="#474747"/><g clip-path="url(#key-clip-${i})">${nestedSvg(svg, x + 3, y + 3, 72, 72, `key${i}`)}</g>`);
	}
	parts.push(`<rect x="0" y="376" width="830" height="74" rx="7" fill="#474747"/><g clip-path="url(#strip-clip)">${bg.svg}`);
	const background = recipe.reconstructionBackgroundMode;
	const text = dialTextColors(background, palette, { mode: "theme", color: undefined, dimSecondary: false }, false);
	for (const dial of recipe.dials) {
		const common = { palette, text, background };
		const reading = sensor => {
			const [label, valueText, unitText] = recipe.values[sensor];
			return { label, valueText, unitText };
		};
		let svg;
		if (dial.view === "single") {
			const { label, valueText, unitText } = reading(dial.sensor);
			svg = renderDial({ ...common, title: label, valueText, unitText, statsText: dial.statsText, fraction: dial.fraction, barColor: palette.accent });
		} else if (dial.view === "tworow") {
			svg = renderDialTwoRow({ ...common, footerText: dial.footerText, rows: dial.sensors.map((sensor, i) => ({ ...reading(sensor), selected: i === dial.selectedRow, valueColor: text.value, unitColor: text.unit, selectedLabelColor: text.label, history: histories.get(sensor) })) });
		} else {
			assert.equal(dial.view, "overview");
			svg = renderDialOverview({ ...common, contextText: dial.contextText, statsText: dial.statsText, header: dial.header, rows: dial.sensors.map((sensor, i) => ({ ...reading(sensor), label: dial.labels?.[i] ?? reading(sensor).label.toUpperCase(), selected: i === dial.selectedRow, valueColor: text.value })) });
		}
		parts.push(nestedSvg(svg, 3 + dial.slot * 200 * STRIP_SCALE, 379, 200 * STRIP_SCALE, 100 * STRIP_SCALE, `dial${dial.slot}`));
	}
	parts.push("</g></svg>");
	const svg = parts.join("");
	assert(!/<image\b|<script\b|onload=|https?:\/\/(?!www.w3.org\/2000\/svg)/i.test(svg), "Master must be self-contained vector output");
	return { svg, backgroundSamples: bg.samples, sourceSha256: hash(original) };
}

async function main() {
	const { values } = parseArgs({ options: { out: { type: "string", default: ".gallery-render-work" }, look: { type: "string" } } });
	if (values.look) assert(LOOKS.includes(values.look), "Unknown look");
	const out = path.resolve(values.out);
	fs.mkdirSync(out, { recursive: true });
	const looks = [];
	for (const look of values.look ? [values.look] : LOOKS) {
		const fixtureFile = path.join(FIXTURES, `${look}.json`);
		const recipe = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
		const result = await composeGallerySvg(recipe);
		fs.writeFileSync(path.join(out, `${look}.svg`), result.svg);
		looks.push({ name: look, file: `${look}.svg`, width: WIDTH, height: HEIGHT, keyCount: 36, dialCount: 6, theme: recipe.theme, palette: recipe.palette, backgroundMode: recipe.reconstructionBackgroundMode, reference: recipe.source, referenceSha256: result.sourceSha256, fixture: path.relative(ROOT, fixtureFile).replaceAll("\\", "/"), fixtureSha256: hash(fs.readFileSync(fixtureFile)), svgSha256: hash(result.svg), backgroundSamples: result.backgroundSamples, limitations: recipe.limits });
		console.log(`Composed ${look}: 36 production keys, 6 production dials, 830x450 vector master`);
	}
	const renderers = ["src/ui/key-renderer.ts", "src/ui/dial-renderer.ts", "src/ui/dial-background.ts", "src/ui/face-font.ts", "src/ui/text-colors.ts", "com.lawrensen.hwinfo.sdPlugin/themes.json"].map(file => ({ file, sha256: hash(fs.readFileSync(path.join(ROOT, file))) }));
	const metadata = { schema: 1, kind: "production-renderer reconstruction", sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(), canvas: { width: WIDTH, height: HEIGHT, aspectRatio: "83:45", targetScale: 6 }, rendererFont: "Tahoma", rendererSource: renderers, note: "Values, order, palette and geometry are transcribed from original app captures. Histories, hidden settings and covered wallpaper pixels are reconstructed. These are renderer samples, not live captures or recovered telemetry. No font files are distributed.", duskModelValidation: readJson("dusk-background.json").validation, looks };
	fs.writeFileSync(path.join(out, "composition.json"), `${JSON.stringify(metadata, null, "\t")}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
