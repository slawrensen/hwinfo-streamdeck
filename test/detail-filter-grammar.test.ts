// The detail filter grammar (issue #35) as one table, held on every
// surface that reads a pattern: the runtime parser (detailFilterOf), the
// deck's resolved list and title (resolveDetailGroup), the panel's live
// counter (pi-common.js, run from its shipped bytes) and the panel's
// press summary (pi-model.js). "|" separates alternatives; each is
// trimmed, empty ones are ignored, a pattern of only separators and
// spaces is an empty pattern, each alternative keeps the single-pattern
// rules on its own, readings keep HWiNFO's order and appear once, and
// the 128-character cap applies to the whole pattern before the split.
// A pattern without "|" must keep the meaning it always had, so a
// second block holds the single path to an independent oracle.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveDetailGroup } from "../src/detail/detail-group";
import { compileDetailFilter, DETAIL_FILTER_MAX, DETAIL_FILTER_SEPARATOR, detailFilterAlternatives, detailFilterOf } from "../src/detail/detail-settings";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const uiDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin", "ui");
const piSource = readFileSync(path.join(uiDir, "pi-common.js"), "utf8");
type PanelModel = {
	detailFilterAlternatives(pattern: string): string[];
	detailFilterPattern(raw: unknown): string;
	keyInteractionSummary(settings: Record<string, unknown>, detailsSupported?: boolean | null): string;
};
const modelScope: { hwModel?: PanelModel } = {};
new Function("self", readFileSync(path.join(uiDir, "pi-model.js"), "utf8"))(modelScope);
const model = modelScope.hwModel!;

// Three sources, readings interleaved across them so "HWiNFO's order"
// and "grouped by alternative" or "grouped by source" give different lists.
const SOURCES = ["CPU [#0]: AMD Ryzen 9 7950X: Enhanced", "GPU [#0]: NVIDIA GeForce RTX 4090", "ASUS ROG CROSSHAIR X670E HERO (Nuvoton NCT6799D)"];
const ROWS: ReadonlyArray<readonly [name: string, key: string, source: number, label: string]> = [
	["T", "c0:0:1", 0, "CPU (Tctl/Tdie)"],
	["GT", "d0:0:1", 1, "GPU Temperature"],
	["C1", "c0:0:2", 0, "CCD1 (Tdie)"],
	["C2", "c0:0:3", 0, "CCD2 (Tdie)"],
	["GH", "d0:0:2", 1, "GPU Hot Spot Temperature"],
	["P", "e0:0:1", 2, "Pump"],
	["IOD", "c0:0:4", 0, "CPU IOD Hotspot"],
	["F1", "d0:0:3", 1, "GPU Fan1"],
	["CF", "e0:0:2", 2, "CPU Fan"],
	["F2", "d0:0:4", 1, "GPU Fan2"]
];
const keyOf = (name: string): string => ROWS.find((row) => row[0] === name)![1];
const nameOf = (key: string): string => ROWS.find((row) => row[1] === key)![0];

const readings: Reading[] = ROWS.map(([, key, sensorIndex, label], id) => ({ key, type: SensorType.Temperature, sensorIndex, id, label, unit: "°C", value: 50, valueMin: 40, valueMax: 60, valueAvg: 50 }));
const snapshot: SensorSnapshot = {
	pollTime: 1,
	version: 1,
	revision: 1,
	sensors: SOURCES.map((name, index) => ({ index, id: index, instance: 0, name })),
	readings,
	byKey: new Map(readings.map((r) => [r.key, r]))
};
const tree = SOURCES.map((name, s) => ({ name, matchName: name, readings: ROWS.filter((row) => row[2] === s).map(([, key, , label]) => ({ key, label })) }));

/** The panel's live counter from the shipped bytes: what the status line
 * under the Filter field says for `raw` with `primary` as the opener. */
function panelCount(raw: string, primary: string): string {
	const start = piSource.indexOf("function updateFilterCount");
	const end = piSource.indexOf("// The armed per-tile add:", start);
	assert.ok(start !== -1 && end > start, "panel count anchors moved; re-point this suite at the consumer");
	const el = { hidden: true, textContent: "" };
	const run = new Function("detailFilterValue", "tree", "isDetailPrimary", "document", "model", `${piSource.slice(start, end)}; updateFilterCount();`) as
		(pattern: string, tree: unknown, isPrimary: (key: string) => boolean, document: { getElementById: () => { hidden: boolean; textContent: string } }, model: PanelModel) => void;
	run(raw, tree, (key) => key === primary, { getElementById: () => el }, model);
	return el.textContent;
}

