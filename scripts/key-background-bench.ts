/**
 * Key Background payload and renderer cost: for each scenario of the key
 * gallery (scripts/lib/key-gallery.ts) and each look, the bytes the key
 * sends with setImage (the data URI the action builds) and the median time
 * of the plugin's own compose path, beside Theme's face for the same inputs,
 * with the look order rotated each round.
 * Node only: it does not measure the Stream Deck app drawing the face.
 *
 *   npx tsx scripts/key-background-bench.ts [--rounds 400] [--theme midnight] [--json]
 */
import { performance } from "node:perf_hooks";

import { composeKeyScenario, KEY_SCENARIOS, seedGallerySeries } from "./lib/key-gallery";
import { setFaceFont } from "../src/ui/face-font";
import { applyGlobalThemeSettings } from "../src/ui/theme-store";

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
	const at = args.indexOf(name);
	return at >= 0 && args[at + 1] !== undefined ? (args[at + 1] as string) : fallback;
};
const rounds = Number(option("--rounds", "400"));
const theme = option("--theme", "midnight");
const LOOKS = ["theme", "glass", "tint", "outline", "clear"] as const;

setFaceFont("tahoma");
applyGlobalThemeSettings({ theme: "void", typeAccents: "on", textMode: "theme", textFont: "tahoma" });
seedGallerySeries();

/** The payload setImage carries: the action's own data URI form. */
const uriBytes = (svg: string): number => `data:image/svg+xml,${encodeURIComponent(svg)}`.length;

type Row = { id: string; layout: string; bytes: Record<string, number>; us: Record<string, number> };
const rows: Row[] = [];
for (const s of KEY_SCENARIOS) {
	const row: Row = { id: s.id, layout: s.layout, bytes: {}, us: {} };
	const times: Record<string, number[]> = {};
	for (const look of LOOKS) {
		const stored = look === "theme" ? undefined : look;
		row.bytes[look] = uriBytes(composeKeyScenario(s, theme, "theme", stored));
		for (let i = 0; i < 50; i++) composeKeyScenario(s, theme, "theme", stored);
		times[look] = [];
	}
	// Each round times every look once, starting one look later than the
	// round before, so no column always runs first and carries the warm-up.
	for (let i = 0; i < rounds; i++) {
		for (let j = 0; j < LOOKS.length; j++) {
			const look = LOOKS[(i + j) % LOOKS.length] as (typeof LOOKS)[number];
			const stored = look === "theme" ? undefined : look;
			const t0 = performance.now();
			composeKeyScenario(s, theme, "theme", stored);
			(times[look] as number[]).push((performance.now() - t0) * 1000);
		}
	}
	for (const look of LOOKS) {
		const sorted = (times[look] as number[]).sort((a, b) => a - b);
		row.us[look] = sorted[Math.floor(sorted.length / 2)] as number;
	}
	rows.push(row);
}

if (args.includes("--json")) {
	console.log(JSON.stringify({ theme, rounds, node: process.version, rows }, null, "\t"));
} else {
	const pct = (v: number, base: number): string => `${v} (${v >= base ? "+" : ""}${Math.round(((v - base) / base) * 100)}%)`;
	console.log(`Key Background payload (setImage data URI bytes), ${theme}, Tahoma, Theme text, ${process.version}\n`);
	console.log(`| Scenario | ${LOOKS.join(" | ")} |`);
	console.log(`| --- | ${LOOKS.map(() => "---:").join(" | ")} |`);
	for (const r of rows) console.log(`| ${r.id} | ${LOOKS.map((l) => (l === "theme" ? String(r.bytes[l]) : pct(r.bytes[l] as number, r.bytes.theme as number))).join(" | ")} |`);
	console.log(`\nCompose time, median of ${rounds} rounds, look order rotated each round (us). single-crit is the control row: an alerting key draws the same face on every look, so its spread is the noise.\n`);
	console.log(`| Scenario | ${LOOKS.join(" | ")} |`);
	console.log(`| --- | ${LOOKS.map(() => "---:").join(" | ")} |`);
	for (const r of rows) console.log(`| ${r.id} | ${LOOKS.map((l) => (r.us[l] as number).toFixed(1)).join(" | ")} |`);
}
