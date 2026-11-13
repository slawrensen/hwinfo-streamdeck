// The panel ships its own copy of the detail-filter matcher: a plain
// no-build script the webview loads (ui/pi-model.js), hand-mirrored from
// compileDetailFilter (the webview cannot import runtime modules, so the
// two exist by design; see the "keep in sync" contract above the panel
// copy). This suite executes the panel's ACTUAL SHIPPED BYTES against the
// runtime matcher, so the mirror cannot drift silently: same fold, same
// wildcard grammar, same verdict on every probe, including candidates
// that carry literal wildcard characters and the fold-sensitive units
// the hand-written fold exists for. The live counter (pi-common.js)
// calls that matcher through the model, so the model is loaded from its
// shipped bytes and handed to the counter's slice the way the panel does.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { compileDetailFilter, detailFilterAlternatives, detailFilterOf, DETAIL_FILTER_MAX } from "../src/detail/detail-settings";

const uiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "com.lawrensen.hwinfo.sdPlugin", "ui");
const piSource = readFileSync(path.join(uiDir, "pi-common.js"), "utf8");

/** The panel's pure model (ui/pi-model.js), the same bytes the panels
 * load: it owns the matcher, the filter split and the emptiness rule the
 * counter calls through `model`. */
type PanelModel = {
	detailFilterAlternatives(pattern: string): string[];
	detailFilterPattern(raw: unknown): string;
	detailFilterMatcher(pattern: string): (candidate: string) => boolean;
};
const modelScope: { hwModel?: PanelModel } = {};
new Function("self", readFileSync(path.join(uiDir, "pi-model.js"), "utf8"))(modelScope);
const model = modelScope.hwModel!;

/** The panel matcher, from the model's shipped bytes. */
function panelMatcher(): (pattern: string) => (candidate: string) => boolean {
	return model.detailFilterMatcher;
}

/** Deterministic 32-bit LCG so a parity split names a reproducible seed. */
function lcg(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 0x100000000;
	};
}

const ALPHABET = [..."abcXYZ09 _*?*?", "µ", "μ", "Σ", "σ", "ς", "İ", "ı", "ß", "K", "\uD83D", "\uDE00", "😀"];

describe("panel filter parity: the shipped panel matcher agrees with the runtime", () => {
	it("agrees on the fold table, wildcard grammar and literal-wildcard candidates", () => {
		const panel = panelMatcher();
		const probes: Array<[string, string]> = [
			["", ""], ["", "x"], ["*", ""], ["?", ""], ["gpu", "GPU Hot Spot"],
			["µ", "μ"], ["μ", "µ"], ["ς", "σ"], ["Σ", "ς"],
			["ß", "ss"], ["ß", "ß"], ["ı", "I"], ["İ", "i"], ["K", "k"],
			["i", "I"], ["K", "K"],
			["*", "*k"], ["*", "*"], ["4090", "RTX 4090* GPU Temperature"], ["oc", "GPU *OC* Temp"],
			["g?u*", "g*u stars *everywhere*"], ["a*b", "a*b"], ["***", "**"], ["?PU", "GPU"],
			["*?a", "xa"], ["😀", "😀"], ["?", "😀"], ["??", "😀"],
			["\uD83D", "😀"], ["a\nb", "A\nB"], ["\t*", "\tx"]
		];
		for (const [pattern, candidate] of probes) {
			assert.equal(panel(pattern)(candidate), compileDetailFilter(pattern)(candidate), `split on pattern=${JSON.stringify(pattern)} candidate=${JSON.stringify(candidate)}`);
		}
	});

	it("agrees across a seeded fuzz corpus heavy in wildcards on both sides", () => {
		const panel = panelMatcher();
		const rnd = lcg(0xf42);
		const draw = (len: number): string => {
			let out = "";
			for (let i = 0; i < len; i++) {
				out += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
			}
			return out;
		};
		for (let i = 0; i < 4000; i++) {
			const pattern = draw(Math.floor(rnd() * 9));
			const candidate = draw(Math.floor(rnd() * 15));
			assert.equal(panel(pattern)(candidate), compileDetailFilter(pattern)(candidate), `split at i=${i} pattern=${JSON.stringify(pattern)} candidate=${JSON.stringify(candidate)}`);
		}
	});

	it("the panel caps the pattern at the runtime's cap", () => {
		// Run the actual consumer: the matcher takes an already-salvaged
		// pattern, and a source-wide string search can match an unrelated cap.
		const start = piSource.indexOf("function updateFilterCount");
		const end = piSource.indexOf("// The armed per-tile add:", start);
		assert.ok(start !== -1 && end > start, "panel count anchors moved; re-point this suite at the consumer");
		const count = new Function("detailFilterValue", "tree", "isDetailPrimary", "document", "model", `${piSource.slice(start, end)}; updateFilterCount();`) as
			(pattern: string, tree: unknown, isPrimary: (key: string) => boolean, document: { getElementById: () => { hidden: boolean; textContent: string } }, model: PanelModel) => void;
		const prefix = "a".repeat(DETAIL_FILTER_MAX - 1);
		const tree = [{ name: "", readings: [{ key: "match", label: `${prefix}b` }, { key: "other", label: `${prefix}c` }] }];
		for (const raw of [`${prefix}bX`, `  ${prefix}bX  `, `${prefix}b`, "*" + "a".repeat(DETAIL_FILTER_MAX - 3) + "?bX"]) {
			const el = { hidden: true, textContent: "" };
			count(raw, tree, () => false, { getElementById: () => el }, model);
			const parsed = detailFilterOf({ detailFilter: raw });
			assert.ok(parsed !== undefined);
			const expected = tree[0]!.readings.filter((reading) => compileDetailFilter(parsed)(` ${reading.label}`)).length;
			assert.equal(expected, 1, "the fixture must distinguish cap-1, cap, and no cap");
			assert.equal(el.hidden, false);
			assert.equal(el.textContent, "Matches 1 reading right now.", JSON.stringify(raw));
		}
	});
});

