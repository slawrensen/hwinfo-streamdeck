// Regression e2e for the DEAD-magic auto-fallback bug (v1.1.5): a present-but-
// "DEAD" shared-memory mapping (free HWiNFO after its 12 h limit leaves the
// named section behind) must NOT strand auto mode on "Shared Memory off" when
// the gadget registry is available — the poller must fall back to gadget and
// stay there across the shared-memory upgrade probes (which used to clobber the
// working gadget provider by "successfully" opening the dead mapping).
//
//   present DEAD mapping + populated gadget, auto → live gadget value
//   value keeps updating past the upgrade-probe interval (no clobber)
//
// Phase B (busy-at-open): with the SAME populated gadget key, a LIVE mapping
// whose consistency mutex is held at the instant the plugin opens must show
// "HWiNFO busy" and retry shared memory, never silently fall back to gadget
// (whose key namespace differs, so a shared-memory key would read "Sensor
// missing" until the upgrade probe swung back).
//
// Combines fake-hwinfo.mjs (the DEAD mapping) with a synthetic HKCU gadget key.
// Run with `npm run e2e:dead-fallback` (after `npm run build`).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { buildInfo, decodeSvg, makeCheck, makeExpectFrame, pluginArgv, regDeleteKey as regDeleteKeyAt, regSet as regSetAt, sleep } from "./lib/e2e-common.mjs";

const PORT = 28999;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");

const MAPPING_NAME = `Local\\HwinfoDead_SM2_${process.pid}`;
const MUTEX_NAME = `${MAPPING_NAME}_MUTEX`;
const VSB_SUBKEY = `Software\\HwinfoDead_VSB_${process.pid}`;
const REG_PATH = `HKCU\\${VSB_SUBKEY}`;
const READING_KEY = "g:Test Source:Test Temp"; // gadget-format key
const SM_READING_KEY = "f0001234:0:1000001"; // the same reading, shared-memory identity
let phase = "dead"; // which plugin instance willAppear configures

const frames = [];
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
				context: `ctx-${phase}`,
				device: "dev1",
				payload: {
					settings: { readingKey: phase === "busy" ? SM_READING_KEY : READING_KEY },
					coordinates: { column: 0, row: 0 },
					controller: "Keypad",
					isInMultiAction: false
				}
			});
		} else if (msg.event === "getGlobalSettings") {
			send({ event: "didReceiveGlobalSettings", payload: { settings: {} } }); // source defaults to auto
		} else if (msg.event === "setImage" && msg.context === `ctx-${phase}`) {
			const svg = decodeSvg(msg.payload?.image);
			if (svg !== null) {
				frames.push(svg);
			}
		}
	});
});
const send = (obj) => pluginWs?.send(JSON.stringify(obj));

// --- fake shared memory, driven straight to DEAD -----------------------------
let fake = null;
function startFakeDead() {
	return new Promise((resolve, reject) => {
		fake = spawn(process.execPath, [path.join(repoRoot, "scripts", "fake-hwinfo.mjs")], {
			env: { ...process.env, HWINFO_SM2_NAME: MAPPING_NAME, HWINFO_SM2_MUTEX_NAME: MUTEX_NAME },
			stdio: ["pipe", "pipe", "inherit"]
		});
		fake.stdout.on("data", (d) => {
			const s = d.toString();
			if (s.includes("READY")) {
				fake.stdin.write("dead\n"); // present-but-DEAD mapping
			}
			if (s.includes("MODE dead")) {
				resolve();
			}
		});
		fake.on("exit", () => {
			fake = null;
		});
		setTimeout(() => reject(new Error("fake provider did not reach DEAD")), 5000);
	});
}

/** Waits for the fake provider to echo a command's confirmation line. */
function fakeCmd(cmd, expectEcho) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			fake?.stdout.off("data", onData);
			reject(new Error(`fake did not echo ${expectEcho}`));
		}, 5000);
		const onData = (d) => {
			if (d.toString().includes(expectEcho)) {
				clearTimeout(timer);
				fake.stdout.off("data", onData);
				resolve();
			}
		};
		fake.stdout.on("data", onData);
		fake.stdin.write(`${cmd}\n`);
	});
}

