// External hardware-soak monitor for the live plugin. Observation only, by
// contract: one WMI process snapshot per interval plus a tail of the newest
// plugin log. It never instruments the plugin or touches the deck, the app,
// the shared memory, or the mutex, so the soaked build and its numbers are
// exactly the shipping configuration (see native/hwsm/TESTING.md).
//
//   node scripts/soak-monitor.mjs [--interval 60] [--duration <sec>]
//       [--out release/soak-<stamp>.csv] [--pattern <cmdline regex>]
//       [--logs <dir>] [--summary <existing.csv>] [--events <adversary.jsonl>]
//
// --events takes the JSONL file written by scripts/soak-adversary.mjs and
// only annotates the summary (injected faults merged into the event list,
// plus a pass count), so provoked WARN/restart entries are attributable at
// a glance. It changes nothing about sampling; observation stays the whole
// contract.
//
// Each sample is one CSV row: plugin PID, RSS, private bytes, handles,
// threads, cumulative CPU seconds, Stream Deck app PID, HWiNFO process
// count, and new WARN/ERROR log lines (harness device lines excluded, log
// history before the run never counted). Ctrl+C or --duration ends the run
// and prints a PERF.md-ready summary: least-squares RSS/private slopes over
// the longest same-PID stretch (a restart resets the process; mixing PIDs
// would fake a negative slope), handle drift, CPU percent, and timestamped
// events (restarts, absences, sampling gaps: what sleep looks like from
// user space). --summary recomputes it from a finished CSV.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs, promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { creationMs, selectSoakHost } from "./lib/soak-host.mjs";
import { makeLogTail } from "./lib/soak-log-tail.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { values: args } = parseArgs({
	options: {
		interval: { type: "string", default: "60" },
		duration: { type: "string" },
		out: { type: "string" },
		pattern: { type: "string" },
		logs: { type: "string" },
		summary: { type: "string" },
		events: { type: "string" },
		help: { type: "boolean", default: false }
	}
});

if (args.help) {
	console.log("usage: node scripts/soak-monitor.mjs [--interval sec] [--duration sec] [--out file.csv] [--pattern regex] [--logs dir] [--summary file.csv] [--events file.jsonl]");
	process.exit(0);
}

const MB = 1024 * 1024;
const LEGACY_CSV_HEADER = "tsIso,tsMs,pid,matches,rssB,privateB,handles,threads,cpuS,sdAppPid,hwinfoCount,logWarnDelta,logErrorDelta,note";
const HOST_CSV_HEADER = `${LEGACY_CSV_HEADER},sdRssB,sdPrivateB,sdHandles,sdThreads,sdCpuS`;
const CSV_HEADER = `${HOST_CSV_HEADER},pluginStartedMs,sdStartedMs,sdMatches`;

const pad2 = (n) => String(n).padStart(2, "0");
const localStamp = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

// ---------------------------------------------------------------------------
// One WMI snapshot: every node.exe, StreamDeck.exe and HWiNFO* process.
// ---------------------------------------------------------------------------

const TARGET_RE = args.pattern ? new RegExp(args.pattern, "i") : /com\.lawrensen\.hwinfo\.sdPlugin[\\/]bin[\\/]plugin\.js/i;

async function processSnapshot() {
	const ps =
		"$procs = @(Get-CimInstance Win32_Process -ErrorAction Stop -Filter \"Name='node.exe' OR Name='StreamDeck.exe' OR Name LIKE 'HWiNFO%'\" | " +
		"Select-Object ProcessId,ParentProcessId,SessionId,CreationDate,Name,CommandLine,WorkingSetSize,PrivatePageCount,HandleCount,ThreadCount,UserModeTime,KernelModeTime); " +
		"ConvertTo-Json -InputObject $procs -Depth 2 -Compress";
	const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", ps], { timeout: 30_000, maxBuffer: 8 * MB });
	return JSON.parse(stdout);
}

