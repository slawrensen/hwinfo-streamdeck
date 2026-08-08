// Marketplace listing stills (1920×960 per Elgato's product guidelines:
// thumbnail + gallery are 1920×960 PNG; 1920×1080 is the VIDEO spec), composed
// from the plugin's own renderers with live HWiNFO values — the marketing art
// IS the product output. Emits gallery shots 1/3/5 (+4 with a capture dir; shot 2 is the hardware photo board from scripts/shot2-hardware.mjs)
// and a dedicated thumbnail.png.
// Usage: npx tsx scripts/marketplace-shots.mjs <outputDir> [piCaptureDir]
import path from "node:path";
import sharp from "sharp";

import { composeBackFace, composePagerFace, composeReadingFace, composeTitleFace } from "../src/detail/detail-faces";
import { pageOf, resolveDetailGroup } from "../src/detail/detail-group";
import { DETAIL_PROFILES } from "../src/detail/managed-profiles";
import { effectiveTextSettings, parseTextSettings } from "../src/ui/text-colors";
import { renderDial, renderDialOverview, renderDialTwoRow } from "../src/ui/dial-renderer";
import { QUAD_DEFAULT_COLORS, renderDualKey, renderQuadKey, renderReadingKey, renderTripleKey } from "../src/ui/key-renderer";
import { formatValue } from "../src/ui/format";
import { SharedMemoryProvider } from "../src/hwinfo/provider";
import { classifyTypeAccent, loadThemes, resolvePalette } from "../src/ui/themes";

const outDir = process.argv[2] ?? "marketing";
const config = loadThemes();

// ---------- live data ----------
const provider = SharedMemoryProvider.open();
const snapshot = provider.read();
if (snapshot === null) {
	throw new Error("shared memory mid-update — rerun");
}
const byKey = (key) => {
	const r = snapshot.byKey.get(key);
	if (r === undefined) {
		throw new Error(`reading ${key} missing`);
	}
	return r;
};

/** Deterministic pseudo-history: a walk inside [min,max] ending at `end`. */
function walk(seedStr, min, max, end, n = 36) {
	let s = 0;
	for (let i = 0; i < seedStr.length; i++) {
		s = (s * 31 + seedStr.charCodeAt(i)) >>> 0;
	}
	const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
	const span = Math.max(max - min, Math.abs(end) * 0.05, 1);
	const out = [];
	let v = end - span * 0.25 + rnd() * span * 0.2;
	for (let i = 0; i < n - 1; i++) {
		v += (rnd() - 0.48) * span * 0.14;
		v = Math.max(min, Math.min(max, v));
		out.push(v);
	}
	out.push(end);
	return out;
}

// ---------- svg helpers (design-spec chrome) ----------
const FONT = "Segoe UI, Arial, sans-serif";
const MONO = "Cascadia Code, Consolas, monospace";
const esc = (t) => t.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);

/** Rasterizes an SVG string at an integer scale (crisp vector upscale). */
function rasterize(svg, scale, w, h) {
	const scaled = svg.replace(`width="${w}" height="${h}"`, `width="${w * scale}" height="${h * scale}"`);
	return sharp(Buffer.from(scaled)).png().toBuffer();
}

/** Rounded-corner mask + rim, like the spec's key mockups. */
async function roundedKey(svg, size, radius, rim) {
	const png = await rasterize(svg, size / 144, 144, 144);
	const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#fff"/></svg>`);
	const rimSvg = Buffer.from(`<svg width="${size}" height="${size}"><rect x="0.5" y="0.5" width="${size - 1}" height="${size - 1}" rx="${radius}" fill="none" stroke="${rim}" stroke-width="1"/></svg>`);
	return sharp(png)
		.composite([
			{ input: mask, blend: "dest-in" },
			{ input: rimSvg, blend: "over" }
		])
		.png()
		.toBuffer();
}

/** Still-image canvas per current Elgato marketplace guidelines. */
const W = 1920;
const H = 960;

const PAGE_BG = "#0B0C0E";
const CARD_BG = "#101116";
const CARD_BORDER = "#1D2026";
const HEADLINE = "#EDEFF4";
const BODY = "#A9AFBC";
const MUTED = "#6B7280";
const CYAN = "#4CC2FF";

function pageBase(w, h, elements) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${PAGE_BG}"/>${elements.join("")}</svg>`;
}

// ---------- key face builders ----------
function face({ key, label, level = "normal", forceValue, statBadge = "", spark = true, theme = "void", fahrenheitLabel, accents = true }) {
	const r = byKey(key);
	const value = forceValue ?? r.value;
	// accents:false is the deck's "Type accents: off" setting, where the
	// theme's own accent colors the line instead of the sensor's type.
	const accent = accents ? classifyTypeAccent(r.type, r.unit, r.label) : null;
	const palette = resolvePalette(config, theme, accent, level);
	return renderReadingKey({
		label: label ?? r.label,
		valueText: formatValue(value, "auto"),
		unitText: fahrenheitLabel ?? r.unit,
		statBadge,
		history: spark ? walk(key + (label ?? ""), Math.min(r.valueMin, value), Math.max(r.valueMax, value), value) : undefined,
		palette
	});
}

