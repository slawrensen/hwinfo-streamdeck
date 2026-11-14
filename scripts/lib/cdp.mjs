/**
 * A small Chrome DevTools Protocol client for the property-inspector labs:
 * launches a headless Chromium with its own throwaway profile, attaches to
 * the first page, and exposes the handful of commands the panel suites use
 * (evaluate, screenshot, viewport, real key and mouse input). Plain CDP over
 * `ws`, the pattern capture-pi.mjs and e2e-pi-persistence.mjs already use,
 * so no browser-automation dependency joins the repo.
 *
 * The browser binary comes from CHROME when set; otherwise the Windows
 * Chrome path the Windows harnesses use, or the Playwright-managed Chromium
 * a Linux container provides. Only the process this module spawned, and on
 * Windows the processes launched with its own throwaway profile, are ever
 * stopped: no name-based sweeps of other browsers. (On Windows the spawned
 * chrome.exe can hand off to a browser process that outlives it and keeps
 * its connections open; close() stops that one too.)
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { browserDebuggerPort, cleanupBrowser } from "./process-ownership.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function chromePath() {
	if (process.env.CHROME) return process.env.CHROME;
	if (process.platform === "win32") return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
	for (const candidate of ["/opt/pw-browsers/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]) {
		if (existsSync(candidate)) return candidate;
	}
	throw new Error("No Chromium found: set CHROME to a Chrome or Chromium binary.");
}

/** The bounded CDP connection, also used by the loopback fault tests. */
export async function connectCdp(url, { connectTimeoutMs = 5000, commandTimeoutMs = 10_000, navigationTimeoutMs = 10_000 } = {}) {
	for (const [name, value] of Object.entries({ connectTimeoutMs, commandTimeoutMs, navigationTimeoutMs })) {
		if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
	}
	const ws = new WebSocket(url, { maxPayload: 256 * 1024 * 1024 });
	let seq = 0;
	let failure = null;
	const pending = new Map();
	const listeners = new Map();
	const failureWaiters = new Set();
	const fail = (error) => {
		if (failure !== null) return;
		failure = error;
		for (const request of pending.values()) request.finish(error);
		for (const reject of failureWaiters) reject(error);
		failureWaiters.clear();
	};
	ws.on("error", (error) => fail(new Error(`CDP socket error: ${error.message}`, { cause: error })));
	ws.on("close", (code) => fail(new Error(`CDP socket closed (${code})`)));
	ws.on("message", (data) => {
		let msg;
		try {
			msg = JSON.parse(data.toString());
			if (msg === null || typeof msg !== "object") throw new Error("expected an object");
		} catch (error) {
			fail(new Error(`Invalid CDP response: ${error.message}`, { cause: error }));
			ws.terminate();
			return;
		}
		if (msg.id !== undefined && pending.has(msg.id)) {
			const request = pending.get(msg.id);
			request.finish(msg.error ? new Error(`${request.method}: ${msg.error.message}`) : null, msg.result);
		} else if (msg.method !== undefined) {
			for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
		}
	});
	try {
		await new Promise((resolve, reject) => {
			const opened = () => { cleanup(); resolve(); };
			const rejected = (error) => { cleanup(); reject(error); };
			const timer = setTimeout(() => fail(new Error(`CDP connect timed out after ${connectTimeoutMs} ms`)), connectTimeoutMs);
			const cleanup = () => {
				clearTimeout(timer);
				ws.off("open", opened);
				failureWaiters.delete(rejected);
			};
			failureWaiters.add(rejected);
			ws.once("open", opened);
		});
	} catch (error) {
		ws.terminate();
		throw error;
	}
	const send = (method, params = {}) => new Promise((resolve, reject) => {
		if (failure !== null) return reject(failure);
		if (ws.readyState !== WebSocket.OPEN) return reject(new Error("CDP socket is not open"));
		const id = ++seq;
		const finish = (error, result) => {
			if (!pending.delete(id)) return;
			clearTimeout(timer);
			if (error) reject(error);
			else resolve(result);
		};
		const timer = setTimeout(() => finish(new Error(`${method}: CDP command timed out after ${commandTimeoutMs} ms`)), commandTimeoutMs);
		pending.set(id, { method, finish });
		try {
			ws.send(JSON.stringify({ id, method, params }), (error) => {
				if (error) fail(new Error(`CDP send failed: ${error.message}`, { cause: error }));
			});
		} catch (error) {
			finish(error);
		}
	});
	const on = (method, fn) => {
		const list = listeners.get(method) ?? [];
		list.push(fn);
		listeners.set(method, list);
		return () => {
			const at = list.indexOf(fn);
			if (at >= 0) list.splice(at, 1);
			if (list.length === 0) listeners.delete(method);
		};
	};
	return {
		send,
		on,
		async goto(targetUrl) {
			if (failure !== null) throw failure;
			let off;
			let timer;
			let rejectLoad;
			let resolveLoad;
			let expectedLoad = null;
			const earlyLoads = new Set();
			const loaded = new Promise((resolve, reject) => {
				resolveLoad = resolve;
				rejectLoad = reject;
				failureWaiters.add(reject);
				// A timed-out previous page may finish while this one navigates.
				// Only this navigation's frame and loader can prove it loaded.
				// Fast pages can report load before Page.navigate replies.
				off = on("Page.lifecycleEvent", (event) => {
					if (event?.name !== "load" || typeof event.frameId !== "string" || typeof event.loaderId !== "string") return;
					const key = JSON.stringify([event.frameId, event.loaderId]);
					if (expectedLoad !== null) {
						if (key === expectedLoad) resolve();
					} else {
						if (!earlyLoads.has(key) && earlyLoads.size >= 64) {
							reject(new Error("Page.navigate: too many load events before its reply"));
							return;
						}
						earlyLoads.add(key);
					}
				});
				timer = setTimeout(() => reject(new Error(`Page.navigate: load timed out after ${navigationTimeoutMs} ms (${targetUrl})`)), navigationTimeoutMs);
			});
			try {
				// Attach both rejection handlers before either operation can fail.
				await Promise.all([loaded, send("Page.navigate", { url: targetUrl }).then((result) => {
					if (!result || typeof result.frameId !== "string") throw new Error("Page.navigate: response has no frameId");
					if (result.errorText) throw new Error(`Page.navigate: ${result.errorText} (${targetUrl})`);
					if (result.isDownload) throw new Error(`Page.navigate: download instead of a page (${targetUrl})`);
					// Same-document navigations have no loader and emit no load event.
					if (!result.loaderId) resolveLoad();
					else {
						expectedLoad = JSON.stringify([result.frameId, result.loaderId]);
						if (earlyLoads.has(expectedLoad)) resolveLoad();
					}
					earlyLoads.clear();
				})]);
			} finally {
				off();
				clearTimeout(timer);
				earlyLoads.clear();
				failureWaiters.delete(rejectLoad);
			}
		},
		close() {
			fail(new Error("CDP connection closed by client"));
			listeners.clear();
			ws.terminate();
		}
	};
}

