// Property-inspector lab: captures, task measurements, scale timings and
// accessibility checks for the REAL panels against the simulated host
// (scripts/lib/pi-sim.mjs). Runs anywhere Chromium runs; no Stream Deck app,
// no HWiNFO. Every output is SAMPLE DATA on a SIMULATED HOST and says so.
//
//   npx tsx scripts/pi-lab.mjs capture <outDir> [--widths 320,480] [--only a,b] [--inject <url>] [--dpr 2]
//   npx tsx scripts/pi-lab.mjs tasks <out.json>
//   npx tsx scripts/pi-lab.mjs perf <out.json> [--runs 3]
//   npx tsx scripts/pi-lab.mjs a11y <out.json> [--widths 400,320] [--height 800]  (AXE_CORE=<path to axe.min.js> adds axe-core)
//   npx tsx scripts/pi-lab.mjs density <out.json> [--sizes 380x720,378x410] [--shots <dir>]
//   Any command above takes --study b|c|palette-A..E; PI_LAB_PORT_BASE runs labs side by side.
//   npx tsx scripts/pi-lab.mjs faces <out.png>        (device-face contact sheet)
//
// Owned processes only: the Chromium this script launches and its own
// servers on fixed lab ports; nothing else is ever stopped.
// A failed run exits nonzero, whatever the SDK logger does (AX65); see the
// dispatch at the end for a failure after the lab's servers are up.
import "./lib/script-failures.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { launch } from "./lib/cdp.mjs";
import { scaledSnapshot } from "./lib/pi-fixtures.mjs";
import { startPiSim } from "./lib/pi-sim.mjs";

const [cmd, out, ...rest] = process.argv.slice(2);
const opt = (name, fallback) => {
	const i = rest.indexOf(`--${name}`);
	return i >= 0 ? rest[i + 1] : fallback;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// PI_LAB_PORT_BASE lets two labs run side by side (each owns base and
// base+1; the browser picks its own debugger port).
const PORT_BASE = Number(process.env.PI_LAB_PORT_BASE ?? "") || 29310;
const PORTS = { ws: PORT_BASE, http: PORT_BASE + 1 };

// Layout studies (scripts/pi-studies): served under /__study/ and injected
// into the real panel. Never part of the plugin package.
const study = opt("study", "");
const studyDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "pi-studies");
const studyRoutes = Object.fromEntries(
	["study-b.css", "study-c.css", "study.js", "palette.css", "palette.js"].map((file) => [`/__study/${file}`, () => ({ type: file.endsWith(".css") ? "text/css" : "text/javascript", body: readFileSync(path.join(studyDir, file)) })])
);
// --study b|c: the F01 layout studies; --study palette-A..E: the density
// pass's palette-placement studies (scripts/pi-studies/palette.js).
const studyInject = study === "" || study === "a"
	? ""
	: study.startsWith("palette-")
		? `&inject=${encodeURIComponent("/__study/palette.css")}&inject=${encodeURIComponent(`/__study/palette.js?${study.slice(8)}`)}`
		: `&inject=${encodeURIComponent(`/__study/study-${study}.css`)}&inject=${encodeURIComponent(`/__study/study.js?${study}`)}`;

/** Waits until the panel has its data: the build stamp, the tree, and
 * (on sensor panels) a preview. Bounded; a panel that never settles is
 * captured as it stands. */
async function settle(browser) {
	for (let i = 0; i < 40; i++) {
		const ready = await browser.evaluate(`(() => document.readyState === "complete" && (document.body?.dataset?.hwReady === "1" || window.__hwPiVersion !== undefined || document.querySelector("script[src^='pi-common']") === null))()`);
		if (ready) break;
		await sleep(100);
	}
	await sleep(700);
}

/** The capture matrix: fixture, a label, and an optional in-page step. */
const OPEN_ALL = `document.querySelectorAll("details").forEach((d) => { d.open = true; })`;
const STATES = [
	["key-empty", "default"],
	["key-configured", "default"],
	["key-configured", "picker-typed", async (b) => {
		await b.evaluate(`document.getElementById("picker-search").focus()`);
		await sleep(150);
		await b.type("drive temp");
		await sleep(250);
	}],
	["key-configured", "expanded", OPEN_ALL],
	["key-configured", "alerts-editing", async (b) => {
		await b.evaluate(`(() => { const d = document.getElementById("sec-alerts"); d.open = true; document.getElementById("f-warn")?.focus(); document.getElementById("f-warn")?.scrollIntoView({ block: "center" }); })()`);
	}, { full: false }],
	["key-dense", "default"],
	["key-dense", "expanded", OPEN_ALL],
	["key-triple", "default"],
	["key-custom-dim", "default"],
	["key-inherited", "default"],
	["key-alert", "default"],
	["key-unavailable", "default"],
	["key-stale", "default"],
	["key-missing", "default"],
	["key-back", "default"],
	["key-back", "expanded", OPEN_ALL],
	["key-details", "default"],
	["key-details", "expanded", OPEN_ALL],
	["key-zero-negative", "default"],
	["dial-empty", "default"],
	["dial-configured", "default"],
	["dial-configured", "expanded", OPEN_ALL],
	["dial-groups", "default"],
	["dial-groups", "expanded", OPEN_ALL],
	["dial-alert", "default"],
	["dial-custom-gestures", "expanded", OPEN_ALL],
	["dial-unavailable", "default"],
	["dial-missing", "default"],
	["control-default", "default"],
	["control-reset", "expanded", OPEN_ALL],
	["slot-back", "default"],
	["slot-reading", "default"]
];

