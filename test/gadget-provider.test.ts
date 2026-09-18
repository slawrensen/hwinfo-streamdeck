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
import { after, describe, mock, test } from "node:test";
import type { HwsmGadgetKey } from "../src/hwinfo/hwsm-loader";
import { applyReadingLinks } from "../src/hwinfo/reading-links";

import type { Reading, SensorSnapshot } from "../src/hwinfo/types";

const onWindows = process.platform === "win32" && process.arch === "x64";
const VSB_SUBKEY = `Software\\HwinfoGadgetNT_${process.pid}`;
const REG_PATH = `HKCU\\${VSB_SUBKEY}`;

// Dynamic, because the module snapshots HWINFO_VSB_KEY at load time.
process.env.HWINFO_VSB_KEY = VSB_SUBKEY;
const identityFile = path.join(os.tmpdir(), `hwinfo-gadget-identity-${process.pid}.jsonl`);
process.env.HWINFO_GADGET_IDENTITY_FILE = identityFile;
const { GadgetRegistryProvider } = await import("../src/hwinfo/gadget-registry");

after(() => fs.rmSync(identityFile, { force: true }));

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
 * identifiable. Labels differ from the old synthetic `Reading <i>` fallback
 * so a reader that never queried LabelN cannot pass the label assertions.
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
		return readVerified(provider);
	} finally {
		provider.close();
	}
}

