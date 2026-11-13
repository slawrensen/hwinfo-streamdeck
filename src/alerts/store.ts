/**
 * In-memory alert state for every action, keyed by action context. Nothing
 * here is persisted.
 *
 * Inside a context, state is kept per measurement identity
 * (`reading.aliasOf ?? reading.key`, the identity sessions and history
 * follow) and, under it, one track per rule filing: the legacy pair, or the
 * `alertRules` key a reading rule is saved under. Spellings of one
 * measurement that resolve to the same rule share one track. Spellings that
 * resolve to different rules (limits saved for both ends of a source link)
 * each keep their own track, so neither resets the other.
 *
 * A rule that moves to another filing but compares readings exactly as
 * the old one did (a "Separate limits" entry seeded from the legacy pair,
 * or cleared back to it) keeps its track, when the caller passes the same
 * `alike` comparison key for both: the move alone ends no wait, recovery
 * or snooze. Without a key, or with a different one, the new filing starts
 * fresh, as an edit of the limits does.
 *
 * Tick contract: step every reading the action references, a null rule
 * included, then call prune(context, keep) once with the identities it
 * references. prune ends the tick:
 * - a track whose measurement was stepped this tick, but not under that
 *   track's filing (the rule moved to another filing, or no rule applies
 *   any more), is dropped;
 * - a measurement the action does not reference is a stray: it gets a gap
 *   (nothing shows; the latched level and any snooze are kept) and at most
 *   `slack` strays stay, the least recently stepped dropped first;
 * - nothing else goes: however many measurements the action references,
 *   prune keeps them all (an insert-time cap would thrash the moment the
 *   stepped set outgrew it, as src/stats.ts explains).
 *
 * Bounded: only tracks that carry state are kept (an idle track behaves
 * exactly like no track); at most MAX_MEASUREMENTS measurements per context,
 * a safety bound far above any sensor's reading count that drops the least
 * recently stepped first; at most MAX_CONTEXTS contexts with state.
 *
 * Hidden contexts: hide() marks an action that left the screen. Its state is
 * kept for HIDDEN_TTL_MS of monotonic time (the dial's hidden-state window),
 * so a page or profile flip comes back to the same alerts; past the window,
 * sweep() and appear() drop it. The mark outlives a sweep, so a context that
 * is still stepped while hidden is dropped again by the next sweep instead
 * of passing for one on screen. The mark ends when the action appears or is
 * forgotten. At most MAX_HIDDEN marks are kept, and marks of contexts with
 * no state go first.
 *
 * `epoch` bumps whenever any shown alert changes, and `epochOf(context)`
 * moves with it for that context, so a render gate keyed on it repaints a
 * face whose alert changed with time alone (a dwell completing, a snooze
 * ending) while its values stayed the same.
 */
import { liveKeyOf } from "../hwinfo/reading-links";
import type { Reading } from "../hwinfo/types";
import type { ShownAlert } from "./types";
import { FRESH_TRACK, NORMAL_SHOWN, aggregateShown, isIdle, sameShown, shown, snooze, stepAlert, unsnooze, type AlertLimits, type AlertTrack } from "./engine";
import { INVALID_OBSERVATION, ruleSignature, type AlertObservation, type ResolvedRule } from "./rules";

/** How long a hidden context keeps its alert state. */
export const HIDDEN_TTL_MS = 30 * 60_000;
/** Contexts that hold alert state. */
export const MAX_CONTEXTS = 256;
/** Hidden marks, including marks of contexts past the hidden window. */
export const MAX_HIDDEN = 1024;
/** Measurements per context with alert state: a safety bound only. prune
 * keeps the store far below it. */
export const MAX_MEASUREMENTS = 4096;
/** Stray measurements prune keeps per context by default (stats.prune's
 * slack). */
export const STRAY_SLACK = 64;

/** The engine ignores the limits of an invalid observation. */
const GAP_LIMITS: AlertLimits = { below: false, hyst: 0 };

/** The identity a reading's tracks live under: the provider's own key, so
 * a confirmed alias and its provider key share them. */