async function capture() {
	const widths = opt("widths", "320,480").split(",").map(Number);
	const only = opt("only", "");
	const inject = opt("inject", "");
	mkdirSync(out, { recursive: true });
	const sim = await startPiSim({ httpPort: PORTS.http, wsPort: PORTS.ws, extraRoutes: studyRoutes });
	const browser = await launch({ width: widths[0], height: 800 });
	const manifest = [];
	const pageErrors = [];
	browser.on("Runtime.exceptionThrown", (p) => pageErrors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text));
	browser.on("Runtime.consoleAPICalled", (p) => {
		if (p.type === "error") pageErrors.push(p.args.map((a) => a.value ?? a.description).join(" "));
	});
	try {
		// --dpr 2 shoots close-ups at twice the pixels; layout is unchanged.
		const dpr = Number(opt("dpr", "1")) || 1;
		for (const width of widths) {
			await browser.viewport(width, 800, dpr);
			for (const [fixture, label, step, shot = { full: true }] of STATES) {
				if (only !== "" && !only.split(",").includes(fixture)) continue;
				sim.setFixture(fixture);
				await browser.goto(sim.url(fixture, `${inject === "" ? "" : `&inject=${encodeURIComponent(inject)}`}${studyInject}`));
				await settle(browser);
				sim.pushPreview();
				await sleep(300);
				// A step can fail on a panel that lacks its target (the baseline
				// build has no Alerts section): the state is captured as it
				// stands and the failure is recorded, never silently dropped.
				let stepError = null;
				try {
					if (typeof step === "string") await browser.evaluate(step);
					else if (typeof step === "function") await step(browser);
				} catch (e) {
					stepError = String(e?.message ?? e);
				}
				await sleep(400);
				const png = await browser.screenshot(shot);
				const name = `${fixture}--${label}--${width}.png`;
				writeFileSync(path.join(out, name), png);
				const metrics = await browser.evaluate(`({ height: document.documentElement.scrollHeight, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, build: window.__hwPiVersion ?? null })`);
				const errors = pageErrors.splice(0);
				manifest.push({ file: name, fixture, state: label, width, ...metrics, writes: sim.writes.length, globalWrites: sim.globalWrites.length, errors, stepError });
				console.log(`captured ${name} (${metrics.height}px, overflowX ${metrics.overflowX}, writes ${sim.writes.length}/${sim.globalWrites.length}${errors.length > 0 ? `, ERRORS: ${errors.join(" | ")}` : ""}${stepError === null ? "" : `, STEP FAILED: ${stepError}`})`);
			}
		}
	} finally {
		await browser.close();
		await sim.stop();
	}
	writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ note: "Simulated host (scripts/lib/pi-sim.mjs), sample data (scripts/lib/pi-fixtures.mjs), headless Chromium, Linux fonts. Not the Stream Deck app webview.", captures: manifest }, null, "\t"));
}

// --- task measurements ---------------------------------------------------
// Expert-walkthrough metrics, NOT human findings: for each task, where the
// first relevant control sits for a keyboard user arriving at the top of a
// freshly opened panel: its position in the Tab order, how many closed
// disclosures hide it, and how far down the page it starts.
const TASKS = [
	["T1", "key-empty", "Pick a reading", ["#picker-search"]],
	["T2", "key-configured", "Change decimals", ["#f-decimals", "sdpi-select[setting='decimals']"]],
	["T2", "key-configured", "Theme gallery", ["#theme-gallery"]],
	["T2", "key-configured", "Text color (this key)", ["#f-text", "sdpi-select[setting='textMode']:not([global])"]],
	["T3", "key-configured", "Layout select", ["#f-layout", "sdpi-select[setting='keyLayout']"]],
	["T4", "key-configured", "Warn threshold", ["#f-warn", "sdpi-textfield[setting='warnValue']"]],
	["T5", "dial-groups", "Rotation membership list", ["#pickerr-search", "#picker-search"]],
	["T5", "dial-groups", "Rotation order (first move button)", ["#rotation-set .hw-chip-move:not(:disabled)", "#rotation-set .hw-set-remove"]],
	["T6", "key-configured", "Press behavior", ["#f-press", "sdpi-select[setting='pressBehavior']"]],
	["T6", "dial-configured", "Dial controls preset", ["#f-preset", "sdpi-select[setting='controlPreset']"]],
	["T7", "key-missing", "Missing-reading status", ["#reading-status:not([hidden])", "#status-hint:not([hidden])", "#picker-search"]],
	["T8", "key-inherited", "Shared theme default", ["#shared-theme", "sdpi-select[setting='theme'][global]"]],
	["T9", "key-configured", "Config document", ["#config-key"]]
];

