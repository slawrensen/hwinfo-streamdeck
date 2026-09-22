// Production bundle, native REG_SZ reader and renderers over an owned mock host.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { buildInfo, decodeSvg, pluginArgv, sleep, waitUntil } from "./lib/e2e-common.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(process.argv[2] ?? path.join(root, "release", "gadget-raw-e2e"));
fs.mkdirSync(output, { recursive: true });
const registry = `Software\\HwinfoRawE2E_${process.pid}_${randomUUID()}`;
assert.match(registry, /^Software\\HwinfoRawE2E_\d+_[a-f0-9-]{36}$/);
const regPath = `HKCU\\${registry}`;
const write = (name, value) => execFileSync("reg", ["add", regPath, "/v", name, "/t", "REG_SZ", "/d", value, "/f"], { stdio: "ignore", windowsHide: true });
const reading = "f0001234:0:1000001";
const booleanReading = "f0001234:0:8000001";
const actions = [
	{ context: "raw-key", action: "reading", device: "keys", controller: "Keypad", column: 0, settings: { readingKey: reading, decimals: "0" } },
	{ context: "raw-dial", action: "dial", device: "plus", controller: "Encoder", column: 0, settings: { readingKey: reading, decimals: "0" } },
	{ context: "healthy", action: "reading", device: "keys", controller: "Keypad", column: 1, settings: { readingKey: "g:Board:Power", decimals: "0" } },
	{ context: "boolean-key", action: "reading", device: "keys", controller: "Keypad", column: 2, settings: { readingKey: booleanReading, decimals: "0" } },
	{ context: "boolean-dial", action: "dial", device: "plus", controller: "Encoder", column: 1, settings: { readingKey: booleanReading, decimals: "0" } }
];
const traffic = [];
let socket;
let plugin;
let exit;
const send = (message) => socket.send(JSON.stringify(message));
const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await once(server, "listening");
const port = server.address().port;
server.on("connection", (ws) => {
	socket = ws;
	ws.on("message", (data) => {
		const message = JSON.parse(data.toString());
		const svg = decodeSvg(message.event === "setImage" ? message.payload?.image : message.payload?.canvas);
		traffic.push({ ...message, svg });
		fs.appendFileSync(path.join(output, "traffic.jsonl"), JSON.stringify(message) + "\n");
		if (message.event === "getGlobalSettings") send({ event: "didReceiveGlobalSettings", payload: { settings: { source: "gadget", pollIntervalMs: "250", readingLinks: [
			{ sharedMemory: reading, gadget: "g:Raw fixture:Temperature", unit: "°C", sensorType: 1 },
			{ sharedMemory: booleanReading, gadget: "g:Boolean fixture:Thermal Throttling", unit: "Yes/No", sensorType: 8 }
		] } } });
		if (message.event === "registerPlugin") {
			for (const row of actions) send({ event: "willAppear", action: `com.lawrensen.hwinfo.${row.action}`, context: row.context, device: row.device, payload: { settings: row.settings, controller: row.controller, coordinates: { column: row.column, row: 0 }, isInMultiAction: false } });
		}
	});
});
const frames = (start, context) => traffic.slice(start).filter((row) => row.context === context && row.svg).map((row) => row.svg);
async function expect(start, context, predicate, description) {
	assert.ok(await waitUntil(() => frames(start, context).some(predicate), 5000), description);
	console.log(`PASS ${description}`);
}
const hasValue = (value) => (svg) => svg.includes(`>${value}</text>`) || svg.includes(`>${value}<tspan`);
try {
	for (const [slot, row] of [[0, { Sensor: "Raw fixture", Label: "Temperature", Value: "39 °C", ValueRaw: "39" }], [1, { Sensor: "Boolean fixture", Label: "Thermal Throttling", Value: "No", ValueRaw: "No" }], [900, { Sensor: "Board", Label: "Power", Value: "50 W", ValueRaw: "50" }]]) {
		for (const [field, value] of Object.entries(row)) write(`${field}${slot}`, value);
	}
	plugin = spawn(process.execPath, pluginArgv(port, "raw-integrity-test", buildInfo({ devices: [{ id: "keys", name: "Fixture", type: 0, size: { columns: 5, rows: 3 } }, { id: "plus", name: "Fixture Plus", type: 7, size: { columns: 4, rows: 2 } }] })), {
		cwd: path.join(root, "com.lawrensen.hwinfo.sdPlugin"),
		env: { ...process.env, HWINFO_VSB_KEY: registry, HWINFO_SM2_NAME: `Local\\HwinfoRawAbsent_${process.pid}_${randomUUID()}`, HWINFO_STALE_AFTER_MS: "15000" },
		stdio: ["ignore", "pipe", "pipe"], windowsHide: true
	});
	exit = once(plugin, "exit");
	for (const stream of [plugin.stdout, plugin.stderr]) stream.on("data", (chunk) => fs.appendFileSync(path.join(output, "plugin.log"), chunk));
	await expect(0, "raw-key", (svg) => svg.includes("Age unknown"), "cold registry is not freshness evidence");
	write("Value0", "40 °C"); write("ValueRaw0", "40");
	await expect(0, "raw-key", hasValue("40"), "linked key gets native baseline");
	await expect(0, "raw-dial", hasValue("40"), "linked dial gets native baseline");
	await expect(0, "healthy", hasValue("50"), "healthy neighboring key serves");
	const badStart = traffic.length;
	write("Value0", "41 °C"); write("ValueRaw0", "41junk");
	await expect(badStart, "raw-key", hasValue("—"), "malformed raw renders unavailable on linked key");
	await expect(badStart, "raw-dial", hasValue("—"), "malformed raw renders unavailable on linked dial");
	await sleep(600);
	for (const context of ["raw-key", "raw-dial"]) assert.ok(!frames(badStart, context).some(hasValue("41")), `${context} never paints the malformed prefix`);
	const recoverStart = traffic.length;
	write("Value0", "42 °C"); write("ValueRaw0", "42");
	await expect(recoverStart, "raw-key", hasValue("42"), "valid raw recovery reaches linked key");
	await expect(recoverStart, "raw-dial", hasValue("42"), "valid raw recovery reaches linked dial");
	for (const context of ["boolean-key", "boolean-dial"]) await expect(0, context, hasValue("No"), `${context} starts with the valid boolean word`);
	// Pause between each pair of producer stores. A repeated contradiction
	// must reach the real missing-reading face, including through the link.
	for (const [word, raw, healthyValue] of [["Yes", "Yes", "51"], ["No", "0", "52"]]) {
		const mismatchStart = traffic.length;
		write("Value1", word);
		write("Value900", `${healthyValue} W`); write("ValueRaw900", healthyValue);
		for (const context of ["boolean-key", "boolean-dial"]) {
			await expect(mismatchStart, context, (svg) => svg.includes("Sensor missing"), `${context} withholds contradictory ${word} display`);
			assert.ok(!frames(mismatchStart, context).some(hasValue(word)), `${context} never repairs raw from the contradictory display word`);
		}
		await expect(mismatchStart, "healthy", hasValue(healthyValue), `healthy neighbor advances while ${word} row is withheld`);
		const booleanRecoverStart = traffic.length;
		write("ValueRaw1", raw);
		for (const context of ["boolean-key", "boolean-dial"]) await expect(booleanRecoverStart, context, hasValue(word), `${context} recovers ${word} with raw ${raw}`);
	}
	for (const context of ["raw-key", "raw-dial", "healthy", "boolean-key", "boolean-dial"]) {
		const svg = frames(0, context).at(-1);
		fs.writeFileSync(path.join(output, `${context}.svg`), svg);
	}
	assert.ok(hasValue("52")(frames(0, "healthy").at(-1)), "healthy neighbor stays available through malformed data, contradictory booleans and recovery");
	console.log("GADGET RAW E2E: ALL CHECKS PASSED");
} finally {
	if (plugin && plugin.exitCode === null) plugin.kill();
	if (exit) await Promise.race([exit, sleep(3000)]);
	for (const client of server.clients) client.terminate();
	await new Promise((resolve) => server.close(resolve));
	try { execFileSync("reg", ["delete", regPath, "/f"], { stdio: "ignore", windowsHide: true }); } catch { /* absent */ }
}
