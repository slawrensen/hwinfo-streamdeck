/**
 * The strip's value scales, as pure functions: one rule for every graph
 * that draws a value scale (Trend, Area, Compare, Lanes, Heat, Meters and
 * Group; Ambient keeps its own quiet span).
 *
 * - Kinds. A Yes/No reading is 0 to 1, always. A percentage is 0 to 100,
 *   wider only while a reading is past it. A unit with a true zero (power,
 *   current, fan speed, frame rate and time, data) starts at 0 with its
 *   highest reading at most ZERO_HEADROOM of the way up, so a steady line
 *   sits mid-graph instead of under the names. Everything else (°C, V,
 *   MHz, no unit) floats on round ends near its readings, never under 0
 *   for readings at or above 0.
 * - Calm. An automatic scale spans at least the unit's calm span
 *   (CALM_SPAN, or 2 % of the reading), so idle noise draws as noise.
 * - Data in the printed unit. A data scale is chosen in the tier the strip
 *   prints (kbps, Mbps under Decimal; KiB/s, MiB/s under Binary), one
 *   tier per scale.
 * - The hold (nextHeldScale). A scale grows at once when a reading leaves
 *   it and narrows in one step once its target has fit in half of it for
 *   SCALE_NARROW_HOLD_MS. One hold for the whole strip.
 * - Typed ends (resolvedScale) are kept exactly and printed as typed
 *   (endText). Stamped with the unit they were typed in (the 1.8 key
 *   grammar), they reach every reading in that unit, converted across
 *   °C and °F; an unstamped scale keeps the reach it had before the stamp
 *   until it is edited.
 * - The dial (stepSpan). A pressed turn on a graph of one reading steps
 *   the span on 1, 2, 5 rungs, clockwise wider; the span on screen when
 *   the turn began is a stop, and landing on it ends the turn.
 *
 * Every value here is native unless it says view units: the unit on view
 * (°F when the strip shows °F), or for data the family's base (bits or
 * bytes per second, bytes), whose tier is chosen per scale.
 */
import { QUIET_SPAN } from "./ambient";
import { valueTicks, type ValueTicks } from "./axes";
import { ratioUnit } from "./group";
import { toNative, type Extent } from "./graph";
import { startsAtZero, YES_NO_UNIT } from "./patterned";
import type { StripPaneV1 } from "./settings";
import { convertUnit, fixed, inkEdges, valueBetweenUnits } from "../ui/format";
import { dataBaseOf, fixedUnitScale, isDataUnit, parseDataUnit, type DataUnitsPref, type FixedDataUnit } from "../ui/measure";

// ---- kinds -----------------------------------------------------------------------

export type ScaleKind = "yesno" | "percent" | "zero" | "float";

/** Units whose scale starts at zero: the true-zero units without the
 * clocks, and Group Now's ratio units. A clock floats, as Group Now draws
 * it. */
export function scaleStartsAtZero(unit: string): boolean {
	const u = unit.trim();
	return (startsAtZero(u) && !/^(MHz|GHz)$/i.test(u)) || ratioUnit(u);
}

export function scaleKindOf(unit: string): ScaleKind {
	const u = unit.trim();
	if (u === YES_NO_UNIT) return "yesno";
	if (u === "%") return "percent";
	return scaleStartsAtZero(u) ? "zero" : "float";
}

/** The least span an automatic scale draws, per native unit (view units
 * after the °F conversion); any other unit takes 2 % of its reading. The
 * values Ambient's quiet span uses, and a few units it has no row for. */
export const CALM_SPAN: Readonly<Record<string, number>> = { ...QUIET_SPAN, GHz: 0.2, mV: 50, FPS: 10, ms: 10, "Δ°C": 5, "Δ°F": 9 };

/** A zero kind's highest reading sits at most this far up its scale. */
export const ZERO_HEADROOM = 0.7;

/** How long an automatic scale's target must fit in half of it before it
 * narrows (in one step). */
export const SCALE_NARROW_HOLD_MS = 10_000;

const EPS = 1e-9;
/** Tick steps (axes.ts MANTISSAS) and the dial's rungs. */
const LADDER = [1, 2, 2.5, 5] as const;
const RUNG = [1, 2, 5] as const;

