// Source-scoped hand-placed keys (7E, detailScope): the salvage parser,
// the source identity a scope names (Shared Memory sensor id and
// instance, the Gadget source name), the navigator's view of the
// opener's source, the hidden-or-shown decision, and the production
// Sensor Reading action on a managed detail page: a key scoped to another
// source draws the page's blank and its press does nothing (no stat
// cycle, no write, no entry); on its own source's page it is live; an
// unscoped key shows on every detail page as before. Appearing, ticks
// and repaints write nothing.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { SensorReadingAction, type ReadingSettings } from "../src/actions/sensor-reading";
import { DETAIL_SCOPE_MAX, detailScopeOf } from "../src/detail/detail-settings";
import { describeScopeSource, detailScopePayloadOf, detailSourceIdOf, detailSourceNameOf, detailSourceOf, onDetailPage, scopedKeyHidden, type DetailPageView } from "../src/detail/detail-scope";
import { DetailNavigator } from "../src/detail/navigation";
import { CALCULATED_SOURCE_NAME } from "../src/hwinfo/calculated";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import { poller, type PollerStatus } from "../src/poller";
import { renderDetailBlankKey } from "../src/ui/detail-renderer";
import { applyGlobalThemeSettings, getDeckTheme } from "../src/ui/theme-store";
import { loadThemes, resolvePalette } from "../src/ui/themes";

// A deck theme whose blank is not plain black, so a blank tile can never
// pass for the switch-beat void frame.
applyGlobalThemeSettings({ theme: "paper" });

function reading(key: string, sensorIndex: number, label: string, extra: Partial<Reading> = {}): Reading {
	return { key, type: SensorType.Temperature, sensorIndex, id: 1, label, unit: "°C", value: 50, valueMin: 40, valueMax: 60, valueAvg: 50, ...extra };
}

const CPU = "f000:0:1000000";
const CPU2 = "f000:0:1000001";
const GPU = "e000:1:2000000";
const sensors = [
	{ index: 0, id: 0xf000, instance: 0, name: "CPU [#0]: AMD Ryzen" },
	{ index: 1, id: 0xe000, instance: 1, name: "GPU [#0]: NVIDIA" }
];
const readings = [reading(CPU, 0, "Tctl"), reading(CPU2, 0, "CCD1"), reading(GPU, 1, "GPU Temp"), reading("orphan:0:1", -1, "Orphan")];
const snapshot: SensorSnapshot = { pollTime: 1, valueRevision: 1, version: 1, revision: 1, sensors, readings, byKey: new Map(readings.map((r) => [r.key, r])) };
const ok: PollerStatus = { state: "ok", snapshot, source: "shared-memory" };

describe("detailScopeOf salvage", () => {
	const cases: Array<[string, unknown, readonly string[] | undefined]> = [
		["absent", undefined, undefined],
		["null", null, undefined],
		["a bare array", ["f000:0"], undefined],
		["a string", "f000:0", undefined],
		["no sources", {}, undefined],
		["sources not an array", { sources: "f000:0" }, undefined],
		["an empty list", { sources: [] }, undefined],
		["only junk entries", { sources: [1, null, "", {}, ["f000:0"]] }, undefined],
		["one id", { sources: ["f000:0"] }, ["f000:0"]],
		["unknown sibling fields ride along unread", { sources: ["f000:0"], future: true }, ["f000:0"]],
		["exact duplicates drop, spellings stay byte for byte", { sources: ["f000:0", "f000:0", "CPU ", "CPU"] }, ["f000:0", "CPU ", "CPU"]]
	];
	for (const [name, raw, expected] of cases) {
		it(name, () => {
			assert.deepEqual(detailScopeOf(raw === undefined ? {} : { detailScope: raw }), expected);
		});
	}

	it(`keeps at most ${DETAIL_SCOPE_MAX} sources`, () => {
		const many = Array.from({ length: DETAIL_SCOPE_MAX + 5 }, (_, i) => `s${i}`);
		assert.equal(detailScopeOf({ detailScope: { sources: many } })?.length, DETAIL_SCOPE_MAX);
	});
});

