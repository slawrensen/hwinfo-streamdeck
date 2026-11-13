// Strip Display end-to-end: impersonates the Stream Deck app with a Stream
// Deck + XL (type 13, six dials) and a Stream Deck + (type 7, four dials),
// backs the BUILT plugin with fake-hwinfo, and drives the strip through the
// panel messages the Sensor Dial panel sends: a whole strip on the + XL and
// an equal split on the +, per-slice setFeedback payloads (count, bounds,
// size) stitched with sharp and compared against the plugin's own
// full-width reference frame, a refused stale edit, a member leaving the
// page (the incomplete face) and coming back, a page swap with no late
// paint, taps on both sides of the split's seam, HWiNFO Control strip
// commands, large values beside the graph and alone with Scale and grid
// on, a Group pane over the strip reading's folder (one unit
// drawn, the rest counted, a turn picking the reading, a pressed turn the
// window), Strip Screens (two and three screens, the Screens dial's wipe,
// Control next, previous and first, the automatic cycle and its hold while
// a member's panel is open), a dial leaving its strip, and the exact
// settings writes. Then the owner's page of 2026-10-26 on two more decks:
// a strip and dials keeping their own Clear, Nebula or Stars, the shared
// Background set to Nebula (Default follows, own choices keep theirs and
// the count says so), "Use it everywhere" (one write per action, one strip
// edit), an action that appears later reset on appear, a choice made after
// the reset kept, and a new strip on the shared Background. It
// records per-context and aggregate setFeedback rates and slice payload
// sizes. Run with `npm run e2e:strip` (after `npm run build`).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { WebSocketServer } from "ws";
import { buildInfo, decodeSvg, makeCheck, pluginArgv, sleep, waitUntil } from "./lib/e2e-common.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");
const MAPPING_NAME = `Local\\HwinfoE2E_SM2_${process.pid}`;
const MUTEX_NAME = `${MAPPING_NAME}_MUTEX`;
const DIAL = "com.lawrensen.hwinfo.dial";
const CONTROL = "com.lawrensen.hwinfo.control";
const XL = "devXL";
const PLUS = "devPlus";

const results = { errors: [] };
const check = makeCheck((name) => results.errors.push(name));

// --- traffic capture ---------------------------------------------------------
const feedback = []; // { context, at, uri, svg }
const writes = []; // { context, settings }
const hints = []; // { context, descriptions }
const panel = []; // { context, payload }
const images = []; // { context, image }
const alerts = []; // context
/** What the app holds for each context: the last document written. */
const stored = new Map();
/** The shared settings the app answers with (the owner's page sets them). */
let globalsDoc = {};

let fake = null;
let plugin = null;
let finished = false;
const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await new Promise((resolve) => wss.once("listening", resolve));
const PORT = wss.address().port;

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
				send({ event: "didReceiveGlobalSettings", payload: { settings: globalsDoc } });
				break;
			case "setFeedback": {
				const uri = msg.payload?.canvas ?? "";
				feedback.push({ context: msg.context, at: Date.now(), uri, svg: decodeSvg(uri) });
				break;
			}
			case "setSettings":
				writes.push({ context: msg.context, settings: msg.payload });
				stored.set(msg.context, msg.payload);
				break;
			case "setTriggerDescription":
				hints.push({ context: msg.context, descriptions: msg.payload });
				break;
			case "sendToPropertyInspector":
				panel.push({ context: msg.context, payload: msg.payload });
				break;
			case "setImage":
				images.push({ context: msg.context, image: msg.payload?.image });
				break;
			case "showAlert":
				alerts.push(msg.context);
				break;
			default:
				break;
		}
	});
});

/** Everything fake-hwinfo printed, for its command answers. */
let fakeOut = "";
/** A fake-hwinfo stdin command; resolves when it prints `answer`. */
async function fakeCommand(command, answer) {
	const from = fakeOut.length;
	fake.stdin.write(`${command}\n`);
	await waitUntil(() => fakeOut.slice(from).includes(answer), 2000);
}

// --- the app side --------------------------------------------------------------
const dialCtx = (device, column) => `${device === XL ? "x" : "p"}${column}`;
// The owner's page (L) names its own devices.
const deviceOf = (context) => where.get(context)?.device ?? (context.startsWith("x") ? XL : PLUS);
const columnOfCtx = (context) => Number(context.slice(1));

function appearDial(send, context, settings) {
	stored.set(context, settings);
	send({ event: "willAppear", action: DIAL, context, device: deviceOf(context), payload: { settings, coordinates: { column: columnOfCtx(context), row: 0 }, controller: "Encoder", isInMultiAction: false } });
}

function disappearDial(send, context) {
	send({ event: "willDisappear", action: DIAL, context, device: deviceOf(context), payload: { settings: stored.get(context) ?? {}, coordinates: { column: columnOfCtx(context), row: 0 }, controller: "Encoder", isInMultiAction: false } });
}

function encoder(send, kind, context, extra = {}) {
	send({ event: kind, action: DIAL, context, device: deviceOf(context), payload: { settings: stored.get(context) ?? {}, coordinates: { column: columnOfCtx(context), row: 0 }, controller: "Encoder", ...extra } });
}

/** The panel the app shows, as the SDK counts it: each appear of the same
 * action stacks, and only as many disappears close it. */
const pi = { context: null, count: 0 };
function panelAppears(send, context) {
	if (pi.context === context) pi.count++;
	else Object.assign(pi, { context, count: 1 });
	send({ event: "propertyInspectorDidAppear", action: DIAL, context, device: deviceOf(context) });
}

/** A panel request from the Sensor Dial panel of `context`; resolves with
 * the plugin's answer for it. */
async function ask(send, context, payload, timeoutMs = 1500) {
	panelAppears(send, context);
	const from = panel.length;
	send({ event: "sendToPlugin", action: DIAL, context, payload });
	const want = payload.event === "stripGet" ? "stripState" : "stripEditResult";
	const match = (p) => p.payload?.event === want && p.payload.context === context && (want === "stripState" ? p.payload.requestId === payload.requestId : p.payload.opId === payload.opId);
	await waitUntil(() => panel.slice(from).some(match), timeoutMs);
	return panel.slice(from).find(match)?.payload;
}

const lastSvg = (context) => feedback.filter((f) => f.context === context).at(-1)?.svg;
const framesOf = (context) => feedback.filter((f) => f.context === context).length;
const writesOf = (context) => writes.filter((w) => w.context === context);
const lastHint = (context) => hints.filter((h) => h.context === context).at(-1)?.descriptions;
const frameText = (contexts) => contexts.map((c) => lastSvg(c) ?? "").join("\n");
const withoutStrip = (doc) => {
	const { stripGroup: _drop, ...rest } = doc ?? {};
	void _drop;
	return JSON.stringify(Object.keys(rest).sort().map((k) => [k, rest[k]]));
};

// --- rasters (sharp / librsvg) ------------------------------------------------
/** A deterministic stand-in for the touch strip picture, so translucent
 * panels show. */
function backdrop(width) {
	const buf = Buffer.alloc(width * 100 * 4);
	for (let y = 0; y < 100; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			const bar = Math.floor((x + y) / 37) % 3;
			buf[i] = bar === 0 ? 240 : Math.round(40 + (x / width) * 160);
			buf[i + 1] = bar === 1 ? 20 : Math.round(60 + (y / 100) * 140);
			buf[i + 2] = bar === 2 ? 250 : 90;
			buf[i + 3] = 255;
		}
	}
	return buf;
}

async function raster(width, layers) {
	const { data } = await sharp(backdrop(width), { raw: { width, height: 100, channels: 4 } }).composite(layers).raw().toBuffer({ resolveWithObject: true });
	return data;
}

/** The stitched slices against the reference frame: the largest channel
 * difference and how many pixels pass 2 levels. */
async function seamDiff(slices, reference, width) {
	const ref = await raster(width, [{ input: Buffer.from(reference), left: 0, top: 0 }]);
	// Each slice drawn as the app's QtSvg draws an edge filter, past the
	// viewport (a filtered group goes into a buffer the size of its filter
	// region): on a canvas widened by the bleed, then cut to the slot. The
	// row words' edge rides every look (src/strip/scene.ts ROWS_FILTER).
	const joined = await raster(
		width,
		await Promise.all(
			slices.map(async (svg, c) => {
				const wide = svg.replace('viewBox="0 0 200 100" width="200" height="100"', 'viewBox="-3 0 206 100" width="206" height="100"');
				return { input: await sharp(Buffer.from(wide)).extract({ left: 3, top: 0, width: 200, height: 100 }).png().toBuffer(), left: c * 200, top: 0 };
			})
		)
	);
	const plain = backdrop(width);
	let max = 0;
	let over = 0;
	let drawn = 0;
	const seamMax = [];
	for (let y = 0; y < 100; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			const d = Math.max(Math.abs(ref[i] - joined[i]), Math.abs(ref[i + 1] - joined[i + 1]), Math.abs(ref[i + 2] - joined[i + 2]));
			if (d > max) max = d;
			if (d > 2) over++;
			if (Math.max(Math.abs(plain[i] - joined[i]), Math.abs(plain[i + 1] - joined[i + 1]), Math.abs(plain[i + 2] - joined[i + 2])) > 2) drawn++;
			const nearSeam = x % 200 === 0 || x % 200 === 199;
			if (nearSeam && x > 0 && x < width - 1) seamMax.push(d);
		}
	}
	return { max, over, drawn, seamMax: Math.max(0, ...seamMax) };
}

