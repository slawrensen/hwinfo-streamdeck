// The poller's read cadence follows the open source, never a setting, and
// its series map doubles as the subscription registry (see
// subscribeSeries). Drives the real poller with canned providers; ticks are
// called directly, except where the timer chain itself is the subject.
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, it } from "node:test";

import { SensorType, type SensorSnapshot } from "../src/hwinfo/types";
import { poller } from "../src/poller";
import { compose } from "../src/actions/sensor-reading";
import { rotationReadings, overviewWindow } from "../src/rotation";
import { resolveDetailGroup } from "../src/detail/detail-group";
import { HwinfoError } from "../src/hwinfo/types";

type Seam = {
	openProvider(): { source: "shared-memory" | "gadget"; read(): SensorSnapshot | null; close(): void };
	tick(): void;
};

function snapshotAt(pollTime: number, value: number): SensorSnapshot {
	const reading = { key: "cpu:0:0", type: SensorType.Temperature, sensorIndex: 0, id: 0, label: "CPU", unit: "°C", value, valueMin: value, valueMax: value, valueAvg: value };
	return { pollTime, version: 1, revision: 1, sensors: [{ index: 0, id: 0, instance: 0, name: "CPU" }], readings: [reading], byKey: new Map([[reading.key, reading]]) };
}

describe("the read cadence follows the open source", () => {
	type CadenceSeam = Seam & { tickMs(): number; lastAcceptedAt: number };
	type Subject = Pick<typeof poller, "setSourceMode" | "diagnostics" | "retain" | "release" | "onTick" | "subscribeSeries" | "getSeries"> & CadenceSeam;
	const isolated = (): Subject => new (poller.constructor as unknown as { new(): Subject })();

	it("Shared Memory reads every 250 ms; Gadget and a closed source once a second", () => {
		const subject = isolated();
		assert.equal(subject.tickMs(), 1000, "nothing open: a tick is only an open attempt");
		subject.openProvider = () => ({ source: "shared-memory", close() {}, read: () => ({ ...snapshotAt(700, 40), pollingPeriodMs: 2000 }) });
		subject.tick();
		assert.equal(subject.tickMs(), 250);
		assert.deepEqual([subject.diagnostics().intervalMs, subject.diagnostics().hwinfoPollingPeriodMs], [250, 2000], "the report names both rates");
		subject.setSourceMode("gadget");
		subject.openProvider = () => ({ source: "gadget", close() {}, read: () => ({ ...snapshotAt(700, 40), freshnessRevision: 1 }) });
		subject.tick();
		assert.equal(subject.tickMs(), 1000, "a Gadget read walks the whole registry bound");
		assert.deepEqual([subject.diagnostics().intervalMs, subject.diagnostics().hwinfoPollingPeriodMs], [1000, null], "Gadget publishes no period");
	});

	it("a slow read stretches the interval so reading stays within a tenth of the thread", () => {
		const subject = isolated();
		subject.openProvider = () => ({ source: "shared-memory", close() {}, read: () => {
			const until = performance.now() + 40;
			while (performance.now() < until) { /* a 40 ms read */ }
			return snapshotAt(700, 40);
		} });
		subject.tick();
		assert.ok(subject.tickMs() >= 400, `${subject.tickMs()} ms after a 40 ms read`);
	});

	it("a busy Shared Memory read keeps the sparkline unless the skip could hide an HWiNFO write", () => {
		const subject = isolated();
		const key = "cpu:0:0";
		let current: SensorSnapshot | null = { ...snapshotAt(500, 40), pollingPeriodMs: 2000 };
		subject.openProvider = () => ({ source: "shared-memory", close() {}, read: () => current });
		subject.subscribeSeries(key);
		subject.tick();
		current = { ...snapshotAt(501, 41), pollingPeriodMs: 2000 };
		subject.tick();
		current = null;
		subject.tick();
		assert.deepEqual([...(subject.getSeries(key) ?? [])], [40, 41], "one skipped quarter second cannot lose a 2 s write");
		subject.lastAcceptedAt -= 1000;
		subject.tick();
		assert.deepEqual(subject.getSeries(key), [], "skips spanning half the period end the segment");
	});

	// Real timers: the chain itself is the subject. Late timers only lower
	// the counts, so the bounds below cannot flake high under load.
	const sharedMemory = (): Subject => {
		const subject = isolated();
		let pollTime = 700;
		subject.openProvider = () => ({ source: "shared-memory", close() {}, read: () => snapshotAt(++pollTime, 40) });
		return subject;
	};

	it("the second read follows the first at the opened source's cadence", async () => {
		const subject = sharedMemory();
		let ticks = 0;
		subject.onTick(() => ticks++);
		subject.retain();
		await sleep(700);
		subject.release();
		// Arming before the first read would take the closed-source second.
		assert.ok(ticks >= 2, `${ticks} tick(s) in 700 ms`);
	});

	it("a Gadget source is read once a second through the timer", async () => {
		const subject = isolated();
		subject.setSourceMode("gadget");
		let value = 40;
		subject.openProvider = () => ({ source: "gadget", close() {}, read: () => ({ ...snapshotAt(700, ++value), freshnessRevision: value }) });
		let ticks = 0;
		subject.onTick(() => ticks++);
		subject.retain();
		await sleep(1200);
		subject.release();
		assert.ok(ticks >= 1 && ticks <= 2, `${ticks} tick(s) in 1.2 s`);
	});

	it("a throwing tick listener cannot end the reads", async () => {
		const subject = sharedMemory();
		let ticks = 0;
		subject.onTick(() => {
			if (++ticks === 1) throw new Error("synthetic listener failure");
		});
		assert.throws(() => subject.retain(), /synthetic listener failure/);
		await sleep(700);
		subject.release();
		assert.ok(ticks >= 2, `${ticks} tick(s) in 700 ms after the throw`);
	});

	it("a stop and restart inside a timer-driven tick leaves exactly one read chain", async () => {
		const subject = sharedMemory();
		let ticks = 0;
		subject.onTick(() => {
			ticks++;
			// Tick 2 is the first one a timer fires; restart from inside it.
			if (ticks === 2) {
				subject.release();
				subject.retain();
			}
		});
		subject.retain();
		await sleep(1600);
		// One chain: at most 8 (start, the restart pair, then every 250 ms).
		// A second chain adds about one tick per 250 ms on top.
		assert.ok(ticks >= 3 && ticks <= 9, `${ticks} ticks in 1.6 s`);
		subject.release();
		const stopped = ticks;
		await sleep(400);
		assert.equal(ticks, stopped, "the last release ends the chain");
	});
});

