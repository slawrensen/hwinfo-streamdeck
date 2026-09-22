/** Release input is data. Run before installing dependencies or building. */
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, root), "utf8"));
// A file that is absent reads as empty: the check below then says what the
// release is missing instead of surfacing a raw ENOENT.
const text = (name) => {
	try {
		return readFileSync(new URL(name, root), "utf8");
	} catch {
		return "";
	}
};

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
	// One version, one entry: the tag names a CHANGELOG heading that already
	// carries its release date. "Unreleased" is the candidate placeholder,
	// and a tag pushed over it would stage notes with no entry behind them.
	const heading = new RegExp(`^## ${manifest.Version.replaceAll(".", "\\.")} - \\d{4}-\\d{2}-\\d{2}$`, "m");
	if (!heading.test(text("CHANGELOG.md"))) {
		throw new Error(`CHANGELOG.md must carry a dated "## ${manifest.Version} - YYYY-MM-DD" entry for this release`);
	}
	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, `ver=${manifest.Version}\n`, "utf8");
	}
	console.log(`verified release ${tag}: ${manifest.Version}`);
} catch (error) {
	console.error(`${fileURLToPath(import.meta.url)}: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}