/** Sticky selection: keep the known PID while it lives; otherwise pick the
 * longest-running match (helpers and fresh twins lose to the incumbent). */
function pickSticky(rows, previousPid) {
	if (rows.length === 0) {
		return null;
	}
	const prev = rows.find((r) => r.ProcessId === previousPid);
	if (prev) {
		return prev;
	}
	return rows.reduce((a, b) => ((a.UserModeTime ?? 0) + (a.KernelModeTime ?? 0) >= (b.UserModeTime ?? 0) + (b.KernelModeTime ?? 0) ? a : b));
}

// ---------------------------------------------------------------------------
// Log tail: scripts/lib/soak-log-tail.mjs (newest plugin log, WARN/ERROR
// deltas, harness lines excluded, nothing lost across a rotation).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Summary: shared by the live run and --summary, so one validated code path.
// ---------------------------------------------------------------------------

function parseCsv(file) {
	const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.length > 0);
	if (lines[0] !== CSV_HEADER && lines[0] !== HOST_CSV_HEADER && lines[0] !== LEGACY_CSV_HEADER) {
		throw new Error(`${file} does not start with the soak-monitor CSV header`);
	}
	return lines.slice(1).map((l) => {
		const c = l.split(",");
		const note = c[13] ?? "";
		// Historical collectors wrote zero counts on a failed observation.
		// Preserve that note as evidence; those zeros never prove absence.
		const unknown = note.startsWith("snapshot-failed:");
		return {
			tsIso: c[0],
			tsMs: Number(c[1]),
			pid: c[2] === "" ? null : Number(c[2]),
			rssB: c[4] === "" ? null : Number(c[4]),
			privateB: c[5] === "" ? null : Number(c[5]),
			handles: c[6] === "" ? null : Number(c[6]),
			cpuS: c[8] === "" ? null : Number(c[8]),
			sdAppPid: c[9] === "" ? null : Number(c[9]),
			hwinfoCount: unknown || c[10] === "" ? null : Number(c[10]),
			warn: Number(c[11]),
			error: Number(c[12]),
			note,
			unknown,
			sdRssB: c[14] ? Number(c[14]) : null,
			sdPrivateB: c[15] ? Number(c[15]) : null,
			sdHandles: c[16] ? Number(c[16]) : null,
			sdCpuS: c[18] ? Number(c[18]) : null,
			startedMs: c[19] ? Number(c[19]) : null,
			sdStartedMs: c[20] ? Number(c[20]) : null
		};
	});
}

/** Adversary events (soak-adversary.mjs JSONL): annotation only. */
function loadAdversaryEvents(file) {
	const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.length > 0);
	const events = [];
	let pass = 0;
	let total = 0;
	for (const line of lines) {
		let e;
		try {
			e = JSON.parse(line);
		} catch {
			continue;
		}
		if (e.name === "program-start" || e.name === "program-end") {
			continue;
		}
		total++;
		if (e.verdict === "PASS") {
			pass++;
		}
		events.push(`${e.tsIso} adversary ${e.name}: ${e.verdict} (${e.detail})`);
	}
	return { events, pass, total };
}

/** Least-squares slope of (tsMs, bytes) rows, reported as MB per 30 min. */
function slopeMbPer30Min(rows, field) {
	const pts = rows.filter((r) => r[field] !== null);
	if (pts.length < 2) {
		return null;
	}
	const t0 = pts[0].tsMs;
	let sx = 0, sy = 0, sxx = 0, sxy = 0;
	for (const r of pts) {
		const x = (r.tsMs - t0) / 60000;
		const y = r[field] / MB;
		sx += x; sy += y; sxx += x * x; sxy += x * y;
	}
	const n = pts.length;
	const denominator = n * sxx - sx * sx;
	if (denominator === 0) {
		return null;
	}
	return ((n * sxy - sx * sy) / denominator) * 30;
}

