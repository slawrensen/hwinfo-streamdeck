// The panel string catalog in headless Chromium against the simulated host
// (scripts/lib/pi-sim.mjs), on a 320 px panel (narrower than the app's
// 378 px), for the sections whose fixed labels carry data-l10n marks:
//
//   english   ui/pi-strings.js changes nothing in English: the language is
//             en, every mark keeps the markup's text, opening writes nothing
//   pseudo    with the pseudo-locale (src/i18n.ts pseudoLocalize: 40%
//             longer, accented Latin) injected through window.hwPiLocale,
//             every mark shows its pseudo string
//   fit       in both languages, with every marked section open and its
//             hidden blocks shown, no marked element and no visible control
//             reaches past the panel's edge and the page never scrolls
//             sideways; a select whose chosen option is wider than the
//             select is listed as cut by design (the open list shows the
//             whole text); measured two frames after the blocks show, so a
//             pair of fields has stacked where it needs to
//   sky       this action's own Dusk opened as a person opens it: the Sky
//             pair keeps two columns in English and stacks in the
//             pseudo-locale, and shows every option whole in both
//
// Run: npx tsx scripts/e2e-pi-l10n.mjs  (no Stream Deck app, no HWiNFO).
// SIMULATED HOST: this proves the shipped panel code at a narrow width in
// Chromium, not the Stream Deck app's webview.
import { readFileSync } from "node:fs";
import { launch } from "./lib/cdp.mjs";
import { makeCheck, sleep } from "./lib/e2e-common.mjs";
import { startPiSim } from "./lib/pi-sim.mjs";
import { catalogKeys, englishOf, pseudoLocalize } from "../src/i18n.ts";
import { PANEL } from "../src/i18n-catalog.ts";

const failures = [];
const check = makeCheck((name) => failures.push(name));
const PORT_BASE = Number(process.env.PI_L10N_PORT_BASE ?? 29380);
const WIDTH = 320;
const sim = await startPiSim({ httpPort: PORT_BASE + 1, wsPort: PORT_BASE });
const b = await launch({ width: WIDTH, height: 900 });
const pageErrors = [];
b.on("Runtime.exceptionThrown", (p) => pageErrors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text));
const watchdog = setTimeout(async () => {
	console.error("[e2e-pi-l10n] watchdog: 120 s elapsed, aborting");
	await Promise.race([Promise.allSettled([b.close(), sim.stop()]), sleep(10_000)]);
	process.exit(2);
}, 120_000);
watchdog.unref();

/** The panel catalog with every string pseudo-localized. */
function pseudoCatalog() {
	const out = {};
	for (const key of catalogKeys(PANEL)) {
		const parts = key.split(".");
		let node = out;
		for (const part of parts.slice(0, -1)) node = node[part] ??= {};
		node[parts[parts.length - 1]] = pseudoLocalize(englishOf(key, PANEL));
	}
	return out;
}
const PSEUDO = pseudoCatalog();
const pseudoOf = (key) => key.split(".").reduce((node, part) => node?.[part], PSEUDO);

