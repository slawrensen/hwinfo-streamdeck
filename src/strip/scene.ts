/**
 * One logical strip frame. A group's whole frame (800 x 100 on a Stream
 * Deck +, 1200 x 100 on a + XL) is composed once from one snapshot: one
 * time domain, one scale per graph, one layout, one look. Every member's
 * 200 x 100 slice is then cut from this frame (slicer.ts), so the graph,
 * its fill, its bands and its labels continue across seams instead of
 * restarting in every segment.
 *
 * Panes: whole draws one; split draws two that meet at the middle seam with
 * a 2 px gutter (1 px each side). Panels are square, like today's faces,
 * one per pane, so translucent looks never double their alpha at a seam.
 *
 * Styles:
 *   trend    a large line; extra series as thin context lines
 *   area     the same with a restrained fill under the highlighted series
 *   compare  2 to 4 series on one shared, labelled scale per unit
 *   lanes    2 or 3 aligned lanes, each on its own scale and labelled
 *   heat     one reading in time bins on a numeric color scale, with a
 *            distinct mark where nothing was observed
 *   group    every reading a rule stands for (src/strip/group.ts), up to
 *            32 of one unit: named lines (up to 4), a highlighted line
 *            over muted ones (up to 8), a heat row per reading (Rows), a
 *            column per reading now (Now) or the group's range band with
 *            its median (Spread); the first dial slot shows one reading
 *            large and says which of how many it is
 *   meters   one reading per dial slot, large, against its limits
 *            (src/strip/meters.ts)
 *   events   Yes/No readings and time past a limit as marks on a
 *            timeline, counted (src/strip/events.ts)
 *
 * A pane may also show its readings' current values large (readout): in
 * its first dial slot beside a narrower graph of the same window, or alone
 * (values only), spread across the pane. The Scale and grid overlay adds
 * round value ticks, time ticks, light gridlines and the window's min and
 * max marked. Without those fields a pane draws exactly as before them.
 *
 * The plot takes the strip's height. The top row (names, values) and the
 * bottom row (the window's words, LIVE or PAUSED) draw over it in an edge
 * of their own (ROWS_FILTER), and each scale's round ends sit at its left
 * edge (scaleEnds). On Glass, Tint, Outline and Clear a small tab stands
 * behind those ends and the window's words (WORD_TAB).
 *
 * A series in another unit is never normalized into a shared scale and
 * never left out: Trend, Area and Compare stack one band per native unit, each on its own scale (lineStyle). Threshold bands are
 * scoped to the reading they belong to and carry its label.
 *
 * Looks follow the dial's Background: Theme fills each pane with the theme
 * background, Glass and Tint use the dial's translucent panels, Outline and
 * Clear draw no panel. Outline and Tint draw every mark inside Outline's
 * edge filter; the rows' words draw above it, in the same edge drawn
 * again for them alone on every look, so a line under a word never touches
 * it; Clear backs lines with the track color. Words in the accent
 * color apply exactly where they apply on a dial (dialTextColors). Stars
 * and Nebula (src/ui/deck-art.ts) draw one backdrop marker across the whole
 * strip, gutter included, which each slice's sender replaces with its piece
 * of the deck's scene.
 */
import type { AlertBand } from "../alerts/types";
import type { HistoryView, HistoryWindowId } from "../history/types";
import { t } from "../i18n";
import { artPaint, isArtLook } from "../ui/deck-art";
import { dialBackgroundTraits, dialFaceOpen, dialTextColors, dialTextPalette, HALO_CLOSE, HALO_GROUP, haloFilterDefsAt, haloRingColor, lookOn, structureFill, type DialBackground } from "../ui/dial-background";
import { isTahoma } from "../ui/face-font";
import { convertUnit, cutToFit, estimateKeyTextWidth, formatValue, inkEdges } from "../ui/format";
import { flatPaint, GLASS_INK_OPACITY, GLASS_OPACITY, TINT_OPACITY } from "../ui/glass";
import { escapeXml, fontFamily } from "../ui/key-renderer";
import { exactFallback, formatMeasurement, formatStat, isDataUnit, type DataUnitsPref, type FixedDataUnit, type MeasureOptions } from "../ui/measure";
import { measureFor } from "../ui/reading-format";
import { ciede2000 } from "../ui/color-difference";
import { appliedTextMode, contrastRatio, mixToward, noDimmerThan, readableColorAtHue, readableValueColor, type TextColors, type TextSettings } from "../ui/text-colors";
import type { Palette } from "../ui/themes";
import { shortSpan, timeTicks } from "./axes";
import { cursorBucketsBack, DEFAULT_BUCKET_PX, graphExtent, laneHeight, LANES_TOP, onlyTrendBuckets, ownsLayout, paneExtents, panePlotOf, plotFor, readoutExtent, SLICE_W, spreadCells, SPREAD_PAD, stripWidth, type BucketPx, type PaneExtent, type PanePlot, type StripEncoders } from "./geometry";
import { areaPrims, bandSpan, bandsOpenUpward, binView, bucketX, cellAt, cellsExtent, drawnUnitOf, extentOf, heatCells, linePrims, lineRunsOf, NO_BINS, observedSpans, scaleOf, Scratch, toNative, unionExtent, valueAt, yOf, type Bins, type Extent, type Run, type Span, type YMap } from "./graph";
import { emitPrim, snap, type Layer, type Prim, type TextPrim } from "./prims";
import { fitNameRung, nameRungs, onlyStacks, phraseRungs, planReadout, planSpread, type ReadoutBox, type ReadoutItem, type ReadoutPlan } from "./readout";
import { GROUP_BAND_OPACITY, GROUP_BAR_OPACITY, GROUP_BOTTOM, GROUP_NAMED_LINES, GROUP_NOW_GUTTER, GROUP_TOP, groupColumns, groupDrawOf, groupGraphExtent, groupPlotOf, groupRows, groupRuleOf, ICE_RAMP, type GroupDraw, type GroupStatus } from "./group";
import { ambientPane, ambientPlotOf, everyReadingStopped } from "./ambient";
import { tileShapeOf, tilesPane } from "./tiles";
import { activePanes, drawnSeries, isRuleStyle, isValuesOnly, paneWindowOf, seriesLimitsOf, type StripConfigV1, type StripGapMode, type StripPaneV1, type StripStyle } from "./settings";
import { autoTarget, candidateScales, endText, nextHeldScale, reserveSlot, resolvedScale, scaleKindOf, scaleStartsAtZero, scaleTicks, scaleUnitWord, scaleView, slotTexts, stampedLimits, tickNative, toView, type HeldScale, type ResolvedScale, type ScaleAsk, type ScaleDialInfo, type ScaleTicks, type ScaleView, type TypedEnds } from "./scale";
import { eventsStyle } from "./events";
import { fillStyle } from "./fill";
import { metersStyle } from "./meters";
import { ownBands, YES_NO_UNIT } from "./patterned";

export const WINDOW_MS: Readonly<Record<HistoryWindowId, number>> = { "1m": 60_000, "5m": 300_000, "15m": 900_000 };
const WINDOW_LABEL: Readonly<Record<HistoryWindowId, string>> = { "1m": "1 min", "5m": "5 min", "15m": "15 min" };

/** Vertical layout, shared by every style (src/strip/patterned.ts keeps the
 * same numbers). The plot takes the strip's height; the top row (names and
 * the current value) and the bottom row (the window's words and LIVE or
 * PAUSED) draw over it, in their edge (ROWS_FILTER). */
const TOP_BASELINE = 22;
const BOTTOM_BASELINE = 95;
const PLOT_TOP = 6;
const PLOT_BOTTOM = 94;
const PAD = 6;
const VALUE_SIZE = 24;
const LABEL_SIZE = 16;
const ROW_SIZE = 16;
const BADGE_SIZE = 15;
/** The px the bottom row's words stay clear of its badge. */
const ROW_BADGE_GAP = 10;
const SMALL_SIZE = 11;
/** The rows and sizes above, for the tests and the boards. */
export const STRIP_ROWS = { topBaseline: TOP_BASELINE, bottomBaseline: BOTTOM_BASELINE, plotTop: PLOT_TOP, plotBottom: PLOT_BOTTOM, label: LABEL_SIZE, value: VALUE_SIZE, row: ROW_SIZE, badge: BADGE_SIZE, scale: 13, swatch: 10, chip: 10 } as const;
/**
 * The small tabs behind the words over a graph on the see-through looks
 * (WORD_TAB_LOOKS): one behind each left scale end and one behind the
 * window's words, in the theme's track tone, never behind LIVE or PAUSED.
 * Each stands `pad` px round the ink of the widest word its slot holds, with
 * corners of `radius` px; a side within `near` px of the pane's edge or the
 * strip's top or bottom stands `glass` px off it. `cap` is the words' height
 * above the baseline, in em.
 *
 * A tab follows its word. An end's tab draws while that end draws, on the
 * band it draws on, its width measured once per unit and held with the
 * slots (SceneBuilder.slot, grown by nothing), so it comes back as it was
 * with its reading. The window's tab starts where the window's words start
 * this frame, which moves only with the ends' column (scaleEnds), so no
 * value, stale source or turned window moves or resizes a tab; the one
 * exception is a scale's word outgrowing its reserved width, which moves the
 * column and the words beside it, once, and this tab with them.
 *
 * A pane takes no window's tab where the widest of its words could not clear
 * `widestBadge`, the widest badge it can print ("4" is the widest digit in
 * either font), from the ends' column it holds: a graph of one slot, as a
 * rule, live and paused alike, so a pause changes no tab. A conflict notice
 * in the window's place takes that tab away while it shows; a screen's name
 * there, for a moment, keeps it. A tab draws over the pane's fills and under
 * its lines (the base layer's last primitive), so it never covers a line,
 * and it changes no word and no line.
 */
export const WORD_TAB = { pad: 4, radius: 2, near: 8, glass: 2, cap: 0.74, widestBadge: "PAUSED 44:44:44" } as const;
const WORD_TAB_LOOKS: ReadonlySet<DialBackground> = new Set(["glass", "tint", "outline", "clear"]);
/** The legend's color chip, square, its top on the names' cap line. */
const CHIP = STRIP_ROWS.chip;
/** The line under a Group readout, in its own slot (not over the graph):
 * where it sat before the rows moved over the graph. */
const READOUT_FOOT = 96;
/** A color scale's numbers and limits on the bottom row (Heat, Group
 * Rows), beside the row's words; its swatches are this tall. */
const SCALE_SIZE = STRIP_ROWS.scale;
const SWATCH_H = STRIP_ROWS.swatch;
/** The sizes a row's first part steps down to when it does not fit whole
 * at ROW_SIZE (SceneBuilder.flowWords). */
const ROW_STEPS = [SCALE_SIZE, SMALL_SIZE] as const;
/** A heat pane's value where its limits would not fit beside the full
 * size (a pane on one present slot): the size before the rows moved over
 * the graph. */
const HEAT_VALUE_NARROW = 18;
/** A lane's header with three lanes of 30 px: the size its row band
 * (SceneBuilder.rowBands) leaves a third of the lane clear under. */
const LANE_HEADER_3 = 14;
/** PAUSED on a values-only pane, which has no graph to draw over: the top
 * right of its last value's slot, at the size the values' layout was
 * measured with (their digit floors hold under it). A trend beside the
 * number lends its corner when it is this wide: PAUSED, the time, and its
 * scale's top end beside them. */
const ONLY_BADGE = { baseline: 14, size: 11, row: 17, trendRoom: 150 } as const;
/** A trend's scale ends beside a large value, the size of Meters' scale row. */
const ONLY_SCALE_SIZE = 12;
/** Values only stacks at most this many readings in a dial slot; a pane
 * draws up to that many a slot, the rest stay saved. */
const ONLY_PER_SLOT = 2;
const HEAT_STEPS = 8;
/** Heat's color scale holds round ends on this many ticks. */
const HEAT_TICKS = 6;
/** A Group Rows pane's color scale holds round ends on this many ticks. */
const GROUP_ROWS_TICKS = 6;
/** Height of the alert cap on a heat cell inside a threshold band: a crit
 * cap is two warn caps tall, so the level never rests on color alone. */
const HEAT_CAP = { warn: 5, crit: 10 } as const;
/** A Group row's alert bar at its left end, by level. */
const ROW_BAR = { warn: 3, crit: 6 } as const;
/** The warn cap on a Group row's cell: its upper half (all of a 1 px row,
 * where only the color tells warn from crit). */
function warnCap(rowHeight: number): number {
	return Math.max(1, Math.floor(rowHeight / 2));
}
/** Least px between value ticks of the Scale and grid overlay: a label
 * and its line each keep their own row. */
const AXIS_TICK_SPACING = 15;

export type SeriesState = "ok" | "stale" | "missing" | "unavailable";

export type StripSeriesInput = {
	/** The pane series' saved key. */
	readonly key: string;
	/** Display name: the pane's own name for it, else the reading's label. */
	readonly name: string;
	/** Native unit ("" when unknown); a view's unit wins when present. */
	readonly unit: string;
	readonly state: SeriesState;
	/** The window's history; undefined while there is none. */
	readonly history?: HistoryView;
	/** Latest native value, when the poller has one. */
	readonly current?: number;
	/** The history budget refused this window: no line can draw, and the
	 * strip names the reading "no history room" instead. */
	readonly noRoom?: true;
};

/**
 * Live, or paused with the inspect cursor `agoMs` before the newest
 * bucket's end. The cursor is a time, not a bucket count: the bucket width
 * can change between frames (the payload fallback), and a time keeps the
 * cursor where the user put it. cursorAgoMs turns a routed bucket count
 * into this time.
 */
export type StripPaneView = { readonly mode: "live" } | { readonly mode: "paused"; readonly label?: string; readonly agoMs: number };

export type StripPaneInput = {
	/** In the pane's series order. */
	readonly series: readonly StripSeriesInput[];
	/** Bands for this pane's readings, in display units (stripBandsFor). */
	readonly bands: readonly AlertBand[];
	readonly view: StripPaneView;
	/** Highlighted series (pressed rotation); wraps over what is drawn. */
	readonly highlight: number;
	/** Replaces the bottom-left line (a conflict note). */
	readonly notice?: string;
	/** A Group pane: what its rule found (src/strip/group.ts). */
	readonly group?: GroupPaneInfo;
	/** What the runtime holds for this pane's scales (src/strip/scale.ts):
	 * the scales it held after the last data frame, that frame's time, the
	 * dial's turned span and the reserved end widths. Absent (a preview),
	 * every scale takes its target and every slot is measured afresh. */
	readonly scale?: PaneScaleInput;
	/** Strip Screens, for a moment after a screen change: the screen's name
	 * and place ("Core clocks", "2 of 5"), drawn where the style says its
	 * window (screenWords); a conflict notice outranks it. */
	readonly screenLabel?: ScreenLabel;
};

/** A pane's scale state from the runtime: each held scale by key ("u:°C",
 * "l:<reading key>", "heat", "m:<reading key>", "group"),
 * the data frame time they are judged at (a repaint for input passes the
 * last one, with the scales held before it), the dial's turned span (view
 * units) and the reserved widths ("end", "heat:hi", "cap:<reading key>",
 * "tab:hi:<unit>"). */
export type PaneScaleInput = {
	readonly prev?: Readonly<Record<string, HeldScale>>;
	readonly at?: number;
	readonly span?: number;
	readonly slots?: Readonly<Record<string, number>>;
};

/** What a pane's scales came to in a frame: the held scales (the ones
 * passed in that this frame did not draw kept), the reserved widths, and,
 * on a pane that takes the scale dial, what a detent needs to know. */
export type PaneScaleOut = { readonly held: Record<string, HeldScale>; readonly slots: Record<string, number>; readonly dial?: ScaleDialInfo };

/** A screen's name and place for the window words: the name, how many more
 * readings an automatic name counts ("+3", kept whenever the name is
 * shortened), and the place ("3 of 3"). */
export type ScreenLabel = { readonly name: string; readonly more?: number; readonly place: string };

/** What a Group pane says about its readings beside drawing them. */
export type GroupPaneInfo = {
	readonly status: GroupStatus;
	/** The folder's name or the filter as typed; "" for a custom list. */
	readonly title: string;
	/** The native unit the pane draws. */
	readonly unit: string;
	/** Readings in that unit the rule matched (the drawn ones and those past
	 * the cap). */
	readonly sameUnit: number;
	/** Matched readings in other units, left out. */
	readonly otherUnits: number;
	/** Drawn readings whose history the group allowance refused. */
	readonly refused: number;
	/** The highlighted reading, by key; null is home. */
	readonly highlightKey: string | null;
	/** Live, at home: the reading the home readout names, held against
	 * close calls by the runtime (nextHome); absent, the highest now. */
	readonly homeKey?: string;
};

export type StripSceneInput = {
	readonly config: StripConfigV1;
	/** The device's encoders (the registry has already matched them). */
	readonly encoders: StripEncoders;
	/** The group's theme, resolved (config.theme, else the deck theme). */
	readonly palette: Palette;
	/** The group's effective Text setting. */
	readonly text: TextSettings;
	readonly alertColors: { readonly warn: string; readonly crit: string };
	readonly dataUnits: DataUnitsPref;
	/** One per active pane. */
	readonly panes: readonly StripPaneInput[];
	/** Per encoder column: false where no member owns the slot. */
	readonly present?: readonly boolean[];
	/** Per encoder column: true where the slot is empty because its dial
	 * left the strip and shows its own reading (not absent). */
	readonly left?: readonly boolean[];
	readonly generation?: number;
	readonly bucketPx?: BucketPx;
	/** The payload fallback past the bucket ladder (slicer.ts): an Ambient
	 * pane draws half its readings. */
	readonly reduced?: true;
	/** Strip Screens (a whole strip with two or more): the position line
	 * on rows 0 to 2, one segment per screen, `at` lit, and a hidden screen
	 * holding a reading past its critical limit dashed in the critical
	 * color. Absent: no line, the strip as before screens. */
	readonly screens?: { readonly count: number; readonly at: number; readonly alerts: readonly boolean[] };
};

export type LogicalScene = {
	readonly width: number;
	readonly encoders: StripEncoders;
	readonly bucketPx: BucketPx;
	readonly generation: number;
	/** Gradient paints (linearGradient elements, no defs wrapper). */
	readonly paints: string;
	/** Outline's edge color on Outline and Tint, else null. */
	readonly ring: string | null;
	/** The row words' edge color on every look (RowText.edge). */
	readonly edge: string;
	readonly prims: readonly Prim[];
	readonly present: readonly boolean[];
	/** Paints a slice carries only when one of its primitives uses them
	 * (the Ambient style's and Tiles'): every other paint is in every slice. */
	readonly localPaints?: readonly { readonly id: string; readonly def: string }[];
	/** Per pane, what its scales came to (null for a pane not drawn), for
	 * the runtime to hold and pass back (PaneScaleInput). */
	readonly scales: readonly [PaneScaleOut | null, PaneScaleOut | null];
};

export type Look = {
	readonly background: DialBackground;
	readonly palette: Palette;
	readonly text: TextColors;
	readonly surface: string;
	readonly structure: string;
	readonly ring: string | null;
	readonly halo: boolean;
	/** The colors and edge of the words the top and bottom rows draw over
	 * the plot (RowText). */
	readonly rows: RowText;
};

/**
 * The words a graph carries on its top and bottom rows draw over the plot
 * in an edge of their own (ROWS_FILTER): Outline's one filter pass grows
 * every word, chip and swatch by 1 px, black on the dark themes and the
 * theme background on Paper (haloRingColor), drawn above the marks, so a
 * line, a band or a picture under a word never touches a letter. No panel
 * and no patch under them; the one thing behind any of them is a scale
 * end's or the window's words' small tab on a see-through look (WORD_TAB).
 *
 * Their colors resolve as Glass's do, lifted to the 4.5:1 floor (the label
 * no dimmer than the unit) on `surface`: the theme background at
 * ROW_SURFACE_OPACITY over pure white for a theme with light text, over
 * pure black for Paper. Every pixel the edge lays next to a word's ink
 * holds at least 7/8 of the edge color (each of its three stacked layers
 * holds half or more there), which over the worst picture is darker than
 * that surface on the dark themes and lighter on Paper, so the floor holds
 * there with room to spare. Custom text stays exactly as chosen.
 */
export type RowText = {
	/** The edge color (haloRingColor). */
	readonly edge: string;
	/** The surface the colors are lifted on. */
	readonly surface: string;
	readonly text: TextColors;
	readonly custom: boolean;
};

/** The opacity of the theme background in the surface the row words'
 * colors are lifted on (RowText): the lowest at which every theme's light
 * words stay light when lifted to the floor over white (below about 0.62
 * the lift turns Graphite's words dark, as Glass's panel does under 0.67). */
export const ROW_SURFACE_OPACITY = 0.7;
/** The share of a row band's height that holds its words (SceneBuilder
 * rowBands); the rest is clearance toward the plot: about 9 px below the
 * top row and 6 px above the bottom row. */
const ROW_BAND_CORE = 0.75;
/** Clearance between a word's ink and its row band's edge. */
const ROW_MARGIN = 3;
/** The clearance a row band keeps past a run's last word. */
const ROW_END = 24;

/** Source-over of `top` at `alpha` on `under`, per 8-bit channel, two
 * steps of 255 toward `under` (QtSvg blends in 8-bit integers), rounded
 * toward it: the surface words must beat. */
export function blendOver(top: string, alpha: number, under: string): string {
	const a = Math.max(0, Math.round(alpha * 255) - 2) / 255;
	const toward = parseInt(under.slice(1, 3), 16) > 127;
	const channel = (offset: number): string => {
		const mixed = parseInt(top.slice(offset, offset + 2), 16) * a + parseInt(under.slice(offset, offset + 2), 16) * (1 - a);
		const rounded = toward ? Math.ceil(mixed - 1e-9) : Math.floor(mixed + 1e-9);
		return Math.max(0, Math.min(255, rounded)).toString(16).padStart(2, "0").toUpperCase();
	};
	return `#${channel(1)}${channel(3)}${channel(5)}`;
}

function rowTextOf(palette: Palette, text: TextColors, settings: TextSettings): RowText {
	const light = luminanceOf(palette.value) > luminanceOf(palette.bg);
	const surface = blendOver(palette.bg, ROW_SURFACE_OPACITY, light ? "#FFFFFF" : "#000000");
	const edge = haloRingColor(palette);
	const custom = appliedTextMode(settings) === "custom";
	if (custom) return { edge, surface, text, custom };
	const unit = readableValueColor(text.unit, surface);
	const lifted: TextColors = { value: readableValueColor(text.value, surface), unit, label: noDimmerThan(readableValueColor(text.label, surface), unit, surface), badge: readableValueColor(text.badge, surface) };
	return { edge, surface, text: lifted, custom };
}

/** The surface a look's words sit on: Glass's hardest panel, the art's
 * ceiling, else the theme background (Look.surface). */
function surfaceOf(background: DialBackground, palette: Palette): string {
	return dialTextPalette(background, palette).bg;
}

/** The CIELAB hues a lifted warn and crit keep: the theme's own (72 and 36)
 * turned toward each other's far side, warn 1 degree toward yellow and crit
 * 4 toward orange. At the lightness 4.5:1 asks on Glass's and the art's
 * surfaces red holds little chroma, and these leave each of them 20 dE00
 * from the strip's reddish purple and yellow (with their dimmed lines and
 * trails), from Ember's amber accent and from each other, and tritanopes
 * 3.5 between the two (test/strip-scene.test.ts). */
const LIFTED_HUES = { warn: 73, crit: 40 } as const;
/** The luminance steps a lifted warn keeps over crit on a dark surface,
 * largest first (the theme's own pair is 1.46:1 apart there): the first
 * that leaves the two 20 dE00 apart (a lighter amber loses chroma toward
 * crit's salmon), else none. */
const WARN_STEPS = [1.2, 1.1, 1.05] as const;
/** How far apart warn and crit stay (CIEDE2000), the strip's series rule. */
const ALERT_APART = 20;

/**
 * The strip's warn and crit colors on a look. On Theme, Tint, Outline and
 * Clear the surface the words sit on is the theme background, and they are
 * the theme's alert values as every key and dial draws them there. On
 * Glass (its hardest panel) and Stars and Nebula (the art's ceiling) each
 * that misses the 4.5:1 value floor on that surface is lifted to it
 * holding a CIELAB hue (LIFTED_HUES) with the most chroma the gamut
 * allows, and on a dark surface warn steps lighter than crit where the
 * gamut leaves them 20 dE00 apart. A mix toward white, as a dial lifts,
 * turns crit toward the series' reddish purple at that lightness and puts
 * warn and crit at one luminance. Every alert-colored word, value and mark
 * of the strip takes them (frame.ts stripLookOf).
 */
export function stripAlertColors(alertValues: Readonly<Record<"warn" | "crit", string>>, palette: Palette, background: DialBackground | undefined): { readonly warn: string; readonly crit: string } {
	const surface = surfaceOf(lookOn(background, palette), palette);
	if (surface === palette.bg) return { warn: readableValueColor(alertValues.warn, surface), crit: readableValueColor(alertValues.crit, surface) };
	const crit = readableColorAtHue(alertValues.crit, surface, 4.5, LIFTED_HUES.crit);
	const held = readableColorAtHue(alertValues.warn, surface, 4.5, LIFTED_HUES.warn);
	// On a light surface both are as light as the floor lets them be.
	if (!(luminanceOf(crit) > luminanceOf(surface))) return { warn: held, crit };
	for (const step of WARN_STEPS) {
		if (luminanceOf(held) > luminanceOf(crit) && contrastRatio(held, crit) >= step) return { warn: held, crit };
		const warn = readableColorAtHue(alertValues.warn, surface, step * contrastRatio(crit, surface), LIFTED_HUES.warn);
		if (ciede2000(warn, crit) >= ALERT_APART) return { warn, crit };
	}
	return { warn: held, crit };
}