// The live showcase sensors (mirrors the deck's page 2).
const K = {
	cpuTemp: "f0000501:0:1000000",
	ccd1: "f0000501:0:1000008",
	cpuPower: "f0000501:0:5000000",
	coreClock: "f0000300:0:600001c",
	cpuLoad: "f0000300:0:7000021",
	memLoad: "f0000301:0:8000005",
	gpuTemp: "e0002000:0:1000000",
	gpuHot: "e0002000:0:1000005",
	gpuPower: "e0002000:0:5000000",
	gpuLoad: "e0002000:0:7000000",
	vram: "e0002000:0:80000fc",
	pump: "f7006687:0:3000001",
	cpuFan: "f7006687:0:3000000",
	netDown: "f000ea00:0:8000002",
	netUp: "f000ea00:0:8000003"
};

// ---------- the multi-reading layouts, shared by the hero, thumbnail and shot 6 ----------
const multiPalette = (key, level = "normal") => {
	const r = byKey(key);
	return resolvePalette(config, "void", classifyTypeAccent(r.type, r.unit, r.label), level);
};
const multiValue = (key, forced) => formatValue(forced ?? byKey(key).value, "auto");
/** The three-row rotation overview: the same "more than one reading"
 *  argument on the touchscreen, shared by the hero and the thumbnail. */
function dialThreeRow() {
	const mk = (key, label, forced) => {
		const r = byKey(key);
		return {
			label,
			valueText: formatValue(forced ?? r.value, "auto"),
			unitText: r.unit,
			selected: label === "CPU Temp",
			valueColor: multiPalette(key).accent
		};
	};
	return renderDialOverview({
		rows: [mk(K.cpuTemp, "CPU Temp", 71.4), mk(K.gpuTemp, "GPU Temp", 76.2), mk(K.pump, "Pump")],
		contextText: "Loop",
		statsText: "▼ 51.0 ▲ 79.0",
		palette: multiPalette(K.cpuTemp)
	});
}

/** Two rows with a sparkline each: the middle density on the touchscreen. */
function dialTwoRow() {
	const mk = (key, label, forced) => {
		const r = byKey(key);
		const value = forced ?? r.value;
		return {
			label,
			valueText: formatValue(value, "auto"),
			unitText: r.unit,
			selected: label === "GPU Power",
			valueColor: multiPalette(key).accent,
			history: walk(key + label, Math.min(r.valueMin, value), Math.max(r.valueMax, value), value)
		};
	};
	return renderDialTwoRow({
		rows: [mk(K.gpuPower, "GPU Power", 316.4), mk(K.gpuLoad, "GPU Load", 98)],
		footerText: "▼ 64.5 ▲ 349 session",
		palette: multiPalette(K.gpuPower)
	});
}

/** The single view, kept alongside so the range bar and session stats show. */
function dialSingle() {
	const r = byKey(K.gpuHot);
	return renderDial({
		title: "GPU Hot Spot",
		valueText: formatValue(106.2, "auto"),
		unitText: "°C · MAX",
		statsText: `▼ ${formatValue(r.valueMin, "auto")}   ▲ 106.2   session`,
		fraction: 0.97,
		palette: multiPalette(K.gpuHot),
		barColor: config.alerts.crit.bg
	});
}

const multi = {
	dual: renderDualKey({
		top: { label: "CPU", valueText: multiValue(K.cpuTemp, 71.4), unitText: "°C", statBadge: "" },
		bottom: { label: "GPU", valueText: multiValue(K.gpuTemp, 76.2), unitText: "°C", statBadge: "" },
		palette: multiPalette(K.cpuTemp)
	}),
	triple: renderTripleKey({
		rows: [
			{ label: "CCD1", valueText: multiValue(K.ccd1, 66.9), unitText: "°C" },
			{ label: "CCD2", valueText: multiValue(K.cpuTemp, 64.1), unitText: "°C" },
			{ label: "Core Max", valueText: multiValue(K.cpuTemp, 71.4), unitText: "°C" }
		],
		palette: multiPalette(K.cpuTemp)
	}),
	quad: renderQuadKey({
		cells: [
			{ label: "CPU", valueText: multiValue(K.cpuTemp, 71.4), unitText: "°C", color: QUAD_DEFAULT_COLORS[0] },
			{ label: "GPU", valueText: multiValue(K.gpuTemp, 76.2), unitText: "°C", color: QUAD_DEFAULT_COLORS[1] },
			{ label: "PUMP", valueText: multiValue(K.pump), unitText: "RPM", color: QUAD_DEFAULT_COLORS[2] },
			{ label: "VRAM", valueText: multiValue(K.vram, 14200), unitText: "MB", color: QUAD_DEFAULT_COLORS[3] }
		],
		labels: true,
		palette: multiPalette(K.cpuTemp)
	})
};

