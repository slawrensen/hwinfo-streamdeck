/**
 * GadgetRegistryProvider integration suite (Windows-only; skipped cleanly
 * elsewhere). Drives the real provider over the real hwsm addon against a
 * real synthetic HKCU key, because the defect this suite exists for lives
 * in the seam between them: HWiNFO leaves permanent holes in the VSB
 * numbering (a reading that stays ticked but is not being written, one
 * disabled in the sensor window, keeps its VSBidx with nothing in the
 * slot), and the reader used to treat the first missing `SensorN` as the
 * end of the list.
 *
 * Runs in CI with the rest of `npm run test:native`, after build:native.
 *
 * The provider freezes HWINFO_VSB_KEY at module load, so every case here
 * reshapes ONE subkey rather than using a fresh path per case.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, mock, test } from "node:test";
import { gadgetReadingKey, legacyGadgetKey } from "../src/hwinfo/gadget-identity";
import type { HwsmGadgetKey } from "../src/hwinfo/hwsm-loader";
import { applyReadingLinks } from "../src/hwinfo/reading-links";
import { HwinfoError } from "../src/hwinfo/types";
import { statusDialText, statusScreen, statusSentence } from "../src/ui/state-screens";
import { SessionStatsStore } from "../src/stats";
import { tickSignature } from "../src/detail/tick-signature";

import type { Reading, SensorSnapshot } from "../src/hwinfo/types";
import type { PollerStatus } from "../src/poller";

const onWindows = process.platform === "win32" && process.arch === "x64";
const VSB_SUBKEY = `Software\\HwinfoGadgetNT_${process.pid}_${randomUUID()}`;
const REG_PATH = `HKCU\\${VSB_SUBKEY}`;
assert.match(VSB_SUBKEY, /^Software\\HwinfoGadgetNT_\d+_[a-f0-9-]{36}$/);

// Dynamic, because the module snapshots HWINFO_VSB_KEY at load time.
process.env.HWINFO_VSB_KEY = VSB_SUBKEY;
const { GadgetRegistryProvider } = await import("../src/hwinfo/gadget-registry");
// After the environment above: the poller imports the provider, which
// freezes HWINFO_VSB_KEY at module load.
const { poller } = await import("../src/poller");
const { SharedMemoryProvider } = await import("../src/hwinfo/provider");

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

type Provider = ReturnType<typeof GadgetRegistryProvider.open>;
type Row = Required<Quartet>;

/** Uniquely named rows under one source; the value tracks the name. */
function probes(sensor: string, count: number): Row[] {
	return Array.from({ length: count }, (_, i) => ({ sensor, label: `Probe ${i}`, value: `${40 + i}.0 °C`, raw: `${40 + i}.0` }));
}

/** Replaces the key with `rows` as one dense run, the way a HWiNFO start writes it. */
function shapeRows(rows: readonly Row[]): void {
	shape(rows.map((_, i) => i), (i) => rows[i] as Row);
}

/** One whole slot in place: the unit HWiNFO's renumber writes between two scans. */
function putSlot(i: number, row: Row): void {
	putValue(`Sensor${i}`, row.sensor);
	putValue(`Label${i}`, row.label);
	putValue(`Value${i}`, row.value);
	putValue(`ValueRaw${i}`, row.raw);
}

function dropSlot(i: number): void {
	for (const field of ["Sensor", "Label", "Value", "ValueRaw"]) dropValue(`${field}${i}`);
}

/**
 * HWiNFO unticks rows[r]: every later row moves down one slot, written
 * ascending one whole slot at a time, and the old top slot is deleted last.
 * Between two writes one reading sits in two adjacent slots. Returns what a
 * scan after every single slot write saw.
 */
function untick(provider: Provider, rows: readonly Row[], r: number): (SensorSnapshot | null)[] {
	const torn: (SensorSnapshot | null)[] = [];
	for (let slot = r; slot < rows.length - 1; slot++) {
		putSlot(slot, rows[slot + 1] as Row);
		torn.push(provider.read());
	}
	dropSlot(rows.length - 1);
	return torn;
}

/**
 * HWiNFO ticks `added` at position r: it and every later row are written one
 * slot up, ascending. Between two writes the row being moved sits in no slot.
 */
function tick(provider: Provider, rows: readonly Row[], r: number, added: Row): (SensorSnapshot | null)[] {
	const next = [...rows.slice(0, r), added, ...rows.slice(r)];
	const torn: (SensorSnapshot | null)[] = [];
	for (let slot = r; slot < next.length; slot++) {
		putSlot(slot, next[slot] as Row);
		torn.push(provider.read());
	}
	return torn;
}

