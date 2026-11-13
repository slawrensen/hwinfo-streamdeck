/**
 * Key backgrounds: what a Sensor Reading key draws behind its readout. Theme,
 * the default, fills the 144 x 144 face with the theme background. The other
 * four draw a see-through face, meant for the page background set in the
 * Stream Deck app (right-click a key, Set from File...: a picture across
 * every key of the page, since Stream Deck 6.6). That the app composites a
 * key image's alpha over that picture is not yet checked on a deck; the
 * renderer tests prove only what the face draws. They are the dial looks
 * (dial-background.ts, issue #41) on a key:
 *
 *   Glass    the theme background as a panel at 80 % (glass.ts);
 *   Tint     the theme background as a panel at 50 %, under Outline's edge;
 *   Outline  no background; one filter pass grows every word and mark by a
 *            1 px edge, black on the dark themes, the background on Paper;
 *   Clear    no background and no edge; every word in one ink, except a
 *            quad's cell colors: on the four-reading key the cell color
 *            (the default variant's values, the labeled variant's
 *            micro-labels) is which reading is which, so it stays, lifted
 *            as on Theme when automatic and exact when chosen.
 *
 * The art looks (deck-art.ts ART_LOOKS: Stars, Dusk, Nebula) are not
 * see-through: they draw their own
 * picture, one scene across the deck cut to each key's published rect on
 * the device's panel. They share the see-through structure (no masks) and
 * resolve text on the brightest color the art can put under it. The face
 * carries a marker rect in the theme background that the action replaces
 * with the key's piece when it sends the face (paintArt), and on a light
 * theme the look draws Theme (lookOn).
 *
 * One exact-value reader decides (keyBackgroundOf), and anything it does not
 * know draws Theme byte for byte, so a rollback or a hand edit degrades to
 * today's face. A key with no look of its own follows the shared default
 * (keyBackgroundFor, shared-looks.ts), Theme when none is stored. On Glass,
 * Tint and Outline, Words in the accent color (keyAccentWords, its own
 * boolean or the shared default) changes word fills and nothing else.
 *
 * An alerting key keeps today's face whatever the look: on a key the alert
 * IS the background (the whole face takes the warn or critical field), so a
 * see-through alert would lose its signal. The composers pass the look only
 * at the normal level (lookAtLevel).
 *
 * Masks. A Theme face hides structure under background-colored rects in
 * three places: the stat badge's gap in a divider, cross or ring crown, the
 * return hook's gap at a divider's left end, and the corner a graph strip
 * shares with the hook on a Back tile. A see-through face has no background
 * color to paint, so it leaves the gaps out of the structure itself (a
 * divider drawn in two pieces, a ring in two arcs) and, on a Back tile, sets
 * the strip clear of the hook. The three-row key's value mask goes, and its
 * labels are cut to fit instead (the dial's cut-not-mask rule).
 */
import { artMark } from "./deck-art";
import { dialBackgroundOf, dialTextColors, dialTextPalette, HALO_CLOSE, HALO_GROUP, haloFilterDefsAt, haloRingColor, lookOn, type DialBackground } from "./dial-background";
import { flatPaint, GLASS_INK, GLASS_INK_OPACITY, GLASS_OPACITY, TINT_OPACITY } from "./glass";
import type { AlertLevel } from "./format";
import { appliedTextMode, readableValueColor, resolveTextColors, type TextColors, type TextSettings } from "./text-colors";
import type { Palette } from "./themes";
import { keyAccentWordsFor, keyBackgroundFor } from "./shared-looks";

export type KeyBackground = DialBackground;

/** The one reader of ReadingSettings.keyBackground. Settings are untyped
 * JSON: only the exact stored strings "glass", "tint", "outline", "clear",
 * and the art looks (deck-art.ts ART_LOOKS) count; absent, "theme", a case or space variant, a retired or
 * newer name and every non-string draw Theme. */
export function keyBackgroundOf(raw: unknown): KeyBackground {
	return dialBackgroundOf(raw);
}