// ---------- shot 1: hero ----------
async function hero() {
	// An "under load" scenario — every face is still drawn by the real renderer.
	// The wall deliberately MIXES layouts: gallery slot 1 is the only image
	// many people look at, and a grid of single readings would sell the
	// commodity claim instead of the product. A dual, a triple and a quad sit
	// among the singles exactly as they would on a real deck.
	// Ten keys, not fifteen: at the size a gallery image is actually viewed,
	// a 5x3 wall shrinks the quad's four values to mush. Two rows keep the
	// deck-wall read, stay distinct from the thumbnail's single row, and
	// leave the sparkline colors (pink, green, purple, cyan, blue) visible
	// beside all three multi-reading layouts and both alert states.
	const faces = [
		face({ key: K.cpuTemp, label: "CPU Temp", forceValue: 71.4 }),
		multi.dual,
		face({ key: K.coreClock, label: "Core 1 Clock", forceValue: 5625 }),
		face({ key: K.cpuLoad, label: "CPU Load", forceValue: 87.4 }),
		face({ key: K.gpuTemp, label: "GPU Temp", level: "warn", forceValue: 84.6 }),
		// "GPU Hot" fits the badge-shortened label band without truncation.
		face({ key: K.gpuHot, label: "GPU Hot", level: "crit", forceValue: 106.2, statBadge: "MAX" }),
		multi.quad,
		multi.triple,
		face({ key: K.pump, label: "Pump" }),
		face({ key: K.netDown, label: "Net Down", forceValue: 48700 })
	];

	const KEY = 196;
	const GAP = 14;
	const PAD = 40;
	const SLOT_W = 336;
	const SLOT_H = 168;
	const deckW = 5 * KEY + 4 * GAP + 2 * PAD;
	const deckH = 2 * KEY + GAP + 32 + SLOT_H + 2 * PAD;
	const deckX = W - deckW - 96;
	const deckY = Math.round((H - deckH) / 2);
	// The touchscreens carry the same argument as the keys: several readings
	// at once, not one value per slot.
	const slots = [dialThreeRow(), dialTwoRow(), dialSingle()];

	const chrome = [
		`<rect x="${deckX}" y="${deckY}" width="${deckW}" height="${deckH}" rx="34" fill="#131418" stroke="#26282E" stroke-width="1.5"/>`,
		`<text x="96" y="392" font-family="${FONT}" font-size="66" font-weight="700" fill="${HEADLINE}">HWiNFO Sensors</text>`,
		`<text x="96" y="446" font-family="${FONT}" font-size="26" font-weight="400" fill="${BODY}">Live hardware readings on your Stream Deck.</text>`,
		`<text x="96" y="522" font-family="${MONO}" font-size="17" fill="${CYAN}">temperatures · clocks · fans · power · load · network</text>`,
		`<text x="96" y="560" font-family="${MONO}" font-size="17" fill="${MUTED}">up to four readings per key · up to three per dial</text>`,
		`<text x="96" y="598" font-family="${MONO}" font-size="17" fill="${MUTED}">7 themes · type accents · sparklines · aviation-style alerts</text>`,
		`<text x="96" y="912" font-family="${MONO}" font-size="15" fill="${MUTED}">every key face above is real plugin output: Ryzen 9 9950X3D + RTX 4090</text>`
	];

	const composites = [];
	for (let i = 0; i < faces.length; i++) {
		const col = i % 5;
		const row = Math.floor(i / 5);
		composites.push({
			input: await roundedKey(faces[i], KEY, 20, "#26282E"),
			left: deckX + PAD + col * (KEY + GAP),
			top: deckY + PAD + row * (KEY + GAP)
		});
	}
	const slotsW = slots.length * SLOT_W + (slots.length - 1) * GAP;
	const slotsX = deckX + Math.round((deckW - slotsW) / 2);
	const slotsY = deckY + PAD + 2 * KEY + GAP + 32;
	for (let i = 0; i < slots.length; i++) {
		const png = await rasterize(slots[i], SLOT_W / 200, 200, 100);
		const mask = Buffer.from(`<svg width="${SLOT_W}" height="${SLOT_H}"><rect width="${SLOT_W}" height="${SLOT_H}" rx="11" fill="#fff"/></svg>`);
		composites.push({ input: await sharp(png).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer(), left: slotsX + i * (SLOT_W + GAP), top: slotsY });
	}
	await sharp(Buffer.from(pageBase(W, H, chrome))).composite(composites).png().toFile(path.join(outDir, "shot-1-hero.png"));
}

// ---------- shot 2: themes ----------
async function themes() {
	const names = Object.keys(config.themes);
	const KEY = 196;
	const GAP = 22;
	const totalW = names.length * KEY + (names.length - 1) * GAP;
	const startX = Math.round((W - totalW) / 2);
	const rowY = [246, 246 + KEY + 54];

	const chrome = [
		`<text x="960" y="96" text-anchor="middle" font-family="${FONT}" font-size="52" font-weight="700" fill="${HEADLINE}">Seven themes. One instrument.</text>`,
		`<text x="960" y="142" text-anchor="middle" font-family="${FONT}" font-size="22" fill="${BODY}">Per key or deck-wide. Anchors never move, only the palette changes.</text>`,
		`<text x="960" y="${rowY[0] - 62}" text-anchor="middle" font-family="${MONO}" font-size="16" fill="${MUTED}">type accents ON: the line follows the sensor type, the same red in every theme</text>`,
		`<text x="960" y="${rowY[1] - 30}" text-anchor="middle" font-family="${MONO}" font-size="16" fill="${MUTED}">type accents OFF: the line follows the theme instead</text>`,
		`<text x="960" y="${rowY[1] + KEY + 64}" text-anchor="middle" font-family="${FONT}" font-size="21" fill="${BODY}">Alerts are global and never themed: amber field with black text at warn, red with white at critical.</text>`
	];

	const composites = [];
	for (let i = 0; i < names.length; i++) {
		const theme = names[i];
		const x = startX + i * (KEY + GAP);
		chrome.push(`<text x="${x + KEY / 2}" y="${rowY[0] - 26}" text-anchor="middle" font-family="${MONO}" font-size="17" fill="${theme === "void" ? CYAN : MUTED}">${theme}${theme === "void" ? " · default" : ""}</text>`);
		composites.push({ input: await roundedKey(face({ key: K.cpuTemp, label: "CPU Temp", theme }), KEY, 22, "#26282E"), left: x, top: rowY[0] });
		composites.push({ input: await roundedKey(face({ key: K.gpuPower, label: "GPU Power", theme, statBadge: "AVG", accents: false }), KEY, 22, "#26282E"), left: x, top: rowY[1] });
	}

	// centered warn/crit pair under the wall
	const pairY = rowY[1] + KEY + 92;
	const pair = [
		face({ key: K.gpuTemp, label: "GPU Temp", level: "warn", forceValue: 84.6 }),
		face({ key: K.gpuHot, label: "GPU Hot", level: "crit", forceValue: 106.2, statBadge: "MAX" })
	];
	for (let i = 0; i < 2; i++) {
		composites.push({ input: await roundedKey(pair[i], 150, 17, "#26282E"), left: 960 - 160 + i * 170, top: pairY });
	}
	await sharp(Buffer.from(pageBase(W, H, chrome))).composite(composites).png().toFile(path.join(outDir, "shot-3-themes.png"));
}

