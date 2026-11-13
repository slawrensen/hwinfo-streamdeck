// Trend window e2e: drives the BUILT plugin with the synthetic provider
// (scripts/fake-hwinfo.mjs) and a mock Stream Deck WebSocket, with a
// Sensor Reading key on a 1-minute Trend window and a two-row Sensor Dial
// on the same window, and asserts on the frames they actually send:
//
//   provider live          → both draw a time-axis line at least 4 s long,
//                            ending at the right edge of its strip or row
//   pollTime frozen        → "Not updating" on both
//   provider resumes       → the line comes back after a gap of at least 2.5 s
//   provider EXITS         → the last values and the end dot stay up until the
//                            stale window has passed, then "Start HWiNFO"
//   new provider           → the line comes back after a second gap
//   page away; the provider writes one stamp 20 s old and stops; page back
//                          → the stale screens on the first frame, no sample
//                            from that read, and the gap stays a gap
//   units flip to °F       → the °C runs are left out; one short °F run
//
// and that every windowed frame stays small and nothing writes settings.
// The dial row's time axis is found through the renderer's own two-row
// columns (twoRowColumns), checked against the value and unit anchors of
// each face, so its run length, right edge and gaps are measured in that
// row's seconds. Run with `npm run e2e:trend-window` (after `npm run build`).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { buildInfo, decodeSvg, makeCheck, makeExpectFrame, pluginArgv, sleep, waitUntil } from "./lib/e2e-common.mjs";
import { dialBackgroundTraits } from "../src/ui/dial-background.ts";
import { twoRowColumns } from "../src/ui/dial-renderer.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = process.env.HWINFO_E2E_PLUGIN_DIR ? path.resolve(process.env.HWINFO_E2E_PLUGIN_DIR) : path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");
if (!fs.existsSync(path.join(pluginDir, "bin", "plugin.js"))) {
	console.error(`e2e-trend-window: no bin/plugin.js under ${pluginDir}; build the checkout first.`);
	process.exit(2);
}

const MAPPING_NAME = `Local\\HwinfoE2E_Trend_${process.pid}`;
const MUTEX_NAME = `${MAPPING_NAME}_MUTEX`;
const TEMP = "f0001234:0:1000001"; // "Test Temp" in the fake provider
const FAN = "f0001234:0:1000002"; // "Test Fan"
const KEY_SETTINGS = { readingKey: TEMP, displayMode: "sparkline", historyWindow: "1m", decimals: "1" };
const DIAL_SETTINGS = { dialView: "tworow", readingKey: TEMP, rotationKeys: [TEMP, FAN], dialHistoryWindow: "1m" };
const KEY_APPEAR = { event: "willAppear", action: "com.lawrensen.hwinfo.reading", context: "ctx-key", device: "dev1", payload: { settings: KEY_SETTINGS, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false } };
const DIAL_APPEAR = { event: "willAppear", action: "com.lawrensen.hwinfo.dial", context: "ctx-dial", device: "devplus", payload: { settings: DIAL_SETTINGS, coordinates: { column: 0, row: 0 }, controller: "Encoder", isInMultiAction: false } };
const STALE_AFTER_MS = 2500;
/** The key's strip: x 8..136 for 60 s, newest column centred at 135.5. */
const KEY_PX_PER_S = 128 / 60;
const KEY_LAST_COLUMN_X = 135.5;
const KEY_RIGHT = 136;
const KEY_BUDGET = 3072;
const DIAL_BUDGET = 4096;
/** The dial's default (Theme) background, as the harness never sets one. */
const DIAL_OVERFLOW_RECTS = dialBackgroundTraits(undefined).overflowRects;

const keyFrames = [];
const keyTimes = [];
const dialFrames = [];
const dialTimes = [];
const settingsWrites = [];
let failures = 0;
const check = makeCheck(() => {
	failures += 1;
});
const expectKey = makeExpectFrame(keyFrames, check);
const expectDial = makeExpectFrame(dialFrames, check);

