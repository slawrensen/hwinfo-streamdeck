// Proof sheet for the display spec: every theme in normal/warn/crit plus two
// dials, rasterized exactly as the plugin renders them.
// Usage: npm run contact-sheet [-- <outputDir>]   (runs under tsx — imports TS)
import path from "node:path";
import sharp from "sharp";

import { renderDial, renderDialOverview, renderDialTwoRow } from "../src/ui/dial-renderer";
import { renderDualKey, renderQuadKey, renderReadingKey, renderTripleKey } from "../src/ui/key-renderer";
import { classifyTypeAccent, loadThemes, resolvePalette } from "../src/ui/themes";
import { SensorType } from "../src/hwinfo/types";

const outDir = process.argv[2] ?? ".";
const config = loadThemes();
const themes = Object.keys(config.themes);

const history = [52, 54, 53, 58, 61, 60, 64, 63, 66, 71, 69, 74, 72, 70, 75, 78, 74, 77, 80, 79, 83, 82, 85, 84, 88, 87, 86, 89, 91, 90, 92, 94, 93, 95, 97, 96];

// One representative reading per theme so the type accents all appear.
const READINGS = {
	void: { label: "CPU (Tctl/Tdie)", value: "56.3", unit: "°C", type: SensorType.Temperature },
	graphite: { label: "CPU Fan", value: "1180", unit: "RPM", type: SensorType.Fan },
	ultraviolet: { label: "Total CPU Usage", value: "37.4", unit: "%", type: SensorType.Usage },
	// Rates display as bits under the decimal data-units default (48.7 MB/s
	// reads 390 Mbps), so the showcase face shows what the runtime produces.
	midnight: { label: "Current DL rate", value: "390", unit: "Mbps", type: SensorType.Other },
	forest: { label: "Core 0 Clock", value: "5462", unit: "MHz", type: SensorType.Clock },
	ember: { label: "CPU Package Power", value: "142.8", unit: "W", type: SensorType.Power },
	paper: { label: "Vcore", value: "1.288", unit: "V", type: SensorType.Voltage }
};

const KEY = 144;
const CELL = KEY + 8;
const HEADER = 22;
// A fourth key row shows what one key can hold besides a single reading:
// the multi-readout layouts and the two bounded-value gauges. The themes rows
// above are all single faces, so without this the sheet never shows the
// layouts at all.
const FACES_ROW_Y = HEADER + 3 * CELL + 14;
// Dial slots are drawn at their real size relative to a key, not at the size
// their images happen to be. A key icon is 144x144 and a dial slot renders
// 200x100, but those are image resolutions, not glass: the touchscreen has a
// different pixel pitch, so 1x made the strip look smaller than it is.
//
// Measured off the hardware photograph (marketing/hwinfo-streamdeckxlplus.png):
// a key face is 290 photo px square and the strip is 2819 px across six slots,
// so one slot is 1.62x a key wide. That width sets the scale.
//
// The height is then whatever the render's own 2:1 aspect gives, NOT a second
// measurement. An earlier version scaled height independently to 132 to chase
// the strip's measured height, which stretched the dial art 13% taller than
// wide. Since a key is drawn unstretched, every glyph inside the dial grew
// while key glyphs did not, and the touchscreen ended up with visibly larger
// text than the keys, which is backwards from the hardware. Scaling one axis
// of a rendered face is a distortion the plugin never produces.
const DIAL_W = Math.round(KEY * 470 / 290);   // 233
const DIAL_H = Math.round(DIAL_W / 2);        // 117, the render's native 2:1
const DIAL_ROW_Y = FACES_ROW_Y + CELL + 26;
const DIAL_CELL = DIAL_W + 12;
const SHEET_W = themes.length * CELL + 8;
const SHEET_H = DIAL_ROW_Y + DIAL_H + 12;

const png = (svg) => sharp(Buffer.from(svg)).png().toBuffer();
// Dials rasterise into the measured box rather than their native 200x100.
const dialPng = (svg) => sharp(Buffer.from(svg)).resize(DIAL_W, DIAL_H, { fit: "fill" }).png().toBuffer();
const headerSvg = (name, x) =>
	`<text x="${x}" y="15" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="600" fill="#c8cdd6">${name}</text>`;

const composites = [];
const headers = [];
for (let i = 0; i < themes.length; i++) {
	const theme = themes[i];
	const reading = READINGS[theme];
	const accent = classifyTypeAccent(reading.type, reading.unit, reading.label);
	const x = i * CELL + 8;
	headers.push(headerSvg(theme, x + KEY / 2));

	const faces = [
		renderReadingKey({ label: reading.label, valueText: reading.value, unitText: reading.unit, statBadge: "", history, palette: resolvePalette(config, theme, accent, "normal") }),
		renderReadingKey({ label: reading.label, valueText: "87", unitText: reading.unit, statBadge: "", history, palette: resolvePalette(config, theme, accent, "warn") }),
		renderReadingKey({ label: reading.label, valueText: "104", unitText: reading.unit, statBadge: "MAX", palette: resolvePalette(config, theme, accent, "crit") })
	];
	for (let row = 0; row < faces.length; row++) {
		composites.push({ input: await png(faces[row]), left: x, top: HEADER + row * CELL });
	}
}

