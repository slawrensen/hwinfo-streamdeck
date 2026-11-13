/**
 * Deck backgrounds: Stars, Dusk and Nebula, pictures the plugin draws
 * itself behind every key and dial readout of a deck, as one scene across
 * the device's whole display.
 *
 * On every current display deck the keys and the touch strip are windows
 * onto one LCD, and Elgato publishes where each key and the strip sit on it
 * (the HID docs' "Unit Pixel Layout" diagrams). A scene is drawn once in
 * those LCD pixels for the whole panel and cut per face: a key shows the
 * scene inside its own published rect, a dial or strip slice the 200 x 100
 * of the strip above its encoder. The pixels under the bezels are simply
 * never drawn, so a gradient or a line that leaves one key enters the next
 * exactly where the glass would show it. That the app maps a face 1:1 onto
 * its published rect is the bench alignment check (artAlignment,
 * HWINFO_BG_ALIGNMENT=1).
 *
 * A face that cannot be placed (an unknown device, a grid that does not
 * match the table, a key with no coordinates inside a Multi Action) draws
 * the look on its own, from its own seed, with no claim to line up.
 *
 * How a face carries its piece. The renderers stay pure and know nothing of
 * where a face sits: an art look opens its face with a marker rect in the
 * theme background (artMark), the see-through structure (no masks, cut not
 * mask) and its text resolved on the look's ceiling. The composer stamps the
 * action's Sky into the marker (withArtSky); the action that sends the face
 * knows the device and the coordinates and replaces the marker with the
 * piece (paintArt) just before the byte dedupe. A face without the marker
 * passes through untouched, so every Theme, Glass, Tint, Outline and Clear
 * face keeps its bytes.
 *
 * Every look is two layers. The field: soft light that may sit under
 * words, at most two gradients per face, in the theme's art hue and one
 * neighbour, alpha only in stop-opacity. The marks: stars, which never sit
 * in a word's box and never cross a face edge (artPiece's quiet boxes).
 *
 * - Stars: a faint diagonal band (one gradient) and a seeded starfield.
 * - Dusk: the light of a sun just set, one radial field rising from under
 *   the panel's bottom edge, its hue drifting 30 degrees up the sky; every
 *   row of keys takes its own step of the light.
 * - Nebula: soft clouds in two cool hues, normalized so their total
 *   coverage stays under the theme's reach at every point.
 *
 * Contrast holds by construction, the Glass principle (glass.ts): text
 * resolves on the brightest color the art can put under any text (the
 * ceiling, artCeiling), one per look and theme, known in closed form. No
 * look's ceiling is brighter than Nebula's on the same theme (fieldStrength
 * holds Dusk under it), so no label lifts further than it does on Nebula.
 *
 * The Sky (ArtSky), the same two options for every look, two settings in
 * the panel: Stars (all, the brightest fifth of the same ones, off: the
 * field alone; the Stars look keeps at least the fifth, drawnStars) and Sky
 * color (the theme's, Deep, Warmer, Cooler or Mono; stored theme, deep,
 * warm, cool, mono). Fewer stars are a subset of more, so they never cost
 * more. Every tone is held under the theme tone's ceiling, so the text never
 * depends on the choice; the option rides in the marker and only the painter
 * reads it. The default is today's look byte for byte.
 *
 * Cost: pure generated SVG, no image files. Pieces are cached strings per
 * (scene, rect, text boxes); a frame costs a regex over its text and one
 * string join. Gradients carry alpha in the brush (stop-opacity), never
 * fill-opacity, and there are no masks, filters, clip paths or strokes.
 */
import { estimateKeyTextWidth } from "./format";
import { contrastRatio, luminance, mixToward, readableColor, readableValueColor } from "./text-colors";
import type { Palette } from "./themes";

/** The looks the plugin draws itself. Every list of them (the marker, the
 * readers, the panels' lists, the strip's checks) reads this one. */
export const ART_LOOKS = ["stars", "dusk", "nebula"] as const;
export type ArtLook = (typeof ART_LOOKS)[number];

/** True for the looks the plugin draws itself. */
export function isArtLook(look: unknown): look is ArtLook {
	return (ART_LOOKS as readonly unknown[]).includes(look);
}

// ---- the Sky: how many stars, and which colors ----------------------------------

/** How many of a look's stars it draws (the panel's Stars), as stored: every
 * one (today's look), the brightest fifth of the same ones by rank (Few), or
 * none, the field alone (Off). Each amount draws a subset of the one before
 * it, so fewer stars never cost more. */
export const ART_STARS = ["all", "few", "off"] as const;
export type ArtStars = (typeof ART_STARS)[number];
/** The field's colors (the panel's Sky color), as stored: the theme's own
 * (the rule since 1.8.0), Deep (the same hues at about half the light over
 * a deeper base), warm (the panel's Warmer: both hues turned toward the warm
 * end of ART_HUES, softer), cool (Cooler: both turned toward teal and cyan)
 * or Mono (a silver-blue all but without color, the same on every theme:
 * starlight). */
export const ART_TONES = ["theme", "deep", "warm", "cool", "mono"] as const;
export type ArtTone = (typeof ART_TONES)[number];
export type ArtSky = { readonly tone: ArtTone; readonly stars: ArtStars };
export const DEFAULT_SKY: ArtSky = { tone: "theme", stars: "all" };

/** One stored Stars: an exact name, else null. */
export function artStarsOf(raw: unknown): ArtStars | null {
	return (ART_STARS as readonly unknown[]).includes(raw) ? (raw as ArtStars) : null;
}

/** One stored Sky color: an exact name, else null. */
export function artToneOf(raw: unknown): ArtTone | null {
	return (ART_TONES as readonly unknown[]).includes(raw) ? (raw as ArtTone) : null;
}

/** A scope's own Sky, per axis: null follows the shared one. */
export type OwnArtSky = { readonly tone: ArtTone | null; readonly stars: ArtStars | null };

/** A scope's own Sky from its stored fields: each axis its own exact name,
 * else null (absent, the empty value the panel's Default saves, a case or
 * space variant, a newer name). */
export function ownArtSkyOf(fields: { readonly stars?: unknown; readonly tone?: unknown }): OwnArtSky {
	return { tone: artToneOf(fields.tone), stars: artStarsOf(fields.stars) };
}

/** The Sky a scope draws: each axis its own, else the shared one. */
export function artSkyOf(own: OwnArtSky, shared: ArtSky = DEFAULT_SKY): ArtSky {
	const tone = own.tone ?? shared.tone;
	const stars = own.stars ?? shared.stars;
	return tone === DEFAULT_SKY.tone && stars === DEFAULT_SKY.stars ? DEFAULT_SKY : { tone, stars };
}

/** The stars a look draws for a stored amount: the Stars look keeps at
 * least Few (its Off would be Theme with a faint band), so "Background:
 * Stars" always draws stars; every other look draws the amount as stored. */
export function drawnStars(look: ArtLook, stars: ArtStars): ArtStars {
	return look === "stars" && stars === "off" ? "few" : stars;
}

/** The Sky's name in a marker: the tone (left out for the theme's), a
 * hyphen, the amount (left out for all); "" is the default. */
export function skyMark(sky: ArtSky): string {
	const tone = sky.tone === "theme" ? "" : sky.tone;
	const stars = sky.stars === "all" ? "" : sky.stars;
	return tone !== "" && stars !== "" ? `${tone}-${stars}` : tone + stars;
}

/** The Sky a marker name stands for (skyMark's inverse). */
function skyOfMark(mark: string): ArtSky {
	const [first, second] = mark.split("-") as [string, string | undefined];
	const tone = artToneOf(first);
	return { tone: tone ?? "theme", stars: artStarsOf(tone === null ? first : second) ?? "all" };
}

/** The art looks draw on the dark themes only. On a light background
 * (Paper) stars and clouds read as dust, so the look draws Theme there. */
export function artFits(palette: Pick<Palette, "bg">): boolean {
	return luminance(palette.bg) < 0.18;
}

// ---- panels ------------------------------------------------------------------

export type PanelRect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