/** Every stroked run of every trend in a face: [{ x, y }...] per subpath. */
function runs(svg) {
	const out = [];
	for (const m of svg.matchAll(/<path d="([^"]*)" fill="none" stroke=/g)) {
		let x = 0;
		let y = 0;
		for (const [, cmd, args] of m[1].matchAll(/([MLHVZmlhvz])([^MLHVZmlhvz]*)/g)) {
			const n = [...args.matchAll(/-?(?:\d+(?:\.\d*)?|\.\d+)/g)].map((v) => Number(v[0]));
			const rel = cmd === cmd.toLowerCase();
			const upper = cmd.toUpperCase();
			if (upper === "Z") continue;
			for (let i = 0; i < n.length; ) {
				if (upper === "H") x = (rel ? x : 0) + n[i++];
				else if (upper === "V") y = (rel ? y : 0) + n[i++];
				else {
					x = (rel ? x : 0) + n[i++];
					y = (rel ? y : 0) + n[i++];
				}
				if (upper === "M" && i <= 2) out.push([]);
				out.at(-1).push({ x, y });
			}
		}
	}
	return out;
}
const lastX = (run) => run.at(-1).x;
const firstX = (run) => run[0].x;
const windowed = (svg) => /<path d="M[^"]*" fill="none" stroke=/.test(svg);
/** The dial's temperature row: the first trend, drawn in the top row. */
const topRuns = (svg) => runs(svg).filter((run) => run[0].y < 50);
/** The dial's fan row: the second trend, in the bottom row. */
const bottomRuns = (svg) => runs(svg).filter((run) => run[0].y >= 50);

const unescapeXml = (text) => text.replace(/&(lt|gt|quot|apos|amp);/g, (_, name) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[name]);

/**
 * Where a dial face's rows keep their time axis: the renderer's own
 * two-row columns for the value and unit texts this face draws. Null when
 * the face is not a two-row face, or its value and unit anchors are not
 * where those columns put them (then nothing below would mean anything).
 */
function dialAxis(svg) {
	const rows = [];
	for (const y of [40, 82]) {
		const m = svg.match(new RegExp(`<text x="([^"]*)" y="${y}" text-anchor="end"[^>]*font-weight="700"[^>]*>([^<]*)</text>(?:<text x="([^"]*)" y="${y}" text-anchor="start"[^>]*>([^<]*)</text>)?`));
		if (m !== null) rows.push({ valueX: m[1], valueText: unescapeXml(m[2]), unitX: m[3], unitText: m[4] === undefined ? "" : unescapeXml(m[4]) });
	}
	if (rows.length === 0) return null;
	const columns = twoRowColumns(rows, DIAL_OVERFLOW_RECTS);
	if (!rows.every((row) => row.valueX === columns.valueEndX.toFixed(1) && (row.unitText === "" || row.unitX === columns.unitX.toFixed(1)))) return null;
	const { x, w } = columns.trend;
	const count = Math.floor(w);
	return { right: x + w, lastColumnX: x + ((count - 0.5) * w) / count, pxPerS: w / 60 };
}

/** A run whose newest point sits in the strip's or row's last column. */
const endsAtRight = (run, lastColumnX, right) => lastX(run) >= lastColumnX - 1.5 && lastX(run) <= right;
const keyEndsAtRight = (run) => endsAtRight(run, KEY_LAST_COLUMN_X, KEY_RIGHT);

/** A list of runs whose newest two are split by at least `seconds`. */
function gapAtLeast(list, seconds, pxPerS) {
	if (list.length < 2) return false;
	const gap = firstX(list.at(-1)) - lastX(list.at(-2));
	return gap >= seconds * pxPerS;
}

/** The dial's temperature row as a time axis, or null on any other face. */
function dialTop(svg) {
	if (!windowed(svg)) return null;
	const axis = dialAxis(svg);
	return axis === null ? null : { ...axis, runs: topRuns(svg), fan: bottomRuns(svg) };
}

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
				send(KEY_APPEAR);
				send(DIAL_APPEAR);
			} else if (msg.event === "getGlobalSettings") {
				// A deck theme is already chosen, so the one-time theme migration has
				// nothing to persist and any write below is the scenario's own.
				send({ event: "didReceiveGlobalSettings", payload: { settings: { pollIntervalMs: "500", theme: "void" } } });
			} else if (msg.event === "setSettings" || msg.event === "setGlobalSettings") {
				settingsWrites.push({ event: msg.event, context: msg.context, payload: msg.payload });
			} else if (msg.event === "setImage" && msg.context === "ctx-key") {
				const svg = decodeSvg(msg.payload?.image);
				if (svg !== null) {
					keyFrames.push(svg);
					keyTimes.push(performance.now());
				}
			} else if (msg.event === "setFeedback" && msg.context === "ctx-dial") {
				const svg = decodeSvg(msg.payload?.canvas);
				if (svg !== null) {
					dialFrames.push(svg);
					dialTimes.push(performance.now());
				}
			}
		} catch (error) {
			collectorError = error;
		}
	});
});
const send = (obj) => pluginWs?.send(JSON.stringify(obj));
const disappear = (appear) => send({ ...appear, event: "willDisappear" });

