/**
 * Byte and rate faces from settings alone, on every surface that formats a
 * reading: the key layouts (single with each strip, dual, triple, quad),
 * the dial views (single, two rows, three rows, a rotation step), detail
 * tiles (one to four readings, uniform and hand-grouped) and the Back tile
 * with its unconfigured fallback. Decimal and Binary data units, Tahoma and
 * Segoe UI, Decimals Auto, 0, 2 and 3, the current value and a stat.
 *
 * test/golden/format-legacy-faces.json was written by running this same
 * module against the v1.7.1 sources (tag v1.7.1, bb4aede), so the faces it
 * composes are proven to be what 1.7.1 drew from the same settings. The
 * optional transform lets the test add fields 1.7.1 never knew (for
 * example readingFormats that hold nothing for these readings) and hold
 * the result to the same bytes. Nothing here reads the poller singleton's
 * series: keys draw no sparkline history and dials take an empty history.
 */
import { composeDialSvg, type DialSettings } from "../src/actions/sensor-dial";
import { backFallbackSettings, compose, type ReadingSettings } from "../src/actions/sensor-reading";
import { composeBackFace, composeChunkFace, composeReadingFace, type DetailFaceContext } from "../src/detail/detail-faces";
import type { DetailTileSpec } from "../src/detail/detail-settings";
import type { DeviceDetailState } from "../src/detail/navigation";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import type { PollerStatus } from "../src/poller";
import { SessionStatsStore } from "../src/stats";
import type { StatMode } from "../src/ui/format";
import { applyGlobalThemeSettings, effectiveTextFor, measureOptionsFrom } from "../src/ui/theme-store";
import { loadThemes } from "../src/ui/themes";

export const G0 = "a1:0:5";
export const G1 = "a2:0:5";
export const G0_ALLOC = "a1:0:6";
export const TEMP = "a1:0:1";
export const DISK = "c3:0:1";
export const NET_DL = "d4:0:1";
export const NET_RATE = "d4:0:2";
export const LINK = "d4:0:3";
export const ZERO = "a1:0:7";
export const NEG = "e5:0:1";
export const TINY = "e5:0:2";
export const GONE = "e5:0:3";
export const NO_STATS = "e5:0:4";
export const HUGE = "c3:0:2";

type Spec = { key: string; sensor: number; label: string; unit: string; value: number; min: number; max: number; avg: number; type: SensorType; statistics?: "unavailable" };

const SPECS: readonly Spec[] = [
	{ key: G0, sensor: 0, label: "GPU Memory Available", unit: "MB", value: 453, min: 300, max: 12100, avg: 3020, type: SensorType.Other },
	{ key: G1, sensor: 1, label: "GPU Memory Available", unit: "MB", value: 12100, min: 3020, max: 16303, avg: 9000.5, type: SensorType.Other },
	{ key: G0_ALLOC, sensor: 0, label: "GPU Memory Allocated", unit: "MB", value: 3020, min: 0, max: 3020, avg: 1500, type: SensorType.Other },
	{ key: TEMP, sensor: 0, label: "GPU Temperature", unit: "°C", value: 61.3, min: 40, max: 72.5, avg: 55, type: SensorType.Temperature },
	{ key: DISK, sensor: 2, label: "Total Host Writes", unit: "GB", value: 12345.6, min: 12300, max: 12345.6, avg: 12320, type: SensorType.Other },
	{ key: NET_DL, sensor: 3, label: "Current DL rate", unit: "KB/s", value: 607.54, min: 0, max: 98000, avg: 1200, type: SensorType.Other },
	{ key: NET_RATE, sensor: 3, label: "Read Rate", unit: "MB/s", value: 12.5, min: 0, max: 1650, avg: 40, type: SensorType.Other },
	{ key: LINK, sensor: 3, label: "Link Speed", unit: "Mbps", value: 940, min: 940, max: 940, avg: 940, type: SensorType.Other },
	{ key: ZERO, sensor: 0, label: "GPU Memory Free Shared", unit: "MB", value: 0, min: 0, max: 0, avg: 0, type: SensorType.Other },
	{ key: NEG, sensor: 4, label: "VRAM Headroom", unit: "MB", value: -3.5, min: -120, max: 800, avg: 40, type: SensorType.Other, statistics: "unavailable" },
	{ key: TINY, sensor: 4, label: "Swap Delta", unit: "MB", value: 0.0004, min: 0, max: 0.002, avg: 0.0007, type: SensorType.Other },
	{ key: GONE, sensor: 4, label: "Dropped Value", unit: "MB", value: Number.NaN, min: Number.NaN, max: Number.NaN, avg: Number.NaN, type: SensorType.Other, statistics: "unavailable" },
	{ key: NO_STATS, sensor: 4, label: "Gadget VRAM", unit: "MB", value: 999.6, min: Number.NaN, max: Number.NaN, avg: Number.NaN, type: SensorType.Other, statistics: "unavailable" },
	{ key: HUGE, sensor: 2, label: "Data Read", unit: "GB", value: 4_000_000, min: 3_999_000, max: 4_000_000, avg: 3_999_500, type: SensorType.Other }
];

