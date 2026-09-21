// Native-boundary edge e2e: drives the BUILT plugin through the conditions
// the hwsm capability API must fail closed on, asserting on rendered frames:
//
//   mapping present, mutex ABSENT  → "Start HWiNFO" (never an unguarded read)
//   mutex appears                  → live value (recovery)
//   published layout GROWS mid-run → session invalidates → reopen → live again
//   late timestamp-only update     → producer age retained → stale face
//   duplicate IDs / missing owners → missing faces and withheld picker entries
//   unique identity recovery       → saved base key and healthy offsets work
//   protocol-mismatched hwsm.node  → "Bridge failed" (loader fails closed)
//
// The mismatch leg runs a second plugin instance from a scratch bundle whose
// hwsm.node is the hwsm_protomm build (HWSM_PROTOCOL_VERSION=999).
// Run with `npm run e2e:native-edge` (after `npm run build`).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { buildInfo, decodeSvg, makeCheck, makeExpectFrame, sleep, waitUntil } from "./lib/e2e-common.mjs";

const PORT = 28995;
const MISMATCH_PORT = 28994;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");

const MAPPING_NAME = `Local\\HwinfoE2E_Edge_${process.pid}`;
const MUTEX_NAME = `${MAPPING_NAME}_MUTEX`;
const READING_KEY = "f0001234:0:1000001"; // "Test Temp" in the fake provider

let failures = 0;

const check = makeCheck(() => {
	failures += 1;
});

function makeServer(port, context, frames, traffic = []) {
	const wss = new WebSocketServer({ host: "127.0.0.1", port });
	let ws = null;
	wss.on("connection", (socket) => {
		ws = socket;
		socket.on("message", (data) => {
			const msg = JSON.parse(data.toString());
			traffic.push({ ...msg, svg: msg.event === "setImage" ? decodeSvg(msg.payload?.image) : null });
			if (msg.event === "registerPlugin") {
				socket.send(JSON.stringify({
					event: "willAppear",
					action: "com.lawrensen.hwinfo.reading",
					context,
					device: "dev1",
					payload: { settings: { readingKey: READING_KEY }, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false }
				}));
			} else if (msg.event === "getGlobalSettings") {
				socket.send(JSON.stringify({ event: "didReceiveGlobalSettings", payload: { settings: {} } }));
			} else if (msg.event === "setImage" && msg.context === context) {
				const svg = decodeSvg(msg.payload?.image);
				if (svg !== null) {
					frames.push(svg);
				}
			}
		});
	});
	return { wss, send: (obj) => ws?.send(JSON.stringify(obj)) };
}

// A one-shot status screen renders exactly once at plugin startup; a leg
// asserting on it passes fromStart to scan the whole history, not just new
// frames (see makeExpectFrame).
const expectFrame = (frames, name, predicate, timeoutMs, opts) => makeExpectFrame(frames, check)(name, predicate, timeoutMs, opts);

function spawnPlugin(entry, cwd, port, uuid) {
	return spawn(
		process.execPath,
		[entry, "-port", String(port), "-pluginUUID", uuid, "-registerEvent", "registerPlugin", "-info", JSON.stringify(buildInfo({ devices: [{ id: "dev1", name: "Harness Deck", size: { columns: 5, rows: 3 }, type: 0 }] }))],
		{
			cwd,
			env: {
				...process.env,
				HWINFO_SM2_NAME: MAPPING_NAME,
				HWINFO_SM2_MUTEX_NAME: MUTEX_NAME,
				HWINFO_VSB_KEY: `Software\\HwinfoE2E_NoVSB_${process.pid}`,
				HWINFO_STALE_AFTER_MS: "2500",
				HWINFO_REOPEN_PROBE_MS: "1000"
			},
			stdio: ["ignore", "inherit", "inherit"]
		}
	);
}

// --- leg 1: mutex-absent, recovery, layout growth ---------------------------
const frames = [];
const traffic = [];
const { wss, send } = makeServer(PORT, "ctx-edge", frames, traffic);

const fake = spawn(process.execPath, [path.join(repoRoot, "scripts", "fake-hwinfo.mjs"), "--no-mutex"], {
	env: { ...process.env, HWINFO_SM2_NAME: MAPPING_NAME, HWINFO_SM2_MUTEX_NAME: MUTEX_NAME },
	stdio: ["pipe", "pipe", "inherit"]
});
await new Promise((resolve, reject) => {
	fake.stdout.on("data", (d) => {
		if (d.toString().includes("READY")) resolve();
	});
	setTimeout(() => reject(new Error("fake provider did not become ready")), 5000);
});

