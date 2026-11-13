/**
 * A perf subject: the plugin bytes one side of a comparison runs. Either a
 * plugin directory (an `.sdPlugin` with a built bin/) or a released
 * `.streamDeckPlugin` pack, which is extracted once into a directory named
 * after its SHA-256 so the exact shipped bytes run through the harness.
 * Every subject reports the hashes of what it ran.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listZip, readZipEntry } from "./zip.mjs";

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const fileSha = (file) => (fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null);

/** "label=path" (or a bare path, labelled by its manifest version). */
export function parseSubjectSpec(spec) {
	const eq = spec.indexOf("=");
	// A drive letter ("C:\...") has no "=", so the first "=" is the label's.
	return eq > 0 ? { label: spec.slice(0, eq), target: spec.slice(eq + 1) } : { label: null, target: spec };
}

/** Extracts every member of a pack under `dir`, refusing names that
 * leave it. Returns the plugin directory inside. */
export function extractPack(buffer, dir) {
	const { entries, problems } = listZip(buffer);
	if (problems.length > 0) throw new Error(`pack is not a readable archive: ${problems.join("; ")}`);
	const root = path.resolve(dir);
	let pluginDir = null;
	for (const entry of entries) {
		if (entry.name.endsWith("/")) continue;
		const out = path.resolve(root, entry.name);
		if (!out.startsWith(root + path.sep)) throw new Error(`pack member leaves the extraction directory: ${entry.name}`);
		const data = readZipEntry(buffer, entry);
		// An earlier extraction with the same bytes stays (a plugin from an
		// earlier run may still hold its addon open); anything else is
		// rewritten from the pack.
		if (!(fs.existsSync(out) && fs.readFileSync(out).equals(data))) {
			fs.mkdirSync(path.dirname(out), { recursive: true });
			fs.writeFileSync(out, data);
		}
		const top = entry.name.split("/")[0];
		if (top.endsWith(".sdPlugin")) pluginDir = path.join(root, top);
	}
	if (pluginDir === null) throw new Error("pack has no .sdPlugin directory");
	return pluginDir;
}

export function resolveSubject(spec, { scratch = os.tmpdir() } = {}) {
	const { label, target } = parseSubjectSpec(spec);
	const resolved = path.resolve(target);
	let dir = resolved;
	let packSha = null;
	if (fs.statSync(resolved).isFile()) {
		const buffer = fs.readFileSync(resolved);
		packSha = sha256(buffer);
		dir = extractPack(buffer, path.join(scratch, `hwinfo-perf-pack-${packSha.slice(0, 16)}`));
	}
	const pluginJs = path.join(dir, "bin", "plugin.js");
	if (!fs.existsSync(pluginJs)) throw new Error(`${dir} has no bin/plugin.js (build it, or pass a pack)`);
	const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
	return {
		label: label ?? manifest.Version,
		dir,
		manifestVersion: manifest.Version,
		packSha256: packSha,
		pluginJsSha256: fileSha(pluginJs),
		pluginJsBytes: fs.statSync(pluginJs).size,
		hwsmSha256: fileSha(path.join(dir, "bin", "hwsm.node"))
	};
}
