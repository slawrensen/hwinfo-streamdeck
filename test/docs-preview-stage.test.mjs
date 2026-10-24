import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { PREVIEW_REPO, previewConfig, publishPreview, stagePreview } from "../scripts/docs-preview-publish.mjs";

const REMOTE = `https://github.com/${PREVIEW_REPO}.git`;
const knownHead = "a".repeat(40);
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
const git = (cwd, ...args) => run("git", args, { cwd }).trim();

function fixture(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "hwinfo-preview-test-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const repo = path.join(root, "source");
	fs.mkdirSync(repo);
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.name", "Preview fixture");
	git(repo, "config", "user.email", "fixture@example.invalid");
	const write = (name, content) => {
		const target = path.join(repo, name);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, content);
	};
	write("package.json", JSON.stringify({ version: "1.7.1" }));
	write("docs/_config.yml", "# Deliberately different spacing and key order.\ncustom: { token: charcoal }\nexclude: [drafts/, release/]\ntitle: 'A careful docs site'\nbaseurl: '/other-source' # retained comment\ngh_edit_link: true\n");
	write("docs/index.md", "---\nlayout: default\n---\nCommitted documentation.\n");
	write("docs/_includes/head_custom.html", '{% if site.docs_preview %}<meta name="robots" content="noindex, nofollow">{% endif %}\n');
	write("docs/_includes/components/header.html", '<header class="new-shell"><a href="{{ site.baseurl }}/">Custom header</a></header>\n');
	write("docs/_layouts/default.html", '{% if site.docs_preview %}<aside>Documentation preview</aside>{% endif %}{{ content }}\n');
	write("docs/assets/example.bin", Buffer.from([0, 128, 255, 10]));
	write("docs/release/private.md", "PRIVATE QUALIFICATION INPUT");
	write("docs/_site/old.html", "STALE GENERATED CONTENT");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "Fixture source");
	return { root, repo, write, sourceSha: git(repo, "rev-parse", "HEAD") };
}

function remoteFixture(t) {
	const f = fixture(t);
	const bare = path.join(f.root, "preview.git");
	const seed = path.join(f.root, "seed");
	git(f.root, "init", "--bare", "--initial-branch=main", bare);
	git(f.root, "clone", bare, seed);
	git(seed, "config", "user.name", "Concurrent preview author");
	git(seed, "config", "user.email", "fixture@example.invalid");
	fs.writeFileSync(path.join(seed, "index.md"), "Prior preview");
	fs.writeFileSync(path.join(seed, "removed-page.md"), "Stale page");
	git(seed, "add", "-A");
	git(seed, "commit", "-m", "Previous preview");
	git(seed, "push", "origin", "main");
	const expectedHead = git(seed, "rev-parse", "HEAD");
	const transport = (hook = () => {}) => (command, args, options) => {
		if (command === "gh") {
			assert.deepEqual(args.slice(0, 3), ["repo", "view", PREVIEW_REPO], "transport must only inspect the intended existing repository");
			return JSON.stringify({ nameWithOwner: PREVIEW_REPO, isPrivate: false, defaultBranchRef: { name: "main" } });
		}
		if (command === "git" && args[0] === "push") hook(args);
		return run(command, args.map(arg => arg === REMOTE ? bare : arg), options);
	};
	return { ...f, bare, seed, expectedHead, transport };
}

test("staging uses committed docs, preserves the shared shell and excludes private files", t => {
	const f = fixture(t);
	const header = fs.readFileSync(path.join(f.repo, "docs/_includes/components/header.html"), "utf8");
	f.write("docs/index.md", "UNREVIEWED WORKING COPY");
	f.write("docs/untracked.md", "UNTRACKED PRIVATE NOTES");
	git(f.repo, "add", "docs/index.md");
	const staged = stagePreview({ sourceRoot: f.repo, expectedHead: knownHead, temporaryRoot: f.root });
	assert.equal(fs.readFileSync(path.join(staged.stage, "index.md"), "utf8"), "---\nlayout: default\n---\nCommitted documentation.\n");
	assert.equal(fs.readFileSync(path.join(staged.stage, "_includes/components/header.html"), "utf8"), header);
	assert.deepEqual(fs.readFileSync(path.join(staged.stage, "assets/example.bin")), Buffer.from([0, 128, 255, 10]));
	assert.equal(fs.existsSync(path.join(staged.stage, "release")), false);
	assert.equal(fs.existsSync(path.join(staged.stage, "_site")), false);
	assert.equal(fs.existsSync(path.join(staged.stage, "untracked.md")), false);
	assert.equal(fs.existsSync(path.join(staged.stage, "CNAME")), false);
	assert.deepEqual(staged.excluded.sort(), ["docs/_site/old.html", "docs/release/private.md"]);
	const config = parse(fs.readFileSync(path.join(staged.stage, "_config.yml"), "utf8"));
	assert.equal(config.baseurl, "/hwinfo-streamdeck-preview");
	assert.equal(config.title, "A careful docs site");
	assert.deepEqual(config.custom, { token: "charcoal" });
	assert.ok(config.exclude.includes("drafts/") && config.exclude.includes("release/") && config.exclude.includes("README.md"));
	assert.equal(config.docs_preview, true);
	assert.equal(config.docs_source_sha, f.sourceSha);
	assert.equal(config.docs_preview_previous_sha, knownHead);
	assert.equal(config.gh_edit_link, false);
	const manifest = JSON.parse(fs.readFileSync(path.join(staged.stage, "docs-build.json"), "utf8"));
	assert.equal(manifest.build_id, config.docs_build_id);
	assert.equal(manifest.source_commit, f.sourceSha);
	assert.equal(manifest.source_plugin_version, "1.7.1");
	assert.equal(manifest.preview_previous_commit, knownHead);
	assert.match(fs.readFileSync(path.join(staged.stage, "README.md"), "utf8"), /Documentation preview/);
	const second = stagePreview({ sourceRoot: f.repo, expectedHead: knownHead, temporaryRoot: f.root });
	assert.notEqual(second.stage, staged.stage);
	assert.equal(fs.readFileSync(path.join(staged.stage, "index.md"), "utf8"), fs.readFileSync(path.join(second.stage, "index.md"), "utf8"));
});

