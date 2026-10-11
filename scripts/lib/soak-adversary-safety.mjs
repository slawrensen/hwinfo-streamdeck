// Safety and evidence boundaries for the live fault driver. Importing this
// module never enumerates, starts or terminates a process.
import fs from "node:fs";
import path from "node:path";

function samePath(a, b) {
	return typeof a === "string" && typeof b === "string" &&
		path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();
}

// The host uses ordinary whole quoted/unquoted arguments. Refuse more exotic
// Windows quoting instead of guessing whether an installed path is the entry.
function argumentsOf(command) {
	if (typeof command !== "string") return [];
	const result = [];
	let rest = command.trim();
	while (rest) {
		const match = /^(?:"([^"\r\n]*)"|([^\s"]+))(?:\s+|$)/.exec(rest);
		if (!match) return [];
		result.push(match[1] ?? match[2]);
		// Everything after Node's entrypoint belongs to the app, including
		// Stream Deck's escaped JSON -info argument. It grants no authority.
		if (result.length > 1 && !["--no-global-search-paths", "--enable-source-maps"].includes(result.at(-1))) return result;
		rest = rest.slice(match[0].length);
	}
	return result;
}

function validIdentity(row) {
	return row && Number.isSafeInteger(row.ProcessId) && row.ProcessId > 0 &&
		Number.isSafeInteger(row.SessionId) && row.SessionId >= 0 &&
		typeof row.CreatedTicks === "string" && /^\d{17,19}$/.test(row.CreatedTicks) &&
		typeof row.ExecutablePath === "string" && path.win32.isAbsolute(row.ExecutablePath);
}

export function sameLifetime(a, b) {
	return Boolean(validIdentity(a) && validIdentity(b) && a.ProcessId === b.ProcessId &&
		a.CreatedTicks === b.CreatedTicks && a.SessionId === b.SessionId && samePath(a.ExecutablePath, b.ExecutablePath));
}

export function selectInstalledStack(rows, { installedScript, nodeRoot, hostImage, sessionId }) {
	const candidates = rows.filter((row) => {
		if (row.Name?.toLowerCase() !== "node.exe") return false;
		const args = argumentsOf(row.CommandLine);
		let index = 1;
		while (["--no-global-search-paths", "--enable-source-maps"].includes(args[index])) index++;
		return samePath(args[index], installedScript);
	});
	if (candidates.length !== 1) throw new Error(`Expected one installed plugin entrypoint, found ${candidates.length}`);
	const plugin = candidates[0];
	const runtimeRoot = path.win32.normalize(nodeRoot).replace(/[\\/]$/, "").toLowerCase() + "\\";
	if (!validIdentity(plugin) || plugin.SessionId !== sessionId ||
		!path.win32.normalize(plugin.ExecutablePath).toLowerCase().startsWith(runtimeRoot) ||
		!samePath(argumentsOf(plugin.CommandLine)[0], plugin.ExecutablePath)) {
		throw new Error("Installed plugin image, session or creation identity is unverified");
	}
	const parents = rows.filter((row) => row.Name?.toLowerCase() === "streamdeck.exe" &&
		row.ProcessId === plugin.ParentProcessId && validIdentity(row) &&
		row.SessionId === plugin.SessionId && BigInt(row.CreatedTicks) <= BigInt(plugin.CreatedTicks) &&
		samePath(row.ExecutablePath, hostImage));
	if (parents.length !== 1) throw new Error("Installed plugin has no unique verified Stream Deck parent");
	return { plugin, host: parents[0], hwinfoCount: rows.filter((row) => /^HWiNFO/i.test(row.Name ?? "")).length };
}

export function assertSameStack(expected, actual) {
	if (!sameLifetime(expected.plugin, actual.plugin) || !sameLifetime(expected.host, actual.host)) {
		throw new Error("Installed stack changed before the requested fault; no process was stopped");
	}
}

function currentLifetimeLines(lines, plugin) {
	if (!validIdentity(plugin)) throw new Error("Missing plugin creation identity");
	const startedMs = Number((BigInt(plugin.CreatedTicks) - 621355968000000000n) / 10000n);
	return lines.map((line) => ({ line, time: Date.parse(line.slice(0, 24)) }))
		.filter(({ time }) => Number.isFinite(time) && time >= startedMs)
		.sort((a, b) => a.time - b.time).map(({ line }) => line);
}

export function assertSharedMemoryReady(lines, plugin) {
	const current = currentLifetimeLines(lines, plugin);
	let shared = false;
	for (const line of current) {
		if (/HwinfoPoller: (?:Opened HWiNFO data source: shared-memory\b|Data source layout changed; reopened in place \(shared-memory\)|Shared memory returned)/.test(line)) shared = true;
		else if (/HwinfoPoller: (?:Opened HWiNFO data source:|HWiNFO unavailable|Stopped|Started|Source mode set|Holding last values|Unexpected poll failure)/.test(line)) shared = false;
	}
	if (!shared) throw new Error("Current plugin lifetime lacks ready shared-memory log evidence; refusing fault");
}

const psString = (value) => `'${value.replaceAll("'", "''")}'`;