describe("the source a scope names", () => {
	it("Shared Memory: the sensor id in hex and the instance, the front of its reading keys", () => {
		assert.equal(detailSourceIdOf(sensors[0] as (typeof sensors)[number], "shared-memory", CPU), "f000:0");
		assert.equal(detailSourceIdOf(sensors[1] as (typeof sensors)[number], "shared-memory", GPU), "e000:1");
		assert.ok(CPU.startsWith("f000:0:") && GPU.startsWith("e000:1:"));
	});

	it("Gadget: the source name exactly as HWiNFO writes it; the Calculated source by name on both", () => {
		const gadgetSensor = { index: 3, id: 0, instance: 3, name: "GPU [#0]: NVIDIA " };
		assert.equal(detailSourceIdOf(gadgetSensor, "gadget", "g:GPU [#0]: NVIDIA :GPU Temp"), "GPU [#0]: NVIDIA ");
		const calc = { index: 4, id: 0, instance: 0, name: CALCULATED_SOURCE_NAME };
		assert.equal(detailSourceIdOf(calc, "shared-memory", "calc:AAAAAAAAAAAAAAAAAAAAAA"), CALCULATED_SOURCE_NAME);
	});

	it("a stored rm: entry stays as saved and reads as a source not here", () => {
		assert.deepEqual(describeScopeSource(snapshot, "rm:PC2/f000:0", "shared-memory"), { id: "rm:PC2/f000:0", name: "rm:PC2/f000:0", state: "absent" });
		assert.deepEqual(describeScopeSource(snapshot, "rm:PC2/f000:0", "gadget"), { id: "rm:PC2/f000:0", name: "rm:PC2/f000:0", state: "absent" });
		assert.deepEqual(detailScopeOf({ detailScope: { sources: ["rm:PC2/f000:0", "f000:0"] } }), ["rm:PC2/f000:0", "f000:0"], "the parser keeps it");
	});

	it("a key that does not resolve, or an orphan row, names no source", () => {
		assert.deepEqual(detailSourceOf(snapshot, CPU2, "shared-memory"), { id: "f000:0", name: "CPU [#0]: AMD Ryzen" });
		assert.equal(detailSourceOf(snapshot, "gone:0:1", "shared-memory"), undefined);
		assert.equal(detailSourceOf(snapshot, "orphan:0:1", "shared-memory"), undefined);
	});

	it("a linked alias names the source of the measurement it resolves to", () => {
		const alias = reading("g:GPU:GPU Temp", 1, "GPU Temp", { aliasOf: GPU });
		const linked: SensorSnapshot = { ...snapshot, readings: [...readings, alias], byKey: new Map([...snapshot.byKey, [alias.key, alias]]) };
		assert.equal(detailSourceOf(linked, alias.key, "shared-memory")?.id, "e000:1");
	});

	it("names come from the live snapshot, or not at all", () => {
		assert.equal(detailSourceNameOf(snapshot, "e000:1", "shared-memory"), "GPU [#0]: NVIDIA");
		assert.equal(detailSourceNameOf(snapshot, "abcd:9", "shared-memory"), undefined);
	});
});