const tidy = (v: number): number => Number(v.toPrecision(12));

/** The first step of `m` times a power of ten at or above v. */
function up(v: number, m: readonly number[]): number {
	const p = Math.floor(Math.log10(v));
	for (let k = p - 1; k <= p + 1; k++) for (const x of m) if (x * 10 ** k >= v * (1 - EPS)) return tidy(x * 10 ** k);
	return v;
}

/** The dial's rungs (1, 2, 5 times a power of ten) from `from` to `to`. */
function rungs(from: number, to: number): number[] {
	const out: number[] = [];
	for (let k = Math.floor(Math.log10(from)) - 1; k <= Math.ceil(Math.log10(to)) + 1; k++) for (const x of RUNG) out.push(tidy(x * 10 ** k));
	return out.filter((r) => r >= from * (1 - EPS) && r <= to * (1 + EPS));
}

// ---- the view unit ------------------------------------------------------------------

/** A data unit's printed family: its tiers, their base, how many base units
 * one native unit is, and the least scale (Decimal rates 100 kbps, Binary
 * rates 10 KiB/s, sizes 1 MB or 1 MiB). */
type DataFamily = { readonly tiers: readonly string[]; readonly base: number; readonly perNative: number; readonly floor: number };

const DECIMAL_BYTES = ["B", "KB", "MB", "GB", "TB"] as const;
const BINARY_BYTES = ["B", "KiB", "MiB", "GiB", "TiB"] as const;
const DECIMAL_BIT_RATES = ["bps", "kbps", "Mbps", "Gbps", "Tbps"] as const;
const BINARY_BYTE_RATES = ["B/s", "KiB/s", "MiB/s", "GiB/s", "TiB/s"] as const;

function dataFamilyOf(unit: string, pref: DataUnitsPref): DataFamily | null {
	const data = parseDataUnit(unit);
	if (data === null) return null;
	// Binary reads HWiNFO's KB to TB as 1024-based, as the values print them.
	if (data.kind === "bytes") return pref === "binary" ? { tiers: BINARY_BYTES, base: 1024, perNative: dataBaseOf(unit, data, pref), floor: 1024 ** 2 } : { tiers: DECIMAL_BYTES, base: 1000, perNative: data.toBase, floor: 1e6 };
	if (pref === "binary") return { tiers: BINARY_BYTE_RATES, base: 1024, perNative: data.kind === "bitRate" ? data.toBase / 8 : data.toBase, floor: 10 * 1024 };
	return { tiers: DECIMAL_BIT_RATES, base: 1000, perNative: data.kind === "byteRate" ? data.toBase * 8 : data.toBase, floor: 1e5 };
}

/** How a scale of one native unit is chosen and printed. */
export type ScaleView = {
	readonly unit: string;
	readonly fahrenheit: boolean;
	/** The unit the strip shows (°F for a °C reading under °F); a data
	 * unit's family base ("bps", "B/s", "B"). */
	readonly shown: string;
	readonly data: DataFamily | null;
};

/** A data family of one tier, a reading's own fixed unit (issue #59): the
 * scale is HWiNFO's number in that unit, its ends and ticks print in it,
 * and its least span is the family's (1 MB or 1 MiB) in it. */
function fixedFamilyOf(unit: string, fixedUnit: FixedDataUnit): DataFamily | null {
	const perNative = fixedUnitScale(unit, fixedUnit);
	const perByte = fixedUnitScale("B", fixedUnit);
	if (perNative === null || perByte === null) return null;
	const binary = fixedUnit.includes("i");
	return { tiers: [fixedUnit], base: binary ? 1024 : 1000, perNative, floor: (binary ? 1024 ** 2 : 1e6) * perByte };
}

/** How a scale of readings in one native unit is chosen and printed: the
 * tiers the deck's Data units print, or, for readings that print in one
 * fixed unit (`fixedUnit`, a byte amount's own format), that unit alone. */
export function scaleView(unit: string, measure: { readonly fahrenheit: boolean; readonly dataUnits?: DataUnitsPref }, fixedUnit?: FixedDataUnit): ScaleView {
	const fixed = fixedUnit === undefined ? null : fixedFamilyOf(unit, fixedUnit);
	const data = fixed ?? dataFamilyOf(unit, measure.dataUnits ?? "decimal");
	return { unit, fahrenheit: measure.fahrenheit, shown: data === null ? convertUnit(0, unit, measure.fahrenheit).unit : (data.tiers[0] as string), data };
}

