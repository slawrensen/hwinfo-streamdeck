// Publishes THIS worktree's docs/ tree to the public preview site:
//   https://docs.slawrensen.com/hwinfo-streamdeck-preview/
//
// The pattern: project Pages sites of the same owner all serve under the
// user domain as their own subpath, so a dedicated preview repo gets a
// real URL on the official domain while the official site (built from
// main) stays untouched. The preview repo is disposable and force-pushed:
// every publish replaces it wholesale, so it never accumulates history
// worth protecting.
//
// Safety: files are enumerated with `git ls-files --cached --others
// --exclude-standard`, so gitignored trees (docs/release, the internal
// runbooks) can never leak into the public preview, while new not-yet-
// committed pages and images are included. The copy is patched for its
// subpath (baseurl), marked noindex, and wears a preview banner on every
// page; the sidebar title stays byte-identical to production.
//
//   node scripts/docs-preview-publish.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PREVIEW_REPO = "slawrensen/hwinfo-streamdeck-preview";
const PREVIEW_BASEURL = "/hwinfo-streamdeck-preview";
const PREVIEW_URL = `https://docs.slawrensen.com${PREVIEW_BASEURL}/`;
const PREVIEW_LABEL = "1.6.0 preview";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", cwd: repoRoot, ...opts });

const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
const files = run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "docs"]).split("\0").filter(Boolean);
if (files.length === 0) {
	throw new Error("no docs files found");
}

const stage = path.join(os.tmpdir(), "hwinfo-docs-preview-stage");
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const file of files) {
	const rel = file.slice("docs/".length);
	const target = path.join(stage, rel);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.copyFileSync(path.join(repoRoot, file), target);
}
console.error(`staged ${files.length} docs files from ${branch}`);

// --- patch the copy for its preview identity ---------------------------
const configPath = path.join(stage, "_config.yml");
let config = fs.readFileSync(configPath, "utf8");
const patch = (from, to) => {
	if (!config.includes(from)) {
		throw new Error(`_config.yml drifted; expected: ${from}`);
	}
	config = config.replace(from, to);
};
patch("baseurl: /hwinfo-streamdeck\n", `baseurl: ${PREVIEW_BASEURL}\n`);
patch("gh_edit_link: true\n", "gh_edit_link: false\n");
patch("exclude:\n  - release/\n", "exclude:\n  - release/\n  - README.md\n");
fs.writeFileSync(configPath, config);

// site.title stays untouched: the theme clamps the sidebar header to 60px
// at desktop widths (height + max-height in layout.scss), the production
// title already wraps to two lines there, and a " (preview)" suffix wraps
// it to a third line that gets clipped. Preview identity lives in the
// banner below, the tab title, and the noindex tag instead.

// Preview pages must never be indexed as the real documentation, and the
// tab title carries the preview mark the sidebar title cannot.
const headPath = path.join(stage, "_includes", "head_custom.html");
fs.appendFileSync(headPath, `\n<meta name="robots" content="noindex">\n<script>document.title += " (${PREVIEW_LABEL})";</script>\n`);

// Every page wears a slim banner above the top bar. The theme's documented
// header_custom.html hook cannot host it: that hook renders inside
// #main-header, which is display:none below the md breakpoint and height-
// clamped at 60px above it. So this shadows components/header.html with a
// verbatim copy of the include from the pinned just-the-docs@v0.10.1 and
// the banner in front; the version pin makes the copy drift-proof.
const componentsDir = path.join(stage, "_includes", "components");
fs.mkdirSync(componentsDir, { recursive: true });
fs.writeFileSync(
	path.join(componentsDir, "header.html"),
	`<style>
  .preview-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    padding: 8px 24px;
    font-size: 13px;
    line-height: 1.5;
    background: rgba(115, 130, 240, 0.13);
    border-bottom: 1px solid rgba(115, 130, 240, 0.38);
  }
  .preview-banner-tag {
    flex: none;
    padding: 1px 9px;
    border: 1px solid rgba(115, 130, 240, 0.55);
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  @media (max-width: 50rem) {
    .preview-banner { padding: 8px 16px; }
  }
</style>
<div class="preview-banner" role="note">
  <span class="preview-banner-tag">${PREVIEW_LABEL}</span>
  <span>Unreleased documentation, published early for review. The released docs live at <a href="https://docs.slawrensen.com/hwinfo-streamdeck/">docs.slawrensen.com/hwinfo-streamdeck</a>.</span>
</div>
<div id="main-header" class="main-header">
  {% if site.search_enabled != false %}
    {% include components/search_header.html %}
  {% else %}
    <div></div>
  {% endif %}
  {% include header_custom.html %}
  {% if site.aux_links %}
    {% include components/aux_nav.html %}
  {% endif %}
</div>
`
);

fs.writeFileSync(
	path.join(stage, "README.md"),
	`# hwinfo-streamdeck docs preview\n\nPre-release documentation preview for [hwinfo-streamdeck](https://github.com/slawrensen/hwinfo-streamdeck), force-pushed from a feature branch by \`scripts/docs-preview-publish.mjs\`. The official documentation lives at https://docs.slawrensen.com/hwinfo-streamdeck/ and always matches the released plugin; this preview matches unreleased work and can be replaced or deleted at any time.\n`
);

// --- create the repo on first use, then force-push the stage -----------
try {
	run("gh", ["repo", "view", PREVIEW_REPO, "--json", "name"]);
} catch {
	console.error(`creating ${PREVIEW_REPO}`);
	run("gh", ["repo", "create", PREVIEW_REPO, "--public", "--description", "Pre-release documentation previews for hwinfo-streamdeck (disposable; official docs live at docs.slawrensen.com/hwinfo-streamdeck)"]);
}
const git = (...args) => run("git", args, { cwd: stage });
git("init", "-b", "main");
git("add", "-A");
git("-c", "user.name=Stephen Lawrensen", "-c", "user.email=19673454+slawrensen@users.noreply.github.com", "commit", "-m", `docs preview from ${branch}`);
git("remote", "add", "origin", `https://github.com/${PREVIEW_REPO}.git`);
git("push", "--force", "origin", "main");
console.error("pushed");

// Enable Pages (main, root) on first use; 409 means it already is.
try {
	run("gh", ["api", "-X", "POST", `repos/${PREVIEW_REPO}/pages`, "-f", "source[branch]=main", "-f", "source[path]=/"]);
	console.error("Pages enabled");
} catch (err) {
	if (!String(err.stderr ?? err).includes("409")) {
		throw err;
	}
	console.error("Pages already enabled");
}
console.error(`preview will build at ${PREVIEW_URL}`);