/** The one reader of ReadingSettings.keyAccentWords: only the exact boolean
 * true counts, and Theme and Clear ignore it. */
export function keyAccentWordsOf(raw: unknown): boolean {
	return raw === true;
}

/** The look a face draws at an alert level: the stored look while the key
 * is normal, Theme while it alerts (the alert field is the signal). */
export function lookAtLevel(look: KeyBackground, level: "normal" | "warn" | "crit"): KeyBackground {
	return level === "normal" ? look : "theme";
}

/** True for the looks that draw no Theme field: the four that let the page
 * background show, and the art looks, whose backdrop is their own. All of
 * them draw structure without the Theme face's background-colored masks. */
export function seeThrough(look: KeyBackground | undefined): boolean {
	return look !== undefined && look !== "theme";
}

/** True for the looks that draw Outline's edge (Tint and Outline). */
export function haloLook(look: KeyBackground | undefined): boolean {
	return look === "tint" || look === "outline";
}

/** The fill attribute of structure a Theme face draws in the track token
 * (dividers, the cross, separators, the bar and ring track, the graph's
 * shaded area): label ink at 20 % on Glass, the track elsewhere. */
export function keyStructureFill(look: KeyBackground | undefined, palette: Palette): string {
	return look === "glass" ? GLASS_INK : `fill="${palette.track}"`;
}

/** The same structure as a paint for a stroke (the ring track). */
export function keyStructurePaint(look: KeyBackground | undefined, palette: Palette): string {
	return look === "glass" ? "url(#i)" : palette.track;
}

/** The graph's shaded area: Theme and Glass keep it (Glass in ink), Clear
 * keeps it in the track, Tint and Outline leave it out (the dial's
 * underFill trait: under the edge it reads as a dark slab). */
export function keyUnderFill(look: KeyBackground | undefined, palette: Palette): string | null {
	return haloLook(look) ? null : keyStructureFill(look, palette);
}

const KEY = 144;

/**
 * Builds one key face in the order a look needs. Theme, Glass and Clear
 * keep the composer's own order: every part lands where it was pushed, so a
 * Theme face is byte for byte today's. Tint and Outline put structure (the
 * snooze band, dividers, the cross and separators) under one filter group
 * that holds every word and mark, so structure keeps its hairline width and
 * the edge is one filter pass over the drawing. A face with nothing to edge
 * (a blank tile) carries no filter.
 */
export class KeyFace {
	private readonly head: string;
	private readonly fill: string[];
	private readonly halo: string | null;
	private readonly under: string[] = [];
	private readonly marks: string[] = [];

	constructor(look: KeyBackground | undefined, palette: Pick<Palette, "bg" | "label">) {
		const { bg } = palette;
		this.head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${KEY} ${KEY}" width="${KEY}" height="${KEY}">`;
		const kind = look ?? "theme";
		switch (kind) {
			case "glass":
				this.fill = [`<defs>${flatPaint("p", bg, GLASS_OPACITY)}${flatPaint("i", palette.label, GLASS_INK_OPACITY)}</defs><rect width="${KEY}" height="${KEY}" fill="url(#p)"/>`];
				this.halo = null;
				break;
			case "tint":
				this.fill = [`<defs>${flatPaint("t", bg, TINT_OPACITY)}</defs><rect width="${KEY}" height="${KEY}" fill="url(#t)"/>`];
				this.halo = haloFilterDefsAt(haloRingColor({ bg }), 0, 0, KEY, KEY);
				break;
			case "outline":
				this.fill = [];
				this.halo = haloFilterDefsAt(haloRingColor({ bg }), 0, 0, KEY, KEY);
				break;
			case "clear":
				this.fill = [];
				this.halo = null;
				break;
			case "stars":
			case "nebula":
			case "dusk":
				this.fill = [artMark(kind, KEY, KEY, palette)];
				this.halo = null;
				break;
			default:
				this.fill = [`<rect width="${KEY}" height="${KEY}" fill="${bg}"/>`];
				this.halo = null;
		}
	}

