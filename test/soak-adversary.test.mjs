import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { assertSameStack, assertSharedMemoryReady, makeEventLogTail, restartEvent, selectInstalledStack, startHostCommand, stopIdentityCommand } from "../scripts/lib/soak-adversary-safety.mjs";

const config = {
	installedScript: "C:\\Users\\Owner\\AppData\\Roaming\\Elgato\\StreamDeck\\Plugins\\com.lawrensen.hwinfo.sdPlugin\\bin\\plugin.js",
	nodeRoot: "C:\\Users\\Owner\\AppData\\Roaming\\Elgato\\StreamDeck\\NodeJS",
	hostImage: "C:\\Program Files\\Elgato\\StreamDeck\\StreamDeck.exe", sessionId: 1
};
const host = { ProcessId: 10, ParentProcessId: 1, SessionId: 1, CreatedTicks: "638940000000000000", Name: "StreamDeck.exe", ExecutablePath: config.hostImage };
const plugin = { ProcessId: 20, ParentProcessId: 10, SessionId: 1, CreatedTicks: "638940000010000000", Name: "node.exe", ExecutablePath: config.nodeRoot + "\\20\\node.exe" };
plugin.CommandLine = `"${plugin.ExecutablePath}" --no-global-search-paths --enable-source-maps "${config.installedScript}" -port 1234`;
const stack = (rows = [host, plugin]) => selectInstalledStack(rows, config);
const recovered = (role = "plugin") => ({
	plugin: { ...plugin, CreatedTicks: "638940000030000000" },
	host: role === "host" ? { ...host, CreatedTicks: "638940000020000000" } : host,
	hwinfoCount: 1
});
const goodLogs = ["2026-09-21T00:00:00.000Z INFO  HwinfoPoller: Started (1000 ms interval)", "2026-09-21T00:00:00.100Z INFO  HwinfoPoller: Opened HWiNFO data source: shared-memory"];
function removeLogFixture(dir) {
	assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
	assert(path.basename(dir).startsWith("soak-adversary-log-"));
	fs.rmSync(dir, { recursive: true, force: true });
}

test("only the installed entrypoint and its verified parent grant fault authority", () => {
	const bystanders = [
		{ ...host, ProcessId: 11 },
		{ ...plugin, ProcessId: 21, CommandLine: plugin.CommandLine.replace(config.installedScript, "C:\\worktree\\com.lawrensen.hwinfo.sdPlugin\\bin\\plugin.js") },
		{ ...plugin, ProcessId: 22, CommandLine: `"${plugin.ExecutablePath}" "C:\\other.mjs" "${config.installedScript}"` },
		{ ...plugin, ProcessId: 23, CommandLine: plugin.CommandLine.replace("plugin.js\"", "plugin.js.bak\"") }
	];
	assert.equal(stack([...bystanders, host, plugin]).plugin.ProcessId, 20);
	assert.equal(stack([...bystanders, host, plugin]).host.ProcessId, 10);
	assert.throws(() => stack([...bystanders, host]), /found 0/);
	assert.throws(() => stack([host, plugin, { ...plugin, ProcessId: 24 }]), /found 2/);
	for (const changed of [
		{ SessionId: 2 }, { CreatedTicks: null }, { ParentProcessId: 999 },
		{ ExecutablePath: "C:\\untrusted\\node.exe" },
		{ CommandLine: plugin.CommandLine.replace("--enable-source-maps", "--eval") }
	]) assert.throws(() => stack([host, { ...plugin, ...changed }]));
	assert.throws(() => stack([{ ...host, CreatedTicks: "638940000020000000" }, plugin]), /parent/);
	assert.throws(() => stack([{ ...host, SessionId: 2 }, plugin]), /parent/);
	assert.throws(() => stack([{ ...host, ExecutablePath: "C:\\fake\\StreamDeck.exe" }, plugin]), /parent/);
	assert.throws(() => assertSameStack(stack(), recovered()), /changed/);
	// Shape captured from the actual installed Stream Deck command line:
	// mixed slashes, unquoted no-space paths, and escaped JSON after -info.
	const liveCommand = `${plugin.ExecutablePath}  --no-global-search-paths --enable-source-maps ${config.installedScript.replace("\\bin\\", "\\bin/")} -port 28196 -pluginUUID example -registerEvent registerPlugin -info "{\\"application\\":{\\"font\\":\\"Segoe UI\\"}}"`;
	assert.equal(stack([host, { ...plugin, CommandLine: liveCommand }]).plugin.ProcessId, 20);
});

