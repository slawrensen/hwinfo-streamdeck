// Workspace-pages end-to-end (issue #5 follow-up): impersonates the Stream
// Deck app and drives the REAL shipped plugin binary through the whole
// workspace entry contract over a mock socket. What it proves that a unit
// test cannot: the page index actually reaches the wire, the profile name
// on the wire is the one whose archive ships in this build, the baked Back
// key inside that archive really does leave, and a panel open writes
// nothing. Run with `npm run e2e:workspace` (after `npm run build`).
//
// Every leg gets its OWN device: LEAVE_DEBOUNCE_MS is 1.5 s and is keyed by
// device, so sharing one deck across legs would silently swallow dispatches
// and turn real regressions green.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { buildInfo, makeCheck, pluginArgv, sleep, waitUntil } from "./lib/e2e-common.mjs";
import { unzipStore } from "./lib/profile-cells.mjs";

const PORT = 28992;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");

const results = { errors: [] };
const check = makeCheck((name) => results.errors.push(name));

// --- traffic capture -----------------------------------------------------
const switches = []; // { device, profile, page }
const setSettings = []; // { context, payload }
const showAlerts = []; // context

const switchesFor = (device) => switches.filter((s) => s.device === device);

/** The keypad cells of EVERY page of a shipped profile archive, in the
 *  umbrella's page order: [[{coord, settings, uuid}], ...]. profileCells
 *  only reads the first page, which cannot see a four-page bundle. */
function workspacePages(name) {
	const files = unzipStore(fs.readFileSync(path.join(pluginDir, `${name}.streamDeckProfile`)));
	const umbrellaName = [...files.keys()].find((n) => /^Profiles\/[^/]+\.sdProfile\/manifest\.json$/.test(n));
	const umbrella = JSON.parse(files.get(umbrellaName).toString("utf8"));
	const root = umbrellaName.slice(0, umbrellaName.lastIndexOf("/"));
	return umbrella.Pages.Pages.map((page) => {
		const entry = files.get(`${root}/Profiles/${page.toUpperCase()}/manifest.json`);
		const parsed = JSON.parse(entry.toString("utf8"));
		const keypad = parsed.Controllers.find((c) => c.Type === "Keypad");
		return Object.entries(keypad.Actions ?? {}).map(([coord, e]) => ({ coord, settings: e.Settings, uuid: e.UUID }));
	});
}

let finished = false;
const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });

// A port already held (a previous run's plugin still exiting, another suite
// mid-teardown) otherwise surfaces as a bare stack trace with no suite name
// in it, which reads like a product failure inside hygiene's output.
wss.on("error", (err) => {
	console.error(`E2E WORKSPACE: cannot listen on 127.0.0.1:${PORT} — ${String(err)}`);
	process.exit(1);
});

wss.on("connection", (ws) => {
	const send = (obj) => ws.send(JSON.stringify(obj));
	ws.on("message", async (data) => {
		const msg = JSON.parse(data.toString());
		switch (msg.event) {
			case "registerPlugin":
				await scenario(send).catch((err) => {
					console.error("scenario crashed:", err);
					results.errors.push(String(err));
					void finish();
				});
				break;
			case "getGlobalSettings":
				send({ event: "didReceiveGlobalSettings", payload: { settings: {} } });
				break;
			case "switchToProfile":
				switches.push({ device: msg.device, profile: msg.payload?.profile, page: msg.payload?.page });
				break;
			case "setSettings":
				setSettings.push({ context: msg.context, payload: msg.payload });
				break;
			case "showAlert":
				showAlerts.push(msg.context);
				break;
			default:
				break;
		}
	});
});

// --- app-side helpers ----------------------------------------------------
const READING = "com.lawrensen.hwinfo.reading";

function appearKey(send, context, device, settings, coordinates = { column: 2, row: 1 }) {
	send({ event: "willAppear", action: READING, context, device, payload: { settings, coordinates, controller: "Keypad", isInMultiAction: false } });
}

function press(send, context, device, settings, coordinates = { column: 2, row: 1 }) {
	send({ event: "keyDown", action: READING, context, device, payload: { settings, coordinates } });
	send({ event: "keyUp", action: READING, context, device, payload: { settings, coordinates } });
}

/** Appear an opener, press it once, and wait for its dispatch to land. */
async function openerPress(send, device, settings, coordinates) {
	const context = `ctx-${device}`;
	appearKey(send, context, device, settings, coordinates);
	await sleep(250);
	const before = switchesFor(device).length;
	press(send, context, device, settings, coordinates);
	await waitUntil(() => switchesFor(device).length > before, 1500);
	return context;
}