describe("how the panel lists a scope entry", () => {
	// The same machine as HWiNFO's Gadget registry would publish it: the
	// sensors by name only, no ids.
	const gadgetReadings = [reading("g:CPU [#0]: AMD Ryzen:Tctl", 0, "Tctl"), reading("g:GPU [#0]: NVIDIA:GPU Temp", 1, "GPU Temp")];
	const gadget: SensorSnapshot = { ...snapshot, sensors: sensors.map((s) => ({ ...s, id: 0, instance: s.index })), readings: gadgetReadings, byKey: new Map(gadgetReadings.map((r) => [r.key, r])) };

	it("an entry on the active data source is named; one saved with the other is said to be, never gone", () => {
		assert.deepEqual(describeScopeSource(snapshot, "e000:1", "shared-memory"), { id: "e000:1", name: "GPU [#0]: NVIDIA", state: "present" });
		assert.deepEqual(describeScopeSource(gadget, "GPU [#0]: NVIDIA", "gadget"), { id: "GPU [#0]: NVIDIA", name: "GPU [#0]: NVIDIA", state: "present" });
		// HWiNFO runs on Gadget now; the entry was saved under Shared Memory.
		assert.deepEqual(describeScopeSource(gadget, "e000:1", "gadget"), { id: "e000:1", name: null, state: "other-source", savedWith: "shared-memory" });
		// The other way round: saved under Gadget, the sensor is here by name.
		assert.deepEqual(describeScopeSource(snapshot, "GPU [#0]: NVIDIA", "shared-memory"), { id: "GPU [#0]: NVIDIA", name: "GPU [#0]: NVIDIA", state: "other-source", savedWith: "gadget" });
	});

	it("absent only when the data source matches and nothing carries the id; no data says so", () => {
		assert.deepEqual(describeScopeSource(snapshot, "abcd:9", "shared-memory"), { id: "abcd:9", name: null, state: "absent" });
		assert.deepEqual(describeScopeSource(gadget, "Old sensor", "gadget"), { id: "Old sensor", name: "Old sensor", state: "absent" });
		assert.deepEqual(describeScopeSource(snapshot, "Old sensor", "shared-memory"), { id: "Old sensor", name: "Old sensor", state: "absent" }, "a name no sensor carries is not a Gadget entry");
		assert.deepEqual(describeScopeSource(null, "e000:1", undefined), { id: "e000:1", name: null, state: "no-data" });
		assert.deepEqual(describeScopeSource(null, "Old sensor", undefined), { id: "Old sensor", name: "Old sensor", state: "no-data" });
	});

	it("the payload is read-only JSON and carries the data source only where it tells something", () => {
		const payload = detailScopePayloadOf("ctx", true, { id: "GPU [#0]: NVIDIA", name: "GPU [#0]: NVIDIA" }, ["e000:1", "GPU [#0]: NVIDIA"], gadget, "gadget");
		assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
			event: "detailScope",
			context: "ctx",
			onDetailPage: true,
			opener: { id: "GPU [#0]: NVIDIA", name: "GPU [#0]: NVIDIA" },
			sources: [
				{ id: "e000:1", name: null, state: "other-source", savedWith: "shared-memory" },
				{ id: "GPU [#0]: NVIDIA", name: "GPU [#0]: NVIDIA", state: "present" }
			]
		});
	});
});

describe("the hidden-or-shown decision", () => {
	const session = { id: "s1" };
	const view = (over: Partial<DetailPageView<typeof session>>): DetailPageView<typeof session> => ({
		session,
		appearedUnder: session,
		surfaceLive: true,
		sessionPending: false,
		recentlyLeft: false,
		openerSource: "f000:0",
		...over
	});
	const scoped = { detailScope: { sources: ["e000:1"] } };

	it("on a detail page: the slots are live, or the key appeared while the session waited for them", () => {
		assert.equal(onDetailPage(view({})), true);
		assert.equal(onDetailPage(view({ surfaceLive: false, sessionPending: true })), true);
		assert.equal(onDetailPage(view({ surfaceLive: false, sessionPending: true, appearedUnder: undefined })), false, "the opener's own page");
		assert.equal(onDetailPage(view({ surfaceLive: false, sessionPending: false })), false, "every slot left: another page");
		assert.equal(onDetailPage(view({ session: undefined, appearedUnder: undefined })), false);
	});

	it("a scoped key hides on another source's page and shows on its own", () => {
		assert.equal(scopedKeyHidden(scoped, view({})), true);
		assert.equal(scopedKeyHidden(scoped, view({ openerSource: "e000:1" })), false);
		assert.equal(scopedKeyHidden(scoped, view({ openerSource: undefined })), true, "an unknown opener source shows nothing scoped");
		assert.equal(scopedKeyHidden(scoped, view({ session: undefined, appearedUnder: undefined })), false, "off a detail page it is an ordinary key");
		assert.equal(scopedKeyHidden(scoped, view({ session: undefined, recentlyLeft: true })), true, "through the switch beat after Back it stays blank");
		assert.equal(scopedKeyHidden(scoped, view({ session: undefined, recentlyLeft: false })), false);
	});

	it("absent, junk and empty scopes and the Back tile never hide", () => {
		for (const settings of [{}, { detailScope: null }, { detailScope: { sources: [] } }, { detailScope: { sources: "e000:1" } }, { detailScope: { sources: ["e000:1"] }, detailRole: "back" }]) {
			assert.equal(scopedKeyHidden(settings, view({})), false, JSON.stringify(settings));
		}
	});
});

