/**
 * The 1.8 picture boards: a whole Stream Deck + XL or + drawn face by face
 * through the production composers, from FIXED SAMPLE VALUES. No HWiNFO, no
 * Stream Deck app, not a device capture.
 *
 * A deck is its LCD: every key and the touch strip sit where Elgato's
 * published layout puts them (src/ui/deck-art.ts DECK_PANELS), so a deck
 * background (Stars, Dusk, Nebula) is painted per face by the plugin's own
 * paintArt at the face's real place and lines up across the board the way
 * it does on the device. A see-through look (Glass, Tint, Outline, Clear)
 * is drawn over a page picture cut to the same rects; the glass between
 * the keys is black, as on the device.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { composeDialSvg, type DialRenderState, type DialSettings } from "../../src/actions/sensor-dial";
import { compose, type ReadingSettings } from "../../src/actions/sensor-reading";
import type { HistoryWindowId } from "../../src/history/types";
import { SensorType, type Reading, type SensorSnapshot } from "../../src/hwinfo/types";
import { poller, type PollerStatus } from "../../src/poller";
import { SessionStatsStore } from "../../src/stats";
import type { StripEncoders, StripLayout } from "../../src/strip/geometry";
import { historyWidthFor, stripAlertColors, stripBandsFor, WINDOW_MS, type StripPaneInput, type StripSceneInput, type StripSeriesInput } from "../../src/strip/scene";
import { EMPTY_PANE, stripConfigOf, type StripConfigV1, type StripPaneV1, type StripStyle } from "../../src/strip/settings";
import { sliceStrip } from "../../src/strip/slicer";
import { artPlace, DECK_PANELS, keyRect, paintArt, type DeckPanel, type PanelRect } from "../../src/ui/deck-art";
import type { TextSettings } from "../../src/ui/text-colors";
import { applyGlobalThemeSettings } from "../../src/ui/theme-store";
import { loadThemes, resolvePalette } from "../../src/ui/themes";
import { ambientFixture, groupFixture, makeView } from "./strip-fixtures";

export const BOARD_GLOBALS = { theme: "void", typeAccents: "on", textMode: "theme", textFont: "tahoma" } as const;

/** The decks a board can draw, by the app's DeviceType. */
export const DEVICES = {
	plusxl: { id: "docs-plus-xl", type: 13, columns: 9, rows: 4, encoders: 6 },
	plus: { id: "docs-plus", type: 7, columns: 4, rows: 2, encoders: 4 }
} as const;
export type DeviceName = keyof typeof DEVICES;
export const panelOf = (device: DeviceName): DeckPanel => DECK_PANELS[DEVICES[device].type] as DeckPanel;

// ---- sample readings ---------------------------------------------------------

const sample = (id: number, label: string, type: SensorType, unit: string, value: number, valueMin: number, valueMax: number): Reading => ({
	key: `31:0:${id.toString(16)}`, sensorIndex: 0, id, label, type, unit, value, valueMin, valueMax, valueAvg: Math.round(((valueMin + valueMax + value) / 3) * 10) / 10
});

export const R = {
	cpu: sample(1, "CPU Temp", SensorType.Temperature, "°C", 62.4, 41.0, 78.5),
	ccd: sample(2, "CCD1 Temp", SensorType.Temperature, "°C", 50.8, 38.2, 71.0),
	cpuPower: sample(3, "CPU Power", SensorType.Power, "W", 98.3, 31.5, 169),
	cpuLoad: sample(4, "CPU Load", SensorType.Usage, "%", 23.6, 2.1, 97.0),
	memory: sample(5, "Memory", SensorType.Usage, "%", 46.2, 38.0, 61.4),
	cpuClock: sample(6, "CPU Clock", SensorType.Clock, "MHz", 5215, 3600, 5650),
	vcore: sample(7, "Vcore", SensorType.Voltage, "V", 1.212, 0.92, 1.344),
	gpu: sample(8, "GPU Temp", SensorType.Temperature, "°C", 45.3, 33.0, 71.2),
	hot: sample(9, "Hot Spot", SensorType.Temperature, "°C", 54.9, 40.1, 83.6),
	vram: sample(10, "VRAM Temp", SensorType.Temperature, "°C", 60.0, 44.0, 74.0),
	gpuPower: sample(11, "GPU Power", SensorType.Power, "W", 59.4, 22.8, 349),
	gpuLoad: sample(12, "GPU Load", SensorType.Usage, "%", 13.0, 0, 100),
	gpuClock: sample(13, "GPU Clock", SensorType.Clock, "MHz", 1672, 210, 2790),
	gpuFan: sample(14, "GPU Fan", SensorType.Fan, "RPM", 1180, 0, 2100),
	fps: sample(15, "FPS", SensorType.Other, "FPS", 165, 98, 240),
	pump: sample(16, "Pump", SensorType.Fan, "RPM", 1759, 1690, 2850),
	caseFan: sample(17, "Case Fan", SensorType.Fan, "RPM", 742, 610, 1420),
	ssd: sample(18, "SSD Temp", SensorType.Temperature, "°C", 41.0, 33.0, 56.0),
	board: sample(19, "Board", SensorType.Temperature, "°C", 36.5, 29.0, 44.0),
	psu: sample(20, "PSU Power", SensorType.Power, "W", 236, 118, 612),
	// Two GPUs' free memory as HWiNFO lists it, in MB: the numbers of issue #59.
	vram1: sample(21, "GPU Memory Available", SensorType.Other, "MB", 12100, 9800, 15900),
	vram2: sample(22, "GPU Memory Available", SensorType.Other, "MB", 453, 453, 7600)
} as const;

