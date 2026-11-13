// The Sensor Dial panel's Strip section, end to end on the simulated host:
// the REAL panel (sensor-dial.html, pi-shell.js, pi-common.js, pi-strip.js
// and pi-strip-model.js) in headless Chromium, and on the plugin side the
// REAL strip runtime (src/strip/controller.ts, pi.ts, edits.ts) over a
// simulated deck of Sensor Dials (scripts/lib/pi-strip-sim.mjs). Checks:
//
//   observe   opening, choosing a layout to make, Build's list and previews
//             send no setSettings frame at all; only stripGet with a draft; an
//             independent dial shows no dial row and, with nothing chosen,
//             no preview box (a layout brings it); making a strip shows the
//             marks and one line; Build's list is there before a strip exists
//   preview   the plugin's own slices, in a box that shows with the
//             choice and is reserved before the first frame: a +'s four
//             side by side in one row, a + XL's six as its two halves,
//             three over three, each slice twice one row of six
//   first run an independent dial where the strip can be made opens the Strip
//             section on Build's list, every screen ticked, with one button:
//             nothing is written and no draft goes before it, and it makes
//             every screen ticked in the one stripCreate; a fold the person
//             chose stays. A tick changes what is made and what a Whole strip
//             previews; the title's first words are a quiet dropdown of the
//             starts, and One reading only there leaves today's strip of this
//             dial's reading, the dropdown in the caption's place; Screens
//             for this PC brings the list back. Each row of the list is one
//             line, cut with an ellipsis, its whole text in its title. A dial
//             that cannot make the strip yet shows no list until a layout is
//             chosen, then the list waits with the reason, and its button
//             comes alive when the last dial is placed. CPU and GPU is one of
//             the rows, and pushes move no box
//   starts    an Equal split being made offers this PC's pairs in the
//             caption's place, the first that fits picked, each pick one
//             draft and no write, Choose each half the start before pairs;
//             the pick follows the person to another dial; Make the strip
//             is one press. A running Equal split offers Fill both halves,
//             Whole strip screens or not: a pair is a preview only, Cancel
//             writes nothing, and over halves that hold nothing a person
//             made Use is one stripEdit with no question, on the panel of
//             any dial of the strip; a stale Use is refused. One pair is a
//             plain link; none, nothing new; a held Enter acts once.
//   ask       over a half a person made (built, named, Build's, or the
//             Whole strip's first screen) Use asks first, in words that
//             name each half and, when Replace changes the left half, the
//             Whole strip's first screen: Cancel focused with its ring,
//             nothing sent; Cancel, Escape and focus leaving close it with
//             no write; pushes move no box; Tab reaches Replace and Enter
//             writes one stripEdit; the second click of a double click on
//             Use, Cancel or Replace presses nothing and moves no focus; a
//             number typed before Use goes first and the question asks over
//             its answer; a newer copy from another panel closes it and the
//             status line says why; a stale Replace is refused and the other
//             panel's change stays; a refused write says so; Whole and
//             Equal while it asks write the layout alone; reopening drops
//             it; Replace changes only the two halves (the replaced
//             screen's name and origin go, every other screen stays); at
//             378 and 189 px it wraps inside the panel, a name with no
//             place to break too
//             A running Whole strip is as it was
//   make      Make the strip: one stripCreate, written by the plugin to
//             every member, every other field kept; then no Apply anywhere
//             and Scale and alerts closed
//   immediate every control on a running strip sends one stripEdit at once
//             with the revision shown, and the panel shows the copy the
//             plugin wrote back: four readings ticked in Compare are four
//             drawn; a fourth in Trend is kept, marked not drawn, offered
//             Compare, and never cut from the settings
//   stale     another dial's panel changed the strip first: the change is
//             refused, said in the status line, and the panel shows the
//             plugin's copy (with the other dial's change); nothing written
//   window    a running Equal split with Same window unticked shows only the
//             halves' two Time window selects, the strip's hidden; ticked,
//             the strip's one; Same window's box never moves
//   press    a real mouse press lands where it began: after a reading is
//             ticked (its result list open) and after a typed field that
//             commits on blur, a held press below sees no box above the
//             pointer move (0 px) between pointerdown and pointerup, even
//             with the plugin's answer arriving during the press
//   leave     Independent dials on a member leaves at once (one stripLeave,
//             the radios wait, no confirm step); one line on the dial that
//             left ends in Rejoin and Every dial leaves; Rejoin restores it;
//             Every dial leaves from the dial that left leaves the rest;
//             Restore brings them all back; a refused leave puts the radio
//             back and says why
//   dials     a healthy strip shows no dial row; a dial that left brings
//             the row with one line naming it and its one action (Rejoin),
//             and Rejoin puts it back and the row goes; several missing
//             dials are one short line ("Dials 3 to 4 are missing"); a
//             mark picks the dial the line names; the marks are one Tab
//             stop with arrows, Enter picks
//   memory    a new strip's ticked list follows the person to another dial
//   missing   placement guidance and a refused Make for an empty slot
//   live      pushes never move a box in the section, the dial row shown
//             (normal and forced colors)
//   theme     on a joined dial the Theme band shows and edits the strip's
//             theme (one stripEdit, the dial's own theme untouched) and the
//             strip redraws in it; Default clears it; Make shared shares it
//             and clears it; an independent dial's pick is its own setting
//   display   on a joined dial Display's text color, Background, decimals
//             and °F edit the strip (one stripEdit each, no dial write), its
//             dial-only controls step aside; Reading, Alerts and Controls
//             step aside with no fold written, the sensor reload and the PC
//             filter stand in the strip's Readings row, and all of it is back
//             on a dial that leaves
//   shared    on a joined dial Shared defaults Text color and Dim labels
//             show the shared settings, never the strip's, and a change
//             there is one shared write and no strip edit
//   sky       a strip on its own Dusk shows Stars and Sky color under
//             Background, each Default naming its value first, and opening
//             writes nothing; on the strip's own Paper the line under
//             Background says the art draws no sky and the pair reads idle;
//             Background and the pair are described by that line only
//             while it shows
//   group    the Group style on the simulated host: a folder draws a heat
//             row per reading; a reading HWiNFO adds or renames follows with
//             no edit; a filter matching 48 draws 32 and says so; a folder
//             of two units draws the majority unit and counts the rest; the
//             gestures per the Group table; past the group history
//             allowance the strip says history full; no new help lines
//   ambient   the Ambient style: every reading in °C draws up to 48 and
//             says how many of how many, from the Ambient share of the
//             history allowance; the scale, limits and overlays go; a turn
//             changes the window and a push does nothing; no new help lines
//   group unit  a Group takes every reading in a unit, the rule Build's
//             Cooling gives it past the dials: one edit, Unit in place of the
//             picker, View Now a column per reading
//   patterned Meters and Events: Meters
//             takes a reading per dial, six on a + XL, and leaves empty
//             dials to the picture; Events is offered for a Yes/No reading,
//             starts on 15 minutes in the same edit, and counts its events;
//             the Readout select goes; no new help lines
//   looks     a Meters pane shows Look on Graph's row (Thin bar, Full bar,
//             Liquid), no new help line and no new row; each
//             pick is one stripEdit of the Look alone, Thin bar removes it,
//             opening and reopening send nothing; a percentage on Liquid
//             hides Scale from and Scale to; Trend hides Look and the pane
//             keeps it. CPU and RAM usage (Physical Memory Load an Other
//             reading, as HWiNFO lists it) is an Equal split's first pair
//             and pick, a Meters Liquid of each named CPU usage and RAM
//             usage in whole percents, one stripCreate, no panel write
//   no strip  a deck with no touch strip (a Studio, type 10, which the
//             plugin does not list) reads "Strips need a Stream Deck + or +
//             XL. This deck has no touch strip." with no device code, and
//             the section stays shown with its summary
//   screens   one screen
//             is This screen's name and "Add a screen" on one line (+0 px
//             for the link); Add is one addScreen after the screen on the
//             strip, shown with its Filter focused and examples that work
//             here; a dead alternative is named; with two or more, one row
//             (the screen before, a list of names with its place, the
//             screen after, Edit) that never grows with the count; the list
//             and the arrows show a screen (stripShowScreen, no write, no
//             box moved); the tools show only after Edit; F2 renames in the
//             list's place; Next screen is one screenCycle edit and the
//             caption says the open panel holds it; arrows show, Alt+arrows
//             and a real press on Later move; eight at most and Add says
//             why; Delete and Remove arm, then remove; typed text follows
//             its screen when the deck moves on; pushes and deck moves move
//             no box; no help lines; nothing past 320 or 189 px; at 189 px
//             the list shows the first characters of the screen's name, Edit
//             open or closed, with every control of the row there and no
//             line more than before; Tab goes through the row as it reads,
//             at 189 px Edit first, at 400 px Edit last
//   names    a screen added by hand takes its first reading's sensor as its
//             name in the same edit (GPU), follows it while the name is one
//             it took that way, and keeps a name the person gave; a new
//             Group with no filter is named by its place
//   build     Build screens on a running strip of two, a tool among the others:
//             what is not there yet and is ticked appended in one stripEdit
//             with its origin and no name (a real press on Use moves nothing
//             above it); a proposal already there is left out and said; built
//             again, nothing is new; at eight it says there is no room; no two
//             screens share a name
//   compare   Compare is offered only for readings in one unit, says why in
//             its option otherwise, and a stored mixed Compare says to use
//             Lanes, with Use Lanes one edit
//   narrow    no horizontal overflow at 320 and 189 px; the dial row with a
//             missing dial stays one line; at 378 and 189 px Build screens
//             sits with Add a screen, and the rows that fit share a line
//   focus     Make the strip, and Remove or Delete taking a strip to one
//             screen, hand focus on to a visible control in the section
//   names °F  a unit screen on a strip that shows °F is Every °F in the
//             list and in Rename's empty name
//   back      the dial that left chooses Whole strip or Equal split again
//             (an arrow step back, or a click): it rejoins, and a layout
//             other than the strip's follows as one stripEdit; a new strip
//             remembered there cannot be made over the dials still in the
//             strip it left, the reason names Rejoin, and the dial row names
//             that strip; a layout chosen there (from a remembered draft)
//             rejoins and drops the draft, so the panel shows the strip on
//             the deck and nothing is remembered; with a pasted
//             copy on the dial the reason names the choice that shows
//             instead of Rejoin
//   one press a held Enter presses once and a double click presses once:
//             Build screens and its Cancel add no screen, the screen tools'
//             Later moves once and Remove only arms, Every dial leaves stays
//             left, a reading's x removes one, Fill's link only previews,
//             Add a screen adds one while the plugin takes 200 ms to
//             answer, and a rotation member's double click still renames
//             it; a single press 300 ms after Use or Build screens, where it
//             was, presses nothing in the question or the list that took
//             its place
//   moved     three quick presses on the screen tools' Earlier or Later move
//             the same screen three places, the first screen of a strip
//             never moved to another included, and a double click there
//             moves it twice at a 0 or a 200 ms answer; Alt+Right and Alt+End
//             on the list move it; the moved screen stays on the strip, in
//             the list, the box and another member's panel; a strip stored
//             with no screen ids keeps the moved screen
//   in turn   text typed in three fields faster than the plugin answers
//             all lands with no stale refusal; an edit made while a Rejoin
//             is on its way, and Keep the strip's setup, Use this dial's
//             copy or Use this deck's dials pressed while an edit is, go
//             once it is answered
//   start     Fill's untouched start is the stored strip's own: a person's
//             pick asks even when a dial shows that reading, and the start
//             goes at once after its dial left
//
// Run: npx tsx scripts/e2e-pi-strip.mjs  (no Stream Deck app, no HWiNFO).
// SIMULATED HOST: this proves the shipped panel code against the production
// strip runtime, not the Stream Deck app's webview or a physical deck.
import { launch } from "./lib/cdp.mjs";
import { makeCheck, sleep } from "./lib/e2e-common.mjs";
import { groupSnapshot, keyOf, sampleSnapshot } from "./lib/pi-fixtures.mjs";
import { GROUP_TURN_PICKS_READING, groupRows, resolveGroup } from "../src/strip/group.ts";
import { stripPaneOf } from "../src/strip/settings.ts";
import { startPiSim } from "./lib/pi-sim.mjs";
import { PanelFoldMemory } from "../src/panel-folds.ts";

const failures = [];
const check = makeCheck((name) => failures.push(name));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// The app sorts the keys of plugin messages: strip copies compare by content.
const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v !== null && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
const sameContent = (a, b) => same(sorted(a), sorted(b));
const PORT_BASE = Number(process.env.PI_STRIP_PORT_BASE ?? 29360);

const sim = await startPiSim({ httpPort: PORT_BASE + 1, wsPort: PORT_BASE });
const b = await launch({ width: 400, height: 900 });
const pageErrors = [];
b.on("Runtime.exceptionThrown", (p) => pageErrors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text));
const watchdog = setTimeout(async () => {
	console.error("[e2e-pi-strip] watchdog: 420 s elapsed, aborting");
	await Promise.race([Promise.allSettled([b.close(), sim.stop()]), sleep(10_000)]);
	process.exit(2);
}, 420_000);
watchdog.unref();

const waitFor = async (what, fn, ms = 3000) => {
	const deadline = performance.now() + ms;
	for (;;) {
		const v = await fn();
		if (v) return v;
		if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await sleep(30);
	}
};

async function open(fixture, overrides, { keep = false, fold = false } = {}) {
	if (!keep) sim.setFixture(fixture, overrides);
	await b.goto(sim.url(fixture));
	await waitFor(`${fixture} ready`, () => b.evaluate(`document.readyState === "complete" && !!window.__hwPanel?.context && window.__hwPanel?.tree != null && !document.documentElement.hasAttribute("data-folds-pending")`), 4000);
	// The first strip answer is in (the device line names the deck).
	await waitFor(`${fixture} strip state`, () => b.evaluate(`!/Waiting/.test(document.getElementById("strip-device").textContent)`), 3000);
	// `fold`: the Strip section stays as the panel left it.
	if (!fold) await b.evaluate(`document.getElementById("sec-strip").open = true`);
	await b.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}

const panelWrites = () => sim.writes.length;
const pluginWrites = () => sim.strip?.pluginWrites.length ?? 0;
const sentEvents = () => sim.piMessages.filter((m) => m.event === "sendToPlugin").map((m) => m.payload?.event);
const frames = () => sim.piMessages.map((m) => m.event);
const stripState = () => sim.toPiLog.filter((p) => p.event === "stripState").at(-1);
const text = (id) => b.evaluate(`document.getElementById(${JSON.stringify(id)})?.textContent ?? null`);
const choose = (value) => b.click(`input[name="strip-layout"][value="${value}"]`);
const note = () => text("strip-note");
const waitNote = (re, ms = 3000) => waitFor(`note ${re}`, async () => re.test((await note()) ?? ""), ms);
const goDisabled = () => b.evaluate(`document.getElementById("strip-go").getAttribute("aria-disabled") === "true"`);
/** Ticks a reading in a pane's checklist the way a person does: search, then the box. */
async function tick(pane, label) {
	await b.evaluate(`(() => { const s = document.getElementById("sp${pane}-search"); s.focus(); s.value = ""; })()`);
	await b.type(label.slice(0, 12));
	await sleep(60);
	const ok = await b.evaluate(`(() => { const row = [...document.querySelectorAll("#sp${pane}-list .hw-row:not([hidden])")].find((r) => r.querySelector(".hw-label")?.textContent === ${JSON.stringify(label)}); if (!row) return false; const box = row.querySelector(".hw-tick"); if (box.disabled) return "disabled"; box.click(); return true; })()`);
	await b.evaluate(`document.getElementById("sp${pane}-search").blur()`);
	await sleep(50);
	return ok;
}
const series = (pane) => b.evaluate(`[...document.querySelectorAll("#sp${pane}-series .hw-strip-reading-text")].map((e) => e.textContent)`);
const rows = (pane) => b.evaluate(`[...document.querySelectorAll("#sp${pane}-series .hw-strip-reading")].map((li) => [li.querySelector(".hw-strip-reading-text").textContent, li.dataset.drawn, li.querySelector(".hw-strip-reading-note")?.textContent ?? ""])`);
/** The dial marks, in order: look, this dial, needs the person, spoken
 * name, Tab stop and whether its line shows. */
const marks = () => b.evaluate(`[...document.querySelectorAll("#strip-slots button[data-column]")].map((m) => ({ column: Number(m.dataset.column), look: m.dataset.look, self: m.hasAttribute("data-self"), needs: m.hasAttribute("data-needs"), label: m.getAttribute("aria-label"), tab: m.tabIndex, expanded: m.getAttribute("aria-expanded") }))`);
const looks = async () => (await marks()).map((m) => m.look);
const statusLine = () => text("strip-device");
/** The one action at the end of the dial row's line (null while none shows). */
const detail = () => b.evaluate(`(() => { const d = document.getElementById("strip-slot-detail"); if (d.hidden || d.getClientRects().length === 0) return null; const button = d.querySelector("button"); const box = d.querySelector("input[data-take]"); return { column: button?.dataset.column ?? box?.dataset.take ?? null, action: button?.textContent ?? null, take: box !== null }; })()`);
/** Whether the dial row (marks and line) shows. */
const rowShown = () => visible("strip-map");
/** What a note that names the dial row is checked against: the note, whether
 * the row shows (client rects of #strip-map) and how many marks are visible. */
const pointsAtRow = async () => ({ note: await note(), rowShown: await rowShown(), rowRects: await b.evaluate(`document.getElementById("strip-map").getClientRects().length`), marksVisible: await b.evaluate(`[...document.querySelectorAll("#strip-slots button[data-column]")].filter((m) => m.getClientRects().length > 0).length`) });
/** The dial row's line title: the whole words, with where to place a dial. */
const statusTitle = () => b.evaluate(`document.getElementById("strip-device").title`);
/** Build's list: each row's words, whether it is ticked, and its one button. */
const listRows = () => b.evaluate(`[...document.querySelectorAll("#strip-build-list li")].map((li) => li.textContent)`);
const listTicks = () => b.evaluate(`[...document.querySelectorAll("#strip-build-list input[data-screen]")].map((box) => [box.dataset.screen, box.checked])`);
const listTick = (id, on) => setBox(`#strip-build-list input[data-screen="${id}"]`, on);
const useDisabled = () => b.evaluate(`document.getElementById("strip-build-use").getAttribute("aria-disabled") === "true"`);
/** The start a strip being made names (the quiet dropdown): where it
 * stands, its options and its pick; null while it does not show. */
const startPick = () =>
	b.evaluate(`(() => { const w = document.getElementById("strip-start-pick"); if (w === null || w.getClientRects().length === 0) return null; const s = document.getElementById("strip-start"); return { inBox: document.getElementById("strip-build-box").contains(w), onCaption: document.getElementById("strip-capline").contains(w), single: w.dataset.single === "true", value: s.value, options: [...s.options].map((o) => [o.value, o.textContent]), text: document.getElementById("strip-start-text").textContent }; })()`);
/** Fill both halves on a running Equal split: the dropdown (its options,
 * pick and words), the one-pair link, Use and Cancel. */
const fillState = () =>
	b.evaluate(`(() => { const shown = (id) => { const e = document.getElementById(id); return e !== null && e.getClientRects().length > 0; }; const s = document.getElementById("strip-fill"); const w = document.getElementById("strip-fill-pick"); return { shown: shown("strip-fill-pick") && w.dataset.single !== "true", single: shown("strip-fill-pick") && w.dataset.single === "true", value: s?.value ?? null, options: s === null ? [] : [...s.options].map((o) => [o.value, o.textContent]), text: document.getElementById("strip-fill-text")?.textContent ?? null, one: shown("strip-fill-one") ? document.getElementById("strip-fill-one").textContent : null, use: shown("strip-fill-use"), cancel: shown("strip-fill-cancel") }; })()`);
/** The question Fill asks before it replaces a half a person made: whether
 * it shows, its words and second line, where focus is and whether that
 * focus draws its ring, and whether the line's Use and Cancel show. */
const askState = () =>
	b.evaluate(`(() => { const seen = (id) => { const e = document.getElementById(id); return e !== null && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden"; }; const shown = seen("strip-fill-ask"); const a = document.activeElement; const s = a === null ? null : getComputedStyle(a); return { shown, text: shown ? document.getElementById("strip-fill-ask-text").textContent : null, also: shown && seen("strip-fill-also") ? document.getElementById("strip-fill-also").textContent : null, focus: a?.id || null, ring: a !== null && a.matches(":focus-visible") && s.outlineStyle === "solid" && parseFloat(s.outlineWidth) >= 2, use: seen("strip-fill-use"), capCancel: seen("strip-fill-cancel") }; })()`);
/** The caption's line: its height, whatever it holds; the caption's own
 * one line of 11.5 px text (1.4em). */
const CAPLINE = 16.1;
const caplineHeight = () => b.evaluate(`Math.round(document.getElementById("strip-capline").getBoundingClientRect().height * 10) / 10`);
/** What a draft's operations draw on each half: style, Large values and readings. */
const draftHalves = (patch) =>
	[0, 1].map((i) => {
		const value = (field) => (patch ?? []).filter((op) => op.path === `panes.${i}.${field}`).at(-1)?.value;
		return [value("style") ?? null, value("readout") ?? "off", (value("series") ?? []).map((s) => s.key)];
	});
/** What a stored strip draws on each half, in draftHalves' terms. */
const storedHalves = (config) => config.panes.map((p) => [p.style, p.readout ?? "off", (p.series ?? []).map((s) => s.key)]);
/** Opens a running strip's list from the link (one screen) or the tool (several). */
async function openBuild() {
	if (await visible("strip-build")) return b.click("#strip-build");
	if ((await b.evaluate(`document.getElementById("strip-screen-edit").getAttribute("aria-expanded")`)) !== "true") await b.click("#strip-screen-edit");
	await b.click('#strip-screen-tools button[data-tool="build"]');
}
const shots = () => b.evaluate(`[...document.querySelectorAll("#strip-shots img")].map((i) => i.getAttribute("src") !== null)`);
/** The preview's rows: each row's box and the dial columns its slices
 * show, plus the whole box (`.box`). */
const shotRows = async () => {
	const out = JSON.parse(await b.evaluate(`JSON.stringify((() => {
		const box = document.getElementById("strip-shots").getBoundingClientRect();
		const rows = [...document.querySelectorAll("#strip-shots > .hw-strip-shot-row")].map((row) => { const r = row.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, w: r.width, h: r.height, columns: [...row.querySelectorAll("img")].map((i) => Number(i.dataset.column)), slices: [...row.querySelectorAll("img")].map((i) => { const s = i.getBoundingClientRect(); return { w: s.width, h: s.height }; }) }; });
		return { box: { w: box.width, h: box.height }, rows };
	})())`));
	return Object.assign(out.rows, { box: out.box });
};

/** Keys whose values differ between two documents. */
function changedKeys(before, after) {
	const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
	return [...keys].filter((k) => !same(before?.[k], after?.[k])).sort();
}
const setSelect = (id, value) => b.evaluate(`(() => { const s = document.getElementById(${JSON.stringify(id)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event("change", { bubbles: true })); return s.value; })()`);
const setBox = (selector, on) => b.evaluate(`(() => { const box = document.querySelector(${JSON.stringify(selector)}); box.checked = ${on}; box.dispatchEvent(new Event("change", { bubbles: true })); })()`);
const typeInto = (id, value) => b.evaluate(`(() => { const f = document.getElementById(${JSON.stringify(id)}); f.focus(); f.value = ${JSON.stringify(value)}; f.dispatchEvent(new Event("input", { bubbles: true })); f.dispatchEvent(new Event("change", { bubbles: true })); f.blur(); })()`);
const checked = () => b.evaluate(`document.querySelector('input[name="strip-layout"]:checked')?.value ?? null`);
const visible = (id) => b.evaluate(`(() => { const e = document.getElementById(${JSON.stringify(id)}); return e !== null && e.getClientRects().length > 0; })()`);
/** The sensor reload shows right after this field, on its row, at its height. */
const reloadBeside = (id) => b.evaluate(`(() => { const r = document.getElementById("picker-refresh"); const f = document.getElementById(${JSON.stringify(id)}); const a = r.getBoundingClientRect(); const c = f.getBoundingClientRect(); return r.getClientRects().length > 0 && r.previousElementSibling === f && Math.abs(a.top - c.top) < 1 && Math.abs(a.height - c.height) < 1; })()`);
const summary = () => b.evaluate(`document.querySelector('[data-summary="strip"]').textContent`);
const docsNow = () => {
	const out = {};
	for (const [context, doc] of sim.strip.settings) out[context] = structuredClone(doc);
	return out;
};
const allowedSent = new Set(["getThemes", "getSensorTree", "getPreview", "getPanelFolds", "setPanelFolds", "getDetailSupport", "getOwnLooks", "stripGet"]);
function noWrites(name) {
	const bad = sentEvents().filter((e) => !allowedSent.has(e));
	check(`${name}: no settings write from the panel or the plugin, only reads and drafts`, panelWrites() === 0 && pluginWrites() === 0 && !frames().includes("setSettings") && !frames().includes("setGlobalSettings") && bad.length === 0, JSON.stringify({ panel: panelWrites(), plugin: pluginWrites(), bad }));
}
const waitCaption = (re) => waitFor(`caption ${re}`, async () => re.test((await text("strip-caption")) ?? ""), 4000);
const waitShots = (n) =>
	waitFor(
		`${n} preview slices`,
		async () => {
			const s = await shots();
			return s.length === n && s.every(Boolean);
		},
		4000
	);
const styleOf = (pane) => b.evaluate(`document.getElementById("sp${pane}-style").value`);
const lastGet = () => sim.piMessages.filter((m) => m.event === "sendToPlugin" && m.payload?.event === "stripGet").at(-1)?.payload;
const edits = () => sim.piMessages.filter((m) => m.event === "sendToPlugin" && m.payload?.event === "stripEdit").map((m) => m.payload);
/** The group copy the plugin holds for the open panel's dial. */
const stored = () => sim.strip.settings.get(sim.context).stripGroup;
/** Waits until the plugin has answered `n` of the panel's stripEdits, and
 * the panel has had a moment to show the answer. */
const editAnswers = () => sim.toPiLog.filter((p) => p.event === "stripEditResult" && p.op === "edit").length;
async function settled(n) {
	await waitFor(`${n} edits answered`, () => edits().length >= n && editAnswers() >= n, 3000);
	await sleep(150);
}
/** Visible buttons or bars in the Strip section that say Apply or Discard. */
const applyAnywhere = () => b.evaluate(`[...document.querySelectorAll("#sec-strip button")].filter((e) => e.getClientRects().length > 0 && /\\b(Apply|Discard)\\b/.test(e.textContent)).map((e) => e.textContent)`);
/** Legend chips (10 x 10 at y 11, on the names' row over the graph)
 * across the live preview's slices. */
const chipCount = () => (stripState()?.preview?.slices ?? []).reduce((n, svg) => n + (svg.match(/<rect x="-?[\d.]+" y="11" width="10" height="10"/g) ?? []).length, 0);
/** Records, in the page, every box of the panel above the pointer at
 * pointerdown and compares it at pointerup: moved (top or height, in px)
 * or detached. One record per press (window.__press). */
const RECORD_PRESS = `(() => {
	const name = (e) => e.id ? "#" + e.id : e.tagName.toLowerCase() + (typeof e.className === "string" && e.className !== "" ? "." + e.className.trim().split(/\\s+/).join(".") : "");
	let down = null;
	window.__press = null;
	document.addEventListener("pointerdown", (e) => {
		down = { y: e.clientY, target: e.target, boxes: new Map([...document.body.querySelectorAll("*")].filter((el) => el.getClientRects().length > 0).map((el) => [el, el.getBoundingClientRect()])) };
	}, { capture: true, once: true });
	document.addEventListener("pointerup", (e) => {
		const moved = [];
		for (const [el, r] of down.boxes) {
			if (r.top >= down.y) continue;
			if (!el.isConnected) { moved.push([name(el), "detached"]); continue; }
			const now = el.getBoundingClientRect();
			const dy = Math.abs(now.top - r.top), dh = Math.abs(now.height - r.height);
			if (dy > 0 || dh > 0) moved.push([name(el), Math.round(dy * 10) / 10, Math.round(dh * 10) / 10]);
		}
		window.__press = { moved, sameTarget: e.target === down.target, downOn: name(down.target), upOn: name(e.target) };
	}, { capture: true, once: true });
})()`;
/** A real mouse press on `selector`, held `holdMs` before the release
 * (time for the plugin's answer to land mid-press), recorded. */
