/**
 * The shared timestamped history store, owned by the poller and fed once per
 * tick (see poller.ts tick). Pure and SDK-free: every time is passed in.
 *
 * - A series is keyed by the SAVED reading key and retained only while some
 *   consumer (a key, a two-row dial, a strip pane) asked for a window of it,
 *   plus a 16-minute linger after the last one leaves, by which time every
 *   entry has aged out of every window. A lingering series is still fed.
 * - Samples are placed at the tick's monotonic acquisition time and only on
 *   producer evidence. A held value is never a sample, and a missing or
 *   non-finite value is never stored, so a gap can never become a zero.
 * - Each window has its own fixed-width bucket ring (window.ts), allocated
 *   when a consumer asks for that window, so memory follows the windows in
 *   use and never the poll rate. A hard byte budget evicts lingering tiers
 *   oldest first and refuses new allocations past it: the refused consumer
 *   gets no view (refused() says so). A key or dial draws its legacy
 *   recent-samples line; a strip has none and names the reading "no
 *   history room".
 * - A segment is one unbroken run of observations of one measurement
 *   identity. It ends at its last sample, never at the moment a boundary was
 *   detected, on stale, unavailable, a skipped read, a missing reading, an
 *   identity change (identity.ts), a tick gap longer than the scheduler can
 *   explain (machine sleep, an event-loop stall, a long stop) or the
 *   system's wake event when no tick gap already ended the sleep.
 * - A skipped read says nothing about the reading, so what it cost is judged
 *   by what came next: the next segment is brief (Segment.brief) when the same
 *   measurement resumes from the same source, in the same unit and type,
 *   within MIN_BRIEF_GAP_MS or BRIEF_GAP_SCANS scans. It stays its own segment
 *   and gains no sample; a line may draw straight across it, and Inspect still
 *   finds nothing inside it. A later unavailable, stale, missing, sleep or
 *   stopped replaces "skipped" as the reason, so that boundary is never brief.
 * - A sample sits at acquisition time. How old a Shared Memory stamp
 *   already was when it was first seen is kept beside it for a data-age
 *   readout (evidenceAgeOf) and never moves a point.
 *
 * The legacy 36-sample rings in the poller are a separate path and are not
 * touched by anything here.
 */
import { monotonicNow } from "../clock";
import { measurementIdentityOf } from "../hwinfo/calculated";
import type { SnapshotSource } from "../hwinfo/provider";
import type { Reading, SensorSnapshot, SensorType } from "../hwinfo/types";
import { identityBreak } from "./identity";
import type { GapReason, HistoryInterest, HistoryInterestOptions, HistoryReader, HistoryView, HistoryWindowId, InterestPool } from "./types";
import { buildView } from "./view";
import { ENTRY_BYTES, HISTORY_WINDOWS, parseHistoryWindow, TIERS, type TierIndex } from "./window";

/** A released series (or window tier) is kept this long, still fed. */
export const LINGER_MS = 960_000;
/** Hard cap on retained bucket bytes across every series keys, dials and
 * strips ask for (group graphs have their own allowance, below). */
export const HISTORY_BUDGET_BYTES = 2 * 1024 * 1024;
/** A separate allowance for the strip's Group panes (interest asked with
 * pool "group"): they keep only the window on screen, and never take from
 * the budget above, so a 32-reading group cannot starve a key's trend. */
export const GROUP_HISTORY_BUDGET_BYTES = 768 * 1024;
/** The Ambient panes' share of the group allowance (interest asked with
 * pool "ambient"): their rings count against the group allowance and,
 * together, never take more than this of it (48 readings of 5 or 15
 * minutes fit), so an Ambient strip leaves room for a Group pane. */
