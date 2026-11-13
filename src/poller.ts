/**
 * The single shared HWiNFO poller. Actions retain/release it as they appear
 * and disappear; it opens ONE data source regardless of how many keys and
 * dials are visible, and fans out a status on every tick.
 *
 * Sources (see provider.ts): shared memory is preferred; in "auto" mode the
 * Gadget registry is the fallback (free HWiNFO disables shared memory after
 * 12 h — gadget reporting never expires), with periodic probes to upgrade
 * back to shared memory when it returns.
 *
 * State machine:
 *   ok ──(pollTime frozen > 15 s)──▶ stale ──(backend gone)──▶ unavailable
 *    ▲                                 │ (probe re-open every 5 s)
 *    └────────(pollTime advances)──────┘
 * `unavailable` re-attempts a full open every tick (cheap: one failing
 * OpenFileMappingW / RegOpenKeyExW), so recovery is automatic. The one
 * exception is a present-but-empty Gadget key: it opens, and the bounded VSB
 * scan runs before the source is refused as "gadget-empty".
 *
 * Evidence contract: opening a provider is not receiving a measurement.
 * `lastAdvanceAt` moves only when an accepted observation carries new
 * producer evidence, so a source switch, a reopen probe or a page return
 * keeps the held observation's real age, and the published `source` is
 * always the provenance of the snapshot held in the status, never merely
 * the provider that happens to be open. The freshness record survives the
 * poller stopping with the last visible action (every page change on a
 * single deck does that), and a Shared Memory stamp is aged by the wall
 * clock it was written from, so a producer that had already stopped, before
 * or during an absence, never reads as live for a window.
 *
 * A poisoned session (the hwsm bridge invalidates on any layout change; a
 * game start adding GPU readings does it routinely) is reopened at the new
 * exact size and re-read WITHIN the same tick, and a reopen failure rides
 * on the last rendered status for up to STALE_AFTER_MS before surfacing.
 * The pre-hwsm builds mapped the whole section and absorbed layout growth
 * invisibly; this keeps that visible behavior without weakening the native
 * exact-length contract. Diagnostic reasons (disabled, access-denied,
 * bridge-failed) still surface immediately.
 */
import streamDeck from "@elgato/streamdeck";
import { EventEmitter } from "node:events";

import { monotonicNow } from "./clock";
import { HistoryStore, type HistoryTick } from "./history/store";
import { calculatedReadingsSignature, measurementIdentityOf, NO_CALCULATED_READINGS, parseCalculatedReadings, withCalculatedReadings, type CalculatedPlan } from "./hwinfo/calculated";
import { GadgetRegistryProvider } from "./hwinfo/gadget-registry";
import { ReadingCatalog } from "./hwinfo/link-pairing";
import { applyReadingLinks, parseReadingLinks, readingLinksSignature, type ReadingLink } from "./hwinfo/reading-links";
import { SharedMemoryProvider, type SnapshotProvider, type SnapshotSource } from "./hwinfo/provider";
import { HwinfoError, type HwinfoUnavailableReason, type Reading, type SensorSnapshot } from "./hwinfo/types";
import { pushSample } from "./series";

export type PollerStatus =
	| { state: "ok"; snapshot: SensorSnapshot; source: SnapshotSource }
	| { state: "stale"; snapshot: SensorSnapshot; source: SnapshotSource; staleForMs: number }
	| { state: "unavailable"; reason: HwinfoUnavailableReason; message: string };

export type SourceMode = "auto" | "shared-memory" | "gadget";

const DEFAULT_INTERVAL_MS = 1000;
/**
 * A busy read is a collision with a hold of about a millisecond, so one more
 * look a moment later gets the same snapshot. Measured on HWiNFO 8.48: holds
 * on a strict 1000 ms grid, swept by a 1007 ms tick about every 139 s, and
 * the first look 15 ms later succeeded every time. Bounded, so a mutex that
 * stays held still ends in a skipped read and the freshness check. Only the
 * running timer retries: a direct tick (a page return's first read) has a
 * caller reading the status right after it, so it is judged at once.
 */
export const BUSY_RETRY_MS = 25;
export const BUSY_RETRIES = 6;
const MIN_INTERVAL_MS = 250;
const MAX_INTERVAL_MS = 60_000;
// Both timings are env-overridable so the resilience e2e can force the
// stale/unavailable transitions in seconds instead of minutes.
/** pollTime frozen for longer than this ⇒ HWiNFO stopped sharing. */
const STALE_AFTER_MS = Number(process.env.HWINFO_STALE_AFTER_MS ?? "") || 15_000;
/** While stale, probe a fresh open at most this often. */
const REOPEN_PROBE_MS = Number(process.env.HWINFO_REOPEN_PROBE_MS ?? "") || 5_000;
/** While on the gadget fallback in auto mode, probe shared memory this often. */
const UPGRADE_PROBE_MS = Number(process.env.HWINFO_UPGRADE_PROBE_MS ?? "") || 15_000;

