// The key panel's per-reading alerts, driven for real: the shipped
// sensor-reading.html, pi-*.js and the panel client (ui/pi-client.js) in headless
// Chromium against the simulated host (scripts/lib/pi-sim.mjs), whose plugin
// side builds the preview and the alert notes with the production modules.
// Checks:
//
//   opening the panel, its sections and a preview writes nothing
//   reading 1 keeps Warn at; its edit stamps alertDisplayUnit in one write
//   each other configured reading has a row that writes alertRules, filed
//   under its key, with the unit it is shown in, in the same write
//   numbers keep the unit they were typed in: a °C/°F switch never changes
//   what an untouched number means, and the Alerts line prints that unit
//   a reading that is not reporting gets a disabled row and no write
//   one reading has one set of limits: a repeated reading gets no fields,
//   and reading 1's own entry gets a row while Warn at says it is unused
//   Timing writes exactly its own field, and a Back tile hides the snooze
//   choice
//   every write keeps an unknown future field exactly as stored
//   one press, one action: a held Enter on a detail list arrow or a
//   section's summary presses once; a double click on a detail list x or
//   arrow, a section's summary or a checkbox's label
//   presses once (a cell name's double click keeps its rename field); three
//   quick presses on a tile's size or Next detail page step three times;
//   a single press 300 ms after the calculated readings editor's Cancel or
//   Save, where the pointer rests, presses nothing that slid there
//   one disabled look: the pointer on a disabled Link lights nothing (no
//   fill, full opacity); Link, Save, the detail pager, and on the dial
//   panel Make the strip, Add a band, the strip arrows and the screen
//   tools, disabled, wear muted words and a faint edge with no fill at
//   full opacity, and GrayText in forced colors
//
// Run: npx tsx scripts/e2e-pi-keys.mjs (no Stream Deck app, no HWiNFO).
// SIMULATED HOST: this proves the shipped panel code and the production
// message shapes, not the Stream Deck app's embedded webview.
import { launch } from "./lib/cdp.mjs";
import { makeCheck, sleep } from "./lib/e2e-common.mjs";
import { startPiSim } from "./lib/pi-sim.mjs";

const failures = [];
const checksRun = [];
const baseCheck = makeCheck((name) => failures.push(name));
const check = (name, ok, detail = "") => {
	checksRun.push(name);
	baseCheck(name, ok, detail);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const PORT_BASE = Number(process.env.PI_KEYS_PORT_BASE ?? 29340);
const FUTURE_BLOB = { nested: { deep: [1, "two", { three: 3 }] }, keep: "yes" };

const sim = await startPiSim({ httpPort: PORT_BASE + 1, wsPort: PORT_BASE });
const b = await launch({ width: 400, height: 900 });
const pageErrors = [];
b.on("Runtime.exceptionThrown", (p) => pageErrors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text));
const watchdog = setTimeout(async () => {
	console.error("[e2e-pi-keys] watchdog: 240 s elapsed, aborting");
	await Promise.race([Promise.allSettled([b.close(), sim.stop()]), sleep(10_000)]);
	process.exit(2);
}, 240_000);
watchdog.unref();

const { cpu, gpu, gpuFan2 } = sim.keys;

async function open(settings, fixture = "key-configured", extra = {}) {
	sim.setFixture(fixture, { ...extra, settings });
	await b.goto(sim.url(fixture));
	const deadline = performance.now() + 4000;
	while (!(await b.evaluate(`document.readyState === "complete" && !!window.__hwPanel?.context && window.__hwPanel?.tree != null && window.__hwPanel?.preview != null && !document.documentElement.hasAttribute("data-folds-pending")`))) {
		if (performance.now() >= deadline) throw new Error("the panel was not ready within 4000 ms");
		await sleep(25);
	}
	await b.evaluate(`document.querySelectorAll("details.hw-sec, details.hw-sub").forEach((d) => { d.open = true; })`);
	await b.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}
