/**
 * Pure resolution of a drill-down detail group: which readings the detail
 * view lists for an opener key, in what order, under what title, and how
 * they paginate. Receives snapshots and settings, returns immutable
 * projections; never touches the SDK or the poller.
 */
import type { SensorSnapshot } from "../hwinfo/types";
import { compileDetailFilter, detailFilterOf, detailKeysOf, detailModeOf, detailTitleOf, type DetailMode } from "./detail-settings";

/**
 * A resolved detail group. `keys` never contains the primary (the opener's
 * own reading lives on the Back tile); in custom mode a configured reading
 * the snapshot does not publish KEEPS its position (rendered as missing)
 * so later readings never shift.
 */
export type DetailGroup = {
	readonly mode: DetailMode;
	readonly primaryKey: string;
	readonly title: string;
	readonly keys: readonly string[];
};

/** The settings slice the resolver reads (a subset of ReadingSettings). */
export type DetailGroupSettings = {
	readingKey?: unknown;
	detailMode?: unknown;
	detailKeys?: unknown;
	detailTitle?: unknown;
	detailFilter?: unknown;
};

function primaryKeyOf(settings: DetailGroupSettings): string | undefined {
	const raw = settings.readingKey;
	return typeof raw === "string" && raw !== "" ? raw : undefined;
}

/**
 * Resolves the group against a snapshot. Source mode identifies the
 * primary reading's owning sensor by the reading's STABLE key and selects
 * every reading currently belonging to that source in snapshot order —
 * never by label, index or name similarity. With no snapshot (HWiNFO
 * down) or a missing primary, source mode returns null so the caller can
 * ride on its last valid resolution; custom mode never needs the snapshot
 * and always resolves.
 */
export function resolveDetailGroup(snapshot: SensorSnapshot | null, settings: DetailGroupSettings): DetailGroup | null {
	const primaryKey = primaryKeyOf(settings);
	if (primaryKey === undefined) {
		return null;
	}
	const mode = detailModeOf(settings);
	const customTitle = detailTitleOf(settings);
	if (mode === "custom") {
		return {
			mode,
			primaryKey,
			title: customTitle ?? "Custom set",
			keys: detailKeysOf(settings).filter((key) => key !== primaryKey)
		};
	}
	if (snapshot === null) {
		return null;
	}
	if (mode === "filter") {
		// Pattern-driven: the primary identifies nothing here (it lives on
		// the Back tile and is excluded like everywhere else), so the group
		// resolves even while the primary reading itself is missing. An
		// unset pattern is unresolvable, not everything: entry alerts
		// instead of opening a firehose nobody asked for.
		const pattern = detailFilterOf(settings);
		if (pattern === undefined) {
			return null;
		}
		const matches = compileDetailFilter(pattern);
		const keys: string[] = [];
		for (const reading of snapshot.readings) {
			if (reading.key === primaryKey) {
				continue;
			}
			const sourceName = snapshot.sensors[reading.sensorIndex]?.name ?? "";
			if (matches(`${sourceName} ${reading.label}`)) {
				keys.push(reading.key);
			}
		}
		return {
			mode,
			primaryKey,
			title: customTitle ?? pattern,
			keys
		};
	}
	const primary = snapshot.byKey.get(primaryKey);
	if (primary === undefined) {
		return null;
	}
	if (primary.sensorIndex < 0) {
		// An orphan reading (its SHM row pointed past the sensor table; the
		// reader parks those at -1). Every orphan shares that -1, so grouping
		// by it would list OTHER sources' strays under this reading's label.
		// Unresolvable is the honest answer: entry alerts, an open view rides
		// its last valid list.
		return null;
	}
	const keys: string[] = [];
	for (const reading of snapshot.readings) {
		if (reading.sensorIndex === primary.sensorIndex && reading.key !== primaryKey) {
			keys.push(reading.key);
		}
	}
	const sourceName = snapshot.sensors[primary.sensorIndex]?.name;
	return {
		mode,
		primaryKey,
		title: customTitle ?? sourceName ?? primary.label,
		keys
	};
}

/** One logical page of a group under a device's reading-slot capacity. */
export type DetailPage = {
	/** Keys for slot indices 0..pageSize-1; undefined = empty slot. */
	readonly slots: readonly (string | undefined)[];
	/** Clamped page offset actually shown (multiple of the step). */
	readonly offset: number;
	/** Keys consumed per page: the capacity, minus a reserved slot. */
	readonly step: number;
	readonly hasPrevious: boolean;
	readonly hasNext: boolean;
	/** "3-7 / 12" style range text; "0 / 0" for an empty group. */
	readonly rangeText: string;
};

/** Clamps an arbitrary stored offset onto a real page boundary. */
export function clampOffset(totalKeys: number, offset: number, pageSize: number): number {
	if (pageSize <= 0 || !Number.isFinite(offset)) {
		return 0;
	}
	const lastPageStart = totalKeys <= 0 ? 0 : Math.floor((totalKeys - 1) / pageSize) * pageSize;
	const wanted = Math.max(0, Math.min(lastPageStart, Math.trunc(offset)));
	return wanted - (wanted % pageSize);
}

/**
 * Projects one logical page; pure math, safe for any offset. An optional
 * RESERVED slot index (the mirror Back tile riding on the opener's own
 * cell) is skipped by the key mapping: readings flow around it, every
 * page pays exactly one slot for it, and no reading is ever hidden. A
 * reserved index outside 0..pageSize-1 (or a one-slot page) is ignored.
 */
export function pageOf(keys: readonly string[], offset: number, pageSize: number, reservedSlot?: number): DetailPage {
	const safeSize = Math.max(1, Math.trunc(pageSize));
	const reserved = reservedSlot !== undefined && Number.isInteger(reservedSlot) && reservedSlot >= 0 && reservedSlot < safeSize && safeSize > 1 ? reservedSlot : null;
	const step = reserved === null ? safeSize : safeSize - 1;
	const start = clampOffset(keys.length, offset, step);
	const slots: (string | undefined)[] = [];
	for (let i = 0; i < safeSize; i++) {
		if (reserved !== null && i === reserved) {
			slots.push(undefined);
		} else {
			slots.push(keys[start + (reserved !== null && i > reserved ? i - 1 : i)]);
		}
	}
	const shown = Math.min(step, Math.max(0, keys.length - start));
	const rangeText = keys.length === 0 ? "0 / 0" : `${start + 1}-${start + shown} / ${keys.length}`;
	return {
		slots,
		offset: start,
		step,
		hasPrevious: start > 0,
		hasNext: start + step < keys.length,
		rangeText
	};
}