export function lookOf(config: StripConfigV1, palette: Palette, settings: TextSettings): Look {
	const background = lookOn(config.background, palette);
	const traits = dialBackgroundTraits(background);
	const text = dialTextColors(background, palette, settings, config.accentWords);
	return {
		background,
		palette,
		text,
		surface: surfaceOf(background, palette),
		structure: structureFill(background, palette),
		ring: traits.halo ? haloRingColor(palette) : null,
		halo: traits.halo,
		rows: rowTextOf(palette, text, settings)
	};
}

// ---- text ------------------------------------------------------------------

function widthOf(text: string, size: number, weight: 600 | 700): number {
	return estimateKeyTextWidth(text, size, weight === 700 ? { fontWeight: 700 } : undefined);
}

/**
 * The ink span of the number in `live` when the text `before + live` starts
 * at x (left anchored): from its first digit or sign to its last digit.
 * Undefined when `live` holds no number.
 */
function numberSpan(before: string, live: string, x: number, size: number, weight: 600 | 700): { l: number; r: number } | undefined {
	const m = /[-+]?\d[\d.,:]*/.exec(live);
	if (m === null) return undefined;
	const right = (t: string): number => (t === "" ? 0 : inkEdges([{ text: t, fontSize: size, fontWeight: weight }], "start", 0).right);
	const head = before + live.slice(0, m.index);
	return { l: x + right(head), r: x + right(head + m[0]) };
}

/**
 * How far to move a live number spanning l..r so it sits inside one slice:
 * toward `dir` (1 right, -1 left) past the seam it crosses, with `margin`
 * px clear; 0 when it crosses none. A number that changes each frame must
 * not straddle a seam: the app shows each slice's new picture at its own
 * moment, so a split number can read half old, half new.
 */
function offSeam(l: number, r: number, dir: 1 | -1, margin = 2): number {
	const seam = (Math.floor((l - margin) / SLICE_W) + 1) * SLICE_W;
	if (!(seam < r + margin)) return 0;
	return dir > 0 ? seam + margin - l : seam - margin - r;
}

/**
 * Whether the number at [start, end) of a row's words is a reading (a
 * value, a min or max, a scale end, a time) rather than part of a name or
 * a count of words ("Core 1", "5 min", "15 s"): not glued to a letter, and
 * followed by nothing, a separator or a unit, never by another word.
 */
function isReadingNumber(text: string, start: number, end: number): boolean {
	if (/[A-Za-z]/.test(text[start - 1] ?? "")) return false;
	const rest = text.slice(end);
	if (!/^ ?[A-Za-z]/.test(rest)) return true;
	return /^ ?(MHz|GHz|kHz|RPM|FPS|ms|W|V|A|x|[KMGT]i?B(\/s)?|[kMG]bps)\b/.test(rest);
}

/** The x a text anchored at `x` starts at, as numberSpan counts it. */
function startOf(text: string, anchor: TextPrim["anchor"], x: number, size: number, weight: 600 | 700): number {
	return inkEdges([{ text, fontSize: size, fontWeight: weight }], anchor, x).left - inkEdges([{ text, fontSize: size, fontWeight: weight }], "start", 0).left;
}

/**
 * The anchor x at which no number in `text` straddles a slice seam: moved
 * toward `dir` past each seam one would cross (offSeam). The rows over the
 * graph carry numbers that change each frame (min and max, a scale's ends,
 * the cursor's time) at sizes that reach across a seam.
 */
export function clearOfSeams(text: string, anchor: TextPrim["anchor"], x: number, size: number, weight: 600 | 700, dir: 1 | -1): number {
	let at = x;
	for (let guard = 0; guard < 8; guard++) {
		const start = startOf(text, anchor, at, size, weight);
		let shift = 0;
		for (const m of text.matchAll(/[-+]?\d[\d.,:]*/g)) {
			if (!isReadingNumber(text, m.index, m.index + m[0].length)) continue;
			const span = numberSpan(text.slice(0, m.index), text.slice(m.index), start, size, weight);
			if (span !== undefined) shift = offSeam(span.l, span.r, dir);
			if (shift !== 0) break;
		}
		if (shift === 0) return at;
		at += shift;
	}
	return at;
}

function textPrim(x: number, y: number, anchor: TextPrim["anchor"], size: number, weight: 600 | 700, fill: string, text: string): TextPrim {
	const w = widthOf(text, size, weight) * 1.15 + 6;
	const x0 = anchor === "start" ? x - 3 : anchor === "end" ? x - w : x - w / 2;
	return { k: "text", layer: "marks", x: snap(x), y, anchor, size, weight, fill, text, bx0: x0, bx1: x0 + w + 3 };
}

/** How far a line of text inks above its baseline and below it, in em:
 * Tahoma Bold's tallest glyphs (digits and accented capitals), its
 * descenders (g, p, y, brackets), and the round digits' overshoot for a
 * line with no descender. */
const TEXT_ASCENT = 0.76;
const TEXT_DESCENT = 0.21;
const TEXT_OVERSHOOT = 0.03;
const DESCENDERS = /[gjpqyQ(),;[\]{}|@_µ]/;

/** A text's box as drawn: its measured ink across, ascent to descent down.
 * The scene keeps the readout's and the Scale and grid overlay's words
 * apart by these boxes, and the tests check them the same way. */
export function textInkBox(p: Pick<TextPrim, "x" | "y" | "anchor" | "size" | "weight" | "text">): { x0: number; x1: number; y0: number; y1: number } {
	const e = inkEdges([{ text: p.text, fontSize: p.size, fontWeight: p.weight }], p.anchor, p.x);
	return { x0: e.left, x1: e.right, y0: p.y - TEXT_ASCENT * p.size, y1: p.y + (DESCENDERS.test(p.text) ? TEXT_DESCENT : TEXT_OVERSHOOT) * p.size };
}

/** Whether two text rows (baselines a and b, font sizes in px) share any
 * pixel row: a row runs from its baseline minus its size to 2 px below. */
function rowsMeet(a: number, aSize: number, b: number, bSize: number): boolean {
	return a - aSize < b + 2 && b - bSize < a + 2;
}

/** A band label waiting for layout (bandLabels). `name` is the reading's
 * name when the label starts with it: a label that must be cut shortens the
 * name and keeps the limit itself. */
type BandLabel = { readonly y: number; readonly color: string; readonly text: string; readonly name?: string; readonly alt?: number };

/** A band label in at most `room` px: whole, else with the reading's name
 * cut and the limit kept, else cut from the end. */
function fitBandLabel(label: BandLabel, room: number, peers?: readonly string[]): string {
	if (widthOf(label.text, SMALL_SIZE, 600) <= room) return label.text;
	if (peers !== undefined) return wholeBandLabel(label, room, peers);
	if (label.name !== undefined) {
		const rest = label.text.slice(label.name.length);
		const nameRoom = room - widthOf(rest, SMALL_SIZE, 600);
		const name = nameRoom >= 16 ? fitText(label.name, SMALL_SIZE, 600, nameRoom) : "";
		if (name !== "") return `${name}${rest}`;
	}
	return fitText(label.text, SMALL_SIZE, 600, room);
}

/**
 * A band label in a pane with large values or Scale and grid: the reading's
 * name shortens by whole rungs, as the large values' names do ("GPU Temp
 * warn 64.0 °C"), then goes ("warn 64.0 °C"); the limit itself is never
 * cut, so a label with no room for it is left out (its band edge stays).
 */
function wholeBandLabel(label: BandLabel, room: number, peers: readonly string[]): string {
	const rest = label.name === undefined ? label.text : label.text.slice(label.name.length);
	const rungs = label.name === undefined ? [] : nameRungs(label.name, peers).slice(1).map((rung) => `${rung}${rest}`);
	return [...rungs, rest.trimStart()].find((text) => widthOf(text, SMALL_SIZE, 600) <= room) ?? "";
}

/** The text cut to `max` px with an ellipsis, or "" when not even that fits. */
function fitText(text: string, size: number, weight: 600 | 700, max: number): string {
	if (widthOf(text, size, weight) <= max) return text;
	const cut = cutToFit(text, (line) => widthOf(line, size, weight) <= max);
	return widthOf(cut, size, weight) <= max ? cut : "";
}

// ---- series ------------------------------------------------------------------

export type SeriesDraw = {
	readonly input: StripSeriesInput;
	readonly index: number;
	readonly unit: string;
	readonly displayUnit: string;
	readonly color: string;
	/** Scratch (graph.ts): read while the frame is built, never kept. */
	readonly bins: Bins;
	readonly runs: readonly Run[];
	/** Where each segment was observed; a bucket outside them has no value. */
	readonly spans: readonly Span[];
};

function statusWord(s: StripSeriesInput, bins: Bins): string | undefined {
	if (s.state === "missing") return "not found";
	if (s.state === "unavailable") return "unavailable";
	if (s.state === "stale") return "stale";
	if (s.noRoom === true && bins.n === 0) return noHistoryRoom();
	return bins.n === 0 && !Number.isFinite(s.current ?? Number.NaN) ? "no data" : undefined;
}

/**
 * A strip series' default identity color, by its place in the pane (a
 * color the person chose for a reading is drawn exactly as chosen). Sky
 * blue, yellow, reddish purple and bluish green (Okabe and Ito): they stay
 * apart under deuteranopia, protanopia and tritanopia, which the key quad
 * colors do not (their rose and green measure CIEDE2000 0.4 apart under
 * deuteranopia). Each is lifted to the 4.5:1 value floor on the look's
 * own surface, as every built-in value color is; test/strip-scene.test.ts
 * holds the pairs apart after that lift, on every theme and Background.
 */
export const STRIP_SERIES_COLORS = ["#56B4E9", "#F0E442", "#CC79A7", "#009E73"] as const;

/** What a series the history budget refused says in place of its line. */
function noHistoryRoom(): string {
	return t("strip.noHistoryRoom");
}

/** The history budget refused this series: nothing of it can draw. */
function noRoomOf(d: { readonly input: StripSeriesInput; readonly bins: Bins }): boolean {
	return d.input.noRoom === true && d.bins.n === 0;
}

function seriesColor(style: StripStyle, pane: StripPaneV1, index: number, look: Look): string {
	const chosen = pane.series[index]?.color;
	if (chosen !== undefined) return chosen;
	if ((style === "trend" || style === "area" || style === "heat") && index === 0 && pane.readout !== "only") return look.palette.accent;
	return readableValueColor(STRIP_SERIES_COLORS[index % STRIP_SERIES_COLORS.length] as string, look.surface);
}

function drawsOf(pane: StripPaneV1, input: StripPaneInput, plot: PanePlot, look: Look, fahrenheit: boolean, gapMode: StripGapMode | undefined, scratch: Scratch): SeriesDraw[] {
	return input.series.slice(0, seriesLimitsOf(pane).max).map((s, index) => {
		const unit = drawnUnitOf(s);
		const displayUnit = convertUnit(0, unit, fahrenheit).unit;
		const bins = s.history === undefined || plot.buckets === 0 ? NO_BINS : binView(s.history, plot.buckets, scratch);
		return { input: s, index, unit, displayUnit, color: seriesColor(pane.style, pane, index, look), bins, runs: lineRunsOf(bins, s.history, gapMode), spans: observedSpans(s.history, bins, plot.buckets) };
	});
}

// ---- the builder -------------------------------------------------------------

export type PaneFrame = {
	readonly index: number;
	readonly pane: StripPaneV1;
	readonly input: StripPaneInput;
	readonly extent: PaneExtent;
	readonly plot: PanePlot;
	readonly window: HistoryWindowId;
	readonly windowMs: number;
	/** The strip's Brief gaps. */
	readonly gapMode: StripGapMode | undefined;
	/** Overlay anchors: the edges of the present slots of this pane. */
	readonly left: number;
	readonly right: number;
};

/** The pane being drawn: what the runtime holds for its scales, how its
 * stored scale applies (resolvedScale), and what this frame makes of them. */
type PaneScaleState = { readonly input: PaneScaleInput; readonly resolved: ResolvedScale | null; readonly out: { held: Record<string, HeldScale>; slots: Record<string, number>; dial?: ScaleDialInfo } };

/** One scale a pane draws this frame: its view, the scale it holds
 * (native), its ticks, the typed ends that apply, and what it was asked. */
type DrawnScale = { readonly key: string; readonly view: ScaleView; readonly held: HeldScale; readonly st: ScaleTicks | null; readonly kept: TypedEnds | undefined; readonly ask: ScaleAsk; readonly dial: boolean };

/** Value ticks a plot `height` px tall has room for. */
export function maxTicksFor(height: number): number {
	return Math.max(2, Math.floor(height / AXIS_TICK_SPACING) + 1);
}

export class SceneBuilder {
	readonly prims: Prim[] = [];
	readonly paints = new Map<string, string>();
	/** Paints written only into the slices that use them (LogicalScene.localPaints). */
	readonly localPaints = new Map<string, string>();
	/** The scale state of the pane being drawn (buildStripScene sets it). */
	paneScale: PaneScaleState | null = null;
	/** The strip's own unit and decimals per reading (issue #59,
	 * StripConfigV1.readingFormats; buildStripScene sets it). */
	formats: unknown = undefined;
	/** Rows 0 to 3 carry the Strip Screens position line (buildStripScene
	 * sets it): a Tiles tab goes under its column instead. */
	screenRow = false;
	/** Each reading's resolved measure, this build only. */
	private readonly measures = new Map<string, MeasureOptions>();

	constructor(
		readonly look: Look,
		readonly measure: MeasureOptions,
		readonly alertColors: { readonly warn: string; readonly crit: string },
		/** The working arrays this build takes (graph.ts Scratch). */
		readonly scratch = new Scratch()
	) {}

	paint(id: string, color: string, opacity: number): string {
		if (!this.paints.has(id)) this.paints.set(id, flatPaint(id, color, opacity));
		return `fill="url(#${id})"`;
	}

	/** A slice-local paint definition, by id. */
	localDef(id: string, def: string): void {
		if (!this.localPaints.has(id)) this.localPaints.set(id, def);
	}
	rect(layer: Layer, x: number, y: number, w: number, h: number, paint: string): void {
		if (w > 0 && h > 0) this.prims.push({ k: "rect", layer, x, y, w, h, paint });
	}

	text(x: number, y: number, anchor: TextPrim["anchor"], size: number, weight: 600 | 700, fill: string, text: string): TextPrim | undefined {
		if (text === "") return undefined;
		const prim = textPrim(x, y, anchor, size, weight, fill, text);
		this.prims.push(prim);
		return prim;
	}

	// ---- words over the graph, in their edge --------------------------------------

	/** Where this frame's row words hold the plot (SceneBuilder.rowBands):
	 * no other word of a plot is placed there (clearOfText), so a band
	 * label or a tick never crowds a row. */
	readonly rowBoxes: { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number }[] = [];

	/** A word of a row over the graph (the rows layer, drawn in its edge);
	 * its fill should come from the rows' colors (rowColors, onRows). */
	rowText(x: number, y: number, anchor: TextPrim["anchor"], size: number, weight: 600 | 700, fill: string, text: string): TextPrim | undefined {
		if (text === "") return undefined;
		const prim: TextPrim = { ...textPrim(x, y, anchor, size, weight, fill, text), layer: "rows" };
		this.prims.push(prim);
		return prim;
	}

	/** The row words' colors (RowText). */
	get rowColors(): TextColors {
		return this.look.rows.text;
	}

	/** A value's or a mark's own color on a row: lifted to the numeric
	 * floor on the rows' surface (an alert color included). */
	onRows(color: string): string {
		return readableValueColor(color, this.look.rows.surface);
	}

	/**
	 * The bands the words this pane drew over its graph since `from` hold
	 * (the rows layer: words, their chips and swatches), kept clear of every
	 * other word of the plot (clearOfText, clearOfRows). Each row's band
	 * hangs from its top edge or stands on its bottom edge (`anchors`: the
	 * strip's top and bottom by default, a lane's top for its header): it
	 * runs from that edge to ROW_MARGIN past the words' ink, then a third
	 * as far again toward the plot (ROW_BAND_CORE); across, it covers a run of
	 * words and its margins, then ROW_END px past each end. Runs whose ends
	 * would touch merge. An end that would pass the pane's present slots
	 * stops at their edge.
	 */
	rowBands(f: PaneFrame, from: number, anchors: readonly RowAnchor[] = ROW_EDGES): void {
		type Box = { x0: number; x1: number; y0: number; y1: number };
		const items: Box[] = [];
		for (const p of this.prims.slice(from)) {
			if (p.layer !== "rows") continue;
			if (p.k === "text") items.push(textInkBox(p));
			else if (p.k === "rect") items.push({ x0: p.x, x1: p.x + p.w, y0: p.y, y1: p.y + p.h });
		}
		if (items.length === 0) return;
		const lo = f.left;
		const hi = f.right;
		for (const anchor of anchors) {
			const row = items.filter((b) => (b.y0 + b.y1) / 2 >= anchor.from && (b.y0 + b.y1) / 2 < anchor.to).sort((a, b) => a.x0 - b.x0);
			if (row.length === 0) continue;
			// Runs of words, merged where their ends would meet.
			const runs: Box[] = [];
			for (const b of row) {
				const last = runs[runs.length - 1];
				if (last !== undefined && b.x0 - last.x1 < 2 * (ROW_MARGIN + ROW_END)) {
					last.x1 = Math.max(last.x1, b.x1);
					last.y0 = Math.min(last.y0, b.y0);
					last.y1 = Math.max(last.y1, b.y1);
				} else runs.push({ ...b });
			}
			// One height for the row, from its deepest word.
			const core = Math.max(...runs.map((run) => (anchor.edge === "top" ? run.y1 + ROW_MARGIN - anchor.y : anchor.y - (run.y0 - ROW_MARGIN))));
			const h = Math.ceil(core / ROW_BAND_CORE);
			const y0 = anchor.edge === "top" ? anchor.y : anchor.y - h;
			for (const run of runs) {
				const a = Math.floor(run.x0 - ROW_MARGIN);
				const z = Math.ceil(run.x1 + ROW_MARGIN);
				const start = a - ROW_END >= lo;
				const end = z + ROW_END <= hi;
				this.rowBoxes.push({ x0: start ? a - ROW_END : lo, x1: end ? z + ROW_END : hi, y0, y1: y0 + h });
			}
		}
	}

	format(value: number, unit: string, measure: MeasureOptions = this.measure): { valueText: string; unitText: string } {
		return formatMeasurement(value, unit, measure);
	}

	/**
	 * One reading's measure (issue #59): the strip's own Decimals, °F and the
	 * deck's Data units, with the reading's own unit and decimals over them
	 * when the strip keeps a format for it (measureFor: the same rules as a
	 * key's or a dial's). The strip's measure itself when it keeps none, so
	 * a reading with no format takes exactly the path it took before.
	 */
	measureOf(d: { readonly input: { readonly key: string }; readonly unit: string }): MeasureOptions {
		if (this.formats === undefined) return this.measure;
		const id = `${d.input.key}\u0000${d.unit}`;
		let m = this.measures.get(id);
		if (m === undefined) {
			m = measureFor(this.measure, this.formats, { key: d.input.key, unit: d.unit });
			this.measures.set(id, m);
		}
		return m;
	}

	/** A reading's value in its own unit and decimals. */
	formatOf(d: SeriesDraw, value: number): { valueText: string; unitText: string } {
		return formatMeasurement(value, d.unit, this.measureOf(d));
	}

	/** A reading with its own format: its value's shorter texts in the
	 * unit it shows in (measure.ts exactFallback), for a place that cannot
	 * hold its own text; none for any other reading. */
	fallbackOf(d: SeriesDraw, value: number, unitText: string): string[] {
		return exactFallback(value, d.unit, this.measureOf(d), false)
			.filter((m) => m.unitText === unitText)
			.map((m) => m.valueText);
	}

	/** A reading's statistic (min, max, a range end) in its own unit and
	 * decimals, its unit attached for data ("0.45GB"). */
	statOf(d: SeriesDraw, value: number): string {
		return formatStat(value, d.unit, this.measureOf(d));
	}

	/** The fixed unit a scale over these readings prints in: the one every
	 * reading with a fixed unit has, else none (Auto tiers, as before). */
	fixedUnitOf(draws: readonly SeriesDraw[]): FixedDataUnit | undefined {
		let unit: FixedDataUnit | undefined;
		for (const d of draws) {
			const own = this.measureOf(d).fixedUnit;
			if (own === undefined) continue;
			if (unit !== undefined && own !== unit) return undefined;
			unit = own;
		}
		return unit;
	}

	// The measures this module's own styles use, for the styles drawn in
	// their own modules (meters.ts, events.ts), which can only
	// import this module's types.

	widthOf(text: string, size: number, weight: 600 | 700): number {
		return widthOf(text, size, weight);
	}

	fitText(text: string, size: number, weight: 600 | 700, max: number): string {
		return fitText(text, size, weight, max);
	}

	/** clearOfSeams, for the styles drawn in their own modules. */
	clearOfSeams(text: string, anchor: TextPrim["anchor"], x: number, size: number, weight: 600 | 700, dir: 1 | -1): number {
		return clearOfSeams(text, anchor, x, size, weight, dir);
	}

	/** A series' status word ("stale", "not found", "no data"), if any. */
	statusOf(d: SeriesDraw): string | undefined {
		return statusWord(d.input, d.bins);
	}

	/** A limit as text, as the band labels write it ("85.0", "12.1GB"), in
	 * the reading's own unit and decimals when `d` has them. */
	limitText(value: number, unit: string, d?: SeriesDraw): string {
		return bandNumber(value, unit, d === undefined ? this.measure : this.measureOf(d));
	}

	backing(width: number): { stroke: string; width: number } | undefined {
		return this.look.background === "clear" ? { stroke: this.look.palette.track, width: width + 2 } : undefined;
	}

	/** LIVE or PAUSED (with its time), its size, and the x where it starts.
	 * PAUSED and its time on a pane of one present dial slot keep the size
	 * they had under the graph (11 px): at 15 px they would take two thirds
	 * of the row and leave the window's words or a color scale no room. */
	badge(f: PaneFrame): { text: string; left: number; size: number } {
		const view = f.input.view;
		const text = view.mode === "paused" ? `PAUSED${view.label !== undefined ? ` ${view.label}` : ""}` : "LIVE";
		const size = view.mode === "paused" ? pausedBadgeSize(f) : BADGE_SIZE;
		return { text, left: f.right - PAD - widthOf(text, size, 700), size };
	}

	/** The bottom row: the time line on the left, LIVE or PAUSED on the right.
	 * `reserve` px just left of the badge stay free for something placed
	 * there (the heat scale). Returns the x where the badge starts. */
	bottomRow(f: PaneFrame, leftText: string, reserve = 0): number {
		const t = this.rowColors;
		const badge = this.badge(f);
		// LIVE would contradict readings that have all stopped; its slot stays
		// reserved, so nothing beside it moves.
		if (f.input.view.mode === "paused" || !everyReadingStopped(f.input.series)) this.rowText(f.right - PAD, BOTTOM_BASELINE, "end", badge.size, 700, f.input.view.mode === "paused" ? t.badge : t.unit, badge.text);
		const room = badge.left - ROW_BADGE_GAP - reserve - (f.left + PAD);
		const words = f.input.notice ?? this.screenWords(f, f.left + PAD, room, ROW_SIZE, 600, this.afterWindow(f, leftText)) ?? leftText;
		this.flowWords(f.left + PAD, BOTTOM_BASELINE, ROW_SIZE, t.unit, words, room);
		return badge.left;
	}

	/**
	 * A row's words from x in at most `room` px: as one text when no number
	 * in them straddles a slice seam; else in parts (split at " · "), each
	 * moved right past the seam its number would cross. Either way the
	 * trailing parts that do not fit are left out whole ("min 44.0", never
	 * "min…" or "max 8…"). A first part too long on its own (an Events
	 * sentence, a notice) steps down to 13 and 11 px before it is cut.
	 */
	flowWords(x: number, y: number, rowSize: number, fill: string, words: string, room: number): void {
		const parts = words.split(" · ");
		const steps = [rowSize, ...ROW_STEPS.filter((s) => s < rowSize)];
		const size = steps.find((s) => widthOf(parts[0] as string, s, 600) <= room) ?? (steps[steps.length - 1] as number);
		let kept = parts.length;
		while (kept > 1 && widthOf(parts.slice(0, kept).join(" · "), size, 600) > room) kept--;
		const fitted = fitText(parts.slice(0, kept).join(" · "), size, 600, room);
		if (clearOfSeams(fitted, "start", x, size, 600, 1) === x) {
			this.rowText(x, y, "start", size, 600, fill, fitted);
			return;
		}
		const placed: { x: number; text: string }[] = [];
		let at = x;
		for (const part of parts) {
			const px = clearOfSeams(part, "start", at, size, 600, 1);
			if (px + widthOf(part, size, 600) > x + room) break;
			placed.push({ x: px, text: part });
			at = px + widthOf(`${part} · `, size, 600);
		}
		if (placed.length === 0) {
			this.rowText(x, y, "start", size, 600, fill, fitText(parts[0] as string, size, 600, room));
			return;
		}
		placed.forEach((p, i) => this.rowText(p.x, y, "start", size, 600, fill, i < placed.length - 1 ? `${p.text} ·` : p.text));
	}

	/** A bottom line's words after its leading window label ("5 min", or
	 * the time axis' "-5m"): the place a screen's name takes. */
	private afterWindow(f: PaneFrame, text: string): string {
		for (const lead of [WINDOW_LABEL[f.window], `-${shortSpan(f.windowMs)}`]) {
			if (text === lead) return "";
			if (text.startsWith(`${lead} · `)) return text.slice(lead.length + 3);
		}
		return text;
	}

