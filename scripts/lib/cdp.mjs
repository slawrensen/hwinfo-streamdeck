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
 * a Linux container provides. Only the process this module spawned is ever
 * stopped: no name-based sweeps of other browsers.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function chromePath() {
	if (process.env.CHROME) return process.env.CHROME;
	if (process.platform === "win32") return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
	for (const candidate of ["/opt/pw-browsers/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]) {
		if (existsSync(candidate)) return candidate;
	}
	throw new Error("No Chromium found: set CHROME to a Chrome or Chromium binary.");
}

/** Launches Chromium on `port` and resolves a connected client. */
export async function launch({ port, width = 400, height = 900, scale = 1 }) {
	const profile = mkdtempSync(path.join(os.tmpdir(), "hw-pi-lab-"));
	const args = ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--font-render-hinting=none", "about:blank"];
	if (process.platform === "linux" && process.getuid?.() === 0) args.unshift("--no-sandbox");
	const proc = spawn(chromePath(), args, { stdio: "ignore" });
	let target = null;
	for (let i = 0; i < 60 && target === null; i++) {
		await sleep(250);
		try {
			const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
			target = list.find((t) => t.type === "page") ?? null;
		} catch {
			/* debugger not up yet */
		}
	}
	if (target === null) {
		proc.kill("SIGKILL");
		throw new Error("chromium debugger never came up");
	}
	const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
	await new Promise((resolve, reject) => {
		ws.once("open", resolve);
		ws.once("error", reject);
	});
	let seq = 0;
	const pending = new Map();
	const listeners = new Map();
	ws.on("message", (data) => {
		const msg = JSON.parse(data.toString());
		if (msg.id !== undefined && pending.has(msg.id)) {
			pending.get(msg.id)(msg);
			pending.delete(msg.id);
		} else if (msg.method !== undefined) {
			for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
		}
	});
	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = ++seq;
			pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
			ws.send(JSON.stringify({ id, method, params }));
		});
	const on = (method, fn) => {
		const list = listeners.get(method) ?? [];
		list.push(fn);
		listeners.set(method, list);
	};

	const client = {
		send,
		on,
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
		async goto(url) {
			const loaded = new Promise((resolve) => {
				const done = () => resolve();
				on("Page.loadEventFired", done);
			});
			await send("Page.navigate", { url });
			await Promise.race([loaded, sleep(10000)]);
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
		async close() {
			try {
				ws.close();
			} catch {
				/* already closed */
			}
			await new Promise((resolve) => {
				if (proc.exitCode !== null) return resolve();
				proc.once("exit", resolve);
				proc.kill("SIGTERM");
				setTimeout(() => {
					if (proc.exitCode === null) proc.kill("SIGKILL");
				}, 3000).unref();
			});
			try {
				rmSync(profile, { recursive: true, force: true });
			} catch {
				/* a straggling renderer may still hold a file; the OS temp sweep owns it */
			}
		},
		pid: proc.pid
	};
	await send("Page.enable");
	await send("Runtime.enable");
	await client.viewport(width, height, scale);
	return client;
}
