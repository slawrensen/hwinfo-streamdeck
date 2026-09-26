/**
 * Shared-memory decoder tests against synthetic buffers — no FFI, no HWiNFO.
 * Covers both real-world layouts (classic 264/316 and the HWiNFO ≥7.x UTF-8
 * 392/460 strides), label/unit selection rules, ambiguous identity rejection, the
 * SnapshotParser fast path vs rebuild invalidation, and malformed-input
 * rejection.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ENTRY, ENTRY_CLASSIC_SIZE, ENTRY_UTF8_SIZE, HEADER, HEADER_SIZE, MAGIC_ACTIVE, SENSOR, SENSOR_CLASSIC_SIZE, SENSOR_UTF8_SIZE } from "../src/hwinfo/layout";
import { parseSnapshot, SnapshotParser } from "../src/hwinfo/reader";
import { HwinfoError, SensorType } from "../src/hwinfo/types";

interface FakeSensor {
	id: number;
	instance: number;
	orig: string;
	user?: string;
	utf8?: string;
}

interface FakeEntry {
	type: number;
	sensorIndex: number;
	id: number;
	orig: string;
	user?: string;
	utf8?: string;
	unit: string;
	unitUtf8?: string;
	value: number;
	min?: number;
	max?: number;
	avg?: number;
}

interface ComposeOptions {
	utf8?: boolean;
	revision?: number;
	pollTime?: number;
}

/** Builds a complete synthetic mapping in either stride layout. */
function compose(sensors: FakeSensor[], entries: FakeEntry[], opts: ComposeOptions = {}): Buffer {
	const utf8 = opts.utf8 === true;
	const sensorSize = utf8 ? SENSOR_UTF8_SIZE : SENSOR_CLASSIC_SIZE;
	const entrySize = utf8 ? ENTRY_UTF8_SIZE : ENTRY_CLASSIC_SIZE;
	const sensorOff = HEADER_SIZE;
	const entryOff = sensorOff + sensors.length * sensorSize;
	const buf = Buffer.alloc(entryOff + entries.length * entrySize);

	buf.writeUInt32LE(MAGIC_ACTIVE, HEADER.magic);
	buf.writeUInt32LE(1, HEADER.version);
	buf.writeUInt32LE(opts.revision ?? 2, HEADER.revision);
	buf.writeBigInt64LE(BigInt(opts.pollTime ?? 1_751_600_000), HEADER.pollTime);
	buf.writeUInt32LE(sensorOff, HEADER.sensorSectionOffset);
	buf.writeUInt32LE(sensorSize, HEADER.sensorElementSize);
	buf.writeUInt32LE(sensors.length, HEADER.sensorElementCount);
	buf.writeUInt32LE(entryOff, HEADER.entrySectionOffset);
	buf.writeUInt32LE(entrySize, HEADER.entryElementSize);
	buf.writeUInt32LE(entries.length, HEADER.entryElementCount);

	const cstr = (text: string, offset: number, width: number, enc: "latin1" | "utf8"): void => {
		buf.fill(0, offset, offset + width);
		buf.write(text, offset, width - 1, enc);
	};

	sensors.forEach((s, i) => {
		const o = sensorOff + i * sensorSize;
		buf.writeUInt32LE(s.id, o + SENSOR.id);
		buf.writeUInt32LE(s.instance, o + SENSOR.instance);
		cstr(s.orig, o + SENSOR.labelOrig, 128, "latin1");
		cstr(s.user ?? s.orig, o + SENSOR.labelUser, 128, "latin1");
		if (utf8) {
			cstr(s.utf8 ?? "", o + SENSOR.labelUtf8, 128, "utf8");
		}
	});

	entries.forEach((e, i) => {
		const o = entryOff + i * entrySize;
		buf.writeUInt32LE(e.type, o + ENTRY.type);
		buf.writeUInt32LE(e.sensorIndex, o + ENTRY.sensorIndex);
		buf.writeUInt32LE(e.id, o + ENTRY.id);
		cstr(e.orig, o + ENTRY.labelOrig, 128, "latin1");
		cstr(e.user ?? e.orig, o + ENTRY.labelUser, 128, "latin1");
		cstr(e.unit, o + ENTRY.unit, 16, "latin1");
		buf.writeDoubleLE(e.value, o + ENTRY.value);
		buf.writeDoubleLE(e.min ?? e.value, o + ENTRY.valueMin);
		buf.writeDoubleLE(e.max ?? e.value, o + ENTRY.valueMax);
		buf.writeDoubleLE(e.avg ?? e.value, o + ENTRY.valueAvg);
		if (utf8) {
			cstr(e.utf8 ?? "", o + ENTRY.labelUtf8, 128, "utf8");
			cstr(e.unitUtf8 ?? "", o + ENTRY.unitUtf8, 16, "utf8");
		}
	});
	return buf;
}

