// Diagnostic --import preload for an unchanged built plugin. The parent owns
// workload setup, shipping-byte verification, and the child's normal socket exit.
import { monitorEventLoopDelay } from "node:perf_hooks";

const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
const originalClearTimeout = globalThis.clearTimeout;
const originalSetImmediate = globalThis.setImmediate;
const timingEnabled = process.env.HWSM_SCALING_TIMING !== "0";
const pollText = process.env.HWSM_SCALING_POLL_MS;
const pollMs = pollText === "250" ? 250 : pollText === "1000" ? 1000 : null;
const configurationError = pollMs === null
	? "HWSM_SCALING_POLL_MS must be exactly 250 or 1000"
	: null;
const cap = 50_000;
const registrations = [];
const activeTimers = new Map();
let nextTimerId = 1;
let registrationOverflow = false;
let measurement = null;

// hrtime has one host-monotonic origin across Node processes. Adding each
// process's performance.timeOrigin can introduce wall-clock calibration skew.
const now = () => Number(process.hrtime.bigint()) / 1e6;

function fail(state, message) {
	if (state && !state.error) state.error = message;
}

function verifyTimerCount(state, stage) {
	if (timingEnabled && activeTimers.size !== 1) {
		fail(state, `Expected exactly one active ${pollMs} ms interval at ${stage}; observed ${activeTimers.size}`);
	}
}

