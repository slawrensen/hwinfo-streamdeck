// Builds REPORT.md's before/after tables from the two density runs (same
// simulated host, fixtures, sizes and fold defaults). Run from the repo root:
//   node review/pi-density/tabulate-report.mjs > review/pi-density/report-tables.md
import { readFileSync } from "node:fs";

const dir = "review/pi-density";
const before = JSON.parse(readFileSync(`${dir}/baseline/density-4bf09c0-final.json`, "utf8"));
const after = JSON.parse(readFileSync(`${dir}/density-candidate-final.json`, "utf8"));

const state = (d, fixture, s, w, h) => d.states.find((x) => x.fixture === fixture && x.state === s && x.width === w && x.viewportHeight === h);
// A task id and fixture can carry several targets (T2 on a key: gallery,
// text color, decimals), so the description is part of the match.
const task = (d, t, fixture, what, w, h) => d.tasks.find((x) => x.task === t && x.fixture === fixture && x.what === what && x.width === w && x.viewportHeight === h);
const pct = (b, a) => (b > 0 ? `${a <= b ? "" : "+"}${Math.round(((a - b) / b) * 100)}%` : "");
const sizes = [...new Set(after.states.map((s) => `${s.width}x${s.viewportHeight}`))].map((s) => s.split("x").map(Number));
const out = [];

out.push("### Content height at the app's panel (378x410), px\n");
out.push("| Panel and state | 4bf09c0 | this pass | change |");
out.push("| --- | ---: | ---: | ---: |");
const keyed = [...new Set(after.states.map((s) => `${s.fixture}|${s.state}`))];
for (const k of keyed) {
	const [f, s] = k.split("|");
	const b = state(before, f, s, 378, 410);
	const a = state(after, f, s, 378, 410);
	if (!a) continue;
	out.push(`| ${f} ${s} | ${b?.height ?? "n/a"} | ${a.height} | ${b ? pct(b.height, a.height) : ""} |`);
}

out.push("\n### Key default and all-open across the matrix, px (before → after)\n");
out.push(`| State | ${sizes.map(([w, h]) => `${w}x${h}`).join(" | ")} |`);
out.push(`| --- | ${sizes.map(() => "---:").join(" | ")} |`);
for (const [f, s] of [["key-configured", "default"], ["key-configured", "all-open"], ["key-dense", "all-open"], ["key-details", "all-open"], ["dial-configured", "default"], ["dial-configured", "all-open"], ["dial-groups", "all-open"]]) {
	const cells = sizes.map(([w, h]) => {
		const b = state(before, f, s, w, h);
		const a = state(after, f, s, w, h);
		return `${b?.height ?? "n/a"} → ${a?.height ?? "n/a"}`;
	});
	out.push(`| ${f} ${s} | ${cells.join(" | ")} |`);
}

out.push("\n### Header cost and the palette at 378x410\n");
out.push("| Panel | pinned before | pinned after | header px before | header px after | palette y before | palette y after (always open) |");
out.push("| --- | --- | --- | ---: | ---: | --- | --- |");
const palette = (st) => (st?.palette == null ? "none" : `${st.palette.top}${st.palette.folded ? " (in a folded section)" : st.palette.onScreenAtLoad ? " in view" : " below the first screen"}`);
for (const [f, s] of [["key-configured", "default"], ["key-configured", "all-folded"], ["key-unavailable", "default"], ["key-missing", "default"], ["dial-configured", "default"], ["dial-configured", "all-folded"], ["dial-unavailable", "default"]]) {
	const b = state(before, f, s, 378, 410);
	const a = state(after, f, s, 378, 410);
	out.push(`| ${f} ${s} | ${b?.pinned ? "yes" : "no"} | ${a?.pinned ? "yes" : "no"} | ${b?.pinnedHeight ?? b?.headerHeight} | ${a?.pinnedHeight ?? a?.headerHeight} | ${palette(b)} | ${palette(a)} |`);
}

out.push("\n### Task reachability at 378x410 (keyboard from the top, nothing focused)\n");
out.push("| Task | Fixture | What | Tab + Enter before | after | target y before | after | first screen before | after | covered by header after |");
out.push("| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |");
const route = (t) => (t?.found ? `${t.tabs}${t.enters > 0 ? ` + ${t.enters}` : ""}` : "n/a");
for (const t of after.tasks.filter((x) => x.width === 378 && x.viewportHeight === 410)) {
	const b = task(before, t.task, t.fixture, t.what, 378, 410);
	out.push(`| ${t.task} | ${t.fixture} | ${t.what} | ${route(b)} | ${route(t)} | ${b?.top ?? "n/a"} | ${t.top ?? "n/a"} | ${b?.onFirstScreen ? "yes" : "no"} | ${t.onFirstScreen ? "yes" : "no"} | ${t.focusedCoveredByHeader ? "YES" : "no"} |`);
}

const maxOverflow = (d) => Math.max(...d.states.map((s) => s.overflowX));
const writes = (d) => d.states.reduce((n, s) => n + (s.writes ?? 0), 0);
out.push(`\nHorizontal overflow, worst state in the matrix: before ${maxOverflow(before)} px, after ${maxOverflow(after)} px. Settings writes while measuring: before ${writes(before)}, after ${writes(after)}.`);
console.log(out.join("\n"));