export type DeckPanel = {
	/** A short name for caches and boards. */
	readonly id: string;
	/** The LCD in pixels. */
	readonly w: number;
	readonly h: number;
	/** The key image size in LCD pixels. */
	readonly key: number;
	readonly columns: number;
	readonly rows: number;
	readonly keyX: readonly number[];
	readonly keyY: readonly number[];
	/** The touch strip on the same LCD, 200 px per encoder; null when none. */
	readonly strip: PanelRect | null;
};

const range = (n: number, f: (i: number) => number): number[] => Array.from({ length: n }, (_, i) => f(i));

/**
 * The published panel layouts by DeviceType, in LCD pixels (Elgato HID
 * docs, "Unit Pixel Layout"). Every row sums to its LCD size except the
 * XL's width, where the diagram leaves 2 px unaccounted (14 + 8 x 96 +
 * 7 x 32 + 16 = 1022) and the Neo's, 1 px; both are drawn as published.
 */
export const DECK_PANELS: Readonly<Record<number, DeckPanel>> = {
	// Stream Deck MK.2 and the 15-key family.
	0: { id: "mk2", w: 480, h: 272, key: 72, columns: 5, rows: 3, keyX: range(5, (c) => 11 + 97 * c), keyY: range(3, (r) => 5 + 97 * r), strip: null },
	// Stream Deck XL.
	2: { id: "xl", w: 1024, h: 600, key: 96, columns: 8, rows: 4, keyX: range(8, (c) => 14 + 128 * c), keyY: range(4, (r) => 47 + 135 * r), strip: null },
	// Stream Deck +: the strip spans the panel's full width.
	7: { id: "plus", w: 800, h: 480, key: 120, columns: 4, rows: 2, keyX: [13, 232, 451, 670], keyY: [12, 172], strip: { x: 0, y: 380, w: 800, h: 100 } },
	// Stream Deck Neo: keys only (the info bar is the app's).
	9: { id: "neo", w: 480, h: 320, key: 96, columns: 4, rows: 2, keyX: range(4, (c) => 3 + 126 * c), keyY: [9, 135], strip: null },
	// Stream Deck + XL: gaps alternate 31 and 32 px across, 32, 30, 32 down.
	13: { id: "plusxl", w: 1280, h: 800, key: 112, columns: 9, rows: 4, keyX: range(9, (c) => 11 + 143 * c + Math.floor(c / 2)), keyY: [32, 176, 318, 462], strip: { x: 40, y: 674, w: 1200, h: 100 } }
};

/** The SDK's per-encoder canvas and its piece of the strip, in px. */
const SLICE = { w: 200, h: 100 } as const;
const KEY_FACE = 144;

/** Where a face sits, as the action knows it when it sends the face. */
export type ArtPlace = {
	/** DeviceType as reported, and the key grid the app reports. */
	readonly deviceType: number | undefined;
	readonly columns: number;
	readonly rows: number;
	/** The key's column and row, or the dial's column (row undefined). */
	readonly column: number | undefined;
	readonly row: number | undefined;
	/** The device id: one sky per deck, the same every launch. */
	readonly deviceSeed: string;
	/** The action's own id: the seed of a face that cannot be placed. */
	readonly ownSeed: string;
};

/** The place of a key (row given) or a dial (row null) from what the
 * device registry knows of its deck (src/devices.ts) and its coordinates. */
export function artPlace(device: { readonly id: string; readonly type: number | undefined; readonly columns: number; readonly rows: number }, coordinates: { readonly column: number; readonly row: number } | undefined, ownId: string, dial: boolean): ArtPlace {
	return { deviceType: device.type, columns: device.columns, rows: device.rows, column: coordinates?.column, row: dial ? undefined : coordinates?.row, deviceSeed: device.id, ownSeed: ownId };
}

/** A face's window onto a scene. */
export type ArtWindow = {
	/** The scene's panel: a real device's, or the face alone. */
	readonly panel: { readonly id: string; readonly w: number; readonly h: number };
	/** The face's rect on that panel, in panel pixels. */
	readonly rect: PanelRect;
	readonly seed: string;
	/** True when the rect is a published key or strip rect. */
	readonly aligned: boolean;
};

const whole = (n: unknown, below: number): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < below;

/** The published rect of a key, or null outside the table's grid. */
export function keyRect(panel: DeckPanel, column: number, row: number): PanelRect | null {
	if (!whole(column, panel.columns) || !whole(row, panel.rows)) return null;
	return { x: panel.keyX[column] as number, y: panel.keyY[row] as number, w: panel.key, h: panel.key };
}

/** The strip's piece above an encoder column, or null. */
export function sliceRect(panel: DeckPanel, column: number): PanelRect | null {
	const strip = panel.strip;
	if (strip === null || !whole(column, strip.w / SLICE.w)) return null;
	return { x: strip.x + SLICE.w * column, y: strip.y, w: SLICE.w, h: SLICE.h };
}

/**
 * Where a face of this size sits: a 144 x 144 face is a key, a 200 x 100
 * face a dial or strip slice. A key whose device reports a grid other than
 * the table's is not placed (a future revision of the same type would
 * otherwise claim an alignment it does not have).
 */
export function artWindow(place: ArtPlace, faceW: number, faceH: number): ArtWindow {
	const panel = place.deviceType === undefined || !Object.hasOwn(DECK_PANELS, place.deviceType) ? undefined : DECK_PANELS[place.deviceType];
	const strip = faceW === SLICE.w && faceH === SLICE.h;
	if (panel !== undefined && panel.columns === place.columns && panel.rows === place.rows && place.column !== undefined) {
		const rect = strip ? (place.row === undefined ? sliceRect(panel, place.column) : null) : place.row === undefined ? null : keyRect(panel, place.column, place.row);
		if (rect !== null) return { panel: { id: panel.id, w: panel.w, h: panel.h }, rect, seed: place.deviceSeed, aligned: true };
	}
	// Alone: a key's own 112 px (the + XL key, so stars keep their size),
	// a slice's own 200 x 100.
	const w = strip ? SLICE.w : 112;
	const h = strip ? SLICE.h : 112;
	return { panel: { id: `lone${w}x${h}`, w, h }, rect: { x: 0, y: 0, w, h }, seed: `${place.deviceSeed}:${place.ownSeed}`, aligned: false };
}

// ---- seeded randomness ----------------------------------------------------------

/** FNV-1a over UTF-16 code units: a stable 32-bit seed from a string. */
export function fnv1a(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
}

/** mulberry32: a small, fast, deterministic generator of [0, 1). */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ---- colors -------------------------------------------------------------------------

const channel = (c: string, i: number): number => parseInt(c.slice(1 + 2 * i, 3 + 2 * i), 16);
const hex2 = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0").toUpperCase();
const rgb = (r: number, g: number, b: number): string => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

/** Hue in degrees and HSL saturation of a #RRGGBB color. */
export function hueOf(color: string): { hue: number; saturation: number } {
	const [r, g, b] = [0, 1, 2].map((i) => channel(color, i) / 255) as [number, number, number];
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	const l = (max + min) / 2;
	if (d === 0) return { hue: 0, saturation: 0 };
	const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return { hue: (h * 60 + 360) % 360, saturation: d / (1 - Math.abs(2 * l - 1)) };
}

function hsl(h: number, s: number, l: number): string {
	const a = s * Math.min(l, 1 - l);
	const f = (n: number): number => {
		const k = (n + h / 30) % 12;
		return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
	};
	return rgb(f(0), f(8), f(4));
}

/** The color of hue h and saturation s whose luminance is `target`. */
function atLuminance(h: number, s: number, target: number): string {
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 20; i++) {
		const mid = (lo + hi) / 2;
		if (luminance(hsl(h, s, mid)) < target) lo = mid;
		else hi = mid;
	}
	return hsl(h, s, hi);
}

/**
 * Hues the art may use: at least 90 degrees from the warn hue (about 37,
 * #E8940D) and from the critical hue (about 3, #CB2114 and #FF3B30), so no
 * part of a background reads as an alert. 127 to 273 covers green through
 * violet; red, orange, amber, yellow and magenta are out.
 */
export const ART_HUES = { from: 130, to: 270 } as const;
/** The hue a theme with a warm or grey label takes (Ember): violet. */
const FALLBACK_HUE = 252;

