/**
 * The managed workspace-profile registry (issue #5 follow-up, spike): one
 * bundled "HWiNFO Workspace" profile per supported device class, each a
 * fixed FOUR-page freeform canvas the user fills with ordinary actions
 * (normal Sensor Reading keys in any layout, or anything else). Every
 * page ships empty except the canonical Back key, baked at the same cell
 * the detail profiles use for theirs (top left), so any workspace page
 * always carries its way out and nothing else.
 *
 * The device-class matrix, carve-outs and guest rules are DERIVED from
 * the detail registry (managed-profiles.ts), never restated: one table
 * decides which devices get bundled profiles at all, and resolution
 * delegates to detailProfileFor so the two families cannot disagree
 * about support (the PI's one support answer serves both notes).
 *
 * IDENTITY FREEZE: installed Stream Deck profiles never auto-update, and
 * unlike the detail pages (plugin-painted, replaceable by revision) a
 * workspace page holds USER LAYOUTS, so shipping a new identity would
 * strand every customized copy behind a re-prompt. The workspace family
 * therefore has NO revision scheme: profile names, the GUID namespace,
 * the page count and the baked cell plan are frozen forever once
 * shipped. The pages ship empty (Back only) precisely so there is never
 * a content reason to revise the bundle.
 */
import { detailProfileFor, DETAIL_PROFILES, type SlotCell } from "./managed-profiles";

export type ManagedWorkspaceProfile = {
	/** Registry key, shared with the detail bundle it derives from. */
	readonly key: string;
	/** Manifest `Profiles.Name`: path from the .sdPlugin root, no extension. */
	readonly name: string;
	readonly deviceType: number;
	/** Archive DeviceModel metadata; provenance documented per entry in
	 * managed-profiles.ts (the value is carried over verbatim). */
	readonly deviceModel: string;
	readonly modelVerified: boolean;
	/** Encoder count, for each page manifest's (empty) Encoder controller. */
	readonly encoders: number;
	/** Extra DeviceTypes registered in the manifest (variable-canvas
	 * guests), carried over from the detail bundle. */
	readonly guestDeviceTypes: readonly number[];
	/** The device class's key grid. */
	readonly columns: number;
	readonly rows: number;
	/** The one baked cell per page: the canonical Back key, at the same
	 * cell the class's detail profile puts its Back. */
	readonly backCell: SlotCell;
};

/** Manifest `Profiles.Name` for a workspace bundle. FROZEN: no revision
 * suffix, ever (see the identity-freeze note above). */
export function workspaceProfileName(key: string): string {
	return `profiles/workspace-${key}`;
}

/** The registry, derived 1:1 from the detail table. */
export const WORKSPACE_PROFILES: readonly ManagedWorkspaceProfile[] = DETAIL_PROFILES.map((p) => {
	const backCell = p.layout.nav.back;
	if (backCell === null) {
		// Unreachable for the shipped table (every detail layout pins Back at
		// 0,0, test-locked); a registry defect must fail loudly, not ship a
		// workspace page with no way out.
		throw new Error(`${p.key}: detail layout has no Back cell to derive the workspace Back from`);
	}
	return {
		key: p.key,
		name: workspaceProfileName(p.key),
		deviceType: p.deviceType,
		deviceModel: p.deviceModel,
		modelVerified: p.modelVerified,
		encoders: p.encoders,
		guestDeviceTypes: p.guestDeviceTypes,
		columns: p.layout.columns,
		rows: p.layout.rows,
		backCell
	};
});

/**
 * The workspace bundle for a device, or undefined when it isn't
 * supported. Delegates the whole decision (exact owner, guest fit,
 * refusals) to detailProfileFor and maps the winner by key, so the two
 * families resolve identically BY CONSTRUCTION.
 */
export function workspaceProfileFor(deviceType: number | undefined, grid?: { columns: number; rows: number }): ManagedWorkspaceProfile | undefined {
	const detail = detailProfileFor(deviceType, grid);
	if (detail === undefined) {
		return undefined;
	}
	return WORKSPACE_PROFILES.find((p) => p.key === detail.key);
}
