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

type Seam = {
	openProvider(): { source: "shared-memory"; read(): SensorSnapshot | null; close(): void };
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