export type ArtColors = {
	/** The theme background. */
	readonly bg: string;
	/** The two art hues (the Stars band and tints start from the first). */
	readonly primary: string;
	readonly secondary: string;
	/** Nebula's three cloud colors: the two hues at NEBULA_CLOUD_L and a
	 * bright knot of the first toward white. */
	readonly clouds: readonly [string, string, string];
	/** The band's glow and the star tints. */
	readonly band: string;
	readonly tints: readonly string[];
	/** The first and second art hues in this tone, the saturation and light
	 * factors the tone applies, and the tone: what the field looks derive
	 * from. */
	readonly hue: number;
	readonly hue2: number;
	readonly sat: number;
	readonly light: number;
	readonly tone: ArtTone;
};

/** Deep: every art color at this share of its luminance, over the look's
 * base this far again toward black. */
const DEEP = { light: 0.55, deepen: 0.45 } as const;
/** Warm: both hues turned this far toward the warm end of ART_HUES (270
 * from a blue or violet, 130 from a green), at this share of their
 * saturation; the share of the turn a hue cannot make, at the end of the
 * range, takes this much more off it. */
const WARM = { turn: 40, sat: 0.8, soften: 0.8 } as const;
/** Cool: both hues turned at most `turn` degrees toward the cyan `anchor`
 * (a blue theme's to cyan, a green one's to teal, a violet one's to blue),
 * the second kept `spread` from the first on its own side (a blue theme's
 * teal), at the theme's saturation. Dusk drifts to the second hue, not
 * 30 degrees on (neighbourHue): on a violet theme that would turn Cool's
 * sky back into the theme's own. */
const COOL = { anchor: 190, turn: 35, spread: 20 } as const;
/** Mono: a silver-blue on every theme, these two hues (the blue themes'
 * own) at this share of their saturation, near grey, so the field reads as
 * starlight; a violet, green or indigo theme's own hue that grey would read
 * as lavender, sage or taupe, too near Warm. */
const MONO = { hue: 215, hue2: 175, sat: 0.15 } as const;

const clampHue = (h: number): number => Math.max(ART_HUES.from, Math.min(ART_HUES.to, h));
/** h turned toward `to` by at most `most` degrees. */
const toward = (h: number, to: number, most: number): number => h + Math.max(-most, Math.min(most, to - h));

/** The art's colors from a theme's own background and label: the label's
 * hue when it is a cool one, indigo otherwise, at fixed luminances so a
 * green theme's clouds are no brighter than a blue theme's. A tone other
 * than the theme's moves the hues (Warm, Cool), the saturation (Mono) or
 * the light (Deep); `light` scales every luminance (toneColors holds a tone
 * under the ceiling). */
export function artColors(bg: string, label: string, tone: ArtTone = "theme", light = 1): ArtColors {
	const { hue, saturation } = hueOf(label);
	const own = saturation >= 0.04 && hue >= ART_HUES.from && hue <= ART_HUES.to ? hue : FALLBACK_HUE;
	const warm = (x: number): number => (tone === "warm" ? clampHue(x + (own >= 200 ? WARM.turn : -WARM.turn)) : x);
	// The second hue sits 40 to 50 degrees away, toward teal from a blue or
	// violet, toward blue from a green: two hues a glance tells apart.
	const second = own >= 200 ? own - 40 : own + 50;
	let h = warm(own);
	let h2 = warm(second);
	if (tone === "cool") {
		h = toward(own, COOL.anchor, COOL.turn);
		const turned = toward(second, COOL.anchor, COOL.turn);
		h2 = second < own ? Math.min(turned, h - COOL.spread) : Math.max(turned, h + COOL.spread);
	}
	if (tone === "mono") {
		h = MONO.hue;
		h2 = MONO.hue2;
	}
	// A theme already near the warm end (Ultraviolet, Forest, Ember) turns
	// less; the turn it cannot make softens its colors instead, so Warm is
	// always its own color.
	const sat = tone === "warm" ? WARM.sat * (1 - (WARM.soften * (WARM.turn - Math.abs(h - own))) / WARM.turn) : tone === "mono" ? MONO.sat : 1;
	const l = (tone === "deep" ? DEEP.light : 1) * light;
	const primary = atLuminance(h, 0.75 * sat, 0.2 * l);
	const secondary = atLuminance(h2, 0.7 * sat, 0.2 * l);
	const cloud = atLuminance(h, NEBULA_CLOUD_S * sat, NEBULA_CLOUD_L * l);
	const clouds = [cloud, atLuminance(h2, NEBULA_CLOUD_S2 * sat, NEBULA_CLOUD_L * l), mixToward(cloud, "#FFFFFF", KNOT_WHITE)] as const;
	return { bg, primary, secondary, clouds, band: mixToward(primary, "#FFFFFF", 0.45), tints: ["#FFFFFF", mixToward("#FFFFFF", primary, 0.22), "#FFF4E6"], hue: h, hue2: h2, sat, light: l, tone };
}

/** A color of hue h in the colors' tone: saturation and luminance as the
 * theme tone takes them, moved by the tone. */
const toned = (colors: ArtColors, h: number, s: number, l: number): string => atLuminance(h, Math.min(1, s * colors.sat), l * colors.light);

/** The hue 30 degrees on from the art hue, toward violet, or back the other
 * way where that would leave ART_HUES: the one neighbour a field drifts to. */
const neighbourHue = (h: number): number => (h + 30 > ART_HUES.to ? h - 30 : h + 30);

// ---- scenes -------------------------------------------------------------------------

/** A soft cloud: a radial gradient (one of the scene's profiles) on a
 * circle. */
type Blob = { readonly kind: "blob"; readonly cx: number; readonly cy: number; readonly r: number; readonly profile: number };
/** A star; `rank` (0 faint to 1 bright, its draw) picks the Few. */
type Star = { readonly kind: "star"; readonly x: number; readonly y: number; readonly size: number; readonly fill: string; readonly round: boolean; readonly glow: number; readonly rank: number };
type Item = Blob | Star;

/** A field's shape: [offset, share of the peak, color] stops from the
 * center out, the first one's share held inside it, the last at the rim; a
 * stop without a color takes the profile's. */
type Shape = readonly (readonly [number, number, string?])[];

/** A gradient profile: its color and its peak opacity, at the center (a
 * cloud) or along its shape. */
type Profile = { readonly color: string; readonly alpha: number; readonly shape?: Shape };

/** The cloud profile: full at the center, 60 % at 45 % of the radius,
 * nothing at the rim (a soft core with a long faint halo). */
const PROFILE_MID = { at: 0.45, of: 0.6 } as const;

function profileAt(t: number): number {
	if (t >= 1) return 0;
	if (t <= PROFILE_MID.at) return 1 - ((1 - PROFILE_MID.of) * t) / PROFILE_MID.at;
	return (PROFILE_MID.of * (1 - t)) / (1 - PROFILE_MID.at);
}

/** A profile's share of its peak at t (radius 1 at the rim). */
function shapeAt(p: Pick<Profile, "shape">, t: number): number {
	const s = p.shape;
	if (s === undefined) return profileAt(t);
	if (t >= 1) return 0;
	let [o0, f0] = s[0] as readonly [number, number, string?];
	if (t <= o0) return f0;
	for (const [o1, f1] of s) {
		if (t <= o1) return o1 === o0 ? f1 : f0 + ((f1 - f0) * (t - o0)) / (o1 - o0);
		[o0, f0] = [o1, f1];
	}
	return 0;
}

/** The most of its peak a profile reaches between t0 and t1. */
function shapeMax(p: Profile, t0: number, t1: number): number {
	if (p.shape === undefined) return profileAt(t0);
	let most = Math.max(shapeAt(p, t0), shapeAt(p, t1));
	for (const [o, f] of p.shape) if (o > t0 && o < t1) most = Math.max(most, f);
	return most;
}

/** Where a point sits in a blob, 0 at its center to 1 at its rim. */
function blobAt(b: Blob, x: number, y: number): number {
	return Math.hypot(x - b.cx, y - b.cy) / b.r;
}

/** The nearest and farthest a rect comes to a blob's center, in the blob's
 * own units (blobAt): near is 0 when the rect holds the center. */
