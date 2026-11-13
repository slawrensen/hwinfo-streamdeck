// The panels' help budget: measures the help and explanatory text every
// settings panel shows, in headless Chromium against the simulated host
// (scripts/lib/pi-sim.mjs), at the app's panel width (378 CSS px at a
// device pixel ratio of 1.5), and holds it to scripts/fixtures/
// pi-help-baseline.json (1.7.1's panels, measured the same way):
//
//   opened    the panel as it opens (the default folds): rendered help
//             lines and help block height per panel
//   sections  each top-level section opened on its own, the folds inside
//             it left as they open: lines and height per section, and
//             their sum per panel
//   folds     each fold inside a section opened with it: its own blocks
//
// Help is every rendered .hw-help and .hw-hint block (the outermost one
// where they nest); a line is one line box of its visible text, screen
// reader text excluded. Each state is measured from the panel's own
// defaults plus the few settings that reveal a block (a see-through
// background, an art look, details on press, a quad key, an overview
// dial). A panel, section or fold may show less help than its
// baseline, never more. One 1.7.1 did not have is held to the 1.8.0
// measurement recorded under "added", so it can never grow again unnoticed
// either; a whole state 1.7.1 could not show (the art looks: an own Dusk, on
// Paper, a strip's Dusk, a shared Dusk) is recorded there whole, opened and
// total included, and checked the same way.
//
// Run: npx tsx scripts/e2e-pi-help.mjs  (no Stream Deck app, no HWiNFO).
// `-- --report <file>` writes the full measurement (every block and its
// text) as JSON instead of checking; with PI_SIM_PLUGIN_DIR pointing at
// another checkout's plugin folder it measures those panels (how the 1.7.1
// baseline was taken, from the bb4aede tree). SIMULATED HOST: Chromium's
// layout and this PC's fonts, not the Stream Deck app's webview.
import { readFileSync, writeFileSync } from "node:fs";
import { launch } from "./lib/cdp.mjs";
import { makeCheck, sleep } from "./lib/e2e-common.mjs";
import { startPiSim } from "./lib/pi-sim.mjs";
import { PanelFoldMemory } from "../src/panel-folds.ts";

const failures = [];
const check = makeCheck((name) => failures.push(name));
const PORT_BASE = Number(process.env.PI_HELP_PORT_BASE ?? 29400);
const WIDTH = 378;
const SCALE = 1.5;
const reportAt = process.argv.indexOf("--report");
const reportFile = reportAt >= 0 ? process.argv[reportAt + 1] : null;
const baselineUrl = new URL("./fixtures/pi-help-baseline.json", import.meta.url);

/** What is measured, as [name, simulator fixture, settings merged over
 * the fixture's, and optionally { globals, strip }: globals merged over the
 * fixture's, and strip.patch appended to the fixture strip's create patch]. */
const MEASURED = [
	["key-empty", "key-empty", {}],
	["key-configured", "key-configured", {}],
	["key-see-through", "key-configured", { keyBackground: "glass" }],
	["key-art", "key-configured", { keyBackground: "dusk" }],
	["key-art-paper", "key-configured", { keyBackground: "dusk", theme: "paper" }],
	["shared-art", "key-configured", {}, { globals: { keyBackground: "dusk", dialBackground: "dusk" } }],
	["key-details", "key-configured", { pressBehavior: "open-details" }],
	["key-quad", "key-dense", {}],
	["dial-empty", "dial-empty", {}],
	["dial-configured", "dial-configured", {}],
	["dial-see-through", "dial-configured", { dialBackground: "glass" }],
	["dial-art", "dial-configured", { dialBackground: "dusk" }],
	["dial-overview", "dial-configured", { dialView: "overview" }],
	["dial-two-row", "dial-configured", { dialView: "tworow" }],
	["dial-strip", "dial-strip-plus", {}],
	["dial-strip-member", "dial-strip-member", {}],
	["dial-strip-art", "dial-strip-member", {}, { strip: { patch: [{ op: "set", path: "background", value: "dusk" }] } }],
	["control-default", "control-default", {}],
	["control-snooze", "control-default", { command: "snoozeAlerts" }],
	["control-strip", "control-default", { command: "stripLive" }],
	["slot-reading", "slot-reading", {}],
	["slot-back", "slot-back", {}]
];

const sim = await startPiSim({ httpPort: PORT_BASE + 1, wsPort: PORT_BASE });
const b = await launch({ width: WIDTH, height: 900, scale: SCALE });
const pageErrors = [];
b.on("Runtime.exceptionThrown", (p) => pageErrors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text));
const watchdog = setTimeout(async () => {
	console.error("[e2e-pi-help] watchdog: 600 s elapsed, aborting");
	await Promise.race([Promise.allSettled([b.close(), sim.stop()]), sleep(10_000)]);
	process.exit(2);
}, 600_000);
watchdog.unref();

