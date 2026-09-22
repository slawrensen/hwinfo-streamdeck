// Holds a packed .streamDeckPlugin to the shipping contract. Three things
// are compared and none of them is derived from the archive alone: the
// contract (scripts/lib/pack-contract.mjs), the staging directory the
// archive was packed from, and the archive's own central directory. Every
// member is inflated and CRC-checked, then compared byte for byte with the
// staged file; the manifest is compared as JSON because the Elgato CLI
// re-serializes it (it drops the trailing newline), and its version,
// identity and asset references are checked against package.json and the
// archive's own member list. Pure: takes bytes and paths, returns
// findings; scripts/validate-pack.mjs is the command around it.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { FORBIDDEN_MEMBER_PATTERNS, PLUGIN_ROOT, PLUGIN_UUID, SHIPPED_MEMBERS, STAGING_ONLY, TEXT_MEMBER_FORBIDDEN, TEXT_MEMBER_PATTERN } from "./pack-contract.mjs";
import { listZip, readZipEntry } from "./zip.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Stable JSON text for a deep comparison that ignores key order and
 * whitespace only: what the CLI is allowed to change about the manifest. */
function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value !== null && typeof value === "object") {
		return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

function walkStaging(dir) {
	const out = [];
	const walk = (current, rel) => {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
			if (entry.isDirectory()) walk(path.join(current, entry.name), relPath);
			else out.push(relPath);
		}
	};
	walk(dir, "");
	return out;
}