function blobSpan(b: Blob, rect: PanelRect): [number, number] {
	const corners = [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x + rect.w, rect.y + rect.h], [rect.x, rect.y + rect.h]] as const;
	const far = Math.max(...corners.map(([x, y]) => blobAt(b, x, y)));
	return [Math.hypot(Math.max(rect.x - b.cx, 0, b.cx - (rect.x + rect.w)), Math.max(rect.y - b.cy, 0, b.cy - (rect.y + rect.h))) / b.r, far];
}

export type ArtScene = {
	readonly key: string;
	readonly look: ArtLook | "alignment";
	readonly bg: string;
	readonly profiles: readonly Profile[];
	/** The band (Stars): a linear gradient across the panel, or null. */
	readonly band: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly color: string; readonly alpha: number } | null;
	readonly items: readonly Item[];
	/** The alignment pattern's lines and circles, in panel pixels. */
	readonly ghost: string | null;
	/** The share of its field a strip slice draws (Dusk), 1 when absent. */
	readonly strip?: number;
};

/** The clouds' total coverage at any point stays under this, or under the
 * theme's lower reach (nebulaReach). 1.8.0's first candidate drew 0.27 of
 * clouds at luminance 0.2 and saturation 0.75 on a base 45 % toward black:
 * on a real deck they read too faint over the dark themes (owner,
 * 2026-10-26; the cloud peak 1.31 to 1.38:1 over the gaps on a + XL). Now
 * up to 0.4 of fully saturated clouds at 0.24 on a base 55 % toward black;
 * the text lifts further to keep its 4.5:1 on the higher ceiling. */
export const NEBULA_COVERAGE = 0.4;
/** Nebula's base: the theme background this far toward black. */
const NEBULA_DEEPEN = 0.55;
/** The luminance of Nebula's two cloud hues, and their saturations: full,
 * so a cloud reads by its color too, at a luminance the text can afford. */
const NEBULA_CLOUD_L = 0.24;
const NEBULA_CLOUD_S = 1;
const NEBULA_CLOUD_S2 = 1;
/** The bright knots: the primary hue this far toward white. */
const KNOT_WHITE = 0.08;

/** Nebula's base under its clouds: the theme background deepened. */
export function nebulaBase(bg: string): string {
	return mixToward(bg, "#000000", NEBULA_DEEPEN);
}

/** A look's base: the theme background (Stars) or Nebula's deepened one
 * (every field look), a Deep tone's further toward black. */
function groundOf(look: ArtLook, colors: ArtColors): string {
	const ground = look === "stars" ? colors.bg : nebulaBase(colors.bg);
	return colors.tone === "deep" ? mixToward(ground, "#000000", DEEP.deepen) : ground;
}

/** The Stars band's peak opacity. */
export const BAND_ALPHA = 0.14;
/** The sampled maximum of a cloud field can miss its true peak between
 * samples; the normalization keeps this much coverage in hand. */
const COVERAGE_MARGIN = 0.015;
/** QtSvg blends in 8-bit integers: the ceiling assumes each layer this
 * many steps of 255 brighter than nominal (glass.ts ALPHA_SLACK). */
const ALPHA_SLACK = 2 / 255;

/** Stars: one per this many square panel pixels (Dusk keeps its own to the
 * dark of its sky, so it draws fewer still). */
const STAR_DENSITY: Readonly<Record<ArtLook, number>> = { stars: 800, nebula: 3600, dusk: 4000 };

/** `accept` is the chance a star is kept where it falls, or null for all. */
function starfield(w: number, h: number, rnd: () => number, ground: string, colors: ArtColors, look: ArtLook, accept: ((x: number, y: number) => number) | null): Star[] {
	const n = Math.round((w * h) / STAR_DENSITY[look]);
	const out: Star[] = [];
	let tries = 0;
	while (out.length < n && tries < n * 8) {
		tries++;
		const x = Math.floor(rnd() * w);
		const y = Math.floor(rnd() * h);
		if (accept !== null && rnd() > accept(x, y)) continue;
		const u = rnd();
		// Most stars are faint and a pixel wide; one in four is brighter
		// and two pixels wide, and about one in twenty carries a faint glow.
		const bright = u ** 2.4;
		const b = (look === "stars" ? 1 : 0.9) * (0.34 + 0.66 * bright);
		const tint = colors.tints[Math.floor(rnd() * colors.tints.length)] as string;
		const size = bright > 0.5 ? 2 : 1;
		const glow = bright > 0.7 && rnd() < 0.4 ? 4 + Math.round(rnd() * 3) : 0;
		// Eight brightness steps keep the pieces short (fills repeat); Dusk,
		// whose stars are fewer and fainter, keeps four.
		const steps = look === "stars" || look === "nebula" ? 8 : 4;
		const level = Math.round(b * steps) / steps;
		out.push({ kind: "star", x, y, size, fill: mixToward(ground, tint, level), round: size > 1, glow, rank: u });
	}
	return out;
}

/** Few keeps the stars of at least this rank: the brightest fifth of the
 * same draw, so a star never moves when the amount changes, Few is a subset
 * of All, and the ones kept are the ones that show at arm's length. Off
 * keeps none, glows included. */
const FEW_RANK = 0.8;

function amountOf(stars: readonly Star[], amount: ArtStars): Star[] {
	if (amount === "all") return [...stars];
	if (amount === "off") return [];
	return stars.filter((s) => s.rank >= FEW_RANK);
}

/** Total cloud coverage at (x, y): 1 - product of (1 - alpha). */
function coverageAt(blobs: readonly Blob[], profiles: readonly Profile[], x: number, y: number): number {
	let keep = 1;
	for (const b of blobs) {
		const p = profiles[b.profile] as Profile;
		keep *= 1 - p.alpha * shapeAt(p, Math.hypot(x - b.cx, y - b.cy) / b.r);
	}
	return 1 - keep;
}

function nebulaBlobs(w: number, h: number, rnd: () => number): { blobs: Blob[]; weights: number[] } {
	// Clouds on a jittered grid of about 260 px cells, so the wash spreads
	// over the whole panel without piling up in one place (a pile would
	// force every cloud down when the field is normalized). Half the cells
	// stay empty: the dark gaps are what make the rest read as clouds across
	// the bezels. The two hues mix at random; a few small bright knots in a
	// lighter primary give it a core.
	const cols = Math.max(1, Math.round(w / 260));
	const rows = Math.max(1, Math.round(h / 260));
	const cw = w / cols;
	const ch = h / rows;
	const reach = Math.hypot(cw, ch);
	const cells: { blob: Blob; strength: number }[] = [];
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			const cx = Math.round(cw * (c + 0.1 + 0.8 * rnd()));
			const cy = Math.round(ch * (r + 0.1 + 0.8 * rnd()));
			const profile = rnd() < 0.55 ? 0 : 1;
			cells.push({ blob: { kind: "blob", cx, cy, r: Math.round(reach * (0.42 + 0.22 * rnd())), profile }, strength: rnd() });
		}
	}
	const kept = [...cells].sort((a, b) => b.strength - a.strength).slice(0, Math.max(1, Math.ceil(cells.length / 2))).map((cell) => cell.blob);
	const knots = Math.max(1, Math.round(cells.length / 6));
	for (let i = 0; i < knots; i++) {
		const host = kept[i % kept.length] as Blob;
		const angle = rnd() * 2 * Math.PI;
		kept.push({ kind: "blob", cx: Math.round(host.cx + Math.cos(angle) * host.r * 0.4), cy: Math.round(host.cy + Math.sin(angle) * host.r * 0.4), r: Math.round(reach * (0.18 + 0.08 * rnd())), profile: 2 });
	}
	return { blobs: kept, weights: [0.3, 0.3, 0.2] };
}

/** Scales the clouds' opacities until the sampled coverage plus the margin
 * stays under `reach` (the theme's nebulaReach) everywhere on the panel. */
