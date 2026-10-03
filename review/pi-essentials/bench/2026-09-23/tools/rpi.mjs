// Bench tool: attach to the REAL Stream Deck app's property-inspector webview
// over the Chrome DevTools Protocol (app developer mode, port 23654) and run
// the same kinds of probes scripts/pi-lab.mjs runs on the simulated host.
// Observation plus explicit, named input only; it never writes settings on
// its own.
//
//   node rpi.mjs list
//   node rpi.mjs eval "<expression>"          (awaits promises, prints JSON)
//   node rpi.mjs shot <out.png>                (the panel viewport)
//   node rpi.mjs watch <out.jsonl>             (every panel WS frame, console
//                                              line and navigation, across
//                                              panel switches, until killed)
//   node rpi.mjs keys <Key> [<Key> ...]        (Tab, Shift+Tab, Enter, ...)
//   node rpi.mjs type "<text>"
const PORT = process.env.SD_DEBUG_PORT ?? "23654";
const MATCH = process.env.RPI_MATCH ?? "com.lawrensen.hwinfo.sdPlugin/ui/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function targets() {
	return (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
}

export async function findTarget(match = MATCH) {
	return (await targets()).find((t) => t.type === "page" && t.url.includes(match)) ?? null;
}

export async function attach(target) {
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, { once: true });
		ws.addEventListener("error", reject, { once: true });
	});
	let seq = 0;
	const pending = new Map();
	const listeners = new Map();
	let closed = false;
	ws.addEventListener("close", () => {
		closed = true;
		for (const fn of listeners.get("__close") ?? []) fn();
	});
	ws.addEventListener("message", (ev) => {
		const msg = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString());
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
		Backspace: { code: "Backspace", keyCode: 8 },
		Space: { code: "Space", keyCode: 32, text: " ", key: " " }
	};
	const client = {
		target,
		send,
		on,
		get closed() {
			return closed;
		},
		async evaluate(expression) {
			const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
			if (res.exceptionDetails) throw new Error(`evaluate threw: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`);
			return res.result?.value;
		},
		async screenshot() {
			const res = await send("Page.captureScreenshot", { format: "png" });
			return Buffer.from(res.data, "base64");
		},
		/** "Tab", "Shift+Tab", "ArrowDown", a single character, ... */
		async key(spec) {
			const parts = spec.split("+");
			const base = parts.pop();
			const shift = parts.includes("Shift");
			const ctrl = parts.includes("Ctrl");
			const alt = parts.includes("Alt");
			const info = named[base] ?? { code: `Key${base.toUpperCase()}`, keyCode: base.toUpperCase().charCodeAt(0), text: base };
			const key = info.key ?? base;
			const modifiers = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
			await send("Input.dispatchKeyEvent", { type: info.text ? "keyDown" : "rawKeyDown", key, code: info.code, windowsVirtualKeyCode: info.keyCode, text: info.text, modifiers });
			await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: info.code, windowsVirtualKeyCode: info.keyCode, modifiers });
		},
		async type(text) {
			for (const ch of text) {
				await send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch });
				await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
			}
		},
		close() {
			try {
				ws.close();
			} catch {
				/* gone */
			}
		}
	};
	await send("Runtime.enable");
	await send("Page.enable");
	return client;
}

async function withPanel(fn) {
	const t = await findTarget();
	if (t === null) throw new Error(`no panel target matching ${MATCH}; select one of the plugin's keys in the app`);
	const c = await attach(t);
	try {
		return await fn(c);
	} finally {
		c.close();
	}
}

/** Records every panel WebSocket frame, console line and navigation to a
 * JSONL file, re-attaching whenever the panel target changes or reappears. */
async function watch(out) {
	const { appendFileSync } = await import("node:fs");
	const log = (rec) => appendFileSync(out, JSON.stringify({ t: new Date().toISOString(), ...rec }) + "\n");
	let current = null;
	let currentKey = "";
	log({ ev: "watch-start", port: PORT, match: MATCH });
	for (;;) {
		let t = null;
		try {
			t = await findTarget();
		} catch (err) {
			log({ ev: "debug-port-error", msg: String(err?.message ?? err) });
		}
		const key = t ? `${t.id}` : "";
		if (key !== currentKey || (current && current.closed)) {
			if (current) current.close();
			current = null;
			currentKey = key;
			if (t) {
				try {
					const c = await attach(t);
					current = c;
					log({ ev: "attach", id: t.id, url: t.url });
					await c.send("Network.enable");
					c.on("Network.webSocketCreated", (p) => log({ ev: "ws-created", url: p.url }));
					c.on("Network.webSocketClosed", () => log({ ev: "ws-closed" }));
					c.on("Network.webSocketFrameSent", (p) => log({ ev: "sent", data: p.response?.payloadData }));
					c.on("Network.webSocketFrameReceived", (p) => log({ ev: "recv", data: p.response?.payloadData }));
					c.on("Runtime.consoleAPICalled", (p) => log({ ev: "console", level: p.type, args: p.args.map((a) => a.value ?? a.description) }));
					c.on("Runtime.exceptionThrown", (p) => log({ ev: "exception", text: p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text }));
					c.on("Page.frameNavigated", (p) => {
						if (!p.frame.parentId) log({ ev: "navigated", url: p.frame.url });
					});
					c.on("Page.loadEventFired", () => log({ ev: "load" }));
					c.on("__close", () => log({ ev: "detached" }));
				} catch (err) {
					log({ ev: "attach-failed", msg: String(err?.message ?? err) });
				}
			} else {
				log({ ev: "no-panel" });
			}
		}
		await sleep(150);
	}
}

const [cmd, ...args] = process.argv.slice(2);
if (process.argv[1]?.endsWith("rpi.mjs")) {
	if (cmd === "list") {
		for (const t of await targets()) console.log(t.type, t.id, t.url);
	} else if (cmd === "eval") {
		const v = await withPanel((c) => c.evaluate(args.join(" ")));
		console.log(JSON.stringify(v, null, 1));
	} else if (cmd === "shot") {
		const { writeFileSync } = await import("node:fs");
		const png = await withPanel((c) => c.screenshot());
		writeFileSync(args[0], png);
		console.log(`${args[0]} ${png.length} B`);
	} else if (cmd === "keys") {
		await withPanel(async (c) => {
			for (const k of args) {
				await c.key(k);
				await sleep(60);
			}
		});
	} else if (cmd === "type") {
		await withPanel((c) => c.type(args.join(" ")));
	} else if (cmd === "watch") {
		await watch(args[0]);
	} else if (cmd !== undefined) {
		console.error(`unknown command ${cmd}`);
		process.exitCode = 2;
	}
}