describe("freshness evidence survives lifecycle changes", () => {
	type FreshnessSeam = Seam & { provider: ReturnType<Seam["openProvider"]> | null; lastAdvanceAt: number; lastReopenProbeAt: number; probeReopen(): void };
	type Subject = Pick<typeof poller, "setSourceMode" | "getStatus" | "diagnostics"> & FreshnessSeam;
	const isolated = (): Subject => new (poller.constructor as unknown as { new(): Subject })();

	it("cold Gadget diagnostics do not invent a sample age", () => {
		const subject = isolated();
		subject.setSourceMode("gadget");
		subject.openProvider = () => ({ source: "gadget", close() {}, read: () => ({ ...snapshotAt(0, 0), freshnessRevision: 0 }) });
		subject.tick();
		assert.equal(subject.getStatus().state, "stale");
		assert.equal(subject.diagnostics().sampleAgeMs, null, "provider-open time is not sample time");
	});

	it("topology revisions cannot keep a frozen producer fresh", () => {
		const subject = isolated();
		let revision = 1;
		subject.openProvider = () => ({ source: "shared-memory", close() {}, read: () => ({ ...snapshotAt(700, 40), valueRevision: revision++, freshnessRevision: 0 }) });
		subject.tick();
		subject.lastAdvanceAt = -60_000;
		subject.lastReopenProbeAt = Number.POSITIVE_INFINITY;
		subject.tick();
		assert.equal(subject.lastAdvanceAt, -60_000);
		assert.equal(subject.getStatus().state, "stale");
	});

	it("an invalid-session reopen does not refresh identical producer bytes", () => {
		const subject = isolated();
		let invalid = false;
		let opened = 0;
		subject.openProvider = () => {
			const generation = ++opened;
			return { source: "shared-memory", close() {}, read: () => {
				if (generation === 1 && invalid) throw new HwinfoError("invalid", "synthetic layout reopen");
				return { ...snapshotAt(700, 40), valueRevision: 1, freshnessRevision: 0 };
			} };
		};
		subject.tick();
		subject.lastAdvanceAt = -60_000;
		subject.lastReopenProbeAt = Number.POSITIVE_INFINITY;
		invalid = true;
		subject.tick();
		assert.equal(opened, 2);
		assert.equal(subject.lastAdvanceAt, -60_000);
		assert.equal(subject.getStatus().state, "stale");
	});

	it("repeated successful opens followed by busy reads cannot extend held freshness", () => {
		const subject = isolated();
		let busy = false;
		subject.openProvider = () => ({ source: "shared-memory", close() {}, read: () => {
			if (busy) throw new HwinfoError("busy", "synthetic read failure");
			return snapshotAt(700, 40);
		} });
		subject.tick();
		subject.lastAdvanceAt = -60_000;
		busy = true;
		for (let i = 0; i < 3; i++) {
			subject.tick();
			assert.equal(subject.lastAdvanceAt, -60_000);
			assert.equal(subject.getStatus().state, "unavailable");
		}
	});

	it("a stale reopen cannot label old shared-memory values as Gadget", () => {
		const subject = isolated();
		let source: "shared-memory" | "gadget" = "shared-memory";
		subject.openProvider = () => {
			const openedSource = source;
			return { source: openedSource, close() {}, read: () => snapshotAt(openedSource === "gadget" ? 0 : 700, openedSource === "gadget" ? 80 : 40) };
		};
		subject.tick();
		subject.lastAdvanceAt = -60_000;
		subject.lastReopenProbeAt = -60_000;
		source = "gadget";
		subject.tick();
		const status = subject.getStatus();
		assert.notEqual(status.state, "unavailable");
		if (status.state === "unavailable") return;
		assert.equal(status.source, "shared-memory", "held snapshot keeps its actual provenance until the new provider is read");
		assert.equal(status.snapshot.readings[0]?.value, 40);
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
		// Its own instance: no ring left behind by an earlier test.
		const seam = new (poller.constructor as unknown as { new(): Seam & Pick<typeof poller, "subscribeSeries" | "getSeries"> })();
		const key = "cpu:0:0";
		let current: SensorSnapshot | null = { ...snapshotAt(500, 40), valueRevision: 1 };
		seam.openProvider = () => ({ source: "shared-memory", close: () => {}, read: () => current });
		seam.subscribeSeries(key);
		seam.tick();
		current = { ...current, valueRevision: 2 };
		seam.tick();
		assert.deepEqual([...(seam.getSeries(key) ?? [])], [40]);
		current = null;
		seam.tick();
		assert.deepEqual(seam.getSeries(key), [], "a skipped read creates a visible gap");
		current = { ...snapshotAt(501, 41), valueRevision: 3 };
		seam.tick();
		assert.deepEqual([...(seam.getSeries(key) ?? [])], [41]);
		current = { ...snapshotAt(502, 80), valueRevision: 4 };
		const reading = { ...current.readings[0]!, unit: "°F" };
		current = { ...current, readings: [reading], byKey: new Map([[key, reading]]) };
		seam.tick();
		assert.deepEqual([...(seam.getSeries(key) ?? [])], [80], "never join native units across a unit rewrite");
		current = { ...current, readings: [], byKey: new Map() };
		seam.tick();
		assert.deepEqual(seam.getSeries(key), [], "a missing reading ends its segment");
	});
});