export function alertIdentityOf(reading: Pick<Reading, "key" | "aliasOf">): string {
	return liveKeyOf(reading);
}

/** The legacy pair, or the `alertRules` key a reading rule is saved under. */
function filingOf(rule: ResolvedRule): string {
	return rule.source === "legacy" ? "legacy" : `reading ${JSON.stringify(rule.ruleKey ?? null)}`;
}

type TrackEntry = {
	readonly track: AlertTrack;
	/** ruleSignature of the rule the track was built with. */
	readonly signature: string;
	/** The context generation the track was last stepped in. */
	readonly gen: number;
	/** The caller's comparison key from the track's last step, if any. */
	readonly alike?: string;
};

/** One measurement's tracks, by rule filing. */
type Measurement = Map<string, TrackEntry>;

type ContextEntry = {
	/** Least recently stepped first. */
	readonly measurements: Map<string, Measurement>;
	/** Identities stepped in this generation, with a rule or without one. */
	readonly observed: Set<string>;
	/** Moves on with every prune: one generation per tick. */
	gen: number;
	/** The store epoch at this context's last shown change. */
	epoch: number;
};

export interface AlertStoreOptions {
	readonly hiddenTtlMs?: number;
	readonly maxContexts?: number;
	readonly maxHidden?: number;
	readonly maxMeasurements?: number;
}

export class AlertStore {
	private readonly contexts = new Map<string, ContextEntry>();
	/** Monotonic time each hidden context left the screen. */
	private readonly hidden = new Map<string, number>();
	private counter = 0;
	private readonly hiddenTtlMs: number;
	private readonly maxContexts: number;
	private readonly maxHidden: number;
	private readonly maxMeasurements: number;

	constructor(options: AlertStoreOptions = {}) {
		this.hiddenTtlMs = options.hiddenTtlMs ?? HIDDEN_TTL_MS;
		this.maxContexts = options.maxContexts ?? MAX_CONTEXTS;
		this.maxHidden = options.maxHidden ?? MAX_HIDDEN;
		this.maxMeasurements = options.maxMeasurements ?? MAX_MEASUREMENTS;
	}

	/** Bumps on every shown change anywhere. */
	get epoch(): number {
		return this.counter;
	}

	/** Moves whenever a shown alert of this context changes; 0 only while
	 * the context has never shown anything or holds no state. */
	epochOf(context: string): number {
		return this.contexts.get(context)?.epoch ?? 0;
	}

	/**
	 * Steps one reading and returns what it shows. A null rule (this
	 * spelling has no limits) keeps nothing and drops nothing at once: the
	 * next prune drops the measurement's tracks that no spelling stepped
	 * this tick. A rule that compares differently from the one its track was
	 * built with (an edit of its limits, direction, unit or recovery band)
	 * starts the track fresh first; a changed dwell keeps it.
	 *
	 * `alike` is the caller's key for how the rule compares this reading
	 * (its limits, direction, band and comparison unit). With no track
	 * under the rule's filing yet, a track of the measurement under another
	 * filing with the same key, not stepped in this generation (its rule
	 * moved), moves to the new filing with its state.
	 */
	step(context: string, identity: string, rule: ResolvedRule | null, observation: AlertObservation, now: number, dwellMs: number, alike?: string): ShownAlert {
		const entry = this.contexts.get(context);
		if (rule === null) {
			entry?.observed.add(identity);
			return NORMAL_SHOWN;
		}
		const filing = filingOf(rule);
		const signature = ruleSignature(rule);
		const measurement = entry?.measurements.get(identity);
		let existing = measurement?.get(filing);
		if (existing === undefined && alike !== undefined && entry !== undefined && measurement !== undefined) {
			for (const [other, value] of measurement) {
				if (other === filing || value.alike !== alike || value.gen === entry.gen) continue;
				// Moved in place, so the write below replaces it (or drops it
				// when the step leaves it idle) like any track of this filing.
				existing = { ...value, signature };
				measurement.delete(other);
				measurement.set(filing, existing);
				break;
			}
		}
		const before = existing === undefined ? NORMAL_SHOWN : shown(existing.track);
		const base = existing !== undefined && existing.signature === signature ? existing.track : FRESH_TRACK;
		const next = stepAlert(base, observation, rule, now, dwellMs);
		this.write(context, entry, identity, filing, next, signature, before, true, alike)?.observed.add(identity);
		return shown(next);
	}

