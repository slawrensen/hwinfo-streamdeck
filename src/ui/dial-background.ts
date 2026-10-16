/**
 * Dial backgrounds (issue #41): what a Sensor Dial draws behind its readout
 * on the touch strip. Theme, the default, fills the 200 x 100 slot with the
 * theme's background. The other three let the picture set for the strip in
 * the Stream Deck app show behind the dial:
 *
 *   Glass    the theme background as a panel at 80 % (glass.ts);
 *   Outline  no background; one filter pass grows every word and mark by a
 *            1 px edge, black on the dark themes, the background on Paper;
 *   Clear    no background and no edge; every word in one ink.
 *
 * One exact-value reader decides, and anything it does not know draws Theme
 * byte for byte, so a rollback or a hand edit degrades to today's face. The
 * renderers branch on the traits below, not on the names, so another look
 * is one row.
 *
 * Cost on the app's QtSvg (the issue #41 study, measured): a text element
 * costs one full layout and draw, a masked group one offscreen pass, and a
 * shape under fill-opacity a slower path. That is what made the first
 * outline 7 to 13 times today's face: each word drawn nine times, rows in
 * masks. None of these looks draws a mask or a copy of a word. The overflow
 * windows a Theme face covers with background-colored rects stay empty,
 * because every run that could reach one is cut to fit instead (the
 * renderers' cut-not-mask fit). Outline's edge is one filter pass over the
 * finished drawing, about one extra full-face draw however much text there
 * is.
 */
import { svgOpen } from "./key-renderer";
import { GLASS_INK, glassOpen, glassTextPalette } from "./glass";
import { luminance, pictureText, resolveTextColors, type TextColors, type TextSettings } from "./text-colors";
import type { Palette } from "./themes";

export type DialBackground = "theme" | "glass" | "outline" | "clear";

/** The panel's order, from no picture to the picture untouched. */
export const DIAL_BACKGROUNDS: readonly DialBackground[] = ["theme", "glass", "outline", "clear"];

/** The one reader of DialSettings.dialBackground. Settings are untyped JSON:
 * only the exact stored strings count; absent, "theme", a case or space
 * variant, a retired or newer name and every non-string draw Theme. */
export function dialBackgroundOf(raw: unknown): DialBackground {
	return raw === "glass" || raw === "outline" || raw === "clear" ? raw : "theme";
}

export type DialBackgroundTraits = {
	/** What fills the slot: the theme's opaque rect, the glass panel, or
	 * nothing (the picture). */
	readonly base: "opaque" | "panel" | "none";
	/** Track-token structure (bar track, rail groove, separators, the
	 * selected two-row band, the trend's shaded area and a status face's
	 * empty bar) draws in the label token at 20 % instead. */
	readonly ink: boolean;
	/** The background-colored rects that hide a label, second line or trend
	 * running past its fit. Without them the cut-not-mask fit applies. */
	readonly overflowRects: boolean;
	/** Every mark inside the halo group gets the 1 px edge of one filter
	 * pass; the bar gets a rim of the same color. */
	readonly halo: boolean;
	/** The 200 x 40 band behind the selected two-row row. */
	readonly band: boolean;
	/** The shaded area under a two-row trend line. */
	readonly underFill: boolean;
	/** The empty bar a status or problem face draws. */
	readonly statusBar: boolean;
	/** Graphics sit on track 1 px wider than themselves: the bar groove, a
	 * 5 px three-row groove and a backing under the two-row rail. */
	readonly backings: boolean;
};

const TRAITS: Readonly<Record<DialBackground, DialBackgroundTraits>> = {
	theme: { base: "opaque", ink: false, overflowRects: true, halo: false, band: true, underFill: true, statusBar: true, backings: false },
	glass: { base: "panel", ink: true, overflowRects: false, halo: false, band: true, underFill: true, statusBar: true, backings: false },
	outline: { base: "none", ink: false, overflowRects: false, halo: true, band: false, underFill: false, statusBar: false, backings: false },
	clear: { base: "none", ink: false, overflowRects: false, halo: false, band: false, underFill: true, statusBar: false, backings: true }
};

export function dialBackgroundTraits(background: DialBackground | undefined): DialBackgroundTraits {
	return TRAITS[background ?? "theme"];
}

/** Emoji and symbols drawn by a fallback font advance up to 16.75 px at the
 * 12 px basis in QtSvg 6.9.3 (measured: U+2699, U+1F600, U+23F0, U+1F5A5),
 * where the tables guess 9.1 (Segoe UI) or 12.35 (Tahoma). A face with no
 * overflow rects prices them at this width wherever a Theme face relies on
 * one. */
export const SEE_THROUGH_FALLBACK_ADVANCE_12 = 16.8;