function normalized(blobs: readonly Blob[], colors: readonly string[], weights: readonly number[], w: number, h: number, reach: number): Profile[] {
	let profiles: Profile[] = colors.map((color, i) => ({ color, alpha: weights[i] as number }));
	const step = Math.max(4, Math.round(Math.max(w, h) / 200));
	// Coverage grows less than linearly with opacity, so one scaling can
	// land a little high; a few passes settle it.
	for (let pass = 0; pass < 20; pass++) {
		let peak = 0;
		for (let y = 0; y <= h; y += step) for (let x = 0; x <= w; x += step) peak = Math.max(peak, coverageAt(blobs, profiles, x, y));
		for (const b of blobs) peak = Math.max(peak, coverageAt(blobs, profiles, b.cx, b.cy));
		if (peak + COVERAGE_MARGIN <= reach) break;
		const k = (reach - COVERAGE_MARGIN) / peak;
		profiles = profiles.map((p) => ({ color: p.color, alpha: Math.floor(p.alpha * k * 1000) / 1000 }));
	}
	return profiles;
}

// ---- the field look: Dusk ----------------------------------------------------------

const floor3 = (v: number): number => Math.floor(v * 1000) / 1000;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * Dusk: the light of a sun just set, one radial gradient on one circle in
 * panel pixels, its center under the panel's bottom edge at a place the
 * seed picks. The art hue lifted toward white at the horizon drifts to its
 * neighbour hue up the sky (the drift also keeps a long ramp from banding
 * in one channel), and the light falls in one smooth ramp up the deck: on
 * a + XL, over the sun, the two lower key rows at most of the peak, the
 * next at about half, the top row under a fifth. The peak is the most the
 * field lays anywhere, so its ceiling needs no sampling. Dusk takes the
 * full art color in every tone: held to a theme's own restraint (a grey
 * dusk on Void, a charcoal one on Ember) it sits too near the Theme deck
 * and Stars to tell apart (test/deck-art.test.ts, Dusk stays its own look).
 */
const DUSK = {
	/** The sun sits this share of the panel's height under its bottom edge. */
	sunk: 0.12,
	/** The field's radius, in panel heights. */
	radius: 1.3,
	/** The horizon color: the art hue this far toward white. */
	white: 0.15,
	/** [offset, share] after the horizon: a long bright ramp up to the third
	 * key row, then a fade over the top two. */
	stops: [[0.5, 0.85], [0.8, 0.12]],
	/** A strip slice draws the same field at this share of its light: the
	 * horizon sits at the bezel above the strip, and the strip is the dark
	 * ground under it, so it never reads as a slab behind the strip's words
	 * and its warn and crit bands keep their own hue. */
	strip: 0.2
} as const;

/** The field look: the one whose light fieldStrength holds under Nebula's
 * ceiling. */
type FieldLook = "dusk";
const isFieldLook = (look: ArtLook): look is FieldLook => look === "dusk";

/** Dusk's two colors, at Nebula's cloud saturation and luminance in the
 * tone: the horizon and the sky above it (Cool's sky is its own second
 * hue, COOL). */
function duskColors(colors: ArtColors): [string, string] {
	const upper = colors.tone === "cool" ? colors.hue2 : neighbourHue(colors.hue);
	return [mixToward(toned(colors, colors.hue, NEBULA_CLOUD_S, NEBULA_CLOUD_L), "#FFFFFF", DUSK.white), toned(colors, upper, NEBULA_CLOUD_S, NEBULA_CLOUD_L)];
}

/** The gradient layer Dusk draws under text, at strength k (the share of
 * its full opacity): what the scene draws and what its ceiling bounds.
 * Dusk's reach is Nebula's. */
function fieldLayers(_look: FieldLook, colors: ArtColors, reach: number, k: number): Profile[] {
	const [horizon, upper] = duskColors(colors);
	return [{ color: horizon, alpha: floor3(reach * k), shape: [[0, 1, horizon], ...DUSK.stops.map(([o, f]) => [o, f, upper] as const), [1, 0, upper]] }];
}

function duskScene(key: string, w: number, h: number, rnd: () => number, ground: string, colors: ArtColors, reach: number, k: number, amount: ArtStars): ArtScene {
	const sunk = Math.round(h * DUSK.sunk);
	const r = Math.round(h * DUSK.radius);
	const [layer] = fieldLayers("dusk", colors, reach, k) as [Profile];
	const shape = layer.shape as Shape;
	const profile: Profile = { ...layer, shape: [[round3(sunk / r), 1, shape[0]?.[2]], ...shape.slice(1)] };
	const blob: Blob = { kind: "blob", cx: Math.round(w * (0.3 + 0.4 * rnd())), cy: h + sunk, r, profile: 0 };
	// Early stars: in the dark of the sky, few where the light rises (the
	// shape alone, so a theme or a tone never moves one).
	const stars = starfield(w, h, rnd, ground, colors, "dusk", (x, y) => (1 - shapeAt(profile, blobAt(blob, x, y))) ** 3);
	return { key, look: "dusk", bg: ground, profiles: [profile], band: null, items: [blob, ...amountOf(stars, amount)], ghost: null, strip: DUSK.strip };
}

/**
 * The alignment pattern (bench only): 1 px lines at 45 degrees both ways
 * every 48 px and circles every 64 px around the panel's center, in the
 * accent over the theme background. Any offset between a face and its
 * published rect shows as a line that steps at the bezel.
 */
function ghostPattern(w: number, h: number): string {
	const d: string[] = [];
	for (let k = -h; k <= w + h; k += 48) {
		d.push(`M${k} 0L${k + h} ${h}`, `M${k} ${h}L${k + h} 0`);
	}
	const cx = w / 2;
	const cy = h / 2;
	const circles: string[] = [];
	for (let r = 64; r < Math.hypot(w, h) / 2; r += 64) circles.push(`<circle cx="${cx}" cy="${cy}" r="${r}"/>`);
	return `<path d="${d.join("")}" fill="none" stroke="#6FCFFF" stroke-width="1"/><g fill="none" stroke="#FFD166" stroke-width="1">${circles.join("")}</g><path d="M${cx} 0V${h}M0 ${cy}H${w}" stroke="#FFFFFF" stroke-width="1"/>`;
}

let alignment = false;

/** Bench only: every art look draws the alignment pattern instead of
 * its art. Set once at plugin start from HWINFO_BG_ALIGNMENT=1; nothing
 * in any panel reaches it. */
export function setArtAlignment(on: boolean): void {
	if (on !== alignment) SCENES.clear();
	if (on !== alignment) PIECES.clear();
	alignment = on;
}

export function artAlignment(): boolean {
	return alignment;
}

const SCENES = new Map<string, ArtScene>();

/** The scene of one look for one panel, seed, theme and Sky.
 * Deterministic: the same arguments always build the same scene. Every
 * look but Stars reaches as far as the theme's value color allows
 * (nebulaReach, fieldStrength); without it (`value` absent) Nebula keeps
 * to NEBULA_MIN_COVERAGE. The Sky picks the tone's colors and thins the
 * stars (on the Stars look, Off draws Few: drawnStars); star, cloud and
 * light places never depend on it or on the theme. */
export function artScene(look: ArtLook, panel: ArtWindow["panel"], seed: string, bg: string, label: string, value?: string, sky: ArtSky = DEFAULT_SKY): ArtScene {
	const kind = alignment ? "alignment" : look;
	const reach = kind === "stars" || kind === "alignment" ? 0 : value === undefined ? NEBULA_MIN_COVERAGE : nebulaReach({ bg, label, value });
	const k = isFieldLook(look) ? fieldStrength(look, bg, label, reach) : 1;
	const stars = drawnStars(look, sky.stars);
	const key = `${kind}|${panel.id}|${panel.w}x${panel.h}|${seed}|${bg}|${label}|${reach}|${k}|${sky.tone}-${stars}`;
	const known = SCENES.get(key);
	if (known !== undefined) return known;
	const scene = buildScene(kind, key, panel.w, panel.h, seed, toneColors(look, bg, label, reach, k, sky.tone), reach, k, stars);
	if (SCENES.size >= 64) SCENES.clear();
	SCENES.set(key, scene);
	return scene;
}

