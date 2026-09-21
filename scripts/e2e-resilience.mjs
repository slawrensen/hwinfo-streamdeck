// Forced-condition resilience e2e: drives the BUILT plugin through every
// poller state using the synthetic provider (scripts/fake-hwinfo.mjs) and a
// mock Stream Deck WebSocket, asserting on the actual rendered key frames:
//
//   (no mapping)      → "Start HWiNFO"
//   provider starts   → live "Test Temp" value
//   units flip to °F  → face follows (in-place rewrite, no status flash)
//   pollTime frozen   → "Not updating"
//   provider resumes  → live value again
//   DEAD magic        → "Shared Memory off"
//   provider resumes  → live value again
//   provider EXITS    → stale → probe-reopen fails → "Start HWiNFO"
//   new provider      → same selected reading, with advancing values again
//
// Run with `npm run e2e:resilience` (after `npm run build`).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { buildInfo, decodeSvg, makeCheck, makeExpectFrame, pluginArgv, sleep, waitUntil } from "./lib/e2e-common.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");

const MAPPING_NAME = `Local\\HwinfoE2E_SM2_${process.pid}`;
const MUTEX_NAME = `${MAPPING_NAME}_MUTEX`;
const READING_KEY = "f0001234:0:1000001"; // "Test Temp" in the fake provider
const settings = { readingKey: READING_KEY, decimals: "1", statMode: "current" };

const frames = []; // decoded SVG frames for ctx-res, in arrival order
const settingsWrites = [];
let registrations = 0;
let failures = 0;

const check = makeCheck(() => {
	failures += 1;
});
const expectFrame = makeExpectFrame(frames, check);

// --- mock Stream Deck -------------------------------------------------------
const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
let serverError = null;
let collectorError = null;
wss.on("error", (error) => { serverError = error; });
let pluginWs = null;
wss.on("connection", (ws) => {
	pluginWs = ws;
	ws.on("error", (error) => { collectorError = error; });
	ws.on("message", (data) => {
		try {
			const msg = JSON.parse(data.toString());
			if (msg.event === "registerPlugin") {
				registrations++;
				send({
					event: "willAppear",
					action: "com.lawrensen.hwinfo.reading",
					context: "ctx-res",
					device: "dev1",
					payload: { settings, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false }
				});
			} else if (msg.event === "getGlobalSettings") {
				send({ event: "didReceiveGlobalSettings", payload: { settings: {} } });
			} else if (msg.event === "setSettings" && msg.context === "ctx-res") {
				settingsWrites.push(msg.payload);
			} else if (msg.event === "setImage" && msg.context === "ctx-res") {
				const svg = decodeSvg(msg.payload?.image);
				if (svg !== null) {
					frames.push(svg);
				}
			}
		} catch (error) {
			collectorError = error;
		}
	});
});
const send = (obj) => pluginWs?.send(JSON.stringify(obj));

// --- processes ---------------------------------------------------------------
// Only ChildProcess objects returned by this harness's own spawn calls may
// be stopped. Keep their exit results from creation; never infer an exit
// from a missing PID or signal an image name / rediscovered process.
const owned = [];
function own(child, name) {
	const record = { child, name, exit: null, error: null };
	child.once("exit", (code, signal) => { record.exit = { code, signal }; });
	child.on("error", (error) => { record.error = error; });
	child.stdin?.on("error", (error) => { record.error = error; });
	child.stdout?.on("error", (error) => { record.error = error; });
	owned.push(record);
	return record;
}

async function waitExit(record, timeoutMs = 5000) {
	const started = performance.now();
	await waitUntil(() => record.exit !== null || (record.child.pid === undefined && record.error !== null), timeoutMs);
	if (record.child.pid === undefined && record.error !== null) throw new Error(`${record.name}: spawn failed before a child existed`, { cause: record.error });
	assert.ok(record.exit !== null && performance.now() - started < timeoutMs, `${record.name}: actual exit was not confirmed within ${timeoutMs} ms`);
	console.log(`CHILD EXIT ${JSON.stringify({ name: record.name, pid: record.child.pid, ...record.exit })}`);
	assert.equal(record.error, null, `${record.name}: child process error`);
	return record.exit;
}

