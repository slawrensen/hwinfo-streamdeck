// Acceptance tests from the five-agent mockup review, run against one
// prototype (default R). Simulated host; owns only its browser and ports.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const repo = "file:///C:/Users/stephen/git/hwinfo-pi-density/";
const S = "C:/Users/stephen/AppData/Local/Temp/claude/C--Users-stephen-git-hwinfo-streamdeck/91b47c1b-9d80-49d5-bfea-6c93b12f0164/scratchpad";
const variant = process.argv[2] ?? "R";
const out = `${S}/themefold/verify-${variant}`;
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { launch } = await import(repo + "scripts/lib/cdp.mjs");
const { PanelFoldMemory } = await import(repo + "src/panel-folds.ts");
process.env.PI_SIM_PLUGIN_DIR = `${S}/themefold/proto-${variant}/com.lawrensen.hwinfo.sdPlugin`;
const { startPiSim } = await import(repo + "scripts/lib/pi-sim.mjs");
const BASE = Number(process.argv[3] ?? 34100);
const sim = await startPiSim({ httpPort: BASE + 1, wsPort: BASE });
const b = await launch({ width: 373, height: 410 });
const results = [];
const check = (name, ok, detail) => {
	results.push({ name, ok, detail });
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` :: ${JSON.stringify(detail).slice(0, 400)}`}`);
};
const open = async (fixture, overrides, keepFolds = false) => {
	if (!keepFolds) sim.folds = new PanelFoldMemory();
	sim.setFixture(fixture, overrides);
	await b.goto(sim.url(fixture, ""));
	await sleep(1200);
	sim.pushPreview();
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
	await sleep(200);
};
const ax = async () => {
	const doc = await b.send("DOM.getDocument", { depth: 0 });
	const { nodeId } = await b.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#sec-theme > summary" });
	const tree = await b.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
	const node = tree.nodes[0];
	return { role: node.role?.value, name: node.name?.value, expanded: node.properties?.find((p) => p.name === "expanded")?.value?.value };
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
			note: note ? { text: note.textContent, shown: note.getClientRects().length > 0 } : null,
			chipsTop: Math.round(document.getElementById("theme-gallery").getBoundingClientRect().top * 10) / 10,
			readingTop: Math.round(document.getElementById("sec-reading").getBoundingClientRect().top * 10) / 10,
			overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
		};
	})()`);
