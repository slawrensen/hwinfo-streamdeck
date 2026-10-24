// Real generated-site regression tests, separate from plugin release gates.
// DOCS_TEST_URL=http://127.0.0.1:4000/hwinfo-streamdeck-preview/ \
// CHROME_PATH=/usr/bin/google-chrome node --test test/docs-browser.test.mjs
// Run once for each locally built base path, then against the deployed preview.
/* global document, window */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const base = process.env.DOCS_TEST_URL ? new URL(process.env.DOCS_TEST_URL.endsWith("/") ? process.env.DOCS_TEST_URL : `${process.env.DOCS_TEST_URL}/`) : null;
const enabled = Boolean(base);
const options = { skip: enabled ? false : "UNAVAILABLE: set DOCS_TEST_URL to a real Jekyll build or published preview" };
let browser;

before(async () => {
	if (!enabled) return;
	browser = await chromium.launch({
		headless: true,
		...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
		args: ["--no-sandbox", "--disable-dev-shm-usage"]
	});
});
after(async () => { await browser?.close(); });

async function pageFor(t, contextOptions = {}) {
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce", ...contextOptions });
	const page = await context.newPage();
	page.setDefaultTimeout(15000);
	const errors = [];
	page.on("pageerror", error => errors.push(error.message));
	page.on("requestfailed", request => {
		if (new URL(request.url()).origin === base.origin && !/ERR_ABORTED/.test(request.failure()?.errorText ?? "")) errors.push(`${request.url()}: ${request.failure()?.errorText}`);
	});
	page.on("response", response => {
		// HTTP errors are successful network transfers and do not emit
		// requestfailed. APIRequestContext probes are separate from page events.
		if (new URL(response.url()).origin === base.origin && response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`);
	});
	t.after(async () => {
		await context.close();
		assert.deepEqual(errors, [], "no unhandled page exceptions or failed same-origin resource responses/requests");
	});
	return page;
}

function siteUrl(relative = "") { return new URL(relative, base).href; }
function assertWithinSite(url) {
	const resolved = new URL(url, base);
	assert.equal(resolved.origin, base.origin);
	assert.ok(resolved.pathname.startsWith(base.pathname), `${resolved.href} escaped the ${base.pathname} base path`);
}
async function focusStaysInViewer(page) {
	assert.equal(await page.locator("dialog.image-viewer").evaluate(dialog => dialog.contains(document.activeElement)), true,
		"keyboard focus must remain inside the open modal, not Edit this page or another background control");
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
	test(`home identity, download and platform requirement fit ${viewport.width}×${viewport.height}`, options, async t => {
		const page = await pageFor(t, { viewport });
		await page.goto(siteUrl());
		await page.locator(".home-intro").waitFor();
		assert.equal(await page.locator("h1").count(), 1);
		for (const selector of ["h1", ".home-lead", ".home-actions .button-primary", ".home-requirements strong"]) {
			const box = await page.locator(selector).boundingBox();
			assert.ok(box && box.y >= 0 && box.y + box.height <= viewport.height, `${selector} must be readable before the first viewport ends`);
		}
		const primary = page.locator(".home-actions .button-primary");
		assert.match(await primary.getAttribute("href"), /^https:\/\/github\.com\/slawrensen\/hwinfo-streamdeck\/releases\/download\/v1\.7\.1\/com\.lawrensen\.hwinfo\.streamDeckPlugin$/);
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "the document must not overflow horizontally");
		if (base.pathname.includes("preview")) {
			assert.match(await page.locator('meta[name="robots"]').getAttribute("content"), /noindex/);
			const marker = page.locator(".preview-banner");
			assert.match(await marker.innerText(), /Documentation preview/);
			const box = await marker.boundingBox();
			assert.ok(box && box.y >= 0 && box.y + box.height <= viewport.height, "preview identity stays visible on desktop and phone");
		}
	});
}

test("image viewer contains Shift+Tab from Actual size and restores its opener", options, async t => {
	const page = await pageFor(t);
	await page.goto(siteUrl());
	const opener = page.locator(".hero-figure .image-link[data-image-viewer]");
	await opener.focus();
	await page.keyboard.press("Enter");
	const dialog = page.locator("dialog.image-viewer");
	await dialog.waitFor({ state: "visible" });
	const actual = dialog.getByRole("button", { name: /^(Actual size|Fit to screen)$/ });
	assert.equal(await actual.innerText(), "Actual size");
	await actual.focus();
	await page.keyboard.press("Shift+Tab");
	await focusStaysInViewer(page);
	for (let i = 0; i < 8; i++) {
		await page.keyboard.press("Tab");
		await focusStaysInViewer(page);
	}
	for (let i = 0; i < 8; i++) {
		await page.keyboard.press("Shift+Tab");
		await focusStaysInViewer(page);
	}
	await page.locator("#search-input").evaluate(input => input.focus());
	await focusStaysInViewer(page);
	await actual.click();
	assert.equal(await actual.getAttribute("aria-pressed"), "true", "Actual size has an observable toggled state");
	await actual.click();
	assert.equal(await actual.getAttribute("aria-pressed"), "false");
	await page.keyboard.press("Escape");
	await dialog.waitFor({ state: "hidden" });
	assert.equal(await opener.evaluate(element => element === document.activeElement), true, "Escape returns focus to the image link");
	await page.keyboard.press("Enter");
	await dialog.waitFor({ state: "visible" });
	await dialog.getByRole("button", { name: /Close/i }).click();
	await dialog.waitFor({ state: "hidden" });
	assert.equal(await opener.evaluate(element => element === document.activeElement), true, "Close returns focus to the image link");
	await page.setViewportSize({ width: 390, height: 844 });
	const menu = page.locator("#menu-button");
	await menu.click();
	assert.equal(await menu.getAttribute("aria-expanded"), "true");
	await opener.click();
	await dialog.waitFor({ state: "visible" });
	await page.keyboard.press("Escape");
	await dialog.waitFor({ state: "hidden" });
	assert.equal(await menu.getAttribute("aria-expanded"), "true", "Escape closes only the modal, preserving navigation in the inert background");
	assert.equal(await opener.evaluate(element => element === document.activeElement), true);
});

test("an open image viewer blocks background navigation", options, async t => {
	const page = await pageFor(t);
	await page.goto(siteUrl());
	const navigation = page.locator('#site-nav a[href$="installation.html"]');
	const target = await navigation.boundingBox();
	assert.ok(target);
	await page.locator(".hero-figure .image-link[data-image-viewer]").click();
	await page.locator("dialog.image-viewer").waitFor({ state: "visible" });
	const originalUrl = page.url();
	// A real pointer hit on the covered sidebar may close the viewer's backdrop,
	// but it must never activate the navigation link underneath it.
	await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
	assert.equal(page.url(), originalUrl);
});

const searches = [
	{ query: "transparent background", path: "sensor-dial.html#transparent-background", text: /Display.*Background|Background.*Display/s },
	{ query: "12 hours", path: "installation.html", text: /12 hours/ },
	{ query: "Age unknown", path: "troubleshooting.html", text: /Enable reporting to Gadget/ },
	{ query: "sensor missing", path: "troubleshooting.html", text: /saved reading|saved sensor/i }
];
for (const { query, path: destination, text } of searches) {
	test(`search '${query}' reaches a relevant setting or repair`, options, async t => {
		const page = await pageFor(t);
		await page.goto(siteUrl());
		await page.locator("#search-input").fill(query);
		const result = page.locator(`#search-results a[href*="${destination}"]`).first();
		await result.waitFor({ state: "visible" });
		const href = await result.getAttribute("href");
		assertWithinSite(href);
		await result.click();
		await page.waitForURL(url => url.pathname.includes(destination.split("#")[0]));
		assertWithinSite(page.url());
		assert.match(await page.locator("#main-content").innerText(), text);
	});
}

test("search replays early input after the index loads and refreshes pasted queries", options, async t => {
	const page = await pageFor(t);
	let releaseIndex;
	const indexReady = new Promise(resolve => { releaseIndex = resolve; });
	t.after(() => releaseIndex());
	await page.route("**/assets/js/search-data.json", async route => {
		const response = await route.fetch();
		await indexReady;
		await route.fulfill({ response });
	});
	await page.goto(siteUrl(), { waitUntil: "domcontentloaded" });
	const input = page.locator("#search-input");
	// fill emits input without keyup, matching paste and mobile input semantics.
	await input.fill("transparent background");
	releaseIndex();
	await page.locator('#search-results a[href*="sensor-dial.html#transparent-background"]').first().waitFor({ state: "visible" });
	await input.fill("sensor missing");
	await page.waitForFunction(() => document.querySelector("#search-results a")?.getAttribute("href").includes("troubleshooting.html#keys-show-sensor-missing"));
	await input.fill("");
	assert.equal(await page.locator("#search-results a").count(), 0, "clearing a pasted query removes stale results");
});

test("keyboard search shortcut and Enter reach the concrete status fix", options, async t => {
	const page = await pageFor(t);
	await page.goto(siteUrl(), { waitUntil: "networkidle" });
	await page.keyboard.press("Control+k");
	assert.equal(await page.locator("#search-input").evaluate(element => element === document.activeElement), true);
	await page.keyboard.type("Age unknown");
	await page.locator('#search-results a[href*="troubleshooting.html#age-unknown"]').first().waitFor({ state: "visible" });
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Enter");
	await page.waitForURL(/troubleshooting\.html#age-unknown$/);
	assert.match(await page.locator("#main-content").innerText(), /Enable reporting to Gadget/);
});

test("phone navigation and search remain operable", options, async t => {
	const page = await pageFor(t, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
	await page.goto(siteUrl());
	const menu = page.locator("#menu-button");
	await menu.click();
	assert.equal(await menu.getAttribute("aria-expanded"), "true");
	await page.locator('#site-nav a[href$="troubleshooting.html"]').click();
	await page.waitForURL(/troubleshooting\.html/);
	assert.equal(await page.locator('#site-nav a[aria-current="page"]').innerText(), "Troubleshooting");
	assert.equal(await page.locator(".nav-group.is-current-group .nav-group-title").innerText(), "Help");
	await menu.click();
	// Search and navigation can both be open. Escape must not strand stale
	// search results by moving focus away before search receives the keyup.
	await page.locator("#search-input").fill("Age unknown");
	await page.locator("#search-results a").first().waitFor({ state: "visible" });
	await page.keyboard.press("Escape");
	await page.locator("#search-results").waitFor({ state: "hidden" });
	assert.equal(await page.locator("#search-input").inputValue(), "");
	if (await menu.getAttribute("aria-expanded") === "true") await page.keyboard.press("Escape");
	assert.equal(await menu.getAttribute("aria-expanded"), "false");
	assert.equal(await menu.evaluate(element => element === document.activeElement), true);
	await page.locator("#search-input").fill("Age unknown");
	const result = page.locator('#search-results a[href*="troubleshooting.html"]').first();
	await result.waitFor({ state: "visible" });
	await result.click();
	assert.match(await page.locator("#main-content").innerText(), /Age unknown/);
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
});

test("phone navigation is collapsed before the deferred enhancements load", options, async t => {
	const page = await pageFor(t, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
	let releaseScript;
	let scriptRequested = false;
	const scriptReady = new Promise(resolve => { releaseScript = resolve; });
	await page.route("**/assets/js/docs.js", async route => {
		scriptRequested = true;
		const response = await route.fetch();
		await scriptReady;
		await route.fulfill({ response });
	});
	try {
		// A deferred script delays DOMContentLoaded. Inspect the first visible
		// content while its response is held, before that event can fire.
		await page.goto(siteUrl(), { waitUntil: "commit" });
		await page.locator(".home-intro").waitFor({ state: "visible" });
		assert.equal(scriptRequested, true, "the enhancement script is held back during the first-render assertion");
		assert.equal(await page.locator("#site-nav").isVisible(), false, "navigation must not flash expanded and shift the article when scripts arrive");
		assert.equal(await page.locator("#search-input").isVisible(), true);
	} finally {
		// Always release the request, including when an assertion fails.
		releaseScript();
	}
	await page.waitForLoadState("domcontentloaded");
	await page.locator("#menu-button").click();
	assert.equal(await page.locator("#menu-button").getAttribute("aria-expanded"), "true");
	assert.equal(await page.locator("#site-nav").isVisible(), true);
});

test("deep links reveal disclosures on direct entry, reload and history navigation", options, async t => {
	const page = await pageFor(t);
	const fragment = "legacy-gadget-selections";
	await page.goto(siteUrl(`data-sources.html#${fragment}`));
	const target = page.locator(`#${fragment}`);
	await page.waitForFunction(id => document.getElementById(id)?.closest("details")?.open, fragment);
	assert.equal(await target.evaluate(element => element.closest("details").open), true);
	await page.reload();
	await page.waitForFunction(id => document.getElementById(id)?.closest("details")?.open, fragment);
	await target.locator("xpath=ancestor::details[1]").locator("summary").click();
	assert.equal(await target.evaluate(element => element.closest("details").open), false);
	await page.evaluate(() => { window.location.hash = "auto-mode"; });
	await page.waitForURL(/#auto-mode$/);
	await page.goBack();
	await page.waitForURL(new RegExp(`#${fragment}$`));
	await page.waitForFunction(id => document.getElementById(id)?.closest("details")?.open, fragment);
	await page.goForward();
	await page.waitForURL(/#auto-mode$/);
	await page.goto(siteUrl("controls.html#settings-migration"));
	await page.waitForFunction(() => document.getElementById("settings-migration")?.closest("details")?.open);
	assert.match(await page.locator("#main-content").innerText(), /Settings only ever gain fields/);
	await page.goto(siteUrl());
	await page.locator("#search-input").fill("Settings migration");
	await page.locator('#search-results a[href*="controls.html#settings-migration"]').first().click();
	await page.waitForURL(/controls\.html#settings-migration$/);
	await page.waitForFunction(() => document.getElementById("settings-migration")?.closest("details")?.open);
});

test("routes, search index and principal assets resolve below the selected base path", options, async t => {
	const page = await pageFor(t);
	const responses = [];
	page.on("response", response => {
		if (new URL(response.url()).origin === base.origin) responses.push({ url: response.url(), status: response.status() });
	});
	await page.goto(siteUrl("sensor-dial.html#transparent-background"));
	await page.locator("#transparent-background").waitFor();
	await page.reload();
	assert.equal(await page.locator("h1").count(), 1);
	const sources = await page.locator('script[src], link[rel="stylesheet"], link[rel~="icon"]').evaluateAll(elements => elements.map(element => element.src || element.href));
	for (const url of sources) {
		if (new URL(url).origin === base.origin) assertWithinSite(url);
	}
	const search = await page.request.get(siteUrl("assets/js/search-data.json"));
	assert.equal(search.status(), 200);
	const index = await search.text();
	assert.ok(!index.includes("/release/") && !index.includes("COPY_RULES.md"), "private release material must not enter search");
	const image = page.locator("#main-content img").first();
	await image.scrollIntoViewIfNeeded();
	await page.waitForFunction(() => {
		const first = document.querySelector("#main-content img");
		return first?.complete && first.naturalWidth > 0;
	});
	assertWithinSite(await image.getAttribute("src"));
	assert.deepEqual(responses.filter(response => response.status >= 400), [], "same-origin requests must succeed");
});

test("essential content and navigation work without JavaScript", options, async t => {
	const page = await pageFor(t, { viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
	await page.goto(siteUrl());
	const install = page.locator('#site-nav a[href$="installation.html"]');
	await install.click();
	assert.match(page.url(), /installation\.html$/);
	assert.match(await page.locator("#main-content").innerText(), /Shared Memory Support/);
	const start = page.locator('#site-nav a[href$="getting-started.html"]');
	await start.click();
	assert.match(await page.locator("#main-content").innerText(), /Confirm a value/);
});