	/**
	 * Strip Screens: the screen's name and place in the window words, for a
	 * moment after a change (StripPaneInput.screenLabel). From x, in at most
	 * `room` px and inside the slice x starts in, so no digit of it crosses
	 * a seam: the name shortened by whole words (the readout's ladder), then
	 * the place alone. `rest`, the line's other words, follows only while
	 * the name still fits beside it. Undefined when no label is due or not
	 * even the place fits: the window words stay.
	 */
	screenWords(f: PaneFrame, x: number, room: number, size: number, weight: 600 | 700, rest = ""): string | undefined {
		const label = f.input.screenLabel;
		if (label === undefined) return undefined;
		const right = Math.min(x + room, (Math.floor(x / SLICE_W) + 1) * SLICE_W - 2);
		const fits = (text: string): boolean => inkEdges([{ text, fontSize: size, fontWeight: weight }], "start", x).right <= right && widthOf(text, size, weight) <= right - x;
		const counted = (name: string): string => (label.more === undefined || label.more <= 0 ? name : t("strip.screen.more", { name, count: label.more }));
		const leads = [...(label.name.trim() === "" ? [] : phraseRungs(label.name).map((name) => `${counted(name)} · ${label.place}`)), label.place];
		for (const lead of leads) {
			for (const text of rest === "" ? [lead] : [`${lead} · ${rest}`, lead]) if (fits(text)) return text;
		}
		return undefined;
	}

	/** The current value (or a status word) right-aligned on the top row, at
	 * `size`. Returns its left edge; with `dry`, draws nothing. */
	currentValue(f: PaneFrame, draw: SeriesDraw | undefined, value: number | undefined, color: string, size = VALUE_SIZE, dry = false): number {
		const pane = f.pane;
		if (!pane.overlays.current || draw === undefined) return f.right - PAD;
		const word = value === undefined ? (statusWord(draw.input, draw.bins) ?? "no data") : undefined;
		const t = this.rowColors;
		if (word !== undefined) {
			if (!dry) this.rowText(f.right - PAD, TOP_BASELINE, "end", LABEL_SIZE, 600, t.unit, word);
			return f.right - PAD - widthOf(word, LABEL_SIZE, 600);
		}
		const m = this.formatOf(draw, value as number);
		let x = f.right - PAD;
		if (pane.overlays.unit && m.unitText !== "") {
			if (!dry) this.rowText(x, TOP_BASELINE, "end", LABEL_SIZE, 600, t.unit, m.unitText);
			x -= widthOf(m.unitText, LABEL_SIZE, 600) + 4;
		}
		if (!dry) this.rowText(x, TOP_BASELINE, "end", size, 700, this.onRows(color), m.valueText);
		return x - widthOf(m.valueText, size, 700);
	}

	/**
	 * Legend items from the left edge up to `limit`: a chip per series when
	 * there is more than one, the name, and an optional value or note that is
	 * never cut. Every drawn series keeps its item. When they do not all fit,
	 * names shorten by whole words (the readout's name ladder, nameRungs),
	 * the widest first, and then go, leaving the chip and its value; a name
	 * is never cut mid-word. Only when chips and values alone cannot fit
	 * does an item go, whole, from the end. `bright` names the item whose
	 * value draws in its reading's own color (the highlighted reading when
	 * no large value stands at the right). Returns whether every item kept
	 * a name; with `dry`, draws nothing.
	 */
	legend(f: PaneFrame, draws: readonly SeriesDraw[], highlight: number, limit: number, extra?: (d: SeriesDraw) => string, opts: { readonly bright?: number; readonly dry?: boolean } = {}): boolean {
		if (!f.pane.overlays.legend || draws.length === 0) return true;
		const t = this.rowColors;
		const chipW = draws.length > 1 ? CHIP + 4 : 0;
		const gap = 12;
		const names = draws.map((d) => d.input.name || d.input.key);
		const joined = (name: string, suffix: string): string => (name === "" ? suffix : suffix === "" ? name : `${name} ${suffix}`);
		const items = draws.map((d, i) => {
			const suffix = noRoomOf(d) ? noHistoryRoom() : (extra?.(d) ?? "");
			const rungs = nameRungs(names[i] as string, names);
			// A chip or a value still says which series it is without a name.
			const options = chipW > 0 || suffix !== "" ? [...rungs, ""] : rungs.length > 0 ? rungs : [""];
			return { d, suffix, options, at: 0 };
		});
		type Item = (typeof items)[number];
		const widthAt = (it: Item): number => chipW + widthOf(joined(it.options[it.at] as string, it.suffix), LABEL_SIZE, 600);
		/** Each item's x as drawn: left to right, an item whose live value
		 * would straddle a seam moved right past it; and where the last ends. */
		const place = (): { at: number[]; end: number } => {
			const at: number[] = [];
			let x = f.left + PAD;
			let end = x;
			for (const it of items) {
				// A chip sits whole in one slice.
				if (chipW > 0) x += offSeam(x, x + CHIP, 1, 1);
				const name = it.options[it.at] as string;
				const live = numberSpan(name === "" ? "" : `${name} `, it.suffix, x + chipW, LABEL_SIZE, 600);
				if (live !== undefined) x += offSeam(live.l, live.r, 1);
				at.push(x);
				end = x + widthAt(it);
				x = end + gap;
			}
			return { at, end };
		};
		// Names shorten, the widest first, until the items as placed fit.
		while (place().end > limit + 0.5) {
			let pick: Item | undefined;
			for (const it of items) if (it.at < it.options.length - 1 && (pick === undefined || widthAt(it) > widthAt(pick))) pick = it;
			if (pick === undefined) break;
			pick.at++;
		}
		const { at } = place();
		let complete = true;
		items.forEach((it, i) => {
			const x = at[i] as number;
			const name = it.options[it.at] as string;
			const text = joined(name, it.suffix);
			if (name === "" && (it.options[0] as string) !== "") complete = false;
			if ((text === "" && chipW === 0) || x + widthAt(it) > limit + 0.5) {
				complete = false;
				return;
			}
			if (opts.dry === true) return;
			if (chipW > 0) this.rect("rows", x, TOP_BASELINE - CHIP - 1, CHIP, CHIP, `fill="${it.d.color}"`);
			const fill = it.d.index === highlight ? t.label : t.unit;
			if (opts.bright === it.d.index && it.suffix !== "" && name !== "") {
				// The name in its word color, the value in its reading's color.
				this.rowText(x + chipW, TOP_BASELINE, "start", LABEL_SIZE, 600, fill, name);
				this.rowText(x + chipW + widthOf(`${name} `, LABEL_SIZE, 600), TOP_BASELINE, "start", LABEL_SIZE, 600, this.onRows(it.d.color), it.suffix);
			} else if (opts.bright === it.d.index && it.suffix !== "") this.rowText(x + chipW, TOP_BASELINE, "start", LABEL_SIZE, 600, this.onRows(it.d.color), it.suffix);
			else if (text !== "") this.rowText(x + chipW, TOP_BASELINE, "start", LABEL_SIZE, 600, fill, text);
		});
		return complete;
	}

	/** The bottom row's left text. With Scale and grid on, the window's
	 * start is the time axis' first label ("-5m") and the min and max need
	 * no "over 5 min": the axis says what they span. */
	timeText(f: PaneFrame, minmax: string | undefined, cursorNote: string | undefined): string {
		const parts: string[] = [];
		const label = WINDOW_LABEL[f.window];
		if (f.pane.overlays.axes === true) {
			parts.push(`-${shortSpan(f.windowMs)}`);
			if (minmax !== undefined) parts.push(minmax);
		} else {
			if (f.pane.overlays.time) parts.push(label);
			if (minmax !== undefined) parts.push(f.pane.overlays.time ? minmax : `${minmax} over ${label}`);
		}
		if (cursorNote !== undefined) parts.push(cursorNote);
		return parts.join(" · ");
	}

	minmaxText(f: PaneFrame, draw: SeriesDraw | undefined): string | undefined {
		if (!f.pane.overlays.minmax || draw === undefined) return undefined;
		const e = extentOf(draw.bins);
		if (e === null) return undefined;
		const unitSuffix = f.pane.overlays.unit && !isDataUnit(draw.unit) && draw.displayUnit !== "" ? ` ${draw.displayUnit}` : "";
		return `min ${this.statOf(draw, e.lo)} · max ${this.statOf(draw, e.hi)}${unitSuffix}`;
	}

	/** Buckets back from the newest to the inspect cursor at this frame's
	 * width, or undefined when live. */
	cursorBack(f: PaneFrame): number | undefined {
		if (f.input.view.mode !== "paused" || f.plot.buckets === 0) return undefined;
		return cursorBucketsBack(f.plot, f.windowMs, f.input.view.agoMs);
	}

