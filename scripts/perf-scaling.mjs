// Reproducible production-bundle scaling, without a live device or HWiNFO.
// The mock host observes output; the optional preload observes timer work.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import { buildInfo, decodeSvg, pluginArgv, sleep, waitUntil } from "./lib/e2e-common.mjs";
import { createChildCleanup } from "./lib/process-ownership.mjs";
import { analyzeGenerations, distribution, frameGeneration } from "./lib/scaling-metrics.mjs";
import { readingKey } from "./lib/scaling-producer.mjs";
import { report } from "./scaling-report.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clock = () => Number(process.hrtime.bigint()) / 1e6;
const hash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const args = process.argv.slice(2);
const valueOptions = new Set(["--seconds", "--warmup", "--repeat", "--out", "--config", "--label"]);
const switches = new Set(["--smoke", "--strict"]);
const seenOptions = new Set();
for (let index = 0; index < args.length; index++) {
	const name = args[index];
	assert.ok(valueOptions.has(name) || switches.has(name), `Unknown option: ${name}`);
	assert.ok(!seenOptions.has(name), `Duplicate option: ${name}`);
	seenOptions.add(name);
	if (valueOptions.has(name)) assert.ok(args[++index] && !args[index].startsWith("--"), `${name} needs a value`);
}
const option = (name, fallback) => {
	const index = args.indexOf(name);
	if (index < 0) return fallback;
	assert.ok(args[index + 1] && !args[index + 1].startsWith("--"), `${name} needs a value`);
	return args[index + 1];
};
const smoke = args.includes("--smoke");
const seconds = Number(option("--seconds", smoke ? "8" : "120"));
const warmup = Number(option("--warmup", smoke ? "3" : "30"));
const repeats = Number(option("--repeat", smoke ? "1" : "3"));
const strict = args.includes("--strict");
assert.ok(Number.isFinite(seconds) && seconds >= 4 && seconds <= 900, "seconds must be 4..900");
assert.ok(Number.isFinite(warmup) && warmup >= 2 && warmup <= 120, "warmup must be 2..120");
assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 10, "repeat must be 1..10");
const output = path.resolve(option("--out", path.join(root, "release", `scaling-${Date.now()}`)));
assert.ok(!fs.existsSync(output), "Output must be a new directory; failed evidence is never overwritten");
fs.mkdirSync(output, { recursive: true });
const save = (name, value) => fs.writeFileSync(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`);
const base = { inventory: 512, keys: 36, dials: 6, rotation: 16, pollMs: 250, producerMs: 250, pi: false, rich: false, timing: true };
const cases = smoke ? [
	{ ...base, name: "mixed-250", rich: true, pi: true },
	{ ...base, name: "inventory-2048", inventory: 2048 },
	{ ...base, name: "control-250", timing: false }
] : [
	{ ...base, name: "small-250", inventory: 256, keys: 8, dials: 4 },
	{ ...base, name: "reference-1000", pollMs: 1000, producerMs: 2000 },
	{ ...base, name: "reference-250", producerMs: 2000 },
	{ ...base, name: "changing-250" },
	{ ...base, name: "inventory-2048", inventory: 2048 },
	{ ...base, name: "actions-84", keys: 72, dials: 12 },
	{ ...base, name: "mixed-250", rotation: 64, rich: true, pi: true },
	{ ...base, name: "control-250", timing: false }
];
const configFile = option("--config", null);
if (configFile !== null) {
	const configured = JSON.parse(fs.readFileSync(configFile, "utf8"));
	assert.ok(Array.isArray(configured) && configured.length > 0 && configured.length <= 20, "config must contain 1..20 workloads");
	cases.splice(0, cases.length, ...configured.map((entry) => ({ ...base, ...entry })));
}
for (const config of cases) {
	assert.ok(Object.keys(config).every((key) => key === "name" || Object.hasOwn(base, key)), "Unknown workload field");
	assert.match(config.name, /^[a-z0-9-]{1,60}$/);
	for (const [field, min, max] of [["inventory", 16, 8192], ["keys", 1, 288], ["dials", 1, 48], ["rotation", 1, 256]]) {
		assert.ok(Number.isInteger(config[field]) && config[field] >= min && config[field] <= max, `Invalid ${field}`);
	}
	assert.ok([250, 1000].includes(config.pollMs) && [250, 2000].includes(config.producerMs), "Supported poll: 250/1000; producer: 250/2000 ms");
	assert.ok(config.rotation <= config.inventory);
	for (const field of ["pi", "rich", "timing"]) assert.equal(typeof config[field], "boolean");
}
assert.equal(new Set(cases.map((c) => c.name)).size, cases.length, "Unique workload names required");
assert.equal(process.platform, "win32", "The real production native boundary requires Windows");
const original = path.join(root, "com.lawrensen.hwinfo.sdPlugin");
function bundleInventory(directory, relative = "") {
	return fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).filter((entry) => entry.name !== "logs").sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
		const name = path.join(relative, entry.name);
		return entry.isDirectory() ? bundleInventory(directory, name) : [{ path: name.replaceAll("\\", "/"), sha256: hash(path.join(directory, name)) }];
	});
}
const initialInventory = bundleInventory(original);
const metadata = {
	schema: 1, startedAt: new Date().toISOString(), mode: smoke ? "smoke" : "benchmark", seconds, warmup, repeats, strict,
	measurementMode: "synthetic-shared-memory-hrtime-v2",
	machine: { label: option("--label", os.hostname()), cpu: os.cpus().map(({ model, speed }) => ({ model, speed })), logicalCpus: os.cpus().length, totalMemory: os.totalmem(), freeMemory: os.freemem(), platform: os.platform(), release: os.release(), arch: os.arch(), node: process.version, execPath: process.execPath },
	source: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
	dirty: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim(),
	pluginSha256: initialInventory.find((entry) => entry.path === "bin/plugin.js")?.sha256, nativeSha256: initialInventory.find((entry) => entry.path === "bin/hwsm.node")?.sha256,
	bundleInventory: initialInventory,
	harnessSha256: hash(fileURLToPath(import.meta.url)), preloadSha256: hash(path.join(root, "scripts/lib/scaling-preload.mjs")), producerSha256: hash(path.join(root, "scripts/lib/scaling-producer.mjs")), metricsSha256: hash(path.join(root, "scripts/lib/scaling-metrics.mjs")), cases,
	limits: "Synthetic shared-memory producer and mock host. Callback and loop-drain timings are diagnostic, not physical display or full input-to-display latency. CPU is percent of one logical core. No low-spec extrapolation. Gadget is a separate backend."
};
try { metadata.machine.powerPlan = execFileSync("powercfg.exe", ["/getactivescheme"], { encoding: "utf8", windowsHide: true }).trim(); }
catch { metadata.machine.powerPlan = null; }
save("run.json", metadata);
const cleanup = createChildCleanup({ runDirectories: [output] });
const results = [];
let failure;
try {
	// Alternate order between repetitions to make order/thermal effects visible.
	for (let repeat = 0; repeat < repeats; repeat++) {
		for (const config of repeat % 2 ? [...cases].reverse() : cases) {
			const result = await runCase(config, repeat);
			results.push(result);
			save("results.json", results);
			console.log(`${result.ok ? "PASS" : "FAIL"} ${config.name} repeat ${repeat + 1}: CPU ${result.cpuPercentOneCore?.toFixed(2) ?? "unknown"}%, p95 callback ${result.callbackMs?.p95.toFixed(2) ?? "unmeasured"} ms, update coverage ${(100 * result.updates.coverageRatio).toFixed(1)}%`);
			if (!result.ok) throw new Error(`${config.name}: ${result.errors.join("; ")}`);
		}
	}
} catch (error) {
	failure = String(error?.stack ?? error);
} finally {
	try { cleanup.cleanup(); } catch (error) { failure = `${failure ?? ""}\n${error.stack}`; }
	const summary = { ...metadata, completedAt: new Date().toISOString(), ok: !failure, failure: failure ?? null, results };
	save("summary.json", summary);
	fs.writeFileSync(path.join(output, "summary.md"), report(summary));
}
if (failure) { console.error(failure); process.exitCode = 1; }
else console.log(`Scaling evidence: ${output}`);

async function runCase(config, repeat) {
	const directory = path.join(output, `${config.name}-${repeat + 1}`);
	fs.mkdirSync(directory);
	const record = (name, value) => fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
	const bundle = path.join(directory, "plugin");
	fs.cpSync(original, bundle, { recursive: true, filter: (source) => path.basename(source) !== "logs" });
	const copiedInventory = bundleInventory(bundle);
	record("bundle-inventory.json", copiedInventory);
	assert.deepEqual(copiedInventory, metadata.bundleInventory, "Bundle changed between workload copies");
	const mapping = `Local\\HwinfoScaling_${randomUUID().replaceAll("-", "")}`;
	const env = { ...process.env, HWINFO_SM2_NAME: mapping, HWINFO_SM2_MUTEX_NAME: `${mapping}_MUTEX`, HWINFO_VSB_KEY: `Software\\${mapping.slice(6)}`, HWSM_SCALING_POLL_MS: String(config.pollMs), HWSM_SCALING_TIMING: config.timing ? "1" : "0" };
	// Do not inherit live tracing, altered freshness deadlines, alternate
	// loaders or NODE_OPTIONS into a supposedly identical benchmark.
	for (const key of Object.keys(env)) if ((key.startsWith("HWINFO_") || key === "NODE_OPTIONS") && !["HWINFO_SM2_NAME", "HWINFO_SM2_MUTEX_NAME", "HWINFO_VSB_KEY"].includes(key)) delete env[key];
	const publications = [], frames = [], errors = [], children = [], messages = [], commands = [];
	let measuring = false, socket, bytes = 0, piMessages = 0;
	let measurement, startedAt, stoppedAt, collectorError, result, caseFailure;
	const expected = new Set(), initialized = new Set(), valueCounts = new Map(), sampleFrames = new Map();
	const actions = new Map();
	const devices = Array.from({ length: Math.max(Math.ceil(config.keys / 36), Math.ceil(config.dials / 6)) }, (_, i) => ({ id: `deck${i}`, name: `Synthetic + XL ${i}`, size: { columns: 9, rows: 4 }, type: 13 }));
	for (let i = 0; i < config.keys; i++) {
		valueCounts.set(`key${i}`, config.rich ? i % 4 + 1 : 1);
		const keys = Array.from({ length: 4 }, (_, slot) => readingKey((i * 4 + slot) % config.inventory));
		actions.set(`key${i}`, { action: "com.lawrensen.hwinfo.reading", device: `deck${Math.floor(i / 36)}`, payload: { controller: "Keypad", coordinates: { column: i % 9, row: Math.floor(i % 36 / 9) }, isInMultiAction: false, settings: { readingKey: keys[0], decimals: "0", sparkline: true, ...(config.rich ? { keyLayout: ["single", "dual", "triple", "quad"][i % 4], secondaryReadingKey: keys[1], quadReadingKey3: keys[2], quadReadingKey4: keys[3], warnValue: "1200", critValue: "1400", quadLabels: true } : {}) } } });
	}
	for (let i = 0; i < config.dials; i++) {
		valueCounts.set(`dial${i}`, config.rich ? Math.min(i % 3 + 1, Math.max(1, Math.floor(config.rotation / 2))) : 1);
		const keys = Array.from({ length: config.rotation }, (_, slot) => readingKey((i * config.rotation + slot) % config.inventory));
		actions.set(`dial${i}`, { action: "com.lawrensen.hwinfo.dial", device: `deck${Math.floor(i / 6)}`, payload: { controller: "Encoder", coordinates: { column: i % 6, row: 0 }, isInMultiAction: false, settings: { readingKey: keys[0], decimals: "0", rotationKeys: keys, controlPreset: "elite", ...(config.rich ? { dialView: ["single", "tworow", "overview"][i % 3], rotationGroups: [{ name: "A", keys: keys.slice(0, config.rotation / 2) }, { name: "B", keys: keys.slice(config.rotation / 2) }], autoCycleMs: "1000", sensorValueColors: true, touchZones: "three" } : {}) } } });
	}
	for (const context of actions.keys()) expected.add(context);
	const send = (message) => socket.send(JSON.stringify(message));
	const event = (name, context) => send({ event: name, context, ...actions.get(context) });
	const globals = { source: "shared-memory", pollIntervalMs: String(config.pollMs), ...(config.rich ? { readingLinks: Array.from({ length: 16 }, (_, i) => ({ sharedMemory: readingKey(i), gadget: `g:Synthetic:R${i}`, unit: "RPM", sensorType: 3 })) } : {}) };
	const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
	server.on("connection", (ws) => {
		socket = ws;
		ws.on("message", (data) => {
			const receivedAt = clock();
			try {
				const msg = JSON.parse(data.toString());
				if (msg.event === "registerPlugin") {
					for (const context of actions.keys()) event("willAppear", context);
					if (config.pi) send({ event: "propertyInspectorDidAppear", context: "key0", action: actions.get("key0").action, device: "deck0" });
				}
				if (msg.event === "getGlobalSettings") send({ event: "didReceiveGlobalSettings", payload: { settings: globals } });
				if (msg.event === "getSettings") send({ event: "didReceiveSettings", context: msg.context, ...actions.get(msg.context) });
				if (msg.event === "setSettings" && actions.has(msg.context)) actions.get(msg.context).payload.settings = msg.payload;
				if (msg.event === "sendToPropertyInspector" && measuring) piMessages++;
				if (!["setImage", "setFeedback"].includes(msg.event)) return;
				const svg = decodeSvg(msg.event === "setImage" ? msg.payload?.image : msg.payload?.canvas);
				if (svg === null || !svg.includes("<svg") || !svg.includes("</svg>")) throw new Error(`Malformed ${msg.event} for ${msg.context}`);
				if (!expected.has(msg.context)) throw new Error(`Unexpected output context ${msg.context}`);
				const generation = frameGeneration(svg, valueCounts.get(msg.context));
				if (generation !== null) initialized.add(msg.context);
				if (!measuring) return;
				bytes += data.length;
				if (generation === null) throw new Error(`Missing live value for ${msg.context}`);
				if (!sampleFrames.has(msg.context)) sampleFrames.set(msg.context, svg);
				if (generation > 0) frames.push({ context: msg.context, generation, at: receivedAt });
			} catch (error) { collectorError = String(error); }
		});
	});
	await once(server, "listening");
	function child(scriptArgs, cwd, name) {
		const processChild = spawn(process.execPath, scriptArgs, { cwd, env, stdio: ["pipe", "pipe", "pipe", "ipc"], windowsHide: true });
		const entry = { name, child: processChild, exit: null };
		children.push(entry);
		const stdout = fs.createWriteStream(path.join(directory, `${name}.stdout.log`));
		const stderr = fs.createWriteStream(path.join(directory, `${name}.stderr.log`));
		processChild.stdout.pipe(stdout); processChild.stderr.pipe(stderr);
		processChild.on("message", (msg) => {
			messages.push({ name, at: clock(), ...msg });
			if (msg.type === "published") publications.push(msg);
			if (msg.type === "error") collectorError = `${name}: ${JSON.stringify(msg)}`;
		});
		processChild.on("error", (error) => { collectorError = `${name}: ${error}`; });
		processChild.on("exit", (code, signal) => { entry.exit = { code, signal, at: clock() }; });
		return processChild;
	}
	const waitMessage = async (name, type, after = 0) => {
		assert.ok(await waitUntil(() => messages.slice(after).some((m) => m.name === name && m.type === type) || collectorError, 15000), `${name} ${type} timeout`);
		assert.ok(!collectorError, collectorError);
		return messages.slice(after).find((m) => m.name === name && m.type === type);
	};
	let producer, plugin;
	try {
		producer = child([path.join(root, "scripts/lib/scaling-producer.mjs"), String(config.inventory)], root, "producer");
		await waitMessage("producer", "ready");
		plugin = child(["--import", pathToFileURL(path.join(root, "scripts/lib/scaling-preload.mjs")).href, ...pluginArgv(server.address().port, `scaling-${randomUUID()}`, buildInfo({ devices }))], bundle, "plugin");
		record("process-identities.json", cleanup.observe());
		assert.ok(await waitUntil(() => initialized.size === expected.size || collectorError, 15000), "Not every action produced an initial native value");
		assert.ok(!collectorError, collectorError);
		// Warm up the SAME changing values, render paths and series. Keep
		// witness IDs below measured IDs so no startup frame can count.
		const warmupCount = Math.ceil(warmup * 1000 / config.producerMs);
		for (let i = 0; i < warmupCount; i++) {
			producer.send({ type: "publish", generation: i % 2 ? 1 : 2 });
			await sleep(config.producerMs);
		}
		assert.ok(await waitUntil(() => publications.length === warmupCount || collectorError, 5000), "Incomplete warmup publication acknowledgments");
		assert.ok(!collectorError, collectorError);
		publications.length = 0;
		plugin.send({ type: "measure-start" });
		const start = await waitMessage("plugin", "measure-started");
		assert.ok(!start.error, start.error);
		startedAt = start.at;
		measuring = true;
		const count = Math.ceil(seconds * 1000 / config.producerMs);
		for (let generation = 3; generation < count + 3; generation++) {
			const scheduledAt = startedAt + (generation - 3) * config.producerMs;
			await sleep(Math.max(0, scheduledAt - clock()));
			assert.ok(children.every((entry) => entry.exit === null), "Child exited during measurement");
			assert.ok(!collectorError, collectorError);
			commands.push({ generation, scheduledAt, sentAt: clock() });
			producer.send({ type: "publish", generation });
		}
		await sleep(Math.max(0, startedAt + seconds * 1000 - clock()));
		// Stop at the declared deadline even if the producer is overloaded;
		// delayed ACKs are retained and invalidate capacity evidence below.
		plugin.send({ type: "measure-stop" });
		measurement = await waitMessage("plugin", "measurement");
		stoppedAt = clock();
		assert.ok(await waitUntil(() => publications.length === count || collectorError, 5000), "Missing publisher acknowledgments");
		await sleep(Math.max(0, publications.at(-1).publishedAt + Math.max(2000, 4 * config.pollMs) + 100 - clock()));
		measuring = false;
		if (collectorError) errors.push(collectorError);
		if (publications.some((p) => p.generation < 3 || p.publishedAt < startedAt || p.publishedAt > measurement.endedAt || p.abandoned)) errors.push("Publication outside measurement window or abandoned mutex");
		const producerLateMs = distribution(publications.map((p, index) => Math.max(0, p.publishedAt - commands[index].scheduledAt)));
		if (producerLateMs.max >= config.producerMs) errors.push("Synthetic producer missed its cadence; run cannot qualify plugin capacity");
		const updates = analyzeGenerations({ publications, frames: frames.filter((frame) => frame.generation >= 3), contexts: [...expected], endAt: clock(), pollMs: config.pollMs, producerMs: config.producerMs });
		if (!updates.finalComplete || updates.unknownFrames || updates.outOfOrder) errors.push("Incomplete final generation, unknown context or out-of-order output");
		if (measurement.error) errors.push(measurement.error);
		if (config.pi && piMessages === 0) errors.push("Open inspector produced no measured previews");
		if (config.producerMs > config.pollMs && updates.missingPairs) errors.push("Updates missing even with producer slower than polling");
		const resources = measurement.resources;
		assert.ok(resources.length >= 2 && resources.every((r) => [r.at, r.rss, r.cpuUserUs, r.cpuSystemUs].every(Number.isFinite)), "Incomplete resource evidence");
		const first = resources[0], last = resources.at(-1);
		const cpuPercentOneCore = ((last.cpuUserUs + last.cpuSystemUs - first.cpuUserUs - first.cpuSystemUs) / 1000) / (last.at - first.at) * 100;
		const callbackMs = measurement.ticks.length ? distribution(measurement.ticks.map((t) => t.callbackMs)) : null;
		const drainMs = measurement.ticks.length ? distribution(measurement.ticks.map((t) => t.drainMs)) : null;
		const lateMs = measurement.ticks.length ? distribution(measurement.ticks.map((t) => t.lateMs)) : null;
		const budget = {
			callbackP95: callbackMs === null ? null : callbackMs.p95 <= config.pollMs / 2,
			loopDrainP95: drainMs === null ? null : drainMs.p95 <= config.pollMs / 2,
			cpuHalfCore: cpuPercentOneCore <= 50,
			updateP95: updates.latency !== null && updates.latency.p95 <= config.pollMs * 2,
			updateCoverage: updates.coverageRatio >= 0.95
		};
		if (strict && Object.values(budget).includes(false)) errors.push("Performance budget exceeded (see budget and raw measurements)");
		result = { name: config.name, repeat: repeat + 1, config, errors, budget, startedAt, stoppedAt, cpuPercentOneCore, callbackMs, drainMs, lateMs, callbackBudgetMisses: measurement.ticks.filter((t) => t.callbackMs > config.pollMs).length, loopDrainBudgetMisses: measurement.ticks.filter((t) => t.drainMs > config.pollMs).length, eventLoop: measurement.eventLoop, rssFirst: first.rss, rssLast: last.rss, rssPeak: Math.max(...resources.map((r) => r.rss)), piMessages, bytes, updates, producerWriteMs: distribution(publications.map((p) => p.writeMs)), producerLateMs };
	} catch (error) {
		caseFailure = String(error.stack ?? error);
		errors.push(caseFailure);
	} finally {
		try {
		measuring = false;
		if (socket) socket.close();
		if (producer?.connected) producer.send({ type: "stop" }, (error) => { if (error) errors.push(`Publisher stop: ${error}`); });
		await waitUntil(() => children.every((entry) => entry.exit !== null), 5000);
		for (const client of server.clients) client.terminate();
		await new Promise((resolve) => server.close(resolve));
		if (collectorError && !errors.includes(collectorError)) errors.push(collectorError);
		if (!children.every((entry) => entry.exit?.code === 0)) errors.push("Children did not both exit normally with code 0");
		const logs = path.join(bundle, "logs");
		const stockWarnings = fs.existsSync(logs) ? fs.readdirSync(logs).filter((name) => name.endsWith(".log")).flatMap((name) => fs.readFileSync(path.join(logs, name), "utf8").split(/\r?\n/).filter((line) => /\b(?:WARN|ERROR)\b/.test(line))) : [];
		if (stockWarnings.length) errors.push("Stock plugin logged WARN/ERROR; review preserved logs");
		try { assert.deepEqual(bundleInventory(bundle), copiedInventory, "Copied bundle changed during workload"); }
		catch (error) { errors.push(String(error)); }
		result = { ...result, name: config.name, repeat: repeat + 1, config, ok: errors.length === 0, errors, stockWarnings };
		record("result.json", result);
		record("raw.json", { config, publications, commands, frames, messages, measurement, startedAt, stoppedAt, collectorError, exits: children.map(({ name, exit }) => ({ name, exit })) });
		for (const [context, svg] of sampleFrames) fs.writeFileSync(path.join(directory, `${context}.svg`), svg);
		} catch (error) {
			errors.push(`Teardown/evidence failure: ${error.stack ?? error}`);
			caseFailure ??= String(error);
			for (const client of server.clients) client.terminate();
			server.close();
			try { record("failure.json", { caseFailure, errors }); }
			catch (writeError) { errors.push(`Could not preserve failure.json: ${writeError}`); }
		}
	}
	// Outer cleanup rechecks creation identities if normal shutdown failed.
	// Keep the original exception alongside any teardown failures.
	if (caseFailure) throw new Error(errors.join("\n"));
	return result;
}
