/**
 * Writes the six bundled detail profiles from the managed-profile
 * registry: `npm run profiles:detail`. Deterministic by construction
 * (see scripts/lib/detail-profile-archive.ts) — running it twice, or on
 * another machine, produces byte-identical artifacts, and the committed
 * files are locked to the registry by test/detail-profiles.test.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DETAIL_PROFILES } from "../src/detail/managed-profiles";
import { buildDetailProfileArchive } from "./lib/detail-profile-archive";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");

let changed = 0;
for (const profile of DETAIL_PROFILES) {
	const archive = buildDetailProfileArchive(profile);
	const target = path.join(pluginDir, `${profile.name}.streamDeckProfile`);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	const existing = fs.existsSync(target) ? fs.readFileSync(target) : null;
	if (existing !== null && existing.equals(archive)) {
		console.error(`unchanged  ${profile.name}.streamDeckProfile (${archive.length} bytes)`);
		continue;
	}
	fs.writeFileSync(target, archive);
	changed++;
	console.error(`written    ${profile.name}.streamDeckProfile (${archive.length} bytes, ${profile.layout.columns}x${profile.layout.rows}, ${profile.layout.readings.length} reading slots)`);
}
console.error(changed === 0 ? "All detail profiles up to date." : `${changed} detail profile(s) rebuilt.`);
