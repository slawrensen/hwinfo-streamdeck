/**
 * Pure statistics for the plugin perf harness (scripts/perf-plugin.mjs):
 * window selection, percentiles, the plugin's own CPU and memory from the
 * in-process probe (scripts/lib/perf-probe-preload.mjs), the OS view from
 * the external sampler, the app-socket traffic the plugin sent, ABBA run
 * order, and the medians the report prints. No I/O.
 *
 * Missing evidence is null, never zero: a window with fewer than two probe
 * lines has no CPU figure, a window with no OS samples has no handle
 * count, and the report prints "n/a" for them.
 */

/** Nearest-rank percentile over an ascending array; null when empty. */
export function percentile(sorted, p) {
	if (sorted.length === 0) return null;
	const rank = Math.ceil((p / 100) * sorted.length);
	return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export function summarize(values) {
	const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
	if (xs.length === 0) return { n: 0, min: null, p50: null, p95: null, max: null, mean: null };
	const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
	return { n: xs.length, min: xs[0], p50: percentile(xs, 50), p95: percentile(xs, 95), max: xs.at(-1), mean };
}

export function median(values) {
	const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
	if (xs.length === 0) return null;
	const mid = Math.floor(xs.length / 2);
	return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** The lines whose `at` falls inside [from, to]. */
export function inWindow(samples, from, to) {
	return samples.filter((s) => Number.isFinite(s?.at) && s.at >= from && s.at <= to);
}

/**
 * Bytes allocated on the V8 heap across an interval, estimated from the
 * collections inside it: every rise of the used heap between collections
 * is allocation, every fall is a collection. `startUsed` is the used heap
 * at the interval start, `gcs` the collections in order ({before, after}),
 * `endUsed` the used heap at the end. Null when any figure is missing.
 */
export function allocatedBytes(startUsed, gcs, endUsed) {
	if (!Number.isFinite(startUsed) || !Number.isFinite(endUsed)) return null;
	let total = 0;
	let prev = startUsed;
	for (const gc of gcs) {
		if (!Number.isFinite(gc?.before) || !Number.isFinite(gc?.after)) return null;
		total += Math.max(0, gc.before - prev);
		prev = gc.after;
	}
	return total + Math.max(0, endUsed - prev);
}

/**
 * The plugin's own figures over [from, to] from the probe lines: CPU as a
 * percentage of one core ((user + system) delta over wall time), event loop
 * utilization, RSS / heap percentiles, GC count and pause, and the
 * allocation rate. Uses the first and last line inside the window; null
 * fields when fewer than two lines landed.
 */
export function probeWindowStats(lines, from, to) {
	const w = inWindow(lines, from, to);
	const rss = summarize(w.map((l) => l.mem?.rss / 1048576));
	const heap = summarize(w.map((l) => l.mem?.heapUsed / 1048576));
	const external = summarize(w.map((l) => (l.mem?.external ?? NaN) / 1048576));
	if (w.length < 2) {
		return { lines: w.length, seconds: null, cpuPctOneCore: null, elu: null, rssMB: rss, heapUsedMB: heap, externalMB: external, gcCount: null, gcPauseMsPerSec: null, allocMBPerSec: null };
	}
	const first = w[0];
	const last = w.at(-1);
	const seconds = (last.at - first.at) / 1000;
	const cpuUs = last.cpu.user + last.cpu.system - (first.cpu.user + first.cpu.system);
	const idle = last.elu.idle - first.elu.idle;
	const active = last.elu.active - first.elu.active;
	const gcs = w.slice(1).flatMap((l) => l.gc ?? []);
	// Allocation between consecutive lines, summed: each line's GC list
	// covers the time since the previous line.
	let alloc = 0;
	for (let i = 1; i < w.length; i++) {
		const part = allocatedBytes(w[i - 1].heapUsedNow, w[i].gc ?? [], w[i].heapUsedNow);
		if (part === null) {
			alloc = null;
			break;
		}
		alloc += part;
	}
	return {
		lines: w.length,
		seconds,
		cpuPctOneCore: seconds > 0 ? (cpuUs / 1e6 / seconds) * 100 : null,
		elu: idle + active > 0 ? active / (idle + active) : null,
		rssMB: rss,
		heapUsedMB: heap,
		externalMB: external,
		gcCount: gcs.length,
		gcPauseMsPerSec: seconds > 0 ? gcs.reduce((n, g) => n + (g.cost ?? 0), 0) / 1000 / seconds : null,
		allocMBPerSec: alloc === null || seconds <= 0 ? null : alloc / 1048576 / seconds
	};
}

/**
 * The OS view over [from, to] from the external sampler: private bytes,
 * working set and handle count percentiles, and CPU from the process's
 * TotalProcessorTime (a cross-check on the probe's figure).
 */
export function osWindowStats(samples, from, to) {
	const w = inWindow(samples, from, to);
	const out = {
		samples: w.length,
		privateMB: summarize(w.map((s) => s.privateBytes / 1048576)),
		workingSetMB: summarize(w.map((s) => s.workingSet / 1048576)),
		handles: summarize(w.map((s) => s.handles)),
		cpuPctOneCore: null
	};
	if (w.length >= 2) {
		const seconds = (w.at(-1).at - w[0].at) / 1000;
		const cpuMs = w.at(-1).cpuMs - w[0].cpuMs;
		if (seconds > 0 && Number.isFinite(cpuMs)) out.cpuPctOneCore = (cpuMs / 1000 / seconds) * 100;
	}
	return out;
}

/**
 * CPU from the process cycle counter over [from, to]: the mean as a
 * percentage of one core, and the busiest one-second step. `samples` are
 * { at, cycles } (cumulative), `hz` the counter's calibrated rate. Null
 * when fewer than two samples fall inside or the rate is unknown.
 */
export function cycleWindowStats(samples, from, to, hz) {
	const w = inWindow(samples, from, to).filter((s) => Number.isFinite(s.cycles));
	if (w.length < 2 || !(hz > 0)) return { samples: w.length, cpuPctOneCore: null, maxSecondPct: null };
	const pct = (a, b) => ((b.cycles - a.cycles) / hz / ((b.at - a.at) / 1000)) * 100;
	let maxSecondPct = null;
	for (let i = 1; i < w.length; i++) {
		if (w[i].at > w[i - 1].at) maxSecondPct = Math.max(maxSecondPct ?? 0, pct(w[i - 1], w[i]));
	}
	return { samples: w.length, cpuPctOneCore: w.at(-1).at > w[0].at ? pct(w[0], w.at(-1)) : null, maxSecondPct };
}

/** One line of the external sampler: "<unixMs> <private> <handles> <workingSet> <cpuMs>". */
export function parseOsLine(line) {
	const parts = line.trim().split(/\s+/).map(Number);
	if (parts.length !== 5 || parts.some((n) => !Number.isFinite(n))) return null;
	const [at, privateBytes, handles, workingSet, cpuMs] = parts;
	return { at, privateBytes, handles, workingSet, cpuMs };
}

/**
 * The traffic the plugin sent the app over [from, to]: per event kind the
 * call count and rate, the message bytes per call (p50/p95/max) and per
 * second; per context the call rate (median and maximum over contexts)
 * and the peak calls inside any one second. `messages` are
 * { at, event, context, bytes }.
 */
export function trafficStats(messages, from, to, kinds = ["setImage", "setFeedback"]) {
	const seconds = (to - from) / 1000;
	const w = messages.filter((m) => m.at >= from && m.at <= to);
	const out = { seconds };
	for (const kind of kinds) {
		const list = w.filter((m) => m.event === kind);
		const byContext = new Map();
		for (const m of list) {
			const ats = byContext.get(m.context) ?? [];
			ats.push(m.at);
			byContext.set(m.context, ats);
		}
		const rates = [...byContext.values()].map((ats) => ats.length / seconds);
		let peak = 0;
		for (const ats of byContext.values()) peak = Math.max(peak, peakInWindow(ats, 1000));
		const totalBytes = list.reduce((n, m) => n + m.bytes, 0);
		out[kind] = {
			calls: list.length,
			contexts: byContext.size,
			callsPerSec: seconds > 0 ? list.length / seconds : null,
			perContextPerSec: { median: median(rates), max: rates.length === 0 ? null : Math.max(...rates) },
			peakIn1sPerContext: peak,
			bytesPerCall: summarize(list.map((m) => m.bytes)),
			bytesPerSec: seconds > 0 ? totalBytes / seconds : null
		};
	}
	return out;
}

/** The most timestamps (ascending) inside any window of `spanMs`. */
export function peakInWindow(ats, spanMs) {
	let peak = 0;
	let j = 0;
	for (let i = 0; i < ats.length; i++) {
		while (ats[i] - ats[j] >= spanMs) j++;
		peak = Math.max(peak, i - j + 1);
	}
	return peak;
}

/**
 * Run order for a matched comparison: ABBA blocks, so drift across a
 * session (thermal state, background load) lands on both subjects alike.
 * `repeats` is runs per subject; two subjects and 2 repeats give A B B A.
 */
export function abbaOrder(subjects, repeats) {
	if (!Number.isSafeInteger(repeats) || repeats < 1) throw new RangeError("repeats must be a positive integer");
	if (subjects.length === 0) throw new RangeError("at least one subject");
	const order = [];
	for (let r = 0; r < repeats; r++) {
		order.push(...(r % 2 === 0 ? subjects : [...subjects].reverse()));
	}
	return order;
}

/** Reads a dotted path ("probe.cpuPctOneCore") off a run. */
export function pick(run, dotted) {
	return dotted.split(".").reduce((v, k) => (v === null || v === undefined ? undefined : v[k]), run);
}

/** The headline metrics, in report order: [label, path, digits]. */
export const HEADLINE = [
	["CPU % one core (cycles)", "cycles.cpuPctOneCore", 3],
	["CPU busiest second % (cycles)", "cycles.maxSecondPct", 2],
	["CPU % one core (process times)", "probe.cpuPctOneCore", 2],
	["Event loop busy", "probe.elu", 3],
	["RSS MB p50", "probe.rssMB.p50", 1],
	["Private MB p50", "os.privateMB.p50", 1],
	["Handles p50", "os.handles.p50", 0],
	["Heap used MB p50", "probe.heapUsedMB.p50", 1],
	["Heap alloc MB/s", "probe.allocMBPerSec", 2],
	["GC pause ms/s", "probe.gcPauseMsPerSec", 2],
	["setImage calls/s", "traffic.setImage.callsPerSec", 1],
	["setImage per ctx/s (max)", "traffic.setImage.perContextPerSec.max", 2],
	["setImage bytes/call p50", "traffic.setImage.bytesPerCall.p50", 0],
	["setImage bytes/call p95", "traffic.setImage.bytesPerCall.p95", 0],
	["setImage bytes/s", "traffic.setImage.bytesPerSec", 0],
	["setFeedback calls/s", "traffic.setFeedback.callsPerSec", 1],
	["setFeedback per ctx/s (max)", "traffic.setFeedback.perContextPerSec.max", 2],
	["setFeedback peak in 1 s per ctx", "traffic.setFeedback.peakIn1sPerContext", 0],
	["setFeedback bytes/call p50", "traffic.setFeedback.bytesPerCall.p50", 0],
	["setFeedback bytes/call p95", "traffic.setFeedback.bytesPerCall.p95", 0],
	["setFeedback bytes/s", "traffic.setFeedback.bytesPerSec", 0]
];

/** Per subject, the median of each headline metric over its runs. */
export function medianBySubject(runs) {
	const subjects = [...new Set(runs.map((r) => r.subject))];
	return Object.fromEntries(subjects.map((s) => {
		const mine = runs.filter((r) => r.subject === s);
		return [s, Object.fromEntries(HEADLINE.map(([, path]) => [path, median(mine.map((r) => pick(r, path)))]))];
	}));
}

export function fmt(value, digits) {
	if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
	return digits === 0 ? Math.round(value).toLocaleString("en-US") : value.toFixed(digits);
}

/**
 * A markdown table: one row per headline metric, one column per subject
 * (the median of its runs, with every run's value after it), and the
 * candidate-to-baseline ratio when exactly two subjects ran. Rows where
 * no subject has a value are left out (a workload with no dials sends no
 * setFeedback).
 */
export function renderTable(runs, subjects) {
	const medians = medianBySubject(runs);
	const head = ["Metric", ...subjects.map((s) => `${s} median (runs)`), ...(subjects.length === 2 ? [`${subjects[1]} / ${subjects[0]}`] : [])];
	const lines = [`| ${head.join(" | ")} |`, `| ${head.map((_, i) => (i === 0 ? "---" : "---:")).join(" | ")} |`];
	for (const [label, path, digits] of HEADLINE) {
		const values = subjects.map((s) => medians[s]?.[path]);
		if (values.every((v) => v === null || v === undefined)) continue;
		const cells = subjects.map((s, i) => {
			const each = runs.filter((r) => r.subject === s).map((r) => fmt(pick(r, path), digits));
			return `${fmt(values[i], digits)} (${each.join(", ")})`;
		});
		if (subjects.length === 2) {
			const [a, b] = values;
			cells.push(Number.isFinite(a) && Number.isFinite(b) && a !== 0 ? `${(b / a).toFixed(2)}x` : "n/a");
		}
		lines.push(`| ${label} | ${cells.join(" | ")} |`);
	}
	return lines.join("\n");
}

/** The cross-workload summary columns: [label, path, digits]. */
export const SUMMARY = [
	["CPU %", "cycles.cpuPctOneCore", 3],
	["Private MB", "os.privateMB.p50", 1],
	["Handles", "os.handles.p50", 0],
	["Alloc MB/s", "probe.allocMBPerSec", 2],
	["Image B/s", "traffic.setImage.bytesPerSec", 0],
	["Feedback/s", "traffic.setFeedback.callsPerSec", 1],
	["Feedback B/s", "traffic.setFeedback.bytesPerSec", 0]
];

/**
 * One row per workload, each summary metric as "baseline / candidate"
 * medians (two subjects), so a PERF.md reader sees the whole matrix at a
 * glance; the per-workload tables carry every run.
 */
export function renderSummary(workloads, subjects) {
	if (subjects.length !== 2) throw new RangeError("the summary compares exactly two subjects");
	const head = ["Workload", "Runs", ...SUMMARY.map(([label]) => `${label} (${subjects[0]} / ${subjects[1]})`)];
	const lines = [`| ${head.join(" | ")} |`, `| ${head.map((_, i) => (i < 1 ? "---" : "---:")).join(" | ")} |`];
	for (const w of workloads) {
		const medians = Object.fromEntries(subjects.map((s) => {
			const mine = w.runs.filter((r) => r.subject === s);
			return [s, Object.fromEntries(SUMMARY.map(([, path]) => [path, median(mine.map((r) => pick(r, path)))]))];
		}));
		const counts = subjects.map((s) => w.runs.filter((r) => r.subject === s).length).join("+");
		const cells = SUMMARY.map(([, path, digits]) => `${fmt(medians[subjects[0]][path], digits)} / ${fmt(medians[subjects[1]][path], digits)}`);
		lines.push(`| ${w.name} | ${counts} | ${cells.join(" | ")} |`);
	}
	return lines.join("\n");
}