// ---------- shot 4: dials (Stream Deck +) ----------
async function dials() {
	const mk = (key, label, statMode, fraction, { forceValue, forceBar } = {}) => {
		const r = byKey(key);
		const accent = classifyTypeAccent(r.type, r.unit, r.label);
		const palette = resolvePalette(config, "void", accent, "normal");
		return renderDial({
			title: label,
			valueText: formatValue(forceValue ?? r.value, "auto"),
			unitText: `${r.unit}${statMode ? " · " + statMode : ""}`.trim(),
			statsText: `▼ ${formatValue(r.valueMin, "auto")}   ▲ ${formatValue(Math.max(r.valueMax, forceValue ?? 0), "auto")}   session`,
			fraction,
			palette,
			barColor: forceBar ?? palette.accent
		});
	};
	const strip = [
		mk(K.cpuTemp, "CPU Temp", "", 0.58, { forceValue: 71.4 }),
		mk(K.gpuPower, "GPU Power", "", 0.53, { forceValue: 316.4 }),
		mk(K.pump, "Pump", "", 0.92),
		mk(K.gpuHot, "GPU Hot Spot", "MAX", 0.97, { forceValue: 106.2, forceBar: config.alerts.crit.bg })
	];
	const keys = [
		face({ key: K.cpuTemp, label: "CPU Temp", forceValue: 71.4 }),
		face({ key: K.gpuTemp, label: "GPU Temp", forceValue: 76.2 }),
		face({ key: K.cpuLoad, label: "CPU Load", forceValue: 87.4 }),
		face({ key: K.gpuLoad, label: "GPU Load", forceValue: 98 }),
		face({ key: K.cpuPower, label: "CPU Power", forceValue: 142.8 }),
		face({ key: K.gpuPower, label: "GPU Power", forceValue: 316.4 }),
		face({ key: K.netDown, label: "Net Down", forceValue: 48700 }),
		face({ key: K.memLoad, label: "Memory Load", spark: false })
	];

	const KEY = 148;
	const GAP = 14;
	const PAD = 40;
	const stripW = 4 * 296 + 3 * GAP; // dials rendered 200x100 → 296x148
	const deckW = Math.max(4 * KEY + 3 * GAP, stripW) + 2 * PAD;
	const keysW = 4 * KEY + 3 * GAP;
	const deckH = PAD + 2 * KEY + GAP + 26 + 148 + 100 + PAD;
	const deckX = W - deckW - 110;
	const deckY = Math.round((H - deckH) / 2);

	const chrome = [
		`<rect x="${deckX}" y="${deckY}" width="${deckW}" height="${deckH}" rx="34" fill="#131418" stroke="#26282E" stroke-width="1.5"/>`,
		`<text x="110" y="360" font-family="${FONT}" font-size="56" font-weight="700" fill="${HEADLINE}">Dials, themed too.</text>`,
		`<text x="110" y="418" font-family="${FONT}" font-size="24" fill="${BODY}">Stream Deck + and + XL</text>`,
		`<text x="110" y="454" font-family="${FONT}" font-size="24" fill="${BODY}">touchscreen slots: live value,</text>`,
		`<text x="110" y="490" font-family="${FONT}" font-size="24" fill="${BODY}">session range, and a bar that</text>`,
		`<text x="110" y="526" font-family="${FONT}" font-size="24" fill="${BODY}">flips to the alert color when</text>`,
		`<text x="110" y="562" font-family="${FONT}" font-size="24" fill="${BODY}">a threshold trips.</text>`,
		`<text x="110" y="622" font-family="${MONO}" font-size="16" fill="${MUTED}">rotate · switch reading</text>`,
		`<text x="110" y="654" font-family="${MONO}" font-size="16" fill="${MUTED}">push · reset session</text>`,
		`<text x="110" y="686" font-family="${MONO}" font-size="16" fill="${MUTED}">touch · cycle stat</text>`
	];

	const composites = [];
	const keysX = deckX + Math.round((deckW - keysW) / 2);
	for (let i = 0; i < keys.length; i++) {
		composites.push({
			input: await roundedKey(keys[i], KEY, 17, "#26282E"),
			left: keysX + (i % 4) * (KEY + GAP),
			top: deckY + PAD + Math.floor(i / 4) * (KEY + GAP)
		});
	}
	const stripX = deckX + Math.round((deckW - stripW) / 2);
	const stripY = deckY + PAD + 2 * KEY + GAP + 26;
	for (let i = 0; i < strip.length; i++) {
		const png = await rasterize(strip[i], 1.48, 200, 100);
		const mask = Buffer.from(`<svg width="296" height="148"><rect width="296" height="148" rx="10" fill="#fff"/></svg>`);
		const framed = await sharp(png).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
		composites.push({ input: framed, left: stripX + i * (296 + GAP), top: stripY });
		// knob under each slot
		const knobX = stripX + i * (296 + GAP) + 148;
		composites.push({
			input: Buffer.from(
				`<svg width="76" height="76"><circle cx="38" cy="38" r="36" fill="#1B1D22" stroke="#2E3138" stroke-width="2"/><circle cx="38" cy="38" r="28" fill="#101116"/><rect x="36.5" y="12" width="3" height="12" rx="1.5" fill="#4CC2FF"/></svg>`
			),
			left: knobX - 38,
			top: stripY + 148 + 22
		});
	}
	await sharp(Buffer.from(pageBase(W, H, chrome))).composite(composites).png().toFile(path.join(outDir, "shot-5-dials.png"));
}

