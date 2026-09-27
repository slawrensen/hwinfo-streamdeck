// Strengthened acceptance run (approval round, ADR04 and UXR01): the round
// one checks with the weak ones replaced, plus near misses 1 to 6 px on
// every side at seven widths, band budgets measured against d04 in the same
// run, per-kind fold memory both ways, a late fold answer, the empty-key
// paths, AX names across states, the mini chip's colors against the
// checked chip, and first-line alignment of the fold row. Run it on R2
// (should pass) and on R and B (should fail). Simulated host; owns only its
// browser and sim ports.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const repo = "file:///C:/Users/stephen/git/hwinfo-pi-density/";
const S = "C:/Users/stephen/AppData/Local/Temp/claude/C--Users-stephen-git-hwinfo-streamdeck/91b47c1b-9d80-49d5-bfea-6c93b12f0164/scratchpad";
const variant = process.argv[2] ?? "R2";
const out = `${S}/themefold/verify2-${variant}`;
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { launch } = await import(repo + "scripts/lib/cdp.mjs");
const { PanelFoldMemory } = await import(repo + "src/panel-folds.ts");
process.env.PI_SIM_PLUGIN_DIR = process.env.VERIFY_DIR ?? `${S}/themefold/proto-${variant}/com.lawrensen.hwinfo.sdPlugin`;
const { startPiSim } = await import(repo + "scripts/lib/pi-sim.mjs");
process.env.PI_SIM_PLUGIN_DIR = `${S}/r3-cand-d04/com.lawrensen.hwinfo.sdPlugin`;
const { startPiSim: startBaseSim } = await import(repo + "scripts/lib/pi-sim.mjs?baseline=d04");
const BASE = Number(process.argv[3] ?? 34600);
const sim = await startPiSim({ httpPort: BASE + 1, wsPort: BASE });
const base = await startBaseSim({ httpPort: BASE + 11, wsPort: BASE + 10 });
const b = await launch({ port: BASE + 2, width: 373, height: 410 });
const results = [];
const check = (name, ok, detail) => {
	results.push({ name, ok, detail });
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` :: ${JSON.stringify(detail).slice(0, 600)}`}`);
};
const dprOf = (width) => (width < 240 ? 3 : 1.5);
const open = async (fixture, overrides, keepFolds = false, on = sim) => {
	if (!keepFolds) on.folds = new PanelFoldMemory();
	on.setFixture(fixture, overrides);
	await b.goto(on.url(fixture, ""));
	await sleep(1200);
	on.pushPreview();
	await sleep(350);
	await b.evaluate("window.scrollTo(0, 0)");
};
const setFold = async (open) => {
	const now = await b.evaluate(`document.getElementById("sec-theme").open`);
	if (now !== open) {
		await b.evaluate(`document.querySelector("#sec-theme > summary").scrollIntoView({ block: "center" })`);
		await b.click("#sec-theme > summary");
		await sleep(250);
		await b.evaluate("window.scrollTo(0, 0)");
	}
};
const clickAt = async (x, y) => {
	await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
	await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
	await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
	await sleep(180);
};
const ax = async () => {
	const doc = await b.send("DOM.getDocument", { depth: 0 });
	const { nodeId } = await b.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#sec-theme > summary" });
	const tree = await b.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
	const node = tree.nodes[0];
	return { role: node.role?.value, name: node.name?.value, expanded: node.properties?.find((p) => p.name === "expanded")?.value?.value };
};
const sendSettings = async (settings) => {
	sim.settings = settings;
	sim.piWs.send(JSON.stringify({ event: "didReceiveSettings", action: sim.action ?? "com.lawrensen.hwinfo.reading", context: sim.context, device: "dev1", payload: { settings } }));
	sim.pushPreview();
	await sleep(500);
};
const band = () =>
	b.evaluate(`(() => {
		const d = document.getElementById("sec-theme");
		const sum = d.querySelector(":scope > summary");
		const rs = document.querySelector("#sec-reading > summary");
		const title = sum.querySelector(".hw-label");
		const rTitle = rs.querySelector(".hw-sec-title");
		const cs = getComputedStyle(title), rc = getComputedStyle(rTitle);
		const change = document.getElementById("theme-change");
		const cr = change.getBoundingClientRect();
		const sr = sum.getBoundingClientRect();
		const cur = document.getElementById("theme-current");
		const face = document.querySelector("#theme-mini .hw-theme-face");
		let chip = null;
		if (face && face.getClientRects().length) {
			const v = face.querySelector(".hw-theme-value");
			const range = document.createRange();
			range.selectNodeContents(v);
			const tr = range.getBoundingClientRect();
			const fs = parseFloat(getComputedStyle(v).fontSize);
			const spark = face.querySelector(".hw-theme-spark").getBoundingClientRect();
			const fr = face.getBoundingClientRect();
			chip = { h: Math.round(fr.height * 10) / 10, w: Math.round(fr.width * 10) / 10, stripeBelowBaseline: Math.round((spark.top - (tr.top + 1.079 * fs)) * 10) / 10, text: v.textContent };
		}
		const note = document.getElementById("theme-note");
		return {
			open: d.open,
			bandH: Math.round(d.getBoundingClientRect().height * 10) / 10,
			sumH: Math.round(sr.height * 10) / 10,
			readingSumH: Math.round(rs.getBoundingClientRect().height * 10) / 10,
			titleStyle: [cs.fontSize, cs.fontWeight, cs.color].join(" "),
			readingTitleStyle: [rc.fontSize, rc.fontWeight, rc.color].join(" "),
			titleLeft: Math.round(title.getBoundingClientRect().left),
			readingTitleLeft: Math.round(rTitle.getBoundingClientRect().left),
			sumRight: Math.round(sr.right * 10) / 10,
			changeLeft: Math.round(cr.left * 10) / 10,
			changeVisible: getComputedStyle(change).visibility === "visible" && cr.width > 0 && change.getClientRects().length > 0,
			changeOverlapsSummary: cr.width > 0 && !(cr.right <= sr.left || cr.left >= sr.right || cr.bottom <= sr.top || cr.top >= sr.bottom),
			curClipped: cur.scrollWidth > cur.clientWidth + 0.5,
			chip,
			note: note ? { text: note.textContent, shown: note.getClientRects().length > 0, h: Math.round(note.getBoundingClientRect().height * 10) / 10 } : null,
			chipsTop: Math.round(document.getElementById("theme-gallery").getBoundingClientRect().top * 10) / 10,
			readingTop: Math.round((document.getElementById("sec-reading").getBoundingClientRect().top + scrollY) * 10) / 10,
			overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
		};
	})()`);
// The fold row's first-line alignment (UXR01): marker center against the
// title's center, and every flex item that starts on a later line starts
// at the title's left edge.
const align = () =>
	b.evaluate(`(() => {
		const sum = document.querySelector("#sec-theme > summary");
		const sr = sum.getBoundingClientRect();
		const before = getComputedStyle(sum, "::before");
		const mh = parseFloat(before.height);
		const marker = sr.top + parseFloat(before.top) + (Number.isFinite(mh) && mh > 0 ? mh / 2 : 5);
		const title = sum.querySelector(".hw-label").getBoundingClientRect();
		const titleMid = title.top + title.height / 2;
		const items = [...sum.children].filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).display !== "none");
		const wrapped = items.filter((el) => el.getBoundingClientRect().top >= title.bottom - 0.5).map((el) => ({ id: el.id || el.className, left: Math.round(el.getBoundingClientRect().left * 10) / 10 }));
		return { off: Math.round(Math.abs(marker - titleMid) * 10) / 10, titleLeft: Math.round(title.left * 10) / 10, wrapped, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
	})()`);
const secTops = () =>
	b.evaluate(`[...document.querySelectorAll("details.hw-sec[id]")].map((d) => ({ id: d.id, open: d.open, top: Math.round((d.getBoundingClientRect().top + scrollY) * 10) / 10 }))`);
try {
	await b.send("DOM.enable");
	await b.send("Accessibility.enable");
	const foldedRef = {};
	// 1. Row and title at 373 and 320, open and folded; chip anatomy.
	for (const width of [373, 320]) {
		await b.viewport(width, 410, 1.5);
		await open("key-configured");
		const o = await band();
		await setFold(false);
		const f = await band();
		foldedRef[width] = f.bandH;
		check(`${width}: the fold row is one section row, open and folded (VT04)`, Math.abs(o.sumH - o.readingSumH) <= 0.5 && Math.abs(f.sumH - f.readingSumH) <= 0.5, { open: [o.sumH, o.readingSumH], folded: [f.sumH, f.readingSumH] });
		check(`${width}: "Theme" is styled and placed like a section title (VT01)`, o.titleStyle === o.readingTitleStyle && Math.abs(o.titleLeft - o.readingTitleLeft) <= 1, { o: [o.titleStyle, o.readingTitleStyle, o.titleLeft, o.readingTitleLeft] });
		check(`${width}: the folded chip is 24 px, at least 72 px wide, its stripe 3+ px under the word (VT03)`, f.chip !== null && f.chip.h === 24 && f.chip.w >= 72 && f.chip.stripeBelowBaseline >= 3, f.chip);
		check(`${width}: open, the row ends before Change and Change is outside it (AT01, PT01)`, o.changeVisible && o.sumRight <= o.changeLeft - 4 && !o.changeOverlapsSummary, { sumRight: o.sumRight, changeLeft: o.changeLeft });
		check(`${width}: the band folds from ${o.bandH} to ${f.bandH} px with no overflow`, f.bandH < o.bandH && f.bandH <= 34 && f.overflow <= 0 && o.overflow <= 0, { open: o.bandH, folded: f.bandH });
		await setFold(true);
		writeFileSync(path.join(out, `key-${width}-open.png`), await b.screenshot({ full: false }));
		await setFold(false);
		writeFileSync(path.join(out, `key-${width}-folded.png`), await b.screenshot({ full: false }));
	}
	// 2. Near misses 1 to 6 px on every side of Change at seven widths,
	// Change scrolled into view (ADR01, ADR04 item 1). A point that lands on
	// another control is that control's press, not a miss, and is skipped.
	for (const width of [373, 320, 298, 249, 213, 189, 160]) {
		await b.viewport(width, 410, dprOf(width));
		await open("key-configured");
		await b.evaluate(`document.getElementById("theme-change").scrollIntoView({ block: "center" })`);
		await sleep(150);
		const c = await b.evaluate(`(() => { const r = document.getElementById("theme-change").getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`);
		const points = [];
		for (let k = 1; k <= 6; k++) points.push(["above", c.cx, c.t - k], ["above-left", c.l + 3, c.t - k], ["below", c.cx, c.b + k], ["left", c.l - k, c.cy], ["right", c.r + k, c.cy]);
		const bad = [];
		let pressed = 0;
		let skipped = 0;
		for (const [dir, x, y] of points) {
			if (x < 0 || y < 0 || x >= width || y >= 410) {
				skipped++;
				continue;
			}
			const hit = await b.evaluate(`(() => { const el = document.elementFromPoint(${x}, ${y}); if (el === null) return "none"; if (el.closest("#sec-theme > summary")) return "row"; const ctl = el.closest("button, a, input, select, textarea, summary, label, [role=radio], [role=button], [tabindex]"); return ctl ? "control:" + (ctl.id || ctl.tagName) : "inert"; })()`);
			if (hit.startsWith("control:")) {
				skipped++;
				continue;
			}
			const y0 = await b.evaluate("scrollY");
			const w0 = sim.writes.length + sim.globalWrites.length;
			await clickAt(x, y);
			pressed++;
			const st = await b.evaluate(`({ open: document.getElementById("sec-theme").open, y: scrollY })`);
			const writes = sim.writes.length + sim.globalWrites.length - w0;
			if (!st.open || st.y !== y0 || writes !== 0) {
				bad.push({ dir, k: Math.round(dir.startsWith("above") ? c.t - y : dir === "below" ? y - c.b : dir === "left" ? c.l - x : x - c.r), hit, folded: !st.open, scrolled: st.y - y0, writes });
				if (!st.open) await b.evaluate(`document.getElementById("sec-theme").open = true`);
				await b.evaluate(`window.scrollTo(0, ${y0})`);
				await sleep(120);
			}
		}
		check(`${width}: ${pressed} near misses 1 to 6 px around Change fold nothing, scroll nothing, write nothing (${skipped} landed on other controls or off screen)`, bad.length === 0 && pressed >= 12, { bad: bad.slice(0, 8), n: bad.length, pressed });
		await b.evaluate(`(() => { const s = document.getElementById("sec-shared"); if (s) s.open = false; document.getElementById("theme-change").scrollIntoView({ block: "center" }); })()`);
		await sleep(150);
		const c2 = await b.evaluate(`(() => { const r = document.getElementById("theme-change").getBoundingClientRect(); return { t: r.top, cx: r.left + r.width / 2 }; })()`);
		await clickAt(c2.cx, c2.t + 1);
		await sleep(250);
		const after = await b.evaluate(`({ open: document.getElementById("sec-theme").open, shared: document.getElementById("sec-shared")?.open ?? null })`);
		check(`${width}: a press 1 px inside Change's top edge opens Shared defaults and leaves the band open`, after.open === true && after.shared === true && sim.writes.length === 0, after);
	}
	// 3. Band budgets against d04 in the same run (ADR04 item 2). The stated
	// deviation: open, the fold row costs at most one section row (30 px) at
	// 300 px and wider and at most 36 px below 300 (two reserved name lines
	// plus Change's own line and its 6 px dead band); folded, the Reading
	// section starts at least 40 px higher than d04's at every width.
	for (const width of [373, 320, 298, 249, 213, 189, 160]) {
		await b.viewport(width, 410, dprOf(width));
		for (const fixture of ["key-configured", "dial-configured"]) {
			await open(fixture, undefined, false, base);
			const d04 = await b.evaluate(`({ reading: Math.round((document.getElementById("sec-reading").getBoundingClientRect().top + scrollY) * 10) / 10, band: Math.round(document.getElementById("look").getBoundingClientRect().height * 10) / 10 })`);
			await open(fixture);
			const o = await band();
			await setFold(false);
			const f = await band();
			const budget = width >= 300 ? 30 : 36;
			check(`${width} ${fixture}: open costs ${Math.round((o.readingTop - d04.reading) * 10) / 10} px over d04 (budget ${budget}), folded saves ${Math.round((d04.reading - f.readingTop) * 10) / 10} px (at least 40); band ${o.bandH} / ${f.bandH} vs d04 ${d04.band}`, o.readingTop - d04.reading <= budget && d04.reading - f.readingTop >= 40 && f.bandH <= (width >= 300 ? 34 : 50) && o.overflow <= 0 && f.overflow <= 0, { d04, open: o.readingTop, folded: f.readingTop, bandO: o.bandH, bandF: f.bandH });
			if (fixture === "key-configured" && width < 300) {
				writeFileSync(path.join(out, `key-${width}-folded.png`), await b.screenshot({ full: false }));
				await setFold(true);
				writeFileSync(path.join(out, `key-${width}-open.png`), await b.screenshot({ full: false }));
			}
		}
	}
	// 4. Eight picks at four widths, open: chips move 0 px, no line is cut,
	// and the folded chip wears exactly the checked chip's colors
	// (ADR04 items 6 and 7; payload timing itself is not simulated).
	for (const width of [373, 320, 189, 160]) {
		await b.viewport(width, 410, dprOf(width));
		for (const fixture of ["key-configured", "dial-configured"]) {
			await open(fixture, { globals: { ...sim.fixtures[fixture].globals, theme: "ultraviolet" } });
			const tops = new Set();
			let cut = 0;
			const colorMiss = [];
			for (const id of ["", "void", "graphite", "ultraviolet", "midnight", "forest", "ember", "paper"]) {
				await b.evaluate(`document.querySelector('#theme-gallery .hw-theme[data-theme="${id}"]').click()`);
				await sleep(80);
				const m = await band();
				tops.add(m.chipsTop);
				if (m.curClipped) cut++;
				const colors = await b.evaluate(`(() => {
					const pick = (face) => face === null ? null : [getComputedStyle(face).backgroundColor, getComputedStyle(face.querySelector(".hw-theme-value")).color, getComputedStyle(face.querySelector(".hw-theme-spark")).backgroundColor].join(" / ");
					return { mini: pick(document.querySelector("#theme-mini .hw-theme-face")), chip: pick(document.querySelector('#theme-gallery .hw-theme[aria-checked="true"] .hw-theme-face')) };
				})()`);
				if (colors.mini !== colors.chip) colorMiss.push({ id, ...colors });
			}
			check(`${width} ${fixture}: 8 picks, chips move 0 px, no line is cut, the folded chip wears the checked chip's colors`, tops.size === 1 && cut === 0 && colorMiss.length === 0, { tops: [...tops], cut, colorMiss: colorMiss.slice(0, 2) });
		}
	}
	// 5. Accessible name and state (AT04, PT04), then names across states at
	// 373 and 160: folded names exactly what open names, plus the empty-key
	// sentence (ADR04 item 8).
	await b.viewport(373, 410, 1.5);
	await open("key-configured");
	const axOpen = await ax();
	await setFold(false);
	const axFolded = await ax();
	check("the fold row is a disclosure named by its visible words, expanded open and collapsed folded", axOpen.role === "DisclosureTriangle" && axOpen.name === "Theme Default (shared: Void)" && axOpen.expanded === true && axFolded.name === "Theme Default (shared: Void)" && axFolded.expanded === false, { axOpen, axFolded });
	const states = [
		["Default", "key-configured", undefined, false],
		["explicit Paper", "key-configured", (fx) => ({ settings: { ...fx.settings, theme: "paper" } }), false],
		["Paper shared", "key-configured", (fx) => ({ globals: { ...fx.globals, theme: "paper" } }), false],
		["unknown neon-2031", "key-configured", (fx) => ({ settings: { ...fx.settings, theme: "neon-2031" } }), false],
		["empty key", "key-empty", undefined, true],
		["dial Ember", "dial-configured", (fx) => ({ settings: { ...fx.settings, theme: "ember" } }), false]
	];
	for (const width of [373, 160]) {
		await b.viewport(width, 410, dprOf(width));
		const bad = [];
		for (const [label, fixture, over, empty] of states) {
			await open(fixture, over ? over(sim.fixtures[fixture]) : undefined);
			const o = await ax();
			await setFold(false);
			const f = await ax();
			const want = empty ? `${o.name} Shows on the key once a reading is picked.` : o.name;
			if (!/^Theme \S/.test(o.name ?? "") || f.name !== want || o.expanded !== true || f.expanded !== false) bad.push({ label, open: o.name, folded: f.name });
		}
		check(`${width}: six states, the folded row names what the open row names (plus the empty-key sentence)`, bad.length === 0, bad);
	}
	await open("key-configured", { settings: { ...sim.fixtures["key-configured"].settings, theme: "synthwave-sunset-2027" } });
	for (const width of [373, 320]) {
		await b.viewport(width, 410, 1.5);
		await sleep(150);
		await setFold(true);
		const o = await band();
		await setFold(false);
		const f = await band();
		const axu = await ax();
		check(`${width}: a long unknown stored theme is never cut, open or folded, and is named in full (VT07)`, !o.curClipped && !f.curClipped && f.overflow <= 0 && /draws Void/.test(axu.name ?? ""), { o: o.curClipped, f: f.curClipped, name: axu.name });
	}
	// 6. Tab order: fold pair, the row, Change, the checked chip.
	await b.viewport(373, 410, 1.5);
	await open("key-configured");
	await b.evaluate(`[...document.querySelectorAll("#hw-folds button")].find((x) => x.tabIndex === 0).focus()`);
	const order = [];
	for (let i = 0; i < 3; i++) {
		await b.key("Tab");
		await sleep(60);
		order.push(await b.evaluate(`(() => { const a = document.activeElement; return a.id || (a.tagName === "SUMMARY" ? "summary:" + a.parentElement.id : a.dataset.theme !== undefined ? "chip:" + a.dataset.theme : a.tagName); })()`));
	}
	check("Tab order: the row, Change, then the checked chip", JSON.stringify(order) === JSON.stringify(["summary:sec-theme", "theme-change", "chip:"]), order);
	await b.key("Tab", { shift: true });
	await b.key("Tab", { shift: true });
	await b.key("Enter");
	await sleep(200);
	const enterFolds = await b.evaluate(`document.getElementById("sec-theme").open === false`);
	await b.key(" ");
	await sleep(200);
	const spaceOpens = await b.evaluate(`document.getElementById("sec-theme").open === true`);
	check("Enter folds and Space opens the band from the keyboard, writing nothing", enterFolds && spaceOpens && sim.writes.length === 0, { enterFolds, spaceOpens });
	// 7. Fold all, Open all, and the memory per panel kind, both ways
	// (ADR04 item 3).
	await open("key-configured");
	await b.click('#hw-folds [data-folds="fold"]');
	await sleep(200);
	const allFolded = await b.evaluate(`document.getElementById("sec-theme").open`);
	writeFileSync(path.join(out, "key-373-all-folded.png"), await b.screenshot({ full: false }));
	await b.click('#hw-folds [data-folds="open"]');
	await sleep(200);
	const allOpen = await b.evaluate(`document.getElementById("sec-theme").open`);
	check("Fold all folds the band with the rest; Open all opens it", allFolded === false && allOpen === true, { allFolded, allOpen });
	for (const [first, other] of [["key-configured", "dial-configured"], ["dial-configured", "key-configured"]]) {
		await open(first);
		await setFold(false);
		await open(first, undefined, true);
		const same = await b.evaluate(`document.getElementById("sec-theme").open`);
		await open(other, undefined, true);
		const differ = await b.evaluate(`document.getElementById("sec-theme").open`);
		check(`folded on a ${first.split("-")[0]}: the next ${first.split("-")[0]} opens folded, a ${other.split("-")[0]} opens open`, same === false && differ === true, { same, differ });
	}
	// 8. A late fold answer (ADR04 item 4, ADR05): memory holds the band and
	// Reading folded, the answer comes 900 ms after the ask, so the panel
	// shows everything open at 300 ms. Focus stays where it is and no
	// section moves when the answer lands; the memory itself is untouched
	// and the next panel applies it.
	{
		sim.folds = new PanelFoldMemory();
		sim.folds.set("key", { "sec-theme": false, "sec-reading": false });
		sim.foldsDelayMs = 900;
		try {
			sim.setFixture("key-configured");
			await b.goto(sim.url("key-configured", ""));
			let shown = false;
			for (let i = 0; i < 40 && !shown; i++) {
				shown = await b.evaluate(`!document.documentElement.hasAttribute("data-folds-pending")`);
				if (!shown) await sleep(25);
			}
			sim.pushPreview();
			await sleep(150);
			await b.evaluate(`document.querySelector("#sec-theme > summary").focus()`);
			const t1 = await secTops();
			await sleep(1300);
			const t2 = await secTops();
			const focus = await b.evaluate(`document.activeElement === document.querySelector("#sec-theme > summary")`);
			const moved = t1.filter((s, i) => s.top !== t2[i].top || s.open !== t2[i].open).map((s, i) => ({ id: s.id, before: [s.open, s.top], after: [t2[i].open, t2[i].top] }));
			check("a fold answer 900 ms late folds nothing under the person: focus kept, no section moves", shown && focus && moved.length === 0, { shown, focus, moved });
			const kept = sim.folds.get("key");
			check("the late answer leaves the plugin's memory as it was", kept["sec-theme"] === false && kept["sec-reading"] === false, kept);
		} finally {
			sim.foldsDelayMs = 0;
		}
		await open("key-configured", undefined, true);
		const next = await b.evaluate(`({ theme: document.getElementById("sec-theme").open, reading: document.getElementById("sec-reading").open })`);
		check("the next key panel, answered in time, opens with the remembered folds", next.theme === false && next.reading === false, next);
	}
	// 9. Empty-key paths (ADR02, ADR03, ADR04 item 5).
	await b.viewport(373, 410, 1.5);
	await open("key-empty");
	await setFold(false);
	const empty = await band();
	const axEmpty = await ax();
	writeFileSync(path.join(out, "key-empty-373-folded.png"), await b.screenshot({ full: false }));
	check("empty key, folded: the row says the theme shows once a reading is picked, and says it to assistive tech", empty.note?.shown === true && /Shows on the key once a reading is picked\./.test(empty.note.text) && /Shows on the key once a reading is picked\.$/.test(axEmpty.name ?? ""), { note: empty.note, name: axEmpty.name, bandH: empty.bandH });
	await sendSettings({ ...sim.settings, readingKey: sim.keys.cpu });
	const picked = await band();
	check("empty key, folded: once a reading arrives the note empties and the Reading section does not move", picked.note?.text === "" && Math.abs(picked.readingTop - empty.readingTop) <= 0.5, { before: empty.readingTop, after: picked.readingTop, note: picked.note });
	await setFold(true);
	await setFold(false);
	const reopened = await band();
	check("then opened and folded again, the held line is gone: the band is a plain folded row", !reopened.note?.shown && reopened.bandH === foldedRef[373], { bandH: reopened.bandH, ref: foldedRef[373], note: reopened.note });
	await open("key-empty");
	await sendSettings({ ...sim.settings, readingKey: sim.keys.cpu });
	await setFold(false);
	const pickedOpen = await band();
	check("empty key, picked while open, then folded: no blank line is held", !pickedOpen.note?.shown && pickedOpen.bandH === foldedRef[373], { bandH: pickedOpen.bandH, ref: foldedRef[373], note: pickedOpen.note });
	for (const [label, over] of [["an unknown stored theme", (fx) => ({ settings: { ...fx.settings, theme: "neon-2031" } })], ["shared Paper", (fx) => ({ globals: { ...fx.globals, theme: "paper" } })]]) {
		await open("key-empty", over(sim.fixtures["key-empty"]));
		await setFold(false);
		const u = await band();
		check(`empty key with ${label}, folded: the row still carries the empty-key sentence`, u.note?.shown === true && /^Shows on the key once a reading is picked\.$/.test(u.note.text) && u.overflow <= 0, u.note);
	}
	// 10. First-line alignment (UXR01) in six states at five widths, open
	// and folded.
	const alignStates = [
		["key Default", "key-configured", undefined],
		["dial Ember", "dial-configured", (fx) => ({ settings: { ...fx.settings, theme: "ember" } })],
		["key neon-2031", "key-configured", (fx) => ({ settings: { ...fx.settings, theme: "neon-2031" } })],
		["key synthwave-sunset-2027", "key-configured", (fx) => ({ settings: { ...fx.settings, theme: "synthwave-sunset-2027" } })],
		["empty key on Paper", "key-empty", (fx) => ({ globals: { ...fx.globals, theme: "paper" } })],
		["empty key neon-2031", "key-empty", (fx) => ({ settings: { ...fx.settings, theme: "neon-2031" } })]
	];
	for (const width of [373, 320, 249, 189, 160]) {
		await b.viewport(width, 410, dprOf(width));
		const bad = [];
		for (const [label, fixture, over] of alignStates) {
			await open(fixture, over ? over(sim.fixtures[fixture]) : undefined);
			for (const state of ["open", "folded"]) {
				if (state === "folded") await setFold(false);
				const a = await align();
				const offLeft = a.wrapped.filter((w) => Math.abs(w.left - a.titleLeft) > 1);
				if (a.off > 1 || offLeft.length > 0 || a.overflow > 0) bad.push({ label, state, off: a.off, titleLeft: a.titleLeft, offLeft, overflow: a.overflow });
			}
			if (width === 160 && /synthwave|Paper/.test(label)) writeFileSync(path.join(out, `align-${width}-${label.replace(/\W+/g, "-")}-folded.png`), await b.screenshot({ full: false }));
		}
		check(`${width}: in six states, open and folded, the marker sits on the title's line and wrapped lines start under the title`, bad.length === 0, bad.slice(0, 4));
	}
	// 11. Captures for the page.
	await b.viewport(373, 410, 1.5);
	await open("dial-configured", { settings: { ...sim.fixtures["dial-configured"].settings, theme: "ember" } });
	await setFold(false);
	writeFileSync(path.join(out, "dial-ember-373-folded.png"), await b.screenshot({ full: false }));
	await open("key-configured", { globals: { ...sim.fixtures["key-configured"].globals, theme: "paper" } });
	await setFold(false);
	writeFileSync(path.join(out, "key-paper-373-folded.png"), await b.screenshot({ full: false }));
	await setFold(true);
	writeFileSync(path.join(out, "key-paper-373-open.png"), await b.screenshot({ full: false }));
} catch (err) {
	console.log("ERROR", err?.stack ?? String(err));
	results.push({ name: "script error", ok: false, detail: String(err) });
} finally {
	writeFileSync(path.join(out, "verify.json"), JSON.stringify(results, null, 1));
	await b.close();
	await sim.stop();
	await base.stop();
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? `${variant}: ALL ${results.length} PASS` : `${variant}: ${failed} of ${results.length} FAIL`);
process.exit(failed === 0 ? 0 : 1);