const CPU: FakeSensor = { id: 0xf0000501, instance: 0, orig: "CPU [#0]: Ryzen" };

describe("producer evidence is distinct from topology revisions", () => {
	const entry: FakeEntry = { type: SensorType.Temperature, sensorIndex: 0, id: 1, orig: "Temperature", unit: "°C", value: 40 };
	it("initial decode, owner changes, unit changes and topology rebuilds supply no measurement evidence", () => {
		const parser = new SnapshotParser();
		const first = parser.parse(compose([CPU], [entry], { pollTime: 700 }));
		assert.equal(first.freshnessRevision, 0);
		const initialRevision = first.valueRevision ?? 0;
		for (const [owner, reading, revision] of [[CPU, entry, 3], [{ ...CPU, id: 8 }, entry, 3], [{ ...CPU, id: 8 }, { ...entry, unit: "°F", value: 104 }, 3]] as const) {
			const next = parser.parse(compose([owner], [reading], { pollTime: 700, revision }));
			assert.equal(next.freshnessRevision, 0);
			assert.ok((next.valueRevision ?? 0) > initialRevision, "render invalidation still notices rebuilds");
		}
	});
	it("finite same-unit value changes count through rebuilds while timestamps remain separate evidence", () => {
		const parser = new SnapshotParser();
		parser.parse(compose([CPU], [entry], { pollTime: 700 }));
		assert.equal(parser.parse(compose([CPU], [{ ...entry, value: 41 }], { pollTime: 700 })).freshnessRevision, 1);
		assert.equal(parser.parse(compose([CPU], [{ ...entry, value: 42 }], { pollTime: 700, revision: 3 })).freshnessRevision, 2);
		for (const revision of [3, 4]) {
			const next = parser.parse(compose([CPU], [{ ...entry, value: 42 }], { pollTime: 700 + revision, revision }));
			assert.equal(next.pollTime, 700 + revision);
			assert.equal(next.freshnessRevision, 2, "a stamp-only fast path or rebuild carries no numeric-change evidence");
		}
		assert.equal(parser.parse(compose([CPU], [{ ...entry, value: 43 }], { pollTime: 705, revision: 4 })).freshnessRevision, 3, "a value change still counts when the stamp also advances");
	});
	it("a later entry rewrite cannot consume an earlier value change before rebuild", () => {
		const parser = new SnapshotParser();
		const second = { ...entry, id: 2 };
		parser.parse(compose([CPU], [entry, second], { pollTime: 700 }));
		const next = parser.parse(compose([CPU], [{ ...entry, value: 41 }, { ...second, id: 3 }], { pollTime: 700 }));
		assert.equal(next.freshnessRevision, 1);
	});
});
const TEMP: FakeEntry = { type: SensorType.Temperature, sensorIndex: 0, id: 0x1000000, orig: "Tctl/Tdie", unit: "°C", value: 55.5, min: 40, max: 90, avg: 60 };

