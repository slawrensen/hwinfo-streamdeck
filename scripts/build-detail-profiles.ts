/**
 * Writes the bundled detail profiles from the managed-profile registry:
 * `npm run profiles:detail`. Every revision builds from the ONE layout
 * table: revisions 1 and 2 (frozen for already installed copies) must
 * reproduce their committed bytes exactly, and revision 3 (the
 * unnumbered display name) is the identity the runtime switches to.
 * Deterministic by construction (see
 * scripts/lib/detail-profile-archive.ts) — running it twice, or on
 * another machine, produces byte-identical artifacts, and the committed
 * files are locked to the registry by test/detail-profiles.test.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DETAIL_PROFILES, detailProfileNameFor } from "../src/detail/managed-profiles";
import { buildDetailProfileArchive, type DetailProfileRevision } from "./lib/detail-profile-archive";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");

let changed = 0;
for (const revision of [1, 2, 3] as DetailProfileRevision[]) {
	for (const profile of DETAIL_PROFILES) {
		const archive = buildDetailProfileArchive(profile, revision);
		const name = detailProfileNameFor(profile.key, revision);
		const target = path.join(pluginDir, `${name}.streamDeckProfile`);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		const existing = fs.existsSync(target) ? fs.readFileSync(target) : null;
		if (existing !== null && existing.equals(archive)) {
			console.error(`unchanged  ${name}.streamDeckProfile (${archive.length} bytes)`);
			continue;
		}
		fs.writeFileSync(target, archive);
		changed++;
		console.error(`written    ${name}.streamDeckProfile (${archive.length} bytes, ${profile.layout.columns}x${profile.layout.rows}, ${profile.layout.readings.length} reading slots)`);
	}
}
console.error(changed === 0 ? "All detail profiles up to date." : `${changed} detail profile(s) rebuilt.`);
