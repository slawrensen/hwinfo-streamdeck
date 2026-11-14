// The F01 panel suite: drives the REAL property inspectors (shipped HTML,
// CSS, pi-*.js and the panel client, ui/pi-client.js) in headless Chromium
// against the simulated host (scripts/lib/pi-sim.mjs), whose plugin side
// is the production preview builder and renderers. Checks, by area:
//
//   observe   opening, expanding, collapsing, tabbing, searching and
//             browsing every panel and fixture writes nothing
//   edits     each deliberate edit changes exactly its declared fields
//   sky       on the art looks, Stars and Sky color are one label-over pair
//             in Background's width, Default value first; the line under
//             Background shows only on Paper and is the only description
//             the pair has then; a pick never moves the pair; a kept value
//             stacks the pair; one pick is one write
//   lossless  unknown top-level and nested fields, list entries and entry
//             metadata survive edits, reorders and mode switches
//   races     a late preview for another context is never shown; echoes
//             and shared-setting changes from elsewhere neither clobber an
//             edit in progress nor move the caret, focus or scroll
//   keyboard  combobox inspection vs commit, Escape, rotation reorder,
//             IME composition
//   presses   three quick presses on rotation Earlier or Later move the
//             same reading three places; a tap on Earlier and a tap on
//             Later 10 px away press both; a double click on a reading in
//             the dial's list picks it and opens no other list, nor
//             selects or renames a rotation member that slid under it
//   truth     unavailable vs missing vs stale, valid zero and negatives; a
//             blank stored on a shared select shows what the plugin draws
//   parity    the header face is byte-identical to the renderer's face for
//             every layout, dial view, alert and inheritance fixture
//   scale     every one of 5,000 readings is reachable; the deep saved
//             reading is selected and in view when the list opens
//
// Run: npx tsx scripts/e2e-pi-panels.mjs  (no Stream Deck app, no HWiNFO).
// SIMULATED HOST: this proves the shipped panel code and the production
// message shapes, not the Stream Deck app's embedded webview.
import { launch } from "./lib/cdp.mjs";
import { makeCheck, sleep } from "./lib/e2e-common.mjs";
import { FUTURE_BLOB, keyOf, sampleSnapshot, scaledSnapshot } from "./lib/pi-fixtures.mjs";
import { startPiSim } from "./lib/pi-sim.mjs";
import { PanelFoldMemory } from "../src/panel-folds.ts";
import { buildSensorTree, buildThemesPayload } from "../src/pi-protocol.ts";

const failures = [];
const check = makeCheck((name) => failures.push(name));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// PI_PANELS_PORT_BASE moves the simulator's two ports (the browser picks its
// own debugger port), so a second copy (a control
// run against other panel files through PI_SIM_PLUGIN_DIR) can run beside.
const PORT_BASE = Number(process.env.PI_PANELS_PORT_BASE ?? 29320);
const PORTS = { ws: PORT_BASE, http: PORT_BASE + 1 };

const sim = await startPiSim({
	httpPort: PORTS.http,
	wsPort: PORTS.ws,
	// Holds the app's connect call for 3 s, for a panel opened before it.
	extraRoutes: {
		"/__e2e/slow-connect.js": () => ({ type: "text/javascript", body: "(() => { const f = window.connectElgatoStreamDeckSocket; window.connectElgatoStreamDeckSocket = (...a) => setTimeout(() => f(...a), 3000); })();" })
	}
});
const b = await launch({ width: 400, height: 900 });
const pageErrors = [];
b.on("Runtime.exceptionThrown", (p) => pageErrors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text));
// A hang guard, not a speed check: a normal run takes about seven minutes
// (423 s on 2026-11-11, with the whole-name leg's real pointer waits), so
// the guard sits well above that.
const watchdog = setTimeout(async () => {
	console.error("[e2e-pi-panels] watchdog: 720 s elapsed, aborting");
	// The owned browser and the simulated host go first, never left behind
	// by the early exit (external review AX41); a stuck close waits 10 s at most.
	await Promise.race([Promise.allSettled([b.close(), sim.stop()]), sleep(10_000)]);
	process.exit(2);
}, 720_000);
watchdog.unref();

async function open(fixture, overrides) {
	sim.setFixture(fixture, overrides);
	await b.goto(sim.url(fixture));
	for (let i = 0; i < 40; i++) {
		if (await b.evaluate(`document.readyState === "complete" && (window.__hwPanel === undefined || window.__hwPanel.context !== "" || document.body.dataset.kind === "slot")`)) break;
		await sleep(50);
	}
	// Ready, not a fixed pause (external review MS06): a slot or Control
	// panel names itself, a reading panel holds its context and sensor tree,
	// and the stored folds are applied; two frames let layout settle.
	const deadline = performance.now() + 3500;
	while (!(await b.evaluate(`document.readyState === "complete" && (document.body.dataset.kind === "slot" || document.body.dataset.kind === "control" || (!!window.__hwPanel?.context && window.__hwPanel?.tree != null)) && !document.documentElement.hasAttribute("data-folds-pending")`))) {
		if (performance.now() >= deadline) throw new Error(`${fixture}: the panel was not ready within 3500 ms`);
		await sleep(25);
	}
	await b.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}
const writes = () => ({ settings: sim.writes.length, globals: sim.globalWrites.length });
const noWrites = (name) => check(`${name}: no writes`, sim.writes.length === 0 && sim.globalWrites.length === 0, JSON.stringify(writes()));
const lastWrite = () => sim.writes.at(-1);
/** The rotation editor the way a person works it: click a member (by
 * list and position, or by key) to select it, then press one toolbar
 * button. Returns "ok" or what was missing. */
const rotationTool = (tool, { group = null, index = 0, key = null } = {}) =>
	b.evaluate(`(() => {
		const lists = [...document.querySelectorAll("#rotation-set .hw-set-list")];
		const list = ${JSON.stringify(group)} === null ? lists[0] : lists.find((l) => l.dataset.group === String(${JSON.stringify(group)}));
		const option = ${JSON.stringify(key)} !== null ? document.querySelector('#rotation-set .hw-set-list [role="option"][data-key="' + ${JSON.stringify(key)} + '"]') : list?.querySelectorAll('[role="option"]')[${index}];
		if (!option) return "no option";
		option.click();
		const button = document.querySelector('#rotation-set .hw-set-tools button[data-tool="${tool}"]');
		if (!button) return "no tool";
		if (button.getAttribute("aria-disabled") === "true") return "disabled";
		button.click();
		return "ok";
	})()`);

/** Keys whose values differ between two documents. */
function changedKeys(before, after) {
	const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
	return [...keys].filter((k) => !same(before[k], after[k])).sort();
}

try {
	// ---- observe: every fixture, every panel ----------------------------
	for (const fixture of Object.keys(sim.fixtures)) {
		await open(fixture);
		// Expand and collapse every disclosure, then Tab through the whole
		// page and back, the way a person explores.
		await b.evaluate(`document.querySelectorAll("details").forEach((d) => { d.open = true; })`);
		await sleep(150);
		for (let i = 0; i < 60; i++) await b.key("Tab");
		for (let i = 0; i < 20; i++) await b.key("Tab", { shift: true });
		await b.evaluate(`document.activeElement?.blur(); document.querySelectorAll("details.hw-sec").forEach((d) => { d.open = false; })`);
		await sleep(100);
		// Search and browse in every picker, then back out with Escape.
		for (const id of ["picker-search", "pickerr-search", "pickerd-search"]) {
			const has = await b.evaluate(`(() => { const s = document.getElementById("${id}"); if (!s) return false; s.closest("details")?.setAttribute("open", ""); s.closest("[hidden]")?.removeAttribute("hidden"); s.focus(); return document.activeElement === s; })()`);
			if (!has) continue;
			await b.type("temp");
			await sleep(80);
			if (id === "picker-search") {
				await b.key("ArrowDown");
				await b.key("ArrowDown");
				await b.key("ArrowUp");
			}
			await b.key("Escape");
			await sleep(80);
		}
		sim.pushPreview();
		await sleep(200);
		noWrites(`observe ${fixture}`);
		check(`observe ${fixture}: panel counted no saves`, (await b.evaluate(`(window.__hwPanel?.writes ?? 0) + (window.__hwPanel?.globalWrites ?? 0)`)) === 0);
	}
	check("observe: no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

	// ---- edits: each changes exactly its declared fields ------------------
	const edits = [
		["key-configured", "label", `(() => { const i = document.getElementById("f-label"); i.focus(); i.value = "Core"; i.dispatchEvent(new Event("input")); i.dispatchEvent(new Event("change")); i.blur(); })()`, ["label"]],
		["key-configured", "decimals", `(() => { const s = document.getElementById("f-decimals"); s.value = "2"; s.dispatchEvent(new Event("change")); })()`, ["decimals"]],
		["key-configured", "theme chip", `document.querySelector('.hw-theme[data-theme="ember"]').click()`, ["theme"]],
		["key-configured", "text mode", `(() => { const s = document.getElementById("f-text"); s.value = "dim"; s.dispatchEvent(new Event("change")); })()`, ["textMode"]],
		["key-custom-dim", "custom color", `(() => { const c = document.getElementById("text-color"); c.value = "#123456"; c.dispatchEvent(new Event("change")); })()`, ["textColor"]],
		["key-configured", "layout", `(() => { const s = document.getElementById("f-layout"); s.value = "quad"; s.dispatchEvent(new Event("change")); })()`, ["keyLayout"]],
		["key-configured", "graph", `(() => { const s = document.getElementById("display-mode"); s.value = "ring"; s.dispatchEvent(new Event("change")); })()`, ["displayMode"]],
		["key-configured", "key background", `(() => { const s = document.getElementById("f-background"); s.value = "glass"; s.dispatchEvent(new Event("change")); })()`, ["keyBackground"]],
		["key-configured", "key accent words", `(() => { const c = document.getElementById("f-accent-words"); c.value = "on"; c.dispatchEvent(new Event("change")); })()`, ["keyAccentWords"]],
		// Reading 1's number carries the unit it was typed in (alertDisplayUnit)
		// in the same write, so a later °C/°F switch converts it.
		["key-configured", "warn", `(() => { const i = document.getElementById("f-warn"); i.focus(); i.value = "75,5"; i.dispatchEvent(new Event("input")); i.dispatchEvent(new Event("change")); i.blur(); })()`, ["alertDisplayUnit", "alertDisplayUnitFor", "warnValue"]],
		["key-configured", "press", `(() => { const s = document.getElementById("f-press"); s.value = "open-details"; s.dispatchEvent(new Event("change")); })()`, ["pressBehavior"]],
		["key-dense", "one cell color", `(() => { const c = document.getElementById("quad-color-3"); c.value = "#010203"; c.dispatchEvent(new Event("change")); })()`, ["quadColors"]],
		["dial-configured", "view", `(() => { const s = document.getElementById("f-view"); s.value = "overview"; s.dispatchEvent(new Event("change")); })()`, ["dialView"]],
		["dial-configured", "gesture preset", `(() => { const s = document.getElementById("f-preset"); s.value = "elite"; s.dispatchEvent(new Event("change")); })()`, ["controlPreset"]],
		["control-default", "command", `(() => { const s = document.getElementById("f-command"); s.value = "resetStats"; s.dispatchEvent(new Event("change")); })()`, ["command"]]
	];
	for (const [fixture, name, script, expected] of edits) {
		await open(fixture);
		const before = structuredClone(sim.settings);
		await b.evaluate(`document.querySelectorAll("details.hw-sec").forEach((d) => { d.open = true; })`);
		await b.evaluate(script);
		await sleep(450);
		const after = lastWrite();
		check(`edit ${name}: one write`, sim.writes.length === 1 && sim.globalWrites.length === 0, JSON.stringify(writes()));
		check(`edit ${name}: changed exactly ${expected.join(", ")}`, after !== undefined && same(changedKeys(before, after), expected), JSON.stringify(after === undefined ? null : changedKeys(before, after)));
		if (before.futureBlob !== undefined) check(`edit ${name}: unknown nested field intact`, same(after?.futureBlob, FUTURE_BLOB));
	}
	// One quad cell: the other entries stay byte-identical, junk included.
	await open("key-dense", { settings: { ...sim.fixtures["key-dense"].settings, quadColors: ["#4CC2FF", "bad", "#38CD89", "#D4AB33", "#FUTURE"] } });
	await b.evaluate(`(() => { document.getElementById("sec-display").open = true; const c = document.getElementById("quad-color-1"); c.value = "#aa0000"; c.dispatchEvent(new Event("change")); })()`);
	await sleep(300);
	check("lossless: one cell rewrote only its own entry", same(lastWrite()?.quadColors, ["#aa0000", "bad", "#38CD89", "#D4AB33", "#FUTURE"]), JSON.stringify(lastWrite()?.quadColors));
	// The shared (global) theme is an explicit, separately scoped edit.
	await open("key-inherited");
	await b.evaluate(`(() => { document.getElementById("sec-advanced").open = true; const s = document.getElementById("shared-theme"); s.value = "forest"; s.dispatchEvent(new Event("change")); })()`);
	await sleep(300);
	check("edit shared theme: writes globals only", sim.writes.length === 0 && sim.globalWrites.length === 1, JSON.stringify(writes()));
	check("edit shared theme: keeps other shared fields", sim.globalWrites.at(-1)?.theme === "forest" && sim.globalWrites.at(-1)?.textMode === "dim", JSON.stringify(sim.globalWrites.at(-1)));
	// The shared Background and Words defaults (src/ui/shared-looks.ts):
	// both panels offer ONE Background and one Words for every key, dial and
	// strip; an edit there writes the key and the dial global together in
	// one write, the action's Default options name the shared value and
	// follow a change at once, and picking Default saves the empty value, as
	// Text color's Default does.
	for (const [fixture, kind] of [["key-configured", "key"], ["dial-configured", "dial"]]) {
		await open(fixture, { settings: { ...sim.fixtures[fixture].settings, [`${kind}Background`]: "theme", [`${kind}AccentWords`]: false } });
		const offered = await b.evaluate(`(() => ({ looks: [...document.getElementById("shared-background").options].map((o) => o.value), label: document.querySelector('label[for="shared-background"]').textContent, bound: document.getElementById("shared-background").hasAttribute("data-setting") || document.getElementById("shared-accent-words").hasAttribute("data-setting"), words: !document.getElementById("shared-words-item").hidden, width: Math.round(document.getElementById("shared-background").getBoundingClientRect().width), own: [...document.getElementById("f-background").options].map((o) => o.textContent), ownWords: [...document.getElementById("f-accent-words").options].map((o) => o.textContent) }))()`);
		check(`shared looks (${kind}): Shared defaults offer one Background for keys, dials and strips`, same(offered.looks, ["theme", "glass", "tint", "outline", "clear", "stars", "dusk", "nebula"]) && offered.label === "Background" && !offered.bound, JSON.stringify(offered));
		check(`shared looks (${kind}): Words shows only on a look that takes it (Theme: hidden)`, offered.words === false, JSON.stringify(offered));
		check(`shared looks (${kind}): the Default options name the shared Theme and Off`, offered.own[0] === "Theme (shared)" && offered.ownWords[0] === "Off (shared)", JSON.stringify([offered.own[0], offered.ownWords[0]]));
		const sharedBefore = structuredClone(sim.globals);
		await b.evaluate(`(() => { document.getElementById("sec-advanced").open = true; document.getElementById("sec-shared").open = true; const s = document.getElementById("shared-background"); s.value = "glass"; s.dispatchEvent(new Event("change")); })()`);
		await sleep(300);
		check(`shared looks (${kind}): the shared Background writes keyBackground and dialBackground together, in one write to the globals`, sim.writes.length === 0 && sim.globalWrites.length === 1 && sim.globalWrites.at(-1)?.keyBackground === "glass" && sim.globalWrites.at(-1)?.dialBackground === "glass" && same(changedKeys(sharedBefore, sim.globalWrites.at(-1) ?? {}), ["dialBackground", "keyBackground"]), JSON.stringify({ ...writes(), shared: sim.globalWrites.at(-1) }));
		const glassRow = await b.evaluate(`({ words: !document.getElementById("shared-words-item").hidden && document.getElementById("shared-words-item").getClientRects().length > 0, width: Math.round(document.getElementById("shared-background").getBoundingClientRect().width) })`);
		check(`shared looks (${kind}): on Glass, Words shows under it and the Background select keeps its width`, glassRow.words && glassRow.width === offered.width, JSON.stringify({ glassRow, theme: offered.width }));
		await b.evaluate(`(() => { const c = document.getElementById("shared-accent-words"); c.checked = true; c.dispatchEvent(new Event("change")); })()`);
		await sleep(300);
		check(`shared looks (${kind}): the shared Words writes keyAccentWords and dialAccentWords together`, sim.writes.length === 0 && sim.globalWrites.length === 2 && sim.globalWrites.at(-1)?.keyAccentWords === true && sim.globalWrites.at(-1)?.dialAccentWords === true && same(changedKeys(sim.globalWrites[0], sim.globalWrites[1]), ["dialAccentWords", "keyAccentWords"]), JSON.stringify(sim.globalWrites.at(-1)));
		const named = await b.evaluate(`[document.querySelector('#f-background option[value=""]').textContent, document.querySelector('#f-accent-words option[value=""]').textContent]`);
		check(`shared looks (${kind}): the Default options follow the shared change at once`, same(named, ["Glass (shared)", "On (shared)"]), JSON.stringify(named));
		const own = await b.evaluate(`({ look: document.getElementById("f-background").value, words: document.getElementById("f-accent-words").value })`);
		check(`shared looks (${kind}): an action's own Theme and Off stay chosen`, own.look === "theme" && own.words === "off", JSON.stringify(own));
		const settingsBefore = structuredClone(sim.settings);
		await b.evaluate(`(() => { const s = document.getElementById("f-background"); s.value = ""; s.dispatchEvent(new Event("change")); })()`);
		await sleep(300);
		await b.evaluate(`(() => { const s = document.getElementById("f-accent-words"); s.value = ""; s.dispatchEvent(new Event("change")); })()`);
		await sleep(300);
		check(`shared looks (${kind}): Default saves the empty value for each field, one write each`, sim.writes.length === 2 && sim.globalWrites.length === 2 && sim.writes[0]?.[`${kind}Background`] === "" && sim.writes[1]?.[`${kind}AccentWords`] === "" && same(changedKeys(settingsBefore, sim.writes[1] ?? {}), [`${kind}AccentWords`, `${kind}Background`].sort()), JSON.stringify({ ...writes(), last: sim.writes.at(-1) }));
		const shown = await b.evaluate(`({ words: !document.getElementById("accent-words").hidden, help: !document.getElementById("background-help").hidden })`);
		check(`shared looks (${kind}): following the shared Glass shows Words and the one help line`, shown.words && shown.help, JSON.stringify(shown));
	}

	// Globals an earlier candidate left different: each panel shows what its
	// own kind draws; a change sets both.
	for (const [fixture, kind, look] of [["key-configured", "key", "stars"], ["dial-configured", "dial", "nebula"]]) {
		await open(fixture, { globals: { ...sim.fixtures[fixture].globals, keyBackground: "stars", dialBackground: "nebula" } });
		const showing = await b.evaluate(`document.getElementById("shared-background").value`);
		check(`shared looks (${kind}): with the two globals different, the panel shows its own kind's (${look})`, showing === look, showing);
		await b.evaluate(`(() => { document.getElementById("sec-advanced").open = true; document.getElementById("sec-shared").open = true; const s = document.getElementById("shared-background"); s.value = "tint"; s.dispatchEvent(new Event("change")); })()`);
		await sleep(300);
		check(`shared looks (${kind}): a change sets both to it`, sim.globalWrites.length === 1 && sim.globalWrites[0]?.keyBackground === "tint" && sim.globalWrites[0]?.dialBackground === "tint", JSON.stringify(sim.globalWrites));
	}

	// The count line and "Use it everywhere" on the owner's page
	// (2026-10-26): shared Nebula, and the plugin counts 4 dials and 1
	// strip keeping their own background (one strip with its own words).
	{
		const ownersGlobals = { ...sim.fixtures["dial-configured"].globals, keyBackground: "nebula", dialBackground: "nebula" };
		await open("dial-configured", { globals: ownersGlobals, ownLooks: { keys: 0, dials: 4, strips: 1, background: 5, words: 1 } });
		await b.evaluate(`(() => { document.getElementById("sec-advanced").open = true; document.getElementById("sec-shared").open = true; })()`);
		await sleep(250);
		const line = await b.evaluate(`(() => { const el = document.getElementById("own-looks"); const r = el.getBoundingClientRect(); return { text: document.getElementById("own-looks-text").textContent, link: document.getElementById("own-looks-use").hidden ? null : document.getElementById("own-looks-use").textContent, tone: el.dataset.tone, height: Math.round(r.height), inside: r.right <= document.documentElement.clientWidth }; })()`);
		check("count line: says who keeps their own choice, in the status style, with Use it everywhere", line.text === "4 dials and 1 strip use their own background." && line.link === "Use it everywhere" && line.tone === "info" && line.inside, JSON.stringify(line));
		noWrites("count line: opening and the count write nothing");
		const before = structuredClone(sim.globals);
		await b.evaluate(`(() => { const u = document.getElementById("own-looks-use"); u.focus(); u.click(); })()`);
		await sleep(500);
		const armed = await b.evaluate(`document.getElementById("own-looks-use").textContent`);
		check("Use it everywhere: the first press arms, in words, and writes nothing", armed === "Press again to use it everywhere" && sim.globalWrites.length === 0 && sim.writes.length === 0, JSON.stringify({ armed, writes: writes() }));
		await b.evaluate(`document.getElementById("own-looks-use").click()`);
		await sleep(350);
		const wrote = sim.globalWrites.at(-1) ?? {};
		check("Use it everywhere: one write to the globals, none to the action", sim.writes.length === 0 && sim.globalWrites.length === 1, JSON.stringify(writes()));
		check("Use it everywhere: the generation goes up by one, with both Backgrounds as shown and nothing else", wrote.looksResetGen === 1 && wrote.keyBackground === "nebula" && wrote.dialBackground === "nebula" && same(changedKeys(before, wrote), ["looksResetGen"]), JSON.stringify(changedKeys(before, wrote)));
		const after = await b.evaluate(`({ text: document.getElementById("own-looks-text").textContent, link: !document.getElementById("own-looks-use").hidden, tone: document.getElementById("own-looks").dataset.tone, focus: document.activeElement?.id })`);
		check("Use it everywhere: the line goes with the count, and focus stays on the shared Background", after.text === "" && !after.link && after.tone === "" && after.focus === "shared-background", JSON.stringify(after));
		// Pressed again later: the generation keeps going up.
		sim.ownLooks = { keys: 1, dials: 0, strips: 0, background: 1, words: 0 };
		await b.evaluate(`window.SDPIComponents.streamDeckClient.send("sendToPlugin", { event: "getOwnLooks" })`);
		await sleep(200);
		check("count line: one key", (await b.evaluate(`document.getElementById("own-looks-text").textContent`)) === "1 key uses its own background.");
		await b.evaluate(`(() => { const u = document.getElementById("own-looks-use"); u.focus(); u.click(); })()`);
		await sleep(500);
		await b.evaluate(`document.getElementById("own-looks-use").click()`);
		await sleep(350);
		check("Use it everywhere again: generation 2", sim.globalWrites.at(-1)?.looksResetGen === 2, JSON.stringify(sim.globalWrites.at(-1)));
	}

	// A Background or Words picked for one key or dial after a reset carries
	// the generation in the same one write; Default carries nothing new.
	for (const [fixture, kind] of [["key-configured", "key"], ["dial-configured", "dial"]]) {
		await open(fixture, { globals: { ...sim.fixtures[fixture].globals, looksResetGen: 3 } });
		const before = structuredClone(sim.settings);
		await b.evaluate(`(() => { document.querySelectorAll("details.hw-sec").forEach((d) => { d.open = true; }); const s = document.getElementById("f-background"); s.value = "clear"; s.dispatchEvent(new Event("change")); })()`);
		await sleep(400);
		check(`own look after a reset (${kind}): one write, its Background and the generation`, sim.writes.length === 1 && sim.globalWrites.length === 0 && sim.writes[0]?.[`${kind}Background`] === "clear" && sim.writes[0]?.looksGen === 3 && same(changedKeys(before, sim.writes[0] ?? {}), [`${kind}Background`, "looksGen"].sort()), JSON.stringify(changedKeys(before, sim.writes[0] ?? {})));
		await b.evaluate(`(() => { const s = document.getElementById("f-background"); s.value = ""; s.dispatchEvent(new Event("change")); })()`);
		await sleep(400);
		check(`own look after a reset (${kind}): Default changes only the Background`, sim.writes.length === 2 && same(changedKeys(sim.writes[0], sim.writes[1] ?? {}), [`${kind}Background`]), JSON.stringify(changedKeys(sim.writes[0], sim.writes[1] ?? {})));
	}
	{
		await open("key-configured");
		const before = structuredClone(sim.settings);
		await b.evaluate(`(() => { document.querySelectorAll("details.hw-sec").forEach((d) => { d.open = true; }); const s = document.getElementById("f-background"); s.value = "clear"; s.dispatchEvent(new Event("change")); })()`);
		await sleep(400);
		check("own look with no reset ever made: no generation is added", sim.writes.length === 1 && same(changedKeys(before, sim.writes[0] ?? {}), ["keyBackground"]), JSON.stringify(changedKeys(before, sim.writes[0] ?? {})));
	}

	// The strip's Background, set under Display on a dial in the strip: a
	// new strip is on Default, which names the shared Background and
	// follows it; an own pick is one stripEdit; Default clears the strip's
	// Background and Words together.
	{
		await open("dial-strip-member");
		await sleep(300);
		const strip = () => b.evaluate(`({ value: document.getElementById("f-background").value, text: document.querySelector('#f-background option[value=""]')?.textContent })`);
		const fresh = await strip();
		check("strip Background: a new strip is on Default, Theme (shared)", fresh.value === "" && fresh.text === "Theme (shared)", JSON.stringify(fresh));
		sim.globals = { ...sim.globals, keyBackground: "nebula", dialBackground: "nebula" };
		sim.piWs.send(JSON.stringify({ event: "didReceiveGlobalSettings", payload: { settings: sim.globals } }));
		await sleep(250);
		check("strip Background: Default names a shared change at once", (await strip()).text === "Nebula (shared)", JSON.stringify(await strip()));
		const edits = () => sim.piMessages.filter((m) => m.event === "sendToPlugin" && m.payload?.event === "stripEdit").map((m) => m.payload.patch);
		const sent = edits().length;
		await b.evaluate(`(() => { const s = document.getElementById("f-background"); s.value = "clear"; s.dispatchEvent(new Event("change")); })()`);
		await sleep(500);
		check("strip Background: an own pick is one stripEdit of the Background", edits().length === sent + 1 && same(edits().at(-1), [{ op: "set", path: "background", value: "clear" }]), JSON.stringify(edits().slice(sent)));
		await b.evaluate(`(() => { const s = document.getElementById("f-background"); s.value = ""; s.dispatchEvent(new Event("change")); })()`);
		await sleep(500);
		check("strip Background: Default is one stripEdit clearing the Background (and Words)", edits().length === sent + 2 && same(edits().at(-1), [{ op: "set", path: "background", value: "" }]), JSON.stringify(edits().slice(sent)));
		check("strip Background: the panel never writes the dial's settings itself", sim.writes.length === 0, JSON.stringify(writes()));
	}

	// The sky pair (art looks only), on a key and a dial at the app's 378 px:
	// Stars and Sky color are one label-over pair in Background's width,
	// their Default options name the value first, one line under Background
	// shows only where it adds a fact (on Paper the art draws no sky), the
	// shared pair is in reach while this action draws an art look, a kept
	// value stacks the pair and shows whole, and only a person's pick
	// writes, once. A pick in the pair never moves the pair (on the Stars
	// look a line for the Few an Off draws came and went with each Stars
	// pick and moved the pair 19.1 px). Background and the pair are
	// described by the lines that show and only those, as the
	// accessibility tree reads them: a hidden line referenced by
	// aria-describedby is still read out, and on Dusk the pair was
	// described as "Paper draws no sky".
	{
		// The accessible description of Background and the pair, as
		// Chromium computes it (aria-describedby includes hidden lines).
		const DESCRIBED = ["f-background", "f-art-stars", "f-art-sky-color"];
		const described = async () => {
			const doc = await b.send("DOM.getDocument", { depth: 0 });
			const out = {};
			for (const id of DESCRIBED) {
				const { nodeId } = await b.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: `#${id}` });
				const tree = await b.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
				out[id] = tree.nodes[0]?.description?.value ?? "";
			}
			return out;
		};
		const PAPER_LINE = "Paper draws no sky; a dark theme shows it.";
		const NONE = { "f-background": "", "f-art-stars": "", "f-art-sky-color": "" };
		const SKY = `(() => {
			const box = (e) => { const r = e.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right, width: r.width }; };
			const shown = (e) => !e.hidden && e.getClientRects().length > 0;
			const pair = document.getElementById("art-sky");
			const stars = document.getElementById("f-art-stars");
			const tone = document.getElementById("f-art-sky-color");
			const note = document.getElementById("art-help");
			const sharedSky = document.getElementById("shared-sky-item");
			const canvas = document.createElement("canvas").getContext("2d");
			const cut = [];
			for (const select of [stars, tone]) {
				if (select.getClientRects().length === 0) continue;
				const cs = getComputedStyle(select);
				canvas.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
				const room = select.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 16;
				for (const o of select.options) if (!o.hidden && canvas.measureText(o.text).width > room) cut.push(o.text);
			}
			return {
				shown: shown(pair), stack: pair.classList.contains("hw-stack"), idle: pair.classList.contains("hw-idle"),
				note: shown(note) ? note.textContent : null,
				bg: box(document.getElementById("f-background")), stars: box(stars), tone: box(tone),
				starsLabel: box(document.querySelector('label[for="f-art-stars"]')), toneLabel: box(document.querySelector('label[for="f-art-sky-color"]')),
				starsText: stars.selectedOptions[0]?.textContent ?? null, toneText: tone.selectedOptions[0]?.textContent ?? null,
				offHidden: stars.querySelector('option[value="off"]:not([data-unknown])')?.hidden ?? null,
				enabled: !stars.disabled && !tone.disabled, cut,
				sharedSky: shown(sharedSky), sharedSkyHidden: sharedSky.hidden,
				sharedStars: document.getElementById("shared-stars").selectedOptions[0]?.textContent ?? null
			};
		})()`;
		const near = (a, b) => Math.abs(a - b) <= 1;
		const still = (a, b) => Math.abs(a - b) <= 0.5;
		await b.viewport(378, 900, 1);
		await b.send("DOM.enable");
		await b.send("Accessibility.enable");
		try {
			for (const [fixture, kind] of [["key-configured", "key"], ["dial-configured", "dial"]]) {
				const pictureLine = kind === "key" ? "Shows the page picture; an alert still fills the key." : "Shows the touch strip picture set in the Stream Deck app.";
				const fx = sim.fixtures[fixture];
				const [lookKey, starsKey, toneKey] = [`${kind}Background`, `${kind}Stars`, `${kind}SkyColor`];
				const openSky = async (settings = {}, globals = {}, shared = false) => {
					await open(fixture, { settings: { ...fx.settings, ...settings }, globals: { ...fx.globals, ...globals } });
					await b.evaluate(`(() => { document.getElementById("sec-display").open = true; ${shared ? `document.getElementById("sec-advanced").open = true; document.getElementById("sec-shared").open = true;` : ""} })()`);
					await sleep(150);
					await b.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
					return b.evaluate(SKY);
				};
				const pick = async (id, value) => {
					await b.evaluate(`(() => { const s = document.getElementById(${JSON.stringify(id)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event("change")); })()`);
					await sleep(350);
				};
				// 1. Own Dusk on Void.
				let s = await openSky({ [lookKey]: "dusk" });
				check(`sky pair (${kind}): own Dusk on Void shows the pair in one row, no note, nothing idle`, s.shown && !s.stack && !s.idle && s.note === null, JSON.stringify(s));
				check(`sky pair (${kind}): each label sits over its select`, s.starsLabel.bottom <= s.stars.top + 0.5 && s.toneLabel.bottom <= s.tone.top + 0.5, JSON.stringify([s.starsLabel, s.stars, s.toneLabel, s.tone]));
				check(`sky pair (${kind}): the two selects share Background's width, edge to edge`, near(s.stars.width, s.tone.width) && near(s.stars.left, s.bg.left) && near(s.tone.right, s.bg.right), JSON.stringify({ bg: s.bg, stars: s.stars, tone: s.tone }));
				check(`sky pair (${kind}): the Defaults read All (shared) and Theme (shared)`, s.starsText === "All (shared)" && s.toneText === "Theme (shared)", JSON.stringify([s.starsText, s.toneText]));
				let d = await described();
				check(`sky pair (${kind}): on Dusk on Void, with no line shown, Background, Stars and Sky color have no description`, same(d, NONE), JSON.stringify(d));
				noWrites(`sky pair (${kind}) own Dusk`);
				// 2. Reach: the shared pair shows while this action draws an art
				// look, though the shared Background is Theme.
				s = await openSky({ [lookKey]: "dusk" }, {}, true);
				check(`sky pair (${kind}): with the shared Background on Theme, Shared defaults still shows Stars and Sky color while this ${kind} draws Dusk`, s.sharedSky, JSON.stringify(s));
				const before = structuredClone(sim.settings);
				const bgTop = s.bg.top;
				await pick("f-background", "theme");
				const after = await b.evaluate(SKY);
				check(`sky pair (${kind}): picking Theme is one write of ${lookKey} alone`, sim.writes.length === 1 && sim.globalWrites.length === 0 && sim.writes[0]?.[lookKey] === "theme" && same(changedKeys(before, sim.writes[0] ?? {}), [lookKey]), JSON.stringify({ ...writes(), changed: changedKeys(before, sim.writes[0] ?? {}) }));
				check(`sky pair (${kind}): on Theme the shared pair goes and Background does not move`, after.sharedSkyHidden && !after.shown && near(after.bg.top, bgTop), JSON.stringify({ after, bgTop }));
				// 3. Shared Paper: the art draws no sky; a dark theme shows it.
				s = await openSky({ [lookKey]: "dusk" }, { theme: "paper" });
				check(`sky pair (${kind}): on a shared Paper the line says Paper draws no sky, and the pair reads as idle but stays enabled`, s.note === "Paper draws no sky; a dark theme shows it." && s.idle && s.enabled && s.shown, JSON.stringify(s));
				d = await described();
				check(`sky pair (${kind}): on Paper the line is the description of Background, Stars and Sky color`, same(d, { "f-background": PAPER_LINE, "f-art-stars": PAPER_LINE, "f-art-sky-color": PAPER_LINE }), JSON.stringify(d));
				sim.pushGlobals({ ...sim.globals, theme: "void" });
				await sleep(350);
				const back = await b.evaluate(SKY);
				check(`sky pair (${kind}): a shared Void pushed from elsewhere hides the line and the pair is no longer idle`, back.note === null && !back.idle, JSON.stringify(back));
				d = await described();
				check(`sky pair (${kind}): with the line hidden again, the description goes with it`, same(d, NONE), JSON.stringify(d));
				noWrites(`sky pair (${kind}) shared Paper`);
				// 4. Own Paper.
				s = await openSky({ [lookKey]: "dusk", theme: "paper" });
				check(`sky pair (${kind}): this ${kind}'s own Paper gives the same line and idle pair`, s.note === "Paper draws no sky; a dark theme shows it." && s.idle && s.enabled, JSON.stringify(s));
				noWrites(`sky pair (${kind}) own Paper`);
				// 5. The Stars look keeps a few stars: a stored Off shows as the
				// Few it draws, and no line comes and goes with it.
				s = await openSky({ [lookKey]: "stars", [starsKey]: "off" });
				check(`sky pair (${kind}): on the Stars look a stored Off shows as Few, Off is not offered, and no line shows`, s.starsText === "Few" && s.offHidden === true && s.note === null, JSON.stringify(s));
				s = await openSky({ [lookKey]: "dusk", [starsKey]: "off" });
				check(`sky pair (${kind}): on Dusk a stored Off shows as Off, with no line`, s.starsText === "Off" && s.offHidden === false && s.note === null, JSON.stringify(s));
				noWrites(`sky pair (${kind}) Stars floor`);
				// 6. A shared Off under the Stars look.
				const SHARED_OFF = { keyBackground: "dusk", dialBackground: "dusk", keyStars: "off", dialStars: "off" };
				s = await openSky({ [lookKey]: "stars" }, SHARED_OFF);
				check(`sky pair (${kind}): a shared Off on this ${kind}'s Stars look reads Few (shared) with no line, and Shared defaults keeps Off`, s.starsText === "Few (shared)" && s.note === null && s.sharedStars === "Off", JSON.stringify(s));
				noWrites(`sky pair (${kind}) shared Off`);
				// 6b. A Stars pick never moves the pair, in the three states a
				// 19.1 px jump was measured in: an own Off shown as Few,
				// then All; an own Few under a shared Off, then Default; Default
				// under a shared Off, then All.
				for (const [label, own, globals, value] of [
					["an own Off shown as Few, then All", { [starsKey]: "off" }, {}, "all"],
					["an own Few under a shared Off, then Default", { [starsKey]: "few" }, SHARED_OFF, ""],
					["Default under a shared Off, then All", {}, SHARED_OFF, "all"]
				]) {
					s = await openSky({ [lookKey]: "stars", ...own }, globals);
					const prior = structuredClone(sim.settings);
					await pick("f-art-stars", value);
					const moved = await b.evaluate(SKY);
					check(`sky pair (${kind}): on the Stars look, ${label}: the pair stays put and no line shows`, still(moved.stars.top, s.stars.top) && still(moved.tone.top, s.tone.top) && moved.note === null, JSON.stringify({ before: s.stars.top, after: moved.stars.top, note: moved.note }));
					check(`sky pair (${kind}): on the Stars look, ${label}: one write of ${starsKey}`, sim.writes.length === 1 && sim.globalWrites.length === 0 && sim.writes[0]?.[starsKey] === value && same(changedKeys(prior, sim.writes[0] ?? {}), [starsKey]), JSON.stringify({ ...writes(), last: sim.writes.at(-1) }));
				}
				// 6c. From the Stars look to Dusk, the pair is described by
				// nothing it does not show (the Stars look's line was still read
				// out on Dusk).
				await openSky({ [lookKey]: "stars", [starsKey]: "off" });
				await pick("f-background", "dusk");
				d = await described();
				check(`sky pair (${kind}): from the Stars look to Dusk, Background, Stars and Sky color have no description`, same(d, NONE), JSON.stringify(d));
				// 6d. Background is described by its picture line on the
				// see-through looks, and by nothing on Theme.
				await openSky({ [lookKey]: "glass" });
				d = await described();
				check(`sky pair (${kind}): on Glass, Background is described by its picture line alone`, d["f-background"] === pictureLine, JSON.stringify(d));
				await openSky({ [lookKey]: "theme" });
				d = await described();
				check(`sky pair (${kind}): on Theme, Background has no description`, d["f-background"] === "", JSON.stringify(d));
				noWrites(`sky pair (${kind}) descriptions`);
				// 7. Kept values stack the pair and show whole.
				s = await openSky({ [lookKey]: "dusk", [starsKey]: "some", [toneKey]: "teal" });
				check(`sky pair (${kind}): kept values stack the pair and show as kept, whole`, s.stack && s.starsText === 'Stored value "some" (not in this list, kept)' && s.toneText === 'Stored value "teal" (not in this list, kept)' && s.cut.length === 0, JSON.stringify(s));
				noWrites(`sky pair (${kind}) kept values`);
				// 8. Only a person's pick writes, once each, and no pick moves the pair.
				const opened = await openSky({ [lookKey]: "dusk" });
				let prior = structuredClone(sim.settings);
				await pick("f-art-stars", "few");
				check(`sky pair (${kind}): picking Few is one write of ${starsKey}: few`, sim.writes.length === 1 && sim.globalWrites.length === 0 && sim.writes[0]?.[starsKey] === "few" && same(changedKeys(prior, sim.writes[0] ?? {}), [starsKey]), JSON.stringify({ ...writes(), last: sim.writes.at(-1) }));
				prior = structuredClone(sim.settings);
				await pick("f-art-stars", "");
				check(`sky pair (${kind}): picking Default is one write of ${starsKey}: ""`, sim.writes.length === 2 && sim.writes[1]?.[starsKey] === "" && same(changedKeys(prior, sim.writes[1] ?? {}), [starsKey]), JSON.stringify({ ...writes(), last: sim.writes.at(-1) }));
				prior = structuredClone(sim.settings);
				await pick("f-art-sky-color", "deep");
				check(`sky pair (${kind}): picking Deep is one write of ${toneKey}: deep`, sim.writes.length === 3 && sim.writes[2]?.[toneKey] === "deep" && same(changedKeys(prior, sim.writes[2] ?? {}), [toneKey]) && sim.globalWrites.length === 0, JSON.stringify({ ...writes(), last: sim.writes.at(-1) }));
				const picked = await b.evaluate(SKY);
				check(`sky pair (${kind}): after Few, Default and Deep the pair is where it opened`, still(picked.stars.top, opened.stars.top) && still(picked.tone.top, opened.tone.top), JSON.stringify({ opened: opened.stars.top, picked: picked.stars.top }));
				// 9. Shared defaults: Words alone under a full-width Background,
				// whose width never changes with the look.
				const sharedRow = () => b.evaluate(`(() => { const bg = document.getElementById("shared-background").getBoundingClientRect(); const w = document.getElementById("shared-words-item"); const wr = w.getBoundingClientRect(); return { width: bg.width, bottom: bg.bottom, words: !w.hidden && w.getClientRects().length > 0, wordsTop: wr.top, sky: !document.getElementById("shared-sky-item").hidden }; })()`);
				const widths = {};
				for (const look of ["theme", "glass", "dusk"]) {
					await openSky({}, { keyBackground: look, dialBackground: look }, true);
					const row = await sharedRow();
					widths[look] = row.width;
					if (look === "glass") check(`sky pair (${kind}): on a shared Glass, Words shows alone under the full-width Background`, row.words && row.wordsTop >= row.bottom - 0.5 && !row.sky, JSON.stringify(row));
					if (look === "dusk") check(`sky pair (${kind}): on a shared Dusk, Stars and Sky color show and Words does not`, row.sky && !row.words, JSON.stringify(row));
					noWrites(`sky pair (${kind}) shared ${look}`);
				}
				check(`sky pair (${kind}): the shared Background keeps one width on Theme, Glass and Dusk`, near(widths.theme, widths.glass) && near(widths.theme, widths.dusk), JSON.stringify(widths));
			}
		} finally {
			await b.send("Accessibility.disable").catch(() => {});
			await b.send("DOM.disable").catch(() => {});
			await b.viewport(400, 900, 1);
		}
	}

	// The read interval is a real shared control on both sensor panels: one
	// globals write of pollIntervalMs alone, and the Advanced title line
	// reads the new interval the way the runtime parses it.
	for (const fixture of ["key-inherited", "dial-configured"]) {
		await open(fixture);
		const sharedBefore = structuredClone(sim.globals);
		const poll = await b.evaluate(`(() => { document.getElementById("sec-advanced").open = true; const s = document.getElementById("shared-poll"); if (s === null) return null; const offered = [...s.options].map((o) => o.value); s.value = "2000"; s.dispatchEvent(new Event("change")); return { offered, fallback: s.dataset.default }; })()`);
		await sleep(300);
		check(`read every (${fixture}): the panel offers the five intervals with the 1 s default`, same(poll?.offered, ["250", "500", "1000", "2000", "5000"]) && poll?.fallback === "1000", JSON.stringify(poll));
		const shared = sim.globalWrites.at(-1);
		check(`read every (${fixture}): one globals write of pollIntervalMs alone`, sim.writes.length === 0 && sim.globalWrites.length === 1 && shared?.pollIntervalMs === "2000" && same(changedKeys(sharedBefore, shared ?? {}), ["pollIntervalMs"]), JSON.stringify({ ...writes(), shared }));
		const summary = await b.evaluate(`document.querySelector('[data-summary="advanced"]')?.textContent ?? null`);
		check(`read every (${fixture}): the Advanced title line names the new interval`, /· read every 2 s ·/.test(String(summary)), String(summary));
	}

	// ---- lossless: groups, names, tiles, lists -----------------------------
	await open("dial-groups", {
		settings: { ...sim.fixtures["dial-groups"].settings, rotationKeys: [...sim.fixtures["dial-groups"].settings.rotationKeys, 42], rotationNames: { ...sim.fixtures["dial-groups"].settings.rotationNames, junk: 7 } }
	});
	const groupsBefore = structuredClone(sim.settings);
	await rotationTool("later", { group: 1, index: 0 });
	await sleep(300);
	let w = lastWrite();
	check("lossless: a reorder in group 2 wrote", w !== undefined);
	check("lossless: group 1's unknown field and keys unchanged", same(w?.rotationGroups?.[0], groupsBefore.rotationGroups[0]), JSON.stringify(w?.rotationGroups?.[0]));
	check("lossless: group 2 reordered, nothing else in it", same(w?.rotationGroups?.[1], { name: "GPU", keys: [...groupsBefore.rotationGroups[1].keys].reverse() }), JSON.stringify(w?.rotationGroups?.[1]));
	check("lossless: the flat mirror keeps its non-string entry", w?.rotationKeys?.at(-1) === 42, JSON.stringify(w?.rotationKeys));
	check("lossless: names untouched by a reorder", same(w?.rotationNames, groupsBefore.rotationNames), JSON.stringify(w?.rotationNames));
	// Rename a chip: only that entry changes; the junk entry survives.
	const renameKey = sim.keys.cpu;
	await rotationTool("rename", { key: renameKey });
	await sleep(100);
	await b.evaluate(`(() => { const i = document.querySelector("#rotation-set input.hw-chip-rename"); i.value = "Die"; i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
	await sleep(300);
	w = lastWrite();
	check("lossless: a rename changed one name and kept the junk entry", same(w?.rotationNames, { ...groupsBefore.rotationNames, [renameKey]: "Die" }), JSON.stringify(w?.rotationNames));
	// Merge: named groups ask for a second press (arm, then confirm after
	// 450 ms). The confirmed merge is one fresh write: the groups flatten
	// into one list in group order (the flat mirror's non-string entry
	// kept), reading names and the unknown top-level field ride along
	// (external review AX05: the old check read the rename's write).
	const mergeNames = structuredClone(sim.settings.rotationNames);
	const mergeKeys = [...new Set(sim.settings.rotationGroups.flatMap((g) => g.keys)), 42];
	sim.writes.length = 0;
	await b.evaluate(`document.querySelector('#rotation-set [data-set-action="merge"]').click()`);
	await sleep(100);
	check("lossless: the first Merge press only arms", sim.writes.length === 0, JSON.stringify(writes()));
	await sleep(450);
	await b.evaluate(`document.querySelector('#rotation-set [data-set-action="merge"]').click()`);
	await sleep(300);
	const merged = lastWrite();
	check("lossless: the confirmed merge writes once", sim.writes.length === 1, JSON.stringify(writes()));
	check("lossless: the confirmed merge flattens the groups into one list and keeps the non-string entry", same(merged?.rotationGroups, []) && same(merged?.rotationKeys, mergeKeys), JSON.stringify({ groups: merged?.rotationGroups, keys: merged?.rotationKeys, mergeKeys }));
	check("lossless: merge keeps the reading names", same(merged?.rotationNames, mergeNames), JSON.stringify(merged?.rotationNames));
	check("lossless: merge keeps the unknown top-level field", same(merged?.futureBlob, FUTURE_BLOB));

	await open("key-details", { settings: { ...sim.fixtures["key-details"].settings, detailKeys: [...sim.fixtures["key-details"].settings.detailKeys, 99, { future: "entry" }] } });
	const tilesBefore = structuredClone(sim.settings);
	await b.evaluate(`(() => { document.getElementById("sec-interaction").open = true; })()`);
	await sleep(150);
	await b.evaluate(`document.querySelectorAll('#detail-list .hw-set-chip .hw-set-remove')[4]?.click()`);
	await sleep(300);
	w = lastWrite();
	check("lossless: a removal outside tile 1 left tile 1 byte-identical (unknown field included)", same(w?.detailTiles?.[0], tilesBefore.detailTiles[0]), JSON.stringify(w?.detailTiles?.[0]));
	check("lossless: non-string list entries kept after the edited list", same(w?.detailKeys?.slice(-2), [99, { future: "entry" }]), JSON.stringify(w?.detailKeys));
	check("lossless: the title and unknown field ride along", w?.detailTitle === "Gaming" && same(w?.futureBlob, FUTURE_BLOB));

	// Kept entries go back where they were stored, and tiles this build
	// cannot read are neither pruned nor rewritten.
	const detailFx = sim.fixtures["key-details"].settings;
	await open("key-details", { settings: { ...detailFx, detailKeys: [detailFx.detailKeys[0], 99, ...detailFx.detailKeys.slice(1)], detailTiles: [...detailFx.detailTiles, 3, { size: 6 }] } });
	await b.evaluate(`(() => { document.getElementById("sec-interaction").open = true; })()`);
	await sleep(150);
	await b.evaluate(`(() => { const r = document.querySelectorAll('#detail-list .hw-set-chip .hw-set-remove'); r[r.length - 1]?.click(); })()`);
	await sleep(300);
	w = lastWrite();
	check("lossless: a kept list entry stays at its stored position", w?.detailKeys?.[1] === 99 && w?.detailKeys?.length === detailFx.detailKeys.length, JSON.stringify(w?.detailKeys));
	check("lossless: unreadable tiles are neither pruned nor rewritten", same(w?.detailTiles?.slice(1, 3), [3, { size: 6 }]), JSON.stringify(w?.detailTiles));
	const groupsFx = sim.fixtures["dial-groups"].settings;
	await open("dial-groups", { settings: { ...groupsFx, rotationGroups: [groupsFx.rotationGroups[0], "marker", groupsFx.rotationGroups[1]] } });
	await rotationTool("later", { group: 1, index: 0 });
	await sleep(300);
	w = lastWrite();
	check("lossless: a non-object group entry keeps its place", w?.rotationGroups?.[1] === "marker" && w?.rotationGroups?.length === 3, JSON.stringify(w?.rotationGroups));

	// One cell's color or label rewrites that cell only (external review
	// AX12): entries this version cannot read, entries past the tile's size
	// and the automatic-color list's other entries stay as stored.
	const TILE = { size: 4, labels: [" A ", { future: "label" }, "C", "D", "TAIL"], colors: ["#112233", { future: "color" }, "#334455", "#445566", "#ABCDEF"], automaticColors: [true, { future: "automatic" }, false, false, true], cellLabels: true, future: { keep: 1 } };
	const openTile = async () => {
		await open("key-details", { settings: { ...detailFx, detailTiles: [structuredClone(TILE)] } });
		await b.evaluate(`document.getElementById("sec-interaction").open = true`);
		await sleep(150);
	};
	await openTile();
	await b.evaluate(`(() => { const c = document.querySelector("#detail-list input[type=color]"); c.value = "#aabbcc"; c.dispatchEvent(new Event("change", { bubbles: true })); })()`);
	await sleep(400);
	check("lossless: one cell's color rewrites that color and turns off only its automatic flag", sim.writes.length === 1 && same(lastWrite()?.detailTiles, [{ ...TILE, colors: ["#aabbcc", { future: "color" }, "#334455", "#445566", "#ABCDEF"], automaticColors: [false, { future: "automatic" }, false, false, true] }]), JSON.stringify({ ...writes(), tiles: lastWrite()?.detailTiles }));
	await openTile();
	await b.evaluate(`document.querySelector("#detail-list .hw-set-chip .hw-set-name").click()`);
	await sleep(150);
	await b.evaluate(`(() => { const i = document.querySelector("#detail-list .hw-cell-rename"); i.value = "EDITED"; i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
	await sleep(400);
	check("lossless: one cell's label rewrites that label only", sim.writes.length === 1 && same(lastWrite()?.detailTiles, [{ ...TILE, labels: ["EDITED", { future: "label" }, "C", "D", "TAIL"] }]), JSON.stringify({ ...writes(), tiles: lastWrite()?.detailTiles }));

	// Structural edits keep what this version cannot read (external review
	// AX17 to AX19): a cell's stored entries move with its reading through
	// removals, resizes and swaps; stored tiles no reading reaches, and
	// trailing tiles holding such entries, stay stored. A tile's cell lists
	// are one sequence: removing a cell moves every later entry up one,
	// entries stored past the cells included, so none is written twice or
	// left behind a filler (external review AX47 replaced the d12 rule that
	// kept entries past the cells at their stored index).
	const tilesOut = () => JSON.stringify({ ...writes(), tiles: lastWrite()?.detailTiles, keys: lastWrite()?.detailKeys });
	await openTile();
	await b.evaluate(`document.querySelectorAll("#detail-list .hw-set-chip .hw-set-remove")[3].click()`);
	await sleep(400);
	check("lossless: removing a tile's fourth reading keeps the other cells' stored entries, and the entry past the cells moves up one", sim.writes.length === 1 && same(lastWrite()?.detailTiles, [{ ...TILE, size: 3, labels: [" A ", { future: "label" }, "C", "TAIL"], colors: ["#112233", { future: "color" }, "#334455", "#ABCDEF"], automaticColors: [true, { future: "automatic" }, false, true] }]), tilesOut());
	await openTile();
	await b.evaluate(`document.querySelector('#detail-list .hw-tile-size[data-tile="0"]').click()`);
	await sleep(400);
	check("lossless: a 4-to-1 resize keeps the entries past the cells, and the reading with unread entries keeps them in a tile of its own", sim.writes.length === 1 && same(lastWrite()?.detailTiles, [{ ...TILE, size: 1, labels: [" A ", "", "", "", "TAIL"], colors: ["#112233", null, null, null, "#ABCDEF"], automaticColors: [true, false, false, false, true] }, { size: 1, labels: [{ future: "label" }], colors: [{ future: "color" }], cellLabels: true, automaticColors: [{ future: "automatic" }] }]), tilesOut());
	await openTile();
	await b.evaluate(`document.querySelectorAll('#detail-list .hw-set-chip')[1].querySelector('.hw-detail-move[data-move="-1"]').click()`);
	await sleep(400);
	check("lossless: swapping two cells of a four-reading tile moves each reading's stored entries with it", sim.writes.length === 1 && same(lastWrite()?.detailTiles, [{ ...TILE, labels: [{ future: "label" }, " A ", "C", "D", "TAIL"], colors: [{ future: "color" }, "#112233", "#334455", "#445566", "#ABCDEF"], automaticColors: [{ future: "automatic" }, true, false, false, true] }]) && same(lastWrite()?.detailKeys?.slice(0, 2), [detailFx.detailKeys[1], detailFx.detailKeys[0]]), tilesOut());
	// A cell field stored in a shape this build cannot read stays as stored
	// through an edit that does not write it: the Abc toggle, clicked with
	// the mouse (external review AX58).
	await open("key-details", { settings: { ...detailFx, detailTiles: [{ size: 4, labels: { future: "keep" }, unknown: 42 }] } });
	await b.evaluate(`document.getElementById("sec-interaction").open = true`);
	await sleep(150);
	await b.evaluate(`document.querySelector('#detail-list .hw-tile-abc[data-tile="0"]').scrollIntoView({ block: "center" })`);
	await b.click('#detail-list .hw-tile-abc[data-tile="0"]');
	await sleep(400);
	check("lossless: the Abc toggle leaves a cell field this build cannot read as stored", sim.writes.length === 1 && same(lastWrite()?.detailTiles, [{ size: 4, labels: { future: "keep" }, unknown: 42, cellLabels: false }]), tilesOut());
	{
		const k = detailFx.detailKeys;
		const dormant = [{ size: 1, labels: ["A"] }, { size: 1, labels: ["B"] }, { size: 1, labels: ["DORMANT"], future: { keep: 1 } }];
		await open("key-details", { settings: { ...detailFx, detailKeys: [k[0], k[1]], detailTiles: structuredClone(dormant) } });
		await b.evaluate(`document.getElementById("sec-interaction").open = true`);
		await sleep(150);
		await b.evaluate(`document.querySelector('#detail-list .hw-tile-grip[data-tile="0"]').focus()`);
		await b.key("ArrowDown");
		await sleep(400);
		check("lossless: a whole-tile move keeps a stored tile no reading reaches", sim.writes.length === 1 && same(lastWrite()?.detailTiles, [dormant[1], dormant[0], dormant[2]]) && same(lastWrite()?.detailKeys, [k[1], k[0]]), tilesOut());
		for (const [what, trailing] of [["entries past its cells", { size: 1, labels: ["", "TAIL"], colors: [null, "#ABCDEF"], automaticColors: [false, true], cellLabels: true }], ["a label stored with spaces", { size: 1, labels: ["  "] }]]) {
			await open("key-details", { settings: { ...detailFx, detailKeys: [k[0], k[1]], detailTiles: [{ size: 1, labels: ["A"] }, structuredClone(trailing)] } });
			await b.evaluate(`document.getElementById("sec-interaction").open = true`);
			await sleep(150);
			await b.evaluate(`document.querySelector("#detail-list .hw-set-chip .hw-set-name").click()`);
			await sleep(150);
			await b.evaluate(`(() => { const i = document.querySelector("#detail-list .hw-cell-rename"); i.value = "EDITED"; i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
			await sleep(400);
			check(`lossless: renaming the first tile keeps an untouched trailing tile holding ${what}`, sim.writes.length === 1 && same(lastWrite()?.detailTiles, [{ size: 1, labels: ["EDITED"] }, trailing]), tilesOut());
		}
		// A partial tile moved ahead shrinks to the cells its readings fill,
		// and its dormant cells' entries stay stored past the new size
		// (external review AX29).
		const partial = { size: 4, labels: ["B", " d1 ", " d2 ", " d3 "], colors: ["#112233", { future: 1 }, "bad", "#aabbcc"] };
		await open("key-details", { settings: { ...detailFx, detailKeys: [k[0], k[1]], detailTiles: [{ size: 1 }, structuredClone(partial)] } });
		await b.evaluate(`document.getElementById("sec-interaction").open = true`);
		await sleep(150);
		await b.evaluate(`document.querySelector('#detail-list .hw-tile-grip[data-tile="1"]').focus()`);
		await b.key("ArrowUp");
		await sleep(400);
		check("lossless: a partial tile moved ahead keeps its dormant cells' entries past its new size", sim.writes.length === 1 && same(lastWrite()?.detailTiles, [{ ...partial, size: 1 }]) && same(lastWrite()?.detailKeys, [k[1], k[0]]), tilesOut());
		// An unrelated edit keeps short stored lists short (AX33) and every
		// key's stored spelling, pasted name and spacing included (AX37).
		const spelled = [` ${k[0]}  CPU temperature `, k[1]];
		await open("key-details", { settings: { ...detailFx, detailKeys: [...spelled], detailTiles: [{ size: 2, labels: ["A", "B"], colors: [], automaticColors: [] }] } });
		await b.evaluate(`document.getElementById("sec-interaction").open = true`);
		await sleep(150);
		await b.evaluate(`document.querySelector("#detail-list .hw-set-chip .hw-set-name").click()`);
		await sleep(150);
		await b.evaluate(`(() => { const i = document.querySelector("#detail-list .hw-cell-rename"); i.value = "NEW"; i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
		await sleep(400);
		check("lossless: renaming one cell leaves empty stored color lists empty", sim.writes.length === 1 && same(lastWrite()?.detailTiles, [{ size: 2, labels: ["NEW", "B"], colors: [], automaticColors: [] }]), tilesOut());
		check("lossless: renaming one cell keeps every key's stored spelling", same(lastWrite()?.detailKeys, spelled), tilesOut());
		// A key removed and ticked back is a new addition: written bare.
		await b.evaluate(`document.querySelector("#detail-list .hw-set-chip .hw-set-remove").click()`);
		await sleep(300);
		await b.evaluate(`document.getElementById("pickerd-search").focus()`);
		await sleep(300);
		await b.evaluate(`document.querySelector('#pickerd-list [data-key="${k[0]}"]').click()`);
		await sleep(400);
		check("details: a key removed and added back is written bare, not with its old spelling", same(lastWrite()?.detailKeys, [k[1], k[0]]), tilesOut());
		// Removing a reading from a tile whose empty cells still hold stored
		// entries shifts those cells: nothing is written twice (review of d13).
		await open("key-details", { settings: { ...detailFx, detailKeys: [k[0], k[1]], detailTiles: [{ size: 4, labels: ["B", "C", "d2", "d3"], colors: ["#111111", "#222222", "#333333", "#444444"] }] } });
		await b.evaluate(`document.getElementById("sec-interaction").open = true`);
		await sleep(150);
		await b.evaluate(`document.querySelector("#detail-list .hw-set-chip .hw-set-remove").click()`);
		await sleep(400);
		check("lossless: removing a reading from a partial tile writes each stored entry once", sim.writes.length === 1 && same(lastWrite()?.detailTiles, [{ size: 3, labels: ["C", "d2", "d3"], colors: ["#222222", "#333333", "#444444"] }]), tilesOut());
		// A partial tile cycled down to the fill size, storing only blank
		// entries, restates the fill and is pruned (review of d13).
		await open("key-details", { settings: { ...detailFx, detailKeys: [k[0], k[1]], detailTiles: [{ size: 1, labels: ["A"] }, { size: 4, labels: ["", "", "", ""], colors: [null, null, null, null], cellLabels: true }] } });
		await b.evaluate(`document.getElementById("sec-interaction").open = true`);
		await sleep(150);
		await b.evaluate(`document.querySelector('#detail-list .hw-tile-size[data-tile="1"]').click()`);
		await sleep(400);
		check("details: a blank partial tile cycled to the fill size is pruned", sim.writes.length === 1 && same(lastWrite()?.detailTiles, [{ size: 1, labels: ["A"] }]), tilesOut());
	}
	// One press removes one reading from a detail list too (external review
	// AX20): Enter held on a chip's remove used to empty the list.
	await open("key-details");
	await b.evaluate(`document.getElementById("sec-interaction").open = true`);
	await sleep(150);
	await b.evaluate(`document.querySelector("#detail-list .hw-set-chip .hw-set-remove").focus()`);
	const enterKey = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" };
	await b.send("Input.dispatchKeyEvent", { type: "keyDown", ...enterKey });
	for (let i = 0; i < 5; i++) await b.send("Input.dispatchKeyEvent", { type: "keyDown", ...enterKey, autoRepeat: true });
	await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
	await sleep(400);
	check("details: Enter held on a reading's remove removes one reading", sim.writes.length === 1 && same(lastWrite()?.detailKeys, detailFx.detailKeys.slice(1)), JSON.stringify({ ...writes(), keys: lastWrite()?.detailKeys }));

	// A double click only arms, however long the system's double-click time
	// (external review AX13: clicks 470 or 650 ms apart used to confirm):
	// the second click of one gesture carries detail 2. A separate click
	// then confirms once.
	const doubleClick = async (sel, gap) => {
		const p = await b.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
		await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
		for (const clickCount of [1, 2]) {
			await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount });
			await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount });
			if (clickCount === 1) await sleep(gap);
		}
		await sleep(250);
		return p;
	};
	const singleClick = async (p) => {
		for (const type of ["mousePressed", "mouseReleased"]) await b.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1 });
		await sleep(300);
	};
	const armCases = [
		["Merge", "dial-groups", '#rotation-set [data-set-action="merge"]', () => sim.writes.length],
		["group Remove", "dial-groups", "#rotation-set .hw-group-remove", () => sim.writes.length],
		["Replace shared settings", "key-configured", "#config-deck-apply", () => sim.globalWrites.length]
	];
	for (const [name, fixture, sel, count] of armCases) {
		for (const gap of [470, 650]) {
			await open(fixture);
			if (fixture === "key-configured") {
				await b.evaluate(`(() => { document.querySelectorAll("details").forEach((d) => { d.open = true; }); const t = document.getElementById("config-deck"); t.value = JSON.stringify({ theme: "paper", futureBlob: { keep: 42 } }); t.dispatchEvent(new Event("input", { bubbles: true })); })()`);
				await sleep(150);
			}
			const p = await doubleClick(sel, gap);
			const armed = await b.evaluate(`document.querySelector(${JSON.stringify(sel)})?.dataset.armed ?? null`);
			check(`${name}: a double click ${gap} ms apart only arms`, count() === 0 && armed === "true", JSON.stringify({ writes: count(), armed }));
			if (gap === 650) {
				await singleClick(p);
				check(`${name}: a separate click after the double click confirms once`, count() === 1, JSON.stringify({ writes: count() }));
			}
		}
	}
	// The press that confirms must begin on the armed button: a mouse held
	// down while Enter or Space arms it does not confirm on its release, and
	// a fresh click then does; a press begun under an arm that was dropped
	// (focus left and came back) does not confirm the next arm (external
	// review AX72, review of d17).
	const openArm = async (fixture, sel) => {
		await open(fixture);
		if (fixture === "key-configured") {
			await b.evaluate(`(() => { document.querySelectorAll("details").forEach((d) => { d.open = true; }); const t = document.getElementById("config-deck"); t.value = JSON.stringify({ theme: "paper" }); t.dispatchEvent(new Event("input", { bubbles: true })); })()`);
			await sleep(150);
		}
		return b.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: "center" }); e.focus({ preventScroll: true }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
	};
	const mouse = (type, p) => b.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
	for (const [name, fixture, sel, count] of armCases) {
		for (const key of ["Enter", " "]) {
			const p = await openArm(fixture, sel);
			await mouse("mouseMoved", p);
			await mouse("mousePressed", p);
			await b.key(key);
			await sleep(650);
			await mouse("mouseReleased", p);
			await sleep(250);
			const armed = await b.evaluate(`document.querySelector(${JSON.stringify(sel)})?.dataset.armed ?? null`);
			check(`${name}: a mouse held while ${key === " " ? "Space" : key} arms it does not confirm on its release`, count() === 0 && armed === "true", JSON.stringify({ writes: count(), armed }));
			await singleClick(p);
			check(`${name}: a fresh click after that (${key === " " ? "Space" : key}) confirms once`, count() === 1, JSON.stringify({ writes: count() }));
		}
		{
			const p = await openArm(fixture, sel);
			await b.key("Enter");
			await sleep(600);
			await mouse("mouseMoved", p);
			await mouse("mousePressed", p);
			await b.key("Tab");
			await b.key("Tab", { shift: true });
			await b.key("Enter");
			await sleep(650);
			await mouse("mouseReleased", p);
			await sleep(250);
			check(`${name}: a press begun under an arm focus then dropped does not confirm the next arm`, count() === 0, JSON.stringify({ writes: count() }));
		}
		{
			// A screen reader activates with a click and no key events; an
			// Enter whose keyup never arrived (focus left the window) must
			// not stop it confirming.
			await openArm(fixture, sel);
			await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
			await b.evaluate(`document.activeElement?.blur()`);
			await sleep(100);
			for (let i = 0; i < 2; i++) {
				await b.evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);
				await sleep(650);
			}
			check(`${name}: a screen reader's second activation confirms after a lost Enter keyup`, count() === 1, JSON.stringify({ writes: count() }));
		}
	}
	// Each pointer keeps its own start, and a click reads only the start of
	// the pointer that made it: a mouse held from before the arm does not
	// confirm after a touch began on the armed button (lifted or cancelled),
	// nor after a second mouse button, whose press sends no pointerup for
	// the first; the touch itself began armed and confirms once (external
	// review AX79, review of d18).
	const touch = (type, p) => b.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchStart" ? [{ x: p.x, y: p.y, id: 41 }] : [] });
	const buttons = (type, button, held, p) => b.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button, buttons: held, clickCount: 1 });
	for (const [name, fixture, sel, count] of armCases) {
		for (const second of ["touch", "cancelled touch", "right button"]) {
			const p = await openArm(fixture, sel);
			await mouse("mouseMoved", p);
			await buttons("mousePressed", "left", 1, p);
			await b.key("Enter");
			await sleep(650);
			if (second === "right button") {
				await buttons("mousePressed", "right", 3, p);
				await buttons("mouseReleased", "left", 2, p);
			} else {
				await touch("touchStart", p);
				if (second === "cancelled touch") await touch("touchCancel", p);
				await buttons("mouseReleased", "left", 0, p);
			}
			await sleep(250);
			const armed = await b.evaluate(`document.querySelector(${JSON.stringify(sel)})?.dataset.armed ?? null`);
			const after = second === "right button" ? "the right button was pressed too" : `a ${second} began on the armed button`;
			check(`${name}: a mouse held from before the arm does not confirm after ${after}`, count() === 0 && armed === "true", JSON.stringify({ writes: count(), armed }));
			if (second === "touch") {
				await touch("touchEnd", p);
				await sleep(300);
				check(`${name}: the touch that began on the armed button confirms once`, count() === 1, JSON.stringify({ writes: count() }));
				continue;
			}
			if (second === "right button") {
				await buttons("mouseReleased", "right", 0, p);
				await sleep(150);
			}
			await singleClick(p);
			check(`${name}: a fresh click after the ${second} confirms once`, count() === 1, JSON.stringify({ writes: count() }));
		}
	}
	// Elapsed time, not the wall clock, times the confirm window and the
	// scroll guard: a clock corrected an hour either way between two presses
	// neither confirms early nor refuses late (external review AX48).
	for (const [name, fixture, sel, count] of armCases) {
		for (const [jump, gap, confirms] of [[3600000, 100, false], [-3600000, 600, true]]) {
			await open(fixture);
			if (fixture === "key-configured") {
				await b.evaluate(`(() => { document.querySelectorAll("details").forEach((d) => { d.open = true; }); const t = document.getElementById("config-deck"); t.value = JSON.stringify({ theme: "paper" }); t.dispatchEvent(new Event("input", { bubbles: true })); })()`);
				await sleep(150);
			}
			await b.click(sel);
			await b.evaluate(`(() => { const real = Date.now; Date.now = () => real() + ${jump}; })()`);
			await sleep(gap);
			await b.click(sel);
			await sleep(250);
			check(`${name}: a clock set an hour ${jump > 0 ? "on" : "back"} between the presses ${confirms ? "still confirms 600 ms later" : "does not confirm 100 ms later"}`, count() === (confirms ? 1 : 0), JSON.stringify({ writes: count() }));
		}
	}
	{
		await open("key-configured");
		await b.evaluate(`(() => { const d = document.createElement("div"); d.style.cssText = "position:fixed;left:10px;top:10px;width:40px;height:40px;z-index:99999"; d.addEventListener("click", () => { window.__probeClicks++; }); document.body.appendChild(d); window.__realNow = Date.now; })()`);
		for (const [jump, gap, lands] of [[3600000, 100, false], [-3600000, 600, true]]) {
			await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 30, y: 30 });
			await b.evaluate(`(() => { window.__probeClicks = 0; const real = window.__realNow; hwShell.markPanelScroll(); Date.now = () => real() + ${jump}; })()`);
			await sleep(gap);
			for (const type of ["mousePressed", "mouseReleased"]) await b.send("Input.dispatchMouseEvent", { type, x: 30, y: 30, button: "left", clickCount: 1 });
			await sleep(100);
			const clicks = await b.evaluate("window.__probeClicks");
			check(`scroll guard: a clock set an hour ${jump > 0 ? "on does not cut the half second short (a still press 100 ms later is swallowed)" : "back does not stretch the half second (a still press 600 ms later lands)"}`, clicks === (lands ? 1 : 0), JSON.stringify({ clicks }));
		}
	}
	// An arm names the whole stored group or set: a changed reading list
	// whose keys join to the same text, or a rename alone, disarms, and the
	// next press only arms for what is there now (external review AX30).
	const collide = [
		["group Remove, reading list", "#rotation-set .hw-group-remove", [{ name: "Old", keys: ["a|b"] }, { name: "Two", keys: ["z"] }], [{ name: "Old", keys: ["a", "b"] }, { name: "Two", keys: ["z"] }]],
		["group Remove, rename", "#rotation-set .hw-group-remove", [{ name: "Old", keys: ["a"] }, { name: "Two", keys: ["z"] }], [{ name: "New", keys: ["a"] }, { name: "Two", keys: ["z"] }]],
		["Merge, reading list", '#rotation-set [data-set-action="merge"]', [{ name: "A", keys: ["x|y"] }, { name: "B", keys: ["z"] }], [{ name: "A", keys: ["x", "y"] }, { name: "B", keys: ["z"] }]]
	];
	for (const [what, sel, before, after] of collide) {
		const doc = (groups) => ({ readingKey: "z", controlPreset: "elite", rotationKeys: groups.flatMap((g) => g.keys), rotationGroups: groups });
		await open("dial-groups", { settings: doc(before) });
		await b.evaluate(`document.querySelectorAll("details").forEach((d) => { d.open = true; })`);
		await b.click(sel);
		await sleep(550);
		sim.pushSettings(doc(after));
		await sleep(250);
		const armedAfterDelivery = await b.evaluate(`document.querySelector(${JSON.stringify(sel)})?.dataset.armed ?? null`);
		await b.click(sel);
		await sleep(250);
		const armedAfterPress = await b.evaluate(`document.querySelector(${JSON.stringify(sel)})?.dataset.armed ?? null`);
		check(`${what}: a changed group drops the arm, and the next press only arms`, armedAfterDelivery !== "true" && armedAfterPress === "true" && sim.writes.length === 0, JSON.stringify({ armedAfterDelivery, armedAfterPress, ...writes() }));
	}
	// The same group delivered with its keys in another order is no change:
	// the arm stays and the next press confirms.
	{
		const groups = [{ name: "Old", keys: ["a"] }, { name: "Two", keys: ["z"] }];
		const doc = (g) => ({ readingKey: "z", controlPreset: "elite", rotationKeys: ["a", "z"], rotationGroups: g });
		await open("dial-groups", { settings: doc(groups) });
		await b.evaluate(`document.querySelectorAll("details").forEach((d) => { d.open = true; })`);
		await b.click("#rotation-set .hw-group-remove");
		await sleep(550);
		sim.pushSettings(doc(groups.map((g) => ({ keys: g.keys, name: g.name }))));
		await sleep(250);
		const kept = await b.evaluate(`document.querySelector("#rotation-set .hw-group-remove")?.dataset.armed ?? null`);
		check("group Remove: the same group delivered with its keys reordered keeps the arm", kept === "true" && sim.writes.length === 0, JSON.stringify({ kept, ...writes() }));
	}
	// The shared Apply arm names one document: a well whose text changed
	// since the arm, even without typing, is a new first press.
	await open("key-configured");
	await b.evaluate(`(() => { document.querySelectorAll("details").forEach((d) => { d.open = true; }); const t = document.getElementById("config-deck"); t.value = JSON.stringify({ theme: "paper" }); t.dispatchEvent(new Event("input", { bubbles: true })); })()`);
	await sleep(150);
	await b.click("#config-deck-apply");
	await sleep(550);
	await b.evaluate(`document.getElementById("config-deck").value = JSON.stringify({ theme: "ember" })`);
	await b.click("#config-deck-apply");
	await sleep(250);
	check("Replace shared settings: a document changed since the arm only arms again", sim.globalWrites.length === 0 && (await b.evaluate(`document.getElementById("config-deck-apply").dataset.armed`)) === "true", JSON.stringify(writes()));

	// A queued Elite-to-Custom seed belongs to the document the person
	// picked Custom in: a newer document arriving first gets no Elite
	// fields (external review AX34).
	await open("dial-groups");
	await b.evaluate(`(() => {
		window.__seeds = [];
		const real = window.setTimeout;
		window.__realSetTimeout = real;
		window.setTimeout = (fn, ms, ...args) => (ms === 0 && (fn.name === "seedFromElite" || String(fn).includes("seedFromElite")) ? (window.__seeds.push(fn), 0) : real(fn, ms, ...args));
		const s = document.getElementById("f-preset");
		s.value = "custom";
		s.dispatchEvent(new Event("change", { bubbles: true }));
	})()`);
	await sleep(150);
	const newer = { readingKey: sim.settings.readingKey, controlPreset: "legacy", future: { keep: "newer document" } };
	sim.pushSettings(newer);
	await sleep(250);
	const beforeSeed = sim.writes.length;
	const queued = await b.evaluate(`(() => { window.setTimeout = window.__realSetTimeout; for (const fn of window.__seeds) fn(); return window.__seeds.length; })()`);
	await sleep(400);
	check("preset: a seed queued before a newer document arrived writes nothing into it", queued === 1 && sim.writes.length === beforeSeed && !("gestureShortPress" in sim.settings), JSON.stringify({ queued, seeds: sim.writes.length - beforeSeed, settings: sim.settings }));

	// A stored key spelled like a JavaScript built-in still gets its own
	// name and color entries (external review AX35).
	await open("dial-configured", { settings: { readingKey: "__proto__", rotationKeys: ["__proto__", "a"] } });
	await b.evaluate(`(() => { document.querySelectorAll("details").forEach((d) => { d.open = true; }); document.querySelector("#rotation-set [role=option]").click(); document.querySelector('#rotation-set [data-tool="rename"]').click(); })()`);
	await sleep(150);
	await b.evaluate(`(() => { const i = document.querySelector(".hw-chip-rename"); i.value = "My reading"; i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
	await sleep(300);
	const protoName = lastWrite()?.rotationNames;
	await b.evaluate(`(() => { const c = document.getElementById("reading-color-0"); c.value = "#123456"; c.dispatchEvent(new Event("change", { bubbles: true })); })()`);
	await sleep(300);
	const protoColor = lastWrite()?.readingColors;
	check("a reading stored as __proto__ keeps its own name and color", protoName !== undefined && Object.hasOwn(protoName, "__proto__") && protoName.__proto__ === "My reading" && protoColor !== undefined && Object.hasOwn(protoColor, "__proto__") && protoColor.__proto__ === "#123456", JSON.stringify({ protoName, protoColor, ...writes() }));

	// Auto cycle is described exactly as the dial runs it (AX31): a string
	// or number interval runs; a boolean or list is off.
	for (const [raw, runs] of [["5000", true], [5000, true], [true, false], [[5000], false]]) {
		await open("dial-configured", { settings: { ...sim.fixtures["dial-configured"].settings, controlPreset: "elite", autoCycleMs: raw } });
		const said = await b.evaluate(`document.querySelector('[data-summary="interaction"]')?.textContent ?? ""`);
		check(`auto cycle ${JSON.stringify(raw)}: the summary says ${runs ? "it runs" : "nothing about it"}`, said.includes("auto cycle 5 s") === runs, said);
		const moves = await b.evaluate(`document.getElementById("picker-moves")?.textContent ?? ""`);
		const now = await b.evaluate(`document.getElementById("controls-now")?.textContent ?? ""`);
		check(`auto cycle ${JSON.stringify(raw)}: the moves line and the controls list agree`, moves.includes("auto cycle") === runs && now.includes("(auto cycle is off)") === !runs, JSON.stringify({ moves, now }));
	}

	// Elite to Custom seeds the Elite map on the person's pick and shows it
	// at once; an echo carrying the same switch writes nothing.
	await open("dial-groups");
	await b.evaluate(`(() => { const s = document.getElementById("f-preset"); s.value = "custom"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
	await sleep(400);
	const seeded = await b.evaluate(`({ pressed: document.getElementById("g-pressed-rotate").value, short: document.getElementById("g-short").value })`);
	check("preset: picking Custom from Elite seeds the Elite map and shows it", sim.settings.gesturePressedRotate === "stepGroup" && sim.settings.gestureShortPress === "pauseResume" && seeded.pressed === "stepGroup" && seeded.short === "pauseResume", JSON.stringify({ seeded, stored: [sim.settings.gesturePressedRotate, sim.settings.gestureShortPress] }));
	// The same pick through real key input (CDP key events, not a synthetic
	// change): a browser-dispatched change runs microtasks between listeners,
	// which is where the seed once reset the select to Elite before the pick
	// was saved (round 3, R01).
	const presetByKeys = async (fixture, keys) => {
		await open(fixture);
		await b.evaluate(`(() => { document.getElementById("sec-interaction").open = true; document.getElementById("f-preset").focus(); })()`);
		await sleep(150);
		for (const key of keys) {
			await b.key(key);
			await sleep(300);
		}
		await sleep(300);
		return b.evaluate(`({ shown: document.getElementById("f-preset").value, customRows: !document.getElementById("controls-custom").hidden, pressed: document.getElementById("g-pressed-rotate").value })`);
	};
	let keyed = await presetByKeys("dial-groups", ["ArrowDown"]);
	check("preset: Custom picked from Elite by keyboard is saved and shown, with the Elite map seeded", sim.settings.controlPreset === "custom" && keyed.shown === "custom" && keyed.customRows && sim.settings.gesturePressedRotate === "stepGroup" && keyed.pressed === "stepGroup", JSON.stringify({ keyed, stored: sim.settings.controlPreset }));
	check("preset: every write after the pick carries Custom", sim.writes.length >= 2 && sim.writes.every((wr) => wr.controlPreset === "custom"), JSON.stringify(sim.writes.map((wr) => wr.controlPreset)));
	keyed = await presetByKeys("dial-custom-gestures", ["ArrowUp", "ArrowDown"]);
	check("preset: Custom, Elite, Custom by keyboard ends on Custom and keeps a gesture the person set", sim.settings.controlPreset === "custom" && keyed.shown === "custom" && sim.settings.gestureTap === "pin", JSON.stringify({ keyed, stored: sim.settings.controlPreset, tap: sim.settings.gestureTap }));
	await open("dial-groups");
	sim.settings = { ...sim.settings, controlPreset: "custom" };
	sim.piWs.send(JSON.stringify({ event: "didReceiveSettings", action: "com.lawrensen.hwinfo.dial", context: sim.context, device: "dev1", payload: { settings: sim.settings } }));
	await sleep(400);
	noWrites("preset: an echo switching Elite to Custom");

	// Layout switches never touch hidden slot settings.
	await open("key-dense");
	const denseBefore = structuredClone(sim.settings);
	for (const layout of ["single", "dual", "triple", "quad"]) {
		await b.evaluate(`(() => { const s = document.getElementById("f-layout"); s.value = "${layout}"; s.dispatchEvent(new Event("change")); })()`);
		await sleep(150);
	}
	w = lastWrite();
	check("lossless: four layout switches kept every slot, label and color", same({ ...w, keyLayout: denseBefore.keyLayout }, denseBefore), JSON.stringify(changedKeys(denseBefore, w ?? {})));

	// ---- races: late preview, echoes, shared changes -----------------------
	await open("key-configured");
	await open("key-custom-dim");
	await b.evaluate(`window.__faceBefore = document.getElementById("face-img").dataset.face ?? ""`);
	// A late preview built for the PREVIOUS context arrives after the switch.
	sim.piWs.send(JSON.stringify({ event: "sendToPropertyInspector", action: "com.lawrensen.hwinfo.reading", context: sim.context, payload: { event: "preview", context: "ctx-key-configured", kind: "key", state: "ok", hint: "", missing: false, face: "<svg xmlns='http://www.w3.org/2000/svg'><text>A</text></svg>", reading: { label: "Wrong", source: "A", unit: "°C" } } }));
	await sleep(300);
	check("race: a late preview for another context is ignored", (await b.evaluate(`document.getElementById("head-reading").textContent`)) !== "Wrong" && (await b.evaluate(`(document.getElementById("face-img").dataset.face ?? "") === window.__faceBefore`)));
	// Typing while echoes and ticks arrive: text, caret, focus, scroll hold.
	await b.evaluate(`(() => { const i = document.getElementById("f-label"); i.focus(); i.value = "Graphics"; i.setSelectionRange(3, 3); window.scrollTo(0, 120); window.__scroll = window.scrollY; })()`);
	sim.settings = { ...sim.settings, statMode: "max" }; // a plugin-owned write (a key press cycled the stat)
	sim.piWs.send(JSON.stringify({ event: "didReceiveSettings", action: "com.lawrensen.hwinfo.reading", context: sim.context, device: "dev1", payload: { settings: sim.settings } }));
	for (let i = 0; i < 4; i++) {
		sim.pushPreview();
		await sleep(60);
	}
	const caret = await b.evaluate(`(() => { const i = document.getElementById("f-label"); return { value: i.value, start: i.selectionStart, focused: document.activeElement === i, scrolled: window.scrollY === window.__scroll }; })()`);
	check("race: echo and ticks kept the typed text", caret.value === "Graphics", caret.value);
	check("race: the caret did not move", caret.start === 3, String(caret.start));
	check("race: focus and scroll held", caret.focused && caret.scrolled, JSON.stringify(caret));
	await b.evaluate(`(() => { const i = document.getElementById("f-label"); i.dispatchEvent(new Event("input")); i.dispatchEvent(new Event("change")); })()`);
	await sleep(300);
	w = lastWrite();
	check("race: the edit merged onto the echoed document (both changes kept)", w?.label === "Graphics" && w?.statMode === "max" && same(w?.futureBlob, FUTURE_BLOB), JSON.stringify({ label: w?.label, statMode: w?.statMode }));
	// A shared change made in another panel arrives: labels follow, no write.
	const before = writes();
	sim.globals = { ...sim.globals, textMode: "dim" };
	sim.piWs.send(JSON.stringify({ event: "didReceiveGlobalSettings", payload: { settings: sim.globals } }));
	await sleep(300);
	check("race: a shared change from elsewhere is shown", (await b.evaluate(`document.querySelector('#f-text option[value=""]').textContent`)).includes("Dimmed"));
	check("race: and writes nothing", same(writes(), before), JSON.stringify(writes()));

	// ---- keyboard: combobox, rotation reorder, IME ---------------------------
	await open("key-empty");
	const bandOf = () => b.evaluate(`({ current: document.getElementById("theme-current").textContent, help: document.getElementById("theme-help").textContent, readingTop: Math.round(document.getElementById("sec-reading").getBoundingClientRect().top + scrollY) })`);
	const emptyBand = await bandOf();
	check("theme band: a key with no reading says when its theme will show", emptyBand.current === "Default (shared: Void)" && emptyBand.help === "Shows on the key once a reading is picked.", JSON.stringify(emptyBand));
	await b.evaluate(`document.getElementById("picker-search").focus()`);
	await sleep(100);
	await b.type("drive temp");
	await sleep(150);
	const drives = await b.evaluate(`Array.from(document.querySelectorAll("#picker-list [role=option]:not([hidden])")).map((o) => o.closest("[role=group]")?.querySelector(".hw-group")?.textContent + " / " + o.querySelector(".hw-label").textContent)`);
	check("T1: two same-named readings are told apart by source", drives.length >= 2 && new Set(drives).size === drives.length && drives.every((d) => d.includes("Drive")), JSON.stringify(drives));
	await b.key("ArrowDown");
	await b.key("ArrowDown");
	await sleep(80);
	const inspect = await b.evaluate(`({ active: document.getElementById("picker-search").getAttribute("aria-activedescendant"), expanded: document.getElementById("picker-search").getAttribute("aria-expanded") })`);
	check("keyboard: arrows move the highlight (aria-activedescendant) and commit nothing", inspect.active !== null && inspect.expanded === "true" && sim.writes.length === 0, JSON.stringify(inspect));
	await b.key("Escape");
	await sleep(80);
	check("keyboard: Escape closes, restores the box, keeps focus, commits nothing", (await b.evaluate(`document.getElementById("picker-list").hidden && document.getElementById("picker-search").value === "" && document.activeElement.id === "picker-search"`)) && sim.writes.length === 0);
	await b.type("drive temp");
	await b.key("ArrowDown");
	await b.key("ArrowDown");
	const chosen = await b.evaluate(`document.getElementById(document.getElementById("picker-search").getAttribute("aria-activedescendant")).dataset.key`);
	await b.key("Enter");
	await sleep(200);
	check("keyboard: Enter commits exactly the highlighted reading", typeof chosen === "string" && lastWrite()?.readingKey === chosen && sim.writes.length === 1, JSON.stringify({ wrote: lastWrite()?.readingKey, chosen }));
	const pickedBand = await bandOf();
	check("theme band: the first reading picked clears that help line but keeps its slot, so the picker does not move", pickedBand.help === "" && pickedBand.readingTop === emptyBand.readingTop, JSON.stringify({ emptyBand, pickedBand }));

	// ---- one outlined row: the highlight never stays behind ----------------
	// Bench 2026-09-30: a cycling dial's list showed five outlined rows, one
	// left behind by every close after the saved reading had moved.
	const marks = () => b.evaluate(`({ active: Array.from(document.querySelectorAll("#picker-list .hw-row.active"), (r) => r.dataset.key), selected: Array.from(document.querySelectorAll("#picker-list .hw-row.selected"), (r) => r.dataset.key) })`);
	const oneMark = (m, key) => m.active.length === 1 && m.selected.length === 1 && m.active[0] === m.selected[0] && (key === undefined || m.active[0] === key);
	await open("dial-configured");
	await b.click("#picker-search");
	await sleep(150);
	await b.key("ArrowDown");
	await b.key("ArrowDown");
	await b.click("#picker-search"); // the second click closes, nothing chosen
	await sleep(150);
	await b.click("#picker-search");
	await sleep(150);
	let seen = await marks();
	check("highlight: an outline moved and then closed does not stay on the next open", oneMark(seen), JSON.stringify(seen));
	const turnedTo = await b.evaluate(`Array.from(document.querySelectorAll("#picker-list .hw-row:not(.selected)"), (r) => r.dataset.key)[3]`);
	sim.settings = { ...sim.settings, readingKey: turnedTo };
	sim.piWs.send(JSON.stringify({ event: "didReceiveSettings", action: "com.lawrensen.hwinfo.dial", context: sim.context, device: "dev1", payload: { settings: sim.settings } }));
	await sleep(300);
	seen = await marks();
	check("highlight: a dial turn while the list is open moves the outline with the saved reading", oneMark(seen, turnedTo), JSON.stringify({ seen, turnedTo }));
	noWrites("highlight: browsing and a dial turn's echo");
	await b.key("ArrowDown");
	await b.key("Enter");
	await sleep(200);
	const enteredKey = lastWrite()?.readingKey;
	await b.click("#picker-search");
	await sleep(150);
	seen = await marks();
	check("highlight: after a pick, the reopened list outlines only the new reading", sim.writes.length === 1 && typeof enteredKey === "string" && enteredKey !== turnedTo && oneMark(seen, enteredKey), JSON.stringify({ seen, enteredKey, writes: sim.writes.length }));

	// ---- pointer dismissal: the app keeps Escape and most of its clicks -----
	// Stream Deck 7.4.2 never delivers Escape to a panel, and a click on its
	// own controls (the disabled Title field, the grey surround) reaches the
	// page as nothing at all (bench 2026-09-23). So the box toggles, focus
	// loss closes, and the pointer leaving the panel closes a browsing list.
	await open("key-configured");
	const listHidden = () => b.evaluate(`document.getElementById("picker-list").hidden`);
	const saved = await b.evaluate(`document.getElementById("picker-search").value`);
	await b.click("#picker-search");
	await sleep(150);
	const opened = !(await listHidden());
	const selectedAll = await b.evaluate(`(() => { const i = document.getElementById("picker-search"); return i.value !== "" && i.selectionStart === 0 && i.selectionEnd === i.value.length; })()`);
	check("pointer: a click opens the list with the whole name selected, so typing replaces it", opened && selectedAll, JSON.stringify({ opened, selectedAll }));
	await b.click("#picker-search");
	await sleep(150);
	check("pointer: a second click on the box closes it and puts the saved reading back", (await listHidden()) && (await b.evaluate(`document.getElementById("picker-search").value`)) === saved);
	await b.click("#picker-search");
	await sleep(150);
	await b.evaluate(`window.dispatchEvent(new Event("blur"))`);
	await sleep(100);
	check("pointer: the panel losing focus closes the list and lets go of the box", (await listHidden()) && (await b.evaluate(`document.activeElement.id !== "picker-search"`)));
	await b.click("#picker-search");
	await sleep(150);
	await b.evaluate(`document.documentElement.dispatchEvent(new MouseEvent("mouseleave"))`);
	await sleep(1200);
	check("pointer: leaving the panel never closes a browsing list on its own", !(await listHidden()));
	await b.click("#hw-head");
	await sleep(150);
	check("pointer: a click anywhere else in the panel closes it and puts the saved reading back", (await listHidden()) && (await b.evaluate(`document.getElementById("picker-search").value`)) === saved);
	await b.click("#picker-search");
	await sleep(150);
	await b.type("drive");
	await b.evaluate(`document.documentElement.dispatchEvent(new MouseEvent("mouseleave"))`);
	await sleep(500);
	check("pointer: a typed search stays open when the pointer leaves", !(await listHidden()) && (await b.evaluate(`document.getElementById("picker-search").value`)) === "drive");
	check("pointer: none of it wrote", sim.writes.length === 0 && sim.globalWrites.length === 0, JSON.stringify(writes()));
	// A save from pagehide never lands in the app (bench: 20 of 20 lost), so
	// text still inside its 200 ms debounce is saved as the pointer leaves.
	await b.evaluate(`(() => { const e = document.getElementById("f-label"); e.focus(); e.select(); })()`);
	await b.type("Leaving");
	await b.evaluate(`document.documentElement.dispatchEvent(new MouseEvent("mouseleave"))`);
	await sleep(40); // well inside the 200 ms debounce
	check("pointer: text typed just before the pointer leaves is saved at once, to this action", lastWrite()?.label === "Leaving" && sim.writes.length === 1, JSON.stringify({ writes: sim.writes.length, label: lastWrite()?.label }));

	// ---- sections keep the folds a person chose (per kind, zero writes) ----
	// The real app gives every panel fresh web storage, so the folds live in
	// the plugin's memory; a fresh sim memory is a freshly started plugin.
	sim.folds = new PanelFoldMemory();
	await open("key-configured");
	const foldsOf = () => b.evaluate(`Object.fromEntries(Array.from(document.querySelectorAll("details.hw-sec[id]"), (d) => [d.id, d.open]))`);
	const defaults = await foldsOf();
	await b.click("#sec-alerts > summary");
	await sleep(120);
	await open("key-configured");
	const kept = await foldsOf();
	check("folds: a section a person opened stays open on the next panel", kept["sec-alerts"] === true && defaults["sec-alerts"] === false && kept["sec-reading"] === defaults["sec-reading"], JSON.stringify({ defaults, kept }));
	// A toggle goes to the plugin's memory, never to settings, and the
	// panel keeps nothing in web storage. The pause lets the first toggle
	// event fire: two clicks inside one task coalesce into a single event.
	await b.click("#sec-alerts > summary");
	await sleep(60);
	await b.click("#sec-alerts > summary");
	await sleep(120);
	const foldTraffic = sim.piMessages.filter((m) => m.payload?.event === "setPanelFolds");
	const webStorage = await b.evaluate(`Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter((k) => /fold/i.test(k))`);
	check("folds: a toggle reaches the plugin's memory, not settings or web storage", foldTraffic.length === 2 && foldTraffic.at(-1).payload.folds["sec-alerts"] === true && same(sim.folds.get("key"), { "sec-alerts": true }) && sim.writes.length === 0 && webStorage.length === 0, JSON.stringify({ sent: foldTraffic.length, plugin: sim.folds.get("key"), webStorage }));
	// Until the plugin answers (at most 600 ms; about 320 ms measured in the
	// app, 2026-09-26) the sections stay hidden, so a restored fold never
	// moves a drawn panel; a silent plugin still gets the defaults shown.
	sim.replyDelayMs = 1500;
	sim.setFixture("key-configured");
	await b.goto(sim.url("key-configured"));
	const waiting = await b.evaluate(`getComputedStyle(document.getElementById("sec-reading")).visibility`);
	await sleep(800);
	const shown = await b.evaluate(`getComputedStyle(document.getElementById("sec-reading")).visibility`);
	await sleep(1300);
	const late = (await foldsOf())["sec-alerts"];
	sim.replyDelayMs = 0;
	check("folds: sections wait for the plugin's answer, at most 600 ms", waiting === "hidden" && shown === "visible" && late === true, JSON.stringify({ waiting, shown, late }));
	// An answer at the app's measured pace (about 350 ms) lands before the
	// sections show: they appear already folded, never open first.
	sim.foldsDelayMs = 350;
	sim.setFixture("key-configured");
	await b.goto(sim.url("key-configured"));
	let firstShown = null;
	for (let i = 0; i < 80 && firstShown === null; i++) {
		firstShown = await b.evaluate(`document.documentElement.hasAttribute("data-folds-pending") ? null : document.getElementById("sec-alerts").open`);
		if (firstShown === null) await sleep(10);
	}
	sim.foldsDelayMs = 0;
	const restoredBeforeShow = firstShown === true && (await b.evaluate(`performance.getEntriesByType("mark").some((m) => m.name === "hw-folds-answer")`));
	const foldEvidence = { firstShown };
	if (!restoredBeforeShow) {
		try {
			foldEvidence.page = await b.evaluate(`({ now: performance.now(), readyState: document.readyState, pending: document.documentElement.hasAttribute("data-folds-pending"), open: document.getElementById("sec-alerts").open, marks: performance.getEntriesByType("mark").filter((m) => m.name === "hw-connected" || m.name.startsWith("hw-folds-")).map((m) => ({ name: m.name, at: m.startTime })) })`);
		} catch (error) {
			foldEvidence.diagnosticsError = error.message;
		}
		foldEvidence.responses = sim.toPiLog.filter((p) => p.event === "panelFolds").slice(-3);
	}
	check("folds: an answer at the app's measured pace is applied before the sections first show", restoredBeforeShow, JSON.stringify(foldEvidence));
	await open("dial-configured");
	await sleep(120);
	check("folds: each kind of panel keeps its own", (await foldsOf())["sec-alerts"] === false);
	await open("key-configured");
	await b.evaluate(`document.getElementById("sec-advanced").open = true`); // a script, not a person
	await sleep(120);
	await open("key-configured");
	check("folds: a section opened by script is not remembered", (await foldsOf())["sec-advanced"] === false);
	const altClick = async (sel) => {
		const p = await b.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2]; })()`);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await b.send("Input.dispatchMouseEvent", { type, x: p[0], y: p[1], button: "left", clickCount: 1, modifiers: 1 });
	};
	await altClick("#sec-alerts > summary"); // open: Alt folds every section
	await sleep(120);
	const allFolded = Object.values(await foldsOf()).every((o) => o === false);
	await altClick("#sec-reading > summary"); // folded: Alt opens every section
	await sleep(120);
	await open("key-configured");
	const allOpen = Object.values(await foldsOf()).every((o) => o === true);
	check("folds: Alt-click on a section title folds or opens them all, and that is kept too", allFolded && allOpen, JSON.stringify({ allFolded, allOpen }));
	// The header's pair does what Alt-click does, for people who never find
	// Alt-click: one toolbar, one Tab stop, remembered like any toggle.
	const bar = () =>
		b.evaluate(`({ open: document.querySelector('#hw-folds [data-folds="open"]').getAttribute("aria-disabled"), fold: document.querySelector('#hw-folds [data-folds="fold"]').getAttribute("aria-disabled"), focus: document.activeElement?.dataset?.folds ?? null, said: [...document.querySelectorAll('body > .hw-sr-only[role="status"]')].pop()?.textContent ?? "", tabs: [...document.querySelectorAll("#hw-folds button")].map((x) => x.tabIndex) })`);
	await b.click('#hw-folds [data-folds="fold"]');
	await sleep(120);
	const folded = await foldsOf();
	const barFolded = await bar();
	check("folds: Fold all in the header folds every section, dims itself and says so", Object.values(folded).every((o) => o === false) && barFolded.fold === "true" && barFolded.open === "false" && barFolded.said.startsWith("All sections folded"), JSON.stringify({ folded, barFolded }));
	await open("key-configured");
	const foldedKept = await foldsOf();
	check("folds: the header's Fold all is remembered on the next panel", Object.values(foldedKept).every((o) => o === false), JSON.stringify(foldedKept));
	const tabsAtRest = (await bar()).tabs;
	await b.evaluate(`document.querySelector('#hw-folds [data-folds="open"]').focus()`);
	await b.key("ArrowRight");
	const moved = (await bar()).focus;
	await b.key("ArrowLeft");
	await b.key("Enter");
	await sleep(120);
	const openedAll = await foldsOf();
	const barOpened = await bar();
	check("folds: the pair is one Tab stop, arrow keys move between them, Enter on Open all opens every section", same(tabsAtRest, [0, -1]) && moved === "fold" && Object.values(openedAll).every((o) => o === true) && barOpened.focus === "open" && barOpened.open === "true" && barOpened.said.startsWith("All sections open"), JSON.stringify({ tabsAtRest, moved, openedAll, barOpened }));
	await b.click('#hw-folds [data-folds="open"]');
	await sleep(120);
	check("folds: a dimmed button changes nothing", Object.values(await foldsOf()).every((o) => o === true));
	check("folds: none of it wrote a setting", sim.writes.length === 0 && sim.globalWrites.length === 0, JSON.stringify(writes()));
	// The palette folds like every section (owner, 2026-09-26, design R2;
	// it never folded before). Fold all folds it too, and its row keeps the
	// checked theme as a chip in its own colors with where it comes from,
	// on the first screen. Opened alone, with every other section folded,
	// the chips are on the first screen of the app's 410 px panel, named,
	// and one click picks a theme.
	for (const fixture of ["key-configured", "dial-configured"]) {
		await open(fixture);
		await b.click('#hw-folds [data-folds="fold"]');
		await sleep(120);
		const foldedRow = await b.evaluate(`(() => { const d = document.getElementById("sec-theme"); const face = document.querySelector("#theme-mini .hw-theme-face"); const r = d.getBoundingClientRect(); return { open: d.open, face: face !== null && face.getClientRects().length > 0 ? face.querySelector(".hw-theme-value").textContent : null, mark: face !== null && face.querySelector(".hw-theme-badge") !== null, scope: document.querySelector("#theme-current .hw-look-scope")?.textContent ?? null, bottom: Math.round(r.bottom + scrollY) }; })()`);
		check(`palette (${fixture}): Fold all folds the band too; its row keeps the checked theme as a chip (Default with its link mark) and where it comes from, on the first screen`, foldedRow.open === false && foldedRow.face === "Default" && foldedRow.mark && foldedRow.scope === " (shared: Void)" && foldedRow.bottom <= 410, JSON.stringify(foldedRow));
		await b.click("#sec-theme > summary");
		await sleep(150);
		const band = await b.evaluate(`(() => { const g = document.getElementById("theme-gallery"); const r = g.getBoundingClientRect(); let folded = false; for (let n = g.parentElement; n; n = n.parentElement) if (n.tagName === "DETAILS" && !n.open) folded = true; return { folded, bottom: Math.round(r.bottom + scrollY), swatches: g.querySelectorAll(".hw-theme").length, named: [...g.querySelectorAll(".hw-theme")].every((c) => (c.getAttribute("aria-label") ?? "").length > 0), current: document.getElementById("theme-current").textContent, help: document.getElementById("theme-help").textContent, helpShown: document.getElementById("theme-help").getClientRects().length > 0, change: (() => { const c = document.getElementById("theme-change"); const r = c.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { label: c.getAttribute("aria-label"), reveal: c.dataset.reveal, visible: getComputedStyle(c).visibility === "visible" && r.width > 0, h: Math.round(r.height), inLine: !document.getElementById("theme-current").contains(c), hit: hit === c }; })(), described: document.getElementById("theme-gallery").getAttribute("aria-describedby").split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim(), chipsTop: Math.round(r.top + scrollY) }; })()`);
		check(`palette (${fixture}): opened alone, with every other section folded, all eight chips are in view under the header, each named`, !band.folded && band.bottom <= 410 && band.swatches === 8 && band.named, JSON.stringify(band));
		// Round 3, R38: one line in the Text select's idiom names what is drawn
		// and where it comes from; Change sits after it, outside its ellipsis,
		// and the help line under the chips is gone on a configured panel
		// (it stays for an empty key and an unknown stored value, below).
		const where = fixture.startsWith("dial") ? "dial" : "key";
		check(`palette (${fixture}): the line says "Default (shared: Void)" with Change after it, whole and hittable, and no help line`, band.current === "Default (shared: Void)" && band.change.label === "Change the shared theme" && band.change.reveal === "shared-theme" && band.change.visible && band.change.inLine && band.change.hit && band.change.h >= 17 && band.help === "" && !band.helpShown && band.described === "Follows the shared theme, now Void.", JSON.stringify(band));
		// Every theme is known without hovering: each chip writes its name on
		// its face, whole, and Default leads with its link mark.
		const faces = await b.evaluate(`[...document.querySelectorAll("#theme-gallery .hw-theme")].map((c) => { const v = c.querySelector(".hw-theme-value"); const badge = c.querySelector(".hw-theme-badge"); return { text: v?.textContent ?? "", whole: v !== null && v.getClientRects().length > 0 && v.scrollWidth <= v.clientWidth + 0.5, markFirst: badge === null ? null : badge.getBoundingClientRect().right <= v.getBoundingClientRect().left + 0.5 }; })`);
		check(`palette (${fixture}): every chip shows its theme's name, whole, and Default leads with its link mark`, same(faces.map((f) => f.text), ["Default", "Void", "Graphite", "Ultraviolet", "Midnight", "Forest", "Ember", "Paper"]) && faces.every((f) => f.whole) && faces[0].markFirst === true && faces.slice(1).every((f) => f.markFirst === null), JSON.stringify(faces));
		// The line names what is drawn, not what the pointer or focus is on
		// (round 3, R04: every chip names itself; the line is the one place
		// Default's resolved theme is named). Browsing writes nothing.
		const browsed = [];
		for (const theme of ["graphite", "paper", "ember"]) {
			await b.hover(`#theme-gallery .hw-theme[data-theme="${theme}"]`);
			await sleep(60);
			browsed.push(await b.evaluate(`document.getElementById("theme-current").textContent`));
		}
		await b.evaluate(`document.querySelector('#theme-gallery .hw-theme[data-theme="graphite"]').focus()`);
		await sleep(80);
		browsed.push(await b.evaluate(`document.getElementById("theme-current").textContent`));
		check(`palette (${fixture}): pointing at or focusing other chips leaves the line on what is drawn, and writes nothing`, browsed.every((line) => line === "Default (shared: Void)") && sim.writes.length === 0, JSON.stringify({ browsed, ...writes() }));
		await b.click('#theme-gallery .hw-theme[data-theme="forest"]');
		await sleep(200);
		check(`palette (${fixture}): one click picks a theme with the sections folded, writing only the theme`, lastWrite()?.theme === "forest" && sim.writes.length === 1 && sim.globalWrites.length === 0, JSON.stringify({ wrote: lastWrite()?.theme, ...writes() }));
		const picked = await b.evaluate(`(() => { const g = document.getElementById("theme-gallery"); const c = document.getElementById("theme-change"); return { current: document.getElementById("theme-current").textContent, changeShown: getComputedStyle(c).visibility === "visible", changeFocusable: (() => { c.focus(); return document.activeElement === c; })(), chipsTop: Math.round(g.getBoundingClientRect().top + scrollY), described: g.getAttribute("aria-describedby").split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim() }; })()`);
		check(`palette (${fixture}): an explicit pick reads "Forest (set on this ${where})", Change holds its place unseen and unfocusable, and the chips do not move`, picked.current === `Forest (set on this ${where})` && !picked.changeShown && !picked.changeFocusable && picked.chipsTop === band.chipsTop && picked.described === `Set on this ${where}; kept when the shared theme changes.`, JSON.stringify({ picked, before: band.chipsTop }));
		await b.click('#hw-folds [data-folds="open"]');
		await sleep(120);
	}
	sim.folds = new PanelFoldMemory();
	await open("control-default");
	const controlBar = await b.evaluate(`(() => { const el = document.getElementById("hw-folds"); return el !== null && !el.hidden && el.getBoundingClientRect().width > 0; })()`);
	await open("slot-reading");
	const slotBar = await b.evaluate(`document.getElementById("hw-folds") === null`);
	check("folds: the Control panel has the pair; the detail tile, which has no sections, has none", controlBar && slotBar, JSON.stringify({ controlBar, slotBar }));
	sim.folds = new PanelFoldMemory();

	await open("dial-configured");
	// The rotation editor: the search comes before the list, each list is
	// one Tab stop, and one toolbar acts on the selected member.
	const route = await b.evaluate(`(() => {
		const all = [...document.querySelectorAll("#rotation-box input, #rotation-box button, #rotation-box [tabindex]")].filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0);
		return { order: all.map((el) => el.id || el.getAttribute("role") || el.dataset.tool || el.dataset.setAction), lists: document.querySelectorAll("#rotation-set [role=listbox]").length, buttonsInOptions: document.querySelectorAll('#rotation-set [role="option"] button, #rotation-set [role="option"] input').length };
	})()`);
	check("T5: the add search comes before the rotation list, which is one Tab stop, with one toolbar stop after it", route.order[0] === "pickerr-search" && route.order[1] === "listbox" && route.order[2] === "earlier" && route.lists === 1, JSON.stringify(route));
	check("T5: no control sits inside a listbox option", route.buttonsInOptions === 0, JSON.stringify(route));
	const selectedAtOpen = await b.evaluate(`document.querySelector('#rotation-set [role="option"][aria-selected="true"]')?.dataset.key ?? null`);
	check("T5: the editor opens with the reading on the dial selected, and selecting writes nothing", selectedAtOpen === sim.settings.readingKey && sim.writes.length === 0, JSON.stringify({ selectedAtOpen }));
	const orderBefore = [...sim.settings.rotationKeys];
	await b.evaluate(`document.querySelector('#rotation-set .hw-set-tools button[data-tool="later"]').focus()`);
	await b.key("Enter");
	await sleep(250);
	w = lastWrite();
	check("T5: Enter on Later reorders the rotation", same(w?.rotationKeys, [orderBefore[1], orderBefore[0], ...orderBefore.slice(2)]), JSON.stringify(w?.rotationKeys));
	const focusAfterMove = await b.evaluate(`(() => { const a = document.activeElement; return { tool: a.dataset.tool ?? null, selected: document.querySelector('#rotation-set [role="option"][aria-selected="true"]')?.dataset.key ?? null, pos: document.querySelector('#rotation-set [role="option"][aria-selected="true"]')?.getAttribute("aria-posinset") ?? null }; })()`);
	check("T5: focus stays on Later and the moved reading stays selected at its new place", focusAfterMove.tool === "later" && focusAfterMove.selected === orderBefore[0] && focusAfterMove.pos === "2", JSON.stringify(focusAfterMove));
	check("T5: the move is said once, with the new place", /, 2 of 3$/.test(await b.evaluate(`[...document.querySelectorAll('body > .hw-sr-only[role="status"]')].pop()?.textContent ?? ""`)));
	check("T5: moving never changed the reading on the dial", w?.readingKey === sim.settings.readingKey && w?.readingKey === orderBefore[0], JSON.stringify(w?.readingKey));
	const mark = await b.evaluate(`(() => { const c = document.querySelectorAll("#rotation-set .hw-set-chip.current"); return { current: c.length, chips: document.querySelectorAll("#rotation-set .hw-set-chip").length, badges: c[0]?.querySelectorAll(".hw-chip-badge").length ?? -1 }; })()`);
	check("T5: the reading on the dial is one highlighted member, with no badge", mark.current === 1 && mark.chips === 3 && mark.badges === 0, JSON.stringify(mark));
	// The owner's report (2026-10-10): the drawn badge widened the chip it sat
	// on, so the list rewrapped and the panel jumped each time the dial moved
	// on. Every member's size holds wherever the mark goes.
	const onDialBefore = sim.settings.readingKey;
	const sizes = [];
	for (const key of sim.settings.rotationKeys) {
		sim.pushSettings({ ...sim.settings, readingKey: key });
		await sleep(200);
		sizes.push(await b.evaluate(`({ at: document.querySelector("#rotation-set .hw-set-chip.current")?.dataset.key ?? null, boxes: [...document.querySelectorAll('#rotation-set [role="option"]')].map((o) => { const r = o.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(","); }).join(" ") })`));
	}
	sim.pushSettings({ ...sim.settings, readingKey: onDialBefore });
	await sleep(200);
	check("T5: the dial moving on moves the mark and never resizes or rewraps a member", sizes.every((s, i) => s.at === sim.settings.rotationKeys[i]) && new Set(sizes.map((s) => s.boxes)).size === 1, JSON.stringify(sizes));
	// High contrast drops the fill; a dashed frame marks the reading on the
	// dial. It keeps every member's box too, and on the member that is also
	// selected (the reading on the dial is, here) the Highlight ring sits
	// inside the frame rather than over it.
	await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
	const hcSizes = [];
	for (const key of sim.settings.rotationKeys) {
		sim.pushSettings({ ...sim.settings, readingKey: key });
		await sleep(200);
		hcSizes.push(await b.evaluate(`[...document.querySelectorAll('#rotation-set [role="option"]')].map((o) => { const r = o.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(","); }).join(" ")`));
	}
	sim.pushSettings({ ...sim.settings, readingKey: onDialBefore });
	await sleep(200);
	const hcBoth = await b.evaluate(`(() => { const c = document.querySelector('#rotation-set .hw-set-chip.current[aria-selected="true"]'); if (c === null) return null; const s = getComputedStyle(c); return { frame: s.borderTopStyle, border: parseFloat(s.borderTopWidth), ring: parseFloat(s.outlineWidth), offset: parseFloat(s.outlineOffset) }; })()`);
	await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "none" }] });
	check("T5: in high contrast the frame keeps every member's box, and the selection ring sits inside it", hcSizes.every((s) => s === sizes[0].boxes) && hcBoth !== null && hcBoth.frame === "dashed" && -hcBoth.offset >= hcBoth.border + hcBoth.ring, JSON.stringify({ hcSizes, plain: sizes[0].boxes, hcBoth }));
	// Keyboard inside the list: arrows select (no write), Alt+Arrow moves.
	const writesBeforeArrows = sim.writes.length;
	await b.evaluate(`document.querySelector("#rotation-set [role=listbox]").focus()`);
	await b.key("Home");
	await b.key("ArrowRight");
	await sleep(120);
	const arrowed = await b.evaluate(`document.querySelector('#rotation-set [role="option"][aria-selected="true"]')?.dataset.key ?? null`);
	check("T5: arrow keys select inside the list without writing", arrowed === orderBefore[0] && sim.writes.length === writesBeforeArrows, JSON.stringify({ arrowed, writes: sim.writes.length - writesBeforeArrows }));
	await b.key("ArrowUp", { alt: true });
	await sleep(250);
	check("T5: Alt+ArrowUp moves the selected reading earlier", same(lastWrite()?.rotationKeys, orderBefore), JSON.stringify(lastWrite()?.rotationKeys));
	// Remove from the toolbar: the neighbour is selected and focus stays put.
	await b.evaluate(`document.querySelector('#rotation-set [role="option"][data-key="${sim.keys.hot}"]').click()`);
	await b.evaluate(`document.querySelector('#rotation-set .hw-set-tools button[data-tool="remove"]').focus()`);
	await b.key("Enter");
	await sleep(250);
	const afterRemove = await b.evaluate(`({ keys: [...document.querySelectorAll('#rotation-set [role="option"]')].map((o) => o.dataset.key), selected: document.querySelector('#rotation-set [role="option"][aria-selected="true"]')?.dataset.key ?? null, focus: document.activeElement?.dataset?.tool ?? document.activeElement?.id ?? null })`);
	check("T5: Remove takes the reading out, selects the one now in its place and keeps focus on Remove", same(lastWrite()?.rotationKeys, orderBefore.filter((k) => k !== sim.keys.hot)) && afterRemove.selected === orderBefore.filter((k) => k !== sim.keys.hot)[1] && afterRemove.focus === "remove", JSON.stringify({ afterRemove, wrote: lastWrite()?.rotationKeys }));
	// The folded Alerts line while only live alert state changes (the K1
	// rule): a reading crosses warn and critical and back, and a °F dial
	// steps from GPU Power, outside its limits' unit, to GPU Temperature,
	// past them. Its " · warning now", " · critical now" and " · snoozed"
	// used to rewrap the line and move every section under it. The line now
	// keeps, unseen in its cell, the room of the same text with each live
	// ending, so with every fold shut no section moves and the line keeps
	// its height, at 378, 373, 302, 252 and 189 px and in high contrast, and
	// nothing is written. A dial whose rotation holds a reading with limits
	// of its own (Separate limits) steps onto and off it: the line swaps
	// the dial's limits for "This reading: ...", and it keeps the room of
	// both. The unseen lines are aria-hidden, out of the
	// accessibility tree and the line's name, never painted or focusable,
	// and the live changes never touch them.
	{
		const SUM = '[data-summary="alerts"]';
		const LAYOUT = `(() => {
			const tops = {};
			for (const e of document.querySelectorAll('#reading-status, [id^="sec-"]')) if (e.getClientRects().length > 0) tops[e.id] = Math.round((e.getBoundingClientRect().top + scrollY) * 10) / 10;
			const shown = document.querySelector(${JSON.stringify(SUM)});
			const unseen = [...shown.parentElement.children].filter((e) => e.getAttribute("aria-hidden") === "true");
			return {
				text: shown.textContent,
				row: Math.round(document.querySelector("#sec-alerts > summary").getBoundingClientRect().height * 10) / 10,
				tops,
				unseen: unseen.map((e) => e.textContent).sort(),
				painted: unseen.filter((e) => getComputedStyle(e).visibility !== "hidden").length,
				focusable: unseen.filter((e) => { e.focus(); return document.activeElement === e; }).length
			};
		})()`;
		const axOf = async () => {
			const doc = await b.send("DOM.getDocument", { depth: 0 });
			const { nodeId } = await b.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#sec-alerts > summary" });
			const name = (await b.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false })).nodes[0]?.name?.value ?? null;
			const { nodeIds } = await b.send("DOM.querySelectorAll", { nodeId: doc.root.nodeId, selector: '#sec-alerts > summary [aria-hidden="true"]' });
			const ignored = [];
			for (const id of nodeIds) ignored.push((await b.send("Accessibility.getPartialAXTree", { nodeId: id, fetchRelatives: false })).nodes[0]?.ignored === true);
			return { name, ignored };
		};
		const withEndings = (base, endings) => endings.map((e) => base + e).sort();
		const dialEndings = ["", " · warning now", " · critical now", " · snoozed"];
		const keyEndings = ["", " · warning now", " · critical now"].flatMap((e) => [e, `${e} · snoozed`]);
		const value = (key, v) => () => {
			sim.snapshot.byKey.get(key).value = v;
		};
		const reading = (key) => () => sim.pushSettings({ ...sim.settings, readingKey: key });
		const cases = [
			{
				name: "dial, a step into its limits",
				fixture: "dial-configured",
				settings: { ...sim.fixtures["dial-configured"].settings, fahrenheit: true, readingKey: sim.keys.gpuPower },
				steps: [reading(sim.keys.gpuPower), reading(sim.keys.gpu), reading(sim.keys.gpuPower)],
				lines: withEndings("Warn ≥ 80 °F · critical ≥ 90 °F · °F readings only", dialEndings)
			},
			{
				name: "dial, a step onto and off a reading with limits of its own",
				fixture: "dial-configured",
				settings: { ...sim.fixtures["dial-configured"].settings, readingKey: sim.keys.gpu, alertRules: { [sim.keys.hot]: { warn: "60", crit: "90", unit: "°C" } } },
				steps: [reading(sim.keys.gpu), reading(sim.keys.hot), reading(sim.keys.gpuPower), reading(sim.keys.gpu)],
				lines: [...withEndings("Warn ≥ 80 °C · critical ≥ 90 °C · °C readings only", dialEndings), ...withEndings("This reading: warn ≥ 60 °C · critical ≥ 90 °C", dialEndings)].sort()
			},
			{ name: "dial, live values", fixture: "dial-alert", steps: [value(sim.keys.hot, 50), value(sim.keys.hot, 65), value(sim.keys.hot, 75), value(sim.keys.hot, 50)], lines: withEndings("Warn ≥ 60 °C · critical ≥ 70 °C · °C readings only", dialEndings) },
			{ name: "key, live values", fixture: "key-alert", steps: [value(sim.keys.hot, 50), value(sim.keys.hot, 65), value(sim.keys.hot, 75), value(sim.keys.hot, 50)], lines: withEndings("Warn ≥ 60 °C · critical ≥ 70 °C", keyEndings) }
		];
		await b.send("DOM.enable");
		await b.send("Accessibility.enable");
		try {
			for (const { name, fixture, settings, steps, lines } of cases) {
				const moves = [];
				const seen = [];
				const names = [];
				let ignored = [];
				let roomChanges = 0;
				let wrote = 0;
				for (const forced of [false, true]) {
					await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: forced ? "active" : "none" }] });
					for (const width of forced ? [378] : [378, 373, 302, 252, 189]) {
						await b.viewport(width, 900, 1);
						await open(fixture, settings === undefined ? undefined : { settings });
						await b.evaluate(`(() => {
							document.querySelectorAll("details.hw-sec").forEach((d) => { d.open = false; });
							const shown = document.querySelector(${JSON.stringify(SUM)});
							window.__roomChanges = 0;
							new MutationObserver((records) => { for (const r of records) if (r.target !== shown && !shown.contains(r.target)) window.__roomChanges++; }).observe(shown.parentElement, { childList: true, subtree: true, characterData: true, attributes: true });
						})()`);
						await sleep(150);
						let first = null;
						for (const step of steps) {
							step();
							sim.pushPreview();
							await sleep(220);
							const now = await b.evaluate(LAYOUT);
							const ax = await axOf();
							seen.push(now);
							names.push([ax.name, `Alerts ${now.text}`]);
							ignored = ignored.concat(ax.ignored);
							if (first === null) first = now;
							const moved = Object.keys({ ...first.tops, ...now.tops }).filter((id) => first.tops[id] !== now.tops[id]);
							if (now.row !== first.row || moved.length > 0) moves.push({ width, forced, text: now.text, row: [first.row, now.row], moved: moved.length });
						}
						roomChanges += await b.evaluate("window.__roomChanges");
						wrote += sim.writes.length + sim.globalWrites.length;
					}
				}
				const texts = [...new Set(seen.map((s) => s.text))];
				check(`H1 (${name}): with every fold shut, a live alert change moves no section and keeps the Alerts line's height, at 378, 373, 302, 252 and 189 px and in high contrast, writing nothing`, texts.length >= 2 && moves.length === 0 && wrote === 0, JSON.stringify({ texts, moves: moves.slice(0, 6), count: moves.length, wrote }));
				check(`H1 (${name}): the line holds, unseen, the same text with every live ending, the same lines on every change`, seen.every((s) => same(s.unseen, lines)), JSON.stringify({ want: lines, got: [...new Set(seen.map((s) => JSON.stringify(s.unseen)))] }));
				check(`H1 (${name}): the unseen lines are never painted (high contrast too), focusable, in the accessibility tree or in the line's name, and live changes never touch them`, ignored.length === seen.length * lines.length && ignored.every(Boolean) && seen.every((s) => s.painted === 0 && s.focusable === 0) && names.every(([got, want]) => got === want) && roomChanges === 0, JSON.stringify({ ignored: ignored.length, painted: seen.map((s) => s.painted).filter(Boolean).length, focusable: seen.map((s) => s.focusable).filter(Boolean).length, names: names.filter(([got, want]) => got !== want).slice(0, 2), roomChanges }));
			}
		} finally {
			await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "none" }] });
			await b.send("Accessibility.disable").catch(() => {});
			await b.viewport(400, 900, 1);
		}
	}
	// The dial's header while the cycle steps (owner pick K1, option B): a
	// longer name or source line used to wrap onto one more line, so the
	// header grew and every section under it moved, then moved back. The
	// two lines are one block now, and its cell also holds, unseen, the
	// tallest name the dial's steps can bring over the tallest source line
	// (every name in one cell, every source line in the cell under it), at
	// the app's 378 px and at 302, 252 and 189 px (about 125%, 150% and
	// 200%). The room a shorter pair leaves is under the source line, so
	// the name always sits directly on its source and the state line under
	// them keeps its place. A step is the plugin's: the new readingKey,
	// then a preview. The unseen lines are the rotation's, in an
	// aria-hidden block and out of the accessibility tree, never painted
	// (high contrast too) or focusable, and the same nodes all through. A
	// member saved under its Gadget key and read from Shared Memory through
	// a reading link keeps the name the rotation saves under that key: the
	// dial adopts the saved key, and the header reads the name there.
	{
		const junction = keyOf(sampleSnapshot(), 1, "GPU Memory Junction Temperature");
		const LINES = '#hw-head .hw-head-lines[aria-hidden="true"] :is(.hw-head-reading, .hw-head-source)';
		const LAYOUT = `(() => {
			const tops = {};
			for (const e of document.querySelectorAll('#reading-status, [id^="sec-"]')) if (e.getClientRects().length > 0) tops[e.id] = Math.round((e.getBoundingClientRect().top + scrollY) * 10) / 10;
			const unseen = [...document.querySelectorAll(${JSON.stringify(LINES)})];
			const name = document.getElementById("head-reading");
			const source = document.getElementById("head-source");
			// The words' own boxes, not their elements': a line stretched to
			// its cell's height would hide a blank line under its words.
			const words = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
			return {
				name: name.textContent,
				source: source.textContent,
				head: Math.round(document.getElementById("hw-head").getBoundingClientRect().height * 10) / 10,
				gap: Math.round((words(source).top - words(name).bottom) * 10) / 10,
				halfLine: parseFloat(getComputedStyle(source).lineHeight) / 2,
				state: Math.round((document.getElementById("head-state").getBoundingClientRect().top + scrollY) * 10) / 10,
				tops,
				unseen: unseen.map((e) => (e.classList.contains("hw-head-reading") ? "name: " : "source: ") + e.textContent).sort(),
				painted: unseen.filter((e) => getComputedStyle(e).visibility !== "hidden").length,
				focusable: unseen.filter((e) => { e.focus(); return document.activeElement === e; }).length
			};
		})()`;
		const ignored = async () => {
			const doc = await b.send("DOM.getDocument", { depth: 0 });
			const { nodeIds } = await b.send("DOM.querySelectorAll", { nodeId: doc.root.nodeId, selector: LINES });
			const out = [];
			for (const nodeId of nodeIds) out.push((await b.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false })).nodes[0]?.ignored === true);
			return out;
		};
		const step = async (key) => {
			sim.pushSettings({ ...sim.settings, readingKey: key });
			sim.pushPreview();
			await sleep(200);
			return b.evaluate(LAYOUT);
		};
		const gpuSource = "GPU [#0]: Example Graphics 24GB";
		const cpuSource = "CPU [#0]: Example 16-Core Processor: Enhanced";
		const cases = [
			{
				fixture: "dial-groups",
				settings: sim.fixtures["dial-groups"].settings,
				lines: ["name: CPU (Tctl/Tdie)", "name: CPU CCD1 (Tdie)", "name: GPU Temperature", "name: Hot Spot", `source: ${cpuSource}`, `source: ${gpuSource}`, `source: GPU Hot Spot Temperature · ${gpuSource}`]
			},
			{
				fixture: "dial-configured",
				settings: { ...sim.fixtures["dial-configured"].settings, readingKey: sim.keys.gpu, rotationKeys: [sim.keys.gpu, junction, sim.keys.gpuPower] },
				lines: ["name: GPU Memory Junction Temperature", "name: GPU Power", "name: GPU Temperature", `source: ${gpuSource}`]
			},
			{
				fixture: "dial-configured",
				label: "a member saved under its linked Gadget key",
				settings: { ...sim.fixtures["dial-configured"].settings, readingKey: sim.keys.gpu, rotationKeys: [sim.keys.gpu, "g2:gpu-hot-spot", sim.keys.gpuPower], rotationNames: { "g2:gpu-hot-spot": "Hot" } },
				globals: { ...sim.fixtures["dial-configured"].globals, readingLinks: [{ sharedMemory: sim.keys.hot, gadget: "g2:gpu-hot-spot", unit: "°C", sensorType: 1 }] },
				lines: ["name: GPU Power", "name: GPU Temperature", "name: Hot", `source: ${gpuSource}`, `source: GPU Hot Spot Temperature · ${gpuSource}`]
			}
		];
		await b.send("DOM.enable");
		await b.send("Accessibility.enable");
		try {
			for (const { fixture: page, label, settings, globals, lines } of cases) {
				const fixture = label === undefined ? page : `${page}, ${label}`;
				const keys = settings.rotationKeys;
				await b.viewport(378, 900, 1);
				await open(page, globals === undefined ? { settings } : { settings, globals });
				await b.evaluate(`(() => {
					window.__roomChanges = 0;
					const watch = new MutationObserver((records) => { for (const r of records) { const at = r.target.nodeType === 3 ? r.target.parentElement : r.target; if (r.type === "childList" && (at.id === "head-reading" || at.id === "head-source")) continue; if (at.closest('[aria-hidden="true"]') !== null || r.type === "childList") window.__roomChanges++; } });
					watch.observe(document.getElementById("head-reading").closest(".hw-room"), { childList: true, subtree: true, characterData: true, attributes: true });
				})()`);
				const moves = [];
				const seen = [];
				let painted = 0;
				let focusable = 0;
				for (const forced of [false, true]) {
					if (forced) await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
					for (const width of forced ? [378] : [378, 302, 252, 189]) {
						await b.viewport(width, 900, 1);
						const first = await step(keys[0]);
						seen.push(first);
						for (const key of [...keys.slice(1), keys[0]]) {
							const now = await step(key);
							seen.push(now);
							const moved = Object.keys({ ...first.tops, ...now.tops }).filter((id) => first.tops[id] !== now.tops[id]);
							if (now.head !== first.head || now.state !== first.state || moved.length > 0) moves.push({ width, forced, name: now.name, source: now.source, head: [first.head, now.head], state: [first.state, now.state], moved });
						}
					}
					if (forced) await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "none" }] });
				}
				for (const s of seen) {
					painted += s.painted;
					focusable += s.focusable;
				}
				const axIgnored = await ignored();
				const roomChanges = await b.evaluate("window.__roomChanges");
				await b.viewport(400, 900, 1);
				check(`K1 (${fixture}): stepping the dial's rotation moves no section or the state line and keeps the header's height, at 378, 302, 252 and 189 px and in high contrast, writing nothing`, moves.length === 0 && sim.writes.length === 0 && sim.globalWrites.length === 0, JSON.stringify({ moves: moves.slice(0, 6), count: moves.length, ...writes() }));
				check(`K1 (${fixture}): the name's words sit directly on its source line's on every step (under half a line apart), the kept room under them`, seen.every((s) => s.gap < s.halfLine), JSON.stringify(seen.filter((s) => !(s.gap < s.halfLine)).slice(0, 6).map((s) => ({ name: s.name, gap: s.gap, halfLine: s.halfLine }))));
				check(`K1 (${fixture}): the header holds every name and source line the rotation brings, unseen in one block, and the same lines on every step`, seen.every((s) => same(s.unseen, [...lines].sort())), JSON.stringify({ want: lines, got: [...new Set(seen.map((s) => JSON.stringify(s.unseen)))] }));
				check(`K1 (${fixture}): the unseen lines are never painted (high contrast too), focusable or in the accessibility tree, and the cycle never touches them`, axIgnored.length === lines.length && axIgnored.every(Boolean) && painted === 0 && focusable === 0 && roomChanges === 0, JSON.stringify({ axIgnored, painted, focusable, roomChanges }));
			}
		} finally {
			await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "none" }] });
			await b.send("Accessibility.disable").catch(() => {});
			await b.viewport(400, 900, 1);
		}
	}
	// The dial's header with names as long as real hardware has. HWiNFO
	// names a sensor by board and model ("GPU [#0]: <chip>: <vendor's card
	// name>"), and beside the dial's face such a source line would run to
	// four lines or more at the app's panel width. The name and the source
	// line share four lines, the rest cut with an ellipsis, so the header
	// stays under a third of the app's 410 px panel and pinned: the name
	// takes two at most, and the source line three where every name the
	// dial can show takes one line, two where any of them takes two. The
	// whole text stays the line's text. While a shown line is cut, the
	// two lines are the handle of a card with the whole name, the whole
	// source line and Copy, laid over the form: it opens on a rest of the
	// pointer, on keyboard focus and on a click, and opening or closing it
	// moves nothing. The card hangs from the header, so the whole header
	// keeps an open card open, and only the name opens it. Checked at 373 px
	// (the app's 378 px less the scrollbar)
	// and 378 px by 410 px, with every fold shut, through a rotation of
	// three whose second member the rotation names. A header taller than a
	// third of the panel is not pinned (pi-shell.js sets data-pin-off):
	// this fixture's header is under the third at 410 px and over it on a
	// 300 px panel, the third viewport here. The pointer is the real one
	// (CDP mouse events), and the waits are the card's own: 250 ms to open,
	// 400 ms to close.
	{
		const base = sampleSnapshot();
		// Four lines of source at 373 and 378 px, so three are a cut too; the
		// shorter name is three lines there, which fit.
		const longGpu = "GPU [#0]: Example Graphics 24GB: Example Vendor Graphics 24GB Triple Fan Edition OC (EX-V24GTFE-OC)";
		const fitsGpu = "GPU [#0]: Example Graphics 24GB: Example Vendor Graphics 24GB OC";
		const named = (name) => ({ ...base, sensors: base.sensors.map((s) => (s.name.startsWith("GPU") ? { ...s, name } : s)) });
		const snapshot = named(longGpu);
		const { gpu, hot, gpuPower, cpu } = sim.keys;
		const junction = keyOf(base, 1, "GPU Memory Junction Temperature");
		const keys = [gpu, hot, gpuPower];
		const settings = { ...sim.fixtures["dial-configured"].settings, readingKey: gpu, rotationKeys: keys, rotationNames: { [hot]: "Hot" } };
		// The header's two lines for each member, whole, and what Copy takes:
		// HWiNFO's name for the reading, whatever the rotation calls it.
		const whole = { [gpu]: ["GPU Temperature", longGpu], [hot]: ["Hot", `GPU Hot Spot Temperature · ${longGpu}`], [gpuPower]: ["GPU Power", longGpu] };
		const copies = { [gpu]: `GPU Temperature · ${longGpu}`, [hot]: `GPU Hot Spot Temperature · ${longGpu}`, [gpuPower]: `GPU Power · ${longGpu}` };
		// The share of the four lines. A rotation of one-line names (the
		// second is one line down to 302 px and two at 252 px), and one with a
		// two-line name among its members.
		const oneSet = { ...settings, rotationNames: { [hot]: "Graphics card hot spot" } };
		const twoSet = { ...settings, rotationKeys: [gpu, junction, gpuPower], rotationNames: {} };
		const OPENS = 250 + 200;
		const CLOSES = 400 + 250;
		const NOW = `(() => {
			const tops = {};
			for (const e of document.querySelectorAll('#reading-status, [id^="sec-"]')) if (e.getClientRects().length > 0) tops[e.id] = Math.round((e.getBoundingClientRect().top + scrollY) * 10) / 10;
			const name = document.getElementById("head-reading");
			const source = document.getElementById("head-source");
			const lines = document.getElementById("head-lines");
			const head = document.getElementById("hw-head");
			const card = document.getElementById("head-whole");
			const cell = lines.parentElement;
			// The header's boxes outside the cell of the name and source line.
			for (const id of ["face", "head-kind", "hw-folds", "head-state"]) {
				const e = document.getElementById(id);
				if (e.getClientRects().length === 0) continue;
				const r = e.getBoundingClientRect();
				tops[id] = [r.top + scrollY, r.left, r.height].map((v) => Math.round(v * 10) / 10).join(" ");
			}
			const rows = (el) => Math.round((el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)) * 100) / 100;
			// The lines a text shows and the words on them, from where each
			// letter is laid out: the lines inside the text's box, the last of
			// them up to where the ellipsis starts.
			const seen = (el) => {
				const text = el.textContent;
				const node = el.firstChild;
				if (node === null || text === "") return { lines: 0, shown: "" };
				const box = el.getBoundingClientRect();
				const range = document.createRange();
				const rects = [];
				const lineTops = [];
				for (let i = 0; i < text.length; i++) {
					range.setStart(node, i);
					range.setEnd(node, i + 1);
					const r = range.getClientRects()[0] ?? null;
					rects.push(r);
					if (r !== null && r.width > 0 && !lineTops.some((t) => Math.abs(t - r.top) < 2)) lineTops.push(r.top);
				}
				lineTops.sort((a, z) => a - z);
				const fits = lineTops.filter((t) => t + 2 < box.bottom).length;
				if (fits >= lineTops.length) return { lines: lineTops.length, shown: text };
				const style = getComputedStyle(el);
				const pen = document.createElement("canvas").getContext("2d");
				pen.font = style.fontWeight + " " + style.fontSize + " " + style.fontFamily;
				const limit = box.left + el.clientWidth - pen.measureText("…").width + 0.5;
				const last = lineTops[fits - 1];
				let end = 0;
				for (let i = 0; i < text.length; i++) {
					const r = rects[i];
					if (r === null || r.width === 0) continue;
					if (r.top < last - 2 || (Math.abs(r.top - last) < 2 && r.right <= limit)) end = i + 1;
					else if (r.top > last + 2) break;
				}
				return { lines: fits, shown: text.slice(0, end) };
			};
			const unseen = (kind) => Math.max(0, ...[...cell.querySelectorAll('[aria-hidden="true"] .hw-head-' + kind)].map((el) => seen(el).lines));
			const sourceSeen = seen(source);
			// Cut short: the line overflows its own box, or its words reach
			// past a box between it and the card that clips what overflows
			// (the card scrolls when its text is too long for the panel,
			// which no fixture here is).
			const clipped = (el) => {
				if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) return true;
				const range = document.createRange();
				range.selectNodeContents(el);
				const words = range.getBoundingClientRect();
				if (words.height === 0) return false;
				for (let box = el.parentElement; box !== null; box = box.parentElement) {
					const style = getComputedStyle(box);
					if (style.overflowX !== "visible" || style.overflowY !== "visible") {
						const r = box.getBoundingClientRect();
						if (words.top < r.top - 1 || words.bottom > r.bottom + 1 || words.left < r.left - 1 || words.right > r.right + 1) return true;
					}
					if (box === card) break;
				}
				return false;
			};
			const shown = card !== null && card.getClientRects().length > 0;
			const box = shown ? card.getBoundingClientRect() : null;
			const edge = shown ? getComputedStyle(card) : null;
			return {
				name: name.textContent,
				source: source.textContent,
				nameRows: rows(name),
				sourceRows: rows(source),
				nameLines: seen(name).lines,
				sourceLines: sourceSeen.lines,
				sourceShown: sourceSeen.shown,
				room: [unseen("reading"), unseen("source")],
				lineHeight: getComputedStyle(name).lineHeight,
				tall4: window.__tall ?? 0,
				late: window.__late ?? 0,
				loop: window.__loop ?? 0,
				head: Math.round(head.getBoundingClientRect().height * 10) / 10,
				tall: Math.ceil(head.getBoundingClientRect().height) > innerHeight / 3,
				pinned: getComputedStyle(head).position === "sticky",
				tops,
				scrollY,
				page: document.documentElement.scrollHeight,
				sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
				handle: lines.getAttributeNames().sort().join(" "),
				expanded: lines.getAttribute("aria-expanded"),
				cursor: getComputedStyle(lines).cursor,
				ring: getComputedStyle(lines).outlineStyle + " " + getComputedStyle(lines).outlineWidth,
				active: document.activeElement?.id ?? "",
				shows: window.__wholeShows ?? 0,
				card: !shown ? null : {
					name: document.getElementById("head-whole-name").textContent,
					source: document.getElementById("head-whole-source").textContent,
					clipped: [...card.querySelectorAll("p")].filter(clipped).length + (card.scrollHeight > card.clientHeight + 1 ? 1 : 0),
					inView: box.top >= 0 && box.left >= 0 && box.bottom <= innerHeight && box.right <= document.documentElement.clientWidth,
					top: Math.round(box.top * 10) / 10,
					label: document.getElementById("head-copy-label").textContent,
					copyWidth: Math.round(document.getElementById("head-copy").getBoundingClientRect().width * 10) / 10,
					colors: [edge.borderTopColor, edge.backgroundColor, getComputedStyle(document.getElementById("head-whole-source")).color]
				}
			};
		})()`;
		const now = () => b.evaluate(NOW);
		// Nothing moved between two looks: every section top, the header's
		// height, the scroll and the page's length, with no sideways scroll.
		const still = (a, z) => same(a.tops, z.tops) && a.head === z.head && a.scrollY === z.scrollY && a.page === z.page && a.sideways === 0 && z.sideways === 0;
		const shown = (s) => s.card !== null;
		const isWhole = (s, key) => s.card !== null && s.card.name === whole[key][0] && s.card.source === whole[key][1] && s.card.clipped === 0 && s.card.inView;
		const spot = (selector, edge = "center") =>
			b.evaluate(`(() => {
				const el = document.querySelector(${JSON.stringify(selector)});
				if (el === null || el.getClientRects().length === 0) return null;
				const r = el.getBoundingClientRect();
				return { x: Math.round(r.left + r.width / 2), y: Math.round(${JSON.stringify(edge)} === "bottom" ? r.bottom - 4 : ${JSON.stringify(edge)} === "top" ? r.top + 6 : r.top + r.height / 2) };
			})()`);
		const point = async (at) => {
			if (at !== null) await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
		};
		const press = async (selector) => {
			const at = await spot(selector);
			if (at === null) return;
			await point(at);
			await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", clickCount: 1 });
			await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", clickCount: 1 });
			await sleep(60);
		};
		const axOf = async (selector) => {
			const doc = await b.send("DOM.getDocument", { depth: 0 });
			const { nodeIds } = await b.send("DOM.querySelectorAll", { nodeId: doc.root.nodeId, selector });
			const out = [];
			for (const nodeId of nodeIds) {
				const node = (await b.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false })).nodes[0];
				out.push({ ignored: node?.ignored === true, role: node?.role?.value ?? "", name: node?.name?.value ?? "", expanded: node?.properties?.find((p) => p.name === "expanded")?.value?.value ?? null });
			}
			return out;
		};
		// Counts the card's showings, takes the clipboard call (refused on
		// demand, with the selection the fallback copies), and notes whether
		// Space was kept from scrolling the panel.
		const WATCH = `(() => {
			document.querySelectorAll("details.hw-sec").forEach((d) => { d.open = false; });
			window.__wholeShows = 0;
			window.__copied = [];
			window.__picked = [];
			window.__refuse = false;
			window.__kept = [];
			const card = document.getElementById("head-whole");
			if (card !== null) new MutationObserver(() => { if (!card.hidden) window.__wholeShows++; }).observe(card, { attributes: true, attributeFilter: ["hidden"] });
			navigator.clipboard.writeText = (text) => (window.__refuse ? Promise.reject(new Error("refused")) : (window.__copied.push(text), Promise.resolve()));
			document.execCommand = () => { window.__picked.push(getSelection().toString()); return window.__refuse !== "all"; };
			document.addEventListener("keydown", (ev) => { if (ev.key === " ") window.__kept.push(ev.defaultPrevented); });
			// What a frame is about to paint. This observer is set up after
			// the panel's own, so in a frame it runs after them: the cell of
			// the name and source line taller than four lines (two of each),
			// and a measured header height that is not the header's. The
			// browser raises an error event when a frame's observers leave a
			// size change for the next frame.
			window.__tall = 0;
			window.__late = 0;
			window.__loop = 0;
			const cell = document.getElementById("head-lines").parentElement;
			const head = document.getElementById("hw-head");
			const px = (id) => parseFloat(getComputedStyle(document.getElementById(id)).lineHeight);
			const four = 2 * px("head-reading") + 2 * px("head-source") + 1;
			const painted = new ResizeObserver(() => {
				if (cell.getBoundingClientRect().height > four) window.__tall++;
				if (getComputedStyle(document.documentElement).getPropertyValue("--hw-head-h").trim() !== Math.ceil(head.getBoundingClientRect().height) + "px") window.__late++;
			});
			painted.observe(cell);
			painted.observe(head);
			window.addEventListener("error", (ev) => { if (String(ev.message).includes("ResizeObserver")) window.__loop++; });
		})()`;
		const start = async (width, height, overrides) => {
			await b.viewport(width, height, 1);
			await open("dial-configured", overrides);
			await b.evaluate(WATCH);
			await sleep(200);
			await point({ x: 20, y: height - 10 });
		};
		const step = async (doc, key) => {
			sim.pushSettings({ ...doc, readingKey: key });
			sim.pushPreview();
			await sleep(200);
		};
		const seen = [];
		const moves = [];
		const rested = [];
		const runs = [];
		const narrow = [];
		const shares = [];
		const fitting = [];
		const ways = [];
		let short = null;
		let uncut = null;
		let wrap = null;
		let arrive = null;
		let wrote = 0;
		const errorsBefore = pageErrors.length;
		await b.send("DOM.enable");
		await b.send("Accessibility.enable");
		try {
			for (const [width, height] of [[373, 410], [378, 410], [373, 300]]) {
				const far = { x: 20, y: height - 10 };
				await start(width, height, { settings, snapshot });
				// Every step, at rest and with the pointer resting on the name.
				let first = null;
				for (const key of [...keys, keys[0]]) {
					await step(settings, key);
					const shut = { width, height, key, ...(await now()) };
					seen.push(shut);
					first ??= shut;
					const moved = Object.keys({ ...first.tops, ...shut.tops }).filter((id) => first.tops[id] !== shut.tops[id]);
					if (shut.head !== first.head || moved.length > 0) moves.push({ width, height, name: shut.name, head: [first.head, shut.head], moved: moved.length });
					await point(await spot("#head-lines"));
					await sleep(OPENS);
					const over = await now();
					await point(far);
					await sleep(CLOSES);
					rested.push({ width, height, key, shut, over, left: await now() });
				}
				if (height !== 410) {
					wrote += sim.writes.length + sim.globalWrites.length;
					continue;
				}
				const run = { width, shut: await now() };
				runs.push(run);
				// Keyboard: Tab from the fold pair lands on the name.
				await b.evaluate(`document.querySelector("#hw-folds button").focus()`);
				await b.key("Tab");
				await sleep(60);
				run.focus = await now();
				const keyed = [];
				for (const key of ["Enter", "Enter", "Enter", " ", " "]) {
					await b.key(key);
					await sleep(60);
					keyed.push(await now());
				}
				run.keyed = keyed;
				run.kept = await b.evaluate("window.__kept");
				await b.key("Tab");
				await sleep(60);
				run.tabCopy = await now();
				await b.key("Enter");
				await sleep(60);
				run.keyCopied = { text: await b.evaluate("window.__copied.slice()"), label: (await now()).card?.label };
				await b.key("Tab");
				await sleep(60);
				run.tabOut = await now();
				// A click holds; a click elsewhere and a second click close.
				await press("#head-lines");
				run.click = await now();
				await point(far);
				await sleep(CLOSES);
				run.clickHeld = await now();
				await press("#head-kind");
				run.clickElsewhere = await now();
				await press("#head-lines");
				await press("#head-lines");
				run.clickTwice = await now();
				await sleep(CLOSES);
				run.clickStays = await now();
				await point(far);
				// The pointer alone: a pass, the way down into the card, leaving.
				await point(await spot("#head-lines"));
				await sleep(100);
				await point(far);
				await sleep(CLOSES);
				run.pass = await now();
				await point(await spot("#head-lines"));
				await sleep(OPENS);
				const from = await spot("#head-lines", "bottom");
				const to = await spot("#head-whole", "top");
				// 2 px every 50 ms is 40 px a second: the way from the name to
				// the card takes longer than the card waits before it closes.
				for (let y = from?.y ?? 0; from !== null && to !== null && y <= to.y; y += 2) {
					await point({ x: from.x, y });
					await sleep(50);
				}
				run.travel = { ...(await now()), took: from !== null && to !== null ? ((to.y - from.y) / 2) * 50 : 0 };
				await point(await spot("#head-copy"));
				await sleep(CLOSES);
				run.onCopy = await now();
				await point(far);
				await sleep(150);
				run.grace = await now();
				await sleep(CLOSES - 150);
				run.gone = await now();
				// A press on the card's text holds it; focus elsewhere closes it.
				await point(await spot("#head-lines"));
				await sleep(OPENS);
				await press("#head-whole-source");
				await point(far);
				await sleep(CLOSES);
				run.textHeld = await now();
				await b.evaluate(`document.querySelector("details.hw-sec > summary").focus()`);
				await sleep(60);
				run.focusElsewhere = await now();
				// Copy, with the card held open.
				await press("#head-lines");
				run.beforeCopy = await now();
				await press("#head-copy");
				await sleep(60);
				run.copied = await now();
				run.copiedText = await b.evaluate("window.__copied.slice()");
				await sleep(1500 + 150);
				run.copyRested = await now();
				// A second press 700 ms into the confirmation: 1,000 ms later the
				// first press's 1,500 ms are up and the second's are not.
				await press("#head-copy");
				await sleep(700);
				await press("#head-copy");
				await sleep(1000);
				run.again = await now();
				await sleep(700);
				run.againRested = await now();
				// A step during the confirmation, the card open.
				await press("#head-copy");
				await sleep(60);
				run.beforeStep = await now();
				await step(settings, hot);
				run.stepped = await now();
				await press("#head-copy");
				run.steppedText = await b.evaluate("window.__copied.at(-1)");
				// The clipboard call refused: the same text, copied as a selection.
				await b.evaluate(`window.__refuse = true`);
				await press("#head-copy");
				await sleep(60);
				run.fallback = { ...(await now()), picked: await b.evaluate("window.__picked.slice()") };
				await b.evaluate(`window.__refuse = "all"`);
				await press("#head-copy");
				await sleep(60);
				run.failed = { ...(await now()), picked: await b.evaluate("window.__picked.slice()") };
				// The accessibility tree, the card open, and high contrast.
				run.ax = { handle: await axOf("#head-lines"), lines: await axOf("#head-whole p"), copy: await axOf("#head-copy"), spare: await axOf('#head-copy [aria-hidden="true"]') };
				await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
				await sleep(100);
				run.forced = await now();
				await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "none" }] });
				await press("#head-kind");
				run.end = await now();
				wrote += sim.writes.length + sim.globalWrites.length;
			}
			// Narrower panels (about 125%, 150% and 200%; at 189 px the text
			// sits under the face and the header is not pinned).
			for (const width of [302, 252, 189]) {
				await start(width, 410, { settings, snapshot });
				const shut = await now();
				await press("#head-lines");
				narrow.push({ width, shut, open: await now() });
				wrote += sim.writes.length + sim.globalWrites.length;
			}
			// A step to a pair that is not cut, the card held open, and back.
			{
				const pair = { ...settings, rotationKeys: [gpu, cpu] };
				await start(373, 410, { settings: pair, snapshot });
				const shut = await now();
				await press("#head-lines");
				const held = await now();
				await step(pair, cpu);
				const off = await now();
				await step(pair, gpu);
				const back = await now();
				// The lines' width changes with no render and no resize event:
				// without the face the source line fits in two lines.
				await b.evaluate(`document.getElementById("face").hidden = true`);
				await sleep(120);
				const wide = await now();
				await b.evaluate(`document.getElementById("face").hidden = false`);
				await sleep(120);
				uncut = { shut, open: held, off, back, wide, beside: await now() };
				// A name that comes to be cut under a pointer already resting on
				// it: the step from the pair that fits, the pointer still.
				await step(pair, cpu);
				await point(await spot("#head-lines"));
				await sleep(OPENS);
				const resting = await now();
				await step(pair, gpu);
				await sleep(OPENS);
				arrive = { resting, came: await now() };
				await point({ x: 20, y: 400 });
				wrote += sim.writes.length + sim.globalWrites.length;
			}
			// A dial whose names fit: the sample hardware's own.
			{
				await start(373, 410);
				const rest = await now();
				await point(await spot("#head-lines"));
				await sleep(OPENS);
				const over = await now();
				await b.evaluate(`document.querySelector("#hw-folds button").focus()`);
				await b.key("Tab");
				await sleep(60);
				const tabbed = await now();
				await press("#head-lines");
				short = { rest, over, tabbed, clicked: await now() };
				wrote += sim.writes.length + sim.globalWrites.length;
			}
			// The share on every step of both rotations, at the app's two
			// widths, in high contrast and at 189 px (the text under the face).
			for (const [names, doc] of [["one", oneSet], ["two", twoSet]]) {
				for (const [width, forced] of [[373, false], [378, false], [378, true], [189, false]]) {
					await start(width, 410, { settings: doc, snapshot });
					if (forced) {
						await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
						await sleep(100);
					}
					let first = null;
					for (const key of [...doc.rotationKeys, doc.rotationKeys[0]]) {
						await step(doc, key);
						const at = await now();
						first ??= at;
						shares.push({ names, width, forced, key, ...at, moved: !still(first, at) });
					}
					if (forced) await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "none" }] });
					wrote += sim.writes.length + sim.globalWrites.length;
				}
			}
			// A width that wraps a name, with no render: 378 to 252 px and back,
			// twice, each looked at before anything is pushed and then stepped
			// through. Then the column alone made narrower, which raises no
			// resize event (the way the panel's scrollbar narrows it), a
			// two-line name written from outside the shell, and the same
			// widths with a line height the browser gives as "normal".
			{
				await start(378, 410, { settings: oneSet, snapshot });
				const widths = [await now()];
				let moved = 0;
				for (const width of [252, 378, 252, 378]) {
					await b.viewport(width, 410, 1);
					await sleep(150);
					const at = await now();
					widths.push({ width, ...at });
					for (const key of [hot, gpuPower, gpu]) {
						await step(oneSet, key);
						if (!still(at, await now())) moved++;
					}
				}
				await b.evaluate(`window.__resizes = 0; addEventListener("resize", () => window.__resizes++); document.body.style.width = "300px"`);
				await sleep(150);
				const squeezed = await now();
				await b.evaluate(`document.body.style.removeProperty("width")`);
				await sleep(150);
				const eased = { ...(await now()), resizes: await b.evaluate("window.__resizes") };
				await b.evaluate(`document.getElementById("head-reading").textContent = "Graphics card hot spot temperature"`);
				await sleep(100);
				const outside = await now();
				await step(oneSet, hot);
				await step(oneSet, gpu);
				const back = await now();
				await b.evaluate(`document.head.appendChild(Object.assign(document.createElement("style"), { textContent: ".hw-head-reading { line-height: normal }" }))`);
				await sleep(100);
				const normal = [await now()];
				for (const width of [252, 378]) {
					await b.viewport(width, 410, 1);
					await sleep(150);
					normal.push(await now());
				}
				wrap = { widths, moved, squeezed, eased, outside, back, normal };
				wrote += sim.writes.length + sim.globalWrites.length;
			}
			// The way to the card, with the real pointer. The presses on the
			// fold buttons reach the plugin's fold memory, so this part has a
			// memory of its own and the suite's comes back after it.
			const folds = sim.folds;
			sim.folds = new PanelFoldMemory();
			for (const width of [373, 378]) {
				const far = { x: 20, y: 400 };
				await start(width, 410, { settings, snapshot });
				const way = { width, travels: [], rests: [] };
				// A rest on the face, the kind line and a fold button, no card open.
				for (const selector of ["#face", "#head-kind", "#hw-folds button"]) {
					await point(await spot(selector));
					await sleep(OPENS);
				}
				way.idle = await now();
				// Two slow ways from the name to the card's first words, 2 px
				// every 50 ms (40 px a second): from the name's middle, and from
				// its lower left corner over the face. Counted on the way: the
				// steps on neither the name, the state line nor the card.
				for (const from of ["middle", "corner"]) {
					await point(await spot("#head-lines"));
					await sleep(OPENS);
					const opened = await now();
					const [a, z] = await b.evaluate(`(() => {
						const name = document.getElementById("head-lines").getBoundingClientRect();
						const words = document.getElementById("head-whole-name").getBoundingClientRect();
						const a = ${JSON.stringify(from)} === "middle" ? { x: name.left + name.width / 2, y: name.top + name.height / 2 } : { x: name.left + 2, y: name.bottom - 2 };
						return [a, { x: words.left + 12, y: words.top + 8 }];
					})()`);
					await point(a);
					const length = Math.hypot(z.x - a.x, z.y - a.y);
					const count = Math.ceil(length / 2);
					let off = 0;
					for (let i = 1; i <= count; i++) {
						const at = { x: a.x + ((z.x - a.x) * i) / count, y: a.y + ((z.y - a.y) * i) / count };
						await point(at);
						if (await b.evaluate(`document.elementFromPoint(${at.x}, ${at.y})?.closest("#head-lines, #head-state, #head-whole") == null`)) off++;
						await sleep(50);
					}
					const end = await now();
					way.travels.push({ from, opened: shown(opened), kept: shown(end), shows: end.shows - opened.shows, length: Math.round(length), off: off * 2 });
					await point(far);
					await sleep(CLOSES);
				}
				// The card open, a rest on the face, the kind line and a fold
				// button, longer than the card waits before it closes. Then a
				// press on that button, and Fold all to put the sections back.
				await point(await spot("#head-lines"));
				await sleep(OPENS);
				for (const selector of ["#face", "#head-kind", "#hw-folds button"]) {
					await point(await spot(selector));
					await sleep(CLOSES);
					way.rests.push(shown(await now()));
				}
				const open = () => b.evaluate(`document.querySelectorAll("details.hw-sec[open]").length`);
				const before = await open();
				await press("#hw-folds button");
				way.pressed = { card: shown(await now()), sections: [before, await open()] };
				await press('#hw-folds button[data-folds="fold"]');
				way.folded = await open();
				// Off the header and the card: the wait, then gone.
				await point(await spot("#head-lines"));
				await sleep(OPENS);
				await point(await spot("#face"));
				await sleep(100);
				const onFace = shown(await now());
				await point(far);
				await sleep(150);
				const grace = shown(await now());
				await sleep(CLOSES - 150);
				way.leave = { onFace, grace, gone: !shown(await now()) };
				ways.push(way);
				wrote += sim.writes.length + sim.globalWrites.length;
			}
			sim.folds = folds;
			// A source line of three lines that fit, and one that does not.
			for (const width of [373, 378]) {
				await start(width, 410, { settings, snapshot: named(fitsGpu) });
				const rest = await now();
				await point(await spot("#head-lines"));
				await sleep(OPENS);
				const over = await now();
				await point({ x: 20, y: 400 });
				await step(settings, hot);
				const cut = await now();
				await press("#head-lines");
				fitting.push({ width, rest, over, cut, open: await now() });
				wrote += sim.writes.length + sim.globalWrites.length;
			}
		} finally {
			await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "none" }] });
			await b.send("Accessibility.disable").catch(() => {});
			await b.viewport(400, 900, 1);
		}
		const HANDLE = "aria-controls aria-expanded class data-cut id role tabindex";
		const at410 = seen.filter((s) => s.height === 410);
		const brief = (s) => ({ width: s.width, height: s.height, name: s.name, nameRows: s.nameRows, sourceRows: s.sourceRows, head: s.head, tall: s.tall, pinned: s.pinned });
		const four = (s) => s.nameRows <= 2.05 && s.sourceRows <= 3.05 && s.nameRows + s.sourceRows <= 4.05;
		check("long names: a dial's name takes two lines at most, its source line three and the two four between them at 373 and 378 px, the header under a third of the 410 px panel and pinned, on every step", at410.length === 8 && at410.every((s) => four(s) && !s.tall && s.pinned) && at410.some((s) => s.name === "Hot" && s.source === whole[hot][1]), JSON.stringify(at410.filter((s) => !(four(s) && !s.tall && s.pinned)).slice(0, 4).map(brief)));
		check("long names: a step moves no section and keeps the header's height, writing nothing", seen.length === 12 && moves.length === 0 && wrote === 0, JSON.stringify({ moves: moves.slice(0, 6), count: moves.length, wrote }));
		check("long names: a header taller than a third of the panel is not pinned and a shorter one is, on every step, both seen (the 300 px panel is the taller)", seen.length === 12 && seen.every((s) => s.pinned === !s.tall) && seen.some((s) => s.tall) && seen.some((s) => !s.tall), JSON.stringify(seen.map((s) => ({ width: s.width, height: s.height, head: s.head, tall: s.tall, pinned: s.pinned }))));
		check(
			"whole name: a rest of the pointer on a cut name opens a card with the whole name and source line, no word clipped, inside the panel, on every step; opening it and leaving it move no section, the header or the scroll",
			rested.length === 12 && rested.every((r) => r.shut.card === null && r.shut.handle === HANDLE && r.shut.cursor === "pointer" && isWhole(r.over, r.key) && r.over.expanded === "true" && still(r.shut, r.over) && r.left.card === null && r.left.expanded === "false" && still(r.shut, r.left)),
			JSON.stringify(rested.filter((r) => !(isWhole(r.over, r.key) && still(r.shut, r.over) && r.left.card === null)).slice(0, 3).map((r) => ({ width: r.width, height: r.height, name: r.shut.name, handle: r.shut.handle, card: r.over.card, still: still(r.shut, r.over), left: r.left.card })))
		);
		check(
			"whole name: keyboard focus on the name opens the card and draws the focus ring; Enter holds it, closes it and opens it, Space the same without scrolling the panel; Tab reaches Copy, Enter there copies, and the next Tab closes the card, moving nothing",
			runs.length === 2 &&
				runs.every(
					(r) =>
						r.focus.active === "head-lines" &&
						shown(r.focus) &&
						r.focus.ring === "solid 2px" &&
						same(r.keyed.map(shown), [true, false, true, false, true]) &&
						r.keyed.every((k) => k.active === "head-lines" && k.expanded === String(shown(k)) && still(r.shut, k)) &&
						same(r.kept, [true, true]) &&
						r.tabCopy.active === "head-copy" &&
						shown(r.tabCopy) &&
						same(r.keyCopied, { text: [copies[gpu]], label: "Copied" }) &&
						!["head-lines", "head-copy"].includes(r.tabOut.active) &&
						!shown(r.tabOut) &&
						still(r.shut, r.tabOut)
				),
			JSON.stringify(runs.map((r) => ({ width: r.width, focus: [r.focus.active, shown(r.focus), r.focus.ring], keyed: r.keyed.map(shown), kept: r.kept, tabCopy: [r.tabCopy.active, shown(r.tabCopy)], keyCopied: r.keyCopied, tabOut: [r.tabOut.active, shown(r.tabOut)] })))
		);
		check(
			"whole name: a click on the name holds the card open after the pointer has gone, a click elsewhere closes it, and a second click on the name closes it for good",
			runs.length === 2 && runs.every((r) => shown(r.click) && shown(r.clickHeld) && !shown(r.clickElsewhere) && !shown(r.clickTwice) && !shown(r.clickStays) && r.clickStays.shows === r.clickTwice.shows && still(r.shut, r.clickHeld)),
			JSON.stringify(runs.map((r) => ({ width: r.width, click: shown(r.click), held: shown(r.clickHeld), elsewhere: shown(r.clickElsewhere), twice: shown(r.clickTwice), stays: shown(r.clickStays) })))
		);
		check(
			"whole name: a pass of the pointer over the name opens nothing; the card stays while the pointer goes down over the state line into it at 40 px a second and while it is on Copy, 150 ms after it has left, and is gone 650 ms after",
			runs.length === 2 && runs.every((r) => !shown(r.pass) && r.pass.shows === r.clickStays.shows && r.travel.took > 400 && shown(r.travel) && r.travel.shows === r.pass.shows + 1 && shown(r.onCopy) && shown(r.grace) && !shown(r.gone) && r.gone.shows === r.travel.shows),
			JSON.stringify(runs.map((r) => ({ width: r.width, pass: [shown(r.pass), r.pass.shows - r.clickStays.shows], travel: [shown(r.travel), r.travel.took, r.travel.shows - r.pass.shows], onCopy: shown(r.onCopy), grace: shown(r.grace), gone: shown(r.gone) })))
		);
		check(
			"whole name: a press on the card's text holds it open after the pointer has gone, and focus elsewhere closes it",
			runs.length === 2 && runs.every((r) => shown(r.textHeld) && !shown(r.focusElsewhere)),
			JSON.stringify(runs.map((r) => ({ width: r.width, held: shown(r.textHeld), elsewhere: shown(r.focusElsewhere) })))
		);
		check(
			"whole name: a click on Copy writes HWiNFO's name for the reading, says Copied and goes back to Copy, the button one width through it",
			runs.length === 2 &&
				runs.every((r) => shown(r.beforeCopy) && r.beforeCopy.card.label === "Copy" && same(r.copiedText, [copies[gpu], copies[gpu]]) && r.copied.card?.label === "Copied" && r.copyRested.card?.label === "Copy" && r.steppedText === copies[hot] && [r.copied, r.copyRested, r.again, r.fallback, r.failed].every((s) => s.card?.copyWidth === r.beforeCopy.card.copyWidth) && still(r.shut, r.copied)),
			JSON.stringify(runs.map((r) => ({ width: r.width, text: r.copiedText, stepped: r.steppedText, labels: [r.beforeCopy.card?.label, r.copied.card?.label, r.copyRested.card?.label], widths: [r.beforeCopy, r.copied, r.copyRested, r.again, r.fallback, r.failed].map((s) => s.card?.copyWidth) })))
		);
		check(
			"whole name: a second Copy press starts the confirmation over, and a refused clipboard call copies the same text as a selection, or says Copy failed when that is refused too",
			runs.length === 2 && runs.every((r) => r.again.card?.label === "Copied" && r.againRested.card?.label === "Copy" && r.fallback.card?.label === "Copied" && same(r.fallback.picked, [copies[hot]]) && r.failed.card?.label === "Copy failed" && same(r.failed.picked, [copies[hot], copies[hot]]) && r.failed.active === "head-copy"),
			JSON.stringify(runs.map((r) => ({ width: r.width, again: [r.again.card?.label, r.againRested.card?.label], fallback: [r.fallback.card?.label, r.fallback.picked], failed: [r.failed.card?.label, r.failed.picked.length, r.failed.active] })))
		);
		check(
			"whole name: a step with the card open changes its text in place, ends a Copy confirmation and moves nothing; a step to a pair that is not cut closes the card and takes the handle away, and the next cut pair brings the handle back with the card shut",
			runs.length === 2 &&
				runs.every((r) => r.beforeStep.card?.label === "Copied" && isWhole(r.stepped, hot) && r.stepped.card.label === "Copy" && still(r.shut, r.stepped)) &&
				uncut !== null &&
				isWhole(uncut.open, gpu) &&
				uncut.off.name === "CPU (Tctl/Tdie)" &&
				uncut.off.card === null &&
				uncut.off.handle === "class id" &&
				uncut.off.cursor !== "pointer" &&
				uncut.back.card === null &&
				uncut.back.handle === HANDLE &&
				uncut.back.expanded === "false" &&
				still(uncut.shut, uncut.open) &&
				still(uncut.shut, uncut.off) &&
				still(uncut.shut, uncut.back),
			JSON.stringify({ stepped: runs.map((r) => [r.beforeStep.card?.label, r.stepped.card]), off: uncut && [uncut.off.name, uncut.off.card, uncut.off.handle], back: uncut && [uncut.back.card, uncut.back.handle, uncut.back.expanded] })
		);
		check(
			"whole name: the handle follows the lines' width with no render and no resize event: gone with the face hidden, back with the face",
			uncut !== null && uncut.wide.handle === "class id" && uncut.wide.sourceRows <= 2.05 && uncut.wide.card === null && uncut.beside.handle === HANDLE && uncut.beside.sourceRows <= 3.05,
			JSON.stringify(uncut && { wide: [uncut.wide.handle, uncut.wide.sourceRows], beside: [uncut.beside.handle, uncut.beside.sourceRows] })
		);
		check(
			"whole name: the cut name is a button named by its whole text, with its open state; the card's two lines and Copy's spare labels are out of the accessibility tree, and Copy is named for what it copies",
			runs.length === 2 &&
				runs.every(
					(r) =>
						same(r.ax.handle, [{ ignored: false, role: "button", name: `Hot ${whole[hot][1]}`, expanded: true }]) &&
						r.ax.lines.length === 2 &&
						r.ax.lines.every((n) => n.ignored) &&
						same(r.ax.copy, [{ ignored: false, role: "button", name: "Copy the reading's name", expanded: null }]) &&
						r.ax.spare.length === 2 &&
						r.ax.spare.every((n) => n.ignored)
				),
			JSON.stringify(runs.map((r) => r.ax))
		);
		check(
			"whole name: in high contrast the card keeps an edge and text unlike its background, whole and inside the panel",
			runs.length === 2 && runs.every((r) => isWhole(r.forced, hot) && r.forced.card.colors[0] !== r.forced.card.colors[1] && r.forced.card.colors[2] !== r.forced.card.colors[1] && !shown(r.end)),
			JSON.stringify(runs.map((r) => r.forced.card))
		);
		check(
			"whole name: at 302, 252 and 189 px by 410 px the card opens whole and inside the panel, with no sideways scroll and nothing moved",
			narrow.length === 3 && narrow.every((n) => n.shut.handle === HANDLE && n.shut.card === null && isWhole(n.open, gpu) && still(n.shut, n.open)),
			JSON.stringify(narrow.map((n) => ({ width: n.width, handle: n.shut.handle, card: n.open.card, still: still(n.shut, n.open) })))
		);
		check(
			"whole name: a dial whose name and source line fit has no handle, and no card on a rest of the pointer, on Tab or on a click",
			short !== null && [short.rest, short.over, short.tabbed, short.clicked].every((s) => s.card === null && s.handle === "class id" && s.cursor !== "pointer" && s.active !== "head-lines" && s.shows === 0 && s.nameRows <= 2.05 && s.sourceRows <= 2.05),
			JSON.stringify(short && [short.rest, short.over, short.tabbed, short.clicked].map((s) => ({ card: s.card, handle: s.handle, cursor: s.cursor, active: s.active })))
		);
		// The share. "Context" is the reading's own label and the sensor's
		// name up to its second colon ("GPU [#0]: <chip>").
		const context = `GPU Hot Spot Temperature · ${longGpu.split(": ").slice(0, 2).join(": ")}`;
		const titledSteps = at410.filter((s) => s.key === hot);
		const share = (s) => ({ names: s.names, width: s.width, forced: s.forced, name: s.name, lines: [s.nameLines, s.sourceLines], room: s.room, head: s.head, pinned: s.pinned, moved: s.moved });
		const plain = shares.filter((s) => !s.forced && s.width !== 189);
		const other = shares.filter((s) => s.forced || s.width === 189);
		const ones = (rows) => rows.filter((s) => s.names === "one");
		const twos = (rows) => rows.filter((s) => s.names === "two");
		const three = (s) => s.nameLines === 1 && s.sourceLines === 3 && same(s.room, [1, 3]) && !s.moved;
		const two = (s) => s.nameLines <= 2 && s.sourceLines === 2 && same(s.room, [2, 2]) && !s.moved;
		check(
			"share: a titled dial with a long sensor name shows its source line on three lines, and the words shown reach past the reading's label and the sensor's name up to its second colon, at 373 and 378 px",
			titledSteps.length === 2 && titledSteps.every((s) => s.name === "Hot" && s.sourceLines === 3 && s.sourceShown.length >= context.length && whole[hot][1].startsWith(s.sourceShown)),
			JSON.stringify(titledSteps.map((s) => ({ width: s.width, lines: s.sourceLines, shown: s.sourceShown, wanted: context })))
		);
		check(
			"share: a rotation of one-line names gives every member three source lines and keeps the room of one name line over three, on every step at 373 and 378 px, pinned and under a third of the panel, and a step moves nothing",
			ones(plain).length === 8 && ones(plain).every((s) => three(s) && s.pinned && !s.tall),
			JSON.stringify(ones(plain).filter((s) => !(three(s) && s.pinned && !s.tall)).slice(0, 4).map(share))
		);
		check(
			"share: one two-line name among a rotation's members gives every member two source lines and keeps the room of two over two, on every step at 373 and 378 px, where the rotation of one-line names has three; a step moves nothing",
			twos(plain).length === 8 && twos(plain).every((s) => two(s) && s.pinned && !s.tall) && twos(plain).some((s) => s.nameLines === 2) && twos(plain).some((s) => s.nameLines === 1) && ones(plain).length === 8 && ones(plain).every(three),
			JSON.stringify([...twos(plain).filter((s) => !(two(s) && s.pinned && !s.tall)), ...ones(plain).filter((s) => !three(s))].slice(0, 4).map(share))
		);
		check(
			"share: in high contrast and at 189 px, where the text sits under the face, one-line names give three source lines and a two-line name among them two, on every step, and a step moves nothing",
			ones(other).length === 8 && twos(other).length === 8 && ones(other).every(three) && twos(other).every(two) && other.some((s) => s.forced) && other.some((s) => s.width === 189),
			JSON.stringify(other.filter((s) => !(s.names === "one" ? three(s) : two(s))).slice(0, 4).map(share))
		);
		const quiet = (s) => s.tall4 === 0 && s.late === 0 && s.loop === 0;
		const laid = (s) => [s.nameLines, s.sourceLines, ...s.room];
		const noise = (s) => ({ tall: s.tall4, late: s.late, loop: s.loop });
		check(
			"share: a width that wraps a name (378 to 252 px) takes the third source line away with no render, and 378 px gives it back, twice, and so does a column made narrower with no resize event; no frame paints more than four lines or a header height measured before the share, with no observer loop error, and a step moves nothing at either width",
			wrap !== null &&
				same(wrap.widths.map(laid), [[1, 3, 1, 3], [1, 2, 2, 2], [1, 3, 1, 3], [1, 2, 2, 2], [1, 3, 1, 3]]) &&
				wrap.moved === 0 &&
				same(laid(wrap.squeezed), [1, 2, 2, 2]) &&
				same(laid(wrap.eased), [1, 3, 1, 3]) &&
				wrap.eased.resizes === 0 &&
				quiet(wrap.eased),
			JSON.stringify(wrap && { lines: wrap.widths.map(laid), moved: wrap.moved, squeezed: laid(wrap.squeezed), eased: laid(wrap.eased), resizes: wrap.eased.resizes, ...noise(wrap.eased) })
		);
		check(
			"share: a two-line name written from outside the shell takes the third source line away before a frame paints five lines, and the next render gives it back",
			wrap !== null && wrap.outside.nameLines === 2 && wrap.outside.sourceLines === 2 && same(laid(wrap.back), [1, 3, 1, 3]) && quiet(wrap.back),
			JSON.stringify(wrap && { outside: laid(wrap.outside), back: laid(wrap.back), ...noise(wrap.back) })
		);
		check(
			'share: with a line height the browser gives as "normal" the share is told the same: three source lines at 378 px, two at 252 px, three back at 378 px',
			wrap !== null && wrap.normal.every((s) => s.lineHeight === "normal") && same(wrap.normal.map(laid), [[1, 3, 1, 3], [1, 2, 2, 2], [1, 3, 1, 3]]) && quiet(wrap.normal.at(-1)),
			JSON.stringify(wrap && { lineHeight: wrap.normal.map((s) => s.lineHeight), lines: wrap.normal.map(laid), ...noise(wrap.normal.at(-1)) })
		);
		check(
			"share: a source line whose three lines fit has no handle and no card on a rest of the pointer; one that does not fit has the handle, and the card shows it whole, at 373 and 378 px",
			fitting.length === 2 &&
				fitting.every(
					(f) =>
						f.rest.source === fitsGpu &&
						f.rest.sourceLines === 3 &&
						f.rest.sourceShown === fitsGpu &&
						f.rest.handle === "class id" &&
						f.over.card === null &&
						f.over.shows === 0 &&
						f.cut.sourceLines === 3 &&
						f.cut.sourceShown.length < f.cut.source.length &&
						f.cut.handle === HANDLE &&
						f.open.card !== null &&
						f.open.card.name === "Hot" &&
						f.open.card.source === `GPU Hot Spot Temperature · ${fitsGpu}` &&
						f.open.card.clipped === 0 &&
						f.open.card.inView &&
						still(f.cut, f.open)
				),
			JSON.stringify(fitting.map((f) => ({ width: f.width, rest: [f.rest.sourceLines, f.rest.sourceShown, f.rest.handle], over: f.over.card, cut: [f.cut.sourceLines, f.cut.sourceShown, f.cut.handle], open: f.open.card })))
		);
		check(
			"way to the card: at 40 px a second the card stays open all the way from the name's middle to the card's first words, and from the name's corner over the face, each with over 16 px (the card's 400 ms) on neither the name, the state line nor the card, at 373 and 378 px",
			ways.length === 2 && ways.every((w) => w.travels.length === 2 && w.travels.every((t) => t.opened && t.kept && t.shows === 0 && t.off > 16)),
			JSON.stringify(ways.map((w) => ({ width: w.width, travels: w.travels })))
		);
		check(
			"way to the card: a rest of the pointer on the face, the kind line and a fold button opens no card; with the card open each keeps it, a press on the fold button opens the sections and closes the card, and off the header and the card it closes after its wait",
			ways.length === 2 && ways.every((w) => w.idle.card === null && w.idle.shows === 0 && same(w.rests, [true, true, true]) && !w.pressed.card && w.pressed.sections[0] === 0 && w.pressed.sections[1] > 0 && w.folded === 0 && w.leave.onFace && w.leave.grace && w.leave.gone),
			JSON.stringify(ways.map((w) => ({ width: w.width, idle: [w.idle.card, w.idle.shows], rests: w.rests, pressed: w.pressed, folded: w.folded, leave: w.leave })))
		);
		check(
			"whole name: a name that comes to be cut under a pointer already resting on it opens the card after the wait, the pointer still",
			arrive !== null && arrive.resting.card === null && arrive.resting.handle === "class id" && isWhole(arrive.came, gpu) && arrive.came.expanded === "true",
			JSON.stringify(arrive && { resting: [arrive.resting.card, arrive.resting.handle], came: [arrive.came.card, arrive.came.handle, arrive.came.expanded] })
		);
		check("whole name: the card raised no page error", pageErrors.length === errorsBefore, pageErrors.slice(errorsBefore, errorsBefore + 3).join(" | "));
	}
	// A dial with its own title, on its first step. The step drops the
	// title (sensor-dial.ts adoptReading, unless the title is fixed), and
	// the titled pair is in no step list: its source line carries HWiNFO's
	// name, so it can be taller than every pair the steps bring. The block
	// keeps the tallest name over the tallest source line, not the tallest
	// pair. Here the rotation names a member ("Hot", whose source line then
	// carries its HWiNFO name, as the titled one does), so the header keeps
	// its height through that step: a two-line title over a source line of
	// three lines (four at 252 px), a rotation of a two-line name, the
	// named reading and a short one, at 378, 302, 252 and 189 px with every
	// fold shut. With no such member the header can shrink once on that
	// step, the title gone for good; that one move is left on purpose.
	{
		const snap = sampleSnapshot();
		const junction = keyOf(snap, 1, "GPU Memory Junction Temperature");
		const hot = keyOf(snap, 1, "GPU Hot Spot Temperature");
		const titled = { ...sim.fixtures["dial-configured"].settings, readingKey: junction, label: "Graphics card under the desk", rotationKeys: [junction, hot, sim.keys.gpu], rotationNames: { [hot]: "Hot" } };
		const LAYOUT = `(() => {
			const tops = {};
			for (const e of document.querySelectorAll('#reading-status, [id^="sec-"]')) if (e.getClientRects().length > 0) tops[e.id] = Math.round((e.getBoundingClientRect().top + scrollY) * 10) / 10;
			return { name: document.getElementById("head-reading").textContent, head: Math.round(document.getElementById("hw-head").getBoundingClientRect().height * 10) / 10, tops };
		})()`;
		const moves = [];
		const names = [];
		let wrote = 0;
		try {
			for (const width of [378, 302, 252, 189]) {
				await b.viewport(width, 900, 1);
				await open("dial-configured", { settings: titled });
				await b.evaluate(`document.querySelectorAll("details.hw-sec").forEach((d) => { d.open = false; })`);
				await sleep(150);
				const first = await b.evaluate(LAYOUT);
				names.push(first.name);
				const stepped = { ...titled };
				delete stepped.label;
				for (const key of [hot, sim.keys.gpu]) {
					sim.pushSettings({ ...stepped, readingKey: key });
					sim.pushPreview();
					await sleep(200);
					const now = await b.evaluate(LAYOUT);
					names.push(now.name);
					const moved = Object.keys({ ...first.tops, ...now.tops }).filter((id) => first.tops[id] !== now.tops[id]);
					if (now.head !== first.head || moved.length > 0) moves.push({ width, name: now.name, head: [first.head, now.head], moved: moved.length });
				}
				wrote += sim.writes.length + sim.globalWrites.length;
			}
		} finally {
			await b.viewport(400, 900, 1);
		}
		check("K1 (a titled dial whose rotation names a member): the first step drops the dial's title and the header keeps its height, no section moves, at 378, 302, 252 and 189 px, writing nothing", same(names.slice(0, 3), ["Graphics card under the desk", "Hot", "GPU Temperature"]) && moves.length === 0 && wrote === 0, JSON.stringify({ names: names.slice(0, 3), moves: moves.slice(0, 6), count: moves.length, wrote }));
	}
	// A dial whose saved reading is missing: no turn, group jump or auto
	// cycle step happens until HWiNFO publishes it again (sensor-dial.ts
	// advance and autoCycle hold), so the header keeps no room for other
	// names then and no blank gap opens under "Saved reading", at 378, 302,
	// 252 and 189 px and in high contrast. The cell's gap is its height
	// less the height of its shown lines alone. The room comes back with the
	// reading (HWiNFO publishes it again and the panel gets a new tree).
	{
		const junction = keyOf(sampleSnapshot(), 1, "GPU Memory Junction Temperature");
		const HEAD = `(() => {
			const gap = (shown) => {
				const cell = shown.parentElement;
				const others = [...cell.children].filter((e) => e !== shown);
				const full = cell.getBoundingClientRect().height;
				for (const e of others) e.style.display = "none";
				const alone = cell.getBoundingClientRect().height;
				for (const e of others) e.style.removeProperty("display");
				return Math.round((full - alone) * 100) / 100;
			};
			return {
				state: document.getElementById("head-state").textContent,
				gaps: [gap(document.getElementById("head-reading").parentElement)],
				unseen: [...document.querySelectorAll('#hw-head .hw-head-lines[aria-hidden="true"] :is(.hw-head-reading, .hw-head-source)')].map((e) => (e.classList.contains("hw-head-reading") ? "name: " : "source: ") + e.textContent).sort()
			};
		})()`;
		const snap = sampleSnapshot();
		const dropped = { ...snap, readings: snap.readings.filter((r) => r.key !== sim.keys.gpu), byKey: new Map([...snap.byKey].filter(([key]) => key !== sim.keys.gpu)) };
		const member = { ...sim.fixtures["dial-configured"].settings, readingKey: sim.keys.gpu, rotationKeys: [sim.keys.gpu, junction, sim.keys.gpuPower] };
		const missing = [];
		const back = [];
		let wrote = 0;
		try {
			for (const forced of [false, true]) {
				await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: forced ? "active" : "none" }] });
				for (const width of forced ? [378] : [378, 302, 252, 189]) {
					await b.viewport(width, 900, 1);
					await open("dial-missing");
					missing.push({ fixture: "dial-missing", width, forced, ...(await b.evaluate(HEAD)) });
					wrote += sim.writes.length + sim.globalWrites.length;
					await open("dial-configured", { settings: member, snapshot: dropped });
					missing.push({ fixture: "dropped member", width, forced, ...(await b.evaluate(HEAD)) });
					sim.snapshot = sampleSnapshot();
					sim.sendToPi(buildSensorTree(sim.status()));
					sim.pushPreview();
					await sleep(250);
					back.push({ width, forced, ...(await b.evaluate(HEAD)) });
					wrote += sim.writes.length + sim.globalWrites.length;
				}
			}
		} finally {
			await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "none" }] });
			await b.viewport(400, 900, 1);
		}
		const roomLines = ["name: GPU Memory Junction Temperature", "name: GPU Power", "name: GPU Temperature", "source: GPU [#0]: Example Graphics 24GB"];
		check("H3: while a dial's saved reading is missing its header keeps no room, so no blank gap opens under its lines, at 378, 302, 252 and 189 px and in high contrast, writing nothing", missing.every((m) => m.state === "Saved reading not found" && m.unseen.length === 0 && m.gaps.every((g) => g === 0)) && wrote === 0, JSON.stringify({ wrong: missing.filter((m) => m.state !== "Saved reading not found" || m.unseen.length > 0 || m.gaps.some((g) => g !== 0)).slice(0, 4), wrote }));
		check("H3: when the reading comes back the header keeps the room of every name the rotation brings again", back.every((m) => m.state === "Live · Shared Memory" && same(m.unseen, roomLines)), JSON.stringify(back.filter((m) => m.state !== "Live · Shared Memory" || !same(m.unseen, roomLines)).slice(0, 3)));
	}
	// Advanced > "Shared defaults" on the built-in defaults, at the width
	// the app lays a scrolling panel out at (373 px: its 378 px less the
	// scrollbar). Its line of five choices used to run onto a second line
	// there ("... · decimal data units"). The units now read "decimal
	// units" and the line takes one, on the key and the dial panel.
	// Looking writes nothing.
	{
		const ROW = `(() => {
			const el = document.querySelector('[data-summary="shared"]');
			const r = document.createRange();
			r.selectNodeContents(el);
			return { text: el.textContent, lines: new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size, shown: el.getClientRects().length > 0 };
		})()`;
		const got = [];
		let wrote = 0;
		try {
			for (const fixture of ["key-configured", "dial-configured"]) {
				await b.viewport(373, 900, 1);
				await open(fixture);
				await b.evaluate(`document.getElementById("sec-advanced").open = true`);
				await sleep(200);
				got.push({ fixture, ...(await b.evaluate(ROW)) });
				wrote += sim.writes.length + sim.globalWrites.length;
			}
		} finally {
			await b.viewport(400, 900, 1);
		}
		check('one line at 373 px: "Shared defaults" on the built-in defaults takes one line, on the key and the dial panel, writing nothing', got.every((g) => g.shown && g.text === "Void · theme text · Tahoma · accents by type · decimal units" && g.lines === 1) && wrote === 0, JSON.stringify({ rows: got, wrote }));
	}
	// The folded Reading line while a dial steps: it names the dial's
	// rotation ("Rotation: 3 readings") and never the reading on the dial,
	// which the header names two rows above. A step (the plugin's: the new
	// readingKey, then a preview) changes the header's name and leaves this
	// line's words as they are, so with every fold shut the line keeps its
	// height and no section moves, through a rotation set (at 378, 302, 252
	// and 189 px and in high contrast) and through a sensor's readings with
	// no set (at 378 and 189 px), writing nothing. The line keeps no unseen
	// room: it has one text.
	{
		const LAYOUT = `(() => {
			const tops = {};
			for (const e of document.querySelectorAll('#reading-status, [id^="sec-"]')) if (e.getClientRects().length > 0) tops[e.id] = Math.round((e.getBoundingClientRect().top + scrollY) * 10) / 10;
			const row = document.querySelector("#sec-reading > summary");
			return {
				text: row.querySelector('[data-summary="reading"]').textContent,
				head: document.getElementById("head-reading").textContent,
				row: Math.round(row.getBoundingClientRect().height * 10) / 10,
				unseen: row.querySelectorAll('[aria-hidden="true"]').length,
				tops
			};
		})()`;
		const snap = sampleSnapshot();
		const cpuSensor = snap.readings.filter((r) => r.sensorIndex === snap.byKey.get(sim.keys.cpu).sensorIndex).map((r) => r.key);
		const cases = [
			{ name: "a rotation set", fixture: "dial-configured", keys: sim.fixtures["dial-configured"].settings.rotationKeys, widths: [378, 302, 252, 189], forcedWidths: [302], line: "Rotation: 3 readings" },
			{ name: "a sensor's readings", fixture: "dial-custom-gestures", keys: cpuSensor, widths: [378, 189], forcedWidths: [], line: "Rotation: this sensor's readings" }
		];
		try {
			for (const { name, fixture, keys, widths, forcedWidths, line } of cases) {
				const moves = [];
				const seen = [];
				let wrote = 0;
				for (const forced of [false, true]) {
					if (forced && forcedWidths.length === 0) continue;
					await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: forced ? "active" : "none" }] });
					await b.viewport(378, 900, 1);
					await open(fixture);
					await b.evaluate(`document.querySelectorAll("details.hw-sec").forEach((d) => { d.open = false; })`);
					for (const width of forced ? forcedWidths : widths) {
						await b.viewport(width, 900, 1);
						let first = null;
						for (const key of [...keys, keys[0]]) {
							sim.pushSettings({ ...sim.settings, readingKey: key });
							sim.pushPreview();
							await sleep(150);
							const now = await b.evaluate(LAYOUT);
							seen.push(now);
							if (first === null) first = now;
							const moved = Object.keys({ ...first.tops, ...now.tops }).filter((id) => first.tops[id] !== now.tops[id]);
							if (now.row !== first.row || moved.length > 0) moves.push({ width, forced, head: now.head, row: [first.row, now.row], moved: moved.length });
						}
					}
					wrote += sim.writes.length + sim.globalWrites.length;
				}
				const texts = [...new Set(seen.map((s) => s.text))];
				const heads = new Set(seen.map((s) => s.head)).size;
				check(`Reading line (${name}): the folded line names the rotation and never the reading on the dial, the same words on every step`, same(texts, [line]) && heads === keys.length && seen.every((s) => s.unseen === 0), JSON.stringify({ want: line, texts, heads, steps: keys.length, unseen: seen.filter((s) => s.unseen > 0).length }));
				check(`Reading line (${name}): with every fold shut, a dial's step moves no section and keeps the Reading line's height, writing nothing`, moves.length === 0 && wrote === 0, JSON.stringify({ moves: moves.slice(0, 6), count: moves.length, wrote }));
			}
		} finally {
			await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "none" }] });
			await b.viewport(400, 900, 1);
		}
	}
	// A fold row every key and dial panel shows, at the width the app lays
	// a scrolling panel out at (373 px: its 378 px less the scrollbar):
	// "Unit and decimals per reading" with nothing set. Its summary used
	// to run onto a second line there ("Every reading follows Decimals").
	// It now reads "None set" on one line. Looking writes nothing.
	{
		const ROWS = `(() => {
			const lines = (el) => { const r = document.createRange(); r.selectNodeContents(el); return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size; };
			const el = document.querySelector('[data-summary="formats"]');
			return { formats: { text: el.textContent, lines: lines(el), shown: el.getClientRects().length > 0 } };
		})()`;
		const got = [];
		let wrote = 0;
		try {
			for (const fixture of ["key-configured", "dial-configured"]) {
				await b.viewport(373, 900, 1);
				await open(fixture);
				await b.evaluate(`document.getElementById("sec-display").open = true`);
				await sleep(200);
				got.push({ fixture, ...(await b.evaluate(ROWS)) });
				wrote += sim.writes.length + sim.globalWrites.length;
			}
		} finally {
			await b.viewport(400, 900, 1);
		}
		check('one line at 373 px: "Unit and decimals per reading" with nothing set reads "None set" on one line, on the key and the dial panel, writing nothing', got.every((g) => g.formats.shown && g.formats.text === "None set" && g.formats.lines === 1) && wrote === 0, JSON.stringify({ rows: got.map((g) => ({ fixture: g.fixture, ...g.formats })), wrote }));
	}
	// With groups, the editor starts on the reading on the dial wherever it
	// sits, and the toolbar sits under that reading's group.
	await open("dial-groups");
	const groupStart = await b.evaluate(`(() => { const sel = document.querySelector('#rotation-set [role="option"][aria-selected="true"]'); const tools = document.querySelector("#rotation-set .hw-set-tools"); return { key: sel?.dataset.key ?? null, group: sel?.dataset.group ?? null, toolsAfter: tools?.closest(".hw-set-tools-slot")?.dataset.group ?? null, selectedCount: document.querySelectorAll('#rotation-set [aria-selected="true"]').length }; })()`);
	check("T5: with groups, the reading on the dial starts selected in its own group, the toolbar under that group, one selection in all", groupStart.key === sim.settings.readingKey && groupStart.group === "1" && groupStart.toolsAfter === "1" && groupStart.selectedCount === 1 && sim.writes.length === 0, JSON.stringify(groupStart));
	// A real mouse press on a member of the OTHER group selects that member,
	// and nothing on screen moves while the button is down (design review,
	// 2026-09-25: the toolbar used to jump and the release hit Rename).
	const layoutOf = `JSON.stringify([...document.querySelectorAll('#rotation-set [role="option"]')].map((o) => Math.round(o.getBoundingClientRect().top + scrollY)))`;
	await b.click('#rotation-set .hw-set-list[data-group="0"] [role="option"]');
	await sleep(120);
	const beforeCross = await b.evaluate(layoutOf);
	const crossKey = await b.evaluate(`document.querySelectorAll('#rotation-set .hw-set-list[data-group="1"] [role="option"]')[1].dataset.key`);
	await b.click(`#rotation-set .hw-set-list[data-group="1"] [role="option"][data-key="${crossKey}"]`);
	await sleep(120);
	const cross = await b.evaluate(`({ selected: document.querySelector('#rotation-set [role="option"][aria-selected="true"]')?.dataset.key ?? null, layout: ${layoutOf}, renaming: document.getElementById("rot-rename") !== null })`);
	check("T5: a click in the other group selects the member clicked, and no member moves", cross.selected === crossKey && cross.layout === beforeCross && !cross.renaming && sim.writes.length === 0, JSON.stringify({ cross, beforeCross, crossKey }));
	await open("dial-configured");
	// Keyboard into FILTERED results: Down Arrow from a typed search lands on
	// the first result the filter left visible (a11y review, 2026-09-25).
	await b.evaluate(`document.getElementById("pickerr-search").focus()`);
	await sleep(80);
	await b.type("hot");
	await sleep(200);
	await b.key("ArrowDown");
	await sleep(80);
	const intoFiltered = await b.evaluate(`(() => { const a = document.activeElement; return { tick: a?.classList.contains("hw-tick") ?? false, visible: a !== null && a.closest("[hidden]") === null, key: a?.closest(".hw-row")?.dataset.key ?? null }; })()`);
	check("T5: Down Arrow from a typed search reaches the first visible result", intoFiltered.tick && intoFiltered.visible && intoFiltered.key === sim.keys.hot && sim.writes.length === 0, JSON.stringify(intoFiltered));
	// Delete in a group's list acts on that list only: focusing a list with
	// nothing selected in it selects its first member first.
	await open("dial-groups");
	const groupsBefore2 = structuredClone(sim.settings.rotationGroups);
	await b.evaluate(`document.querySelector('#rotation-set .hw-set-list[data-group="0"]').focus()`);
	await sleep(80);
	await b.key("Delete");
	await sleep(250);
	const afterDelete = lastWrite()?.rotationGroups;
	check("T5: Delete in group 1's list removes group 1's first member and leaves group 2 alone", same(afterDelete?.[0]?.keys, groupsBefore2[0].keys.slice(1)) && same(afterDelete?.[1], groupsBefore2[1]), JSON.stringify(afterDelete));
	// One press removes one reading: a held Delete, or Enter held on Remove,
	// removes only the selected reading, never the ones after it.
	const holdKey = async (key, on) => {
		await open("dial-configured");
		const before = structuredClone(sim.settings.rotationKeys);
		await b.evaluate(`document.querySelector('#rotation-set .hw-set-list').focus()`);
		await sleep(80);
		if (on !== null) await b.evaluate(`document.querySelector('${on}').focus()`);
		const info = key === "Delete" ? { key, code: "Delete", windowsVirtualKeyCode: 46 } : { key, code: "Enter", windowsVirtualKeyCode: 13, text: "\r" };
		const type = key === "Delete" ? "rawKeyDown" : "keyDown";
		await b.send("Input.dispatchKeyEvent", { type, ...info });
		for (let i = 0; i < 5; i++) await b.send("Input.dispatchKeyEvent", { type, ...info, autoRepeat: true });
		await b.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: info.code, windowsVirtualKeyCode: info.windowsVirtualKeyCode });
		await sleep(300);
		return { before, after: sim.settings.rotationKeys };
	};
	const heldDelete = await holdKey("Delete", null);
	check("rotation: a held Delete removes one reading", heldDelete.before.length === 3 && same(heldDelete.after, heldDelete.before.slice(1)), JSON.stringify(heldDelete));
	const heldEnter = await holdKey("Enter", '#rotation-set .hw-set-tools button[data-tool="remove"]');
	check("rotation: Enter held on Remove removes one reading", heldEnter.before.length === 3 && same(heldEnter.after, heldEnter.before.slice(1)), JSON.stringify(heldEnter));

	// Round 3 (R02, R12): a group holding readings needs a second press,
	// said in words; a double press only arms; leaving the button disarms;
	// the removal is one frame and focus never lands on another remove.
	await open("dial-groups");
	const groupsBefore3 = structuredClone(sim.settings.rotationGroups);
	const removeSel = '#rotation-set .hw-group-remove[data-group="0"]';
	await b.evaluate(`document.querySelector('${removeSel}').scrollIntoView({ block: "center" })`);
	await b.click(removeSel);
	await sleep(60);
	await b.click(removeSel);
	await sleep(300);
	const armedGroup = await b.evaluate(`(() => { const x = document.querySelector('${removeSel}'); return { armed: x?.dataset.armed ?? null, text: x?.textContent ?? "", label: x?.getAttribute("aria-label") ?? "", groups: document.querySelectorAll("#rotation-set .hw-group-head").length }; })()`);
	check("groups: a double press on a group's remove only arms it, in words, and writes nothing", armedGroup.armed === "true" && armedGroup.text === "Remove CPU and its 2 readings?" && armedGroup.label === "Remove CPU and its 2 readings? Press again to remove it." && armedGroup.groups === 2 && sim.writes.length === 0, JSON.stringify({ armedGroup, ...writes() }));
	await b.evaluate(`document.activeElement?.blur()`);
	await sleep(150);
	const disarmed = await b.evaluate(`(() => { const x = document.querySelector('${removeSel}'); return { armed: x?.dataset.armed ?? null, text: x?.textContent ?? "" }; })()`);
	check("groups: leaving an armed remove disarms it", disarmed.armed !== "true" && disarmed.text === "×" && sim.writes.length === 0, JSON.stringify(disarmed));
	await b.click(removeSel);
	await sleep(600);
	await b.click(removeSel);
	await sleep(300);
	const removedGroup = await b.evaluate(`(() => { const a = document.activeElement; return { groups: document.querySelectorAll("#rotation-set .hw-group-head").length, onRemove: a?.classList.contains("hw-group-remove") ?? false, focus: a?.className || a?.tagName }; })()`);
	check("groups: the second press removes exactly that group in one frame, and focus is on no remove button", sim.writes.length === 1 && same(sim.settings.rotationGroups, [groupsBefore3[1]]) && !removedGroup.onRemove && removedGroup.focus !== "BODY", JSON.stringify({ removedGroup, ...writes(), groups: sim.settings.rotationGroups }));
	await open("dial-groups");
	await rotationTool("later", { group: 1, index: 0 });
	await sleep(300);
	check("groups: a reorder inside a group is exactly one frame carrying both fields", sim.writes.length === 1 && Array.isArray(sim.writes[0].rotationGroups) && Array.isArray(sim.writes[0].rotationKeys), JSON.stringify(writes()));
	// Earlier and Later are built for chained presses: the page follows the
	// moved reading so the pressed button stays under the pointer, and each
	// quick press of one gesture (Chromium counts them 1, 2, 3) moves that
	// same reading on, into the next group at a group's edge.
	{
		const [g0, g1] = sim.fixtures["dial-groups"].settings.rotationGroups.map((g) => g.keys);
		const [cpu, ccd1] = g0;
		const [gpu, hot] = g1;
		const tools = '#rotation-set .hw-set-tools button[data-tool="TOOL"]';
		const centerOf = (selector) => b.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
		const groupsNow = () => (lastWrite()?.rotationGroups ?? []).map((g) => g.keys);
		for (const [tool, member, want] of [
			["later", `#rotation-set .hw-set-list[data-group="0"] [role="option"][data-key="${cpu}"]`, [[ccd1], [gpu, cpu, hot]]],
			["earlier", `#rotation-set .hw-set-list[data-group="1"] [role="option"][data-key="${hot}"]`, [[cpu, hot, ccd1], [gpu]]]
		]) {
			await open("dial-groups");
			await b.evaluate(`document.querySelectorAll("details").forEach((d) => { d.open = true; })`);
			await sleep(150);
			await b.click(member);
			await sleep(150);
			await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 898 });
			await sleep(600);
			const w0 = sim.writes.length;
			const p = await centerOf(tools.replace("TOOL", tool));
			await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
			for (let clickCount = 1; clickCount <= 3; clickCount++) {
				await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount });
				await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount });
				await sleep(300);
			}
			await sleep(300);
			check(`rotation: three quick presses on ${tool === "later" ? "Later" : "Earlier"} (300 ms apart, counted 1, 2, 3) move the same reading three places, across the group's edge`, sim.writes.length === w0 + 3 && same(groupsNow(), want), JSON.stringify({ writes: sim.writes.length - w0, groups: groupsNow() }));
		}
		// A tap on Earlier, then a tap on Later beside it: two presses on two
		// buttons 10 px apart, though Chromium counts the second tap 2.
		await open("dial-groups");
		await b.evaluate(`document.querySelectorAll("details").forEach((d) => { d.open = true; })`);
		await sleep(150);
		await b.click(`#rotation-set .hw-set-list[data-group="0"] [role="option"][data-key="${ccd1}"]`);
		await sleep(600);
		await b.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
		const facing = JSON.parse(await b.evaluate(`JSON.stringify((() => { const a = document.querySelector('${tools.replace("TOOL", "earlier")}'); const z = document.querySelector('${tools.replace("TOOL", "later")}'); a.scrollIntoView({ block: "center" }); const ra = a.getBoundingClientRect(); const rz = z.getBoundingClientRect(); return { a: { x: Math.round(ra.right - 3), y: Math.round(ra.top + ra.height / 2) }, z: { x: Math.round(rz.left + 3), y: Math.round(rz.top + rz.height / 2) } }; })())`));
		const w0 = sim.writes.length;
		const clicks = [];
		await b.evaluate(`window.__taps = []; window.addEventListener("click", (ev) => window.__taps.push(ev.detail), true)`);
		for (const at of [facing.a, facing.z]) {
			await b.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: at.x, y: at.y }] });
			await sleep(40);
			await b.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
			await sleep(200);
		}
		await sleep(400);
		clicks.push(...(await b.evaluate("window.__taps")));
		await b.send("Emulation.setTouchEmulationEnabled", { enabled: false });
		check("rotation (touch): a tap on Earlier, then a tap on Later 10 px away 200 ms later, presses both: two moves, the reading back in its place", sim.writes.length === w0 + 2 && same(groupsNow(), [g0, g1]), JSON.stringify({ writes: sim.writes.length - w0, apart: Math.round(Math.hypot(facing.z.x - facing.a.x, facing.z.y - facing.a.y)), clicks, groups: groupsNow() }));
	}
	// A double click on a reading in the dial's reading list (the app's 378
	// by 410 px panel): the first click picks it and the list closes; the
	// rotation list's search slides under the pointer, and the second click
	// takes no focus there and opens no list.
	{
		await b.viewport(378, 410);
		await open("dial-configured");
		await b.click("#picker-search");
		await sleep(250);
		const p = await b.evaluate(`(() => { const el = document.querySelector("#p1-1"); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), key: el.dataset.key }; })()`);
		await sleep(100);
		const w0 = sim.writes.length;
		await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
		for (const clickCount of [1, 2]) {
			await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount });
			await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount });
			if (clickCount === 1) await sleep(120);
		}
		await sleep(500);
		const after = await b.evaluate(`({ focus: document.activeElement?.id ?? null, rotationList: !document.getElementById("pickerr-list").hidden, under: document.elementFromPoint(${p.x}, ${p.y})?.id || null })`);
		await b.viewport(400, 900);
		check("double click (a reading in the dial's reading list): it picks that reading once; the rotation list's search, under the pointer after, takes no focus and opens no list", sim.writes.length === w0 + 1 && lastWrite()?.readingKey === p.key && after.focus !== "pickerr-search" && !after.rotationList, JSON.stringify({ writes: sim.writes.length - w0, reading: lastWrite()?.readingKey, want: p.key, ...after }));
	}
	// The same double click lower in the list, the list opened by a click
	// on its search at the top of the page: as the list closes, a rotation
	// member slides under the pointer, and the second click selects it not,
	// nor renames it.
	{
		await b.viewport(378, 410);
		await open("dial-configured");
		await b.evaluate(`document.getElementById("picker-search").scrollIntoView({ block: "start" })`);
		await sleep(100);
		const s0 = await b.evaluate(`(() => { const r = document.getElementById("picker-search").getBoundingClientRect(); return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) }; })()`);
		await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: s0.x, y: s0.y });
		await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: s0.x, y: s0.y, button: "left", clickCount: 1 });
		await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: s0.x, y: s0.y, button: "left", clickCount: 1 });
		await sleep(400);
		const p = await b.evaluate(`(() => { const list = document.getElementById("picker-list"); const lb = list.getBoundingClientRect(); const rows = [...list.querySelectorAll('[role="option"][data-key]')].filter((r) => { const b = r.getBoundingClientRect(); return b.height > 0 && b.top >= Math.max(0, lb.top) && b.bottom <= Math.min(innerHeight, lb.bottom); }); const row = rows[Math.floor(rows.length / 2)]; const r = row.getBoundingClientRect(); return { x: Math.round(r.left + Math.min(40, r.width / 2)), y: Math.round(r.top + r.height / 2), key: row.dataset.key }; })()`);
		const member = () => b.evaluate(`({ selected: document.querySelector('#rotation-set [role="option"][aria-selected="true"]')?.dataset.key ?? null, renaming: document.querySelector("#rotation-set input.hw-chip-rename") !== null })`);
		const w0 = sim.writes.length;
		await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
		await sleep(60);
		await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
		await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
		await sleep(40);
		const under = await b.evaluate(`document.elementFromPoint(${p.x}, ${p.y})?.closest('[role="option"]')?.dataset.key ?? null`);
		const picked = await member();
		await sleep(80);
		await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 2 });
		await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 2 });
		await sleep(500);
		const after = { under, picked, now: await member(), focus: await b.evaluate("document.activeElement?.id || document.activeElement?.className || null") };
		await b.viewport(400, 900);
		check("double click (a reading lower in the dial's reading list): it picks that reading once; the rotation member under the pointer after takes no press: not selected, not renamed", sim.writes.length === w0 + 1 && lastWrite()?.readingKey === p.key && under !== null && under !== p.key && after.now.selected === picked.selected && !after.now.renaming, JSON.stringify({ writes: sim.writes.length - w0, reading: lastWrite()?.readingKey, want: p.key, ...after }));
	}
	await open("dial-configured");
	await b.evaluate(`document.getElementById("sec-reading").open = true`);
	await b.evaluate(`document.querySelector('#rotation-set button[data-set-action="split"]').scrollIntoView({ block: "center" })`);
	await b.click('#rotation-set button[data-set-action="split"]');
	await sleep(350);
	const afterSplit = await b.evaluate(`({ listOpen: !document.getElementById("pickerr-list").hidden, group: document.activeElement?.dataset?.group ?? null, name: document.activeElement?.classList.contains("hw-group-name") ?? false })`);
	check("groups: Split focuses the new group's name and opens no checklist", !afterSplit.listOpen && afterSplit.group === "1" && afterSplit.name, JSON.stringify(afterSplit));

	// Round 3 (R03, R08): names the panel commits itself are saved by the
	// same leave flush as bound fields (the pointer leaving the panel), once,
	// without taking the caret; Enter keeps focus where the person was.
	const leavePanel = () => b.evaluate(`document.documentElement.dispatchEvent(new MouseEvent("mouseleave"))`);
	await open("dial-groups");
	await b.evaluate(`(() => { const f = document.querySelector('#rotation-set .hw-group-name[data-group="1"]'); f.scrollIntoView({ block: "center" }); f.focus(); f.select(); })()`);
	await b.type("Graphics");
	await sleep(120);
	await leavePanel();
	await sleep(250);
	const afterLeave = await b.evaluate(`({ group: document.activeElement?.dataset?.group ?? null, name: document.activeElement?.classList.contains("hw-group-name") ?? false })`);
	check("names: a group name typed but not committed is saved when the pointer leaves, once, and keeps focus", sim.writes.length === 1 && sim.writes[0].rotationGroups?.[1]?.name === "Graphics" && afterLeave.group === "1" && afterLeave.name, JSON.stringify({ afterLeave, ...writes(), name: sim.writes[0]?.rotationGroups?.[1]?.name }));
	await b.key("Enter");
	await sleep(300);
	const afterGroupEnter = await b.evaluate(`({ group: document.activeElement?.dataset?.group ?? null, name: document.activeElement?.classList.contains("hw-group-name") ?? false })`);
	check("names: Enter after that writes nothing more and keeps focus on the group's name", sim.writes.length === 1 && afterGroupEnter.group === "1" && afterGroupEnter.name, JSON.stringify({ afterGroupEnter, ...writes() }));
	await open("dial-configured");
	await rotationTool("rename", { index: 1 });
	await sleep(150);
	await b.evaluate(`(() => { const f = document.getElementById("rot-rename"); f.focus(); f.select(); })()`);
	await b.type("Spot");
	await sleep(120);
	await leavePanel();
	await sleep(250);
	check("names: a rotation name typed but not committed is saved when the pointer leaves, once", sim.writes.length === 1 && Object.values(sim.writes[0].rotationNames ?? {}).includes("Spot") && (await b.evaluate(`document.activeElement?.id`)) === "rot-rename", JSON.stringify({ ...writes(), names: sim.writes[0]?.rotationNames }));
	await open("key-details");
	await b.evaluate(`document.getElementById("sec-interaction").open = true`);
	await sleep(150);
	const cellKey = await b.evaluate(`(() => { const n = document.querySelector('#detail-list .hw-set-chip[data-key] .hw-set-name[role="button"]'); const key = n.closest(".hw-set-chip").dataset.key; n.scrollIntoView({ block: "center" }); n.click(); return key; })()`);
	await sleep(200);
	await b.evaluate(`(() => { const f = document.querySelector("#detail-list .hw-cell-rename"); f.focus(); f.select(); })()`);
	await b.type("Zq");
	await sleep(120);
	await leavePanel();
	await sleep(250);
	check("names: a detail cell label typed but not committed is saved when the pointer leaves, once", sim.writes.length === 1 && JSON.stringify(sim.writes[0].detailTiles ?? []).includes("Zq"), JSON.stringify({ ...writes(), tiles: sim.writes[0]?.detailTiles }));
	await b.key("Enter");
	await sleep(350);
	const afterCellEnter = await b.evaluate(`({ key: document.activeElement?.closest(".hw-set-chip")?.dataset.key ?? null, isName: document.activeElement?.matches('.hw-set-name[role="button"]') ?? false })`);
	check("names: Enter on a cell label writes nothing more and returns focus to that cell's name", sim.writes.length === 1 && afterCellEnter.key === cellKey && afterCellEnter.isName, JSON.stringify({ afterCellEnter, cellKey, ...writes() }));

	// Round 3 (R09): replacing the shared settings stays armed until the
	// person leaves the button (no five-second window), and a double press
	// only arms.
	await open("key-configured");
	await b.evaluate(`(() => { document.getElementById("sec-advanced").open = true; document.getElementById("sec-config").open = true; document.getElementById("config-deck").value = ${JSON.stringify(JSON.stringify({ theme: "void", typeAccents: "on" }))}; document.getElementById("config-deck-apply").scrollIntoView({ block: "center" }); document.getElementById("config-deck").dispatchEvent(new Event("input", { bubbles: true })); })()`);
	await sleep(150);
	await b.click("#config-deck-apply");
	await sleep(60);
	await b.click("#config-deck-apply");
	await sleep(250);
	const armedReplace = await b.evaluate(`document.getElementById("config-deck-apply").dataset.armed`);
	check("replace: a double press on Replace shared settings only arms it", armedReplace === "true" && sim.globalWrites.length === 0, JSON.stringify({ armedReplace, ...writes() }));
	// The armed Replace wears the danger style the armed removes copy.
	const armedLook = await b.evaluate(`(() => { const probe = document.createElement("div"); probe.style.background = "var(--hw-danger-bg)"; document.body.append(probe); const danger = getComputedStyle(probe).backgroundColor; probe.remove(); return { danger, button: getComputedStyle(document.getElementById("config-deck-apply")).backgroundColor }; })()`);
	check("replace: the armed Replace shared settings turns the danger color", armedLook.button === armedLook.danger, JSON.stringify(armedLook));
	await sleep(5500);
	await b.click("#config-deck-apply");
	await sleep(250);
	check("replace: still armed after 5.5 s, the next press replaces the shared settings once", sim.globalWrites.length === 1, JSON.stringify(writes()));
	await open("dial-configured");
	// The rotation checklist ticks membership without changing the reading.
	await b.evaluate(`document.getElementById("pickerr-search").focus()`);
	await sleep(100);
	await b.evaluate(`document.querySelector('#pickerr-list .hw-row[data-key="${sim.keys.cpu}"] .hw-tick').click()`);
	await sleep(250);
	w = lastWrite();
	check("T5: ticking adds to the rotation, the dial's reading unchanged", w?.rotationKeys?.includes(sim.keys.cpu) && w?.readingKey === sim.keys.gpu, JSON.stringify({ keys: w?.rotationKeys, reading: w?.readingKey }));

	await open("key-configured");
	await b.evaluate(`document.getElementById("f-label").focus()`);
	await b.send("Input.imeSetComposition", { text: "にほ", selectionStart: 2, selectionEnd: 2 });
	await sleep(450);
	check("IME: nothing is saved mid-composition", sim.writes.length === 0, JSON.stringify(writes()));
	await b.send("Input.insertText", { text: "日本" });
	await sleep(450);
	check("IME: the committed text saves once composed", lastWrite()?.label === "日本", JSON.stringify(lastWrite()?.label));

	// A checklist is one Tab stop: Down Arrow enters, arrows move, Tab leaves.
	await open("dial-configured");
	await b.evaluate(`document.getElementById("pickerr-search").focus()`);
	await sleep(150);
	await b.key("Tab");
	const leftList = await b.evaluate(`({ inList: document.getElementById("pickerr-list").contains(document.activeElement), tag: document.activeElement.tagName + "#" + document.activeElement.id })`);
	check("keyboard: Tab leaves the rotation checklist in one step", !leftList.inList, JSON.stringify(leftList));
	await b.evaluate(`document.getElementById("pickerr-search").focus()`);
	await sleep(150);
	await b.key("ArrowDown");
	await b.key("ArrowDown");
	const insideList = await b.evaluate(`({ inList: document.getElementById("pickerr-list").contains(document.activeElement), label: document.activeElement.getAttribute("aria-label") })`);
	check("keyboard: arrows move inside the checklist and each box names its source", insideList.inList && /, /.test(insideList.label ?? ""), JSON.stringify(insideList));
	noWrites("keyboard: moving through the checklist");

	// The theme gallery is one radio group: one Tab stop, arrows pick.
	await open("key-configured");
	const chipIds = await b.evaluate(`[...document.querySelectorAll("#theme-gallery .hw-theme")].map((c) => c.dataset.theme)`);
	const stops = await b.evaluate(`[...document.querySelectorAll("#theme-gallery .hw-theme")].filter((c) => c.tabIndex === 0).map((c) => c.dataset.theme + ":" + c.getAttribute("aria-checked"))`);
	check("theme gallery: a radio group with one Tab stop, on the checked chip", (await b.evaluate(`document.getElementById("theme-gallery").getAttribute("role")`)) === "radiogroup" && same(stops, [`${sim.settings.theme ?? ""}:true`]), JSON.stringify(stops));
	await b.evaluate(`document.querySelector('#theme-gallery .hw-theme[tabindex="0"]').focus()`);
	const startAt = chipIds.indexOf(sim.settings.theme ?? "");
	await b.key("ArrowRight");
	await sleep(200);
	const afterArrow = await b.evaluate(`({ focused: document.activeElement.dataset.theme, checked: document.querySelector('#theme-gallery [aria-checked="true"]')?.dataset.theme })`);
	const expectedNext = chipIds[(startAt + 1) % chipIds.length];
	check("theme gallery: ArrowRight moves focus and picks the next theme, one write", lastWrite()?.theme === expectedNext && sim.writes.length === 1 && afterArrow.focused === expectedNext && afterArrow.checked === expectedNext, JSON.stringify({ afterArrow, wrote: lastWrite()?.theme, n: sim.writes.length }));
	await b.key("Home");
	await sleep(200);
	check("theme gallery: Home returns to Default (follow the shared theme)", lastWrite()?.theme === "" && sim.writes.length === 2 && (await b.evaluate(`document.activeElement.dataset.theme`)) === "", JSON.stringify({ wrote: lastWrite()?.theme, n: sim.writes.length }));
	await open("key-configured", { settings: { ...sim.settings, theme: "neon-future" } });
	const unknownStops = await b.evaluate(`[...document.querySelectorAll("#theme-gallery .hw-theme")].filter((c) => c.tabIndex === 0).map((c) => c.dataset.theme)`);
	check("theme gallery: an unknown stored theme checks no chip, Default holds the Tab stop, nothing is written", same(unknownStops, [""]) && (await b.evaluate(`document.querySelectorAll('#theme-gallery [aria-checked="true"]').length`)) === 0 && sim.writes.length === 0, JSON.stringify(unknownStops));
	const unknownBand = await b.evaluate(`({ current: document.getElementById("theme-current").textContent, help: document.getElementById("theme-help").textContent })`);
	check("theme band: an unknown stored theme is named with what it draws, and the help says it is kept", unknownBand.current === '"neon-future" (unknown; draws Void)' && unknownBand.help === "This version does not know that theme; the key keeps it stored until you pick one.", JSON.stringify(unknownBand));

	// The simulator hands fixture text to the panel as data: a label holding
	// a closing script tag and the two JavaScript line separators runs
	// nothing and arrives exactly (external review AX52).
	{
		const label = "</script><script>window.__injected = 1</script>\u2028\u2029 <!-- $$ $& $` $' end";
		const errorsBefore = pageErrors.length;
		let seen;
		try {
			await open("key-configured", { settings: { ...sim.fixtures["key-configured"].settings, label } });
			seen = await b.evaluate(`({ injected: window.__injected ?? null, label: window.__hwPanel?.settings?.label ?? null, context: window.__hwPanel?.context ?? "" })`);
		} catch (err) {
			seen = { error: String(err) };
		}
		check("simulator: fixture text reaches the panel as data, exactly, and runs nothing", seen.injected === null && seen.label === label && seen.context !== "" && pageErrors.length === errorsBefore, JSON.stringify({ ...seen, errors: pageErrors.slice(errorsBefore) }));
	}

	// Presses whose release never reached the window leave no release
	// listener behind once the half-second ceiling passes (external review
	// AX56); the list still answers a normal press afterwards.
	{
		await open("key-details");
		await b.evaluate(`document.getElementById("sec-interaction").open = true`);
		await sleep(150);
		const left = await b.evaluate(`(async () => {
			const held = new Set();
			const add = window.addEventListener.bind(window);
			const remove = window.removeEventListener.bind(window);
			window.addEventListener = (type, fn, opts) => { if (type === "mouseup") held.add(fn); return add(type, fn, opts); };
			window.removeEventListener = (type, fn, opts) => { if (type === "mouseup") held.delete(fn); return remove(type, fn, opts); };
			const chip = document.querySelector("#detail-list .hw-set-chip");
			for (let i = 0; i < 10; i++) chip.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			await new Promise((resolve) => setTimeout(resolve, 600));
			return held.size;
		})()`);
		await b.evaluate(`document.querySelector("#detail-list .hw-set-chip .hw-set-remove").scrollIntoView({ block: "center" })`);
		await b.click("#detail-list .hw-set-chip .hw-set-remove");
		await sleep(400);
		check("details: ten presses whose release never came leave no release listener, and the next press still edits once", left === 0 && sim.writes.length === 1, JSON.stringify({ left, ...writes() }));
	}

	// A release takes its press's half-second ceiling down with it, so a
	// quick press cannot end the press after it: an edit made inside the
	// second press repaints on that press's own release, not before.
	{
		await open("key-details");
		await b.evaluate(`document.getElementById("sec-interaction").open = true`);
		await sleep(150);
		const seen = await b.evaluate(`(async () => {
			const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
			const list = document.getElementById("detail-list");
			const note = () => list.querySelector(".hw-set-note")?.textContent ?? "";
			list.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			window.dispatchEvent(new MouseEvent("mouseup"));
			await wait(300);
			const before = note();
			const remove = list.querySelector(".hw-set-chip .hw-set-remove");
			remove.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 1 }));
			remove.click();
			await wait(350);
			const held = note();
			window.dispatchEvent(new MouseEvent("mouseup"));
			await wait(100);
			return { before, held, released: note() };
		})()`);
		check("details: a quick press's ceiling does not end the press after it; that press's edit repaints on its own release", seen.before !== "" && seen.held === seen.before && seen.released !== seen.before && sim.writes.length === 1, JSON.stringify({ ...seen, ...writes() }));
	}

	// A themes message the gallery cannot draw is ignored whole: no page
	// error, the last good chips stay, and a good message after it still
	// draws (external review AX51).
	{
		await open("key-configured");
		const chips = () => b.evaluate(`[...document.querySelectorAll("#theme-gallery .hw-theme")].map((c) => c.dataset.theme + "|" + c.querySelector(".hw-theme-face").style.background)`);
		const before = await chips();
		const errorsBefore = pageErrors.length;
		const good = JSON.parse(JSON.stringify(buildThemesPayload()));
		const voidTheme = good.themes[good.defaultTheme];
		const bad = [
			{ ...good, themes: { [good.defaultTheme]: null }, themeOrder: [good.defaultTheme] },
			{ ...good, defaultTheme: "absent" },
			{ ...good, defaultTheme: "__proto__" },
			{ ...good, themes: [voidTheme] },
			{ ...good, themes: null },
			{ ...good, themes: { "": voidTheme, ...good.themes } },
			{ ...good, themes: { ...good.themes, [good.defaultTheme]: { ...voidTheme, bg: 7 } } },
			{ ...good, themes: { ...good.themes, [good.defaultTheme]: { ...voidTheme, bg: "url(https://example.invalid/x.png)" } } }
		];
		for (const payload of bad) sim.sendToPi(payload);
		await sleep(300);
		const kept = await chips();
		check("themes: a message the gallery cannot draw is ignored whole, with no page error", before.length > 1 && same(kept, before) && pageErrors.length === errorsBefore, JSON.stringify({ kept: kept.length, before: before.length, errors: pageErrors.slice(errorsBefore) }));
		sim.sendToPi({ ...good, themes: { ...good.themes, [good.defaultTheme]: { ...voidTheme, bg: "#010203" } } });
		await sleep(300);
		const redrawn = await chips();
		check("themes: a good message after them still draws", redrawn.some((c) => c.startsWith(`${good.defaultTheme}|`) && c.includes("rgb(1, 2, 3)")), JSON.stringify(redrawn));
	}
	// With no shared theme stored, the gallery names the plugin's resolved
	// deck theme: one that is not a string is ignored whole, and a good one
	// after it still names its theme (external review AX60).
	{
		await open("key-empty");
		const good = JSON.parse(JSON.stringify(buildThemesPayload()));
		const current = () => b.evaluate(`document.getElementById("theme-current")?.textContent ?? ""`);
		const before = await current();
		const errorsBefore = pageErrors.length;
		for (const effectiveDeckTheme of [{ toString: null }, { toString: 0, valueOf: 0 }, 17, null]) sim.sendToPi({ ...good, effectiveDeckTheme });
		await sleep(300);
		const kept = await current();
		check("themes: a resolved deck theme that is not a string is ignored whole, with no page error", before !== "" && kept === before && pageErrors.length === errorsBefore, JSON.stringify({ before, kept, errors: pageErrors.slice(errorsBefore) }));
		const other = Object.keys(good.themes).find((id) => id !== good.effectiveDeckTheme);
		const otherName = await b.evaluate(`hwModel.themeName(${JSON.stringify(other)})`);
		sim.sendToPi({ ...good, effectiveDeckTheme: other });
		await sleep(300);
		const after = await current();
		check("themes: a good resolved deck theme after them is named", after.includes(otherName) && !before.includes(otherName), JSON.stringify({ before, after, otherName }));
	}

	// ---- round 3: what the rotation editor says about its members -----------
	{
		const K = sim.keys;
		const dialFx = sim.fixtures["dial-configured"];
		// R05: a member HWiNFO no longer lists wears a visible pill, and the
		// note counts only what the dial steps through.
		const gone = "f00dead0:0:1000001";
		await open("dial-configured", { settings: { ...dialFx.settings, rotationKeys: [K.gpu, gone, K.hot] } });
		const miss = await b.evaluate(`(() => { const o = document.querySelector('#rotation-set [role="option"][data-key="${gone}"]'); const pill = o?.querySelector(".hw-chip-missing"); return { pill: pill?.textContent ?? null, shown: pill !== null && pill !== undefined && pill.getClientRects().length > 0, name: o?.textContent ?? null, note: document.querySelector("#rotation-set .hw-set-note")?.textContent ?? null }; })()`);
		check("R05: a member HWiNFO does not list shows a visible 'missing' pill, and the note counts the two the dial steps through", miss.pill === "missing" && miss.shown && miss.note === "Rotation moves through 2 of these 3 readings, in this order; the missing one is skipped until HWiNFO lists it again." && sim.writes.length === 0, JSON.stringify(miss));
		// R07: two drives' "Drive Temperature" are told apart on the chip,
		// in the toolbar's names and in what is spoken.
		await open("dial-configured", { settings: { ...dialFx.settings, readingKey: K.drive0, rotationKeys: [K.drive0, K.drive1, K.cpu] } });
		const twins = await b.evaluate(`(() => { const tag = (k) => document.querySelector('#rotation-set [role="option"][data-key="' + k + '"] .hw-chip-source')?.textContent ?? null; return { a: tag(${JSON.stringify(K.drive0)}), b: tag(${JSON.stringify(K.drive1)}), cpu: tag(${JSON.stringify(K.cpu)}), remove: document.querySelector('#rotation-set .hw-set-tools button[data-tool="remove"]')?.getAttribute("aria-label") ?? null }; })()`);
		check("R07: same-named readings carry their sensor's mark (#0, #1) and the toolbar names the sensor; a unique name carries none", twins.a === "#0" && twins.b === "#1" && twins.cpu === null && /^Remove Drive Temperature from Drive \[#0\]/.test(twins.remove ?? ""), JSON.stringify(twins));
		// R18: the reading on the dial outside the set: the panel says the
		// next step leaves it and where it goes.
		await open("dial-configured", { settings: { ...dialFx.settings, readingKey: K.cpu, rotationKeys: [K.gpu, K.hot] } });
		await sleep(150);
		const outside = await b.evaluate(`(() => { const el = document.getElementById("rotation-outside"); return { text: el.textContent, shown: !el.hidden }; })()`);
		check("R18: with the dial's reading outside the rotation, one line says the next step moves to the first member and does not come back", outside.shown && /is on the dial but not in this rotation; the next step moves to GPU Temperature and does not come back\.$/.test(outside.text), JSON.stringify(outside));
		await open("dial-configured");
		await sleep(150);
		check("R18: a member on the dial shows no such line", await b.evaluate(`document.getElementById("rotation-outside").hidden`));
		// R29: the picker's help names what moves the dial from the effective
		// map: Legacy turns, Elite turns and pressed turns; Ignore turns says so.
		const movesLegacy = await b.evaluate(`document.getElementById("picker-moves").textContent`);
		await open("dial-configured", { settings: { ...dialFx.settings, controlPreset: "elite" } });
		await sleep(150);
		const movesElite = await b.evaluate(`document.getElementById("picker-moves").textContent`);
		await open("dial-configured", { settings: { ...dialFx.settings, rotationDisabled: true } });
		await sleep(150);
		const movesOff = await b.evaluate(`document.getElementById("picker-moves").textContent`);
		check("R29: the picker help says what changes the reading from the effective map", movesLegacy === "Turns change this too." && movesElite === "Turns and pressed turns change this too." && movesOff === "Turns are ignored here.", JSON.stringify({ movesLegacy, movesElite, movesOff }));
		// Owner's review, 2026-09-26: the Rotation heading sat as far from the
		// field it heads as from the help line above it, so the three lines
		// read as loose rows. The heading now sits against its field.
		await open("dial-configured");
		await sleep(150);
		const heading = await b.evaluate(`(() => {
			const box = (el) => { const r = document.createRange(); r.selectNodeContents(el); const rs = [...r.getClientRects()].filter((x) => x.height > 0); return rs.length ? { top: rs[0].top, bottom: rs[rs.length - 1].bottom } : null; };
			const legend = box(document.getElementById("rotation-label"));
			const above = box(document.getElementById("picker-moves"));
			const below = box(document.getElementById("pickerr-label"));
			if (!legend || !above || !below) return null;
			return { above: Math.round((legend.top - above.bottom) * 10) / 10, below: Math.round((below.top - legend.bottom) * 10) / 10 };
		})()`);
		check("spacing: the Rotation heading sits against the field it heads (at most 6 px) and at least twice as far from the help above", heading !== null && heading.below <= 6 && heading.above >= 2 * heading.below, JSON.stringify(heading));
		// R36 + R19/R42: on a fresh page new ticks go to the group holding the
		// reading on the dial, and one line says how groups work for this map.
		const groups = [{ name: "CPU", keys: [K.cpu, K.cpuPower] }, { name: "GPU", keys: [K.gpu, K.hot] }];
		await open("dial-configured", { settings: { ...dialFx.settings, controlPreset: "elite", readingKey: K.hot, rotationKeys: [K.cpu, K.cpuPower, K.gpu, K.hot], rotationGroups: groups } });
		await sleep(150);
		const collector = await b.evaluate(`({ checked: document.querySelector(".hw-collector:checked")?.dataset.group ?? null, label: document.getElementById("pickerr-label").textContent, help: document.getElementById("rotation-help").textContent, order: document.getElementById("pickerr-order-help").hidden })`);
		check("R36: a fresh page sends new ticks to the group holding the reading on the dial", collector.checked === "1" && collector.label === "Readings for GPU" && sim.writes.length === 0, JSON.stringify(collector));
		check("R42: with groups, one line says where ticks go, what stays inside a group and what jumps; the order sentence gives way to the slots", collector.help === "New ticks go to the marked group. Turns stay inside a group; a pressed turn jumps to the next group and shows its name." && collector.order === true, JSON.stringify(collector));
		await open("dial-configured", { settings: { ...dialFx.settings, controlPreset: "legacy", rotationKeys: [K.cpu, K.cpuPower, K.gpu, K.hot], rotationGroups: groups } });
		await sleep(150);
		const legacy = await b.evaluate(`({ help: document.getElementById("rotation-help").textContent, link: document.querySelector('#rotation-help button[data-reveal="f-preset"]')?.textContent ?? null, summary: document.querySelector('[data-summary="interaction"]')?.textContent ?? null })`);
		check("R19: on a Legacy dial the groups line says turns run through all groups as one list, with the way to the gestures", legacy.help.startsWith("New ticks go to the marked group. Legacy gestures cannot switch groups, so turns run through all groups as one list, in group order.") && legacy.link === "Change gestures", JSON.stringify(legacy));
		// R30: the folded Controls summary names Elite's pressed turn, resolved.
		await open("dial-configured", { settings: { ...dialFx.settings, controlPreset: "elite", rotationKeys: [K.cpu, K.cpuPower, K.gpu, K.hot], rotationGroups: groups } });
		await sleep(150);
		const summary = await b.evaluate(`document.querySelector('[data-summary="interaction"]')?.textContent ?? null`);
		check("R30: the Controls summary names the pressed turn, resolved to what it does here", typeof summary === "string" && summary.includes("pressed turn switches group"), JSON.stringify(summary));
		check("round 3 rotation copy: none of it wrote a setting", sim.writes.length === 0 && sim.globalWrites.length === 0, JSON.stringify(writes()));
	}

	// ---- round 3: moving members across groups, and keyboard moves in view ---
	{
		const K = sim.keys;
		const dialFx = sim.fixtures["dial-configured"];
		const groups = [{ name: "CPU", keys: [K.cpu, K.cpuPower] }, { name: "GPU", keys: [K.gpu, K.hot] }];
		await open("dial-configured", { settings: { ...dialFx.settings, controlPreset: "elite", readingKey: K.gpu, rotationKeys: [K.cpu, K.cpuPower, K.gpu, K.hot], rotationGroups: groups } });
		await b.evaluate(`document.querySelector('#rotation-set [role="option"][data-key="${K.cpu}"]').click()`);
		await sleep(120);
		const firstEdge = await b.evaluate(`document.querySelector('#rotation-set .hw-set-tools button[data-tool="earlier"]').getAttribute("aria-disabled")`);
		await b.evaluate(`document.querySelector('#rotation-set [role="option"][data-key="${K.cpuPower}"]').click()`);
		await sleep(120);
		// The click helper centers its target first; center it here too, so
		// the position read before the press is the one the pointer presses.
		const edge = await b.evaluate(`(() => { const l = document.querySelector('#rotation-set .hw-set-tools button[data-tool="later"]'); l.scrollIntoView({ block: "center" }); return { disabled: l.getAttribute("aria-disabled"), label: l.getAttribute("aria-label"), top: l.getBoundingClientRect().top }; })()`);
		sim.writes.length = 0;
		await b.click('#rotation-set .hw-set-tools button[data-tool="later"]');
		await sleep(300);
		const crossed = await b.evaluate(`(() => { const a = document.activeElement; const root = document.documentElement; return { focus: a?.dataset.tool ?? null, top: a?.getBoundingClientRect().top ?? null, selected: document.querySelector('#rotation-set [role="option"][aria-selected="true"]')?.dataset.group ?? null, atLimit: scrollY <= 0 || scrollY + innerHeight >= root.scrollHeight - 1 }; })()`);
		const wrote = lastWrite()?.rotationGroups;
		check("R23: Earlier at the first place of group 1 stays disabled; Later at a group's last place names the next group", firstEdge === "true" && edge.disabled === "false" && edge.label === "Later: move CPU Package Power to the start of group 2 (GPU)", JSON.stringify({ firstEdge, edge }));
		check("R23: Later past a group's edge moves the reading to the start of the next group in one frame, keeping focus and the button under the pointer", same(wrote?.[0]?.keys, [K.cpu]) && same(wrote?.[1]?.keys, [K.cpuPower, K.gpu, K.hot]) && sim.writes.length === 1 && crossed.focus === "later" && crossed.selected === "1" && (Math.abs(crossed.top - edge.top) < 2 || crossed.atLimit), JSON.stringify({ crossed, edgeTop: edge.top, wrote, n: sim.writes.length }));
		// R21: Alt+End from the list moves the selected member to the end of
		// its list and keeps it in view.
		await b.evaluate(`document.querySelector('#rotation-set .hw-set-list[data-group="1"]').focus()`);
		await sleep(80);
		sim.writes.length = 0;
		await b.key("End", { alt: true });
		await sleep(250);
		const toEnd = await b.evaluate(`(() => { const o = document.querySelector('#rotation-set [role="option"][aria-selected="true"]'); const r = o.getBoundingClientRect(); return { key: o.dataset.key, visible: r.top >= 0 && r.bottom <= innerHeight, focus: document.activeElement.matches(".hw-set-list") }; })()`);
		check("R21: Alt+End moves the selected member to the end of its list in one frame and keeps it in view", same(lastWrite()?.rotationGroups?.[1]?.keys, [K.gpu, K.hot, K.cpuPower]) && sim.writes.length === 1 && toEnd.key === K.cpuPower && toEnd.visible && toEnd.focus, JSON.stringify({ toEnd, n: sim.writes.length, wrote: lastWrite()?.rotationGroups }));
		check("R37: the lists name their shortcuts, Delete included since the owner checked it on the real app (R52), and the tools' tooltips name theirs", (await b.evaluate(`document.querySelector("#rotation-set .hw-set-list").getAttribute("aria-keyshortcuts")`)) === "Alt+ArrowLeft Alt+ArrowRight Alt+Home Alt+End F2 Delete" && /\(Alt\+Right in the list\)$/.test(await b.evaluate(`document.querySelector('#rotation-set .hw-set-tools button[data-tool="later"]').title`)) && /\(Delete in the list\)$/.test(await b.evaluate(`document.querySelector('#rotation-set .hw-set-tools button[data-tool="remove"]').title`)));
	}

	// ---- round 3: a list opened by a person comes into view (R17), tile
	// settings sit above the details list (R15) ----------------------------
	{
		// The app's panel: 373 x 410 CSS px at DPR 1.5 (bench 2026-09-23).
		await b.viewport(373, 410, 1.5);
		await open("key-configured");
		await b.evaluate(`window.scrollTo(0, 0)`);
		await b.evaluate(`document.getElementById("picker-search").focus()`);
		await sleep(150);
		const onFocus = await b.evaluate(`({ y: scrollY, open: !document.getElementById("picker-list").hidden })`);
		await b.evaluate(`document.getElementById("picker-search").blur(); document.getElementById("sec-display").focus?.(); window.scrollTo(0, 0)`);
		await sleep(150);
		await b.click("#picker-search");
		await sleep(250);
		const onClick = await b.evaluate(`(() => { const l = document.getElementById("picker-list").getBoundingClientRect(); const f = document.getElementById("picker-search").closest(".hw-field").getBoundingClientRect(); const h = document.querySelector(".hw-head[data-pin]").getBoundingClientRect(); return { y: scrollY, listBottom: Math.round(l.bottom), fieldTop: Math.round(f.top), headBottom: Math.round(h.bottom), vh: innerHeight }; })()`);
		check("R17: a focus alone never moves the page; a click brings the list into view without lifting its field under the header", onFocus.y === 0 && onFocus.open && onClick.y > 0 && (onClick.listBottom <= onClick.vh || onClick.fieldTop >= onClick.headBottom + 7) && onClick.fieldTop >= onClick.headBottom && sim.writes.length === 0, JSON.stringify({ onFocus, onClick }));
		const order = await b.evaluate(`(() => { const ids = ["f-density", "f-detail-title", "f-detail-mode", "detail-custom"]; const all = [...document.querySelectorAll("#detail-config [id]")].map((e) => e.id); return ids.map((id) => all.indexOf(id)); })()`);
		check("R15: Readings per tile and Title tile text come before the Details list and its custom list", order.every((i) => i >= 0) && order[0] < order[2] && order[1] < order[2] && order[2] < order[3], JSON.stringify(order));
		await b.viewport(400, 900, 1);
	}

	// ---- the theme band folds (owner, 2026-09-26; design R2) ----------------
	// Ported from the design's acceptance run: the row is one section row that keeps the checked chip,
	// a near miss on Change never folds it, a late fold answer folds nothing
	// under the person, the empty key keeps its fact, each panel kind keeps
	// its own fold, and the title stays on its marker's line.
	{
		const fold = async (want) => {
			if ((await b.evaluate(`document.getElementById("sec-theme").open`)) === want) return;
			await b.click("#sec-theme > summary");
			await sleep(200);
			await b.evaluate("window.scrollTo(0, 0)");
		};
		const row = () =>
			b.evaluate(`(() => {
				const d = document.getElementById("sec-theme");
				const sum = d.querySelector(":scope > summary");
				const rs = document.querySelector("#sec-reading > summary");
				const title = sum.querySelector(".hw-label"), rTitle = rs.querySelector(".hw-sec-title");
				const cs = getComputedStyle(title), rc = getComputedStyle(rTitle);
				const sr = sum.getBoundingClientRect(), cr = document.getElementById("theme-change").getBoundingClientRect();
				const face = document.querySelector("#theme-mini .hw-theme-face");
				let chip = null;
				if (face && face.getClientRects().length) {
					const v = face.querySelector(".hw-theme-value");
					const range = document.createRange();
					range.selectNodeContents(v);
					const tr = range.getBoundingClientRect();
					const spark = face.querySelector(".hw-theme-spark").getBoundingClientRect();
					const fr = face.getBoundingClientRect();
					chip = { h: Math.round(fr.height * 10) / 10, w: Math.round(fr.width * 10) / 10, stripe: Math.round((spark.top - (tr.top + 1.079 * parseFloat(getComputedStyle(v).fontSize))) * 10) / 10 };
				}
				const before = getComputedStyle(sum, "::before");
				const mh = parseFloat(before.height);
				const marker = sr.top + parseFloat(before.top) + (Number.isFinite(mh) && mh > 0 ? mh / 2 : 5);
				const tb = title.getBoundingClientRect();
				const note = document.getElementById("theme-note");
				return {
					open: d.open,
					bandH: Math.round(d.getBoundingClientRect().height * 10) / 10,
					sumH: Math.round(sr.height * 10) / 10,
					readingSumH: Math.round(rs.getBoundingClientRect().height * 10) / 10,
					sameTitle: [cs.fontSize, cs.fontWeight, cs.color].join() === [rc.fontSize, rc.fontWeight, rc.color].join() && Math.abs(tb.left - rTitle.getBoundingClientRect().left) <= 1,
					gap: Math.round((cr.left - sr.right) * 10) / 10,
					chip,
					markerOff: Math.round(Math.abs(marker - (tb.top + tb.height / 2)) * 10) / 10,
					note: { text: note.textContent, shown: note.getClientRects().length > 0 },
					readingTop: Math.round((document.getElementById("sec-reading").getBoundingClientRect().top + scrollY) * 10) / 10,
					overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
				};
			})()`);
		const axName = async () => {
			const doc = await b.send("DOM.getDocument", { depth: 0 });
			const { nodeId } = await b.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#sec-theme > summary" });
			const tree = await b.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
			return { role: tree.nodes[0].role?.value, name: tree.nodes[0].name?.value, expanded: tree.nodes[0].properties?.find((p) => p.name === "expanded")?.value?.value };
		};
		await b.send("DOM.enable");
		await b.send("Accessibility.enable");
		await b.viewport(373, 410, 1.5);
		sim.folds = new PanelFoldMemory();
		await open("key-configured");
		const o = await row();
		await fold(false);
		const f = await row();
		const axFolded = await axName();
		check("theme band: open on a first visit; one section row open and folded, titled like Reading, ending 4+ px before Change", o.open && Math.abs(o.sumH - o.readingSumH) <= 0.5 && Math.abs(f.sumH - f.readingSumH) <= 0.5 && o.sameTitle && o.gap >= 4, JSON.stringify({ o, f }));
		check("theme band: folded to one row with the checked chip at 24 px (stripe 3+ px under its word) and no overflow", !f.open && f.bandH <= 34 && f.chip !== null && f.chip.h === 24 && f.chip.w >= 72 && f.chip.stripe >= 3 && f.overflow <= 0, JSON.stringify(f));
		check("theme band: a disclosure named by its visible words, collapsed when folded", axFolded.role === "DisclosureTriangle" && axFolded.name === "Theme Default (shared: Void)" && axFolded.expanded === false, JSON.stringify(axFolded));
		// Each panel kind keeps its own fold, both ways.
		await open("key-configured");
		const nextKey = await b.evaluate(`document.getElementById("sec-theme").open`);
		await open("dial-configured");
		const dialOpen = await b.evaluate(`document.getElementById("sec-theme").open`);
		await fold(false);
		await open("dial-configured");
		const nextDial = await b.evaluate(`document.getElementById("sec-theme").open`);
		check("theme band: a folded band stays folded on the next panel of its kind only, both ways", nextKey === false && dialOpen === true && nextDial === false && same(sim.folds.get("key"), { "sec-theme": false }) && sim.writes.length === 0, JSON.stringify({ nextKey, dialOpen, nextDial, key: sim.folds.get("key") }));
		// A near miss 1 to 6 px above Change, where Change has a line of its
		// own under the row (below 300 px), never folds the band.
		for (const [width, dpr] of [[298, 1.5], [160, 3]]) {
			await b.viewport(width, 410, dpr);
			sim.folds = new PanelFoldMemory();
			await open("key-configured");
			await b.evaluate(`document.getElementById("theme-change").scrollIntoView({ block: "center" })`);
			await sleep(200);
			const c = await b.evaluate(`(() => { const r = document.getElementById("theme-change").getBoundingClientRect(); return { l: r.left, t: r.top, cx: r.left + r.width / 2 }; })()`);
			let folded = 0;
			for (let k = 1; k <= 6; k++) {
				for (const x of [c.cx, c.l + 3]) {
					for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await b.send("Input.dispatchMouseEvent", { type, x, y: c.t - k, button: "left", clickCount: 1 });
					await sleep(120);
					if (!(await b.evaluate(`document.getElementById("sec-theme").open`))) {
						folded++;
						await b.evaluate(`document.getElementById("sec-theme").open = true`);
					}
				}
			}
			check(`theme band (${width} px): twelve presses 1 to 6 px above Change fold nothing and write nothing`, folded === 0 && sim.writes.length === 0 && sim.globalWrites.length === 0, JSON.stringify({ folded, ...writes() }));
		}
		// The title stays on its marker's line when a long unknown name wraps.
		await open("key-configured", { settings: { ...sim.fixtures["key-configured"].settings, theme: "synthwave-sunset-2027" } });
		const wideOpen = await row();
		await fold(false);
		const wideFolded = await row();
		check("theme band (160 px): a long unknown theme wraps under the title, which stays on its marker's line, open and folded", wideOpen.markerOff <= 1 && wideFolded.markerOff <= 1 && wideOpen.overflow <= 0 && wideFolded.overflow <= 0, JSON.stringify({ open: wideOpen.markerOff, folded: wideFolded.markerOff }));
		await b.viewport(373, 410, 1.5);
		// A late fold answer (900 ms): the panel shows at the 600 ms cap with
		// every section open. The owner's deck once answered after the then
		// 300 ms cap (2026-09-26, the hw-folds-timeout mark with no answer
		// mark), so a late answer still applies the remembered folds while
		// the person has not pressed, typed, scrolled or moved focus; after
		// they have, it folds nothing under them and focus stays. The memory
		// is untouched either way.
		sim.foldsDelayMs = 900;
		const tops = () => b.evaluate(`[...document.querySelectorAll("details.hw-sec[id]")].map((d) => [d.id, d.open, Math.round(d.getBoundingClientRect().top + scrollY)])`);
		const openLate = async () => {
			sim.folds = new PanelFoldMemory();
			sim.folds.set("key", { "sec-theme": false, "sec-reading": false });
			sim.setFixture("key-configured");
			await b.goto(sim.url("key-configured"));
			let shown = false;
			for (let i = 0; i < 40 && !shown; i++) {
				shown = await b.evaluate(`!document.documentElement.hasAttribute("data-folds-pending")`);
				if (!shown) await sleep(25);
			}
			await sleep(150);
			return shown;
		};
		try {
			const shownA = await openLate();
			const before = await tops();
			await sleep(1300);
			const applied = await b.evaluate(`({ theme: document.getElementById("sec-theme").open, reading: document.getElementById("sec-reading").open, late: performance.getEntriesByType("mark").some((m) => m.name === "hw-folds-late") })`);
			check("folds: an answer 900 ms late, before the person does anything, still applies the remembered folds", shownA && before.every(([, open]) => open === true || open === false) && applied.theme === false && applied.reading === false && applied.late, JSON.stringify({ shownA, applied }));
			const shownB = await openLate();
			await b.key("Tab");
			await b.evaluate(`document.querySelector("#sec-theme > summary").focus()`);
			const t1 = await tops();
			await sleep(1300);
			const t2 = await tops();
			const focus = await b.evaluate(`document.activeElement === document.querySelector("#sec-theme > summary")`);
			check("folds: after a key press, a late answer folds nothing under the person and focus stays", shownB && focus && JSON.stringify(t1) === JSON.stringify(t2), JSON.stringify({ shownB, focus, t1, t2 }));
			// Focus moved to a field with no key or pointer event, as assistive
			// technology can (external review AX03): the late answer folds
			// nothing, and the field stays shown and focused.
			const shownC = await openLate();
			await b.evaluate(`document.getElementById("f-label").focus()`);
			const t3 = await tops();
			await sleep(1300);
			const t4 = await tops();
			const kept = await b.evaluate(`({ section: document.getElementById("f-label").closest("details.hw-sec")?.open ?? null, focus: document.activeElement?.id ?? "", late: performance.getEntriesByType("mark").some((m) => m.name === "hw-folds-late") })`);
			check("folds: after focus moves to a field without a key or pointer, a late answer folds nothing and the field stays shown and focused", shownC && kept.late && kept.section === true && kept.focus === "f-label" && JSON.stringify(t3) === JSON.stringify(t4), JSON.stringify({ shownC, kept, t3, t4 }));
		} finally {
			sim.foldsDelayMs = 0;
		}
		await open("key-configured");
		const next = await b.evaluate(`({ theme: document.getElementById("sec-theme").open, reading: document.getElementById("sec-reading").open })`);
		check("theme band: the late answer left the memory as it was; the next panel opens folded as remembered", next.theme === false && next.reading === false && sim.folds.get("key")["sec-theme"] === false, JSON.stringify(next));
		// The empty key keeps its fact on the folded row, whatever theme is
		// stored; a reading picked with the band open leaves no held line.
		sim.folds = new PanelFoldMemory();
		await open("key-configured");
		await fold(false);
		const plainFolded = (await row()).bandH;
		for (const [label, over] of [["Default", undefined], ["an unknown theme", { settings: { ...sim.fixtures["key-empty"].settings, theme: "neon-2031" } }]]) {
			sim.folds = new PanelFoldMemory();
			await open("key-empty", over);
			await fold(false);
			const e = await row();
			const ax = await axName();
			check(`theme band: an empty key with ${label}, folded, says the theme shows once a reading is picked, visibly and in its name`, e.note.shown && e.note.text === "Shows on the key once a reading is picked." && /Shows on the key once a reading is picked\.$/.test(ax.name ?? ""), JSON.stringify({ note: e.note, name: ax.name }));
		}
		sim.folds = new PanelFoldMemory();
		await open("key-empty");
		sim.settings = { ...sim.settings, readingKey: sim.keys.cpu };
		sim.piWs.send(JSON.stringify({ event: "didReceiveSettings", action: "com.lawrensen.hwinfo.reading", context: sim.context, device: "dev1", payload: { settings: sim.settings } }));
		sim.pushPreview();
		await sleep(500);
		await fold(false);
		const picked = await row();
		check("theme band: a reading picked with the band open, then folded, leaves a plain folded row", !picked.note.shown && picked.bandH === plainFolded, JSON.stringify({ bandH: picked.bandH, plainFolded, note: picked.note }));
		sim.folds = new PanelFoldMemory();
		await b.viewport(400, 900, 1);
	}

	// ---- Make shared (owner, 2026-09-26; five reviewers chose design X1) ----
	// On a theme picked for this key or dial that is not the shared one,
	// Change's slot shows Make shared: the global theme first, then this key
	// back to Default. No right click, no mode, no confirmation.
	{
		const ms = () =>
			b.evaluate(`(() => {
				const share = document.getElementById("theme-share");
				const change = document.getElementById("theme-change");
				const sum = document.querySelector("#sec-theme > summary").getBoundingClientRect();
				const sr = share.getBoundingClientRect();
				const g = document.getElementById("theme-gallery").getBoundingClientRect();
				const said = document.querySelector('body > .hw-sr-only[aria-live="polite"]')?.textContent ?? "";
				return {
					share: !share.hidden && share.getClientRects().length > 0,
					change: !change.hidden && getComputedStyle(change).visibility === "visible" && change.getClientRects().length > 0,
					label: share.getAttribute("aria-label"),
					line: document.getElementById("theme-current").textContent,
					checked: document.querySelector('#theme-gallery .hw-theme[aria-checked="true"]')?.dataset.theme ?? null,
					active: document.activeElement?.dataset?.theme ?? document.activeElement?.id ?? null,
					galleryTop: Math.round(g.top + scrollY),
					gap: Math.round((sr.left - sum.right) * 10) / 10,
					shareH: Math.round(sr.height * 10) / 10,
					sharedSelect: document.getElementById("shared-theme")?.value ?? null,
					said,
					advancedOpen: document.getElementById("sec-advanced")?.open ?? null,
					sharedOpen: document.getElementById("sec-shared")?.open ?? null,
					y: scrollY,
					overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
				};
			})()`);
		await b.viewport(373, 410, 1.5);
		for (const fx of ["key-configured", "key-empty", "dial-configured"]) {
			sim.folds = new PanelFoldMemory();
			await open(fx);
			const s0 = await ms();
			check(`Make shared (${fx}): opening writes nothing; Change holds the slot and Make shared is hidden`, sim.writes.length === 0 && sim.globalWrites.length === 0 && s0.change && !s0.share, JSON.stringify({ s0, ...writes() }));
		}
		sim.folds = new PanelFoldMemory();
		await open("key-configured");
		const before = await ms();
		await b.click('#theme-gallery .hw-theme[data-theme="ember"]');
		await sleep(250);
		const picked = await ms();
		check("Make shared: an explicit pick shows Make shared in Change's slot, named for what it does, the row ending 7+ px before it; nothing moves; one key write", picked.share && !picked.change && picked.line === "Ember (set on this key)" && picked.label === "Make shared: Ember becomes the shared theme and this key follows it" && picked.gap >= 7 && picked.shareH >= 24 && picked.galleryTop === before.galleryTop && picked.overflow <= 0 && sim.writes.length === 1 && lastWrite()?.theme === "ember" && sim.globalWrites.length === 0, JSON.stringify({ picked, ...writes() }));
		const globalsBefore = structuredClone(sim.globals ?? {});
		const msgMark = sim.piMessages.length;
		await b.click("#theme-share");
		await sleep(400);
		const after = await ms();
		const sent = sim.piMessages.slice(msgMark).map((m) => m.event).filter((e) => e === "setGlobalSettings" || e === "setSettings");
		const lastGlobal = sim.globalWrites.at(-1) ?? {};
		const keptGlobals = Object.keys(globalsBefore).filter((k) => k !== "theme").every((k) => JSON.stringify(lastGlobal[k]) === JSON.stringify(globalsBefore[k]));
		check("Make shared: one global write (theme only changes) before one key write (theme back to Default)", sim.globalWrites.length === 1 && lastGlobal.theme === "ember" && keptGlobals && sim.writes.length === 2 && lastWrite()?.theme === "" && same(sent, ["setGlobalSettings", "setSettings"]), JSON.stringify({ sent, lastGlobal, keptGlobals, ...writes() }));
		check("Make shared: the line reads Default (shared: Ember), Default is checked and focused, Change is back, the Shared defaults select follows, and nothing moved", after.line === "Default (shared: Ember)" && after.checked === "" && after.active === "" && after.change && !after.share && after.sharedSelect === "ember" && after.galleryTop === before.galleryTop, JSON.stringify(after));
		check("Make shared: the panel says what changed and what it was", after.said === "Ember is now the shared theme, was Void. This key follows it.", JSON.stringify(after.said));
		// The second click of a double click lands where Change now sits.
		sim.folds = new PanelFoldMemory();
		await open("key-configured");
		await b.click('#theme-gallery .hw-theme[data-theme="forest"]');
		await sleep(250);
		// 5 px in from the left edge: once Change is back, the fold row reaches
		// there (audit MS01).
		const box = await b.evaluate(`(() => { const r = document.getElementById("theme-share").getBoundingClientRect(); return { x: r.left + 5, y: r.top + r.height / 2 }; })()`);
		const w0 = sim.writes.length + sim.globalWrites.length;
		for (const clickCount of [1, 2]) {
			await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount });
			await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount });
			await sleep(60);
		}
		await sleep(400);
		const dbl = await ms();
		const bandOpen = await b.evaluate(`document.getElementById("sec-theme").open`);
		check("Make shared: a double click on its left edge shares once, folds nothing and opens nothing", sim.writes.length + sim.globalWrites.length - w0 === 2 && bandOpen && dbl.advancedOpen === false && dbl.y === 0 && dbl.line === "Default (shared: Forest)" && !sim.piMessages.some((m) => m.event === "sendToPlugin" && m.payload?.event === "setPanelFolds" && m.payload?.folds?.["sec-theme"] === false), JSON.stringify({ dbl, bandOpen, n: sim.writes.length + sim.globalWrites.length - w0 }));
		// A held Enter shares once and never reaches Change.
		sim.folds = new PanelFoldMemory();
		await open("key-configured");
		await b.click('#theme-gallery .hw-theme[data-theme="paper"]');
		await sleep(250);
		await b.evaluate("window.scrollTo(0, 0)");
		await b.evaluate(`document.getElementById("theme-share").focus()`);
		const w1 = sim.writes.length + sim.globalWrites.length;
		await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
		for (let i = 0; i < 6; i++) await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", autoRepeat: true });
		await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
		await sleep(400);
		const held = await ms();
		check("Make shared: a held Enter shares once, focus stays on the Default chip, nothing opens or scrolls", sim.writes.length + sim.globalWrites.length - w1 === 2 && held.active === "" && held.advancedOpen === false && held.y === 0, JSON.stringify({ held, n: sim.writes.length + sim.globalWrites.length - w1 }));
		// Where it never shows: the shared theme itself, an unknown id.
		await open("key-configured", { settings: { ...sim.fixtures["key-configured"].settings, theme: "void" } });
		const same1 = await ms();
		await open("key-configured", { settings: { ...sim.fixtures["key-configured"].settings, theme: "neon-2031" } });
		const unknown = await ms();
		check("Make shared: hidden on a pick that is the shared theme and on an unknown stored theme; Change holds its place unseen", !same1.share && !same1.change && same1.line === "Void (set on this key)" && !unknown.share && !unknown.change, JSON.stringify({ same1, unknown }));
		// A dial says dial; an empty key keeps its help line.
		await open("dial-configured", { settings: { ...sim.fixtures["dial-configured"].settings, theme: "forest" } });
		const dial = await ms();
		check("Make shared: a dial's link says this dial follows it", dial.share && dial.label === "Make shared: Forest becomes the shared theme and this dial follows it", JSON.stringify(dial));
		await open("key-empty");
		await b.click('#theme-gallery .hw-theme[data-theme="midnight"]');
		await sleep(250);
		await b.click("#theme-share");
		await sleep(400);
		const empty = await b.evaluate(`({ line: document.getElementById("theme-current").textContent, help: document.getElementById("theme-help").textContent })`);
		check("Make shared: an empty key shares and still says when its theme will show", empty.line === "Default (shared: Midnight)" && empty.help === "Shows on the key once a reading is picked.", JSON.stringify(empty));
		// Folded, neither link is painted; the folded row is unchanged.
		await open("key-configured", { settings: { ...sim.fixtures["key-configured"].settings, theme: "ember" } });
		await b.click("#sec-theme > summary");
		await sleep(200);
		const folded = await b.evaluate(`({ share: document.getElementById("theme-share").checkVisibility(), face: document.querySelector("#theme-mini .hw-theme-value")?.textContent ?? null })`);
		check("Make shared: a folded band paints no link and keeps the checked chip", folded.share === false && folded.face === "Ember", JSON.stringify(folded));
		// Near misses around Make shared, and no pick ever moves the chips.
		for (const [width, dpr] of [[373, 1.5], [320, 1.5], [311, 1.5], [300, 1.5], [160, 3]]) {
			await b.viewport(width, 410, dpr);
			sim.folds = new PanelFoldMemory();
			await open("key-configured", { globals: { ...sim.fixtures["key-configured"].globals, theme: "ultraviolet" } });
			const tops = new Set();
			let shown = 0;
			let cut = 0;
			for (const id of ["", "void", "graphite", "ultraviolet", "midnight", "forest", "ember", "paper"]) {
				await b.evaluate(`document.querySelector('#theme-gallery .hw-theme[data-theme="${id}"]').click()`);
				await sleep(60);
				const m = await ms();
				tops.add(m.galleryTop);
				if (m.share) shown++;
				if (m.overflow > 0 || (await b.evaluate(`(() => { const c = document.getElementById("theme-current"); return c.scrollWidth > c.clientWidth + 0.5; })()`))) cut++;
			}
			check(`Make shared (${width} px): eight picks move the chips 0 px, cut nothing, and show Make shared on exactly the six picks that are not the shared theme`, tops.size === 1 && cut === 0 && shown === 6, JSON.stringify({ tops: [...tops], shown, cut }));
			await b.evaluate(`document.querySelector('#theme-gallery .hw-theme[data-theme="ember"]').click()`);
			await sleep(100);
			await b.evaluate(`document.getElementById("theme-share").scrollIntoView({ block: "center" })`);
			await sleep(200);
			const c = await b.evaluate(`(() => { const r = document.getElementById("theme-share").getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`);
			let folds = 0;
			let pressed = 0;
			const w2 = sim.writes.length + sim.globalWrites.length;
			for (let k = 1; k <= 6; k++) {
				for (const [x, y] of [[c.cx, c.t - k], [c.l - k, c.cy], [c.r + k, c.cy]]) {
					if (x < 0 || x >= width || y < 0) continue;
					const hit = await b.evaluate(`(() => { const el = document.elementFromPoint(${x}, ${y}); return el === null ? "none" : el.closest("button, a, input, select, [role=radio], [tabindex]:not(summary)") ? "control" : "inert"; })()`);
					if (hit === "control") continue;
					for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await b.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
					await sleep(80);
					pressed++;
					if (!(await b.evaluate(`document.getElementById("sec-theme").open`))) {
						folds++;
						await b.evaluate(`document.getElementById("sec-theme").open = true`);
					}
				}
			}
			check(`Make shared (${width} px): ${pressed} near misses around it fold nothing and write nothing`, folds === 0 && pressed >= 8 && sim.writes.length + sim.globalWrites.length === w2, JSON.stringify({ folds, pressed }));
		}
		await b.viewport(373, 410, 1.5);
		// Nothing here listens for a right click.
		sim.folds = new PanelFoldMemory();
		await open("key-configured");
		const r = await b.evaluate(`(() => { const c = document.querySelector('#theme-gallery .hw-theme[data-theme="ember"]'); c.scrollIntoView({ block: "center" }); const q = c.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`);
		await sleep(150);
		const w3 = sim.writes.length + sim.globalWrites.length;
		await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "right", clickCount: 1 });
		await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "right", clickCount: 1 });
		await sleep(200);
		check("Make shared: a right click on a chip writes nothing", sim.writes.length + sim.globalWrites.length === w3);

		// The first shared-settings answer is slow, so the share waits for it
		// (external review AX02). A theme picked for this key or dial in the
		// meantime is the newer choice and stays; the share still lands.
		for (const [fx, where] of [["key-configured", "key"], ["dial-configured", "dial"]]) {
			sim.folds = new PanelFoldMemory();
			sim.holdGlobalsReplies = true;
			await open(fx, { settings: { ...sim.fixtures[fx].settings, theme: "ember" } });
			await b.click("#theme-share");
			await sleep(250);
			const pending = { ...writes(), held: sim.heldGlobals.length };
			await b.click('#theme-gallery .hw-theme[data-theme="forest"]');
			await sleep(250);
			sim.releaseGlobals();
			await sleep(500);
			const s = await ms();
			check(`Make shared (${fx}), slow shared settings: a theme picked before they answer stays; Ember becomes shared and the ${where} keeps Forest and focus`, pending.settings === 0 && pending.globals === 0 && pending.held > 0 && same(sim.writes.map((x) => x.theme), ["forest"]) && same(sim.globalWrites.map((x) => x.theme), ["ember"]) && s.checked === "forest" && s.active === "forest" && s.line === `Forest (set on this ${where})` && s.share, JSON.stringify({ pending, s, themes: sim.writes.map((x) => x.theme), shared: sim.globalWrites.map((x) => x.theme) }));
			check(`Make shared (${fx}), slow shared settings: the panel says Ember is shared and the ${where} keeps Forest`, s.said === `Ember is now the shared theme, was Void. This ${where} keeps Forest.`, JSON.stringify(s.said));
		}
		sim.folds = new PanelFoldMemory();
		sim.holdGlobalsReplies = true;
		await open("key-configured", { settings: { ...sim.fixtures["key-configured"].settings, theme: "ember" } });
		await b.click("#theme-share");
		await sleep(150);
		await b.click('#theme-gallery .hw-theme[data-theme="forest"]');
		await sleep(150);
		await b.click('#theme-gallery .hw-theme[data-theme="ember"]');
		await sleep(150);
		sim.releaseGlobals();
		await sleep(500);
		const back = await ms();
		check("Make shared, slow shared settings: Ember, Forest, then Ember again leaves Ember set on this key and shared, and says so", same(sim.writes.map((x) => x.theme), ["forest", "ember"]) && same(sim.globalWrites.map((x) => x.theme), ["ember"]) && back.checked === "ember" && back.line === "Ember (set on this key)" && !back.share && back.said === "Ember is now the shared theme, was Void. This key keeps Ember.", JSON.stringify({ back, themes: sim.writes.map((x) => x.theme) }));
		sim.folds = new PanelFoldMemory();
		sim.holdGlobalsReplies = true;
		await open("key-configured", { settings: { ...sim.fixtures["key-configured"].settings, theme: "ember" } });
		await b.click("#theme-share");
		await sleep(250);
		sim.releaseGlobals();
		await sleep(500);
		const late = await ms();
		check("Make shared, slow shared settings, nothing picked meanwhile: the share completes as usual, Default checked and focused", same(sim.writes.map((x) => x.theme), [""]) && same(sim.globalWrites.map((x) => x.theme), ["ember"]) && late.line === "Default (shared: Ember)" && late.checked === "" && late.active === "" && late.said === "Ember is now the shared theme, was Void. This key follows it.", JSON.stringify({ late, ...writes() }));
		// The host re-sends this key's settings during the wait (same theme,
		// another field changed by the plugin): not a new pick.
		sim.folds = new PanelFoldMemory();
		sim.holdGlobalsReplies = true;
		await open("key-configured", { settings: { ...sim.fixtures["key-configured"].settings, theme: "ember" } });
		await b.click("#theme-share");
		await sleep(200);
		sim.pushSettings({ ...sim.settings, label: "From the plugin" });
		await sleep(150);
		sim.releaseGlobals();
		await sleep(500);
		const echoed = await ms();
		check("Make shared, slow shared settings: a settings echo during the wait is not a new pick; the share completes as usual", same(sim.writes.map((x) => x.theme), [""]) && same(sim.globalWrites.map((x) => x.theme), ["ember"]) && echoed.line === "Default (shared: Ember)" && echoed.checked === "" && echoed.active === "" && sim.settings.label === "From the plugin", JSON.stringify({ echoed, themes: sim.writes.map((x) => x.theme), label: sim.settings.label }));

		// An older themes payload after the share (AX07): the stored shared
		// theme is what the plugin draws, so the line keeps it.
		sim.folds = new PanelFoldMemory();
		await open("key-configured", { settings: { ...sim.fixtures["key-configured"].settings, theme: "ember" } });
		const stale = structuredClone(sim.toPiLog.find((p) => p.event === "themes"));
		await b.click("#theme-share");
		await sleep(400);
		sim.sendToPi(stale);
		await sleep(150);
		sim.pushPreview();
		await sleep(150);
		const kept = await ms();
		const keptSummary = await b.evaluate(`document.querySelector('[data-summary="shared"]')?.textContent ?? null`);
		check("Make shared: an older themes payload after the share does not bring back the old shared theme", stale?.effectiveDeckTheme === "void" && kept.line === "Default (shared: Ember)" && kept.sharedSelect === "ember" && /^Ember ·/.test(String(keptSummary)), JSON.stringify({ stale: stale?.effectiveDeckTheme, kept, keptSummary }));
		// The shared theme changed elsewhere; the plugin's themes payload and
		// the host's shared settings reach this panel in either order.
		for (const order of ["themes first", "shared settings first"]) {
			sim.folds = new PanelFoldMemory();
			await open("key-inherited");
			const old = structuredClone(sim.toPiLog.find((p) => p.event === "themes"));
			const next = { ...sim.globals, theme: "ember" };
			if (order === "themes first") {
				sim.sendToPi({ ...old, effectiveDeckTheme: "ember" });
				await sleep(100);
				sim.pushGlobals(next);
			} else {
				sim.pushGlobals(next);
				await sleep(100);
				sim.sendToPi(old);
			}
			await sleep(300);
			const o = await ms();
			check(`shared theme changed elsewhere (${order}, the other one older): the line reads Default (shared: Ember), nothing written`, old?.effectiveDeckTheme === "midnight" && o.line === "Default (shared: Ember)" && sim.writes.length === 0 && sim.globalWrites.length === 0, JSON.stringify({ o, ...writes() }));
		}
		// With no known shared theme stored, the plugin's answer stands (its
		// legacy migration included): here it draws Graphite.
		sim.setFixture("key-inherited", { globals: { theme: "graphite", typeAccents: "on" } });
		for (const theme of [undefined, "constructor", "neon-2031"]) {
			sim.folds = new PanelFoldMemory();
			await open("key-inherited", { globals: { typeAccents: "on", ...(theme === undefined ? {} : { theme }) } });
			const f = await ms();
			check(`shared theme ${theme === undefined ? "absent" : `"${theme}"`}: the line keeps the plugin's answer, Default (shared: Graphite), nothing written`, f.line === "Default (shared: Graphite)" && sim.writes.length === 0 && sim.globalWrites.length === 0, JSON.stringify({ f, ...writes() }));
		}
		sim.setFixture("key-configured"); // the plugin draws Void again

		// Only the second click of a double click is swallowed (AX04): a
		// keyboard press on Change, or a click where Change now sits, runs.
		sim.folds = new PanelFoldMemory();
		await open("key-configured");
		await b.click('#theme-gallery .hw-theme[data-theme="ember"]');
		await sleep(250);
		await b.evaluate("window.scrollTo(0, 0)");
		await b.evaluate(`document.getElementById("theme-share").focus()`);
		await b.key("Enter");
		await sleep(60);
		await b.key("Tab", { shift: true });
		const onChange = await b.evaluate(`document.activeElement?.id ?? ""`);
		await b.key("Enter");
		await sleep(300);
		const kb = await ms();
		const kbFocus = await b.evaluate(`document.activeElement?.id ?? ""`);
		check("Make shared, then Shift+Tab and Enter on Change at once: Shared defaults opens with its theme focused; nothing more is written", onChange === "theme-change" && kb.advancedOpen === true && kbFocus === "shared-theme" && sim.writes.length === 2 && sim.globalWrites.length === 1, JSON.stringify({ onChange, kbFocus, advanced: kb.advancedOpen, ...writes() }));
		sim.folds = new PanelFoldMemory();
		await open("key-configured");
		await b.click('#theme-gallery .hw-theme[data-theme="ember"]');
		await sleep(250);
		await b.evaluate("window.scrollTo(0, 0)");
		const sharePoint = await b.evaluate(`(() => { const r = document.getElementById("theme-share").getBoundingClientRect(); return { x: r.right - 4, y: r.top + r.height / 2 }; })()`);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await b.send("Input.dispatchMouseEvent", { type, x: sharePoint.x, y: sharePoint.y, button: "left", clickCount: 1 });
		await sleep(180);
		const changeAt = await b.evaluate(`(() => { const r = document.getElementById("theme-change").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
		const apart = Math.hypot(changeAt.x - sharePoint.x, changeAt.y - sharePoint.y);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await b.send("Input.dispatchMouseEvent", { type, x: changeAt.x, y: changeAt.y, button: "left", clickCount: 1 });
		await sleep(300);
		const moved = await ms();
		const movedFocus = await b.evaluate(`document.activeElement?.id ?? ""`);
		check("Make shared, then a click where Change now sits, 180 ms later: Shared defaults opens with its theme focused; nothing more is written", apart > 4 && moved.advancedOpen === true && movedFocus === "shared-theme" && sim.writes.length === 2 && sim.globalWrites.length === 1, JSON.stringify({ apart: Math.round(apart), movedFocus, advanced: moved.advancedOpen, ...writes() }));

		// A theme that arrives between press and release makes the press stale
		// (external review AX14): it shares nothing, and the newer choice
		// stays until a fresh press. Mouse and Space, key and dial.
		const SPACE = { key: " ", code: "Space", windowsVirtualKeyCode: 32 };
		const shareCenter = async () => b.evaluate(`(() => { const e = document.getElementById("theme-share"); e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
		for (const [fx, where] of [["key-configured", "key"], ["dial-configured", "dial"]]) {
			for (const how of ["mouse", "Space"]) {
				sim.folds = new PanelFoldMemory();
				await open(fx, { settings: { ...sim.fixtures[fx].settings, theme: "ember" } });
				const p = await shareCenter();
				if (how === "mouse") {
					await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
					await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
				} else {
					await b.evaluate(`document.getElementById("theme-share").focus()`);
					await b.send("Input.dispatchKeyEvent", { type: "keyDown", ...SPACE, text: " " });
				}
				sim.pushSettings({ ...sim.settings, theme: "forest" });
				await sleep(40);
				if (how === "mouse") await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
				else await b.send("Input.dispatchKeyEvent", { type: "keyUp", ...SPACE });
				await sleep(400);
				const s = await ms();
				check(`Make shared (${where}, ${how}): a theme arriving between press and release makes the press stale; nothing is shared and Forest stays`, sim.writes.length === 0 && sim.globalWrites.length === 0 && s.checked === "forest" && s.line === `Forest (set on this ${where})`, JSON.stringify({ ...writes(), checked: s.checked, line: s.line }));
			}
		}
		// Tab between press and release ends nothing (external review AX21):
		// the press can still click, and it is still stale.
		sim.folds = new PanelFoldMemory();
		await open("key-configured", { settings: { ...sim.fixtures["key-configured"].settings, theme: "ember" } });
		const tabPoint = await shareCenter();
		await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: tabPoint.x, y: tabPoint.y });
		await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: tabPoint.x, y: tabPoint.y, button: "left", clickCount: 1 });
		sim.pushSettings({ ...sim.settings, theme: "forest" });
		await b.key("Tab");
		await sleep(40);
		await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: tabPoint.x, y: tabPoint.y, button: "left", clickCount: 1 });
		await sleep(400);
		const tabbed = await ms();
		check("Make shared: Tab between press and release keeps the press stale; nothing is shared and Forest stays", sim.writes.length === 0 && sim.globalWrites.length === 0 && tabbed.checked === "forest", JSON.stringify({ ...writes(), checked: tabbed.checked }));
		// Only the press's own key ends it (external review AX36): Enter
		// released elsewhere while Space is still held on Make shared.
		sim.folds = new PanelFoldMemory();
		await open("key-configured", { settings: { ...sim.fixtures["key-configured"].settings, theme: "ember" } });
		const ENTER = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 };
		await b.evaluate(`document.getElementById("picker-search").focus()`);
		await b.send("Input.dispatchKeyEvent", { type: "keyDown", ...ENTER, text: "\r" });
		await b.evaluate(`document.getElementById("theme-share").focus()`);
		await b.send("Input.dispatchKeyEvent", { type: "keyDown", ...SPACE, text: " " });
		sim.pushSettings({ ...sim.settings, theme: "forest" });
		await sleep(80);
		await b.send("Input.dispatchKeyEvent", { type: "keyUp", ...ENTER });
		await sleep(20);
		await b.send("Input.dispatchKeyEvent", { type: "keyUp", ...SPACE });
		await sleep(400);
		const crossed = await ms();
		check("Make shared: releasing Enter elsewhere keeps a held Space press stale; nothing is shared and Forest stays", sim.writes.length === 0 && sim.globalWrites.length === 0 && crossed.checked === "forest", JSON.stringify({ ...writes(), checked: crossed.checked }));
		sim.folds = new PanelFoldMemory();
		await open("key-configured", { settings: { ...sim.fixtures["key-configured"].settings, theme: "ember" } });
		await b.evaluate(`document.getElementById("theme-share").focus()`);
		await b.send("Input.dispatchKeyEvent", { type: "keyDown", ...SPACE, text: " " });
		await b.send("Input.dispatchKeyEvent", { type: "keyUp", ...SPACE });
		await sleep(400);
		const spaced = await ms();
		check("Make shared by Space with nothing arriving meanwhile shares as usual", same(sim.globalWrites.map((x) => x.theme), ["ember"]) && same(sim.writes.map((x) => x.theme), [""]) && spaced.line === "Default (shared: Ember)", JSON.stringify({ line: spaced.line, ...writes() }));

		// A newer stored theme this version does not know (external review
		// AX15): the share lands, the stored id stays, and the panel says it
		// the way the line shows it, never an inherited JavaScript name.
		for (const unknownId of ["constructor", "__proto__", "toString", "future-theme"]) {
			sim.folds = new PanelFoldMemory();
			sim.holdGlobalsReplies = true;
			await open("key-configured", { settings: { ...sim.fixtures["key-configured"].settings, theme: "ember" } });
			await b.click("#theme-share");
			await sleep(200);
			sim.pushSettings({ ...sim.settings, theme: unknownId });
			await sleep(150);
			sim.releaseGlobals();
			await sleep(500);
			const u = await ms();
			check(`Make shared, slow shared settings, then a stored "${unknownId}": Ember is shared, "${unknownId}" stays, and the panel says it is unknown and draws Void`, same(sim.globalWrites.map((x) => x.theme), ["ember"]) && sim.writes.length === 0 && sim.settings.theme === unknownId && u.said === `Ember is now the shared theme, was Void. This key keeps its stored theme "${unknownId}" (unknown; draws Void).`, JSON.stringify({ said: u.said, ...writes(), stored: sim.settings.theme }));
		}
		sim.folds = new PanelFoldMemory();
		await b.viewport(400, 900, 1);
	}

	// ---- round 3, AY11 and its follow-up: list notes are quiet when the
	// panel draws them and spoken when a person's edit changes them, the
	// first edit after opening included, a mouse edit (whose repaint waits
	// for the press to end) included ------------------------------------------
	{
		const said = () => b.evaluate(`document.querySelector('body > .hw-sr-only[aria-live="polite"]')?.textContent ?? "none"`);
		const note = (list) => b.evaluate(`document.querySelector('${list} .hw-set-note')?.textContent ?? ""`);
		await open("key-details");
		await sleep(300);
		const onOpen = await said();
		const before = await note("#detail-list");
		// A press on the list holds its repaint until the release (the
		// detailPressing queue); the edit lands in between.
		await b.evaluate(`(() => { const x = document.querySelector('#detail-list .hw-set-chip .hw-set-remove'); x.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 1 })); x.click(); window.dispatchEvent(new MouseEvent("mouseup", { detail: 1 })); })()`);
		await sleep(400);
		const after = await note("#detail-list");
		const onEdit = await said();
		check("AY11: opening the details editor says nothing; the first mouse edit says the list's new note", onOpen === "" && before !== "" && after !== before && onEdit === after, JSON.stringify({ onOpen, before, after, onEdit }));
		await open("dial-configured");
		await sleep(300);
		const dialOpen = await said();
		await b.evaluate(`document.getElementById("pickerr-search").focus()`);
		await sleep(150);
		await b.evaluate(`document.querySelector('#pickerr-list .hw-row[data-key="${sim.keys.cpu}"] .hw-tick').click()`);
		await sleep(400);
		const rotationNote = await note("#rotation-set");
		const dialEdit = await said();
		check("AY11: opening a dial says nothing; the first tick says the rotation's new note", dialOpen === "" && rotationNote !== "" && dialEdit === rotationNote, JSON.stringify({ dialOpen, rotationNote, dialEdit }));
		// Final audit FA01: "+ all" while a tile is aimed disarms the aim in
		// a render of its own; that render is the edit's and is spoken.
		await open("key-details");
		await sleep(300);
		await b.evaluate(`document.querySelector('#detail-list .hw-add:not([disabled])').click()`);
		await sleep(300);
		const aimed = await b.evaluate(`document.querySelector('#detail-list .hw-add.armed') !== null`);
		// Headless Chrome does not fire focus on an unfocused window; the
		// picker opens from its focus listener. "+ all" acts on mousedown.
		await b.evaluate(`(() => { const i = document.getElementById("pickerd-search"); i.focus(); i.dispatchEvent(new Event("focus")); })()`);
		await sleep(900);
		await b.evaluate(`document.querySelector('#pickerd-list .hw-group-add').dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))`);
		await sleep(400);
		const allNote = await note("#detail-list");
		const allSaid = await said();
		check("FA01: + all while a tile is aimed says the list's new note", aimed && allNote !== "" && allSaid === allNote, JSON.stringify({ aimed, allNote, allSaid }));
		// FA06: Readings per tile regroups the list; the new note is spoken
		// (the panel's first delivery of that setting stays quiet).
		await open("key-details");
		await sleep(300);
		const perTileOpen = await said();
		const perTileBefore = await note("#detail-list");
		await b.evaluate(`(() => { const s = document.getElementById("f-density"); s.value = s.value === "2" ? "3" : "2"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
		await sleep(900);
		const perTileAfter = await note("#detail-list");
		const perTileSaid = await said();
		check("FA06: changing Readings per tile says the regrouped note; opening said nothing", perTileOpen === "" && perTileAfter !== perTileBefore && perTileSaid === perTileAfter, JSON.stringify({ perTileOpen, perTileBefore, perTileAfter, perTileSaid }));
		// AX24: the same change arriving from elsewhere (a settings delivery,
		// no person here) regroups the list quietly.
		await open("key-details");
		await sleep(300);
		const echoBefore = await note("#detail-list");
		sim.pushSettings({ ...sim.settings, detailDensity: "2" });
		await sleep(900);
		const echoAfter = await note("#detail-list");
		const echoSaid = await said();
		check("AX24: Readings per tile arriving from elsewhere regroups the list quietly", echoAfter !== echoBefore && echoSaid === "" && sim.writes.length === 0, JSON.stringify({ echoBefore, echoAfter, echoSaid, ...writes() }));
		// FA02: on Custom with two touch zones a tap set to switch groups
		// never fires, yet the map keeps group boundaries: the line says so
		// instead of "turns run through all groups as one list".
		const cg = sim.fixtures["dial-custom-gestures"].settings;
		const K = sim.keys;
		await open("dial-custom-gestures", { settings: { ...cg, gestureTap: "stepGroup", rotationKeys: [K.cpu, K.cpuPower, K.gpu, K.hot], rotationGroups: [{ name: "CPU", keys: [K.cpu, K.cpuPower] }, { name: "GPU", keys: [K.gpu, K.hot] }] } });
		await sleep(300);
		const tapHelp = await b.evaluate(`document.getElementById("rotation-help").textContent`);
		check("FA02: a tap switch under two touch zones is named as never firing, and turns stay inside a group", /Turns stay inside a group; the tap set to Switch sensor or group never fires with two touch zones/.test(tapHelp) && !/as one list/.test(tapHelp), JSON.stringify(tapHelp));
	}

	// ---- round 3: the status region's Gadget line and Check again --------------
	{
		// R11: a healthy Gadget source says one line on every panel; the
		// plugin's whole account is under Advanced > Connection.
		await open("key-configured", { data: "gadget" });
		const gadget = await b.evaluate(`({ tone: document.getElementById("reading-status").dataset.tone, text: document.getElementById("reading-status").textContent, more: document.getElementById("source-now").textContent, moreShown: !document.getElementById("source-now").hidden })`);
		check("R11: a healthy Gadget source shows one line, and its whole account sits under Connection", gadget.tone === "info" && gadget.text === "Gadget registry: current values only, no min, max or average." && gadget.moreShown && gadget.more.startsWith("Reading via HWiNFO's Gadget registry"), JSON.stringify(gadget));
		// A withheld reading asks the person to act: the whole hint stays.
		const withheld = sampleSnapshot();
		withheld.blockedReadingCount = 1;
		await open("key-configured", { data: "gadget", snapshot: withheld });
		const kept = await b.evaluate(`document.getElementById("reading-status").textContent`);
		check("R11: a withheld-reading note stays whole in the status region", /Untick or relabel one of the two in HWiNFO/.test(kept), kept);
		// R20: Check again (was Retry now) answers even when nothing changed.
		await open("key-unavailable");
		const before = await b.evaluate(`({ label: document.querySelector('#reading-status [data-status-action="retry"]')?.textContent ?? null, ack: document.querySelector("#reading-status .hw-status-ack")?.textContent ?? null })`);
		await b.click('#reading-status [data-status-action="retry"]');
		await sleep(400);
		const after = await b.evaluate(`({ ack: document.querySelector("#reading-status .hw-status-ack")?.textContent ?? null, focus: document.activeElement?.dataset.statusAction ?? null })`);
		check("R20: Check again says when the same answer came back and how often the plugin reads, keeping focus on the button", before.label === "Check again" && before.ack === "" && /^Checked again at .+: no change yet\. The plugin also reads HWiNFO every 1 s on its own\.$/.test(after.ack ?? "") && after.focus === "retry" && sim.writes.length === 0, JSON.stringify({ before, after }));
	}

	// ---- round 3 re-review: presses the panel must not take ------------------
	{
		const K = sim.keys;
		const dialFx = sim.fixtures["dial-configured"];
		// A real double click: two presses at one resting point, the second
		// after the first opened the list and the page moved under it.
		const doubleAt = async (selector) => {
			const box = await b.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
			await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
			for (const clickCount of [1, 2]) {
				await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount });
				await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount });
				await sleep(90);
			}
			await sleep(300);
		};
		await b.viewport(373, 410, 1.5);
		for (const [fixture, selector, what] of [
			["key-empty", "#picker-search", "the reading search on an empty key"],
			["key-configured", "#picker-search", "the reading search on a configured key"],
			["dial-configured", "#pickerr-search", "the dial's rotation search"]
		]) {
			await open(fixture);
			// From the top, and just far enough down to have the field whole
			// on screen (the dial's Strip section sits above Reading).
			await b.evaluate(`(() => { window.scrollTo(0, 0); document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: "nearest" }); })()`);
			await doubleAt(selector);
			const after = await b.evaluate(`({ y: scrollY, focus: document.activeElement?.id ?? null })`);
			check(`re-review: a double click on ${what} at 373 x 410 opens it and picks or ticks nothing`, sim.writes.length === 0 && after.focus === selector.slice(1), JSON.stringify({ after, ...writes() }));
		}
		await open("key-missing");
		await b.evaluate("window.scrollTo(0, 0)");
		const savedKey = sim.settings.readingKey;
		await doubleAt('#reading-status [data-status-action="pick"]');
		check("re-review: a double click on Pick another reading opens the picker and keeps the saved reading", sim.writes.length === 0 && sim.settings.readingKey === savedKey && (await b.evaluate(`document.activeElement?.id`)) === "picker-search", JSON.stringify(writes()));
		await b.viewport(400, 900, 1);

		// A held Enter arms a group remove once and never confirms it.
		const groups = [{ name: "", keys: [K.cpu, K.cpuPower] }, { name: "", keys: [K.gpu, K.hot] }];
		const withGroups = { ...dialFx.settings, controlPreset: "elite", readingKey: K.gpu, rotationKeys: [K.cpu, K.cpuPower, K.gpu, K.hot], rotationGroups: groups };
		await open("dial-configured", { settings: withGroups });
		const remove0 = '#rotation-set .hw-group-remove[data-group="0"]';
		await b.evaluate(`document.querySelector('${remove0}').focus()`);
		await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
		for (let i = 0; i < 12; i++) {
			await sleep(60);
			await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", autoRepeat: true });
		}
		await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
		await sleep(200);
		const held = await b.evaluate(`({ armed: document.querySelector('${remove0}')?.dataset.armed ?? null, groups: document.querySelectorAll("#rotation-set .hw-group-head").length })`);
		check("re-review: holding Enter on a group's remove arms it once and never removes it", held.armed === "true" && held.groups === 2 && sim.writes.length === 0, JSON.stringify({ held, ...writes() }));
		// The arm survives a rebuild from an echo (the dial turned).
		sim.settings = { ...sim.settings, readingKey: K.hot };
		sim.piWs.send(JSON.stringify({ event: "didReceiveSettings", action: "com.lawrensen.hwinfo.dial", context: sim.context, device: "dev1", payload: { settings: sim.settings } }));
		await sleep(400);
		const afterEcho = await b.evaluate(`({ armed: document.querySelector('${remove0}')?.dataset.armed ?? null, text: document.querySelector('${remove0}')?.textContent ?? "", focus: document.activeElement?.classList.contains("hw-group-remove") ?? false })`);
		check("re-review: an armed remove stays armed, in words, through a rebuild from the dial turning", afterEcho.armed === "true" && afterEcho.text === "Remove group 1 and its 2 readings?" && sim.writes.length === 0, JSON.stringify(afterEcho));
		await b.key("Enter");
		await sleep(300);
		check("re-review: a fresh press after the rebuild removes the group in one frame", sim.writes.length === 1 && (sim.settings.rotationGroups ?? []).length === 1, JSON.stringify({ ...writes(), groups: sim.settings.rotationGroups }));

		// Merging two unnamed groups that hold readings asks first.
		await open("dial-configured", { settings: withGroups });
		await b.click('#rotation-set button[data-set-action="merge"]');
		await sleep(200);
		const merge = await b.evaluate(`(() => { const m = document.querySelector('#rotation-set button[data-set-action="merge"]'); return { text: m?.textContent ?? "", label: m?.getAttribute("aria-label") ?? "" }; })()`);
		check("re-review: Merge of two unnamed groups holding readings arms first and writes nothing", merge.text === "Merge 2 groups into one list?" && merge.label.startsWith("Merge 2 groups into one list?") && sim.writes.length === 0, JSON.stringify({ merge, ...writes() }));

		// Before two groups hold readings, the groups line speaks of later.
		await open("dial-configured", { settings: { ...withGroups, rotationGroups: [{ name: "", keys: [K.cpu, K.cpuPower] }, { name: "", keys: [] }] } });
		await sleep(150);
		const pending = await b.evaluate(`document.getElementById("rotation-help").textContent`);
		check("re-review: with one group holding readings, the groups line says what happens once two do", pending === "New ticks go to the marked group. Once two groups hold readings, turns stay inside a group and a pressed turn jumps between them.", pending);

		// The dial holds while its reading is missing, and says so.
		await open("dial-missing");
		await sleep(150);
		const hold = await b.evaluate(`document.getElementById("picker-moves").textContent`);
		check("re-review: with the dial's reading missing, the picker line says nothing moves the dial", hold === "Nothing moves the dial while its reading is missing; pick another to move on.", hold);
		check("re-review: the status region reads out only what changed", (await b.evaluate(`document.getElementById("reading-status").getAttribute("aria-atomic")`)) === "false");

		// Copy support report says its outcome through the live region.
		await open("control-default");
		await b.evaluate(`(() => { navigator.clipboard.writeText = () => Promise.resolve(); for (let n = document.getElementById("support-report"); n; n = n.parentElement) if (n.tagName === "DETAILS") n.open = true; })()`);
		await b.click("#support-report");
		await sleep(600);
		const spoken = await b.evaluate(`[...document.querySelectorAll('[role="status"]')].map((n) => n.textContent).join(" | ")`);
		check("re-review: Copy support report announces its outcome", /Copied/.test(spoken), spoken);

		// At 200% zoom, focusing the detail search keeps it in view (AY09).
		const inView = [];
		for (const width of [189, 160]) {
			await b.viewport(width, 410, 2);
			await open("key-configured", { settings: { ...sim.fixtures["key-configured"].settings, pressBehavior: "open-details", detailMode: "custom", detailKeys: [K.gpu, K.hot, K.drive0, K.drive1, K.cpuPower, K.gpuPower] } });
			await b.evaluate(`(() => { const s = document.getElementById("pickerd-search"); for (let n = s; n; n = n.parentElement) if (n.tagName === "DETAILS") n.open = true; s.scrollIntoView({ block: "center" }); })()`);
			await sleep(150);
			await b.evaluate(`document.getElementById("pickerd-search").focus()`);
			await sleep(300);
			inView.push(await b.evaluate(`(() => { const r = document.getElementById("pickerd-search").getBoundingClientRect(); return { width: ${width}, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight }; })()`));
		}
		await b.viewport(400, 900, 1);
		check("re-review: at 200% zoom the detail search stays in view when its list opens", inView.every((m) => m.top >= 0 && m.bottom <= m.vh) && sim.writes.length === 0, JSON.stringify(inView));
	}

	// ---- truth: a blank stored on a shared select ---------------------------
	// A blank ("" or spaces) is no newer version's choice: every shared
	// select shows what the plugin draws for it, with no kept option, and
	// opening writes nothing. Its default, except Read every, which the
	// plugin reads as 0 and clamps to 250 ms, and the theme, where the deck
	// keeps the theme it resolved (Forest here, from the panel before). A
	// value this version does not offer still shows as kept.
	{
		const SHARED = { "shared-theme": "theme", "shared-text": "textMode", "shared-font": "textFont", "shared-accents": "typeAccents", "shared-units": "dataUnits", "shared-source": "source", "shared-poll": "pollIntervalMs" };
		const DRAWN = { "shared-theme": "Forest", "shared-text": "Theme text", "shared-font": "Tahoma", "shared-accents": "By sensor type", "shared-units": "Decimal (KB, MB, GB; rates in Mbps)", "shared-source": "Auto (Shared Memory, else Gadget)", "shared-poll": "250 ms" };
		const shownShared = () => b.evaluate(`Object.fromEntries(${JSON.stringify(Object.keys(SHARED))}.map((id) => { const s = document.getElementById(id); return [id, { shown: s.selectedOptions[0]?.textContent ?? null, kept: s.querySelectorAll("option[data-unknown]").length }]; }))`);
		for (const fixture of ["key-configured", "dial-configured"]) {
			for (const blank of ["", " "]) {
				sim.setFixture(fixture, { globals: { theme: "forest" } }); // the plugin resolves Forest
				await open(fixture, { globals: Object.fromEntries(Object.values(SHARED).map((k) => [k, blank])) });
				await sleep(250);
				const shown = await shownShared();
				const wrong = Object.keys(SHARED).filter((id) => shown[id].shown !== DRAWN[id] || shown[id].kept !== 0);
				check(`truth (${fixture}): every shared select with ${JSON.stringify(blank)} stored shows what the plugin draws, with no kept value`, wrong.length === 0, JSON.stringify(Object.fromEntries(wrong.map((id) => [id, shown[id]]))));
				noWrites(`truth (${fixture}): a shared ${JSON.stringify(blank)}`);
			}
			await open(fixture, { globals: { theme: "void", textMode: "neon-future" } });
			await sleep(250);
			const future = await shownShared();
			check(`truth (${fixture}): a shared Text color this version does not offer still shows as kept`, future["shared-text"].shown === 'Stored value "neon-future" (not in this list, kept)' && future["shared-text"].kept === 1, JSON.stringify(future["shared-text"]));
			noWrites(`truth (${fixture}): a kept shared Text color`);
		}
	}

	// ---- truth: data states --------------------------------------------------
	await open("key-unavailable");
	const down = await b.evaluate(`({ ph: document.getElementById("picker-search").placeholder, missing: document.getElementById("picker-search").classList.contains("missing"), tone: document.getElementById("reading-status").dataset.tone, state: document.getElementById("head-state").textContent })`);
	check("truth: an unavailable source never reads as a missing reading", !/not found/i.test(down.ph) && !down.missing && down.tone === "danger" && down.state === "No HWiNFO data", JSON.stringify(down));
	await b.click('#reading-status [data-status-action="setup"]');
	await sleep(150);
	const setup = await b.evaluate(`({ open: document.getElementById("setup-help").open, focus: document.activeElement === document.querySelector("#setup-help > summary") })`);
	check("truth: HWiNFO setup steps opens the steps themselves and puts focus on them (one click, bench 2026-09-23)", setup.open && setup.focus, JSON.stringify(setup));
	// A source forced to one provider says so in the unavailable state and
	// points at the setting; Auto (the fixture's globals) says nothing extra.
	const autoLines = await b.evaluate(`[...document.querySelectorAll("#reading-status p")].map((p) => p.textContent).join(" ")`);
	await open("key-unavailable", { globals: { ...sim.fixtures["key-unavailable"].globals, source: "gadget" } });
	const forced = await b.evaluate(`({ text: [...document.querySelectorAll("#reading-status p")].map((p) => p.textContent).join(" "), action: document.querySelector('#reading-status [data-status-action="source"]')?.textContent ?? null })`);
	check("truth: a forced data source is named in the unavailable state, with a way to the setting", /Data source is set to Gadget registry only, so Shared Memory is never read/.test(forced.text) && forced.action === "Data source setting" && !/Data source is set/.test(autoLines), JSON.stringify({ forced, autoLines }));
	await b.click('#reading-status [data-status-action="source"]');
	await sleep(150);
	const toSource = await b.evaluate(`({ focus: document.activeElement?.id ?? null, open: document.getElementById("sec-connection")?.open ?? null })`);
	check("truth: the way to the setting opens Connection and focuses Data source, writing nothing", toSource.focus === "shared-source" && toSource.open === true && sim.writes.length === 0 && sim.globalWrites.length === 0, JSON.stringify(toSource));
	// The poller riding out a source reopen on the last values (D9, bench
	// 2026-09-23): never "Live" while held.
	await open("key-configured", { data: "holding" });
	const held = await b.evaluate(`({ state: document.getElementById("head-state").textContent, tone: document.getElementById("head-state").dataset.tone, status: document.getElementById("reading-status").textContent })`);
	check("truth: a held source reads Reopening, never Live", held.state === "Reopening source · key unchanged" && held.tone === "warn" && /reopening HWiNFO's data source/.test(held.status) && /up to 15 s/.test(held.status), JSON.stringify(held));
	await open("key-missing");
	const miss = await b.evaluate(`({ ph: document.getElementById("picker-search").placeholder, tone: document.getElementById("reading-status").dataset.tone, head: document.getElementById("head-reading").textContent, label: document.getElementById("f-label").value })`);
	check("truth: a missing reading is named, its label kept, a repair offered", /not found/i.test(miss.ph) && miss.tone === "warn" && miss.head === "Old CPU" && miss.label === "Old CPU", JSON.stringify(miss));
	// The status sits above the palette; its repair reaches the picker.
	await b.evaluate(`document.getElementById("sec-reading").open = false`);
	await b.click('#reading-status [data-status-action="pick"]');
	await sleep(200);
	const picked = await b.evaluate(`({ focus: document.activeElement?.id ?? null, open: document.getElementById("sec-reading").open, list: document.getElementById("picker-list").hidden === false })`);
	check("truth: Pick another reading opens Reading and puts focus in the picker, writing nothing", picked.focus === "picker-search" && picked.open === true && picked.list === true && sim.writes.length === 0, JSON.stringify(picked));
	await open("key-stale");
	// The fixture's evidence clock reads 42 s; the header carries that age
	// (the face's own words, then how long), never "Live".
	check("truth: stale is never Live, and says how long no new data arrived", (await b.evaluate(`document.getElementById("head-state").textContent`)) === "Not updating for 42 s");
	const staleAlt = await b.evaluate(`document.getElementById("face-img").alt`);
	check("truth: the face's alt text reads what the face draws, not a stale value", /Not updating/.test(staleAlt) && !/67\.4/.test(staleAlt), staleAlt);
	// A ticking stale count never rebuilds the status region or drops focus.
	await b.evaluate(`window.__mut = 0; new MutationObserver((l) => { window.__mut += l.length; }).observe(document.getElementById("reading-status"), { childList: true, subtree: true, characterData: true }); document.querySelector('#reading-status [data-status-action="retry"]').focus();`);
	const lastStale = sim.toPiLog.filter((m) => m.event === "preview").at(-1);
	for (let i = 0; i < 4; i++) {
		sim.piWs.send(JSON.stringify({ event: "sendToPropertyInspector", action: "com.lawrensen.hwinfo.reading", context: sim.context, payload: { ...lastStale, hint: `HWiNFO stopped updating ${50 + i}s ago.` } }));
		await sleep(80);
	}
	const tick = await b.evaluate(`({ mutations: window.__mut, focus: document.activeElement?.dataset?.statusAction ?? document.activeElement?.tagName, live: document.getElementById("reading-status").getAttribute("aria-live") })`);
	check("truth: a ticking stale count leaves the status region and its focus alone", tick.mutations === 0 && tick.focus === "retry" && tick.live === "polite", JSON.stringify(tick));
	// The state line while the data stays stale (the K1 rule): its age
	// counts up, and a longer age ("2 h 0 min") used to wrap the line onto
	// one more, so the header grew and every section under it moved. While
	// it shows an age the line now keeps, unseen in its cell, the room of
	// the longest age it writes under 100 h ("99 h 59 min"; its digits are
	// tabular), so with every fold shut no section moves and the header
	// keeps its height as the age grows from 15 s, on a key and on a dial,
	// at 378, 302, 252 and 189 px and in high contrast, writing nothing.
	// Live again, the line keeps no room. The unseen line is aria-hidden,
	// out of the accessibility tree, never painted or focusable, and the
	// count never touches it.
	{
		const STATE = '#hw-head [aria-hidden="true"].hw-state';
		const LAYOUT = `(() => {
			const tops = {};
			for (const e of document.querySelectorAll('#reading-status, [id^="sec-"]')) if (e.getClientRects().length > 0) tops[e.id] = Math.round((e.getBoundingClientRect().top + scrollY) * 10) / 10;
			const unseen = [...document.querySelectorAll(${JSON.stringify(STATE)})];
			return {
				text: document.getElementById("head-state").textContent,
				head: Math.round(document.getElementById("hw-head").getBoundingClientRect().height * 10) / 10,
				tops,
				unseen: unseen.map((e) => e.textContent),
				painted: unseen.filter((e) => getComputedStyle(e).visibility !== "hidden").length,
				focusable: unseen.filter((e) => { e.focus(); return document.activeElement === e; }).length
			};
		})()`;
		const ages = [15, 42, 61, 59 * 60, 2 * 3600, 23 * 3600 + 59 * 60, 99 * 3600 + 59 * 60].map((s) => s * 1000);
		const age = async (ms) => {
			const p = structuredClone(sim.toPiLog.filter((m) => m.event === "preview").at(-1));
			p.staleForMs = ms;
			sim.sendToPi(p);
			await sleep(150);
			return b.evaluate(LAYOUT);
		};
		const room = ["Not updating for 99 h 59 min"];
		const moves = [];
		const seen = [];
		const live = [];
		let ignored = [];
		let roomChanges = 0;
		let wrote = 0;
		await b.send("DOM.enable");
		await b.send("Accessibility.enable");
		try {
			for (const fixture of ["key-stale", "dial-configured"]) {
				for (const forced of [false, true]) {
					await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: forced ? "active" : "none" }] });
					await b.viewport(378, 900, 1);
					await open(fixture, { data: "stale" });
					await b.evaluate(`(() => {
						document.querySelectorAll("details.hw-sec").forEach((d) => { d.open = false; });
						const shown = document.getElementById("head-state");
						window.__roomChanges = 0;
						new MutationObserver((records) => { for (const r of records) if (r.target !== shown && !shown.contains(r.target)) window.__roomChanges++; }).observe(shown.parentElement, { childList: true, subtree: true, characterData: true, attributes: true });
					})()`);
					for (const width of forced ? [302, 252] : [378, 302, 252, 189]) {
						await b.viewport(width, 900, 1);
						const first = await age(ages[0]);
						seen.push(first);
						for (const ms of ages.slice(1)) {
							const now = await age(ms);
							seen.push(now);
							const moved = Object.keys({ ...first.tops, ...now.tops }).filter((id) => first.tops[id] !== now.tops[id]);
							if (now.head !== first.head || moved.length > 0) moves.push({ fixture, width, forced, text: now.text, head: [first.head, now.head], moved: moved.length });
						}
					}
					const doc = await b.send("DOM.getDocument", { depth: 0 });
					const { nodeIds } = await b.send("DOM.querySelectorAll", { nodeId: doc.root.nodeId, selector: STATE });
					for (const nodeId of nodeIds) ignored.push((await b.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false })).nodes[0]?.ignored === true);
					roomChanges += await b.evaluate("window.__roomChanges");
					sim.data = "ok";
					sim.pushPreview();
					await sleep(150);
					live.push({ fixture, forced, ...(await b.evaluate(LAYOUT)) });
					wrote += sim.writes.length + sim.globalWrites.length;
				}
			}
		} finally {
			await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "none" }] });
			await b.send("Accessibility.disable").catch(() => {});
			await b.viewport(400, 900, 1);
		}
		const texts = [...new Set(seen.map((s) => s.text))];
		check("H2 (stale age): with every fold shut, the age growing from 15 s to 99 h 59 min moves no section and keeps the header's height, on a key and a dial, at 378, 302, 252 and 189 px and in high contrast, writing nothing", texts.length === ages.length && moves.length === 0 && wrote === 0, JSON.stringify({ texts, moves: moves.slice(0, 6), count: moves.length, wrote }));
		check("H2 (stale age): while it shows an age the line holds, unseen, the room of the longest age under 100 h, and live again it holds none", seen.every((s) => same(s.unseen, room)) && live.every((l) => l.text === "Live · Shared Memory" && l.unseen.length === 0), JSON.stringify({ stale: [...new Set(seen.map((s) => JSON.stringify(s.unseen)))], live: live.map((l) => [l.text, l.unseen]) }));
		check("H2 (stale age): the unseen line is never painted (high contrast too), focusable or in the accessibility tree, and the count never touches it", ignored.length === 4 && ignored.every(Boolean) && seen.every((s) => s.painted === 0 && s.focusable === 0) && roomChanges === 0, JSON.stringify({ ignored, painted: seen.filter((s) => s.painted > 0).length, focusable: seen.filter((s) => s.focusable > 0).length, roomChanges }));
	}
	await open("key-zero-negative");
	check("truth: valid zero and negative render as values", (await b.evaluate(`document.getElementById("head-state").textContent`)).startsWith("Live"));
	// Reading to link names the dial's readings the way the tree does, though
	// its settings reach the panel before the tree.
	await open("dial-configured");
	const focusOptions = await b.evaluate(`[...document.getElementById("links-focus").options].map((o) => ({ value: o.value, text: o.textContent, label: hwShell.labelOf(o.value) }))`);
	check("truth: Reading to link names each reading as the tree does, never by its key", focusOptions.length === 3 && focusOptions.every((o) => o.label !== null && o.text === o.label && o.text !== o.value), JSON.stringify(focusOptions));
	noWrites("truth: Reading to link names");


	// ---- stored: documents a 1.8 candidate wrote for a key press that opened
	// an app or website, or for a remote PC's reading. Opening the panel on
	// one writes nothing, the face draws, and nothing names what is gone.
	{
		const launchTarget = { kind: "url", url: "https://example.com/status", stamp: "c3RhbXA" };
		// rm: and the base64url of ["DESKTOP-7Q2", "f0000501", 0, "1000000"].
		const remoteKey = "rm:WyJERVNLVE9QLTdRMiIsImYwMDAwNTAxIiwwLCIxMDAwMDAwIl0";
		const headFace = () => b.evaluate(`(() => { const src = document.getElementById("face-img")?.getAttribute("src") ?? ""; return src.startsWith("data:image/svg+xml,") ? decodeURIComponent(src.slice(19)) : null; })()`);
		const gone = () => b.evaluate(`({ launch: document.querySelector('[id^="launch-"], [id^="f-launch-"]') !== null, remote: document.getElementById("sec-remote") !== null || document.getElementById("machine-filter") !== null, words: /Remote PCs|DESKTOP-7Q2|PC offline|Remote off|app or website/.test(document.body.innerText) })`);
		const shown = [];
		for (const press of ["launch", "tap-cycle-hold-launch", "tap-launch-hold-details"]) {
			await open("key-configured", { settings: { readingKey: sim.keys.cpu, pressBehavior: press, launch: launchTarget, futureBlob: FUTURE_BLOB } });
			await sleep(250);
			const face = await headFace();
			const select = await b.evaluate(`(() => { const s = document.getElementById("f-press"); return { value: s.value, text: s.selectedOptions[0]?.textContent ?? null, kept: s.querySelectorAll("option[data-unknown]").length }; })()`);
			shown.push({ press, select, face: face !== null && face === sim.face() && face.includes("<svg"), writes: writes(), gone: await gone() });
		}
		check("stored (key): a launch press shows the default press, the face draws, and opening writes nothing", shown.every((s) => s.select.value === "" && s.select.text === "Cycles current, min, max, avg" && s.select.kept === 0 && s.face && s.writes.settings === 0 && s.writes.globals === 0 && !s.gone.launch && !s.gone.words), JSON.stringify(shown));

		await open("key-configured", { settings: { readingKey: remoteKey, futureBlob: FUTURE_BLOB } });
		await sleep(250);
		const keyFace = await headFace();
		const keyGone = await gone();
		const keyStatus = await b.evaluate(`document.getElementById("picker-search").placeholder`);
		check("stored (key): a remote PC's reading draws the plain missing state, and opening writes nothing", keyFace !== null && keyFace === sim.face() && keyFace.includes("Sensor missing") && /not found/i.test(keyStatus) && !keyGone.remote && !keyGone.words && sim.writes.length === 0 && sim.globalWrites.length === 0, JSON.stringify({ face: keyFace?.length ?? null, missing: keyFace?.includes("Sensor missing"), keyStatus, keyGone, writes: writes() }));

		await open("dial-configured", { settings: { readingKey: remoteKey, futureBlob: FUTURE_BLOB } });
		await sleep(250);
		const dialFace = await headFace();
		const dialGone = await gone();
		check("stored (dial): a remote PC's reading draws the plain missing state, and opening writes nothing", dialFace !== null && dialFace === sim.face() && dialFace.includes("Sensor missing") && !dialGone.remote && !dialGone.words && sim.writes.length === 0 && sim.globalWrites.length === 0, JSON.stringify({ face: dialFace?.length ?? null, missing: dialFace?.includes("Sensor missing"), dialGone, writes: writes() }));

		// Shared settings holding the Remote PCs switch, a bound PC, a rebind
		// and this machine's launch approvals key: nothing shows them, opening
		// writes nothing, and the next shared edit keeps every one of them.
		const parked = { remoteSources: "on", remoteMachines: [{ id: "bind:0123456789abcdef", label: "Lab PC", fingerprint: "AAAAAAAAAAAAAAAAAAAAAA" }], remoteMachineAliases: { "OLD-PC": "DESKTOP-7Q2" }, launchKey: "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=" };
		const kept = [];
		for (const fixture of ["key-configured", "dial-configured"]) {
			await open(fixture, { globals: { ...sim.fixtures[fixture].globals, ...parked } });
			await sleep(250);
			const opened = { gone: await gone(), writes: writes(), face: (await headFace()) === sim.face() };
			await b.evaluate(`(() => { const s = document.getElementById("shared-font"); s.closest("details")?.setAttribute("open", ""); s.value = "segoe-ui"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
			await sleep(400);
			const doc = sim.globalWrites.at(-1) ?? {};
			kept.push({ fixture, opened, edits: sim.globalWrites.length, font: doc.textFont, kept: Object.keys(parked).filter((k) => same(doc[k], parked[k])) });
		}
		check("stored (globals): the Remote PCs switch, binds and launch key are shown by nothing, opening writes nothing, and a shared edit keeps them", kept.every((k) => !k.opened.gone.remote && !k.opened.gone.words && k.opened.writes.settings === 0 && k.opened.writes.globals === 0 && k.opened.face && k.edits === 1 && k.font === "segoe-ui" && k.kept.length === Object.keys(parked).length), JSON.stringify(kept));
	}

	// ---- parity: the header face is the renderer's face, byte for byte -------
	const parityFixtures = ["key-configured", "key-dense", "key-triple", "key-custom-dim", "key-inherited", "key-alert", "key-back", "key-zero-negative", "key-unavailable", "key-stale", "key-missing", "dial-configured", "dial-groups", "dial-alert", "dial-unavailable", "dial-missing", "key-formats", "key-formats-junk", "dial-formats", "dial-formats-twins"];
	const extraKey = [
		["key dual", "key-configured", { keyLayout: "dual", secondaryReadingKey: sim.keys.gpu }],
		["key quad labels", "key-dense", { quadLabels: true }],
		["key ring", "key-configured", { displayMode: "ring" }],
		["key bar crit", "key-alert", { displayMode: "bar", critValue: "60" }],
		["key paper dim", "key-configured", { theme: "paper", textMode: "dim" }],
		["dial tworow", "dial-configured", { dialView: "tworow" }],
		["dial overview bottom", "dial-configured", { dialView: "overview", overviewHeader: "bottom", overviewSeparators: "off" }],
		["key formats triple", "key-formats", { keyLayout: "triple" }],
		["key formats dual", "key-formats", { keyLayout: "dual" }],
		["key formats single max", "key-formats", { keyLayout: "single", statMode: "max" }],
		["key formats overflow", "key-formats", { readingFormats: { [sim.keys.memUsed]: { unit: "B", decimals: "3" } } }],
		["dial formats tworow", "dial-formats", { dialView: "tworow" }],
		["dial formats single", "dial-formats", { dialView: "single" }]
	];
	const parityRuns = [...parityFixtures.map((f) => [f, f, {}]), ...extraKey];
	for (const [name, fixture, over] of parityRuns) {
		await open(fixture, { settings: { ...sim.fixtures[fixture].settings, ...over } });
		sim.pushPreview();
		await sleep(250);
		const shown = await b.evaluate(`(() => { const src = document.getElementById("face-img").getAttribute("src") ?? ""; return src.startsWith("data:image/svg+xml,") ? decodeURIComponent(src.slice(19)) : null; })()`);
		check(`parity ${name}: header face equals the renderer's face`, shown !== null && shown === sim.face(), shown === null ? "no face" : `${shown.length} vs ${sim.face().length} bytes`);
	}
	await open("control-default");
	check("parity: the Control panel shows no face and no fake value", (await b.evaluate(`document.getElementById("face-img") === null && !/\\d+(\\.\\d+)?\\s?°/.test(document.body.innerText)`)) === true);
	// An empty Link ID says what it reaches: every strip under a Strip
	// command, every dial under the others.
	const emptyTarget = async (command) => {
		await b.evaluate(`(() => { const s = document.getElementById("f-command"); s.value = ${JSON.stringify(command)}; s.dispatchEvent(new Event("change")); })()`);
		await sleep(200);
		return b.evaluate(`document.getElementById("f-target").placeholder`);
	};
	const stripEmpty = await emptyTarget("stripScreenNext");
	const dialEmpty = await emptyTarget("next");
	check("truth: an empty Link ID reads Every strip under a Strip command and Every dial under a dial command", stripEmpty === "Every strip" && dialEmpty === "Every dial", JSON.stringify({ stripEmpty, dialEmpty }));

	// ---- per-reading unit and decimals (issue #59) ---------------------------
	// Rows, options and names come from settings and the plugin's tree; a
	// select change is the only write and changes exactly readingFormats;
	// echoes, previews, trees and dial steps write nothing, never rebuild a
	// focused select and never move a box; junk and shapes this build cannot
	// edit are kept.
	{
		const k = sim.keys;
		const openFormats = async (fixture, overrides) => {
			await open(fixture, overrides);
			await b.evaluate(`(() => { document.getElementById("sec-display").open = true; document.getElementById("sec-formats").open = true; })()`);
			await sleep(150);
		};
		const rowsInfo = () =>
			b.evaluate(`[...document.querySelectorAll("#format-rows .hw-format-row")].map((row) => {
				const [unit, decimals] = row.querySelectorAll("select");
				const sel = (s) => s ? { id: s.id, value: s.value, disabled: s.disabled, options: [...s.options].map((o) => o.value + (o.disabled ? "!" : "")), texts: [...s.options].map((o) => o.textContent), groups: [...s.querySelectorAll("optgroup")].map((g) => g.label + ":" + [...g.children].map((o) => o.value).join(",")), label: s.getAttribute("aria-label"), title: s.title } : null;
				const p = row.querySelector("p");
				return { name: row.querySelector(".hw-label")?.textContent ?? "", unit: sel(unit), decimals: sel(decimals), note: p?.textContent ?? "", noteCut: p !== null && p.scrollWidth > p.clientWidth + 0.5, noteWidth: p === null ? 0 : [p.scrollWidth, p.clientWidth], height: row.getBoundingClientRect().height };
			})`);
		const pick = (row, which, value) =>
			b.evaluate(`(() => { const s = document.querySelectorAll("#format-rows .hw-format-row")[${row}]?.querySelectorAll("select")[${which === "unit" ? 0 : 1}]; if (!s) return false; s.focus(); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event("change")); return true; })()`);
		const boxes = () => b.evaluate(`[...document.querySelectorAll("#format-rows .hw-format-row, #format-rows select, #format-rows p")].map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.x * 10), Math.round(r.y * 10), Math.round(r.width * 10), Math.round(r.height * 10)].join(","); }).join(";")`);

		await openFormats("key-formats");
		let rows = await rowsInfo();
		check("formats: one row per configured slot", rows.length === 4, JSON.stringify(rows.map((r) => r.name)));
		check("formats: a byte reading offers Auto plus the plugin's units, showing its stored choice", same(rows[0]?.unit?.options, ["", "B", "KB", "MB", "GB", "TB", "KiB", "MiB", "GiB", "TiB"]) && rows[0]?.unit?.value === "GB" && rows[0]?.decimals?.value === "2", JSON.stringify(rows[0]));
		check("formats: the two families of HWiNFO's byte amounts are labelled groups (issue #59)", same(rows[0]?.unit?.groups, ["Steps of 1000:KB,MB,GB,TB", "Steps of 1024:KiB,MiB,GiB,TiB"]), JSON.stringify(rows[0]?.unit?.groups));
		check("formats: a temperature row keeps Unit at Auto, disabled, saying why", rows[2]?.unit?.disabled === true && rows[2]?.unit?.value === "" && /byte readings/.test(rows[2]?.unit?.title ?? ""), JSON.stringify(rows[2]?.unit));
		check("formats: Decimals offers Same as key with the key's value, then Auto and 0 to 3", same(rows[3]?.decimals?.texts, ["Same as key (Auto)", "Auto", "0", "1", "2", "3"]) && rows[3]?.decimals?.value === "", JSON.stringify(rows[3]?.decimals));
		check("formats: accessible names carry the slot and the reading", /^Unit for Reading 1: Physical Memory Used/.test(rows[0]?.unit?.label ?? "") && /^Decimals for Reading 2: GPU Memory Allocated/.test(rows[1]?.decimals?.label ?? ""), JSON.stringify([rows[0]?.unit?.label, rows[1]?.decimals?.label]));
		check("formats: the folded line says what is set", (await b.evaluate(`document.querySelector('[data-summary="formats"]')?.textContent`)) === "2 readings set");
		check("formats: no note while every number fits", rows.every((r) => r.note === ""), JSON.stringify(rows.map((r) => r.note)));
		noWrites("formats: open and unfold");

		let before = structuredClone(sim.settings);
		await pick(0, "unit", "MB");
		await sleep(300);
		let after = lastWrite();
		check("formats edit: one write", sim.writes.length === 1 && sim.globalWrites.length === 0, JSON.stringify(writes()));
		check("formats edit: changed exactly readingFormats", after !== undefined && same(changedKeys(before, after), ["readingFormats"]), JSON.stringify(after === undefined ? null : changedKeys(before, after)));
		check(
			"formats edit: the entry changed; its decimals, the other entries and their unknown fields are kept",
			same(after?.readingFormats?.[k.memUsed], { unit: "MB", decimals: "2" }) && same(after?.readingFormats?.[k.gpuMem], { unit: "GB", decimals: "2", future: { keep: true } }) && same(after?.readingFormats?.["f0099999:0:1000000"], { unit: "PB", note: "dormant" }) && same(after?.futureBlob, FUTURE_BLOB),
			JSON.stringify(after?.readingFormats)
		);
		await pick(0, "unit", "MB");
		await sleep(200);
		check("formats edit: the same choice again writes nothing", sim.writes.length === 1, JSON.stringify(writes()));
		await pick(0, "decimals", "auto");
		await sleep(200);
		check("formats edit: a Decimals change writes its field", same(lastWrite()?.readingFormats?.[k.memUsed], { unit: "MB", decimals: "auto" }) && sim.writes.length === 2, JSON.stringify(lastWrite()?.readingFormats));

		// Clearing the last choice removes the field itself.
		await openFormats("key-formats", { settings: { readingKey: k.memUsed, readingFormats: { [k.memUsed]: { unit: "GB" } }, futureBlob: FUTURE_BLOB } });
		await pick(0, "unit", "");
		await sleep(250);
		check("formats edit: clearing the last choice removes readingFormats", sim.writes.length === 1 && lastWrite() !== undefined && !Object.hasOwn(lastWrite(), "readingFormats") && same(lastWrite().futureBlob, FUTURE_BLOB), JSON.stringify(lastWrite()));

		// A slot re-picked elsewhere (an echo) shows the new reading; the old
		// reading's entry stays and nothing is written. A reading moved to
		// another slot keeps its format there.
		await openFormats("key-formats");
		const fx = sim.fixtures["key-formats"].settings;
		sim.pushSettings({ ...fx, secondaryReadingKey: k.cpu });
		await sleep(250);
		rows = await rowsInfo();
		check("formats: a re-picked slot shows its new reading, with no write", /CPU \(Tctl\/Tdie\)/.test(rows[1]?.name ?? "") && rows[1]?.unit?.disabled === true && sim.writes.length === 0, JSON.stringify([rows[1], writes()]));
		sim.pushSettings({ ...fx, readingKey: k.gpu, quadReadingKey3: k.memUsed });
		await sleep(250);
		rows = await rowsInfo();
		check("formats: a reading moved to another slot keeps its format", rows[2]?.unit?.value === "GB" && rows[2]?.decimals?.value === "2" && rows[0]?.unit?.value === "", JSON.stringify(rows.map((r) => [r.name, r.unit?.value])));
		noWrites("formats: re-pick and slot move echoes");

		// Focus holds through echoes, previews and a tree reply.
		await openFormats("key-formats");
		const focusedId = await b.evaluate(`(() => { const s = document.querySelector("#format-rows select"); s.focus(); return s.id; })()`);
		const boxesBefore = await boxes();
		for (let i = 0; i < 4; i++) sim.pushPreview();
		sim.pushSettings(structuredClone(sim.settings));
		sim.sendToPi(buildSensorTree(sim.status()));
		await sleep(300);
		check("formats race: focus, value and boxes hold through echoes, previews and a tree", (await b.evaluate(`document.activeElement?.id`)) === focusedId && (await b.evaluate(`document.activeElement?.value`)) === "GB" && (await boxes()) === boxesBefore, String(await b.evaluate(`document.activeElement?.id`)));
		noWrites("formats race");

		// A number the face draws past its own text (decimals dropped, or
		// compact): the row's note says what it shows and what would fit, in
		// its always-laid-out line (no box moves), and goes when it fits.
		await openFormats("key-formats", { settings: { ...fx, readingFormats: { [k.memUsed]: { unit: "B", decimals: "3" } } } });
		sim.pushPreview();
		await sleep(250);
		rows = await rowsInfo();
		const boxesWithNote = await boxes();
		const noteText = rows[0]?.note ?? "";
		check("formats: a reading the face draws past its own text says on its row what it shows and what fits", /^Shows \d+(\.\d+)?[kMGTPE]? B on this key\. [KMGT]B fits with 3 decimals\.$/.test(noteText) && rows[1]?.note === "", JSON.stringify(rows.map((r) => r.note)));
		check("formats: the note fits its line", rows[0]?.noteCut === false, JSON.stringify(rows[0]?.noteWidth));
		check("formats: the note takes no extra room", rows[0]?.height === rows[1]?.height, JSON.stringify(rows.map((r) => r.height)));
		const shownText = /^Shows (.+) B on/.exec(noteText)?.[1] ?? "";
		check("formats: the face draws the number the note names over its unit, never a lone ellipsis", shownText !== "" && sim.face().includes(`>${shownText}</text>`) && /<text[^>]*>B<\/text>/.test(sim.face()) && !/>…</.test(sim.face()), shownText);
		sim.pushSettings({ ...fx, readingFormats: { [k.memUsed]: { unit: "GB", decimals: "2" } } });
		sim.pushPreview();
		await sleep(250);
		rows = await rowsInfo();
		check("formats: the note goes when the reading's own text fits, and no box moves", rows[0]?.note === "" && (await boxes()) === boxesWithNote, JSON.stringify(rows.map((r) => r.note)));
		noWrites("formats: fallback note");

		// Junk is shown as kept and never rewritten until a change; then only
		// the edited field moves and prototype-named entries stay own.
		await openFormats("key-formats-junk");
		rows = await rowsInfo();
		check("formats junk: stored values this build does not offer show as kept, disabled", rows[0]?.unit?.options.at(-1) === "\u0000kept!" && rows[0]?.decimals?.options.at(-1) === "\u0000kept!" && /Stored value "gb"/.test(rows[0]?.unit?.texts.at(-1) ?? ""), JSON.stringify(rows[0]));
		check("formats junk: a rate reading offers no fixed unit", rows[1]?.unit?.disabled === true && same(rows[1]?.unit?.options, [""]), JSON.stringify(rows[1]?.unit));
		noWrites("formats junk: open");
		await pick(0, "unit", "GB");
		await sleep(250);
		const junkAfter = lastWrite()?.readingFormats;
		check("formats junk: one write; the edited entry keeps its other field; prototype names stay own entries", sim.writes.length === 1 && same(junkAfter?.[k.memUsed], { unit: "GB", decimals: 2 }) && junkAfter !== undefined && Object.hasOwn(junkAfter, "__proto__") && same(junkAfter.__proto__, { unit: "GB" }) && junkAfter.constructor === "junk", JSON.stringify(junkAfter));

		// A shape this build cannot edit: read-only, kept, and said so.
		await openFormats("key-formats-shape");
		rows = await rowsInfo();
		check("formats shape: the selects are disabled and the panel says the value is kept", rows[0]?.unit?.disabled === true && rows[0]?.decimals?.disabled === true && (await b.evaluate(`(() => { const n = document.getElementById("formats-note"); return !n.hidden && /does not edit; kept/.test(n.textContent); })()`)) === true, JSON.stringify(rows[0]));
		await b.evaluate(`(() => { const s = document.querySelector("#format-rows select"); s.disabled = false; s.value = "GB"; s.dispatchEvent(new Event("change")); })()`);
		await sleep(200);
		noWrites("formats shape: even a forced change");

		// Dial: one row per reading it can show; the list never moves as the
		// reading on the dial changes (auto cycle writes readingKey), in
		// normal and forced colors; nothing is written.
		await openFormats("dial-formats");
		rows = await rowsInfo();
		check("formats dial: one row per reading in the set", rows.length === 4 && rows[1]?.unit?.value === "GB" && same(rows[1]?.decimals?.texts.slice(0, 1), ["Same as dial (Auto)"]), JSON.stringify(rows.map((r) => [r.name, r.unit?.value])));
		for (const forced of [false, true]) {
			if (forced) await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
			await sleep(100);
			const start = await boxes();
			let moved = 0;
			for (const key of [...sim.fixtures["dial-formats"].settings.rotationKeys, k.gpuMem]) {
				sim.pushSettings({ ...sim.fixtures["dial-formats"].settings, readingKey: key });
				sim.pushPreview();
				await sleep(150);
				if ((await boxes()) !== start) moved++;
			}
			check(`formats dial: no row or select moves across the dial's steps${forced ? " (forced colors)" : ""}`, moved === 0, `moved on ${moved} steps`);
		}
		await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "none" }] });
		noWrites("formats dial: steps");
		const wide = await b.evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`);
		await b.viewport(300, 900);
		await sleep(150);
		const narrow = await b.evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth && [...document.querySelectorAll("#format-rows select")].every((s) => s.getBoundingClientRect().right <= document.documentElement.clientWidth)`);
		await b.viewport(400, 900);
		check("formats dial: no horizontal scroll at 400 and 300 px", wide === true && narrow === true, JSON.stringify({ wide, narrow }));

		// Twins: two readings with one name are told apart by their source.
		await openFormats("dial-formats-twins");
		rows = await rowsInfo();
		const names = rows.slice(0, 2).map((r) => r.unit?.label ?? "");
		check("formats twins: the two Drive Temperature rows have different names that include the source", names[0] !== names[1] && /from Drive \[#0\]/.test(names[0]) && /from Drive \[#1\]/.test(names[1]) && rows[1]?.decimals?.value === "2", JSON.stringify(names));
		noWrites("formats twins");

		// Issue #59 G4: a key's rows tell two readings with one name apart,
		// with the tag the dial rows use; a dial with no rotation set lists
		// its picked reading first.
		await openFormats("key-formats", { settings: { readingKey: k.drive0, keyLayout: "dual", secondaryReadingKey: k.drive1 } });
		rows = await rowsInfo();
		check("formats key twins: each row names its reading's source tag", /^Reading 1: Drive Temperature #0\b/.test(rows[0]?.name ?? "") && /^Reading 2: Drive Temperature #1\b/.test(rows[1]?.name ?? ""), JSON.stringify(rows.map((r) => r.name)));
		noWrites("formats key twins");
		await openFormats("dial-formats", { settings: { readingKey: k.gpuMem } });
		rows = await rowsInfo();
		check("formats dial without a rotation set: the picked reading's row comes first", /^GPU Memory Allocated\b/.test(rows[0]?.name ?? "") && rows.length > 1, JSON.stringify(rows.map((r) => r.name)));
		// The dial turns through its sensor (it saves the new reading): no row moves.
		const order = rows.map((r) => r.name).join("|");
		sim.pushSettings({ readingKey: k.gpu });
		await sleep(250);
		check("formats dial without a rotation set: a turn to another reading of the sensor moves no row", (await rowsInfo()).map((r) => r.name).join("|") === order, JSON.stringify((await rowsInfo()).map((r) => r.name)));
		noWrites("formats dial without a rotation set");
	}

	// ---- one scroll: the page's own scroll is the only vertical one ----------
	// With every fold open, on a four-reading key with reading 1 at GiB and 2
	// decimals (reading 2 at B with 3 decimals, so a row carries a note) and
	// on a dial turning through 8 readings in Overview with Reading colors,
	// at the app's 378 px and at 189 px (the app zoomed to 200%): no element
	// scrolls vertically on its own but the page, a reading list
	// (role=listbox, a list widget over thousands of readings) and the
	// settings-as-text box (a text field). "Unit" and "Decimals" head the
	// format columns where the two selects sit side by side, hidden from
	// screen readers, and step aside where the selects stack, each select's
	// own label showing again; every select keeps its accessible name, its
	// row's note stays its description, and Tab order is unchanged.
	{
		const k = sim.keys;
		const OWN_SCROLL = `[...document.querySelectorAll("body *")].filter((el) => {
			if (el === document.body || el.tagName === "TEXTAREA" || el.closest('[role="listbox"]') !== null || el.getClientRects().length === 0) return false;
			const s = getComputedStyle(el);
			return (s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1;
		}).map((el) => (el.id || el.className) + " " + el.clientHeight + "/" + el.scrollHeight)`;
		const LAYOUT = `(() => {
			const heads = document.querySelector("#sec-formats .hw-format-heads");
			const rows = [...document.querySelectorAll("#format-rows .hw-format-row")];
			const first = rows[0]?.querySelectorAll("select") ?? [];
			const left = (e) => Math.round(e.getBoundingClientRect().left * 10) / 10;
			return {
				heads: heads === null ? null : { shown: heads.getClientRects().length > 0, hidden: heads.getAttribute("aria-hidden"), texts: [...heads.children].map((s) => s.textContent), lefts: [...heads.children].map(left) },
				selectLefts: [...first].map(left),
				stacked: first.length === 2 && Math.abs(first[0].getBoundingClientRect().top - first[1].getBoundingClientRect().top) > 4,
				labelsShown: rows.flatMap((row) => [...row.querySelectorAll("label")]).map((l) => l.getBoundingClientRect().width > 2),
				notes: rows.map((row) => row.querySelector("p")?.textContent ?? ""),
				sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth
			};
		})()`;
		const axSelects = async (selector) => {
			const doc = await b.send("DOM.getDocument", { depth: 0 });
			const { nodeIds } = await b.send("DOM.querySelectorAll", { nodeId: doc.root.nodeId, selector });
			const out = [];
			for (const nodeId of nodeIds) {
				const node = (await b.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false })).nodes[0];
				out.push({ ignored: node?.ignored === true, name: node?.name?.value ?? "", description: node?.description?.value ?? "" });
			}
			return out;
		};
		const near = (a, b) => Math.abs(a - b) <= 1;
		const keyNames = ["Reading 1: Physical Memory Used", "Reading 2: GPU Memory Allocated", "Reading 3: GPU Temperature", "Reading 4: Virtual Memory Committed"];
		const dialKeys = [k.memCommitted, k.memUsed, k.gpuMem, k.cpu, k.ccd1, k.ccd2, k.gpu, k.gpuPower];
		const dialNames = ["Virtual Memory Committed", "Physical Memory Used", "GPU Memory Allocated", "CPU (Tctl/Tdie)", "CPU CCD1 (Tdie)", "CPU CCD2 (Tdie)", "GPU Temperature", "GPU Power"];
		const runs = [
			["key", "key-formats", { ...sim.fixtures["key-formats"].settings, readingFormats: { [k.memUsed]: { unit: "GiB", decimals: "2" }, [k.gpuMem]: { unit: "B", decimals: "3" } } }, keyNames, 0],
			["dial", "dial-formats", { ...sim.fixtures["dial-formats"].settings, readingKey: k.memCommitted, dialView: "overview", rotationKeys: dialKeys, readingFormats: { [k.memUsed]: { unit: "GiB", decimals: "2" } }, readingColors: { [k.cpu]: "#4CC2FF", [k.gpu]: "#FF7E8E" } }, dialNames, 8]
		];
		await b.send("DOM.enable");
		await b.send("Accessibility.enable");
		try {
			for (const [kind, fixture, settings, names, colorRows] of runs) {
				await open(fixture, { settings });
				await b.evaluate(`document.querySelectorAll("details").forEach((d) => { d.open = true; })`);
				sim.pushPreview();
				await sleep(300);
				const counts = await b.evaluate(`[document.querySelectorAll("#format-rows .hw-format-row").length, document.querySelectorAll("#reading-color-list .hw-quad-colors").length]`);
				check(`one scroll ${kind}: every fold open shows every row`, counts[0] === names.length && counts[1] === colorRows, JSON.stringify(counts));
				const expected = names.flatMap((n) => [`Unit for ${n}`, `Decimals for ${n}`]);
				// Tab from the fold's summary walks each row's Unit, then its
				// Decimals (a Unit with no fixed unit to offer is disabled and
				// skipped).
				const tabbable = await b.evaluate(`[...document.querySelectorAll("#format-rows select")].filter((s) => !s.disabled).map((s) => s.getAttribute("aria-label"))`);
				await b.evaluate(`document.querySelector("#sec-formats > summary").focus()`);
				const walked = [];
				for (let i = 0; i < tabbable.length; i++) {
					await b.key("Tab");
					walked.push(await b.evaluate(`document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.id ?? ""`));
				}
				check(`one scroll ${kind}: Tab walks each row's Unit, then its Decimals`, tabbable.length > names.length && same(walked, tabbable) && same(tabbable, expected.filter((name) => tabbable.includes(name))), JSON.stringify(walked));
				await b.evaluate(`document.activeElement?.blur()`);
				for (const width of [378, 189]) {
					await b.viewport(width, 900);
					await sleep(250);
					const own = await b.evaluate(OWN_SCROLL);
					check(`one scroll ${kind} at ${width} px: no section scrolls on its own, only the page`, own.length === 0, JSON.stringify(own));
					const lay = await b.evaluate(LAYOUT);
					if (width === 378) {
						check(
							`one scroll ${kind} at 378 px: "Unit" and "Decimals" head the two columns once, hidden from screen readers, over side-by-side selects`,
							lay.heads !== null && lay.heads.shown && lay.heads.hidden === "true" && same(lay.heads.texts, ["Unit", "Decimals"]) && !lay.stacked && lay.heads.lefts.length === 2 && lay.heads.lefts.every((x, i) => near(x, lay.selectLefts[i])) && lay.labelsShown.every((s) => !s),
							JSON.stringify(lay)
						);
					} else {
						check(`one scroll ${kind} at 189 px: the selects stack, the heads step aside and each select's label shows`, lay.heads !== null && !lay.heads.shown && lay.stacked && lay.labelsShown.length === expected.length && lay.labelsShown.every((s) => s), JSON.stringify(lay));
					}
					check(`one scroll ${kind} at ${width} px: no sideways scroll`, lay.sideways <= 0, String(lay.sideways));
					const ax = await axSelects("#format-rows select");
					check(`one scroll ${kind} at ${width} px: every format select keeps its name`, same(ax.map((a) => a.name), expected), JSON.stringify(ax.map((a) => a.name)));
					check(`one scroll ${kind} at ${width} px: each row's note stays its selects' description`, ax.length === expected.length && ax.every((a, i) => a.description === lay.notes[i >> 1]) && (kind !== "key" || lay.notes[1] !== ""), JSON.stringify({ described: ax.map((a) => a.description), notes: lay.notes }));
					const unnamed = (await axSelects("select")).filter((a) => !a.ignored && a.name === "");
					check(`one scroll ${kind} at ${width} px: no shown select is unnamed`, unnamed.length === 0, String(unnamed.length));
				}
				await b.viewport(400, 900);
				noWrites(`one scroll ${kind}`);
			}

			// A dial with no rotation set lists its reading's whole sensor (149
			// readings on a real CPU): Unit and decimals per reading and Reading
			// colors show the first 8 rows of their own order, every reading
			// with its own format or color, and "Show all N readings" under
			// each. A row once shown stays (a dial turn, a cleared format) until
			// the list is planned again; Show all adds the rest where the button
			// was, focus on the first of them, and lasts while the panel is
			// open. Rotation sets and keys list every row.
			const cpuKeys = sim.snapshot.readings.filter((r) => r.sensorIndex === 0).map((r) => r.key); // 10, HWiNFO's order
			const [volt, throttle] = [cpuKeys[8], cpuKeys[9]];
			const wholeSettings = { readingKey: cpuKeys[0], dialView: "overview", readingFormats: { [volt]: { decimals: "3" } }, readingColors: { [throttle]: "#4CC2FF" }, futureBlob: FUTURE_BLOB };
			const LISTED = `(() => {
				const box = (e) => Math.round((e.getBoundingClientRect().top + scrollY) * 10) / 10;
				const button = (list) => { const n = list.nextElementSibling; return n !== null && n.tagName === "BUTTON" && n.getClientRects().length > 0 ? n.textContent : null; };
				const formats = document.getElementById("format-rows");
				const colors = document.getElementById("reading-color-list");
				const formatRows = [...formats.querySelectorAll(".hw-format-row")];
				const colorRows = [...colors.querySelectorAll(".hw-quad-colors")];
				const active = document.activeElement;
				return {
					formats: formatRows.map((row) => /\\(([^()]*)\\)$/.exec(row.querySelector(".hw-label")?.title ?? "")?.[1] ?? ""),
					formatTops: formatRows.map(box),
					colors: colorRows.map((row) => row.querySelector("input")?.dataset.key ?? ""),
					colorTops: colorRows.map(box),
					formatsButton: button(formats),
					colorsButton: button(colors),
					showAll: [...document.querySelectorAll("button")].filter((n) => /^Show all/.test(n.textContent) && n.getClientRects().length > 0).length,
					focus: { tag: active?.tagName ?? "", key: active?.dataset?.key ?? /\\(([^()]*)\\)$/.exec(active?.closest(".hw-format-row")?.querySelector(".hw-label")?.title ?? "")?.[1] ?? "", inFormats: formats.contains(active), inColors: colors.contains(active) }
				};
			})()`;
			const openWhole = async (settings) => {
				await open("dial-formats", { settings });
				await b.viewport(378, 900);
				await b.evaluate(`(() => { document.getElementById("sec-display").open = true; document.getElementById("sec-formats").open = true; })()`);
				sim.pushPreview();
				await sleep(300);
			};
			const first8 = cpuKeys.slice(0, 8);
			await openWhole(wholeSettings);
			noWrites("whole sensor: open");
			let listed = await b.evaluate(LISTED);
			check("whole sensor: Unit and decimals lists the first 8 of 10 readings and the one beyond them with its own format", same(listed.formats, [...first8, volt]), JSON.stringify(listed.formats));
			check("whole sensor: Reading colors lists the first 8 of 10 readings and the one beyond them with its own color", same(listed.colors, [...first8, throttle]), JSON.stringify(listed.colors));
			check("whole sensor: each list ends with one plain Show all button with the real count", listed.formatsButton === "Show all 10 readings" && listed.colorsButton === "Show all 10 readings" && listed.showAll === 2, JSON.stringify([listed.formatsButton, listed.colorsButton, listed.showAll]));
			check("whole sensor: no section scrolls on its own", (await b.evaluate(OWN_SCROLL)).length === 0, JSON.stringify(await b.evaluate(OWN_SCROLL)));
			// The dial turns through its sensor (each step saves readingKey): no row moves.
			const placed = listed;
			for (const key of [cpuKeys[3], volt, throttle]) {
				sim.pushSettings({ ...wholeSettings, readingKey: key });
				sim.pushPreview();
				await sleep(200);
			}
			listed = await b.evaluate(LISTED);
			check("whole sensor: the dial turning, onto rows shown or not, moves no row", same([listed.formats, listed.formatTops, listed.colors, listed.colorTops], [placed.formats, placed.formatTops, placed.colors, placed.colorTops]), JSON.stringify({ was: placed.formats, now: listed.formats }));
			noWrites("whole sensor: dial turns");
			sim.pushSettings(wholeSettings);
			await sleep(200);
			// Clearing the format that kept a row listed is one write, and the row stays.
			const before = structuredClone(sim.settings);
			const cleared = await b.evaluate(`(() => { const row = [...document.querySelectorAll("#format-rows .hw-format-row")].find((r) => r.querySelector(".hw-label")?.title.endsWith(${JSON.stringify(`(${volt})`)})); const s = row?.querySelectorAll("select")[1]; if (!s) return false; s.focus(); s.value = ""; s.dispatchEvent(new Event("change")); s.blur(); return true; })()`);
			await sleep(300);
			check("whole sensor: clearing a row's format is one write of readingFormats alone", cleared && sim.writes.length === 1 && same(changedKeys(before, lastWrite() ?? before), ["readingFormats"]) && !Object.hasOwn(lastWrite() ?? {}, "readingFormats"), JSON.stringify(lastWrite()));
			sim.pushSettings(lastWrite());
			await sleep(250);
			listed = await b.evaluate(LISTED);
			check("whole sensor: a row whose format was cleared stays where it was, through the echo", same([listed.formats, listed.formatTops], [placed.formats, placed.formatTops]) && listed.formatsButton === "Show all 10 readings", JSON.stringify(listed.formats));
			// Show all, pressed with the pointer: the other rows join after the
			// shown ones, where the button was, and the focus lands on the first.
			const writesBefore = sim.writes.length;
			const shownBefore = await b.evaluate(LISTED);
			await b.evaluate(`(() => { const n = document.getElementById("format-rows").nextElementSibling; n.scrollIntoView({ block: "center" }); })()`);
			const placedTops = (await b.evaluate(LISTED)).formatTops;
			const rect = await b.evaluate(`(() => { const r = document.getElementById("format-rows").nextElementSibling.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
			await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
			await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
			await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
			await sleep(250);
			listed = await b.evaluate(LISTED);
			check("whole sensor: Show all lists every row, the shown ones first and in place", same(listed.formats, [...shownBefore.formats, throttle]) && same(listed.formatTops.slice(0, placedTops.length), placedTops) && listed.formatsButton === null, JSON.stringify({ formats: listed.formats, button: listed.formatsButton }));
			check("whole sensor: Show all puts the focus on the first row it adds", listed.focus.inFormats && listed.focus.tag === "SELECT" && listed.focus.key === throttle, JSON.stringify(listed.focus));
			check("whole sensor: Show all writes nothing and adds no scroll of its own", sim.writes.length === writesBefore && (await b.evaluate(OWN_SCROLL)).length === 0, JSON.stringify({ writes: sim.writes.length - writesBefore, own: await b.evaluate(OWN_SCROLL) }));
			// Reading colors' Show all, from the keyboard.
			await b.evaluate(`document.getElementById("reading-color-list").nextElementSibling?.focus()`);
			await b.key("Enter");
			await sleep(250);
			listed = await b.evaluate(LISTED);
			check("whole sensor: Reading colors' Show all, by Enter, lists every row and focuses the first it adds", same(listed.colors, [...first8, throttle, volt]) && listed.colorsButton === null && listed.focus.inColors && listed.focus.tag === "INPUT" && listed.focus.key === volt, JSON.stringify({ colors: listed.colors, focus: listed.focus }));
			check("whole sensor: Show all writes nothing", sim.writes.length === writesBefore, String(sim.writes.length - writesBefore));
			// Shown all lasts while the panel is open, through a turn onto
			// another sensor (a focused color well holds its list until it
			// lets go, so the focus leaves first).
			await b.evaluate(`document.activeElement?.blur()`);
			const gpuKeys = sim.snapshot.readings.filter((r) => r.sensorIndex === 1).map((r) => r.key);
			sim.pushSettings({ ...wholeSettings, readingKey: k.gpu });
			sim.pushPreview();
			await sleep(300);
			listed = await b.evaluate(LISTED);
			check("whole sensor: once shown in full, a list of another sensor shows every row too", listed.formats.length === gpuKeys.length && listed.colors.length === gpuKeys.length && listed.showAll === 0, JSON.stringify({ formats: listed.formats.length, colors: listed.colors.length, gpu: gpuKeys.length, showAll: listed.showAll }));
			// A pick made in this panel plans the list again: the pick leads its rows.
			await openWhole(wholeSettings);
			await b.evaluate(`document.getElementById("picker-search").focus()`);
			await sleep(100);
			await b.type("core voltage");
			await sleep(150);
			await b.key("ArrowDown");
			await b.key("Enter");
			await sleep(300);
			listed = await b.evaluate(LISTED);
			check("whole sensor: a reading picked in the panel leads Unit and decimals, with the list's first rows after it", lastWrite()?.readingKey === volt && sim.writes.length === 1 && same(listed.formats, [volt, ...cpuKeys.slice(0, 7)]) && listed.formatsButton === "Show all 10 readings", JSON.stringify({ picked: lastWrite()?.readingKey, formats: listed.formats }));
			// Show all grows its list under the pointer: a second press right
			// after it (a double click, or a quick second single click) at its
			// left edge, middle or right edge presses nothing that slid there,
			// at 378 and 189 px, and writes nothing. Space acts once.
			const COUNT = `(() => { window.__hit = []; for (const id of ["format-rows", "reading-color-list"]) { const list = document.getElementById(id); for (const type of ["mousedown", "click"]) document.addEventListener(type, (e) => { if (list.contains(e.target)) window.__hit.push(type + " " + e.target.tagName + (e.target.type ? "[" + e.target.type + "]" : "")); }); } return true; })()`;
			const presses = [];
			for (const width of [378, 189]) {
				for (const list of ["format-rows", "reading-color-list"]) {
					for (const [where, fx] of [["left edge", 0.06], ["middle", 0.5], ["right edge", 0.94]]) {
						for (const kind of ["double click", "two quick clicks"]) {
							await openWhole({ readingKey: cpuKeys[0], dialView: "overview" });
							await b.viewport(width, 900);
							await sleep(150);
							await b.evaluate(COUNT);
							const at = await b.evaluate(`(() => { const n = document.getElementById(${JSON.stringify(list)}).nextElementSibling; n.scrollIntoView({ block: "center" }); const r = n.getBoundingClientRect(); return { x: r.left + r.width * ${fx}, y: r.top + r.height / 2, text: n.textContent }; })()`);
							await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
							await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", clickCount: 1 });
							await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", clickCount: 1 });
							await sleep(kind === "double click" ? 40 : 120);
							const second = kind === "double click" ? 2 : 1;
							await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", clickCount: second });
							await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", clickCount: second });
							await sleep(200);
							const after = await b.evaluate(`({ hit: window.__hit, under: (() => { const e = document.elementFromPoint(${at.x}, ${at.y}); return e ? e.tagName + (e.type ? "[" + e.type + "]" : "") : ""; })(), rows: document.getElementById(${JSON.stringify(list)}).children.length })`);
							presses.push({ width, list, where, kind, button: at.text, ...after, writes: sim.writes.length + sim.globalWrites.length });
						}
					}
				}
			}
			const pressedThrough = presses.filter((p) => p.button !== "Show all 10 readings" || p.rows !== 10 || p.hit.length > 0 || p.writes > 0);
			check("whole sensor: a second press right after Show all, double or single, at its left, middle or right, at 378 and 189 px, presses nothing that slid under it and writes nothing", presses.length === 24 && pressedThrough.length === 0, JSON.stringify(pressedThrough.length === 0 ? presses.map((p) => p.under) : pressedThrough));
			await openWhole({ readingKey: cpuKeys[0], dialView: "overview" });
			await b.evaluate(`document.getElementById("format-rows").nextElementSibling.focus()`);
			await b.key(" ");
			await sleep(250);
			listed = await b.evaluate(LISTED);
			check("whole sensor: Space on Show all acts once: every row, the focus on the first added", listed.formats.length === 10 && listed.formatsButton === null && listed.focus.inFormats && listed.focus.key === cpuKeys[8] && sim.writes.length === 0, JSON.stringify({ rows: listed.formats.length, focus: listed.focus, writes: sim.writes.length }));
			// A rotation set and a key list every row, with no button.
			await open("dial-formats", { settings: { ...wholeSettings, rotationKeys: cpuKeys } });
			await b.evaluate(`(() => { document.getElementById("sec-display").open = true; document.getElementById("sec-formats").open = true; })()`);
			await sleep(250);
			listed = await b.evaluate(LISTED);
			check("whole sensor: a rotation set of 10 lists all 10 in both lists, with no Show all", listed.formats.length === 10 && listed.colors.length === 10 && listed.showAll === 0, JSON.stringify({ formats: listed.formats.length, colors: listed.colors.length, showAll: listed.showAll }));
			noWrites("whole sensor: rotation set");
			await open("key-formats");
			await b.evaluate(`document.querySelectorAll("details").forEach((d) => { d.open = true; })`);
			await sleep(200);
			check("whole sensor: a key's rows have no Show all", (await b.evaluate(`[...document.querySelectorAll("button")].filter((n) => /^Show all/.test(n.textContent)).length`)) === 0);
		} finally {
			await b.viewport(400, 900);
			await b.send("Accessibility.disable").catch(() => {});
		}
	}
	check("formats: no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

	// ---- seventh-pass follow-ups (external review pass 8) --------------------
	// A quad color preset name the table only inherits is ignored, not
	// thrown on (AX74).
	{
		await open("key-configured");
		const errorsBefore = pageErrors.length;
		const writesBefore = sim.writes.length;
		await b.evaluate(`(() => { const s = document.getElementById("quad-color-preset"); for (const name of ["__proto__", "constructor", "toString"]) { const o = document.createElement("option"); o.value = name; o.textContent = name; s.appendChild(o); s.value = name; s.dispatchEvent(new Event("change")); } })()`);
		await sleep(200);
		check("quad colors: a preset name the table only inherits writes nothing and throws nothing", pageErrors.length === errorsBefore && sim.writes.length === writesBefore, JSON.stringify({ errors: pageErrors.slice(errorsBefore), writes: sim.writes.length - writesBefore }));
	}
	// Picker rows carry one id per reading key: a key holding a lone
	// surrogate no longer stops the list, and "Core 0" and "Core_200" no
	// longer share one, so the row a screen reader is pointed at is the
	// highlighted one (AX75, AX76).
	{
		const snap = sampleSnapshot();
		const index = snap.sensors.length;
		snap.sensors.push({ index, id: 0xabc, instance: 0, name: "Gadget CPU" });
		for (const [key, label] of [["g:CPU|Core 0", "Core 0"], ["g:CPU|Core_200", "Core_200"], ["g:\ud800|x", "Lone x"]]) {
			const r = { key, type: 1, sensorIndex: index, id: snap.readings.length, label, unit: "°C", value: 40, valueMin: 40, valueMax: 40, valueAvg: 40 };
			snap.readings.push(r);
			snap.byKey.set(key, r);
		}
		const errorsBefore = pageErrors.length;
		await open("key-empty", { snapshot: snap });
		await sleep(300);
		await b.evaluate(`document.getElementById("picker-search").focus()`);
		await sleep(300);
		await b.type("gadget core");
		await sleep(200);
		let rows;
		for (let i = 0; i < 4; i++) {
			await b.key("ArrowDown");
			rows = await b.evaluate(`(() => { const s = document.getElementById("picker-search"); const ref = document.getElementById(s.getAttribute("aria-activedescendant") ?? ""); const all = Array.from(document.querySelectorAll("#picker-list .hw-row[role=option]")); return { rows: all.length, ids: new Set(all.map((r) => r.id)).size, lone: all.some((r) => r.dataset.key === "g:\\ud800|x"), active: document.querySelector("#picker-list .hw-row.active")?.dataset.key ?? null, named: ref?.dataset.key ?? null }; })()`);
			if (rows.active === "g:CPU|Core_200") break;
		}
		check("picker: every row has its own id, a lone surrogate included, and the row named active is the highlighted one", rows.ids === rows.rows && rows.lone && rows.active === "g:CPU|Core_200" && rows.named === rows.active && pageErrors.length === errorsBefore, JSON.stringify({ ...rows, errors: pageErrors.slice(errorsBefore) }));
		await b.key("Escape");
	}
	// The Config wells fill from the panel's own newest documents: opening
	// them asks the host for nothing, so no late answer can roll the
	// controls back to an older document (AX77). A shared document still on
	// its way when they open is asked for, and fills its well when it lands.
	{
		// Counted from page load (opening a fixture clears the log): the panel
		// client's own one read of the shared document at load is the only one.
		const reads = () => sim.piMessages.filter((m) => m.event === "getSettings" || m.event === "getGlobalSettings").map((m) => m.event);
		await open("dial-groups");
		await b.evaluate(`document.querySelectorAll("details").forEach((d) => { d.open = true; })`);
		await sleep(300);
		const wells = await b.evaluate(`({ key: document.getElementById("config-key").value, deck: document.getElementById("config-deck").value })`);
		const keyDoc = JSON.parse(wells.key || "null");
		const deckDoc = JSON.parse(wells.deck || "null");
		check("Config: opening the wells asks the host for no document, and they show the panel's own", same(reads(), ["getGlobalSettings"]) && Array.isArray(keyDoc?.rotationGroups) && keyDoc.rotationGroups.length === sim.settings.rotationGroups.length && same(Object.keys(deckDoc ?? {}).sort(), Object.keys(sim.globals).sort()), JSON.stringify({ reads: reads(), groups: keyDoc?.rotationGroups?.length ?? null, deck: Object.keys(deckDoc ?? {}) }));
		// An untouched well follows an edit made elsewhere in the panel, so
		// Replace never writes back the document of the moment it filled.
		await b.evaluate(`(() => { const s = document.getElementById("f-decimals"); s.value = "2"; s.dispatchEvent(new Event("change")); })()`);
		await sleep(300);
		const followed = JSON.parse((await b.evaluate(`document.getElementById("config-key").value`)) || "null");
		check("Config: an untouched key well shows an edit made elsewhere in the panel", followed?.decimals === "2" && sim.settings.decimals === "2", JSON.stringify({ well: followed?.decimals ?? null, host: sim.settings.decimals ?? null }));
		// A well someone clicked into holds still while the plugin writes the
		// document (an auto-cycling dial does every few seconds): the caret
		// stays where it was put, and the well catches up when focus leaves.
		await b.evaluate(`(() => { const w = document.getElementById("config-key"); w.focus(); w.setSelectionRange(10, 10); })()`);
		sim.pushSettings({ ...sim.settings, decimals: "1" });
		await sleep(300);
		const held = await b.evaluate(`(() => { const w = document.getElementById("config-key"); return { decimals: JSON.parse(w.value).decimals, caret: w.selectionStart, arrived: window.__hwPanel.settings.decimals }; })()`);
		await b.evaluate(`document.getElementById("config-key-copy").focus()`);
		await sleep(300);
		const caughtUp = JSON.parse((await b.evaluate(`document.getElementById("config-key").value`)) || "null");
		check("Config: a focused key well keeps its caret through a plugin write, and catches up when focus leaves", held.arrived === "1" && held.decimals === "2" && held.caret === 10 && caughtUp?.decimals === "1", JSON.stringify({ held, caughtUp: caughtUp?.decimals ?? null }));
		for (const draft of [null, JSON.stringify({ draft: "typed while the answer was on its way" })]) {
			sim.holdGlobalsReplies = true;
			await open("key-configured");
			await b.evaluate(`document.querySelectorAll("details").forEach((d) => { d.open = true; })`);
			await sleep(300);
			const waiting = await b.evaluate(`document.getElementById("config-deck").value`);
			const heldReads = reads();
			if (draft !== null) await b.evaluate(`(() => { const el = document.getElementById("config-deck"); el.value = ${JSON.stringify(draft)}; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
			sim.releaseGlobals();
			await sleep(300);
			const shown = await b.evaluate(`document.getElementById("config-deck").value`);
			if (draft === null) {
				const landed = JSON.parse(shown || "null");
				check("Config: a shared document still on its way when the wells open fills its well when it lands, with no second read", waiting === "" && same(heldReads, ["getGlobalSettings"]) && same(Object.keys(landed ?? {}).sort(), Object.keys(sim.globals).sort()), JSON.stringify({ waiting, heldReads, landed: Object.keys(landed ?? {}) }));
			} else check("Config: a draft typed while that answer was on its way stays when it lands", waiting === "" && shown === draft, JSON.stringify({ waiting, shown }));
		}
		// Wells opened before the panel connects stay empty until it does,
		// then show the document: never "{}", which Replace would write.
		sim.setFixture("key-configured");
		await b.goto(sim.url("key-configured", `&inject=${encodeURIComponent("/__e2e/slow-connect.js")}`));
		await sleep(1700);
		await b.evaluate(`document.querySelectorAll("details").forEach((d) => { d.open = true; })`);
		await sleep(150);
		const beforeConnect = await b.evaluate(`document.getElementById("config-key").value`);
		for (let i = 0; i < 100 && !(await b.evaluate(`!!window.__hwPanel?.context`)); i++) await sleep(50);
		await sleep(400);
		const afterConnect = JSON.parse((await b.evaluate(`document.getElementById("config-key").value`)) || "null");
		check("Config: a key well opened before the panel connects stays empty, then shows the document", beforeConnect === "" && typeof afterConnect?.readingKey === "string", JSON.stringify({ beforeConnect, after: Object.keys(afterConnect ?? {}) }));
	}

	// ---- detail placement: the Page layout editor and the scope box (7E) ----
	// The sim answers as a standard 15-key deck with the opener on (4,2),
	// through the plugin's own preview builder. Real focus, real key
	// presses: a toggle keeps focus on its cell, no box moves on a press or
	// on a note coming on, and a scope Remove hands focus to a neighbour.
	{
		sim.setFixture("key-configured");
		const placedKey = sim.settings.readingKey;
		const scopeOf = (settings) => ({
			onDetailPage: true,
			opener: { id: "f0000501:0", name: "CPU" },
			sources: (Array.isArray(settings.detailScope?.sources) ? settings.detailScope.sources : []).map((id) => ({ id, name: id, state: "present" }))
		});
		await open("key-configured", { settings: { readingKey: placedKey, pressBehavior: "open-details", detailScope: { sources: ["Sensor A", "Sensor B"] } }, detailPlacement: { opener: { column: 4, row: 2 }, scope: scopeOf } });
		await b.evaluate(`(() => { const box = document.getElementById("detail-layout"); box.closest("details.hw-sec").open = true; box.querySelector("details.hw-layout").open = true; })()`);
		const cellSel = `#layout-grid button[data-column="2"][data-row="0"]`;
		for (let i = 0; i < 60 && !(await b.evaluate(`document.querySelector('${cellSel}')?.dataset.kind === "reading"`)); i++) await sleep(50);
		// Boxes measured from the grid's own top, so only the editor's own
		// boxes count (a status line elsewhere in the panel is not this check).
		const geometry = `(() => { const top = document.getElementById("layout-grid").getBoundingClientRect().top; const r = (el) => { const x = el.getBoundingClientRect(); return [Math.round(x.top - top), Math.round(x.left), Math.round(x.width), Math.round(x.height)]; }; return { grid: r(document.getElementById("layout-grid")), notes: r(document.getElementById("layout-note")), help: r(document.getElementById("layout-help")), cell: r(document.querySelector('${cellSel}')) }; })()`;
		const before = await b.evaluate(geometry);
		check("layout: opening the Page layout editor shows its 11 reading cells (15 keys less 4 navigation cells) and writes nothing", sim.writes.length === 0 && (await b.evaluate(`document.getElementById("detail-layout").hidden === false && document.querySelectorAll("#layout-grid button").length === 11`)), JSON.stringify(writes()));
		await b.evaluate(`(() => { window.__cell = document.querySelector('${cellSel}'); window.__cell.focus(); })()`);
		await b.key("Enter");
		for (let i = 0; i < 40 && (await b.evaluate(`document.querySelector('${cellSel}').dataset.kind`)) !== "gap"; i++) await sleep(50);
		const pressed = await b.evaluate(`({ same: document.querySelector('${cellSel}') === window.__cell, focus: document.activeElement === window.__cell, kind: window.__cell.dataset.kind, pressedState: window.__cell.getAttribute("aria-pressed") })`);
		const afterPress = await b.evaluate(geometry);
		check("layout: Enter on a cell saves detailGaps alone, once, and the cell reads kept empty", sim.writes.length === 1 && same(lastWrite()?.detailGaps, { standard: [[{ column: 2, row: 0 }]] }) && pressed.kind === "gap" && pressed.pressedState === "true", JSON.stringify({ ...writes(), gaps: lastWrite()?.detailGaps, pressed }));
		check("layout: focus stays on the pressed cell, the same button", pressed.same && pressed.focus, JSON.stringify(pressed));
		check("layout: a press moves no box", same(before, afterPress), JSON.stringify({ before, afterPress }));
		await b.key(" ");
		for (let i = 0; i < 40 && (await b.evaluate(`document.querySelector('${cellSel}').dataset.kind`)) !== "reading"; i++) await sleep(50);
		const released = await b.evaluate(`({ focus: document.activeElement === window.__cell, kind: window.__cell.dataset.kind })`);
		check("layout: Space lets the reading back in, keeps focus and drops the empty page", sim.writes.length === 2 && same(lastWrite()?.detailGaps, {}) && released.focus && released.kind === "reading", JSON.stringify({ ...writes(), gaps: lastWrite()?.detailGaps, released }));
		// HWiNFO stops: the preview comes back unresolved and its note shows,
		// in the place every note already holds.
		sim.data = "unavailable";
		await b.evaluate(`(() => { const f = document.querySelector("#detail-layout details.hw-layout"); f.open = false; })()`);
		await sleep(100);
		await b.evaluate(`(() => { const f = document.querySelector("#detail-layout details.hw-layout"); f.open = true; })()`);
		for (let i = 0; i < 40 && !(await b.evaluate(`document.querySelector('#layout-note [data-note="unresolved"]')?.dataset.shown === "true"`)); i++) await sleep(50);
		const down = await b.evaluate(geometry);
		const noteShown = await b.evaluate(`getComputedStyle(document.querySelector('#layout-note [data-note="unresolved"]')).visibility === "visible"`);
		check("layout: a note coming on with HWiNFO down moves no box", noteShown && same(before, down), JSON.stringify({ noteShown, before, down }));
		sim.data = "ok";
		const disabledLook = await b.evaluate(`(() => { const n = document.getElementById("layout-prev"); return { disabled: n.getAttribute("aria-disabled"), color: getComputedStyle(n).color, enabled: getComputedStyle(document.getElementById("layout-help")).color }; })()`);
		check("layout: Previous on page 1 says it would do nothing and looks muted", disabledLook.disabled === "true" && disabledLook.color === disabledLook.enabled, JSON.stringify(disabledLook));
		// The scope box: Remove on the first sensor hands focus to the next.
		const writesBefore = sim.writes.length;
		await b.evaluate(`document.querySelector('#scope-list button[data-source="Sensor A"]').focus()`);
		await b.key("Enter");
		for (let i = 0; i < 40 && (await b.evaluate(`document.querySelectorAll("#scope-list button").length`)) !== 1; i++) await sleep(50);
		const scopeFocus = await b.evaluate(`({ focus: document.activeElement?.dataset?.source ?? document.activeElement?.id ?? null, left: [...document.querySelectorAll("#scope-list button")].map((x) => x.dataset.source) })`);
		check("scope: Remove saves detailScope alone and hands focus to the next sensor's Remove", sim.writes.length === writesBefore + 1 && same(lastWrite()?.detailScope, { sources: ["Sensor B"] }) && scopeFocus.focus === "Sensor B", JSON.stringify({ ...writes(), scope: lastWrite()?.detailScope, scopeFocus }));
		check("layout and scope: no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
	}

	// ---- scale: 5,000 readings, deep selection ------------------------------
	const big = scaledSnapshot(5000);
	const deep = big.readings.at(-3).key;
	await open("key-empty", { settings: { readingKey: deep }, snapshot: big });
	await sleep(400);
	await b.evaluate(`document.getElementById("picker-search").focus()`);
	await sleep(600);
	const reach = await b.evaluate(`(() => {
		const list = document.getElementById("picker-list");
		const options = list.querySelectorAll(".hw-row[role=option]"); // reading rows (the hidden no-match message is a disabled option too)
		const sel = list.querySelector("[aria-selected=true]");
		const a = sel?.getBoundingClientRect(), r = list.getBoundingClientRect();
		return { options: options.length, selected: sel?.dataset.key ?? null, visible: !!sel && a.bottom > r.top && a.top < r.bottom };
	})()`);
	check("scale: all 5,000 readings are options", reach.options === 5000, String(reach.options));
	await b.type("reading 4999");
	await sleep(200);
	const narrowed = await b.evaluate(`Array.from(document.querySelectorAll("#picker-list [role=option]:not([hidden])")).map((o) => o.dataset.key)`);
	check("scale: typing narrows to the matching rows and keeps the last one reachable", same(narrowed, [big.readings.at(-1).key]), JSON.stringify(narrowed));
	await b.key("Escape");
	check("scale: the deep saved reading is selected and in view on open", reach.selected === deep && reach.visible, JSON.stringify(reach));
	await b.key("End");
	for (let i = 0; i < 3; i++) await b.key("PageDown");
	check("scale: the list opened and browsed without a write", sim.writes.length === 0);
	// A listener that throws can leave every check around it passing: any
	// page error anywhere in the run fails here (external review AX83).
	check("run: no page errors anywhere", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (err) {
	console.error("e2e-pi-panels crashed:", err);
	failures.push(`crash: ${err?.message ?? err}`);
} finally {
	await b.close();
	await sim.stop();
}

console.log(`\n${failures.length === 0 ? "ALL GREEN" : `${failures.length} FAILED`}`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
