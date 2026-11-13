/**
 * The Sensor Reading key's press routing and its alert faces, through the
 * real action: the opt-in snooze armed at key down, the Back role, the
 * alert path stepped by poller ticks (dwell, the repaint gate, the snooze
 * band), and documents a 1.8 test build stored with a launch press or a
 * remote PC's reading: the press does what the default press does, the
 * face draws the plain missing state, and nothing is rewritten. Every test
 * checks that the key wrote no settings it should not.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import streamDeck from "@elgato/streamdeck";

import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import { poller, type PollerStatus } from "../src/poller";
import { applyGlobalThemeSettings } from "../src/ui/theme-store";
import { loadThemes } from "../src/ui/themes";

const { SensorReadingAction } = await import("../src/actions/sensor-reading");
type ReadingSettings = import("../src/actions/sensor-reading").ReadingSettings;

applyGlobalThemeSettings({ theme: "void" });
const WARN_BG = loadThemes().alerts.warn.bg;
const BAND = /<rect x="10" y="10" width="124" height="3" fill="#[0-9A-Fa-f]{6}"\/>/;

let mono = 0;
let pollTime = 0;
let latest: PollerStatus = { state: "unavailable", reason: "not-running", message: "fixture" };
const restores: Array<() => void> = [];

beforeEach(() => {
	// The clock only moves forward, across tests too: the alert store is
	// the plugin's own singleton.
	mono += 10_000_000;
	pollTime = 0;
	mock.timers.enable({ apis: ["setTimeout"] });
	for (const m of [
		mock.method(performance, "now", () => mono),
		mock.method(poller, "retain", () => {}),
		mock.method(poller, "release", () => {}),
		mock.method(poller, "getStatus", () => latest),
		mock.method(poller, "subscribeSeries", () => {}),
		mock.method(streamDeck.ui, "sendToPropertyInspector", async () => {})
	]) restores.push(() => m.mock.restore());
});
afterEach(() => {
	for (const restore of restores.splice(0)) restore();
	mock.timers.reset();
});

function reading(key: string, value: number): Reading {
	return { key, type: SensorType.Temperature, sensorIndex: 0, id: 1, label: "CPU Package", unit: "°C", value, valueMin: value, valueMax: value, valueAvg: value };
}

function publish(...readings: Reading[]): PollerStatus {
	const snapshot: SensorSnapshot = { pollTime: ++pollTime, valueRevision: pollTime, version: 1, revision: 1, sensors: [{ index: 0, id: 0, instance: 0, name: "CPU" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) };
	latest = { state: "ok", snapshot, source: "shared-memory" };
	return latest;
}

function tick(): void {
	poller.emit("tick", latest);
}

/** Moves the clock and the timers together (PressEngine reads both). */
function advance(ms: number): void {
	mono += ms;
	mock.timers.tick(ms);
}

/** Lets the async press handlers settle. */
async function settle(): Promise<void> {
	for (let i = 0; i < 10; i++) await Promise.resolve();
	await new Promise<void>((resolve) => setImmediate(resolve));
}

type Fixture = ReturnType<typeof fixture>;

let keys = 0;

/** A key with its own context id, so no state carries over from another. */
function fixture(settings: ReadingSettings, { visible = true }: { visible?: boolean } = {}) {
	const images: string[] = [];
	const writes: unknown[] = [];
	let alertsShown = 0;
	const navigation = { entered: 0, left: 0 };
	const navigator = {
		stateFor: () => undefined,
		enter: async () => {
			navigation.entered++;
			return "entered" as const;
		},
		leave: async () => void navigation.left++
	};
	const action = new SensorReadingAction(navigator as unknown as ConstructorParameters<typeof SensorReadingAction>[0]);
	const handle = {
		id: `key-${++keys}`,
		device: { id: "dev", name: "fixture" },
		coordinates: { column: 0, row: 0 },
		isKey: () => true,
		isDial: () => false,
		setImage: async (image: string) => void images.push(decodeURIComponent(image)),
		setSettings: async (s: unknown) => void writes.push(s),
		showAlert: async () => void alertsShown++
	};
	Object.defineProperty(action, "actions", { get: () => (visible ? [handle] : []) });
	let current = settings;
	const payload = (extra: Record<string, unknown> = {}) => ({ settings: current, coordinates: { column: 0, row: 0 }, isInMultiAction: false, ...extra });
	const f = {
		action,
		handle,
		images,
		writes,
		navigation,
		get alertsShown() {
			return alertsShown;
		},
		appear(next: ReadingSettings = current) {
			current = next;
			action.onWillAppear({ action: handle, payload: payload() } as never);
		},
		settings(next: ReadingSettings) {
			current = next;
			action.onDidReceiveSettings({ action: handle, payload: payload() } as never);
		},
		down(extra: Record<string, unknown> = {}) {
			return action.onKeyDown({ action: handle, payload: payload(extra) } as never);
		},
		up(extra: Record<string, unknown> = {}) {
			action.onKeyUp({ action: handle, payload: payload(extra) } as never);
		},
		face(): string {
			return images[images.length - 1] ?? "";
		}
	};
	return f;
}

