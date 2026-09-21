import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

const preload = new URL("../scripts/lib/scaling-preload.mjs", import.meta.url);
const childSource = `
const mode = process.env.SCALING_TEST_MODE;
const handles = [];
let measuring = false;
let primary;
const stats = { calls: 0, microtasks: 0, argsPreserved: true, receiverPreserved: true };
const deadline = setTimeout(() => {
	process.stderr.write("scaling preload fixture timed out\\n");
	process.exit(97);
}, 6000);
// A nonmatching watchdog keeps the missing-timer fixture alive without IPC
// being the only reference. It must never appear as a measured registration.
handles.push(setInterval(() => {}, 30000));
if (mode !== "missing") {
	const discardedByInterval = setInterval(() => { throw new Error("uncleared interval"); }, 250);
	clearInterval(discardedByInterval);
	const discardedByTimeout = setInterval(() => { throw new Error("uncleared timeout"); }, 250);
	clearTimeout(Number(discardedByTimeout));
	primary = setInterval(function (text, value) {
		if (!measuring) return;
		stats.calls++;
		stats.argsPreserved &&= text === "fixture payload" && value === 42;
		stats.receiverPreserved &&= this === primary;
		if (mode === "throw") throw new Error("scaling fixture callback exception");
		Promise.resolve().then(() => { stats.microtasks++; });
	}, 250, "fixture payload", 42);
	handles.push(primary);
}
if (mode === "duplicate") handles.push(setInterval(() => {}, 250));
process.on("message", (message) => {
	if (message.type === "measure-start") {
		measuring = true;
		if (mode === "cleared") setTimeout(() => clearTimeout(primary), 300);
	} else if (message.type === "fixture-finish") {
		measuring = false;
		for (const handle of handles) clearInterval(handle);
		clearTimeout(deadline);
		process.send({ type: "fixture-stats", stats }, () => process.disconnect());
	}
});
process.on("disconnect", () => {
	for (const handle of handles) clearInterval(handle);
	clearTimeout(deadline);
});
process.send({ type: "fixture-ready" });
`;

// Every child is the exact handle created here. No name/PID discovery, shared
// profiles, ports, product processes, or native mappings are involved.
function runFixture(mode, timing = true) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ["--import", preload.href, "--input-type=module", "-e", childSource], {
			env: { ...process.env, HWSM_SCALING_POLL_MS: "250", HWSM_SCALING_TIMING: timing ? "1" : "0", SCALING_TEST_MODE: mode },
			stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true,
		});
		let stopTimer;
		let failure;
		let stderr = "";
		const messages = [];
		const fail = (error) => {
			failure ??= error;
			// Only a failed fixture uses this exact-child fallback. Successful
			// fixtures clear their own timers and disconnect for a normal exit.
			if (child.exitCode === null && child.signalCode === null && !child.killed) child.kill();
		};
		const deadline = setTimeout(() => {
			fail(new Error(`Preload fixture ${mode} exceeded its parent deadline: ${stderr}`));
			reject(failure);
		}, 8000);
		const send = (message) => {
			if (!child.connected) return fail(new Error(`Preload fixture ${mode} disconnected before ${message.type}`));
			child.send(message, (error) => { if (error) fail(error); });
		};
		child.stdout.resume();
		child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-65536); });
		child.on("error", (error) => {
			clearTimeout(deadline);
			clearTimeout(stopTimer);
			reject(error);
		});
		child.on("message", (message) => {
			messages.push(message);
			if (messages.length > 12) return fail(new Error("Unexpected per-tick IPC or repeated measurement messages"));
			if (message.type === "fixture-ready") send({ type: "measure-start" });
			else if (message.type === "measure-started") stopTimer = setTimeout(() => send({ type: "measure-stop" }), 650);
			else if (message.type === "measurement") send({ type: "fixture-finish" });
		});
		child.on("close", (code, signal) => {
			clearTimeout(deadline);
			clearTimeout(stopTimer);
			if (failure) reject(failure);
			else resolve({ code, signal, stderr, messages,
				ack: messages.find((message) => message.type === "measure-started"),
				measurement: messages.find((message) => message.type === "measurement"),
				stats: messages.find((message) => message.type === "fixture-stats")?.stats });
		});
	});
}

function verifyNormalExit(result) {
	assert.equal(result.code, 0, result.stderr);
	assert.equal(result.signal, null);
	assert.equal(result.stderr, "");
	assert.deepEqual(result.messages.map((message) => message.type), ["fixture-ready", "measure-started", "measurement", "fixture-stats"]);
}

