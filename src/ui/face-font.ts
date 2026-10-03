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

export type FaceFontId = "tahoma" | "segoe-ui";

export interface FaceFontProfile {
	readonly id: FaceFontId;
	/** One family name: QtSvg reads the attribute as a single family. */
	readonly family: string;
	/** Measured advances at the 12 px basis, at the label weight. */
	readonly advance12: Readonly<Record<string, number>>;
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
 * Tahoma Bold advances at the 12 px basis, measured 2026-10-02 through the
 * app's own QtSvg 6.9.3 by string differencing at 96 px (8x the basis),
 * rounded UP to 0.05. They match the font's own advance table (tahomabd.ttf)
 * to 0.01 and hold linear at 12, 16 and 20 px. Tahoma has no 600 weight:
 * QtSvg draws 600 and 700 as the same Bold face, so one table serves both.
 */
const TAHOMA_BOLD_12: Readonly<Record<string, number>> = {
	"0": 7.65, "1": 7.65, "2": 7.65, "3": 7.65, "4": 7.65, "5": 7.65, "6": 7.65, "7": 7.65, "8": 7.65, "9": 7.65,
	A: 8.25, B: 8.25, C: 8.05, D: 9.1, E: 7.4, F: 7, G: 8.95, H: 9.2, I: 5.8, J: 6, K: 8.4, L: 6.9, M: 10.75, N: 9.25,
	O: 9.25, P: 7.9, Q: 9.25, R: 8.75, S: 7.6, T: 7.35, U: 8.9, V: 8.1, W: 12.35, X: 8.25, Y: 8.05, Z: 7.5,
	a: 7.2, b: 7.6, c: 6.35, d: 7.6, e: 7.15, f: 4.6, g: 7.6, h: 7.7, i: 3.65, j: 4.4, k: 7.25, l: 3.65, m: 11.45,
	n: 7.7, o: 7.45, p: 7.6, q: 7.6, r: 5.2, s: 6.2, t: 5, u: 7.7, v: 6.95, w: 10.7, x: 7.25, y: 6.95, z: 6.3,
	" ": 3.55, "(": 5.45, ")": 5.45, "/": 6.95, ".": 3.75, ",": 3.75, "'": 3.35, ":": 4.4, ";": 4.4, "!": 4.15, "|": 7.65,
	"%": 14.4, "°": 6.25, "…": 12, "#": 9.85, "+": 9.85, "-": 5.2, _: 7.65, "&": 9.4, "=": 9.85, "~": 9.85, "*": 7.65,
	"[": 5.45, "]": 5.45, "<": 9.85, ">": 9.85, '"': 5.9, "?": 6.8, "@": 11.05, "▼": 11.9, "▲": 11.9, "·": 4.4, µ: 7.8, Ω: 9.25,
	// Greek, Cyrillic and the dashes, measured 2026-10-02 the same way: the
	// wide Cyrillic capitals reach 13.55, past the 12.35 unmapped rate.
	"Α": 8.25, "Β": 8.25, "Γ": 6.8, "Δ": 8.45, "Ε": 7.4, "Ζ": 7.5, "Η": 9.2, "Θ": 9.25, "Ι": 5.8, "Κ": 8.4, "Λ": 8.1, "Μ": 10.75,
	"Ν": 9.25, "Ξ": 7.6, "Ο": 9.25, "Π": 9.2, "Ρ": 7.9, "Σ": 7.35, "Τ": 7.35, "Υ": 8.05, "Φ": 10.55, "Χ": 8.25, "Ψ": 10.85, "α": 7.6,
	"β": 7.7, "γ": 6.95, "δ": 7.4, "ε": 6.3, "ζ": 5.8, "η": 7.7, "θ": 7.6, "ι": 3.65, "κ": 7.2, "λ": 6.95, "μ": 7.85, "ν": 6.95,
	"ξ": 6.15, "ο": 7.4, "π": 7.8, "ρ": 7.6, "σ": 7.9, "ς": 6.05, "τ": 6.25, "υ": 7.65, "φ": 10.05, "χ": 6.75, "ψ": 10.25, "ω": 9.75,
	"Ά": 8.75, "Έ": 9.45, "Ή": 11.25, "Ί": 7.95, "Ό": 10.75, "Ύ": 10.55, "Ώ": 10.85, "ά": 7.6, "έ": 6.3, "ή": 7.7, "ί": 3.65, "ό": 7.4,
	"ύ": 7.65, "ώ": 9.75, "ϊ": 3.65, "ϋ": 7.65, "ΐ": 3.65, "ΰ": 7.65, "Ϊ": 5.8, "Ϋ": 8.05, "А": 8.25, "Б": 8.25, "В": 8.25, "Г": 6.8,
	"Д": 9.25, "Е": 7.4, "Ё": 7.4, "Ж": 12.55, "З": 7.65, "И": 9.3, "Й": 9.3, "К": 8.4, "Л": 9.35, "М": 10.75, "Н": 9.2, "О": 9.25,
	"П": 9.2, "Р": 7.9, "С": 8.05, "Т": 7.35, "У": 8.05, "Ф": 10.55, "Х": 8.25, "Ц": 9.35, "Ч": 8.65, "Ш": 13.1, "Щ": 13.25, "Ъ": 9.7,
	"Ы": 11.55, "Ь": 8.15, "Э": 8.05, "Ю": 13.55, "Я": 8.6, "а": 7.2, "б": 7.55, "в": 7.3, "г": 6, "д": 7.8, "е": 7.15, "ё": 7.15,
	"ж": 10.65, "з": 6.3, "и": 7.85, "й": 7.85, "к": 7.25, "л": 7.85, "м": 9.1, "н": 7.8, "о": 7.4, "п": 7.8, "р": 7.6, "с": 6.35,
	"т": 6.25, "у": 6.9, "ф": 10.65, "х": 7.25, "ц": 7.9, "ч": 7.4, "ш": 11.1, "щ": 11.25, "ъ": 8.15, "ы": 10.15, "ь": 6.9, "э": 6.4,
	"ю": 11.1, "я": 7.35, "І": 5.8, "Ї": 5.8, "Є": 8.05, "Ґ": 6.8, "і": 3.65, "ї": 3.65, "є": 6.4, "ґ": 6, "—": 10.95, "–": 7.65
};

/** Credit 0: across 595 corpus strings at 12 to 20 px the table then
 * under-prices by at most 0.78 px (never by 1 px), and the app's QtSvg drew
 * no label into a value on any face (a 1.5 credit put 26 back). Titles stand
 * alone on their line, so they keep a 134 px band, about what the 1.6.0 faces
 * drew in: "CPU Package" stays at 20 px and "Total CPU Usage" whole at 16. */
export const TAHOMA: FaceFontProfile = { id: "tahoma", family: "Tahoma", advance12: TAHOMA_BOLD_12, unmapped12: 12.35, bearingCredit12: 0, boldFactor: 1, valueEm: 0.64, titleBand: 134 };
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
