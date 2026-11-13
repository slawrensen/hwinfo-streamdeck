// The plugin perf harness (scripts/perf-plugin.mjs): its statistics never
// turn missing evidence into a zero, its run order is ABBA, its synthetic
// catalog is a mapping the plugin's own decoder reads, every workload's
// settings documents mean what the report says they mean to the 1.8
// parsers, and a release pack extracts to the exact shipped bytes.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { parseSnapshot } from "../src/hwinfo/reader.ts";
import { parseCalculatedReadings } from "../src/hwinfo/calculated.ts";
import { stripGroupOf } from "../src/strip/settings.ts";
import { parseHistoryWindow } from "../src/history/window.ts";
import { dialBackgroundOf } from "../src/ui/dial-background.ts";
import { resolvePluginDir } from "../scripts/lib/e2e-common.mjs";
import { catalogMappingSize, catalogReadings, catalogValue, composeCatalog } from "../scripts/lib/perf-catalog.mjs";
import {
	abbaOrder,
	allocatedBytes,
	cycleWindowStats,
	median,
	parseOsLine,
	peakInWindow,
	percentile,
	probeWindowStats,
	renderSummary,
	renderTable,
	summarize,
	trafficStats
} from "../scripts/lib/perf-metrics.mjs";
import { extractPack, parseSubjectSpec, resolveSubject, sha256 } from "../scripts/lib/perf-subject.mjs";
import { buildWorkload, LOOKS, STRIP_WINDOW, WORKLOADS } from "../scripts/lib/perf-workloads.mjs";
import { writeZip } from "../scripts/lib/zip.mjs";

const line = (at, cpuUs, heapUsedNow, gc = [], extra = {}) => ({
	at,
	cpu: { user: cpuUs, system: 0 },
	mem: { rss: 50 * 1048576, heapUsed: 10 * 1048576, external: 1048576 },
	elu: { idle: at * 0.9, active: at * 0.1 },
	heapUsedNow,
	gc,
	...extra
});

