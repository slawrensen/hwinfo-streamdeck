// Documentation boards from unchanged production composition. No live reads.
// Usage: npx tsx scripts/docs-v17-images.mjs [outDir=docs/assets/img]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { composeDialSvg } from "../src/actions/sensor-dial";
import { renderStatusKey } from "../src/ui/key-renderer";
import { statusScreen } from "../src/ui/state-screens";
import { applyGlobalThemeSettings } from "../src/ui/theme-store";
import { dialGalleryFixture } from "./lib/dial-gallery";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] ?? path.join(root, "docs/assets/img"));
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
mkdirSync(out, { recursive: true });
const globals = { theme: "void", textMode: "theme", typeAccents: "off" };
applyGlobalThemeSettings(globals);
const colors = { "31:0:1": "#4CC2FF", "31:0:2": "#FF7E8E", "31:0:3": "#38CD89", "31:0:4": "#D4AB33", "31:0:5": "#4CC2FF" };
const text = (x, y, size, content, fill = "#EDF0F5") => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}">${content}</text>`;
const board = (width, height, content) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#111318"/><g font-family="Segoe UI, Arial">${content}</g></svg>`);
const raster = (svg, width, height) => sharp(Buffer.from(svg), { density: 216 }).resize(width, height).png().toBuffer();
const assets = [];
const save = async (name, background, layers, evidence) => {
	const file = path.join(out, name);
	await sharp(background).composite(layers).png().toFile(file);
	const metadata = await sharp(file).metadata();
	assets.push({ file: name, width: metadata.width, height: metadata.height, sha256: createHash("sha256").update(readFileSync(file)).digest("hex"), ...evidence });
	console.log(`wrote ${file} (${metadata.width}x${metadata.height})`);
};

const layers = [];
const scenarios = [];
for (const [row, view] of ["overview", "tworow"].entries()) {
	const fixture = dialGalleryFixture(view);
	const outputs = [];
	for (const [column, custom] of [false, true].entries()) {
		const settings = { ...fixture.state.settings, ...(custom ? { readingColors: colors } : {}) };
		const svg = composeDialSvg({ ...fixture.state, settings }, { state: "ok", snapshot: fixture.snapshot, source: "shared-memory" }, fixture.historyOf);
		outputs.push(svg);
		layers.push({ input: await raster(svg, 600, 300), left: 40 + column * 660, top: 156 + row * 342 });
		scenarios.push({ view, individualColors: custom, settings, readings: fixture.snapshot.readings, histories: Object.fromEntries(fixture.snapshot.readings.map((r) => [r.key, fixture.historyOf(r.key)])), svgSha256: createHash("sha256").update(svg).digest("hex") });
	}
	// The opt-in may change numeric fills only. Labels, units, graph paths,
	// selection, footer and every geometric attribute must remain identical.
	const withoutFills = (svg) => svg.replace(/fill="#[\da-f]{6}"/gi, 'fill="COLOR"');
	assert.equal(withoutFills(outputs[0]), withoutFills(outputs[1]));
}
await save("dial-reading-colors-1.7.png", board(1340, 884,
	text(40, 43, 28, "Individual reading colors") + text(1300, 42, 18, `HWiNFO Sensors ${version}`, "#A7AFBE").replace('x="1300"', 'x="1300" text-anchor="end"') +
	text(40, 79, 20, "The same readings, values and layouts. Only the number colors change.", "#A7AFBE") +
	text(40, 132, 23, "Automatic") + text(700, 132, 23, "Individual colors") +
	text(40, 842, 18, "Production renderer with fixed sample data. Void theme · Text: Theme · Type accents: Off", "#A7AFBE")), layers,
	{ kind: "production-renderer board", source: "src/actions/sensor-dial.ts: composeDialSvg", sampleData: true, globals, scenarios, validation: "SVGs match exactly after removing hexadecimal fill colors." });

const fixture = dialGalleryFixture("overview");
const statusItems = [
	{ title: "Source busy", detail: "The plugin retries automatically.", status: { state: "unavailable", reason: "busy", message: "" } },
	{ title: "No new Shared Memory data", detail: "Check HWiNFO and Shared Memory Support.", status: { state: "stale", snapshot: fixture.snapshot, source: "shared-memory", staleForMs: 20_000 } },
	{ title: "Gadget freshness unknown", detail: "Check HWiNFO and Gadget reporting.", status: { state: "stale", snapshot: fixture.snapshot, source: "gadget", staleForMs: 20_000 } }
];
const statusLayers = [];
let statusText = text(40, 44, 28, "When the source needs attention") + text(40, 78, 19, `HWiNFO Sensors ${version} · Production status screens · Sample scenarios`, "#A7AFBE");
for (const [i, { title, detail, status }] of statusItems.entries()) {
	const x = 40 + i * 440;
	statusText += text(x, 130, 22, title) + text(x, 164, 17, detail, "#A7AFBE");
	statusLayers.push({ input: await raster(renderStatusKey(statusScreen(status)), 240, 240), left: x + 80, top: 195 });
	statusLayers.push({ input: await raster(composeDialSvg(fixture.state, status, fixture.historyOf), 400, 200), left: x, top: 459 });
}
await save("reading-status-1.7.png", board(1360, 704, statusText), statusLayers,
	{ kind: "production-renderer board", source: ["src/ui/state-screens.ts: statusScreen", "src/ui/key-renderer.ts: renderStatusKey", "src/actions/sensor-dial.ts: composeDialSvg"], sampleData: true, globals, scenarios: statusItems.map(({ title, status }) => ({ title, state: status.state, reason: status.reason, source: status.source, staleForMs: status.staleForMs })) });

writeFileSync(path.join(out, "renderer-images-1.7.provenance.json"), `${JSON.stringify({ version, command: "npx tsx scripts/docs-v17-images.mjs", note: "Boards use fixed sample data and the production renderers without any art or color overrides. They are not physical hardware captures.", assets }, null, "\t")}\n`);