function send(message) {
	if (!process.connected || typeof process.send !== "function") return;
	try {
		process.send(message, (error) => {
			if (error) fail(measurement, `IPC send failed: ${error.message}`);
		});
	} catch (error) {
		fail(measurement, `IPC send failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function resourceSample(state) {
	if (state.resources.length >= cap) {
		fail(state, `Resource buffer exceeded ${cap} samples`);
		return;
	}
	const at = now();
	const cpu = process.cpuUsage(state.cpuStart);
	const memory = process.memoryUsage();
	state.resources.push({ at, rss: memory.rss, heapUsed: memory.heapUsed,
		external: memory.external, cpuUserUs: cpu.user, cpuSystemUs: cpu.system });
}

function recordCallback(registration, callback, receiver, args) {
	const state = measurement;
	if (!state?.capturing) return Reflect.apply(callback, receiver, args);
	const started = now();
	verifyTimerCount(state, "interval callback");
	if (!activeTimers.has(registration.handle)) fail(state, "A cleared matching interval executed during measurement");
	const lateMs = Math.max(0, started - registration.previousAt - pollMs);
	registration.previousAt = started;
	if (state.ticks.length >= cap) {
		fail(state, `Tick buffer exceeded ${cap} samples`);
		return Reflect.apply(callback, receiver, args);
	}
	const tick = { at: started, callbackMs: null, drainMs: null,
		lateMs, timerId: registration.timerId };
	state.ticks.push(tick);
	const callbackStarted = now();
	try {
		// Do not await a returned Promise or alter the timer callback's receiver.
		return Reflect.apply(callback, receiver, args);
	} finally {
		tick.callbackMs = now() - callbackStarted;
		state.pendingDrains++;
		originalSetImmediate(() => {
			// This includes microtasks and loop scheduling after the synchronous
			// callback. It is NOT full tick, physical rendering, or send-ACK time.
			tick.drainMs = now() - started;
			state.pendingDrains--;
		}).unref();
	}
}

function markCleared(handle) {
	let registration = activeTimers.get(handle);
	if (!registration && (typeof handle === "number" || typeof handle === "string")) {
		// Node accepts the Timeout's primitive identity with either clear API.
		for (const candidate of activeTimers.values()) {
			if (String(candidate.nativeId) === String(handle)) {
				registration = candidate;
				break;
			}
		}
	}
	if (!registration) return;
	activeTimers.delete(registration.handle);
	registration.clearedAt = now();
	if (measurement?.capturing) verifyTimerCount(measurement, "interval clear");
}

if (timingEnabled && pollMs !== null) {
	globalThis.setInterval = function (callback, delay, ...args) {
		// Match the requested numeric cadence, not Node's coerced/clamped delay.
		// The stack is evidence for review; cadence alone does not prove tick identity.
		if (delay !== pollMs || typeof callback !== "function") {
			return Reflect.apply(originalSetInterval, this, [callback, delay, ...args]);
		}
		if (registrations.length >= cap) {
			registrationOverflow = true;
			fail(measurement, `Timer registration buffer exceeded ${cap} entries`);
			return Reflect.apply(originalSetInterval, this, [callback, delay, ...args]);
		}
		const registration = { timerId: nextTimerId++, requestedMs: delay,
			registeredAt: now(), clearedAt: null, stack: new Error("Matching interval registration").stack,
			previousAt: now(), handle: null, nativeId: null };
		const handle = Reflect.apply(originalSetInterval, this, [function (...callbackArgs) {
			return recordCallback(registration, callback, this, callbackArgs);
		}, delay, ...args]);
		registration.handle = handle;
		registration.nativeId = handle[Symbol.toPrimitive]();
		registrations.push(registration);
		activeTimers.set(handle, registration);
		if (measurement?.capturing) verifyTimerCount(measurement, "interval registration");
		return handle;
	};
	globalThis.clearInterval = function (handle) {
		const result = Reflect.apply(originalClearInterval, this, [handle]);
		markCleared(handle);
		return result;
	};
	globalThis.clearTimeout = function (handle) {
		const result = Reflect.apply(originalClearTimeout, this, [handle]);
		markCleared(handle);
		return result;
	};
}

function startMeasurement() {
	if (measurement?.capturing || measurement?.stopping) {
		fail(measurement, "Received measure-start before the previous measurement finished");
		send({ type: "measure-started", at: measurement.startedAt, error: measurement.error });
		return;
	}
	const started = now();
	const state = { capturing: true, stopping: false, startedAt: started, endedAt: null,
		ticks: [], resources: [], cpuStart: process.cpuUsage(), pendingDrains: 0,
		histogram: monitorEventLoopDelay({ resolution: 10 }), resourceTimer: null,
		error: configurationError || (registrationOverflow ? `Timer registration buffer exceeded ${cap} entries` : null) };
	measurement = state;
	for (const registration of activeTimers.values()) registration.previousAt = started;
	verifyTimerCount(state, "measurement start");
	state.histogram.enable();
	resourceSample(state);
	state.resourceTimer = originalSetInterval(() => {
		verifyTimerCount(state, "resource sample");
		resourceSample(state);
	}, 1000).unref();
	send({ type: "measure-started", at: state.startedAt, error: state.error });
}

function timerMetadata() {
	return registrations.map(({ timerId, requestedMs, registeredAt, clearedAt, stack, handle }) =>
		({ timerId, requestedMs, registeredAt, clearedAt, stack, active: activeTimers.has(handle) }));
}

function stopMeasurement() {
	const state = measurement;
	if (!state || !state.capturing) {
		send({ type: "measurement", timingEnabled, pollMs, startedAt: state?.startedAt ?? null,
			endedAt: now(), timers: timerMetadata(), ticks: [], resources: [], eventLoop: null,
			error: "Received measure-stop without an active measurement" });
		return;
	}
	state.capturing = false;
	state.stopping = true;
	state.endedAt = now();
	originalClearInterval(state.resourceTimer);
	verifyTimerCount(state, "measurement stop");
	resourceSample(state);
	state.histogram.disable();
	// Snapshot registrations at the measurement boundary. Previously queued
	// drain callbacks settle first; no callbacks beginning after stop are counted.
	const timers = timerMetadata();
	originalSetImmediate(() => {
		if (state.pendingDrains !== 0) fail(state, "Measurement stopped with incomplete drain samples");
		if (timingEnabled && state.ticks.length === 0) fail(state, "No matching interval callbacks observed during measurement");
		const histogram = state.histogram;
		const percentile = (value) => histogram.count > 0 ? histogram.percentile(value) / 1e6 : null;
		const eventLoop = { p50Ms: percentile(50), p95Ms: percentile(95), p99Ms: percentile(99),
			maxMs: histogram.count > 0 ? histogram.max / 1e6 : null, count: histogram.count };
		state.stopping = false;
		send({ type: "measurement", timingEnabled, pollMs, startedAt: state.startedAt,
			endedAt: state.endedAt, timers, ticks: state.ticks, resources: state.resources, eventLoop,
			timerIdentity: timingEnabled ? "cadence-and-registration-stack-requires-review" : "not-observed-control",
			timingScope: "synchronous interval callback; drain includes microtasks and loop scheduling, not full tick or physical rendering",
			resourceScope: "this plugin process only; CPU microseconds since measure-start; excludes Stream Deck host",
			error: state.error });
	}).unref();
}

process.on("message", (message) => {
	if (message?.type === "measure-start") startMeasurement();
	else if (message?.type === "measure-stop") stopMeasurement();
});
process.on("disconnect", () => {
	if (!measurement) return;
	measurement.capturing = false;
	measurement.stopping = false;
	originalClearInterval(measurement.resourceTimer);
	measurement.histogram.disable();
	// Do not stop product timers or force exit. The parent closes its mock
	// Stream Deck socket, allowing the unchanged plugin to drain normally.
});
// IPC observation must not become a second reason to keep the plugin alive.
process.channel?.unref();
