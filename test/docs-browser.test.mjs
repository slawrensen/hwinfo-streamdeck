// Real generated-site regression tests, separate from plugin release gates.
// DOCS_TEST_URL=http://127.0.0.1:4000/hwinfo-streamdeck-preview/ \
// CHROME_PATH=/usr/bin/google-chrome node --test test/docs-browser.test.mjs
// Run once for each locally built base path, then against the deployed site.
/* global document, window */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const base = process.env.DOCS_TEST_URL ? new URL(process.env.DOCS_TEST_URL.endsWith("/") ? process.env.DOCS_TEST_URL : `${process.env.DOCS_TEST_URL}/`) : null;
const enabled = Boolean(base);
const options = { skip: enabled ? false : "UNAVAILABLE: set DOCS_TEST_URL to a real Jekyll build or published site" };
const isPreview = Boolean(base?.pathname.includes("preview"));
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
function assertWithinArchive(url, from = siteUrl("legacy/")) {
	const target = new URL(url, from);
	assert.equal(target.origin, base.origin);
	assert.ok(target.pathname.startsWith(new URL("legacy/", base).pathname), `${target.href} escaped the legacy documentation`);
}
async function focusStaysInViewer(page) {
	assert.equal(await page.locator("dialog.image-viewer").evaluate(dialog => dialog.contains(document.activeElement)), true,
		"keyboard focus must remain inside the open modal, not Edit this page or another background control");
}

test("authored CSS and JavaScript use the generated build identity", options, async t => {
	const page = await pageFor(t);
	const requested = new Set();
	page.on("request", request => requested.add(request.url()));
	const manifestResponse = await page.request.get(siteUrl("docs-build.json"));
	assert.equal(manifestResponse.status(), 200, "the generated site exposes its build identity");
	const manifest = await manifestResponse.json();
	assert.ok(typeof manifest.build_id === "string" && manifest.build_id.trim(), "the build manifest declares a nonempty identity");
	for (const route of ["", "sensor-dial.html"]) {
		await page.goto(siteUrl(route));
		const declaredBuild = await page.locator('meta[name="docs-build-id"]').getAttribute("content");
		assert.equal(declaredBuild, manifest.build_id, "home and article HTML belong to the generated build");
		const assetUrls = await page.locator('head link[rel="stylesheet"][href], head script[src]')
			.evaluateAll(elements => elements.map(element => element.href || element.src));
		for (const asset of ["assets/css/docs.css", "assets/js/docs.js"]) {
			const expected = new URL(asset, base);
			const matches = assetUrls.map(url => new URL(url)).filter(url => url.pathname === expected.pathname);
			assert.equal(matches.length, 1, `${asset} is loaded once under the current site base path`);
			const url = matches[0];
			assert.equal(url.origin, base.origin, `${asset} stays on the generated site's origin`);
			assert.deepEqual(url.searchParams.getAll("v"), [declaredBuild],
				`${asset} uses this build's cache identity so new HTML cannot reuse an unversioned or older authored asset`);
			assert.ok(requested.has(url.href), `the browser requests the declared version of ${asset}`);
		}
	}
});

async function viewerGeometry(page) {
	const geometry = await page.locator(".viewer-stage img").evaluate(async image => {
		await image.decode();
		await new Promise(resolve => window.requestAnimationFrame(resolve));
		const stage = image.closest(".viewer-stage");
		const imageBox = image.getBoundingClientRect();
		const stageBox = stage.getBoundingClientRect();
		const style = window.getComputedStyle(stage);
		const imageStyle = window.getComputedStyle(image);
		const left = stageBox.left + stage.clientLeft + Number.parseFloat(style.paddingLeft);
		const top = stageBox.top + stage.clientTop + Number.parseFloat(style.paddingTop);
		const width = stage.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
		const height = stage.clientHeight - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom);
		return {
			source: image.currentSrc,
			natural: { width: image.naturalWidth, height: image.naturalHeight },
			box: { left: imageBox.left, top: imageBox.top, width: imageBox.width, height: imageBox.height },
			available: { left, top, width, height, right: left + width, bottom: top + height },
			objectFit: imageStyle.objectFit, objectPosition: imageStyle.objectPosition,
			scroll: { x: stage.scrollLeft, y: stage.scrollTop, maxX: stage.scrollWidth - stage.clientWidth, maxY: stage.scrollHeight - stage.clientHeight }
		};
	});
	// object-fit can fill an element box while letterboxing its image. Measure
	// the painted content from the browser's actual box, intrinsic image size,
	// and computed fit/position, rather than mistaking the box for the picture.
	const { box, natural, objectFit } = geometry;
	const contain = Math.min(box.width / natural.width, box.height / natural.height);
	const scale = { contain, cover: Math.max(box.width / natural.width, box.height / natural.height), none: 1, "scale-down": Math.min(1, contain) }[objectFit];
	const width = objectFit === "fill" ? box.width : natural.width * scale;
	const height = objectFit === "fill" ? box.height : natural.height * scale;
	const position = geometry.objectPosition.split(/\s+/);
	const offset = (value, spare) => value.endsWith("%") ? Number.parseFloat(value) * spare / 100 : Number.parseFloat(value);
	const left = box.left + offset(position[0], box.width - width);
	const top = box.top + offset(position[1], box.height - height);
	return { ...geometry, painted: { left, top, width, height, right: left + width, bottom: top + height } };
}

