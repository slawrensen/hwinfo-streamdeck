import streamDeck, { DeviceType, type Device } from "@elgato/streamdeck";

import { DetailSlotAction } from "./actions/detail-slot";
import { HwinfoControlAction } from "./actions/hwinfo-control";
import { SensorDialAction } from "./actions/sensor-dial";
import { SensorReadingAction } from "./actions/sensor-reading";
import { DetailController } from "./detail/controller";
import { DetailNavigator } from "./detail/navigation";
import { deviceCapabilities } from "./devices";
import { registerDiagnostics } from "./diagnostics";
import { initHwsm } from "./hwinfo/hwsm-loader";
import { parsePollInterval, parseSourceMode, poller } from "./poller";
import { hashId, traceEnabled } from "./recorder";
import { applyGlobalThemeSettings, decideLegacyDefault, onThemeChange } from "./ui/theme-store";

/** Plugin-wide settings (written by the PI's "Advanced" and theme sections). */
type GlobalSettings = {
	pollIntervalMs?: string;
	source?: string;
	/** Deck-wide default theme id from themes.json. */
	theme?: string;
	/** "on" (default) | "off" — color accents by sensor type. */
	typeAccents?: string;
	/** Deck-wide Text setting: "theme" (default) | "dim" | "custom". */
	textMode?: string;
	/** Deck-wide custom text color (#RRGGBB). */
	textColor?: string;
	/** Deck-wide custom mode: dim labels, units and stats. */
	textDimSecondary?: boolean;
	/** Data-unit preference: "decimal" (default) | "binary". */
	dataUnits?: string;
};

// Diagnostic knob for support and hardware bring-up; defaults stay quiet.
const LOG_LEVELS = ["trace", "debug", "info", "warn", "error"] as const;
const requestedLevel = (process.env.HWINFO_LOG_LEVEL ?? "").toLowerCase();
const logLevel = LOG_LEVELS.find((l) => l === requestedLevel) ?? "info";
streamDeck.logger.setLevel(logLevel);
if (streamDeck.logger.level !== logLevel) {
	// The SDK silently clamps a level above its launch-mode floor to "info"
	// (trace needs a debugger attach). A support user asking for MORE detail
	// must not get less: fall back to the deepest level a normal launch allows.
	streamDeck.logger.setLevel("debug");
}
if (streamDeck.logger.level !== logLevel) {
	streamDeck.logger.info(`Log level = ${streamDeck.logger.level} (HWINFO_LOG_LEVEL asked for ${logLevel}, which needs a debug launch)`);
} else if (logLevel !== "info") {
	streamDeck.logger.info(`Log level = ${logLevel} (HWINFO_LOG_LEVEL)`);
}

// A monitoring widget should log-and-continue rather than die silently; every
// per-tick failure mode is already handled in the poller, so anything landing
// here is unexpected and worth a trace.
process.on("uncaughtException", (err) => {
	streamDeck.logger.error("Uncaught exception", err);
});
process.on("unhandledRejection", (reason) => {
	streamDeck.logger.error("Unhandled rejection", reason);
});

// Load the native bridge before anything can poll: on machines without an
// hwsm build (e.g. Windows-on-ARM) this records the failure so the poller
// shows the "unsupported" status screen instead of the process dying on a
// top-level import.
initHwsm();

// The Stream Deck app reaps plugin processes through its job object, but if
// it ever dies without that teardown (hard crash), the poller's interval
// would keep this process alive — polling for nobody. Watch the parent and
// leave when it does. The watchdog also covers closes the socket never sees.
// unref'd so the timer itself never holds the event loop open.
const parentPid = process.ppid;
const PARENT_CHECK_MS = Number(process.env.HWINFO_PARENT_CHECK_MS ?? "") || 30_000;
setInterval(() => {
	try {
		process.kill(parentPid, 0); // signal 0 = existence probe
	} catch {
		streamDeck.logger.info("Parent process gone — exiting.");
		process.exit(0);
	}
}, PARENT_CHECK_MS).unref();

