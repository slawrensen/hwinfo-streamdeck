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
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { parseArgs, promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { assertSameStack, assertSharedMemoryReady, makeEventLogTail, restartEvent, sameLifetime, selectInstalledStack, startHostCommand, stopIdentityCommand } from "./lib/soak-adversary-safety.mjs";
import { candidateNativeContract, createInstalledProducerCheck, runWithAdvancingProducer } from "./lib/soak-producer-freshness.mjs";

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
const SD_EXE = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Elgato", "StreamDeck", "StreamDeck.exe");
const installedRoot = path.join(process.env.APPDATA ?? "", "Elgato", "StreamDeck", "Plugins", "com.lawrensen.hwinfo.sdPlugin");
const installedScript = path.join(installedRoot, "bin", "plugin.js");
const installedAddon = path.join(installedRoot, "bin", "hwsm.node");
const nodeRoot = path.join(process.env.APPDATA ?? "", "Elgato", "StreamDeck", "NodeJS");
let observerSession;

const UNAVAILABLE_BUSY_RE = /WARN\s+HwinfoPoller: HWiNFO unavailable \[busy\]/;
const REOPENED_RE = /INFO\s+HwinfoPoller: Opened HWiNFO data source: shared-memory\b/;
const STARTED_RE = /INFO\s+HwinfoPoller: Started \(/;
const ERROR_RE = /\bERROR\b/;
const WARN_RE = /\bWARN\b/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Process snapshots: the plugin's node process, the app, HWiNFO presence.
// ---------------------------------------------------------------------------

async function runPs(command, timeoutMs = 30_000) {
	const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
	return stdout.trim();
}

async function snapshot() {
	const ps =
		"$ErrorActionPreference = 'Stop'; $procs = @(Get-CimInstance Win32_Process -ErrorAction Stop -Filter \"Name='node.exe' OR Name='StreamDeck.exe' OR Name LIKE 'HWiNFO%'\" | " +
		"Select-Object ProcessId,ParentProcessId,SessionId,Name,CommandLine,ExecutablePath,@{Name='CreatedTicks';Expression={$_.CreationDate.ToUniversalTime().Ticks.ToString()}}); ConvertTo-Json -InputObject $procs -Depth 2 -Compress";
	const rows = JSON.parse(await runPs(ps));
	const stack = selectInstalledStack(rows, { installedScript, nodeRoot, hostImage: SD_EXE, sessionId: observerSession });
	return { ...stack, pluginPid: stack.plugin.ProcessId, sdPid: stack.host.ProcessId };
}

// ---------------------------------------------------------------------------
// Plugin log tail: complete rotated tails and fail-closed missing evidence.
// ---------------------------------------------------------------------------

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
		`$ErrorActionPreference = 'Stop'; $m = [System.Threading.Mutex]::OpenExisting('${MUTEX_NAME}'); $held = $false; ` +
		"try { $held = $m.WaitOne(5000); if ($held) { Start-Sleep -Seconds " + holdSec + "; 'held-released' } else { throw 'wait-timeout' } } finally { if ($held) { $m.ReleaseMutex() }; $m.Dispose() }";
	return runPs(ps, (holdSec + 20) * 1000);
}

/** Acquire and immediately release, proving the vector works before use. */
async function preflightMutex() {
	const ps =
		`$ErrorActionPreference = 'Stop'; $m = [System.Threading.Mutex]::OpenExisting('${MUTEX_NAME}'); $held = $false; ` +
		"try { $held = $m.WaitOne(2000); if ($held) { 'ok' } else { throw 'wait-timeout' } } finally { if ($held) { $m.ReleaseMutex() }; $m.Dispose() }";
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
	const holder = holdMutex(holdSec).catch((err) => `holder-failed: ${err.message}`);
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
	if (!sameLifetime(before.plugin, after.plugin) || !sameLifetime(before.host, after.host)) {
		return { verdict: "FAIL", detail: `plugin PID ${before.pluginPid} -> ${after.pluginPid} (restart during a silent hold)`, lines };
	}
	if (errors.length > 0 || warns.length > 0) {
		return { verdict: "FAIL", detail: `expected silence under the ${holdSec} s grace window, saw ${warns.length} WARN / ${errors.length} ERROR`, lines };
	}
	return { verdict: "PASS", detail: `rode through a ${holdSec} s hold silently (holder: ${holderOut})`, lines, before, after };
}

async function eventMutexHoldBusy(pollLogs, holdSec) {
	const before = await snapshot();
	const lines = [];
	const holder = holdMutex(holdSec).catch((err) => `holder-failed: ${err.message}`);
	const missedDuring = await watchLog(pollLogs, [{ name: "warn-busy", re: UNAVAILABLE_BUSY_RE }], holdSec * 1000 + 2000, lines);
	const holderOut = await holder;
	const missedAfter = await watchLog(pollLogs, [{ name: "reopened", re: REOPENED_RE }], 12_000, lines);
	const after = await snapshot();
	const { errors } = classifyLines(lines);
	if (holderOut !== "held-released") {
		return { verdict: "FAIL", detail: `mutex holder said ${holderOut}`, lines };
	}
	if (!sameLifetime(before.plugin, after.plugin) || !sameLifetime(before.host, after.host)) {
		return { verdict: "FAIL", detail: `plugin PID ${before.pluginPid} -> ${after.pluginPid} (restarted instead of degrading)`, lines };
	}
	const missed = [...missedDuring, ...missedAfter];
	if (missed.length > 0) {
		return { verdict: "FAIL", detail: `missing markers: ${missed.join(", ")}`, lines };
	}
	if (errors.length > 0) {
		return { verdict: "FAIL", detail: `unexpected ERROR lines: ${errors.length}`, lines };
	}
	return { verdict: "PASS", detail: `degraded to unavailable [busy] past the grace window and reopened after release, same PID ${after.pluginPid}`, lines, before, after };
}

async function stopVerifiedStack(before, role) {
	assertSameStack(before, await snapshot());
	const result = await runPs(stopIdentityCommand(before[role]));
	if (result !== "stopped-verified-identity") throw new Error("Fault did not confirm verified process exit");
}

async function eventRestart(role, pollLogs) {
	return restartEvent(role, {
		snapshot,
		stop: stopVerifiedStack,
		startHost: async () => {
			await sleep(4000);
			await runPs(startHostCommand(SD_EXE));
		},
		collectRecovery: async (deadlineMs) => {
			const lines = [];
			await watchLog(pollLogs, [{ name: "started", re: STARTED_RE }, { name: "reopened", re: REOPENED_RE }], deadlineMs, lines);
			// Recovery must stay clean beyond its first successful open.
			await sleep(4000);
			lines.push(...pollLogs());
			return lines;
		}
	});
}

const PROGRAM = [
	{ name: "mutex-hold-6s", afterSec: 0, run: (tail) => eventMutexHoldSilent(tail, 6) },
	{ name: "mutex-hold-25s", afterSec: 240, run: (tail) => eventMutexHoldBusy(tail, 25) },
	{ name: "plugin-kill", afterSec: 300, run: (tail) => eventRestart("plugin", tail) },
	{ name: "app-restart", afterSec: 360, run: (tail) => eventRestart("host", tail) },
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
fs.writeFileSync(outPath, "", { flag: "wx" }); // A trial never appends to earlier evidence.

const logDir = args.logs ?? path.join(process.env.APPDATA ?? "", "Elgato", "StreamDeck", "Plugins", "com.lawrensen.hwinfo.sdPlugin", "logs");
const pollLogs = makeEventLogTail(logDir);
const assertReady = (stack) => assertSharedMemoryReady(fs.readdirSync(logDir).filter((file) => file.endsWith(".log"))
	.flatMap((file) => fs.readFileSync(path.join(logDir, file), "utf8").split(/\r?\n/)), stack.plugin);

const emit = (obj) => fs.appendFileSync(outPath, JSON.stringify(obj) + os.EOL);

observerSession = Number(await runPs("[Diagnostics.Process]::GetCurrentProcess().SessionId"));
if (!Number.isSafeInteger(observerSession) || observerSession < 0) throw new Error("Observer session unavailable");
const baseline = await snapshot();
assertReady(baseline);
if (baseline.hwinfoCount === 0) {
	console.error(`soak-adversary: baseline incomplete (plugin ${baseline.pluginPid}, app ${baseline.sdPid}, hwinfo ${baseline.hwinfoCount}); refusing to start`);
	process.exit(1);
}
const hashes = () => Object.fromEntries([installedScript, installedAddon]
	.map((file) => [file, createHash("sha256").update(fs.readFileSync(file)).digest("hex")]));
const installedHashes = hashes();
const checkProducer = createInstalledProducerCheck({ addonPath: installedAddon,
	expectedSha256: installedHashes[installedAddon], expectedBuild: candidateNativeContract(repoRoot) });
pollLogs(); // prime before even the brief mutex preflight
let producerBaseline;
try {
	producerBaseline = await checkProducer();
	assertSameStack(baseline, await snapshot());
} catch (err) {
	emit({ tsIso: nowIso(), name: "program-end", verdict: "FAIL", detail: `Producer preflight failed: ${err.message}`, evidence: err.freshnessEvidence });
	throw err;
}
if (program.some((event) => event.name.startsWith("mutex-"))) {
	const preflight = await preflightMutex().catch((err) => `open-failed: ${err?.message ?? err}`);
	if (preflight !== "ok") throw new Error(`Mutex preflight failed (${preflight}); refusing to start`);
}
emit({ tsIso: nowIso(), name: "program-start", verdict: "INFO", baseline, installedHashes, producerBaseline, detail: `baseline plugin ${baseline.pluginPid}, app ${baseline.sdPid}, hwinfo x${baseline.hwinfoCount}; lead ${leadSec} s; events: ${program.map((e) => e.name).join(", ")}` });
console.log(`soak-adversary: baseline ok (plugin ${baseline.pluginPid}, app ${baseline.sdPid}); ${program.length} events after a ${leadSec} s lead`);
console.log(`soak-adversary: events ${outPath}`);

await sleep(leadSec * 1000);

let failures = 0;
let completed = 0;
for (const ev of program) {
	await sleep(ev.afterSec * 1000);
	const startedIso = nowIso();
	console.log(`soak-adversary: ${startedIso} ${ev.name} firing`);
	let result;
	try {
		const quietLines = pollLogs();
		if (quietLines.some((line) => /\b(?:WARN|ERROR)\b/.test(line))) {
			result = { verdict: "FAIL", detail: "Unexpected WARN/ERROR before the next fault", lines: quietLines };
		} else {
			if (JSON.stringify(hashes()) !== JSON.stringify(installedHashes)) throw new Error("Installed candidate bytes changed; refusing fault");
			assertReady(await snapshot());
			result = await runWithAdvancingProducer(() => ev.run(pollLogs), checkProducer);
			result.lines.push(...pollLogs());
			if (result.verdict === "PASS") {
				if (JSON.stringify(hashes()) !== JSON.stringify(installedHashes)) throw new Error("Installed candidate bytes changed during the event");
				const settled = await snapshot();
				assertSameStack(result.after, settled);
				result.lines.push(...pollLogs());
				if (result.lines.some((line) => ERROR_RE.test(line))) throw new Error("Unexpected ERROR before event completion");
				assertReady(settled);
			}
		}
	} catch (err) {
		result = { ...result, verdict: "FAIL", detail: `event failed: ${String(err?.message ?? err).slice(0, 200)}`, lines: result?.lines ?? [], freshnessFailure: err?.freshnessEvidence };
	}
	if (result.verdict !== "PASS") {
		failures++;
	}
	completed++;
	emit({ tsIso: startedIso, finishedIso: nowIso(), name: ev.name, ...result, logLines: result.lines.length });
	console.log(`soak-adversary: ${ev.name} ${result.verdict}: ${result.detail}`);
	if (failures > 0) break; // Unverified recovery never authorizes the next fault.
}

emit({ tsIso: nowIso(), name: "program-end", verdict: failures === 0 ? "PASS" : "FAIL", detail: `${completed - failures}/${program.length} events passed` });
console.log(`soak-adversary: done, ${completed - failures}/${program.length} passed`);
process.exit(failures === 0 ? 0 : 1);