const readings: Reading[] = Object.values(R);
export const SNAPSHOT: SensorSnapshot = { pollTime: 1, version: 2, revision: 0, sensors: [{ index: 0, id: 0x31, instance: 0, name: "Sample sensors" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) };
const OK: Extract<PollerStatus, { state: "ok" }> = { state: "ok", source: "shared-memory", snapshot: SNAPSHOT };

/** A seeded walk between a reading's low and high that ends on its value, so reruns match. */
export function series(r: Reading, n = 36): number[] {
	let x = r.id * 9301 + 49297;
	const span = r.valueMax - r.valueMin;
	return Array.from({ length: n }, (_, i) => {
		x = (x * 9301 + 49297) % 233280;
		const f = i / (n - 1);
		const drift = Math.sin(f * 5.3 + r.id) * 0.16 + Math.sin(f * 13.1 + r.id * 2.3) * 0.07;
		const noise = (x / 233280 - 0.5) * 0.08;
		return i === n - 1 ? r.value : Math.min(r.valueMax, Math.max(r.valueMin, r.value + span * (drift + noise) * (1 - f * 0.4)));
	});
}

let seeded = false;
/** Sets the shared choices and puts every reading's series into the poller's store, where a Sparkline key reads it. */
export function setupBoards(): void {
	applyGlobalThemeSettings(BOARD_GLOBALS);
	if (seeded) return;
	seeded = true;
	for (const r of readings) {
		poller.subscribeSeries(r.key);
		const ring = poller.getSeries(r.key) as number[];
		ring.length = 0;
		ring.push(...series(r));
	}
}

// ---- the pages ---------------------------------------------------------------

type Cell = ReadingSettings;
const one = (r: Reading, displayMode: "sparkline" | "bar" | "ring" | "none" = "none", limits: { warnValue?: string; critValue?: string } = {}): Cell => ({ readingKey: r.key, displayMode, ...limits });
const TEMP = { warnValue: "80", critValue: "90" };
const DUAL_TEMPS: Cell = { readingKey: R.cpu.key, keyLayout: "dual", secondaryReadingKey: R.gpu.key, label: "CPU", secondaryLabel: "GPU" };
const DUAL_POWER: Cell = { readingKey: R.cpuPower.key, keyLayout: "dual", secondaryReadingKey: R.gpuPower.key, label: "CPU", secondaryLabel: "GPU" };
const TRIPLE: Cell = { readingKey: R.cpu.key, keyLayout: "triple", secondaryReadingKey: R.gpu.key, quadReadingKey3: R.pump.key, label: "CPU", secondaryLabel: "GPU", quadLabel3: "Pump" };
const QUAD: Cell = { readingKey: R.cpu.key, keyLayout: "quad", secondaryReadingKey: R.gpu.key, quadReadingKey3: R.pump.key, quadReadingKey4: R.psu.key, quadLabels: true, label: "CPU", secondaryLabel: "GPU", quadLabel3: "PUMP", quadLabel4: "PSU" };

/** The keys of each sample page, row by row: every key layout and every Display. */
export const PAGES: Readonly<Record<DeviceName, readonly Cell[]>> = {
	plusxl: [
		// CPU
		one(R.cpu, "sparkline"), one(R.ccd, "sparkline"), one(R.cpuPower, "bar", { warnValue: "200", critValue: "250" }), one(R.cpuLoad, "ring"), one(R.memory, "ring", { warnValue: "85", critValue: "95" }),
		one(R.cpuClock, "sparkline"), one(R.vcore), one(R.ssd, "bar", TEMP), one(R.board, "bar", TEMP),
		// GPU
		one(R.gpu, "sparkline"), one(R.hot, "sparkline"), one(R.gpuPower, "bar", { warnValue: "400", critValue: "450" }), one(R.gpuLoad, "ring"), one(R.vram, "ring", TEMP),
		one(R.gpuClock, "sparkline"), one(R.fps, "sparkline"), one(R.gpuFan, "bar"), one(R.psu, "bar", { warnValue: "1200", critValue: "1400" }),
		// Cooling, then several readings on one key
		one(R.pump, "bar"), one(R.caseFan, "bar"), one(R.cpu, "ring", TEMP), one(R.gpu, "ring", TEMP), one(R.fps), DUAL_TEMPS, DUAL_POWER, TRIPLE, QUAD,
		// Plain readings
		one(R.cpu), one(R.gpu), one(R.cpuPower), one(R.gpuPower), one(R.cpuLoad), one(R.gpuLoad), one(R.memory), one(R.fps), one(R.pump)
	],
	plus: [one(R.cpu, "sparkline"), one(R.cpuLoad, "ring"), one(R.gpu, "sparkline"), one(R.gpuLoad, "ring"), one(R.cpuPower, "bar", { warnValue: "200", critValue: "250" }), DUAL_TEMPS, QUAD, one(R.fps, "sparkline")]
};

const DIAL = {
	cpu: { readingKey: R.cpu.key, ...TEMP },
	power: { readingKey: R.cpuPower.key, rotationKeys: [R.cpuPower.key, R.gpuPower.key], dialView: "tworow" },
	rows: { readingKey: R.cpu.key, rotationKeys: [R.cpu.key, R.gpu.key, R.pump.key], dialView: "overview", overviewLabels: "full" },
	load: { readingKey: R.gpuLoad.key },
	clock: { readingKey: R.gpuClock.key, rotationKeys: [R.gpuClock.key, R.fps.key], dialView: "tworow" },
	gpu: { readingKey: R.gpu.key, ...TEMP }
} as const satisfies Record<string, DialSettings>;

/** The independent dials of each sample strip. */
export const DIALS: Readonly<Record<DeviceName, readonly DialSettings[]>> = {
	plusxl: [DIAL.cpu, DIAL.power, DIAL.rows, DIAL.load, DIAL.clock, DIAL.gpu],
	plus: [DIAL.cpu, DIAL.power, DIAL.rows, DIAL.gpu]
};

function dialState(settings: DialSettings): DialRenderState {
	const stats = new SessionStatsStore();
	for (const k of new Set([settings.readingKey, ...(settings.rotationKeys ?? [])])) {
		const r = k === undefined ? undefined : SNAPSHOT.byKey.get(k);
		if (r !== undefined) for (const v of series(r)) stats.sample(r.key, v);
	}
	return { settings, stats, statMode: "current", overlay: null, pinned: false, cyclePaused: false };
}

// ---- strip graphs ------------------------------------------------------------

type SeriesSpec = { key: string; name: string; unit: string; type: SensorType; value: (f: number) => number; gaps?: [number, number][] };

/** A load run between window fractions a and b, with a ramp at each end (0..1). */
const run = (f: number, a: number, b: number, ramp = 0.02): number => 1 / (1 + Math.exp(-(f - a) / (ramp / 4))) / (1 + Math.exp((f - b) / (ramp / 2)));
/** Seeded sensor noise: a sum of sines with unrelated periods, so reruns match. */
const noise = (f: number, seed: number): number => 0.5 * Math.sin(f * 397 + seed) + 0.3 * Math.sin(f * 911 + seed * 2.1) + 0.2 * Math.sin(f * 1723 + seed * 3.7);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The sample PC over a window: idle, one load run (a game) from 0.55 to 0.82 of the window, idle again. */
export const STRIP_SERIES: Readonly<Record<string, SeriesSpec>> = {
	cpu: { key: "f0:0:1", name: "CPU (Tctl/Tdie)", unit: "°C", type: SensorType.Temperature, value: (f) => 52 + 3 * Math.sin(f * 9) + 19 * run(f, 0.55, 0.82, 0.06) + 1.2 * noise(f, 1) },
	gpu: { key: "f0:0:2", name: "GPU Temperature", unit: "°C", type: SensorType.Temperature, value: (f) => 44 + 2 * Math.sin(f * 6 + 1) + 24 * run(f, 0.56, 0.83, 0.09) + 0.6 * noise(f, 2) },
	hot: { key: "f0:0:3", name: "GPU Hot Spot", unit: "°C", type: SensorType.Temperature, value: (f) => 55 + 2 * Math.sin(f * 7 + 2) + 31 * run(f, 0.56, 0.83, 0.07) + 1.0 * noise(f, 3) },
	gpuLoad: { key: "f0:0:4", name: "GPU Load", unit: "%", type: SensorType.Usage, value: (f) => clamp(9 + 5 * Math.sin(f * 11) + 86 * run(f, 0.55, 0.82, 0.01) + 5 * noise(f, 4), 0, 100) },
	gpuPower: { key: "f0:0:5", name: "GPU Power", unit: "W", type: SensorType.Power, value: (f) => 48 + 8 * Math.sin(f * 13 + 1) + 262 * run(f, 0.55, 0.82, 0.01) + 9 * noise(f, 5) },
	cpuPower: { key: "f0:0:6", name: "CPU Package Power", unit: "W", type: SensorType.Power, value: (f) => 46 + 9 * Math.sin(f * 10) + 78 * run(f, 0.55, 0.82, 0.01) + 6 * noise(f, 6) },
	pump: { key: "f0:0:7", name: "Pump", unit: "RPM", type: SensorType.Fan, value: (f) => 1760 + 1040 * run(f, 0.57, 0.84, 0.05) + 14 * noise(f, 7) },
	cpuLoad: { key: "f0:0:8", name: "CPU Usage", unit: "%", type: SensorType.Usage, value: (f) => clamp(12 + 7 * Math.sin(f * 14) + 46 * run(f, 0.55, 0.82, 0.01) + 6 * noise(f, 8), 0, 100) },
	memory: { key: "f0:0:9", name: "Memory Usage", unit: "%", type: SensorType.Usage, value: (f) => 41 + 21 * run(f, 0.54, 0.86, 0.03) + 0.5 * noise(f, 9) },
	fps: { key: "f0:0:a", name: "Framerate", unit: "FPS", type: SensorType.Other, value: (f) => clamp(140 * run(f, 0.56, 0.82, 0.004) + 9 * noise(f, 10) * run(f, 0.56, 0.82, 0.004), 0, 240) },
	// Yes/No limiters (0 is No, 1 is Yes).
	throttle: { key: "f0:0:b", name: "Thermal Throttling", unit: "Yes/No", type: SensorType.Other, value: (f) => (f > 0.74 && f < 0.8 ? 1 : 0) },
	powerLimit: { key: "f0:0:c", name: "GPU Performance Limit - Power", unit: "Yes/No", type: SensorType.Other, value: (f) => ((f > 0.58 && f < 0.63) || (f > 0.69 && f < 0.81) ? 1 : 0) }
};

export type PaneSpec = {
	readonly style: StripStyle;
	readonly series: readonly string[];
	readonly bands?: readonly { readonly key: string; readonly warn?: number; readonly crit?: number; readonly below?: boolean }[];
	readonly overlays?: Readonly<Record<string, boolean>>;
	readonly meterLook?: "full" | "liquid";
};

export type StripScene = { readonly input: StripSceneInput };

/** One Strip display scene from the sample series: one pane across the strip, or two with Equal split. */
export function stripScene(p: { panes: readonly PaneSpec[]; encoders: StripEncoders; background: string; theme: string; window?: HistoryWindowId; accent?: boolean }): StripScene {
	const layout: StripLayout = p.panes.length === 1 ? "whole" : "split";
	const paneOf = (spec: PaneSpec): StripPaneV1 =>
		(stripConfigOf({ panes: [{ style: spec.style, series: spec.series.map((id) => ({ key: (STRIP_SERIES[id] as SeriesSpec).key })), overlays: spec.overlays ?? {}, bands: spec.bands ?? [], ...(spec.meterLook === undefined ? {} : { meterLook: spec.meterLook }) }] }).panes[0] ?? EMPTY_PANE) as StripPaneV1;
	const panes = p.panes.map(paneOf);
	const base = stripConfigOf({ layout, encoders: p.encoders, window: p.window ?? "5m", background: p.background, accentWords: p.accent === true, theme: p.theme });
	const config: StripConfigV1 = { ...base, panes: [panes[0] as StripPaneV1, panes[1] ?? EMPTY_PANE] };
	const themes = loadThemes();
	const palette = resolvePalette(themes, p.theme, null, "normal");
	const windowMs = WINDOW_MS[config.window];
	const inputs: StripPaneInput[] = panes.map((pane, i) => {
		const width = historyWidthFor(config, p.encoders, i, 2);
		const list: StripSeriesInput[] = pane.series.map((s) => {
			const spec = Object.values(STRIP_SERIES).find((x) => x.key === s.key) as SeriesSpec;
			const history = makeView({ windowMs, widthPx: width, unit: spec.unit, type: spec.type, value: spec.value, ...(spec.gaps === undefined ? {} : { gaps: spec.gaps }) });
			return { key: s.key, name: spec.name, unit: spec.unit, state: "ok", history, current: spec.value(1) };
		});
		return { series: list, bands: stripBandsFor(pane, list, { fahrenheit: config.fahrenheit, decimals: config.decimals }), view: { mode: "live" }, highlight: 0 };
	});
	const text: TextSettings = { mode: "theme", color: undefined, dimSecondary: false };
	return { input: { config, encoders: p.encoders, palette, text, alertColors: stripAlertColors(themes.alertValues, palette, config.background), dataUnits: "decimal", panes: inputs } };
}

type Look = Parameters<typeof groupFixture>[0]["background"];
/** Group, its Tiles view and Ambient come from the strip tests' own fixtures (scripts/lib/strip-fixtures.ts). */
export const groupScene = (view: "auto" | "tiles", n: number, encoders: StripEncoders, background: string, theme: string): StripScene =>
	groupFixture({ n, kind: view === "tiles" ? "usage" : "temp", view, encoders, background: background as Look, theme });
export const ambientScene = (n: number, encoders: StripEncoders, background: string, theme: string): StripScene => ambientFixture({ n, encoders, background: background as Look, theme });

// ---- a deck ------------------------------------------------------------------

/** What the touch strip shows: the independent dials, or one Strip display scene. */
export type StripSpec = "dials" | StripScene;

export type DeckSpec = {
	readonly device: DeviceName;
	/** Background on every key and dial: a see-through look or a deck background. A Strip display scene carries its own. */
	readonly look: string;
	readonly theme: string;
	readonly strip: StripSpec;
	/** Words in the accent color (Glass, Tint and Outline). */
	readonly accentWords?: boolean;
	/** The page picture a see-through look shows: an SVG the size of the LCD, or a committed picture file. Absent for Theme and the deck backgrounds. */
	readonly picture?: string | PictureFile;
};

export type DeckFaces = { readonly keys: readonly string[]; readonly strip: readonly (string | null)[] };

/** Every face of a deck as the plugin would send it: composed, then painted at its place. */
export function deckFaces(spec: DeckSpec): DeckFaces {
	setupBoards();
	const device = DEVICES[spec.device];
	const keys = PAGES[spec.device].map((cell, i) => {
		const settings: ReadingSettings = { ...cell, theme: spec.theme, textMode: "theme", keyBackground: spec.look, ...(spec.accentWords === true ? { keyAccentWords: true } : {}) };
		return paintArt(compose(settings, OK, false, 1), artPlace(device, { column: i % device.columns, row: Math.floor(i / device.columns) }, `key-${i}`, false));
	});
	const slices =
		spec.strip === "dials"
			? DIALS[spec.device].map((d) => composeDialSvg(dialState({ ...d, theme: spec.theme, textMode: "theme", dialBackground: spec.look, ...(spec.accentWords === true ? { dialAccentWords: true } : {}) }), OK, (k) => series(SNAPSHOT.byKey.get(k) as Reading, 15)))
			: sliceStrip(spec.strip.input).slices;
	return { keys, strip: slices.map((svg, column) => (svg === null ? null : paintArt(svg, artPlace(device, { column, row: 0 }, `dial-${column}`, true)))) };
}

/** The slices of one Strip display scene on a device's strip, painted at their place. */
export function stripFaces(device: DeviceName, scene: StripScene): readonly (string | null)[] {
	setupBoards();
	return sliceStrip(scene.input).slices.map((svg, column) => (svg === null ? null : paintArt(svg, artPlace(DEVICES[device], { column, row: 0 }, `dial-${column}`, true))));
}

const rounded = (w: number, h: number, r: number): Buffer => Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`);
const sized = (svg: string, from: string, w: number, h: number): Buffer => {
	if (!svg.includes(from)) throw new Error(`face without ${from}`);
	return Buffer.from(svg.replace(from, `width="${w}" height="${h}"`));
};
const blank = (w: number, h: number, alpha: number) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha } } });

export type Layer = { input: Buffer; left: number; top: number };

/** A key face at `size` px over `under` (a picture piece, or black), its corners rounded as the device masks them. */
export async function keyPng(svg: string, size: number, under: Buffer | null = null): Promise<Buffer> {
	const face = await sharp(sized(svg, 'width="144" height="144"', size, size)).png().toBuffer();
	const flat = await (under === null ? blank(size, size, 1) : sharp(under)).composite([{ input: face, left: 0, top: 0 }]).png().toBuffer();
	return sharp(flat).composite([{ input: rounded(size, size, Math.round(size * 0.13)), blend: "dest-in" }]).png().toBuffer();
}

/** A strip's slices side by side at `scale` px per strip px over `under` (a picture piece, or black), corners rounded. */
export async function stripPng(slices: readonly (string | null)[], scale: number, under: Buffer | null = null): Promise<Buffer> {
	const w = Math.round(200 * scale);
	const h = Math.round(100 * scale);
	const W = w * slices.length;
	const layers: Layer[] = [];
	for (const [c, svg] of slices.entries()) if (svg !== null) layers.push({ input: await sharp(sized(svg, 'width="200" height="100"', w, h)).png().toBuffer(), left: c * w, top: 0 });
	const flat = await (under === null ? blank(W, h, 1) : sharp(under)).composite(layers).png().toBuffer();
	return sharp(flat).composite([{ input: rounded(W, h, Math.round(h * 0.08)), blend: "dest-in" }]).png().toBuffer();
}

/** A photograph committed beside the boards, with the credit its license asks for (docs/assets/img/showcase/pictures). */
export type PictureFile = { readonly file: string; readonly title: string; readonly credit: string; readonly source: string; readonly license: string; readonly licenseUrl: string; readonly changes: string };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A page picture at a deck's LCD size times `scale`, as a PNG: a photograph is cropped to the LCD's shape from its center. */
export const picturePng = (picture: string | PictureFile, w: number, h: number): Promise<Buffer> =>
	typeof picture === "string" ? sharp(Buffer.from(picture)).resize(w, h, { fit: "fill" }).png().toBuffer() : sharp(path.join(ROOT, picture.file)).resize(w, h, { fit: "cover" }).png().toBuffer();

/**
 * A deck as its LCD shows it, `scale` output px per LCD px: black glass,
 * each key and the strip a rounded window at its published rect. The page
 * picture, when there is one, shows only through those windows.
 */
export async function deckPng(spec: DeckSpec, scale: number): Promise<Buffer> {
	const faces = deckFaces(spec);
	const device = DEVICES[spec.device];
	const panel = panelOf(spec.device);
	// Whole LCD pixels only: every rect lands on the output grid when scale * 2 is whole.
	const px = (n: number) => Math.round(n * scale);
	const W = px(panel.w);
	const H = px(panel.h);
	const picture = spec.picture === undefined ? null : await picturePng(spec.picture, W, H);
	const piece = (rect: PanelRect, w: number, h: number): Promise<Buffer> | null => (picture === null ? null : sharp(picture).extract({ left: px(rect.x), top: px(rect.y), width: w, height: h }).png().toBuffer());
	const layers: Layer[] = [];
	for (const [i, svg] of faces.keys.entries()) {
		const rect = keyRect(panel, i % device.columns, Math.floor(i / device.columns)) as PanelRect;
		const size = px(rect.w);
		layers.push({ input: await keyPng(svg, size, await piece(rect, size, size)), left: px(rect.x), top: px(rect.y) });
	}
	const strip = panel.strip as PanelRect;
	layers.push({ input: await stripPng(faces.strip, scale, await piece(strip, px(200) * faces.strip.length, px(strip.h))), left: px(strip.x), top: px(strip.y) });
	return blank(W, H, 1).composite(layers).png().toBuffer();
}

/**
 * The page picture the see-through boards use: a dusk sky drawn here as
 * three gradients, so the boards need no picture file and credit no one.
 */
export function duskPicture(w: number, h: number): string {
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>` +
		`<linearGradient id="s" x1="0" y1="0" x2="0.22" y2="1"><stop offset="0" stop-color="#06143a"/><stop offset="0.38" stop-color="#27277a"/><stop offset="0.72" stop-color="#6d3791"/><stop offset="1" stop-color="#c2527e"/></linearGradient>` +
		`<radialGradient id="g" cx="0.82" cy="1.12" r="0.6"><stop offset="0" stop-color="#ffd690" stop-opacity="0.9"/><stop offset="0.4" stop-color="#ff8a6a" stop-opacity="0.4"/><stop offset="1" stop-color="#ff8a6a" stop-opacity="0"/></radialGradient>` +
		`<radialGradient id="c" cx="0.16" cy="0.06" r="0.62"><stop offset="0" stop-color="#2f8fff" stop-opacity="0.34"/><stop offset="1" stop-color="#2f8fff" stop-opacity="0"/></radialGradient>` +
		`</defs><rect width="${w}" height="${h}" fill="url(#s)"/><rect width="${w}" height="${h}" fill="url(#c)"/><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`
	);
}

