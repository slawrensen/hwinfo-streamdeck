/**
 * A small Chrome DevTools Protocol client for the property-inspector labs:
 * launches a headless Chromium with its own throwaway profile, attaches to
 * a page created for the suite, and exposes the handful of commands it uses
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
			const started = performance.now();
			let navigationResult = null;
			const trace = [];
			let droppedEvents = 0;
			const traceEvent = (method, select = (event) => event) => on(method, (event) => {
				const detail = select(event);
				if (detail === null) return;
				if (trace.length === 64) { trace.shift(); droppedEvents++; }
				trace.push({ elapsedMs: Math.round(performance.now() - started), method, detail });
			});
			const responseDetail = (response) => response && ({ url: response.url, status: response.status, mimeType: response.mimeType, headers: response.headers });
			const traceOff = [
				traceEvent("Inspector.targetCrashed"),
				traceEvent("Inspector.detached"),
				traceEvent("Page.frameStartedNavigating"),
				traceEvent("Page.frameRequestedNavigation"),
				traceEvent("Page.frameNavigated", ({ frame }) => ({ id: frame.id, parentId: frame.parentId, url: frame.url, loaderId: frame.loaderId, mimeType: frame.mimeType, unreachableUrl: frame.unreachableUrl })),
				traceEvent("Page.lifecycleEvent"),
				traceEvent("Network.requestWillBeSent", (event) => event.type !== "Document" ? null : ({ requestId: event.requestId, loaderId: event.loaderId, frameId: event.frameId, timestamp: event.timestamp, url: event.request.url, method: event.request.method, redirectResponse: responseDetail(event.redirectResponse) })),
				traceEvent("Network.responseReceived", (event) => event.type !== "Document" ? null : ({ requestId: event.requestId, loaderId: event.loaderId, frameId: event.frameId, timestamp: event.timestamp, response: responseDetail(event.response) })),
				traceEvent("Network.loadingFailed", (event) => event.type !== "Document" ? null : event)
			];
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
					navigationResult = result;
					if (!result || typeof result.frameId !== "string") throw new Error("Page.navigate: response has no frameId");
					if (result.errorText) throw new Error(`Page.navigate: ${result.errorText} (${targetUrl}); result=${JSON.stringify(result)}`);
					if (result.isDownload) throw new Error(`Page.navigate: download instead of a page (${targetUrl})`);
					// Same-document navigations have no loader and emit no load event.
					if (!result.loaderId) resolveLoad();
					else {
						expectedLoad = JSON.stringify([result.frameId, result.loaderId]);
						if (earlyLoads.has(expectedLoad)) resolveLoad();
					}
					earlyLoads.clear();
				})]);
			} catch (error) {
				error.cdpNavigation = { result: navigationResult, events: trace, droppedEvents };
				throw error;
			} finally {
				off();
				for (const stop of traceOff) stop();
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

/** Create our page explicitly; the command-line startup page can still have
 * browser-initiated navigation queued even when its current document is ready.
 * A failed creation is fatal, not retried with some other page from /json/list. */
export async function createPageTarget(debuggerOrigin, timeoutMs = 5000) {
	const response = await fetch(`${debuggerOrigin}/json/new?about:blank`, { method: "PUT", signal: AbortSignal.timeout(timeoutMs) });
	if (!response.ok) throw new Error(`chromium page creation failed: HTTP ${response.status}`);
	const target = await response.json();
	if (target?.type !== "page" || typeof target.id !== "string" || target.id === "" || typeof target.webSocketDebuggerUrl !== "string") {
		throw new Error("chromium page creation returned no page target");
	}
	const expectedSocket = new URL(`/devtools/page/${encodeURIComponent(target.id)}`, debuggerOrigin);
	expectedSocket.protocol = "ws:";
	if (target.webSocketDebuggerUrl !== expectedSocket.href) throw new Error("chromium page creation returned a socket for a different target or browser");
	return target;
}

/** An initial empty document can already say "complete", so require a
 * history entry and a stable committed loader before driving our page. */
export async function waitForInitialDocument(client, timeoutMs = 10_000) {
	const deadline = performance.now() + timeoutMs;
	let last = null;
	while (performance.now() < deadline) {
		const history = await client.send("Page.getNavigationHistory");
		const before = (await client.send("Page.getFrameTree")).frameTree?.frame;
		last = { entry: history.entries?.[history.currentIndex]?.url, frame: before?.url, loaderId: before?.loaderId };
		if (last.entry === "about:blank" && last.frame === "about:blank" && typeof before.loaderId === "string" && before.loaderId !== "") {
			const document = await client.send("Runtime.evaluate", { expression: '({ ready: document.readyState, url: location.href })', returnByValue: true });
			if (document.exceptionDetails) throw new Error(`chromium initial document failed: ${document.exceptionDetails.text}`);
			const after = (await client.send("Page.getFrameTree")).frameTree?.frame;
			if (document.result?.value?.ready === "complete" && document.result.value.url === "about:blank" && after?.id === before.id && after?.loaderId === before.loaderId) return;
		}
		await sleep(25);
	}
	throw new Error(`chromium initial about:blank did not settle within ${timeoutMs} ms (${JSON.stringify(last)})`);
}