/** Slice bounds: the slot's own viewBox and size, and every rect inside
 * the slot plus its bleed. */
function sliceBounded(svg) {
	if (!/^<svg [^>]*viewBox="0 0 200 100" width="200" height="100"/.test(svg)) return false;
	for (const m of svg.matchAll(/<rect x="(-?[\d.]+)"(?: y="(-?[\d.]+)")? width="([\d.]+)" height="([\d.]+)"[^>]*>/g)) {
		const [x, y, w, h] = [Number(m[1]), Number(m[2] ?? 0), Number(m[3]), Number(m[4])];
		if (x < -3 || x + w > 203 || y < -3 || y + h > 103) return false;
	}
	return true;
}

/** The panel's live preview must be what the device got; then compare it
 * with the reference frame of the same frame. Retries when a frame lands
 * between the two reads. */
async function stitchedAgainstReference(send, from, contexts, width, label) {
	for (let attempt = 0; attempt < 4; attempt++) {
		const before = feedback.length;
		const state = await ask(send, from, { event: "stripGet", requestId: `${label}-${attempt}`, frame: true });
		const slices = state?.preview?.slices ?? [];
		const sent = contexts.map((c) => lastSvg(c));
		if (feedback.length !== before || slices.length !== contexts.length || slices.some((s, i) => s !== sent[i])) {
			await sleep(150);
			continue;
		}
		check(`${label}: the panel's live preview is exactly the slices the device got`, true);
		const diff = await seamDiff(slices, state.preview.frame, width);
		results[`${label}Seam`] = diff;
		check(`${label}: the stitched frame draws over the strip picture (${diff.drawn} px)`, diff.drawn > width * 20);
		check(`${label}: stitched slices match the reference frame (max ${diff.max} levels, ${diff.over} px over 2, seam columns max ${diff.seamMax})`, diff.max <= 40 && diff.over <= 32);
		return;
	}
	check(`${label}: a quiet moment to compare the preview with the device`, false, "frames kept landing");
}

function rateStats(contexts, fromAt, toAt) {
	const seconds = (toAt - fromAt) / 1000;
	const per = contexts.map((c) => {
		const ats = feedback.filter((f) => f.context === c && f.at >= fromAt && f.at < toAt).map((f) => f.at);
		let peak = 0;
		for (let i = 0; i < ats.length; i++) {
			let j = i;
			while (j < ats.length && ats[j] - ats[i] < 1000) j++;
			peak = Math.max(peak, j - i);
		}
		return { context: c, calls: ats.length, perSecond: Number((ats.length / seconds).toFixed(2)), peakIn1s: peak };
	});
	const total = per.reduce((n, p) => n + p.calls, 0);
	return { seconds: Number(seconds.toFixed(1)), per, aggregatePerSecond: Number((total / seconds).toFixed(2)) };
}

function sizeStats(contexts, fromAt) {
	const list = feedback.filter((f) => contexts.includes(f.context) && f.at >= fromAt);
	const uri = list.map((f) => f.uri.length).sort((a, b) => a - b);
	const raw = list.map((f) => Buffer.byteLength(f.svg ?? "", "utf8")).sort((a, b) => a - b);
	const pick = (xs) => (xs.length === 0 ? null : { min: xs[0], median: xs[Math.floor(xs.length / 2)], max: xs.at(-1) });
	return { slices: list.length, rawSvgBytes: pick(raw), dataUriBytes: pick(uri) };
}

