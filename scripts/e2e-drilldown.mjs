// Drill-down end-to-end (issue #5): impersonates the Stream Deck app,
// backs the plugin with fake-hwinfo (deterministic layout, controllable
// loss/growth), and drives the whole detail flow: entry switches to the
// class's bundled profile, the REAL shipped archive's baked cells become
// the visible slots, pagination and stat cycling render, HWiNFO freeze
// and recovery ride through, Back restores the previous profile with the
// name omitted, and a stateless surface (plugin restart semantics) shows
// honest idle tiles with Back still working. Run with `npm run
// e2e:drilldown` (after `npm run build`).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { profileCells as sharedProfileCells } from "./lib/profile-cells.mjs";

const PORT = 28994;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");
const MAPPING_NAME = `Local\\HwinfoE2E_SM2_${process.pid}`;
const MUTEX_NAME = `${MAPPING_NAME}_MUTEX`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { errors: [] };

function check(name, ok, detail = "") {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
	if (!ok) {
		results.errors.push(name);
	}
}

const profileCells = (name) => sharedProfileCells(pluginDir, name);

// --- traffic capture -----------------------------------------------------
const images = []; // { context, svg }
const switches = []; // { device, profile, page }
const setSettings = []; // { context, payload }
const showAlerts = []; // context

const svgOf = (image) => (typeof image === "string" && image.startsWith("data:image/svg+xml,") ? decodeURIComponent(image.slice("data:image/svg+xml,".length)) : null);
const latestSvg = (context) => images.filter((i) => i.context === context).map((i) => svgOf(i.svg)).filter((s) => s !== null).at(-1);

let fake = null;
let finished = false;
const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });

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
			case "setImage":
				images.push({ context: msg.context, svg: msg.payload?.image ?? "" });
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
			case "sendToPropertyInspector":
				// The tree arrives on the PI channel; capture it for the scenario.
				if (msg.payload?.event === "sensorTree") {
					results.tree = msg.payload;
				}
				break;
			default:
				break;
		}
	});
});

// --- the app-side simulation ---------------------------------------------
const OPENER = "ctx-opener";
// `suffix` mints a fresh context id space when the SAME device installs a
// surface a second time in one run (leg R reuses dev1): latestSvg must
// never read a stale frame from an earlier leg's identically named slot.
const slotCtx = (device, coord, suffix = "") => `slot-${device}-${coord.replace(",", "x")}${suffix}`;

function appearOpener(send, context, device, settings, coordinates = { column: 2, row: 1 }) {
	send({ event: "willAppear", action: "com.lawrensen.hwinfo.reading", context, device, payload: { settings, coordinates, controller: "Keypad", isInMultiAction: false } });
}

function keyPress(send, context, device, settings, holdMs = 0) {
	send({ event: "keyDown", action: "com.lawrensen.hwinfo.reading", context, device, payload: { settings, coordinates: { column: 2, row: 1 } } });
	const up = () => send({ event: "keyUp", action: "com.lawrensen.hwinfo.reading", context, device, payload: { settings, coordinates: { column: 2, row: 1 } } });
	if (holdMs === 0) {
		up();
		return Promise.resolve();
	}
	return sleep(holdMs).then(up);
}

/** Simulates the app switching to an installed detail profile: every baked
 * cell of the REAL shipped archive appears under its own action UUID (the
 * revision-2 Back cell is a Sensor Reading; everything else hidden slots). */
function installDetailSurface(send, device, cells, suffix = "") {
	for (const cell of cells) {
		const [column, row] = cell.coord.split(",").map(Number);
		send({
			event: "willAppear",
			action: cell.uuid,
			context: slotCtx(device, cell.coord, suffix),
			device,
			payload: { settings: cell.settings, coordinates: { column, row }, controller: "Keypad", isInMultiAction: false }
		});
	}
}

function removeDetailSurface(send, device, cells, suffix = "") {
	for (const cell of cells) {
		const [column, row] = cell.coord.split(",").map(Number);
		send({
			event: "willDisappear",
			action: cell.uuid,
			context: slotCtx(device, cell.coord, suffix),
			device,
			payload: { settings: cell.settings, coordinates: { column, row }, controller: "Keypad", isInMultiAction: false }
		});
	}
}

function slotPress(send, device, coord, settings) {
	const [column, row] = coord.split(",").map(Number);
	const context = slotCtx(device, coord);
	send({ event: "keyDown", action: "com.lawrensen.hwinfo.detail-slot", context, device, payload: { settings, coordinates: { column, row } } });
	send({ event: "keyUp", action: "com.lawrensen.hwinfo.detail-slot", context, device, payload: { settings, coordinates: { column, row } } });
}