describe("the navigator names the opener's source", () => {
	it("captured at entry, followed on fresh data, kept while the reading does not resolve", async () => {
		const changed: string[] = [];
		const nav = new DetailNavigator({ switchProfile: () => Promise.resolve(), onChanged: (d) => changed.push(d), setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>, clearTimer: () => undefined, now: () => 1_000_000 });
		await nav.enter({ deviceId: "dev", deviceType: 0, settings: { readingKey: CPU }, snapshot, source: "shared-memory" });
		assert.deepEqual(nav.openerSourceFor("dev"), { id: "f000:0", name: "CPU [#0]: AMD Ryzen" });
		const before = changed.length;
		nav.refresh("dev", snapshot, "shared-memory");
		assert.equal(changed.length, before, "the same source: no repaint");
		const gone: SensorSnapshot = { ...snapshot, readings: [], byKey: new Map() };
		nav.refresh("dev", gone, "shared-memory");
		assert.equal(nav.openerSourceFor("dev")?.id, "f000:0", "rides its last value");
		const gadget: SensorSnapshot = { ...snapshot, sensors: [{ index: 0, id: 0, instance: 0, name: "CPU [#0]: AMD Ryzen" }, sensors[1] as (typeof sensors)[number]] };
		nav.refresh("dev", gadget, "gadget");
		assert.equal(nav.openerSourceFor("dev")?.id, "CPU [#0]: AMD Ryzen", "a fallback to Gadget names it by name");
		assert.equal(changed.length, before + 1);
		await nav.enter({ deviceId: "cold", deviceType: 0, settings: { detailMode: "custom", detailKeys: [CPU2], readingKey: "gone:0:1" }, snapshot, source: "shared-memory" });
		assert.equal(nav.openerSourceFor("cold"), undefined, "an opener whose own reading is missing names no source");
		assert.equal(nav.openerSourceFor("nobody"), undefined);
	});
});

