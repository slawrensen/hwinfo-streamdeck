/**
 * Defensive parsing for the Sensor Reading key's optional drill-down
 * settings (issue #5). Settings are append-only and untyped JSON at
 * runtime: every accessor here degrades malformed, absent or
 * future-version values to the exact legacy behavior, never throws, and
 * never rewrites what it cannot parse.
 */
import { HEX6 } from "../ui/text-colors";
import type { ManagedDetailProfile, SlotCell } from "./managed-profiles";

/** What a key press does; absent or unrecognized values mean "cycle-stat". */
export type PressBehavior = "cycle-stat" | "open-details" | "tap-cycle-hold-details";

/** The one fixed navigation role a Sensor Reading key can carry. The
 *  revision-2 detail profiles bake it into their top-left cell so the
 *  Back tile is an ordinary, fully configurable Sensor Reading whose
 *  press is pinned to "return to the previous profile". */
export type DetailRole = "back";

/** Which readings the detail view lists; absent or junk means "source". */
export type DetailMode = "source" | "custom" | "filter";

/** The longest accepted filter pattern; longer hand-edited values are
 *  truncated rather than erroring (bounds the compiled matcher too). */
export const DETAIL_FILTER_MAX = 128;

/** The most custom detail keys an opener may carry; later entries are
 *  ignored rather than erroring, so a hand-edited long list still works. */
export const DETAIL_KEYS_MAX = 128;

/** Readings per detail tile: 1 keeps the original one-reading faces. */
export type DetailDensity = 1 | 2 | 3 | 4;

/** How long a key must stay down to count as a hold (tap-cycle-hold-details). */
export const HOLD_THRESHOLD_MS = 500;

export function pressBehaviorOf(settings: { pressBehavior?: unknown }): PressBehavior {
	const raw = settings.pressBehavior;
	return raw === "open-details" || raw === "tap-cycle-hold-details" ? raw : "cycle-stat";
}

export function detailModeOf(settings: { detailMode?: unknown }): DetailMode {
	return settings.detailMode === "custom" ? "custom" : settings.detailMode === "filter" ? "filter" : "source";
}

/** Separates the alternatives of one filter pattern (issue #35). Always a
 *  separator, never escaped: HWiNFO's own names do not contain it, and
 *  `?` still matches one in a sensor renamed to include it. */
export const DETAIL_FILTER_SEPARATOR = "|";

/**
 * The alternatives of a filter pattern, in typed order: split on every
 * {@link DETAIL_FILTER_SEPARATOR}, each piece trimmed with the same
 * String.prototype.trim as the outer trim (interior spaces stay
 * literal), empty pieces dropped. A pattern made only of separators and
 * spaces has none. The panel mirrors this in ui/pi-model.js
 * (detailFilterAlternatives); keep the two in sync.
 */
export function detailFilterAlternatives(pattern: string): readonly string[] {
	const alternatives: string[] = [];
	for (const piece of pattern.split(DETAIL_FILTER_SEPARATOR)) {
		const trimmed = piece.trim();
		if (trimmed !== "") {
			alternatives.push(trimmed);
		}
	}
	return alternatives;
}

/**
 * The filter pattern, trimmed and then capped at {@link DETAIL_FILTER_MAX}
 * as one string (the cap counts every separator and space, before any
 * split). Non-string, empty, and a pattern whose alternatives are all
 * empty (`|`, ` | | `) are unset, so entry refuses like an empty field.
 * Otherwise the whole capped text is returned as typed: it doubles as
 * the view's title.
 */
export function detailFilterOf(settings: { detailFilter?: unknown }): string | undefined {
	const raw = settings.detailFilter;
	if (typeof raw !== "string") {
		return undefined;
	}
	const trimmed = raw.trim().slice(0, DETAIL_FILTER_MAX);
	return detailFilterAlternatives(trimmed).length === 0 ? undefined : trimmed;
}

