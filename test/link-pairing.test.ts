// Guided Shared Memory / Gadget pairing over the explicit-link backend
// (steer 7D): the row verdicts the parser and the panel share, the one
// per-link decision the runtime and the panel's health share, the
// row-scoped edit with its typed refusals, the session catalog and the
// counterpart suggestions.
//
// The parser and applyReadingLinks were refactored to read one row rule
// and one per-link decision; the 1.7.1 implementations are kept below as
// oracles and a seeded corpus holds the refactor to them byte for byte.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	counterpartReadiness,
	counterpartsFor,
	LINK_CATALOG_MAX,
	linkEndpointProvider,
	linkRowHealth,
	planLinkEdit,
	ReadingCatalog,
	type EndpointLookup,
	type LinkEndpoint
} from "../src/hwinfo/link-pairing";
import { applyReadingLinks, parseReadingLinks, readingLinkRows, resolveReadingLink, type ReadingLink } from "../src/hwinfo/reading-links";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";

// ------------------------------------------------------------- 1.7.1 oracles
function oracleParse(raw: unknown): readonly ReadingLink[] {
	if (!Array.isArray(raw) || raw.length > 128) return [];
	const valid: ReadingLink[] = [];
	for (const item of raw as unknown[]) {
		if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
		const row = item as Partial<ReadingLink>;
		if (typeof row.sharedMemory !== "string" || !/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/i.test(row.sharedMemory)) continue;
		if (typeof row.gadget !== "string" || !/^(?:g:[^:~\r\n]*:[^:~\r\n]*|g2:[A-Za-z0-9_-]+)$/.test(row.gadget)) continue;
		if (typeof row.unit !== "string" || row.unit.length > 32 || typeof row.sensorType !== "number" || !Number.isInteger(row.sensorType) || row.sensorType < 0 || row.sensorType > 8) continue;
		valid.push({ sharedMemory: row.sharedMemory, gadget: row.gadget, unit: row.unit, sensorType: row.sensorType });
	}
	const counts = new Map<string, number>();
	for (const link of valid) for (const key of [link.sharedMemory, link.gadget]) counts.set(key, (counts.get(key) ?? 0) + 1);
	return valid.filter((link) => counts.get(link.sharedMemory) === 1 && counts.get(link.gadget) === 1);
}

function oracleApply(snapshot: SensorSnapshot, links: readonly ReadingLink[], bindingRevision: number): SensorSnapshot {
	if (links.length === 0) return bindingRevision === 0 ? snapshot : { ...snapshot, bindingRevision };
	const byKey = new Map(snapshot.byKey);
	const groups = new Map<string, readonly string[]>();
	for (const link of links) {
		const primary = snapshot.byKey.get(link.sharedMemory);
		const fallback = snapshot.byKey.get(link.gadget);
		if ((primary === undefined) === (fallback === undefined)) continue;
		const found = primary ?? fallback;
		if (found === undefined || found.unit !== link.unit || (found === primary && found.type !== link.sensorType)) continue;
		const live = found.aliasOf === undefined ? found : (snapshot.byKey.get(found.aliasOf) ?? found);
		const previous = groups.get(live.key) ?? live.linkedKeys ?? [live.key];
		groups.set(live.key, [...new Set([live.key, ...previous, link.sharedMemory, link.gadget])]);
	}
	for (const [liveKey, group] of groups) {
		const live = snapshot.byKey.get(liveKey);
		if (live === undefined) continue;
		for (const key of group) byKey.set(key, key === liveKey ? { ...live, linkedKeys: group } : { ...live, key, linkedKeys: group, aliasOf: liveKey });
	}
	const readings = snapshot.readings.map((reading) => {
		const group = groups.get(reading.key);
		return group === undefined ? reading : { ...reading, linkedKeys: group };
	});
	return { ...snapshot, readings, byKey, bindingRevision };
}

// ------------------------------------------------------------- fixtures
/** Small deterministic PRNG (mulberry32), so a failure replays. */
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const SM = ["f0001234:0:1000001", "f0001234:0:1000002", "f0001234:0:1000003", "e0002000:0:7000000"] as const;
const G = ["g:Test Source:CPU Temp", "g:Test Source:GPU Temp", "g:Test Source:Pump", "g2:QUJD"] as const;

