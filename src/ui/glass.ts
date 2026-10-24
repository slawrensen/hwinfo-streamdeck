/**
 * Glass dial background (issue #41). The picture set for the touch strip in
 * the Stream Deck app shows through a translucent panel in the theme's own
 * background color, instead of the opaque theme background.
 *
 * The plugin cannot read that picture, so a glass face never resolves text
 * against the theme background. It resolves against the hardest panel any
 * picture can make: the panel over pure white for a theme with light text,
 * over pure black for a theme with dark text (Paper). A color that reads at
 * the 4.5:1 floor there reads at least that well over every other picture,
 * because the composite is monotonic in the picture. The existing text
 * resolvers run unchanged; only the surface they resolve on changes.
 *
 * Drawing keeps the theme's real tokens: the panel, the accent graphics, the
 * alert fills and the zone shades. Structure the opaque face draws in the
 * track token (bar track, rail groove, separators, the selected two-row band
 * and the trend under-fill) draws in the label token at low opacity.
 *
 * Cost on the app's QtSvg: both translucent paints are flat two-stop
 * gradients. A gradient carries its alpha in the brush; fill-opacity sets
 * the painter's opacity, which sends a shape down a slower path (the
 * two-row trend's shaded area cost about 50 us more that way, measured).
 * No masks, no group opacity, no filters: the overflow windows an opaque
 * face covers with background-colored rects stay empty, because every run
 * that could reach them is cut to fit instead (dial-renderer.ts).
 */
import { contrastRatio, luminance, readableColor, readableValueColor } from "./text-colors";
import type { Palette } from "./themes";

/** The panel: the theme background at 80 %, the picture at 20 %. 0.80 is
 * the lowest opacity where Graphite's critical red keeps about half its
 * chroma on the hardest panel; below about 0.67 the lift primitive turns
 * Graphite's light text dark (issue #41 study v2, colormath). */
export const GLASS_OPACITY = 0.8;

/** Structure ink: the theme label color at this opacity over the panel. On a
 * black picture it lands within a few levels of the theme's track color. */
export const GLASS_INK_OPACITY = 0.2;

/** QtSvg blends in 8-bit integers, so the hardest panel assumes each layer
 * two steps off nominal, in whichever direction hurts the text. */
const ALPHA_SLACK = 2;

/** The label keeps the theme's own step over the unit only while the value
 * stays at least this many times the label's contrast: never less title to
 * value hierarchy than the first study's glass kept on Graphite (1.76). */
const VALUE_OVER_LABEL = 1.75;

/** Source-over of `top` at `alpha8`/255 on `under`, per 8-bit sRGB channel,
 * rounded toward the extreme the text must beat. */
function over(top: string, alpha8: number, under: string, roundUp: boolean): string {
	const a = Math.max(0, Math.min(255, alpha8)) / 255;
	const channel = (offset: number): string => {
		const mixed = parseInt(top.slice(offset, offset + 2), 16) * a + parseInt(under.slice(offset, offset + 2), 16) * (1 - a);
		const rounded = roundUp ? Math.ceil(mixed - 1e-9) : Math.floor(mixed + 1e-9);
		return Math.max(0, Math.min(255, rounded)).toString(16).padStart(2, "0").toUpperCase();
	};
	return `#${channel(1)}${channel(3)}${channel(5)}`;
}

export type GlassSurfaces = {
	/** The panel over the picture that is hardest for this theme's text. */
	surface: string;
	/** The selected two-row band: structure ink over that panel. */
	band: string;
};

export function glassSurfaces(palette: Palette): GlassSurfaces {
	const lightText = luminance(palette.value) > luminance(palette.bg);
	const surface = over(palette.bg, Math.round(GLASS_OPACITY * 255) - ALPHA_SLACK, lightText ? "#FFFFFF" : "#000000", lightText);
	return { surface, band: over(palette.label, Math.round(GLASS_INK_OPACITY * 255) + ALPHA_SLACK, surface, lightText) };
}

/**
 * The palette a glass face resolves its text on: bg and track become the
 * hardest panel and band, the value lifts to the floor on the band (the
 * harder of the two), and the label keeps the theme's step over the unit
 * where the value can afford it. Theme, Dim, Custom, sensor-type, alert and
 * selected-row colors then resolve through the existing code.
 */
export function glassTextPalette(palette: Palette): Palette {
	const { surface, band } = glassSurfaces(palette);
	const value = readableValueColor(palette.value, band);
	const unit = readableValueColor(palette.unit, palette.bg);
	const step = Math.max(1, contrastRatio(palette.label, palette.bg) / contrastRatio(unit, palette.bg));
	const labelFloor = Math.max(4.5, Math.min(4.5 * step, contrastRatio(value, surface) / VALUE_OVER_LABEL));
	return { ...palette, bg: surface, track: band, value, label: readableColor(palette.label, surface, labelFloor) };
}

/** A flat translucent paint: one color at one opacity, as a vertical
 * two-stop gradient in user space (the form measured cheapest). */
function flatPaint(id: string, color: string, opacity: number): string {
	const stop = (offset: number): string => `<stop offset="${offset}" stop-color="${color}" stop-opacity="${opacity}"/>`;
	return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100">${stop(0)}${stop(1)}</linearGradient>`;
}

/** What replaces the opaque background rect: the two paints, then the
 * panel over the whole slot. */
export function glassOpen(palette: Palette): string {
	return `<defs>${flatPaint("p", palette.bg, GLASS_OPACITY)}${flatPaint("i", palette.label, GLASS_INK_OPACITY)}</defs><rect width="200" height="100" fill="url(#p)"/>`;
}

/** Fill attribute for structure an opaque face draws in the track token. */
export const GLASS_INK = 'fill="url(#i)"';

/** Tint's panel: the theme background at 50 %, the picture at 50 %. Too
 * light for text to resolve on the hardest panel the way Glass's does (below
 * about 0.67 Graphite's light text would turn dark), so a Tint face keeps
 * the theme's text and draws Outline's edge over the panel instead. */
export const TINT_OPACITY = 0.5;

/** What replaces the opaque background rect on a Tint face: one flat paint
 * over the whole slot, the same form as Glass's panel. */
export function tintOpen(palette: Palette): string {
	return `<defs>${flatPaint("t", palette.bg, TINT_OPACITY)}</defs><rect width="200" height="100" fill="url(#t)"/>`;
}
