/**
 * Per-reading session statistics for a dial. Keyed by the stable reading
 * identity (sensor-id:instance:reading-id), never a list position, so
 * rotating away and back restores that member's own numbers and no reading
 * can ever inherit another's min/max.
 *
 * Bounding is by relevance, not insertion age: prune() keeps every reading
 * the dial actively samples (its rotation set + selection, any size) plus a
 * slack of stray sessions from past reselections. An insert-time cap would
 * thrash the moment the sampled set outgrew it, silently resetting every
 * session each tick.
 */
import { identityBreak } from "./history/identity";
import { measurementIdentityOf } from "./hwinfo/calculated";
import type { Reading, SensorSnapshot } from "./hwinfo/types";
import type { StatMode } from "./ui/format";

export type SessionStats = {
	min: number;
	max: number;
	sum: number;
	count: number;
	/** The mean, kept only once finite samples overflow `sum`. */
	mean?: number;
};

export type SessionResetReason = "source" | "unit" | "type" | "binding" | "definition" | "gap" | "strip";

const RESET_MESSAGES: Record<SessionResetReason, string> = {
	source: "stats reset: source changed",
	unit: "stats reset: units changed",
	type: "stats reset: reading changed",
	binding: "stats reset: pairing changed",
	definition: "stats reset: calculation changed",
	gap: "stats reset: data gap",
	// A dial back from a strip: its readings were not observed for it.
	strip: "stats reset: left the strip"
};

/** The session stat a dial row displays; the live value when no session
 * yet. The dial faces and the panel's overflow note both read it. */
export function rowStatValue(live: number, stats: SessionStats | undefined, mode: StatMode): number {
	if (stats === undefined || mode === "current") {
		return live;
	}
	return mode === "min" ? stats.min : mode === "max" ? stats.max : (stats.mean ?? stats.sum / stats.count);
}

export function sessionResetMessage(reason: SessionResetReason): string {
	return RESET_MESSAGES[reason];
}

type Observation = {
	pollTime: number;
	value: number;
	source: string;
	type: Reading["type"];
	unit: string;
	/** The measurement the saved key stood for when this was observed
	 * (measurementIdentityOf: the provider key, or a calculated reading and
	 * its revision). A saved key that comes to stand for another measurement
	 * (a re-paired link, a changed calculation) starts a new session; merely
	 * gaining or losing an alias while it keeps resolving to the same
	 * measurement does not. */
	identity: string;
};

/** The shared identity rule (history segments end on the same changes). */
function observationResetReason(previous: Observation, reading: Reading, source: string): SessionResetReason | undefined {
	return identityBreak(previous, reading, source);
}

export class SessionStatsStore {
	private readonly byKey = new Map<string, SessionStats>();
	private readonly observations = new Map<string, Observation>();

	/** Retained sessions still encounter boundaries while another reading is
	 * selected. Validate them without accumulating off-selection samples;
	 * actively sampled keys go through observe() so reset hints stay intact. */
	validateRetained(snapshot: SensorSnapshot, source: string, sampledKeys: ReadonlySet<string>): void {
		for (const [key, previous] of this.observations) {
			if (sampledKeys.has(key)) continue;
			const reading = snapshot.byKey.get(key);
			if (reading === undefined || !Number.isFinite(reading.value) || observationResetReason(previous, reading, source) !== undefined) {
				this.reset([key]);
			}
		}
	}

	/** Sample-weighted local observations, never repeated held frames. A
	 * provider/unit/link change starts a new session for that reading. */
	observe(reading: Reading, snapshot: SensorSnapshot, source: string): SessionResetReason | undefined {
		const previous = this.observations.get(reading.key);
		const reason = previous === undefined ? undefined : observationResetReason(previous, reading, source);
		if (reason !== undefined) this.reset([reading.key]);
		if (!Number.isFinite(reading.value)) {
			this.reset([reading.key]);
			return;
		}
		if (reason === undefined && previous?.pollTime === snapshot.pollTime && Object.is(previous.value, reading.value)) return;
		this.sample(reading.key, reading.value);
		this.observations.set(reading.key, { pollTime: snapshot.pollTime, value: reading.value, source, type: reading.type, unit: reading.unit, identity: measurementIdentityOf(reading) });
		return reason;
	}

	/** Folds one native-unit sample into the reading's session. */
	sample(key: string, value: number): void {
		if (!Number.isFinite(value)) {
			return;
		}
		const stats = this.byKey.get(key);
		if (stats === undefined) {
			this.byKey.set(key, { min: value, max: value, sum: value, count: 1 });
			return;
		}
		stats.min = Math.min(stats.min, value);
		stats.max = Math.max(stats.max, value);
		// Finite samples can still overflow the sum (1e308 twice), which
		// would lose AVG for the rest of the session. From then on the mean
		// is kept by steps that cannot overflow: the difference of two
		// same-sign values, or a weighted sum of opposite signs (external
		// review AX64). Ordinary sums keep their exact results.
		const sum = stats.sum + value;
		if (stats.mean !== undefined || !Number.isFinite(sum)) {
			const mean = stats.mean ?? stats.sum / stats.count;
			const count = stats.count + 1;
			stats.mean = Math.sign(mean) === Math.sign(value) ? mean + (value - mean) / count : mean * (stats.count / count) + value / count;
		}
		stats.sum = sum;
		stats.count++;
	}

	/**
	 * Drops sessions for readings outside `keep`, oldest first, until at most
	 * `keep.size + slack` remain. Sessions for kept readings are never touched,
	 * whatever the size of the set.
	 */
	prune(keep: ReadonlySet<string>, slack: number): void {
		const limit = keep.size + slack;
		if (this.byKey.size <= limit) {
			return;
		}
		for (const key of this.byKey.keys()) {
			if (this.byKey.size <= limit) {
				break;
			}
			if (!keep.has(key)) {
				this.byKey.delete(key);
				this.observations.delete(key);
			}
		}
	}

	get(key: string): SessionStats | undefined {
		return this.byKey.get(key);
	}

	/**
	 * Resets the given readings (or everything when omitted). A reset entry
	 * is deleted outright; the next sample reseeds it from the live value,
	 * which is exactly the "back to current" reset the dial always had.
	 */
	reset(keys?: readonly string[]): void {
		if (keys === undefined) {
			this.byKey.clear();
			this.observations.clear();
			return;
		}
		for (const key of keys) {
			this.byKey.delete(key);
			this.observations.delete(key);
		}
	}

	/** Resets every session observed for one of these measurement
	 * identities, under whichever saved spelling it was sampled: a reset
	 * aimed at a reading must not leave its other spelling's session behind. */
	resetIdentities(identities: ReadonlySet<string>): void {
		for (const [key, observation] of this.observations) {
			if (identities.has(observation.identity)) {
				this.byKey.delete(key);
				this.observations.delete(key);
			}
		}
	}

	get size(): number {
		return this.byKey.size;
	}
}