// ---- the boards --------------------------------------------------------------

const FONT = "Segoe UI, Arial, sans-serif";
const MONO = "Cascadia Code, Consolas, monospace";
const INK = "#EDEFF4";
const BODY = "#A9AFBC";
const MUTED = "#6B7280";
/** The docs boards' background, and the Marketplace stills' (scripts/marketplace-shots.mjs PAGE_BG). */
const BOARD_BG = "#111318";
const SHOT_BG = "#0B0C0E";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const label = (x: number, y: number, size: number, body: string, o: { fill?: string; anchor?: "start" | "middle" | "end"; weight?: number; family?: string } = {}): string =>
	`<text x="${x}" y="${y}" font-family="${o.family ?? FONT}" font-size="${size}" font-weight="${o.weight ?? 400}" fill="${o.fill ?? INK}" text-anchor="${o.anchor ?? "start"}">${esc(body)}</text>`;
const sheet = (w: number, h: number, bg: string, elements: readonly string[]): Buffer => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${bg}"/>${elements.join("")}</svg>`);
const flatten = (w: number, h: number, bg: string, elements: readonly string[], layers: readonly Layer[]): Promise<Buffer> => sharp(sheet(w, h, bg, elements)).composite([...layers]).png({ compressionLevel: 9 }).toBuffer();