function assertFittedImage(geometry) {
	const { painted, natural, available, scroll } = geometry;
	const scale = Math.min(available.width / natural.width, available.height / natural.height);
	assert.ok(Math.abs(painted.width - natural.width * scale) <= 2 && Math.abs(painted.height - natural.height * scale) <= 2,
		"Fit uses the available viewing area for the complete image, including enlarging a smaller source");
	assert.ok(painted.left >= available.left - 1 && painted.right <= available.right + 1
		&& painted.top >= available.top - 1 && painted.bottom <= available.bottom + 1,
		"Fit displays every image edge inside the viewing area without cropping");
	assert.ok(Math.abs((painted.left + painted.right) / 2 - (available.left + available.right) / 2) <= 1
		&& Math.abs((painted.top + painted.bottom) / 2 - (available.top + available.bottom) / 2) <= 1,
		"the fitted picture stays centered in the viewing area");
	assert.ok(scroll.maxX <= 1 && scroll.maxY <= 1 && scroll.x <= 1 && scroll.y <= 1, "Fit needs no panning or retained scroll offset");
}

function assertActualImage(geometry) {
	const { painted, natural, available } = geometry;
	assert.ok(Math.abs(painted.width - natural.width) <= 1 && Math.abs(painted.height - natural.height) <= 1,
		"Actual size renders the image at its native dimensions");
	if (natural.width <= available.width + 1) {
		assert.ok(Math.abs((painted.left + painted.right) / 2 - (available.left + available.right) / 2) <= 1,
			"an image that fits horizontally remains centered at Actual size");
	}
	if (natural.height <= available.height + 1) {
		assert.ok(Math.abs((painted.top + painted.bottom) / 2 - (available.top + available.bottom) / 2) <= 1,
			"an image that fits vertically remains centered at Actual size");
	}
}

async function assertActualImageEdgesReachable(page) {
	const initial = await viewerGeometry(page);
	const horizontal = initial.natural.width > initial.available.width + 1;
	const vertical = initial.natural.height > initial.available.height + 1;
	assert.ok(horizontal || vertical, "this case exercises a picture that needs panning");
	if (horizontal) assert.ok(initial.scroll.maxX > 0, "the oversized image can scroll horizontally");
	if (vertical) assert.ok(initial.scroll.maxY > 0, "the oversized image can scroll vertically");
	const stage = page.locator(".viewer-stage");
	const box = await stage.boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	for (const end of [false, true]) {
		const direction = end ? 1 : -1;
		await page.mouse.wheel(direction * initial.natural.width * 2, direction * initial.natural.height * 2);
		await page.waitForFunction(({ end, horizontal, vertical }) => {
			const stage = document.querySelector(".viewer-stage");
			const targetX = end ? stage.scrollWidth - stage.clientWidth : 0;
			const targetY = end ? stage.scrollHeight - stage.clientHeight : 0;
			return (!horizontal || Math.abs(stage.scrollLeft - targetX) <= 1) && (!vertical || Math.abs(stage.scrollTop - targetY) <= 1);
		}, { end, horizontal, vertical });
		const geometry = await viewerGeometry(page);
		assertActualImage(geometry);
		if (horizontal) assert.ok(end ? geometry.painted.right <= geometry.available.right + 1 : geometry.painted.left >= geometry.available.left - 1,
			`the ${end ? "right" : "left"} image edge is reachable by horizontal panning`);
		if (vertical) assert.ok(end ? geometry.painted.bottom <= geometry.available.bottom + 1 : geometry.painted.top >= geometry.available.top - 1,
			`the ${end ? "bottom" : "top"} image edge is reachable by vertical panning`);
	}
}

