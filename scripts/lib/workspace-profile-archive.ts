/**
 * Deterministic .streamDeckProfile builder for the bundled workspace
 * profiles (issue #5 follow-up, spike). Same construction law as the
 * detail archives: GUIDs derive from stable namespaces, timestamps are
 * fixed, the ZIP writer is the shared store-only one, and every value
 * comes from the workspace registry. Two runs, any machine, identical
 * bytes.
 *
 * Archive shape (v3 profile format, same trio-plus-pages layout as the
 * detail archives, which a real import on hardware verified):
 *   package.json
 *   Profiles/<UMBRELLA>.sdProfile/manifest.json
 *   Profiles/<UMBRELLA>.sdProfile/Profiles/<PAGE-0>/manifest.json
 *   ... one folder per page, all listed in the umbrella's Pages.Pages
 *
 * Each of the four pages carries exactly ONE baked cell: the canonical
 * Back (a real Sensor Reading action with only { detailRole: "back" },
 * the identical configuration the revision-2+ detail pages bake), at the
 * same cell the class's detail profile puts its Back. Every other cell
 * is EMPTY on purpose: the workspace is the user's canvas.
 *
 * IDENTITY FREEZE (do not break, ever): installed Stream Deck profiles
 * never auto-update, and a workspace page holds USER LAYOUTS, so any
 * change to a shipped bundle would force a new profile identity and
 * strand every customized copy behind a re-prompt. Once a workspace
 * bundle ships, its manifest name, GUID namespace, page count, baked
 * cell plan and bytes are frozen forever. There is deliberately no
 * revision scheme; the pages ship empty precisely so there is never a
 * content reason to revise.
 */
import { WORKSPACE_PAGE_COUNT } from "../../src/detail/detail-settings";
import type { ManagedWorkspaceProfile } from "../../src/detail/workspace-profiles";
import { APP_VERSION, cellEntry, guidFor, OS_VERSION, PLUGIN_UUID, SENSOR_READING_UUID, zipStore, type ZipEntry } from "./detail-profile-archive";

/** The display name in the app's profile list. One name, no numbering:
 * the freeze rule above replaces the detail family's revision scheme. */
export const WORKSPACE_PROFILE_DISPLAY_NAME = "HWiNFO Workspace";

/** The internal GUID namespace for one workspace bundle. Distinct from
 * every detail namespace (`.detail:` vs `.workspace:` SHA-1 inputs), so
 * no GUID can collide across the two families. FROZEN once shipped. */
export function workspaceNamespaceFor(profile: Pick<ManagedWorkspaceProfile, "key">): string {
	return `${PLUGIN_UUID}.workspace:${profile.key}`;
}

/** Stable JSON, mirroring the detail builder: insertion order is fixed
 * by construction, no sorting. */
function jsonBytes(value: unknown): Buffer {
	return Buffer.from(JSON.stringify(value), "utf8");
}

export function buildWorkspaceProfileArchive(profile: ManagedWorkspaceProfile): Buffer {
	const { backCell } = profile;
	if (backCell.column < 0 || backCell.column >= profile.columns || backCell.row < 0 || backCell.row >= profile.rows) {
		throw new Error(`${profile.key}: Back cell ${backCell.column},${backCell.row} is outside the ${profile.columns}x${profile.rows} grid`);
	}
	const namespace = workspaceNamespaceFor(profile);
	const umbrella = guidFor(namespace, "umbrella");
	const pages = Array.from({ length: WORKSPACE_PAGE_COUNT }, (_, i) => guidFor(namespace, `page-${i}`));

	const packageJson = {
		AppVersion: APP_VERSION,
		DeviceModel: profile.deviceModel,
		DeviceSettings: null,
		FormatVersion: 1,
		OSType: "Windows",
		OSVersion: OS_VERSION,
		RequiredPlugins: [PLUGIN_UUID]
	};
	const umbrellaManifest = {
		Device: { Model: profile.deviceModel, UUID: umbrella },
		Name: WORKSPACE_PROFILE_DISPLAY_NAME,
		// Every page INCLUDING the default must be listed (the app rejects an
		// import whose Pages list is empty); the first page is the default.
		Pages: { Current: "00000000-0000-0000-0000-000000000000", Default: pages[0], Pages: pages },
		Version: "3.0"
	};

	const entries: ZipEntry[] = [
		{ path: "package.json", data: jsonBytes(packageJson) },
		{ path: `Profiles/${umbrella.toUpperCase()}.sdProfile/manifest.json`, data: jsonBytes(umbrellaManifest) }
	];
	pages.forEach((page, index) => {
		// One baked cell per page: the canonical Back, distinct ActionID per
		// page (distinct GUID names), identical settings marker everywhere.
		const actions: Record<string, unknown> = {
			// The role marker the detail pages bake, PLUS a family marker.
			// Without it the two bundles' Back cells are byte-identical, so
			// nothing at runtime can tell which family's page is on screen
			// and a workspace Back borrows whatever detail session the
			// device is carrying. It has to ship in the FIRST released
			// bytes: the freeze rule means it can never be added later.
			[`${backCell.column},${backCell.row}`]: cellEntry(namespace, `page-${index}:nav:back`, "Sensor Reading", SENSOR_READING_UUID, { detailRole: "back", workspaceBack: true })
		};
		const controllers: Array<Record<string, unknown>> = [{ Actions: actions, Type: "Keypad" }];
		if (profile.encoders > 0) {
			// Dial banks bake empty, exactly like the detail pages: the
			// workspace must not require dials, and an empty bank lets the
			// dial-less Virtual Stream Deck guest borrow the bundle.
			controllers.push({ Actions: null, Type: "Encoder" });
		}
		entries.push({ path: `Profiles/${umbrella.toUpperCase()}.sdProfile/Profiles/${page.toUpperCase()}/manifest.json`, data: jsonBytes({ Controllers: controllers, Icon: "", Name: "" }) });
	});
	return zipStore(entries);
}
