// Golden-review sheet for the configurable Back faces: renders every
// layout with and without the return hook side by side so overlap and
// placement can be eyeballed at 144 px and at the 72 px physical scale.
// Writes SVGs plus one HTML sheet. A manual review tool, not part of any
// build or suite; run with: npx tsx scripts/back-face-sheet.ts <outDir>
import fs from "node:fs";
import path from "node:path";

import { backFallbackSettings, compose, type ReadingSettings } from "../src/actions/sensor-reading";
import type { DeviceDetailState } from "../src/detail/navigation";
import type { PollerStatus } from "../src/poller";
import { renderDetailIdleBackKey } from "../src/ui/detail-renderer";
import { renderReadingKey } from "../src/ui/key-renderer";
import { loadThemes, resolvePalette } from "../src/ui/themes";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";

const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });

function reading(key: string, value: number, unit = "°C", label = key): Reading {
	return { key, type: unit === "W" ? SensorType.Power : SensorType.Temperature, sensorIndex: 0, id: 0, label, unit, value, valueMin: value - 10, valueMax: value + 12, valueAvg: value };
}
const readings = [reading("cpu:0:0", 55.4, "°C", "CPU Tctl"), reading("cpu:0:1", 121.6, "W", "CPU Power"), reading("cpu:0:2", 42.1, "°C", "CPU CCD1"), reading("cpu:0:3", 3.52, "V", "Vcore")];
const snapshot: SensorSnapshot = { pollTime: 1, version: 1, revision: 1, sensors: [{ index: 0, id: 0, instance: 0, name: "CPU [#0]" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) };
const ok: PollerStatus = { state: "ok", snapshot, source: "shared-memory" };
const down: PollerStatus = { state: "unavailable", reason: "not-running", message: "gone" };

const detail: DeviceDetailState = {
	deviceId: "dev1",
	pageSize: 11,
	primaryKey: "cpu:0:0",
	groupSettings: { readingKey: "cpu:0:0" },
	presentation: {},
	group: { mode: "source", primaryKey: "cpu:0:0", title: "CPU [#0]", keys: ["cpu:0:1"] },
	offset: 0,
	statModes: new Map(),
	surfaceCount: 1,
	pending: false
};

const config = loadThemes();
const palette = resolvePalette(config, config.defaultTheme, null, "normal");
const dual: ReadingSettings = { readingKey: "cpu:0:0", keyLayout: "dual", secondaryReadingKey: "cpu:0:1", secondaryLabel: "Package" };
const dualPinned: ReadingSettings = { ...dual, statMode: "max" };
const triple: ReadingSettings = { readingKey: "cpu:0:0", keyLayout: "triple", secondaryReadingKey: "cpu:0:1", quadReadingKey3: "cpu:0:2" };
const quad: ReadingSettings = { readingKey: "cpu:0:0", keyLayout: "quad", secondaryReadingKey: "cpu:0:1", quadReadingKey3: "cpu:0:2", quadReadingKey4: "cpu:0:3" };
const quadLabeled: ReadingSettings = { ...quad, quadLabels: true, label: "TCTL", secondaryLabel: "PWR", quadLabel3: "CCD1", quadLabel4: "VC" };

const faces: Array<[string, string]> = [
	["fallback-single", compose(backFallbackSettings(detail), ok, true)],
	["fallback-unavailable", compose(backFallbackSettings(detail), down, true)],
	["idle-back", renderDetailIdleBackKey()],
	["configured-single", compose({ readingKey: "cpu:0:0", label: "My CPU" }, ok, true)],
	["single-stat-badge", compose({ readingKey: "cpu:0:0", statMode: "max" }, ok, true)],
	["single-bar", renderReadingKey({ label: "CPU Tctl", valueText: "55.4", unitText: "°C", statBadge: "", gauge: { kind: "bar", fraction: 0.62, zones: [] }, palette, returnMark: true })],
	["single-ring", renderReadingKey({ label: "CPU Tctl", valueText: "55.4", unitText: "°C", statBadge: "", gauge: { kind: "ring", fraction: 0.62, zones: [] }, palette, returnMark: true })],
	["single-spark", renderReadingKey({ label: "CPU Tctl", valueText: "55.4", unitText: "°C", statBadge: "", history: [50, 52, 51, 55, 58, 54, 53, 56, 55, 57], palette, returnMark: true })],
	["dual", compose(dual, ok, true)],
	["dual-no-mark", compose(dual, ok)],
	["dual-badged", compose(dualPinned, ok, true)],
	["triple", compose(triple, ok, true)],
	["triple-no-mark", compose(triple, ok)],
	["triple-badged", compose({ ...triple, statMode: "min" }, ok, true)],
	["quad", compose(quad, ok, true)],
	["quad-no-mark", compose(quad, ok)],
	["quad-labeled", compose(quadLabeled, ok, true)],
	["quad-badged", compose({ ...quad, statMode: "avg" }, ok, true)],
	["missing-configured", compose({ readingKey: "gone:0:0" }, ok, true)]
];

const cards: string[] = [];
for (const [name, svg] of faces) {
	fs.writeFileSync(path.join(outDir, `${name}.svg`), svg);
	const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
	cards.push(`<figure><img src="${uri}" width="144" height="144"><img src="${uri}" width="72" height="72"><figcaption>${name}</figcaption></figure>`);
}
fs.writeFileSync(
	path.join(outDir, "back-sheet.html"),
	`<!doctype html><meta charset="utf-8"><title>Back face review</title><style>body{background:#191b1f;color:#d6d9de;font:13px "Segoe UI";display:flex;flex-wrap:wrap;gap:14px;padding:14px}figure{margin:0;text-align:center}img{image-rendering:auto;border:1px solid #333;border-radius:8px;margin:2px;background:#000}figcaption{margin-top:4px;color:#9aa0a6}</style>${cards.join("\n")}`
);
console.error(`wrote ${faces.length} faces + back-sheet.html to ${outDir}`);
