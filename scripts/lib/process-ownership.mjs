// Cleanup authority comes from a process identity or a disposable profile,
// never a product name, headless flag, PID alone, or shared profile prefix.
import { execFileSync } from "node:child_process";

export function processIdentity(row) {
	return `${row.pid}:${row.createdAt}`;
}

export function processSnapshot() {
	const script = "$rows = @(Get-CimInstance Win32_Process -Filter \"Name='node.exe' or Name='chrome.exe'\" | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; parentPid = $_.ParentProcessId; name = $_.Name; commandLine = $_.CommandLine; createdAt = $_.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') } }); ConvertTo-Json -InputObject $rows -Depth 2";
	return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", timeout: 30_000, windowsHide: true }).trim() || "[]");
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
export function classifyNewProcesses(before, after, recorded) {
	const previous = new Set(before.map(processIdentity));
	const ownedIds = new Set(recorded.map(processIdentity));
	const parentIds = new Set(recorded.map((row) => row.pid));
	const result = { owned: [], ambiguous: [], unrelated: [] };
	for (const row of after) {
		if (previous.has(processIdentity(row))) continue;
		if (ownedIds.has(processIdentity(row))) result.owned.push(row);
		else if (parentIds.has(row.parentPid)) result.ambiguous.push(row);
		else result.unrelated.push(row);
	}
	return result;
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

/** The live Process object is acquired before its creation time is checked,
 * and Kill acts on that object. A recycled PID cannot inherit authority. */
export function terminateProcesses(rows) {
	if (rows.length === 0) return;
	const ids = rows.map((row) => ({ pid: row.pid, createdAt: row.createdAt }));
	const json = JSON.stringify(ids).replaceAll("'", "''");
	const script = `$targets = ConvertFrom-Json '${json}'; foreach ($target in $targets) { $p = Get-Process -Id $target.pid -ErrorAction SilentlyContinue; if ($null -ne $p) { try { if ($p.StartTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') -ceq $target.createdAt) { $p.Kill() } } catch { } } }; exit 0`;
	execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { stdio: "ignore", timeout: 15_000, windowsHide: true });
}

export function cleanupBrowser(profile, startedAt) {
	// The second pass catches children that appeared during the first snapshot.
	// Exact disposable-profile attribution is required on every pass.
	for (let pass = 0; pass < 2; pass++) {
		terminateProcesses(browserProcesses(processSnapshot(), profile, startedAt));
	}
}
