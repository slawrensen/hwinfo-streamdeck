// Writes the Strip Display seam boards: for every scene of the seam matrix
// (5 graph styles x 5 backgrounds x Words in the accent color on and off x
// Stream Deck + and + XL x whole and split), the full-width reference frame
// and the member slices stitched side by side, both rasterized by sharp
// (librsvg) over the same stand-in strip picture, plus each slice's SVG and
// a payload table. These are renderer samples from synthetic history, not
// device photographs; nothing here is committed. The Y scale boards follow
// (stamped scales, typed ends the readings pass).
//   npm run strip-boards -- <outDir> [id filter]
// Outline and Tint slices are stitched both as drawn (librsvg clips a
// filter's input to the canvas, so the seam columns differ) and on a canvas
// widened by the bleed (what a renderer that honors the filter region draws).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { diffRasters, rasterPng, renderCase, scaleMatrix, seamMatrix } from "./lib/strip-fixtures.ts";
import { renderLogical } from "../src/strip/scene.ts";
import { feedbackUri, svgBytes } from "../src/strip/slicer.ts";

const outDir = process.argv[2];
if (outDir === undefined || outDir.startsWith("-")) {
	console.error("usage: npm run strip-boards -- <outDir> [id filter]");
	process.exit(2);
}
const filter = process.argv[3];
mkdirSync(outDir, { recursive: true });

const rows = [];
// The seam matrix, then the Y scale boards (stamped, passed and legacy
// scales, scaleMatrix).
for (const c of [...seamMatrix(), ...scaleMatrix()]) {
	if (filter !== undefined && !c.id.includes(filter)) continue;
	const halo = c.input.config.background === "tint" || c.input.config.background === "outline";
	const plain = await renderCase(c, false);
	writeFileSync(path.join(outDir, `${c.id}-reference.png`), await rasterPng(plain.reference));
	writeFileSync(path.join(outDir, `${c.id}-stitched.png`), await rasterPng(plain.stitched));
	writeFileSync(path.join(outDir, `${c.id}-reference.svg`), renderLogical(plain.slices.scene));
	let diff = diffRasters(plain.reference, plain.stitched, 2);
	if (halo) {
		const widened = await renderCase(c, true);
		writeFileSync(path.join(outDir, `${c.id}-stitched-widened.png`), await rasterPng(widened.stitched));
		diff = diffRasters(widened.reference, widened.stitched, 2);
	}
	plain.slices.slices.forEach((svg, column) => {
		if (svg === null) return;
		writeFileSync(path.join(outDir, `${c.id}-slice${column}.svg`), svg);
		rows.push({ id: c.id, column, svgBytes: svgBytes(svg), uriBytes: Buffer.byteLength(feedbackUri(svg), "utf8"), bucketPx: plain.slices.bucketPx, maxDiff: diff.maxDiff, overTolerance: diff.over });
	});
}

const header = "id,column,svgBytes,uriBytes,bucketPx,maxDiff,overTolerance";
writeFileSync(path.join(outDir, "payloads.csv"), [header, ...rows.map((r) => `${r.id},${r.column},${r.svgBytes},${r.uriBytes},${r.bucketPx},${r.maxDiff},${r.overTolerance}`)].join("\n") + "\n");

const by = (pick) => {
	const groups = new Map();
	for (const r of rows) {
		const key = pick(r);
		const g = groups.get(key) ?? [];
		g.push(r);
		groups.set(key, g);
	}
	return groups;
};
const stat = (list, field) => {
	const values = list.map((r) => r[field]).sort((a, b) => a - b);
	return { min: values[0], median: values[Math.floor(values.length / 2)], max: values[values.length - 1] };
};
console.log(`${rows.length} slices from ${new Set(rows.map((r) => r.id)).size} scenes written to ${outDir}`);
console.log("look            svg bytes min/median/max     data-URI bytes min/median/max");
for (const [look, list] of by((r) => r.id.split("-").slice(3).join("-"))) {
	const s = stat(list, "svgBytes");
	const u = stat(list, "uriBytes");
	console.log(`${look.padEnd(15)} ${String(s.min).padStart(5)} / ${String(s.median).padStart(5)} / ${String(s.max).padStart(5)}        ${String(u.min).padStart(5)} / ${String(u.median).padStart(5)} / ${String(u.max).padStart(5)}`);
}
console.log("style (whole)   svg bytes min/median/max");
for (const [style, list] of by((r) => (r.id.startsWith("whole") ? r.id.split("-")[2] : "split"))) {
	const s = stat(list, "svgBytes");
	console.log(`${style.padEnd(15)} ${String(s.min).padStart(5)} / ${String(s.median).padStart(5)} / ${String(s.max).padStart(5)}`);
}
const worst = rows.reduce((a, r) => (r.maxDiff > a.maxDiff ? r : a), rows[0] ?? { maxDiff: 0 });
console.log(`largest seam difference: ${worst.maxDiff} levels (${worst.id ?? "none"})`);
