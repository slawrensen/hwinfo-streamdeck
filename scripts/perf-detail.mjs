// Dense detail-view load measurement: the built plugin on a mock + XL
// with the REAL shipped detail-plus-xl surface (32 reading slots + 4 nav
// tiles) against live HWiNFO at the 250 ms poll option. Samples the
// plugin process (CPU cumulative seconds, RSS, handles) every 15 s via
// CIM and prints a PERF.md-ready summary plus per-sample CSV lines.
//   node scripts/perf-detail.mjs          (PERF_DETAIL_SEC=480 default)
//   PERF_DETAIL_DENSITY=2|3|4  readings per tile (detailDensity); at 4
//                              every tile composes a quad face and one
//                              page carries up to 128 readings
//   PERF_DETAIL_FILTER="*"     open a filter group instead of the first
//                              reading's source, so every tile is FULL
//                              at any density (the honest worst case;
//                              source mode may leave trailing tiles
//                              blank when the source is small)
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { profileCells } from "./lib/profile-cells.mjs";

const execFileAsync = promisify(execFile);
const PORT = 28993;
const DURATION_SEC = Number(process.env.PERF_DETAIL_SEC ?? "") || 480;
const SAMPLE_SEC = 15;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cells = profileCells(pluginDir, "profiles/detail-plus-xl");

let frames = 0;
let switches = 0;
let treePayload = null;
let scenarioFailed = null;
const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });

wss.on("connection", (ws) => {
	const send = (obj) => ws.send(JSON.stringify(obj));
	ws.on("message", (data) => {
		const msg = JSON.parse(data.toString());
		if (msg.event === "registerPlugin") {
			scenario(send).catch((err) => {
				scenarioFailed = String(err);
			});
		} else if (msg.event === "getGlobalSettings") {
			send({ event: "didReceiveGlobalSettings", payload: { settings: { pollIntervalMs: "250" } } });
		} else if (msg.event === "setImage") {
			frames++;
		} else if (msg.event === "switchToProfile") {
			switches++;
		} else if (msg.event === "sendToPropertyInspector" && msg.payload?.event === "sensorTree") {
			treePayload = msg.payload;
		}
	});
});

async function scenario(send) {
	send({
		event: "willAppear",
		action: "com.lawrensen.hwinfo.reading",
		context: "perf-opener",
		device: "devxl",
		payload: { settings: {}, coordinates: { column: 1, row: 1 }, controller: "Keypad", isInMultiAction: false }
	});
	await sleep(1500);
	send({ event: "propertyInspectorDidAppear", action: "com.lawrensen.hwinfo.reading", context: "perf-opener", device: "devxl" });
	send({ event: "sendToPlugin", action: "com.lawrensen.hwinfo.reading", context: "perf-opener", payload: { event: "getSensorTree" } });
	await sleep(800);
	send({ event: "propertyInspectorDidDisappear", action: "com.lawrensen.hwinfo.reading", context: "perf-opener", device: "devxl" });
	const first = treePayload?.groups?.flatMap((g) => g.readings.map((r) => r.key))[0];
	if (first === undefined) {
		throw new Error("no live readings; is HWiNFO running?");
	}
	const density = process.env.PERF_DETAIL_DENSITY ?? "";
	const filter = process.env.PERF_DETAIL_FILTER ?? "";
	const settings = {
		readingKey: first,
		pressBehavior: "open-details",
		...(density === "" ? {} : { detailDensity: density }),
		...(filter === "" ? {} : { detailMode: "filter", detailFilter: filter })
	};
	send({ event: "didReceiveSettings", action: "com.lawrensen.hwinfo.reading", context: "perf-opener", device: "devxl", payload: { settings, coordinates: { column: 1, row: 1 }, isInMultiAction: false } });
	await sleep(300);
	send({ event: "keyDown", action: "com.lawrensen.hwinfo.reading", context: "perf-opener", device: "devxl", payload: { settings, coordinates: { column: 1, row: 1 } } });
	send({ event: "keyUp", action: "com.lawrensen.hwinfo.reading", context: "perf-opener", device: "devxl", payload: { settings, coordinates: { column: 1, row: 1 } } });
	await sleep(400);
	send({ event: "willDisappear", action: "com.lawrensen.hwinfo.reading", context: "perf-opener", device: "devxl", payload: { settings, coordinates: { column: 1, row: 1 }, controller: "Keypad", isInMultiAction: false } });
	for (const cell of cells) {
		const [column, row] = cell.coord.split(",").map(Number);
		send({
			event: "willAppear",
			action: cell.uuid,
			context: `perf-slot-${cell.coord}`,
			device: "devxl",
			payload: { settings: cell.settings, coordinates: { column, row }, controller: "Keypad", isInMultiAction: false }
		});
	}
	console.log(`# dense surface up: ${cells.length} slots, density ${density === "" ? 1 : density}, ${filter === "" ? "source mode" : `filter ${JSON.stringify(filter)}`}, poll 250 ms, ${DURATION_SEC} s run`);
}