describe("parseSnapshot — classic 264/316 layout", () => {
	it("decodes sensors, readings, keys and stats", () => {
		const snap = parseSnapshot(compose([CPU], [TEMP]));
		assert.equal(snap.sensors.length, 1);
		assert.equal(snap.sensors[0]?.name, "CPU [#0]: Ryzen");
		const r = snap.readings[0];
		assert.ok(r);
		assert.equal(r.key, "f0000501:0:1000000");
		assert.equal(r.label, "Tctl/Tdie");
		assert.equal(r.unit, "°C".normalize());
		assert.equal(r.type, SensorType.Temperature);
		assert.deepEqual([r.value, r.valueMin, r.valueMax, r.valueAvg], [55.5, 40, 90, 60]);
		assert.equal(snap.byKey.get(r.key), r);
	});

	it("user rename wins over the original label", () => {
		const snap = parseSnapshot(compose([CPU], [{ ...TEMP, user: "My Temp" }]));
		assert.equal(snap.readings[0]?.label, "My Temp");
	});

	it("withholds every row sharing a stable identity instead of assigning suffixes", () => {
		const snap = parseSnapshot(compose([CPU], [TEMP, { ...TEMP, value: 1 }, { ...TEMP, value: 2 }]));
		assert.deepEqual(snap.readings, []);
		assert.equal(snap.byKey.size, 0);
	});

	it("withholds ownerless rows instead of assigning positional fallback keys", () => {
		const snap = parseSnapshot(compose([CPU], [{ ...TEMP, sensorIndex: 7 }]));
		assert.deepEqual(snap.readings, []);
		assert.equal(snap.byKey.size, 0);
	});

	it("clamps out-of-range sensor types to Other", () => {
		const snap = parseSnapshot(compose([CPU], [{ ...TEMP, type: 99 }]));
		assert.equal(snap.readings[0]?.type, SensorType.Other);
	});
});

describe("parseSnapshot — UTF-8 392/460 layout (HWiNFO ≥ 7.x)", () => {
	it("prefers the UTF-8 label and unit tails", () => {
		const buf = compose([{ ...CPU, utf8: "CPU [#0]: Ryzen™" }], [{ ...TEMP, utf8: "Tctl/Tdie ✓", unitUtf8: "°C" }], { utf8: true });
		const snap = parseSnapshot(buf);
		assert.equal(snap.sensors[0]?.name, "CPU [#0]: Ryzen™");
		assert.equal(snap.readings[0]?.label, "Tctl/Tdie ✓");
		assert.equal(snap.readings[0]?.unit, "°C");
	});

	it("a user rename beats a UTF-8 tail that still holds the original", () => {
		const buf = compose([CPU], [{ ...TEMP, user: "Renamed", utf8: "Tctl/Tdie" }], { utf8: true });
		assert.equal(parseSnapshot(buf).readings[0]?.label, "Renamed");
	});

	it("empty UTF-8 tails fall back to the ANSI fields", () => {
		const buf = compose([CPU], [TEMP], { utf8: true });
		const snap = parseSnapshot(buf);
		assert.equal(snap.readings[0]?.label, "Tctl/Tdie");
		assert.equal(snap.readings[0]?.unit, "°C".normalize());
	});
});