/** One snapshot; `drift` moves every finite value a little so dial session
 * stats see a low, a high and a current value that differ. */
export function snapshotAt(drift = 0): SensorSnapshot {
	const readings: Reading[] = SPECS.map((s) => ({
		key: s.key,
		type: s.type,
		sensorIndex: s.sensor,
		id: Number.parseInt(s.key.split(":")[2] ?? "0", 16),
		label: s.label,
		unit: s.unit,
		value: s.value * (1 + drift),
		valueMin: s.min,
		valueMax: s.max,
		valueAvg: s.avg,
		...(s.statistics === undefined ? {} : { statistics: s.statistics })
	}));
	return {
		pollTime: 100,
		version: 2,
		revision: 1,
		sensors: [
			{ index: 0, id: 0xa1, instance: 0, name: "GPU [#0]: NVIDIA GeForce RTX 5080" },
			{ index: 1, id: 0xa2, instance: 0, name: "GPU [#1]: NVIDIA GeForce RTX 3060" },
			{ index: 2, id: 0xc3, instance: 0, name: "S.M.A.R.T.: Samsung SSD 990 PRO" },
			{ index: 3, id: 0xd4, instance: 0, name: "Network: Intel Ethernet" },
			{ index: 4, id: 0xe5, instance: 0, name: "Calculated" }
		],
		readings,
		byKey: new Map(readings.map((r) => [r.key, r]))
	};
}

const DATA_KEYS = [G0, G1, DISK, NET_DL, NET_RATE, LINK, ZERO, NEG, TINY, GONE, NO_STATS, HUGE];

type Settings = Record<string, unknown>;
type Transform = (settings: Settings) => Settings;

