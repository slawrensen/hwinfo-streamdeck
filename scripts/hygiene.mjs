// Full-suite runner with orphan detection: snapshots node/chrome processes,
// runs every process-spawning suite (e2e ×3, contact-sheet, marketplace
// shots, pi-harness + capture-pi), snapshots again, and FAILS if any process
// spawned during the run is still alive — fake-hwinfo, plugin instances,
// headless chrome, anything. Run with `npm run suite:full`.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyNewProcesses, ownedDescendants, processIdentity, processSnapshot, terminateProcesses } from "./lib/process-ownership.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "hwinfo-suite-"));
const browserRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hwinfo-suite-browser-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Snapshots only at launch/step boundaries, never a busy background poll.
 * Retain full identities so exited parents and recycled PIDs stay distinct. */
function observeOwned() {
	const rows = processSnapshot();
	for (const row of ownedDescendants(rows, new Set(recorded.keys()))) recorded.set(processIdentity(row), row);
	return rows;
}

function run(name, args, opts = {}) {
	console.log(`\n=== ${name} ===`);
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, args, { cwd: repoRoot, stdio: ["ignore", "inherit", "inherit"], ...opts, env: { ...process.env, ...opts.env, HWSM_TEST_BROWSER_ROOT: browserRoot } });
		child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${name} exited with code ${code}`))));
		child.on("error", reject);
		observeOwned();
	});
}

/** `npm run test:native` as node arguments. package.json owns the command
 * (CI runs that script), so this suite cannot drift from it: a hand-copied
 * file list here once left test/native-manifest.test.ts out of the run. */
function nativeTestArgs() {
	const script = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).scripts?.["test:native"] ?? "";
	const [runner, ...rest] = script.split(/\s+/).filter((token) => token.length > 0);
	if (runner !== "tsx" || !rest.some((token) => /^test\/.+\.test\.ts$/.test(token))) {
		throw new Error(`package.json test:native is not a "tsx --test <files>" script: ${script}`);
	}
	return ["--import", "tsx", ...rest];
}

/** pi-harness (long-running server) + capture-pi, with graceful stdin exit. */
async function runPiCapture() {
	console.log("\n=== pi-harness + capture-pi ===");
	const harness = spawn(process.execPath, ["scripts/pi-harness.mjs"], { cwd: repoRoot, stdio: ["pipe", "pipe", "inherit"] });
	let harnessOutput = "";
	let harnessError;
	let harnessExited = false;
	harness.stdout.on("data", (chunk) => {
		harnessOutput = (harnessOutput + chunk.toString()).slice(-4096);
		process.stdout.write(chunk);
	});
	harness.once("error", (error) => { harnessError = error; });
	const exited = new Promise((resolve) => harness.once("exit", (code) => { harnessExited = true; resolve(code); }));
	try {
		observeOwned();
		let up = false;
		for (let i = 0; i < 40 && !up; i++) {
			await sleep(500);
			if (harnessError) throw harnessError;
			if (harnessExited || harness.exitCode !== null || harness.signalCode !== null) throw new Error(`pi-harness exited before capture: ${harness.exitCode}`);
			// Only our child's successful listen callback establishes ownership.
			// A HTTP response could come from an unrelated harness on this port.
			up = harnessOutput.includes("PI at http://127.0.0.1:28997/");
		}
		if (!up) {
			throw new Error("pi-harness never came up on :28997");
		}
		await run("capture-pi", ["scripts/capture-pi.mjs", path.join(outRoot, "pi")]);
	} finally {
		if (!harnessError && !harnessExited) {
			// Exit can race the shutdown write. The exit deadline still applies
			// if stdin closes without the owned child actually stopping.
			harness.stdin.once("error", () => {});
			harness.stdin.write("exit\n");
			const code = await Promise.race([exited, sleep(5000).then(() => "timeout")]);
			if (code === "timeout") {
				console.error("pi-harness ignored stdin exit; killing (will show as orphan if children leak)");
				harness.kill();
				await Promise.race([exited, sleep(2000)]);
			}
		}
	}
}

const before = processSnapshot();
const root = before.find((row) => row.pid === process.pid);
if (!root) throw new Error("Cannot establish suite process creation identity; refusing to run cleanup-capable suites");
const recorded = new Map([[processIdentity(root), root]]);
const failures = [];
for (const dir of ["pi", "contact", "shots"]) {
	fs.mkdirSync(path.join(outRoot, dir), { recursive: true });
}

const steps = [
	["e2e", () => run("e2e", ["scripts/e2e-harness.mjs"])],
	["e2e:resilience", () => run("e2e:resilience", ["scripts/e2e-resilience.mjs"])],
	["e2e:gadget", () => run("e2e:gadget", ["scripts/e2e-gadget.mjs"])],
	["e2e:gadget-raw", () => run("e2e:gadget-raw", ["scripts/e2e-gadget-raw.mjs", path.join(outRoot, "gadget-raw")])],
	["e2e:reading-links", () => run("e2e:reading-links", ["scripts/e2e-reading-links.mjs", path.join(outRoot, "reading-links")])],
	["e2e:dead-fallback", () => run("e2e:dead-fallback", ["scripts/e2e-dead-fallback.mjs"])],
	["e2e:native-edge", () => run("e2e:native-edge", ["scripts/e2e-native-edge.mjs"])],
	["e2e:load", () => run("e2e:load", ["scripts/e2e-load.mjs"], { env: { ...process.env, LOAD_SOAK_SEC: "45" } })],
	["e2e:drilldown", () => run("e2e:drilldown", ["scripts/e2e-drilldown.mjs"])],
	["e2e:pi", () => run("e2e:pi", ["scripts/e2e-pi-persistence.mjs"])],
	["e2e:socket-close", () => run("e2e:socket-close", ["scripts/e2e-socket-close.mjs"])],
	// After the timing-sensitive UI suites: its 10k-read soak saturates a
	// core, which can flake the frame-timing assertions above.
	// One file at a time: native-hwsm times a mutex-contended open against a
	// 400 ms ceiling and ends on a 10k-read soak, both of which a sibling
	// file running in parallel would skew. The npm script carries that
	// --test-concurrency=1 and the file list; both are read from it.
	["test:native", () => run("test:native", nativeTestArgs())],
	["contact-sheet", () => run("contact-sheet", ["--import", "tsx", "scripts/contact-sheet.mjs", path.join(outRoot, "contact")])],
	["marketplace-shots", () => run("marketplace-shots", ["--import", "tsx", "scripts/marketplace-shots.mjs", path.join(outRoot, "shots")])],
	["pi-capture", runPiCapture]
];
for (const [name, step] of steps) {
	try {
		await step();
	} catch (err) {
		failures.push(`${name}: ${err.message}`);
		console.error(String(err));
	}
	observeOwned();
}

await sleep(1500); // give just-killed trees a moment to reap
const after = observeOwned();
const { owned: orphans, ambiguous, unrelated: bystanders } = classifyNewProcesses(before, after, [...recorded.values()], [repoRoot, browserRoot]);

console.log(`\n=== hygiene ===`);
console.log(`processes before: ${before.length}, after: ${after.length}, new: ${orphans.length + ambiguous.length + bystanders.length} (${orphans.length} ours, ${ambiguous.length} ambiguous, ${bystanders.length} unrelated)`);
for (const o of orphans) {
	console.error(`ORPHAN pid ${o.pid}: ${o.commandLine}`);
}
terminateProcesses(orphans);
for (const o of ambiguous) console.error(`POSSIBLE ORPHAN pid ${o.pid}, ownership unproved; left running: ${o.commandLine}`);

if (failures.length > 0 || orphans.length > 0 || ambiguous.length > 0) {
	console.error(`\nSUITE: FAILED — ${failures.length} step failure(s), ${orphans.length} orphan(s), ${ambiguous.length} possible orphan(s)`);
	for (const f of failures) {
		console.error(`  ${f}`);
	}
	process.exit(1);
}
console.log(`\nSUITE: ALL GREEN, ZERO ORPHANS (artifacts in ${outRoot})`);
