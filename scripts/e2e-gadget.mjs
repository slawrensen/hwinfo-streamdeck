// Gadget-registry backend e2e: shared memory is pointed at a nonexistent
// mapping so the plugin's "auto" source must fall back to the Gadget
// registry, which this script populates under a synthetic HKCU key.
//
// The fixture is deliberately SPARSE. HWiNFO reserves a VSB index for every
// reading ticked "Report value in Gadget" but only writes the entry while
// that reading is also enabled, so the numbering carries permanent holes
// (issue #21). Indexes 1 and 3..5 are holes here, and the reading at 6 is
// the one a reader that stopped at the first hole would never see.
//
//   registry populated  → live "Test Temp" value via gadget + gadget hint
//   reading past a hole → key and dial both render "After Gap"
//   value updated       → frame shows the new value, either side of the hole
//   PI sensor tree      → both groups, all three readings
//   dynamic details     → a filter view lists both readings across the holes,
//                         counts them, updates past the hole, and Back leaves
//   values frozen       → "Not updating" (digest-based staleness)
//   updates resume      → live again
//   key deleted         → "Start HWiNFO"
//   key exists, empty   → "Tick sensors" (gadget-empty, NOT "start HWiNFO")
//   only a hole at 0    → still serves the readings, NOT "Tick sensors"
//
// Run with `npm run e2e:gadget` (after `npm run build`).
import { execSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { buildInfo, decodeSvg, latestSvg as latestSvgIn, makeCheck, makeExpectFrame, pluginArgv, regDeleteKey as regDeleteKeyAt, regSet as regSetAt, sleep, waitUntil } from "./lib/e2e-common.mjs";
import { profileCells } from "./lib/profile-cells.mjs";

const PORT = 28997;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");

const VSB_SUBKEY = `Software\\HwinfoE2E_VSB_${process.pid}`;
const REG_PATH = `HKCU\\${VSB_SUBKEY}`;
const READING_KEY = "g:Test Source:Test Temp";
/** The reading at VSB index 6, behind the hole at index 1. */
const GAP_READING_KEY = "g:Gap Source:After Gap";

const frames = [];
const gapFrames = [];
const dialFrames = [];
const piPayloads = [];
/** setImage frames of the detail surface: { context, svg }. */
const slotImages = [];
/** switchToProfile calls: { device, profile, page }. */
const switches = [];
let failures = 0;

const check = makeCheck(() => {
	failures += 1;
});
const expectFrame = makeExpectFrame(frames, check);
const expectGapFrame = makeExpectFrame(gapFrames, check);
const expectDialFrame = makeExpectFrame(dialFrames, check);
const regSet = (name, value) => regSetAt(REG_PATH, name, value);
const regDeleteKey = () => regDeleteKeyAt(REG_PATH);

/** The entries that never change: two readings on one sensor either side of
 * the hole at index 1, and a third sensor at index 6 behind holes 3..5. */
function publishSkeleton() {
	regSet("Sensor0", "Test Source");
	regSet("Label0", "Test Temp");
	regSet("Sensor2", "Test Source");
	regSet("Label2", "Test Fan");
	regSet("Value2", "1200 RPM");
	regSet("ValueRaw2", "1200");
	publishGapSkeleton();
	publishGap(61.5);
}

function publishGapSkeleton() {
	regSet("Sensor6", "Gap Source");
	regSet("Label6", "After Gap");
}

function publishGap(temp) {
	regSet("Value6", `${temp} °C`);
	regSet("ValueRaw6", String(temp));
}

/** Only the two values the freshness digest needs to see move; a full
 * republish would take longer than the update interval. */
function publish(temp) {
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
				context: "ctx-gadget",
				device: "dev1",
				payload: { settings: { readingKey: READING_KEY }, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false }
			});
			// A second key and a dial bound to the reading BEHIND the hole:
			// both runtime render paths have to reach it, not just the picker.
			send({
				event: "willAppear",
				action: "com.lawrensen.hwinfo.reading",
				context: "ctx-gap",
				device: "dev1",
				payload: { settings: { readingKey: GAP_READING_KEY }, coordinates: { column: 1, row: 0 }, controller: "Keypad", isInMultiAction: false }
			});
			send({
				event: "willAppear",
				action: "com.lawrensen.hwinfo.dial",
				context: "ctx-gap-dial",
				device: "devplus",
				payload: { settings: { readingKey: GAP_READING_KEY }, coordinates: { column: 0, row: 0 }, controller: "Encoder", isInMultiAction: false }
			});
			send({ event: "propertyInspectorDidAppear", action: "com.lawrensen.hwinfo.reading", context: "ctx-gadget", device: "dev1" });
			send({ event: "sendToPlugin", action: "com.lawrensen.hwinfo.reading", context: "ctx-gadget", payload: { event: "getSensorTree" } });
		} else if (msg.event === "getGlobalSettings") {
			send({ event: "didReceiveGlobalSettings", payload: { settings: {} } });
		} else if (msg.event === "setImage" && (msg.context === "ctx-gadget" || msg.context === "ctx-gap")) {
			const svg = decodeSvg(msg.payload?.image);
			if (svg !== null) {
				(msg.context === "ctx-gadget" ? frames : gapFrames).push(svg);
			}
		} else if (msg.event === "setImage" && typeof msg.context === "string" && msg.context.startsWith("slot-")) {
			if (typeof msg.payload?.image === "string") {
				slotImages.push({ context: msg.context, svg: msg.payload.image });
			}
		} else if (msg.event === "switchToProfile") {
			switches.push({ device: msg.device, profile: msg.payload?.profile, page: msg.payload?.page });
		} else if (msg.event === "setFeedback" && msg.context === "ctx-gap-dial") {
			const svg = decodeSvg(msg.payload?.canvas);
			if (svg !== null) {
				dialFrames.push(svg);
			}
		} else if (msg.event === "sendToPropertyInspector") {
			piPayloads.push(msg.payload);
		}
	});
});
const send = (obj) => pluginWs?.send(JSON.stringify(obj));