// ---------- shot 6: more than one reading per key ----------
// The three multi-reading layouts at a size where the type is readable,
// each drawn by its production renderer from live values.
async function multiKeys() {
	const pal = (key, level = "normal") => {
		const r = byKey(key);
		return resolvePalette(config, "void", classifyTypeAccent(r.type, r.unit, r.label), level);
	};
	const val = (key, forced) => formatValue(forced ?? byKey(key).value, "auto");

	const dual = renderDualKey({
		top: { label: "CPU", valueText: val(K.cpuTemp, 71.4), unitText: "°C", statBadge: "" },
		bottom: { label: "GPU", valueText: val(K.gpuTemp, 76.2), unitText: "°C", statBadge: "" },
		palette: pal(K.cpuTemp)
	});
	const triple = renderTripleKey({
		rows: [
			{ label: "CCD1", valueText: val(K.ccd1, 66.9), unitText: "°C" },
			{ label: "CCD2", valueText: val(K.cpuTemp, 64.1), unitText: "°C" },
			{ label: "Core Max", valueText: val(K.cpuTemp, 71.4), unitText: "°C" }
		],
		palette: pal(K.cpuTemp)
	});
	const quad = renderQuadKey({
		cells: [
			{ label: "CPU", valueText: val(K.cpuTemp, 71.4), unitText: "°C", color: QUAD_DEFAULT_COLORS[0] },
			{ label: "GPU", valueText: val(K.gpuTemp, 76.2), unitText: "°C", color: QUAD_DEFAULT_COLORS[1] },
			{ label: "PUMP", valueText: val(K.pump), unitText: "RPM", color: QUAD_DEFAULT_COLORS[2] },
			{ label: "VRAM", valueText: val(K.vram, 14200), unitText: "MB", color: QUAD_DEFAULT_COLORS[3] }
		],
		labels: true,
		palette: pal(K.cpuTemp)
	});

	const KEY = 260;
	const GAP = 92;
	const captions = ["Two, stacked", "Three, as rows", "Four, in a grid"];
	const subs = ["one press cycles both", "label left, value right", "a color per slot"];
	const rowY = 330;
	const totalW = 3 * KEY + 2 * GAP;
	const startX = Math.round((W - totalW) / 2);

	const chrome = [
		`<text x="960" y="150" text-anchor="middle" font-family="${FONT}" font-size="58" font-weight="700" fill="${HEADLINE}">One key does not mean one reading.</text>`,
		`<text x="960" y="204" text-anchor="middle" font-family="${FONT}" font-size="24" fill="${BODY}">Stack two, list three, or split four across a single key. Every row keeps its own sensor, label and unit.</text>`,
		`<text x="960" y="820" text-anchor="middle" font-family="${MONO}" font-size="17" fill="${MUTED}">real plugin output: Ryzen 9 9950X3D + RTX 4090</text>`
	];
	captions.forEach((c, i) => {
		const cx = startX + i * (KEY + GAP) + KEY / 2;
		chrome.push(`<text x="${cx}" y="${rowY + KEY + 58}" text-anchor="middle" font-family="${FONT}" font-size="27" font-weight="600" fill="${HEADLINE}">${esc(c)}</text>`);
		chrome.push(`<text x="${cx}" y="${rowY + KEY + 94}" text-anchor="middle" font-family="${MONO}" font-size="17" fill="${MUTED}">${esc(subs[i])}</text>`);
	});

	const composites = [];
	const faces = [dual, triple, quad];
	for (let i = 0; i < faces.length; i++) {
		composites.push({ input: await roundedKey(faces[i], KEY, 30, "#26282E"), left: startX + i * (KEY + GAP), top: rowY });
	}
	await sharp(Buffer.from(pageBase(W, H, chrome))).composite(composites).png().toFile(path.join(outDir, "shot-6-multi.png"));
}

