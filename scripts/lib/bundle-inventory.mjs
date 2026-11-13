// What rollup renders into bin/plugin.js, per npm package: the bundle gate.
// The shipped plugin carries code from exactly the packages whose licenses
// NOTICE.md reproduces, and no zod. zod 3.x reaches node_modules through
// @elgato/utils (the SDK's list helpers build zod schemas at import time),
// carries an advisory with no 3.x fix (GHSA-mrhx-c7xc-m3w5), and stays out
// of the bundle only because rollup.config.mjs marks @elgato/utils' lists/
// modules side-effect free. Nothing else holds that in place, so this
// module re-runs the production rollup configuration in memory and reads
// every module's rendered length: a dependency or rollup change that pulls
// zod back in, or any package NOTICE.md does not cover, fails here.
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Every npm package allowed to render code into bin/plugin.js, with the
 * NOTICE.md section that carries its license. */
export const BUNDLED_PACKAGES = Object.freeze({
	"@elgato/streamdeck": "Elgato Stream Deck SDK and @elgato/utils license (MIT)",
	"@elgato/utils": "Elgato Stream Deck SDK and @elgato/utils license (MIT)",
	"@elgato/schemas": "@elgato/schemas license (MIT)",
	ws: "ws license (MIT)",
	tslib: "tslib license (0BSD)"
});

/** Packages that must render nothing, whatever the allowlist says. */
export const FORBIDDEN_PACKAGES = Object.freeze({
	zod: "zod 3.x carries GHSA-mrhx-c7xc-m3w5 with no 3.x fix; it stays out only through rollup.config.mjs's treeshake rule for @elgato/utils' lists/ modules"
});

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/**
 * Who a rollup module id belongs to: an npm package (by its last
 * node_modules segment, so a nested copy counts as its own package name),
 * this repository's own source, or code a rollup plugin generated (the
 * CommonJS helpers and proxies that name no file of their own).
 */
export function ownerOf(id, repoRoot) {
	const file = id.replace(/^\0/, "").replace(/\?.*$/, "");
	const segments = file.split(/[\\/]/);
	const at = segments.lastIndexOf("node_modules");
	if (at >= 0 && at + 1 < segments.length) {
		const first = segments[at + 1];
		const name = first.startsWith("@") && at + 2 < segments.length ? `${first}/${segments[at + 2]}` : first;
		return { kind: "package", name };
	}
	if (path.isAbsolute(file) && !path.relative(repoRoot, file).startsWith("..")) return { kind: "first-party", name: path.relative(repoRoot, file).split(path.sep).join("/") };
	return { kind: "generated", name: file };
}

/** Rendered bytes per owner: { packages: {name: bytes}, firstParty, generated }. */
export function summarize(modules, repoRoot) {
	const packages = {};
	let firstParty = 0;
	let generated = 0;
	for (const [id, info] of Object.entries(modules)) {
		const length = info?.renderedLength ?? 0;
		const owner = ownerOf(id, repoRoot);
		if (owner.kind === "package") packages[owner.name] = (packages[owner.name] ?? 0) + length;
		else if (owner.kind === "first-party") firstParty += length;
		else generated += length;
	}
	const sorted = Object.fromEntries(Object.entries(packages).sort(([a], [b]) => a.localeCompare(b)));
	return { packages: sorted, firstParty, generated };
}

/** One sentence per rule the summary breaks; empty when the bundle passes. */
export function inventoryProblems(summary, { allowed = BUNDLED_PACKAGES, forbidden = FORBIDDEN_PACKAGES } = {}) {
	const problems = [];
	for (const [name, bytes] of Object.entries(summary.packages)) {
		if (bytes === 0) continue;
		if (Object.hasOwn(forbidden, name)) problems.push(`${name} renders ${bytes} bytes into bin/plugin.js: ${forbidden[name]}`);
		else if (!Object.hasOwn(allowed, name)) problems.push(`${name} renders ${bytes} bytes into bin/plugin.js and NOTICE.md carries no license for it; add its license to NOTICE.md and to BUNDLED_PACKAGES in scripts/lib/bundle-inventory.mjs, or keep it out of the bundle`);
	}
	return problems;
}

/**
 * Runs the production rollup configuration (rollup.config.mjs, terser
 * included) in memory and returns the plugin chunk: { code, sha256,
 * modules } where modules maps each module id to its rendered length.
 * Writes nothing. `configure` may return a changed copy of the input
 * options (the tests use it to prove the gate catches zod).
 */
export async function generateBundle(repoRoot, { configure = (options) => options } = {}) {
	const { rollup } = await import("rollup");
	const { default: config } = await import(pathToFileURL(path.join(repoRoot, "rollup.config.mjs")).href);
	const previous = process.cwd();
	// The config's paths (input, tsconfig) are relative to the repository.
	process.chdir(repoRoot);
	let bundle;
	try {
		bundle = await rollup(configure({ ...config, onwarn: () => {} }));
		const { output } = await bundle.generate(config.output);
		const chunk = output.find((item) => item.type === "chunk" && item.isEntry);
		if (chunk === undefined) throw new Error("rollup produced no entry chunk");
		const modules = Object.fromEntries(Object.entries(chunk.modules).map(([id, info]) => [id, { renderedLength: info.renderedLength }]));
		return { code: chunk.code, sha256: sha256(chunk.code), modules };
	} finally {
		await bundle?.close();
		process.chdir(previous);
	}
}
