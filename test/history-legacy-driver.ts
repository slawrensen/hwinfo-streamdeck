/**
 * A recorded tick sequence and a matrix of settings under which no Trend
 * window applies: the window absent, junk, or set where it is ignored
 * (Bar, Ring, None, the multi layouts, the single and three-row dial
 * views). The faces composed here must stay byte for byte what 1.7.1
 * composed: test/golden/history-legacy-faces.json was written by running
 * this same module against the v1.7.1 sources. In a build with the
 * timestamped history store, every window of the same readings is retained
 * throughout, so the store's presence is part of what is proven harmless.
 */
import { composeDialSvg, type DialSettings } from "../src/actions/sensor-dial";
import { compose, type ReadingSettings } from "../src/actions/sensor-reading";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import { poller } from "../src/poller";
import { SessionStatsStore } from "../src/stats";

const K1 = "a1:0:1";
const K2 = "a1:0:2";
const K3 = "b2:0:3";
const ROWS = [K1, K2, K3];

export const KEY_CASES: Readonly<Record<string, Record<string, unknown>>> = {
	"sparkline, no window": { readingKey: K1, displayMode: "sparkline" },
	"legacy sparkline flag": { readingKey: K1, sparkline: true },
	"window 5M": { readingKey: K1, displayMode: "sparkline", historyWindow: "5M" },
	"window number 5": { readingKey: K1, displayMode: "sparkline", historyWindow: 5 },
	"window empty": { readingKey: K1, displayMode: "sparkline", historyWindow: "" },
	"window 30m": { readingKey: K1, displayMode: "sparkline", historyWindow: "30m" },
	"window null": { readingKey: K1, displayMode: "sparkline", historyWindow: null },
	"window object": { readingKey: K1, displayMode: "sparkline", historyWindow: {} },
	"window without a sparkline": { readingKey: K1, historyWindow: "5m" },
	"bar with window": { readingKey: K1, displayMode: "bar", historyWindow: "5m" },
	"ring with window": { readingKey: K1, displayMode: "ring", historyWindow: "15m" },
	"none with window": { readingKey: K1, displayMode: "none", historyWindow: "1m" },
	"dual with window": { readingKey: K1, keyLayout: "dual", secondaryReadingKey: K2, displayMode: "sparkline", historyWindow: "5m" },
	"triple with window": { readingKey: K1, keyLayout: "triple", secondaryReadingKey: K2, quadReadingKey3: K3, displayMode: "sparkline", historyWindow: "5m" },
	"quad with window": { readingKey: K1, keyLayout: "quad", secondaryReadingKey: K2, quadReadingKey3: K3, quadReadingKey4: K1, displayMode: "sparkline", historyWindow: "5m" },
	"fan sparkline, no window": { readingKey: K2, displayMode: "sparkline" },
	"usage sparkline after a gap, no window": { readingKey: K3, displayMode: "sparkline" }
};

export const DIAL_CASES: Readonly<Record<string, Record<string, unknown>>> = {
	"single with window": { readingKey: K1, dialHistoryWindow: "5m" },
	"overview with window": { dialView: "overview", readingKey: K2, rotationKeys: ROWS, dialHistoryWindow: "5m" },
	"two rows, no window": { dialView: "tworow", readingKey: K1, rotationKeys: ROWS },
	"two rows, window 5M": { dialView: "tworow", readingKey: K1, rotationKeys: ROWS, dialHistoryWindow: "5M" },
	"two rows, window number 5": { dialView: "tworow", readingKey: K1, rotationKeys: ROWS, dialHistoryWindow: 5 },
	"two rows, window empty": { dialView: "tworow", readingKey: K2, rotationKeys: ROWS, dialHistoryWindow: "" },
	"two rows, window 30m": { dialView: "tworow", readingKey: K3, rotationKeys: ROWS, dialHistoryWindow: "30m" },
	"two rows on Outline, no window": { dialView: "tworow", readingKey: K1, rotationKeys: ROWS, dialBackground: "outline" },
	"two rows on Glass, window 1M": { dialView: "tworow", readingKey: K2, rotationKeys: ROWS, dialBackground: "glass", dialHistoryWindow: "1M" }
};

function frame(tick: number): SensorSnapshot | null {
	if (tick === 20) return null; // a skipped read: every 1.7.1 ring empties
	const readings: Reading[] = [
		{ key: K1, type: SensorType.Temperature, sensorIndex: 0, id: 1, label: "CPU Package", unit: "°C", value: 40 + ((tick * 7) % 23) + tick / 10, valueMin: 38, valueMax: 70, valueAvg: 50 },
		{ key: K2, type: SensorType.Fan, sensorIndex: 0, id: 2, label: "CPU Fan", unit: "RPM", value: 1200 + ((tick * 37) % 300), valueMin: 1100, valueMax: 1600, valueAvg: 1300 },
		{ key: K3, type: SensorType.Usage, sensorIndex: 1, id: 3, label: "GPU Core Load", unit: "%", value: (tick * 13) % 100, valueMin: 0, valueMax: 100, valueAvg: 40 }
	].filter((r) => !(tick === 30 && r.key === K3)); // one withheld frame for K3
	return {
		pollTime: tick,
		version: 1,
		revision: 1,
		sensors: [{ index: 0, id: 0xa1, instance: 0, name: "CPU" }, { index: 1, id: 0xb2, instance: 0, name: "GPU" }],
		readings,
		byKey: new Map(readings.map((r) => [r.key, r]))
	};
}

/** Drives the poller singleton through 40 ticks, then composes every case. */
export function legacyFaces(): Record<string, string> {
	let tick = 0;
	const seam = poller as unknown as { openProvider(): { source: "shared-memory"; read(): SensorSnapshot | null; close(): void }; tick(): void };
	seam.openProvider = () => ({ source: "shared-memory", read: () => frame(tick), close() {} });
	for (const key of ROWS) poller.subscribeSeries(key);
	const history = (poller as unknown as { history?: { setInterest(id: string, entries: unknown[]): void } }).history;
	history?.setInterest("legacy-probe", ROWS.map((savedKey) => ({ savedKey, window: ["1m", "5m", "15m"] })));
	const stats = new SessionStatsStore();
	for (tick = 1; tick <= 40; tick++) {
		seam.tick();
		const status = poller.getStatus();
		if (status.state !== "ok") continue;
		for (const key of ROWS) {
			const reading = status.snapshot.byKey.get(key);
			if (reading === undefined) stats.reset([key]);
			else stats.observe(reading, status.snapshot, status.source);
		}
	}
	const status = poller.getStatus();
	const faces: Record<string, string> = {};
	for (const [name, settings] of Object.entries(KEY_CASES)) faces[`key: ${name}`] = compose(settings as ReadingSettings, status);
	for (const [name, settings] of Object.entries(DIAL_CASES)) {
		faces[`dial: ${name}`] = composeDialSvg({ settings: settings as DialSettings, stats, statMode: "current", overlay: null, pinned: false, cyclePaused: false }, status);
	}
	return faces;
}
