import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createRawServer } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const crawler = fileURLToPath(new URL("../scripts/docs-crawl.mjs", import.meta.url));

async function fixture(t, pages) {
	const requests = new Map();
	const server = createServer((req, res) => {
		const pathname = new URL(req.url, "http://127.0.0.1").pathname;
		requests.set(pathname, (requests.get(pathname) ?? 0) + 1);
		const searchPrefix = pathname.endsWith("/assets/js/search-data.json") ? pathname.slice(0, -"assets/js/search-data.json".length) : null;
		const defaultSearch = searchPrefix === null ? null : { type: "application/json", html: JSON.stringify({ home: { title: "Home", content: "Public docs", url: searchPrefix } }) };
		const page = pages[pathname] ?? defaultSearch ?? { status: 404, html: "Not found" };
		res.writeHead(page.status ?? 200, { "content-type": page.type ?? "text/html; charset=utf-8" });
		res.end(page.html);
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	t.after(async () => {
		await new Promise((resolve, reject) => {
			server.close((err) => err ? reject(err) : resolve());
			server.closeAllConnections();
		});
	});
	return { root: `http://127.0.0.1:${server.address().port}/`, requests };
}

async function crawl(root, ...args) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [crawler, root, ...args], { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		const deadline = setTimeout(() => {
			child.kill();
			reject(new Error("local docs crawl did not exit within 10 seconds"));
		}, 10_000);
		child.stdout.on("data", (chunk) => { stdout += chunk; });
		child.stderr.on("data", (chunk) => { stderr += chunk; });
		child.once("error", (err) => { clearTimeout(deadline); reject(err); });
		child.once("close", (code) => { clearTimeout(deadline); resolve({ code, stdout, stderr }); });
	});
}

describe("docs crawler inspects every reachable page and proves private 404s", () => {
	it("inspects a page first fetched for an anchor and finds its broken child", async (t) => {
		const { root, requests } = await fixture(t, {
			"/": { html: '<a href="target.html#exists">Target</a>' },
			"/target.html": { html: '<h1 id="exists">Target</h1><a href="missing.html">Broken child</a>' }
		});
		const result = await crawl(root);
		assert.equal(result.code, 1, `a prefetched page must still be inspected: ${result.stdout}`);
		assert.match(result.stderr, /missing\.html: HTTP 404/);
		assert.equal(requests.get("/target.html"), 1, "inspection reuses the fetched page");
		assert.equal(requests.get("/missing.html"), 1);
	});

	it("also checks expected text and leaks on an anchor-prefetched page", async (t) => {
		const { root } = await fixture(t, {
			"/": { html: 'Release marker <a href="target.html#exists">Target</a>' },
			"/target.html": { html: '<h1 id="exists">Target</h1>RELEASE_RUNBOOK' }
		});
		const result = await crawl(root, "--expect", "Release marker");
		assert.equal(result.code, 1);
		assert.match(result.stderr, /target\.html: missing expected text/);
		assert.match(result.stderr, /target\.html: leaks/);
	});

	for (const status of [200, 500]) {
		it(`rejects a private path returning HTTP ${status}`, async (t) => {
			const { root } = await fixture(t, {
				"/": { html: "Public page" },
				"/README.html": { status, html: "Private response" }
			});
			const result = await crawl(root);
			assert.equal(result.code, 1, `HTTP ${status} does not establish a private 404`);
			assert.match(result.stderr, new RegExp(`private path.*README\\.html.*HTTP ${status}.*expected 404`));
		});
	}

	it("passes healthy anchored pages, handles cycles and fetches each URL once", async (t) => {
		const { root, requests } = await fixture(t, {
			"/": { html: 'Release marker <a href="target.html#exists">Target</a><a href="target.html">Again</a>' },
			"/target.html": { html: '<h1 id="exists">Release marker</h1><a href="/">Back</a><a href="#exists">Self</a>' }
		});
		const result = await crawl(root, "--expect", "Release marker");
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stdout, /DOCS CRAWL: no broken links/);
		assert.equal(requests.get("/"), 1);
		assert.equal(requests.get("/target.html"), 1);
	});
});

