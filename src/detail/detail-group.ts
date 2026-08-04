/**
 * Pure resolution of a drill-down detail group: which readings the detail
 * view lists for an opener key, in what order, under what title, and how
 * they paginate. Receives snapshots and settings, returns immutable
 * projections; never touches the SDK or the poller.
 */
import type { SensorSnapshot } from "../hwinfo/types";
import { compileDetailFilter, detailFilterOf, detailKeysOf, detailModeOf, detailTitleOf, type DetailDensity, type DetailMode, type DetailTileSpec } from "./detail-settings";

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
	/** The readings each physical tile carries, tile indices 0..pageSize-1
	 *  in page order: `density` keys per tile (or the tile plan's own
	 *  sizes), fewer on the page's last filled tile, empty for a tile
	 *  past the group end or reserved for the mirror Back. */
	readonly chunks: readonly (readonly string[])[];
	/** Each tile's hand-grouped spec (labels, colors, variant), parallel
	 *  to `chunks`; undefined = default styling (uniform-density tiles,
	 *  the reserved mirror, tiles past the plan). */
	readonly specs: readonly (DetailTileSpec | undefined)[];
	/** Each tile's FIRST reading; undefined = empty or reserved tile. At
	 *  density 1 this is exactly the pre-density shape (one key per tile),
	 *  which the docs/marketing shot scripts still read. */
	readonly slots: readonly (string | undefined)[];
	/** Clamped page offset actually shown (a real page boundary). */
	readonly offset: number;
	/** READINGS this page consumes, so the mirror Back costs one TILE per
	 *  page, not one reading. Hand-grouped pages make this vary per page;
	 *  forward paging adds it, backward paging uses previousOffset. */
	readonly step: number;
	/** The previous page's first reading (equal to `offset` on page one):
	 *  variable tile sizes mean the page BEFORE this one may consume a
	 *  different count than this one, so backward paging cannot subtract. */
	readonly previousOffset: number;
	readonly hasPrevious: boolean;
	readonly hasNext: boolean;
	/** "3-7 / 12" style range text counting READINGS, never tiles;
	 *  "0 / 0" for an empty group. */
	readonly rangeText: string;
};

/**
 * Projects one logical page; pure math, safe for any offset. An optional
 * RESERVED slot index (the mirror Back tile riding on the opener's own
 * cell) is skipped by the key mapping: readings flow around it, every
 * page pays exactly one TILE for it, and no reading is ever hidden. A
 * reserved index outside 0..pageSize-1 (or a one-slot page) is ignored.
 * `density` readings ride on each tile (issue #5 follow-up), and an
 * optional hand-grouped tile `plan` overrides the uniform density tile
 * by tile: plan tiles take their own sizes (and carry their specs onto
 * the page), readings past the plan flow on at the density. The default
 * inputs reproduce the original one-reading pages exactly, chunk for
 * chunk.
 */
export function pageOf(keys: readonly string[], offset: number, pageSize: number, reservedSlot?: number, density: DetailDensity = 1, plan: readonly DetailTileSpec[] = []): DetailPage {
	const safeSize = Math.max(1, Math.trunc(pageSize));
	const reserved = reservedSlot !== undefined && Number.isInteger(reservedSlot) && reservedSlot >= 0 && reservedSlot < safeSize && safeSize > 1 ? reservedSlot : null;
	const capacity = reserved === null ? safeSize : safeSize - 1;
	// The whole group as a tile run: plan entries first, then the uniform
	// fill. Tiles exist only while readings remain, so a plan longer than
	// the list never mints styled empties.
	const tiles: { start: number; size: number; spec: DetailTileSpec | undefined }[] = [];
	for (let cursor = 0; cursor < keys.length; ) {
		const spec = tiles.length < plan.length ? plan[tiles.length] : undefined;
		const size = spec === undefined ? density : spec.size;
		tiles.push({ start: cursor, size, spec });
		cursor += size;
	}
	// Page boundaries in tile units, then the page holding the offset
	// (snapping DOWN onto a boundary, like the offset always clamped).
	const pageStarts: number[] = [];
	for (let t = 0; t === 0 || t < tiles.length; t += capacity) {
		pageStarts.push(t);
	}
	const wanted = Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0;
	let pageIndex = 0;
	for (let i = 1; i < pageStarts.length; i++) {
		if ((tiles[pageStarts[i] as number] as { start: number }).start <= wanted) {
			pageIndex = i;
		} else {
			break;
		}
	}
	const firstTile = pageStarts[pageIndex] as number;
	const start = tiles[firstTile]?.start ?? 0;
	const nextStart = tiles[firstTile + capacity]?.start;
	const chunks: (readonly string[])[] = [];
	const specs: (DetailTileSpec | undefined)[] = [];
	for (let i = 0; i < safeSize; i++) {
		if (reserved !== null && i === reserved) {
			chunks.push([]);
			specs.push(undefined);
		} else {
			const ordinal = reserved !== null && i > reserved ? i - 1 : i;
			const tile = tiles[firstTile + ordinal];
			chunks.push(tile === undefined ? [] : keys.slice(tile.start, tile.start + tile.size));
			specs.push(tile?.spec);
		}
	}
	const shown = Math.max(0, (nextStart ?? keys.length) - start);
	const step = nextStart !== undefined ? nextStart - start : Math.max(0, keys.length - start);
	const rangeText = keys.length === 0 ? "0 / 0" : `${start + 1}-${start + shown} / ${keys.length}`;
	return {
		chunks,
		specs,
		slots: chunks.map((chunk) => chunk[0]),
		offset: start,
		step,
		previousOffset: pageIndex > 0 ? ((tiles[pageStarts[pageIndex - 1] as number] as { start: number }).start ?? 0) : start,
		hasPrevious: pageIndex > 0,
		hasNext: nextStart !== undefined,
		rangeText
	};
}