// Drill-down navigation (issue #5): one device-scoped navigator (entry,
// pagination, Back's previous-profile restore) and one controller that owns
// every visible detail slot. The SDK's profile switch is injected here so
// the navigation service itself stays SDK-free and unit-testable; no other
// module may call switchToProfile.
const detailLog = streamDeck.logger.createScope("DetailNav");
const detailNavigator = new DetailNavigator({
	switchProfile: (deviceId, profileName, page) => streamDeck.profiles.switchToProfile(deviceId, profileName, page),
	onChanged: (deviceId) => detailController.renderDevice(deviceId),
	log: detailLog
});
const detailController = new DetailController(detailNavigator, { getStatus: () => poller.getStatus(), log: detailLog });
poller.onTick((status) => {
	// Isolated like the action listeners: a detail rendering bug must not
	// starve the other subscribers on the shared tick event.
	try {
		detailController.onTick(status);
	} catch (err) {
		streamDeck.logger.error("DetailController tick failed", err);
	}
});
onThemeChange(() => {
	try {
		detailController.renderAll();
	} catch (err) {
		streamDeck.logger.error("DetailController theme repaint failed", err);
	}
});

streamDeck.actions.registerAction(new SensorReadingAction(detailNavigator));
streamDeck.actions.registerAction(new SensorDialAction());
streamDeck.actions.registerAction(new HwinfoControlAction());
streamDeck.actions.registerAction(new DetailSlotAction(detailController));

// One line per deck so support logs say exactly what hardware was involved.
const describeDevice = (d: Pick<Device, "name" | "type" | "size">): string => `${d.name} (${DeviceType[d.type] ?? `type ${d.type}`}, ${d.size.columns}x${d.size.rows})`;
const ingestDevice = (d: Pick<Device, "id" | "type" | "size">): void => {
	deviceCapabilities.ingest(d.id, { type: d.type, columns: d.size.columns, rows: d.size.rows });
};
streamDeck.devices.onDeviceDidConnect((ev) => {
	ingestDevice(ev.device);
	streamDeck.logger.info(`Device connected: ${describeDevice(ev.device)}`);
});
streamDeck.devices.onDeviceDidDisconnect((ev) => {
	// Only this device's drill-down session dies with it; another deck's
	// detail view keeps its own state and page untouched.
	detailNavigator.deviceDisconnected(ev.device.id);
});
// deviceDidChange (grid resizes on Mobile/Virtual decks) is a Stream Deck
// 7.0 API and the SDK refuses to register it while the manifest floor is
// 6.9, whatever app is actually connected. Basic monitoring must not depend
// on it, so: try, and fall back to the connect-time snapshot (a reconnect
// also re-ingests). The floor stays 6.9 on purpose.
try {
	streamDeck.devices.onDeviceDidChange((ev) => {
		ingestDevice(ev.device);
	});
} catch {
	streamDeck.logger.debug("deviceDidChange unavailable below Stream Deck 7.0; using connect-time device info");
}

registerDiagnostics("dataSource", () => poller.diagnostics());
// Device ids are hashed here like the device table's own; the report must
// never carry a raw device identifier.
registerDiagnostics("detailNav", () => detailNavigator.diagnostics().map(({ deviceId, ...rest }) => ({ device: hashId(deviceId), ...rest })));
if (traceEnabled()) {
	streamDeck.logger.info("Event trace recorder is ON (HWINFO_TRACE_EVENTS=1): redacted input traces in logs/");
}

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => {
	poller.setIntervalMs(parsePollInterval(ev.settings.pollIntervalMs));
	poller.setSourceMode(parseSourceMode(ev.settings.source));
	applyGlobalThemeSettings(ev.settings);
});

await streamDeck.connect();

for (const device of streamDeck.devices) {
	ingestDevice(device);
	streamDeck.logger.info(`Device ${device.isConnected ? "connected" : "known"}: ${describeDevice(device)}`);
}

const globals = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
poller.setIntervalMs(parsePollInterval(globals.pollIntervalMs));
poller.setSourceMode(parseSourceMode(globals.source));
applyGlobalThemeSettings(globals);
// Pre-theme installs that already tweaked plugin-wide settings keep the old
// look (graphite); otherwise the first appearing action decides (see actions).
if (globals.theme === undefined && Object.values(globals).some((v) => v !== undefined)) {
	decideLegacyDefault(true);
}
