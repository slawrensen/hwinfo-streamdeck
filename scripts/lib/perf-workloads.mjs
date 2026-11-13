/**
 * The matched workloads of the plugin perf harness (scripts/perf-plugin.mjs).
 * A workload is data: the devices the mock app registers, the global
 * settings it answers with, and the action contexts it makes appear, each
 * with the exact settings document the app would hold. Every subject
 * receives the SAME documents, so a build that does not know a field (1.7.1
 * and stripGroup, historyWindow or calculatedReadings) draws what
 * it draws for that document: that is the matched comparison, and the
 * report names where the older build lacks the feature.
 *
 * Pure: builders take the reading list (the synthetic catalog or the live
 * probe's inventory) and return plain objects.
 */
import { createHash } from "node:crypto";

export const XL = { id: "devXL", name: "Perf + XL", size: { columns: 9, rows: 4 }, type: 13 };
export const PLUS = { id: "devPlus", name: "Perf Plus", size: { columns: 4, rows: 2 }, type: 7 };
export const BIG = { id: "devBig", name: "Perf Deck", size: { columns: 5, rows: 3 }, type: 0 };

export const LOOKS = ["theme", "glass", "tint", "outline", "clear"];
/** Strip groups measure on a 1 minute window so the warm-up fills the
 * graph across every slice: a strip only repaints the slices whose pixels
 * change, so a half-empty window under-states its steady cost. */
export const STRIP_WINDOW = "1m";
const WINDOW_SECONDS = { "1m": 60, "5m": 300, "15m": 900 };
export const WINDOWS = ["1m", "5m", "15m"];
const READING = "com.lawrensen.hwinfo.reading";
const DIAL = "com.lawrensen.hwinfo.dial";

/** n readings spread evenly over the list (stable for a given list). */
export function spread(readings, n) {
	if (readings.length === 0) throw new RangeError("no readings to place");
	return Array.from({ length: n }, (_u, i) => readings[Math.floor((i * readings.length) / n) % readings.length]);
}

/**
 * n readings that change between polls (the catalog marks every fifth
 * reading still; a live inventory carries no mark, so all count), of one
 * unit when `unit` is given. Falls back to the whole list when too few
 * match, so a small live inventory still builds.
 */
export function movingPick(readings, n, unit) {
	const pool = readings.filter((r) => r.moving !== false && (unit === undefined || r.unit === unit));
	return spread(pool.length >= n ? pool : readings, n);
}

function key(context, device, column, row, settings) {
	return { context, action: READING, device: device.id, controller: "Keypad", column, row, settings };
}

function dial(context, device, column, settings) {
	return { context, action: DIAL, device: device.id, controller: "Encoder", column, row: 0, settings };
}

/** 36 keys on the + XL (9 x 4), one reading each; every third draws a
 * sparkline (the e2e-load mix). */
function xlKeys(readings, extra = () => ({})) {
	return spread(readings, 36).map((r, i) => key(`k${i}`, XL, i % 9, Math.floor(i / 9), { readingKey: r.key, ...(i % 3 === 0 ? { displayMode: "sparkline" } : {}), ...extra(i, r) }));
}

function xlDials(readings, look, count = 6, extra = () => ({})) {
	return spread(readings.slice().reverse(), count).map((r, c) => dial(`d${c}`, XL, c, { readingKey: r.key, ...(look === "theme" ? {} : { dialBackground: look }), ...extra(c, r) }));
}

/** A fixed group id per workload: 32 lowercase hex characters. */
export function groupId(name) {
	return createHash("sha256").update(`perf-strip/${name}`).digest("hex").slice(0, 32);
}

/**
 * The stored strip copy every member dial of a group carries
 * (src/strip/settings.ts stripGroupOf): whole draws one trend pane of
 * three temperatures across the strip, split an area pane (one
 * temperature) beside a lanes pane (a temperature and a power).
 */