	/** An invalid observation for every track of the context outside
	 * `except`: data not current, or readings the action no longer found. */
	gap(context: string, except?: ReadonlySet<string>): void {
		const entry = this.contexts.get(context);
		if (entry === undefined) return;
		for (const [identity, measurement] of [...entry.measurements]) {
			if (except?.has(identity) === true) continue;
			this.gapMeasurement(context, entry, identity, measurement);
		}
	}

	/** What one measurement shows: the highest level over its tracks. */
	shownFor(context: string, identity: string): ShownAlert {
		return this.aggregate(context, [identity]);
	}

	/** The face-level aggregate over the given identities. */
	aggregate(context: string, identities: Iterable<string>): ShownAlert {
		const entry = this.contexts.get(context);
		if (entry === undefined) return NORMAL_SHOWN;
		const alerts: ShownAlert[] = [];
		for (const identity of identities) {
			const measurement = entry.measurements.get(identity);
			if (measurement === undefined) continue;
			for (const value of measurement.values()) alerts.push(shown(value.track));
		}
		return aggregateShown(alerts);
	}

	/** Snoozes every reading of the context that shows an alert now (or only
	 * those in `identities`) at its current level. A reading that is already
	 * silenced keeps its snooze as it is. Returns how many readings were
	 * snoozed. */
	snoozeContext(context: string, now: number, ms: number, identities?: ReadonlySet<string>): number {
		const entry = this.contexts.get(context);
		if (entry === undefined) return 0;
		let count = 0;
		for (const [identity, measurement] of [...entry.measurements]) {
			if (identities !== undefined && !identities.has(identity)) continue;
			let snoozed = false;
			for (const [filing, value] of [...measurement]) {
				const before = shown(value.track);
				if (before.level === "normal") continue;
				const next = snooze(value.track, now, ms);
				if (next === value.track) continue;
				snoozed = true;
				this.write(context, entry, identity, filing, next, value.signature, before, false);
			}
			if (snoozed) count++;
		}
		return count;
	}

	/** Ends every snooze of the context (or those in `identities`). */
	unsnoozeContext(context: string, identities?: ReadonlySet<string>): void {
		const entry = this.contexts.get(context);
		if (entry === undefined) return;
		for (const [identity, measurement] of [...entry.measurements]) {
			if (identities !== undefined && !identities.has(identity)) continue;
			for (const [filing, value] of [...measurement]) {
				if (value.track.snooze === null) continue;
				this.write(context, entry, identity, filing, unsnooze(value.track), value.signature, shown(value.track), false);
			}
		}
	}

	/**
	 * Ends the tick for one context (see the tick contract above). `keep`
	 * holds the identities the action references, and their number is never
	 * capped here. At most `slack` strays stay, the least recently stepped
	 * dropped first.
	 */
	prune(context: string, keep: ReadonlySet<string>, slack: number = STRAY_SLACK): void {
		const entry = this.contexts.get(context);
		if (entry === undefined) return;
		const limit = Number.isFinite(slack) && slack > 0 ? Math.floor(slack) : 0;
		let strays = 0;
		for (const [identity, measurement] of [...entry.measurements]) {
			if (entry.observed.has(identity)) {
				for (const [filing, value] of [...measurement]) {
					if (value.gen === entry.gen) continue;
					measurement.delete(filing);
					this.changed(entry, shown(value.track), NORMAL_SHOWN);
				}
				if (measurement.size === 0) {
					entry.measurements.delete(identity);
					continue;
				}
			}
			if (keep.has(identity)) continue;
			this.gapMeasurement(context, entry, identity, measurement);
			if (entry.measurements.has(identity)) strays++;
		}
		entry.observed.clear();
		entry.gen++;
		for (const [identity, measurement] of [...entry.measurements]) {
			if (strays <= limit) break;
			if (keep.has(identity)) continue;
			this.dropMeasurement(entry, identity, measurement);
			strays--;
		}
		this.dropIfEmpty(context, entry);
	}