export const AMBIENT_HISTORY_BUDGET_BYTES = 384 * 1024;
/** Closed segments remembered per series (older entries stop drawing). */
export const CLOSED_SEGMENTS = 24;
/** A tick gap above max(3 x the scheduled interval, this) is a gap. */
const MIN_TICK_GAP_MS = 5_000;
/** From the last sample before a skipped read to the first after it, a
 * segment is brief up to max(this, BRIEF_GAP_SCANS x the longer of the
 * producer's scan interval and the scheduled poll): one missed read at any
 * cadence is under it (at most a scan and a poll, plus the read itself), and
 * at the 2 s default it comes to this floor. */
const MIN_BRIEF_GAP_MS = 5_000;
const BRIEF_GAP_SCANS = 2.5;
/** A wake event this soon after a tick gap ended the runs belongs to the
 * same sleep. Node runs the overdue tick on resume, usually before the app
 * relays systemDidWakeUp, and that relay delay is unmeasured; a second
 * sleep too short to leave a tick gap within a minute of a wake is not a
 * real case. */
const WAKE_AFTER_GAP_MS = 60_000;
const TIER_INDICES: readonly TierIndex[] = [0, 1, 2];

/** One poller tick as the store sees it. `evidence` is true only when the
 * tick published ok AND carried new producer evidence; `stampAdvanced` says
 * the producer stamp (or the Gadget scan revision) moved, so a steady value
 * is still a fresh sample; `evidenceAgeMs` is how old that evidence already
 * was when read (a Shared Memory stamp seen only after it aged; 0 when a
 * value change between reads proved it live). */
export type HistoryTick =
	| { kind: "ok"; at: number; snapshot: SensorSnapshot; source: SnapshotSource; evidence: boolean; stampAdvanced: boolean; evidenceAgeMs: number }
	| { kind: "stale" | "unavailable" | "skipped"; at: number };

/**
 * A fixed-capacity ring of buckets for one tier. Entry layout, per slot:
 * `vals[4s..4s+3]` = first, min, max, last (native unit);
 * `meta[3s]` = bucket sequence (floor(at / widthMs));
 * `meta[3s+1]` = (segment ordinal & 0xffff) << 16 | min(count, 0xffff);
 * `meta[3s+2]` = first offset << 16 | last offset (ms into the bucket).
 * A new entry starts when the bucket or the segment changes, so an entry
 * never mixes two segments; a full ring overwrites its oldest entry.
 */
export class BucketRing {
	readonly widthMs: number;
	readonly capacity: number;
	/** When this tier started recording (it starts empty). */
	readonly createdAt: number;
	readonly vals: Float64Array;
	readonly meta: Uint32Array;
	/** Slot of the newest entry; -1 while empty. */
	head = -1;
	size = 0;
	/** The last view built from this ring (HistoryStore.view), reused while
	 * nothing it depends on changed. Dies with the ring. */
	lastView: CachedView | null = null;
	/** Which allowance pays for this ring (HistoryStore budgets). */
	pool: InterestPool = "main";

	constructor(tier: TierIndex, createdAt: number) {
		const spec = TIERS[tier] as { widthMs: number; capacity: number };
		this.createdAt = createdAt;
		this.widthMs = spec.widthMs;
		this.capacity = spec.capacity;
		this.vals = new Float64Array(spec.capacity * 4);
		this.meta = new Uint32Array(spec.capacity * 3);
	}

	get bytes(): number {
		return this.vals.byteLength + this.meta.byteLength;
	}

	/** The slot of the i-th entry, oldest first. */
	slot(i: number): number {
		return (((this.head - this.size + 1 + i) % this.capacity) + this.capacity) % this.capacity;
	}

