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
// page logs a console error or a request fails. Full-page captures are never
// truncated; a second -viewport.png file records the opening view.
// Set CHROME (or CHROME_PATH) for a custom executable. Additional passes:
// DOCS_SHOTS_VIEWPORTS=360x800,768x1024,1440x900,2560x1440 node scripts/docs-site-shots.mjs ...
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import WebSocket from "ws";
import { browserDebuggerPort, cleanupBrowser, createBrowserProfile } from "./lib/process-ownership.mjs";

const [outDir, root, commit = "unknown", ...only] = process.argv.slice(2);
if (typeof outDir !== "string" || typeof root !== "string" || !/^https?:\/\//.test(root)) {
	console.error("usage: node scripts/docs-site-shots.mjs <outDir> <site root url> [commit] [page ...]");
	process.exit(2);
}
const base = root.endsWith("/") ? root : `${root}/`;
const PAGES = ["", "installation.html", "getting-started.html", "sensor-reading.html", "sensor-details.html", "sensor-dial.html", "controls.html", "themes.html", "thresholds-alerts.html", "data-sources.html", "hardware.html", "whats-new-1.7.html", "changelog.html", "status-screens.html", "troubleshooting.html", "faq.html", "404.html"];
const pages = only.length > 0 ? only : PAGES;
const VIEWPORTS = process.env.DOCS_SHOTS_VIEWPORTS
	? process.env.DOCS_SHOTS_VIEWPORTS.split(",").map((item) => {
		const match = /^(\d{3,4})x(\d{3,4})$/.exec(item.trim());
		if (!match || Number(match[1]) < 320 || Number(match[2]) < 300) throw new Error("DOCS_SHOTS_VIEWPORTS must be a comma-separated list such as 360x800,768x1024,1440x900,2560x1440");
		return { name: `${match[1]}x${match[2]}`, width: Number(match[1]), height: Number(match[2]), mobile: Number(match[1]) < 768 };
	})
	: [{ name: "desktop", width: 1280, height: 800 }, { name: "mobile", width: 390, height: 844, mobile: true }];
// An explicit path is authoritative. Never silently switch browsers if it is wrong.
const candidates = process.platform === "win32"
	? [path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Google/Chrome/Application/chrome.exe"), path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Google/Chrome/Application/chrome.exe")]
	: process.platform === "darwin"
		? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
		: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/opt/pw-browsers/chromium"];
const CHROME = process.env.CHROME ?? process.env.CHROME_PATH ?? candidates.find((candidate) => existsSync(candidate));
if (!CHROME || !existsSync(CHROME)) throw new Error("No Chrome/Chromium binary found. Set CHROME to an installed executable.");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(outDir, { recursive: true });