// --- processes ---------------------------------------------------------------
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

async function startFake(name) {
	const record = own(spawn(process.execPath, [path.join(repoRoot, "scripts", "fake-hwinfo.mjs")], {
		env: { ...process.env, HWINFO_SM2_NAME: MAPPING_NAME, HWINFO_SM2_MUTEX_NAME: MUTEX_NAME },
		stdio: ["pipe", "pipe", "inherit"], windowsHide: true
	}), name);
	let output = "";
	record.child.stdout.on("data", (data) => { output += data.toString(); });
	/** True once the producer printed `line` as a whole line. */
	record.said = (line) => output.split(/\r?\n/).slice(0, -1).includes(line);
	const started = performance.now();
	await waitUntil(() => record.said(`READY ${MAPPING_NAME}`) || record.exit !== null || record.error !== null, 5000);
	assert.equal(record.error, null, `${name}: producer spawn failed`);
	assert.equal(record.exit, null, `${name}: producer exited before readiness`);
	assert.ok(record.said(`READY ${MAPPING_NAME}`) && performance.now() - started < 5000, `${name}: mapping readiness was not confirmed within 5000 ms`);
	console.log(`PRODUCER READY ${JSON.stringify({ name, pid: record.child.pid, mapping: MAPPING_NAME })}`);
	return record;
}

/** Sends a producer command and waits for its acknowledgement line. */
async function command(record, cmd, ack) {
	record.child.stdin.write(`${cmd}\n`);
	const started = performance.now();
	await waitUntil(() => record.said(ack) || record.exit !== null, 3000);
	assert.ok(record.said(ack) && performance.now() - started < 3000, `${record.name}: "${cmd}" was not acknowledged within 3000 ms`);
}

/** Waits for a key frame and a dial frame that satisfy `keyOk` / `dialOk`,
 * both counted from now: a dial sends a status face once (identical frames
 * are deduped), so it may land while the key is still being waited for. */
async function expectBoth(name, keyOk, dialOk, timeoutMs) {
	await Promise.all([expectKey(`key: ${name}`, keyOk, timeoutMs), expectDial(`dial: ${name}`, dialOk, timeoutMs)]);
}

let plugin;
let scenarioError = null;
let runError = null;

