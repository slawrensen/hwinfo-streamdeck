// Focused capture of the shipped 1.7 dial PI. Requires the existing built
// bundle and live HWiNFO, but never builds, installs or restarts Stream Deck.
// Usage: node scripts/capture-pi-reading-colors.mjs [outDir=docs/assets/img]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import WebSocket from "ws";
import { browserDebuggerPort, cleanupBrowser, createBrowserProfile, createChildCleanup } from "./lib/process-ownership.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] ?? path.join(root, "docs/assets/img"));
const profile = createBrowserProfile("hwinfo-docs-pi-");
const browserStartedAt = new Date().toISOString();
const base = "http://127.0.0.1:28997";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (content) => createHash("sha256").update(content).digest("hex");
const keys = ["f0000501:0:1000000", "e0002000:0:1000000", "f7006687:0:3000001", "e0002000:0:5000000", "e0002000:0:7000000"];
const labels = ["CPU Temp", "GPU Temp", "Pump", "GPU Power", "GPU Load"];
const settings = { readingKey: keys[0], rotationKeys: keys, rotationNames: Object.fromEntries(keys.map((key, i) => [key, labels[i]])), dialView: "overview", overviewLabels: "full", theme: "void", textMode: "theme", sensorValueColors: false };
const globals = { theme: "void", typeAccents: "off", textMode: "theme", source: "shared-memory" };
mkdirSync(out, { recursive: true });

