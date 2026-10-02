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
	"[": 4.0, "]": 4.0, "<": 8.35, ">": 8.35, '"': 5.25, "?": 5.35, "@": 11.5
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
	"[": 5.45, "]": 5.45, "<": 9.85, ">": 9.85, '"': 5.9, "?": 6.8, "@": 11.05, "▼": 11.9, "▲": 11.9, "·": 4.4, µ: 7.8, Ω: 9.25
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
