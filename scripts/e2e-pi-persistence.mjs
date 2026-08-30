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
//      moves the Back-tile mark and the collector's gates at once,
//   8. a cell's label and color belong to the CHIP and travel with it
//      through every mover (in-tile drags and arrows, boundary walks,
//      cross-tile grows, full-target parks, dressed ghost leaves), and
//      every pixel of a tile and of the list routes a chip drop to the
//      nearest chip edge instead of a hidden end-of-tile jump.
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
	// The bench case (leg M), reduced to its essentials: a bare-values quad
	// whose only stored dressing is one cell label, so all four chips wear
	// the default identity palette, plus a second quad to walk into.
	bench: {
		readingKey: "cpu:0:0",
		pressBehavior: "open-details",
		detailMode: "custom",
		detailDensity: "4",
		detailKeys: ["bench:0:0", "bench:0:1", "bench:0:2", "bench:0:3", "bench:0:4", "bench:0:5"],
		detailTiles: [{ size: 4, labels: ["Solo", "", "", ""], colors: [null, null, null, null], cellLabels: false }],
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
const globalWrites = []; // every setGlobalSettings payload, same order
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
				// device rides along like the real app sends it: the sdpi
				// client's getSettings filters replies on action, context
				// AND device, and a missing field hangs that promise.
				ws.send(JSON.stringify({ event: "didReceiveSettings", action: "com.lawrensen.hwinfo.reading", context: `ctx-${mode}`, device: "dev1", payload: { settings: store.settings, coordinates: { column: 0, row: 0 } } }));
				break;
			case "setSettings":
				writes.push(structuredClone(msg.payload ?? {}));
				store.settings = msg.payload ?? {};
				break;
			case "getGlobalSettings":
				ws.send(JSON.stringify({ event: "didReceiveGlobalSettings", payload: { settings: { theme: "void" } } }));
				break;
			case "setGlobalSettings":
				globalWrites.push(structuredClone(msg.payload ?? {}));
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
	const seedMatch = url.match(/^\/seed\/(back|plain|dial|grouped|bench|cap|salvage|density|adopted|repick)$/);
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
	check(
		"leg G1: the crossing chip grew its target at the dropped cell and shrank its source",
		deepEqual(frame.detailTiles?.map((t) => t.size), [4, 3, 3]) && deepEqual(frame.detailTiles?.[1]?.labels, ["", "Renamed", ""]),
		JSON.stringify({ sizes: frame.detailTiles?.map((t) => t.size), labels: frame.detailTiles?.[1]?.labels })
	);
	mark = writes.length;
	check("leg G2: dropped after the midpoint moving forward", (await dragDrop("bench:0:0", '#detail-list .hw-set-chip[data-key="bench:0:3"]', "right")) === "ok");
	await sleep(700);
	frame = atomic("leg G2 drop-after", writes.slice(mark));
	check("leg G2: the to - 1 correction landed it after the target", deepEqual(frame.detailKeys, ["bench:0:2", "bench:0:3", "bench:0:0", "bench:0:1", "twin:1:1", "bench:0:6", "bench:0:7", "bench:0:8", "bench:0:4", "twin:1:0"]), JSON.stringify(frame.detailKeys));
	check("leg G2: a move inside one tile left every tile alone", deepEqual(frame.detailTiles?.map((t) => t.size), [4, 3, 3]), JSON.stringify(frame.detailTiles?.map((t) => t.size)));
	// The label and color belong to the CHIP: b0 carried the pink well
	// from cell 0 to cell 2, MINE rode b3 from cell 2 to cell 1, and the
	// two chips that shuffled under them froze the identity colors they
	// were already wearing (cell 1's pink-red onto cell 0, cell 2's green
	// onto cell 1) instead of being recolored by their new cells. Cell 3
	// never changed hands, so it keeps its stored null and renders its own
	// default: an untouched cell is never frozen.
	check(
		"leg G2: the pink, MINE and the worn identity colors traveled with their chips",
		deepEqual(frame.detailTiles?.[0], { size: 4, labels: ["", "MINE", "", ""], colors: ["#FF7E8E", "#38CD89", "#FF00AA", null], cellLabels: true }),
		JSON.stringify(frame.detailTiles?.[0])
	);
	mark = writes.length;
	check(
		"leg G3: dropped the quad's head cell on the last tile's tail chrome",
		(await evaluate(`(() => {
			const chip = document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:2"]');
			const holder = document.querySelectorAll("#detail-list .hw-tile:not(.ghost)")[2];
			if (!chip || !holder) return "missing";
			const dt = new DataTransfer();
			chip.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
			// Bottom-right of the tile: the nearest chip edge is AFTER the
			// last chip, the honest coordinates for "the tile's end".
			const r = holder.getBoundingClientRect();
			holder.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.right - 2, clientY: r.bottom - 2 }));
			chip.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
			return "ok";
		})()`)).result?.value === "ok"
	);
	await sleep(700);
	frame = atomic("leg G3 chrome join", writes.slice(mark));
	check("leg G3: the chip joined the tail tile's end", frame.detailKeys?.at(-1) === "bench:0:2", JSON.stringify(frame.detailKeys?.slice(-2)));
	check(
		"leg G3: the quad shrank keeping MINE and the pink on their chips, and the leaver carried its worn color into the grown tail",
		deepEqual(frame.detailTiles?.map((t) => t.size), [3, 3, 4]) &&
			deepEqual(frame.detailTiles?.[0], { size: 3, labels: ["MINE", "", ""], colors: ["#38CD89", "#FF00AA", null], cellLabels: true }) &&
			deepEqual(frame.detailTiles?.[2], { size: 4, labels: ["", "", "", ""], colors: [null, null, null, "#FF7E8E"], cellLabels: true }),
		JSON.stringify({ sizes: frame.detailTiles?.map((t) => t.size), first: frame.detailTiles?.[0], tail: frame.detailTiles?.[2] })
	);
	check(
		"leg G3: the walk still shows three tiles with a full quad tail",
		(await evaluate(`JSON.stringify(Array.from(document.querySelectorAll("#detail-list .hw-tile:not(.ghost) .hw-tile-size")).map((b) => b.textContent))`)).result?.value === JSON.stringify(["×3", "×3", "×4"]),
		(await evaluate(`JSON.stringify(Array.from(document.querySelectorAll("#detail-list .hw-tile:not(.ghost) .hw-tile-size")).map((b) => b.textContent))`)).result?.value
	);
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

	// ---- run 3b: the dressing belongs to the chip (legs L, L9) ------------
	// A cell's label and color are the CHIP's, not the position's: every
	// mover (in-tile drag, the arrows, a boundary walk, a cross-tile grow,
	// a full-target park, a dressed ghost leave) must carry them with the
	// chip, and every pixel of a tile must route a drop to the nearest
	// chip edge instead of a hidden "end of the tile" jump. Fresh grouped
	// seed: listed [b0..b7], plan [{4, MINE on cell 3, pink on cell 0}],
	// density 4, so the walk is a dressed quad plus a full fill quad.
	await fetch(`http://127.0.0.1:${HTTP_PORT}/seed/grouped`);
	await cdp("Page.navigate", { url: `http://127.0.0.1:${HTTP_PORT}/ui/sensor-reading.html` });
	await sleep(3500);
	check("leg L: opening wrote nothing", writes.length === 0, `${writes.length} writes`);

	// L1: an in-tile chip drop reorders the cells AND their dressing: the
	// pink well rides b0 from cell 0 to cell 3, MINE rides b3 to cell 2,
	// and every chip that shuffles keeps the identity color it was already
	// wearing, so nothing on the tile changes color by being moved past.
	// This is the whole complaint from the bench: the colors used to stay
	// nailed to the cells and cycle through the readings.
	mark = writes.length;
	check("leg L1: dropped the pink chip after MINE's chip", (await dragDrop("bench:0:0", '#detail-list .hw-set-chip[data-key="bench:0:3"]', "right")) === "ok");
	await sleep(700);
	frame = atomic("leg L1 in-tile drop", writes.slice(mark));
	check("leg L1: the cells reordered", deepEqual(frame.detailKeys, ["bench:0:1", "bench:0:2", "bench:0:3", "bench:0:0", "bench:0:4", "bench:0:5", "bench:0:6", "bench:0:7"]), JSON.stringify(frame.detailKeys));
	check(
		"leg L1: no chip changed color, and the pink and MINE traveled with theirs",
		frame.detailTiles?.length === 1 && deepEqual(frame.detailTiles?.[0], { size: 4, labels: ["", "", "MINE", ""], colors: ["#FF7E8E", "#38CD89", "#D4AB33", "#FF00AA"], cellLabels: true }),
		JSON.stringify(frame.detailTiles)
	);

	// L2: the arrows are the same move: dressing travels on a keyboard
	// reorder exactly as on a drag.
	mark = writes.length;
	await evaluate(`document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:0"] .hw-detail-move[data-move="-1"]')?.click()`);
	await sleep(700);
	frame = atomic("leg L2 arrow move", writes.slice(mark));
	check("leg L2: the arrow swapped the neighbors", deepEqual(frame.detailKeys, ["bench:0:1", "bench:0:2", "bench:0:0", "bench:0:3", "bench:0:4", "bench:0:5", "bench:0:6", "bench:0:7"]), JSON.stringify(frame.detailKeys));
	// Only the two swapped cells take traveling dressing; cells 0 and 1
	// never changed hands, so they keep exactly what was stored.
	check(
		"leg L2: the pink followed its chip up, MINE rode the other chip down",
		deepEqual(frame.detailTiles?.[0], { size: 4, labels: ["", "", "", "MINE"], colors: ["#FF7E8E", "#38CD89", "#FF00AA", "#D4AB33"], cellLabels: true }),
		JSON.stringify(frame.detailTiles?.[0])
	);

	// L3: an arrow walking a chip ACROSS the tile boundary swaps the two
	// chips' dressing across the specs: MINE crosses into the fill tile,
	// which materializes to hold it.
	mark = writes.length;
	await evaluate(`document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:3"] .hw-detail-move[data-move="1"]')?.click()`);
	await sleep(700);
	frame = atomic("leg L3 boundary arrow", writes.slice(mark));
	check("leg L3: the chips swapped across the boundary", deepEqual(frame.detailKeys, ["bench:0:1", "bench:0:2", "bench:0:0", "bench:0:4", "bench:0:3", "bench:0:5", "bench:0:6", "bench:0:7"]), JSON.stringify(frame.detailKeys));
	// The two chips trade cells across the boundary and each keeps what it
	// wore: MINE and its yellow cross into the materialized fill, the fill
	// chip carries its blue back into the plan's last cell.
	check(
		"leg L3: MINE and its color crossed into the materialized fill, the incomer carried its own back",
		deepEqual(frame.detailTiles, [
			{ size: 4, labels: ["", "", "", ""], colors: ["#FF7E8E", "#38CD89", "#FF00AA", "#4CC2FF"], cellLabels: true },
			{ size: 4, labels: ["MINE", "", "", ""], colors: ["#D4AB33", null, null, null], cellLabels: true }
		]),
		JSON.stringify(frame.detailTiles)
	);

	// L4: tile chrome is a reorder surface, not a teleport. Dropping a
	// chip beside its own cell writes nothing (the honest no-op), and a
	// drop on the chrome left of the first chip lands BEFORE it, exactly
	// where the caret points, dressing riding along.
	const chromeDrop = async (srcKey, tileIdx) =>
		(await evaluate(`(() => {
			const chip = document.querySelector('#detail-list .hw-set-chip[data-key="${srcKey}"]');
			const tiles = document.querySelectorAll("#detail-list .hw-tile:not(.ghost)");
			const holder = tiles[${tileIdx}];
			const first = holder?.querySelector(".hw-set-chip");
			if (!chip || !holder || !first) return "missing";
			const dt = new DataTransfer();
			chip.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
			// Chrome just left of the first chip: the nearest edge is BEFORE it.
			const r = first.getBoundingClientRect();
			holder.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left - 4, clientY: r.top + 4 }));
			chip.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
			return "ok";
		})()`)).result?.value;
	mark = writes.length;
	check("leg L4: dropped the head chip beside its own cell", (await chromeDrop("bench:0:1", 0)) === "ok");
	await sleep(500);
	check("leg L4: a drop where the chip already sits writes nothing", writes.length === mark, `${writes.length - mark} frames`);
	mark = writes.length;
	check("leg L4: dropped the tail chip on the head chrome", (await chromeDrop("bench:0:4", 0)) === "ok");
	await sleep(700);
	frame = atomic("leg L4 chrome caret", writes.slice(mark));
	check("leg L4: the chip landed at the caret, not the tile's end", deepEqual(frame.detailKeys, ["bench:0:4", "bench:0:1", "bench:0:2", "bench:0:0", "bench:0:3", "bench:0:5", "bench:0:6", "bench:0:7"]), JSON.stringify(frame.detailKeys));
	check(
		"leg L4: every chip kept its own color through the chrome reorder",
		deepEqual(frame.detailTiles?.[0], { size: 4, labels: ["", "", "", ""], colors: ["#4CC2FF", "#FF7E8E", "#38CD89", "#FF00AA"], cellLabels: true }),
		JSON.stringify(frame.detailTiles?.[0])
	);

	// L5: a full target parks the chip beside it as its own one-cell tile,
	// and the park CARRIES the chip's color instead of shedding it.
	mark = writes.length;
	check(
		"leg L5: dropped the pink chip on the full quad's tail chrome",
		(await evaluate(`(() => {
			const chip = document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:0"]');
			const holder = document.querySelectorAll("#detail-list .hw-tile:not(.ghost)")[1];
			if (!chip || !holder) return "missing";
			const dt = new DataTransfer();
			chip.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
			const r = holder.getBoundingClientRect();
			holder.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.right - 2, clientY: r.bottom - 2 }));
			chip.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
			return "ok";
		})()`)).result?.value === "ok"
	);
	await sleep(700);
	frame = atomic("leg L5 dressed park", writes.slice(mark));
	check("leg L5: the chip parked just past the quad", deepEqual(frame.detailKeys, ["bench:0:4", "bench:0:1", "bench:0:2", "bench:0:3", "bench:0:5", "bench:0:6", "bench:0:7", "bench:0:0"]), JSON.stringify(frame.detailKeys));
	// The source quad drops to three cells and stops rendering identity
	// colors; the frozen values stay stored against the day it grows back.
	check(
		"leg L5: the park kept the pink on the parked chip",
		deepEqual(frame.detailTiles, [
			{ size: 3, labels: ["", "", ""], colors: ["#4CC2FF", "#FF7E8E", "#38CD89"], cellLabels: true },
			{ size: 4, labels: ["MINE", "", "", ""], colors: ["#D4AB33", null, null, null], cellLabels: true },
			{ size: 1, labels: [""], colors: ["#FF00AA"], cellLabels: true }
		]),
		JSON.stringify(frame.detailTiles)
	);

	// L6: a cross-tile drop on a chip grows the target at that exact cell
	// with the traveling dressing: MINE moves tile and keeps its name.
	mark = writes.length;
	check("leg L6: dropped MINE's chip before the parked pink chip", (await dragDrop("bench:0:3", '#detail-list .hw-set-chip[data-key="bench:0:0"]', "left")) === "ok");
	await sleep(700);
	frame = atomic("leg L6 dressed grow", writes.slice(mark));
	check("leg L6: the chip landed at the dropped cell", deepEqual(frame.detailKeys, ["bench:0:4", "bench:0:1", "bench:0:2", "bench:0:5", "bench:0:6", "bench:0:7", "bench:0:3", "bench:0:0"]), JSON.stringify(frame.detailKeys));
	check(
		"leg L6: the grown cell wears MINE and its own color beside the pink",
		deepEqual(frame.detailTiles, [
			{ size: 3, labels: ["", "", ""], colors: ["#4CC2FF", "#FF7E8E", "#38CD89"], cellLabels: true },
			{ size: 3, labels: ["", "", ""], colors: [null, null, null], cellLabels: true },
			{ size: 2, labels: ["MINE", ""], colors: ["#D4AB33", "#FF00AA"], cellLabels: true }
		]),
		JSON.stringify(frame.detailTiles)
	);

	// L7: the list's own padding and the gaps between tiles are drop
	// zones too: a drop in the gap routes to the nearest tile's nearest
	// chip edge instead of silently snapping the chip back.
	mark = writes.length;
	check(
		"leg L7: dropped a chip into the gap between the tiles",
		(await evaluate(`(() => {
			const chip = document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:2"]');
			const list = document.getElementById("detail-list");
			const holder = document.querySelectorAll("#detail-list .hw-tile:not(.ghost)")[1];
			if (!chip || !list || !holder) return "missing";
			const dt = new DataTransfer();
			chip.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
			// One pixel above the second tile: inside the list, outside every
			// holder, decisively nearest that tile's first chip edge.
			const r = holder.getBoundingClientRect();
			list.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 8, clientY: r.top - 1 }));
			chip.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
			return "ok";
		})()`)).result?.value === "ok"
	);
	await sleep(700);
	frame = atomic("leg L7 gap drop", writes.slice(mark));
	check("leg L7: the gap drop joined the tile below at its head", deepEqual(frame.detailTiles?.map((t) => t.size), [2, 4, 2]), JSON.stringify(frame.detailTiles?.map((t) => t.size)));
	check("leg L7: membership shifted without a flat-list shear", deepEqual(frame.detailKeys, ["bench:0:4", "bench:0:1", "bench:0:2", "bench:0:5", "bench:0:6", "bench:0:7", "bench:0:3", "bench:0:0"]), JSON.stringify(frame.detailKeys));
	check(
		"leg L7: the dressed pair beside it is byte-stable",
		deepEqual(frame.detailTiles?.[2], { size: 2, labels: ["MINE", ""], colors: ["#D4AB33", "#FF00AA"], cellLabels: true }),
		JSON.stringify(frame.detailTiles?.[2])
	);

	// L8: a DRESSED chip leaving for the ghost keeps its dressing: the
	// walk freezes into the plan and the chip appends as its own one-cell
	// tile instead of shedding the color into the uniform fill.
	mark = writes.length;
	check(
		"leg L8: dragged the pink chip onto the ghost",
		(await evaluate(`(() => {
			const chip = document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:0"]');
			const ghost = document.querySelector("#detail-list .hw-tile.ghost");
			if (!chip || !ghost) return "missing";
			const dt = new DataTransfer();
			chip.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
			ghost.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
			chip.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
			return "ok";
		})()`)).result?.value === "ok"
	);
	await sleep(700);
	frame = atomic("leg L8 dressed ghost leave", writes.slice(mark));
	check("leg L8: the leaver stayed at the end of the list", deepEqual(frame.detailKeys, ["bench:0:4", "bench:0:1", "bench:0:2", "bench:0:5", "bench:0:6", "bench:0:7", "bench:0:3", "bench:0:0"]), JSON.stringify(frame.detailKeys));
	check(
		"leg L8: the walk froze and the pink survived as its own tile",
		deepEqual(frame.detailTiles, [
			{ size: 2, labels: ["", ""], colors: ["#4CC2FF", "#FF7E8E"], cellLabels: true },
			{ size: 4, labels: ["", "", "", ""], colors: ["#38CD89", null, null, null], cellLabels: true },
			{ size: 1, labels: ["MINE"], colors: ["#D4AB33"], cellLabels: true },
			{ size: 1, labels: [""], colors: ["#FF00AA"], cellLabels: true }
		]),
		JSON.stringify(frame.detailTiles)
	);
	check(
		"leg L8: the walk renders the parked pink as its own tile",
		(await evaluate(`JSON.stringify(Array.from(document.querySelectorAll("#detail-list .hw-tile:not(.ghost) .hw-tile-size")).map((b) => b.textContent))`)).result?.value === JSON.stringify(["×2", "×4", "×1", "×1"]),
		(await evaluate(`JSON.stringify(Array.from(document.querySelectorAll("#detail-list .hw-tile:not(.ghost) .hw-tile-size")).map((b) => b.textContent))`)).result?.value
	);

	// L9: the CARET itself, the thing every drop-routing commit is named
	// for, and until now the one thing no leg ever dispatched: the suite
	// fired dragstart and drop, never a dragover, so nothing checked that
	// the bar a user aims by matches where the chip lands. A chip edge is
	// honest while the tile can take the cell. A FULL quad cannot: the
	// mover parks the chip beside the whole tile, so a bar between two of
	// its cells promised a landing that has never been possible. On a full
	// target the caret is the tile's own edge instead.
	const caretAfter = async (payloadKey, targetSel, at) =>
		(await evaluate(`(() => {
			const src = document.querySelector('#detail-list .hw-set-chip[data-key="${payloadKey}"]');
			const target = document.querySelector('${targetSel}');
			if (!src || !target) return "missing";
			const dt = new DataTransfer();
			src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
			const r = target.getBoundingClientRect();
			const x = "${at}" === "left" ? r.left + 2 : r.right - 2;
			target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: r.top + r.height / 2 }));
			const painted = document.querySelectorAll("#detail-list .drop-before, #detail-list .drop-after");
			const out = Array.from(painted).map((el) => [el.classList.contains("hw-tile") ? "tile" : (el.dataset.key ?? "chip"), el.classList.contains("drop-before") ? "before" : "after"]);
			src.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
			return JSON.stringify(out);
		})()`)).result?.value;
	// The list here is [b4,b1] [b2,b5,b6,b7] [b3] [b0] (leg L8's end state),
	// so tile 2 is a FULL quad and tile 1 is a two-cell tile with room.
	mark = writes.length;
	check(
		"leg L9: a caret on a tile that has room marks the chip edge it will insert at",
		(await caretAfter("bench:0:3", '#detail-list .hw-set-chip[data-key="bench:0:4"]', "right")) === JSON.stringify([["bench:0:4", "after"]]),
		String(await caretAfter("bench:0:3", '#detail-list .hw-set-chip[data-key="bench:0:4"]', "right"))
	);
	check(
		"leg L9: a caret between two cells of a FULL quad marks the tile, where the park lands",
		(await caretAfter("bench:0:3", '#detail-list .hw-set-chip[data-key="bench:0:5"]', "right")) === JSON.stringify([["tile", "after"]]),
		String(await caretAfter("bench:0:3", '#detail-list .hw-set-chip[data-key="bench:0:5"]', "right"))
	);
	check(
		"leg L9: the full quad's own head cell still marks the near side, the one park that lands there",
		(await caretAfter("bench:0:3", '#detail-list .hw-set-chip[data-key="bench:0:2"]', "left")) === JSON.stringify([["tile", "before"]]),
		String(await caretAfter("bench:0:3", '#detail-list .hw-set-chip[data-key="bench:0:2"]', "left"))
	);
	check(
		"leg L9: a chip reordering INSIDE the full quad keeps its cell carets, that drop is a plain reorder",
		(await caretAfter("bench:0:5", '#detail-list .hw-set-chip[data-key="bench:0:7"]', "right")) === JSON.stringify([["bench:0:7", "after"]]),
		String(await caretAfter("bench:0:5", '#detail-list .hw-set-chip[data-key="bench:0:7"]', "right"))
	);
	check("leg L9: painting a caret wrote nothing", writes.length === mark, `${writes.length - mark} frames`);

	// ---- run 3c: the bench case, exactly as reported (leg M) -------------
	// Stephen's tile on the real deck: a bare-values quad whose ONLY
	// stored dressing is one cell label ("Solo" on cell 0) and no colors
	// at all, so all four chips wear the default identity palette. The
	// down arrow on that chip used to leave the label nailed to cell 0
	// while the readings shuffled under it: the label appeared to stick,
	// the chip appeared not to move, and every reading on the tile
	// changed color. The label must ride the chip and no chip may change
	// color. Seeded fresh so the leg reads as its own story.
	await fetch(`http://127.0.0.1:${HTTP_PORT}/seed/bench`);
	await cdp("Page.navigate", { url: `http://127.0.0.1:${HTTP_PORT}/ui/sensor-reading.html` });
	await sleep(3500);
	check("leg M: opening wrote nothing", writes.length === 0, `${writes.length} writes`);
	const wornColors = async () =>
		(await evaluate(`JSON.stringify(Array.from(document.querySelectorAll("#detail-list .hw-tile:not(.ghost)")[0].querySelectorAll(".hw-set-chip")).map((c) => [c.dataset.key, c.querySelector(".hw-tile-color")?.value ?? null, c.querySelector(".hw-set-name")?.textContent]))`)).result?.value;
	const beforeWorn = await wornColors();
	check(
		"leg M: the four chips start on the default identity palette, Solo on the head",
		beforeWorn === JSON.stringify([
			["bench:0:0", "#4cc2ff", "Solo"],
			["bench:0:1", "#ff7e8e", "Bench 1"],
			["bench:0:2", "#38cd89", "Bench 2"],
			["bench:0:3", "#d4ab33", "Bench 3"]
		]),
		String(beforeWorn)
	);
	mark = writes.length;
	await evaluate(`document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:0"] .hw-detail-move[data-move="1"]')?.click()`);
	await sleep(700);
	frame = atomic("leg M down arrow on the labelled chip", writes.slice(mark));
	check("leg M: the labelled chip itself moved down one cell", deepEqual(frame.detailKeys, ["bench:0:1", "bench:0:0", "bench:0:2", "bench:0:3", "bench:0:4", "bench:0:5"]), JSON.stringify(frame.detailKeys));
	check(
		"leg M: Solo rode the chip to cell 1 instead of sticking to cell 0",
		deepEqual(frame.detailTiles?.[0]?.labels, ["", "Solo", "", ""]),
		JSON.stringify(frame.detailTiles?.[0]?.labels)
	);
	check(
		"leg M: the two swapped chips kept their colors, the untouched pair kept their stored nulls",
		deepEqual(frame.detailTiles?.[0]?.colors, ["#FF7E8E", "#4CC2FF", null, null]),
		JSON.stringify(frame.detailTiles?.[0]?.colors)
	);
	// The wells are the panel's own rendering of what the deck paints, so
	// this is the color-consistency claim end to end: same four colors on
	// the same four readings, in their new order.
	const afterWorn = await wornColors();
	check(
		"leg M: every reading still wears the exact color it wore before the move",
		afterWorn === JSON.stringify([
			["bench:0:1", "#ff7e8e", "Bench 1"],
			["bench:0:0", "#4cc2ff", "Solo"],
			["bench:0:2", "#38cd89", "Bench 2"],
			["bench:0:3", "#d4ab33", "Bench 3"]
		]),
		String(afterWorn)
	);
	// And the tail: a chip walking out of the quad crosses into a tile
	// holding only TWO readings, which the deck paints as a dual face, and a
	// dual paints no identity colors at all. So the leaver wears none there
	// and the incomer carries none back: the color follows its reading only
	// as far as a tile that actually paints one. This used to write the
	// leaver's #D4AB33 into that tail, which froze it into the plan (so it
	// stopped following Tile shows) to store a color no face ever reads.
	mark = writes.length;
	await evaluate(`document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:3"] .hw-detail-move[data-move="1"]')?.click()`);
	await sleep(700);
	frame = atomic("leg M boundary walk", writes.slice(mark));
	check("leg M: the chip crossed the tile boundary", deepEqual(frame.detailKeys, ["bench:0:1", "bench:0:0", "bench:0:2", "bench:0:4", "bench:0:3", "bench:0:5"]), JSON.stringify(frame.detailKeys));
	check(
		"leg M: the color follows its reading only where a tile paints one",
		deepEqual(frame.detailTiles, [{ size: 4, labels: ["", "Solo", "", ""], colors: ["#FF7E8E", "#4CC2FF", null, null], cellLabels: false }]),
		JSON.stringify(frame.detailTiles)
	);

	// ---- run 3d: a drop into the PARTLY FILLED tail (leg N) --------------
	// Only the last tile of a walk can hold fewer readings than its size
	// says, and the chip mover judged "has this tile room" by that size.
	// A tail rendering two readings on a four-cell spec therefore read as
	// FULL, so a chip dropped into it parked as its own one-cell entry
	// spliced in behind a spec that already declares more cells than the
	// list can fill. The walk stopped short of that entry, the chip's
	// label and color went with it, and the buried entry surfaced later on
	// whatever reading grew into its slot. The tail already owns the cell:
	// the chip fills it, the tile keeps its size, and nothing is stored
	// where the walk cannot reach it. Seeded fresh, same bench tile.
	await fetch(`http://127.0.0.1:${HTTP_PORT}/seed/bench`);
	await cdp("Page.navigate", { url: `http://127.0.0.1:${HTTP_PORT}/ui/sensor-reading.html` });
	await sleep(3500);
	check("leg N: opening wrote nothing", writes.length === 0, `${writes.length} writes`);
	const legNTail = JSON.parse(
		(await evaluate(`JSON.stringify(Array.from(document.querySelectorAll("#detail-list .hw-tile:not(.ghost)")).map((t) => t.querySelectorAll(".hw-set-chip").length))`)).result?.value ?? "[]"
	);
	check("leg N: the walk is a full quad plus a tail holding two readings", deepEqual(legNTail, [4, 2]), JSON.stringify(legNTail));
	mark = writes.length;
	check("leg N: dropped the labelled chip after the tail's last chip", (await dragDrop("bench:0:0", '#detail-list .hw-set-chip[data-key="bench:0:5"]', "right")) === "ok");
	await sleep(700);
	frame = atomic("leg N tail drop", writes.slice(mark));
	check("leg N: the chip landed at the cell it was dropped on", deepEqual(frame.detailKeys, ["bench:0:1", "bench:0:2", "bench:0:3", "bench:0:4", "bench:0:5", "bench:0:0"]), JSON.stringify(frame.detailKeys));
	check(
		"leg N: the tail kept its size and Solo rode into the cell its chip fills",
		deepEqual(frame.detailTiles, [
			{ size: 3, labels: ["", "", ""], colors: [null, null, null], cellLabels: false },
			{ size: 4, labels: ["", "", "Solo", ""], colors: [null, null, null, null], cellLabels: true }
		]),
		JSON.stringify(frame.detailTiles)
	);
	// The plan is the document the deck reads: an entry past the walk is
	// invisible now and wrong later, so pin the two against each other.
	const legNWalk = (await evaluate(`document.querySelectorAll("#detail-list .hw-tile:not(.ghost)").length`)).result?.value;
	check("leg N: the plan stores no tile the walk cannot reach", frame.detailTiles?.length === legNWalk, `${frame.detailTiles?.length} stored, ${legNWalk} rendered`);
	check(
		"leg N: the moved chip still wears Solo in the panel",
		(await evaluate(`document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:0"] .hw-set-name')?.textContent ?? "gone"`)).result?.value === "Solo",
		String((await evaluate(`document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:0"] .hw-set-name')?.textContent ?? "gone"`)).result?.value)
	);

	// ---- run 3e: the Tile shows change regroups the walk live (leg J) ----
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

	// ---- run 3f: a walk reshape must never outlive the aim (legs J2-J5) --
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
	// The list is a wrapping flex row of inline-flex tiles, so short tiles sit
	// side by side and the landing side is a question about x. The helper aims
	// horizontally and holds y at the target's own middle, which is exactly
	// the pointer a real drag delivers along a shared row.
	const tileDrag = async (fromIdx, targetIdx, side) =>
		(await evaluate(`(() => {
			const tiles = document.querySelectorAll("#detail-list .hw-tile:not(.ghost)");
			const grip = tiles[${fromIdx}]?.querySelector(".hw-tile-grip");
			const target = tiles[${targetIdx}];
			if (!grip || !target) return "missing";
			const dt = new DataTransfer();
			grip.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
			const r = target.getBoundingClientRect();
			const x = ${JSON.stringify("left")} === "${side}" ? r.left + 1 : r.right - 1;
			target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: r.top + r.height / 2 }));
			grip.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
			return "ok";
		})()`)).result?.value;
	// The axis claim, measured rather than assumed: if two tiles share a row,
	// a top/bottom midpoint cannot tell them apart and only x can.
	const rowShare = JSON.parse(
		(await evaluate(`(() => {
			const r = Array.from(document.querySelectorAll("#detail-list .hw-tile:not(.ghost)")).map((t) => t.getBoundingClientRect());
			return JSON.stringify(r.some((b, i) => i > 0 && Math.abs(b.top - r[i - 1].top) < 2 && r[i - 1].right <= b.left + 1));
		})()`)).result?.value ?? "false"
	);
	check("leg J6: tiles share a row, so the landing side is a question about x", rowShare === true, String(rowShare));
	mark = writes.length;
	check("leg J6: dragged the quad tile past the last tile", (await tileDrag(0, 2, "right")) === "ok");
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

	// Leg J7: dropping an existing chip ON a tile joins that tile: the
	// target grows a cell and the chip's old tile shrinks by the cell it
	// lost (dissolving at zero), so every other tile keeps its members.
	// A full quad cannot grow: that drop falls back to the adjacent
	// reorder. State here: keys [gpu, cpu, b0..b3], tiles [x1, x1, x4].
	const chipToTile = async (key, tileIdx) =>
		(await evaluate(`(() => {
			const chip = document.querySelector('#detail-list .hw-set-chip[data-key="${key}"]');
			const tiles = document.querySelectorAll("#detail-list .hw-tile:not(.ghost)");
			const holder = tiles[${tileIdx}];
			if (!chip || !holder) return "missing";
			const dt = new DataTransfer();
			chip.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
			// Bottom-right of the tile: the nearest chip edge is AFTER the
			// last chip, so the chrome drop means "join at the tile's end".
			const r = holder.getBoundingClientRect();
			holder.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.right - 2, clientY: r.bottom - 2 }));
			chip.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
			return "ok";
		})()`)).result?.value;
	mark = writes.length;
	check("leg J7: dropped b0's chip on the first tile", (await chipToTile("bench:0:0", 0)) === "ok");
	await sleep(700);
	frame = atomic("leg J7 join", writes.slice(mark));
	check("leg J7: the chip joined the tile it was dropped on", deepEqual(frame.detailKeys, ["gpu:0:0", "bench:0:0", "cpu:0:1", "bench:0:1", "bench:0:2", "bench:0:3"]), JSON.stringify(frame.detailKeys));
	check(
		"leg J7: the target grew and the source shrank, neighbors untouched",
		deepEqual(frame.detailTiles?.map((t) => t.size), [2, 1, 3]),
		JSON.stringify(frame.detailTiles?.map((t) => t.size))
	);
	mark = writes.length;
	check("leg J7: dropped cpu's chip on the third tile", (await chipToTile("cpu:0:1", 2)) === "ok");
	await sleep(700);
	frame = atomic("leg J7 dissolve", writes.slice(mark));
	check("leg J7: the emptied source tile dissolved", deepEqual(frame.detailTiles?.map((t) => t.size), [2, 4]), JSON.stringify(frame.detailTiles?.map((t) => t.size)));
	check("leg J7: membership stayed stable through the dissolve", deepEqual(frame.detailKeys, ["gpu:0:0", "bench:0:0", "bench:0:1", "bench:0:2", "bench:0:3", "cpu:0:1"]), JSON.stringify(frame.detailKeys));
	mark = writes.length;
	check("leg J7: dropped gpu's chip on the full quad", (await chipToTile("gpu:0:0", 1)) === "ok");
	await sleep(700);
	frame = atomic("leg J7 full-quad park", writes.slice(mark));
	check(
		"leg J7: a full target parks the chip beside it as its own box",
		deepEqual(frame.detailTiles?.map((t) => t.size), [1, 4]),
		JSON.stringify(frame.detailTiles?.map((t) => t.size))
	);
	check("leg J7: the parked chip landed just past the quad", deepEqual(frame.detailKeys, ["bench:0:0", "bench:0:1", "bench:0:2", "bench:0:3", "cpu:0:1", "gpu:0:0"]), JSON.stringify(frame.detailKeys));
	mark = writes.length;
	check(
		"leg J7: dragged a quad cell onto the ghost",
		(await evaluate(`(() => {
			const chip = document.querySelector('#detail-list .hw-set-chip[data-key="cpu:0:1"]');
			const ghost = document.querySelector("#detail-list .hw-tile.ghost");
			if (!chip || !ghost) return "missing";
			const dt = new DataTransfer();
			chip.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
			ghost.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
			chip.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
			return "ok";
		})()`)).result?.value === "ok"
	);
	await sleep(700);
	frame = atomic("leg J7 ghost leave", writes.slice(mark));
	check("leg J7: the ghost appends the leaver at the end", frame.detailKeys?.at(-1) === "cpu:0:1", JSON.stringify(frame.detailKeys?.slice(-2)));
	check(
		"leg J7: leaving for the ghost shrank the quad instead of restaffing it",
		deepEqual(frame.detailTiles?.map((t) => t.size), [1, 3]),
		JSON.stringify(frame.detailTiles?.map((t) => t.size))
	);

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
			parkedRenameOffered: parked?.querySelector(".hw-set-name")?.classList.contains("parked") === false,
			parkedRemoveNamed: (parked?.querySelector(".hw-set-remove")?.getAttribute("aria-label") ?? "").startsWith("Remove "),
			parkedRemovable: Array.from(parked?.querySelectorAll("button") ?? []).some((b) => (b.title ?? "").startsWith("Remove")),
			note: document.querySelector("#detail-list .hw-set-note")?.textContent ?? "gone"
		};
	})())`)).result?.value ?? "{}"
	);
	check("adopted: tile 1 wears [L1, L2] over the listed readings", deepEqual(adopted.a, { tile: "0", cell: "0", text: "L1", renamed: true, inTile: true }) && deepEqual(adopted.b, { tile: "0", cell: "1", text: "L2", renamed: true, inTile: true }), JSON.stringify([adopted.a, adopted.b]));
	check("adopted: tile 2 holds the third listed reading as L3", deepEqual(adopted.c, { tile: "1", cell: "0", text: "L3", renamed: true, inTile: true }), JSON.stringify(adopted.c));
	check("adopted: the primary's chip is parked outside every tile", adopted.parkedInTile === false, JSON.stringify(adopted.parkedInTile));
	check("adopted: the parked chip wears the Back-tile mark", String(adopted.parkedMark).includes("(Back tile)"), String(adopted.parkedMark));
	// It holds no cell, so it has no cell label: the rename affordance every
	// other name wears would be an invitation the click handler refuses.
	check("adopted: the parked chip offers no rename it would refuse", adopted.parkedRenameOffered === false, JSON.stringify(adopted.parkedRenameOffered));
	check("adopted: the parked chip's remove announces by name, not as a bare glyph", adopted.parkedRemoveNamed === true, JSON.stringify(adopted.parkedRemoveNamed));
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

	// ---- run 6b: dressing travels PAST a parked primary (leg O) ----------
	// The adopted run proved renames and removals around a parked primary
	// but never moved a chip, so dressing travel in that shape was unproven
	// by any leg. Seeded fresh: listed [b1, b2, b3] over two 2-cell tiles
	// wearing L1 to L4, with the opener's own sensor parked outside them.
	// The tail tile holds ONE reading in a two-cell spec, so dragging that
	// reading out empties the tile: it must leave the plan with it, not
	// linger as a one-cell entry the walk can no longer reach and carry L4
	// off to whatever reading grows into that slot later.
	await fetch(`http://127.0.0.1:${HTTP_PORT}/seed/adopted`);
	await cdp("Page.navigate", { url: `http://127.0.0.1:${HTTP_PORT}/ui/sensor-reading.html` });
	await sleep(3500);
	check("leg O: opening wrote nothing", writes.length === 0, `${writes.length} writes`);
	mark = writes.length;
	check("leg O: dragged the tail reading onto the head tile", (await dragDrop("bench:0:3", '#detail-list .hw-set-chip[data-key="bench:0:1"]', "left")) === "ok");
	await sleep(700);
	frame = atomic("leg O parked-primary move", writes.slice(mark));
	check("leg O: the listed order changed and the parked primary kept its slot", deepEqual(frame.detailKeys, ["bench:0:0", "bench:0:3", "bench:0:1", "bench:0:2"]), JSON.stringify(frame.detailKeys));
	check(
		"leg O: every label rode its own reading and the emptied tile left the plan",
		deepEqual(frame.detailTiles, [{ size: 3, labels: ["L3", "L1", "L2"], colors: [null, null, null], cellLabels: true }]),
		JSON.stringify(frame.detailTiles)
	);
	check(
		"leg O: the panel renders one tile, so no stored entry outlives the walk",
		(await evaluate(`document.querySelectorAll("#detail-list .hw-tile:not(.ghost)").length`)).result?.value === 1,
		String((await evaluate(`document.querySelectorAll("#detail-list .hw-tile:not(.ghost)").length`)).result?.value)
	);

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

	// The re-pick left the parked primary at raw slot 1, in the MIDDLE of
	// the stored list, which is the shape rawDetailIndex exists for: every
	// mover reads and writes LISTED positions, and only that mapping puts
	// them back in the right detailKeys slot. No leg moved a chip in that
	// state before, so the mapping rode on inspection alone (leg P).
	mark = writes.length;
	await evaluate(`document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:3"] .hw-detail-move[data-move="-1"]')?.click()`);
	await sleep(700);
	frame = atomic("leg P arrow past a mid-list parked primary", writes.slice(mark));
	check("leg P: the move stepped over the parked primary's slot", deepEqual(frame.detailKeys, ["bench:0:3", "bench:0:1", "bench:0:2"]), JSON.stringify(frame.detailKeys));
	check("leg P: a flat list stayed flat", deepEqual(frame.detailTiles, []), JSON.stringify(frame.detailTiles));
	check(
		"leg P: the parked chip is still parked outside the tiles",
		(await evaluate(`(() => {
			const chip = document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:2"]');
			return chip !== null && chip.closest(".hw-tile") === null;
		})()`)).result?.value === true
	);

	// ---- run 7b: config export and apply (the Advanced fold) -------------
	// The document is the exact settings object, canonically ordered;
	// filling is a read, refusal writes nothing, and Apply replaces the
	// whole document in one frame then reloads the panel so every
	// per-field store adopts the wholesale write.
	await fetch(`http://127.0.0.1:${HTTP_PORT}/seed/grouped`);
	await cdp("Page.navigate", { url: `http://127.0.0.1:${HTTP_PORT}/ui/sensor-reading.html` });
	await sleep(3500);
	check("config: opening wrote nothing", writes.length === 0, `${writes.length} writes`);
	check("config: opened the Advanced fold", (await evaluate(`(() => {
		const fold = document.querySelector('details[data-fold="advanced"]');
		if (!fold) return "missing";
		fold.open = true;
		return "ok";
	})()`)).result?.value === "ok");
	await sleep(600);
	const keyDocText = (await evaluate(`document.getElementById("config-key")?.value ?? "missing"`)).result?.value;
	let keyDoc = null;
	try {
		keyDoc = JSON.parse(keyDocText);
	} catch {
		keyDoc = null;
	}
	// The document is the settings object with one readability pass: every
	// reading key wears its friendly name, because a nineteen-key list of raw
	// HWiNFO identities tells a person nothing and cannot be reordered by
	// hand. Everything else is byte-for-byte the stored settings, canonically
	// ordered. Apply takes the names back off (leg S below).
	check(
		"config: the key document is the seeded settings, canonical",
		keyDoc !== null && Array.isArray(keyDoc.detailTiles) && deepEqual(Object.keys(keyDoc), Object.keys(keyDoc).slice().sort()),
		String(keyDocText).slice(0, 120)
	);
	check("config: the opener's key wears its reading name", keyDoc?.readingKey === "cpu:0:0  CPU Tctl", JSON.stringify(keyDoc?.readingKey));
	check(
		"config: every listed reading wears its name, in list order",
		deepEqual(keyDoc?.detailKeys?.slice(0, 3), ["bench:0:0  Bench 0", "bench:0:1  Bench 1", "bench:0:2  Bench 2"]),
		JSON.stringify(keyDoc?.detailKeys?.slice(0, 3))
	);
	check(
		"config: a key with no reading in the tree stays bare, which is the missing signal",
		typeof keyDocText === "string" && !keyDocText.includes("undefined") && !keyDocText.includes("null  "),
		String(keyDocText).slice(0, 80)
	);
	const deckDocText = (await evaluate(`document.getElementById("config-deck")?.value ?? "missing"`)).result?.value;
	check("config: the deck document renders the globals", deckDocText === JSON.stringify({ theme: "void" }, null, "\t"), String(deckDocText));
	check("config: filling both documents wrote nothing", writes.length === 0 && globalWrites.length === 0, `${writes.length}/${globalWrites.length}`);
	mark = writes.length;
	await evaluate(`(() => {
		document.getElementById("config-key").value = "{nope";
		document.getElementById("config-key-apply").click();
	})()`);
	await sleep(400);
	check("config: garbage is refused by name", String((await evaluate(`document.getElementById("config-note")?.textContent`)).result?.value).startsWith("Refused: not JSON"), String((await evaluate(`document.getElementById("config-note")?.textContent`)).result?.value));
	await evaluate(`(() => {
		document.getElementById("config-key").value = "[1,2]";
		document.getElementById("config-key-apply").click();
	})()`);
	await sleep(400);
	check("config: a non-object document is refused", String((await evaluate(`document.getElementById("config-note")?.textContent`)).result?.value).includes("one JSON object"), String((await evaluate(`document.getElementById("config-note")?.textContent`)).result?.value));
	check("config: refusals wrote nothing", writes.length === mark && globalWrites.length === 0, `${writes.length - mark}/${globalWrites.length}`);
	mark = writes.length;
	await evaluate(`(() => {
		const doc = ${JSON.stringify(JSON.stringify({ detailKeys: ["bench:0:0", "bench:0:2"], detailMode: "custom", detailTiles: [{ size: 2, labels: ["A", "B"], colors: [null, null], cellLabels: true }], futureBlob: FUTURE_BLOB, label: "Restored", pressBehavior: "open-details", readingKey: "cpu:0:0", cfgBlob: { keep: "yes" } }))};
		document.getElementById("config-key").value = doc;
		document.getElementById("config-key-apply").click();
	})()`);
	await sleep(700);
	frame = atomic("config apply", writes.slice(mark));
	check("config: Apply replaced the whole document in one frame", frame.label === "Restored" && deepEqual(frame.cfgBlob, { keep: "yes" }) && frame.detailTiles?.[0]?.labels?.[0] === "A", JSON.stringify(frame).slice(0, 160));
	await sleep(1400); // the panel reloads itself after an apply
	check("config: the reloaded panel adopted the applied document", (await evaluate(`(() => {
		const fold = document.querySelector('details[data-fold="advanced"]');
		if (!fold) return "missing";
		fold.open = true;
		return "ok";
	})()`)).result?.value === "ok");
	await sleep(600);
	const reloadedText = (await evaluate(`document.getElementById("config-key")?.value ?? "missing"`)).result?.value;
	check("config: the round trip preserved the unknown field", String(reloadedText).includes('"cfgBlob"') && String(reloadedText).includes('"Restored"'), String(reloadedText).slice(0, 120));
	check("config: the editor rebuilt from the applied plan", (await evaluate(`document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:0"] .hw-set-name')?.textContent`)).result?.value === "A", String((await evaluate(`document.querySelector('#detail-list .hw-set-chip[data-key=\\"bench:0:0\\"] .hw-set-name')?.textContent`)).result?.value));

	// ---- leg S: a NAMED document reorders by moving whole lines ----------
	// The point of the names is that a person or an agent can rewrite the
	// list by reading it. So drive the real gesture: take the document the
	// panel just handed out, reorder its named lines, paste it back, and
	// prove two things at once. The new order lands, and what reaches
	// settings is keys alone, because a stored name would go stale the day
	// HWiNFO renames the sensor.
	mark = writes.length;
	await evaluate(`(() => {
		const doc = ${JSON.stringify(
			JSON.stringify({
				detailKeys: ["bench:0:2  Bench 2", "bench:0:0  Bench 0", "bench:0:5  not in the tree at all"],
				detailMode: "custom",
				detailTiles: [{ size: 2, labels: ["A", "B"], colors: [null, null], cellLabels: true }],
				futureBlob: FUTURE_BLOB,
				label: "Named",
				pressBehavior: "open-details",
				readingKey: "cpu:0:0  CPU Tctl"
			})
		)};
		document.getElementById("config-key").value = doc;
		document.getElementById("config-key-apply").click();
	})()`);
	await sleep(700);
	frame = atomic("leg S named apply", writes.slice(mark));
	check("leg S: the reordered list landed in the pasted order", deepEqual(frame.detailKeys, ["bench:0:2", "bench:0:0", "bench:0:5"]), JSON.stringify(frame.detailKeys));
	check("leg S: settings store keys alone, never a name that could go stale", JSON.stringify(frame.detailKeys ?? []).includes("Bench") === false, JSON.stringify(frame.detailKeys));
	check("leg S: the opener's key shed its name too", frame.readingKey === "cpu:0:0", JSON.stringify(frame.readingKey));
	check("leg S: an unresolvable name is still stripped to a usable key", frame.detailKeys?.[2] === "bench:0:5", JSON.stringify(frame.detailKeys?.[2]));
	check("leg S: everything that is not a key rode through untouched", frame.label === "Named" && deepEqual(frame.futureBlob, FUTURE_BLOB) && frame.detailTiles?.[0]?.labels?.[0] === "A", JSON.stringify(frame).slice(0, 140));
	await sleep(1400); // the panel reloads itself after an apply
	check("leg S: the reloaded panel shows the chips in the pasted order", (await evaluate(`JSON.stringify(Array.from(document.querySelectorAll("#detail-list .hw-set-chip")).map((c) => c.dataset.key))`)).result?.value === JSON.stringify(["bench:0:2", "bench:0:0", "bench:0:5"]), String((await evaluate(`JSON.stringify(Array.from(document.querySelectorAll("#detail-list .hw-set-chip")).map((c) => c.dataset.key))`)).result?.value));
	await evaluate(`(() => {
		document.getElementById("config-deck").value = JSON.stringify({ pollIntervalMs: 500, theme: "paper" });
		document.getElementById("config-deck-apply").click();
	})()`);
	await sleep(700);
	check("config: the deck document applies through setGlobalSettings", deepEqual(globalWrites.at(-1), { pollIntervalMs: 500, theme: "paper" }), JSON.stringify(globalWrites.at(-1)));
	await sleep(1400); // second self-reload before the next run navigates

	// ---- leg C: Copy hands out the settings of now, not of fold-open -----
	// The help sells Copy as the exact settings this key runs on. An edit
	// made while the fold stays open must reach the next Copy: an
	// untouched well refills first (a read), and a hand-edited draft is
	// the one thing Copy must never overwrite.
	check("leg C: reopened the Advanced fold", (await evaluate(`(() => {
		const fold = document.querySelector('details[data-fold="advanced"]');
		if (!fold) return "missing";
		fold.open = true;
		return "ok";
	})()`)).result?.value === "ok");
	await sleep(600);
	mark = writes.length;
	const gmark = globalWrites.length;
	await evaluate(`document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:0"] .hw-detail-move[data-move="-1"]')?.click()`);
	await sleep(700);
	frame = atomic("leg C in-fold edit", writes.slice(mark));
	check("leg C: the edit landed while the fold stayed open", deepEqual(frame.detailKeys, ["bench:0:0", "bench:0:2", "bench:0:5"]), JSON.stringify(frame.detailKeys));
	await evaluate(`document.getElementById("config-key-copy")?.click()`);
	await sleep(500);
	let legCDoc = null;
	try {
		legCDoc = JSON.parse((await evaluate(`document.getElementById("config-key")?.value ?? "missing"`)).result?.value);
	} catch {
		legCDoc = null;
	}
	check("leg C: Copy refreshed the untouched well to the post-edit settings", legCDoc?.detailKeys?.[0] === "bench:0:0  Bench 0", JSON.stringify(legCDoc?.detailKeys));
	check("leg C: the refresh was a read, not a write", writes.length === mark + 1 && globalWrites.length === gmark, `${writes.length - mark}/${globalWrites.length - gmark}`);
	check("leg C: the note reported an honest outcome", /^(Copied\.|Copy failed;)/.test(String((await evaluate(`document.getElementById("config-note")?.textContent`)).result?.value)), String((await evaluate(`document.getElementById("config-note")?.textContent`)).result?.value));
	await evaluate(`(() => {
		const el = document.getElementById("config-key");
		el.value = "{ draft";
		el.dispatchEvent(new Event("input", { bubbles: true }));
		document.getElementById("config-key-copy").click();
	})()`);
	await sleep(500);
	check("leg C: a hand-edited draft copies as typed, never overwritten", (await evaluate(`document.getElementById("config-key")?.value`)).result?.value === "{ draft", String((await evaluate(`document.getElementById("config-key")?.value`)).result?.value));

	// ---- run 7c: a real press survives the rename it tears down (leg R) --
	// Every other leg drives the panel with element.click(), which fires no
	// mousedown and so cannot see this: opening a cell rename and then
	// PRESSING any other control blurs the input, the blur commits or
	// abandons the rename, and either path rebuilt the whole list from
	// inside the press. replaceChildren took the pressed control with it,
	// Blink dropped the click, and the user's press did nothing. The writes
	// still go out at once; only the repaint waits for the press to finish.
	// This is the one leg in the suite that dispatches real mouse input.
	const realClick = async (sel) => {
		const at = JSON.parse(
			(await evaluate(`(() => {
			const el = document.querySelector('${sel}');
			if (!el) return "null";
			el.scrollIntoView({ block: "center" });
			const r = el.getBoundingClientRect();
			return JSON.stringify([r.left + r.width / 2, r.top + r.height / 2]);
		})()`)).result?.value ?? "null"
		);
		if (!Array.isArray(at)) return "missing";
		await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: at[0], y: at[1], button: "left", buttons: 1, clickCount: 1 });
		// A HELD press, the way a hand presses. Back-to-back press/release over
		// CDP leaves no task boundary between them, so a zero-delay timer
		// scheduled by the press cannot run inside the gesture and the abandon
		// path's repaint never gets the chance to eat the click.
		await sleep(120);
		await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: at[0], y: at[1], button: "left", buttons: 0, clickCount: 1 });
		return "ok";
	};
	await fetch(`http://127.0.0.1:${HTTP_PORT}/seed/bench`);
	await cdp("Page.navigate", { url: `http://127.0.0.1:${HTTP_PORT}/ui/sensor-reading.html` });
	await sleep(3500);
	check("leg R: opening wrote nothing", writes.length === 0, `${writes.length} writes`);
	// Phase 1, the abandon path: open a rename, change nothing, press another
	// chip's remove. The focusout repaint must not eat that press.
	mark = writes.length;
	await evaluate(`document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:1"] .hw-set-name')?.click()`);
	await sleep(300);
	check("leg R: the rename input is open", (await evaluate(`document.querySelector("#detail-list .hw-cell-rename") !== null`)).result?.value === true);
	check("leg R: pressed another chip's remove with a real mouse", (await realClick('#detail-list .hw-set-chip[data-key="bench:0:2"] .hw-set-remove')) === "ok");
	await sleep(900);
	frame = atomic("leg R abandon then press", writes.slice(mark));
	check("leg R: the press landed, it was not swallowed by the rename teardown", !frame.detailKeys?.includes("bench:0:2"), JSON.stringify(frame.detailKeys));
	check("leg R: the abandoned rename input is gone", (await evaluate(`document.querySelector("#detail-list .hw-cell-rename") === null`)).result?.value === true);
	// Phase 2, the commit path: type into the rename, then press a remove.
	// BOTH must land, the rename write and the removal.
	mark = writes.length;
	await evaluate(`document.querySelector('#detail-list .hw-set-chip[data-key="bench:0:1"] .hw-set-name')?.click()`);
	await sleep(300);
	await cdp("Input.insertText", { text: "Renamed" });
	await sleep(200);
	check("leg R: pressed a remove while the rename was dirty", (await realClick('#detail-list .hw-set-chip[data-key="bench:0:3"] .hw-set-remove')) === "ok");
	await sleep(900);
	const legR = writes.slice(mark);
	check("leg R: the rename committed", legR.some((w) => w.detailTiles?.[0]?.labels?.includes("Renamed")), JSON.stringify(legR.map((w) => w.detailTiles?.[0]?.labels)));
	check("leg R: and the press that committed it also landed", legR.some((w) => !w.detailKeys?.includes("bench:0:3")), JSON.stringify(legR.map((w) => w.detailKeys?.length)));

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