test("invalid YAML, missing leases and a committed CNAME fail without publication", t => {
	const f = fixture(t);
	assert.throws(() => stagePreview({ sourceRoot: f.repo, temporaryRoot: f.root }), /expected-head/);
	assert.throws(() => previewConfig("baseurl: /one\nbaseurl: /two\n", {}), /Invalid docs configuration/);
	assert.throws(() => previewConfig("exclude: release/\n", {}), /exclude must be a list/);
	f.write("docs/CNAME", "another.example");
	git(f.repo, "add", "docs/CNAME");
	git(f.repo, "commit", "-m", "Wrong domain fixture");
	assert.throws(() => stagePreview({ sourceRoot: f.repo, expectedHead: knownHead, temporaryRoot: f.root }), /Unexpected docs\/CNAME/);
});

test("repository read errors never create repositories or change visibility", t => {
	const f = fixture(t);
	const staged = stagePreview({ sourceRoot: f.repo, expectedHead: knownHead, temporaryRoot: f.root });
	const calls = [];
	assert.throws(() => publishPreview(staged, { run: (command, args) => {
		calls.push([command, ...args]);
		throw new Error("Authentication or network unavailable");
	} }), /Authentication or network unavailable/);
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0].slice(0, 4), ["gh", "repo", "view", PREVIEW_REPO]);
	assert.throws(() => publishPreview(staged, { run: () => JSON.stringify({ nameWithOwner: PREVIEW_REPO, isPrivate: true, defaultBranchRef: { name: "main" } }) }), /intended public repository/);
});

test("publication preserves preview history, removes stale files, and records source identity", t => {
	const f = remoteFixture(t);
	const staged = stagePreview({ sourceRoot: f.repo, expectedHead: f.expectedHead, temporaryRoot: f.root });
	const result = publishPreview(staged, { run: f.transport() });
	assert.equal(git(f.bare, "rev-parse", "main"), result.preview_commit);
	assert.equal(git(f.bare, "rev-parse", "main^"), f.expectedHead);
	assert.equal(git(f.bare, "ls-tree", "--name-only", "main", "removed-page.md"), "");
	assert.equal(JSON.parse(git(f.bare, "show", "main:docs-build.json")).source_commit, f.sourceSha);
	assert.match(result.deployment, /^UNVERIFIED/);
});

test("a stale expected head stops before any update", t => {
	const f = remoteFixture(t);
	const staged = stagePreview({ sourceRoot: f.repo, expectedHead: knownHead, temporaryRoot: f.root });
	assert.throws(() => publishPreview(staged, { run: f.transport() }), /inspect and reconcile/);
	assert.equal(git(f.bare, "rev-parse", "main"), f.expectedHead);
	assert.equal(fs.existsSync(path.join(staged.stage, ".git")), false);
});

test("a concurrent publish after the final read is protected by the actual git lease", t => {
	const f = remoteFixture(t);
	const staged = stagePreview({ sourceRoot: f.repo, expectedHead: f.expectedHead, temporaryRoot: f.root });
	let winner;
	const transport = f.transport(args => {
		assert.ok(args.includes(`--force-with-lease=refs/heads/main:${f.expectedHead}`));
		fs.writeFileSync(path.join(f.seed, "concurrent.md"), "Another author's reviewed preview");
		git(f.seed, "add", "-A");
		git(f.seed, "commit", "-m", "Concurrent change");
		git(f.seed, "push", "origin", "main");
		winner = git(f.seed, "rev-parse", "HEAD");
	});
	assert.throws(() => publishPreview(staged, { run: transport }));
	assert.ok(winner);
	assert.equal(git(f.bare, "rev-parse", "main"), winner);
	assert.equal(git(f.bare, "show", "main:concurrent.md"), "Another author's reviewed preview");
	assert.equal(git(f.bare, "rev-parse", "main^"), f.expectedHead);
});