	put(at: number, value: number, ordinal: number): void {
		const seq = Math.floor(at / this.widthMs);
		const off = Math.min(0xffff, Math.max(0, Math.floor(at - seq * this.widthMs)));
		const ord = ordinal & 0xffff;
		const { vals, meta } = this;
		if (this.size > 0) {
			const m = this.head * 3;
			const word = meta[m + 1] as number;
			if (meta[m] === seq && word >>> 16 === ord) {
				const v = this.head * 4;
				if (value < (vals[v + 1] as number)) vals[v + 1] = value;
				if (value > (vals[v + 2] as number)) vals[v + 2] = value;
				vals[v + 3] = value;
				const count = word & 0xffff;
				if (count < 0xffff) meta[m + 1] = ((ord << 16) | (count + 1)) >>> 0;
				meta[m + 2] = (((meta[m + 2] as number) & 0xffff0000) | off) >>> 0;
				return;
			}
		}
		this.head = (this.head + 1) % this.capacity;
		this.size = Math.min(this.size + 1, this.capacity);
		const v = this.head * 4;
		vals[v] = value;
		vals[v + 1] = value;
		vals[v + 2] = value;
		vals[v + 3] = value;
		const m = this.head * 3;
		meta[m] = seq;
		meta[m + 1] = ((ord << 16) | 1) >>> 0;
		meta[m + 2] = ((off << 16) | off) >>> 0;
	}
}

/** A built view and what it was built from (see BucketRing.lastView). */
interface CachedView {
	readonly revision: number;
	readonly width: number;
	readonly now: number;
	readonly linkedKeys: readonly string[] | undefined;
	readonly view: HistoryView;
}

/** One run of observations of one identity (see identity.ts). */
export interface Segment {
	readonly ordinal: number;
	readonly source: SnapshotSource;
	/** measurementIdentityOf(reading): the provider key the saved key stood
	 * for, or a calculated reading with its revision. */
	readonly identity: string;
	readonly type: SensorType;
	readonly unit: string;
	readonly startAt: number;
	lastSampleAt: number;
	/** Set on close: always the last sample's time. */
	endAt?: number;
	endReason?: GapReason;
	/** Began after a moment's miss of this same measurement (see the top of
	 * this file), decided once, when its first sample arrives. */
	readonly brief?: true;
}

type Tiers = [BucketRing | null, BucketRing | null, BucketRing | null];

interface Series {
	readonly savedKey: string;
	readonly tiers: Tiers;
	/** Consumers asking for each tier. */
	readonly tierRefs: [number, number, number];
	/** When an allocated tier lost its last consumer; 0 while in use. */
	readonly tierLingerSince: [number, number, number];
	readonly consumers: Map<string, ReadonlySet<TierIndex>>;
	open: Segment | null;
	readonly closed: Segment[];
	nextOrdinal: number;
	lastValue: number;
	/** The newest sample's evidence age (NaN before the first sample). */
	lastEvidenceAgeMs: number;
	revision: number;
}

export interface HistoryStoreOptions {
	/** One-time warnings (the budget refusal). */
	log?: (line: string) => void;
	/** Monotonic clock for interest changes (ingest carries its own time). */
	now?: () => number;
	budgetBytes?: number;
	/** The Group panes' allowance (GROUP_HISTORY_BUDGET_BYTES). */
	groupBudgetBytes?: number;
	/** The Ambient share of it (AMBIENT_HISTORY_BUDGET_BYTES). */
	ambientBudgetBytes?: number;
	scheduledIntervalMs?: number;
}

/** Redacted support facts: counts and bytes, never a value or a key. */
export interface HistoryDiagnostics {
	series: number;
	lingering: number;
	/** Bytes the main budget pays for (keys, dials, strips). */
	bytes: number;
	budget: number;
	/** Window tiers consumers asked for that the budget refused. */
	overflow: number;
	/** The Group panes' allowance: its bytes, its size and the tiers it
	 * refused (also counted in overflow above). */
	group: { bytes: number; budget: number; overflow: number };
}

