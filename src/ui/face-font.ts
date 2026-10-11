/**
 * The deck-wide face font: the family every key, dial and detail tile draws
 * in, and the measured advances every width fit uses with it.
 *
 * Tahoma is the default. Every release through 1.6.0 drew Tahoma Bold on the
 * device: the faces named "Segoe UI, Arial, sans-serif", and the Stream Deck
 * app's QtSvg reads the whole attribute as one family name, finds none and
 * falls back to Tahoma. It is the look users know and the hardware
 * photographs show, so 1.7 names it outright and measures its fits on it.
 * Segoe UI, the Windows interface font and the settings panel's, is the
 * option: lighter and narrower.
 *
 * Each profile carries the advances its fits are measured on, so a face never
 * spends a Segoe UI budget on Tahoma glyphs (the old mismatch glued three-row
 * labels to their values on hardware).
 */

import { TAHOMA_BOLD_BLOCKS, TAHOMA_BOLD_UNITS_PER_EM } from "./tahoma-bold-metrics";

export type FaceFontId = "tahoma" | "segoe-ui";

export interface FaceFontProfile {
	readonly id: FaceFontId;
	/** One family name: QtSvg reads the attribute as a single family. */
	readonly family: string;
	/** Measured advances at the 12 px basis, at the label weight. */
	readonly advance12: Readonly<Record<string, number>>;
	/** Where each glyph's ink sits inside its advance at the 12 px basis:
	 * [lead, trail], or null for a blank glyph (a space) that inks nothing.
	 * Only a face whose ink is measured carries it (Tahoma); without it every
	 * glyph inks its whole advance. */
	readonly insets12?: ReadonlyMap<string, readonly [number, number] | null>;
	/** Unmapped non-wide glyphs (µ, Ω, §, ...): a near-worst measured advance,
	 * so an odd custom name over-prices instead of leaving the face. */
	readonly unmapped12: number;
	/** Ink sits inside the advance box by the terminal side bearings. */
	readonly bearingCredit12: number;
	/** Weight 700 over the table's weight. */
	readonly boldFactor: number;
	/** The least a digit advances at weight 700, when the bold face draws
	 * every digit at one width while the table's narrow digits do not. */
	readonly boldDigit12?: number;
	/** Per-glyph em width of a 700 value, for the dial's char-count columns. */
	readonly valueEm: number;
	/** Width a key title or label row may spend, centered on the key. */
	readonly titleBand: number;
}

/**
 * Segoe UI Semibold advances at the 12 px basis (2026-07-21, rasterized
 * string differencing at 8x density), each rounded UP to 0.05 so a sum only
 * over-prices. Replaced the glyph-class averages, which erred both ways:
 * narrow glyphs over-priced (t 6.1 vs 4.35) cut names that fit ("Total CPU
 * Usage"), and M/W/... under-priced (... 7 vs 9.8) let floor cuts poke past
 * their budget.
 */