function computeSummary(rows, includeHost = true) {
	if (rows.length === 0) {
		return null;
	}
	const spanMs = rows[rows.length - 1].tsMs - rows[0].tsMs;
	const dts = [];
	for (let i = 1; i < rows.length; i++) {
		dts.push(rows[i].tsMs - rows[i - 1].tsMs);
	}
	const sorted = [...dts].sort((a, b) => a - b);
	const medianDt = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
	const events = [];
	const gapBefore = new Set();
	for (let i = 1; i < rows.length; i++) {
		if (medianDt > 0 && rows[i].tsMs - rows[i - 1].tsMs > 3 * medianDt) {
			gapBefore.add(rows[i]);
			if (includeHost) events.push(`${rows[i].tsIso} sampling gap of ${Math.round((rows[i].tsMs - rows[i - 1].tsMs) / 1000)} s (sleep or stall)`);
		}
	}

	// Contiguous same-PID present segments; restarts and absences are events.
	const scope = includeHost ? "plugin" : "Stream Deck host";
	// A missing host selection may be ambiguity, not a stopped host process.
	const unavailable = includeHost ? "plugin process absent" : "Stream Deck host observation unavailable";
	const segments = [];
	let seg = null;
	let lastPresent = null;
	let absentRun = null;
	let restarts = 0;
	for (const r of rows) {
		if (gapBefore.has(r)) seg = null;
		if (r.unknown) {
			if (absentRun !== null) {
				events.push(`${absentRun} ${unavailable} before observation became unknown at ${r.tsIso}`);
				absentRun = null;
			}
			if (includeHost) events.push(`${r.tsIso} observation unknown (${r.note})`);
			seg = null;
			continue;
		}
		if (includeHost && r.note) events.push(`${r.tsIso} ${r.note}`);
		if (r.pid === null) {
			if (absentRun === null) {
				absentRun = r.tsIso;
			}
			seg = null;
			continue;
		}
		if (absentRun !== null) {
			events.push(`${absentRun} ${unavailable} until ${r.tsIso}`);
			absentRun = null;
		}
		if (lastPresent !== null && r.pid !== lastPresent.pid) {
			events.push(`${r.tsIso} ${scope} PID changed ${lastPresent.pid} -> ${r.pid} (restart)`);
			restarts++;
		}
		const previous = lastPresent;
		if (previous && previous.pid === r.pid) {
			const newLifetime = r.startedMs !== null && previous.startedMs !== null && r.startedMs !== previous.startedMs;
			const counterReset = r.cpuS !== null && previous.cpuS !== null && r.cpuS < previous.cpuS;
			if (newLifetime || counterReset) {
				events.push(`${r.tsIso} ${scope} PID ${r.pid}: ${newLifetime ? "creation time changed (restart)" : "CPU counter reset; new resource segment"}`);
				if (newLifetime) restarts++;
				seg = null;
			}
		}
		if (seg === null || seg.pid !== r.pid) {
			seg = { pid: r.pid, rows: [] };
			segments.push(seg);
		}
		seg.rows.push(r);
		lastPresent = r;
	}
	if (absentRun !== null) {
		events.push(`${absentRun} ${unavailable} through the end of the window`);
	}

	const longest = segments.reduce((a, b) => (b.rows.length > (a?.rows.length ?? 0) ? b : a), null);
	const present = rows.filter((r) => !r.unknown && r.pid !== null);
	const rss = present.filter((r) => r.rssB !== null).map((r) => r.rssB);
	const handles = present.filter((r) => r.handles !== null).map((r) => r.handles);
	let cpuPct = null;
	if (longest !== null && longest.rows.length >= 2) {
		const first = longest.rows[0];
		const last = longest.rows[longest.rows.length - 1];
		const wall = (last.tsMs - first.tsMs) / 1000;
		if (wall > 0 && first.cpuS !== null && last.cpuS !== null) {
			cpuPct = ((last.cpuS - first.cpuS) / wall) * 100;
		}
	}
	return {
		samples: rows.length,
		firstIso: rows[0].tsIso,
		lastIso: rows[rows.length - 1].tsIso,
		spanHours: spanMs / 3_600_000,
		restarts,
		unknownSamples: rows.filter((r) => r.unknown).length,
		hwinfoAbsentSamples: rows.filter((r) => r.hwinfoCount === 0).length,
		warnTotal: rows.reduce((a, r) => a + r.warn, 0),
		errorTotal: rows.reduce((a, r) => a + r.error, 0),
		rssFirstMb: rss.length > 0 ? rss[0] / MB : null,
		rssLastMb: rss.length > 0 ? rss[rss.length - 1] / MB : null,
		rssMinMb: rss.length > 0 ? Math.min(...rss) / MB : null,
		rssMaxMb: rss.length > 0 ? Math.max(...rss) / MB : null,
		handlesFirst: handles[0] ?? null,
		handlesLast: handles[handles.length - 1] ?? null,
		handlesMax: handles.length > 0 ? Math.max(...handles) : null,
		longestSegSamples: longest?.rows.length ?? 0,
		longestSegPid: longest?.pid ?? null,
		rssSlope: longest !== null ? slopeMbPer30Min(longest.rows, "rssB") : null,
		privateSlope: longest !== null ? slopeMbPer30Min(longest.rows, "privateB") : null,
		cpuPct,
		// Summarize host resources by the host's own PID segments. A plugin
		// restart must not reset host CPU, and a host restart must not turn
		// cumulative CPU counters into a negative utilization estimate.
		host: includeHost ? computeSummary(rows.map((r) => ({
			...r, pid: r.sdAppPid, rssB: r.sdRssB, privateB: r.sdPrivateB,
			handles: r.sdHandles, cpuS: r.sdCpuS, startedMs: r.sdStartedMs
		})), false) : null,
		events
	};
}

