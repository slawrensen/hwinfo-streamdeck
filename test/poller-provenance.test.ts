// Held observations keep their actual source and their evidence age.
//
// Opening a provider is not receiving a measurement: a source switch (the
// automatic upgrade, an explicit mode change, a stale reopen probe, a page
// return) whose first reads are skipped must keep publishing the held
// observation under the source it came from, with `sampleAgeMs` measured
// from its last real evidence, and the stale cue must fire on that clock.
//
// Drives fresh HwinfoPoller instances (poller.constructor) with canned
// providers, exactly like poller-series.test.ts. Time is pinned through
// performance.now (src/clock.ts reads it on every use). SharedMemoryProvider
// and GadgetRegistryProvider `open` are replaced so nothing here touches the
// live HWiNFO mapping or the registry. The env is set before the dynamic
// import because the poller reads it at module load.
process.env.HWINFO_STALE_AFTER_MS = "15000";
process.env.HWINFO_REOPEN_PROBE_MS = "5000";
process.env.HWINFO_UPGRADE_PROBE_MS = "15000";

import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it, mock } from "node:test";

import { tickSignature } from "../src/detail/tick-signature";
import { ENTRY, ENTRY_CLASSIC_SIZE, HEADER, HEADER_SIZE, MAGIC_ACTIVE, SENSOR, SENSOR_CLASSIC_SIZE } from "../src/hwinfo/layout";
import { SnapshotParser } from "../src/hwinfo/reader";
import { HwinfoError, SensorType, type SensorSnapshot } from "../src/hwinfo/types";
import type { PollerStatus } from "../src/poller";
import { statusDialText, statusScreen, statusSentence } from "../src/ui/state-screens";

const { poller } = await import("../src/poller");
const { SharedMemoryProvider } = await import("../src/hwinfo/provider");
const { GadgetRegistryProvider } = await import("../src/hwinfo/gadget-registry");

const STALE = 15_000;

type Source = "shared-memory" | "gadget";
type Provider = { source: Source; read(): SensorSnapshot | null; close(): void };
type Subject = {
	openProvider(): Provider;
	tick(): void;
	provider: Provider | null;
	lastAdvanceAt: number;
	lastUpgradeProbeAt: number;
	lastReopenProbeAt: number;
	retain(): void;
	release(): void;
	setSourceMode(mode: "auto" | "shared-memory" | "gadget"): void;
	getStatus(): PollerStatus;
	diagnostics(): { state: string; source?: string; reason?: string; sampleAgeMs: number | null };
};
const isolated = (): Subject => new (poller.constructor as unknown as { new (): Subject })();

let now = 0;
const realNow = performance.now;
performance.now = () => now;
after(() => { performance.now = realNow; });

// Shared Memory stamps are UTC epoch seconds, and a stamp with no earlier
// stamp to compare against is aged by the wall clock. Pinned to the moment
// the fixture stamp was written unless a case moves it.
const STAMPED_AT = 1_700_000_100_000;
let wall = STAMPED_AT;
const realDateNow = Date.now;
Date.now = () => wall;
after(() => { Date.now = realDateNow; });
beforeEach(() => { wall = STAMPED_AT; });

// The upgrade probe's only path. Absent unless a case says otherwise, so a
// Gadget phase never silently upgrades on a leftover seam from an earlier case.
const noSharedMemory = (): Provider => { throw new HwinfoError("not-running", "canned: shared memory absent"); };
let smOpen: () => Provider = noSharedMemory;
const realSmOpen = SharedMemoryProvider.open;
(SharedMemoryProvider as unknown as { open: () => unknown }).open = () => smOpen();
after(() => { (SharedMemoryProvider as unknown as { open: unknown }).open = realSmOpen; });
beforeEach(() => { smOpen = noSharedMemory; });

function snap(key: string, value: number, pollTime: number, extra: Partial<SensorSnapshot> = {}): SensorSnapshot {
	const reading = { key, type: SensorType.Temperature, sensorIndex: 0, id: 1, label: "Temperature", unit: "°C", value, valueMin: value, valueMax: value, valueAvg: value };
	return { pollTime, valueRevision: 1, version: 1, revision: 0, sensors: [{ index: 0, id: 1, instance: 0, name: "GPU" }], readings: [reading], byKey: new Map([[key, reading]]), ...extra };
}
const gadgetSnap = snap("g:GPU:Temperature", 50, 1_700_000_000, { freshnessRevision: 1 });
const smSnap = snap("f0001234:0:1000001", 51, 1_700_000_100);
const provider = (source: Source, read: () => SensorSnapshot | null): Provider => ({ source, read, close() {} });