describe("Shared Memory identity fails closed", () => {
	const key = "f0000501:0:1000000";
	const healthy = { ...TEMP, id: TEMP.id + 1, orig: "Healthy", value: 20, min: 10, max: 30, avg: 21 };
	const healthyKey = "f0000501:0:1000001";
	for (const utf8 of [false, true]) {
		const layout = utf8 ? "UTF-8" : "classic";
		it(`${layout}: zero owner, instance and reading IDs are stable identities`, () => {
			const parser = new SnapshotParser();
			const owner = { ...CPU, id: 0, instance: 0 };
			const entry = { ...TEMP, id: 0 };
			const first = parser.parse(compose([owner], [entry], { utf8 }));
			assert.equal(first.byKey.get("0:0:0")?.value, TEMP.value);
			const changed = parser.parse(compose([owner], [{ ...entry, value: 61 }], { utf8 }));
			assert.equal(changed, first);
			assert.equal(changed.byKey.get("0:0:0")?.value, 61);
			assert.equal(changed.freshnessRevision, 1);
		});

		it(`${layout}: labels, types and units cannot disambiguate a duplicate stable tuple`, () => {
			const snap = parseSnapshot(compose([CPU], [TEMP, healthy, { ...TEMP, orig: "Different", type: SensorType.Power, unit: "W", value: 900 }], { utf8 }));
			assert.deepEqual(snap.readings.map((reading) => reading.key), [healthyKey]);
			assert.deepEqual([...snap.byKey.keys()], [healthyKey]);
		});

		it(`${layout}: repeated owner descriptors collide by ID and instance, not source index`, () => {
			const sensors = [CPU, { ...CPU, orig: "Same identity, different name" }, { ...CPU, instance: 1 }];
			const snap = parseSnapshot(compose(sensors, [TEMP, { ...TEMP, sensorIndex: 1, value: 80 }, { ...TEMP, sensorIndex: 2, value: 60 }, healthy], { utf8 }));
			assert.equal(snap.byKey.has(key), false);
			assert.equal(snap.byKey.has(`${key}~1`), false);
			assert.equal(snap.byKey.get("f0000501:1:1000000")?.value, 60);
			assert.equal(snap.byKey.get(healthyKey)?.value, 20);
			assert.equal(snap.readings.length, 2);
		});

		it(`${layout}: cached ambiguous reordering supplies no samples and preserves healthy physical offsets`, () => {
			const parser = new SnapshotParser();
			const alpha = { ...TEMP, orig: "Alpha", value: 40 };
			const beta = { ...TEMP, orig: "Beta", value: 80 };
			const first = parser.parse(compose([CPU], [alpha, healthy, beta], { utf8 }));
			const revision = first.valueRevision;
			const swapped = parser.parse(compose([CPU], [beta, healthy, alpha], { utf8 }));
			assert.equal(swapped, first, "identical identity words still use the cache");
			assert.equal(swapped.byKey.has(key), false);
			assert.equal(swapped.valueRevision, revision, "withheld value changes are not published changes");
			assert.equal(swapped.freshnessRevision, 0);
			const changed = parser.parse(compose([CPU], [beta, { ...healthy, value: 22, min: 9, max: 32, avg: 23 }, alpha], { utf8 }));
			assert.equal(changed, first);
			const reading = changed.byKey.get(healthyKey);
			assert.ok(reading);
			assert.deepEqual([reading.value, reading.valueMin, reading.valueMax, reading.valueAvg], [22, 9, 32, 23]);
			assert.equal(changed.freshnessRevision, 1);
		});

		it(`${layout}: cached collision arrival and removal invalidate all affected saved keys without freshness`, () => {
			const parser = new SnapshotParser();
			const other = { ...TEMP, id: TEMP.id + 2, orig: "Beta", value: 80 };
			const unique = parser.parse(compose([CPU], [TEMP, healthy, other], { utf8 }));
			assert.equal(unique.byKey.get(key)?.value, TEMP.value);
			const ambiguous = parser.parse(compose([CPU], [TEMP, healthy, { ...other, id: TEMP.id }], { utf8 }));
			assert.notEqual(ambiguous, unique);
			assert.equal(ambiguous.byKey.has(key), false);
			assert.deepEqual([...ambiguous.byKey.keys()], [healthyKey]);
			assert.equal(ambiguous.freshnessRevision, 0);
			assert.ok((ambiguous.valueRevision ?? 0) > (unique.valueRevision ?? 0));
			// Repair a previously withheld row under the same header. Every raw
			// entry must still be checked, including rows after the only survivor.
			const repaired = parser.parse(compose([CPU], [{ ...TEMP, value: 45 }, healthy, other], { utf8 }));
			assert.notEqual(repaired, ambiguous);
			assert.equal(repaired.byKey.get(key)?.value, 45);
			assert.equal(repaired.freshnessRevision, 0, "a newly unambiguous baseline is not a same-reading change");
			const changed = parser.parse(compose([CPU], [{ ...TEMP, value: 46 }, healthy, other], { utf8 }));
			assert.equal(changed.freshnessRevision, 1);
		});

		it(`${layout}: disappearing duplicate rows recover only the unsuffixed unique tuple`, () => {
			const parser = new SnapshotParser();
			const first = parser.parse(compose([CPU], [TEMP, { ...TEMP, orig: "Beta", value: 80 }], { utf8 }));
			assert.equal(first.byKey.size, 0);
			const recovered = parser.parse(compose([CPU], [{ ...TEMP, orig: "Beta", value: 80 }], { utf8 }));
			assert.deepEqual([...recovered.byKey.keys()], [key]);
			assert.equal(recovered.byKey.get(key)?.label, "Beta");
			assert.equal(recovered.byKey.get(key)?.value, 80);
			assert.equal(recovered.freshnessRevision, 0);
			const recurring = parser.parse(compose([CPU], [{ ...TEMP, orig: "Beta", value: 80 }, TEMP], { utf8 }));
			assert.equal(recurring.byKey.size, 0);
			assert.equal(recurring.freshnessRevision, 0);
		});

		it(`${layout}: ownerless rows remain withheld on cached ticks and recover through stable ownership`, () => {
			const parser = new SnapshotParser();
			const orphan = { ...TEMP, sensorIndex: 7, value: 900 };
			const first = parser.parse(compose([CPU], [orphan, healthy], { utf8 }));
			assert.deepEqual([...first.byKey.keys()], [healthyKey]);
			const again = parser.parse(compose([CPU], [{ ...orphan, value: 901 }, { ...healthy, value: 22 }], { utf8 }));
			assert.equal(again, first);
			assert.equal(again.byKey.get(healthyKey)?.value, 22);
			const repaired = parser.parse(compose([CPU], [{ ...orphan, sensorIndex: 0 }, { ...healthy, value: 22 }], { utf8 }));
			assert.notEqual(repaired, again);
			assert.equal(repaired.byKey.get(key)?.value, 900);
			assert.equal(repaired.byKey.has("?:7:1000000"), false);
			assert.equal(repaired.freshnessRevision, again.freshnessRevision);
			const lost = parser.parse(compose([], [{ ...TEMP, sensorIndex: 0 }], { utf8 }));
			assert.equal(lost.byKey.size, 0, "an empty owner table has no positional fallback identity");
		});
	}
});

