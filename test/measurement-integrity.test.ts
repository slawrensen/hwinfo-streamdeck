import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { compose, type ReadingSettings } from "../src/actions/sensor-reading";
import { composeDialSvg, SensorDialAction, type InstanceState } from "../src/actions/sensor-dial";
import { composeChunkFace, type DetailFaceContext } from "../src/detail/detail-faces";
import type { DeviceDetailState } from "../src/detail/navigation";
import { IDLE_GESTURE } from "../src/gestures";
import { gadgetReadingKey } from "../src/hwinfo/gadget-identity";
import { applyReadingLinks, parseReadingLinks } from "../src/hwinfo/reading-links";
import type { Reading, SensorSnapshot } from "../src/hwinfo/types";
import { poller, type PollerStatus } from "../src/poller";
import { SessionStatsStore } from "../src/stats";
import { convertUnit, readingStatBadge, statValue } from "../src/ui/format";
import { applyGlobalThemeSettings, effectiveTextFor } from "../src/ui/theme-store";
import { loadThemes } from "../src/ui/themes";
import { contrast } from "./wcag";

const link = { sharedMemory: "f0001234:0:1000001", gadget: "g:GPU:Temperature", unit: "°C", sensorType: 1 };
const reading: Reading = { key: link.sharedMemory, sensorIndex: 0, id: 1, label: "Temperature", type: 1, unit: "°C", value: 40, valueMin: 30, valueMax: 60, valueAvg: 42 };
const snapshot = (r: Reading = reading, pollTime = 1): SensorSnapshot => ({ pollTime, valueRevision: pollTime, version: 1, revision: 0, sensors: [{ index: 0, id: 1, instance: 0, name: "GPU" }], readings: [r], byKey: new Map([[r.key, r]]) });

describe("readability through production action composition", () => {
	for (const [theme, palette] of Object.entries(loadThemes().themes)) {
		for (const dialView of ["single", "overview", "tworow"]) {
			it(`${theme} ${dialView}: built-in dim and alert values meet 4.5 on their actual surfaces`, () => {
				for (const level of ["normal", "warn", "crit"] as const) {
					const state: InstanceState = {
						settings: { readingKey: reading.key, dialView, theme, textMode: "dim", warnValue: level === "normal" ? "50" : "30", critValue: level === "crit" ? "35" : "60", alertUnit: "°C" },
						stats: new SessionStatsStore(), statMode: "current", lastFeedback: "", nextCycleAt: null, cyclePaused: false, pinned: false, gesture: IDLE_GESTURE, overlay: null, overlayTimer: null, deviceId: "test", pendingAlertUnitStamp: false, rowSeries: new Set()
					};
					const svg = composeDialSvg(state, { state: "ok", source: "shared-memory", snapshot: snapshot() });
					const value = svg.match(/<text[^>]*font-weight="700" fill="(#[A-Fa-f0-9]{6})">40(?:\.0)?(?:<tspan|<\/text>)/);
					assert.ok(value, "the actual composed numeric text exists");
					assert.ok(contrast(value[1]!, dialView === "tworow" ? palette.track : palette.bg) >= 4.5, `${theme} ${dialView} ${level}: ${value[1]}`);
					for (const element of svg.matchAll(/<(?:text|tspan)\b[^>]*\bfill="(#[A-Fa-f0-9]{6})"[^>]*>([^<]*)/g)) {
						if (!/[0-9°]/.test(element[2]!)) continue;
						const background = dialView === "tworow" && /y="40"/.test(element[0]) ? palette.track : palette.bg;
						assert.ok(contrast(element[1]!, background) >= 4.5, `${theme} ${dialView} ${level} numeric/unit run: ${element[2]}`);
					}
					if (level !== "normal") assert.match(svg, new RegExp(`data-severity="${level}"`));
					else assert.doesNotMatch(svg, /data-severity/);
				}
			});
		}
	}
	it("all key layouts pass primary severity to the renderer without losing values", () => {
		const extra = { ...reading, key: "f0001234:0:1000002", id: 2, value: 55 };
		const source = { ...snapshot(), readings: [reading, extra], byKey: new Map([[reading.key, reading], [extra.key, extra]]) };
		for (const keyLayout of ["single", "dual", "triple", "quad"]) {
			for (const level of ["warn", "crit"]) {
				const svg = compose({ readingKey: reading.key, secondaryReadingKey: extra.key, keyLayout, warnValue: "30", critValue: level === "crit" ? "35" : "60" }, { state: "ok", source: "shared-memory", snapshot: source });
				assert.match(svg, new RegExp(`data-severity="${level}"`));
				assert.match(svg, />40(?:\.0)?(?:<tspan|<\/text>)/);
			}
		}
	});
});