export function stripCopy(name, layout, encoders, look, series) {
	const pane = (style, keys) => ({ style, series: keys.map((k) => ({ key: k })) });
	const panes = layout === "whole"
		? [pane("trend", series.slice(0, 3)), pane("lanes", series.slice(3, 5))]
		: [pane("area", series.slice(0, 1)), pane("lanes", [series[1], series[3]])];
	return { v: 1, id: groupId(name), rev: 1, joined: true, config: { layout, encoders, window: STRIP_WINDOW, background: look, panes } };
}

/** Power readings of the list (calculated sums hold one unit). */
function powerReadings(readings) {
	return readings.filter((r) => r.unit === "W");
}

export function calcId(n) {
	return `calc:${String(n).padStart(22, "A")}`;
}

/** 32 sums of 8 distinct power readings each (the flat case of
 * scripts/perf-calculated.ts), as stored in globals.calculatedReadings. */
export function calculatedRows(readings) {
	const power = powerReadings(readings);
	if (power.length < 8) throw new RangeError("a calculated workload needs at least 8 power readings");
	return Array.from({ length: 32 }, (_u, d) => ({
		id: calcId(d),
		op: "sum",
		inputs: Array.from({ length: 8 }, (_v, i) => power[(d * 8 + i) % power.length].key),
		unit: "W",
		sensorType: 5
	}));
}

const BASE_GLOBALS = { source: "shared-memory" };

/** Every workload by name: (readings) => workload. */
export const WORKLOADS = {
	sweep: {
		description: "a key for every reading of the catalog (every third a sparkline) plus six dials",
		build: (readings) => ({
			devices: [BIG, XL],
			globals: BASE_GLOBALS,
			contexts: [
				...readings.map((r, i) => key(`k${i}`, BIG, i % 5, Math.floor(i / 5) % 3, { readingKey: r.key, ...(i % 3 === 0 ? { displayMode: "sparkline" } : {}) })),
				...xlDials(readings, "theme")
			]
		})
	},
	deck: {
		description: "+ XL: 36 single-reading keys (every third a sparkline) and six Theme dials",
		build: (readings) => ({ devices: [XL], globals: BASE_GLOBALS, contexts: [...xlKeys(readings), ...xlDials(readings, "theme")] })
	},
	dense: {
		description: "+ XL: 36 quad keys (144 readings) and six Theme dials",
		build: (readings) => {
			const four = spread(readings, 144);
			return {
				devices: [XL],
				globals: BASE_GLOBALS,
				contexts: [
					...Array.from({ length: 36 }, (_u, i) => key(`k${i}`, XL, i % 9, Math.floor(i / 9), {
						keyLayout: "quad",
						readingKey: four[i * 4].key,
						secondaryReadingKey: four[i * 4 + 1].key,
						quadReadingKey3: four[i * 4 + 2].key,
						quadReadingKey4: four[i * 4 + 3].key
					})),
					...xlDials(readings, "theme")
				]
			};
		}
	},
	...Object.fromEntries(LOOKS.map((look) => [`dials-${look}`, {
		description: `+ XL: six independent dials, Background ${look}`,
		build: (readings) => ({ devices: [XL], globals: BASE_GLOBALS, contexts: xlDials(readings, look) })
	}])),
	"dials-plus": {
		description: "+: four independent Theme dials",
		build: (readings) => ({ devices: [PLUS], globals: BASE_GLOBALS, contexts: spread(readings.slice().reverse(), 4).map((r, c) => dial(`d${c}`, PLUS, c, { readingKey: r.key })) })
	},
	...Object.fromEntries([["xl", XL, 6], ["plus", PLUS, 4]].flatMap(([tag, device, encoders]) => ["whole", "split"].flatMap((layout) => (tag === "xl" && layout === "whole" ? LOOKS : ["theme"]).map((look) => {
		const name = `strip-${layout}-${tag}${look === "theme" ? "" : `-${look}`}`;
		return [name, {
			description: `${device === XL ? "+ XL" : "+"}: ${encoders} dials joined as ${layout === "whole" ? "a whole strip" : "an equal split"} on a ${STRIP_WINDOW} window, Background ${look} (1.7.1 draws the same documents as ${encoders} independent dials)`,
			fillS: WINDOW_SECONDS[STRIP_WINDOW],
			build: (readings) => {
				const series = [...movingPick(readings, 3, "°C"), ...movingPick(readings, 2, "W")].map((r) => r.key);
				const copy = stripCopy(name, layout, encoders, look, series);
				return {
					devices: [device],
					globals: BASE_GLOBALS,
					contexts: spread(readings.slice().reverse(), encoders).map((r, c) => dial(`d${c}`, device, c, { readingKey: r.key, ...(look === "theme" ? {} : { dialBackground: look }), stripGroup: copy }))
				};
			}
		}];
	})))),
	"trend-none": {
		description: "+ XL: 36 sparkline keys and six two-row dials, no Trend window",
		build: (readings) => trendDeck(readings, undefined)
	},
	...Object.fromEntries(WINDOWS.map((w) => [`trend-${w}`, {
		description: `+ XL: 36 sparkline keys and six two-row dials on a ${w} Trend window (1.7.1 ignores the window)`,
		fillS: WINDOW_SECONDS[w],
		build: (readings) => trendDeck(readings, w)
	}])),
	calc32: {
		description: "+ XL: 32 keys on 32 calculated readings (sums of 8 power readings), 4 plain keys, six dials (1.7.1 has no calculated readings: those keys draw Sensor missing)",
		build: (readings) => {
			const rows = calculatedRows(readings);
			const plain = movingPick(readings, 4);
			return {
				devices: [XL],
				globals: { ...BASE_GLOBALS, calculatedReadings: rows },
				contexts: [
					...rows.map((row, i) => key(`k${i}`, XL, i % 9, Math.floor(i / 9), { readingKey: row.id })),
					...plain.map((r, i) => key(`k${32 + i}`, XL, (32 + i) % 9, 3, { readingKey: r.key })),
					...xlDials(readings, "theme")
				]
			};
		}
	},
	"calc32-base": {
		description: "calc32's deck with each calculated key on its first input instead, and no calculated readings",
		build: (readings) => {
			const rows = calculatedRows(readings);
			const plain = movingPick(readings, 4);
			return {
				devices: [XL],
				globals: BASE_GLOBALS,
				contexts: [
					...rows.map((row, i) => key(`k${i}`, XL, i % 9, Math.floor(i / 9), { readingKey: row.inputs[0] })),
					...plain.map((r, i) => key(`k${32 + i}`, XL, (32 + i) % 9, 3, { readingKey: r.key })),
					...xlDials(readings, "theme")
				]
			};
		}
	}
};

