/**
 * A simulated Stream Deck host for the REAL property-inspector pages, for
 * machines without the Stream Deck app or HWiNFO (Linux containers, CI).
 * Run under tsx: the plugin side of the conversation is answered by the
 * production modules themselves (buildSensorTree, buildPreview and the
 * themes payload from src/pi-protocol.ts; compose() and composeDialSvg()
 * for the device faces), fed a fixture snapshot from pi-fixtures.mjs.
 *
 * What this proves and what it does not: the shipped HTML, CSS, scripts and
 * vendored sdpi-components run unmodified in Chromium against the exact
 * message shapes the plugin builds. It does not prove the Stream Deck app's
 * embedded webview, its fonts or its message timing; captures made here are
 * labeled "simulated host, sample data".
 *
 * Every PI message is recorded, and setSettings/setGlobalSettings payloads
 * are kept in arrival order, so suites can assert exact write counts.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

import { compose } from "../../src/actions/sensor-reading.ts";
import { composeDialSvg } from "../../src/actions/sensor-dial.ts";
import { buildPreview, buildSensorTree, buildThemesPayload } from "../../src/pi-protocol.ts";
import { poller } from "../../src/poller.ts";
import { SessionStatsStore } from "../../src/stats.ts";
import { applyGlobalThemeSettings } from "../../src/ui/theme-store.ts";
import { frozenHistory, sampleSnapshot, scenarios } from "./pi-fixtures.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// PI_SIM_PLUGIN_DIR serves another checkout's panels (a baseline worktree)
// against this build's plugin side, for before/after measurements.
const pluginDir = process.env.PI_SIM_PLUGIN_DIR ?? path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");

export const PAGES = {
	"sensor-reading.html": { action: "com.lawrensen.hwinfo.reading", controller: "Keypad", kind: "key" },
	"sensor-dial.html": { action: "com.lawrensen.hwinfo.dial", controller: "Encoder", kind: "dial" },
	"control.html": { action: "com.lawrensen.hwinfo.control", controller: "Keypad", kind: "control" },
	"detail-slot.html": { action: "com.lawrensen.hwinfo.detail-slot", controller: "Keypad", kind: "slot" }
};

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

/** The data states a fixture can put the provider in. */
function statusFor(data, snapshot) {
	if (data === "unavailable") return { state: "unavailable", reason: "not-running", message: "HWiNFO is not running (simulated)." };
	if (data === "stale") return { state: "stale", snapshot, source: "shared-memory", staleForMs: 42_000 };
	if (data === "gadget") return { state: "ok", snapshot, source: "gadget" };
	return { state: "ok", snapshot, source: "shared-memory" };
}