let fake = null;
async function startFake(name) {
	const record = own(spawn(process.execPath, [path.join(repoRoot, "scripts", "fake-hwinfo.mjs")], {
		env: { ...process.env, HWINFO_SM2_NAME: MAPPING_NAME, HWINFO_SM2_MUTEX_NAME: MUTEX_NAME },
		stdio: ["pipe", "pipe", "inherit"], windowsHide: true
	}), name);
	const child = record.child;
	fake = child;
	let output = "";
	child.stdout.on("data", (data) => { output += data.toString(); });
	child.once("exit", () => {
		if (fake === child) fake = null;
	});
	const ready = () => output.split(/\r?\n/).slice(0, -1).includes(`READY ${MAPPING_NAME}`);
	const started = performance.now();
	await waitUntil(() => ready() || record.exit !== null || record.error !== null, 5000);
	assert.equal(record.error, null, `${name}: producer spawn failed`);
	assert.equal(record.exit, null, `${name}: producer exited before readiness`);
	assert.ok(ready() && performance.now() - started < 5000, `${name}: exact mapping readiness was not confirmed within 5000 ms`);
	console.log(`PRODUCER READY ${JSON.stringify({ name, pid: child.pid, mapping: MAPPING_NAME })}`);
	return record;
}

let plugin;
let scenarioError = null;

