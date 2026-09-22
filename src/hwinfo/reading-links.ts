/** Explicit user-confirmed equivalences, never inferred from names/values. */
import type { Reading, SensorSnapshot } from "./types";

export type ReadingLink = {
	sharedMemory: string;
	gadget: string;
	unit: string;
	sensorType: number;
};

export function parseReadingLinks(raw: unknown): readonly ReadingLink[] {
	if (!Array.isArray(raw) || raw.length > 128) return [];
	const valid: ReadingLink[] = [];
	for (const item of raw as unknown[]) {
		if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
		const row = item as Partial<ReadingLink>;
		if (typeof row.sharedMemory !== "string" || !/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/i.test(row.sharedMemory)) continue;
		if (typeof row.gadget !== "string" || !/^(?:g:[^:~\r\n]*:[^:~\r\n]*|g2:[A-Za-z0-9_-]+)$/.test(row.gadget)) continue;
		if (typeof row.unit !== "string" || row.unit.length > 32 || typeof row.sensorType !== "number" || !Number.isInteger(row.sensorType) || row.sensorType < 0 || row.sensorType > 8) continue;
		valid.push({ sharedMemory: row.sharedMemory, gadget: row.gadget, unit: row.unit, sensorType: row.sensorType });
	}
	// Conflicting endpoints invalidate every involved pair; order never wins.
	const counts = new Map<string, number>();
	for (const link of valid) for (const key of [link.sharedMemory, link.gadget]) counts.set(key, (counts.get(key) ?? 0) + 1);
	return valid.filter((link) => counts.get(link.sharedMemory) === 1 && counts.get(link.gadget) === 1);
}

/**
 * The meaning of a validated link list, independent of the order the
 * document lists the pairs in. Every sharedMemory key is unique after the
 * conflict filter, so the sort is total and two documents that pair the
 * same keys the same way produce the same signature. The stored document
 * keeps the user's order; only comparisons use this.
 */
export function readingLinksSignature(links: readonly ReadingLink[]): string {
	return JSON.stringify([...links].sort((a, b) => (a.sharedMemory < b.sharedMemory ? -1 : a.sharedMemory > b.sharedMemory ? 1 : 0)));
}

/** The provider's own key behind an entry: the entry's key, or the key a
 * confirmed alias stands for. Sessions and history follow this identity. */
export function liveKeyOf(reading: Pick<Reading, "key" | "aliasOf">): string {
	return reading.aliasOf ?? reading.key;
}

/**
 * Derives the published view from a provider's own snapshot: every
 * confirmed pair whose exactly one endpoint the provider publishes gains
 * an alias entry for the other endpoint. Always derived from the RAW
 * snapshot, never from an already-aliased one (a second pass over aliases
 * would trip the two-live-entries guard and keep removed pairs alive).
 * Provider-published aliases (a legacy Gadget key kept resolvable) fold
 * into the same group, so one measurement has one alias list everywhere.
 */
export function applyReadingLinks(snapshot: SensorSnapshot, links: readonly ReadingLink[], bindingRevision: number): SensorSnapshot {
	if (links.length === 0) return bindingRevision === 0 ? snapshot : { ...snapshot, bindingRevision };
	const byKey = new Map(snapshot.byKey);
	// Live key -> every key that resolves to it (the live key first).
	const groups = new Map<string, readonly string[]>();
	for (const link of links) {
		const primary = snapshot.byKey.get(link.sharedMemory);
		const fallback = snapshot.byKey.get(link.gadget);
		// Never choose between two live entries or reinterpret changed units.
		if ((primary === undefined) === (fallback === undefined)) continue;
		const found = primary ?? fallback;
		// The type is HWiNFO's own only on the shared-memory endpoint. Gadget
		// infers it from the display unit, which is already compared, so
		// holding that guess to the reported type could only refuse a true
		// pair (HWiNFO types several "%" readings as Other, not Usage).
		if (found === undefined || found.unit !== link.unit || (found === primary && found.type !== link.sensorType)) continue;
		const live = found.aliasOf === undefined ? found : (snapshot.byKey.get(found.aliasOf) ?? found);
		const previous = groups.get(live.key) ?? live.linkedKeys ?? [live.key];
		groups.set(live.key, [...new Set([live.key, ...previous, link.sharedMemory, link.gadget])]);
	}
	for (const [liveKey, group] of groups) {
		const live = snapshot.byKey.get(liveKey);
		if (live === undefined) continue;
		for (const key of group) byKey.set(key, key === liveKey ? { ...live, linkedKeys: group } : { ...live, key, linkedKeys: group, aliasOf: liveKey });
	}
	const readings = snapshot.readings.map((reading) => {
		const group = groups.get(reading.key);
		return group === undefined ? reading : { ...reading, linkedKeys: group };
	});
	return { ...snapshot, readings, byKey, bindingRevision };
}

export function readingMatchesKey(reading: Reading, key: string | undefined): boolean {
	return key !== undefined && (reading.key === key || reading.linkedKeys?.includes(key) === true);
}
