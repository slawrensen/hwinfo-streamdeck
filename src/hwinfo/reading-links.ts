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

export function applyReadingLinks(snapshot: SensorSnapshot, links: readonly ReadingLink[], bindingRevision: number): SensorSnapshot {
	if (links.length === 0) return bindingRevision === 0 ? snapshot : { ...snapshot, bindingRevision };
	const byKey = new Map(snapshot.byKey);
	const aliases = new Map<string, readonly string[]>();
	for (const link of links) {
		const primary = snapshot.byKey.get(link.sharedMemory);
		const fallback = snapshot.byKey.get(link.gadget);
		// Never choose between two live entries or reinterpret changed units.
		if ((primary === undefined) === (fallback === undefined)) continue;
		const reading = primary ?? fallback;
		if (reading === undefined || reading.unit !== link.unit || reading.type !== link.sensorType) continue;
		const linkedKeys = [link.sharedMemory, link.gadget];
		aliases.set(reading.key, linkedKeys);
		for (const key of linkedKeys) byKey.set(key, { ...reading, key, linkedKeys });
	}
	const readings = snapshot.readings.map((reading) => {
		const linkedKeys = aliases.get(reading.key);
		return linkedKeys === undefined ? reading : { ...reading, linkedKeys };
	});
	return { ...snapshot, readings, byKey, bindingRevision };
}

export function readingMatchesKey(reading: Reading, key: string | undefined): boolean {
	return key !== undefined && (reading.key === key || reading.linkedKeys?.includes(key) === true);
}