/** Launches Chromium on a free port and resolves a connected client. */
export async function launch({ width = 400, height = 900, scale = 1, connectTimeoutMs = 5000, commandTimeoutMs = 10_000, navigationTimeoutMs = 10_000 } = {}) {
	const executable = chromePath();
	const profile = mkdtempSync(path.join(os.tmpdir(), "hw-pi-lab-"));
	const args = ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--hide-scrollbars", "--font-render-hinting=none", "about:blank"];
	if (process.platform === "linux" && process.getuid?.() === 0) args.unshift("--no-sandbox");
	const startedAt = new Date().toISOString();
	const proc = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"] });
	let browserStderr = "";
	proc.stderr.setEncoding("utf8");
	proc.stderr.on("data", (chunk) => { browserStderr = (browserStderr + chunk).slice(-16_384); });
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
	let debuggerOrigin = null;
	let target;
	let transport;
	try {
		const deadline = performance.now() + 15_000;
		while (debuggerOrigin === null && performance.now() < deadline) {
			if (launchError !== null) throw launchError;
			if ((proc.exitCode !== null && proc.exitCode !== 0) || proc.signalCode !== null) throw new Error(`chromium exited before its debugger was ready (${proc.exitCode ?? proc.signalCode})`);
			try {
				const remaining = Math.max(1, Math.ceil(deadline - performance.now()));
				const origin = `http://127.0.0.1:${browserDebuggerPort(profile)}`;
				const response = await fetch(`${origin}/json/version`, { signal: AbortSignal.timeout(Math.min(1000, remaining)) });
				if (response.ok && typeof (await response.json()).webSocketDebuggerUrl === "string") debuggerOrigin = origin;
			} catch {
				/* debugger not up yet; each request has its own deadline */
			}
			if (debuggerOrigin === null) await sleep(250);
		}
		if (debuggerOrigin === null) throw new Error("chromium debugger never came up within 15000 ms");
		target = await createPageTarget(debuggerOrigin, connectTimeoutMs);
		transport = await connectCdp(target.webSocketDebuggerUrl, { connectTimeoutMs, commandTimeoutMs, navigationTimeoutMs });
	} catch (error) {
		await stopBrowser(); // a launch that fails never leaves its browser behind
		if (browserStderr) console.error("Chromium launch stderr:", browserStderr);
		throw error;
	}
	const { send, on, goto } = transport;

	const client = {
		send,
		on,
		async goto(targetUrl) {
			try {
				await goto(targetUrl);
			} catch (error) {
				// Evidence only: failed diagnostics cannot change the original verdict.
				try {
					const [frame, history] = await Promise.allSettled([send("Page.getFrameTree"), send("Page.getNavigationHistory")]);
					const current = frame.status === "fulfilled" ? frame.value?.frameTree?.frame : null;
					const entries = history.status === "fulfilled" ? history.value?.entries : null;
					console.error("CDP navigation failure state:", JSON.stringify({
						targetId: target.id, requestedUrl: targetUrl,
						browserStderr,
						navigation: error.cdpNavigation,
						frame: current && { id: current.id, url: current.url, loaderId: current.loaderId },
						history: entries?.slice(-3).map(({ id, url, transitionType }) => ({ id, url, transitionType })),
						frameError: frame.status === "rejected" ? frame.reason.message : undefined,
						historyError: history.status === "rejected" ? history.reason.message : undefined
					}));
				} catch {
					/* Preserve the original navigation error even if evidence cannot be read. */
				}
				throw error;
			}
		},
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
		await send("Network.enable");
		await waitForInitialDocument(transport);
		// A property inspector the person is using is a focused page. Headless
		// Chromium on Windows is not, and there a scripted focus() moves
		// activeElement without firing focus events, so a combobox that opens
		// on focus never opens. Emulating focus makes the page behave like the
		// focused panel it stands in for.
		await send("Emulation.setFocusEmulationEnabled", { enabled: true });
		await client.viewport(width, height, scale);
	} catch (error) {
		await client.close();
		if (browserStderr) console.error("Chromium initialization stderr:", browserStderr);
		throw error;
	}
	return client;
}
