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
import { GadgetRegistryProvider } from "./hwinfo/gadget-registry";
import { SharedMemoryProvider, type SnapshotProvider, type SnapshotSource } from "./hwinfo/provider";
import { HwinfoError, type HwinfoUnavailableReason, type SensorSnapshot } from "./hwinfo/types";
import { pushSample } from "./series";

export type PollerStatus =
	| { state: "ok"; snapshot: SensorSnapshot; source: SnapshotSource }
	| { state: "stale"; snapshot: SensorSnapshot; source: SnapshotSource; staleForMs: number }
	| { state: "unavailable"; reason: HwinfoUnavailableReason; message: string };

type SourceMode = "auto" | "shared-memory" | "gadget";

const DEFAULT_INTERVAL_MS = 1000;
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
	private mode: SourceMode = "auto";
	private lastPollTime = -1;
	private lastAdvanceAt = 0;
	private lastReopenProbeAt = 0;
	/** Freshness surviving a stale probe whose reopen threw (see probeReopen). */
	private heldFreshness: { pollTime: number; advanceAt: number } | null = null;
	private lastUpgradeProbeAt = 0;
	/** Nonzero while a transient failure is being ridden out on held values. */
	private holdingSince = 0;
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

	/** Latest status; safe to read at any time (e.g. right after willAppear). */
	getStatus(): PollerStatus {
		return this.status;
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
			sampleAgeMs: this.lastAdvanceAt === 0 ? null : monotonicNow() - this.lastAdvanceAt
		};
	}

	onTick(listener: (status: PollerStatus) => void): void {
		this.on("tick", listener);
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
			this.timer = setInterval(() => this.tick(), this.intervalMs).unref(); // see start()
		}
	}

	setSourceMode(mode: SourceMode): void {
		if (mode === this.mode) {
			return;
		}
		this.mode = mode;
		this.logger.info(`Source mode set to ${mode}`);
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
		this.timer = setInterval(() => this.tick(), this.intervalMs).unref();
		this.tick();
	}

	private stop(): void {
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.dropProvider();
		this.heldFreshness = null;
		// Info on purpose: the e2e exit-hygiene check greps for this line to
		// prove the poller idles (timer cleared, provider closed) with no keys.
		this.logger.info("Stopped (no visible actions)");
	}

	private dropProvider(): void {
		this.provider?.close();
		this.provider = null;
		this.lastPollTime = -1;
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
				if (
					fallback instanceof HwinfoError &&
					fallback.reason === "gadget-empty" &&
					primary instanceof HwinfoError &&
					primary.reason === "not-running"
				) {
					throw fallback;
				}
				throw primary;
			}
		}
	}

	private tick(): void {
		try {
			if (this.provider === null) {
				this.provider = this.openProvider();
				if (this.heldFreshness !== null) {
					// A failed stale probe dropped the provider last tick; the
					// source is the same frozen one, so restore its freshness
					// instead of letting the reopen pose as an advance.
					this.lastPollTime = this.heldFreshness.pollTime;
					this.lastAdvanceAt = this.heldFreshness.advanceAt;
					this.heldFreshness = null;
				} else {
					this.lastAdvanceAt = monotonicNow();
				}
				this.logger.info(`Opened HWiNFO data source: ${this.provider.source}`);
			}
			this.maybeUpgradeToSharedMemory();

			let snapshot: SensorSnapshot | null;
			try {
				snapshot = this.provider.read();
			} catch (err) {
				if (!(err instanceof HwinfoError) || err.reason !== "invalid") {
					throw err;
				}
				// Poisoned session (layout changed): reopen at the new exact size
				// and read again within the same tick, so live values never leave
				// the keys. A failure here falls to the hold in the outer catch.
				this.dropProvider();
				this.provider = this.openProvider();
				snapshot = this.provider.read();
				this.logger.info(`Data source layout changed; reopened in place (${this.provider.source})`);
			}
			this.holdingSince = 0;
			if (snapshot !== null && snapshot.pollTime !== this.lastPollTime) {
				this.lastPollTime = snapshot.pollTime;
				this.lastAdvanceAt = monotonicNow();
				// Feed every tracked ring, on-screen or not, but only on a
				// genuinely fresh snapshot: a frozen or stale source must never
				// push duplicate points (that would flatten the line in place
				// and churn setImage for no new data). Native values in; the
				// key renderer self-normalizes.
				for (const [key, ring] of this.series) {
					const reading = snapshot.byKey.get(key);
					if (reading !== undefined) {
						pushSample(ring, reading.value);
					}
				}
			}
			// Freshness is judged even when the read was skipped (mutex busy) —
			// a consumer wedged on the mutex must not freeze us at "ok" forever.
			const staleForMs = monotonicNow() - this.lastAdvanceAt;
			if (staleForMs > STALE_AFTER_MS) {
				// The data is frozen. If HWiNFO exited we would never notice through
				// our held handles — probe a fresh open.
				this.probeReopen();
				const source = this.provider.source;
				const last = snapshot ?? (this.status.state !== "unavailable" ? this.status.snapshot : null);
				if (last !== null) {
					this.status = { state: "stale", snapshot: last, source, staleForMs };
				}
			} else if (snapshot !== null) {
				this.status = { state: "ok", snapshot, source: this.provider.source };
			}
			// Otherwise (skipped read, still fresh): keep the previous status.
		} catch (err) {
			this.dropProvider();
			if (err instanceof HwinfoError) {
				// Transient classes (a poisoned session whose reopen has not
				// landed yet, a source mid-recreate, or open-time mutex
				// contention) ride on the last rendered status; anything else,
				// or anything outliving the same freshness window that gates
				// staleness, surfaces immediately. A held status always
				// postdates an advance, so lastAdvanceAt is set.
				const transient = err.reason === "invalid" || err.reason === "not-running" || err.reason === "busy";
				if (transient && this.status.state !== "unavailable" && monotonicNow() - this.lastAdvanceAt <= STALE_AFTER_MS) {
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
				}
			} else {
				this.holdingSince = 0;
				this.logger.error("Unexpected poll failure", err);
				this.status = { state: "unavailable", reason: "invalid", message: String(err) };
			}
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
		const prev = this.provider;
		const prevPollTime = this.lastPollTime;
		const prevAdvanceAt = this.lastAdvanceAt;
		// Stashed on the instance too: when openProvider throws here (a busy
		// mutex at the probe instant), these locals die with the probe, and
		// the next tick's cold reopen would otherwise mint a fresh advance
		// for a still-frozen source: a false ok window plus duplicate
		// sparkline samples, repeating while HWiNFO stays paused.
		this.heldFreshness = { pollTime: prevPollTime, advanceAt: prevAdvanceAt };
		this.dropProvider();
		this.provider = this.openProvider(); // HwinfoError propagates to tick()
		this.heldFreshness = null;
		// Preserve freshness across the swap: dropProvider resets lastPollTime
		// and a fresh gadget provider resets its digest — either would let a
		// frozen source pose as advancing for one stale window (ok↔stale flap).
		if (prev instanceof GadgetRegistryProvider && this.provider instanceof GadgetRegistryProvider) {
			this.provider.adoptFreshness(prev);
		}
		this.lastPollTime = prevPollTime;
		this.lastAdvanceAt = prevAdvanceAt;
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
			this.lastPollTime = -1;
			this.lastAdvanceAt = now;
			this.logger.info("Shared memory returned — upgraded from the gadget registry");
		} catch {
			// Still unavailable — stay on the gadget registry.
		}
	}
}

export const poller = new HwinfoPoller();
