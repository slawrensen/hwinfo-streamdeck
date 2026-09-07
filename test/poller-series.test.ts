// The poller's series map doubles as the subscription registry: its keys
// say which readings collect sparkline history (see subscribeSeries). A
// poll-interval change must reset the RINGS (index-spaced samples cannot
// honestly span a cadence change) without dropping the KEYS, or every
// visible sparkline dies until its action replays. Drives the real
// poller singleton with a canned provider; ticks are called directly,
// no timers.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SensorType, type SensorSnapshot } from "../src/hwinfo/types";
import { poller } from "../src/poller";
import { compose } from "../src/actions/sensor-reading";
import { rotationReadings, overviewWindow } from "../src/rotation";
import { resolveDetailGroup } from "../src/detail/detail-group";

type Seam = {
	openProvider(): { source: "shared-memory" | "gadget"; read(): SensorSnapshot | null; close(): void };
	tick(): void;
};

function snapshotAt(pollTime: number, value: number): SensorSnapshot {
	const reading = { key: "cpu:0:0", type: SensorType.Temperature, sensorIndex: 0, id: 0, label: "CPU", unit: "°C", value, valueMin: value, valueMax: value, valueAvg: value };
	return { pollTime, version: 1, revision: 1, sensors: [{ index: 0, id: 0, instance: 0, name: "CPU" }], readings: [reading], byKey: new Map([[reading.key, reading]]) };
}

describe("setIntervalMs keeps series subscriptions", () => {
	it("collection resumes after an interval change with no resubscribe", () => {
		const seam = poller as unknown as Seam;
		let pollTime = 0;
		let value = 10;
		seam.openProvider = () => ({ source: "shared-memory", read: () => snapshotAt(++pollTime, ++value), close: () => {} });
		poller.subscribeSeries("cpu:0:0");
		seam.tick();
		seam.tick();
		assert.deepEqual([...(poller.getSeries("cpu:0:0") ?? [])], [11, 12]);
		poller.setIntervalMs(2000);
		// Asserted WITHOUT a ?? fallback: an emptied ring and a dropped
		// subscription both read as "no samples" through one, and the
		// dropped subscription is exactly the defect.
		assert.deepEqual(poller.getSeries("cpu:0:0"), [], "the ring empties in place and the key stays subscribed");
		seam.tick();
		seam.tick();
		assert.deepEqual([...(poller.getSeries("cpu:0:0") ?? [])], [13, 14], "collection must resume without a resubscribe");
	});
});

describe("integrity: subsecond sampling", () => {
	for (const interval of [250, 500, 1000]) {
		it(`${interval}ms captures revisions inside a second and steady producer stamps`, () => {
			const seam = poller as unknown as Seam & { dropProvider(): void };
			seam.dropProvider();
			const key = `cadence:${interval}:0`;
			let time = 1000;
			let revision = 1;
			let value = 40;
			seam.openProvider = () => ({ source: "shared-memory", close: () => {}, read: () => {
				const base = snapshotAt(Math.floor(time / 1000), value);
				const reading = { ...base.readings[0]!, key };
				return { ...base, valueRevision: revision, readings: [reading], byKey: new Map([[key, reading]]) };
			} });
			poller.setIntervalMs(interval);
			poller.subscribeSeries(key);
			seam.tick();
			for (let i = 0; i < 4; i++) { time += interval; revision++; value++; seam.tick(); }
			assert.deepEqual([...(poller.getSeries(key) ?? [])], [40, 41, 42, 43, 44]);
			seam.tick();
			assert.equal(poller.getSeries(key)?.length, 5, "a duplicate observation is not another sample");
			time += 1000;
			seam.tick();
			assert.deepEqual(poller.getSeries(key), [40, 41, 42, 43, 44, 44], "a new producer stamp with a steady value is a sample");
		});
	}
});

