// Matched plugin-side performance comparison: runs two (or more) builds of
// the plugin through the SAME mock Stream Deck app, the same settings
// documents and the same producer, in ABBA order, and reports what the
// PLUGIN process costs and sends. It never measures the Stream Deck app or
// a device: the mock app is a WebSocket in this process.
//
//   node scripts/perf-plugin.mjs \
//     --subject 1.7.1=<pack.streamDeckPlugin | plugin dir> \
//     --subject 1.8=com.lawrensen.hwinfo.sdPlugin \
//     --workload deck [--workload dense ...] \
//     [--source catalog|live] [--warmup 20] [--measure 40] [--repeat 2] \
//     [--out result.json] [--dump <dir>]
//
// Sources: "catalog" (default) is scripts/fake-hwinfo-catalog.mjs, a real
// named mapping of 600 synthetic readings republished every second;
// "live" reads the running HWiNFO's Shared Memory (read-only), with the
// reading inventory taken once from `src/probe.ts --json` so every
// subject binds the same keys. Workloads are in scripts/lib/perf-workloads.mjs.
//
// Per run: the plugin starts as `node --import perf-probe-preload.mjs
// bin/plugin.js ...` (the in-process sampler: CPU, memory, event loop, GC
// and allocation once a second), an external PowerShell loop samples
// private bytes, handles, working set and processor time every 2 s, and
// the mock app records every message the plugin sends (event, context,
// bytes). `--merge a.json b.json ...` pools the runs of result files from
// the same harness and prints the tables and a one-row-per-workload
// summary. After --warmup seconds the --measure window is cut from all
// three. Medians over runs per subject go to a markdown table; every run's
// figures are in the JSON.
import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { WebSocketServer } from "ws";
import { buildInfo, decodeSvg, pluginArgv, sleep, waitUntil } from "./lib/e2e-common.mjs";
import { catalogReadings } from "./lib/perf-catalog.mjs";
import { calibrateCycleHz, openCycleReader } from "./lib/perf-cycles.mjs";
import { abbaOrder, cycleWindowStats, osWindowStats, parseOsLine, probeWindowStats, renderSummary, renderTable, trafficStats } from "./lib/perf-metrics.mjs";
import { resolveSubject, sha256 } from "./lib/perf-subject.mjs";
import { appearMessage, buildWorkload, WORKLOADS } from "./lib/perf-workloads.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRELOAD = path.join(repoRoot, "scripts", "lib", "perf-probe-preload.mjs");
const OS_SAMPLE_MS = 2000;
/** A last frame that is a status screen, not a reading (sanity only). */
const STATUS_FACE = /Sensor missing|Pick a sensor|Start HWiNFO|Source busy|Source error|Not updating/;

function parseArgs(argv) {
	const opts = { subjects: [], workloads: [], source: "catalog", warmup: 45, measure: 45, repeat: 2, out: null, dump: null, merge: [] };
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		const value = argv[i + 1];
		if (flag === "--subject") opts.subjects.push(value);
		else if (flag === "--workload") opts.workloads.push(...value.split(","));
		else if (flag === "--source") opts.source = value;
		else if (flag === "--warmup") opts.warmup = Number(value);
		else if (flag === "--measure") opts.measure = Number(value);
		else if (flag === "--repeat") opts.repeat = Number(value);
		else if (flag === "--out") opts.out = value;
		else if (flag === "--dump") opts.dump = value;
		else if (flag === "--merge") {
			opts.merge = argv.slice(i + 1);
			break;
		}
		else if (flag === "--list") {
			for (const [name, def] of Object.entries(WORKLOADS)) console.log(`${name.padEnd(24)} ${def.description}`);
			process.exit(0);
		} else throw new Error(`unknown argument ${flag}`);
		i++;
	}
	if (opts.merge.length > 0) return opts;
	if (opts.subjects.length === 0) opts.subjects.push(`checkout=${path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin")}`);
	if (opts.workloads.length === 0) throw new Error("name at least one --workload (--list shows them)");
	if (!["catalog", "live"].includes(opts.source)) throw new Error("--source is catalog or live");
	for (const k of ["warmup", "measure", "repeat"]) if (!Number.isFinite(opts[k]) || opts[k] <= 0) throw new Error(`--${k} must be a positive number`);
	return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.merge.length > 0) {
	mergeResults(opts.merge);
	process.exit(0);
}
const subjects = opts.subjects.map((spec) => resolveSubject(spec));
if (new Set(subjects.map((s) => s.label)).size !== subjects.length) throw new Error("subject labels must differ");

