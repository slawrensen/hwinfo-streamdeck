// Production-composed fixture faces, not live measurements or hardware captures.
// node --import tsx scripts/readability-report.mjs [output-directory]
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { compose } from "../src/actions/sensor-reading";
import { composeDialSvg } from "../src/actions/sensor-dial";
import { IDLE_GESTURE } from "../src/gestures";
import { SessionStatsStore } from "../src/stats";
import { escapeXml, QUAD_DEFAULT_COLORS } from "../src/ui/key-renderer";
import { quadIdentityColor, resolveTextColors } from "../src/ui/text-colors";
import { alertValueColor, loadThemes } from "../src/ui/themes";
import { contrast } from "../test/wcag";

const output = path.resolve(process.argv[2] ?? "release/audit-evidence/sprint-06-rendered");
mkdirSync(output, { recursive: true });
const config = loadThemes();
const themes = Object.keys(config.themes);
const readings = [56.3, 65, 89, 104].map((value, i) => ({ key: `f0001234:0:100000${i}`, sensorIndex: 0, id: 0x1000000 + i, label: ["CPU Package", "CPU Core", "GPU Hot Spot", "SSD Temperature"][i], type: 1, unit: "°C", value, valueMin: value, valueMax: value, valueAvg: value }));
const snapshot = { pollTime: 1, valueRevision: 1, sensors: [{ index: 0, id: 0xf0001234, instance: 0, name: "Fixture" }], readings, byKey: new Map(readings.map((reading) => [reading.key, reading])), version: 1, revision: 2 };
const status = { state: "ok", source: "shared-memory", snapshot };
const baseKey = { readingKey: readings[0].key, secondaryReadingKey: readings[1].key, quadReadingKey3: readings[2].key, quadReadingKey4: readings[3].key, displayMode: "none" };
const rows = [
	["Normal", {}],
	["Dim", { textMode: "dim" }],
	["Quad", { keyLayout: "quad" }],
	["Dim quad", { keyLayout: "quad", textMode: "dim" }],
	["Labeled quad", { keyLayout: "quad", quadLabels: true }],
	["Warning", { warnValue: "50", critValue: "100", statMode: "max" }],
	["Critical", { warnValue: "40", critValue: "50", statMode: "max" }],
	["Dual critical", { keyLayout: "dual", warnValue: "40", critValue: "50", statMode: "max" }],
	["Triple warning", { keyLayout: "triple", warnValue: "50", critValue: "100", statMode: "max" }],
	["Quad warning", { keyLayout: "quad", quadLabels: true, warnValue: "50", critValue: "100", statMode: "max" }],
	["Ring critical", { displayMode: "ring", warnValue: "40", critValue: "50", statMode: "max" }],
	["Locale fixture", { label: "CPU 温度 Δοκιμή", keyLayout: "single" }]
];

