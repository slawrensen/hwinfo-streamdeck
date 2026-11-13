// Actual bundle + native Windows producers, with a mocked Stream Deck socket.
// Explicit cross-provider links must preserve saved selections and dressed
// custom detail tiles through Shared Memory -> Gadget -> Shared Memory.
// Then the guided pairing leg drives the settings panel's Reading links
// messages: opening and scanning write nothing, a stale basis and a unit
// mismatch are refused, one Link press is one shared settings write that
// keeps every other field, the link is in force at once (the app never
// echoes a plugin's own write), and two panels unlinking from one basis
// get one write and one refusal.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { buildInfo, decodeSvg, pluginArgv, regSet, regDeleteKey, sleep, waitUntil } from "./lib/e2e-common.mjs";
import { profileCells } from "./lib/profile-cells.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(root, "com.lawrensen.hwinfo.sdPlugin");
const output = path.resolve(process.argv[2] ?? path.join(root, "release", "reading-links-e2e"));
fs.mkdirSync(output, { recursive: true });
const port = 28993;
const mapping = `Local\\HwinfoLinks_${process.pid}`;
const registry = `Software\\HwinfoLinks_${process.pid}`;
const regPath = `HKCU\\${registry}`;
const env = { ...process.env, HWINFO_SM2_NAME: mapping, HWINFO_SM2_MUTEX_NAME: `${mapping}_MUTEX`, HWINFO_VSB_KEY: registry, HWINFO_UPGRADE_PROBE_MS: "1000", HWINFO_STALE_AFTER_MS: "4000", HWINFO_REOPEN_PROBE_MS: "1000" };
const links = [0, 1, 2, 3].map((i) => ({ sharedMemory: `f0001234:0:${(0x1000004 + i).toString(16)}`, gadget: `g:Test Source:Core ${i} VID`, unit: "V", sensorType: 2 }));
const values = ["1.05", "1.15", "1.25", "1.35"];
const gadgetValues = ["1.45", "1.55", "1.65", "1.75"];
const actions = new Map();
for (const endpoint of ["sharedMemory", "gadget"]) {
	const keys = links.map((link) => link[endpoint]);
	for (const [i, keyLayout] of ["single", "dual", "triple", "quad"].entries()) {
		actions.set(`${endpoint}-${keyLayout}`, { action: "com.lawrensen.hwinfo.reading", device: "keys", controller: "Keypad", coordinates: { column: i, row: endpoint === "gadget" ? 1 : 0 }, settings: { readingKey: keys[0], secondaryReadingKey: keys[1], quadReadingKey3: keys[2], quadReadingKey4: keys[3], keyLayout, label: "MY CPU", quadLabels: true, decimals: "2", futureField: { keep: "mine" } } });
	}
	for (const [i, dialView] of ["single", "tworow", "overview"].entries()) {
		actions.set(`${endpoint}-dial-${dialView}`, { action: "com.lawrensen.hwinfo.dial", device: endpoint, controller: "Encoder", coordinates: { column: i, row: 0 }, settings: { readingKey: keys[0], rotationKeys: keys, rotationNames: { [keys[0]]: "MY CORE" }, dialView, decimals: "2" } });
	}
}
const cells = profileCells(pluginDir, "profiles/detail-r3-standard");
const opener = { action: "com.lawrensen.hwinfo.reading", device: "details", controller: "Keypad", coordinates: { column: 2, row: 1 }, settings: { readingKey: links[0].sharedMemory, pressBehavior: "open-details", detailMode: "custom", detailTitle: "MY LIST", detailKeys: links.slice(1).map((link) => link.sharedMemory), detailTiles: [{ size: 2, labels: ["MY TILE", "Other"], colors: ["#FF00AA", null], cellLabels: true }], decimals: "2" } };
const traffic = [];
// The app's stored shared document: getGlobalSettings answers it, and a
// plugin write replaces it without an echo to the plugin (as the app does).
let globals = { source: "auto", pollIntervalMs: "250", readingLinks: links, futureGlobal: { keep: "mine" } };
let socket;
let plugin;
let producer;
let updater;
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; console.log(`PASS ${message}`); };
const send = (message) => socket.send(JSON.stringify(message));
const event = (name, context, action) => send({ event: name, context, action: action.action, device: action.device, payload: { settings: action.settings, controller: action.controller, coordinates: action.coordinates, isInMultiAction: false } });
const framesSince = (index, context) => traffic.slice(index).filter((entry) => entry.context === context && entry.svg).map((entry) => entry.svg);
const server = new WebSocketServer({ host: "127.0.0.1", port });
server.on("connection", (ws) => {
	socket = ws;
	ws.on("message", (data) => {
		const message = JSON.parse(data.toString());
		fs.appendFileSync(path.join(output, "traffic.jsonl"), `${JSON.stringify(message)}\n`);
		traffic.push({ ...message, svg: decodeSvg(message.event === "setImage" ? message.payload?.image : message.payload?.canvas) });
		if (message.event === "getGlobalSettings") send({ event: "didReceiveGlobalSettings", payload: { settings: globals } });
		if (message.event === "setGlobalSettings") globals = message.payload;
		if (message.event === "registerPlugin") {
			for (const [context, action] of actions) event("willAppear", context, action);
			send({ event: "propertyInspectorDidAppear", action: "com.lawrensen.hwinfo.reading", context: "sharedMemory-single", device: "keys" });
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
async function phase(name, source, start) {
	const expected = source === "gadget" ? gadgetValues : values;
	await waitUntil(() => traffic.slice(start).some((msg) => msg.event === "sendToPropertyInspector" && msg.payload?.source === source && msg.payload?.state === "ok"), 10000);
	check(traffic.slice(start).some((msg) => msg.event === "sendToPropertyInspector" && msg.payload?.source === source && msg.payload?.state === "ok"), `${name}: active source proven by PI`);
	for (const context of actions.keys()) {
		await waitUntil(() => framesSince(start, context).some((svg) => svg.includes(expected[0])), 6000);
		const face = framesSince(start, context).at(-1) ?? "";
		check(face.includes(expected[0]) && !face.includes("Sensor missing"), `${name}: ${context} retains Core 0 = ${expected[0]} V`);
		if (context.endsWith("-quad")) check(expected.every((value) => face.includes(value)), `${name}: all four distinct quad readings`);
		if (context.endsWith("-triple")) check(expected.slice(0, 3).every((value) => face.includes(value)), `${name}: all three distinct rows`);
		fs.writeFileSync(path.join(output, `${name}-${context}.svg`), face);
	}
	if (name !== "initial") {
		const details = traffic.slice(start).filter((msg) => msg.context?.startsWith("detail-") && msg.svg).map((msg) => msg.svg).join("\n");
		check(details.includes("MY TILE") && expected.slice(1).every((value) => details.includes(value)), `${name}: custom detail values and personalization survive`);
		check(!details.includes("Sensor missing"), `${name}: no detail identity substitution`);
	}
	// Real bundled PI payloads must agree with actual rendered row colors,
	// including a saved selection whose row uses the other linked spelling.
	const config = JSON.parse(fs.readFileSync(path.join(pluginDir, "themes.json"), "utf8"));
	for (const dialView of ["tworow", "overview"]) {
		const context = `gadget-dial-${dialView}`;
		const action = actions.get(context);
		send({ event: "propertyInspectorDidAppear", action: action.action, context, device: action.device });
		const cases = [
			{ name: "individual alias", individual: true, expectedColor: "#123abc" },
			{ name: "automatic unclassified", individual: false, expectedColor: config.themes.void.value },
			...(source === "shared-memory" ? [{ name: "automatic temperature", individual: false, expectedColor: config.typeAccents.temperature, readingKey: "f0001234:0:1000001" }] : [])
		];
		for (const testCase of cases) {
			const before = traffic.length;
			const settings = { ...action.settings, theme: "void", textMode: "theme", rotationKeys: links.map((link) => link.sharedMemory), sensorValueColors: true,
				...(testCase.individual ? { readingColors: { [links[0].sharedMemory]: "#123abc", [links[0].gadget]: "#FF7E8E" } } : {}),
				...(testCase.readingKey ? { readingKey: testCase.readingKey, rotationKeys: [testCase.readingKey] } : {}) };
			event("didReceiveSettings", context, { ...action, settings });
			const expectedColor = testCase.expectedColor;
			await waitUntil(() => traffic.slice(before).some((msg) => msg.context === context && msg.event === "sendToPropertyInspector" && msg.payload?.display?.valueColor === expectedColor)
				&& [...(framesSince(before, context).at(-1) ?? "").matchAll(/font-weight="700" fill="([^"]+)">/g)][0]?.[1] === expectedColor, 6000);
			const preview = traffic.slice(before).findLast((msg) => msg.context === context && msg.event === "sendToPropertyInspector" && msg.payload?.display)?.payload;
			const frame = framesSince(before, context).at(-1) ?? "";
			const rowColor = [...frame.matchAll(/font-weight="700" fill="([^"]+)">/g)][0]?.[1];
			check(preview?.source === source && preview?.display?.valueColor === expectedColor && rowColor === expectedColor, `${name}: ${dialView} ${testCase.name} preview matches built row`);
			check(preview.display.bg === (dialView === "tworow" ? config.themes.void.track : config.themes.void.bg), `${name}: ${dialView} preview uses selected row surface`);
		}
		event("didReceiveSettings", context, action);
	}
	send({ event: "propertyInspectorDidAppear", action: "com.lawrensen.hwinfo.reading", context: "sharedMemory-single", device: "keys" });
}
/** A panel request and its answer (matched by request id). */
async function piRequest(payload, replyEvent) {
	const from = traffic.length;
	send({ event: "sendToPlugin", action: "com.lawrensen.hwinfo.reading", context: "sharedMemory-single", payload });
	const match = (msg) => msg.event === "sendToPropertyInspector" && msg.payload?.event === replyEvent && msg.payload?.requestId === payload.requestId;
	await waitUntil(() => traffic.slice(from).some(match), 8000);
	const reply = traffic.slice(from).find(match)?.payload;
	assert.ok(reply, `answer to ${payload.event} ${payload.requestId}`);
	return reply;
}
async function pairingLeg() {
	const SM_FAN = "f0001234:0:1000002";
	const G_FAN = "g:Test Source:Test Fan";
	const G_WITNESS = "g:Witness:Changing value";
	const writesSince = (from) => traffic.slice(from).filter((msg) => msg.event === "setGlobalSettings" || (msg.event === "setSettings" && actions.has(msg.context)));
	send({ event: "propertyInspectorDidAppear", action: "com.lawrensen.hwinfo.reading", context: "sharedMemory-single", device: "keys" });
	let mark = traffic.length;
	const opened = await piRequest({ event: "getLinks", requestId: "pair-1", focusKey: SM_FAN }, "links");
	const ws = opened.workspace;
	check(ws.rows.length === 4 && ws.counts.active === 4, "pairing: the four stored links are in use on Shared Memory");
	check(ws.focus?.endpoint?.availability === "live" && ws.focus?.endpoint?.unit === "RPM" && ws.focus?.endpoint?.sensor === "Test Source", "pairing: the focused reading shows its source, unit and live state");
	check(ws.focus?.candidates?.[0]?.key === G_FAN && ws.focus.candidates[0].suggestion === "same-name", "pairing: the Gadget reading seen during the fallback is suggested first");
	check(ws.focus?.candidates?.some((c) => c.key === G_WITNESS && c.blocked === "unit-mismatch"), "pairing: a reading in another unit is listed as blocked");
	check(ws.focus?.candidates?.every((c) => c.availability !== "live"), "pairing: a Gadget value is never called live");
	const scanned = await piRequest({ event: "getLinks", requestId: "pair-2", focusKey: SM_FAN, scan: true, provider: "gadget" }, "links");
	check(/^Read Gadget registry once/.test(scanned.workspace.scan?.text ?? ""), `pairing: Look on Gadget reads the registry once through the native reader (${scanned.workspace.scan?.text})`);
	const throttled = await piRequest({ event: "getLinks", requestId: "pair-3", focusKey: SM_FAN, scan: true, provider: "gadget" }, "links");
	check(throttled.workspace.scan?.throttled === true, "pairing: a second scan within 5 s is throttled");
	check(writesSince(mark).length === 0, "pairing: opening, focusing and scanning write nothing");
	const basis = scanned.workspace.signature;
	const stale = await piRequest({ event: "applyLink", requestId: "pair-4", op: "link", sharedMemory: SM_FAN, gadget: G_FAN, baseSignature: "stale-basis-from-another-panel" }, "linkApplied");
	check(stale.ok === false && stale.reason === "stale-basis" && writesSince(mark).length === 0, "pairing: a stale basis is refused and writes nothing");
	const wrongUnit = await piRequest({ event: "applyLink", requestId: "pair-5", op: "link", sharedMemory: SM_FAN, gadget: G_WITNESS, baseSignature: basis }, "linkApplied");
	check(wrongUnit.ok === false && wrongUnit.reason === "unit-mismatch" && writesSince(mark).length === 0, "pairing: a unit mismatch is refused and writes nothing");
	const linked = await piRequest({ event: "applyLink", requestId: "pair-6", op: "link", sharedMemory: SM_FAN, gadget: G_FAN, baseSignature: basis, focusKey: SM_FAN }, "linkApplied");
	const linkWrites = traffic.slice(mark).filter((msg) => msg.event === "setGlobalSettings");
	check(linked.ok === true && linkWrites.length === 1, "pairing: one Link press is one shared settings write");
	const written = linkWrites[0]?.payload ?? {};
	check(written.source === "auto" && written.pollIntervalMs === "250" && written.futureGlobal?.keep === "mine", "pairing: every other shared field rides along unchanged");
	check(JSON.stringify(written.readingLinks) === JSON.stringify([...links, { sharedMemory: SM_FAN, gadget: G_FAN, unit: "RPM", sensorType: 3 }]), "pairing: the stored links keep their order and gain one row");
	const row = linked.workspace.rows.find((r) => r.sharedMemory === SM_FAN);
	check(row?.health === "active-shared-memory" && row?.readiness === "ready", "pairing: the new link is in use with its fallback ready");
	// In force at once, though the app never echoes a plugin's own write.
	const probe = { action: "com.lawrensen.hwinfo.reading", device: "keys", controller: "Keypad", coordinates: { column: 4, row: 2 }, settings: { readingKey: G_FAN, label: "PAIRED" } };
	const probeStart = traffic.length;
	event("willAppear", "pair-probe", probe);
	await waitUntil(() => framesSince(probeStart, "pair-probe").some((svg) => svg.includes("1200")), 6000);
	check(framesSince(probeStart, "pair-probe").some((svg) => svg.includes("1200") && !svg.includes("Sensor missing")), "pairing: a key saved with the Gadget spelling shows the Shared Memory value at once");
	event("willDisappear", "pair-probe", probe);
	// Two panels unlinking from one basis: one write, one stale refusal.
	mark = traffic.length;
	const both = ["pair-7", "pair-8"].map((requestId) => ({ event: "applyLink", requestId, op: "unlink", sharedMemory: SM_FAN, gadget: G_FAN, baseSignature: linked.workspace.signature }));
	for (const payload of both) send({ event: "sendToPlugin", action: "com.lawrensen.hwinfo.reading", context: "sharedMemory-single", payload });
	const answered = () => traffic.slice(mark).filter((msg) => msg.event === "sendToPropertyInspector" && msg.payload?.event === "linkApplied");
	await waitUntil(() => answered().length === 2, 8000);
	const results = answered().map((msg) => msg.payload);
	check(results.filter((r) => r.ok === true).length === 1 && results.filter((r) => r.reason === "stale-basis").length === 1, "pairing: two panels from one basis get one success and one stale refusal");
	check(traffic.slice(mark).filter((msg) => msg.event === "setGlobalSettings").length === 1, "pairing: and exactly one write");
	check(JSON.stringify(globals.readingLinks) === JSON.stringify(links) && globals.futureGlobal?.keep === "mine", "pairing: unlink restores the original list and keeps the other fields");
	check(traffic.filter((msg) => msg.event === "setSettings" && actions.has(msg.context)).every((msg) => msg.payload.readingKey === actions.get(msg.context).settings.readingKey), "pairing: no key's saved selection was rewritten");
}
try {
	for (let i = 0; i < 4; i++) for (const [field, value] of Object.entries({ Sensor: "Test Source", Label: `Core ${i} VID`, Value: `${gadgetValues[i]} V`, ValueRaw: gadgetValues[i] })) regSet(regPath, `${field}${i}`, value);
	// The Gadget twin of the Shared Memory "Test Fan" (not linked yet): the
	// pairing leg links it. Seen by the poller during the fallback phase.
	regSet(regPath, "Sensor5", "Test Source"); regSet(regPath, "Label5", "Test Fan"); regSet(regPath, "Value5", "1200 RPM"); regSet(regPath, "ValueRaw5", "1200");
	regSet(regPath, "Sensor9", "Witness"); regSet(regPath, "Label9", "Changing value"); regSet(regPath, "Value9", "10 W"); regSet(regPath, "ValueRaw9", "10");
	let witness = 10;
	updater = setInterval(() => {
		witness++;
		regSet(regPath, "Value9", `${witness} W`);
		regSet(regPath, "ValueRaw9", String(witness));
	}, 450);
	producer = spawn(process.execPath, [path.join(root, "scripts/fake-hwinfo.mjs")], { cwd: root, env, stdio: ["pipe", "pipe", "inherit"] });
	producer.stdout.on("data", (chunk) => { producerText += chunk.toString(); });
	await waitUntil(() => producerText.includes("READY"), 6000);
	await command("cores", "CORES");
	plugin = spawn(process.execPath, pluginArgv(port, "reading-links-proof", buildInfo({ devices: [{ id: "keys", name: "Keys", type: 0, size: { columns: 5, rows: 3 } }, { id: "details", name: "Details", type: 0, size: { columns: 5, rows: 3 } }, ...["sharedMemory", "gadget"].map((id) => ({ id, name: id, type: 7, size: { columns: 4, rows: 2 } }))] })), { cwd: pluginDir, env, stdio: ["ignore", "inherit", "inherit"] });
	await phase("initial", "shared-memory", 0);
	event("willAppear", "opener", opener);
	await sleep(300);
	event("keyDown", "opener", opener); event("keyUp", "opener", opener);
	await waitUntil(() => traffic.some((msg) => msg.event === "switchToProfile"), 4000);
	check(traffic.some((msg) => msg.event === "switchToProfile"), "custom detail navigation dispatched");
	event("willDisappear", "opener", opener);
	for (const cell of cells) {
		const [column, row] = cell.coord.split(",").map(Number);
		event("willAppear", `detail-${cell.coord}`, { action: cell.uuid, device: "details", controller: "Keypad", coordinates: { column, row }, settings: cell.settings });
	}
	await sleep(500);
	let start = traffic.length;
	await command("dead", "MODE dead");
	await phase("fallback", "gadget", start);
	start = traffic.length;
	await command("alive", "MODE alive");
	await phase("upgrade", "shared-memory", start);
	check(traffic.filter((msg) => msg.event === "setSettings" && actions.has(msg.context)).every((msg) => msg.payload.readingKey === actions.get(msg.context).settings.readingKey), "provider transitions never rewrite saved selections");
	const back = cells.find((cell) => cell.settings.detailRole === "back");
	const [column, row] = back.coord.split(",").map(Number);
	const backAction = { action: back.uuid, device: "details", controller: "Keypad", coordinates: { column, row }, settings: back.settings };
	start = traffic.length;
	event("keyDown", `detail-${back.coord}`, backAction); event("keyUp", `detail-${back.coord}`, backAction);
	await waitUntil(() => traffic.slice(start).some((msg) => msg.event === "switchToProfile"), 4000);
	check(traffic.slice(start).some((msg) => msg.event === "switchToProfile" && msg.payload?.profile === undefined), "Back returns after both transitions");
	await pairingLeg();
	console.log(`READING LINKS E2E: ${checks} checks passed`);
} finally {
	clearInterval(updater);
	if (plugin && plugin.exitCode === null) { const done = once(plugin, "exit"); plugin.kill(); await done; }
	if (producer && producer.exitCode === null) { const done = once(producer, "exit"); producer.stdin.write("exit\n"); await done; }
	for (const client of server.clients) client.terminate();
	await new Promise((resolve) => server.close(resolve));
	regDeleteKey(regPath);
}
