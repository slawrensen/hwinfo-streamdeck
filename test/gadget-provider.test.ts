/**
 * GadgetRegistryProvider integration suite (Windows-only; skipped cleanly
 * elsewhere). Drives the real provider over the real hwsm addon against a
 * real synthetic HKCU key, because the defect this suite exists for lives
 * in the seam between them: HWiNFO leaves permanent holes in the VSB
 * numbering (a reading keeps its reserved VSBidx while it is unticked in
 * the sensor window), and the reader used to treat the first missing
 * `SensorN` as the end of the list.
 *
 * Runs in CI with the rest of `npm run test:native`, after build:native.
 *
 * The provider freezes HWINFO_VSB_KEY at module load, so every case here
 * reshapes ONE subkey rather than using a fresh path per case.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import type { Reading, SensorSnapshot } from "../src/hwinfo/types";

const onWindows = process.platform === "win32" && process.arch === "x64";
const VSB_SUBKEY = `Software\\HwinfoGadgetNT_${process.pid}`;
const REG_PATH = `HKCU\\${VSB_SUBKEY}`;

// Dynamic, because the module snapshots HWINFO_VSB_KEY at load time.
process.env.HWINFO_VSB_KEY = VSB_SUBKEY;
const { GadgetRegistryProvider } = await import("../src/hwinfo/gadget-registry");

/** The bound the reader scans to; mirrors MAX_ENTRIES in the provider. */
const MAX_ENTRIES = 1024;

/**
 * The reported topology from issue #21: 39 reserved slots, 25 written, 14
 * permanent holes, the first at index 4. The hole set is fixed so the
 * assertions can name exact indexes.
 */
const ISSUE_HOLES = [4, 5, 9, 12, 13, 17, 21, 22, 26, 29, 30, 33, 35, 37];
const ISSUE_PRESENT = Array.from({ length: 39 }, (_, i) => i).filter((i) => !ISSUE_HOLES.includes(i));

interface Quartet {
	sensor?: string;
	label?: string;
	value?: string;
	raw?: string;
}

/**
 * Three rotating groups; the value tracks the index so a reading is
 * identifiable. The label deliberately does NOT read `Reading <i>`: that is
 * the provider's own fallback for an absent LabelN, and a fixture using it
 * would let a reader that never queried LabelN pass every assertion here.
 */
function defaultQuartet(i: number): Quartet {
	return { sensor: ["Alpha Source", "Beta Source", "Gamma Source"][i % 3], label: `Label ${i}`, value: `${i}.5 °C`, raw: `${i}.5` };
}