	/** Starts one identity (or every identity of the context) fresh. A
	 * hidden context stays timed as hidden. */
	reset(context: string, identity?: string): void {
		const entry = this.contexts.get(context);
		if (entry === undefined) return;
		for (const [key, measurement] of [...entry.measurements]) {
			if (identity !== undefined && key !== identity) continue;
			this.dropMeasurement(entry, key, measurement);
		}
		this.dropIfEmpty(context, entry);
	}

	/** The action left the screen (willDisappear). */
	hide(context: string, now: number): void {
		this.hidden.delete(context);
		this.hidden.set(context, now);
		this.enforceHiddenCap(context);
	}

	/** The action is on screen again (willAppear, replayed or not). Within
	 * the hidden window its state is kept; past it the state is dropped. */
	appear(context: string, now: number): void {
		const at = this.hidden.get(context);
		if (at === undefined) return;
		this.hidden.delete(context);
		if (now - at > this.hiddenTtlMs) this.dropContext(context);
	}

	/** Drops the state of hidden contexts past the hidden window. Their
	 * marks stay until the action appears or is forgotten. */
	sweep(now: number): void {
		for (const [context, at] of this.hidden) {
			if (now - at > this.hiddenTtlMs) this.dropContext(context);
		}
	}

	/** Drops all state of one context and its hidden mark, for an action
	 * that is gone. Stepping it again counts it as on screen. */
	forget(context: string): void {
		this.hidden.delete(context);
		this.dropContext(context);
	}

	/** Counts for tests: contexts with state, tracks, and hidden marks. */
	size(): { contexts: number; tracks: number; hidden: number } {
		let tracks = 0;
		for (const entry of this.contexts.values()) {
			for (const measurement of entry.measurements.values()) tracks += measurement.size;
		}
		return { contexts: this.contexts.size, tracks, hidden: this.hidden.size };
	}

	/** Whether the context holds any state at all. With none, a step under
	 * no rule, a gap and a prune all leave the store exactly as it was. */
	holds(context: string): boolean {
		return this.contexts.has(context);
	}

	/** Whether the context holds a track for the identity (tests). */
	has(context: string, identity: string): boolean {
		return this.contexts.get(context)?.measurements.has(identity) === true;
	}

	/**
	 * Stores one track, or drops it when it is idle, and returns the
	 * context's entry while it still has one. A step also makes the
	 * measurement the most recently stepped and marks the track as stepped
	 * in this generation, with the step's comparison key; any other write
	 * keeps all three.
	 */
	private write(context: string, current: ContextEntry | undefined, identity: string, filing: string, track: AlertTrack, signature: string, before: ShownAlert, stepped: boolean, alike?: string): ContextEntry | undefined {
		const after = shown(track);
		if (isIdle(track)) {
			if (current === undefined) return undefined;
			const measurement = current.measurements.get(identity);
			if (measurement !== undefined && measurement.delete(filing)) {
				if (measurement.size === 0) current.measurements.delete(identity);
				this.changed(current, before, after);
			}
			return this.dropIfEmpty(context, current);
		}
		let entry = current;
		if (entry === undefined) {
			entry = { measurements: new Map(), observed: new Set(), gen: 0, epoch: 0 };
			this.contexts.set(context, entry);
			this.enforceContextCap(context);
		}
		let measurement = entry.measurements.get(identity);
		const previous = measurement?.get(filing);
		const gen = stepped ? entry.gen : (previous?.gen ?? entry.gen);
		const key = stepped ? alike : previous?.alike;
		if (measurement === undefined) {
			measurement = new Map();
			entry.measurements.set(identity, measurement);
		} else if (stepped) {
			entry.measurements.delete(identity);
			entry.measurements.set(identity, measurement);
		}
		measurement.set(filing, key === undefined ? { track, signature, gen } : { track, signature, gen, alike: key });
		this.enforceMeasurementCap(entry, identity);
		this.changed(entry, before, after);
		return entry;
	}