async function liveReadings() {
	const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "src/probe.ts", "--json"], { cwd: repoRoot, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
	return JSON.parse(stdout).readings.map((r) => ({ key: r.key, label: r.label, unit: r.unit, type: r.type }));
}

const cycleHz = calibrateCycleHz();
console.log(`cycle counter: ${(cycleHz / 1e9).toFixed(3)} GHz`);
const readings = opts.source === "live" ? await liveReadings() : catalogReadings();
console.log(`source ${opts.source}: ${readings.length} readings`);

function startProducer(env, script, args) {
	const child = spawn(process.execPath, [path.join(repoRoot, "scripts", script), ...args], { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, ...env } });
	let text = "";
	const ready = new Promise((resolve, reject) => {
		child.stdout.on("data", (chunk) => {
			text += chunk.toString();
			if (text.includes("READY")) resolve();
		});
		child.once("exit", () => reject(new Error(`${script} exited before READY`)));
	});
	return { child, ready, command: (line) => child.stdin.write(`${line}\n`) };
}

async function stopProducer(p) {
	if (p.child.exitCode !== null) return;
	p.command("exit");
	await Promise.race([new Promise((r) => p.child.once("exit", r)), sleep(3000).then(() => p.child.kill())]);
}

/** One long-lived PowerShell loop for the plugin PID (cheaper and steadier
 * than a process per sample): unix ms, private bytes, handles, working
 * set, total processor ms. */
function startOsSampler(pid, sink) {
	const script = `while ($true) { $p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if (-not $p) { break }; [Console]::Out.WriteLine(('{0} {1} {2} {3} {4}' -f [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(), $p.PrivateMemorySize64, $p.HandleCount, $p.WorkingSet64, [math]::Round($p.TotalProcessorTime.TotalMilliseconds))); [Console]::Out.Flush(); Start-Sleep -Milliseconds ${OS_SAMPLE_MS} }`;
	const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["ignore", "pipe", "ignore"] });
	let buffer = "";
	child.stdout.on("data", (chunk) => {
		buffer += chunk.toString();
		let nl;
		while ((nl = buffer.indexOf("\n")) >= 0) {
			const parsed = parseOsLine(buffer.slice(0, nl));
			buffer = buffer.slice(nl + 1);
			if (parsed !== null) sink.push(parsed);
		}
	});
	return child;
}

/** The warm-up: at least --warmup, and long enough to fill the
 * workload's history window (plus 15 s) so the window is measured full. */
function warmupFor(workload) {
	return Math.max(opts.warmup, workload.fillS > 0 ? workload.fillS + 15 : 0);
}

/**
 * Combines result files of the same harness (for a long window run split
 * over two invocations with the subject order swapped, A B then B A):
 * runs of a workload are pooled per subject label, refusing a different
 * harness, method or subject bytes.
 */
function mergeResults(files) {
	const docs = files.map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
	const [first] = docs;
	const key = (d) => JSON.stringify([d.method.harnessSha256, d.method.source, d.method.readings, d.method.measureS]);
	for (const d of docs) {
		if (key(d) !== key(first)) throw new Error("merge: the files ran different harnesses, sources or windows");
		for (const s of d.subjects) {
			const mine = first.subjects.find((x) => x.label === s.label);
			if (mine !== undefined && mine.pluginJsSha256 !== s.pluginJsSha256) throw new Error(`merge: subject ${s.label} ran different bytes`);
		}
	}
	const labels = first.subjects.map((s) => s.label);
	const names = [...new Set(docs.flatMap((d) => d.workloads.map((w) => w.name)))];
	const merged = names.map((name) => ({ name, runs: docs.flatMap((d) => d.workloads.filter((w) => w.name === name).flatMap((w) => w.runs)) }));
	for (const { name, runs } of merged) {
		console.log(`\n## ${name} (${runs.length} runs: ${runs.map((r) => r.subject).join(" ")})\n`);
		console.log(renderTable(runs, labels));
	}
	if (labels.length === 2) console.log(`\n## summary\n\n${renderSummary(merged, labels)}`);
}