function buildScene(kind: ArtLook | "alignment", key: string, w: number, h: number, seed: string, colors: ArtColors, reach: number, k: number, stars: ArtStars): ArtScene {
	if (kind === "alignment") return { key, look: kind, bg: colors.bg, profiles: [], band: null, items: [], ghost: ghostPattern(w, h) };
	const rnd = mulberry32(fnv1a(`${kind}:${seed}`));
	// The gaps between clouds, and the dark of every field look's sky, go
	// deeper than the theme background, so the light reads at arm's length;
	// darker never costs text contrast.
	const ground = groundOf(kind, colors);
	if (kind === "nebula") {
		const { blobs, weights } = nebulaBlobs(w, h, rnd);
		const profiles = normalized(blobs, colors.clouds, weights, w, h, reach);
		return { key, look: kind, bg: ground, profiles, band: null, items: [...blobs, ...amountOf(starfield(w, h, rnd, ground, colors, kind, null), stars)], ghost: null };
	}
	if (kind === "dusk") return duskScene(key, w, h, rnd, ground, colors, reach, k, stars);
	// The band runs corner to corner, low left to high right, its axis
	// shifted a little by the seed; its gradient runs across it.
	const tilt = (rnd() - 0.5) * 0.3;
	const ax = 0;
	const ay = h * (0.95 + tilt);
	const bx = w;
	const by = h * (0.05 - tilt);
	const len = Math.hypot(bx - ax, by - ay);
	const nx = -(by - ay) / len;
	const ny = (bx - ax) / len;
	const mx = (ax + bx) / 2;
	const my = (ay + by) / 2;
	const half = Math.min(w, h) * 0.34;
	const near = (x: number, y: number): number => Math.exp(-2 * (((x - mx) * nx + (y - my) * ny) / half) ** 2);
	const band = { x1: Math.round(mx - nx * half), y1: Math.round(my - ny * half), x2: Math.round(mx + nx * half), y2: Math.round(my + ny * half), color: colors.band, alpha: BAND_ALPHA };
	// Denser along the band, never empty away from it.
	return { key, look: kind, bg: ground, profiles: [], band, items: amountOf(starfield(w, h, rnd, ground, colors, kind, (x, y) => 0.4 + 0.6 * near(x, y)), stars), ghost: null };
}

// ---- the ceiling and the text that reads on it --------------------------------

/**
 * The brightest color any art of this look can put under text on this
 * theme, each channel rounded up. Stars: the background under the band at
 * its peak, per 8-bit channel. Nebula: by luminance, its deepened base
 * moved the theme's reach (nebulaReach, plus the blending slack) toward
 * its cloud colors (cloudCeiling). Dusk: one field of total opacity at
 * most its peak, so the same bound over its stop colors. For Nebula and
 * Dusk a single channel of the art can pass the ceiling's; its luminance,
 * all text contrast reads, never does. Stars and glows never sit under
 * text.
 */
export function artCeiling(look: ArtLook, palette: Pick<Palette, "bg" | "label" | "value">): string {
	const reach = look === "stars" ? 0 : nebulaReach(palette);
	return ceilingOf(look, artColors(palette.bg, palette.label), reach, isFieldLook(look) ? fieldStrength(look, palette.bg, palette.label, reach) : 1);
}

function ceilingOf(look: ArtLook, colors: ArtColors, reach: number, k: number): string {
	const ground = groundOf(look, colors);
	if (look === "stars") return ceilingAt([colors.band], ground, BAND_ALPHA);
	if (look === "nebula") return cloudCeiling(colors.clouds, ground, reach);
	const [field] = fieldLayers(look, colors, reach, k) as [Profile];
	return cloudCeiling([field.color, ...(field.shape ?? []).map((s) => s[2] ?? field.color)], ground, field.alpha);
}

/** The least strength a field look draws at, where even Nebula's reach is
 * low (Ember) and its own light would pass Nebula's ceiling. */
export const FIELD_MIN_STRENGTH = 0.3;

/**
 * How strong a field look draws on a theme: its full light, or less in
 * steps of 0.02 where its ceiling would be brighter, by luminance (all text
 * contrast depends on), than Nebula's on the same theme. So no look lifts a
 * label further than Nebula does, and every look keeps the value's lead
 * over the label that Nebula's reach was chosen to keep.
 */
function fieldStrength(look: FieldLook, bg: string, label: string, reach: number): number {
	const key = `${look}|${bg}|${label}|${reach}`;
	const known = STRENGTH_CACHE.get(key);
	if (known !== undefined) return known;
	const colors = artColors(bg, label);
	const top = luminance(cloudCeiling(colors.clouds, nebulaBase(bg), reach));
	let k = 1;
	while (k > FIELD_MIN_STRENGTH && luminance(ceilingOf(look, colors, reach, k)) > top) k = Math.round((k - 0.02) * 100) / 100;
	if (STRENGTH_CACHE.size >= 64) STRENGTH_CACHE.clear();
	STRENGTH_CACHE.set(key, k);
	return k;
}

const STRENGTH_CACHE = new Map<string, number>();

/**
 * A tone's colors for a look, held under the theme tone's ceiling (the
 * color the text resolves on, artCeiling): the tone's light steps down by
 * 5 % until the brightest color its art can put under text is no brighter,
 * by luminance, than the theme tone's. So every tone reads exactly as well
 * and the text never needs to know which one a face shows.
 */
function toneColors(look: ArtLook, bg: string, label: string, reach: number, k: number, tone: ArtTone): ArtColors {
	const own = artColors(bg, label);
	if (tone === "theme") return own;
	const key = `${look}|${bg}|${label}|${reach}|${k}|${tone}`;
	const known = TONE_CACHE.get(key);
	if (known !== undefined) return known;
	const most = luminance(ceilingOf(look, own, reach, k));
	let light = 1;
	let held = artColors(bg, label, tone, light);
	while (light > 0 && luminance(ceilingOf(look, held, reach, k)) > most) {
		light = Math.round((light - 0.05) * 100) / 100;
		held = artColors(bg, label, tone, light);
	}
	if (TONE_CACHE.size >= 64) TONE_CACHE.clear();
	TONE_CACHE.set(key, held);
	return held;
}

const TONE_CACHE = new Map<string, ArtColors>();

/** Per channel: the base moved `reach` toward the brightest top. */
function ceilingAt(tops: readonly string[], ground: string, reach: number): string {
	const out = [0, 1, 2].map((i) => {
		const base = channel(ground, i);
		const top = Math.max(base, ...tops.map((c) => channel(c, i)));
		return Math.ceil(base + (reach + ALPHA_SLACK) * (top - base) - 1e-9);
	});
	return rgb(out[0] as number, out[1] as number, out[2] as number);
}

/**
 * The brightest color, by luminance, that clouds of total coverage up to
 * `reach` can lay on the base: stacked clouds of coverage T composite to
 * the base moved T of the way toward a weighted mix of their colors, so
 * every composite lies among the base and the base moved `reach` toward
 * each cloud color, and luminance, convex in each sRGB channel, peaks at
 * one of those (each channel rounded up, with the blending slack). Text
 * contrast depends only on luminance, so text that reads on this color
 * reads on every composite; a ceiling built channel by channel from the
 * brightest of each would sit higher than any cloud can draw. One gradient
 * whose stops differ in color is the same case: any point of it is the
 * base moved at most its peak toward a mix of its stop colors.
 */
function cloudCeiling(tops: readonly string[], ground: string, reach: number): string {
	let best = ground;
	for (const top of tops) {
		const out = [0, 1, 2].map((i) => {
			const base = channel(ground, i);
			return Math.max(base, Math.ceil(base + (reach + ALPHA_SLACK) * (channel(top, i) - base) - 1e-9));
		});
		const color = rgb(out[0] as number, out[1] as number, out[2] as number);
		if (luminance(color) > luminance(best)) best = color;
	}
	return best;
}

/** The value keeps at least this many times the label's contrast, the
 * hierarchy floor Glass keeps (glass.ts VALUE_OVER_LABEL). */
const VALUE_OVER_LABEL = 1.75;

/** The least Nebula's clouds reach: 1.8.0's first candidate's coverage. */
export const NEBULA_MIN_COVERAGE = 0.27;

/**
 * How far Nebula's clouds reach on a theme: NEBULA_COVERAGE, or less where
 * the theme's value color could not keep its lead over the label on the
 * ceiling that reach makes (VALUE_OVER_LABEL over the 4.5:1 floor, the
 * Glass hierarchy): Ember's amber value cannot get brighter without
 * turning white, so Ember's clouds stop lower. In steps of 0.01, never under
 * NEBULA_MIN_COVERAGE.
 */
