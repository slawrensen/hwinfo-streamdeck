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
import type { Reading, SensorSnapshot } from "./hwinfo/types";

export type SessionStats = {
	min: number;
	max: number;
	sum: number;
	count: number;
};

export type SessionResetReason = "source" | "unit" | "type" | "binding";

const RESET_MESSAGES: Record<SessionResetReason, string> = {
	source: "stats reset: source changed",
	unit: "stats reset: units changed",
	type: "stats reset: reading changed",
	binding: "stats reset: pairing changed"
};

export function sessionResetMessage(reason: SessionResetReason): string {
	return RESET_MESSAGES[reason];
}

type Observation = {
	pollTime: number;
	value: number;
	source: string;
	type: Reading["type"];
	unit: string;
	bindingRevision: number;
};

function observationResetReason(previous: Observation, reading: Reading, source: string, bindingRevision: number): SessionResetReason | undefined {
	if (previous.source !== source) return "source";
	if (previous.unit !== reading.unit) return "unit";
	if (previous.type !== reading.type) return "type";
	if (previous.bindingRevision !== bindingRevision) return "binding";
	return undefined;
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
			if (reading === undefined || !Number.isFinite(reading.value) || observationResetReason(previous, reading, source, snapshot.bindingRevision ?? 0) !== undefined) {
				this.reset([key]);
			}
		}
	}

	/** Sample-weighted local observations, never repeated held frames. A
	 * provider/unit/link change starts a new session for that reading. */
	observe(reading: Reading, snapshot: SensorSnapshot, source: string): SessionResetReason | undefined {
		const bindingRevision = snapshot.bindingRevision ?? 0;
		const previous = this.observations.get(reading.key);
		const reason = previous === undefined ? undefined : observationResetReason(previous, reading, source, bindingRevision);
		if (reason !== undefined) this.reset([reading.key]);
		if (!Number.isFinite(reading.value)) {
			this.reset([reading.key]);
			return;
		}
		if (reason === undefined && previous?.pollTime === snapshot.pollTime && Object.is(previous.value, reading.value)) return;
		this.sample(reading.key, reading.value);
		this.observations.set(reading.key, { pollTime: snapshot.pollTime, value: reading.value, source, type: reading.type, unit: reading.unit, bindingRevision });
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
		stats.sum += value;
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

	get size(): number {
		return this.byKey.size;
	}
}
