// The dial panel's alert controls and the Control panel's snooze commands,
// driven in headless Chromium against the simulated host
// (scripts/lib/pi-sim.mjs), whose plugin side is the production preview
// builder. Checks:
//
//   observe   opening the dial panel, expanding Alerts and Timing, and the
//             reading changing under it write nothing
//   capture   ticking "Separate limits for <reading>" writes exactly
//             alertRules: one entry with the unit the plugin says the face
//             shows, seeded from Warn at and Critical at when they cover
//             the reading; the typed limits, the direction and clearing the
//             box each write exactly alertRules, and every other entry,
//             junk value and unknown field stays as stored; a dial limit
//             stored as a number is copied as its text
//   bound     typing that goes on across an auto cycle step saves what was
//             typed to the reading it was typed for, and the field lets go:
//             the next keystroke never reaches the new reading's limits
//   re-anchor limits saved for another unit are off until edited: an edit
//             (a number or the direction) saves the unit on the face with
//             it and the note goes; limits that still compare (°C on a °F
//             face) keep their unit; the brackets name the unit to type in
//   waiting   with no live reading there is no unit to capture: the box is
//             disabled and a click writes nothing
//   timing    Alert after and Snooze lasts each write exactly their own
//             field; Clear by writes its own with the unit stamp
//   stamp     a Warn at or Critical at edit writes alertDisplayUnit in the
//             same write (the unit the plugin compares them in), an edit on
//             a °F dial keeps a °C stamp, and with no reading reporting the
//             number goes alone
//   gestures  Snooze alerts is offered on every push and touch gesture and
//             writes exactly that gesture's field
//   control   the Control key offers both snooze commands and shows its
//             snooze note with them only
//   reflow    the reading on the dial changing (the auto cycle) never moves
//             a box in the Alerts section, notes coming and going included
//
// Run: npx tsx scripts/e2e-pi-dial-alerts.mjs  (no Stream Deck app, no HWiNFO).
// SIMULATED HOST: this proves the shipped panel code and the production
// message shapes, not the Stream Deck app's embedded webview.
import { launch } from "./lib/cdp.mjs";
import { makeCheck, sleep } from "./lib/e2e-common.mjs";
import { FUTURE_BLOB } from "./lib/pi-fixtures.mjs";
import { startPiSim } from "./lib/pi-sim.mjs";

const failures = [];
const check = makeCheck((name) => failures.push(name));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const PORT_BASE = Number(process.env.PI_DIAL_ALERTS_PORT_BASE ?? 29360);
const sim = await startPiSim({ httpPort: PORT_BASE + 1, wsPort: PORT_BASE });
const b = await launch({ width: 400, height: 900 });
const pageErrors = [];
b.on("Runtime.exceptionThrown", (p) => pageErrors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text));
const watchdog = setTimeout(async () => {
	console.error("[e2e-pi-dial-alerts] watchdog: 180 s elapsed, aborting");
	await Promise.race([Promise.allSettled([b.close(), sim.stop()]), sleep(10_000)]);
	process.exit(2);
}, 180_000);
watchdog.unref();

async function open(fixture, overrides) {
	sim.setFixture(fixture, overrides);
	await b.goto(sim.url(fixture));
	const deadline = performance.now() + 3500;
	while (!(await b.evaluate(`document.readyState === "complete" && (document.body.dataset.kind === "control" || (!!window.__hwPanel?.context && window.__hwPanel?.tree != null)) && !document.documentElement.hasAttribute("data-folds-pending")`))) {
		if (performance.now() >= deadline) throw new Error(`${fixture}: the panel was not ready within 3500 ms`);
		await sleep(25);
	}
	await b.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}
const writes = () => ({ settings: sim.writes.length, globals: sim.globalWrites.length });
const lastWrite = () => sim.writes.at(-1);
function changedKeys(before, after) {
	const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
	return [...keys].filter((k) => !same(before[k], after[k])).sort();
}
const expandAlerts = () => b.evaluate(`(() => { document.getElementById("sec-alerts").open = true; document.getElementById("sec-timing").open = true; })()`);
/** Types into a field the way a person does, then leaves it. */
async function typeInto(id, text) {
	await b.evaluate(`(() => { const i = document.getElementById(${JSON.stringify(id)}); i.focus(); i.select(); })()`);
	await b.key("Backspace");
	await b.type(text);
	await sleep(350);
	await b.evaluate(`document.getElementById(${JSON.stringify(id)}).blur()`);
	await sleep(100);
}

