// Key alerts e2e: drives the BUILT plugin over a mock Stream Deck socket
// against the synthetic HWiNFO provider (scripts/fake-hwinfo.mjs) and
// asserts on the faces that come back and the settings the keys write.
//
// Legs:
//   a reading past Warn recolors the key
//   the opted-in tap snoozes (the theme returns, the band shows, nothing
//   written) and the next tap cycles the stat as usual
//   Alert after holds the level back at first and shows it once it lasted
//   a second reading's own limit recolors a dual key and the other row gives
//   way; without alertRules a dual key alerts on reading 1 alone, as before
//   no key writes its settings outside a stat cycle
//
// Run with `npm run e2e:key-alerts` (after `npm run build`).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { buildInfo, decodeSvg, makeCheck, pluginArgv, sleep, waitUntil } from "./lib/e2e-common.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");
if (!fs.existsSync(path.join(pluginDir, "bin", "plugin.js"))) {
	console.error("e2e-key-alerts: no bin/plugin.js; run npm run build first.");
	process.exit(2);
}

const MAPPING_NAME = `Local\\HwinfoE2E_KeyAlerts_${process.pid}`;
const MUTEX_NAME = `${MAPPING_NAME}_MUTEX`;
const TEMP = "f0001234:0:1000001"; // "Test Temp", advancing
const FAN = "f0001234:0:1000002"; // "Test Fan", a constant 1200 RPM
const WARN_BG = "#E8940D"; // themes.json alerts.warn.bg
const WARN_UNIT = "#503900"; // themes.json alerts.warn.unit
const BAND = /<rect x="10" y="10" width="124" height="3" fill="#[0-9A-Fa-f]{6}"\/>/;

let failures = 0;
const checksRun = [];
const baseCheck = makeCheck(() => {
	failures += 1;
});
const check = (name, ok, detail = "") => {
	checksRun.push(name);
	baseCheck(name, ok, detail);
};

const frames = new Map(); // context -> decoded SVG frames
const settingsWrites = []; // { context, payload }
let globals = { pollIntervalMs: "250" };
let pluginWs = null;
let registered = false;

const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
wss.on("connection", (ws) => {
	pluginWs = ws;
	ws.on("message", (data) => {
		const msg = JSON.parse(data.toString());
		switch (msg.event) {
			case "registerPlugin":
				registered = true;
				break;
			case "getGlobalSettings":
				send({ event: "didReceiveGlobalSettings", payload: { settings: globals } });
				break;
			case "setGlobalSettings":
				globals = msg.payload;
				break;
			case "setSettings":
				settingsWrites.push({ context: msg.context, payload: msg.payload });
				break;
			case "setImage": {
				const svg = decodeSvg(msg.payload?.image);
				if (svg !== null) {
					const list = frames.get(msg.context) ?? [];
					list.push(svg);
					frames.set(msg.context, list);
				}
				break;
			}
			default:
				break;
		}
	});
});
const send = (obj) => pluginWs?.send(JSON.stringify(obj));

const keys = new Map(); // context -> settings
const coords = new Map();
let nextColumn = 0;
function appear(context, settings) {
	keys.set(context, settings);
	if (!coords.has(context)) {
		coords.set(context, { column: nextColumn % 5, row: Math.floor(nextColumn / 5) % 3 });
		nextColumn++;
	}
	send({ event: "willAppear", action: "com.lawrensen.hwinfo.reading", context, device: "dev1", payload: { settings, coordinates: coords.get(context), controller: "Keypad", isInMultiAction: false } });
}
function key(event, context) {
	send({ event, action: "com.lawrensen.hwinfo.reading", context, device: "dev1", payload: { settings: keys.get(context) ?? {}, coordinates: coords.get(context) ?? { column: 0, row: 0 }, isInMultiAction: false } });
}
async function tap(context) {
	key("keyDown", context);
	await sleep(80);
	key("keyUp", context);
	await sleep(250);
}
const lastFace = (context) => frames.get(context)?.at(-1) ?? "";

// --- processes ------------------------------------------------------------
const owned = [];
function own(child, name) {
	const record = { child, name, exit: null };
	child.once("exit", (code, signal) => {
		record.exit = { code, signal };
	});
	owned.push(record);
	return record;
}

async function startFake() {
	const record = own(spawn(process.execPath, [path.join(repoRoot, "scripts", "fake-hwinfo.mjs")], { env: { ...process.env, HWINFO_SM2_NAME: MAPPING_NAME, HWINFO_SM2_MUTEX_NAME: MUTEX_NAME }, stdio: ["pipe", "pipe", "inherit"], windowsHide: true }), "fake HWiNFO");
	let output = "";
	record.child.stdout.on("data", (d) => {
		output += d.toString();
	});
	assert.ok(await waitUntil(() => output.includes(`READY ${MAPPING_NAME}`), 5000), "the fake producer did not get ready");
}

