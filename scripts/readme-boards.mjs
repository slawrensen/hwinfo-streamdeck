// Builds the README's boards. GitHub shows a README about 830 px wide, where
// the long docs strips shrink each key to roughly 85 px, so every board here is
// laid out for that column on a rounded panel.
//
// The hero, the dial board and the themes board render through the production
// key and dial renderers from fixed sample values (the readings on the
// maintainer's deck), so they need no HWiNFO and are byte-stable. The keys,
// details and status boards are cut from the docs boards in docs/assets/img
// and not redrawn: rerun this after `npm run docs-shots` changes one of those.
//   npm run readme-boards [-- outDir=.github/readme]
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { renderDial, renderDialOverview, renderDialTwoRow } from "../src/ui/dial-renderer.ts";
import { renderDualKey, renderQuadKey, renderReadingKey, renderTripleKey } from "../src/ui/key-renderer.ts";
import { loadThemes, resolvePalette } from "../src/ui/themes.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const img = (name) => path.join(repoRoot, "docs", "assets", "img", name);
const outDir = process.argv[2] ?? path.join(repoRoot, ".github", "readme");
mkdirSync(outDir, { recursive: true });

const config = loadThemes();
const pal = (theme, accent = null, level = "normal") => resolvePalette(config, theme, accent, level);
const ZONES = [{ from: 0.8, to: 0.9, color: config.alerts.warn.bg }, { from: 0.9, to: 1, color: config.alerts.crit.bg }];

// The docs boards' own background, so cut tiles keep their edges.
const PANEL = { r: 0x11, g: 0x13, b: 0x17, alpha: 1 };
const RADIUS = 28;
const PAD = 32;
const GAP = 24;
const FONT = `font-family="Segoe UI, Arial"`;

// ---------- rasterizing ----------