// --- the scenario --------------------------------------------------------
async function scenario(send) {
	await sleep(700); // let the plugin settle its devices and poller

	// --- A. shipped bytes: every page of every workspace bundle carries
	// exactly one Back, and nothing else. This asserts the artifact this
	// build would actually install, not the generator's intent.
	const WORKSPACE_KEYS = ["mini", "standard", "neo", "plus", "xl", "plus-xl"];
	let pagesOk = true;
	let pageDetail = "";
	for (const key of WORKSPACE_KEYS) {
		const pages = workspacePages(`profiles/workspace-${key}`);
		if (pages.length !== 4) {
			pagesOk = false;
			pageDetail = `${key} has ${pages.length} pages`;
			break;
		}
		for (const [i, cells] of pages.entries()) {
			// The family marker has to be in the SHIPPED bytes: it is frozen
			// with the bundle and can never be added after the first install.
			const onlyBack = cells.length === 1 && cells[0].settings?.detailRole === "back" && cells[0].settings?.workspaceBack === true && cells[0].uuid === READING;
			if (!onlyBack) {
				pagesOk = false;
				pageDetail = `${key} page ${i}: ${JSON.stringify(cells)}`;
				break;
			}
		}
		if (!pagesOk) break;
	}
	check("every shipped workspace page carries exactly one baked Back key", pagesOk, pageDetail || "6 bundles x 4 pages");

	// Distinct ActionIDs per page (a duplicated id would make the app treat
	// two pages' Back as one instance).
	const stdPages = workspacePages("profiles/workspace-standard");
	const backCoord = stdPages[0][0].coord;
	const [backCol, backRow] = backCoord.split(",").map(Number);

	// --- B. entry with an explicit page: the configured page reaches the wire.
	await openerPress(send, "wpage", { pressBehavior: "open-workspace", workspacePage: "2" });
	const bSwitch = switchesFor("wpage").at(-1);
	check("entry switches to the standard workspace on the configured page", bSwitch !== undefined && bSwitch.profile === "profiles/workspace-standard" && bSwitch.page === 2, JSON.stringify(bSwitch));

	// --- C. the page is ALWAYS explicit. An omitted setting must still put a
	// literal 0 on the wire: undefined would let the app restore whatever
	// page the user last looked at, which is the whole bug this guards.
	await openerPress(send, "wdefault", { pressBehavior: "open-workspace" });
	const cSwitch = switchesFor("wdefault").at(-1);
	check("an unset page dispatches an explicit 0, never undefined", cSwitch !== undefined && cSwitch.page === 0 && Object.prototype.hasOwnProperty.call(cSwitch, "page"), JSON.stringify(cSwitch));

	// --- D. clamp: a page past the shipped count lands on the last real page.
	await openerPress(send, "wclamp", { pressBehavior: "open-workspace", workspacePage: "9" });
	const dSwitch = switchesFor("wclamp").at(-1);
	check("an out-of-range page clamps to the last shipped page", dSwitch !== undefined && dSwitch.page === 3, JSON.stringify(dSwitch));

	// --- E. salvage: junk degrades to page 0 rather than refusing or throwing.
	await openerPress(send, "wjunk", { pressBehavior: "open-workspace", workspacePage: "banana" });
	const eSwitch = switchesFor("wjunk").at(-1);
	check("a malformed page degrades to page 0", eSwitch !== undefined && eSwitch.page === 0, JSON.stringify(eSwitch));

	// A float is malformed too (the select only ever writes integers).
	await openerPress(send, "wfloat", { pressBehavior: "open-workspace", workspacePage: 2.5 });
	const fSwitch = switchesFor("wfloat").at(-1);
	check("a fractional page degrades to page 0", fSwitch !== undefined && fSwitch.page === 0, JSON.stringify(fSwitch));

	// A negative page clamps up to 0.
	await openerPress(send, "wneg", { pressBehavior: "open-workspace", workspacePage: "-3" });
	const negSwitch = switchesFor("wneg").at(-1);
	check("a negative page clamps to 0", negSwitch !== undefined && negSwitch.page === 0, JSON.stringify(negSwitch));

	// --- F. device classes resolve to their own bundle.
	await openerPress(send, "wxl", { pressBehavior: "open-workspace", workspacePage: "1" }, { column: 3, row: 1 });
	const xlSwitch = switchesFor("wxl").at(-1);
	check("an XL enters the XL workspace bundle", xlSwitch !== undefined && xlSwitch.profile === "profiles/workspace-xl" && xlSwitch.page === 1, JSON.stringify(xlSwitch));

	// --- G. a variable-canvas guest borrows the bundle its grid fits.
	await openerPress(send, "wvsd", { pressBehavior: "open-workspace", workspacePage: "3" });
	const vsdSwitch = switchesFor("wvsd").at(-1);
	check("a Virtual Stream Deck enters a workspace its grid fits", vsdSwitch !== undefined && typeof vsdSwitch.profile === "string" && vsdSwitch.profile.startsWith("profiles/workspace-") && vsdSwitch.page === 3, JSON.stringify(vsdSwitch));

	// --- H. refusal on an unsupported device: nothing switches, the key
	// cues the refusal, and the deck stays exactly where it was.
	const pedCtx = "ctx-wped";
	appearKey(send, pedCtx, "wped", { pressBehavior: "open-workspace", workspacePage: "1" }, { column: 0, row: 0 });
	await sleep(250);
	const alertsBefore = showAlerts.length;
	press(send, pedCtx, "wped", { pressBehavior: "open-workspace", workspacePage: "1" }, { column: 0, row: 0 });
	await sleep(900); // a nothing-happened assertion needs the full window
	check("an unsupported device refuses without switching", switchesFor("wped").length === 0, JSON.stringify(switchesFor("wped")));
	check("the refusal raises the alert cue on the key", showAlerts.length > alertsBefore && showAlerts.includes(pedCtx), `alerts ${alertsBefore} -> ${showAlerts.length}`);

	// --- I. Back: the REAL baked cell out of the shipped archive leaves with
	// the profile name omitted, which is what restores the previous profile.
	const backSettings = stdPages[0][0].settings;
	check("the baked Back cell carries exactly the role and family markers", JSON.stringify(backSettings) === JSON.stringify({ detailRole: "back", workspaceBack: true }), JSON.stringify(backSettings));
	const backCtx = "ctx-wback";
	appearKey(send, backCtx, "wback", backSettings, { column: backCol, row: backRow });
	await sleep(250);
	press(send, backCtx, "wback", backSettings, { column: backCol, row: backRow });
	await waitUntil(() => switchesFor("wback").length > 0, 1500);
	const backSwitch = switchesFor("wback").at(-1);
	check("the baked Back leaves with the profile name omitted", backSwitch !== undefined && backSwitch.profile === undefined, JSON.stringify(backSwitch));

	// --- J. a double-tapped opener inside the switch beat is ONE dispatch.
	const dblCtx = "ctx-wdbl";
	const dblSettings = { pressBehavior: "open-workspace", workspacePage: "1" };
	appearKey(send, dblCtx, "wdbl", dblSettings);
	await sleep(250);
	press(send, dblCtx, "wdbl", dblSettings);
	await waitUntil(() => switchesFor("wdbl").length > 0, 1500);
	press(send, dblCtx, "wdbl", dblSettings); // inside the 1.5 s beat
	await sleep(900);
	check("a double-tapped opener dispatches once inside the beat", switchesFor("wdbl").length === 1, `${switchesFor("wdbl").length} dispatches`);

	// --- K. two decks are isolated: each enters its own workspace, and one
	// device's debounce never suppresses the other's.
	const aCtx = "ctx-wiso1";
	const bCtx = "ctx-wiso2";
	appearKey(send, aCtx, "wiso1", { pressBehavior: "open-workspace", workspacePage: "1" });
	appearKey(send, bCtx, "wiso2", { pressBehavior: "open-workspace", workspacePage: "2" });
	await sleep(250);
	press(send, aCtx, "wiso1", { pressBehavior: "open-workspace", workspacePage: "1" });
	press(send, bCtx, "wiso2", { pressBehavior: "open-workspace", workspacePage: "2" });
	await waitUntil(() => switchesFor("wiso1").length > 0 && switchesFor("wiso2").length > 0, 1500);
	const isoA = switchesFor("wiso1").at(-1);
	const isoB = switchesFor("wiso2").at(-1);
	check("two decks enter their own workspace page at once", isoA?.page === 1 && isoB?.page === 2 && isoA.device === "wiso1" && isoB.device === "wiso2", `${JSON.stringify(isoA)} | ${JSON.stringify(isoB)}`);

	// --- L. opening the property inspector writes NOTHING. A panel that
	// writes on open would rewrite a user's settings just by being looked at.
	const piCtx = "ctx-wpi";
	appearKey(send, piCtx, "wpi", { pressBehavior: "open-workspace", workspacePage: "2" });
	await sleep(300);
	const writesBefore = setSettings.filter((s) => s.context === piCtx).length;
	send({ event: "propertyInspectorDidAppear", action: READING, context: piCtx, device: "wpi" });
	await sleep(1200); // nothing-happened: needs the whole window
	const writesAfter = setSettings.filter((s) => s.context === piCtx).length;
	check("opening the panel on a workspace opener writes no settings", writesAfter === writesBefore, `${writesBefore} -> ${writesAfter}`);
	send({ event: "propertyInspectorDidDisappear", action: READING, context: piCtx, device: "wpi" });

	// --- M. a plain key press is untouched by the new behavior: no profile
	// traffic at all from a default opener.
	const plainCtx = "ctx-wplain";
	appearKey(send, plainCtx, "wplain", {});
	await sleep(250);
	press(send, plainCtx, "wplain", {});
	await sleep(900);
	check("a default key press still causes no profile traffic", switchesFor("wplain").length === 0, JSON.stringify(switchesFor("wplain")));

	// --- N. an unrecognized future marker degrades to cycle-stat, not to a
	// workspace switch (settings are append-only and must age safely).
	const futCtx = "ctx-wfuture";
	appearKey(send, futCtx, "wfuture", { pressBehavior: "open-teleporter", workspacePage: "2" });
	await sleep(250);
	press(send, futCtx, "wfuture", { pressBehavior: "open-teleporter", workspacePage: "2" });
	await sleep(900);
	check("an unknown press behavior never opens a workspace", switchesFor("wfuture").length === 0, JSON.stringify(switchesFor("wfuture")));

	await finish();
}

