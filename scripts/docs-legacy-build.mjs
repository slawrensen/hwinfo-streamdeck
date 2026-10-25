// Preserve the previous documentation as a portable static archive.
//
// node scripts/docs-legacy-build.mjs --gem-home /path/to/gems
// The baseline is an immutable commit, not main. This does not publish, change
// Pages settings, or rewrite any plugin/release source. Ruby/Jekyll dependencies
// come from the checked-in Gemfile. Output has no front matter and is therefore
// copied as static files, outside the current documentation's search index.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const LEGACY_SOURCE = "bb4aedecbce499e199df8af63793a1490c0fb6ed";
export const LEGACY_BASE = "/hwinfo-streamdeck/legacy";
const ORIGIN = "https://docs.slawrensen.com";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = value => createHash("sha256").update(value).digest("hex");
const run = (command, args, options = {}) => execFileSync(command, args, {
	encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...options
});

function replaceOnce(source, before, after) {
	if (source.split(before).length !== 2) throw new Error(`The frozen image viewer changed at ${before}; inspect the source before adapting the archive`);
	return source.replace(before, after);
}

/** Preserve the historical viewer's UI while fixing the known focus escape.
 * Native showModal makes the background inert; explicit boundaries keep both
 * Tab directions inside the viewer instead of moving into browser chrome. */
export function repairLegacyViewer(source) {
	let result = replaceOnce(source, 'overlay = document.createElement("div");', 'overlay = document.createElement("dialog");');
	result = replaceOnce(result, '<div class="zoom-stage is-fit"><img alt=""></div>', '<div class="zoom-stage is-fit" tabindex="0" role="region" aria-label="Image, scroll to inspect"><img alt=""></div>');
	result = replaceOnce(result, 'overlay.setAttribute("open", "");', "overlay.showModal();");
	result = replaceOnce(result, 'overlay.removeAttribute("open");', "overlay.close();");
	result = replaceOnce(result, "    dragToPan();", `    overlay.addEventListener("cancel", function (event) { event.preventDefault(); close(); });
    overlay.addEventListener("keydown", function (event) {
      if (event.key !== "Tab") return;
      var controls = [toggle, overlay.querySelector('[data-act="close"]'), stage];
      var first = controls[0], last = controls[controls.length - 1];
      var active = document.activeElement;
      if (controls.indexOf(active) === -1 || (event.shiftKey && active === first) || (!event.shiftKey && active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    });
    dragToPan();`);
	return result;
}

const archiveStyles = `
html { scroll-padding-top: 60px; }
body.legacy-documentation { padding-top: 44px; }
.legacy-banner { position: fixed; inset: 0 0 auto; z-index: 100; height: 44px; display: flex; align-items: center; justify-content: center; gap: 24px; padding: 0 20px; background: #192631; border-bottom: 1px solid #344657; color: #d4e5f3; font: 500 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.legacy-banner > span { font-weight: 650; }
.legacy-banner a { display: inline-flex; align-items: center; min-height: 44px; color: #c0ddf3; text-decoration: underline; text-underline-offset: 3px; white-space: nowrap; }
.legacy-banner a:focus-visible { outline: 2px solid #8ac9f8; outline-offset: -4px; }
.zoom-overlay { margin: 0; width: 100vw; max-width: none; height: 100dvh; max-height: none; padding: 0; border: 0; overflow: hidden; color: inherit; }
.zoom-overlay::backdrop { background: rgba(6, 7, 9, .94); }
.zoom-bar { z-index: 1; }
.zoom-stage { padding-top: 80px; }
.zoom-stage:focus-visible { outline: 2px solid #8ac9f8; outline-offset: -4px; }
.zoom-btn { min-height: 44px; }
@media (min-width: 50rem) {
  .legacy-documentation .side-bar { top: 44px; height: calc(100vh - 44px); }
  .legacy-documentation .site-header { height: auto; max-height: none; flex-shrink: 0; }
  .legacy-documentation .site-title { height: auto; }
}
@media (max-width: 49.999rem) { .legacy-banner { justify-content: space-between; gap: 12px; font-size: 12px; } }
`;

/** Only navigation/resource attributes become relative. Canonical and social
 * metadata retain the real production archive identity on every placement. */