	cursorNote(f: PaneFrame): string | undefined {
		const back = this.cursorBack(f);
		if (back === undefined) return undefined;
		if (back === 0) return "at newest";
		const seconds = Math.round((back * f.windowMs) / f.plot.buckets / 1000);
		return `at -${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
	}

	cursorBucket(f: PaneFrame): number | undefined {
		const back = this.cursorBack(f);
		return back === undefined ? undefined : f.plot.buckets - 1 - back;
	}

	/** A series' reading: at the inspect cursor when paused; live, the
	 * poller's current value, else the newest bucket's while a segment was
	 * still being observed there. Inside a gap there is none. A reading the
	 * poller lists with no finite value (a calculated reading whose input
	 * went missing) has none at once: its last value is not current. */
	reading(f: PaneFrame, d: SeriesDraw): number | undefined {
		const j = this.cursorBucket(f);
		if (j !== undefined) return valueAt(d.bins, d.spans, j);
		const live = d.input.current;
		if (live !== undefined && Number.isFinite(live)) return live;
		if (d.input.state === "ok") return undefined;
		return f.plot.buckets === 0 ? undefined : valueAt(d.bins, d.spans, f.plot.buckets - 1);
	}

	cursorLine(f: PaneFrame, top: number, bottom: number): void {
		const j = this.cursorBucket(f);
		if (j === undefined) return;
		this.rect("marks", snap(bucketX(f.plot, j) - 0.5), top, 1, bottom - top, `fill="${this.look.text.badge}"`);
	}

	baseline(f: PaneFrame, y: number): void {
		this.rect("marks", f.plot.x0, y, f.plot.x1 - f.plot.x0, 1, this.look.structure);
	}

	/** A text whose slicing box is its measured ink (plus a margin), not
	 * the generous estimate: large readout digits and axis labels are placed
	 * inside one slice, and this keeps the slicer from also sending them to
	 * the neighbour. */
	inkText(x: number, y: number, anchor: TextPrim["anchor"], size: number, weight: 600 | 700, fill: string, text: string, layer: Layer = "marks"): TextPrim | undefined {
		if (text === "") return undefined;
		const edges = inkEdges([{ text, fontSize: size, fontWeight: weight }], anchor, x);
		const margin = 2 + (isTahoma() ? 0 : size * 0.05);
		const prim: TextPrim = { k: "text", layer, x: snap(x), y, anchor, size, weight, fill, text, bx0: edges.left - margin, bx1: edges.right + margin, pinned: true };
		this.prims.push(prim);
		return prim;
	}

	/** Whether a text drawn so would keep `gap` px clear of every word the
	 * pane has drawn since `from` (by the boxes textInkBox measures) and,
	 * unless it is a row's own word (`rows` false), out of the row bands. */
	clearOfText(candidate: Pick<TextPrim, "x" | "y" | "anchor" | "size" | "weight" | "text">, from: number, gap = 2, rows = true): boolean {
		const a = textInkBox(candidate);
		for (const p of this.prims.slice(from)) {
			if (p.k !== "text") continue;
			const b = textInkBox(p);
			if (a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap) return false;
		}
		return !rows || this.clearOfRows(a);
	}

	/** Whether a box lies out of every row band of the frame. */
	clearOfRows(a: { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number }): boolean {
		return this.rowBoxes.every((s) => !(a.x0 < s.x1 && s.x0 < a.x1 && a.y0 < s.y1 && s.y0 < a.y1));
	}

	// ---- Scale and grid ------------------------------------------------------

	// ---- value scales (src/strip/scale.ts) ----------------------------------

	/** The scale held for `key` this frame (nextHeldScale), recorded for
	 * the runtime (PaneScaleOut.held). */
	heldScale(key: string, ask: ScaleAsk): HeldScale {
		const st = this.paneScale;
		const held = nextHeldScale(st?.input.prev?.[key], ask, st?.input.at ?? 0);
		if (st !== null) st.out.held[key] = held;
		return held;
	}

	/** The typed ends that apply to readings in `unit` (native), if any. */
	typedEnds(unit: string, first: boolean): TypedEnds | undefined {
		return this.paneScale?.resolved?.ends(unit, first);
	}

	/** Whether the pane's stored scale applies to nothing it draws (the
	 * panel's "does not use these ends"). */
	get stampedScale(): boolean {
		return this.paneScale?.resolved?.stamped === true;
	}

	/**
	 * A reserved width (6.2 of the spec): the one the runtime holds for the
	 * stored setup, grown (never shrunk) to `drawn`; with none held, the
	 * width `measure` reserves now. Recorded for the runtime.
	 */
	slot(key: string, drawn: number, measure: () => number): number {
		const st = this.paneScale;
		const held = st?.input.slots?.[key];
		const w = Math.max(held ?? measure(), drawn);
		if (st !== null) st.out.slots[key] = w;
		return w;
	}

	/** What a scale over these readings must hold now: their window
	 * extents and current values (native), null with nothing observed. */
	needOf(draws: readonly SeriesDraw[]): Extent | null {
		const parts: (Extent | null)[] = draws.map((d) => extentOf(d.bins));
		for (const d of draws) {
			const v = d.input.current;
			if (v !== undefined && Number.isFinite(v) && d.input.state !== "missing") parts.push({ lo: v, hi: v });
		}
		return unionExtent(parts);
	}

	/**
	 * One scale for this frame: the held scale for `key` over `need` with
	 * the typed ends that apply, its ticks, and on a pane that takes the
	 * dial (`dial`) the turned span and the dial's report. Null with nothing
	 * to draw: no reading observed and not both ends typed (a scale typed
	 * at both ends draws before its first value).
	 */
	scaleFor(key: string, unit: string, need: Extent | null, maxTicks: number, opts: { readonly kept?: TypedEnds; readonly kind?: ReturnType<typeof scaleKindOf>; readonly dial?: boolean; readonly meter?: true; readonly fixedUnit?: FixedDataUnit } = {}): DrawnScale | null {
		// A scale whose readings print in one fixed unit prints in it too.
		const view = scaleView(unit, this.measure, opts.fixedUnit);
		const kept = opts.kept;
		const both = kept?.min !== undefined && kept.max !== undefined;
		const prev = this.paneScale?.input.prev?.[key];
		const seen = need ?? (both ? { lo: kept.min as number, hi: kept.max as number } : null);
		if (seen === null) {
			// Nothing observed: a scale held from before keeps its place.
			if (prev !== undefined && this.paneScale !== null) this.paneScale.out.held[key] = prev;
			return null;
		}
		const dial = opts.dial === true && !both;
		const span = dial ? this.paneScale?.input.span : undefined;
		const kind = opts.kind ?? scaleKindOf(unit);
		const ask: ScaleAsk = { need: seen, view, kind, maxTicks, ...(kept === undefined ? {} : { kept: { ...(kept.min === undefined ? {} : { lo: kept.min }), ...(kept.max === undefined ? {} : { hi: kept.max }) } }), ...(span === undefined ? {} : { span }), ...(opts.meter === true ? { meter: true as const } : {}) };
		const held = this.heldScale(key, ask);
		const st = scaleTicks(view, held, maxTicks);
		if (dial && this.paneScale !== null) this.paneScale.out.dial = { key, kind, view, need: seen, maxTicks, onScreen: toView(view, held.hi) - toView(view, held.lo) };
		return { key, view, held, st, kept, ask, dial };
	}

	/** The texts a scale's slot must hold before the next stored change:
	 * its target's, each dial stop's and its typed ends' (slotTexts). */
	scaleSlotTexts(s: DrawnScale, unitWord: string, axes: boolean): string[] {
		return slotTexts(s.view, candidateScales(s.ask, autoTarget({ ...s.ask, span: undefined } as ScaleAsk), s.dial), s.ask.maxTicks, unitWord, axes);
	}

	/**
	 * A reading past a typed end colors that end (4.5 of the spec): the
	 * alert color while the passing reading is in alert, else its line's
	 * color; the highlighted reading first, else the first past it. Only a
	 * typed end can be passed: an automatic one grows at once.
	 */
	passedEnds(f: PaneFrame, draws: readonly SeriesDraw[], s: DrawnScale, highlight = -1): { hi?: string; lo?: string } {
		const kept = s.kept;
		if (kept === undefined) return {};
		const eps = 1e-9 * Math.max(1, Math.abs(s.held.hi), Math.abs(s.held.lo));
		const ordered = [...draws.filter((d) => d.index === highlight), ...draws.filter((d) => d.index !== highlight)];
		const colorOf = (d: SeriesDraw): string => {
			const level = this.levelOf(f, d, this.reading(f, d));
			return this.onRows(level !== null ? this.alertColors[level] : d.color);
		};
		const past = (side: "hi" | "lo"): SeriesDraw | undefined =>
			ordered.find((d) => {
				const e = extentOf(d.bins);
				const v = d.input.current;
				const values = [...(e === null ? [] : [side === "hi" ? e.hi : e.lo]), ...(v !== undefined && Number.isFinite(v) ? [v] : [])];
				return values.some((x) => (side === "hi" ? x > s.held.hi + eps : x < s.held.lo - eps));
			});
		const hi = kept.max === undefined ? undefined : past("hi");
		const lo = kept.min === undefined ? undefined : past("lo");
		return { ...(hi === undefined ? {} : { hi: colorOf(hi) }), ...(lo === undefined ? {} : { lo: colorOf(lo) }) };
	}

	/** A value tick's y on a plot, on a whole pixel row so a gridline never
	 * blurs over two (`value` in the ticks' units). */
	tickY(map: YMap, st: ScaleTicks, value: number): number {
		return Math.round(yOf(map, tickNative(st, value)));
	}

	/** Light horizontal gridlines at the value ticks, under everything. The
	 * bottom tick sits on the baseline, which marks it already. */
	valueGrid(f: PaneFrame, map: YMap, st: ScaleTicks): void {
		for (const v of st.ticks.values) {
			const y = this.tickY(map, st, v);
			if (y >= map.bottom - 1) continue;
			this.rect("base", f.plot.x0, y, f.plot.x1 - f.plot.x0, 1, this.look.structure);
		}
	}

	/** A tick value as text (endText): the step's decimals in the unit on
	 * view, or the scale's data tier ("2.5Mbps"); "0" for zero. */
	tickText(value: number, st: ScaleTicks, end = false): string {
		return endText(value, st, end);
	}

	/**
	 * Value tick labels at the plot's left edge, each just above its line
	 * (the top one below its line when the row above is taken), the unit
	 * once, on the top label. The top and bottom labels place first, so the
	 * range is always named; a middle label that would touch a placed one is
	 * left out, and its gridline stays.
	 */
	valueLabels(f: PaneFrame, map: YMap, st: ScaleTicks, top: number, paneStart: number, bottomLimit = PLOT_BOTTOM, between = false): void {
		const t = this.look.text;
		const ticks = st.ticks;
		const x = Math.max(f.plot.x0, f.left) + 3;
		const cap = Math.ceil(SMALL_SIZE * 0.75);
		const unitWord = scaleUnitWord(st.view, f.pane.overlays.unit);
		const n = ticks.values.length;
		const order = [n - 1, 0, ...Array.from({ length: Math.max(0, n - 2) }, (_, i) => i + 1)];
		for (const i of order) {
			const v = ticks.values[i] as number;
			// `between`: the scale's ends are labelled already (scaleEnds).
			if (between && (v <= ticks.lo || v >= ticks.hi)) continue;
			const y = this.tickY(map, st, v);
			const above = y - 3;
			const baseline = above - cap >= top - 2 ? above : y + 3 + cap;
			if (baseline > bottomLimit) continue;
			const withUnit = i === n - 1 ? unitWord : "";
			const label = { x, y: baseline, anchor: "start" as const, size: SMALL_SIZE, weight: 600 as const, text: `${endText(v, st, i === 0 || i === n - 1)}${withUnit}` };
			if (between) {
				// Between the scale's ends, in their column and their row band
				// (drawn before the bands are laid, which then take them in).
				if (!this.clearOfText(label, paneStart, 2, false)) continue;
				this.inkText(label.x, label.y, label.anchor, label.size, label.weight, this.rowColors.unit, label.text, "rows");
				continue;
			}
			// Band labels and the window's extremes outrank a tick's label: a
			// label they would touch is left out, and its gridline stays.
			if (!this.clearOfText(label, paneStart)) continue;
			this.inkText(label.x, label.y, label.anchor, label.size, label.weight, t.unit, label.text);
		}
	}

	/**
	 * The window's highest and lowest reading of one series, marked where
	 * they happened and labelled as the window's ("max 67.9 in 5 min", not a
	 * session statistic). A label sits beside its mark inside the mark's own
	 * slice, else it is left out.
	 */
	windowExtremes(f: PaneFrame, d: SeriesDraw, map: YMap, paneStart: number): void {
		const e = extentOf(d.bins);
		if (e === null || !(e.hi > e.lo) || d.bins.n < 2) return;
		const t = this.look.text;
		// A graph one dial slot wide keeps its marks; their words would crowd it.
		const labelled = f.plot.x1 - f.plot.x0 >= 300;
		for (const kind of ["max", "min"] as const) {
			const value = kind === "max" ? e.hi : e.lo;
			let at = -1;
			for (let i = 0; i < d.bins.n; i++) if ((kind === "max" ? d.bins.max[i] : d.bins.min[i]) === value) at = i;
			if (at < 0) continue;
			const x = Math.round(bucketX(f.plot, d.bins.j[at] as number));
			const y = Math.round(yOf(map, value));
			if (x < f.left || x >= f.right) continue;
			this.rect("marks", x - 2, y - 2, 4, 4, `fill="${d.color}"`);
			if (!labelled) continue;
			const text = `${kind} ${this.statOf(d, value)} in ${WINDOW_LABEL[f.window]}`;
			const baseline = Math.min(PLOT_BOTTOM - 1, Math.max(map.top + 9, y + 4));
			const sliceLo = Math.floor(x / SLICE_W) * SLICE_W;
			const lo = Math.max(sliceLo, f.plot.x0, f.left) + 2;
			const hi = Math.min(sliceLo + SLICE_W, f.plot.x1, f.right) - 2;
			for (const [px, anchor] of [
				[x + 6, "start"],
				[x - 6, "end"]
			] as const) {
				const edges = inkEdges([{ text, fontSize: SMALL_SIZE, fontWeight: 600 }], anchor, px);
				if (edges.left < lo || edges.right > hi) continue;
				// Never over another word of the pane (an alert band's label).
				if (!this.clearOfText({ x: px, y: baseline, anchor, size: SMALL_SIZE, weight: 600, text }, paneStart)) continue;
				this.inkText(px, baseline, anchor, SMALL_SIZE, 600, t.unit, text);
				break;
			}
		}
	}

	/** x of a moment `agoMs` before the newest bucket's end. */
	timeX(f: PaneFrame, agoMs: number): number {
		return Math.round(f.plot.x1 - (agoMs / f.windowMs) * (f.plot.x1 - f.plot.x0));
	}

	/** Light vertical gridlines at the time ticks, under everything. */
	timeGrid(f: PaneFrame, top: number, bottom: number): void {
		for (const tick of timeTicks(f.windowMs)) this.rect("base", this.timeX(f, tick.agoMs), top, 1, bottom - top, this.look.structure);
	}

	/**
	 * The time axis: a short tick under the plot at each time tick, and its
	 * label ("-30s") on the bottom row wherever the row is free: never over
	 * the row's own text (the window's start, min and max, the badge), never
	 * across a slice seam (a label on a seam moves to one side of its tick),
	 * never touching another label. A tick whose label has no room keeps its
	 * mark.
	 */
	timeAxis(f: PaneFrame, paneStart: number, bottom: number): void {
		const t = this.rowColors;
		const rowTop = BOTTOM_BASELINE - 9;
		const taken: [number, number][] = [];
		// The row's own marks (a color scale's swatches), not the plot's.
		for (const p of this.prims.slice(paneStart)) {
			if (p.k === "rect" && p.layer === "rows" && p.y < BOTTOM_BASELINE + 2 && p.y + p.h > rowTop) taken.push([p.x, p.x + p.w]);
		}
		const lo = Math.max(f.plot.x0, f.left) + PAD;
		const hi = Math.min(f.plot.x1, f.right) - PAD;
		for (const tick of timeTicks(f.windowMs)) {
			const x = this.timeX(f, tick.agoMs);
			if (x <= f.plot.x0 || x >= f.plot.x1 || x < f.left || x >= f.right) continue;
			this.rect("marks", x, bottom + 2, 1, 2, `fill="${t.unit}"`);
			const options: (readonly [number, TextPrim["anchor"]])[] = [
				[x, "middle"],
				[x + 3, "start"],
				[x - 2, "end"]
			];
			for (const [px, anchor] of options) {
				const edges = inkEdges([{ text: tick.label, fontSize: SMALL_SIZE, fontWeight: 600 }], anchor, px);
				const a = edges.left - 3;
				const b = edges.right + 3;
				if (edges.left < lo || edges.right > hi) continue;
				if (Math.floor(edges.left / SLICE_W) !== Math.floor((edges.right - 0.01) / SLICE_W)) continue;
				if (taken.some(([u, v]) => a < v + 3 && u < b + 3)) continue;
				if (!this.clearOfText({ x: px, y: BOTTOM_BASELINE, anchor, size: SMALL_SIZE, weight: 600, text: tick.label }, paneStart, 4, false)) continue;
				this.inkText(px, BOTTOM_BASELINE, anchor, SMALL_SIZE, 600, t.unit, tick.label, "rows");
				taken.push([a, b]);
				break;
			}
		}
	}

	hiddenTicks(f: PaneFrame, draw: SeriesDraw, bottom: number): void {
		const view = draw.input.history;
		if (view === undefined) return;
		for (const h of view.hidden) {
			const x = snap(f.plot.x0 + (h.x / Math.max(1, view.widthPx)) * (f.plot.x1 - f.plot.x0));
			this.rect("marks", x, bottom - 6, 1, 6, `fill="${this.look.text.unit}"`);
		}
	}

	/** A reading's bands on a plot. Their labels, when `labels` collects
	 * them, are laid out together afterwards (bandLabels). */
	bands(f: PaneFrame, draw: SeriesDraw, map: YMap, labels?: BandLabel[], edgeLayer: Layer = "marks"): void {
		const own = f.input.bands.filter((b) => b.readingKey === draw.input.key);
		if (own.length === 0) return;
		const upward = bandsOpenUpward(f.input.bands, draw.input.key);
		for (const band of own) {
			const span = bandSpan(band, map, draw.unit, this.measure.fahrenheit, upward);
			if (span === null) continue;
			const color = this.alertColors[band.level];
			this.rect("base", f.plot.x0, span.top, f.plot.x1 - f.plot.x0, span.bottom - span.top, this.paint(band.level === "warn" ? "w" : "c", color, 0.18));
			const edgeY = upward ? span.bottom - 1 : span.top;
			this.rect(edgeLayer, f.plot.x0, edgeY, f.plot.x1 - f.plot.x0, 1, `fill="${color}"`);
			if (labels !== undefined && band.label !== "") {
				const y = upward ? Math.max(span.top + SMALL_SIZE, edgeY - 2) : Math.min(span.bottom - 2, edgeY + SMALL_SIZE + 1);
				// The other side of its edge line, for a label the rows' bands
				// keep off its own side.
				const alt = upward ? edgeY + SMALL_SIZE + 1 : edgeY - 2;
				const name = draw.input.name || draw.input.key;
				labels.push({ y, color, text: band.label, ...(band.label.startsWith(`${name} `) ? { name } : {}), ...(alt >= map.top + SMALL_SIZE && alt <= map.bottom ? { alt } : {}) });
			}
		}
	}

	/**
	 * Band labels laid out together, so each stays readable and names its
	 * own reading: a label sits at the left of the visible plot, or, where
	 * another label already holds that place on its row, in the first free
	 * room to the right of it. Two readings with the same limit therefore
	 * show two labels side by side, never one on top of the other. A label
	 * is cut only when no room on its row holds it whole; beside large
	 * values or under Scale and grid it is never cut (wholeBandLabel).
	 * `whole` says so whatever the pane's boxes.
	 */
	bandLabels(f: PaneFrame, labels: readonly BandLabel[], indent = 0, whole = f.pane.readout !== undefined || f.pane.overlays.axes === true): void {
		const left = Math.max(f.plot.x0, f.left) + PAD + indent;
		const right = Math.min(f.plot.x1, f.right) - PAD;
		const cap = Math.min(170, right - left);
		const peers = f.input.series.map((s) => s.name || s.key);
		const placed: TextPrim[] = [];
		/** The label's best place on the row at baseline y: whole in the
		 * first gap that holds it, else the longest cut. */
		const onRow = (label: BandLabel, y: number): TextPrim | undefined => {
			// Placed labels on its row, and the bands of the rows over the
			// graph, which no label of the plot goes into.
			const bands = this.rowBoxes.filter((s) => s.y0 < y + 2 && y - SMALL_SIZE < s.y1).map((s) => ({ bx0: s.x0 - 3, bx1: s.x1 + 3 }));
			const blocking = [...placed.filter((p) => rowsMeet(p.y, p.size, y, SMALL_SIZE)), ...bands].sort((a, b) => a.bx0 - b.bx0);
			const gaps: [number, number][] = [];
			let from = left - 3;
			for (const p of blocking) {
				if (p.bx0 > from) gaps.push([from, p.bx0]);
				from = Math.max(from, p.bx1);
			}
			gaps.push([from, Number.POSITIVE_INFINITY]);
			let best: TextPrim | undefined;
			for (const [a, b] of gaps) {
				// textPrim's box runs from x - 3 to x + 1.15 * width + 6.
				const x = a + 3;
				const room = Math.min(cap, right - x, (b - x - 6) / 1.15);
				if (!(room > 0)) continue;
				const text = fitBandLabel(label, room, whole ? peers : undefined);
				if (text === "") continue;
				if (best === undefined || text.length > best.text.length) best = textPrim(x, y, "start", SMALL_SIZE, 600, label.color, text);
				if (text === label.text) break;
			}
			return best;
		};
		const banded = (y: number): boolean => this.rowBoxes.some((s) => s.y0 < y + 2 && y - SMALL_SIZE < s.y1 && s.x1 > left && s.x0 < right);
		for (const label of labels) {
			let best = onRow(label, label.y);
			// Where the rows' bands hold its side of the edge, the other side
			// takes the label when it holds more of it.
			if (best?.text !== label.text && label.alt !== undefined && banded(label.y)) {
				const other = onRow(label, label.alt);
				if (other !== undefined && (best === undefined || other.text.length > best.text.length)) best = other;
			}
			if (best === undefined) continue;
			this.prims.push(best);
			placed.push(best);
		}
	}

	/** A message where the graph would be, centred on the present slots. */
	middleText(f: PaneFrame, message: string): void {
		this.text((f.left + f.right) / 2, 56, "middle", LABEL_SIZE, 600, this.look.text.unit, fitText(message, LABEL_SIZE, 600, f.right - f.left - 2 * PAD));
	}

	emptyPane(f: PaneFrame, message: string): void {
		const start = this.prims.length;
		this.middleText(f, message);
		this.bottomRow(f, this.timeText(f, undefined, undefined));
		this.rowBands(f, start);
	}

	// ---- large values ----------------------------------------------------------

	/** The value a series' readout shows: at the inspect cursor when
	 * paused, else live (reading). A reading that is not live and has a
	 * status word has none: the word shows instead, never a number. */
	readoutValue(f: PaneFrame, d: SeriesDraw): number | undefined {
		if (statusWord(d.input, d.bins) !== undefined && d.input.state !== "ok") return undefined;
		return this.reading(f, d);
	}

	readoutItem(f: PaneFrame, d: SeriesDraw, value: number | undefined, peers: readonly string[]): ReadoutItem {
		const m = value === undefined ? undefined : this.formatOf(d, value);
		const numeric = m !== undefined && m.valueText !== "—";
		const e = extentOf(d.bins);
		const sizing = e === null ? [] : [this.formatOf(d, e.lo).valueText, this.formatOf(d, e.hi).valueText];
		const fallback = numeric && value !== undefined ? this.fallbackOf(d, value, m.unitText) : [];
		return {
			text: numeric ? m.valueText : (statusWord(d.input, d.bins) ?? "no data"),
			numeric,
			sizing,
			...(fallback.length === 0 ? {} : { fallback }),
			unit: numeric && f.pane.overlays.unit ? m.unitText : "",
			names: f.pane.overlays.legend ? nameRungs(d.input.name || d.input.key, peers) : []
		};
	}

	/** The alert level a value reaches in its own reading's bands. */
	levelOf(f: PaneFrame, d: SeriesDraw, value: number | undefined): "warn" | "crit" | null {
		if (value === undefined) return null;
		const own = f.input.bands.filter((b) => b.readingKey === d.input.key);
		if (own.length === 0) return null;
		const upward = bandsOpenUpward(f.input.bands, d.input.key);
		const fahrenheit = this.measure.fahrenheit;
		const hit = own.filter((b) => {
			const from = Number.isFinite(b.from) ? toNative(b.from, d.unit, fahrenheit) : b.from;
			const to = Number.isFinite(b.to) ? toNative(b.to, d.unit, fahrenheit) : b.to;
			return upward ? value >= from && value < to : value > from && value <= to;
		});
		return hit.some((b) => b.level === "crit") ? "crit" : hit.length > 0 ? "warn" : null;
	}

	/** levelOf for many values of one reading: its bands looked up and put
	 * in its native unit once (a Group pane asks for every heat cell). */
	levelTester(f: PaneFrame, d: SeriesDraw): (value: number) => "warn" | "crit" | null {
		const own = f.input.bands.filter((b) => b.readingKey === d.input.key);
		if (own.length === 0) return () => null;
		const upward = bandsOpenUpward(f.input.bands, d.input.key);
		const fahrenheit = this.measure.fahrenheit;
		const native = own.map((b) => ({ level: b.level, from: Number.isFinite(b.from) ? toNative(b.from, d.unit, fahrenheit) : b.from, to: Number.isFinite(b.to) ? toNative(b.to, d.unit, fahrenheit) : b.to }));
		return (value) => {
			let level: "warn" | "crit" | null = null;
			for (const b of native) {
				if (upward ? value >= b.from && value < b.to : value > b.from && value <= b.to) {
					if (b.level === "crit") return "crit";
					level = "warn";
				}
			}
			return level;
		};
	}

	/** The highlighted series: among what a line style draws, or the lane. */
	highlightOf(f: PaneFrame, draws: readonly SeriesDraw[]): number {
		const pool = (f.pane.style === "lanes" || f.pane.style === "heat") && f.pane.readout !== "only" ? draws : draws.filter((d) => d.input.state !== "missing");
		if (pool.length === 0) return -1;
		return (pool[((f.input.highlight % pool.length) + pool.length) % pool.length] as SeriesDraw).index;
	}

	/**
	 * One planned box of large values. The value takes its alert color when
	 * its reading's band is reached, else the series color held to the
	 * numeric contrast floor on the look's surface (Clear draws every word
	 * in its one ink); a status word draws in the unit color. The color mark
	 * ties each value to its line.
	 */
	drawReadout(f: PaneFrame, plan: ReadoutPlan, draws: readonly SeriesDraw[], items: readonly ReadoutItem[], values: readonly (number | undefined)[], highlight: number, only = false): void {
		const t = this.look.text;
		for (const cell of plan.cells) {
			const d = draws[cell.item] as SeriesDraw;
			const item = items[cell.item] as ReadoutItem;
			const value = values[cell.item];
			const level = this.levelOf(f, d, value);
			const fill = level !== null ? this.alertColors[level] : !item.numeric ? t.unit : this.look.background === "clear" ? t.value : readableValueColor(d.color, this.look.surface);
			this.rect("marks", cell.bar.x, cell.bar.y, cell.bar.w, cell.bar.h, `fill="${d.color}"`);
			this.inkText(cell.valueEnd, cell.baseline, "end", cell.valueSize, 700, fill, cell.text);
			if (cell.unit !== undefined && item.unit !== "") this.inkText(cell.unit.x, cell.unit.y, cell.unit.anchor, plan.unitSize, 600, t.unit, item.unit);
			if (cell.name !== undefined) this.inkText(cell.name.x, cell.name.y, cell.name.anchor, plan.nameSize, 600, d.index === highlight ? t.label : t.unit, cell.name.text);
			if (cell.trend !== undefined && only) this.smallTrend(f, d, cell.trend);
		}
	}

	/** A small trend of the window under a value, as wide as its block. */
	smallTrend(f: PaneFrame, d: SeriesDraw, at: { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number }): void {
		const scale = scaleOf(extentOf(d.bins), {}, d.unit, this.measure.fahrenheit);
		if (scale === null || !(at.x1 > at.x0)) return;
		const k = (at.x1 - at.x0) / (f.plot.x1 - f.plot.x0);
		for (const line of linePrims(d.runs, f.plot, { lo: scale.lo, hi: scale.hi, top: at.y0, bottom: at.y1 }, d.color, 1.5, "marks", this.backing(1.5))) {
			this.prims.push({ ...line, pts: line.pts.map((v, i) => (i % 2 === 0 ? snap(at.x0 + (v - f.plot.x0) * k) : v)) });
		}
	}

	/** A pane's reading names, which each reading's name rungs are
	 * shortened against (their shared leading words go first). */
	peerNames(draws: readonly SeriesDraw[]): string[] {
		return draws.map((d) => d.input.name || d.input.key);
	}

	/** Left of the graph: the pane's first dial slot shows every value. */
	readoutLeft(f: PaneFrame, draws: readonly SeriesDraw[], slot: PaneExtent): void {
		const peers = this.peerNames(draws);
		const values = draws.map((d) => this.readoutValue(f, d));
		const items = draws.map((d, i) => this.readoutItem(f, d, values[i], peers));
		const plan = planReadout(items, { x0: slot.x0, x1: slot.x1, y0: 0, y1: 100 }, { align: "right", names: f.pane.overlays.legend });
		if (plan !== null) this.drawReadout(f, plan, draws, items, values, this.highlightOf(f, draws));
	}

	/**
	 * Values only: with no more readings than dial slots the readings spread
	 * across the whole pane (planSpread); with more, they stack in the slots
	 * at one size. Either way a number's size comes from the stored setup, and
	 * each reading's trend from its window, with Time span on.
	 */
	readoutOnly(f: PaneFrame, draws: readonly SeriesDraw[], extent: PaneExtent, present: readonly boolean[]): void {
		const columns = paneColumns(extent);
		const shown = draws.slice(0, ONLY_PER_SLOT * columns.length);
		const peers = this.peerNames(shown);
		const values = shown.map((d) => this.readoutValue(f, d));
		const base = shown.map((d, i) => this.readoutItem(f, d, values[i], peers));
		const items = base.map((item, i) => {
			const d = shown[i] as SeriesDraw;
			return { ...item, sizing: this.setupSizing(d), setupUnit: f.pane.overlays.unit ? this.setupUnit(d) : "", limits: ownBands(f.input.bands, d.input.key).length > 0 };
		});
		if (shown.length > columns.length) {
			this.readoutStacks(f, shown, items, values, extent, columns, present);
			return;
		}
		const paused = f.input.view.mode === "paused" ? f.input.view : undefined;
		const plan = planSpread(items, spreadCells(extent, shown.length, "first", present), { names: f.pane.overlays.legend, trend: f.pane.overlays.time, paused: paused !== undefined });
		const t = this.look.text;
		const highlight = this.highlightOf(f, shown);
		const drawn = plan.places.filter((p) => present[p.cell.column] !== false);
		const last = drawn[drawn.length - 1];
		for (const p of drawn) {
			const d = shown[p.item] as SeriesDraw;
			const item = items[p.item] as (typeof items)[number];
			const level = this.levelOf(f, d, values[p.item]);
			const fill = level !== null ? this.alertColors[level] : !item.numeric ? t.unit : this.look.background === "clear" ? t.value : readableValueColor(d.color, this.look.surface);
			this.rect("marks", p.bar.x, p.bar.y, p.bar.w, p.bar.h, `fill="${d.color}"`);
			this.inkText(p.valueEnd, p.baseline, "end", p.valueSize, 700, fill, p.text);
			// PAUSED and the time take the row's end, or the corner of a trend
			// beside the number that leaves room for its scale's top end; what
			// shares the row steps left, for the moment an inspect lasts (a
			// person's act, never a reading).
			let shift = 0;
			if (paused !== undefined && p === last) {
				const corner = p.trend?.beside === true && p.trend.x1 - p.trend.x0 >= ONLY_BADGE.trendRoom;
				const end = corner ? (p.trend as { x1: number }).x1 : p.cell.slotX1 - SPREAD_PAD;
				const badge = this.inkText(end, corner ? ONLY_BADGE.baseline : (p.name?.y ?? p.unit?.y ?? ONLY_BADGE.baseline), "end", ONLY_BADGE.size, 700, t.badge, `PAUSED${paused.label !== undefined ? ` ${paused.label}` : ""}`, "rows");
				if (!corner) shift = end - (badge?.bx0 ?? end) + 6;
			}
			if (p.unit !== undefined && item.unit !== "") this.inkText(p.unit.x - shift, p.unit.y, "end", plan.unitSize, 600, t.unit, item.unit);
			if (p.word !== undefined && level !== null) this.inkText(p.word.x - shift, p.word.y, "end", plan.wordSize, 700, this.alertColors[level], level);
			if (p.name !== undefined) {
				const name = shift === 0 ? p.name.text : fitNameRung(item.names, plan.nameSize, p.name.room - shift);
				if (name !== "") this.inkText(p.name.x, p.name.y, "start", plan.nameSize, 600, d.index === highlight ? t.label : t.unit, name);
			}
			if (p.trend !== undefined) this.spreadTrend(f, d, p.trend, p === last);
		}
	}

	/** More readings than dial slots: every slot used, the first ones stacking
	 * one more, at one size the stored setup gives. */
	readoutStacks(f: PaneFrame, draws: readonly SeriesDraw[], items: readonly ReadoutItem[], values: readonly (number | undefined)[], extent: PaneExtent, columns: readonly number[], present: readonly boolean[]): void {
		const options = { align: "center" as const, names: f.pane.overlays.legend, trend: f.pane.overlays.time };
		const sliceOf = (c: number): ReadoutBox => ({ x0: Math.max(extent.x0, c * SLICE_W), x1: Math.min(extent.x1, (c + 1) * SLICE_W), y0: 0, y1: 100 });
		const stacks = onlyStacks(draws.length, columns.length).map((group, k) => ({ group, column: columns[k] as number, box: sliceOf(columns[k] as number) }));
		// The size the setup gives: every value as its widest usual number.
		const widest = (item: ReadoutItem): ReadoutItem => (item.numeric ? { ...item, text: item.sizing[0] ?? "00.0" } : item);
		const size = Math.min(...stacks.map((p) => planReadout(p.group.map((i) => widest(items[i] as ReadoutItem)), p.box, options)?.size ?? 0));
		const highlight = this.highlightOf(f, draws);
		const paused = f.input.view.mode === "paused" ? f.input.view : undefined;
		const shown = stacks.filter((p) => present[p.column] !== false);
		const lastColumn = shown[shown.length - 1]?.column;
		for (const p of shown) {
			const badged = paused !== undefined && p.column === lastColumn;
			const planIn = (box: ReadoutBox): ReadoutPlan | null => planReadout(p.group.map((i) => items[i] as ReadoutItem), box, { ...options, ...(size > 0 ? { maxSize: size } : {}) });
			let plan = planIn(p.box);
			// PAUSED shares a row with a name over the digits; with no name
			// there, its row comes off the box's top, for the moment an inspect
			// lasts.
			if (badged && plan !== null && plan.namePlace !== "above") plan = planIn({ ...p.box, y0: ONLY_BADGE.row });
			if (plan === null) continue;
			if (badged) {
				const text = `PAUSED${paused.label !== undefined ? ` ${paused.label}` : ""}`;
				const badge = this.inkText(p.box.x1 - PAD, ONLY_BADGE.baseline, "end", ONLY_BADGE.size, 700, this.look.text.badge, text);
				const room = (badge?.bx0 ?? p.box.x1) - 6 - (p.box.x0 + PAD);
				const nameSize = plan.nameSize;
				plan = {
					...plan,
					cells: plan.cells.map((cell) => {
						if (cell.name === undefined || !rowsMeet(ONLY_BADGE.baseline, ONLY_BADGE.size, cell.name.y, nameSize)) return cell;
						const name = fitNameRung((items[p.group[cell.item] as number] as ReadoutItem).names, nameSize, room);
						const { name: _drop, ...rest } = cell;
						void _drop;
						return name === "" ? rest : { ...rest, name: { x: p.box.x0 + PAD, y: cell.name.y, anchor: "start" as const, text: name, room } };
					})
				};
			}
			this.drawReadout(f, plan, p.group.map((i) => draws[i] as SeriesDraw), p.group.map((i) => items[i] as ReadoutItem), p.group.map((i) => values[i]), highlight, true);
		}
	}

	/**
	 * What sizes a reading's number on a big-digit pane: the widest text its
	 * unit prints across its usual reach at its stored decimals, whatever it
	 * reads now, so the size is the setup's and never moves with a value.
	 */
	setupSizing(d: SeriesDraw): string[] {
		return usualReach(d.displayUnit).map((v) => this.formatOf(d, d.displayUnit === d.unit ? v : toNative(v, d.unit, this.measure.fahrenheit)).valueText);
	}

	/** The unit a reading's number shows in, whatever it reads now; a data
	 * reading steps through its tiers, so it keeps room for the widest. */
	setupUnit(d: SeriesDraw): string {
		return isDataUnit(d.unit) ? "MiB/s" : this.formatOf(d, 99.9).unitText;
	}

	/** A reading's window as one line in its own color across `at`, in whole
	 * buckets of the frame's width, on `gapMode`. */
	windowLine(f: PaneFrame, d: SeriesDraw, at: { readonly x0: number; readonly x1: number }, map: YMap, gapMode: StripGapMode | undefined): void {
		const history = d.input.history;
		if (history === undefined) return;
		const { bucketPx } = f.plot;
		const buckets = Math.max(1, Math.floor((at.x1 - at.x0) / bucketPx));
		const plot: PanePlot = { x0: at.x0, x1: at.x0 + buckets * bucketPx, bucketPx, buckets };
		this.prims.push(...linePrims(lineRunsOf(binView(history, buckets, this.scratch), history, gapMode), plot, map, d.color, 1.5, "marks", this.backing(1.5)));
	}

	/**
	 * A reading's trend on a spread pane, on the strip's own scale (a held
	 * round scale, src/strip/scale.ts), so a wobble is not stretched to the
	 * height it gets. Beside a number the scale's ends print at its left, and
	 * the last one says the window.
	 */
	spreadTrend(f: PaneFrame, d: SeriesDraw, at: { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number; readonly beside: boolean }, last: boolean): void {
		const fixedUnit = this.fixedUnitOf([d]);
		const s = this.scaleFor(`o:${d.input.key}`, d.unit, this.needOf([d]), maxTicksFor(at.y1 - at.y0), fixedUnit === undefined ? {} : { fixedUnit });
		if (s === null || !(at.x1 > at.x0)) return;
		const map: YMap = { lo: s.held.lo, hi: s.held.hi, top: at.y0, bottom: at.y1 };
		this.windowLine(f, d, at, map, f.gapMode);
		if (!at.beside || s.st === null) return;
		const t = this.rowColors;
		this.inkText(at.x0, at.y0 + 9, "start", ONLY_SCALE_SIZE, 600, t.unit, endText(s.st.ticks.hi, s.st, true), "rows");
		this.inkText(at.x0, at.y1 - 1, "start", ONLY_SCALE_SIZE, 600, t.unit, endText(s.st.ticks.lo, s.st, true), "rows");
		if (last && f.input.view.mode !== "paused") this.inkText(at.x1, at.y1 - 1, "end", ONLY_SCALE_SIZE, 600, t.unit, WINDOW_LABEL[f.window], "rows");
	}

	// ---- styles --------------------------------------------------------------

	lineStyle(f: PaneFrame, draws: readonly SeriesDraw[]): void {
		const style = f.pane.style;
		const axes = f.pane.overlays.axes === true;
		const paneStart = this.prims.length;
		const fahrenheit = this.measure.fahrenheit;
		const drawable = draws.filter((d) => d.input.state !== "missing");
		const highlightDraw = drawable.length === 0 ? undefined : drawable[((f.input.highlight % drawable.length) + drawable.length) % drawable.length];
		const highlight = highlightDraw?.index ?? -1;
		// One band per native unit, in the order the readings come: one unit
		// draws as one plot the strip's height; two or more stack bands of
		// equal height, each on its own scale. No reading is left out for its
		// unit, and no scale is ever shared across units.
		const units = [...new Set(drawable.map((d) => d.unit))];
		// A graph of one reading takes the scale dial (a pressed turn) while
		// no typed end owns its scale and it is not a Yes/No reading.
		const dialPane = (style === "trend" || style === "area") && draws.length === 1;
		const bands: UnitBand[] = unitBands(Math.max(1, units.length)).map((g, i) => {
			const unit = units[i] ?? "";
			const members = drawable.filter((d) => d.unit === unit);
			// Each band holds its own scale, its readings' window and values
			// now on the strip's one rule (src/strip/scale.ts); a typed end
			// for readings in its unit is kept as typed.
			const kept = members.length === 0 ? undefined : this.typedEnds(unit, i === 0);
			const fixedUnit = this.fixedUnitOf(members);
			const scale = members.length === 0 ? null : this.scaleFor(`u:${unit}`, unit, this.needOf(members), maxTicksFor(g.bottom - g.top), { ...(kept === undefined ? {} : { kept }), dial: dialPane && kept === undefined && scaleKindOf(unit) !== "yesno", ...(fixedUnit === undefined ? {} : { fixedUnit }) });
			return { unit, draws: members, top: g.top, bottom: g.bottom, map: scale === null ? null : { lo: scale.held.lo, hi: scale.held.hi, top: g.top, bottom: g.bottom }, scale };
		});
		void fahrenheit;
		const bandOf = (d: SeriesDraw): UnitBand | undefined => bands.find((b) => b.unit === d.unit);
		const labels: BandLabel[] = [];
		for (const b of bands) {
			if (b.map === null) continue;
			if (axes && b.scale?.st) this.valueGrid(f, b.map, b.scale.st);
			for (const d of b.draws) this.bands(f, d, b.map, labels);
		}
		const hiMap = highlightDraw === undefined ? null : (bandOf(highlightDraw)?.map ?? null);
		if (hiMap !== null && highlightDraw !== undefined) {
			if (style === "area") {
				// One fill paint per pane: each pane's area takes its own color.
				const paint = this.look.halo ? this.paint(`a${f.index}`, highlightDraw.color, 0.3) : this.look.structure;
				this.prims.push(...areaPrims(highlightDraw.runs, f.plot, hiMap, paint));
			}
		}
		if (axes) this.timeGrid(f, PLOT_TOP, PLOT_BOTTOM);
		this.baseline(f, PLOT_BOTTOM + 1);
		// A hairline between bands.
		for (const b of bands.slice(1)) this.rect("marks", f.plot.x0, b.top - BAND_GAP / 2 - 0.5, f.plot.x1 - f.plot.x0, 1, this.look.structure);
		for (const b of bands) {
			if (b.map === null) continue;
			// Each band's main line: the highlighted reading, else its first.
			const main = b.draws.find((d) => d.index === highlight) ?? b.draws[0];
			for (const d of [...b.draws.filter((x) => x !== main), ...(main === undefined ? [] : [main])]) {
				const strong = style === "compare" || d === main;
				const width = strong ? 2 : 1.5;
				const color = strong ? d.color : mixToward(d.color, this.look.surface, 0.45);
				this.prims.push(...linePrims(d.runs, f.plot, b.map, color, width, "marks", this.backing(width)));
			}
		}
		const base = drawable[0];
		if (base !== undefined) this.hiddenTicks(f, base, bandOf(base)?.bottom ?? PLOT_BOTTOM);
		if (bands.some((b) => b.map !== null)) this.cursorLine(f, PLOT_TOP, PLOT_BOTTOM);
		// Each band's scale ends at its left edge, as row words; the rows
		// start right of them.
		const rows: PaneFrame = { ...f, left: this.scaleEnds(f, bands, axes, highlight) };
		// Scale and grid: the ticks between the ends join their column.
		if (axes) for (const b of bands) if (b.map !== null && b.scale?.st) this.valueLabels(f, b.map, b.scale.st, b.top, paneStart, b.bottom, true);
		this.legendRow(f, rows, draws, drawable, highlightDraw, units.length);
		if (drawable.length === 0 && draws.length > 0) {
			// Nothing drawable: say why where the graph would be.
			this.middleText(f, statusWord((draws[0] as SeriesDraw).input, NO_BINS) ?? "no data");
		} else if (drawable.length > 0 && drawable.every(noRoomOf)) {
			// The history budget refused every line: the empty graph says why.
			this.middleText(f, noHistoryRoom());
		}
		this.bottomRow(rows, this.timeText(f, this.minmaxText(f, highlightDraw), this.cursorNote(f)));
		this.paneTabs(f, rows, bands);
		if (axes) this.timeAxis(rows, paneStart, PLOT_BOTTOM);
		this.rowBands(f, paneStart, bandAnchors(bands));
		// One pass keeps the plot's words apart and out of the row bands, in
		// rank: alert band labels, then the window's min and max.
		this.bandLabels(f, labels);
		if (hiMap !== null && axes && highlightDraw !== undefined) this.windowExtremes(f, highlightDraw, hiMap, paneStart);
	}

	/**
	 * The top row of a line pane: every reading in the legend, with its
	 * value now after its name (Compare always; Trend and Area with two
	 * readings or more), names shortened by whole words, the words
	 * every name shares first. One unit word at the right serves values of
	 * one plain unit; with two units or a data unit each value carries its
	 * own. Trend and Area keep the highlighted reading's value
	 * large at the right while every name still fits beside it; otherwise
	 * its legend value draws in its own color instead.
	 */
	legendRow(f: PaneFrame, rows: PaneFrame, draws: readonly SeriesDraw[], drawable: readonly SeriesDraw[], highlightDraw: SeriesDraw | undefined, unitCount: number): void {
		const style = f.pane.style;
		const highlight = highlightDraw?.index ?? -1;
		const valueOf = (d: SeriesDraw): number | undefined => {
			if (statusWord(d.input, d.bins) !== undefined && d.input.state !== "ok") return undefined;
			return this.reading(f, d);
		};
		const values = new Map(drawable.map((d) => [d.index, valueOf(d)]));
		// A data unit picks its size step (k, M, G) per value, so each value
		// carries its own unit word, always: a bare "2.00" beside "640" would
		// read as the same step. Two units do too. One plain unit is shown
		// once, at the right.
		const perValue = unitCount > 1 || drawable.some((d) => isDataUnit(d.unit));
		const words = new Set(
			drawable.flatMap((d) => {
				const v = values.get(d.index);
				return v === undefined ? [] : [this.formatOf(d, v).unitText];
			})
		);
		const unitText = !perValue && words.size === 1 ? ([...words][0] as string) : "";
		const valued = style === "compare" || draws.length > 1;
		const shown = (d: SeriesDraw): string => {
			if (!valued || !f.pane.overlays.current) return "";
			const v = values.get(d.index);
			if (v === undefined) return statusWord(d.input, d.bins) ?? "no data";
			const m = this.formatOf(d, v);
			return perValue && f.pane.overlays.unit && m.unitText !== "" ? `${m.valueText} ${m.unitText}` : m.valueText;
		};
		const unitWord = (limit: number): number => {
			if (!(f.pane.overlays.unit && unitText !== "" && f.pane.overlays.legend && f.pane.overlays.current)) return limit;
			this.rowText(limit, TOP_BASELINE, "end", LABEL_SIZE, 600, this.rowColors.unit, unitText);
			return limit - widthOf(unitText, LABEL_SIZE, 600) - 8;
		};
		// Compare's values share one scale, and its top end says the unit.
		if (style === "compare") {
			this.legend(rows, draws, highlight, f.right - PAD, shown);
			return;
		}
		const color = highlightDraw?.color ?? this.look.text.value;
		const value = highlightDraw === undefined ? undefined : valueOf(highlightDraw);
		if (!valued) {
			const valueLeft = this.currentValue(f, highlightDraw, value, color);
			this.legend(rows, draws, highlight, valueLeft - 10);
			return;
		}
		// The large value stays while every name still fits beside it; its
		// reading's name then stands alone, so no number prints twice.
		const beside = (d: SeriesDraw): string => (d.index === highlight ? "" : shown(d));
		const valueLeft = this.currentValue(f, highlightDraw, value, color, VALUE_SIZE, true);
		if (this.legend(rows, draws, highlight, valueLeft - 10, beside, { dry: true })) {
			this.currentValue(f, highlightDraw, value, color);
			this.legend(rows, draws, highlight, valueLeft - 10, beside);
			return;
		}
		this.legend(rows, draws, highlight, unitWord(f.right - PAD), shown, { bright: highlight });
	}

	/**
	 * Each unit band's scale ends at the plot's left edge, small, as row words:
	 * its top value (with the unit, when the unit box is on) just under its
	 * top edge and its bottom value just over its bottom edge, so a line
	 * reads against numbers without Scale and grid; a band too short for two
	 * rows of numbers says both ends in one ("40 to 80 °C") at its middle.
	 * A typed end a reading has passed takes that reading's color
	 * (passedEnds). Returns where their column ends: the rows start there,
	 * after the width reserved for the stored setup (the "end" slot), so a
	 * name never moves when a value or the scale changes.
	 */
	scaleEnds(f: PaneFrame, bands: readonly UnitBand[], axes: boolean, highlight = -1): number {
		const x = endColumn(f);
		const t = this.rowColors;
		let end = x;
		let any = false;
		const size = SMALL_SIZE;
		const reserves: (() => number)[] = [];
		for (const b of bands) {
			const s = b.scale;
			if (s === null || s.st === null || b.map === null) continue;
			const st = s.st;
			const unitWord = scaleUnitWord(s.view, f.pane.overlays.unit);
			const hi = `${endText(st.ticks.hi, st, true)}${unitWord}`;
			const lo = endText(st.ticks.lo, st, true);
			const placed: TextPrim[] = [];
			const short = endsJoined(b);
			if (short) {
				// Both ends joined in one text: its lines on the edge carry a
				// passed end.
				const prim = this.inkText(x, Math.round((b.top + b.bottom) / 2 + TEXT_ASCENT * size * 0.5), "start", size, 600, t.unit, `${lo} to ${hi}`, "rows");
				if (prim !== undefined) placed.push(prim);
			} else {
				const cue = this.passedEnds(f, b.draws, s, highlight);
				const top = this.inkText(x, endHiBaseline(b), "start", size, 600, cue.hi ?? t.unit, hi, "rows");
				const bottom = this.inkText(x, endLoBaseline(b), "start", size, 600, cue.lo ?? t.unit, lo, "rows");
				for (const p of [top, bottom]) if (p !== undefined) placed.push(p);
			}
			for (const p of placed) end = Math.max(end, textInkBox(p).x1);
			any ||= placed.length > 0;
			// With Scale and grid, the ticks between the ends join the column.
			if (axes) for (const v of st.ticks.values) end = Math.max(end, x + inkEdges([{ text: endText(v, st), fontSize: size, fontWeight: 600 }], "start", 0).right);
			reserves.push(() => {
				const texts = this.scaleSlotTexts(s, unitWord, axes && !short);
				if (!short) return reserveSlot(texts, size);
				// A short band's one line: each scale's two ends joined.
				const joined: string[] = [];
				for (let i = 0; i + 1 < texts.length; i += 2) joined.push(`${texts[i + 1] as string} to ${texts[i] as string}`);
				return reserveSlot(joined, size);
			});
		}
		if (!any) return f.left;
		const slot = this.slot("end", end - x, () => Math.max(0, ...reserves.map((r) => r())));
		return Math.ceil(Math.max(end, x + slot) + 4);
	}

	/** Whether this pane's words take tabs: a see-through look, and no Scale
	 * and grid, whose ticks stand in the ends' column and share the window's
	 * row. */
	private wordTabbed(f: PaneFrame): boolean {
		return WORD_TAB_LOOKS.has(this.look.background) && f.pane.overlays.axes !== true;
	}

	/**
	 * A pane's tabs (WORD_TAB): behind both ends of every band whose ends draw
	 * on two rows, by the test scaleEnds draws them by and on the bands it
	 * draws them on, and behind the window's words. `rows` is the frame the
	 * rows drew in: those words start after the ends' column, or at the
	 * pane's edge with no ends drawn.
	 */
	paneTabs(f: PaneFrame, rows: PaneFrame, bands: readonly UnitBand[]): void {
		if (!this.wordTabbed(f)) return;
		const tabs: number[] = [];
		const x = endColumn(f);
		for (const b of bands) {
			if (b.scale === null || b.scale.st === null || b.map === null || endsJoined(b)) continue;
			this.endTab(f, tabs, `tab:hi:${b.unit}`, b.scale, 0, x, endHiBaseline(b));
			this.endTab(f, tabs, `tab:lo:${b.unit}`, b.scale, 1, x, endLoBaseline(b));
		}
		this.timeTab(f, rows, tabs);
		this.pushWordTabs(tabs);
	}

	/** A scale end's tab, as wide as the widest end of its side (0 the top,
	 * 1 the bottom) its unit's slot holds. */
	private endTab(f: PaneFrame, tabs: number[], key: string, s: DrawnScale, side: 0 | 1, x: number, baseline: number): void {
		const w = this.slot(key, 0, () =>
			reserveSlot(
				this.scaleSlotTexts(s, scaleUnitWord(s.view, f.pane.overlays.unit), false).filter((_, i) => i % 2 === side),
				SMALL_SIZE
			)
		);
		this.wordTab(f, tabs, x, x + w, baseline, SMALL_SIZE);
	}

	/** The tab behind the window's words, as wide as the widest of them, from
	 * where they start this frame. None without those words, nor where the
	 * widest of them could not clear the widest badge from the column the pane
	 * holds, drawn this frame or not: that test holds the words' whole width
	 * in the row's room (bottomRow), so a tab here always has its whole word. */
	private timeTab(f: PaneFrame, rows: PaneFrame, tabs: number[]): void {
		if (!f.pane.overlays.time || f.input.notice !== undefined) return;
		const w = this.slot("tab:time:w", 0, () => reserveSlot(Object.values(WINDOW_LABEL), ROW_SIZE));
		const from = rows.left + PAD;
		const column = this.paneScale?.out.slots.end;
		const furthest = column === undefined ? from : Math.max(from, Math.ceil(endColumn(f) + column + 4) + PAD);
		if (furthest + w + ROW_BADGE_GAP > f.right - PAD - widthOf(WORD_TAB.widestBadge, pausedBadgeSize(rows), 700)) return;
		this.wordTab(f, tabs, from, from + w, BOTTOM_BASELINE, ROW_SIZE);
	}

	/** One tab's box, as WORD_TAB says, for ink from x0 to x1 on `baseline`. */
	private wordTab(f: PaneFrame, tabs: number[], x0: number, x1: number, baseline: number, size: number): void {
		const { pad, near, glass, cap } = WORD_TAB;
		let a = Math.floor(x0 - pad);
		let z = Math.ceil(x1 + pad);
		let top = Math.floor(baseline - cap * size - pad);
		let bottom = Math.ceil(baseline + pad);
		if (a - f.left < near) a = f.left + glass;
		if (f.right - z < near) z = f.right - glass;
		// (The Strip Screens line and its backing hold the strip's top rows.)
		if (top < near) top = this.screenRow ? SCREEN_LINE.height + 1 : glass;
		if (100 - bottom < near) bottom = 100 - glass;
		tabs.push(a, top, z - a, bottom - top);
	}

	/** A pane's tabs as one path in the track tone, over what the base layer
	 * has drawn so far (its panel and fills) and under the marks. */
	private pushWordTabs(tabs: number[]): void {
		if (tabs.length > 0) this.prims.push({ k: "cells", layer: "base", rects: tabs, paint: `fill="${this.look.palette.track}"`, round: WORD_TAB.radius });
	}

	lanesStyle(f: PaneFrame, draws: readonly SeriesDraw[]): void {
		const n = draws.length;
		const t = this.rowColors;
		const laneH = laneHeight(n);
		// Each lane's header draws over its own plot, its row band hung from
		// the lane's top; three lanes of 30 px keep their headers smaller.
		const headerSize = n >= 3 ? LANE_HEADER_3 : LABEL_SIZE;
		const highlight = draws.length === 0 ? -1 : (((f.input.highlight % n) + n) % n);
		const axes = f.pane.overlays.axes === true;
		const paneStart = this.prims.length;
		if (axes) this.timeGrid(f, LANES_TOP, LANES_TOP + laneH * n);
		draws.forEach((d, i) => {
			const laneTop = LANES_TOP + i * laneH;
			const plotTop = laneTop + 3;
			const plotBottom = laneTop + laneH - 3;
			if (i > 0) this.rect("marks", f.plot.x0, laneTop, f.plot.x1 - f.plot.x0, 1, this.look.structure);
			// Each lane has its own scale: different units never share an axis.
			// Rounded and held on three ticks when Scale and grid draws them, on
			// six when it does not, so the line keeps more of the lane's height;
			// a typed end for readings in its unit is kept as typed.
			const kept = this.typedEnds(d.unit, i === 0);
			const fixedUnit = this.fixedUnitOf([d]);
			const scale = d.input.state === "missing" ? null : this.scaleFor(`l:${d.input.key}`, d.unit, this.needOf([d]), axes ? 3 : 6, { ...(kept === undefined ? {} : { kept }), ...(fixedUnit === undefined ? {} : { fixedUnit }) });
			const ticks = axes ? (scale?.st ?? null) : null;
			if (scale !== null) {
				const map: YMap = { lo: scale.held.lo, hi: scale.held.hi, top: plotTop, bottom: plotBottom };
				if (ticks !== null) this.laneGrid(f, map, ticks);
				this.bands(f, d, map);
				this.prims.push(...linePrims(d.runs, f.plot, map, d.color, 2, "marks", this.backing(2)));
				this.hiddenTicks(f, d, plotBottom);
			}
			const headerY = laneTop + Math.ceil(TEXT_ASCENT * headerSize) + 1;
			let right = f.right - PAD;
			if (f.pane.overlays.current) {
				const word = statusWord(d.input, d.bins);
				const live = this.reading(f, d);
				const shown = d.input.state !== "ok" || live === undefined ? (word ?? "no data") : (() => {
					const m = this.formatOf(d, live);
					return f.pane.overlays.unit && m.unitText !== "" ? `${m.valueText} ${m.unitText}` : m.valueText;
				})();
				this.rowText(right, headerY, "end", headerSize, 700, d.input.state === "ok" && live !== undefined ? this.onRows(d.color) : t.unit, shown);
				right -= widthOf(shown, headerSize, 700) + 8;
			}
			if (ticks !== null && scale !== null) {
				// The lane's scale, named in its header (the lowest-ranked words:
				// left out before the reading's name would be cut below 80 px),
				// its ends as the scale holds them, in a width reserved for the
				// stored setup so the name's room never follows the scale.
				const unitWord = scaleUnitWord(scale.view, f.pane.overlays.unit);
				const caption = `${endText(ticks.ticks.lo, ticks, true)} to ${endText(ticks.ticks.hi, ticks, true)}${unitWord}`;
				const slot = this.captionSlot(`cap:${d.input.key}`, scale, unitWord, caption, headerSize);
				// Its numbers never cross a seam: the whole slot sits in one slice.
				const at = right + offSeam(right - slot, right, -1);
				if (slot <= at - (f.left + PAD) - 80) {
					this.rowText(at, headerY, "end", headerSize, 600, t.unit, caption);
					right = at - slot - 8;
				}
			}
			if (f.pane.overlays.minmax) {
				const e = extentOf(d.bins);
				if (e !== null) {
					const range = `${this.statOf(d, e.lo)} to ${this.statOf(d, e.hi)}`;
					const at = clearOfSeams(range, "end", right, headerSize, 600, -1);
					// A cut range could still put a number on a seam: whole or not at all.
					if (widthOf(range, headerSize, 600) <= Math.max(0, at - (f.left + PAD) - 80)) {
						this.rowText(at, headerY, "end", headerSize, 600, t.unit, range);
						right = at - widthOf(range, headerSize, 600) - 8;
					}
				}
			}
			// Each lane names its reading: a lane without its name would be an
			// unlabelled axis.
			const band = f.input.bands.find((b) => b.readingKey === d.input.key);
			const name = d.input.name || d.input.key;
			const tail = noRoomOf(d) ? ` · ${noHistoryRoom()}` : "";
			const room = Math.max(0, right - (f.left + PAD));
			// A limit in the header is never cut: the name shortens by whole
			// words beside it, then goes, then the limit gives way to the name.
			const limited = band === undefined ? [] : [...nameRungs(name, this.peerNames(draws)).map((rung) => `${rung} (${band.label})${tail}`), `(${band.label})${tail}`];
			const label = limited.find((text) => widthOf(text, headerSize, 600) <= room) ?? fitText(`${name}${tail}`, headerSize, 600, room);
			this.rowText(f.left + PAD, headerY, "start", headerSize, 600, i === highlight ? t.label : t.unit, label);
		});
		this.cursorLine(f, LANES_TOP, LANES_TOP + laneH * n);
		this.bottomRow(f, this.timeText(f, undefined, this.cursorNote(f)));
		this.paneTabs(f, f, []);
		if (axes) this.timeAxis(f, paneStart, LANES_TOP + laneH * n);
		this.rowBands(f, paneStart, laneAnchors(n));
	}

	/** A lane's gridlines: every tick of its own scale. */
	laneGrid(f: PaneFrame, map: YMap, st: ScaleTicks): void {
		for (const v of st.ticks.values) this.rect("base", f.plot.x0, this.tickY(map, st, v), f.plot.x1 - f.plot.x0, 1, this.look.structure);
	}

	/**
	 * The width a "lo to hi unit" caption (Lanes) reserves for the
	 * stored setup: the widest caption of the scales it can show before the
	 * next stored change (scaleSlotTexts), at its size, so a scale change
	 * never changes the name's room beside it.
	 */
	captionSlot(key: string, s: DrawnScale, unitWord: string, caption: string, size: number): number {
		return this.slot(key, widthOf(caption, size, 600), () => {
			const texts = this.scaleSlotTexts(s, unitWord, false);
			let w = 0;
			for (let i = 0; i + 1 < texts.length; i += 2) {
				const hi = texts[i] as string;
				const bare = unitWord !== "" && hi.endsWith(unitWord) ? hi.slice(0, -unitWord.length) : hi;
				w = Math.max(w, widthOf(`${texts[i + 1] as string} to ${bare}${unitWord}`, size, 600));
			}
			return Math.ceil(w * 10) / 10;
		});
	}

	heatStyle(f: PaneFrame, draws: readonly SeriesDraw[]): void {
		const paneStart = this.prims.length;
		const d = draws[0];
		const t = this.look.text;
		const own = d === undefined ? [] : f.input.bands.filter((b) => b.readingKey === d.input.key);
		// The heat strip marks alerting cells with a cap; the limits those caps
		// stand for are always named, so they keep the top row even with the
		// legend and the value off.
		const limits = own.map((b) => b.label).join(" · ");
		// The cells take the strip's height; the rows draw over them in their edge.
		const top = PLOT_TOP;
		// No history yet: every cell is unobserved and says so.
		const cells = d?.input.history === undefined ? this.scratch.float64(f.plot.buckets).fill(Number.NaN) : heatCells(d.input.history, f.plot.buckets, "max", this.scratch);
		const extent = cellsExtent(cells);
		// The color scale is held like every scale, on six round ticks (the
		// cell maxima its need), so a steady reading keeps its color and a
		// zero kind's headroom keeps the top step for what is high.
		const kept = d === undefined ? undefined : this.typedEnds(d.unit, true);
		const heatUnit = d === undefined ? undefined : this.fixedUnitOf([d]);
		const drawn = d === undefined ? null : this.scaleFor("heat", d.unit, extent, HEAT_TICKS, { ...(kept === undefined ? {} : { kept }), dial: kept === undefined && scaleKindOf(d.unit) !== "yesno", ...(heatUnit === undefined ? {} : { fixedUnit: heatUnit }) });
		const scale = drawn === null ? null : { lo: drawn.held.lo, hi: drawn.held.hi };
		const color = d?.color ?? t.value;
		const steps = Array.from({ length: HEAT_STEPS }, (_, k) => mixToward(color, this.look.surface, 0.85 * (1 - k / (HEAT_STEPS - 1))));
		const missing: number[] = [];
		const upward = d === undefined ? true : bandsOpenUpward(f.input.bands, d.input.key);
		const bandsNative = d === undefined ? [] : own.map((b) => ({ level: b.level, from: Number.isFinite(b.from) ? toNative(b.from, d.unit, this.measure.fahrenheit) : b.from, to: Number.isFinite(b.to) ? toNative(b.to, d.unit, this.measure.fahrenheit) : b.to }));
		cells.forEach((v, c) => {
			const x = f.plot.x0 + c * f.plot.bucketPx;
			if (Number.isNaN(v) || scale === null) {
				missing.push(x + 2);
				return;
			}
			const hit = bandsNative.filter((b) => (upward ? v >= b.from && v < b.to : v > b.from && v <= b.to));
			const level = hit.some((b) => b.level === "crit") ? "crit" : hit.length > 0 ? "warn" : null;
			const k = Math.round(Math.min(1, Math.max(0, (v - scale.lo) / (scale.hi - scale.lo))) * (HEAT_STEPS - 1));
			// The cell keeps its numeric color; an alerting cell adds a cap in the
			// alert color, so the scale stays readable through an alert.
			this.rect("base", x, top, f.plot.bucketPx, PLOT_BOTTOM - top, `fill="${steps[k]}"`);
			if (level !== null) this.rect("base", x, top, f.plot.bucketPx, HEAT_CAP[level], `fill="${this.alertColors[level]}"`);
		});
		if (missing.length > 0) this.prims.push({ k: "marks", layer: "base", xs: missing, w: 4, y: Math.round((top + PLOT_BOTTOM) / 2) - 1, h: 2, paint: `fill="${t.unit}"` });
		if (d === undefined) return;
		this.cursorLine(f, top, PLOT_BOTTOM);
		const j = this.cursorBucket(f);
		const live = d.input.current !== undefined && Number.isFinite(d.input.current) ? d.input.current : cellAt(cells, cells.length - 1);
		const value = d.input.state !== "ok" ? undefined : j !== undefined ? cellAt(cells, j) : live;
		// The limits the caps stand for are never cut: on a pane too narrow
		// for them beside the value at full size, the value draws smaller.
		const bare = own.map((b) => `${b.level} ${bandNumber(upward ? b.from : b.to, d.unit, this.measureOf(d))}`).join(" · ");
		const fits = (size: number): boolean => limits === "" || widthOf(bare, SMALL_SIZE, 600) <= this.currentValue(f, d, value, color, size, true) - 10 - (f.left + PAD);
		const valueLeft = this.currentValue(f, d, value, color, fits(VALUE_SIZE) ? VALUE_SIZE : HEAT_VALUE_NARROW);
		if (limits === "") {
			this.legend(f, draws.slice(0, 1), 0, valueLeft - 10);
		} else {
			this.heatLimits(f, d, own, limits, upward, valueLeft - 10);
		}
		this.heatBottomRow(f, d, drawn, steps);
		// The cells are their own grid; the time axis marks and names them.
		if (f.pane.overlays.axes === true) this.timeAxis(f, paneStart, PLOT_BOTTOM);
		this.rowBands(f, paneStart);
	}

	/**
	 * The top-left line of a heat pane with bands: the reading's name (when
	 * the legend is on) and the limits its alert caps stand for. The limits
	 * are never dropped for room: the name shortens by whole words first,
	 * then the line falls back to the limits alone, then to the bare limits
	 * ("warn 80.0 · crit 90.0", the unit is beside the value), then to
	 * smaller sizes (heatStyle draws the value smaller first where they
	 * would not fit), and only then is it cut.
	 */
	heatLimits(f: PaneFrame, d: SeriesDraw, own: readonly AlertBand[], limits: string, upward: boolean, limit: number): void {
		const t = this.rowColors;
		const room = limit - (f.left + PAD);
		const name = d.input.name || d.input.key;
		const bare = own.map((b) => `${b.level} ${bandNumber(upward ? b.from : b.to, d.unit, this.measureOf(d))}`).join(" · ");
		const candidates: (readonly [string, number, string])[] = [];
		// The name shortens by whole words beside its limits (never cut).
		if (f.pane.overlays.legend) for (const rung of nameRungs(name, [name])) candidates.push([`${rung} ${limits}`, LABEL_SIZE, t.label]);
		candidates.push([limits, LABEL_SIZE, t.unit], [bare, LABEL_SIZE, t.unit], [limits, SCALE_SIZE, t.unit], [bare, SCALE_SIZE, t.unit], [bare, SMALL_SIZE, t.unit]);
		const chosen = candidates.find(([text, size]) => widthOf(text, size, 600) <= room);
		if (chosen !== undefined) this.rowText(f.left + PAD, TOP_BASELINE, "start", chosen[1], 600, chosen[2], chosen[0]);
		else this.rowText(f.left + PAD, TOP_BASELINE, "start", SMALL_SIZE, 600, t.unit, fitText(bare, SMALL_SIZE, 600, room));
	}

	/**
	 * The heat strip's bottom row: the numeric color scale (low value, the
	 * color steps, high value) beside the badge, and the time line in the
	 * room left of it. The scale comes first: when the row is crowded (a
	 * paused split pane, a pane on one present slot) the bin note gives way,
	 * then the scale narrows (3 px steps, no unit word), then the cursor note
	 * and the window label go. Only a scale that cannot fit even narrowed is
	 * left out. Each end sits right-aligned in a width reserved for the
	 * stored setup ("heat:hi", "heat:lo"), so the swatches never move when
	 * the scale or a value changes, and a whole slot sits in one slice.
	 */
	heatBottomRow(f: PaneFrame, d: SeriesDraw, scale: DrawnScale | null, steps: readonly string[]): void {
		const t = this.rowColors;
		const binSeconds = f.windowMs / Math.max(1, f.plot.buckets) / 1000;
		const per = `max per ${binSeconds < 10 ? binSeconds.toFixed(1) : Math.round(binSeconds)} s`;
		const windowLabel = f.pane.overlays.time ? WINDOW_LABEL[f.window] : undefined;
		const cursor = this.cursorNote(f);
		const join = (parts: readonly (string | undefined)[]): string => parts.filter((s): s is string => s !== undefined).join(" · ");
		const badgeLeft = this.badge(f).left;
		const start = f.left + PAD;
		const cue = scale === null ? {} : this.passedEnds(f, [d], scale, d.index);
		type Scale = { hiText: string; loText: string; size: number; swatchW: number; swatchesLeft: number; right: number; loRight: number; left: number };
		const scaleAt = (narrow: boolean): Scale | undefined => {
			const st = scale?.st;
			if (scale === null || st === null || st === undefined) return undefined;
			const unitWord = narrow ? "" : scaleUnitWord(scale.view, f.pane.overlays.unit);
			const hiText = `${endText(st.ticks.hi, st, true)}${unitWord}`;
			const loText = endText(st.ticks.lo, st, true);
			const swatchW = narrow ? 3 : 6;
			// Narrowed, its numbers draw at the small size too.
			const size = narrow ? SMALL_SIZE : SCALE_SIZE;
			const tag = narrow ? ":n" : "";
			const texts = (): string[] => this.scaleSlotTexts(scale, unitWord, false);
			const widest = (list: readonly string[]): number => Math.ceil(Math.max(0, ...list.map((s) => widthOf(s, size, 600))) * 10) / 10;
			const hiSlot = this.slot(`heat:hi${tag}`, widthOf(hiText, size, 600), () => widest(texts().filter((_, i) => i % 2 === 0)));
			const loSlot = this.slot(`heat:lo${tag}`, widthOf(loText, size, 600), () => widest(texts().filter((_, i) => i % 2 === 1)));
			const right0 = badgeLeft - (narrow ? 6 : 10);
			const right = right0 + offSeam(right0 - hiSlot, right0, -1);
			const swatchesLeft = right - hiSlot - 4 - HEAT_STEPS * swatchW;
			const loRight = swatchesLeft - 4 + offSeam(swatchesLeft - 4 - loSlot, swatchesLeft - 4, -1);
			const left = loRight - loSlot;
			return left >= start ? { hiText, loText, size, swatchW, swatchesLeft, right, loRight, left } : undefined;
		};
		const full = scaleAt(false);
		const narrow = scaleAt(true);
		const all = join([windowLabel, per, cursor]);
		const timed = join([windowLabel, cursor]);
		const at = join([cursor]);
		const plans: readonly (readonly [Scale | undefined, string])[] = [
			[full, all],
			[full, timed],
			[narrow, timed],
			[full, at],
			[narrow, at],
			[full, ""],
			[narrow, ""]
		];
		const fits = (s: Scale | undefined, left: string): boolean => left === "" || widthOf(left, ROW_SIZE, 600) <= (s === undefined ? badgeLeft : s.left) - 10 - start;
		const plan = plans.find(([s, left]) => s !== undefined && fits(s, left)) ?? ([undefined, [all, timed].find((left) => fits(undefined, left)) ?? at] as const);
		const [drawn, left] = plan;
		this.bottomRow(f, left, drawn === undefined ? 0 : badgeLeft - drawn.left);
		if (drawn === undefined) return;
		this.rowText(drawn.loRight, BOTTOM_BASELINE, "end", drawn.size, 600, cue.lo ?? t.unit, drawn.loText);
		steps.forEach((s, k) => this.rect("rows", drawn.swatchesLeft + k * drawn.swatchW, BOTTOM_BASELINE - SWATCH_H, drawn.swatchW, SWATCH_H, `fill="${s}"`));
		this.rowText(drawn.right, BOTTOM_BASELINE, "end", drawn.size, 600, cue.hi ?? t.unit, drawn.hiText);
	}

	// ---- Group ------------------------------------------------------------------

	/** The highlighted reading's color: Okabe and Ito's yellow, held to the
	 * value contrast floor on the look's surface. It shares no hue with the
	 * ice ramp or the alert colors, and the highlight is also marked by
	 * position (a bracket on its row, a tab under its column). */
	groupHighlightColor(): string {
		return readableValueColor(STRIP_SERIES_COLORS[1], this.look.surface);
	}

	/** Lines that stand for the rest of the group: the label color most of
	 * the way to the surface. */
	groupMutedColor(): string {
		return mixToward(this.look.text.label, this.look.surface, 0.6);
	}

	/** A stale reading draws dimmer than a live one. */
	dimIfStale(d: SeriesDraw, color: string): string {
		return d.input.state === "stale" ? mixToward(color, this.look.surface, 0.5) : color;
	}

	/**
	 * A Group pane: the readings its rule stands for, drawn by `draw`, with
	 * the pane's first dial slot showing the highlighted reading large (or,
	 * at home, the group's highest) and a line under it saying which one it
	 * is of how many, in what unit, from where. Every reading keeps its
	 * place in the group's order; nothing is sorted.
	 */
	groupPane(f: PaneFrame, draw: GroupDraw, present: readonly boolean[], graphShown: boolean, fahrenheit: boolean): void {
		const paneStart = this.prims.length;
		const info: GroupPaneInfo = f.input.group ?? { status: "empty", title: "", unit: "", sameUnit: 0, otherUnits: 0, refused: 0, highlightKey: null };
		const rule = groupRuleOf(f.pane);
		const below = rule.limits?.below === true;
		const series = f.input.series;
		const n = series.length;
		const named = draw === "lines" && n <= GROUP_NAMED_LINES;
		const highlight = this.groupHighlightColor();
		const muted = this.groupMutedColor();
		const draws: SeriesDraw[] = series.map((s, index) => {
			const unit = drawnUnitOf(s);
			const bins = s.history === undefined || f.plot.buckets === 0 ? NO_BINS : binView(s.history, f.plot.buckets, this.scratch);
			const own = named ? readableValueColor(STRIP_SERIES_COLORS[index % STRIP_SERIES_COLORS.length] as string, this.look.surface) : muted;
			return { input: s, index, unit, displayUnit: convertUnit(0, unit, fahrenheit).unit, color: own, bins, runs: lineRunsOf(bins, s.history, f.gapMode), spans: observedSpans(s.history, bins, f.plot.buckets) };
		});
		if (draw === "tiles" && n > 0) {
			// Tiles (src/strip/tiles.ts): the whole pane, no readout and no lead.
			if (graphShown) tilesPane(this, f, draws, info, !this.screenRow);
			return;
		}
		// The lead: the highlighted reading, or at home the group's highest
		// (lowest when its limits say lower is worse) at the frame's moment.
		const values = draws.map((d) => this.readoutValue(f, d));
		let lead = info.highlightKey === null ? -1 : draws.findIndex((d) => d.input.key === info.highlightKey);
		const home = lead < 0;
		if (home && f.input.view.mode === "live" && info.homeKey !== undefined) {
			const held = draws.findIndex((d) => d.input.key === info.homeKey);
			if (held >= 0 && values[held] !== undefined) lead = held;
		}
		if (home && lead < 0) {
			values.forEach((v, i) => {
				if (v === undefined) return;
				const best = lead < 0 ? undefined : values[lead];
				if (best === undefined || (below ? v < best : v > best)) lead = i;
			});
			if (lead < 0) lead = draws.findIndex((d) => d.input.state !== "missing");
		}
		const leadDraw = lead < 0 ? undefined : (draws[lead] as SeriesDraw);
		const leadColor = leadDraw === undefined ? highlight : named ? leadDraw.color : highlight;
		if (f.pane.overlays.current) {
			const slot = readoutExtent("left", f.extent) as PaneExtent;
			if (present[Math.floor(slot.x0 / SLICE_W)] !== false && leadDraw !== undefined) this.groupReadout(f, slot, { ...leadDraw, color: leadColor }, values[lead], home, below, n, info, rule.from);
		}
		if (n === 0) {
			this.middleText(f, groupStatusWords(info.status, rule.from));
			this.groupBottomRow(f, info, draws, []);
			this.rowBands(f, paneStart);
			return;
		}
		if (!graphShown) return;
		let legend: LegendItem[][] = [];
		if (draw === "now") {
			// Now writes values over its columns: the bottom row and its band
			// come first, so those values keep clear of both.
			this.groupBottomRow(f, info, draws, legend);
			this.rowBands(f, paneStart);
			this.groupNowView(f, draws, lead, highlight);
			return;
		}
		if (draw === "rows") legend = this.groupRowsView(f, draws, lead, highlight, below);
		else if (draw === "spread") this.groupSpreadView(f, draws, lead, highlight);
		else this.groupLinesView(f, draws, lead, named, highlight);
		this.groupBottomRow(f, info, draws, legend);
		if (f.pane.overlays.axes === true) this.timeAxis(f, paneStart, GROUP_BOTTOM);
		this.rowBands(f, paneStart);
	}

	/** The readout slot: the lead reading's name and value large, and under
	 * them which reading it is of how many, its unit and the group's source
	 * ("5 of 32 · MHz · CPU [#0]: ..."; at home "max of 32 · ..."). */
	groupReadout(f: PaneFrame, slot: PaneExtent, d: SeriesDraw, value: number | undefined, home: boolean, below: boolean, n: number, info: GroupPaneInfo, from: string): void {
		const item = this.readoutItem(f, d, value, [d.input.name || d.input.key]);
		const plan = planReadout([item], { x0: slot.x0, x1: slot.x1, y0: 0, y1: 86 }, { align: "right", names: f.pane.overlays.legend });
		if (plan !== null) this.drawReadout(f, plan, [d], [item], [value], d.index);
		const where = !home ? t("strip.group.position", { n: d.index + 1, total: n }) : below ? t("strip.group.lowest", { total: n }) : t("strip.group.highest", { total: n });
		// A folder's sensor tells the person something; a filter or a unit
		// rule would only repeat what they typed, and the unit stands beside
		// the digits.
		const source = from === "folder" ? info.title : "";
		const room = slot.x1 - slot.x0 - 2 * PAD;
		let text = where;
		if (source !== "") {
			const rest = room - widthOf(`${where} · `, SMALL_SIZE, 600);
			const cut = rest >= 24 ? fitText(source, SMALL_SIZE, 600, rest) : "";
			if (cut !== "") text = `${where} · ${cut}`;
		}
		this.inkText(slot.x0 + PAD, READOUT_FOOT, "start", SMALL_SIZE, 600, this.look.text.unit, fitText(text, SMALL_SIZE, 600, room));
	}

	/**
	 * The bottom row of a Group pane's graph: the window, `thread` (Tiles' name
	 * for a highlighted thread), what the pane left out and why ("32 of 48
	 * shown", "8 in other units left out", "history full: 28 of 32", "2 not
	 * found"), the inspect moment, and LIVE or PAUSED; on Rows, the color
	 * scale and the limits beside the badge. The
	 * notes come first: when the row is crowded the scale narrows, then the
	 * limits stand alone, then the legend goes.
	 */
	groupBottomRow(f: PaneFrame, info: GroupPaneInfo, draws: readonly SeriesDraw[], legends: readonly (readonly LegendItem[])[], thread?: string): void {
		const n = draws.length;
		const parts: string[] = [];
		if (f.pane.overlays.time) parts.push(WINDOW_LABEL[f.window]);
		if (thread !== undefined) parts.push(thread);
		if (info.sameUnit > n) parts.push(t("strip.group.shown", { shown: n, total: info.sameUnit }));
		if (info.otherUnits > 0) parts.push(t("strip.group.otherUnits", { count: info.otherUnits }));
		const missing = draws.filter((d) => d.input.state === "missing").length;
		if (missing > 0) parts.push(t("strip.group.notFound", { count: missing }));
		if (info.refused > 0) parts.push(t("strip.group.historyFull", { kept: n - info.refused, total: n }));
		const cursor = this.cursorNote(f);
		if (cursor !== undefined) parts.push(cursor);
		const leftText = parts.join(" · ");
		const badgeLeft = this.badge(f).left;
		const start = f.left + PAD;
		// Items right to left from the badge; a number (the scale's ends move
		// with the readings) that would straddle a seam moves left past it.
		const place = (items: readonly LegendItem[]): { readonly at: number[]; readonly left: number } => {
			const at: number[] = [];
			let x = badgeLeft - 10;
			for (const it of [...items].reverse()) {
				x -= it.gap;
				if (it.kind === "swatch") {
					x -= it.w;
					at.push(x);
					continue;
				}
				// A text with a reserved slot takes the slot's width, right-aligned
				// in it, and the whole slot keeps out of a seam; any other moves
				// its number left past one.
				const w = Math.max(widthOf(it.text, SCALE_SIZE, 600), it.slot ?? 0);
				if (it.slot !== undefined) x += offSeam(x - w, x, -1);
				else {
					const live = numberSpan("", it.text, x - w, SCALE_SIZE, 600);
					if (live !== undefined) x += offSeam(live.l, live.r, -1);
				}
				at.push(x);
				x -= w;
			}
			return { at: at.reverse(), left: x };
		};
		// The widest legend that leaves the notes whole; none when even the
		// narrowest would cut them: what the pane left out is said first.
		const chosen = legends.map((items) => ({ items, ...place(items) })).find((p) => p.left >= start && widthOf(leftText, ROW_SIZE, 600) <= p.left - 10 - start);
		const reserve = chosen === undefined ? 0 : badgeLeft - chosen.left;
		this.bottomRow(f, leftText, reserve);
		if (chosen === undefined) return;
		chosen.items.forEach((it, i) => {
			const x = chosen.at[i] as number;
			if (it.kind === "swatch") this.rect("rows", x, BOTTOM_BASELINE - SWATCH_H, it.w, SWATCH_H, `fill="${it.color}"`);
			else this.rowText(x, BOTTOM_BASELINE, "end", SCALE_SIZE, 600, it.fill, it.text);
		});
	}

	/** The scale every reading of a Group pane shares, held like every scale
	 * (key "group"): over what the readings show (window and value), and
	 * `extra` (Now's limits on a unit with a true zero). The panel hides
	 * Scale from and Scale to here, so a stored scale is never read. */
	groupScale(f: PaneFrame, draws: readonly SeriesDraw[], maxTicks: number, extra: readonly Extent[] = []): DrawnScale | null {
		void f;
		const unit = draws.find((d) => d.input.state !== "missing")?.unit ?? "";
		const fixedUnit = this.fixedUnitOf(draws);
		return this.scaleFor("group", unit, unionExtent([this.needOf(draws), ...extra]), maxTicks, fixedUnit === undefined ? {} : { fixedUnit });
	}

	/** The pane's limits once, on the shared scale (every reading has the
	 * same ones). */
	groupLimits(f: PaneFrame, d: SeriesDraw | undefined, map: YMap): void {
		// The limit lines stay out of Outline and Tint's edge filter (base),
		// which would ring a 1 px warn line into a dark one.
		if (d !== undefined) this.bands(f, d, map, undefined, "base");
	}

	/** Lines (Auto, up to 8 readings): up to 4 each in its own color, named
	 * on the top row; 5 to 8 muted, the lead drawn over them in the
	 * highlight color. Never more than 8 full lines. */
	groupLinesView(f: PaneFrame, draws: readonly SeriesDraw[], lead: number, named: boolean, highlight: string): void {
		// The named lines' legend draws over the plot, in the rows' edge.
		const top = GROUP_TOP + 2;
		const scale = this.groupScale(f, draws, maxTicksFor(GROUP_BOTTOM - top));
		this.baseline(f, GROUP_BOTTOM + 1);
		if (scale === null) return;
		const map: YMap = { lo: scale.held.lo, hi: scale.held.hi, top, bottom: GROUP_BOTTOM };
		const leadDraw = draws[lead];
		this.groupLimits(f, leadDraw ?? draws[0], map);
		const ordered = [...draws.filter((d) => d.index !== lead), ...(leadDraw === undefined ? [] : [leadDraw])];
		for (const d of ordered) {
			const main = d.index === lead;
			const width = named || main ? 2 : 1;
			const color = this.dimIfStale(d, named ? d.color : main ? highlight : d.color);
			// Muted lines stay out of the edge filter (base): on Outline and Tint
			// a ringed hairline reads as a dark stroke, not as context.
			const context = !named && !main;
			this.prims.push(...linePrims(d.runs, f.plot, map, color, width, context ? "base" : "marks", context ? undefined : this.backing(width), (ink) => this.dimIfStale(d, ink)));
		}
		this.cursorLine(f, top, GROUP_BOTTOM);
		if (named && f.pane.overlays.legend) this.legend(f, draws, lead, f.right - PAD);
	}

	/**
	 * Rows: one heat row per reading, time across, on one shared scale in
	 * the ice ramp (reversed on a light surface, so high stays salient). A
	 * cell holds its maximum (its minimum when lower is worse); a cell past
	 * the critical limit takes the critical color outright, a cell past
	 * warn keeps its ramp color under a warn cap over its upper half
	 * (warnCap), and a row alerting now carries a bar at its left, 3 px for
	 * warn and 6 for crit, so neither an alert nor its level rests on color
	 * alone. The lead's row is bracketed in the highlight color with a tab
	 * at the right end. Unobserved cells stay empty. Returns the legends
	 * the bottom row may show, widest first.
	 */
	groupRowsView(f: PaneFrame, draws: readonly SeriesDraw[], lead: number, highlight: string, below: boolean): LegendItem[][] {
		const rows = groupRows(draws.length);
		const cells = draws.map((d) => (d.input.history === undefined ? this.scratch.float64(f.plot.buckets).fill(Number.NaN) : heatCells(d.input.history, f.plot.buckets, below ? "min" : "max", this.scratch)));
		let lo = Number.POSITIVE_INFINITY;
		let hi = Number.NEGATIVE_INFINITY;
		let seen = false;
		for (const row of cells) {
			for (let c = 0; c < row.length; c++) {
				const v = row[c] as number;
				if (Number.isNaN(v)) continue;
				if (v < lo) lo = v;
				if (v > hi) hi = v;
				seen = true;
			}
		}
		const unit = draws.find((d) => d.input.state !== "missing")?.unit ?? "";
		// The rows' color scale, held like every scale over the cells.
		const rowsUnit = this.fixedUnitOf(draws);
		const drawnScale = this.scaleFor("group", unit, seen ? { lo, hi } : null, GROUP_ROWS_TICKS, rowsUnit === undefined ? {} : { fixedUnit: rowsUnit });
		const scale = drawnScale === null ? null : { lo: drawnScale.held.lo, hi: drawnScale.held.hi };
		const light = luminanceOf(this.look.surface) > 0.5;
		const ramp: readonly string[] = light ? [...ICE_RAMP].reverse() : ICE_RAMP;
		const fills = new Map<string, number[]>();
		const cellW = f.plot.bucketPx;
		const testers = draws.map((d) => this.levelTester(f, d));
		const levelAt = (d: SeriesDraw, v: number): "warn" | "crit" | null => (testers[d.index] as (value: number) => "warn" | "crit" | null)(v);
		// One paint string per ramp step and alert level, stale or not. A
		// stale row's ramp cells draw dimmer, never its alert cells: a dimmed
		// alert color falls toward the ramp and the series colors.
		const paints = new Map<string, string>();
		const paintOf = (d: SeriesDraw, base: string, alert: boolean): string => {
			const id = d.input.state === "stale" && !alert ? `s${base}` : base;
			let p = paints.get(id);
			if (p === undefined) {
				p = `fill="${alert ? base : this.dimIfStale(d, base)}"`;
				paints.set(id, p);
			}
			return p;
		};
		// The warn caps, drawn over their cells.
		const caps = new Map<string, number[]>();
		draws.forEach((d, i) => {
			const row = rows[i];
			const values = cells[i];
			if (row === undefined || values === undefined || scale === null) return;
			const h = row.y1 - row.y0;
			// Consecutive cells of one paint as one rect, per layer.
			const layer = (into: Map<string, number[]>, height: number) => {
				let paint: string | null = null;
				let x0 = 0;
				let w = 0;
				const end = (): void => {
					if (paint !== null && w > 0) {
						const list = into.get(paint);
						if (list === undefined) into.set(paint, [x0, row.y0, w, height]);
						else list.push(x0, row.y0, w, height);
					}
					paint = null;
					w = 0;
				};
				return {
					end,
					put: (next: string | null, x: number): void => {
						if (next !== null && next === paint && x0 + w === x) {
							w += cellW;
							return;
						}
						end();
						if (next === null) return;
						paint = next;
						x0 = x;
						w = cellW;
					}
				};
			};
			const base = layer(fills, h);
			const cap = layer(caps, warnCap(h));
			values.forEach((v, c) => {
				const x = f.plot.x0 + c * cellW;
				if (Number.isNaN(v)) {
					base.end();
					cap.end();
					return;
				}
				const level = levelAt(d, v);
				const k = Math.round(Math.min(1, Math.max(0, (v - scale.lo) / (scale.hi - scale.lo))) * (ramp.length - 1));
				base.put(level === "crit" ? paintOf(d, this.alertColors.crit, true) : paintOf(d, ramp[k] as string, false), x);
				cap.put(level === "warn" ? paintOf(d, this.alertColors.warn, true) : null, x);
			});
			base.end();
			cap.end();
		});
		for (const [paint, rects] of [...fills, ...caps]) this.prims.push({ k: "cells", layer: "base", rects, paint });
		// Alerting now (or at the cursor): a bar at the row's left end, twice
		// as wide for crit.
		const bars = new Map<string, number[]>();
		draws.forEach((d, i) => {
			const row = rows[i];
			const v = this.readoutValue(f, d);
			const level = v === undefined ? null : levelAt(d, v);
			if (row === undefined || level === null) return;
			const paint = `fill="${this.alertColors[level]}"`;
			const list = bars.get(paint) ?? [];
			const w = ROW_BAR[level];
			list.push(f.plot.x0 - 2 - w, row.y0, w, Math.max(1, row.y1 - row.y0));
			bars.set(paint, list);
		});
		for (const [paint, rects] of bars) this.prims.push({ k: "cells", layer: "marks", rects, paint });
		const leadRow = rows[lead];
		if (leadRow !== undefined) {
			const paint = `fill="${highlight}"`;
			const w = f.plot.x1 - f.plot.x0;
			this.prims.push({ k: "cells", layer: "marks", rects: [f.plot.x0, leadRow.y0 - 1, w, 1, f.plot.x0, leadRow.y1, w, 1, f.plot.x1 + 1, leadRow.y0 - 1, 4, leadRow.y1 - leadRow.y0 + 2], paint });
		}
		this.cursorLine(f, GROUP_TOP, GROUP_BOTTOM);
		if (scale === null || drawnScale === null || drawnScale.st === null) return [];
		// The scale's ends and steps, then each limit with its own swatch.
		// Each end keeps a width reserved for the stored setup ("rows:hi",
		// "rows:lo"), so the legend never moves when the scale changes.
		const d0 = draws.find((d) => d.input.state !== "missing") ?? draws[0];
		const st = drawnScale.st;
		const unitWord = d0 === undefined ? "" : scaleUnitWord(drawnScale.view, f.pane.overlays.unit);
		const loText = d0 === undefined ? "" : endText(st.ticks.lo, st, true);
		const hiText = d0 === undefined ? "" : endText(st.ticks.hi, st, true);
		const slotTextsOf = (word: string): string[] => this.scaleSlotTexts(drawnScale, word, false);
		const widest = (list: readonly string[]): number => Math.ceil(Math.max(0, ...list.map((s) => widthOf(s, SCALE_SIZE, 600))) * 10) / 10;
		const loSlot = this.slot("rows:lo", widthOf(loText, SCALE_SIZE, 600), () => widest(slotTextsOf("").filter((_, i) => i % 2 === 1)));
		const hiSlot = this.slot("rows:hi", widthOf(`${hiText}${unitWord}`, SCALE_SIZE, 600), () => widest(slotTextsOf(unitWord).filter((_, i) => i % 2 === 0)));
		const hiSlotBare = this.slot("rows:hi:n", widthOf(hiText, SCALE_SIZE, 600), () => widest(slotTextsOf("").filter((_, i) => i % 2 === 0)));
		// The legend draws on the bottom row, in the rows' edge.
		const t0 = this.rowColors;
		const limitItems: LegendItem[] = [];
		// In the unit on view, as the rows' bands draw them (stampedLimits).
		const stored = groupRuleOf(f.pane).limits;
		const limits = stored === undefined || d0 === undefined ? undefined : (stampedLimits(stored, d0.unit, this.measure.fahrenheit) ?? stored);
		if (limits !== undefined && d0 !== undefined) {
			for (const level of ["warn", "crit"] as const) {
				const value = limits[level];
				if (value === undefined) continue;
				limitItems.push({ kind: "swatch", color: this.alertColors[level], w: 6, gap: 8 }, { kind: "text", text: `${level} ${bandNumber(value, d0.unit, this.measureOf(d0))}`, fill: t0.unit, gap: 3 });
			}
		}
		const scaleItems = (swatchW: number, withUnit: boolean): LegendItem[] => [{ kind: "text", text: loText, fill: t0.unit, gap: 0, slot: loSlot }, ...ramp.map((color, k): LegendItem => ({ kind: "swatch", color, w: swatchW, gap: k === 0 ? 4 : 0 })), { kind: "text", text: `${hiText}${withUnit ? unitWord : ""}`, fill: t0.unit, gap: 4, slot: withUnit ? hiSlot : hiSlotBare }];
		return [
			[...scaleItems(6, true), ...limitItems],
			[...scaleItems(3, false), ...limitItems],
			limitItems.length > 0 ? limitItems : scaleItems(3, false)
		].filter((items) => items.length > 0);
	}

	/**
	 * Now: a column per reading in the group's order, on one shared scale
	 * labelled at its left end (round ticks and light gridlines, the unit
	 * once): each a bar from the scale's floor (zero for a unit with a true
	 * zero) to the reading's value now (at the cursor when paused), in the
	 * ramp's color for that value, translucent so the strip picture shows
	 * through, with a thin whisker for the window's lowest to highest
	 * reading behind it. The highlighted reading's bar takes the highlight
	 * color, a reading past a limit the alert color, and a stale one draws
	 * dimmer. Values stand above the bars where every one fits its column,
	 * else above the highlighted and the highest only. The limits cross the
	 * columns as lines, labelled through the same collision pass as every
	 * other word of the pane. Columns sit inside dial slots, never across a
	 * seam.
	 */
	groupNowView(f: PaneFrame, draws: readonly SeriesDraw[], lead: number, highlight: string): void {
		const paneStart = this.prims.length;
		const d0 = draws.find((d) => d.input.state !== "missing");
		const unit = d0?.unit ?? "";
		// On a unit with a true zero the columns are bars from 0 and the
		// group's limits join the scale, so a far limit draws in its place.
		const zero = scaleStartsAtZero(unit);
		const top = GROUP_TOP + 14;
		const limitsOf = draws[lead] ?? d0;
		const edges: number[] = [];
		if (limitsOf !== undefined) {
			for (const band of f.input.bands.filter((b) => b.readingKey === limitsOf.input.key)) {
				const edge = band.from === Number.NEGATIVE_INFINITY ? band.to : band.from;
				if (Number.isFinite(edge)) edges.push(toNative(edge, limitsOf.unit, this.measure.fahrenheit));
			}
		}
		const drawnScale = this.groupScale(f, draws, maxTicksFor(GROUP_BOTTOM - top), zero ? edges.map((e) => ({ lo: e, hi: e })) : []);
		this.baseline(f, GROUP_BOTTOM + 1);
		if (drawnScale === null || d0 === undefined || limitsOf === undefined) return;
		const scale = { lo: drawnScale.held.lo, hi: drawnScale.held.hi };
		const ticks = drawnScale.st;
		const map: YMap = { lo: scale.lo, hi: scale.hi, top, bottom: GROUP_BOTTOM };
		const cols = groupColumns(f.plot, draws.length);
		const gutterRight = f.plot.x0 + GROUP_NOW_GUTTER;
		if (ticks !== null) {
			for (const v of ticks.ticks.values) {
				const y = this.tickY(map, ticks, v);
				if (y >= map.bottom - 1) continue;
				this.rect("base", gutterRight - 4, y, f.plot.x1 - gutterRight + 4, 1, this.look.structure);
			}
		}
		// The limits, once, as lines across the columns, labelled first so
		// every later word gives way to them; a limit outside the scale (on a
		// unit with no true zero) is not drawn on its edge.
		const labels: BandLabel[] = [];
		const eps = 1e-9 * Math.max(1, Math.abs(map.hi), Math.abs(map.lo));
		for (const band of f.input.bands.filter((b) => b.readingKey === limitsOf.input.key)) {
			const edge = band.from === Number.NEGATIVE_INFINITY ? band.to : band.from;
			if (!Number.isFinite(edge)) continue;
			const native = toNative(edge, limitsOf.unit, this.measure.fahrenheit);
			if (native < map.lo - eps || native > map.hi + eps) continue;
			const y = Math.round(yOf(map, native));
			const color = this.alertColors[band.level];
			this.rect("base", gutterRight - 4, y, f.plot.x1 - gutterRight + 4, 1, `fill="${color}"`);
			labels.push({ y: y - 2, color, text: band.label });
		}
		// Now takes no Scale and grid, so the box says nothing about its labels.
		this.bandLabels({ ...f, plot: { ...f.plot, x0: gutterRight } }, labels, 0, false);
		// Bars and whiskers, one path per paint.
		const fills = new Map<string, number[]>();
		const add = (paint: string, x: number, y: number, w: number, h: number): void => {
			if (!(w > 0 && h > 0)) return;
			const list = fills.get(paint);
			if (list === undefined) fills.set(paint, [x, y, w, h]);
			else list.push(x, y, w, h);
		};
		const light = luminanceOf(this.look.surface) > 0.5;
		const ramp: readonly string[] = light ? [...ICE_RAMP].reverse() : ICE_RAMP;
		const whisker = mixToward(this.look.text.label, this.look.surface, 0.35);
		const values = draws.map((d) => (d.input.state === "missing" ? undefined : this.readoutValue(f, d)));
		draws.forEach((d, i) => {
			const col = cols[i];
			const v = values[i];
			if (col === undefined || d.input.state === "missing") return;
			const w = col.x1 - col.x0;
			const e = extentOf(d.bins);
			if (e !== null && w >= 3) {
				const yTop = yOf(map, e.hi);
				add(`fill="${this.dimIfStale(d, whisker)}"`, Math.round((col.x0 + col.x1) / 2) - 0.5, yTop, 1, Math.max(1, yOf(map, e.lo) - yTop));
			}
			if (v === undefined) return;
			const level = this.levelOf(f, d, v);
			const k = Math.round(Math.min(1, Math.max(0, (v - scale.lo) / (scale.hi - scale.lo))) * (ramp.length - 1));
			const color = level !== null ? this.alertColors[level] : i === lead ? highlight : (ramp[k] as string);
			const y = yOf(map, v);
			add(`fill="${this.dimIfStale(d, color)}" fill-opacity="${GROUP_BAR_OPACITY}"`, col.x0, y, w, Math.max(1, GROUP_BOTTOM - y));
		});
		for (const [paint, rects] of fills) this.prims.push({ k: "cells", layer: "base", rects, paint });
		const leadCol = cols[lead];
		if (leadCol !== undefined) this.prims.push({ k: "cells", layer: "marks", rects: [leadCol.x0, GROUP_BOTTOM + 2, leadCol.x1 - leadCol.x0, 2], paint: `fill="${highlight}"` });
		// Values above the bars: all of them when every one fits its column,
		// else the highlighted reading's and the highest.
		const texts = values.map((v, i) => (v === undefined ? "" : this.formatOf(draws[i] as SeriesDraw, v).valueText));
		const everyFits = cols.every((c, i) => texts[i] === "" || widthOf(texts[i] as string, SMALL_SIZE, 700) <= c.x1 - c.x0 + 2);
		let highest = -1;
		values.forEach((v, i) => {
			if (v !== undefined && (highest < 0 || v > (values[highest] as number))) highest = i;
		});
		const t0 = this.look.text;
		draws.forEach((d, i) => {
			const col = cols[i];
			const v = values[i];
			const text = texts[i] as string;
			if (col === undefined || v === undefined || text === "" || !(everyFits || i === lead || i === highest)) return;
			const sliceLo = Math.floor(col.x0 / SLICE_W) * SLICE_W + 2;
			const sliceHi = sliceLo + SLICE_W - 4;
			const half = widthOf(text, SMALL_SIZE, 700) / 2 + 1;
			const x = Math.min(sliceHi - half, Math.max(sliceLo + half, (col.x0 + col.x1) / 2));
			const y = Math.max(GROUP_TOP + 9, Math.round(yOf(map, v)) - 3);
			const label = { x, y, anchor: "middle" as const, size: SMALL_SIZE, weight: 700 as const, text };
			if (!this.clearOfText(label, paneStart, 1)) return;
			this.inkText(x, y, "middle", SMALL_SIZE, 700, i === lead ? highlight : this.dimIfStale(d, t0.label), text);
		});
		// The scale's labels in the gutter, the unit once above them.
		if (ticks !== null) {
			const displayUnit = convertUnit(0, unit, this.measure.fahrenheit).unit;
			const x = f.plot.x0 + 2;
			const room = GROUP_NOW_GUTTER - 6;
			// The ends are always labelled, between them the ticks.
			const values = [ticks.ticks.lo, ...ticks.ticks.values.filter((v) => v > ticks.ticks.lo && v < ticks.ticks.hi), ticks.ticks.hi];
			for (const [i, v] of [...values.entries()].reverse()) {
				const y = this.tickY(map, ticks, v);
				const text = endText(v, ticks, i === 0 || i === values.length - 1);
				const label = { x, y: y + 4, anchor: "start" as const, size: SMALL_SIZE, weight: 600 as const, text };
				if (y + 4 > GROUP_BOTTOM + 4 || widthOf(text, SMALL_SIZE, 600) > room || !this.clearOfText(label, paneStart)) continue;
				this.inkText(x, y + 4, "start", SMALL_SIZE, 600, t0.unit, text);
			}
			if (f.pane.overlays.unit && displayUnit !== "" && !isDataUnit(unit) && widthOf(displayUnit, SMALL_SIZE, 600) <= room) this.inkText(x, GROUP_TOP + 8, "start", SMALL_SIZE, 600, t0.unit, displayUnit);
		}
	}

	/**
	 * Spread: the group's range at each moment (its lowest to its highest
	 * reading, a band with its edges drawn), its median as a thin line, and the lead reading as
	 * the line over them, all on one scale. A bucket no sample landed in is
	 * continuous while it lies inside some reading's run, as a line draws
	 * straight across it (at 5 minutes on 2 px buckets a sample lands in about
	 * one bucket in four); a moment outside every run is a gap in all three.
	 */
	groupSpreadView(f: PaneFrame, draws: readonly SeriesDraw[], lead: number, highlight: string): void {
		const top = GROUP_TOP + 2;
		const scale = this.groupScale(f, draws, maxTicksFor(GROUP_BOTTOM - top));
		this.baseline(f, GROUP_BOTTOM + 1);
		if (scale === null) return;
		const map: YMap = { lo: scale.held.lo, hi: scale.held.hi, top, bottom: GROUP_BOTTOM };
		const leadDraw = draws[lead];
		this.groupLimits(f, leadDraw ?? draws[0], map);
		const buckets = f.plot.buckets;
		const lo = this.scratch.float64(buckets).fill(Number.POSITIVE_INFINITY);
		const hi = this.scratch.float64(buckets).fill(Number.NEGATIVE_INFINITY);
		// Each bucket's last values, in the readings' order, laid end to end:
		// bucket j's are lasts[from[j]] to lasts[from[j + 1] - 1] (an array
		// per bucket was most of a frame's garbage).
		const from = this.scratch.int32(buckets + 1).fill(0);
		let total = 0;
		for (const { bins } of draws) {
			for (let i = 0; i < bins.n; i++) {
				const j = bins.j[i] as number;
				if ((bins.min[i] as number) < (lo[j] as number)) lo[j] = bins.min[i] as number;
				if ((bins.max[i] as number) > (hi[j] as number)) hi[j] = bins.max[i] as number;
				from[j + 1] = (from[j + 1] as number) + 1;
			}
			total += bins.n;
		}
		for (let j = 0; j < buckets; j++) from[j + 1] = (from[j + 1] as number) + (from[j] as number);
		// How many readings' runs start or end at each bucket: the running sum
		// says whether a bucket lies inside any run.
		const runEdges = this.scratch.int32(buckets + 1).fill(0);
		for (const d of draws) {
			for (const r of d.runs) {
				const first = d.bins.j[r.from] as number;
				const past = (d.bins.j[r.to - 1] as number) + 1;
				runEdges[first] = (runEdges[first] as number) + 1;
				runEdges[past] = (runEdges[past] as number) - 1;
			}
		}
		const next = this.scratch.int32(buckets);
		next.set(from.subarray(0, buckets));
		const lasts = this.scratch.float64(total);
		for (const { bins } of draws) {
			for (let i = 0; i < bins.n; i++) {
				const j = bins.j[i] as number;
				const at = next[j] as number;
				lasts[at] = bins.last[i] as number;
				next[j] = at + 1;
			}
		}
		// The band in the ramp's middle step, translucent, so it reads on any
		// look and the picture still shows through it.
		const band = this.paint(`g${f.index}`, ICE_RAMP[4], GROUP_BAND_OPACITY);
		const median = mixToward(this.look.text.label, this.look.surface, 0.2);
		// The band's edges as 1 px lines in the ramp's light step: a fill alone
		// can vanish into a strip picture of the same hue.
		const edge = ICE_RAMP[6];
		const run = { top: [] as number[], bottom: [] as number[], median: [] as number[] };
		const flush = (): void => {
			// No bucket since the last gap: nothing to draw, and no new arrays.
			if (run.top.length === 0) return;
			if (run.top.length >= 4) {
				this.prims.push({ k: "envelope", layer: "base", top: run.top, bottom: run.bottom, paint: band });
				this.prims.push({ k: "line", layer: "base", pts: run.top, stroke: edge, width: 1 }, { k: "line", layer: "base", pts: run.bottom, stroke: edge, width: 1 });
			}
			// The median sits under the edge filter of Outline and Tint (base),
			// so it is never ringed into a dark double stroke.
			if (run.median.length >= 2) this.prims.push({ k: "line", layer: "base", pts: run.median.length === 2 ? [...run.median, ...run.median] : run.median, stroke: median, width: 1.5 });
			run.top = [];
			run.bottom = [];
			run.median = [];
		};
		let inside = 0;
		for (let j = 0; j < buckets; j++) {
			const start = from[j] as number;
			const end = from[j + 1] as number;
			inside += runEdges[j] as number;
			if (start === end) {
				if (inside === 0) flush();
				continue;
			}
			const x = snap(bucketX(f.plot, j));
			let tY = yOf(map, hi[j] as number);
			let bY = yOf(map, lo[j] as number);
			if (bY - tY < 1) {
				const mid = (tY + bY) / 2;
				tY = mid - 0.5;
				bY = mid + 0.5;
			}
			run.top.push(x, tY);
			run.bottom.push(x, bY);
			sortRange(lasts, start, end);
			const n = end - start;
			const m = n % 2 === 1 ? (lasts[start + (n - 1) / 2] as number) : ((lasts[start + n / 2 - 1] as number) + (lasts[start + n / 2] as number)) / 2;
			run.median.push(x, yOf(map, m));
		}
		flush();
		if (leadDraw !== undefined) this.prims.push(...linePrims(leadDraw.runs, f.plot, map, this.dimIfStale(leadDraw, highlight), 2, "marks", this.backing(2), (ink) => this.dimIfStale(leadDraw, ink)));
		this.cursorLine(f, top, GROUP_BOTTOM);
	}
}

/** Sorts values[start] to values[end - 1] in place, lowest first, keeping
 * equal values (0 and -0) in their order: what a stable sort by (a, b) =>
 * a - b gives a copy of them. */
function sortRange(values: Float64Array, start: number, end: number): void {
	for (let i = start + 1; i < end; i++) {
		const v = values[i] as number;
		let k = i;
		while (k > start && (values[k - 1] as number) - v > 0) {
			values[k] = values[k - 1] as number;
			k--;
		}
		values[k] = v;
	}
}

/** One item of a bottom-row legend, placed right to left before the badge:
 * a color swatch or a word, `gap` px before it. */
type LegendItem = { readonly kind: "swatch"; readonly color: string; readonly w: number; readonly gap: number } | { readonly kind: "text"; readonly text: string; readonly fill: string; readonly gap: number; readonly slot?: number };

/** A color's relative lightness, 0 (black) to 1 (white). */
function luminanceOf(hex: string): number {
	const v = (o: number): number => parseInt(hex.slice(o, o + 2), 16) / 255;
	return 0.2126 * v(1) + 0.7152 * v(3) + 0.0722 * v(5);
}

/** What a Group pane with nothing to draw says. */
function groupStatusWords(status: GroupStatus, from: string): string {
	switch (status) {
		case "no-anchor":
			return t("strip.group.needsReading");
		case "anchor-missing":
			return t("strip.group.readingMissing");
		case "no-filter":
			return t("strip.group.needsFilter");
		case "unavailable":
			return "unavailable";
		default:
			return from === "list" ? t("strip.group.listEmpty") : t("strip.group.matchesNothing");
	}
}

/** The encoder columns a pane covers. */
function paneColumns(extent: PaneExtent): number[] {
	const first = Math.floor(extent.x0 / SLICE_W);
	const last = Math.ceil(extent.x1 / SLICE_W) - 1;
	return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

type Anchors = { readonly left: number; readonly right: number; readonly lo: number; readonly hi: number };

/**
 * Where a pane's overlays (value, legend, bands' labels, badge, time line)
 * sit: the longest run of contiguous present slots in the pane, the
 * rightmost of equal runs, since the newest data is on the right. Overlays
 * never reach into a missing slot, where nobody would see them, and never
 * span one. Null when no slot of the pane is present.
 */
function presentAnchors(extent: PaneExtent, present: readonly boolean[]): Anchors | null {
	let best: [number, number] | null = null;
	let runStart = -1;
	for (const c of paneColumns(extent)) {
		if (present[c] === false) {
			runStart = -1;
			continue;
		}
		if (runStart < 0) runStart = c;
		if (best === null || c - runStart >= best[1] - best[0]) best = [runStart, c];
	}
	if (best === null) return null;
	const [lo, hi] = best;
	return { left: Math.max(extent.x0, lo * SLICE_W), right: Math.min(extent.x1, (hi + 1) * SLICE_W), lo, hi };
}

/** Rows a gap note may take, tried in order: the middle of the plot first,
 * then outward, between the top row and the bottom row. */
const GAP_ROWS: readonly number[] = [56, ...Array.from({ length: 26 }, (_, i) => [55 - i, 57 + i]).flat()].filter((y) => y >= 30 && y <= 82);
/** Widest gap note, so its box stays inside the slot that carries it. */
const GAP_NOTE_MAX = 150;

/**
 * The words naming a pane's empty slots: a dial that is absent is
 * "missing"; a dial on screen that left the strip "left the strip".
 * The longest that fits, else a count.
 */
function gapNote(missing: readonly number[], left: readonly number[]): string {
	const list = (ns: readonly number[]): string => (ns.length === 1 ? String(ns[0]) : `${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}`);
	const dials = (ns: readonly number[]): string => `${ns.length === 1 ? "Dial" : "Dials"} ${list(ns)}`;
	const n = missing.length + left.length;
	const count = `${n} ${n === 1 ? "dial" : "dials"}`;
	const options =
		left.length === 0
			? [`${dials(missing)} missing`, `${count} missing`]
			: missing.length === 0
				? [`${dials(left)} left the strip`, `${count} left the strip`, `${count} left`]
				: [`${dials(left)} left the strip, ${list(missing)} missing`, `${count} not in the strip`, `${count} out`];
	return options.find((text) => widthOf(text, SMALL_SIZE, 700) <= GAP_NOTE_MAX) ?? (options[options.length - 1] as string);
}

/**
 * The incomplete-group cue inside one pane: a slim bar on each present
 * slot's side that faces a missing slot of the same pane, and the missing
 * dials named once, in a present slot beside the gap, on a row no other
 * text of the pane uses (a dial that left the strip is named as having
 * left, not as missing). A slot outside the overlay run is preferred, since
 * nothing else is written there. A missing slot in the other half of a
 * split never marks this half: each half stands on its own. The data keeps
 * its time positions.
 */
function gapMarkers(b: SceneBuilder, extent: PaneExtent, anchors: Anchors, present: readonly boolean[], left: readonly boolean[], look: Look, paneTexts: readonly TextPrim[]): void {
	const cols = paneColumns(extent);
	const missing = cols.filter((c) => present[c] === false);
	if (missing.length === 0) return;
	const absent = (c: number): boolean => cols.includes(c) && present[c] === false;
	const fill = `fill="${look.text.badge}"`;
	const places: { column: number; x: number; anchor: "start" | "end" }[] = [];
	for (const c of cols) {
		if (present[c] === false) continue;
		if (absent(c - 1)) {
			b.rect("marks", c * SLICE_W, 0, 2, 100, fill);
			places.push({ column: c, x: c * SLICE_W + 8, anchor: "start" });
		}
		if (absent(c + 1)) {
			b.rect("marks", (c + 1) * SLICE_W - 2, 0, 2, 100, fill);
			places.push({ column: c, x: (c + 1) * SLICE_W - 8, anchor: "end" });
		}
	}
	const name = gapNote(
		missing.filter((c) => left[c] !== true).map((c) => c + 1),
		missing.filter((c) => left[c] === true).map((c) => c + 1)
	);
	const outside = (p: { column: number }): boolean => p.column < anchors.lo || p.column > anchors.hi;
	for (const place of [...places.filter(outside), ...places.filter((p) => !outside(p))]) {
		for (const y of GAP_ROWS) {
			const prim = textPrim(place.x, y, place.anchor, SMALL_SIZE, 700, look.text.badge, name);
			if (paneTexts.some((p) => rowsMeet(p.y, p.size, y, SMALL_SIZE) && p.bx0 < prim.bx1 && prim.bx0 < p.bx1)) continue;
			b.prims.push(prim);
			return;
		}
	}
}

/** The working arrays every build reuses (graph.ts Scratch): one build at a
 * time, and no scene keeps any of them. */
const buildScratch = new Scratch();

/** Builds the logical frame for one group from one snapshot. */
export function buildStripScene(input: StripSceneInput): LogicalScene {
	const { config, encoders } = input;
	const bucketPx = input.bucketPx ?? DEFAULT_BUCKET_PX;
	const width = stripWidth(encoders);
	const present = Array.from({ length: encoders }, (_, c) => input.present?.[c] !== false);
	const left = Array.from({ length: encoders }, (_, c) => !present[c] && input.left?.[c] === true);
	const look = lookOf(config, input.palette, input.text);
	const measure: MeasureOptions = { decimals: config.decimals, fahrenheit: config.fahrenheit, dataUnits: input.dataUnits };
	buildScratch.reset();
	const b = new SceneBuilder(look, measure, input.alertColors, buildScratch);
	b.formats = config.readingFormats;
	b.screenRow = input.screens !== undefined && input.screens.count >= 2 && config.layout === "whole";
	if (look.background === "glass") {
		b.paint("p", input.palette.bg, GLASS_OPACITY);
		b.paint("i", input.palette.label, GLASS_INK_OPACITY);
	} else if (look.background === "tint") {
		b.paint("t", input.palette.bg, TINT_OPACITY);
	} else if (isArtLook(look.background)) {
		// One backdrop across the whole strip, under everything else.
		b.rect("base", 0, 0, width, 100, artPaint(look.background, input.palette, { tone: config.skyColor ?? "theme", stars: config.stars ?? "all" }));
	}
	const panes = activePanes(config);
	const scales: [PaneScaleOut | null, PaneScaleOut | null] = [null, null];
	const extents = paneExtents(config.layout, encoders);
	panes.forEach((pane, index) => {
		const extent = extents[index] as PaneExtent;
		// One square panel per pane, under everything else.
		const panel = look.background === "theme" ? `fill="${input.palette.bg}"` : look.background === "glass" ? 'fill="url(#p)"' : look.background === "tint" ? 'fill="url(#t)"' : null;
		if (panel !== null) b.rect("base", extent.x0, 0, extent.x1 - extent.x0, 100, panel);
		const anchors = presentAnchors(extent, present);
		if (anchors === null) return;
		const paneStart = b.prims.length;
		const paneInput: StripPaneInput = input.panes[index] ?? { series: [], bands: [], view: { mode: "live" }, highlight: 0 };
		const window = paneWindowOf(config, index);
		// The pane's scales: what the runtime holds for them, and how its
		// stored scale reaches the readings it draws.
		const drawnUnits = (isRuleStyle(pane.style) ? paneInput.series : paneInput.series.slice(0, seriesLimitsOf(pane).max)).map((s) => drawnUnitOf(s));
		const held = paneInput.scale;
		const scaleState: PaneScaleState = { input: held ?? {}, resolved: resolvedScale(pane, drawnUnits, config.fahrenheit), out: { held: { ...(held?.prev ?? {}) }, slots: { ...(held?.slots ?? {}) } } };
		b.paneScale = scaleState;
		scales[index] = scaleState.out;
		if (pane.style === "ambient") {
			// Ambient (src/strip/ambient.ts): a rule's readings.
			const info: GroupPaneInfo = paneInput.group ?? { status: "empty", title: "", unit: "", sameUnit: 0, otherUnits: 0, refused: 0, highlightKey: null };
			const viewMs = paneInput.series.find((s) => s.history !== undefined)?.history?.windowMs;
			const windowMs = viewMs !== undefined && viewMs > 0 ? viewMs : WINDOW_MS[window];
			const plot = ambientPlotOf(extent, window, bucketPx);
			const frame: PaneFrame = { index, pane, input: paneInput, extent, plot, window, windowMs, gapMode: config.gapMode, left: anchors.left, right: anchors.right };
			if (paneInput.series.length === 0) b.middleText(frame, groupStatusWords(info.status, groupRuleOf(pane).from));
			ambientPane(b, frame, info, input.reduced === true);
			const paneTexts = b.prims.slice(paneStart).filter((p): p is TextPrim => p.k === "text");
			gapMarkers(b, extent, anchors, present, left, look, paneTexts);
			return;
		}
		if (pane.style === "group") {
			const draw = groupDrawOf(groupRuleOf(pane).view, paneInput.series.length);
			const plot = groupPlotOf(pane, extent, draw, bucketPx, draw === "tiles" ? tileShapeOf(paneInput.series.map((s) => s.name)).grid : undefined);
			const graphAnchors = pane.overlays.current ? presentAnchors(groupGraphExtent(pane, extent, draw), present) : anchors;
			const viewMs = paneInput.series.find((s) => s.history !== undefined)?.history?.windowMs;
			const at = graphAnchors ?? anchors;
			const frame: PaneFrame = { index, pane, input: paneInput, extent, plot, window, windowMs: viewMs !== undefined && viewMs > 0 ? viewMs : WINDOW_MS[window], gapMode: config.gapMode, left: at.left, right: at.right };
			b.groupPane(frame, draw, present, graphAnchors !== null, config.fahrenheit);
			const paneTexts = b.prims.slice(paneStart).filter((p): p is TextPrim => p.k === "text");
			gapMarkers(b, extent, anchors, present, left, look, paneTexts);
			return;
		}
		const limits = seriesLimitsOf(pane);
		// Large values only for a pane with enough readings to draw; an empty
		// pane says what it needs across the whole pane, as before.
		const shown = Math.min(paneInput.series.length, limits.max);
		const readout = pane.series.length > 0 && shown >= limits.min && !ownsLayout(pane.style) ? pane.readout : undefined;
		const graphExt = graphExtent(readout, extent);
		const trendBuckets = onlyTrendBuckets(extent, shown, bucketPx);
		const plot: PanePlot = readout === "only" ? { x0: extent.x0, x1: extent.x0 + bucketPx * trendBuckets, bucketPx, buckets: trendBuckets } : plotFor(pane.style, graphExt, bucketPx);
		const graphAnchors = readout === "left" ? presentAnchors(graphExt, present) : anchors;
		const viewMs = paneInput.series.find((s) => s.history !== undefined)?.history?.windowMs;
		// Beside large values the graph needs no value or names row of its own.
		const viewPane: StripPaneV1 = readout === "left" ? { ...pane, overlays: { ...pane.overlays, current: false, legend: false } } : pane;
		const at = graphAnchors ?? anchors;
		const frame: PaneFrame = { index, pane: viewPane, input: paneInput, extent, plot, window, windowMs: viewMs !== undefined && viewMs > 0 ? viewMs : WINDOW_MS[window], gapMode: config.gapMode, left: at.left, right: at.right };
		const draws = drawsOf(pane, paneInput, plot, look, config.fahrenheit, config.gapMode, b.scratch);
		if (pane.series.length === 0 || draws.length === 0) {
			b.emptyPane(frame, t("strip.chooseReadings"));
		} else if (draws.length < limits.min) {
			b.emptyPane(frame, pane.style === "lanes" ? t("strip.lanesNeedSecond") : t("strip.compareNeedSecond"));
		} else {
			if (readout === "left") {
				const slot = readoutExtent(readout, extent) as PaneExtent;
				if (present[Math.floor(slot.x0 / SLICE_W)] !== false) b.readoutLeft({ ...frame, pane }, draws, slot);
			} else if (readout === "only") {
				b.readoutOnly(frame, draws, extent, present);
			}
			if (readout === "only" || graphAnchors === null) {
				// No graph: values only, or every graph slot is missing.
			} else if (pane.style === "lanes") {
				b.lanesStyle(frame, draws);
			} else if (pane.style === "heat") {
				b.heatStyle(frame, draws);
			} else if (pane.style === "meters") {
				if (pane.meterLook === undefined) metersStyle(b, frame, draws, present);
				else fillStyle(b, frame, draws, present, pane.meterLook);
			} else if (pane.style === "events") {
				eventsStyle(b, frame, draws);
			} else {
				b.lineStyle(frame, draws);
			}
		}
		const paneTexts = b.prims.slice(paneStart).filter((p): p is TextPrim => p.k === "text");
		gapMarkers(b, extent, anchors, present, left, look, paneTexts);
	});
	if (input.screens !== undefined && input.screens.count >= 2 && config.layout === "whole") screenLine(b, input.screens, width, config.panes[0], input.alertColors.crit);
	return { width, encoders, bucketPx, generation: input.generation ?? 0, paints: [...b.paints.values()].join(""), ring: look.ring, edge: look.rows.edge, prims: b.prims, present, scales, ...(b.localPaints.size === 0 ? {} : { localPaints: [...b.localPaints].map(([id, def]) => ({ id, def })) }) };
}

/** The position line: rows 0 to 2, 8 px between segments, the screen on
 * view at full ink, the rest at 45 %, a 4 px band of 70 % black under it
 * where nothing else backs it, and a dash of 8 on, 4 off. */
export const SCREEN_LINE = { height: 3, gap: 8, dim: 0.45, backing: 0.7, dash: 8, dashGap: 4 } as const;

/**
 * Strip Screens: the position line across the whole strip, one segment
 * per screen in order, the one on view in the text ink and the others at
 * 45 % of it. A hidden screen that holds a reading past its critical limit
 * is dashed in the critical color (color plus shape). On a look without a
 * panel (Clear, Outline, Stars, Nebula) a band of 70 % black backs the
 * line, under every mark; over Ambient Aurora, which draws in those rows,
 * the band draws over its light. The segments draw above the top row's
 * words and their edge (the over layer), so no edge dims them. Position and
 * luminance carry the line, no
 * hue, and it holds no digit, so a seam never splits anything it says.
 */
function screenLine(b: SceneBuilder, screens: NonNullable<StripSceneInput["screens"]>, width: number, pane: StripPaneV1, crit: string): void {
	const { height, gap, dim, backing, dash, dashGap } = SCREEN_LINE;
	const look = b.look;
	const panelled = look.background === "theme" || look.background === "glass" || look.background === "tint";
	const ambient = pane.style === "ambient";
	// Plain fill opacity, not a paint definition: the line rides in every
	// slice of a strip that may already sit near the payload bound.
	if (!panelled || ambient) b.rect(ambient ? "marks" : "base", 0, 0, width, height + 1, `fill="#000000" fill-opacity="${backing}"`);
	const ink = look.text.label;
	const n = screens.count;
	for (let i = 0; i < n; i++) {
		const x0 = Math.round((i * (width + gap)) / n);
		const x1 = Math.round(((i + 1) * (width + gap)) / n - gap);
		if (i !== screens.at && screens.alerts[i] === true) {
			const xs: number[] = [];
			for (let x = x0; x + dash <= x1; x += dash + dashGap) xs.push(x);
			b.prims.push({ k: "marks", layer: "over", xs, w: dash, y: 0, h: height, paint: `fill="${crit}"` });
		} else {
			b.rect("over", x0, 0, x1 - x0, height, i === screens.at ? `fill="${ink}"` : `fill="${ink}" fill-opacity="${dim}"`);
		}
	}
}

/** A row's edge its band hangs from (top) or stands on (bottom), and the
 * band of y the centers of that row's words fall in. */
export type RowAnchor = { readonly edge: "top" | "bottom"; readonly y: number; readonly from: number; readonly to: number };
/** The strip's top row and bottom row. */
const ROW_EDGES: readonly RowAnchor[] = [
	{ edge: "top", y: 0, from: 0, to: 50 },
	{ edge: "bottom", y: 100, from: 50, to: 101 }
];

/** One unit's band of a line pane (lineStyle): its readings, its place and
 * its own scale. */
type UnitBand = { readonly unit: string; readonly draws: readonly SeriesDraw[]; readonly top: number; readonly bottom: number; readonly map: YMap | null; readonly scale: DrawnScale | null };

/** Between two unit bands: a hairline in the middle of this gap. */
const BAND_GAP = 4;

/** `n` unit bands of equal height over the plot, top to bottom, on whole
 * pixels. */
export function unitBands(n: number): { readonly top: number; readonly bottom: number }[] {
	const h = (PLOT_BOTTOM - PLOT_TOP - BAND_GAP * (n - 1)) / n;
	return Array.from({ length: n }, (_, i) => ({ top: Math.round(PLOT_TOP + i * (h + BAND_GAP)), bottom: Math.round(PLOT_TOP + i * (h + BAND_GAP) + h) }));
}

/** PAUSED's size on a pane (SceneBuilder.badge). */
function pausedBadgeSize(f: Pick<PaneFrame, "left" | "right">): number {
	return f.right - f.left <= SLICE_W ? ONLY_BADGE.size : BADGE_SIZE;
}

/** The x a pane's scale ends start at (scaleEnds). */
function endColumn(f: Pick<PaneFrame, "plot" | "left">): number {
	return Math.max(f.plot.x0, f.left) + 3;
}

/** A band too short for its ends on two rows: they join in one text. */
function endsJoined(b: { readonly top: number; readonly bottom: number }): boolean {
	return b.bottom - b.top < 2 * SMALL_SIZE + 3;
}

/** The baseline of a band's top end, just under its top edge. */
function endHiBaseline(b: { readonly top: number }): number {
	return b.top + Math.ceil(TEXT_ASCENT * SMALL_SIZE) + 1;
}

/** The baseline of a band's bottom end, just over its bottom edge. */
function endLoBaseline(b: { readonly bottom: number }): number {
	return b.bottom - 1;
}

/** Where a line pane's row bands hang and stand: the strip's top row and
 * bottom row, and between two unit bands the scale ends either side of
 * the hairline (the end above stands on it, the end below hangs from it). */
function bandAnchors(bands: readonly { readonly top: number; readonly bottom: number }[]): RowAnchor[] {
	if (bands.length <= 1) return [...ROW_EDGES];
	const out: RowAnchor[] = [];
	bands.forEach((b, i) => {
		const first = i === 0;
		const last = i === bands.length - 1;
		const from = first ? 0 : ((bands[i - 1] as { bottom: number }).bottom + b.top) / 2;
		const to = last ? 101 : (b.bottom + (bands[i + 1] as { top: number }).top) / 2;
		// Words above the split hang from the band's top (the strip's, for
		// the first band), words below stand on its bottom (the strip's, for
		// the last). A short band's one scale label sits at its middle and
		// hangs from its top; the top row is the first band's, the bottom
		// row the last band's.
		let split = (b.top + b.bottom) / 2 + (b.bottom - b.top < 2 * SMALL_SIZE + 3 ? 2.5 : 0);
		if (first) split = Math.max(split, Math.min(to, TOP_BASELINE + 4));
		if (last) split = Math.min(split, Math.max(from, BOTTOM_BASELINE - 10));
		out.push({ edge: "top", y: first ? 0 : b.top, from, to: split });
		out.push({ edge: "bottom", y: last ? 100 : b.bottom, from: split, to });
	});
	return out;
}

/** Lanes: each lane's header hangs its band from the lane's top, and the
 * bottom row stands on the strip's bottom edge. */
function laneAnchors(n: number): RowAnchor[] {
	const h = laneHeight(n);
	const out: RowAnchor[] = Array.from({ length: n }, (_, i) => ({ edge: "top" as const, y: LANES_TOP + i * h, from: i === 0 ? 0 : LANES_TOP + i * h, to: LANES_TOP + i * h + h / 2 }));
	out.push({ edge: "bottom", y: 100, from: LANES_TOP + (n - 1) * h + h / 2, to: 101 });
	return out;
}

/**
 * The row words' edge: Outline's filter (haloFilterDefsAt) under an id of
 * its own, so Outline and Tint keep theirs for the marks. It wraps every
 * word, chip and swatch the rows draw over the plot, on every look, above
 * the marks: one filter pass over a region only as tall as the rows'
 * words need (rowsFilterBand), no copy of a word and no stroke (QtSvg
 * strokes a text outline as a path, without its glyph cache).
 */
export const ROWS_FILTER = "o";
/** Pixel rows the row filter keeps past the words' measured ink: the
 * edge's 1 px, and room for a glyph that inks past the estimate. */
const ROWS_FILTER_MARGIN = 3;
/** The face fonts' whole line box in em (Segoe UI's 1.08 above and 0.25
 * below the baseline cover Tahoma's 1.00 and 0.21): textInkBox's estimate
 * knows the ASCII glyphs only, and a letter outside them (Å, Ç, Cyrillic
 * descenders, a fallback font's glyphs) can ink past it. QtSvg draws
 * nothing of a filtered group outside the filter's region. */
const LINE_ASCENT = 1.08;
const LINE_DESCENT = 0.26;
// eslint-disable-next-line no-control-regex
const BEYOND_ASCII = /[^\u0000-\u007f]/;
/** The units' and separators' own symbols stay inside the ASCII estimate
 * (µ is one of its descenders), so a °C or a "·" keeps the tight band. */
const WITHIN_ESTIMATE = /[°·…µ±×²³Δ−–]/g;

/** The rows of y the row filter covers for these primitives (the rows
 * layer's): their ink, ROWS_FILTER_MARGIN past it each way, in whole
 * pixels inside the strip's 100; null when they hold no row word. A word
 * with a letter beyond ASCII takes the font's whole line box instead. */
export function rowsFilterBand(prims: readonly Prim[]): { readonly top: number; readonly height: number } | null {
	let y0 = Number.POSITIVE_INFINITY;
	let y1 = Number.NEGATIVE_INFINITY;
	const wordBox = (p: Pick<TextPrim, "x" | "y" | "anchor" | "size" | "weight" | "text">): { y0: number; y1: number } => (BEYOND_ASCII.test(p.text.replace(WITHIN_ESTIMATE, "")) ? { y0: p.y - LINE_ASCENT * p.size, y1: p.y + LINE_DESCENT * p.size } : textInkBox(p));
	for (const p of prims) {
		if (p.layer !== "rows") continue;
		const boxes = p.k === "text" ? [wordBox(p)] : p.k === "words" ? p.words.map((w) => wordBox({ ...w, weight: p.weight })) : p.k === "rect" ? [{ y0: p.y, y1: p.y + p.h }] : [{ y0: 0, y1: 100 }];
		for (const box of boxes) {
			y0 = Math.min(y0, box.y0);
			y1 = Math.max(y1, box.y1);
		}
	}
	if (!(y1 > y0)) return null;
	const top = Math.max(0, Math.floor(y0) - ROWS_FILTER_MARGIN);
	return { top, height: Math.min(100, Math.ceil(y1) + ROWS_FILTER_MARGIN) - top };
}

/** A frame region's row words as written: their primitives and the band
 * their edge covers. */
export type RowsPart = { readonly svg: readonly string[]; readonly band: { readonly top: number; readonly height: number } | null };

/** The SVG of a frame region: header, paints, the edge filter, base
 * primitives, then marks (inside the edge group on Outline and Tint), then
 * the row words in their own edge (ROWS_FILTER), then `over` (the Strip
 * Screens position line). */
export function writeFrame(scene: LogicalScene, base: readonly string[], marks: readonly string[], width: number, filterX: number, filterW: number, rows: RowsPart = { svg: [], band: null }, over: readonly string[] = []): string {
	const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 100" width="${width}" height="100">`];
	if (scene.paints !== "") parts.push(`<defs>${scene.paints}</defs>`);
	if (scene.ring !== null) parts.push(haloFilterDefsAt(scene.ring, filterX, 0, filterW, 100));
	parts.push(...base);
	if (scene.ring !== null && marks.length > 0) parts.push(HALO_GROUP, ...marks, "</g>");
	else parts.push(...marks);
	if (rows.svg.length > 0 && rows.band !== null) parts.push(haloFilterDefsAt(scene.edge, filterX, rows.band.top, filterW, rows.band.height, ROWS_FILTER), `<g filter="url(#${ROWS_FILTER})">`, ...rows.svg, "</g>");
	parts.push(...over, "</svg>");
	return parts.join("");
}

