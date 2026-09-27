/** Release input is data. Run before installing dependencies or building. */
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, root), "utf8"));

try {
	const tag = process.env.RELEASE_TAG ?? "";
	// Only stable vX.Y.Z tags are supported. No normalization, suffixes, shell
	// evaluation, or prefix matches: a malformed ref fails as literal data.
	if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$(?![\s\S])/.test(tag)) {
		throw new Error("release tag must be exactly vX.Y.Z with no leading zeros or suffix");
	}
	const version = tag.slice(1);
	const manifest = read("com.lawrensen.hwinfo.sdPlugin/manifest.json");
	const pkg = read("package.json");
	const lock = read("package-lock.json");
	if (manifest.Version !== `${version}.0` || pkg.version !== version ||
		lock.version !== version || lock.packages?.[""]?.version !== version) {
		throw new Error("release tag must exactly match manifest, package, and both lockfile versions");
	}
	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, `ver=${manifest.Version}\n`, "utf8");
	}
	console.log(`verified release ${tag}: ${manifest.Version}`);
} catch (error) {
	console.error(`${fileURLToPath(import.meta.url)}: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}