async function scenario(send) {
	const standardCells = profileCells("profiles/detail-standard");
	const cellOfRole = (cells, role) => cells.find((c) => c.settings.slot === role);
	const cellOfIndex = (cells, index) => cells.find((c) => c.settings.slot === "reading" && c.settings.index === index);
	const backCtx = slotCtx("dev1", cellOfRole(standardCells, "back").coord);
	const titleCtx = slotCtx("dev1", cellOfRole(standardCells, "title").coord);
	const slot0Ctx = slotCtx("dev1", cellOfIndex(standardCells, 0).coord);
	const slot1Ctx = slotCtx("dev1", cellOfIndex(standardCells, 1).coord);

	// The fake publishes two readings in one source; learn their stable keys
	// through the same PI channel the panel uses.
	appearOpener(send, OPENER, "dev1", {});
	await sleep(1800);
	send({ event: "propertyInspectorDidAppear", action: "com.lawrensen.hwinfo.reading", context: OPENER, device: "dev1" });
	send({ event: "sendToPlugin", action: "com.lawrensen.hwinfo.reading", context: OPENER, payload: { event: "getSensorTree" } });
	await sleep(600);
	send({ event: "propertyInspectorDidDisappear", action: "com.lawrensen.hwinfo.reading", context: OPENER, device: "dev1" });
	await sleep(200);
	const keys = (results.tree?.groups ?? []).flatMap((g) => g.readings.map((r) => ({ key: r.key, label: r.label })));
	check("fake tree offers two readings", keys.length === 2, `got ${keys.length}`);
	if (keys.length < 2) {
		return finish();
	}
	const [primary] = keys;

	// A. Backward compatibility: a default key press cycles the stat on key
	// DOWN and never touches profiles.
	send({ event: "didReceiveSettings", action: "com.lawrensen.hwinfo.reading", context: OPENER, device: "dev1", payload: { settings: { readingKey: primary.key }, coordinates: { column: 2, row: 1 }, isInMultiAction: false } });
	await sleep(300);
	send({ event: "keyDown", action: "com.lawrensen.hwinfo.reading", context: OPENER, device: "dev1", payload: { settings: { readingKey: primary.key }, coordinates: { column: 2, row: 1 } } });
	await sleep(400);
	results.legacyCycle = setSettings.some((s) => s.context === OPENER && s.payload?.statMode === "min");
	results.legacySwitches = switches.length;
	send({ event: "keyUp", action: "com.lawrensen.hwinfo.reading", context: OPENER, device: "dev1", payload: { settings: { readingKey: primary.key }, coordinates: { column: 2, row: 1 } } });

	// B. Entry: open-details switches this device to its class profile.
	const openerSettings = { readingKey: primary.key, statMode: "current", pressBehavior: "open-details" };
	send({ event: "didReceiveSettings", action: "com.lawrensen.hwinfo.reading", context: OPENER, device: "dev1", payload: { settings: openerSettings, coordinates: { column: 2, row: 1 }, isInMultiAction: false } });
	await sleep(300);
	await keyPress(send, OPENER, "dev1", openerSettings);
	await sleep(500);
	results.enterSwitch = switches.at(-1);
	// The app now shows the (installed) profile: the opener leaves, the
	// baked cells of the real shipped archive appear.
	send({ event: "willDisappear", action: "com.lawrensen.hwinfo.reading", context: OPENER, device: "dev1", payload: { settings: openerSettings, coordinates: { column: 2, row: 1 }, controller: "Keypad", isInMultiAction: false } });
	installDetailSurface(send, "dev1", standardCells);
	await sleep(1600);
	results.backFace = latestSvg(backCtx);
	results.titleFace = latestSvg(titleCtx);
	results.slot0Face = latestSvg(slot0Ctx);
	results.slot1Face = latestSvg(slot1Ctx);
	results.slotWrites = setSettings.filter((s) => s.context.startsWith("slot-")).length;

	// C. A reading slot press cycles that slot's session stat.
	slotPress(send, "dev1", cellOfIndex(standardCells, 0).coord, cellOfIndex(standardCells, 0).settings);
	await sleep(900);
	results.slot0Min = latestSvg(slot0Ctx);

	// D. Layout growth: a third reading joins the source mid-view.
	fake.stdin.write("grow\n");
	await sleep(2500);
	results.titleAfterGrow = latestSvg(titleCtx);
	results.slot1AfterGrow = latestSvg(slot1Ctx);

	// E. Freeze and recovery: the surface degrades to the stale screen and
	// Back keeps its return mark through it, then live values come back.
	fake.stdin.write("freeze\n");
	await sleep(4200);
	results.backFrozen = latestSvg(backCtx);
	results.slotFrozen = latestSvg(slot0Ctx);
	// A replayed willAppear (reconnect/wake) while nothing changes on the
	// face: the fresh handle must still get a frame (its cache is cold).
	const slot0Cell = cellOfIndex(standardCells, 0);
	const framesBeforeReplay = images.filter((i) => i.context === slot0Ctx).length;
	const [rc, rr] = slot0Cell.coord.split(",").map(Number);
	send({
		event: "willAppear",
		action: slot0Cell.uuid,
		context: slot0Ctx,
		device: "dev1",
		payload: { settings: slot0Cell.settings, coordinates: { column: rc, row: rr }, controller: "Keypad", isInMultiAction: false }
	});
	await sleep(900);
	results.replayRepaint = images.filter((i) => i.context === slot0Ctx).length > framesBeforeReplay;
	fake.stdin.write("alive\n");
	await sleep(3200);
	results.backRecovered = latestSvg(backCtx);

	// F. Back: previous-profile restore with the name omitted. Through the
	// app's switch beat the just-left tiles paint PURE BLACK (the app
	// caches each key's last image per profile and replays it on the next
	// entry, so black here is what entry flashes); only the Back tile
	// keeps its face, so the way out never blinks away.
	const switchesBeforeBack = switches.length;
	slotPress(send, "dev1", cellOfRole(standardCells, "back").coord, cellOfRole(standardCells, "back").settings);
	await sleep(500);
	results.backSwitch = switches.length > switchesBeforeBack ? switches.at(-1) : undefined;
	results.leftSlotFace = latestSvg(slot0Ctx);
	results.leftTitleFace = latestSvg(titleCtx);
	results.leftBackFace = latestSvg(backCtx);
	removeDetailSurface(send, "dev1", standardCells);
	await sleep(400);

	// G. A stateless surface (the plugin-restart shape): honest idle tiles,
	// Back still gets you out. The pause clears Back's double-press
	// debounce from leg F, as a real restart-later press would.
	installDetailSurface(send, "dev1", standardCells);
	await sleep(1700);
	results.idleSlotFace = latestSvg(slot0Ctx);
	results.idleBackFace = latestSvg(backCtx);
	const switchesBeforeIdleBack = switches.length;
	slotPress(send, "dev1", cellOfRole(standardCells, "back").coord, cellOfRole(standardCells, "back").settings);
	await sleep(500);
	results.idleBackSwitch = switches.length > switchesBeforeIdleBack ? switches.at(-1) : undefined;
	removeDetailSurface(send, "dev1", standardCells);
	await sleep(300);

	// H. Honest refusals: an unsupported device (Pedal) and an unresolvable
	// primary both alert without switching.
	const switchesBeforeRefusals = switches.length;
	appearOpener(send, "ctx-ped", "devped", { readingKey: primary.key, pressBehavior: "open-details" }, { column: 0, row: 0 });
	await sleep(300);
	await keyPress(send, "ctx-ped", "devped", { readingKey: primary.key, pressBehavior: "open-details" });
	await sleep(400);
	results.pedAlerted = showAlerts.includes("ctx-ped");
	appearOpener(send, "ctx-gone", "dev1", { readingKey: "no-such:0:0", pressBehavior: "open-details" }, { column: 3, row: 1 });
	await sleep(300);
	await keyPress(send, "ctx-gone", "dev1", { readingKey: "no-such:0:0", pressBehavior: "open-details" });
	await sleep(400);
	results.goneAlerted = showAlerts.includes("ctx-gone");
	results.refusalSwitches = switches.length - switchesBeforeRefusals;

	// I. Tap/hold: a short tap cycles once; a hold enters once and its
	// release adds nothing.
	const tapholdSettings = { readingKey: primary.key, pressBehavior: "tap-cycle-hold-details" };
	appearOpener(send, "ctx-th", "dev1", tapholdSettings, { column: 4, row: 2 });
	await sleep(300);
	const writesBeforeTap = setSettings.filter((s) => s.context === "ctx-th").length;
	await keyPress(send, "ctx-th", "dev1", tapholdSettings, 120);
	await sleep(400);
	results.tapCycled = setSettings.filter((s) => s.context === "ctx-th").length === writesBeforeTap + 1;
	const switchesBeforeHold = switches.length;
	const writesBeforeHold = setSettings.filter((s) => s.context === "ctx-th").length;
	await keyPress(send, "ctx-th", "dev1", tapholdSettings, 850);
	await sleep(600);
	results.holdSwitched = switches.length === switchesBeforeHold + 1 ? switches.at(-1) : undefined;
	results.holdGhostWrites = setSettings.filter((s) => s.context === "ctx-th").length - writesBeforeHold;

	// J. Second device: the + XL enters its own bundle independently while
	// dev1 shows nothing; paging devxl repaints only devxl contexts.
	const xlCells = profileCells("profiles/detail-plus-xl");
	const xlOpener = { readingKey: primary.key, pressBehavior: "open-details" };
	appearOpener(send, "ctx-xl", "devxl", xlOpener, { column: 1, row: 1 });
	await sleep(300);
	await keyPress(send, "ctx-xl", "devxl", xlOpener);
	await sleep(500);
	results.xlSwitch = switches.at(-1);
	send({ event: "willDisappear", action: "com.lawrensen.hwinfo.reading", context: "ctx-xl", device: "devxl", payload: { settings: xlOpener, coordinates: { column: 1, row: 1 }, controller: "Keypad", isInMultiAction: false } });
	installDetailSurface(send, "devxl", xlCells);
	await sleep(1400);
	const xlTitleCtx = slotCtx("devxl", cellOfRole(xlCells, "title").coord);
	results.xlTitle = latestSvg(xlTitleCtx);
	const dev1FramesBeforeXlPaging = images.filter((i) => i.context.startsWith("slot-dev1-")).length;
	slotPress(send, "devxl", cellOfRole(xlCells, "next").coord, cellOfRole(xlCells, "next").settings);
	await sleep(700);
	results.dev1FramesDuringXl = images.filter((i) => i.context.startsWith("slot-dev1-")).length - dev1FramesBeforeXlPaging;
	slotPress(send, "devxl", cellOfRole(xlCells, "back").coord, cellOfRole(xlCells, "back").settings);
	await sleep(400);
	removeDetailSurface(send, "devxl", xlCells);

	// K. Virtual Stream Deck (type 11, 10x10): a guest of the + XL keypad
	// (the dial-bearing bundle hosts it with an empty dial bank).
	const vsdOpener = { readingKey: primary.key, pressBehavior: "open-details" };
	appearOpener(send, "ctx-vsd", "devvsd", vsdOpener, { column: 0, row: 0 });
	await sleep(300);
	await keyPress(send, "ctx-vsd", "devvsd", vsdOpener);
	await sleep(500);
	results.vsdSwitch = switches.at(-1);
	send({ event: "willDisappear", action: "com.lawrensen.hwinfo.reading", context: "ctx-vsd", device: "devvsd", payload: { settings: vsdOpener, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false } });
	await sleep(200);

	// L. Revision 2: the generated Back cell is a REAL Sensor Reading
	// action carrying only { detailRole: "back" }. The grammar shipped in r2
	// and is unchanged in r3; entry uses the ACTIVE revision's name,
	// the baked cell's willAppear routes into SensorReadingAction, and the
	// unconfigured tile renders the opener fallback with the return hook.
	const r2Cells = profileCells("profiles/detail-r3-standard");
	const r2Back = r2Cells.find((c) => c.uuid === "com.lawrensen.hwinfo.reading");
	const r2BackCtx = slotCtx("devr2", r2Back.coord);
	results.r2OpenerLabel = primary.label;
	const r2Opener = { readingKey: primary.key, pressBehavior: "open-details" };
	appearOpener(send, "ctx-r2", "devr2", r2Opener, { column: 2, row: 1 });
	await sleep(300);
	await keyPress(send, "ctx-r2", "devr2", r2Opener);
	await sleep(500);
	results.r2Switch = switches.at(-1);
	send({ event: "willDisappear", action: "com.lawrensen.hwinfo.reading", context: "ctx-r2", device: "devr2", payload: { settings: r2Opener, coordinates: { column: 2, row: 1 }, controller: "Keypad", isInMultiAction: false } });
	installDetailSurface(send, "devr2", r2Cells);
	await sleep(1600);
	results.r2BackFallback = latestSvg(r2BackCtx);

	// M. Configuring the Back through a real settings echo: it renders its
	// OWN dual face (divider hook) while the press stays pinned to Back.
	const r2BackConfigured = { detailRole: "back", readingKey: keys[1].key, keyLayout: "dual", secondaryReadingKey: primary.key };
	send({ event: "didReceiveSettings", action: "com.lawrensen.hwinfo.reading", context: r2BackCtx, device: "devr2", payload: { settings: r2BackConfigured, coordinates: { column: 0, row: 0 }, isInMultiAction: false } });
	await sleep(900);
	results.r2BackDual = latestSvg(r2BackCtx);

	// S. HWiNFO loss and recovery under the configured Back.
	fake.stdin.write("freeze\n");
	await sleep(4200);
	results.r2BackFrozen = latestSvg(r2BackCtx);
	fake.stdin.write("alive\n");
	await sleep(3200);
	results.r2BackRecovered = latestSvg(r2BackCtx);

	// N. The configured Back press: exactly one previous-profile restore,
	// no stat write, no detail entry, and the release adds nothing.
	const writesBeforeR2Back = setSettings.filter((s) => s.context === r2BackCtx).length;
	const switchesBeforeR2Back = switches.length;
	send({ event: "keyDown", action: "com.lawrensen.hwinfo.reading", context: r2BackCtx, device: "devr2", payload: { settings: r2BackConfigured, coordinates: { column: 0, row: 0 } } });
	send({ event: "keyUp", action: "com.lawrensen.hwinfo.reading", context: r2BackCtx, device: "devr2", payload: { settings: r2BackConfigured, coordinates: { column: 0, row: 0 } } });
	await sleep(500);
	results.r2BackSwitch = switches.length > switchesBeforeR2Back ? switches.at(-1) : undefined;
	results.r2BackWrites = setSettings.filter((s) => s.context === r2BackCtx).length - writesBeforeR2Back;
	removeDetailSurface(send, "devr2", r2Cells);
	await sleep(300);

	// P. A malformed marker ("Back", wrong case) must keep the ordinary
	// press behavior: the stat cycles and no profile switches.
	const malSettings = { detailRole: "Back", readingKey: primary.key };
	appearOpener(send, "ctx-mal", "devr2", malSettings, { column: 3, row: 2 });
	await sleep(300);
	const switchesBeforeMal = switches.length;
	const writesBeforeMal = setSettings.filter((s) => s.context === "ctx-mal").length;
	await keyPress(send, "ctx-mal", "devr2", malSettings);
	await sleep(400);
	results.malformedCycled = setSettings.filter((s) => s.context === "ctx-mal" && s.payload?.statMode === "min").length === writesBeforeMal + 1;
	results.malformedSwitches = switches.length - switchesBeforeMal;
	send({ event: "willDisappear", action: "com.lawrensen.hwinfo.reading", context: "ctx-mal", device: "devr2", payload: { settings: malSettings, coordinates: { column: 3, row: 2 }, controller: "Keypad", isInMultiAction: false } });
	await sleep(200);

	// O. A COPIED marked action on an ordinary page (not 0,0, no managed
	// surface) keeps the Back role: press restores the previous profile.
	// Placed on devxl so devr2's leave debounce cannot swallow the hop.
	const copySettings = { detailRole: "back", readingKey: primary.key };
	appearOpener(send, "ctx-copy", "devxl", copySettings, { column: 5, row: 2 });
	await sleep(300);
	const switchesBeforeCopy = switches.length;
	const writesBeforeCopy = setSettings.filter((s) => s.context === "ctx-copy").length;
	await keyPress(send, "ctx-copy", "devxl", copySettings);
	await sleep(400);
	results.copySwitch = switches.length > switchesBeforeCopy ? switches.at(-1) : undefined;
	results.copyWrites = setSettings.filter((s) => s.context === "ctx-copy").length - writesBeforeCopy;
	send({ event: "willDisappear", action: "com.lawrensen.hwinfo.reading", context: "ctx-copy", device: "devxl", payload: { settings: copySettings, coordinates: { column: 5, row: 2 }, controller: "Keypad", isInMultiAction: false } });
	await sleep(200);

	// Q. Restart-shaped: the r2 surface appears with NO session state. The
	// generated Back renders the idle face and still gets the user out.
	// The pause clears devr2's leave debounce from leg N first.
	await sleep(1400);
	installDetailSurface(send, "devr2", r2Cells);
	await sleep(1700);
	results.r2IdleBack = latestSvg(r2BackCtx);
	const switchesBeforeIdle = switches.length;
	send({ event: "keyDown", action: "com.lawrensen.hwinfo.reading", context: r2BackCtx, device: "devr2", payload: { settings: { detailRole: "back" }, coordinates: { column: 0, row: 0 } } });
	send({ event: "keyUp", action: "com.lawrensen.hwinfo.reading", context: r2BackCtx, device: "devr2", payload: { settings: { detailRole: "back" }, coordinates: { column: 0, row: 0 } } });
	await sleep(500);
	results.r2IdleBackSwitch = switches.length > switchesBeforeIdle ? switches.at(-1) : undefined;
	removeDetailSurface(send, "devr2", r2Cells);
	await sleep(300);

	// R. Two devices on revision 2: devr2 and dev1 hold independent
	// sessions; leaving devr2 keeps dev1's session and its fallback face,
	// then dev1's own Back leaves with dev1's device id.
	appearOpener(send, "ctx-r2b", "devr2", r2Opener, { column: 2, row: 1 });
	appearOpener(send, "ctx-r2c", "dev1", r2Opener, { column: 2, row: 1 });
	await sleep(1600); // devr2's leave debounce from leg Q, then enter both
	await keyPress(send, "ctx-r2b", "devr2", r2Opener);
	await keyPress(send, "ctx-r2c", "dev1", r2Opener);
	await sleep(500);
	send({ event: "willDisappear", action: "com.lawrensen.hwinfo.reading", context: "ctx-r2b", device: "devr2", payload: { settings: r2Opener, coordinates: { column: 2, row: 1 }, controller: "Keypad", isInMultiAction: false } });
	send({ event: "willDisappear", action: "com.lawrensen.hwinfo.reading", context: "ctx-r2c", device: "dev1", payload: { settings: r2Opener, coordinates: { column: 2, row: 1 }, controller: "Keypad", isInMultiAction: false } });
	installDetailSurface(send, "devr2", r2Cells);
	installDetailSurface(send, "dev1", r2Cells, "-r2");
	await sleep(1600);
	send({ event: "keyDown", action: "com.lawrensen.hwinfo.reading", context: r2BackCtx, device: "devr2", payload: { settings: { detailRole: "back" }, coordinates: { column: 0, row: 0 } } });
	send({ event: "keyUp", action: "com.lawrensen.hwinfo.reading", context: r2BackCtx, device: "devr2", payload: { settings: { detailRole: "back" }, coordinates: { column: 0, row: 0 } } });
	await sleep(600);
	removeDetailSurface(send, "devr2", r2Cells);
	await sleep(900);
	const dev1BackCtx = slotCtx("dev1", r2Back.coord, "-r2");
	results.r2Dev1FaceAfter = latestSvg(dev1BackCtx);
	const switchesBeforeDev1 = switches.length;
	send({ event: "keyDown", action: "com.lawrensen.hwinfo.reading", context: dev1BackCtx, device: "dev1", payload: { settings: { detailRole: "back" }, coordinates: { column: 0, row: 0 } } });
	send({ event: "keyUp", action: "com.lawrensen.hwinfo.reading", context: dev1BackCtx, device: "dev1", payload: { settings: { detailRole: "back" }, coordinates: { column: 0, row: 0 } } });
	await sleep(500);
	results.r2Dev1Switch = switches.length > switchesBeforeDev1 ? switches.at(-1) : undefined;
	removeDetailSurface(send, "dev1", r2Cells, "-r2");
	await sleep(300);
	// Ghost press for a context that never appeared: must be a silent no-op.
	send({ event: "keyDown", action: "com.lawrensen.hwinfo.reading", context: "ctx-ghost", device: "dev1", payload: { settings: { detailRole: "back" }, coordinates: { column: 4, row: 3 } } });
	send({ event: "keyUp", action: "com.lawrensen.hwinfo.reading", context: "ctx-ghost", device: "dev1", payload: { settings: { detailRole: "back" }, coordinates: { column: 4, row: 3 } } });
	await sleep(300);
	results.r2AllBackWrites = setSettings.filter((s) => s.context === r2BackCtx || s.context === dev1BackCtx).length;

	// T. Filter mode + the OPT-IN mirror Back, self-contained on its own
	// device: a glob-driven group opens, and with detailMirrorBack set the
	// reading slot on the OPENER'S OWN CELL renders the opener face with
	// the return mark, the readings flow around it (step shrinks, nothing
	// hides), and pressing that cell leaves exactly like the canonical
	// top-left Back.
	const fltCells = profileCells("profiles/detail-r3-standard");
	const fltOpener = { readingKey: primary.key, pressBehavior: "open-details", detailMode: "filter", detailFilter: "*", detailMirrorBack: true };
	appearOpener(send, "ctx-flt", "devflt", fltOpener, { column: 2, row: 1 });
	await sleep(300);
	await keyPress(send, "ctx-flt", "devflt", fltOpener);
	await sleep(500);
	results.fltSwitch = switches.at(-1);
	send({ event: "willDisappear", action: "com.lawrensen.hwinfo.reading", context: "ctx-flt", device: "devflt", payload: { settings: fltOpener, coordinates: { column: 2, row: 1 }, controller: "Keypad", isInMultiAction: false } });
	installDetailSurface(send, "devflt", fltCells);
	await sleep(1600);
	const fltMirrorCell = fltCells.find((c) => c.coord === "2,1");
	results.fltMirrorFace = latestSvg(slotCtx("devflt", "2,1"));
	results.fltTitleFace = latestSvg(slotCtx("devflt", cellOfRole(fltCells, "title").coord));
	results.fltSlot0Face = latestSvg(slotCtx("devflt", cellOfIndex(fltCells, 0).coord));
	const switchesBeforeMirror = switches.length;
	slotPress(send, "devflt", fltMirrorCell.coord, fltMirrorCell.settings);
	await sleep(500);
	results.fltMirrorSwitch = switches.length > switchesBeforeMirror ? switches.at(-1) : undefined;
	removeDetailSurface(send, "devflt", fltCells);
	await sleep(300);

	// U. The mirror is opt-in (issue #5 feedback): the same shape WITHOUT
	// detailMirrorBack keeps the opener's cell as an ordinary reading slot,
	// pressing it stays in the view, and the canonical top-left Back is
	// the one way out.
	const defOpener = { readingKey: primary.key, pressBehavior: "open-details", detailMode: "filter", detailFilter: "*" };
	appearOpener(send, "ctx-def", "devdef", defOpener, { column: 2, row: 1 });
	await sleep(300);
	await keyPress(send, "ctx-def", "devdef", defOpener);
	await sleep(500);
	send({ event: "willDisappear", action: "com.lawrensen.hwinfo.reading", context: "ctx-def", device: "devdef", payload: { settings: defOpener, coordinates: { column: 2, row: 1 }, controller: "Keypad", isInMultiAction: false } });
	installDetailSurface(send, "devdef", fltCells);
	await sleep(1600);
	results.defOpenerCellFace = latestSvg(slotCtx("devdef", "2,1"));
	results.defBackFace = latestSvg(slotCtx("devdef", fltCells.find((c) => c.settings.detailRole === "back").coord));
	const defOpenerCell = fltCells.find((c) => c.coord === "2,1");
	const switchesBeforeDef = switches.length;
	slotPress(send, "devdef", defOpenerCell.coord, defOpenerCell.settings);
	await sleep(400);
	results.defCellPressSwitched = switches.length > switchesBeforeDef;
	// The active-revision Back cell is a real Sensor Reading (detailRole),
	// not a hidden slot binding: press it as the reading action.
	const defBackCell = fltCells.find((c) => c.settings.detailRole === "back");
	const defBackCtx = slotCtx("devdef", defBackCell.coord);
	const [defBackCol, defBackRow] = defBackCell.coord.split(",").map(Number);
	send({ event: "keyDown", action: "com.lawrensen.hwinfo.reading", context: defBackCtx, device: "devdef", payload: { settings: defBackCell.settings, coordinates: { column: defBackCol, row: defBackRow } } });
	send({ event: "keyUp", action: "com.lawrensen.hwinfo.reading", context: defBackCtx, device: "devdef", payload: { settings: defBackCell.settings, coordinates: { column: defBackCol, row: defBackRow } } });
	await sleep(500);
	results.defBackSwitch = switches.at(-1);
	removeDetailSurface(send, "devdef", fltCells);
	await sleep(300);

	// Teardown: every action gone, the poller must idle, the process exit.
	for (const ctx of ["ctx-ped", "ctx-gone", "ctx-th"]) {
		const device = ctx === "ctx-ped" ? "devped" : "dev1";
		send({ event: "willDisappear", action: "com.lawrensen.hwinfo.reading", context: ctx, device, payload: { settings: {}, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false } });
	}
	await sleep(1200);
	const framesAtIdle = images.length;
	await sleep(2500);
	results.idleDelta = images.length - framesAtIdle;
	await finish();
}