describe("perf statistics", () => {
	it("percentiles are nearest-rank and empty input is null, not zero", () => {
		assert.equal(percentile([], 50), null);
		assert.equal(percentile([1, 2, 3, 4], 50), 2);
		assert.equal(percentile([1, 2, 3, 4], 95), 4);
		assert.deepEqual(summarize([NaN, undefined]), { n: 0, min: null, p50: null, p95: null, max: null, mean: null });
		assert.equal(summarize([3, 1, 2]).p50, 2);
		assert.equal(median([]), null);
		assert.equal(median([4, 1, 3, 2]), 2.5);
	});

	it("allocation is every rise of the used heap between collections", () => {
		// 10 -> 30 (alloc 20), GC to 12, rise to 25 (alloc 13), GC to 11, end 18 (alloc 7)
		assert.equal(allocatedBytes(10, [{ before: 30, after: 12 }, { before: 25, after: 11 }], 18), 40);
		assert.equal(allocatedBytes(10, [], 15), 5);
		assert.equal(allocatedBytes(10, [], 8), 0, "a fall with no collection recorded is not negative allocation");
		assert.equal(allocatedBytes(undefined, [], 8), null);
		assert.equal(allocatedBytes(10, [{ before: null, after: 4 }], 8), null, "a collection without figures voids the estimate");
	});

	it("the probe window gives CPU over wall time and refuses one line", () => {
		const lines = [line(1000, 0, 100), line(2000, 5000, 200), line(3000, 10_000, 150, [{ cost: 400, before: 300, after: 100 }])];
		const stats = probeWindowStats(lines, 1000, 3000);
		assert.equal(stats.seconds, 2);
		assert.equal(stats.cpuPctOneCore, 0.5, "10 ms of CPU in 2 s is 0.5 % of one core");
		assert.equal(stats.gcCount, 1);
		assert.equal(stats.gcPauseMsPerSec, 0.2);
		// 100 -> 200 (100), then 200 -> 300 (100) and after 100 -> 150 (50)
		assert.equal(stats.allocMBPerSec, 250 / 1048576 / 2);
		const lonely = probeWindowStats(lines, 1500, 2500);
		assert.equal(lonely.lines, 1);
		assert.equal(lonely.cpuPctOneCore, null);
		assert.equal(lonely.allocMBPerSec, null);
		assert.equal(lonely.gcCount, null);
	});

	it("cycle CPU is cycles over the calibrated rate, with the busiest second", () => {
		const hz = 1e9;
		const samples = [{ at: 0, cycles: 0 }, { at: 1000, cycles: 1e7 }, { at: 2000, cycles: 4e7 }];
		const stats = cycleWindowStats(samples, 0, 2000, hz);
		assert.equal(stats.cpuPctOneCore, 2);
		assert.equal(stats.maxSecondPct, 3);
		assert.equal(cycleWindowStats(samples.slice(0, 1), 0, 2000, hz).cpuPctOneCore, null);
		assert.equal(cycleWindowStats(samples, 0, 2000, 0).cpuPctOneCore, null, "an uncalibrated counter is no figure");
	});

	it("traffic is per kind, per context and per byte", () => {
		const m = (at, event, context, bytes) => ({ at, event, context, bytes });
		const messages = [m(0, "setImage", "a", 100), m(500, "setImage", "a", 300), m(900, "setImage", "a", 200), m(1500, "setImage", "b", 1000), m(1800, "setFeedback", "d", 50), m(5000, "setImage", "a", 9999)];
		const t = trafficStats(messages, 0, 2000);
		assert.equal(t.setImage.calls, 4);
		assert.equal(t.setImage.contexts, 2);
		assert.equal(t.setImage.callsPerSec, 2);
		assert.deepEqual(t.setImage.perContextPerSec, { median: 1, max: 1.5 });
		assert.equal(t.setImage.peakIn1sPerContext, 3);
		assert.equal(t.setImage.bytesPerCall.max, 1000, "a message outside the window is not counted");
		assert.equal(t.setImage.bytesPerSec, 800);
		assert.equal(t.setFeedback.calls, 1);
		const quiet = trafficStats([], 0, 2000);
		assert.equal(quiet.setFeedback.perContextPerSec.max, null);
		assert.equal(quiet.setFeedback.bytesPerCall.p50, null);
	});

	it("the one-second peak counts a sliding window", () => {
		assert.equal(peakInWindow([], 1000), 0);
		assert.equal(peakInWindow([0, 500, 999], 1000), 3);
		assert.equal(peakInWindow([0, 999, 1000, 1001, 1999], 1000), 3, "1999 - 999 is a full second, so not the same window");
	});

	it("runs alternate ABBA so drift lands on both subjects", () => {
		assert.deepEqual(abbaOrder(["A", "B"], 2), ["A", "B", "B", "A"]);
		assert.deepEqual(abbaOrder(["A", "B"], 3), ["A", "B", "B", "A", "A", "B"]);
		assert.throws(() => abbaOrder(["A"], 0), RangeError);
		assert.throws(() => abbaOrder([], 2), RangeError);
	});

	it("an OS sample line parses or is refused whole", () => {
		assert.deepEqual(parseOsLine("1700000000000 31457280 209 58720256 1234\r"), { at: 1700000000000, privateBytes: 31457280, handles: 209, workingSet: 58720256, cpuMs: 1234 });
		assert.equal(parseOsLine("1700000000000 31457280 209"), null);
		assert.equal(parseOsLine("Get-Process : cannot find"), null);
	});

	it("the table prints medians with every run, a ratio, and skips rows nobody measured", () => {
		const run = (subject, cpu) => ({ subject, cycles: { cpuPctOneCore: cpu }, traffic: { setImage: { callsPerSec: 10 } } });
		const table = renderTable([run("1.7.1", 0.2), run("1.8", 0.3), run("1.8", 0.5), run("1.7.1", 0.4)], ["1.7.1", "1.8"]);
		assert.match(table, /\| CPU % one core \(cycles\) \| 0\.300 \(0\.200, 0\.400\) \| 0\.400 \(0\.300, 0\.500\) \| 1\.33x \|/);
		assert.match(table, /setImage calls\/s \| 10\.0 \(10\.0, 10\.0\)/);
		assert.doesNotMatch(table, /setFeedback/, "no subject sent feedback, so no row claims a figure");
		assert.doesNotMatch(table, /—/);
	});
});

describe("perf summary", () => {
	it("one row per workload with baseline / candidate medians and the run counts", () => {
		const run = (subject, cpu) => ({ subject, cycles: { cpuPctOneCore: cpu }, os: { privateMB: { p50: 30 }, handles: { p50: 209 } } });
		const table = renderSummary([{ name: "deck", runs: [run("a", 0.2), run("b", 0.3), run("b", 0.5), run("a", 0.4)] }], ["a", "b"]);
		assert.match(table, /\| deck \| 2\+2 \| 0\.300 \/ 0\.400 \| 30\.0 \/ 30\.0 \| 209 \/ 209 \| n\/a \/ n\/a \|/);
		assert.throws(() => renderSummary([], ["a"]), RangeError);
	});
});