/** The row words of `prims` as written at an x offset, with their band. */
export function rowsPart(prims: readonly Prim[], dx = 0): RowsPart {
	const rows = prims.filter((p) => p.layer === "rows");
	return { svg: rows.map((p) => emitPrim(p, dx)).filter((s) => s !== ""), band: rowsFilterBand(rows) };
}

/** The full-width reference frame (what the stitched slices must equal). */
export function renderLogical(scene: LogicalScene): string {
	const base = scene.prims.filter((p) => p.layer === "base").map((p) => emitPrim(p, 0));
	const marks = scene.prims.filter((p) => p.layer === "marks").map((p) => emitPrim(p, 0));
	const over = scene.prims.filter((p) => p.layer === "over").map((p) => emitPrim(p, 0));
	const local = scene.localPaints === undefined ? "" : scene.localPaints.map((p) => p.def).join("");
	return writeFrame(local === "" ? scene : { ...scene, paints: scene.paints + local }, base, marks, scene.width, -3, scene.width + 6, rowsPart(scene.prims), over);
}

/**
 * One band limit as text. A data unit's limit is HWiNFO's number in the
 * reading's own unit, so it reads in the same tier language as the value
 * beside it, its unit attached ("12.1GB", where the generic ladder drew
 * "12.1k" before "MB": a magnitude suffix stacked on a unit prefix). Every
 * other limit is the plain number, its unit written apart (the limit is
 * already in the displayed unit, so it is never converted again here).
 */
