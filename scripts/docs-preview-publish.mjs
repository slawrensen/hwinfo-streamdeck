// Stage committed docs for the existing preview repository. Publishing is
// explicit, preserves its history, and requires the head the reviewer inspected.
//
// node scripts/docs-preview-publish.mjs --stage-only --expected-head <sha>
// node scripts/docs-preview-publish.mjs --publish --expected-head <sha>
//
// --source-ref selects a committed source revision (HEAD by default). Staging
// reads git objects, never untracked files or uncommitted working-tree changes.
// No repository creation, Pages reconfiguration, or production push occurs.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseDocument } from "yaml";

export const PREVIEW_REPO = "slawrensen/hwinfo-streamdeck-preview";
export const PREVIEW_BASEURL = "/hwinfo-streamdeck-preview";
export const PREVIEW_URL = `https://docs.slawrensen.com${PREVIEW_BASEURL}/`;
const PREVIEW_REMOTE = `https://github.com/${PREVIEW_REPO}.git`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHA = /^[a-f0-9]{40}$/;
const execute = (command, args, options = {}) => execFileSync(command, args, {
	encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...options
});

function requireSha(value, name) {
	if (typeof value !== "string" || !SHA.test(value)) {
		throw new Error(`${name} must be the full 40-character commit SHA that was inspected`);
	}
	return value;
}

/** Structural YAML overlay. Existing theme, navigation, and shell settings stay
 * intact even when their order, formatting or quoting changes. */
export function previewConfig(source, { sourceSha, expectedHead, buildId }) {
	const document = parseDocument(source, { uniqueKeys: true });
	if (document.errors.length) throw new Error(`Invalid docs configuration: ${document.errors.map(error => error.message).join("; ")}`);
	const data = document.toJS();
	if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Docs configuration must be a mapping");
	if (data.exclude !== undefined && (!Array.isArray(data.exclude) || data.exclude.some(item => typeof item !== "string"))) {
		throw new Error("Docs configuration exclude must be a list of paths");
	}
	const changes = {
		url: "https://docs.slawrensen.com",
		baseurl: PREVIEW_BASEURL,
		docs_preview: true,
		docs_source_sha: sourceSha,
		docs_preview_previous_sha: expectedHead,
		docs_build_id: buildId,
		gh_edit_link: false,
		exclude: [...new Set([...(data.exclude ?? []), "release/", "README.md"])]
	};
	for (const [key, value] of Object.entries(changes)) document.set(key, value);
	return document.toString();
}

/** Return an independent, inspectable directory suitable for a real Jekyll
 * build or connector-based publication. Transport is deliberately separate. */