function expectHeld(subject: Subject, state: string, source: Source, snapshot: SensorSnapshot, sampleAgeMs: number | null, staleForMs?: number): void {
	const status = subject.getStatus();
	assert.equal(status.state, state);
	if (status.state === "unavailable") return;
	assert.equal(status.source, source, "the published source is the provenance of the published snapshot");
	assert.equal(status.snapshot, snapshot, "the same observation object is still the one on the keys");
	assert.equal(subject.diagnostics().sampleAgeMs, sampleAgeMs);
	if (staleForMs !== undefined && status.state === "stale") assert.equal(status.staleForMs, staleForMs);
}

function expectGadgetCues(status: PollerStatus): void {
	assert.deepEqual(statusScreen(status)?.lines, ["Age unknown", "check Gadget"]);
	assert.equal(statusDialText(status)?.title, "Age unknown");
	assert.match(statusSentence(status), /Gadget/);
	assert.equal(tickSignature(status), "stale:gadget");
}

/** Real parser input, so its stamp/value revision contract participates in
 * the poller test. Only the byte transport and clocks are synthetic. */
function sharedMemoryFixture(): { bytes: Buffer; entry: number; open(): Provider } {
	const entry = HEADER_SIZE + SENSOR_CLASSIC_SIZE;
	const bytes = Buffer.alloc(entry + ENTRY_CLASSIC_SIZE);
	bytes.writeUInt32LE(MAGIC_ACTIVE, HEADER.magic);
	bytes.writeUInt32LE(1, HEADER.version);
	bytes.writeUInt32LE(2, HEADER.revision);
	bytes.writeBigInt64LE(BigInt(STAMPED_AT / 1000), HEADER.pollTime);
	bytes.writeUInt32LE(HEADER_SIZE, HEADER.sensorSectionOffset);
	bytes.writeUInt32LE(SENSOR_CLASSIC_SIZE, HEADER.sensorElementSize);
	bytes.writeUInt32LE(1, HEADER.sensorElementCount);
	bytes.writeUInt32LE(entry, HEADER.entrySectionOffset);
	bytes.writeUInt32LE(ENTRY_CLASSIC_SIZE, HEADER.entryElementSize);
	bytes.writeUInt32LE(1, HEADER.entryElementCount);
	bytes.writeUInt32LE(0xf0001234, HEADER_SIZE + SENSOR.id);
	bytes.write("GPU", HEADER_SIZE + SENSOR.labelOrig, "latin1");
	bytes.writeUInt32LE(SensorType.Temperature, entry + ENTRY.type);
	bytes.writeUInt32LE(0x1000001, entry + ENTRY.id);
	bytes.write("Temperature", entry + ENTRY.labelOrig, "latin1");
	bytes.write("°C", entry + ENTRY.unit, "latin1");
	for (const offset of [ENTRY.value, ENTRY.valueMin, ENTRY.valueMax, ENTRY.valueAvg]) bytes.writeDoubleLE(50, entry + offset);
	return { bytes, entry, open() {
		const parser = new SnapshotParser();
		return provider("shared-memory", () => parser.parse(bytes));
	} };
}

