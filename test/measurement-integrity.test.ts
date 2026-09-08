import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compose, type ReadingSettings } from "../src/actions/sensor-reading";
import { composeDialSvg, SensorDialAction } from "../src/actions/sensor-dial";
import { composeChunkFace, type DetailFaceContext } from "../src/detail/detail-faces";
import type { DeviceDetailState } from "../src/detail/navigation";
import { IDLE_GESTURE } from "../src/gestures";
import { gadgetReadingKey } from "../src/hwinfo/gadget-identity";
import { applyReadingLinks, parseReadingLinks } from "../src/hwinfo/reading-links";
import type { Reading, SensorSnapshot } from "../src/hwinfo/types";
import { SessionStatsStore } from "../src/stats";
import { convertUnit, readingStatBadge, statValue } from "../src/ui/format";
import { effectiveTextFor } from "../src/ui/theme-store";
import { loadThemes } from "../src/ui/themes";

const link = { sharedMemory: "f0001234:0:1000001", gadget: "g:GPU:Temperature", unit: "°C", sensorType: 1 };
const reading: Reading = { key: link.sharedMemory, sensorIndex: 0, id: 1, label: "Temperature", type: 1, unit: "°C", value: 40, valueMin: 30, valueMax: 60, valueAvg: 42 };
const snapshot = (r: Reading = reading, pollTime = 1): SensorSnapshot => ({ pollTime, valueRevision: pollTime, version: 1, revision: 0, sensors: [{ index: 0, id: 1, instance: 0, name: "GPU" }], readings: [r], byKey: new Map([[r.key, r]]) });

describe("refutation: identity and explicit links", () => {
	it("reserved names, empty names and spaces produce injective keys", () => {
		const parts = ["", "GPU", "GPU:0", "GPU~1", "GPU %", "a:b", "a", "b:c", "a\nb", "é", "\"[]", " Two words "];
		const keys = parts.flatMap((source) => parts.map((label) => gadgetReadingKey(source, label)));
		assert.equal(new Set(keys).size, parts.length ** 2);
		assert.equal(gadgetReadingKey("Two words", "CPU Temp"), "g:Two words:CPU Temp");
	});
	it("links are opt in and never inferred from identical names or numbers", () => {
		assert.equal(applyReadingLinks(snapshot(), [], 0).byKey.get(link.gadget), undefined);
		const original = snapshot();
		const linked = applyReadingLinks(original, [link], 1);
		assert.equal(linked.byKey.get(link.gadget)?.value, 40);
		assert.equal(original.byKey.get(link.gadget), undefined, "never mutate a provider's cached snapshot");
		assert.equal(linked.byKey.get(link.gadget)?.key, link.gadget, "personalization continues to use the saved key");
	});
	it("conflicting links have no order-dependent winner", () => {
		const conflict = { ...link, gadget: "g:GPU:Other" };
		assert.deepEqual(parseReadingLinks([link, conflict]), []);
		assert.deepEqual(parseReadingLinks([conflict, link]), []);
		assert.deepEqual(parseReadingLinks([link, link]), []);
	});
	it("malformed settings and legacy duplicate suffixes cannot create links", () => {
		for (const raw of [null, {}, "junk", [null, 4, { ...link, unit: [] }], [{ ...link, sensorType: 100 }], [{ ...link, gadget: "g:GPU:Temperature~1" }], Array.from({ length: 129 }, () => link)]) assert.deepEqual(parseReadingLinks(raw), []);
		assert.deepEqual(parseReadingLinks([{ bad: true }, link]), [link]);
	});
	it("unit/type changes and missing endpoints fail closed in either direction", () => {
		for (const key of [link.sharedMemory, link.gadget]) {
			const other = key === link.gadget ? link.sharedMemory : link.gadget;
			assert.equal(applyReadingLinks(snapshot({ ...reading, key, unit: "°F" }), [link], 1).byKey.get(other), undefined);
			assert.equal(applyReadingLinks(snapshot({ ...reading, key, type: 5 }), [link], 1).byKey.get(other), undefined);
			assert.equal(applyReadingLinks({ ...snapshot(), readings: [], byKey: new Map() }, [link], 1).byKey.size, 0);
		}
	});
});