// Issue #35: "|" separates alternatives. The panel splits through its
// model and ORs the same per-alternative globs, so its live count and the
// deck's list agree on every union, every padded or empty alternative and
// every all-empty pattern the field can hold.
const UNION_ALPHABET = [..."abXY9 *?||||  ", "\t", " ", "µ", "μ", "ß", "K", "😀"];

/** The panel's live counter, run from the shipped bytes with its real
 * consumers: returns what the status line under the Filter field says. */
function panelCount(raw: string, tree: unknown, isPrimary: (key: string) => boolean = () => false): string {
	const start = piSource.indexOf("function updateFilterCount");
	const end = piSource.indexOf("// The armed per-tile add:", start);
	assert.ok(start !== -1 && end > start, "panel count anchors moved; re-point this suite at the consumer");
	const el = { hidden: true, textContent: "" };
	const run = new Function("detailFilterValue", "tree", "isDetailPrimary", "document", "model", `${piSource.slice(start, end)}; updateFilterCount();`) as
		(pattern: string, tree: unknown, isPrimary: (key: string) => boolean, document: { getElementById: () => { hidden: boolean; textContent: string } }, model: PanelModel) => void;
	run(raw, tree, isPrimary, { getElementById: () => el }, model);
	assert.equal(el.hidden, false, "the counter always speaks once a pattern or a tree is there");
	return el.textContent;
}

