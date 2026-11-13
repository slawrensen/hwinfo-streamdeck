// Trend window payload on synthetic data (no HWiNFO, no Stream Deck): the
// SVG size of a whole Sensor Reading key face and a whole two-row Sensor Dial
// face with each window, against the same face drawing the 36-sample line.
// The series are seeded, so two runs on two builds compare like for like.
//
// - flat: one steady value;
// - noisy: independent noise across the whole range on every sample (the
//   worst case: every column spans the strip);
// - spiky: a steady value with small noise and a short spike every 97 s;
// - walk: a slow random walk with small noise (a load-following temperature).
//
// Run: node --import tsx scripts/history-payload.ts
// Sizes are SVG characters before URI encoding (the faces are ASCII apart
// from the degree sign).
import { HistoryStore } from "../src/history/store";
import type { HistoryView, HistoryWindowId } from "../src/history/types";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import { renderDialTwoRow } from "../src/ui/dial-renderer";
import { KEY_TREND_WIDTH_PX, renderReadingKey } from "../src/ui/key-renderer";
import { loadThemes, resolvePalette } from "../src/ui/themes";

const WINDOWS: readonly HistoryWindowId[] = ["1m", "5m", "15m"];
const SECONDS = 1200;

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export type SeriesKind = "flat" | "noisy" | "spiky" | "walk";
export const SERIES_KINDS: readonly SeriesKind[] = ["flat", "noisy", "spiky", "walk"];

/** One value per second for `seconds`, rounded to one decimal like most
 * HWiNFO temperatures and clocks are shown. */
export function seriesValues(kind: SeriesKind, seconds: number, seed = 7): number[] {
	const rnd = mulberry32(seed);
	const out: number[] = [];
	let level = 55;
	for (let i = 0; i < seconds; i++) {
		let v: number;
		switch (kind) {
			case "flat":
				v = 45;
				break;
			case "noisy":
				v = 50 + (rnd() - 0.5) * 10;
				break;
			case "spiky":
				v = 42 + (rnd() - 0.5) + (i % 97 < 2 ? 43 : 0);
				break;
			case "walk":
				level = Math.min(80, Math.max(35, level + (rnd() - 0.5) * 1.6));
				v = level + (rnd() - 0.5);
				break;
		}
		out.push(Math.round(v * 10) / 10);
	}
	return out;
}

function reading(key: string, value: number, label: string): Reading {
	return { key, type: SensorType.Temperature, sensorIndex: 0, id: 1, label, unit: "°C", value, valueMin: value, valueMax: value, valueAvg: value };
}

/** A store holding every window of `keys`, fed one sample per second. */
export function filledStore(series: ReadonlyMap<string, readonly number[]>, seconds = SECONDS): { store: HistoryStore; now: number } {
	const store = new HistoryStore({ now: () => 0 });
	for (const key of series.keys()) store.setInterest(`payload-${key}`, [{ savedKey: key, window: WINDOWS }]);
	let at = 0;
	for (let i = 0; i < seconds; i++) {
		at += 1000;
		const readings = [...series].map(([key, values]) => reading(key, values[i] as number, key));
		const snapshot: SensorSnapshot = { pollTime: i + 1, valueRevision: i + 1, version: 1, revision: 1, sensors: [{ index: 0, id: 0, instance: 0, name: "CPU" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) };
		store.ingest({ kind: "ok", at, snapshot, source: "shared-memory", evidence: true, stampAdvanced: true, evidenceAgeMs: 0 });
	}
	return { store, now: at + 500 };
}

const palette = resolvePalette(loadThemes(), "void", null, "normal");

/** Whole-face sizes for one kind: key and two-row dial, legacy and windows. */
export function faceSizes(kind: SeriesKind): Record<string, number> {
	const a = seriesValues(kind, SECONDS, 7);
	const b = seriesValues(kind, SECONDS, 11);
	const { store, now } = filledStore(new Map([["p:0:1", a], ["p:0:2", b]]));
	const keyBase = { label: "CPU Package", valueText: "56.3", unitText: "°C", statBadge: "", palette };
	const row = (key: string, label: string, history: readonly number[]) => ({ label, valueText: "56", unitText: "°C", selected: key === "p:0:1", valueColor: "#FFFFFF", history: history.slice(-36) });
	const out: Record<string, number> = {
		"key recent": renderReadingKey({ ...keyBase, history: a.slice(-36) }).length,
		"dial recent": renderDialTwoRow({ rows: [row("p:0:1", "CPU", a), row("p:0:2", "GPU", b)], footerText: "", palette }).length
	};
	for (const window of WINDOWS) {
		const view = store.view("p:0:1", window, KEY_TREND_WIDTH_PX, now) as HistoryView;
		out[`key ${window}`] = renderReadingKey({ ...keyBase, timeline: view }).length;
		out[`dial ${window}`] = renderDialTwoRow({
			rows: [
				{ ...row("p:0:1", "CPU", a), timeline: (w: number) => store.view("p:0:1", window, w, now) },
				{ ...row("p:0:2", "GPU", b), timeline: (w: number) => store.view("p:0:2", window, w, now) }
			],
			footerText: "",
			palette
		}).length;
	}
	return out;
}

if (process.argv[1]?.endsWith("history-payload.ts") === true) {
	const table: Record<string, Record<string, number>> = {};
	for (const kind of SERIES_KINDS) table[kind] = faceSizes(kind);
	console.log(JSON.stringify(table, null, "\t"));
}