/**
 * The filter pattern compiled to a case-insensitive matcher. Only `*`
 * (any run) and `?` (one character) are pattern characters; everything
 * else is literal. A pattern with no wildcard matches as a substring
 * (`4090` behaves as `*4090*`), so the obvious thing typed does the
 * obvious thing. Tested against the source name and reading label
 * TOGETHER, which the resolver documents and the panel help states.
 * A pattern containing {@link DETAIL_FILTER_SEPARATOR} is a union: each
 * of its {@link detailFilterAlternatives} keeps those rules on its own
 * (its own substring wrap or anchoring), and a candidate matches when
 * any alternative does. A pattern without one takes exactly the
 * single-pattern path under the same cache key, so every filter saved
 * before the union existed keeps its meaning. The panel's live match
 * counter (`detailFilterMatcher` in ui/pi-model.js) mirrors this
 * matcher; keep the two in sync.
 *
 * Memoized: source-mode groups re-resolve every fresh snapshot and a
 * filter session does the same, so the same pattern would otherwise
 * recompile per tick per device. One live pattern per opener makes a
 * tiny cache the natural shape (bounded, insertion-evicted). A union
 * takes ONE entry, keyed by its full pattern; its alternatives compile
 * beside the cache, never through it, so a long union cannot evict the
 * other openers' live patterns.
 */
const COMPILED_FILTER_CACHE = new Map<string, (candidate: string) => boolean>();
const COMPILED_FILTER_CACHE_MAX = 16;

const STAR = 42; // "*".charCodeAt(0)
const QUERY = 63; // "?".charCodeAt(0)

/** Case-folds one UTF-16 code unit the way the old non-unicode `i` regex
 *  canonicalized: uppercase, except a non-ASCII unit never folds onto an
 *  ASCII one, so the regex-to-glob swap is observation-equal. No letter
 *  uppercases to `*` or `?`, so folded patterns keep their wildcards. */
function foldCodeUnit(code: number): number {
	if (code < 128) {
		return code >= 97 && code <= 122 ? code - 32 : code;
	}
	const upper = String.fromCharCode(code).toUpperCase();
	if (upper.length !== 1) {
		return code;
	}
	const upperCode = upper.charCodeAt(0);
	return upperCode < 128 ? code : upperCode;
}

function foldedUnits(text: string): number[] {
	const units: number[] = new Array<number>(text.length);
	for (let i = 0; i < text.length; i++) {
		units[i] = foldCodeUnit(text.charCodeAt(i));
	}
	return units;
}

/**
 * Iterative two-pointer glob match over folded code units, anchored at
 * both ends: `?` takes exactly one unit, `*` any run, everything else
 * is literal. The literal branch skips the star unit, so a candidate's
 * own literal `*` (user-renamed sensor text) can never swallow the
 * wildcard before its backtrack anchor is recorded. On a mismatch it
 * retries from the most recent `*` with one more unit consumed, so the
 * worst case is O(pattern * candidate).
 * The previous `*` -> `.*` regex translation backtracked exponentially
 * (one adversarial .test inside the 128 cap ran >88 s, re-run every
 * poll), which is why this is not a RegExp.
 */
function globMatch(pattern: readonly number[], candidate: readonly number[]): boolean {
	let pi = 0;
	let ci = 0;
	let star = -1;
	let mark = 0;
	while (ci < candidate.length) {
		if (pi < pattern.length && (pattern[pi] === QUERY || (pattern[pi] !== STAR && pattern[pi] === candidate[ci]))) {
			pi++;
			ci++;
		} else if (pi < pattern.length && pattern[pi] === STAR) {
			star = pi;
			pi++;
			mark = ci;
		} else if (star !== -1) {
			pi = star + 1;
			mark++;
			ci = mark;
		} else {
			return false;
		}
	}
	while (pi < pattern.length && pattern[pi] === STAR) {
		pi++;
	}
	return pi === pattern.length;
}

/** One alternative's folded glob: substring-wrapped unless it carries a
 *  wildcard, in which case it is anchored to the whole candidate. */
function compileGlob(pattern: string): readonly number[] {
	return foldedUnits(/[*?]/.test(pattern) ? pattern : `*${pattern}*`);
}

function compileUncached(pattern: string): (candidate: string) => boolean {
	if (!pattern.includes(DETAIL_FILTER_SEPARATOR)) {
		const compiled = compileGlob(pattern);
		return (candidate: string): boolean => globMatch(compiled, foldedUnits(candidate));
	}
	const alternatives = detailFilterAlternatives(pattern).map(compileGlob);
	// The candidate folds once and every alternative walks the same units.
	// The alternatives share the one 128-character cap, so a union's worst
	// case stays linear in that cap times the candidate, like one pattern.
	return (candidate: string): boolean => {
		const folded = foldedUnits(candidate);
		return alternatives.some((alternative) => globMatch(alternative, folded));
	};
}