export function portableLegacyHtml(source) {
	return source.replace(/<[^>]+>/g, tag => tag.replace(/\b(href|src|srcset|poster)=(['"])(.*?)\2/gs, (attribute, name, quote, value) => {
		if (/^<link\b/i.test(tag) && /\brel=['"]canonical['"]/.test(tag)) return attribute;
		const relative = value.replaceAll(ORIGIN + LEGACY_BASE + "/", "./").replaceAll(LEGACY_BASE + "/", "./");
		return `${name}=${quote}${relative}${quote}`;
	}));
}

function walk(root) {
	return fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
		.flatMap(entry => entry.isDirectory() ? walk(path.join(root, entry.name)) : [path.join(root, entry.name)]);
}

export function buildLegacy({ sourceRoot = ROOT, output = path.join(sourceRoot, "docs/legacy"), gemHome, bundle = process.platform === "win32" ? "bundle" : "bundle3.2" } = {}) {
	const target = path.resolve(output);
	const expectedTarget = path.resolve(sourceRoot, "docs/legacy");
	if (target !== expectedTarget) throw new Error("The legacy generator writes only the repository's docs/legacy directory");
	if (fs.existsSync(target)) {
		const marker = path.join(target, "legacy-build.json");
		if (!fs.existsSync(marker) || JSON.parse(fs.readFileSync(marker, "utf8")).kind !== "documentation-legacy") {
			throw new Error("Existing docs/legacy is not this generator's output; preserve it and inspect before replacing");
		}
	}
	const git = (...args) => run("git", args, { cwd: sourceRoot });
	if (git("rev-parse", "--verify", `${LEGACY_SOURCE}^{commit}`).trim() !== LEGACY_SOURCE) throw new Error("Legacy source commit is unavailable");
	const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "hwinfo-docs-legacy-"));
	try {
		const source = path.join(temporary, "source");
		const destination = path.join(temporary, "site");
		fs.mkdirSync(source);
		const entries = git("ls-tree", "-r", "-z", LEGACY_SOURCE, "--", "docs/").split("\0").filter(Boolean);
		const markdown = [];
		for (const entry of entries) {
			const match = /^(100644|100755) blob ([a-f0-9]{40})\t(docs\/.+)$/.exec(entry);
			if (!match) throw new Error(`Unsupported frozen documentation entry: ${entry}`);
			const [, , object, fullPath] = match;
			const relative = fullPath.slice(5);
			if (/^(?:release|legacy|_site|\.jekyll-cache|\.sass-cache)(?:\/|$)/i.test(relative)) continue;
			if (/^(?:CNAME|\.nojekyll)$/i.test(relative)) throw new Error(`Unexpected ${relative} in frozen documentation`);
			const file = path.join(source, relative);
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, run("git", ["cat-file", "blob", object], { cwd: sourceRoot, encoding: "buffer" }));
			if (!relative.includes("/") && relative.endsWith(".md")) markdown.push(relative);
		}
		if (markdown.length !== 16) throw new Error(`Expected 16 original documentation pages, received ${markdown.length}`);
		const customHead = path.join(source, "_includes/head_custom.html");
		fs.writeFileSync(customHead, repairLegacyViewer(fs.readFileSync(customHead, "utf8")));
		// Scope layout defaults to source articles. Applying layout=default to
		// every Page can wrap inherited theme CSS in an HTML document.
		const overlay = {
			url: ORIGIN, baseurl: LEGACY_BASE,
			plugins: ["jekyll-remote-theme", "jekyll-seo-tag", "jekyll-include-cache", "jekyll-relative-links"],
			defaults: markdown.map(file => ({ scope: { path: file }, values: { layout: "default" } })),
			exclude: ["release/", "legacy/", "README.md", "Gemfile", "Gemfile.lock"],
			gh_edit_link: false,
			sass: { style: "compressed" }
		};
		const config = path.join(temporary, "overlay.yml");
		fs.writeFileSync(config, JSON.stringify(overlay, null, 2) + "\n");
		const env = { ...process.env, BUNDLE_GEMFILE: path.join(sourceRoot, "Gemfile") };
		if (gemHome) { env.GEM_HOME = gemHome; env.GEM_PATH = gemHome; }
		const outputLog = run(bundle, ["exec", "jekyll", "build", "--source", source, "--destination", destination,
			"--config", `${path.join(source, "_config.yml")},${config}`], { cwd: sourceRoot, env });
		process.stderr.write(outputLog);
		const buildId = `legacy-${LEGACY_SOURCE.slice(0, 12)}`;
		const routes = [];
		for (const file of walk(destination)) {
			const relative = path.relative(destination, file).split(path.sep).join("/");
			if (/^(?:release|legacy)(?:\/|$)/i.test(relative) || /(?:^|\/)CNAME$/i.test(relative)) throw new Error(`Excluded output: ${relative}`);
			if (relative.endsWith(".html")) {
				if (relative.includes("/")) throw new Error(`Unexpected nested archive page: ${relative}`);
				let html = fs.readFileSync(file, "utf8");
				if (!html.includes('id="search-input"') || !html.includes("<head") || !html.includes("side-bar")) throw new Error(`Incomplete archive page: ${relative}`);
				html = portableLegacyHtml(html);
				const current = relative === "index.html" ? "../" : `../${relative}`;
				const metadata = `<meta name="robots" content="noindex, follow, noarchive"><meta name="docs-legacy-source-sha" content="${LEGACY_SOURCE}"><meta name="docs-legacy-build-id" content="${buildId}"><style>${archiveStyles}</style><noscript><style>.legacy-documentation .site-nav{display:block}</style></noscript>`;
				html = html.replace("</head>", metadata + "</head>");
				html = html.replace(/<body(?:\s[^>]*)?>/, `<body class="legacy-documentation"><aside class="legacy-banner" aria-label="Legacy documentation"><span>Legacy documentation</span><a data-current-docs-link href="${current}">Current docs <span aria-hidden="true">↗</span></a></aside>`);
				fs.writeFileSync(file, html);
				routes.push({ path: relative, current, anchors: [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]) });
			} else if (relative.endsWith(".js")) {
				const script = fs.readFileSync(file, "utf8");
				if (/<!doctype|<html/i.test(script)) throw new Error(`HTML was incorrectly generated as JavaScript: ${relative}`);
				fs.writeFileSync(file, script.replaceAll(LEGACY_BASE + "/", "./").replace(/[ \t]+$/gm, "").trimEnd() + "\n");
			} else if (relative.endsWith(".css")) {
				const css = fs.readFileSync(file, "utf8");
				if (/<!doctype|<html/i.test(css)) throw new Error(`HTML was incorrectly generated as CSS: ${relative}`);
			} else if (relative === "assets/js/search-data.json") {
				const index = JSON.parse(fs.readFileSync(file, "utf8"));
				for (const result of Object.values(index)) {
					if (!result.url.startsWith(LEGACY_BASE + "/")) throw new Error(`Unexpected legacy search target: ${result.url}`);
					result.url = "./" + result.url.slice(LEGACY_BASE.length + 1);
				}
				fs.writeFileSync(file, JSON.stringify(index) + "\n");
			}
		}
		if (routes.length !== 16) throw new Error("The generated archive does not contain all 16 original pages");
		const files = walk(destination).map(file => ({ path: path.relative(destination, file).split(path.sep).join("/"),
			bytes: fs.statSync(file).size, sha256: sha256(fs.readFileSync(file)) }));
		const manifest = { schema: 1, kind: "documentation-legacy", source_repository: "slawrensen/hwinfo-streamdeck", source_commit: LEGACY_SOURCE,
			build_id: buildId, canonical_base: ORIGIN + LEGACY_BASE + "/", current_base: "../", portable_internal_urls: true,
			indexing: "noindex; static HTML without front matter stays outside the current documentation search index",
			builder: "scripts/docs-legacy-build.mjs", theme: "just-the-docs/just-the-docs@v0.10.1",
			gemfile_sha256: sha256(fs.readFileSync(path.join(sourceRoot, "Gemfile"))),
			gemfile_lock_sha256: sha256(fs.readFileSync(path.join(sourceRoot, "Gemfile.lock"))),
			transformations: ["Hosting URL and base path", "Article-scoped default layout and GitHub Pages documentation plugins", "Frozen archive source metadata and noindex", "Document-relative archive navigation, resources and search targets", "44px Legacy documentation bar and same-page Current docs links", "Intrinsic desktop header height keeps the historical wrapped title below the archive bar", "Native-dialog focus containment and inert background for the historical image viewer", "Image toolbar hit testing and 44px controls", "No-JavaScript navigation visibility"],
			routes, files };
		fs.writeFileSync(path.join(destination, "legacy-build.json"), JSON.stringify(manifest, null, 2) + "\n");
		fs.rmSync(target, { recursive: true, force: true });
		fs.cpSync(destination, target, { recursive: true });
		return { output: target, source: LEGACY_SOURCE, buildId, pages: routes.length, files: files.length + 1, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
	} finally {
		fs.rmSync(temporary, { recursive: true, force: true });
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const { values } = parseArgs({ options: { "gem-home": { type: "string" }, bundle: { type: "string" } } });
		console.log(JSON.stringify(buildLegacy({ gemHome: values["gem-home"], bundle: values.bundle }), null, 2));
	} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