for (const viewport of [{ width: 360, height: 800 }, { width: 1280, height: 800 }]) {
	test(`essential documentation text stays readable without page overflow at ${viewport.width}px`, options, async t => {
		const page = await pageFor(t, { viewport });
		await page.goto(siteUrl("troubleshooting.html"));
		const menu = page.locator("#menu-button");
		if (await menu.isVisible()) await menu.click();
		assert.ok(await page.locator("#site-nav").isVisible(), "the sampled navigation is available to readers");
		const measurements = await page.evaluate(() => {
			const roles = {
				"article text": ".main-content > p",
				"status table headings": ".main-content th",
				"status table cells": ".main-content td",
				"inline technical names": ".main-content :not(pre) > code",
				"code examples": ".main-content pre code",
				"navigation links": "#site-nav .nav-list-link",
				"image captions": ".main-content > p > em:only-child",
				"sidebar help": ".site-footer, .site-footer a, .site-footer span"
			};
			const samples = Object.entries(roles).map(([role, selector]) => {
				const sizes = [...document.querySelectorAll(selector)].filter(element => element.textContent.trim())
					.map(element => Number.parseFloat(window.getComputedStyle(element).fontSize));
				return { role, samples: sizes.length, minimum: Math.min(...sizes) };
			});
			const markers = [...document.querySelectorAll(".main-content ol > li")]
				.map(element => window.getComputedStyle(element, "::before"))
				.filter(style => !["none", "normal"].includes(style.content))
				.map(style => Number.parseFloat(style.fontSize));
			return [...samples, { role: "ordered step markers", samples: markers.length, minimum: Math.min(...markers) }];
		});
		for (const sample of measurements) assert.ok(sample.samples > 0, `${sample.role} must be present in the rendered reference`);
		assert.deepEqual(measurements.filter(sample => sample.minimum < 14), [],
			"essential copy, controls and technical references must not shrink below a readable 14px minimum");
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true,
			"readable reference text must fit the page; wide tables and code scroll within their own regions");
	});
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
	test(`home identity, download and platform requirement fit ${viewport.width}×${viewport.height}`, options, async t => {
		const page = await pageFor(t, { viewport });
		await page.goto(siteUrl());
		await page.locator(".home-intro").waitFor();
		assert.equal(await page.locator("h1").count(), 1);
		for (const selector of ["h1", ".home-lead", ".home-actions .button-primary", ".home-requirements"]) {
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

for (const viewport of [{ width: 1920, height: 1080 }, { width: 3440, height: 1440 }, { width: 5120, height: 2160 }]) {
	test(`wide reading workspace keeps related content together at ${viewport.width}×${viewport.height}`, options, async t => {
		const page = await pageFor(t, { viewport });
		await page.goto(siteUrl("sensor-dial.html#transparent-background"));
		const media = page.locator('.main-content img[src$="/dial-backgrounds-deck.jpg"]');
		await media.scrollIntoViewIfNeeded();
		await media.evaluate(image => image.decode());
		const dimensions = await page.locator(".main-content").evaluate(content => {
			const prose = [...content.querySelectorAll(":scope > p")].find(p => p.textContent.length > 80 && !p.querySelector("img, picture"));
			const style = window.getComputedStyle(prose);
			const context = document.createElement("canvas").getContext("2d");
			context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
			const contentBox = content.getBoundingClientRect();
			const sidebar = document.querySelector(".side-bar").getBoundingClientRect();
			const main = document.querySelector(".side-bar + .main").getBoundingClientRect();
			const toc = document.querySelector(".page-toc").getBoundingClientRect();
			return {
				workspace: main.right - sidebar.left,
				leftMargin: sidebar.left,
				rightMargin: document.documentElement.clientWidth - main.right,
				navigationGap: main.left - sidebar.right,
				tocGap: toc.left - contentBox.right,
				tocWidth: toc.width,
				prose: prose.getBoundingClientRect().width,
				character: context.measureText("0").width,
				font: Number.parseFloat(style.fontSize),
				pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
			};
		});
		const image = await media.evaluate(element => {
			const box = element.getBoundingClientRect();
			return { width: box.width, height: box.height, ratio: element.naturalWidth / element.naturalHeight };
		});
		assert.ok(dimensions.workspace <= 1921, "navigation, article and contents stop spreading beyond the reading workspace");
		assert.ok(dimensions.leftMargin >= -1 && dimensions.rightMargin >= -1, "the workspace stays inside the viewport");
		assert.ok(Math.abs(dimensions.leftMargin - dimensions.rightMargin) <= 16, "the complete workspace is centered, allowing for the browser scrollbar");
		assert.ok(Math.abs(dimensions.navigationGap) <= 2, "navigation remains attached to the content workspace");
		assert.ok(dimensions.tocGap >= 24 && dimensions.tocGap <= 64 && dimensions.tocWidth >= 180, "page contents stays beside the article with readable link width");
		assert.ok(image.width > dimensions.prose * 1.3, "the complete deck capture must not be trapped in the prose column");
		assert.ok(dimensions.font >= 16 && dimensions.prose <= dimensions.character * 80 + 1, "body copy stays at a readable size and line length");
		assert.ok(Math.abs(image.width / image.height - image.ratio) < 0.01, "the authentic deck image keeps its aspect ratio");
		assert.equal(dimensions.pageOverflow, false, "the expanded article must not create horizontal page scrolling");
		const readout = page.locator(".main-content .table-wrapper").filter({ has: page.getByRole("columnheader", { name: "Element", exact: true }) });
		assert.equal(await readout.count(), 1, "the touchscreen readout table is present");
		const table = await readout.evaluate(element => ({ width: element.getBoundingClientRect().width, scroll: element.scrollWidth, client: element.clientWidth }));
		assert.ok(table.width <= 961 && table.width >= dimensions.prose, "ordinary descriptive tables stay readable without spreading across the full media area");
		assert.ok(table.scroll <= table.client + 1, "the ordinary readout table needs no sideways panning on desktop");
		const reference = await page.locator(".reference-table").evaluate(element => element.closest(".table-wrapper").getBoundingClientRect().width);
		assert.ok(reference >= table.width && reference <= 1281, "the settings matrix can use extra width without becoming unbounded");
	});
}

for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 1024 }]) {
	test(`all seven themes are readable without horizontal gallery panning at ${viewport.width}px`, options, async t => {
		const page = await pageFor(t, { viewport });
		await page.goto(siteUrl("themes.html#the-seven-presets"));
		const gallery = page.locator(".theme-gallery");
		const samples = gallery.locator(".theme-sample");
		assert.equal(await samples.count(), 7);
		assert.deepEqual(await samples.locator("figcaption strong").allTextContents(), ["Void", "Graphite", "Ultraviolet", "Midnight", "Forest", "Ember", "Paper"]);
		const rows = new Set();
		for (let i = 0; i < 7; i++) {
			const image = samples.nth(i).locator("img");
			await image.scrollIntoViewIfNeeded();
			await image.evaluate(element => element.decode());
			const dimensions = await image.evaluate(element => {
				const box = element.getBoundingClientRect();
				const parent = element.closest(".theme-gallery").getBoundingClientRect();
				return { left: box.left, right: box.right, width: box.width, height: box.height, top: box.top - parent.top, ratio: element.naturalWidth / element.naturalHeight, viewport: window.innerWidth, alt: element.alt };
			});
			assert.ok(dimensions.width >= 120 && dimensions.height >= 120, `theme ${i + 1} remains a readable sample`);
			assert.ok(dimensions.left >= 0 && dimensions.right <= dimensions.viewport, `theme ${i + 1} is reachable by ordinary vertical scrolling`);
			assert.ok(Math.abs(dimensions.width / dimensions.height - dimensions.ratio) < 0.01, `theme ${i + 1} keeps its complete image geometry`);
			assert.ok(dimensions.alt.length > 15, `theme ${i + 1} has a useful text alternative`);
			rows.add(Math.round(dimensions.top));
		}
		assert.ok(rows.size > 1, "the samples wrap into rows at phone and tablet widths");
		assert.equal(await gallery.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, "comparing presets must not require horizontal gallery scrolling");
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
		const fullComparison = page.getByRole("link", { name: "Open the full comparison for layouts and alert states." });
		assertWithinSite(await fullComparison.getAttribute("href"));
		await fullComparison.focus();
		await page.keyboard.press("Enter");
		const dialog = page.locator("dialog.image-viewer");
		await dialog.waitFor({ state: "visible" });
		assert.match(await dialog.locator("img").getAttribute("src"), /themes-contact-sheet\.png$/);
		await page.keyboard.press("Escape");
		await dialog.waitFor({ state: "hidden" });
		assert.equal(await fullComparison.evaluate(element => element === document.activeElement), true, "closing the complete comparison restores its keyboard opener");
	});
}

