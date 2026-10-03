// B3.1 observation pass on the panel that is open in the real app: expand
// every section, open the picker and browse it with arrows (Tab out: the
// app swallows Escape), walk a checklist with arrows, hover every control,
// scroll top to bottom, wait, and report the panel's own write counters.
// The WS recorder (rpi.mjs watch) and the disk snapshots (snap.mjs) are the
// ground truth; this script only performs the observation.
//   node observe.mjs <label> [--wait 10]
import fs from "node:fs";
import { attach, findTarget } from "./rpi.mjs";

const [label, ...rest] = process.argv.slice(2);
const waitS = Number(rest[rest.indexOf("--wait") + 1] ?? 10) || 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = await findTarget();
if (t === null) throw new Error("no panel");
const c = await attach(t);
await c.send("Emulation.setFocusEmulationEnabled", { enabled: true });
const ev = (x) => c.evaluate(x);
const log = [];
const before = await ev(`({ w: __hwPanel.writes, g: __hwPanel.globalWrites, kind: __hwPanel.kind, context: __hwPanel.context, url: location.pathname.split("/").pop() })`);
log.push(["start", before]);
await ev(`document.querySelectorAll("details").forEach((d) => { d.open = true; })`);
await sleep(400);
const hasPicker = await ev(`!!document.getElementById("picker-search")`);
if (hasPicker) {
	await ev(`document.getElementById("picker-search").scrollIntoView({ block: "center" }); document.getElementById("picker-search").focus()`);
	await sleep(300);
	for (const k of ["ArrowDown", "ArrowDown", "ArrowDown", "End", "Home", "ArrowUp"]) {
		await c.key(k);
		await sleep(80);
	}
	await c.key("Tab");
	await sleep(300);
	log.push(["picker", await ev(`({ expanded: document.getElementById("picker-search").getAttribute("aria-expanded"), w: __hwPanel.writes })`)]);
}
// Checklists (rotation / detail): search box then Down into the boxes, arrows only.
for (const id of ["rotation-search", "detail-search", "detail-add-search"]) {
	const exists = await ev(`!!document.getElementById(${JSON.stringify(id)})`);
	if (!exists) continue;
	await ev(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: "center" }); document.getElementById(${JSON.stringify(id)}).focus()`);
	await sleep(200);
	for (const k of ["ArrowDown", "ArrowDown", "ArrowDown", "End", "Home"]) {
		await c.key(k);
		await sleep(80);
	}
	await c.key("Tab");
	await sleep(200);
	log.push([id, await ev(`__hwPanel.writes`)]);
}
// Hover every visible control, then scroll through the page.
const points = await ev(`Array.from(document.querySelectorAll("button,select,input,summary,[role=radio],[role=option]")).filter((e) => e.getClientRects().length).slice(0, 120).map((e) => { e.scrollIntoView({ block: "nearest" }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })`);
for (const [x, y] of points) await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
const h = await ev(`document.documentElement.scrollHeight`);
for (let y = 0; y <= h; y += 120) {
	await ev(`window.scrollTo(0, ${y})`);
	await sleep(30);
}
await ev(`document.activeElement?.blur(); window.scrollTo(0, 0)`);
await sleep(waitS * 1000);
const after = await ev(`({ w: __hwPanel.writes, g: __hwPanel.globalWrites, previewState: __hwPanel.preview?.state ?? null, head: document.getElementById("head-state")?.textContent ?? null })`);
log.push(["end", after]);
c.close();
const out = { label, at: new Date().toISOString(), hoverPoints: points.length, waitS, log, writesDuring: after.w - before.w, globalWritesDuring: after.g - before.g };
fs.mkdirSync(new URL("../observe/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL(`../observe/${label}.json`, import.meta.url), JSON.stringify(out, null, "\t"));
console.log(`${label} ${before.url} ${before.kind}: panel writes ${out.writesDuring}, global ${out.globalWritesDuring}, hovered ${points.length}, head "${after.head}"`);