// --- scenario ----------------------------------------------------------------
try {
	const listeningStarted = performance.now();
	await waitUntil(() => wss.address() !== null || serverError !== null, 5000);
	assert.equal(serverError, null, "the owned mock server failed to listen");
	const address = wss.address();
	assert.ok(address && typeof address === "object" && performance.now() - listeningStarted < 5000, "the owned mock server must listen within 5000 ms");
	plugin = own(spawn(
		process.execPath,
		pluginArgv(address.port, "e2e-resilience", buildInfo({ devices: [{ id: "dev1", name: "Harness Deck", size: { columns: 5, rows: 3 }, type: 0 }] })),
		{
			cwd: pluginDir,
			env: {
				...process.env,
				HWINFO_SM2_NAME: MAPPING_NAME,
				HWINFO_SM2_MUTEX_NAME: MUTEX_NAME,
				// Isolate the gadget fallback too: with a real (possibly empty) VSB
				// key on the host, auto mode would diagnose gadget-empty instead of
				// this suite's expected not-running screens.
				HWINFO_VSB_KEY: `Software\\HwinfoE2E_NoVSB_${process.pid}`,
				HWINFO_STALE_AFTER_MS: "2500",
				HWINFO_REOPEN_PROBE_MS: "1000"
			},
			stdio: ["ignore", "inherit", "inherit"], windowsHide: true
		}
	), "plugin");

	// 1. Mapping absent → not-running screen.
	await expectFrame("mapping absent → 'Start HWiNFO'", (svg) => svg.includes("Start HWiNFO"), 6000);

	// 2. Provider appears → live value (recovery from unavailable).
	const firstProducer = await startFake("initial producer");
	await expectFrame("provider up → live 'Test Temp' value", (svg) => svg.includes("Test Temp") && svg.includes("°C"), 8000);

	// 2b. HWiNFO's unit setting flips mid-session: the unit string and value
	// scale are rewritten in place under an unchanged layout. The parser must
	// notice and rebuild; the face follows to °F with no status-screen flash.
	const beforeFlip = frames.length;
	fake.stdin.write("fahrenheit\n");
	await expectFrame("units flipped in place → face shows °F", (svg) => svg.includes("°F"), 8000);
	const flipFlash = frames.slice(beforeFlip).filter((svg) => svg.includes("Source error") || svg.includes("Start HWiNFO") || svg.includes("Not updating") || svg.includes("Source busy"));
	check("no status frame during the unit flip", flipFlash.length === 0, `${flipFlash.length} status frames`);
	fake.stdin.write("celsius\n");
	await expectFrame("units restored → face shows °C again", (svg) => svg.includes("°C"), 8000);

	// 3. pollTime frozen → stale screen.
	fake.stdin.write("freeze\n");
	await expectFrame("values frozen → 'Not updating'", (svg) => svg.includes("Not updating"), 12000);

	// 3b. Stale must STICK across reopen probes: a fresh provider must not
	// reset the freshness baseline and flap back to showing frozen values as
	// live (covers >3 probe rounds at these timings).
	const staleMark = frames.length;
	await sleep(3500);
	const flapFrames = frames.slice(staleMark).filter((svg) => svg.includes("Test Temp"));
	check("stale sticks across reopen probes (no ok↔stale flap)", flapFrames.length === 0, `${flapFrames.length} live frames while frozen`);

	// 4. Resume → live again (stale → ok).
	fake.stdin.write("alive\n");
	await expectFrame("resumed → live value again", (svg) => svg.includes("Test Temp"), 8000);

	// 5. DEAD magic → disabled screen (free-version 12 h timer / toggle off).
	fake.stdin.write("dead\n");
	await expectFrame("DEAD magic → 'Shared Memory off'", (svg) => svg.includes("Shared Memory"), 8000);

	// 6. Re-enable → live again (disabled → ok).
	fake.stdin.write("alive\n");
	await expectFrame("re-enabled → live value again", (svg) => svg.includes("Test Temp"), 8000);

	// 7. Provider exits without writing DEAD → values freeze → the
	//    poller must release its own handles, fail the re-open, and land on
	//    the not-running screen (the stale→unavailable FSM edge).
	const beforeExit = frames.length;
	firstProducer.child.stdin.write("exit\n");
	assert.deepEqual(await waitExit(firstProducer), { code: 0, signal: null }, "the original producer really closed its mapping and exited normally");
	await waitUntil(() => frames.slice(beforeExit).some((svg) => svg.includes("Start HWiNFO")), 15000);
	assert.ok(frames.slice(beforeExit).some((svg) => svg.includes("Start HWiNFO")), "the existing plugin must become unavailable after the original producer exits");
	check("provider gone → 'Start HWiNFO' after actual producer exit", true);

	// A second process recreates the same named objects only AFTER the old
	// producer exited and the plugin released its own handles. Reusing alive
	// on the original writer would not exercise this lifecycle boundary.
	const beforeRecovery = frames.length;
	const replacement = await startFake("replacement producer");
	assert.notEqual(replacement.child, firstProducer.child, "recovery must use a separately spawned producer lifetime");
	const recoveredValues = () => frames.slice(beforeRecovery).flatMap((svg) => {
		if (!svg.includes("Test Temp") || !svg.includes("°C")) return [];
		// The single-key renderer's numeric text, excluding labels, units,
		// history and status decoration. A second frame alone proves no data.
		const value = svg.match(/<text x="72" y="94"[^>]*>(-?\d+(?:\.\d+)?)<\/text>/)?.[1];
		return value === undefined ? [] : [Number(value)];
	});
	const advanced = () => {
		const values = recoveredValues();
		return values.length >= 2 && values.some((value) => value > values[0]);
	};
	await waitUntil(advanced, 10000);
	assert.ok(advanced(), `replacement producer must advance the rendered native-unit value, observed ${JSON.stringify(recoveredValues())}`);
	assert.equal(plugin.exit, null, "the original plugin process must survive recovery");
	assert.equal(replacement.exit, null, "the replacement producer must remain alive while proving recovery");
	assert.equal(registrations, 1, "recovery must not reconnect or replace the plugin context");
	assert.deepEqual(settingsWrites, [], "producer recovery must not rewrite the selected identity or any action setting");
	check("new producer → advancing values on the unchanged selected key", true, JSON.stringify(recoveredValues()));
	assert.equal(collectorError, null, "the mock socket collected all frames without error");
} catch (error) {
	scenarioError = error;
} finally {
	const cleanup = await Promise.allSettled(owned.map(async (record) => {
		const errors = [];
		if (record.exit === null && record.child.pid !== undefined) {
			try {
				assert.ok(record.child.kill(), `${record.name}: owned child stop failed`);
			} catch (error) {
				errors.push(error);
			}
		}
		try {
			await waitExit(record);
		} catch (error) {
			errors.push(error);
		}
		if (errors.length) throw new AggregateError(errors, `${record.name}: owned cleanup failed`);
	}));
	const errors = cleanup.filter((result) => result.status === "rejected").map((result) => result.reason);
	for (const client of wss.clients) client.terminate();
	let serverClosed = false;
	let closeError;
	const closeStarted = performance.now();
	wss.close((error) => { closeError = error; serverClosed = true; });
	await waitUntil(() => serverClosed, 3000);
	if (!serverClosed || closeError || performance.now() - closeStarted >= 3000) errors.push(closeError ?? new Error("the owned mock server did not close within 3000 ms"));
	if (scenarioError) errors.unshift(scenarioError);
	if (collectorError) errors.push(collectorError);
	if (serverError) errors.push(serverError);
	if (errors.length) throw new AggregateError(errors, "Resilience scenario or owned cleanup failed");
}

console.log(failures === 0 ? "\nRESILIENCE E2E: ALL STATES FIRED" : `\nRESILIENCE E2E: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
