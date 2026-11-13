/**
 * The deck-wide defaults for a key's, a dial's and a strip's Background,
 * Words in the accent color and Sky (Advanced, Shared defaults), and how one
 * action resolves against them, the way Text color resolves against its
 * shared default (theme-store.ts effectiveTextFor).
 *
 * The Sky is the art looks' Stars (keyStars, dialStars; a strip's own
 * `stars`) and Sky color (keySkyColor, dialSkyColor; a strip's own
 * `skyColor`), each read by its exact reader (deck-art.ts artStarsOf,
 * artToneOf), one axis at a time; absent or unknown is today's look (every
 * star, the theme's colors). It belongs to the Background: "Use it
 * everywhere" drops an own Sky with an own Background, and the count line
 * counts it as part of the Background.
 *
 * The global fields carry the action fields' own names (keyBackground,
 * keyAccentWords, dialBackground, dialAccentWords) and are read by the
 * same exact readers: a look is one of the seven names, Words is the exact
 * true. An action's own exact value wins ("theme" and false included, so
 * an action can keep Theme or plain words under a see-through default);
 * absent, the empty value the panel's Default saves and any other value
 * follow the shared default. With no shared default stored the default is
 * Theme and off, so every face drawn before these defaults existed is
 * byte-identical. Since 1.8.0 the panel sets both pairs together from one
 * Background and one Words; the two pairs stay, so a document an earlier
 * candidate wrote with different values keeps drawing what it drew. A strip
 * resolves through the dial pair (its own `background` and `accentWords`,
 * src/strip/settings.ts).
 *
 * "Use it everywhere" (the panel's count line under the shared Background)
 * raises looksResetGen, a whole number that only goes up. An own Background
 * or Words stored with an older generation (the action's looksGen, a
 * strip's config.looksGen; absent is 0) is dropped: at once for every
 * visible action, one settings write each (the actions' sweeps, run from
 * theme-store.ts), and for any other when it next appears. A choice made
 * after the reset carries the current generation and is kept. A build that
 * does not know these fields keeps them as unknown fields and ignores them;
 * the write that drops an action's own looks carries the generation too,
 * so a look such a build sets on that action afterwards counts as chosen
 * after the reset. An action the reset did not set back to Default (it
 * kept no own look, a dial written only for its strip's copy included)
 * gets no stamp, so such a look on it is dropped when it next appears.
 * A generation is this PC's count, and every stamp set here is this PC's
 * generation. A key's or dial's stamp above it (another PC's, carried by a
 * pasted document) comes down to it when the panel writes that document
 * (ui/pi-model.js stampOwnLooks). Only these two choices are ever dropped.
 *
 * Only theme-store.ts writes this state, from the global settings; the
 * action composers read it on every frame, so a change repaints every
 * following key and dial without writing any action's settings.
 */
import { artSkyOf, DEFAULT_SKY, ownArtSkyOf, type ArtSky } from "./deck-art";
import { dialAccentWordsOf, dialBackgroundOf, ownAccentWordsOf, ownBackgroundOf, type DialBackground } from "./dial-background";

export type SharedLooks = {
	readonly keyBackground: DialBackground;
	readonly keyAccentWords: boolean;
	readonly dialBackground: DialBackground;
	readonly dialAccentWords: boolean;
	/** The art looks' Sky (Stars and Sky color) for keys, and for dials and strips. */
	readonly keySky: ArtSky;
	readonly dialSky: ArtSky;
	/** looksResetGen: the generation of the last "Use it everywhere" (0: never). */
	readonly resetGen: number;
};

/** No shared default stored: Theme, plain words, no reset. */
export const NO_SHARED_LOOKS: SharedLooks = { keyBackground: "theme", keyAccentWords: false, dialBackground: "theme", dialAccentWords: false, keySky: DEFAULT_SKY, dialSky: DEFAULT_SKY, resetGen: 0 };

let shared: SharedLooks = NO_SHARED_LOOKS;

/** The one reader of a looks generation (the global looksResetGen, an
 * action's looksGen, a strip config's looksGen): a whole number from 0 up
 * to the largest safe integer; anything else is 0. */
export function looksGenOf(raw: unknown): number {
	return typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? raw : 0;
}

