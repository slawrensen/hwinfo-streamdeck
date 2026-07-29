/**
 * The managed detail-profile registry: the ONE authority for the bundled
 * drill-down profiles (issue #5). Six device classes ship, one reusable
 * profile each; every profile is a single physical page whose cells all
 * carry the hidden detail-slot action with a static role binding.
 *
 * Nothing outside this module may hardcode a detail profile name, grid
 * size, slot capacity, device-type mapping or coordinate plan: the
 * runtime (navigation, controller), the deterministic profile generator
 * (scripts/build-detail-profiles.ts) and the validation tests all read
 * this table.
 *
 * Deliberately absent: Mobile (3) and Virtual (11) have variable
 * canvases, Studio (10) does not take app profiles the same way, Galleon
 * (12) needs its own verified support pass, and Pedal/G-Keys/SCUF have no
 * usable detail canvas. Unsupported devices keep the ordinary Sensor
 * Reading behavior and fail entry honestly (alert, no switch).
 */
import { DeviceType } from "@elgato/schemas/streamdeck/plugins";

/** Navigation roles a detail page always carries. */
export type DetailNavRole = "back" | "title" | "previous" | "next";

export type SlotCell = { readonly column: number; readonly row: number };

export type DetailLayout = {
	readonly columns: number;
	readonly rows: number;
	/** Nav cell per role; null when the grid has no room (Mini's title). */
	readonly nav: Readonly<Record<DetailNavRole, SlotCell | null>>;
	/** Reading cells in slot-index order (row-major over the free cells). */
	readonly readings: readonly SlotCell[];
};

export type ManagedDetailProfile = {
	/** Registry key; also the generator's GUID namespace component. */
	readonly key: "mini" | "standard" | "neo" | "plus" | "xl" | "plus-xl";
	/** Manifest `Profiles.Name`: path from the .sdPlugin root, no extension. */
	readonly name: string;
	readonly deviceType: number;
	/**
	 * Archive DeviceModel metadata. Provenance per entry (2026-07-28, all
	 * from artifacts present on the build machine unless noted):
	 * - mini: Elgato tutorial-plugin Mini profile export.
	 * - standard: Elgato Volume Controller profile export.
	 * - neo: NOT locally evidenced (no Neo artifact or hardware); code from
	 *   the Stream Deck 7.4.2 app's own device resource table. Marked
	 *   unverified until a real Neo import test happens.
	 * - plus: Elgato Volume Controller and Discord Volume Mixer exports.
	 * - xl: Elgato Volume Controller and tutorial-plugin XL exports.
	 * - plus-xl: Elgato Volume Controller + XL export; matches the build
	 *   machine's own 20GBX9901 hardware.
	 */
	readonly deviceModel: string;
	/** True when the model string came from a real local export/hardware. */
	readonly modelVerified: boolean;
	/** Encoder count, for the page manifest's (empty) Encoder controller. */
	readonly encoders: number;
	readonly layout: DetailLayout;
};

/** Row-major reading plan over every cell not claimed by a nav role. */
function buildLayout(columns: number, rows: number, nav: Readonly<Record<DetailNavRole, SlotCell | null>>): DetailLayout {
	const taken = new Set<string>();
	for (const cell of Object.values(nav)) {
		if (cell !== null) {
			taken.add(`${cell.column},${cell.row}`);
		}
	}
	const readings: SlotCell[] = [];
	for (let row = 0; row < rows; row++) {
		for (let column = 0; column < columns; column++) {
			if (!taken.has(`${column},${row}`)) {
				readings.push({ column, row });
			}
		}
	}
	return { columns, rows, nav, readings };
}

/**
 * The six bundles. Back is always top-left (0,0), matching where native
 * folders put their fixed back key; the rest of the navigation fills the
 * left column first and overflows rightward on short grids.
 */
export const DETAIL_PROFILES: readonly ManagedDetailProfile[] = [
	{
		key: "mini",
		name: "profiles/detail-mini",
		deviceType: DeviceType.StreamDeckMini,
		deviceModel: "20GAI9901",
		modelVerified: true,
		encoders: 0,
		layout: buildLayout(3, 2, {
			back: { column: 0, row: 0 },
			title: null,
			previous: { column: 0, row: 1 },
			next: { column: 1, row: 1 }
		})
	},
	{
		key: "standard",
		name: "profiles/detail-standard",
		deviceType: DeviceType.StreamDeck,
		deviceModel: "20GBA9901",
		modelVerified: true,
		encoders: 0,
		layout: buildLayout(5, 3, {
			back: { column: 0, row: 0 },
			title: { column: 1, row: 0 },
			previous: { column: 0, row: 1 },
			next: { column: 0, row: 2 }
		})
	},
	{
		key: "neo",
		name: "profiles/detail-neo",
		deviceType: DeviceType.StreamDeckNeo,
		deviceModel: "20GBJ9901",
		modelVerified: false,
		encoders: 0,
		layout: buildLayout(4, 2, {
			back: { column: 0, row: 0 },
			title: { column: 1, row: 0 },
			previous: { column: 0, row: 1 },
			next: { column: 1, row: 1 }
		})
	},
	{
		key: "plus",
		name: "profiles/detail-plus",
		deviceType: DeviceType.StreamDeckPlus,
		deviceModel: "20GBD9901",
		modelVerified: true,
		encoders: 4,
		layout: buildLayout(4, 2, {
			back: { column: 0, row: 0 },
			title: { column: 1, row: 0 },
			previous: { column: 0, row: 1 },
			next: { column: 1, row: 1 }
		})
	},
	{
		key: "xl",
		name: "profiles/detail-xl",
		deviceType: DeviceType.StreamDeckXL,
		deviceModel: "20GAT9901",
		modelVerified: true,
		encoders: 0,
		layout: buildLayout(8, 4, {
			back: { column: 0, row: 0 },
			title: { column: 0, row: 1 },
			previous: { column: 0, row: 2 },
			next: { column: 0, row: 3 }
		})
	},
	{
		key: "plus-xl",
		name: "profiles/detail-plus-xl",
		deviceType: DeviceType.StreamDeckPlusXL,
		deviceModel: "20GBX9901",
		modelVerified: true,
		encoders: 6,
		layout: buildLayout(9, 4, {
			back: { column: 0, row: 0 },
			title: { column: 0, row: 1 },
			previous: { column: 0, row: 2 },
			next: { column: 0, row: 3 }
		})
	}
];

/** The bundle for a device type, or undefined when the class isn't supported. */
export function detailProfileFor(deviceType: number | undefined): ManagedDetailProfile | undefined {
	return DETAIL_PROFILES.find((p) => p.deviceType === deviceType);
}

/** Reading slots per page on this bundle's device class. */
export function readingSlotCapacity(profile: ManagedDetailProfile): number {
	return profile.layout.readings.length;
}