async function press(selector, holdMs = 250) {
	const box = await b.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + Math.min(12, r.width / 2), y: r.top + r.height / 2 }; })()`);
	await sleep(100);
	await b.evaluate(RECORD_PRESS);
	await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
	await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
	await sleep(holdMs);
	const during = { edits: edits().length, answers: editAnswers() };
	await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
	await sleep(250);
	return { ...JSON.parse(await b.evaluate(`JSON.stringify(window.__press)`)), during };
}

/** A real double click at the middle of `selector`: two presses 120 ms
 * apart, the pointer still, as a person double clicks. */
async function doubleClick(selector) {
	const p = await b.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
	await sleep(100);
	await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
	await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
	await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
	await sleep(120);
	await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 2 });
	await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 2 });
	await sleep(600);
}
/** Enter held on the focused control: one press, then the system's repeats
 * (after 500 ms, every 33 ms), then the release. */
async function holdEnter() {
	const down = (autoRepeat) => b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", autoRepeat });
	await down(false);
	await sleep(500);
	for (let i = 0; i < 15; i++) {
		await down(true);
		await sleep(33);
	}
	await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
	await sleep(600);
}

/** Makes the open panel's strip with Make the strip and waits for it. */
async function makeStrip(layout) {
	await choose(layout);
	// A Whole strip offers Build's list; One reading only is a strip of this
	// dial's reading. An Equal split starts from this PC's first pair;
	// Choose each half is the start before there were pairs.
	if (layout === "whole" && (await visible("strip-build-box"))) await setSelect("strip-start", "one");
	if (layout === "split" && (await startPick()) !== null) await setSelect("strip-start", "own");
	await waitCaption(/^Preview of the new strip$/);
	await b.click("#strip-go");
	await waitNote(/^The strip is made\./, 4000);
	await waitFor("running strip editor", () => visible("strip-edit"));
}

try {
	// ---- observe: choosing what to make writes nothing ------------------------
	await open("dial-strip-plus");
	check("observe: an independent dial shows no dial row: nothing there asks anything of the person", !(await rowShown()) && (await detail()) === null);
	check("observe: four hollow marks (Sensor Dials not in a strip), this dial's ringed", same(await looks(), ["hollow", "hollow", "hollow", "hollow"]) && same((await marks()).map((x) => x.self), [false, true, false, false]), JSON.stringify(await marks()));
	check("observe: each mark names its dial and state", same((await marks()).map((x) => x.label), ["Dial 1, not in a strip", "Dial 2, not in a strip, this dial", "Dial 3, not in a strip", "Dial 4, not in a strip"]), JSON.stringify((await marks()).map((x) => x.label)));
	check("observe: Independent dials is chosen and the summary says so", (await checked()) === "independent" && (await summary()) === "Independent dial");
	check("observe: no button bar and no Apply on an independent dial", !(await visible("strip-bar")) && (await applyAnywhere()).length === 0);
	check("observe: Build's list is there before any strip exists, where the strip can be made", await visible("strip-build-box"));
	{
		// In High Contrast a 1 px frame, as the status blocks it is styled
		// with have, keeps Build's list a box.
		const frame = () => b.evaluate(`(() => { const box = document.getElementById("strip-build-box"); const s = getComputedStyle(box); return { shown: box.getClientRects().length > 0, styles: [s.borderTopStyle, s.borderRightStyle, s.borderBottomStyle, s.borderLeftStyle], widths: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].map(parseFloat) }; })()`);
		const normal = await frame();
		await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
		const forced = await frame();
		await b.send("Emulation.setEmulatedMedia", { features: [] });
		check("observe (forced colors): Build's list has a 1 px solid frame on every side, as the status blocks do; normal colors draw none", forced.shown && forced.styles.every((x) => x === "solid") && forced.widths.every((x) => x === 1) && normal.shown && normal.widths.every((x) => x === 0), JSON.stringify({ normal, forced }));
	}
	check("observe: with nothing chosen there is nothing to preview: no preview box and no caption", !(await visible("strip-preview")) && !(await visible("strip-shots")) && !(await visible("strip-caption")));
	await choose("whole");
	await waitCaption(/^Preview of the new strip$/);
	await waitShots(4);
	check("observe: Whole strip shows the preview, the plugin's own four slices, named as an image by its caption", (await visible("strip-preview")) && (await b.evaluate(`(() => { const s = document.getElementById("strip-shots"); return s.getAttribute("role") === "img" && s.getAttribute("aria-label") === "Preview of the new strip: 4 slices side by side"; })()`)), await b.evaluate(`document.getElementById("strip-shots").getAttribute("aria-label")`));
	const plusRows = await shotRows();
	check("preview (+): the four slices in one 8:1 row, as wide as the box", plusRows.length === 1 && same(plusRows[0].columns, [0, 1, 2, 3]) && Math.abs(plusRows[0].w / plusRows[0].h - 8) < 0.1 && Math.abs(plusRows[0].w - plusRows.box.w) < 0.5, JSON.stringify({ rows: plusRows, box: plusRows.box }));
	check("observe: making a strip offers Make the strip and Build's list, not the editor", (await text("strip-build-use")) === "Make the strip" && (await visible("strip-build-box")) && !(await visible("strip-edit")));
	check("observe: making a strip shows the dial row, its line naming the layout and this dial's place", (await rowShown()) && (await statusLine()) === "Whole strip · dial 2 of 4", await statusLine());
	await choose("split");
	check("observe: Equal split makes its strip with no list: Build's screens are a Whole strip's", !(await visible("strip-build-box")) && (await visible("strip-bar")) && (await text("strip-go")) === "Make the strip" && (await b.evaluate(`[...document.querySelectorAll("#strip-bar > *")].filter((e) => e.getClientRects().length > 0).length`)) === 1);
	await sleep(300);
	const drafted = lastGet();
	const pairKeys = [keyOf(sampleSnapshot(), 0, "CPU (Tctl/Tdie)"), keyOf(sampleSnapshot(), 1, "GPU Temperature")];
	check(
		"observe: a layout is previewed as a draft request, never a setting: an Equal split from this PC's first pair, CPU and GPU",
		drafted?.draft?.layout === "split" &&
			drafted.draft.baseRev === 0 &&
			same(draftHalves(drafted.draft.patch), [
				["area", "left", [pairKeys[0]]],
				["area", "left", [pairKeys[1]]]
			]),
		JSON.stringify(drafted)
	);
	await choose("independent");
	await waitCaption(/^No preview yet$/);
	check("observe: Independent dials drops the plugin's draft, and the preview box with it", lastGet()?.draft === null && !(await visible("strip-bar")) && !(await visible("strip-preview")));
	check("observe: Build's list is back, no draft behind it", await visible("strip-build-box"));
	noWrites("observe");

	// ---- no strip: a deck the plugin does not list -------------------------------
	{
		const NO_STRIP = "Strips need a Stream Deck + or + XL. This deck has no touch strip.";
		sim.sendToPi({ ...stripState(), device: { model: "Unknown device (type 10)", strip: false } });
		await waitFor("the no-strip line", async () => (await statusLine()) === NO_STRIP && (await summary()) === "Needs a Stream Deck + or + XL", 3000).catch(() => {});
		const said = { line: await statusLine(), summary: await summary(), section: await visible("sec-strip"), open: await b.evaluate(`document.getElementById("sec-strip").open`), row: await rowShown() };
		check("no strip: a deck with no touch strip reads one sentence with no device code, the section shown with its summary", said.line === NO_STRIP && !/Unknown|type \d/.test(said.line ?? "") && said.section && said.open && said.row && said.summary === "Needs a Stream Deck + or + XL", JSON.stringify(said));
		noWrites("no strip");
	}

	// ---- preview: the box is reserved before the first frame -----------------
	await open("dial-strip-xl");
	check("preview (+ XL): six dial marks and six preview cells", (await marks()).length === 6 && (await shots()).length === 6);
	const boxOf = () => b.evaluate(`(() => { const r = document.getElementById("strip-shots").getBoundingClientRect(); return { w: r.width, h: r.height }; })()`);
	// The plugin's first frame takes a moment here: the box shows with the
	// choice, at its size, before any slice is in it.
	sim.replyDelayMs = 500;
	await choose("split");
	await sleep(100);
	const box0 = await boxOf();
	const empty0 = (await shots()).every((s) => !s);
	sim.replyDelayMs = 0;
	await waitShots(6);
	const box1 = await boxOf();
	check("preview (+ XL): the box shows with the choice, before the first frame, and keeps its size after it", empty0 && box0.h > 0 && Math.abs(box0.h - box1.h) < 0.5 && Math.abs(box0.w - box1.w) < 0.5, JSON.stringify({ box0, box1, empty0 }));
	// One row of six left each slice 1/12 of the box width tall (about 30 px
	// at 378); the two halves, three over three, give each twice that.
	const xlRows = await shotRows();
	const xlSlices = xlRows.flatMap((row) => row.slices);
	check(
		"preview (+ XL): the strip's two halves, dials 1 to 3 above dials 4 to 6, each a 6:1 row as wide as the box",
		xlRows.length === 2 && same(xlRows[0].columns, [0, 1, 2]) && same(xlRows[1].columns, [3, 4, 5]) && xlRows.every((row) => Math.abs(row.w / row.h - 6) < 0.1 && Math.abs(row.w - xlRows.box.w) < 0.5) && xlRows[1].top >= xlRows[0].bottom + 1,
		JSON.stringify({ rows: xlRows, box: xlRows.box })
	);
	check(
		"preview (+ XL): six equal 2:1 slices, no gap inside a row, each twice as tall as in one row of six",
		Math.max(...xlSlices.map((s) => s.w)) - Math.min(...xlSlices.map((s) => s.w)) < 0.05 && xlSlices.every((s) => Math.abs(s.w / s.h - 2) < 0.05 && Math.abs(s.h - xlRows.box.w / 6) < 0.5) && xlRows.every((row) => Math.abs(row.slices.reduce((a, s) => a + s.w, 0) - row.w) < 1),
		JSON.stringify(xlSlices)
	);
	check("preview (+ XL): its spoken name says the left half is above the right half", (await b.evaluate(`document.getElementById("strip-shots").getAttribute("aria-label")`)) === "Preview of the new strip: 6 slices, the left half above the right half", await b.evaluate(`document.getElementById("strip-shots").getAttribute("aria-label")`));
	const xlState = stripState();
	check("preview (+ XL): the slices are the plugin's own draft slices", xlState?.preview?.kind === "draft" && xlState.preview.slices.length === 6 && xlState.preview.slices.every((svg) => svg.startsWith("<svg")), xlState?.preview?.kind);
	noWrites("preview");

	// ---- first run: one decision ------------------------------------------------------------
	const AMD_ROWS = ["CPU · Lanes · CPU (Tctl/Tdie), Total CPU Usage and CPU Package Power", "CPU cores · Group Tiles · 32 readings matching *core * t? usage", "GPU · Area with large values · GPU Temperature", "CPU and GPU · Compare · CPU (Tctl/Tdie) and GPU Temperature"];
	const creates0 = () => sim.piMessages.filter((m) => m.event === "sendToPlugin" && m.payload?.event === "stripCreate");
	{
		// An independent dial where the strip can be made: the section opens on
		// the list by itself, with everything ticked.
		const snap = groupSnapshot({ threads: 16 });
		sim.folds = new PanelFoldMemory();
		await open("dial-strip-xl", { snapshot: snap }, { fold: true });
		await waitFor("the section opened", () => b.evaluate(`document.getElementById("sec-strip").open`));
		check("first run: an independent dial opens the Strip section on Build's list, with nothing chosen", (await visible("strip-build-box")) && (await checked()) === "independent" && (await summary()) === "Independent dial" && !(await rowShown()));
		check("first run: nothing else asks for a choice: no preview, no bar", !(await visible("strip-preview")) && !(await visible("strip-bar")) && !(await visible("strip-edit")));
		const list = await listRows();
		check("first run: the title says what the button makes", (await text("strip-build-title")) === " · a Whole strip of 7 screens", await text("strip-build-title"));
		const firstStart = await startPick();
		check("first run: the title's first words are the start, a quiet dropdown: Screens for this PC, or One reading only", firstStart?.inBox === true && !firstStart.single && firstStart.value === "screens" && firstStart.text === "Screens for this PC" && same(firstStart.options, [["screens", "Screens for this PC"], ["one", "One reading only"]]) && (await b.evaluate(`document.getElementById("strip-build-head").firstElementChild?.id`)) === "strip-start-pick", JSON.stringify(firstStart));
		check("first run: seven screens from this PC's sensors, CPU and GPU among them", same(list.slice(0, 4), AMD_ROWS) && list.length === 7, JSON.stringify(list));
		check("first run: every screen is ticked", same((await listTicks()).map((x) => x[1]), [true, true, true, true, true, true, true]) && same((await listTicks()).map((x) => x[0]), ["cpu", "cores", "gpu", "cpu-gpu", "cooling", "clocks", "temps"]), JSON.stringify(await listTicks()));
		check("first run: one button, and its way out is in the dropdown, not a row of its own", (await text("strip-build-use")) === "Make the strip" && !(await visible("strip-build-no")) && !(await useDisabled()));
		{
			// One line per row: name, style and the start of the readings,
			// cut with an ellipsis, the whole line in the row's title; a hover
			// moves nothing.
			const rowsNow = await b.evaluate(`[...document.querySelectorAll("#strip-build-list label.hw-check")].map((row) => { const words = row.querySelector("input + span"); const cs = getComputedStyle(words); return { title: row.title, text: words.textContent, cut: words.scrollWidth > words.clientWidth + 0.5, ellipsis: cs.textOverflow === "ellipsis" && cs.whiteSpace === "nowrap", h: words.getBoundingClientRect().height, line: parseFloat(cs.lineHeight) }; })`);
			check("first run: each row of the list is one line, its whole text in its title", rowsNow.length === 7 && rowsNow.every((r) => r.title === r.text && r.ellipsis && r.h <= r.line + 0.5), JSON.stringify(rowsNow));
			const cut = rowsNow.findIndex((r) => r.cut);
			check("first run: a row too long for the line is cut with an ellipsis, and its title holds the whole row", cut >= 0 && rowsNow[cut].title === AMD_ROWS[cut], JSON.stringify(rowsNow.map((r) => [r.cut, r.title])));
			const all = () => b.evaluate(`[...document.querySelectorAll("#sec-strip *")].filter((e) => e.getClientRects().length > 0).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x * 10), Math.round(r.y * 10), Math.round(r.width * 10), Math.round(r.height * 10)].join(","); }).join("|")`);
			const still = await all();
			await b.hover(`#strip-build-list li:nth-child(${cut + 1}) label`);
			await sleep(200);
			check("first run: hovering a cut row moves nothing", (await all()) === still);
			await b.hover("#sec-strip > summary");
		}
		noWrites("first run");
		check("first run: no draft goes to the plugin before a layout is chosen", sim.strip.ctl.draftOf(sim.context) === undefined && sim.strip.ctl.memoOf(sim.context) === undefined && !sim.piMessages.some((m) => m.payload?.event === "stripGet" && "draft" in m.payload));
		// A fold the person chose stays.
		await b.click("#sec-strip > summary");
		await sleep(400);
		await open("dial-strip-xl", undefined, { keep: true, fold: true });
		await sleep(400);
		check("first run: a fold the person chose stays folded on the next panel", !(await b.evaluate(`document.getElementById("sec-strip").open`)));
		await b.click("#sec-strip > summary");
		await sleep(200);
		// A sensor list that comes again moves no box while it waits, and a
		// tick stays.
		await listTick("temps", false);
		const boxes = () => b.evaluate(`[...document.querySelectorAll("#sec-strip *")].filter((e) => e.getClientRects().length > 0).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x * 10), Math.round(r.y * 10), Math.round(r.width * 10), Math.round(r.height * 10)].join(","); }).join("|")`);
		const before = await boxes();
		await b.evaluate(`document.getElementById("picker-refresh").click()`);
		await sleep(2500);
		check("first run: live data and a reloaded sensor list move no box while the list waits, and a tick stays", (await boxes()) === before && (await listTicks()).find((x) => x[0] === "temps")?.[1] === false);
		await listTick("temps", true);
		// The one press.
		await b.click("#strip-build-use");
		await waitNote(/^The strip is made\./, 4000);
		await waitFor("running strip editor", () => visible("strip-edit"), 4000);
		const creates = creates0();
		check("first run: one press, one stripCreate, every screen in it, within the operation cap", creates.length === 1 && creates[0].payload.layout === "whole" && creates[0].payload.columns === "all" && creates[0].payload.patch.filter((op) => op.op === "addScreen").length === 6 && creates[0].payload.patch.length <= 40, JSON.stringify(creates.map((c) => c.payload.patch?.length)));
		const made = stored().config;
		const all = [made.panes[0], ...(made.screens ?? [])];
		check("first run: the plugin wrote seven screens, each with what made it and Build's label", same(all.map((x) => [x.origin, x.name]), [["cpu", "CPU"], ["cores", "CPU cores"], ["gpu", "GPU"], ["cpu-gpu", "CPU and GPU"], ["cooling", "Cooling"], ["clocks", "Core clocks"], ["temps", "Every temperature"]]), JSON.stringify(all.map((x) => [x.origin, x.name])));
		check("first run: CPU and GPU is a Compare of the two temperatures", all[3].style === "compare" && same(all[3].series.map((s) => s.key), [keyOf(snap, 0, "CPU (Tctl/Tdie)"), keyOf(snap, 1, "GPU Temperature")]), JSON.stringify(all[3]));
		check("first run: CPU cores stores a Group of the filter in the Tiles view, and the plugin takes the 32 per-thread usages", all[1].style === "group" && same(all[1].group, { from: "filter", filter: "*core * t? usage", keys: [], view: "tiles" }) && resolveGroup(snap, stripPaneOf(all[1])).sameUnit === 32, JSON.stringify(all[1]));
		await waitFor("seven screens listed", async () => (await b.evaluate(`document.querySelectorAll("#strip-screen-select option").length`)) === 7, 4000);
		check("first run: the running strip shows, the list gone, the layout Whole strip", !(await visible("strip-build-box")) && (await checked()) === "whole");
		check("first run: the panel wrote nothing itself", panelWrites() === 0);
		sim.folds = new PanelFoldMemory();
	}
	{
		// Ticks: what is ticked is what is made, and the title follows.
		await open("dial-strip-plus", { snapshot: groupSnapshot() });
		check("ticks: five readings here make six screens", (await text("strip-build-title")) === " · a Whole strip of 6 screens", await text("strip-build-title"));
		for (const id of ["cpu", "gpu", "cooling", "clocks", "temps"]) await listTick(id, false);
		check("ticks: one left says one screen", (await text("strip-build-title")) === " · a Whole strip of one screen" && !(await useDisabled()), await text("strip-build-title"));
		await listTick("cpu-gpu", false);
		check("ticks: none left says so, and Make the strip waits", (await text("strip-build-title")) === " · no screen ticked" && (await useDisabled()), await text("strip-build-title"));
		await b.click("#strip-build-use");
		await sleep(250);
		check("ticks: a press with none ticked sends nothing", creates0().length === 0);
		noWrites("ticks");
		// One pick: CPU against GPU alone, as the recipe made it.
		await listTick("cpu-gpu", true);
		await b.click("#strip-build-use");
		await waitNote(/^The strip is made\./, 4000);
		const made = stored().config;
		check("ticks: one pick makes a strip of the CPU and GPU Compare alone", creates0().at(-1).payload.patch.every((op) => op.op !== "addScreen") && made.panes[0].style === "compare" && made.panes[0].origin === "cpu-gpu" && made.panes[0].name === "CPU and GPU" && made.panes[0].series.length === 2 && (made.screens ?? []).length === 0, JSON.stringify(made.panes[0]));
	}
	{
		// A Whole strip chosen first: the same list, previewed; ticks redraw it.
		await open("dial-strip-plus", { snapshot: groupSnapshot() });
		await choose("whole");
		await waitCaption(/^Preview of the new strip$/);
		await waitShots(4);
		await sleep(200);
		const draft = lastGet()?.draft;
		check("build (new strip): Whole strip previews every screen ticked in one draft, never a setting", (await checked()) === "whole" && draft?.layout === "whole" && draft.patch.filter((op) => op.op === "addScreen").length === 5 && draft.patch.length <= 40, JSON.stringify(draft));
		const gets = () => sim.piMessages.filter((m) => m.payload?.event === "stripGet" && "draft" in m.payload).length;
		const getsBefore = gets();
		await sleep(1200);
		check("build (new strip): one draft per choice: pushes send no more", gets() === getsBefore, String(gets() - getsBefore));
		await listTick("cpu", false);
		await sleep(250);
		check("build (new strip): a tick changes the draft: the first screen ticked is the first screen", gets() === getsBefore + 1 && lastGet()?.draft?.patch.find((op) => op.path === "panes.0.origin")?.value === "gpu", JSON.stringify(lastGet()?.draft?.patch?.slice(0, 3)));
		await listTick("cpu", true);
		await sleep(200);
		noWrites("build (new strip)");
		await b.click("#strip-build-use");
		await waitNote(/^The strip is made\./, 4000);
		const creates = creates0();
		check("build (new strip): one stripCreate carries every screen", creates.length === 1 && creates[0].payload.layout === "whole" && creates[0].payload.patch.filter((op) => op.op === "addScreen").length === 5, JSON.stringify(creates.map((c) => c.payload.patch?.length)));
		const made = stored().config;
		check("build (new strip): the plugin wrote six screens, each with what made it and Build's own label", same([made.panes[0], ...(made.screens ?? [])].map((x) => [x.origin, x.name]), [["cpu", "CPU"], ["gpu", "GPU"], ["cpu-gpu", "CPU and GPU"], ["cooling", "Cooling"], ["clocks", "Core clocks"], ["temps", "Every temperature"]]) && made.panes[0].style === "lanes", JSON.stringify([made.panes[0], made.screens?.length]));
		await waitFor("six screens listed", async () => (await b.evaluate(`document.querySelectorAll("#strip-screen-select option").length`)) === 6, 4000);
		const named = await b.evaluate(`[...document.querySelectorAll("#strip-screen-select option")].map((o) => o.textContent)`);
		check("build (new strip): the list names each by Build's label, never a filter or a unit phrase, no two alike", same(named, ["CPU", "GPU", "CPU and GPU", "Cooling", "Core clocks", "Every temperature"]) && new Set(named).size === 6, JSON.stringify(named));
		check("build (new strip): the panel wrote nothing itself", panelWrites() === 0);
	}
	{
		// One reading only: today's single-reading strip, on the way back too.
		await open("dial-strip-plus");
		await b.evaluate(`document.getElementById("strip-start").focus()`);
		await setSelect("strip-start", "one");
		await waitCaption(/^Preview of the new strip$/);
		await waitShots(4);
		await sleep(200);
		check("one reading: One reading only, picked in the dropdown, chooses Whole strip and shows the preview with its own Make the strip", (await checked()) === "whole" && !(await visible("strip-build-box")) && (await visible("strip-bar")) && (await text("strip-go")) === "Make the strip" && same(lastGet()?.draft?.patch, []), JSON.stringify(lastGet()?.draft));
		const oneStart = await startPick();
		check("one reading: the dropdown stands in the caption's place, on the caption's line, and Make the strip is alone in its bar", oneStart?.onCaption === true && oneStart.value === "one" && oneStart.text === "One reading only" && !(await visible("strip-caption")) && Math.abs((await caplineHeight()) - CAPLINE) < 0.2 && (await b.evaluate(`[...document.querySelectorAll("#strip-bar > *")].filter((e) => e.getClientRects().length > 0).length`)) === 1, JSON.stringify([oneStart, await caplineHeight()]));
		check("one reading: focus stays on the dropdown", (await b.evaluate(`document.activeElement?.id`)) === "strip-start");
		noWrites("one reading");
		// The way back.
		await setSelect("strip-start", "screens");
		await sleep(250);
		check("one reading: Screens for this PC brings the list back, ticked, the dropdown at its head, and the draft with it", (await visible("strip-build-box")) && !(await visible("strip-bar")) && (await listTicks()).every((x) => x[1]) && lastGet()?.draft?.patch.length > 0 && (await startPick())?.inBox === true && (await visible("strip-caption")) && (await b.evaluate(`document.activeElement?.id`)) === "strip-start");
		await setSelect("strip-start", "one");
		await sleep(250);
		const before = docsNow();
		await b.click("#strip-go");
		await waitNote(/^The strip is made\./, 4000);
		await waitFor("running strip editor", () => visible("strip-edit"));
		const creates = creates0();
		check("one reading: one stripCreate with no patch makes the strip of this dial's reading, every dial's own fields untouched", creates.length === 1 && creates[0].payload.patch === undefined && (stored().config.screens ?? []).length === 0 && same(await series(0), ["GPU Temperature · °C"]) && sim.strip.pluginWrites.every((w) => same(changedKeys(before[w.context], w.doc), ["stripGroup"])), JSON.stringify(creates.map((c) => c.payload)));
	}
	{
		// A PC with no GPU: the list says only what is here. A PC where nothing
		// fits has no list: today's path.
		const noGpu = sampleSnapshot();
		noGpu.readings = noGpu.readings.filter((r) => noGpu.sensors[r.sensorIndex]?.name.startsWith("GPU") !== true);
		noGpu.byKey = new Map(noGpu.readings.map((r) => [r.key, r]));
		await open("dial-strip-plus", { snapshot: noGpu });
		const rows = await listRows();
		check("first run: with no GPU there is no GPU screen and no CPU and GPU", !rows.some((row) => /^(GPU|CPU and GPU) ·/.test(row)) && rows.some((row) => row.startsWith("CPU ·")), JSON.stringify(rows));
		const nothing = sampleSnapshot();
		nothing.readings = nothing.readings.filter((r) => r.unit === "Yes/No");
		nothing.byKey = new Map(nothing.readings.map((r) => [r.key, r]));
		await open("dial-strip-plus", { snapshot: nothing });
		check("first run: where nothing fits a screen there is no list, and no reveal asks anything", !(await visible("strip-build-box")));
		await choose("whole");
		await waitCaption(/^Preview of the new strip$/);
		check("first run: where nothing fits a screen, Whole strip is the plain path: no list, and with no other start nothing new shows, the caption stays", !(await visible("strip-build-box")) && (await visible("strip-bar")) && (await startPick()) === null && (await visible("strip-caption")));
		noWrites("first run (nothing fits)");
	}

	// ---- build (CPU cores): a PC that lists every thread's usage ---------------------------
	{
		const snap = groupSnapshot({ threads: 16 });
		await open("dial-strip-plus", { snapshot: snap });
		await choose("whole");
		await waitCaption(/^Preview of the new strip$/);
		await sleep(250);
		const draft = lastGet()?.draft;
		check("build (CPU cores): Whole strip previews every screen in one draft within the operation cap", draft?.patch.filter((op) => op.op === "addScreen").length === 6 && draft.patch.length <= 40, JSON.stringify(draft?.patch?.length));
		await waitShots(4);
		noWrites("build (CPU cores)");
		await b.click("#strip-build-use");
		await waitNote(/^The strip is made\./, 4000);
		const made = stored().config;
		const all = [made.panes[0], ...(made.screens ?? [])];
		const taken = resolveGroup(snap, stripPaneOf(all[1]));
		const labels = taken.keys.map((key) => snap.byKey.get(key)?.label);
		check("build (CPU cores): the plugin takes the 32 per-thread usages and nothing else", taken.sameUnit === 32 && labels.every((label) => /^Core \d+ T\d Usage$/.test(label ?? "")), JSON.stringify(labels.filter((label) => !/^Core \d+ T\d Usage$/.test(label ?? ""))));
		check("build (CPU cores): the panel wrote nothing itself", panelWrites() === 0);
	}

	// ---- starts: an Equal split's pairs, Fill both halves (the owner's pick C, 2026-11-06) ----------
	{
		const snap = sampleSnapshot();
		const CPU = keyOf(snap, 0, "CPU (Tctl/Tdie)");
		const GPU = keyOf(snap, 1, "GPU Temperature");
		const USAGE = keyOf(snap, 0, "Total CPU Usage");
		const LOAD = keyOf(snap, 1, "GPU Core Load");
		const PAIRS = [
			["cpu-gpu", "CPU and GPU"],
			["temp-load", "Temperature and load"],
			["cpu-cooling", "CPU and cooling"]
		];
		const CPU_GPU = [
			["area", "left", [CPU]],
			["area", "left", [GPU]]
		];
		const TEMP_LOAD = [
			["compare", "off", [CPU, GPU]],
			["compare", "off", [USAGE, LOAD]]
		];
		const drafts = () => sim.piMessages.filter((m) => m.payload?.event === "stripGet" && "draft" in m.payload).length;

		// Equal split being made: the first pair that fits is the pick.
		await open("dial-strip-plus");
		await choose("split");
		await waitCaption(/^Preview of the new strip$/);
		await waitShots(4);
		await sleep(250);
		const made = await startPick();
		check("split (being made): the words in the caption's place are a quiet dropdown of this PC's pairs and Choose each half, the first pair picked", made?.onCaption === true && !made.single && same(made.options, [...PAIRS, ["own", "Choose each half"]]) && made.value === "cpu-gpu" && made.text === "CPU and GPU" && !(await visible("strip-caption")), JSON.stringify(made));
		check("split (being made): the dropdown keeps the caption's line, one line high", Math.abs((await caplineHeight()) - CAPLINE) < 0.2, String(await caplineHeight()));
		check("split (being made): the default pair is the one draft: CPU and GPU, each temperature large beside its graph", lastGet()?.draft?.layout === "split" && same(draftHalves(lastGet().draft.patch), CPU_GPU), JSON.stringify(lastGet()?.draft));
		const g0 = drafts();
		await setSelect("strip-start", "temp-load");
		await sleep(300);
		check("split (being made): a pick is one draft and redraws the preview: Temperature and load is a Compare of the temperatures and one of the loads", drafts() === g0 + 1 && same(draftHalves(lastGet().draft.patch), TEMP_LOAD) && (await startPick())?.text === "Temperature and load" && stripState()?.preview?.kind === "draft", JSON.stringify(lastGet()?.draft?.patch));
		await setSelect("strip-start", "cpu-cooling");
		await sleep(300);
		check("split (being made): CPU and cooling is Lanes of the CPU, and Group Now of the four fans (more than a half's two dials)", same(draftHalves(lastGet().draft.patch)[0], ["lanes", "off", [CPU, USAGE, keyOf(snap, 0, "CPU Package Power")]]) && lastGet().draft.patch.some((op) => op.path === "panes.1.group" && op.value?.from === "unit" && op.value.unit === "RPM" && op.value.view === "now"), JSON.stringify(lastGet()?.draft?.patch));
		await setSelect("strip-start", "own");
		await sleep(300);
		check("split (being made): Choose each half is the start before there were pairs: no operations", same(lastGet()?.draft?.patch, []) && (await startPick())?.value === "own");
		noWrites("split (being made)");
		// A pick follows the person to another dial, as Build's ticks do.
		await setSelect("strip-start", "temp-load");
		await sleep(400);
		sim.strip.openMember(3);
		await open("dial-strip-plus", undefined, { keep: true });
		await waitFor("the remembered split", async () => (await checked()) === "split", 4000);
		await sleep(300);
		check("memory (split): the pair picked on one dial is the pick on the next, previewed there", (await startPick())?.value === "temp-load" && same(draftHalves(lastGet()?.draft?.patch), TEMP_LOAD), JSON.stringify([await startPick(), lastGet()?.draft]));
		await setSelect("strip-start", "own");
		await sleep(400);
		sim.strip.openMember(1);
		await open("dial-strip-plus", undefined, { keep: true });
		await waitFor("the remembered split", async () => (await checked()) === "split", 4000);
		await sleep(300);
		check("memory (split): Choose each half follows too", (await startPick())?.value === "own" && same(lastGet()?.draft?.patch, []), JSON.stringify([await startPick(), lastGet()?.draft]));
		noWrites("memory (split)");
		// One press: the default pair, made.
		await choose("independent");
		await sleep(250);
		await open("dial-strip-plus");
		await choose("split");
		await waitCaption(/^Preview of the new strip$/);
		await sleep(250);
		await b.click("#strip-go");
		await waitNote(/^The strip is made\./, 4000);
		const madeSplit = sim.piMessages.filter((m) => m.event === "sendToPlugin" && m.payload?.event === "stripCreate");
		check("split (one press): Make the strip makes the default pair: one stripCreate of an Equal split, both halves drawn by the plugin", madeSplit.length === 1 && madeSplit[0].payload.layout === "split" && same(storedHalves(stored().config), CPU_GPU) && (stored().config.screens ?? []).length === 0 && panelWrites() === 0, JSON.stringify([madeSplit.map((c) => c.payload), stored()?.config?.panes]));
		await waitFor("running split", () => visible("strip-edit"), 4000);
		await waitCaption(/^On the deck now/);
		check("split (one press): the strip it made draws CPU and GPU, so Fill offers the other two", same((await fillState()).options, [["", "Fill both halves"], ...PAIRS.slice(1)]), JSON.stringify(await fillState()));
	}
	{
		// A running Equal split that holds nothing a person made (this dial's
		// reading in Trend on the left, as a new strip starts, and an empty
		// right half): Fill both halves previews with no write, Cancel writes
		// nothing, and Use writes once with no question.
		const snap = sampleSnapshot();
		const CPU = keyOf(snap, 0, "CPU (Tctl/Tdie)");
		const GPU = keyOf(snap, 1, "GPU Temperature");
		const member = sim.fixtures["dial-strip-member"].strip;
		await open("dial-strip-member", { strip: { ...member, create: { layout: "split", from: 1 } } });
		await waitCaption(/^On the deck now/);
		const fill0 = await fillState();
		check("fill: a running Equal split names Fill both halves on the caption's line, its pairs in a quiet dropdown, the caption kept", fill0.shown && fill0.value === "" && fill0.text === "Fill both halves" && same(fill0.options, [["", "Fill both halves"], ["cpu-gpu", "CPU and GPU"], ["temp-load", "Temperature and load"], ["cpu-cooling", "CPU and cooling"]]) && !fill0.use && !fill0.cancel && (await visible("strip-caption")) && Math.abs((await caplineHeight()) - CAPLINE) < 0.2, JSON.stringify(fill0));
		const edits0 = edits().length;
		const writes0 = pluginWrites();
		const rev0 = stored().rev;
		const kept0 = JSON.stringify(stored());
		await setSelect("strip-fill", "cpu-gpu");
		await waitCaption(/^Preview only$/);
		await waitFor("the pair's preview", async () => stripState()?.preview?.kind === "draft", 3000);
		const armed = await fillState();
		check("fill: a pair picked is a preview only: Use and Cancel beside it on the same line, no stripEdit, no write", armed.use && armed.cancel && armed.text === "CPU and GPU" && edits().length === edits0 && pluginWrites() === writes0 && panelWrites() === 0 && lastGet()?.draft?.baseRev === rev0 && same(draftHalves(lastGet().draft.patch), [["area", "left", [CPU]], ["area", "left", [GPU]]]) && Math.abs((await caplineHeight()) - CAPLINE) < 0.2, JSON.stringify([armed, lastGet()?.draft]));
		await b.click("#strip-fill-cancel");
		await waitCaption(/^On the deck now/);
		await sleep(200);
		check("fill: Cancel discards it: no stripEdit, no write, the plugin's draft dropped and the strip on the deck shown again", edits().length === edits0 && pluginWrites() === writes0 && panelWrites() === 0 && lastGet()?.draft === null && sim.strip.ctl.draftOf(sim.context) === undefined && stripState()?.preview?.kind === "live" && !(await fillState()).use && stored().rev === rev0, JSON.stringify({ edits: edits().length - edits0, writes: pluginWrites() - writes0, draft: lastGet()?.draft }));
		check("fill: the preview and its Cancel leave the stored strip byte for byte as it was", JSON.stringify(stored()) === kept0);
		check("fill: focus goes back to the dropdown", (await b.evaluate(`document.activeElement?.id`)) === "strip-fill", await b.evaluate(`document.activeElement?.id`));
		await setSelect("strip-fill", "temp-load");
		await waitCaption(/^Preview only$/);
		await b.click("#strip-fill-use");
		await settled(edits0 + 1);
		const sent = edits().slice(edits0);
		check("fill: over halves that hold nothing a person made, Use is one stripEdit against the revision shown, written once to every dial, both halves the pair, and no question", sent.length === 1 && sent[0].baseRev === rev0 && stored().rev === rev0 + 1 && same(storedHalves(stored().config), [["compare", "off", [CPU, GPU]], ["compare", "off", [keyOf(snap, 0, "Total CPU Usage"), keyOf(snap, 1, "GPU Core Load")]]]) && pluginWrites() === writes0 + 4 && panelWrites() === 0 && !(await askState()).shown && !sent[0].patch.some((op) => /\.(name|origin)$/.test(op.path)), JSON.stringify({ sent, halves: storedHalves(stored().config), ask: await askState() }));
		await waitCaption(/^On the deck now/);
		check("fill: after Use the strip on the deck shows, and the pair it now draws is no longer offered", stripState()?.preview?.kind === "live" && !(await fillState()).use && same((await fillState()).options.map((o) => o[0]), ["", "cpu-gpu", "cpu-cooling"]), JSON.stringify(await fillState()));
		// A pair's halves are Fill's own: the next pair goes over them with no
		// question either.
		const edits1 = edits().length;
		await setSelect("strip-fill", "cpu-gpu");
		await waitCaption(/^Preview only$/);
		await b.click("#strip-fill-use");
		await settled(edits1 + 1);
		check("fill: over a pair's own halves Use writes at once, no question", edits().length === edits1 + 1 && !(await askState()).shown && same(storedHalves(stored().config), [["area", "left", [CPU]], ["area", "left", [GPU]]]), JSON.stringify(await askState()));
		// Another dial's panel changed the strip first (its state held back
		// here): Use is refused, and what the other panel wrote stays.
		await setSelect("strip-fill", "cpu-cooling");
		await waitCaption(/^Preview only$/);
		const shownRev = stored().rev;
		sim.strip.editFrom(0, [{ op: "addScreen", at: 1, from: "group" }], { hold: true });
		const kept = structuredClone(stored().config);
		const edits2 = edits().length;
		await b.click("#strip-fill-use");
		await waitNote(/^Another dial's panel changed this strip first\. Try again\.$/, 4000);
		sim.strip.holdState = false;
		await sleep(300);
		check("fill (stale): Use against an older revision is refused, and the screen the other panel added is as it was", edits().length === edits2 + 1 && edits().at(-1).baseRev === shownRev && sameContent(stored().config, kept) && (kept.screens ?? []).length === 1, JSON.stringify({ sent: edits().slice(edits2), screens: stored().config.screens?.length }));
		// A new strip made from dial 1, opened on dial 2's panel: its left half
		// is the reading a strip from dial 1 starts with, so here too Use
		// writes at once with no question.
		await open("dial-strip-member", { strip: { ...member, create: { layout: "split", from: 0 } } });
		await waitCaption(/^On the deck now/);
		await setSelect("strip-fill", "cpu-gpu");
		await waitCaption(/^Preview only$/);
		const edits3 = edits().length;
		await b.evaluate(`document.getElementById("strip-fill-use").focus()`);
		await b.key("Enter");
		await settled(edits3 + 1).catch(() => {});
		check("fill (another dial's panel): an untouched new strip made from dial 1 takes the pair from dial 2's panel at once, with no question", edits().length === edits3 + 1 && !(await askState()).shown && same(storedHalves(stored().config), [["area", "left", [CPU]], ["area", "left", [GPU]]]), JSON.stringify({ ask: await askState(), edits: edits().length - edits3 }));
	}
	{
		// Fill over work a person made: the Whole strip's screens no longer
		// hide it, and Use asks first in words, with Cancel focused; only
		// Replace writes, once, from the copy it asked about.
		const snap = sampleSnapshot();
		const CPU = keyOf(snap, 0, "CPU (Tctl/Tdie)");
		const GPU = keyOf(snap, 1, "GPU Temperature");
		const POWER = keyOf(snap, 0, "CPU Package Power");
		const CPU_GPU = [
			["area", "left", [CPU]],
			["area", "left", [GPU]]
		];
		const member = sim.fixtures["dial-strip-member"].strip;
		const RIGHT_ASK = "Replace the right half, 'CPU (Tctl/Tdie) +1'?";
		const WHOLE_LINE = "This also changes the Whole strip's first screen.";
		/** dial-strip-member: this dial's reading on the left, the right half
		 * Lanes of the CPU and its power, built by hand. */
		const openRight = async () => {
			await open("dial-strip-member");
			await waitCaption(/^On the deck now/);
			await setSelect("strip-fill", "cpu-gpu");
			await waitCaption(/^Preview only$/);
			await waitFor("the pair's preview", async () => stripState()?.preview?.kind === "draft", 3000);
		};
		/** Use from the keyboard, as a person tabbing through the panel. */
		const useByKey = async () => {
			await b.evaluate(`document.getElementById("strip-fill-use").focus()`);
			await b.key("Enter");
			await waitFor("the question", async () => (await askState()).shown, 2000).catch(() => {});
		};
		const sectionBoxes = () => b.evaluate(`[...document.querySelectorAll("#sec-strip *")].filter((e) => e.getClientRects().length > 0).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x * 10), Math.round(r.y * 10), Math.round(r.width * 10), Math.round(r.height * 10)].join(","); }).join(";")`);

		// Screens kept for the Whole strip, a built screen: Fill shows on each.
		await open("dial-strip-member", { strip: { ...member, create: { layout: "split", from: 1, patch: [...member.create.patch, { op: "addScreen", at: 1, from: "group" }] } } });
		await waitCaption(/^On the deck now/);
		check("fill (screens kept): a split that keeps a Whole strip's screens offers Fill both halves", (await fillState()).shown && (await fillState()).options.length === 4, JSON.stringify(await fillState()));
		await open("dial-strip-member", { strip: { ...member, create: { layout: "split", from: 1, patch: [...member.create.patch, { op: "set", path: "panes.0.origin", value: "gpu" }, { op: "set", path: "panes.0.name", value: "GPU" }] } } });
		await waitCaption(/^On the deck now/);
		check("fill (a built screen): a left half Build made and named offers Fill both halves", (await fillState()).shown, JSON.stringify(await fillState()));

		// The right half built by hand.
		await openRight();
		let edits0 = edits().length;
		let writes0 = pluginWrites();
		let kept0 = JSON.stringify(stored());
		const capline0 = await caplineHeight();
		await useByKey();
		let ask = await askState();
		check("ask (right half): Use asks first: the half by its place and its name, and the Whole strip's first screen, as the start on the left changes too; Cancel focused with its ring, Use and the line's Cancel stepped aside, nothing sent", ask.shown && ask.text === RIGHT_ASK && ask.also === WHOLE_LINE && ask.focus === "strip-fill-no" && ask.ring && !ask.use && !ask.capCancel && edits().length === edits0 && pluginWrites() === writes0 && panelWrites() === 0 && Math.abs((await caplineHeight()) - capline0) < 0.2, JSON.stringify(ask));
		check("ask: the question is a labelled group, its words the group's name and the Whole strip's line its description", (await b.evaluate(`(() => { const box = document.getElementById("strip-fill-ask"); return box.getAttribute("role") === "group" && box.getAttribute("aria-describedby") === "strip-fill-also" && document.getElementById(box.getAttribute("aria-labelledby"))?.textContent; })()`)) === RIGHT_ASK);
		const live0 = await sectionBoxes();
		await sleep(2300);
		check("ask: pushes move no box while it is open", live0 === (await sectionBoxes()) && (await askState()).shown);
		await b.key("Enter");
		await sleep(150);
		ask = await askState();
		check("ask: Cancel closes it with no write, back on the preview, focus on Use", !ask.shown && ask.focus === "strip-fill-use" && ask.use && stripState()?.preview?.kind === "draft" && edits().length === edits0 && pluginWrites() === writes0 && JSON.stringify(stored()) === kept0, JSON.stringify(ask));
		await useByKey();
		await b.key("Escape");
		await sleep(150);
		ask = await askState();
		check("ask: Escape closes it with no write, focus on Use", !ask.shown && ask.focus === "strip-fill-use" && edits().length === edits0 && pluginWrites() === writes0, JSON.stringify(ask));
		await useByKey();
		await b.key("Tab", { shift: true });
		await sleep(150);
		ask = await askState();
		check("ask: focus leaving it closes it with no write, and focus stays where it went", !ask.shown && ask.focus !== null && ask.focus !== "strip-fill-no" && ask.focus !== "strip-fill-yes" && ask.use && edits().length === edits0 && pluginWrites() === writes0 && JSON.stringify(stored()) === kept0, JSON.stringify(ask));
		// Whole and Equal while it is open: the layout goes alone.
		await useByKey();
		const edits1 = edits().length;
		await choose("whole");
		await settled(edits1 + 1);
		check("ask: choosing Whole strip while it is open closes it; the one stripEdit is the layout alone", !(await askState()).shown && edits().length === edits1 + 1 && same(edits().at(-1).patch, [{ op: "set", path: "layout", value: "whole" }]) && same(storedHalves(stored().config)[1], ["lanes", "off", [CPU, POWER]]), JSON.stringify(edits().slice(edits1)));
		await choose("split");
		await settled(edits1 + 2);
		check("ask: back on Equal split nothing of Fill was written: the right half is still the Lanes built by hand", same(edits().at(-1).patch, [{ op: "set", path: "layout", value: "split" }]) && same(storedHalves(stored().config)[1], ["lanes", "off", [CPU, POWER]]) && !(await askState()).shown, JSON.stringify(stored().config.panes[1]));
		// At the narrow panel's widths it wraps, with nothing past the edge and
		// Cancel's ring inside it.
		await setSelect("strip-fill", "cpu-gpu");
		await waitCaption(/^Preview only$/);
		for (const width of [378, 189]) {
			await b.viewport(width, 900);
			await sleep(150);
			await useByKey();
			const fit = JSON.parse(await b.evaluate(`JSON.stringify((() => { const box = document.getElementById("strip-fill-ask"); const c = document.getElementById("strip-fill-no"); const y = document.getElementById("strip-fill-yes"); const r = box.getBoundingClientRect(); const cr = c.getBoundingClientRect(); const yr = y.getBoundingClientRect(); const w = document.documentElement.clientWidth; const t = document.getElementById("strip-fill-ask-text"); return { page: document.documentElement.scrollWidth - w, box: box.scrollWidth - box.clientWidth, right: Math.max(r.right, cr.right + 3, yr.right) - w, left: Math.min(r.left, cr.left - 3), lines: Math.round(t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight)) }; })())`));
			ask = await askState();
			check(`ask (${width} px): it wraps with nothing past the panel's edge, and Cancel's focus ring shows inside it`, ask.shown && ask.ring && fit.page <= 0 && fit.box <= 0 && fit.right <= 0 && fit.left >= 0 && (width > 300 || fit.lines >= 2), JSON.stringify({ fit, ask }));
			await b.key("Escape");
			await sleep(100);
		}
		// A name with no place to break wraps inside the question too.
		const LONG = "CPU_overview_power_clocks_temperatures_and_fans_for_gaming_night";
		await open("dial-strip-member", { strip: { ...member, create: { layout: "split", from: 1, patch: [{ op: "set", path: "panes.0.style", value: "lanes" }, { op: "set", path: "panes.0.series", value: [{ key: CPU }, { key: POWER }] }, { op: "set", path: "panes.0.name", value: LONG }] } } });
		await waitCaption(/^On the deck now/);
		await setSelect("strip-fill", "cpu-gpu");
		await waitCaption(/^Preview only$/);
		await useByKey();
		const long = JSON.parse(await b.evaluate(`JSON.stringify((() => { const t = document.getElementById("strip-fill-ask-text"); const w = document.documentElement.clientWidth; return { text: t.textContent, over: t.scrollWidth - t.clientWidth, right: t.getBoundingClientRect().right - w, page: document.documentElement.scrollWidth - w }; })())`));
		check("ask (189 px): a name with no place to break wraps inside the question, the closing quote and question mark inside the panel", long.text === `Replace the left half, '${LONG}'?` && long.over <= 0 && long.right <= 0 && long.page <= 0, JSON.stringify(long));
		await b.key("Escape");
		await b.viewport(400, 900);
		await sleep(150);

		// Tab reaches Replace, and Enter there writes once.
		await openRight();
		edits0 = edits().length;
		writes0 = pluginWrites();
		const rev0 = stored().rev;
		const before = structuredClone(stored().config);
		await useByKey();
		await b.key("Tab");
		check("ask: Tab goes from Cancel to Replace", (await askState()).focus === "strip-fill-yes");
		await b.key("Enter");
		await settled(edits0 + 1);
		const sent = edits().slice(edits0);
		const after = stored().config;
		check("replace: Enter on Replace is one stripEdit against the revision it asked about, written once to every dial; both halves the pair", sent.length === 1 && sent[0].baseRev === rev0 && stored().rev === rev0 + 1 && pluginWrites() === writes0 + 4 && same(storedHalves(after), CPU_GPU) && panelWrites() === 0, JSON.stringify({ sent, halves: storedHalves(after) }));
		check("replace: what Fill does not write is as it was: each half's look, scale and window, and the strip's own fields", same(after.panes.map((p) => [p.overlays, p.scale, p.window ?? null]), before.panes.map((p) => [p.overlays, p.scale, p.window ?? null])) && sameContent({ ...after, panes: null }, { ...before, panes: null }), JSON.stringify([after.panes.map((p) => p.overlays), before.panes.map((p) => p.overlays)]));
		await waitCaption(/^On the deck now/);
		check("replace: the question is gone, the strip on the deck shows, focus on the dropdown", !(await askState()).shown && (await b.evaluate(`document.activeElement?.id`)) === "strip-fill" && stripState()?.preview?.kind === "live", JSON.stringify(await askState()));

		// A double click on Use asks and does nothing more; Replace pressed
		// twice writes once.
		await openRight();
		edits0 = edits().length;
		writes0 = pluginWrites();
		const dbl = async (selector) => {
			const p = JSON.parse(await b.evaluate(`JSON.stringify((() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`));
			for (const clickCount of [1, 2]) {
				await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount });
				await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount });
			}
		};
		/** One press of the mouse at a point, the `clickCount`th of a run. */
		const pressAt = async (p, clickCount) => {
			await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount });
			await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount });
		};
		const centerOf = async (selector) => JSON.parse(await b.evaluate(`JSON.stringify((() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`));
		await dbl("#strip-fill-use");
		await sleep(600);
		ask = await askState();
		check("ask: a double click on Use asks once and writes nothing", ask.shown && ask.focus === "strip-fill-no" && edits().length === edits0 && pluginWrites() === writes0, JSON.stringify(ask));
		await dbl("#strip-fill-no");
		await sleep(600);
		ask = await askState();
		check("ask: a double click on its Cancel closes it once; the second click takes no control below (the Window row moved up under it), focus on Use", !ask.shown && ask.focus === "strip-fill-use" && edits().length === edits0 && pluginWrites() === writes0, JSON.stringify(ask));
		// At 189 px with the caption's line at the foot of the panel, the
		// question opening scrolls the page under a resting pointer: the
		// second click of a double click on Use lands on what moved there
		// (Replace), presses nothing and moves no focus.
		await b.viewport(189, 600);
		await sleep(150);
		const rest = JSON.parse(await b.evaluate(`JSON.stringify((() => { const line = document.getElementById("strip-capline").getBoundingClientRect(); window.scrollBy(0, line.bottom + 16 - window.innerHeight); const r = document.getElementById("strip-fill-use").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`));
		await pressAt(rest, 1);
		const under = await b.evaluate(`(() => { const e = document.elementFromPoint(${rest.x}, ${rest.y}); return e?.closest("button")?.id || e?.id || e?.tagName || null; })()`);
		await pressAt(rest, 2);
		await sleep(600);
		ask = await askState();
		check("ask (189 px, scrolled): a double click on Use whose second click lands on what the opening question scrolled under the pointer presses nothing, and Cancel keeps focus", ask.shown && ask.focus === "strip-fill-no" && edits().length === edits0 && pluginWrites() === writes0, JSON.stringify({ under, ask }));
		await b.viewport(400, 900);
		await b.evaluate(`document.getElementById("strip-fill-yes").scrollIntoView({ block: "nearest" })`);
		await sleep(600);
		await dbl("#strip-fill-yes");
		await settled(edits0 + 1);
		await sleep(300);
		check("replace: Replace pressed twice writes once, the question is gone after the first, and the second click takes no control below: focus on the dropdown", edits().length === edits0 + 1 && pluginWrites() === writes0 + 4 && !(await askState()).shown && same(storedHalves(stored().config), CPU_GPU) && (await b.evaluate(`document.activeElement?.id`)) === "strip-fill", JSON.stringify({ edits: edits().length - edits0, writes: pluginWrites() - writes0, focus: await b.evaluate(`document.activeElement?.id`) }));
		// A slow second press (a single click, past a short double-click
		// time) where Use was: the question took that place, and the press
		// takes nothing there. At 189 px scrolled, Replace lands under it.
		for (const [width, height, scrolled] of [
			[400, 900, false],
			[189, 600, true]
		]) {
			await openRight();
			await b.viewport(width, height);
			await sleep(150);
			edits0 = edits().length;
			writes0 = pluginWrites();
			const at = JSON.parse(await b.evaluate(`JSON.stringify((() => { const use = document.getElementById("strip-fill-use"); if (${scrolled}) { const line = document.getElementById("strip-capline").getBoundingClientRect(); window.scrollBy(0, line.bottom + 16 - window.innerHeight); } else use.scrollIntoView({ block: "center" }); const r = use.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`));
			await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
			await sleep(100);
			await pressAt(at, 1);
			await sleep(300);
			const under = await b.evaluate(`(() => { const e = document.elementFromPoint(${at.x}, ${at.y}); return e?.closest("button")?.id || e?.id || e?.tagName || null; })()`);
			await pressAt(at, 1);
			await sleep(600);
			ask = await askState();
			check(`ask (${width} px${scrolled ? ", scrolled" : ""}): a single press 300 ms after Use, where Use was, presses nothing: the question stays, Cancel keeps focus, nothing written`, ask.shown && ask.focus === "strip-fill-no" && edits().length === edits0 && pluginWrites() === writes0, JSON.stringify({ under, ask, sent: edits().length - edits0 }));
		}
		await b.viewport(400, 900);
		await sleep(150);

		// A number typed, then Use by the mouse: the number goes first, and
		// the question opens over the copy that answers it, and stays.
		await openRight();
		await b.evaluate(`document.getElementById("sec-stripmore").open = true`);
		await sleep(150);
		edits0 = edits().length;
		await b.evaluate(`(() => { const f = document.getElementById("sp0-min"); f.scrollIntoView({ block: "center" }); f.focus(); f.value = ""; })()`);
		await b.type("12");
		await pressAt(await centerOf("#strip-fill-use"), 1);
		await sleep(700);
		ask = await askState();
		const typedRev = stored().rev;
		check("ask (after a typed number): the number goes first as its own stripEdit, then the question opens over the copy that answers it and stays, Cancel focused, nothing of Fill sent", ask.shown && ask.focus === "strip-fill-no" && edits().length === edits0 + 1 && stored().config.panes[0].scale?.min === 12 && edits().slice(edits0).every((e) => !e.patch.some((op) => op.path === "panes.1.style")), JSON.stringify({ ask, sent: edits().slice(edits0).map((e) => e.patch.map((op) => op.path)) }));
		await b.key("Tab");
		await b.key("Enter");
		await settled(edits0 + 2).catch(() => {});
		check("replace (after a typed number): Replace goes against the copy with the number, and the number stays", edits().length === edits0 + 2 && edits().at(-1).baseRev === typedRev && stored().config.panes[0].scale?.min === 12 && same(storedHalves(stored().config), CPU_GPU), JSON.stringify({ sent: edits().slice(edits0).map((e) => e.baseRev), scale: stored().config.panes[0].scale }));
		await b.evaluate(`document.getElementById("sec-stripmore").open = false`);

		// Another dial's panel changes the strip while it asks: the question
		// goes with nothing written, and the status line says why.
		await openRight();
		await useByKey();
		edits0 = edits().length;
		sim.strip.editFrom(0, [{ op: "set", path: "panes.1.overlays.minmax", value: true }]);
		await waitFor("the question to go", async () => !(await askState()).shown, 3000).catch(() => {});
		await sleep(200);
		ask = await askState();
		check("ask (changed elsewhere): a newer copy from another dial's panel closes it with nothing written, the status line says so, and focus is on Use", !ask.shown && ask.focus === "strip-fill-use" && (await note()) === "Another dial's panel changed this strip first. Try again." && edits().length === edits0 && stored().config.panes[1].overlays?.minmax === true, JSON.stringify({ ask, note: await note() }));

		// Another dial's panel changed the strip first (its state held back
		// here): Replace is refused by the plugin, and that change stays.
		await openRight();
		await useByKey();
		edits0 = edits().length;
		const askedRev = stored().rev;
		sim.strip.editFrom(0, [{ op: "set", path: "panes.1.overlays.minmax", value: true }], { hold: true });
		const kept = structuredClone(stored().config);
		await b.key("Tab");
		await b.key("Enter");
		await waitNote(/^Another dial's panel changed this strip first\. Try again\.$/, 4000);
		sim.strip.holdState = false;
		await sleep(300);
		check("replace (stale): the plugin refuses it, and the other panel's change stays with the right half as it was", edits().length === edits0 + 1 && edits().at(-1).baseRev === askedRev && sameContent(stored().config, kept) && kept.panes[1].overlays?.minmax === true && same(storedHalves(stored().config)[1], ["lanes", "off", [CPU, POWER]]) && !(await askState()).shown, JSON.stringify({ sent: edits().slice(edits0).map((e) => e.baseRev), pane: stored().config.panes[1] }));

		// A refused write: the existing refusal note, nothing changed.
		await openRight();
		await useByKey();
		edits0 = edits().length;
		writes0 = pluginWrites();
		kept0 = JSON.stringify(stored());
		const real = sim.strip.request;
		sim.strip.request = (payload) => {
			if (payload?.event !== "stripEdit") return real(payload);
			const now = stored();
			sim.sendToPi({ event: "stripEditResult", context: sim.context, opId: payload.opId, op: "edit", ok: false, reason: "invalid", detail: "simulated write failure", rev: now.rev, groupId: now.id, config: now.config, stored: now });
		};
		await b.key("Tab");
		await b.key("Enter");
		await waitNote(/^The plugin refused this change \(simulated write failure\)\.$/, 4000).catch(() => {});
		sim.strip.request = real;
		await sleep(200);
		check("replace (refused): the refusal says so in the status line, and nothing is written", (await note()) === "The plugin refused this change (simulated write failure)." && edits().length === edits0 + 1 && pluginWrites() === writes0 && JSON.stringify(stored()) === kept0 && !(await askState()).shown, JSON.stringify({ note: await note(), writes: pluginWrites() - writes0 }));

		// The panel closed and opened again while it asks: nothing asks,
		// nothing is previewed, nothing is written.
		await openRight();
		await useByKey();
		edits0 = edits().length;
		writes0 = pluginWrites();
		kept0 = JSON.stringify(stored());
		sim.strip.ctl.panelClosed(sim.context);
		await open("dial-strip-member", undefined, { keep: true });
		await waitCaption(/^On the deck now/);
		await sleep(200);
		const reopened = await fillState();
		check("reopen: the panel opened again mid-question shows no question and no preview, and nothing was written", !(await askState()).shown && reopened.value === "" && !reopened.use && stripState()?.preview?.kind === "live" && edits().length === edits0 && pluginWrites() === writes0 && JSON.stringify(stored()) === kept0, JSON.stringify({ reopened, edits: edits().length - edits0 }));

		// The left half is a screen built for the Whole strip, which keeps
		// another screen: the question says the Whole strip changes too, and
		// Replace changes the two halves only.
		await open("dial-strip-member", {
			strip: {
				...member,
				create: {
					layout: "split",
					from: 1,
					patch: [
						{ op: "set", path: "panes.0.style", value: "lanes" },
						{ op: "set", path: "panes.0.series", value: [{ key: CPU }, { key: POWER }] },
						{ op: "set", path: "panes.0.name", value: "CPU overview" },
						{ op: "set", path: "panes.0.origin", value: "cpu" },
						{ op: "addScreen", at: 1, from: "group" },
						{ op: "set", path: "screens.0.group", value: { from: "filter", filter: "*fan*", keys: [], view: "auto" } },
						{ op: "set", path: "screens.0.name", value: "Fans" }
					]
				}
			}
		});
		await waitCaption(/^On the deck now/);
		await setSelect("strip-fill", "cpu-gpu");
		await waitCaption(/^Preview only$/);
		const whole0 = structuredClone(stored().config);
		edits0 = edits().length;
		await useByKey();
		ask = await askState();
		check("ask (left half): the screen by its name, and the Whole strip's first screen named as changing too", ask.shown && ask.text === "Replace the left half, 'CPU overview'?" && ask.also === "This also changes the Whole strip's first screen." && ask.focus === "strip-fill-no" && edits().length === edits0, JSON.stringify(ask));
		check("ask (left half): the second line describes the group", (await b.evaluate(`document.getElementById("strip-fill-ask").getAttribute("aria-describedby")`)) === "strip-fill-also");
		await b.key("Tab");
		await b.key("Enter");
		await settled(edits0 + 1);
		const replaced = stored().config;
		check("replace (left half): the halves draw the pair; the replaced screen's name and Build's origin go with it, its id stays; the Whole strip's other screen is as it was", same(storedHalves(replaced), CPU_GPU) && replaced.panes[0].name === undefined && replaced.panes[0].origin === undefined && replaced.panes[0].screenId === whole0.panes[0].screenId && sameContent(replaced.screens, whole0.screens) && edits().at(-1).patch.every((op) => /^panes\.[01]\./.test(op.path)), JSON.stringify({ pane: replaced.panes[0], screens: replaced.screens, patch: edits().at(-1).patch }));
		await choose("whole");
		await settled(edits0 + 2);
		await waitFor("the screen list", () => visible("strip-screen-select"), 3000).catch(() => {});
		const list = await b.evaluate(`[...document.getElementById("strip-screen-select").options].map((o) => [o.value, o.textContent])`);
		check("replace (left half): on the Whole strip the first screen is the new left half, and the other screen is unchanged, in its place", list.length === 2 && list[0][0] === whole0.panes[0].screenId && list[0][1] !== "CPU overview" && list[1][0] === whole0.screens[0].screenId && list[1][1] === "Fans" && sameContent(stored().config.screens, whole0.screens), JSON.stringify(list));

		// Both halves built by hand.
		await open("dial-strip-member", { strip: { ...member, create: { layout: "split", from: 1, patch: [...member.create.patch, { op: "set", path: "panes.0.style", value: "heat" }] } } });
		await waitCaption(/^On the deck now/);
		await setSelect("strip-fill", "cpu-gpu");
		await waitCaption(/^Preview only$/);
		edits0 = edits().length;
		await useByKey();
		ask = await askState();
		check("ask (both halves): both by name, and the Whole strip's first screen", ask.shown && ask.text === "Replace both halves, 'GPU Temperature' and 'CPU (Tctl/Tdie) +1'?" && ask.also === "This also changes the Whole strip's first screen." && edits().length === edits0, JSON.stringify(ask));
		await b.key("Escape");
		await sleep(150);
		check("ask (both halves): Escape leaves both as they were", !(await askState()).shown && edits().length === edits0 && same(storedHalves(stored().config), [["heat", "off", [GPU]], ["lanes", "off", [CPU, POWER]]]));
	}
	{
		// Fewer sensors: one pair is a plain link; none, and nothing new shows.
		const xl = sim.fixtures["dial-strip-xl"].strip;
		const blanks = [[0, {}], [1, {}], [3, {}], [4, {}], [5, {}]];
		const T = { temp: 1, fan: 3, power: 5, clock: 6, usage: 7 };
		const hex = (n) => n.toString(16).padStart(8, "0");
		const make = (sources) => {
			const sensors = [];
			const readings = [];
			sources.forEach(([name, rows], index) => {
				const id = 0xf0000000 + index;
				sensors.push({ index, id, instance: 0, name });
				rows.forEach(([label, unit, value, type], i) => readings.push({ key: `${hex(id)}:0:${(0x1000000 + i).toString(16)}`, type, sensorIndex: index, id: 0x1000000 + i, label, unit, value, valueMin: value - 1, valueMax: value + 1, valueAvg: value }));
			});
			return { pollTime: 1_000_000, version: 1, revision: 1, sensors, readings, byKey: new Map(readings.map((r) => [r.key, r])) };
		};
		const cpuRows = [
			["Total CPU Usage", "%", 12, T.usage],
			["CPU Package", "°C", 55, T.temp],
			["CPU Package Power", "W", 20, T.power]
		];
		// A laptop: an iGPU with no temperature, one fan.
		const laptop = make([
			["CPU [#0]: Intel Core Ultra 7", cpuRows],
			["GPU [#0]: Intel Arc Graphics", [["GPU D3D Usage", "%", 10, T.usage], ["GPU Clock", "MHz", 1100, T.clock]]],
			["ACPI", [["Fan1", "RPM", 2400, T.fan]]]
		]);
		const cpuOnly = make([["CPU [#0]: Example", cpuRows]]);
		await open("dial-strip-xl", { snapshot: laptop, settings: {}, strip: { ...xl, dials: blanks, create: { layout: "split", from: 2 } } });
		await waitCaption(/^On the deck now/);
		const one = await fillState();
		check("fill (one pair): a plain link names it, with no dropdown", one.one === "Fill: CPU and cooling" && !one.shown && !one.single && !one.use, JSON.stringify(one));
		const edits0 = edits().length;
		await b.click("#strip-fill-one");
		await waitCaption(/^Preview only$/);
		const oneArmed = await fillState();
		check("fill (one pair): the link previews it: the pair's name as plain words, Use and Cancel, no write", oneArmed.single && oneArmed.text === "CPU and cooling" && oneArmed.use && oneArmed.cancel && oneArmed.one === null && edits().length === edits0 && panelWrites() === 0, JSON.stringify(oneArmed));
		await b.click("#strip-fill-cancel");
		await waitCaption(/^On the deck now/);
		check("fill (one pair): Cancel brings the link back, nothing sent", (await fillState()).one === "Fill: CPU and cooling" && edits().length === edits0 && (await b.evaluate(`document.activeElement?.id`)) === "strip-fill-one");
		{
			// Two pairs on this PC: after a write the one pair left is a plain
			// link that takes focus, and its press previews and focuses Use. A
			// held Enter acts once, on Replace and on Use.
			const twoPairs = make([
				["CPU [#0]: Example", cpuRows],
				["GPU [#0]: Example Graphics", [["GPU Temperature", "°C", 50, T.temp]]],
				["Motherboard: Example", [["CPU Fan", "RPM", 1100, T.fan], ["AIO Pump", "RPM", 2700, T.fan]]]
			]);
			const enterDown = (autoRepeat) => b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", autoRepeat });
			/** Enter held: one press, then the system's repeats. */
			const holdEnter = async () => {
				await enterDown(false);
				await sleep(500);
				for (let i = 0; i < 12; i++) {
					await enterDown(true);
					await sleep(33);
				}
				await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
				await sleep(600);
			};
			await open("dial-strip-xl", { snapshot: twoPairs, settings: {}, strip: { ...xl, dials: blanks, create: { layout: "split", from: 2 } } });
			await waitCaption(/^On the deck now/);
			let e0 = edits().length;
			await setSelect("strip-fill", "cpu-cooling");
			await waitCaption(/^Preview only$/);
			await b.click("#strip-fill-use");
			await settled(e0 + 1);
			// A band on the left half from another dial's panel: work a person made.
			sim.strip.editFrom(0, [{ op: "set", path: "panes.0.bands", value: [{ key: keyOf(twoPairs, 0, "CPU Package"), warn: 90, below: false }] }]);
			await waitFor("the one pair's link", async () => (await fillState()).one === "Fill: CPU and GPU", 3000).catch(() => {});
			await b.click("#strip-fill-one");
			await waitCaption(/^Preview only$/);
			await b.evaluate(`document.getElementById("strip-fill-use").focus()`);
			await b.key("Enter");
			await waitFor("the question", async () => (await askState()).shown, 2000).catch(() => {});
			await b.key("Tab");
			const onReplace = (await askState()).focus;
			e0 = edits().length;
			await holdEnter();
			check("held Enter (Replace): one press of a held key writes once; its repeats press nothing on the link that then takes focus", onReplace === "strip-fill-yes" && edits().length === e0 + 1 && same(storedHalves(stored().config).map((h) => h[0]), ["area", "area"]), JSON.stringify({ onReplace, sent: edits().slice(e0).map((e) => e.baseRev), halves: storedHalves(stored().config) }));
			await waitCaption(/^On the deck now/);
			await b.click("#strip-fill-one");
			await waitCaption(/^Preview only$/);
			const onUse = await b.evaluate(`document.activeElement?.id`);
			e0 = edits().length;
			await holdEnter();
			check("held Enter (Use): over Fill's own halves a held key on Use writes once", onUse === "strip-fill-use" && edits().length === e0 + 1 && !(await askState()).shown, JSON.stringify({ onUse, sent: edits().slice(e0).map((e) => e.baseRev) }));
			// A double click on the one pair's link: its first click previews and
			// draws Use where the link was; the second click presses nothing.
			await waitFor("the one pair's link again", async () => (await fillState()).one !== null, 3000).catch(() => {});
			e0 = edits().length;
			const halvesBefore = storedHalves(stored().config);
			await doubleClick("#strip-fill-one");
			check("double click (Fill's link): it previews the pair and writes nothing; Use, drawn where the link was, takes no press", edits().length === e0 && same(storedHalves(stored().config), halvesBefore) && /^Preview only$/.test((await text("strip-caption")) ?? ""), JSON.stringify({ sent: edits().length - e0, caption: await text("strip-caption"), fill: await fillState() }));
		}
		await open("dial-strip-xl", { snapshot: cpuOnly, settings: {}, strip: { ...xl, dials: blanks } });
		await choose("split");
		await waitCaption(/^Preview of the new strip$/);
		await sleep(250);
		check("split (no pair): with no choice nothing new shows: the caption stays, no dropdown, and the split starts as before", (await startPick()) === null && (await visible("strip-caption")) && same(lastGet()?.draft?.patch, []), JSON.stringify(await startPick()));
		await open("dial-strip-xl", { snapshot: cpuOnly, settings: {}, strip: { ...xl, dials: blanks, create: { layout: "split", from: 2 } } });
		await waitCaption(/^On the deck now/);
		const none = await fillState();
		check("fill (no pair): a running split with no pair shows no Fill", !none.shown && !none.single && none.one === null, JSON.stringify(none));
	}
	{
		// A running Whole strip stays as it was: Add a screen and Build
		// screens, no dropdown and no Fill.
		await open("dial-strip-plus", { strip: { ...sim.fixtures["dial-strip-plus"].strip, create: { layout: "whole", from: 1 } } });
		await waitFor("running strip editor", () => visible("strip-edit"), 6000);
		const f = await fillState();
		check("whole (running): Add a screen and Build screens as before, and no start dropdown or Fill", (await visible("strip-add-screen")) && (await visible("strip-build")) && (await startPick()) === null && !f.shown && f.one === null && (await visible("strip-caption")), JSON.stringify(f));
	}

	// ---- make: a new strip, then no Apply ------------------------------------------------
	await open("dial-strip-plus");
	const before = docsNow();
	await makeStrip("whole");
	const creates = sim.piMessages.filter((m) => m.event === "sendToPlugin" && m.payload?.event === "stripCreate");
	check("make: exactly one stripCreate, for every dial of the strip", creates.length === 1 && creates[0].payload.layout === "whole" && creates[0].payload.columns === "all", JSON.stringify(creates.map((c) => c.payload)));
	check("make: the panel itself wrote nothing", panelWrites() === 0 && !frames().includes("setSettings"));
	const written = [...sim.strip.pluginWrites];
	const contexts = new Set(written.map((w) => w.context));
	const groups = new Set(written.map((w) => JSON.stringify(w.doc.stripGroup)));
	check("make: the plugin wrote one identical strip copy (rev 1, joined) to each of the four dials", written.length === 4 && contexts.size === 4 && groups.size === 1 && written[0].doc.stripGroup.rev === 1 && written[0].doc.stripGroup.joined === true, JSON.stringify({ n: written.length, groups: groups.size }));
	check("make: every dial's own fields are untouched", written.every((w) => same(changedKeys(before[w.context], w.doc), ["stripGroup"])), JSON.stringify(written.map((w) => changedKeys(before[w.context], w.doc))));
	await waitFor("joined marks", async () => same(await looks(), ["on", "on", "on", "on"]));
	check("make: a healthy strip shows no dial row: every dial is in it (four filled marks, unshown)", !(await rowShown()) && (await detail()) === null && same(await looks(), ["on", "on", "on", "on"]), JSON.stringify(await looks()));
	check("make: no heading over the strip-wide fields (the section is the strip); This screen's line marks where the screen begins", (await b.evaluate(`document.getElementById("strip-whole-title") === null && !/^Whole strip$/.test([...document.querySelectorAll("#sec-strip .hw-strip-block")].map((e) => e.textContent).join("|"))`)) && (await visible("strip-screens")) && /^This screen/.test((await text("strip-screen-label")) ?? ""), await text("strip-screen-label"));
	check("make: Strip Link ID is a closed fold at the end of the strip's controls, past Scale and alerts, its line empty with no ID set", await b.evaluate(`(() => { const d = document.getElementById("sec-striplink"); return d !== null && !d.open && d.contains(document.getElementById("strip-link")) && d.querySelector("summary").textContent === "Strip Link ID" && (document.getElementById("sec-stripmore").compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && d.nextElementSibling === null; })()`));
	check("make: the line is a status, the marks a toolbar named for the dials, each mark named for its dial and state", await b.evaluate(`document.getElementById("strip-device").getAttribute("role") === "status" && document.getElementById("strip-slots").getAttribute("role") === "toolbar" && document.getElementById("strip-slots").getAttribute("aria-label") === "Dials on this strip"`) && same((await marks()).map((x) => x.label), ["Dial 1, in this strip", "Dial 2, in this strip, this dial", "Dial 3, in this strip", "Dial 4, in this strip"]));
	check("make: no Quick setup: one Build screens link beside Add a screen, on the row that names the screen", !(await visible("strip-build-box")) && (await visible("strip-build")) && (await b.evaluate(`(() => { const a = document.getElementById("strip-add-screen").getBoundingClientRect(); const l = document.getElementById("strip-build").getBoundingClientRect(); const n = document.getElementById("strip-screen-label").getBoundingClientRect(); return Math.abs(a.top - l.top) < 1 && l.left > a.right && Math.abs((n.top + n.bottom) / 2 - (l.top + l.bottom) / 2) <= 2; })()`)));
	check("make: the summary names the layout and this dial's place", (await summary()) === "Whole strip · dial 2 of 4", await summary());
	check("make: the strip's own reading is shown", same(await series(0), ["GPU Temperature · °C"]), JSON.stringify(await series(0)));
	check("make: Apply is gone: no button bar and no Apply or Discard button anywhere in the section", !(await visible("strip-bar")) && (await applyAnywhere()).length === 0, JSON.stringify(await applyAnywhere()));
	check("make: the preview and the note sit above the strip's controls; Scale and alerts is closed by default, after Time window, This screen, Graph, Readout and Readings; the strip has no Background row of its own", await b.evaluate(`(() => {
		const more = document.getElementById("sec-stripmore");
		const order = ["strip-preview", "strip-note", "strip-window", "strip-screens", "sp0-style", "sp0-readout", "sp0-search", "sec-stripmore", "strip-link"].map((id) => document.getElementById(id));
		const inOrder = order.every((el, i) => i === 0 || (order[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
		const folded = ["sp0-min", "sp0-band-add"].every((id) => more.contains(document.getElementById(id))) && more.querySelector('[data-overlay="axes"]') !== null && !more.contains(document.getElementById("strip-link"));
		return !more.open && inOrder && folded && document.getElementById("strip-background") === null && document.getElementById("strip-accent") === null;
	})()`));
	check("make: the made-strip note says changes apply here", /^The strip is made\. Every change here now applies at once\.$/.test((await note()) ?? ""), await note());
	await waitCaption(/^On the deck now/);
	check("make: the preview shows the live strip from the dials' slices", stripState()?.preview?.kind === "live");
	sim.pushPreview();
	await waitFor("strip header", async () => (await text("head-reading")) === "Whole strip");
	check("make: the header names the strip, not the dial's own reading", (await text("head-source")) === "Strip display · dial 2", await text("head-source"));
	// A later save of an ordinary field carries the plugin's newest copy.
	await b.evaluate(`(() => { const f = document.getElementById("f-label"); f.focus(); f.value = "Strip GPU"; f.dispatchEvent(new Event("input", { bubbles: true })); f.blur(); })()`);
	await waitFor("label save", async () => panelWrites() >= 1);
	check("make: the panel's next save carries the plugin's newest strip copy", sameContent(sim.writes.at(-1).stripGroup, written.find((w) => w.context === sim.context).doc.stripGroup) && sim.writes.at(-1).label === "Strip GPU");
	check("make: the plugin wrote nothing back for that save", sim.strip.pluginWrites.length === 4);

	// ---- immediate: four readings in Compare, four drawn, no Apply --------------------
	{
		const writesBefore = pluginWrites();
		await setSelect("sp0-style", "compare");
		await settled(1);
		for (const label of ["CPU (Tctl/Tdie)", "CPU CCD1 (Tdie)", "CPU CCD2 (Tdie)"]) {
			const n = edits().length;
			check(`immediate: ${label} ticks`, (await tick(0, label)) === true);
			await settled(n + 1);
		}
		const sent = edits();
		check("immediate: each change was one stripEdit against the revision before it", sent.length === 4 && sent.every((e, i) => e.baseRev === 1 + i && e.patch.length === 1), JSON.stringify(sent.map((e) => [e.baseRev, e.patch.map((op) => op.path)])));
		const copy = stored();
		check("immediate: the plugin wrote revision 5 with four readings in Compare to all four dials", copy.rev === 5 && copy.config.panes[0].style === "compare" && copy.config.panes[0].series.length === 4 && pluginWrites() === writesBefore + 16, JSON.stringify({ rev: copy.rev, n: copy.config.panes[0].series.length, writes: pluginWrites() - writesBefore }));
		check("immediate: the panel shows the four, each drawn", same((await rows(0)).map((r) => r[1]), ["true", "true", "true", "true"]), JSON.stringify(await rows(0)));
		await waitFor("live slices with four chips", async () => chipCount() === 4, 4000).catch(() => {});
		check("immediate: the strip on the deck draws four legend chips", chipCount() === 4, String(chipCount()));
		// A pane keeps six (Meters on a + XL): a fifth is kept and marked
		// not drawn in Compare, then removed again.
		const fifthAt = edits().length;
		check("immediate: a fifth reading ticks, kept for a style that draws it", (await tick(0, "GPU Hot Spot Temperature")) === true);
		await settled(fifthAt + 1);
		check("immediate: Compare marks the fifth not drawn", (await rows(0)).at(-1)?.[1] === "false" && /not drawn in Compare/.test((await rows(0)).at(-1)?.[2] ?? ""), JSON.stringify(await rows(0)));
		await b.evaluate(`[...document.querySelectorAll("#sp0-series button[data-key]")].at(-1).click()`);
		await settled(fifthAt + 2);
		check("immediate: Trend, Area, Lanes, Heat and Events are not offered for four temperatures", same(await b.evaluate(`[...document.getElementById("sp0-style").options].filter((o) => o.disabled).map((o) => o.value)`), ["trend", "area", "lanes", "heat", "events"]));
		check("immediate: the style labels carry their counts, and Events says why it is not offered", same(await b.evaluate(`[...document.getElementById("sp0-style").options].map((o) => o.textContent)`), ["Trend · up to 3", "Area · up to 3", "Compare · up to 4", "Lanes · up to 3, own scales", "Heat · 1, colored bins", "Group · up to 32, one unit", "Ambient · up to 48", "Meters · one per dial", "Events · Yes/No or readings with limits"]));
		check("immediate: still no Apply anywhere, and the panel wrote nothing", (await applyAnywhere()).length === 0 && panelWrites() === 1);
	}

	// ---- beyond a style's limit: kept, marked, never cut -------------------------------
	{
		// Back to three in Trend, then a fourth.
		let n = edits().length;
		await b.evaluate(`[...document.querySelectorAll("#sp0-series button[data-key]")].at(-1).click()`);
		await settled(n + 1);
		n = edits().length;
		await setSelect("sp0-style", "trend");
		await settled(n + 1);
		check("limit: Trend with three readings", (await styleOf(0)) === "trend" && stored().config.panes[0].series.length === 3, JSON.stringify(stored().config.panes[0]));
		n = edits().length;
		check("limit: a fourth reading ticks in Trend", (await tick(0, "CPU CCD2 (Tdie)")) === true);
		await settled(n + 1);
		const shownRows = await rows(0);
		check("limit: the fourth row says it is not drawn in Trend", shownRows.length === 4 && shownRows[3][1] === "false" && shownRows[3][2] === "not drawn in Trend" && shownRows.slice(0, 3).every((r) => r[1] === "true"), JSON.stringify(shownRows));
		check("limit: nothing is cut in the settings: all four are saved", stored().config.panes[0].series.length === 4 && stored().config.panes[0].style === "trend", JSON.stringify(stored().config.panes[0]));
		const offer = await b.evaluate(`(() => { const c = document.getElementById("sp0-check"); return [c.textContent, c.querySelector("button[data-fit]")?.dataset.fit ?? null]; })()`);
		check("limit: the row says it is not drawn; the check line only offers what draws them all", /^Compare draws them all\.\s*Use Compare$/.test(offer[0]) && offer[1] === "compare", JSON.stringify(offer));
		await waitFor("three chips", async () => chipCount() === 3, 4000).catch(() => {});
		check("limit: the deck draws three legend chips", chipCount() === 3, String(chipCount()));
		n = edits().length;
		await b.click("#sp0-check button[data-fit]");
		await settled(n + 1);
		check("limit: Use Compare draws all four, and nothing was cut on the way", (await styleOf(0)) === "compare" && stored().config.panes[0].series.length === 4 && (await rows(0)).every((r) => r[1] === "true"), JSON.stringify(await rows(0)));
		// A reading in another unit is drawn in its own band: nothing marked.
		n = edits().length;
		await b.evaluate(`[...document.querySelectorAll("#sp0-series button[data-key]")].at(-1).click()`);
		await settled(n + 1);
		n = edits().length;
		check("limit: a reading in watts ticks into a °C Compare", (await tick(0, "CPU Package Power")) === true);
		await settled(n + 1);
		const unitRows = await rows(0);
		check("limit: it is saved and drawn; no row says not drawn", unitRows.every((r) => r[1] === "true") && stored().config.panes[0].series.length === 4, JSON.stringify(unitRows));
		// ---- compare: one unit only (owner, 2026-10-26) ----
		const checkLine = () => b.evaluate(`(() => { const c = document.getElementById("sp0-check"); return { text: c.textContent, tone: c.dataset.tone, fit: c.querySelector("button[data-fit]")?.dataset.fit ?? null }; })()`);
		const four = await checkLine();
		check("compare: a stored Compare of two units still draws them all, and its line says Compare is for one unit, Lanes a scale each (no switch: Lanes draws three)", four.text === "Compare is for one unit; these draw in two bands, one per unit. Lanes gives each its own scale." && four.tone === "warn" && four.fit === null, JSON.stringify(four));
		n = edits().length;
		await b.evaluate(`document.querySelector("#sp0-series button[data-key]").click()`);
		await settled(n + 1);
		const three = await checkLine();
		check("compare: with three readings in two units the line offers Use Lanes", three.text === "Compare is for one unit; these draw in two bands, one per unit. Lanes gives each its own scale. Use Lanes" && three.fit === "lanes", JSON.stringify(three));
		n = edits().length;
		await b.click("#sp0-check button[data-fit]");
		await settled(n + 1);
		check("compare: Use Lanes is one edit of the style, every reading kept", same(edits().at(-1).patch, [{ op: "set", path: "panes.0.style", value: "lanes" }]) && stored().config.panes[0].series.length === 3, JSON.stringify(edits().at(-1).patch));
		const option = await b.evaluate(`(() => { const o = document.querySelector('#sp0-style option[value="compare"]'); return { disabled: o.disabled, text: o.textContent }; })()`);
		check("compare: the Graph select keeps Compare in its place, unavailable, and says why in its option", option.disabled && option.text === "Compare · readings in one unit", JSON.stringify(option));
	}

	// ---- readout, Scale and grid, typed numbers: one edit each ------------------
	{
		check("readout: the Readout field carries no help line of its own", await b.evaluate(`document.getElementById("sp0-readout").closest(".hw-field").querySelector(".hw-help") === null`));
		const writesBefore = pluginWrites();
		const editsBefore = edits().length;
		let n = edits().length;
		await setSelect("sp0-readout", "left");
		await settled(n + 1);
		check("readout: Large values on the left is one stripEdit with only it", same(edits().at(-1).patch.map((op) => op.path), ["panes.0.readout"]) && stored().config.panes[0].readout === "left");
		check("readout: Graph stays with Large values on the left", await visible("sp0-style"));
		{
			const styleBefore = stored().config.panes[0].style;
			const readoutWidth = () => b.evaluate(`document.getElementById("sp0-readout").getBoundingClientRect().width`);
			const widthWith = await readoutWidth();
			n = edits().length;
			await setSelect("sp0-readout", "only");
			await settled(n + 1);
			check("readout: Large values only is one stripEdit with only it", same(edits().at(-1).patch.map((op) => op.path), ["panes.0.readout"]) && stored().config.panes[0].readout === "only" && stored().config.panes[0].style === styleBefore);
			check("readout: with Large values only the Graph list goes and Readout takes the row", !(await visible("sp0-style")) && (await visible("sp0-readout")) && (await readoutWidth()) > widthWith, JSON.stringify([await readoutWidth(), widthWith]));
			check("readout: focus stays on Readout when the Graph list goes", await b.evaluate(`document.activeElement === null || document.activeElement.id !== "sp0-style"`));
			n = edits().length;
			await setSelect("sp0-readout", "left");
			await settled(n + 1);
			check("readout: leaving Large values only brings the Graph list back on its stored style, one edit", (await visible("sp0-style")) && (await b.evaluate(`document.getElementById("sp0-style").value`)) === styleBefore && same(edits().at(-1).patch.map((op) => op.path), ["panes.0.readout"]));
		}
		await b.click("#sec-stripmore > summary");
		check("readout: Scale and alerts opens to the overlays, the scale and the bands", (await b.evaluate(`document.getElementById("sec-stripmore").open`)) && (await visible("sp0-overlays")) && (await visible("sp0-min")) && (await visible("sp0-band-add")));
		check("brief gaps: one native select last in the fold, the strip's, Connect by default, no opening write and no help block", await b.evaluate(`(() => { const s = document.getElementById("strip-gap-mode"); return s.value === "connect" && s.closest("#sec-stripmore") !== null && s.closest(".hw-field").nextElementSibling === null && s.labels[0].querySelector(".hw-scope")?.textContent === "This strip" && JSON.stringify([...s.options].map((o) => [o.value, o.textContent])) === JSON.stringify([["connect", "Connect"], ["mark", "Connect in color"], ["gaps", "Leave gaps"]]) && s.labels[0].querySelector("span").textContent === "Brief gaps" && s.closest(".hw-field").querySelector(".hw-help") === null; })()`) && edits().length === n + 1);
		for (const mode of ["mark", "gaps", "connect"]) {
			n = edits().length;
			await setSelect("strip-gap-mode", mode);
			await settled(n + 1);
			check(`brief gaps: ${mode} is one edit of the strip`, same(edits().at(-1).patch, [{ op: "set", path: "gapMode", value: mode }]) && (stored().config.gapMode ?? "connect") === mode);
		}
		check("brief gaps: Connect leaves no field in stored settings", !Object.hasOwn(stored().config, "gapMode"));
		n = edits().length;
		await setBox('#sp0-overlays input[data-overlay="axes"]', true);
		await settled(n + 1);
		check("readout: Scale and grid is one stripEdit with only it", same(edits().at(-1).patch.map((op) => op.path), ["panes.0.overlays.axes"]) && stored().config.panes[0].overlays.axes === true);
		n = edits().length;
		await typeInto("sp0-min", "abc");
		await sleep(700);
		check("typed: a scale end that is not a number is not sent, and the status line says why", edits().length === n && /not a number/.test((await note()) ?? ""), await note());
		await typeInto("sp0-min", "20");
		await settled(n + 1);
		// 1.8: the typed end goes out with the unit it was typed in (the
		// stamp), so the strip reads it the same way under a later °F.
		const typedPatch = edits().at(-1).patch;
		check("typed: a number is one stripEdit with only it and its stamp", same(typedPatch, [{ op: "set", path: "panes.0.scale.min", value: 20 }, { op: "set", path: "panes.0.scale.displayUnit", value: "°C" }, { op: "set", path: "panes.0.scale.displayUnitFor", value: { min: "20" } }]) && stored().config.panes[0].scale.min === 20 && stored().config.panes[0].scale.displayUnit === "°C" && (await note()) === "", JSON.stringify({ patch: typedPatch, note: await note() }));
		n = edits().length;
		await b.click("#sp0-band-add");
		await sleep(300);
		check("typed: a new band with no number yet sends nothing", edits().length === n && (await b.evaluate(`document.querySelectorAll("#sp0-bands li").length`)) === 1);
		await b.evaluate(`(() => { const f = document.querySelector("#sp0-bands [data-band-warn]"); f.focus(); f.value = "80"; f.dispatchEvent(new Event("input", { bubbles: true })); f.dispatchEvent(new Event("change", { bubbles: true })); })()`);
		await settled(n + 1);
		check("typed: its first number sends the band", same(edits().at(-1).patch.map((op) => op.path), ["panes.0.bands"]) && stored().config.panes[0].bands[0]?.warn === 80, JSON.stringify(stored().config.panes[0].bands));
		n = edits().length;
		await setSelect("sp0-readout", "off");
		await settled(n + 1);
		await setBox('#sp0-overlays input[data-overlay="axes"]', false);
		await settled(n + 2);
		check("readout: Off and an unticked box leave no trace in the copy", !/"readout"|"axes"/.test(JSON.stringify(stored().config.panes[0])), JSON.stringify(stored().config.panes[0]));
		check("readout: every applied change reached all four dials, and the panel wrote nothing more", pluginWrites() - writesBefore === 4 * (edits().length - editsBefore) && panelWrites() === 1, JSON.stringify({ writes: pluginWrites() - writesBefore, edits: edits().length - editsBefore }));
	}

	// ---- press: a real press lands where it began ------------------------------------------
	{
		await open("dial-strip-plus");
		await makeStrip("whole");
		// Scale and alerts starts closed here (an earlier leg left it open in the fold memory).
		await b.evaluate(`document.getElementById("sec-stripmore").open = false`);
		// A reading just ticked leaves its result list open above Scale and alerts.
		check("press: a reading ticks (its result list stays open)", (await tick(0, "CPU (Tctl/Tdie)")) === true && (await b.evaluate(`!document.getElementById("sp0-list").hidden`)));
		await settled(1);
		const more = await press("#sec-stripmore > summary");
		check("press: a held press on Scale and alerts after a tick lands on it and opens it", more.sameTarget && (await b.evaluate(`document.getElementById("sec-stripmore").open`)), JSON.stringify({ down: more.downOn, up: more.upOn }));
		check("press: no box above the pointer moved (0 px) or left between pointerdown and pointerup", more.moved.length === 0, JSON.stringify(more.moved.slice(0, 8)));
		await sleep(200);
		check("press: the result list closed after the press", await b.evaluate(`document.getElementById("sp0-list").hidden`));
		// A typed scale end commits on blur, at the mousedown of the press
		// on a control below it; the plugin answers while the button is held.
		const n = edits().length;
		const answered = editAnswers();
		await b.evaluate(`(() => { const f = document.getElementById("sp0-min"); f.focus(); f.value = ""; })()`);
		await b.type("25");
		const add = await press("#sp0-band-add", 300);
		check("press: the typed number was sent at the press, and its answer landed while the button was held", add.during.edits === n + 1 && add.during.answers === answered + 1 && stored().config.panes[0].scale.min === 25, JSON.stringify(add.during));
		check("press: the held press after typing lands on Add a band and adds a band row", add.sameTarget && (await b.evaluate(`document.querySelectorAll("#sp0-bands li").length`)) === 1, JSON.stringify({ down: add.downOn, up: add.upOn }));
		check("press: no box above the pointer moved (0 px) or left while the answer landed", add.moved.length === 0, JSON.stringify(add.moved.slice(0, 8)));
		// Strip Link ID typed (its fold opened), then a real press on How the strip works below it.
		const m = edits().length;
		await b.evaluate(`(() => { document.getElementById("sec-striplink").open = true; const f = document.getElementById("strip-link"); f.focus(); f.value = ""; })()`);
		await b.type("desk");
		const how = await press("#sec-strip details.hw-how > summary", 300);
		check("press: Strip Link ID typed, a held press on How the strip works below it opens it", how.sameTarget && (await b.evaluate(`document.querySelector("#sec-strip details.hw-how").open`)) && edits().length === m + 1 && stored().config.linkId === "desk", JSON.stringify({ down: how.downOn, up: how.upOn, edits: edits().length - m }));
		check("press: no box above the pointer moved (0 px) or left during that press", how.moved.length === 0, JSON.stringify(how.moved.slice(0, 8)));
		await b.evaluate(`document.getElementById("sec-striplink").open = false`);
		await sleep(100);
		check("press: folded, the Strip Link ID line names the ID", (await b.evaluate(`document.querySelector("#sec-striplink > summary").textContent`)) === "Strip Link IDdesk" && (await visible("strip-link-sum")), await b.evaluate(`document.querySelector("#sec-striplink > summary").textContent`));
	}

	// ---- alerts: fields that read, Tab that reaches the next, a fold that says so ------------
	{
		await open("dial-strip-plus");
		await makeStrip("whole");
		const row = () => b.evaluate(`(() => { const box = (e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), top: Math.round(r.top), h: Math.round(r.height) }; }; const li = document.querySelector("#sp0-bands li"); return { warn: box(li.querySelector("[data-band-warn]")), crit: box(li.querySelector("[data-band-crit]")), select: box(li.querySelector("select")), li: box(li) }; })()`);
		const focused = () => b.evaluate(`(() => { const a = document.activeElement; return a?.dataset?.bandWarn !== undefined ? "warn" : a?.dataset?.bandCrit !== undefined ? "crit" : (a?.id || a?.tagName); })()`);
		const foldText = () => b.evaluate(`document.querySelector("#sec-stripmore > summary").textContent`);
		const bands = () => stored().config.panes[0].bands?.map((x) => [x.warn ?? null, x.crit ?? null]);
		await b.evaluate(`document.getElementById("sec-stripmore").open = false`);
		check("alerts: the fold is named Scale and alerts, and says nothing with no band set", (await foldText()) === "Scale and alerts", await foldText());
		await b.click("#sec-stripmore > summary");
		await sleep(100);
		{
			const s = edits().length;
			await setSelect("sp0-style", "heat");
			await settled(s + 1);
			check("brief gaps: a strip with no line to connect does not offer it", !(await visible("strip-gap-mode-item")));
			await setSelect("sp0-style", "trend");
			await settled(s + 2);
			check("brief gaps: a line brings it back", await visible("strip-gap-mode-item"));
		}
		await b.click("#sp0-band-add");
		await sleep(150);
		const empty = await row();
		check(`alerts: Warn at and Critical at are one width and fit a number (${empty.warn.w} px), on one row under the reading`, empty.warn.w === empty.crit.w && empty.warn.w >= 100 && empty.warn.top === empty.crit.top && empty.warn.top > empty.select.top, JSON.stringify(empty));
		check("alerts: Add a band hands focus to Warn at", (await focused()) === "warn", await focused());
		check("alerts: a band with no number yet leaves the fold's line empty", (await b.evaluate(`document.getElementById("strip-more-sum").textContent`)) === "");
		const m = edits().length;
		await b.type("70");
		await b.key("Tab");
		await sleep(30);
		check("alerts: Tab from Warn at lands on Critical at", (await focused()) === "crit", await focused());
		await b.type("85");
		await settled(m + 1);
		await sleep(700);
		check("alerts: Critical at kept what was typed while Warn at's change landed", (await b.evaluate(`document.querySelector("#sp0-bands [data-band-crit]").value`)) === "85" && (await focused()) === "crit", JSON.stringify([await b.evaluate(`document.querySelector("#sp0-bands [data-band-crit]").value`), await focused()]));
		await b.key("Tab");
		await waitFor("both limits stored", async () => same(bands(), [[70, 85]]), 3000).catch(() => {});
		check("alerts: both limits typed with the keyboard are stored", same(bands(), [[70, 85]]), JSON.stringify(bands()));
		check("alerts: Tab left the row's fields for the next control in it", (await b.evaluate(`document.activeElement?.closest("#sp0-bands") !== null`)), await focused());
		await b.evaluate(`document.getElementById("sec-stripmore").open = false`);
		await sleep(50);
		check("alerts: folded, the line says a band is set", (await foldText()) === "Scale and alerts1 alert band" && (await visible("strip-more-sum")), await foldText());
		await b.evaluate(`document.getElementById("sec-stripmore").open = true`);
		await sleep(50);
		const n = edits().length;
		await b.evaluate(`document.querySelector("#sp0-bands button[data-band-remove]").click()`);
		await settled(n + 1);
		check("alerts: with the band removed the line goes", (await foldText()) === "Scale and alerts", await foldText());
		// A Group's one set of limits works the same way.
		await b.evaluate(`document.getElementById("sec-stripmore").open = true`);
		const g = edits().length;
		await setSelect("sp0-style", "group");
		await settled(g + 1);
		await b.click("#sp0-band-add");
		await sleep(150);
		const limits = await row();
		check(`alerts: a Group's limits row has the same fields (${limits.warn.w} px)`, limits.warn.w === limits.crit.w && limits.warn.w >= 100 && limits.warn.top === limits.crit.top, JSON.stringify(limits));
		const l = edits().length;
		await b.type("70");
		await b.key("Tab");
		await sleep(30);
		check("alerts: Tab from a Group's Warn at lands on its Critical at", (await focused()) === "crit", await focused());
		await b.type("85");
		await settled(l + 1);
		await b.key("Tab");
		await waitFor("both group limits stored", async () => stored().config.panes[0].group?.limits?.crit === 85, 3000).catch(() => {});
		const stamped = stored().config.panes[0].group?.limits;
		check("alerts: both of a Group's limits are stored", stamped?.warn === 70 && stamped?.crit === 85, JSON.stringify(stamped));
		await b.evaluate(`document.getElementById("sec-stripmore").open = false`);
		await sleep(50);
		check("alerts: folded, a Group's limits count as one band", (await foldText()) === "Scale and alerts1 alert band", await foldText());
	}

	// ---- scale: the unit tag, the help line, where the fields show, the stamp ----------
	{
		await open("dial-strip-plus");
		await makeStrip("whole");
		await b.evaluate(`document.getElementById("sec-stripmore").open = true`);
		/** Runs one change and waits for the plugin's answer to it. */
		const act = async (fn) => {
			const m = edits().length;
			const out = await fn();
			await settled(m + 1);
			return out;
		};
		const toStyle = async (style) => {
			if ((await styleOf(0)) !== style) await act(() => setSelect("sp0-style", style));
		};
		const removeFirst = () => act(() => b.evaluate(`document.querySelector("#sp0-series button[data-key]").click()`));
		const label = (id) => b.evaluate(`document.querySelector('label[for="${id}"]').textContent.replace(/\\s+/g, " ").trim()`);
		const shows = (id) => b.evaluate(`document.getElementById("${id}").getClientRects().length > 0`);
		/** The line boxes of an element's text (distinct tops). */
		const lines = (id) => b.evaluate(`(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById("${id}")); return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size; })()`);
		const controls = () => b.evaluate(`[...document.querySelectorAll("#strip-controls dt, #strip-controls dd")].map((e) => e.textContent)`);
		const waitControls = async (want) => {
			await waitFor(`controls ${want.join("|")}`, async () => same(await controls(), want), 3000).catch(() => {});
			return controls();
		};
		const hints = (rotate, longTouch) => ["Turn", rotate, "Push", "Inspect", "Touch", "Inspect here", "Long touch", longTouch];
		await toStyle("trend");
		check("scale: a one-reading Trend in °C labels its ends Scale from (°C) and Scale to (°C)", (await label("sp0-min")) === "Scale from (°C)" && (await label("sp0-max")) === "Scale to (°C)" && same(await series(0), ["GPU Temperature · °C"]), JSON.stringify([await label("sp0-min"), await label("sp0-max"), await series(0)]));
		// Help never grows (the owner, 2026-10-25): blank fields read Auto and
		// the tag names the unit; no standing line under them.
		const placeholders = await b.evaluate(`[document.getElementById("sp0-min").placeholder, document.getElementById("sp0-max").placeholder]`);
		check("scale: blank ends read Auto, with no help line under them", same(placeholders, ["Auto", "Auto"]) && !(await shows("sp0-scale-help")), JSON.stringify([placeholders, await shows("sp0-scale-help")]));
		const one = await waitControls(hints("Time window · pressed: scale", "Auto scale"));
		check("scale: How the strip works on a one-reading Trend: a pressed turn moves the scale, a long touch is Auto scale", same(one, hints("Time window · pressed: scale", "Auto scale")), JSON.stringify(one));
		await act(() => typeInto("sp0-max", "90"));
		const typed = edits().at(-1).patch;
		check("scale: typing 90 in Scale to is one stripEdit of the end and the unit it was typed in", same(typed, [{ op: "set", path: "panes.0.scale.max", value: 90 }, { op: "set", path: "panes.0.scale.displayUnit", value: "°C" }, { op: "set", path: "panes.0.scale.displayUnitFor", value: { max: "90" } }]) && stored().config.panes[0].scale.max === 90, JSON.stringify(typed));
		const fixed = await waitControls(hints("Time window", "Back to live"));
		check("scale: with a typed end the pressed turn and the long touch leave the scale alone", same(fixed, hints("Time window", "Back to live")), JSON.stringify(fixed));
		await act(() => setBox('#sec-display input[data-setting="fahrenheit"]', true));
		await waitFor("°F field", async () => (await b.evaluate(`document.getElementById("sp0-max").value`)) === "194", 3000).catch(() => {});
		const f = { field: await b.evaluate(`document.getElementById("sp0-max").value`), label: await label("sp0-max"), stored: stored().config.panes[0].scale };
		check("scale: after the °F switch the typed end shows 194 under Scale to (°F), stored as typed", f.field === "194" && f.label === "Scale to (°F)" && f.stored.max === 90 && f.stored.displayUnit === "°C", JSON.stringify(f));
		await act(() => setBox('#sec-display input[data-setting="fahrenheit"]', false));
		check("scale: tick a second reading", (await act(() => tick(0, "CPU (Tctl/Tdie)"))) === true);
		await act(() => typeInto("sp0-max", ""));
		const cleared = stored().config.panes[0].scale;
		check("scale: clearing the typed end clears its stamp with it", cleared === undefined || same(cleared, {}), JSON.stringify(cleared));
		const two = await waitControls(hints("Time window · pressed: series", "Back to live"));
		check("scale: with two readings the pressed turn picks the reading", same(two, hints("Time window · pressed: series", "Back to live")), JSON.stringify(two));
		// A °C end typed, then the temperatures swapped for a reading in watts.
		await act(() => typeInto("sp0-max", "90"));
		check("scale: CPU Package Power ticks", (await act(() => tick(0, "CPU Package Power"))) === true);
		await removeFirst();
		await removeFirst();
		check("scale: the pane draws only CPU Package Power now", same(await series(0), ["CPU Package Power · W"]), JSON.stringify(await series(0)));
		const unused = { stamp: stored().config.panes[0].scale?.displayUnit, shows: await shows("sp0-scale-help"), text: await text("sp0-scale-help"), lines: await lines("sp0-scale-help") };
		check("scale: ends typed for °C under a reading in W say the graph does not use them, in one line", unused.stamp === "°C" && unused.shows && /does not use these ends/.test(unused.text ?? "") && unused.lines === 1, JSON.stringify(unused));
		await act(() => typeInto("sp0-max", ""));
		check("scale: cleared ends: the line goes", !(await shows("sp0-scale-help")));
		// Where the fields show, style by style (spec 4.3; the renderer side
		// is test/strip-overlay-effect.test.ts).
		const SHOWN = { trend: "both", area: "both", compare: "both", lanes: "both", heat: "both", meters: "both", group: "none", events: "none", ambient: "none" };
		const offered = await b.evaluate(`[...document.getElementById("sp0-style").options].filter((o) => !o.disabled).map((o) => o.value)`);
		const wrong = [];
		for (const style of offered) {
			await toStyle(style);
			const shown = (await shows("sp0-scale-row")) ? "both" : "none";
			if (shown !== SHOWN[style]) wrong.push(`${style}: ${shown}, want ${SHOWN[style]}`);
		}
		check(`scale: the fields show where the style draws a value scale (${offered.length} styles offered)`, offered.length >= 8 && wrong.length === 0, JSON.stringify({ offered, wrong }));
		await toStyle("trend");
		await removeFirst();
		check("scale: with no reading the ends carry no unit tag", same(await series(0), []) && (await label("sp0-min")) === "Scale from" && (await label("sp0-max")) === "Scale to", JSON.stringify([await series(0), await label("sp0-min"), await label("sp0-max")]));
	}

	// ---- stale: another dial's panel was first -----------------------------------------
	await open("dial-strip-member");
	check("stale: a member's panel opens on its layout", (await checked()) === "split" && (await summary()) === "Equal split, left half · dial 2 of 4", await summary());
	check("stale: the right half shows its saved readings", same(await series(1), ["CPU (Tctl/Tdie) · °C", "CPU Package Power · W"]) && (await styleOf(1)) === "lanes", JSON.stringify(await series(1)));
	sim.pushPreview();
	await waitFor("strip header", async () => (await text("head-reading")) === "Equal split");
	check("stale: the header names the strip, never the dormant reading (My GPU)", !/My GPU/.test(await b.evaluate(`document.getElementById("hw-head").textContent`)));
	check("stale: Reading, Alerts and Controls step aside; Display edits the strip and says so", await b.evaluate(`(() => ["sec-reading", "sec-alerts", "sec-interaction"].every((id) => document.getElementById(id).hidden) && !document.getElementById("display-scope").hidden)()`));
	const controls = await b.evaluate(`[...document.querySelectorAll("#strip-controls dt, #strip-controls dd")].map((e) => e.textContent)`);
	check("stale: How the strip works lists what each gesture does while grouped", same(controls, ["Turn", "Window, both halves · pressed: scale", "Push", "Inspect", "Touch", "Inspect here", "Long touch", "Auto scale"]), JSON.stringify(controls));
	await setSelect("sp0-style", "area");
	await settled(1);
	check("stale: a change on a member is one stripEdit against revision 1, written as revision 2 to all four dials", edits().length === 1 && edits()[0].baseRev === 1 && same(edits()[0].patch, [{ op: "set", path: "panes.0.style", value: "area" }]) && sim.strip.pluginWrites.length === 4 && sim.strip.pluginWrites.every((w) => w.doc.stripGroup.rev === 2 && w.doc.stripGroup.config.panes[0].style === "area"));
	const elsewhere = sim.strip.editFrom(0, [{ op: "set", path: "panes.1.overlays.minmax", value: true }], { hold: true });
	check("stale: another dial's panel applied revision 3 while this panel still shows 2", elsewhere?.ok === true && elsewhere.rev === 3, JSON.stringify(elsewhere));
	const writesBeforeStale = sim.strip.pluginWrites.length;
	await setSelect("sp0-style", "heat");
	await waitNote(/^Another dial's panel changed this strip first\. Try again\.$/, 4000);
	sim.strip.holdState = false;
	check("stale: the change went with revision 2 and was refused", edits().at(-1).baseRev === 2 && sim.toPiLog.filter((p) => p.event === "stripEditResult").at(-1)?.reason === "stale");
	check("stale: the refused change wrote nothing", sim.strip.pluginWrites.length === writesBeforeStale);
	check("stale: the panel shows the plugin's copy again: Area, not the refused Heat, with the other dial's change", (await styleOf(0)) === "area" && (await b.evaluate(`document.querySelector('#sp1-overlays input[data-overlay="minmax"]').checked`)) === true);
	await setSelect("sp0-style", "heat");
	await waitFor("heat applied", async () => sim.strip.settings.get(sim.context).stripGroup.config.panes[0].style === "heat", 3000);
	const final = sim.strip.settings.get(sim.context).stripGroup;
	check("stale: making the change again applies it over revision 3, keeping both changes", final.rev === 4 && final.config.panes[0].style === "heat" && final.config.panes[1].overlays.minmax === true && edits().at(-1).baseRev === 3, JSON.stringify([final.rev, final.config.panes.map((p) => [p.style, p.overlays.minmax])]));
	await waitFor("note cleared", async () => (await note()) === "", 2000).catch(() => {});
	check("stale: the status line clears with the next change that applies", (await note()) === "", await note());
	check("stale: no panel writes", panelWrites() === 0);

	// ---- window: a running Equal split's Time window shows where it draws (the owner's pick, 2026-11-08) ----
	{
		await open("dial-strip-member");
		/** The Time window selects that show, of the strip's and the two halves'. */
		const windows = () => b.evaluate(`["strip-window", "sp0-window", "sp1-window"].filter((id) => { const e = document.getElementById(id); return e !== null && e.getClientRects().length > 0; })`);
		/** Same window's box, in page coordinates. */
		const sharedBox = () => b.evaluate(`(() => { const r = document.getElementById("strip-shared").getBoundingClientRect(); return [Math.round((r.left + scrollX) * 10) / 10, Math.round((r.top + scrollY) * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; })()`);
		const ticked = await b.evaluate(`document.getElementById("strip-shared").checked`);
		const first = await sharedBox();
		check("window: a running Equal split opens with Same window ticked and one Time window select, the strip's", ticked === true && same(await windows(), ["strip-window"]), JSON.stringify({ ticked, shown: await windows() }));
		const n = edits().length;
		await b.click("#strip-shared");
		await settled(n + 1);
		const untick = { shown: await windows(), box: await sharedBox(), edits: edits().length - n };
		check("window: Same window unticked shows each half's Time window and hides the strip's: two selects", same(untick.shown, ["sp0-window", "sp1-window"]) && untick.edits === 1, JSON.stringify(untick));
		check("window: unticking moves no Same window box from where it first drew", same(untick.box, first), JSON.stringify({ first, now: untick.box }));
		await b.click("#strip-shared");
		await settled(n + 2);
		const tick2 = { shown: await windows(), box: await sharedBox(), edits: edits().length - n };
		check("window: Same window ticked again shows one Time window select, the strip's, and its box stays", same(tick2.shown, ["strip-window"]) && same(tick2.box, first) && tick2.edits === 2, JSON.stringify(tick2));
		check("window: each tick is one stripEdit, with no panel write", panelWrites() === 0, String(panelWrites()));
	}

	// ---- leave, rejoin, every dial leaves, restore, a refused leave ----------------------------
	{
		const leaves = () => sim.piMessages.filter((m) => m.event === "sendToPlugin" && m.payload?.event === "stripLeave").map((m) => m.payload);
		const restores = () => sim.piMessages.filter((m) => m.event === "sendToPlugin" && m.payload?.event === "stripRestore").map((m) => m.payload);
		const radios = () => b.evaluate(`(() => { const r = [...document.querySelectorAll('input[name="strip-layout"]')]; return { disabled: r.map((x) => x.disabled), checked: r.find((x) => x.checked)?.value ?? null }; })()`);
		/** The left dial's one line: its words, its visible actions, and whether they sit on one line. */
		const line = () => b.evaluate(`(() => { const box = document.getElementById("strip-restore"); if (box.hidden || box.getClientRects().length === 0) return null; const shown = [document.getElementById("strip-restore-text"), ...box.querySelectorAll("button")].filter((e) => e.getClientRects().length > 0); const mids = shown.map((e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; }); return { text: document.getElementById("strip-restore-text").textContent, actions: shown.slice(1).map((e) => e.textContent), oneLine: Math.max(...mids) - Math.min(...mids) <= 2 }; })()`);
		const noConfirm = () => b.evaluate(`document.getElementById("strip-leave") === null && document.querySelector('input[name="strip-leave"]') === null && ![...document.querySelectorAll("#sec-strip button")].some((e) => e.getClientRects().length > 0 && /Leave the strip/.test(e.textContent))`);
		await open("dial-strip-member");
		const beforeLeave = docsNow();
		// The plugin's answer takes a moment here, so the request in flight can be seen.
		sim.replyDelayMs = 400;
		await choose("independent");
		await waitFor("the leave sent", async () => leaves().length === 1);
		const inFlight = await radios();
		check("leave: Independent dials on a member sends one stripLeave at once, for this dial only (no columns), with no confirm step and no Leave the strip button", leaves().length === 1 && leaves()[0].columns === undefined && leaves()[0].groupId === stored().id && (await noConfirm()) && !(await visible("strip-bar")), JSON.stringify(leaves()));
		check("leave: while it is on its way the layout radios are disabled, Independent dials checked", inFlight.disabled.every(Boolean) && inFlight.checked === "independent", JSON.stringify(inFlight));
		sim.replyDelayMs = 0;
		await waitFor("the left line", async () => (await line()) !== null, 4000);
		const leaveWrites = [...sim.strip.pluginWrites];
		check("leave: only this dial was written, as a left copy", leaveWrites.length === 1 && leaveWrites[0].context === sim.context && leaveWrites[0].doc.stripGroup.joined === false, JSON.stringify(leaveWrites.map((w) => [w.context, w.doc.stripGroup.joined])));
		check("leave: its own label, alert and reading are untouched", same(changedKeys(beforeLeave[sim.context], leaveWrites[0].doc), ["stripGroup"]) && leaveWrites[0].doc.label === "My GPU" && leaveWrites[0].doc.warnValue === "80");
		await waitFor("left mark", async () => (await marks())[1]?.label === "Dial 2, left the strip, this dial");
		check("leave: this dial's mark is hollow and says it left; an independent dial shows no dial row", (await marks())[1]?.look === "hollow" && !(await rowShown()), await statusLine());
		const left = await line();
		check("leave: one line says this dial left and ends in Rejoin and Every dial leaves", same(left, { text: "Dial 2 left the strip", actions: ["Rejoin", "Every dial leaves"], oneLine: true }), JSON.stringify(left));
		const after = await radios();
		check("leave: nothing else is said (no note, no help line in the line); the radios are back, on Independent dials, and focus is on them", (await note()) === "" && (await b.evaluate(`document.querySelector("#strip-restore .hw-help") === null`)) && after.disabled.every((d) => !d) && after.checked === "independent" && (await b.evaluate(`document.activeElement?.name`)) === "strip-layout", JSON.stringify({ note: await note(), after, focus: await b.evaluate(`document.activeElement?.id || document.activeElement?.name || document.activeElement?.tagName`) }));
		{
			// Nothing to preview on the dial that left; a change another
			// dial's panel makes to the strip it left is pushed here, and
			// neither brings the box back nor moves anything in the section.
			const sectionBoxes = () => b.evaluate(`[...document.querySelectorAll("#sec-strip *")].filter((e) => e.getClientRects().length > 0).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.y * 10), Math.round(r.height * 10)].join(","); }).join("|")`);
			const hidden = !(await visible("strip-preview")) && !(await visible("strip-caption"));
			const states = sim.toPiLog.filter((p) => p.event === "stripState").length;
			const before = await sectionBoxes();
			sim.strip.editFrom(0, [{ op: "set", path: "panes.0.overlays.minmax", value: true }]);
			await waitFor("a pushed state", async () => sim.toPiLog.filter((p) => p.event === "stripState").length > states, 3000);
			await sleep(200);
			check("leave: the dial that left shows no preview box or caption, and a pushed state of the strip it left brings neither back nor moves a box", hidden && !(await visible("strip-preview")) && (await sectionBoxes()) === before, JSON.stringify({ hidden, moved: (await sectionBoxes()) !== before }));
		}
		// Rejoin: the existing rejoin path for this dial.
		const beforeRejoin = sim.strip.pluginWrites.length;
		await b.click("#strip-rejoin");
		await waitNote(/^Applied\. Dial 2 is back in the strip\.$/);
		const rejoined = sim.strip.pluginWrites.slice(beforeRejoin);
		check("rejoin: one stripRestore for this dial's column; it is back in the strip", restores().length === 1 && same(restores()[0].columns, [1]) && rejoined.length === 1 && rejoined[0].context === sim.context && rejoined[0].doc.stripGroup.joined === true, JSON.stringify({ restores: restores(), writes: rejoined.map((w) => [w.context, w.doc.stripGroup.joined]) }));
		await waitFor("rejoined mark", async () => (await marks())[1]?.label === "Dial 2, in this strip, this dial" && (await marks())[1]?.look === "on");
		await waitFor("rejoined editor", () => visible("strip-edit"));
		check("rejoin: the panel shows the running strip again with its preview, and the line is gone", (await checked()) === "split" && (await line()) === null && (await visible("strip-preview")));
		check("rejoin: a note that points at the dials above comes only with the dial row shown", !/the dials above/i.test((await note()) ?? "") || (await rowShown()), JSON.stringify(await pointsAtRow()));
		// Every dial leaves, from the dial that left: the plugin finds the
		// strip's other dials from this dial's left copy.
		await choose("independent");
		await waitFor("left again", async () => (await line()) !== null, 4000);
		const n = sim.strip.pluginWrites.length;
		await b.click("#strip-leave-all");
		await waitFor("every dial left", async () => same((await line())?.actions, ["Rejoin", "Restore the strip"]), 4000);
		const allLeft = sim.strip.pluginWrites.slice(n);
		check("every dial leaves: one stripLeave of every column from the dial that left; the three dials still in the strip are written as left copies", leaves().length === 3 && leaves()[2].columns === "all" && allLeft.length === 3 && allLeft.every((w) => w.doc.stripGroup.joined === false) && same(allLeft.map((w) => w.context).sort(), [0, 2, 3].map((c) => sim.strip.contextAt(c)).sort()), JSON.stringify({ sent: leaves().at(-1), writes: allLeft.map((w) => [w.context, w.doc.stripGroup.joined]) }));
		check("every dial leaves: the line still names this dial, now ending in Rejoin and Restore the strip, with no note", (await line())?.text === "Dial 2 left the strip" && (await note()) === "", JSON.stringify([await line(), await note()]));
		await b.click("#strip-restore-all");
		await waitNote(/^Applied\. Every dial that left is back in the strip\.$/);
		const restored = sim.strip.pluginWrites.slice(n + 3);
		check("restore: every dial rejoins with the setup it left", restored.length === 4 && restored.every((w) => w.doc.stripGroup.joined === true) && new Set(restored.map((w) => JSON.stringify(w.doc.stripGroup.config))).size === 1);
		await waitFor("running again", () => visible("strip-edit"));
		check("restore: a note that points at the dials above comes only with the dial row shown", !/the dials above/i.test((await note()) ?? "") || (await rowShown()), JSON.stringify(await pointsAtRow()));
		// A refused leave: another dial's panel gives the strip a new id while
		// this panel's leave (naming the old one) is on its way.
		const writesBefore = sim.strip.pluginWrites.length;
		sim.replyDelayMs = 400;
		await choose("independent");
		await waitFor("the second leave sent", async () => leaves().length === 4);
		sim.strip.ctl.handlePi(sim.strip.contextAt(0), { event: "stripReid", opId: "reid", groupId: stored().id });
		const reidWrites = sim.strip.pluginWrites.length - writesBefore;
		sim.replyDelayMs = 0;
		await waitFor("the refusal", async () => sim.toPiLog.some((p) => p.event === "stripEditResult" && p.op === "leave" && p.ok === false), 4000);
		await sleep(200);
		const refused = sim.toPiLog.filter((p) => p.event === "stripEditResult" && p.op === "leave").at(-1);
		const back = await radios();
		check("leave refused: the radio goes back to the layout that runs (Equal split), enabled, and the reason shows as before; this dial was not written as left", back.checked === "split" && back.disabled.every((d) => !d) && (await visible("strip-edit")) && (await line()) === null && (await b.evaluate(`document.getElementById("strip-note").dataset.tone`)) === "danger" && ((await note()) ?? "") !== "" && sim.strip.pluginWrites.length === writesBefore + reidWrites && stored().joined === true, JSON.stringify({ refused: [refused?.reason, refused?.detail], back, note: await note() }));
		check("leave/restore: no panel writes", panelWrites() === 0);
	}

	// ---- dials that need the person: the row only then, one line, one action -------------------
	{
		await waitFor("healthy again", async () => (await statusLine()) === "Left half · dial 2 of 4");
		check("dials: a healthy Equal split shows no dial row: every dial is in it", !(await rowShown()) && same(await looks(), ["on", "on", "on", "on"]));
		// Dial 3 leaves from its own panel: this panel hears it.
		const writesBefore = sim.strip.pluginWrites.length;
		sim.strip.ctl.handlePi(sim.strip.contextAt(2), { event: "stripLeave", opId: "dial3", groupId: stored().id });
		await waitFor("dial 3 left", async () => (await rowShown()) && (await statusLine()) === "Dial 3 left the strip");
		check("dials: a dial that left brings the row: one line naming it, in the warning tone, ending in its one action", (await b.evaluate(`document.getElementById("strip-device").dataset.tone`)) === "warn" && same(await detail(), { column: "2", action: "Rejoin", take: false }), JSON.stringify(await detail()));
		const third = (await marks())[2];
		check("dials: its mark is hollow, needs the person, is named with its action, and is the one the line names", third?.look === "hollow" && third.needs && third.label === "Dial 3, left the strip, Rejoin" && third.expanded === "true", JSON.stringify(third));
		check("dials: the marks, the line and its action are one row", await b.evaluate(`(() => { const mids = [...document.querySelectorAll("#strip-slots button, #strip-device, #strip-slot-detail button")].map((e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; }); return Math.max(...mids) - Math.min(...mids) <= 2; })()`));
		// A mark picks the dial the line names: a real press, nothing above it moves.
		const pressed = await press('#strip-slots button[data-column="0"]', 200);
		check("dials: a press on a mark of the strip names that dial, with nothing to do", pressed.sameTarget && pressed.moved.length === 0 && (await statusLine()) === "Dial 1 is in the strip" && (await detail()) === null && (await marks())[0]?.expanded === "true", JSON.stringify([await statusLine(), await detail(), pressed.moved.slice(0, 4)]));
		await b.click('#strip-slots button[data-column="0"]');
		check("dials: choosing it again names the dial that needs the person", (await statusLine()) === "Dial 3 left the strip" && (await detail())?.action === "Rejoin", await statusLine());
		await b.evaluate(`document.querySelector("#strip-slot-detail button").focus()`);
		await b.key("Enter");
		await waitFor("dial 3 back", async () => !(await rowShown()), 4000);
		const back = sim.strip.pluginWrites.slice(writesBefore);
		check("dials: Rejoin is one stripRestore for that dial; it is back in the strip and the row goes", sentEvents().filter((e) => e === "stripRestore").length >= 1 && back.at(-1)?.context === sim.strip.contextAt(2) && back.at(-1)?.doc.stripGroup.joined === true && (await looks())[2] === "on", JSON.stringify(back.map((w) => [w.context, w.doc.stripGroup.joined])));
		await sleep(150);
		check("dials: with the row gone, focus is on the layout", (await b.evaluate(`document.activeElement?.name`)) === "strip-layout", await b.evaluate(`document.activeElement?.id || document.activeElement?.tagName`));
		check("dials: the note names the dial that is back", (await note()) === "Applied. Dial 3 is back in the strip.", await note());
		check("dials: with the row gone, no note points at the dials above", !/the dials above/i.test((await note()) ?? "") || (await rowShown()), JSON.stringify(await pointsAtRow()));
		// Two dials taken off the deck (another plugin's action in their place).
		sim.strip.hide(2);
		sim.strip.hide(3);
		await waitFor("dials 3 and 4 missing", async () => (await statusLine()) === "Dials 3 and 4 are missing", 4000);
		check("dials: missing dials are dashed marks named for them; one short line for both, its title says where to place them, no action", (await looks())[2] === "dashed" && (await looks())[3] === "dashed" && (await marks())[3]?.label === "Dial 4, missing, add a Sensor Dial" && /Drag a Sensor Dial to each in the Stream Deck app/.test(await statusTitle()) && (await detail()) === null, JSON.stringify([await statusTitle(), await detail()]));
		// Keyboard: the marks are one Tab stop; arrows and End move, Enter picks.
		await b.evaluate(`document.querySelector('#strip-slots button[tabindex="0"]').focus()`);
		check("dials: one mark takes the Tab stop (the last one used)", (await marks()).filter((x) => x.tab === 0).map((x) => x.column).join() === "0");
		await b.key("ArrowRight");
		check("dials: arrows move the focus and the Tab stop along the marks", (await b.evaluate(`document.activeElement?.dataset.column`)) === "1" && (await marks()).filter((x) => x.tab === 0).map((x) => x.column).join() === "1");
		await b.key("End");
		await b.key("Enter");
		await sleep(150);
		check("dials: Enter names that dial: missing, where to drag one in its title, never that the plugin places it", (await statusLine()) === "Dial 4 is missing" && /Drag one here in the Stream Deck app/.test(await statusTitle()) && !/automatic|will place|places it for you/i.test(await statusTitle()) && (await detail()) === null, JSON.stringify([await statusLine(), await statusTitle()]));
		await b.key("Home");
		check("dials: Home goes to the first mark", (await b.evaluate(`document.activeElement?.dataset.column`)) === "0");
		check("dials: no panel writes", panelWrites() === 0);
	}

	// ---- memory: a new strip's ticked list follows the person to another dial ---------------------
	await open("dial-strip-plus");
	await choose("whole");
	await listTick("gpu", false);
	await sleep(400);
	const ticksThere = await listTicks();
	sim.strip.openMember(3);
	await open("dial-strip-plus", undefined, { keep: true });
	check("memory: another dial's panel names its own place", / dial 4 of 4$/.test((await statusLine()) ?? "") && (await marks())[3]?.self === true, await statusLine());
	await waitFor("remembered draft", async () => (await checked()) === "whole");
	await waitCaption(/^Preview of the new strip$/);
	check("memory: the remembered list is there, the same ticks, as a preview with Make the strip", (await text("strip-build-use")) === "Make the strip" && same(await listTicks(), ticksThere) && ticksThere.find((x) => x[0] === "gpu")?.[1] === false, JSON.stringify([await listTicks(), ticksThere]));
	await setSelect("strip-start", "one");
	await sleep(300);
	sim.strip.openMember(1);
	await open("dial-strip-plus", undefined, { keep: true });
	await waitFor("remembered draft", async () => (await checked()) === "whole");
	check("memory: One reading only on one dial is remembered on the next: no list, Make the strip, the dropdown on One reading only", !(await visible("strip-build-box")) && (await visible("strip-bar")) && (await startPick())?.value === "one");
	await choose("independent");
	await sleep(300);
	sim.strip.openMember(3);
	await open("dial-strip-plus", undefined, { keep: true });
	await sleep(300);
	check("memory: Independent dials on one dial forgets it for every dial, and the list is offered again", (await checked()) === "independent" && (await visible("strip-build-box")));
	noWrites("memory");

	// ---- missing slot ----------------------------------------------------------------------------
	sim.folds = new PanelFoldMemory();
	await open("dial-strip-missing", undefined, { fold: true });
	await sleep(300);
	check("missing: a strip that cannot be made yet opens nothing by itself and offers no list", !(await b.evaluate(`document.getElementById("sec-strip").open`)));
	await b.evaluate(`document.getElementById("sec-strip").open = true`);
	check("missing: opened, the independent dial shows the layouts and no list yet", !(await visible("strip-build-box")));
	check("missing: the empty slot is a dashed mark named for it", (await looks())[3] === "dashed" && (await marks())[3]?.label === "Dial 4, missing, add a Sensor Dial", JSON.stringify(await marks()));
	check("missing: an independent dial needs nothing yet: no dial row", !(await rowShown()));
	await choose("whole");
	check("missing: making a strip, the row shows and its line says the dial is missing, where to place one in its title, never that the plugin places it", (await rowShown()) && (await statusLine()) === "Dial 4 is missing" && /Drag one here in the Stream Deck app/.test(await statusTitle()) && !/automatic|will place|places it for you/i.test(await statusTitle()) && (await detail()) === null, JSON.stringify([await statusLine(), await statusTitle()]));
	check("missing: Make the strip waits, in Build's list, with the reason", (await visible("strip-build-box")) && (await useDisabled()) && (await note()) === "Dial 4 needs a Sensor Dial before this layout can be made. Drag one there in the Stream Deck app.", await note());
	await b.click("#strip-build-use");
	await sleep(300);
	check("missing: pressing it sends nothing", !sentEvents().includes("stripCreate"));
	noWrites("missing");
	// One reading only is no way around it: the bar waits with the same reason.
	await setSelect("strip-start", "one");
	await sleep(200);
	check("missing: Make the strip is refused with the reason", (await goDisabled()) && (await note()) === "Dial 4 needs a Sensor Dial before this layout can be made. Drag one there in the Stream Deck app.", await note());
	await b.click("#strip-go");
	await sleep(300);
	check("missing: pressing that sends nothing either", !sentEvents().includes("stripCreate"));
	await setSelect("strip-start", "screens");
	await sleep(200);
	// The last dial is placed: the panel knows, and the list's button comes alive.
	sim.strip.place(3, { readingKey: "f0000300:0:1000000" });
	await waitFor("Make the strip alive", async () => !(await useDisabled()), 4000);
	check("missing: the last dial placed, Make the strip is alive with no new choice, the reason gone", (await visible("strip-build-box")) && (await note()) === "" && (await checked()) === "whole", await note());
	await b.click("#strip-build-use");
	await waitNote(/^The strip is made\./, 4000);
	check("missing: and it makes the strip, every screen in the one stripCreate", sim.piMessages.filter((m) => m.payload?.event === "stripCreate").length === 1 && (stored().config.screens ?? []).length > 0);

	// ---- keyboard ------------------------------------------------------------------------------
	await open("dial-strip-plus");
	await b.evaluate(`document.querySelector('input[name="strip-layout"][value="independent"]').focus()`);
	await b.key("ArrowRight");
	await sleep(150);
	check("keyboard: arrow keys move between layouts as one radio group", (await checked()) === "whole" && (await b.evaluate(`document.activeElement?.value`)) === "whole");
	check("keyboard: Make the strip is a focusable button (aria-disabled, never disabled)", await b.evaluate(`(() => { const a = document.getElementById("strip-build-use"); return a.tabIndex === 0 && !a.disabled; })()`));
	check("keyboard: the dial marks are one Tab stop, on this dial's mark", (await marks()).filter((x) => x.tab === 0).map((x) => x.column).join() === "1");
	noWrites("keyboard");

	// ---- live updates never move a box, with the dial row shown ----------------------------------
	await open("dial-strip-member");
	sim.strip.hide(3);
	await waitFor("dial 4 missing", async () => (await statusLine()) === "Dial 4 is missing", 4000);
	const boxes = () => b.evaluate(`[...document.querySelectorAll("#sec-strip *")].filter((e) => e.getClientRects().length > 0).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x * 10), Math.round(r.y * 10), Math.round(r.width * 10), Math.round(r.height * 10)].join(","); }).join(";")`);
	for (const mode of ["normal", "forced"]) {
		if (mode === "forced") await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
		await sleep(300);
		const pushes = sim.toPiLog.filter((p) => p.event === "stripState").length;
		const first = await boxes();
		await waitFor("two live pushes", async () => sim.toPiLog.filter((p) => p.event === "stripState").length >= pushes + 2, 6000);
		const later = await boxes();
		check(`live (${mode}): pushed states move no box in the Strip section, the dial row shown`, (await rowShown()) && first === later);
		if (mode === "forced") {
			const rims = await b.evaluate(`[...document.querySelectorAll("#strip-slots button")].map((m) => { const s = getComputedStyle(m, "::before"); return [s.borderTopStyle, s.borderTopWidth]; })`);
			check("live (forced): every dial mark keeps a visible border", rims.length === 4 && rims.every(([style, width]) => style !== "none" && style !== "hidden" && parseFloat(width) >= 2), JSON.stringify(rims));
		}
	}
	await b.send("Emulation.setEmulatedMedia", { features: [] });

	// ---- theme: the Theme band edits the strip's theme on a joined dial --------------------------
	{
		const xl = sim.fixtures["dial-strip-xl"].strip;
		await open("dial-strip-xl", { strip: { ...xl, create: { layout: "whole", from: 2 } } });
		await waitFor("running strip editor", () => visible("strip-edit"), 6000);
		await b.evaluate(`document.getElementById("sec-theme").open = true`);
		await waitFor("the strip's theme line", async () => /this strip/.test((await text("theme-current")) ?? ""), 4000);
		check("theme: on a joined dial the Theme band names the strip's theme: Default, following the shared theme", (await text("theme-current")) === "Default (this strip, shared: Void)", await text("theme-current"));
		const ownTheme = sim.strip.settings.get(sim.context).theme;
		const ember = ["#1E1305", "#E0912F"]; // Ember's track and accent (themes.json)
		const inEmber = () => ember.some((c) => sim.strip.slices().join("|").toUpperCase().includes(c));
		check("theme: the strip draws no Ember yet", !inEmber());
		let n = edits().length;
		await b.click('#theme-gallery .hw-theme[data-theme="ember"]');
		await settled(n + 1);
		check("theme: picking Ember is one stripEdit of the strip's theme against the revision shown", same(edits().at(-1).patch, [{ op: "set", path: "theme", value: "ember" }]) && stored().config.theme === "ember", JSON.stringify(edits().at(-1)));
		check("theme: the panel wrote nothing, and the dial's own theme is as it was", panelWrites() === 0 && sim.strip.settings.get(sim.context).theme === ownTheme, JSON.stringify({ panel: panelWrites(), own: sim.strip.settings.get(sim.context).theme }));
		await waitFor("Ember line", async () => (await text("theme-current")) === "Ember (this strip)", 3000).catch(() => {});
		check("theme: the band says Ember, the strip's", (await text("theme-current")) === "Ember (this strip)", await text("theme-current"));
		await waitFor("the strip redraws in Ember", () => inEmber(), 6000).catch(() => {});
		check("theme: the strip redraws in Ember", inEmber());
		n = edits().length;
		await b.click('#theme-gallery .hw-theme[data-theme=""]');
		await settled(n + 1);
		check("theme: Default clears the strip's theme (the shared one draws)", same(edits().at(-1).patch, [{ op: "set", path: "theme", value: "" }]) && stored().config.theme === undefined && panelWrites() === 0, JSON.stringify(edits().at(-1)));
		// Make shared: Ember becomes the shared theme and the strip follows it.
		n = edits().length;
		await b.click('#theme-gallery .hw-theme[data-theme="ember"]');
		await settled(n + 1);
		const globalsBefore = sim.globalWrites.length;
		await b.click("#theme-share");
		await settled(n + 2);
		check("theme: Make shared writes Ember as the shared theme and clears the strip's, the dial's own untouched", sim.globalWrites.length === globalsBefore + 1 && sim.globalWrites.at(-1)?.theme === "ember" && same(edits().at(-1).patch, [{ op: "set", path: "theme", value: "" }]) && stored().config.theme === undefined && panelWrites() === 0, JSON.stringify({ global: sim.globalWrites.at(-1)?.theme, patch: edits().at(-1).patch }));
		// An independent dial's pick is its own setting, as before.
		await open("dial-strip-plus");
		await b.evaluate(`document.getElementById("sec-theme").open = true`);
		await sleep(300);
		const editsBefore = edits().length;
		await b.click('#theme-gallery .hw-theme[data-theme="graphite"]');
		await waitFor("own theme write", async () => panelWrites() >= 1, 3000).catch(() => {});
		check("theme: on an independent dial a pick is the dial's own theme (one settings write, no strip edit)", panelWrites() === 1 && sim.writes.at(-1)?.theme === "graphite" && edits().length === editsBefore && (await text("theme-current")) === "Graphite (set on this dial)", JSON.stringify({ writes: panelWrites(), line: await text("theme-current") }));
	}

	// ---- display: Display edits the strip's look on a joined dial; the rest waits folded ----------
	{
		const visibleSel = (sel) => b.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e !== null && e.getClientRects().length > 0; })()`);
		const opened = (id) => b.evaluate(`document.getElementById(${JSON.stringify(id)}).open`);
		await open("dial-strip-member");
		await sleep(300);
		check("display: Reading, Alerts and Controls step aside on a strip member, with no line about them", !(await visible("sec-reading")) && !(await visible("sec-alerts")) && !(await visible("sec-interaction")) && (await b.evaluate(`document.querySelector(".hw-strip-dormant") === null`)));
		check("display: stepping aside writes no fold", !sim.piMessages.some((m) => m.event === "sendToPlugin" && m.payload?.event === "setPanelFolds"));
		check("display: the sensor reload stands in the strip's Readings row", await b.evaluate(`document.getElementById("picker-refresh").parentElement === document.getElementById("sp0-picker") && document.getElementById("picker-refresh").previousElementSibling === document.getElementById("sp0-search")`));
		{
			const asked = () => sim.piMessages.filter((m) => m.event === "sendToPlugin" && m.payload?.event === "getSensorTree").length;
			const before = asked();
			await b.evaluate(`document.getElementById("picker-refresh").click()`);
			await waitFor("the reload's request", async () => asked() === before + 1, 2000).catch(() => {});
			check("display: the reload in the strip's row asks for the sensor list", asked() === before + 1, JSON.stringify([before, asked()]));
			await sleep(200);
		}
		await b.evaluate(`document.getElementById("sec-display").open = true`);
		await sleep(200);
		check("display: Display says This strip and keeps only what the strip draws: text color, Background, decimals, °F and the strip's unit and decimals per reading", (await visible("display-scope")) && (await visible("f-text")) && (await visible("f-background")) && (await visible("f-decimals")) && (await visibleSel('#sec-display input[data-setting="fahrenheit"]')) && !(await visible("f-view")) && !(await visible("bar-range")) && (await visible("sec-formats")));
		const own = structuredClone(sim.strip.settings.get(sim.context));
		const steps = [
			["text color Dimmed", () => setSelect("f-text", "dim"), [{ op: "set", path: "textMode", value: "dim" }]],
			["Background Glass", () => setSelect("f-background", "glass"), [{ op: "set", path: "background", value: "glass" }]],
			["Words On", () => setSelect("f-accent-words", "on"), [{ op: "set", path: "accentWords", value: true }]],
			["Decimals 1", () => setSelect("f-decimals", "1"), [{ op: "set", path: "decimals", value: "1" }]],
			["°F", () => setBox('#sec-display input[data-setting="fahrenheit"]', true), [{ op: "set", path: "fahrenheit", value: true }]]
		];
		for (const [name, act, patch] of steps) {
			const n = edits().length;
			await act();
			await settled(n + 1);
			check(`display: ${name} is one stripEdit of the strip's own field`, same(edits().at(-1).patch, patch), JSON.stringify(edits().at(-1).patch));
		}
		const config = stored().config;
		check("display: the strip holds them; the panel wrote nothing; the dial's own fields are as they were", config.textMode === "dim" && config.background === "glass" && config.accentWords === true && config.decimals === "1" && config.fahrenheit === true && panelWrites() === 0 && ["textMode", "dialBackground", "dialAccentWords", "decimals", "fahrenheit"].every((k) => same(sim.strip.settings.get(sim.context)[k], own[k])), JSON.stringify(config));
		check("display: the controls show the strip's values", (await b.evaluate(`[document.getElementById("f-text").value, document.getElementById("f-background").value, document.getElementById("f-accent-words").value, document.getElementById("f-decimals").value, document.querySelector('#sec-display input[data-setting="fahrenheit"]').checked].join()`)) === "dim,glass,on,1,true");
		// An independent dial: the fold is not carried over, and Display is its own.
		await open("dial-strip-plus");
		await sleep(300);
		check("display: on an independent dial Reading opens as it always has, with its reload", (await opened("sec-reading")) && (await visible("sec-reading")) && (await b.evaluate(`document.getElementById("picker-refresh").previousElementSibling === document.getElementById("picker-search")`)));
		const editsBefore = edits().length;
		await setSelect("f-decimals", "2");
		await waitFor("own decimals write", async () => panelWrites() >= 1, 3000).catch(() => {});
		check("display: on an independent dial Decimals is the dial's own setting (one write, no strip edit)", panelWrites() === 1 && sim.writes.at(-1)?.decimals === "2" && edits().length === editsBefore && !(await visible("display-scope")) && (await visible("f-view")), JSON.stringify({ writes: panelWrites() }));
	}

	// ---- formats: the strip's own unit and decimals per reading (issue #59) ---------------------
	// A joined dial's "Unit and decimals per reading" rows are the strip's
	// readings and edit the strip's own map: seeded from the creating dial,
	// one stripEdit of readingFormats per pick, no write to the dial, no
	// help line (the fold holds none in a strip), and the strip draws it.
	{
		const k = sim.keys;
		const fx = sim.fixtures["dial-strip-member"];
		const GB2 = { unit: "GB", decimals: "2" };
		await open("dial-strip-member", {
			settings: { ...fx.settings, readingFormats: { [k.memUsed]: GB2 } },
			strip: { ...fx.strip, create: { ...fx.strip.create, patch: [...fx.strip.create.patch, { op: "set", path: "panes.0.series", value: [{ key: k.gpu }, { key: k.memUsed }] }] } }
		});
		await b.evaluate(`(() => { document.getElementById("sec-display").open = true; document.getElementById("sec-formats").open = true; })()`);
		await waitFor("the strip's format rows", () => b.evaluate(`window.hwShell?.redirected?.("readingFormats") === true && document.querySelectorAll("#format-rows .hw-format-row").length === 4`), 4000).catch(() => {});
		const rows = () =>
			b.evaluate(`[...document.querySelectorAll("#format-rows .hw-format-row")].map((row) => { const [u, d] = row.querySelectorAll("select"); return { name: row.querySelector(".hw-label")?.textContent ?? "", unit: u?.value ?? null, unitDisabled: u?.disabled ?? null, decimals: d?.value ?? null, decimalsTexts: d ? [...d.options].map((o) => o.textContent) : [] }; })`);
		const shown = await rows();
		check("formats strip: the rows are the strip's readings, pane by pane", shown.length === 4 && /GPU Temperature/.test(shown[0]?.name ?? "") && /Physical Memory Used/.test(shown[1]?.name ?? "") && /CPU/.test(shown[2]?.name ?? ""), JSON.stringify(shown.map((r) => r.name)));
		check("formats strip: the new strip took the creating dial's format", stored()?.config?.readingFormats?.[k.memUsed]?.unit === "GB" && shown[1]?.unit === "GB" && shown[1]?.decimals === "2", JSON.stringify({ stored: stored()?.config?.readingFormats, row: shown[1] }));
		check("formats strip: Decimals offers Same as strip with the strip's value", shown[0]?.decimalsTexts?.[0] === "Same as strip (Auto)", JSON.stringify(shown[0]?.decimalsTexts));
		check("formats strip: no help line under the strip's rows", !(await visible("formats-help")));
		const own = structuredClone(sim.strip.settings.get(sim.context).readingFormats);
		const n = edits().length;
		await b.evaluate(`(() => { const s = document.querySelectorAll("#format-rows .hw-format-row")[1].querySelectorAll("select")[0]; s.focus(); s.value = "GiB"; s.dispatchEvent(new Event("change")); s.blur(); })()`);
		await settled(n + 1);
		check("formats strip: a pick is one stripEdit of the strip's readingFormats", edits().length === n + 1 && sameContent(edits().at(-1).patch, [{ op: "set", path: "readingFormats", value: { [k.memUsed]: { unit: "GiB", decimals: "2" } } }]), JSON.stringify(edits().at(-1)?.patch));
		check("formats strip: the strip holds it; the panel wrote nothing; the dial's own formats are as they were", same(stored()?.config?.readingFormats, { [k.memUsed]: { unit: "GiB", decimals: "2" } }) && panelWrites() === 0 && same(sim.strip.settings.get(sim.context).readingFormats, own), JSON.stringify(stored()?.config?.readingFormats));
		await waitFor("the strip draws GiB", async () => [...sim.strip.dials.values()].some((d) => /GiB/.test(d.feedback.at(-1) ?? "")), 6000).catch(() => {});
		check("formats strip: the strip draws the reading in GiB", [...sim.strip.dials.values()].some((d) => /GiB/.test(d.feedback.at(-1) ?? "")));
		// Off the strip the rows are the dial's own again.
		await open("dial-strip-plus");
		await b.evaluate(`(() => { document.getElementById("sec-display").open = true; document.getElementById("sec-formats").open = true; })()`);
		await sleep(300);
		check("formats strip: on an independent dial the rows and help are the dial's own", (await b.evaluate(`window.hwShell?.redirected?.("readingFormats") === true`)) === false && (await visible("formats-help")) && (await rows())[0]?.decimalsTexts?.[0] === "Same as dial (Auto)");
	}

	// ---- shared: a joined dial's Shared defaults stay shared ------------------------------------
	// The strip's redirects are Display's own fields. On the owner's + XL
	// (2026-10-28) Shared defaults Text color showed the strip's Default as
	// 'Stored value "" (not in this list, kept)', and a pick there edited
	// the strip instead of the shared settings.
	{
		const sharedText = () => b.evaluate(`(() => { const s = document.getElementById("shared-text"); return { value: s.value, shown: s.selectedOptions[0]?.textContent ?? null, kept: s.querySelectorAll("option[data-unknown]").length }; })()`);
		const sharedDim = 'input[data-setting="textDimSecondary"][data-global]';
		const redirected = () => waitFor("the strip's redirects", () => b.evaluate(`window.hwShell.redirected("textMode")`), 3000);
		// The owner's shared settings: no shared Text color stored, and the
		// strip has none of its own.
		await open("dial-strip-member", { globals: { theme: "ember", typeAccents: "off", textFont: "tahoma", dialBackground: "nebula", keyBackground: "nebula" } });
		await redirected();
		const owners = await sharedText();
		check("shared: on a joined dial Shared defaults Text color shows Theme text, with no kept value", owners.value === "theme" && owners.shown === "Theme text" && owners.kept === 0, JSON.stringify(owners));
		// A shared Custom color with Dim labels on; the strip's own Default.
		await open("dial-strip-member", { globals: { theme: "void", typeAccents: "on", textMode: "custom", textColor: "#ffcc00", textDimSecondary: true } });
		await redirected();
		await b.evaluate(`(() => { document.getElementById("sec-advanced").open = true; document.getElementById("sec-shared").open = true; document.getElementById("sec-display").open = true; })()`);
		await sleep(200);
		const shown = { text: await sharedText(), dim: await b.evaluate(`document.querySelector('${sharedDim}').checked`), own: await b.evaluate(`document.getElementById("f-text").value`) };
		check("shared: Shared defaults show the shared Custom color and its Dim labels box; Display's Text color shows the strip's Default", shown.text.value === "custom" && shown.text.kept === 0 && shown.dim === true && shown.own === "", JSON.stringify(shown));
		const editsBefore = edits().length;
		await setBox(sharedDim, false);
		await waitFor("the shared Dim labels write", async () => sim.globalWrites.length >= 1, 3000).catch(() => {});
		await sleep(200);
		check("shared: Dim labels in Shared defaults on a joined dial is one shared write, no strip edit", sim.globalWrites.length === 1 && sim.globalWrites.at(-1)?.textDimSecondary === false && edits().length === editsBefore && panelWrites() === 0, JSON.stringify({ globals: sim.globalWrites.length, edits: edits().slice(editsBefore).map((e) => e.patch), panel: panelWrites() }));
		await setSelect("shared-text", "dim");
		await waitFor("the shared Text color write", async () => sim.globalWrites.length >= 2, 3000).catch(() => {});
		await sleep(200);
		const after = await sharedText();
		check("shared: Text color in Shared defaults on a joined dial is one shared write, no strip edit; the strip keeps its Default", sim.globalWrites.length === 2 && sim.globalWrites.at(-1)?.textMode === "dim" && edits().length === editsBefore && panelWrites() === 0 && stored().config.textMode === undefined && after.value === "dim" && after.kept === 0, JSON.stringify({ globals: sim.globalWrites.length, last: sim.globalWrites.at(-1)?.textMode, edits: edits().slice(editsBefore).map((e) => e.patch), strip: stored().config.textMode, after }));
	}

	// ---- sky: a strip on an art look shows its Stars and Sky color under Background -------------
	// The strip's own Dusk: the pair shows with its Defaults value first and
	// opening writes nothing; on the strip's own Paper the line under
	// Background says the art draws no sky and the pair reads as idle.
	// Background and the pair are described by that line only while it
	// shows, as the accessibility tree reads them (aria-describedby reads a
	// hidden line too).
	{
		const described = async () => {
			const doc = await b.send("DOM.getDocument", { depth: 0 });
			const out = {};
			for (const id of ["f-background", "f-art-stars", "f-art-sky-color"]) {
				const { nodeId } = await b.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: `#${id}` });
				const tree = await b.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
				out[id] = tree.nodes[0]?.description?.value ?? "";
			}
			return out;
		};
		await b.send("DOM.enable");
		await b.send("Accessibility.enable");
		const member = sim.fixtures["dial-strip-member"].strip;
		const withPatch = (extra) => ({ ...member, create: { ...member.create, patch: [...member.create.patch, ...extra] } });
		const sky = () => b.evaluate(`(() => { const p = document.getElementById("art-sky"); const n = document.getElementById("art-help"); return { shown: !p.hidden && p.getClientRects().length > 0, idle: p.classList.contains("hw-idle"), stack: p.classList.contains("hw-stack"), note: !n.hidden && n.getClientRects().length > 0 ? n.textContent : null, look: document.getElementById("f-background").value, stars: document.getElementById("f-art-stars").selectedOptions[0]?.textContent ?? null, tone: document.getElementById("f-art-sky-color").selectedOptions[0]?.textContent ?? null }; })()`);
		const openStrip = async (extra) => {
			await open("dial-strip-member", { strip: withPatch(extra) });
			await waitFor("the strip's redirects", () => b.evaluate(`window.hwShell.redirected("dialBackground")`), 3000);
			await b.evaluate(`document.getElementById("sec-display").open = true`);
			await sleep(250);
		};
		await openStrip([{ op: "set", path: "background", value: "dusk" }]);
		const dusk = await sky();
		check("sky: a strip on its own Dusk shows Stars and Sky color under Background, All (shared) and Theme (shared), with no line", dusk.shown && dusk.look === "dusk" && dusk.stars === "All (shared)" && dusk.tone === "Theme (shared)" && dusk.note === null && !dusk.idle && !dusk.stack, JSON.stringify(dusk));
		const duskDescribed = await described();
		check("sky: on the strip's Dusk, with no line shown, Background, Stars and Sky color have no description", same(duskDescribed, { "f-background": "", "f-art-stars": "", "f-art-sky-color": "" }), JSON.stringify(duskDescribed));
		noWrites("sky (the strip's Dusk)");
		await openStrip([{ op: "set", path: "background", value: "dusk" }, { op: "set", path: "theme", value: "paper" }]);
		await waitFor("the Paper line", async () => (await sky()).note !== null, 3000).catch(() => {});
		const paper = await sky();
		check("sky: on the strip's own Paper the line under Background says Paper draws no sky, and the pair reads as idle", paper.shown && paper.note === "Paper draws no sky; a dark theme shows it." && paper.idle, JSON.stringify(paper));
		const line = "Paper draws no sky; a dark theme shows it.";
		const paperDescribed = await described();
		check("sky: on the strip's Paper the line is the description of Background, Stars and Sky color", same(paperDescribed, { "f-background": line, "f-art-stars": line, "f-art-sky-color": line }), JSON.stringify(paperDescribed));
		noWrites("sky (the strip's Paper)");
		await b.send("Accessibility.disable").catch(() => {});
		await b.send("DOM.disable").catch(() => {});
	}

	// ---- group: a rule's readings, drawn and counted ----------------------------------------------
	{
		const gsnap = groupSnapshot();
		const tempFolder = gsnap.sensors.length - 1;
		const coreTemp0 = keyOf(gsnap, tempFolder, "Core 0 Temp");
		const xl = sim.fixtures["dial-strip-xl"].strip;
		const groupStrip = (extra = {}) => ({ ...xl, create: { layout: "whole", from: 2, patch: [{ op: "set", path: "panes.0.series", value: [{ key: coreTemp0 }] }, ...(extra.patch ?? [])] }, ...(extra.groupBudgetBytes === undefined ? {} : { groupBudgetBytes: extra.groupBudgetBytes }) });
		const sliceText = () => sim.strip.slices().join("\n");
		const waitSlices = (re, ms = 5000) => waitFor(`slices ${re}`, () => re.test(sliceText()), ms);
		const checkLine = () => text("sp0-check");
		const waitCheck = (re, ms = 4000) => waitFor(`count line ${re}`, async () => re.test((await checkLine()) ?? ""), ms);
		/** Heat rows across the slices: distinct row tops of the cells right
		 * of the readout slot, cells at least 8 px wide and 3 px tall (the
		 * highlight's tab is 4 px wide). */
		const rowCount = () => {
			const ys = new Set();
			sim.strip.slices().forEach((svg, column) => {
				if (column === 0) return;
				// Rows fill GROUP_TOP to GROUP_BOTTOM (4 to 94).
				for (const m of svg.matchAll(/M(-?[\d.]+) ([\d.]+)h([\d.]+)v([\d.]+)h/g)) if (Number(m[1]) + column * 200 >= 206 && Number(m[3]) >= 8 && Number(m[4]) >= 3 && Number(m[2]) < 94) ys.add(Number(m[2]));
			});
			return ys.size;
		};
		const helpLines = () => b.evaluate(`[...document.querySelectorAll("#sp0 .hw-help")].filter((e) => e.getClientRects().length > 0).length`);

		await open("dial-strip-xl", { snapshot: gsnap, strip: groupStrip() });
		await waitFor("running strip editor", () => visible("strip-edit"));
		const trendHelp = await helpLines();
		const writesBefore = pluginWrites();
		await setSelect("sp0-style", "group");
		await settled(1);
		const rule = stored()?.config?.panes?.[0]?.group;
		check("group: choosing Group writes the style and a Folder rule over the pane's reading", stored()?.config?.panes?.[0]?.style === "group" && same(rule, { from: "folder", keys: [], view: "auto" }) && stored().config.panes[0].series[0]?.key === coreTemp0, JSON.stringify(stored()?.config?.panes?.[0]));
		check("group: Graph offers Group with its count chip", (await b.evaluate(`document.querySelector('#sp0-style option[value="group"]').textContent`)) === "Group · up to 32, one unit");
		check("group: View and Readings from show, the readout select goes", (await visible("sp0-view-item")) && (await visible("sp0-from-item")) && !(await visible("sp0-readout-item")) && !(await visible("sp0-filter-item")));
		check(`group: no new help lines (${await helpLines()} in Group, ${trendHelp} in Trend)`, (await helpLines()) <= trendHelp);
		check("group: over a folder the sensor reload stands beside the search", await reloadBeside("sp0-search"));
		await waitCheck(/^16 readings, all in °C\.$/);
		check("group: the count line says the folder's readings and unit", true);
		await waitSlices(/max of 16 · Example Core/);
		await waitFor("16 heat rows", () => rowCount() === 16, 6000);
		check("group: the folder draws one heat row per reading (16)", rowCount() === 16, String(rowCount()));
		check("group: every slice within 8192 bytes", sim.strip.slices().every((svg) => Buffer.byteLength(svg, "utf8") <= 8192));

		// A sensor HWiNFO adds, and one renamed, follow with no edit.
		const writesBeforeRename = pluginWrites() + panelWrites();
		sim.snapshot = groupSnapshot({ extraTemps: 1, rename: { 3: "Core 3 Hotspot" } });
		await waitSlices(/max of 17/, 6000);
		await waitFor("17 heat rows", () => rowCount() === 17, 6000);
		check("group: an added reading draws at once (17 rows)", rowCount() === 17, String(rowCount()));
		const pick = (ticks) => sim.strip.input(3, { kind: "dialRotate", ticks, pressed: !GROUP_TURN_PICKS_READING });
		const window = (ticks) => {
			sim.strip.input(3, { kind: "dialDown" });
			sim.strip.input(3, { kind: "dialRotate", ticks, pressed: true });
			sim.strip.input(3, { kind: "dialUp" });
		};
		if (!GROUP_TURN_PICKS_READING) throw new Error("the Group legs read GROUP_TURN_PICKS_READING as true");
		pick(4);
		await waitSlices(/Core 3 Hotspot/);
		check("group: the renamed reading shows its new name, picked by a turn (4 of 17)", /4 of 17 · Example Core/.test(sliceText()));
		await waitCheck(/^17 readings, all in °C\.$/);
		check("group: the panel's count follows too", true);
		check("group: no settings were written for either", pluginWrites() + panelWrites() === writesBeforeRename);

		// Gestures per the Group table.
		pick(-10);
		await waitSlices(/max of 17/);
		check("group: a turn left past the first reading is home", /max of 17/.test(sliceText()));
		window(1);
		await sleep(300);
		const turned = await new Promise((resolve) => {
			const n = sim.toPiLog.length;
			sim.strip.request({ event: "stripGet", requestId: "g-turn" });
			waitFor("state", () => sim.toPiLog.slice(n).some((p) => p.requestId === "g-turn"), 2000).then(() => resolve(sim.toPiLog.slice(n).find((p) => p.requestId === "g-turn")));
		});
		check("group: a pressed turn changes the time window for this session (5 to 15 min)", turned?.group?.panes?.[0]?.window === "15m", JSON.stringify(turned?.group?.panes));
		const rows17 = groupRows(17);
		const row9 = rows17[9];
		sim.strip.input(3, { kind: "touchTap", hold: false, tapPos: [80, Math.floor((row9.y0 + row9.y1) / 2)] });
		await waitSlices(/10 of 17/);
		check("group: a tap on a row picks it (10 of 17)", true);
		sim.strip.input(4, { kind: "touchTap", hold: true, tapPos: [80, 50] });
		await waitSlices(/max of 17/);
		check("group: a long touch goes home", true);
		const controls = await b.evaluate(`[...document.querySelectorAll("#strip-controls dd")].map((d) => d.textContent)`);
		check("group: the panel's controls list says what the dial does", controls[0] === "Reading · pressed: window" && controls.includes("Top reading"), JSON.stringify(controls));
		window(-1);
		check("group: gestures wrote nothing", pluginWrites() + panelWrites() === writesBeforeRename);

		// A filter that matches 48: 32 drawn, the rest counted.
		await setSelect("sp0-from", "filter");
		await settled(2);
		check("group: Filter shows its field and drops the picker", (await visible("sp0-filter-item")) && !(await visible("sp0-picker")));
		check("group: with no search the sensor reload stands beside Filter", await reloadBeside("sp0-filter"));
		{
			const asked = () => sim.piMessages.filter((m) => m.event === "sendToPlugin" && m.payload?.event === "getSensorTree").length;
			const before = asked();
			await b.evaluate(`document.getElementById("picker-refresh").click()`);
			await waitFor("the reload's request", async () => asked() === before + 1, 2000).catch(() => {});
			check("group: the reload beside Filter asks for the sensor list", asked() === before + 1, JSON.stringify([before, asked()]));
			await sleep(200);
		}
		await typeInto("sp0-filter", "*core*clock");
		await settled(3);
		check("group: the filter is stored as typed", stored()?.config?.panes?.[0]?.group?.filter === "*core*clock", JSON.stringify(stored()?.config?.panes?.[0]?.group));
		await waitCheck(/^48 readings, all in MHz\. The strip graphs the first 32\.$/);
		check("group: the count line says 48 match and 32 draw", true);
		await waitSlices(/32 of 48 shown/);
		check("group: the strip says 32 of 48 shown", true);

		// A folder with two units: the unit with the most readings draws.
		await setSelect("sp0-from", "folder");
		await settled(4);
		check("group: a clock in the CPU folder takes the folder", (await tick(0, "Core 5 Clock")) === true);
		await settled(5);
		await waitCheck(/^56 readings: 48 in MHz drawn, 8 in other units left out\. The strip graphs the first 32\.$/);
		check("group: the count line names the majority unit and what is left out", true);
		await waitSlices(/8 in other units left out/);
		check("group: the strip says the readings in another unit were left out", /32 of 48 shown/.test(sliceText()));
		check("group: the panel wrote nothing; the plugin wrote each change", panelWrites() === 0 && pluginWrites() > writesBefore);

		// History full: a small group allowance (4 readings of 5 minutes).
		await open("dial-strip-xl", { snapshot: gsnap, strip: groupStrip({ groupBudgetBytes: 4 * 7392, patch: [{ op: "set", path: "panes.0.style", value: "group" }, { op: "set", path: "panes.0.group", value: { from: "folder", keys: [], view: "rows" } }] }) });
		await waitSlices(/history full: 4 of 16/, 6000);
		check("group: past the group allowance the strip says history full: 4 of 16", true);
		check("group: the keys' budget is untouched", sim.strip.history.diagnostics().bytes === 0 && sim.strip.history.diagnostics().group.bytes === 4 * 7392, JSON.stringify(sim.strip.history.diagnostics()));

		// Tiles: a history graph per thread across the whole strip.
		const tsnap = groupSnapshot({ threads: 16 });
		const threadsRule = { from: "filter", filter: "*core * t? usage", keys: [], view: "auto" };
		await open("dial-strip-xl", { snapshot: tsnap, strip: { ...xl, create: { layout: "whole", from: 2, patch: [{ op: "set", path: "panes.0.style", value: "group" }, { op: "set", path: "panes.0.series", value: [] }, { op: "set", path: "panes.0.group", value: threadsRule }] } } });
		await waitFor("running strip editor", () => visible("strip-edit"));
		await waitCheck(/^32 readings, all in %\.$/);
		const groupHelp = await helpLines();
		const viewOptions = await b.evaluate(`[...document.getElementById("sp0-view").options].map((o) => [o.value, o.textContent])`);
		check("group: View offers Tiles after Spread", same(viewOptions, [["auto", "Auto"], ["rows", "Rows"], ["now", "Now"], ["spread", "Spread"], ["tiles", "Tiles"]]), JSON.stringify(viewOptions));
		const tilesWrites = pluginWrites();
		await setSelect("sp0-view", "tiles");
		await settled(1);
		check("group: choosing Tiles stores the view, one plugin write", stored()?.config?.panes?.[0]?.group?.view === "tiles" && pluginWrites() > tilesWrites && panelWrites() === 0, JSON.stringify(stored()?.config?.panes?.[0]?.group));
		await waitSlices(/url\(#tg0/, 6000);
		check("group: Tiles draws its tiles on the ramp, with no readout line in the first dial slot", /LIVE/.test(sliceText()) && !/max of 32|\d+ of 32 ·/.test(sliceText()), sliceText().slice(0, 200));
		check("group: every Tiles slice within 8192 bytes", sim.strip.slices().every((svg) => Buffer.byteLength(svg, "utf8") <= 8192), JSON.stringify(sim.strip.slices().map((svg) => Buffer.byteLength(svg, "utf8"))));
		check(`group: Tiles adds no help lines (${await helpLines()} with Tiles, ${groupHelp} before)`, (await helpLines()) <= groupHelp);
		const controlTexts = () => b.evaluate(`[...document.querySelectorAll("#strip-controls dd")].map((d) => d.textContent)`);
		const controlTerms = () => b.evaluate(`[...document.querySelectorAll("#strip-controls dt")].map((d) => d.textContent)`);
		// The list's height with How the strip works open: its long touch line coming and going moves nothing below it.
		const controlsHeight = () => b.evaluate(`(() => { const list = document.getElementById("strip-controls"); const how = list.closest("details"); const was = how.open; how.open = true; const height = list.getBoundingClientRect().height; how.open = was; return height; })()`);
		await waitFor("Tiles hints", async () => (await controlTexts()).includes("Inspect here"), 4000);
		const homeControls = await controlTexts();
		const homeTerms = await controlTerms();
		const homeHeight = await controlsHeight();
		check("group: the panel's controls list says a touch inspects; with nothing highlighted it has no long touch line", homeControls.includes("Inspect here") && !homeControls.includes("Top reading") && !homeControls.includes("Clear highlight") && !homeTerms.includes("Long touch"), JSON.stringify([homeTerms, homeControls]));
		sim.strip.input(3, { kind: "dialRotate", ticks: 3, pressed: false });
		await waitSlices(/stroke-width="1\.5"/);
		check("group: a turn highlights a thread's tile", true);
		await waitFor("Tiles highlight hint", async () => (await controlTexts()).includes("Clear highlight"), 4000);
		check("group: with a tile highlighted the panel's controls list says a long touch clears the highlight", (await controlTexts()).includes("Clear highlight") && (await controlTerms()).includes("Long touch"), JSON.stringify([await controlTerms(), await controlTexts()]));
		check("group: the long touch line appears without moving the panel: the list keeps its height", (await controlsHeight()) === homeHeight && homeHeight > 0, JSON.stringify([homeHeight, await controlsHeight()]));
		sim.strip.input(4, { kind: "touchTap", hold: true, tapPos: [80, 50] });
		await waitFor("highlight cleared", () => !/stroke-width="1\.5"/.test(sliceText()), 4000);
		check("group: a long touch clears the highlight", true);
		await waitFor("Tiles long touch line gone", async () => !(await controlTerms()).includes("Long touch"), 4000);
		check("group: cleared, the panel's controls list has no long touch line again", !(await controlTexts()).includes("Clear highlight") && !(await controlTexts()).includes("Top reading"), JSON.stringify(await controlTexts()));
	}

	// ---- ambient: every reading in a unit, drawn as light ------------------------------------------
	{
		// 8 core temperatures in the CPU folder, 16 + 40 in a second folder,
		// and the sample sensors' own: more than Aurora's 48.
		const gsnap = groupSnapshot({ extraTemps: 40 });
		const tempFolder = gsnap.sensors.length - 1;
		const coreTemp0 = keyOf(gsnap, tempFolder, "Core 0 Temp");
		// The plugin's own count of every °C reading on this PC.
		const celsius = resolveGroup(gsnap, stripPaneOf({ style: "ambient", group: { from: "unit", unit: "°C", keys: [], view: "auto" } })).sameUnit;
		const xl = sim.fixtures["dial-strip-xl"].strip;
		const sliceText = () => sim.strip.slices().join("\n");
		const waitSlices = (re, ms = 5000) => waitFor(`slices ${re}`, () => re.test(sliceText()), ms);
		const waitCheck = (re, ms = 4000) => waitFor(`count line ${re}`, async () => re.test((await text("sp0-check")) ?? ""), ms);
		const helpLines = () => b.evaluate(`[...document.querySelectorAll("#sp0 .hw-help")].filter((e) => e.getClientRects().length > 0).length`);
		await open("dial-strip-xl", { snapshot: gsnap, strip: { ...xl, create: { layout: "whole", from: 2, patch: [{ op: "set", path: "panes.0.series", value: [{ key: coreTemp0 }] }] } } });
		await waitFor("running strip editor", () => visible("strip-edit"));
		const trendHelp = await helpLines();
		await setSelect("sp0-style", "ambient");
		await settled(1);
		const pane0 = () => stored()?.config?.panes?.[0];
		check("ambient: choosing Ambient writes the style and a Unit rule in the reading's unit", pane0()?.style === "ambient" && same(pane0()?.group, { from: "unit", unit: "°C", keys: [], view: "auto" }), JSON.stringify(pane0()));
		check("ambient: Graph offers Ambient with its count chip", (await b.evaluate(`document.querySelector('#sp0-style option[value="ambient"]').textContent`)) === "Ambient · up to 48");
		check("ambient: Unit shows; View and Readout go, and no Look row stands", !(await visible("sp0-look-item")) && (await visible("sp0-unit-item")) && (await visible("sp0-from-item")) && !(await visible("sp0-view-item")) && !(await visible("sp0-readout-item")) && !(await visible("sp0-picker")));
		check(`ambient: no new help lines (${await helpLines()} in Ambient, ${trendHelp} in Trend)`, (await helpLines()) <= trendHelp);
		check("ambient: with no search the sensor reload stands beside Unit", await reloadBeside("sp0-unit"));
		await b.evaluate(`document.getElementById("sec-stripmore").open = true`);
		check("ambient: the scale ends, alert bands and Show on the graph are hidden", !(await visible("sp0-scale-row")) && !(await visible("sp0-bands")) && !(await visible("sp0-overlays")));
		await b.evaluate(`document.getElementById("sec-stripmore").open = false`);
		check("ambient: the Unit list names this PC's units with their counts", (await b.evaluate(`[...document.getElementById("sp0-unit").options].map((o) => o.textContent)`)).includes(`°C, ${celsius} readings`), JSON.stringify(await b.evaluate(`[...document.getElementById("sp0-unit").options].map((o) => o.textContent)`)));
		await waitCheck(new RegExp(`^${celsius} readings in °C: Ambient draws the first 48\\.$`));
		check(`ambient: the count line says ${celsius} readings in °C and that Ambient draws 48`, true);
		await waitSlices(new RegExp(`48 of ${celsius} shown`));
		await waitSlices(/>5 min</);
		check("ambient: the strip says Ambient, the window, and 48 of how many", true);
		const tier5 = 168 * 44;
		await waitFor("48 readings recorded", () => sim.strip.history.ambientShare().bytes === 48 * tier5, 5000);
		check("ambient: all 48 drawn readings are recorded, from the Ambient share of the group allowance", sim.strip.history.ambientShare().bytes === 48 * tier5 && sim.strip.history.diagnostics().group.bytes === 48 * tier5, JSON.stringify([sim.strip.history.diagnostics(), sim.strip.history.ambientShare()]));
		const subpaths = () => Math.max(...sim.strip.slices().map((svg) => (svg.match(/<path id="ag0" d="([^"]*)"/)?.[1] ?? "").split("M").length - 1));
		await waitFor("48 threads", () => subpaths() >= 48, 5000);
		check(`ambient: a slice holds a thread for every reading (${subpaths()} subpaths)`, subpaths() >= 48);
		check("ambient: every slice within 8192 bytes", sim.strip.slices().every((svg) => Buffer.byteLength(svg, "utf8") <= 8192));
		const writes = pluginWrites() + panelWrites();
		sim.strip.input(3, { kind: "dialRotate", ticks: 1, pressed: false });
		sim.strip.input(3, { kind: "dialDown" });
		await sleep(40);
		sim.strip.input(3, { kind: "dialUp" });
		await waitSlices(/>15 min</);
		const state = await new Promise((resolve) => {
			const n = sim.toPiLog.length;
			sim.strip.request({ event: "stripGet", requestId: "a-turn" });
			waitFor("state", () => sim.toPiLog.slice(n).some((p) => p.requestId === "a-turn"), 2000).then(() => resolve(sim.toPiLog.slice(n).find((p) => p.requestId === "a-turn")));
		});
		check("ambient: a turn changes the window; a push leaves it live", state?.group?.panes?.[0]?.window === "15m" && state?.group?.panes?.[0]?.mode === "live", JSON.stringify(state?.group?.panes));
		check("ambient: gestures wrote nothing", pluginWrites() + panelWrites() === writes);
	}

	// ---- Group over every reading in a unit: what Build's Cooling makes ------------------------
	{
		const gsnap = groupSnapshot();
		const tempFolder = gsnap.sensors.length - 1;
		const xl = sim.fixtures["dial-strip-xl"].strip;
		await open("dial-strip-xl", { snapshot: gsnap, strip: { ...xl, create: { layout: "whole", from: 2, patch: [{ op: "set", path: "panes.0.series", value: [{ key: keyOf(gsnap, tempFolder, "Core 0 Temp") }] }, { op: "set", path: "panes.0.style", value: "group" }] } } });
		await waitFor("running strip editor", () => visible("strip-edit"));
		check("group unit: Readings from offers Every reading in a unit on a Group", await b.evaluate(`document.querySelector('#sp0-from option[value="unit"]').hidden === false`));
		await setSelect("sp0-from", "unit");
		await settled(1);
		check("group unit: picking it is one edit that names the reading's unit", same(stored()?.config?.panes?.[0]?.group, { from: "unit", unit: "°C", keys: [], view: "auto" }), JSON.stringify(stored()?.config?.panes?.[0]?.group));
		check("group unit: Unit shows and the picker goes", (await visible("sp0-unit-item")) && !(await visible("sp0-picker")));
		await setSelect("sp0-view", "now");
		await settled(2);
		check("group unit: View Now is a column per reading of the unit, every slice within 8192 bytes", same(stored()?.config?.panes?.[0]?.group?.view, "now") && sim.strip.slices().every((svg) => Buffer.byteLength(svg, "utf8") <= 8192));
	}

	// ---- Meters and Events ------------------------------------------------------------------
	{
		const snap = sampleSnapshot();
		const xl = sim.fixtures["dial-strip-xl"].strip;
		const key = (source, label) => keyOf(snap, source, label);
		const sliceText = () => sim.strip.slices().join("\n");
		const waitSlices = (re, ms = 5000) => waitFor(`slices ${re}`, () => re.test(sliceText()), ms);
		const helpLines = () => b.evaluate(`[...document.querySelectorAll("#sp0 .hw-help")].filter((e) => e.getClientRects().length > 0).length`);
		const option = (value) => b.evaluate(`(() => { const o = document.querySelector('#sp0-style option[value="${value}"]'); return [o.textContent, o.disabled]; })()`);
		const remove = async (k) => {
			const n = edits().length;
			await b.evaluate(`document.querySelector('#sp0-series button[data-key="${k}"]').click()`);
			await settled(n + 1);
		};
		const tickOne = async (label) => {
			const n = edits().length;
			const ok = await tick(0, label);
			if (ok === true) await settled(n + 1);
			return ok;
		};
		const hot = key(1, "GPU Hot Spot Temperature");
		await open("dial-strip-xl", { snapshot: snap, strip: { ...xl, create: { layout: "whole", from: 2, patch: [{ op: "set", path: "panes.0.series", value: [{ key: hot }] }] } } });
		await waitFor("running strip editor", () => visible("strip-edit"), 6000);
		const trendHelp = await helpLines();
		check("patterned: the strip starts with the dial's temperature in Trend", same(stored()?.config?.panes?.[0]?.series, [{ key: hot }]) && (await styleOf(0)) === "trend", JSON.stringify(stored()?.config?.panes?.[0]));
		check("patterned: Meters is offered with its count chip", same(await option("meters"), ["Meters · one per dial", false]));
		check("patterned: Events is not offered for a temperature with no band, and says why", same(await option("events"), ["Events · Yes/No or readings with limits", true]), JSON.stringify(await option("events")));

		// Two power readings.
		check("patterned: CPU Package Power ticks", (await tickOne("CPU Package Power")) === true);
		check("patterned: GPU Power ticks", (await tickOne("GPU Power")) === true);
		await remove(hot);

		// Meters: the readings across the whole strip, each number in a dial's slot.
		const beforeMeters = edits().length;
		await setSelect("sp0-style", "meters");
		await settled(beforeMeters + 1);
		check("patterned: Meters applies at once", stored()?.config?.panes?.[0]?.style === "meters");
		check(`patterned: Meters adds no help line (${await helpLines()})`, (await helpLines()) <= trendHelp && !(await visible("sp0-readout-item")));
		const large = /font-size="([3-7]\d)" font-weight="700"[^>]*>[\d.]+</;
		await waitFor("two meters", () => large.test(sim.strip.slices()[2] ?? "") && large.test(sim.strip.slices()[5] ?? ""), 5000);
		check("patterned: dials 3 and 6 each show their reading large, named at the left of its half", />CPU Package Power</.test(sim.strip.slices()[0] ?? "") && />GPU Power</.test(sim.strip.slices()[3] ?? ""), (sim.strip.slices()[0] ?? "").slice(0, 300));
		check("patterned: every dial draws its share of the strip", sim.strip.slices().every((svg) => /<text|<path/.test(svg ?? "")));
		for (const label of ["Core 0 Clock (perf #2/3)", "Total CPU Usage", "GPU Core Load", "AIO Pump"]) check(`patterned: ${label} ticks`, (await tickOne(label)) === true);
		check("patterned: six readings, one per dial, all drawn", same((await rows(0)).map((r) => r[1]), ["true", "true", "true", "true", "true", "true"]), JSON.stringify(await rows(0)));
		check("patterned: a seventh reading cannot be ticked (a pane keeps six)", (await tick(0, "GPU Fan1")) === "disabled");
		await waitFor("six meters", () => sim.strip.slices().every((svg) => /font-weight="700"/.test(svg ?? "")), 5000);
		check("patterned: every dial shows a meter, each slice within 8192 bytes", sim.strip.slices().every((svg) => /font-weight="700"/.test(svg ?? "") && Buffer.byteLength(svg ?? "", "utf8") <= 8192));

		// Events: a Yes/No reading, on 15 minutes from the same edit.
		for (const label of ["Core 0 Clock (perf #2/3)", "Total CPU Usage", "GPU Core Load", "AIO Pump", "GPU Power"]) await remove(key(label === "Total CPU Usage" || label === "Core 0 Clock (perf #2/3)" ? 0 : label === "AIO Pump" ? 2 : 1, label));
		check("patterned: Thermal Throttling (HTC) ticks", (await tickOne("Thermal Throttling (HTC)")) === true);
		check("patterned: Events is not offered while a power reading has no band", same(await option("events"), ["Events · Yes/No or readings with limits", true]), JSON.stringify(await option("events")));
		await remove(key(0, "CPU Package Power"));
		check("patterned: with the Yes/No reading alone, Events is offered with its count chip", same(await option("events"), ["Events · up to 4", false]), JSON.stringify(await option("events")));
		const beforeEvents = edits().length;
		await setSelect("sp0-style", "events");
		await settled(beforeEvents + 1);
		const eventsPatch = edits().at(-1)?.patch ?? [];
		check("patterned: choosing Events is one stripEdit with the style and a 15 minute window", edits().length === beforeEvents + 1 && same(eventsPatch.map((op) => op.path).sort(), ["panes.0.style", "window"]) && stored()?.config?.window === "15m", JSON.stringify(eventsPatch));
		check(`patterned: Events adds no help line and hides the scale (${await helpLines()})`, (await helpLines()) <= trendHelp && (await b.evaluate(`document.getElementById("sp0-scale-row").hidden === true`)) && !(await visible("sp0-readout-item")));
		const shownBoxes = () => b.evaluate(`[...document.querySelectorAll("#sp0-overlays input[data-overlay]")].filter((e) => !e.closest("label").hidden).map((e) => e.dataset.overlay)`);
		check("patterned: Events hides the Show on the graph boxes it draws nothing for", same(await shownBoxes(), ["unit", "legend", "axes"]), JSON.stringify(await shownBoxes()));
		const toMeters = edits().length;
		await setSelect("sp0-style", "meters");
		await settled(toMeters + 1);
		check("patterned: Meters hides Current value, Min and max and Scale and grid", same(await shownBoxes(), ["unit", "legend", "time"]), JSON.stringify(await shownBoxes()));
		const beforeBack = edits().length;
		await setSelect("sp0-style", "events");
		await settled(beforeBack + 1);
		await waitSlices(/never Yes in 15 min/);
		check("patterned: the strip names the reading and its state, and counts its events in the window", />Thermal Throttling( \(HTC\))?</.test(sim.strip.slices()[0] ?? "") && />No</.test(sim.strip.slices()[0] ?? ""), (sim.strip.slices()[0] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
		check("patterned: the panel wrote nothing; the plugin wrote each change", panelWrites() === 0);
	}

	// ---- looks: Meters' Look, and CPU and RAM usage (the owner's pick, 2026-11-08) ----------------
	{
		const snap = sampleSnapshot();
		const xl = sim.fixtures["dial-strip-xl"].strip;
		const usage = keyOf(snap, 0, "Total CPU Usage");
		const mem = keyOf(snap, 6, "Physical Memory Load");
		const helpLines = () => b.evaluate(`[...document.querySelectorAll("#sp0 .hw-help")].filter((e) => e.getClientRects().length > 0).length`);
		const lookState = () =>
			b.evaluate(`(() => { const s = document.getElementById("sp0-look"); const item = document.getElementById("sp0-look-item"); const style = document.getElementById("sp0-style"); return { shown: item !== null && item.getClientRects().length > 0, value: s?.value ?? null, options: s === null ? [] : [...s.options].map((o) => [o.value, o.textContent]), sameRow: s !== null && Math.abs(s.getBoundingClientRect().top - style.getBoundingClientRect().top) < 1 }; })()`);
		const rowHeight = () => b.evaluate(`Math.round(document.getElementById("sp0-graph-row").getBoundingClientRect().height * 10) / 10`);
		await open("dial-strip-xl", { snapshot: snap, strip: { ...xl, create: { layout: "whole", from: 2, patch: [{ op: "set", path: "panes.0.series", value: [{ key: usage }, { key: mem }] }] } } });
		await waitFor("running strip editor", () => visible("strip-edit"), 6000);
		const trendHelp = await helpLines();
		const trendRow = await rowHeight();
		check("looks: Trend shows no Look", !(await lookState()).shown);
		const toMeters = edits().length;
		await setSelect("sp0-style", "meters");
		await settled(toMeters + 1);
		const at0 = await lookState();
		check("looks: Meters shows Look on Graph's row, Thin bar picked, its three looks named", at0.shown && at0.sameRow && at0.value === "thin" && same(at0.options, [["thin", "Thin bar"], ["full", "Full bar"], ["liquid", "Liquid"]]), JSON.stringify(at0));
		check(`looks: Look adds no help line and no row (${await helpLines()} lines, ${await rowHeight()} px)`, (await helpLines()) <= trendHelp && (await rowHeight()) <= trendRow + 0.5);
		const writes0 = panelWrites();
		for (const look of ["full", "liquid", "thin"]) {
			const n = edits().length;
			await setSelect("sp0-look", look);
			await settled(n + 1);
			const patch = edits().at(-1)?.patch ?? [];
			const pane = stored()?.config?.panes?.[0] ?? {};
			check(`looks: ${look} is one stripEdit of the Look alone, and the plugin stores it`, edits().length === n + 1 && same(patch, [{ op: "set", path: "panes.0.meterLook", value: look }]) && (look === "thin" ? !Object.hasOwn(pane, "meterLook") : pane.meterLook === look), JSON.stringify([patch, pane]));
			if (look === "liquid") {
				await waitFor("a liquid", () => /linearGradient/.test(sim.strip.slices().join("")), 5000).catch(() => {});
				check("looks: Liquid draws a tank of each reading, beside its name and number", /linearGradient/.test(sim.strip.slices().join("")) && />Total CPU Usage</.test(sim.strip.slices().join("")), sim.strip.slices().join("").slice(0, 300));
				// Each tank's surface is one straight line at the level: in every
				// slice one segment with no rise (the wave drew one every 5 px).
				const surfaces = [...sim.strip.slices().join("").matchAll(/<path d="([^"]+)" fill="none" stroke="[^"]+" stroke-width="1.5"/g)].map((x) => x[1]);
				check(`looks: Liquid's surface is one straight line at the level (${surfaces.length} surface paths)`, surfaces.length >= 2 && surfaces.every((d) => /^M[\d.-]+ [\d.-]+l[\d.]+ 0$/.test(d)), JSON.stringify(surfaces));
				check("looks: a percentage on Liquid keeps 0 to 100, so Scale from and Scale to go", await b.evaluate(`document.getElementById("sp0-scale-row").hidden === true`));
			}
		}
		check("looks: the panel wrote nothing; the plugin wrote each change", panelWrites() === writes0 && panelWrites() === 0);
		// Reopened, the panel reads the Look back and sends nothing.
		const toLiquid = edits().length;
		await setSelect("sp0-look", "liquid");
		await settled(toLiquid + 1);
		const before = edits().length;
		await open("dial-strip-xl", undefined, { keep: true });
		await sleep(300);
		check("looks: reopened, the panel shows Liquid and sends nothing", (await lookState()).value === "liquid" && edits().length === before && panelWrites() === 0, JSON.stringify(await lookState()));
		const toTrend = edits().length;
		await setSelect("sp0-style", "trend");
		await settled(toTrend + 1);
		check("looks: Trend hides Look again, and the pane keeps it for Meters", !(await lookState()).shown && stored()?.config?.panes?.[0]?.meterLook === "liquid");
	}
	{
		// CPU and RAM usage: HWiNFO lists Physical Memory Load as an Other
		// reading (type 8), as on this PC.
		const snap = sampleSnapshot();
		for (const r of snap.readings) if (r.label === "Physical Memory Load") r.type = 8;
		const USAGE = keyOf(snap, 0, "Total CPU Usage");
		const MEM = keyOf(snap, 6, "Physical Memory Load");
		await open("dial-strip-xl", { snapshot: snap });
		await choose("split");
		await waitCaption(/^Preview of the new strip$/);
		await sleep(300);
		const pick = await startPick();
		check("usage pair: CPU and RAM usage is the first pair and the pick", pick !== null && same(pick.options[0], ["cpu-ram", "CPU and RAM usage"]) && pick.value === "cpu-ram" && pick.text === "CPU and RAM usage", JSON.stringify(pick));
		const draft = lastGet()?.draft?.patch ?? [];
		const value = (path) => draft.filter((op) => op.path === path).at(-1)?.value;
		check("usage pair: the draft is a Meters Liquid of each, named CPU usage and RAM usage, in whole percents", same(draftHalves(draft), [["meters", "off", [USAGE]], ["meters", "off", [MEM]]]) && value("panes.0.meterLook") === "liquid" && value("panes.1.meterLook") === "liquid" && same(value("panes.0.series"), [{ key: USAGE, name: "CPU usage" }]) && same(value("panes.1.series"), [{ key: MEM, name: "RAM usage" }]) && same(value("readingFormats"), { [USAGE]: { decimals: "0" }, [MEM]: { decimals: "0" } }), JSON.stringify(draft));
		noWrites("usage pair (being made)");
		await b.click("#strip-go");
		await waitNote(/^The strip is made\./, 4000);
		const creates = sim.piMessages.filter((m) => m.event === "sendToPlugin" && m.payload?.event === "stripCreate");
		const config = stored()?.config ?? {};
		check("usage pair: Make the strip is one stripCreate, and the plugin stores both liquids, their names and whole percents", creates.length === 1 && same((config.panes ?? []).map((p) => [p.style, p.meterLook, p.series]), [["meters", "liquid", [{ key: USAGE, name: "CPU usage" }]], ["meters", "liquid", [{ key: MEM, name: "RAM usage" }]]]) && same(config.readingFormats, { [USAGE]: { decimals: "0" }, [MEM]: { decimals: "0" } }) && panelWrites() === 0, JSON.stringify(config));
		await waitFor("the usage strip", () => />CPU usage</.test(sim.strip.slices().join("")) && />RAM usage</.test(sim.strip.slices().join("")), 5000).catch(() => {});
		const drawn = sim.strip.slices().join("");
		const words = [...drawn.matchAll(/>([^<>]+)</g)].map((m) => m[1]);
		check("usage pair: the strip draws CPU usage and RAM usage, each a whole percent beside a liquid", words.includes("CPU usage") && words.includes("RAM usage") && words.filter((w) => /^\d{1,3}$/.test(w)).length >= 2 && !words.some((w) => /^\d+\.\d+$/.test(w)) && (drawn.match(/<linearGradient/g) ?? []).length >= 2, words.join(" | "));
		await waitFor("running split", () => visible("strip-edit"), 4000);
		check("usage pair: the running split draws the pair, so Fill offers the others", (await fillState()).options.every(([id]) => id !== "cpu-ram") && (await fillState()).options.length > 1, JSON.stringify(await fillState()));
	}

	// ---- screens: a Whole strip's list of full strip views ------------------------------------------
	{
		const gsnap = groupSnapshot();
		const coreTemp0 = keyOf(gsnap, gsnap.sensors.length - 1, "Core 0 Temp");
		const xl = sim.fixtures["dial-strip-xl"].strip;
		await open("dial-strip-xl", { snapshot: gsnap, strip: { ...xl, create: { layout: "whole", from: 2, patch: [{ op: "set", path: "panes.0.series", value: [{ key: coreTemp0 }] }] } } });
		await waitFor("running strip editor", () => visible("strip-edit"), 6000);
		/** The screens the plugin reports, beside the group. */
		const reported = () => {
			const s = stripState();
			return Array.isArray(s?.group?.screens) ? s.group : null;
		};
		check("screens: the plugin's strip state carries the list beside the group", reported() !== null, JSON.stringify(Object.keys(stripState()?.group ?? {})));
		{
			const shows = () => sim.piMessages.filter((m) => m.event === "sendToPlugin" && m.payload?.event === "stripShowScreen").map((m) => m.payload);
			/** The list of screens: each option's id and name, and which one is chosen. */
			const options = () => b.evaluate(`[...document.querySelectorAll("#strip-screen-select option")].map((o) => ({ id: o.value, name: o.textContent, selected: o.selected }))`);
			const place = () => text("strip-screen-place");
			const headHeight = () => b.evaluate(`Math.round(document.getElementById("strip-screens").getBoundingClientRect().height * 10) / 10`);
			const helpLines = () => b.evaluate(`[...document.querySelectorAll("#sec-strip .hw-help")].filter((e) => e.getClientRects().length > 0).length`);
			/** The strip copy as the plugin last told the panel (an answer or a state). */
			const storedConfig = () => {
				for (let i = sim.toPiLog.length - 1; i >= 0; i--) {
					const p = sim.toPiLog[i];
					if (p.event === "stripEditResult" && p.ok === true && p.config !== null && typeof p.config === "object") return p.config;
					if (p.event === "stripState" && p.group?.config) return p.group.config;
				}
				return {};
			};
			const screenIds = () => [storedConfig().panes[0], ...(storedConfig().screens ?? [])].map((p) => p.screenId);
			const onStrip = () => reported()?.screen;
			const waitScreens = (n) => waitFor(`${n} screens listed`, async () => (await options()).length === n, 4000);
			const panelWritesAtStart = panelWrites();
			const openTools = async () => {
				if ((await b.evaluate(`document.getElementById("strip-screen-edit").getAttribute("aria-expanded")`)) !== "true") await b.click("#strip-screen-edit");
				await sleep(100);
			};

			// One screen: its name on This screen's line, and Add a screen there.
			check("screens: one screen shows its name on This screen's line and Add a screen; no list, no tools, no Next screen", (await text("strip-screen-label")) === "This screen: Core 0 Temp" && (await visible("strip-add-screen")) && !(await visible("strip-screen-pick")) && !(await visible("strip-screen-tools")) && !(await visible("strip-cycle-item")), await text("strip-screen-label"));
			const linkCost = await b.evaluate(`(() => { const a = document.getElementById("strip-add-screen"); const s = document.getElementById("sec-strip"); const with_ = s.getBoundingClientRect().height; a.hidden = true; const without = s.getBoundingClientRect().height; a.hidden = false; return Math.round((with_ - without) * 10) / 10; })()`);
			check(`screens: Add a screen adds no height (${linkCost} px)`, linkCost === 0);
			const onLine = await b.evaluate(`(() => { const a = document.getElementById("strip-add-screen").getBoundingClientRect(); const l = document.getElementById("strip-screen-label").getBoundingClientRect(); return Math.abs((a.top + a.bottom) / 2 - (l.top + l.bottom) / 2); })()`);
			check(`screens: the link sits on This screen's line (${Math.round(onLine * 10) / 10} px off its middle)`, onLine <= 2);
			const oneHelp = await helpLines();
			const oneHead = await headHeight();

			// Add a screen: one edit, the new screen shown, its Filter focused.
			let n = edits().length;
			await b.click("#strip-add-screen");
			await settled(n + 1);
			check("screens: Add a screen is one stripEdit: addScreen after the screen on the strip, as a Group", same(edits().at(-1).patch, [{ op: "addScreen", at: 1, from: "group" }]), JSON.stringify(edits().at(-1).patch));
			await waitScreens(2);
			const added = screenIds()[1];
			await waitFor("the new screen shown", () => shows().some((x) => x.screenId === added), 3000);
			check("screens: the new screen is shown with exactly { event, screenId }", same(Object.keys(shows().at(-1)).sort(), ["event", "screenId"]) && shows().at(-1).screenId === added, JSON.stringify(shows().at(-1)));
			await waitFor("the new screen on the strip", () => onStrip() === added, 3000);
			await sleep(200);
			check("screens: the list chooses it, 2 of 2", (await options()).find((o) => o.selected)?.id === added && (await place()) === "2 of 2", JSON.stringify([await options(), await place()]));
			check("screens: the box edits it: Group, Readings matching a filter, an empty Filter with focus", (await styleOf(0)) === "group" && (await b.evaluate(`document.getElementById("sp0-from").value`)) === "filter" && (await b.evaluate(`document.activeElement?.id`)) === "sp0-filter" && (await b.evaluate(`document.getElementById("sp0-filter").value`)) === "");
			const tries = await b.evaluate(`[...document.querySelectorAll("#sp0-check button[data-example]")].map((x) => x.dataset.example)`);
			check(`screens: the empty Filter offers filters that work on this PC (${tries.join(" ")})`, tries.length > 0 && tries.includes("*core ? clock*|*core ?? clock*"), JSON.stringify(tries));
			check("screens: one row picks the screen (before, list, after, place, Edit); the tools wait for Edit; Next screen shows; the pane legend is read, not shown", (await visible("strip-screen-pick")) && (await visible("strip-screen-prev")) && (await visible("strip-screen-select")) && (await visible("strip-screen-next")) && (await visible("strip-screen-edit")) && !(await visible("strip-screen-tools")) && (await visible("strip-cycle-item")) && !(await visible("strip-add-screen")) && (await b.evaluate(`document.getElementById("sp0-name").classList.contains("hw-sr-only") && /^Screen 2 of 2: /.test(document.getElementById("sp0-name").textContent)`)));
			const twoHead = await headHeight();
			check(`screens: the row costs This screen's line no more than a field's height (${oneHead} px with one, ${twoHead} px with two)`, twoHead - oneHead <= 12, JSON.stringify({ oneHead, twoHead }));
			check(`screens: no new help lines (${await helpLines()} with two screens, ${oneHelp} with one)`, (await helpLines()) <= oneHelp);
			check("screens: the row, its tools, Next screen and the count slot carry no help block", (await b.evaluate(`document.querySelectorAll("#strip-screens .hw-help, #strip-screens .hw-hint, #strip-cycle-item .hw-help, #strip-cycle-item .hw-hint, #sp0-check.hw-help").length`)) === 0);

			// A filter with a dead alternative, typed for this screen.
			n = edits().length;
			await typeInto("sp0-filter", "*core*clock*|*l3 cahce*");
			await settled(n + 1);
			check("screens: the filter goes to the new screen's own path", edits().at(-1).patch.some((op) => op.path === "screens.0.group") && storedConfig().screens?.[0]?.group?.filter === "*core*clock*|*l3 cahce*", JSON.stringify(edits().at(-1).patch));
			await waitFor("dead alternative named", async () => / \*l3 cahce\* matches nothing\.$/.test((await text("sp0-check")) ?? ""), 4000);
			check("screens: the count slot names the alternative that matches nothing, as a warning", (await b.evaluate(`document.getElementById("sp0-check").dataset.tone`)) === "warn", await text("sp0-check"));

			// The screen before: a real press on the arrow shows it, runtime only, no reflow.
			const first = screenIds()[0];
			const writesBefore = pluginWrites();
			const editsBefore = edits().length;
			const before1 = await press("#strip-screen-prev");
			await waitFor("screen 1 on the strip", () => onStrip() === first, 3000);
			await sleep(200);
			check("screens: a press on the screen before shows it with stripShowScreen and no stripEdit", shows().at(-1)?.screenId === first && edits().length === editsBefore);
			check("screens: showing a screen writes no settings (panel or plugin)", pluginWrites() === writesBefore && panelWrites() === panelWritesAtStart, JSON.stringify({ plugin: pluginWrites() - writesBefore, panel: panelWrites() - panelWritesAtStart }));
			check("screens: the press lands on the arrow and no box above it moves (0 px)", before1.sameTarget && before1.moved.length === 0, JSON.stringify(before1.moved.slice(0, 6)));
			check("screens: the box follows: screen 1's Trend, its reading; the list chooses it, 1 of 2; the screen before says there is none", (await styleOf(0)) === "trend" && same(await series(0), ["Core 0 Temp · °C"]) && (await options())[0].selected && (await place()) === "1 of 2" && (await b.evaluate(`document.getElementById("strip-screen-prev").getAttribute("aria-disabled")`)) === "true", JSON.stringify(await series(0)));

			// On screen 1 the screen before does nothing, the screen after works:
			// the two arrows must not look alike, in normal and in forced colors.
			// Ink is the arrow's text color, its rim, its stroke and its opacity;
			// the fill counts only where it differs from what shows behind it.
			const stepLook = () =>
				b.evaluate(`["strip-screen-prev", "strip-screen-next"].map((id) => {
					const e = document.getElementById(id);
					const s = getComputedStyle(e);
					const clear = (c) => c === "transparent" || c === "rgba(0, 0, 0, 0)";
					let shown = s.backgroundColor;
					for (let a = e.parentElement; clear(shown) && a !== null; a = a.parentElement) shown = getComputedStyle(a).backgroundColor;
					return { disabled: e.getAttribute("aria-disabled"), ink: [s.color, s.borderTopColor, s.borderTopStyle, getComputedStyle(e.querySelector("svg")).stroke, s.opacity].join(" | "), fill: s.backgroundColor, shown };
				})`);
			// At rest: the pointer off both arrows and neither focused, so a hover
			// or focus mark from the press above does not stand in for the state.
			await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
			await b.evaluate(`document.activeElement?.blur()`);
			for (const mode of ["normal", "forced"]) {
				if (mode === "forced") await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
				await sleep(150);
				const [prevLook, nextLook] = await stepLook();
				check(`screens (${mode}): the screen before (none on screen 1) does not look like the screen after (its ink or what shows differs)`, prevLook.disabled === "true" && nextLook.disabled !== "true" && (prevLook.ink !== nextLook.ink || prevLook.shown !== nextLook.shown), JSON.stringify({ prev: prevLook, next: nextLook }));
			}
			await b.send("Emulation.setEmulatedMedia", { features: [] });
			await sleep(150);

			// Rename (F2 on the list): the name field takes the list's place, at its size.
			const pickBox = (id) => b.evaluate(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })()`);
			const selectBox = await pickBox("strip-screen-select");
			const placeBox = await pickBox("strip-screen-place");
			await b.evaluate(`document.getElementById("strip-screen-select").focus()`);
			await b.key("F2");
			await sleep(100);
			const field = await b.evaluate(`(() => { const i = document.getElementById("strip-screen-name"); return { shown: i.getClientRects().length > 0, focused: document.activeElement === i, label: i.getAttribute("aria-label"), placeholder: i.placeholder }; })()`);
			const nameBox = await pickBox("strip-screen-name");
			check("screens: F2 on the list opens the name field in its place, focused, named for its screen", field.shown && field.focused && /^Name of screen 1; empty shows Core 0 Temp$/.test(field.label ?? ""), JSON.stringify(field));
			check(`screens: the name field keeps the list's box and the place where it was (${JSON.stringify([selectBox, nameBox])})`, selectBox.every((v, i) => Math.abs(v - nameBox[i]) <= 1) && same(placeBox, await pickBox("strip-screen-place")));
			n = edits().length;
			await b.type("CPU temps");
			await b.key("Enter");
			await settled(n + 1);
			check("screens: Enter applies the name to the screen's own path", same(edits().at(-1).patch, [{ op: "set", path: "panes.0.name", value: "CPU temps" }]) && storedConfig().panes[0].name === "CPU temps", JSON.stringify(edits().at(-1).patch));
			await waitFor("renamed", async () => (await options())[0].name === "CPU temps", 3000);
			check("screens: the list and the fold's legend name it; focus is back on the list", (await text("sp0-extra-name")) === "CPU temps" && (await b.evaluate(`document.activeElement?.id`)) === "strip-screen-select");

			// Next screen: one edit of the cycle.
			n = edits().length;
			await setSelect("strip-cycle", "30");
			await settled(n + 1);
			check("screens: Next screen Every 30 seconds is one stripEdit of screenCycle", same(edits().at(-1).patch, [{ op: "set", path: "screenCycle", value: 30 }]) && storedConfig().screenCycle === 30);
			await sleep(1200);
			if (reported()?.cycleHeld === true) check("screens: while this panel is open the caption says the cycle is held", /^On the deck now · held while this panel is open$/.test((await text("strip-caption")) ?? ""), await text("strip-caption"));
			else check("screens: the plugin holds the cycle while a member's panel is open (cycleHeld)", false, JSON.stringify({ cycleHeld: reported()?.cycleHeld }));
			n = edits().length;
			await setSelect("strip-cycle", "0");
			await settled(n + 1);
			check("screens: By hand clears it (null)", same(edits().at(-1).patch, [{ op: "set", path: "screenCycle", value: null }]) && storedConfig().screenCycle === undefined);

			// Keyboard on the list: Right and Left show, Alt with an arrow moves, End and Home.
			await b.evaluate(`document.getElementById("strip-screen-select").focus()`);
			await b.key("ArrowRight");
			await waitFor("screen 2 on the strip by arrow", () => onStrip() === added, 3000);
			check("screens: Right Arrow on the list shows the next screen (stripShowScreen, no edit)", shows().at(-1)?.screenId === added);
			n = edits().length;
			await b.key("ArrowLeft", { alt: true });
			await settled(n + 1);
			check("screens: Alt+Left moves the screen on the strip earlier (moveScreen 1 to 0), and it stays on the strip", same(edits().at(-1).patch, [{ op: "moveScreen", from: 1, to: 0 }]) && screenIds()[0] === added && onStrip() === added, JSON.stringify(edits().at(-1).patch));
			await sleep(200);
			check("screens: the list follows: it is first and chosen", (await options())[0].id === added && (await options())[0].selected && (await place()) === "1 of 2");
			await b.key("End");
			await waitFor("End shows the last screen", () => onStrip() === screenIds().at(-1), 3000);
			await sleep(150);
			check("screens: End shows the last screen; the list chooses it", (await options()).at(-1).selected && /^Screen 2 of 2: /.test(await text("sp0-name")));
			await b.key("Home");
			await waitFor("Home shows the first screen", () => onStrip() === screenIds()[0], 3000);
			check("screens: Home shows the first screen", onStrip() === added);

			// Edit opens the tools; Rename there leaves nothing written when left unchanged.
			await b.click("#strip-screen-edit");
			await sleep(100);
			check("screens: Edit opens one row of tools (Rename, Earlier, Later, Remove, Add, with Build screens beside them or on a quiet row under them) and says it is open", (await visible("strip-screen-tools")) && (await b.evaluate(`document.getElementById("strip-screen-edit").getAttribute("aria-expanded")`)) === "true" && (await text("strip-screen-edit")) === "Done" && same(await b.evaluate(`[...document.querySelectorAll("#strip-screen-tools button")].map((x) => x.dataset.tool)`), ["rename", "earlier", "later", "remove", "add", "build"]) && (await b.evaluate(`new Set([...document.querySelectorAll('#strip-screen-tools button:not([data-tool="build"])')].map((x) => Math.round(x.getBoundingClientRect().top))).size`)) === 1);
			n = edits().length;
			await b.click('#strip-screen-tools button[data-tool="rename"]');
			await sleep(150);
			check("screens: Rename opens the name field", await b.evaluate(`document.activeElement?.id === "strip-screen-name"`));
			await b.key("Tab");
			await sleep(300);
			check("screens: leaving the field unchanged writes nothing and closes it", edits().length === n && (await visible("strip-screen-select")) && !(await visible("strip-screen-name")));

			// A real press on Later in the tools: no box above it moves.
			n = edits().length;
			const later = await press('#strip-screen-tools button[data-tool="later"]');
			await settled(n + 1);
			check("screens: Later (a real press) is one moveScreen 0 to 1", same(edits().at(-1).patch, [{ op: "moveScreen", from: 0, to: 1 }]), JSON.stringify(edits().at(-1).patch));
			check("screens: the press on Later lands and no box above it moves (0 px)", later.sameTarget && later.moved.length === 0, JSON.stringify(later.moved.slice(0, 6)));

			// Up to eight: the row never grows with the count.
			const heads = {};
			for (let k = 3; k <= 8; k++) {
				n = edits().length;
				const at = screenIds().indexOf(onStrip());
				await b.click('#strip-screen-tools button[data-tool="add"]');
				await settled(n + 1);
				await waitScreens(k);
				check(`screens: Add ${k} goes right after the screen on the strip (${at + 1})`, same(edits().at(-1).patch, [{ op: "addScreen", at: at + 1, from: "group" }]), JSON.stringify(edits().at(-1).patch));
				await waitFor(`screen ${k} on the strip`, () => onStrip() === screenIds()[at + 1], 3000);
				await sleep(250);
				await openTools();
				heads[k] = await headHeight();
			}
			console.log(`INFO  screens: This screen's block with Edit open: ${Object.entries(heads).map(([k, h]) => `${k} screens ${h} px`).join(", ")}`);
			check("screens: This screen's block keeps one height from three screens to eight (one row and the tools)", new Set(Object.values(heads)).size === 1, JSON.stringify(heads));
			const add = await b.evaluate(`(() => { const a = document.querySelector('#strip-screen-tools button[data-tool="add"]'); return { disabled: a.getAttribute("aria-disabled"), focusable: !a.disabled, label: a.getAttribute("aria-label"), title: a.title }; })()`);
			check("screens: at eight, Add says why it does nothing (aria-disabled and focusable, its name and title)", add.disabled === "true" && add.focusable && /A strip keeps at most 8 screens/.test(add.label ?? "") && /A strip keeps at most 8 screens/.test(add.title ?? ""), JSON.stringify(add));
			n = edits().length;
			await b.click('#strip-screen-tools button[data-tool="add"]');
			await sleep(300);
			const said = await b.evaluate(`[...document.querySelectorAll("body > .hw-sr-only[role=status]")].map((e) => e.textContent.trim()).join(" | ")`);
			check("screens: a press on Add at eight sends nothing and says why", edits().length === n && /A strip keeps at most 8 screens/.test(said), said);
			check(`screens: no new help lines with eight (${await helpLines()})`, (await helpLines()) <= oneHelp);

			// Delete twice on the list removes the screen on the strip; once only arms.
			const before = screenIds();
			const gone = onStrip();
			await b.evaluate(`document.getElementById("strip-screen-select").focus()`);
			n = edits().length;
			await b.key("Delete");
			await sleep(250);
			check("screens: one Delete arms Remove (in words, the tools open) and sends nothing", edits().length === n && (await visible("strip-screen-tools")) && (await b.evaluate(`document.querySelector('#strip-screen-tools button[data-tool="remove"]').dataset.armed`)) === "true" && /^Press again to remove/.test(await b.evaluate(`document.querySelector('#strip-screen-tools button[data-tool="remove"]').getAttribute("aria-label")`)));
			await b.key("Delete");
			await settled(n + 1);
			check("screens: the second Delete removes it: removeScreen at its place", same(edits().at(-1).patch, [{ op: "removeScreen", at: before.indexOf(gone) }]) && !screenIds().includes(gone), JSON.stringify(edits().at(-1).patch));
			await waitScreens(7);

			// Remove by pointer: one press arms, a second (not a double click) removes.
			n = edits().length;
			await b.click('#strip-screen-tools button[data-tool="remove"]');
			await sleep(500);
			check("screens: one press on Remove arms it and sends nothing", edits().length === n);
			await b.click('#strip-screen-tools button[data-tool="remove"]');
			await settled(n + 1);
			check("screens: the second press removes", edits().at(-1).patch[0]?.op === "removeScreen");
			await waitScreens(6);

			// Typed text belongs to its screen when the deck moves on.
			const ids = screenIds();
			await setSelect("strip-screen-select", ids[1]);
			await waitFor("screen 2 shown", () => onStrip() === ids[1], 3000);
			await sleep(200);
			check("screens: choosing a name in the list shows that screen (stripShowScreen)", shows().at(-1)?.screenId === ids[1]);
			if ((await styleOf(0)) !== "group") {
				n = edits().length;
				await setSelect("sp0-style", "group");
				await settled(n + 1);
				n = edits().length;
				await setSelect("sp0-from", "filter");
				await settled(n + 1);
			}
			n = edits().length;
			await b.evaluate(`(() => { const f = document.getElementById("sp0-filter"); f.focus(); f.value = ""; })()`);
			await b.type("*vrm*");
			// The Screens dial (the last dial of the strip) turns one detent.
			sim.strip.input(5, { kind: "dialRotate", ticks: 1, pressed: false });
			await waitFor("the deck moved on", () => onStrip() === ids[2], 3000);
			await settled(n + 1);
			check("screens: text typed for a screen goes to that screen after the deck moved on", edits().at(-1).patch.some((op) => op.path === "screens.0.group" && op.value?.filter === "*vrm*") && storedConfig().screens[0].group.filter === "*vrm*", JSON.stringify(edits().at(-1).patch));
			await sleep(300);
			check("screens: the box follows the deck to the next screen", (await options())[2].selected && (await b.evaluate(`document.getElementById("sp0-filter").value`)) !== "*vrm*");

			// Pushes move no box (normal and forced colors), on the first screen.
			await setSelect("strip-screen-select", ids[0]);
			await waitFor("screen 1 shown again", () => onStrip() === ids[0], 3000);
			const boxes = () => b.evaluate(`[...document.querySelectorAll("#sec-strip *")].filter((e) => e.getClientRects().length > 0).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x * 10), Math.round(r.y * 10), Math.round(r.width * 10), Math.round(r.height * 10)].join(","); }).join(";")`);
			await b.evaluate(`document.activeElement?.blur()`);
			for (const mode of ["normal", "forced"]) {
				if (mode === "forced") await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
				await sleep(300);
				const pushes = sim.toPiLog.filter((p) => p.event === "stripState").length;
				const first_ = await boxes();
				await waitFor("two live pushes", async () => sim.toPiLog.filter((p) => p.event === "stripState").length >= pushes + 2, 6000);
				check(`screens (${mode}): pushed states move no box`, first_ === (await boxes()));
			}
			await b.send("Emulation.setEmulatedMedia", { features: [] });
			const rowBoxes = () => b.evaluate(`["strip-screen-prev", "strip-screen-select", "strip-screen-next", "strip-screen-place", "strip-screen-edit"].map((id) => JSON.stringify(document.getElementById(id).getBoundingClientRect()))`);
			await b.evaluate(`document.getElementById("strip-screen-select").focus()`);
			const fillOnly = await rowBoxes();
			sim.strip.input(5, { kind: "dialRotate", ticks: 1, pressed: false });
			await waitFor("the deck moved again", () => onStrip() === ids[1], 3000);
			await sleep(300);
			check("screens: a move of the strip changes the list's choice and the place's digits, never a box of the row", same(fillOnly, await rowBoxes()) && (await place()) === "2 of 6");
			const saidMove = await b.evaluate(`[...document.querySelectorAll("body > .hw-sr-only[role=status]")].map((e) => e.textContent.trim()).join(" | ")`);
			check(`screens: a move the deck made is said while focus is on the list (${saidMove})`, / on the strip, 2 of 6$/.test(saidMove.split(" | ").find((t) => /on the strip/.test(t)) ?? ""), saidMove);

			// Narrow: nothing past the edge with six screens, the tools open.
			await openTools();
			for (const width of [320, 189]) {
				await b.viewport(width, 900);
				await sleep(250);
				const overflow = await b.evaluate(`(() => { const s = document.getElementById("sec-strip"); const right = s.getBoundingClientRect().right + 1; return [...s.querySelectorAll("*")].filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().right > right).map((e) => e.id || e.className || e.tagName).slice(0, 5); })()`);
				check(`screens (${width} px): nothing in the Strip section runs past its edge`, overflow.length === 0, JSON.stringify(overflow));
			}
			// At 189 px the list keeps room for a name, Edit open or closed:
			// the first four characters of the chosen name fit inside its
			// padding and arrow, every control of the row shows, and with
			// Edit closed the row takes its two lines and no more (58 px).
			const nameRoom = () =>
				b.evaluate(`JSON.stringify((() => {
					const s = document.getElementById("strip-screen-select");
					const cs = getComputedStyle(s);
					const c = document.createElement("canvas").getContext("2d");
					c.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
					const name = s.options[s.selectedIndex]?.text ?? "";
					const room = Math.floor(s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 16);
					const shows = (id) => document.getElementById(id).getClientRects().length > 0;
					return { name, room, first: Math.ceil(c.measureText(name.slice(0, 4)).width), all: ["strip-screen-prev", "strip-screen-select", "strip-screen-next", "strip-screen-place", "strip-screen-edit"].every(shows), height: Math.round(document.getElementById("strip-screens").getBoundingClientRect().height) };
				})())`).then(JSON.parse);
			const editOpen = () => b.evaluate(`document.getElementById("strip-screen-edit").getAttribute("aria-expanded") === "true"`);
			for (const open_ of [true, false]) {
				if ((await editOpen()) !== open_) await b.click("#strip-screen-edit");
				await sleep(150);
				const roomNow = await nameRoom();
				check(`screens (189 px, Edit ${open_ ? "open" : "closed"}): the list shows the first characters of ${roomNow.name} (${roomNow.first} px in ${roomNow.room}) and every control of the row${open_ ? "" : `, in ${roomNow.height} px (58 before)`}`, roomNow.name.length > 0 && roomNow.first <= roomNow.room && roomNow.all && (open_ || roomNow.height <= 58), JSON.stringify(roomNow));
			}
			// Tab goes through the row as it reads, a line at a time and left
			// to right: at 189 px Edit on This screen's line, then the
			// arrows and the list on the next.
			const rowTabs = async () => {
				const ids = ["strip-screen-prev", "strip-screen-select", "strip-screen-next", "strip-screen-edit"];
				const read = await b
					.evaluate(`JSON.stringify(${JSON.stringify(ids)}.map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { id, mid: r.top + r.height / 2, left: r.left }; }).sort((p, q) => (Math.abs(p.mid - q.mid) > 4 ? p.mid - q.mid : p.left - q.left)).map((e) => e.id))`)
					.then(JSON.parse);
				await b.evaluate(`document.getElementById(${JSON.stringify(read[0])}).focus()`);
				const tabbed = [await b.evaluate(`document.activeElement?.id`)];
				for (let i = 1; i < read.length; i++) {
					await b.key("Tab");
					tabbed.push(await b.evaluate(`document.activeElement?.id`));
				}
				await b.evaluate(`document.activeElement?.blur()`);
				return { read, tabbed };
			};
			const narrowTabs = await rowTabs();
			check(`screens (189 px): Tab goes through the row as it reads (${narrowTabs.tabbed.join(", ")})`, narrowTabs.read[0] === "strip-screen-edit" && same(narrowTabs.tabbed, narrowTabs.read), JSON.stringify(narrowTabs));
			await openTools();
			await b.viewport(400, 900);
			await sleep(250);
			const wideTabs = await rowTabs();
			check(`screens (400 px): Tab goes through the row as it reads, Edit last (${wideTabs.tabbed.join(", ")})`, wideTabs.read.at(-1) === "strip-screen-edit" && same(wideTabs.tabbed, wideTabs.read), JSON.stringify(wideTabs));

			// Down to one screen: the row goes, This screen's name and Add a screen return.
			for (let k = 6; k > 1; k--) {
				await b.evaluate(`document.getElementById("strip-screen-select").focus()`);
				n = edits().length;
				await b.key("Delete");
				await b.key("Delete");
				await settled(n + 1);
				await waitFor(`${k - 1} screens`, () => screenIds().length === k - 1, 3000);
				await sleep(150);
			}
			await waitFor("one screen again", async () => (await visible("strip-add-screen")) && !(await visible("strip-screen-pick")), 3000);
			check("screens: removing down to one screen brings back This screen's name and Add a screen, the tools gone", /^This screen/.test((await text("strip-screen-label")) ?? "") && !(await visible("strip-screen-tools")) && !(await visible("strip-cycle-item")));
			check("screens: the panel wrote no settings in any of it", panelWrites() === panelWritesAtStart);
		}
	}

	// ---- names and Build screens on a running + XL strip of two screens ---------------------------
	{
		const gsnap = groupSnapshot();
		const gpuTemp = keyOf(gsnap, 1, "GPU Temperature");
		const xl = sim.fixtures["dial-strip-xl"].strip;
		await open("dial-strip-xl", { snapshot: gsnap, strip: { ...xl, create: { layout: "whole", from: 2, patch: [{ op: "set", path: "panes.0.series", value: [{ key: gpuTemp }] }, { op: "set", path: "panes.0.style", value: "area" }, { op: "set", path: "panes.0.readout", value: "left" }, { op: "addScreen", at: 1, from: "group" }] } } });
		await waitFor("running strip editor", () => visible("strip-edit"), 6000);
		const names = () => b.evaluate(`[...document.querySelectorAll("#strip-screen-select option")].map((o) => o.textContent)`);
		const reported = () => stripState()?.group;
		const onStrip = () => reported()?.screen;
		const ids = () => {
			const c = stored().config;
			return [c.panes[0], ...(c.screens ?? [])].map((p) => p.screenId);
		};
		const all = () => {
			const c = stored().config;
			return [c.panes[0], ...(c.screens ?? [])];
		};
		await waitFor("two screens", async () => (await names()).length === 2, 4000);
		check("names: a screen of ticked readings is named by its first reading; a new Group with no filter by its place", same(await names(), ["GPU Temperature", "Screen 2"]), JSON.stringify(await names()));
		check("names: the plugin names it the same way", reported()?.screens?.[0]?.autoName === "GPU Temperature", JSON.stringify(reported()?.screens));
		// Screen 2, added by hand, gets its first reading: it takes the
		// reading's sensor as its name in the same edit.
		await setSelect("strip-screen-select", ids()[1]);
		await waitFor("screen 2 on the strip", () => onStrip() === ids()[1], 3000);
		await sleep(200);
		let n = edits().length;
		await setSelect("sp0-style", "trend");
		await settled(n + 1);
		n = edits().length;
		check("names: GPU Temperature ticks on screen 2", (await tick(0, "GPU Temperature")) === true);
		await settled(n + 1);
		check("names: the tick and the name go in one edit: screen 2 is GPU, its reading's sensor", edits().at(-1).patch.some((op) => op.path === "screens.0.series") && edits().at(-1).patch.some((op) => op.path === "screens.0.name" && op.value === "GPU") && all()[1].name === "GPU", JSON.stringify(edits().at(-1).patch));
		check("names: the list says GPU", same(await names(), ["GPU Temperature", "GPU"]), JSON.stringify(await names()));
		// The name follows the first reading while it is one it took that way.
		n = edits().length;
		await b.evaluate(`document.querySelector("#sp0-series button[data-key]").click()`);
		await settled(n + 1);
		check("names: with nothing drawn again, the taken name goes (Screen 2)", all()[1].name === undefined && same(await names(), ["GPU Temperature", "Screen 2"]), JSON.stringify([all()[1].name, await names()]));
		n = edits().length;
		check("names: CPU (Tctl/Tdie) ticks on screen 2", (await tick(0, "CPU (Tctl/Tdie)")) === true);
		await settled(n + 1);
		check("names: the new first reading names it CPU", all()[1].name === "CPU" && same(await names(), ["GPU Temperature", "CPU"]), JSON.stringify([all()[1].name, await names()]));
		// A name the person gives stays, whatever the readings.
		await b.evaluate(`document.getElementById("strip-screen-select").focus()`);
		await b.key("F2");
		await sleep(100);
		n = edits().length;
		await b.evaluate(`(() => { const i = document.getElementById("strip-screen-name"); i.select(); })()`);
		await b.type("Mine");
		await b.key("Enter");
		await settled(n + 1);
		n = edits().length;
		await b.evaluate(`document.querySelector("#sp0-series button[data-key]").click()`);
		await settled(n + 1);
		n = edits().length;
		check("names: GPU Temperature ticks again", (await tick(0, "GPU Temperature")) === true);
		await settled(n + 1);
		check("names: a name the person gave stays (Mine)", all()[1].name === "Mine" && !edits().slice(-2).some((e) => e.patch.some((op) => op.path?.endsWith(".name"))) && same(await names(), ["GPU Temperature", "Mine"]), JSON.stringify([all()[1].name, await names()]));

		// Build screens on a running strip of two screens: a tool among the
		// others, what is not on the strip yet, appended in one stripEdit, each
		// with its origin and no name.
		check("quick: no select on a running strip, and with two screens the link is a tool beside Add", !(await visible("strip-build")) && (await b.evaluate(`document.getElementById("strip-quick") === null`)) && (await b.evaluate(`[...document.querySelectorAll("#strip-screen-tools button")].map((x) => x.dataset.tool).slice(-2).join()`)) === "add,build");
		const writesBefore = panelWrites();
		await openBuild();
		await sleep(150);
		check("build: the title says it adds five after screen 2", (await text("strip-build-title")) === "Build screens for this PC: adds 5 after screen 2.", await text("strip-build-title"));
		check("build: the list opens under the screen row, above the Graph, focus on its button, its tool says so", await b.evaluate(`(() => { const box = document.getElementById("strip-build-box"); const row = document.querySelector(".hw-strip-screen-head"); const graph = document.getElementById("sp0-style"); const tool = document.querySelector('#strip-screen-tools button[data-tool="build"]'); return document.getElementById("strip-screens").contains(box) && (row.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && (box.compareDocumentPosition(graph) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && document.activeElement?.id === "strip-build-use" && tool.getAttribute("aria-expanded") === "true"; })()`));
		const items = await b.evaluate(`[...document.querySelectorAll("#strip-build-list li")].map((li) => [li.textContent, li.dataset.found])`);
		check("build: GPU is left out (the strip draws its reading already) and said; the rest are named and counted", same(items.map((x) => [x[0].split(" · ")[0], x[1]]), [["CPU", "true"], ["CPU and GPU", "true"], ["Cooling", "true"], ["Core clocks", "true"], ["Every temperature", "true"], ["Already on the strip: GPU.", "same"]]), JSON.stringify(items));
		check("build: Use says screens, and its way out is Cancel", (await text("strip-build-use")) === "Use these screens" && (await text("strip-build-no")) === "Cancel");
		// Ticks: an unticked screen stays off, and the count follows.
		await listTick("cooling", false);
		check("build: a tick off, the title counts four", (await text("strip-build-title")) === "Build screens for this PC: adds 4 after screen 2.", await text("strip-build-title"));
		await listTick("cooling", true);
		// Cancel closes with nothing sent and hands focus back.
		n = edits().length;
		await b.click("#strip-build-no");
		await sleep(150);
		check("build: Cancel closes it, sends nothing, and focus is back on the tool", !(await visible("strip-build-box")) && edits().length === n && (await b.evaluate(`document.activeElement?.dataset?.tool`)) === "build");
		await openBuild();
		await sleep(150);
		n = edits().length;
		const use = await press("#strip-build-use", 250);
		check("build: a real press on Use these screens lands, and no box above it moves", use.sameTarget && use.moved.length === 0, JSON.stringify([use.downOn, use.upOn, use.moved.slice(0, 6)]));
		await settled(n + 1);
		const patch = edits().at(-1).patch;
		check("build: one stripEdit, every operation in it, added after the two there were, each with its origin and Build's label", edits().length === n + 1 && patch.length <= 40 && same(patch.filter((op) => op.op === "addScreen").map((op) => op.at), [2, 3, 4, 5, 6]) && same(patch.filter((op) => op.path?.endsWith(".origin")).map((op) => op.value), ["cpu", "cpu-gpu", "cooling", "clocks", "temps"]) && same(patch.filter((op) => op.path?.endsWith(".name")).map((op) => op.value), ["CPU", "CPU and GPU", "Cooling", "Core clocks", "Every temperature"]), JSON.stringify(patch.map((op) => (op.op === "set" ? op.path : `${op.op}@${op.at}`))));
		check("build: the two screens there were are unchanged", all().length === 7 && all()[0].series[0]?.key === gpuTemp && all()[1].name === "Mine", JSON.stringify(all().map((p) => [p.name, p.style, p.origin])));
		await waitFor("the first new screen on the strip", () => onStrip() === ids()[2], 3000);
		await waitFor("seven screens listed", async () => (await names()).length === 7, 3000);
		const seven = await names();
		check("build: the list names every screen, the built ones by Build's label, no two alike", same(seven, ["GPU Temperature", "Mine", "CPU", "CPU and GPU", "Cooling", "Core clocks", "Every temperature"]) && new Set(seven).size === 7, JSON.stringify(seven));
		check("build: the first new screen shows on the strip and in the box; the list is closed", (await styleOf(0)) === "lanes" && !(await visible("strip-build-box")));
		// Its readings change: Build's label no longer names it; they come back: it does again.
		n = edits().length;
		await b.evaluate(`[...document.querySelectorAll("#sp0-series button[data-key]")].at(-1).click()`);
		await settled(n + 1);
		check("build: a built screen whose readings change takes its first reading's sensor with +N, in the same edit", edits().at(-1).patch.some((op) => op.path === "screens.1.series") && edits().at(-1).patch.some((op) => op.path === "screens.1.name" && op.value === "CPU +1") && (await names())[2] === "CPU +1", JSON.stringify([edits().at(-1).patch, await names()]));
		n = edits().length;
		check("build: CPU Package Power ticks again", (await tick(0, "CPU Package Power")) === true);
		await settled(n + 1);
		check("build: drawing what Build gave it again, it is CPU again", all()[2].name === "CPU" && (await names())[2] === "CPU", JSON.stringify([all()[2].name, await names()]));
		// Built again: nothing new.
		await openBuild();
		await sleep(150);
		const again = await listRows();
		check("build: built again, the title says the strip has every screen it finds, Use does nothing", (await text("strip-build-title")) === "Build screens for this PC: the strip already has every screen it finds." && same(again, ["Already on the strip: CPU, GPU, CPU and GPU, Cooling, Core clocks, Every temperature."]) && (await useDisabled()), JSON.stringify([await text("strip-build-title"), again]));
		n = edits().length;
		await b.click("#strip-build-use");
		await sleep(400);
		check("build: pressing it sends nothing", edits().length === n);
		await b.click("#strip-build-no");
		// Core clocks removed, a screen added by hand: eight, Core clocks has no room.
		await setSelect("strip-screen-select", ids()[5]);
		await waitFor("Core clocks on the strip", () => onStrip() === ids()[5], 3000);
		await b.evaluate(`document.getElementById("strip-screen-select").focus()`);
		n = edits().length;
		await b.key("Delete");
		await b.key("Delete");
		await settled(n + 1);
		for (let k = 7; k <= 8; k++) {
			n = edits().length;
			if ((await b.evaluate(`document.getElementById("strip-screen-edit").getAttribute("aria-expanded")`)) !== "true") await b.click("#strip-screen-edit");
			await b.click('#strip-screen-tools button[data-tool="add"]');
			await settled(n + 1);
		}
		await waitFor("eight screens", async () => (await names()).length === 8, 4000);
		await openBuild();
		await sleep(150);
		const full = await b.evaluate(`[...document.querySelectorAll("#strip-build-list li")].map((li) => [li.textContent, li.dataset.found])`);
		check("build: at eight, the title says the strip is full; Core clocks has no room; the rest are already there", (await text("strip-build-title")) === "Build screens for this PC: this strip already keeps 8 screens." && same(full, [["Core clocks: no room, a strip keeps at most 8 screens.", "false"], ["Already on the strip: CPU, GPU, CPU and GPU, Cooling, Every temperature.", "same"]]) && (await useDisabled()), JSON.stringify([await text("strip-build-title"), full]));
		await b.click("#strip-build-no");
		// One hand screen removed: Core clocks fits again, at the end.
		await b.evaluate(`document.getElementById("strip-screen-select").focus()`);
		n = edits().length;
		await b.key("Delete");
		await b.key("Delete");
		await settled(n + 1);
		await openBuild();
		await sleep(150);
		check("build: with seven, it adds the one not there", (await text("strip-build-title")) === "Build screens for this PC: adds 1 after screen 7.", await text("strip-build-title"));
		n = edits().length;
		await b.click("#strip-build-use");
		await settled(n + 1);
		await waitFor("eight screens again", async () => (await names()).length === 8, 4000);
		const eight = await names();
		check("build: it adds Core clocks at the end, and no two screens share a name", all().at(-1).origin === "clocks" && eight.at(-1) === "Core clocks" && new Set(eight).size === 8, JSON.stringify(eight));
		check("build: the panel wrote no settings itself", panelWrites() === writesBefore);
	}

	// ---- one screen: the link, and the rows that share a line, at 378 and 189 px ------------------
	{
		const xl = sim.fixtures["dial-strip-xl"].strip;
		const row = () => b.evaluate(`JSON.stringify((() => { const top = (id) => document.getElementById(id).getBoundingClientRect(); const add = top("strip-add-screen"); const link = top("strip-build"); const name = top("strip-screen-label"); const style = top("sp0-style"); const readout = top("sp0-readout"); const windowField = top("strip-window"); const windowLabel = document.querySelector('label[for="strip-window"]').getBoundingClientRect(); const more = top("sec-stripmore"); const stripLink = top("sec-striplink"); const body = document.getElementById("sec-strip").getBoundingClientRect(); const over = [...document.querySelectorAll("#sec-strip *")].filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().right > body.right + 1).length; return { linksOneRow: Math.abs(add.top - link.top) < 1, linksOnName: Math.abs((name.top + name.bottom) / 2 - (link.top + link.bottom) / 2) <= 2, graphRow: Math.abs(style.top - readout.top) < 1, windowOneRow: Math.abs((windowLabel.top + windowLabel.bottom) / 2 - (windowField.top + windowField.bottom) / 2) <= 2, foldsOneRow: Math.abs(more.top - stripLink.top) < 1, over, height: Math.round(body.height) }; })())`).then(JSON.parse);
		const patch = [{ op: "set", path: "panes.0.series", value: [{ key: keyOf(sampleSnapshot(), 1, "GPU Hot Spot Temperature") }] }];
		await b.viewport(378, 900);
		await open("dial-strip-xl", { strip: { ...xl, create: { layout: "whole", from: 2, patch } } });
		await waitFor("running strip editor", () => visible("strip-edit"), 6000);
		const wide = await row();
		check(`row (378 px): Build screens and Add a screen end the row that names the screen`, wide.linksOneRow && wide.linksOnName, JSON.stringify(wide));
		check(`row (378 px): Graph with Readout, Time window with its label, and the two folds each share a line`, wide.graphRow && wide.windowOneRow && wide.foldsOneRow, JSON.stringify(wide));
		check(`row (378 px): nothing runs past the section, and the Strip section is ${wide.height} px (681 before)`, wide.over === 0 && wide.height <= 530, JSON.stringify(wide));
		const longest = await b.evaluate(`JSON.stringify((() => { const c = document.createElement("canvas").getContext("2d"); const fit = (id, values) => { const s = document.getElementById(id); const cs = getComputedStyle(s); c.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily; const room = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 16; return [...s.options].filter((o) => values.includes(o.value)).map((o) => [o.text, Math.ceil(c.measureText(o.text).width), Math.floor(room)]); }; return [...fit("sp0-style", ["lanes", "group"]), ...fit("sp0-readout", ["left"]), ...fit("strip-window", ["15m"])]; })())`).then(JSON.parse);
		check("row (378 px): each shared select still shows its longest name whole", longest.every(([, width, room]) => width <= room), JSON.stringify(longest));
		// A fold opened takes the width, its fellow a line of its own; nothing is lost.
		await b.click("#sec-stripmore > summary");
		await sleep(120);
		const opened = await b.evaluate(`JSON.stringify((() => { const a = document.getElementById("sec-stripmore").getBoundingClientRect(); const c = document.getElementById("sec-striplink").getBoundingClientRect(); const s = document.getElementById("sec-strip").getBoundingClientRect(); return { full: Math.abs(a.width - s.width) <= 1, below: c.top >= a.bottom - 1, band: document.getElementById("sp0-band-add").getClientRects().length > 0 }; })())`).then(JSON.parse);
		check("row (378 px): Scale and alerts opened takes the whole width, and Strip Link ID its own line under it", opened.full && opened.below && opened.band, JSON.stringify(opened));
		await b.click("#sec-stripmore > summary");
		await sleep(120);
		// The link opens the list right there, and closes it again.
		await b.click("#strip-build");
		await sleep(150);
		check("row (378 px): the link opens the list under its row, and says so", (await visible("strip-build-box")) && (await b.evaluate(`document.getElementById("strip-build").getAttribute("aria-expanded")`)) === "true" && (await b.evaluate(`document.getElementById("strip-screens").contains(document.getElementById("strip-build-box"))`)));
		await b.click("#strip-build");
		await sleep(150);
		check("row (378 px): pressed again it closes, focus on the link", !(await visible("strip-build-box")) && (await b.evaluate(`document.activeElement?.id`)) === "strip-build");
		await b.viewport(189, 900);
		await sleep(250);
		const narrow = await row();
		check(`row (189 px): the two links share a quiet row under the name, and the Time window its label's line`, narrow.linksOneRow && !narrow.linksOnName && narrow.windowOneRow, JSON.stringify(narrow));
		check(`row (189 px): nothing runs past the section, and the Strip section is ${narrow.height} px (729 before)`, narrow.over === 0 && narrow.height <= 640, JSON.stringify(narrow));
		await b.viewport(400, 900);
		// An Equal split has no screens, so no link and no list.
		await b.click('input[name="strip-layout"][value="split"]');
		await sleep(400);
		check("row: a running Equal split has no Build screens", !(await visible("strip-build")) && !(await visible("strip-screen-tools")) && !(await visible("strip-build-box")));
	}

	// ---- narrow panels ---------------------------------------------------------------------------
	for (const width of [320, 189]) {
		await b.viewport(width, 700);
		await open("dial-strip-member");
		sim.strip.hide(3);
		await waitFor("dial 4 missing", async () => (await statusLine()) === "Dial 4 is missing", 4000);
		await b.evaluate(`document.getElementById("sec-stripmore").open = true`);
		const overflow = await b.evaluate(`(() => { const s = document.getElementById("sec-strip"); const right = s.getBoundingClientRect().right + 1; return [...s.querySelectorAll("*")].filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().right > right).map((e) => e.id || e.className || e.tagName).slice(0, 5); })()`);
		check(`narrow (${width} px): nothing in the Strip section runs past its edge, Scale and alerts open`, overflow.length === 0, JSON.stringify(overflow));
		const row = await b.evaluate(`(() => { const map = document.getElementById("strip-map").getBoundingClientRect(); const tops = new Set([...document.querySelectorAll("#strip-slots button")].map((m) => Math.round(m.getBoundingClientRect().top))); const status = document.getElementById("strip-device").getBoundingClientRect(); return { h: Math.round(map.height * 10) / 10, rows: tops.size, statusH: Math.round(status.height * 10) / 10, dial: Math.round(document.querySelector("#strip-slots button").getBoundingClientRect().width) }; })()`);
		check(`narrow (${width} px): the dials and the line of a missing dial stay one line (${row.h} px, marks ${row.dial} px)`, row.rows === 1 && row.h <= 30 && row.statusH <= 20 && row.dial === (width < 300 ? 20 : 28), JSON.stringify(row));
		// This dial leaves: its line and its two actions stay inside the section.
		await choose("independent");
		await waitFor("the left line", () => visible("strip-restore"), 4000);
		const leftOverflow = await b.evaluate(`(() => { const s = document.getElementById("sec-strip"); const right = s.getBoundingClientRect().right + 1; return [...s.querySelectorAll("*")].filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().right > right).map((e) => e.id || e.className || e.tagName).slice(0, 5); })()`);
		const leftActions = await b.evaluate(`[...document.querySelectorAll("#strip-restore button")].filter((e) => e.getClientRects().length > 0).map((e) => e.textContent)`);
		check(`narrow (${width} px): the line of the dial that left and its actions stay inside the section`, leftOverflow.length === 0 && same(leftActions, ["Rejoin", "Every dial leaves"]), JSON.stringify({ leftOverflow, leftActions }));
	}
	{
		// Build's list at 189 px: inside the section, its button and way out in reach.
		await b.viewport(189, 900);
		await open("dial-strip-xl", { snapshot: groupSnapshot({ threads: 16 }) });
		const over = await b.evaluate(`(() => { const s = document.getElementById("sec-strip"); const right = s.getBoundingClientRect().right + 1; return [...s.querySelectorAll("*")].filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().right > right).map((e) => e.id || e.className || e.tagName).slice(0, 5); })()`);
		const narrowRows = await b.evaluate(`[...document.querySelectorAll("#strip-build-list label.hw-check > span")].map((w) => w.getBoundingClientRect().height <= parseFloat(getComputedStyle(w).lineHeight) + 0.5)`);
		check("narrow (189 px): Build's list stays inside the section, its button and the dropdown in reach, each row one line", (await visible("strip-build-use")) && (await startPick())?.inBox === true && narrowRows.length === 7 && narrowRows.every(Boolean) && over.length === 0, JSON.stringify({ over, narrowRows }));
	}
	await b.viewport(400, 900);

	// ---- focus: an action that hides its own control hands focus on ------------------------------
	// Make the strip (its bar hides), and Remove or Delete taking a strip from
	// two screens to one (the list row and the tools hide): focus stays on a
	// visible control in the Strip section, never on the page.
	{
		const focusNow = () =>
			b.evaluate(`(() => {
				const a = document.activeElement;
				const name = a === null ? "null" : a === document.body ? "BODY" : a.id ? "#" + a.id : a.tagName + (a.name ? "[name=" + a.name + "]" : "") + (a.dataset?.tool ? "[data-tool=" + a.dataset.tool + "]" : "");
				const inStrip = a !== null && a !== document.body && document.getElementById("sec-strip").contains(a);
				const drawn = a !== null && a !== document.body && a.getClientRects().length > 0;
				return { name, inStrip, drawn };
			})()`);
		const kept = (f) => f.inStrip && f.drawn;
		const frame = () => b.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
		const plus = sim.fixtures["dial-strip-plus"];
		const twoScreens = { ...plus.strip, create: { layout: "whole", from: 1, patch: [{ op: "addScreen", at: 1, from: "group" }] } };
		const screenCount = () => b.evaluate(`document.querySelectorAll("#strip-screen-select option").length`);

		// Make the strip with Enter.
		await open("dial-strip-plus");
		await waitFor("Make the strip available", async () => (await b.evaluate(`document.getElementById("strip-build-use").getAttribute("aria-disabled")`)) !== "true", 3000);
		await b.evaluate(`document.getElementById("strip-build-use").focus()`);
		check("focus (make): it starts on Make the strip", (await focusNow()).name === "#strip-build-use", JSON.stringify(await focusNow()));
		await b.key("Enter");
		await waitNote(/^The strip is made\./, 4000);
		await waitFor("running strip editor", () => visible("strip-edit"), 4000);
		await sleep(300);
		await frame();
		const afterMake = await focusNow();
		check("focus (make): once Make the strip hides Build's list, focus is on a visible control in the Strip section", !(await visible("strip-build-box")) && kept(afterMake), JSON.stringify(afterMake));

		// Remove with Enter twice, two screens to one.
		await open("dial-strip-plus", { strip: twoScreens });
		await waitFor("running strip editor", () => visible("strip-edit"), 6000);
		await waitFor("two screens listed", async () => (await screenCount()) === 2, 4000);
		await b.click("#strip-screen-edit");
		await waitFor("screen tools", () => visible("strip-screen-tools"), 2000);
		await b.evaluate(`document.querySelector('#strip-screen-tools button[data-tool="remove"]').focus()`);
		let n = edits().length;
		await b.key("Enter");
		await sleep(700);
		await b.key("Enter");
		await settled(n + 1);
		await waitFor("one screen left", async () => !(await visible("strip-screen-pick")), 3000);
		await sleep(300);
		await frame();
		const afterRemove = await focusNow();
		check("focus (remove): once Remove takes the strip to one screen, focus is on a visible control in the Strip section", edits().length === n + 1 && edits().at(-1).patch[0]?.op === "removeScreen" && !(await visible("strip-screen-tools")) && kept(afterRemove), JSON.stringify(afterRemove));

		// Delete twice on the screen list, two screens to one.
		await open("dial-strip-plus", { strip: twoScreens });
		await waitFor("running strip editor", () => visible("strip-edit"), 6000);
		await waitFor("two screens listed", async () => (await screenCount()) === 2, 4000);
		await b.evaluate(`document.getElementById("strip-screen-select").focus()`);
		n = edits().length;
		await b.key("Delete");
		await sleep(700);
		await b.key("Delete");
		await settled(n + 1);
		await waitFor("one screen left", async () => !(await visible("strip-screen-pick")), 3000);
		await sleep(300);
		await frame();
		const afterDelete = await focusNow();
		check("focus (delete): once Delete takes the strip to one screen, focus is on a visible control in the Strip section", edits().length === n + 1 && edits().at(-1).patch[0]?.op === "removeScreen" && kept(afterDelete), JSON.stringify(afterDelete));
	}

	// ---- names (°F): Rename's empty name is the one the list shows -------------------------------
	{
		const plus = sim.fixtures["dial-strip-plus"];
		await open("dial-strip-plus", { strip: { ...plus.strip, create: { layout: "whole", from: 1, patch: [{ op: "set", path: "fahrenheit", value: true }, { op: "set", path: "panes.0.style", value: "ambient" }, { op: "addScreen", at: 1, from: "group" }] } } });
		await waitFor("running strip editor", () => visible("strip-edit"), 6000);
		await waitFor("two screens listed", async () => (await b.evaluate(`document.querySelectorAll("#strip-screen-select option").length`)) === 2, 4000);
		await b.evaluate(`document.getElementById("strip-screen-select").focus()`);
		await b.key("F2");
		await sleep(150);
		const named = await b.evaluate(`(() => { const s = document.getElementById("strip-screen-select"); return { listed: s.options[s.selectedIndex]?.textContent ?? null, placeholder: document.getElementById("strip-screen-name").placeholder }; })()`);
		check("names (°F): a unit screen on a strip that shows °F is Every °F in the list, and Rename's empty name says the same", named.listed === "Every °F" && named.placeholder === named.listed, JSON.stringify(named));
		await b.key("Escape");
	}

	// ---- back to a layout: the dial that left chooses its layout again ------------------------
	// Independent dials applies at once (a leave). Going back to the layout
	// (one arrow step back, or a click) must either bring the dial back or
	// keep Make the strip unavailable with a reason that names Rejoin. It
	// must never offer a Make the strip the plugin refuses, nor a refusal
	// that asks for an Include the panel does not show.
	{
		const member = sim.fixtures["dial-strip-member"].strip;
		const restoresSent = () => sim.piMessages.filter((m) => m.event === "sendToPlugin" && m.payload?.event === "stripRestore").map((m) => m.payload);
		const creates = () => sim.toPiLog.filter((p) => p.event === "stripEditResult" && p.op === "create");
		const includeBoxes = () => b.evaluate(`[...document.querySelectorAll("#sec-strip input[data-take]")].filter((e) => e.getClientRects().length > 0).length`);
		for (const leg of [
			{ layout: "whole", how: "keyboard", strip: { ...member, create: { layout: "whole", from: 1 } } },
			{ layout: "split", how: "mouse", strip: member },
			{ layout: "whole", how: "keyboard-natural", strip: { ...member, create: { layout: "whole", from: 1 } } },
			// Another layout than the strip's: the dial rejoins, then the strip takes it.
			{ layout: "whole", runs: "split", how: "mouse", strip: member }
		]) {
			const runs = leg.runs ?? leg.layout;
			const name = `back to a layout (${leg.how}, ${leg.layout === "whole" ? "Whole strip" : "Equal split"}${runs === leg.layout ? "" : " on an Equal split"})`;
			await open("dial-strip-member", { strip: leg.strip });
			check(`${name}: the member opens on its running layout`, (await checked()) === runs, await checked());
			const restores0 = restoresSent().length;
			const creates0 = creates().length;
			if (leg.how === "keyboard" || leg.how === "keyboard-natural") {
				// Whole strip sits right after Independent dials: one step left overshoots.
				await b.evaluate(`document.querySelector('input[name="strip-layout"]:checked').focus()`);
				await b.key("ArrowLeft");
			} else await choose("independent");
			await waitFor(`${name}: the left line`, () => visible("strip-restore"), 4000);
			const leftStored = stored()?.joined;
			if (leg.how === "keyboard-natural") {
				// The panel itself puts focus back on the radios once the leave is answered.
				await sleep(300);
				await b.key("ArrowRight");
			} else if (leg.how === "keyboard") {
				await b.evaluate(`document.querySelector('input[name="strip-layout"]:checked').focus()`);
				await b.key("ArrowRight");
			} else await choose(leg.layout);
			await sleep(800);
			const marksNow = (await marks()).map((m) => [m.label, m.look]);
			const sentRestores = restoresSent().slice(restores0);
			const back = {
				checked: await checked(),
				leftStored,
				storedNow: stored()?.joined,
				restores: sentRestores.map((r) => r.columns),
				line: await visible("strip-restore"),
				bar: await visible("strip-bar"),
				goDisabled: await goDisabled(),
				note: await note(),
				status: await statusLine(),
				caption: await text("strip-caption"),
				marks: marksNow
			};
			const rejoins = sentRestores.some((r) => same(r.columns, [1]));
			check(`${name}: going back either rejoins this dial (one stripRestore for its column) or keeps Make the strip unavailable with a reason that names Rejoin`, leftStored === false && (rejoins || (back.goDisabled && /Rejoin/.test(back.note ?? ""))), JSON.stringify(back));
			if (rejoins) {
				const layoutEdits = edits().filter((e) => e.patch.some((op) => op.path === "layout"));
				const radios = await b.evaluate(`[...document.querySelectorAll('input[name="strip-layout"]')].map((r) => r.disabled)`);
				check(`${name}: the dial is back in the strip, in the layout chosen (${runs === leg.layout ? "no edit" : "one stripEdit of the layout"}), the radios enabled, and the note says so`, back.storedNow === true && stored()?.config.layout === leg.layout && back.checked === leg.layout && same(layoutEdits.map((e) => e.patch), runs === leg.layout ? [] : [[{ op: "set", path: "layout", value: leg.layout }]]) && radios.every((d) => !d) && back.note === "Applied. Dial 2 is back in the strip.", JSON.stringify({ stored: stored()?.config.layout, layoutEdits: layoutEdits.map((e) => e.patch), radios, note: back.note }));
				if (leg.how !== "mouse") check(`${name}: focus is back on the layout`, (await b.evaluate(`document.activeElement?.name`)) === "strip-layout", await b.evaluate(`document.activeElement?.id || document.activeElement?.tagName`));
			}
			// An available Make the strip is one the plugin accepts.
			if (!back.goDisabled && back.bar) {
				await b.click("#strip-go");
				await waitFor(`${name}: the create answer`, async () => creates().length > creates0, 3000).catch(() => {});
				await sleep(250);
			}
			const refused = creates().slice(creates0).filter((a) => a.ok !== true);
			const after = { refused: refused.map((a) => [a.reason, a.detail]), note: await note(), include: await includeBoxes() };
			check(`${name}: a Make the strip the panel offers is not refused by the plugin`, refused.length === 0, JSON.stringify(after));
			check(`${name}: a note that asks to tick Include has an Include box to tick`, !/Tick Include/.test(after.note ?? "") || after.include > 0, JSON.stringify(after));
		}
		// A new strip remembered on the dial that left (its panel previewed
		// one): the panel opens on that draft, and Make the strip stays
		// unavailable with a reason that names Rejoin; a press sends nothing.
		await open("dial-strip-member");
		await choose("independent");
		await waitFor("the left line", () => visible("strip-restore"), 4000);
		sim.strip.ctl.handlePi(sim.context, { event: "stripGet", requestId: "memo", draft: { layout: "whole", patch: [], baseRev: 0 } });
		await sleep(200);
		await open("dial-strip-member", undefined, { keep: true });
		await waitFor("the remembered draft", async () => (await checked()) === "whole" && (await visible("strip-bar")), 4000);
		const createsSent = () => sim.piMessages.filter((m) => m.event === "sendToPlugin" && m.payload?.event === "stripCreate").length;
		const sent0 = createsSent();
		check("back to a layout (a remembered draft): Make the strip is unavailable and the reason names the dials still in the strip and Rejoin", (await goDisabled()) && (await note()) === "Dials 1, 3 and 4 are still in the strip this dial left. Choose Independent dials, then Rejoin.", await note());
		await b.click("#strip-go");
		await sleep(300);
		check("back to a layout (a remembered draft): a press on Make the strip sends no stripCreate", createsSent() === sent0, String(createsSent() - sent0));
		// The dial row names the strip that holds those dials: the strip this
		// dial left, not the one being made.
		const rowNow = { status: await statusLine(), title: await statusTitle(), marks: (await marks()).map((m) => [m.label, m.look, m.needs]) };
		check(
			"back to a layout (a remembered draft): the dial row names the strip this dial left, and no mark says it is in this strip",
			same(rowNow, {
				status: "Dial 1 is still in the strip this dial left",
				title: "Dial 1 is still in the strip this dial left",
				marks: [
					["Dial 1, still in the strip this dial left", "dot", true],
					["Dial 2, left the strip, this dial", "hollow", false],
					["Dial 3, still in the strip this dial left", "dot", true],
					["Dial 4, still in the strip this dial left", "dot", true]
				]
			}),
			JSON.stringify(rowNow)
		);
		// The strip's layout chosen there rejoins, and the draft goes with it:
		// the panel shows the strip on the deck, the plugin drops the draft,
		// and the next panel there opens with nothing remembered.
		const draftsSent = () => sim.piMessages.filter((m) => m.event === "sendToPlugin" && m.payload?.event === "stripGet" && "draft" in (m.payload ?? {})).map((m) => (m.payload.draft === null ? null : m.payload.draft.layout));
		const fromDraft = async (name, layout, runs) => {
			const restores0 = restoresSent().length;
			const drafts0 = draftsSent().length;
			const edits0 = edits().length;
			await choose(layout);
			await waitFor(`${name}: the strip on the deck`, async () => stored()?.joined === true && /^On the deck now/.test((await text("strip-caption")) ?? ""), 4000).catch(() => {});
			await sleep(300);
			const after = {
				restores: restoresSent().slice(restores0).map((r) => r.columns),
				joined: stored()?.joined,
				layout: stored()?.config?.layout,
				layoutEdits: edits().slice(edits0).filter((e) => e.patch.some((op) => op.path === "layout")).length,
				checked: await checked(),
				caption: await text("strip-caption"),
				preview: stripState()?.preview?.kind,
				drafts: draftsSent().slice(drafts0),
				draft: sim.strip.ctl.draftOf(sim.context) ?? null,
				note: await note()
			};
			check(
				`${name}: choosing ${layout === "whole" ? "Whole strip" : "Equal split"} rejoins, and the panel shows the strip on the deck, not the draft`,
				same(after.restores, [[1]]) && after.joined === true && after.layout === layout && after.layoutEdits === (runs === layout ? 0 : 1) && after.checked === layout && /^On the deck now/.test(after.caption ?? "") && after.preview === "live" && same(after.drafts, [null]) && after.draft === null && after.note === "Applied. Dial 2 is back in the strip.",
				JSON.stringify(after)
			);
			// Leaving again: nothing of the draft is remembered for the next panel.
			await choose("independent");
			await waitFor(`${name}: the left line again`, () => visible("strip-restore"), 4000);
			const memo = sim.strip.ctl.memoOf(sim.context) ?? null;
			await open("dial-strip-member", undefined, { keep: true });
			const reopened = { memo, checked: await checked(), bar: await visible("strip-bar"), caption: await text("strip-caption") };
			check(`${name}: after leaving again, the next panel there opens on Independent dials with no draft`, reopened.memo === null && reopened.checked === "independent" && !reopened.bar, JSON.stringify(reopened));
		};
		await fromDraft("back to a layout (a remembered draft)", "split", "split");
		// An Equal split remembered on the dial that left: Make the strip waits
		// with the Rejoin reason; the other layout rejoins, and the strip takes
		// it in one edit.
		await open("dial-strip-member");
		await choose("independent");
		await waitFor("the left line", () => visible("strip-restore"), 4000);
		sim.strip.ctl.handlePi(sim.context, { event: "stripGet", requestId: "memo", draft: { layout: "split", patch: [], baseRev: 0 } });
		await sleep(200);
		await open("dial-strip-member", undefined, { keep: true });
		await waitFor("the remembered split", async () => (await checked()) === "split" && (await visible("strip-bar")), 4000);
		const quick = { checked: await checked(), bar: await visible("strip-bar"), goDisabled: await goDisabled(), note: await note(), caption: await text("strip-caption") };
		check("back to a layout (a remembered Equal split): Make the strip waits with the Rejoin reason, and no list", quick.checked === "split" && quick.bar && quick.goDisabled && quick.note === "Dials 1, 3 and 4 are still in the strip this dial left. Choose Independent dials, then Rejoin." && quick.caption === "Preview of the new strip" && !(await visible("strip-build-box")), JSON.stringify(quick));
		await fromDraft("back to a layout (a remembered Equal split)", "whole", "split");
		// A dial that left and then holds a pasted copy of a strip setup has
		// no Rejoin until that copy is settled: the reason names the choice
		// that shows, and Keep the strip's setup brings Rejoin back.
		await open("dial-strip-member");
		await choose("independent");
		await waitFor("the left line", () => visible("strip-restore"), 4000);
		const own = structuredClone(sim.strip.settings.get(sim.context));
		sim.strip.panelWrote({ ...own, stripGroup: { ...own.stripGroup, rev: own.stripGroup.rev + 50, config: { ...own.stripGroup.config, window: "15m" } } });
		await waitFor("the pasted copy's choice", () => visible("strip-resolve"), 4000);
		const restores1 = restoresSent().length;
		await choose("whole");
		await sleep(400);
		const pasted = { restores: restoresSent().length - restores1, bar: await visible("strip-bar"), goDisabled: await goDisabled(), note: await note(), rejoin: await visible("strip-rejoin"), keep: await visible("strip-keep-group"), use: await visible("strip-use-dial") };
		check("back to a layout (a pasted copy): Make the strip waits, and its reason names Keep the strip's setup and Use this dial's copy, which show (Rejoin does not)", pasted.restores === 0 && pasted.bar && pasted.goDisabled && pasted.note === "Dials 1, 3 and 4 are still in the strip this dial left. Choose Keep the strip's setup or Use this dial's copy first." && !pasted.rejoin && pasted.keep && pasted.use, JSON.stringify(pasted));
		await b.click("#strip-keep-group");
		await waitFor("the pasted copy settled", async () => !(await visible("strip-resolve")), 4000);
		await choose("independent");
		await waitFor("the left line after the choice", () => visible("strip-restore"), 4000).catch(() => {});
		check("back to a layout (a pasted copy): after Keep the strip's setup, Independent dials shows Rejoin", (await visible("strip-rejoin")) && sim.strip.settings.get(sim.context)?.stripGroup?.joined === false, JSON.stringify({ rejoin: await visible("strip-rejoin"), note: await note() }));
	}

	// ---- one press, one action: a held Enter, a double click, text typed ahead of an answer, Fill's start ----
	{
		const K = sim.keys;
		const member = sim.fixtures["dial-strip-member"].strip;
		const xlSpec = sim.fixtures["dial-strip-xl"].strip;
		const sent = (event) => sim.piMessages.filter((m) => m.event === "sendToPlugin" && m.payload?.event === event).length;
		const screenNames = () => {
			const c = stored().config;
			return [c.panes[0], ...(c.screens ?? [])].map((p) => p.name ?? null);
		};
		const focusOn = (selector) => b.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: "center" }); el.focus(); return document.activeElement === el; })()`);
		const allLeft = () => [...sim.strip.settings.values()].filter((d) => d?.stripGroup !== undefined).map((d) => d.stripGroup.joined);

		// A held Enter: Build screens opens its list and hands focus to Use
		// these screens; Cancel hands it back to Build screens.
		await open("dial-strip-member", { strip: { ...member, create: { layout: "whole", from: 1 } } });
		await waitCaption(/^On the deck now/);
		let e0 = edits().length;
		await focusOn("#strip-build");
		await holdEnter();
		check("one press (held Enter): Build screens opens its list, Use these screens focused, and adds no screen", edits().length === e0 && (await visible("strip-build-box")) && (stored().config.screens ?? []).length === 0 && (await b.evaluate(`document.activeElement?.id`)) === "strip-build-use", JSON.stringify({ sent: edits().slice(e0).map((e) => e.patch.map((op) => op.op)), screens: (stored().config.screens ?? []).length, focus: await b.evaluate(`document.activeElement?.id`) }));
		await focusOn("#strip-build-no");
		await holdEnter();
		check("one press (held Enter): Build's Cancel closes the list and adds no screen", edits().length === e0 && !(await visible("strip-build-box")) && (stored().config.screens ?? []).length === 0, JSON.stringify({ sent: edits().length - e0, screens: (stored().config.screens ?? []).length, box: await visible("strip-build-box") }));

		// The screen tools' Later on a Whole strip of two: held, then double clicked.
		const WHOLE_TWO = [
			{ op: "set", path: "panes.0.style", value: "lanes" },
			{ op: "set", path: "panes.0.series", value: [{ key: K.gpu }, { key: K.hot }] },
			{ op: "set", path: "panes.0.name", value: "GPU" },
			{ op: "addScreen", at: 1, from: "group" },
			{ op: "set", path: "screens.0.group", value: { from: "filter", filter: "*fan*", keys: [], view: "auto" } },
			{ op: "set", path: "screens.0.name", value: "Fans" }
		];
		const LATER = '#strip-screen-tools button[data-tool="later"]';
		for (const how of ["held Enter", "double click"]) {
			await open("dial-strip-member", { strip: { ...member, create: { layout: "whole", from: 1, patch: WHOLE_TWO } } });
			await waitCaption(/^On the deck now/);
			await b.click("#strip-screen-edit");
			await sleep(150);
			e0 = edits().length;
			if (how === "held Enter") {
				await focusOn(LATER);
				await holdEnter();
			} else await doubleClick(LATER);
			await sleep(300);
			check(`one press (${how}): the screen tools' Later moves the screen once`, edits().length === e0 + 1 && same(screenNames(), ["Fans", "GPU"]), JSON.stringify({ sent: edits().slice(e0).map((e) => e.patch), names: screenNames() }));
		}

		// Three presses 300 ms apart at one point (counted 1, 2, 3) on the
		// screen tools' Earlier or Later. The strip keeps the screen it shows
		// wherever a move takes it, the first screen of a strip never moved
		// to another included, so each press moves the same screen again.
		const WHOLE_FIVE = [
			...WHOLE_TWO,
			{ op: "addScreen", at: 2, from: "group" },
			{ op: "set", path: "screens.1.group", value: { from: "filter", filter: "*cpu*", keys: [], view: "auto" } },
			{ op: "set", path: "screens.1.name", value: "CPUs" },
			{ op: "addScreen", at: 3, from: "group" },
			{ op: "set", path: "screens.2.group", value: { from: "filter", filter: "*clock*", keys: [], view: "auto" } },
			{ op: "set", path: "screens.2.name", value: "Clocks" },
			{ op: "addScreen", at: 4, from: "group" },
			{ op: "set", path: "screens.3.group", value: { from: "filter", filter: "*temp*", keys: [], view: "auto" } },
			{ op: "set", path: "screens.3.name", value: "Temps" }
		];
		const EARLIER = '#strip-screen-tools button[data-tool="earlier"]';
		/** The screens the plugin last reported: their ids and the one on the strip. */
		const onStrip = () => {
			const s = stripState();
			const g = Array.isArray(s?.group?.screens) ? s.group : s;
			return { ids: (g?.screens ?? []).map((x) => x.screenId), screen: g?.screen ?? null };
		};
		/** Shows a screen picked from the list, as a person does, and waits for the plugin to show it. */
		const showScreenAt = async (index) => {
			const id = await b.evaluate(`(() => { const s = document.getElementById("strip-screen-select"); s.selectedIndex = ${index}; s.dispatchEvent(new Event("change", { bubbles: true })); return s.value; })()`);
			await waitFor(`screen ${index} on the strip`, () => onStrip().screen === id, 3000);
		};
		/** Three presses 300 ms apart at the middle of `selector`, the pointer
		 * still; after each, the name of the button under the pointer. */
		const pressThrice = async (selector) => {
			const p = await b.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
			await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
			await sleep(100);
			const under = [];
			for (let clickCount = 1; clickCount <= 3; clickCount++) {
				await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount });
				await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount });
				await sleep(300);
				under.push(await b.evaluate(`document.elementFromPoint(${p.x}, ${p.y})?.closest("button")?.getAttribute("aria-label") ?? null`));
			}
			await sleep(300);
			return under;
		};
		const toolsOn = async (picks) => {
			for (const i of picks) await showScreenAt(i);
			await b.click("#strip-screen-edit");
			await sleep(150);
		};
		for (const [what, picks, selector, want, name] of [
			["Earlier, the last of five screens", [4], EARLIER, ["GPU", "Temps", "Fans", "CPUs", "Clocks"], "Move Temps earlier"],
			["Later, the second of five screens", [1], LATER, ["GPU", "CPUs", "Clocks", "Temps", "Fans"], "Move Fans later"],
			["Later, the first screen of a strip never moved to another", [], LATER, ["Fans", "CPUs", "Clocks", "GPU", "Temps"], "Move GPU later"],
			["Later, the first screen shown again after another", [2, 0], LATER, ["Fans", "CPUs", "Clocks", "GPU", "Temps"], "Move GPU later"]
		]) {
			await open("dial-strip-member", { strip: { ...member, create: { layout: "whole", from: 1, patch: WHOLE_FIVE } } });
			await waitCaption(/^On the deck now/);
			await toolsOn(picks);
			const shown = onStrip().screen;
			const step = await b.evaluate(`document.querySelector(${JSON.stringify(selector)})?.dataset.step ?? null`);
			e0 = edits().length;
			const under = await pressThrice(selector);
			check(`three presses 300 ms apart (the screen tools' ${what}): each moves the same screen again, and it stays on the strip`, edits().length === e0 + 3 && same(screenNames(), want) && onStrip().screen === shown && under.every((label) => label === name), JSON.stringify({ sent: edits().length - e0, names: screenNames(), under, shown, step, now: onStrip().screen }));
		}
		// A double click on that first screen's Later moves it twice whether
		// the plugin answers the first press at once or 200 ms later: the
		// button under the pointer names the same screen either way.
		for (const reply of [0, 200]) {
			await open("dial-strip-member", { strip: { ...member, create: { layout: "whole", from: 1, patch: WHOLE_FIVE } } });
			await waitCaption(/^On the deck now/);
			await toolsOn([]);
			const shown = onStrip().screen;
			e0 = edits().length;
			sim.replyDelayMs = reply;
			await doubleClick(LATER);
			await sleep(400);
			sim.replyDelayMs = 0;
			await sleep(200);
			check(`a double click (the screen tools' Later, the first screen of a strip never moved to another, a ${reply} ms answer): it moves the screen twice, and it stays on the strip`, edits().length === e0 + 2 && same(screenNames(), ["Fans", "CPUs", "GPU", "Clocks", "Temps"]) && onStrip().screen === shown, JSON.stringify({ sent: edits().length - e0, names: screenNames(), shown, now: onStrip().screen }));
		}
		// Alt+Right and Alt+End on the list, on the first screen of a strip
		// never moved to another: the screen moves and stays on the strip,
		// the list and the box follow it, and another dial's panel of the
		// strip shows it too.
		{
			await open("dial-strip-member", { strip: { ...member, create: { layout: "whole", from: 1, patch: WHOLE_FIVE } } });
			await waitCaption(/^On the deck now/);
			const shown = onStrip().screen;
			const listed = async () => ({ names: screenNames(), now: onStrip().screen, chosen: await b.evaluate(`document.getElementById("strip-screen-select").selectedOptions[0]?.textContent ?? null`), place: await text("strip-screen-place"), box: await text("sp0-name"), said: await b.evaluate(`[...document.querySelectorAll("body > .hw-sr-only[role=status]")].map((e) => e.textContent.trim()).join(" | ")`) });
			await b.evaluate(`document.getElementById("strip-screen-select").focus()`);
			e0 = edits().length;
			await b.key("ArrowRight", { alt: true });
			await waitFor("the move", () => edits().length === e0 + 1 && screenNames()[1] === "GPU", 3000).catch(() => {});
			await sleep(300);
			const right = await listed();
			check("Alt+Right on the list (the first screen of a strip never moved to another): it moves to 2 of 5 and stays on the strip; the list, its place and the box name it, and the move is said", same(right.names, ["Fans", "GPU", "CPUs", "Clocks", "Temps"]) && right.now === shown && right.chosen === "GPU" && right.place === "2 of 5" && /GPU/.test(right.box ?? "") && /GPU is now 2 of 5/.test(right.said), JSON.stringify(right));
			e0 = edits().length;
			await b.key("End", { alt: true });
			await waitFor("the move to the end", () => edits().length === e0 + 1 && screenNames()[4] === "GPU", 3000).catch(() => {});
			await sleep(300);
			const end = await listed();
			check("Alt+End on the list: it moves to 5 of 5 and stays on the strip, the list on it", same(end.names, ["Fans", "CPUs", "Clocks", "Temps", "GPU"]) && end.now === shown && end.chosen === "GPU" && end.place === "5 of 5" && /GPU is now 5 of 5/.test(end.said), JSON.stringify(end));
			sim.strip.openMember(3);
			await open("dial-strip-member", undefined, { keep: true });
			await waitCaption(/^On the deck now/);
			const other = await listed();
			check("another dial's panel of that strip: the moved screen is on the strip, chosen in its list at 5 of 5, in its box", other.now === shown && other.chosen === "GPU" && other.place === "5 of 5" && /GPU/.test(other.box ?? ""), JSON.stringify(other));
		}
		// A strip stored with no screen ids (the plugin keys each screen by its
		// place until an edit gives them ids): the first press names no step,
		// moves the screen once and gives every screen an id, and the strip
		// keeps the moved screen; from then on quick presses move it again.
		{
			await open("dial-strip-member", { strip: { ...member, create: { layout: "whole", from: 1, patch: WHOLE_FIVE } } });
			await waitCaption(/^On the deck now/);
			const unminted = (doc) => {
				const d = structuredClone(doc);
				for (const pane of [d.stripGroup.config.panes[0], ...(d.stripGroup.config.screens ?? [])]) delete pane.screenId;
				return d;
			};
			const own = unminted(sim.strip.settings.get(sim.context));
			const dials = member.dials.map(([column]) => [column, unminted(sim.strip.settings.get(sim.strip.contextAt(column)))]);
			await open("dial-strip-member", { settings: own, strip: { type: member.type, column: member.column, dials } });
			await waitCaption(/^On the deck now/);
			const placed = onStrip().ids;
			await toolsOn([4]);
			// Known only by its place, the screen names no step.
			const step = await b.evaluate(`document.querySelector(${JSON.stringify(EARLIER)})?.dataset.step ?? null`);
			e0 = edits().length;
			const under = await pressThrice(EARLIER);
			const ids = onStrip().ids;
			check("three presses 300 ms apart (the screen tools' Earlier, the last screen of a strip stored with no screen ids): it names no step and moves once, every screen takes an id, the strip keeps the moved screen, and the later presses of that gesture move nothing", placed.length === 5 && placed.every((id) => id.startsWith("@")) && step === null && edits().length === e0 + 1 && same(screenNames(), ["GPU", "Fans", "CPUs", "Temps", "Clocks"]) && ids.every((id) => /^[0-9a-f]{8}$/.test(id)) && onStrip().screen === ids[3] && under.every((label) => label === "Move Temps earlier"), JSON.stringify({ placed, step, ids, sent: edits().length - e0, names: screenNames(), under, now: onStrip().screen }));
			await sleep(400);
			e0 = edits().length;
			const again = await pressThrice(EARLIER);
			check("three presses 300 ms apart again on that strip, now with ids: each moves the same screen again, and it stays on the strip", edits().length === e0 + 3 && same(screenNames(), ["Temps", "GPU", "Fans", "CPUs", "Clocks"]) && onStrip().screen === ids[3] && again.every((label) => label === "Move Temps earlier"), JSON.stringify({ sent: edits().length - e0, names: screenNames(), under: again, now: onStrip().screen }));
		}

		// A double click on the screen tools' Remove at 189 px: the first click
		// arms it, and the armed button, wider, takes a line of its own; the
		// second click lands on the tools' empty space and takes nothing,
		// so Remove stays armed with focus.
		await b.viewport(189, 410);
		await open("dial-strip-member", { strip: { ...member, create: { layout: "whole", from: 1, patch: WHOLE_TWO } } });
		await waitCaption(/^On the deck now/);
		await b.click("#strip-screen-edit");
		await sleep(150);
		e0 = edits().length;
		const REMOVE = '#strip-screen-tools button[data-tool="remove"]';
		await doubleClick(REMOVE);
		const removeState = await b.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(REMOVE)}); return { armed: r?.dataset.armed ?? null, focused: document.activeElement === r, label: r?.getAttribute("aria-label") ?? null }; })()`);
		await b.viewport(400, 900);
		check("one press (double click, 189 px): the screen tools' Remove arms once and stays armed with focus; the second click, on the tools' empty space, takes nothing", removeState.armed === "true" && removeState.focused && edits().length === e0, JSON.stringify({ ...removeState, sent: edits().length - e0 }));

		// A double click on Add a screen while the plugin takes 200 ms to
		// answer: the link (or the tools' Add) is still under the pointer, and
		// the gesture adds one screen, as it does with an answer at once.
		for (const [what, patch, selector, edit] of [
			["Add a screen", null, "#strip-add-screen", false],
			["the screen tools' Add", WHOLE_TWO, '#strip-screen-tools button[data-tool="add"]', true]
		]) {
			await open("dial-strip-member", { strip: { ...member, create: patch === null ? { layout: "whole", from: 1 } : { layout: "whole", from: 1, patch } } });
			await waitCaption(/^On the deck now/);
			if (edit) {
				await b.click("#strip-screen-edit");
				await sleep(150);
			}
			const n0 = (stored().config.screens ?? []).length;
			e0 = edits().length;
			sim.replyDelayMs = 200;
			await doubleClick(selector);
			await sleep(400);
			sim.replyDelayMs = 0;
			await sleep(300);
			check(`one press (double click, the plugin answering in 200 ms): ${what} adds one screen`, edits().length === e0 + 1 && (stored().config.screens ?? []).length === n0 + 1, JSON.stringify({ sent: edits().length - e0, screens: [n0, (stored().config.screens ?? []).length] }));
		}

		// Build screens opens its list where the pointer rests (the app's 378
		// by 410 px panel): a single press 300 ms later at the same point, a
		// second press past a short double-click time, ticks or unticks
		// nothing there and leaves the list open.
		await b.viewport(378, 410);
		await open("dial-strip-member", { strip: { ...member, create: { layout: "whole", from: 1 } } });
		await waitCaption(/^On the deck now/);
		{
			const p = await b.evaluate(`(() => { const el = document.getElementById("strip-build"); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
			const pressHere = async () => {
				await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
				await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
			};
			await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
			await sleep(100);
			e0 = edits().length;
			await pressHere();
			await sleep(300);
			const under = await b.evaluate(`(() => { const e = document.elementFromPoint(${p.x}, ${p.y}); const c = e?.closest("button, label, input, summary") ?? e; return c?.id || c?.textContent?.trim().slice(0, 40) || null; })()`);
			await pressHere();
			await sleep(500);
			const ticks = await b.evaluate(`[...document.querySelectorAll("#strip-build-box input[type=checkbox]")].map((i) => i.checked)`);
			check("one press (Build screens, then a single press 300 ms later where it was): the list stays open with every screen ticked, and nothing is added", (await visible("strip-build-box")) && ticks.length > 0 && ticks.every(Boolean) && edits().length === e0, JSON.stringify({ under, ticks, open: await visible("strip-build-box"), sent: edits().length - e0 }));
		}
		await b.viewport(400, 900);

		// Every dial leaves, from the dial that left: Restore the strip is
		// drawn in its place and takes focus.
		for (const how of ["held Enter", "double click"]) {
			await open("dial-strip-member");
			await choose("independent");
			await waitFor("the left line", () => visible("strip-restore"), 4000);
			const l0 = sent("stripLeave");
			const r0 = sent("stripRestore");
			if (how === "held Enter") {
				await focusOn("#strip-leave-all");
				await holdEnter();
			} else await doubleClick("#strip-leave-all");
			await sleep(300);
			check(`one press (${how}): Every dial leaves sends one leave, Restore the strip in its place takes no press, and every dial stays out`, sent("stripLeave") === l0 + 1 && sent("stripRestore") === r0 && allLeft().every((joined) => joined === false), JSON.stringify({ leaves: sent("stripLeave") - l0, restores: sent("stripRestore") - r0, joined: allLeft() }));
		}

		// A double click on the control its first click pressed goes through:
		// a rotation member's double click still renames it.
		await open("dial-strip-plus");
		await b.evaluate(`document.querySelectorAll("details").forEach((d) => { d.open = true; })`);
		await sleep(100);
		await doubleClick('#rotation-set [role="option"]');
		check("double click (a rotation member): the same member under the pointer, so the double click renames it as before", await b.evaluate(`document.querySelector("#rotation-set input.hw-chip-rename") !== null`), JSON.stringify({ focus: await b.evaluate(`document.activeElement?.id || document.activeElement?.className || null`) }));

		// A double click on a reading's x: focus follows to the next reading's
		// x at the same place (the app's 378 by 410 px panel).
		await b.viewport(378, 410);
		await open("dial-strip-member");
		await waitCaption(/^On the deck now/);
		e0 = edits().length;
		const rightBefore = stored().config.panes[1].series.map((s) => s.key);
		await doubleClick("#sp1-series .hw-set-remove");
		await sleep(300);
		await b.viewport(400, 900);
		check("double click (a reading's x): removes that reading only; the next reading's x, under the pointer after the first click, takes no press", edits().length === e0 + 1 && same(stored().config.panes[1].series.map((s) => s.key), rightBefore.slice(1)), JSON.stringify({ sent: edits().length - e0, before: rightBefore, after: stored().config.panes[1].series.map((s) => s.key) }));

		// Text typed in three fields faster than the plugin answers: each edit
		// goes after the answer to the one before, none against an old revision.
		await open("dial-strip-member");
		await waitCaption(/^On the deck now/);
		await b.evaluate(`document.getElementById("sec-stripmore").open = true`);
		await sleep(100);
		const t0 = sim.toPiLog.length;
		e0 = edits().length;
		sim.replyDelayMs = 300;
		await focusOn("#sp0-min");
		await b.type("10");
		await b.key("Tab");
		await focusOn("#sp0-max");
		await b.type("90");
		await b.key("Tab");
		await focusOn("#sp1-min");
		await b.type("5");
		await sleep(1800);
		sim.replyDelayMs = 0;
		await sleep(400);
		const scales = stored().config.panes.map((p) => [p.scale?.min ?? null, p.scale?.max ?? null]);
		const refused = sim.toPiLog.slice(t0).filter((p) => p.event === "stripEditResult" && p.ok === false);
		check("typed ahead of the answer: Scale from, Scale to and the other half's Scale from all land; nothing is refused, and nothing blames another dial's panel", same(scales, [[10, 90], [5, null]]) && refused.length === 0 && !/Another dial/.test((await note()) ?? ""), JSON.stringify({ scales, refused: refused.map((p) => p.reason), sent: edits().slice(e0).map((e) => [e.baseRev, e.patch.map((op) => op.path)]), note: await note() }));

		// An edit made while this panel's Rejoin of another dial is on its way
		// goes once the Rejoin is answered, over the copy that answer names.
		await open("dial-strip-member");
		await waitCaption(/^On the deck now/);
		sim.strip.ctl.handlePi(sim.strip.contextAt(2), { event: "stripLeave", opId: "dial3-leaves", groupId: stored().id });
		await waitFor("dial 3's line", async () => (await detail())?.action === "Rejoin", 4000);
		const win = stored().config.window === "15m" ? "1m" : "15m";
		e0 = edits().length;
		sim.replyDelayMs = 300;
		await b.evaluate(`document.querySelector("#strip-slot-detail button").click()`);
		await sleep(30);
		await setSelect("strip-window", win);
		await sleep(1500);
		sim.replyDelayMs = 0;
		await sleep(300);
		check("an edit made while a Rejoin is on its way goes once the Rejoin is answered, and nothing is refused", stored().config.window === win && sim.strip.settings.get(sim.strip.contextAt(2))?.stripGroup?.joined === true && edits().length === e0 + 1 && sim.toPiLog.slice(-20).every((p) => p.event !== "stripEditResult" || p.ok === true), JSON.stringify({ window: stored().config.window, want: win, sent: edits().slice(e0).map((e) => [e.baseRev, e.patch.map((op) => op.path)]), rejoined: sim.strip.settings.get(sim.strip.contextAt(2))?.stripGroup?.joined }));

		// Keep the strip's setup and Use this dial's copy (a pasted copy on a
		// dial still in the strip), and Use this deck's dials (a strip set up
		// on a + XL, its dials now on a +), each pressed while this panel's
		// edit waits on a 300 ms answer: each goes once that edit is answered.
		for (const [what, selector, use] of [
			["Keep the strip's setup", "#strip-keep-group", "group"],
			["Use this dial's copy", "#strip-use-dial", "thisDial"]
		]) {
			await open("dial-strip-member", { strip: { ...member, create: { layout: "whole", from: 1 } } });
			await waitCaption(/^On the deck now/);
			const own = structuredClone(sim.strip.settings.get(sim.context));
			sim.strip.panelWrote({ ...own, stripGroup: { ...own.stripGroup, rev: own.stripGroup.rev + 50, config: { ...own.stripGroup.config, window: "15m" } } });
			await waitFor("the pasted copy's choice", () => visible("strip-resolve"), 4000);
			const r0 = sent("stripResolve");
			sim.replyDelayMs = 300;
			await setSelect("strip-window", "1m");
			await sleep(60);
			await b.click(selector);
			await sleep(1500);
			sim.replyDelayMs = 0;
			await sleep(300);
			const resolves = sim.piMessages.filter((m) => m.event === "sendToPlugin" && m.payload?.event === "stripResolve").slice(r0).map((m) => m.payload.use);
			const settled = { resolves, choice: await visible("strip-resolve"), note: await note(), pasted: sim.strip.settings.get(sim.context)?.stripGroupPasted !== undefined };
			check(`${what}, pressed while this panel's edit is on its way: it goes once the edit is answered, and the pasted copy is settled`, same(resolves, [use]) && !settled.choice && settled.note === "Settled. The strip runs from the setup you chose." && !settled.pasted, JSON.stringify(settled));
		}
		{
			await open("dial-strip-xl", { strip: { ...xlSpec, create: { layout: "whole", from: 0 } } });
			await waitCaption(/^On the deck now/);
			const docs = Array.from({ length: 4 }, (_, c) => structuredClone(sim.strip.settings.get(c === xlSpec.column ? sim.context : sim.strip.contextAt(c))));
			await open("dial-strip-member", { settings: docs[member.column], strip: { type: member.type, column: member.column, dials: [0, 2, 3].map((c) => [c, docs[c]]) } });
			await waitFor("the retarget line", () => visible("strip-retarget"), 4000);
			e0 = edits().length;
			sim.replyDelayMs = 300;
			await setSelect("strip-window", "1m");
			await sleep(60);
			await b.click("#strip-retarget-go");
			await sleep(1500);
			sim.replyDelayMs = 0;
			await sleep(300);
			const retarget = { sent: edits().slice(e0).map((e) => e.patch.map((op) => op.path)), encoders: stored().config.encoders, line: await visible("strip-retarget"), note: await note() };
			check("Use this deck's dials, pressed while this panel's edit is on its way (refused for the deck): it goes once that answer comes, the strip takes this deck's dials, and no note asks for it", same(retarget.sent, [["window"], ["encoders"]]) && retarget.encoders === 4 && !retarget.line && retarget.note === "", JSON.stringify(retarget));
		}

		// Fill's untouched start is the stored strip's own record, the same on
		// every member's panel: a reading a person picked for the left half
		// asks first even when one of the strip's dials shows it; the start
		// the strip was made with goes at once even after its dial left.
		// The xl dials: 0 cpu, 1 gpu, 2 hot (this panel's), 3 gpuPower.
		const useOnFirstPair = async () => {
			await waitFor("Fill offered", async () => (await fillState()).options.length > 1, 3000);
			await setSelect("strip-fill", (await fillState()).options[1][0]);
			await waitCaption(/^Preview only$/);
			const before = edits().length;
			await b.evaluate(`document.getElementById("strip-fill-use").click()`);
			await sleep(700);
			return { ask: await askState(), sent: edits().length - before };
		};
		sim.setFixture("dial-strip-xl", { strip: { ...xlSpec, create: { layout: "split", from: 0 } } });
		sim.strip.editFrom(1, [{ op: "set", path: "panes.0.series", value: [{ key: K.gpuPower }] }]);
		await open("dial-strip-xl", undefined, { keep: true });
		await waitCaption(/^On the deck now/);
		const picked = await useOnFirstPair();
		check("fill's start (a person's pick): a left half set by hand to the reading dial 4 shows asks before Use replaces it", picked.ask.shown && picked.sent === 0, JSON.stringify(picked));
		sim.setFixture("dial-strip-xl", { strip: { ...xlSpec, create: { layout: "split", from: 0 } } });
		const maker = sim.strip.contextAt(0);
		sim.strip.ctl.handlePi(maker, { event: "stripLeave", opId: "maker-leaves", groupId: sim.strip.settings.get(maker)?.stripGroup?.id });
		await open("dial-strip-xl", undefined, { keep: true });
		await waitCaption(/^On the deck now/);
		const untouched = await useOnFirstPair();
		check("fill's start (its dial left): the start the strip was made with goes at once, though the dial it came from left the strip", !untouched.ask.shown && untouched.sent === 1 && sim.strip.settings.get(maker)?.stripGroup?.joined === false, JSON.stringify(untouched));
	}

	check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (error) {
	check("suite ran to the end", false, String(error?.stack ?? error));
} finally {
	clearTimeout(watchdog);
	await Promise.allSettled([b.close(), sim.stop()]);
}
console.log(failures.length === 0 ? "E2E PI STRIP: ALL CHECKS PASSED" : `E2E PI STRIP: ${failures.length} FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
