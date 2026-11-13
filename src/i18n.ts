/**
 * Runtime string lookup with a compiled English fallback.
 *
 * t(key) asks the installed translator (plugin.ts installs the Stream Deck
 * SDK's `streamDeck.i18n.translate`, which reads the `Localization` block of
 * `<language>.json` beside the manifest, then `en.json`, and answers the key
 * itself when neither has it). Anything that is not a usable string (no
 * translator, a throw, the key echoed back, an empty value) falls back to
 * the English catalog compiled into the bundle, so a face never shows a raw
 * key and the English output does not depend on en.json being found.
 *
 * Renderers stay pure: this module imports nothing from the SDK. Unit tests
 * run with no translator (English) or with one they install.
 *
 * Numbers are not localized: every face and panel value keeps the '.'
 * decimal separator in every language, on purpose (the face width math,
 * the panel's number parsing and the dial/panel parity assume it).
 */
import { EN, type CatalogKey } from "./i18n-catalog";

export type { CatalogKey } from "./i18n-catalog";

/** Looks a key up in the active language; answers the key when it has none. */
export type Translator = (key: string) => unknown;

let translator: Translator | null = null;
const cache = new Map<string, string>();

/**
 * Installs the lookup t() asks first (null removes it). The answers are
 * cached per key: the plugin's language is fixed for the life of the
 * process (the Stream Deck app restarts plugins when its language changes).
 */
export function setTranslator(next: Translator | null): void {
	translator = next;
	cache.clear();
}

/** The English value at a dotted path of a catalog (the runtime catalog
 * unless another is named), or undefined. */
export function englishOf(key: string, catalog: object = EN): string | undefined {
	let node: unknown = catalog;
	for (const part of key.split(".")) {
		if (node === null || typeof node !== "object" || !Object.hasOwn(node, part)) return undefined;
		node = (node as Record<string, unknown>)[part];
	}
	return typeof node === "string" ? node : undefined;
}

/** Fills each `{name}` with its parameter; an unknown name stays as written. */
function fill(text: string, params: Readonly<Record<string, string | number>> | undefined): string {
	if (params === undefined) return text;
	return text.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : whole));
}

/** The string for a catalog key in the active language, English when the
 * language has none. */
export function t(key: CatalogKey, params?: Readonly<Record<string, string | number>>): string {
	let text = cache.get(key);
	if (text === undefined) {
		text = englishOf(key) ?? key;
		if (translator !== null) {
			try {
				const answer = translator(key);
				if (typeof answer === "string" && answer !== "" && answer !== key) text = answer;
			} catch {
				// A lookup that throws (no registration info, an unreadable
				// language file) keeps the English text.
			}
		}
		cache.set(key, text);
	}
	return fill(text, params);
}

/** Every key of a catalog (the runtime catalog unless another is named),
 * in catalog order. */
export function catalogKeys(catalog: object = EN): string[] {
	const keys: string[] = [];
	const walk = (node: object, prefix: string): void => {
		for (const [name, value] of Object.entries(node)) {
			if (typeof value === "string") keys.push(`${prefix}${name}`);
			else walk(value as object, `${prefix}${name}.`);
		}
	};
	walk(catalog, "");
	return keys;
}

/** Accented stand-ins for ASCII letters (pseudo-locale only). */
const PSEUDO_MAP: Readonly<Record<string, string>> = {
	a: "á", b: "ƀ", c: "ç", d: "ď", e: "é", f: "ƒ", g: "ĝ", h: "ĥ", i: "í", j: "ĵ", k: "ķ", l: "ĺ", m: "ḿ", n: "ñ", o: "ó", p: "ṕ", q: "ʠ", r: "ŕ", s: "š", t: "ť", u: "ú", v: "ṽ", w: "ŵ", x: "ẋ", y: "ý", z: "ž",
	A: "Á", B: "Ɓ", C: "Ç", D: "Ď", E: "É", F: "Ƒ", G: "Ĝ", H: "Ĥ", I: "Í", J: "Ĵ", K: "Ķ", L: "Ĺ", M: "Ḿ", N: "Ñ", O: "Ó", P: "Ṕ", Q: "Ǫ", R: "Ŕ", S: "Š", T: "Ť", U: "Ú", V: "Ṽ", W: "Ŵ", X: "Ẋ", Y: "Ý", Z: "Ž"
};

/**
 * The pseudo-locale form of an English string, for expansion tests only:
 * ASCII letters take accented forms, `{name}` parameters stay intact, and
 * the text grows by 40% (rounded up) with brackets and a padding of short
 * tilde words, so a test can see both the stretch and any cut.
 * ui/pi-strings.js has no copy of this: the panel test injects a catalog
 * built here.
 */
export function pseudoLocalize(text: string): string {
	let out = "";
	let inParam = false;
	for (const ch of text) {
		if (ch === "{") inParam = true;
		out += inParam ? ch : (PSEUDO_MAP[ch] ?? ch);
		if (ch === "}") inParam = false;
	}
	// The brackets count toward the growth; a short string still gets both.
	// The rest pads as short words (" ~~~~~"), so the text still wraps where
	// a real language's text would, instead of ending in one long token.
	let pad = "";
	for (let left = Math.ceil([...text].length * 0.4) - 2; left > 0; left -= 6) pad += ` ${"~".repeat(Math.min(5, left - 1))}`;
	return `[${out}${pad}]`;
}