describe("refutation: historical and local statistics", () => {
	it("explicitly unavailable history cannot be restored by placeholder numeric fields", () => {
		const gadget = { ...reading, statistics: "unavailable" as const };
		for (const mode of ["min", "max", "avg"] as const) {
			assert.ok(Number.isNaN(statValue(gadget, mode)));
			assert.equal(readingStatBadge(gadget, mode), "N/A");
		}
		assert.equal(statValue(gadget, "current"), 40);
	});
	it("native 45 C to 113 F resets history and reports the unit change", () => {
		const store = new SessionStatsStore();
		const celsius = { ...reading, value: 45 };
		assert.equal(store.observe(celsius, snapshot(celsius), "shared-memory"), undefined);
		const fahrenheit = { ...celsius, value: 113, unit: "°F" };
		assert.equal(store.observe(fahrenheit, snapshot(fahrenheit, 2), "shared-memory"), "unit");
		assert.deepEqual(store.get(reading.key), { min: 113, max: 113, sum: 113, count: 1 });
	});
	it("display conversion preserves the native-unit session; backend changes report a reset", () => {
		const store = new SessionStatsStore();
		const first = { ...reading, value: 45 };
		store.observe(first, snapshot(first), "shared-memory");
		const second = { ...reading, value: 65 };
		store.observe(second, snapshot(second, 2), "shared-memory");
		const stats = { ...store.get(reading.key)! };
		assert.equal(convertUnit(stats.min, first.unit, true).value, 113);
		assert.equal(store.observe(second, snapshot(second, 2), "shared-memory"), undefined);
		assert.deepEqual(store.get(reading.key), stats);
		assert.equal(store.observe(second, snapshot(second, 2), "gadget"), "source");
		assert.deepEqual(store.get(reading.key), { min: 65, max: 65, sum: 65, count: 1 });
	});
	it("unavailable Gadget history displays N/A with no fabricated number", () => {
		const gadget = { ...reading, key: link.gadget, valueMin: NaN, valueMax: NaN, valueAvg: NaN };
		for (const mode of ["min", "max", "avg"] as const) {
			assert.equal(readingStatBadge(gadget, mode), "N/A");
			assert.ok(Number.isNaN(statValue(gadget, mode)));
		}
		assert.equal(statValue(gadget, "current"), 40);
	});
	it("local statistics count evidence once, including subsecond changes and steady producer stamps", () => {
		const store = new SessionStatsStore();
		store.observe(reading, snapshot(), "shared-memory");
		store.observe(reading, snapshot(), "shared-memory");
		const next = { ...reading, value: 80 };
		store.observe(next, snapshot(next), "shared-memory");
		store.observe(next, snapshot(next, 2), "shared-memory");
		assert.deepEqual(store.get(reading.key), { min: 40, max: 80, sum: 200, count: 3 });
		store.reset([reading.key]);
		store.observe(next, snapshot(next, 2), "shared-memory");
		assert.equal(store.get(reading.key)?.count, 1, "reset seeds from the next observed sample");
	});
	it("provider, unit, invalid-value and binding changes end a local segment", () => {
		const store = new SessionStatsStore();
		store.observe(reading, snapshot(), "shared-memory");
		store.observe({ ...reading, value: 80 }, snapshot(), "gadget");
		assert.equal(store.get(reading.key)?.min, 80);
		store.observe({ ...reading, value: 90, unit: "°F" }, snapshot(), "gadget");
		assert.equal(store.get(reading.key)?.min, 90);
		store.observe({ ...reading, value: NaN }, snapshot(), "gadget");
		assert.equal(store.get(reading.key), undefined);
		store.observe(reading, snapshot(), "shared-memory");
		assert.equal(store.observe({ ...reading, value: 50 }, { ...snapshot(), bindingRevision: 2 }, "shared-memory"), "binding");
		assert.equal(store.get(reading.key)?.min, 50);
		assert.equal(store.observe({ ...reading, value: 70, type: 5 }, { ...snapshot(), bindingRevision: 2 }, "shared-memory"), "type");
		assert.equal(store.get(reading.key)?.min, 70);
	});
});