/** A native value in view units. */
export function toView(view: ScaleView, native: number): number {
	return view.data === null ? convertUnit(native, view.unit, view.fahrenheit).value : native * view.data.perNative;
}

/** A view value back in native units. */
export function fromView(view: ScaleView, value: number): number {
	return view.data === null ? toNative(value, view.unit, view.fahrenheit) : value / view.data.perNative;
}

/** One tier of a data family (factor 1 and the shown unit for any other). */
export type ScaleTier = { readonly factor: number; readonly word: string; readonly index: number };

/** The largest tier whose unit is at or under `top` (view units). */
export function tierOf(view: ScaleView, top: number): ScaleTier {
	if (view.data === null) return { factor: 1, word: view.shown, index: 0 };
	const { tiers, base } = view.data;
	let k = 0;
	while (k < tiers.length - 1 && Math.abs(top) >= base ** (k + 1) * (1 - EPS)) k++;
	return { factor: base ** k, word: tiers[k] as string, index: k };
}

/** The calm span in a tier's units: the unit's table value in the view
 * unit (or a data floor), at least 2 % of the reading, up the tick ladder
 * (5 °C shown in °F is 10 °F, the +12 V rail's 0.24 V is 0.25 V). */
function calmAt(view: ScaleView, factor: number, lo: number, hi: number): number {
	const table = view.data !== null ? view.data.floor : (CALM_SPAN[view.unit] ?? 0) * (view.fahrenheit && (view.unit === "°C" || view.unit === "Δ°C") ? 1.8 : 1);
	return up(Math.max(table / factor, 0.02 * Math.max(Math.abs(lo), Math.abs(hi)), EPS), LADDER);
}

/** The calm span of a scale whose readings run lo to hi (view units). */
export function calmSpan(view: ScaleView, lo: number, hi: number): number {
	return calmAt(view, 1, lo, hi);
}

// ---- the target ------------------------------------------------------------------------

export type ScaleAsk = {
	/** What the scale must hold now (native): the readings' window extents
	 * and current values, and on Meters and Group Now their limits. */
	readonly need: Extent;
	readonly view: ScaleView;
	readonly kind: ScaleKind;
	readonly maxTicks: number;
	/** Typed ends that apply (native), kept exactly. */
	readonly kept?: { readonly lo?: number; readonly hi?: number };
	/** The dial's turned span (view units). */
	readonly span?: number;
	/** Meters' own rule: from zero (or under a negative reading) to a round
	 * top, 100 for a percentage, no headroom. */
	readonly meter?: true;
};

type Ext = { lo: number; hi: number };

function ticksOf(a: number, b: number, n: number, keep: { readonly lo?: boolean; readonly hi?: boolean } = {}): Ext | null {
	const t = valueTicks(a, b, n, keep);
	return t === null ? null : { lo: t.lo, hi: t.hi };
}

/** An exact span on round ends near the middle of a..b, holding it; for
 * readings at or above 0 never under 0, and on 0 when it is a quarter of
 * the span away or less and 0..span holds the readings. Finer steps when no
 * round position holds them; null when none does. */
function place(span: number, a: number, b: number, nonneg: boolean, maxTicks: number): Ext | null {
	const first = valueTicks(0, span, maxTicks);
	if (first === null) return null;
	for (const div of [1, 2, 2.5, 4, 5, 10]) {
		const step = first.step / div;
		let lo = Math.round(((a + b) / 2 - span / 2) / step) * step;
		if (nonneg && lo < 0) lo = 0;
		if (nonneg && lo > 0 && lo <= span / 4 + EPS && span >= b - EPS) lo = 0;
		for (let i = 0; i < 3 && lo > a + EPS; i++) lo -= step;
		for (let i = 0; i < 3 && lo + span < b - EPS; i++) lo += step;
		if (nonneg && lo < 0) lo = 0;
		if (lo <= a + EPS && lo + span >= b - EPS) return { lo: tidy(lo), hi: tidy(lo + span) };
	}
	return null;
}