/** Focuses a field, selects what it holds and types `text` like a person. */
async function typeInto(selector, text) {
	await b.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select?.(); })()`);
	await b.key("Delete");
	await b.type(text);
	await sleep(450);
}
/** Picks an option the way the native select reports it. */
async function choose(selector, value) {
	await b.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event("change", { bubbles: true })); })()`);
	await sleep(250);
}
const visible = (selector) => b.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return !!el && !el.closest("[hidden]") && el.getClientRects().length > 0; })()`);
const valueOf = (selector) => b.evaluate(`document.querySelector(${JSON.stringify(selector)})?.value ?? null`);
const textOf = (selector) => b.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
const lastWrite = () => sim.writes.at(-1) ?? {};
/** Keys whose values differ between two documents. */
function changedKeys(before, after) {
	const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
	return [...keys].filter((k) => !same(before[k], after[k])).sort();
}

try {
	// ---- per-reading alerts ------------------------------------------------
	const triple = { readingKey: cpu, secondaryReadingKey: gpu, quadReadingKey3: gpuFan2, keyLayout: "triple", warnValue: "80", alertRules: { [gpu]: { warn: "70", unit: "°C", future: 1 }, dormant: { crit: "5" } }, futureBlob: FUTURE_BLOB };
	await open(triple);
	sim.pushPreview();
	await sleep(300);
	check("opening the panel, its sections and a preview writes nothing", sim.writes.length === 0 && sim.globalWrites.length === 0, JSON.stringify({ settings: sim.writes.length, globals: sim.globalWrites.length }));
	check("a row for each configured reading after the first", (await b.evaluate(`document.querySelectorAll("#alert-rows .hw-alert-row").length`)) === 2 && (await visible("#alert-rows")));
	check("a row shows the limits saved for its reading and names it with its unit", (await valueOf("#f-warn-s1")) === "70" && /Reading 2: GPU Temperature \(°C\)/.test((await textOf("#alert-name-1")) ?? ""), await textOf("#alert-name-1"));
	check("reading 1 keeps its own Warn at field", (await valueOf("#f-warn")) === "80");

	let before = structuredClone(sim.settings);
	await typeInto("#f-warn-s2", "500");
	check("a row edit is one write", sim.writes.length === 1, `${sim.writes.length} writes`);
	check("the row writes only alertRules", same(changedKeys(before, lastWrite()), ["alertRules"]), JSON.stringify(changedKeys(before, lastWrite())));
	check("the entry is filed under the reading's key with the unit it shows, in the same write", same(lastWrite().alertRules?.[gpuFan2], { warn: "500", unit: "RPM" }), JSON.stringify(lastWrite().alertRules?.[gpuFan2]));
	check("every other entry and unknown field stays as stored", same(lastWrite().alertRules?.[gpu], triple.alertRules[gpu]) && same(lastWrite().alertRules?.dormant, { crit: "5" }) && same(lastWrite().futureBlob, FUTURE_BLOB));

	before = structuredClone(sim.settings);
	await b.click("#alert-rows .hw-alert-row:first-child input[type=checkbox]");
	await sleep(250);
	check("a row's direction box writes below on that reading alone", same(lastWrite().alertRules?.[gpu], { ...triple.alertRules[gpu], below: true, unit: "°C" }) && same(changedKeys(before, lastWrite()), ["alertRules"]), JSON.stringify(lastWrite().alertRules?.[gpu]));

	before = structuredClone(sim.settings);
	const writesBefore = sim.writes.length;
	await typeInto("#f-warn", "85");
	const legacy = sim.writes.slice(writesBefore);
	check("reading 1's edit writes the number and the unit it was typed in together", legacy.length === 1 && legacy[0].warnValue === "85" && legacy[0].alertDisplayUnit === "°C" && same(legacy[0].alertDisplayUnitFor, { warn: "85" }) && same(changedKeys(before, legacy[0]), ["alertDisplayUnit", "alertDisplayUnitFor", "warnValue"]), JSON.stringify(legacy.map((w) => changedKeys(before, w))));

	before = structuredClone(sim.settings);
	await choose("#f-dwell", "5000");
	check("Alert after writes exactly alertDwellMs", lastWrite().alertDwellMs === "5000" && same(changedKeys(before, lastWrite()), ["alertDwellMs"]));
	before = structuredClone(sim.settings);
	await choose("#f-snooze", "900000");
	check("the snooze choice writes exactly alertSnoozeMs", lastWrite().alertSnoozeMs === "900000" && same(changedKeys(before, lastWrite()), ["alertSnoozeMs"]));
	check("the Timing line names what is set", /After 5 s · a press snoozes 15 min/.test((await textOf('[data-summary="alert-timing"]')) ?? ""), await textOf('[data-summary="alert-timing"]'));

	await open({ readingKey: cpu, secondaryReadingKey: gpu, keyLayout: "dual", alertRules: { [gpu]: { warn: "70", unit: "V" } } });
	check("a rule saved for another unit says so under its row", /set for V/.test((await textOf("#alert-rows .hw-alert-row p.hw-help")) ?? ""), await textOf("#alert-rows .hw-alert-row p.hw-help"));
	// A °C row on a key switched to °F: labeled, noted and written in °C,
	// so an edit of Critical at never changes what Warn at means.
	await open({ readingKey: cpu, secondaryReadingKey: gpu, keyLayout: "dual", fahrenheit: true, alertRules: { [gpu]: { warn: "80", unit: "°C" } } });
	check("a row typed in °C on a °F key is labeled with °C and says the key converts", /\(°C\)/.test((await textOf("#alert-name-1")) ?? "") && /typed in\. The key shows °F/.test((await textOf("#alert-rows .hw-alert-row p.hw-help")) ?? ""), `${await textOf("#alert-name-1")} | ${await textOf("#alert-rows .hw-alert-row p.hw-help")}`);
	await typeInto("#f-crit-s1", "200");
	check("an edit of one field keeps the unit the others were typed in", same(lastWrite().alertRules?.[gpu], { warn: "80", unit: "°C", crit: "200" }), JSON.stringify(lastWrite().alertRules?.[gpu]));

	await open({ readingKey: cpu, warnValue: "80", critValue: "90", alertDisplayUnit: "°C", alertDisplayUnitFor: { warn: "80", crit: "90" }, fahrenheit: true });
	check("Warn at typed in °C on a °F key says so under the fields", /Warn at and Critical at are in °C/.test((await textOf("#alert-notes-0")) ?? ""), await textOf("#alert-notes-0"));
	check("the Alerts line prints the numbers in the unit they are compared in", /Warn ≥ 80 °C/.test((await textOf('[data-summary="alerts"]')) ?? ""), await textOf('[data-summary="alerts"]'));
	before = structuredClone(sim.settings);
	await typeInto("#f-crit", "200");
	check("an edit of Critical at keeps the stamped unit, so Warn at keeps its meaning", same(changedKeys(before, lastWrite()), ["alertDisplayUnitFor", "critValue"]) && lastWrite().alertDisplayUnit === "°C" && same(lastWrite().alertDisplayUnitFor, { warn: "80", crit: "200" }), JSON.stringify(changedKeys(before, lastWrite())));
	// Downgrade, then re-upgrade: 1.7.1 kept the stamp and its record while
	// the person retyped the numbers in °F, so the stamp no longer counts.
	await open({ readingKey: cpu, warnValue: "176", critValue: "194", alertDisplayUnit: "°C", alertDisplayUnitFor: { warn: "80", crit: "90" }, fahrenheit: true });
	check("numbers retyped by a version that kept the stamp are shown in the unit on the face", /Warn ≥ 176 °F/.test((await textOf('[data-summary="alerts"]')) ?? "") && !/Warn at and Critical at are in °C/.test((await textOf("#alert-notes-0")) ?? ""), `${await textOf('[data-summary="alerts"]')} | ${await textOf("#alert-notes-0")}`);
	check("opening that document writes nothing", sim.writes.length === 0);
	before = structuredClone(sim.settings);
	await typeInto("#f-warn", "170");
	check("the next edit stamps the unit on the face, with a record of the text", lastWrite().alertDisplayUnit === "°F" && same(lastWrite().alertDisplayUnitFor, { warn: "170", crit: "194" }) && same(changedKeys(before, lastWrite()), ["alertDisplayUnit", "alertDisplayUnitFor", "warnValue"]), JSON.stringify(changedKeys(before, lastWrite())));

	// A reading that is not reporting has no unit to save: its row waits.
	await open({ readingKey: cpu, secondaryReadingKey: "f0099999:0:1000000", keyLayout: "dual" });
	check("a missing reading's row is disabled and says why", (await b.evaluate(`document.querySelector("#f-warn-s1")?.disabled === true`)) && /once this reading reports/.test((await textOf("#alert-rows .hw-alert-row p.hw-help")) ?? ""), await textOf("#alert-rows .hw-alert-row p.hw-help"));
	await open({ readingKey: cpu, secondaryReadingKey: gpu, keyLayout: "dual" }, "key-unavailable");
	await b.evaluate(`(() => { const el = document.querySelector("#f-warn-s1"); el.disabled = false; el.focus(); el.value = "80"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); })()`);
	await sleep(450);
	check("with HWiNFO closed a row edit writes nothing", sim.writes.length === 0, JSON.stringify(sim.writes));

	// One reading has one set of limits.
	await open({ readingKey: cpu, secondaryReadingKey: cpu, secondaryStatMode: "max", keyLayout: "dual", warnValue: "85" });
	check("the same reading on a second row has no fields and points at Warn at", (await b.evaluate(`document.querySelector("#f-warn-s1") === null`)) && /same reading as reading 1/.test((await textOf("#alert-rows .hw-alert-row p.hw-help")) ?? ""), await textOf("#alert-rows .hw-alert-row p.hw-help"));
	await open({ readingKey: gpu, secondaryReadingKey: cpu, keyLayout: "dual", warnValue: "80", alertRules: { [gpu]: { warn: "95", unit: "°C" } } });
	check("limits saved under reading 1's own reading get a row, and Warn at says it is not in use", (await valueOf("#f-warn-s0")) === "95" && /not in use/.test((await textOf("#alert-notes-0")) ?? ""), await textOf("#alert-notes-0"));
	check("the Alerts line stops saying first reading", !/first reading/.test((await textOf('[data-summary="alerts"]')) ?? ""), await textOf('[data-summary="alerts"]'));
	check("opening a key whose reading 1 has its own entry writes nothing", sim.writes.length === 0);

	await open({ readingKey: cpu, warnValue: "80" });
	check("a one-reading key shows no rows", !(await visible("#alert-rows")));
	check("a one-reading key opens without a write", sim.writes.length === 0);

	await open({ readingKey: cpu, detailRole: "back", pressBehavior: "open-details" }, "key-back");
	check("a Back tile hides the snooze choice", !(await visible("#f-snooze")));
	check("a Back tile opens without a write", sim.writes.length === 0);

	// ---- one press, one action: a held Enter presses once, a double click
	// presses a button once, and a control built for chained presses takes
	// each quick press while it still acts on the same thing.
	{
		const enter = (autoRepeat) => b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", autoRepeat });
		/** Enter held on the focused control: one press, then the system's
		 * repeats (after 500 ms, every 33 ms). */
		const holdEnter = async () => {
			await enter(false);
			await sleep(500);
			for (let i = 0; i < 15; i++) {
				await enter(true);
				await sleep(33);
			}
			await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
			await sleep(500);
		};
		/** A real double click at the middle of `selector`: two presses 120 ms
		 * apart, the pointer still. */
		const doubleClick = async (selector) => {
			const p = await b.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
			await sleep(100);
			await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
			await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
			await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
			await sleep(120);
			await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 2 });
			await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 2 });
			await sleep(500);
		};
		const details = sim.fixtures["key-details"].settings;
		const order = () => lastWrite().detailKeys ?? null;
		await open(details, "key-details");
		let w0 = sim.writes.length;
		const down = `#detail-list .hw-detail-move[aria-label^="Move GPU Temperature down"]`;
		await b.evaluate(`document.querySelector(${JSON.stringify(down)}).focus()`);
		await holdEnter();
		check("one press (held Enter): a detail list arrow moves its reading once, though focus follows the reading to the arrow that moves it back", sim.writes.length === w0 + 1 && same(order()?.slice(0, 2), [details.detailKeys[1], details.detailKeys[0]]), JSON.stringify({ writes: sim.writes.length - w0, order: order() }));
		const folds = () => sim.piMessages.filter((m) => m.event === "sendToPlugin" && m.payload?.event === "setPanelFolds").length;
		const f0 = folds();
		const wasOpen = await b.evaluate(`document.getElementById("sec-display").open`);
		await b.evaluate(`document.querySelector("#sec-display > summary").focus()`);
		await holdEnter();
		check("one press (held Enter): a section's summary folds it once, and the fold memory is written once", folds() === f0 + 1 && (await b.evaluate(`document.getElementById("sec-display").open`)) === !wasOpen, JSON.stringify({ folds: folds() - f0, open: await b.evaluate(`document.getElementById("sec-display").open`) }));

		// The double clicks on the detail list at the app's narrow 189 by 410
		// px, where the list wraps and the next chip lands under the pointer.
		await b.viewport(189, 410);
		await open(details, "key-details");
		w0 = sim.writes.length;
		await doubleClick("#detail-list .hw-set-remove");
		check("double click (a detail list x): removes that reading only; the next reading's x, under the pointer after the first click, takes no press", sim.writes.length === w0 + 1 && same(order(), details.detailKeys.slice(1)), JSON.stringify({ writes: sim.writes.length - w0, order: order() }));
		await open(details, "key-details");
		w0 = sim.writes.length;
		await doubleClick(down);
		check("double click (a detail list arrow): one move; the arrow that then sits under the pointer takes no press", sim.writes.length === w0 + 1 && same(order()?.slice(0, 2), [details.detailKeys[1], details.detailKeys[0]]), JSON.stringify({ writes: sim.writes.length - w0, order: order() }));
		await open(details, "key-details");
		w0 = sim.writes.length;
		await doubleClick('#detail-list .hw-set-name[aria-label$="now GPU Temperature"]');
		const renaming = await b.evaluate(`document.activeElement?.classList.contains("hw-cell-rename") === true`);
		check("double click (a detail cell's name): its rename field opens and keeps focus, nothing written; the disabled arrow then under the pointer takes no press", renaming && sim.writes.length === w0, JSON.stringify({ renaming, writes: sim.writes.length - w0, focus: await b.evaluate(`document.activeElement?.className || document.activeElement?.tagName`) }));
		await b.viewport(400, 900);

		/** `n` presses at the middle of `selector`, `gap` ms apart, the pointer
		 * still: Chromium counts them 1, 2, 3 inside the double-click time. */
		const presses = async (selector, n, gap) => {
			const p = await b.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
			await sleep(100);
			await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
			for (let clickCount = 1; clickCount <= n; clickCount++) {
				await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount });
				await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount });
				if (clickCount < n) await sleep(gap);
			}
			await sleep(500);
		};
		// A tile's size is built for chained presses: the rebuilt button for
		// the same tile stays under the pointer, and each press steps it.
		await open(details, "key-details");
		w0 = sim.writes.length;
		const sizeLabel = () => b.evaluate(`document.querySelector("#detail-list .hw-tile-size")?.getAttribute("aria-label") ?? null`);
		await presses("#detail-list .hw-tile-size", 3, 300);
		check("three quick presses (a tile's size, 300 ms apart, counted 1, 2, 3): the size steps once per press, 2 to 3 to 4 to 1", sim.writes.length === w0 + 3 && /^Tile 1: 1 cell;/.test((await sizeLabel()) ?? ""), JSON.stringify({ writes: sim.writes.length - w0, label: await sizeLabel() }));
		// Everything else acts once per double click: a fold, a checkbox.
		await open({ readingKey: cpu, futureBlob: FUTURE_BLOB });
		const f1 = folds();
		const display = () => b.evaluate(`document.getElementById("sec-display").open`);
		const open1 = await display();
		await doubleClick("#sec-display > summary");
		check("double click (a section's summary): it folds once, and the fold memory is written once", folds() === f1 + 1 && (await display()) === !open1, JSON.stringify({ folds: folds() - f1, open: await display() }));
		w0 = sim.writes.length;
		await doubleClick('label.hw-check:has(> input[data-setting="alertBelow"]) > span');
		check("double click (a checkbox's label): it ticks the box once, in one write", sim.writes.length === w0 + 1 && lastWrite().alertBelow === true, JSON.stringify({ writes: sim.writes.length - w0, below: lastWrite().alertBelow }));
		// The detail page arrows step through pages and take each quick press.
		await open({ readingKey: cpu, pressBehavior: "open-details", detailMode: "custom", detailKeys: sim.snapshot.readings.map((r) => r.key).filter((k) => k !== cpu) }, "key-configured", {
			detailPlacement: { opener: { column: 4, row: 2 }, scope: () => ({ onDetailPage: true, opener: { id: "f0000501:0", name: "CPU" }, sources: [] }) }
		});
		await sleep(400);
		const page = () => b.evaluate(`document.getElementById("layout-page")?.textContent ?? null`);
		const page0 = await page();
		await presses("#layout-next", 3, 300);
		check("three quick presses (Next detail page): three pages on, from Page 1", page0 === "Page 1 of 4" && (await page()) === "Page 4 of 4", JSON.stringify({ page0, page: await page() }));

		// The calculated readings editor closes under a resting pointer, in
		// the app's 378 and 189 by 410 px panel: after Cancel, New slides to
		// where Cancel was; after Save, the next section's controls. A single
		// press 300 ms later at the same point, past a short double-click
		// time, presses nothing there.
		/** A press at the middle of `selector`, then one more at the same point
		 * `gap` ms later (each a single click); what was under the pointer
		 * once the first had acted. */
		const pressThenAgain = async (selector, gap) => {
			const p = await b.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
			await sleep(100);
			await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
			await sleep(100);
			const press = async () => {
				await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
				await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
			};
			await press();
			await sleep(40);
			const under = await b.evaluate(`document.elementFromPoint(${p.x}, ${p.y})?.closest("button")?.id ?? null`);
			await sleep(gap - 40);
			await press();
			await sleep(300);
			return under;
		};
		for (const width of [378, 189]) {
			await b.viewport(width, 410);
			await open({ readingKey: cpu });
			await b.evaluate(`document.getElementById("calc-new").click()`);
			await sleep(200);
			const under = await pressThenAgain("#calc-cancel", 300);
			const after = { under, editor: await visible("#calc-form"), focus: await b.evaluate(`document.activeElement?.id ?? null`) };
			check(`calculated readings (${width} px): after Cancel, a single press 300 ms later where Cancel was opens no editor, though New slid there`, after.under === "calc-new" && !after.editor && after.focus === "calc-new", JSON.stringify(after));
		}
		await b.viewport(378, 410);
		await open({ readingKey: cpu });
		await b.evaluate(`document.getElementById("calc-new").click()`);
		await sleep(200);
		await choose("#calc-op", "avg");
		await b.evaluate(`(() => { for (const [i, s] of [...document.querySelectorAll("#calc-inputs select")].entries()) { s.value = [...s.options].filter((o) => o.value !== "" && o.textContent.includes("°C")).map((o) => o.value)[i]; s.dispatchEvent(new Event("change", { bubbles: true })); } })()`);
		await sleep(500);
		const saved0 = (sim.globals.calculatedReadings ?? []).length;
		const underSave = await pressThenAgain("#calc-save", 300);
		const saved = { under: underSave, saved: (sim.globals.calculatedReadings ?? []).length - saved0, editor: await visible("#calc-form"), focus: await b.evaluate(`document.activeElement?.id ?? null`) };
		check("calculated readings (378 px): after Save, a single press 300 ms later where Save was presses nothing there", saved.saved === 1 && !saved.editor && (saved.under === null || saved.focus !== saved.under), JSON.stringify(saved));
		await b.viewport(400, 900);
	}

	// ---- one disabled look: every disabled button in the family (the owner's pick, 2026-11-08) ----
	{
		const until = async (what, fn, ms = 4000) => {
			const deadline = performance.now() + ms;
			while (!(await fn())) {
				if (performance.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
				await sleep(30);
			}
		};
		const frames = () => b.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
		/** A control's computed look, and whether the pointer is on it. */
		const lookOf = (selector) => b.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el === null) return null; const s = getComputedStyle(el); return { disabled: el.getAttribute("aria-disabled"), background: s.backgroundColor, opacity: s.opacity, color: s.color, border: s.borderTopColor, hover: el.matches(":hover") }; })()`);
		const pointerOn = async (selector) => {
			const p = await b.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
			await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
			await sleep(120);
		};
		const pointerOff = async () => {
			await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
			await sleep(60);
		};
		const forced = async (on) => {
			await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: on ? "active" : "none" }] });
			await frames();
			await sleep(60);
		};
		/** A color as the page resolves it: GrayText, or the panel's muted and rule tokens. */
		const resolved = (prop, value) => b.evaluate(`(() => { const p = document.createElement("span"); p.style.border = "1px solid"; p.style[${JSON.stringify(prop)}] = ${JSON.stringify(value)}; document.body.append(p); const c = getComputedStyle(p)[${JSON.stringify(prop)}]; p.remove(); return c; })()`);
		/** Each control's look at rest, in normal and in forced colors. */
		const rest = {};
		const gray = {};
		const record = async (name, selector) => {
			await pointerOff();
			rest[name] = { ...(await lookOf(selector)), muted: await resolved("color", "var(--hw-muted)"), rule: await resolved("borderTopColor", "var(--hw-rule)") };
			await forced(true);
			const look = await lookOf(selector);
			gray[name] = { disabled: look?.disabled ?? null, color: look?.color ?? null, border: look?.border ?? null, grayText: await resolved("color", "GrayText") };
			await forced(false);
		};
		const openDial = async (fixture, overrides) => {
			sim.setFixture(fixture, overrides);
			await b.goto(sim.url(fixture));
			await until(`${fixture} ready`, () => b.evaluate(`document.readyState === "complete" && !!window.__hwPanel?.context && window.__hwPanel?.tree != null && !document.documentElement.hasAttribute("data-folds-pending")`));
			await until(`${fixture} strip state`, () => b.evaluate(`!/Waiting/.test(document.getElementById("strip-device").textContent)`), 3000);
			await b.evaluate(`document.getElementById("sec-strip").open = true`);
			await frames();
		};

		// The key panel: Link waits for a matching reading, Save for a
		// complete definition.
		await open({ readingKey: cpu });
		await until("a disabled Link", async () => (await visible("#links-link")) && (await b.evaluate(`document.getElementById("links-link").getAttribute("aria-disabled") === "true"`)));
		await pointerOn("#links-link");
		const lit = await lookOf("#links-link");
		check("one disabled look: the pointer on a disabled Link lights nothing (no fill, full opacity)", lit?.disabled === "true" && lit.hover === true && lit.background === "rgba(0, 0, 0, 0)" && lit.opacity === "1", JSON.stringify(lit));
		await record("link", "#links-link");
		await b.evaluate(`document.getElementById("calc-new").click()`);
		await until("the calculated readings form", () => visible("#calc-save"));
		await record("save", "#calc-save");
		// The detail page pager on page 1.
		await open({ readingKey: cpu, pressBehavior: "open-details", detailMode: "custom", detailKeys: sim.snapshot.readings.map((r) => r.key).filter((k) => k !== cpu) }, "key-configured", {
			detailPlacement: { opener: { column: 4, row: 2 }, scope: () => ({ onDetailPage: true, opener: { id: "f0000501:0", name: "CPU" }, sources: [] }) }
		});
		await b.evaluate(`document.querySelectorAll("details.hw-layout").forEach((d) => { d.open = true; })`);
		await until("Previous on page 1", async () => (await visible("#layout-prev")) && (await b.evaluate(`document.getElementById("layout-prev").getAttribute("aria-disabled") === "true"`)));
		await record("pager", "#layout-prev");
		// The dial panel: Make the strip waiting for a dial.
		await openDial("dial-strip-missing");
		await b.click(`input[name="strip-layout"][value="whole"]`);
		await until("Make the strip waits", () => b.evaluate(`document.getElementById("strip-build-use").getAttribute("aria-disabled") === "true" && document.getElementById("strip-build-use").getClientRects().length > 0`));
		await record("make", "#strip-build-use");
		// Add a band at four bands, and the strip arrows and screen tools on
		// screen 1 of a Whole strip of two screens.
		const { hot } = sim.keys;
		const bands = [{ key: hot, warn: 80, below: false }, { key: hot, crit: 95, below: false }, { key: gpu, warn: 75, below: false }, { key: gpu, crit: 90, below: false }];
		const xl = sim.fixtures["dial-strip-xl"].strip;
		await openDial("dial-strip-xl", { strip: { ...xl, create: { layout: "whole", from: 2, patch: [{ op: "set", path: "panes.0.series", value: [{ key: hot }, { key: gpu }] }, { op: "set", path: "panes.0.bands", value: bands }, { op: "addScreen", at: 1, from: "group" }] } } });
		await until("a running strip", () => visible("#strip-edit"));
		await b.evaluate(`document.getElementById("sec-stripmore").open = true`);
		await frames();
		await until("Add a band at its limit", () => b.evaluate(`document.getElementById("sp0-band-add").getAttribute("aria-disabled") === "true"`));
		await record("band", "#sp0-band-add");
		if ((await b.evaluate(`document.getElementById("strip-screen-prev").getAttribute("aria-disabled")`)) !== "true") {
			await b.click("#strip-screen-prev");
			await until("screen 1", () => b.evaluate(`document.getElementById("strip-screen-prev").getAttribute("aria-disabled") === "true"`));
		}
		await record("arrows", "#strip-screen-prev");
		await b.click("#strip-screen-edit");
		await until("the screen tools", () => visible("#strip-screen-tools"));
		const tool = await b.evaluate(`[...document.querySelectorAll("#strip-screen-tools button")].find((x) => x.getAttribute("aria-disabled") === "true")?.dataset.tool ?? null`);
		await record("tools", `#strip-screen-tools button[data-tool="${tool}"]`);
		const looks = Object.values(rest);
		check("one disabled look: Link, Save, the pager, Make the strip, Add a band, the strip arrows and the screen tools, disabled, wear one look at rest: muted words, a faint edge, no fill, full opacity", looks.length === 7 && looks.every((l) => l.disabled === "true" && l.background === "rgba(0, 0, 0, 0)" && l.opacity === "1" && l.color === l.muted && l.border === l.rule), JSON.stringify(rest));
		const grays = Object.values(gray);
		check("one disabled look (forced colors): all 7 wear GrayText for their words and edge", grays.length === 7 && grays.every((g) => g.disabled === "true" && g.color === g.grayText && g.border === g.grayText), JSON.stringify(gray));
	}

	check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (error) {
	console.error(error);
	failures.push(String(error));
} finally {
	await Promise.race([Promise.allSettled([b.close(), sim.stop()]), sleep(10_000)]);
}

for (const required of [
	"opening the panel, its sections and a preview writes nothing",
	"the entry is filed under the reading's key with the unit it shows, in the same write",
	"reading 1's edit writes the number and the unit it was typed in together",
	"a Back tile hides the snooze choice"
]) {
	if (!checksRun.includes(required)) {
		console.log(`FAIL  required check did not run: ${required}`);
		failures.push(required);
	}
}
console.log(failures.length === 0 ? `\nPI KEYS E2E: ALL ${checksRun.length} CHECKS PASSED` : `\nPI KEYS E2E: ${failures.length} FAILURES`);
process.exit(failures.length === 0 ? 0 : 1);
