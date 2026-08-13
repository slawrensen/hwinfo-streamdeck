// Property-inspector settings-persistence regression (issue #5 revision
// 2): drives the REAL sensor-reading panel — the shipped sensor-reading
// .html, pi-common.js and the vendored sdpi-components — in headless
// Chrome against a mock Stream Deck socket, and proves on the actual
// setSettings traffic that
//   1. merely opening the panel writes nothing,
//   2. the baked detailRole marker and an unknown future field (nested
//      object) survive EVERY important control path: label, Show,
//      decimals, unit, theme chip, Text custom + color, layouts (dual
//      pick, quad colors + micro-labels), thresholds and Display,
//   3. a marked Back tile hides the whole Press section, shows the
//      fixed-role note, and keeps the Show help truthful, while an
//      ordinary key's panel stays byte-for-byte the stock experience,
//   4. the grouped collector's edits are positional and atomic: armed
//      picks land at the aimed cell, + all appends one frame and
//      disarms, a cell rename touches exactly one label, drag reorder
//      lands at the midpoint index,
//   5. the aim's receipt stays truthful and the cap refuses loudly: a
//      list close never repaints a standing aim's placeholder, an edit
//      that consumes the aimed tile disarms it, and at 128 readings a
//      refused tick repaints unchecked while the list note names the cap,
//   6. the Tile shows density change regroups the walk in place, and the
//      next removal persists the plan the NEW walk built,
//   7. a primary adopted into the list parks outside the walk (dressing
//      and renames stay positional over the listed readings, removing
//      the parked chip leaves the plan untouched), and a live re-pick
//      moves the Back-tile mark and the collector's gates at once.
// Run with `npm run e2e:pi` (no plugin process, no HWiNFO needed).
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import { buildInfo, makeCheck, sleep } from "./lib/e2e-common.mjs";

const WS_PORT = 28998;
const HTTP_PORT = 28999;
const DEBUG_PORT = 29223;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");

const results = { errors: [] };
const check = makeCheck((name) => results.errors.push(name));

// The unknown future field a newer plugin version might store: it must
// ride through every edit untouched, nesting and all.
const FUTURE_BLOB = { nested: { deep: [1, "two", { three: 3 }] }, keep: "yes" };
const SEEDS = {
	back: { readingKey: "cpu:0:0", detailRole: "back", futureBlob: FUTURE_BLOB },
	plain: { readingKey: "cpu:0:0", warnValue: "80", futureBlob: FUTURE_BLOB },
	// The dial panel-truth leg: Custom preset with two touch zones (the
	// dead-tap configuration) on the overview view (no bar to promise).
	dial: { readingKey: "cpu:0:0", controlPreset: "custom", touchZones: "two", dialView: "overview" },
	// A grouped custom list: one hand-dressed quad in the plan, then the
	// uniform fill at density 4. Exercises the shrink-on-remove rules and
	// the one-frame-per-edit invariant.
	grouped: {
		readingKey: "cpu:0:0",
		pressBehavior: "open-details",
		detailMode: "custom",
		detailDensity: "4",
		detailKeys: ["bench:0:0", "bench:0:1", "bench:0:2", "bench:0:3", "bench:0:4", "bench:0:5", "bench:0:6", "bench:0:7"],
		detailTiles: [{ size: 4, labels: ["", "", "", "MINE"], colors: ["#FF00AA", null, null, null], cellLabels: true }],
		futureBlob: FUTURE_BLOB
	},
	// A list parked exactly at the 128-reading cap (the plugin parser's
	// limit): the tick-refusal feedback and the cap note are the surface.
	cap: {
		readingKey: "cpu:0:0",
		pressBehavior: "open-details",
		detailMode: "custom",
		detailKeys: Array.from({ length: 128 }, (_, i) => `cap:0:${i}`),
		futureBlob: FUTURE_BLOB
	},
	// Hand-edited junk shapes the plugin parser rejects: labels as a string,
	// colors as an object. The panel's mirror must reject them the same way
	// or it shows renames and colors the deck never renders.
	salvage: {
		readingKey: "cpu:0:0",
		pressBehavior: "open-details",
		detailMode: "custom",
		detailKeys: ["bench:0:0", "bench:0:1", "bench:0:2", "bench:0:3"],
		detailTiles: [{ size: 4, labels: "ABCD", colors: { 0: "#FF00AA" }, cellLabels: true }],
		futureBlob: FUTURE_BLOB
	},
	// Density follow (leg J): a plain uniform list with no plan. Changing
	// Tile shows must regroup the walk live, and the next removal must
	// persist the plan the NEW walk built, not the stale one.
	density: {
		readingKey: "cpu:0:0",
		pressBehavior: "open-details",
		detailMode: "custom",
		detailDensity: "1",
		detailKeys: ["bench:0:0", "bench:0:1", "bench:0:2", "bench:0:3"],
		futureBlob: FUTURE_BLOB
	},
	// An adopted primary (leg K phase 1): the opener's own sensor sits in
	// detailKeys. The deck lists only the other three, so the panel must
	// park that chip outside the tiles and flow the dressing over the
	// listed readings alone.
	adopted: {
		readingKey: "bench:0:0",
		pressBehavior: "open-details",
		detailMode: "custom",
		detailKeys: ["bench:0:0", "bench:0:1", "bench:0:2", "bench:0:3"],
		detailTiles: [{ size: 2, labels: ["L1", "L2"] }, { size: 2, labels: ["L3", "L4"] }],
		futureBlob: FUTURE_BLOB
	},
	// A live primary re-pick (leg K phase 2): the seeded primary exists in
	// the tree but not in the list; re-picking onto a listed reading must
	// move the Back-tile mark and the collector's gates without a reload.
	repick: {
		readingKey: "bench:0:9",
		pressBehavior: "open-details",
		detailMode: "custom",
		detailKeys: ["bench:0:1", "bench:0:2", "bench:0:3"],
		futureBlob: FUTURE_BLOB
	}
};

let mode = "back";
const store = { settings: structuredClone(SEEDS.back) };
const writes = []; // every setSettings payload, in arrival order
let piWs = null;
const toPi = (obj) => piWs?.send(JSON.stringify(obj));

const TREE = {
	event: "sensorTree",
	groups: [
		{
			name: "CPU [#0]",
			matchName: "CPU [#0]",
			readings: [
				{ key: "cpu:0:0", label: "CPU Tctl", unit: "°C", value: 55, type: 1, display: "55.0 °C" },
				{ key: "cpu:0:1", label: "CPU Power", unit: "W", value: 120, type: 5, display: "120.0 W" },
				{ key: "gpu:0:0", label: "GPU Temp", unit: "°C", value: 60, type: 1, display: "60.0 °C" }
			]
		},
		// Two sources sharing one display name (twin hardware, user renames in
		// HWiNFO, or the "Unknown sensor" orphan fallback): their + all buttons
		// must stay distinguishable, which a lookup by name cannot do.
		{
			name: "Twin Sensor",
			matchName: "Twin Sensor",
			readings: [
				{ key: "twin:0:0", label: "Twin A Temp", unit: "°C", value: 40, type: 1, display: "40.0 °C" },
				{ key: "twin:0:1", label: "Twin A Fan", unit: "RPM", value: 900, type: 3, display: "900 RPM" }
			]
		},
		{
			name: "Twin Sensor",
			matchName: "Twin Sensor",
			readings: [
				{ key: "twin:1:0", label: "Twin B Temp", unit: "°C", value: 41, type: 1, display: "41.0 °C" },
				{ key: "twin:1:1", label: "Twin B Fan", unit: "RPM", value: 950, type: 3, display: "950 RPM" }
			]
		},
		{
			name: "Bench Source",
			matchName: "Bench Source",
			// 10 rows: bench:0:9 serves as a primary that exists in the tree
			// while staying out of every seeded detail list (run 7).
			readings: Array.from({ length: 10 }, (_, i) => ({ key: `bench:0:${i}`, label: `Bench ${i}`, unit: "V", value: 1.2, type: 2, display: "1.20 V" }))
		},
		// An orphan source (SHM row past the sensor table): the tree shows the
		// "Unknown sensor" display fallback while matchName carries the raw
		// empty source name the runtime filter actually matches against.
		{
			name: "Unknown sensor",
			matchName: "",
			readings: [{ key: "orphan:0:0", label: "Orphan Vcore", unit: "V", value: 1.0, type: 2, display: "1.00 V" }]
		}
	],
	state: "ok",
	source: "shared-memory",
	hint: ""
};
const THEMES = {
	event: "themes",
	effectiveDeckTheme: "void",
	defaultTheme: "void",
	themes: {
		void: { bg: "#0b0d10", value: "#e8eaed", accent: "#4cc2ff" },
		paper: { bg: "#f2f0e9", value: "#1a1c1e", accent: "#3179b8" }
	}
};

const wss = new WebSocketServer({ host: "127.0.0.1", port: WS_PORT });
wss.on("connection", (ws) => {
	ws.on("message", (data) => {
		const msg = JSON.parse(data.toString());
		switch (msg.event) {
			case "registerPropertyInspector":
				piWs = ws;
				break;
			case "getSettings":
				ws.send(JSON.stringify({ event: "didReceiveSettings", action: "com.lawrensen.hwinfo.reading", context: `ctx-${mode}`, payload: { settings: store.settings, coordinates: { column: 0, row: 0 } } }));
				break;
			case "setSettings":
				writes.push(structuredClone(msg.payload ?? {}));
				store.settings = msg.payload ?? {};
				break;
			case "getGlobalSettings":
				ws.send(JSON.stringify({ event: "didReceiveGlobalSettings", payload: { settings: { theme: "void" } } }));
				break;
			case "sendToPlugin": {
				const event = msg.payload?.event;
				if (event === "getSensorTree") {
					toPi({ event: "sendToPropertyInspector", action: "com.lawrensen.hwinfo.reading", context: `ctx-${mode}`, payload: TREE });
				} else if (event === "getThemes") {
					toPi({ event: "sendToPropertyInspector", action: "com.lawrensen.hwinfo.reading", context: `ctx-${mode}`, payload: THEMES });
				} else if (event === "getDetailSupport") {
					toPi({ event: "sendToPropertyInspector", action: "com.lawrensen.hwinfo.reading", context: `ctx-${mode}`, payload: { event: "detailSupport", supported: true, model: "Harness Deck" } });
				}
				break;
			}
			default:
				break;
		}
	});
});