export class HistoryStore implements HistoryReader {
	private readonly series = new Map<string, Series>();
	/** Per consumer: saved key to the tiers it asked for. */
	private readonly interest = new Map<string, Map<string, ReadonlySet<TierIndex>>>();
	/** Consumers that asked with pool "group" (strip Group panes)
	 * or "ambient" (strip Ambient panes), by the pool they asked for. */
	private readonly groupConsumers = new Map<string, "group" | "ambient">();
	private readonly log: (line: string) => void;
	private readonly clock: () => number;
	private readonly budget: number;
	private readonly groupBudget: number;
	private readonly ambientBudget: number;
	private groupBytes = 0;
	/** The Ambient rings' bytes, also counted in groupBytes. */
	private ambientBytes = 0;
	private groupOverflowLogged = false;
	private scheduledIntervalMs: number;
	/** The longest interval scheduled before a cadence change, until the
	 * next tick: the poller restarts its timer without ticking, so the
	 * first tick after a change can come up to the old interval plus the new
	 * one after the last. 0 when no change is pending. */
	private carriedIntervalMs = 0;
	private bytes = 0;
	private rev = 0;
	private lastTickAt: number | null = null;
	private stoppedAt: number | null = null;
	/** When the tick-gap rule last ended every run (see noteWake). */
	private gapClosedAt: number | null = null;
	private overflowLogged = false;

	constructor(options: HistoryStoreOptions = {}) {
		this.log = options.log ?? ((): void => undefined);
		this.clock = options.now ?? monotonicNow;
		this.budget = options.budgetBytes ?? HISTORY_BUDGET_BYTES;
		this.groupBudget = options.groupBudgetBytes ?? GROUP_HISTORY_BUDGET_BYTES;
		this.ambientBudget = options.ambientBudgetBytes ?? AMBIENT_HISTORY_BUDGET_BYTES;
		this.scheduledIntervalMs = options.scheduledIntervalMs ?? 1000;
	}

	/** Bumps on any change to a retained series (a sample or a segment end). */
	get revision(): number {
		return this.rev;
	}

	setScheduledInterval(ms: number): void {
		if (!(Number.isFinite(ms) && ms > 0) || ms === this.scheduledIntervalMs) return;
		this.carriedIntervalMs = Math.max(this.carriedIntervalMs, this.scheduledIntervalMs);
		this.scheduledIntervalMs = ms;
	}

	/** The poller stopped (no visible action). Nothing closes here: on a
	 * single deck every page change stops and restarts within milliseconds.
	 * The next tick's gap decides, and names a long one "stopped". */
	noteStopped(at: number): void {
		this.stoppedAt = at;
	}

	/** The system woke from sleep at `at` (monotonic): whatever was open
	 * ended before it. A backstop to the tick-gap rule: when that rule
	 * already ended the pre-sleep runs, whatever is open now began after the
	 * wake and is kept. */
	noteWake(at: number): void {
		const sinceGap = this.gapClosedAt === null ? Number.NaN : at - this.gapClosedAt;
		if (sinceGap >= 0 && sinceGap <= WAKE_AFTER_GAP_MS) return;
		this.closeAll("sleep");
	}

	/** A pairing change re-derived the snapshot: end every segment whose
	 * saved key now stands for another measurement (or none). No samples. */
	realign(snapshot: SensorSnapshot, source: SnapshotSource): void {
		for (const series of this.series.values()) {
			if (series.open === null) continue;
			const reading = snapshot.byKey.get(series.savedKey);
			if (reading === undefined || !Number.isFinite(reading.value)) {
				this.close(series, "missing");
				continue;
			}
			const why = identityBreak(series.open, reading, source);
			if (why !== undefined) this.close(series, why);
		}
	}

