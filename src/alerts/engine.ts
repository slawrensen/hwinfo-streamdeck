/**
 * The alert state machine for one reading: dwell before a level shows,
 * a recovery band before it clears, and snooze. Pure and in memory only;
 * after a plugin restart every track starts fresh, so dwell starts again
 * from the first valid reading and any snooze is gone.
 *
 * With dwell 0 and a recovery band of 0, the level after every valid
 * observation equals alertLevel (src/ui/format.ts) for that value, and the
 * shown level after an invalid one is normal, as alertLevel says for a value
 * that is not a finite number. test/alert-engine.test.ts proves it over
 * random sequences.
 */
import type { AlertLevel, AlertSeverity, ShownAlert } from "./types";
import type { AlertObservation } from "./rules";

/** The limits the engine compares; a ResolvedRule satisfies it. */
export interface AlertLimits {
	readonly warn?: number;
	readonly crit?: number;
	readonly below: boolean;
	/** Recovery band in the limits' unit; anything but a finite number >= 0
	 * counts as 0. */
	readonly hyst: number;
}

export interface AlertSnooze {
	/** The highest level the snooze silences. */
	readonly level: AlertSeverity;
	/** Monotonic time from which the next valid observation ends it. */
	readonly until: number;
}

/** One reading's alert state. Immutable: every step returns a new track. */
export interface AlertTrack {
	/** The latched level (kept through invalid observations). */
	readonly level: AlertLevel;
	/** Monotonic time each level above `level` was first entered, over
	 * consecutive valid observations. */
	readonly pending: Readonly<Partial<Record<AlertSeverity, number>>>;
	/** The last observation was invalid: nothing numeric is drawn, so the
	 * latched level does not show. */
	readonly afterGap: boolean;
	readonly snooze: AlertSnooze | null;
}

export const FRESH_TRACK: AlertTrack = Object.freeze({ level: "normal", pending: Object.freeze({}), afterGap: false, snooze: null });

export const NORMAL_SHOWN: ShownAlert = Object.freeze({ level: "normal", snoozed: null });
const SHOWN_WARN: ShownAlert = Object.freeze({ level: "warn", snoozed: null });
const SHOWN_CRIT: ShownAlert = Object.freeze({ level: "crit", snoozed: null });

const SEVERITIES: readonly AlertSeverity[] = ["warn", "crit"];

const RANK: Readonly<Record<AlertLevel, number>> = { normal: 0, warn: 1, crit: 2 };

function nonNegative(value: number): number {
	return Number.isFinite(value) && value > 0 ? value : 0;
}

/** At or past the limit: today's rule (>=, or <= for a low alarm). */
function enters(limits: AlertLimits, level: AlertSeverity, value: number): boolean {
	const limit = level === "crit" ? limits.crit : limits.warn;
	if (limit === undefined) return false;
	return limits.below ? value <= limit : value >= limit;
}

/** Still within the recovery band of a latched level. */
function holds(limits: AlertLimits, level: AlertSeverity, value: number, hyst: number): boolean {
	const limit = level === "crit" ? limits.crit : limits.warn;
	if (limit === undefined) return false;
	return limits.below ? value <= limit + hyst : value >= limit - hyst;
}

/**
 * One observation.
 *
 * Invalid (data not current, reading missing or withheld, value not finite,
 * unit mismatch, no rule): pending entries clear, the latched level and any
 * snooze are kept (even past its end time), and nothing shows until a valid
 * observation.
 *
 * Valid value v:
 * 1. latched = the highest level at or below the current one whose recovery
 *    band still holds v, else normal (after a gap the same test applies, so
 *    a level that still holds resumes without a new dwell);
 * 2. each level above latched that v enters keeps its first-entry time, any
 *    other loses it;
 * 3. level = the highest of latched and every pending level held for at
 *    least dwellMs;
 * 4. a snooze ends on recovery (normal), on escalation above the snoozed
 *    level, or when this valid observation is at or past its end time.
 */
export function stepAlert(track: AlertTrack, observation: AlertObservation, limits: AlertLimits, now: number, dwellMs: number): AlertTrack {
	if (!observation.valid || !Number.isFinite(observation.value)) {
		return { level: track.level, pending: {}, afterGap: true, snooze: track.snooze };
	}
	const value = observation.value;
	const hyst = nonNegative(limits.hyst);
	const dwell = nonNegative(dwellMs);

	let latched: AlertLevel = "normal";
	for (const level of SEVERITIES) {
		if (RANK[level] <= RANK[track.level] && holds(limits, level, value, hyst)) latched = level;
	}

	const pending: Partial<Record<AlertSeverity, number>> = {};
	let level: AlertLevel = latched;
	for (const candidate of SEVERITIES) {
		if (RANK[candidate] <= RANK[latched] || !enters(limits, candidate, value)) continue;
		const since = track.pending[candidate] ?? now;
		pending[candidate] = since;
		if (now - since >= dwell && RANK[candidate] > RANK[level]) level = candidate;
	}
	// Levels at or below the new level no longer wait for anything.
	for (const candidate of SEVERITIES) {
		if (RANK[candidate] <= RANK[level]) delete pending[candidate];
	}

	let snooze = track.snooze;
	if (snooze !== null && (level === "normal" || RANK[level] > RANK[snooze.level] || now >= snooze.until)) snooze = null;
	return { level, pending, afterGap: false, snooze };
}

/**
 * Silences the current level for `ms` from `now`. A no-op while nothing
 * shows: at normal, or after an invalid observation. A higher level still
 * escalates through it (after its dwell).
 */
export function snooze(track: AlertTrack, now: number, ms: number): AlertTrack {
	if (track.level === "normal" || track.afterGap || !Number.isFinite(ms) || ms <= 0) return track;
	return { ...track, snooze: { level: track.level, until: now + ms } };
}

/** Ends a snooze at once. */
export function unsnooze(track: AlertTrack): AlertTrack {
	return track.snooze === null ? track : { ...track, snooze: null };
}

/**
 * What the face shows: nothing after an invalid observation; normal with
 * the silenced level named while a snooze covers the current level;
 * otherwise the level itself.
 */
export function shown(track: AlertTrack): ShownAlert {
	if (track.afterGap || track.level === "normal") return NORMAL_SHOWN;
	if (track.snooze !== null && RANK[track.snooze.level] >= RANK[track.level]) return { level: "normal", snoozed: track.level };
	return track.level === "warn" ? SHOWN_WARN : SHOWN_CRIT;
}

export function sameShown(a: ShownAlert, b: ShownAlert): boolean {
	return a.level === b.level && a.snoozed === b.snoozed;
}

/** A track that carries no state: it behaves exactly like FRESH_TRACK. */
export function isIdle(track: AlertTrack): boolean {
	return track.level === "normal" && track.snooze === null && track.pending.warn === undefined && track.pending.crit === undefined;
}

/**
 * Severity aggregation for a face that shows several readings: the highest
 * shown level, and the highest silenced level among them.
 */
export function aggregateShown(alerts: Iterable<ShownAlert>): ShownAlert {
	let level: AlertLevel = "normal";
	let snoozed: AlertSeverity | null = null;
	for (const alert of alerts) {
		if (RANK[alert.level] > RANK[level]) level = alert.level;
		if (alert.snoozed !== null && (snoozed === null || RANK[alert.snoozed] > RANK[snoozed])) snoozed = alert.snoozed;
	}
	return { level, snoozed };
}