/** The target in a tier's units (a..b the need, F the calm span). */
function targetIn(kind: ScaleKind, a: number, b: number, n: number, F: number, span: number | undefined, kept: { lo?: number; hi?: number }, meter: boolean): Ext {
	const L = kept.lo;
	const H = kept.hi;
	if (L !== undefined && H !== undefined) return { lo: L, hi: H };
	if (kind === "yesno") return { lo: 0, hi: 1 };
	if (meter) {
		const lo0 = L ?? Math.min(0, a);
		let hi0 = H ?? Math.max(0, b);
		if (H === undefined && kind === "percent" && hi0 <= 100 && lo0 >= 0) hi0 = 100;
		if (!(hi0 > lo0)) hi0 = lo0 + (lo0 === 0 ? 1 : Math.abs(lo0));
		return ticksOf(lo0, hi0, n, { lo: L !== undefined || lo0 === 0, hi: H !== undefined || hi0 === 100 }) ?? { lo: lo0, hi: hi0 };
	}
	if (kind === "percent") {
		if (L !== undefined) {
			const top = Math.max(100, b, L + F);
			return { lo: L, hi: ticksOf(L, top, n, { lo: true, hi: top === 100 })?.hi ?? top };
		}
		if (H !== undefined) {
			const bottom = Math.min(0, a, H - F);
			return { lo: ticksOf(bottom, H, n, { lo: bottom === 0, hi: true })?.lo ?? bottom, hi: H };
		}
		const lo0 = Math.min(0, a);
		const hi0 = Math.max(100, b);
		const dom = ticksOf(lo0, hi0, n, { lo: lo0 === 0, hi: hi0 === 100 }) ?? { lo: lo0, hi: hi0 };
		if (span !== undefined && span < dom.hi - dom.lo - EPS && b - a <= span + EPS) {
			const p = place(span, a, b, a >= 0, n) ?? { lo: a, hi: a + span };
			const lo = Math.min(Math.max(dom.lo, p.lo), dom.hi - span);
			return { lo: tidy(lo), hi: tidy(lo + span) };
		}
		return dom;
	}
	const zero = kind === "zero" && a >= -EPS;
	if (L !== undefined) {
		const top = Math.max(zero ? b / ZERO_HEADROOM : b, L + F);
		return { lo: L, hi: ticksOf(L, top, n, { lo: true })?.hi ?? top };
	}
	if (H !== undefined) {
		if (zero && H > 0) return { lo: 0, hi: H };
		const bottom = Math.min(a, H - F);
		return { lo: ticksOf(bottom, H, n, { hi: true })?.lo ?? bottom, hi: H };
	}
	if (zero && (span === undefined || span >= b - EPS)) {
		if (span !== undefined) return { lo: 0, hi: span };
		return { lo: 0, hi: ticksOf(0, Math.max(b / ZERO_HEADROOM, F), n, { lo: true })?.hi ?? Math.max(b / ZERO_HEADROOM, F) };
	}
	if (kind === "zero" && a < -EPS && span === undefined) {
		const t = ticksOf(Math.min(0, a), Math.max(0, b), n) ?? { lo: Math.min(0, a), hi: Math.max(0, b) };
		return t.hi - t.lo >= F - EPS ? t : (ticksOf(Math.min(0, a), Math.min(0, a) + F, n) ?? t);
	}
	const S = span ?? F;
	if (span === undefined && b - a >= S - EPS) return ticksOf(a, b, n) ?? { lo: a, hi: b };
	if (span !== undefined && b - a > span + EPS) return ticksOf(a, b, n) ?? { lo: a, hi: b };
	return place(S, a, b, a >= -EPS, n) ?? ticksOf(a, b, n) ?? { lo: a, hi: b + S };
}

