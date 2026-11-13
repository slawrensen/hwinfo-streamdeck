// Calculated readings in the poller (steer 7G): derived after links on every
// published snapshot, the provider's own instance when nothing is defined,
// adopted like a pairing edit (one tick, no read, no evidence), and a
// definition whose meaning changes ends its ring, session and history
// segment while a label edit ends nothing.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import type { HistoryStore } from "../src/history/store";
import { CALCULATED_SOURCE_NAME, calculatedInfoOf } from "../src/hwinfo/calculated";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import { poller } from "../src/poller";
import { SessionStatsStore } from "../src/stats";

type Provider = { source: "shared-memory" | "gadget"; read(): SensorSnapshot | null; close(): void };
type Subject = Pick<typeof poller, "setReadingLinks" | "setCalculatedReadings" | "getCalculatedPlan" | "getRawObservation" | "getStatus" | "onTick" | "subscribeSeries" | "getSeries" | "catalog"> & {
	readonly history: HistoryStore;
	openProvider(): Provider;
	tick(): void;
	bindingRevision: number;
};
const isolated = (): Subject => new (poller.constructor as unknown as { new (): Subject })();

const CPU = "f0001234:0:1000001";
const GPU = "f0001234:0:1000002";
const GADGET_GPU = "g:Test Source:GPU Power";
const ID = "calc:AAAAAAAAAAAAAAAAAAAAAA";
const ID2 = "calc:BBBBBBBBBBBBBBBBBBBBBB";

function snap(pollTime: number, cpu: number, gpu: number): SensorSnapshot {
	const r1: Reading = { key: CPU, type: SensorType.Power, sensorIndex: 0, id: 1, label: "CPU Package Power", unit: "W", value: cpu, valueMin: cpu, valueMax: cpu, valueAvg: cpu };
	const r2: Reading = { ...r1, key: GPU, id: 2, label: "GPU Power", value: gpu, valueMin: gpu, valueMax: gpu, valueAvg: gpu };
	return { pollTime, valueRevision: pollTime, freshnessRevision: pollTime, version: 1, revision: 1, sensors: [{ index: 0, id: 0xf0001234, instance: 0, name: "Test Source" }], readings: [r1, r2], byKey: new Map([[CPU, r1], [GPU, r2]]) };
}

const sum = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ id: ID, op: "sum", inputs: [CPU, GPU], unit: "W", sensorType: SensorType.Power, ...over });

let mono = 0;
let clock: ReturnType<typeof mock.method> | null = null;
beforeEach(() => {
	mono = 100_000;
	clock = mock.method(performance, "now", () => mono);
});
afterEach(() => {
	clock?.mock.restore();
	clock = null;
});

function running(defs?: unknown): { s: Subject; reads: { fn: () => SensorSnapshot | null; count: number }; ticks: () => number } {
	const s = isolated();
	if (defs !== undefined) s.setCalculatedReadings(defs);
	let pollTime = 100;
	const reads = { fn: (): SensorSnapshot | null => snap(++pollTime, 40, 200), count: 0 };
	s.openProvider = () => ({ source: "shared-memory", read: () => { reads.count++; return reads.fn(); }, close() {} });
	let emitted = 0;
	s.onTick(() => { emitted++; });
	s.tick();
	return { s, reads, ticks: () => emitted };
}

const published = (s: Subject): SensorSnapshot => {
	const status = s.getStatus();
	assert.notEqual(status.state, "unavailable");
	return (status as { snapshot: SensorSnapshot }).snapshot;
};

describe("poller: calculated readings are derived after links on every published snapshot", () => {
	it("with nothing defined the published snapshot is the provider's own instance", () => {
		const { s } = running();
		assert.equal(published(s), s.getRawObservation()?.snapshot, "zero cost: no copy");
	});

	it("a definition publishes its value under the Calculated (plugin) source, statistics unavailable", () => {
		const { s } = running([sum()]);
		const snapshot = published(s);
		const reading = snapshot.byKey.get(ID);
		assert.equal(reading?.value, 240);
		assert.equal(reading?.unit, "W");
		assert.equal(reading?.statistics, "unavailable");
		assert.equal(snapshot.sensors[reading?.sensorIndex ?? -1]?.name, CALCULATED_SOURCE_NAME);
		assert.equal(CALCULATED_SOURCE_NAME, "Calculated (plugin)");
		assert.equal(calculatedInfoOf(reading as Reading)?.state, "ok");
		assert.equal(s.getRawObservation()?.snapshot.byKey.has(ID), false, "the provider's snapshot is never touched");
	});

	it("an input saved as the other endpoint of a confirmed pair resolves (links come first)", () => {
		const s = isolated();
		s.setReadingLinks([{ sharedMemory: GPU, gadget: GADGET_GPU, unit: "W", sensorType: SensorType.Power }]);
		s.setCalculatedReadings([sum({ inputs: [CPU, GADGET_GPU] })]);
		s.openProvider = () => ({ source: "shared-memory", read: () => snap(101, 40, 200), close() {} });
		s.tick();
		assert.equal(published(s).byKey.get(ID)?.value, 240);
	});

	it("the first delivery of an absent, empty or junk document is not a change", () => {
		for (const raw of [undefined, null, [], "junk", [{ bad: true }]]) {
			const { s, ticks } = running();
			const before = { ticks: ticks(), revision: s.bindingRevision };
			s.setCalculatedReadings(raw);
			assert.equal(ticks(), before.ticks, `${JSON.stringify(raw)}: no tick`);
			assert.equal(s.bindingRevision, before.revision, `${JSON.stringify(raw)}: no revision`);
		}
	});

	it("a re-delivery of the same meaning (key order, unknown fields) changes nothing", () => {
		const { s, ticks } = running([sum()]);
		const before = ticks();
		s.setCalculatedReadings([{ sensorType: SensorType.Power, unit: "W", inputs: [CPU, GPU], op: "sum", id: ID, future: { keep: 1 } }]);
		assert.equal(ticks(), before);
	});
});

