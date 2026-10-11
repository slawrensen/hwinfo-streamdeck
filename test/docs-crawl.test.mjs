import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const crawler = fileURLToPath(new URL("../scripts/docs-crawl.mjs", import.meta.url));

async function fixture(t, pages) {
	const requests = new Map();
	const server = createServer((req, res) => {
		const pathname = new URL(req.url, "http://127.0.0.1").pathname;
		requests.set(pathname, (requests.get(pathname) ?? 0) + 1);
		const page = pages[pathname] ?? { status: 404, html: "Not found" };
		res.writeHead(page.status ?? 200, { "content-type": "text/html; charset=utf-8" });
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