/** Where an automatic scale wants to be now (native ends). */
export function autoTarget(ask: ScaleAsk): Extent {
	const { view } = ask;
	const a = toView(view, ask.need.lo);
	const b = toView(view, ask.need.hi);
	const keptLo = ask.kept?.lo === undefined ? undefined : toView(view, ask.kept.lo);
	const keptHi = ask.kept?.hi === undefined ? undefined : toView(view, ask.kept.hi);
	const data = view.data;
	let tier = data === null ? tierOf(view, 0) : tierOf(view, Math.max(b / ZERO_HEADROOM, data.floor, ask.span ?? 0, keptHi ?? 0, keptLo ?? 0));
	for (;;) {
		const f = tier.factor;
		const F = calmAt(view, f, a / f, b / f);
		const kept = { ...(keptLo === undefined ? {} : { lo: keptLo / f }), ...(keptHi === undefined ? {} : { hi: keptHi / f }) };
		const w = targetIn(ask.kind, a / f, b / f, ask.maxTicks, F, ask.span === undefined ? undefined : ask.span / f, kept, ask.meter === true);
		// A round top that reaches the next tier's base is redone one tier up.
		if (data !== null && tier.index < data.tiers.length - 1 && keptHi === undefined && w.hi >= data.base * (1 - EPS)) {
			const k = tier.index + 1;
			tier = { factor: data.base ** k, word: data.tiers[k] as string, index: k };
			continue;
		}
		return { lo: fromView(view, w.lo * f), hi: fromView(view, w.hi * f) };
	}
}

// ---- the hold ----------------------------------------------------------------------------

/** A held scale (native) and when its target first fit in half of it. */
export type HeldScale = { readonly lo: number; readonly hi: number; readonly since: number | null };

/**
 * The next held scale, judged once per data frame at time `at` (a repaint
 * for input passes the last data frame's time and the scale it held then).
 * No previous scale: the target at once. A reading outside it: grows at
 * once to the end the target of the union gives, the other side kept. A
 * target that fits in half of it (a percentage: back inside its domain)
 * continuously for SCALE_NARROW_HOLD_MS: the target, in one step. Both ends
 * typed: those ends, with no hold.
 */
export function nextHeldScale(prev: HeldScale | undefined, ask: ScaleAsk, at: number): HeldScale {
	const kept = ask.kept;
	if (kept?.lo !== undefined && kept.hi !== undefined) return { lo: kept.lo, hi: kept.hi, since: null };
	const target = autoTarget(ask);
	if (prev === undefined) return { lo: target.lo, hi: target.hi, since: null };
	const span = prev.hi - prev.lo;
	const eps = EPS * Math.max(1, Math.abs(prev.hi), Math.abs(prev.lo));
	const need = ask.need;
	if (need.lo < prev.lo - eps || need.hi > prev.hi + eps) {
		const grown = autoTarget({ ...ask, need: { lo: Math.min(prev.lo, need.lo), hi: Math.max(prev.hi, need.hi) } });
		return { lo: Math.min(grown.lo, prev.lo), hi: Math.max(grown.hi, prev.hi), since: null };
	}
	const narrower = target.hi - target.lo < span - eps;
	const narrow = ask.kind === "percent" ? narrower : narrower && target.hi - target.lo <= 0.5 * span + eps;
	if (!narrow) return prev.since === null ? prev : { lo: prev.lo, hi: prev.hi, since: null };
	if (prev.since === null) return { lo: prev.lo, hi: prev.hi, since: at };
	if (at - prev.since < SCALE_NARROW_HOLD_MS) return prev;
	return { lo: target.lo, hi: target.hi, since: null };
}

// ---- the dial ----------------------------------------------------------------------------

/** What the scene tells the runtime about a pane that takes the dial. */
export type ScaleDialInfo = {
	/** The held entry the turn applies to ("u:°C", "heat", "b:W"). */
	readonly key: string;
	readonly kind: ScaleKind;
	readonly view: ScaleView;
	/** The readings the scale holds now (native). */
	readonly need: Extent;
	readonly maxTicks: number;
	/** The span on screen (view units). */
	readonly onScreen: number;
};

/** The dial's stops for a need, low to high (view units), the span on
 * screen when the turn began (`start`) among them. */
