// B4: samples the open panel once a second: header state, status block
// text and tone, the face's alt text, the status region's announcement
// changes, and the write counters. Re-attaches if the app reloads the panel.
//   node sample-states.mjs <label> <seconds>
import fs from "node:fs";
import { attach, findTarget } from "./rpi.mjs";

const [label, secs = "20"] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
let c = null;
let id = "";
for (let i = 0; i < Number(secs); i++) {
	try {
		const t = await findTarget();
		if (t === null) {
			rows.push({ t: new Date().toISOString().slice(11, 19), panel: "none" });
		} else {
			if (t.id !== id || c === null || c.closed) {
				c?.close();
				c = await attach(t);
				id = t.id;
				// Count what a screen reader would be told: every change of the
				// polite status region's text.
				await c.evaluate(`(() => { if (window.__said) return; window.__said = []; const box = document.getElementById("reading-status"); if (!box) return; new MutationObserver(() => window.__said.push([Math.round(performance.now()), box.innerText.replace(/\\s+/g, " ").slice(0, 80)])).observe(box, { childList: true, subtree: true, characterData: true }); })()`);
			}
			rows.push(await c.evaluate(`({ t: new Date().toISOString().slice(11, 19), head: document.getElementById("head-state")?.textContent ?? null, tone: document.getElementById("head-state")?.dataset.tone ?? null, status: (document.getElementById("reading-status")?.innerText ?? "").replace(/\\s+/g, " ").slice(0, 140), statusTone: document.getElementById("reading-status")?.dataset.tone ?? null, alt: document.getElementById("face-img")?.alt ?? null, placeholder: document.getElementById("picker-search")?.placeholder ?? null, said: (window.__said || []).length, writes: window.__hwPanel?.writes, previewState: window.__hwPanel?.preview?.state ?? null, source: window.__hwPanel?.preview?.source ?? null })`));
		}
	} catch (err) {
		rows.push({ t: new Date().toISOString().slice(11, 19), error: String(err.message).slice(0, 80) });
	}
	const r = rows.at(-1);
	console.log(`${r.t} ${r.panel ?? ""}${r.head ?? ""} | ${r.previewState ?? ""} | said ${r.said ?? "-"} | ${r.alt ?? ""} | ${(r.status ?? "").slice(0, 70)}`);
	await sleep(1000);
}
const said = c ? await c.evaluate(`window.__said || []`).catch(() => []) : [];
c?.close();
fs.mkdirSync(new URL("../states/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL(`../states/${label}.json`, import.meta.url), JSON.stringify({ label, rows, announcements: said }, null, "\t"));
console.log(`announcements (status region changes): ${said.length}`);
