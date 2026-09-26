/**
 * Deterministic fixtures for the property-inspector labs (scripts/pi-lab.mjs
 * and scripts/e2e-pi-panels.mjs). SAMPLE DATA: the sources and values below
 * are invented to look like a HWiNFO sensor tree (generic "Example" hardware
 * names, fixed values, frozen history); they are never a live reading and
 * every capture made from them is labeled as simulated.
 *
 * The tree deliberately carries the hard cases: the same label under two
 * sources (Drive Temperature twice, "CPU" as both a source and a
 * motherboard label), a valid zero, a valid negative, a Yes/No reading,
 * data units, and non-ASCII text.
 */

const T = { temp: 1, volt: 2, fan: 3, current: 4, power: 5, clock: 6, usage: 7, other: 8 };

const SOURCES = [
	{
		name: "CPU [#0]: Example 16-Core Processor: Enhanced",
		id: 0xf0000300,
		readings: [
			["CPU (Tctl/Tdie)", "°C", 67.4, T.temp],
			["CPU Die (average)", "°C", 63.1, T.temp],
			["CPU CCD1 (Tdie)", "°C", 64.9, T.temp],
			["CPU CCD2 (Tdie)", "°C", 58.2, T.temp],
			["CPU Package Power", "W", 142.6, T.power],
			["Core 0 Clock (perf #2/3)", "MHz", 5412, T.clock],
			["Core 1 Clock (perf #1/1)", "MHz", 5387, T.clock],
			["Total CPU Usage", "%", 23.5, T.usage],
			["CPU Core Voltage (SVI3 TFN)", "V", 1.281, T.volt],
			["Thermal Throttling (HTC)", "Yes/No", 0, T.other]
		]
	},
	{
		name: "GPU [#0]: Example Graphics 24GB",
		id: 0xe0002000,
		readings: [
			["GPU Temperature", "°C", 58.0, T.temp],
			["GPU Hot Spot Temperature", "°C", 71.3, T.temp],
			["GPU Memory Junction Temperature", "°C", 66.0, T.temp],
			["GPU Power", "W", 212.4, T.power],
			["GPU Clock", "MHz", 2610, T.clock],
			["GPU Core Load", "%", 64.0, T.usage],
			["GPU Fan1", "RPM", 1480, T.fan],
			["GPU Fan2", "RPM", 0, T.fan],
			["GPU Memory Allocated", "MB", 9812, T.other]
		]
	},
	{
		name: "Motherboard: Example X670 (Nuvoton NCT6799D)",
		id: 0xf7006600,
		readings: [
			["CPU", "°C", 52.0, T.temp],
			["System", "°C", 38.0, T.temp],
			["Chipset", "°C", 55.0, T.temp],
			["CPU Fan", "RPM", 1150, T.fan],
			["AIO Pump", "RPM", 2750, T.fan],
			["Vcore", "V", 1.276, T.volt],
			["Vcore Offset", "V", -0.025, T.volt]
		]
	},
	{
		name: "Drive [#0]: Example NVMe SSD 2TB",
		id: 0xf0200100,
		readings: [
			["Drive Temperature", "°C", 44.0, T.temp],
			["Drive Temperature 2", "°C", 51.0, T.temp],
			["Read Rate", "MB/s", 12.4, T.other],
			["Write Rate", "MB/s", 3.1, T.other]
		]
	},
	{
		name: "Drive [#1]: Example NVMe SSD 1TB",
		id: 0xf0200101,
		readings: [["Drive Temperature", "°C", 39.0, T.temp]]
	},
	{
		name: "Network: Example 2.5GbE",
		id: 0xf0300000,
		readings: [
			["Current DL rate", "KB/s", 845.2, T.other],
			["Current UP rate", "KB/s", 96.0, T.other]
		]
	},
	{
		name: "System: Example Desktop",
		id: 0xf0100000,
		readings: [
			["Physical Memory Used", "MB", 18342, T.other],
			["Physical Memory Load", "%", 57.3, T.usage],
			["Virtual Memory Committed", "MB", 24410, T.other],
			["Température ambiante (Zürich)", "°C", 24.5, T.temp]
		]
	}
];

const hex = (n) => n.toString(16).padStart(8, "0");

/** The fixture snapshot: SHM-style stable keys, fixed min/max/avg. */
export function sampleSnapshot() {
	const sensors = [];
	const readings = [];
	SOURCES.forEach((source, index) => {
		sensors.push({ index, id: source.id, instance: 0, name: source.name });
		source.readings.forEach(([label, unit, value, type], i) => {
			const spread = unit === "Yes/No" ? 0 : Math.abs(value) * 0.12;
			readings.push({
				key: `${hex(source.id)}:0:${(0x1000000 + i).toString(16)}`,
				type,
				sensorIndex: index,
				id: 0x1000000 + i,
				label,
				unit,
				value,
				valueMin: unit === "Yes/No" ? 0 : value - spread,
				valueMax: unit === "Yes/No" ? 1 : value + spread,
				valueAvg: unit === "Yes/No" ? 0 : value - spread / 4
			});
		});
	});
	return { pollTime: 1_000_000, version: 1, revision: 1, sensors, readings, byKey: new Map(readings.map((r) => [r.key, r])) };
}