/**
 * The edge color of an Outline face: black when the theme background is
 * dark, the theme background when it is light (Paper). Black sits at or
 * below every dark theme's background, so each text color reads at least
 * as well against it as on the theme face, and the filter needs no color
 * step for it.
 */
export function haloRingColor(palette: { bg: string }): string {
	return luminance(palette.bg) < 0.18 ? "#000000" : palette.bg;
}

/**
 * The Outline filter. The face draws every mark once, inside one group;
 * this grows the drawn shape by one pixel all round (a 3 x 3 dilation, one
 * pass across and one pass down) and lays it in the ring color under the
 * drawing. Each shifted text copy costs a full text layout on the app's
 * QtSvg, while the filter shifts finished pixels; paint-order is no option
 * there (ignored), a stroke wider than 1 px takes the slow path renderer,
 * and feMorphology is not supported.
 *
 * A black ring reads the drawn alpha straight; a light ring floods its color
 * into the drawn shape first ("in" reads only the alpha of SourceGraphic, so
 * no SourceAlpha buffer is built for it). The last merge lists the three
 * dilation layers three times: stacked, the ring's antialiased outer pixel
 * turns nearly solid, so the ring holds over a bright picture for a few
 * microseconds. Zero offsets are left out (the default, measured 6 %
 * cheaper and pixel-identical). The region, in user units, must hold
 * everything the group draws plus its ring: nothing outside it is drawn.
 */
export function haloFilterDefs(ring: string, top: number, height: number): string {
	const black = ring === "#000000";
	const src = black ? "SourceAlpha" : "k";
	const node = (input: string): string => `<feMergeNode in="${input}"/>`;
	const ringLayers = `${node("c")}${node("d")}${node("q")}`;
	return [
		`<defs><filter id="h" filterUnits="userSpaceOnUse" x="0" y="${top}" width="200" height="${height}" color-interpolation-filters="sRGB">`,
		black ? "" : `<feFlood flood-color="${ring}"/><feComposite in2="SourceGraphic" operator="in" result="k"/>`,
		`<feOffset in="${src}" dx="-1" result="a"/><feOffset in="${src}" dx="1" result="b"/>`,
		`<feMerge result="q">${node("a")}${node("b")}${node(src)}</feMerge>`,
		'<feOffset in="q" dy="-1" result="c"/><feOffset in="q" dy="1" result="d"/>',
		`<feMerge>${ringLayers}${ringLayers}${ringLayers}${node("SourceGraphic")}</feMerge>`,
		"</filter></defs>"
	].join("");
}

/** Opens the group the Outline filter draws; HALO_CLOSE ends the face. */
export const HALO_GROUP = '<g filter="url(#h)">';
export const HALO_CLOSE = "</g></svg>";

/** The face's opening: the SVG header, then what fills the slot. An Outline
 * face takes its filter region from the caller (the one-reading view's
 * text band, or the whole slot). */
export function dialFaceOpen(background: DialBackground | undefined, palette: Palette, haloTop = 0, haloHeight = 100): string[] {
	const [head, opaque] = svgOpen(200, 100, palette.bg) as [string, string];
	switch (background ?? "theme") {
		case "glass":
			return [head, glassOpen(palette)];
		case "outline":
			return [head, haloFilterDefs(haloRingColor(palette), haloTop, haloHeight)];
		case "clear":
			return [head];
		default:
			return [head, opaque];
	}
}

/** The fill attribute of structure a Theme face draws in the track token. */
export function structureFill(background: DialBackground | undefined, palette: Palette): string {
	return dialBackgroundTraits(background).ink ? GLASS_INK : `fill="${palette.track}"`;
}

/** The palette text resolves on: Glass resolves on its hardest panel and
 * band (glass.ts); every other look on the theme's own tokens. */
export function dialTextPalette(background: DialBackground | undefined, palette: Palette): Palette {
	return background === "glass" ? glassTextPalette(palette) : palette;
}

/** The see-through looks' text rule over resolved colors (see pictureText):
 * Outline steps units 30 % toward the surface, Clear draws one ink. */
export function dialPictureText(background: DialBackground | undefined, text: TextColors, surface: string, settings: TextSettings): TextColors {
	if (background === "outline") return pictureText(text, surface, settings, 0.3);
	if (background === "clear") return pictureText(text, surface, settings, 0);
	return text;
}

/** A face's text colors under a Text setting, for the look it is drawn in.
 * Theme resolves exactly as before. */
export function dialTextColors(background: DialBackground | undefined, palette: Palette, settings: TextSettings): TextColors {
	const textPalette = dialTextPalette(background, palette);
	return dialPictureText(background, resolveTextColors(textPalette, settings, "normal"), textPalette.bg, settings);
}