async function sheet(file, cellWidth, cellHeight, labels, composeFace) {
	const left = 130;
	const top = 26;
	const gap = 8;
	const width = left + themes.length * (cellWidth + gap);
	const height = top + labels.length * (cellHeight + gap);
	const text = [];
	const layers = [];
	for (let col = 0; col < themes.length; col++) {
		text.push(`<text x="${left + col * (cellWidth + gap) + cellWidth / 2}" y="18" text-anchor="middle">${themes[col]}</text>`);
		for (let row = 0; row < labels.length; row++) {
			if (col === 0) text.push(`<text x="6" y="${top + row * (cellHeight + gap) + cellHeight / 2}">${escapeXml(labels[row])}</text>`);
			const svg = composeFace(themes[col], row);
			const name = `${file}-${themes[col]}-${row}`;
			writeFileSync(path.join(output, `${name}.svg`), svg);
			const png = await sharp(Buffer.from(svg)).resize(cellWidth, cellHeight).png().toBuffer();
			writeFileSync(path.join(output, `${name}.png`), png);
			layers.push({ input: png, left: left + col * (cellWidth + gap), top: top + row * (cellHeight + gap) });
		}
	}
	layers.unshift({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g font-family="Segoe UI, Arial, sans-serif" font-size="12" fill="#FFFFFF">${text.join("")}</g></svg>`), left: 0, top: 0 });
	await sharp({ create: { width, height, channels: 4, background: "#303030" } }).composite(layers).png().toFile(path.join(output, `${file}.png`));
}

await sheet("keys-72", 72, 72, rows.map(([name]) => name), (theme, row) => compose({ ...baseKey, theme, ...rows[row][1] }, status));
const dialRows = ["Single warning", "Single critical", "Overview", "Selected two-row", "Dim two-row"];
await sheet("dials-200", 200, 100, dialRows, (theme, row) => composeDialSvg({
	settings: { readingKey: readings[0].key, theme, rotationKeys: readings.map((reading) => reading.key), dialView: row < 2 ? "single" : row === 2 ? "overview" : "tworow", warnValue: row === 4 ? "200" : "50", critValue: row === 1 ? "55" : "70", alertUnit: "°C", textMode: row === 4 ? "dim" : "theme" },
	stats: new SessionStatsStore(), statMode: "current", lastFeedback: "", nextCycleAt: null, cyclePaused: false, pinned: false, gesture: IDLE_GESTURE, overlay: null, overlayTimer: null, deviceId: "fixture", pendingAlertUnitStamp: false, rowSeries: new Set()
}, status));

const matrix = themes.map((theme) => {
	const palette = config.themes[theme];
	const normal = { mode: "theme", color: undefined, dimSecondary: false };
	const dim = { ...normal, mode: "dim" };
	const text = resolveTextColors(palette, normal, "normal");
	const dimText = resolveTextColors(palette, dim, "normal");
	return {
		theme,
		normal: contrast(text.value, palette.bg),
		dim: contrast(dimText.value, palette.bg),
		unitStats: contrast(text.unit, palette.bg),
		dimUnitStats: contrast(dimText.unit, palette.bg),
		quadMin: Math.min(...QUAD_DEFAULT_COLORS.map((color) => contrast(quadIdentityColor(color, false, normal, text, palette), palette.bg))),
		dimQuadMin: Math.min(...QUAD_DEFAULT_COLORS.map((color) => contrast(quadIdentityColor(color, false, dim, dimText, palette), palette.bg))),
		dialWarn: contrast(alertValueColor(config, "warn", palette.bg), palette.bg),
		dialCrit: contrast(alertValueColor(config, "crit", palette.bg), palette.bg),
		selectedDim: contrast(resolveTextColors({ ...palette, bg: palette.track }, dim, "normal").value, palette.track),
		selectedDimUnit: contrast(resolveTextColors({ ...palette, bg: palette.track }, dim, "normal").unit, palette.track),
		selectedWarn: contrast(alertValueColor(config, "warn", palette.track), palette.track),
		selectedCrit: contrast(alertValueColor(config, "crit", palette.track), palette.track)
	};
});
writeFileSync(path.join(output, "contrast.json"), `${JSON.stringify(matrix, null, 2)}\n`);
const columns = Object.keys(matrix[0]);
writeFileSync(path.join(output, "contrast.md"), `| ${columns.join(" | ")} |\n| ${columns.map(() => "---").join(" | ")} |\n${matrix.map((row) => `| ${columns.map((key) => typeof row[key] === "number" ? row[key].toFixed(3) : row[key]).join(" | ")} |`).join("\n")}\n`);
writeFileSync(path.join(output, "README.txt"), "Synthetic measurement fixtures composed by production actions and renderers. Key PNGs are exactly 72x72 pixels; dial PNGs exactly 200x100. Contact sheets do not establish physical-device recognition or font fallback on other Windows locales. No generated asset is a marketing/live measurement claim.\n");