/** A synthetic tree of `count` readings for the scale runs: long and
 * non-ASCII labels, duplicate labels across sources, 25 readings per source. */
export function scaledSnapshot(count) {
	const sensors = [];
	const readings = [];
	const perSource = 25;
	for (let i = 0; i < count; i++) {
		const sourceIndex = Math.floor(i / perSource);
		if (sensors.length <= sourceIndex) {
			sensors.push({ index: sourceIndex, id: 0xa0000000 + sourceIndex, instance: 0, name: `Source ${sourceIndex}: Example Controller ${sourceIndex % 7 === 0 ? "Überwachung Ünïcödé" : "Unit"} #${sourceIndex}` });
		}
		const n = i % perSource;
		const label = n % 5 === 0 ? `Temperature Sensor ${n} with a deliberately long descriptive label` : n % 5 === 1 ? "Drive Temperature" : `Reading ${n} (${i})`;
		readings.push({ key: `${hex(0xa0000000 + sourceIndex)}:0:${(0x1000000 + n).toString(16)}`, type: 1 + (i % 7), sensorIndex: sourceIndex, id: 0x1000000 + n, label, unit: "°C", value: 40 + (i % 30), valueMin: 35, valueMax: 75, valueAvg: 50 });
	}
	return { pollTime: 1_000_000, version: 1, revision: 1, sensors, readings, byKey: new Map(readings.map((r) => [r.key, r])) };
}

/** Looks a fixture reading's key up by source index and label. */
export function keyOf(snapshot, sourceIndex, label) {
	const hit = snapshot.readings.find((r) => r.sensorIndex === sourceIndex && r.label === label);
	if (hit === undefined) throw new Error(`fixture has no "${label}" in source ${sourceIndex}`);
	return hit.key;
}

/** Frozen sparkline history for a reading (seeded, never random). */
export function frozenHistory(value, length = 40) {
	return Array.from({ length }, (_, i) => value + Math.sin(i / 3) * Math.max(1, Math.abs(value) * 0.06) + ((i * 7) % 5) * 0.2);
}

const FUTURE_BLOB = { nested: { deep: [1, "two", { three: 3 }] }, keep: "yes" };

/**
 * The named scenarios. `page` picks the panel; `data` is ok | stale |
 * unavailable; settings and globals seed the stores. `futureBlob` rides in
 * every configured seed so any lossy write shows up at once.
 */