/** Wait for the producer to acknowledge a command before timing its effect. */
function producerCommand(command, acknowledgment) {
	return new Promise((resolve, reject) => {
		let output = "";
		const onData = (data) => {
			output += data.toString();
			if (!output.split(/\r?\n/).includes(acknowledgment)) return;
			clearTimeout(deadline);
			fake.stdout.off("data", onData);
			resolve();
		};
		const deadline = setTimeout(() => {
			fake.stdout.off("data", onData);
			reject(new Error(`fake provider did not acknowledge ${command}`));
		}, 3000);
		fake.stdout.on("data", onData);
		fake.stdin.write(`${command}\n`);
	});
}
const freezeProducer = () => producerCommand("freeze", "MODE freeze");

async function identityRegression() {
	const fanKey = "f0001234:0:1000002";
	const invalidKeys = new Map([["ctx-edge", READING_KEY], ["ctx-edge-suffix", `${READING_KEY}~1`], ["ctx-edge-orphan", "?:7:1000001"]]);
	const statModes = ["current", "min", "max", "avg"];
	const savedKeys = new Map([...invalidKeys, ...statModes.map((stat) => [`ctx-edge-fan-${stat}`, fanKey])]);
	const latest = (context) => traffic.filter((message) => message.context === context && message.svg !== null).at(-1)?.svg ?? "";
	const hasValue = (svg, value) => svg.includes(`>${value}</text>`) || svg.includes(`>${value}<tspan`);
	let position = 1;
	for (const [context, readingKey] of savedKeys) {
		if (context === "ctx-edge") continue;
		send({ event: "willAppear", action: "com.lawrensen.hwinfo.reading", context, device: "dev1", payload: { settings: { readingKey, decimals: "0", statMode: context.startsWith("ctx-edge-fan-") ? context.slice("ctx-edge-fan-".length) : "current" }, coordinates: { column: position % 5, row: Math.floor(position / 5) }, controller: "Keypad", isInMultiAction: false } });
		position++;
	}
	send({ event: "didReceiveSettings", action: "com.lawrensen.hwinfo.reading", context: "ctx-edge", device: "dev1", payload: { settings: { readingKey: READING_KEY, decimals: "0" }, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false } });
	send({ event: "propertyInspectorDidAppear", action: "com.lawrensen.hwinfo.reading", context: "ctx-edge", device: "dev1" });
	send({ event: "didReceiveGlobalSettings", payload: { settings: { source: "shared-memory", pollIntervalMs: "250" } } });
	for (const [phase, expectedFan] of [["duplicate", [1210, 801, 2001, 1251]], ["swapped", [1300, 810, 2100, 1350]], ["orphan", [1400, 820, 2200, 1450]], ["unique", [1500, 830, 2300, 1550]]]) {
		const phaseStart = traffic.length;
		await producerCommand(`identity-${phase}`, `IDENTITY ${phase}`);
		const fanMatches = () => statModes.every((stat, index) => hasValue(latest(`ctx-edge-fan-${stat}`), expectedFan[index]));
		check(`${phase}: healthy physical row 2 retains all four statistic values`, await waitUntil(fanMatches, 5000));
		// Numeric witness frames prove the plugin accepted this fixture phase.
		// The swapped phase changes only doubles/labels under the same header,
		// owner/type/ID/unit words, exercising the parser's cached offsets.
		if (phase === "swapped") await sleep(1100);
		for (const context of invalidKeys.keys()) {
			const recovered = phase === "unique" && context === "ctx-edge";
			check(`${phase}: ${context} ${recovered ? "recovers the unique base value" : "remains Sensor missing"}`, recovered ? hasValue(latest(context), 45) && latest(context).includes("Test Temp") : latest(context).includes("Sensor missing"));
		}
		check(`${phase}: healthy statistics stay on their own physical row`, fanMatches());
		const treeStart = traffic.length;
		send({ event: "sendToPlugin", action: "com.lawrensen.hwinfo.reading", context: "ctx-edge", device: "dev1", payload: { event: "getSensorTree" } });
		await waitUntil(() => traffic.slice(treeStart).some((message) => message.event === "sendToPropertyInspector" && message.payload?.event === "sensorTree"), 3000);
		const tree = traffic.slice(treeStart).find((message) => message.event === "sendToPropertyInspector" && message.payload?.event === "sensorTree")?.payload;
		const keys = tree?.groups?.flatMap((group) => group.readings.map((reading) => reading.key)).sort();
		const expectedKeys = phase === "unique" ? [READING_KEY, fanKey, "f0001234:0:1000003"].sort() : [fanKey];
		check(`${phase}: inspector offers exactly the unambiguous owned readings`, tree?.source === "shared-memory" && tree.state === "ok" && JSON.stringify(keys) === JSON.stringify(expectedKeys));
		check(`${phase}: phase produced healthy witness frames`, traffic.slice(phaseStart).some((message) => message.context === "ctx-edge-fan-current" && message.svg !== null && hasValue(message.svg, expectedFan[0])));
	}
	check("identity withholding and recovery never migrate saved selections", traffic.filter((message) => message.event === "setSettings" && savedKeys.has(message.context)).every((message) => message.payload?.readingKey === savedKeys.get(message.context)));
}