	ingest(tick: HistoryTick): void {
		const at = tick.at;
		this.sweep(at);
		// Right after a cadence change the slower of the two cadences judges
		// the gap, once.
		const gapMs = Math.max(3 * Math.max(this.scheduledIntervalMs, this.carriedIntervalMs), MIN_TICK_GAP_MS);
		this.carriedIntervalMs = 0;
		if (this.lastTickAt !== null && at - this.lastTickAt > gapMs) {
			this.closeAll(this.stoppedAt !== null ? "stopped" : "sleep");
			this.gapClosedAt = at;
		}
		this.lastTickAt = at;
		this.stoppedAt = null;
		if (tick.kind !== "ok") {
			// A skipped read may have hidden a write, so every skip ends the run,
			// as every 1.7.1 ring did. The sample after it decides whether that
			// boundary was brief; stale or unavailable here replaces "skipped".
			this.closeAll(tick.kind);
			return;
		}
		for (const series of this.series.values()) {
			const reading = tick.snapshot.byKey.get(series.savedKey);
			if (reading === undefined || !Number.isFinite(reading.value)) {
				this.close(series, "missing");
				continue;
			}
			if (series.open !== null) {
				const why = identityBreak(series.open, reading, tick.source);
				if (why !== undefined) this.close(series, why);
			}
			if (!tick.evidence) continue;
			// The 1.7.1 dedupe: a same-value repeat under an unchanged stamp
			// is the same observation read twice.
			if (series.open !== null && !tick.stampAdvanced && Object.is(series.lastValue, reading.value)) continue;
			if (series.open === null) {
				const identity = measurementIdentityOf(reading);
				const brief = this.isBrief(series.closed[series.closed.length - 1], identity, reading, tick.source, at, tick.snapshot.producerPeriodMs);
				series.open = { ordinal: series.nextOrdinal++, source: tick.source, identity, type: reading.type, unit: reading.unit, startAt: at, lastSampleAt: at, ...(brief ? { brief: true } : {}) };
			}
			for (const ring of series.tiers) ring?.put(at, reading.value, series.open.ordinal);
			series.open.lastSampleAt = at;
			series.lastValue = reading.value;
			series.lastEvidenceAgeMs = Number.isFinite(tick.evidenceAgeMs) && tick.evidenceAgeMs > 0 ? tick.evidenceAgeMs : 0;
			series.revision++;
			this.rev++;
		}
	}

	setInterest(consumerId: string, entries: readonly HistoryInterest[], options?: HistoryInterestOptions): void {
		// The pool is the consumer's: a Group pane's interest is paid from
		// the group allowance, everything else from the main budget.
		const asked = options?.pool === "group" || options?.pool === "ambient" ? options.pool : undefined;
		const poolChanged = asked !== this.groupConsumers.get(consumerId);
		if (asked !== undefined) this.groupConsumers.set(consumerId, asked);
		else this.groupConsumers.delete(consumerId);
		const next = new Map<string, Set<TierIndex>>();
		for (const entry of entries) {
			if (typeof entry.savedKey !== "string" || entry.savedKey === "") continue;
			const windows: readonly unknown[] = Array.isArray(entry.window) ? entry.window : [entry.window];
			for (const raw of windows) {
				const window = parseHistoryWindow(raw);
				if (window === undefined) continue;
				const tiers = next.get(entry.savedKey) ?? new Set<TierIndex>();
				tiers.add(HISTORY_WINDOWS[window].tier);
				next.set(entry.savedKey, tiers);
			}
		}
		const previous = this.interest.get(consumerId);
		if (!poolChanged && sameInterest(previous, next)) return;
		if (next.size === 0) {
			this.interest.delete(consumerId);
			this.groupConsumers.delete(consumerId);
		} else {
			this.interest.set(consumerId, next);
		}
		const now = this.clock();
		for (const key of new Set([...(previous?.keys() ?? []), ...next.keys()])) {
			const tiers = next.get(key);
			const series = tiers === undefined ? this.series.get(key) : this.seriesFor(key);
			if (series === undefined) continue;
			if (tiers === undefined) series.consumers.delete(consumerId);
			else series.consumers.set(consumerId, tiers);
			this.reconcile(series, now);
		}
	}