// ---------- shot 8: a key that opens a page ----------
// The opener on the left, the page it opens on the right, both composed by
// the detail view's own face renderers from a live group.
async function drilldown() {
	const primary = byKey(K.gpuTemp);
	const group = resolveDetailGroup(snapshot, { readingKey: primary.key, detailMode: "filter", detailFilter: "*4090*", detailTitle: "GPU" });
	if (group === null) {
		throw new Error("drilldown shot: the filter resolved nothing");
	}
	const profile = DETAIL_PROFILES.find((p) => p.key === "standard");
	const ctx = {
		config,
		deckThemeId: "void",
		typeAccents: true,
		measure: { decimals: "auto", fahrenheit: false, dataUnits: "decimal" },
		text: effectiveTextSettings(parseTextSettings({}), null)
	};
	const status = { state: "ok", snapshot, source: "shared-memory" };
	const state = {
		deviceId: "marketing",
		profileName: profile.name,
		pageSize: profile.layout.readings.length,
		primaryKey: primary.key,
		groupSettings: { readingKey: primary.key, detailMode: "filter", detailFilter: "*4090*", detailTitle: "GPU" },
		presentation: {},
		group,
		offset: 0,
		statModes: new Map(),
		surfaceCount: 1,
		pending: false,
		mirrorSlotIndex: null
	};
	const page = pageOf(group.keys, 0, state.pageSize, undefined);
	const faceAt = (column, row) => {
		const nav = profile.layout.nav;
		if (nav.back.column === column && nav.back.row === row) return composeBackFace(state, status, ctx);
		if (nav.title !== null && nav.title.column === column && nav.title.row === row) return composeTitleFace(state, page, ctx);
		if (nav.previous !== null && nav.previous.column === column && nav.previous.row === row) return composePagerFace("previous", page, state, ctx);
		if (nav.next !== null && nav.next.column === column && nav.next.row === row) return composePagerFace("next", page, state, ctx);
		const index = profile.layout.readings.findIndex((c) => c.column === column && c.row === row);
		return composeReadingFace(state, page.slots[index], "current", status, ctx);
	};

	// Live value, not the hero shot's under-load figure: the Back tile inside
	// the page draws the same reading from the same snapshot, and the two
	// must agree on screen.
	const opener = face({ key: K.gpuTemp, label: "GPU Temp" });
	const OPEN_KEY = 220;
	const openerX = 300;
	const openerY = 400;
	const KEY = 138;
	const GAP = 11;
	const boardW = profile.layout.columns * KEY + (profile.layout.columns - 1) * GAP;
	const boardH = profile.layout.rows * KEY + (profile.layout.rows - 1) * GAP;
	const boardX = W - boardW - 160;
	const boardY = Math.round(openerY + OPEN_KEY / 2 - boardH / 2);

	const chrome = [
		`<text x="960" y="150" text-anchor="middle" font-family="${FONT}" font-size="58" font-weight="700" fill="${HEADLINE}">Press one key. Get the whole sensor.</text>`,
		`<text x="960" y="204" text-anchor="middle" font-family="${FONT}" font-size="24" fill="${BODY}">A key can open a page of related readings, with paging and a way back. Each key decides its own group.</text>`,
		`<text x="${openerX + OPEN_KEY / 2}" y="${openerY + OPEN_KEY + 52}" text-anchor="middle" font-family="${FONT}" font-size="26" font-weight="600" fill="${HEADLINE}">press</text>`,
		`<text x="${openerX + OPEN_KEY / 2}" y="${openerY + OPEN_KEY + 88}" text-anchor="middle" font-family="${MONO}" font-size="16" fill="${MUTED}">any Sensor Reading key</text>`,
		`<text x="${boardX + boardW / 2}" y="${boardY + boardH + 52}" text-anchor="middle" font-family="${FONT}" font-size="26" font-weight="600" fill="${HEADLINE}">everything matching *4090*, paged</text>`,
		`<text x="${boardX + boardW / 2}" y="${boardY + boardH + 88}" text-anchor="middle" font-family="${MONO}" font-size="16" fill="${MUTED}">or one source, or a list you order by hand</text>`,
		`<text x="960" y="880" text-anchor="middle" font-family="${MONO}" font-size="17" fill="${MUTED}">real plugin output: Ryzen 9 9950X3D + RTX 4090</text>`
	];
	// The arrow between the two, on the shared centre line.
	const arrowY = openerY + OPEN_KEY / 2;
	const arrowFrom = openerX + OPEN_KEY + 52;
	const arrowTo = boardX - 52;
	chrome.push(`<path d="M${arrowFrom},${arrowY} L${arrowTo - 18},${arrowY}" stroke="${CYAN}" stroke-width="3" stroke-linecap="round" opacity="0.85"/>`);
	chrome.push(`<path d="M${arrowTo - 26},${arrowY - 13} L${arrowTo},${arrowY} L${arrowTo - 26},${arrowY + 13} Z" fill="${CYAN}" opacity="0.85"/>`);

	const composites = [{ input: await roundedKey(opener, OPEN_KEY, 23, "#26282E"), left: openerX, top: openerY }];
	for (let row = 0; row < profile.layout.rows; row++) {
		for (let column = 0; column < profile.layout.columns; column++) {
			composites.push({
				input: await roundedKey(faceAt(column, row), KEY, 14, "#22242A"),
				left: boardX + column * (KEY + GAP),
				top: boardY + row * (KEY + GAP)
			});
		}
	}
	await sharp(Buffer.from(pageBase(W, H, chrome))).composite(composites).png().toFile(path.join(outDir, "shot-8-drilldown.png"));
}

