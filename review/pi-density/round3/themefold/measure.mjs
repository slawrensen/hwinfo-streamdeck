// Measures and captures the foldable theme band prototypes against d04 on
// the simulated host. Owns only its browser and lab ports.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const repo = "file:///C:/Users/stephen/git/hwinfo-pi-density/";
const S = "C:/Users/stephen/AppData/Local/Temp/claude/C--Users-stephen-git-hwinfo-streamdeck/91b47c1b-9d80-49d5-bfea-6c93b12f0164/scratchpad";
const out = process.argv[2] ?? `${S}/themefold/shots`;
const only = process.argv[3] ? process.argv[3].split(",") : null;
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { launch } = await import(repo + "scripts/lib/cdp.mjs");
const { PanelFoldMemory } = await import(repo + "src/panel-folds.ts");
const builds = { d04: `${S}/r3-cand-d04/com.lawrensen.hwinfo.sdPlugin`, A: `${S}/themefold/proto-A/com.lawrensen.hwinfo.sdPlugin`, B: `${S}/themefold/proto-B/com.lawrensen.hwinfo.sdPlugin`, C: `${S}/themefold/proto-C/com.lawrensen.hwinfo.sdPlugin`, R: `${S}/themefold/proto-R/com.lawrensen.hwinfo.sdPlugin`, R2: `${S}/themefold/proto-R2/com.lawrensen.hwinfo.sdPlugin` };
const results = {};
let base = 33600;
for (const [name, dir] of Object.entries(builds)) {
	if (only && !only.includes(name)) continue;
	process.env.PI_SIM_PLUGIN_DIR = dir;
	const { startPiSim } = await import(repo + `scripts/lib/pi-sim.mjs?tf=${name}`);
	const sim = await startPiSim({ httpPort: base + 1, wsPort: base });
	const b = await launch({ port: base + 2, width: 373, height: 410 });
	const r = (results[name] = {});
	const open = async (fixture, overrides, keepFolds = false) => {
		if (!keepFolds) sim.folds = new PanelFoldMemory();
		sim.setFixture(fixture, overrides);
		await b.goto(sim.url(fixture, ""));
		await sleep(1300);
		sim.pushPreview();
		await sleep(400);
		await b.evaluate("window.scrollTo(0, 0)");
	};
	const probe = () =>
		b.evaluate(`(() => {
			const band = document.getElementById("sec-theme") ?? document.getElementById("look");
			const br = band.getBoundingClientRect();
			const reading = document.getElementById("sec-reading").getBoundingClientRect();
			const text = document.getElementById("f-text");
			const tr = text ? text.getBoundingClientRect() : null;
			const summary = band.tagName === "DETAILS" ? band.querySelector(":scope > summary") : null;
			const focusables = [...document.querySelectorAll("a[href],button,input,select,textarea,summary,[tabindex]")].filter((e) => e.tabIndex >= 0 && e.getClientRects().length > 0 && !e.closest("[hidden]") && getComputedStyle(e).visibility === "visible");
			const checked = document.querySelector('#theme-gallery .hw-theme[tabindex="0"]');
			const toChips = checked && checked.getClientRects().length > 0 ? focusables.indexOf(checked) + 1 : null;
			const mini = document.querySelector("#theme-mini .hw-theme-face");
			const mr = mini && mini.getClientRects().length > 0 ? mini.getBoundingClientRect() : null;
			const head = document.querySelector(".hw-head[data-pin]").getBoundingClientRect();
			return {
				bandH: Math.round(br.height * 10) / 10,
				bandTop: Math.round(br.top),
				open: band.tagName === "DETAILS" ? band.open : true,
				readingTop: Math.round(reading.top),
				textColorTop: tr ? Math.round(tr.top) : null,
				textColorFirstScreen: tr ? tr.bottom <= innerHeight : null,
				summaryText: summary ? summary.textContent.replace(/\\s+/g, " ").trim() : null,
				summaryH: summary ? Math.round(summary.getBoundingClientRect().height * 10) / 10 : null,
				tabsToChips: toChips,
				mini: mr ? { w: Math.round(mr.width), h: Math.round(mr.height), text: mini.textContent.trim() } : null,
				headH: Math.round(head.height),
				overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
				pageH: document.documentElement.scrollHeight
			};
		})()`);
	const fold = async () => {
		const has = await b.evaluate(`!!document.querySelector("#sec-theme > summary")`);
		if (!has) return false;
		await b.click("#sec-theme > summary");
		await sleep(250);
		await b.evaluate("window.scrollTo(0, 0)");
		return true;
	};
	try {
		for (const width of [373, 160]) {
			await b.viewport(width, 410, 1.5);
			for (const [fixture, overrides, label] of [
				["key-configured", undefined, "key-default"],
				["dial-configured", { settings: { ...sim.fixtures["dial-configured"].settings, theme: "ember" } }, "dial-ember"],
				["key-configured", { globals: { ...sim.fixtures["key-configured"].globals, theme: "paper" } }, "key-default-paper"]
			]) {
				if (width === 160 && label === "key-default-paper") continue;
				await open(fixture, overrides);
				const o = await probe();
				writeFileSync(path.join(out, `${name}-${label}-${width}-open.png`), await b.screenshot({ full: false }));
				const folded = await fold();
				let f = null;
				if (folded) {
					f = await probe();
					writeFileSync(path.join(out, `${name}-${label}-${width}-folded.png`), await b.screenshot({ full: false }));
					// The fold is remembered on the next panel of the same kind.
					await open(fixture, overrides, true);
					f.rememberedFolded = await b.evaluate(`document.getElementById("sec-theme").open === false`);
				}
				r[`${label}@${width}`] = { open: o, folded: f };
				console.log(name, label, width, JSON.stringify({ open: { bandH: o.bandH, tabs: o.tabsToChips, text: o.textColorTop }, folded: f && { bandH: f.bandH, summary: f.summaryText, mini: f.mini, text: f.textColorTop, remembered: f.rememberedFolded, overflow: f.overflow } }));
			}
		}
		// Fold all from the header: the most compact panel.
		await b.viewport(373, 410, 1.5);
		await open("key-configured");
		await b.click('#hw-folds [data-folds="fold"]');
		await sleep(250);
		r.allFolded = await probe();
		writeFileSync(path.join(out, `${name}-key-all-folded-373.png`), await b.screenshot({ full: false }));
		console.log(name, "all folded", JSON.stringify({ pageH: r.allFolded.pageH, bandH: r.allFolded.bandH }));
		r.writes = sim.writes.length + sim.globalWrites.length;
	} finally {
		await b.close();
		await sim.stop();
	}
	base += 10;
}
writeFileSync(path.join(out, only ? `measure-${only.join("")}.json` : "measure.json"), JSON.stringify(results, null, 1));
process.exit(0);