function manifest(t, routes) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "docs-route-contract-test-"));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	const file = path.join(directory, "routes.json");
	fs.writeFileSync(file, JSON.stringify({ schema: 1, routes }));
	return file;
}

const sourceSha = "a".repeat(40);
const buildId = `docs-${sourceSha.slice(0, 12)}`;
const buildJson = JSON.stringify({ kind: "documentation-preview", build_id: buildId, source_commit: sourceSha });
const productionBuildJson = JSON.stringify({ kind: "documentation-production", build_id: buildId, source_commit: sourceSha });
const previewHtml = content => `<meta name="robots" content="noindex, nofollow"><meta name="docs-build-id" content="${buildId}"><meta name="docs-source-sha" content="${sourceSha}"><aside>Documentation preview</aside>${content}`;

const legacySourceSha = "b".repeat(40);
const legacyBuildId = `legacy-${legacySourceSha.slice(0, 12)}`;
const currentHtml = (content, { source = sourceSha, build = buildId } = {}) => `<meta name="docs-build-id" content="${build}"><meta name="docs-source-sha" content="${source}">${content}`;
const legacyHtml = (content, { source = legacySourceSha, build = legacyBuildId, noindex = true } = {}) => `${noindex ? '<meta name="robots" content="noindex, follow">' : ""}<meta name="docs-legacy-build-id" content="${build}"><meta name="docs-legacy-source-sha" content="${source}"><aside>Legacy documentation</aside>${content}`;
const legacyJson = JSON.stringify({
	schema: 1,
	kind: "documentation-legacy",
	source_repository: "slawrensen/hwinfo-streamdeck",
	source_commit: legacySourceSha,
	build_id: legacyBuildId,
	routes: [{ path: "index.html", anchors: [] }, { path: "guide.html", anchors: ["kept"] }]
});

function editionPages(preview = false) {
	const html = preview ? previewHtml : currentHtml;
	const legacyHome = { html: legacyHtml('<a href="guide.html#kept">Legacy guide</a><a href="../">Current docs</a>') };
	return {
		"/docs/": { html: html('<a href="guide.html#kept">Current guide</a><a href="legacy/guide.html#kept">Legacy guide</a>') },
		"/docs/guide.html": { html: html('<h1 id="kept">Current guide</h1>') },
		"/docs/docs-build.json": { type: "application/json", html: preview ? buildJson : productionBuildJson },
		"/docs/legacy/": legacyHome,
		"/docs/legacy/index.html": legacyHome,
		"/docs/legacy/guide.html": { html: legacyHtml('<h1 id="kept">Legacy guide</h1><a href="../guide.html#kept">Current docs</a>') },
		"/docs/legacy/legacy-build.json": { type: "application/json", html: legacyJson },
		"/docs/legacy/assets/js/search-data.json": { type: "application/json", html: JSON.stringify({ guide: { title: "Legacy guide", url: "guide.html#kept" } }) }
	};
}

