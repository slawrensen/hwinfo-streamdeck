// Full-page screenshots of a published docs site at a desktop and a phone
// width, in headless Chrome over CDP (the same driver scripts/capture-pi.mjs
// uses), with a manifest naming the URL, viewport, time and the deployment
// commit each file came from. Fonts and images are waited for, lazy images
// are scrolled into view, and console errors and failed requests are
// counted per page so a broken asset fails the run instead of hiding in a
// pretty picture.
//
//   node scripts/docs-site-shots.mjs <outDir> <site root url> [commit] [page ...]
//   node scripts/docs-site-shots.mjs release/docs-shots https://docs.slawrensen.com/hwinfo-streamdeck/ f8047ba
//
// Without page names it captures the pages listed in PAGES. Exit 1 when a
// page logs a console error or a request fails.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import WebSocket from "ws";

const [outDir, root, commit = "unknown", ...only] = process.argv.slice(2);
if (typeof outDir !== "string" || typeof root !== "string" || !/^https?:\/\//.test(root)) {
	console.error("usage: node scripts/docs-site-shots.mjs <outDir> <site root url> [commit] [page ...]");
	process.exit(2);
}
const base = root.endsWith("/") ? root : `${root}/`;
const PAGES = ["", "getting-started.html", "installation.html", "data-sources.html", "sensor-reading.html", "sensor-details.html", "sensor-dial.html", "status-screens.html", "troubleshooting.html", "faq.html", "hardware.html", "changelog.html"];
const pages = only.length > 0 ? only : PAGES;
const VIEWPORTS = [
	{ name: "desktop", width: 1280, height: 900 },
	{ name: "mobile", width: 390, height: 844, mobile: true }
];
const DEBUG_PORT = 29224;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(outDir, { recursive: true });

const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${path.join(process.env.TEMP ?? ".", "docs-shots-profile")}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
function killChromeTree() {
	try {
		spawnSync("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
	} catch {
		chrome.kill();
	}
}
const watchdog = setTimeout(() => {
	console.error("[docs-shots] watchdog: 300s elapsed, aborting");
	killChromeTree();
	process.exit(2);
}, 300000);
watchdog.unref();

let cdpSocket = null;
const manifest = [];
let failures = 0;
try {
	let target = null;
	for (let i = 0; i < 30 && target === null; i++) {
		await sleep(500);
		try {
			const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
			target = list.find((t) => t.type === "page") ?? null;
		} catch {
			/* not up yet */
		}
	}
	if (target === null) throw new Error("chrome debugger never came up");
	const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
	cdpSocket = ws;
	await new Promise((resolve, reject) => {
		ws.once("open", resolve);
		ws.once("error", reject);
	});
	let seq = 0;
	const pending = new Map();
	const consoleErrors = [];
	const failedRequests = [];
	ws.on("message", (data) => {
		const msg = JSON.parse(data.toString());
		if (msg.id !== undefined && pending.has(msg.id)) {
			pending.get(msg.id)(msg);
			pending.delete(msg.id);
			return;
		}
		if (msg.method === "Runtime.exceptionThrown") consoleErrors.push(msg.params?.exceptionDetails?.text ?? "exception");
		if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") consoleErrors.push(String(msg.params?.args?.[0]?.value ?? "console.error"));
		if (msg.method === "Network.loadingFailed") failedRequests.push(msg.params?.errorText ?? "loadingFailed");
		// Only the site's own path counts: the browser's automatic
		// /favicon.ico probe at the domain root belongs to the umbrella site.
		if (msg.method === "Network.responseReceived" && (msg.params?.response?.status ?? 0) >= 400 && String(msg.params.response.url).startsWith(base)) failedRequests.push(`${msg.params.response.status} ${msg.params.response.url}`);
	});
	const cdp = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = ++seq;
			pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
			ws.send(JSON.stringify({ id, method, params }));
		});
	const evaluate = (expression) => cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
	await cdp("Page.enable");
	await cdp("Runtime.enable");
	await cdp("Network.enable");

	for (const vp of VIEWPORTS) {
		await cdp("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile === true });
		for (const page of pages) {
			const url = `${base}${page}`;
			consoleErrors.length = 0;
			failedRequests.length = 0;
			await cdp("Page.navigate", { url });
			await sleep(1500);
			// Fonts, then every image (lazy ones scrolled into view first).
			await evaluate(`(async () => {
				await document.fonts.ready;
				for (const img of document.images) { img.scrollIntoView({ block: "center" }); img.loading = "eager"; }
				await Promise.all([...document.images].map((img) => img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; })));
				window.scrollTo(0, 0);
				return "ok";
			})()`);
			await sleep(400);
			const metrics = JSON.parse((await evaluate(`JSON.stringify({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, inner: window.innerWidth, broken: [...document.images].filter((i) => i.naturalWidth === 0).map((i) => i.currentSrc || i.src) })`)).result?.value ?? "{}");
			const shot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: vp.width, height: Math.min(metrics.h ?? vp.height, 16000), scale: 1 } });
			const file = `${vp.name}-${page === "" ? "index" : page.replace(/\.html$/, "")}.png`;
			writeFileSync(path.join(outDir, file), Buffer.from(shot.data, "base64"));
			const overflow = (metrics.w ?? 0) > (metrics.inner ?? vp.width);
			const entry = { file, url, viewport: `${vp.width}x${vp.height}`, capturedAt: new Date().toISOString(), commit, pageHeight: metrics.h, sidewaysOverflow: overflow, brokenImages: metrics.broken ?? [], consoleErrors: [...consoleErrors], failedRequests: [...failedRequests] };
			manifest.push(entry);
			const bad = overflow || entry.brokenImages.length > 0 || entry.consoleErrors.length > 0 || entry.failedRequests.length > 0;
			if (bad) failures += 1;
			console.log(`${bad ? "FAIL" : "ok  "} ${vp.name.padEnd(7)} ${url} (${metrics.h}px${overflow ? ", SIDEWAYS OVERFLOW" : ""}${entry.brokenImages.length > 0 ? `, ${entry.brokenImages.length} broken image(s)` : ""}${entry.consoleErrors.length > 0 ? `, ${entry.consoleErrors.length} console error(s)` : ""}${entry.failedRequests.length > 0 ? `, ${entry.failedRequests.length} failed request(s)` : ""})`);
		}
	}
	writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, "\t"));
	console.log(`${manifest.length} screenshots and manifest.json in ${outDir}`);
} finally {
	cdpSocket?.terminate();
	killChromeTree();
}
console.log(failures === 0 ? "DOCS SHOTS: every page clean" : `DOCS SHOTS: ${failures} page capture(s) with problems`);
process.exit(failures === 0 ? 0 : 1);