/** The Process handle is pinned before checking its creation time and image.
 * CIM truncates at microseconds; native StartTime retains 100 ns precision.
 * Kill uses that same handle, never a second PID lookup or a process name. */
export function stopIdentityCommand(target) {
	if (!validIdentity(target)) throw new Error("Cannot stop an unverified process identity");
	return `$ErrorActionPreference = 'Stop'; $p = Get-Process -Id ${target.ProcessId} -ErrorAction Stop; ` +
		`try { $null = $p.Handle; $ticks = $p.StartTime.ToUniversalTime().Ticks; ` +
		`if ([Math]::Abs($ticks - [long]${target.CreatedTicks}) -gt 9 -or $p.SessionId -ne ${target.SessionId} -or ` +
		`-not [string]::Equals($p.MainModule.FileName, ${psString(target.ExecutablePath)}, [StringComparison]::OrdinalIgnoreCase)) { throw 'Process identity changed; refusing fault' }; ` +
		`$p.Kill(); if (-not $p.WaitForExit(10000)) { throw 'Verified process did not exit' }; 'stopped-verified-identity' } finally { $p.Dispose() }`;
}

export function startHostCommand(hostImage) {
	if (typeof hostImage !== "string" || !path.win32.isAbsolute(hostImage)) throw new Error("Invalid host image");
	return `$ErrorActionPreference = 'Stop'; Start-Process -FilePath ${psString(hostImage)} -WindowStyle Hidden`;
}

/** Retain every newly appended line, including the old active file's final
 * tail and intermediate files if several rotations occur between polls. */
export function makeEventLogTail(dir) {
	let primed = false;
	let active = null;
	const cursors = new Map();
	return () => {
		const files = fs.readdirSync(dir).filter((name) => name.endsWith(".log"))
			.map((name) => { const file = path.join(dir, name); return { file, stat: fs.statSync(file, { bigint: true }) }; })
			.sort((a, b) => a.stat.mtimeNs < b.stat.mtimeNs ? -1 : a.stat.mtimeNs > b.stat.mtimeNs ? 1 : 0);
		if (files.length === 0) throw new Error("Plugin logs are missing; fault evidence unavailable");
		if (primed && !files.some(({ stat }) => stat.ino === active)) throw new Error("Plugin log rotation lost the active tail; fault evidence incomplete");
		const lines = [];
		for (const { file, stat } of files) {
			const key = stat.ino;
			const size = Number(stat.size);
			const previous = cursors.get(key);
			const from = previous?.offset ?? (primed ? 0 : size);
			if (size < from) throw new Error("Plugin log truncated; fault evidence incomplete");
			let pending = previous?.pending ?? "";
			if (size > from) {
				const fd = fs.openSync(file, "r");
				const buf = Buffer.alloc(size - from);
				try {
					const opened = fs.fstatSync(fd, { bigint: true });
					if (opened.ino !== stat.ino || opened.size < stat.size) throw new Error("Plugin log changed while opening; fault evidence incomplete");
					if (fs.readSync(fd, buf, 0, buf.length, from) !== buf.length) throw new Error("Plugin log short read; fault evidence incomplete");
				} finally { fs.closeSync(fd); }
				const chunks = (pending + buf.toString("utf8")).split(/\r?\n/);
				pending = chunks.pop();
				lines.push(...chunks.filter(Boolean));
			}
			cursors.set(key, { offset: size, pending });
		}
		active = files.at(-1).stat.ino;
		for (const key of cursors.keys()) if (!files.some(({ stat }) => stat.ino === key)) cursors.delete(key);
		primed = true;
		return lines;
	};
}

/** Run a restart with injected effects so the production orchestration and
 * acceptance rules can be exercised without touching the user's stack. */
export async function restartEvent(role, { snapshot, stop, startHost, collectRecovery }) {
	if (role !== "plugin" && role !== "host") throw new Error("Invalid restart role");
	const before = await snapshot();
	await stop(before, role);
	if (role === "host") await startHost();
	const lines = await collectRecovery(role === "host" ? 60_000 : 25_000);
	const after = await snapshot();
	const current = currentLifetimeLines(lines, after.plugin);
	let detail = null;
	if (lines.some((line) => /\bERROR\b/.test(line))) detail = "Unexpected ERROR during restart recovery";
	else if (!current.some((line) => /INFO\s+HwinfoPoller: Started \(/.test(line)) ||
		!current.some((line) => /INFO\s+HwinfoPoller: Opened HWiNFO data source: shared-memory\b/.test(line))) detail = "Missing current-lifetime startup/shared-memory recovery markers";
	else if (sameLifetime(before.plugin, after.plugin)) detail = "No new plugin lifetime after restart";
	else if (role === "plugin" && !sameLifetime(before.host, after.host)) detail = "Host lifetime changed during plugin-only restart";
	else if (role === "host" && sameLifetime(before.host, after.host)) detail = "No new host lifetime after app restart";
	if (detail === null) {
		try { assertSharedMemoryReady(lines, after.plugin); }
		catch (err) { detail = err.message; }
	}
	return { verdict: detail ? "FAIL" : "PASS", detail: detail ?? `Recovered verified ${role} restart on shared-memory`, lines, before, after };
}
