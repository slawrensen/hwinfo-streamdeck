// Forced-condition resilience e2e: drives the BUILT plugin through every
// poller state using the synthetic provider (scripts/fake-hwinfo.mjs) and a
// mock Stream Deck WebSocket, asserting on the actual rendered key frames:
//
//   (no mapping)      → "Start HWiNFO"
//   provider starts   → live "Test Temp" value
//   units flip to °F  → face follows (in-place rewrite, no status flash)
//   pollTime frozen   → "Not updating"
//   provider resumes  → live value again
//   DEAD magic        → "Shared Memory off"
//   provider resumes  → live value again
//   provider EXITS    → stale → probe-reopen fails → "Start HWiNFO"
//
// Run with `npm run e2e:resilience` (after `npm run build`).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { buildInfo, decodeSvg, makeCheck, makeExpectFrame, pluginArgv, sleep } from "./lib/e2e-common.mjs";

const PORT = 28998;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");

const MAPPING_NAME = `Local\\HwinfoE2E_SM2_${process.pid}`;
const MUTEX_NAME = `${MAPPING_NAME}_MUTEX`;
const READING_KEY = "f0001234:0:1000001"; // "Test Temp" in the fake provider

const frames = []; // decoded SVG frames for ctx-res, in arrival order
let failures = 0;

const check = makeCheck(() => {
	failures += 1;
});
const expectFrame = makeExpectFrame(frames, check);

// --- mock Stream Deck -------------------------------------------------------
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
				context: "ctx-res",
				device: "dev1",
				payload: { settings: { readingKey: READING_KEY }, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false }
			});
		} else if (msg.event === "getGlobalSettings") {
			send({ event: "didReceiveGlobalSettings", payload: { settings: {} } });
		} else if (msg.event === "setImage" && msg.context === "ctx-res") {
			const svg = decodeSvg(msg.payload?.image);
			if (svg !== null) {
				frames.push(svg);
			}
		}
	});
});
const send = (obj) => pluginWs?.send(JSON.stringify(obj));

// --- processes ---------------------------------------------------------------
let fake = null;
function startFake() {
	return new Promise((resolve, reject) => {
		fake = spawn(process.execPath, [path.join(repoRoot, "scripts", "fake-hwinfo.mjs")], {
			env: { ...process.env, HWINFO_SM2_NAME: MAPPING_NAME, HWINFO_SM2_MUTEX_NAME: MUTEX_NAME },
			stdio: ["pipe", "pipe", "inherit"]
		});
		fake.stdout.on("data", (d) => {
			if (d.toString().includes("READY")) resolve();
		});
		fake.on("exit", () => {
			fake = null;
		});
		setTimeout(() => reject(new Error("fake provider did not become ready")), 5000);
	});
}

const plugin = spawn(
	process.execPath,
	pluginArgv(PORT, "e2e-resilience", buildInfo({ devices: [{ id: "dev1", name: "Harness Deck", size: { columns: 5, rows: 3 }, type: 0 }] })),
	{
		cwd: pluginDir,
		env: {
			...process.env,
			HWINFO_SM2_NAME: MAPPING_NAME,
			HWINFO_SM2_MUTEX_NAME: MUTEX_NAME,
			// Isolate the gadget fallback too: with a real (possibly empty) VSB
			// key on the host, auto mode would diagnose gadget-empty instead of
			// this suite's expected not-running screens.
			HWINFO_VSB_KEY: `Software\\HwinfoE2E_NoVSB_${process.pid}`,
			HWINFO_STALE_AFTER_MS: "2500",
			HWINFO_REOPEN_PROBE_MS: "1000"
		},
		stdio: ["ignore", "inherit", "inherit"]
	}
);

// --- scenario ----------------------------------------------------------------
try {
	// 1. Mapping absent → not-running screen.
	await expectFrame("mapping absent → 'Start HWiNFO'", (svg) => svg.includes("Start HWiNFO"), 6000);

	// 2. Provider appears → live value (recovery from unavailable).
	await startFake();
	await expectFrame("provider up → live 'Test Temp' value", (svg) => svg.includes("Test Temp") && svg.includes("°C"), 8000);

	// 2b. HWiNFO's unit setting flips mid-session: the unit string and value
	// scale are rewritten in place under an unchanged layout. The parser must
	// notice and rebuild; the face follows to °F with no status-screen flash.
	const beforeFlip = frames.length;
	fake.stdin.write("fahrenheit\n");
	await expectFrame("units flipped in place → face shows °F", (svg) => svg.includes("°F"), 8000);
	const flipFlash = frames.slice(beforeFlip).filter((svg) => svg.includes("HWiNFO error") || svg.includes("Start HWiNFO") || svg.includes("Not updating") || svg.includes("HWiNFO busy"));
	check("no status frame during the unit flip", flipFlash.length === 0, `${flipFlash.length} status frames`);
	fake.stdin.write("celsius\n");
	await expectFrame("units restored → face shows °C again", (svg) => svg.includes("°C"), 8000);

	// 3. pollTime frozen → stale screen.
	fake.stdin.write("freeze\n");
	await expectFrame("values frozen → 'Not updating'", (svg) => svg.includes("Not updating"), 12000);

	// 3b. Stale must STICK across reopen probes: a fresh provider must not
	// reset the freshness baseline and flap back to showing frozen values as
	// live (covers >3 probe rounds at these timings).
	const staleMark = frames.length;
	await sleep(3500);
	const flapFrames = frames.slice(staleMark).filter((svg) => svg.includes("Test Temp"));
	check("stale sticks across reopen probes (no ok↔stale flap)", flapFrames.length === 0, `${flapFrames.length} live frames while frozen`);

	// 4. Resume → live again (stale → ok).
	fake.stdin.write("alive\n");
	await expectFrame("resumed → live value again", (svg) => svg.includes("Test Temp"), 8000);

	// 5. DEAD magic → disabled screen (free-version 12 h timer / toggle off).
	fake.stdin.write("dead\n");
	await expectFrame("DEAD magic → 'Shared Memory off'", (svg) => svg.includes("Shared Memory"), 8000);

	// 6. Re-enable → live again (disabled → ok).
	fake.stdin.write("alive\n");
	await expectFrame("re-enabled → live value again", (svg) => svg.includes("Test Temp"), 8000);

	// 7. Provider dies without writing DEAD (task-kill) → values freeze → the
	//    poller must release its own handles, fail the re-open, and land on
	//    the not-running screen (the stale→unavailable FSM edge).
	fake.stdin.write("exit\n");
	await expectFrame("provider gone → stale → 'Start HWiNFO'", (svg) => svg.includes("Start HWiNFO"), 15000);
} finally {
	plugin.kill();
	fake?.kill();
	wss.close();
}

console.log(failures === 0 ? "\nRESILIENCE E2E: ALL STATES FIRED" : `\nRESILIENCE E2E: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