async function finish() {
	if (finished) {
		return;
	}
	finished = true;

	check("legacy default press cycled to MIN via setSettings", results.legacyCycle === true);
	check("legacy press touched no profile", results.legacySwitches === 0);
	check("entry switched dev1 to the active-revision profile name", results.enterSwitch?.device === "dev1" && results.enterSwitch?.profile === "profiles/detail-r3-standard", JSON.stringify(results.enterSwitch));
	check("Back tile renders the opener's reading with the return mark", typeof results.backFace === "string" && results.backFace.includes("M33 119"), (results.backFace ?? "no frame").slice(0, 120));
	check("title tile shows the source range 1-1 / 1", typeof results.titleFace === "string" && results.titleFace.includes(">1-1 / 1<"), (results.titleFace ?? "no frame").slice(0, 160));
	check("reading slot 0 shows the source member live", typeof results.slot0Face === "string" && results.slot0Face.includes("<text"), (results.slot0Face ?? "no frame").slice(0, 120));
	check("slot 1 is an empty themed face (group has one member)", typeof results.slot1Face === "string" && !results.slot1Face.includes("<text"), (results.slot1Face ?? "no frame").slice(0, 100));
	check("detail slots never write settings", results.slotWrites === 0, `${results.slotWrites} writes`);
	check("slot press cycles its session stat to MIN", typeof results.slot0Min === "string" && results.slot0Min.includes(">MIN<"), (results.slot0Min ?? "no frame").slice(0, 120));
	check("layout growth re-resolves the source (range 1-2 / 2)", typeof results.titleAfterGrow === "string" && results.titleAfterGrow.includes(">1-2 / 2<"), (results.titleAfterGrow ?? "no frame").slice(0, 160));
	check("the grown reading fills slot 1", typeof results.slot1AfterGrow === "string" && results.slot1AfterGrow.includes("<text"), (results.slot1AfterGrow ?? "no frame").slice(0, 100));
	check("freeze degrades slots to the stale screen", typeof results.slotFrozen === "string" && results.slotFrozen.includes("Not updating"), (results.slotFrozen ?? "no frame").slice(0, 120));
	check("a replayed willAppear repaints the slot despite unchanged bytes", results.replayRepaint === true);
	check("Back keeps its return mark through the freeze", typeof results.backFrozen === "string" && results.backFrozen.includes("Not updating") && results.backFrozen.includes("M33 119"), (results.backFrozen ?? "no frame").slice(0, 140));
	check("recovery restores the live Back tile", typeof results.backRecovered === "string" && !results.backRecovered.includes("Not updating") && results.backRecovered.includes("M33 119"), (results.backRecovered ?? "no frame").slice(0, 120));
	check("Back emitted a previous-profile restore (no profile name)", results.backSwitch !== undefined && results.backSwitch.device === "dev1" && results.backSwitch.profile === undefined, JSON.stringify(results.backSwitch));
	check("a stateless surface shows the idle tiles", typeof results.idleSlotFace === "string" && results.idleSlotFace.includes("No detail"), (results.idleSlotFace ?? "no frame").slice(0, 120));
	check("the stateless Back tile stays a Back affordance", typeof results.idleBackFace === "string" && results.idleBackFace.includes(">Back<"), (results.idleBackFace ?? "no frame").slice(0, 120));
	check("stateless Back still restores the previous profile", results.idleBackSwitch !== undefined && results.idleBackSwitch.profile === undefined, JSON.stringify(results.idleBackSwitch));
	check("unsupported device alerts without switching", results.pedAlerted === true && results.refusalSwitches === 0);
	check("an unresolvable primary alerts without switching", results.goneAlerted === true);
	check("tap cycles exactly once", results.tapCycled === true);
	check("hold enters details exactly once", results.holdSwitched !== undefined && results.holdSwitched.profile === "profiles/detail-r3-standard", JSON.stringify(results.holdSwitched));
	check("the release after a hold writes nothing (no ghost cycle)", results.holdGhostWrites === 0, `${results.holdGhostWrites} writes`);
	check("the + XL entered its own bundle", results.xlSwitch?.device === "devxl" && results.xlSwitch?.profile === "profiles/detail-r3-plus-xl", JSON.stringify(results.xlSwitch));
	check("the + XL title tile rendered", typeof results.xlTitle === "string" && results.xlTitle.includes("<text"));
	check("paging devxl repainted no dev1 slot", results.dev1FramesDuringXl === 0, `${results.dev1FramesDuringXl} frames`);
	check("a 10x10 Virtual Stream Deck enters as a guest of the + XL keypad", results.vsdSwitch?.device === "devvsd" && results.vsdSwitch?.profile === "profiles/detail-r3-plus-xl", JSON.stringify(results.vsdSwitch));

	// Revision-2 configurable Back (the generated Sensor Reading cell)
	check("r2 entry switched devr2 to the active-revision profile name", results.r2Switch?.device === "devr2" && results.r2Switch?.profile === "profiles/detail-r3-standard", JSON.stringify(results.r2Switch));
	check("the generated Back cell reached SensorReadingAction and rendered the opener fallback", typeof results.r2BackFallback === "string" && results.r2BackFallback.includes("M33 119") && results.r2BackFallback.includes(results.r2OpenerLabel), (results.r2BackFallback ?? "no frame").slice(0, 160));
	check("a configured Back renders its own dual face with the divider hook", typeof results.r2BackDual === "string" && results.r2BackDual.includes("M33 66"), (results.r2BackDual ?? "no frame").slice(0, 160));
	check("HWiNFO loss keeps the configured Back on the status screen with the hook", typeof results.r2BackFrozen === "string" && results.r2BackFrozen.includes("Not updating") && results.r2BackFrozen.includes("M33 119"), (results.r2BackFrozen ?? "no frame").slice(0, 160));
	check("recovery restores the configured Back face", typeof results.r2BackRecovered === "string" && results.r2BackRecovered.includes("M33 66") && !results.r2BackRecovered.includes("Not updating"), (results.r2BackRecovered ?? "no frame").slice(0, 160));
	check("pressing the configured Back restored the previous profile (name omitted)", results.r2BackSwitch !== undefined && results.r2BackSwitch.device === "devr2" && results.r2BackSwitch.profile === undefined, JSON.stringify(results.r2BackSwitch));
	check("the Back press wrote no settings and cycled no stat", results.r2BackWrites === 0, `${results.r2BackWrites} writes`);
	check("a malformed marker keeps ordinary behavior (stat cycled, no switch)", results.malformedCycled === true && results.malformedSwitches === 0, `cycled=${results.malformedCycled} switches=${results.malformedSwitches}`);
	check("a copied marked action still acts as Back on an ordinary page", results.copySwitch !== undefined && results.copySwitch.profile === undefined && results.copyWrites === 0, JSON.stringify({ sw: results.copySwitch, writes: results.copyWrites }));
	check("a restart-shaped r2 surface shows the idle Back face", typeof results.r2IdleBack === "string" && results.r2IdleBack.includes(">Back<"), (results.r2IdleBack ?? "no frame").slice(0, 120));
	check("the stateless r2 Back still restores the previous profile", results.r2IdleBackSwitch !== undefined && results.r2IdleBackSwitch.profile === undefined, JSON.stringify(results.r2IdleBackSwitch));
	check("two devices: leaving devr2 kept dev1's session and fallback face", typeof results.r2Dev1FaceAfter === "string" && results.r2Dev1FaceAfter.includes("M33 119") && !results.r2Dev1FaceAfter.includes(">Back<"), (results.r2Dev1FaceAfter ?? "no frame").slice(0, 140));
	check("two devices: dev1's own Back then left with its device id", results.r2Dev1Switch !== undefined && results.r2Dev1Switch.device === "dev1" && results.r2Dev1Switch.profile === undefined, JSON.stringify(results.r2Dev1Switch));
	check("no r2 Back context ever received a setSettings write", results.r2AllBackWrites === 0, `${results.r2AllBackWrites} writes`);

	check("a just-left surface goes black through the switch beat (no idle wall)", typeof results.leftSlotFace === "string" && !results.leftSlotFace.includes("<text") && results.leftSlotFace.includes("#000000") && typeof results.leftTitleFace === "string" && !results.leftTitleFace.includes("<text"), (results.leftSlotFace ?? "no frame").slice(0, 120));
	check("the way out keeps its face while leaving", typeof results.leftBackFace === "string" && results.leftBackFace.includes(">Back<"), (results.leftBackFace ?? "no frame").slice(0, 120));
	check("filter entry switched devflt to the active-revision profile", results.fltSwitch?.device === "devflt" && results.fltSwitch?.profile === "profiles/detail-r3-standard", JSON.stringify(results.fltSwitch));
	check("the mirror Back rides the opener's own cell with the return mark", typeof results.fltMirrorFace === "string" && results.fltMirrorFace.includes("M33 119"), (results.fltMirrorFace ?? "no frame").slice(0, 140));
	check("filter title shows the glob range 1-2 / 2", typeof results.fltTitleFace === "string" && results.fltTitleFace.includes(">1-2 / 2<"), (results.fltTitleFace ?? "no frame").slice(0, 160));
	check("readings flow around the mirror (slot 0 stays live)", typeof results.fltSlot0Face === "string" && results.fltSlot0Face.includes("<text"), (results.fltSlot0Face ?? "no frame").slice(0, 100));
	check("pressing the mirror cell left the view (restore, name omitted)", results.fltMirrorSwitch !== undefined && results.fltMirrorSwitch.device === "devflt" && results.fltMirrorSwitch.profile === undefined, JSON.stringify(results.fltMirrorSwitch));
	check("without the opt-in, the opener's cell carries no return mark", typeof results.defOpenerCellFace === "string" && !results.defOpenerCellFace.includes("M33 119"), (results.defOpenerCellFace ?? "no frame").slice(0, 140));
	check("the canonical Back on that live surface still wears the mark", typeof results.defBackFace === "string" && results.defBackFace.includes("M33 119"), (results.defBackFace ?? "no frame").slice(0, 140));
	check("without the opt-in, pressing that cell stays in the view", results.defCellPressSwitched === false, JSON.stringify(results.defCellPressSwitched));
	check("the canonical Back still leaves (restore, name omitted)", results.defBackSwitch !== undefined && results.defBackSwitch.device === "devdef" && results.defBackSwitch.profile === undefined, JSON.stringify(results.defBackSwitch));
	check("poller idles once every action is gone", results.idleDelta === 0, `${results.idleDelta} frames in 2.5 s`);

	const shutdown = await new Promise((resolve) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				plugin.kill();
				resolve({ clean: false, detail: "still alive 5 s after socket close — killed" });
			}
		}, 5000);
		plugin.once("exit", (code) => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				resolve({ clean: true, detail: `self-exited (code ${code})` });
			}
		});
		for (const client of wss.clients) {
			client.close();
		}
		wss.close();
	});
	check("plugin exits when the app socket closes", shutdown.clean, shutdown.detail);

	if (fake !== null && fake.exitCode === null) {
		fake.stdin.write("exit\n");
		await Promise.race([new Promise((r) => fake.once("exit", r)), sleep(3000).then(() => fake.kill())]);
	}
	console.log(results.errors.length === 0 ? "\nE2E DRILLDOWN: ALL CHECKS PASSED" : `\nE2E DRILLDOWN: ${results.errors.length} FAILURES`);
	process.exit(results.errors.length === 0 ? 0 : 1);
}