export function nebulaReach(palette: Pick<Palette, "bg" | "label" | "value">): number {
	const key = `${palette.bg}|${palette.label}|${palette.value}`;
	const known = REACH_CACHE.get(key);
	if (known !== undefined) return known;
	const clouds = artColors(palette.bg, palette.label).clouds;
	const ground = nebulaBase(palette.bg);
	let reach = NEBULA_MIN_COVERAGE;
	for (let pct = Math.round(NEBULA_COVERAGE * 100); pct > Math.round(NEBULA_MIN_COVERAGE * 100); pct--) {
		const ceiling = cloudCeiling(clouds, ground, pct / 100);
		if (contrastRatio(readableValueColor(palette.value, ceiling), ceiling) >= VALUE_OVER_LABEL * 4.5) {
			reach = pct / 100;
			break;
		}
	}
	if (REACH_CACHE.size >= 64) REACH_CACHE.clear();
	REACH_CACHE.set(key, reach);
	return reach;
}

const REACH_CACHE = new Map<string, number>();

/**
 * The palette an art face resolves its text on: bg becomes the ceiling, the
 * value and unit lift to the numeric floor on it, and the label keeps the
 * theme's own step over the unit where the value can afford it (the Glass
 * rule). Theme, Dim, Custom, sensor-type and alert colors then resolve
 * through the existing code; structure keeps the theme's real tokens.
 */
export function artTextPalette(look: ArtLook, palette: Palette): Palette {
	const key = `${look}|${palette.bg}${palette.track}${palette.value}${palette.label}${palette.unit}${palette.accent}`;
	const cached = TEXT_CACHE.get(key);
	if (cached !== undefined) return cached;
	const ceiling = artCeiling(look, palette);
	const value = readableValueColor(palette.value, ceiling);
	const unit = readableValueColor(palette.unit, ceiling);
	const step = Math.max(1, contrastRatio(palette.label, palette.bg) / contrastRatio(palette.unit, palette.bg));
	const labelFloor = Math.max(4.5, Math.min(4.5 * step, contrastRatio(value, ceiling) / VALUE_OVER_LABEL));
	const resolved: Palette = { ...palette, bg: ceiling, value, unit, label: readableColor(palette.label, ceiling, labelFloor) };
	if (TEXT_CACHE.size >= 64) TEXT_CACHE.clear();
	TEXT_CACHE.set(key, resolved);
	return resolved;
}

const TEXT_CACHE = new Map<string, Palette>();

// ---- the marker ---------------------------------------------------------------------

/** The Sky names a marker carries: every one but the default, longest
 * first. */
const MARK_SKIES = ART_TONES.flatMap((tone) => ART_STARS.map((stars) => skyMark({ tone, stars })))
	.filter((n) => n !== "")
	.sort((a, b) => b.length - a.length);
const MARK = new RegExp(`<rect (?:x="[^"]*" y="[^"]*" )?width="[^"]*" height="[^"]*" fill="(#[0-9A-F]{6})" data-art="(${ART_LOOKS.join("|")})(?:\\.(${MARK_SKIES.join("|")}))? (#[0-9A-F]{6})(?: (#[0-9A-F]{6}))?"/>`);
const UNSTAMPED = new RegExp(`( data-art="(?:${ART_LOOKS.join("|")}))( #[0-9A-F]{6})`);

/** The paint attributes of an art face's backdrop: the theme background,
 * so a face nobody paints still draws Theme's field, plus what the painter
 * needs to build the scene (the look and its Sky when not the default, the
 * theme's label color, and for every look but Stars the value color its
 * reach is held to, nebulaReach). */
export function artPaint(look: ArtLook, palette: Pick<Palette, "bg" | "label"> & { readonly value?: string }, sky: ArtSky = DEFAULT_SKY): string {
	const value = look !== "stars" && palette.value !== undefined ? ` ${palette.value.toUpperCase()}` : "";
	const name = skyMark(sky);
	return `fill="${palette.bg.toUpperCase()}" data-art="${look}${name === "" ? "" : `.${name}`} ${palette.label.toUpperCase()}${value}"`;
}

/** The backdrop marker rect over a whole w x h face. */
export function artMark(look: ArtLook, w: number, h: number, palette: Pick<Palette, "bg" | "label"> & { readonly value?: string }, sky: ArtSky = DEFAULT_SKY): string {
	return `<rect width="${w}" height="${h}" ${artPaint(look, palette, sky)}/>`;
}

/**
 * A composed face with its action's Sky in its backdrop marker: the one
 * place the stored Sky meets the face (the composers call it with the
 * settings they drew from; the renderers never see it). The default, a face
 * with no marker and a marker that already carries a Sky come back as they
 * were, byte for byte.
 */
export function withArtSky(svg: string, sky: ArtSky): string {
	const name = skyMark(sky);
	if (name === "" || !svg.includes(" data-art=")) return svg;
	return svg.replace(UNSTAMPED, `$1.${name}$2`);
}

// ---- pieces -------------------------------------------------------------------------

export type Box = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };

/** How far past its estimated ink a text box reaches, in face units, and
 * the grid its sides snap outward to: a value that grows a digit moves its
 * box only when it crosses a grid line, so stars do not come and go with
 * every tick. */
const BOX_PAD = 3;
const BOX_GRID = 12;
/** Emoji and symbols in a fallback font (dial-background.ts). */
const FALLBACK_ADVANCE_12 = 16.8;

const ENTITY: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const attr = (tag: string, name: string): string | undefined => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/**
 * The boxes a face's text may ink, in face units, from its <text> elements:
 * the whole content (tspans included) at the element's own size and bold,
 * widened by BOX_PAD and snapped outward to BOX_GRID across, ascent to
 * descent down. A size or anchor a text leaves out comes from the group
 * around it, as the renderer inherits it (a strip's tile numbers write
 * them once on their group). Null when an element cannot be read: then no
 * star is drawn.
 */