export function stagePreview({ sourceRoot = ROOT, sourceRef = "HEAD", expectedHead, temporaryRoot = os.tmpdir() }) {
	requireSha(expectedHead, "--expected-head");
	const git = (...args) => execute("git", args, { cwd: sourceRoot });
	const sourceSha = git("rev-parse", "--verify", "--end-of-options", `${sourceRef}^{commit}`).trim();
	requireSha(sourceSha, "source commit");
	const entries = git("ls-tree", "-r", "-z", "--full-tree", sourceSha, "--", "docs/").split("\0").filter(Boolean);
	if (!entries.length) throw new Error("The committed source contains no docs files");
	const stage = fs.mkdtempSync(path.join(temporaryRoot, "hwinfo-docs-preview-stage-"));
	const files = [];
	const excluded = [];
	for (const entry of entries) {
		const match = /^(\d+) blob ([a-f0-9]{40})\t(docs\/.+)$/s.exec(entry);
		if (!match) throw new Error(`Unsupported committed docs entry: ${entry}`);
		const [, mode, objectSha, fullPath] = match;
		const relative = fullPath.slice("docs/".length);
		if (relative.split("/").some(part => part === ".." || part === ".git") || path.isAbsolute(relative)) {
			throw new Error(`Unsafe docs path: ${fullPath}`);
		}
		if (/^(?:release|_site|\.jekyll-cache|\.sass-cache)(?:\/|$)/i.test(relative)) {
			excluded.push(fullPath);
			continue;
		}
		if (/^(?:CNAME|\.nojekyll)$/i.test(relative)) throw new Error(`Unexpected ${fullPath}; the preview inherits its domain and needs Jekyll`);
		if (mode !== "100644" && mode !== "100755") throw new Error(`Only regular committed docs files can be staged: ${fullPath}`);
		const target = path.join(stage, relative);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, execute("git", ["cat-file", "blob", objectSha], { cwd: sourceRoot, encoding: "buffer" }));
		files.push(relative);
	}
	const configPath = path.join(stage, "_config.yml");
	const buildId = `docs-${sourceSha.slice(0, 12)}`;
	fs.writeFileSync(configPath, previewConfig(fs.readFileSync(configPath, "utf8"), { sourceSha, expectedHead, buildId }));
	// The shared shell owns the marker and robots policy. Publishing must not
	// shadow its header or append scripts that mislabel a stable plugin release.
	const templates = files.filter(file => /^(?:_includes|_layouts)\/.*\.html$/.test(file))
		.map(file => fs.readFileSync(path.join(stage, file), "utf8")).join("\n");
	if (!templates.includes("site.docs_preview") || !templates.includes("noindex") || !templates.includes("Documentation preview")) {
		throw new Error("The committed shared shell must render the docs_preview marker and noindex policy before it can be staged");
	}
	const pluginVersion = JSON.parse(git("show", `${sourceSha}:package.json`)).version;
	const manifest = {
		schema: 1,
		kind: "documentation-preview",
		build_id: buildId,
		source_repository: "slawrensen/hwinfo-streamdeck",
		source_commit: sourceSha,
		preview_previous_commit: expectedHead,
		preview_repository: PREVIEW_REPO,
		preview_url: PREVIEW_URL,
		source_plugin_version: pluginVersion
	};
	fs.writeFileSync(path.join(stage, "docs-build.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	fs.writeFileSync(path.join(stage, "README.md"), `# Documentation preview\n\nComplete documentation staged from [${sourceSha}](https://github.com/slawrensen/hwinfo-streamdeck/commit/${sourceSha}).\n\nPreview: ${PREVIEW_URL}\n\nProduction: https://docs.slawrensen.com/hwinfo-streamdeck/\n\nBuild ID: ${buildId}\n\nPrevious preview commit: ${expectedHead}\n\nSource package version: ${pluginVersion}. The website preview identity is separate from plugin release status; verify releases before making a stable-version claim.\n`);
	return { stage, sourceRoot, sourceSha, expectedHead, buildId, files, excluded, manifest };
}

/** Public CLI transport. A rejected read is an error, never evidence that a
 * repository is absent. The exact expected head is checked before staging a
 * commit, immediately before push, and atomically by git's push lease. */
export function publishPreview(staged, { run = execute } = {}) {
	const { stage, sourceRoot, sourceSha, expectedHead } = staged;
	requireSha(expectedHead, "expected preview head");
	const metadata = JSON.parse(run("gh", ["repo", "view", PREVIEW_REPO, "--json", "nameWithOwner,isPrivate,defaultBranchRef"], { cwd: sourceRoot }));
	if (metadata.nameWithOwner !== PREVIEW_REPO || metadata.isPrivate !== false || metadata.defaultBranchRef?.name !== "main") {
		throw new Error("The existing preview repository must be the intended public repository with main as its default branch; no settings were changed");
	}
	const remoteHead = () => {
		const response = run("git", ["ls-remote", "--exit-code", PREVIEW_REMOTE, "refs/heads/main"], { cwd: sourceRoot }).trim();
		const match = /^([a-f0-9]{40})\s+refs\/heads\/main$/.exec(response);
		if (!match) throw new Error("Could not establish the existing preview main head");
		if (match[1] !== expectedHead) throw new Error(`Preview moved from ${expectedHead} to ${match[1]}; inspect and reconcile before retrying`);
	};
	remoteHead();
	const git = (...args) => run("git", args, { cwd: stage });
	git("init", "-b", "main");
	git("remote", "add", "origin", PREVIEW_REMOTE);
	git("fetch", "--depth=1", "origin", "refs/heads/main");
	if (git("rev-parse", "FETCH_HEAD").trim() !== expectedHead) throw new Error("Preview moved during fetch; inspect and reconcile before retrying");
	// A normal child commit preserves the previous preview and permits rollback.
	// The staged directory is complete; files removed from the docs are removed
	// from the preview index by add -A, not left over from an earlier build.
	git("reset", "--mixed", expectedHead);
	git("add", "-A");
	git("-c", "user.name=Documentation Preview", "-c", "user.email=docs-preview@users.noreply.github.com", "commit", "-m", `docs: preview ${staged.buildId} from ${sourceSha}`);
	const previewSha = git("rev-parse", "HEAD").trim();
	remoteHead();
	git("push", `--force-with-lease=refs/heads/main:${expectedHead}`, "origin", "HEAD:refs/heads/main");
	return { ...staged.manifest, preview_commit: previewSha, stage, deployment: "UNVERIFIED: verify the Pages build and served build ID for this commit" };
}

function main() {
	const { values } = parseArgs({ options: {
		"source-ref": { type: "string", default: "HEAD" },
		"expected-head": { type: "string" },
		"stage-only": { type: "boolean", default: false },
		publish: { type: "boolean", default: false },
		help: { type: "boolean", short: "h", default: false }
	} });
	if (values.help) {
		console.log("Usage: node scripts/docs-preview-publish.mjs (--stage-only | --publish) --expected-head <reviewed-preview-sha> [--source-ref <committed-ref>]\nPublish updates only the existing preview repository and preserves its history. A push is not deployment verification.");
		return;
	}
	if (values.publish === values["stage-only"]) throw new Error("Choose exactly one of --stage-only or --publish");
	const staged = stagePreview({ sourceRef: values["source-ref"], expectedHead: values["expected-head"] });
	console.error(`Staged ${staged.files.length} committed docs files at ${staged.stage}; ${staged.excluded.length} private/generated paths excluded`);
	console.log(JSON.stringify(values.publish ? publishPreview(staged) : staged, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try { main(); }
	catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