const ALL_BUT_CPU_FAN = ["T", "GT", "C1", "C2", "GH", "P", "IOD", "F1", "F2"];
const CARD = ["GT", "GH", "F1", "F2"];
const CARD_AND_CCD2 = ["GT", "C2", "GH", "F1", "F2"];

type Row = {
	readonly why: string;
	readonly raw: string;
	/** What detailFilterOf keeps (the title), or undefined for an empty pattern. */
	readonly stored: string | undefined;
	/** The deck's list by reading name, in order; ignored when stored is undefined. */
	readonly lists?: readonly string[];
	/** The opener; defaults to a key the snapshot does not publish. */
	readonly primary?: string;
};

const TABLE: readonly Row[] = [
	{ why: "a single pattern takes the single path", raw: "4090", stored: "4090", lists: CARD },
	{ why: "the issue's first example: the card plus CCD2, in HWiNFO's order", raw: "4090|ccd2", stored: "4090|ccd2", lists: CARD_AND_CCD2 },
	{ why: "alternative order never reorders the list", raw: "ccd2|4090", stored: "ccd2|4090", lists: CARD_AND_CCD2 },
	{ why: "spaces around an alternative are trimmed; the title keeps them as typed", raw: "4090 | ccd2", stored: "4090 | ccd2", lists: CARD_AND_CCD2 },
	{ why: "the outer trim still applies", raw: "  4090|ccd2  ", stored: "4090|ccd2", lists: CARD_AND_CCD2 },
	{ why: "an empty alternative is ignored", raw: "4090||ccd2", stored: "4090||ccd2", lists: CARD_AND_CCD2 },
	{ why: "a trailing separator is ignored", raw: "4090|", stored: "4090|", lists: CARD },
	{ why: "a leading separator is ignored", raw: "|4090", stored: "|4090", lists: CARD },
	{ why: "a whitespace-only alternative is empty", raw: "4090| \t |ccd2", stored: "4090| \t |ccd2", lists: CARD_AND_CCD2 },
	{ why: "the issue's second example: Tdie temperatures and hot spots", raw: "tdie|*hot*spot*", stored: "tdie|*hot*spot*", lists: ["T", "C1", "C2", "GH", "IOD"] },
	{ why: "the issue's third example: the card's fans and the pump", raw: "gpu fan|pump", stored: "gpu fan|pump", lists: ["P", "F1", "F2"] },
	{ why: "interior spaces stay literal inside each alternative", raw: "gpu fan | cpu fan", stored: "gpu fan | cpu fan", lists: ["F1", "CF", "F2"] },
	{ why: "a reading two alternatives match is listed once", raw: "4090|4090", stored: "4090|4090", lists: CARD },
	{ why: "overlapping alternatives list each reading once", raw: "4090|gpu", stored: "4090|gpu", lists: CARD },
	{ why: "a wildcard anchors only its own alternative", raw: "core*clock|tdie", stored: "core*clock|tdie", lists: ["T", "C1", "C2"] },
	{ why: "an anchored alternative leaves a plain one substring-wrapped", raw: "4090*|ccd2", stored: "4090*|ccd2", lists: ["C2"] },
	{ why: "an anchored ?PU* beside a plain word", raw: "?PU*|pump", stored: "?PU*|pump", lists: ALL_BUT_CPU_FAN },
	{ why: "case never matters in any alternative", raw: "TDIE|PUMP", stored: "TDIE|PUMP", lists: ["T", "C1", "C2", "P"] },
	{ why: "a union that matches nothing still opens, empty", raw: "gpu  fan|xyz", stored: "gpu  fan|xyz", lists: [] },
	{ why: "the opener stays out of a union", raw: "4090|ccd2", stored: "4090|ccd2", lists: CARD, primary: keyOf("C2") },
	{ why: "a lone separator is an empty pattern", raw: "|", stored: undefined },
	{ why: "separators and spaces only are an empty pattern", raw: " | | ", stored: undefined },
	{ why: "two separators are an empty pattern", raw: "||", stored: undefined },
	{ why: "tabs and no-break spaces trim like spaces", raw: "\t| ", stored: undefined },
	{ why: "an empty field stays an empty pattern", raw: "", stored: undefined },
	{ why: "a blank field stays an empty pattern", raw: "   ", stored: undefined },
	{ why: "the cap cuts the whole pattern before the split, dropping a late alternative", raw: `4090|${" ".repeat(DETAIL_FILTER_MAX)}ccd2`, stored: `4090|${" ".repeat(DETAIL_FILTER_MAX - 5)}`, lists: CARD },
	{ why: "the cap can cut an alternative short", raw: `${"x".repeat(DETAIL_FILTER_MAX - 4)}|ccd2`, stored: `${"x".repeat(DETAIL_FILTER_MAX - 4)}|ccd`, lists: ["C1", "C2"] },
	{ why: "a pattern the cap leaves as separators only is empty", raw: `${"|".repeat(DETAIL_FILTER_MAX)}4090`, stored: undefined }
];