const info = buildInfo({ devices: [{ id: "dev1", name: "Harness Deck", size: { columns: 5, rows: 3 }, type: 0 }] });
function bootstrap() {
	const actionInfo = {
		action: "com.lawrensen.hwinfo.reading",
		context: `ctx-${mode}`,
		device: "dev1",
		payload: { settings: store.settings, coordinates: { column: 0, row: 0 }, controller: "Keypad" }
	};
	return `<style>body{background:#2d2d2d;margin:0;padding:8px 0;}</style>
<script>window.addEventListener("load",()=>{connectElgatoStreamDeckSocket(String(${WS_PORT}),"pi-ctx","registerPropertyInspector",${JSON.stringify(JSON.stringify(info))},${JSON.stringify(JSON.stringify(actionInfo))});});</script>`;
}

/** The dial PI's bootstrap: same wiring, encoder actionInfo. */
function dialBootstrap() {
	const actionInfo = {
		action: "com.lawrensen.hwinfo.dial",
		context: `ctx-${mode}`,
		device: "dev1",
		payload: { settings: store.settings, coordinates: { column: 0, row: 0 }, controller: "Encoder" }
	};
	return `<style>body{background:#2d2d2d;margin:0;padding:8px 0;}</style>
<script>window.addEventListener("load",()=>{connectElgatoStreamDeckSocket(String(${WS_PORT}),"pi-ctx","registerPropertyInspector",${JSON.stringify(JSON.stringify(info))},${JSON.stringify(JSON.stringify(actionInfo))});});</script>`;
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer((req, res) => {
	const url = (req.url ?? "/").split("?")[0];
	const seedMatch = url.match(/^\/seed\/(back|plain|dial|grouped|cap|salvage|density|adopted|repick)$/);
	if (seedMatch !== null) {
		mode = seedMatch[1];
		store.settings = structuredClone(SEEDS[mode]);
		writes.length = 0;
		res.writeHead(200).end("ok");
		return;
	}
	const file = path.join(pluginDir, path.normalize(url).replace(/^([\\/.])+/, ""));
	if (!file.startsWith(pluginDir)) {
		res.writeHead(403).end();
		return;
	}
	try {
		let body = readFileSync(file);
		if (file.endsWith("sensor-reading.html")) {
			body = Buffer.from(body.toString("utf8").replace("</head>", `${bootstrap()}</head>`));
		} else if (file.endsWith("sensor-dial.html")) {
			body = Buffer.from(body.toString("utf8").replace("</head>", `${dialBootstrap()}</head>`));
		}
		res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
	} catch {
		res.writeHead(404).end("not found");
	}
});
server.listen(HTTP_PORT, "127.0.0.1");

// --- headless Chrome over CDP (the capture-pi pattern) --------------------
const chrome = spawn(
	CHROME,
	["--headless=new", "--disable-gpu", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${path.join(process.env.TEMP ?? ".", "pi-persist-profile")}`, "--hide-scrollbars", "about:blank"],
	{ stdio: "ignore" }
);
function killChromeTree() {
	try {
		spawnSync("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
	} catch {
		chrome.kill();
	}
	try {
		spawnSync(
			"powershell.exe",
			["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -match 'pi-persist-profile' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"],
			{ stdio: "ignore", timeout: 15000 }
		);
	} catch {
		/* best effort */
	}
}
const watchdog = setTimeout(() => {
	console.error("[pi-persistence] watchdog: 240s elapsed, aborting");
	killChromeTree();
	process.exit(2);
}, 240000);
watchdog.unref();

let cdpSocket = null;
try {
	let target = null;
	for (let i = 0; i < 30 && target === null; i++) {
		await sleep(500);
		try {
			const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
			target = list.find((t) => t.type === "page") ?? null;
		} catch {
			/* debugger not up yet */
		}
	}
	if (target === null) {
		throw new Error("chrome debugger never came up");
	}
	const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
	cdpSocket = ws;
	await new Promise((resolve, reject) => {
		ws.once("open", resolve);
		ws.once("error", reject);
	});
	let seq = 0;
	const pending = new Map();
	ws.on("message", (data) => {
		const msg = JSON.parse(data.toString());
		if (msg.id !== undefined && pending.has(msg.id)) {
			pending.get(msg.id)(msg);
			pending.delete(msg.id);
		}
	});
	const cdp = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = ++seq;
			pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
			ws.send(JSON.stringify({ id, method, params }));
		});
	const evaluate = (expression) => cdp("Runtime.evaluate", { expression, returnByValue: true });
	await cdp("Emulation.setDeviceMetricsOverride", { width: 400, height: 900, deviceScaleFactor: 1, mobile: false });
	await cdp("Page.enable");

	const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
	/** The invariant after one edit: at least one new write arrived, the
	 * edited field landed, and the marker + unknown blob rode through. */
	const assertPreserved = (name, writesBefore, expect = {}) => {
		const fresh = writes.slice(writesBefore);
		check(`${name}: the edit produced a write`, fresh.length >= 1, `${fresh.length} writes`);
		const last = writes.at(-1) ?? {};
		for (const [key, value] of Object.entries(expect)) {
			check(`${name}: wrote ${key}`, deepEqual(last[key], value), JSON.stringify(last[key]));
		}
		check(`${name}: detailRole marker preserved`, last.detailRole === "back", JSON.stringify(last.detailRole));
		check(`${name}: unknown nested field preserved`, deepEqual(last.futureBlob, FUTURE_BLOB), JSON.stringify(last.futureBlob));
	};
	const setSelect = async (setting, value) => {
		const res = await evaluate(`(() => {
			const el = document.querySelector('sdpi-select[setting="${setting}"]');
			if (!el) return "missing";
			el.value = ${JSON.stringify(value)};
			const inner = (el.shadowRoot ?? el).querySelector("select");
			if (inner && inner.value !== ${JSON.stringify(value)}) {
				inner.value = ${JSON.stringify(value)};
				inner.dispatchEvent(new Event("change", { bubbles: true }));
			}
			return "ok";
		})()`);
		check(`sdpi-select ${setting} driven`, res.result?.value === "ok", String(res.result?.value));
	};
	const setTextfield = async (setting, value) => {
		const res = await evaluate(`(() => {
			const el = document.querySelector('sdpi-textfield[setting="${setting}"]');
			if (!el) return "missing";
			const input = (el.shadowRoot ?? el).querySelector("input");
			if (!input) return "no input";
			input.focus();
			input.value = ${JSON.stringify(value)};
			input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
			input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
			input.blur();
			return "ok";
		})()`);
		check(`sdpi-textfield ${setting} driven`, res.result?.value === "ok", String(res.result?.value));
	};
	const clickCheckbox = async (setting) => {
		const res = await evaluate(`(() => {
			const el = document.querySelector('sdpi-checkbox[setting="${setting}"]');
			if (!el) return "missing";
			const input = (el.shadowRoot ?? el).querySelector("input[type=checkbox]");
			if (!input) return "no input";
			input.click();
			return "ok";
		})()`);
		check(`sdpi-checkbox ${setting} clicked`, res.result?.value === "ok", String(res.result?.value));
	};
	/** Bounded DOM poll over CDP (the waitUntil idiom with an async
	 * predicate): passes the check as soon as `expr` evaluates true, and a
	 * timeout fails loud with `detailExpr`'s value so the FAIL line names
	 * what the DOM actually showed instead of a bare timeout. */
	const waitDom = async (name, expr, timeoutMs, detailExpr = expr) => {
		const start = Date.now();
		for (;;) {
			if ((await evaluate(expr)).result?.value === true) {
				check(name, true, `after ${((Date.now() - start) / 1000).toFixed(1)}s`);
				return;
			}
			if (Date.now() - start >= timeoutMs) {
				const seen = (await evaluate(detailExpr)).result?.value;
				check(name, false, `not within ${timeoutMs / 1000}s (saw: ${String(seen).slice(0, 160)})`);
				return;
			}
			await sleep(100);
		}
	};

	// ---- run 1: the marked Back tile ------------------------------------
	await fetch(`http://127.0.0.1:${HTTP_PORT}/seed/back`);
	await cdp("Page.navigate", { url: `http://127.0.0.1:${HTTP_PORT}/ui/sensor-reading.html` });
	await sleep(3500); // load + register + the 400 ms visibility polls

	check("opening the panel wrote nothing", writes.length === 0, `${writes.length} writes`);
	const vis = await evaluate(`JSON.stringify({
		press: document.getElementById("press-block")?.hidden,
		note: document.getElementById("role-note")?.hidden,
		help: document.getElementById("show-help")?.textContent ?? ""
	})`);
	const state = JSON.parse(vis.result?.value ?? "{}");
	check("Back role hides the whole Press section", state.press === true, JSON.stringify(state.press));
	check("Back role shows the fixed-role note", state.note === false, JSON.stringify(state.note));
	check("Show help names the fixed Back press, not a stat cycle", typeof state.help === "string" && state.help.includes("returns to the previous profile") && !state.help.includes("Pressing the key cycles"), state.help);

	let mark = writes.length;
	await setTextfield("label", "My Back");
	await sleep(700);
	assertPreserved("label edit", mark, { label: "My Back" });

	mark = writes.length;
	await setSelect("statMode", "max");
	await sleep(700);
	assertPreserved("Show (manual stat) edit", mark, { statMode: "max" });

	mark = writes.length;
	await setSelect("decimals", "1");
	await sleep(700);
	assertPreserved("decimals edit", mark, { decimals: "1" });

	mark = writes.length;
	await clickCheckbox("fahrenheit");
	await sleep(700);
	assertPreserved("unit toggle", mark, { fahrenheit: true });

	mark = writes.length;
	const chip = await evaluate(`(() => {
		const c = document.querySelector('.hw-theme[data-theme="paper"]');
		if (!c) return "missing";
		c.click();
		return "ok";
	})()`);
	check("theme chip clicked", chip.result?.value === "ok", String(chip.result?.value));
	await sleep(700);
	assertPreserved("theme chip", mark, { theme: "paper" });

	mark = writes.length;
	await setSelect("textMode", "custom");
	await sleep(900);
	assertPreserved("Text mode edit", mark, { textMode: "custom" });
	mark = writes.length;
	const well = await evaluate(`(() => {
		const el = document.getElementById("text-color");
		if (!el) return "missing";
		el.value = "#ff8800";
		el.dispatchEvent(new Event("change", { bubbles: true }));
		return "ok";
	})()`);
	check("text color well driven", well.result?.value === "ok", String(well.result?.value));
	await sleep(700);
	assertPreserved("text color edit", mark, { textColor: "#ff8800" });

	mark = writes.length;
	await setSelect("keyLayout", "dual");
	await sleep(900);
	assertPreserved("layout to dual", mark, { keyLayout: "dual" });
	mark = writes.length;
	const pick = await evaluate(`(() => {
		const el = document.getElementById("picker2-search");
		if (!el) return "missing";
		el.focus();
		el.value = "power";
		el.dispatchEvent(new Event("input", { bubbles: true }));
		return "ok";
	})()`);
	check("second picker searched", pick.result?.value === "ok", String(pick.result?.value));
	await sleep(600);
	const row = await evaluate(`(() => {
		const r = document.querySelector("#picker2-list .hw-row");
		if (!r) return "missing";
		r.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
		return "ok";
	})()`);
	check("second sensor picked", row.result?.value === "ok", String(row.result?.value));
	await sleep(700);
	assertPreserved("second sensor pick", mark, { secondaryReadingKey: "cpu:0:1" });

	mark = writes.length;
	await setSelect("keyLayout", "quad");
	await sleep(900);
	assertPreserved("layout to quad", mark, { keyLayout: "quad" });
	mark = writes.length;
	const preset = await evaluate(`(() => {
		const el = document.getElementById("quad-color-preset");
		if (!el) return "missing";
		el.value = "pairs";
		el.dispatchEvent(new Event("change", { bubbles: true }));
		return "ok";
	})()`);
	check("quad color preset driven", preset.result?.value === "ok", String(preset.result?.value));
	await sleep(700);
	assertPreserved("quad colors preset", mark, { quadColors: ["#4CC2FF", "#4CC2FF", "#FF7E8E", "#FF7E8E"] });
	mark = writes.length;
	await clickCheckbox("quadLabels");
	await sleep(700);
	assertPreserved("quad micro-labels toggle", mark, { quadLabels: true });

	mark = writes.length;
	await setSelect("keyLayout", "single");
	await sleep(900);
	assertPreserved("layout back to single", mark, { keyLayout: "single" });

	mark = writes.length;
	await setTextfield("warnValue", "75");
	await sleep(700);
	assertPreserved("warn threshold edit", mark, { warnValue: "75" });

	mark = writes.length;
	const display = await evaluate(`(() => {
		const el = document.getElementById("display-mode");
		if (!el) return "missing";
		el.value = "bar";
		el.dispatchEvent(new Event("change", { bubbles: true }));
		return "ok";
	})()`);
	check("display select driven", display.result?.value === "ok", String(display.result?.value));
	await sleep(700);
	assertPreserved("display edit", mark, { displayMode: "bar" });

	// The full accumulated object still carries everything the run wrote.
	const finalBack = writes.at(-1) ?? {};
	check("accumulated settings kept every earlier edit", finalBack.label === "My Back" && finalBack.statMode === "max" && finalBack.theme === "paper" && finalBack.secondaryReadingKey === "cpu:0:1", JSON.stringify(finalBack).slice(0, 200));

	// ---- run 2: an ordinary key stays the stock panel --------------------
	await fetch(`http://127.0.0.1:${HTTP_PORT}/seed/plain`);
	await cdp("Page.navigate", { url: `http://127.0.0.1:${HTTP_PORT}/ui/sensor-reading.html` });
	await sleep(3500);

	check("ordinary key: opening wrote nothing", writes.length === 0, `${writes.length} writes`);
	const plainVis = await evaluate(`JSON.stringify({
		press: document.getElementById("press-block")?.hidden ?? "gone",
		note: document.getElementById("role-note")?.hidden,
		help: document.getElementById("show-help")?.textContent ?? ""
	})`);
	const plain = JSON.parse(plainVis.result?.value ?? "{}");
	check("ordinary key: Press section visible", plain.press === false, JSON.stringify(plain.press));
	check("ordinary key: role note hidden", plain.note === true, JSON.stringify(plain.note));
	check("ordinary key: Show help keeps the stock cycle sentence", typeof plain.help === "string" && plain.help.includes("Pressing the key cycles"), plain.help);

	mark = writes.length;
	await setTextfield("label", "Plain");
	await sleep(700);
	const freshPlain = writes.slice(mark);
	check("ordinary key: label edit wrote", freshPlain.length >= 1, `${freshPlain.length} writes`);
	const lastPlain = writes.at(-1) ?? {};
	check("ordinary key: unknown nested field preserved", deepEqual(lastPlain.futureBlob, FUTURE_BLOB), JSON.stringify(lastPlain.futureBlob));
	check("ordinary key: no role marker appeared from nowhere", !("detailRole" in lastPlain), JSON.stringify(lastPlain.detailRole));
	check("ordinary key: existing fields intact", lastPlain.warnValue === "80" && lastPlain.readingKey === "cpu:0:0", JSON.stringify(lastPlain).slice(0, 160));

	// ---- run 2b: "+ all" on the SECOND of two same-named sources ---------
	// Source display names are not unique; the button must bind by position
	// in the rendered tree, or the second twin silently adds the first's
	// readings (found by the Codex review on PR #6).
	await setSelect("pressBehavior", "open-details");
	await sleep(700);
	await setSelect("detailMode", "custom");
	await sleep(700);
	const customVisible = await evaluate(`document.getElementById("detail-custom")?.hidden`);
	check("custom detail block visible", customVisible.result?.value === false, String(customVisible.result?.value));

	mark = writes.length;
	const focused = await evaluate(`(() => {
		const input = document.getElementById("pickerd-search");
		if (!input) return "no search input";
		input.focus();
		// Headless Chrome does not reliably fire focus events on an unfocused
		// window; the picker opens from its focus listener, so fire it by hand.
		input.dispatchEvent(new Event("focus"));
		return "ok";
	})()`);
	check("detail picker opened", focused.result?.value === "ok", String(focused.result?.value));
	await sleep(900); // ws round trip + renderList
	const twinAdd = await evaluate(`(() => {
		const buttons = Array.from(document.querySelectorAll("#pickerd-list .hw-group-add"));
		if (buttons.length !== 5) return "expected 5 add-all buttons, got " + buttons.length;
		// DOM order mirrors tree order: CPU, twin A, twin B, Bench, orphan.
		// Press twin B's. The list acts on mousedown (it preventDefaults
		// ahead of blur), so a plain click() would not reach it.
		buttons[2].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		return "ok";
	})()`);
	check("+ all pressed on the second twin", twinAdd.result?.value === "ok", String(twinAdd.result?.value));
	await sleep(700);
	const twinWrites = writes.slice(mark);
	const lastTwin = writes.at(-1) ?? {};
	check("+ all wrote the custom list in one frame", twinWrites.length === 1, `${twinWrites.length} writes`);
	check("+ all added the SECOND twin's readings, not the first's", deepEqual(lastTwin.detailKeys, ["twin:1:0", "twin:1:1"]), JSON.stringify(lastTwin.detailKeys));

	// ---- run 2c: the live filter count uses the RUNTIME's candidate ------
	// The deck matches `${sourceName} ${label}` with "" for an orphan source
	// (detail-group.ts); the panel must count with the same candidate, not
	// the tree's "Unknown sensor" display fallback, or the counter promises
	// readings the opened view will not list.
	await setSelect("detailMode", "filter");
	await sleep(700);
	check("filter block visible", (await evaluate(`document.getElementById("detail-filter")?.hidden`)).result?.value === false);
	await setTextfield("detailFilter", "*unknown*vcore*");
	await sleep(1000); // the write plus the 400 ms followSetting poll
	const countText = (await evaluate(`document.getElementById("detail-filter-count")?.textContent ?? "gone"`)).result?.value;
	check("a display-name pattern counts 0, matching what the deck resolves", String(countText).startsWith("Matches nothing right now"), String(countText));
	await setTextfield("detailFilter", "*orphan*");
	await sleep(1000);
	const countText2 = (await evaluate(`document.getElementById("detail-filter-count")?.textContent ?? "gone"`)).result?.value;
	check("a label pattern still counts the orphan reading", String(countText2) === "Matches 1 reading right now.", String(countText2));

	// ---- run 3: grouped list edits are atomic and shrink their tile ------
	// Every list or tile edit must land as ONE setSettings frame carrying
	// BOTH detailKeys and detailTiles: two staggered frames leave a window
	// where only half the edit survives (the restaffed-quad bug), and a
	// removal must shrink the tile that held the reading whether the plan
	// or the uniform fill built it.
	await fetch(`http://127.0.0.1:${HTTP_PORT}/seed/grouped`);
	await cdp("Page.navigate", { url: `http://127.0.0.1:${HTTP_PORT}/ui/sensor-reading.html` });
	await sleep(3500);
	check("grouped: opening wrote nothing", writes.length === 0, `${writes.length} writes`);
	// The boot sensorTree echo runs every picker's showSelection; the
	// collector's HTML resting text must survive it (placeholder ownership).
	const restingPh = (await evaluate(`document.getElementById("pickerd-search")?.placeholder ?? "gone"`)).result?.value;
	check("grouped: the boot tree echo kept the collector's resting placeholder", restingPh === "Search sensors to add…", String(restingPh));

	const clickChipRemove = async (key) =>
		(await evaluate(`(() => {
			const x = document.querySelector('#detail-list .hw-set-chip[data-key="${key}"] .hw-set-remove');
			if (!x) return "missing";
			x.click();
			return "ok";
		})()`)).result?.value;
	const atomic = (name, fresh) => {
		check(`${name}: exactly one frame`, fresh.length === 1, `${fresh.length} frames`);
		const frame = fresh.at(-1) ?? {};
		check(`${name}: frame carries both fields`, Array.isArray(frame.detailKeys) && Array.isArray(frame.detailTiles), Object.keys(frame).join(","));
		check(`${name}: unknown nested field preserved`, deepEqual(frame.futureBlob, FUTURE_BLOB), JSON.stringify(frame.futureBlob));
		return frame;
	};

	mark = writes.length;
	check("× on a planned-quad cell clicked", (await clickChipRemove("bench:0:1")) === "ok");
	await sleep(700);
	let frame = atomic("planned ×", writes.slice(mark));
	check("planned ×: quad shrank to 3", frame.detailTiles?.[0]?.size === 3, JSON.stringify(frame.detailTiles?.[0]));
	check("planned ×: dressing followed the cell out", deepEqual(frame.detailTiles?.[0]?.labels, ["", "", "MINE"]) && deepEqual(frame.detailTiles?.[0]?.colors, ["#FF00AA", null, null]), JSON.stringify(frame.detailTiles?.[0]));
	check("planned ×: key left the list", frame.detailKeys?.length === 7 && !frame.detailKeys.includes("bench:0:1"), JSON.stringify(frame.detailKeys));

	mark = writes.length;
	check("× on a uniform-fill cell clicked", (await clickChipRemove("bench:0:5")) === "ok");
	await sleep(700);
	frame = atomic("uniform ×", writes.slice(mark));
	check("uniform ×: the fill tile materialized and shrank", frame.detailTiles?.length === 2 && frame.detailTiles?.[1]?.size === 3, JSON.stringify(frame.detailTiles));
	check("uniform ×: key left the list", frame.detailKeys?.length === 6 && !frame.detailKeys.includes("bench:0:5"), JSON.stringify(frame.detailKeys));

	// The membership checkbox is the same control the rotation list uses:
	// untick removes (tile shrinks), tick adds, the opener's row is fixed on.
	const openCollector = async () => {
		await evaluate(`(() => {
			const input = document.getElementById("pickerd-search");
			input.focus();
			input.dispatchEvent(new Event("focus"));
			return "ok";
		})()`);
		await sleep(600);
	};
	await openCollector();
	mark = writes.length;
	const untick = await evaluate(`(() => {
		const tick = document.querySelector('#pickerd-list .hw-row[data-key="bench:0:4"] .hw-tick');
		if (!tick) return "missing";
		if (!tick.checked) return "not checked";
		tick.click();
		return "ok";
	})()`);
	check("member row shows a checked tick; unticked it", untick.result?.value === "ok", String(untick.result?.value));
	await sleep(700);
	frame = atomic("tick remove", writes.slice(mark));
	check("tick remove: its tile shrank again", frame.detailTiles?.[1]?.size === 2, JSON.stringify(frame.detailTiles?.[1]));
	check("tick remove: key left the list", frame.detailKeys?.length === 5 && !frame.detailKeys.includes("bench:0:4"), JSON.stringify(frame.detailKeys));

	mark = writes.length;
	const tickAdd = await evaluate(`(() => {
		const tick = document.querySelector('#pickerd-list .hw-row[data-key="bench:0:8"] .hw-tick');
		if (!tick) return "missing";
		if (tick.checked) return "already checked";
		tick.click();
		return "ok";
	})()`);
	check("non-member row shows an unticked box; ticked it", tickAdd.result?.value === "ok", String(tickAdd.result?.value));
	await sleep(700);
	frame = atomic("tick add", writes.slice(mark));
	check("tick add: key joined the list", frame.detailKeys?.length === 6 && frame.detailKeys.includes("bench:0:8"), JSON.stringify(frame.detailKeys));

	mark = writes.length;
	const primaryTick = await evaluate(`(() => {
		const tick = document.querySelector('#pickerd-list .hw-row[data-key="cpu:0:0"] .hw-tick');
		if (!tick) return "missing";
		const state = { checked: tick.checked, disabled: tick.disabled };
		tick.click();
		return JSON.stringify(state);
	})()`);
	const primaryState = JSON.parse(primaryTick.result?.value?.startsWith("{") ? primaryTick.result.value : "{}");
	check("opener's row is fixed on and disabled", primaryState.checked === true && primaryState.disabled === true, String(primaryTick.result?.value));
	await sleep(500);
	check("clicking the fixed tick wrote nothing", writes.length === mark, `${writes.length - mark} frames`);

	// ---- run 3 continued: collector mechanics ----------------------------
	// Arming, armed picks (splice pin, grow, auto-disarm), armed + all
	// (append in one frame and disarm), the cell rename commit and abandon,
	// and drag reorder's insert arithmetic. Entering state: detailKeys
	// [b0,b2,b3,b6,b7,b8], plan [{3, MINE-dressed},{2}], density 4, so the
	// walk is 3/3 + 2/2 + a fill tile holding bench:0:8 (1 of 4).
	const clickAdd = async (arm) =>
		(await evaluate(`(() => {
			const add = document.querySelector('#detail-list .hw-add[data-arm="${arm}"]');
			if (!add) return "missing";
			add.click();
			return "ok";
		})()`)).result?.value;
	const placeholderNow = async () => (await evaluate(`document.getElementById("pickerd-search")?.placeholder ?? "gone"`)).result?.value;

	// Leg A: arming writes nothing and paints the aim.
	mark = writes.length;
	check("leg A: armed tile 1's +", (await clickAdd("0")) === "ok");
	await sleep(400);
	check("leg A: arming wrote nothing", writes.length === mark, `${writes.length - mark} frames`);
	check("leg A: placeholder names the aim", (await placeholderNow()) === "Adding into tile 1; click its + again to finish.", await placeholderNow());
	const armedMark = await evaluate(`document.querySelector('#detail-list .hw-add.armed[data-arm="0"]') !== null`);
	check("leg A: the aimed + is lit armed", armedMark.result?.value === true, String(armedMark.result?.value));

	// Leg B: the armed pick grows the size-3 tile to a quad at the freed
	// cell and auto-disarms at four (the docs' freed-cell promise).
	await openCollector();
	mark = writes.length;
	const armedPick = await evaluate(`(() => {
		const tick = document.querySelector('#pickerd-list .hw-row[data-key="bench:0:1"] .hw-tick');
		if (!tick || tick.checked) return "bad row";
		tick.click();
		return "ok";
	})()`);
	check("leg B: ticked into the armed tile", armedPick.result?.value === "ok", String(armedPick.result?.value));
	await sleep(700);
	frame = atomic("leg B armed pick", writes.slice(mark));
	check("leg B: key landed at the aimed cell, not the end", deepEqual(frame.detailKeys, ["bench:0:0", "bench:0:2", "bench:0:3", "bench:0:1", "bench:0:6", "bench:0:7", "bench:0:8"]), JSON.stringify(frame.detailKeys));
	check("leg B: the tile grew to a quad keeping its dressing", deepEqual(frame.detailTiles?.[0], { size: 4, labels: ["", "", "MINE", ""], colors: ["#FF00AA", null, null, null], cellLabels: true }), JSON.stringify(frame.detailTiles?.[0]));
	check("leg B: the neighbor tile is untouched", frame.detailTiles?.[1]?.size === 2, JSON.stringify(frame.detailTiles?.[1]));
	check("leg B: full quad auto-disarmed", (await evaluate(`document.querySelector('#detail-list .hw-add.armed') === null`)).result?.value === true);
	check("leg B: placeholder reset", (await placeholderNow()) === "Search sensors to add…", await placeholderNow());

	// Leg C: aiming at the under-occupied fill tail materializes it on the
	// pick and keeps the aim until toggled off by hand.
	check("leg C: armed the fill tile's +", (await clickAdd("2")) === "ok");
	await sleep(400);
	check("leg C: aim names tile 3", (await placeholderNow()) === "Adding into tile 3; click its + again to finish.", await placeholderNow());
	mark = writes.length;
	await evaluate(`document.querySelector('#pickerd-list .hw-row[data-key="bench:0:4"] .hw-tick')?.click()`);
	await sleep(700);
	frame = atomic("leg C fill pick", writes.slice(mark));
	check("leg C: key landed in the fill tile", frame.detailKeys?.length === 8 && frame.detailKeys?.[7] === "bench:0:4", JSON.stringify(frame.detailKeys));
	check("leg C: the fill tile materialized into the plan", frame.detailTiles?.length === 3 && deepEqual(frame.detailTiles?.[2], { size: 4, labels: ["", "", "", ""], colors: [null, null, null, null], cellLabels: true }), JSON.stringify(frame.detailTiles?.[2]));
	check("leg C: the aim persists while the tile has room", (await evaluate(`document.querySelector('#detail-list .hw-add.armed[data-arm="2"]') !== null`)).result?.value === true);
	mark = writes.length;
	await evaluate(`document.querySelector('#detail-list .hw-add.armed')?.click()`);
	await sleep(400);
	check("leg C: manual toggle-off wrote nothing", writes.length === mark, `${writes.length - mark} frames`);
	check("leg C: toggle-off reset the placeholder", (await placeholderNow()) === "Search sensors to add…", await placeholderNow());

	// Leg D: + all under a standing aim appends in ONE frame and disarms,
	// so the lit marker never claims a landing that did not happen.
	check("leg D: armed tile 2's +", (await clickAdd("1")) === "ok");
	await sleep(400);
	check("leg D: aim armed", (await evaluate(`document.querySelector('#detail-list .hw-add.armed[data-arm="1"]') !== null`)).result?.value === true);
	await openCollector();
	mark = writes.length;
	const armedGroupAdd = await evaluate(`(() => {
		const buttons = Array.from(document.querySelectorAll("#pickerd-list .hw-group-add"));
		if (buttons.length !== 5) return "expected 5 add-all buttons, got " + buttons.length;
		buttons[2].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		return "ok";
	})()`);
	check("leg D: + all pressed while armed", armedGroupAdd.result?.value === "ok", String(armedGroupAdd.result?.value));
	await sleep(700);
	frame = atomic("leg D armed + all", writes.slice(mark));
	check("leg D: the block appended at the end", deepEqual(frame.detailKeys, ["bench:0:0", "bench:0:2", "bench:0:3", "bench:0:1", "bench:0:6", "bench:0:7", "bench:0:8", "bench:0:4", "twin:1:0", "twin:1:1"]), JSON.stringify(frame.detailKeys));
	check("leg D: the plan rode through unchanged", frame.detailTiles?.length === 3 && frame.detailTiles?.[0]?.size === 4 && frame.detailTiles?.[1]?.size === 2 && frame.detailTiles?.[2]?.size === 4, JSON.stringify(frame.detailTiles?.map((t) => t.size)));
	check("leg D: + all disarmed the stale aim", (await evaluate(`document.querySelector('#detail-list .hw-add.armed') === null`)).result?.value === true);
	check("leg D: placeholder no longer claims the aim", (await placeholderNow()) === "Search sensors to add…", await placeholderNow());

	// Leg E: the cell rename commit touches exactly one label; the dressed
	// quad beside it is the index-slip tripwire. The commit also prunes the
	// now-trailing all-default fill tile (deliberate, pinned).
	const renameOpen = await evaluate(`(() => {
		const name = document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:6"] .hw-set-name');
		if (!name) return "missing";
		name.click();
		const input = document.querySelector("#detail-list input.hw-cell-rename");
		if (!input) return "no input";
		return JSON.stringify({ tile: input.dataset.tile, cell: input.dataset.cell, value: input.value, ph: input.placeholder });
	})()`);
	const renameState = JSON.parse(renameOpen.result?.value?.startsWith("{") ? renameOpen.result.value : "{}");
	check("leg E: rename input plumbs tile 1 cell 0", renameState.tile === "1" && renameState.cell === "0" && renameState.value === "" && renameState.ph === "Bench 6", String(renameOpen.result?.value));
	mark = writes.length;
	await evaluate(`(() => {
		const input = document.querySelector("#detail-list input.hw-cell-rename");
		input.value = "Renamed";
		input.dispatchEvent(new Event("change", { bubbles: true }));
		input.blur();
		// Headless Chrome's unfocused window makes focus()/blur() unreliable
		// (the search-box idiom above): fire the teardown event by hand.
		input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
		return "ok";
	})()`);
	await sleep(700);
	frame = atomic("leg E rename commit", writes.slice(mark));
	check("leg E: exactly the aimed label changed", deepEqual(frame.detailTiles?.[1]?.labels, ["Renamed", ""]), JSON.stringify(frame.detailTiles?.[1]));
	check("leg E: the dressed quad beside it is byte-equal", deepEqual(frame.detailTiles?.[0], { size: 4, labels: ["", "", "MINE", ""], colors: ["#FF00AA", null, null, null], cellLabels: true }), JSON.stringify(frame.detailTiles?.[0]));
	check("leg E: the trailing all-default fill tile pruned", frame.detailTiles?.length === 2, `${frame.detailTiles?.length} entries`);
	check("leg E: keys untouched by a rename", frame.detailKeys?.length === 10, `${frame.detailKeys?.length} keys`);
	check("leg E: the chip repainted renamed", (await evaluate(`(() => {
		const name = document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:6"] .hw-set-name');
		return JSON.stringify({ cls: name?.classList.contains("renamed"), text: name?.textContent });
	})()`)).result?.value === JSON.stringify({ cls: true, text: "Renamed" }));

	// Leg F: Enter with the value untouched abandons the rename: no frame,
	// the span restored.
	await evaluate(`document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:7"] .hw-set-name')?.click()`);
	mark = writes.length;
	await evaluate(`(() => {
		const input = document.querySelector("#detail-list input.hw-cell-rename");
		if (!input) return "no input";
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); // headless blur stand-in
		return "ok";
	})()`);
	await sleep(500);
	check("leg F: abandoning a rename wrote nothing", writes.length === mark, `${writes.length - mark} frames`);
	check("leg F: the span came back untouched", (await evaluate(`(() => {
		const chip = document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:7"]');
		return chip?.querySelector("input.hw-cell-rename") === null && chip?.querySelector(".hw-set-name")?.textContent === "Bench 7";
	})()`)).result?.value === true);

	// Leg G: drag reorder pins the midpoint decision and the to - 1 insert
	// correction; the ghost appends; the arrow cross-checks the same order.
	check("leg G: the ghost tile guards the full walk", (await evaluate(`document.querySelector("#detail-list .hw-tile.ghost") !== null`)).result?.value === true);
	const dragDrop = async (srcKey, targetSel, side) =>
		(await evaluate(`(() => {
			const src = document.querySelector('#detail-list .hw-set-chip[data-key="${srcKey}"]');
			const target = document.querySelector('${targetSel}');
			if (!src || !target) return "missing";
			const dt = new DataTransfer();
			src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
			const r = target.getBoundingClientRect();
			const x = ${JSON.stringify("left")} === "${side}" ? r.left + 2 : r.right - 2;
			target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: r.top + 2 }));
			src.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
			return "ok";
		})()`)).result?.value;
	mark = writes.length;
	check("leg G1: dropped before the midpoint", (await dragDrop("twin:1:1", '#detail-list .hw-set-chip[data-key="bench:0:6"]', "left")) === "ok");
	await sleep(700);
	frame = atomic("leg G1 drop-before", writes.slice(mark));
	check("leg G1: inserted before the target", deepEqual(frame.detailKeys, ["bench:0:0", "bench:0:2", "bench:0:3", "bench:0:1", "twin:1:1", "bench:0:6", "bench:0:7", "bench:0:8", "bench:0:4", "twin:1:0"]), JSON.stringify(frame.detailKeys));
	mark = writes.length;
	check("leg G2: dropped after the midpoint moving forward", (await dragDrop("bench:0:0", '#detail-list .hw-set-chip[data-key="bench:0:3"]', "right")) === "ok");
	await sleep(700);
	frame = atomic("leg G2 drop-after", writes.slice(mark));
	check("leg G2: the to - 1 correction landed it after the target", deepEqual(frame.detailKeys, ["bench:0:2", "bench:0:3", "bench:0:0", "bench:0:1", "twin:1:1", "bench:0:6", "bench:0:7", "bench:0:8", "bench:0:4", "twin:1:0"]), JSON.stringify(frame.detailKeys));
	mark = writes.length;
	check("leg G3: dropped on the ghost tile", (await dragDrop("bench:0:2", "#detail-list .hw-tile.ghost", "left")) === "ok");
	await sleep(700);
	frame = atomic("leg G3 ghost append", writes.slice(mark));
	check("leg G3: the ghost appends to the end", frame.detailKeys?.at(-1) === "bench:0:2", JSON.stringify(frame.detailKeys?.slice(-2)));
	mark = writes.length;
	await evaluate(`document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:2"] .hw-detail-move[data-move="-1"]')?.click()`);
	await sleep(700);
	frame = atomic("leg G4 arrow move", writes.slice(mark));
	check("leg G4: the arrow swaps the same order", frame.detailKeys?.[8] === "bench:0:2" && frame.detailKeys?.[9] === "twin:1:0", JSON.stringify(frame.detailKeys?.slice(-2)));

	// Leg H: the aim's placeholder survives a list close (outside click).
	// The collector never holds a selection, so showSelection's generic
	// reset must leave its placeholder alone: only the HTML resting text
	// and armDetailAdd own it.
	await openCollector();
	mark = writes.length;
	check("leg H: armed tile 2's +", (await clickAdd("1")) === "ok");
	await sleep(400);
	check("leg H: aim names tile 2", (await placeholderNow()) === "Adding into tile 2; click its + again to finish.", await placeholderNow());
	await evaluate(`document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
	await sleep(400);
	check("leg H: the outside click closed the list", (await evaluate(`document.getElementById("pickerd-list")?.hidden`)).result?.value === true);
	check("leg H: the close kept the aim's placeholder", (await placeholderNow()) === "Adding into tile 2; click its + again to finish.", await placeholderNow());
	check("leg H: the armed marker survived the close", (await evaluate(`document.querySelector('#detail-list .hw-add.armed[data-arm="1"]') !== null`)).result?.value === true);
	check("leg H: none of it wrote", writes.length === mark, `${writes.length - mark} frames`);
	await evaluate(`document.querySelector('#detail-list .hw-add.armed')?.click()`);
	await sleep(400);
	check("leg H: manual disarm restored the resting text", (await placeholderNow()) === "Search sensors to add…", await placeholderNow());

	// Leg I: an edit that consumes the aimed tile disarms the aim, so the
	// placeholder never claims a tile the walk no longer has (the shrink
	// branch used to leave detailArm dangling past the end).
	await openCollector();
	mark = writes.length;
	await evaluate(`document.querySelector('#pickerd-list .hw-row[data-key="cpu:0:1"] .hw-tick')?.click()`);
	await sleep(700);
	frame = atomic("leg I seed pick", writes.slice(mark));
	check("leg I: the pick opened a fourth tile", frame.detailKeys?.length === 11 && frame.detailKeys?.at(-1) === "cpu:0:1", JSON.stringify(frame.detailKeys?.slice(-2)));
	check("leg I: armed the fourth tile's +", (await clickAdd("3")) === "ok");
	await sleep(400);
	check("leg I: aim names tile 4", (await placeholderNow()) === "Adding into tile 4; click its + again to finish.", await placeholderNow());
	mark = writes.length;
	check("leg I: × on the aimed tile's only chip", (await clickChipRemove("cpu:0:1")) === "ok");
	await sleep(700);
	frame = atomic("leg I aimed-tile removal", writes.slice(mark));
	check("leg I: no armed marker outlives the vanished tile", (await evaluate(`document.querySelector('#detail-list .hw-add.armed') === null`)).result?.value === true);
	check("leg I: the placeholder dropped the stale claim", (await placeholderNow()) === "Search sensors to add…", await placeholderNow());
	mark = writes.length;
	await evaluate(`document.querySelector('#pickerd-list .hw-row[data-key="gpu:0:0"] .hw-tick')?.click()`);
	await sleep(700);
	frame = atomic("leg I follow-up pick", writes.slice(mark));
	check("leg I: the next pick appends at the end, not into a ghost aim", frame.detailKeys?.length === 11 && frame.detailKeys?.at(-1) === "gpu:0:0", JSON.stringify(frame.detailKeys?.slice(-2)));

	// ---- run 3b: the Tile shows change regroups the walk live (leg J) ----
	// The density select used to change only the STORED setting: the walk
	// kept its old grouping until a reload, and the next removal persisted
	// a plan built from the stale density (an empty plan here). The select
	// must re-render the walk in place, and the removal must shrink the
	// tile the NEW walk holds the reading in.
	await fetch(`http://127.0.0.1:${HTTP_PORT}/seed/density`);
	await cdp("Page.navigate", { url: `http://127.0.0.1:${HTTP_PORT}/ui/sensor-reading.html` });
	await sleep(3500);
	check("leg J: opening wrote nothing", writes.length === 0, `${writes.length} writes`);
	const tileSizesNow = `JSON.stringify(Array.from(document.querySelectorAll("#detail-list .hw-tile:not(.ghost) .hw-tile-size")).map((b) => b.textContent))`;
	const densityBefore = (await evaluate(tileSizesNow)).result?.value;
	check("leg J: density 1 walks four x1 tiles", densityBefore === JSON.stringify(["×1", "×1", "×1", "×1"]), String(densityBefore));
	mark = writes.length;
	await setSelect("detailDensity", "4");
	await waitDom(
		"leg J: the walk regrouped to ONE x4 tile without a reload",
		`(() => { const s = Array.from(document.querySelectorAll("#detail-list .hw-tile:not(.ghost) .hw-tile-size")).map((b) => b.textContent); return s.length === 1 && s[0] === "×4"; })()`,
		2000,
		tileSizesNow
	);
	await sleep(700); // the select's own settings write settles
	const densityFresh = writes.slice(mark);
	check("leg J: the density edit produced a write", densityFresh.length >= 1, `${densityFresh.length} writes`);
	const densityLast = writes.at(-1) ?? {};
	check("leg J: the density landed", densityLast.detailDensity === "4", JSON.stringify(densityLast.detailDensity));
	check("leg J: unknown nested field preserved", deepEqual(densityLast.futureBlob, FUTURE_BLOB), JSON.stringify(densityLast.futureBlob));
	mark = writes.length;
	check("leg J: × on the second cell of the regrouped quad", (await clickChipRemove("bench:0:1")) === "ok");
	await sleep(700);
	frame = atomic("leg J removal", writes.slice(mark));
	check("leg J: the removal persisted the REGROUPED plan", deepEqual(frame.detailTiles, [{ size: 3, labels: ["", "", ""], colors: [null, null, null], cellLabels: true }]), JSON.stringify(frame.detailTiles));
	check("leg J: key left the list", deepEqual(frame.detailKeys, ["bench:0:0", "bench:0:2", "bench:0:3"]), JSON.stringify(frame.detailKeys));

	// ---- run 3c: a walk reshape must never outlive the aim (legs J2-J5) --
	// The disarm lived only in writeDetailState's past-end check, so the
	// Tile shows select (followSetting -> adoptDetailUniform, no funnel)
	// left a stale aim promising a tile the walk no longer had, and
	// growing the aimed tile itself into a FULL quad passed the past-end
	// check while no render paints a full quad's landing: the next pick
	// then landed somewhere the panel never showed.
	await fetch(`http://127.0.0.1:${HTTP_PORT}/seed/density`);
	await cdp("Page.navigate", { url: `http://127.0.0.1:${HTTP_PORT}/ui/sensor-reading.html` });
	await sleep(3500);
	check("leg J2: opening wrote nothing", writes.length === 0, `${writes.length} writes`);
	check("leg J2: armed tile 4's +", (await clickAdd("3")) === "ok");
	await sleep(400);
	check("leg J2: aim names tile 4", (await placeholderNow()) === "Adding into tile 4; click its + again to finish.", await placeholderNow());
	mark = writes.length;
	await setSelect("detailDensity", "4");
	await waitDom(
		"leg J2: the walk regrouped to ONE x4 tile",
		`(() => { const s = Array.from(document.querySelectorAll("#detail-list .hw-tile:not(.ghost) .hw-tile-size")).map((b) => b.textContent); return s.length === 1 && s[0] === "×4"; })()`,
		2000,
		tileSizesNow
	);
	await sleep(700);
	check("leg J2: the reshape disarmed the dangling aim", (await placeholderNow()) === "Search sensors to add…", await placeholderNow());
	check("leg J2: no armed marker after the reshape", (await evaluate(`document.querySelector('#detail-list .hw-add.armed') === null`)).result?.value === true);
	check("leg J2: the disarm itself wrote only the density edit", writes.slice(mark).every((w) => w.detailDensity === "4"), JSON.stringify(writes.slice(mark).length));

	// Leg J3: the funnel's own edit can make the aimed tile unpaintable.
	// Grow the aimed tile to a full quad through its size button; the aim
	// must disarm the moment its landing stops being painted, and the next
	// pick must append at the end, not splice invisibly into the quad.
	await openCollector();
	mark = writes.length;
	await evaluate(`document.querySelector('#pickerd-list .hw-row[data-key="cpu:0:1"] .hw-tick')?.click()`);
	await sleep(700);
	frame = atomic("leg J3 seed pick", writes.slice(mark));
	check("leg J3: the seed pick appended", frame.detailKeys?.length === 5 && frame.detailKeys?.at(-1) === "cpu:0:1", JSON.stringify(frame.detailKeys));
	await setSelect("detailDensity", "1");
	await sleep(700);
	check("leg J3: armed tile 1's +", (await clickAdd("0")) === "ok");
	await sleep(400);
	check("leg J3: aim names tile 1", (await placeholderNow()) === "Adding into tile 1; click its + again to finish.", await placeholderNow());
	const clickSize = `(() => { const b = document.querySelector('#detail-list .hw-tile:not(.ghost) .hw-tile-size'); if (!b) return "missing"; b.click(); return "ok"; })()`;
	for (let grow = 0; grow < 3; grow++) {
		check(`leg J3: size cycle click ${grow + 1}`, (await evaluate(clickSize)).result?.value === "ok");
		await sleep(500);
	}
	check(
		"leg J3: tile 1 grew to a full quad",
		(await evaluate(`document.querySelector('#detail-list .hw-tile:not(.ghost) .hw-tile-size')?.textContent`)).result?.value === "×4",
		String((await evaluate(`document.querySelector('#detail-list .hw-tile:not(.ghost) .hw-tile-size')?.textContent`)).result?.value)
	);
	check("leg J3: the full-quad growth disarmed the aim", (await placeholderNow()) === "Search sensors to add…", await placeholderNow());
	mark = writes.length;
	await evaluate(`document.querySelector('#pickerd-list .hw-row[data-key="gpu:0:0"] .hw-tick')?.click()`);
	await sleep(700);
	frame = atomic("leg J3 follow-up pick", writes.slice(mark));
	check(
		"leg J3: the pick landed at the end, not inside the quad",
		frame.detailKeys?.length === 6 && frame.detailKeys?.at(-1) === "gpu:0:0",
		JSON.stringify(frame.detailKeys)
	);

	// Leg J4: the arrows are the declared keyboard affordance, and every
	// move re-render used to drop focus on body, so chained single-key
	// moves were impossible. After a move, focus must sit on the landed
	// chip's same-direction arrow.
	mark = writes.length;
	const moveResult = (await evaluate(`(() => {
		const arrow = document.querySelector('#detail-list .hw-set-chip[data-key="gpu:0:0"] .hw-detail-move[data-move="-1"]');
		if (!arrow || arrow.disabled) return "missing";
		arrow.focus();
		arrow.click();
		return "ok";
	})()`)).result?.value;
	check("leg J4: clicked gpu:0:0's up arrow", moveResult === "ok", String(moveResult));
	await sleep(700);
	frame = atomic("leg J4 move", writes.slice(mark));
	check("leg J4: the move landed", frame.detailKeys?.at(-2) === "gpu:0:0", JSON.stringify(frame.detailKeys?.slice(-3)));
	const focusNow = (await evaluate(`(() => {
		const a = document.activeElement;
		if (!a || a === document.body) return "body";
		if (!a.classList?.contains("hw-detail-move")) return a.tagName + "." + a.className;
		const chip = a.closest(".hw-set-chip");
		return (chip?.dataset.key ?? "?") + ":" + a.dataset.move + (a.disabled ? ":disabled" : "");
	})()`)).result?.value;
	check("leg J4: focus survived onto the landed chip's arrow", focusNow === "gpu:0:0:-1", String(focusNow));

	// Leg J5: the bespoke editor must speak to assistive tech: arrows and
	// removes name their reading, the armed + exposes its state, the list
	// note announces itself, and renaming works from the keyboard.
	const arrowLabel = (await evaluate(`document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:1"] .hw-detail-move[data-move="-1"]')?.getAttribute("aria-label") ?? "none"`)).result?.value;
	check("leg J5: the up arrow names its reading", typeof arrowLabel === "string" && arrowLabel !== "none" && arrowLabel.length > 3 && arrowLabel !== "↑", String(arrowLabel));
	const removeLabel = (await evaluate(`document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:1"] .hw-set-remove')?.getAttribute("aria-label") ?? "none"`)).result?.value;
	check("leg J5: the remove names its reading", typeof removeLabel === "string" && removeLabel !== "none" && removeLabel.length > 3 && removeLabel !== "×", String(removeLabel));
	check("leg J5: armed tile 2's +", (await clickAdd("1")) === "ok");
	await sleep(400);
	const pressedArmed = (await evaluate(`document.querySelector('#detail-list .hw-add.armed')?.getAttribute("aria-pressed") ?? "none"`)).result?.value;
	check("leg J5: the armed + says aria-pressed", pressedArmed === "true", String(pressedArmed));
	check("leg J5: disarmed again", (await clickAdd("1")) === "ok");
	await sleep(400);
	const noteLive = (await evaluate(`document.querySelector('#detail-list .hw-set-note')?.getAttribute("aria-live") ?? "none"`)).result?.value;
	check("leg J5: the list note is a live region", noteLive === "polite", String(noteLive));
	// Leg J6: a whole tile drags (and arrow-keys) as one unit: its members
	// travel as a run, its dressing travels with them, a partial spec
	// shrinks to what it fills instead of swallowing a neighbor's head,
	// and a standing aim (tile indices now mean different tiles) disarms.
	// State here: keys [b0..b3, gpu:0:0, cpu:0:1], density 1, plan [x4],
	// so the walk is [x4(b0-b3), x1(gpu), x1(cpu)].
	const tileDrag = async (fromIdx, targetIdx, half) =>
		(await evaluate(`(() => {
			const tiles = document.querySelectorAll("#detail-list .hw-tile:not(.ghost)");
			const grip = tiles[${fromIdx}]?.querySelector(".hw-tile-grip");
			const target = tiles[${targetIdx}];
			if (!grip || !target) return "missing";
			const dt = new DataTransfer();
			grip.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
			const r = target.getBoundingClientRect();
			const y = ${JSON.stringify("top")} === "${half}" ? r.top + 1 : r.bottom - 1;
			target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 4, clientY: y }));
			grip.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
			return "ok";
		})()`)).result?.value;
	mark = writes.length;
	check("leg J6: dragged the quad tile below the last tile", (await tileDrag(0, 2, "bottom")) === "ok");
	await sleep(700);
	frame = atomic("leg J6 tile drop", writes.slice(mark));
	check("leg J6: the run moved as one unit", deepEqual(frame.detailKeys, ["gpu:0:0", "cpu:0:1", "bench:0:0", "bench:0:1", "bench:0:2", "bench:0:3"]), JSON.stringify(frame.detailKeys));
	check(
		"leg J6: the dressing traveled with its members",
		Array.isArray(frame.detailTiles) && frame.detailTiles.length === 3 && frame.detailTiles[2]?.size === 4,
		JSON.stringify(frame.detailTiles?.map((t) => t.size))
	);
	mark = writes.length;
	const gripMove = (await evaluate(`(() => {
		const tiles = document.querySelectorAll("#detail-list .hw-tile:not(.ghost)");
		const grip = tiles[2]?.querySelector(".hw-tile-grip");
		if (!grip) return "missing";
		grip.focus();
		grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
		return "ok";
	})()`)).result?.value;
	check("leg J6: ArrowUp on the quad's grip", gripMove === "ok");
	await sleep(700);
	frame = atomic("leg J6 keyboard move", writes.slice(mark));
	check("leg J6: the arrow moved the whole tile up", deepEqual(frame.detailKeys, ["gpu:0:0", "bench:0:0", "bench:0:1", "bench:0:2", "bench:0:3", "cpu:0:1"]), JSON.stringify(frame.detailKeys));
	const gripFocus = (await evaluate(`(() => {
		const a = document.activeElement;
		if (!a?.classList?.contains("hw-tile-grip")) return "not a grip";
		const tiles = [...document.querySelectorAll("#detail-list .hw-tile:not(.ghost)")];
		return "tile " + tiles.indexOf(a.closest(".hw-tile"));
	})()`)).result?.value;
	check("leg J6: focus followed onto the moved tile's grip", gripFocus === "tile 1", String(gripFocus));
	check("leg J6: armed tile 1's +", (await clickAdd("0")) === "ok");
	await sleep(400);
	check("leg J6: aim names tile 1", (await placeholderNow()) === "Adding into tile 1; click its + again to finish.", await placeholderNow());
	await evaluate(`(() => {
		const tiles = document.querySelectorAll("#detail-list .hw-tile:not(.ghost)");
		tiles[1]?.querySelector(".hw-tile-grip")?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
	})()`);
	await sleep(700);
	check("leg J6: the tile move disarmed the standing aim", (await placeholderNow()) === "Search sensors to add…", await placeholderNow());

	const cellRenameOpen = (await evaluate(`(() => {
		const name = document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:1"] .hw-set-name');
		if (!name) return "missing";
		if (name.tabIndex !== 0) return "not focusable (tabIndex " + name.tabIndex + ")";
		name.focus();
		name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		const input = document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:1"] input.hw-cell-rename');
		return input !== null ? "ok" : "no rename input";
	})()`)).result?.value;
	check("leg J5: Enter on the name opens the rename input", cellRenameOpen === "ok", String(cellRenameOpen));
	await evaluate(`document.querySelector('#detail-list input.hw-cell-rename')?.blur()`);
	await sleep(400);

	// ---- run 4: the 128-reading cap refuses loudly -----------------------
	// At the cap the tick's native flip must not survive as a lying
	// checkbox (the add was refused and nothing re-rendered), and the
	// list note names the cap; freeing one slot lands the same tick.
	await fetch(`http://127.0.0.1:${HTTP_PORT}/seed/cap`);
	await cdp("Page.navigate", { url: `http://127.0.0.1:${HTTP_PORT}/ui/sensor-reading.html` });
	await sleep(3500);
	check("cap: opening wrote nothing", writes.length === 0, `${writes.length} writes`);
	const capNote = (await evaluate(`document.querySelector("#detail-list .hw-set-note")?.textContent ?? "gone"`)).result?.value;
	check("cap: the list note names the cap", String(capNote).includes("That is the cap"), String(capNote));
	await openCollector();
	mark = writes.length;
	const capTick = await evaluate(`(() => {
		const tick = document.querySelector('#pickerd-list .hw-row[data-key="bench:0:0"] .hw-tick');
		if (!tick) return "missing";
		if (tick.checked) return "already checked";
		tick.click();
		return "ok";
	})()`);
	check("cap: ticked a new reading at the cap", capTick.result?.value === "ok", String(capTick.result?.value));
	await sleep(700);
	check("cap: the refused add wrote nothing", writes.length === mark, `${writes.length - mark} frames`);
	const capBox = await evaluate(`document.querySelector('#pickerd-list .hw-row[data-key="bench:0:0"] .hw-tick')?.checked`);
	check("cap: the refused tick repainted unchecked", capBox.result?.value === false, String(capBox.result?.value));
	mark = writes.length;
	check("cap: removed one chip", (await clickChipRemove("cap:0:5")) === "ok");
	await sleep(700);
	frame = atomic("cap removal", writes.slice(mark));
	check("cap: 127 left", frame.detailKeys?.length === 127, `${frame.detailKeys?.length} keys`);
	mark = writes.length;
	await evaluate(`document.querySelector('#pickerd-list .hw-row[data-key="bench:0:0"] .hw-tick')?.click()`);
	await sleep(700);
	frame = atomic("cap re-add", writes.slice(mark));
	check("cap: the freed slot took the tick", frame.detailKeys?.length === 128 && frame.detailKeys?.includes("bench:0:0"), `${frame.detailKeys?.length} keys`);
	const capNote2 = (await evaluate(`document.querySelector("#detail-list .hw-set-note")?.textContent ?? "gone"`)).result?.value;
	check("cap: back at the cap the note says so again", String(capNote2).includes("That is the cap"), String(capNote2));

	// ---- run 5: the tile-plan mirror rejects what the plugin parser rejects
	// detailTilesOf takes labels/colors only as ARRAYS; a hand-edited string
	// or object must salvage to "no overrides" in the panel too, or the
	// chips wear renames and colors the deck never renders.
	await fetch(`http://127.0.0.1:${HTTP_PORT}/seed/salvage`);
	await cdp("Page.navigate", { url: `http://127.0.0.1:${HTTP_PORT}/ui/sensor-reading.html` });
	await sleep(3500);
	check("salvage: opening wrote nothing", writes.length === 0, `${writes.length} writes`);
	const salvage = JSON.parse(
		(await evaluate(`JSON.stringify({
		renamed: document.querySelectorAll("#detail-list .hw-set-name.renamed").length,
		first: document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:0"] .hw-set-name')?.textContent ?? "gone",
		well: document.querySelector("#detail-list .hw-tile-color")?.value ?? "gone"
	})`)).result?.value ?? "{}"
	);
	check("salvage: a labels string yields no renamed chips", salvage.renamed === 0, `${salvage.renamed} renamed`);
	check("salvage: the chip keeps the reading's own label", salvage.first === "Bench 0", String(salvage.first));
	check("salvage: a colors object yields the default well", salvage.well === "#4cc2ff", String(salvage.well));

	// ---- run 6: an adopted primary parks OUTSIDE the walk (leg K.1) ------
	// The opener's own sensor can sit in detailKeys (hand-edited settings,
	// or the opener re-picked onto a listed reading). The deck shows it on
	// the Back tile and lists only the rest, so the panel must park that
	// chip outside the tiles, flow the dressing over the LISTED readings
	// only, count only them, aim renames at the walk's own cells, and let
	// the parked chip's removal leave the plan untouched.
	await fetch(`http://127.0.0.1:${HTTP_PORT}/seed/adopted`);
	await cdp("Page.navigate", { url: `http://127.0.0.1:${HTTP_PORT}/ui/sensor-reading.html` });
	await sleep(3500);
	check("adopted: opening wrote nothing", writes.length === 0, `${writes.length} writes`);
	const adopted = JSON.parse(
		(await evaluate(`JSON.stringify((() => {
		const chip = (k) => document.querySelector('#detail-list .hw-set-chip[data-key="' + k + '"]');
		const cell = (k) => {
			const c = chip(k);
			const n = c?.querySelector(".hw-set-name");
			return c ? { tile: c.dataset.tile, cell: c.dataset.cell, text: n?.textContent, renamed: n?.classList.contains("renamed"), inTile: c.closest(".hw-tile") !== null } : null;
		};
		const parked = chip("bench:0:0");
		return {
			a: cell("bench:0:1"), b: cell("bench:0:2"), c: cell("bench:0:3"),
			parkedInTile: parked === null ? "gone" : parked.closest(".hw-tile") !== null,
			parkedMark: parked?.querySelector(".hw-set-name")?.textContent ?? "gone",
			parkedRemovable: Array.from(parked?.querySelectorAll("button") ?? []).some((b) => (b.title ?? "").startsWith("Remove")),
			note: document.querySelector("#detail-list .hw-set-note")?.textContent ?? "gone"
		};
	})())`)).result?.value ?? "{}"
	);
	check("adopted: tile 1 wears [L1, L2] over the listed readings", deepEqual(adopted.a, { tile: "0", cell: "0", text: "L1", renamed: true, inTile: true }) && deepEqual(adopted.b, { tile: "0", cell: "1", text: "L2", renamed: true, inTile: true }), JSON.stringify([adopted.a, adopted.b]));
	check("adopted: tile 2 holds the third listed reading as L3", deepEqual(adopted.c, { tile: "1", cell: "0", text: "L3", renamed: true, inTile: true }), JSON.stringify(adopted.c));
	check("adopted: the primary's chip is parked outside every tile", adopted.parkedInTile === false, JSON.stringify(adopted.parkedInTile));
	check("adopted: the parked chip wears the Back-tile mark", String(adopted.parkedMark).includes("(Back tile)"), String(adopted.parkedMark));
	check("adopted: the parked chip stays removable", adopted.parkedRemovable === true, JSON.stringify(adopted.parkedRemovable));
	check("adopted: the note counts listed readings only", String(adopted.note).startsWith("3 readings across 2 tiles"), String(adopted.note));

	// Renaming the first LISTED chip must write labels[0]: counting the
	// parked primary as tile 1 cell 0 used to shove the rename into
	// labels[1] and dress the wrong cell on the deck.
	const adoptedRename = await evaluate(`(() => {
		const name = document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:1"] .hw-set-name');
		if (!name) return "missing";
		name.click();
		const input = document.querySelector("#detail-list input.hw-cell-rename");
		if (!input) return "no input";
		return JSON.stringify({ tile: input.dataset.tile, cell: input.dataset.cell });
	})()`);
	const adoptedRenameState = JSON.parse(adoptedRename.result?.value?.startsWith("{") ? adoptedRename.result.value : "{}");
	check("adopted: the rename input plumbs tile 0 cell 0, not the parked offset", adoptedRenameState.tile === "0" && adoptedRenameState.cell === "0", String(adoptedRename.result?.value));
	mark = writes.length;
	await evaluate(`(() => {
		const input = document.querySelector("#detail-list input.hw-cell-rename");
		if (!input) return "no input";
		input.value = "Renamed A";
		input.dispatchEvent(new Event("change", { bubbles: true }));
		input.blur();
		input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); // headless blur stand-in
		return "ok";
	})()`);
	await sleep(700);
	frame = atomic("adopted rename", writes.slice(mark));
	check("adopted: the rename landed on labels[0]", deepEqual(frame.detailTiles?.[0], { size: 2, labels: ["Renamed A", "L2"], colors: [null, null], cellLabels: true }), JSON.stringify(frame.detailTiles?.[0]));
	check("adopted: the second tile is byte-equal", deepEqual(frame.detailTiles?.[1], { size: 2, labels: ["L3", "L4"], colors: [null, null], cellLabels: true }), JSON.stringify(frame.detailTiles?.[1]));
	check("adopted: the parked key stays in the stored list", frame.detailKeys?.length === 4 && frame.detailKeys?.[0] === "bench:0:0", JSON.stringify(frame.detailKeys));

	// Removing the PARKED chip edits the list only: no tile held it, so
	// shrinking tile 1 for it (the pre-fix behavior) stole a cell from a
	// listed reading.
	mark = writes.length;
	const parkedRemove = await evaluate(`(() => {
		const chip = document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:0"]');
		const x = Array.from(chip?.querySelectorAll("button") ?? []).find((b) => (b.title ?? "").startsWith("Remove"));
		if (!x) return "missing";
		x.click();
		return "ok";
	})()`);
	check("adopted: removed the parked chip", parkedRemove.result?.value === "ok", String(parkedRemove.result?.value));
	await sleep(700);
	frame = atomic("adopted parked removal", writes.slice(mark));
	check("adopted: the plan rode through byte-identical", deepEqual(frame.detailTiles, [{ size: 2, labels: ["Renamed A", "L2"], colors: [null, null], cellLabels: true }, { size: 2, labels: ["L3", "L4"], colors: [null, null], cellLabels: true }]), JSON.stringify(frame.detailTiles));
	check("adopted: only the parked key left the list", deepEqual(frame.detailKeys, ["bench:0:1", "bench:0:2", "bench:0:3"]), JSON.stringify(frame.detailKeys));

	// ---- run 7: a live primary re-pick moves the Back-tile gates (leg K.2)
	// Re-picking the opener's sensor onto a listed reading used to leave
	// the panel's primary stale until a reload: the "(Back tile)" mark
	// never moved, the old primary's collector row stayed locked and the
	// new primary's stayed tickable. The pick must move mark and gates in
	// place.
	await fetch(`http://127.0.0.1:${HTTP_PORT}/seed/repick`);
	await cdp("Page.navigate", { url: `http://127.0.0.1:${HTTP_PORT}/ui/sensor-reading.html` });
	await sleep(3500);
	check("repick: opening wrote nothing", writes.length === 0, `${writes.length} writes`);
	check("repick: no chip wears the Back-tile mark yet", (await evaluate(`Array.from(document.querySelectorAll("#detail-list .hw-set-name")).every((n) => !(n.textContent ?? "").includes("(Back tile)"))`)).result?.value === true);
	const repickGates = async () =>
		JSON.parse(
			(await evaluate(`JSON.stringify(["bench:0:9", "bench:0:2"].map((k) => {
			const t = document.querySelector('#pickerd-list .hw-row[data-key="' + k + '"] .hw-tick');
			return t === null ? "gone" : { checked: t.checked, disabled: t.disabled };
		}))`)).result?.value ?? "[]"
		);
	await openCollector();
	let gates = await repickGates();
	check("repick: the seeded primary's row starts locked", deepEqual(gates[0], { checked: true, disabled: true }), JSON.stringify(gates[0]));
	check("repick: the listed reading's row starts tickable", deepEqual(gates[1], { checked: true, disabled: false }), JSON.stringify(gates[1]));

	mark = writes.length;
	const repickOpen = await evaluate(`(() => {
		const input = document.getElementById("picker-search");
		if (!input) return "no search input";
		input.focus();
		input.dispatchEvent(new Event("focus")); // headless focus stand-in
		return "ok";
	})()`);
	check("repick: primary picker opened", repickOpen.result?.value === "ok", String(repickOpen.result?.value));
	await sleep(600);
	const repickRow = await evaluate(`(() => {
		const row = document.querySelector('#picker-list .hw-row[data-key="bench:0:2"]');
		if (!row) return "missing";
		row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
		return "ok";
	})()`);
	check("repick: picked a listed reading as the primary", repickRow.result?.value === "ok", String(repickRow.result?.value));
	await waitDom(
		"repick: the Back-tile mark moved to the new primary's chip",
		`(() => { const n = document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:2"] .hw-set-name'); return n !== null && n.textContent.includes("(Back tile)"); })()`,
		1200,
		`document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:2"] .hw-set-name')?.textContent ?? "gone"`
	);
	await sleep(700); // the pick's settings write settles
	const repickFresh = writes.slice(mark);
	check("repick: the pick produced a write", repickFresh.length >= 1, `${repickFresh.length} writes`);
	const repickLast = writes.at(-1) ?? {};
	check("repick: the pick wrote readingKey", repickLast.readingKey === "bench:0:2", JSON.stringify(repickLast.readingKey));
	check("repick: the pick left the list alone", deepEqual(repickLast.detailKeys, ["bench:0:1", "bench:0:2", "bench:0:3"]), JSON.stringify(repickLast.detailKeys));
	check("repick: unknown nested field preserved", deepEqual(repickLast.futureBlob, FUTURE_BLOB), JSON.stringify(repickLast.futureBlob));

	await openCollector();
	gates = await repickGates();
	check("repick: the OLD primary's row unlocked", deepEqual(gates[0], { checked: false, disabled: false }), JSON.stringify(gates[0]));
	check("repick: the NEW primary's row is fixed on", deepEqual(gates[1], { checked: true, disabled: true }), JSON.stringify(gates[1]));
	mark = writes.length;
	await evaluate(`document.querySelector('#pickerd-list .hw-row[data-key="bench:0:2"] .hw-tick')?.click()`);
	await sleep(500);
	check("repick: ticking the new primary is refused", writes.length === mark, `${writes.length - mark} frames`);

	// ---- run 8: the dial panel tells the runtime truth -------------------
	// Custom preset + two touch zones is the dead-tap configuration
	// (gestures.ts maps the whole strip to left/right), and the overview
	// view draws no bar for the alert placeholders to promise. The panel
	// must say both; a zero-write open stays law on this PI too.
	await fetch(`http://127.0.0.1:${HTTP_PORT}/seed/dial`);
	await cdp("Page.navigate", { url: `http://127.0.0.1:${HTTP_PORT}/ui/sensor-dial.html` });
	await sleep(3500);
	check("dial: opening the panel wrote nothing", writes.length === 0, `${writes.length} writes`);
	const dialTruth = JSON.parse(
		(await evaluate(`JSON.stringify({
		zonesHelp: document.querySelector("#controls-zones .hw-help")?.textContent ?? null,
		zonesShown: document.getElementById("controls-zones")?.hidden === false,
		warnPlaceholder: document.querySelector('sdpi-textfield[setting="warnValue"]')?.getAttribute("placeholder") ?? "gone",
		rotationHelp: document.getElementById("rotation-help")?.textContent ?? "gone"
	})`)).result?.value ?? "{}"
	);
	check("dial: touch zones are visible under the custom preset", dialTruth.zonesShown === true, JSON.stringify(dialTruth.zonesShown));
	check("dial: the zones help names the dead tap", typeof dialTruth.zonesHelp === "string" && /tap/i.test(dialTruth.zonesHelp), String(dialTruth.zonesHelp));
	check("dial: overview alert placeholders promise the row value, not a bar", dialTruth.warnPlaceholder === "row value turns amber (display units)", String(dialTruth.warnPlaceholder));
	check("dial: the rotation help states picked order", String(dialTruth.rotationHelp).includes("in the order you tick them"), String(dialTruth.rotationHelp));
} catch (err) {
	console.error("pi-persistence crashed:", err);
	results.errors.push(String(err));
} finally {
	cdpSocket?.terminate();
	killChromeTree();
	server.close();
	wss.close();
}

console.log(results.errors.length === 0 ? "\nPI PERSISTENCE E2E: ALL CHECKS PASSED" : `\nPI PERSISTENCE E2E: ${results.errors.length} FAILURES`);
process.exit(results.errors.length === 0 ? 0 : 1);
