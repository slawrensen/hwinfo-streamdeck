/**
 * Per-tick cost of calculated readings (steer 7G), for PERF.md: the poller's
 * derive step (applyReadingLinks, then withCalculatedReadings) over a
 * synthetic 600-reading Shared Memory snapshot, with 0 definitions (the
 * 1.7.1 path: the provider's own snapshot comes back), 32 flat definitions
 * of 8 inputs, and the nested worst case at the depth limit (3). Also the
 * session catalog's per-tick cost with an unchanged skeleton (the parser's
 * same instance) and with a rebuilt one.
 *
 * Run: npx tsx scripts/perf-calculated.ts [iterations]
 * Numbers are wall time on this machine, one thread, after a warm-up; they
 * vary between runs and machines, so PERF.md quotes them with the machine.
 */
import { calculatedInfoOf, parseCalculatedReadings, withCalculatedReadings, type CalculatedPlan } from "../src/hwinfo/calculated";
import { ReadingCatalog } from "../src/hwinfo/link-pairing";
import { applyReadingLinks, parseReadingLinks } from "../src/hwinfo/reading-links";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";

const ITERATIONS = Number(process.argv[2] ?? "") || 5000;
const READINGS = 600;
const key = (i: number): string => `f000${(i % 16).toString(16)}000:0:${(0x5000000 + i).toString(16)}`;

function snapshot(): SensorSnapshot {
	const sensors = Array.from({ length: 16 }, (_u, i) => ({ index: i, id: 0xf0000000 + i * 0x1000, instance: 0, name: `Sensor ${i}` }));
	const readings: Reading[] = Array.from({ length: READINGS }, (_u, i) => {
		const value = 10 + (i % 50);
		return { key: key(i), type: SensorType.Power, sensorIndex: i % 16, id: 0x5000000 + i, label: `Power ${i}`, unit: "W", value, valueMin: value, valueMax: value, valueAvg: value };
	});
	return { pollTime: 1, valueRevision: 1, freshnessRevision: 1, version: 1, revision: 1, sensors, readings, byKey: new Map(readings.map((r) => [r.key, r])) };
}

const id = (n: number): string => `calc:${String(n).padStart(22, "A")}`;
const row = (n: number, op: string, inputs: string[]): Record<string, unknown> => ({ id: id(n), op, inputs, unit: "W", sensorType: SensorType.Power });

/** 32 sums of 8 distinct provider readings each. */
const flat = (): unknown[] => Array.from({ length: 32 }, (_u, d) => row(d, "sum", Array.from({ length: 8 }, (_v, i) => key(d * 8 + i))));

/** The depth limit with every definition at 8 inputs: 16 sums of provider
 * readings, 12 sums of 8 of those (pooling 64 measurements each), 4
 * maxima of 8 of those (depth 3). */
const nested = (): unknown[] => {
	const out: unknown[] = [];
	for (let d = 0; d < 16; d++) out.push(row(d, "sum", Array.from({ length: 8 }, (_v, i) => key(d * 8 + i))));
	for (let d = 16; d < 28; d++) out.push(row(d, "sum", Array.from({ length: 8 }, (_v, i) => id((d + i) % 16))));
	for (let d = 28; d < 32; d++) out.push(row(d, "max", Array.from({ length: 8 }, (_v, i) => id(16 + ((d + i) % 12)))));
	return out;
};

const links = parseReadingLinks([{ sharedMemory: key(0), gadget: "g:Sensor 0:Power 0", unit: "W", sensorType: SensorType.Power }]);

function time(name: string, fn: () => unknown): number {
	for (let i = 0; i < Math.min(500, ITERATIONS); i++) fn();
	const start = performance.now();
	for (let i = 0; i < ITERATIONS; i++) fn();
	const us = ((performance.now() - start) * 1000) / ITERATIONS;
	console.log(`| ${name} | ${us.toFixed(2)} us |`);
	return us;
}

const raw = snapshot();
const plans: [string, CalculatedPlan][] = [
	["0 definitions (1.7.1 path)", parseCalculatedReadings(undefined)],
	["32 flat sums of 8", parseCalculatedReadings(flat())],
	["32 nested, depth 3, 8 inputs each", parseCalculatedReadings(nested())]
];
console.log(`Calculated readings per-tick cost: ${READINGS}-reading snapshot, ${ITERATIONS} iterations, Node ${process.version}, ${process.platform}/${process.arch}`);
console.log("| Derive (links, then calculated) | per tick |");
console.log("| --- | --- |");
for (const [name, plan] of plans) {
	const out = withCalculatedReadings(applyReadingLinks(raw, [], 0), plan);
	const states = new Map<string, number>();
	for (const reading of out.readings) {
		const state = calculatedInfoOf(reading)?.state;
		if (state !== undefined) states.set(state, (states.get(state) ?? 0) + 1);
	}
	const same = out === raw ? ", same instance" : "";
	time(`${name}, no links${same}${states.size > 0 ? ` (${[...states].map(([s, n]) => `${n} ${s}`).join(", ")})` : ""}`, () => withCalculatedReadings(applyReadingLinks(raw, [], 0), plan));
	time(`${name}, one link`, () => withCalculatedReadings(applyReadingLinks(raw, links, 1), plan));
}
const catalog = new ReadingCatalog();
catalog.observe(raw, "shared-memory", 0);
let at = 0;
console.log("| Session catalog (pairing) | per tick |");
console.log("| --- | --- |");
time("unchanged skeleton (same instance)", () => catalog.observe(raw, "shared-memory", ++at));
time("rebuilt skeleton (new instance, 600 readings)", () => catalog.observe({ ...raw }, "shared-memory", ++at));