async function sampleProcess(pid) {
	const ps = `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object WorkingSetSize,HandleCount,ThreadCount,KernelModeTime,UserModeTime | ConvertTo-Json`;
	const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", ps], { timeout: 20000 });
	const row = JSON.parse(stdout.trim() || "null");
	if (row === null) {
		return null;
	}
	// KernelModeTime/UserModeTime are 100 ns units.
	return { rss: Number(row.WorkingSetSize), handles: Number(row.HandleCount), threads: Number(row.ThreadCount), cpuS: (Number(row.KernelModeTime) + Number(row.UserModeTime)) / 1e7 };
}

const info = {
	application: { font: "Segoe UI", language: "en", platform: "windows", platformVersion: "10.0.19044", version: "7.4.2.22730" },
	colors: {},
	devicePixelRatio: 1,
	devices: [{ id: "devxl", name: "Perf + XL", size: { columns: 9, rows: 4 }, type: 13 }],
	plugin: { uuid: "com.lawrensen.hwinfo", version: "1.0.0.0" }
};
const plugin = spawn(process.execPath, ["bin/plugin.js", "-port", String(PORT), "-pluginUUID", "perf-detail", "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)], {
	cwd: pluginDir,
	stdio: ["ignore", "inherit", "inherit"]
});
let pluginExited = false;
plugin.on("exit", () => {
	pluginExited = true;
});

await sleep(5000);
const samples = [];
console.log("tsSec,cpuS,rssMB,handles,threads,frames");
const startedAt = Date.now();
while (Date.now() - startedAt < DURATION_SEC * 1000) {
	await sleep(SAMPLE_SEC * 1000);
	if (pluginExited) {
		break;
	}
	const s = await sampleProcess(plugin.pid);
	if (s !== null) {
		samples.push({ ...s, at: (Date.now() - startedAt) / 1000, frames });
		console.log(`${Math.round((Date.now() - startedAt) / 1000)},${s.cpuS.toFixed(2)},${(s.rss / 1048576).toFixed(1)},${s.handles},${s.threads},${frames}`);
	}
}

const ok = !pluginExited && scenarioFailed === null && samples.length >= 3;
if (ok) {
	const cpuDeltas = [];
	for (let i = 1; i < samples.length; i++) {
		const dt = samples[i].at - samples[i - 1].at;
		cpuDeltas.push(((samples[i].cpuS - samples[i - 1].cpuS) / dt) * 100);
	}
	cpuDeltas.sort((a, b) => a - b);
	const p95 = cpuDeltas[Math.min(cpuDeltas.length - 1, Math.ceil(cpuDeltas.length * 0.95) - 1)];
	const avg = cpuDeltas.reduce((a, b) => a + b, 0) / cpuDeltas.length;
	const rssFirst = samples[0].rss / 1048576;
	const rssLast = samples[samples.length - 1].rss / 1048576;
	const minutes = (samples[samples.length - 1].at - samples[0].at) / 60;
	const lastFrames = samples[samples.length - 1].frames;
	console.log(`# SUMMARY dense +XL detail @250ms density=${process.env.PERF_DETAIL_DENSITY ?? "1"}${(process.env.PERF_DETAIL_FILTER ?? "") === "" ? "" : ` filter=${process.env.PERF_DETAIL_FILTER}`} over ${Math.round(samples[samples.length - 1].at)}s: CPU avg ${avg.toFixed(2)}% p95 ${p95.toFixed(2)}%, RSS ${rssFirst.toFixed(1)} -> ${rssLast.toFixed(1)} MB (${(((rssLast - rssFirst) / minutes) * 30).toFixed(2)} MB/30min), handles ${samples[0].handles} -> ${samples[samples.length - 1].handles}, ${lastFrames} frames (${(lastFrames / samples[samples.length - 1].at).toFixed(1)}/s), switches ${switches}`);
} else {
	console.error(`# FAILED: exited=${pluginExited} scenario=${scenarioFailed ?? "ok"} samples=${samples.length}`);
}
for (const client of wss.clients) {
	client.close();
}
wss.close();
await sleep(1500);
if (!pluginExited) {
	plugin.kill();
}
process.exit(ok ? 0 : 1);