describe("refutation: identity and explicit links", () => {
	it("reserved names, empty names and spaces produce injective keys", () => {
		const parts = ["", "GPU", "GPU:0", "GPU~1", "GPU %", "a:b", "a", "b:c", "a\nb", "é", "\"[]", " Two words ", "Reading 0", "Reading 1023"];
		const keys = parts.flatMap((source) => parts.map((label) => gadgetReadingKey(source, label)));
		assert.equal(new Set(keys).size, parts.length ** 2);
		assert.equal(gadgetReadingKey("Two words", "CPU Temp"), "g:Two words:CPU Temp");
	});
	it("literal fallback names cannot reuse either historical key format", () => {
		for (const sensor of ["Source", "Source:with delimiter"]) {
			for (let i = 0; i < 1024; i++) {
				const label = `Reading ${i}`;
				const key = gadgetReadingKey(sensor, label);
				assert.notEqual(key, `g:${sensor}:${label}`);
				assert.notEqual(key, `g2:${Buffer.from(JSON.stringify([sensor, label])).toString("base64url")}`);
				assert.deepEqual(JSON.parse(Buffer.from(key.slice(3), "base64url").toString()), ["named", sensor, label]);
			}
		}
	});
	it("fallback-like names outside the exact historical spellings retain their keys", () => {
		for (const label of ["Reading 00", "Reading 1024", "Reading 1\n", "Reading 1\r", "Reading 1\r\n", "Reading 1\u2028", "Reading 1\u2029"]) {
			const original = /[:~\r\n]/.test(label) ? `g2:${Buffer.from(JSON.stringify(["Source", label])).toString("base64url")}` : `g:Source:${label}`;
			assert.equal(gadgetReadingKey("Source", label), original);
		}
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

describe("dial appearance synchronizes history before its first frame", () => {
	type DialState = InstanceState;
	type Appearance = Parameters<SensorDialAction["onWillAppear"]>[0];
	type Lifecycle = {
		instances: Map<string, DialState>;
		hidden: Map<string, { at: number; state: DialState }>;
		traceLifecycle(): void;
		pushTriggerDescriptions(): void;
		renderAll(status: PollerStatus): void;
		onWillAppear(event: Appearance): void;
	};
	function firstFrame(status: PollerStatus, retained: "hidden" | "replayed" | "new", dialView: string): { svg: string; stats: ReturnType<SessionStatsStore["get"]>; overlay: string | undefined } {
		// Exercise the production action handler while replacing only the SDK
		// sink and shared poller's native acquisition boundary. A cold retain
		// makes the new snapshot available before the state is restored.
		applyGlobalThemeSettings({ theme: "void" });
		const settings = Object.freeze({ readingKey: reading.key, dialView, label: "My CPU", decimals: "1" as const });
		const previous: DialState = { settings, stats: new SessionStatsStore(), statMode: "min", lastFeedback: "old frame", nextCycleAt: null, cyclePaused: false, pinned: false, gesture: IDLE_GESTURE, overlay: null, overlayTimer: null, deviceId: "fixture", pendingAlertUnitStamp: false, rowSeries: new Set() };
		previous.stats.observe({ ...reading, value: 45 }, snapshot({ ...reading, value: 45 }), "shared-memory");
		const action = Object.create(SensorDialAction.prototype) as Lifecycle;
		action.instances = new Map(retained === "replayed" ? [["ctx", previous]] : []);
		action.hidden = new Map(retained === "hidden" ? [["ctx", { at: Date.now(), state: previous }]] : []);
		action.traceLifecycle = () => {};
		action.pushTriggerDescriptions = () => {};
		let svg = "";
		let renderedStats: ReturnType<SessionStatsStore["get"]>;
		let overlay: string | undefined;
		action.renderAll = (current) => {
			const state = action.instances.get("ctx");
			assert.ok(state);
			renderedStats = state.stats.get(reading.key);
			overlay = state.overlay?.text;
			svg = composeDialSvg(state, current);
		};
		let latest: PollerStatus = retained === "replayed" ? status : { state: "unavailable", reason: "not-running", message: "idle fixture" };
		const retain = mock.method(poller, "retain", () => { latest = status; });
		const getStatus = mock.method(poller, "getStatus", () => latest);
		let settingsWrites = 0;
		try {
			action.onWillAppear({ action: { id: "ctx", device: { id: "fixture", name: "Fixture" }, isDial: () => true, coordinates: { column: 0, row: 0 }, setSettings: () => { settingsWrites++; } }, payload: { settings } } as unknown as Appearance);
			assert.equal(retain.mock.callCount(), retained === "replayed" ? 0 : 1);
			assert.equal(settingsWrites, 0, "history synchronization never rewrites action settings");
			assert.equal(action.instances.get("ctx")?.settings, settings);
			return { svg, stats: renderedStats, overlay };
		} finally {
			const timer = action.instances.get("ctx")?.overlayTimer;
			if (timer) clearTimeout(timer);
			retain.mock.restore();
			getStatus.mock.restore();
		}
	}
	for (const dialView of ["single", "overview", "tworow"]) {
		for (const retained of ["hidden", "replayed"] as const) {
			it(`${retained} ${dialView}: native-unit change resets MIN before the first frame`, () => {
				const current = { ...reading, value: 113, unit: "°F" };
				const result = firstFrame({ state: "ok", source: "shared-memory", snapshot: snapshot(current, 2) }, retained, dialView);
				assert.deepEqual(result.stats, { min: 113, max: 113, sum: 113, count: 1 });
				assert.match(result.svg, />113(?:\.0)?(?: °F)?</);
				assert.doesNotMatch(result.svg, />45(?:\.0)?(?: °F)?</);
				assert.equal(result.overlay, "stats reset: units changed");
			});
			it(`${retained} ${dialView}: the same observation preserves history without double counting`, () => {
				const current = { ...reading, value: 45 };
				const result = firstFrame({ state: "ok", source: "shared-memory", snapshot: snapshot(current) }, retained, dialView);
				assert.deepEqual(result.stats, { min: 45, max: 45, sum: 45, count: 1 });
				assert.equal(result.overlay, undefined);
			});
			it(`${retained} ${dialView}: a backend change resets local MIN before rendering`, () => {
				const current = { ...reading, value: 80, statistics: "unavailable" as const };
				const result = firstFrame({ state: "ok", source: "gadget", snapshot: { ...snapshot(current, 2), freshnessRevision: 1 } }, retained, dialView);
				assert.deepEqual(result.stats, { min: 80, max: 80, sum: 80, count: 1 });
				assert.equal(result.overlay, "stats reset: source changed");
			});
		}
		it(`${dialView}: a new appearance seeds its first observed local sample`, () => {
			const result = firstFrame({ state: "ok", source: "shared-memory", snapshot: snapshot() }, "new", dialView);
			assert.equal(result.stats?.count, 1);
			assert.equal(result.stats?.min, reading.value);
		});
	}
	for (const status of [
		{ state: "stale", source: "gadget", snapshot: snapshot(), staleForMs: 16_000 },
		{ state: "unavailable", reason: "not-running", message: "fixture feed absent" },
		{ state: "ok", source: "shared-memory", snapshot: snapshot({ ...reading, value: Number.NaN }) },
		{ state: "ok", source: "shared-memory", snapshot: { ...snapshot(), readings: [], byKey: new Map<string, Reading>() } }
	] satisfies PollerStatus[]) {
		it(`${status.state}: restored unavailable or missing history is cleared before rendering`, () => {
			const result = firstFrame(status, "hidden", "single");
			assert.equal(result.stats, undefined);
			assert.doesNotMatch(result.svg, />45(?:\.0)?(?: °C)?</);
		});
	}
});

describe("a data gap ends dial sessions and says so once on the first live frame", () => {
	type Tick = { instances: Map<string, InstanceState>; hidden: Map<string, { at: number; state: InstanceState }>; renderAll(): void; onPollerTick(status: PollerStatus): void };
	function dial(): { action: Tick; state: InstanceState } {
		const state: InstanceState = { settings: { readingKey: reading.key }, stats: new SessionStatsStore(), statMode: "current", lastFeedback: "", nextCycleAt: null, cyclePaused: false, pinned: false, gesture: IDLE_GESTURE, overlay: null, overlayTimer: null, deviceId: "fixture", pendingAlertUnitStamp: false, rowSeries: new Set() };
		const action = Object.create(SensorDialAction.prototype) as Tick;
		action.instances = new Map([["ctx", state]]);
		action.hidden = new Map();
		action.renderAll = () => {};
		Object.defineProperty(action, "actions", { get: () => [] });
		return { action, state };
	}
	const ok = (value: number, pollTime: number): PollerStatus => ({ state: "ok", source: "shared-memory", snapshot: snapshot({ ...reading, value }, pollTime) });
	for (const gap of [
		{ state: "stale", source: "shared-memory", snapshot: snapshot(), staleForMs: 16_000 },
		{ state: "unavailable", reason: "not-running", message: "fixture feed absent" }
	] satisfies PollerStatus[]) {
		it(`${gap.state}: the collapsed min/max is explained once, then normal sampling resumes`, () => {
			const { action, state } = dial();
			try {
				action.onPollerTick(ok(40, 1));
				action.onPollerTick(ok(60, 2));
				assert.deepEqual(state.stats.get(reading.key), { min: 40, max: 60, sum: 100, count: 2 });
				const overlayText = (): string | undefined => (state.overlay as { text: string } | null)?.text;
				action.onPollerTick(gap);
				assert.equal(state.stats.get(reading.key), undefined, "a frozen or absent producer ends the session");
				assert.equal(overlayText(), undefined, "the status face is showing; nothing to explain yet");
				action.onPollerTick(ok(50, 3));
				assert.equal(overlayText(), "stats reset: data gap");
				assert.deepEqual(state.stats.get(reading.key), { min: 50, max: 50, sum: 50, count: 1 });
				state.overlay = null;
				action.onPollerTick(ok(51, 4));
				assert.equal(state.overlay, null, "said once");
				assert.equal(state.stats.get(reading.key)?.count, 2);
			} finally {
				if (state.overlayTimer) clearTimeout(state.overlayTimer);
			}
		});
	}
	for (const route of ["hidden", "replayed"] as const) {
		it(`${route}: a dial that was ${route === "hidden" ? "off-screen" : "announced again"} across the gap still gets its one explanation`, () => {
			type Lifecycle = Tick & { traceLifecycle(): void; pushTriggerDescriptions(): void; onWillAppear(event: unknown): void; onWillDisappear(event: unknown): void };
			const { action, state } = dial();
			const lifecycle = action as unknown as Lifecycle;
			lifecycle.traceLifecycle = () => {};
			lifecycle.pushTriggerDescriptions = () => {};
			let latest: PollerStatus = ok(40, 1);
			const retain = mock.method(poller, "retain", () => {});
			const release = mock.method(poller, "release", () => {});
			const getStatus = mock.method(poller, "getStatus", () => latest);
			const event = { action: { id: "ctx", device: { id: "fixture", name: "Fixture" }, isDial: () => false, coordinates: { column: 0, row: 0 } }, payload: { settings: state.settings } };
			try {
				action.onPollerTick(ok(40, 1));
				action.onPollerTick(ok(60, 2));
				if (route === "hidden") lifecycle.onWillDisappear(event);
				latest = { state: "unavailable", reason: "not-running", message: "fixture feed absent" };
				action.onPollerTick(latest);
				latest = ok(50, 3);
				lifecycle.onWillAppear(event);
				const returned = action.instances.get("ctx");
				assert.ok(returned);
				assert.equal(returned.stats.get(reading.key)?.min, 50, "the session restarted");
				action.onPollerTick(latest);
				assert.equal((returned.overlay as { text: string } | null)?.text, "stats reset: data gap");
			} finally {
				for (const entry of action.instances.values()) if (entry.overlayTimer) clearTimeout(entry.overlayTimer);
				retain.mock.restore();
				release.mock.restore();
				getStatus.mock.restore();
			}
		});
	}
	it("a dial that appears while the source is still out owes the explanation too", () => {
		type Lifecycle = Tick & { traceLifecycle(): void; pushTriggerDescriptions(): void; onWillAppear(event: unknown): void; onWillDisappear(event: unknown): void };
		const { action, state } = dial();
		const lifecycle = action as unknown as Lifecycle;
		lifecycle.traceLifecycle = () => {};
		lifecycle.pushTriggerDescriptions = () => {};
		let latest: PollerStatus = ok(40, 1);
		const retain = mock.method(poller, "retain", () => {});
		const release = mock.method(poller, "release", () => {});
		const getStatus = mock.method(poller, "getStatus", () => latest);
		const event = { action: { id: "ctx", device: { id: "fixture", name: "Fixture" }, isDial: () => false, coordinates: { column: 0, row: 0 } }, payload: { settings: state.settings } };
		try {
			action.onPollerTick(ok(40, 1));
			lifecycle.onWillDisappear(event);
			// Nothing else keeps the poller ticking: the gap is first seen at the appear.
			latest = { state: "stale", source: "shared-memory", snapshot: snapshot(), staleForMs: 16_000 };
			lifecycle.onWillAppear(event);
			const returned = action.instances.get("ctx");
			assert.ok(returned);
			assert.equal(returned.stats.get(reading.key), undefined);
			action.onPollerTick(ok(50, 3));
			assert.equal((returned.overlay as { text: string } | null)?.text, "stats reset: data gap");
		} finally {
			for (const entry of action.instances.values()) if (entry.overlayTimer) clearTimeout(entry.overlayTimer);
			retain.mock.restore();
			release.mock.restore();
			getStatus.mock.restore();
		}
	});
	it("a dial with no session yet has nothing to explain", () => {
		const { action, state } = dial();
		try {
			action.onPollerTick({ state: "unavailable", reason: "not-running", message: "fixture" });
			action.onPollerTick(ok(50, 3));
			assert.equal(state.overlay, null);
		} finally {
			if (state.overlayTimer) clearTimeout(state.overlayTimer);
		}
	});
});

describe("dial selection validates retained history before rendering", () => {
	type DialState = InstanceState;
	type SettingsEvent = Parameters<SensorDialAction["onDidReceiveSettings"]>[0];
	type DialHandle = SettingsEvent["action"];
	type Selection = {
		instances: Map<string, DialState>;
		hidden: Map<string, { at: number; state: DialState }>;
		pushTriggerDescriptions(): void;
		sampleStats(state: DialState, snapshot: SensorSnapshot, source: string): void;
		renderAll(status: PollerStatus): void;
		adoptReading(action: DialHandle, state: DialState, key: string): Promise<void>;
		onDidReceiveSettings(event: SettingsEvent): void;
	};
	function fixture() {
		const second = { ...reading, key: "f0001234:0:1000002", id: 2, value: 70 };
		const complete = (current: Reading, pollTime = 3): SensorSnapshot => ({ ...snapshot(current, pollTime), readings: [current, second], byKey: new Map([[current.key, current], [second.key, second]]) });
		const state: DialState = { settings: { readingKey: reading.key, decimals: "1" }, stats: new SessionStatsStore(), statMode: "current", lastFeedback: "", nextCycleAt: null, cyclePaused: false, pinned: false, gesture: IDLE_GESTURE, overlay: null, overlayTimer: null, deviceId: "fixture", pendingAlertUnitStamp: false, rowSeries: new Set() };
		const action = Object.create(SensorDialAction.prototype) as Selection;
		action.instances = new Map([["ctx", state]]);
		action.hidden = new Map();
		action.pushTriggerDescriptions = () => {};
		// A accumulates 45/65 C, then becomes an untracked stray while B is
		// selected. The production sampler deliberately preserves its history.
		action.sampleStats(state, complete({ ...reading, value: 45 }, 1), "shared-memory");
		action.sampleStats(state, complete({ ...reading, value: 65 }, 2), "shared-memory");
		state.settings = { ...state.settings, readingKey: second.key };
		action.sampleStats(state, complete({ ...reading, value: 65 }, 2), "shared-memory");
		let latest: PollerStatus = { state: "ok", source: "shared-memory", snapshot: complete({ ...reading, value: 65 }, 2) };
		let visible = true;
		let write: () => Promise<void> = () => Promise.resolve();
		let writes = 0;
		const frames: { svg: string; stats: ReturnType<SessionStatsStore["get"]>; overlay: string | undefined }[] = [];
		const handle = {
			id: "ctx", isDial: () => true,
			setSettings: () => { writes++; return write(); },
			setFeedback: (payload: { canvas: string }) => {
				const stats = state.stats.get(reading.key);
				frames.push({ svg: decodeURIComponent(payload.canvas.slice("data:image/svg+xml,".length)), stats: stats === undefined ? undefined : { ...stats }, overlay: state.overlay?.text });
				return Promise.resolve();
			}
		} as unknown as DialHandle;
		Object.defineProperty(action, "actions", { get: () => visible ? [handle] : [] });
		const getStatus = mock.method(poller, "getStatus", () => latest);
		return {
			action, state, handle, frames, complete,
			status: () => latest,
			setStatus: (status: PollerStatus) => { latest = status; },
			setWrite: (next: () => Promise<void>) => { write = next; },
			writes: () => writes,
			disappear: () => { visible = false; action.instances.delete("ctx"); },
			settings: (dialView = "single", fahrenheit = false) => action.onDidReceiveSettings({ action: handle, payload: { settings: { readingKey: reading.key, dialView, fahrenheit, decimals: "1" } } } as SettingsEvent),
			close: () => { if (state.overlayTimer) clearTimeout(state.overlayTimer); getStatus.mock.restore(); }
		};
	}

	for (const route of ["settings", "adopt"] as const) {
		for (const dialView of ["single", "overview", "tworow"]) {
			for (const domain of ["same", "unit", "source"] as const) {
				it(`${route} ${dialView} validates ${domain} domain before its first SDK frame`, async () => {
					const f = fixture();
					try {
						const current = { ...reading, value: domain === "unit" ? 113 : domain === "source" ? 80 : 65, unit: domain === "unit" ? "°F" : "°C" };
						f.setStatus({ state: "ok", source: domain === "source" ? "gadget" : "shared-memory", snapshot: f.complete(current, domain === "same" ? 2 : 3) });
						if (route === "settings") f.settings(dialView);
						else {
							f.state.settings = { ...f.state.settings, dialView };
							await f.action.adoptReading(f.handle, f.state, reading.key);
						}
						const first = f.frames[0];
						assert.ok(first, "production renderAll must emit the first SDK frame");
						assert.deepEqual(first.stats, domain === "same" ? { min: 45, max: 65, sum: 110, count: 2 } : { min: current.value, max: current.value, sum: current.value, count: 1 });
						assert.equal(first.overlay, domain === "same" ? undefined : `stats reset: ${domain === "unit" ? "units" : "source"} changed`);
						assert.match(first.svg, new RegExp(`>${current.value}(?:\\.0)?(?: °[CF])?<`));
						if (domain !== "same") assert.doesNotMatch(first.svg, /[▼▲]\s*45(?:\.0)?/);
						f.action.renderAll(f.status());
						assert.deepEqual(f.state.stats.get(reading.key), first.stats, "a repaint cannot count the same observation again");
						assert.equal(f.writes(), route === "settings" ? 0 : 1);
					} finally { f.close(); }
				});
			}
		}
	}

	for (const boundary of ["missing", "source", "unit", "type", "nonfinite", "binding"] as const) {
		it(`a retained unselected session ends at an observed ${boundary} boundary before reselection`, () => {
			const f = fixture();
			try {
				const changed = {
					...reading,
					value: boundary === "nonfinite" ? Number.NaN : 999,
					unit: boundary === "unit" ? "°F" : reading.unit,
					type: boundary === "type" ? 5 : reading.type
				};
				let intermediate = f.complete(changed, 3);
				if (boundary === "missing") {
					const readings = intermediate.readings.filter((entry) => entry.key !== reading.key);
					intermediate = { ...intermediate, readings, byKey: new Map(readings.map((entry) => [entry.key, entry])) };
				}
				if (boundary === "binding") {
					// The saved key now stands for a different measurement (a
					// re-paired link): the entry is an alias of another key.
					const repaired = { ...changed, aliasOf: "f0009999:0:1000009" };
					intermediate = { ...intermediate, readings: [repaired, ...intermediate.readings.slice(1)], byKey: new Map([[repaired.key, repaired], ...[...intermediate.byKey].filter(([key]) => key !== repaired.key)]) };
				}
				f.action.sampleStats(f.state, intermediate, boundary === "source" ? "gadget" : "shared-memory");
				assert.equal(f.state.stats.get(reading.key), undefined, "clear the retained history at the boundary, while B is selected");

				// A returns to its original source/unit/type while B remains
				// selected. Merely validating A must not start sampling it.
				const restored = f.complete({ ...reading, value: 50 }, 4);
				f.action.sampleStats(f.state, restored, "shared-memory");
				assert.equal(f.state.stats.get(reading.key), undefined, "off-selection values must not seed a replacement session");
				f.setStatus({ state: "ok", source: "shared-memory", snapshot: restored });
				f.settings();
				assert.deepEqual(f.frames[0]?.stats, { min: 50, max: 50, sum: 50, count: 1 });
				assert.doesNotMatch(f.frames[0]?.svg ?? "", /[▼▲]\s*(?:45|65)(?:\.0)?/);
			} finally { f.close(); }
		});
	}

	it("ordinary rotation preserves retained history without counting off-selection samples", () => {
		const f = fixture();
		try {
			f.action.sampleStats(f.state, f.complete({ ...reading, value: 999 }, 3), "shared-memory");
			assert.deepEqual(f.state.stats.get(reading.key), { min: 45, max: 65, sum: 110, count: 2 });
			const restored = f.complete({ ...reading, value: 50 }, 4);
			f.action.sampleStats(f.state, restored, "shared-memory");
			assert.deepEqual(f.state.stats.get(reading.key), { min: 45, max: 65, sum: 110, count: 2 });
			f.setStatus({ state: "ok", source: "shared-memory", snapshot: restored });
			f.settings();
			assert.deepEqual(f.frames[0]?.stats, { min: 45, max: 65, sum: 160, count: 3 });
		} finally { f.close(); }
	});

	it("display-only conversion preserves the physical session during reselection", () => {
		const f = fixture();
		try {
			f.settings("single", true);
			assert.deepEqual(f.frames[0]?.stats, { min: 45, max: 65, sum: 110, count: 2 });
			assert.match(f.frames[0]?.svg ?? "", /▼ 113\.0/);
			assert.equal(f.frames[0]?.overlay, undefined);
		} finally { f.close(); }
	});

	it("direct repaint clears stale history and validates newly displayed native units", () => {
		const f = fixture();
		try {
			f.state.settings = { ...f.state.settings, readingKey: reading.key };
			f.state.statMode = "min";
			f.setStatus({ state: "ok", source: "shared-memory", snapshot: f.complete({ ...reading, value: 113, unit: "°F" }) });
			f.action.renderAll(f.status());
			assert.equal(f.frames[0]?.stats?.min, 113);
			assert.match(f.frames[0]?.svg ?? "", />113\.0</);
			f.setStatus({ state: "stale", source: "shared-memory", snapshot: f.complete(reading), staleForMs: 20_000 });
			f.action.renderAll(f.status());
			assert.equal(f.state.stats.size, 0);
		} finally { f.close(); }
	});

	it("selection completion uses the latest source instead of an older snapshot captured before the host write", async () => {
		const f = fixture();
		try {
			let finish: (() => void) | undefined;
			f.setWrite(() => new Promise<void>((resolve) => { finish = resolve; }));
			const pending = f.action.adoptReading(f.handle, f.state, reading.key);
			assert.ok(finish);
			const current = { ...reading, value: 113, unit: "°F" };
			f.setStatus({ state: "ok", source: "shared-memory", snapshot: f.complete(current) });
			finish();
			await pending;
			assert.equal(f.frames[0]?.stats?.min, 113);
			assert.match(f.frames[0]?.svg ?? "", />113\.0</);
		} finally { f.close(); }
	});

	it("a pending selection does not render an action that disappeared", async () => {
		const f = fixture();
		try {
			let finish: (() => void) | undefined;
			f.setWrite(() => new Promise<void>((resolve) => { finish = resolve; }));
			const pending = f.action.adoptReading(f.handle, f.state, reading.key);
			assert.ok(finish);
			f.disappear();
			finish();
			await pending;
			assert.equal(f.frames.length, 0);
		} finally { f.close(); }
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
		// Gaining an alias for the same measurement is not a pairing change.
		assert.equal(store.observe({ ...reading, value: 50, linkedKeys: [reading.key, link.gadget] }, { ...snapshot(), bindingRevision: 2 }, "shared-memory"), undefined);
		assert.equal(store.get(reading.key)?.min, 40);
		// The saved key standing for another measurement is.
		assert.equal(store.observe({ ...reading, value: 55, aliasOf: "f0009999:0:1000009" }, { ...snapshot(), bindingRevision: 3 }, "shared-memory"), "binding");
		assert.equal(store.get(reading.key)?.min, 55);
		assert.equal(store.observe({ ...reading, value: 70, type: 5, aliasOf: "f0009999:0:1000009" }, { ...snapshot(), bindingRevision: 3 }, "shared-memory"), "type");
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
		type DialState = InstanceState;
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