function bandNumber(value: number, unit: string, measure: MeasureOptions): string {
	return isDataUnit(unit) ? formatStat(value, unit, measure) : formatValue(value, measure.decimals);
}

/** The measure the strip's limits of one reading print with: the strip's
 * Decimals, °F and Data units, and the reading's own unit and decimals
 * when `formats` (the strip's readingFormats) holds them (issue #59). */
function limitMeasure(measure: { readonly fahrenheit: boolean; readonly decimals: MeasureOptions["decimals"]; readonly dataUnits?: DataUnitsPref }, formats: unknown, key: string, unit: string): MeasureOptions {
	const base: MeasureOptions = { decimals: measure.decimals, fahrenheit: measure.fahrenheit, dataUnits: measure.dataUnits ?? "decimal" };
	return formats === undefined ? base : measureFor(base, formats, { key, unit });
}

/**
 * Reading-scoped bands for one pane from its config, in display units,
 * labelled with the reading's name whenever the graph carries more than one
 * reading or no legend names it. A band whose typed unit no longer matches
 * its reading is left out.
 */
export function stripBandsFor(pane: StripPaneV1, series: readonly StripSeriesInput[], measure: { readonly fahrenheit: boolean; readonly decimals: MeasureOptions["decimals"]; readonly dataUnits?: DataUnitsPref }, formats?: unknown): AlertBand[] {
	if (pane.style === "group") return groupBandsFor(pane, series, measure, formats);
	// Ambient draws no limits: nothing on it is read off a scale.
	if (pane.style === "ambient") return [];
	const out: AlertBand[] = [];
	// Lanes draw each band inside its own lane, under a header that names it.
	const named = pane.style !== "lanes" && (drawnSeries(pane).length > 1 || !pane.overlays.legend);
	for (const band of pane.bands) {
		const s = series.find((x) => x.key === band.key);
		if (s === undefined || s.state === "missing") continue;
		const unit = drawnUnitOf(s);
		const limits = stampedLimits(band, unit, measure.fahrenheit);
		if (limits === null) continue;
		const displayUnit = convertUnit(0, unit, measure.fahrenheit).unit;
		const data = isDataUnit(unit);
		const own = limitMeasure(measure, formats, s.key, unit);
		const label = (level: "warn" | "crit", value: number): string => `${named ? `${s.name || s.key} ` : ""}${level} ${bandNumber(value, unit, own)}${data || displayUnit === "" ? "" : ` ${displayUnit}`}`;
		const { warn, crit } = limits;
		if (!band.below) {
			if (warn !== undefined && (crit === undefined || warn < crit)) out.push({ level: "warn", from: warn, to: crit ?? Number.POSITIVE_INFINITY, readingKey: band.key, label: label("warn", warn), source: "strip" });
			if (crit !== undefined) out.push({ level: "crit", from: crit, to: Number.POSITIVE_INFINITY, readingKey: band.key, label: label("crit", crit), source: "strip" });
		} else {
			if (crit !== undefined) out.push({ level: "crit", from: Number.NEGATIVE_INFINITY, to: crit, readingKey: band.key, label: label("crit", crit), source: "strip" });
			if (warn !== undefined && (crit === undefined || warn > crit)) out.push({ level: "warn", from: crit ?? Number.NEGATIVE_INFINITY, to: warn, readingKey: band.key, label: label("warn", warn), source: "strip" });
		}
	}
	return out;
}