export function compileDetailFilter(pattern: string): (candidate: string) => boolean {
	const cached = COMPILED_FILTER_CACHE.get(pattern);
	if (cached !== undefined) {
		return cached;
	}
	const matcher = compileUncached(pattern);
	if (COMPILED_FILTER_CACHE.size >= COMPILED_FILTER_CACHE_MAX) {
		const oldest = COMPILED_FILTER_CACHE.keys().next().value;
		if (oldest !== undefined) {
			COMPILED_FILTER_CACHE.delete(oldest);
		}
	}
	COMPILED_FILTER_CACHE.set(pattern, matcher);
	return matcher;
}

/**
 * How many readings one detail tile carries. The panel's select writes
 * the option value as a string; a hand-edited number counts the same.
 * Only the exact markers 2, 3 and 4 leave the original one-reading
 * tiles: absent, junk and future values all stay at 1, so rolled-back
 * and hand-edited profiles keep the faces they always had.
 */
export function detailDensityOf(settings: { detailDensity?: unknown }): DetailDensity {
	const raw = settings.detailDensity;
	if (raw === 2 || raw === "2") {
		return 2;
	}
	if (raw === 3 || raw === "3") {
		return 3;
	}
	if (raw === 4 || raw === "4") {
		return 4;
	}
	return 1;
}

/**
 * One tile of a hand-grouped custom page (issue #5 follow-up): how many
 * of the custom list's readings it takes and how it dresses them, the
 * same knobs a standalone multi-reading key has at this size. Cell
 * labels ride every size (a row label on stacked and rows faces, the
 * micro-label on the quad, the main label on a single); identity colors
 * and the cell-labels variant are quad concerns like they are on a
 * normal key.
 */
export type DetailTileSpec = {
	readonly size: DetailDensity;
	/** Per-cell label overrides; "" means "use the reading's own". */
	readonly labels: readonly string[];
	/** Per-cell #RRGGBB quad identity overrides; null keeps the default. */
	readonly colors: readonly (string | null)[];
	/** A stored hue carried from an automatic quad cell still receives theme
	 * contrast correction. Absent/false keeps legacy chosen-color semantics. */
	readonly automaticColors?: readonly boolean[];
	/** The quad micro-label variant; false shows color-coded bare values. */
	readonly cellLabels: boolean;
};

/** The most grouped tiles an opener may describe (the list caps there too). */
export const DETAIL_TILES_MAX = 128;

/**
 * The hand-grouped tile plan for custom mode, walked over detailKeys in
 * order: tile one takes the first `size` readings, tile two the next,
 * and readings past the plan flow on at the uniform density. Absent or
 * junk entries salvage per field (size to 1, labels to "", colors to
 * null, cellLabels to true), a non-array is no plan at all, and nothing
 * is ever rewritten. Positional by design: the pattern stays put while
 * keys flow through it, exactly like the list's own ordering. Under
 * version 2 (detailTilesVersionOf) the opener's own reading keeps its
 * cell in that walk, hidden, so a link or a re-pick moves no cell.
 */
export function detailTilesOf(settings: { detailTiles?: unknown }): readonly DetailTileSpec[] {
	const raw = settings.detailTiles;
	if (!Array.isArray(raw)) {
		return [];
	}
	const tiles: DetailTileSpec[] = [];
	for (const entry of raw.slice(0, DETAIL_TILES_MAX)) {
		const record = typeof entry === "object" && entry !== null && !Array.isArray(entry) ? (entry as { size?: unknown; labels?: unknown; colors?: unknown; automaticColors?: unknown; cellLabels?: unknown }) : {};
		const size = detailDensityOf({ detailDensity: record.size });
		const rawLabels = Array.isArray(record.labels) ? record.labels : [];
		const rawColors = Array.isArray(record.colors) ? record.colors : [];
		const rawAutomatic = Array.isArray(record.automaticColors) ? record.automaticColors : [];
		const labels: string[] = [];
		const colors: (string | null)[] = [];
		const automaticColors: boolean[] = [];
		for (let i = 0; i < size; i++) {
			labels.push(typeof rawLabels[i] === "string" ? (rawLabels[i] as string).trim() : "");
			colors.push(typeof rawColors[i] === "string" && HEX6.test(rawColors[i] as string) ? (rawColors[i] as string) : null);
			automaticColors.push(colors[i] !== null && rawAutomatic[i] === true);
		}
		tiles.push({ size, labels, colors, ...(automaticColors.some(Boolean) ? { automaticColors } : {}), cellLabels: record.cellLabels !== false });
	}
	return tiles;
}