/** Launches Chromium on a free port and resolves a connected client. */
export async function launch({ width = 400, height = 900, scale = 1, connectTimeoutMs = 5000, commandTimeoutMs = 10_000, navigationTimeoutMs = 10_000 } = {}) {
	const executable = chromePath();
	const profile = mkdtempSync(path.join(os.tmpdir(), "hw-pi-lab-"));
	const args = ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--hide-scrollbars", "--font-render-hinting=none", "about:blank"];
	if (process.platform === "linux" && process.getuid?.() === 0) args.unshift("--no-sandbox");
	const startedAt = new Date().toISOString();
	const proc = spawn(executable, args, { stdio: "ignore" });
	let launchError = null;
	proc.once("error", (error) => { launchError = error; });
	let stopPromise;
	/** Stops this launch's browser and removes its profile. */
	const stopBrowser = () => stopPromise ??= (async () => {
		await new Promise((resolve) => {
			if (!proc.pid || proc.exitCode !== null || proc.signalCode !== null) return resolve();
			const done = () => {
				clearTimeout(killTimer);
				clearTimeout(exitTimer);
				proc.off("exit", done);
				resolve();
			};
			const killTimer = setTimeout(() => {
				if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
			}, 3000);
			const exitTimer = setTimeout(done, 5000);
			proc.once("exit", done);
			proc.kill("SIGTERM");
		});
		if (process.platform === "win32") {
			try {
				cleanupBrowser(profile, startedAt);
			} catch {
				/* best effort: a leftover is reported by the caller's own sweep */
			}
		}
		try {
			rmSync(profile, { recursive: true, force: true });
		} catch {
			/* a straggling renderer may still hold a file; the OS temp sweep owns it */
		}
	})();
	// Port zero: Chromium binds a free port and names it in this launch's own
	// profile, so the debugger found is always this browser (external review
	// AX40). Another browser on a fixed port, or a stale run, can never be
	// driven or reported as evidence.
	let target = null;
	let transport;
	try {
		const deadline = performance.now() + 15_000;
		while (target === null && performance.now() < deadline) {
			if (launchError !== null) throw launchError;
			if ((proc.exitCode !== null && proc.exitCode !== 0) || proc.signalCode !== null) throw new Error(`chromium exited before its debugger was ready (${proc.exitCode ?? proc.signalCode})`);
			try {
				const remaining = Math.max(1, Math.ceil(deadline - performance.now()));
				const response = await fetch(`http://127.0.0.1:${browserDebuggerPort(profile)}/json/list`, { signal: AbortSignal.timeout(Math.min(1000, remaining)) });
				const list = await response.json();
				target = list.find((t) => t.type === "page") ?? null;
			} catch {
				/* debugger not up yet; each request has its own deadline */
			}
			if (target === null) await sleep(250);
		}
		if (target === null) throw new Error("chromium debugger never came up within 15000 ms");
		transport = await connectCdp(target.webSocketDebuggerUrl, { connectTimeoutMs, commandTimeoutMs, navigationTimeoutMs });
	} catch (error) {
		await stopBrowser(); // a launch that fails never leaves its browser behind
		throw error;
	}
	const { send, on, goto } = transport;

	const client = {
		send,
		on,
		goto,
		async viewport(w, h, s = 1) {
			await send("Emulation.setDeviceMetricsOverride", { width: Math.round(w), height: Math.round(h), deviceScaleFactor: s, mobile: false });
		},
		/** Evaluates an expression (awaiting promises) and returns its value. */
		async evaluate(expression) {
			const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
			if (res.exceptionDetails) {
				throw new Error(`evaluate threw: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`);
			}
			return res.result?.value;
		},
		/** PNG of the page; `full` captures the whole scroll height. */
		async screenshot({ full = true } = {}) {
			const params = { format: "png", captureBeyondViewport: full };
			if (full) {
				const metrics = await send("Page.getLayoutMetrics");
				const size = metrics.cssContentSize ?? metrics.contentSize;
				params.clip = { x: 0, y: 0, width: size.width, height: Math.ceil(size.height), scale: 1 };
			}
			const res = await send("Page.captureScreenshot", params);
			return Buffer.from(res.data, "base64");
		},
		/** One real key press through the input pipeline (focus, default actions and all). */
		async key(key, { shift = false, ctrl = false, alt = false } = {}) {
			const named = {
				Tab: { code: "Tab", keyCode: 9 },
				Enter: { code: "Enter", keyCode: 13, text: "\r" },
				Escape: { code: "Escape", keyCode: 27 },
				ArrowDown: { code: "ArrowDown", keyCode: 40 },
				ArrowUp: { code: "ArrowUp", keyCode: 38 },
				ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
				ArrowRight: { code: "ArrowRight", keyCode: 39 },
				Home: { code: "Home", keyCode: 36 },
				End: { code: "End", keyCode: 35 },
				PageDown: { code: "PageDown", keyCode: 34 },
				PageUp: { code: "PageUp", keyCode: 33 },
				Backspace: { code: "Backspace", keyCode: 8 },
				Delete: { code: "Delete", keyCode: 46 },
				F2: { code: "F2", keyCode: 113 },
				" ": { code: "Space", keyCode: 32, text: " " }
			};
			const info = named[key] ?? { code: `Key${key.toUpperCase()}`, keyCode: key.toUpperCase().charCodeAt(0), text: key };
			const modifiers = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
			await send("Input.dispatchKeyEvent", { type: info.text ? "keyDown" : "rawKeyDown", key, code: info.code, windowsVirtualKeyCode: info.keyCode, text: info.text, modifiers });
			await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: info.code, windowsVirtualKeyCode: info.keyCode, modifiers });
		},
		/** Types text as the IME/keyboard would commit it. */
		async type(text) {
			for (const ch of text) {
				await send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch });
				await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
			}
		},
		/** A real mouse click at the center of the element `selector` matches. */
		async click(selector) {
			const box = await client.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
			if (box === null) throw new Error(`click: nothing matches ${selector}`);
			await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
			await send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
			await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
		},
		/** Moves the real (trusted) pointer to the center of the first
		 * element matching `selector`, without pressing. */
		async hover(selector) {
			const box = await client.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
			if (box === null) throw new Error(`hover: nothing matches ${selector}`);
			await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
		},
		async close() {
			transport.close();
			await stopBrowser();
		},
		pid: proc.pid
	};
	try {
		await send("Page.enable");
		await send("Page.setLifecycleEventsEnabled", { enabled: true });
		await send("Runtime.enable");
		// A property inspector the person is using is a focused page. Headless
		// Chromium on Windows is not, and there a scripted focus() moves
		// activeElement without firing focus events, so a combobox that opens
		// on focus never opens. Emulating focus makes the page behave like the
		// focused panel it stands in for.
		await send("Emulation.setFocusEmulationEnabled", { enabled: true });
		await client.viewport(width, height, scale);
	} catch (error) {
		await client.close();
		throw error;
	}
	return client;
}