const rounded = (w, h, r) => Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`);

/** A 144 px key face at `size`, corners rounded as the hardware masks them. */
const keyPng = (svg, size) =>
	sharp(Buffer.from(svg.replace(`width="144" height="144"`, `width="${size}" height="${size}"`)))
		.png()
		.composite([{ input: rounded(size, size, Math.round((size * 26) / 288)), blend: "dest-in" }])
		.png()
		.toBuffer();

/** A 200x100 dial face at `w` x `w/2`. */
const dialPng = (svg, w) =>
	sharp(Buffer.from(svg.replace(`width="200" height="100"`, `width="${w}" height="${w / 2}"`)))
		.png()
		.composite([{ input: rounded(w, w / 2, Math.round((w * 12) / 400)), blend: "dest-in" }])
		.png()
		.toBuffer();

const text = (w, h, x, y, anchor, size, body) => Buffer.from(`<svg width="${w}" height="${h}"><text x="${x}" y="${y}" text-anchor="${anchor}" ${FONT} font-size="${size}" fill="#9aa1ad">${body}</text></svg>`);
const strong = (s) => `<tspan font-weight="600" fill="#e6e8ec">${s}</tspan>`;

/** Writes free-placed layers onto a rounded W x H panel. */
async function writePanel(outName, W, H, layers) {
	const file = path.join(outDir, outName);
	await sharp({ create: { width: W, height: H, channels: 4, background: PANEL } })
		.composite([...layers, { input: rounded(W, H, RADIUS), blend: "dest-in" }])
		.png({ compressionLevel: 9 })
		.toFile(file);
	console.log(`wrote ${path.relative(repoRoot, file)} (${W}x${H})`);
}

/** Uniform tiles row by row; a short row centres under the full ones. */
async function gridPanel(outName, rows, { tileW, tileH }) {
	const cols = Math.max(...rows.map((r) => r.length));
	const W = 2 * PAD + cols * tileW + (cols - 1) * GAP;
	const H = 2 * PAD + rows.length * tileH + (rows.length - 1) * GAP;
	const layers = [];
	rows.forEach((row, r) => {
		const inset = ((cols - row.length) * (tileW + GAP)) / 2;
		row.forEach((input, c) => layers.push({ input, left: Math.round(PAD + inset + c * (tileW + GAP)), top: PAD + r * (tileH + GAP) }));
	});
	await writePanel(outName, W, H, layers);
}

// ---------- sample faces ----------

// A gentle drift with seeded jitter, so every sparkline differs and reruns match.
function history(seed, from, to, n = 36) {
	let x = seed * 9301 + 49297;
	return Array.from({ length: n }, (_, i) => {
		x = (x * 9301 + 49297) % 233280;
		return from + ((to - from) * i) / (n - 1) + (x / 233280 - 0.5) * Math.abs(to - from || from * 0.05) * 0.5;
	});
}

const spark = (palette, label, valueText, unitText, seed, from, to) => renderReadingKey({ label, valueText, unitText, statBadge: "", history: history(seed, from, to), palette });
const gauge = (palette, label, valueText, unitText, kind, fraction) => renderReadingKey({ label, valueText, unitText, statBadge: "", gauge: { kind, fraction, zones: ZONES }, palette });
const single = (palette, title, value, unit, min, max, fraction, barColor = palette.accent) =>
	renderDial({ title, valueText: value, unitText: unit, statsText: `▼ ${min}   ▲ ${max}   session`, fraction, palette, barColor });
const threeRows = (palette, rows, selected, stats, colors = []) =>
	renderDialOverview({
		rows: rows.map(([label, valueText, unitText], i) => ({ label, valueText, unitText, selected: i === selected, valueColor: colors[i] ?? palette.value })),
		contextText: "session",
		statsText: stats,
		palette
	});
const twoRows = (palette, rows, footer) =>
	renderDialTwoRow({
		rows: rows.map(([label, valueText, unitText, h], i) => ({ label, valueText, unitText, selected: i === 0, valueColor: palette.value, history: h })),
		footerText: footer,
		palette
	});

const THEMES = ["void", "graphite", "ultraviolet", "midnight", "forest", "ember", "paper"];
const titleCase = (id) => id[0].toUpperCase() + id.slice(1);

// ---------- hero: a Stream Deck + XL's 9x4 keys and six-dial strip ----------

// Columns one to seven are one theme each with type accents off, so each
// shows its own signal color; then the multi-reading layouts; then the gauges
// and both alert states. The strip spans the key block at the + XL's own
// proportion, six 2:1 segments.
async function hero() {
	const K = 192;
	const G = 16;
	const rows = [
		{ unit: "°C", labels: ["CPU (Tctl/Tdie)", "CPU Die (avg)", "CPU CCD1", "CPU CCD2", "Core 0", "GPU Temp", "Core 2"], values: ["59.0", "58.2", "52.5", "45.3", "44.9", "45.8", "52.3"], range: [48, 60] },
		{ unit: "MHz", labels: ["Core 0 Clock", "Core 1 Clock", "Core 2 Clock", "Core 3 Clock", "Core 4 Clock", "Core 5 Clock", "Core 6 Clock"], values: ["5625", "5625", "5625", "5625", "5625", "5625", "5388"], range: [4800, 5600] },
		{ unit: "%", labels: ["Core 0 Usage", "Core 1 Usage", "Core 2 Usage", "Core 3 Usage", "Core 4 Usage", "Core 5 Usage", "Core 6 Usage"], values: ["12.5", "0.77", "14.8", "13.3", "11.7", "59.7", "3.13"], range: [4, 14] },
		{ unit: "V", labels: ["Core 0 VID", "Core 1 VID", "Core 2 VID", "Core 3 VID", "Core 4 VID", "Core 5 VID", "Core 6 VID"], values: ["1.22", "1.25", "1.25", "1.23", "1.23", "1.23", "1.23"], range: [1.1, 1.24] }
	];
	const grid = rows.map((row, r) => THEMES.map((theme, c) => spark(pal(theme), row.labels[c], row.values[c], row.unit, r * 7 + c + 1, row.range[0], row.range[1])));
	grid[0].push(
		renderTripleKey({ rows: [{ label: "CCD1", valueText: "52.5", unitText: "°C" }, { label: "CCD2", valueText: "45.3", unitText: "°C" }, { label: "Core Max", valueText: "59.0", unitText: "°C" }], palette: pal("void", "temperature") }),
		gauge(pal("void", "load"), "Total CPU Usage", "10.0", "%", "ring", 0.1)
	);
	grid[1].push(
		renderQuadKey({
			cells: [
				{ label: "", valueText: "59.0", unitText: "°C", color: config.typeAccents.temperature },
				{ label: "", valueText: "45.8", unitText: "°C", color: config.typeAccents.load },
				{ label: "", valueText: "1796", unitText: "RPM", color: config.typeAccents.fan },
				{ label: "", valueText: "90.8", unitText: "W", color: config.typeAccents.power }
			],
			palette: pal("void", "temperature")
		}),
		gauge(pal("void", "power"), "GPU Power", "41.6", "W", "bar", 0.46)
	);
	grid[2].push(
		renderDualKey({ top: { label: "GPU Hot Max", valueText: "55.4", unitText: "°C", statBadge: "" }, bottom: { label: "CPU", valueText: "59.0", unitText: "°C", statBadge: "" }, palette: pal("void", "temperature") }),
		renderReadingKey({ label: "VRM MOS", valueText: "88.4", unitText: "°C", statBadge: "", history: history(91, 70, 88), palette: pal("void", "temperature", "warn") })
	);
	grid[3].push(
		gauge(pal("void", "memory"), "Physical Memory", "20.4", "GB", "bar", 0.32),
		renderReadingKey({ label: "GPU Hot Spot", valueText: "104", unitText: "°C", statBadge: "MAX", palette: pal("void", "temperature", "crit") })
	);

	const blockW = 9 * K + 8 * G;
	const DW = Math.floor((blockW - 5 * G) / 6 / 2) * 2;
	const strip = [
		single(pal("void", "memory"), "Physical Memory", "20.4", "GB", "20.0GB", "32.4GB", 0.63),
		twoRows(pal("ember"), [["DIMM 1", "40.1", "°C", history(3, 37, 40, 15)], ["DIMM 2", "39.3", "°C", history(4, 36, 39, 15)]], "▼ 36.8  ▲ 41.3  session"),
		twoRows(pal("forest"), [["12VHPWR Power", "41.6", "W", history(5, 30, 42, 15)], ["Temperature", "45.8", "°C", history(6, 40, 46, 15)]], "▼ 26.8  ▲ 159  GPU"),
		single(pal("paper"), "CPU Package Power", "90.8", "W", "81.7", "150", 0.13),
		single(pal("ultraviolet"), "PSU Power In", "258", "W", "187", "340", 0.46),
		threeRows(pal("midnight"), [["CPU Fan", "995", "RPM"], ["Pump", "1791", "RPM"], ["Rear Fan", "812", "RPM"]], 1, "▼1772 ▲1801")
	];

	const stripTop = PAD + 4 * K + 3 * G + 3 * G;
	const W = 2 * PAD + blockW;
	const H = stripTop + DW / 2 + PAD;
	const layers = [];
	for (let r = 0; r < 4; r++) for (let c = 0; c < 9; c++) layers.push({ input: await keyPng(grid[r][c], K), left: PAD + c * (K + G), top: PAD + r * (K + G) });
	for (let i = 0; i < 6; i++) layers.push({ input: await dialPng(strip[i], DW), left: PAD + i * (DW + G), top: stripTop });
	await writePanel("hero.png", W, H, layers);
}

// ---------- themes: every theme, its accents, and the alert override ----------

// Row one is the default look (type accents on, one sensor type per column);
// row two the same themes with type accents off, on the other displays;
// row three the alert palettes, which never tint per theme: keys flip the
// whole face, dials flip the bar or the alerting row's value. Dials sit at
// the Stream Deck +'s own proportion, a segment about 1.7 keys wide.
async function themes() {
	const K = 288;
	const HEAD = 52;
	const CAP = 48;
	const accentsOn = [
		spark(pal("void", "temperature"), "CPU (Tctl/Tdie)", "59.0", "°C", 11, 50, 60),
		spark(pal("graphite", "fan"), "CPU Fan", "995", "RPM", 12, 900, 1000),
		spark(pal("ultraviolet", "load"), "Total CPU Usage", "37.4", "%", 13, 20, 38),
		spark(pal("midnight", "network"), "Current DL rate", "390", "Mbps", 14, 120, 390),
		spark(pal("forest", "clock"), "Core 0 Clock", "5625", "MHz", 15, 4800, 5600),
		spark(pal("ember", "power"), "CPU Package Power", "90.8", "W", 16, 60, 92),
		spark(pal("paper", "temperature"), "Vcore", "1.288", "V", 17, 1.2, 1.29)
	];
	const accentsOff = [
		gauge(pal("void"), "CPU (Tctl/Tdie)", "59.0", "°C", "ring", 0.59),
		gauge(pal("graphite"), "GPU Power", "41.6", "W", "bar", 0.46),
		renderTripleKey({ rows: [{ label: "CCD1", valueText: "52.5", unitText: "°C" }, { label: "CCD2", valueText: "45.3", unitText: "°C" }, { label: "Core Max", valueText: "59.0", unitText: "°C" }], palette: pal("ultraviolet") }),
		renderDualKey({ top: { label: "Download", valueText: "390", unitText: "Mbps", statBadge: "" }, bottom: { label: "Upload", valueText: "41.2", unitText: "Mbps", statBadge: "" }, palette: pal("midnight") }),
		spark(pal("forest"), "Pump", "1791", "RPM", 18, 1760, 1800),
		gauge(pal("ember"), "PSU Power In", "258", "W", "ring", 0.46),
		gauge(pal("paper"), "Total CPU Usage", "37.4", "%", "bar", 0.37)
	];

	const blockW = 7 * K + 6 * GAP;
	const DW = Math.floor((blockW - 2 * (K + GAP) - 2 * GAP) / 3 / 2) * 2;
	const alertDials = [
		single(pal("ultraviolet"), "VRM MOS", "88.4", "°C", "51.2", "88.4", 0.9, config.alerts.warn.bg),
		single(pal("forest"), "GPU Hot Spot", "104", "°C · MAX", "61.0", "104", 0.97, config.alerts.crit.bg),
		threeRows(pal("midnight"), [["CPU Die", "86.1", "°C"], ["GPU Temp", "45.8", "°C"], ["DIMM 2", "39.3", "°C"]], 0, "▼42.6 ▲86.1", [config.alerts.warn.bg])
	];

	const W = 2 * PAD + blockW;
	const row1 = PAD + HEAD + CAP;
	const row2 = row1 + K + GAP + CAP;
	const row3 = row2 + K + GAP + CAP;
	const H = row3 + K + PAD;
	const layers = [];
	const caption = (top, body) => layers.push({ input: text(blockW, CAP, 4, 32, "start", 24, body), left: PAD, top });
	for (let c = 0; c < 7; c++) layers.push({ input: text(K, HEAD, K / 2, 34, "middle", 28, strong(titleCase(THEMES[c]))), left: PAD + c * (K + GAP), top: PAD });
	caption(row1 - CAP, `${strong("Type accents on")} (default): each graph takes its sensor type's color; Paper keeps its ink`);
	caption(row2 - CAP, `${strong("Type accents off")}: each theme's own signal color`);
	caption(row3 - CAP, `${strong("Alerts")} look the same on every theme: keys flip the whole face, dials the bar or the row`);
	for (let c = 0; c < 7; c++) {
		layers.push({ input: await keyPng(accentsOn[c], K), left: PAD + c * (K + GAP), top: row1 });
		layers.push({ input: await keyPng(accentsOff[c], K), left: PAD + c * (K + GAP), top: row2 });
	}
	layers.push({ input: await keyPng(renderReadingKey({ label: "VRM MOS", valueText: "88.4", unitText: "°C", statBadge: "", history: history(19, 70, 88), palette: pal("void", "temperature", "warn") }), K), left: PAD, top: row3 });
	layers.push({ input: await keyPng(renderReadingKey({ label: "GPU Hot Spot", valueText: "104", unitText: "°C", statBadge: "MAX", palette: pal("void", "temperature", "crit") }), K), left: PAD + K + GAP, top: row3 });
	const dialsLeft = PAD + 2 * (K + GAP);
	for (let i = 0; i < 3; i++) layers.push({ input: await dialPng(alertDials[i], DW), left: dialsLeft + i * (DW + GAP), top: row3 + Math.round((K - DW / 2) / 2) });
	await writePanel("themes.png", W, H, layers);
}