/** The member path defects that make a name unsafe to extract anywhere. */
function unsafeName(name, rawName) {
	if (!Buffer.from(name, "utf8").equals(rawName)) return "is not valid UTF-8";
	if ([...name].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return "contains a control character";
	if (name.includes("\\")) return "uses a backslash separator";
	if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) return "is an absolute path";
	if (name.endsWith("/")) return "is a directory entry";
	const segments = name.split("/");
	if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return "has an empty, dot or dot-dot segment";
	if (segments.some((segment) => /[<>:"|?*]/.test(segment) || /[. ]$/.test(segment))) return "has a segment Windows cannot create";
	return null;
}

/**
 * Validates `archiveBytes` against `stagingDir` and the contract.
 * `packageVersion` is package.json's version (the manifest must read
 * `${packageVersion}.0`). Returns { failures, members, payload } where
 * payload maps each contract member to its sha256 as found in the archive.
 */
export function validatePack({ archiveBytes, stagingDir, packageVersion, contract = {} }) {
	const members = contract.members ?? SHIPPED_MEMBERS;
	const root = contract.root ?? PLUGIN_ROOT;
	const uuid = contract.uuid ?? PLUGIN_UUID;
	const failures = [];
	const fail = (message) => failures.push(message);

	const { entries, problems } = listZip(archiveBytes);
	for (const problem of problems) fail(`archive: ${problem}`);
	if (problems.length > 0) return { failures, members: 0, payload: new Map() };
	if (entries.length === 0) fail("archive: no members");

	// 1. Names: safe, unique (also case-insensitively), under the root.
	const seen = new Map();
	const relByEntry = new Map();
	for (const entry of entries) {
		const unsafe = unsafeName(entry.name, entry.rawName);
		if (unsafe !== null) { fail(`member "${entry.name}" ${unsafe}`); continue; }
		if (entry.encrypted) fail(`member "${entry.name}" is encrypted`);
		const folded = entry.name.toLowerCase();
		const previous = seen.get(folded);
		if (previous !== undefined) fail(previous === entry.name ? `member "${entry.name}" is listed twice` : `members "${previous}" and "${entry.name}" collide on a case-insensitive file system`);
		else seen.set(folded, entry.name);
		if (!entry.name.startsWith(`${root}/`)) { fail(`member "${entry.name}" is outside ${root}/`); continue; }
		relByEntry.set(entry, entry.name.slice(root.length + 1));
	}

	// 2. Inventory against the contract, and against forbidden patterns.
	const archiveRel = new Map();
	for (const [entry, rel] of relByEntry) {
		if (!archiveRel.has(rel)) archiveRel.set(rel, entry);
		for (const { pattern, why, except } of FORBIDDEN_MEMBER_PATTERNS) {
			if (pattern.test(rel) && !(except && except.test(rel))) fail(`member "${rel}" must not ship (${why})`);
		}
	}
	const expected = new Set(members);
	for (const rel of expected) if (!archiveRel.has(rel)) fail(`missing member "${rel}"`);
	for (const rel of archiveRel.keys()) if (!expected.has(rel)) fail(`unexpected member "${rel}"`);

	// 3. Staging drift: every staged shipping file is listed, every listed
	// file is staged. The archive is never the source of truth for either.
	const staged = fs.existsSync(stagingDir) ? walkStaging(stagingDir) : null;
	if (staged === null) fail(`staging directory ${stagingDir} does not exist`);
	else {
		for (const rel of staged) {
			if (STAGING_ONLY.some((pattern) => pattern.test(rel))) continue;
			if (!expected.has(rel)) fail(`staging file "${rel}" is not in the shipping contract (add it to scripts/lib/pack-contract.mjs or remove it)`);
		}
		for (const rel of expected) if (!staged.includes(rel)) fail(`staging lacks "${rel}" (run npm run build first?)`);
	}

	// 4. Payload: inflate, CRC, and compare with the staged bytes.
	const payload = new Map();
	let archiveManifest = null;
	for (const rel of expected) {
		const entry = archiveRel.get(rel);
		if (entry === undefined) continue;
		let data;
		try {
			data = readZipEntry(archiveBytes, entry);
		} catch (err) {
			fail(`member "${rel}": ${err.message}`);
			continue;
		}
		payload.set(rel, sha256(data));
		const stagedPath = path.join(stagingDir, ...rel.split("/"));
		const stagedBytes = fs.existsSync(stagedPath) ? fs.readFileSync(stagedPath) : null;
		if (rel === "manifest.json") {
			try {
				archiveManifest = JSON.parse(data.toString("utf8"));
			} catch (err) {
				fail(`manifest.json in the archive is not JSON: ${err.message}`);
			}
			if (archiveManifest !== null && stagedBytes !== null) {
				let stagedManifest = null;
				try { stagedManifest = JSON.parse(stagedBytes.toString("utf8")); } catch (err) { fail(`staged manifest.json is not JSON: ${err.message}`); }
				if (stagedManifest !== null && canonicalJson(stagedManifest) !== canonicalJson(archiveManifest)) fail("manifest.json in the archive differs from the staged manifest beyond formatting");
			}
		} else if (stagedBytes !== null && !stagedBytes.equals(data)) {
			fail(`member "${rel}" differs from the staged file (archive ${payload.get(rel).slice(0, 12)}, staged ${sha256(stagedBytes).slice(0, 12)}): a stale or foreign payload`);
		}
		if (TEXT_MEMBER_PATTERN.test(rel)) {
			const text = data.toString("utf8");
			for (const { pattern, why } of TEXT_MEMBER_FORBIDDEN) if (pattern.test(text)) fail(`member "${rel}" contains a ${why}`);
		}
		if (rel === "bin/plugin.js" && /require\(["']koffi/.test(data.toString("utf8"))) fail("bin/plugin.js references koffi");
		if (rel === "bin/hwsm.node" && !(data.length > 64 && data[0] === 0x4d && data[1] === 0x5a)) fail("bin/hwsm.node is not a PE image");
	}

	// 5. The manifest's own claims: version, identity, and that every asset
	// it names is a member. Icon paths carry no extension in the manifest.
	if (archiveManifest !== null) {
		const m = archiveManifest;
		if (m.Version !== `${packageVersion}.0`) fail(`manifest Version ${m.Version} does not match package.json ${packageVersion}.0`);
		if (m.UUID !== uuid) fail(`manifest UUID ${m.UUID} is not ${uuid}`);
		if (m.CodePath !== "bin/plugin.js") fail(`manifest CodePath ${m.CodePath} is not bin/plugin.js`);
		if (m.Nodejs?.Version !== "20") fail(`manifest Nodejs.Version ${m.Nodejs?.Version} is not "20"`);
		if (m.SDKVersion !== 3) fail(`manifest SDKVersion ${m.SDKVersion} is not 3`);
		const has = (rel) => archiveRel.has(rel);
		const image = (base, what) => {
			if (typeof base !== "string") { fail(`manifest ${what} is not a string`); return; }
			if (!["svg", "png"].some((ext) => has(`${base}.${ext}`))) fail(`manifest ${what} "${base}" names no member (.svg or .png)`);
		};
		image(m.Icon, "Icon");
		image(m.CategoryIcon, "CategoryIcon");
		if (!Array.isArray(m.Actions) || m.Actions.length === 0) fail("manifest declares no Actions");
		for (const action of m.Actions ?? []) {
			if (typeof action.UUID !== "string" || !action.UUID.startsWith(`${uuid}.`)) fail(`action UUID ${action.UUID} is not under ${uuid}.`);
			image(action.Icon, `action ${action.UUID} Icon`);
			for (const state of action.States ?? []) image(state.Image, `action ${action.UUID} state Image`);
			if (typeof action.PropertyInspectorPath === "string" && !has(action.PropertyInspectorPath)) fail(`action ${action.UUID} PropertyInspectorPath "${action.PropertyInspectorPath}" is not a member`);
		}
		for (const profile of m.Profiles ?? []) {
			if (typeof profile.Name !== "string" || !has(`${profile.Name}.streamDeckProfile`)) fail(`profile "${profile.Name}" names no .streamDeckProfile member`);
		}
	} else if (expected.has("manifest.json")) {
		fail("manifest.json could not be read from the archive");
	}

	return { failures, members: entries.length, payload };
}