function verifyResources(measurement) {
	assert.ok(measurement.resources.length >= 2, "initial and final resource samples are required");
	let previous;
	for (const sample of measurement.resources) {
		for (const name of ["at", "rss", "heapUsed", "external", "cpuUserUs", "cpuSystemUs"]) {
			assert.ok(Number.isFinite(sample[name]) && sample[name] >= 0, `Invalid ${name}`);
		}
		assert.ok(sample.rss > 0 && sample.heapUsed > 0);
		if (previous) {
			assert.ok(sample.at >= previous.at);
			assert.ok(sample.cpuUserUs >= previous.cpuUserUs && sample.cpuSystemUs >= previous.cpuSystemUs);
		}
		previous = sample;
	}
}

test("scaling preload measures one live interval and preserves callback arguments, receiver, microtasks and exceptions", { timeout: 12000 }, async () => {
	const result = await runFixture("one");
	verifyNormalExit(result);
	const measured = result.measurement;
	assert.equal(result.ack.error, null);
	assert.equal(measured.error, null);
	assert.equal(measured.startedAt, result.ack.at);
	assert.ok(measured.endedAt - measured.startedAt >= 600);
	assert.equal(measured.timingEnabled, true);
	assert.equal(measured.pollMs, 250);
	assert.equal(measured.timerIdentity, "cadence-and-registration-stack-requires-review");
	const active = measured.timers.filter((timer) => timer.active);
	assert.equal(active.length, 1);
	assert.equal(measured.timers.filter((timer) => !timer.active && timer.clearedAt !== null).length, 2);
	assert.ok(measured.timers.every((timer) => timer.requestedMs === 250 && /Matching interval registration/.test(timer.stack)));
	assert.ok(measured.ticks.length >= 2);
	for (const tick of measured.ticks) {
		assert.equal(tick.timerId, active[0].timerId);
		assert.ok(tick.at >= measured.startedAt && tick.at <= measured.endedAt);
		for (const name of ["callbackMs", "drainMs", "lateMs"]) assert.ok(Number.isFinite(tick[name]) && tick[name] >= 0, name);
		assert.ok(tick.drainMs >= tick.callbackMs);
	}
	assert.ok(result.stats.calls >= measured.ticks.length);
	assert.equal(result.stats.microtasks, result.stats.calls);
	assert.equal(result.stats.argsPreserved, true);
	assert.equal(result.stats.receiverPreserved, true);
	verifyResources(measured);
	assert.ok(measured.eventLoop.count > 0);
	for (const name of ["p50Ms", "p95Ms", "p99Ms", "maxMs"]) assert.ok(Number.isFinite(measured.eventLoop[name]) && measured.eventLoop[name] >= 0);
	const thrown = await runFixture("throw");
	assert.equal(thrown.code, 1, "A callback exception must retain Node's normal fatal behavior");
	assert.equal(thrown.signal, null);
	assert.match(thrown.stderr, /Error: scaling fixture callback exception/);
	assert.ok(thrown.ack, "The exception must occur while interception is measuring");
	assert.equal(thrown.measurement, undefined);
});

test("scaling preload rejects missing, duplicated, and cleared matching intervals", { timeout: 12000 }, async () => {
	const outcomes = await Promise.allSettled(["missing", "duplicate", "cleared"].map((mode) => runFixture(mode)));
	for (const outcome of outcomes) assert.equal(outcome.status, "fulfilled", outcome.reason?.message);
	const results = outcomes.map((outcome) => outcome.value);
	for (const result of results) verifyNormalExit(result);
	assert.match(results[0].measurement.error, /exactly one active 250 ms interval.*observed 0/);
	assert.equal(results[0].measurement.ticks.length, 0);
	assert.match(results[1].measurement.error, /exactly one active 250 ms interval.*observed 2/);
	assert.equal(results[1].measurement.timers.filter((timer) => timer.active).length, 2);
	assert.match(results[2].measurement.error, /interval clear.*observed 0/);
	assert.equal(results[2].measurement.timers.filter((timer) => timer.active).length, 0);
});

test("scaling preload control keeps resource capture and leaves timer timing unobserved", { timeout: 12000 }, async () => {
	const result = await runFixture("one", false);
	verifyNormalExit(result);
	const measured = result.measurement;
	assert.equal(measured.error, null);
	assert.equal(measured.timingEnabled, false);
	assert.equal(measured.timerIdentity, "not-observed-control");
	assert.deepEqual(measured.ticks, []);
	assert.deepEqual(measured.timers, []);
	assert.ok(result.stats.calls >= 2, "The original interval must still execute in control mode");
	assert.equal(result.stats.argsPreserved, true);
	assert.equal(result.stats.receiverPreserved, true);
	verifyResources(measured);
});