function spawnPlugin(uuid) {
	return spawn(
		process.execPath,
		pluginArgv(PORT, uuid, buildInfo({ devices: [{ id: "dev1", name: "Harness Deck", size: { columns: 5, rows: 3 }, type: 0 }] })),
		{
			cwd: pluginDir,
			env: {
				...process.env,
				HWINFO_SM2_NAME: MAPPING_NAME,
				HWINFO_SM2_MUTEX_NAME: MUTEX_NAME,
				HWINFO_VSB_KEY: VSB_SUBKEY,
				HWINFO_STALE_AFTER_MS: "4000",
				HWINFO_REOPEN_PROBE_MS: "1000",
				HWINFO_UPGRADE_PROBE_MS: "1500" // probe SM often; a DEAD open must NOT clobber gadget
			},
			stdio: ["ignore", "inherit", "inherit"]
		}
	);
}

try {
	// Gadget populated + present DEAD shared-memory mapping, BEFORE the plugin runs.
	publish(47.5);
	await startFakeDead();

	const plugin = spawnPlugin("e2e-dead-fallback");
	try {
		// 1. Present DEAD mapping must not block the gadget fallback in auto mode.
		//    (Pre-fix: SharedMemoryProvider.open() "succeeds" on the dead mapping,
		//    so auto never reaches gadget and the key shows "Shared Memory off".)
		await expectFrame("present DEAD mapping → falls back to live gadget value", (svg) => svg.includes("Test Temp") && svg.includes("47.5"), 9000);
		const smFrames = frames.map((svg, i) => [i, svg]).filter(([, svg]) => svg.includes("Shared Memory"));
		if (smFrames.length > 0) {
			console.log(`  [diag] frame ${smFrames[0][0]} of ${frames.length}: ${smFrames[0][1].replace(/\s+/g, " ").slice(0, 220)}`);
		}
		check("never shows the 'Shared Memory off' screen", smFrames.length === 0, `${smFrames.length} such frame(s)`);

		// 2. Keep updating and outlast the 1.5 s upgrade probe: the probe opens the
		//    dead mapping and must throw (not clobber the working gadget provider).
		const updater = setInterval(() => publish((49.0 + Math.random() * 0.05).toFixed(2)), 600);
		await expectFrame("gadget survives upgrade probes → value keeps updating (no clobber)", (svg) => svg.includes("49.0"), 9000);
		clearInterval(updater);
	} finally {
		plugin.kill();
	}

	// --- Phase B: busy-at-open must not silently downgrade to gadget ----------
	// The mapping goes live but its consistency mutex is HELD at the instant a
	// fresh plugin opens. The gadget key is still populated, so a fallback
	// would "succeed" and this key's shared-memory identity would read
	// "Sensor missing" until the upgrade probe swung back. The poller must
	// surface "HWiNFO busy" and retry shared memory instead.
	phase = "busy";
	await fakeCmd("alive", "MODE alive");
	await fakeCmd("hold", "HELD");
	const busyStart = frames.length;
	const plugin2 = spawnPlugin("e2e-busy-open");
	try {
		await expectFrame("mutex held at open → 'HWiNFO busy' screen", (svg) => svg.includes("HWiNFO busy"), 9000);
		fake.stdin.write("release\n");
		await expectFrame("mutex released → live shared-memory value", (svg) => svg.includes("Test Temp") && svg.includes("°C"), 9000);
		const missing = frames.slice(busyStart).filter((svg) => svg.includes("Sensor missing"));
		check("no silent gadget downgrade ('Sensor missing' never shown)", missing.length === 0, `${missing.length} such frame(s)`);
	} finally {
		plugin2.kill();
	}
} finally {
	fake?.stdin.write("exit\n");
	await sleep(300);
	fake?.kill();
	wss.close();
	try {
		regDeleteKey();
	} catch {
		// already gone
	}
}

console.log(failures === 0 ? "\nDEAD-FALLBACK E2E: FALLBACK + NO-CLOBBER VERIFIED" : `\nDEAD-FALLBACK E2E: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
