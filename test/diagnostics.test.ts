// Support-report redaction rules. The report may name models and hashed
// identifiers; it must never carry raw device IDs, device names, or sensor
// values. These tests lock that contract.
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { SensorDialAction, type DialSettings, type InstanceState } from "../src/actions/sensor-dial";
import { alertStore } from "../src/alerts/store";
import { buildSupportReport, registerDiagnostics } from "../src/diagnostics";
import { deviceCapabilities } from "../src/devices";
import { gadgetReadingKey } from "../src/hwinfo/gadget-identity";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import { poller, type PollerStatus } from "../src/poller";
import { describeGestureState, hashId, recentEvents, trace } from "../src/recorder";
import { applyGlobalThemeSettings } from "../src/ui/theme-store";

const BASE = { pluginVersion: "1.1.10.0", appVersion: "7.4.2.22730", platformVersion: "10.0.19044" };

describe("hashId", () => {
	it("is deterministic, short, and never the raw id", () => {
		const raw = "A1B2C3D4E5F60708090A0B0C0D0E0F10";
		const hash = hashId(raw);
		assert.match(hash, /^[0-9a-f]{12}$/);
		assert.equal(hash, hashId(raw));
		assert.notEqual(hashId("other"), hash);
		assert.ok(!raw.includes(hash) && !hash.includes(raw.slice(0, 8).toLowerCase()));
	});

	it("erases the user text embedded in gadget reading keys and link IDs", () => {
		// Gadget-source keys are g:<sensor name>:<reading label>, both
		// user-renamable in HWiNFO; they must never appear raw in a trace.
		const gadgetKey = "g:AMD Ryzen 9 5950X:CPU - office rig";
		const hash = hashId(gadgetKey);
		assert.match(hash, /^[0-9a-f]{12}$/);
		assert.ok(!hash.includes("Ryzen") && !hash.includes("office"));
	});
});

describe("buildSupportReport", () => {
	it("lists devices by model and hashed id only", () => {
		const rawId = "RAWDEVICEID001";
		deviceCapabilities.ingest(rawId, { type: 13, columns: 9, rows: 4 });
		const report = buildSupportReport(BASE);
		assert.ok(!report.includes(rawId), "raw device id leaked");
		assert.ok(report.includes(hashId(rawId)));
		assert.ok(report.includes("Stream Deck + XL"));
		assert.ok(report.includes("9x4"));
	});

	it("is valid JSON and carries the version/app basics", () => {
		const parsed = JSON.parse(buildSupportReport(BASE)) as Record<string, unknown>;
		assert.equal(parsed.plugin, BASE.pluginVersion);
		assert.equal(parsed.streamDeckApp, BASE.appVersion);
		assert.ok(Array.isArray(parsed.devices));
		assert.ok(Array.isArray(parsed.recentEvents));
	});

	it("includes registered sections and survives a throwing provider", () => {
		registerDiagnostics("healthy", () => ({ answer: 42 }));
		registerDiagnostics("broken", () => {
			throw new Error("boom");
		});
		const parsed = JSON.parse(buildSupportReport(BASE)) as Record<string, unknown>;
		assert.deepEqual(parsed.healthy, { answer: 42 });
		assert.match(String(parsed.broken), /unavailable/);
	});
});

describe("event trace ring", () => {
	it("keeps only the most recent events, oldest first", () => {
		for (let i = 0; i < 30; i++) {
			trace({ event: `e${i}` });
		}
		const events = recentEvents();
		assert.equal(events.length, 24);
		assert.equal(events[0]?.event, "e6");
		assert.equal(events.at(-1)?.event, "e29");
	});

	it("stamps wall and monotonic times", () => {
		trace({ event: "stamped" });
		const last = recentEvents().at(-1);
		assert.equal(typeof last?.wall, "number");
		assert.equal(typeof last?.mono, "number");
	});
});

describe("describeGestureState", () => {
	it("compacts the machine state for traces", () => {
		assert.equal(describeGestureState({ downAt: null, rotatedWhileDown: false }), "idle");
		assert.equal(describeGestureState({ downAt: 123.4, rotatedWhileDown: false }), "down@123");
		assert.equal(describeGestureState({ downAt: 123.4, rotatedWhileDown: true }), "down@123+rotated");
	});
});