function keyCases(): Array<[string, Settings]> {
	const out: Array<[string, Settings]> = [];
	for (const key of DATA_KEYS) {
		for (const decimals of [undefined, "0", "2", "3"]) {
			out.push([`single ${key} decimals ${decimals ?? "auto"}`, { readingKey: key, ...(decimals === undefined ? {} : { decimals }) }]);
		}
		out.push([`single ${key} max`, { readingKey: key, statMode: "max" }]);
		out.push([`single ${key} avg decimals 2`, { readingKey: key, statMode: "avg", decimals: "2" }]);
	}
	out.push(
		["single bar G1", { readingKey: G1, displayMode: "bar" }],
		["single ring G1 decimals 2", { readingKey: G1, displayMode: "ring", decimals: "2" }],
		["single ring G0", { readingKey: G0, displayMode: "ring" }],
		["single ring HUGE decimals 3", { readingKey: HUGE, displayMode: "ring", decimals: "3" }],
		["single none NET_DL", { readingKey: NET_DL, displayMode: "none" }],
		["single warn on G1", { readingKey: G1, warnValue: "10000", critValue: "20000" }],
		["single crit below on G0", { readingKey: G0, warnValue: "2000", critValue: "1000", alertBelow: true }],
		["single fahrenheit G1", { readingKey: G1, fahrenheit: true, decimals: "1" }],
		["single labeled G1", { readingKey: G1, label: "GPU1 VRAM" }],
		["dual G0 G1", { readingKey: G0, keyLayout: "dual", secondaryReadingKey: G1 }],
		["dual G0 G1 decimals 2", { readingKey: G0, keyLayout: "dual", secondaryReadingKey: G1, decimals: "2" }],
		["dual G0 G1 decimals 3 labels", { readingKey: G0, keyLayout: "dual", secondaryReadingKey: G1, decimals: "3", label: "GPU 0", secondaryLabel: "GPU 1" }],
		["dual G1 max under G0", { readingKey: G1, keyLayout: "dual", secondaryReadingKey: G0, secondaryStatMode: "max" }],
		["dual rates", { readingKey: NET_DL, keyLayout: "dual", secondaryReadingKey: NET_RATE }],
		["dual HUGE TINY decimals 3", { readingKey: HUGE, keyLayout: "dual", secondaryReadingKey: TINY, decimals: "3" }],
		["triple G0 G1 TEMP", { readingKey: G0, keyLayout: "triple", secondaryReadingKey: G1, quadReadingKey3: TEMP }],
		["triple G0 G1 TEMP decimals 2", { readingKey: G0, keyLayout: "triple", secondaryReadingKey: G1, quadReadingKey3: TEMP, decimals: "2" }],
		["triple G0 G1 TEMP decimals 3 labels", { readingKey: G0, keyLayout: "triple", secondaryReadingKey: G1, quadReadingKey3: TEMP, decimals: "3", label: "GPU 0", secondaryLabel: "GPU 1", quadLabel3: "Temp" }],
		["triple rates and disk", { readingKey: NET_DL, keyLayout: "triple", secondaryReadingKey: NET_RATE, quadReadingKey3: DISK }],
		["triple max", { readingKey: G0, keyLayout: "triple", secondaryReadingKey: G1, quadReadingKey3: NO_STATS, statMode: "max" }],
		["quad", { readingKey: G0, keyLayout: "quad", secondaryReadingKey: G1, quadReadingKey3: G0_ALLOC, quadReadingKey4: DISK }],
		["quad decimals 2", { readingKey: G0, keyLayout: "quad", secondaryReadingKey: G1, quadReadingKey3: G0_ALLOC, quadReadingKey4: DISK, decimals: "2" }],
		["quad decimals 3 labeled", { readingKey: G0, keyLayout: "quad", secondaryReadingKey: G1, quadReadingKey3: G0_ALLOC, quadReadingKey4: DISK, decimals: "3", quadLabels: true }],
		["quad rates labeled", { readingKey: NET_DL, keyLayout: "quad", secondaryReadingKey: NET_RATE, quadReadingKey3: LINK, quadReadingKey4: TEMP, quadLabels: true }],
		["quad edges", { readingKey: ZERO, keyLayout: "quad", secondaryReadingKey: NEG, quadReadingKey3: TINY, quadReadingKey4: HUGE }],
		["quad max", { readingKey: G0, keyLayout: "quad", secondaryReadingKey: G1, quadReadingKey3: NO_STATS, quadReadingKey4: GONE, statMode: "max" }]
	);
	return out;
}

const ROTATION = [G0, G1, TEMP];
const RATE_ROTATION = [NET_DL, NET_RATE, DISK];