// What one key can hold: two, three and four readings, then the Bar and Ring
// displays. Same renderers the plugin runs, same Void palette throughout so
// the row reads as a shape comparison rather than a second theme sweep.
const facePalette = (accent) => resolvePalette(config, "void", accent, "normal");
const FACES = [
	{
		name: "two readings",
		svg: renderDualKey({
			top: { label: "CPU", valueText: "56.3", unitText: "°C", statBadge: "" },
			bottom: { label: "GPU", valueText: "44.1", unitText: "°C", statBadge: "" },
			palette: facePalette("temperature")
		})
	},
	{
		name: "three readings",
		svg: renderTripleKey({
			rows: [
				{ label: "CCD1", valueText: "54.5", unitText: "°C" },
				{ label: "CCD2", valueText: "47.9", unitText: "°C" },
				{ label: "Core Max", valueText: "59.4", unitText: "°C" }
			],
			palette: facePalette("temperature")
		})
	},
	{
		name: "four readings",
		svg: renderQuadKey({
			cells: [
				{ label: "CPU", valueText: "56.3", unitText: "°C", color: config.typeAccents.temperature },
				{ label: "GPU", valueText: "44.1", unitText: "°C", color: config.typeAccents.load },
				{ label: "PUMP", valueText: "1762", unitText: "RPM", color: config.typeAccents.fan },
				{ label: "PWR", valueText: "95.4", unitText: "W", color: config.typeAccents.power }
			],
			palette: facePalette("temperature")
		})
	},
	{
		name: "bar",
		svg: renderReadingKey({
			label: "Total CPU Usage", valueText: "37.4", unitText: "%", statBadge: "",
			gauge: { kind: "bar", fraction: 0.374, zones: [{ from: 0.8, to: 0.9, color: config.alerts.warn.bg }, { from: 0.9, to: 1, color: config.alerts.crit.bg }] },
			palette: facePalette("load")
		})
	},
	{
		name: "ring",
		svg: renderReadingKey({
			label: "CPU (Tctl/Tdie)", valueText: "56.3", unitText: "°C", statBadge: "",
			gauge: { kind: "ring", fraction: 0.62, zones: [{ from: 0.8, to: 0.9, color: config.alerts.warn.bg }, { from: 0.9, to: 1, color: config.alerts.crit.bg }] },
			palette: facePalette("temperature")
		})
	}
];
for (let i = 0; i < FACES.length; i++) {
	const x = i * CELL + 8;
	headers.push(`<text x="${x + KEY / 2}" y="${FACES_ROW_Y - 5}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="600" fill="#c8cdd6">${FACES[i].name}</text>`);
	composites.push({ input: await png(FACES[i].svg), left: x, top: FACES_ROW_Y });
}

// The Stream Deck + touchscreen: a single readout, both multi-row overview
// views, and a critical state. These are the wide faces, and showing them
// beside the keys at matching scale is the point of the row.
const dialPal = resolvePalette(config, "void", "temperature", "normal");
const overviewRows = [
	{ label: "CPU (Tctl/Tdie)", valueText: "56.3", unitText: "°C", selected: true, valueColor: dialPal.value },
	{ label: "GPU Temperature", valueText: "44.1", unitText: "°C", selected: false, valueColor: dialPal.value },
	{ label: "PUMP SYS1", valueText: "1762", unitText: "RPM", selected: false, valueColor: dialPal.value }
];
const trend = [52, 54, 53, 57, 60, 58, 62, 65, 63, 66, 70, 68, 71, 69, 72];
const dials = [
	["one reading", renderDial({
		title: "CPU (Tctl/Tdie)",
		valueText: "56.3",
		unitText: "°C",
		statsText: "▼ 42.0   ▲ 78.5   session",
		fraction: 0.62,
		palette: resolvePalette(config, "midnight", "temperature", "normal"),
		barColor: config.typeAccents.temperature
	})],
	["overview, three rows", renderDialOverview({
		rows: overviewRows,
		contextText: "session",
		statsText: "▼42.0 ▲78.5",
		palette: dialPal
	})],
	["overview, two rows + trend", renderDialTwoRow({
		rows: [
			{ ...overviewRows[0], history: trend },
			{ ...overviewRows[1], history: trend.map((v) => 110 - v) }
		],
		footerText: "▼ 42.0  ▲ 78.5  session",
		palette: dialPal
	})],
	["critical", renderDial({
		title: "GPU Hot Spot",
		valueText: "104",
		unitText: "°C · MAX",
		statsText: "▼ 61.0   ▲ 104.0   session",
		fraction: 0.97,
		palette: resolvePalette(config, "void", "temperature", "normal"),
		barColor: config.alerts.crit.bg
	})]
];
for (let i = 0; i < dials.length; i++) {
	const x = 8 + i * DIAL_CELL;
	headers.push(`<text x="${x + DIAL_W / 2}" y="${DIAL_ROW_Y - 7}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="600" fill="#c8cdd6">${dials[i][0]}</text>`);
	composites.push({ input: await dialPng(dials[i][1]), left: x, top: DIAL_ROW_Y });
}

const base = `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_W}" height="${SHEET_H}"><rect width="${SHEET_W}" height="${SHEET_H}" fill="#101013"/>${headers.join("")}</svg>`;
const file = path.join(outDir, "contact-sheet.png");
await sharp(Buffer.from(base)).composite(composites).png().toFile(file);
console.log(`Rendered ${themes.length}×3 keys + ${FACES.length} layout/gauge faces + ${dials.length} touchscreen faces to ${file}`);