// --- the scenario ----------------------------------------------------------------
async function scenario(send) {
	const xl = [0, 1, 2, 3, 4, 5].map((c) => dialCtx(XL, c));
	const plus = [0, 1, 2, 3].map((c) => dialCtx(PLUS, c));

	// Learn the fake's reading keys through the panel channel.
	appearDial(send, "x0", {});
	await sleep(1500);
	panelAppears(send, "x0");
	send({ event: "sendToPlugin", action: DIAL, context: "x0", payload: { event: "getSensorTree" } });
	await waitUntil(() => panel.some((p) => p.payload?.event === "sensorTree"), 1500);
	const tree = panel.find((p) => p.payload?.event === "sensorTree")?.payload;
	const readings = (tree?.groups ?? []).flatMap((g) => g.readings.map((r) => ({ key: r.key, label: r.label, unit: r.unit })));
	const temp = readings.find((r) => /Temp/.test(r.label));
	const volt = readings.find((r) => r !== temp && r.unit !== temp?.unit);
	check("the fake offers a temperature and a reading in another unit", temp !== undefined && volt !== undefined, JSON.stringify(readings));
	if (temp === undefined || volt === undefined) return finish();

	// A. Independent dials on both decks: their own faces, no write.
	const own = (context) => ({ readingKey: columnOfCtx(context) % 2 === 0 ? temp.key : volt.key, label: `Dial ${context}`, dialBackground: context.startsWith("x") ? "theme" : "glass", warnValue: "80", ...(context === "x0" ? { linkId: "xl" } : {}), ...(context === "p0" ? { linkId: "plus" } : {}) });
	for (const c of [...xl, ...plus]) appearDial(send, c, own(c));
	await waitUntil(() => [...xl, ...plus].every((c) => (lastSvg(c) ?? "").includes(`Dial ${c}`)), 3000);
	check("independent dials draw their own faces", [...xl, ...plus].every((c) => (lastSvg(c) ?? "").includes(`Dial ${c}`)));
	check("appearing writes nothing", writes.length === 0, `${writes.length} writes`);
	const original = new Map([...xl, ...plus].map((c) => [c, structuredClone(stored.get(c))]));

	// B. A whole strip on the + XL, created from dial 1's panel.
	const created = await ask(send, "x0", { event: "stripCreate", opId: "xl-create", layout: "whole", patch: [{ op: "set", path: "panes.0.series", value: [{ key: temp.key }] }] });
	check("whole strip on the + XL: created at revision 1", created?.ok === true && created.rev === 1, JSON.stringify(created)?.slice(0, 200));
	const xlId = created?.groupId;
	await waitUntil(() => xl.every((c) => writesOf(c).length === 1), 1000);
	check("+ XL: one complete document written per dial", xl.every((c) => writesOf(c).length === 1 && writesOf(c)[0].settings.stripGroup?.joined === true && writesOf(c)[0].settings.stripGroup?.rev === 1));
	check("+ XL: every individual field kept byte for byte", xl.every((c) => withoutStrip(writesOf(c)[0]?.settings) === withoutStrip(original.get(c))));
	const xlFrom = Date.now();
	await waitUntil(() => xl.every((c) => (lastSvg(c) ?? "").startsWith("<svg") && !(lastSvg(c) ?? "").includes(`Dial ${c}`)), 1500);
	check("+ XL: six slices, one per dial", xl.every((c) => !(lastSvg(c) ?? "").includes(`Dial ${c}`)));
	check("+ XL: every slice is bounded to its 200x100 slot", xl.every((c) => sliceBounded(lastSvg(c) ?? "")));
	// A Trend of one reading: its pressed turn and long touch are the scale's.
	check("+ XL: the hints say what the strip does", xl.every((c) => lastHint(c)?.rotate === "Time window · pressed: scale" && lastHint(c)?.push === "Inspect" && lastHint(c)?.longTouch === "Auto scale"), JSON.stringify(lastHint("x3")));
	await sleep(2500);
	await stitchedAgainstReference(send, "x2", xl, 1200, "+ XL whole");

	// C. An equal split on the +: area on the left, lanes on the right.
	const split = await ask(send, "p0", {
		event: "stripCreate",
		opId: "plus-create",
		layout: "split",
		patch: [
			{ op: "set", path: "window", value: "1m" },
			{ op: "set", path: "panes.0.series", value: [{ key: temp.key }] },
			{ op: "set", path: "panes.0.style", value: "area" },
			{ op: "set", path: "panes.1.style", value: "lanes" },
			{ op: "set", path: "panes.1.series", value: [{ key: temp.key }, { key: volt.key }] }
		]
	});
	check("equal split on the +: created", split?.ok === true && split.rev === 1, JSON.stringify(split)?.slice(0, 200));
	const plusId = split?.groupId;
	await waitUntil(() => plus.every((c) => !(lastSvg(c) ?? "").includes(`Dial ${c}`)), 1500);
	check("+: four slices", plus.every((c) => !(lastSvg(c) ?? "").includes(`Dial ${c}`)) && plus.every((c) => sliceBounded(lastSvg(c) ?? "")));
	check("+: the split hint names both halves' shared window", plus.every((c) => lastHint(c)?.rotate?.startsWith("Window, both halves")), JSON.stringify(lastHint("p1")));
	await sleep(2500);
	await stitchedAgainstReference(send, "p3", plus, 800, "+ split");

	// A reconnect need not replay willAppear. The SDK retains visible actions
	// until willDisappear, so the strip must restore that device's membership.
	const reconnectWrites = writes.length;
	const reconnectXl = () => send({ event: "deviceDidConnect", device: XL, deviceInfo: { name: "Fixture + XL", type: 13, size: { columns: 9, rows: 4 } } });
	send({ event: "deviceDidDisconnect", device: XL });
	await sleep(150);
	const disconnected = new Map(xl.map((c) => [c, framesOf(c)]));
	const otherDeckFrames = plus.map(framesOf);
	await sleep(1200);
	check("reconnect: disconnected strip sends nothing", xl.every((c) => framesOf(c) === disconnected.get(c)));
	check("reconnect: the other deck keeps drawing", plus.some((c, i) => framesOf(c) > otherDeckFrames[i]));
	reconnectXl(); // Deliberately no willAppear events.
	await waitUntil(() => xl.every((c) => framesOf(c) > disconnected.get(c)), 2000);
	check("reconnect without willAppear: every slice resumes", xl.every((c) => framesOf(c) > disconnected.get(c)) && !/missing/.test(frameText(xl)));
	const resumed = xl.map(framesOf);
	await waitUntil(() => xl.some((c, i) => framesOf(c) > resumed[i]), 2500);
	check("reconnect without willAppear: subsequent live data keeps drawing", xl.some((c, i) => framesOf(c) > resumed[i]));

	// A real disappearance while offline must stay gone on reconnect.
	send({ event: "deviceDidDisconnect", device: XL });
	disappearDial(send, "x2");
	await sleep(150);
	const removedFrames = framesOf("x2");
	reconnectXl();
	await waitUntil(() => /Dial 3 missing/.test(frameText(xl.filter((c) => c !== "x2"))), 2000);
	check("reconnect: the others name the dial that disappeared", /Dial 3 missing/.test(frameText(xl.filter((c) => c !== "x2"))));
	check("reconnect: a disappeared context is never resurrected", framesOf("x2") === removedFrames);
	appearDial(send, "x2", stored.get("x2"));
	await waitUntil(() => framesOf("x2") > removedFrames && !/missing/.test(frameText(xl)), 2000);
	check("reconnect: it rejoins when it really appears", framesOf("x2") > removedFrames && !/missing/.test(frameText(xl)));
	// The app may also replay appearances after the connect event.
	for (const c of xl) appearDial(send, c, stored.get(c));
	await sleep(200);
	check("reconnect and appearance replays write no settings", writes.length === reconnectWrites);

	// D. Steady state: rates and payload sizes with no input for 6 s.
	const steadyFrom = Date.now();
	await sleep(6000);
	const steadyTo = Date.now();
	results.rates = { xl: rateStats(xl, steadyFrom, steadyTo), plus: rateStats(plus, steadyFrom, steadyTo), all: rateStats([...xl, ...plus], steadyFrom, steadyTo) };
	check("steady state: at most 10 setFeedback per second per context", [...results.rates.xl.per, ...results.rates.plus.per].every((p) => p.peakIn1s <= 10), JSON.stringify(results.rates.all.per));

	// E. A stale edit is refused and writes nothing.
	const edit = await ask(send, "p1", { event: "stripEdit", opId: "plus-edit", groupId: plusId, baseRev: 1, patch: [{ op: "set", path: "panes.0.overlays.minmax", value: true }] });
	check("+: an edit on the current revision is applied at revision 2", edit?.ok === true && edit.rev === 2, JSON.stringify(edit)?.slice(0, 200));
	await waitUntil(() => plus.every((c) => writesOf(c).length === 2), 1000);
	const writesBeforeStale = writes.length;
	const stale = await ask(send, "p2", { event: "stripEdit", opId: "plus-stale", groupId: plusId, baseRev: 1, patch: [{ op: "set", path: "panes.0.style", value: "heat" }] });
	check("+: an edit on an older revision is refused as stale", stale?.ok === false && stale.reason === "stale" && stale.rev === 2, JSON.stringify(stale)?.slice(0, 200));
	await sleep(300);
	check("+: the refused edit wrote nothing", writes.length === writesBeforeStale);

	// F. A member leaves the page: the rest show the gap, and it resyncs.
	disappearDial(send, "x2");
	const rest = xl.filter((c) => c !== "x2");
	await waitUntil(() => /Dial 3 missing/.test(frameText(rest)), 1500);
	check("+ XL: a missing member leaves the incomplete face (Dial 3 missing)", /Dial 3 missing/.test(frameText(rest)));
	const x2Frames = framesOf("x2");
	appearDial(send, "x2", stored.get("x2"));
	await waitUntil(() => !/missing/.test(frameText(xl)) && framesOf("x2") > x2Frames, 1500);
	check("+ XL: the returning member resyncs every slice", !/missing/.test(frameText(xl)) && framesOf("x2") > x2Frames);

	// G. A page swap right after an input: no late paint on departed contexts.
	encoder(send, "dialDown", "p1");
	encoder(send, "dialUp", "p1");
	for (const c of plus) disappearDial(send, c);
	const gone = new Map(plus.map((c) => [c, framesOf(c)]));
	await sleep(1800);
	check("+: no frame reaches a dial after its page left", plus.every((c) => framesOf(c) === gone.get(c)), JSON.stringify(plus.map((c) => framesOf(c) - gone.get(c))));
	for (const c of plus) appearDial(send, c, stored.get(c));
	await waitUntil(() => plus.every((c) => framesOf(c) > gone.get(c)), 1500);
	check("+: the page coming back gets its frames again", plus.every((c) => framesOf(c) > gone.get(c)));
	// The pause taken just before the swap came back with the page.
	await waitUntil(() => /PAUSED/.test(frameText(plus)), 1000);
	check("+: the paused view returns with its page", /PAUSED/.test(frameText(plus)));
	encoder(send, "touchTap", "p0", { tapPos: [100, 50], hold: true });
	await waitUntil(() => !/PAUSED/.test(frameText(plus)), 1000);

	// H. Taps on both sides of the split's seam (columns 1 | 2).
	encoder(send, "touchTap", "p1", { tapPos: [199, 50], hold: false });
	await waitUntil(() => lastHint("p0")?.push === "Back to live" && /PAUSED/.test(frameText(["p0", "p1"])), 1000);
	check("+: a tap at the left half's last pixel pauses the left half only", lastHint("p0")?.push === "Back to live" && lastHint("p1")?.push === "Back to live" && lastHint("p2")?.push === "Inspect" && lastHint("p3")?.push === "Inspect", JSON.stringify(plus.map((c) => lastHint(c)?.push)));
	check("+: the left half shows PAUSED, the right half LIVE", /PAUSED/.test(frameText(["p0", "p1"])) && />LIVE</.test(frameText(["p2", "p3"])));
	encoder(send, "touchTap", "p2", { tapPos: [0, 50], hold: false });
	await waitUntil(() => lastHint("p3")?.push === "Back to live", 1000);
	check("+: a tap at the right half's first pixel pauses the right half", lastHint("p3")?.push === "Back to live" && lastHint("p2")?.push === "Back to live");
	encoder(send, "touchTap", "p0", { tapPos: [10, 10], hold: true });
	encoder(send, "touchTap", "p3", { tapPos: [10, 10], hold: true });
	await waitUntil(() => plus.every((c) => lastHint(c)?.push === "Inspect"), 1000);
	check("+: touch hold returns each half to live", plus.every((c) => lastHint(c)?.push === "Inspect"));
	// Rapid input: a pressed-and-released inspect, then 30 turns in about a
	// second move the cursor; each dial still gets at most 10 frames a second.
	encoder(send, "dialDown", "p0");
	encoder(send, "dialUp", "p0");
	await waitUntil(() => lastHint("p0")?.push === "Back to live", 1000);
	const burstFrom = Date.now();
	for (let i = 0; i < 30; i++) {
		encoder(send, "dialRotate", i % 2 === 0 ? "p0" : "p1", { ticks: -1, pressed: false });
		await sleep(33);
	}
	await sleep(400);
	results.burst = rateStats(plus, burstFrom, Date.now());
	check("+: 30 turns in a second stay within 10 frames per second per dial", results.burst.per.every((p) => p.peakIn1s <= 10), JSON.stringify(results.burst.per));
	check("+: the cursor moved (the paused frame changed during the burst)", results.burst.per.some((p) => p.calls > 0));
	encoder(send, "dialDown", "p0");
	encoder(send, "dialUp", "p0");
	await waitUntil(() => lastHint("p0")?.push === "Inspect", 1000);
	// Rotation changes the window for this session, without a write.
	const writesBeforeTurn = writes.length;
	encoder(send, "dialRotate", "p3", { ticks: 1, pressed: false });
	await sleep(400);
	const turned = await ask(send, "p0", { event: "stripGet", requestId: "turn" });
	check("+: a turn moves both halves from 1 min to 5 min for this session", JSON.stringify(turned?.group?.panes?.map((p) => p.window)) === JSON.stringify(["5m", "5m"]), JSON.stringify(turned?.group?.panes));
	check("+: the turn wrote nothing", writes.length === writesBeforeTurn);

	// I. HWiNFO Control strip commands.
	const control = (context, settings) => {
		send({ event: "willAppear", action: CONTROL, context, device: PLUS, payload: { settings, coordinates: { column: 0, row: 1 }, controller: "Keypad", isInMultiAction: false } });
		return async () => {
			send({ event: "keyDown", action: CONTROL, context, device: PLUS, payload: { settings, coordinates: { column: 0, row: 1 } } });
			send({ event: "keyUp", action: CONTROL, context, device: PLUS, payload: { settings, coordinates: { column: 0, row: 1 } } });
			await sleep(400);
		};
	};
	const pressToggle = control("k-toggle", { command: "stripToggleInspect", target: "" });
	const pressPlus = control("k-plus", { command: "stripInspect", target: "plus" });
	const pressNone = control("k-none", { command: "stripLive", target: "nothing" });
	const pressNext = control("k-next", { command: "next", target: "" });
	await sleep(200);
	await pressPlus();
	check("Control: Strip inspect for Link ID plus reaches the + strip only", alerts.length === 0 && plus.every((c) => lastHint(c)?.push === "Back to live") && xl.every((c) => lastHint(c)?.push === "Inspect"), JSON.stringify({ alerts, plus: plus.map((c) => lastHint(c)?.push), xl: xl.map((c) => lastHint(c)?.push) }));
	check("Control: the key shows its tick", images.some((i) => i.context === "k-plus" && typeof i.image === "string" && i.image.length > 0));
	await pressToggle();
	check("Control: Strip inspect or back to live toggles each strip (both halves)", plus.every((c) => lastHint(c)?.push === "Inspect") && xl.every((c) => lastHint(c)?.push === "Back to live"), JSON.stringify({ plus: plus.map((c) => lastHint(c)?.push), xl: xl.map((c) => lastHint(c)?.push) }));
	await pressNone();
	check("Control: a Link ID no strip carries shows the alert", alerts.includes("k-none"));
	await pressNext();
	check("Control: Next reading skips every joined dial (alert, nothing reached)", alerts.includes("k-next"));
	await pressToggle();
	await waitUntil(() => xl.every((c) => lastHint(c)?.push === "Inspect"), 1000);

	// L. Large values and Scale and grid on the + XL strip: the left readout
	// in dial 1's slot beside an area graph with its scale, stitched against
	// the reference; then values only; then back off.
	const bigOf = (svg) => Math.max(0, ...[...(svg ?? "").matchAll(/font-size="(\d+)" font-weight="700"/g)].map((m) => Number(m[1])));
	const xlEdit = async (opId, baseRev, patch) => ask(send, "x0", { event: "stripEdit", opId, groupId: xlId, baseRev, patch });
	const leftOn = await xlEdit("xl-readout-left", 1, [
		{ op: "set", path: "panes.0.readout", value: "left" },
		{ op: "set", path: "panes.0.overlays.axes", value: true },
		{ op: "set", path: "panes.0.style", value: "area" }
	]);
	check("+ XL: Readout left with Scale and grid applies at revision 2", leftOn?.ok === true && leftOn.rev === 2, JSON.stringify(leftOn)?.slice(0, 200));
	await waitUntil(() => bigOf(lastSvg("x0")) >= 40, 1500);
	results.readoutLeftSize = bigOf(lastSvg("x0"));
	check(`+ XL: dial 1's slot shows the value large (${results.readoutLeftSize} px type)`, results.readoutLeftSize >= 40);
	check("+ XL: no other slot draws large values", xl.slice(1).every((c) => bigOf(lastSvg(c)) < 40));
	check("+ XL: the copy stores the readout and the overlay", xl.every((c) => writesOf(c).at(-1)?.settings.stripGroup?.config?.panes?.[0]?.readout === "left" && writesOf(c).at(-1)?.settings.stripGroup?.config?.panes?.[0]?.overlays?.axes === true));
	await waitUntil(() => /-4m</.test(frameText(xl)), 1500);
	check("+ XL: the time axis names its ticks", /-4m</.test(frameText(xl)) && /-1m</.test(frameText(xl)), frameText(xl).slice(0, 200));
	check("+ XL: every slice is still bounded to its 200x100 slot", xl.every((c) => sliceBounded(lastSvg(c) ?? "")));
	await sleep(1200);
	await stitchedAgainstReference(send, "x2", xl, 1200, "+ XL readout left");
	const only = await xlEdit("xl-readout-only", 2, [{ op: "set", path: "panes.0.readout", value: "only" }]);
	check("+ XL: Values only applies at revision 3", only?.ok === true && only.rev === 3, JSON.stringify(only)?.slice(0, 200));
	// One reading: its number in dial 1's slot (a value never splits across two
	// slices), its trend across the rest of the strip.
	await waitUntil(() => bigOf(lastSvg("x0")) >= 55, 1500);
	results.readoutOnlySize = bigOf(lastSvg("x0"));
	check(`+ XL: values only draws the reading large in one slot (${results.readoutOnlySize} px type)`, results.readoutOnlySize >= 55 && xl.filter((c) => c !== "x0").every((c) => bigOf(lastSvg(c)) < 40));
	// A young strip's line reaches back only as far as its history, so the trend's
	// place shows by its scale's ends in dial 2 and its window's words in dial 6.
	check("+ XL: values only uses the whole strip: its trend runs from dial 2 to dial 6", /<text/.test(lastSvg("x1") ?? "") && /5 min/.test(lastSvg("x5") ?? "") && /<path|<polyline/.test(lastSvg("x5") ?? ""), xl.map((c) => (lastSvg(c) ?? "").length).join(","));
	const off = await xlEdit("xl-readout-off", 3, [
		{ op: "set", path: "panes.0.readout", value: "off" },
		{ op: "set", path: "panes.0.overlays.axes", value: false },
		{ op: "set", path: "panes.0.style", value: "trend" }
	]);
	check("+ XL: Off clears them at revision 4", off?.ok === true && off.rev === 4, JSON.stringify(off)?.slice(0, 200));
	check("+ XL: the stored copy no longer names them", xl.every((c) => !/"readout"|"axes"/.test(JSON.stringify(writesOf(c).at(-1)?.settings.stripGroup?.config ?? {}))));
	await waitUntil(() => xl.every((c) => bigOf(lastSvg(c)) < 40), 1500);
	check("+ XL: the strip draws its graph across all six slots again", xl.every((c) => bigOf(lastSvg(c)) < 40));

	// M. Group on the + XL strip: the folder of the strip's reading. The
	// fake grows to a temperature, a fan, a voltage and four core voltages:
	// volts are the majority (5), the other two are counted, not drawn.
	await fakeCommand("grow", "GROWN");
	await fakeCommand("cores", "CORES");
	const groupOn = await xlEdit("xl-group", 4, [
		{ op: "set", path: "panes.0.style", value: "group" },
		{ op: "set", path: "panes.0.group", value: { from: "folder", keys: [], view: "auto" } }
	]);
	check("+ XL: Group applies at revision 5", groupOn?.ok === true && groupOn.rev === 5, JSON.stringify(groupOn)?.slice(0, 200));
	await waitUntil(() => /max of 5 · Test Source/.test(frameText(xl)), 3000);
	check("+ XL: Group draws the folder's 5 readings and names the highest", /max of 5 · Test Source/.test(frameText(xl)), frameText(xl).slice(0, 300));
	check("+ XL: Group says the 2 readings in other units were left out", /2 in other units left out/.test(frameText(xl)));
	check("+ XL: every Group slice is bounded and within 8192 bytes", xl.every((c) => sliceBounded(lastSvg(c) ?? "") && Buffer.byteLength(lastSvg(c) ?? "", "utf8") <= 8192));
	check("+ XL: Group's hints say a turn picks the reading", lastHint("x1")?.rotate === "Reading · pressed: window" && lastHint("x1")?.longTouch === "Top reading", JSON.stringify(lastHint("x1")));
	const writesBeforeGroupInput = writes.length;
	encoder(send, "dialRotate", "x3", { ticks: 1, pressed: false });
	await waitUntil(() => /1 of 5 · Test Source/.test(lastSvg("x0") ?? ""), 1500);
	check("+ XL: a turn picks the first reading, named large in dial 1's slot", /1 of 5 · Test Source/.test(lastSvg("x0") ?? "") && />Test Volt</.test(lastSvg("x0") ?? ""), (lastSvg("x0") ?? "").slice(0, 400));
	encoder(send, "dialDown", "x3");
	encoder(send, "dialRotate", "x3", { ticks: 1, pressed: true });
	encoder(send, "dialUp", "x3");
	await sleep(300);
	const groupTurned = await ask(send, "x0", { event: "stripGet", requestId: "group-turn" });
	check("+ XL: a pressed turn changes Group's window for this session", groupTurned?.group?.panes?.[0]?.window === "15m", JSON.stringify(groupTurned?.group?.panes));
	encoder(send, "touchTap", "x4", { tapPos: [100, 50], hold: true });
	await waitUntil(() => /max of 5/.test(lastSvg("x0") ?? ""), 1500);
	check("+ XL: a long touch goes home", /max of 5/.test(lastSvg("x0") ?? ""));
	check("+ XL: Group's turns and touches wrote nothing", writes.length === writesBeforeGroupInput);
	const groupOff = await xlEdit("xl-group-off", 5, [{ op: "set", path: "panes.0.style", value: "trend" }]);
	check("+ XL: back to Trend at revision 6, the rule kept in the copy", groupOff?.ok === true && groupOff.rev === 6 && xl.every((c) => writesOf(c).at(-1)?.settings.stripGroup?.config?.panes?.[0]?.group?.from === "folder"), JSON.stringify(groupOff)?.slice(0, 200));
	await waitUntil(() => !/ of 5/.test(frameText(xl)), 1500);

	// N. Meters and Events on the + XL strip. Meters
	// draws two readings across the strip, each number in the last dial of its
	// half; Events marks the temperature past a band and counts it.
	const meters = await xlEdit("xl-meters", 6, [
		{ op: "set", path: "panes.0.style", value: "meters" },
		{ op: "set", path: "panes.0.series", value: [{ key: temp.key }, { key: volt.key }] }
	]);
	check("+ XL: Meters applies at revision 7", meters?.ok === true && meters.rev === 7, JSON.stringify(meters)?.slice(0, 200));
	await waitUntil(() => bigOf(lastSvg("x2")) >= 40 && bigOf(lastSvg("x5")) >= 40, 1500);
	results.meterSize = Math.min(bigOf(lastSvg("x2")), bigOf(lastSvg("x5")));
	check(`+ XL: Meters draws each reading large in the last dial of its half of the strip (${results.meterSize} px type)`, results.meterSize >= 40);
	check("+ XL: Meters uses the whole strip: every dial draws its share", xl.every((c) => /<text|<path/.test(lastSvg(c) ?? "")), xl.map((c) => (lastSvg(c) ?? "").length).join(","));
	check("+ XL: every Meters slice is bounded", xl.every((c) => sliceBounded(lastSvg(c) ?? "")));
	const writesBeforeMeterTap = writes.length;
	encoder(send, "touchTap", "x1", { tapPos: [150, 50], hold: false });
	await waitUntil(() => /PAUSED/.test(frameText(xl)), 1500);
	check("+ XL: a tap on a meter pauses it at the newest moment", /PAUSED at newest/.test(frameText(xl)), frameText(xl).slice(0, 300));
	encoder(send, "touchTap", "x1", { tapPos: [150, 50], hold: true });
	await waitUntil(() => !/PAUSED/.test(frameText(xl)), 1500);
	check("+ XL: the meter tap wrote nothing", writes.length === writesBeforeMeterTap);
	const events = await xlEdit("xl-events", 7, [
		{ op: "set", path: "panes.0.style", value: "events" },
		{ op: "set", path: "window", value: "15m" },
		{ op: "set", path: "panes.0.series", value: [{ key: temp.key }] },
		{ op: "set", path: "panes.0.bands", value: [{ key: temp.key, warn: 40, below: false, unit: temp.unit }] }
	]);
	check("+ XL: Events with a 40 °C band applies at revision 8", events?.ok === true && events.rev === 8, JSON.stringify(events)?.slice(0, 200));
	await waitUntil(() => /(once|\d+ times) past 40\.0 °C in 15 min/.test(frameText(xl)), 3000);
	check("+ XL: Events counts the stretches past the limit in the window", /(once|\d+ times) past 40\.0 °C in 15 min/.test(frameText(xl)), frameText(xl).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300));
	check("+ XL: Events keeps its legend in dial 1 and marks only the timeline", /Test Temp/.test(lastSvg("x0") ?? "") && xl.every((c) => sliceBounded(lastSvg(c) ?? "")));
	const patternedOff = await xlEdit("xl-patterned-off", 8, [
		{ op: "set", path: "panes.0.style", value: "trend" },
		{ op: "set", path: "window", value: "5m" },
		{ op: "set", path: "panes.0.bands", value: [] }
	]);
	check("+ XL: back to Trend at revision 9", patternedOff?.ok === true && patternedOff.rev === 9, JSON.stringify(patternedOff)?.slice(0, 200));
	await waitUntil(() => !/past 40/.test(frameText(xl)), 1500);

	// S. Strip Screens on the + XL strip: a second screen, then a third; the
	// last dial's turn moves screens with a wipe (one slice per frame, from
	// the right) and writes nothing; Control next, previous and first; the
	// automatic cycle at 10 s, held while a member's panel is open.
	const closePanel = (context) => {
		for (; pi.context === context && pi.count > 0; pi.count--) send({ event: "propertyInspectorDidDisappear", action: DIAL, context, device: deviceOf(context) });
		if (pi.context === context) pi.context = null;
	};
	const screensOfCopy = (config) => [config?.panes?.[0]?.screenId, ...(config?.screens ?? []).map((s) => s.screenId)];
	const screenNow = async (requestId) => (await ask(send, "x0", { event: "stripGet", requestId }))?.group?.screen;
	const linesIn = (svg) => /<rect x="[-\d.]+" y="0" width="[\d.]+" height="3"/.test(svg ?? "");
	const two = await xlEdit("xl-screens-two", 9, [
		{ op: "addScreen", at: 1 },
		{ op: "set", path: "screens.0.group", value: { from: "filter", filter: "*volt*", keys: [], view: "auto" } }
	]);
	check("+ XL: a second screen applies at revision 10", two?.ok === true && two.rev === 10, JSON.stringify(two)?.slice(0, 200));
	check("+ XL: two screens, each with its own id", screensOfCopy(two?.config).length === 2 && screensOfCopy(two?.config).every((id) => /^[0-9a-f]{8}$/.test(id ?? "")), JSON.stringify(screensOfCopy(two?.config)));
	await waitUntil(() => xl.every((c) => linesIn(lastSvg(c))), 1500);
	check("+ XL: two screens draw the position line in every slice", xl.every((c) => linesIn(lastSvg(c))));
	check("+ XL: the last dial's turn says Screen, the others keep the time window", lastHint("x5")?.rotate === "Screen · pressed: scale" && lastHint("x0")?.rotate === "Time window · pressed: scale", JSON.stringify([lastHint("x0"), lastHint("x5")]));
	const three = await xlEdit("xl-screens-three", 10, [
		{ op: "addScreen", at: 2 },
		{ op: "set", path: "screens.1.style", value: "meters" },
		{ op: "set", path: "screens.1.series", value: [{ key: temp.key }, { key: volt.key }] }
	]);
	check("+ XL: a third screen applies at revision 11", three?.ok === true && three.rev === 11 && screensOfCopy(three?.config).length === 3, JSON.stringify(three)?.slice(0, 200));
	const ids = screensOfCopy(three?.config);
	await waitUntil(() => xl.every((c) => writesOf(c).length === 13), 1000);
	await sleep(2500);
	const writesBeforeScreens = writes.length;
	const wipeFrom = feedback.length;
	encoder(send, "dialRotate", "x5", { ticks: 1, pressed: false });
	await sleep(1200);
	// The wipe's own sends: each slice once (a data frame after it may
	// send them again).
	const wipe = [];
	for (const f of feedback.slice(wipeFrom).filter((f) => xl.includes(f.context))) {
		if (wipe.some((w) => w.context === f.context)) break;
		wipe.push(f);
	}
	const wipeOrder = wipe.map((f) => f.context);
	results.wipe = wipe.map((f, i) => ({ context: f.context, afterMs: i === 0 ? 0 : f.at - (wipe[0]?.at ?? f.at) }));
	check("+ XL: the turn wipes the second screen in from the right, one slice per frame", wipeOrder.length >= 4 && wipeOrder.every((c, i) => i === 0 || columnOfCtx(c) < columnOfCtx(wipeOrder[i - 1])) && wipeOrder[0] === "x5", JSON.stringify(results.wipe));
	check("+ XL: wipe frames are at least 90 ms apart", wipe.every((f, i) => i === 0 || f.at - (wipe[i - 1]?.at ?? 0) >= 90), JSON.stringify(results.wipe));
	check("+ XL: the second screen says its name and place where the window words were", /\*volt\* · 2 of 3/.test(frameText(xl)), frameText(xl).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300));
	check("+ XL: the turn moved the strip to the second screen", (await screenNow("screens-turn")) === ids[1]);
	await sleep(1500);
	check("+ XL: 1.6 s later the window words are back", !/ of 3/.test(frameText(xl)));
	await stitchedAgainstReference(send, "x2", xl, 1200, "+ XL screen 2");
	const pressScreen = control("k-screen-next", { command: "stripScreenNext", target: "xl" });
	const pressScreenPrev = control("k-screen-prev", { command: "stripScreenPrev", target: "xl" });
	const pressScreenFirst = control("k-screen-first", { command: "stripScreenFirst", target: "xl" });
	await sleep(200);
	const alertsBefore = alerts.length;
	await pressScreen();
	check("Control: Next screen moves the + XL strip to its third screen", (await screenNow("screens-next")) === ids[2]);
	await pressScreen();
	check("Control: Next screen wraps to the first", (await screenNow("screens-wrap")) === ids[0]);
	await pressScreenPrev();
	check("Control: Previous screen wraps to the last", (await screenNow("screens-prev")) === ids[2]);
	await pressScreenFirst();
	check("Control: First screen goes home", (await screenNow("screens-first")) === ids[0]);
	check("Control: the screen keys reached their strip (no alert)", alerts.length === alertsBefore, JSON.stringify(alerts.slice(alertsBefore)));
	check("+ XL: moving between screens wrote nothing", writes.length === writesBeforeScreens, `${writes.length - writesBeforeScreens} writes`);
	const cycled = await xlEdit("xl-screens-cycle", 11, [{ op: "set", path: "screenCycle", value: 10 }]);
	check("+ XL: Next screen every 10 seconds applies at revision 12", cycled?.ok === true && cycled.rev === 12, JSON.stringify(cycled)?.slice(0, 200));
	closePanel("x0");
	const cycleFrom = Date.now();
	await waitUntil(() => /· 2 of 3/.test(frameText(xl)), 14000);
	results.cycleAfterMs = Date.now() - cycleFrom;
	check(`+ XL: the cycle shows the next screen about 10 s after the panel closed (${results.cycleAfterMs} ms)`, /· 2 of 3/.test(frameText(xl)) && results.cycleAfterMs >= 9000 && results.cycleAfterMs <= 13500);
	panelAppears(send, "x2");
	const heldFrom = feedback.length;
	await sleep(14000);
	check("+ XL: an open member panel holds the cycle (no screen change in 14 s)", !feedback.slice(heldFrom).some((f) => / of 3/.test(f.svg ?? "")));
	closePanel("x2");
	const resumeFrom = Date.now();
	await waitUntil(() => /· 3 of 3/.test(frameText(xl)), 14000);
	results.cycleResumeMs = Date.now() - resumeFrom;
	check(`+ XL: closing the panel restarts the wait: the next screen ${results.cycleResumeMs} ms later`, /· 3 of 3/.test(frameText(xl)) && results.cycleResumeMs >= 9000);
	check("+ XL: the cycle wrote nothing", writes.length === writesBeforeScreens + xl.length, `${writes.length - writesBeforeScreens} writes`);
	const cycleOff = await xlEdit("xl-screens-cycle-off", 12, [{ op: "set", path: "screenCycle", value: 0 }]);
	check("+ XL: By hand applies at revision 13", cycleOff?.ok === true && cycleOff.rev === 13, JSON.stringify(cycleOff)?.slice(0, 200));
	await sleep(400);

	// J. A dial leaves its strip: its own face and settings come back.
	const left = await ask(send, "x5", { event: "stripLeave", opId: "x5-leave", groupId: xlId });
	check("+ XL: dial 6 leaves its strip", left?.ok === true, JSON.stringify(left)?.slice(0, 200));
	await waitUntil(() => writesOf("x5").length === 16, 1000);
	const leftDoc = writesOf("x5").at(-1)?.settings;
	check("+ XL: the leaving dial keeps a dormant copy and every individual field", leftDoc?.stripGroup?.joined === false && withoutStrip(leftDoc) === withoutStrip(original.get("x5")));
	await waitUntil(() => (lastSvg("x5") ?? "").includes("stats reset"), 1000);
	check("+ XL: the dial says its sessions restarted", (lastSvg("x5") ?? "").includes("stats reset"));
	check("+ XL: its own face is back at once, under the hint", (lastSvg("x5") ?? "").includes("Dial x5"));
	await waitUntil(() => (lastSvg("x5") ?? "").includes("Dial x5") && !(lastSvg("x5") ?? "").includes("stats reset"), 3000);
	check("+ XL: then the hint ends on its own face", (lastSvg("x5") ?? "").includes("Dial x5") && !(lastSvg("x5") ?? "").includes("stats reset"));
	// The edge bar beside the gap is always drawn; the note naming it takes
	// a row only where no other text of the pane sits. The strip's frame
	// comes at most 100 ms after its previous one.
	const bar = /<rect x="198" y="0" width="2" height="100"/;
	await waitUntil(() => bar.test(lastSvg("x4") ?? ""), 1000);
	check("+ XL: the slot beside the gap carries the edge bar", bar.test(lastSvg("x4") ?? ""), (lastSvg("x4") ?? "").slice(0, 200));
	results.gapNote = /Dial 6 left the strip/.test(frameText(xl.slice(0, 5)));
	const x5Frames = framesOf("x5");
	await sleep(1500);
	check("+ XL: the strip paints nothing on the dial that left", feedback.filter((f) => f.context === "x5").slice(x5Frames).every((f) => (f.svg ?? "").includes("Dial x5")));

	// K. Settings writes, exactly: create, edit, leave. Nothing else.
	const counts = Object.fromEntries([...xl, ...plus].map((c) => [c, writesOf(c).length]));
	// Create, three readout edits (left, only, off), Group on and
	// off, Meters, Events and back, two screens added, the cycle on
	// and off, and dial 6's leave.
	const expected = Object.fromEntries([...xl.map((c) => [c, c === "x5" ? 14 : 13]), ...plus.map((c) => [c, 2])]);
	check("settings writes are exactly create, edits and leave", JSON.stringify(counts) === JSON.stringify(expected), JSON.stringify(counts));
	results.sizes = { xl: sizeStats(xl.slice(0, 5), xlFrom), plus: sizeStats(plus, xlFrom) };
	results.counts = counts;

	// L. One shared Background (src/ui/shared-looks.ts), on the owner's page.
	// The decks above go out of view (another profile), so only this page's
	// actions are on screen.
	for (const c of [...xl, ...plus]) disappearDial(send, c);
	await sleep(300);
	await looksLegs(send, temp, volt);
	await finish();
}