export function scenarios() {
	const snap = sampleSnapshot();
	const cpu = keyOf(snap, 0, "CPU (Tctl/Tdie)");
	const cpuPower = keyOf(snap, 0, "CPU Package Power");
	const ccd1 = keyOf(snap, 0, "CPU CCD1 (Tdie)");
	const ccd2 = keyOf(snap, 0, "CPU CCD2 (Tdie)");
	const gpu = keyOf(snap, 1, "GPU Temperature");
	const hot = keyOf(snap, 1, "GPU Hot Spot Temperature");
	const gpuPower = keyOf(snap, 1, "GPU Power");
	const gpuFan2 = keyOf(snap, 1, "GPU Fan2");
	const drive0 = keyOf(snap, 3, "Drive Temperature");
	const drive1 = keyOf(snap, 4, "Drive Temperature");
	const offset = keyOf(snap, 2, "Vcore Offset");
	const throttle = keyOf(snap, 0, "Thermal Throttling (HTC)");
	const globals = { theme: "void", typeAccents: "on" };
	return {
		keys: { cpu, cpuPower, ccd1, ccd2, gpu, hot, gpuPower, gpuFan2, drive0, drive1, offset, throttle },
		list: {
			// --- Sensor Reading key ---
			"key-empty": { page: "sensor-reading.html", data: "ok", settings: {}, globals: {} },
			"key-configured": { page: "sensor-reading.html", data: "ok", settings: { readingKey: cpu, displayMode: "sparkline", warnValue: "80", critValue: "90", futureBlob: FUTURE_BLOB }, globals },
			"key-dense": {
				page: "sensor-reading.html",
				data: "ok",
				settings: { readingKey: cpu, secondaryReadingKey: gpu, quadReadingKey3: drive0, quadReadingKey4: cpuPower, keyLayout: "quad", label: "CPU", secondaryLabel: "GPU", quadLabel3: "SSD", quadLabel4: "PWR", quadColors: ["#4CC2FF", "#FF7E8E", "#38CD89", "#D4AB33"], futureBlob: FUTURE_BLOB },
				globals
			},
			"key-triple": { page: "sensor-reading.html", data: "ok", settings: { readingKey: ccd1, secondaryReadingKey: ccd2, quadReadingKey3: cpu, keyLayout: "triple", label: "CCD1", secondaryLabel: "CCD2", quadLabel3: "Core Max", futureBlob: FUTURE_BLOB }, globals },
			"key-custom-dim": { page: "sensor-reading.html", data: "ok", settings: { readingKey: gpu, theme: "ember", textMode: "custom", textColor: "#8A2B2B", textDimSecondary: true, futureBlob: FUTURE_BLOB }, globals },
			"key-inherited": { page: "sensor-reading.html", data: "ok", settings: { readingKey: gpu, futureBlob: FUTURE_BLOB }, globals: { theme: "midnight", typeAccents: "on", textMode: "dim" } },
			"key-alert": { page: "sensor-reading.html", data: "ok", settings: { readingKey: hot, warnValue: "60", critValue: "70", displayMode: "bar", futureBlob: FUTURE_BLOB }, globals },
			"key-unavailable": { page: "sensor-reading.html", data: "unavailable", settings: { readingKey: cpu, warnValue: "80", futureBlob: FUTURE_BLOB }, globals },
			"key-stale": { page: "sensor-reading.html", data: "stale", settings: { readingKey: cpu, futureBlob: FUTURE_BLOB }, globals },
			"key-missing": { page: "sensor-reading.html", data: "ok", settings: { readingKey: "f0099999:0:1000000", label: "Old CPU", theme: "forest", futureBlob: FUTURE_BLOB }, globals },
			"key-back": { page: "sensor-reading.html", data: "ok", settings: { readingKey: cpu, detailRole: "back", pressBehavior: "open-details", futureBlob: FUTURE_BLOB }, globals },
			"key-details": {
				page: "sensor-reading.html",
				data: "ok",
				settings: { readingKey: cpu, pressBehavior: "tap-cycle-hold-details", detailMode: "custom", detailKeys: [gpu, hot, gpuPower, drive0, drive1], detailTiles: [{ size: 2, labels: ["", ""], colors: [null, null], cellLabels: true, futureTile: { x: 1 } }], detailTitle: "Gaming", futureBlob: FUTURE_BLOB },
				globals
			},
			"key-zero-negative": { page: "sensor-reading.html", data: "ok", settings: { readingKey: offset, secondaryReadingKey: gpuFan2, keyLayout: "dual", futureBlob: FUTURE_BLOB }, globals },
			// --- Sensor Dial ---
			"dial-empty": { page: "sensor-dial.html", data: "ok", settings: {}, globals: {} },
			"dial-configured": { page: "sensor-dial.html", data: "ok", settings: { readingKey: gpu, rotationKeys: [gpu, hot, gpuPower], warnValue: "80", critValue: "90", alertUnit: "°C", futureBlob: FUTURE_BLOB }, globals },
			"dial-groups": {
				page: "sensor-dial.html",
				data: "ok",
				settings: {
					readingKey: hot,
					controlPreset: "elite",
					dialView: "overview",
					rotationKeys: [cpu, ccd1, gpu, hot],
					rotationGroups: [
						{ name: "CPU", keys: [cpu, ccd1], futureGroupField: "keep" },
						{ name: "GPU", keys: [gpu, hot] }
					],
					rotationNames: { [hot]: "Hot Spot" },
					futureBlob: FUTURE_BLOB
				},
				globals
			},
			"dial-alert": { page: "sensor-dial.html", data: "ok", settings: { readingKey: hot, rotationKeys: [gpu, hot], dialView: "overview", warnValue: "60", critValue: "70", alertUnit: "°C", futureBlob: FUTURE_BLOB }, globals },
			"dial-custom-gestures": { page: "sensor-dial.html", data: "ok", settings: { readingKey: cpu, controlPreset: "custom", touchZones: "two", gestureTap: "pin", linkId: "cpu-dial", futureBlob: FUTURE_BLOB }, globals },
			"dial-unavailable": { page: "sensor-dial.html", data: "unavailable", settings: { readingKey: gpu, futureBlob: FUTURE_BLOB }, globals },
			"dial-missing": { page: "sensor-dial.html", data: "ok", settings: { readingKey: "f0099999:0:1000000", rotationKeys: ["f0099999:0:1000000", gpu], futureBlob: FUTURE_BLOB }, globals },
			// --- HWiNFO Control ---
			"control-default": { page: "control.html", data: "ok", settings: {}, globals },
			"control-reset": { page: "control.html", data: "ok", settings: { command: "resetStats", target: "cpu-dial", resetScope: "all", futureBlob: FUTURE_BLOB }, globals },
			// --- Detail slot ---
			"slot-back": { page: "detail-slot.html", data: "ok", settings: { slot: "back" }, globals },
			"slot-reading": { page: "detail-slot.html", data: "ok", settings: { slot: "reading", index: 3 }, globals }
		}
	};
}

export { FUTURE_BLOB };