	dropInterest(consumerId: string): void {
		if (!this.interest.has(consumerId) && !this.groupConsumers.has(consumerId)) return;
		this.setInterest(consumerId, []);
	}

	view(savedKey: string, window: HistoryWindowId, widthPx: number, now: number, linkedKeys?: readonly string[]): HistoryView | undefined {
		const id = parseHistoryWindow(window);
		const width = Math.floor(widthPx);
		if (id === undefined || !(width >= 1) || !Number.isFinite(now)) return undefined;
		const spec = HISTORY_WINDOWS[id];
		const series = this.series.get(savedKey);
		const ring = series?.tiers[spec.tier] ?? null;
		if (series === undefined || ring === null) return undefined;
		// A view is a pure function of the ring, the series revision, the
		// width, the instant and the linked keys, and it is frozen: asked
		// again for the same, the ring hands back the view it built (a dial
		// repaints every tick while the data holds still).
		const cached = ring.lastView;
		if (cached !== null && cached.revision === series.revision && cached.width === width && Object.is(cached.now, now) && sameKeys(cached.linkedKeys, linkedKeys)) return cached.view;
		const view = buildView({ ring, windowMs: spec.windowMs, open: series.open, closed: series.closed, revision: series.revision }, width, now, linkedKeys);
		ring.lastView = { revision: series.revision, width, now, linkedKeys: linkedKeys === undefined ? undefined : [...linkedKeys], view };
		return view;
	}

	refused(savedKey: string, window: HistoryWindowId): boolean {
		const id = parseHistoryWindow(window);
		const series = this.series.get(savedKey);
		if (id === undefined || series === undefined) return false;
		const tier = HISTORY_WINDOWS[id].tier;
		return series.tierRefs[tier] > 0 && series.tiers[tier] === null;
	}

	/** How old the producer's evidence already was when the newest sample
	 * of this series was taken, for a data-age readout (never a position);
	 * undefined while the series holds no sample. */
	evidenceAgeOf(savedKey: string): number | undefined {
		const age = this.series.get(savedKey)?.lastEvidenceAgeMs;
		return age === undefined || Number.isNaN(age) ? undefined : age;
	}

	diagnostics(): HistoryDiagnostics {
		let lingering = 0;
		let overflow = 0;
		let groupOverflow = 0;
		for (const series of this.series.values()) {
			if (series.consumers.size === 0) lingering++;
			for (const t of TIER_INDICES) {
				if (series.tierRefs[t] > 0 && series.tiers[t] === null) {
					overflow++;
					if (this.poolWanted(series, t) !== "main") groupOverflow++;
				}
			}
		}
		return { series: this.series.size, lingering, bytes: this.bytes, budget: this.budget, overflow, group: { bytes: this.groupBytes, budget: this.groupBudget, overflow: groupOverflow } };
	}

	/** The Ambient share of the group allowance: its bytes (also counted in
	 * diagnostics().group.bytes) and its size. Counts only. */
	ambientShare(): { bytes: number; budget: number } {
		return { bytes: this.ambientBytes, budget: this.ambientBudget };
	}

	/** The allowance a wanted tier is paid from: the main budget while any
	 * consumer outside the strip's rule panes asks for it, else the group's
	 * while a Group pane asks for it, else the Ambient share. */
	private poolWanted(series: Series, t: TierIndex): InterestPool {
		let pool: InterestPool = "ambient";
		for (const [consumer, tiers] of series.consumers) {
			if (!tiers.has(t)) continue;
			const asked = this.groupConsumers.get(consumer);
			if (asked === undefined) return "main";
			if (asked === "group") pool = "group";
		}
		return pool;
	}

	/** Whether `n` more bytes fit the pool: an Ambient ring must fit both
	 * the group allowance and the Ambient share of it. */
	private fits(pool: InterestPool, n: number): boolean {
		if (pool === "main") return this.bytes + n <= this.budget;
		if (pool === "ambient" && this.ambientBytes + n > this.ambientBudget) return false;
		return this.groupBytes + n <= this.groupBudget;
	}

