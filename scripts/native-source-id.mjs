// Generates source-id.h for every shipped native binary
// (scripts/lib/native-binaries.mjs): native/hwsm/source-id.h defines
// HWSM_SOURCE_ID, a SHA-256 over that binary's native source inputs, so a
// binary identifies exactly which native source built it. Content-derived
// only: no timestamps, no repo-wide commit ids, so unrelated TypeScript
// work never changes it. Runs as part of `npm run build:native`. A bare
// node-gyp invocation without it compiles hwsm with the "unset" fallback.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NATIVE_BINARIES, nativeSourceId, sourceIdHeader } from "./lib/native-binaries.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const binary of NATIVE_BINARIES) {
	const id = nativeSourceId(repoRoot, binary);
	const header = sourceIdHeader(binary, id);
	const dest = path.join(repoRoot, ...binary.dir.split("/"), "source-id.h");
	// Rewritten only on change, so an unchanged tree keeps the header's
	// timestamp and MSBuild's incremental state.
	if (!fs.existsSync(dest) || fs.readFileSync(dest, "utf8") !== header) {
		fs.writeFileSync(dest, header);
	}
	console.log(`${binary.target} nativeSourceId: ${id}`);
}