	private gapMeasurement(context: string, entry: ContextEntry, identity: string, measurement: Measurement): void {
		for (const [filing, value] of [...measurement]) {
			// Already in a gap: another invalid observation changes nothing.
			if (value.track.afterGap) continue;
			this.write(context, entry, identity, filing, stepAlert(value.track, INVALID_OBSERVATION, GAP_LIMITS, 0, 0), value.signature, shown(value.track), false);
		}
	}

	private dropMeasurement(entry: ContextEntry, identity: string, measurement: Measurement): void {
		entry.measurements.delete(identity);
		for (const value of measurement.values()) this.changed(entry, shown(value.track), NORMAL_SHOWN);
	}

	/** Drops every track of a context; its hidden mark is left alone. */
	private dropContext(context: string): void {
		const entry = this.contexts.get(context);
		if (entry === undefined) return;
		this.contexts.delete(context);
		for (const measurement of entry.measurements.values()) {
			for (const value of measurement.values()) {
				if (!sameShown(shown(value.track), NORMAL_SHOWN)) {
					this.counter++;
					return;
				}
			}
		}
	}

	private changed(entry: ContextEntry, before: ShownAlert, after: ShownAlert): void {
		if (sameShown(before, after)) return;
		this.counter++;
		entry.epoch = this.counter;
	}

	private dropIfEmpty(context: string, entry: ContextEntry): ContextEntry | undefined {
		if (entry.measurements.size > 0) return entry;
		if (this.contexts.get(context) === entry) this.contexts.delete(context);
		return undefined;
	}

	/** Over the context cap, the longest-hidden context with state loses it
	 * first, then the oldest; never the one being written. A hidden
	 * context keeps its mark, so state it gains again is still timed. */
	private enforceContextCap(keep: string): void {
		while (this.contexts.size > this.maxContexts) {
			let victim: string | undefined;
			let oldestHidden = Number.POSITIVE_INFINITY;
			for (const context of this.contexts.keys()) {
				const at = this.hidden.get(context);
				if (context === keep || at === undefined || at >= oldestHidden) continue;
				oldestHidden = at;
				victim = context;
			}
			if (victim === undefined) {
				for (const context of this.contexts.keys()) {
					if (context !== keep) {
						victim = context;
						break;
					}
				}
			}
			if (victim === undefined) return;
			this.dropContext(victim);
		}
	}

	/** Over the mark cap, the longest-hidden mark of a context with no state
	 * goes first, then the longest-hidden mark with state, which takes that
	 * state with it (without its mark it would pass for on screen and never
	 * expire); never the mark being written. */
	private enforceHiddenCap(keep: string): void {
		while (this.hidden.size > this.maxHidden) {
			let stateless: string | undefined;
			let statelessAt = Number.POSITIVE_INFINITY;
			let stateful: string | undefined;
			let statefulAt = Number.POSITIVE_INFINITY;
			for (const [context, at] of this.hidden) {
				if (context === keep) continue;
				if (!this.contexts.has(context)) {
					if (at < statelessAt) {
						statelessAt = at;
						stateless = context;
					}
				} else if (at < statefulAt) {
					statefulAt = at;
					stateful = context;
				}
			}
			const victim = stateless ?? stateful;
			if (victim === undefined) return;
			this.hidden.delete(victim);
			this.dropContext(victim);
		}
	}

	/** Over the measurement cap, the least recently stepped measurement
	 * goes first; never the one being written. */
	private enforceMeasurementCap(entry: ContextEntry, keep: string): void {
		while (entry.measurements.size > this.maxMeasurements) {
			let victim: [string, Measurement] | undefined;
			for (const candidate of entry.measurements) {
				if (candidate[0] !== keep) {
					victim = candidate;
					break;
				}
			}
			if (victim === undefined) return;
			this.dropMeasurement(entry, victim[0], victim[1]);
		}
	}
}

/** The one store every action shares. */
export const alertStore = new AlertStore();