/**
 * How old a Shared Memory stamp already is, by the wall clock it was written
 * from (HWiNFO stamps each poll with UTC epoch seconds). A stamp that is not
 * a wall-clock time (test fixtures count from small integers) or that lies
 * in the future cannot be aged and counts as new.
 */
function stampAgeMs(pollTime: number): number {
	if (!(pollTime > 1_000_000_000)) return 0;
	return Math.max(0, Date.now() - pollTime * 1000);
}

export function parsePollInterval(raw: unknown): number {
	const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : Number.NaN;
	if (!Number.isFinite(n)) {
		return DEFAULT_INTERVAL_MS;
	}
	return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(n)));
}

export function parseSourceMode(raw: unknown): SourceMode {
	return raw === "shared-memory" || raw === "gadget" ? raw : "auto";
}

class HwinfoPoller extends EventEmitter {
	private readonly logger = streamDeck.logger.createScope("HwinfoPoller");
	private provider: SnapshotProvider | null = null;
	private timer: NodeJS.Timeout | null = null;
	private refs = 0;
	private intervalMs = DEFAULT_INTERVAL_MS;
	private busyRetries = 0;
	private busyTimer: NodeJS.Timeout | null = null;
	private busyLogged = false;
	private mode: SourceMode = "auto";
	private lastPollTime = -1;
	private lastValueRevision: number | undefined;
	private revisionProvider: SnapshotProvider | null = null;
	private lastFreshnessRevision: number | undefined;
	private seriesSource: SnapshotSource | undefined;
	/** Per subscribed key: the measurement identity (live key, type, unit)
	 * its ring currently describes. A change ends the segment in place. */
	private readonly seriesIdentity = new Map<string, string>();
	private readingLinks: readonly ReadingLink[] = [];
	/** The empty list's signature, so the first delivery of an absent or
	 * empty document (every launch) is not a pairing change. */
	private readingLinksSignature = readingLinksSignature([]);
	/** The plugin-side calculated readings (src/hwinfo/calculated.ts),
	 * derived after links on every published snapshot. */
	private calculated: CalculatedPlan = NO_CALCULATED_READINGS;
	/** The empty plan's signature, so an absent or empty first delivery is
	 * not a change (the readingLinks rule). */
	private calculatedSignature = calculatedReadingsSignature(NO_CALCULATED_READINGS);
	private bindingRevision = 0;
	/** Monotonic time of the last accepted observation that carried new
	 * producer evidence; 0 until the first one. Never set by an open. */
	private lastAdvanceAt = 0;
	/** Monotonic time of the last accepted (non-null) read, evidence or not.
	 * Bounds the transient hold for a source that has no evidence clock yet
	 * (a cold Gadget key shows Age unknown without ever advancing). */
	private lastAcceptedAt = 0;
	private lastReopenProbeAt = 0;
	/** Freshness surviving a stale probe whose reopen threw (see probeReopen). */
	private heldFreshness: { source: SnapshotSource; pollTime: number; advanceAt: number; heldAt: number; valueRevision?: number; freshnessRevision?: number; gadget?: GadgetRegistryProvider } | null = null;
	private lastUpgradeProbeAt = 0;
	/** Nonzero while a transient failure is being ridden out on held values. */
	private holdingSince = 0;
	/** The provider's own observation behind the published status and its
	 * provenance. The status snapshot is DERIVED from it (reading links
	 * applied); a pairing edit re-derives from here, never from the
	 * already-aliased view. Cleared whenever the status goes unavailable. */
	private lastRaw: { snapshot: SensorSnapshot; source: SnapshotSource } | null = null;
	private status: PollerStatus = { state: "unavailable", reason: "not-running", message: "Not polled yet." };
	// Per-reading recent-value ring backing the key sparkline. It lives here,
	// not in per-key action state, so it outlives every willAppear (the action
	// wiped its own history on each appear — page-nav / reconnect / wake all
	// reset the sparkline). Once tracked, a ring is fed on every fresh
	// snapshot and lives for the process: paging away keeps the line as long
	// as something else keeps the poller running (with nothing visible it
	// stops, and the ring resumes where it left off). A ring only exists for readings a
	// visible key or dial row asked for at least once, and holds at most the
	// sparkline's sample cap, so the whole map stays kilobytes-small. Native
	// values; converted only at render.
	private readonly series = new Map<string, number[]>();
	/**
	 * The timestamped history behind Trend windows (src/history/store.ts):
	 * fed once per tick, after the staleness decision, beside the legacy
	 * rings above, which it never touches. Consumers set and drop their
	 * interest by id and read frozen views; the poller alone ingests.
	 */
	readonly history = new HistoryStore({ log: (line) => this.logger.warn(line), scheduledIntervalMs: DEFAULT_INTERVAL_MS });
	/**
	 * The readings each provider showed in this session (metadata only,
	 * bounded per provider), for the settings panel's link editor: a pair
	 * can still be confirmed after Auto fell back to Gadget. Fed the
	 * provider's own snapshot on every accepted read; an unchanged skeleton
	 * costs one comparison. Never consulted by the read path itself.
	 */
	readonly catalog = new ReadingCatalog();

