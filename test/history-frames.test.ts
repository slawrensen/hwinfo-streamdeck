/**
 * A Trend window's right edge moves with new data, never with the clock
 * alone. The dial composes on every poller tick and the key repaints for
 * reasons other than data (a settings echo): while the status and the
 * history revision hold still, both must send the same bytes, so the
 * monotonic clock running on adds no setFeedback or setImage call. A new
 * sample moves the window at once. Neither consumer writes settings on
 * appear, settings receipt, tick or disappear.
 *
 * The actions are constructed for real (their tick listeners sit on the
 * poller) and driven through the poller's own "tick" event; only the SDK's
 * sends, the poller's retain/release/status and the panel push are
 * replaced. Each test file runs in its own process, so the poller's history
 * store here is this file's alone. The wall clock jumps an hour either way
 * during the held ticks: only monotonic time may move a window.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { SensorDialAction, type DialSettings } from "../src/actions/sensor-dial";
import { SensorReadingAction, type ReadingSettings } from "../src/actions/sensor-reading";
import type { DetailNavigator } from "../src/detail/navigation";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import { poller, type PollerStatus } from "../src/poller";
import { applyGlobalThemeSettings } from "../src/ui/theme-store";

// The deck's stored theme, as the globals response would bring it: a first
// sighting with settings then has no legacy theme decision to persist.
applyGlobalThemeSettings({ theme: "void" });

let mono = 0;
let pollTime = 0;
let latest: PollerStatus = { state: "unavailable", reason: "not-running", message: "fixture" };
const restores: Array<() => void> = [];
beforeEach(() => {
	mono = 5_000_000;
	pollTime = 0;
	for (const m of [
		mock.method(performance, "now", () => mono),
		mock.method(poller, "retain", () => {}),
		mock.method(poller, "release", () => {}),
		mock.method(poller, "getStatus", () => latest)
	]) restores.push(() => m.mock.restore());
});
afterEach(() => {
	for (const restore of restores.splice(0)) restore();
});

function reading(key: string, value: number, label: string): Reading {
	return { key, type: SensorType.Temperature, sensorIndex: 0, id: 1, label, unit: "°C", value, valueMin: value, valueMax: value, valueAvg: value };
}

/** A fresh status (a new producer stamp) over `values`, as the poller would
 * publish it, and the matching history sample at the current tick time. */
