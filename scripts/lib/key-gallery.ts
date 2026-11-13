/**
 * Fixed sample data for the key Background study (test/key-background.test.ts
 * and scripts/key-background-bench.ts), not a hardware capture. Every key
 * layout, the graph strips, a stat badge on every layout that has one, the
 * Back tile on each, a snoozed face and an alerting face, all composed
 * through the production compose path.
 */
import { compose, type ReadingSettings } from "../../src/actions/sensor-reading";
import type { KeyAlertView } from "../../src/alerts/key-alerts";
import { SensorType, type Reading, type SensorSnapshot } from "../../src/hwinfo/types";
import { poller, type PollerStatus } from "../../src/poller";

const sample = (id: number, label: string, type: SensorType, unit: string, value: number, valueMin: number, valueMax: number): Reading => ({
	key: `31:0:${id.toString(16)}`, sensorIndex: 0, id, label, type, unit, value, valueMin, valueMax, valueAvg: (valueMin + valueMax) / 2
});

export const GALLERY_READINGS = {
	cpu: sample(1, "CPU Package", SensorType.Temperature, "°C", 56.3, 41, 88.9),
	gpu: sample(2, "GPU Power", SensorType.Power, "W", 18.9, 15.9, 58.9),
	fan: sample(3, "GPU Fan", SensorType.Fan, "RPM", 1840, 0, 2100),
	clock: sample(4, "GPU Clock", SensorType.Clock, "MHz", 2745, 210, 2790),
	hot: sample(5, "GPU Hot Spot", SensorType.Temperature, "°C", 92.3, 50, 95)
} as const;

const R = GALLERY_READINGS;
const readings: Reading[] = Object.values(R);

export const GALLERY_STATUS: Extract<PollerStatus, { state: "ok" }> = {
	state: "ok",
	source: "shared-memory",
	snapshot: { pollTime: 1, version: 2, revision: 0, sensors: [{ index: 0, id: 0x31, instance: 0, name: "Sample sensors" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) } as SensorSnapshot
};

/** The sparkline history the single key's Sparkline display draws. */
const SERIES = Array.from({ length: 36 }, (_, i) => 56 + 9 * Math.sin(i / 3.1) + 3 * Math.cos(i * 1.7));

/** Puts the sample series into the poller's store for the Sparkline faces. */
export function seedGallerySeries(): void {
	poller.subscribeSeries(R.cpu.key);
	const ring = poller.getSeries(R.cpu.key) as number[];
	ring.length = 0;
	ring.push(...SERIES);
}

export type KeyScenario = {
	id: string;
	/** The layout family, for tables: single, dual, triple, quad. */
	layout: "single" | "dual" | "triple" | "quad";
	settings: ReadingSettings;
	returnMark?: boolean;
	alerts?: KeyAlertView;
};

const LIMITS = { warnValue: "80", critValue: "90" };
const dual = { keyLayout: "dual", secondaryReadingKey: R.gpu.key } as const;
const triple = { keyLayout: "triple", secondaryReadingKey: R.gpu.key, quadReadingKey3: R.fan.key } as const;
const quad = { keyLayout: "quad", secondaryReadingKey: R.gpu.key, quadReadingKey3: R.fan.key, quadReadingKey4: R.clock.key } as const;

export const KEY_SCENARIOS: readonly KeyScenario[] = [
	{ id: "single", layout: "single", settings: { readingKey: R.cpu.key } },
	{ id: "single-sparkline", layout: "single", settings: { readingKey: R.cpu.key, displayMode: "sparkline" } },
	{ id: "single-bar", layout: "single", settings: { readingKey: R.cpu.key, displayMode: "bar", ...LIMITS } },
	{ id: "single-ring", layout: "single", settings: { readingKey: R.cpu.key, displayMode: "ring", ...LIMITS } },
	{ id: "single-ring-max", layout: "single", settings: { readingKey: R.cpu.key, displayMode: "ring", statMode: "max", ...LIMITS } },
	{ id: "single-snoozed", layout: "single", settings: { readingKey: R.cpu.key, ...LIMITS }, alerts: { face: { level: "normal", snoozed: "warn" }, slots: [], perRow: false } },
	{ id: "single-crit", layout: "single", settings: { readingKey: R.hot.key, displayMode: "bar", ...LIMITS } },
	{ id: "dual", layout: "dual", settings: { readingKey: R.cpu.key, ...dual } },
	{ id: "dual-max", layout: "dual", settings: { readingKey: R.cpu.key, statMode: "max", ...dual } },
	{ id: "dual-pinned", layout: "dual", settings: { readingKey: R.cpu.key, secondaryStatMode: "avg", ...dual } },
	{ id: "triple", layout: "triple", settings: { readingKey: R.cpu.key, ...triple } },
	{ id: "triple-avg", layout: "triple", settings: { readingKey: R.cpu.key, statMode: "avg", ...triple } },
	{ id: "quad", layout: "quad", settings: { readingKey: R.cpu.key, ...quad } },
	{ id: "quad-labels-min", layout: "quad", settings: { readingKey: R.cpu.key, quadLabels: true, statMode: "min", ...quad } },
	{ id: "back-sparkline", layout: "single", settings: { readingKey: R.cpu.key, displayMode: "sparkline" }, returnMark: true },
	{ id: "back-bar", layout: "single", settings: { readingKey: R.cpu.key, displayMode: "bar", ...LIMITS }, returnMark: true },
	{ id: "back-dual-max", layout: "dual", settings: { readingKey: R.cpu.key, statMode: "max", ...dual }, returnMark: true },
	{ id: "back-triple-avg", layout: "triple", settings: { readingKey: R.cpu.key, statMode: "avg", ...triple }, returnMark: true },
	{ id: "back-quad-min", layout: "quad", settings: { readingKey: R.cpu.key, statMode: "min", ...quad }, returnMark: true }
];

/** One scenario's face under a theme, text mode and key look (undefined
 * leaves the field out), plus any extra settings. */
export function composeKeyScenario(s: KeyScenario, theme: string, textMode: "theme" | "dim" | "custom", look?: unknown, extra: Record<string, unknown> = {}, status: PollerStatus = GALLERY_STATUS): string {
	const settings = {
		...s.settings,
		theme,
		...(textMode === "custom" ? { textMode, textColor: "#FFD60A" } : { textMode }),
		...(look === undefined ? {} : { keyBackground: look }),
		...extra
	} as ReadingSettings;
	return compose(settings, status, s.returnMark === true, undefined, s.alerts);
}