/**
 * A Group pane's limits as bands, one set per drawn reading (every reading
 * of the group shares them), in display units and unnamed: the bottom row
 * names them once. Limits typed for another unit than a reading's are not
 * applied to it.
 */
function groupBandsFor(pane: StripPaneV1, series: readonly StripSeriesInput[], measure: { readonly fahrenheit: boolean; readonly decimals: MeasureOptions["decimals"]; readonly dataUnits?: DataUnitsPref }, formats?: unknown): AlertBand[] {
	const limits = pane.group?.limits;
	if (limits === undefined) return [];
	const out: AlertBand[] = [];
	for (const s of series) {
		if (s.state === "missing") continue;
		const unit = drawnUnitOf(s);
		const shown = stampedLimits(limits, unit, measure.fahrenheit);
		if (shown === null) continue;
		const displayUnit = convertUnit(0, unit, measure.fahrenheit).unit;
		const own = limitMeasure(measure, formats, s.key, unit);
		const label = (level: "warn" | "crit", value: number): string => `${level} ${bandNumber(value, unit, own)}${isDataUnit(unit) || displayUnit === "" ? "" : ` ${displayUnit}`}`;
		const { warn, crit } = shown;
		if (!limits.below) {
			if (warn !== undefined && (crit === undefined || warn < crit)) out.push({ level: "warn", from: warn, to: crit ?? Number.POSITIVE_INFINITY, readingKey: s.key, label: label("warn", warn), source: "strip" });
			if (crit !== undefined) out.push({ level: "crit", from: crit, to: Number.POSITIVE_INFINITY, readingKey: s.key, label: label("crit", crit), source: "strip" });
		} else {
			if (crit !== undefined) out.push({ level: "crit", from: Number.NEGATIVE_INFINITY, to: crit, readingKey: s.key, label: label("crit", crit), source: "strip" });
			if (warn !== undefined && (crit === undefined || warn > crit)) out.push({ level: "warn", from: crit ?? Number.NEGATIVE_INFINITY, to: warn, readingKey: s.key, label: label("warn", warn), source: "strip" });
		}
	}
	return out;
}