function trendDeck(readings, window) {
	const keys = spread(readings, 36).map((r, i) => key(`k${i}`, XL, i % 9, Math.floor(i / 9), { readingKey: r.key, displayMode: "sparkline", ...(window === undefined ? {} : { historyWindow: window }) }));
	const pairs = spread(readings.slice().reverse(), 12);
	const dials = Array.from({ length: 6 }, (_u, c) => dial(`d${c}`, XL, c, {
		dialView: "tworow",
		readingKey: pairs[c * 2].key,
		rotationKeys: [pairs[c * 2].key, pairs[c * 2 + 1].key],
		...(window === undefined ? {} : { dialHistoryWindow: window })
	}));
	return { devices: [XL], globals: BASE_GLOBALS, contexts: [...keys, ...dials] };
}

/** The willAppear message for one context. */
export function appearMessage(ctx) {
	return {
		event: "willAppear",
		action: ctx.action,
		context: ctx.context,
		device: ctx.device,
		payload: { settings: ctx.settings, coordinates: { column: ctx.column, row: ctx.row }, controller: ctx.controller, isInMultiAction: false }
	};
}

export function disappearMessage(ctx) {
	return { ...appearMessage(ctx), event: "willDisappear" };
}

export function buildWorkload(name, readings) {
	const def = WORKLOADS[name];
	if (def === undefined) throw new RangeError(`unknown workload ${name}; known: ${Object.keys(WORKLOADS).join(", ")}`);
	return { name, description: def.description, fillS: def.fillS ?? 0, ...def.build(readings) };
}