test("ready source evidence must belong to the current plugin lifetime", () => {
	const current = { ...plugin, CreatedTicks: (BigInt(Date.parse("2026-09-21T00:00:00.000Z")) * 10000n + 621355968000000000n).toString() };
	assert.doesNotThrow(() => assertSharedMemoryReady(goodLogs, current));
	assert.throws(() => assertSharedMemoryReady(goodLogs.map((line) => line.replace("2026-09-21", "2026-09-20")), current), /ready/);
	for (const ending of ["Stopped (no visible actions)", "HWiNFO unavailable [busy]", "Opened HWiNFO data source: gadget", "Started (1000 ms interval)"]) {
		assert.throws(() => assertSharedMemoryReady([...goodLogs, `2026-09-21T00:00:01.000Z INFO  HwinfoPoller: ${ending}`], current), /ready/);
	}
});

test("restarts reject ERRORs, wrong source and wrong lifetime transitions", async () => {
	for (const role of ["plugin", "host"]) {
		for (const [lines, after, expected] of [
			[goodLogs, recovered(role), "PASS"],
			[[...goodLogs, "2026-09-21T00:00:00.200Z ERROR Unexpected poll failure"], recovered(role), "FAIL"],
			[goodLogs.map((line) => line.replace("shared-memory", "gadget")), recovered(role), "FAIL"],
			[[...goodLogs, "2026-09-21T00:00:01.000Z WARN  HwinfoPoller: HWiNFO unavailable [busy]"], recovered(role), "FAIL"],
			[[...goodLogs, "2026-09-21T00:00:01.000Z INFO  HwinfoPoller: Stopped (no visible actions)"], recovered(role), "FAIL"],
			[[...goodLogs, "2026-09-21T00:00:01.000Z INFO  HwinfoPoller: Opened HWiNFO data source: gadget"], recovered(role), "FAIL"],
			[goodLogs, { ...recovered(role), plugin: { ...recovered(role).plugin, CreatedTicks: (BigInt(Date.parse("2026-09-21T00:00:02.000Z")) * 10000n + 621355968000000000n).toString() } }, "FAIL"],
			[goodLogs, stack(), "FAIL"]
		]) {
			const calls = [];
			let sample = 0;
			const result = await restartEvent(role, {
				snapshot: async () => sample++ === 0 ? stack() : after,
				stop: async (before, target) => { assert.equal(before.plugin.ProcessId, 20); calls.push(target); },
				startHost: async () => calls.push("start"),
				collectRecovery: async () => lines
			});
			assert.equal(result.verdict, expected);
			assert.deepEqual(calls, role === "host" ? ["host", "start"] : ["plugin"]);
		}
	}
	const result = await restartEvent("plugin", { snapshot: (() => { let n = 0; return async () => n++ ? recovered("host") : stack(); })(), stop: async () => {}, collectRecovery: async () => goodLogs });
	assert.equal(result.verdict, "FAIL");
	let stopped = false;
	await assert.rejects(restartEvent("plugin", { snapshot: async () => stack([host]), stop: async () => { stopped = true; } }), /found 0/);
	assert.equal(stopped, false);
});