try {
	const listeningStarted = performance.now();
	await waitUntil(() => wss.address() !== null || serverError !== null, 5000);
	assert.equal(serverError, null, "the owned mock server failed to listen");
	const address = wss.address();
	assert.ok(address && typeof address === "object" && performance.now() - listeningStarted < 5000, "the owned mock server must listen within 5000 ms");
	plugin = own(spawn(
		process.execPath,
		pluginArgv(address.port, "e2e-trend-window", buildInfo({
			devices: [
				{ id: "dev1", name: "Harness Deck", size: { columns: 5, rows: 3 }, type: 0 },
				{ id: "devplus", name: "Harness Plus", size: { columns: 4, rows: 2 }, type: 7 }
			]
		})),
		{
			cwd: pluginDir,
			env: {
				...process.env,
				HWINFO_SM2_NAME: MAPPING_NAME,
				HWINFO_SM2_MUTEX_NAME: MUTEX_NAME,
				HWINFO_VSB_KEY: `Software\\HwinfoE2E_NoVSB_${process.pid}`,
				HWINFO_STALE_AFTER_MS: String(STALE_AFTER_MS),
				HWINFO_REOPEN_PROBE_MS: "1000"
			},
			stdio: ["ignore", "inherit", "inherit"], windowsHide: true
		}
	), "plugin");

	await expectBoth("mapping absent → 'Start HWiNFO'", (svg) => svg.includes("Start HWiNFO"), (svg) => svg.includes("Start HWiNFO"), 6000);

	// 1. Live: a line that grows from the right edge, on the key's strip and
	//    on both dial rows, measured in each one's own seconds.
	const first = await startFake("initial producer");
	await expectBoth(
		"live → a time-axis line at least 4 s long, ending at the right edge",
		(svg) => windowed(svg) && runs(svg).length === 1 && keyEndsAtRight(runs(svg)[0]) && lastX(runs(svg)[0]) - firstX(runs(svg)[0]) >= 4 * KEY_PX_PER_S,
		(svg) => {
			const d = dialTop(svg);
			return d !== null && d.runs.length === 1 && d.fan.length === 1 && endsAtRight(d.runs[0], d.lastColumnX, d.right) && endsAtRight(d.fan[0], d.lastColumnX, d.right) && lastX(d.runs[0]) - firstX(d.runs[0]) >= 4 * d.pxPerS;
		},
		10000
	);

	// 2. Frozen: the stale screens.
	first.child.stdin.write("freeze\n");
	await expectBoth("values frozen → stale screens", (svg) => svg.includes("Not updating"), (svg) => svg.includes("Not updating"), 12000);
	await sleep(1000);

	// 3. Resumed: the line returns with a gap where nothing came in.
	first.child.stdin.write("alive\n");
	await expectBoth(
		"resumed → two runs with a gap of at least 2.5 s between them, the newest at the right edge",
		(svg) => windowed(svg) && gapAtLeast(runs(svg), 2.5, KEY_PX_PER_S) && runs(svg).at(-1).length >= 2 && keyEndsAtRight(runs(svg).at(-1)),
		(svg) => {
			const d = dialTop(svg);
			return d !== null && gapAtLeast(d.runs, 2.5, d.pxPerS) && d.runs.at(-1).length >= 2 && endsAtRight(d.runs.at(-1), d.lastColumnX, d.right);
		},
		10000
	);
	await sleep(2000);

	// 4. HWiNFO exits. The plugin's own handle keeps the closed section
	//    readable, so the last values (end dot on) stay up until the stale
	//    window has passed; only then does a reopen fail: "Start HWiNFO".
	const keyBeforeExit = keyFrames.length;
	const dialBeforeExit = dialFrames.length;
	const exitAt = performance.now();
	first.child.stdin.write("exit\n");
	assert.deepEqual(await waitExit(first), { code: 0, signal: null }, "the producer closed its mapping and exited");
	await expectBoth("producer gone → 'Start HWiNFO'", (svg) => svg.includes("Start HWiNFO"), (svg) => svg.includes("Start HWiNFO"), 15000);
	for (const [who, frames, times, from, dot] of [["key", keyFrames, keyTimes, keyBeforeExit, 'r="5"'], ["dial", dialFrames, dialTimes, dialBeforeExit, 'r="3.5"']]) {
		const gone = frames.findIndex((svg, i) => i >= from && svg.includes("Start HWiNFO"));
		const held = gone > 0 ? frames[gone - 1] : "";
		const heldMs = gone > 0 ? times[gone] - exitAt : Number.NaN;
		check(
			`${who}: producer gone → the last values and the end dot stay up for the stale window first`,
			heldMs >= STALE_AFTER_MS - 1000 && windowed(held) && held.includes(dot) && !held.includes("Start HWiNFO"),
			`Start HWiNFO ${(heldMs / 1000).toFixed(1)} s after the exit; the face before it ${windowed(held) ? "drew the line" : "drew no line"}${held.includes(dot) ? " with the end dot" : " without the end dot"}`
		);
	}
	await sleep(1000);
	const second = await startFake("replacement producer");
	await expectBoth(
		"new producer → the line returns after a second gap of at least 2.5 s",
		(svg) => windowed(svg) && runs(svg).length >= 3 && gapAtLeast(runs(svg), 2.5, KEY_PX_PER_S) && runs(svg).at(-1).length >= 2 && keyEndsAtRight(runs(svg).at(-1)),
		(svg) => {
			const d = dialTop(svg);
			return d !== null && d.runs.length >= 3 && gapAtLeast(d.runs, 2.5, d.pxPerS) && d.runs.at(-1).length >= 2 && endsAtRight(d.runs.at(-1), d.lastColumnX, d.right);
		},
		12000
	);
	await sleep(1500);

	// 5. A page change away and back while the producer writes once more and
	//    stops: the plugin first sees a stamp that is already 20 s old. That
	//    read is no sample: the first frame back is the stale screen, and
	//    when data comes again the line restarts after a gap as long as the
	//    whole time no data came in. Counted as new, the old stamp would put
	//    the line back up live and join it across the absence (shorter than
	//    the tick gap that would otherwise end the run).
	const disappearAt = performance.now();
	disappear(KEY_APPEAR);
	disappear(DIAL_APPEAR);
	await sleep(300);
	await command(second, "backdate", "MODE backdated");
	await sleep(Math.max(0, disappearAt + STALE_AFTER_MS + 1000 - performance.now()));
	const keyBack = keyFrames.length;
	const dialBack = dialFrames.length;
	send(KEY_APPEAR);
	send(DIAL_APPEAR);
	await expectBoth("page back over a stamp 20 s old → the stale screens", (svg) => svg.includes("Not updating"), (svg) => svg.includes("Not updating"), 4000);
	check("key: page back → its first frame is the stale screen, never the old stamp drawn live", keyFrames[keyBack]?.includes("Not updating") === true, keyFrames[keyBack]?.slice(0, 160) ?? "no frame");
	check("dial: page back → its first frame is the stale screen, never the old stamp drawn live", dialFrames[dialBack]?.includes("Not updating") === true, dialFrames[dialBack]?.slice(0, 160) ?? "no frame");
	await sleep(1000);
	const aliveAt = performance.now();
	await command(second, "alive", "MODE alive");
	// Every second from the page change to "alive" is a gap. The slack
	// covers the last read before the page change (one Read every interval)
	// and a column of rounding at each end. Counted as new, the old stamp
	// would join the line across the 3.5 s absence and leave a gap that
	// much shorter.
	const quietS = (aliveAt - disappearAt) / 1000 - 1.5;
	await expectBoth(
		`live again → no sample from the old stamp: the gap stays a gap of at least ${quietS.toFixed(1)} s`,
		(svg) => windowed(svg) && runs(svg).length >= 4 && gapAtLeast(runs(svg), quietS, KEY_PX_PER_S) && runs(svg).at(-1).length >= 2 && keyEndsAtRight(runs(svg).at(-1)),
		(svg) => {
			const d = dialTop(svg);
			return d !== null && d.runs.length >= 4 && gapAtLeast(d.runs, quietS, d.pxPerS) && d.runs.at(-1).length >= 2 && endsAtRight(d.runs.at(-1), d.lastColumnX, d.right);
		},
		10000
	);
	await sleep(1500);

	// 6. A unit change in HWiNFO: the °C runs leave the window and the °F
	//    run starts on its own from the right.
	const beforeFlip = runs(keyFrames.at(-1) ?? "");
	second.child.stdin.write("fahrenheit\n");
	await expectKey(
		"key: units flipped → only the new °F run, starting at the right",
		(svg) => svg.includes("°F") && windowed(svg) && runs(svg).length === 1 && firstX(runs(svg)[0]) > KEY_RIGHT - 5 * KEY_PX_PER_S,
		10000
	);
	check("key: before the flip it drew more than one °C run", beforeFlip.length >= 4, `${beforeFlip.length} runs`);
	await expectDial("dial: units flipped → the temperature row keeps one run, starting at the right", (svg) => {
		const d = dialTop(svg);
		return svg.includes("°F") && d !== null && d.runs.length === 1 && firstX(d.runs[0]) > d.right - 5 * d.pxPerS;
	}, 10000);

	// Payload and settings across the whole run.
	const keyMax = Math.max(...keyFrames.filter(windowed).map((svg) => svg.length));
	const dialMax = Math.max(...dialFrames.filter(windowed).map((svg) => svg.length));
	check(`every windowed key frame ≤ ${KEY_BUDGET} characters`, keyMax <= KEY_BUDGET, `largest ${keyMax}`);
	check(`every windowed dial frame ≤ ${DIAL_BUDGET} characters`, dialMax <= DIAL_BUDGET, `largest ${dialMax}`);
	check("no action or global settings written (appear, ticks, gaps, a restart, a page change, a unit change)", settingsWrites.length === 0, JSON.stringify(settingsWrites));
	assert.equal(plugin.exit, null, "the plugin process survived the run");
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
	if (errors.length) runError = new AggregateError(errors, "Trend window scenario or owned cleanup failed");
}

if (runError) throw runError;
console.log(failures === 0 ? "\nTREND WINDOW E2E: ALL CHECKS PASSED" : `\nTREND WINDOW E2E: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