describe("Shared Memory parser evidence reaches the poller with its real age", () => {
	for (const rebuild of [false, true]) {
		it(`a delayed timestamp-only ${rebuild ? "rebuild" : "fast-path read"} is stale, while a later finite value change is fresh`, () => {
			const subject = isolated();
			const fixture = sharedMemoryFixture();
			subject.openProvider = fixture.open;
			subject.lastReopenProbeAt = Number.POSITIVE_INFINITY;
			now = 100_000;
			subject.tick();
			assert.equal(subject.getStatus().state, "ok");
			assert.equal(subject.diagnostics().sampleAgeMs, 0);
			const session = subject.provider;
			// The producer polled at +2s, then froze. The same open parser
			// next observes that stamp at +20s, without any numeric change.
			fixture.bytes.writeBigInt64LE(BigInt(STAMPED_AT / 1000 + 2), HEADER.pollTime);
			if (rebuild) fixture.bytes.writeUInt32LE(3, HEADER.revision);
			now += 20_000;
			wall += 20_000;
			subject.tick();
			assert.equal(subject.provider, session, "the same parser observed both frames");
			assert.equal(subject.getStatus().state, "stale", "an 18-second-old stamp must not acquire observation-time freshness");
			assert.equal(subject.diagnostics().sampleAgeMs, 18_000);
			now += 1_000;
			wall += 1_000;
			subject.tick();
			assert.equal(subject.diagnostics().sampleAgeMs, 19_000, "identical bytes do not extend the evidence window");
			// Numeric evidence still works when the producer stamp is frozen.
			fixture.bytes.writeDoubleLE(51, fixture.entry + ENTRY.value);
			now += 1_000;
			wall += 1_000;
			subject.tick();
			assert.equal(subject.getStatus().state, "ok");
			assert.equal(subject.diagnostics().sampleAgeMs, 0);
		});
	}

	it("unchanged values with a current producer stamp remain live", () => {
		const subject = isolated();
		const fixture = sharedMemoryFixture();
		subject.openProvider = fixture.open;
		now = 100_000;
		subject.tick();
		for (let i = 1; i <= 4; i++) {
			now += 10_000;
			wall += 10_000;
			fixture.bytes.writeBigInt64LE(BigInt(wall / 1000), HEADER.pollTime);
			subject.tick();
			assert.equal(subject.getStatus().state, "ok");
			assert.equal(subject.diagnostics().sampleAgeMs, 0);
		}
	});

	it("a wall-clock jump cannot retract earned evidence or hide a finite value change", () => {
		const subject = isolated();
		const fixture = sharedMemoryFixture();
		subject.openProvider = fixture.open;
		now = 100_000;
		subject.tick();
		now += 1_000;
		wall += 3_600_000;
		fixture.bytes.writeBigInt64LE(BigInt(STAMPED_AT / 1000 + 1), HEADER.pollTime);
		subject.tick();
		assert.equal(subject.lastAdvanceAt, 100_000, "an old stamp cannot refresh or retract already earned evidence");
		assert.equal(subject.diagnostics().sampleAgeMs, 1_000);
		fixture.bytes.writeDoubleLE(51, fixture.entry + ENTRY.value);
		now += 1_000;
		subject.tick();
		assert.equal(subject.getStatus().state, "ok");
		assert.equal(subject.diagnostics().sampleAgeMs, 0, "a finite same-unit change still supplies current evidence despite clock skew");
	});

	it("a new parser after stop ages its first stamp even if values changed during the absence", () => {
		const subject = isolated();
		const fixture = sharedMemoryFixture();
		subject.openProvider = fixture.open;
		subject.lastReopenProbeAt = Number.POSITIVE_INFINITY;
		now = 100_000;
		subject.retain();
		const previous = subject.provider;
		subject.release();
		fixture.bytes.writeBigInt64LE(BigInt(STAMPED_AT / 1000 + 2), HEADER.pollTime);
		fixture.bytes.writeDoubleLE(63, fixture.entry + ENTRY.value);
		now += 20_000;
		wall += 20_000;
		subject.retain();
		try {
			assert.notEqual(subject.provider, previous);
			assert.equal(subject.getStatus().state, "stale");
			assert.equal(subject.diagnostics().sampleAgeMs, 18_000);
		} finally {
			subject.release();
		}
	});
});