	private budgetOf(pool: InterestPool): number {
		return pool === "main" ? this.budget : pool === "ambient" ? Math.min(this.ambientBudget, this.groupBudget) : this.groupBudget;
	}

	private addBytes(pool: InterestPool, n: number): void {
		if (pool === "main") this.bytes += n;
		else this.groupBytes += n;
		if (pool === "ambient") this.ambientBytes += n;
	}

	private seriesFor(savedKey: string): Series {
		let series = this.series.get(savedKey);
		if (series === undefined) {
			series = {
				savedKey,
				tiers: [null, null, null],
				tierRefs: [0, 0, 0],
				tierLingerSince: [0, 0, 0],
				consumers: new Map(),
				open: null,
				closed: [],
				nextOrdinal: 0,
				lastValue: Number.NaN,
				lastEvidenceAgeMs: Number.NaN,
				revision: 0
			};
			this.series.set(savedKey, series);
		}
		return series;
	}

	/** Brings a series' tiers in line with its consumers: wanted tiers are
	 * allocated (empty: the view starts as short history) and stop
	 * lingering, unwanted ones start lingering. A series with neither
	 * consumers nor tiers is forgotten. */
	private reconcile(series: Series, now: number): void {
		for (const t of TIER_INDICES) {
			let refs = 0;
			for (const tiers of series.consumers.values()) if (tiers.has(t)) refs++;
			series.tierRefs[t] = refs;
			if (refs > 0) {
				series.tierLingerSince[t] = 0;
				if (series.tiers[t] === null) this.allocate(series, t, now);
				else this.repool(series.tiers[t] as BucketRing, this.poolWanted(series, t));
			} else if (series.tiers[t] !== null && series.tierLingerSince[t] === 0) {
				// Never 0 while lingering: 0 is the in-use marker.
				series.tierLingerSince[t] = now || 1;
				// Nobody draws a lingering tier: its last view goes now.
				(series.tiers[t] as BucketRing).lastView = null;
			}
		}
		if (series.consumers.size === 0 && series.tiers.every((ring) => ring === null)) this.series.delete(series.savedKey);
	}

	private allocate(series: Series, t: TierIndex, now: number): void {
		const pool = this.poolWanted(series, t);
		const need = (TIERS[t] as { capacity: number }).capacity * ENTRY_BYTES;
		const budget = this.budgetOf(pool);
		while (!this.fits(pool, need) && this.evictOldestLingering(pool, need)) {
			// Lingering tiers of the same allowance go first, oldest release first.
		}
		if (!this.fits(pool, need)) {
			if (pool !== "main") {
				if (!this.groupOverflowLogged) {
					this.groupOverflowLogged = true;
					this.log(`Group history allowance reached (${Math.round(budget / 1024)} KiB): a Group graph says "history full" for the readings it cannot keep`);
				}
			} else if (!this.overflowLogged) {
				this.overflowLogged = true;
				this.log(`History budget reached (${Math.round(budget / 1024)} KiB): a refused window draws recent samples on a key or dial, and "no history room" on a strip`);
			}
			return;
		}
		const ring = new BucketRing(t, now);
		ring.pool = pool;
		series.tiers[t] = ring;
		this.addBytes(pool, ring.bytes);
	}

	/** Moves a ring to the allowance its consumers now call for, when that
	 * allowance has room; else it stays where it is paid for (it is already
	 * counted, and nothing it holds is lost). */
	private repool(ring: BucketRing, pool: InterestPool): void {
		if (ring.pool === pool) return;
		this.addBytes(ring.pool, -ring.bytes);
		if (!this.fits(pool, ring.bytes)) {
			this.addBytes(ring.pool, ring.bytes);
			return;
		}
		ring.pool = pool;
		this.addBytes(pool, ring.bytes);
	}