function printSummary(s, csvFile, adversary = null) {
	const mb = (v) => (v === null ? "n/a" : v.toFixed(1));
	const slope = (v) => (v === null ? "n/a: fewer than 2 samples in the longest run" : `${v >= 0 ? "+" : ""}${v.toFixed(2)} MB/30 min`);
	console.log(`\n### ${localStamp()}: soak summary (${path.basename(csvFile)})\n`);
	console.log("| Soak | Value |");
	console.log("| --- | ---: |");
	console.log(`| Window | ${s.firstIso} to ${s.lastIso} (${s.spanHours.toFixed(1)} h, ${s.samples} samples) |`);
	console.log(`| RSS | ${mb(s.rssFirstMb)} to ${mb(s.rssLastMb)} MB (min ${mb(s.rssMinMb)}, max ${mb(s.rssMaxMb)}) |`);
	console.log(`| RSS slope, longest same-PID run (${s.longestSegSamples} samples, PID ${s.longestSegPid ?? "n/a"}) | ${slope(s.rssSlope)} |`);
	console.log(`| Private bytes slope, same run | ${slope(s.privateSlope)} |`);
	console.log(`| Handles | ${s.handlesFirst ?? "n/a"} to ${s.handlesLast ?? "n/a"} (max ${s.handlesMax ?? "n/a"}) |`);
	console.log(`| Avg CPU, same run | ${s.cpuPct === null ? "n/a" : s.cpuPct.toFixed(2) + "%"} |`);
	if (s.host !== null) {
		console.log(`| Stream Deck host RSS | ${mb(s.host.rssFirstMb)} to ${mb(s.host.rssLastMb)} MB (min ${mb(s.host.rssMinMb)}, max ${mb(s.host.rssMaxMb)}) |`);
		console.log(`| Host RSS slope, host PID ${s.host.longestSegPid ?? "n/a"} (${s.host.longestSegSamples} samples) | ${slope(s.host.rssSlope)} |`);
		console.log(`| Host handles | ${s.host.handlesFirst ?? "n/a"} to ${s.host.handlesLast ?? "n/a"} (max ${s.host.handlesMax ?? "n/a"}) |`);
		console.log(`| Host avg CPU, same host PID | ${s.host.cpuPct === null ? "n/a" : s.host.cpuPct.toFixed(2) + "%"} |`);
		console.log(`| Host restarts | ${s.host.restarts} |`);
	}
	console.log(`| Plugin restarts / HWiNFO-absent samples | ${s.restarts} / ${s.hwinfoAbsentSamples} |`);
	console.log(`| Unknown process snapshots | ${s.unknownSamples} |`);
	console.log(`| New log WARN / ERROR lines | ${s.warnTotal} / ${s.errorTotal} |`);
	if (adversary !== null) {
		console.log(`| Adversary events (injected faults survived) | ${adversary.pass}/${adversary.total} |`);
	}
	const events = [...s.events, ...(s.host?.events ?? []), ...(adversary?.events ?? [])].sort();
	if (events.length > 0) {
		console.log("\nEvents:");
		for (const e of events.slice(0, 40)) {
			console.log(`- ${e}`);
		}
		if (events.length > 40) {
			console.log(`- (${events.length - 40} more in the CSV and events files)`);
		}
	}
}