describe("detail filter grammar table (issue #35)", () => {
	for (const row of TABLE) {
		it(`${JSON.stringify(row.raw.length > 40 ? `${row.raw.slice(0, 16)}...(${row.raw.length})` : row.raw)}: ${row.why}`, () => {
			const primary = row.primary ?? "gone:0:0";
			const settings = { readingKey: primary, pressBehavior: "open-details", detailMode: "filter", detailFilter: row.raw };
			assert.equal(detailFilterOf(settings), row.stored, "runtime parse");
			assert.equal(model.detailFilterPattern(row.raw), row.stored ?? "", "panel model parse");
			const group = resolveDetailGroup(snapshot, settings);
			const summary = model.keyInteractionSummary(settings, true);
			const count = panelCount(row.raw, primary);
			if (row.stored === undefined) {
				assert.equal(group, null, "entry is refused, like an empty field");
				assert.equal(summary, "Press opens nothing until the filter is set");
				assert.equal(count, "Type a pattern; the view refuses to open while it is empty.");
				return;
			}
			assert.ok(group !== null, "a pattern with something to match resolves");
			assert.deepEqual(group.keys.map(nameOf), row.lists, "the deck's list, in HWiNFO's order");
			assert.equal(new Set(group.keys).size, group.keys.length, "each reading at most once");
			assert.equal(group.title, row.stored, "the title is the stored pattern as typed");
			assert.equal(summary, `Press opens details: filter "${row.stored.slice(0, 24)}"`);
			const n = row.lists!.length;
			assert.equal(count, n === 0 ? "Matches nothing right now; the view would open empty (0 / 0)." : `Matches ${n} reading${n === 1 ? "" : "s"} right now.`, "the panel counts what the deck lists");
		});
	}

	it("a detail title overrides a union's pattern title like any other", () => {
		const group = resolveDetailGroup(snapshot, { readingKey: "gone:0:0", detailMode: "filter", detailFilter: "4090|ccd2", detailTitle: "Gaming" });
		assert.equal(group?.title, "Gaming");
		assert.deepEqual(group?.keys.map(nameOf), CARD_AND_CCD2);
	});

	it("splits in typed order with String.prototype.trim and drops empties", () => {
		assert.deepEqual(detailFilterAlternatives("b | a ||  c d  |"), ["b", "a", "c d"]);
		assert.deepEqual(detailFilterAlternatives(" x\t|\ny"), ["x", "y"]);
		assert.deepEqual(detailFilterAlternatives(" | "), []);
		assert.deepEqual(detailFilterAlternatives("4090"), ["4090"]);
	});
});