describe("synthetic catalog", () => {
	const readings = catalogReadings();

	it("600 readings with unique keys in the live key shape", () => {
		assert.equal(readings.length, 600);
		assert.equal(new Set(readings.map((r) => r.key)).size, 600);
		for (const r of readings) assert.match(r.key, /^f0007[0-9a-f]{3}:0:[0-9a-f]+$/);
		assert.equal(readings.filter((r) => !r.moving).length, 120, "every fifth reading holds still");
	});

	it("values are a function of reading and tick only", () => {
		const moving = readings.find((r) => r.moving);
		const still = readings.find((r) => !r.moving);
		assert.equal(catalogValue(moving, 7), catalogValue(moving, 7));
		assert.notEqual(catalogValue(moving, 7), catalogValue(moving, 8));
		assert.equal(catalogValue(still, 7), catalogValue(still, 8));
	});

	it("the producer's image is a mapping the plugin's own decoder reads back", () => {
		const buf = Buffer.alloc(catalogMappingSize(readings));
		composeCatalog(buf, readings, 3, 1_700_000_000);
		const snapshot = parseSnapshot(buf);
		assert.equal(snapshot.readings.length, 600);
		assert.equal(snapshot.sensors.length, 25);
		assert.deepEqual(snapshot.readings.map((r) => r.key), readings.map((r) => r.key));
		const r = snapshot.byKey.get(readings[7].key);
		assert.equal(r.value, catalogValue(readings[7], 3));
		assert.equal(r.unit, readings[7].unit);
	});
});

describe("workloads", () => {
	const readings = catalogReadings();
	const known = new Set(readings.map((r) => r.key));

	it("every workload builds with unique contexts on registered devices", () => {
		for (const name of Object.keys(WORKLOADS)) {
			const w = buildWorkload(name, readings);
			assert.ok(w.contexts.length > 0, name);
			assert.equal(new Set(w.contexts.map((c) => c.context)).size, w.contexts.length, `${name}: duplicate context`);
			const devices = new Set(w.devices.map((d) => d.id));
			for (const c of w.contexts) assert.ok(devices.has(c.device), `${name}: ${c.context} on an unregistered device`);
		}
		assert.throws(() => buildWorkload("nope", readings), RangeError);
	});

	it("every plain reading key names a catalog reading", () => {
		for (const name of Object.keys(WORKLOADS)) {
			for (const c of buildWorkload(name, readings).contexts) {
				for (const field of ["readingKey", "secondaryReadingKey", "quadReadingKey3", "quadReadingKey4"]) {
					const k = c.settings[field];
					if (k === undefined || k.startsWith("calc:")) continue;
					assert.ok(known.has(k), `${name}/${c.context}.${field}: ${k}`);
				}
			}
		}
	});

	it("strip members carry one joined copy the 1.8 parser reads as the named layout", () => {
		for (const name of Object.keys(WORKLOADS).filter((n) => n.startsWith("strip-"))) {
			const w = buildWorkload(name, readings);
			const copies = w.contexts.map((c) => stripGroupOf(c.settings.stripGroup));
			const encoders = w.devices[0].type === 13 ? 6 : 4;
			assert.equal(w.contexts.length, encoders, name);
			assert.deepEqual(w.contexts.map((c) => c.column), Array.from({ length: encoders }, (_u, i) => i), `${name}: members on columns 0..n-1`);
			for (const copy of copies) {
				assert.equal(copy?.joined, true, name);
				assert.equal(copy.id, copies[0].id);
				assert.equal(copy.config.encoders, encoders);
				assert.equal(copy.config.layout, name.includes("whole") ? "whole" : "split");
				assert.equal(copy.config.window, STRIP_WINDOW);
				for (const pane of copy.config.layout === "whole" ? copy.config.panes.slice(0, 1) : copy.config.panes) {
					assert.ok(pane.series.length >= (pane.style === "lanes" ? 2 : 1), `${name}: pane ${pane.style} has its readings`);
					for (const s of pane.series) assert.ok(readings.find((r) => r.key === s.key)?.moving, `${name}: series ${s.key} moves`);
				}
			}
			const look = LOOKS.find((l) => name.endsWith(`-${l}`)) ?? "theme";
			assert.equal(copies[0].config.background, look);
			// The individual fields 1.7.1 draws agree on the look.
			for (const c of w.contexts) assert.equal(dialBackgroundOf(c.settings.dialBackground), look);
			assert.equal(w.fillS, 60, `${name}: warm-up must fill the window`);
		}
	});

	it("independent dials carry each look exactly as the dial's reader spells it", () => {
		for (const look of LOOKS) {
			for (const c of buildWorkload(`dials-${look}`, readings).contexts) assert.equal(dialBackgroundOf(c.settings.dialBackground), look);
		}
	});

	it("the calculated workload stores 32 valid sums of 8 distinct inputs", () => {
		const w = buildWorkload("calc32", readings);
		const plan = parseCalculatedReadings(w.globals.calculatedReadings);
		assert.equal(plan.definitions.length, 32);
		assert.ok(plan.rows.every((row) => row.ok), JSON.stringify(plan.rows.filter((row) => !row.ok)));
		for (const def of plan.definitions) assert.equal(new Set(def.inputs).size, 8);
		const ids = new Set(plan.definitions.map((d) => d.id));
		assert.equal(w.contexts.filter((c) => ids.has(c.settings.readingKey)).length, 32);
		const base = buildWorkload("calc32-base", readings);
		assert.equal(base.globals.calculatedReadings, undefined);
		assert.equal(base.contexts.length, w.contexts.length);
	});

	it("trend workloads set the window on keys and two-row dials, and fill it before measuring", () => {
		for (const [name, window, fill] of [["trend-1m", "1m", 60], ["trend-5m", "5m", 300], ["trend-15m", "15m", 900]]) {
			const w = buildWorkload(name, readings);
			assert.equal(w.fillS, fill);
			for (const c of w.contexts) assert.equal(parseHistoryWindow(c.settings.historyWindow ?? c.settings.dialHistoryWindow), window);
		}
		for (const c of buildWorkload("trend-none", readings).contexts) {
			assert.equal(c.settings.historyWindow ?? c.settings.dialHistoryWindow, undefined);
		}
	});
});