const LOOK_NAMES: Readonly<Record<string, string>> = { theme: "Theme", glass: "Glass", tint: "Tint", outline: "Outline", clear: "Clear", stars: "Stars", dusk: "Dusk", nebula: "Nebula" };
const THEME_NAMES: Readonly<Record<string, string>> = { void: "Void", graphite: "Graphite", ultraviolet: "Ultraviolet", midnight: "Midnight", forest: "Forest", ember: "Ember", paper: "Paper" };

const trend = (encoders: StripEncoders, background: string, theme: string): StripScene => stripScene({ panes: [{ style: "trend", series: ["cpu", "gpu"] }], encoders, background, theme });

const WEBB = { credit: "NASA, ESA, CSA, and STScI", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", changes: "Cropped to the display and resized." } as const;
/** The photographs behind the see-through decks: two Webb pictures from ESA/Webb, cropped to the + XL display. */
export const PICTURES = {
	cliffs: { file: "docs/assets/img/showcase/pictures/cosmic-cliffs.jpg", title: "Cosmic Cliffs in Carina (NIRCam)", source: "https://esawebb.org/images/weic2205a/", ...WEBB },
	deepField: { file: "docs/assets/img/showcase/pictures/webb-deep-field.jpg", title: "Webb's First Deep Field (NIRCam)", source: "https://esawebb.org/images/weic2209a/", ...WEBB }
} as const satisfies Record<string, PictureFile>;

/** The decks the pictures show. */
export const DECKS = {
	stars: { device: "plusxl", look: "stars", theme: "midnight", strip: "dials" },
	dusk: { device: "plusxl", look: "dusk", theme: "ultraviolet", strip: trend(6, "dusk", "ultraviolet") },
	nebula: { device: "plusxl", look: "nebula", theme: "void", strip: stripScene({ panes: [{ style: "area", series: ["hot"] }], encoders: 6, background: "nebula", theme: "void" }) },
	cliffs: { device: "plusxl", look: "tint", theme: "void", strip: trend(6, "tint", "void"), picture: PICTURES.cliffs },
	deepField: { device: "plusxl", look: "outline", theme: "void", strip: "dials", picture: PICTURES.deepField },
	plus: { device: "plus", look: "tint", theme: "void", strip: trend(4, "tint", "void"), picture: duskPicture(800, 480) }
} as const satisfies Record<string, DeckSpec>;

/** The Strip display graphs the strip board stacks, each across a whole + XL strip on Void. */
export const STRIP_ROWS: readonly { readonly name: string; readonly note: string; readonly scene: StripScene }[] = [
	{ name: "Trend", note: "a reading over time, the others as thinner lines", scene: trend(6, "theme", "void") },
	{ name: "Area", note: "Trend with a light fill under the highlighted reading", scene: stripScene({ panes: [{ style: "area", series: ["hot"] }], encoders: 6, background: "theme", theme: "void" }) },
	{ name: "Compare", note: "readings of one unit on one labeled scale", scene: stripScene({ panes: [{ style: "compare", series: ["cpu", "gpu", "hot"] }], encoders: 6, background: "theme", theme: "void" }) },
	{ name: "Lanes", note: "readings of different units, a lane and a scale each", scene: stripScene({ panes: [{ style: "lanes", series: ["hot", "gpuLoad", "gpuPower"] }], encoders: 6, background: "theme", theme: "void" }) },
	{ name: "Heat", note: "one reading as colored time bins", scene: stripScene({ panes: [{ style: "heat", series: ["hot"], bands: [{ key: "f0:0:3", warn: 80, crit: 90 }] }], encoders: 6, background: "theme", theme: "void" }) },
	{ name: "Group", note: "every reading of a folder, a filter or a list", scene: groupScene("auto", 8, 6, "theme", "void") },
	{ name: "Group, Tiles view", note: "a small history graph for each reading", scene: groupScene("tiles", 16, 6, "theme", "void") },
	{ name: "Ambient", note: "many readings as colored lines, with no numbers or scale", scene: ambientScene(12, 6, "theme", "void") },
	{ name: "Meters", note: "current values in large digits, each with a bar against its limits", scene: stripScene({ panes: [{ style: "meters", series: ["cpu", "gpu", "hot", "gpuLoad", "gpuPower", "pump"], bands: [{ key: "f0:0:3", warn: 85, crit: 95 }] }], encoders: 6, background: "theme", theme: "void" }) },
	{ name: "Events", note: "when a Yes/No reading said Yes or a reading passed a limit", scene: stripScene({ panes: [{ style: "events", series: ["throttle", "powerLimit", "hot"], bands: [{ key: "f0:0:3", warn: 80, crit: 90 }] }], encoders: 6, background: "theme", theme: "void" }) },
	{ name: "Equal split", note: "two graphs side by side: here the CPU and RAM usage pair, a Liquid meter in each half", scene: stripScene({ panes: [{ style: "meters", series: ["cpuLoad"], meterLook: "liquid" }, { style: "meters", series: ["memory"], meterLook: "liquid" }], encoders: 6, background: "theme", theme: "void" }) }
];

const KEY_LOOKS = ["theme", "glass", "tint", "outline", "clear"] as const;
const LOOK_CELLS: readonly Cell[] = [one(R.cpu, "sparkline"), DUAL_TEMPS, QUAD];

/** The faces of the key looks board: each look's column, top to bottom. */
function lookFaces(): string[] {
	setupBoards();
	return KEY_LOOKS.flatMap((look) => LOOK_CELLS.map((cell) => compose({ ...cell, theme: "void", textMode: "theme", keyBackground: look }, OK, false, 1)));
}

/** The units board: one two-reading key of both GPUs' free memory, on Auto and with GB and 2 decimals on each reading. */
const UNIT_KEY: Cell = { readingKey: R.vram1.key, keyLayout: "dual", secondaryReadingKey: R.vram2.key, label: "GPU 1", secondaryLabel: "GPU 2" };
const UNIT_CELLS: readonly { readonly name: string; readonly cell: Cell }[] = [
	{ name: "Auto", cell: UNIT_KEY },
	{ name: "GB, 2 decimals", cell: { ...UNIT_KEY, readingFormats: { [R.vram1.key]: { unit: "GB", decimals: "2" }, [R.vram2.key]: { unit: "GB", decimals: "2" } } } }
];

function unitFaces(): string[] {
	setupBoards();
	return UNIT_CELLS.map(({ cell }) => compose({ ...cell, theme: "void", textMode: "theme" }, OK, false, 1));
}

async function unitsBoard(): Promise<Buffer> {
	const size = 240;
	const gap = 72;
	const pad = 48;
	const head = 60;
	const faces = unitFaces();
	const elements: string[] = [];
	const layers: Layer[] = [];
	for (const [i, { name }] of UNIT_CELLS.entries()) {
		const left = pad + i * (size + gap);
		elements.push(label(left + size / 2, 40, 24, name, { anchor: "middle", weight: 600 }));
		layers.push({ input: await keyPng(faces[i] as string, size), left, top: head });
	}
	return flatten(pad * 2 + UNIT_CELLS.length * size + (UNIT_CELLS.length - 1) * gap, head + size + pad, BOARD_BG, elements, layers);
}

export type Board = {
	/** Repo-relative output path. */
	readonly file: string;
	readonly shows: string;
	/** Every production-composed SVG the board draws, in drawing order. */
	readonly faces: () => readonly string[];
	readonly draw: () => Promise<Buffer>;
};

const facesOf = (spec: DeckSpec): string[] => {
	const f = deckFaces(spec);
	return [...f.keys, ...f.strip.filter((s): s is string => s !== null)];
};
const stripOf = (scene: StripScene, device: DeviceName = "plusxl"): string[] => stripFaces(device, scene).filter((s): s is string => s !== null);
const rowOf = (name: string): (typeof STRIP_ROWS)[number] => STRIP_ROWS.find((r) => r.name === name) as (typeof STRIP_ROWS)[number];

// ---- a deck on Elgato's device image -------------------------------------------

/**
 * Elgato's official front-facing image of the Stream Deck + XL (Media Room
 * press kit, "SD + XL (Product Shot) 01", 3840 x 3840 PNG). A whole deck is
 * shown on it, never drawn: Elgato asks that its hardware be depicted with
 * its official resources, and it is a key's cap, not its 112 px image, that
 * sets how close the keys sit (158 px caps on a 176 px pitch here). The file
 * is Elgato's and is not in this repository: put it in
 * release/official-elgato/press-kit/ (ignored) or name its folder in
 * ELGATO_PRESS_KIT. The positions below were measured on that exact file.
 */
const OFFICIAL = {
	file: "SD_XL_Product_Shot_01.png",
	sha256: "4667e7243dd578981982043e83d82f1c807218044e2fb2ea8f287b843f56ec85",
	/** A key cap's box, black outline to black outline. */
	cap: { w: 158, h: 158, radius: 31, left: (c: number) => Math.round(1137 + 176.1 * c), top: [1271, 1446, 1620, 1796] },
	/** The lit window inside a cap box, between the rim highlights. */
	window: { left: 14, top: 13, w: 131, h: 130, radius: 20 },
	/** The clean dark cap (column, row) every cap is redrawn from, so no demo icon's glow stays on a rim. */
	template: { c: 3, r: 2 },
	/** The strip's lit area: six segments of 248.3 px, 124 px tall. */
	strip: { x: 1175, y: 2068, w: 1490, h: 124 },
	/** What a picture keeps of the image: the device and a margin. */
	crop: { left: 928, top: 1096, width: 1984, height: 1776 }
} as const;

/**
 * A + XL deck's faces on Elgato's device image, 1984 x 1776: the device, its
 * caps and every distance are the image's own pixels. Each cap is redrawn
 * from one clean dark cap, the face (over its piece of the page picture for
 * a see-through look) fills the cap's window, and the strip faces fill the
 * strip's lit area.
 */
async function officialDeckPng(spec: DeckSpec): Promise<Buffer> {
	const source = path.join(process.env.ELGATO_PRESS_KIT ?? path.join(ROOT, "release", "official-elgato", "press-kit"), OFFICIAL.file);
	let bytes: Buffer;
	try {
		bytes = readFileSync(source);
	} catch {
		throw new Error(`Elgato's device image is not at ${source}: download "SD + XL (Product Shot) 01" (PNG) from the Stream Deck + XL press kit in the Elgato Media Room, or set ELGATO_PRESS_KIT to its folder`);
	}
	if (createHash("sha256").update(bytes).digest("hex") !== OFFICIAL.sha256) throw new Error(`${source} is not the image the cap positions were measured on`);
	const faces = deckFaces(spec);
	const device = DEVICES[spec.device];
	const panel = panelOf(spec.device);
	const { cap, window: win, strip, template: from, crop } = OFFICIAL;
	const cut = await sharp(bytes).extract({ left: cap.left(from.c), top: cap.top[from.r] as number, width: cap.w, height: cap.h }).png().toBuffer();
	// Only the cap itself, inside its rounded outline: the body around it stays the image's own.
	const template = await sharp(cut).composite([{ input: rounded(cap.w, cap.h, cap.radius), blend: "dest-in" }]).png().toBuffer();
	// The page picture in LCD pixels at 2x: each window shows its own key's piece.
	const P = 2;
	const picture = spec.picture === undefined ? null : await picturePng(spec.picture, panel.w * P, panel.h * P);
	const under = async (rect: PanelRect, w: number, h: number): Promise<ReturnType<typeof sharp>> =>
		picture === null ? blank(w, h, 1) : sharp(await sharp(picture).extract({ left: rect.x * P, top: rect.y * P, width: rect.w * P, height: rect.h * P }).resize(w, h, { fit: "fill" }).png().toBuffer());
	const layers: Layer[] = [];
	for (const [i, svg] of faces.keys.entries()) {
		const c = i % device.columns;
		const r = Math.floor(i / device.columns);
		const left = cap.left(c);
		const top = cap.top[r] as number;
		layers.push({ input: template, left, top });
		const face = await sharp(Buffer.from(svg.replace('width="144" height="144"', `width="${win.w}" height="${win.h}" preserveAspectRatio="none"`))).png().toBuffer();
		const flat = await (await under(keyRect(panel, c, r) as PanelRect, win.w, win.h)).composite([{ input: face, left: 0, top: 0 }]).png().toBuffer();
		layers.push({ input: await sharp(flat).composite([{ input: rounded(win.w, win.h, win.radius), blend: "dest-in" }]).png().toBuffer(), left: left + win.left, top: top + win.top });
	}
	const lcd = panel.strip as PanelRect;
	const slices: Layer[] = [];
	for (const [c, svg] of faces.strip.entries()) if (svg !== null) slices.push({ input: await sharp(sized(svg, 'width="200" height="100"', 200 * P, 100 * P)).png().toBuffer(), left: c * 200 * P, top: 0 });
	const stripFlat = await (await under(lcd, lcd.w * P, lcd.h * P)).composite(slices).png().toBuffer();
	layers.push({ input: await sharp(stripFlat).resize(strip.w, strip.h, { fit: "fill", kernel: "lanczos3" }).png().toBuffer(), left: strip.x, top: strip.y });
	const whole = await sharp(bytes).composite(layers).png().toBuffer();
	return sharp(whole).extract(crop).flatten({ background: SHOT_BG }).png().toBuffer();
}

/** The picture size the docs show a deck at. */
const DECK_PICTURE = { w: 1600, h: 1432 } as const;

const rendered = new Map<string, Promise<Buffer>>();
/** One composite of a deck, shared by every board that shows it. */
function officialOnce(deck: DeckSpec): Promise<Buffer> {
	const name = Object.entries(DECKS).find(([, spec]) => spec === deck)?.[0] ?? "";
	let png = rendered.get(name);
	if (png === undefined) rendered.set(name, (png = officialDeckPng(deck)));
	return png;
}
/** A board's bytes in the format its file name asks for: PNG as drawn, JPEG for a device picture. */
async function encoded(file: string, png: Promise<Buffer>): Promise<Buffer> {
	if (file.endsWith(".jpg")) return sharp(await png).jpeg({ quality: 88, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
	return png;
}
const fit = (png: Buffer, w: number, h: number): Promise<Buffer> => sharp(png).resize(w, h, { kernel: "lanczos3" }).png().toBuffer();
/** A + XL deck on Elgato's device image, at the docs' size. */
const deviceBoard = (file: string, deck: DeckSpec, shows: string): Board => ({ file, shows, faces: () => facesOf(deck), draw: async () => encoded(file, fit(await officialOnce(deck), DECK_PICTURE.w, DECK_PICTURE.h)) });
/** A deck as its bare display: only where no official device image is at hand yet (the Stream Deck +). */
const displayBoard = (file: string, deck: DeckSpec, scale: number, shows: string): Board => ({ file, shows, faces: () => facesOf(deck), draw: () => deckPng(deck, scale) });

async function stripBoard(): Promise<Buffer> {
	const pad = 60;
	const step = 150 + 76;
	const elements: string[] = [];
	const layers: Layer[] = [];
	for (const [i, row] of STRIP_ROWS.entries()) {
		const top = 44 + i * step;
		elements.push(`<text x="${pad}" y="${top + 30}" font-family="${FONT}" font-size="27" font-weight="600" fill="${INK}">${esc(row.name)}<tspan font-size="22" font-weight="400" fill="${BODY}" dx="16">${esc(row.note)}</tspan></text>`);
		layers.push({ input: await stripPng(stripFaces("plusxl", row.scene), 1.5), left: pad, top: top + 50 });
	}
	return flatten(1920, 44 + STRIP_ROWS.length * step + 6, BOARD_BG, elements, layers);
}

/** The home page's small strip picture: three graphs, each across a whole Stream Deck + strip on Void. */
const PLUS_STRIPS: readonly StripScene[] = [
	trend(4, "theme", "void"),
	stripScene({ panes: [{ style: "heat", series: ["hot"], bands: [{ key: "f0:0:3", warn: 80, crit: 90 }] }], encoders: 4, background: "theme", theme: "void" }),
	stripScene({ panes: [{ style: "meters", series: ["cpu", "gpu", "gpuLoad", "gpuPower"] }], encoders: 4, background: "theme", theme: "void" })
];

async function plusStrips(): Promise<Buffer> {
	const gap = 12;
	const layers: Layer[] = [];
	for (const [i, scene] of PLUS_STRIPS.entries()) layers.push({ input: await stripPng(stripFaces("plus", scene), 1), left: 0, top: i * (100 + gap) });
	return blank(800, PLUS_STRIPS.length * (100 + gap) - gap, 0).composite(layers).png({ compressionLevel: 9 }).toBuffer();
}

async function looksBoard(): Promise<Buffer> {
	const size = 168;
	const gap = 28;
	const pad = 44;
	const head = 58;
	const gridW = KEY_LOOKS.length * size + (KEY_LOOKS.length - 1) * gap;
	const gridH = LOOK_CELLS.length * size + (LOOK_CELLS.length - 1) * gap;
	const picture = await picturePng(duskPicture(gridW, gridH), gridW, gridH);
	const faces = lookFaces();
	const elements: string[] = [];
	const layers: Layer[] = [];
	for (const [c, look] of KEY_LOOKS.entries()) {
		const left = c * (size + gap);
		elements.push(label(pad + left + size / 2, 38, 24, LOOK_NAMES[look] as string, { anchor: "middle", weight: 600 }));
		for (let r = 0; r < LOOK_CELLS.length; r++) {
			const top = r * (size + gap);
			const under = await sharp(picture).extract({ left, top, width: size, height: size }).png().toBuffer();
			layers.push({ input: await keyPng(faces[c * LOOK_CELLS.length + r] as string, size, under), left: pad + left, top: head + top });
		}
	}
	return flatten(gridW + pad * 2, head + gridH + pad, BOARD_BG, elements, layers);
}

// Marketplace stills: 1920 x 960 (Elgato's gallery size), framed as the other stills are.
const SHOT = { w: 1920, h: 960 } as const;
const shotText = (title: string, sub: string, foot: string): string[] => [
	label(SHOT.w / 2, 112, 62, title, { anchor: "middle", weight: 700 }),
	label(SHOT.w / 2, 170, 25, sub, { anchor: "middle", fill: BODY }),
	label(SHOT.w / 2, 908, 15, foot, { anchor: "middle", fill: MUTED, family: MONO })
];
const SHOT_STRIPS = ["Trend", "Lanes", "Heat", "Meters"] as const;
async function shotStrip(): Promise<Buffer> {
	const layers: Layer[] = [];
	const elements = shotText("One graph across the touch strip.", "Strip display joins the dials of a Stream Deck + or + XL into one graph, or two side by side.", "sample values drawn by the plugin's renderer · Stream Deck + XL strip");
	for (const [i, name] of SHOT_STRIPS.entries()) {
		const top = 232 + i * 160;
		elements.push(label(150, top + 76, 24, name, { anchor: "end", fill: BODY, weight: 600 }));
		layers.push({ input: await stripPng(stripFaces("plusxl", rowOf(name).scene), 1.35), left: 180, top });
	}
	return flatten(SHOT.w, SHOT.h, SHOT_BG, elements, layers);
}

const SHOT_DECKS = ["stars", "dusk", "nebula"] as const;
async function shotDecks(): Promise<Buffer> {
	const w = 606;
	const h = 542;
	const layers: Layer[] = [];
	const elements = shotText("One picture across the whole deck.", "Background: Stars, Dusk or Nebula. The plugin draws it behind every key, dial and strip graph.", "sample values drawn by the plugin's renderer · device image: Elgato");
	for (const [i, name] of SHOT_DECKS.entries()) {
		const deck = DECKS[name];
		const left = 30 + i * (w + 21);
		layers.push({ input: await fit(await officialOnce(deck), w, h), left, top: 204 });
		elements.push(label(left + w / 2, 790, 26, LOOK_NAMES[deck.look] as string, { anchor: "middle", weight: 600 }) + label(left + w / 2, 822, 20, `on the ${THEME_NAMES[deck.theme] as string} theme`, { anchor: "middle", fill: BODY }));
	}
	return flatten(SHOT.w, SHOT.h, SHOT_BG, elements, layers);
}

async function shotKeys(): Promise<Buffer> {
	const w = 751;
	const h = 672;
	const elements = shotText("Keys over your page picture.", "Background: Glass, Tint, Outline or Clear on a key, as on a dial. Here every key and the strip are on Tint.", `sample values drawn by the plugin's renderer · device image: Elgato · picture: Cosmic Cliffs, ${PICTURES.cliffs.credit} (${PICTURES.cliffs.license}), cropped`);
	return flatten(SHOT.w, SHOT.h, SHOT_BG, elements, [{ input: await fit(await officialOnce(DECKS.cliffs), w, h), left: Math.round((SHOT.w - w) / 2), top: 202 }]);
}

const IMG = "docs/assets/img";

export const BOARDS: readonly Board[] = [
	deviceBoard(`${IMG}/deck-cliffs-1.8.jpg`, DECKS.cliffs, "Elgato's Stream Deck + XL image with Background Tint on every key and on a whole-strip Trend graph, over the Cosmic Cliffs as the page and strip picture, on Void."),
	deviceBoard(`${IMG}/deck-nebula-1.8.jpg`, DECKS.nebula, "Elgato's Stream Deck + XL image with Background Nebula on every key and on a whole-strip Area graph, on Void."),
	deviceBoard(`${IMG}/deck-deep-field-1.8.jpg`, DECKS.deepField, "Elgato's Stream Deck + XL image with Background Outline on every key and on six independent dials, over Webb's First Deep Field as the page and strip picture, on Void."),
	deviceBoard(`${IMG}/deck-dusk-1.8.jpg`, DECKS.dusk, "Elgato's Stream Deck + XL image with Background Dusk on every key and on a whole-strip Trend graph, on Ultraviolet."),
	deviceBoard(`${IMG}/deck-stars-1.8.jpg`, DECKS.stars, "Elgato's Stream Deck + XL image with Background Stars on every key and on six independent dials, on Midnight."),
	displayBoard(`${IMG}/deck-plus-1.8.png`, DECKS.plus, 2, "A Stream Deck + display on Void with Background Tint on every key and on a whole-strip Trend graph, over a dusk gradient as the page picture."),
	{ file: `${IMG}/key-backgrounds-looks-1.8.png`, shows: "Theme, Glass, Tint, Outline and Clear on a one-reading key with a sparkline, a two-reading key and a four-reading key, over a dusk gradient.", faces: lookFaces, draw: looksBoard },
	{ file: `${IMG}/reading-units-1.8.png`, shows: "One two-reading key of two GPUs' free memory (12100 MB and 453 MB) on Void: on Auto, and with GB and 2 decimals set for each reading.", faces: unitFaces, draw: unitsBoard },
	{ file: `${IMG}/strip-graphs-1.8.png`, shows: "The nine Strip display graph styles, Group's Tiles view and an Equal split, each across a whole Stream Deck + XL strip on Void.", faces: () => STRIP_ROWS.flatMap((r) => stripOf(r.scene)), draw: stripBoard },
	{ file: `${IMG}/showcase/strip-detail.png`, shows: "The home page tile: Trend, Heat and Meters, each across a whole Stream Deck + strip on Void.", faces: () => PLUS_STRIPS.flatMap((scene) => stripOf(scene, "plus")), draw: plusStrips },
	{ file: `${IMG}/showcase/deck-backgrounds-detail.jpg`, shows: "The home page tile: the Dusk deck on Elgato's device image, small.", faces: () => facesOf(DECKS.dusk), draw: async () => encoded(".jpg", fit(await officialOnce(DECKS.dusk), 640, 573)) },
	{ file: `${IMG}/showcase/key-backgrounds-detail.jpg`, shows: "The home page tile: the Cosmic Cliffs deck on Elgato's device image, small.", faces: () => facesOf(DECKS.cliffs), draw: async () => encoded(".jpg", fit(await officialOnce(DECKS.cliffs), 640, 573)) },
	{ file: "marketing/shot-10-strip.png", shows: "Marketplace still: Trend, Lanes, Heat and Meters across a whole strip.", faces: () => SHOT_STRIPS.flatMap((n) => stripOf(rowOf(n).scene)), draw: shotStrip },
	{ file: "marketing/shot-11-deck-backgrounds.png", shows: "Marketplace still: the Stars, Dusk and Nebula decks on Elgato's device image, side by side.", faces: () => SHOT_DECKS.flatMap((n) => facesOf(DECKS[n])), draw: shotDecks },
	{ file: "marketing/shot-12-key-backgrounds.png", shows: "Marketplace still: the Tint deck over the Cosmic Cliffs, on Elgato's device image.", faces: () => facesOf(DECKS.cliffs), draw: shotKeys }
];