describe("a Sensor Dial on a Gadget reading in the support report", () => {
	// A Gadget key carries HWiNFO's sensor and reading names, and a person
	// can rename a sensor to anything (here, the PC's name). A plain hash of
	// such a key falls to a short word list, so the support report names a
	// dial's reading by a hash keyed fresh for each plugin process.
	const PC = "OFFICE-PC";
	const LABELS = ["CPU (Tctl/Tdie)", "CPU Temperature", "CPU Package", "GPU Temperature", "GPU Hot Spot", "Motherboard", "System", "Drive Temperature"];
	const CPU_TEMP = gadgetReadingKey(PC, LABELS[0] as string);
	const GPU_TEMP = gadgetReadingKey(PC, LABELS[3] as string);

	function gadgetSnapshot(): SensorSnapshot {
		const readings: Reading[] = [
			{ key: CPU_TEMP, type: SensorType.Temperature, sensorIndex: 0, id: 0x1000000, label: LABELS[0] as string, unit: "°C", value: 55, valueMin: 55, valueMax: 55, valueAvg: 55 },
			{ key: GPU_TEMP, type: SensorType.Temperature, sensorIndex: 0, id: 0x1000001, label: LABELS[3] as string, unit: "°C", value: 48, valueMin: 48, valueMax: 48, valueAvg: 48 }
		];
		return {
			pollTime: 1,
			version: 1,
			revision: 1,
			sensors: [{ index: 0, id: 0, instance: 0, name: PC }],
			readings,
			byKey: new Map(readings.map((r) => [r.key, r]))
		};
	}

	/** What anyone holding a pasted report can try offline: a short list of
	 * custom names, alone and times common reading labels. */
	function dictionary(): Map<string, string> {
		const names = ["DESKTOP", "GAMING-PC", "HOME-PC", "LAPTOP", "MEDIA-PC", "OFFICE-PC", "STUDIO", "WORKSTATION"];
		const byHash = new Map<string, string>();
		for (const name of names) {
			byHash.set(hashId(name), name);
			for (const label of LABELS) byHash.set(hashId(gadgetReadingKey(name, label)), name);
		}
		return byHash;
	}

	/** Every string in the report a dictionary entry matches, by JSON path. */
	function recovered(value: unknown, byHash: ReadonlyMap<string, string>, path = "report"): string[] {
		if (typeof value === "string") {
			const name = byHash.get(value);
			return name === undefined ? [] : [`${path} = ${value} -> ${name}`];
		}
		if (Array.isArray(value)) return value.flatMap((item, index) => recovered(item, byHash, `${path}[${index}]`));
		if (typeof value === "object" && value !== null) return Object.entries(value).flatMap(([key, item]) => recovered(item, byHash, `${path}.${key}`));
		return [];
	}

	it("lets no dictionary of names recover the renamed sensor from the dial section or the event ring", async () => {
		type Internals = { instances: Map<string, InstanceState>; hidden: Map<string, { at: number; state: InstanceState }> };
		// A deck theme already chosen: no legacy migration write to the host.
		applyGlobalThemeSettings({ theme: "void" });
		const status: PollerStatus = { state: "ok", source: "gadget", snapshot: gadgetSnapshot() };
		let mono = 9_000_000;
		const restores = [
			mock.method(performance, "now", () => mono),
			mock.method(poller, "retain", () => {}),
			mock.method(poller, "release", () => {}),
			mock.method(poller, "getStatus", () => status),
			mock.method(poller, "isHolding", () => false)
		];
		const action = new SensorDialAction();
		const internals = action as unknown as Internals;
		(action as unknown as { pushPanelPreview(): void }).pushPanelPreview = () => {};
		const handle = {
			id: "dial-gadget",
			device: { id: "dev-gadget", name: "fixture" },
			coordinates: { column: 0, row: 0 },
			isDial: () => true,
			isKey: () => false,
			setFeedback: async () => {},
			setTriggerDescription: async () => {},
			setSettings: async () => {}
		};
		Object.defineProperty(action, "actions", { get: () => (internals.instances.has(handle.id) ? [handle] : []) });
		const settings: DialSettings = { readingKey: CPU_TEMP, rotationKeys: [CPU_TEMP, GPU_TEMP] };
		try {
			action.onWillAppear({ action: handle, payload: { settings } } as never);
			// One turn: the gesture event carries the selection before, the
			// step's selection event carries before and after.
			mono += 1000;
			await action.onDialRotate({ action: handle, payload: { coordinates: handle.coordinates, ticks: 1, pressed: false } } as never);
			assert.equal(internals.instances.get(handle.id)?.settings.readingKey, GPU_TEMP, "the turn stepped to the other reading");

			const text = buildSupportReport(BASE);
			assert.ok(!text.includes(PC), "the sensor's name never appears as plain text");
			assert.ok(!text.includes(CPU_TEMP) && !text.includes(GPU_TEMP), "nor does the Gadget key that carries it");
			const report = JSON.parse(text) as Record<string, unknown>;
			assert.ok(Array.isArray(report.recentEvents) && report.recentEvents.some((event) => (event as { event?: string }).event === "selection"), "the ring holds the step");

			const hits = recovered(report, dictionary());
			assert.deepEqual(hits, [], `the name falls to a dictionary of ${8 * 8 + 8} hashes:\n${hits.join("\n")}`);
			// The same reading still reads as the same value across one report.
			const step = (report.recentEvents as { event?: string; selectionBefore?: string; selectionAfter?: string }[]).filter((event) => event.event === "selection").at(-1);
			const dial = (report.sensorDial as { visible: { selection: string | null }[] }).visible[0];
			assert.ok(step?.selectionAfter !== undefined && step.selectionAfter === dial?.selection, "the step's selection matches the dial section's");
			assert.notEqual(step.selectionBefore, step.selectionAfter);
		} finally {
			for (const state of [...internals.instances.values(), ...[...internals.hidden.values()].map((entry) => entry.state)]) {
				if (state.overlayTimer !== null) clearTimeout(state.overlayTimer);
			}
			alertStore.forget(handle.id);
			for (const m of restores) m.mock.restore();
		}
	});
});