async function tasks() {
	const sim = await startPiSim({ httpPort: PORTS.http, wsPort: PORTS.ws, extraRoutes: studyRoutes });
	const browser = await launch({ width: 400, height: 800 });
	const rows = [];
	try {
		for (const width of [320, 480]) {
			await browser.viewport(width, 800, 1);
			for (const [task, fixture, what, selectors] of TASKS) {
				sim.setFixture(fixture);
				await browser.goto(sim.url(fixture, studyInject));
				await settle(browser);
				const m = await browser.evaluate(`(() => {
					const sel = ${JSON.stringify(selectors)};
					let target = null;
					for (const s of sel) { target = document.querySelector(s); if (target) break; }
					if (!target) return { found: false };
					const closed = [];
					for (let n = target; n; n = n.parentElement) { if (n.tagName === "DETAILS" && !n.open) closed.push(n.querySelector("summary")?.textContent.trim().split("\\n")[0] ?? "details"); }
					// Tab order: focusable and rendered (a closed details or a hidden
					// subtree renders nothing), shadow roots walked in place, the way
					// sequential focus navigation visits the sdpi inputs.
					const focusables = [];
					const visit = (root) => { for (const el of root.children) { if (el.tabIndex >= 0 && !el.disabled && el.getClientRects().length > 0 && !(el.shadowRoot && el.tabIndex < 0)) focusables.push(el); if (el.shadowRoot) visit(el.shadowRoot); if (el.tagName === "DETAILS" && !el.open) { const s = el.querySelector(":scope > summary"); if (s) focusables.push(s); continue; } visit(el); } };
					visit(document.body);
					const host = (el) => { for (let n = el; n; n = n.parentNode ?? n.host) { if (n === target) return true; } return false; };
					const idx = focusables.findIndex((el) => host(el));
					const top = target.getBoundingClientRect().top + window.scrollY;
					// Behind a closed disclosure the first stop is that disclosure's summary.
					const outer = (() => { let o = null; for (let n = target; n; n = n.parentElement) { if (n.tagName === "DETAILS" && !n.open) o = n; } return o; })();
					const via = outer === null ? idx : focusables.indexOf(outer.querySelector(":scope > summary"));
					return { found: true, tabStop: via < 0 ? null : via + 1, tabStopIsDisclosure: outer !== null, closedDisclosures: closed, top: Math.round(top), pageHeight: document.documentElement.scrollHeight, visibleWithoutScroll: top < window.innerHeight };
				})()`);
				rows.push({ task, fixture, what, width, ...m });
				console.log(task, what, width, JSON.stringify(m));
			}
		}
	} finally {
		await browser.close();
		await sim.stop();
	}
	writeFileSync(out, JSON.stringify({ method: "Automated expert walkthrough on the simulated host; not a human study.", rows }, null, "\t"));
}