test("rotated final ERROR and intermediate restart logs remain in recovery evidence", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soak-adversary-log-"));
	const active = path.join(dir, "plugin.0.log");
	try {
		fs.writeFileSync(active, "old baseline\n");
		const tail = makeEventLogTail(dir);
		assert.deepEqual(tail(), []);
		fs.appendFileSync(active, "ERROR before restart\n");
		fs.renameSync(active, path.join(dir, "plugin.2.log"));
		fs.writeFileSync(path.join(dir, "plugin.1.log"), "ERROR second restart\n");
		fs.writeFileSync(active, goodLogs.join("\n") + "\n");
		const lines = tail();
		assert(lines.includes("ERROR before restart"));
		assert(lines.includes("ERROR second restart"));
		assert.deepEqual(tail(), []);
		let sample = 0;
		const result = await restartEvent("plugin", { snapshot: async () => sample++ ? recovered() : stack(), stop: async () => {}, collectRecovery: async () => lines });
		assert.equal(result.verdict, "FAIL");
		fs.appendFileSync(active, "ERROR split");
		assert.deepEqual(tail(), []);
		fs.appendFileSync(active, " message\n");
		assert.deepEqual(tail(), ["ERROR split message"]);
		fs.unlinkSync(active);
		assert.throws(() => tail(), /lost the active tail/);
	} finally { removeLogFixture(dir); }
});

test("rotation between stat and open and short reads fail closed without skipping evidence", () => {
	for (const race of ["rotate", "short-read"]) {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soak-adversary-log-"));
		const active = path.join(dir, "plugin.0.log");
		const realOpen = fs.openSync;
		const realRead = fs.readSync;
		try {
			fs.writeFileSync(active, "baseline\n");
			const tail = makeEventLogTail(dir);
			tail();
			fs.appendFileSync(active, "ERROR pre-rotation evidence\n");
			if (race === "rotate") {
				let changed = false;
				fs.openSync = (file, ...args) => {
					if (file === active && !changed) {
						changed = true;
						fs.renameSync(active, path.join(dir, "plugin.1.log"));
						fs.writeFileSync(active, "INFO restarted\n");
					}
					return realOpen(file, ...args);
				};
			} else {
				fs.readSync = (fd, buffer, offset, length, position) => realRead(fd, buffer, offset, length - 1, position);
			}
			assert.throws(() => tail(), /fault evidence incomplete/);
			fs.openSync = realOpen;
			fs.readSync = realRead;
			assert(tail().includes("ERROR pre-rotation evidence"));
		} finally {
			fs.openSync = realOpen;
			fs.readSync = realRead;
			removeLogFixture(dir);
		}
	}
});

test("host launch is hidden and stop commands refuse identities with missing creation evidence", () => {
	assert.match(startHostCommand(config.hostImage), /-WindowStyle Hidden/);
	assert.throws(() => stopIdentityCommand({ ...plugin, CreatedTicks: null }), /unverified/);
});

test("native stop guard rejects reused identity and preserves an owned same-image bystander", { skip: process.platform !== "win32", timeout: 30_000 }, async () => {
	const owned = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true, stdio: "ignore" });
	const bystander = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true, stdio: "ignore" });
	try {
		await Promise.all([once(owned, "spawn"), once(bystander, "spawn")]);
		const run = (command) => execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8", windowsHide: true, timeout: 15_000, stdio: ["ignore", "pipe", "pipe"] });
		const target = JSON.parse(run(`Get-CimInstance Win32_Process -Filter 'ProcessId=${owned.pid}' | Select-Object ProcessId,SessionId,ExecutablePath,@{Name='CreatedTicks';Expression={$_.CreationDate.ToUniversalTime().Ticks.ToString()}} | ConvertTo-Json -Compress`));
		assert.throws(() => run(stopIdentityCommand({ ...target, CreatedTicks: (BigInt(target.CreatedTicks) + 10_000_000n).toString() })));
		assert.equal(owned.exitCode, null);
		assert.match(run(stopIdentityCommand(target)), /stopped-verified-identity/);
		if (owned.exitCode === null) await once(owned, "exit");
		assert.equal(bystander.exitCode, null);
		assert.doesNotThrow(() => process.kill(bystander.pid, 0));
	} finally {
		for (const child of [owned, bystander]) {
			if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, "exit"); }
		}
	}
});