const SEGOE_UI_SEMIBOLD_12: Readonly<Record<string, number>> = {
	A: 8.1, B: 7.25, C: 7.15, D: 8.65, E: 6.25, F: 6.05, G: 8.4, H: 8.85, I: 3.5, J: 4.45, K: 7.35, L: 5.9, M: 11.1,
	N: 9.25, O: 9.1, P: 7.05, Q: 9.1, R: 7.5, S: 6.55, T: 6.9, U: 8.45, V: 7.7, W: 11.6, X: 7.45, Y: 6.95, Z: 7.05,
	a: 6.3, b: 7.25, c: 5.65, d: 7.25, e: 6.4, f: 4.15, g: 7.25, h: 7.0, i: 3.15, j: 3.35, k: 6.3, l: 3.15, m: 10.65,
	n: 7.0, o: 7.2, p: 7.25, q: 7.25, r: 4.45, s: 5.2, t: 4.35, u: 7.0, v: 6.1, w: 9.1, x: 6.05, y: 6.1, z: 5.6,
	"0": 6.7, "1": 4.85, "2": 6.7, "3": 6.7, "4": 6.95, "5": 6.7, "6": 6.7, "7": 6.45, "8": 6.7, "9": 6.7,
	" ": 3.3, "(": 4.0, ")": 4.0, "/": 5.0, ".": 2.9, ",": 2.9, "'": 3.1, ":": 2.9, ";": 2.9, "!": 3.65, "|": 3.35,
	"%": 10.1, "°": 4.55, "…": 9.8, "#": 7.1, "+": 8.35, "-": 4.85, _: 5.0, "&": 8.6, "=": 8.35, "~": 8.35, "*": 5.25,
	"[": 4.0, "]": 4.0, "<": 8.35, ">": 8.35, '"': 5.25, "?": 5.35, "@": 11.5,
	// Greek, Cyrillic and the dashes, measured 2026-10-02 the same way as the
	// Tahoma table below: Щ (12.25) and "—" (12) priced at the 9.1 unmapped
	// rate let such labels run into their values.
	"Α": 8.05, "Β": 7.25, "Γ": 5.9, "Δ": 8.05, "Ε": 6.25, "Ζ": 7.05, "Η": 8.85, "Θ": 9.1, "Ι": 3.5, "Κ": 7.35, "Λ": 7.9, "Μ": 11.1,
	"Ν": 9.2, "Ξ": 6.4, "Ο": 9.1, "Π": 8.85, "Ρ": 7.05, "Σ": 6.5, "Τ": 6.85, "Υ": 6.95, "Φ": 9.4, "Χ": 7.45, "Ψ": 9.6, "Ω": 9.15,
	"α": 7.4, "β": 7, "γ": 6.5, "δ": 7.2, "ε": 5.4, "ζ": 5.45, "η": 7.1, "θ": 7.2, "ι": 3.55, "κ": 6.55, "λ": 6.55, "μ": 7.2,
	"ν": 6.5, "ξ": 5.55, "ο": 7.2, "π": 8.05, "ρ": 7.2, "σ": 7.1, "ς": 5.7, "τ": 6.35, "υ": 7, "φ": 8.7, "χ": 6.7, "ψ": 9.25,
	"ω": 9.85, "Ά": 8.05, "Έ": 7.3, "Ή": 9.95, "Ί": 5.1, "Ό": 9.85, "Ύ": 8.65, "Ώ": 10.15, "ά": 7.5, "έ": 5.4, "ή": 7.1, "ί": 3.55,
	"ό": 7.2, "ύ": 7, "ώ": 9.85, "ϊ": 3.55, "ϋ": 7, "ΐ": 3.55, "ΰ": 7, "Ϊ": 3.5, "Ϋ": 6.95, "А": 8.05, "Б": 7.25, "В": 7.25,
	"Г": 5.9, "Д": 8.8, "Е": 6.25, "Ё": 6.25, "Ж": 11.65, "З": 6.6, "И": 9.25, "Й": 9.25, "К": 7.35, "Л": 8.4, "М": 11.1, "Н": 8.85,
	"О": 9.1, "П": 8.85, "Р": 7.05, "С": 7.15, "Т": 6.85, "У": 7.1, "Ф": 9.35, "Х": 7.45, "Ц": 9.35, "Ч": 8.3, "Ш": 11.75, "Щ": 12.25,
	"Ъ": 8.05, "Ы": 10.05, "Ь": 7.2, "Э": 7.45, "Ю": 12.5, "Я": 7.4, "а": 6.3, "б": 7.1, "в": 6.65, "г": 4.75, "д": 6.95, "е": 6.4,
	"ё": 6.4, "ж": 9.9, "з": 5.55, "и": 7.25, "й": 7.25, "к": 6.3, "л": 6.75, "м": 8.85, "н": 7.15, "о": 7.2, "п": 7.15, "р": 7.25,
	"с": 5.65, "т": 5.3, "у": 6.1, "ф": 8.8, "х": 6, "ц": 7.5, "ч": 7, "ш": 9.95, "щ": 10.3, "ъ": 6.95, "ы": 9.1, "ь": 6.35,
	"э": 5.65, "ю": 10.15, "я": 6.4, "І": 3.5, "Ї": 3.5, "Є": 7.15, "Ґ": 5.9, "і": 3.15, "ї": 3.15, "є": 5.65, "ґ": 4.95, "—": 12,
	"–": 6
};