// --- L: one shared Background, "Use it everywhere" --------------------------------
const XL2 = "devXL2";
const PLUS2 = "devPlus2";
const READING = "com.lawrensen.hwinfo.reading";
/** Nebula's base on Midnight (deck-art.ts nebulaBase: the background 55 %
 * toward black), the opaque field a painted Nebula face starts with. */
const NEBULA_BASE = "#03080E";
const where = new Map(); // context -> { action, device, coordinates, controller }

function appearOn(send, action, context, device, coordinates, settings) {
	const controller = action === READING ? "Keypad" : "Encoder";
	where.set(context, { action, device, coordinates, controller });
	stored.set(context, settings);
	send({ event: "willAppear", action, context, device, payload: { settings, coordinates, controller, isInMultiAction: false } });
}

function disappearOn(send, context) {
	const w = where.get(context);
	send({ event: "willDisappear", action: w.action, context, device: w.device, payload: { settings: stored.get(context) ?? {}, coordinates: w.coordinates, controller: w.controller, isInMultiAction: false } });
}

/** A panel's own write reaching the plugin (didReceiveSettings). */
function panelWrites(send, context, settings) {
	const w = where.get(context);
	stored.set(context, settings);
	send({ event: "didReceiveSettings", action: w.action, context, device: w.device, payload: { settings, coordinates: w.coordinates, isInMultiAction: false } });
}

