// Bench probes for the REAL property inspector inside the Stream Deck app,
// ported from scripts/pi-lab.mjs (a11y, perf) so the numbers compare with
// the simulated-host ones. Attaches through rpi.mjs (app developer mode).
//
//   node probe.mjs state                     panel state + write counters
//   node probe.mjs features                  B1.1 engine feature checks
//   node probe.mjs layout                    B1.2 viewport, pin, overflow
//   node probe.mjs a11y <out.json> [--open]  own checks, Tab/Shift+Tab walk, axe
//   node probe.mjs perf <out.json> [--runs 3] B7.1 picker timings on the live tree
//   node probe.mjs face <out.svg>            the header face as the panel holds it
import fs from "node:fs";
import { attach, findTarget } from "./rpi.mjs";

// axe-core 4.13.0's axe.min.js, as for pi-lab.mjs a11y.
const AXE = process.env.AXE_CORE;
if (!AXE) throw new Error("set AXE_CORE to axe-core's axe.min.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [cmd, out, ...rest] = process.argv.slice(2);
const flag = (n) => rest.includes(`--${n}`) || out === `--${n}`;
const opt = (n, d) => {
	const i = rest.indexOf(`--${n}`);
	return i >= 0 ? rest[i + 1] : d;
};

const t = await findTarget();
if (t === null) {
	console.error("no HWiNFO panel open in the app");
	process.exit(2);
}
const c = await attach(t);
const ev = (x) => c.evaluate(x);

try {
	if (cmd === "state") {
		console.log(JSON.stringify(await ev(`(() => { const s = window.__hwPanel; if (!s) return { url: location.href, noShell: true };
			return { url: location.pathname.split("/").pop() + location.search, kind: s.kind, context: s.context, writes: s.writes, globalWrites: s.globalWrites, heard: s.heardFromPlugin,
				previewState: s.preview?.state ?? null, missing: s.preview?.missing ?? null, source: s.preview?.source ?? null, faceBytes: s.face.length,
				treeGroups: s.tree?.groups?.length ?? null, treeReadings: s.tree?.groups?.reduce((n, g) => n + g.readings.length, 0) ?? null,
				headState: document.getElementById("head-state")?.textContent ?? null, headReading: document.getElementById("head-reading")?.textContent ?? null,
				alt: document.getElementById("face-img")?.alt ?? null, status: document.getElementById("reading-status")?.innerText ?? null,
				settingsKeys: Object.keys(s.settings).length, globalsKeys: Object.keys(s.globals).length };
		})()`), null, 1));
	} else if (cmd === "features") {
		console.log(JSON.stringify(await ev(`(async () => {
			const r = { userAgent: navigator.userAgent };
			r.ResizeObserver = typeof ResizeObserver === "function";
			r.contentVisibility = CSS.supports("content-visibility", "auto");
			r.containIntrinsicSize = CSS.supports("contain-intrinsic-size", "auto 40px");
			r.aspectRatio = CSS.supports("aspect-ratio", "1 / 1");
			try { document.querySelector(":is(body)"); r.isSelector = true; } catch { r.isSelector = false; }
			r.toggleAttribute = typeof Element.prototype.toggleAttribute === "function";
			try { const d = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>', "image/svg+xml"); r.domParserSvg = d.getElementsByTagName("parsererror").length === 0 && d.getElementsByTagName("text")[0].textContent === "ok"; } catch (e) { r.domParserSvg = String(e); }
			r.cssEscape = typeof CSS.escape === "function" && CSS.escape("a b") === "a\\\\ b";
			r.clipboardApi = typeof navigator.clipboard?.writeText === "function";
			r.pagehide = "onpagehide" in window;
			r.captureBeforeTarget = (() => { const order = []; const b = document.createElement("button"); document.body.appendChild(b); const cap = () => order.push("doc-capture"); document.addEventListener("click", cap, true); b.addEventListener("click", () => order.push("target")); b.click(); document.removeEventListener("click", cap, true); b.remove(); return order.join(">") === "doc-capture>target"; })();
			r.hasFocusVisible = CSS.supports("selector(:focus-visible)");
			r.hasHas = CSS.supports("selector(:has(a))");
			r.forcedColors = matchMedia("(forced-colors: active)").matches;
			r.prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
			return r;
		})()`), null, 1));
	} else if (cmd === "layout") {
		console.log(JSON.stringify(await ev(`(() => {
			const head = document.querySelector(".hw-head[data-pin]") ?? document.getElementById("hw-head");
			const hr = head?.getBoundingClientRect();
			const cs = head ? getComputedStyle(head) : null;
			const de = document.documentElement;
			const wide = [];
			for (const el of document.querySelectorAll("body *")) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.right > de.clientWidth + 0.5) wide.push((el.id ? "#" + el.id : el.tagName.toLowerCase() + "." + [...el.classList].join(".")) + " right=" + Math.round(r.right)); if (wide.length > 10) break; }
			return { innerWidth, innerHeight, dpr: devicePixelRatio, clientWidth: de.clientWidth, scrollWidth: de.scrollWidth, scrollHeight: de.scrollHeight,
				headHeight: hr ? Math.round(hr.height) : null, headPosition: cs?.position ?? null, pinOff: de.hasAttribute("data-pin-off"), headThird: hr ? +(hr.height / innerHeight).toFixed(3) : null,
				horizontalOverflow: de.scrollWidth > de.clientWidth, overflowing: wide };
		})()`), null, 1));
	} else if (cmd === "face") {
		const face = await ev(`window.__hwPanel?.face ?? ""`);
		fs.writeFileSync(out, face);
		console.log(`${out} ${face.length} chars`);
	} else if (cmd === "a11y") {
		if (flag("open")) await ev(`document.querySelectorAll("details").forEach((d) => { d.open = true; })`);
		await sleep(300);
		const own = await ev(`(() => {
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
				if (el.getClientRects().length === 0) continue;
				const name = nameOf(el);
				if (name === "" || name.startsWith("(placeholder only)")) issues.push({ rule: "no-accessible-name", el: el.outerHTML.slice(0, 160), name });
			}
			return issues;
		})()`);
		await ev(`document.activeElement?.blur(); window.scrollTo(0, 0)`);
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
			const label = (a.getAttribute("aria-label") || (a.labels && a.labels[0]?.textContent) || a.textContent || a.value || "").trim().replace(/\\s+/g, " ").slice(0, 60);
			return { tag: a.tagName + (a.id ? "#" + a.id : ""), label, hiddenBy, ring, obscured, partly };
		})()`;
		const stops = [];
		for (let i = 0; i < 120; i++) {
			await c.key("Tab");
			const stop = await ev(probeStop);
			if (stop === null) break;
			stops.push(stop);
		}
		const back = [];
		for (let i = 0; i < stops.length; i++) {
			await c.key("Shift+Tab");
			const stop = await ev(probeStop);
			if (stop === null) break;
			back.push(stop);
			if (stop.obscured) own.push({ rule: "focus-obscured-by-pinned-header", el: `${stop.tag} (Shift+Tab)` });
			if (stop.partly) own.push({ rule: "focus-partly-under-pinned-header", el: `${stop.tag} (Shift+Tab)` });
		}
		for (const stop of stops) {
			if (stop.hiddenBy !== null) own.push({ rule: "focus-in-hidden", el: `${stop.tag} (${stop.hiddenBy})` });
			if (!stop.ring) own.push({ rule: "no-visible-focus", el: stop.tag });
			if (stop.obscured) own.push({ rule: "focus-obscured-by-pinned-header", el: stop.tag });
			if (stop.partly) own.push({ rule: "focus-partly-under-pinned-header", el: stop.tag });
		}
		await ev(`${fs.readFileSync(AXE, "utf8")}; 0`);
		const axe = await ev(`axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } }).then((r) => ({ violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 8) })), passes: r.passes.length, incomplete: r.incomplete.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ") + " (" + (n.any?.[0]?.data?.messageKey ?? n.any?.[0]?.message ?? "needs review") + ")").slice(0, 8) })) }))`);
		const layout = await ev(`({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, url: location.pathname.split("/").pop() })`);
		const writes = await ev(`({ writes: window.__hwPanel?.writes, globalWrites: window.__hwPanel?.globalWrites })`);
		const report = { method: "REAL Stream Deck app webview over CDP; probes ported from scripts/pi-lab.mjs a11y; keys dispatched through CDP Input (renderer level, not OS level)", layout, openAll: flag("open"), stops: stops.length, stopList: stops, backStops: back.length, own, axe, writes };
		fs.writeFileSync(out, JSON.stringify(report, null, "\t"));
		console.log(`${layout.url} ${layout.w}x${layout.h}@${layout.dpr}: ${stops.length} Tab stops (${back.length} back), own ${own.length} issue(s), axe ${axe.violations.length} violation(s) ${axe.violations.map((v) => v.id).join(",")}, incomplete ${axe.incomplete.length}, writes ${JSON.stringify(writes)}`);
	} else if (cmd === "perf") {
		const runs = Number(opt("runs", "3"));
		const results = [];
		for (let run = 0; run < runs; run++) {
			const r = await ev(`(async () => {
				const input = document.getElementById("picker-search");
				const frame = () => new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)));
				const rows = () => document.querySelectorAll('#picker-list :is(.hw-row, [role=option]):not([aria-disabled="true"])').length;
				input.blur(); await frame();
				const t0 = performance.now();
				input.focus();
				input.dispatchEvent(new Event("focus"));
				await frame();
				for (let i = 0; i < 100 && rows() === 0; i++) await frame();
				const open = performance.now() - t0;
				const openRows = rows();
				const selectedVisible = (() => { const s = document.querySelector("#picker-list .selected, #picker-list [aria-selected=true]"); if (!s) return false; const a = s.getBoundingClientRect(), b = document.getElementById("picker-list").getBoundingClientRect(); return a.bottom > b.top && a.top < b.bottom; })();
				const samples = [];
				const queries = ["t", "te", "tem", "temp", "temper", "drive", "drive t", "ünï", "core 4", "zzz", ""];
				for (let w = 0; w < 3; w++) { input.value = queries[w]; input.dispatchEvent(new Event("input")); await frame(); }
				for (const q of queries) { input.value = q; const s = performance.now(); input.dispatchEvent(new Event("input")); await frame(); samples.push(performance.now() - s); }
				input.value = ""; input.dispatchEvent(new Event("input")); await frame();
				const allRows = document.querySelectorAll('#picker-list :is(.hw-row, [role=option]):not([hidden]):not([aria-disabled="true"])').length;
				input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); input.blur();
				return { open, openRows, allRows, selectedVisible, samples, heap: performance.memory ? performance.memory.usedJSHeapSize : null, writes: window.__hwPanel?.writes };
			})()`);
			results.push({ run, ...r });
			const sorted = [...r.samples].sort((a, b) => a - b);
			console.log(`run ${run}: open ${r.open.toFixed(1)} ms rows ${r.openRows}/${r.allRows} selectedVisible ${r.selectedVisible} p50 ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} max ${sorted.at(-1).toFixed(1)} writes ${r.writes}`);
		}
		const all = results.flatMap((r) => r.samples).sort((a, b) => a - b);
		const pct = (p) => all[Math.min(all.length - 1, Math.floor((p / 100) * all.length))];
		const summary = { samples: all.length, p50: pct(50), p95: pct(95), max: all.at(-1), openMax: Math.max(...results.map((r) => r.open)), rowsRendered: results[0].allRows, selectedVisibleOnOpen: results.every((r) => r.selectedVisible) };
		fs.writeFileSync(out, JSON.stringify({ method: "REAL Stream Deck app webview over CDP, live HWiNFO tree; port of pi-lab perf (3 warmup + 11 timed queries per run, input event to next frame).", summary, results }, null, "\t"));
		console.log(JSON.stringify(summary));
	} else {
		console.error("usage: node probe.mjs state|features|layout|a11y <out> [--open]|perf <out>|face <out.svg>");
	}
} finally {
	c.close();
}