const plugin = spawnPlugin("bin/plugin.js", pluginDir, PORT, "e2e-native-edge");

// --- leg 2: protocol mismatch in a scratch bundle ---------------------------
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "hwsm-protomm-"));
fs.mkdirSync(path.join(scratch, "bin"), { recursive: true });
fs.copyFileSync(path.join(pluginDir, "bin", "plugin.js"), path.join(scratch, "bin", "plugin.js"));
fs.copyFileSync(path.join(repoRoot, "native", "hwsm", "build", "Release", "hwsm_protomm.node"), path.join(scratch, "bin", "hwsm.node"));
// The bundle reads these relative to bin/.. at startup.
fs.copyFileSync(path.join(pluginDir, "themes.json"), path.join(scratch, "themes.json"));
fs.copyFileSync(path.join(pluginDir, "manifest.json"), path.join(scratch, "manifest.json"));
const mismatchFrames = [];
const { wss: mismatchWss } = makeServer(MISMATCH_PORT, "ctx-mm", mismatchFrames);
const mismatchPlugin = spawnPlugin(path.join(scratch, "bin", "plugin.js"), scratch, MISMATCH_PORT, "e2e-protomm");

try {
	// Mapping exists, mutex does not: the reader must treat this as "still
	// starting up", never as permission to read unguarded.
	await expectFrame(frames, "mapping without mutex → 'Start HWiNFO'", (svg) => svg.includes("Start HWiNFO"), 8000);

	fake.stdin.write("mutex\n");
	await expectFrame(frames, "mutex appears → live 'Test Temp' value", (svg) => svg.includes("Test Temp") && svg.includes("°C"), 8000);

	// The published layout grows mid-session: the exact-length session must
	// invalidate, and the poller must reopen at the new exact size WITHIN the
	// same tick. The pre-hwsm builds mapped the whole section and absorbed
	// growth invisibly; the in-place reopen must match, so no status screen
	// may reach the deck during the transition.
	const beforeGrow = frames.length;
	fake.stdin.write("grow\n");
	await sleep(300);
	await expectFrame(frames, "layout grows → live values continue (reopened in place)", (svg) => svg.includes("Test Temp"), 10000);
	const flashed = frames.slice(beforeGrow).filter((svg) => svg.includes("Source error") || svg.includes("No new data") || svg.includes("Start HWiNFO"));
	check("no status frame during the growth transition", flashed.length === 0, flashed.length > 0 ? `${flashed.length} status frame(s) reached the deck` : "");

	// A plugin.js next to a wrong-protocol hwsm.node must fail closed.
	await expectFrame(mismatchFrames, "protocol-mismatched addon → 'Bridge failed'", (svg) => svg.includes("Bridge failed"), 10000, { fromStart: true });

	// Keep the same provider/parser and establish a frozen-value baseline.
	// The next freeze command republishes only the producer timestamp. Its
	// age exceeds this harness's 2500 ms grace before the next 5000 ms poll:
	// a parser revision must not turn that old heartbeat into fresh values.
	await freezeProducer();
	await sleep(1200);
	send({ event: "didReceiveGlobalSettings", payload: { settings: { pollIntervalMs: "5000" } } });
	await sleep(1100);
	await freezeProducer();
	await expectFrame(frames, "late timestamp-only update retains producer age and shows stale", (svg) => svg.includes("Not updating"), 6000);

	fake.stdin.write("alive\n");
	send({ event: "didReceiveGlobalSettings", payload: { settings: { pollIntervalMs: "1000" } } });
	await expectFrame(frames, "new producer values recover the stale key", (svg) => svg.includes("Test Temp") && svg.includes("°C"), 5000);
	await identityRegression();
} finally {
	const gone = Promise.all([plugin, mismatchPlugin].map((p) => new Promise((r) => { p.once("exit", r); p.kill(); })));
	fake.kill();
	wss.close();
	mismatchWss.close();
	await Promise.race([gone, sleep(3000)]);
	for (let i = 0; i < 5; i++) {
		try {
			fs.rmSync(scratch, { recursive: true, force: true });
			break;
		} catch {
			await sleep(400); // the killed process may still hold hwsm.node mapped
		}
	}
}

console.log(failures === 0 ? "\nNATIVE-EDGE E2E: ALL CHECKS PASSED" : `\nNATIVE-EDGE E2E: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
