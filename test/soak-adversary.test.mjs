import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { assertSameStack, assertSharedMemoryReady, makeEventLogTail, restartEvent, selectInstalledStack, startHostCommand, stopIdentityCommand } from "../scripts/lib/soak-adversary-safety.mjs";
import { candidateNativeContract, createInstalledProducerCheck, runWithAdvancingProducer, sampleAdvancingProducer } from "../scripts/lib/soak-producer-freshness.mjs";

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

function producerFixture(stamps, { copied, readError, closeError, lateRead = false, lateSleep = false } = {}) {
	const epochMs = 1_800_000_000_000;
	let elapsed = 0;
	let reads = 0;
	let closes = 0;
	const open = () => ({
		byteLength: 44,
		readInto(bytes) {
			const index = reads++;
			if (readError) throw readError;
			if (lateRead && index === 1) elapsed += 3000;
			const stamp = stamps[Math.min(index, stamps.length - 1)];
			if (stamp !== undefined) bytes.writeBigInt64LE(BigInt(stamp), 12);
			return copied?.[index] ?? 44;
		},
		close() { closes++; if (closeError) throw closeError; }
	});
	return { open, counts: () => ({ reads, closes }), sampling: {
		monotonicNow: () => elapsed, wallNow: () => epochMs + elapsed,
		wait: async (ms) => { elapsed += lateSleep ? 3000 : ms; }, timeoutMs: 2000, intervalMs: 500
	} };
}

test("producer proof requires two advancing fresh full reads and closes its session", async () => {
	const advancing = producerFixture([1_799_999_998, 1_799_999_999]);
	const proof = await sampleAdvancingProducer(advancing.open, advancing.sampling);
	assert.equal(proof.verdict, "advancing-shared-memory");
	assert.equal(proof.samples.length, 2);
	assert(proof.samples[1].pollTime > proof.samples[0].pollTime);
	assert.deepEqual(advancing.counts(), { reads: 2, closes: 1 });
	const frozen = producerFixture([1_799_999_998]);
	await assert.rejects(sampleAdvancingProducer(frozen.open, frozen.sampling), /monotonic freshness deadline/);
	assert.deepEqual(frozen.counts(), { reads: 4, closes: 1 });
});

test("busy, partial, invalid, stale, future, backwards and error samples fail closed", async () => {
	const cases = [
		[[1_799_999_998], { copied: [0] }, /busy or incomplete/],
		[[1_799_999_998, undefined], { copied: [44, 43] }, /busy or incomplete/],
		[[0], {}, /Invalid producer/], [[-1], {}, /Invalid producer/],
		[[9007199254740992n], {}, /Invalid producer/],
		[[1_799_999_800], {}, /stale/], [[1_800_000_001], {}, /future/],
		[[1_799_999_999, 1_799_999_998], {}, /backwards/],
		[[1_799_999_998], { readError: new Error("native read failed") }, /native read failed/]
	];
	for (const [stamps, options, expected] of cases) {
		const fixture = producerFixture(stamps, options);
		await assert.rejects(sampleAdvancingProducer(fixture.open, fixture.sampling), expected);
		assert.equal(fixture.counts().closes, 1);
	}
	await assert.rejects(sampleAdvancingProducer(() => { throw new Error("native open failed"); }), /native open failed/);
	const badClose = producerFixture([1_799_999_998, 1_799_999_999], { closeError: new Error("close failed") });
	await assert.rejects(sampleAdvancingProducer(badClose.open, badClose.sampling), /session close failed/);
	assert.equal(badClose.counts().closes, 1);
});

test("an advancing read after the monotonic deadline never rescues an expired proof", async () => {
	for (const option of [{ lateRead: true }, { lateSleep: true }]) {
		const fixture = producerFixture([1_799_999_998, 1_799_999_999], option);
		await assert.rejects(sampleAdvancingProducer(fixture.open, fixture.sampling), /monotonic freshness deadline/);
		assert.equal(fixture.counts().closes, 1);
	}
});

test("installed producer loader checks exact hash, native source and protocol before opening", async () => {
	const bytes = Buffer.from("exact installed addon fixture");
	const digest = createHash("sha256").update(bytes).digest("hex");
	const expectedBuild = { protocolVersion: 1, napiVersion: 8, architecture: "x64", nativeVersion: "1.1.0", nativeSourceId: "1234567890abcdef" };
	const addonPath = path.resolve("installed-fixture", "hwsm.node");
	for (const changed of [null, { protocolVersion: 2 }, { napiVersion: 9 }, { architecture: "x86" }, { nativeSourceId: "unset" }, { nativeVersion: "0.0.0" }, "hash"]) {
		let opened = 0;
		let loaded = 0;
		const fixture = producerFixture([1_799_999_998, 1_799_999_999]);
		const check = createInstalledProducerCheck({ addonPath, expectedSha256: digest, expectedBuild, ...fixture.sampling,
			readBytes: (file) => { assert.equal(file, addonPath); return changed === "hash" ? Buffer.from("different") : bytes; },
			loadAddon: (file) => {
				loaded++; assert.equal(file, addonPath);
				return { getBuildInfo: () => ({ ...expectedBuild, ...(typeof changed === "object" ? changed : {}) }),
					openGadgetKey() {}, openSharedMemory(mapping, mutex) {
						opened++; assert.equal(mapping, "Global\\HWiNFO_SENS_SM2"); assert.equal(mutex, "Global\\HWiNFO_SM2_MUTEX");
						return fixture.open();
					} };
			}
		});
		if (changed === null) { assert.equal((await check()).addonSha256, digest); assert.equal(opened, 1); }
		else { await assert.rejects(check()); assert.equal(opened, 0); }
		if (changed === "hash") assert.equal(loaded, 0);
	}
});

test("production event gate refuses frozen preflight and rejects frozen recovery", async () => {
	let calls = 0;
	await assert.rejects(runWithAdvancingProducer(async () => { calls++; }, async () => { throw new Error("frozen"); }), /frozen/);
	assert.equal(calls, 0);
	for (const eventThrows of [false, true]) {
		let checks = 0;
		const result = await runWithAdvancingProducer(async () => {
			calls++; if (eventThrows) throw new Error("event failed");
			return { verdict: "PASS", detail: "healthy stock log", lines: goodLogs };
		}, async () => { if (++checks === 2) throw new Error("frozen recovery"); return { verdict: "advancing-shared-memory" }; });
		assert.equal(checks, 2);
		assert.equal(result.verdict, "FAIL");
		assert.match(result.detail, /frozen recovery/);
	}
	let checks = 0;
	const result = await runWithAdvancingProducer(async () => ({ verdict: "PASS", lines: [] }), async () => ({ sample: ++checks }));
	assert.equal(result.verdict, "PASS");
	assert.deepEqual(result.producerFreshness, { before: { sample: 1 }, after: { sample: 2 } });
});

test("candidate contract and production entrypoint retain the mandatory producer gate", () => {
	const repoRoot = fileURLToPath(new URL("..", import.meta.url));
	const contract = candidateNativeContract(repoRoot);
	assert.equal(contract.protocolVersion, 1);
	assert.equal(contract.napiVersion, 8);
	assert.match(contract.nativeSourceId, /^[a-f0-9]{16}$/);
	const source = fs.readFileSync(path.join(repoRoot, "scripts", "soak-adversary.mjs"), "utf8");
	assert.match(source, /producerBaseline = await checkProducer\(\)/);
	assert.match(source, /runWithAdvancingProducer\(\(\) => ev\.run\(pollLogs\), checkProducer\)/);
	assert.equal(source.match(/ev\.run\(/g)?.length, 1);
});