function regEscape(text: string): string {
	return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Replaces the key with quartets at exactly `indexes`. One `reg import`
 * keeps even a 1024-entry shape well under a second, which matters for a
 * suite that runs on every push.
 */
function shape(indexes: number[], quartet: (i: number) => Quartet = defaultQuartet): void {
	dropKey();
	const lines = ["Windows Registry Editor Version 5.00", "", `[HKEY_CURRENT_USER\\${VSB_SUBKEY}]`];
	for (const i of indexes) {
		const q = quartet(i);
		if (q.sensor !== undefined) lines.push(`"Sensor${i}"="${regEscape(q.sensor)}"`);
		if (q.label !== undefined) lines.push(`"Label${i}"="${regEscape(q.label)}"`);
		if (q.value !== undefined) lines.push(`"Value${i}"="${regEscape(q.value)}"`);
		if (q.raw !== undefined) lines.push(`"ValueRaw${i}"="${regEscape(q.raw)}"`);
	}
	const file = path.join(os.tmpdir(), `hwinfo-gadget-nt-${process.pid}-${indexes.length}.reg`);
	// reg.exe detects a UTF-16 .reg file by its BOM.
	fs.writeFileSync(file, `\uFEFF${lines.join("\r\n")}\r\n`, "utf16le");
	try {
		execFileSync("reg", ["import", file], { stdio: "ignore" });
	} finally {
		fs.rmSync(file, { force: true });
	}
}

function putValue(name: string, data: string, type = "REG_SZ"): void {
	execFileSync("reg", ["add", REG_PATH, "/v", name, "/t", type, "/d", data, "/f"], { stdio: "ignore" });
}

function dropValue(name: string): void {
	execFileSync("reg", ["delete", REG_PATH, "/v", name, "/f"], { stdio: "ignore" });
}

function emptyKey(): void {
	dropKey();
	execFileSync("reg", ["add", REG_PATH, "/f"], { stdio: "ignore" });
}

function dropKey(): void {
	try {
		execFileSync("reg", ["delete", REG_PATH, "/f"], { stdio: "ignore" });
	} catch {
		// not present
	}
}

/** One open/read/close over the current key shape. */
function readShape(): SensorSnapshot {
	const provider = GadgetRegistryProvider.open();
	try {
		return provider.read();
	} finally {
		provider.close();
	}
}

const ids = (snap: SensorSnapshot): number[] => snap.readings.map((r) => r.id);
const labels = (snap: SensorSnapshot): string[] => snap.readings.map((r) => r.label);

/** The HwinfoError reason a call fails with, or "<no throw>". */
function reasonOf(fn: () => unknown): string {
	try {
		fn();
	} catch (err) {
		return (err as { reason?: string }).reason ?? `<no reason: ${(err as Error).message}>`;
	}
	return "<no throw>";
}

after(() => {
	if (onWindows) {
		dropKey();
	}
});

describe("gadget provider: sparse VSB indexes", { skip: !onWindows ? "win32-x64 only" : false }, () => {
	test("contiguous indexes are unchanged: every reading, in order", () => {
		shape([0, 1, 2]);
		const snap = readShape();
		assert.deepEqual(ids(snap), [0, 1, 2]);
		assert.deepEqual(labels(snap), ["Label 0", "Label 1", "Label 2"]);
		assert.equal(snap.sensors.length, 3);
	});

	test("an interior hole does not end the scan", () => {
		shape([0, 2]);
		const snap = readShape();
		assert.deepEqual(ids(snap), [0, 2], "the reading after the hole must survive");
		assert.equal(snap.readings.length, 2);
	});

	test("a leading hole is not an empty key: the source opens and serves the readings", () => {
		shape([2]);
		const snap = readShape(); // must not throw gadget-empty
		assert.deepEqual(ids(snap), [2]);
		assert.equal(snap.readings[0]?.label, "Label 2");
	});

	test("multiple holes: every present index, in numeric order", () => {
		shape([0, 3, 9, 20, 38]);
		assert.deepEqual(ids(readShape()), [0, 3, 9, 20, 38]);
	});

	test("the issue #21 topology returns all 25 readings, not the 4 before the first hole", () => {
		shape(ISSUE_PRESENT);
		const snap = readShape();
		assert.equal(snap.readings.length, 25);
		assert.deepEqual(ids(snap), ISSUE_PRESENT);
		assert.equal(ISSUE_PRESENT[4], 6, "the fixture's first hole is at index 4");
		const afterHole = snap.byKey.get("g:Alpha Source:Label 6");
		assert.ok(afterHole !== undefined, "a reading past the first hole is addressable by its stable key");
		assert.equal(afterHole.value, 6.5);
	});

	test("a large gap is crossed: index 0 and the last supported slot", () => {
		shape([0, MAX_ENTRIES - 1]);
		assert.deepEqual(ids(readShape()), [0, MAX_ENTRIES - 1]);
	});

	test("a reading alone in the last supported slot is found", () => {
		shape([MAX_ENTRIES - 1]);
		assert.deepEqual(ids(readShape()), [MAX_ENTRIES - 1]);
	});

	test("the scan bound is exactly MAX_ENTRIES: the last slot is read, the one above it is not", () => {
		shape([MAX_ENTRIES - 1, MAX_ENTRIES]);
		assert.deepEqual(ids(readShape()), [MAX_ENTRIES - 1]);
	});

	test("an entry only above the bound leaves the key looking empty", () => {
		shape([MAX_ENTRIES]);
		assert.equal(reasonOf(() => GadgetRegistryProvider.open()), "gadget-empty");
	});

	test("a dense key still returns exactly MAX_ENTRIES readings", () => {
		shape([...Array(MAX_ENTRIES).keys()]);
		const snap = readShape();
		assert.equal(snap.readings.length, MAX_ENTRIES);
		assert.equal(snap.readings.at(-1)?.id, MAX_ENTRIES - 1);
	});
});

describe("gadget provider: key states and entry shapes", { skip: !onWindows ? "win32-x64 only" : false }, () => {
	test("an empty key is still gadget-empty, not a missing HWiNFO", () => {
		emptyKey();
		assert.equal(reasonOf(() => GadgetRegistryProvider.open()), "gadget-empty");
	});

	test("an absent key reports not-running", () => {
		dropKey();
		assert.equal(reasonOf(() => GadgetRegistryProvider.open()), "not-running");
	});

	test("missing companion values keep their documented fallbacks past a hole", () => {
		shape([0]);
		putValue("Sensor5", "Lonely Source");
		const snap = readShape();
		assert.deepEqual(ids(snap), [0, 5]);
		const lonely = snap.readings[1] as Reading;
		assert.equal(lonely.label, "Reading 5", "absent LabelN falls back to the index");
		assert.equal(lonely.unit, "", "absent ValueN yields no unit");
		assert.ok(Number.isNaN(lonely.value), "absent ValueRawN parses to NaN");
	});

	test("an empty SensorN is a present entry, not an absent one", () => {
		shape([0, 2]);
		putValue("Sensor1", "");
		const snap = readShape();
		assert.deepEqual(ids(snap), [0, 1, 2], "an empty REG_SZ is a value that exists");
		// It groups under an empty sensor name rather than being skipped; the
		// native contract already separates "" from null, and this pins that
		// the reader keeps that distinction.
		assert.equal(snap.readings[1]?.key, "g::Reading 1");
	});

	test("stray Label/Value without a SensorN stays skipped", () => {
		shape([0, 6]);
		putValue("Label3", "Orphan");
		putValue("Value3", "9 °C");
		putValue("ValueRaw3", "9");
		assert.deepEqual(ids(readShape()), [0, 6], "a slot with no SensorN is not a reading");
	});

	test("a malformed SensorN past a hole fails the read closed, it is not skipped", () => {
		shape([0]);
		putValue("Sensor6", "1", "REG_DWORD");
		// Fail-closed is the native boundary's policy for a value that exists
		// but is not REG_SZ; reaching past a hole must not soften it.
		assert.equal(reasonOf(() => GadgetRegistryProvider.open()), "invalid");
	});
});

describe("gadget provider: identity and grouping across holes", { skip: !onWindows ? "win32-x64 only" : false }, () => {
	test("one sensor either side of a hole is one group", () => {
		shape([0, 7], (i) => ({ sensor: "One Source", label: `L${i}`, value: `${i} °C`, raw: String(i) }));
		const snap = readShape();
		assert.equal(snap.sensors.length, 1);
		assert.deepEqual(snap.readings.map((r) => r.sensorIndex), [0, 0]);
	});

	test("different sensors either side of a hole keep dense sensorIndex values", () => {
		shape([0, 7], (i) => ({ sensor: i === 0 ? "First Source" : "Second Source", label: `L${i}`, value: `${i} °C`, raw: String(i) }));
		const snap = readShape();
		assert.equal(snap.sensors.length, 2);
		assert.deepEqual(snap.readings.map((r) => r.sensorIndex), [0, 1]);
		for (const r of snap.readings) {
			assert.ok(snap.sensors[r.sensorIndex] !== undefined, "sensorIndex indexes snapshot.sensors");
		}
	});

	test("duplicate sensor and label across a hole get distinct keys", () => {
		shape([0, 4], () => ({ sensor: "Same Source", label: "Same Label", value: "1 °C", raw: "1" }));
		const snap = readShape();
		assert.deepEqual(snap.readings.map((r) => r.key), ["g:Same Source:Same Label", "g:Same Source:Same Label~1"]);
		assert.equal(snap.byKey.size, 2, "neither reading is lost to a key collision");
	});
});

describe("gadget provider: shape changes between polls", { skip: !onWindows ? "win32-x64 only" : false }, () => {
	test("a hole opening early does not hide the readings after it, and closing restores them", () => {
		shape([0, 1, 2, 5]);
		const provider = GadgetRegistryProvider.open();
		try {
			assert.deepEqual(ids(provider.read()), [0, 1, 2, 5]);

			dropValue("Sensor1"); // the reading at index 1 is disabled in HWiNFO
			assert.deepEqual(ids(provider.read()), [0, 2, 5], "later readings survive an earlier slot vanishing");

			putValue("Sensor1", "Beta Source"); // re-enabled
			assert.deepEqual(ids(provider.read()), [0, 1, 2, 5], "the restored reading comes back");
		} finally {
			provider.close();
		}
	});

	test("a value change past a hole propagates and bumps valueRevision", () => {
		shape([0, 6]);
		const provider = GadgetRegistryProvider.open();
		try {
			const before = provider.read();
			assert.equal(before.byKey.get("g:Alpha Source:Label 6")?.value, 6.5);

			putValue("ValueRaw6", "77.25");
			putValue("Value6", "77.25 °C");
			const after = provider.read();
			assert.equal(after.byKey.get("g:Alpha Source:Label 6")?.value, 77.25);
			assert.ok((after.valueRevision ?? 0) > (before.valueRevision ?? 0), "the digest now covers entries past a hole");

			const idle = provider.read();
			assert.equal(idle.valueRevision, after.valueRevision, "an unchanged key does not bump the revision");
		} finally {
			provider.close();
		}
	});

	test("the key vanishing mid-life still reports not-running, it is not read as holes", () => {
		shape([0, 6]);
		const provider = GadgetRegistryProvider.open();
		try {
			dropKey();
			assert.equal(reasonOf(() => provider.read()), "not-running");
		} finally {
			provider.close();
		}
	});

	test("a deleted and recreated key is served again by a fresh provider", () => {
		shape([0, 6]);
		dropKey();
		assert.equal(reasonOf(() => GadgetRegistryProvider.open()), "not-running");
		shape([0, 6]);
		assert.deepEqual(ids(readShape()), [0, 6]);
	});

	test("adoptFreshness carries the baseline across a reopen probe", () => {
		shape([0, 6]);
		const first = GadgetRegistryProvider.open();
		try {
			const before = first.read();
			const second = GadgetRegistryProvider.open();
			try {
				second.adoptFreshness(first);
				const carried = second.read();
				assert.equal(carried.valueRevision, before.valueRevision, "an unchanged key must not look newly changed");
				assert.equal(carried.pollTime, before.pollTime);
			} finally {
				second.close();
			}
		} finally {
			first.close();
		}
	});
});
