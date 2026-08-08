// Captures the property inspectors (served by scripts/pi-harness.mjs) in
// headless Chrome over CDP with real-time waits, so live WebSocket data and
// the theme gallery are present. Twenty-one states: the key PI's settings view,
// open picker (marketplace shot 3), Display selector on Bar, Text set to
// Custom with the color well and dim checkbox, the Press section on Open
// sensor details, the same block with the Second Back checkbox ticked, the
// custom detail list mid-build (collector rows added,
// ordered chips with move arrows), dual, triple and quad layouts
// (quad with the cell-colors row, plus the quad rows clipped on their own);
// the dial PI's rotation-set picker with ticked
// rows, a chip open mid-rename beside two already-renamed chips,
// rows and chips, the rotation-group editor (two named groups with the
// collector radio), the Elite preset view, the Custom gesture rows with
// touch zones, the overview view's Context line + Separators controls, and
// the dial's own Text Custom rows; and the HWiNFO Control PI with a Link ID
// target. The deck-wide Text and Data units selects show in the key PI's
// Advanced section of pi-settings.png.
// Usage: node scripts/capture-pi.mjs <outDir>
// Start a FRESH pi-harness for each run. The harness holds the settings this
// script writes for the lifetime of its process, so a second run against the
// same harness starts from the first run's end state and fails on the steps
// that expect a clean panel (the rotation set is already split, so "Split
// into groups" is gone).
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import WebSocket from "ws";

