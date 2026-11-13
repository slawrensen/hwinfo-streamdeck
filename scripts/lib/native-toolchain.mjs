// The toolchain record of a native build: which compiler, linker, SDK and
// CRT files actually went into each shipped binary, with their hashes.
// 1.7.1's hwsm.node moved with unchanged source and an unchanged cl banner
// because the runner image's kernel32.lib moved; a version string alone
// could not say so, the hash of the library the linker read does.
//
// Sources, all written by the build itself:
// - MSBuild's tracking logs under build/Release/obj/<target>/<target>.tlog:
//   CL, link and rc read logs (every header and library each tool opened)
//   and command logs (the exact command lines);
// - <target>.lastbuildstate (PlatformToolSet, VCToolsVersion,
//   TargetPlatformVersion) and build/config.gypi (nodedir);
// - files the logs do not list, hashed directly: the tool binaries
//   (cl.exe, c1.dll, c2.dll, link.exe, rc.exe...), node.lib and the Node
//   headers (node-gyp's cache sits where file tracking does not look), and
//   node-gyp's addon.gypi and delay-load hook;
// - vswhere and the SDK's uninstall registration for the Visual Studio
//   build and the SDK servicing build, which no file names.
//
// Every path is reduced to a root token (<msvc>, <kits>, <nodedir>,
// <node_modules>, <vs>), so a record never carries C:\Users\... or a runner
// path. Repository files are left out (the native source id covers them)
// and so are Windows system files (locale and time-zone data the tools
// open, which cannot change the output).
//
// Pure functions plus collectToolchain(), whose process and registry access
// is injectable for tests. Builtins only.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const TOOLCHAIN_RECORD_VERSION = 1;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Text of a tracking log: UTF-16LE when it starts with that BOM (or
 * looks like it), UTF-8 otherwise. */
export function decodeTlogText(bytes) {
	if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.toString("utf16le", 2);
	if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.toString("utf8", 3);
	if (bytes.length >= 2 && bytes[1] === 0 && bytes[0] !== 0) return bytes.toString("utf16le");
	return bytes.toString("utf8");
}

/** Entries of a read log: every line that is not a `^source` header,
 * upper-cased, de-duplicated, in first-seen order. */
export function readTlogEntries(bytes) {
	const seen = new Set();
	for (const raw of decodeTlogText(bytes).split(/\r?\n/)) {
		const line = raw.trim();
		if (line === "" || line.startsWith("^")) continue;
		seen.add(line.toUpperCase());
	}
	return [...seen];
}

/** Commands of a command log: the lines after each `^source` header
 * joined into one command (link writes its response-file lines below the
 * first). */
export function readTlogCommands(bytes) {
	const commands = [];
	let current = null;
	for (const raw of decodeTlogText(bytes).split(/\r?\n/)) {
		const line = raw.trim();
		if (line === "") continue;
		if (line.startsWith("^")) {
			current = { sources: line.slice(1).split("|"), parts: [] };
			commands.push(current);
		} else if (current !== null) {
			current.parts.push(line);
		}
	}
	return commands.map(({ sources, parts }) => ({ sources, command: parts.join(" ") }));
}

/** PlatformToolSet, VCToolArchitecture, VCToolsVersion and
 * TargetPlatformVersion from <target>.lastbuildstate. */
export function parseLastBuildState(text) {
	const first = text.split(/\r?\n/)[0] ?? "";
	const out = {};
	for (const pair of first.split(":")) {
		const at = pair.indexOf("=");
		if (at > 0) out[pair.slice(0, at)] = pair.slice(at + 1);
	}
	return {
		platformToolset: out.PlatformToolSet ?? null,
		toolArchitecture: out.VCToolArchitecture ?? null,
		toolsVersion: out.VCToolsVersion ?? null,
		targetPlatformVersion: out.TargetPlatformVersion ?? null
	};
}

/** One string value of node-gyp's build/config.gypi (JSON-shaped). */
export function configGypiValue(text, key) {
	const m = new RegExp(`"${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`).exec(text);
	if (!m) return null;
	try {
		return JSON.parse(m[1]);
	} catch {
		return null;
	}
}