/**
 * Which cells the hand-grouped tile plan walks. 2 (or "2"): every listed
 * key holds a cell, and the opener's own reading is hidden in place, so a
 * link or a re-pick never moves the walk. Anything else, absent on every
 * plan saved by 1.7.0, is the 1.7.0 walk, which skips every key that
 * currently names the opener's reading. The panel writes 2 with every
 * list or tile edit that stores a plan; nothing rewrites it.
 */
export function detailTilesVersionOf(settings: { detailTilesVersion?: unknown }): 1 | 2 {
	const raw = settings.detailTilesVersion;
	return raw === 2 || raw === "2" ? 2 : 1;
}

/**
 * Whether the opener also becomes a Back tile at its own cell inside the
 * view (the mirror). ON unless exactly false: the finger that pressed in
 * presses right back out, and the movable top-left Back works regardless.
 * 1.5.0 shipped this opt-in after issue #5 testing preferred one movable
 * Back; 1.6.0 makes the same-finger exit the default again (the owner's
 * call), with the untick as the way back to a single Back. Absent, junk
 * and hand-edited values all land on the default, never rewritten.
 */
export function detailMirrorBackOf(settings: { detailMirrorBack?: unknown }): boolean {
	return settings.detailMirrorBack !== false;
}

/**
 * The baked navigation role, or undefined for an ordinary key. ONLY the
 * exact string "back" activates the role: absent, empty, malformed and
 * future values all behave as a plain Sensor Reading, are never
 * normalized, and are never rewritten. The role is read from settings
 * alone — never inferred from coordinate, profile, device or title.
 */
export function detailRoleOf(settings: { detailRole?: unknown }): DetailRole | undefined {
	return settings.detailRole === "back" ? "back" : undefined;
}

/**
 * A reading key with any friendly name the config document appended after
 * it stripped off. The property inspector writes "<key>  <name>" so a
 * person can read a list and reorder it; the panel strips the names on
 * apply, so settings written through it never carry one, but a document
 * pasted straight into a settings file by hand does. A shared-memory key
 * is colon-separated hex and never contains whitespace, so it ends at the
 * first run of it. A Gadget key is "g:<source>:<label>", the names exactly
 * as HWiNFO writes them, so it carries spaces of its own (issue #21 meets
 * custom mode) and already reads as a name: it is kept whole, trailing
 * whitespace included, and the panel never appends a name to one.
 */
export function bareReadingKey(entry: string): string {
	// Leading whitespace is a hand indent, never identity: no key starts
	// with it. Trailing whitespace on a Gadget key IS identity (a label
	// ending in a space is a different reading from the one without), so a
	// recognized Gadget key is kept whole to its last character.
	const trimmed = entry.trimStart();
	if (trimmed.startsWith("g:")) {
		return trimmed;
	}
	return trimmed.split(/\s+/)[0] ?? "";
}

/**
 * The configured custom reading keys: configured order preserved, exact
 * duplicates dropped after their first occurrence, non-string and empty
 * entries ignored, capped at {@link DETAIL_KEYS_MAX}. A non-array (or a
 * future shape) degrades to an empty list.
 */
export function detailKeysOf(settings: { detailKeys?: unknown }): readonly string[] {
	const raw = settings.detailKeys;
	if (!Array.isArray(raw)) {
		return [];
	}
	const seen = new Set<string>();
	const keys: string[] = [];
	for (const entry of raw) {
		if (typeof entry !== "string") {
			continue;
		}
		// A hand-pasted config document lands here still wearing its
		// friendly names; see bareReadingKey for why a Gadget key is kept
		// whole while a shared-memory key ends at the first whitespace.
		const key = bareReadingKey(entry);
		if (key === "" || seen.has(key)) {
			continue;
		}
		seen.add(key);
		keys.push(key);
		if (keys.length >= DETAIL_KEYS_MAX) {
			break;
		}
	}
	return keys;
}

/** The optional detail title; whitespace-only and non-string degrade to unset. */
export function detailTitleOf(settings: { detailTitle?: unknown }): string | undefined {
	const raw = settings.detailTitle;
	return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
}

/** The most logical pages an opener's intentional empty cells describe;
 * pages past them flow around the navigation tiles and the mirror alone. */
export const DETAIL_GAP_PAGES_MAX = 16;