// --- scale timings ------------------------------------------------------
// Event-to-visible-update: the time from a real key event in the search box
// to the next animation frame after the list DOM settled, measured in page
// (performance.now) around the synchronous handler plus one rAF.
async function perf() {
	const runs = Number(opt("runs", "3"));
	const sizes = [0, 1, 500, 5000];
	const sim = await startPiSim({ httpPort: PORTS.http, wsPort: PORTS.ws });
	const browser = await launch({ width: 400, height: 800 });
	const results = [];
	try {
		for (const size of sizes) {
			for (let run = 0; run < runs; run++) {
				const snapshot = scaledSnapshot(size);
				const deep = snapshot.readings.at(-1)?.key ?? "";
				sim.setFixture("key-empty", { settings: { readingKey: deep }, snapshot });
				await browser.goto(sim.url("key-empty"));
				await settle(browser);
				const r = await browser.evaluate(`(async () => {
					const input = document.getElementById("picker-search");
					const frame = () => new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)));
					// Open: focus to the first frame after the rows exist (bounded).
					// Reading rows only: a disabled option is the list's message, not a reading.
					const rows = () => document.querySelectorAll('#picker-list :is(.hw-row, [role=option]):not([aria-disabled="true"])').length;
					const t0 = performance.now();
					input.focus();
					input.dispatchEvent(new Event("focus"));
					await frame();
					for (let i = 0; i < 100 && rows() === 0 && ${size} > 0; i++) await frame();
					const open = performance.now() - t0;
					const openRows = rows();
					const selectedVisible = (() => { const s = document.querySelector("#picker-list .selected, #picker-list [aria-selected=true]"); if (!s) return false; const a = s.getBoundingClientRect(), b = document.getElementById("picker-list").getBoundingClientRect(); return a.bottom > b.top && a.top < b.bottom; })();
					const samples = [];
					const queries = ["t", "te", "tem", "temp", "temper", "drive", "drive t", "ünï", "reading 4", "zzz", ""];
					for (let w = 0; w < 3; w++) { input.value = queries[w]; input.dispatchEvent(new Event("input")); await frame(); }
					for (const q of queries) {
						input.value = q;
						const s = performance.now();
						input.dispatchEvent(new Event("input"));
						await frame();
						samples.push(performance.now() - s);
					}
					input.value = "";
					input.dispatchEvent(new Event("input"));
					await frame();
					const allRows = document.querySelectorAll('#picker-list :is(.hw-row, [role=option]):not([hidden]):not([aria-disabled="true"])').length;
					return { open, openRows, allRows, selectedVisible, samples, heap: performance.memory ? performance.memory.usedJSHeapSize : null };
				})()`);
				results.push({ size, run, ...r });
				const sorted = [...r.samples].sort((a, b) => a - b);
				console.log(`size ${size} run ${run}: open ${r.open.toFixed(1)}ms rows ${r.openRows}/${r.allRows} selectedVisible ${r.selectedVisible} p50 ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} max ${sorted.at(-1).toFixed(1)}`);
			}
		}
	} finally {
		await browser.close();
		await sim.stop();
	}
	const summary = sizes.map((size) => {
		const all = results.filter((r) => r.size === size).flatMap((r) => r.samples).sort((a, b) => a - b);
		const pct = (p) => all[Math.min(all.length - 1, Math.floor((p / 100) * all.length))];
		const opens = results.filter((r) => r.size === size).map((r) => r.open);
		return { size, samples: all.length, p50: pct(50), p95: pct(95), max: all.at(-1), openMax: Math.max(...opens), rowsRendered: results.find((r) => r.size === size)?.allRows, selectedVisibleOnOpen: results.filter((r) => r.size === size).every((r) => r.selectedVisible || size === 0) };
	});
	writeFileSync(out, JSON.stringify({ method: "Headless Chromium on the simulated host; event dispatch to next frame, 3 warmup queries then 11 timed per run.", host: `${process.platform} ${process.arch} node ${process.version}`, summary, results }, null, "\t"));
	console.table(summary);
}

