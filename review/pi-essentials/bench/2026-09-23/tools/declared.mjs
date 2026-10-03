// B3.2 declared paths only, in the real app: for every bound control on the
// open panel ([data-setting], shared ones included), make ONE real change
// through the renderer input pipeline (arrow on a select, a mouse click on a
// checkbox, typed text), then compare the document the panel sent with the
// one before: exactly the control's own path may differ. Shared (global)
// controls are put back right after (that restore is itself one declared
// write), so the deck's other keys see a blink, not a change.
//   node declared.mjs <label> [--globals]
import fs from "node:fs";
import { attach, findTarget } from "./rpi.mjs";

const [label, ...rest] = process.argv.slice(2);
const withGlobals = rest.includes("--globals") || rest.includes("--only-globals");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c = await attach(await findTarget());
await c.send("Emulation.setFocusEmulationEnabled", { enabled: true });
const ev = (x) => c.evaluate(x);
await ev(`document.querySelectorAll("details").forEach((d) => { d.open = true; })`);
await sleep(300);
const controls = await ev(`Array.from(document.querySelectorAll("[data-setting]")).filter((e) => e.getClientRects().length > 0 && !e.disabled).map((e, i) => { e.dataset.benchIdx = String(i); return { idx: String(i), setting: e.dataset.setting, global: e.hasAttribute("data-global"), tag: e.tagName, type: e.type, validate: e.dataset.validate ?? "", value: e.type === "checkbox" ? e.checked : e.value }; })`);
const results = [];
const diffKeys = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
for (const ctl of controls) {
	if (ctl.global && !withGlobals) continue;
	if (!ctl.global && rest.includes("--only-globals")) continue;
	const sel = `[data-bench-idx="${ctl.idx}"]`;
	const snap = async () => ev(`({ s: JSON.parse(JSON.stringify(__hwPanel.settings)), g: JSON.parse(JSON.stringify(__hwPanel.globals)), w: __hwPanel.writes, gw: __hwPanel.globalWrites })`);
	const b = await snap();
	const change = async () => {
		if (ctl.type === "checkbox") {
			const p = await ev(`(() => { const e = document.querySelector('${sel}'); e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
			await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p[0], y: p[1] });
			await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p[0], y: p[1], button: "left", clickCount: 1 });
			await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p[0], y: p[1], button: "left", clickCount: 1 });
		} else if (ctl.tag === "SELECT") {
			const atEnd = await ev(`(() => { const e = document.querySelector('${sel}'); e.scrollIntoView({ block: "center" }); e.focus(); const opts = Array.from(e.options).filter((o) => !o.disabled); return opts.indexOf(e.selectedOptions[0]) >= opts.length - 1; })()`);
			await c.key(atEnd ? "ArrowUp" : "ArrowDown");
		} else {
			await ev(`(() => { const e = document.querySelector('${sel}'); e.scrollIntoView({ block: "center" }); e.focus(); e.select?.(); })()`);
			await c.type(ctl.validate === "number" ? "7" : "B32");
			await c.key("Tab");
		}
	};
	await change();
	await sleep(700);
	const a = await snap();
	const settingsChanged = diffKeys(b.s, a.s);
	const globalsChanged = diffKeys(b.g, a.g);
	const own = ctl.global ? globalsChanged : settingsChanged;
	const other = ctl.global ? settingsChanged : globalsChanged;
	const ok = own.length === 1 && own[0] === ctl.setting && other.length === 0;
	const r = { setting: ctl.setting, global: ctl.global, control: `${ctl.tag.toLowerCase()}${ctl.type ? ":" + ctl.type : ""}`, from: ctl.value, to: ctl.global ? a.g[ctl.setting] : a.s[ctl.setting], writes: a.w - b.w, globalWrites: a.gw - b.gw, changed: own, otherDocChanged: other, ok };
	results.push(r);
	console.log(`${ok ? "OK  " : "BAD "} ${ctl.global ? "global " : ""}${ctl.setting}: ${JSON.stringify(r.from)} -> ${JSON.stringify(r.to)} writes ${r.writes}/${r.globalWrites} changed [${own.join(",")}]${other.length ? ` other [${other.join(",")}]` : ""}`);
	if (ctl.global) {
		// Put the shared value back the same way (one more declared write).
		await change();
		await sleep(700);
		const back = await ev(`__hwPanel.globals[${JSON.stringify(ctl.setting)}]`);
		console.log(`     restored global ${ctl.setting} -> ${JSON.stringify(back)}`);
	}
}
c.close();
fs.mkdirSync(new URL("../declared/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL(`../declared/${label}.json`, import.meta.url), JSON.stringify(results, null, "\t"));
console.log(`${label}: ${results.filter((r) => r.ok).length}/${results.length} declared-path changes clean`);