async function open([name, fixture, extra, over = {}]) {
	sim.folds = new PanelFoldMemory(); // every state opens with the default folds
	const fx = sim.fixtures[fixture];
	sim.setFixture(fixture, {
		settings: { ...fx.settings, ...extra },
		...(over.globals === undefined ? {} : { globals: { ...fx.globals, ...over.globals } }),
		...(over.strip === undefined ? {} : { strip: { ...fx.strip, create: { ...fx.strip.create, patch: [...(fx.strip.create?.patch ?? []), ...over.strip.patch] } } })
	});
	await b.goto(sim.url(fixture));
	const deadline = performance.now() + 4000;
	while (!(await b.evaluate(`document.readyState === "complete" && (document.body.dataset.kind === "slot" || document.body.dataset.kind === "control" || (!!window.__hwPanel?.context && window.__hwPanel?.tree != null)) && !document.documentElement.hasAttribute("data-folds-pending")`))) {
		if (performance.now() >= deadline) throw new Error(`${name}: the panel was not ready within 4000 ms`);
		await sleep(25);
	}
	// A strip's own fields reach Display once the strip has answered.
	while (over.strip !== undefined && !(await b.evaluate(`window.hwShell?.redirected?.("dialBackground") === true`))) {
		if (performance.now() >= deadline + 4000) throw new Error(`${name}: the strip's fields did not reach the panel within 8000 ms`);
		await sleep(25);
	}
	await sleep(400); // runtime help (theme notes, scope lines) lands after the first answers
	await b.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}

/** In-page: every rendered help block inside `root` (a selector, or the
 * whole page), with its section, fold, lines and height. */
const MEASURE = `((rootSelector) => {
	const HELP = ".hw-help, .hw-hint";
	const root = rootSelector === null ? document.body : document.querySelector(rootSelector);
	if (root === null) return [];
	const shown = (el) => {
		if (el.getClientRects().length === 0) return false;
		for (let n = el.parentElement; n !== null; n = n.parentElement) {
			if (n.tagName === "DETAILS" && !n.open) {
				const summary = n.querySelector(":scope > summary");
				if (summary === null || !summary.contains(el)) return false;
			}
		}
		return getComputedStyle(el).visibility !== "hidden";
	};
	const lineCount = (el) => {
		const mids = [];
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		for (let t = walker.nextNode(); t !== null; t = walker.nextNode()) {
			if (t.data.trim() === "" || t.parentElement.closest(".hw-sr-only") !== null) continue;
			const range = document.createRange();
			range.selectNodeContents(t);
			for (const r of range.getClientRects()) {
				if (r.width < 1 || r.height < 1) continue;
				const mid = r.top + r.height / 2;
				if (!mids.some((m) => Math.abs(m - mid) < r.height / 2)) mids.push(mid);
			}
		}
		return mids.length;
	};
	const foldName = (d) => d.id || d.className + ":" + (d.querySelector(":scope > summary")?.textContent.trim() ?? "");
	const out = [];
	for (const el of root.querySelectorAll(HELP)) {
		if (el.parentElement.closest(HELP) !== null || !shown(el)) continue;
		const lines = lineCount(el);
		if (lines === 0) continue;
		const cs = getComputedStyle(el);
		const height = el.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
		const fold = el.closest("details:not(.hw-sec)");
		out.push({
			id: el.id || el.dataset.l10n || el.textContent.trim().slice(0, 32),
			section: el.closest("details.hw-sec")?.id ?? "top",
			fold: fold === null ? null : foldName(fold),
			lines,
			height: Math.round(height * 10) / 10,
			text: el.textContent.replace(/\\s+/g, " ").trim()
		});
	}
	return out;
})`;
const measureIn = (selector) => b.evaluate(`${MEASURE}(${JSON.stringify(selector)})`);
const round = (n) => Math.round(n * 10) / 10;
const sum = (blocks) => ({ lines: blocks.reduce((n, x) => n + x.lines, 0), height: round(blocks.reduce((n, x) => n + x.height, 0)) });