	/** Frees the oldest lingering ring that makes room for `need` bytes in
	 * `pool`: of the main budget for main; of the group allowance (Group or
	 * Ambient rings) for a group ring; for an Ambient ring, an
	 * Ambient one while the Ambient share is what is full. */
	private evictOldestLingering(pool: InterestPool, need = 0): boolean {
		const shareFull = pool === "ambient" && this.ambientBytes + need > this.ambientBudget;
		const counts = (ring: BucketRing): boolean => (pool === "main" ? ring.pool === "main" : shareFull ? ring.pool === "ambient" : ring.pool !== "main");
		let oldest: { series: Series; t: TierIndex; since: number } | null = null;
		for (const series of this.series.values()) {
			for (const t of TIER_INDICES) {
				const since = series.tierLingerSince[t];
				const ring = series.tiers[t];
				if (ring !== null && counts(ring) && since !== 0 && (oldest === null || since < oldest.since)) oldest = { series, t, since };
			}
		}
		if (oldest === null) return false;
		this.free(oldest.series, oldest.t);
		return true;
	}

	private free(series: Series, t: TierIndex): void {
		const ring = series.tiers[t];
		if (ring === null) return;
		this.addBytes(ring.pool, -ring.bytes);
		series.tiers[t] = null;
		series.tierLingerSince[t] = 0;
		if (series.consumers.size === 0 && series.tiers.every((r) => r === null)) this.series.delete(series.savedKey);
	}

	/** Frees tiers whose linger ran out, and retries tiers the budget
	 * refused once room exists. Allocation-free while nothing changes (a
	 * Map tolerates deletes during its own iteration). */
	private sweep(now: number): void {
		for (const series of this.series.values()) {
			for (const t of TIER_INDICES) {
				const since = series.tierLingerSince[t];
				if (series.tiers[t] !== null && since !== 0 && now - since >= LINGER_MS) this.free(series, t);
				else if (series.tiers[t] === null && series.tierRefs[t] > 0) this.allocate(series, t, now);
			}
		}
	}

	/** Whether a segment starting now continues `before` after a moment's miss. */
	private isBrief(before: Segment | undefined, identity: string, reading: Reading, source: SnapshotSource, at: number, producerPeriodMs: number | undefined): boolean {
		if (before?.endReason !== "skipped" || before.identity !== identity || before.source !== source || before.unit !== reading.unit || before.type !== reading.type) return false;
		return at - before.lastSampleAt <= Math.max(MIN_BRIEF_GAP_MS, BRIEF_GAP_SCANS * Math.max(producerPeriodMs ?? 0, this.scheduledIntervalMs));
	}

	private close(series: Series, reason: GapReason): void {
		const open = series.open;
		if (open === null) {
			// Already ended by a skipped read, and now something more is known
			// about why nothing arrived: the newer reason is the true one.
			const last = series.closed[series.closed.length - 1];
			if (last?.endReason !== "skipped" || reason === "skipped") return;
			last.endReason = reason;
			series.revision++;
			this.rev++;
			return;
		}
		open.endAt = open.lastSampleAt;
		open.endReason = reason;
		series.closed.push(open);
		if (series.closed.length > CLOSED_SEGMENTS) series.closed.shift();
		series.open = null;
		series.revision++;
		this.rev++;
	}

	private closeAll(reason: GapReason): void {
		for (const series of this.series.values()) this.close(series, reason);
	}
}

function sameKeys(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

function sameInterest(a: ReadonlyMap<string, ReadonlySet<TierIndex>> | undefined, b: ReadonlyMap<string, ReadonlySet<TierIndex>>): boolean {
	if ((a?.size ?? 0) !== b.size) return false;
	for (const [key, tiers] of b) {
		const other = a?.get(key);
		if (other === undefined || other.size !== tiers.size) return false;
		for (const t of tiers) if (!other.has(t)) return false;
	}
	return true;
}
