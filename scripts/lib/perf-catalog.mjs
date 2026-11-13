/**
 * The synthetic large catalog the perf harness (scripts/perf-plugin.mjs)
 * and its producer (scripts/fake-hwinfo-catalog.mjs) share: N sensors of M
 * readings each, in the classic 264/316 Shared Memory layout, with a fixed
 * mix of reading types and a deterministic value per tick. Both sides build
 * the list from the same function, so a reading key a workload binds always
 * names a reading the producer publishes.
 *
 * Pure: no I/O. The tick value is a function of (reading, tick) only, so
 * two runs of the same workload see the same numbers in the same order.
 */

export const CATALOG_SENSOR_BASE = 0xf0007000;
export const HEADER_SIZE = 44;
export const SENSOR_SIZE = 264;
export const ENTRY_SIZE = 316;

/** HWiNFO SensorType values (src/hwinfo/types.ts). */
const TYPES = [
	{ type: 1, name: "Temp", unit: "°C", base: 45, amplitude: 12 },
	{ type: 2, name: "Volt", unit: "V", base: 1.2, amplitude: 0.05 },
	{ type: 3, name: "Fan", unit: "RPM", base: 1200, amplitude: 300 },
	{ type: 4, name: "Current", unit: "A", base: 8, amplitude: 3 },
	{ type: 5, name: "Power", unit: "W", base: 40, amplitude: 25 },
	{ type: 6, name: "Clock", unit: "MHz", base: 4200, amplitude: 600 },
	{ type: 7, name: "Usage", unit: "%", base: 35, amplitude: 30 },
	{ type: 8, name: "Other", unit: "MB", base: 8000, amplitude: 500 }
];

/** Every fifth reading holds still, as many real HWiNFO readings do
 * between polls (limits, configured values, idle counters). */
export function isMoving(index) {
	return index % 5 !== 0;
}

/**
 * The catalog: `sensors` sensors of `perSensor` readings. Reading ids are
 * (type << 24) | ordinal within the sensor, the shape HWiNFO uses, so keys
 * look like the live ones (`f0007000:0:1000003`).
 */
export function catalogReadings({ sensors = 25, perSensor = 24 } = {}) {
	if (!Number.isSafeInteger(sensors) || sensors < 1 || !Number.isSafeInteger(perSensor) || perSensor < 1) {
		throw new RangeError("sensors and perSensor must be positive integers");
	}
	const out = [];
	for (let s = 0; s < sensors; s++) {
		const sensorId = CATALOG_SENSOR_BASE + s * 0x10;
		for (let r = 0; r < perSensor; r++) {
			const kind = TYPES[(s + r) % TYPES.length];
			const id = ((kind.type << 24) | r) >>> 0;
			const index = out.length;
			out.push({
				index,
				sensorIndex: s,
				sensorId,
				type: kind.type,
				id,
				label: `${kind.name} ${s}.${r}`,
				unit: kind.unit,
				base: kind.base,
				amplitude: kind.amplitude,
				moving: isMoving(index),
				key: `${sensorId.toString(16)}:0:${id.toString(16)}`
			});
		}
	}
	return out;
}

export function catalogSensors(readings) {
	const seen = new Map();
	for (const reading of readings) {
		if (!seen.has(reading.sensorIndex)) seen.set(reading.sensorIndex, { index: reading.sensorIndex, id: reading.sensorId, name: `Perf Sensor ${reading.sensorIndex}` });
	}
	return [...seen.values()];
}

/** The value a reading publishes at a tick: a slow triangle wave per
 * reading, phase-shifted by its index; a still reading keeps its base. */
export function catalogValue(reading, tick) {
	if (!reading.moving) return reading.base;
	const period = 20 + (reading.index % 7) * 4;
	const phase = (tick + reading.index) % period;
	const half = period / 2;
	const unit = phase < half ? phase / half : (period - phase) / half;
	return Number((reading.base - reading.amplitude / 2 + unit * reading.amplitude).toFixed(3));
}

export function catalogMappingSize(readings) {
	return HEADER_SIZE + catalogSensors(readings).length * SENSOR_SIZE + readings.length * ENTRY_SIZE;
}

function cstr(buf, offset, width, text) {
	buf.fill(0, offset, offset + width);
	buf.write(text, offset, width - 1, "latin1");
}

/**
 * Writes one complete classic-layout image of the catalog at `tick` into
 * `buf` (at least catalogMappingSize bytes). `pollTimeS` is the header's
 * poll stamp in seconds.
 */
export function composeCatalog(buf, readings, tick, pollTimeS) {
	const sensors = catalogSensors(readings);
	buf.writeUInt32LE(0x53695748, 0); // "HWiS" active
	buf.writeUInt32LE(1, 4);
	buf.writeUInt32LE(0, 8);
	buf.writeBigInt64LE(BigInt(pollTimeS), 12);
	buf.writeUInt32LE(HEADER_SIZE, 20);
	buf.writeUInt32LE(SENSOR_SIZE, 24);
	buf.writeUInt32LE(sensors.length, 28);
	const entries = HEADER_SIZE + sensors.length * SENSOR_SIZE;
	buf.writeUInt32LE(entries, 32);
	buf.writeUInt32LE(ENTRY_SIZE, 36);
	buf.writeUInt32LE(readings.length, 40);
	sensors.forEach((sensor, i) => {
		const s = HEADER_SIZE + i * SENSOR_SIZE;
		buf.writeUInt32LE(sensor.id, s);
		buf.writeUInt32LE(0, s + 4);
		cstr(buf, s + 8, 128, sensor.name);
		cstr(buf, s + 136, 128, sensor.name);
	});
	readings.forEach((reading, i) => {
		const e = entries + i * ENTRY_SIZE;
		const value = catalogValue(reading, tick);
		buf.writeUInt32LE(reading.type, e);
		buf.writeUInt32LE(reading.sensorIndex, e + 4);
		buf.writeUInt32LE(reading.id, e + 8);
		cstr(buf, e + 12, 128, reading.label);
		cstr(buf, e + 140, 128, reading.label);
		cstr(buf, e + 268, 16, reading.unit);
		buf.writeDoubleLE(value, e + 284);
		buf.writeDoubleLE(reading.base - reading.amplitude, e + 292);
		buf.writeDoubleLE(reading.base + reading.amplitude, e + 300);
		buf.writeDoubleLE(reading.base, e + 308);
	});
}