for (const viewport of [
	{ width: 320, height: 800 }, { width: 360, height: 800 }, { width: 390, height: 844 },
	{ width: 768, height: 1024 }, { width: 1000, height: 800 }, { width: 1199, height: 800 },
	{ width: 1200, height: 800 }, { width: 1280, height: 800 }, { width: 3440, height: 1440 }
]) {
	test(`larger branding preserves readable text and usable navigation at ${viewport.width}px`, options, async t => {
		const page = await pageFor(t, { viewport });
		await page.goto(siteUrl());
		await page.locator(".site-title img").evaluate(async image => {
			await document.fonts.ready;
			await image.decode();
		});
		const geometry = await page.locator(".site-header").evaluate(header => {
			const rectangle = element => {
				const box = element.getBoundingClientRect();
				return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
			};
			const home = header.querySelector(".site-title");
			const image = home.querySelector("img");
			const name = home.querySelector("strong");
			const subtitle = home.querySelector("small");
			const menu = header.querySelector("#menu-button");
			const text = [name, subtitle].map(element => {
				const range = document.createRange();
				range.selectNodeContents(element);
				const box = range.getBoundingClientRect();
				const style = window.getComputedStyle(element);
				return {
					text: element.textContent, left: box.left, right: box.right, top: box.top, bottom: box.bottom,
					height: box.height, lineHeight: Number.parseFloat(style.lineHeight), fontSize: Number.parseFloat(style.fontSize)
				};
			});
			return {
				header: rectangle(header), home: rectangle(home), image: rectangle(image), text,
				menu: window.getComputedStyle(menu).display === "none" ? null : rectangle(menu),
				clipped: home.scrollWidth > home.clientWidth + 1 || home.scrollHeight > home.clientHeight + 1,
				overflow: document.documentElement.scrollWidth > window.innerWidth + 1
			};
		});
		const withinHeader = box => box.left >= geometry.header.left - 1 && box.right <= geometry.header.right + 1
			&& box.top >= geometry.header.top - 1 && box.bottom <= geometry.header.bottom + 1;
		assert.equal(geometry.image.width, viewport.width >= 1200 ? 72 : 56, "the approved logo scale applies across the desktop breakpoint");
		assert.equal(geometry.image.height, geometry.image.width, "the actual logo retains its square proportions");
		assert.ok(withinHeader(geometry.home) && withinHeader(geometry.image), "the complete home link and logo stay inside the header");
		assert.equal(geometry.clipped, false, "branding is not hidden by a constrained link box");
		for (const text of geometry.text) {
			assert.ok(withinHeader(text), `${text.text} stays inside the header`);
			assert.ok(text.left >= geometry.image.right + 4, `${text.text} stays clear of the logo`);
			assert.ok(text.height <= text.lineHeight + 1, `${text.text} remains on a readable single line`);
		}
		assert.ok(geometry.text[0].fontSize >= 16 && geometry.text[1].fontSize >= 14,
			"enlarging the icon must not shrink the product name or subtitle");
		assert.ok(geometry.image.top >= geometry.header.top + 6 && geometry.image.bottom <= geometry.header.bottom - 6,
			"the larger icon retains visible breathing room above and below");
		if (geometry.menu) {
			assert.ok(withinHeader(geometry.menu), "the Menu control stays inside the header");
			assert.ok(geometry.menu.left >= geometry.home.right - 1, "the Menu control and home link do not overlap");
			assert.ok(geometry.menu.left >= Math.max(...geometry.text.map(text => text.right)) + 8,
				"the product name and subtitle retain clear separation from Menu");
			assert.ok(geometry.menu.width >= 44 && geometry.menu.height >= 44, "Menu retains a usable touch target");
			const menu = page.locator("#menu-button");
			await menu.click();
			assert.equal(await menu.getAttribute("aria-expanded"), "true");
			assert.equal(await page.locator("#site-nav").isVisible(), true, "the larger header does not obstruct navigation");
			await page.keyboard.press("Escape");
			assert.equal(await menu.getAttribute("aria-expanded"), "false");
			assert.equal(await menu.evaluate(element => element === document.activeElement), true, "closing navigation restores the Menu control");
		}
		assert.equal(geometry.overflow, false, "branding must not create whole-page horizontal scrolling");
	});
}