export async function startPiSim({ httpPort, wsPort, tickMs = 0, extraRoutes = {} }) {
	const all = scenarios();
	const sim = {
		fixture: null,
		page: null,
		context: "",
		settings: {},
		globals: {},
		data: "ok",
		snapshot: sampleSnapshot(),
		writes: [],
		globalWrites: [],
		piMessages: [],
		toPiLog: [],
		/** Reply latency for sendToPlugin requests (ms), for race suites. */
		replyDelayMs: 0,
		stats: new SessionStatsStore(),
		piWs: null
	};
	// Session stats and frozen sparkline history for every fixture reading,
	// so min/max and trend lines draw the way a warmed-up plugin draws them.
	const seedHistory = () => {
		sim.stats = new SessionStatsStore();
		for (const r of sim.snapshot.readings) {
			sim.stats.sample(r.key, r.valueMin);
			sim.stats.sample(r.key, r.valueMax);
			sim.stats.sample(r.key, r.value);
			poller.subscribeSeries(r.key);
			const ring = poller.getSeries(r.key);
			ring.length = 0;
			ring.push(...frozenHistory(r.value));
		}
	};
	seedHistory();

	const status = () => statusFor(sim.data, sim.snapshot);
	const face = () => {
		const kind = PAGES[sim.page]?.kind;
		if (kind === "key") {
			const back = sim.settings.detailRole === "back" && typeof sim.settings.readingKey === "string" && sim.settings.readingKey !== "";
			return compose(sim.settings, status(), back);
		}
		if (kind === "dial") {
			return composeDialSvg({ settings: sim.settings, stats: sim.stats, statMode: "current", overlay: null, cyclePaused: false, pinned: false }, status());
		}
		return undefined;
	};
	const toPi = (payload) => {
		if (sim.piWs === null) return;
		sim.toPiLog.push(payload);
		sim.piWs.send(JSON.stringify({ event: "sendToPropertyInspector", action: PAGES[sim.page].action, context: sim.context, payload }));
	};
	/** The plugin's preview push, through the production builder. The
	 * face rides along when the builder accepts one (the redesigned
	 * protocol); older builders simply ignore the extra argument. */
	sim.pushPreview = () => {
		const kind = PAGES[sim.page]?.kind;
		if (kind !== "key" && kind !== "dial") return;
		toPi(buildPreview(status(), sim.settings, kind === "key", { context: sim.context, face: face(), kind }));
	};
	sim.face = face;
	sim.status = status;

	sim.setFixture = (name, overrides = {}) => {
		const fx = all.list[name];
		if (fx === undefined) throw new Error(`unknown fixture ${name}`);
		sim.fixture = name;
		sim.page = fx.page;
		sim.context = `ctx-${name}`;
		sim.settings = structuredClone(overrides.settings ?? fx.settings);
		sim.globals = structuredClone(overrides.globals ?? fx.globals);
		sim.data = overrides.data ?? fx.data;
		sim.snapshot = overrides.snapshot ?? sampleSnapshot();
		sim.writes.length = 0;
		sim.globalWrites.length = 0;
		sim.piMessages.length = 0;
		sim.toPiLog.length = 0;
		applyGlobalThemeSettings(sim.globals);
		seedHistory();
	};

	const info = {
		application: { font: "Segoe UI", language: "en", platform: "windows", platformVersion: "10.0.19044", version: "6.9.0.0" },
		colors: {},
		devicePixelRatio: 1,
		devices: [{ id: "dev1", name: "Lab Deck", size: { columns: 4, rows: 2 }, type: 7 }],
		plugin: { uuid: "com.lawrensen.hwinfo", version: "1.6.0.0" }
	};

	const wss = new WebSocketServer({ host: "127.0.0.1", port: wsPort });
	wss.on("connection", (ws) => {
		ws.on("message", (raw) => {
			const msg = JSON.parse(raw.toString());
			sim.piMessages.push(msg);
			const page = PAGES[sim.page];
			switch (msg.event) {
				case "registerPropertyInspector":
					sim.piWs = ws;
					break;
				case "getSettings":
					ws.send(JSON.stringify({ event: "didReceiveSettings", action: page.action, context: sim.context, device: "dev1", payload: { settings: sim.settings, coordinates: { column: 0, row: 0 } } }));
					break;
				case "setSettings":
					sim.writes.push(structuredClone(msg.payload ?? {}));
					sim.settings = structuredClone(msg.payload ?? {});
					// The plugin repaints on didReceiveSettings and the redesigned
					// actions push the new face to the open panel at once.
					setTimeout(sim.pushPreview, 5);
					break;
				case "getGlobalSettings":
					ws.send(JSON.stringify({ event: "didReceiveGlobalSettings", payload: { settings: sim.globals } }));
					break;
				case "setGlobalSettings":
					sim.globalWrites.push(structuredClone(msg.payload ?? {}));
					sim.globals = structuredClone(msg.payload ?? {});
					applyGlobalThemeSettings(sim.globals);
					ws.send(JSON.stringify({ event: "didReceiveGlobalSettings", payload: { settings: sim.globals } }));
					setTimeout(() => {
						toPi(JSON.parse(JSON.stringify(buildThemesPayload())));
						sim.pushPreview();
					}, 5);
					break;
				case "sendToPlugin": {
					const event = msg.payload?.event;
					const reply = () => {
						if (event === "getSensorTree") toPi(buildSensorTree(status()));
						else if (event === "getThemes") toPi(JSON.parse(JSON.stringify(buildThemesPayload())));
						else if (event === "getDetailSupport") toPi({ event: "detailSupport", supported: true, model: "Stream Deck +" });
						else if (event === "getSupportReport") toPi({ event: "supportReport", report: "(simulated support report)" });
						else if (event === "getPreview") sim.pushPreview();
					};
					if (sim.replyDelayMs > 0) setTimeout(reply, sim.replyDelayMs);
					else reply();
					break;
				}
				default:
					break;
			}
		});
	});

	let ticker = null;
	if (tickMs > 0) ticker = setInterval(() => sim.pushPreview(), tickMs);

	const bootstrap = () => {
		const page = PAGES[sim.page];
		const actionInfo = { action: page.action, context: sim.context, device: "dev1", payload: { settings: sim.settings, coordinates: { column: 0, row: 0 }, controller: page.controller } };
		return `<script>window.addEventListener("load",()=>{if(typeof connectElgatoStreamDeckSocket==="function")connectElgatoStreamDeckSocket(String(${wsPort}),"pi-ctx","registerPropertyInspector",${JSON.stringify(JSON.stringify(info))},${JSON.stringify(JSON.stringify(actionInfo))});});</script>`;
	};

	const server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", `http://127.0.0.1:${httpPort}`);
		const route = extraRoutes[url.pathname];
		if (route !== undefined) {
			const body = route(url);
			res.writeHead(200, { "content-type": body.type, "cache-control": "no-store" }).end(body.body);
			return;
		}
		const file = path.join(pluginDir, path.normalize(url.pathname).replace(/^([\\/.])+/, ""));
		if (!file.startsWith(pluginDir)) {
			res.writeHead(403).end();
			return;
		}
		try {
			let body = readFileSync(file);
			if (file.endsWith(".html")) {
				const fx = url.searchParams.get("fx");
				if (fx !== null && sim.fixture !== fx) sim.setFixture(fx);
				const inject = [bootstrap(), ...(url.searchParams.getAll("inject").map((src) => (src.split("?")[0].endsWith(".css") ? `<link rel="stylesheet" href="${src}">` : `<script defer src="${src}"></script>`)))].join("");
				body = Buffer.from(body.toString("utf8").replace("</head>", `${inject}</head>`));
			}
			res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
		} catch {
			res.writeHead(404).end("not found");
		}
	});
	await new Promise((resolve) => server.listen(httpPort, "127.0.0.1", resolve));

	sim.url = (fixture, extra = "") => {
		const fx = all.list[fixture];
		return `http://127.0.0.1:${httpPort}/ui/${fx.page}?fx=${encodeURIComponent(fixture)}${extra}`;
	};
	sim.keys = all.keys;
	sim.fixtures = all.list;
	sim.stop = async () => {
		if (ticker !== null) clearInterval(ticker);
		for (const client of wss.clients) client.terminate();
		await new Promise((resolve) => wss.close(resolve));
		await new Promise((resolve) => server.close(resolve));
	};
	return sim;
}