try {
	const configured = sim.fixtures["dial-configured"].settings;
	const gpu = configured.readingKey;
	const [, hot, gpuPower] = configured.rotationKeys;

	// ---- observe -----------------------------------------------------------
	await open("dial-configured");
	await expandAlerts();
	sim.pushPreview();
	await sleep(250);
	const shown = await b.evaluate(`(() => ({
		label: document.getElementById("alert-own-label").textContent,
		checked: document.getElementById("alert-own").checked,
		disabled: document.getElementById("alert-own").disabled,
		fields: ["alert-own-warn", "alert-own-crit", "alert-own-hyst", "alert-own-below"].map((id) => document.getElementById(id).disabled),
		timing: document.querySelector('[data-summary="alert-timing"]').textContent
	}))()`);
	check("observe: the box names the reading on the dial", shown.label === "Separate limits for GPU Temperature", shown.label);
	check("observe: no limits of its own yet; the box can be ticked; its fields wait", !shown.checked && !shown.disabled && shown.fields.every(Boolean), JSON.stringify(shown));
	check("observe: the Timing line says what runs", shown.timing === "Alerts show at once · snooze 15 min", shown.timing);
	check("observe: opening and expanding write nothing", sim.writes.length === 0 && sim.globalWrites.length === 0, JSON.stringify(writes()));

	// ---- capture -----------------------------------------------------------
	const stored = { ...configured, alertRules: { [gpuPower]: { warn: "300", unit: "W", futureEntryField: 1 }, junk: 7 } };
	await open("dial-configured", { settings: stored });
	await expandAlerts();
	let before = structuredClone(sim.settings);
	await b.click("#alert-own");
	await sleep(300);
	let after = lastWrite();
	check("capture: ticking the box makes one write", sim.writes.length === 1 && sim.globalWrites.length === 0, JSON.stringify(writes()));
	check("capture: it changes exactly alertRules", after !== undefined && same(changedKeys(before, after), ["alertRules"]), JSON.stringify(after && changedKeys(before, after)));
	check("capture: one entry with the unit on the face, seeded from Warn at and Critical at", same(after?.alertRules?.[gpu], { warn: "80", crit: "90", unit: "°C" }), JSON.stringify(after?.alertRules?.[gpu]));
	check("capture: other entries and junk stay as stored", same(after?.alertRules?.[gpuPower], { warn: "300", unit: "W", futureEntryField: 1 }) && after?.alertRules?.junk === 7, JSON.stringify(after?.alertRules));
	check("capture: the unknown nested field is intact", same(after?.futureBlob, FUTURE_BLOB));
	const enabled = await b.evaluate(`["alert-own-warn", "alert-own-crit", "alert-own-hyst", "alert-own-below"].map((id) => document.getElementById(id).disabled)`);
	check("capture: its fields open for editing", enabled.every((d) => d === false), JSON.stringify(enabled));

	before = structuredClone(sim.settings);
	await typeInto("alert-own-warn", "85,5");
	after = lastWrite();
	check("capture: typing its warn limit writes exactly alertRules, as typed", same(changedKeys(before, after), ["alertRules"]) && same(after?.alertRules?.[gpu], { warn: "85,5", crit: "90", unit: "°C" }), JSON.stringify(after?.alertRules?.[gpu]));
	before = structuredClone(sim.settings);
	await b.click("#alert-own-below");
	await sleep(300);
	after = lastWrite();
	check("capture: the direction writes exactly alertRules", same(changedKeys(before, after), ["alertRules"]) && after?.alertRules?.[gpu]?.below === true, JSON.stringify(after?.alertRules?.[gpu]));
	await typeInto("alert-own-hyst", "2");
	check("capture: its recovery band lands in the same entry", same(lastWrite()?.alertRules?.[gpu], { warn: "85,5", crit: "90", unit: "°C", below: true, hyst: "2" }), JSON.stringify(lastWrite()?.alertRules?.[gpu]));
	const summary = await b.evaluate(`document.querySelector('[data-summary="alerts"]').textContent`);
	check("capture: the Alerts line summarizes this reading's own limits", summary.startsWith("This reading: warn ≤ 85,5 °C · critical ≤ 90 °C"), summary);
	before = structuredClone(sim.settings);
	await b.click("#alert-own");
	await sleep(300);
	after = lastWrite();
	check("capture: clearing the box removes that entry alone", same(changedKeys(before, after), ["alertRules"]) && after?.alertRules?.[gpu] === undefined && same(after?.alertRules?.[gpuPower], { warn: "300", unit: "W", futureEntryField: 1 }) && after?.alertRules?.junk === 7, JSON.stringify(after?.alertRules));
	check("capture: the legacy fields were never touched", after?.warnValue === "80" && after?.critValue === "90" && after?.alertUnit === "°C", JSON.stringify(after));

	// A reading the dial's limits do not cover (the scope is RPM): the
	// capture carries the unit and nothing else.
	await open("dial-configured", { settings: { ...configured, alertUnit: "RPM" } });
	await expandAlerts();
	await b.click("#alert-own");
	await sleep(300);
	check("capture: limits that do not cover the reading are not copied", same(lastWrite()?.alertRules, { [gpu]: { unit: "°C" } }), JSON.stringify(lastWrite()?.alertRules));

	// A dial limit stored as a number (a configuration document can carry
	// one; the runtime reads it): the tick copies it as text, so the tick
	// alone changes no alert.
	await open("dial-configured", { settings: { ...configured, warnValue: 80, alertHysteresis: 2 } });
	await expandAlerts();
	await b.click("#alert-own");
	await sleep(300);
	check("capture: a dial limit stored as a number is copied as its text", same(lastWrite()?.alertRules?.[gpu], { warn: "80", crit: "90", hyst: "2", unit: "°C" }), JSON.stringify(lastWrite()?.alertRules?.[gpu]));

	// ---- bound -------------------------------------------------------------
	// Typing goes on across an auto cycle step: what was typed before the
	// step lands in the reading it was typed for, the field lets go, and
	// the next keystroke can never reach the new reading's limits.
	const twoOwn = { ...configured, alertRules: { [gpu]: { warn: "80", unit: "°C" }, [hot]: { warn: "60", unit: "°C" } } };
	await open("dial-configured", { settings: twoOwn });
	await expandAlerts();
	await b.evaluate(`(() => { const i = document.getElementById("alert-own-warn"); i.focus(); i.select(); })()`);
	await b.type("9");
	await sleep(400);
	check("bound: the first keystroke saves to the reading on the dial", sim.writes.length === 1 && same(lastWrite()?.alertRules?.[gpu], { warn: "9", unit: "°C" }), JSON.stringify(sim.writes.map((w) => w.alertRules)));
	sim.pushSettings({ ...sim.settings, readingKey: hot });
	sim.pushPreview();
	await sleep(250);
	await b.type("5");
	await sleep(400);
	const bound = await b.evaluate(`(() => { const i = document.getElementById("alert-own-warn"); return { focused: document.activeElement === i, value: i.value, label: document.getElementById("alert-own-label").textContent }; })()`);
	check("bound: the new reading's limits are untouched by the next keystroke", same(sim.settings.alertRules?.[hot], { warn: "60", unit: "°C" }), JSON.stringify(sim.settings.alertRules));
	check("bound: the old reading keeps what was typed for it", same(sim.settings.alertRules?.[gpu], { warn: "9", unit: "°C" }), JSON.stringify(sim.settings.alertRules));
	check("bound: the field let go and shows the new reading's limit under its name", !bound.focused && bound.value === "60" && bound.label === "Separate limits for GPU Hot Spot Temperature", JSON.stringify(bound));
	check("bound: one write in all", sim.writes.length === 1, JSON.stringify(writes()));
	// Typing that ends on the same reading still saves to it at once on
	// commit, as before.
	await typeInto("alert-own-warn", "65");
	check("bound: after the step, an edit goes to the reading now on the dial", same(lastWrite()?.alertRules?.[hot], { warn: "65", unit: "°C" }) && same(lastWrite()?.alertRules?.[gpu], { warn: "9", unit: "°C" }), JSON.stringify(lastWrite()?.alertRules));

	// ---- re-anchor ---------------------------------------------------------
	// Limits saved for another unit are off, and the note says so until
	// they are edited: an edit saves the unit on the face with the number,
	// and the note goes. The brackets name the unit the fields are typed in.
	const offLimits = { ...configured, readingKey: gpuPower, alertRules: { [gpuPower]: { warn: "300", crit: "400", unit: "°C", futureEntryField: 1 } } };
	await open("dial-configured", { settings: offLimits });
	await expandAlerts();
	sim.pushPreview();
	await sleep(250);
	const off = await b.evaluate(`({ note: document.getElementById("alert-notes").textContent, units: [...document.querySelectorAll("[data-alert-unit]")].map((el) => el.textContent) })`);
	check("re-anchor: the note says the limits are off", off.note === "These limits were set for °C. This reading now reports W, so they are off until you edit them.", off.note);
	check("re-anchor: the brackets name the unit an edit saves", off.units.length === 3 && off.units.every((u) => u === "(W)"), JSON.stringify(off.units));
	before = structuredClone(sim.settings);
	await typeInto("alert-own-warn", "350");
	after = lastWrite();
	check("re-anchor: the edit writes exactly alertRules, the unit on the face with the number", same(changedKeys(before, after ?? {}), ["alertRules"]) && same(after?.alertRules?.[gpuPower], { warn: "350", crit: "400", unit: "W", futureEntryField: 1 }), JSON.stringify(after?.alertRules));
	sim.pushPreview();
	await sleep(250);
	const anchored = await b.evaluate(`({ note: document.getElementById("alert-notes").textContent, summary: document.querySelector('[data-summary="alerts"]').textContent })`);
	check("re-anchor: the note is gone and the limits apply in W", anchored.note === "" && anchored.summary.startsWith("This reading: warn ≥ 350 W · critical ≥ 400 W"), JSON.stringify(anchored));
	await open("dial-configured", { settings: { ...offLimits, alertRules: { [gpuPower]: { crit: "400", unit: "°C" } } } });
	await expandAlerts();
	await b.click("#alert-own-below");
	await sleep(300);
	check("re-anchor: the direction is an edit too", same(lastWrite()?.alertRules?.[gpuPower], { crit: "400", unit: "W", below: true }), JSON.stringify(lastWrite()?.alertRules));
	// Limits that still compare keep their unit: °C limits on a °F face.
	await open("dial-configured", { settings: { ...configured, fahrenheit: true, alertRules: { [gpu]: { warn: "80", crit: "90", unit: "°C" } } } });
	await expandAlerts();
	sim.pushPreview();
	await sleep(250);
	const celsius = await b.evaluate(`[...document.querySelectorAll("[data-alert-unit]")].map((el) => el.textContent)`);
	check("re-anchor: °C limits on a °F face are typed in °C, as the brackets say", celsius.every((u) => u === "(°C)"), JSON.stringify(celsius));
	await typeInto("alert-own-warn", "85");
	check("re-anchor: an edit keeps °C, so the other limit is never reinterpreted", same(lastWrite()?.alertRules?.[gpu], { warn: "85", crit: "90", unit: "°C" }), JSON.stringify(lastWrite()?.alertRules));

	// ---- waiting -----------------------------------------------------------
	await open("dial-unavailable");
	await expandAlerts();
	const waiting = await b.evaluate(`(() => { const box = document.getElementById("alert-own"); return { disabled: box.disabled, title: box.title }; })()`);
	check("waiting: with nothing reporting there is no unit to capture", waiting.disabled && waiting.title === "Waits for this reading to report", JSON.stringify(waiting));
	await b.evaluate(`document.getElementById("alert-own").click()`);
	await sleep(250);
	check("waiting: a click writes nothing", sim.writes.length === 0, JSON.stringify(writes()));

	// ---- timing ------------------------------------------------------------
	for (const [id, value, field] of [["f-dwell", "5000", "alertDwellMs"], ["f-snooze", "3600000", "alertSnoozeMs"]]) {
		await open("dial-configured");
		await expandAlerts();
		before = structuredClone(sim.settings);
		await b.evaluate(`(() => { const s = document.getElementById(${JSON.stringify(id)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event("change")); })()`);
		await sleep(300);
		after = lastWrite();
		check(`timing: ${field} writes exactly itself`, sim.writes.length === 1 && same(changedKeys(before, after), [field]) && after?.[field] === value, JSON.stringify(after && changedKeys(before, after)));
	}
	await open("dial-configured");
	await expandAlerts();
	before = structuredClone(sim.settings);
	await typeInto("f-hyst", "1,5");
	after = lastWrite();
	check("timing: Clear by writes alertHysteresis with the unit it was typed in", same(changedKeys(before, after ?? {}), ["alertDisplayUnit", "alertDisplayUnitFor", "alertHysteresis"]) && after?.alertHysteresis === "1,5" && after?.alertDisplayUnit === "°C", JSON.stringify(after && changedKeys(before, after)));
	await open("dial-configured", { settings: { ...configured, alertDwellMs: "10000", alertSnoozeMs: "300000" } });
	const timing = await b.evaluate(`document.querySelector('[data-summary="alert-timing"]').textContent`);
	check("timing: the summary follows what is stored", timing === "Alerts show after 10 s · snooze 5 min", timing);

	// ---- stamp -------------------------------------------------------------
	// Warn at and Critical at carry the unit they were typed in, in the same
	// write as the number, so a later °F switch converts them.
	await open("dial-configured");
	await expandAlerts();
	before = structuredClone(sim.settings);
	let mark = sim.writes.length;
	await typeInto("f-warn", "85");
	const stamped = sim.writes.slice(mark);
	check("stamp: a Warn at edit writes the number and the unit it was typed in together", stamped.length === 1 && stamped[0].warnValue === "85" && stamped[0].alertDisplayUnit === "°C" && same(stamped[0].alertDisplayUnitFor, { warn: "85", ...(typeof configured.critValue === "string" ? { crit: configured.critValue } : {}) }) && same(changedKeys(before, stamped[0]), ["alertDisplayUnit", "alertDisplayUnitFor", "warnValue"]), JSON.stringify(stamped.map((w) => changedKeys(before, w))));
	await open("dial-configured", { settings: { ...configured, alertDisplayUnit: "°C", alertDisplayUnitFor: { warn: configured.warnValue, ...(typeof configured.critValue === "string" ? { crit: configured.critValue } : {}) }, fahrenheit: true } });
	await expandAlerts();
	const alertsLine = await b.evaluate(`document.querySelector('[data-summary="alerts"]')?.textContent ?? null`);
	check("stamp: limits typed in °C on a °F dial are printed in °C", /80 °C/.test(String(alertsLine)) && !/80 °F/.test(String(alertsLine)), String(alertsLine));
	before = structuredClone(sim.settings);
	mark = sim.writes.length;
	await typeInto("f-crit", "95");
	const kept = sim.writes.slice(mark);
	check("stamp: a Critical at edit keeps the stamped unit, so Warn at keeps its meaning", kept.length === 1 && same(changedKeys(before, kept[0]), ["alertDisplayUnitFor", "critValue"]) && kept[0].alertDisplayUnit === "°C" && kept[0].alertDisplayUnitFor?.crit === "95", JSON.stringify(kept.map((w) => changedKeys(before, w))));
	await open("dial-configured", { settings: { ...configured, readingKey: "f0099999:0:1000000" } });
	await expandAlerts();
	before = structuredClone(sim.settings);
	await typeInto("f-warn", "70");
	check("stamp: with no reading reporting, the edit writes the number alone", same(changedKeys(before, lastWrite() ?? {}), ["warnValue"]), JSON.stringify(changedKeys(before, lastWrite() ?? {})));

	// ---- gestures ----------------------------------------------------------
	const offered = [];
	for (const id of ["g-short", "g-long", "g-tap", "g-hold"]) {
		await open("dial-custom-gestures");
		before = structuredClone(sim.settings);
		const has = await b.evaluate(`(() => { document.getElementById("sec-controls")?.setAttribute("open", ""); const s = document.getElementById(${JSON.stringify(id)}); const ok = [...s.options].some((o) => o.value === "snooze" && o.textContent === "Snooze alerts"); s.value = "snooze"; s.dispatchEvent(new Event("change")); return { ok, field: s.dataset.setting }; })()`);
		await sleep(300);
		after = lastWrite();
		offered.push(has.ok);
		check(`gestures: ${has.field} = snooze writes exactly that field`, sim.writes.length === 1 && same(changedKeys(before, after ?? {}), [has.field]) && after?.[has.field] === "snooze", JSON.stringify(after && changedKeys(before, after)));
	}
	check("gestures: every push and touch list offers Snooze alerts", offered.every(Boolean), JSON.stringify(offered));
	const turns = await b.evaluate(`["g-rotate", "g-pressed-rotate"].map((id) => [...document.getElementById(id).options].some((o) => o.value === "snooze"))`);
	check("gestures: turn lists stay reading and stat controls", turns.every((t) => t === false), JSON.stringify(turns));

	// ---- control -----------------------------------------------------------
	for (const [command, label] of [["snoozeAlerts", "Snooze alerts"], ["unsnoozeAlerts", "End alert snooze"]]) {
		await open("control-default");
		before = structuredClone(sim.settings);
		const state = await b.evaluate(`(() => { const s = document.getElementById("f-command"); const option = [...s.options].find((o) => o.value === ${JSON.stringify(command)}); s.value = ${JSON.stringify(command)}; s.dispatchEvent(new Event("change")); return { label: option?.textContent ?? null }; })()`);
		await sleep(300);
		after = lastWrite();
		const visible = await b.evaluate(`({ note: !document.getElementById("snooze-help").hidden, reach: !document.getElementById("reset-reach").hidden, summary: document.querySelector('[data-summary="command"]')?.textContent ?? null })`);
		check(`control: ${command} is offered as "${label}" and writes exactly command`, state.label === label && same(changedKeys(before, after ?? {}), ["command"]) && after?.command === command, JSON.stringify({ ...state, changed: after && changedKeys(before, after) }));
		check(`control: ${command} shows the snooze note and hides the reset reach`, visible.note && !visible.reach, JSON.stringify(visible));
	}
	await open("control-reset");
	const reset = await b.evaluate(`({ note: !document.getElementById("snooze-help").hidden, reach: !document.getElementById("reset-reach").hidden })`);
	check("control: other commands keep the snooze note hidden", !reset.note && reset.reach, JSON.stringify(reset));

	// ---- reflow ------------------------------------------------------------
	// The auto cycle moves the dial between a reading whose own warn limit
	// is not a number (a note), one with limits of its own that are fine,
	// one whose limits were saved for another unit (a note), and one with
	// none; the plugin writes readingKey and the panel hears it as an echo.
	// No box in the Alerts section moves and nothing is written.
	const cpu = sim.keys.cpu;
	const cycling = { ...configured, alertRules: { [gpu]: { warn: "8o", unit: "°C" }, [hot]: { warn: "60", unit: "°C" }, [gpuPower]: { warn: "300", unit: "°C" } } };
	await open("dial-configured", { settings: cycling });
	await expandAlerts();
	// Tops are measured from the Alerts section's own top (a folded section
	// above may rewrap its summary when the cycle crosses to another sensor),
	// and an element that is not drawn (an option inside a closed select)
	// counts only as not drawn.
	const boxes = `(() => { const top = document.getElementById("sec-alerts").getBoundingClientRect().top; return [...document.querySelectorAll("#sec-alerts .hw-sec-body > *, #alert-own-box *, #sec-timing *")].map((el) => { const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) return [el.id || el.tagName, "not drawn"].join(":"); return [el.id || el.tagName, Math.round(r.top - top), Math.round(r.height), Math.round(r.width)].join(":"); }).join("|"); })()`;
	const sectionTop = `Math.round(document.getElementById("sec-alerts").getBoundingClientRect().top)`;
	const steps = [];
	for (const key of [gpu, hot, gpuPower, cpu, gpu, cpu, hot, gpu]) {
		sim.pushSettings({ ...cycling, readingKey: key });
		sim.pushPreview();
		await sleep(220);
		steps.push({ key, boxes: await b.evaluate(boxes), note: await b.evaluate(`document.getElementById("alert-notes").textContent`), checked: await b.evaluate(`document.getElementById("alert-own").checked`), top: await b.evaluate(sectionTop), invalid: await b.evaluate(`document.getElementById("alert-own-warn").getAttribute("aria-invalid")`) });
	}
	check("reflow: a note came and went while the dial cycled", steps.some((s) => s.note !== "") && steps.some((s) => s.note === ""), JSON.stringify(steps.map((s) => s.note)));
	check("reflow: a limit that is not a number is named in the note line and marked on its field", steps.filter((s) => s.key === gpu).every((s) => s.note.startsWith("Its warn at is not a number") && s.invalid === "true") && steps.filter((s) => s.key !== gpu).every((s) => s.invalid !== "true"), JSON.stringify(steps.map((s) => [s.note, s.invalid])));
	check("reflow: the box follows the reading on the dial", same(steps.map((s) => s.checked), [true, true, true, false, true, false, true, true]), JSON.stringify(steps.map((s) => s.checked)));
	const first = steps[0]?.boxes.split("|") ?? [];
	const moved = steps.flatMap((s) => s.boxes.split("|").filter((box, i) => box !== first[i]).map((box) => `${s.key}: ${box} (was ${first[s.boxes.split("|").indexOf(box)] ?? "?"})`));
	check("reflow: no box in the Alerts section moved", moved.length === 0, moved.slice(0, 4).join(" | "));
	check("reflow: the cycle wrote nothing", sim.writes.length === 0, JSON.stringify(writes()));

	check("run: no page errors anywhere", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (err) {
	console.error("e2e-pi-dial-alerts crashed:", err);
	failures.push(`crash: ${err?.message ?? err}`);
} finally {
	await b.close();
	await sim.stop();
}

console.log(`\n${failures.length === 0 ? "ALL GREEN" : `${failures.length} FAILED`}`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