for (const width of [320, 390]) {
	test(`narrow navigation labels fit their targets and wrapped links work at ${width}px`, options, async t => {
		const page = await pageFor(t, { viewport: { width, height: 844 } });
		await page.goto(siteUrl());
		await page.locator("#menu-button").click();
		const labels = await page.locator("#site-nav .nav-list-link").evaluateAll(links => links.map(link => {
			const range = document.createRange();
			range.selectNodeContents(link);
			const target = link.getBoundingClientRect();
			return {
				text: link.textContent.trim(), href: link.getAttribute("href"), font: Number.parseFloat(window.getComputedStyle(link).fontSize),
				target: { left: target.left, right: target.right, top: target.top, bottom: target.bottom, height: target.height },
				lines: [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0)
					.map(rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }))
			};
		}));
		assert.ok(labels.length > 0, "the opened menu contains real documentation destinations");
		for (const label of labels) {
			assert.ok(label.font >= 16, `${label.text} keeps readable text instead of shrinking to fit`);
			assert.ok(label.target.height >= 44, `${label.text} retains a usable touch target`);
			assert.ok(label.lines.length > 0, `${label.text} has visible text`);
			for (const [index, line] of label.lines.entries()) {
				assert.ok(line.left >= label.target.left - 1 && line.right <= label.target.right + 1
					&& line.top >= label.target.top - 1 && line.bottom <= label.target.bottom + 1,
					`${label.text} stays inside its own target instead of spilling into the adjacent navigation column`);
				if (index > 0) {
					const gap = line.top - label.lines[index - 1].bottom;
					assert.ok(gap >= -1 && gap <= label.font / 2,
						`${label.text} reads as one label with clear, compact spacing between wrapped lines`);
				}
			}
		}
		const wrapped = labels.find(label => label.lines.length > 1);
		assert.ok(wrapped, "the narrow menu exercises an actual wrapped navigation label");
		assertWithinSite(wrapped.href);
		await page.locator("#site-nav").getByRole("link", { name: wrapped.text, exact: true }).click();
		await page.waitForURL(new URL(wrapped.href, base).href);
		assert.equal(await page.locator('#site-nav [aria-current="page"]').innerText(), wrapped.text,
			"the wrapped label activates its intended documentation destination");
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
	});
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 360, height: 800 }]) {
	test(`the repository logo and native home link work without JavaScript at ${viewport.width}px`, options, async t => {
		const page = await pageFor(t, { viewport, javaScriptEnabled: false, deviceScaleFactor: 2 });
		await page.goto(siteUrl("installation.html"));
		const home = page.locator(".site-title");
		const logo = home.locator("img");
		assert.equal(await logo.count(), 1, "the project logo is a real image inside the home link");
		const image = await logo.evaluate(element => {
			const box = element.getBoundingClientRect();
			const link = element.closest("a");
			const linkBox = link.getBoundingClientRect();
			const header = element.closest(".site-header").getBoundingClientRect();
			return {
				complete: element.complete, width: element.naturalWidth, height: element.naturalHeight, src: element.currentSrc,
				renderedWidth: box.width, renderedHeight: box.height, density: window.devicePixelRatio,
				withinHeader: linkBox.left >= header.left && linkBox.right <= header.right && linkBox.top >= header.top && linkBox.bottom <= header.bottom,
				clipped: link.scrollWidth > link.clientWidth + 1 || link.scrollHeight > link.clientHeight + 1
			};
		});
		const approvedSize = viewport.width >= 1200 ? 72 : 56;
		assert.ok(image.complete && image.renderedWidth === approvedSize && image.renderedHeight === approvedSize,
			"the authentic logo uses the approved desktop or smaller-screen size without JavaScript");
		assert.ok(image.width > 0 && image.height > 0, "the native logo image decodes");
		const logoResponse = await page.request.get(image.src);
		assert.equal(logoResponse.status(), 200);
		const logoBytes = await logoResponse.body();
		assert.equal(logoBytes.subarray(1, 4).toString(), "PNG", "the selected logo source is the shipped PNG derivative");
		// naturalWidth is density-corrected for a 2x srcset candidate. Read the
		// encoded PNG dimensions to detect an undersized high-density source.
		assert.ok(logoBytes.readUInt32BE(16) >= image.renderedWidth * image.density - 1 && logoBytes.readUInt32BE(20) >= image.renderedHeight * image.density - 1,
			"the responsive logo source supplies enough pixels for the display density");
		assert.ok(Math.abs(image.renderedWidth - image.renderedHeight) <= 1, "the logo keeps its square geometry");
		assert.ok(image.withinHeader && !image.clipped, "the larger logo and wordmark fit inside the header without clipping");
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "branding must not create horizontal page overflow");
		assertWithinSite(image.src);
		assert.equal(new URL(await home.getAttribute("href"), base).href, siteUrl());
		await home.focus();
		await page.keyboard.press("Enter");
		await page.waitForURL(siteUrl());
		assert.match(await page.locator("h1").innerText(), /HWiNFO Sensors/);
	});
}

