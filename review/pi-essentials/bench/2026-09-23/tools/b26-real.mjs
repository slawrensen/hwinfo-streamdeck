// B2.6 with a real pointer and real keystrokes: select FROM, pin its label
// field to a fixed spot in the panel (CDP scroll only), click into it with
// the OS mouse, select all and type through the OS keyboard, then click TO
// on the canvas at once. The pointer really leaves the panel on the way, as
// a person's would. Verdict: disk (snap.mjs) and the WS recorder.
//   node b26-real.mjs <rounds> <fromCell> <toCell> <labelFrameX> <labelFrameY>
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { frameOf, select } from "./cells.mjs";
import { attach, findTarget } from "./rpi.mjs";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const [rounds = "10", from = "4,1", to = "5,1", lx = "815", ly = "512"] = process.argv.slice(2);
const SCALE = 5120 / 1568;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(here, "clicker.ps1")], { stdio: ["pipe", "pipe", "inherit"] });
const q = [];
let w = null;
ps.stdout.setEncoding("utf8");
ps.stdout.on("data", (d) => {
	for (const l of d.split(/\r?\n/).filter(Boolean)) (w ? (w(l), (w = null)) : q.push(l));
});
const next = () => new Promise((r) => (q.length ? r(q.shift()) : (w = r)));
const cmd = async (s) => {
	ps.stdin.write(s + "\n");
	return next();
};
await next();
const px = (fx, fy) => `${Math.round(fx * SCALE)} ${Math.round(fy * SCALE)}`;
const [tx, ty] = frameOf(to);
const results = [];
for (let i = 1; i <= Number(rounds); i++) {
	await select(from, "sensor-reading");
	await sleep(1300);
	const c = await attach(await findTarget());
	const context = await c.evaluate(`__hwPanel.context`);
	await c.evaluate(`(() => { const e = document.getElementById("f-label"); e.scrollIntoView({ block: "start" }); window.scrollBy(0, -60); })()`);
	c.close();
	await sleep(150);
	await cmd(`click ${px(Number(lx), Number(ly))}`.replace("click ", ""));
	await sleep(150);
	await cmd("type ^a");
	const text = `Real ${String(i).padStart(2, "0")}`;
	await cmd(`type ${text}`);
	const t0 = Date.now();
	await cmd(px(tx, ty));
	results.push({ round: i, context, text, msFromLastKeyToClick: Date.now() - t0 });
	console.log(`round ${i}: typed "${text}" into ${context.slice(0, 8)}, clicked ${to} ${Date.now() - t0} ms after the last key`);
	await sleep(1500);
}
ps.stdin.write("quit\n");
fs.writeFileSync(path.join(here, "..", "b26-real-rounds.json"), JSON.stringify(results, null, "\t"));