describe("provenance: a provider swap whose first reads are skipped", () => {
	it("automatic upgrade to shared memory keeps the Gadget observation, its source and its age", () => {
		const subject = isolated();
		now = 100_000;
		subject.openProvider = () => provider("gadget", () => gadgetSnap);
		subject.lastUpgradeProbeAt = now;
		subject.tick();
		expectHeld(subject, "ok", "gadget", gadgetSnap, 0);
		now += 10_000;
		subject.tick();
		expectHeld(subject, "ok", "gadget", gadgetSnap, 10_000);
		// Shared memory becomes openable, but every read hits a busy mutex.
		let smRead: () => SensorSnapshot | null = () => null;
		smOpen = () => provider("shared-memory", () => smRead());
		subject.openProvider = () => provider("shared-memory", () => smRead());
		subject.lastUpgradeProbeAt = now - 15_000;
		now += 1_000;
		subject.tick();
		assert.equal(subject.provider?.source, "shared-memory", "the upgrade happened");
		expectHeld(subject, "ok", "gadget", gadgetSnap, 11_000);
		assert.equal(subject.lastAdvanceAt, 100_000, "the open minted no evidence");
		now = 100_000 + STALE - 100;
		subject.tick();
		expectHeld(subject, "ok", "gadget", gadgetSnap, STALE - 100);
		now = 100_000 + STALE + 100;
		subject.tick();
		expectHeld(subject, "stale", "gadget", gadgetSnap, STALE + 100, STALE + 100);
		expectGadgetCues(subject.getStatus());
		now += 11_000;
		subject.tick();
		expectHeld(subject, "stale", "gadget", gadgetSnap, STALE + 11_100, STALE + 11_100);
		expectGadgetCues(subject.getStatus());
		// The first accepted shared-memory read is the switch.
		smRead = () => smSnap;
		now += 1_000;
		subject.tick();
		expectHeld(subject, "ok", "shared-memory", smSnap, 0);
		assert.equal(tickSignature(subject.getStatus()).startsWith("ok:shared-memory:"), true);
	});

	it("an explicit source switch keeps the held observation until the new source is read", () => {
		const subject = isolated();
		now = 100_000;
		subject.openProvider = () => provider("shared-memory", () => smSnap);
		subject.tick();
		expectHeld(subject, "ok", "shared-memory", smSnap, 0);
		let gadgetRead: () => SensorSnapshot | null = () => null;
		subject.openProvider = () => provider("gadget", () => gadgetRead());
		now += 6_000;
		subject.setSourceMode("gadget");
		subject.tick();
		assert.equal(subject.provider?.source, "gadget");
		expectHeld(subject, "ok", "shared-memory", smSnap, 6_000);
		now = 100_000 + STALE + 100;
		subject.tick();
		expectHeld(subject, "stale", "shared-memory", smSnap, STALE + 100, STALE + 100);
		assert.deepEqual(statusScreen(subject.getStatus())?.lines, ["Not updating", "check sharing"]);
		assert.equal(tickSignature(subject.getStatus()), "stale:shared-memory");
		now += 6_000;
		subject.tick();
		expectHeld(subject, "stale", "shared-memory", smSnap, STALE + 6_100, STALE + 6_100);
		gadgetRead = () => gadgetSnap;
		now += 1_000;
		subject.tick();
		expectHeld(subject, "ok", "gadget", gadgetSnap, 0);
	});

	it("a stale reopen that lands on the other provider keeps the held snapshot's source on every skipped tick", () => {
		const subject = isolated();
		now = 100_000;
		subject.openProvider = () => provider("shared-memory", () => smSnap);
		subject.tick();
		let gadgetRead: () => SensorSnapshot | null = () => null;
		subject.openProvider = () => provider("gadget", () => gadgetRead());
		now += STALE + 1_000;
		subject.tick(); // the swap tick: probe lands on Gadget, its first read is skipped
		assert.equal(subject.provider?.source, "gadget");
		expectHeld(subject, "stale", "shared-memory", smSnap, STALE + 1_000, STALE + 1_000);
		now += 1_000;
		subject.tick(); // the next skipped tick used to relabel the same snapshot as Gadget
		expectHeld(subject, "stale", "shared-memory", smSnap, STALE + 2_000, STALE + 2_000);
		assert.deepEqual(statusScreen(subject.getStatus())?.lines, ["Not updating", "check sharing"]);
		const cold = snap("g:GPU:Temperature", 50, 0, { freshnessRevision: 0 });
		gadgetRead = () => cold;
		now += 1_000;
		subject.tick(); // an accepted Gadget read with no value evidence yet is Gadget's own unknown-age state
		const status = subject.getStatus();
		assert.equal(status.state, "stale");
		if (status.state !== "stale") return;
		assert.equal(status.source, "gadget");
		assert.equal(status.snapshot, cold);
		expectGadgetCues(status);
		gadgetRead = () => gadgetSnap;
		now += 1_000;
		subject.tick();
		expectHeld(subject, "ok", "gadget", gadgetSnap, 0);
	});

	it("a page return after the last release keeps the old observation's age", () => {
		const subject = isolated();
		now = 100_000;
		let smRead: () => SensorSnapshot | null = () => smSnap;
		subject.openProvider = () => provider("shared-memory", () => smRead());
		subject.retain();
		expectHeld(subject, "ok", "shared-memory", smSnap, 0);
		subject.release();
		smRead = () => null;
		now += STALE + 1_000;
		subject.retain(); // the first read after the reopen is skipped
		try {
			expectHeld(subject, "stale", "shared-memory", smSnap, STALE + 1_000, STALE + 1_000);
		} finally {
			subject.release();
		}
	});

	it("a frozen producer stays stale across a page return whose first read is accepted", () => {
		const subject = isolated();
		now = 100_000;
		subject.openProvider = () => provider("shared-memory", () => smSnap);
		subject.lastReopenProbeAt = Number.POSITIVE_INFINITY;
		subject.retain();
		expectHeld(subject, "ok", "shared-memory", smSnap, 0);
		now += STALE + 1_000;
		subject.tick();
		expectHeld(subject, "stale", "shared-memory", smSnap, STALE + 1_000, STALE + 1_000);
		subject.release();
		now += 2_000;
		subject.retain(); // same stamp, read accepted: reopening is not evidence
		try {
			expectHeld(subject, "stale", "shared-memory", smSnap, STALE + 3_000, STALE + 3_000);
			// The producer advances: live on that read.
			const advanced = snap("f0001234:0:1000001", 52, 1_700_000_130);
			subject.openProvider = () => provider("shared-memory", () => advanced);
			subject.provider = provider("shared-memory", () => advanced);
			now += 1_000;
			subject.tick();
			expectHeld(subject, "ok", "shared-memory", advanced, 0);
		} finally {
			subject.release();
		}
	});

	it("a producer that polled once more and then stopped during the absence is not live on the return", () => {
		const subject = isolated();
		now = 100_000;
		let current = smSnap;
		subject.openProvider = () => provider("shared-memory", () => current);
		subject.lastReopenProbeAt = Number.POSITIVE_INFINITY;
		subject.retain();
		expectHeld(subject, "ok", "shared-memory", smSnap, 0);
		subject.release();
		// One more poll two seconds after the plugin's last read, then nothing.
		current = snap("f0001234:0:1000001", 63, 1_700_000_102);
		now += 60_000;
		wall = STAMPED_AT + 60_000;
		subject.retain();
		try {
			expectHeld(subject, "stale", "shared-memory", current, 58_000, 58_000);
		} finally {
			subject.release();
		}
	});

	it("the evidence clock never runs backwards when the wall clock steps", () => {
		const subject = isolated();
		now = 100_000;
		let current = smSnap;
		subject.openProvider = () => provider("shared-memory", () => current);
		subject.tick();
		expectHeld(subject, "ok", "shared-memory", smSnap, 0);
		// The wall clock jumps an hour ahead; the producer keeps polling.
		wall = STAMPED_AT + 3_600_000;
		current = snap("f0001234:0:1000001", 52, 1_700_000_101);
		now += 1_000;
		subject.tick();
		expectHeld(subject, "ok", "shared-memory", current, 1_000);
		assert.equal(subject.lastAdvanceAt, 100_000, "an advance already earned is never pushed back");
	});

	it("a frozen producer stays stale across a Source change that lands on the same source", () => {
		const subject = isolated();
		now = 100_000;
		subject.openProvider = () => provider("shared-memory", () => smSnap);
		subject.lastReopenProbeAt = Number.POSITIVE_INFINITY;
		subject.retain();
		try {
			now += STALE + 1_000;
			subject.tick();
			assert.equal(subject.getStatus().state, "stale");
			subject.setSourceMode("shared-memory"); // Auto was already on shared memory
			expectHeld(subject, "stale", "shared-memory", smSnap, STALE + 1_000, STALE + 1_000);
		} finally {
			subject.release();
		}
	});

	it("a stamp that was already old when first seen is published with its real age", () => {
		const subject = isolated();
		now = 100_000;
		wall = STAMPED_AT + 60_000; // HWiNFO stopped polling a minute before the plugin looked
		subject.openProvider = () => provider("shared-memory", () => smSnap);
		subject.lastReopenProbeAt = Number.POSITIVE_INFINITY;
		subject.tick();
		expectHeld(subject, "stale", "shared-memory", smSnap, 60_000, 60_000);
		// A healthy producer's stamp is a second or two old: live at once.
		const healthy = isolated();
		wall = STAMPED_AT + 1_900;
		healthy.openProvider = () => provider("shared-memory", () => smSnap);
		healthy.tick();
		expectHeld(healthy, "ok", "shared-memory", smSnap, 1_900);
		// A stamp from the future (a clock stepped back) cannot be aged.
		const skewed = isolated();
		wall = STAMPED_AT - 30_000;
		skewed.openProvider = () => provider("shared-memory", () => smSnap);
		skewed.tick();
		expectHeld(skewed, "ok", "shared-memory", smSnap, 0);
	});

	it("a steady Gadget source is not reopened while it rests at Age unknown", () => {
		const subject = isolated();
		now = 100_000;
		let opened = 0;
		subject.openProvider = () => { opened++; return provider("gadget", () => gadgetSnap); };
		subject.tick();
		for (let i = 0; i < 60; i++) {
			now += 1_000;
			subject.tick();
		}
		assert.equal(subject.getStatus().state, "stale");
		assert.equal(opened, 1, "steady values are the resting state, not a reason to reopen the key");
	});

	it("a session that has never observed anything neither goes stale nor churns reopen probes", () => {
		const subject = isolated();
		now = 100_000;
		let opened = 0;
		let smRead: () => SensorSnapshot | null = () => null;
		subject.openProvider = () => { opened++; return provider("shared-memory", () => smRead()); };
		for (let i = 0; i < 5; i++) {
			subject.tick();
			now += 5_000;
		}
		assert.equal(subject.getStatus().state, "unavailable", "nothing has been polled yet");
		assert.equal(subject.diagnostics().sampleAgeMs, null);
		assert.equal(opened, 1, "the open session is kept and its read simply retried");
		smRead = () => smSnap;
		subject.tick();
		expectHeld(subject, "ok", "shared-memory", smSnap, 0);
	});
});