const chromeProfile = createBrowserProfile("docs-shots-profile-");
const chromeStartedAt = new Date().toISOString();
const chromeArgs = ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${chromeProfile}`, "about:blank"];
// A disposable browser in a root-owned Linux container needs this. It never
// opens an existing profile, session, or shared debugging port.
if (process.platform === "linux" && process.getuid?.() === 0) chromeArgs.unshift("--no-sandbox");
const chrome = spawn(CHROME, chromeArgs, { stdio: "ignore", windowsHide: true });
let chromeError;
chrome.once("error", (err) => { chromeError = err; });
async function killChromeTree() {
	if (process.platform === "win32") {
		cleanupBrowser(chromeProfile, chromeStartedAt);
	} else if (chrome.pid && chrome.exitCode === null && chrome.signalCode === null) {
		// ChildProcess retains the launched process identity. No process-name,
		// fixed-port, inherited-session, or broad PID sweeps are permitted.
		await new Promise((resolve) => {
			let force;
			let deadline;
			const done = () => { clearTimeout(force); clearTimeout(deadline); resolve(); };
			chrome.once("exit", done);
			chrome.kill("SIGTERM");
			force = setTimeout(() => {
				if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill("SIGKILL");
			}, 2000);
			deadline = setTimeout(done, 4000);
		});
		if (chrome.exitCode === null && chrome.signalCode === null) throw new Error("Owned screenshot browser did not exit; its disposable profile was retained.");
	}
	rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
const watchdogMs = Math.max(300000, pages.length * VIEWPORTS.length * 20000);
const watchdog = setTimeout(async () => {
	console.error(`[docs-shots] watchdog: ${watchdogMs / 1000}s elapsed, aborting`);
	try {
		await killChromeTree();
	} finally {
		process.exit(2);
	}
}, watchdogMs);
watchdog.unref();

let cdpSocket = null;
let closeRemote = null;
const manifest = [];
let failures = 0;
let stopping = false;
const onSignal = async (signal) => {
	if (stopping) return;
	stopping = true;
	try {
		cdpSocket?.terminate();
		await killChromeTree();
	} finally { process.exit(signal === "SIGINT" ? 130 : 143); }
};
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);
try {
	let target = null;
	for (let i = 0; i < 30 && target === null; i++) {
		await sleep(500);
		if (chromeError) throw chromeError;
		// The Windows launcher can exit zero after handing off to its browser.
		// Readiness still requires the debugger from this run's unique profile.
		if ((chrome.exitCode !== null && chrome.exitCode !== 0) || chrome.signalCode !== null) throw new Error(`Chrome exited before its debugger became ready (exit ${chrome.exitCode}, signal ${chrome.signalCode})`);
		try {
			const debugPort = browserDebuggerPort(chromeProfile);
			const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
			target = list.find((t) => t.type === "page") ?? null;
		} catch {
			/* not up yet */
		}
	}
	if (target === null) throw new Error("chrome debugger never came up");
	const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
	cdpSocket = ws;
	await new Promise((resolve, reject) => {
		ws.once("open", resolve);
		ws.once("error", reject);
	});
	let seq = 0;
	const pending = new Map();
	const consoleErrors = [];
	const failedRequests = [];
	let currentPage = "";
	let documentStatus = null;
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
		if (msg.method === "Network.responseReceived") {
			const response = msg.params?.response;
			if (msg.params?.type === "Document") documentStatus = response?.status;
			const expected404 = currentPage === "404.html" && response?.status === 404 && response?.url === `${base}404.html`;
			if ((response?.status ?? 0) >= 400 && String(response.url).startsWith(base) && !expected404) failedRequests.push(`${response.status} ${response.url}`);
		}
	});
	const cdp = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = ++seq;
			pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
			ws.send(JSON.stringify({ id, method, params }));
		});
	const evaluate = async (expression) => {
		const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
		if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
		return result;
	};
	closeRemote = async () => {
		let timeout;
		try {
			await Promise.race([cdp("Browser.close"), new Promise((resolve) => { timeout = setTimeout(resolve, 2000); })]);
		} finally { clearTimeout(timeout); }
	};
	await cdp("Page.enable");
	await cdp("Runtime.enable");
	await cdp("Network.enable");

	for (const vp of VIEWPORTS) {
		await cdp("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile === true });
		for (const page of pages) {
			const url = `${base}${page}`;
			currentPage = page;
			documentStatus = null;
			consoleErrors.length = 0;
			failedRequests.length = 0;
			const navigation = await cdp("Page.navigate", { url });
			if (navigation.errorText) throw new Error(`Navigation failed for ${url}: ${navigation.errorText}`);
			await sleep(350);
			for (let attempt = 0; attempt < 60; attempt++) {
				const ready = (await evaluate(`document.readyState === "complete" && location.href === ${JSON.stringify(url)}`)).result?.value;
				if (ready) break;
				if (attempt === 59) throw new Error(`Page did not finish loading: ${url}`);
				await sleep(250);
			}
			// Fonts, then every image (lazy ones scrolled into view first).
			await evaluate(`(async () => {
				await Promise.race([document.fonts.ready, new Promise((_, reject) => setTimeout(() => reject(new Error("Fonts did not settle")), 15000))]);
				const images = [...document.images];
				const painted = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
				for (const img of images) img.loading = "eager";
				await Promise.race([Promise.all(images.map((img) => img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))), new Promise((_, reject) => setTimeout(() => reject(new Error("Images did not settle")), 15000))]);
				await Promise.race([Promise.all(images.filter((img) => img.naturalWidth > 0).map((img) => img.decode())), new Promise((_, reject) => setTimeout(() => reject(new Error("Images did not decode")), 15000))]);
				// A loaded lazy image can still be absent from an offscreen paint.
				// Visit each image and give the compositor two frames. Explicit
				// instant scrolling also avoids inheriting a site's smooth scroll.
				for (const img of images) { img.scrollIntoView({ block: "center", behavior: "instant" }); await painted(); }
				window.scrollTo({ top: 0, left: 0, behavior: "instant" });
				await painted();
				return "ok";
			})()`);
			await sleep(400);
			const metrics = JSON.parse((await evaluate(`JSON.stringify({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, inner: window.innerWidth, broken: [...document.images].filter((i) => i.naturalWidth === 0).map((i) => i.currentSrc || i.src) })`)).result?.value ?? "{}");
			const shot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: vp.width, height: metrics.h ?? vp.height, scale: 1 } });
			const file = `${vp.name}-${page === "" ? "index" : page.replace(/\.html$/, "")}.png`;
			writeFileSync(path.join(outDir, file), Buffer.from(shot.data, "base64"));
			const viewportShot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
			const viewportFile = file.replace(/\.png$/, "-viewport.png");
			writeFileSync(path.join(outDir, viewportFile), Buffer.from(viewportShot.data, "base64"));
			const overflow = (metrics.w ?? 0) > (metrics.inner ?? vp.width);
			const entry = { file, viewportFile, url, documentStatus, viewport: `${vp.width}x${vp.height}`, capturedAt: new Date().toISOString(), commit, pageHeight: metrics.h, sidewaysOverflow: overflow, brokenImages: metrics.broken ?? [], consoleErrors: [...consoleErrors], failedRequests: [...failedRequests] };
			manifest.push(entry);
			const bad = (documentStatus !== 200 && !(page === "404.html" && documentStatus === 404)) || overflow || entry.brokenImages.length > 0 || entry.consoleErrors.length > 0 || entry.failedRequests.length > 0;
			if (bad) failures += 1;
			console.log(`${bad ? "FAIL" : "ok  "} ${vp.name.padEnd(7)} ${url} (${metrics.h}px${overflow ? ", SIDEWAYS OVERFLOW" : ""}${entry.brokenImages.length > 0 ? `, ${entry.brokenImages.length} broken image(s)` : ""}${entry.consoleErrors.length > 0 ? `, ${entry.consoleErrors.length} console error(s)` : ""}${entry.failedRequests.length > 0 ? `, ${entry.failedRequests.length} failed request(s)` : ""})`);
		}
	}
	writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, "\t"));
	console.log(`${manifest.length} screenshots and manifest.json in ${outDir}`);
} finally {
	clearTimeout(watchdog);
	process.off("SIGINT", onSignal);
	process.off("SIGTERM", onSignal);
	try { await closeRemote?.(); } catch { /* the owned process cleanup below remains authoritative */ }
	cdpSocket?.terminate();
	await killChromeTree();
}
console.log(failures === 0 ? "DOCS SHOTS: every page clean" : `DOCS SHOTS: ${failures} page capture(s) with problems`);
process.exit(failures === 0 ? 0 : 1);
