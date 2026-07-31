// Adversarial driver for a hardware soak of the LIVE retail plugin. It is
// the deliberately destructive half of the soak harness: soak-monitor.mjs
// stays observation-only by contract, this script is the only thing that
// touches the system, and every touch is a fault the shipping build claims
// to survive. Run both together; give the monitor this script's events file
// (--events) so its summary annotates what was provoked versus spontaneous.
//
//   node scripts/soak-adversary.mjs [--lead 120] [--out release/soak-adversary-<stamp>.jsonl]
//       [--logs <dir>] [--only mutex-hold-6s,plugin-kill] [--list]
//
// The program, timed from start (--lead seconds of quiet baseline first):
//
//   mutex-hold-6s    hold HWiNFO's consistency mutex 6 s. Under the 15 s
//                    staleness grace the plugin must ride through silently:
//                    no WARN, no ERROR, no restart (reads skip, values hold).
//   mutex-hold-25s   hold it 25 s, crossing the grace window. The plugin
//                    must degrade honestly (WARN "HWiNFO unavailable [busy]",
//                    the busy screen) and reopen on its own after release,
//                    without a restart. This is the 1.4.1 busy path on the
//                    real provider.
//   plugin-kill      kill the plugin process. The Stream Deck app must
//                    restart it and the fresh instance must reopen the
//                    shared-memory source.
//   app-restart      stop and relaunch the Stream Deck app itself; the full
//                    stack must come back on its own.
//   mutex-hold-8s    a post-recovery repeat of the silent ride-through, so
//                    recovery is proven stable, not just momentary.
//
// Not included, on purpose: killing the real HWiNFO. It runs elevated with
// a kernel driver, so an unelevated relaunch would strand the user's live
// monitoring behind a UAC prompt; the provider-gone paths are already
// e2e-covered against the fake provider (e2e:resilience, e2e:dead-fallback).
//
// Each event is verified from outside the process: INFO/WARN markers in the
// plugin log (stock log level, no debug env, so the soaked build stays the
// shipping configuration) plus process-identity snapshots. Verdicts stream
// to a JSONL events file and the exit code is non-zero if any event fails.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs, promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { values: args } = parseArgs({
	options: {
		lead: { type: "string", default: "120" },
		out: { type: "string" },
		logs: { type: "string" },
		only: { type: "string" },
		list: { type: "boolean", default: false },
		help: { type: "boolean", default: false }
	}
});

if (args.help) {
	console.log("usage: node scripts/soak-adversary.mjs [--lead sec] [--out file.jsonl] [--logs dir] [--only names] [--list]");
	process.exit(0);
}

const MUTEX_NAME = "Global\\HWiNFO_SM2_MUTEX";
const SD_EXE = "C:\\Program Files\\Elgato\\StreamDeck\\StreamDeck.exe";
const PLUGIN_RE = /com\.lawrensen\.hwinfo\.sdPlugin[\\/]bin[\\/]plugin\.js/i;

