/**
 * Opener-owned page placement (7E): an opener's intentional empty cells
 * (detailGaps) turned into the reserved tile indices pageOf skips, page by
 * page. Pure functions over cells and slot indices; the navigator feeds
 * them registered slot coordinates on a live page, the settings panel's
 * preview feeds them the bundle's shipped layout.
 */
import type { SensorSnapshot } from "../hwinfo/types";
import { t } from "../i18n";
import { pageOf, projectDetailTiles, resolveDetailGroup, type DetailGroupSettings, type DetailPage } from "./detail-group";
import { detailDensityOf, detailGapsOf, detailMirrorBackOf, detailModeOf, detailTilesOf, storedDetailGapsOf } from "./detail-settings";
import { readingSlotCapacity, type ManagedDetailProfile, type SlotCell } from "./managed-profiles";

/** The one spelling of a cell in every map below. */
export function cellId(cell: SlotCell): string {
	return `${cell.column},${cell.row}`;
}

/** Reading-slot index per cell as the bundle ships it (layout.readings
 * is in slot-index order). Used where no slot has registered, like the
 * settings panel's preview. */
export function layoutSlotIndexByCell(readings: readonly SlotCell[]): ReadonlyMap<string, number> {
	return new Map(readings.map((cell, index) => [cellId(cell), index]));
}

/** Each page's gap cells as reading-slot indices. A cell no slot sits on
 * (a slot the user replaced with a key of their own) reserves nothing,
 * and an index past the page's slots is dropped. */
export function gapSlotSets(gapCells: readonly (readonly SlotCell[])[], slotIndexByCell: ReadonlyMap<string, number>, pageSize: number): readonly ReadonlySet<number>[] {
	return gapCells.map((cells) => {
		const set = new Set<number>();
		for (const cell of cells) {
			const index = slotIndexByCell.get(cellId(cell));
			if (index !== undefined && index < pageSize) set.add(index);
		}
		return set;
	});
}

/**
 * The per-page reserved tile sets for pageOf: the mirror Back on every
 * page plus that page's gaps. The mirror wins a cell both claim (it is
 * in the set either way, and the controller draws it as Back). A page
 * whose gaps would leave no reading tile beside the mirror keeps the
 * mirror alone. Undefined when no page has a gap that maps onto a slot:
 * the caller then passes the single mirror index, the original path.
 */
export function reservedSlotsFor(gapCells: readonly (readonly SlotCell[])[], slotIndexByCell: ReadonlyMap<string, number>, mirror: number | null, pageSize: number): ((pageIndex: number) => ReadonlySet<number>) | undefined {
	const pages = gapSlotSets(gapCells, slotIndexByCell, pageSize);
	if (pages.every((set) => set.size === 0)) {
		return undefined;
	}
	const mirrorOnly: ReadonlySet<number> = mirror === null ? new Set<number>() : new Set([mirror]);
	return (pageIndex) => {
		const gaps = pages[pageIndex];
		if (gaps === undefined || gaps.size === 0) {
			return mirrorOnly;
		}
		const out = new Set(gaps);
		if (mirror !== null) out.add(mirror);
		return out.size >= pageSize ? mirrorOnly : out;
	};
}

/** A stable text form of the gap slot sets, for change detection. */
export function gapSignature(gapCells: readonly (readonly SlotCell[])[], slotIndexByCell: ReadonlyMap<string, number>, pageSize: number): string {
	return gapSlotSets(gapCells, slotIndexByCell, pageSize)
		.map((set) => [...set].sort((a, b) => a - b).join(","))
		.join("|");
}

/** The opener settings a preview reads: the list knobs, salvage-parsed. */
export type DetailPreviewDraft = DetailGroupSettings & { detailDensity?: unknown; detailTiles?: unknown; detailGaps?: unknown; detailMirrorBack?: unknown };

/** One reading cell of a previewed page. */
export type DetailPreviewCell = {
	readonly column: number;
	readonly row: number;
	/** reading: tiles carrying readings; empty: past the list end; gap:
	 *  an intentional empty cell; back: the mirror Back on the opener's
	 *  own cell. */
	readonly kind: "reading" | "empty" | "gap" | "back";
	/** On a gap: stored, but the deck ignores this page's gaps because
	 *  they and the mirror leave no cell for readings. The panel draws it
	 *  as kept empty, so a press takes the stored gap away, the way the
	 *  cell reads. */
	readonly ignored?: true;
	/** The tile's first reading as the page names it (its tile label,
	 *  else the reading's own label, else "Sensor missing"). */
	readonly label?: string;
	/** How many readings the tile carries. */
	readonly count?: number;
};