for (const scenario of [
	{ width: 2048, height: 1220, page: "sensor-dial.html", image: "dial-backgrounds-looks.jpg" },
	{ width: 3440, height: 1440, page: "", image: "dial-backgrounds-strip.jpg" }
]) {
	test(`image viewer enlarges the complete strip in Fit and centers Actual at ${scenario.width}px`, options, async t => {
		const page = await pageFor(t, { viewport: { width: scenario.width, height: scenario.height } });
		await page.goto(siteUrl(scenario.page));
		const opener = page.locator(`.main-content a[data-image-viewer][href$="/${scenario.image}"]`);
		await opener.click();
		const dialog = page.locator("dialog.image-viewer");
		const fit = await viewerGeometry(page);
		assertFittedImage(fit);
		assert.ok(fit.natural.width < fit.available.width && fit.natural.height < fit.available.height,
			"the reported-defect case uses a source smaller than its viewing area");
		await dialog.getByRole("button", { name: "Actual size", exact: true }).click();
		const actual = await viewerGeometry(page);
		assertActualImage(actual);
		assert.ok(fit.painted.width > actual.painted.width * 1.1,
			"Fit and Actual change the picture's scale materially, rather than merely moving it to a corner");
		await dialog.getByRole("button", { name: "Fit to screen", exact: true }).click();
		assertFittedImage(await viewerGeometry(page));
		await page.keyboard.press("Escape");
		assert.equal(await opener.evaluate(element => element === document.activeElement), true);
	});
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
	test(`image viewer fits the complete deck and reaches every native-size edge at ${viewport.width}px`, options, async t => {
		const page = await pageFor(t, { viewport });
		await page.goto(siteUrl());
		await page.locator(".hero-figure .image-link[data-image-viewer]").click();
		const dialog = page.locator("dialog.image-viewer");
		const fit = await viewerGeometry(page);
		assertFittedImage(fit);
		assert.ok(fit.painted.width < fit.natural.width - 32, "the full-deck image is scaled down to fit this viewport");
		await dialog.getByRole("button", { name: "Actual size", exact: true }).click();
		assertActualImage(await viewerGeometry(page));
		await assertActualImageEdgesReachable(page);
		await dialog.getByRole("button", { name: "Fit to screen", exact: true }).click();
		assertFittedImage(await viewerGeometry(page));
		await dialog.getByRole("button", { name: "Close", exact: true }).click();
	});
}