async function measureState(entry) {
	await open(entry);
	const opened = await measureIn(null);
	const top = opened.filter((x) => x.section === "top");
	const sections = { top: { ...sum(top), blocks: top } };
	const folds = {};
	const ids = await b.evaluate(`[...document.querySelectorAll("details.hw-sec")].map((d) => d.id)`);
	for (const id of ids) {
		await open(entry);
		await b.evaluate(`document.getElementById(${JSON.stringify(id)}).open = true`);
		await sleep(250);
		const blocks = await measureIn(`#${id}`);
		sections[id] = { ...sum(blocks), blocks };
		// Each fold inside, opened with its section (and the folds around
		// it), counts its own blocks; deeper folds stay as they open.
		const inner = await b.evaluate(`[...document.querySelectorAll(${JSON.stringify(`#${id} details`)})].map((d) => d.id || d.className + ":" + (d.querySelector(":scope > summary")?.textContent.trim() ?? ""))`);
		for (const [i, name] of inner.entries()) {
			const at = `document.querySelectorAll(${JSON.stringify(`#${id} details`)})[${i}]`;
			const was = await b.evaluate(`(() => { const d = ${at}; const was = []; for (let n = d; n !== null; n = n.parentElement?.closest("details") ?? null) { was.push(n.open); n.open = true; } return was; })()`);
			await sleep(150);
			const own = (await measureIn(`#${id}`)).filter((x) => x.fold === name);
			folds[name] = { ...sum(own), blocks: own };
			await b.evaluate(`(() => { const was = ${JSON.stringify(was)}; let k = 0; for (let n = ${at}; n !== null; n = n.parentElement?.closest("details") ?? null) n.open = was[k++]; })()`);
		}
	}
	const all = Object.values(sections);
	return {
		opened: { ...sum(opened), blocks: opened },
		total: { lines: all.reduce((n, s) => n + s.lines, 0), height: round(all.reduce((n, s) => n + s.height, 0)) },
		sections,
		folds
	};
}

const result = {};
try {
	for (const entry of MEASURED) result[entry[0]] = await measureState(entry);
	check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
	check("measuring writes nothing", sim.writes.length === 0 && sim.globalWrites.length === 0, JSON.stringify({ settings: sim.writes.length, globals: sim.globalWrites.length }));
	for (const [name, m] of Object.entries(result)) {
		const rows = Object.entries(m.sections).map(([id, s]) => `${id} ${s.lines}/${s.height}`).join(", ");
		console.log(`INFO  ${name}: opened ${m.opened.lines} lines/${m.opened.height} px; sections ${m.total.lines}/${m.total.height} (${rows})`);
	}
	if (reportFile !== null) {
		writeFileSync(reportFile, JSON.stringify(result, null, "\t") + "\n");
		console.log(`INFO  wrote ${reportFile}`);
	} else {
		const baseline = JSON.parse(readFileSync(baselineUrl, "utf8"));
		const fits = (a, limit) => a.lines <= limit.lines && a.height <= limit.height + 0.5;
		const detail = (blocks) => JSON.stringify(blocks.map((x) => `${x.id}:${x.lines}`));
		// A 1.7.1 state, else one recorded whole under "added" (1.7.1 could
		// not show it): both are held the same way, and every measured state
		// has one or the other.
		const held = { ...Object.fromEntries(Object.entries(baseline.added).filter(([name, a]) => baseline.states[name] === undefined && a.opened !== undefined)), ...baseline.states };
		for (const name of Object.keys(result)) if (held[name] === undefined) check(`${name}: has a baseline (record it under "added" with -- --report)`, false);
		for (const [name, base] of Object.entries(held)) {
			const now = result[name];
			if (now === undefined) {
				check(`${name}: measured`, false);
				continue;
			}
			check(`${name}: as opened, ${now.opened.lines} help lines / ${now.opened.height} px <= ${base.opened.lines} / ${base.opened.height}`, fits(now.opened, base.opened), detail(now.opened.blocks));
			check(`${name}: every section open, ${now.total.lines} help lines / ${now.total.height} px <= ${base.total.lines} / ${base.total.height}`, fits(now.total, base.total));
			for (const kind of ["sections", "folds"]) {
				for (const [id, s] of Object.entries(now[kind])) {
					const limit = base[kind][id] ?? baseline.added[name]?.[kind]?.[id];
					check(`${name} ${id}: ${s.lines} help lines / ${s.height} px <= ${limit === undefined ? "no baseline" : `${limit.lines} / ${limit.height}`}`, limit !== undefined && fits(s, limit), detail(s.blocks));
				}
			}
		}
	}
} catch (error) {
	check("suite ran to the end", false, String(error?.stack ?? error));
} finally {
	await Promise.race([Promise.allSettled([b.close(), sim.stop()]), sleep(10_000)]);
}

console.log(failures.length === 0 ? "\nPI HELP E2E: ALL CHECKS PASSED" : `\nPI HELP E2E: ${failures.length} FAILURES`);
process.exit(failures.length === 0 ? 0 : 1);
