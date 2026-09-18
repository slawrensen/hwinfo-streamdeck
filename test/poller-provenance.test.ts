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

	it("an unreadable identity journal surfaces with its own instruction", () => {
		const status = attempt(new HwinfoError("not-running", "HWSM_NOT_FOUND: mapping not found"), new HwinfoError("invalid", "Gadget identity history could not be read or saved. Restore the local identity journal or use Shared Memory Support."));
		assert.equal(status.state, "unavailable");
		if (status.state !== "unavailable") return;
		assert.equal(status.reason, "invalid");
		assert.match(status.message, /identity journal/);
	});

	it("a specific shared-memory diagnosis still outranks the fallback", () => {
		const status = attempt(new HwinfoError("access-denied", "mapping denied"), new HwinfoError("invalid", "journal"));
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