/** "a.b.c.d" from a PE file's VS_FIXEDFILEINFO, or null. */
export function fileVersionOf(bytes) {
	const signature = Buffer.from([0xbd, 0x04, 0xef, 0xfe]);
	for (let at = bytes.indexOf(signature); at >= 0; at = bytes.indexOf(signature, at + 1)) {
		if (at % 4 !== 0 || at + 16 > bytes.length) continue;
		const ms = bytes.readUInt32LE(at + 8);
		const ls = bytes.readUInt32LE(at + 12);
		return `${ms >>> 16}.${ms & 0xffff}.${ls >>> 16}.${ls & 0xffff}`;
	}
	return null;
}

/** Upper-case, backslash-separated, with one trailing backslash. */
function prefixOf(dir) {
	return `${dir.replaceAll("/", "\\").replace(/\\+$/, "").toUpperCase()}\\`;
}

/**
 * Ordered root list for normalization: the longest prefix wins, so a path
 * inside node_modules is <node_modules>, not <repo>. `dirs` maps a token to
 * a directory; empty entries are skipped.
 */
export function makeRoots(dirs) {
	return Object.entries(dirs)
		.filter(([, dir]) => typeof dir === "string" && dir.length > 0)
		.map(([token, dir]) => ({ token, prefix: prefixOf(dir) }))
		.sort((a, b) => b.prefix.length - a.prefix.length || a.token.localeCompare(b.token));
}

/** { root, path } for an absolute path: path relative to its root,
 * lower-case, forward slashes. Outside every root: <other> and the file
 * name only, so no machine path is recorded. */
export function normalizePath(absolute, roots) {
	const upper = absolute.replaceAll("/", "\\").toUpperCase();
	for (const { token, prefix } of roots) {
		if (upper.startsWith(prefix)) return { root: token, path: upper.slice(prefix.length).toLowerCase().replaceAll("\\", "/") };
	}
	return { root: "<other>", path: path.win32.basename(upper).toLowerCase() };
}

/** A command line with every root prefix replaced by its token (also the
 * doubled-backslash spelling link uses inside quotes). */
export function normalizeCommand(line, roots) {
	let out = line;
	for (const { token, prefix } of roots) {
		const body = prefix.slice(0, -1);
		for (const spelling of [body.replaceAll("\\", "\\\\"), body]) {
			const escaped = spelling.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			out = out.replace(new RegExp(escaped, "gi"), token);
		}
	}
	return out;
}

/** sha256 over sorted lines, each newline-terminated. */
export function digestLines(lines) {
	return sha256([...lines].sort().map((line) => `${line}\n`).join(""));
}

/** The roots a build input is left out under (see the header). */
export const EXCLUDED_ROOTS = Object.freeze(["<repo>", "<windows>"]);

/**
 * The per-binary part of the record from that target's tracking logs.
 * `readFile(abs)` returns bytes or null; `roots` from makeRoots().
 */
export function binaryInputs({ tlogs, roots, readFile }) {
	const inputs = [];
	let excluded = 0;
	const seen = new Set();
	for (const bytes of [tlogs.clRead, tlogs.linkRead, tlogs.rcRead]) {
		if (!bytes) continue;
		for (const entry of readTlogEntries(bytes)) {
			if (seen.has(entry)) continue;
			seen.add(entry);
			const { root, path: rel } = normalizePath(entry, roots);
			if (EXCLUDED_ROOTS.includes(root)) {
				excluded++;
				continue;
			}
			const data = readFile(entry);
			inputs.push({ root, path: rel, sha256: data === null ? null : sha256(data), bytes: data === null ? null : data.length });
		}
	}
	inputs.sort((a, b) => `${a.root}/${a.path}`.localeCompare(`${b.root}/${b.path}`));
	const commandLines = {};
	for (const [tool, bytes] of [["cl", tlogs.clCommand], ["link", tlogs.linkCommand], ["rc", tlogs.rcCommand]]) {
		commandLines[tool] = bytes ? readTlogCommands(bytes).map(({ command }) => normalizeCommand(command, roots)) : [];
	}
	return { inputs, excluded, commandLines, commandLinesDigest: sha256(JSON.stringify(commandLines)) };
}

/** The single answer to "did any compiler input of this binary change?":
 * a digest over its inputs, the tools, the Node headers and node-gyp facts,
 * the compiler environment variables and its command lines. */