describe("poller: a definition edit republishes at the commit, with no read and no evidence", () => {
	it("adding a definition emits one tick, performs no read and keeps the freshness evidence", () => {
		const { s, reads, ticks } = running();
		const before = { reads: reads.count, ticks: ticks(), state: s.getStatus().state, pollTime: published(s).pollTime, valueRevision: published(s).valueRevision };
		s.setCalculatedReadings([sum()]);
		assert.equal(reads.count, before.reads, "no read");
		assert.equal(ticks(), before.ticks + 1, "consumers told once");
		assert.equal(published(s).byKey.get(ID)?.value, 240);
		assert.equal(s.getStatus().state, before.state);
		assert.equal(published(s).pollTime, before.pollTime, "a recalculation is never new evidence");
		assert.equal(published(s).valueRevision, before.valueRevision);
	});

	it("a definition-only change pushes no ring sample; a changed meaning ends the ring, a label edit keeps it", () => {
		const { s } = running([sum()]);
		s.subscribeSeries(ID);
		s.tick();
		s.tick();
		const length = s.getSeries(ID)?.length ?? 0;
		assert.ok(length >= 1, "the calculated reading's ring fills from real reads");
		s.setCalculatedReadings([sum({ label: "CPU and GPU" })]);
		assert.equal(s.getSeries(ID)?.length, length, "a label edit resets nothing and adds no sample");
		s.setCalculatedReadings([sum({ op: "max", label: "CPU and GPU" })]);
		assert.equal(s.getSeries(ID)?.length, 0, "a changed meaning ends the ring at the commit");
		assert.equal(published(s).byKey.get(ID)?.value, 200);
	});

	it("a changed meaning ends the session with reason definition; a label edit does not", () => {
		const { s } = running([sum()]);
		const stats = new SessionStatsStore();
		const observe = (): string | undefined => {
			const snapshot = published(s);
			return stats.observe(snapshot.byKey.get(ID) as Reading, snapshot, "shared-memory");
		};
		assert.equal(observe(), undefined);
		s.tick();
		assert.equal(observe(), undefined);
		s.setCalculatedReadings([sum({ label: "Mine" })]);
		s.tick();
		assert.equal(observe(), undefined, "a label is not part of the measurement");
		s.setCalculatedReadings([sum({ op: "avg", label: "Mine" })]);
		assert.equal(observe(), "definition");
	});

	it("a changed meaning ends the history segment with reason definition and hides the old run", () => {
		const { s } = running([sum()]);
		s.history.setInterest("probe", [{ savedKey: ID, window: "1m" }]);
		for (let i = 1; i <= 3; i++) {
			mono = 100_000 + i * 1000;
			s.tick();
		}
		const before = s.history.view(ID, "1m", 60, mono);
		assert.equal(before?.segments.length, 1);
		s.setCalculatedReadings([sum({ op: "max" })]);
		mono += 1000;
		s.tick();
		const after = s.history.view(ID, "1m", 60, mono);
		assert.equal(after?.segments.length, 1, "only the new definition's run is drawn");
		assert.ok((after?.hidden.length ?? 0) >= 1, "the old run is hidden, not merged");
		assert.deepEqual([...(after?.cols.last ?? [])], [200]);
	});

	it("a dependent definition follows its input's meaning; an unrelated definition keeps its ring", () => {
		const nested = { id: ID2, op: "diff", inputs: [ID, CPU], unit: "W", sensorType: SensorType.Power };
		const other = { id: "calc:CCCCCCCCCCCCCCCCCCCCCC", op: "max", inputs: [CPU, GPU], unit: "W", sensorType: SensorType.Power };
		const { s } = running([sum(), nested, other]);
		for (const key of [ID2, other.id]) s.subscribeSeries(key);
		s.tick();
		assert.equal(published(s).byKey.get(ID2)?.value, 200);
		const otherLength = s.getSeries(other.id)?.length ?? 0;
		assert.ok(otherLength > 0);
		s.setCalculatedReadings([sum({ op: "max" }), nested, other]);
		assert.equal(s.getSeries(ID2)?.length, 0, "the nested reading's meaning changed with its input");
		assert.equal(s.getSeries(other.id)?.length, otherLength, "an unrelated definition is untouched");
		assert.equal(published(s).byKey.get(ID2)?.value, 160);
	});

	it("a missing input is no value, never a plausible zero", () => {
		const { s, reads } = running([sum()]);
		reads.fn = () => {
			const full = snap(500, 40, 200);
			const only = full.readings.slice(0, 1);
			return { ...full, readings: only, byKey: new Map(only.map((r) => [r.key, r])) };
		};
		s.tick();
		const reading = published(s).byKey.get(ID) as Reading;
		assert.ok(Number.isNaN(reading.value));
		assert.equal(calculatedInfoOf(reading)?.state, "input-missing");
	});

	it("the session catalog records the provider's raw readings, never calculated ones", () => {
		const { s } = running([sum()]);
		assert.equal(s.catalog.get("shared-memory", CPU)?.label, "CPU Package Power");
		assert.equal(s.catalog.get("shared-memory", ID), undefined);
		assert.equal(s.getCalculatedPlan().definitions.length, 1);
	});
});