/** The shared defaults in a global settings document, by the exact readers. */
export function parseSharedLooks(globals: { keyBackground?: unknown; keyAccentWords?: unknown; dialBackground?: unknown; dialAccentWords?: unknown; keyStars?: unknown; dialStars?: unknown; keySkyColor?: unknown; dialSkyColor?: unknown; looksResetGen?: unknown }): SharedLooks {
	return {
		keyBackground: dialBackgroundOf(globals.keyBackground),
		keyAccentWords: dialAccentWordsOf(globals.keyAccentWords),
		dialBackground: dialBackgroundOf(globals.dialBackground),
		dialAccentWords: dialAccentWordsOf(globals.dialAccentWords),
		keySky: artSkyOf(ownArtSkyOf({ stars: globals.keyStars, tone: globals.keySkyColor })),
		dialSky: artSkyOf(ownArtSkyOf({ stars: globals.dialStars, tone: globals.dialSkyColor })),
		resetGen: looksGenOf(globals.looksResetGen)
	};
}

const sameSky = (a: ArtSky, b: ArtSky): boolean => a.tone === b.tone && a.stars === b.stars;

/** The shared defaults in force. */
export function sharedLooks(): SharedLooks {
	return shared;
}

/** Puts new shared defaults in force; true when anything changed. */
export function setSharedLooks(next: SharedLooks): boolean {
	const changed = next.keyBackground !== shared.keyBackground || next.keyAccentWords !== shared.keyAccentWords || next.dialBackground !== shared.dialBackground || next.dialAccentWords !== shared.dialAccentWords || !sameSky(next.keySky, shared.keySky) || !sameSky(next.dialSky, shared.dialSky) || next.resetGen !== shared.resetGen;
	shared = next;
	return changed;
}

/** The look a key draws: its own exact value, else the shared default. */
export function keyBackgroundFor(raw: unknown): DialBackground {
	return ownBackgroundOf(raw) ?? shared.keyBackground;
}

/** A key's Words in the accent color: its own boolean, else the shared default. */
export function keyAccentWordsFor(raw: unknown): boolean {
	return ownAccentWordsOf(raw) ?? shared.keyAccentWords;
}

/** The look a dial or a strip draws: its own exact value, else the shared default. */
export function dialBackgroundFor(raw: unknown): DialBackground {
	return ownBackgroundOf(raw) ?? shared.dialBackground;
}

/** A dial's or a strip's Words in the accent color: its own boolean, else the shared default. */
export function dialAccentWordsFor(raw: unknown): boolean {
	return ownAccentWordsOf(raw) ?? shared.dialAccentWords;
}

type Doc = Readonly<Record<string, unknown>>;

/** A key's Sky from its settings: per axis its own exact name (keyStars,
 * keySkyColor), else the shared default. */
export function keySkyFor(doc: { readonly keyStars?: unknown; readonly keySkyColor?: unknown } | undefined): ArtSky {
	return artSkyOf(ownArtSkyOf({ stars: doc?.keyStars, tone: doc?.keySkyColor }), shared.keySky);
}

/** A dial's Sky from its settings, the same way (dialStars, dialSkyColor),
 * else the shared default. */
export function dialSkyFor(doc: { readonly dialStars?: unknown; readonly dialSkyColor?: unknown } | undefined): ArtSky {
	return artSkyOf(ownArtSkyOf({ stars: doc?.dialStars, tone: doc?.dialSkyColor }), shared.dialSky);
}

/** A strip's Sky from its config (stars, skyColor), else the shared dial
 * default. */
export function stripSkyFor(config: { readonly stars?: unknown; readonly skyColor?: unknown } | undefined): ArtSky {
	return artSkyOf(ownArtSkyOf({ stars: config?.stars, tone: config?.skyColor }), shared.dialSky);
}

// ---- own choices and "Use it everywhere" -------------------------------------

export type LooksKind = "key" | "dial";

/** The fields of an own Background, Words and Sky: the Background, Words,
 * then the Sky's Stars and its Sky color (the Sky goes with the
 * Background). */
export type LookFields = readonly [background: string, words: string, stars?: string, tone?: string];

/** The settings fields of an action's own Background, Words and Sky. */
export const OWN_LOOK_FIELDS: Readonly<Record<LooksKind, LookFields>> = {
	key: ["keyBackground", "keyAccentWords", "keyStars", "keySkyColor"],
	dial: ["dialBackground", "dialAccentWords", "dialStars", "dialSkyColor"]
};

