/** Explicit user-confirmed equivalences, never inferred from names/values. */
import type { Reading, SensorSnapshot } from "./types";

export type ReadingLink = {
	sharedMemory: string;
	gadget: string;
	unit: string;
	sensorType: number;
};

/** More stored rows than this turns the whole list off (never the first 128). */
export const READING_LINKS_MAX = 128;
/** The longest unit a row may carry. */
export const READING_LINK_UNIT_MAX = 32;
/** A Shared Memory endpoint: hex sensor id, instance, hex reading id. */
export const LINK_SHARED_MEMORY_KEY = /^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/i;
/** A Gadget endpoint: the current key the picker writes (g: or g2:). */
export const LINK_GADGET_KEY = /^(?:g:[^:~\r\n]*:[^:~\r\n]*|g2:[A-Za-z0-9_-]+)$/;

/** What the parser made of one stored row, by its position. */
export type ReadingLinkRowVerdict =
	| { readonly index: number; readonly verdict: "valid"; readonly link: ReadingLink }
	/** Not an object, a key in the wrong spelling, or a bad unit or type. */
	| { readonly index: number; readonly verdict: "malformed" }
	/** Well formed, but an endpoint also appears in another well-formed row:
	 * every row involved is refused, whatever their order. */
	| { readonly index: number; readonly verdict: "conflict"; readonly link: ReadingLink }
	/** The list holds more than 128 rows, so none of them applies. */
	| { readonly index: number; readonly verdict: "cap" };

function wellFormedLink(item: unknown): ReadingLink | undefined {
	if (typeof item !== "object" || item === null || Array.isArray(item)) return undefined;
	const row = item as Partial<ReadingLink>;
	if (typeof row.sharedMemory !== "string" || !LINK_SHARED_MEMORY_KEY.test(row.sharedMemory)) return undefined;
	if (typeof row.gadget !== "string" || !LINK_GADGET_KEY.test(row.gadget)) return undefined;
	if (typeof row.unit !== "string" || row.unit.length > READING_LINK_UNIT_MAX || typeof row.sensorType !== "number" || !Number.isInteger(row.sensorType) || row.sensorType < 0 || row.sensorType > 8) return undefined;
	return { sharedMemory: row.sharedMemory, gadget: row.gadget, unit: row.unit, sensorType: row.sensorType };
}

/**
 * One verdict per stored row, in stored order: the single place the row
 * rules live, read by parseReadingLinks (which applies) and by the pairing
 * panel's health report (which explains), so the two can never disagree.
 * A value that is not an array has no rows.
 */
export function readingLinkRows(raw: unknown): readonly ReadingLinkRowVerdict[] {
	if (!Array.isArray(raw)) return [];
	const items = raw as unknown[];
	// Index loops, not map: a hole in the array is a row too (malformed).
	if (items.length > READING_LINKS_MAX) return Array.from({ length: items.length }, (_unused, index): ReadingLinkRowVerdict => ({ index, verdict: "cap" }));
	const parsed = Array.from({ length: items.length }, (_unused, index) => wellFormedLink(items[index]));
	// Conflicting endpoints invalidate every involved pair; order never wins.
	const counts = new Map<string, number>();
	for (const link of parsed) {
		if (link === undefined) continue;
		for (const key of [link.sharedMemory, link.gadget]) counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return parsed.map((link, index): ReadingLinkRowVerdict => {
		if (link === undefined) return { index, verdict: "malformed" };
		return counts.get(link.sharedMemory) === 1 && counts.get(link.gadget) === 1 ? { index, verdict: "valid", link } : { index, verdict: "conflict", link };
	});
}

export function parseReadingLinks(raw: unknown): readonly ReadingLink[] {
	const valid: ReadingLink[] = [];
	for (const row of readingLinkRows(raw)) if (row.verdict === "valid") valid.push(row.link);
	return valid;
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
 * How one confirmed pair resolves against a provider's own snapshot. The
 * single per-link decision: applyReadingLinks aliases exactly the pairs
 * that resolve to "shared-memory" or "gadget", and the pairing panel's link
 * health reads the same answer, so health can never disagree with what the
 * keys show.
 */
export type ReadingLinkResolution =
	/** The Shared Memory endpoint is published in the pair's unit and type. */
	| { readonly state: "shared-memory"; readonly found: Reading }
	/** The Gadget endpoint is published in the pair's unit. */
	| { readonly state: "gadget"; readonly found: Reading }
	/** Both endpoints are published at once: the plugin never chooses. */
	| { readonly state: "both-live" }
	/** Neither endpoint is published by this snapshot. */
	| { readonly state: "neither-live" }
	/** The published endpoint now carries another unit. */
	| { readonly state: "unit-changed"; readonly found: Reading; readonly endpoint: "shared-memory" | "gadget" }
	/** The Shared Memory endpoint now carries another HWiNFO type. */
	| { readonly state: "type-changed"; readonly found: Reading };

export function resolveReadingLink(snapshot: Pick<SensorSnapshot, "byKey">, link: ReadingLink): ReadingLinkResolution {
	const primary = snapshot.byKey.get(link.sharedMemory);
	const fallback = snapshot.byKey.get(link.gadget);
	// Never choose between two live entries or reinterpret changed units.
	if (primary !== undefined && fallback !== undefined) return { state: "both-live" };
	if (primary === undefined) {
		if (fallback === undefined) return { state: "neither-live" };
		return fallback.unit !== link.unit ? { state: "unit-changed", found: fallback, endpoint: "gadget" } : { state: "gadget", found: fallback };
	}
	if (primary.unit !== link.unit) return { state: "unit-changed", found: primary, endpoint: "shared-memory" };
	// The type is HWiNFO's own only on the shared-memory endpoint. Gadget
	// infers it from the display unit, which is already compared, so
	// holding that guess to the reported type could only refuse a true
	// pair (HWiNFO types several "%" readings as Other, not Usage).
	if (primary.type !== link.sensorType) return { state: "type-changed", found: primary };
	return { state: "shared-memory", found: primary };
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
		const resolution = resolveReadingLink(snapshot, link);
		if (resolution.state !== "shared-memory" && resolution.state !== "gadget") continue;
		const found = resolution.found;
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
