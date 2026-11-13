/**
 * The memory facts the public copy states about 1.8 must hold for the code
 * and for PERF.md, the record the copy rules ground them in:
 * - the history cap the changelog and the FAQ quote is the most the history
 *   store (src/history/store.ts) can retain at once for keys, dials and
 *   strip graphs together, Group and Ambient panes included;
 * - the FAQ's 1.8 private-bytes figure for a full 15 minute window is the
 *   newest trend-15m measurement in PERF.md, not a superseded one.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { HistoryStore } from "../src/history/store";
import type { HistoryWindowId } from "../src/history/types";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

/** The first `## ` section of a changelog: the release being described. */
function topEntry(text: string): string {
	const start = text.indexOf("\n## ");
	assert.ok(start >= 0, "a changelog entry");
	const next = text.indexOf("\n## ", start + 4);
	return next < 0 ? text.slice(start) : text.slice(start, next);
}

/** Every "capped at N MiB" the text states, in bytes, with any "plus (a
 * separate) N KiB" allowance the same sentence adds to it. */
function statedCaps(text: string): number[] {
	return [...text.replace(/\s+/g, " ").matchAll(/capped at (\d+(?:\.\d+)?) MiB([^.;]*)/g)].map((m) => {
		const allowances = [...(m[2] ?? "").matchAll(/\bplus (?:a separate )?(\d+(?:\.\d+)?) KiB\b/g)];
		return Number(m[1]) * 1024 * 1024 + allowances.reduce((sum, a) => sum + Number(a[1]) * 1024, 0);
	});
}

/**
 * The most the store retains at once when every consumer kind asks for all
 * it can: key and dial windows (every window, past the main budget) and
 * strip Group panes at 32 readings of 15 minutes (past the group allowance).
 */
function retainedAtMost(): number {
	const store = new HistoryStore({ now: () => 1_000, log: () => {} });
	const windows: readonly HistoryWindowId[] = ["1m", "5m", "15m"];
	for (let i = 0; i < 130; i++) store.setInterest(`key-${i}`, [{ savedKey: `cpu:0:${i}`, window: windows }]);
	for (let s = 0; s < 4; s++) {
		store.setInterest(
			`strip:g:${s}:group`,
			Array.from({ length: 32 }, (_, i) => ({ savedKey: `gpu:${s}:${i}`, window: "15m" as const })),
			{ pool: "group" }
		);
	}
	const d = store.diagnostics();
	return d.bytes + d.group.bytes;
}

describe("public copy states 1.8's history cap as the store enforces it", () => {
	const retained = retainedAtMost();
	for (const path of ["CHANGELOG.md", "docs/changelog.md"]) {
		it(`${path}: the 1.8.0.0 entry's cap holds for every window and strip graph together`, () => {
			const entry = topEntry(read(path));
			assert.match(entry, /^\n## 1\.8\.0\.0/);
			const caps = statedCaps(entry);
			assert.ok(caps.length > 0, "the entry states a history cap");
			for (const cap of caps) assert.ok(retained <= cap, `the store retains ${retained} B at once; ${path} says capped at ${cap} B`);
		});
	}
	it("docs/faq.md: the history cap it quotes for 1.8 holds", () => {
		const caps = statedCaps(read("docs/faq.md"));
		assert.ok(caps.length > 0, "the FAQ states a history cap");
		for (const cap of caps) assert.ok(retained <= cap, `the store retains ${retained} B at once; the FAQ says capped at ${cap} B`);
	});
});

describe("the FAQ quotes PERF.md's newest 1.8 memory figure", () => {
	it("the full 15 minute window's private bytes are the newest trend-15m row's", () => {
		// PERF.md lists entries newest first; a trend-15m row's Private MB
		// cell is "1.7.1 / ... / 1.8 build measured", so its last value is
		// the newest 1.8 figure that row records.
		const rows: { header: string[]; cells: string[] }[] = [];
		let header: string[] = [];
		for (const line of read("PERF.md").split(/\r?\n/)) {
			if (!line.startsWith("|")) continue;
			const cells = line.split("|").slice(1, -1).map((c) => c.trim());
			if (cells[0] === "Workload") header = cells;
			else if (cells[0] === "trend-15m" && header.some((h) => h.startsWith("Private MB"))) rows.push({ header, cells });
		}
		const privateOf = (row: { header: string[]; cells: string[] }): number[] => {
			const col = row.header.findIndex((h) => h.startsWith("Private MB"));
			return (row.cells[col] as string).split("/").map((v) => Number(v.trim()));
		};
		assert.ok(rows.length >= 2, "PERF.md records trend-15m more than once");
		const newest = privateOf(rows[0] as { header: string[]; cells: string[] });
		const newest18 = newest[newest.length - 1] as number;
		const newest171 = newest[0] as number;
		const superseded = rows.slice(1).map((r) => privateOf(r).at(-1) as number).filter((v) => v !== newest18);

		const faq = read("docs/faq.md").split(/\r?\n/).find((l) => l.includes("15-minute time window"));
		assert.ok(faq !== undefined, "the FAQ states a 15-minute window figure");
		const quoted = [...faq.matchAll(/(\d+(?:\.\d+)?) MB private bytes against (\d+(?:\.\d+)?) MB/g)].map((m) => [Number(m[1]), Number(m[2])]);
		assert.ok(quoted.length > 0, "the FAQ quotes 1.8 against 1.7.1 private bytes");
		for (const [v18, v171] of quoted) {
			assert.ok(!superseded.includes(v18 as number), `the FAQ quotes ${v18} MB for 1.8, a superseded PERF.md figure; the newest trend-15m row says ${newest18} MB`);
			assert.deepEqual([v18, v171], [newest18, newest171], "1.8 / 1.7.1 private MB as PERF.md's newest trend-15m row");
		}
	});
});
