/**
 * Shared history contract (consumed by keys, the two-row dial and strip
 * displays; produced by src/history/store.ts, owned by the poller).
 *
 * Time is monotonic acquisition time in milliseconds (src/clock.ts
 * monotonicNow). The wall clock never positions a point. A series is keyed
 * by the SAVED reading key; every segment records the live measurement it
 * came from, so a re-paired key never shows another measurement's past.
 */
import type { SnapshotSource } from "../hwinfo/provider";
import type { SensorType } from "../hwinfo/types";

/** History window choices. Exact strings only; see parseHistoryWindow. */
export type HistoryWindowId = "1m" | "5m" | "15m";

/** Why a segment ended (or why an older identity is hidden). */
export type GapReason =
	| "stale"
	| "unavailable"
	| "skipped"
	| "missing"
	| "unit"
	| "type"
	| "binding"
	/** A calculated reading whose definition (or what its inputs resolve to) changed. */
	| "definition"
	| "source"
	| "sleep"
	| "stopped"
	| "budget";

/** One contiguous run of observations of one measurement identity, mapped
 * to view x coordinates. Pen up between segments. */
export interface HistoryViewSegment {
	readonly ordinal: number;
	readonly x0: number;
	readonly x1: number;
	/** True while the segment is still receiving samples. */
	readonly open: boolean;
	readonly source: SnapshotSource;
	readonly endReason?: GapReason;
	/** Began a moment after the segment before it ended on a skipped read, the
	 * same measurement from the same source (the store decides; Segment.brief).
	 * A line may draw straight across; the observations stay separate. */
	readonly brief?: true;
}

/**
 * Per-pixel-column aggregate of a window (M4: first/min/max/last per column
 * per segment, so column extremes equal the brute-force extremes). Columns
 * are emitted only where observations exist; `x` is the column's left edge in
 * view pixels for the WHOLE window, whatever the amount of data, so short
 * history occupies only the right side and is never stretched.
 */
export interface HistoryColumns {
	readonly x: Float64Array;
	readonly first: Float64Array;
	readonly min: Float64Array;
	readonly max: Float64Array;
	readonly last: Float64Array;
	/** Segment ordinal of each column (index into `segments` by ordinal). */
	readonly seg: Uint16Array;
	/** Number of valid entries in the typed arrays above. */
	readonly n: number;
}

/** A frozen, immutable view of one series over one window at one instant. */
export interface HistoryView {
	readonly windowMs: number;
	readonly widthPx: number;
	/** Monotonic time of the right edge. */
	readonly now: number;
	/** Native HWiNFO unit of every included value (never converted here). */
	readonly unit: string;
	readonly type: SensorType;
	readonly cols: HistoryColumns;
	readonly segments: readonly HistoryViewSegment[];
	/** Boundaries where an older identity (other unit/type/binding) was excluded. */
	readonly hidden: readonly { readonly x: number; readonly reason: "unit" | "type" | "binding" }[];
	/** Window extremes over included observations; null when nothing observed. */
	readonly extent: { readonly min: number; readonly max: number } | null;
	/** X where observation began inside the window (short history), else null. */
	readonly observedFromX: number | null;
	/** Age of the newest sample relative to `now`, null when none. */
	readonly lastSampleAgeMs: number | null;
	/** Bumps whenever the underlying series changed; cheap repaint gate. */
	readonly revision: number;
}

/** What a consumer asks the store to retain. Consumer ids are in-memory only
 * (action id, action id + ":rows", strip group id + pane), never persisted. */
export interface HistoryInterest {
	readonly savedKey: string;
	readonly window: HistoryWindowId | readonly HistoryWindowId[];
}

/** Which allowance pays for a consumer's tiers: the main budget, the strip
 * Group panes' own, or the Ambient share inside it (src/history/store.ts). */
export type InterestPool = "main" | "group" | "ambient";

export interface HistoryInterestOptions {
	/** "group": a strip Group pane, paid from the group allowance;
	 * "ambient": an Ambient pane, paid from the group allowance too, and at
	 * most the Ambient share of it. */
	readonly pool?: "group" | "ambient";
}

/** Read side of the store, the only surface consumers use. */
export interface HistoryReader {
	setInterest(consumerId: string, entries: readonly HistoryInterest[], options?: HistoryInterestOptions): void;
	dropInterest(consumerId: string): void;
	view(
		savedKey: string,
		window: HistoryWindowId,
		widthPx: number,
		now: number,
		linkedKeys?: readonly string[]
	): HistoryView | undefined;
	/** True when a consumer asked for this window of the series and the
	 * byte budget refused it: view() then answers undefined, and a consumer
	 * that has no recent-samples line of its own (a strip) says so. */
	refused?(savedKey: string, window: HistoryWindowId): boolean;
	/** Bumps on any ingest that changed a retained series. */
	readonly revision: number;
}