/** What a separate process publishes from the same key, with nothing shared but the registry. */
function readInChildProcess(): Reading[] {
	const script = 'const { GadgetRegistryProvider } = await import("./src/hwinfo/gadget-registry.ts"); const p = GadgetRegistryProvider.open(); try { process.stdout.write(JSON.stringify(p.read().readings)); } finally { p.close(); }';
	return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { encoding: "utf8" })) as Reading[];
}

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

	test("literal fallback label duplicates are withheld only while both are present", () => {
		const sensor = "Duplicate literal fallback";
		shape([0, 7], (i) => ({ sensor, label: "Reading 17", value: `${i ? 80 : 40} °C`, raw: i ? "80" : "40" }));
		const both = readShape();
		assert.deepEqual(both.readings, []);
		assert.equal(both.blockedReadingCount, 2);
		dropValue("Sensor0");
		const survivor = readShape();
		assert.deepEqual(survivor.readings.map((reading) => reading.value), [80], "a fresh provider remembers nothing: the reading that is left has the name to itself");
		assert.equal(survivor.blockedReadingCount, 0);
		assert.equal(survivor.byKey.has(`g:${sensor}:Reading 17`), false, "and still never under the old positional spelling");
	});

	test("complete producer names retain significant surrounding spaces", () => {
		shape([0], () => ({ sensor: " Source with spaces ", label: " Reading with spaces ", value: "40 °C", raw: "40" }));
		assert.equal(readShape().byKey.get("g: Source with spaces : Reading with spaces ")?.value, 40);
	});

	test("removing slot zero hands slot one the base key only after two clean scans, and never an encounter-order suffix", () => {
		shape([0, 1], (i) => ({ sensor: "GPU", label: "Temperature", value: `${i ? 80 : 40} °C`, raw: i ? "80" : "40" }));
		const provider = GadgetRegistryProvider.open();
		try {
			assert.equal(readVerified(provider).byKey.get("g:GPU:Temperature"), undefined, "while both are ticked neither is guessed at");
			dropValue("Sensor0");
			const afterGap = readVerified(provider);
			assert.equal(afterGap.byKey.get("g:GPU:Temperature"), undefined, "one scan showing the name once is not enough");
			assert.equal(afterGap.byKey.get("g:GPU:Temperature~1"), undefined, "encounter-order suffixes are not identities");
			const released = readVerified(provider);
			assert.equal(released.byKey.get("g:GPU:Temperature")?.value, 80, "the name now means the reading that is left");
			assert.equal(released.byKey.get("g:GPU:Temperature~1"), undefined);
		} finally {
			provider.close();
		}
		const restarted = GadgetRegistryProvider.open();
		try {
			assert.equal(readVerified(restarted).byKey.get("g:GPU:Temperature")?.value, 80, "a reopen remembers nothing");
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
		const cases = [["2,295.0 MHz", "2295.04", "MHz", 2295.04], ["2.295,0 MHz", "2295,04", "MHz", 2295.04], ["2'295.0 MHz", "2295.04", "MHz", 2295.04], ["2\u202f295,0 MHz", "2295,04", "MHz", 2295.04], ["−1,2 A", "-1,249", "A", -1.249], ["1.23e4 Hz", "12345", "Hz", 12345], ["Yes", "1", "Yes/No", 1], ["No", "0", "Yes/No", 0], ["On", "1", "On", 1]] as const;
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

describe("refutation: Gadget ambiguity lasts while it stands, and no longer", { skip: !onWindows ? "win32-x64 only" : false }, () => {
	for (const numericState of ["contradictory", "changing formatted", "changing raw", "missing formatted", "missing raw", "nonfinite raw", "throwing formatted reread", "throwing raw reread"] as const) {
		test(`a twin with ${numericState} numeric fields still shares its name, and only while it stands`, () => {
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
				// A scan the twin's own numeric reread cuts short saw only a
				// prefix of the rows. One that runs to the end sees the name
				// twice for the first time. Either way nothing publishes.
				const cutShort = numericState.startsWith("changing") || numericState.startsWith("throwing");
				if (numericState.startsWith("throwing")) assert.throws(() => provider.read(), /fixture numeric reread failure/);
				else assert.equal(provider.read(), null, cutShort ? "invalid values never publish a partial snapshot" : "a first sighting of a shared name skips the scan");
				assert.equal(visits.get("Sensor1"), 2);
				assert.equal(visits.get("Label1"), 2);
				assert.ok([...visits.values()].every((count) => count <= 2), "identity protection does not add row retries");
				assert.equal(Reflect.get(provider, "valueRevision"), before.valueRevision);
				assert.equal(Reflect.get(provider, "freshnessRevision"), before.freshnessRevision);
				Reflect.set(provider, "key", nativeKey);
				// The twin stands. A scan that was cut short recorded no name,
				// so the next complete one is the first sighting.
				if (cutShort) assert.equal(provider.read(), null, "a scan that was cut short is no sighting");
				const held = readVerified(provider);
				assert.equal(held.byKey.get(savedKey), undefined, "a row counts toward its name whatever its number is worth");
				assert.deepEqual(labels(held), ["Other"]);
				assert.equal(held.blockedReadingCount, numericState === "contradictory" ? 1 : 2);
				assert.equal(held.contradictoryReadingCount, numericState === "contradictory" ? 1 : undefined, "a contradictory twin is counted as contradictory, and still shares the name");
				const link = [{ sharedMemory: "f0001234:0:1000001", gadget: savedKey, unit: "°C", sensorType: 1 }];
				assert.equal(applyReadingLinks(held, link, 1).byKey.get("f0001234:0:1000001"), undefined, "a withheld name cannot be linked");
				dropValue("Sensor0");
				putValue("Value1", "80 °C");
				putValue("ValueRaw1", "80");
				const releasing = readVerified(provider);
				assert.equal(releasing.byKey.get(savedKey), undefined, "one scan showing the name once is not enough");
				assert.equal(releasing.blockedReadingCount, 1);
				const released = readVerified(provider);
				assert.equal(released.byKey.get(savedKey)?.value, 80, "two clean scans: the name means the reading that is left");
				assert.equal(released.blockedReadingCount, 0);
				assert.equal(released.freshnessRevision, before.freshnessRevision, "a name changing hands is not a measured change");
				assert.equal(applyReadingLinks(released, link, 1).byKey.get("f0001234:0:1000001")?.value, 80);
			} finally { provider.close(); }
			assert.equal(readShape().byKey.get(savedKey)?.value, 80, "a fresh provider remembers nothing");
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
		test(`a scan rejected by a later ${failure} commits no values, and is a sighting only if it ran to the end`, () => {
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
				// The pair stands. A scan cut short by an interleave or an error
				// saw only a prefix of the rows and recorded no name, so the next
				// complete scan is the first sighting. A scan that ran to the end
				// and was skipped for the contradiction did see every name: both
				// records advanced together, and the next scan confirms both.
				if (failure !== "numeric contradiction") assert.equal(provider.read(), null, "a scan that was cut short is no sighting");
				const held = readVerified(provider);
				assert.equal(held.byKey.get(savedKey), undefined, "neither 45 nor 80: the name is on two rows");
				assert.equal(held.blockedReadingCount, 2);
				assert.equal(held.contradictoryReadingCount, failure === "numeric contradiction" ? 1 : undefined);
				const link = [{ sharedMemory: "f0001234:0:1000001", gadget: savedKey, unit: "°C", sensorType: 1 }];
				assert.equal(applyReadingLinks(held, link, 1).byKey.get("f0001234:0:1000001"), undefined, "an explicit link cannot reach a withheld name");
				dropValue("Sensor0");
				putValue("Value8", "10 °C");
				const releasing = readVerified(provider);
				assert.equal(releasing.byKey.get(savedKey), undefined, "one scan showing the name once is not enough");
				assert.equal(releasing.blockedReadingCount, 1);
				const released = readVerified(provider);
				assert.equal(released.byKey.get(savedKey)?.value, 80, "two clean scans: the name means the reading that is left");
				assert.equal(released.blockedReadingCount, 0);
				assert.equal(released.freshnessRevision, before.freshnessRevision, "a name changing hands is not a measured change");
				assert.equal(applyReadingLinks(released, link, 1).byKey.get("f0001234:0:1000001")?.value, 80);
			} finally { provider.close(); }
			assert.equal(readShape().byKey.get(savedKey)?.value, 80, "a reopened provider remembers nothing");
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

	test("a separate process publishes the reading a disappeared duplicate left behind", () => {
		shape([0, 1], (i) => ({ sensor: "Restart GPU", label: "Temperature", raw: i ? "80" : "40", value: `${i ? 80 : 40} °C` }));
		assert.deepEqual(readShape().readings, [], "while both are ticked neither publishes");
		dropValue("Sensor0");
		assert.deepEqual(readInChildProcess().map((reading) => [reading.key, reading.value]), [["g:Restart GPU:Temperature", 80]], "nothing about the pair was left anywhere another process could read");
	});

	test("duplicate values cannot manufacture producer evidence on an unchanged scan", () => {
		shape([0, 8], (i) => ({ sensor: "Frozen duplicate", label: "Temp", raw: i ? "80" : "40", value: `${i ? 80 : 40} °C` }));
		const provider = GadgetRegistryProvider.open();
		try {
			for (let i = 0; i < 4; i++) assert.equal(readVerified(provider).freshnessRevision, 0);
		} finally { provider.close(); }
	});

});

describe("integrity: a doubled Gadget name is withheld only while it stands", { skip: !onWindows ? "win32-x64 only" : false }, () => {
	// Measured on HWiNFO 8.48: after any tick or untick it renumbers the rows
	// densely and rewrites them one whole slot at a time, ascending, so a scan
	// between two writes sees a frontier. An untick shows one reading in two
	// adjacent slots, a tick shows one in none. HWiNFO also reports some
	// readings twice under one source name and label out of the box (a GPU fan
	// once in RPM and once in percent), and a shift-click range ticks both.
	const GPU = "GPU [#0]: Example GPU";
	const fanRpm: Row = { sensor: GPU, label: "GPU Fan1", value: "1800 RPM", raw: "1800" };
	const fanPct: Row = { sensor: GPU, label: "GPU Fan1", value: "35 %", raw: "35" };
	const shared = gadgetReadingKey(GPU, "GPU Fan1");
	const sharedLegacy = legacyGadgetKey(GPU, "GPU Fan1") as string;

	test("an untick rewritten slot by slot skips the torn scans and loses no name", () => {
		const rows = probes("CPU [#0]: Removal tear", 12);
		shapeRows(rows);
		const provider = GadgetRegistryProvider.open();
		try {
			assert.equal(readVerified(provider).readings.length, 12);
			const torn = untick(provider, rows, 3);
			const left = rows.filter((_, i) => i !== 3);
			for (const scan of ["first", "second"]) {
				const settled = readVerified(provider);
				assert.deepEqual(labels(settled), left.map((row) => row.label), `the ${scan} scan after the rewrite publishes every remaining name`);
				assert.equal(settled.blockedReadingCount, 0, `the ${scan} scan after the rewrite withholds nothing`);
				for (const row of left) assert.equal(settled.byKey.get(gadgetReadingKey(row.sensor, row.label))?.value, Number(row.raw), "every name kept its own value");
			}
			assert.deepEqual(torn.map((snap) => (snap === null ? "skipped" : `published ${snap.readings.length}`)), torn.map(() => "skipped"), "every frontier position shows a name twice for the first time, so every torn scan is skipped");
		} finally { provider.close(); }
	});

	test("a tick rewritten slot by slot hides one reading per scan and loses no name", () => {
		const rows = probes("CPU [#0]: Insert tear", 12);
		const before = rows.filter((_, i) => i !== 3);
		shapeRows(before);
		const provider = GadgetRegistryProvider.open();
		try {
			// The reverse edit: Probe 3 is ticked again.
			const torn = tick(provider, before, 3, rows[3] as Row);
			for (const [step, snap] of torn.entries()) {
				if (snap !== null) assert.equal(snap.blockedReadingCount, 0, `step ${step}: a reading in no slot is no reason to withhold another`);
			}
			for (const scan of ["first", "second"]) {
				const settled = readVerified(provider);
				assert.deepEqual(labels(settled), rows.map((row) => row.label), `the ${scan} scan after the rewrite publishes every name`);
				assert.equal(settled.blockedReadingCount, 0);
			}
		} finally { provider.close(); }
	});

	test("nothing about a torn rewrite is remembered by a fresh provider or another process", () => {
		const rows = probes("CPU [#0]: Forgotten tear", 8);
		shapeRows(rows);
		const provider = GadgetRegistryProvider.open();
		try { untick(provider, rows, 2); } finally { provider.close(); }
		const left = rows.filter((_, i) => i !== 2).map((row) => row.label);
		const fresh = readShape();
		assert.deepEqual(labels(fresh), left);
		assert.equal(fresh.blockedReadingCount, 0);
		assert.deepEqual(readInChildProcess().map((reading) => reading.label), left, "a separate process starts from the registry alone");
	});

	test("a standing pair skips one scan, then only its two rows are withheld", () => {
		const healthy = probes("CPU [#0]: Standing pair", 3);
		shapeRows([healthy[0] as Row, fanRpm, healthy[1] as Row, healthy[2] as Row]);
		const provider = GadgetRegistryProvider.open();
		try {
			assert.equal(readVerified(provider).byKey.get(shared)?.value, 1800, "one ticked GPU Fan1 is an ordinary reading");
			putSlot(4, fanPct);
			assert.equal(provider.read(), null, "a first sighting cannot be told from a torn read: the scan is skipped and the keys hold their values");
			for (let scan = 2; scan <= 4; scan++) {
				const standing = readVerified(provider);
				assert.deepEqual(labels(standing), ["Probe 0", "Probe 1", "Probe 2"], `scan ${scan}: the healthy rows serve`);
				assert.equal(standing.blockedReadingCount, 2, `scan ${scan}`);
				assert.equal(standing.byKey.get(shared), undefined, "neither twin is guessed at");
				assert.equal(standing.byKey.get(sharedLegacy), undefined, "nor under the 1.6 spelling");
			}
		} finally { provider.close(); }
		// A cold start over the same pair: open()'s second read confirms it.
		const cold = readShape();
		assert.deepEqual(labels(cold), ["Probe 0", "Probe 1", "Probe 2"]);
		assert.equal(cold.blockedReadingCount, 2);
	});

	test("unticking one twin brings the other back on the second clean scan, under both spellings", () => {
		const healthy = probes("CPU [#0]: Untick a twin", 2);
		shapeRows([healthy[0] as Row, fanRpm, healthy[1] as Row, fanPct]);
		const provider = GadgetRegistryProvider.open();
		try {
			assert.equal(readVerified(provider).blockedReadingCount, 2);
			dropSlot(3);
			const first = readVerified(provider);
			assert.equal(first.byKey.get(shared), undefined, "one scan showing the name once is not enough: a tick in progress hides a twin for exactly one scan");
			assert.equal(first.byKey.get(sharedLegacy), undefined);
			assert.equal(first.blockedReadingCount, 1);
			const second = readVerified(provider);
			assert.equal(second.byKey.get(shared)?.value, 1800);
			assert.equal(second.byKey.get(shared)?.unit, "RPM");
			assert.equal(second.byKey.get(sharedLegacy)?.value, 1800, "the 1.6 spelling follows");
			assert.equal(second.byKey.get(sharedLegacy)?.aliasOf, shared);
			assert.equal(second.blockedReadingCount, 0);
		} finally { provider.close(); }
	});

	test("relabelling one twin brings both back after two clean scans", () => {
		const healthy = probes("CPU [#0]: Relabel a twin", 2);
		shapeRows([healthy[0] as Row, fanRpm, healthy[1] as Row, fanPct]);
		const provider = GadgetRegistryProvider.open();
		try {
			assert.equal(readVerified(provider).blockedReadingCount, 2);
			putValue("Label3", "GPU Fan1 percent");
			const renamed = gadgetReadingKey(GPU, "GPU Fan1 percent");
			const first = readVerified(provider);
			assert.equal(first.byKey.get(renamed)?.value, 35, "the new name was never shared, so it publishes at once");
			assert.equal(first.byKey.get(shared), undefined);
			assert.equal(first.blockedReadingCount, 1);
			const second = readVerified(provider);
			assert.equal(second.byKey.get(shared)?.value, 1800);
			assert.equal(second.byKey.get(renamed)?.value, 35);
			assert.equal(second.blockedReadingCount, 0);
		} finally { provider.close(); }
	});

	test("while both twins stay ticked, no torn scan of an unrelated tick hands either one the name", () => {
		const base = probes("CPU [#0]: Pair under a tear", 10);
		const rows = [...base.slice(0, 2), fanRpm, ...base.slice(2, 7), fanPct, ...base.slice(7)];
		shapeRows(rows);
		const provider = GadgetRegistryProvider.open();
		try {
			assert.equal(readVerified(provider).blockedReadingCount, 2);
			// The rewrite passes each twin in turn: for one scan that twin is in
			// no slot and the other looks unique.
			const torn = tick(provider, rows, 1, { sensor: GPU, label: "Newly ticked", value: "1.100 V", raw: "1.100" });
			for (const [step, snap] of torn.entries()) {
				assert.ok(snap, `step ${step}: a held name seen on two rows again is no first sighting, so nothing is skipped`);
				assert.equal(snap.byKey.get(shared), undefined, `step ${step}: a twin took the shared name`);
				assert.equal(snap.byKey.get(sharedLegacy), undefined, `step ${step}: a twin took the 1.6 spelling`);
			}
			const settled = readVerified(provider);
			assert.equal(settled.readings.length, 11);
			assert.equal(settled.blockedReadingCount, 2);
		} finally { provider.close(); }
	});

	test("a frozen block HWiNFO left behind withholds only the name it shares, and the name returns once the block is gone", () => {
		const source = "CPU [#0]: Stale twin";
		const live = probes(source, 6);
		// Shrinking a selection by some 440 rows in one OK leaves the old top
		// block behind, frozen, until HWiNFO exits.
		const frozen: Row[] = [{ sensor: source, label: "Left behind 0", value: "1.0 °C", raw: "1.0" }, { ...(live[2] as Row), value: "2.0 °C", raw: "2.0" }, { sensor: source, label: "Left behind 2", value: "3.0 °C", raw: "3.0" }];
		shape([...live.keys(), 440, 441, 442], (i) => (i < 440 ? live[i] : frozen[i - 440]) as Row);
		const provider = GadgetRegistryProvider.open();
		try {
			const standing = readVerified(provider);
			assert.deepEqual(labels(standing), ["Probe 0", "Probe 1", "Probe 3", "Probe 4", "Probe 5", "Left behind 0", "Left behind 2"], "the live row and its frozen twin are withheld; every other row serves");
			assert.equal(standing.blockedReadingCount, 2);
			for (const slot of [440, 441, 442]) dropSlot(slot);
			const first = readVerified(provider);
			assert.equal(first.byKey.get(gadgetReadingKey(source, "Probe 2")), undefined);
			assert.equal(first.blockedReadingCount, 1);
			const second = readVerified(provider);
			assert.deepEqual(labels(second), live.map((row) => row.label));
			assert.equal(second.byKey.get(gadgetReadingKey(source, "Probe 2"))?.value, 42, "the live reading, with no user action");
			assert.equal(second.blockedReadingCount, 0);
		} finally { provider.close(); }
	});

	test("the log names a doubled name once, on the scan it is first withheld, and again only after it was forgotten", () => {
		const healthy = probes("CPU [#0]: Notice", 1);
		shapeRows([healthy[0] as Row, fanRpm]);
		const first = GadgetRegistryProvider.open();
		let second: Provider | undefined;
		try {
			putSlot(2, fanPct);
			assert.equal(first.read(), null);
			assert.deepEqual(first.notices(), [], "a first sighting may be a torn read: nothing is said yet");
			readVerified(first);
			const lines = first.notices();
			assert.equal(lines.length, 1);
			assert.match(lines[0] ?? "", /slots 1 and 2/);
			assert.match(lines[0] ?? "", /GPU \[#0\]: Example GPU \/ GPU Fan1/);
			assert.match(lines[0] ?? "", /[Uu]ntick or relabel one/);
			readVerified(first);
			assert.deepEqual(first.notices(), [], "said once while the pair stands");
			// One scan showing the name once does not forget it, so the pair
			// showing again is not news.
			dropSlot(2);
			readVerified(first);
			putSlot(2, fanPct);
			readVerified(first);
			assert.deepEqual(first.notices(), []);
			second = GadgetRegistryProvider.open();
			second.adoptFreshness(first);
			assert.deepEqual(second.notices(), [], "the verification read's notice is taken back on adoption");
			readVerified(second);
			assert.deepEqual(second.notices(), []);
			// Two clean scans forget the name; colliding again is news.
			dropSlot(2);
			readVerified(second);
			assert.equal(readVerified(second).byKey.get(shared)?.value, 1800);
			putSlot(2, fanPct);
			assert.equal(second.read(), null);
			readVerified(second);
			assert.equal(second.notices().length, 1);
		} finally {
			first.close();
			second?.close();
		}
	});

	test("three rows under one name are named together, and the remedy is to leave one", () => {
		// A stock pair plus a copy of one of them in a block HWiNFO left behind.
		const healthy = probes("CPU [#0]: Three rows", 1);
		shape([0, 1, 2, 440], (i) => (i === 0 ? healthy[0] : i === 2 ? fanPct : fanRpm) as Row);
		const provider = GadgetRegistryProvider.open();
		try {
			const standing = readVerified(provider);
			assert.deepEqual(labels(standing), ["Probe 0"]);
			assert.equal(standing.blockedReadingCount, 3);
			const lines = provider.notices();
			assert.equal(lines.length, 1);
			assert.match(lines[0] ?? "", /slots 1, 2 and 440 withheld while they report one name/);
			assert.match(lines[0] ?? "", /until one is left/);
		} finally { provider.close(); }
	});

	test("a reopen that adopts the previous provider does not release a held name early, or skip when its twin returns", () => {
		const healthy = probes("CPU [#0]: Refill", 2);
		const full = [healthy[0] as Row, fanRpm, healthy[1] as Row, fanPct];
		shapeRows(full);
		const before = GadgetRegistryProvider.open();
		let reopened: Provider | undefined;
		try {
			assert.equal(readVerified(before).blockedReadingCount, 2);
			before.notices();
			// HWiNFO exits (the key goes with it) and starts again, refilling
			// the key row by row: a scan can land when only one twin is back.
			shapeRows(full.slice(0, 3));
			reopened = GadgetRegistryProvider.open();
			reopened.adoptFreshness(before, false);
			const half = readVerified(reopened);
			assert.equal(half.byKey.get(shared), undefined, "one twin alone on a half-filled key does not take the name");
			assert.equal(half.blockedReadingCount, 1);
			putSlot(3, fanPct);
			const filled = reopened.read();
			assert.ok(filled, "a held name seen on two rows again is no first sighting: no skipped scan");
			assert.equal(filled.byKey.get(shared), undefined);
			assert.equal(filled.blockedReadingCount, 2);
			assert.deepEqual(reopened.notices(), [], "and the pair was already named");
		} finally {
			before.close();
			reopened?.close();
		}
	});

	test("a doubled name writes nothing to disk, and the provider needs no LOCALAPPDATA", () => {
		const healthy = probes("CPU [#0]: No file", 2);
		shapeRows([healthy[0] as Row, fanRpm, healthy[1] as Row, fanPct]);
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwinfo-gadget-nofile-"));
		const saved = { LOCALAPPDATA: process.env.LOCALAPPDATA, TEMP: process.env.TEMP, TMP: process.env.TMP };
		try {
			// Everywhere a provider could think of writing now lands in `dir`.
			process.env.TEMP = dir;
			process.env.TMP = dir;
			for (const localAppData of [dir, undefined]) {
				if (localAppData === undefined) delete process.env.LOCALAPPDATA;
				else process.env.LOCALAPPDATA = localAppData;
				const provider = GadgetRegistryProvider.open();
				try {
					const standing = readVerified(provider);
					assert.deepEqual(labels(standing), ["Probe 0", "Probe 1"]);
					assert.equal(standing.blockedReadingCount, 2);
				} finally { provider.close(); }
				assert.deepEqual(fs.readdirSync(dir), [], localAppData === undefined ? "nothing written with LOCALAPPDATA unset" : "nothing written under LOCALAPPDATA");
			}
		} finally {
			for (const [name, value] of Object.entries(saved)) {
				if (value === undefined) delete process.env[name];
				else process.env[name] = value;
			}
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a standing pair and a standing contradictory row on one key still open, each counted", () => {
		const healthy = probes("CPU [#0]: Combined", 2);
		shapeRows([healthy[0] as Row, healthy[1] as Row, fanRpm, fanPct, { sensor: GPU, label: "Hot Spot", value: "104.0 °F", raw: "40" }]);
		// open() reads twice. Both records must advance on the first read, or
		// the second skips again and the source reads busy forever.
		const provider = GadgetRegistryProvider.open();
		try {
			const snap = readVerified(provider);
			assert.deepEqual(labels(snap), ["Probe 0", "Probe 1"]);
			assert.equal(snap.blockedReadingCount, 2);
			assert.equal(snap.contradictoryReadingCount, 1);
		} finally { provider.close(); }
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

	test("a contradictory legacy-alias owner invalidates detail rendering on arrival and removal", () => {
		shape([0], () => ({ sensor: "A:B", label: "C", value: "40.0 °C", raw: "40" }));
		const provider = GadgetRegistryProvider.open();
		try {
			putValue("Value0", "41.0 °C");
			putValue("ValueRaw0", "41");
			const before = readVerified(provider);
			assert.equal(before.byKey.get("g:A:B:C")?.value, 41);
			assert.equal(before.freshnessRevision, 1, "the baseline has actual producer evidence");
			const signature = (snapshot: SensorSnapshot): string => tickSignature({ state: "ok", snapshot, source: "gadget" });
			putValue("Sensor1", "A");
			putValue("Label1", "B:C");
			putValue("Value1", "99.0 °C");
			putValue("ValueRaw1", "80");
			assert.equal(provider.read(), null, "the first contradiction skips the scan");
			const ambiguous = readVerified(provider);
			assert.equal(ambiguous.byKey.get("g:A:B:C"), undefined);
			assert.equal(ambiguous.readings.length, before.readings.length, "withholding the new row leaves the live count unchanged");
			assert.notEqual(signature(ambiguous), signature(before), "removing an alias must repaint its old numeric detail face");
			assert.equal(ambiguous.freshnessRevision, before.freshnessRevision, "alias topology is not a measurement");
			assert.equal(ambiguous.pollTime, before.pollTime);
			assert.equal(readVerified(provider).valueRevision, ambiguous.valueRevision, "a standing contradiction does not churn renders");
			dropValue("Sensor1");
			const restored = readVerified(provider);
			assert.equal(restored.byKey.get("g:A:B:C")?.value, 41);
			assert.notEqual(signature(restored), signature(ambiguous), "restoring an alias must repaint its missing detail face");
			assert.equal(restored.freshnessRevision, before.freshnessRevision);
			assert.equal(restored.pollTime, before.pollTime);
		} finally {
			provider.close();
		}
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

	test("another reading contradicting in an already reported slot is reported by name", () => {
		shape([0, 1], (i) => (i === 0 ? { sensor: "Alpha Source", label: "Package", value: "55.0 °C", raw: "55" } : { sensor: "Alpha Source", label: "Hot Spot", value: "104.0 °F", raw: "40" }));
		const provider = GadgetRegistryProvider.open();
		try {
			assert.match(provider.notices().join("\n"), /Hot Spot/);
			putValue("Label1", "Rail");
			putValue("Value1", "10 W");
			putValue("ValueRaw1", "99");
			provider.read();
			provider.read();
			const lines = provider.notices();
			assert.equal(lines.length, 1, "slot numbers are reused; the row the panel points at must be the one the log names");
			assert.match(lines[0] ?? "", /Rail/);
			provider.read();
			assert.deepEqual(provider.notices(), [], "and it is said once");
		} finally {
			provider.close();
		}
	});

	test("an old baseline is not adopted, but what was reported stays reported", () => {
		shape([0, 1], (i) => (i === 0 ? { sensor: "Alpha Source", label: "Package", value: "55.0 °C", raw: "55" } : { sensor: "Alpha Source", label: "Hot Spot", value: "104.0 °F", raw: "40" }));
		const first = GadgetRegistryProvider.open();
		let second: ReturnType<typeof GadgetRegistryProvider.open> | undefined;
		try {
			first.notices();
			putValue("Value0", "56.0 °C");
			putValue("ValueRaw0", "56");
			assert.ok(readVerified(first).pollTime > 0, "precondition: the first session observed a change");
			second = GadgetRegistryProvider.open();
			second.adoptFreshness(first, false);
			assert.deepEqual(second.notices(), []);
			assert.equal(readVerified(second).pollTime, 0, "values held from a long absence are no baseline: Age unknown until a change is seen");
		} finally {
			first.close();
			second?.close();
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

describe("integrity: one reading link resolves on both providers", { skip: !onWindows ? "win32-x64 only" : false }, () => {
	test("a percent reading HWiNFO types as Other and a boolean across its flip", () => {
		const load = { sharedMemory: "f0000301:0:8000005", unit: "%", sensorType: 8 };
		const flag = { sharedMemory: "f0000401:0:8000009", unit: "Yes/No", sensorType: 8 };
		shape([0, 1], (i) => (i === 0 ? { sensor: "System", label: "Physical Memory Load", value: "43.5 %", raw: "43.5" } : { sensor: "CPU", label: "Thermal Throttling", value: "No", raw: "0" }));
		const provider = GadgetRegistryProvider.open();
		try {
			const before = readVerified(provider);
			const [loadKey, flagKey] = before.readings.map((reading) => reading.key) as [string, string];
			const links = [{ ...load, gadget: loadKey }, { ...flag, gadget: flagKey }];
			const onGadget = applyReadingLinks(before, links, 1);
			assert.equal(onGadget.byKey.get(load.sharedMemory)?.value, 43.5, "Gadget guesses Usage from the percent sign; the pair is still the pair");
			assert.equal(onGadget.byKey.get(flag.sharedMemory)?.value, 0);
			putValue("Value1", "Yes");
			putValue("ValueRaw1", "1");
			const flipped = applyReadingLinks(readVerified(provider), links, 1);
			assert.equal(flipped.byKey.get(flag.sharedMemory)?.value, 1, "the unit is the same unit on both sides of the flip");
			assert.equal(flipped.byKey.get(flag.sharedMemory)?.unit, "Yes/No");
			// The same rows on shared memory, where the type is HWiNFO's own.
			const reading = (key: string, unit: string, value: number): Reading => ({ key, type: 8, sensorIndex: 0, id: 1, label: "fixture", unit, value, valueMin: value, valueMax: value, valueAvg: value });
			const rows = [reading(load.sharedMemory, "%", 43.5), reading(flag.sharedMemory, "Yes/No", 1)];
			const sharedMemory: SensorSnapshot = { ...before, readings: rows, byKey: new Map(rows.map((row) => [row.key, row])) };
			const onSharedMemory = applyReadingLinks(sharedMemory, links, 1);
			assert.equal(onSharedMemory.byKey.get(loadKey)?.value, 43.5);
			assert.equal(onSharedMemory.byKey.get(flagKey)?.value, 1);
			const wrongType = applyReadingLinks(sharedMemory, [{ ...links[0]!, sensorType: 7 }], 1);
			assert.equal(wrongType.byKey.has(loadKey), false, "the shared-memory endpoint is still held to the type HWiNFO reports");
		} finally {
			provider.close();
		}
	});
});

describe("integrity: malformed raw tokens through the native registry boundary", { skip: !onWindows ? "win32-x64 only" : false }, () => {
	test("malformed raw values earn no freshness or linked session samples and recover without continuity", () => {
		const source = "CPU [#0]: Raw integrity";
		const key = gadgetReadingKey(source, "Temperature");
		const shared = "f0001234:0:1000001";
		const links = [{ sharedMemory: shared, gadget: key, unit: "°C", sensorType: 1 }];
		shape([0, 900], (i) => i === 0 ? { sensor: source, label: "Temperature", value: "40 °C", raw: "40" } : { sensor: "Board", label: "Power", value: "50 W", raw: "50" });
		const provider = GadgetRegistryProvider.open();
		const stats = new SessionStatsStore();
		const observe = (): SensorSnapshot => {
			const snapshot = applyReadingLinks(readVerified(provider), links, 1);
			const reading = snapshot.byKey.get(shared);
			assert.ok(reading);
			stats.observe(reading, snapshot, "gadget");
			return snapshot;
		};
		try {
			assert.equal(observe().freshnessRevision, 0);
			assert.equal(stats.get(shared)?.count, 1);
			// REG_SZ written through reg.exe, read through production hwsm.node.
			// Embedded NUL is intentionally helper-only: Win32 truncates it.
			putValue("Value0", "41 °C");
			for (const raw of ["41junk", "41 °C", "41e+", "41,0.2"]) {
				putValue("ValueRaw0", raw);
				const bad = observe();
				assert.equal(Number.isFinite(bad.byKey.get(shared)?.value), false, raw);
				assert.equal(bad.byKey.get(shared)?.aliasOf, key);
				assert.equal(bad.byKey.get(legacyGadgetKey(source, "Temperature") as string)?.aliasOf, key);
				assert.equal(bad.freshnessRevision, 0, "malformed data is not producer evidence");
				assert.equal(bad.pollTime, 0);
				assert.equal(stats.get(shared), undefined, "the affected segment ends");
				assert.equal(bad.byKey.get("g:Board:Power")?.value, 50, "healthy neighbors keep serving");
			}
			putValue("Value0", "42 °C");
			putValue("ValueRaw0", "42");
			assert.equal(observe().freshnessRevision, 0, "first finite recovery is a baseline");
			assert.deepEqual(stats.get(shared), { min: 42, max: 42, sum: 42, count: 1 });
			putValue("Value0", "43 °C");
			putValue("ValueRaw0", "43");
			assert.equal(observe().freshnessRevision, 1);
			assert.deepEqual(stats.get(shared), { min: 42, max: 43, sum: 85, count: 2 });
		} finally { provider.close(); }
	});

	test("the production poller clears linked history on malformed raw and retains healthy history", () => {
		type Subject = Pick<typeof poller, "setSourceMode" | "setReadingLinks" | "retain" | "release" | "getStatus" | "subscribeSeries" | "getSeries"> & { tick(): void };
		const subject = new (poller.constructor as unknown as { new (): Subject })();
		const shared = "f0001234:0:1000001";
		shape([0, 900], (i) => i === 0 ? { sensor: "Raw poller", label: "Temperature", value: "39 °C", raw: "39" } : { sensor: "Board", label: "Power", value: "50 W", raw: "50" });
		subject.setSourceMode("gadget");
		subject.setReadingLinks([{ sharedMemory: shared, gadget: "g:Raw poller:Temperature", unit: "°C", sensorType: 1 }]);
		subject.subscribeSeries(shared);
		subject.subscribeSeries("g:Board:Power");
		subject.retain();
		const snapshot = (): SensorSnapshot => {
			const state = subject.getStatus();
			assert.equal(state.state, "ok");
			assert.notEqual(state.state, "unavailable");
			return state.snapshot;
		};
		try {
			putValue("Value0", "40 °C");
			putValue("ValueRaw0", "40");
			subject.tick();
			assert.equal(snapshot().freshnessRevision, 1);
			assert.deepEqual(subject.getSeries(shared), [40]);
			putValue("Value0", "41 °C");
			putValue("ValueRaw0", "41junk");
			subject.tick();
			assert.equal(Number.isFinite(snapshot().byKey.get(shared)?.value), false);
			assert.equal(snapshot().freshnessRevision, 1);
			assert.deepEqual(subject.getSeries(shared), []);
			assert.ok((subject.getSeries("g:Board:Power")?.length ?? 0) > 0);
			putValue("Value0", "42 °C");
			putValue("ValueRaw0", "42");
			subject.tick();
			assert.deepEqual(subject.getSeries(shared), [], "a recovery baseline alone does not earn a history point");
			assert.equal(snapshot().freshnessRevision, 1);
			putValue("Value0", "43 °C");
			putValue("ValueRaw0", "43");
			subject.tick();
			assert.deepEqual(subject.getSeries(shared), [43]);
			assert.equal(snapshot().freshnessRevision, 2);
		} finally { subject.release(); }
	});
});

describe("integrity: a page change keeps the Gadget baseline", { skip: !onWindows ? "win32-x64 only" : false }, () => {
	test("values stay on the keys across the last release and the next retain", () => {
		type Subject = { setSourceMode(mode: "gadget"): void; retain(): void; release(): void; tick(): void; getStatus(): { state: string } };
		const subject = new (poller.constructor as unknown as { new (): Subject })();
		shape([0], () => ({ sensor: "Alpha Source", label: "Package", value: "55.0 °C", raw: "55" }));
		subject.setSourceMode("gadget");
		subject.retain();
		try {
			assert.equal(subject.getStatus().state, "stale", "a first read is a baseline: Age unknown");
			putValue("Value0", "56.0 °C");
			putValue("ValueRaw0", "56");
			subject.tick();
			assert.equal(subject.getStatus().state, "ok", "precondition: a change was observed");
			// On a single deck every page change, drill-down entry and Back
			// releases the last action before the next page's first retain.
			subject.release();
			subject.retain();
			assert.equal(subject.getStatus().state, "ok", "the page being entered shows values, not Age unknown");
		} finally {
			subject.release();
		}
	});
});

describe("integrity: a key emptied under a live session is an empty key", { skip: !onWindows ? "win32-x64 only" : false }, () => {
	const cpuPackage: Row = { sensor: "Alpha Source", label: "Package", value: "55.0 °C", raw: "55" };

	test("a complete scan that finds no rows at all reports gadget-empty, as the open does", () => {
		shape([0, 1, 2]);
		const provider = GadgetRegistryProvider.open();
		try {
			assert.equal(readVerified(provider).readings.length, 3);
			// Every value goes; the key itself stays.
			for (const slot of [0, 1, 2]) dropSlot(slot);
			assert.equal(reasonOf(() => provider.read()), "gadget-empty");
			assert.equal(reasonOf(() => provider.read()), "gadget-empty", "and on every scan while it stays empty");
			assert.equal(reasonOf(() => GadgetRegistryProvider.open()), "gadget-empty", "the same verdict a cold open reaches");
		} finally { provider.close(); }
	});

	test("a skipped scan, and a scan whose every row is withheld, is not an empty key", () => {
		const twin: Row = { sensor: "GPU [#0]: Example GPU", label: "GPU Fan1", value: "1800 RPM", raw: "1800" };
		// A standing pair alone: the first sighting is skipped, then both rows are withheld.
		shapeRows([cpuPackage, twin]);
		let provider = GadgetRegistryProvider.open();
		try {
			putSlot(2, { ...twin, value: "35 %", raw: "35" });
			dropSlot(0);
			assert.equal(provider.read(), null, "a first sighting is skipped, and a skipped scan says nothing about the key");
			const standing = readVerified(provider);
			assert.equal(standing.readings.length, 0);
			assert.equal(standing.blockedReadingCount, 2);
		} finally { provider.close(); }
		// A contradictory row alone: one scan of grace, then withheld.
		shapeRows([cpuPackage]);
		provider = GadgetRegistryProvider.open();
		try {
			putValue("Value0", "131.0 °F");
			assert.equal(provider.read(), null, "the contradiction grace is a skipped scan");
			const withheld = readVerified(provider);
			assert.equal(withheld.readings.length, 0);
			assert.equal(withheld.contradictoryReadingCount, 1);
		} finally { provider.close(); }
		// A row with no label alone.
		shapeRows([cpuPackage]);
		provider = GadgetRegistryProvider.open();
		try {
			dropValue("Label0");
			const incomplete = readVerified(provider);
			assert.equal(incomplete.readings.length, 0);
			assert.equal(incomplete.blockedReadingCount, 1);
		} finally { provider.close(); }
		// The only row removed between the two observations of it.
		shapeRows([cpuPackage]);
		provider = GadgetRegistryProvider.open();
		const nativeKey = Reflect.get(provider, "key") as HwsmGadgetKey;
		let removed = false;
		Reflect.set(provider, "key", {
			queryString(name: string): string | null {
				const value = nativeKey.queryString(name);
				if (!removed && name === "Sensor0") {
					removed = true;
					dropSlot(0);
				}
				return value;
			},
			close: () => nativeKey.close()
		});
		try {
			assert.equal(provider.read(), null, "an interleave is a skipped scan, not an empty one");
			assert.ok(removed);
		} finally { provider.close(); }
	});

	for (const mode of ["gadget", "auto"] as const) {
		test(`${mode} mode: the poller reaches Tick sensors on its own, says so once, and recovers when a reading is ticked again`, () => {
			type Subject = { setSourceMode(mode: "gadget" | "auto"): void; retain(): void; release(): void; tick(): void; getStatus(): PollerStatus };
			const subject = new (poller.constructor as unknown as { new (): Subject })();
			const warnings: string[] = [];
			Reflect.set(subject, "logger", { info() {}, warn: (line: string) => warnings.push(line), error() {} });
			// Auto falls back to Gadget only while Shared Memory is not running.
			const seam = mock.method(SharedMemoryProvider, "open", () => { throw new HwinfoError("not-running", "canned: shared memory absent"); });
			shapeRows([cpuPackage]);
			subject.setSourceMode(mode);
			subject.retain();
			try {
				putValue("Value0", "56.0 °C");
				putValue("ValueRaw0", "56");
				subject.tick();
				assert.equal(subject.getStatus().state, "ok", "precondition: a live Gadget session");
				// Every value goes; the key itself stays.
				dropSlot(0);
				subject.tick();
				const emptied = subject.getStatus();
				assert.equal(emptied.state, "unavailable");
				assert.equal(emptied.state === "unavailable" ? emptied.reason : "", "gadget-empty");
				assert.deepEqual(statusScreen(emptied)?.lines, ["Tick sensors", "in Gadget"]);
				assert.deepEqual(statusDialText(emptied), { title: "Gadget empty", value: "tick sensors" });
				assert.match(statusSentence(emptied), /present but has no readable sensor rows/);
				for (let i = 0; i < 3; i++) subject.tick();
				assert.deepEqual(subject.getStatus(), emptied, "the screen stands while the key stays empty");
				assert.deepEqual(warnings.map((line) => /\[([a-z-]+)\]/.exec(line)?.[1]), ["gadget-empty"], "logged once");
				// A reading is ticked again: no page change, no restart.
				putSlot(0, { ...cpuPackage, value: "57.0 °C", raw: "57" });
				subject.tick();
				const back = subject.getStatus();
				assert.notEqual(back.state, "unavailable");
				assert.equal(back.state === "unavailable" ? undefined : back.snapshot.byKey.get(gadgetReadingKey(cpuPackage.sensor, cpuPackage.label))?.value, 57);
				assert.equal(warnings.length, 1);
			} finally {
				subject.release();
				seam.mock.restore();
			}
		});
	}
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

	test("the raw field HWiNFO really writes is the word, and it carries the same value", () => {
		// Captured from HWiNFO 8.48 on a live key: Value "No", ValueRaw "No".
		// Shared Memory reports the same reading as 0 or 1 in "Yes/No".
		const flag = { sharedMemory: "f0000401:0:8000009", unit: "Yes/No", sensorType: 8 };
		shape([0], () => ({ sensor: "CPU [#0]: Example", label: "Thermal Throttling (HTC)", value: "No", raw: "No" }));
		const provider = GadgetRegistryProvider.open();
		try {
			const first = readVerified(provider);
			assert.equal(first.readings[0]?.value, 0, "No reads as 0, not as an unavailable value");
			assert.equal(first.readings[0]?.unit, "Yes/No");
			const links = [{ ...flag, gadget: first.readings[0]?.key as string }];
			assert.equal(applyReadingLinks(first, links, 1).byKey.get(flag.sharedMemory)?.value, 0);
			putValue("Value0", "Yes");
			putValue("ValueRaw0", "Yes");
			const second = readVerified(provider);
			assert.equal(second.readings[0]?.value, 1);
			assert.equal(second.freshnessRevision, 1, "the flip is value evidence on the real shape too");
			assert.equal(applyReadingLinks(second, links, 1).byKey.get(flag.sharedMemory)?.value, 1);
		} finally {
			provider.close();
		}
	});
});
