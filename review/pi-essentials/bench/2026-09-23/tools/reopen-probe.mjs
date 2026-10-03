// B7: is the saved reading in view each time the list opens? Drives the
// open panel's picker through open/close sequences with renderer-level
// input (focus, clicks, keys) and reports, per step, whether the selected
// row intersects the list viewport, polled over ~20 frames.
import { attach, findTarget } from "./rpi.mjs";

const c = await attach(await findTarget());
await c.send("Emulation.setFocusEmulationEnabled", { enabled: true });
const ev = (x) => c.evaluate(x);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const visibleOverFrames = `(async () => {
	const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
	const out = [];
	for (let i = 0; i < 20; i++) {
		await frame();
		const list = document.getElementById("picker-list");
		const s = list.querySelector(".hw-row.selected");
		if (!s || list.hidden) { out.push("-"); continue; }
		const a = s.getBoundingClientRect(), b = list.getBoundingClientRect();
		out.push(a.bottom > b.top && a.top < b.bottom ? "V" : "x");
	}
	return out.join("");
})()`;
async function clickBox() {
	const p = await ev(`(() => { const r = document.getElementById("picker-search").getBoundingClientRect(); return [r.left + 30, r.top + r.height / 2]; })()`);
	await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p[0], y: p[1] });
	await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p[0], y: p[1], button: "left", clickCount: 1 });
	await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p[0], y: p[1], button: "left", clickCount: 1 });
}
await ev(`document.activeElement?.blur()`);
const steps = [
	["first open by click", async () => clickBox()],
	["close by second click", async () => clickBox()],
	["reopen by click", async () => clickBox()],
	["type zzz, clear, Tab, reopen by click", async () => {
		await c.type("zzz");
		await sleep(100);
		for (let i = 0; i < 3; i++) await c.key("Backspace");
		await sleep(100);
		await c.key("Tab");
		await sleep(150);
		await clickBox();
	}],
	["type drive, Tab, reopen by click", async () => {
		await clickBox();
		await sleep(100);
		await c.type("drive");
		await sleep(100);
		await c.key("Tab");
		await sleep(150);
		await clickBox();
	}]
];
for (const [name, act] of steps) {
	await act();
	const v = await ev(visibleOverFrames);
	console.log(`${name.padEnd(40)} ${v}`);
	await sleep(150);
}
await c.key("Tab");
console.log("writes", await ev(`__hwPanel.writes`));
c.close();