export function dialStops(dial: ScaleDialInfo, start: number): number[] {
	if (dial.kind === "yesno") return [];
	const { view } = dial;
	const a0 = toView(view, dial.need.lo);
	const b0 = toView(view, dial.need.hi);
	const tier = tierOf(view, Math.max(Math.abs(b0), dial.onScreen, start));
	const f = tier.factor;
	const a = a0 / f;
	const b = b0 / f;
	const F = dial.kind === "percent" ? 10 : calmAt(view, f, a, b);
	const narrow = up(Math.max(b - a, F / 10, EPS), RUNG);
	let wide: number;
	if (dial.kind === "percent") {
		const lo0 = Math.min(0, a);
		const hi0 = Math.max(100, b);
		const dom = ticksOf(lo0, hi0, dial.maxTicks, { lo: lo0 === 0, hi: hi0 === 100 }) ?? { lo: lo0, hi: hi0 };
		wide = dom.hi - dom.lo;
	} else wide = up(Math.max(2 * Math.max(Math.abs(a), Math.abs(b)), narrow), RUNG);
	const ok = (r: number): boolean => dial.kind === "zero" || dial.kind === "percent" || place(r, a, b, a >= -EPS, dial.maxTicks) !== null;
	const all = [...rungs(narrow, wide).filter(ok), wide, start / f].map((x) => tidy(x * f));
	return [...new Set(all)].sort((x, y) => x - y);
}

/**
 * One pressed-turn detent of `step` from the span on screen: the next stop
 * clockwise (wider) or counterclockwise (narrower), several on a fast spin,
 * clamped at the ends (null when it would not move); "clear" when it lands
 * on `start`, which ends the turn.
 */
export function stepSpan(dial: ScaleDialInfo, onScreen: number, start: number, step: number): number | "clear" | null {
	const all = dialStops(dial, start);
	if (all.length === 0 || step === 0) return null;
	const n = Math.max(1, Math.min(Math.abs(Math.trunc(step)), all.length));
	const r = step > 0 ? (all.filter((x) => x > onScreen * (1 + EPS))[n - 1] ?? all[all.length - 1]) : (all.filter((x) => x < onScreen * (1 - EPS)).reverse()[n - 1] ?? all[0]);
	if (r === undefined || Math.abs(r - onScreen) <= EPS * Math.max(1, onScreen)) return null;
	return Math.abs(r - start) <= EPS * Math.max(1, r) ? "clear" : r;
}

// ---- typed ends ----------------------------------------------------------------------------

/** Typed ends for one unit's scale (native). */
export type TypedEnds = { readonly min?: number; readonly max?: number };

/** A pane's stored scale as it applies to what it draws: `ends(unit, first)`
 * gives the typed ends of the scale of readings in `unit` (`first`: the
 * first unit the pane draws, the only one an unstamped scale reaches on a
 * line style), undefined where none apply. */
export type ResolvedScale = { readonly stamped: boolean; readonly ends: (unit: string, first: boolean) => TypedEnds | undefined };

/** The styles whose panel shows Scale from and Scale to. */
const TYPED_STYLES = new Set<string>(["trend", "area", "compare", "lanes", "heat", "meters"]);
const LINE_STYLES = new Set<string>(["trend", "area", "compare"]);

/**
 * The typed ends a pane's stored scale gives, or null when none can apply:
 * a style whose panel hides the fields (Group, Events, Ambient, Large
 * values only), no typed end, or no drawn reading other than Yes/No. A
 * counting stamp (StripScale.displayUnit) reaches every reading whose unit
 * on view pairs with it (identity, °C and °F, Δ°C and Δ°F), converted; an
 * unstamped scale keeps the reach it had before the stamp (band 1 of the
 * line styles, Heat, every meter; not
 * Lanes), its numbers in the unit on view.
 */