function dialCases(): Array<[string, Settings, { statMode?: StatMode; pinned?: boolean; cyclePaused?: boolean }]> {
	const out: Array<[string, Settings, { statMode?: StatMode; pinned?: boolean; cyclePaused?: boolean }]> = [];
	for (const key of DATA_KEYS) {
		out.push([`single ${key}`, { readingKey: key }, {}]);
		out.push([`single ${key} decimals 2`, { readingKey: key, decimals: "2" }, {}]);
	}
	out.push(
		["single G1 decimals 3 max", { readingKey: G1, decimals: "3" }, { statMode: "max" }],
		["single G1 pinned", { readingKey: G1, decimals: "2" }, { pinned: true }],
		["single G0 cycle paused", { readingKey: G0, decimals: "2", rotationKeys: ROTATION }, { cyclePaused: true }],
		["single G1 with rotation", { readingKey: G1, rotationKeys: ROTATION }, {}],
		["single G1 bar range", { readingKey: G1, barMin: "0", barMax: "16303", decimals: "1" }, {}],
		["single G1 clear background", { readingKey: G1, decimals: "2", dialBackground: "clear" }, {}],
		["tworow G0", { dialView: "tworow", readingKey: G0, rotationKeys: ROTATION }, {}],
		["tworow G1 decimals 2", { dialView: "tworow", readingKey: G1, rotationKeys: ROTATION, decimals: "2" }, {}],
		["tworow rates", { dialView: "tworow", readingKey: NET_DL, rotationKeys: RATE_ROTATION }, {}],
		["tworow G1 pinned decimals 3", { dialView: "tworow", readingKey: G1, rotationKeys: ROTATION, decimals: "3" }, { pinned: true }],
		["overview G1", { dialView: "overview", readingKey: G1, rotationKeys: ROTATION }, {}],
		["overview G0 decimals 2", { dialView: "overview", readingKey: G0, rotationKeys: ROTATION, decimals: "2" }, {}],
		["overview rates decimals 3", { dialView: "overview", readingKey: NET_RATE, rotationKeys: RATE_ROTATION, decimals: "3" }, {}],
		["overview edges", { dialView: "overview", readingKey: NEG, rotationKeys: [ZERO, NEG, HUGE] }, { cyclePaused: true }]
	);
	return out;
}

function detailState(presentation: Settings, primaryKey: string, keys: readonly string[]): DeviceDetailState {
	return {
		deviceId: "dev1",
		pageSize: 11,
		density: 1,
		tilePlan: [],
		primaryKey,
		groupSettings: { readingKey: primaryKey },
		presentation: presentation as DeviceDetailState["presentation"],
		group: { mode: "source", primaryKey, title: "GPU [#1]", keys: [...keys] },
		offset: 0,
		statModes: new Map(),
		surfaceCount: 1,
		pending: false,
		dispatchedAt: 0,
		openerCell: null,
		mirrorSlotIndex: null
	};
}

/** The detail context as the controller builds it from the opener's
 * presentation (the same theme-store authorities compose reads). */
function detailContext(presentation: Settings): DetailFaceContext {
	const config = loadThemes();
	return { config, deckThemeId: config.defaultTheme, typeAccents: true, measure: measureOptionsFrom(presentation), text: effectiveTextFor(presentation) };
}

const SPEC2: DetailTileSpec = { size: 2, labels: ["GPU 0", "GPU 1"], colors: [null, null], cellLabels: true };
const SPEC4: DetailTileSpec = { size: 4, labels: ["G0", "G1", "", "SSD"], colors: [null, null, null, null], cellLabels: true };