// Registry primed BEFORE the plugin starts.
publishSkeleton();
publish(47.5);

const plugin = spawn(
	process.execPath,
	pluginArgv(
		PORT,
		"e2e-gadget",
		buildInfo({
			devices: [
				{ id: "dev1", name: "Harness Deck", size: { columns: 5, rows: 3 }, type: 0 },
				// A Stream Deck + (type 7) so the dial leg has an encoder to land on.
				{ id: "devplus", name: "Harness Plus", size: { columns: 4, rows: 2 }, type: 7 },
				// A second 15-key deck for the detail-view leg, so its profile
				// switch and surface never touch dev1's keys.
				{ id: "devdet", name: "Harness Detail Deck", size: { columns: 5, rows: 3 }, type: 0 }
			]
		})
	),
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

	// 2. The reading at index 6, behind the hole at index 1, reaches both
	// runtime render paths. A reader that stopped at the first missing
	// SensorN would show "Sensor missing" on both instead (issue #21).
	await expectGapFrame("key renders the reading past the hole", (svg) => svg.includes("After Gap") && svg.includes("61.5"), 8000, { fromStart: true });
	await expectDialFrame("dial renders the reading past the hole", (svg) => svg.includes("After Gap") && svg.includes("61.5"), 8000, { fromStart: true });

	// 3. Values change → frame updates. Keep updating so the digest stays fresh.
	const updater = setInterval(() => publish((48.9 + Math.random() * 0.05).toFixed(2)), 700);
	await expectFrame("value update propagates", (svg) => svg.includes("48.9"), 8000);

	// 4. An update BEHIND the hole propagates too: the digest has to cover
	// entries the old scan never reached. Values carry one decimal so the
	// key face renders them exactly (auto precision rounds at this
	// magnitude), which keeps the assertion a substring match.
	publishGap(72.5);
	await expectGapFrame("value update past the hole propagates", (svg) => svg.includes("72.5"), 8000);

	// 5. PI: sensor tree groups + gadget hint. Both groups and all three
	// readings must be offered, not just the one before the hole.
	await sleep(500);
	const tree = piPayloads.find((p) => p?.event === "sensorTree" && p.groups?.length > 0);
	const anyGadget = piPayloads.find((p) => p?.source === "gadget");
	const treeReadings = (tree?.groups ?? []).flatMap((g) => g.readings ?? []);
	check("PI sensorTree has the gadget group", tree !== undefined && tree.groups[0]?.name === "Test Source" && tree.groups[0]?.readings?.length === 2, JSON.stringify(tree?.groups ?? []).slice(0, 120));
	check("PI sensorTree offers every reading across the holes", tree?.groups?.length === 2 && treeReadings.length === 3 && treeReadings.some((r) => r.key === GAP_READING_KEY), `${tree?.groups?.length ?? 0} groups, ${treeReadings.length} readings`);
	check("PI payloads report source=gadget with hint", anyGadget !== undefined && piPayloads.some((p) => typeof p?.hint === "string" && p.hint.includes("Gadget")), anyGadget?.hint?.slice(0, 80) ?? "");

	// 6. Inside the dynamic details (issue #21 meets issue #5): an opener on
	// its own deck opens a filter view over everything this Gadget key
	// publishes. The readings either side of the holes (Test Fan at index
	// 2, After Gap at index 6) must both land on the page in order, the
	// title must count them, an update behind the hole must move its tile,
	// and Back must still leave. The opener sits on the profile's own Back
	// cell, so no mirror slot is reserved and the tile indexes stay literal.
	const detCells = profileCells(pluginDir, "profiles/detail-r3-standard");
	const detOpener = { readingKey: READING_KEY, pressBehavior: "open-details", detailMode: "filter", detailFilter: "*" };
	const openerAt = { column: 0, row: 0 };
	const slotCtx = (coord) => `slot-devdet-${coord.replace(",", "x")}`;
	const detCell = (predicate) => detCells.find(predicate);
	const titleCtx = slotCtx(detCell((c) => c.settings.slot === "title").coord);
	const backCell = detCell((c) => c.settings.detailRole === "back");
	const backCtx = slotCtx(backCell.coord);
	const tileCtx = (index) => slotCtx(detCell((c) => c.settings.slot === "reading" && c.settings.index === index).coord);
	const face = (context) => latestSvgIn(slotImages, context);
	const short = (context) => (face(context) ?? "no frame").slice(0, 160);
	send({ event: "willAppear", action: "com.lawrensen.hwinfo.reading", context: "ctx-opener", device: "devdet", payload: { settings: detOpener, coordinates: openerAt, controller: "Keypad", isInMultiAction: false } });
	await sleep(400);
	const switchesBeforeEnter = switches.length;
	send({ event: "keyDown", action: "com.lawrensen.hwinfo.reading", context: "ctx-opener", device: "devdet", payload: { settings: detOpener, coordinates: openerAt } });
	send({ event: "keyUp", action: "com.lawrensen.hwinfo.reading", context: "ctx-opener", device: "devdet", payload: { settings: detOpener, coordinates: openerAt } });
	await waitUntil(() => switches.length > switchesBeforeEnter, 1500);
	const entered = switches.at(-1);
	check("open-details on a Gadget reading switches to the detail profile", switches.length > switchesBeforeEnter && entered?.device === "devdet" && entered?.profile === "profiles/detail-r3-standard", JSON.stringify(entered ?? null));
	// The app now shows the installed profile: the opener leaves, the baked
	// cells of the real shipped archive appear under their own action UUIDs.
	send({ event: "willDisappear", action: "com.lawrensen.hwinfo.reading", context: "ctx-opener", device: "devdet", payload: { settings: detOpener, coordinates: openerAt, controller: "Keypad", isInMultiAction: false } });
	const surface = (event) => {
		for (const cell of detCells) {
			const [column, row] = cell.coord.split(",").map(Number);
			send({ event, action: cell.uuid, context: slotCtx(cell.coord), device: "devdet", payload: { settings: cell.settings, coordinates: { column, row }, controller: "Keypad", isInMultiAction: false } });
		}
	};
	surface("willAppear");
	await waitUntil(() => (face(tileCtx(1)) ?? "").includes("After Gap"), 8000);
	check("detail tile 1 lists the reading before the hole", (face(tileCtx(0)) ?? "").includes("Test Fan"), short(tileCtx(0)));
	check("detail tile 2 lists the reading behind the holes", (face(tileCtx(1)) ?? "").includes("After Gap"), short(tileCtx(1)));
	check("detail tile 3 stays empty: the list ends at two readings", face(tileCtx(2)) !== undefined && !face(tileCtx(2)).includes("<text"), short(tileCtx(2)));
	check("the detail title counts both readings across the holes", (face(titleCtx) ?? "").includes(">1-2 / 2<"), short(titleCtx));
	check("the Back tile carries the opener's own Gadget reading", (face(backCtx) ?? "").includes("Test Temp"), short(backCtx));
	publishGap(90.5);
	await waitUntil(() => (face(tileCtx(1)) ?? "").includes("90.5"), 8000);
	check("a value update behind the hole reaches its detail tile", (face(tileCtx(1)) ?? "").includes("90.5"), short(tileCtx(1)));
	const switchesBeforeBack = switches.length;
	const [backColumn, backRow] = backCell.coord.split(",").map(Number);
	send({ event: "keyDown", action: backCell.uuid, context: backCtx, device: "devdet", payload: { settings: backCell.settings, coordinates: { column: backColumn, row: backRow } } });
	send({ event: "keyUp", action: backCell.uuid, context: backCtx, device: "devdet", payload: { settings: backCell.settings, coordinates: { column: backColumn, row: backRow } } });
	await waitUntil(() => switches.length > switchesBeforeBack, 1500);
	check("Back restores the previous profile from a Gadget-fed view", switches.length > switchesBeforeBack && switches.at(-1)?.device === "devdet" && switches.at(-1)?.profile === undefined, JSON.stringify(switches.at(-1) ?? null));
	surface("willDisappear");
	await sleep(300);

	// 7. Freeze (HWiNFO exits — key remains, values stop changing) → stale.
	clearInterval(updater);
	await expectFrame("frozen registry → 'Not updating'", (svg) => svg.includes("Not updating"), 12000);

	// 8. Resume → live again.
	const updater2 = setInterval(() => publish((51.1 + Math.random() * 0.05).toFixed(2)), 700);
	await expectFrame("resumed updates → live again", (svg) => svg.includes("51.1"), 10000);
	clearInterval(updater2);

	// 9. Key deleted → unavailable.
	regDeleteKey();
	await expectFrame("key deleted → 'Start HWiNFO'", (svg) => svg.includes("Start HWiNFO"), 10000);

	// 10. Key present but EMPTY (gadget enabled, nothing ticked) — must NOT be
	// diagnosed as "start HWiNFO"; the user needs to tick sensors instead.
	execSync(`reg add "${REG_PATH}" /f`, { stdio: "ignore" });
	await expectFrame("empty key → 'Tick sensors' (gadget-empty)", (svg) => svg.includes("Tick sensors"), 10000);

	// 11. The hole at index 0 itself: the user disabled the reading holding
	// VSBidx 0. The key still holds every other reading, so this is NOT an
	// empty gadget key and must not be diagnosed as one.
	regSet("Sensor2", "Test Source");
	regSet("Label2", "Test Fan");
	regSet("Value2", "1200 RPM");
	regSet("ValueRaw2", "1200");
	publishGapSkeleton();
	// The raw value keeps moving so the digest stays fresh, while the face
	// renders a stable 83.5 at this magnitude.
	const updater3 = setInterval(() => publishGap((83.5 + Math.random() * 0.04).toFixed(2)), 700);
	await expectGapFrame("leading hole still serves its readings", (svg) => svg.includes("After Gap") && svg.includes("83.5"), 12000);
	clearInterval(updater3);
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