	/** Latest status; safe to read at any time (e.g. right after willAppear). */
	getStatus(): PollerStatus {
		return this.status;
	}

	/** True while a transient failure is being ridden out on the last
	 * values (the status still reads as it did before the failure). Read by
	 * the settings panel only, so it never calls held values live. */
	isHolding(): boolean {
		return this.holdingSince !== 0;
	}

	/**
	 * Adopts the deck's explicit cross-provider pairs. The list is compared
	 * by meaning (readingLinksSignature), so re-applying or reordering the
	 * same pairs changes nothing. A real change republishes the held
	 * observation under the new pairing at once: a removed alias stops
	 * resolving at the settings commit, not at the next successful read,
	 * and consumers see one consistent view (re-derived from the raw
	 * observation) through the same tick event a read would emit. The
	 * re-emit carries no new measurement, so sessions and rings (which
	 * dedupe on producer evidence and identity) gain no samples from it.
	 */
	setReadingLinks(raw: unknown): void {
		const links = parseReadingLinks(raw);
		const signature = readingLinksSignature(links);
		if (signature === this.readingLinksSignature) return;
		this.readingLinksSignature = signature;
		this.readingLinks = links;
		this.bindingRevision++;
		this.republish();
	}

	/**
	 * Adopts the deck's calculated readings (the global calculatedReadings
	 * list), compared by meaning like the links: a re-delivery of the same
	 * definitions, or of a document that differs only in fields the parser
	 * does not read, changes nothing. A real change republishes the held
	 * observation at once, with no read: a recalculation is never new
	 * evidence, so rings and sessions gain no sample from it, and a
	 * definition whose meaning changed (its definitionRevision) ends its
	 * ring, session and history segment through the measurement identity.
	 * A label edit repaints and resets nothing.
	 */
	setCalculatedReadings(raw: unknown): void {
		const plan = parseCalculatedReadings(raw);
		const signature = calculatedReadingsSignature(plan);
		if (signature === this.calculatedSignature) return;
		this.calculatedSignature = signature;
		this.calculated = plan;
		this.bindingRevision++;
		this.republish();
	}

	/** The calculated readings in force (the panel's editor reads verdicts
	 * and expressions from it). */
	getCalculatedPlan(): CalculatedPlan {
		return this.calculated;
	}

	/** The provider's own observation behind the published status, before
	 * links and calculations, with its provenance; null
	 * while unavailable. Read-only: the link editor judges link health
	 * against it. */
	getRawObservation(): { readonly snapshot: SensorSnapshot; readonly source: SnapshotSource } | null {
		return this.lastRaw;
	}

	/** The held observation with the links in force applied, and no
	 * calculated readings: what the calculation editor evaluates a draft
	 * over (with its own plan). Null while unavailable. Read-only. */
	getLinkedObservation(): SensorSnapshot | null {
		if (this.lastRaw === null || this.status.state === "unavailable") return null;
		return applyReadingLinks(this.lastRaw.snapshot, this.readingLinks, this.bindingRevision);
	}

	/** The Data source preference (Auto, or one provider forced). */
	getSourceMode(): SourceMode {
		return this.mode;
	}