// ---------------------------------------------------------------------------
// Modes.
// ---------------------------------------------------------------------------

const adversaryEvents = () => {
	if (args.events === undefined) {
		return null;
	}
	const file = path.resolve(args.events);
	return fs.existsSync(file) ? loadAdversaryEvents(file) : { events: [`(events file missing: ${file})`], pass: 0, total: 0 };
};

if (args.summary) {
	const rows = parseCsv(path.resolve(args.summary));
	const s = computeSummary(rows);
	if (s === null) {
		console.error("soak-monitor: the CSV has no samples");
		process.exit(1);
	}
	printSummary(s, args.summary, adversaryEvents());
	process.exit(0);
}

if (process.platform !== "win32") {
	console.error("soak-monitor: win32 only (it observes Windows processes)");
	process.exit(1);
}

const intervalSec = Number(args.interval);
if (!Number.isFinite(intervalSec) || intervalSec < 1) {
	console.error("soak-monitor: --interval must be a number of seconds >= 1");
	process.exit(1);
}
const durationSec = args.duration === undefined ? null : Number(args.duration);
if (durationSec !== null && (!Number.isFinite(durationSec) || durationSec <= 0)) {
	console.error("soak-monitor: --duration must be a positive number of seconds");
	process.exit(1);
}
const stamp = new Date();
const defaultOut = path.join(repoRoot, "release", `soak-${stamp.getFullYear()}${pad2(stamp.getMonth() + 1)}${pad2(stamp.getDate())}-${pad2(stamp.getHours())}${pad2(stamp.getMinutes())}.csv`);
const outPath = path.resolve(args.out ?? defaultOut);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
if (!fs.existsSync(outPath)) {
	fs.writeFileSync(outPath, CSV_HEADER + os.EOL);
} else if (fs.readFileSync(outPath, "utf8").split(/\r?\n/, 1)[0] !== CSV_HEADER) {
	console.error("soak-monitor: existing output has a different schema; choose a new --out file");
	process.exit(1);
}

const logDir = args.logs ?? path.join(process.env.APPDATA ?? "", "Elgato", "StreamDeck", "Plugins", "com.lawrensen.hwinfo.sdPlugin", "logs");
const pollLogs = makeLogTail(logDir);

let knownPid = null;
let knownHost = null;
let stopping = false;