export function inputsDigestOf(binary, shared) {
	const lines = [
		...binary.inputs.map((input) => `input ${input.root}/${input.path}\0${input.sha256}`),
		...shared.tools.map((tool) => `tool ${tool.root}/${tool.path}\0${tool.sha256}`),
		`node-headers ${shared.nodeHeaders.version}\0${shared.nodeHeaders.headersDigest}\0${shared.nodeHeaders.nodeLibSha256}\0${shared.nodeHeaders.commonGypiSha256}`,
		`node-gyp ${shared.nodeGyp.version}\0${shared.nodeGyp.addonGypiSha256}\0${shared.nodeGyp.delayLoadHookSha256}`,
		`env ${JSON.stringify(shared.env)}`,
		`commands ${binary.commandLinesDigest}`
	];
	return digestLines(lines);
}

/** Every file under `dir` as sorted "relpath\0sha256" lines, digested. */
function treeDigest(dir) {
	const lines = [];
	const walk = (current, rel) => {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) walk(full, relPath);
			else if (entry.isFile()) lines.push(`${relPath.toLowerCase()}\0${sha256(fs.readFileSync(full))}`);
		}
	};
	walk(dir, "");
	return { digest: digestLines(lines), files: lines.length };
}

const readOrNull = (file) => {
	try {
		return fs.readFileSync(file);
	} catch {
		return null;
	}
};

/** The tool binaries the tracking logs do not list, relative to their root. */
export const MSVC_TOOL_FILES = Object.freeze(["cl.exe", "c1.dll", "c1xx.dll", "c2.dll", "link.exe", "cvtres.exe", "mspdbcore.dll", "mspdb140.dll", "msobj140.dll"]);
export const KITS_TOOL_FILES = Object.freeze(["rc.exe", "rcdll.dll"]);

/** Servicing builds of the Windows SDK registered for uninstall, from
 * `reg query` output: "Windows Software Development Kit - Windows a.b.c.d". */
export function sdkServicingFrom(regOutput, targetPlatformVersion) {
	const target = (targetPlatformVersion ?? "").split(".").slice(0, 3).join(".");
	const found = new Set();
	for (const m of regOutput.matchAll(/DisplayName\s+REG_SZ\s+Windows Software Development Kit - Windows (\d+\.\d+\.\d+\.\d+)/g)) {
		if (m[1].split(".").slice(0, 3).join(".") === target) found.add(m[1]);
	}
	const versions = [...found].sort((a, b) => {
		const pa = a.split(".").map(Number);
		const pb = b.split(".").map(Number);
		for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
		return 0;
	});
	return versions.at(-1) ?? null;
}