// ---------- dials: every theme on the touchscreen ----------

// Void keeps the default type accents; the others run with type accents off,
// so each shows its own signal color. Alerts recolor only the bar.
const CAPTION = 56;
async function captionedDial(svg, theme, view) {
	return sharp({ create: { width: 400, height: 200 + CAPTION, channels: 4, background: PANEL } })
		.composite([
			{ input: await dialPng(svg, 400), left: 0, top: 0 },
			{ input: text(400, CAPTION, 200, 38, "middle", 26, `${strong(theme)} · ${view}`), left: 0, top: 200 }
		])
		.png()
		.toBuffer();
}

async function dials() {
	const tiles = [
		["Void", "one reading", single(pal("void", "temperature"), "CPU (Tctl/Tdie)", "59.0", "°C", "42.6", "71.3", 0.58)],
		["Ultraviolet", "two rows", twoRows(pal("ultraviolet"), [["CPU Package Power", "90.8", "W", history(21, 62, 91, 15)], ["12VHPWR Power", "41.6", "W", history(22, 48, 40, 15)]], "▼ 81.7  ▲ 150  session")],
		["Forest", "three rows", threeRows(pal("forest"), [["CPU Fan", "995", "RPM"], ["Pump", "1791", "RPM"], ["Rear Fan", "812", "RPM"]], 1, "▼1772 ▲1801")],
		["Midnight", "three rows", threeRows(pal("midnight"), [["CPU Die", "58.2", "°C"], ["GPU Temp", "45.8", "°C"], ["DIMM 2", "39.3", "°C"]], 0, "▼42.6 ▲71.3")],
		["Ember", "one reading", single(pal("ember"), "PSU Power In", "258", "W", "187", "340", 0.47)],
		["Graphite", "two rows", twoRows(pal("graphite"), [["Physical Memory", "20.4", "GB", history(23, 19.6, 20.4, 15)], ["Total CPU Usage", "10.0", "%", history(24, 14, 10, 15)]], "▼ 20.0  ▲ 32.4  session")],
		["Paper", "one reading", single(pal("paper"), "Core 0 Clock", "5625", "MHz", "3012", "5750", 0.95)],
		["Graphite", "warn", single(pal("graphite"), "VRM MOS", "88.4", "°C", "51.2", "88.4", 0.9, config.alerts.warn.bg)],
		["Void", "critical", single(pal("void", "temperature"), "GPU Hot Spot", "104", "°C · MAX", "61.0", "104", 0.97, config.alerts.crit.bg)]
	];
	const faces = [];
	for (const [theme, view, svg] of tiles) faces.push(await captionedDial(svg, theme, view));
	await gridPanel("dials.png", [faces.slice(0, 3), faces.slice(3, 6), faces.slice(6)], { tileW: 400, tileH: 200 + CAPTION });
}

// ---------- boards cut from the docs images ----------

const crop = (file, left, top, width, height) => sharp(file).extract({ left, top, width, height }).png().toBuffer();

// 288 px keys with their 30 px caption, from two boards on gen-docs-shots' key
// geometry (20 px gaps, 308 px pitch): the single-reading displays from
// display-text.png and the multi-reading layouts from multi-readouts.png.
async function keys() {
	const tile = (file, i) => crop(img(file), 20 + i * 308, 20, 288, 322);
	await gridPanel(
		"keys.png",
		[
			[await tile("display-text.png", 0), await tile("display-text.png", 2), await tile("display-text.png", 3)],
			[await tile("multi-readouts.png", 0), await tile("multi-readouts.png", 3), await tile("multi-readouts.png", 4)]
		],
		{ tileW: 288, tileH: 322 }
	);
}

// Boards that already fit the column get the rounded panel, unscaled.
async function reframe(source, outName) {
	const { width, height } = await sharp(img(source)).metadata();
	await gridPanel(outName, [[await sharp(img(source)).png().toBuffer()]], { tileW: width, tileH: height });
}

await hero();
await keys();
await dials();
await themes();
await reframe("detail-view.png", "details.png");
await reframe("status-screens.png", "status.png");