function publish(values: ReadonlyArray<[string, number, string]>): PollerStatus {
	const readings = values.map(([key, value, label]) => reading(key, value, label));
	const snapshot: SensorSnapshot = { pollTime: ++pollTime, valueRevision: pollTime, version: 1, revision: 1, sensors: [{ index: 0, id: 0, instance: 0, name: "CPU" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) };
	poller.history.ingest({ kind: "ok", at: mono, snapshot, source: "shared-memory", evidence: true, stampAdvanced: true, evidenceAgeMs: 0 });
	latest = { state: "ok", snapshot, source: "shared-memory" };
	return latest;
}

/** The same status again with no new sample (a held tick). */
function hold(): void {
	poller.history.ingest({ kind: "ok", at: mono, snapshot: (latest as Extract<PollerStatus, { state: "ok" }>).snapshot, source: "shared-memory", evidence: false, stampAdvanced: false, evidenceAgeMs: 0 });
}

function tick(): void {
	poller.emit("tick", latest);
}

/** Holds the wall clock an hour ahead, then an hour behind, on alternate calls. */
function jumpWallClock(): (i: number) => void {
	const wall = Date.now();
	const clock = mock.method(Date, "now", () => wall);
	restores.push(() => clock.mock.restore());
	return (i) => clock.mock.mockImplementation(() => wall + (i % 2 === 0 ? 3_600_000 : -3_600_000));
}

describe("a Trend window moves with new data only", () => {
	it("the two-row dial sends one frame per data change while the clocks run on, and writes no settings", () => {
		const keys = ["t:0:1", "t:0:2"];
		const settings: DialSettings = { dialView: "tworow", readingKey: keys[0], rotationKeys: keys, dialHistoryWindow: "1m" };
		const frames: string[] = [];
		const writes: unknown[] = [];
		const action = new SensorDialAction();
		const handle = {
			id: "dial-frames", device: { id: "dev", name: "fixture" }, coordinates: { column: 0, row: 0 },
			isDial: () => true, isKey: () => false,
			setFeedback: async (payload: { canvas: string }) => void frames.push(payload.canvas),
			setTriggerDescription: async () => {},
			setSettings: async (s: unknown) => void writes.push(s)
		};
		Object.defineProperty(action, "actions", { get: () => [handle] });
		(action as unknown as { pushPanelPreview(): void }).pushPanelPreview = () => {};
		const row = (i: number): ReadonlyArray<[string, number, string]> => [[keys[0] as string, 40 + (i % 7), "CPU Package"], [keys[1] as string, 50 + (i % 5), "CPU Core"]];

		publish(row(0));
		action.onWillAppear({ action: handle, payload: { settings } } as never);
		// A reconnect replays the appear; the panel opens and asks for its
		// preview. None of it is an edit.
		action.onWillAppear({ action: handle, payload: { settings } } as never);
		action.onPropertyInspectorDidAppear();
		action.onSendToPlugin({ action: handle, payload: { event: "getPreview" } } as never);
		for (let i = 1; i <= 30; i++) {
			mono += 1000;
			publish(row(i));
			tick();
		}
		const settled = frames.length;
		const face = frames[frames.length - 1] as string;
		assert.match(decodeURIComponent(face), /<path d="M[^"]*" fill="none" stroke=/, "the rows draw their windows");
		const jump = jumpWallClock();
		for (let i = 0; i < 4; i++) {
			mono += 2000;
			jump(i);
			hold();
			tick();
		}
		assert.equal(frames.length, settled, "eight seconds of held ticks, the wall clock an hour off either way: no new frame");
		mono += 2000;
		publish(row(31));
		tick();
		assert.equal(frames.length, settled + 1, "a new sample sends one frame");
		assert.notEqual(frames[frames.length - 1], face, "and the window moved");
		action.onDidReceiveSettings({ action: handle, payload: { settings: { ...settings } } } as never);
		action.onDidReceiveSettings({ action: handle, payload: { settings: { ...settings, dialHistoryWindow: "5m" } } } as never);
		action.onWillDisappear({ action: handle, payload: { settings } } as never);
		assert.deepEqual(writes, [], "no setSettings on appear, a replayed appear, the panel opening, ticks, settings receipt or disappear");
	});

	it("a busy-skipped read on held data ends the dial's line on that tick", () => {
		const keys = ["t:2:1", "t:2:2"];
		const settings: DialSettings = { dialView: "tworow", readingKey: keys[0], rotationKeys: keys, dialHistoryWindow: "1m" };
		const frames: string[] = [];
		const action = new SensorDialAction();
		const handle = {
			id: "dial-skip", device: { id: "dev", name: "fixture" }, coordinates: { column: 0, row: 0 },
			isDial: () => true, isKey: () => false,
			setFeedback: async (payload: { canvas: string }) => void frames.push(payload.canvas),
			setTriggerDescription: async () => {},
			setSettings: async () => {}
		};
		Object.defineProperty(action, "actions", { get: () => [handle] });
		(action as unknown as { pushPanelPreview(): void }).pushPanelPreview = () => {};
		const row = (i: number): ReadonlyArray<[string, number, string]> => [[keys[0] as string, 40 + (i % 7), "CPU Package"], [keys[1] as string, 50 + (i % 5), "CPU Core"]];

		publish(row(0));
		action.onWillAppear({ action: handle, payload: { settings } } as never);
		for (let i = 1; i <= 10; i++) {
			mono += 1000;
			publish(row(i));
			tick();
		}
		mono += 1000;
		hold();
		tick();
		const settled = frames.length;
		const face = frames[frames.length - 1] as string;
		// The poller skipped its read (the producer was busy): the status
		// holds, and only the history knows the run ended.
		mono += 1000;
		poller.history.ingest({ kind: "skipped", at: mono });
		tick();
		assert.equal(frames.length, settled + 1, "the skipped read sends one frame on its own tick");
		assert.notEqual(frames[frames.length - 1], face, "the line ends where the read was skipped");
		action.onWillDisappear({ action: handle, payload: { settings } } as never);
	});

	it("a key repaint for another reason draws the same window while the clocks run on, and writes no settings", () => {
		const key = "t:1:1";
		const settings: ReadingSettings = { readingKey: key, displayMode: "sparkline", historyWindow: "1m" };
		const images: string[] = [];
		const writes: unknown[] = [];
		const action = new SensorReadingAction({ stateFor: () => undefined } as unknown as DetailNavigator);
		const handle = {
			id: "key-frames", device: { id: "dev", name: "fixture" }, coordinates: { column: 0, row: 0 },
			isKey: () => true, isDial: () => false,
			setImage: async (image: string) => void images.push(image),
			setSettings: async (s: unknown) => void writes.push(s)
		};
		Object.defineProperty(action, "actions", { get: () => [handle] });
		(action as unknown as { pushPanelPreview(): void }).pushPanelPreview = () => {};
		const subscribe = mock.method(poller, "subscribeSeries", () => {});
		restores.push(() => subscribe.mock.restore());

		publish([[key, 40, "CPU Package"]]);
		action.onWillAppear({ action: handle, payload: { settings } } as never);
		action.onWillAppear({ action: handle, payload: { settings } } as never);
		action.onPropertyInspectorDidAppear();
		action.onSendToPlugin({ action: handle, payload: { event: "getPreview" } } as never);
		for (let i = 1; i <= 30; i++) {
			mono += 1000;
			publish([[key, 40 + (i % 9), "CPU Package"]]);
			tick();
		}
		const settled = images.length;
		const face = images[images.length - 1] as string;
		assert.match(decodeURIComponent(face), /<path d="M[^"]*" fill="none" stroke=/, "the strip draws the window");
		const jump = jumpWallClock();
		mono += 2000;
		jump(0);
		hold();
		tick();
		mono += 2000;
		jump(1);
		// An unchanged echo of the settings repaints this key.
		action.onDidReceiveSettings({ action: handle, payload: { settings: { ...settings } } } as never);
		assert.equal(images.length, settled, "same data, four seconds later, the wall clock an hour off either way: the same bytes, no setImage");
		mono += 2000;
		publish([[key, 47, "CPU Package"]]);
		tick();
		assert.equal(images.length, settled + 1, "a new sample sends one image");
		assert.notEqual(images[images.length - 1], face, "and the window moved");
		action.onWillDisappear({ action: handle, payload: { settings } } as never);
		assert.deepEqual(writes, [], "no setSettings on appear, a replayed appear, the panel opening, ticks, settings receipt or disappear");
	});
});