async function sampleOnce() {
	const startedAt = Date.now();
	let row;
	try {
		const procs = await processSnapshot();
		const targets = procs.filter((r) => r.Name === "node.exe" && r.ProcessId !== process.pid && TARGET_RE.test(r.CommandLine ?? ""));
		const target = pickSticky(targets, knownPid);
		const sdApps = procs.filter((r) => r.Name === "StreamDeck.exe");
		const hostSelection = selectSoakHost(target, sdApps, knownHost);
		const sdApp = hostSelection.host;
		knownHost = hostSelection.identity;
		const hwinfoCount = procs.filter((r) => /^HWiNFO/i.test(r.Name ?? "")).length;
		const logs = pollLogs();
		const notes = [logs.note];
		if (targets.length > 1) {
			notes.push(`${targets.length}-matches`);
		}
		if (hostSelection.reason) notes.push(hostSelection.reason);
		if (target !== null) {
			knownPid = target.ProcessId;
		}
		const cpuS = target === null ? "" : (((target.UserModeTime ?? 0) + (target.KernelModeTime ?? 0)) / 1e7).toFixed(3);
		row = [
			new Date(startedAt).toISOString(),
			startedAt,
			target?.ProcessId ?? "",
			targets.length,
			target?.WorkingSetSize ?? "",
			target?.PrivatePageCount ?? "",
			target?.HandleCount ?? "",
			target?.ThreadCount ?? "",
			cpuS,
			sdApp?.ProcessId ?? "",
			hwinfoCount,
			logs.warn,
			logs.error,
			notes.filter((n) => n.length > 0).join(";"),
			sdApp?.WorkingSetSize ?? "",
			sdApp?.PrivatePageCount ?? "",
			sdApp?.HandleCount ?? "",
			sdApp?.ThreadCount ?? "",
			sdApp === null ? "" : (((sdApp.UserModeTime ?? 0) + (sdApp.KernelModeTime ?? 0)) / 1e7).toFixed(3),
			creationMs(target?.CreationDate) ?? "",
			creationMs(sdApp?.CreationDate) ?? "",
			hostSelection.matches
		];
	} catch (err) {
		row = [new Date(startedAt).toISOString(), startedAt, "", "", "", "", "", "", "", "", "", "", "", `snapshot-failed: ${String(err?.message ?? err).replaceAll(",", ";").replaceAll("\n", " ").replaceAll("\r", " ").slice(0, 120)}`, "", "", "", "", "", "", "", ""];
	}
	fs.appendFileSync(outPath, row.join(",") + os.EOL);
	return Date.now() - startedAt;
}

function finish() {
	if (stopping) {
		return;
	}
	stopping = true;
	try {
		const s = computeSummary(parseCsv(outPath));
		if (s !== null) {
			printSummary(s, outPath, adversaryEvents());
		}
		console.log(`\nCSV: ${outPath}`);
	} catch (err) {
		console.error(`soak-monitor: summary failed: ${err?.message ?? err}`);
		process.exitCode = 1;
	}
	process.exit();
}

process.on("SIGINT", finish);

console.log(`soak-monitor: sampling every ${intervalSec} s${durationSec !== null ? ` for ${durationSec} s` : " until Ctrl+C"}`);
console.log(`soak-monitor: target ${TARGET_RE}, logs ${fs.existsSync(logDir) ? logDir : `${logDir} (missing)`}`);
console.log(`soak-monitor: CSV ${outPath}`);

const endAt = durationSec !== null ? Date.now() + durationSec * 1000 : null;
const costs = [];
for (;;) {
	const cost = await sampleOnce();
	costs.push(cost);
	if (costs.length === 3) {
		const worst = Math.max(...costs);
		if (worst > intervalSec * 1000 * 0.5) {
			console.log(`soak-monitor: note, a sample costs up to ${worst} ms; consider a longer --interval`);
		}
	}
	if (endAt !== null && Date.now() >= endAt) {
		finish();
	}
	// Drift-corrected cadence: sleep to the next interval boundary.
	const sleepMs = Math.max(250, intervalSec * 1000 - (Date.now() % (intervalSec * 1000)));
	await new Promise((r) => setTimeout(r, sleepMs));
}
