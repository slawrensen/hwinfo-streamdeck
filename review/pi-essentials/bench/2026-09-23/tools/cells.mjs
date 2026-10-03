// Canvas geometry of the F01 Bench profile in the Stream Deck app window as
// laid out on this bench (primary monitor 5120x2160, screenshot frame
// 1568x661), and a select(cell) that clicks it and waits for its panel.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findTarget } from "./rpi.mjs";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SCALE = 5120 / 1568;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Frame coordinates of a key "c,r" or a dial "d<c>". */
export function frameOf(cell) {
	// Re-read every time: the app window can move between legs.
	const g = JSON.parse(fs.readFileSync(path.join(here, "geometry.json"), "utf8"));
	if (cell.startsWith("d")) return [g.dx0 + g.ddx * Number(cell.slice(1)), g.dy];
	const [c, r] = cell.split(",").map(Number);
	return [g.kx0 + g.kdx * c, g.ky0 + g.kdy * r];
}

export function clickFrame([fx, fy]) {
	execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(here, "click.ps1"), "-X", String(Math.round(fx * SCALE)), "-Y", String(Math.round(fy * SCALE))]);
}

/** Clicks the cell and waits until a panel of the expected page is attached and connected. */
export async function select(cell, page) {
	const before = await findTarget().catch(() => null);
	clickFrame(frameOf(cell));
	for (let i = 0; i < 60; i++) {
		await sleep(150);
		const t = await findTarget().catch(() => null);
		if (t !== null && (page === undefined || t.url.includes(page)) && (before === null || t.id !== before.id || !t.url.includes(page ?? "@@"))) return t;
		if (t !== null && before !== null && t.id === before.id && page !== undefined && t.url.includes(page) && i > 10) return t;
	}
	return findTarget();
}
