// Face formatting microbenchmark on synthetic data (no HWiNFO, no Stream
// Deck): what composing one key face (each layout) and one dial face (single
// and three-row overview) costs for byte readings, with the per-reading
// formats of issue #59 absent and present, plus the formatter alone. It
// times the pure compose path only, never the plugin process, the socket or
// the app's SVG drawing. A tree without per-reading formats composes the
// "present" rows exactly like the "absent" ones (the field is ignored), so
// running this same file in the commit before the feature gives the
// baseline for both.
//
// Run: node --expose-gc --import tsx scripts/bench-format.ts [label]
// BENCH_ITERS (default 4000) calls per round, BENCH_ROUNDS (default 7)
// rounds; each row reports the median round in microseconds per call.
import { composeDialSvg, type DialSettings } from "../src/actions/sensor-dial";
import { compose, type ReadingSettings } from "../src/actions/sensor-reading";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import type { PollerStatus } from "../src/poller";
import { SessionStatsStore } from "../src/stats";
import { setFaceFont } from "../src/ui/face-font";
import { formatMeasurement, type MeasureOptions } from "../src/ui/measure";

const ITERS = Number(process.env.BENCH_ITERS ?? "4000");
const ROUNDS = Number(process.env.BENCH_ROUNDS ?? "7");
const gc = (globalThis as { gc?: () => void }).gc;
if (gc === undefined) {
	console.error("Run with --expose-gc: node --expose-gc --import tsx scripts/bench-format.ts");
	process.exit(1);
}
setFaceFont("tahoma");

const G0 = "a1:0:5";
const G1 = "a2:0:5";
const G2 = "a1:0:6";
const T0 = "a1:0:1";
const rows: Array<[string, string, string, number, SensorType]> = [
	[G0, "GPU Memory Available", "MB", 453, SensorType.Other],
	[G1, "GPU Memory Available", "MB", 12100, SensorType.Other],
	[G2, "GPU Memory Allocated", "MB", 3020, SensorType.Other],
	[T0, "GPU Temperature", "°C", 61.3, SensorType.Temperature],
	["c3:0:1", "Total Host Writes", "GB", 12345.6, SensorType.Other],
	["d4:0:1", "Current DL rate", "KB/s", 607.54, SensorType.Other],
	["d4:0:2", "Read Rate", "MB/s", 12.5, SensorType.Other],
	["a1:0:2", "GPU Fan", "RPM", 1840, SensorType.Fan],
	["a1:0:3", "GPU Core Load", "%", 37.5, SensorType.Usage],
	["a1:0:4", "GPU Power", "W", 212.4, SensorType.Power],
	["a1:0:7", "GPU Clock", "MHz", 2745, SensorType.Clock],
	["a1:0:8", "Thermal Throttling", "Yes/No", 0, SensorType.Other],
	["a1:0:9", "Unavailable", "°C", Number.NaN, SensorType.Temperature]
];
const readings: Reading[] = rows.map(([key, label, unit, value, type]) => ({ key, type, sensorIndex: 0, id: 1, label, unit, value, valueMin: value * 0.8, valueMax: value * 1.2, valueAvg: value }));
const snapshot: SensorSnapshot = { pollTime: 1, version: 2, revision: 1, sensors: [{ index: 0, id: 0xa1, instance: 0, name: "GPU [#0]" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) };
const status: PollerStatus = { state: "ok", snapshot, source: "shared-memory" };
const stats = new SessionStatsStore();
for (const r of readings) stats.observe(r, snapshot, "shared-memory");

const GB2 = { unit: "GB", decimals: "2" };
const FORMATS = { [G0]: GB2, [G1]: GB2, [G2]: { decimals: "1" } };
const keyCases: Array<[string, ReadingSettings]> = [
	["key single", { readingKey: G1, decimals: "2" }],
	["key dual", { readingKey: G0, keyLayout: "dual", secondaryReadingKey: G1 }],
	["key triple", { readingKey: G0, keyLayout: "triple", secondaryReadingKey: G1, quadReadingKey3: T0 }],
	["key quad", { readingKey: G0, keyLayout: "quad", secondaryReadingKey: G1, quadReadingKey3: G2, quadReadingKey4: T0 }]
];
const dialCases: Array<[string, DialSettings]> = [
	["dial single", { readingKey: G1, decimals: "2" }],
	["dial three rows", { dialView: "overview", readingKey: G1, rotationKeys: [G0, G1, T0] }]
];

function bench(fn: () => unknown): number {
	for (let i = 0; i < Math.min(ITERS, 2000); i++) fn();
	const rounds: number[] = [];
	let sink = 0;
	for (let r = 0; r < ROUNDS; r++) {
		gc?.();
		const t0 = process.hrtime.bigint();
		for (let i = 0; i < ITERS; i++) {
			const out = fn();
			if (typeof out === "string") sink += out.length;
		}
		rounds.push(Number(process.hrtime.bigint() - t0) / ITERS / 1000);
	}
	if (sink < 0) console.log(sink);
	rounds.sort((a, b) => a - b);
	return Math.round((rounds[Math.floor(rounds.length / 2)] as number) * 100) / 100;
}

const out: Record<string, number> = {};
const DEC: MeasureOptions = { decimals: "auto", fahrenheit: false, dataUnits: "decimal" };
out["formatMeasurement x13, Auto"] = bench(() => {
	let n = 0;
	for (const r of readings) n += formatMeasurement(r.value, r.unit, DEC).valueText.length;
	return n;
});
for (const [name, settings] of keyCases) {
	out[`${name}, no formats`] = bench(() => compose(settings, status));
	out[`${name}, formats`] = bench(() => compose({ ...settings, readingFormats: FORMATS } as ReadingSettings, status));
}
for (const [name, settings] of dialCases) {
	const state = (s: DialSettings): Parameters<typeof composeDialSvg>[0] => ({ settings: s, stats, statMode: "current", overlay: null, pinned: false, cyclePaused: false });
	out[`${name}, no formats`] = bench(() => composeDialSvg(state(settings), status, () => undefined));
	out[`${name}, formats`] = bench(() => composeDialSvg(state({ ...settings, readingFormats: FORMATS } as DialSettings), status, () => undefined));
}
console.log(JSON.stringify({ label: process.argv[2] ?? "", node: process.version, iters: ITERS, rounds: ROUNDS, usPerCall: out }));