function detailCases(): Array<[string, Settings, string, readonly string[], StatMode, DetailTileSpec | undefined]> {
	return [
		["reading G1", {}, G1, [G1], "current", undefined],
		["reading G1 decimals 2", { decimals: "2" }, G1, [G1], "current", undefined],
		["reading G0 max decimals 3", { decimals: "3" }, G0, [G0], "max", undefined],
		["reading NO_STATS min", {}, NO_STATS, [NO_STATS], "min", undefined],
		["reading NET_DL", {}, NET_DL, [NET_DL], "current", undefined],
		["dual G0 G1", {}, G1, [G0, G1], "current", undefined],
		["dual G0 G1 decimals 2 spec", { decimals: "2" }, G1, [G0, G1], "current", SPEC2],
		["triple G0 G1 TEMP decimals 2", { decimals: "2" }, G1, [G0, G1, TEMP], "current", undefined],
		["triple rates avg", {}, NET_DL, [NET_DL, NET_RATE, LINK], "avg", undefined],
		["quad", {}, G1, [G0, G1, G0_ALLOC, DISK], "current", undefined],
		["quad decimals 2", { decimals: "2" }, G1, [G0, G1, G0_ALLOC, DISK], "current", undefined],
		["quad decimals 3 spec", { decimals: "3" }, G1, [G0, G1, G0_ALLOC, DISK], "current", SPEC4],
		["quad edges max", {}, ZERO, [ZERO, NEG, TINY, HUGE], "max", undefined]
	];
}

const BACK_CASES: Array<[string, Settings, string]> = [
	["G1", {}, G1],
	["G1 decimals 2 labeled", { decimals: "2", label: "GPU1 VRAM" }, G1],
	["G0 warn", { warnValue: "2000", critValue: "1000", alertBelow: true }, G0],
	["NET_RATE decimals 3", { decimals: "3" }, NET_RATE],
	["HUGE decimals 0", { decimals: "0" }, HUGE]
];

function sessionStats(): SessionStatsStore {
	const stats = new SessionStatsStore();
	for (const drift of [0.1, -0.2, 0]) {
		const snapshot = snapshotAt(drift);
		for (const reading of snapshot.readings) stats.observe(reading, snapshot, "shared-memory");
	}
	return stats;
}

function pass(prefix: string, transform: Transform): Record<string, string> {
	const status: PollerStatus = { state: "ok", snapshot: snapshotAt(0), source: "shared-memory" };
	const stats = sessionStats();
	const faces: Record<string, string> = {};
	for (const [name, settings] of keyCases()) faces[`${prefix}key: ${name}`] = compose(transform(settings) as ReadingSettings, status);
	for (const [name, settings, view] of dialCases()) {
		faces[`${prefix}dial: ${name}`] = composeDialSvg({ settings: transform(settings) as DialSettings, stats, statMode: view.statMode ?? "current", overlay: null, pinned: view.pinned === true, cyclePaused: view.cyclePaused === true }, status, () => undefined);
	}
	for (const [name, presentation, primary, keys, mode, spec] of detailCases()) {
		const p = transform(presentation);
		const state = detailState(p, primary, keys);
		faces[`${prefix}detail: ${name}`] = keys.length === 1 ? composeReadingFace(state, keys[0], mode, status, detailContext(p)) : composeChunkFace(state, keys, mode, status, detailContext(p), spec);
	}
	for (const [name, presentation, primary] of BACK_CASES) {
		const p = transform(presentation);
		const state = detailState(p, primary, [G0, G1]);
		faces[`${prefix}back: ${name}`] = composeBackFace(state, status, detailContext(p));
		faces[`${prefix}back fallback: ${name}`] = compose(backFallbackSettings(state), status, true);
	}
	return faces;
}

/** Every face under Decimal and Tahoma, then a Binary pass and a Segoe UI
 * pass; the deck-wide settings are put back to the defaults afterwards. */
export function formatLegacyFaces(transform: Transform = (s) => s): Record<string, string> {
	try {
		applyGlobalThemeSettings({ dataUnits: "decimal", textFont: "tahoma" });
		const faces = pass("", transform);
		applyGlobalThemeSettings({ dataUnits: "binary", textFont: "tahoma" });
		Object.assign(faces, pass("binary ", transform));
		applyGlobalThemeSettings({ dataUnits: "decimal", textFont: "segoe-ui" });
		Object.assign(faces, pass("segoe ", transform));
		return faces;
	} finally {
		applyGlobalThemeSettings({ dataUnits: "decimal", textFont: "tahoma" });
	}
}