// --- accessibility --------------------------------------------------------
async function a11y() {
	const axePath = process.env.AXE_CORE ?? "";
	const axeSource = axePath === "" ? null : readFileSync(axePath, "utf8");
	const sim = await startPiSim({ httpPort: PORTS.http, wsPort: PORTS.ws, extraRoutes: studyRoutes });
	const widths = opt("widths", "400").split(",").map(Number);
	const height = Number(opt("height", "800")) || 800;
	const browser = await launch({ width: widths[0], height });
	const report = [];
	try {
		let current = widths[0];
		for (const [width, [fixture, label, step]] of widths.flatMap((w) => STATES.map((st) => [w, st]))) {
			if (label === "picker-typed") continue;
			if (width !== current) {
				await browser.viewport(width, height, 1);
				current = width;
			}
			sim.setFixture(fixture);
			await browser.goto(sim.url(fixture, studyInject));
			await settle(browser);
			if (typeof step === "string") await browser.evaluate(step);
			await sleep(300);
			// Own checks, independent of axe: every interactive element (shadow
			// DOM included) has an accessible name, no positive tabindex, and no
			// focusable element sits inside a hidden subtree.
			const own = await browser.evaluate(`(() => {
				const issues = [];
				const walk = (root, out) => { for (const el of root.querySelectorAll("*")) { out.push(el); if (el.shadowRoot) walk(el.shadowRoot, out); } return out; };
				const all = walk(document, []);
				const nameOf = (el) => {
					const labelledby = el.getAttribute("aria-labelledby");
					if (labelledby) { const root = el.getRootNode(); const txt = labelledby.split(/\\s+/).map((id) => (root.getElementById ? root.getElementById(id) : document.getElementById(id))?.textContent ?? "").join(" ").trim(); if (txt) return txt; }
					if (el.getAttribute("aria-label")) return el.getAttribute("aria-label");
					if (el.labels && el.labels.length) return Array.from(el.labels).map((l) => l.textContent).join(" ").trim();
					if (el.title) return el.title;
					if (el.tagName === "BUTTON" || el.tagName === "SUMMARY" || el.getAttribute("role") === "button" || el.getAttribute("role") === "option") return el.textContent.trim();
					if (el.placeholder) return "(placeholder only) " + el.placeholder;
					return "";
				};
				for (const el of all) {
					const interactive = ["INPUT", "SELECT", "TEXTAREA", "BUTTON", "SUMMARY"].includes(el.tagName) || ["button", "combobox", "option", "checkbox", "switch", "radio"].includes(el.getAttribute("role") ?? "");
					if (el.tabIndex > 0) issues.push({ rule: "positive-tabindex", el: el.outerHTML.slice(0, 120) });
					if (!interactive) continue;
					const rendered = el.getClientRects().length > 0;
					if (!rendered) continue;
					const name = nameOf(el);
					if (name === "" || name.startsWith("(placeholder only)")) issues.push({ rule: "no-accessible-name", el: el.outerHTML.slice(0, 160), name });
				}
				return issues;
			})()`);
			// Real sequential navigation: Tab through the page and flag any stop
			// inside a hidden subtree or a closed disclosure (other than its own
			// summary), and any stop without a visible focus indicator.
			await browser.evaluate(`document.activeElement?.blur(); window.scrollTo(0, 0)`);
			const stops = [];
			const probeStop = `(() => {
					let a = document.activeElement;
					while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
					if (!a || a === document.body) return null;
					let hiddenBy = null;
					for (let n = a; n; n = n.parentElement) {
						if (n.hidden) { hiddenBy = "hidden"; break; }
						if (n.tagName === "DETAILS" && !n.open && !(a.tagName === "SUMMARY" && a.parentElement === n)) { hiddenBy = "closed details"; break; }
					}
					const cs = getComputedStyle(a);
					const ring = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2;
					const r = a.getBoundingClientRect();
					const head = document.querySelector(".hw-head[data-pin]");
					const hr = head && getComputedStyle(head).position === "sticky" ? head.getBoundingClientRect() : null;
					const obscured = hr !== null && !head.contains(a) && r.bottom <= hr.bottom + 1;
					const partly = hr !== null && !head.contains(a) && !obscured && r.top < hr.bottom - 1;
					return { tag: a.tagName + (a.id ? "#" + a.id : ""), hiddenBy, ring, obscured, partly };
				})()`;
			for (let i = 0; i < 80; i++) {
				await browser.key("Tab");
				const stop = await browser.evaluate(probeStop);
				if (stop === null) break;
				stops.push(stop);
			}
			// And back up with Shift+Tab: a pinned header can cover what
			// scrolls up into it, which a forward walk never exercises.
			for (let i = 0; i < stops.length; i++) {
				await browser.key("Tab", { shift: true });
				const stop = await browser.evaluate(probeStop);
				if (stop === null) break;
				if (stop.obscured) own.push({ rule: "focus-obscured-by-pinned-header", el: `${stop.tag} (Shift+Tab)` });
				if (stop.partly) own.push({ rule: "focus-partly-under-pinned-header", el: `${stop.tag} (Shift+Tab)` });
			}
			for (const stop of stops) {
				if (stop.hiddenBy !== null) own.push({ rule: "focus-in-hidden", el: `${stop.tag} (${stop.hiddenBy})` });
				if (!stop.ring) own.push({ rule: "no-visible-focus", el: stop.tag });
				if (stop.obscured) own.push({ rule: "focus-obscured-by-pinned-header", el: stop.tag });
				if (stop.partly) own.push({ rule: "focus-partly-under-pinned-header", el: stop.tag });
			}
			let axe = null;
			if (axeSource !== null) {
				await browser.evaluate(`${axeSource}; 0`);
				axe = await browser.evaluate(`axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } }).then((r) => ({ violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 8) })), passes: r.passes.length, incomplete: r.incomplete.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ") + " (" + (n.any?.[0]?.data?.messageKey ?? n.any?.[0]?.message ?? "needs review") + ")").slice(0, 8) })) }))`);
			}
			report.push({ fixture, state: label, width, own, axe });
			console.log(`${fixture} ${label} @${width}: own ${own.length} issue(s)${axe ? `, axe ${axe.violations.length} violation(s)` : ", axe NOT RUN (set AXE_CORE)"}`);
		}
	} finally {
		await browser.close();
		await sim.stop();
	}
	writeFileSync(out, JSON.stringify({ method: "Simulated host, headless Chromium. Own name/tabindex/hidden-focus checks plus axe-core when AXE_CORE is set. Not a full WCAG audit and not the embedded host.", axe: axeSource !== null, report }, null, "\t"));
}