let injected = null;
async function setLocale(locale) {
	if (injected !== null) await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: injected });
	injected = null;
	if (locale !== null) injected = (await b.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.hwPiLocale = ${JSON.stringify(locale)};` })).identifier;
}

async function open(fixture, overrides) {
	sim.setFixture(fixture, overrides);
	await b.goto(sim.url(fixture));
	const deadline = performance.now() + 4000;
	while (!(await b.evaluate(`document.readyState === "complete" && !!window.__hwPanel?.context && window.__hwPanel?.tree != null && !document.documentElement.hasAttribute("data-folds-pending")`))) {
		if (performance.now() >= deadline) throw new Error(`${fixture}: the panel was not ready within 4000 ms`);
		await sleep(25);
	}
	await b.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}
const noWrites = (name) => check(`${name}: no writes`, sim.writes.length === 0 && sim.globalWrites.length === 0, JSON.stringify({ settings: sim.writes.length, globals: sim.globalWrites.length }));

const MARKS = `[data-l10n], [data-l10n-placeholder], [data-l10n-aria-label], [data-l10n-title]`;

/** Each data-l10n mark's key and the leading text it shows. */
const markTexts = () => b.evaluate(`[...document.querySelectorAll("[data-l10n]")].map((el) => ({ key: el.dataset.l10n, text: (el.firstChild?.nodeType === Node.TEXT_NODE ? el.firstChild.data : "").replace(/\\s+/g, " ").trim() }))`);

const frames = () => b.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");

/** In-page: opens every section holding a mark and shows its hidden
 * blocks; the number of blocks it showed. */
const REVEAL = `(() => {
	let shown = 0;
	for (const el of document.querySelectorAll(${JSON.stringify(MARKS)})) {
		for (let node = el; node !== null && node !== document.body; node = node.parentElement) {
			if (node.hidden) { node.hidden = false; shown++; }
			if (node.tagName === "DETAILS") node.open = true;
		}
	}
	return shown;
})()`;

/** Opens every section holding a mark and shows its hidden blocks, waits
 * two frames so what lays itself out on a size change has done so (a
 * pair of fields stacks where a select cannot show an option whole), shows
 * again what a section's own render hid as it opened (Reading to link on a
 * one-reading key), then measures: marks and controls past the edge,
 * sideways scroll, and selects whose chosen option is cut. */
async function measure() {
	const first = await b.evaluate(REVEAL);
	await frames();
	const measured = await b.evaluate(`(() => {
		const shown = ${REVEAL};
		const marks = [...document.querySelectorAll(${JSON.stringify(MARKS)})];
		const vw = document.documentElement.clientWidth;
		const past = [];
		const unrendered = [];
		const name = (el) => el.dataset.l10n ?? el.dataset.l10nPlaceholder ?? el.dataset.l10nAriaLabel ?? el.dataset.l10nTitle ?? el.id ?? el.tagName;
		for (const el of marks) {
			const target = el.tagName === "OPTION" ? el.closest("select") : el;
			const r = target.getBoundingClientRect();
			if (r.width === 0 && r.height === 0) { unrendered.push(name(el)); continue; }
			if (r.left < -0.5 || r.right > vw + 0.5) past.push(name(el) + " " + Math.round(r.left) + ".." + Math.round(r.right));
		}
		const controls = [...document.querySelectorAll("select, input, button, label, legend, summary, p, li")].filter((el) => el.getClientRects().length > 0);
		for (const el of controls) {
			const r = el.getBoundingClientRect();
			if (r.right > vw + 0.5 || r.left < -0.5) past.push((el.id || el.tagName) + " " + Math.round(r.left) + ".." + Math.round(r.right));
		}
		const canvas = document.createElement("canvas").getContext("2d");
		const cut = [];
		for (const select of document.querySelectorAll("select")) {
			if (select.getClientRects().length === 0 || select.selectedIndex < 0) continue;
			const cs = getComputedStyle(select);
			canvas.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
			const room = select.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 16;
			if (canvas.measureText(select.options[select.selectedIndex].text).width > room) cut.push(select.id);
		}
		return { vw, scrollWidth: document.documentElement.scrollWidth, marks: marks.length, shown, past: [...new Set(past)], unrendered, cut };
	})()`);
	return { ...measured, shown: first + measured.shown };
}

/** The Sky pair as a person sees it: whether it shows and stacks, and
 * every offered option its select cannot show whole (the measure
 * pi-common.js fitPair uses). */
const SKY_FIT = `(() => {
	const pair = document.getElementById("art-sky");
	const canvas = document.createElement("canvas").getContext("2d");
	const cut = [];
	for (const select of pair.querySelectorAll("select")) {
		if (select.getClientRects().length === 0) continue;
		const cs = getComputedStyle(select);
		canvas.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
		const room = select.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 16;
		for (const option of select.options) if (!option.hidden && canvas.measureText(option.text).width > room) cut.push(select.id + ": " + option.text);
	}
	return { shown: !pair.hidden && pair.getClientRects().length > 0, stack: pair.classList.contains("hw-stack"), cut };
})()`;

/** Shows every option of each marked select in turn, so the cut list
 * covers every option, not only the chosen one. */
async function cutOptions() {
	return b.evaluate(`(() => {
		const canvas = document.createElement("canvas").getContext("2d");
		const cut = [];
		for (const option of document.querySelectorAll("option[data-l10n]")) {
			const select = option.closest("select");
			if (select.getClientRects().length === 0) continue;
			const cs = getComputedStyle(select);
			canvas.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
			const room = select.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 16;
			if (canvas.measureText(option.text).width > room) cut.push(option.dataset.l10n);
		}
		return [...new Set(cut)];
	})()`);
}

const PANELS = [
	["sensor-reading.html", "key-configured"],
	["sensor-dial.html", "dial-configured"]
];

try {
	for (const [panel, fixture] of PANELS) {
		// ---- english ------------------------------------------------------
		await setLocale(null);
		await open(fixture);
		check(`english ${panel}: the panel language is en`, (await b.evaluate("window.hwPiLanguage")) === "en");
		const english = await markTexts();
		const changed = english.filter(({ key, text }) => text !== englishOf(key, PANEL));
		check(`english ${panel}: every mark keeps the markup's English (${english.length} marks)`, english.length > 0 && changed.length === 0, JSON.stringify(changed.slice(0, 3)));
		noWrites(`english ${panel} (opening)`);
		const en = await measure();
		check(`english ${panel}: no sideways scroll at ${WIDTH} px`, en.scrollWidth <= en.vw, `${en.scrollWidth} > ${en.vw}`);
		check(`english ${panel}: nothing reaches past the edge (${en.marks} marks, ${en.shown} hidden blocks shown)`, en.past.length === 0, en.past.slice(0, 5).join(" | "));
		check(`english ${panel}: every mark renders once its section shows`, en.unrendered.length === 0, en.unrendered.slice(0, 5).join(" | "));
		console.log(`INFO  english ${panel}: selects showing a cut option at ${WIDTH} px (by design): ${JSON.stringify(en.cut)}; options that would cut: ${JSON.stringify(await cutOptions())}`);
		noWrites(`english ${panel} (measuring)`);

		// ---- pseudo -------------------------------------------------------
		await setLocale({ language: "x-pseudo", strings: PSEUDO });
		await open(fixture);
		check(`pseudo ${panel}: the panel language is the injected one`, (await b.evaluate("window.hwPiLanguage")) === "x-pseudo");
		const pseudo = await markTexts();
		const missed = pseudo.filter(({ key, text }) => text !== pseudoOf(key));
		check(`pseudo ${panel}: every mark shows its pseudo string (${pseudo.length} marks)`, pseudo.length === english.length && missed.length === 0, JSON.stringify(missed.slice(0, 3)));
		const attrs = await b.evaluate(`[...document.querySelectorAll("[data-l10n-placeholder]")].map((el) => [el.dataset.l10nPlaceholder, el.placeholder])`);
		// Every placeholder the shipped markup marks, and only those.
		const marked = (readFileSync(new URL(`../com.lawrensen.hwinfo.sdPlugin/ui/${panel}`, import.meta.url), "utf8").match(/\sdata-l10n-placeholder="/g) ?? []).length;
		check(`pseudo ${panel}: placeholders take their pseudo strings (${marked} marked)`, attrs.length === marked && attrs.every(([key, value]) => value === pseudoOf(key)), JSON.stringify(attrs.slice(0, 2)));
		const labels = await b.evaluate(`[...document.querySelectorAll("[data-l10n-aria-label]")].map((el) => [el.dataset.l10nAriaLabel, el.getAttribute("aria-label")])`);
		check(`pseudo ${panel}: aria-labels take their pseudo strings`, labels.length > 0 && labels.every(([key, value]) => value === pseudoOf(key)), JSON.stringify(labels.slice(0, 2)));
		noWrites(`pseudo ${panel} (opening)`);

		const ps = await measure();
		check(`pseudo ${panel}: no sideways scroll at ${WIDTH} px`, ps.scrollWidth <= ps.vw, `${ps.scrollWidth} > ${ps.vw}`);
		check(`pseudo ${panel}: nothing reaches past the edge (${ps.marks} marks, ${ps.shown} hidden blocks shown)`, ps.past.length === 0, ps.past.slice(0, 5).join(" | "));
		check(`pseudo ${panel}: every mark renders once its section shows`, ps.unrendered.length === 0, ps.unrendered.slice(0, 5).join(" | "));
		console.log(`INFO  pseudo ${panel}: selects showing a cut option at ${WIDTH} px (by design): ${JSON.stringify(ps.cut)}; options that would cut: ${JSON.stringify(await cutOptions())}`);
		check(`pseudo ${panel}: the Sky's two selects show their chosen option whole once the pair has fitted itself`, !ps.cut.includes("f-art-stars") && !ps.cut.includes("f-art-sky-color"), JSON.stringify(ps.cut));
		noWrites(`pseudo ${panel} (measuring)`);

		// The one line under the scale fields shows only while stored ends do
		// not apply to the graph (pi-strip-model.js scaleHelpKey); shown here
		// with the hidden blocks, it fits in both panes.
		if (panel === "sensor-dial.html") {
			const key = "pi.strip.scaleNotUsed";
			const fit = await measure();
			const lines = await b.evaluate(`[...document.querySelectorAll('[id$="-scale-help"]')].map((el) => el.dataset.l10n === ${JSON.stringify(key)} && el.getClientRects().length > 0 && el.textContent === ${JSON.stringify(pseudoOf(key))})`);
			check(`pseudo ${panel}: the scale line ${key} fits at ${WIDTH} px in both panes`, lines.length === 2 && lines.every(Boolean) && fit.past.length === 0 && fit.scrollWidth <= fit.vw, JSON.stringify({ lines, past: fit.past.slice(0, 5), scrollWidth: fit.scrollWidth }));
			noWrites(`pseudo ${panel} (scale line)`);
		}
	}

	// The Sky pair on the path a person takes: this action's own Dusk,
	// Display open, nothing shown by the suite, two frames. In English the
	// pair keeps its two columns; in the pseudo-locale it stacks; either
	// way every option it offers shows whole, and opening writes nothing.
	for (const [panel, fixture, kind] of [["sensor-reading.html", "key-configured", "key"], ["sensor-dial.html", "dial-configured", "dial"]]) {
		for (const [language, locale] of [["english", null], ["pseudo", { language: "x-pseudo", strings: PSEUDO }]]) {
			await setLocale(locale);
			await open(fixture, { settings: { ...sim.fixtures[fixture].settings, [`${kind}Background`]: "dusk" } });
			await b.evaluate(`document.getElementById("sec-display").open = true`);
			await frames();
			const fit = await b.evaluate(SKY_FIT);
			const stacks = language === "pseudo";
			check(`${language} ${panel}: on its own Dusk the Sky pair ${stacks ? "stacks" : "keeps two columns"} at ${WIDTH} px and shows every option whole`, fit.shown && fit.stack === stacks && fit.cut.length === 0, JSON.stringify(fit));
			noWrites(`${language} ${panel} (own Dusk)`);
		}
	}
	await setLocale(null);
	check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (error) {
	check("suite ran to the end", false, String(error?.stack ?? error));
} finally {
	await Promise.race([Promise.allSettled([b.close(), sim.stop()]), sleep(10_000)]);
}

console.log(failures.length === 0 ? "\nPI L10N E2E: ALL CHECKS PASSED" : `\nPI L10N E2E: ${failures.length} FAILURES`);
process.exit(failures.length === 0 ? 0 : 1);