/** A strip config's own Background, Words and Sky. */
export const STRIP_LOOK_FIELDS: LookFields = ["background", "accentWords", "stars", "skyColor"];

/** Which of its own Background (its Sky included) and Words a document
 * holds (exact values only, as the readers above take them). A strip
 * config is read with STRIP_LOOK_FIELDS. */
export function ownLooksOf(doc: Doc | undefined, fields: LookFields): { readonly background: boolean; readonly words: boolean } {
	const at = (field: string | undefined): unknown => (field === undefined ? undefined : doc?.[field]);
	const sky = ownArtSkyOf({ stars: at(fields[2]), tone: at(fields[3]) });
	return { background: ownBackgroundOf(doc?.[fields[0]]) !== null || sky.tone !== null || sky.stars !== null, words: ownAccentWordsOf(doc?.[fields[1]]) !== null };
}

/** True when the document holds an own Background or Words chosen before
 * the shared generation `gen`: its looksGen is older (absent is 0). */
export function staleLooks(doc: Doc | undefined, fields: LookFields, gen: number = shared.resetGen): boolean {
	if (gen <= 0 || looksGenOf(doc?.looksGen) >= gen) return false;
	const own = ownLooksOf(doc, fields);
	return own.background || own.words;
}

/** The document without its own Background, Words and Sky, every other
 * field as it was. */
export function withoutOwnLooks(doc: Doc, fields: LookFields): Record<string, unknown> {
	const next: Record<string, unknown> = { ...doc };
	for (const field of fields) if (field !== undefined) delete next[field];
	return next;
}

/** An action's document with its stale own looks dropped, or undefined
 * when there is nothing to drop (the one write an appear or a reset makes).
 * The document written carries the generation, so a Background or Words
 * that a build without looksGen (1.7.1) sets on it later counts as chosen
 * after this reset and stays. */
export function staleLooksReset(doc: Doc | undefined, kind: LooksKind, gen: number = shared.resetGen): Record<string, unknown> | undefined {
	const fields = OWN_LOOK_FIELDS[kind];
	return doc !== undefined && staleLooks(doc, fields, gen) ? { ...withoutOwnLooks(doc, fields), looksGen: gen } : undefined;
}

/** What the count line under the shared Background says: the visible keys,
 * independent dials and strips (a strip once, however many dials it spans)
 * that keep their own Background or Words, and how many of them keep each. */
export type OwnLooksCount = {
	readonly keys: number;
	readonly dials: number;
	readonly strips: number;
	readonly background: number;
	readonly words: number;
};

export const NO_OWN_LOOKS: OwnLooksCount = { keys: 0, dials: 0, strips: 0, background: 0, words: 0 };

/** Adds one action's own looks to a count. */
export function countOwnLooks(count: OwnLooksCount, kind: "keys" | "dials" | "strips", own: { readonly background: boolean; readonly words: boolean }): OwnLooksCount {
	if (!own.background && !own.words) return count;
	return { ...count, [kind]: count[kind] + 1, background: count.background + (own.background ? 1 : 0), words: count.words + (own.words ? 1 : 0) };
}

/** Sums counts (one per action class). */
export function sumOwnLooks(counts: readonly OwnLooksCount[]): OwnLooksCount {
	return counts.reduce((a, b) => ({ keys: a.keys + b.keys, dials: a.dials + b.dials, strips: a.strips + b.strips, background: a.background + b.background, words: a.words + b.words }), NO_OWN_LOOKS);
}

/** The visible actions' own looks, per action class (registered by the
 * Sensor Reading and Sensor Dial actions), and what each does on a reset. */
export interface LooksPort {
	/** The visible actions of this class that keep their own looks. */
	count(): OwnLooksCount;
	/** Drops every visible action's own looks stamped before `gen`: one
	 * settings write per action, a strip through its single writer. */
	sweep(gen: number): void;
}

const ports: LooksPort[] = [];

export function registerLooksPort(port: LooksPort): void {
	ports.push(port);
}

/** The count line's numbers, over every registered action class. */
export function ownLooksCount(): OwnLooksCount {
	return sumOwnLooks(ports.map((p) => p.count()));
}

/** Runs every action class's sweep at the generation in force. */
export function sweepOwnLooks(gen: number = shared.resetGen): void {
	if (gen <= 0) return;
	for (const port of ports) {
		try {
			port.sweep(gen);
		} catch (err) {
			console.error("looks reset sweep failed", err);
		}
	}
}