// --- boot ----------------------------------------------------------------
const info = {
	application: { font: "Segoe UI", language: "en", platform: "windows", platformVersion: "10.0.19044", version: "7.4.2.22730" },
	colors: {},
	devicePixelRatio: 1,
	devices: [
		{ id: "dev1", name: "Harness Deck", size: { columns: 5, rows: 3 }, type: 0 },
		{ id: "devr2", name: "Harness Deck B", size: { columns: 5, rows: 3 }, type: 0 },
		{ id: "devflt", name: "Harness Deck C", size: { columns: 5, rows: 3 }, type: 0 },
		{ id: "devdef", name: "Harness Deck D", size: { columns: 5, rows: 3 }, type: 0 },
		{ id: "devxl", name: "Harness + XL", size: { columns: 9, rows: 4 }, type: 13 },
		{ id: "devped", name: "Harness Pedal", size: { columns: 3, rows: 1 }, type: 5 },
		{ id: "devvsd", name: "Harness Virtual", size: { columns: 10, rows: 10 }, type: 11 }
	],
	plugin: { uuid: "com.lawrensen.hwinfo", version: "1.0.0.0" }
};

fake = spawn(process.execPath, [path.join(repoRoot, "scripts", "fake-hwinfo.mjs")], {
	stdio: ["pipe", "pipe", "inherit"],
	env: { ...process.env, HWINFO_SM2_NAME: MAPPING_NAME, HWINFO_SM2_MUTEX_NAME: MUTEX_NAME }
});
const fakeReady = new Promise((resolve, reject) => {
	let buffer = "";
	fake.stdout.on("data", (chunk) => {
		buffer += chunk.toString();
		if (buffer.includes("READY")) {
			resolve();
		}
	});
	fake.once("exit", () => reject(new Error("fake-hwinfo died before READY")));
});
await fakeReady;

const plugin = spawn(process.execPath, ["bin/plugin.js", "-port", String(PORT), "-pluginUUID", "e2e-drilldown", "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)], {
	cwd: pluginDir,
	stdio: ["ignore", "inherit", "inherit"],
	env: {
		...process.env,
		HWINFO_LOG_LEVEL: "debug",
		HWINFO_SM2_NAME: MAPPING_NAME,
		HWINFO_SM2_MUTEX_NAME: MUTEX_NAME,
		HWINFO_STALE_AFTER_MS: "2500",
		HWINFO_REOPEN_PROBE_MS: "1000"
	}
});
plugin.on("exit", (code) => {
	if (!finished) {
		console.error(`plugin exited early with code ${code}`);
		process.exit(1);
	}
});

setTimeout(() => {
	if (!finished) {
		console.error("E2E DRILLDOWN: timeout — scenario never completed");
		plugin.kill();
		if (fake !== null) {
			fake.kill();
		}
		process.exit(1);
	}
}, 120000);