	/** Re-derives the held observation under the current links and
	 * calculations and tells consumers once, through the
	 * same tick event a read emits. The re-emit carries no new measurement,
	 * so sessions and rings (which dedupe on producer evidence and identity)
	 * gain no samples from it. A ring or history segment whose saved key now
	 * stands for another measurement (or for nothing) ends before anyone
	 * draws it under the new view. */
	private republish(): void {
		if (this.lastRaw === null || this.status.state === "unavailable") return;
		const snapshot = this.derive(this.lastRaw);
		this.status = this.status.state === "ok" ? { state: "ok", snapshot, source: this.status.source } : { ...this.status, snapshot };
		for (const [key, ring] of this.series) this.alignRing(key, ring, snapshot);
		this.history.realign(snapshot, this.status.source);
		this.emit("tick", this.status);
	}

	/**
	 * The published view of a raw local observation: the reading links,
	 * then the calculated readings over the linked view (so an input saved
	 * as either endpoint of a pair resolves). With no links and no
	 * definitions this is the provider's snapshot itself, the same instance.
	 */
	private derive(raw: { snapshot: SensorSnapshot; source: SnapshotSource }): SensorSnapshot {
		return withCalculatedReadings(applyReadingLinks(raw.snapshot, this.readingLinks, this.bindingRevision), this.calculated);
	}

	/**
	 * Keeps a ring describing one measurement in one unit. A key the
	 * snapshot cannot resolve, a non-finite value, a saved key that came to
	 * stand for another measurement (a re-paired link) or a rewritten unit
	 * ends the segment in place. Returns the reading the ring may be fed.
	 */
	private alignRing(key: string, ring: number[], snapshot: SensorSnapshot): Reading | undefined {
		const reading = snapshot.byKey.get(key);
		if (reading === undefined || !Number.isFinite(reading.value)) {
			ring.length = 0;
			return undefined;
		}
		const identity = `${measurementIdentityOf(reading)}|${reading.type}:${reading.unit}`;
		if (this.seriesIdentity.get(key) !== identity) ring.length = 0;
		this.seriesIdentity.set(key, identity);
		return reading;
	}

	/** Redacted data-source facts for the support report (no sensor values). */
	diagnostics(): { state: string; reason?: string; source?: string; readings?: number; intervalMs: number; polling: boolean; retained: number; sampleAgeMs: number | null } {
		const status = this.status;
		return {
			state: status.state,
			...(status.state === "unavailable" ? { reason: status.reason } : { source: status.source, readings: status.snapshot.readings.length }),
			intervalMs: this.intervalMs,
			polling: this.timer !== null,
			retained: this.refs,
			sampleAgeMs: status.state === "unavailable" || (status.source === "gadget" && status.snapshot.pollTime === 0) || this.lastAdvanceAt === 0 ? null : monotonicNow() - this.lastAdvanceAt
		};
	}

	onTick(listener: (status: PollerStatus) => void): void {
		this.on("tick", listener);
	}

	/** The system woke from sleep (the SDK's systemDidWakeUp): every open
	 * history segment ended before it, unless the overdue tick on resume
	 * already ended them through the tick-gap rule (then what is open began
	 * after the wake). The tick-gap rule alone covers a missed event. */
	noteWake(): void {
		this.history.noteWake(monotonicNow());
	}

	/** An action subscribes a reading so the poller collects that sparkline's
	 *  history. Keys subscribe their selection; dials subscribe the two-row
	 *  view's visible rows. The ring then lives for the process lifetime;
	 *  there is no unsubscribe, so a reading that comes back on screen
	 *  resumes its line from the samples the ring already holds. */
	subscribeSeries(key: string): void {
		if (!this.series.has(key)) {
			this.series.set(key, []);
		}
	}

	/** The reading's recent NATIVE values (newest last), or undefined if none. */
	getSeries(key: string): readonly number[] | undefined {
		return this.series.get(key);
	}

	/** Called by actions on willAppear. Starts polling with the first retain. */
	retain(): void {
		this.refs++;
		if (this.refs === 1) {
			this.start();
		}
	}

	/** Called by actions on willDisappear. Stops polling with the last release. */
	release(): void {
		this.refs = Math.max(0, this.refs - 1);
		if (this.refs === 0) {
			this.stop();
		}
	}

