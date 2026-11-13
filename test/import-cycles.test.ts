/**
 * No runtime import cycle anywhere in src/. A cycle makes module
 * initialization order decide whether a constant is defined yet (rollup
 * bundles it either way), so the backgrounds, the key renderer and every
 * other module import one way only. Type-only imports erase at build time
 * and do not count.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const SRC = path.resolve("src");

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...sourceFiles(full));
		else if (entry.name.endsWith(".ts")) out.push(full);
	}
	return out;
}

/** The relative modules a file loads at run time. */
function runtimeImports(file: string): string[] {
	const text = fs.readFileSync(file, "utf8");
	const out: string[] = [];
	for (const match of text.matchAll(/^(?:import|export)\s+(type\s+)?(?:[^;"']*?\s+from\s+)?["'](\.[^"']+)["'];/gms)) {
		if (match[1] !== undefined) continue;
		const base = path.resolve(path.dirname(file), match[2] as string);
		const target = [`${base}.ts`, path.join(base, "index.ts")].find((candidate) => fs.existsSync(candidate));
		if (target !== undefined) out.push(target);
	}
	return out;
}

function cyclesIn(files: readonly string[]): string[] {
	const graph = new Map(files.map((file) => [file, runtimeImports(file)]));
	const state = new Map<string, "open" | "done">();
	const stack: string[] = [];
	const found: string[] = [];
	const visit = (file: string): void => {
		state.set(file, "open");
		stack.push(file);
		for (const next of graph.get(file) ?? []) {
			if (state.get(next) === "open") found.push([...stack.slice(stack.indexOf(next)), next].map((f) => path.relative(SRC, f).replaceAll("\\", "/")).join(" -> "));
			else if (state.get(next) === undefined) visit(next);
		}
		stack.pop();
		state.set(file, "done");
	};
	for (const file of files) if (state.get(file) === undefined) visit(file);
	return found;
}

describe("src has no runtime import cycle", () => {
	it("the scanner sees the imports it must (dial-background loads the shared canvas)", () => {
		const imports = runtimeImports(path.join(SRC, "ui", "dial-background.ts")).map((f) => path.basename(f));
		assert.ok(imports.includes("svg-canvas.ts"), imports.join(", "));
	});

	it("no module reaches itself through what it imports", () => {
		assert.deepEqual(cyclesIn(sourceFiles(SRC)), []);
	});
});