// ---------- shot 7: the dial touchscreen, two and three at a time ----------
async function dialViews() {
	const row = (key, label, forced, selected) => {
		const r = byKey(key);
		const palette = resolvePalette(config, "void", classifyTypeAccent(r.type, r.unit, r.label), "normal");
		return {
			label,
			valueText: formatValue(forced ?? r.value, "auto"),
			unitText: r.unit,
			selected,
			valueColor: palette.accent,
			history: walk(key + label, Math.min(r.valueMin, forced ?? r.value), Math.max(r.valueMax, forced ?? r.value), forced ?? r.value)
		};
	};
	const base = resolvePalette(config, "void", classifyTypeAccent(byKey(K.cpuTemp).type, "°C", "CPU"), "normal");

	const three = renderDialOverview({
		rows: [row(K.cpuTemp, "CPU Temp", 71.4, true), row(K.gpuTemp, "GPU Temp", 76.2, false), row(K.pump, "Pump", undefined, false)],
		contextText: "Loop",
		statsText: "▼ 51.0 ▲ 79.0",
		palette: base
	});
	const two = renderDialTwoRow({
		rows: [row(K.gpuPower, "GPU Power", 316.4, true), row(K.gpuLoad, "GPU Load", 98, false)],
		footerText: "▼ 64.5 ▲ 349 session",
		palette: base
	});
	const one = renderDial({
		title: "GPU Hot Spot",
		valueText: formatValue(106.2, "auto"),
		unitText: "°C · MAX",
		statsText: "▼ 50.2   ▲ 106   session",
		fraction: 0.97,
		palette: base,
		barColor: config.alerts.crit.bg
	});

	const SLOT_W = 480;
	const SLOT_H = 240;
	const GAP = 76;
	const totalW = 3 * SLOT_W + 2 * GAP;
	const startX = Math.round((W - totalW) / 2);
	const slotY = 340;
	const captions = ["Three readings", "Two, with history", "One, with range"];
	const subs = ["rotate moves the rail", "sparkline per row", "session bar and stats"];

	const chrome = [
		`<text x="960" y="150" text-anchor="middle" font-family="${FONT}" font-size="58" font-weight="700" fill="${HEADLINE}">The dial screen holds a whole group.</text>`,
		`<text x="960" y="204" text-anchor="middle" font-family="${FONT}" font-size="24" fill="${BODY}">Stream Deck + and + XL: three views of the same rotation set, switched per dial. Rotate to move, push to reset.</text>`,
		`<text x="960" y="820" text-anchor="middle" font-family="${MONO}" font-size="17" fill="${MUTED}">real plugin output: Ryzen 9 9950X3D + RTX 4090</text>`
	];
	captions.forEach((c, i) => {
		const cx = startX + i * (SLOT_W + GAP) + SLOT_W / 2;
		chrome.push(`<text x="${cx}" y="${slotY + SLOT_H + 56}" text-anchor="middle" font-family="${FONT}" font-size="27" font-weight="600" fill="${HEADLINE}">${esc(c)}</text>`);
		chrome.push(`<text x="${cx}" y="${slotY + SLOT_H + 92}" text-anchor="middle" font-family="${MONO}" font-size="17" fill="${MUTED}">${esc(subs[i])}</text>`);
	});

	const composites = [];
	const faces = [three, two, one];
	for (let i = 0; i < faces.length; i++) {
		const png = await rasterize(faces[i], SLOT_W / 200, 200, 100);
		const mask = Buffer.from(`<svg width="${SLOT_W}" height="${SLOT_H}"><rect width="${SLOT_W}" height="${SLOT_H}" rx="14" fill="#fff"/></svg>`);
		const framed = await sharp(png).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
		composites.push({ input: framed, left: startX + i * (SLOT_W + GAP), top: slotY });
	}
	await sharp(Buffer.from(pageBase(W, H, chrome))).composite(composites).png().toFile(path.join(outDir, "shot-7-dial-views.png"));
}