const lastFace = (context) => {
	const action = where.get(context)?.action;
	if (action === READING) return decodeSvg(images.filter((i) => i.context === context).at(-1)?.image) ?? "";
	return lastSvg(context) ?? "";
};
/** A painted Nebula face: the deepened Midnight base, the marker replaced. */
const drawsNebula = (context) => {
	const svg = lastFace(context);
	return svg.includes(`fill="${NEBULA_BASE}"`) && !svg.includes("data-art=");
};
/** Clear draws no backdrop of its own: no full-face rect at all. */
const drawsClear = (context) => {
	const svg = lastFace(context);
	return svg !== "" && !/<rect width="(?:144|200)" height="(?:144|100)" fill=/.test(svg) && !svg.includes(`fill="${NEBULA_BASE}"`);
};

async function looksLegs(send, temp, volt) {
	let globals = { theme: "midnight" };
	const deliver = (doc) => {
		globals = doc;
		globalsDoc = doc;
		send({ event: "didReceiveGlobalSettings", payload: { settings: doc } });
	};
	deliver(globals);
	// The owner's page (2026-10-26): six Sensor Dials own Clear, Nebula or
	// Stars, the whole strip over them keeps its own Clear and plain words,
	// keys on the same deck own Clear or Stars (one is on Default), and an
	// independent row of dials on a + owns Clear, Nebula and Stars (one on
	// Default).
	const ownLooks = ["clear", "clear", "nebula", "clear", "clear", "stars"];
	const xs = [0, 1, 2, 3, 4, 5].map((c) => `o-x${c}`);
	const ps = [0, 1, 2, 3].map((c) => `o-p${c}`);
	const keys = ["o-k0", "o-k1", "o-k2"];
	xs.forEach((ctx, c) => appearOn(send, DIAL, ctx, XL2, { column: c, row: 0 }, { readingKey: temp.key, label: `Owner ${c}`, dialBackground: ownLooks[c], dialAccentWords: false }));
	appearOn(send, READING, "o-k0", XL2, { column: 0, row: 0 }, { readingKey: temp.key, label: "K0", keyBackground: "clear" });
	appearOn(send, READING, "o-k1", XL2, { column: 1, row: 0 }, { readingKey: temp.key, label: "K1" });
	appearOn(send, READING, "o-k2", XL2, { column: 2, row: 0 }, { readingKey: volt.key, label: "K2", keyBackground: "stars", keyAccentWords: false });
	[["clear"], ["nebula"], ["stars"], [undefined]].forEach(([look], c) => appearOn(send, DIAL, ps[c], PLUS2, { column: c, row: 0 }, { readingKey: c % 2 === 0 ? temp.key : volt.key, label: `Plus ${c}`, ...(look === undefined ? {} : { dialBackground: look }) }));
	await sleep(1500);
	const made = await ask(send, "o-x2", { event: "stripCreate", opId: "owner-create", layout: "whole", patch: [{ op: "set", path: "background", value: "clear" }, { op: "set", path: "accentWords", value: false }] });
	check("owner's page: the whole strip is made, keeping its own Clear (the 1.8 candidate's stored copy)", made?.ok === true && made.config?.background === "clear" && made.config?.accentWords === false, JSON.stringify(made)?.slice(0, 200));
	const id = made?.groupId;
	await waitUntil(() => xs.every((c) => writesOf(c).length === 1), 1500);
	await sleep(800);
	const base = new Map([...xs, ...ps, ...keys].map((c) => [c, writesOf(c).length]));
	const since = (c) => writesOf(c).length - (base.get(c) ?? 0);

	// Shared Background Nebula (the panel writes both globals): Default
	// actions follow at once, own choices keep theirs, nothing is written.
	deliver({ ...globals, keyBackground: "nebula", dialBackground: "nebula" });
	await waitUntil(() => drawsNebula("o-k1") && drawsNebula("o-p3"), 3000);
	await sleep(1200);
	check("shared Nebula: a key and a dial on Default draw Nebula", drawsNebula("o-k1") && drawsNebula("o-p3"), lastFace("o-p3").slice(0, 300));
	check("shared Nebula: the strip keeping its own Clear does not (the owner's report)", xs.every((c) => !drawsNebula(c)), lastFace("o-x0").slice(0, 300));
	check("shared Nebula: own Clear and Stars keys and dials keep theirs", drawsClear("o-k0") && drawsClear("o-p0") && !drawsNebula("o-k2") && !drawsNebula("o-p2"), JSON.stringify([lastFace("o-k0").slice(0, 200), lastFace("o-p0").slice(0, 200)]));
	check("shared Nebula: nothing is written", [...base.keys()].every((c) => since(c) === 0), JSON.stringify([...base.keys()].map((c) => [c, since(c)])));
	const counted = await askLooks(send, "o-x2");
	check("shared Nebula: the count line's numbers: 2 keys, 3 dials and 1 strip keep their own (joined dials' own are not drawn)", counted?.keys === 2 && counted.dials === 3 && counted.strips === 1 && counted.background === 6 && counted.words === 2, JSON.stringify(counted));

	// One dial leaves the page before the reset: it comes back later.
	disappearOn(send, "o-x5");
	await sleep(400);

	// Use it everywhere: the panel raises looksResetGen in the same write.
	const panelFrom = panel.length;
	deliver({ ...globals, keyAccentWords: false, dialAccentWords: false, looksResetGen: 1 });
	const resetOn = ["o-k0", "o-k2", "o-p0", "o-p1", "o-p2", "o-x0", "o-x1", "o-x2", "o-x3", "o-x4"];
	await waitUntil(() => resetOn.every((c) => since(c) >= 1), 3000);
	await sleep(1500);
	check(
		"Use it everywhere: exactly one write per visible action with its own look, none for one on Default or off screen",
		[...base.keys()].every((c) => since(c) === (resetOn.includes(c) ? 1 : 0)),
		JSON.stringify([...base.keys()].map((c) => [c, since(c)]))
	);
	const keyDoc = writesOf("o-k2").at(-1)?.settings ?? {};
	check("Use it everywhere: a key's own Background and Words go, every other field stays", !("keyBackground" in keyDoc) && !("keyAccentWords" in keyDoc) && keyDoc.label === "K2" && keyDoc.readingKey === volt.key, JSON.stringify(keyDoc));
	const dialDoc = writesOf("o-p2").at(-1)?.settings ?? {};
	check("Use it everywhere: an independent dial's own Background goes, every other field stays", !("dialBackground" in dialDoc) && dialDoc.label === "Plus 2", JSON.stringify(dialDoc));
	const memberDocs = xs.slice(0, 5).map((c) => writesOf(c).at(-1)?.settings ?? {});
	check(
		"Use it everywhere: one strip edit (revision 2), written once to each member on screen, with no Background or Words of its own and the dial's own looks gone",
		memberDocs.every((d) => d.stripGroup?.rev === 2 && d.stripGroup?.id === id && !("background" in (d.stripGroup?.config ?? {})) && !("accentWords" in (d.stripGroup?.config ?? {})) && !("dialBackground" in d) && !("dialAccentWords" in d)),
		JSON.stringify(memberDocs.map((d) => [d.stripGroup?.rev, d.stripGroup?.config?.background, d.dialBackground]))
	);
	await waitUntil(() => ["o-k0", "o-k1", "o-k2", ...ps, ...xs.slice(0, 5)].every(drawsNebula), 3000);
	const notNebula = ["o-k0", "o-k1", "o-k2", ...ps, ...xs.slice(0, 5)].filter((c) => !drawsNebula(c));
	check("Use it everywhere: every visible key, dial and the strip draw Nebula", notNebula.length === 0, JSON.stringify(notNebula));
	const pushed = panel.slice(panelFrom).filter((p) => p.payload?.event === "ownLooks").at(-1)?.payload;
	check("Use it everywhere: the open panel hears the new count, none left", pushed?.keys === 0 && pushed.dials === 0 && pushed.strips === 0, JSON.stringify(pushed));
	const settled = writes.length;
	deliver({ ...globals });
	await sleep(1200);
	check("the same generation delivered again writes nothing", writes.length === settled, `${writes.length - settled} writes`);

	// An action that appears later is reset when it appears: the strip's
	// dial that was away takes the strip's new copy in the same one write;
	// a key that was on another page drops its own look.
	const x5Before = writesOf("o-x5").length;
	appearOn(send, DIAL, "o-x5", XL2, { column: 5, row: 0 }, stored.get("o-x5"));
	appearOn(send, READING, "o-k3", XL2, { column: 3, row: 0 }, { readingKey: temp.key, label: "K3", keyBackground: "glass", keyAccentWords: true });
	await waitUntil(() => writesOf("o-x5").length > x5Before && writesOf("o-k3").length > 0, 3000);
	await sleep(1200);
	const x5Doc = writesOf("o-x5").at(-1)?.settings ?? {};
	check("appears later: the strip's dial is written once, with the group's copy (revision 2) and its own look gone", writesOf("o-x5").length === x5Before + 1 && x5Doc.stripGroup?.rev === 2 && !("dialBackground" in x5Doc), JSON.stringify({ n: writesOf("o-x5").length - x5Before, rev: x5Doc.stripGroup?.rev, look: x5Doc.dialBackground }));
	check("appears later: the key is written once, without its own Background and Words", writesOf("o-k3").length === 1 && !("keyBackground" in (writesOf("o-k3")[0]?.settings ?? {})) && !("keyAccentWords" in (writesOf("o-k3")[0]?.settings ?? {})), JSON.stringify(writesOf("o-k3").map((w) => w.settings)));
	await waitUntil(() => drawsNebula("o-x5") && drawsNebula("o-k3"), 3000);
	check("appears later: both draw Nebula", drawsNebula("o-x5") && drawsNebula("o-k3"));

	// A choice made after the reset carries the generation and is kept:
	// on appear, and through another delivery of the shared settings.
	const keep = writes.length;
	panelWrites(send, "o-k1", { ...(stored.get("o-k1") ?? {}), keyBackground: "clear", looksGen: 1 });
	await waitUntil(() => drawsClear("o-k1"), 3000);
	disappearOn(send, "o-k1");
	await sleep(200);
	appearOn(send, READING, "o-k1", XL2, { column: 1, row: 0 }, stored.get("o-k1"));
	deliver({ ...globals });
	await sleep(1500);
	check("a choice made after the reset is kept: nothing written, the key draws its own Clear", writes.length === keep && drawsClear("o-k1"), JSON.stringify({ writes: writes.length - keep, face: lastFace("o-k1").slice(0, 200) }));
	const stars = await ask(send, "o-x0", { event: "stripEdit", opId: "owner-stars", groupId: id, baseRev: 2, patch: [{ op: "set", path: "background", value: "stars" }] });
	check("a strip Background picked after the reset carries the generation", stars?.ok === true && stars.config?.background === "stars" && stars.config?.looksGen === 1, JSON.stringify(stars?.config)?.slice(0, 200));
	await sleep(800);
	const afterStars = writes.length;
	deliver({ ...globals });
	await sleep(1200);
	check("and stays through another delivery: nothing written", writes.length === afterStars, `${writes.length - afterStars} writes`);

	// A new strip follows the shared Background: it stores none of its own.
	const fresh = await ask(send, "o-p3", { event: "stripCreate", opId: "plus-new", layout: "split" });
	check("a new strip stores no Background or Words of its own", fresh?.ok === true && fresh.config?.background === undefined && fresh.config?.accentWords === undefined, JSON.stringify(fresh?.config)?.slice(0, 200));
	await waitUntil(() => ps.every(drawsNebula), 3000);
	check("a new strip draws the shared Nebula", ps.every(drawsNebula), lastFace("o-p0").slice(0, 300));
}

