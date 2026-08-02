// Regression e2e: a Stream Deck socket that dies WITH KEYS STILL VISIBLE must
// end the plugin process, not leave it polling into nothing.
//
// Why this test exists. The SDK's connection sets only `onmessage` and
// `onopen`: there is no close handler, no error handler and no reconnect, and
// `ws` silently discards every send after a close instead of raising. So a
// plugin whose socket dies while the app itself keeps running would go on
// polling HWiNFO, holding its consistency mutex, and "painting" frames into a
// dead pipe, forever, with nothing in the log. On the deck that reads exactly
// like the freeze reported in issue #17: keys stuck on their last picture.
//
// The existing harnesses cannot fail on this. Both send willDisappear for
// every action FIRST, assert "Stopped (no visible actions)", and only then
// close the socket, so they exercise the idle case only, where the poll timer
// is already cleared. This one keeps a key visible on purpose.
//
// The fix under test is the poll interval being unref'd, so the socket is the
// only thing keeping the process alive.
//
//   phase 1: key visible, frames flowing, plugin ALIVE while the socket is up
//   phase 2: socket closed with the key still visible → plugin exits by itself
//
// Run with `npm run e2e:socket-close` (after `npm run build`).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const PORT = 28995;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");
/** CPU package temperature on the bench; any real reading will do, and the
 *  test does not care what it renders, only that frames keep arriving. */
const READING_KEY = "f0000501:0:1000000";
/** The plugin must not outlive the socket by more than this. Generous: the
 *  event loop only has to drain, but a slow box should not fail the run. */
const EXIT_BUDGET_MS = 15_000;
/** How long a live socket must keep the plugin alive before we trust it. */
const ALIVE_PROOF_MS = 6_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
let frames = 0;

function check(name, ok, detail = "") {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
	if (!ok) failures++;
}

const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });
let pluginWs = null;
const send = (obj) => pluginWs?.send(JSON.stringify(obj));

wss.on("connection", (ws) => {
	pluginWs = ws;
	ws.on("message", (data) => {
		const msg = JSON.parse(data.toString());
		if (msg.event === "registerPlugin") {
			send({
				event: "willAppear",
				action: "com.lawrensen.hwinfo.reading",
				context: "ctx-visible",
				device: "dev1",
				payload: {
					settings: { readingKey: READING_KEY },
					coordinates: { column: 0, row: 0 },
					controller: "Keypad",
					isInMultiAction: false
				}
			});
		} else if (msg.event === "getGlobalSettings") {
			send({ event: "didReceiveGlobalSettings", payload: { settings: {} } });
		} else if (msg.event === "setImage") {
			frames++;
		}
	});
});

const plugin = spawn(
	process.execPath,
	["bin/plugin.js", "-port", String(PORT), "-pluginUUID", "e2e-socket-close", "-registerEvent", "registerPlugin", "-info",
		JSON.stringify({
			application: { font: "Segoe UI", language: "en", platform: "windows", platformVersion: "10.0.19044", version: "7.4.2.22730" },
			colors: {},
			devicePixelRatio: 1,
			devices: [{ id: "dev1", name: "Harness Deck", size: { columns: 5, rows: 3 }, type: 0 }],
			plugin: { uuid: "com.lawrensen.hwinfo", version: "1.0.0.0" }
		})],
	{
		cwd: pluginDir,
		env: {
			...process.env,
			// The watchdog must play no part in this: the plugin's parent here
			// is this script, which stays alive throughout, so any exit we see
			// is the socket's doing.
			HWINFO_PARENT_CHECK_MS: "3600000"
		},
		stdio: ["ignore", "inherit", "inherit"]
	}
);

let exitCode = null;
let exitedAt = null;
plugin.once("exit", (code) => {
	exitCode = code;
	exitedAt = Date.now();
});

try {
	// --- phase 1: a live socket keeps the plugin alive, key visible ----------
	await sleep(ALIVE_PROOF_MS);
	check("plugin alive while the socket is up", exitCode === null, exitCode === null ? `${frames} frames drawn` : `exited early with code ${exitCode}`);
	check("frames are flowing (the key really is visible and polling)", frames > 0, `${frames} setImage calls`);

	if (exitCode !== null) {
		throw new Error("plugin exited before the socket was closed; the rest of the test is meaningless");
	}

	// --- phase 2: kill the socket, key STILL visible -------------------------
	// No willDisappear on purpose: this is the case the other harnesses skip.
	const closedAt = Date.now();
	for (const client of wss.clients) {
		client.terminate(); // abrupt, like an app that dies without tidying up
	}
	wss.close();

	const deadline = Date.now() + EXIT_BUDGET_MS;
	while (exitCode === null && Date.now() < deadline) {
		await sleep(200);
	}

	if (exitCode === null) {
		check(`plugin exits within ${EXIT_BUDGET_MS / 1000}s of the socket dying, with a key still visible`, false, "still running: it would poll HWiNFO forever, painting into nothing");
	} else {
		check(`plugin exits within ${EXIT_BUDGET_MS / 1000}s of the socket dying, with a key still visible`, true, `after ${((exitedAt - closedAt) / 1000).toFixed(1)}s, code ${exitCode}`);
	}
} finally {
	if (exitCode === null) {
		plugin.kill();
	}
	try {
		wss.close();
	} catch {
		/* already closed */
	}
}

console.log(failures === 0 ? "\nSOCKET-CLOSE E2E: ALL CHECKS PASSED" : `\nSOCKET-CLOSE E2E: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