describe("SnapshotParser — incremental fast path", () => {
	it("returns the same snapshot instance with updated doubles", () => {
		const parser = new SnapshotParser();
		const first = parser.parse(compose([CPU], [TEMP]));
		const second = parser.parse(compose([CPU], [{ ...TEMP, value: 77.25 }], { pollTime: 1_751_600_005 }));
		assert.equal(second, first, "fast path must reuse the snapshot instance");
		assert.equal(second.readings[0]?.value, 77.25);
		assert.equal(second.pollTime, 1_751_600_005);
		assert.equal(second.byKey.get("f0000501:0:1000000")?.value, 77.25);
	});

	it("valueRevision moves on a same-second in-place rewrite, holds on identical bytes, and survives a rebuild", () => {
		const parser = new SnapshotParser();
		const first = parser.parse(compose([CPU], [TEMP]));
		const rev = first.valueRevision;
		assert.ok(typeof rev === "number", "the shared-memory provider always stamps a revision");
		// Identical bytes: nothing moved, nothing bumps.
		const idle = parser.parse(compose([CPU], [TEMP]));
		assert.equal(idle, first);
		assert.equal(idle.valueRevision, rev);
		// HWiNFO polling faster than 1 Hz: values rewritten in place while the
		// one-second pollTime stamp cannot move. The revision is the only
		// signal a repaint gate has left.
		const subSecond = parser.parse(compose([CPU], [{ ...TEMP, value: 77.25 }]));
		assert.equal(subSecond, first, "still the fast path");
		assert.equal(subSecond.pollTime, first.pollTime, "stamp did not move");
		assert.equal(subSecond.valueRevision, (rev ?? 0) + 1, "the data move is still visible");
		// A rebuild (entry added) continues the same revision line upward.
		const grown = parser.parse(compose([CPU], [{ ...TEMP, value: 77.25 }, { ...TEMP, id: 0x1000001, orig: "Core", value: 3 }]));
		assert.notEqual(grown, first);
		assert.ok((grown.valueRevision ?? 0) > (subSecond.valueRevision ?? 0), "a rebuild bumps past the fast-path line");
	});

	it("a NaN value never bumps valueRevision on identical bytes", () => {
		// NaN !== NaN: a plain !== guard would read a NaN entry as changed on
		// every tick, defeating the detail render gate for as long as HWiNFO
		// publishes one. The guards compare with Object.is.
		const parser = new SnapshotParser();
		const first = parser.parse(compose([CPU], [{ ...TEMP, value: NaN }]));
		const rev = first.valueRevision;
		const again = parser.parse(compose([CPU], [{ ...TEMP, value: NaN }]));
		assert.equal(again, first);
		assert.equal(again.valueRevision, rev);
	});

	it("rebuilds when the header changes (entry count)", () => {
		const parser = new SnapshotParser();
		const first = parser.parse(compose([CPU], [TEMP]));
		const second = parser.parse(compose([CPU], [TEMP, { ...TEMP, id: 0x1000001, orig: "Core", value: 3 }]));
		assert.notEqual(second, first);
		assert.equal(second.readings.length, 2);
	});

	it("rebuilds when an entry identity changes under an unchanged header", () => {
		const parser = new SnapshotParser();
		const first = parser.parse(compose([CPU], [TEMP]));
		const swapped = parser.parse(compose([CPU], [{ ...TEMP, id: 0x2000000, orig: "Different" }]));
		assert.notEqual(swapped, first);
		assert.equal(swapped.readings[0]?.key, "f0000501:0:2000000");
		assert.equal(swapped.readings[0]?.label, "Different");
	});

	for (const utf8 of [false, true]) {
		for (const changed of ["id", "instance"] as const) {
			it(`rebuilds when only the owning sensor ${changed} changes (${utf8 ? "UTF-8" : "classic"})`, () => {
				const parser = new SnapshotParser();
				const buf = compose([CPU], [TEMP], { utf8 });
				const first = parser.parse(buf);
				const oldKey = first.readings[0]?.key;
				assert.ok(oldKey);
				const beforeRevision = first.valueRevision ?? 0;
				const sensorOffset = buf.readUInt32LE(HEADER.sensorSectionOffset);
				const entryOffset = buf.readUInt32LE(HEADER.entrySectionOffset);
				const newOwner = { ...CPU, [changed]: CPU[changed] + 1 };
				// Preserve the header, entry identity and unit bytes. Only the
				// owner descriptor and its new measurement change in place.
				buf.writeUInt32LE(newOwner[changed], sensorOffset + SENSOR[changed]);
				buf.writeDoubleLE(81, entryOffset + ENTRY.value);
				const rewritten = parser.parse(buf);
				assert.notEqual(rewritten, first, "owner changes invalidate the cached identity");
				assert.equal(rewritten.byKey.get(oldKey), undefined, "the previous owner must never receive the replacement value");
				assert.equal(rewritten.byKey.get(`${newOwner.id.toString(16)}:${newOwner.instance}:${TEMP.id.toString(16)}`)?.value, 81);
				assert.ok((rewritten.valueRevision ?? 0) > beforeRevision);
				assert.equal(parser.parse(buf), rewritten, "the rebuilt owner supports the ordinary fast path");
			});
		}

		it(`rebuilds after owner descriptors swap with unchanged entry identities (${utf8 ? "UTF-8" : "classic"})`, () => {
			const parser = new SnapshotParser();
			const other = { ...CPU, id: CPU.id + 1, orig: "Other CPU" };
			const entries = [TEMP, { ...TEMP, sensorIndex: 1, value: 81 }];
			const first = parser.parse(compose([CPU, other], entries, { utf8 }));
			const swapped = parser.parse(compose([other, CPU], entries, { utf8 }));
			assert.notEqual(swapped, first);
			assert.equal(swapped.byKey.get("f0000501:0:1000000")?.value, 81);
			assert.equal(swapped.byKey.get("f0000502:0:1000000")?.value, TEMP.value);
			assert.equal(swapped.sensors[0]?.name, "Other CPU");
		});

		it(`preserves saved keys when ordinary entries reorder (${utf8 ? "UTF-8" : "classic"})`, () => {
			const parser = new SnapshotParser();
			const other = { ...TEMP, id: TEMP.id + 1, orig: "Other temperature", value: 81 };
			const first = parser.parse(compose([CPU], [TEMP, other], { utf8 }));
			const reordered = parser.parse(compose([CPU], [other, TEMP], { utf8 }));
			assert.notEqual(reordered, first);
			assert.equal(reordered.byKey.get("f0000501:0:1000000")?.value, TEMP.value);
			assert.equal(reordered.byKey.get("f0000501:0:1000001")?.value, 81);
		});
	}

	it("rebuilds when a unit changes under an unchanged skeleton (runtime C to F flip)", () => {
		const parser = new SnapshotParser();
		const first = parser.parse(compose([CPU], [TEMP]));
		assert.equal(first.readings[0]?.unit, "°C".normalize());
		// HWiNFO flipped to Fahrenheit: identical skeleton and identities, but
		// the published unit and values are now Fahrenheit. A stale °C unit
		// makes the display layer convert an already-converted value.
		const flipped = parser.parse(compose([CPU], [{ ...TEMP, unit: "°F", value: 131.9, min: 104, max: 194, avg: 140 }]));
		assert.equal(flipped.readings[0]?.unit, "°F".normalize());
		assert.equal(flipped.readings[0]?.value, 131.9);
		assert.equal(flipped.readings[0]?.valueMax, 194);
	});

	it("rebuilds when only the UTF-8 unit tail changes (HWiNFO ≥ 7.x layout)", () => {
		const parser = new SnapshotParser();
		const first = parser.parse(compose([CPU], [{ ...TEMP, unitUtf8: "°C" }], { utf8: true }));
		assert.equal(first.readings[0]?.unit, "°C");
		const flipped = parser.parse(compose([CPU], [{ ...TEMP, unitUtf8: "°F", value: 131.9 }], { utf8: true }));
		assert.equal(flipped.readings[0]?.unit, "°F");
		assert.equal(flipped.readings[0]?.value, 131.9);
	});

	it("fast path works across classic AND utf8 strides", () => {
		for (const utf8 of [false, true]) {
			const parser = new SnapshotParser();
			const a = parser.parse(compose([CPU], [TEMP], { utf8 }));
			const b = parser.parse(compose([CPU], [{ ...TEMP, value: 61 }], { utf8 }));
			assert.equal(b, a);
			assert.equal(b.readings[0]?.value, 61);
		}
	});
});