export function resolvedScale(pane: Pick<StripPaneV1, "style" | "scale" | "readout">, units: readonly string[], fahrenheit: boolean): ResolvedScale | null {
	const style = pane.style;
	if (!TYPED_STYLES.has(style) || (pane.readout === "only" && style !== "lanes" && style !== "heat" && style !== "meters")) return null;
	const { min, max } = pane.scale;
	if (min === undefined && max === undefined) return null;
	if (units.length > 0 && units.every((u) => u.trim() === YES_NO_UNIT)) return null;
	const shape = (lo: number | undefined, hi: number | undefined): TypedEnds | undefined => {
		const out = { ...(lo === undefined || !Number.isFinite(lo) ? {} : { min: lo }), ...(hi === undefined || !Number.isFinite(hi) ? {} : { max: hi }) };
		return out.min === undefined && out.max === undefined ? undefined : out;
	};
	const stampUnit = pane.scale.displayUnit;
	if (stampUnit !== undefined) {
		return {
			stamped: true,
			ends: (unit) => {
				if (unit.trim() === YES_NO_UNIT) return undefined;
				const target = isDataUnit(unit) ? unit : convertUnit(0, unit, fahrenheit).unit;
				if (valueBetweenUnits(0, stampUnit, target) === undefined) return undefined;
				const at = (n: number | undefined): number | undefined => (n === undefined ? undefined : valueBetweenUnits(n, stampUnit, unit));
				return shape(at(min), at(max));
			}
		};
	}
	if (style === "lanes") return { stamped: false, ends: () => undefined };
	return {
		stamped: false,
		ends: (unit, first) => {
			if (unit.trim() === YES_NO_UNIT) return undefined;
			if (LINE_STYLES.has(style) && !first) return undefined;
			const at = (n: number | undefined): number | undefined => (n === undefined || isDataUnit(unit) ? n : toNative(n, unit, fahrenheit));
			return shape(at(min), at(max));
		}
	};
}

/**
 * A band's or Group's limits as they apply to a reading in `unit`, in the
 * unit on view: with a counting stamp (displayUnit), converted from the
 * unit they were typed in (a band typed in °C reads 176 for 80 after the
 * °F switch, and still applies after HWiNFO switched its own °F); without
 * one, as stored, for a reading in the native unit they were typed against.
 * Null when they do not apply. The scene's bands and the Screens critical
 * mark (src/strip/screens.ts) both read limits through it.
 */
export function stampedLimits(limits: { readonly warn?: number; readonly crit?: number; readonly unit?: string; readonly displayUnit?: string }, unit: string, fahrenheit: boolean): { readonly warn?: number; readonly crit?: number } | null {
	const stamp = limits.displayUnit;
	const view = isDataUnit(unit) ? unit : convertUnit(0, unit, fahrenheit).unit;
	const pairs = stamp !== undefined && valueBetweenUnits(0, stamp, view) !== undefined;
	if (limits.unit !== undefined && limits.unit !== unit && !pairs) return null;
	if (stamp === undefined) return { ...(limits.warn === undefined ? {} : { warn: limits.warn }), ...(limits.crit === undefined ? {} : { crit: limits.crit }) };
	if (!pairs) return null;
	const at = (n: number | undefined): number | undefined => (n === undefined ? undefined : Number((valueBetweenUnits(n, stamp, view) as number).toFixed(6)));
	const warn = at(limits.warn);
	const crit = at(limits.crit);
	return { ...(warn === undefined ? {} : { warn }), ...(crit === undefined ? {} : { crit }) };
}

// ---- the ends as text ------------------------------------------------------------------------

/** A held scale's round ticks in its tier's units, and the decimals its
 * ends print with: those of the coarsest round ticks inside the ends (34 to
 * 39 prints "39", 36 to 37 prints "37.0"), whatever step the grid between
 * them takes. */
export type ScaleTicks = { readonly ticks: ValueTicks; readonly tier: ScaleTier; readonly view: ScaleView; readonly endDecimals: number };

/** A held scale's ticks in its tier's units: the round ticks that run from
 * end to end when its ends sit on such a grid (every automatic scale), else
 * ticks inside ends that are kept where they were typed. */
export function scaleTicks(view: ScaleView, scale: Extent, maxTicks: number): ScaleTicks | null {
	const lo = toView(view, scale.lo);
	const hi = toView(view, scale.hi);
	const tier = tierOf(view, Math.max(Math.abs(lo), Math.abs(hi)));
	const a = lo / tier.factor;
	const b = hi / tier.factor;
	const eps = EPS * Math.max(1, Math.abs(a), Math.abs(b));
	const round = valueTicks(a, b, maxTicks);
	const kept = valueTicks(a, b, maxTicks, { lo: true, hi: true });
	const ticks = round !== null && Math.abs(round.lo - a) <= eps && Math.abs(round.hi - b) <= eps ? { ...round, lo: a, hi: b } : kept;
	return ticks === null ? null : { ticks, tier, view, endDecimals: kept?.decimals ?? ticks.decimals };
}

/** A tick of a scale (in its ticks' units) in native units. */
export function tickNative(st: ScaleTicks, value: number): number {
	return fromView(st.view, value * st.tier.factor);
}

