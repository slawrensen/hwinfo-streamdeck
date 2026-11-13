/**
 * History windows and the bucket tiers behind them. A window is a real span
 * of monotonic time (1, 5 or 15 minutes); each maps onto one fixed-width
 * bucket tier, so retained memory depends on the window, never on the poll
 * rate. Widths are whole multiples of each other (1 s, 2 s, 6 s): 2 s is
 * HWiNFO's default polling period, so the 5-minute tier gives every producer
 * write its own bucket, and the capacity slack above the visible count
 * absorbs the extra entries a segment boundary creates inside one bucket.
 */
import type { HistoryWindowId } from "./types";

export type TierIndex = 0 | 1 | 2;

export const HISTORY_WINDOWS: Readonly<Record<HistoryWindowId, { readonly windowMs: number; readonly tier: TierIndex }>> = {
	"1m": { windowMs: 60_000, tier: 0 },
	"5m": { windowMs: 300_000, tier: 1 },
	"15m": { windowMs: 900_000, tier: 2 }
};

/** Bucket width and ring capacity per tier: 60 + 12, 150 + 18, 150 + 18. */
export const TIERS: readonly { readonly widthMs: number; readonly capacity: number }[] = [
	{ widthMs: 1_000, capacity: 72 },
	{ widthMs: 2_000, capacity: 168 },
	{ widthMs: 6_000, capacity: 168 }
];

/** Bytes one bucket entry costs: first, min, max, last as float64 plus
 * three uint32 words (bucket sequence, segment and count, offsets). */
export const ENTRY_BYTES = 4 * 8 + 3 * 4;

/**
 * The saved window of a key or dial. Exact strings only: anything else
 * (absent, "", junk, a number, a case variant, a newer version's value)
 * is undefined, which keeps the legacy 36-sample line. Never writes back.
 */
export function parseHistoryWindow(raw: unknown): HistoryWindowId | undefined {
	return raw === "1m" || raw === "5m" || raw === "15m" ? raw : undefined;
}