// ---------- shot 4: settings panel (from capture-pi.mjs screenshots) ----------
// Three panels, one per thing the gallery claims: find the reading, put four
// on a key, choose what a drill-down key opens. The old two-panel version
// predated both multi-reading keys and the drill-down, so it showed the
// config for a feature set the listing no longer leads with.
async function settings(piDir) {
	const panels = [
		{ file: "pi-picker-block.png", title: "Find any reading, live values" },
		{ file: "pi-key-quad-rows.png", title: "Four readings on one key" },
		{ file: "pi-key-detail-filter.png", title: "Pick what a press opens, counted live" }
	];
	const MAX_H = 660; // headline block above, one caption baseline below
	const gap = 64;
	const w = Math.floor((W - 200 - 2 * gap) / 3);
	const startX = Math.round((W - (3 * w + 2 * gap)) / 2);
	// The three panels are genuinely different heights. Center each in the
	// band and put every caption on one baseline, so the row reads as a row.
	const bandTop = 178;
	const bandH = MAX_H;
	const captionY = 908;

	const chrome = [
		`<text x="960" y="84" text-anchor="middle" font-family="${FONT}" font-size="50" font-weight="700" fill="${HEADLINE}">Set up in seconds.</text>`,
		`<text x="960" y="130" text-anchor="middle" font-family="${FONT}" font-size="22" fill="${BODY}">The real settings panel, not a mockup: search with live values, stack up to four, aim a drill-down key.</text>`
	];
	const composites = [];
	for (let i = 0; i < panels.length; i++) {
		const x = startX + i * (w + gap);
		const src = sharp(path.join(piDir, panels[i].file));
		const meta = await src.metadata();
		// Every panel is a clipped capture that already ends on a section
		// boundary; the height budget only has to catch an overlong one.
		const scale = w / meta.width;
		const cropH = Math.min(meta.height, Math.round(MAX_H / scale));
		const img = await src.extract({ left: 0, top: 0, width: meta.width, height: cropH }).resize({ width: w }).png().toBuffer();
		const h = Math.min(MAX_H, Math.round(cropH * scale));
		const top = bandTop + Math.round((bandH - h) / 2);
		chrome.push(
			`<rect x="${x - 12}" y="${top - 12}" width="${w + 24}" height="${h + 24}" rx="14" fill="${CARD_BG}" stroke="${CARD_BORDER}" stroke-width="1.5"/>`,
			`<text x="${x + w / 2}" y="${captionY}" text-anchor="middle" font-family="${MONO}" font-size="18" fill="${MUTED}">${esc(panels[i].title)}</text>`
		);
		composites.push({ input: img, left: x, top });
	}
	await sharp(Buffer.from(pageBase(W, H, chrome))).composite(composites).png().toFile(path.join(outDir, "shot-4-settings.png"));
}

// ---------- thumbnail (dedicated 1920×960 listing card) ----------
async function thumbnail() {
	// Purpose-built per the guidelines: depicts real functionality with large
	// legible text — one row of real key faces + a real dial slot.
	const KEY = 220;
	const GAP = 18;
	// One single, one alerting, then the three multi-reading layouts: the card
	// has to say "more than one reading per key" before anyone clicks.
	const faces = [
		face({ key: K.cpuTemp, label: "CPU Temp", forceValue: 71.4 }),
		face({ key: K.gpuTemp, label: "GPU Temp", level: "warn", forceValue: 84.6 }),
		multi.dual,
		multi.triple,
		multi.quad
	];
	const rowW = faces.length * KEY + (faces.length - 1) * GAP;
	const rowX = Math.round((W - rowW) / 2);
	const rowY = 378;

	const r = byKey(K.gpuHot);
	const palette = resolvePalette(config, "void", classifyTypeAccent(r.type, r.unit, r.label), "normal");
	const dial = renderDial({
		title: "GPU Hot Spot",
		valueText: formatValue(106.2, "auto"),
		unitText: "°C · MAX",
		statsText: `▼ ${formatValue(r.valueMin, "auto")}   ▲ 106.2   session`,
		fraction: 0.97,
		palette,
		barColor: config.alerts.crit.bg
	});

	const chrome = [
		`<text x="960" y="180" text-anchor="middle" font-family="${FONT}" font-size="86" font-weight="700" fill="${HEADLINE}">HWiNFO Sensors</text>`,
		`<text x="960" y="248" text-anchor="middle" font-family="${FONT}" font-size="32" fill="${BODY}">Live hardware readings on keys and dials</text>`,
		`<text x="960" y="322" text-anchor="middle" font-family="${MONO}" font-size="22" fill="${CYAN}">temperatures · clocks · fans · power · load · network</text>`,
		`<text x="960" y="878" text-anchor="middle" font-family="${MONO}" font-size="20" fill="${MUTED}">7 themes · sparklines · warn/critical alerts · Stream Deck + and + XL</text>`
	];
	const composites = [];
	for (let i = 0; i < faces.length; i++) {
		composites.push({ input: await roundedKey(faces[i], KEY, 24, "#26282E"), left: rowX + i * (KEY + GAP), top: rowY });
	}
	// Two dial screens under the key row: the touchscreen carries several
	// readings at once too, which one single-value slot never showed.
	const SLOT_W = 360;
	const SLOT_H = 180;
	const slots = [dialThreeRow(), dial];
	const slotsW = slots.length * SLOT_W + (slots.length - 1) * 40;
	const slotsX = Math.round((W - slotsW) / 2);
	for (let i = 0; i < slots.length; i++) {
		const png = await rasterize(slots[i], SLOT_W / 200, 200, 100);
		const mask = Buffer.from(`<svg width="${SLOT_W}" height="${SLOT_H}"><rect width="${SLOT_W}" height="${SLOT_H}" rx="13" fill="#fff"/></svg>`);
		composites.push({ input: await sharp(png).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer(), left: slotsX + i * (SLOT_W + 40), top: rowY + KEY + 44 });
	}
	await sharp(Buffer.from(pageBase(W, H, chrome))).composite(composites).png().toFile(path.join(outDir, "thumbnail.png"));
}

await hero();
await themes();
await dials();
await multiKeys();
await dialViews();
await drilldown();
await thumbnail();
const piDir = process.argv[3];
if (piDir !== undefined) {
	await settings(piDir);
	console.log(`Rendered thumbnail + shots 1, 3, 4, 5 (${W}x${H}) to ${outDir}/`);
} else {
	console.log(`Rendered thumbnail + shots 1, 3, 5 (${W}x${H}) to ${outDir}/ (pass a capture dir with pi-settings.png + pi-picker.png for shot 4)`);
}
