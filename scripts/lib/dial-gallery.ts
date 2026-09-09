/** Fixed sample data, not a hardware capture. No renderer/color overrides. */
import { composeDialSvg, type DialRenderState } from "../../src/actions/sensor-dial";
import { SensorType, type Reading, type SensorSnapshot } from "../../src/hwinfo/types";
import { SessionStatsStore } from "../../src/stats";

export function dialGalleryFixture(view: "tworow" | "overview", sensorValueColors = false): { state: DialRenderState; snapshot: SensorSnapshot; historyOf: (key: string) => readonly number[] } {
	const sample = (id: number, label: string, type: SensorType, unit: string, value: number, valueMin: number, valueMax: number): Reading => ({
		key: `31:0:${id.toString(16)}`, sensorIndex: 0, id, label, type, unit, value, valueMin, valueMax, valueAvg: value
	});
	const readings = view === "overview" ? [
		sample(1, "CPU Temp", SensorType.Temperature, "°C", 71.4, 51, 79),
		sample(2, "GPU Temp", SensorType.Temperature, "°C", 76.2, 48, 82),
		sample(3, "Pump", SensorType.Fan, "RPM", 2850, 2700, 2900)
	] : [
		sample(4, "GPU Power", SensorType.Power, "W", 316.4, 64.5, 349),
		sample(5, "GPU Load", SensorType.Usage, "%", 98, 12, 100)
	];
	const snapshot: SensorSnapshot = {
		pollTime: 1, version: 2, revision: 0,
		sensors: [{ index: 0, id: 0x31, instance: 0, name: "Sample sensors" }],
		readings, byKey: new Map(readings.map((r) => [r.key, r]))
	};
	const stats = new SessionStatsStore();
	const histories = new Map<string, readonly number[]>();
	for (const r of readings) {
		const history = [r.valueMin, r.valueMax, (r.valueMin + r.value) / 2, r.value * 0.9, r.value];
		histories.set(r.key, history);
		for (const value of history) stats.sample(r.key, value);
	}
	const state: DialRenderState = {
		settings: { readingKey: readings[0]!.key, rotationKeys: readings.map((r) => r.key), dialView: view, theme: "void", textMode: "theme", overviewLabels: "full", sensorValueColors },
		stats, statMode: "current", overlay: null, pinned: false, cyclePaused: false
	};
	return { state, snapshot, historyOf: (key: string) => histories.get(key) ?? [] };
}

export function renderGalleryDial(view: "tworow" | "overview", sensorValueColors = false): string {
	const { state, snapshot, historyOf } = dialGalleryFixture(view, sensorValueColors);
	return composeDialSvg(state, { state: "ok", snapshot, source: "shared-memory" }, historyOf);
}