describe("docs crawler catches redesigned-site and deployment regressions", () => {
	it("checks an unlinked legacy route and a removed fragment from the route contract", async t => {
		const { root, requests } = await fixture(t, {
			"/preview/": { html: "New navigation" },
			"/preview/old-guide.html": { html: '<h1 id="new-heading">Old guide</h1>' }
		});
		const contract = manifest(t, [
			{ path: "/", anchors: [] },
			{ path: "old-guide.html", anchors: ["original-heading"] },
			{ path: "lost-page.html", anchors: [] }
		]);
		const result = await crawl(`${root}preview/`, "--manifest", contract);
		assert.equal(result.code, 1, result.stdout);
		assert.match(result.stderr, /old-guide\.html: required legacy anchor #original-heading/);
		assert.match(result.stderr, /lost-page\.html: HTTP 404/);
		assert.equal(requests.get("/preview/old-guide.html"), 1);
	});

	it("verifies a consistent preview build and canonical-host search links under a local subpath", async t => {
		const { root, requests } = await fixture(t, {
			"/preview/": { html: previewHtml('<link rel="canonical" href="https://docs.example.test/preview/"><a href="guide.html#ready">Guide</a>') },
			"/preview/guide.html": { html: previewHtml('<h1 id="ready">Guide</h1>') },
			"/preview/docs-build.json": { type: "application/json", html: buildJson },
			"/preview/assets/js/search-data.json": { type: "application/json", html: JSON.stringify({ guide: { title: "Guide", content: "Searchable content", url: "https://docs.example.test/preview/guide.html#ready" } }) }
		});
		const contract = manifest(t, [{ path: "/guide.html", anchors: ["ready"] }]);
		const result = await crawl(`${root}preview/`, "--preview", "--build-id", buildId, "--manifest", contract);
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stdout, /preview build docs-aaaaaaaaaaaa checked/);
		assert.equal(requests.get("/preview/guide.html"), 1);
		assert.equal(requests.get("/preview/docs-build.json"), 1);
	});

	it("rejects a cached page from a different build and missing preview noindex", async t => {
		const { root } = await fixture(t, {
			"/preview/": { html: `<meta name="docs-build-id" content="docs-bbbbbbbbbbbb"><meta name="docs-source-sha" content="${"b".repeat(40)}"><aside>Documentation preview</aside>` },
			"/preview/docs-build.json": { type: "application/json", html: buildJson }
		});
		const result = await crawl(`${root}preview/`, "--preview");
		assert.equal(result.code, 1);
		assert.match(result.stderr, /preview robots meta is missing noindex/);
		assert.match(result.stderr, /preview build meta does not match/);
		assert.match(result.stderr, /preview source meta does not match/);
	});

	it("rejects a mismatched externally expected deployment build", async t => {
		const { root } = await fixture(t, {
			"/preview/": { html: previewHtml("Complete preview") },
			"/preview/docs-build.json": { type: "application/json", html: buildJson }
		});
		const result = await crawl(`${root}preview/`, "--preview", "--build-id", "docs-bbbbbbbbbbbb");
		assert.equal(result.code, 1);
		assert.match(result.stderr, /expected build docs-bbbbbbbbbbbb, got docs-aaaaaaaaaaaa/);
	});

	it("checks every picture and img srcset candidate rather than only the fallback image", async t => {
		const { root, requests } = await fixture(t, {
			"/preview/": { html: '<picture><source srcset="assets/small.webp 400w, assets/missing.webp 800w"><img src="assets/fallback.png" srcset="assets/fallback.png 1x, assets/retina.png 2x" alt="Deck"></picture>' },
			"/preview/assets/small.webp": { type: "image/webp", html: "small" },
			"/preview/assets/fallback.png": { type: "image/png", html: "fallback" },
			"/preview/assets/retina.png": { type: "image/png", html: "retina" }
		});
		const result = await crawl(`${root}preview/`);
		assert.equal(result.code, 1);
		assert.match(result.stderr, /asset \/preview\/assets\/missing\.webp HTTP 404/);
		assert.equal(requests.get("/preview/assets/fallback.png"), 1);
		assert.equal(requests.get("/preview/assets/retina.png"), 1);
	});

	it("rejects a root-relative image that escapes the project base even if that image exists", async t => {
		const { root } = await fixture(t, {
			"/preview/": { html: '<img src="/assets/deck.png" alt="Deck">' },
			"/assets/deck.png": { type: "image/png", html: "wrong base" }
		});
		const result = await crawl(`${root}preview/`);
		assert.equal(result.code, 1);
		assert.match(result.stderr, /asset escapes site base \/assets\/deck\.png/);
	});

	it("finds private material in the JSON search index even when every HTML page is clean", async t => {
		const { root } = await fixture(t, {
			"/": { html: "Clean public page" },
			"/assets/js/search-data.json": { type: "application/json", html: JSON.stringify({ leak: { title: "Release notes", content: "COPY_RULES private text", url: "/release/private.html" } }) }
		});
		const result = await crawl(root);
		assert.equal(result.code, 1);
		assert.match(result.stderr, /search-data\.json: leaks \/COPY_RULES\//);
		assert.match(result.stderr, /indexes private path \/release\/private\.html/);
	});

	it("rejects broken search-result fragments and results pointing at the other base path", async t => {
		const { root } = await fixture(t, {
			"/preview/": { html: "Clean preview" },
			"/preview/guide.html": { html: '<h1 id="current">Guide</h1>' },
			"/preview/assets/js/search-data.json": { type: "application/json", html: JSON.stringify({ missing: { title: "Guide", url: "/preview/guide.html#removed" }, wrongSite: { title: "Wrong site", url: "/production/guide.html" } }) }
		});
		const result = await crawl(`${root}preview/`);
		assert.equal(result.code, 1);
		assert.match(result.stderr, /search anchor \/preview\/guide\.html#removed not on that page/);
		assert.match(result.stderr, /search result escapes site base \/production\/guide\.html/);
	});

	it("requires a real, nonempty JSON search index", async t => {
		const { root } = await fixture(t, {
			"/": { html: "Clean public page" },
			"/assets/js/search-data.json": { html: "An HTML error disguised as success" }
		});
		const result = await crawl(root);
		assert.equal(result.code, 1);
		assert.match(result.stderr, /invalid JSON search index/);
	});
});

describe("docs crawler distinguishes current production from its frozen legacy edition", () => {
	it("rejects a stale normal-production build even when its routes still work", async t => {
		const { root } = await fixture(t, {
			"/docs/": { html: currentHtml("Cached production", { build: "docs-cccccccccccc" }) },
			"/docs/docs-build.json": { type: "application/json", html: productionBuildJson }
		});
		const result = await crawl(`${root}docs/`, "--build-id", buildId);
		assert.equal(result.code, 1, result.stdout);
		assert.match(result.stderr, /(?:build.*(?:match|expected)|(?:expected|match).*build)/i);
	});

	it("rejects the wrong production source even when the short build marker matches", async t => {
		const { root } = await fixture(t, {
			"/docs/": { html: currentHtml("Wrong source", { source: `${sourceSha.slice(0, 12)}${"c".repeat(28)}` }) },
			"/docs/docs-build.json": { type: "application/json", html: productionBuildJson }
		});
		const result = await crawl(`${root}docs/`, "--build-id", buildId, "--source-sha", sourceSha);
		assert.equal(result.code, 1, result.stdout);
		assert.match(result.stderr, /source/i);
	});

	it("rejects production pages accidentally left noindex after preview promotion", async t => {
		const { root } = await fixture(t, {
			"/docs/": { html: currentHtml('<meta name="robots" content="noindex, nofollow">Production') },
			"/docs/docs-build.json": { type: "application/json", html: productionBuildJson }
		});
		const result = await crawl(`${root}docs/`, "--build-id", buildId, "--source-sha", sourceSha);
		assert.equal(result.code, 1, result.stdout);
		assert.match(result.stderr, /noindex/i);
	});

	for (const preview of [false, true]) {
		it(`checks a healthy archive under ${preview ? "preview" : "production"} using its own identity and search`, async t => {
			const { root, requests } = await fixture(t, editionPages(preview));
			const result = await crawl(`${root}docs/`, ...(preview ? ["--preview"] : []), "--build-id", buildId, "--source-sha", sourceSha);
			assert.equal(result.code, 0, result.stderr);
			assert.equal(requests.get("/docs/legacy/legacy-build.json"), 1, "the archive needs its independent source manifest");
			assert.equal(requests.get("/docs/legacy/assets/js/search-data.json"), 1, "the archive's own search is validated during the complete-site crawl");
			assert.equal(requests.get("/docs/legacy/guide.html"), 1, "an anchor-prefetched archive page is checked without duplicate requests");
		});
	}

	it("rejects a stale archive page instead of accepting the current edition's good source", async t => {
		const pages = editionPages();
		pages["/docs/legacy/guide.html"].html = legacyHtml('<h1 id="kept">Wrong archived source</h1>', { source: "c".repeat(40) });
		const { root } = await fixture(t, pages);
		const result = await crawl(`${root}docs/`, "--build-id", buildId, "--source-sha", sourceSha);
		assert.equal(result.code, 1, result.stdout);
		assert.match(result.stderr, /legacy\/guide\.html[^\n]*source/i);
	});

	it("rejects an archive manifest that drops its route inventory despite valid source metadata", async t => {
		const pages = editionPages();
		const incomplete = JSON.parse(legacyJson);
		delete incomplete.routes;
		pages["/docs/legacy/legacy-build.json"].html = JSON.stringify(incomplete);
		const { root } = await fixture(t, pages);
		const result = await crawl(`${root}docs/`, "--build-id", buildId, "--source-sha", sourceSha);
		assert.equal(result.code, 1, result.stdout);
		assert.match(result.stderr, /\/docs\/legacy\/[^\n]*invalid legacy route manifest/i);
	});

	it("checks archive routes present only in the frozen inventory even if navigation and search omit them", async t => {
		const pages = editionPages();
		const inventory = JSON.parse(legacyJson);
		inventory.routes.push({ path: "forgotten.html", anchors: ["original-heading"] });
		pages["/docs/legacy/legacy-build.json"].html = JSON.stringify(inventory);
		const { root, requests } = await fixture(t, pages);
		const result = await crawl(`${root}docs/`, "--build-id", buildId, "--source-sha", sourceSha);
		assert.equal(result.code, 1, result.stdout);
		assert.match(result.stderr, /legacy\/forgotten\.html: HTTP 404/);
		assert.equal(requests.get("/docs/legacy/forgotten.html"), 1);
	});

	it("requires archive noindex and authenticates the baseline during a direct legacy crawl", async t => {
		const pages = editionPages();
		pages["/docs/legacy/guide.html"].html = legacyHtml('<h1 id="kept">Archive without policy</h1>', { noindex: false });
		const { root } = await fixture(t, pages);
		const result = await crawl(`${root}docs/legacy/`, "--legacy", "--build-id", legacyBuildId, "--source-sha", "c".repeat(40));
		assert.equal(result.code, 1, result.stdout);
		assert.match(result.stderr, /legacy\/guide\.html[^\n]*noindex/i);
		assert.match(result.stderr, /(?:expected.*source|source.*(?:expected|match))/i);
	});

	it("rejects legacy results in the current search even when their destination is valid", async t => {
		const pages = editionPages();
		pages["/docs/assets/js/search-data.json"] = { type: "application/json", html: JSON.stringify({ duplicate: { title: "Old guide", url: "/docs/legacy/guide.html#kept" } }) };
		const { root } = await fixture(t, pages);
		const result = await crawl(`${root}docs/`, "--build-id", buildId, "--source-sha", sourceSha);
		assert.equal(result.code, 1, result.stdout);
		assert.match(result.stderr, /search-data\.json[^\n]*legacy/i);
	});

	it("finds a broken archive child after first fetching its parent through a fragment", async t => {
		const pages = editionPages();
		pages["/docs/legacy/guide.html"].html = legacyHtml('<h1 id="kept">Archive</h1><a href="missing-child.html">Broken archive child</a>');
		const { root, requests } = await fixture(t, pages);
		const result = await crawl(`${root}docs/`, "--build-id", buildId, "--source-sha", sourceSha);
		assert.equal(result.code, 1, result.stdout);
		assert.match(result.stderr, /legacy\/missing-child\.html: HTTP 404/);
		assert.equal(requests.get("/docs/legacy/missing-child.html"), 1);
	});

	it("rejects archive search results escaping into current docs and leaks inside the archive index", async t => {
		const pages = editionPages();
		pages["/docs/legacy/assets/js/search-data.json"] = { type: "application/json", html: JSON.stringify({ wrongEdition: { title: "Wrong edition", content: "COPY_RULES private text", url: "../guide.html#kept" } }) };
		const { root } = await fixture(t, pages);
		const result = await crawl(`${root}docs/`, "--build-id", buildId, "--source-sha", sourceSha);
		assert.equal(result.code, 1, result.stdout);
		assert.match(result.stderr, /legacy\/assets\/js\/search-data\.json[^\n]*leaks/i);
		assert.match(result.stderr, /search result.*(?:escapes|edition)/i);
	});

	it("proves private archive paths are 404 rather than only checking current private paths", async t => {
		const pages = editionPages();
		pages["/docs/legacy/README.html"] = { html: "Accidentally published archive input" };
		const { root, requests } = await fixture(t, pages);
		const result = await crawl(`${root}docs/`, "--build-id", buildId, "--source-sha", sourceSha);
		assert.equal(result.code, 1, result.stdout);
		assert.match(result.stderr, /legacy\/README\.html[^\n]*HTTP 200[^\n]*expected 404/i);
		assert.equal(requests.get("/docs/legacy/README.html"), 1);
	});
});

// A closing HTTP/1.0 peer exercises the response-stream failure seen with the
// actual Python-hosted Jekyll build, rather than just tiny HTTP/1.1 fixtures.
async function closingPeer(t, truncated = false) {
	const sockets = new Set();
	const asset = Buffer.alloc(2 * 1024 * 1024, 1);
	const server = createRawServer(socket => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		socket.on("error", () => { /* Client failures are asserted through crawler output. */ });
		let request = "";
		const receive = data => {
			request += data.toString();
			if (!request.includes("\r\n\r\n")) return;
			socket.removeListener("data", receive);
			const route = request.split(" ")[1];
			let status = 200;
			let type = "text/html";
			let body;
			let declaredLength;
			if (route === "/") body = Buffer.from('<h1>Docs</h1><img src="large.png" alt="Deck">');
			else if (route === "/assets/js/search-data.json") {
				type = "application/json";
				body = Buffer.from(JSON.stringify({ home: { title: "Home", url: "/" } }));
			} else if (route === "/large.png") {
				type = "image/png";
				body = truncated ? asset.subarray(0, 1024) : asset;
				declaredLength = asset.length;
			} else { status = 404; body = Buffer.from("Not found"); }
			const headers = Buffer.from(`HTTP/1.0 ${status} ${status === 200 ? "OK" : "Not Found"}\r\nContent-Type: ${type}\r\nContent-Length: ${declaredLength ?? body.length}\r\nConnection: close\r\n\r\n`);
			socket.end(Buffer.concat([headers, body]));
		};
		socket.on("data", receive);
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	t.after(async () => {
		for (const socket of sockets) socket.destroy();
		await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
	});
	return `http://127.0.0.1:${server.address().port}/`;
}

describe("docs crawler consumes closing response streams", () => {
	it("finishes large image bodies from an HTTP/1.0 server without an undici parser crash", async t => {
		const root = await closingPeer(t);
		const result = await crawl(root);
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stdout, /DOCS CRAWL: no broken links/);
	});

	it("reports a truncated asset transfer as a failed check instead of claiming success", async t => {
		const root = await closingPeer(t, true);
		const result = await crawl(root);
		assert.equal(result.code, 1, result.stdout);
		assert.match(result.stderr, /asset \/large\.png HTTP -1/);
		assert.doesNotMatch(result.stderr, /AssertionError|Parser\.finish/);
	});
});
