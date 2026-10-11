// A staging directory that satisfies the shipping contract with throwaway
// content, and an archive builder over it, for the packaging gate tests
// (test/validate-pack.test.mjs, test/pack-staging.test.mjs). The manifest
// is the repository's own, so the reference checks see real Icon, Action
// and Profile fields, with its Version set to the fixture's. Test-only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGIN_ROOT, SHIPPED_MEMBERS } from "./pack-contract.mjs";
import { writeZip } from "./zip.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export const FIXTURE_VERSION = "9.9.9";

/** Writes one fixture staging directory under the temp root and returns its path. */
export function makeStaging(prefix = "hwinfo-pack-fixture-") {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, PLUGIN_ROOT, "manifest.json"), "utf8"));
	manifest.Version = `${FIXTURE_VERSION}.0`;
	for (const rel of SHIPPED_MEMBERS) {
		const file = path.join(dir, ...rel.split("/"));
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, fixtureContent(rel, manifest));
	}
	return dir;
}

export function fixtureContent(rel, manifest) {
	if (rel === "manifest.json") return `${JSON.stringify(manifest, null, "\t")}\n`;
	if (rel === "bin/hwsm.node") return Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 7)]);
	if (rel === "bin/plugin.js") return "const bridge = require(\"./hwsm.node\");\nconsole.log(bridge);\n";
	if (rel === "bin/package.json") return "{\"type\":\"module\"}";
	return `fixture content of ${rel}\n`;
}

/** Every file under `dir` by relative path, for before/after comparisons. */
export function snapshotDir(dir) {
	const out = new Map();
	const walk = (current, rel) => {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
			if (entry.isDirectory()) walk(path.join(current, entry.name), relPath);
			else out.set(relPath, fs.readFileSync(path.join(current, entry.name)));
		}
	};
	walk(dir, "");
	return out;
}

export function sameSnapshot(a, b) {
	if (a.size !== b.size) return false;
	for (const [rel, bytes] of a) {
		const other = b.get(rel);
		if (other === undefined || !other.equals(bytes)) return false;
	}
	return true;
}

/**
 * Archive entries the CLI would write for `dir`: every member under the
 * plugin root, deflated, with the manifest re-serialized the way the CLI
 * does it (no trailing newline). `edit(entries)` may reshape the list.
 */
export function archiveEntries(dir, edit = (entries) => entries) {
	const entries = [];
	for (const rel of SHIPPED_MEMBERS) {
		const file = path.join(dir, ...rel.split("/"));
		let data = fs.readFileSync(file);
		if (rel === "manifest.json") data = Buffer.from(JSON.stringify(JSON.parse(data.toString("utf8")), null, "\t"));
		entries.push({ name: `${PLUGIN_ROOT}/${rel}`, data });
	}
	return edit(entries);
}

export function archiveFor(dir, edit, options) {
	return writeZip(archiveEntries(dir, edit), options);
}