/**
 * The opener's intentional empty cells (detailGaps) on one bundle, page
 * by page, exactly as stored: `{ [bundle key]: [[{ column, row }, ...] per
 * logical page] }`. Positional, so they apply in every list mode, and
 * kept per bundle, so a deck class that never had a layout keeps
 * flowing. Salvage, never a throw and never a rewrite:
 * - a non-object, a missing or unknown bundle key, or a non-array bundle
 *   value is no gaps at all;
 * - a page that is not an array is a page without gaps, kept in place so
 *   later pages never shift;
 * - inside a page, a cell that is not an object, has a non-integer
 *   column or row, is not one of the bundle's reading cells (outside the
 *   grid or a navigation cell), or repeats an earlier cell is dropped;
 * - pages past {@link DETAIL_GAP_PAGES_MAX} are ignored, and trailing
 *   pages without gaps are dropped.
 * A page here may still cover every reading cell: the Page layout
 * preview shows such a page as stored, while the deck reads
 * {@link detailGapsOf}, which ignores it.
 */
export function storedDetailGapsOf(settings: { detailGaps?: unknown }, profile: Pick<ManagedDetailProfile, "key" | "layout">): readonly (readonly SlotCell[])[] {
	const raw = settings.detailGaps;
	if (typeof raw !== "object" || raw === null || Array.isArray(raw) || !Object.hasOwn(raw, profile.key)) {
		return [];
	}
	const pages = (raw as Record<string, unknown>)[profile.key];
	if (!Array.isArray(pages)) {
		return [];
	}
	const readingCells = new Set(profile.layout.readings.map((cell) => `${cell.column},${cell.row}`));
	const out: SlotCell[][] = [];
	for (const page of pages.slice(0, DETAIL_GAP_PAGES_MAX)) {
		const cells: SlotCell[] = [];
		const seen = new Set<string>();
		for (const entry of Array.isArray(page) ? page : []) {
			if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
			const { column, row } = entry as { column?: unknown; row?: unknown };
			if (typeof column !== "number" || typeof row !== "number" || !Number.isInteger(column) || !Number.isInteger(row)) continue;
			const id = `${column},${row}`;
			if (!readingCells.has(id) || seen.has(id)) continue;
			seen.add(id);
			cells.push({ column, row });
		}
		out.push(cells);
	}
	return withoutTrailingEmpty(out);
}

/**
 * The opener's intentional empty cells (detailGaps) on one bundle, page
 * by page, as the deck applies them: {@link storedDetailGapsOf}, with a
 * page whose gaps would cover every reading cell ignored for that page.
 * An opener whose layout holds no gap anywhere returns [] and takes the
 * exact legacy flow. Separate from the detailKeys/detailTiles/
 * detailTilesVersion triplet: gaps reserve cells, they never enter the
 * tile walk.
 */
export function detailGapsOf(settings: { detailGaps?: unknown }, profile: Pick<ManagedDetailProfile, "key" | "layout">): readonly (readonly SlotCell[])[] {
	const all = new Set(profile.layout.readings.map((cell) => `${cell.column},${cell.row}`)).size;
	return withoutTrailingEmpty(storedDetailGapsOf(settings, profile).map((cells) => (cells.length >= all ? [] : cells)));
}

function withoutTrailingEmpty(pages: readonly (readonly SlotCell[])[]): readonly (readonly SlotCell[])[] {
	let end = pages.length;
	while (end > 0 && (pages[end - 1] as readonly SlotCell[]).length === 0) {
		end--;
	}
	return end === pages.length ? pages : pages.slice(0, end);
}

/** The most detail-page sources one hand-placed key can be limited to. */
export const DETAIL_SCOPE_MAX = 32;

/**
 * The detail pages a hand-placed Sensor Reading key belongs to
 * (detailScope: `{ sources: [...] }`), as HWiNFO source ids: a Shared
 * Memory sensor's `sensorIdHex:instance`, or the Gadget source name. Kept
 * byte for byte (a Gadget name may end in a space), exact duplicates and
 * non-string or empty entries dropped, capped at {@link DETAIL_SCOPE_MAX}.
 * Undefined, the default, means the key shows on every detail page the
 * way it always has: an absent field, a non-object, a non-array
 * `sources` and a list left with no usable entry all land there. Never
 * thrown on, never rewritten.
 */
export function detailScopeOf(settings: { detailScope?: unknown }): readonly string[] | undefined {
	const raw = settings.detailScope;
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return undefined;
	}
	const sources = (raw as { sources?: unknown }).sources;
	if (!Array.isArray(sources)) {
		return undefined;
	}
	const out: string[] = [];
	for (const entry of sources) {
		if (typeof entry !== "string" || entry === "" || out.includes(entry)) continue;
		out.push(entry);
		if (out.length >= DETAIL_SCOPE_MAX) break;
	}
	return out.length === 0 ? undefined : out;
}
