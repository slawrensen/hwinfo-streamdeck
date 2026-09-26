// Generates "F01 Bench.streamDeckProfile" for the Stream Deck + XL (9x4 keys,
// 6 dials): the bench fixture matrix of bench-validation-prompt.md A4 plus
// the junk and future-data documents of B3.3, from live reading identities
// (probe-live.json in this folder). The app imports it by double-click.
// Every fixture cell and its purpose is listed in FIXTURES.md, written next
// to the archive, so a verdict can cite a cell.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const bench = path.resolve(here, "..");
// The zip writer ships on the 1.7 line (scripts/lib/zip.mjs); point
// HWINFO_ZIP_LIB at a checkout's copy.
if (!process.env.HWINFO_ZIP_LIB) throw new Error("set HWINFO_ZIP_LIB to a 1.7 checkout's scripts/lib/zip.mjs");
const { writeZip } = await import(pathToFileURL(process.env.HWINFO_ZIP_LIB).href);

const probe = JSON.parse(fs.readFileSync(path.join(bench, "probe-live.json"), "utf8"));
const live = new Map(probe.readings.map((r) => [r.key, r]));
const K = {
	tctl: "f0000501:0:1000000", dieAvg: "f0000501:0:1000003", ccd1: "f0000501:0:1000008", ccd2: "f0000501:0:1000009", pkgPower: "f0000501:0:5000000",
	cpuUsage: "f0000300:0:7000021", core3Usage: "f0000300:0:7000007",
	pump: "f7006687:0:3000001", cpuFan: "f7006687:0:3000000", vcore: "f7006687:0:2000014",
	gpuTemp: "e0002000:0:1000000", hotSpot: "e0002000:0:1000005", gpuLoad: "e0002000:0:7000000", gpuPower: "e0002000:0:5000000",
	ramLoad: "f0000301:0:8000005",
	drive0: "f0000100:0:1000000", drive2: "f0000100:2:1000000", drive3: "f0000100:3:1000000", drive4: "f0000100:4:1000000",
	psuMinus12: "fc04a100:256:2000004", psuIn: "fc04a100:256:5000000"
};
for (const [name, key] of Object.entries(K)) if (!live.has(key)) throw new Error(`${name}: ${key} is not a live reading`);
const MISSING = "f0000501:0:10000ff"; // a real sensor, a reading id it does not publish

const STATES = [{ FontFamily: "", FontSize: 12, FontStyle: "", FontUnderline: false, OutlineThickness: 2, ShowTitle: false, TitleAlignment: "middle", TitleColor: "#ffffff" }];
const PLUGIN = { Name: "HWiNFO Sensors", UUID: "com.lawrensen.hwinfo", Version: "1.6.0.0" };
const act = (uuid, name, settings, states = STATES) => ({ ActionID: randomUUID(), LinkedTitle: true, Name: name, Plugin: PLUGIN, Resources: null, Settings: settings, State: 0, States: states, UUID: uuid });
const key = (s) => act("com.lawrensen.hwinfo.reading", "Sensor Reading", s);
const control = (s) => act("com.lawrensen.hwinfo.control", "HWiNFO Control", s);
const dial = (s) => act("com.lawrensen.hwinfo.dial", "Sensor Dial", s, [{}]);

const fixtures = [];
const keys = {};
const dials = {};
const put = (bank, cell, id, purpose, action) => {
	bank[cell] = action;
	fixtures.push({ id, cell: `${bank === dials ? "dial" : "key"} ${cell}`, purpose });
};

// Row 0: layouts and display.
put(keys, "0,0", "K1", "single, sparkline, warn 80 / crit 90, theme follows shared, press cycles stats", key({ readingKey: K.tctl, label: "Tctl", displayMode: "sparkline", warnValue: "80", critValue: "90" }));
put(keys, "1,0", "K2", "dual, row 2 shows max", key({ readingKey: K.tctl, secondaryReadingKey: K.ccd2, keyLayout: "dual", label: "Tctl", secondaryLabel: "CCD2", secondaryStatMode: "max" }));
put(keys, "2,0", "K3", "triple", key({ readingKey: K.ccd1, secondaryReadingKey: K.ccd2, quadReadingKey3: K.dieAvg, keyLayout: "triple", label: "CCD1", secondaryLabel: "CCD2", quadLabel3: "Die" }));
put(keys, "3,0", "K4", "quad of four same-named Drive Temperature readings, per-cell colors, cell labels", key({ readingKey: K.drive0, secondaryReadingKey: K.drive2, quadReadingKey3: K.drive3, quadReadingKey4: K.drive4, keyLayout: "quad", label: "D0", secondaryLabel: "D2", quadLabel3: "D3", quadLabel4: "D4", quadLabels: true, quadColors: ["#4cc2ff", "#ff7e8e", "#38cd89", "#d4ab33"] }));
put(keys, "4,0", "K5", "own theme ember, custom text color #FFD166, dim secondary, bar", key({ readingKey: K.gpuTemp, label: "GPU", theme: "ember", textMode: "custom", textColor: "#ffd166", textDimSecondary: true, displayMode: "bar" }));
put(keys, "5,0", "K6", "alert below: pump RPM warn 1800 / crit 1500 (pump idles near 1750, so warn is live)", key({ readingKey: K.pump, label: "Pump", warnValue: "1800", critValue: "1500", alertBelow: true }));
put(keys, "6,0", "K7", "°F with thresholds in °F (176 / 194 = 80 / 90 °C), 1 decimal", key({ readingKey: K.tctl, label: "Tctl F", fahrenheit: true, warnValue: "176", critValue: "194", decimals: "1" }));
put(keys, "7,0", "K8", "ring graph on GPU load", key({ readingKey: K.gpuLoad, label: "GPU Load", displayMode: "ring" }));
put(keys, "8,0", "K9", "no graph, value shows max, own theme paper", key({ readingKey: K.ramLoad, label: "RAM", displayMode: "none", statMode: "max", theme: "paper" }));