// --- side-by-side sheets --------------------------------------------------
//   pi-lab.mjs sheet <out.png> <a.png> <b.png> ... [--labels "A,B,C"] [--max 1600]
// Captures laid next to each other on a neutral ground, each under its label,
// scaled down together only if the tallest exceeds --max pixels.
async function sheet() {
	const sharp = (await import("sharp")).default;
	const files = rest.filter((arg, i) => !arg.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--")));
	const labels = opt("labels", "").split(",");
	const max = Number(opt("max", "2400"));
	const metas = await Promise.all(files.map((f) => sharp(f).metadata()));
	const gap = 24;
	const head = 28;
	const tallest = Math.max(...metas.map((m) => m.height));
	const scale = Math.min(1, max / tallest);
	const widths = metas.map((m) => Math.round(m.width * scale));
	const width = widths.reduce((a, b) => a + b, 0) + gap * (files.length + 1);
	const height = Math.round(tallest * scale) + head + gap * 2;
	const composites = [];
	let x = gap;
	for (let i = 0; i < files.length; i++) {
		const img = await sharp(files[i]).resize({ width: widths[i] }).toBuffer();
		const label = (labels[i] ?? "").replace(/[<&>]/g, "");
		composites.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${widths[i]}" height="${head}"><text x="0" y="19" font-family="DejaVu Sans, Arial" font-size="15" fill="#e0e0e0">${label}</text></svg>`), left: x, top: gap - 8 });
		composites.push({ input: img, left: x, top: gap + head - 8 });
		x += widths[i] + gap;
	}
	await sharp({ create: { width, height, channels: 3, background: "#171717" } }).composite(composites).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(out);
	console.log(`sheet ${out} (${width}x${height})`);
}

// --- device-face contact sheet ---------------------------------------------
//   pi-lab.mjs faces <out.png>
// Every key and dial fixture's device face, rendered by the production
// compose()/composeDialSvg() exactly as the header receives it, rasterized
// at 2x under its fixture name. Sample data; no Stream Deck involved.
async function faces() {
	const sharp = (await import("sharp")).default;
	const sim = await startPiSim({ httpPort: PORTS.http, wsPort: PORTS.ws });
	const tiles = [];
	try {
		for (const name of sim.fixtureNames()) {
			sim.setFixture(name);
			const svg = sim.face();
			if (typeof svg !== "string" || svg === "") continue;
			const png = await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
			tiles.push({ name, png, meta: await sharp(png).metadata() });
		}
	} finally {
		await sim.stop();
	}
	const gap = 20;
	const head = 22;
	const cols = 4;
	const cellW = Math.max(...tiles.map((t) => t.meta.width)) + gap;
	const rows = Math.ceil(tiles.length / cols);
	const rowH = Math.max(...tiles.map((t) => t.meta.height)) + head + gap;
	const composites = [];
	tiles.forEach((t, i) => {
		const x = gap + (i % cols) * cellW;
		const y = gap + Math.floor(i / cols) * rowH;
		composites.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cellW - gap}" height="${head}"><text x="0" y="15" font-family="DejaVu Sans, Arial" font-size="13" fill="#e0e0e0">${t.name}</text></svg>`), left: x, top: y });
		composites.push({ input: t.png, left: x, top: y + head });
	});
	await sharp({ create: { width: gap + cols * cellW, height: gap + rows * rowH, channels: 3, background: "#171717" } }).composite(composites).png({ compressionLevel: 9, palette: true }).toFile(out);
	console.log(`faces ${out} (${tiles.length} faces)`);
}