const outDir = process.argv[2] ?? ".";
const BASE = "http://127.0.0.1:28997/ui";
const DEBUG_PORT = 29222;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[capture] ${m}`);

const chrome = spawn(CHROME, [
	"--headless=new",
	"--disable-gpu",
	`--remote-debugging-port=${DEBUG_PORT}`,
	`--user-data-dir=${path.join(process.env.TEMP ?? ".", "pi-capture-profile")}`,
	"--hide-scrollbars",
	"about:blank"
], { stdio: "ignore" });

/** chrome.kill() alone can strand renderer children — take down the tree,
 * then sweep any stragglers that re-parented past /T by our profile dir. */
function killChromeTree() {
	try {
		spawnSync("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
	} catch {
		chrome.kill();
	}
	try {
		spawnSync(
			"powershell.exe",
			[
				"-NoProfile",
				"-Command",
				"Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -match 'pi-capture-profile' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
			],
			{ stdio: "ignore", timeout: 15000 }
		);
	} catch {
		/* best effort */
	}
}

// Hard stop so a wedged CDP call can never hang the caller — but never at
// the price of an orphaned chrome tree. Eleven captures with real-time
// waits need more headroom than the old two.
const watchdog = setTimeout(() => {
	console.error("[capture] watchdog: 240s elapsed — aborting");
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
	log(`debugger target: ${target.title}`);

	const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
	cdpSocket = ws;
	await new Promise((resolve, reject) => {
		ws.once("open", resolve);
		ws.once("error", reject);
	});
	log("cdp connected");
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
	const viewport = (height) => cdp("Emulation.setDeviceMetricsOverride", { width: 400, height, deviceScaleFactor: 2, mobile: false });
	const evaluate = (expression) => cdp("Runtime.evaluate", { expression, returnByValue: true });
	const capture = async (name) => {
		const shot = await cdp("Page.captureScreenshot", { format: "png" });
		writeFileSync(path.join(outDir, name), Buffer.from(shot.data, "base64"));
		log(`${name} captured`);
	};
	/** Clip-capture one region at the panel's full 400 px width. rectRes must
	 * resolve {y, h}; a renamed-away element fails loudly unless a fallback
	 * clip is given. */
	const captureClipped = async (name, rectRes, fallback) => {
		let clip = rectRes.result?.value;
		if (clip === "missing" || clip === undefined) {
			if (fallback === undefined) {
				throw new Error(`${name} clip rect did not resolve`);
			}
			clip = fallback;
		}
		const shot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: clip.y, width: 400, height: clip.h, scale: 1 } });
		writeFileSync(path.join(outDir, name), Buffer.from(shot.data, "base64"));
		log(`${name} captured`);
	};
	/** Fail loudly when a driven element has been renamed away: a silent miss
	 * would capture the wrong state and ship it. */
	const expectOk = (what, res) => {
		if (res.result?.value !== "ok") {
			throw new Error(`${what} did not resolve (${JSON.stringify(res.result?.value ?? res.exceptionDetails?.text)})`);
		}
	};
	/** Set an sdpi-select's value, driving the inner <select> if the host
	 * element's value accessor did not take. */
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
		expectOk(`sdpi-select[setting="${setting}"]`, res);
	};

	await viewport(880);
	await cdp("Page.enable");

	// ---- key PI: settings view + open picker (marketplace shot 3) ----
	log("navigating: sensor-reading");
	await cdp("Page.navigate", { url: `${BASE}/sensor-reading.html` });
	await sleep(8000); // real time: plugin ticks + sensor tree + themes payload
	// Advanced open (deck theme, accents, source, poll rate, support report)
	// and the viewport fitted, so the capture shows the whole panel.
	expectOk("Advanced details", await evaluate(`(() => {
		const adv = document.querySelector('details[data-fold="advanced"]');
		if (!adv) return "missing";
		adv.open = true;
		return "ok";
	})()`));
	await sleep(400);
	const settingsHeight = await evaluate(`Math.ceil([...document.body.children].reduce((m, el) => Math.max(m, el.getBoundingClientRect().bottom), 0))`);
	await viewport(Math.min(2400, Math.max(880, Number(settingsHeight.result?.value ?? 880) + 16)));
	await sleep(300);
	await capture("pi-settings.png");
	await viewport(880);

	// Open the picker with a query typed in, so the filtered list shows.
	await evaluate(`(() => { const el = document.getElementById("picker-search"); el.focus(); el.value = "gpu"; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
	await sleep(1500);
	await capture("pi-picker.png");
		// The same state clipped to end at the Press section instead of at
		// whatever row a consumer's height budget lands on: cutting mid-swatch
		// reads as a rendering fault rather than as a scrolled panel.
		await captureClipped("pi-picker-block.png", await evaluate(`(() => {
			const sel = document.querySelector('sdpi-select[setting="pressBehavior"]');
			if (!sel) return "missing";
			const item = sel.closest("sdpi-item") ?? sel;
			return { y: 0, h: Math.ceil(item.getBoundingClientRect().bottom + window.scrollY + 14) };
		})()`));

	// ---- key PI: Display selector on Bar (the select + its help line) ----
	await evaluate(`document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
	expectOk("display-mode select", await evaluate(`(() => {
		const el = document.getElementById("display-mode");
		if (!el) return "missing";
		el.value = "bar";
		el.dispatchEvent(new Event("change", { bubbles: true }));
		return "ok";
	})()`));
	await sleep(600);
	await captureClipped("pi-key-display.png", await evaluate(`(() => {
		const item = document.getElementById("display-item");
		if (!item) return "missing";
		const r = item.getBoundingClientRect();
		return { y: Math.max(0, Math.floor(r.top + window.scrollY - 10)), h: Math.ceil(r.height + 20) };
	})()`));

	// ---- key PI: Text set to Custom (color well + secondary dim checkbox) ----
	await setSelect("textMode", "custom");
	await sleep(900); // the text poll reveals #text-custom within 400 ms
	expectOk("text custom rows revealed", await evaluate(`document.getElementById("text-custom").hidden === false ? "ok" : "hidden"`));
	expectOk("text color well", await evaluate(`(() => {
		const el = document.getElementById("text-color");
		if (!el) return "missing";
		el.value = "#660000";
		el.dispatchEvent(new Event("change", { bubbles: true }));
		return "ok";
	})()`));
	await sleep(900); // preview push carries the custom color back
	await captureClipped("pi-key-text.png", await evaluate(`(() => {
		const sel = document.querySelector('sdpi-select[setting="textMode"]');
		const block = document.getElementById("text-custom");
		if (!sel || !block) return "missing";
		const items = [sel.closest("sdpi-item") ?? sel, block];
		const top = Math.min(...items.map((el) => el.getBoundingClientRect().top)) + window.scrollY;
		const bottom = Math.max(...items.map((el) => el.getBoundingClientRect().bottom)) + window.scrollY;
		// Tight top: -10 shears the tail of the theme help line above the row.
		return { y: Math.max(0, Math.floor(top - 2)), h: Math.ceil(bottom - top + 12) };
	})()`));
	// Back to the deck default so the later shots show the plain panel.
	await setSelect("textMode", "");
	await sleep(600);

	// ---- key PI: Press on Open sensor details (the drill-down rows) ----
	await evaluate(`document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
	await setSelect("pressBehavior", "open-details");
	await sleep(900); // the press poll reveals #detail-config within 400 ms
	expectOk("detail config revealed", await evaluate(`document.getElementById("detail-config").hidden === false ? "ok" : "hidden"`));
	await captureClipped("pi-key-press.png", await evaluate(`(() => {
		const sel = document.querySelector('sdpi-select[setting="pressBehavior"]');
		const block = document.getElementById("detail-config");
		if (!sel || !block) return "missing";
		const items = [sel.closest("sdpi-item") ?? sel, block];
		const top = Math.min(...items.map((el) => el.getBoundingClientRect().top)) + window.scrollY;
		const bottom = Math.max(...items.map((el) => el.getBoundingClientRect().bottom)) + window.scrollY;
		return { y: Math.max(0, Math.floor(top - 26)), h: Math.ceil(bottom - top + 38) };
	})()`));

	// ---- key PI: the Second Back checkbox ticked (the opt-in second Back) ----
	expectOk("second-back ticked", await evaluate(`(() => {
		const el = document.querySelector('sdpi-checkbox[setting="detailMirrorBack"]');
		if (!el) return "missing";
		const input = (el.shadowRoot ?? el).querySelector("input[type=checkbox]");
		if (!input) return "no input";
		input.click();
		return input.checked === true ? "ok" : "did not tick";
	})()`));
	await sleep(600); // the setting echo settles so the tick is stored state, not a mid-write frame
	await captureClipped("pi-key-detail-back.png", await evaluate(`(() => {
		const sel = document.querySelector('sdpi-select[setting="pressBehavior"]');
		const block = document.getElementById("detail-config");
		if (!sel || !block) return "missing";
		const items = [sel.closest("sdpi-item") ?? sel, block];
		const top = Math.min(...items.map((el) => el.getBoundingClientRect().top)) + window.scrollY;
		const bottom = Math.max(...items.map((el) => el.getBoundingClientRect().bottom)) + window.scrollY;
		return { y: Math.max(0, Math.floor(top - 26)), h: Math.ceil(bottom - top + 38) };
	})()`));
	// Untick: every later state shows the default-off panel.
	expectOk("second-back cleared", await evaluate(`(() => {
		const input = document.querySelector('sdpi-checkbox[setting="detailMirrorBack"]').shadowRoot.querySelector("input[type=checkbox]");
		input.click();
		return input.checked === false ? "ok" : "still ticked";
	})()`));
	await sleep(400);

	// ---- key PI: the custom detail list mid-build (collector + ordered chips) ----
	await setSelect("detailMode", "custom");
	await sleep(900);
	expectOk("custom detail editor revealed", await evaluate(`document.getElementById("detail-custom").hidden === false ? "ok" : "hidden"`));
	await evaluate(`(() => { const el = document.getElementById("pickerd-search"); el.focus(); el.value = "gpu"; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
	await sleep(700);
	expectOk("collector rows added", await evaluate(`(() => {
		const rows = [...document.querySelectorAll("#pickerd-list .hw-row")].slice(0, 3);
		if (rows.length === 0) return "missing";
		for (const row of rows) {
			row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
		}
		return "ok";
	})()`));
	await sleep(700);
	await captureClipped("pi-key-detail-custom.png", await evaluate(`(() => {
		const block = document.getElementById("detail-config");
		if (!block) return "missing";
		const r = block.getBoundingClientRect();
		return { y: Math.max(0, Math.floor(r.top + window.scrollY - 10)), h: Math.ceil(r.height + 20) };
	})()`));
	// ---- key PI: the filter mode with its live match count ----
	await evaluate(`document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
	await setSelect("detailMode", "filter");
	await sleep(900);
	expectOk("filter editor revealed", await evaluate(`document.getElementById("detail-filter").hidden === false ? "ok" : "hidden"`));
	// sdpi-textfield: drive the shadow input (the property path throws on
	// plain strings; same gotcha as the placeholder).
	await evaluate(`(() => { const input = document.querySelector('sdpi-textfield[setting="detailFilter"]').shadowRoot.querySelector("input"); input.focus(); input.value = "*4090*"; input.dispatchEvent(new Event("input", { bubbles: true })); })()`);
	await sleep(1200); // the setting echo, the 400 ms follow poll, the count
	expectOk("live match count shown", await evaluate(`(() => { const el = document.getElementById("detail-filter-count"); return el && !el.hidden && /Matches \\d+ readings right now/.test(el.textContent) ? "ok" : (el ? "text: " + el.textContent : "missing"); })()`));
	await captureClipped("pi-key-detail-filter.png", await evaluate(`(() => {
		const block = document.getElementById("detail-config");
		if (!block) return "missing";
		const r = block.getBoundingClientRect();
		return { y: Math.max(0, Math.floor(r.top + window.scrollY - 10)), h: Math.ceil(r.height + 20) };
	})()`));

	// Back to the plain panel so the later layout shots stay untouched.
	await evaluate(`document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
	await setSelect("detailMode", "source");
	await setSelect("pressBehavior", "");
	await sleep(700);

	// ---- key PI: dual layout (second picker + label + stat, Display row hidden) ----
	await evaluate(`document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
	await setSelect("keyLayout", "dual");
	await sleep(900); // the layout poll reveals #dual-rows within 400 ms
	expectOk("dual rows revealed", await evaluate(`document.getElementById("dual-rows").hidden === false ? "ok" : "hidden"`));
	// Pick a second reading the way a user would: search, take the top row.
	await evaluate(`(() => { const el = document.getElementById("picker2-search"); el.focus(); el.value = "gpu temp"; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
	await sleep(700);
	expectOk("second picker row", await evaluate(`(() => {
		const row = document.querySelector("#picker2-list .hw-row");
		if (!row) return "missing";
		row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
		return "ok";
	})()`));
	await sleep(500);
	const dualHeight = await evaluate(`Math.ceil([...document.body.children].reduce((m, el) => Math.max(m, el.getBoundingClientRect().bottom), 0))`);
	await viewport(Math.min(2400, Math.max(880, Number(dualHeight.result?.value ?? 880) + 16)));
	await sleep(300);
	await capture("pi-key-dual.png");
	await viewport(880);

	// ---- key PI: triple layout (third picker + full-length label, triple help) ----
	// The first two rows inherit the single and dual picks made above, so
	// this shot shows the panel the way a user reaches three rows.
	await setSelect("keyLayout", "triple");
	await sleep(900); // the layout poll reveals #third-slot within 400 ms
	expectOk("third slot revealed", await evaluate(`document.getElementById("third-slot").hidden === false ? "ok" : "hidden"`));
	expectOk("triple help revealed", await evaluate(`document.getElementById("triple-help").hidden === false ? "ok" : "hidden"`));
	expectOk("dual-only stat pin hidden", await evaluate(`document.getElementById("dual-rows").hidden === true ? "ok" : "visible"`));
	expectOk("display row hidden on triple", await evaluate(`document.getElementById("display-item").hidden === true ? "ok" : "visible"`));
	expectOk("third label reads as a normal label in triple", await evaluate(`(() => {
		const el = document.getElementById("third-label");
		const input = (el.shadowRoot ?? el).querySelector("input");
		if (!input) return "no rendered input";
		return input.placeholder === "Custom label (default: sensor name)" ? "ok" : input.placeholder;
	})()`));
	await evaluate(`(() => { const el = document.getElementById("picker3-search"); el.focus(); el.value = "gpu clock"; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
	await sleep(700);
	expectOk("third picker row", await evaluate(`(() => {
		const row = document.querySelector("#picker3-list .hw-row");
		if (!row) return "missing";
		row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
		return "ok";
	})()`));
	await sleep(500);
	const tripleHeight = await evaluate(`Math.ceil([...document.body.children].reduce((m, el) => Math.max(m, el.getBoundingClientRect().bottom), 0))`);
	await viewport(Math.min(2400, Math.max(880, Number(tripleHeight.result?.value ?? 880) + 16)));
	await sleep(300);
	await capture("pi-key-triple.png");
	await viewport(880);

	// ---- key PI: quad layout (fourth picker picked, cell colors row) ----
	// The first three cells inherit the picks made above, so this shot shows
	// all four slots filled the way a user reaches quad.
	await setSelect("keyLayout", "quad");
	await sleep(900); // the layout poll reveals #quad-rows within 400 ms
	expectOk("quad rows revealed", await evaluate(`document.getElementById("quad-rows").hidden === false ? "ok" : "hidden"`));
	expectOk("triple help hidden on quad", await evaluate(`document.getElementById("triple-help").hidden === true ? "ok" : "visible"`));
	expectOk("third label reads as a micro-label in quad", await evaluate(`(() => {
		const el = document.getElementById("third-label");
		const input = (el.shadowRoot ?? el).querySelector("input");
		if (!input) return "no rendered input";
		return input.placeholder === "Short name; 4 characters show" ? "ok" : input.placeholder;
	})()`));
	await evaluate(`(() => { const el = document.getElementById("picker4-search"); el.focus(); el.value = "pump"; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
	await sleep(700);
	expectOk("fourth picker row", await evaluate(`(() => {
		const row = document.querySelector("#picker4-list .hw-row");
		if (!row) return "missing";
		row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
		return "ok";
	})()`));
	await sleep(500);
	await evaluate(`document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
	await sleep(400);
	const quadHeight = await evaluate(`Math.ceil([...document.body.children].reduce((m, el) => Math.max(m, el.getBoundingClientRect().bottom), 0))`);
	await viewport(Math.min(2400, Math.max(880, Number(quadHeight.result?.value ?? 880) + 16)));
	await sleep(300);
	await capture("pi-key-quad.png");
		// The same state clipped to the Layout select and the four cell rows.
		// The marketplace settings shot needs the part that does the work, not
		// the whole panel scaled down until the labels stop reading.
		await captureClipped("pi-key-quad-rows.png", await evaluate(`(() => {
			const sel = document.querySelector('sdpi-select[setting="keyLayout"]');
			const block = document.getElementById("quad-rows");
			if (!sel || !block) return "missing";
			const item = sel.closest("sdpi-item") ?? sel;
			// Start at the "Layout" section heading: clipping from the item
			// shears the heading in half (same lesson as the dial rename shot).
			const heading = item.previousElementSibling?.classList.contains("hw-section") ? item.previousElementSibling : item;
			const top = Math.min(heading.getBoundingClientRect().top, block.getBoundingClientRect().top) + window.scrollY;
			const bottom = block.getBoundingClientRect().bottom + window.scrollY;
			return { y: Math.max(0, Math.floor(top - 10)), h: Math.ceil(bottom - top + 22) };
		})()`));
	await viewport(880);

	// ---- dial PI: the picker's rotation-set checkboxes, mid-tick ----
	log("navigating: sensor-dial");
	await cdp("Page.navigate", { url: `${BASE}/sensor-dial.html` });
	await sleep(8000);
	await evaluate(`(() => { const el = document.getElementById("picker-search"); el.focus(); el.value = "cpu"; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
	await sleep(700);
	// Two rows ticked so the capture shows checked and unchecked boxes side
	// by side; unticked again after the shot (the chips shot below builds
	// the real cross-sensor set).
	await evaluate(`(() => { let n = 0; for (const tick of document.querySelectorAll('#picker-list input.hw-tick:not(:checked)')) { if (n >= 2) break; tick.click(); n++; } return n; })()`);
	await sleep(500);
	await capture("pi-dial-picker.png");
	await evaluate(`(() => { for (const tick of document.querySelectorAll('#picker-list input.hw-tick:checked')) tick.click(); return "ok"; })()`);
	await sleep(400);

	// ---- dial PI: rotation set (cross-sensor ticks, shown as chips) ----
	// Tick one reading from three different sensors, the way a user would:
	// search, then click the row's checkbox. A cross-sensor set is the point.
	for (const query of ["tctl", "gpu temp", "pump"]) {
		await evaluate(`(() => { const el = document.getElementById("picker-search"); el.focus(); el.value = ${JSON.stringify(query)}; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
		await sleep(700);
		await evaluate(`document.querySelector('#picker-list input.hw-tick:not(:checked)')?.click()`);
		await sleep(400);
	}
	// Close the picker (outside mousedown) so the chips under it show.
	await evaluate(`(() => { const el = document.getElementById("picker-search"); el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
	await evaluate(`document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
	await sleep(600);
	await capture("pi-dial-rotation.png");

	// ---- dial PI: chip rename, mid-edit ----
	// Two chips carry custom names, the third is open in its inline input:
	// renamed chips and the edit affordance readable in one shot. Renames go
	// through the production path (click .hw-set-name, then change) rather
	// than writing settings, so the capture proves the interaction the docs
	// describe instead of illustrating it.
	// Two things this has to get right, both learned the hard way:
	//
	// Index the CHIP, not the name span. An open rename replaces its chip's
	// span with an input, so a span-indexed lookup silently shifts onto the
	// next chip and renames the wrong reading.
	//
	// Commit, then blur, then dispatch focusout by hand. renderRotationSet()
	// deliberately defers while a name field is focused (pi-common.js: a
	// settings echo must not clobber typing), and restores the chip on
	// focusout. In the real panel Enter blurs and the browser fires focusout;
	// under headless the document never holds focus, so blur() moves
	// activeElement without dispatching the event and the chip would stay an
	// input forever. Same handler, same result, just not relying on a focus
	// event a headless page does not send.
	const openChipRename = async (index, what) => {
		expectOk(what, await evaluate(`(() => {
			const chip = document.querySelectorAll("#rotation-set .hw-set-chip")[${index}];
			if (!chip) return "missing chip";
			const el = chip.querySelector(".hw-set-name");
			if (!el) return "already open";
			el.click();
			return "ok";
		})()`));
		await sleep(250);
	};
	const renameChip = async (index, name) => {
		await openChipRename(index, `chip ${index} name`);
		expectOk(`chip ${index} rename commit`, await evaluate(`(() => {
			const chip = document.querySelectorAll("#rotation-set .hw-set-chip")[${index}];
			const input = chip && chip.querySelector("input.hw-chip-rename");
			if (!input) return "missing";
			input.value = ${JSON.stringify(name)};
			input.dispatchEvent(new Event("change", { bubbles: true }));
			input.blur();
			input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
			return "ok";
		})()`));
		await sleep(500);
		expectOk(`chip ${index} shows "${name}"`, await evaluate(`(() => {
			const chip = document.querySelectorAll("#rotation-set .hw-set-chip")[${index}];
			const el = chip && chip.querySelector(".hw-set-name");
			if (!el) return "still an input";
			return el.textContent === ${JSON.stringify(name)} ? "ok" : el.textContent;
		})()`));
	};
	await renameChip(0, "CPU");
	await renameChip(1, "GPU");
	// Leave the third open mid-edit with its text selected: the state a user
	// is in one click after reading the bullet this shot sits under.
	await openChipRename(2, "third chip opened for rename");
	expectOk("rename input focused", await evaluate(`(() => {
		const chip = document.querySelectorAll("#rotation-set .hw-set-chip")[2];
		const input = chip && chip.querySelector("input.hw-chip-rename");
		if (!input) return "missing";
		input.value = "Pump";
		input.focus();
		input.setSelectionRange(0, input.value.length);
		return "ok";
	})()`));
	await sleep(300);
	// Clip from the "Rotation" section heading, not from the item: starting at
	// the item shears the heading in half. The help line under the set is the
	// bottom edge, so the crop is a whole section rather than a floating row.
	await captureClipped("pi-dial-rename.png", await evaluate(`(() => {
		const item = document.getElementById("rotation-set").closest("sdpi-item");
		const help = document.getElementById("rotation-help");
		if (!item || !help) return "missing";
		const heading = item.previousElementSibling?.classList.contains("hw-section")
			? item.previousElementSibling
			: item;
		const a = heading.getBoundingClientRect();
		const b = help.getBoundingClientRect();
		const top = Math.min(a.top, b.top) + window.scrollY;
		const bottom = Math.max(a.bottom, b.bottom) + window.scrollY;
		return { y: Math.max(0, Math.floor(top - 8)), h: Math.ceil(bottom - top + 18) };
	})()`));
	// Commit and blur the open edit so the group shots below start from chips,
	// never a stranded input.
	await evaluate(`(() => {
		const input = document.querySelector("#rotation-set input.hw-chip-rename");
		if (input) {
			input.dispatchEvent(new Event("change", { bubbles: true }));
			input.blur();
			input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
		}
		return "ok";
	})()`);
	await sleep(500);

	// ---- dial PI: rotation groups (split set, named, collector radio) ----
	// Split the set built above: group 1 inherits its three readings, the
	// collector radio lands on the new empty group 2, two GPU readings are
	// ticked into it, and both groups get names. Clipped to the set area
	// plus its help line, which is the group editor itself.
	expectOk("Split into groups button", await evaluate(`(() => {
		const b = document.querySelector('#rotation-set button[data-set-action="split"]');
		if (!b) return "missing";
		b.click();
		return "ok";
	})()`));
	await sleep(500);
	const nameGroup = async (index, name) => {
		const res = await evaluate(`(() => {
			const el = document.querySelector('#rotation-set input.hw-group-name[data-group="${index}"]');
			if (!el) return "missing";
			el.value = ${JSON.stringify(name)};
			el.dispatchEvent(new Event("change", { bubbles: true }));
			return "ok";
		})()`);
		expectOk(`group ${index} name field`, res);
	};
	await nameGroup(0, "Overview");
	await sleep(300);
	for (const query of ["gpu hot", "gpu clock"]) {
		await evaluate(`(() => { const el = document.getElementById("picker-search"); el.focus(); el.value = ${JSON.stringify(query)}; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
		await sleep(700);
		await evaluate(`document.querySelector('#picker-list input.hw-tick:not(:checked)')?.click()`);
		await sleep(400);
	}
	await nameGroup(1, "GPU");
	await sleep(300);
	await evaluate(`(() => { const el = document.getElementById("picker-search"); el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
	await evaluate(`document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
	await sleep(600);
	await captureClipped("pi-dial-groups.png", await evaluate(`(() => {
		const item = document.getElementById("rotation-set").closest("sdpi-item");
		const help = document.getElementById("rotation-help");
		if (!item || !help) return "missing";
		const a = item.getBoundingClientRect();
		const b = help.getBoundingClientRect();
		const top = Math.min(a.top, b.top) + window.scrollY;
		const bottom = Math.max(a.bottom, b.bottom) + window.scrollY;
		return { y: Math.max(0, Math.floor(top - 10)), h: Math.ceil(bottom - top + 20) };
	})()`));

	// ---- dial PI: Elite preset under "Dial gestures & advanced" ----
	const openGestures = `(() => {
		for (const d of document.querySelectorAll("details")) d.open = false;
		const g = document.querySelector('details[data-fold="advanced"]');
		if (!g) return "missing";
		g.open = true;
		g.scrollIntoView({ block: "start" });
		return "ok";
	})()`;
	expectOk("Dial gestures details", await evaluate(openGestures));
	await setSelect("controlPreset", "elite");
	await sleep(900); // the PI polls its local settings cache every 400 ms
	await evaluate(openGestures);
	await sleep(300);
	await capture("pi-dial-presets.png");

	// ---- dial PI: Custom gesture rows + touch zones ----
	await setSelect("controlPreset", "custom");
	await sleep(900);
	await viewport(1500);
	await evaluate(openGestures);
	await sleep(300);
	// The page cannot always scroll the section to the top, so clip to it.
	await captureClipped("pi-dial-custom.png", await evaluate(`(() => {
		const g = document.querySelector('details[data-fold="advanced"]');
		const r = g.getBoundingClientRect();
		return { y: Math.max(0, Math.floor(r.top + window.scrollY - 10)), h: Math.ceil(r.height + 20) };
	})()`), { y: 0, h: 1500 });

	// ---- dial PI: overview view (Context line + Separators selects) ----
	await viewport(880);
	await evaluate(`(() => { for (const d of document.querySelectorAll("details")) d.open = false; window.scrollTo(0, 0); return "ok"; })()`);
	await setSelect("dialView", "overview");
	await sleep(900); // the view poll reveals #overview-rows within 400 ms
	expectOk("overview rows revealed", await evaluate(
		`document.getElementById("overview-rows").hidden === false && document.getElementById("overview-three-rows").hidden === false ? "ok" : "hidden"`
	));
	// Clip to the View select plus the controls it revealed: row labels,
	// context line and separators, with the help line under them.
	await captureClipped("pi-dial-overview.png", await evaluate(`(() => {
		const sel = document.querySelector('sdpi-select[setting="dialView"]');
		const block = document.getElementById("overview-rows");
		if (!sel || !block) return "missing";
		const item = sel.closest("sdpi-item") ?? sel;
		const a = item.getBoundingClientRect();
		const b = block.getBoundingClientRect();
		const top = Math.min(a.top, b.top) + window.scrollY;
		const bottom = Math.max(a.bottom, b.bottom) + window.scrollY;
		return { y: Math.max(0, Math.floor(top - 10)), h: Math.ceil(bottom - top + 20) };
	})()`));

	// ---- dial PI: Text set to Custom (same rows as the key PI) ----
	await setSelect("dialView", "single");
	await sleep(600);
	await setSelect("textMode", "custom");
	await sleep(900);
	expectOk("dial text custom rows revealed", await evaluate(`document.getElementById("text-custom").hidden === false ? "ok" : "hidden"`));
	await captureClipped("pi-dial-text.png", await evaluate(`(() => {
		const sel = document.querySelector('sdpi-select[setting="textMode"]');
		const block = document.getElementById("text-custom");
		if (!sel || !block) return "missing";
		const items = [sel.closest("sdpi-item") ?? sel, block];
		const top = Math.min(...items.map((el) => el.getBoundingClientRect().top)) + window.scrollY;
		const bottom = Math.max(...items.map((el) => el.getBoundingClientRect().bottom)) + window.scrollY;
		// Tight top: -10 shears the tail of the theme help line above the row.
		return { y: Math.max(0, Math.floor(top - 2)), h: Math.ceil(bottom - top + 12) };
	})()`));
	await setSelect("textMode", "");
	await sleep(400);

	// ---- HWiNFO Control PI: command + Link ID target ----
	log("navigating: control");
	await viewport(880);
	await cdp("Page.navigate", { url: `${BASE}/control.html` });
	await sleep(4000);
	// Every collapsible open: a capture with folded sections reads as a
	// half-empty panel. Then fit the viewport to the content, no dead space.
	await evaluate(`(() => { for (const d of document.querySelectorAll("details")) d.open = true; return "ok"; })()`);
	await sleep(400);
	// body fills the viewport, so measure the lowest child instead.
	const height = await evaluate(`Math.ceil([...document.body.children].reduce((m, el) => Math.max(m, el.getBoundingClientRect().bottom), 0))`);
	const h = Math.min(1600, Math.max(400, Number(height.result?.value ?? 880) + 16));
	await viewport(h);
	await sleep(300);
	await capture("pi-control.png");

	console.log(`captured 21 PI states to ${outDir}`);
} finally {
	// The open CDP socket would otherwise hold the event loop until the
	// watchdog fires — close it, then take the browser tree down.
	cdpSocket?.terminate();
	killChromeTree();
}