type Row = { key: string; label: string; unit: string; type: SensorType; sensor?: string; value?: number; aliasOf?: string };

function snapshotOf(rows: readonly Row[]): SensorSnapshot {
	const sensors: { index: number; id: number; instance: number; name: string }[] = [];
	const readings: Reading[] = [];
	const byKey = new Map<string, Reading>();
	for (const [i, row] of rows.entries()) {
		const name = row.sensor ?? "Test Source";
		let sensorIndex = sensors.findIndex((s) => s.name === name);
		if (sensorIndex < 0) {
			sensorIndex = sensors.length;
			sensors.push({ index: sensorIndex, id: 0xf0001234 + sensorIndex, instance: 0, name });
		}
		const value = row.value ?? 40 + i;
		const reading: Reading = { key: row.key, type: row.type, sensorIndex, id: i, label: row.label, unit: row.unit, value, valueMin: value, valueMax: value, valueAvg: value, ...(row.aliasOf === undefined ? {} : { aliasOf: row.aliasOf }) };
		if (row.aliasOf === undefined) readings.push(reading);
		byKey.set(row.key, reading);
	}
	return { pollTime: 1, valueRevision: 1, freshnessRevision: 1, version: 1, revision: 1, sensors, readings, byKey };
}

function randomRow(next: () => number): unknown {
	const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
	const r = next();
	if (r < 0.05) return pick([null, 7, "row", [SM[0], G[0]], undefined]);
	const row: Record<string, unknown> = {
		sharedMemory: pick([...SM, "nothex:0:1", "g:Test Source:CPU Temp", 5]),
		gadget: pick([...G, SM[0], "g:a:b:c", "g:~old", ""]),
		unit: pick(["°C", "°C", "W", "x".repeat(33), 3]),
		sensorType: pick([1, 1, 5, 9, -1, 1.5, "1"])
	};
	if (next() < 0.2) row.future = { keep: true };
	return row;
}

function randomSnapshot(next: () => number): SensorSnapshot {
	const rows: Row[] = [];
	for (const [i, key] of SM.entries()) if (next() < 0.5) rows.push({ key, label: `L${i}`, unit: next() < 0.8 ? "°C" : "W", type: next() < 0.8 ? SensorType.Temperature : SensorType.Power });
	for (const [i, key] of G.entries()) if (next() < 0.5) rows.push({ key, label: `L${i}`, unit: next() < 0.8 ? "°C" : "W", type: SensorType.Other, sensor: "Gadget" });
	return snapshotOf(rows);
}

// ------------------------------------------------------------- row verdicts
describe("reading-links: one row rule for the parser and the panel", () => {
	it("names every stored row, in stored order, holes included", () => {
		const good = { sharedMemory: SM[0], gadget: G[0], unit: "°C", sensorType: 1 };
		const raw = [good, { ...good, sharedMemory: SM[1] }, { sharedMemory: SM[2], gadget: G[2], unit: "°C", sensorType: 1, future: 1 }, "junk"];
		raw.length = 6; // two holes at the end
		const verdicts = readingLinkRows(raw).map((row) => row.verdict);
		assert.deepEqual(verdicts, ["conflict", "conflict", "valid", "malformed", "malformed", "malformed"]);
		assert.deepEqual(parseReadingLinks(raw), [{ sharedMemory: SM[2], gadget: G[2], unit: "°C", sensorType: 1 }], "the parser applies exactly the valid verdicts, without the unknown field");
	});

	it("a list over 128 rows is all cap, and a value that is not a list has no rows", () => {
		const row = { sharedMemory: SM[0], gadget: G[0], unit: "°C", sensorType: 1 };
		assert.ok(readingLinkRows(Array.from({ length: 129 }, () => row)).every((r) => r.verdict === "cap"));
		assert.equal(readingLinkRows(Array.from({ length: 129 }, () => row)).length, 129);
		for (const raw of [undefined, null, "x", { 0: row }, 4]) assert.deepEqual(readingLinkRows(raw), []);
	});

	it("parseReadingLinks equals the 1.7.1 parser over a seeded corpus", () => {
		const next = rng(7);
		for (let i = 0; i < 3000; i++) {
			const raw = next() < 0.02 ? Array.from({ length: 129 }, () => randomRow(next)) : Array.from({ length: Math.floor(next() * 7) }, () => randomRow(next));
			assert.deepEqual(parseReadingLinks(raw), oracleParse(raw), JSON.stringify(raw));
		}
	});
});