	setIntervalMs(ms: number): void {
		if (ms === this.intervalMs) {
			return;
		}
		this.intervalMs = ms;
		// Timestamped history needs no reset: only its tick-gap threshold
		// follows the scheduled interval.
		this.history.setScheduledInterval(ms);
		// The ring is index-spaced, not timestamped, so it cannot honestly
		// span a cadence change: empty every ring in place. The map KEYS are
		// the subscriptions (see subscribeSeries), so clearing the map would
		// end collection for every visible key until its action replayed;
		// nothing resubscribes a static visible key, and the globals response
		// lands after the first willAppear subscriptions, so a saved
		// non-default interval also fired this once on every launch.
		for (const ring of this.series.values()) {
			ring.length = 0;
		}
		this.logger.info(`Poll interval set to ${ms} ms`);
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = setInterval(() => this.tick(true), this.intervalMs).unref(); // see start()
		}
	}

	setSourceMode(mode: SourceMode): void {
		if (mode === this.mode) {
			return;
		}
		this.mode = mode;
		this.logger.info(`Source mode set to ${mode}`);
		// The mode is a preference, not a source: Auto to Shared Memory while
		// on shared memory reopens the same producer, whose age carries over.
		// A different source discards the record in restoreFreshness.
		this.preserveFreshness();
		this.dropProvider();
		if (this.timer !== null) {
			this.tick();
		}
	}

	private start(): void {
		if (this.timer !== null) {
			return;
		}
		this.logger.info(`Started (${this.intervalMs} ms interval)`);
		// unref'd: the Stream Deck socket is what keeps this process alive, and
		// it should be the ONLY thing. The SDK has no close handler and never
		// reconnects, and ws drops sends after a close without raising, so a
		// socket that dies while keys are visible would otherwise leave a
		// plugin polling HWiNFO forever, painting into nothing, with no log
		// line. With the timer unref'd the loop drains and the process exits,
		// which is exactly what the e2e already asserts for the idle case.
		this.timer = setInterval(() => this.tick(true), this.intervalMs).unref();
		this.tick();
	}

	private stop(): void {
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.clearBusyRetry();
		// On a single deck every page change, drill-down entry and Back
		// releases the last action before the first one of the next page
		// retains: the record must outlive that gap, or a Gadget source would
		// fall back to "Age unknown" on every page and a frozen Shared Memory
		// stamp would read as new.
		this.preserveFreshness();
		this.dropProvider();
		// History segments stay open: the next tick's gap decides (a page
		// change restarts within milliseconds and must not cut every line).
		this.history.noteStopped(monotonicNow());
		// Info on purpose: the e2e exit-hygiene check greps for this line to
		// prove the poller idles (timer cleared, provider closed) with no keys.
		this.logger.info("Stopped (no visible actions)");
	}

	private dropProvider(): void {
		this.provider?.close();
		this.provider = null;
		this.lastPollTime = -1;
	}

	/** A replacement session is not evidence that its producer advanced. */
	private preserveFreshness(): void {
		if (this.provider === null || this.heldFreshness !== null) return;
		this.heldFreshness = {
			source: this.provider.source,
			pollTime: this.lastPollTime,
			advanceAt: this.lastAdvanceAt,
			heldAt: monotonicNow(),
			valueRevision: this.lastValueRevision,
			freshnessRevision: this.lastFreshnessRevision,
			...(this.provider instanceof GadgetRegistryProvider ? { gadget: this.provider } : {})
		};
	}

	/**
	 * Carries the held freshness into a same-source replacement session. A
	 * different source, or no held record at all (a cold open), leaves
	 * `lastAdvanceAt` where the last accepted observation put it: the open
	 * itself is not evidence. A Gadget baseline is comparable only while it
	 * is recent: against values held from a long absence, a change that
	 * happened at any point in between would pose as a change seen now.
	 */
	private restoreFreshness(): void {
		const held = this.heldFreshness;
		if (held !== null && held.source === this.provider?.source) {
			this.lastPollTime = held.pollTime;
			this.lastAdvanceAt = held.advanceAt;
			this.lastValueRevision = held.valueRevision;
			this.lastFreshnessRevision = held.freshnessRevision;
			if (held.gadget && this.provider instanceof GadgetRegistryProvider) {
				this.provider.adoptFreshness(held.gadget, monotonicNow() - held.heldAt <= STALE_AFTER_MS);
			}
		}
		this.heldFreshness = null;
	}

	/** Opens the preferred source; in auto mode shared memory wins, gadget is the fallback. */
	private openProvider(): SnapshotProvider {
		if (this.mode === "shared-memory") {
			return SharedMemoryProvider.open();
		}
		if (this.mode === "gadget") {
			return GadgetRegistryProvider.open();
		}
		try {
			return SharedMemoryProvider.open();
		} catch (primary) {
			// Open-time mutex contention proves shared memory exists and HWiNFO
			// is running: retry it next tick instead of switching the deck to
			// the Gadget namespace, whose reading keys differ, so every
			// shared-memory key would read "Sensor missing" until the upgrade
			// probe swung back (up to 15 s for a millisecond collision).
			if (primary instanceof HwinfoError && primary.reason === "busy") {
				throw primary;
			}
			try {
				return GadgetRegistryProvider.open();
			} catch (fallback) {
				// A present-but-empty gadget key means the user is set up for
				// Gadget reporting and just needs to tick sensors — that beats
				// shared memory's generic "not running", but must never mask a
				// more specific primary diagnosis (access-denied, disabled).
				// The same goes for a Gadget key that opened but whose scan
				// was refused (a changing registry, or a value that is not
				// text): HWiNFO is set up for Gadget, so "start HWiNFO" would
				// send the user the wrong way.
				if (
					fallback instanceof HwinfoError &&
					(fallback.reason === "gadget-empty" || fallback.reason === "busy" || fallback.reason === "invalid") &&
					primary instanceof HwinfoError &&
					primary.reason === "not-running"
				) {
					throw fallback;
				}
				throw primary;
			}
		}
	}

	private clearBusyRetry(): void {
		if (this.busyTimer !== null) clearTimeout(this.busyTimer);
		this.busyTimer = null;
		this.busyRetries = 0;
	}

	private tick(polling = false): void {
		// A tick that arrives during a retry takes its place.
		if (this.busyTimer !== null) {
			clearTimeout(this.busyTimer);
			this.busyTimer = null;
		}
		// One acquisition time per tick places every history sample.
		const tickAt = monotonicNow();
		let historyTick: HistoryTick = { kind: "skipped", at: tickAt };
		try {
			if (this.provider === null) {
				this.provider = this.openProvider();
				this.restoreFreshness();
				this.logger.info(`Opened HWiNFO data source: ${this.provider.source}`);
			}
			this.maybeUpgradeToSharedMemory();

			let snapshot: SensorSnapshot | null;
			let historyEvidence = false;
			let historyStampAdvanced = false;
			let historyEvidenceAgeMs = 0;
			try {
				snapshot = this.provider.read();
			} catch (err) {
				if (!(err instanceof HwinfoError) || err.reason !== "invalid") {
					throw err;
				}
				// Poisoned session (layout changed): reopen at the new exact size
				// and read again within the same tick, so live values never leave
				// the keys. A failure here falls to the hold in the outer catch.
				const poisoned = this.provider.source;
				this.preserveFreshness();
				this.dropProvider();
				this.provider = this.openProvider();
				this.restoreFreshness();
				snapshot = this.provider.read();
				// Auto mode can come back on the other source (the free
				// version's expiry does exactly that): a provider change is
				// logged as one, never as an in-place reopen.
				this.logger.info(this.provider.source === poisoned
					? `Data source layout changed; reopened in place (${this.provider.source})`
					: `Opened HWiNFO data source: ${this.provider.source} (${poisoned} became unreadable)`);
			}
			if (snapshot === null && polling && this.provider.source === "shared-memory") {
				if (this.busyRetries < BUSY_RETRIES) {
					this.busyRetries++;
					this.busyTimer = setTimeout(() => {
						this.busyTimer = null;
						this.tick(true);
					}, BUSY_RETRY_MS).unref();
					return;
				}
				if (!this.busyLogged) {
					this.busyLogged = true;
					this.logger.info(`HWiNFO's mutex stayed busy through ${BUSY_RETRIES} retries; this read is skipped`);
				}
			}
			if (snapshot !== null) this.busyLogged = false;
			this.busyRetries = 0;
			for (const line of this.provider.notices?.() ?? []) this.logger.warn(line);
			this.holdingSince = 0;
			// Evidence is judged on the provider's own observation, before the
			// links and calculated readings derive the published view.
			const raw = snapshot;
			let evidenceChanged = false;
			let stampChanged = false;
			if (raw !== null) {
				this.lastRaw = { snapshot: raw, source: this.provider.source };
				this.lastAcceptedAt = monotonicNow();
				this.catalog.observe(raw, this.provider.source, this.lastAcceptedAt);
				const sourceChanged = this.seriesSource !== this.provider.source;
				if (sourceChanged) {
					for (const ring of this.series.values()) ring.length = 0;
					this.seriesSource = this.provider.source;
					// An accepted observation owns its source's evidence clock.
					// A recent Gadget change cannot make an old Shared Memory
					// stamp live, nor give a cold Gadget key a known sample age.
					// Skipped reads never enter here, so held values keep theirs.
					this.lastAdvanceAt = 0;
					this.lastValueRevision = undefined;
					this.lastFreshnessRevision = undefined;
				}
				stampChanged = raw.pollTime !== this.lastPollTime;
				// Revisions belong to one parser, not the producer. Its initial
				// decode after reopen must never refresh a frozen timestamp.
				// freshnessRevision counts finite value changes only; stamp-only
				// evidence must keep its producer age even within one parser.
				const evidenceRevision = raw.freshnessRevision ?? raw.valueRevision;
				const previousEvidenceRevision = this.lastFreshnessRevision ?? this.lastValueRevision;
				const revisionChanged = this.revisionProvider === this.provider && evidenceRevision !== undefined && evidenceRevision !== previousEvidenceRevision;
				evidenceChanged = this.provider.source === "gadget"
					? (raw.freshnessRevision ?? 0) > 0 && (stampChanged || raw.freshnessRevision !== this.lastFreshnessRevision)
					: stampChanged || revisionChanged;
				// Gadget has no per-row stamp: a scan that moved any row makes
				// every row's value a fresh sample, an unchanged one included.
				historyEvidence = evidenceChanged;
				historyStampAdvanced = stampChanged || (this.provider.source === "gadget" && raw.freshnessRevision !== this.lastFreshnessRevision);
				if (evidenceChanged) {
					// A stamp is as old as the wall clock it was written from says:
					// a producer that polled once more and then stopped while no
					// key was visible must not read as live for a window on the
					// page return. Values seen changing between two reads of one
					// session are evidence of now. The evidence clock never runs
					// backwards, whatever the wall clock does.
					const stampOnly = this.provider.source === "shared-memory" && !revisionChanged;
					// History keeps this age beside the sample (a data-age
					// readout); the sample itself sits at the tick's time.
					historyEvidenceAgeMs = stampOnly ? stampAgeMs(raw.pollTime) : 0;
					const at = monotonicNow() - historyEvidenceAgeMs;
					this.lastAdvanceAt = (this.lastAdvanceAt === 0 ? at : Math.max(this.lastAdvanceAt, at)) || -1;
				}
				this.lastPollTime = raw.pollTime;
				this.lastValueRevision = raw.valueRevision;
				this.revisionProvider = this.provider;
				this.lastFreshnessRevision = raw.freshnessRevision;
			}
			// Freshness is judged even when the read was skipped (mutex busy) —
			// a consumer wedged on the mutex must not freeze us at "ok" forever.
			// With no accepted observation yet there is nothing to be stale:
			// the source stays open and the read is simply retried next tick.
			const staleForMs = monotonicNow() - this.lastAdvanceAt;
			const stale = this.lastAdvanceAt !== 0 && staleForMs > STALE_AFTER_MS;
			snapshot = raw === null ? null : this.derive({ snapshot: raw, source: this.provider.source });
			if (snapshot !== null) {
				// Feed every tracked ring, on-screen or not, but only on a
				// genuinely fresh snapshot: a frozen or stale source must never
				// push duplicate points (that would flatten the line in place
				// and churn setImage for no new data). Native values in; the
				// key renderer self-normalizes. A ring describes one
				// measurement in one unit: when the saved key comes to stand
				// for another (a re-paired link) or the unit is rewritten, the
				// segment ends in place.
				for (const [key, ring] of this.series) {
					const reading = this.alignRing(key, ring, snapshot);
					if (reading === undefined) continue;
					if (evidenceChanged && (stampChanged || ring.length === 0 || ring.at(-1) !== reading.value)) {
						pushSample(ring, reading.value);
					}
				}
			} else {
				for (const ring of this.series.values()) ring.length = 0;
			}
			if (stale) {
				for (const ring of this.series.values()) ring.length = 0;
				// A tick judged stale records nothing; history segments end at
				// their last sample (an unavailable probe below overrides).
				historyTick = { kind: "stale", at: tickAt };
				// The data is frozen. If HWiNFO exited we would never notice through
				// our held handles — probe a fresh open. What gets published is
				// the snapshot's own provenance: a fresh read names the provider
				// that produced it, a held one keeps the source it came from.
				const source = snapshot !== null ? this.provider.source : this.status.state !== "unavailable" ? this.status.source : this.provider.source;
				// The probe exists to release OUR handles on a named section.
				// A registry key has no such lifetime, a deleted or emptied key
				// already fails the ordinary read, and steady values are the
				// resting state of a healthy Gadget source: probing there only
				// reopens and rescans the key every few seconds for as long as
				// nothing moves.
				if (this.provider.source !== "gadget") this.probeReopen();
				const last = snapshot ?? (this.status.state !== "unavailable" ? this.status.snapshot : null);
				if (last !== null) {
					this.status = { state: "stale", snapshot: last, source, staleForMs };
				}
			} else if (snapshot !== null) {
				this.status = this.provider.source === "gadget" && snapshot.pollTime === 0
					? { state: "stale", snapshot, source: "gadget", staleForMs }
					: { state: "ok", snapshot, source: this.provider.source };
				historyTick = this.status.state === "ok"
					? { kind: "ok", at: tickAt, snapshot, source: this.status.source, evidence: historyEvidence, stampAdvanced: historyStampAdvanced, evidenceAgeMs: historyEvidenceAgeMs }
					: { kind: "stale", at: tickAt };
			}
			// Otherwise (skipped read, still fresh): keep the previous status.
		} catch (err) {
			for (const ring of this.series.values()) ring.length = 0;
			// Any thrown tick, a transient hold included, ends history runs.
			historyTick = { kind: "unavailable", at: tickAt };
			this.preserveFreshness();
			this.dropProvider();
			if (err instanceof HwinfoError) {
				// Transient classes (a poisoned session whose reopen has not
				// landed yet, a source mid-recreate, or open-time mutex
				// contention) ride on the last rendered status; anything else,
				// or anything outliving the same freshness window that gates
				// staleness, surfaces immediately. A held status always
				// postdates an advance, so lastAdvanceAt is set.
				const transient = err.reason === "invalid" || err.reason === "not-running" || err.reason === "busy";
				// The hold is bounded by the evidence clock; a source that has
				// none yet (a cold Gadget key held at Age unknown) is bounded
				// by its last accepted read instead, never by process uptime.
				const heldSince = this.lastAdvanceAt !== 0 ? this.lastAdvanceAt : this.lastAcceptedAt;
				if (transient && this.status.state !== "unavailable" && monotonicNow() - heldSince <= STALE_AFTER_MS) {
					if (this.holdingSince === 0) {
						this.holdingSince = monotonicNow();
						this.logger.info(`Holding last values while the data source reopens [${err.reason}]: ${err.message}`);
					}
				} else {
					this.holdingSince = 0;
					if (this.status.state !== "unavailable" || this.status.reason !== err.reason) {
						this.logger.warn(`HWiNFO unavailable [${err.reason}]: ${err.message}`);
					}
					this.status = { state: "unavailable", reason: err.reason, message: err.message };
					this.lastRaw = null;
				}
			} else {
				this.holdingSince = 0;
				this.logger.error("Unexpected poll failure", err);
				this.status = { state: "unavailable", reason: "invalid", message: String(err) };
				this.lastRaw = null;
			}
		}
		// Isolated: a history fault must never cost a tick its status.
		try {
			this.history.ingest(historyTick);
		} catch (err) {
			this.logger.error("History ingest failed", err);
		}
		this.emit("tick", this.status);
	}

	/** While stale: swap to a freshly opened provider (throws when HWiNFO is gone). */
	private probeReopen(): void {
		const now = monotonicNow();
		if (now - this.lastReopenProbeAt < REOPEN_PROBE_MS) {
			return;
		}
		this.lastReopenProbeAt = now;
		// Release our handles FIRST: a named section stays alive while any handle
		// references it — including ours — so probing before closing would succeed
		// even after HWiNFO died, making the stale→unavailable edge unreachable.
		// Persist across a failing open too, so the next tick cannot mint a
		// fresh window merely because a still-frozen source reopened.
		this.preserveFreshness();
		this.dropProvider();
		this.provider = this.openProvider(); // HwinfoError propagates to tick()
		// Preserve freshness across the swap: dropProvider resets lastPollTime
		// and a fresh gadget provider resets its digest — either would let a
		// frozen source pose as advancing for one stale window (ok↔stale flap).
		this.restoreFreshness();
	}

	/** On the gadget fallback in auto mode, switch back once shared memory returns. */
	private maybeUpgradeToSharedMemory(): void {
		if (this.mode !== "auto" || this.provider === null || this.provider.source !== "gadget") {
			return;
		}
		const now = monotonicNow();
		if (now - this.lastUpgradeProbeAt < UPGRADE_PROBE_MS) {
			return;
		}
		this.lastUpgradeProbeAt = now;
		try {
			const upgraded = SharedMemoryProvider.open();
			this.provider.close();
			this.provider = upgraded;
			// The first accepted shared-memory read counts as an advance
			// through its stamp; the open itself changes nothing about the
			// age of the Gadget observation still on the keys.
			this.lastPollTime = -1;
			this.logger.info("Shared memory returned — upgraded from the gadget registry");
		} catch {
			// Still unavailable — stay on the gadget registry.
		}
	}
}

export const poller = new HwinfoPoller();