describe("measurement truth through production renderers", () => {
	it("45 to 65 to 50 Gadget values stay unavailable under every historical key/detail layout", () => {
		const config = loadThemes();
		const ctx: DetailFaceContext = { config, deckThemeId: config.defaultTheme, typeAccents: false, measure: { decimals: "auto", fahrenheit: false, dataUnits: "decimal" }, text: effectiveTextFor({}) };
		for (const value of [45, 65, 50]) {
			const readings = Array.from({ length: 4 }, (_, i): Reading => ({ ...reading, key: `g:Source:Reading ${i}`, label: `Reading ${i}`, value, valueMin: value, valueMax: value, valueAvg: value, statistics: "unavailable" }));
			const keys = readings.map((r) => r.key);
			const sourceSnapshot = { ...snapshot(), readings, byKey: new Map(readings.map((r) => [r.key, r])) };
			const status = { state: "ok", source: "gadget", snapshot: sourceSnapshot } as const;
			const state: DeviceDetailState = { deviceId: "test", pageSize: 4, density: 1, tilePlan: [], primaryKey: keys[0]!, groupSettings: {}, presentation: {}, group: { mode: "source", primaryKey: keys[0]!, title: "Source", keys }, offset: 0, statModes: new Map(), surfaceCount: 1, pending: false, dispatchedAt: 0, openerCell: null, mirrorSlotIndex: null };
			for (const mode of ["min", "max", "avg"] as const) {
				for (const [index, keyLayout] of ["single", "dual", "triple", "quad"].entries()) {
					const settings: ReadingSettings = { readingKey: keys[0], secondaryReadingKey: keys[1], quadReadingKey3: keys[2], quadReadingKey4: keys[3], keyLayout, statMode: mode, displayMode: "none" };
					for (const svg of [compose(settings, status), composeChunkFace(state, keys.slice(0, index + 1), mode, status, ctx)]) {
						assert.match(svg, />N\/A</, `${keyLayout} ${mode}`);
						assert.doesNotMatch(svg, />(?:45|65|50)(?:\.0)?</, `${keyLayout} must not label current as history`);
					}
				}
			}
			assert.match(compose({ readingKey: keys[0], statMode: "current", displayMode: "none" }, status), new RegExp(`>${value}(?:\\.0)?<`));
		}
	});
	it("dial native-unit and backend resets are explained on all three views", () => {
		type DialState = Parameters<typeof composeDialSvg>[0];
		type DialSeam = { sampleStats(state: DialState, snapshot: SensorSnapshot, source: string): void };
		// Exercise the production sampling and overlay methods without opening
		// a poller or registering live SDK listeners.
		const action = Object.create(SensorDialAction.prototype) as DialSeam;
		for (const dialView of ["single", "overview", "tworow"]) {
			const state: DialState = { settings: { readingKey: reading.key, dialView }, stats: new SessionStatsStore(), statMode: "min", lastFeedback: "", nextCycleAt: null, cyclePaused: false, pinned: false, gesture: IDLE_GESTURE, overlay: null, overlayTimer: null, deviceId: "test", pendingAlertUnitStamp: false, rowSeries: new Set() };
			try {
				const celsius = { ...reading, value: 45 };
				action.sampleStats(state, snapshot(celsius), "shared-memory");
				const fahrenheit = { ...reading, value: 113, unit: "°F" };
				const next = snapshot(fahrenheit, 2);
				action.sampleStats(state, next, "shared-memory");
				const svg = composeDialSvg(state, { state: "ok", source: "shared-memory", snapshot: next });
				assert.match(svg, /stats reset: units changed/);
				assert.match(svg, />113(?:\.0)?(?: °F)?</);
				assert.doesNotMatch(svg, />45(?:\.0)?(?: °F)?</);
				action.sampleStats(state, next, "gadget");
				assert.match(composeDialSvg(state, { state: "ok", source: "gadget", snapshot: next }), /stats reset: source changed/);
			} finally {
				if (state.overlayTimer !== null) clearTimeout(state.overlayTimer);
			}
		}
	});
});