/** The count line's numbers, as the panel asks for them. */
async function askLooks(send, context) {
	panelAppears(send, context);
	const from = panel.length;
	send({ event: "sendToPlugin", action: DIAL, context, payload: { event: "getOwnLooks" } });
	await waitUntil(() => panel.slice(from).some((p) => p.payload?.event === "ownLooks"), 1500);
	return panel.slice(from).find((p) => p.payload?.event === "ownLooks")?.payload;
}

async function finish() {
	if (finished) return;
	finished = true;
	if (results.rates !== undefined) {
		console.log("\nsetFeedback rates, steady state (no input):");
		for (const [deck, r] of Object.entries(results.rates)) {
			console.log(`  ${deck}: ${r.aggregatePerSecond}/s aggregate over ${r.seconds} s; per context ${r.per.map((p) => `${p.context} ${p.perSecond}/s (peak ${p.peakIn1s} in 1 s)`).join(", ")}`);
		}
	}
	if (results.burst !== undefined) console.log(`  turn burst on the +: ${results.burst.aggregatePerSecond}/s aggregate over ${results.burst.seconds} s; per context ${results.burst.per.map((p) => `${p.context} ${p.calls} calls (peak ${p.peakIn1s} in 1 s)`).join(", ")}`);
	if (results.sizes !== undefined) {
		console.log("slice payloads since creation:");
		for (const [deck, s] of Object.entries(results.sizes)) console.log(`  ${deck}: ${s.slices} slices, raw SVG ${JSON.stringify(s.rawSvgBytes)}, data URI ${JSON.stringify(s.dataUriBytes)}`);
	}
	if (results.readoutLeftSize !== undefined) console.log(`readout type size: left ${results.readoutLeftSize} px, values only ${results.readoutOnlySize} px`);
	if (results.gapNote !== undefined) console.log(`gap note "Dial 6 left the strip" drawn: ${results.gapNote}`);
	if (results.wipe !== undefined) console.log(`screen wipe: ${results.wipe.map((w) => `${w.context}@${w.afterMs}ms`).join(" ")}; cycle after the panel closed ${results.cycleAfterMs} ms, after the hold ${results.cycleResumeMs} ms`);
	for (const label of ["+ XL wholeSeam", "+ splitSeam", "+ XL readout leftSeam"]) if (results[label] !== undefined) console.log(`seam ${label.replace("Seam", "")}: ${JSON.stringify(results[label])}`);
	const shutdown = await new Promise((resolve) => {
		if (plugin === null || plugin.exitCode !== null) {
			resolve({ clean: true, detail: "already exited" });
			return;
		}
		const timer = setTimeout(() => {
			plugin.kill();
			resolve({ clean: false, detail: "killed after 5 s" });
		}, 5000);
		plugin.once("exit", (code) => {
			clearTimeout(timer);
			resolve({ clean: true, detail: `exit ${code}` });
		});
		for (const client of wss.clients) client.close();
		wss.close();
	});
	check("plugin exits when the app socket closes", shutdown.clean, shutdown.detail);
	if (fake !== null && fake.exitCode === null) {
		fake.stdin.write("exit\n");
		await Promise.race([new Promise((r) => fake.once("exit", r)), sleep(3000).then(() => fake.kill())]);
	}
	console.log(results.errors.length === 0 ? "\nE2E STRIP: ALL CHECKS PASSED" : `\nE2E STRIP: ${results.errors.length} FAILURES`);
	process.exit(results.errors.length === 0 ? 0 : 1);
}