async function tap(f: Fixture, extra: Record<string, unknown> = {}): Promise<void> {
	await f.down(extra);
	advance(100);
	f.up(extra);
	await settle();
}

async function hold(f: Fixture): Promise<void> {
	await f.down();
	advance(500);
	await settle();
	advance(200);
	f.up();
	await settle();
}

describe("alerts on the key face, stepped by ticks", () => {
	it("Alert after shows the level once it lasted, repainting while the values hold still", () => {
		publish(reading("a", 85));
		const f = fixture({ readingKey: "a", warnValue: "80", alertDwellMs: "2000" });
		f.appear();
		tick();
		assert.ok(!f.face().includes(`fill="${WARN_BG}"`), "not yet");
		const frames = f.images.length;
		mono += 2000;
		tick();
		assert.ok(f.face().includes(`fill="${WARN_BG}"`), "the dwell completed on a tick with the same data");
		assert.equal(f.images.length, frames + 1, "one repaint, through the alert epoch");
		tick();
		assert.equal(f.images.length, frames + 1, "and nothing more while nothing changes");
		assert.deepEqual(f.writes, []);
	});

	it("an opted-in key snoozes on the press that finds it alerting, and the next press acts normally", async () => {
		publish(reading("a", 85));
		const f = fixture({ readingKey: "a", warnValue: "80", alertSnoozeMs: "900000" });
		f.appear();
		assert.ok(f.face().includes(`fill="${WARN_BG}"`));
		await f.down();
		f.up();
		assert.ok(!f.face().includes(`fill="${WARN_BG}"`), "silenced");
		assert.match(f.face(), BAND, "the snoozed cue");
		assert.deepEqual(f.writes, [], "the snooze press did not cycle the stat");
		await f.down();
		f.up();
		assert.equal(f.writes.length, 1, "the next press cycles");
		assert.match(f.face(), BAND, "still snoozed");
	});

	it("without the opt-in, a press while alerting keeps its own action", async () => {
		publish(reading("a", 85));
		const f = fixture({ readingKey: "a", warnValue: "80" });
		f.appear();
		await f.down();
		f.up();
		assert.equal(f.writes.length, 1);
		assert.ok(f.face().includes(`fill="${WARN_BG}"`));
	});

	it("tap cycles; hold opens details: the tap snoozes, the hold still opens details", async () => {
		publish(reading("a", 85));
		const f = fixture({ readingKey: "a", warnValue: "80", alertSnoozeMs: "300000", pressBehavior: "tap-cycle-hold-details" });
		f.appear();
		await hold(f);
		assert.equal(f.navigation.entered, 1, "the hold kept its action");
		assert.ok(f.face().includes(`fill="${WARN_BG}"`), "and snoozed nothing");
		await tap(f);
		assert.deepEqual(f.writes, [], "the tap snoozed instead of cycling");
		assert.match(f.face(), BAND);
	});

	it("a Back tile never snoozes", async () => {
		publish(reading("a", 85));
		const f = fixture({ readingKey: "a", warnValue: "80", alertSnoozeMs: "300000", detailRole: "back" });
		f.appear();
		await tap(f);
		assert.equal(f.navigation.left, 1);
		assert.doesNotMatch(f.face(), BAND);
	});
});

describe("a key a 1.8 candidate stored with a launch press or a remote PC's reading", () => {
	const SITE = { kind: "url", url: "https://example.com/status", stamp: "c3RhbXA" };
	for (const press of ["launch", "tap-cycle-hold-launch", "tap-launch-hold-details"]) {
		it(`press "${press}" cycles the stat at key down, as the default press does, and keeps every stored field`, async () => {
			publish(reading("a", 40));
			// `launch` is no field this build reads: the document is kept as stored.
			const stored = { readingKey: "a", pressBehavior: press, launch: SITE } as ReadingSettings;
			const f = fixture(stored);
			f.appear();
			assert.deepEqual(f.writes, [], "appearing writes nothing");
			await f.down();
			assert.deepEqual(f.writes, [{ ...stored, statMode: "min" }], "the key down cycled, and the launch fields stayed as stored");
			advance(800);
			await settle();
			f.up();
			await settle();
			assert.equal(f.writes.length, 1, "neither the hold nor the release does anything more");
			assert.equal(f.navigation.entered, 0, "no hold opens details");
			assert.equal(f.alertsShown, 0, "and no press shows the Stream Deck alert");
		});
	}

	it("a remote PC's reading draws Sensor missing, and appearing, settings and ticks write nothing", () => {
		publish(reading("a", 40));
		// rm: and the base64url of ["DESKTOP-7Q2", "f0000501", 0, "1000000"].
		const stored: ReadingSettings = { readingKey: "rm:WyJERVNLVE9QLTdRMiIsImYwMDAwNTAxIiwwLCIxMDAwMDAwIl0" };
		const f = fixture(stored);
		f.appear();
		f.settings({ ...stored });
		tick();
		assert.match(f.face(), /Sensor missing/);
		assert.doesNotMatch(f.face(), /DESKTOP-7Q2|Remote|PC offline/);
		assert.deepEqual(f.writes, []);
	});
});