describe("panel filter parity: | unions", () => {
	it("agrees on unions, padded and empty alternatives, and per-alternative anchoring", () => {
		const panel = panelMatcher();
		const probes: Array<[string, string]> = [
			["4090|ccd2", "CPU CCD2 (Tdie)"], ["4090|ccd2", "RTX 4090 Fan1"], ["4090|ccd2", "CPU CCD1"],
			["4090 | ccd2", "CPU CCD2"], ["4090||ccd2", "x ccd2 x"], ["4090|", "4090"], ["|4090", "4090"],
			["|", ""], ["|", "|"], ["||", "a|b"], [" | ", " | "], ["a| |b", " "],
			["core*clock|tdie", "CPU Core 0 Clock"], ["core*clock|tdie", "CPU Tdie"], ["*core*clock*|x", "CPU Core 0 Clock"],
			["4090*|ccd2", "4090 GPU"], ["4090*|ccd2", "RTX 4090"], ["?PU|pump", "GPU"], ["?PU|pump", "GPU Temp"],
			["gpu fan|pump", "GPU Fan1"], ["gpu  fan|x", "GPU Fan1"], ["a|b", "a|b"], ["a\t|\tb", "b"],
			["µ|ß", "μ"], ["K|x", "k"], ["😀|?", "😀"], [" a |b", "a"]
		];
		for (const [pattern, candidate] of probes) {
			assert.equal(panel(pattern)(candidate), compileDetailFilter(pattern)(candidate), `split on pattern=${JSON.stringify(pattern)} candidate=${JSON.stringify(candidate)}`);
		}
	});

	it("agrees across a seeded fuzz corpus heavy in separators, spaces and wildcards", () => {
		const panel = panelMatcher();
		const rnd = lcg(0x35);
		const draw = (len: number): string => {
			let out = "";
			for (let i = 0; i < len; i++) {
				out += UNION_ALPHABET[Math.floor(rnd() * UNION_ALPHABET.length)];
			}
			return out;
		};
		for (let i = 0; i < 4000; i++) {
			const pattern = draw(Math.floor(rnd() * 13));
			const candidate = draw(Math.floor(rnd() * 15));
			assert.equal(panel(pattern)(candidate), compileDetailFilter(pattern)(candidate), `split at i=${i} pattern=${JSON.stringify(pattern)} candidate=${JSON.stringify(candidate)}`);
		}
	});

	it("the panel model splits and judges emptiness exactly like the runtime", () => {
		const rnd = lcg(0x128);
		const raws: unknown[] = [undefined, null, 42, ["4090"], { pattern: "4090" }, "", " ", "|", " | | ", "||", "\t| ", "4090", " 4090 | ccd2 ", "|".repeat(DETAIL_FILTER_MAX) + "4090", `4090|${" ".repeat(DETAIL_FILTER_MAX)}ccd2`, "x".repeat(DETAIL_FILTER_MAX - 4) + "|ccd2"];
		for (let i = 0; i < 2000; i++) {
			let raw = "";
			const len = Math.floor(rnd() * 10);
			for (let j = 0; j < len; j++) {
				raw += UNION_ALPHABET[Math.floor(rnd() * UNION_ALPHABET.length)];
			}
			raws.push(raw);
		}
		for (const raw of raws) {
			const parsed = detailFilterOf({ detailFilter: raw });
			assert.equal(model.detailFilterPattern(raw), parsed ?? "", `emptiness split on ${JSON.stringify(raw)}`);
			if (typeof raw === "string") {
				assert.deepEqual(model.detailFilterAlternatives(raw), detailFilterAlternatives(raw), `split differs on ${JSON.stringify(raw)}`);
			}
		}
	});

	it("the panel counts the union once per reading and refuses an all-empty pattern", () => {
		const tree = [
			{ name: "CPU", matchName: "CPU", readings: [{ key: "c1", label: "CCD1 (Tdie)" }, { key: "c2", label: "CCD2 (Tdie)" }] },
			{ name: "GPU", matchName: "RTX 4090", readings: [{ key: "g1", label: "GPU Temperature" }, { key: "g2", label: "GPU Fan1" }] }
		];
		assert.equal(panelCount("4090|ccd2", tree), "Matches 3 readings right now.");
		assert.equal(panelCount(" 4090 || ccd2 | ", tree), "Matches 3 readings right now.");
		assert.equal(panelCount("4090|4090|gpu", tree), "Matches 2 readings right now.", "an overlap counts each reading once");
		assert.equal(panelCount("4090|ccd2", tree, (key) => key === "c2"), "Matches 2 readings right now.", "the opener stays out of a union");
		assert.equal(panelCount("4090*|xyz", tree), "Matches nothing right now; the view would open empty (0 / 0).");
		for (const empty of ["|", " | | ", "||", "\t| ", "|".repeat(DETAIL_FILTER_MAX) + "4090"]) {
			assert.equal(detailFilterOf({ detailFilter: empty }), undefined);
			assert.equal(panelCount(empty, tree), "Type a pattern; the view refuses to open while it is empty.", JSON.stringify(empty));
		}
	});
});
