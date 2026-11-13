// The Elgato Stream Deck CLI that packs and validates the plugin: the exact
// devDependency in package.json, locked with its transitive dependencies in
// package-lock.json, run from node_modules by its own entry script under the
// Node that runs the caller. No global install, no .cmd shim and no shell,
// so a path never has to be quoted for cmd.exe. Builtins only.
import fs from "node:fs";
import path from "node:path";

/**
 * The installed CLI: { entry, version } with `entry` the absolute path of
 * its `streamdeck` bin script, or null when node_modules does not hold it
 * (no `npm ci` yet).
 */
export function elgatoCli(repoRoot) {
	const dir = path.join(repoRoot, "node_modules", "@elgato", "cli");
	const manifestPath = path.join(dir, "package.json");
	if (!fs.existsSync(manifestPath)) return null;
	let manifest;
	try {
		manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	} catch {
		return null;
	}
	const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.streamdeck;
	if (typeof bin !== "string") return null;
	const entry = path.join(dir, bin);
	return fs.existsSync(entry) ? { entry, version: String(manifest.version) } : null;
}

/** The version package.json pins for the CLI, or null. */
export function pinnedElgatoCliVersion(repoRoot) {
	const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
	return pkg.devDependencies?.["@elgato/cli"] ?? null;
}