// --- boot ----------------------------------------------------------------------
const info = buildInfo({
	devices: [
		{ id: XL, name: "Harness + XL", size: { columns: 9, rows: 4 }, type: 13 },
		{ id: PLUS, name: "Harness Plus", size: { columns: 4, rows: 2 }, type: 7 },
		{ id: XL2, name: "Owner + XL", size: { columns: 9, rows: 4 }, type: 13 },
		{ id: PLUS2, name: "Owner Plus", size: { columns: 4, rows: 2 }, type: 7 }
	]
});

fake = spawn(process.execPath, [path.join(repoRoot, "scripts", "fake-hwinfo.mjs")], {
	stdio: ["pipe", "pipe", "inherit"],
	env: { ...process.env, HWINFO_SM2_NAME: MAPPING_NAME, HWINFO_SM2_MUTEX_NAME: MUTEX_NAME }
});
await new Promise((resolve, reject) => {
	let buffer = "";
	fake.stdout.on("data", (chunk) => {
		fakeOut += chunk.toString();
		buffer += chunk.toString();
		if (buffer.includes("READY")) resolve();
	});
	fake.once("exit", () => reject(new Error("fake-hwinfo died before READY")));
});

plugin = spawn(process.execPath, pluginArgv(PORT, "e2e-strip", info), {
	cwd: pluginDir,
	stdio: ["ignore", "inherit", "inherit"],
	env: { ...process.env, HWINFO_LOG_LEVEL: "info", HWINFO_SM2_NAME: MAPPING_NAME, HWINFO_SM2_MUTEX_NAME: MUTEX_NAME }
});
plugin.on("exit", (code) => {
	if (!finished) {
		console.error(`plugin exited early with code ${code}`);
		if (fake !== null) fake.kill();
		process.exit(1);
	}
});

setTimeout(() => {
	if (!finished) {
		console.error("E2E STRIP: timeout, scenario never completed");
		plugin.kill();
		if (fake !== null) fake.kill();
		process.exit(1);
	}
}, 240000).unref();
