// The bundle gate (scripts/lib/bundle-inventory.mjs): bin/plugin.js renders
// code from the packages NOTICE.md licenses and from nothing else, and never
// from zod. The production rollup configuration runs here in memory (no
// file is written and no earlier build is needed), so a dependency, SDK or
// rollup change that pulls zod back in fails the unit suite on the PR that
// makes it. The second real run drops the one treeshake rule that keeps zod
// out, to prove the gate sees it when it comes back.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { BUNDLED_PACKAGES, FORBIDDEN_PACKAGES, generateBundle, inventoryProblems, ownerOf, summarize } from "../scripts/lib/bundle-inventory.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const nm = (...parts) => path.join(ROOT, "node_modules", ...parts);

describe("bundle inventory: module ownership", () => {
	it("names the package by its last node_modules segment, scoped or not", () => {
		assert.deepEqual(ownerOf(nm("@elgato", "streamdeck", "dist", "plugin", "index.js"), ROOT), { kind: "package", name: "@elgato/streamdeck" });
		assert.deepEqual(ownerOf(nm("ws", "lib", "sender.js"), ROOT), { kind: "package", name: "ws" });
		assert.deepEqual(ownerOf(nm("@elgato", "streamdeck", "node_modules", "@elgato", "utils", "dist", "index.js"), ROOT), { kind: "package", name: "@elgato/utils" }, "a nested copy is still its own package");
		assert.deepEqual(ownerOf(`\0${nm("ws", "index.js")}?commonjs-proxy`, ROOT), { kind: "package", name: "ws" }, "a CommonJS proxy counts toward the package it wraps");
	});

	it("tells this repository's source from code a rollup plugin generated", () => {
		assert.deepEqual(ownerOf(path.join(ROOT, "src", "plugin.ts"), ROOT), { kind: "first-party", name: "src/plugin.ts" });
		assert.equal(ownerOf("\0commonjsHelpers.js", ROOT).kind, "generated");
	});
});

describe("bundle inventory: the rules", () => {
	const modules = (entries) => Object.fromEntries(entries.map(([id, renderedLength]) => [id, { renderedLength }]));

	it("passes the allowed packages and sums each one's modules", () => {
		const summary = summarize(modules([[nm("ws", "a.js"), 10], [nm("ws", "b.js"), 5], [nm("tslib", "tslib.es6.mjs"), 3], [path.join(ROOT, "src", "plugin.ts"), 100], ["\0commonjsHelpers.js", 7]]), ROOT);
		assert.deepEqual(summary, { packages: { tslib: 3, ws: 15 }, firstParty: 100, generated: 7 });
		assert.deepEqual(inventoryProblems(summary), []);
	});

	it("fails on any zod code and on a package NOTICE.md does not cover", () => {
		const problems = inventoryProblems(summarize(modules([[nm("zod", "v3", "types.js"), 1], [nm("left-pad", "index.js"), 12], [nm("ws", "a.js"), 4]]), ROOT));
		assert.equal(problems.length, 2);
		assert.match(problems[0], /^left-pad renders 12 bytes into bin\/plugin\.js and NOTICE\.md carries no license for it/);
		assert.match(problems[1], /^zod renders 1 bytes into bin\/plugin\.js: zod 3\.x carries GHSA-mrhx-c7xc-m3w5/);
	});

	it("ignores a module rollup kept at zero rendered bytes", () => {
		assert.deepEqual(inventoryProblems(summarize(modules([[nm("zod", "index.js"), 0], [nm("left-pad", "index.js"), 0]]), ROOT)), []);
	});

	it("names zod as forbidden even if someone adds it to the allowlist", () => {
		const summary = summarize(modules([[nm("zod", "index.js"), 9]]), ROOT);
		assert.equal(inventoryProblems(summary, { allowed: { ...BUNDLED_PACKAGES, zod: "x" }, forbidden: FORBIDDEN_PACKAGES }).length, 1);
	});

	it("every allowed package has its license section in NOTICE.md", () => {
		const headings = fs.readFileSync(path.join(ROOT, "NOTICE.md"), "utf8").split(/^## /m).slice(1).map((part) => part.slice(0, part.indexOf("\n")).trim());
		for (const [name, heading] of Object.entries(BUNDLED_PACKAGES)) assert.ok(headings.includes(heading), `${name}: NOTICE.md has no section "${heading}"`);
	});
});

describe("bundle inventory: the production rollup configuration", () => {
	it("renders only allowed packages and no zod", async () => {
		const bundle = await generateBundle(ROOT);
		const summary = summarize(bundle.modules, ROOT);
		assert.deepEqual(inventoryProblems(summary), []);
		assert.ok((summary.packages["@elgato/streamdeck"] ?? 0) > 0, "the SDK is in the bundle, or this run measured nothing");
		assert.equal(summary.packages.zod ?? 0, 0);
		assert.ok(summary.firstParty > 0);
		assert.match(bundle.sha256, /^[0-9a-f]{64}$/);
	});

	it("catches zod when the treeshake rule that keeps it out is removed", async () => {
		const bundle = await generateBundle(ROOT, {
			configure: (options) => ({ ...options, treeshake: { ...options.treeshake, moduleSideEffects: true }, plugins: options.plugins.filter((plugin) => plugin && plugin.name !== "terser") })
		});
		const summary = summarize(bundle.modules, ROOT);
		assert.ok((summary.packages.zod ?? 0) > 0, "without the rule, @elgato/utils' list modules pull zod in");
		assert.ok(inventoryProblems(summary).some((problem) => problem.startsWith("zod renders")));
	});
});