describe("integrity: explicit source links", () => {
	it("saved keys keep their measurement in both provider directions, layouts and lists", () => {
		const seam = poller as unknown as Seam & { dropProvider(): void; setReadingLinks?(raw: unknown): void };
		const links = [0, 1, 2, 3].map((i) => ({ sharedMemory: `f0001234:0:${100 + i}`, gadget: `g:Test Source:Reading ${i}`, unit: "°C", sensorType: 1 }));
		seam.setReadingLinks?.(links);
		for (const source of ["shared-memory", "gadget", "shared-memory"] as const) {
			seam.dropProvider();
			const readings = links.map((link, i) => ({ ...snapshotAt(20, 40 + i * 10).readings[0]!, key: source === "gadget" ? link.gadget : link.sharedMemory, id: i, label: `Reading ${i}` }));
			const snapshot = { ...snapshotAt(20, 40), freshnessRevision: 1, readings, byKey: new Map(readings.map((r) => [r.key, r])) };
			seam.openProvider = () => ({ source, close: () => {}, read: () => snapshot });
			seam.tick();
			const status = poller.getStatus();
			assert.equal(status.state, "ok");
			if (status.state !== "ok") throw new Error("expected available source");
			for (const endpoint of ["sharedMemory", "gadget"] as const) {
				const keys = links.map((link) => link[endpoint]);
				assert.deepEqual(keys.map((key): number | undefined => status.snapshot.byKey.get(key)?.value), [40, 50, 60, 70], `${source} serving ${endpoint} selections`);
				for (const keyLayout of [undefined, "dual", "triple", "quad"] as const) {
					const face = compose({ readingKey: keys[0], secondaryReadingKey: keys[1], quadReadingKey3: keys[2], quadReadingKey4: keys[3], keyLayout, label: "My CPU", quadLabels: true }, status);
					assert.doesNotMatch(face, /Sensor missing/);
					assert.match(face, />40(?:\.0)?</);
				}
				const rotation = rotationReadings(keys, keys[1], status.snapshot);
				assert.deepEqual(rotation.map((r) => r.value), [40, 50, 60, 70]);
				assert.equal(overviewWindow(rotation, keys[1], 3).selectedIndex, 1);
				const custom = resolveDetailGroup(status.snapshot, { readingKey: keys[0], detailMode: "custom", detailKeys: keys.slice(1), detailTitle: "Mine" });
				assert.deepEqual(custom?.keys, keys.slice(1));
				assert.deepEqual(custom?.keys.map((key): number | undefined => status.snapshot.byKey.get(key)?.value), [50, 60, 70]);
				assert.equal(resolveDetailGroup(status.snapshot, { readingKey: keys[0] })?.keys.length, 3, "source list excludes the linked opener");
			}
		}
		seam.setReadingLinks?.([]);
	});
});

// The source-link pairs are explicit assertions by the user. Conflicting
// assertions must all be refused instead of making encounter order win.
describe("refutation: links and history", () => {
	it("a parser revision reset after reopen never refreshes a frozen producer", () => {
		const seam = poller as unknown as Seam & { dropProvider(): void; probeReopen(): void; lastAdvanceAt: number; lastReopenProbeAt: number };
		seam.dropProvider();
		let revision = 9;
		let value = 40;
		seam.openProvider = () => ({ source: "shared-memory", close: () => {}, read: () => ({ ...snapshotAt(700, value), valueRevision: revision }) });
		seam.tick();
		const advance = seam.lastAdvanceAt = -60_000;
		for (let i = 0; i < 3; i++) {
			seam.lastReopenProbeAt = -60_000;
			seam.probeReopen();
			revision = 1;
			seam.tick();
			assert.equal(seam.lastAdvanceAt, advance, "decoding the same bytes in a new parser is not producer evidence");
			assert.equal(poller.getStatus().state, "stale");
		}
		value = 41;
		revision++;
		seam.tick();
		assert.equal(poller.getStatus().state, "ok", "a subsequent same-second value change resumes normally");
	});
	it("topology-only revisions do not invent points, and gaps/units reset the ring", () => {
		const seam = poller as unknown as Seam & { dropProvider(): void };
		seam.dropProvider();
		const key = "cpu:0:0";
		let current: SensorSnapshot | null = { ...snapshotAt(500, 40), valueRevision: 1 };
		seam.openProvider = () => ({ source: "shared-memory", close: () => {}, read: () => current });
		poller.setIntervalMs(500);
		poller.subscribeSeries(key);
		seam.tick();
		current = { ...current, valueRevision: 2 };
		seam.tick();
		assert.deepEqual([...(poller.getSeries(key) ?? [])], [40]);
		current = null;
		seam.tick();
		assert.deepEqual(poller.getSeries(key), [], "a skipped read creates a visible gap");
		current = { ...snapshotAt(501, 41), valueRevision: 3 };
		seam.tick();
		assert.deepEqual([...(poller.getSeries(key) ?? [])], [41]);
		current = { ...snapshotAt(502, 80), valueRevision: 4 };
		const reading = { ...current.readings[0]!, unit: "°F" };
		current = { ...current, readings: [reading], byKey: new Map([[key, reading]]) };
		seam.tick();
		assert.deepEqual([...(poller.getSeries(key) ?? [])], [80], "never join native units across a unit rewrite");
		current = { ...current, readings: [], byKey: new Map() };
		seam.tick();
		assert.deepEqual(poller.getSeries(key), [], "a missing reading ends its segment");
	});
});
