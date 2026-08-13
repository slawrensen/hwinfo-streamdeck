// Gadget-registry backend e2e: shared memory is pointed at a nonexistent
// mapping so the plugin's "auto" source must fall back to the Gadget
// registry, which this script populates under a synthetic HKCU key.
//
//   registry populated  → live "Test Temp" value via gadget + gadget hint
//   value updated       → frame shows the new value
//   values frozen       → "Not updating" (digest-based staleness)
//   updates resume      → live again
//   key deleted         → "Start HWiNFO"
//   key exists, empty   → "Tick sensors" (gadget-empty, NOT "start HWiNFO")
//
// Run with `npm run e2e:gadget` (after `npm run build`).
import { execSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { buildInfo, decodeSvg, makeCheck, makeExpectFrame, pluginArgv, regDeleteKey as regDeleteKeyAt, regSet as regSetAt, sleep } from "./lib/e2e-common.mjs";

const PORT = 28997;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");

const VSB_SUBKEY = `Software\\HwinfoE2E_VSB_${process.pid}`;
const REG_PATH = `HKCU\\${VSB_SUBKEY}`;
const READING_KEY = "g:Test Source:Test Temp";

const frames = [];
const piPayloads = [];
let failures = 0;

const check = makeCheck(() => {
	failures += 1;
});
const expectFrame = makeExpectFrame(frames, check);
const regSet = (name, value) => regSetAt(REG_PATH, name, value);
const regDeleteKey = () => regDeleteKeyAt(REG_PATH);

function publish(temp) {
	regSet("Sensor0", "Test Source");
	regSet("Label0", "Test Temp");
	regSet("Value0", `${temp} °C`);
	regSet("ValueRaw0", String(temp));
	regSet("Sensor1", "Test Source");
	regSet("Label1", "Test Fan");
	regSet("Value1", "1200 RPM");
	regSet("ValueRaw1", "1200");
}

// --- mock Stream Deck ---------------------------------------------------------
const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });
let pluginWs = null;
wss.on("connection", (ws) => {
	pluginWs = ws;
	ws.on("message", (data) => {
		const msg = JSON.parse(data.toString());
		if (msg.event === "registerPlugin") {
			send({
				event: "willAppear",
				action: "com.lawrensen.hwinfo.reading",
				context: "ctx-gadget",
				device: "dev1",
				payload: { settings: { readingKey: READING_KEY }, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false }
			});
			send({ event: "propertyInspectorDidAppear", action: "com.lawrensen.hwinfo.reading", context: "ctx-gadget", device: "dev1" });
			send({ event: "sendToPlugin", action: "com.lawrensen.hwinfo.reading", context: "ctx-gadget", payload: { event: "getSensorTree" } });
		} else if (msg.event === "getGlobalSettings") {
			send({ event: "didReceiveGlobalSettings", payload: { settings: {} } });
		} else if (msg.event === "setImage" && msg.context === "ctx-gadget") {
			const svg = decodeSvg(msg.payload?.image);
			if (svg !== null) {
				frames.push(svg);
			}
		} else if (msg.event === "sendToPropertyInspector") {
			piPayloads.push(msg.payload);
		}
	});
});
const send = (obj) => pluginWs?.send(JSON.stringify(obj));

// Registry primed BEFORE the plugin starts.
publish(47.5);

const plugin = spawn(
	process.execPath,
	pluginArgv(PORT, "e2e-gadget", buildInfo({ devices: [{ id: "dev1", name: "Harness Deck", size: { columns: 5, rows: 3 }, type: 0 }] })),
	{
		cwd: pluginDir,
		env: {
			...process.env,
			HWINFO_SM2_NAME: `Local\\HwinfoE2E_NoSuchMapping_${process.pid}`, // force SM unavailable
			HWINFO_VSB_KEY: VSB_SUBKEY,
			HWINFO_STALE_AFTER_MS: "2500",
			HWINFO_REOPEN_PROBE_MS: "1000",
			HWINFO_UPGRADE_PROBE_MS: "3600000" // never upgrade during this test
		},
		stdio: ["ignore", "inherit", "inherit"]
	}
);

try {
	// 1. Auto-fallback: SM absent, gadget populated → live value.
	await expectFrame("auto-fallback → live gadget 'Test Temp'", (svg) => svg.includes("Test Temp") && svg.includes("°C") && svg.includes("47.5"), 8000);

	// 2. Values change → frame updates. Keep updating so the digest stays fresh.
	const updater = setInterval(() => publish((48.9 + Math.random() * 0.05).toFixed(2)), 700);
	await expectFrame("value update propagates", (svg) => svg.includes("48.9"), 8000);

	// 3. PI: sensor tree groups + gadget hint.
	await sleep(500);
	const tree = piPayloads.find((p) => p?.event === "sensorTree" && p.groups?.length > 0);
	const anyGadget = piPayloads.find((p) => p?.source === "gadget");
	check("PI sensorTree has the gadget group", tree !== undefined && tree.groups[0]?.name === "Test Source" && tree.groups[0]?.readings?.length === 2, JSON.stringify(tree?.groups ?? []).slice(0, 120));
	check("PI payloads report source=gadget with hint", anyGadget !== undefined && piPayloads.some((p) => typeof p?.hint === "string" && p.hint.includes("Gadget")), anyGadget?.hint?.slice(0, 80) ?? "");

	// 4. Freeze (HWiNFO exits — key remains, values stop changing) → stale.
	clearInterval(updater);
	await expectFrame("frozen registry → 'Not updating'", (svg) => svg.includes("Not updating"), 12000);

	// 5. Resume → live again.
	const updater2 = setInterval(() => publish((51.1 + Math.random() * 0.05).toFixed(2)), 700);
	await expectFrame("resumed updates → live again", (svg) => svg.includes("51.1"), 10000);
	clearInterval(updater2);

	// 6. Key deleted → unavailable.
	regDeleteKey();
	await expectFrame("key deleted → 'Start HWiNFO'", (svg) => svg.includes("Start HWiNFO"), 10000);

	// 7. Key present but EMPTY (gadget enabled, nothing ticked) — must NOT be
	// diagnosed as "start HWiNFO"; the user needs to tick sensors instead.
	execSync(`reg add "${REG_PATH}" /f`, { stdio: "ignore" });
	await expectFrame("empty key → 'Tick sensors' (gadget-empty)", (svg) => svg.includes("Tick sensors"), 10000);
} finally {
	plugin.kill();
	wss.close();
	try {
		regDeleteKey();
	} catch {
		// already gone
	}
}

console.log(failures === 0 ? "\nGADGET E2E: ALL CHECKS PASSED" : `\nGADGET E2E: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