async function runOnce(subject, workload, runIndex) {
	const tag = `${process.pid}_${runIndex}`;
	const env = { HWINFO_VSB_KEY: `Software\\HwinfoPerfAbsent_${tag}` };
	const producers = [];
	if (opts.source === "catalog") {
		env.HWINFO_SM2_NAME = `Local\\HwinfoPerf_${tag}`;
		env.HWINFO_SM2_MUTEX_NAME = `${env.HWINFO_SM2_NAME}_MUTEX`;
		producers.push(startProducer(env, "fake-hwinfo-catalog.mjs", []));
	}
	await Promise.all(producers.map((p) => p.ready));

	const probeOut = path.join(os.tmpdir(), `hwinfo-perf-probe-${tag}.jsonl`);
	fs.rmSync(probeOut, { force: true });
	const messages = [];
	const lastFrame = new Map();
	let globals = structuredClone(workload.globals);
	let writes = 0;
	let globalWrites = 0;
	let registeredAt = null;

	const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
	await new Promise((resolve) => wss.once("listening", resolve));
	wss.on("connection", (ws) => {
		const send = (obj) => ws.send(JSON.stringify(obj));
		ws.on("message", (data) => {
			const at = Date.now();
			const msg = JSON.parse(data.toString());
			messages.push({ at, event: msg.event, context: msg.context, bytes: data.length });
			switch (msg.event) {
				case "registerPlugin":
					registeredAt = at;
					for (const ctx of workload.contexts) send(appearMessage(ctx));
					break;
				case "getGlobalSettings":
					send({ event: "didReceiveGlobalSettings", payload: { settings: globals } });
					break;
				case "setSettings":
					writes++;
					break;
				case "setGlobalSettings":
					globalWrites++;
					globals = msg.payload;
					break;
				case "setImage":
				case "setFeedback":
					lastFrame.set(msg.context, msg.event === "setImage" ? msg.payload?.image : msg.payload?.canvas);
					break;
				default:
					break;
			}
		});
	});

	const info = buildInfo({ devices: workload.devices, plugin: { uuid: "com.lawrensen.hwinfo", version: subject.manifestVersion } });
	const argv = pluginArgv(wss.address().port, `perf-${tag}`, info);
	const plugin = spawn(process.execPath, ["--import", pathToFileURL(PRELOAD).href, ...argv], {
		cwd: subject.dir,
		stdio: ["ignore", "ignore", "pipe"],
		env: { ...process.env, ...env, HWINFO_PERF_PROBE_OUT: probeOut }
	});
	let stderr = "";
	plugin.stderr.on("data", (chunk) => {
		stderr = (stderr + chunk.toString()).slice(-4000);
	});
	const osSamples = [];
	const sampler = startOsSampler(plugin.pid, osSamples);
	const cycleReader = openCycleReader(plugin.pid);
	const cycleSamples = [];
	const readCycles = () => {
		const cycles = cycleReader?.read() ?? null;
		if (cycles !== null) cycleSamples.push({ at: Date.now(), cycles });
	};
	const cycleTimer = setInterval(readCycles, 1000);

	try {
		if (!(await waitUntil(() => registeredAt !== null, 15_000, 50))) throw new Error(`plugin never registered (${subject.label}): ${stderr}`);
		await sleep(warmupFor(workload) * 1000);
		readCycles();
		const from = cycleSamples.at(-1)?.at ?? Date.now();
		await sleep(opts.measure * 1000);
		readCycles();
		const to = cycleSamples.at(-1)?.at ?? Date.now();
		if (plugin.exitCode !== null) throw new Error(`plugin exited during the run (code ${plugin.exitCode}): ${stderr}`);
		const lines = fs.existsSync(probeOut) ? fs.readFileSync(probeOut, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
		const drawn = new Set(messages.filter((m) => (m.event === "setImage" || m.event === "setFeedback") && m.at >= registeredAt).map((m) => m.context));
		const statusContexts = [...lastFrame.values()].filter((uri) => STATUS_FACE.test(decodeSvg(uri) ?? "")).length;
		if (opts.dump !== null) {
			const dir = path.join(opts.dump, workload.name, subject.label);
			fs.mkdirSync(dir, { recursive: true });
			for (const [context, uri] of lastFrame) {
				const svg = decodeSvg(uri);
				if (svg !== null) fs.writeFileSync(path.join(dir, `${context}.svg`), svg);
			}
		}
		return {
			subject: subject.label,
			run: runIndex,
			window: { from, to },
			cycles: cycleWindowStats(cycleSamples, from, to, cycleHz),
			probe: probeWindowStats(lines, from, to),
			os: osWindowStats(osSamples, from, to),
			traffic: trafficStats(messages, from, to),
			contexts: workload.contexts.length,
			contextsDrawn: workload.contexts.filter((c) => drawn.has(c.context)).length,
			statusContexts,
			settingsWrites: writes,
			globalWrites
		};
	} finally {
		clearInterval(cycleTimer);
		cycleReader?.close();
		const exited = new Promise((resolve) => (plugin.exitCode !== null ? resolve() : plugin.once("exit", resolve)));
		for (const client of wss.clients) client.close();
		wss.close();
		await Promise.race([exited, sleep(5000).then(() => plugin.kill())]);
		sampler.kill();
		for (const p of producers.reverse()) await stopProducer(p);
		fs.rmSync(probeOut, { force: true });
	}
}

const harnessFiles = ["scripts/perf-plugin.mjs", "scripts/lib/perf-cycles.mjs", "scripts/lib/perf-metrics.mjs", "scripts/lib/perf-workloads.mjs", "scripts/lib/perf-catalog.mjs", "scripts/lib/perf-probe-preload.mjs", "scripts/lib/perf-subject.mjs", "scripts/fake-hwinfo-catalog.mjs"];
const result = {
	method: {
		harnessSha256: sha256(harnessFiles.map((f) => fs.readFileSync(path.join(repoRoot, f))).join("\n")),
		node: process.version,
		os: `${os.type()} ${os.release()}`,
		cpu: os.cpus()[0]?.model ?? "unknown",
		cores: os.cpus().length,
		source: opts.source,
		readings: readings.length,
		warmupS: opts.warmup,
		measureS: opts.measure,
		repeat: opts.repeat,
		order: "ABBA",
		probeIntervalMs: 1000,
		cycleHz,
		osIntervalMs: OS_SAMPLE_MS,
		date: new Date().toISOString()
	},
	subjects,
	workloads: []
};

const labels = subjects.map((s) => s.label);
for (const name of opts.workloads) {
	const workload = buildWorkload(name, readings);
	const order = abbaOrder(subjects, opts.repeat);
	console.log(`\n## ${name}: ${workload.description}\n   ${workload.contexts.length} contexts; warm-up ${warmupFor(workload)} s, window ${opts.measure} s; order ${order.map((s) => s.label).join(" ")}`);
	const runs = [];
	for (const [i, subject] of order.entries()) {
		const run = await runOnce(subject, workload, i);
		runs.push(run);
		console.log(`   run ${i + 1}/${order.length} ${subject.label}: cpu ${run.cycles.cpuPctOneCore?.toFixed(3) ?? "n/a"}% (process times ${run.probe.cpuPctOneCore?.toFixed(2) ?? "n/a"}%, OS ${run.os.cpuPctOneCore?.toFixed(2) ?? "n/a"}%), rss ${run.probe.rssMB.p50?.toFixed(1) ?? "n/a"} MB, private ${run.os.privateMB.p50?.toFixed(1) ?? "n/a"} MB, handles ${run.os.handles.p50 ?? "n/a"}, image ${run.traffic.setImage.callsPerSec?.toFixed(1)}/s, feedback ${run.traffic.setFeedback.callsPerSec?.toFixed(1)}/s, drawn ${run.contextsDrawn}/${run.contexts} (status ${run.statusContexts}), writes ${run.settingsWrites}+${run.globalWrites}`);
		await sleep(2000);
	}
	const table = renderTable(runs, labels);
	console.log(`\n${table}`);
	result.workloads.push({ name, description: workload.description, contexts: workload.contexts.length, warmupS: warmupFor(workload), runs, table });
	if (opts.out !== null) fs.writeFileSync(opts.out, JSON.stringify(result, null, 2));
}
process.exit(0);