// Refuse to share the mutable mock socket with another capture session.
try {
	await fetch(base, { signal: AbortSignal.timeout(700) });
	throw new Error("A PI harness is already running on port 28997. Stop that capture before starting this one.");
} catch (error) {
	if (error.message.startsWith("A PI harness")) throw error;
}
let harness;
let chrome;
let socket;
let harnessOutput = "";
let harnessError;
let chromeError;
const children = createChildCleanup({ runDirectories: [path.join(root, "com.lawrensen.hwinfo.sdPlugin"), profile] });
const stop = () => {
	socket?.terminate();
	// Try both independent cleanup paths even if one reports a survivor.
	const failures = [];
	for (const clean of [() => cleanupBrowser(profile, browserStartedAt), () => children.cleanup()]) {
		try { clean(); } catch (error) { failures.push(error); }
	}
	if (failures.length) throw new AggregateError(failures, "PI capture cleanup failed");
};
const watchdog = setTimeout(() => {
	try { stop(); } catch (error) { console.error(error); }
	console.error("PI capture exceeded 90 seconds");
	process.exit(2);
}, 90_000);
watchdog.unref();
try {
	harness = spawn(process.execPath, ["scripts/pi-harness.mjs"], { cwd: root, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
	harness.once("error", (error) => { harnessError = error; });
	harness.stdout.on("data", (chunk) => { harnessOutput += chunk.toString(); });
	harness.stderr.on("data", (chunk) => { harnessOutput += chunk.toString(); });
	children.observe();
	for (let attempt = 0; attempt < 40 && !harnessOutput.includes("PI at"); attempt++) {
		await sleep(100);
		if (harnessError) throw harnessError;
		if (harness.exitCode !== null) throw new Error(`Harness exited: ${harnessOutput}`);
	}
	assert.ok(harnessOutput.includes("PI at"), `Harness did not start: ${harnessOutput}`);
	children.observe();
	chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore", windowsHide: true });
	chrome.once("error", (error) => { chromeError = error; });
	let target;
	for (let attempt = 0; attempt < 40 && !target; attempt++) {
		await sleep(100);
		if (chromeError) throw chromeError;
		if (chrome.exitCode !== null) throw new Error("Chrome exited before its debugger started");
		try {
			const debugPort = browserDebuggerPort(profile);
			target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(700) })).json()).find((tab) => tab.type === "page");
		} catch { /* Chrome is starting. */ }
	}
	assert.ok(target, "Chrome debugger did not start");
	socket = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
	await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
	let sequence = 0;
	const pending = new Map();
	socket.on("message", (raw) => {
		const message = JSON.parse(raw.toString());
		const settle = pending.get(message.id);
		if (settle) { pending.delete(message.id); settle(message); }
	});
	const cdp = (method, params = {}) => new Promise((resolve, reject) => {
		const id = ++sequence;
		const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out: ${params.expression ?? ""}`)); }, 15_000);
		pending.set(id, (message) => { clearTimeout(timeout); return message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result); });
		socket.send(JSON.stringify({ id, method, params }));
	});
	const evaluate = async (expression) => {
		const response = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
		assert.equal(response.exceptionDetails, undefined, JSON.stringify(response.exceptionDetails));
		return response.result?.value;
	};
	await cdp("Emulation.setDeviceMetricsOverride", { width: 400, height: 1600, deviceScaleFactor: 2, mobile: false });
	await cdp("Page.enable");
	await cdp("Page.navigate", { url: `${base}/ui/sensor-dial.html` });
	await sleep(6000);
	console.log("PI loaded; applying capture settings");
	const applyConfig = async (scope, document) => {
		assert.equal(await evaluate(`(() => {
			const el = window.document.getElementById(${JSON.stringify(`config-${scope}`)});
			if (!el) return false;
			el.value = ${JSON.stringify(JSON.stringify(document))};
			el.dispatchEvent(new Event("input", { bubbles: true }));
			window.document.getElementById(${JSON.stringify(`config-${scope}-apply`)}).click();
			return true;
		})()`), true);
		await sleep(2500);
	};
	await applyConfig("deck", globals);
	await applyConfig("key", settings);
	assert.equal(await evaluate(`(() => {
		const el = document.getElementById("reading-color-preset");
		if (!el || document.getElementById("sensor-value-colors").hidden) return false;
		el.value = "signal";
		el.dispatchEvent(new Event("change", { bubbles: true }));
		return true;
	})()`), true);
	await sleep(900);
	console.log("Signal preset selected; validating captured settings");
	const evidence = await evaluate(`(() => ({
		build: window.__hwPiVersion,
		rows: [...document.querySelectorAll("#reading-color-list .hw-quad-colors")].map(row => ({ key: row.querySelector("input").dataset.key, label: row.querySelector("label").textContent, color: row.querySelector("input").value })),
		preset: document.getElementById("reading-color-preset").value,
		liveValue: document.getElementById("preview-value").textContent,
		statusHint: document.getElementById("status-hint").hidden ? "" : document.getElementById("status-hint").textContent
	}))()`);
	assert.match(evidence.build, /^1\.7\.0\.0-/);
	assert.equal(evidence.preset, "signal");
	assert.deepEqual(evidence.rows.map((row) => row.label), labels);
	assert.deepEqual(evidence.rows.map((row) => row.color.toUpperCase()), ["#4CC2FF", "#FF7E8E", "#38CD89", "#D4AB33", "#4CC2FF"]);
	assert.match(evidence.liveValue, /\d/);
	assert.equal(evidence.statusHint, "");
	const face = await (await fetch(`${base}/face/ctx-dial.svg`)).text();
	assert.ok(!face.includes("Sensor missing") && !face.includes("No new data"), "The live dial must resolve the selected readings");
	for (const color of ["#4CC2FF", "#FF7E8E", "#38CD89"]) assert.ok(face.toUpperCase().includes(color), `Live dial is missing ${color}`);
	evidence.appliedSettings = { ...settings, readingColors: Object.fromEntries(evidence.rows.map((row) => [row.key, row.color])) };
	evidence.appliedGlobals = globals;
	evidence.liveDialSha256 = sha256(face);
	console.log("UI state verified; capturing Appearance");
	const clip = await evaluate(`(() => {
		for (const fold of document.querySelectorAll("details")) fold.open = false;
		const head = [...document.querySelectorAll(".hw-section")].find(el => el.textContent === "Appearance");
		const tail = document.getElementById("sensor-value-colors");
		const top = Math.floor(head.getBoundingClientRect().top + window.scrollY - 8);
		const bottom = Math.ceil(tail.getBoundingClientRect().bottom + window.scrollY + 8);
		return { x: 0, y: top, width: 400, height: bottom - top, scale: 1 };
	})()`);
	const capture = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip });
	const panel = Buffer.from(capture.data, "base64");
	const size = await sharp(panel).metadata();
	// The title is external board chrome. The panel itself stays pixel exact.
	// This visible stamp comes from the running page's own build marker.
	const header = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="92"><rect width="100%" height="100%" fill="#202226"/><g font-family="Segoe UI, Arial"><text x="24" y="35" font-size="25" fill="#F0F2F5">Dial appearance</text><text x="24" y="68" font-size="19" fill="#B3BAC7">Property inspector · UI build ${evidence.build}</text></g></svg>`);
	const file = path.join(out, "pi-dial-reading-colors-1.7.png");
	await sharp({ create: { width: size.width, height: size.height + 92, channels: 3, background: "#2D2D2D" } }).composite([{ input: header, left: 0, top: 0 }, { input: panel, left: 0, top: 92 }]).png().toFile(file);
	const sourceFiles = ["com.lawrensen.hwinfo.sdPlugin/ui/sensor-dial.html", "com.lawrensen.hwinfo.sdPlugin/ui/pi-common.js", "com.lawrensen.hwinfo.sdPlugin/ui/pi.css", "com.lawrensen.hwinfo.sdPlugin/bin/plugin.js"];
	writeFileSync(path.join(out, "pi-dial-reading-colors-1.7.provenance.json"), `${JSON.stringify({ command: "node scripts/capture-pi-reading-colors.mjs", kind: "Real property-inspector screenshot", note: "Unmodified shipped panel, cropped to Appearance. The external title bar reports the running page's build marker. Captured in a separate mock Stream Deck harness with live HWiNFO Shared Memory. No installed app changes, hardware screenshot claim or sample readings.", captureTime: new Date().toISOString(), panelSha256: sha256(panel), file: path.basename(file), sha256: sha256(readFileSync(file)), width: size.width, height: size.height + 92, evidence, sourceSha256: Object.fromEntries(sourceFiles.map((source) => [source, sha256(readFileSync(path.join(root, source)))])) }, null, "\t")}\n`);
	console.log(`wrote ${file} (${size.width}x${size.height + 92}), UI build ${evidence.build}`);
} finally {
	clearTimeout(watchdog);
	stop();
}