async function finish() {
	if (finished) return;
	finished = true;
	plugin.kill();
	await sleep(300);
	wss.close();
	console.log(results.errors.length === 0 ? "\nE2E WORKSPACE: ALL CHECKS PASSED" : `\nE2E WORKSPACE: ${results.errors.length} FAILURES`);
	process.exit(results.errors.length === 0 ? 0 : 1);
}

// --- boot ----------------------------------------------------------------
const STD = { columns: 5, rows: 3 };
const info = buildInfo({
	devices: [
		{ id: "wpage", name: "WS Deck A", size: STD, type: 0 },
		{ id: "wdefault", name: "WS Deck B", size: STD, type: 0 },
		{ id: "wclamp", name: "WS Deck C", size: STD, type: 0 },
		{ id: "wjunk", name: "WS Deck D", size: STD, type: 0 },
		{ id: "wfloat", name: "WS Deck E", size: STD, type: 0 },
		{ id: "wneg", name: "WS Deck F", size: STD, type: 0 },
		{ id: "wback", name: "WS Deck G", size: STD, type: 0 },
		{ id: "wdbl", name: "WS Deck H", size: STD, type: 0 },
		{ id: "wiso1", name: "WS Deck I", size: STD, type: 0 },
		{ id: "wiso2", name: "WS Deck J", size: STD, type: 0 },
		{ id: "wpi", name: "WS Deck K", size: STD, type: 0 },
		{ id: "wplain", name: "WS Deck L", size: STD, type: 0 },
		{ id: "wfuture", name: "WS Deck M", size: STD, type: 0 },
		{ id: "wxl", name: "WS XL", size: { columns: 8, rows: 4 }, type: 2 },
		{ id: "wvsd", name: "WS Virtual", size: { columns: 10, rows: 10 }, type: 11 },
		{ id: "wped", name: "WS Pedal", size: { columns: 3, rows: 1 }, type: 5 }
	]
});

const plugin = spawn(process.execPath, pluginArgv(PORT, "e2e-workspace", info), {
	cwd: pluginDir,
	stdio: ["ignore", "inherit", "inherit"],
	env: { ...process.env, HWINFO_LOG_LEVEL: "debug" }
});
plugin.on("exit", (code) => {
	if (!finished) {
		console.error(`plugin exited early with code ${code}`);
		process.exit(1);
	}
});

setTimeout(() => {
	if (!finished) {
		console.error("E2E WORKSPACE: timeout — scenario never completed");
		plugin.kill();
		process.exit(1);
	}
}, 90000);