// --- density: height, header cost and keyboard routes ----------------------
//   pi-lab.mjs density <out.json> [--sizes 380x720,320x560] [--shots <dir>]
// For each fixture and fold state: the CONTENT height (the body's own box,
// so a capture's blank padding below a short panel never counts), the
// pinned header's height, horizontal overflow, and whether the header is
// pinned at that viewport. For each task: the real keyboard route from a
// page with nothing focused (Tab presses, plus one Enter per closed
// section on the way, the way a keyboard user opens it), where the target
// starts, and whether it sits on the first screen. Folds start at the
// panel's defaults (a fresh plugin memory per page). Simulated host, sample
// data: an expert walkthrough by script, not a human study.
const DENSITY_STATES = [
	["key-empty", "default"],
	["key-configured", "default"],
	["key-configured", "all-open"],
	["key-configured", "all-folded"],
	["key-dense", "default"],
	["key-dense", "all-open"],
	["key-triple", "default"],
	["key-details", "all-open"],
	["key-back", "default"],
	["key-missing", "default"],
	["key-stale", "default"],
	["key-unavailable", "default"],
	["dial-configured", "default"],
	["dial-configured", "all-open"],
	["dial-configured", "all-folded"],
	["dial-groups", "default"],
	["dial-groups", "all-open"],
	["dial-custom-gestures", "all-open"],
	["dial-missing", "default"],
	["dial-unavailable", "default"],
	["control-default", "default"],
	["control-reset", "all-open"],
	["slot-reading", "default"]
];
const DENSITY_TASKS = [
	["T1", "key-empty", "Pick a reading", "#picker-search"],
	["T2", "key-configured", "Theme gallery", "#theme-gallery"],
	["T2", "dial-configured", "Theme gallery (dial)", "#theme-gallery"],
	["T2", "key-configured", "Text color (this key)", "#f-text"],
	["T2", "key-configured", "Decimals", "#f-decimals"],
	["T3", "key-configured", "Readings on this key", "#f-layout"],
	["T3", "key-dense", "Reading 4 picker", "#picker4-search"],
	["T4", "key-configured", "Warn threshold", "#f-warn"],
	["T5", "dial-configured", "Rotation search", "#pickerr-search"],
	["T5", "dial-groups", "Rotation search (groups)", "#pickerr-search"],
	["T5", "dial-groups", "Rotation list (reorder)", "#rotation-set [role=listbox], #rotation-set .hw-chip-move:not(:disabled)"],
	["T6", "key-configured", "Press behavior", "#f-press"],
	["T6", "dial-configured", "Dial gestures preset", "#f-preset"],
	["T7", "key-missing", "Recovery action", "#reading-status button"],
	["T7", "key-unavailable", "Recovery action", "#reading-status button"],
	["T8", "key-configured", "Shared theme", "#shared-theme"],
	["T9", "key-configured", "This key's config document", "#config-key"]
];