try {
	await b.send("DOM.enable");
	await b.send("Accessibility.enable");
	// 1. Row and title at 373 and 320, open and folded; chip anatomy.
	for (const width of [373, 320]) {
		await b.viewport(width, 410, 1.5);
		await open("key-configured");
		const o = await band();
		await setFold(false);
		const f = await band();
		check(`${width}: the fold row is one section row, open and folded (VT04)`, Math.abs(o.sumH - o.readingSumH) <= 0.5 && Math.abs(f.sumH - f.readingSumH) <= 0.5, { open: [o.sumH, o.readingSumH], folded: [f.sumH, f.readingSumH] });
		check(`${width}: "Theme" is styled and placed like a section title (VT01)`, o.titleStyle === o.readingTitleStyle && Math.abs(o.titleLeft - o.readingTitleLeft) <= 1, { o: [o.titleStyle, o.readingTitleStyle, o.titleLeft, o.readingTitleLeft] });
		check(`${width}: the folded chip is 24 px, at least 72 px wide, its stripe 3+ px under the word (VT03)`, f.chip !== null && f.chip.h === 24 && f.chip.w >= 72 && f.chip.stripeBelowBaseline >= 3, f.chip);
		check(`${width}: open, the row ends before Change and Change is outside it (AT01, PT01)`, o.changeVisible && o.sumRight <= o.changeLeft - 4 && !o.changeOverlapsSummary, { sumRight: o.sumRight, changeLeft: o.changeLeft });
		check(`${width}: the band folds from ${o.bandH} to ${f.bandH} px with no overflow`, f.bandH < o.bandH && f.bandH <= 34 && f.overflow <= 0 && o.overflow <= 0, { open: o.bandH, folded: f.bandH });
		writeFileSync(path.join(out, `key-${width}-open.png`), await (async () => { await setFold(true); return b.screenshot({ full: false }); })());
		await setFold(false);
		writeFileSync(path.join(out, `key-${width}-folded.png`), await b.screenshot({ full: false }));
	}
	// 2. Near-miss clicks around Change at 373, 189 and 160 (PT01, AT01).
	for (const width of [373, 189, 160]) {
		await b.viewport(width, 410, width < 240 ? 2 : 1.5);
		await open("key-configured");
		const c = await b.evaluate(`(() => { const r = document.getElementById("theme-change").getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`);
		const misses = [[c.r + 3, c.cy], [c.cx, c.b + 2], [c.l - 3, c.cy], [c.l - 8, c.cy], [c.cx, c.t - 2]];
		let toggled = 0;
		for (const [x, y] of misses) {
			await clickAt(x, y);
			const isOpen = await b.evaluate(`document.getElementById("sec-theme").open`);
			if (!isOpen) {
				toggled++;
				await setFold(true);
			}
		}
		check(`${width}: near misses around Change never fold the band, and write nothing`, toggled === 0 && sim.writes.length === 0 && sim.globalWrites.length === 0, { toggled, writes: sim.writes.length });
		await clickAt(c.cx, c.cy);
		const after = await b.evaluate(`({ open: document.getElementById("sec-theme").open, shared: document.getElementById("sec-shared")?.open ?? null })`);
		check(`${width}: Change opens Shared defaults and leaves the band open`, after.open === true && after.shared === true && sim.writes.length === 0, after);
	}
	// 3. Zoom: Change leaves the row, the row stays compact, nothing overflows (AT02, VT06).
	for (const width of [189, 160]) {
		await b.viewport(width, 410, 2);
		await open("key-configured");
		const o = await band();
		await setFold(false);
		const f = await band();
		check(`${width}: open, Change is not inside the row, the row is at most 60 px, no overflow`, !o.changeOverlapsSummary && o.sumH <= 60 && o.overflow <= 0, { sumH: o.sumH, overlap: o.changeOverlapsSummary, overflow: o.overflow });
		check(`${width}: folded, the band is at most 50 px`, f.bandH <= 50 && f.overflow <= 0, { bandH: f.bandH });
		writeFileSync(path.join(out, `key-${width}-folded.png`), await b.screenshot({ full: false }));
		await setFold(true);
		writeFileSync(path.join(out, `key-${width}-open.png`), await b.screenshot({ full: false }));
	}
	// 4. Eight picks move nothing and cut nothing at four widths, open.
	for (const width of [373, 320, 189, 160]) {
		await b.viewport(width, 410, width < 240 ? 2 : 1.5);
		for (const fixture of ["key-configured", "dial-configured"]) {
			await open(fixture, { globals: { ...sim.fixtures[fixture].globals, theme: "ultraviolet" } });
			const tops = new Set();
			let cut = 0;
			for (const id of ["", "void", "graphite", "ultraviolet", "midnight", "forest", "ember", "paper"]) {
				await b.evaluate(`document.querySelector('#theme-gallery .hw-theme[data-theme="${id}"]').click()`);
				await sleep(80);
				const m = await band();
				tops.add(m.chipsTop);
				if (m.curClipped) cut++;
			}
			check(`${width} ${fixture}: 8 picks, chips move 0 px and no line is cut`, tops.size === 1 && cut === 0, { tops: [...tops], cut });
		}
	}
	// 5. Accessible name and state (AT04, PT04).
	await b.viewport(373, 410, 1.5);
	await open("key-configured");
	const axOpen = await ax();
	await setFold(false);
	const axFolded = await ax();
	check("the fold row is a disclosure named by its visible words, expanded open and collapsed folded", axOpen.role === "DisclosureTriangle" && axOpen.name === "Theme Default (shared: Void)" && axOpen.expanded === true && axFolded.name === "Theme Default (shared: Void)" && axFolded.expanded === false, { axOpen, axFolded });
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
	// 7. Fold all, Open all, and the memory per panel kind.
	await open("key-configured");
	await b.click('#hw-folds [data-folds="fold"]');
	await sleep(200);
	const allFolded = await b.evaluate(`({ theme: document.getElementById("sec-theme").open, h: Math.round(document.body.getBoundingClientRect().height) })`);
	writeFileSync(path.join(out, "key-373-all-folded.png"), await b.screenshot({ full: false }));
	await b.click('#hw-folds [data-folds="open"]');
	await sleep(200);
	const allOpen = await b.evaluate(`document.getElementById("sec-theme").open`);
	check("Fold all folds the band with the rest; Open all opens it", allFolded.theme === false && allOpen === true, { allFolded, allOpen });
	await setFold(false);
	await open("key-configured", undefined, true);
	const nextKey = await b.evaluate(`document.getElementById("sec-theme").open`);
	await open("dial-configured", undefined, true);
	const dial = await b.evaluate(`document.getElementById("sec-theme").open`);
	check("a folded band stays folded on the next key panel, and a dial panel keeps its own fold", nextKey === false && dial === true, { nextKey, dial });
	// 8. Empty key: the folded row keeps "shows once a reading is picked", and picking moves nothing.
	await open("key-empty");
	await setFold(false);
	const empty = await band();
	const axEmpty = await ax();
	writeFileSync(path.join(out, "key-empty-373-folded.png"), await b.screenshot({ full: false }));
	check("empty key, folded: the row says the theme shows once a reading is picked, and says it to assistive tech", empty.note?.shown === true && /Shows on the key once a reading is picked\./.test(empty.note.text) && /Shows on the key once a reading is picked\.$/.test(axEmpty.name ?? ""), { note: empty.note, name: axEmpty.name, bandH: empty.bandH });
	const K = sim.keys;
	sim.settings = { ...sim.settings, readingKey: K.cpu };
	sim.piWs.send(JSON.stringify({ event: "didReceiveSettings", action: "com.lawrensen.hwinfo.reading", context: sim.context, device: "dev1", payload: { settings: sim.settings } }));
	sim.pushPreview();
	await sleep(500);
	const picked = await band();
	check("empty key: once a reading arrives the note empties and the Reading section does not move", picked.note?.text === "" && Math.abs(picked.readingTop - empty.readingTop) <= 0.5, { before: empty.readingTop, after: picked.readingTop, note: picked.note });
	// 9. Dial, explicit theme, folded capture.
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
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? `ALL ${results.length} PASS` : `${failed} of ${results.length} FAIL`);
process.exit(0);