/** History is asked for at the plot's own bucket count (the scene re-bins
 * whatever width it gets, but this avoids a second pass). A Tiles pane
 * asks at its tiles' time grid when it is given their `grid` (src/strip/
 * tiles.ts tileGridFor), so its buckets hold the same samples frame after
 * frame. */
export function historyWidthFor(config: StripConfigV1, encoders: StripEncoders, paneIndex: number, bucketPx: BucketPx = DEFAULT_BUCKET_PX, grid?: readonly number[]): number {
	const pane = config.panes[paneIndex === 1 ? 1 : 0];
	const extent = paneExtents(config.layout, encoders)[paneIndex];
	if (extent === undefined) return 0;
	if (pane.style === "group" && grid !== undefined && grid.length > 0 && groupRuleOf(pane).view === "tiles") return groupPlotOf(pane, extent, "tiles", bucketPx, grid).buckets;
	// A Group pane asks at its line grid's width; heat rows re-bin from it.
	if (pane.style === "group") return groupPlotOf(pane, extent, "spread", bucketPx).buckets;
	// Ambient asks at its cell count.
	if (pane.style === "ambient") return ambientPlotOf(extent, paneWindowOf(config, paneIndex), bucketPx).buckets;
	// Values only: each value's trend.
	if (isValuesOnly(pane)) return onlyTrendBuckets(extent, drawnSeries(pane).length, bucketPx);
	return panePlotOf(pane, extent, bucketPx).buckets;
}

/** The native values a unit's number usually reaches, on view: what its
 * digits are sized for (SceneBuilder.setupSizing). A value past them steps
 * down on its own. */
function usualReach(displayUnit: string): readonly number[] {
	const u = displayUnit.trim();
	if (u === YES_NO_UNIT) return [0, 1];
	if (u === "%" || u === "°C" || u === "°F" || u === "Δ°C" || u === "Δ°F") return [99.9, 100];
	if (/^(RPM|MHz)$/i.test(u)) return [9999];
	return [99.9, 999];
}

/** The right edge time the controller asks history for: the newest bucket's
 * end, aligned to whole buckets of monotonic time, so a frame scrolls by
 * whole buckets and a slice with nothing new dedupes. */
export function alignedNow(now: number, windowMs: number, buckets: number): number {
	if (buckets <= 0) return now;
	const bucketMs = windowMs / buckets;
	return Math.ceil(now / bucketMs) * bucketMs;
}

/** An explained 200 x 100 face for a slot that cannot draw its slice (a
 * mismatched or unsupported deck, a dial outside the strip): the dial's own
 * look, two short lines. */
export function stripMessageFace(lines: readonly string[], look: { readonly background: DialBackground; readonly palette: Palette; readonly text: TextSettings; readonly accent: boolean }): string {
	const background = lookOn(look.background, look.palette);
	const traits = dialBackgroundTraits(background);
	const text = dialTextColors(background, look.palette, look.text, look.accent);
	const parts = traits.halo ? [...dialFaceOpen(background, look.palette), HALO_GROUP] : dialFaceOpen(background, look.palette);
	const shown = lines.slice(0, 3);
	const top = 50 - ((shown.length - 1) * 18) / 2 + 5;
	shown.forEach((line, i) => {
		const fitted = fitText(line, 13, 600, 188);
		parts.push(`<text x="100" y="${top + i * 18}" text-anchor="middle" font-family="${fontFamily()}" font-size="13" font-weight="600" fill="${i === 0 ? text.label : text.unit}">${escapeXml(fitted)}</text>`);
	});
	parts.push(traits.halo ? HALO_CLOSE : "</svg>");
	return parts.join("");
}