describe("parseSnapshot — malformed input", () => {
	it("rejects a sensor stride below the classic layout", () => {
		const buf = compose([CPU], [TEMP]);
		buf.writeUInt32LE(SENSOR_CLASSIC_SIZE - 4, HEADER.sensorElementSize);
		assert.throws(() => parseSnapshot(buf), (e: unknown) => e instanceof HwinfoError && e.reason === "invalid");
	});

	it("rejects an entry stride below the classic layout", () => {
		const buf = compose([CPU], [TEMP]);
		buf.writeUInt32LE(ENTRY_CLASSIC_SIZE - 1, HEADER.entryElementSize);
		assert.throws(() => parseSnapshot(buf), (e: unknown) => e instanceof HwinfoError && e.reason === "invalid");
	});

	it("garbage label bytes decode without throwing (lossy, never fatal)", () => {
		const buf = compose([CPU], [TEMP], { utf8: true });
		// Invalid UTF-8 in the label tail must not break the decode.
		buf.fill(0xfe, buf.readUInt32LE(HEADER.entrySectionOffset) + ENTRY.labelUtf8, buf.readUInt32LE(HEADER.entrySectionOffset) + ENTRY.labelUtf8 + 8);
		const snap = parseSnapshot(buf);
		assert.equal(typeof snap.readings[0]?.label, "string");
		assert.ok((snap.readings[0]?.label.length ?? 0) > 0);
	});
});