test("image viewer refits on resize, centers the fitting axis, and resets when another image opens", options, async t => {
	const page = await pageFor(t, { viewport: { width: 2048, height: 1220 } });
	await page.goto(siteUrl("sensor-dial.html"));
	const strip = page.locator('.main-content a[data-image-viewer][href$="/dial-backgrounds-looks.jpg"]');
	const deck = page.locator('.main-content a[data-image-viewer][href$="/dial-backgrounds-deck.jpg"]');
	await strip.click();
	const dialog = page.locator("dialog.image-viewer");
	const wide = await viewerGeometry(page);
	assertFittedImage(wide);
	await page.setViewportSize({ width: 390, height: 844 });
	const phone = await viewerGeometry(page);
	assertFittedImage(phone);
	assert.ok(phone.painted.width < wide.painted.width / 2, "an already-open picture refits after the viewport narrows");
	await dialog.getByRole("button", { name: "Actual size", exact: true }).click();
	const actual = await viewerGeometry(page);
	assertActualImage(actual);
	assert.ok(actual.natural.width > actual.available.width && actual.natural.height < actual.available.height,
		"this case needs horizontal panning while its vertical axis still fits");
	await assertActualImageEdgesReachable(page);
	await page.keyboard.press("Escape");
	await deck.click();
	const replacement = await viewerGeometry(page);
	assert.match(replacement.source, /dial-backgrounds-deck\.jpg$/);
	assertFittedImage(replacement);
	assert.notDeepEqual(replacement.natural, phone.natural, "the replacement loads a genuinely different image size");
	assert.equal(await dialog.getByRole("button", { name: "Actual size", exact: true }).count(), 1, "opening another picture starts in Fit");
	await page.keyboard.press("Escape");
	await strip.click();
	const reopened = await viewerGeometry(page);
	assert.match(reopened.source, /dial-backgrounds-looks\.jpg$/);
	assertFittedImage(reopened);
	await page.setViewportSize({ width: 2048, height: 1220 });
	assertFittedImage(await viewerGeometry(page));
	await page.keyboard.press("Escape");
	assert.equal(await strip.evaluate(element => element === document.activeElement), true);
});

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
	const fitted = await viewerGeometry(page);
	await actual.click();
	assert.equal(await actual.innerText(), "Fit to screen", "the button names the action available from Actual size");
	assert.equal(await actual.getAttribute("aria-pressed"), null, "the changing action label is not exposed as a contradictory pressed toggle");
	const natural = await viewerGeometry(page);
	assertActualImage(natural);
	assert.ok(natural.painted.width > fitted.painted.width + 32, "Actual size changes the displayed full-deck scale");
	await actual.click();
	assert.equal(await actual.innerText(), "Actual size");
	assertFittedImage(await viewerGeometry(page));
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
	await page.route(url => url.origin === base.origin && url.pathname === new URL("assets/js/docs.js", base).pathname, async route => {
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

for (const width of [1440, 1600]) {
	test(`page contents fits its article position at ${width}px`, options, async t => {
		const page = await pageFor(t, { viewport: { width, height: 900 } });
		await page.goto(siteUrl("troubleshooting.html"));
		const toc = page.locator(".page-toc");
		const details = toc.locator("details");
		const summary = details.locator("summary");
		await toc.waitFor({ state: "visible" });
		assert.equal(await details.evaluate(element => element.open), width === 1600,
			"contents starts compact above an article and expanded in its side column");
		if (width === 1440) {
			assert.ok((await toc.boundingBox()).height <= 80, "inline contents must not consume the opening screen");
			const firstFix = await page.locator(".main-content table").first().getByRole("link").first().boundingBox();
			assert.ok(firstFix && firstFix.y >= 0 && firstFix.y + firstFix.height <= 900,
				"the first concrete troubleshooting action is visible before scrolling");
			const resize = async nextWidth => {
				await page.setViewportSize({ width: nextWidth, height: 900 });
				await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
			};
			await summary.click();
			assert.equal(await details.evaluate(element => element.open), true, "the inline disclosure opens normally");
			await resize(1500);
			assert.equal(await details.evaluate(element => element.open), true, "resizing within the inline layout preserves a reader's open choice");
			await resize(1600);
			assert.equal(await details.evaluate(element => element.open), true);
			await summary.click();
			await resize(1680);
			assert.equal(await details.evaluate(element => element.open), false, "resizing within the side layout preserves a reader's closed choice");
			await summary.click();
			await toc.locator('a[href="#age-unknown"]').focus();
			await resize(1440);
			assert.equal(await details.evaluate(element => element.open), false, "returning to an inline layout restores its compact default");
			assert.equal(await summary.evaluate(element => element === document.activeElement), true,
				"collapsing responsive contents must not leave keyboard focus inside hidden links");
		} else {
			const box = await toc.boundingBox();
			const article = await page.locator(".main-content").boundingBox();
			assert.ok(box.x >= article.x + article.width + 24, "expanded contents occupies the side column beside the article");
			await toc.locator('a[href="#age-unknown"]').click();
			await page.waitForURL(/#age-unknown$/);
			assert.ok(await page.locator("#age-unknown").isVisible(), "contents links reach the concrete status explanation");
		}
	});
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
	test(`direct article fragments start just below the sticky header at ${viewport.width}px`, options, async t => {
		const page = await pageFor(t, { viewport });
		await page.goto(siteUrl("sensor-dial.html#transparent-background"), { waitUntil: "networkidle" });
		const geometry = await page.locator("#transparent-background").evaluate(async heading => {
			await document.fonts.ready;
			await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
			const target = heading.getBoundingClientRect();
			const header = document.querySelector("#main-header").getBoundingClientRect();
			return { headingTop: target.top, headerBottom: header.bottom, gap: target.top - header.bottom };
		});
		assert.ok(geometry.headerBottom > 0 && geometry.headerBottom < viewport.height, "the sticky search header is visible at the deep link");
		assert.ok(geometry.gap >= 8 && geometry.gap <= 24,
			`the requested section starts with a compact readable gap below sticky navigation; actual gap ${geometry.gap}px`);
	});
}

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

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
	test(`current and legacy documentation have visible native return paths at ${viewport.width}px`, options, async t => {
		const page = await pageFor(t, { viewport, javaScriptEnabled: false });
		for (const route of ["", "sensor-dial.html"]) {
			await page.goto(siteUrl(route));
			if (isPreview) {
				const stable = page.getByRole("link", { name: /^Stable docs/ });
				assert.equal(new URL(await stable.getAttribute("href"), page.url()).href, "https://docs.slawrensen.com/hwinfo-streamdeck/");
				await page.goto(siteUrl(`legacy/${route}`));
			} else {
				const legacy = page.getByRole("link", { name: /^Legacy docs/ });
				const box = await legacy.boundingBox();
				// Centering a 44px target inside a bordered 44px bar can place
				// its edge on a half pixel. Allow only rounding-level tolerance.
				assert.ok(box && box.y >= -1 && box.y + box.height <= viewport.height + 1, "the legacy link is visible before scrolling");
				assert.ok(box.height >= 44, "the edition switch retains a usable touch target");
				assert.equal(new URL(await legacy.getAttribute("href"), page.url()).href, siteUrl(`legacy/${route}`), "the edition switch retains the current page");
				await legacy.focus();
				await page.keyboard.press("Enter");
			}
			await page.waitForURL(siteUrl(`legacy/${route}`));
			const current = page.getByRole("link", { name: /^Current docs/ });
			assert.equal(new URL(await current.getAttribute("href"), page.url()).href, siteUrl(route), "the native return link points to the corresponding current page");
			const banner = page.locator(".legacy-banner");
			assert.match(await banner.innerText(), /Legacy documentation/);
			const box = await banner.boundingBox();
			assert.ok(box && box.y >= 0 && box.y + box.height <= viewport.height, "legacy identity and its return link stay visible on entry");
			assert.ok(await current.isVisible());
			assert.ok((await current.boundingBox()).height >= 44, "the current documentation return link retains a usable touch target");
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "the edition bar must not cause page overflow");
			await current.focus();
			await page.keyboard.press("Enter");
			await page.waitForURL(siteUrl(route));
			assert.equal(await page.locator("h1").count(), 1);
		}
		if (!isPreview) {
			await page.goto(siteUrl("404.html"));
			const legacy = page.getByRole("link", { name: /^Legacy docs/ });
			assert.equal(new URL(await legacy.getAttribute("href"), page.url()).href, siteUrl("legacy/"), "new pages without an archived counterpart link to the legacy homepage");
			await legacy.click();
			await page.waitForURL(siteUrl("legacy/"));
		}
	});
}

test("only preview and archived documentation are excluded from indexing", options, async t => {
	const page = await pageFor(t);
	for (const route of ["", "sensor-dial.html"]) {
		await page.goto(siteUrl(route));
		const currentRobots = await page.locator('meta[name="robots"]').evaluateAll(elements => elements.map(element => element.content).join(","));
		assert.equal(/(?:^|[\s,])noindex(?:[\s,]|$)/i.test(currentRobots ?? ""), isPreview, "production current pages must not inherit preview noindex");
		await page.goto(siteUrl(`legacy/${route}`));
		const robots = await page.locator('meta[name="robots"]').getAttribute("content");
		assert.match(robots, /(?:^|[\s,])noindex(?:[\s,]|$)/i, "archived content is explicitly excluded from search engines");
		assert.match(await page.locator(".legacy-banner").innerText(), /Legacy documentation/);
	}
});

test("current and legacy search keep visitors inside the selected documentation", options, async t => {
	const page = await pageFor(t);
	const currentResponse = await page.request.get(siteUrl("assets/js/search-data.json"));
	assert.equal(currentResponse.status(), 200);
	const currentIndex = Object.values(await currentResponse.json());
	assert.ok(currentIndex.length > 0, "current search is populated");
	for (const entry of currentIndex) {
		assert.equal(typeof entry.url, "string");
		assert.ok(!new URL(entry.url, base).pathname.startsWith(new URL("legacy/", base).pathname), "the current index must not include frozen legacy pages");
	}
	const legacyRoot = siteUrl("legacy/");
	const archiveResponse = await page.request.get(siteUrl("legacy/assets/js/search-data.json"));
	assert.equal(archiveResponse.status(), 200);
	const archiveIndex = Object.values(await archiveResponse.json());
	assert.ok(archiveIndex.length > 0, "the archive keeps its own useful search index");
	for (const entry of archiveIndex) {
		assert.equal(typeof entry.url, "string");
		assertWithinArchive(entry.url, legacyRoot);
	}
	await page.goto(siteUrl("legacy/sensor-dial.html#transparent-background"));
	assert.equal(await page.locator("#transparent-background").count(), 1, "an existing legacy fragment still resolves directly");
	await page.locator("#search-input").pressSequentially("transparent background", { delay: 25 });
	const result = page.locator('#search-results a[href*="sensor-dial.html"]').first();
	await result.waitFor({ state: "visible" });
	for (const href of await page.locator("#search-results a").evaluateAll(links => links.map(link => link.href))) assertWithinArchive(href);
	await result.click();
	assertWithinArchive(page.url());
	assert.match(await page.locator(".main-content").innerText(), /Transparent background/);
});

test("legacy image viewer contains keyboard focus and restores its image opener", options, async t => {
	const page = await pageFor(t);
	await page.goto(siteUrl("legacy/sensor-dial.html#transparent-background"));
	const opener = page.locator('.main-content img[src$="dial-backgrounds-deck.jpg"]');
	await opener.scrollIntoViewIfNeeded();
	await opener.evaluate(image => image.decode());
	await page.waitForFunction(() => document.querySelector('.main-content img[src$="dial-backgrounds-deck.jpg"]')?.getAttribute("role") === "button");
	await opener.focus();
	await page.keyboard.press("Enter");
	const dialog = page.getByRole("dialog", { name: "Zoomed image" });
	await dialog.waitFor({ state: "visible" });
	const actual = dialog.getByRole("button", { name: "Actual size", exact: true });
	await actual.focus();
	const containsFocus = async () => assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, "focus must not reach Edit this page or another background control");
	await page.keyboard.press("Shift+Tab");
	await containsFocus();
	for (const key of ["Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
		await page.keyboard.press(key);
		await containsFocus();
	}
	await page.locator("#search-input").evaluate(input => input.focus());
	await containsFocus();
	await actual.click();
	const fit = dialog.getByRole("button", { name: "Fit to screen", exact: true });
	assert.equal(await fit.count(), 1, "Actual size is pointer-accessible and exposes its changed action");
	await fit.click();
	assert.equal(await actual.count(), 1, "Fit to screen is pointer-accessible and restores the fitted view");
	await page.keyboard.press("Escape");
	await dialog.waitFor({ state: "hidden" });
	assert.equal(await opener.evaluate(element => element === document.activeElement), true, "Escape restores the image that opened the archive viewer");
	await page.keyboard.press("Enter");
	await dialog.waitFor({ state: "visible" });
	await dialog.getByRole("button", { name: "Close", exact: true }).click();
	await dialog.waitFor({ state: "hidden" });
	assert.equal(await opener.evaluate(element => element === document.activeElement), true, "Close restores the archive image opener");
});