function defaultReadRegistry() {
	const out = [];
	for (const key of ["HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall", "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"]) {
		const r = spawnSync("reg.exe", ["query", key, "/s", "/f", "Windows Software Development Kit - Windows", "/d"], { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
		if (r.status === 0) out.push(r.stdout);
	}
	return out.join("\n");
}

function defaultVswhere(env) {
	const exe = path.join(env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
	if (!fs.existsSync(exe)) return [];
	const r = spawnSync(exe, ["-all", "-prerelease", "-products", "*", "-format", "json", "-utf8"], { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
	if (r.status !== 0) return [];
	try {
		return JSON.parse(r.stdout);
	} catch {
		return [];
	}
}

/**
 * Collects the toolchain record for `binaries` (scripts/lib/native-binaries.mjs
 * entries) built under `repoRoot`. Throws when a binary's tracking logs or
 * build state are missing (the build did not run in this tree).
 */
export function collectToolchain({ repoRoot, binaries, env = process.env, readRegistry = defaultReadRegistry, vswhere = () => defaultVswhere(env) }) {
	const states = [];
	const tlogSets = [];
	let nodedir = null;
	for (const binary of binaries) {
		const buildDir = path.join(repoRoot, ...binary.dir.split("/"), "build");
		const tlogDir = path.join(buildDir, "Release", "obj", binary.target, `${binary.target}.tlog`);
		const stateFile = path.join(tlogDir, `${binary.target}.lastbuildstate`);
		if (!fs.existsSync(stateFile)) throw new Error(`${binary.file}: no MSBuild build state at ${path.relative(repoRoot, stateFile)}; run \`npm run build:native\` in this tree first`);
		states.push(parseLastBuildState(decodeTlogText(fs.readFileSync(stateFile))));
		const tlog = (name) => readOrNull(path.join(tlogDir, name));
		tlogSets.push({ clRead: tlog("CL.read.1.tlog"), linkRead: tlog("link.read.1.tlog"), rcRead: tlog("rc.read.1.tlog"), clCommand: tlog("CL.command.1.tlog"), linkCommand: tlog("link.command.1.tlog"), rcCommand: tlog("rc.command.1.tlog") });
		if (!tlogSets.at(-1).linkRead) throw new Error(`${binary.file}: no link read log under ${path.relative(repoRoot, tlogDir)}; run \`npm run build:native\` in this tree first`);
		const gypi = readOrNull(path.join(buildDir, "config.gypi"));
		nodedir ??= gypi ? configGypiValue(gypi.toString("utf8"), "nodedir") : null;
	}
	const state = states[0];
	for (const [i, other] of states.entries()) {
		if (JSON.stringify(other) !== JSON.stringify(state)) throw new Error(`${binaries[i].file} was built with ${JSON.stringify(other)}, ${binaries[0].file} with ${JSON.stringify(state)}; rebuild every binary with one \`npm run build:native\``);
	}

	// The MSVC, Visual Studio and Windows Kits roots, read off the very
	// paths the tools opened.
	const allEntries = tlogSets.flatMap((set) => [set.clRead, set.linkRead].filter(Boolean).flatMap((bytes) => readTlogEntries(bytes)));
	const msvcDir = allEntries.map((entry) => /^(.*\\VC\\TOOLS\\MSVC\\[^\\]+)\\/.exec(entry)?.[1]).find(Boolean) ?? null;
	const vsDir = msvcDir ? msvcDir.replace(/\\VC\\TOOLS\\MSVC\\[^\\]+$/, "") : null;
	const kitsDir = allEntries.map((entry) => /^(.*\\WINDOWS KITS\\10)\\/.exec(entry)?.[1]).find(Boolean) ?? null;
	const roots = makeRoots({
		"<msvc>": msvcDir,
		"<vs>": vsDir,
		"<kits>": kitsDir,
		"<nodedir>": nodedir,
		"<node_modules>": path.join(repoRoot, "node_modules"),
		"<repo>": repoRoot,
		"<windows>": env.SystemRoot ?? env.windir ?? "C:\\Windows"
	});

	const tools = [];
	const tool = (dir, rel, root) => {
		if (!dir) return;
		const data = readOrNull(path.join(dir, ...rel.split("/")));
		if (data !== null) tools.push({ root, path: rel.toLowerCase(), sha256: sha256(data), bytes: data.length, fileVersion: fileVersionOf(data) });
	};
	const hostDir = state.toolArchitecture === "Native32Bit" ? "bin/hostx86/x64" : "bin/hostx64/x64";
	for (const file of MSVC_TOOL_FILES) tool(msvcDir, `${hostDir}/${file}`, "<msvc>");
	for (const file of KITS_TOOL_FILES) tool(kitsDir, `bin/${state.targetPlatformVersion}/x64/${file}`, "<kits>");
	const versionOf = (file) => tools.find((t) => t.path.endsWith(`/${file}`))?.fileVersion ?? null;

	const nodeVersionHeader = nodedir ? readOrNull(path.join(nodedir, "include", "node", "node_version.h")) : null;
	const define = (name) => nodeVersionHeader ? new RegExp(`#define ${name} (\\d+)`).exec(nodeVersionHeader.toString("utf8"))?.[1] : undefined;
	const headers = nodedir && fs.existsSync(path.join(nodedir, "include")) ? treeDigest(path.join(nodedir, "include")) : { digest: null, files: 0 };
	const hashOrNull = (file) => {
		const data = file ? readOrNull(file) : null;
		return data === null ? null : sha256(data);
	};
	const nodeHeaders = {
		version: define("NODE_MAJOR_VERSION") ? `${define("NODE_MAJOR_VERSION")}.${define("NODE_MINOR_VERSION")}.${define("NODE_PATCH_VERSION")}` : null,
		nodeLibSha256: hashOrNull(nodedir && path.join(nodedir, "x64", "node.lib")),
		headersDigest: headers.digest,
		headerFiles: headers.files,
		commonGypiSha256: hashOrNull(nodedir && path.join(nodedir, "include", "node", "common.gypi"))
	};
	const nodeGypDir = path.join(repoRoot, "node_modules", "node-gyp");
	const nodeGypPackage = readOrNull(path.join(nodeGypDir, "package.json"));
	const nodeGyp = {
		version: nodeGypPackage ? JSON.parse(nodeGypPackage.toString("utf8")).version ?? null : null,
		addonGypiSha256: hashOrNull(path.join(nodeGypDir, "addon.gypi")),
		delayLoadHookSha256: hashOrNull(path.join(nodeGypDir, "src", "win_delay_load_hook.cc"))
	};
	const compilerEnv = { CL: env.CL ?? null, _CL_: env._CL_ ?? null, LINK: env.LINK ?? null, _LINK_: env._LINK_ ?? null };

	const instances = vsDir ? vswhere().filter((instance) => typeof instance?.installationPath === "string" && prefixOf(instance.installationPath) === prefixOf(vsDir)) : [];
	const instance = instances[0];
	const shared = { tools, nodeHeaders, nodeGyp, env: compilerEnv };
	const perBinary = {};
	for (const [i, binary] of binaries.entries()) {
		const record = binaryInputs({ tlogs: tlogSets[i], roots, readFile: readOrNull });
		perBinary[binary.file] = { target: binary.target, ...record, inputsDigest: inputsDigestOf(record, shared) };
	}
	return {
		recordVersion: TOOLCHAIN_RECORD_VERSION,
		runnerImage: { os: env.ImageOS ?? null, version: env.ImageVersion ?? null },
		vsInstance: instance ? { version: instance.installationVersion ?? null, displayName: instance.displayName ?? null, productDisplayVersion: instance.catalog?.productDisplayVersion ?? null } : null,
		msvc: { toolset: state.platformToolset, toolsVersion: state.toolsVersion, toolArchitecture: state.toolArchitecture, clFileVersion: versionOf("cl.exe"), linkFileVersion: versionOf("link.exe") },
		windowsSdk: { targetPlatformVersion: state.targetPlatformVersion, servicingVersion: sdkServicingFrom(readRegistry(), state.targetPlatformVersion), source: "uninstall registration" },
		nodeHeaders,
		nodeGyp,
		env: compilerEnv,
		tools,
		binaries: perBinary,
		inputsDigest: digestLines(Object.entries(perBinary).map(([file, record]) => `${file}\0${record.inputsDigest}`))
	};
}

const versionPrefix = (version, parts) => (typeof version === "string" ? version.split(".").slice(0, parts).join(".") : null);

/** Policy field -> how to read the actual value from a record. */
const POLICY_FIELDS = Object.freeze({
	msvcToolsVersion: (record) => record.msvc?.toolsVersion ?? null,
	clVersion: (record) => versionPrefix(record.msvc?.clFileVersion, 3),
	linkVersion: (record) => versionPrefix(record.msvc?.linkFileVersion, 3),
	windowsSdkTargetPlatform: (record) => record.windowsSdk?.targetPlatformVersion ?? null,
	windowsSdkServicing: (record) => record.windowsSdk?.servicingVersion ?? null,
	nodeHeaders: (record) => record.nodeHeaders?.version ?? null,
	nodeLibSha256: (record) => record.nodeHeaders?.nodeLibSha256 ?? null,
	nodeGyp: (record) => record.nodeGyp?.version ?? null
});
export const POLICY_FIELD_NAMES = Object.freeze(Object.keys(POLICY_FIELDS));

/**
 * Compares a record with native/toolchain-policy.json. A policy field set
 * to null is not pinned yet and is reported as such, never as a mismatch.
 * Returns { mismatches: [{ field, expected, actual }], unpinned: [field],
 * suggested: { field: actual } } where `suggested` is the policy that would
 * describe this record.
 */
export function comparePolicy(record, policy) {
	const mismatches = [];
	const unpinned = [];
	const suggested = {};
	for (const [field, read] of Object.entries(POLICY_FIELDS)) {
		const actual = read(record);
		suggested[field] = actual;
		const expected = policy?.[field];
		if (expected === null || expected === undefined) unpinned.push(field);
		else if (expected !== actual) mismatches.push({ field, expected, actual });
	}
	return { mismatches, unpinned, suggested };
}