// ------------------------------------------------------------- one decision
describe("reading-links: one per-link decision for applying and for health", () => {
	it("applyReadingLinks equals the 1.7.1 implementation over a seeded corpus", () => {
		const next = rng(11);
		for (let i = 0; i < 3000; i++) {
			const snapshot = randomSnapshot(next);
			const links = parseReadingLinks(Array.from({ length: Math.floor(next() * 5) }, () => randomRow(next)));
			const revision = Math.floor(next() * 3);
			const got = applyReadingLinks(snapshot, links, revision);
			const want = oracleApply(snapshot, links, revision);
			assert.deepEqual([...got.byKey.entries()], [...want.byKey.entries()]);
			assert.deepEqual(got.readings, want.readings);
			assert.equal(got.bindingRevision, want.bindingRevision);
		}
	});

	it("health calls a row active exactly when the runtime aliases its other endpoint", () => {
		const next = rng(23);
		for (let i = 0; i < 2000; i++) {
			const snapshot = randomSnapshot(next);
			const raw = Array.from({ length: Math.floor(next() * 5) }, () => randomRow(next));
			const applied = applyReadingLinks(snapshot, parseReadingLinks(raw), 1);
			for (const row of linkRowHealth(raw, snapshot)) {
				if (row.link === undefined || row.health === "conflict") continue;
				const { sharedMemory, gadget } = row.link;
				if (row.health === "active-shared-memory") assert.equal(applied.byKey.get(gadget)?.aliasOf, sharedMemory);
				else if (row.health === "active-gadget") assert.equal(applied.byKey.get(sharedMemory)?.aliasOf, gadget);
				else {
					// Not applied by this row: neither endpoint gained an alias
					// pointing at the other through it.
					assert.notEqual(applied.byKey.get(gadget)?.aliasOf, sharedMemory);
					assert.notEqual(applied.byKey.get(sharedMemory)?.aliasOf, gadget);
				}
			}
		}
	});

	it("names each state the panel explains", () => {
		const link = { sharedMemory: SM[0], gadget: G[0], unit: "°C", sensorType: 1 };
		const smRow: Row = { key: SM[0], label: "CPU Temp", unit: "°C", type: SensorType.Temperature };
		const gRow: Row = { key: G[0], label: "CPU Temp", unit: "°C", type: SensorType.Other };
		assert.equal(resolveReadingLink(snapshotOf([smRow]), link).state, "shared-memory");
		assert.equal(resolveReadingLink(snapshotOf([gRow]), link).state, "gadget");
		assert.equal(resolveReadingLink(snapshotOf([smRow, gRow]), link).state, "both-live");
		assert.equal(resolveReadingLink(snapshotOf([]), link).state, "neither-live");
		assert.equal(resolveReadingLink(snapshotOf([{ ...smRow, unit: "°F" }]), link).state, "unit-changed");
		assert.equal(resolveReadingLink(snapshotOf([{ ...gRow, unit: "°F" }]), link).state, "unit-changed");
		assert.equal(resolveReadingLink(snapshotOf([{ ...smRow, type: SensorType.Power }]), link).state, "type-changed");
		assert.equal(resolveReadingLink(snapshotOf([{ ...gRow, type: SensorType.Power }]), link).state, "gadget", "Gadget's inferred type is never held to the link");
		const health = linkRowHealth([link, "junk", { ...link }], snapshotOf([smRow]));
		assert.deepEqual(health.map((h) => h.health), ["conflict", "malformed", "conflict"]);
		assert.deepEqual(linkRowHealth([link], null).map((h) => h.health), ["unknown"]);
	});
});