describe("perf subjects", () => {
	it("a label is everything before the first =, and a Windows path keeps its drive", () => {
		assert.deepEqual(parseSubjectSpec("1.7.1=C:\\x\\pack"), { label: "1.7.1", target: "C:\\x\\pack" });
		assert.deepEqual(parseSubjectSpec("C:\\x\\dir"), { label: null, target: "C:\\x\\dir" });
	});

	it("a pack extracts to its exact members and refuses a member that leaves the directory", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perf-subject-"));
		try {
			const manifest = Buffer.from(JSON.stringify({ Version: "9.9.9.0" }));
			const bundle = Buffer.from("export {};\n");
			const pack = writeZip([
				{ name: "com.lawrensen.hwinfo.sdPlugin/manifest.json", data: manifest },
				{ name: "com.lawrensen.hwinfo.sdPlugin/bin/plugin.js", data: bundle }
			]);
			const packFile = path.join(dir, "test.streamDeckPlugin");
			fs.writeFileSync(packFile, pack);
			const subject = resolveSubject(`old=${packFile}`, { scratch: dir });
			assert.equal(subject.label, "old");
			assert.equal(subject.manifestVersion, "9.9.9.0");
			assert.equal(subject.packSha256, sha256(pack));
			assert.equal(subject.pluginJsSha256, sha256(bundle));
			assert.equal(subject.hwsmSha256, null, "a missing addon is no hash, not a made-up one");
			// A second resolve reuses identical bytes; a tampered file is rewritten.
			fs.writeFileSync(path.join(subject.dir, "bin", "plugin.js"), "tampered");
			assert.equal(resolveSubject(`old=${packFile}`, { scratch: dir }).pluginJsSha256, sha256(bundle));
			const evil = writeZip([{ name: "../escape.txt", data: Buffer.from("x") }]);
			assert.throws(() => extractPack(evil, path.join(dir, "evil")), /leaves the extraction directory/);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("harnesses take another build's plugin directory from HWINFO_E2E_PLUGIN_DIR", () => {
		assert.equal(resolvePluginDir("C:\\repo", {}), path.join("C:\\repo", "com.lawrensen.hwinfo.sdPlugin"));
		assert.equal(resolvePluginDir("C:\\repo", { HWINFO_E2E_PLUGIN_DIR: "C:\\old\\com.lawrensen.hwinfo.sdPlugin" }), path.resolve("C:\\old\\com.lawrensen.hwinfo.sdPlugin"));
	});
});
