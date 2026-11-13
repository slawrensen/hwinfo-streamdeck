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
//   node scripts/qualify.mjs --native <dir> --native-manifest <json>
//        qualify a release's exact native binary (hwsm.node in <dir>,
//        e.g. the CI artifact or the files of a draft's pack) instead of
//        a local build: the build stage vendors it (HWSM_VENDOR with the
//        hash <json> records), the pack and the gates hold it to <json>
//        (HWSM_NATIVE_MANIFEST), and the native gate requires a Valid,
//        timestamped signature when <json> records one
//
// Order, and why: static checks first (cheap, no build); the native addons
// build before the bundle because `npm run build` vendors them, and the
// toolchain stage records what compiled them (scripts/native-toolchain.mjs,
// record-only: a local toolset differs from the release runner's, so local
// native bytes are not release bytes and the record says which inputs
// differ); the native-identity stage records which native bytes bin/ holds
// (a local build, or with --native the release's files, held to their
// manifest); the bundle stage re-runs the production rollup configuration
// in memory, holds it to bin/plugin.js byte for byte and fails on zod or on
// a package NOTICE.md does not license (scripts/bundle-inventory.mjs); unit
// tests are pure (they never read release/); the pack stages a copy and validates
// the archive; the archive stage validates it again explicitly, extracts it
// into the record directory and holds every member to the staging copy;
// ABI and recovery then run on THOSE extracted bytes, never on the
// checkout;
// the copy validator, the native packaging gate and `streamdeck validate`
// close. A missing or stale archive fails the archive stage; nothing here
// falls back to an older artifact. Tracked files must be unchanged at the
// end, or the run fails: qualification is not allowed to edit its inputs.
//
// Prerequisites: Node 20+, `npm ci` done (it installs the Elgato CLI, an
// exact devDependency, which packs and validates from node_modules), and
// the MSVC toolset node-gyp expects. The record lands under release/
// (gitignored) and is never read by any build step.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { elgatoCli, pinnedElgatoCliVersion } from "./lib/elgato-cli.mjs";
import { peLayout } from "./lib/authenticode.mjs";
import { NATIVE_BINARIES } from "./lib/native-binaries.mjs";
import { NATIVE_MEMBERS, PLUGIN_ROOT, SHIPPED_MEMBERS } from "./lib/pack-contract.mjs";
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

const STAGE_IDS = ["prerequisites", "lint", "typecheck", "build:native", "toolchain", "build", "native-identity", "bundle", "unit", "native", "pack", "archive", "abi", "recovery", "native-gate", "cli-validate", "copy", "tree"];
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

