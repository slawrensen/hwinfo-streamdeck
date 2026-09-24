// Runs observe.mjs over every F01 Bench fixture: select the cell on the app
// canvas, wait for its panel, observe. Output: observe/<id>.json per fixture.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { select } from "./cells.mjs";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = process.argv[2] ?? "10";
const FIX = [
	["K2", "1,0"], ["K3", "2,0"], ["K4", "3,0"], ["K5", "4,0"], ["K6", "5,0"], ["K7", "6,0"], ["K8", "7,0"], ["K9", "8,0"],
	["K10", "0,1"], ["K11", "1,1"], ["K12", "2,1"], ["K13", "3,1"], ["K14", "4,1"], ["K15", "5,1"], ["K16", "6,1"], ["C1", "7,1", "control"], ["C2", "8,1", "control"],
	["J1", "0,2"], ["J2", "1,2"], ["J3", "2,2"], ["J4", "3,2"], ["J5", "4,2"], ["J6", "5,2"],
	["D1", "d0", "sensor-dial"], ["D2", "d1", "sensor-dial"], ["D3", "d2", "sensor-dial"], ["D4", "d3", "sensor-dial"], ["D5", "d4", "sensor-dial"], ["D6", "d5", "sensor-dial"]
];
const only = process.argv.slice(3);
for (const [id, cell, page = "sensor-reading"] of FIX) {
	if (only.length && !only.includes(id)) continue;
	await select(cell, page);
	await sleep(1500);
	try {
		console.log(execFileSync("node", [path.join(here, "observe.mjs"), id, "--wait", wait], { encoding: "utf8" }).trim());
	} catch (err) {
		console.log(`${id}: observe failed: ${String(err.stdout ?? err.message).trim().slice(0, 300)}`);
	}
}