// The user docs describe this grammar in prose; each check below runs the
// behavior through production code and holds the sentence that states it.
describe("the docs state the grammar the code runs (issue #35)", () => {
	const docsDir = path.join(repoRoot, "docs");
	const details = readFileSync(path.join(docsDir, "sensor-details.md"), "utf8");
	const sectionStart = details.indexOf("## Filter patterns");
	const sectionEnd = details.indexOf("\n## ", sectionStart + 1);
	const section = details.slice(sectionStart, sectionEnd);
	const filterSettings = (detailFilter: string): Record<string, unknown> => ({ readingKey: "gone:0:0", detailMode: "filter", detailFilter });

	it("the Filter patterns section opens by naming every character that is not literal", () => {
		assert.ok(sectionStart !== -1 && sectionEnd > sectionStart, "docs/sensor-details.md keeps its Filter patterns section");
		const literal = section.indexOf("everything else is literal");
		assert.ok(literal !== -1, "the section's opening still says which characters are literal");
		assert.equal(compileDetailFilter(`gpu fan${DETAIL_FILTER_SEPARATOR}pump`)("Board Pump"), true, "the separator is not literal");
		for (const special of ["*", "?", DETAIL_FILTER_SEPARATOR]) {
			assert.ok(section.slice(0, literal).includes(`\`${special}\``), `the opening names \`${special}\` before calling everything else literal`);
		}
	});

	it("a doubled or trailing | leaves the list alone but shows in the title, and the docs say both", () => {
		for (const [extra, plain] of [["4090||ccd2", "4090|ccd2"], ["4090|", "4090"]] as const) {
			const withExtra = resolveDetailGroup(snapshot, filterSettings(extra));
			const without = resolveDetailGroup(snapshot, filterSettings(plain));
			assert.deepEqual(withExtra?.keys, without?.keys, `${extra} lists what ${plain} lists`);
			assert.equal(withExtra?.title, extra, `${extra} titles the view as typed`);
		}
		const at = section.indexOf("a doubled or trailing `|`");
		assert.ok(at !== -1, "the section still covers a doubled or trailing separator");
		const sentence = section.slice(at).split(/\.\s/)[0]!;
		assert.match(sentence, /in the list/, "the claim is scoped to the list");
		assert.match(sentence, /title/, "the same sentence says the title keeps the separator");
	});

	it("the troubleshooting entry for a refused empty filter covers a filter of only | and spaces", () => {
		assert.equal(detailFilterOf(filterSettings(" | | ")), undefined);
		assert.equal(resolveDetailGroup(snapshot, filterSettings(" | | ")), null, "entry refuses as for an empty field");
		const trouble = readFileSync(path.join(docsDir, "troubleshooting.md"), "utf8");
		const entry = trouble.split("\n").find((line) => line.startsWith("- **The filter pattern is empty**"));
		assert.ok(entry !== undefined, "docs/troubleshooting.md keeps its empty-filter entry");
		assert.ok(entry.includes(`\`${DETAIL_FILTER_SEPARATOR}\``), "the entry names a filter of only separators");
	});

	it("the filter panel capture's alt text names the count the capture shows", () => {
		// What docs/assets/img/detail-filter-panel.png shows, read off the
		// committed image. A retake changes the hash: read the new count off
		// the new image and update this record and the alt text together.
		const capture = { sha256: "f6519b333f3b19a66bd71adce314485e844c5448bb6ba51b8fe82b33b616fed6", shows: "Matches 94 readings right now" };
		const png = readFileSync(path.join(docsDir, "assets", "img", "detail-filter-panel.png"));
		assert.equal(createHash("sha256").update(png).digest("hex"), capture.sha256, "the capture was retaken; update this record and its alt text");
		// The redesigned docs wrap each capture in an enlargeable link around
		// an <img>; the alt text lives on that <img>.
		const alt = /<img src="\{\{ '\/assets\/img\/detail-filter-panel\.png' \| relative_url \}\}"[^>]*\balt="([^"]*)"/.exec(section)?.[1];
		assert.ok(alt !== undefined, "the Filter patterns section shows the capture");
		assert.ok(alt.includes(capture.shows), `the alt text reads "${capture.shows}" like the image`);
	});
});

describe("the union matcher and the compiled-filter cache", () => {
	it("a union takes one cache entry, so a long union cannot evict other live patterns", () => {
		// The cache holds 16 FIFO entries. Flush it with 16 fresh patterns,
		// then hold 15 live ones: a 60-alternative union must take only the
		// 16th slot (evicting the last flush entry), never the live ones.
		for (let i = 0; i < 16; i++) {
			compileDetailFilter(`flush-${i}`);
		}
		const live = Array.from({ length: 15 }, (_, i) => `live-${i}`);
		const compiled = live.map((pattern) => compileDetailFilter(pattern));
		const union = [..."0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX"].join("|");
		assert.equal(detailFilterAlternatives(union).length, 60);
		assert.equal(detailFilterOf({ detailFilter: union }), union, "sixty alternatives fit the cap");
		const unionMatcher = compileDetailFilter(union);
		live.forEach((pattern, i) => assert.equal(compileDetailFilter(pattern), compiled[i], `${pattern} survived the union`));
		assert.equal(compileDetailFilter(union), unionMatcher, "the union itself is cached under its full pattern");
		assert.equal(unionMatcher("!q!"), true);
		assert.equal(unionMatcher("!#!"), false);
	});

	it("a hostile union inside the cap stays linear, like a hostile single pattern", () => {
		// The single-pattern guard in detail-group.test.ts explains why only
		// the wall clock catches a backtracking regression.
		const piece = "*?a".repeat(5);
		const union = Array.from({ length: Math.floor(DETAIL_FILTER_MAX / (piece.length + 1)) }, () => piece).join("|");
		const stored = detailFilterOf({ detailFilter: union });
		assert.equal(stored, union, "the hostile union fits the cap");
		const evil = compileDetailFilter(union);
		const started = performance.now();
		assert.equal(evil("xa".repeat(400) + "b"), false);
		assert.equal(evil("xa".repeat(400)), true);
		const elapsed = performance.now() - started;
		assert.ok(elapsed < 2000, `a hostile union took ${elapsed.toFixed(0)} ms; the linear walk stays in milliseconds`);
	});
});