// ------------------------------------------------------------- edits
function lookupOf(entries: readonly Partial<LinkEndpoint>[]): EndpointLookup {
	return (provider, key) => {
		const found = entries.find((e) => e.provider === provider && e.key === key);
		return found === undefined ? undefined : ({ sensor: "Test Source", label: "CPU Temp", unit: "°C", type: SensorType.Temperature, value: 40, seenAt: 0, via: "read", renamed: false, published: true, ...found } as LinkEndpoint);
	};
}

const SM_A: Partial<LinkEndpoint> = { provider: "shared-memory", key: SM[0], type: SensorType.Temperature };
const G_A: Partial<LinkEndpoint> = { provider: "gadget", key: G[0], type: SensorType.Other };
const SM_B: Partial<LinkEndpoint> = { provider: "shared-memory", key: SM[1], label: "GPU Temp" };
const G_B: Partial<LinkEndpoint> = { provider: "gadget", key: G[1], label: "GPU Temp", type: SensorType.Temperature };

describe("link-pairing: a link edit changes only its row or is refused with a reason", () => {
	const lookup = lookupOf([SM_A, G_A, SM_B, G_B]);
	const linkA = { op: "link" as const, sharedMemory: SM[0], gadget: G[0] };

	it("a link appends one row with the Shared Memory unit and type, after every stored element", () => {
		const stored = ["junk", { future: true }, { sharedMemory: SM[1], gadget: G[1], unit: "°C", sensorType: 1, note: "mine" }];
		const plan = planLinkEdit(stored, linkA, lookup);
		assert.ok(plan.ok);
		assert.deepEqual(plan.next, [...stored, { sharedMemory: SM[0], gadget: G[0], unit: "°C", sensorType: 1 }]);
		assert.equal(plan.next[2], stored[2], "an untouched row is the same value, not a copy");
		assert.deepEqual(planLinkEdit(undefined, linkA, lookup), { ok: true, next: [{ sharedMemory: SM[0], gadget: G[0], unit: "°C", sensorType: 1 }], row: { sharedMemory: SM[0], gadget: G[0], unit: "°C", sensorType: 1 } });
	});

	it("an unlink removes exactly the rows holding that pair and keeps the rest in place", () => {
		const a = { sharedMemory: SM[0], gadget: G[0], unit: "°C", sensorType: 1, extra: [1] };
		const stored = [{ x: 1 }, a, "junk", { sharedMemory: SM[1], gadget: G[1], unit: "°C", sensorType: 1 }];
		const plan = planLinkEdit(stored, { op: "unlink", sharedMemory: SM[0], gadget: G[0] }, lookup);
		assert.ok(plan.ok);
		assert.deepEqual(plan.next, [stored[0], "junk", stored[3]]);
		assert.deepEqual(planLinkEdit(stored, { op: "unlink", sharedMemory: SM[2], gadget: G[2] }, lookup), { ok: false, reason: "not-linked" });
	});

	it("a relink replaces one row in place and keeps that row's unknown fields", () => {
		const stored = [{ k: 0 }, { sharedMemory: SM[0], gadget: G[1], unit: "°C", sensorType: 1, note: "mine" }, { k: 2 }];
		const plan = planLinkEdit(stored, { op: "relink", sharedMemory: SM[0], gadget: G[0], previous: { sharedMemory: SM[0], gadget: G[1] } }, lookup);
		assert.ok(plan.ok);
		assert.deepEqual(plan.next, [{ k: 0 }, { sharedMemory: SM[0], gadget: G[0], unit: "°C", sensorType: 1, note: "mine" }, { k: 2 }]);
		assert.deepEqual(planLinkEdit(stored, { op: "relink", sharedMemory: SM[0], gadget: G[0], previous: { sharedMemory: SM[2], gadget: G[2] } }, lookup), { ok: false, reason: "not-linked" });
		assert.deepEqual(planLinkEdit(stored, { op: "relink", sharedMemory: SM[0], gadget: G[1], previous: { sharedMemory: SM[0], gadget: G[1] } }, lookup), { ok: false, reason: "duplicate" }, "the same pair again writes nothing");
	});

	const cases: { name: string; stored?: unknown; edit?: Parameters<typeof planLinkEdit>[1]; lookup?: EndpointLookup; reason: string }[] = [
		{ name: "two Shared Memory keys", edit: { op: "link", sharedMemory: SM[0], gadget: SM[1] }, reason: "malformed" },
		{ name: "a calculated key", edit: { op: "link", sharedMemory: "calc:AAAAAAAAAAAAAAAAAAAAAA", gadget: G[0] }, reason: "malformed" },
		{ name: "a stored value that is not a list", stored: { readingLinks: [] }, reason: "unreadable-list" },
		{ name: "a 1.6 Gadget spelling", lookup: lookupOf([SM_A, { ...G_A, aliasOf: G[1] }]), reason: "legacy-alias" },
		{ name: "an endpoint never seen this session", lookup: lookupOf([SM_A]), reason: "missing-counterpart" },
		{ name: "a re-enumerated key not published now", lookup: lookupOf([SM_A, { ...G_A, renamed: true, published: false }]), reason: "ambiguous" },
		{ name: "different units", lookup: lookupOf([SM_A, { ...G_A, unit: "°F" }]), reason: "unit-mismatch" },
		{ name: "two specific types that disagree", lookup: lookupOf([SM_A, { ...G_A, type: SensorType.Power }]), reason: "type-mismatch" },
		{ name: "the same pair again", stored: [{ sharedMemory: SM[0], gadget: G[0], unit: "°C", sensorType: 1 }], reason: "duplicate" },
		{ name: "an endpoint in another row", stored: [{ sharedMemory: SM[0], gadget: G[1], unit: "°C", sensorType: 1 }], reason: "conflict" },
		{ name: "an endpoint in a malformed row", stored: [{ sharedMemory: SM[2], gadget: G[0], unit: 5 }], reason: "conflict" },
		{ name: "a full list", stored: Array.from({ length: 128 }, () => "row"), reason: "cap" }
	];
	for (const c of cases) {
		it(`refuses ${c.name} (${c.reason}) and plans no write`, () => {
			const plan = planLinkEdit(c.stored, c.edit ?? linkA, c.lookup ?? lookup);
			assert.deepEqual(plan, { ok: false, reason: c.reason });
		});
	}

	it("Other and None never count as a type disagreement (HWiNFO types several % readings as Other)", () => {
		const plan = planLinkEdit([], linkA, lookupOf([{ ...SM_A, type: SensorType.Other }, { ...G_A, type: SensorType.Usage }]));
		assert.ok(plan.ok);
		assert.deepEqual(plan.row, { sharedMemory: SM[0], gadget: G[0], unit: "°C", sensorType: SensorType.Other });
	});

	it("a planned link is one the parser applies (the round trip never voids the list)", () => {
		const stored = [{ sharedMemory: SM[1], gadget: G[1], unit: "°C", sensorType: 1 }];
		const plan = planLinkEdit(stored, linkA, lookup);
		assert.ok(plan.ok);
		assert.equal(parseReadingLinks(plan.next).length, 2);
	});
});

