// The canonical software qualification of a checkout: one command, the
// stages in an order that works from a clean clone, every stage reported
// as PASS, FAIL, SKIPPED (not selected) or UNAVAILABLE (a tool the stage
// needs is not installed), a nonzero exit on anything but PASS and SKIPPED,
// and a record of what ran against which bytes. `npm run release:validate`
// runs it whole; CI runs the stages that need the built plugin.
//
//   node scripts/qualify.mjs                       every stage, in order
//   node scripts/qualify.mjs --stages pack,archive  a subset (the rest SKIPPED)
//   node scripts/qualify.mjs --out <dir>            record and logs here
//   node scripts/qualify.mjs --note "<text>"        free text kept in the record
//   node scripts/qualify.mjs --list                 print the stage order
//
// Order, and why: static checks first (cheap, no build); the native addon
// builds before the bundle because `npm run build` vendors it; unit tests
// are pure (they never read release/); the pack stages a copy and validates
// the archive; the archive stage validates it again explicitly, extracts it
// into the record directory and holds every member to the staging copy;
// ABI and recovery then run on THOSE extracted bytes, never on the checkout;
// the copy validator, the native packaging gate and `streamdeck validate`
// close. A missing or stale archive fails the archive stage; nothing here
// falls back to an older artifact. Tracked files must be unchanged at the
// end, or the run fails: qualification is not allowed to edit its inputs.
//
// Prerequisites: Node 20+, `npm ci` done, the MSVC toolset node-gyp expects,
// and the Elgato CLI (`npm i -g @elgato/cli@1.7.4`, the version release.yml
// pins). The record lands under release/ (gitignored) and is never read by
// any build step.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGIN_ROOT, SHIPPED_MEMBERS } from "./lib/pack-contract.mjs";
import { listZip, readZipEntry } from "./lib/zip.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => {
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : undefined;
};
const isWin = process.platform === "win32";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const archivePath = path.join(repoRoot, "release", "com.lawrensen.hwinfo.streamDeckPlugin");
const stagingDir = path.join(repoRoot, PLUGIN_ROOT);

const STAGE_IDS = ["prerequisites", "lint", "typecheck", "build:native", "build", "unit", "native", "pack", "archive", "abi", "recovery", "native-gate", "cli-validate", "copy", "tree"];
if (args.includes("--list")) {
	console.log(STAGE_IDS.join("\n"));
	process.exit(0);
}
const selected = option("--stages")?.split(",").map((s) => s.trim()).filter(Boolean) ?? STAGE_IDS;
for (const id of selected) {
	if (!STAGE_IDS.includes(id)) {
		console.error(`qualify: unknown stage "${id}"; stages are ${STAGE_IDS.join(", ")}`);
		process.exit(3);
	}
}

const git = (...a) => {
	const r = spawnSync("git", a, { cwd: repoRoot, encoding: "utf8" });
	return r.status === 0 ? r.stdout.trim() : "";
};
const sourceSha = git("rev-parse", "HEAD");
const dirtyBefore = git("status", "--porcelain");
const startedAt = new Date();
const stamp = startedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const outDir = path.resolve(option("--out") ?? path.join(repoRoot, "release", `qualification-${pkg.version}`, `${sourceSha.slice(0, 7)}-${stamp}`));
fs.mkdirSync(outDir, { recursive: true });
const extractedDir = path.join(outDir, "extracted");

/** A tool on PATH, resolved the way a shell would; undefined when absent. */
function tool(name) {
	const r = spawnSync(isWin ? "where.exe" : "which", [name], { encoding: "utf8" });
	return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : undefined;
}
// The release-copy validator needs the private release docs, which the
// public repository does not carry (they are mirrored separately and
// restored into the maintainer's checkout); without them that stage is
// UNAVAILABLE, not PASS, and the run is not a release qualification.
const PRIVATE_DOCS = ["MARKETPLACE.md", "docs/release/RELEASE_RUNBOOK.md", "docs/release/STREAM_DECK_MARKETPLACE.md", "docs/release/COPY_RULES.md"];
const tools = {
	streamdeck: tool(isWin ? "streamdeck.cmd" : "streamdeck"),
	nodeGyp: fs.existsSync(path.join(repoRoot, "node_modules", ".bin", isWin ? "node-gyp.cmd" : "node-gyp")) ? "node_modules/.bin/node-gyp" : undefined,
	privateDocs: PRIVATE_DOCS.every((rel) => fs.existsSync(path.join(repoRoot, rel))) ? "present" : undefined
};