async function density() {
	const sizes = opt("sizes", "380x720").split(",").map((s) => s.split("x").map(Number));
	const shots = opt("shots", "");
	if (shots !== "") mkdirSync(shots, { recursive: true });
	const { PanelFoldMemory } = await import("../src/panel-folds.ts");
	const sim = await startPiSim({ httpPort: PORTS.http, wsPort: PORTS.ws, extraRoutes: studyRoutes });
	const browser = await launch({ width: sizes[0][0], height: sizes[0][1] });
	const states = [];
	const tasks = [];
	const openPage = async (fixture) => {
		sim.folds = new PanelFoldMemory();
		sim.setFixture(fixture);
		await browser.goto(sim.url(fixture, studyInject));
		await settle(browser);
		sim.pushPreview();
		await sleep(300);
	};
	const measure = `(() => {
		const body = document.body.getBoundingClientRect();
		const head = document.getElementById("hw-head");
		const pinned = head !== null && getComputedStyle(head).position === "sticky";
		const sections = [...document.querySelectorAll("details.hw-sec")].filter((d) => !d.hidden).map((d) => ({ id: d.id, open: d.open, height: Math.round(d.getBoundingClientRect().height), summary: d.querySelector(":scope > summary")?.getBoundingClientRect().height ?? 0 }));
		// The theme gallery: where it starts, whether a closed disclosure
		// hides it, whether it is on screen at load, and whether it stays on
		// screen once the page is scrolled to its end (a pinned palette).
		const g = document.getElementById("theme-gallery");
		const palette = g === null ? null : (() => {
			const r = g.getBoundingClientRect();
			let folded = false;
			for (let n = g.parentElement; n; n = n.parentElement) if (n.tagName === "DETAILS" && !n.open) folded = true;
			const top = Math.round(r.top + window.scrollY);
			const atLoad = !folded && r.top >= 0 && r.bottom <= window.innerHeight;
			const y = window.scrollY;
			window.scrollTo(0, document.documentElement.scrollHeight);
			const e = g.getBoundingClientRect();
			const afterScroll = !folded && e.top >= 0 && e.bottom <= window.innerHeight && document.documentElement.scrollHeight > window.innerHeight;
			window.scrollTo(0, y);
			return { top, height: Math.round(r.height), folded, onScreenAtLoad: atLoad, onScreenAtEnd: afterScroll };
		})();
		const pinnedRegion = [...document.querySelectorAll("body > *")].find((el) => getComputedStyle(el).position === "sticky") ?? null;
		return {
			palette,
			pinnedHeight: pinnedRegion === null ? 0 : Math.round(pinnedRegion.getBoundingClientRect().height),
			height: Math.ceil(body.height + parseFloat(getComputedStyle(document.body).marginTop) + parseFloat(getComputedStyle(document.body).marginBottom)),
			headerHeight: head === null ? 0 : Math.round(head.getBoundingClientRect().height),
			pinned,
			overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
			sections,
			build: window.__hwPiVersion ?? null
		};
	})()`;
	try {
		for (const [width, height] of sizes) {
			await browser.viewport(width, height, 1);
			for (const [fixture, label] of DENSITY_STATES) {
				await openPage(fixture);
				if (label === "all-open") await browser.evaluate(OPEN_ALL);
				if (label === "all-folded") await browser.evaluate(`document.querySelectorAll("details").forEach((d) => { d.open = false; })`);
				await sleep(250);
				const m = await browser.evaluate(measure);
				states.push({ fixture, state: label, width, viewportHeight: height, ...m, writes: sim.writes.length + sim.globalWrites.length });
				if (shots !== "") writeFileSync(path.join(shots, `${fixture}--${label}--${width}x${height}.png`), await browser.screenshot({ full: true }));
				console.log(`${fixture} ${label} @${width}x${height}: ${m.height}px (header ${m.headerHeight}${m.pinned ? " pinned" : ""}, overflowX ${m.overflowX})`);
			}
			for (const [task, fixture, what, selector] of DENSITY_TASKS) {
				await openPage(fixture);
				// A defined start: nothing focused, scrolled to the top.
				await browser.evaluate(`document.activeElement?.blur(); window.scrollTo(0, 0)`);
				const where = await browser.evaluate(`(() => {
					const t = document.querySelector(${JSON.stringify(selector)});
					if (t === null) return null;
					let folds = 0;
					for (let n = t.parentElement; n; n = n.parentElement) if (n.tagName === "DETAILS" && !n.open) folds++;
					const hidden = t.closest("[hidden]") !== null;
					return { folds, hidden, top: Math.round(t.getBoundingClientRect().top + window.scrollY) };
				})()`);
				if (where === null || where.hidden) {
					tasks.push({ task, fixture, what, width, viewportHeight: height, found: false });
					console.log(`${task} ${what} @${width}x${height}: target absent`);
					continue;
				}
				const probe = `(() => {
					const t = document.querySelector(${JSON.stringify(selector)});
					let a = document.activeElement;
					while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
					if (a === null || a === document.body) return "none";
					const inTarget = (() => { for (let n = a; n; n = n.parentNode ?? n.host) if (n === t) return true; return false; })();
					if (inTarget) return "target";
					if (a.tagName === "SUMMARY") { const d = a.parentElement; if (d.tagName === "DETAILS" && !d.open && d.contains(t)) return "fold"; }
					return "other";
				})()`;
				let tabs = 0;
				let enters = 0;
				let reached = false;
				for (let i = 0; i < 160; i++) {
					await browser.key("Tab");
					tabs++;
					const at = await browser.evaluate(probe);
					if (at === "target") {
						reached = true;
						break;
					}
					if (at === "fold") {
						await browser.key("Enter");
						enters++;
						await sleep(60);
					}
				}
				const after = await browser.evaluate(`(() => { const t = document.querySelector(${JSON.stringify(selector)}); const r = t.getBoundingClientRect(); const head = document.getElementById("hw-head"); const hb = head !== null && getComputedStyle(head).position === "sticky" ? head.getBoundingClientRect().bottom : 0; return { visibleTop: Math.round(r.top), coveredByHeader: r.top < hb - 1 && r.bottom > 0 }; })()`);
				const row = { task, fixture, what, width, viewportHeight: height, found: true, tabs: reached ? tabs : null, enters, keystrokes: reached ? tabs + enters : null, foldsToOpen: where.folds, top: where.top, onFirstScreen: where.folds === 0 && where.top < height, pointerClicks: where.folds + 1, scrollToReach: Math.max(0, where.top - height + 40), focusedCoveredByHeader: after.coveredByHeader };
				tasks.push(row);
				console.log(`${task} ${what} @${width}x${height}: ${reached ? `${tabs} Tab + ${enters} Enter` : "NOT REACHED"}, folds ${where.folds}, top ${where.top}${row.onFirstScreen ? " (first screen)" : ""}`);
			}
		}
	} finally {
		await browser.close();
		await sim.stop();
	}
	writeFileSync(out, JSON.stringify({ method: "Simulated host (scripts/lib/pi-sim.mjs), sample data, headless Chromium on this machine. Heights are the body's content box (no capture padding). Keyboard routes start with nothing focused at the top; each closed section on the way costs one Enter. Folds start at the panel defaults.", panels: process.env.PI_SIM_PLUGIN_DIR ?? "checkout", study: study === "" ? null : study, host: `${process.platform} ${process.arch} node ${process.version}`, states, tasks }, null, "\t"));
}

const commands = { capture, tasks, perf, a11y, sheet, faces, density };
if (commands[cmd] === undefined || out === undefined) {
	console.error("usage: tsx scripts/pi-lab.mjs capture|tasks|perf|a11y <out> [options]");
	process.exit(2);
}
// A failure after the simulator started (a browser that never comes up)
// would otherwise leave its servers holding the process open.
await commands[cmd]().catch((error) => {
	console.error(error);
	process.exit(1);
});