// ------------------------------------------------------------- catalog
describe("link-pairing: the session catalog", () => {
	it("remembers each provider's readings with source, label, unit, type and the value at the sighting", () => {
		const catalog = new ReadingCatalog();
		const snap = snapshotOf([{ key: SM[0], label: "CPU Temp", unit: "°C", type: SensorType.Temperature, sensor: "CPU", value: 51 }]);
		catalog.observe(snap, "shared-memory", 1000);
		assert.deepEqual(catalog.get("shared-memory", SM[0]), { key: SM[0], provider: "shared-memory", sensor: "CPU", label: "CPU Temp", unit: "°C", type: SensorType.Temperature, value: 51, seenAt: 1000, via: "read", renamed: false });
		assert.equal(catalog.get("gadget", SM[0]), undefined, "providers are kept apart");
		assert.deepEqual(catalog.lastSeen("shared-memory"), { at: 1000, via: "read" });
		assert.equal(catalog.lastSeen("gadget"), undefined);
	});

	it("the same snapshot instance is not walked again; its current values are read live", () => {
		const catalog = new ReadingCatalog();
		const snap = snapshotOf([{ key: SM[0], label: "CPU Temp", unit: "°C", type: SensorType.Temperature, value: 51 }]);
		catalog.observe(snap, "shared-memory", 1000);
		(snap.byKey.get(SM[0]) as { value: number }).value = 60; // the parser updates values in place
		(snap.byKey.get(SM[0]) as { label: string }).label = "Renamed in place";
		catalog.observe(snap, "shared-memory", 2000);
		const entry = catalog.get("shared-memory", SM[0]);
		assert.equal(entry?.value, 60);
		assert.equal(entry?.seenAt, 2000);
		assert.equal(entry?.label, "CPU Temp", "no walk: the skeleton did not change");
	});

	it("a key that names another reading later is marked renamed; a reading no longer published keeps its last sighting", () => {
		const catalog = new ReadingCatalog();
		catalog.observe(snapshotOf([{ key: G[0], label: "CPU Temp", unit: "°C", type: SensorType.Other, value: 50 }]), "gadget", 1);
		catalog.observe(snapshotOf([{ key: G[0], label: "GPU Temp", unit: "°C", type: SensorType.Other, value: 70 }]), "gadget", 2);
		assert.equal(catalog.get("gadget", G[0])?.renamed, true);
		catalog.observe(snapshotOf([]), "gadget", 3);
		assert.deepEqual({ ...catalog.get("gadget", G[0]) }, { key: G[0], provider: "gadget", sensor: "Test Source", label: "GPU Temp", unit: "°C", type: SensorType.Other, value: 70, seenAt: 2, via: "read", renamed: true });
	});

	it("records a provider-published alias with aliasOf, and lists most recent first", () => {
		const catalog = new ReadingCatalog();
		catalog.observe(snapshotOf([{ key: G[0], label: "A", unit: "°C", type: 1 }, { key: "g:Test Source:Legacy", label: "A", unit: "°C", type: 1, aliasOf: G[0] }]), "gadget", 1);
		catalog.observe(snapshotOf([{ key: G[1], label: "B", unit: "°C", type: 1 }]), "gadget", 2);
		assert.equal(catalog.get("gadget", "g:Test Source:Legacy")?.aliasOf, G[0]);
		assert.deepEqual(catalog.list("gadget").map((e) => e.key), [G[1], "g:Test Source:Legacy", G[0]]);
	});

	it("is bounded at 4096 readings per provider, dropping the oldest sighting first", () => {
		assert.equal(LINK_CATALOG_MAX, 4096);
		const catalog = new ReadingCatalog();
		const rows = (from: number, n: number): Row[] => Array.from({ length: n }, (_u, i) => ({ key: `f0001234:0:${(from + i).toString(16)}`, label: `R${from + i}`, unit: "W", type: SensorType.Power }));
		catalog.observe(snapshotOf(rows(0, 3000)), "shared-memory", 1);
		catalog.observe(snapshotOf(rows(3000, 2000)), "shared-memory", 2);
		assert.equal(catalog.size("shared-memory"), 4096);
		assert.equal(catalog.get("shared-memory", "f0001234:0:0"), undefined, "the oldest sighting went first");
		assert.notEqual(catalog.get("shared-memory", `f0001234:0:${(4999).toString(16)}`), undefined);
		catalog.observe(snapshotOf(rows(0, 10)), "gadget", 3);
		assert.equal(catalog.size("gadget"), 10, "the other provider has its own bound");
	});
});