export type DetailPreview = {
	readonly pageIndex: number;
	/** Logical pages the list fills; 0 when it does not resolve now. */
	readonly pageCount: number;
	readonly rangeText: string;
	/** False when the list cannot resolve now (no data, an unset filter). */
	readonly resolved: boolean;
	readonly cells: readonly DetailPreviewCell[];
};

/** Pages a preview walks before it stops counting. */
const PREVIEW_PAGES_MAX = 512;

/**
 * One page of an opener's detail view as the deck would lay it out,
 * through the same resolver, tile projection and page walk the
 * navigator runs, over the bundle's shipped layout (no slot has
 * registered while the panel is open on the opener). Pure and
 * read-only: the settings panel shows it, nothing is written. A page
 * past the list end still shows its gaps and the mirror, so empty cells
 * can be placed on any page up to the gap page limit.
 */
export function previewDetailPage(snapshot: SensorSnapshot | null, draft: DetailPreviewDraft, profile: ManagedDetailProfile, openerCell: SlotCell | null, pageIndex: number): DetailPreview {
	const readings = profile.layout.readings;
	const pageSize = readingSlotCapacity(profile);
	const byCell = layoutSlotIndexByCell(readings);
	const mirror = openerCell !== null && detailMirrorBackOf(draft) ? (byCell.get(cellId(openerCell)) ?? null) : null;
	const reservedFn = reservedSlotsFor(detailGapsOf(draft, profile), byCell, mirror, pageSize);
	const reserved = reservedFn ?? mirror ?? undefined;
	const group = resolveDetailGroup(snapshot, draft);
	const keys = group?.keys ?? [];
	const plan = group !== null && detailModeOf(draft) === "custom" ? projectDetailTiles(group, detailTilesOf(draft)) : [];
	const density = detailDensityOf(draft);
	const wanted = Number.isInteger(pageIndex) && pageIndex > 0 ? Math.min(pageIndex, PREVIEW_PAGES_MAX - 1) : 0;
	let page = pageOf(keys, 0, pageSize, reserved, density, plan);
	let shown: DetailPage | undefined = wanted === 0 ? page : undefined;
	let count = 1;
	while (page.hasNext && count < PREVIEW_PAGES_MAX) {
		page = pageOf(keys, page.offset + page.step, pageSize, reserved, density, plan);
		if (count === wanted) shown = page;
		count++;
	}
	// Past the list end: no readings, only what this page reserves.
	const reservedHere = shown?.reserved ?? [...(reservedFn?.(wanted) ?? (mirror === null ? [] : [mirror]))].filter((i) => i >= 0 && i < pageSize);
	// What this page stores, applied or not (a page its gaps and the
	// mirror fill is ignored by the deck, but it is still what is saved).
	const storedHere = gapSlotSets([storedDetailGapsOf(draft, profile)[wanted] ?? []], byCell, pageSize)[0] ?? new Set<number>();
	const cells: DetailPreviewCell[] = readings.map((cell, index) => {
		const at = { column: cell.column, row: cell.row };
		if (index === mirror) return { ...at, kind: "back" };
		if (reservedHere.includes(index)) return { ...at, kind: "gap" };
		if (storedHere.has(index)) return { ...at, kind: "gap", ignored: true };
		const chunk = shown?.chunks[index] ?? [];
		const first = chunk[0];
		if (first === undefined) return { ...at, kind: "empty" };
		const tileLabel = shown?.specs[index]?.labels[0];
		const label = tileLabel !== undefined && tileLabel !== "" ? tileLabel : (snapshot?.byKey.get(first)?.label ?? t("face.missing.title"));
		return { ...at, kind: "reading", label, count: chunk.length };
	});
	return {
		pageIndex: wanted,
		pageCount: group === null ? 0 : count,
		rangeText: shown?.rangeText ?? "",
		resolved: group !== null,
		cells
	};
}