export function textBoxes(svg: string): Box[] | null {
	const out: Box[] = [];
	// The size and anchor each open group gives its texts.
	const groups: { readonly size: string | undefined; readonly anchor: string | undefined }[] = [];
	for (const m of svg.matchAll(/<g\b([^>]*?)(\/?)>|<\/g>|<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
		if (m[0] === "</g>") {
			groups.pop();
			continue;
		}
		const outer = groups[groups.length - 1];
		if (m[3] === undefined) {
			const own = m[1] as string;
			if (m[2] !== "/") groups.push({ size: attr(own, "font-size") ?? outer?.size, anchor: attr(own, "text-anchor") ?? outer?.anchor });
			continue;
		}
		const tag = m[3];
		const x = Number(attr(tag, "x"));
		const y = Number(attr(tag, "y"));
		const size = Number(attr(tag, "font-size") ?? outer?.size);
		if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(size) || size <= 0) return null;
		const content = (m[4] as string).replace(/<[^>]*>/g, "").replace(/&(amp|lt|gt|quot|apos);/g, (_e, n: string) => ENTITY[n] as string).replace(/&#(\d+);/g, (_e, n: string) => String.fromCodePoint(Number(n)));
		const w = estimateKeyTextWidth(content, size, { fontWeight: 700, fallbackAdvance12: FALLBACK_ADVANCE_12 }) * 1.1 + BOX_PAD;
		const anchor = attr(tag, "text-anchor") ?? outer?.anchor ?? "start";
		const left = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x - BOX_PAD;
		const right = anchor === "middle" ? x + w / 2 : anchor === "end" ? x + BOX_PAD : x + w;
		out.push({ x0: Math.floor(left / BOX_GRID) * BOX_GRID, x1: Math.ceil(right / BOX_GRID) * BOX_GRID, y0: Math.floor(y - 0.82 * size - BOX_PAD), y1: Math.ceil(y + 0.26 * size + BOX_PAD) });
	}
	return out;
}

/** A cloud's opacity this faint or less anywhere on a key is left out of
 * the key's piece (the bezel hides the step); a strip slice, whose
 * neighbours touch it, keeps clouds down to a step of 1 / 255. */
const BLOB_CUT = { key: 3 / 255, strip: 1 / 255 } as const;

const num = (v: number): string => {
	const r = Math.round(v * 1000) / 1000;
	return Object.is(r, -0) ? "0" : String(r);
};
const short = (v: number): string => num(v).replace(/^(-?)0\./, "$1.");
const fine = (v: number): string => {
	const r = Math.round(v * 1e6) / 1e6;
	return Object.is(r, -0) ? "0" : String(r);
};

/** The radial gradient of a cloud profile, in the circle's own box. */
function profileDef(i: number, p: Profile, id = "n"): string {
	const stop = (offset: number, alpha: number, color = p.color): string => `<stop${offset === 0 ? "" : ` offset="${short(offset)}"`} stop-color="${color}" stop-opacity="${short(Math.round(alpha * 1000) / 1000)}"/>`;
	const stops = p.shape === undefined ? stop(0, p.alpha) + stop(PROFILE_MID.at, p.alpha * PROFILE_MID.of) + stop(1, 0) : p.shape.map(([o, f, c]) => stop(o, p.alpha * f, c)).join("");
	return `<radialGradient id="${id}${i}">${stops}</radialGradient>`;
}

const GLOW_DEF = '<radialGradient id="g"><stop stop-color="#FFFFFF" stop-opacity=".28"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>';

/**
 * One face's piece of a scene: an opaque base in the theme background,
 * then the scene inside the face's rect, in panel pixels under one
 * transform that maps the rect onto the face (so every piece carries the
 * scene's own numbers, and neighbours meet exactly at the published
 * rects). `quiet` are the face's text boxes in face units.
 */
export function artPiece(scene: ArtScene, rect: PanelRect, faceW: number, faceH: number, quiet: readonly Box[] | null): string {
	const qkey = quiet === null ? "none" : quiet.map((b) => `${b.x0},${b.y0},${b.x1},${b.y1}`).join(";");
	const key = `${scene.key}|${rect.x},${rect.y},${rect.w},${rect.h}|${faceW}x${faceH}|${qkey}`;
	const known = PIECES.get(key);
	if (known !== undefined) return known;
	const piece = buildPiece(scene, rect, faceW, faceH, quiet);
	if (PIECES.size >= 512) PIECES.clear();
	PIECES.set(key, piece);
	return piece;
}

const PIECES = new Map<string, string>();

/** No piece is longer than this many bytes of SVG: one that would be
 * drops its stars, then its clouds (never seen; the bound is what the
 * strip's payload limit counts on, src/strip/slicer.ts). */
export const ART_PIECE_LIMIT = 3072;

function buildPiece(scene: ArtScene, rect: PanelRect, faceW: number, faceH: number, quiet: readonly Box[] | null): string {
	const full = drawPiece(scene, rect, faceW, faceH, quiet);
	if (full.length <= ART_PIECE_LIMIT) return full;
	const calm = drawPiece(scene, rect, faceW, faceH, null);
	return calm.length <= ART_PIECE_LIMIT ? calm : `<rect width="${faceW}" height="${faceH}" fill="${scene.bg}"/>`;
}

function drawPiece(scene: ArtScene, rect: PanelRect, faceW: number, faceH: number, quiet: readonly Box[] | null): string {
	const s = faceW / rect.w;
	// Six decimals: a scale rounded to three would put the + XL's last
	// column a third of a pixel off its rect.
	const transform = `matrix(${fine(s)} 0 0 ${fine(faceH / rect.h)} ${fine(-rect.x * s)} ${fine((-rect.y * faceH) / rect.h)})`;
	const base = `<rect width="${faceW}" height="${faceH}" fill="${scene.bg}"/>`;
	if (scene.ghost !== null) return `${base}<g transform="${transform}">${scene.ghost}</g>`;
	// Text boxes in panel pixels.
	const boxes = (quiet ?? []).map((b) => ({ x0: rect.x + b.x0 / s, y0: rect.y + b.y0 / s, x1: rect.x + b.x1 / s, y1: rect.y + b.y1 / s }));
	const clear = (x0: number, y0: number, x1: number, y1: number): boolean => quiet !== null && x0 >= rect.x && y0 >= rect.y && x1 <= rect.x + rect.w && y1 <= rect.y + rect.h && boxes.every((b) => x1 <= b.x0 || x0 >= b.x1 || y1 <= b.y0 || y0 >= b.y1);
	const strip = faceW === SLICE.w;
	const cut = strip ? BLOB_CUT.strip : BLOB_CUT.key;
	// A held strip draws its field at its share, under ids of its own (s0):
	// every slice carries the same held field, every key the full one.
	const hold = strip ? (scene.strip ?? 1) : 1;
	const pid = hold === 1 ? "n" : "s";
	const defs: string[] = [];
	const body: string[] = [];
	if (scene.band !== null) {
		const b = scene.band;
		const stop = (offset: string, alpha: string): string => `<stop${offset === "0" ? "" : ` offset="${offset}"`} stop-color="${b.color}" stop-opacity="${alpha}"/>`;
		defs.push(`<linearGradient id="m" gradientUnits="userSpaceOnUse" x1="${b.x1}" y1="${b.y1}" x2="${b.x2}" y2="${b.y2}">${stop("0", "0")}${stop(".5", short(b.alpha))}${stop("1", "0")}</linearGradient>`);
		body.push(`<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" fill="url(#m)"/>`);
	}
	const used = new Set<number>();
	const fills = new Map<string, string[]>();
	let glowed = false;
	for (const it of scene.items) {
		if (it.kind === "blob") {
			// A field's most can sit at the rect's far side, a cloud's at its near.
			const p = scene.profiles[it.profile] as Profile;
			const [near, far] = blobSpan(it, rect);
			if (p.alpha * hold * shapeMax(p, near, far) <= cut) continue;
			used.add(it.profile);
			body.push(`<circle cx="${it.cx}" cy="${it.cy}" r="${it.r}" fill="url(#${pid}${it.profile})"/>`);
			continue;
		}
		if (!clear(it.x, it.y, it.x + it.size, it.y + it.size)) continue;
		if (it.glow > 0) {
			const c = it.size / 2;
			if (clear(it.x + c - it.glow, it.y + c - it.glow, it.x + c + it.glow, it.y + c + it.glow)) {
				body.push(`<circle cx="${num(it.x + c)}" cy="${num(it.y + c)}" r="${it.glow}" fill="url(#g)"/>`);
				glowed = true;
			}
		}
		const d = it.round ? `M${it.x} ${it.y + 0.5}l.5-.5h1l.5.5v1l-.5.5h-1l-.5-.5z` : `M${it.x} ${it.y}h1v1h-1z`;
		const list = fills.get(it.fill);
		if (list === undefined) fills.set(it.fill, [d]);
		else list.push(d);
	}
	for (const p of [...used].sort((a, b) => a - b)) {
		const q = scene.profiles[p] as Profile;
		defs.push(profileDef(p, hold === 1 ? q : { ...q, alpha: floor3(q.alpha * hold) }, pid));
	}
	if (glowed) defs.push(GLOW_DEF);
	for (const [fill, ds] of fills) body.push(`<path fill="${fill}" d="${ds.join("")}"/>`);
	if (body.length === 0) return base;
	return `${base}${defs.length > 0 ? `<defs>${defs.join("")}</defs>` : ""}<g transform="${transform}">${body.join("")}</g>`;
}

/**
 * Paints an art face: replaces its backdrop marker with the piece of the
 * scene its place shows, in the Sky the marker carries. A face with no
 * marker (every other look, an alerting key, Paper) is returned unchanged,
 * and its place is never asked for. Same face and same place, same bytes.
 */
export function paintArt(svg: string, placeOf: ArtPlace | (() => ArtPlace)): string {
	if (!svg.includes(" data-art=")) return svg;
	const m = MARK.exec(svg);
	if (m === null) return svg;
	const place = typeof placeOf === "function" ? placeOf() : placeOf;
	const view = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
	const faceW = view === null ? KEY_FACE : Number(view[1]);
	const faceH = view === null ? KEY_FACE : Number(view[2]);
	const window = artWindow(place, faceW, faceH);
	const sky = m[3] === undefined ? DEFAULT_SKY : skyOfMark(m[3]);
	const scene = artScene(m[2] as ArtLook, window.panel, window.seed, m[1] as string, m[4] as string, m[5], sky);
	const piece = artPiece(scene, window.rect, faceW, faceH, textBoxes(svg));
	return svg.slice(0, m.index) + piece + svg.slice(m.index + m[0].length);
}
