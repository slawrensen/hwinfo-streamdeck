// Tabulates the palette-placement study (density-A..E.json and the 4bf09c0
// baseline) into the markdown table in SUMMARY.md. Run from the repo root:
//   node review/pi-density/palette-study/tabulate.mjs
import { readFileSync, existsSync } from "node:fs";

const dir = "review/pi-density";
const sets = [["4bf09c0 (before)", `${dir}/baseline/density-4bf09c0-b.json`]];
for (const v of "ABCDE") sets.push([v, `${dir}/palette-study/density-${v}.json`]);
const loaded = sets.filter(([, f]) => existsSync(f)).map(([name, f]) => [name, JSON.parse(readFileSync(f, "utf8"))]);

const state = (d, fixture, s, w, h) => d.states.find((x) => x.fixture === fixture && x.state === s && x.width === w && x.viewportHeight === h);
const task = (d, what, w, h) => d.tasks.find((t) => t.what === what && t.width === w && t.viewportHeight === h);
const pal = (st) => {
	if (st?.palette == null) return "n/a";
	const p = st.palette;
	// Where the gallery starts (page y) and whether it is on the first
	// screen at load, or hidden in a folded section.
	return `${p.top}${p.folded ? " (folded)" : p.onScreenAtLoad ? " in view" : " below the first screen"}`;
};
const route = (t) => (t?.found ? `${t.tabs}${t.enters > 0 ? ` + ${t.enters}` : ""}` : "n/a");

const lines = [];
for (const [w, h] of [[378, 410], [380, 720], [320, 560]]) {
	lines.push(`\n### ${w}x${h}${w === 378 ? " (the Stream Deck app's panel, bench 2026-09-23)" : ""}\n`);
	lines.push("| Variant | Pinned px (key / dial) | Key default px | Palette y, key (default) | Palette y, key (all folded) | Palette y, dial (default) | Palette y, dial (all folded) | Tab to palette key / dial | Tab to reading picker | Tab to rotation search |");
	lines.push("| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- |");
	for (const [name, d] of loaded) {
		const kd = state(d, "key-configured", "default", w, h);
		const kf = state(d, "key-configured", "all-folded", w, h);
		const dd = state(d, "dial-configured", "default", w, h);
		const df = state(d, "dial-configured", "all-folded", w, h);
		lines.push(`| ${name} | ${kd?.pinnedHeight ?? "?"} / ${dd?.pinnedHeight ?? "?"} | ${kd?.height ?? "?"} | ${pal(kd)} | ${pal(kf)} | ${pal(dd)} | ${pal(df)} | ${route(task(d, "Theme gallery", w, h))} / ${route(task(d, "Theme gallery (dial)", w, h))} | ${route(task(d, "Pick a reading", w, h))} | ${route(task(d, "Rotation search", w, h))} |`);
	}
}
console.log(lines.join("\n"));