/**
 * Tahoma Bold at the 12 px basis, from the generated font metrics
 * (tahoma-bold-metrics.ts): the exact advances, which the app's QtSvg 6.9.3
 * draws to within 0.02 px and holds linear in size, and each glyph's ink
 * insets. Tahoma has no 600 weight: QtSvg draws 600 and 700 as the same Bold
 * face (identical pixels on 1,554 probe strings), so one table serves both.
 */
const TAHOMA_BOLD_12: Record<string, number> = {};
const TAHOMA_INSETS_12 = new Map<string, readonly [number, number] | null>();
for (const [first, units] of TAHOMA_BOLD_BLOCKS) {
	const k = 12 / TAHOMA_BOLD_UNITS_PER_EM;
	for (let i = 0; i + 2 < units.length; i += 3) {
		const advance = units[i] as number;
		if (advance === 0) continue;
		const ch = String.fromCodePoint(first + i / 3);
		TAHOMA_BOLD_12[ch] = Math.abs(advance) * k;
		TAHOMA_INSETS_12.set(ch, advance < 0 ? null : [(units[i + 1] as number) * k, (units[i + 2] as number) * k]);
	}
}

/** No bearing credit: fits read each glyph's measured ink instead. Titles
 * stand alone on their line, so a title 1.6.0 drew keeps its size inside a
 * 134 px band, about what the 1.6.0 faces drew in: "CPU Package" stays at 20
 * px and "Total CPU Usage" whole at 16. */
export const TAHOMA: FaceFontProfile = { id: "tahoma", family: "Tahoma", advance12: TAHOMA_BOLD_12, insets12: TAHOMA_INSETS_12, unmapped12: 12.35, bearingCredit12: 0, boldFactor: 1, valueEm: 0.64, titleBand: 134 };
/** The bearing credit makes Segoe UI estimates track rasterized ink within
 * +4/-2.5 px at 16 px; without it "Total CPU Usage" (ink 118.4) prices at 121
 * and wrongly ellipsizes. */
/* Segoe UI Bold draws every digit 6.9 px wide at the 12 px basis; the
 * Semibold table prices "1" at 4.85 and "7" at 6.45, so a three-row value
 * like "111.1" ran its label 6 px into the value. */
export const SEGOE_UI: FaceFontProfile = { id: "segoe-ui", family: "Segoe UI", advance12: SEGOE_UI_SEMIBOLD_12, unmapped12: 9.1, bearingCredit12: 1.5, boldFactor: 1.04, boldDigit12: 6.95, valueEm: 0.6, titleBand: 120 };

let active: FaceFontProfile = TAHOMA;

/** The deck's face font; every renderer and width estimate reads it. */
export function faceFont(): FaceFontProfile {
	return active;
}

/** Settings are untyped JSON: only the exact "segoe-ui" selects Segoe UI.
 * Absent, "tahoma" or anything else is Tahoma, so an upgrade writes nothing. */
export function parseFaceFont(raw: unknown): FaceFontId {
	return raw === "segoe-ui" ? "segoe-ui" : "tahoma";
}

/** Returns true when the profile changed (the caller repaints). */
export function setFaceFont(id: FaceFontId): boolean {
	const next = id === "segoe-ui" ? SEGOE_UI : TAHOMA;
	if (next === active) {
		return false;
	}
	active = next;
	return true;
}

export function isTahoma(): boolean {
	return active.id === "tahoma";
}