/** Decimals that show a typed number exactly, at most three. */
function ownDecimals(value: number): number {
	for (let d = 0; d <= 3; d++) if (Math.abs(value * 10 ** d - Math.round(value * 10 ** d)) < 1e-6) return d;
	return 3;
}

/**
 * One number of a scale as text, `value` in the ticks' units: a tick
 * between the ends with the tick decimals; an end (`end`) with the larger
 * of those and its own, at most three, so a typed 30.5 prints "30.5", never
 * "31", and an automatic end on its ticks prints as they do ("37.0" on 36
 * to 37, "39" on 34 to 39); a data scale's number with its tier attached
 * ("250kbps"); "0" for zero; Yes and No for a Yes/No reading. The unit word
 * is the caller's.
 */
export function endText(value: number, st: ScaleTicks, end = false): string {
	if (st.view.unit.trim() === YES_NO_UNIT) return value >= 0.5 ? "Yes" : "No";
	if (Math.abs(value) < 1e-12) return "0";
	const d = end ? Math.min(3, Math.max(st.endDecimals, ownDecimals(value))) : st.ticks.decimals;
	const text = fixed(value, d);
	return st.view.data === null ? text : `${text}${st.tier.word}`;
}

/** The unit word a scale's top end carries (" °C"), or none: data units
 * carry their tier, Yes/No its words, a unitless reading nothing. */
export function scaleUnitWord(view: ScaleView, unitBox: boolean): string {
	return unitBox && view.data === null && view.unit.trim() !== YES_NO_UNIT && view.shown !== "" ? ` ${view.shown}` : "";
}

/** A text's ink width from its start, as the scene measures the end
 * column (textInkBox). */
export function inkWidth(text: string, size: number): number {
	return text === "" ? 0 : inkEdges([{ text, fontSize: size, fontWeight: 600 }], "start", 0).right;
}

/** The widest of `texts` at `size`: a reserved slot. */
export function reserveSlot(texts: readonly string[], size: number): number {
	let w = 0;
	for (const t of texts) w = Math.max(w, inkWidth(t, size));
	return Math.ceil(w * 10) / 10;
}

/** A text with its integer part one digit wider ("39 °C" counts as
 * "100 °C"), for a slot that must hold a reading's next digit. */
export function widerDigit(text: string): string {
	return text.replace(/^(-?)(\d+)/, (_m, sign: string, digits: string) => `${sign}1${"0".repeat(digits.length)}`);
}

/** Every scale a pane can show for one held key before the next stored
 * change: the target, each dial stop's placement when the pane takes the
 * dial, and the typed ends. The slot reserves the widest of their texts. */
export function candidateScales(ask: ScaleAsk, target: Extent, dial: boolean): Extent[] {
	const out: Extent[] = [target];
	if (dial && ask.kept === undefined && ask.kind !== "yesno") {
		const start = toView(ask.view, target.hi) - toView(ask.view, target.lo);
		const info: ScaleDialInfo = { key: "", kind: ask.kind, view: ask.view, need: ask.need, maxTicks: ask.maxTicks, onScreen: start };
		for (const r of dialStops(info, start)) out.push(autoTarget({ ...ask, span: r }));
	}
	return out;
}

/** The texts a slot must hold for these scales: each top end with its
 * unit word and each bottom end (the first scale's one digit wider, unless
 * a percentage or Yes/No, whose domains are known), and with Scale and grid
 * every tick between. */
export function slotTexts(view: ScaleView, scales: readonly Extent[], maxTicks: number, unitWord: string, axes: boolean): string[] {
	const out: string[] = [];
	const kind = scaleKindOf(view.unit);
	scales.forEach((s, i) => {
		const st = scaleTicks(view, s, maxTicks);
		if (st === null) return;
		const hi = `${endText(st.ticks.hi, st, true)}${unitWord}`;
		const lo = endText(st.ticks.lo, st, true);
		out.push(hi, lo);
		if (i === 0 && kind !== "percent" && kind !== "yesno") out.push(widerDigit(hi), widerDigit(lo));
		if (axes) for (const v of st.ticks.values) out.push(endText(v, st));
	});
	return out;
}
