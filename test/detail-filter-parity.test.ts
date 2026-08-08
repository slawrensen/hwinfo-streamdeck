// The panel ships its own copy of the detail-filter matcher: a plain
// no-build script the webview loads, hand-mirrored from
// compileDetailFilter (the webview cannot import runtime modules, so the
// two exist by design; see the "keep in sync" contract above the panel
// copy). This suite executes the panel's ACTUAL SHIPPED BYTES against the
// runtime matcher, so the mirror cannot drift silently: same fold, same
// wildcard grammar, same verdict on every probe, including candidates
// that carry literal wildcard characters and the fold-sensitive units
// the hand-written fold exists for.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { compileDetailFilter, DETAIL_FILTER_MAX } from "../src/detail/detail-settings";

const piPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "com.lawrensen.hwinfo.sdPlugin", "ui", "pi-common.js");
const piSource = readFileSync(piPath, "utf8");

/** The panel matcher, executed from the shipped bytes between two stable
 * anchors (the constant that opens the block and the first consumer that
 * follows it). A moved anchor fails loudly, which is the point. */
function panelMatcher(): (pattern: string) => (candidate: string) => boolean {
	const start = piSource.indexOf("const GLOB_STAR");
	const end = piSource.indexOf("function updateFilterCount");
	assert.ok(start !== -1 && end > start, "panel matcher anchors moved; re-point this suite at the block");
	const slice = piSource.slice(start, end);
	return new Function(`${slice}; return detailFilterMatcher;`)() as (pattern: string) => (candidate: string) => boolean;
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
		assert.ok(piSource.includes(`.slice(0, ${DETAIL_FILTER_MAX})`), "panel pattern cap no longer matches DETAIL_FILTER_MAX");
	});
});
