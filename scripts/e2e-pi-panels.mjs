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
import { FUTURE_BLOB, scaledSnapshot } from "./lib/pi-fixtures.mjs";
import { startPiSim } from "./lib/pi-sim.mjs";

const failures = [];
const check = makeCheck((name) => failures.push(name));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const PORTS = { ws: 29320, http: 29321, debug: 29322 };

const sim = await startPiSim({ httpPort: PORTS.http, wsPort: PORTS.ws });
const b = await launch({ port: PORTS.debug, width: 400, height: 900 });
const pageErrors = [];
b.on("Runtime.exceptionThrown", (p) => pageErrors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text));
const watchdog = setTimeout(() => {
	console.error("[e2e-pi-panels] watchdog: 300 s elapsed, aborting");
	process.exit(2);
}, 300_000);
watchdog.unref();

async function open(fixture, overrides) {
	sim.setFixture(fixture, overrides);
	await b.goto(sim.url(fixture));
	for (let i = 0; i < 40; i++) {
		if (await b.evaluate(`document.readyState === "complete" && (window.__hwPanel === undefined || window.__hwPanel.context !== "" || document.body.dataset.kind === "slot")`)) break;
		await sleep(50);
	}
	await sleep(600);
}
const writes = () => ({ settings: sim.writes.length, globals: sim.globalWrites.length });
const noWrites = (name) => check(`${name}: no writes`, sim.writes.length === 0 && sim.globalWrites.length === 0, JSON.stringify(writes()));
const lastWrite = () => sim.writes.at(-1);

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
		check(`edit ${name}: one write`, sim.writes.length >= 1 && sim.globalWrites.length === 0, JSON.stringify(writes()));
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

	// ---- lossless: groups, names, tiles, lists -----------------------------
	await open("dial-groups", {
		settings: { ...sim.fixtures["dial-groups"].settings, rotationKeys: [...sim.fixtures["dial-groups"].settings.rotationKeys, 42], rotationNames: { ...sim.fixtures["dial-groups"].settings.rotationNames, junk: 7 } }
	});
	const groupsBefore = structuredClone(sim.settings);
	await b.evaluate(`document.querySelectorAll("#rotation-set .hw-set-chips")[1]?.querySelector('.hw-chip-move[data-move="1"]:not(:disabled)')?.click()`);
	await sleep(300);
	let w = lastWrite();
	check("lossless: a reorder in group 2 wrote", w !== undefined);
	check("lossless: group 1's unknown field and keys unchanged", same(w?.rotationGroups?.[0], groupsBefore.rotationGroups[0]), JSON.stringify(w?.rotationGroups?.[0]));
	check("lossless: group 2 reordered, nothing else in it", same(w?.rotationGroups?.[1], { name: "GPU", keys: [...groupsBefore.rotationGroups[1].keys].reverse() }), JSON.stringify(w?.rotationGroups?.[1]));
	check("lossless: the flat mirror keeps its non-string entry", w?.rotationKeys?.at(-1) === 42, JSON.stringify(w?.rotationKeys));
	check("lossless: names untouched by a reorder", same(w?.rotationNames, groupsBefore.rotationNames), JSON.stringify(w?.rotationNames));
	// Rename a chip: only that entry changes; the junk entry survives.
	const renameKey = sim.keys.cpu;
	await b.evaluate(`document.querySelector('#rotation-set .hw-set-chip[data-key="${renameKey}"] .hw-set-name').click()`);
	await sleep(100);
	await b.evaluate(`(() => { const i = document.querySelector("#rotation-set input.hw-chip-rename"); i.value = "Die"; i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
	await sleep(300);
	w = lastWrite();
	check("lossless: a rename changed one name and kept the junk entry", same(w?.rotationNames, { ...groupsBefore.rotationNames, [renameKey]: "Die" }), JSON.stringify(w?.rotationNames));
	// Merge groups and split again: the unknown top-level field rides along.
	await b.evaluate(`document.querySelector('#rotation-set [data-set-action="merge"]').click()`);
	await sleep(300);
	check("lossless: merge keeps the unknown top-level field", same(lastWrite()?.futureBlob, FUTURE_BLOB));

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

	await open("dial-configured");
	await b.evaluate(`(() => { const btn = document.querySelector('#rotation-set .hw-chip-move[data-move="1"]:not(:disabled)'); btn.focus(); })()`);
	const orderBefore = [...sim.settings.rotationKeys];
	await b.key("Enter");
	await sleep(250);
	w = lastWrite();
	check("T5: Enter on a move button reorders the rotation", same(w?.rotationKeys, [orderBefore[1], orderBefore[0], ...orderBefore.slice(2)]), JSON.stringify(w?.rotationKeys));
	const focusAfterMove = await b.evaluate(`(() => { const a = document.activeElement; return { cls: a.className, key: a.dataset.key, move: a.dataset.move }; })()`);
	check("T5: focus stays on the moved chip's move control", focusAfterMove.key === orderBefore[0] && focusAfterMove.cls.includes("hw-chip-move"), JSON.stringify(focusAfterMove));
	check("T5: the current reading and membership are distinct marks", (await b.evaluate(`document.querySelectorAll("#rotation-set .hw-set-chip.current .hw-chip-badge").length === 1 && document.querySelectorAll("#rotation-set .hw-set-chip").length === 3`)));
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

	// ---- truth: data states --------------------------------------------------
	await open("key-unavailable");
	const down = await b.evaluate(`({ ph: document.getElementById("picker-search").placeholder, missing: document.getElementById("picker-search").classList.contains("missing"), tone: document.getElementById("reading-status").dataset.tone, state: document.getElementById("head-state").textContent })`);
	check("truth: an unavailable source never reads as a missing reading", !/not found/i.test(down.ph) && !down.missing && down.tone === "danger" && down.state === "No HWiNFO data", JSON.stringify(down));
	await open("key-missing");
	const miss = await b.evaluate(`({ ph: document.getElementById("picker-search").placeholder, tone: document.getElementById("reading-status").dataset.tone, head: document.getElementById("head-reading").textContent, label: document.getElementById("f-label").value })`);
	check("truth: a missing reading is named, its label kept, a repair offered", /not found/i.test(miss.ph) && miss.tone === "warn" && miss.head === "Old CPU" && miss.label === "Old CPU", JSON.stringify(miss));
	await open("key-stale");
	check("truth: stale is never Live", (await b.evaluate(`document.getElementById("head-state").textContent`)) === "Not updating");
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

	// ---- scale: 5,000 readings, deep selection ------------------------------
	const big = scaledSnapshot(5000);
	const deep = big.readings.at(-3).key;
	await open("key-empty", { settings: { readingKey: deep }, snapshot: big });
	await sleep(400);
	await b.evaluate(`document.getElementById("picker-search").focus()`);
	await sleep(600);
	const reach = await b.evaluate(`(() => {
		const list = document.getElementById("picker-list");
		const options = list.querySelectorAll("[role=option]");
		const sel = list.querySelector("[aria-selected=true]");
		const a = sel?.getBoundingClientRect(), r = list.getBoundingClientRect();
		return { options: options.length, selected: sel?.dataset.key ?? null, visible: !!sel && a.bottom > r.top && a.top < r.bottom };
	})()`);
	check("scale: all 5,000 readings are options", reach.options === 5000, String(reach.options));
	await b.type("reading 4999");
	await sleep(200);
	const narrowed = await b.evaluate(`Array.from(document.querySelectorAll("#picker-list [role=option]:not([hidden])")).map((o) => o.dataset.key)`);
	check("scale: typing narrows to the matching rows and keeps the last one reachable", narrowed.length === 1, JSON.stringify(narrowed));
	await b.key("Escape");
	check("scale: the deep saved reading is selected and in view on open", reach.selected === deep && reach.visible, JSON.stringify(reach));
	await b.key("End");
	for (let i = 0; i < 3; i++) await b.key("PageDown");
	check("scale: the list opened and browsed without a write", sim.writes.length === 0);
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