describe("a scoped key on the shared detail page, through the production action", () => {
	let mono = 0;
	const restores: Array<() => void> = [];
	beforeEach(() => {
		mono = 1_000_000;
		for (const m of [mock.method(poller, "retain", () => {}), mock.method(poller, "release", () => {}), mock.method(poller, "getStatus", () => ok), mock.method(poller, "subscribeSeries", () => {})]) {
			restores.push(() => m.mock.restore());
		}
	});
	afterEach(() => {
		for (const restore of restores.splice(0)) restore();
	});

	function bed() {
		const nav = new DetailNavigator({
			switchProfile: () => Promise.resolve(),
			onChanged: () => action.repaint(),
			setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>,
			clearTimer: () => undefined,
			now: () => mono
		});
		const action = new SensorReadingAction(nav);
		const images = new Map<string, string[]>();
		const writes: Array<{ id: string; settings: unknown }> = [];
		const alerts: string[] = [];
		const handles = new Map<string, ReturnType<typeof handleFor>>();
		function handleFor(id: string, column: number) {
			return {
				id, device: { id: "dev", name: "fixture" }, coordinates: { column, row: 1 },
				isKey: () => true, isDial: () => false,
				setImage: async (image: string) => void (images.get(id) ?? images.set(id, []).get(id))?.push(image),
				setSettings: async (settings: unknown) => void writes.push({ id, settings }),
				showAlert: async () => void alerts.push(id)
			};
		}
		Object.defineProperty(action, "actions", { get: () => [...handles.values()] });
		(action as unknown as { pushPanelPreview(): void }).pushPanelPreview = () => {};
		// Each key's settings as it appeared, for the press payloads the app
		// sends with every key down and up.
		const appeared = new Map<string, ReadingSettings>();
		const appear = (id: string, column: number, settings: ReadingSettings) => {
			const handle = handleFor(id, column);
			handles.set(id, handle);
			appeared.set(id, settings);
			action.onWillAppear({ action: handle, payload: { settings } } as never);
		};
		const press = async (id: string) => {
			const handle = handles.get(id);
			const payload = { settings: appeared.get(id) ?? {}, isInMultiAction: false };
			await action.onKeyDown({ action: handle, payload } as never);
			action.onKeyUp({ action: handle, payload } as never);
		};
		const disappear = (id: string) => {
			const handle = handles.get(id);
			handles.delete(id);
			action.onWillDisappear({ action: handle, payload: { settings: {} } } as never);
		};
		// The SVG each key last sent, decoded from the image data URI.
		const last = (id: string) => {
			const image = images.get(id)?.at(-1);
			return image === undefined ? undefined : decodeURIComponent(image.replace(/^data:image\/svg\+xml,/, ""));
		};
		return { nav, action, images, writes, alerts, appear, press, disappear, last };
	}

	const blank = (): string => renderDetailBlankKey(resolvePalette(loadThemes(), getDeckTheme(), null, "normal"));
	const gpuOnly: ReadingSettings = { readingKey: GPU, detailScope: { sources: ["e000:1"] } };

	it("blank and inert on another source's page, live on its own, and no write but the user's own press", async () => {
		const f = bed();
		await f.nav.enter({ deviceId: "dev", deviceType: 0, settings: { readingKey: CPU }, snapshot, source: "shared-memory" });
		f.appear("placed", 3, gpuOnly);
		f.appear("plain", 4, { readingKey: GPU });
		assert.equal(f.last("placed"), blank(), "the CPU page shows the GPU-scoped key as space");
		assert.notEqual(f.last("plain"), blank(), "an unscoped key shows on every detail page");
		await f.press("placed");
		assert.equal(f.writes.length, 0, "a hidden key's press cycles nothing and writes nothing");
		assert.equal(f.alerts.length, 0, "and opens nothing");
		assert.equal(f.last("placed"), blank());
		// Slots register: still the CPU page.
		f.nav.surfaceSeen("dev");
		f.action.repaint();
		assert.equal(f.last("placed"), blank());

		// Back: through the switch beat the scoped key stays blank, so the
		// app's replay of its last image is right on any page.
		await f.nav.leave("dev");
		assert.equal(f.last("placed"), blank());
		f.disappear("placed");
		f.disappear("plain");
		mono += 5_000;

		await f.nav.enter({ deviceId: "dev", deviceType: 0, settings: { readingKey: GPU }, snapshot, source: "shared-memory" });
		f.appear("placed", 3, gpuOnly);
		const live = f.last("placed");
		assert.ok(live !== undefined && live !== blank(), "the GPU page shows it live");
		await f.press("placed");
		assert.equal(f.writes.length, 1, "its own page: the press cycles the stat as always");
		assert.deepEqual((f.writes[0]?.settings as ReadingSettings).statMode, "min");
		assert.deepEqual((f.writes[0]?.settings as ReadingSettings).detailScope, { sources: ["e000:1"] }, "the scope rides along untouched");
	});

	it("off a detail page a scoped key is an ordinary key", async () => {
		const f = bed();
		f.appear("placed", 3, gpuOnly);
		assert.notEqual(f.last("placed"), blank());
		await f.press("placed");
		assert.equal(f.writes.length, 1);
	});

	it("a key on the opener's own page stays live until the switch removes it", async () => {
		const f = bed();
		f.appear("origin", 2, gpuOnly);
		await f.nav.enter({ deviceId: "dev", deviceType: 0, settings: { readingKey: CPU }, snapshot, source: "shared-memory" });
		assert.notEqual(f.last("origin"), blank(), "appeared before the session: not on the detail page");
	});

	it("a key that appears after every slot left (a profile changed by hand) is not on the detail page", async () => {
		const f = bed();
		await f.nav.enter({ deviceId: "dev", deviceType: 0, settings: { readingKey: CPU }, snapshot, source: "shared-memory" });
		f.nav.surfaceSeen("dev");
		f.nav.surfaceGone("dev");
		f.appear("elsewhere", 1, gpuOnly);
		assert.notEqual(f.last("elsewhere"), blank());
	});

	it("an explicit scope edit on the page takes effect at once", async () => {
		const f = bed();
		await f.nav.enter({ deviceId: "dev", deviceType: 0, settings: { readingKey: CPU }, snapshot, source: "shared-memory" });
		f.nav.surfaceSeen("dev");
		f.appear("placed", 3, { readingKey: GPU });
		assert.notEqual(f.last("placed"), blank());
		const handle = { id: "placed", device: { id: "dev", name: "fixture" }, coordinates: { column: 3, row: 1 }, isKey: () => true, isDial: () => false, setImage: async () => {}, setSettings: async () => {} };
		f.action.onDidReceiveSettings({ action: handle, payload: { settings: { readingKey: GPU, detailScope: { sources: ["f000:0"] } } } } as never);
		assert.notEqual(f.last("placed"), blank(), "scoped to this page's source: still shown");
		f.action.onDidReceiveSettings({ action: handle, payload: { settings: { readingKey: GPU, detailScope: { sources: ["e000:1"] } } } } as never);
		assert.equal(f.last("placed"), blank(), "scoped elsewhere: blank here");
		assert.equal(f.writes.length, 0, "receiving settings writes nothing");
	});
});