describe("the transient hold is bounded by the held observation, never by process uptime", () => {
	it("a cold Gadget key held at Age unknown rides out a momentary failure long after launch", () => {
		const subject = isolated();
		now = 3_600_000; // an hour of uptime: no evidence clock has ever started
		const cold = snap("g:GPU:Temperature", 50, 0, { freshnessRevision: 0 });
		let read: () => SensorSnapshot | null = () => cold;
		subject.openProvider = () => provider("gadget", () => read());
		subject.setSourceMode("gadget");
		subject.tick();
		assert.equal(subject.getStatus().state, "stale", "Age unknown");
		assert.equal(subject.lastAdvanceAt, 0);
		read = () => { throw new HwinfoError("busy", "synthetic scan collision"); };
		now += 1_000;
		subject.tick();
		const held = subject.getStatus();
		assert.equal(held.state, "stale", "the value stays on the key through a one-tick collision");
		if (held.state === "stale") assert.equal(held.snapshot, cold);
		now += STALE + 1_000;
		subject.tick();
		assert.equal(subject.getStatus().state, "unavailable", "a failure that outlives the window still surfaces");
	});
});

describe("auto mode reports a refused Gadget scan instead of an absent HWiNFO", () => {
	afterEach(() => mock.restoreAll());

	function attempt(primary: HwinfoError, fallback: HwinfoError): PollerStatus {
		const subject = isolated();
		smOpen = () => { throw primary; };
		mock.method(GadgetRegistryProvider, "open", () => { throw fallback; });
		subject.tick();
		return subject.getStatus();
	}

	it("a Gadget value that is not text surfaces as its own reason", () => {
		const status = attempt(new HwinfoError("not-running", "HWSM_NOT_FOUND: mapping not found"), new HwinfoError("invalid", "HWSM_REGISTRY_WRONG_TYPE: RegQueryValueExW: the value is not REG_SZ"));
		assert.equal(status.state, "unavailable");
		if (status.state !== "unavailable") return;
		assert.equal(status.reason, "invalid");
		assert.match(status.message, /not REG_SZ/);
	});

	it("a specific shared-memory diagnosis still outranks the fallback", () => {
		const status = attempt(new HwinfoError("access-denied", "mapping denied"), new HwinfoError("invalid", "HWSM_REGISTRY_WRONG_TYPE: RegQueryValueExW: the value is not REG_SZ"));
		assert.equal(status.state, "unavailable");
		if (status.state !== "unavailable") return;
		assert.equal(status.reason, "access-denied");
	});

	it("an absent Gadget key leaves the shared-memory diagnosis in charge", () => {
		const status = attempt(new HwinfoError("not-running", "HWSM_NOT_FOUND: mapping not found"), new HwinfoError("not-running", "registry key absent"));
		assert.equal(status.state, "unavailable");
		if (status.state !== "unavailable") return;
		assert.match(status.message, /mapping not found/);
	});
});