	/** A word, graph or mark: inside the edge group on Tint and Outline. */
	mark(...parts: string[]): void {
		this.marks.push(...parts);
	}

	/** Structure that keeps its hairline under the edge group on Tint and
	 * Outline; in place everywhere else. */
	structure(...parts: string[]): void {
		(this.halo === null ? this.marks : this.under).push(...parts);
	}

	end(): string {
		if (this.halo === null || this.marks.length === 0) return [this.head, ...this.fill, ...this.under, ...this.marks, "</svg>"].join("");
		return [this.head, ...this.fill, this.halo, ...this.under, HALO_GROUP, ...this.marks, HALO_CLOSE].join("");
	}
}

/** Opens a face for a look over a palette. */
export function keyFace(look: KeyBackground | undefined, palette: Pick<Palette, "bg" | "label">): KeyFace {
	return new KeyFace(look, palette);
}

/**
 * A key face's text colors under a Text setting, for the look it is drawn
 * in: the dial rule (dialTextColors: Glass resolves on its hardest panel,
 * Tint and Outline step units toward the surface, Clear draws one ink, and
 * accent words where the look takes them), plus the stat badge, which is a
 * word on a key: lifted to the numeric floor on the look's text surface, or
 * the one ink on Clear. Theme resolves exactly as before, and a Custom text
 * color stays exact on every look.
 */
export function keyTextColors(look: KeyBackground | undefined, palette: Palette, settings: TextSettings, accent = false): TextColors {
	// A pure function of its inputs, asked for on every frame: the readable
	// lifts are binary searches, and a deck draws only a handful of
	// combinations.
	const key = `${look}|${accent}|${settings.mode}|${settings.color}|${settings.dimSecondary}|${palette.bg}${palette.track}${palette.value}${palette.label}${palette.unit}${palette.accent}`;
	const cached = TEXT_CACHE.get(key);
	if (cached !== undefined) return cached;
	if (TEXT_CACHE.size >= 128) TEXT_CACHE.clear();
	const resolved = keyTextColorsOf(look, palette, settings, accent);
	TEXT_CACHE.set(key, resolved);
	return resolved;
}

const TEXT_CACHE = new Map<string, TextColors>();

function keyTextColorsOf(look: KeyBackground | undefined, palette: Palette, settings: TextSettings, accent: boolean): TextColors {
	const text = dialTextColors(look, palette, settings, accent);
	if (!seeThrough(look) || appliedTextMode(settings) === "custom") return text;
	return { ...text, badge: look === "clear" ? text.value : readableValueColor(text.badge, dialTextPalette(look, palette).bg) };
}

/** The palette a quad cell's identity color resolves on: Glass's hardest
 * panel, the theme's own background elsewhere. */
export function keyIdentitySurface(look: KeyBackground | undefined, palette: Palette): Palette {
	return dialTextPalette(look, palette);
}

/**
 * The look a key face draws in and its text colors, from the stored
 * settings: the key's own look and Words, else the shared defaults
 * (shared-looks.ts). The look applies at the normal level only: an alerting
 * face keeps today's field, the alert's own signal. Theme resolves exactly
 * as before (resolveTextColors at the face's level).
 */
export function keyLookOf(settings: { keyBackground?: unknown; keyAccentWords?: unknown }, palette: Palette, textSettings: TextSettings, level: AlertLevel): { background: KeyBackground; text: TextColors } {
	const background = lookOn(lookAtLevel(keyBackgroundFor(settings.keyBackground), level), palette);
	if (background === "theme") return { background, text: resolveTextColors(palette, textSettings, level) };
	return { background, text: keyTextColors(background, palette, textSettings, keyAccentWordsFor(settings.keyAccentWords)) };
}

/** The renderer option for a look: nothing for Theme, so a Theme face's
 * options stay exactly what they were. */
export function backgroundOption(background: KeyBackground): { background?: KeyBackground } {
	return background === "theme" ? {} : { background };
}