// --native <dir> --native-manifest <json>: the release's exact binaries,
// checked before anything runs.
let releaseNative = null;
if (option("--native") !== undefined || option("--native-manifest") !== undefined) {
	const refuse = (message) => {
		console.error(`qualify: ${message}`);
		process.exit(3);
	};
	if (!option("--native") || !option("--native-manifest")) refuse("--native and --native-manifest go together: the directory holding the release's hwsm.node, and the release-native-manifest.json that describes it.");
	const dir = path.resolve(option("--native"));
	const manifestPath = path.resolve(option("--native-manifest"));
	if (!fs.existsSync(manifestPath)) refuse(`--native-manifest ${option("--native-manifest")} not found.`);
	let manifest;
	try {
		manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	} catch (err) {
		refuse(`--native-manifest ${option("--native-manifest")} is not JSON: ${err.message}`);
	}
	if (!Array.isArray(manifest?.binaries)) refuse("--native-manifest is not a version 2 manifest describing every native binary.");
	const binaries = NATIVE_BINARIES.map((binary) => {
		const entry = manifest.binaries.find((candidate) => candidate?.file === binary.file);
		if (entry === undefined || !/^[0-9a-f]{64}$/.test(String(entry.sha256))) refuse(`--native-manifest records no sha256 for ${binary.file}.`);
		const file = path.join(dir, binary.file);
		if (!fs.existsSync(file)) refuse(`--native ${option("--native")} holds no ${binary.file}.`);
		return { binary, file, record: entry };
	});
	releaseNative = { manifestPath, binaries, signed: binaries.some(({ record: entry }) => entry.signature !== null && entry.signature !== undefined) };
	process.env.HWSM_NATIVE_MANIFEST = manifestPath;
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

// The release-copy validator needs the private release docs, which the
// public repository does not carry (they are mirrored separately and
// restored into the maintainer's checkout); without them that stage is
// UNAVAILABLE, not PASS, and the run is not a release qualification.
const PRIVATE_DOCS = ["MARKETPLACE.md", "docs/release/RELEASE_RUNBOOK.md", "docs/release/STREAM_DECK_MARKETPLACE.md", "docs/release/COPY_RULES.md"];
const cli = elgatoCli(repoRoot);
const pinnedCli = pinnedElgatoCliVersion(repoRoot);
const tools = {
	streamdeck: cli !== null && cli.version === pinnedCli ? `node_modules/@elgato/cli ${cli.version}` : undefined,
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
	toolchain: null,
	native: null,
	bundle: null,
	abi: [],
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
		const lines = [`node ${process.version}`, `streamdeck CLI: ${tools.streamdeck ?? (cli === null ? `NOT FOUND (npm ci installs @elgato/cli ${pinnedCli})` : `node_modules holds ${cli.version}, package.json pins ${pinnedCli} (npm ci)`)}`, `node-gyp: ${tools.nodeGyp ?? "NOT FOUND (npm ci)"}`, `private release docs: ${tools.privateDocs ?? "NOT PRESENT (restore MARKETPLACE.md and docs/release/ from the private mirror; the copy stage will be UNAVAILABLE)"}`, `source ${sourceSha}${record.attributable ? "" : ` DIRTY (${record.dirtyBefore.length} paths): this run is not attributable to the SHA alone`}`];
		return { ok: problems.length === 0, output: [...lines, ...problems].join("\n") };
	},
	lint: () => exec("npm run -s lint"),
	typecheck: () => exec("npm run -s typecheck"),
	"build:native": () => (tools.nodeGyp ? exec("npm run -s build:native") : { unavailable: "node-gyp" }),
	toolchain() {
		const file = path.join(outDir, "native-toolchain.json");
		const r = exec(["scripts/native-toolchain.mjs", "--out", file], { node: true });
		if (r.ok && fs.existsSync(file)) {
			const toolchain = JSON.parse(fs.readFileSync(file, "utf8"));
			record.toolchain = {
				record: path.basename(file),
				inputsDigest: toolchain.inputsDigest,
				msvc: toolchain.msvc,
				windowsSdk: toolchain.windowsSdk,
				binaries: Object.fromEntries(Object.entries(toolchain.binaries).map(([name, binary]) => [name, binary.inputsDigest])),
				policyDifferences: [...r.output.matchAll(/^ {2}(\w+): policy (.*), this build (.*)$/gm)].map((m) => ({ field: m[1], policy: JSON.parse(m[2]), build: JSON.parse(m[3]) }))
			};
		}
		return r;
	},
	build: () => exec("npm run -s build", { env: releaseNative === null ? {} : Object.fromEntries(releaseNative.binaries.flatMap(({ binary, file, record: entry }) => [[`${binary.macroPrefix}_VENDOR`, file], [`${binary.macroPrefix}_VENDOR_SHA256`, entry.sha256]])) }),
	"native-identity"() {
		// Which native bytes everything after this stage qualifies. With
		// --native they must be the release's files, as its manifest records
		// them; without it they are a local build, which the record says.
		const lines = [];
		const problems = [];
		const binaries = {};
		for (const binary of NATIVE_BINARIES) {
			const binPath = path.join(stagingDir, "bin", binary.file);
			if (!fs.existsSync(binPath)) {
				problems.push(`bin/${binary.file} is missing: the build stage must pass first`);
				continue;
			}
			const bytes = fs.readFileSync(binPath);
			const hash = sha256(bytes);
			let signed = null;
			try {
				signed = peLayout(bytes).certificateTable !== null;
			} catch (err) {
				problems.push(`bin/${binary.file} is not a PE image: ${err.message}`);
			}
			const release = releaseNative?.binaries.find((entry) => entry.binary === binary) ?? null;
			if (release !== null) {
				const given = sha256(fs.readFileSync(release.file));
				if (given !== release.record.sha256) problems.push(`${release.file} is ${given.slice(0, 12)}…, --native-manifest records ${release.record.sha256.slice(0, 12)}…`);
				if (hash !== release.record.sha256) problems.push(`bin/${binary.file} is ${hash.slice(0, 12)}…, not the release's ${release.record.sha256.slice(0, 12)}…: the build stage did not vendor the release's file`);
				if (signed === true && (release.record.signature === null || release.record.signature === undefined)) problems.push(`bin/${binary.file} is signed, and --native-manifest records no signature for it`);
			}
			binaries[binary.file] = { sha256: hash, unsignedSha256: release?.record.unsignedSha256 ?? null, signed, signer: release?.record.signature?.signer?.subject ?? null };
			lines.push(`bin/${binary.file} ${hash} ${signed ? "signed" : "unsigned"}, ${release === null ? "a local build" : "the release's file"}`);
		}
		record.native = { source: releaseNative === null ? "local-build" : "vendored", manifest: releaseNative === null ? null : path.relative(repoRoot, releaseNative.manifestPath) || releaseNative.manifestPath, binaries };
		if (releaseNative === null) lines.push("These are local native bytes, not a release's files; --native <dir> --native-manifest <json> qualifies a release's exact binaries.");
		return { ok: problems.length === 0, output: [...lines, ...problems].join("\n") };
	},
	bundle() {
		const file = path.join(outDir, "bundle-inventory.json");
		const r = exec(["scripts/bundle-inventory.mjs", "--out", file], { node: true });
		if (fs.existsSync(file)) {
			const inventory = JSON.parse(fs.readFileSync(file, "utf8"));
			record.bundle = { record: path.basename(file), pluginJsSha256: inventory.pluginJsSha256, packages: inventory.packages, problems: inventory.problems };
		}
		return r;
	},
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
		record.payload = { "bin/plugin.js": member("bin/plugin.js")?.sha256 ?? null, ...Object.fromEntries(NATIVE_MEMBERS.map((rel) => [rel, member(rel)?.sha256 ?? null])), "manifest.json": member("manifest.json")?.sha256 ?? null };
		const lines = [validated.output.trim(), `extracted ${record.members.length} members to ${path.relative(repoRoot, extractedDir)}`, `inventory ${inventoryOk ? "matches" : "DOES NOT MATCH"} the shipping contract (${expected.length} members)`, ...drift.map((name) => `extracted member differs from the staging copy: ${name}`)];
		return { ok: inventoryOk && drift.length === 0, output: lines.join("\n") };
	},
	abi() {
		const addon = path.join(extractedDir, PLUGIN_ROOT, "bin", "hwsm.node");
		if (!fs.existsSync(addon)) return { ok: false, output: "no extracted addon: the archive stage must pass first" };
		const r = exec(["scripts/abi-check.mjs", addon], { node: true });
		record.abi = [...r.output.matchAll(/^ABI-CHECK PASS.*$/gm)].map((m) => m[0]);
		return { ...r, ok: r.ok && record.abi.length === 1 };
	},
	recovery() {
		const dir = path.join(extractedDir, PLUGIN_ROOT);
		if (!fs.existsSync(path.join(dir, "bin", "plugin.js"))) return { ok: false, output: "no extracted plugin: the archive stage must pass first" };
		const r = exec(["scripts/e2e-resilience.mjs"], { node: true, env: { HWINFO_E2E_PLUGIN_DIR: dir } });
		record.recovery = [...r.output.matchAll(/^PLUGIN BYTES .*$/gm)].map((m) => m[0]);
		return r;
	},
	copy: () => (tools.privateDocs ? exec(["scripts/validate-release-copy.mjs"], { node: true }) : { unavailable: "private release docs" }),
	"native-gate": () => exec(["scripts/validate-native.mjs"], { node: true, env: releaseNative?.signed ? { HWSM_REQUIRE_SIGNED: "1" } : {} }),
	"cli-validate": () => (tools.streamdeck ? exec([cli.entry, "validate", stagingDir], { node: true }) : { unavailable: "streamdeck CLI" }),
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
	`Verdict **${record.verdict}**, ${record.startedAt} to ${record.finishedAt}, ${record.node} on ${record.os}. Command: \`node scripts/qualify.mjs${option("--stages") ? ` --stages ${option("--stages")}` : ""}${releaseNative !== null ? ` --native ${option("--native")} --native-manifest ${option("--native-manifest")}` : ""}\`.`,
	record.attributable ? "Tree clean before the run." : `**Tree dirty before the run** (${record.dirtyBefore.length} paths); this record is not attributable to the SHA alone.`,
	record.note ? `Note: ${record.note}` : "",
	"",
	"| Stage | Status | Seconds | Log |",
	"|---|---|---|---|",
	...record.stages.map((s) => `| ${s.id} | ${s.status}${s.missing ? ` (${s.missing})` : ""}${s.reason ? ` (${s.reason})` : ""} | ${s.seconds ?? ""} | ${s.log ?? ""} |`),
	"",
	record.artifact ? `Artifact \`${record.artifact.path}\`, ${record.artifact.bytes} bytes, sha256 \`${record.artifact.sha256}\`.` : "No artifact recorded (the archive stage did not run or did not pass).",
	record.payload ? `Payload: ${Object.entries(record.payload).map(([rel, sha]) => `${rel} \`${sha}\``).join(", ")}. Full member inventory in record.json (${record.members.length} members).` : "",
	record.bundle ? `Bundle inventory (${record.bundle.record}): bin/plugin.js \`${record.bundle.pluginJsSha256}\` renders ${Object.entries(record.bundle.packages).map(([name, bytes]) => `${name} ${bytes}`).join(", ")} bytes${record.bundle.problems.length > 0 ? `; ${record.bundle.problems.length} problem(s)` : ", no zod"}.` : "",
	record.native ? `Native binaries: ${record.native.source === "vendored" ? `the release's files, held to \`${record.native.manifest}\`` : "a local build, not a release's files"} (${Object.entries(record.native.binaries).map(([file, facts]) => `${file} \`${facts.sha256}\`${facts.signed ? ` signed by ${facts.signer ?? "an unrecorded signer"}` : ""}`).join(", ")}).` : "",
	record.toolchain ? `Native toolchain (record-only, ${record.toolchain.record}): MSVC ${record.toolchain.msvc.toolsVersion}, Windows SDK ${record.toolchain.windowsSdk.servicingVersion ?? record.toolchain.windowsSdk.targetPlatformVersion}, inputsDigest \`${record.toolchain.inputsDigest}\`${record.toolchain.policyDifferences.length > 0 ? `; differs from native/toolchain-policy.json in ${record.toolchain.policyDifferences.map((d) => d.field).join(", ")}, so these native bytes are not release bytes` : ""}.` : "",
	...record.abi.map((line) => `ABI on the extracted addons: ${line}`),
	...record.recovery.map((line) => `Recovery exercised: ${line}`),
	"",
	"Not attested by this record or by ordinary CI: the browser and capture suite (`npm run suite:full`), installation through the Stream Deck app, and hardware endurance. Archive container bytes are not reproducible (the packer writes timestamps); payload members are compared byte for byte."
].filter((line) => line !== undefined).join("\n");
fs.writeFileSync(path.join(outDir, `QUALIFICATION-${sourceSha.slice(0, 7)}.md`), `${md}\n`);
console.log(`\nQUALIFICATION ${record.verdict}: ${path.relative(repoRoot, outDir)}`);
process.exit(failed ? 1 : unavailable ? 2 : 0);
