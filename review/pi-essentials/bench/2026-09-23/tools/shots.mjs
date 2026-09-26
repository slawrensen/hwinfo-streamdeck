// Full-length screenshots of the REAL panels inside the Stream Deck app
// (CDP, beyond the 410 px viewport), for the report. Read-only: sections are
// opened by setting <details>.open, which writes nothing.
//   node shots.mjs <name>=<cell>[:open|:default] ...
import fs from "node:fs";
import path from "node:path";
import { select } from "./cells.mjs";
import { attach, findTarget } from "./rpi.mjs";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const out = path.join(here, "..", "shots");
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const spec of process.argv.slice(2)) {
	const [name, rest] = spec.split("=");
	const [cell, mode = "default"] = rest.split(":");
	const page = cell.startsWith("d") ? "sensor-dial" : undefined;
	await select(cell, page);
	await sleep(1800);
	const c = await attach(await findTarget());
	if (mode === "open") await c.evaluate(`document.querySelectorAll("details:not(#setup-help)").forEach((d) => { d.open = true; })`);
	await c.evaluate(`window.scrollTo(0, 0)`);
	await sleep(700);
	const m = await c.send("Page.getLayoutMetrics");
	const size = m.cssContentSize ?? m.contentSize;
	const shot = await c.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.width, height: Math.ceil(size.height), scale: 1 } });
	const file = path.join(out, `${name}.png`);
	fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
	console.log(`${file} ${Math.round(size.width)}x${Math.ceil(size.height)} writes=${await c.evaluate("__hwPanel?.writes ?? 0")}`);
	c.close();
}