function readVerified(provider: ReturnType<typeof GadgetRegistryProvider.open>): SensorSnapshot {
	const snapshot = provider.read();
	assert.ok(snapshot, "a stable fixture must return a snapshot");
	return snapshot;
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

	test("an incomplete identity is withheld past a hole", () => {
		shape([0]);
		putValue("Sensor5", "Lonely Source");
		const snap = readShape();
		assert.deepEqual(ids(snap), [0]);
		assert.equal(snap.byKey.has("g:Lonely Source:Reading 5"), false, "a slot cannot supply a persistent identity");
		assert.equal(snap.blockedReadingCount, 1);
	});

	test("missing numeric fields preserve an unavailable value under a complete identity", () => {
		shape([0, 5], (i) => i === 0 ? defaultQuartet(i) : { sensor: "Named Source", label: "Named reading" });
		const snap = readShape();
		assert.deepEqual(ids(snap), [0, 5]);
		const lonely = snap.readings[1] as Reading;
		assert.equal(lonely.label, "Named reading");
		assert.equal(lonely.unit, "", "absent ValueN yields no unit");
		assert.ok(Number.isNaN(lonely.value), "absent ValueRawN parses to NaN");
	});

	test("an empty SensorN is withheld without hiding later entries", () => {
		shape([0, 2]);
		putValue("Sensor1", "");
		const snap = readShape();
		assert.deepEqual(ids(snap), [0, 2]);
		assert.equal(snap.blockedReadingCount, 1, "an empty REG_SZ exists but supplies no source identity");
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

	test("duplicate sensor and label across a hole are withheld", () => {
		shape([0, 4], () => ({ sensor: "Same Source", label: "Same Label", value: "1 °C", raw: "1" }));
		const snap = readShape();
		assert.deepEqual(snap.readings, [], "neither duplicate has a stable identity");
		assert.equal(snap.byKey.size, 0);
		assert.equal(snap.blockedReadingCount, 2);
	});
});

describe("gadget provider: shape changes between polls", { skip: !onWindows ? "win32-x64 only" : false }, () => {
	test("a hole opening early does not hide the readings after it, and closing restores them", () => {
		shape([0, 1, 2, 5]);
		const provider = GadgetRegistryProvider.open();
		try {
			assert.deepEqual(ids(readVerified(provider)), [0, 1, 2, 5]);

			dropValue("Sensor1"); // the reading at index 1 is disabled in HWiNFO
			assert.deepEqual(ids(readVerified(provider)), [0, 2, 5], "later readings survive an earlier slot vanishing");

			putValue("Sensor1", "Beta Source"); // re-enabled
			assert.deepEqual(ids(readVerified(provider)), [0, 1, 2, 5], "the restored reading comes back");
		} finally {
			provider.close();
		}
	});

	test("a value change past a hole propagates and bumps valueRevision", () => {
		shape([0, 6]);
		const provider = GadgetRegistryProvider.open();
		try {
			const before = readVerified(provider);
			assert.equal(before.byKey.get("g:Alpha Source:Label 6")?.value, 6.5);

			putValue("ValueRaw6", "77.25");
			putValue("Value6", "77.25 °C");
			putValue("Value6", "77.25 °C");
			const after = readVerified(provider);
			assert.equal(after.byKey.get("g:Alpha Source:Label 6")?.value, 77.25);
			assert.ok((after.valueRevision ?? 0) > (before.valueRevision ?? 0), "the digest now covers entries past a hole");

			const idle = readVerified(provider);
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
			assert.equal(reasonOf(() => readVerified(provider)), "not-running");
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
			const before = readVerified(first);
			const second = GadgetRegistryProvider.open();
			try {
				second.adoptFreshness(first);
				const carried = readVerified(second);
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

describe("integrity: Gadget name identity", { skip: !onWindows ? "win32-x64 only" : false }, () => {
	for (const [name, invalid] of [
		["missing label", { sensor: "Incomplete missing label" }],
		["empty label", { sensor: "Incomplete empty label", label: "" }],
		["whitespace label", { sensor: "Incomplete whitespace label", label: " \t\u00a0 " }],
		["empty source", { sensor: "", label: "Incomplete empty source" }],
		["whitespace source", { sensor: " \t\u00a0 ", label: "Incomplete whitespace source" }]
	] as const) {
		test(`a finite value with ${name} has no selectable Gadget identity`, () => {
			shape([0, 8], (i) => i === 0 ? { ...invalid, value: "40 °C", raw: "40" } : defaultQuartet(i));
			const snapshot = readShape();
			assert.deepEqual(ids(snapshot), [8]);
			assert.equal(snapshot.byKey.size, 1);
			assert.equal(snapshot.sensors.length, 1, "incomplete identities do not create picker groups");
			assert.equal(snapshot.blockedReadingCount, 1);
			assert.equal(snapshot.freshnessRevision, 0);
		});
	}

	test("unlabelled slots cannot change a saved fallback owner through removal, compaction or restart", () => {
		const sensor = "Unlabelled compaction";
		shape([0, 7], (i) => ({ sensor, value: `${i ? 80 : 40} °C`, raw: i ? "80" : "40" }));
		const provider = GadgetRegistryProvider.open();
		try {
			const initial = readVerified(provider);
			assert.deepEqual(initial.readings, []);
			assert.equal(initial.blockedReadingCount, 2);
			dropValue("Sensor0");
			assert.equal(readVerified(provider).byKey.has(`g:${sensor}:Reading 0`), false);
			putValue("Sensor0", sensor);
			putValue("Value0", "80 °C");
			putValue("ValueRaw0", "80");
			dropValue("Sensor7");
			const compacted = readVerified(provider);
			assert.deepEqual(compacted.readings, []);
			assert.equal(compacted.blockedReadingCount, 1);
			assert.equal(compacted.freshnessRevision, 0, "invalid identities cannot establish numeric-change evidence");
		} finally { provider.close(); }
		assert.deepEqual(readShape().readings, []);
	});

	test("a genuine producer Reading 0 label gets a non-positional identity through reorder and restart", () => {
		const sensor = "Literal reading label";
		shape([0], () => ({ sensor, label: "Reading 0", value: "40 °C", raw: "40" }));
		const snapshot = readShape();
		assert.equal(snapshot.byKey.has(`g:${sensor}:Reading 0`), false, "a saved legacy positional selection requires reselection");
		const key = snapshot.readings[0]?.key;
		assert.ok(key);
		assert.ok(key.startsWith("g2:"));
		assert.deepEqual(JSON.parse(Buffer.from(key.slice(3), "base64url").toString()), ["named", sensor, "Reading 0"]);
		shape([9], () => ({ sensor, label: "Reading 0", value: "45 °C", raw: "45" }));
		assert.equal(readShape().byKey.get(key)?.value, 45);
	});

	test("old synthetic identities cannot bind a later real label in another process", () => {
		const sensor = "Legacy fallback collision";
		shape([0], () => ({ sensor, value: "40 °C", raw: "40" }));
		readShape();
		shape([7], () => ({ sensor, label: "Reading 0", value: "80 °C", raw: "80" }));
		const script = 'const { GadgetRegistryProvider } = await import("./src/hwinfo/gadget-registry.ts"); const p = GadgetRegistryProvider.open(); try { process.stdout.write(JSON.stringify(p.read().readings)); } finally { p.close(); }';
		const stdout = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { encoding: "utf8" });
		const readings = JSON.parse(stdout) as Reading[];
		assert.equal(readings.length, 1, "a genuine producer label remains selectable");
		assert.notEqual(readings[0]?.key, `g:${sensor}:Reading 0`, "a real label must not inherit an old slot fallback");
		putValue("Label7", "Uniquely repaired reading");
		assert.equal(readShape().byKey.get(`g:${sensor}:Uniquely repaired reading`)?.value, 80);
	});

	test("real labels never alias synthetic legacy identities in either scan order", () => {
		for (const incompleteSlot of [0, 8]) {
			const sensor = `Current fallback collision ${incompleteSlot}`;
			shape([0, 8], (i) => ({ sensor, ...(i === incompleteSlot ? {} : { label: `Reading ${incompleteSlot}` }), value: `${i ? 80 : 40} °C`, raw: i ? "80" : "40" }));
			const snapshot = readShape();
			assert.equal(snapshot.byKey.has(`g:${sensor}:Reading ${incompleteSlot}`), false);
			assert.deepEqual(ids(snapshot), [incompleteSlot === 0 ? 8 : 0]);
			assert.equal(snapshot.blockedReadingCount, 1);
		}
	});

	test("first observation cannot reuse a legacy encoded fallback identity or its explicit link", () => {
		const sensor = "First upgrade: source";
		const label = "Reading 1023";
		const legacyKey = `g2:${Buffer.from(JSON.stringify([sensor, label])).toString("base64url")}`;
		shape([7], () => ({ sensor, label, value: "80 °C", raw: "80" }));
		const snapshot = readShape();
		assert.equal(snapshot.byKey.has(legacyKey), false, "no prior invalid-row observation is needed for migration safety");
		const newKey = snapshot.readings[0]?.key;
		assert.ok(newKey);
		assert.notEqual(newKey, legacyKey);
		const oldLink = applyReadingLinks(snapshot, [{ sharedMemory: "f0001234:0:1000001", gadget: legacyKey, unit: "°C", sensorType: 1 }], 1);
		assert.equal(oldLink.byKey.has("f0001234:0:1000001"), false);
		const newLink = applyReadingLinks(snapshot, [{ sharedMemory: "f0001234:0:1000001", gadget: newKey, unit: "°C", sensorType: 1 }], 2);
		assert.equal(newLink.byKey.get("f0001234:0:1000001")?.value, 80);
	});

	test("only canonical historical fallback labels require reselection", () => {
		const unchanged = ["Reading 00", "Reading 01", "Reading -1", "Reading 1024", "Reading 1.0", "Reading 1 ", " Reading 1", "reading 1"];
		shape(unchanged.map((_, i) => i), (i) => ({ sensor: "Literal label boundary", label: unchanged[i], value: "40 °C", raw: "40" }));
		const snapshot = readShape();
		for (const label of unchanged) assert.equal(snapshot.byKey.get(`g:Literal label boundary:${label}`)?.value, 40);
	});

	test("literal fallback label duplicates stay withheld after removal and restart", () => {
		const sensor = "Duplicate literal fallback";
		shape([0, 7], (i) => ({ sensor, label: "Reading 17", value: `${i ? 80 : 40} °C`, raw: i ? "80" : "40" }));
		assert.deepEqual(readShape().readings, []);
		dropValue("Sensor0");
		const survivor = readShape();
		assert.deepEqual(survivor.readings, []);
		assert.equal(survivor.blockedReadingCount, 1);
	});

	test("complete producer names retain significant surrounding spaces", () => {
		shape([0], () => ({ sensor: " Source with spaces ", label: " Reading with spaces ", value: "40 °C", raw: "40" }));
		assert.equal(readShape().byKey.get("g: Source with spaces : Reading with spaces ")?.value, 40);
	});

	test("removing slot zero never substitutes slot one for the saved base key", () => {
		shape([0, 1], (i) => ({ sensor: "GPU", label: "Temperature", value: `${i ? 80 : 40} °C`, raw: i ? "80" : "40" }));
		const provider = GadgetRegistryProvider.open();
		try {
			readVerified(provider);
			dropValue("Sensor0");
			const afterGap = readVerified(provider);
			assert.equal(afterGap.byKey.get("g:GPU:Temperature"), undefined, "80 must never replace the removed 40");
			assert.equal(afterGap.byKey.get("g:GPU:Temperature~1"), undefined, "encounter-order suffixes are not identities");
		} finally {
			provider.close();
		}
		const restarted = GadgetRegistryProvider.open();
		try {
			assert.equal(readVerified(restarted).byKey.get("g:GPU:Temperature"), undefined, "a reopen must remember observed ambiguity");
		} finally {
			restarted.close();
		}
	});

	test("duplicate names cannot acquire a selectable identity through reorder or restart", () => {
		shape([0, 7], (i) => ({ sensor: "Duplicate GPU", label: "Temperature", value: `${i ? 80 : 40} °C`, raw: i ? "80" : "40" }));
		assert.equal(readShape().readings.length, 0, "the registry contains no evidence identifying either duplicate");
		shape([0, 7], (i) => ({ sensor: "Duplicate GPU", label: "Temperature", value: `${i ? 40 : 80} °C`, raw: i ? "40" : "80" }));
		assert.equal(readShape().readings.length, 0);
	});

	test("ambiguous colon partitions and literal tildes never alias legacy keys", () => {
		shape([0, 1, 2], (i) => ({ sensor: ["GPU:0", "GPU", "GPU"][i], label: ["Temp", "0:Temp", "Temperature~1"][i], value: `${40 + i} °C`, raw: String(40 + i) }));
		const snapshot = readShape();
		assert.equal(snapshot.byKey.size, 3, "two rows spell the same 1.6 key, so neither gets it back");
		assert.equal(snapshot.byKey.get("g:GPU:0:Temp"), undefined, "legacy colon keys do not identify their partition");
		assert.equal(snapshot.byKey.get("g:GPU:Temperature~1"), undefined, "literal suffix must not adopt an old duplicate selection");
		assert.deepEqual(snapshot.readings.map((r) => r.value), [40, 41, 42]);
	});

	test("unique names with spaces survive sparse reorder and restart; rename leaves the old key missing", () => {
		shape([0, 8], (i) => ({ sensor: "Stable Source", label: i === 0 ? "CPU Temp" : "GPU Temp", raw: i === 0 ? "40" : "80", value: `${i === 0 ? 40 : 80} °C` }));
		assert.equal(readShape().byKey.get("g:Stable Source:CPU Temp")?.value, 40);
		shape([4, 9], (i) => ({ sensor: "Stable Source", label: i === 9 ? "CPU Temp" : "GPU Temp", raw: i === 9 ? "40" : "80", value: `${i === 9 ? 40 : 80} °C` }));
		assert.equal(readShape().byKey.get("g:Stable Source:CPU Temp")?.value, 40);
		putValue("Label9", "CPU Package");
		const renamed = readShape();
		assert.equal(renamed.byKey.get("g:Stable Source:CPU Temp"), undefined);
		assert.equal(renamed.byKey.get("g:Stable Source:CPU Package")?.value, 40);
	});
});

describe("integrity: Gadget evidence and statistics", { skip: !onWindows ? "win32-x64 only" : false }, () => {
	test("formatted locales retain native raw precision and the correct unit", () => {
		const cases = [["2,295.0 MHz", "2295.04", "MHz", 2295.04], ["2.295,0 MHz", "2295,04", "MHz", 2295.04], ["2'295.0 MHz", "2295.04", "MHz", 2295.04], ["2\u202f295,0 MHz", "2295,04", "MHz", 2295.04], ["−1,2 A", "-1,249", "A", -1.249], ["1.23e4 Hz", "12345", "Hz", 12345], ["Yes", "1", "Yes", 1]] as const;
		shape(cases.map((_, i) => i), (i) => ({ sensor: "Locale fixture", label: `Case ${i}`, value: cases[i]![0], raw: cases[i]![1] }));
		const snapshot = readShape();
		for (const [i, entry] of cases.entries()) {
			assert.equal(snapshot.readings[i]?.value, entry[3]);
			assert.equal(snapshot.readings[i]?.unit, entry[2]);
		}
	});
	test("a paused formatted-unit rewrite cannot publish the previous raw number", () => {
		shape([0], () => ({ sensor: "Unit fixture", label: "Temperature", value: "80 °C", raw: "80" }));
		const provider = GadgetRegistryProvider.open();
		try {
			putValue("Value0", "176 °F");
			assert.equal(provider.read(), null, "a first contradictory sighting skips the scan like any interleave");
			putValue("ValueRaw0", "176");
			assert.equal(readVerified(provider).readings[0]?.value, 176);
			assert.equal(readVerified(provider).readings[0]?.unit, "°F");
		} finally { provider.close(); }
	});
	test("a detected field interleave discards the whole scan before publishing evidence", () => {
		for (const field of ["Sensor0", "Label0", "Value0", "ValueRaw0"]) {
			shape([0]);
			const provider = GadgetRegistryProvider.open();
			const nativeKey = Reflect.get(provider, "key") as HwsmGadgetKey;
			let swapped = false;
			Reflect.set(provider, "key", {
				queryString(name: string): string | null {
					const value = nativeKey.queryString(name);
					if (!swapped && name === field) {
						swapped = true;
						putValue(field, field === "ValueRaw0" ? "60" : "Rewritten fixture field");
					}
					return value;
				},
				close: () => nativeKey.close()
			});
			try {
				assert.equal(provider.read(), null, `${field} changed between the two observations`);
				assert.ok(swapped);
			} finally { provider.close(); }
		}
	});
	test("an interleaved cold open reports busy rather than empty", () => {
		shape([0]);
		const seam = mock.method(GadgetRegistryProvider.prototype, "read", () => null);
		try { assert.equal(reasonOf(() => GadgetRegistryProvider.open()), "busy"); }
		finally { seam.mock.restore(); }
	});
	test("numeric formatting and invalid baselines do not manufacture freshness", () => {
		for (const [before, after] of [["40", "40.000"], ["unavailable", "40"]]) {
			shape([0], () => ({ sensor: "Evidence Source", label: "Constant", raw: before, value: "40 °C" }));
			const provider = GadgetRegistryProvider.open();
			try {
				putValue("ValueRaw0", after as string);
				assert.equal(readVerified(provider).freshnessRevision, 0);
			} finally { provider.close(); }
		}
	});
	test("current-only readings never manufacture historical numbers", () => {
		shape([0]);
		const reading = readShape().readings[0];
		assert.ok(reading);
		assert.ok(Number.isNaN(reading.valueMin));
		assert.ok(Number.isNaN(reading.valueMax));
		assert.ok(Number.isNaN(reading.valueAvg));
	});

	test("an unchanged initial registry is unverified; only a value change supplies evidence", () => {
		shape([0]);
		const provider = GadgetRegistryProvider.open();
		try {
			const first = readVerified(provider);
			assert.equal(first.pollTime, 0, "first observation is not a producer timestamp");
			assert.equal(readVerified(provider).pollTime, 0, "successful reads of old data are not fresh");
			putValue("Label0", "Renamed without a new sample");
			const renamed = readVerified(provider);
			assert.equal(renamed.pollTime, 0, "topology is not value evidence");
			assert.ok((renamed.valueRevision ?? 0) > (first.valueRevision ?? 0), "render revision includes topology");
			putValue("ValueRaw0", "55");
			putValue("Value0", "55 °C");
			const changed = readVerified(provider);
			assert.ok(changed.pollTime > 0);
			assert.equal(readVerified(provider).pollTime, changed.pollTime);
		} finally {
			provider.close();
		}
	});
});

describe("refutation: persistent Gadget ambiguity", { skip: !onWindows ? "win32-x64 only" : false }, () => {
	for (const numericState of ["contradictory", "changing formatted", "changing raw", "missing formatted", "missing raw", "nonfinite raw", "throwing formatted reread", "throwing raw reread"] as const) {
		test(`stable duplicate identity survives its own ${numericState} numeric fields`, () => {
			const source = `Own row ${numericState}`;
			const savedKey = `g:${source}:Temperature`;
			shape([0, 8], (i) => ({ sensor: source, label: i === 0 ? "Temperature" : "Other", raw: "40", value: "40 °C" }));
			const provider = GadgetRegistryProvider.open();
			const nativeKey = Reflect.get(provider, "key") as HwsmGadgetKey;
			try {
				const before = readVerified(provider);
				putValue("Sensor1", source);
				putValue("Label1", "Temperature");
				if (numericState !== "missing formatted") putValue("Value1", numericState === "contradictory" ? "99 °C" : "80 °C");
				if (numericState !== "missing raw") putValue("ValueRaw1", numericState === "nonfinite raw" ? "unavailable" : "80");
				const visits = new Map<string, number>();
				Reflect.set(provider, "key", {
					queryString(name: string): string | null {
						const count = (visits.get(name) ?? 0) + 1;
						visits.set(name, count);
						if (count === 2) {
							if ((numericState === "throwing formatted reread" && name === "Value1") || (numericState === "throwing raw reread" && name === "ValueRaw1")) throw new Error("fixture numeric reread failure");
							if (numericState === "changing formatted" && name === "Value1") return "99 °C";
							if (numericState === "changing raw" && name === "ValueRaw1") return "99";
						}
						return nativeKey.queryString(name);
					},
					close: () => nativeKey.close()
				});
				const rejected = !numericState.startsWith("missing") && numericState !== "nonfinite raw";
				if (numericState.startsWith("throwing")) assert.throws(() => provider.read(), /fixture numeric reread failure/);
				else if (rejected) assert.equal(provider.read(), null, "invalid values never publish a partial snapshot");
				else assert.equal(readVerified(provider).byKey.get(savedKey), undefined, "unavailable values do not disguise duplicate identity");
				assert.equal(visits.get("Sensor1"), 2);
				assert.equal(visits.get("Label1"), 2);
				assert.ok([...visits.values()].every((count) => count <= 2), "identity protection does not add row retries");
				if (rejected) assert.equal(Reflect.get(provider, "valueRevision"), before.valueRevision);
				assert.equal(Reflect.get(provider, "freshnessRevision"), before.freshnessRevision);
				Reflect.set(provider, "key", nativeKey);
				dropValue("Sensor0");
				putValue("Value1", "80 °C");
				putValue("ValueRaw1", "80");
				const recovered = readVerified(provider);
				assert.equal(recovered.byKey.get(savedKey), undefined, "the numerically repaired survivor cannot adopt the removed owner");
				assert.equal(recovered.blockedReadingCount, 1);
				assert.equal(recovered.freshnessRevision, before.freshnessRevision);
				const linked = applyReadingLinks(recovered, [{ sharedMemory: "f0001234:0:1000001", gadget: savedKey, unit: "°C", sensorType: 1 }], 1);
				assert.equal(linked.byKey.get("f0001234:0:1000001"), undefined);
			} finally { provider.close(); }
			assert.equal(readShape().byKey.get(savedKey), undefined, "reopening cannot forget coherent identity evidence");
		});
	}

	for (const identityField of ["Sensor1", "Label1"]) {
		test(`an unstable ${identityField} does not manufacture verified duplicate evidence`, () => {
			const source = `Unstable identity ${identityField}`;
			const savedKey = `g:${source}:Temperature`;
			shape([0], () => ({ sensor: source, label: "Temperature", raw: "40", value: "40 °C" }));
			const provider = GadgetRegistryProvider.open();
			const nativeKey = Reflect.get(provider, "key") as HwsmGadgetKey;
			try {
				putValue("Sensor1", source);
				putValue("Label1", "Temperature");
				putValue("Value1", "80 °C");
				putValue("ValueRaw1", "80");
				let visits = 0;
				Reflect.set(provider, "key", {
					queryString(name: string): string | null {
						if (name === identityField && ++visits === 2) return "Different identity";
						return nativeKey.queryString(name);
					},
					close: () => nativeKey.close()
				});
				assert.equal(provider.read(), null);
				Reflect.set(provider, "key", nativeKey);
				putValue("Label1", "Different temperature");
				assert.equal(readVerified(provider).byKey.get(savedKey)?.value, 40);
			} finally { provider.close(); }
		});
	}

	for (const failure of ["field interleave", "numeric contradiction", "query error"] as const) {
		test(`verified duplicate history survives a later ${failure}`, () => {
			const source = `Partial scan ${failure}`;
			const savedKey = `g:${source}:Temperature`;
			shape([0, 8], (i) => ({ sensor: source, label: i === 0 ? "Temperature" : "Other", raw: i === 0 ? "40" : "10", value: `${i === 0 ? 40 : 10} °C` }));
			const provider = GadgetRegistryProvider.open();
			const nativeKey = Reflect.get(provider, "key") as HwsmGadgetKey;
			try {
				const before = readVerified(provider);
				assert.equal(before.byKey.get(savedKey)?.value, 40);
				// Both duplicate rows are coherent, and precede the unrelated
				// failing slot. The changed prefix value must not become freshness.
				putValue("Value0", "45 °C");
				putValue("ValueRaw0", "45");
				putValue("Sensor1", source);
				putValue("Label1", "Temperature");
				putValue("Value1", "80 °C");
				putValue("ValueRaw1", "80");
				if (failure === "numeric contradiction") putValue("Value8", "99 °C");
				let visits = 0;
				Reflect.set(provider, "key", {
					queryString(name: string): string | null {
						if (name === "Value8") {
							visits++;
							if (failure === "query error") throw new Error("fixture query failure");
							if (failure === "field interleave" && visits === 2) return "99 °C";
						}
						return nativeKey.queryString(name);
					},
					close: () => nativeKey.close()
				});
				if (failure === "query error") assert.throws(() => provider.read(), /fixture query failure/);
				else assert.equal(provider.read(), null, "an incoherent scan never publishes a prefix");
				assert.ok(visits > 0, "the rejection follows both coherent duplicate rows");
				assert.equal(Reflect.get(provider, "valueRevision"), before.valueRevision, "no rejected digest commits");
				assert.equal(Reflect.get(provider, "freshnessRevision"), before.freshnessRevision, "no rejected measurement evidence commits");
				Reflect.set(provider, "key", nativeKey);
				dropValue("Sensor0");
				putValue("Value8", "10 °C");
				const after = readVerified(provider);
				assert.equal(after.byKey.get(savedKey), undefined, "80 must never replace the removed 40 after a rejected scan");
				assert.equal(after.blockedReadingCount, 1);
				assert.equal(after.freshnessRevision, before.freshnessRevision);
				const linked = applyReadingLinks(after, [{ sharedMemory: "f0001234:0:1000001", gadget: savedKey, unit: "°C", sensorType: 1 }], 1);
				assert.equal(linked.byKey.get("f0001234:0:1000001"), undefined, "an explicit alias cannot revive a denied owner");
			} finally { provider.close(); }
			assert.equal(readShape().byKey.get(savedKey), undefined, "a reopened provider keeps the prefix ambiguity");
		});
	}

	test("a rejected unique prefix remains compatible when the full scan recovers", () => {
		shape([0, 8], (i) => ({ sensor: "Unique rejected prefix", label: `Measurement ${i}`, raw: "40", value: "40 °C" }));
		const provider = GadgetRegistryProvider.open();
		try {
			const before = readVerified(provider);
			putValue("Value0", "45 °C");
			putValue("ValueRaw0", "45");
			putValue("Value8", "99 °C");
			assert.equal(provider.read(), null);
			assert.equal(Reflect.get(provider, "freshnessRevision"), before.freshnessRevision);
			putValue("Value8", "40 °C");
			const recovered = readVerified(provider);
			assert.equal(recovered.byKey.get("g:Unique rejected prefix:Measurement 0")?.value, 45);
			assert.equal(recovered.blockedReadingCount, 0);
			assert.equal(recovered.freshnessRevision, (before.freshnessRevision ?? 0) + 1);
		} finally { provider.close(); }
	});

	test("a row that contradicts itself twice running withholds only itself while the rest of the scan keeps its evidence", () => {
		shape([0, 8], (i) => ({ sensor: "Unique rejected prefix", label: `Measurement ${i}`, raw: "40", value: "40 °C" }));
		const provider = GadgetRegistryProvider.open();
		try {
			const before = readVerified(provider);
			putValue("Value0", "45 °C");
			putValue("ValueRaw0", "45");
			putValue("Value8", "99 °C");
			assert.equal(provider.read(), null, "the first sighting skips the scan; nothing commits");
			assert.equal(Reflect.get(provider, "freshnessRevision"), before.freshnessRevision);
			const partial = readVerified(provider);
			assert.deepEqual(labels(partial), ["Measurement 0"], "the healthy row serves");
			assert.equal(partial.byKey.get("g:Unique rejected prefix:Measurement 0")?.value, 45);
			assert.equal(partial.contradictoryReadingCount, 1);
			assert.equal(partial.freshnessRevision, (before.freshnessRevision ?? 0) + 1, "the healthy row's change is evidence");
			putValue("Value8", "40 °C");
			const recovered = readVerified(provider);
			assert.deepEqual(labels(recovered), ["Measurement 0", "Measurement 8"]);
			assert.equal(recovered.blockedReadingCount, 0);
			assert.equal(recovered.contradictoryReadingCount, undefined);
			assert.equal(recovered.freshnessRevision, partial.freshnessRevision, "the recovered row's unchanged raw number is not new evidence");
		} finally { provider.close(); }
	});

	test("a rejected scan fails closed if verified ambiguity cannot be journaled", () => {
		shape([0, 8], (i) => ({ sensor: "Unwritable partial journal", label: i === 0 ? "Temperature" : "Other", raw: "40", value: "40 °C" }));
		const provider = GadgetRegistryProvider.open();
		try {
			putValue("Sensor1", "Unwritable partial journal");
			putValue("Label1", "Temperature");
			putValue("Value1", "80 °C");
			putValue("ValueRaw1", "80");
			putValue("Value8", "99 °C");
			// A real file cannot be the parent of the journal destination.
			// Point only this provider's guard there after its clean open.
			if (!fs.existsSync(identityFile)) fs.writeFileSync(identityFile, "");
			Reflect.set(Reflect.get(provider, "identity") as object, "file", path.join(identityFile, "impossible-child"));
			assert.equal(reasonOf(() => provider.read()), "invalid", "a null/busy result must not hide failed identity persistence");
		} finally { provider.close(); }
	});

	test("a separate process cannot adopt a disappeared duplicate", () => {
		shape([0, 1], (i) => ({ sensor: "Restart GPU", label: "Temperature", raw: i ? "80" : "40", value: `${i ? 80 : 40} °C` }));
		readShape();
		dropValue("Sensor0");
		const script = 'const { GadgetRegistryProvider } = await import("./src/hwinfo/gadget-registry.ts"); const p = GadgetRegistryProvider.open(); try { process.stdout.write(JSON.stringify(p.read().readings)); } finally { p.close(); }';
		const stdout = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { encoding: "utf8" });
		assert.deepEqual(JSON.parse(stdout), []);
		assert.doesNotMatch(fs.readFileSync(identityFile, "utf8"), /Restart GPU|Temperature|^(?:40|80)$/m);
	});

	test("duplicate values cannot manufacture producer evidence on an unchanged scan", () => {
		shape([0, 8], (i) => ({ sensor: "Frozen duplicate", label: "Temp", raw: i ? "80" : "40", value: `${i ? 80 : 40} °C` }));
		const provider = GadgetRegistryProvider.open();
		try {
			for (let i = 0; i < 4; i++) assert.equal(readVerified(provider).freshnessRevision, 0);
		} finally { provider.close(); }
	});

	test("a corrupt journal fails closed and never discards history", () => {
		const saved = fs.readFileSync(identityFile, "utf8");
		try {
			fs.writeFileSync(identityFile, "incomplete history");
			shape([0]);
			assert.equal(reasonOf(() => GadgetRegistryProvider.open()), "invalid");
			assert.equal(fs.readFileSync(identityFile, "utf8"), "incomplete history");
		} finally { fs.writeFileSync(identityFile, saved); }
	});

	test("an unwritable journal destination cannot return ambiguous readings", () => {
		const savedPath = process.env.HWINFO_GADGET_IDENTITY_FILE;
		try {
			process.env.HWINFO_GADGET_IDENTITY_FILE = path.join(identityFile, "impossible-child");
			shape([0, 1], () => ({ sensor: "Denied duplicate", label: "Temp", raw: "40", value: "40 °C" }));
			assert.equal(reasonOf(() => GadgetRegistryProvider.open()), "invalid");
		} finally { process.env.HWINFO_GADGET_IDENTITY_FILE = savedPath; }
	});
});

describe("upgrade: legacy Gadget spellings resolve as checked aliases", { skip: !onWindows ? "win32-x64 only" : false }, () => {
	// 1.6 saved "g:<source>:<label>" for every row, and HWiNFO's standard
	// source names carry a colon, so nearly every old Gadget selection spells
	// a key this build no longer mints. The provider republishes that
	// spelling as an alias of the row it names, when it is unambiguous.
	const source = "CPU [#0]: AMD Ryzen 9 9950X3D";
	const legacy = `g:${source}:CPU (Tctl/Tdie)`;

	test("an unambiguous 1.6 key resolves to its reading with the same value", () => {
		shape([0, 1], (i) => (i === 0 ? { sensor: source, label: "CPU (Tctl/Tdie)", value: "55.0 °C", raw: "55" } : { sensor: "Alpha Source", label: "Plain", value: "1.5 V", raw: "1.5" }));
		const snap = readShape();
		const live = snap.readings.find((r) => r.label === "CPU (Tctl/Tdie)");
		assert.ok(live);
		assert.match(live.key, /^g2:/, "the current key stays unambiguous");
		const alias = snap.byKey.get(legacy);
		assert.ok(alias, "the 1.6 spelling is published");
		assert.equal(alias.value, 55);
		assert.equal(alias.aliasOf, live.key);
		assert.deepEqual(alias.linkedKeys, [live.key, legacy]);
		assert.deepEqual(live.linkedKeys, [live.key, legacy]);
		assert.equal(snap.byKey.get("g:Alpha Source:Plain")?.linkedKeys, undefined, "a plain key needs no alias");
	});

	test("two rows rendering the same 1.6 spelling alias neither", () => {
		shape([0, 1], (i) => (i === 0 ? { sensor: "A:B", label: "C", value: "1.0 V", raw: "1" } : { sensor: "A", label: "B:C", value: "2.0 V", raw: "2" }));
		const snap = readShape();
		assert.equal(snap.readings.length, 2);
		assert.equal(snap.byKey.get("g:A:B:C"), undefined, "an ambiguous spelling resolves to nothing");
		assert.ok(snap.readings.every((r) => r.linkedKeys === undefined));
	});

	test("a literal fallback label gets no legacy alias", () => {
		shape([0], () => ({ sensor: source, label: "Reading 3", value: "3.0 V", raw: "3" }));
		const snap = readShape();
		assert.equal(snap.readings.length, 1);
		assert.equal(snap.byKey.get(`g:${source}:Reading 3`), undefined);
	});
});

describe("integrity: one contradictory row does not take the source down", { skip: !onWindows ? "win32-x64 only" : false }, () => {
	test("a key whose only row is contradictory opens as withheld, not as empty", () => {
		shape([0], () => ({ sensor: "Alpha Source", label: "Hot Spot", value: "104.0 °F", raw: "40" }));
		const provider = GadgetRegistryProvider.open();
		try {
			const snap = readVerified(provider);
			assert.equal(snap.readings.length, 0);
			assert.equal(snap.contradictoryReadingCount, 1);
			assert.match(provider.notices()[0] ?? "", /slot 0/, "the notice survives the open so the poller can log it");
		} finally {
			provider.close();
		}
	});

	test("a reopen that adopts the previous provider does not report the same slot again", () => {
		shape([0, 1], (i) => (i === 0 ? { sensor: "Alpha Source", label: "Package", value: "55.0 °C", raw: "55" } : { sensor: "Alpha Source", label: "Hot Spot", value: "104.0 °F", raw: "40" }));
		const first = GadgetRegistryProvider.open();
		let second: ReturnType<typeof GadgetRegistryProvider.open> | undefined;
		try {
			assert.equal(first.notices().length, 1);
			second = GadgetRegistryProvider.open();
			second.adoptFreshness(first);
			assert.deepEqual(second.notices(), [], "the verification read's notice is taken back on adoption");
			assert.equal(readVerified(second).contradictoryReadingCount, 1);
			assert.deepEqual(second.notices(), []);
		} finally {
			first.close();
			second?.close();
		}
	});

	test("a withheld row still owns its 1.6 spelling, so a colliding sibling never adopts it", () => {
		shape([0, 1], (i) => (i === 0 ? { sensor: "A:B", label: "C", value: "1.0 V", raw: "1" } : { sensor: "A", label: "B:C", value: "9.0 V", raw: "2" }));
		const provider = GadgetRegistryProvider.open();
		try {
			const snap = readVerified(provider);
			assert.equal(snap.readings.length, 1);
			assert.equal(snap.contradictoryReadingCount, 1);
			assert.equal(snap.byKey.get("g:A:B:C"), undefined, "the spelling stays ambiguous while its other owner is only withheld");
		} finally {
			provider.close();
		}
	});

	test("the healthy rows serve, the odd row is withheld, counted and logged once", () => {
		shape([0, 1], (i) => (i === 0 ? { sensor: "Alpha Source", label: "Package", value: "55.0 °C", raw: "55" } : { sensor: "Alpha Source", label: "Hot Spot", value: "104.0 °F", raw: "40" }));
		const provider = GadgetRegistryProvider.open();
		try {
			const snap = readVerified(provider);
			assert.deepEqual(labels(snap), ["Package"]);
			assert.equal(snap.contradictoryReadingCount, 1);
			const notices = provider.notices();
			assert.equal(notices.length, 1);
			assert.match(notices[0] ?? "", /slot 1/);
			assert.match(notices[0] ?? "", /104\.0 °F/);
			readVerified(provider);
			assert.deepEqual(provider.notices(), [], "said once per slot");
		} finally {
			provider.close();
		}
	});
});

describe("integrity: a Yes/No reading's flip is value evidence", { skip: !onWindows ? "win32-x64 only" : false }, () => {
	test("the raw 1 to 0 change advances freshness although the display word changed with it", () => {
		shape([0], () => ({ sensor: "Drive", label: "Trim", value: "Yes", raw: "1" }));
		const provider = GadgetRegistryProvider.open();
		try {
			const first = readVerified(provider);
			assert.equal(first.freshnessRevision, 0);
			assert.equal(first.pollTime, 0);
			putValue("Value0", "No");
			putValue("ValueRaw0", "0");
			const second = readVerified(provider);
			assert.equal(second.readings[0]?.value, 0);
			assert.equal(second.freshnessRevision, 1);
			assert.ok(second.pollTime > 0, "an observed change is the Gadget freshness evidence");
		} finally {
			provider.close();
		}
	});
});