/** Runs a command line through the shell (npm and the CLI are .cmd shims on
 * Windows, which Node runs only that way) or a node script directly. */
function exec(line, { env = {}, node = false } = {}) {
	const r = node
		? spawnSync(process.execPath, line, { cwd: repoRoot, encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 })
		: spawnSync(line, { cwd: repoRoot, encoding: "utf8", env: { ...process.env, ...env }, shell: true, maxBuffer: 64 * 1024 * 1024 });
	const output = `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? `\n${r.error.message}` : ""}`;
	return { ok: r.status === 0, status: r.status ?? `signal ${r.signal}`, output };
}

const record = {
	version: pkg.version,
	sourceSha,
	dirtyBefore: dirtyBefore.split("\n").filter(Boolean),
	attributable: dirtyBefore === "",
	startedAt: startedAt.toISOString(),
	node: process.version,
	os: `${os.platform()} ${os.release()}`,
	tools,
	note: option("--note") ?? "",
	stages: [],
	artifact: null,
	payload: null,
	members: [],
	abi: null,
	recovery: []
};

const canonicalJson = (text) => {
	const sort = (v) => (Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
	return JSON.stringify(sort(JSON.parse(text)));
};

const stages = {
	prerequisites() {
		const problems = [];
		if (Number(process.versions.node.split(".")[0]) < 20) problems.push(`Node ${process.version} is below the Node 20 host contract`);
		if (!fs.existsSync(path.join(repoRoot, "node_modules", ".package-lock.json"))) problems.push("node_modules is not an `npm ci` install (node_modules/.package-lock.json missing)");
		if (!sourceSha) problems.push("not a git checkout");
		const lines = [`node ${process.version}`, `streamdeck CLI: ${tools.streamdeck ?? "NOT FOUND (npm i -g @elgato/cli@1.7.4)"}`, `node-gyp: ${tools.nodeGyp ?? "NOT FOUND (npm ci)"}`, `private release docs: ${tools.privateDocs ?? "NOT PRESENT (restore MARKETPLACE.md and docs/release/ from the private mirror; the copy stage will be UNAVAILABLE)"}`, `source ${sourceSha}${record.attributable ? "" : ` DIRTY (${record.dirtyBefore.length} paths): this run is not attributable to the SHA alone`}`];
		return { ok: problems.length === 0, output: [...lines, ...problems].join("\n") };
	},
	lint: () => exec("npm run -s lint"),
	typecheck: () => exec("npm run -s typecheck"),
	"build:native": () => (tools.nodeGyp ? exec("npm run -s build:native") : { unavailable: "node-gyp" }),
	build: () => exec("npm run -s build"),
	unit: () => exec("npm test"),
	native: () => exec("npm run -s test:native"),
	pack: () => (tools.streamdeck ? exec("npm run -s pack") : { unavailable: "streamdeck CLI" }),
	archive() {
		// Explicit validation of the file that exists NOW (not the pack's own
		// pass): a missing archive fails here with the remedy, a stale one
		// fails on payload drift, and only a validated archive is extracted.
		const validated = exec(["scripts/validate-pack.mjs", archivePath], { node: true });
		if (!validated.ok) return validated;
		const bytes = fs.readFileSync(archivePath);
		record.artifact = { path: path.relative(repoRoot, archivePath), bytes: bytes.length, sha256: sha256(bytes) };
		fs.rmSync(extractedDir, { recursive: true, force: true });
		fs.mkdirSync(extractedDir, { recursive: true });
		const { entries, problems } = listZip(bytes);
		if (problems.length > 0) return { ok: false, output: `${validated.output}\narchive: ${problems.join("; ")}` };
		const drift = [];
		for (const entry of entries) {
			if (entry.name.endsWith("/")) continue;
			if (entry.name.includes("..") || path.isAbsolute(entry.name) || !entry.name.startsWith(`${PLUGIN_ROOT}/`)) return { ok: false, output: `${validated.output}\nunsafe member name ${entry.name}` };
			const data = readZipEntry(bytes, entry);
			const target = path.join(extractedDir, entry.name);
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.writeFileSync(target, data);
			const staged = fs.readFileSync(path.join(repoRoot, entry.name));
			const same = entry.name === `${PLUGIN_ROOT}/manifest.json` ? canonicalJson(data.toString("utf8")) === canonicalJson(staged.toString("utf8")) : data.equals(staged);
			if (!same) drift.push(entry.name);
			record.members.push({ name: entry.name, bytes: data.length, sha256: sha256(data) });
		}
		record.members.sort((a, b) => a.name.localeCompare(b.name));
		const expected = SHIPPED_MEMBERS.map((m) => `${PLUGIN_ROOT}/${m}`).sort();
		const got = record.members.map((m) => m.name).sort();
		const inventoryOk = JSON.stringify(expected) === JSON.stringify(got);
		const member = (rel) => record.members.find((m) => m.name === `${PLUGIN_ROOT}/${rel}`);
		record.payload = { "bin/plugin.js": member("bin/plugin.js")?.sha256 ?? null, "bin/hwsm.node": member("bin/hwsm.node")?.sha256 ?? null, "manifest.json": member("manifest.json")?.sha256 ?? null };
		const lines = [validated.output.trim(), `extracted ${record.members.length} members to ${path.relative(repoRoot, extractedDir)}`, `inventory ${inventoryOk ? "matches" : "DOES NOT MATCH"} the shipping contract (${expected.length} members)`, ...drift.map((name) => `extracted member differs from the staging copy: ${name}`)];
		return { ok: inventoryOk && drift.length === 0, output: lines.join("\n") };
	},
	abi() {
		const addon = path.join(extractedDir, PLUGIN_ROOT, "bin", "hwsm.node");
		if (!fs.existsSync(addon)) return { ok: false, output: "no extracted addon: the archive stage must pass first" };
		const r = exec(["scripts/abi-check.mjs", addon], { node: true });
		record.abi = /ABI-CHECK PASS.*$/m.exec(r.output)?.[0] ?? null;
		return r;
	},
	recovery() {
		const dir = path.join(extractedDir, PLUGIN_ROOT);
		if (!fs.existsSync(path.join(dir, "bin", "plugin.js"))) return { ok: false, output: "no extracted plugin: the archive stage must pass first" };
		const r = exec(["scripts/e2e-resilience.mjs"], { node: true, env: { HWINFO_E2E_PLUGIN_DIR: dir } });
		record.recovery = [...r.output.matchAll(/^PLUGIN BYTES .*$/gm)].map((m) => m[0]);
		return r;
	},
	copy: () => (tools.privateDocs ? exec(["scripts/validate-release-copy.mjs"], { node: true }) : { unavailable: "private release docs" }),
	"native-gate": () => exec(["scripts/validate-native.mjs"], { node: true }),
	"cli-validate": () => (tools.streamdeck ? exec(`streamdeck${isWin ? ".cmd" : ""} validate "${stagingDir}"`) : { unavailable: "streamdeck CLI" }),
	tree() {
		// The record directory is this run's own output; when it sits inside
		// the checkout (CI keeps it next to the sources) it is untracked and
		// not an input, so it is the one new path the check ignores.
		const relOut = path.relative(repoRoot, outDir).split(path.sep).join("/");
		const ownRecord = (line) => {
			const p = line.slice(3).trim().replace(/^"|"$/g, "").replace(/\/$/, "");
			return relOut !== "" && !relOut.startsWith("..") && (relOut === p || relOut.startsWith(`${p}/`) || p.startsWith(`${relOut}/`));
		};
		const after = git("status", "--porcelain");
		const changed = after.split("\n").filter((line) => line && !dirtyBefore.split("\n").includes(line) && !ownRecord(line));
		return { ok: changed.length === 0, output: changed.length === 0 ? "tracked inputs unchanged" : `the run changed tracked inputs:\n${changed.join("\n")}` };
	}
};

let failed = false;
let unavailable = false;
STAGE_IDS.forEach((id, index) => {
	const logFile = path.join(outDir, `${String(index + 1).padStart(2, "0")}-${id.replace(/[^a-z-]/g, "-")}.log`);
	if (!selected.includes(id)) {
		record.stages.push({ id, status: "SKIPPED", reason: "not selected" });
		console.log(`SKIPPED     ${id}`);
		return;
	}
	if ((failed || unavailable) && !["tree"].includes(id)) {
		record.stages.push({ id, status: "SKIPPED", reason: "an earlier stage did not pass" });
		console.log(`SKIPPED     ${id} (an earlier stage did not pass)`);
		return;
	}
	const t0 = Date.now();
	const result = stages[id]();
	const seconds = Number(((Date.now() - t0) / 1000).toFixed(1));
	const status = result.unavailable ? "UNAVAILABLE" : result.ok ? "PASS" : "FAIL";
	fs.writeFileSync(logFile, result.output ?? `${status}: ${result.unavailable ?? ""}\n`);
	record.stages.push({ id, status, seconds, log: path.basename(logFile), ...(result.unavailable ? { missing: result.unavailable } : {}) });
	console.log(`${status.padEnd(11)} ${id} (${seconds}s)${result.unavailable ? `: ${result.unavailable} is not installed` : ""}`);
	if (status === "FAIL") {
		failed = true;
		console.error((result.output ?? "").trim().split("\n").slice(-25).join("\n"));
	}
	if (status === "UNAVAILABLE") unavailable = true;
});

record.finishedAt = new Date().toISOString();
record.verdict = failed ? "FAIL" : unavailable ? "UNAVAILABLE" : "PASS";
fs.writeFileSync(path.join(outDir, "record.json"), `${JSON.stringify(record, null, "\t")}\n`);
const md = [
	`# Software qualification ${pkg.version} at ${sourceSha}`,
	"",
	`Verdict **${record.verdict}**, ${record.startedAt} to ${record.finishedAt}, ${record.node} on ${record.os}. Command: \`node scripts/qualify.mjs${option("--stages") ? ` --stages ${option("--stages")}` : ""}\`.`,
	record.attributable ? "Tree clean before the run." : `**Tree dirty before the run** (${record.dirtyBefore.length} paths); this record is not attributable to the SHA alone.`,
	record.note ? `Note: ${record.note}` : "",
	"",
	"| Stage | Status | Seconds | Log |",
	"|---|---|---|---|",
	...record.stages.map((s) => `| ${s.id} | ${s.status}${s.missing ? ` (${s.missing})` : ""}${s.reason ? ` (${s.reason})` : ""} | ${s.seconds ?? ""} | ${s.log ?? ""} |`),
	"",
	record.artifact ? `Artifact \`${record.artifact.path}\`, ${record.artifact.bytes} bytes, sha256 \`${record.artifact.sha256}\`.` : "No artifact recorded (the archive stage did not run or did not pass).",
	record.payload ? `Payload: bin/plugin.js \`${record.payload["bin/plugin.js"]}\`, bin/hwsm.node \`${record.payload["bin/hwsm.node"]}\`, manifest.json \`${record.payload["manifest.json"]}\`. Full member inventory in record.json (${record.members.length} members).` : "",
	record.abi ? `ABI on the extracted addon: ${record.abi}` : "",
	...record.recovery.map((line) => `Recovery exercised: ${line}`),
	"",
	"Not attested by this record or by ordinary CI: the browser and capture suite (`npm run suite:full`), installation through the Stream Deck app, and hardware endurance. Archive container bytes are not reproducible (the packer writes timestamps); payload members are compared byte for byte."
].filter((line) => line !== undefined).join("\n");
fs.writeFileSync(path.join(outDir, `QUALIFICATION-${sourceSha.slice(0, 7)}.md`), `${md}\n`);
console.log(`\nQUALIFICATION ${record.verdict}: ${path.relative(repoRoot, outDir)}`);
process.exit(failed ? 1 : unavailable ? 2 : 0);