// A pattern without "|" keeps the meaning it always had. The oracle is the
// 1.5.0 RegExp translation the glob replaced (observation-equal by design:
// non-unicode `i` canonicalization is the hand fold, `[\s\S]` one UTF-16
// unit), safe here because the corpus stays far too short to backtrack.
function regexOracle(pattern: string): (candidate: string) => boolean {
	const anchored = /[*?]/.test(pattern) ? pattern : `*${pattern}*`;
	const source = [...anchored].map((ch) => (ch === "*" ? "[\\s\\S]*" : ch === "?" ? "[\\s\\S]" : ch.replace(/[.+^${}()|[\]\\]/g, "\\$&"))).join("");
	const regex = new RegExp(`^${source}$`, "i");
	return (candidate) => regex.test(candidate);
}

/** Deterministic 32-bit LCG so a split names a reproducible seed. */
function lcg(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 0x100000000;
	};
}

describe("a pattern without | keeps its meaning", () => {
	const ALPHABET = [..."abXY9 _*?.(", "µ", "μ", "ß", "K", "İ", "ı"];

	it("the single path agrees with the original RegExp semantics across a seeded corpus", () => {
		const rnd = lcg(0x171);
		const draw = (len: number): string => {
			let out = "";
			for (let i = 0; i < len; i++) {
				out += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
			}
			return out;
		};
		for (let i = 0; i < 3000; i++) {
			// The oracle builds its source per character, so this alphabet
			// leaves out lone surrogates; the parity suite covers them.
			const pattern = draw(1 + Math.floor(rnd() * 7));
			const candidate = draw(Math.floor(rnd() * 14));
			assert.equal(compileDetailFilter(pattern)(candidate), regexOracle(pattern)(candidate), `split at i=${i} pattern=${JSON.stringify(pattern)} candidate=${JSON.stringify(candidate)}`);
		}
	});

	it("a union is exactly the OR of its alternatives, each under the same oracle", () => {
		const rnd = lcg(0x172);
		const pieces = ["4090", "ccd2", "*hot*spot*", "?PU*", "gpu fan", "core*clock", " tdie ", "", "  ", "K", "ß", "*", "?"];
		for (let i = 0; i < 2000; i++) {
			const count = 1 + Math.floor(rnd() * 4);
			const chosen = Array.from({ length: count }, () => pieces[Math.floor(rnd() * pieces.length)]!);
			const pattern = chosen.join("|");
			const candidate = `${SOURCES[Math.floor(rnd() * SOURCES.length)]} ${ROWS[Math.floor(rnd() * ROWS.length)]![3]}`;
			const expected = !pattern.includes("|") ? regexOracle(pattern)(candidate) : chosen.map((p) => p.trim()).filter((p) => p !== "").some((p) => regexOracle(p)(candidate));
			assert.equal(compileDetailFilter(pattern)(candidate), expected, `split at i=${i} pattern=${JSON.stringify(pattern)} candidate=${JSON.stringify(candidate)}`);
		}
	});

	it("a pattern without | is never trimmed or split by the compiler", () => {
		// detailFilterOf already trimmed the outside; the compiler leaves a
		// single pattern exactly as passed, interior and edge spaces literal.
		assert.equal(compileDetailFilter(" gpu")("GPU Fan"), false);
		assert.equal(compileDetailFilter(" gpu")("dGPU [#0] GPU Fan"), true);
		assert.equal(compileDetailFilter("gpu fan")("GPU Fan1"), true);
		assert.equal(compileDetailFilter("gpu  fan")("GPU Fan1"), false);
	});
});