const UNAVAILABLE_BUSY_RE = /WARN\s+HwinfoPoller: HWiNFO unavailable \[busy\]/;
const REOPENED_RE = /INFO\s+HwinfoPoller: (Opened HWiNFO data source|Data source layout changed)/;
const STARTED_RE = /INFO\s+HwinfoPoller: Started \(/;
const ERROR_RE = /\bERROR\b/;
const WARN_RE = /\bWARN\b/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Process snapshots: the plugin's node process, the app, HWiNFO presence.
// ---------------------------------------------------------------------------

async function runPs(command, timeoutMs = 30_000) {
	const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
	return stdout.trim();
}

async function snapshot() {
	const ps =
		"$procs = @(Get-CimInstance Win32_Process -Filter \"Name='node.exe' OR Name='StreamDeck.exe' OR Name LIKE 'HWiNFO%'\" | " +
		"Select-Object ProcessId,Name,CommandLine); ConvertTo-Json -InputObject $procs -Depth 2 -Compress";
	const rows = JSON.parse((await runPs(ps)) || "[]");
	return {
		pluginPid: rows.find((r) => r.Name === "node.exe" && PLUGIN_RE.test(r.CommandLine ?? ""))?.ProcessId ?? null,
		sdPid: rows.find((r) => r.Name === "StreamDeck.exe")?.ProcessId ?? null,
		hwinfoCount: rows.filter((r) => /^HWiNFO/i.test(r.Name ?? "")).length
	};
}

// ---------------------------------------------------------------------------
// Plugin log tail (same NTFS-identity rotation handling as soak-monitor).
// ---------------------------------------------------------------------------

function makeLogTail(dir) {
	let file = null;
	let fileIno = null;
	let offset = 0;
	const newest = () => {
		if (!fs.existsSync(dir)) {
			return null;
		}
		const logs = fs
			.readdirSync(dir)
			.filter((f) => f.endsWith(".log"))
			.map((f) => ({ p: path.join(dir, f), m: fs.statSync(path.join(dir, f)).mtimeMs }))
			.sort((a, b) => b.m - a.m);
		return logs[0]?.p ?? null;
	};
	return function poll() {
		const current = newest();
		if (current === null) {
			return [];
		}
		const st = fs.statSync(current, { bigint: true });
		const size = Number(st.size);
		if (current !== file || st.ino !== fileIno || size < offset) {
			file = current;
			fileIno = st.ino;
			offset = 0; // rotation: a fresh plugin instance, read it from the top
		}
		if (size === offset) {
			return [];
		}
		const fd = fs.openSync(current, "r");
		const buf = Buffer.alloc(size - offset);
		fs.readSync(fd, buf, 0, buf.length, offset);
		fs.closeSync(fd);
		offset = size;
		return buf.toString("utf8").split(/\r?\n/).filter((l) => l.length > 0);
	};
}

/** Poll the log until every pattern matched or the deadline passed. */
async function watchLog(pollLogs, patterns, deadlineMs, collected) {
	const pending = new Map(patterns.map((p) => [p.name, p.re]));
	const endAt = Date.now() + deadlineMs;
	while (pending.size > 0 && Date.now() < endAt) {
		for (const line of pollLogs()) {
			collected.push(line);
			for (const [name, re] of pending) {
				if (re.test(line)) {
					pending.delete(name);
				}
			}
		}
		if (pending.size > 0) {
			await sleep(1000);
		}
	}
	for (const line of pollLogs()) {
		collected.push(line);
	}
	return [...pending.keys()];
}

// ---------------------------------------------------------------------------
// Fault injections.
// ---------------------------------------------------------------------------

/** Hold the real HWiNFO consistency mutex in a child for holdSec seconds. */
async function holdMutex(holdSec) {
	const ps =
		`$m = [System.Threading.Mutex]::OpenExisting('${MUTEX_NAME}'); ` +
		"if ($m.WaitOne(5000)) { Start-Sleep -Seconds " + holdSec + "; $m.ReleaseMutex(); 'held-released' } else { 'wait-timeout' }; $m.Dispose()";
	return runPs(ps, (holdSec + 20) * 1000);
}

/** Acquire and immediately release, proving the vector works before use. */
async function preflightMutex() {
	const ps =
		`$m = [System.Threading.Mutex]::OpenExisting('${MUTEX_NAME}'); ` +
		"if ($m.WaitOne(2000)) { $m.ReleaseMutex(); 'ok' } else { 'wait-timeout' }; $m.Dispose()";
	return runPs(ps);
}

// ---------------------------------------------------------------------------
// Events. Each returns { verdict: "PASS" | "FAIL", detail }.
// ---------------------------------------------------------------------------

function classifyLines(lines) {
	return {
		errors: lines.filter((l) => ERROR_RE.test(l)),
		warns: lines.filter((l) => WARN_RE.test(l))
	};
}

async function eventMutexHoldSilent(pollLogs, holdSec) {
	const before = await snapshot();
	const lines = [];
	const holder = holdMutex(holdSec);
	await sleep(holdSec * 1000 + 4000);
	const holderOut = await holder;
	for (const line of pollLogs()) {
		lines.push(line);
	}
	const after = await snapshot();
	const { errors, warns } = classifyLines(lines);
	if (holderOut !== "held-released") {
		return { verdict: "FAIL", detail: `mutex holder said ${holderOut}`, lines };
	}
	if (after.pluginPid !== before.pluginPid || after.pluginPid === null) {
		return { verdict: "FAIL", detail: `plugin PID ${before.pluginPid} -> ${after.pluginPid} (restart during a silent hold)`, lines };
	}
	if (errors.length > 0 || warns.length > 0) {
		return { verdict: "FAIL", detail: `expected silence under the ${holdSec} s grace window, saw ${warns.length} WARN / ${errors.length} ERROR`, lines };
	}
	return { verdict: "PASS", detail: `rode through a ${holdSec} s hold silently (holder: ${holderOut})`, lines };
}

async function eventMutexHoldBusy(pollLogs, holdSec) {
	const before = await snapshot();
	const lines = [];
	const holder = holdMutex(holdSec);
	const missedDuring = await watchLog(pollLogs, [{ name: "warn-busy", re: UNAVAILABLE_BUSY_RE }], holdSec * 1000 + 2000, lines);
	const holderOut = await holder;
	const missedAfter = await watchLog(pollLogs, [{ name: "reopened", re: REOPENED_RE }], 12_000, lines);
	const after = await snapshot();
	const { errors } = classifyLines(lines);
	if (holderOut !== "held-released") {
		return { verdict: "FAIL", detail: `mutex holder said ${holderOut}`, lines };
	}
	if (after.pluginPid !== before.pluginPid || after.pluginPid === null) {
		return { verdict: "FAIL", detail: `plugin PID ${before.pluginPid} -> ${after.pluginPid} (restarted instead of degrading)`, lines };
	}
	const missed = [...missedDuring, ...missedAfter];
	if (missed.length > 0) {
		return { verdict: "FAIL", detail: `missing markers: ${missed.join(", ")}`, lines };
	}
	if (errors.length > 0) {
		return { verdict: "FAIL", detail: `unexpected ERROR lines: ${errors.length}`, lines };
	}
	return { verdict: "PASS", detail: `degraded to unavailable [busy] past the grace window and reopened after release, same PID ${after.pluginPid}`, lines };
}

async function eventPluginKill(pollLogs) {
	const before = await snapshot();
	if (before.pluginPid === null) {
		return { verdict: "FAIL", detail: "plugin process not found before the kill", lines: [] };
	}
	await runPs(`Stop-Process -Id ${before.pluginPid} -Force`);
	const lines = [];
	const missed = await watchLog(pollLogs, [{ name: "started", re: STARTED_RE }, { name: "reopened", re: REOPENED_RE }], 25_000, lines);
	const after = await snapshot();
	if (missed.length > 0) {
		return { verdict: "FAIL", detail: `missing startup markers after kill: ${missed.join(", ")}`, lines };
	}
	if (after.pluginPid === null || after.pluginPid === before.pluginPid) {
		return { verdict: "FAIL", detail: `no fresh plugin PID after kill (${before.pluginPid} -> ${after.pluginPid})`, lines };
	}
	return { verdict: "PASS", detail: `app restarted the plugin, PID ${before.pluginPid} -> ${after.pluginPid}, source reopened`, lines };
}

async function eventAppRestart(pollLogs) {
	const before = await snapshot();
	await runPs("Stop-Process -Name StreamDeck -Force");
	await sleep(4000);
	await runPs(`Start-Process '${SD_EXE}'`);
	const lines = [];
	const missed = await watchLog(pollLogs, [{ name: "started", re: STARTED_RE }, { name: "reopened", re: REOPENED_RE }], 60_000, lines);
	const after = await snapshot();
	if (missed.length > 0) {
		return { verdict: "FAIL", detail: `missing startup markers after app restart: ${missed.join(", ")}`, lines };
	}
	if (after.sdPid === null || after.sdPid === before.sdPid || after.pluginPid === null) {
		return { verdict: "FAIL", detail: `stack did not come back (app ${before.sdPid} -> ${after.sdPid}, plugin ${after.pluginPid})`, lines };
	}
	return { verdict: "PASS", detail: `full stack back, app PID ${before.sdPid} -> ${after.sdPid}, plugin PID ${after.pluginPid}`, lines };
}

const PROGRAM = [
	{ name: "mutex-hold-6s", afterSec: 0, run: (tail) => eventMutexHoldSilent(tail, 6) },
	{ name: "mutex-hold-25s", afterSec: 240, run: (tail) => eventMutexHoldBusy(tail, 25) },
	{ name: "plugin-kill", afterSec: 300, run: (tail) => eventPluginKill(tail) },
	{ name: "app-restart", afterSec: 360, run: (tail) => eventAppRestart(tail) },
	{ name: "mutex-hold-8s", afterSec: 300, run: (tail) => eventMutexHoldSilent(tail, 8) }
];

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

if (args.list) {
	for (const ev of PROGRAM) {
		console.log(`${ev.name} (+${ev.afterSec} s after the previous event)`);
	}
	process.exit(0);
}

if (process.platform !== "win32") {
	console.error("soak-adversary: win32 only (it drives Windows processes)");
	process.exit(1);
}

const only = args.only === undefined ? null : new Set(args.only.split(",").map((s) => s.trim()).filter((s) => s.length > 0));
const program = PROGRAM.filter((ev) => only === null || only.has(ev.name));
if (program.length === 0) {
	console.error(`soak-adversary: --only matched nothing (names: ${PROGRAM.map((e) => e.name).join(", ")})`);
	process.exit(1);
}

const leadSec = Number(args.lead);
if (!Number.isFinite(leadSec) || leadSec < 0) {
	console.error("soak-adversary: --lead must be a number of seconds >= 0");
	process.exit(1);
}

const stamp = new Date();
const pad2 = (n) => String(n).padStart(2, "0");
const defaultOut = path.join(repoRoot, "release", `soak-adversary-${stamp.getFullYear()}${pad2(stamp.getMonth() + 1)}${pad2(stamp.getDate())}-${pad2(stamp.getHours())}${pad2(stamp.getMinutes())}.jsonl`);
const outPath = path.resolve(args.out ?? defaultOut);
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const logDir = args.logs ?? path.join(process.env.APPDATA ?? "", "Elgato", "StreamDeck", "Plugins", "com.lawrensen.hwinfo.sdPlugin", "logs");
const pollLogs = makeLogTail(logDir);

const emit = (obj) => fs.appendFileSync(outPath, JSON.stringify(obj) + os.EOL);

const preflight = await preflightMutex().catch((err) => `open-failed: ${err?.message ?? err}`);
const baseline = await snapshot();
if (preflight !== "ok") {
	console.error(`soak-adversary: mutex preflight failed (${preflight}); refusing to start`);
	process.exit(1);
}
if (baseline.pluginPid === null || baseline.sdPid === null || baseline.hwinfoCount === 0) {
	console.error(`soak-adversary: baseline incomplete (plugin ${baseline.pluginPid}, app ${baseline.sdPid}, hwinfo ${baseline.hwinfoCount}); refusing to start`);
	process.exit(1);
}
emit({ tsIso: nowIso(), name: "program-start", verdict: "INFO", detail: `baseline plugin ${baseline.pluginPid}, app ${baseline.sdPid}, hwinfo x${baseline.hwinfoCount}; lead ${leadSec} s; events: ${program.map((e) => e.name).join(", ")}` });
console.log(`soak-adversary: baseline ok (plugin ${baseline.pluginPid}, app ${baseline.sdPid}); ${program.length} events after a ${leadSec} s lead`);
console.log(`soak-adversary: events ${outPath}`);

pollLogs(); // prime the tail so only lines after this point count
await sleep(leadSec * 1000);

let failures = 0;
for (const ev of program) {
	await sleep(ev.afterSec * 1000);
	pollLogs(); // drain quiet-period lines out of the event's window
	const startedIso = nowIso();
	console.log(`soak-adversary: ${startedIso} ${ev.name} firing`);
	let result;
	try {
		result = await ev.run(pollLogs);
	} catch (err) {
		result = { verdict: "FAIL", detail: `event crashed: ${String(err?.message ?? err).slice(0, 200)}`, lines: [] };
	}
	if (result.verdict !== "PASS") {
		failures++;
	}
	emit({ tsIso: startedIso, name: ev.name, verdict: result.verdict, detail: result.detail, logLines: result.lines.length });
	console.log(`soak-adversary: ${ev.name} ${result.verdict}: ${result.detail}`);
}

emit({ tsIso: nowIso(), name: "program-end", verdict: failures === 0 ? "PASS" : "FAIL", detail: `${program.length - failures}/${program.length} events passed` });
console.log(`soak-adversary: done, ${program.length - failures}/${program.length} passed`);
process.exit(failures === 0 ? 0 : 1);
