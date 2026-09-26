// B2.6: text typed less than 200 ms before switching to another key is saved
// to the key it was typed on (pagehide flush), never to the next key.
// Each round: select FROM, type a unique label into its label field through
// the renderer, and click TO on the canvas within a few ms of the last key.
// Verdict per round from the WS recorder (which context got the label) is
// done afterwards by b26-verify; this script records what it did.
//   node b26-flush.mjs <rounds> <fromCell> <toCell>
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { frameOf, select } from "./cells.mjs";
import { attach, findTarget } from "./rpi.mjs";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const [rounds = "20", from = "0,0", to = "1,0"] = process.argv.slice(2);
const SCALE = 5120 / 1568;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(here, "clicker.ps1")], { stdio: ["pipe", "pipe", "inherit"] });
const lines = [];
let waiter = null;
ps.stdout.setEncoding("utf8");
ps.stdout.on("data", (d) => {
	for (const l of d.split(/\r?\n/).filter(Boolean)) {
		lines.push(l);
		if (waiter) {
			const w = waiter;
			waiter = null;
			w(l);
		}
	}
});
const next = () => new Promise((r) => (lines.length ? r(lines.shift()) : (waiter = (l) => { lines.length = 0; r(l); })));
await next(); // ready
const [tx, ty] = frameOf(to).map((v) => Math.round(v * SCALE));
const results = [];
for (let i = 1; i <= Number(rounds); i++) {
	await select(from, "sensor-reading");
	await sleep(1200);
	const t = await findTarget();
	const c = await attach(t);
	await c.send("Emulation.setFocusEmulationEnabled", { enabled: true });
	const context = await c.evaluate(`__hwPanel.context`);
	const text = `B26 r${String(i).padStart(2, "0")}`;
	await c.evaluate(`(() => { const el = document.getElementById("f-label"); el.scrollIntoView({ block: "center" }); el.focus(); el.select(); })()`);
	await c.type(text);
	const typedAt = Date.now();
	ps.stdin.write(`${tx} ${ty}\n`);
	const ack = await next();
	const clickedAt = Date.now();
	c.close();
	results.push({ round: i, context, text, msFromLastKeyToClick: clickedAt - typedAt, ack });
	console.log(`round ${i}: typed "${text}" into ${context.slice(0, 8)}, clicked ${to} ${clickedAt - typedAt} ms after the last key`);
	await sleep(1500);
}
ps.stdin.write("quit\n");
fs.writeFileSync(path.join(here, "..", "b26-rounds.json"), JSON.stringify(results, null, "\t"));
