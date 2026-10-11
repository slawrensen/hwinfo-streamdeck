// Cleanup authority comes from a process identity or a disposable profile,
// never a product name, headless flag, PID alone, or shared profile prefix.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function processIdentity(row) {
	return `${row.pid}:${row.createdAt}`;
}

export function processSnapshot({ execute = execFileSync } = {}) {
	const script = "$ErrorActionPreference = 'Stop'; $rows = @(Get-CimInstance Win32_Process -Filter \"Name='node.exe' or Name='chrome.exe'\" -ErrorAction Stop | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; parentPid = $_.ParentProcessId; name = $_.Name; commandLine = $_.CommandLine; createdAt = $_.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') } }); ConvertTo-Json -InputObject $rows -Depth 2";
	const rows = JSON.parse(execute("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", timeout: 30_000, windowsHide: true }));
	if (!Array.isArray(rows) || rows.some((row) => !row || !Number.isInteger(row.pid) || row.pid <= 0 || !Number.isInteger(row.parentPid) || row.parentPid < 0 || typeof row.createdAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(row.createdAt))) {
		throw new Error("Invalid process snapshot");
	}
	return rows;
}

/** Every link must refer to a parent present with its recorded creation
 * identity. A reused parent PID or a missing ancestor grants no authority. */
export function ownedDescendants(rows, roots) {
	const owned = new Map(rows.filter((row) => roots.has(processIdentity(row))).map((row) => [row.pid, row]));
	let changed = true;
	while (changed) {
		changed = false;
		for (const row of rows) {
			const parent = owned.get(row.parentPid);
			if (!owned.has(row.pid) && parent && row.createdAt >= parent.createdAt) {
				owned.set(row.pid, row);
				changed = true;
			}
		}
	}
	return [...owned.values()];
}

/** Missing ancestors are reported, but do not authorize cleanup. */
export function classifyNewProcesses(before, after, recorded, runDirectories = []) {
	const previous = new Set(before.map(processIdentity));
	const ownedIds = new Set(recorded.map(processIdentity));
	const parentIds = new Set(recorded.map((row) => row.pid));
	const result = { owned: [], ambiguous: [], unrelated: [] };
	for (const row of after) {
		if (previous.has(processIdentity(row))) continue;
		if (ownedIds.has(processIdentity(row))) result.owned.push(row);
		else if (parentIds.has(row.parentPid) || commandInDirectories(row.commandLine, runDirectories)) result.ambiguous.push(row);
		else result.unrelated.push(row);
	}
	return result;
}

function commandInDirectories(commandLine, directories) {
	const args = (commandLine ?? "").match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
	return args.some((arg) => {
		const value = arg.replaceAll('"', "").replaceAll("\\", "/").toLowerCase();
		const candidate = value.slice(value.indexOf("=") + 1);
		return directories.some((directory) => {
			const normalized = directory.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
			return candidate === normalized || candidate.startsWith(`${normalized}/`);
		});
	});
}

/** A suite can group its unique profiles for leak detection. Only an
 * existing disposable directory beneath the real temp root is accepted. */
export function createBrowserProfile(prefix) {
	let directory = os.tmpdir();
	if (process.env.HWSM_TEST_BROWSER_ROOT !== undefined) {
		directory = realpathSync(process.env.HWSM_TEST_BROWSER_ROOT);
		const relative = path.relative(realpathSync(os.tmpdir()), directory);
		if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative) || !path.basename(directory).startsWith("hwinfo-suite-browser-")) {
			throw new Error("HWSM_TEST_BROWSER_ROOT must be an owned suite directory beneath the temp root");
		}
	}
	return mkdtempSync(path.join(directory, prefix));
}

/** Port zero is discovered from the profile created for this browser, never
 * from a shared fixed debugger endpoint which could belong to another run. */
export function browserDebuggerPort(profile) {
	const port = Number(readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0]);
	if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("Invalid browser debugger port");
	return port;
}

/** Record descendants while their ancestors are observable, retaining their
 * identities after a harness exits. Unobserved orphans fail cleanup but never
 * grant permission to kill a process by its old parent PID alone. */
export function createChildCleanup({ pid = process.pid, snapshot = processSnapshot, terminate = terminateProcesses, runDirectories = [] } = {}) {
	const before = snapshot();
	const root = before.find((row) => row.pid === pid);
	if (!root) throw new Error("Cannot establish capture process identity");
	const rootId = processIdentity(root);
	const recorded = new Map([[rootId, root]]);
	const observe = () => {
		const rows = snapshot();
		const owned = ownedDescendants(rows, new Set(recorded.keys()));
		for (const row of owned) recorded.set(processIdentity(row), row);
		return { rows, owned: owned.filter((row) => processIdentity(row) !== rootId) };
	};
	return {
		observe,
		cleanup() {
			for (let pass = 0; pass < 2; pass++) terminate(observe().owned);
			const { rows, owned } = observe();
			const { ambiguous } = classifyNewProcesses(before, rows, [...recorded.values()], runDirectories);
			if (owned.length || ambiguous.length) throw new Error(`Capture cleanup left ${owned.length} owned and ${ambiguous.length} ambiguous process(es)`);
		}
	};
}

/** Chrome echoes its user-data-dir on child command lines. Match the whole
 * argument, including the quoted-argument form Node uses for spaced paths. */
export function hasBrowserProfile(commandLine, profile) {
	const args = (commandLine ?? "").match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
	return args.some((arg) => arg.replaceAll('"', "").toLowerCase() === `--user-data-dir=${profile}`.toLowerCase());
}

export function browserProcesses(rows, profile, startedAt) {
	const roots = new Set(rows.filter((row) => row.name?.toLowerCase() === "chrome.exe" && row.createdAt >= startedAt && hasBrowserProfile(row.commandLine, profile)).map(processIdentity));
	return ownedDescendants(rows, roots);
}

/** Pin the native process handle before checking creation time. A Process
 * obtained by PID otherwise reopens by PID for Kill, allowing a reuse race. */
export function terminateProcesses(rows) {
	if (rows.length === 0) return;
	const ids = rows.map((row) => ({ pid: row.pid, createdAt: row.createdAt }));
	const json = JSON.stringify(ids).replaceAll("'", "''");
	const script = `$targets = ConvertFrom-Json '${json}'; foreach ($target in $targets) { $p = Get-Process -Id $target.pid -ErrorAction SilentlyContinue; if ($null -ne $p) { try { $null = $p.Handle; if ($p.StartTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') -ceq $target.createdAt) { $p.Kill(); $null = $p.WaitForExit(2000) } } catch { } finally { $p.Dispose() } } }; exit 0`;
	execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { stdio: "ignore", timeout: 15_000, windowsHide: true });
}

export function cleanupBrowser(profile, startedAt, { snapshot = processSnapshot, terminate = terminateProcesses } = {}) {
	// The second pass catches children that appeared during the first snapshot.
	// Exact disposable-profile attribution is required on every pass.
	const recorded = new Set();
	for (let pass = 0; pass < 2; pass++) {
		const rows = snapshot();
		const owned = browserProcesses(rows, profile, startedAt);
		for (const row of owned) recorded.add(processIdentity(row));
		terminate(ownedDescendants(rows, recorded));
	}
	const rows = snapshot();
	const remaining = ownedDescendants(rows, new Set([...recorded, ...browserProcesses(rows, profile, startedAt).map(processIdentity)]));
	if (remaining.length > 0) throw new Error(`Browser cleanup left ${remaining.length} owned process(es) for ${profile}: ${remaining.map((row) => row.pid).join(", ")}`);
}
