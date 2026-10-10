// The F01 panel suite: drives the REAL property inspectors (shipped HTML,
// CSS, pi-*.js and the vendored sdpi-components) in headless Chromium
// against the simulated host (scripts/lib/pi-sim.mjs), whose plugin side
// is the production preview builder and renderers. Checks, by area:
//
//   observe   opening, expanding, collapsing, tabbing, searching and
//             browsing every panel and fixture writes nothing
//   edits     each deliberate edit changes exactly its declared fields
//   lossless  unknown top-level and nested fields, list entries and entry
//             metadata survive edits, reorders and mode switches
//   races     a late preview for another context is never shown; echoes
//             and shared-setting changes from elsewhere neither clobber an
//             edit in progress nor move the caret, focus or scroll
//   keyboard  combobox inspection vs commit, Escape, rotation reorder,
//             IME composition
//   truth     unavailable vs missing vs stale, valid zero and negatives
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
import { FUTURE_BLOB, sampleSnapshot, scaledSnapshot } from "./lib/pi-fixtures.mjs";
import { startPiSim } from "./lib/pi-sim.mjs";
import { PanelFoldMemory } from "../src/panel-folds.ts";
import { buildThemesPayload } from "../src/pi-protocol.ts";

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
// A hang guard, not a speed check: a normal run takes about four minutes
// (it ran 214 s against the earlier 300 s guard before the external
// review's race checks were added), so the guard sits well above that.
const watchdog = setTimeout(async () => {
	console.error("[e2e-pi-panels] watchdog: 420 s elapsed, aborting");
	// The owned browser and the simulated host go first, never left behind
	// by the early exit (external review AX41); a stuck close waits 10 s at most.
	await Promise.race([Promise.allSettled([b.close(), sim.stop()]), sleep(10_000)]);
	process.exit(2);
}, 420_000);
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
		["key-configured", "warn", `(() => { const i = document.getElementById("f-warn"); i.focus(); i.value = "75,5"; i.dispatchEvent(new Event("input")); i.dispatchEvent(new Event("change")); i.blur(); })()`, ["warnValue"]],
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
	check("folds: an answer at the app's measured pace is applied before the sections first show", firstShown === true && (await b.evaluate(`performance.getEntriesByType("mark").some((m) => m.name === "hw-folds-answer")`)), JSON.stringify({ firstShown }));
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
	const mark = await b.evaluate(`(() => { const c = document.querySelectorAll("#rotation-set .hw-set-chip.current"); return { current: c.length, chips: document.querySelectorAll("#rotation-set .hw-set-chip").length, drawn: c[0]?.querySelectorAll(".hw-chip-badge").length ?? -1, spoken: c[0]?.querySelector(".hw-sr-only")?.textContent ?? null }; })()`);
	check("T5: the reading on the dial is one filled member, heard as on dial and drawn without a badge", mark.current === 1 && mark.chips === 3 && mark.drawn === 0 && mark.spoken === " on dial", JSON.stringify(mark));
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
			await b.evaluate("window.scrollTo(0, 0)");
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
	await open("key-zero-negative");
	check("truth: valid zero and negative render as values", (await b.evaluate(`document.getElementById("head-state").textContent`)).startsWith("Live"));

	// ---- parity: the header face is the renderer's face, byte for byte -------
	const parityFixtures = ["key-configured", "key-dense", "key-triple", "key-custom-dim", "key-inherited", "key-alert", "key-back", "key-zero-negative", "key-unavailable", "key-stale", "key-missing", "dial-configured", "dial-groups", "dial-alert", "dial-unavailable", "dial-missing"];
	const extraKey = [
		["key dual", "key-configured", { keyLayout: "dual", secondaryReadingKey: sim.keys.gpu }],
		["key quad labels", "key-dense", { quadLabels: true }],
		["key ring", "key-configured", { displayMode: "ring" }],
		["key bar crit", "key-alert", { displayMode: "bar", critValue: "60" }],
		["key paper dim", "key-configured", { theme: "paper", textMode: "dim" }],
		["dial tworow", "dial-configured", { dialView: "tworow" }],
		["dial overview bottom", "dial-configured", { dialView: "overview", overviewHeader: "bottom", overviewSeparators: "off" }]
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
		// Counted from page load (opening a fixture clears the log): sdpi's
		// own one read of the shared document at load is the only one.
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
