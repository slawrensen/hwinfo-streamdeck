import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../scripts/hygiene.mjs", import.meta.url), "utf8");
const start = source.indexOf("async function runPiCapture() {");
const end = source.indexOf("\nconst before = processSnapshot();", start);
assert.ok(start >= 0 && end > start, "the regression must execute the production capture function");
const capture = source.slice(start, end);

async function inspectStartup(mode) {
	const captures = [];
	const fetches = [];
	const writes = [];
	const launches = [];
	let attempts = 0;
	const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, stdout: new EventEmitter(), stdin: new EventEmitter() });
	const exit = (code) => { child.exitCode = code; child.emit("exit", code); };
	child.stdin.write = (value) => { writes.push(value); exit(0); };
	child.kill = () => exit(1);
	let failure;
	try {
		await vm.runInNewContext(`${capture}\nrunPiCapture()`, {
			path, repoRoot: "fixture-root", outRoot: "fixture-output",
			console: { log() {}, error() {} },
			process: { execPath: "node", stdout: { write() {} } },
			spawn: (...args) => { launches.push(args); return child; },
			observeOwned() {},
			run: async (...args) => { captures.push(args); },
			fetch: async (url) => { fetches.push(url); return { ok: true }; },
			sleep: async (ms) => {
				if (ms !== 500) return;
				attempts++;
				if (attempts === 1) {
					if (mode === "exit") exit(1);
					if (mode === "error") child.emit("error", new Error("synthetic harness spawn failure"));
					if (mode === "ready") child.stdout.emit("data", "PI at http://127.0.0.1:");
					if (mode === "ready-then-exit") { child.stdout.emit("data", "PI at http://127.0.0.1:28997/ (ws 28996)\n"); exit(1); }
				}
				if (attempts === 2 && mode === "ready") child.stdout.emit("data", "28997/ (ws 28996)\n");
			}
		}, { timeout: 1000 });
	} catch (error) {
		failure = error;
	}
	return { captures, fetches, writes, launches, failure };
}

test("suite PI capture rejects an exited own harness despite a responsive unrelated endpoint", async () => {
	for (const mode of ["exit", "ready-then-exit"]) {
		const result = await inspectStartup(mode);
		assert.match(String(result.failure), /pi-harness exited/);
		assert.deepEqual(result.captures, []);
		assert.deepEqual(result.fetches, []);
		assert.deepEqual(result.writes, [], "never write shutdown to an already exited child");
	}
});

test("suite PI capture requires its own listen marker instead of a responsive foreign endpoint", async () => {
	const result = await inspectStartup("silent");
	assert.match(String(result.failure), /pi-harness never came up/);
	assert.deepEqual(result.captures, []);
	assert.deepEqual(result.fetches, []);
});

test("suite PI capture fails on a spawn error without adopting any endpoint", async () => {
	const result = await inspectStartup("error");
	assert.match(String(result.failure), /synthetic harness spawn failure/);
	assert.deepEqual(result.captures, []);
	assert.deepEqual(result.fetches, []);
	assert.deepEqual(result.writes, []);
});

test("suite PI capture starts only after the owned harness listen marker and shuts it down", async () => {
	const result = await inspectStartup("ready");
	assert.equal(result.failure, undefined);
	assert.equal(result.captures.length, 1);
	assert.equal(result.captures[0][0], "capture-pi");
	assert.deepEqual(result.fetches, []);
	assert.deepEqual(result.writes, ["exit\n"]);
	assert.equal(result.launches[0][2].stdio[1], "pipe");
});
