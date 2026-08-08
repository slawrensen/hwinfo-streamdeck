/**
 * Writes the bundled profiles from the managed registries:
 * `npm run profiles:detail`.
 *
 * Detail family: every revision builds from the ONE layout table:
 * revisions 1 and 2 (frozen for already installed copies) must reproduce
 * their committed bytes exactly, and revision 3 (the unnumbered display
 * name) is the identity the runtime switches to.
 *
 * Workspace family (issue #5 follow-up, spike): one four-page freeform
 * bundle per device class, each page empty except the baked Back key.
 * NO revision scheme, by design: workspace pages hold user layouts, so
 * a shipped bundle's name, GUIDs and bytes are FROZEN FOREVER (see
 * scripts/lib/workspace-profile-archive.ts for the full freeze rule).
 *
 * Deterministic by construction (see the two archive builders) — running
 * this twice, or on another machine, produces byte-identical artifacts,
 * and the committed files are locked to the registries by
 * test/detail-profiles.test.ts and test/workspace.test.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WORKSPACE_PAGE_COUNT } from "../src/detail/detail-settings";
import { DETAIL_PROFILES, detailProfileNameFor } from "../src/detail/managed-profiles";
import { WORKSPACE_PROFILES } from "../src/detail/workspace-profiles";
import { buildDetailProfileArchive, type DetailProfileRevision } from "./lib/detail-profile-archive";
import { buildWorkspaceProfileArchive } from "./lib/workspace-profile-archive";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");

let changed = 0;
function emit(name: string, archive: Buffer, describe: string): void {
	const target = path.join(pluginDir, `${name}.streamDeckProfile`);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	const existing = fs.existsSync(target) ? fs.readFileSync(target) : null;
	if (existing !== null && existing.equals(archive)) {
		console.error(`unchanged  ${name}.streamDeckProfile (${archive.length} bytes)`);
		return;
	}
	fs.writeFileSync(target, archive);
	changed++;
	console.error(`written    ${name}.streamDeckProfile (${archive.length} bytes, ${describe})`);
}

for (const revision of [1, 2, 3] as DetailProfileRevision[]) {
	for (const profile of DETAIL_PROFILES) {
		emit(detailProfileNameFor(profile.key, revision), buildDetailProfileArchive(profile, revision), `${profile.layout.columns}x${profile.layout.rows}, ${profile.layout.readings.length} reading slots`);
	}
}
for (const profile of WORKSPACE_PROFILES) {
	emit(profile.name, buildWorkspaceProfileArchive(profile), `${profile.columns}x${profile.rows}, ${WORKSPACE_PAGE_COUNT} workspace pages`);
}
console.error(changed === 0 ? "All bundled profiles up to date." : `${changed} bundled profile(s) rebuilt.`);
