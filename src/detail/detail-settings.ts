/**
 * Defensive parsing for the Sensor Reading key's optional drill-down
 * settings (issue #5). Settings are append-only and untyped JSON at
 * runtime: every accessor here degrades malformed, absent or
 * future-version values to the exact legacy behavior, never throws, and
 * never rewrites what it cannot parse.
 */

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
 *  truncated rather than erroring (bounds the derived regex too). */
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

/** The filter pattern, trimmed and capped; empty and non-string unset. */
export function detailFilterOf(settings: { detailFilter?: unknown }): string | undefined {
	const raw = settings.detailFilter;
	if (typeof raw !== "string") {
		return undefined;
	}
	const trimmed = raw.trim().slice(0, DETAIL_FILTER_MAX);
	return trimmed === "" ? undefined : trimmed;
}

/**
 * The filter pattern compiled to a case-insensitive matcher. Only `*`
 * (any run) and `?` (one character) are pattern characters; everything
 * else is literal. A pattern with no wildcard matches as a substring
 * (`4090` behaves as `*4090*`), so the obvious thing typed does the
 * obvious thing. Tested against the source name and reading label
 * TOGETHER, which the resolver documents and the panel help states.
 * The panel's live match counter mirrors this translation; change both.
 *
 * Memoized: source-mode groups re-resolve every fresh snapshot and a
 * filter session does the same, so the same pattern would otherwise
 * recompile per tick per device. One live pattern per opener makes a
 * tiny cache the natural shape (bounded, insertion-evicted).
 */
const COMPILED_FILTER_CACHE = new Map<string, (candidate: string) => boolean>();
const COMPILED_FILTER_CACHE_MAX = 16;

export function compileDetailFilter(pattern: string): (candidate: string) => boolean {
	const cached = COMPILED_FILTER_CACHE.get(pattern);
	if (cached !== undefined) {
		return cached;
	}
	const anchored = /[*?]/.test(pattern) ? pattern : `*${pattern}*`;
	const source = anchored.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
	const regex = new RegExp(`^${source}$`, "is");
	const matcher = (candidate: string): boolean => regex.test(candidate);
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
	/** The quad micro-label variant; false shows color-coded bare values. */
	readonly cellLabels: boolean;
};

/** The most grouped tiles an opener may describe (the list caps there too). */
export const DETAIL_TILES_MAX = 128;

const TILE_COLOR = /^#[0-9A-Fa-f]{6}$/;

/**
 * The hand-grouped tile plan for custom mode, walked over detailKeys in
 * order: tile one takes the first `size` readings, tile two the next,
 * and readings past the plan flow on at the uniform density. Absent or
 * junk entries salvage per field (size to 1, labels to "", colors to
 * null, cellLabels to true), a non-array is no plan at all, and nothing
 * is ever rewritten. Positional by design: the pattern stays put while
 * keys flow through it, exactly like the list's own ordering.
 */
export function detailTilesOf(settings: { detailTiles?: unknown }): readonly DetailTileSpec[] {
	const raw = settings.detailTiles;
	if (!Array.isArray(raw)) {
		return [];
	}
	const tiles: DetailTileSpec[] = [];
	for (const entry of raw.slice(0, DETAIL_TILES_MAX)) {
		const record = typeof entry === "object" && entry !== null && !Array.isArray(entry) ? (entry as { size?: unknown; labels?: unknown; colors?: unknown; cellLabels?: unknown }) : {};
		const size = detailDensityOf({ detailDensity: record.size });
		const rawLabels = Array.isArray(record.labels) ? record.labels : [];
		const rawColors = Array.isArray(record.colors) ? record.colors : [];
		const labels: string[] = [];
		const colors: (string | null)[] = [];
		for (let i = 0; i < size; i++) {
			labels.push(typeof rawLabels[i] === "string" ? (rawLabels[i] as string).trim() : "");
			colors.push(typeof rawColors[i] === "string" && TILE_COLOR.test(rawColors[i] as string) ? (rawColors[i] as string) : null);
		}
		tiles.push({ size, labels, colors, cellLabels: record.cellLabels !== false });
	}
	return tiles;
}

/**
 * Whether the opener also becomes a Back tile at its own cell inside the
 * view (the mirror). Off unless exactly true: testers found two Back
 * tiles per page more confusing than one they can move, so the fixed
 * top-left Back is the only default way out (issue #5 feedback).
 */
export function detailMirrorBackOf(settings: { detailMirrorBack?: unknown }): boolean {
	return settings.detailMirrorBack === true;
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
		if (typeof entry !== "string" || entry === "" || seen.has(entry)) {
			continue;
		}
		seen.add(entry);
		keys.push(entry);
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
