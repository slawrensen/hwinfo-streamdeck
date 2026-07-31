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