// Row 1: press, details, states, control.
put(keys, "0,1", "K10", "press opens details: custom list of 6 with a hand-made tile plan (a pair, a quad)", key({ readingKey: K.ccd2, label: "Custom", pressBehavior: "open-details", detailMode: "custom", detailKeys: [K.tctl, K.ccd2, K.gpuTemp, K.hotSpot, K.pump, K.ramLoad], detailTiles: [{ size: "2", labels: ["Tctl", "CCD2"], colors: ["#4cc2ff", null], cellLabels: true }, { size: "4", labels: ["", "", "Pump", "RAM"], colors: [null, null, null, null], cellLabels: false }], detailTitle: "Bench", detailDensity: "1" }));
put(keys, "1,1", "K11", "press opens details: filter drive, density 2, title, second Back off", key({ readingKey: K.drive2, label: "Drives", pressBehavior: "open-details", detailMode: "filter", detailFilter: "drive", detailDensity: "2", detailTitle: "Drives", detailMirrorBack: false }));
put(keys, "2,1", "K12", "tap cycles, hold opens details: source mode", key({ readingKey: K.gpuTemp, label: "GPU src", pressBehavior: "tap-cycle-hold-details", detailMode: "source" }));
put(keys, "3,1", "K13", "press opens details with an EMPTY filter", key({ readingKey: K.cpuUsage, label: "Empty flt", pressBehavior: "open-details", detailMode: "filter", detailFilter: "" }));
put(keys, "4,1", "K14", "zero value (Core 3 T1 usage idles at 0 %)", key({ readingKey: K.core3Usage, label: "Zero" }));
put(keys, "5,1", "K15", "negative value (PSU -12V)", key({ readingKey: K.psuMinus12, label: "-12V", decimals: "2" }));
put(keys, "6,1", "K16", "saved reading missing (real sensor, unpublished reading id)", key({ readingKey: MISSING, label: "Missing" }));
put(keys, "7,1", "C1", "Control: next, target Link ID bench", control({ command: "next", target: "bench" }));
put(keys, "8,1", "C2", "Control: resetStats, every dial, reach all", control({ command: "resetStats", target: "", resetScope: "all" }));

// Row 2: lossless and future-data documents (B3.3), plus thresholds edge.
put(keys, "0,2", "J1", "junk + future: unknown top-level and nested fields, junk list and tile entries, extra quadColors, unknown enums, default-on flag stored as a string", key({
	readingKey: K.tctl, label: "Junk", keyLayout: "hex", theme: "neon", decimals: "auto",
	zzFuture: 42, zzNested: { a: [1, { b: "c" }], d: null },
	pressBehavior: "open-details", detailMode: "custom", detailMirrorBack: "false",
	detailKeys: [K.tctl, 7, "", K.ccd2, null, "  ", K.gpuTemp],
	detailTiles: [3, "marker", { size: 6 }, { size: "2", labels: ["A", "B"], colors: [null, null], cellLabels: true, futureTileField: "x" }],
	quadColors: ["#111111", "#222222", "#333333", "#444444", "#123456", "#abcdef"]
}));
put(keys, "1,2", "J2", "unconfigured key (empty settings)", key({}));
put(keys, "2,2", "J3", "threshold junk: warn is not a number, crit 90", key({ readingKey: K.tctl, label: "Bad warn", warnValue: "abc", critValue: "90" }));
put(keys, "3,2", "J4", "1.7-era fields a 1.6 line never wrote (readingColors, sensorValueColors, overviewLabels on a key)", key({ readingKey: K.tctl, label: "1.7 flds", sensorValueColors: false, readingColors: { [K.tctl]: "#4cc2ff" }, zz17: true }));
put(keys, "4,2", "J5", "follows shared theme and text (twin of K1 for the (shared) summary)", key({ readingKey: K.gpuTemp, label: "Shared" }));
put(keys, "5,2", "J6", "own theme void, text follows shared", key({ readingKey: K.hotSpot, label: "Own void", theme: "void" }));

