// Calculated readings end to end (steer 7G): the actual bundle and a real
// named Shared Memory mapping (the synthetic producer), with a mocked
// Stream Deck socket playing both the app and the settings panel.
//
// Listing and previewing write nothing; a refused draft and a stale basis
// write nothing; one Save is one shared settings write that keeps every
// other field; the new reading is in force at once (the app never echoes a
// plugin's own write), listed under "Calculated (plugin)" in the sensor
// tree, drawn on a key, follows an edit of its definition, refuses a
// delete while another definition uses it, and once deleted reads as a
// missing reading, never as zero.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { buildInfo, decodeSvg, pluginArgv, sleep, waitUntil } from "./lib/e2e-common.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(root, "com.lawrensen.hwinfo.sdPlugin");
const output = path.resolve(process.argv[2] ?? path.join(root, "release", "calculated-e2e"));
fs.mkdirSync(output, { recursive: true });
const port = 28992;
const mapping = `Local\\HwinfoCalc_${process.pid}`;
// A Gadget key that does not exist: the source is forced to Shared Memory
// and nothing here may read the registry.
const env = { ...process.env, HWINFO_SM2_NAME: mapping, HWINFO_SM2_MUTEX_NAME: `${mapping}_MUTEX`, HWINFO_VSB_KEY: `Software\\HwinfoCalcAbsent_${process.pid}` };
const CORE = [0, 1, 2, 3].map((i) => `f0001234:0:${(0x1000004 + i).toString(16)}`);
const MISSING_ID = "calc:ZZZZZZZZZZZZZZZZZZZZZZ";
let globals = { source: "shared-memory", pollIntervalMs: "250", futureGlobal: { keep: "mine" }, readingLinks: [] };
const traffic = [];
let socket;
let plugin;
let producer;
let checks = 0;
const check = (condition, message) => {
	assert.ok(condition, message);
	checks++;
	console.log(`PASS ${message}`);
};
const send = (message) => socket.send(JSON.stringify(message));
const keyAction = (settings, column) => ({ action: "com.lawrensen.hwinfo.reading", device: "keys", controller: "Keypad", coordinates: { column, row: 0 }, settings });
const appear = (context, action) => send({ event: "willAppear", context, action: action.action, device: action.device, payload: { settings: action.settings, controller: action.controller, coordinates: action.coordinates, isInMultiAction: false } });
const framesSince = (index, context) => traffic.slice(index).filter((entry) => entry.context === context && entry.svg).map((entry) => entry.svg);
const server = new WebSocketServer({ host: "127.0.0.1", port });
const missing = keyAction({ readingKey: MISSING_ID, label: "NO DEF", decimals: "2" }, 0);
server.on("connection", (ws) => {
	socket = ws;
	ws.on("message", (data) => {
		const message = JSON.parse(data.toString());
		fs.appendFileSync(path.join(output, "traffic.jsonl"), `${JSON.stringify(message)}\n`);
		traffic.push({ ...message, svg: decodeSvg(message.event === "setImage" ? message.payload?.image : message.payload?.canvas) });
		if (message.event === "getGlobalSettings") send({ event: "didReceiveGlobalSettings", payload: { settings: globals } });
		if (message.event === "setGlobalSettings") globals = message.payload;
		if (message.event === "registerPlugin") {
			appear("missing-calc", missing);
			send({ event: "propertyInspectorDidAppear", action: "com.lawrensen.hwinfo.reading", context: "missing-calc", device: "keys" });
		}
	});
});
let producerText = "";
async function command(cmd, echo) {
	const start = producerText.length;
	producer.stdin.write(`${cmd}\n`);
	await waitUntil(() => producerText.slice(start).includes(echo), 6000);
	assert.ok(producerText.slice(start).includes(echo), `producer acknowledged ${cmd}`);
}
async function piRequest(payload, replyEvent) {
	const from = traffic.length;
	send({ event: "sendToPlugin", action: "com.lawrensen.hwinfo.reading", context: "missing-calc", payload });
	const match = (msg) => msg.event === "sendToPropertyInspector" && msg.payload?.event === replyEvent && (payload.requestId === undefined || msg.payload?.requestId === payload.requestId);
	await waitUntil(() => traffic.slice(from).some(match), 8000);
	const reply = traffic.slice(from).find(match)?.payload;
	assert.ok(reply, `answer to ${payload.event}`);
	return reply;
}
const writesSince = (from) => traffic.slice(from).filter((msg) => msg.event === "setGlobalSettings" || msg.event === "setSettings");
async function face(context, predicate, since) {
	await waitUntil(() => framesSince(since, context).some(predicate), 6000);
	const frame = framesSince(since, context).findLast(predicate) ?? framesSince(since, context).at(-1) ?? "";
	fs.writeFileSync(path.join(output, `${context}-${traffic.length}.svg`), frame);
	return frame;
}
try {
	producer = spawn(process.execPath, [path.join(root, "scripts/fake-hwinfo.mjs")], { cwd: root, env, stdio: ["pipe", "pipe", "inherit"] });
	producer.stdout.on("data", (chunk) => {
		producerText += chunk.toString();
	});
	await waitUntil(() => producerText.includes("READY"), 6000);
	await command("cores", "CORES");
	plugin = spawn(process.execPath, pluginArgv(port, "calculated-proof", buildInfo({ devices: [{ id: "keys", name: "Keys", type: 0, size: { columns: 5, rows: 3 } }] })), { cwd: pluginDir, env, stdio: ["ignore", "inherit", "inherit"] });
	await waitUntil(() => traffic.some((msg) => msg.event === "sendToPropertyInspector" && msg.payload?.event === "preview" && msg.payload?.state === "ok"), 10000);
	check(traffic.some((msg) => msg.event === "sendToPropertyInspector" && msg.payload?.event === "preview" && msg.payload?.state === "ok"), "Shared Memory is live");
	const missingFace = await face("missing-calc", (svg) => svg.includes("NO DEF") || svg.includes("missing"), 0);
	check(/missing/i.test(missingFace) && !/>0(?:\.00)?</.test(missingFace), "a key saved with an undefined calculated id shows the missing-reading face, never zero");

	let mark = traffic.length;
	const empty = await piRequest({ event: "getCalculated", requestId: "c-1" }, "calculated");
	check(Array.isArray(empty.workspace.rows) && empty.workspace.rows.length === 0 && empty.workspace.max === 32, "the list starts empty, room for 32");
	const refused = await piRequest({ event: "previewCalculated", requestId: "c-2", draft: { op: "sum", inputs: [CORE[0], CORE[1]] } }, "calculatedPreview");
	check(refused.preview.ok === false && refused.preview.reason === "op-not-allowed", "a sum of voltages is refused in the preview");
	const avg = await piRequest({ event: "previewCalculated", requestId: "c-3", draft: { op: "avg", inputs: [CORE[0], CORE[1]] } }, "calculatedPreview");
	check(avg.preview.ok === true && avg.preview.generatedLabel === "Average of Core 0 VID and Core 1 VID" && /^1\.10\b/.test(avg.preview.display), `the preview evaluates the draft with the production code (${avg.preview.display})`);
	check(avg.preview.expression.includes("Core 0 VID") && avg.preview.unit === "V", "the preview names the inputs and the unit");
	check(writesSince(mark).length === 0, "listing and previewing write nothing");
	const stale = await piRequest({ event: "applyCalculated", requestId: "c-4", op: "create", draft: { op: "avg", inputs: [CORE[0], CORE[1]] }, baseSignature: "stale" }, "calculatedApplied");
	check(stale.ok === false && stale.reason === "stale-basis" && writesSince(mark).length === 0, "a stale basis is refused and writes nothing");
	const created = await piRequest({ event: "applyCalculated", requestId: "c-5", op: "create", draft: { op: "avg", inputs: [CORE[0], CORE[1]] }, baseSignature: empty.workspace.signature }, "calculatedApplied");
	const createWrites = traffic.slice(mark).filter((msg) => msg.event === "setGlobalSettings");
	check(created.ok === true && /^calc:[A-Za-z0-9_-]{22}$/.test(created.id ?? "") && createWrites.length === 1, "one Save is one shared settings write and mints a calc: id");
	const id = created.id;
	const doc = createWrites[0].payload;
	check(doc.source === "shared-memory" && doc.pollIntervalMs === "250" && doc.futureGlobal?.keep === "mine" && Array.isArray(doc.readingLinks), "every other shared field rides along unchanged");
	check(JSON.stringify(doc.calculatedReadings) === JSON.stringify([{ id, op: "avg", inputs: [CORE[0], CORE[1]], unit: "V", sensorType: 2 }]), "the stored row is the documented shape");

	let since = traffic.length;
	appear("calc-key", keyAction({ readingKey: id, label: "AVG", decimals: "2" }, 1));
	const shown = await face("calc-key", (svg) => svg.includes("1.10"), since);
	check(shown.includes("1.10") && !/missing/i.test(shown), "a key drawing the new reading shows its value at once, without an echo");
	const tree = await piRequest({ event: "getSensorTree" }, "sensorTree");
	const group = tree.groups.find((g) => g.name === "Calculated (plugin)");
	check(group?.matchName === "Calculated (plugin)" && group.readings.some((r) => r.key === id && r.label === "Average of Core 0 VID and Core 1 VID"), "the sensor tree lists it under Calculated (plugin), the name detail filters match");

	mark = traffic.length;
	const listed = await piRequest({ event: "getCalculated", requestId: "c-6" }, "calculated");
	const nested = await piRequest({ event: "applyCalculated", requestId: "c-7", op: "create", draft: { op: "diff", inputs: [id, CORE[0]] }, baseSignature: listed.workspace.signature }, "calculatedApplied");
	const nestedRow = nested.workspace.rows.find((row) => row.id === nested.id);
	check(nested.ok === true && /^0\.05\b/.test(nestedRow?.display ?? ""), `a definition may use an earlier one (${nestedRow?.display})`);
	const blocked = await piRequest({ event: "applyCalculated", requestId: "c-8", op: "delete", id, baseSignature: nested.workspace.signature }, "calculatedApplied");
	check(blocked.ok === false && blocked.reason === "referenced", "deleting a definition another one uses is refused");
	check(traffic.slice(mark).filter((msg) => msg.event === "setGlobalSettings").length === 1, "the refusal wrote nothing");

	since = traffic.length;
	const edited = await piRequest({ event: "applyCalculated", requestId: "c-9", op: "update", id, draft: { op: "max", inputs: [CORE[0], CORE[1]], label: "Higher VID" }, baseSignature: nested.workspace.signature }, "calculatedApplied");
	check(edited.ok === true, "an edit of the stored inputs saves");
	const edit = await face("calc-key", (svg) => svg.includes("1.15"), since);
	check(edit.includes("1.15"), "the key follows the edited definition at once");
	check(JSON.stringify(globals.calculatedReadings?.[0]) === JSON.stringify({ id, op: "max", inputs: [CORE[0], CORE[1]], unit: "V", sensorType: 2, label: "Higher VID" }), "the edit replaced its row in place");

	let basis = edited.workspace.signature;
	const dropNested = await piRequest({ event: "applyCalculated", requestId: "c-10", op: "delete", id: nested.id, baseSignature: basis }, "calculatedApplied");
	check(dropNested.ok === true, "the dependent definition deletes");
	basis = dropNested.workspace.signature;
	since = traffic.length;
	const dropped = await piRequest({ event: "applyCalculated", requestId: "c-11", op: "delete", id, baseSignature: basis }, "calculatedApplied");
	check(dropped.ok === true && JSON.stringify(globals.calculatedReadings) === "[]", "then the definition itself deletes");
	const gone = await face("calc-key", (svg) => /missing/i.test(svg), since);
	check(/missing/i.test(gone) && !gone.includes("1.15"), "a key showing a deleted calculated reading says the reading is missing");
	check(traffic.filter((msg) => msg.event === "setSettings").length === 0, "no key's own settings were written at any point");
	await sleep(200);
	console.log(`CALCULATED E2E: ${checks} checks passed`);
} finally {
	if (plugin && plugin.exitCode === null) {
		const done = once(plugin, "exit");
		plugin.kill();
		await done;
	}
	if (producer && producer.exitCode === null) {
		const done = once(producer, "exit");
		producer.stdin.write("exit\n");
		await done;
	}
	for (const client of server.clients) client.terminate();
	await new Promise((resolve) => server.close(resolve));
}