let scenarioError = null;
try {
	await waitUntil(() => wss.address() !== null, 5000);
	await startFake();
	const port = wss.address().port;
	own(
		spawn(process.execPath, pluginArgv(port, "e2e-key-alerts", buildInfo({ devices: [{ id: "dev1", name: "Alert Deck", size: { columns: 5, rows: 3 }, type: 0 }] })), {
			cwd: pluginDir,
			env: {
				...process.env,
				HWINFO_SM2_NAME: MAPPING_NAME,
				HWINFO_SM2_MUTEX_NAME: MUTEX_NAME,
				HWINFO_VSB_KEY: `Software\\HwinfoE2E_NoVSB_${process.pid}`,
				HWINFO_STALE_AFTER_MS: "2500",
				HWINFO_REOPEN_PROBE_MS: "1000"
			},
			stdio: ["ignore", "inherit", "inherit"],
			windowsHide: true
		}),
		"plugin"
	);
	assert.ok(await waitUntil(() => registered, 10000), "the plugin did not register");
	await sleep(300);

	// Alerts on the key face.
	appear("ctx-warn", { readingKey: FAN, warnValue: "1000", alertSnoozeMs: "300000" });
	await waitUntil(() => lastFace("ctx-warn").includes(`fill="${WARN_BG}"`), 4000);
	check("a reading past Warn recolors the key", lastFace("ctx-warn").includes(`fill="${WARN_BG}"`));
	await tap("ctx-warn");
	check("the opted-in tap snoozes: the theme returns and the band shows", !lastFace("ctx-warn").includes(`fill="${WARN_BG}"`) && BAND.test(lastFace("ctx-warn")) && settingsWrites.filter((w) => w.context === "ctx-warn").length === 0);
	await tap("ctx-warn");
	check("the next tap cycles the stat as usual", settingsWrites.filter((w) => w.context === "ctx-warn").length === 1);

	appear("ctx-dwell", { readingKey: FAN, warnValue: "1000", alertDwellMs: "2000" });
	await sleep(700);
	check("Alert after holds the level back at first", lastFace("ctx-dwell") !== "" && !lastFace("ctx-dwell").includes(`fill="${WARN_BG}"`));
	await waitUntil(() => lastFace("ctx-dwell").includes(`fill="${WARN_BG}"`), 5000);
	check("and shows it once it lasted", lastFace("ctx-dwell").includes(`fill="${WARN_BG}"`));

	appear("ctx-dual", { readingKey: TEMP, secondaryReadingKey: FAN, keyLayout: "dual", alertRules: { [FAN]: { warn: "1000", unit: "RPM" } } });
	await waitUntil(() => lastFace("ctx-dual").includes(`fill="${WARN_BG}"`), 4000);
	check("a second reading's own limit recolors a dual key, and the other row gives way", lastFace("ctx-dual").includes(`fill="${WARN_BG}"`) && lastFace("ctx-dual").includes(`font-weight="700" fill="${WARN_UNIT}"`));
	appear("ctx-legacy-dual", { readingKey: TEMP, secondaryReadingKey: FAN, keyLayout: "dual", warnValue: "1000" });
	await sleep(700);
	check("without alertRules a dual key alerts on reading 1 alone, as before", lastFace("ctx-legacy-dual") !== "" && !lastFace("ctx-legacy-dual").includes(`fill="${WARN_BG}"`));

	check("no key wrote its settings outside a stat cycle", settingsWrites.every((w) => w.context === "ctx-warn"), JSON.stringify(settingsWrites.map((w) => w.context)));
} catch (error) {
	scenarioError = error;
} finally {
	for (const record of owned) {
		if (record.exit === null && record.child.pid !== undefined) record.child.kill();
	}
	await waitUntil(() => owned.every((r) => r.exit !== null), 5000);
	for (const client of wss.clients) client.terminate();
	wss.close();
}

if (scenarioError) {
	console.error(scenarioError);
	failures += 1;
}
for (const required of [
	"a reading past Warn recolors the key",
	"the opted-in tap snoozes: the theme returns and the band shows",
	"the next tap cycles the stat as usual",
	"Alert after holds the level back at first",
	"and shows it once it lasted",
	"a second reading's own limit recolors a dual key, and the other row gives way",
	"without alertRules a dual key alerts on reading 1 alone, as before"
]) {
	if (!checksRun.includes(required)) {
		console.log(`FAIL  required leg did not run: ${required}`);
		failures += 1;
	}
}
console.log(failures === 0 ? `\nKEY ALERTS E2E: ALL ${checksRun.length} CHECKS PASSED` : `\nKEY ALERTS E2E: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