// Dials.
put(dials, "0,0", "D1", "three-reading rotation, names, two groups, Legacy preset", dial({ readingKey: K.tctl, rotationKeys: [K.tctl, K.ccd2, K.gpuTemp], rotationNames: { [K.tctl]: "Tctl", [K.ccd2]: "CCD2", [K.gpuTemp]: "GPU" }, rotationGroups: [{ name: "CPU", keys: [K.tctl, K.ccd2] }, { name: "GPU", keys: [K.gpuTemp] }], controlPreset: "legacy" }));
put(dials, "1,0", "D2", "Elite preset, two touch zones, auto cycle 5 s", dial({ readingKey: K.gpuTemp, rotationKeys: [K.gpuTemp, K.hotSpot, K.gpuPower], controlPreset: "elite", touchZones: "two", autoCycleMs: "5000" }));
put(dials, "2,0", "D3", "Custom preset, three touch zones, Link ID bench, auto cycle off", dial({ readingKey: K.ccd2, rotationKeys: [K.ccd2, K.pkgPower], controlPreset: "custom", gestureRotate: "step", gesturePressedRotate: "stepGroup", gestureShortPress: "cycleStat", gestureLongPress: "resetStats", gestureTap: "pauseResume", gestureTouchHold: "pin", touchZones: "three", linkId: "bench", autoCycleMs: "off" }));
put(dials, "3,0", "D4", "junk + future: non-object groups, unknown group field, junk rotationKeys mid-list, junk names, unknown auto cycle value", dial({
	readingKey: K.tctl, rotationKeys: [K.tctl, 5, "", K.ccd2, null, K.gpuTemp],
	rotationNames: { [K.tctl]: "T", junk: 5, "": "x" },
	rotationGroups: [3, "marker", { size: 6 }, { name: "A", keys: [K.tctl, K.ccd2], futureGroupField: true }, { name: "B", keys: [K.gpuTemp] }],
	autoCycleMs: "15000", zzFuture: { v: 1 }
}));
put(dials, "4,0", "D5", "saved reading missing on a dial", dial({ readingKey: MISSING, label: "Missing" }));
put(dials, "5,0", "D6", "thresholds 80 / 90 anchored to °C over a rotation holding an RPM reading", dial({ readingKey: K.tctl, rotationKeys: [K.tctl, K.pump], warnValue: "80", critValue: "90", alertUnit: "°C" }));

const umbrella = randomUUID();
const page = randomUUID();
const packageJson = { AppVersion: "7.4.2.22730", DeviceModel: "20GBX9901", DeviceSettings: null, FormatVersion: 1, OSType: "Windows", OSVersion: "10.0.19044", RequiredPlugins: ["com.lawrensen.hwinfo"] };
const umbrellaManifest = { Device: { Model: "20GBX9901", UUID: umbrella }, Name: "F01 Bench", Pages: { Current: "00000000-0000-0000-0000-000000000000", Default: page, Pages: [page] }, Version: "3.0" };
const pageManifest = { Controllers: [{ Actions: keys, Type: "Keypad" }, { Actions: dials, Type: "Encoder" }], Icon: "", Name: "" };
const json = (v) => Buffer.from(JSON.stringify(v), "utf8");
const archive = writeZip([
	{ name: "package.json", data: json(packageJson), method: 0, flags: 0x0800 },
	{ name: `Profiles/${umbrella.toUpperCase()}.sdProfile/manifest.json`, data: json(umbrellaManifest), method: 0, flags: 0x0800 },
	{ name: `Profiles/${umbrella.toUpperCase()}.sdProfile/Profiles/${page.toUpperCase()}/manifest.json`, data: json(pageManifest), method: 0, flags: 0x0800 }
]);
const out = path.join(bench, "fixtures", "F01 Bench.streamDeckProfile");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, archive);
fs.writeFileSync(path.join(bench, "fixtures", "F01 Bench.page.json"), JSON.stringify(pageManifest, null, "\t"));
const label = (k) => (live.get(k) ? `${live.get(k).label} (${live.get(k).unit})` : "missing");
fs.writeFileSync(
	path.join(bench, "fixtures", "FIXTURES.md"),
	["# F01 Bench fixtures (Stream Deck + XL)", "", "Generated by tools/gen-bench-profile.mjs from probe-live.json. Keys are `column,row`; dials are `column`.", "", "| ID | Cell | Purpose |", "| --- | --- | --- |", ...fixtures.map((f) => `| ${f.id} | ${f.cell} | ${f.purpose} |`), "", "Readings: " + Object.entries(K).map(([n, k]) => `${n} = \`${k}\` ${label(k)}`).join("; ") + `; missing = \`${MISSING}\`.`, ""].join("\n")
);
console.log(`wrote ${out} (${archive.length} B): ${Object.keys(keys).length} keys, ${Object.keys(dials).length} dials, ${fixtures.length} fixtures`);