// ------------------------------------------------------------- suggestions
describe("link-pairing: counterparts and readiness", () => {
	const endpoint = (e: Partial<LinkEndpoint>): LinkEndpoint => ({ key: "", provider: "gadget", sensor: "Test Source", label: "CPU Temp", unit: "°C", type: SensorType.Other, value: 1, seenAt: 0, via: "read", renamed: false, published: true, ...e });

	it("lists suggestions first, never preselected, and carries the refusal a Link press would meet", () => {
		const focus = endpoint({ provider: "shared-memory", key: SM[0], type: SensorType.Temperature });
		const pool = [
			endpoint({ key: "g:Other:Watts", label: "Watts", unit: "W" }),
			endpoint({ key: "g:Elsewhere:CPU Temp", sensor: "Elsewhere", label: "cpu  temp" }),
			endpoint({ key: G[0] }),
			endpoint({ key: "g:Test Source:Fan", label: "Fan" }),
			endpoint({ key: "g:Test Source:Old", aliasOf: G[0] }),
			endpoint({ key: SM[1], provider: "shared-memory" })
		];
		const lookup: EndpointLookup = (provider, key) => (provider === "shared-memory" && key === SM[0] ? focus : pool.find((e) => e.provider === provider && e.key === key));
		const list = counterpartsFor(focus, pool, [], lookup);
		assert.deepEqual(list.map((c) => [c.endpoint.key, c.suggestion ?? null, c.blocked ?? null]), [
			[G[0], "same-name", null],
			["g:Elsewhere:CPU Temp", "same-label", null],
			["g:Test Source:Fan", null, null],
			["g:Other:Watts", null, "unit-mismatch"]
		]);
		const taken = counterpartsFor(focus, pool, [{ sharedMemory: SM[1], gadget: G[0], unit: "°C", sensorType: 1 }], lookup);
		assert.equal(taken[0]?.blocked, "conflict");
	});

	it("a focus that is linked already is offered a relink of its own row (Replace link)", () => {
		const focus = endpoint({ provider: "shared-memory", key: SM[0], type: SensorType.Temperature });
		const pool = [endpoint({ key: G[0] }), endpoint({ key: "g:Elsewhere:CPU Temp", sensor: "Elsewhere" }), endpoint({ key: "g:Test Source:Fan", label: "Fan" })];
		const lookup: EndpointLookup = (provider, key) => (provider === "shared-memory" && key === SM[0] ? focus : pool.find((e) => e.provider === provider && e.key === key));
		const own = { sharedMemory: SM[0], gadget: G[0], unit: "°C", sensorType: 1 };
		const other = { sharedMemory: SM[1], gadget: "g:Test Source:Fan", unit: "°C", sensorType: 1 };
		const stored = [own, other];
		const list = counterpartsFor(focus, pool, stored, lookup, { sharedMemory: SM[0], gadget: G[0] });
		assert.deepEqual(list.map((c) => [c.endpoint.key, c.blocked ?? null]), [
			[G[0], "duplicate"],
			["g:Elsewhere:CPU Temp", null],
			["g:Test Source:Fan", "conflict"]
		], "its own row never blocks; another row still does");
		const plan = planLinkEdit(stored, { op: "relink", sharedMemory: SM[0], gadget: "g:Elsewhere:CPU Temp", previous: { sharedMemory: SM[0], gadget: G[0] } }, lookup);
		assert.ok(plan.ok, "the offered pair is one the plugin accepts");
		assert.deepEqual(plan.next, [{ sharedMemory: SM[0], gadget: "g:Elsewhere:CPU Temp", unit: "°C", sensorType: 1 }, other]);
	});

	it("readiness says whether the other endpoint would take over", () => {
		const link = { sharedMemory: SM[0], gadget: G[0], unit: "°C", sensorType: 1 };
		assert.equal(counterpartReadiness(link, undefined), "unseen");
		assert.equal(counterpartReadiness(link, { provider: "gadget", unit: "°C", type: SensorType.Other }), "ready");
		assert.equal(counterpartReadiness(link, { provider: "gadget", unit: "°F", type: SensorType.Other }), "unit-changed");
		assert.equal(counterpartReadiness(link, { provider: "shared-memory", unit: "°C", type: SensorType.Power }), "type-changed");
	});

	it("an endpoint's provider follows its spelling alone", () => {
		assert.equal(linkEndpointProvider(SM[0]), "shared-memory");
		assert.equal(linkEndpointProvider(G[0]), "gadget");
		assert.equal(linkEndpointProvider(G[3]), "gadget");
		for (const key of ["calc:AAAAAAAAAAAAAAAAAAAAAA", "rm:1:abc", "~3", "?:x", ""]) assert.equal(linkEndpointProvider(key), undefined);
	});
});
