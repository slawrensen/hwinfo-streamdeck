// Rasterize the production-renderer gallery on Windows with installed Tahoma.
// Run with: npx --no-install tsx scripts/docs-gallery-raster.mjs --input DIR --output DIR
// Font fallback is an explicit local-inspection option and never publishable.
/* global document, window */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";
import { TAHOMA } from "../src/ui/face-font.ts";
import { loadFont } from "./lib/ttf.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const ids = ["cyan-stars", "green-night", "violet-dusk", "amber-dusk", "green-aurora"];
const frame = { width: 830, height: 450, deviceScaleFactor: 6 };
const widths = [830, 1660, 2490, 4980];
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

function argumentsFor(argv) {
	const options = { input: ".gallery-render-work", output: ".gallery-render-work/final", allowFontFallback: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--allow-font-fallback") options.allowFontFallback = true;
		else if (arg === "--input" || arg === "--output") {
			assert.ok(argv[i + 1] && !argv[i + 1].startsWith("--"), arg + " requires a directory");
			options[arg.slice(2)] = argv[++i];
		} else throw new Error("Unknown argument: " + arg);
	}
	options.input = path.resolve(options.input);
	options.output = path.resolve(options.output);
	assert.notEqual(options.input, options.output, "Input and output directories must differ");
	return options;
}

async function rawPixels(bytes) {
	return sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function requireVerified(condition, message, options, failures) {
	if (condition) return;
	failures.push(message);
	assert.ok(options.allowFontFallback, message + ". Use --allow-font-fallback only for unverified local inspection.");
}

async function main() {
	const options = argumentsFor(process.argv.slice(2));
	const failures = [];
	const compositionBytes = await readFile(path.join(options.input, "composition.json"));
	const composition = JSON.parse(compositionBytes.toString("utf8"));
	assert.ok(composition && typeof composition === "object" && !Array.isArray(composition), "composition.json must contain an object");
	const inputFiles = (await readdir(options.input)).filter(name => name.endsWith(".svg")).sort();
	assert.deepEqual(inputFiles, ids.map(id => id + ".svg").sort(), "The input must contain exactly the five named gallery SVGs");
	await mkdir(options.output, { recursive: true });
	assert.equal((await readdir(options.output)).length, 0, "Output must be empty; choose a fresh directory to avoid mixing verified and stale files");

	requireVerified(process.platform === "win32", "Publication requires Windows", options, failures);
	const fontPath = process.platform === "win32"
		? path.join(process.env.SystemRoot || "C:\\Windows", "Fonts", "tahomabd.ttf")
		: "C:\\Windows\\Fonts\\tahomabd.ttf";
	let fontBytes, font;
	try {
		if (process.platform !== "win32") throw new Error("Windows font path is unavailable on this platform");
		fontBytes = await readFile(fontPath);
		font = loadFont(fontPath);
	} catch (error) {
		requireVerified(false, "Installed Tahoma Bold could not be verified: " + error.message, options, failures);
	}

	const browser = await chromium.launch({
		headless: true,
		...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" })
	});
	const context = await browser.newContext({
		viewport: { width: frame.width, height: frame.height },
		deviceScaleFactor: frame.deviceScaleFactor,
		colorScheme: "dark", reducedMotion: "reduce"
	});
	const blockedResources = [];
	await context.route("**/*", route => { blockedResources.push(route.request().url()); return route.abort(); });
	const page = await context.newPage();
	page.setDefaultTimeout(30000);
	const pageErrors = [];
	page.on("pageerror", error => pageErrors.push(error.message));
	const assets = [];
	const glyphs = new Set(Array.from("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,%°/-+()"));
	const platformFonts = [];
	let canvasMetrics, fileMetrics;
	try {
		for (const id of ids) {
			const svgBytes = await readFile(path.join(options.input, id + ".svg"));
			const svg = svgBytes.toString("utf8");
			assert.ok(!/<(?:script|foreignObject|iframe|object|embed|animate|animateTransform|set)\b/i.test(svg), id + ": SVG must be static");
			assert.ok(!/\son\w+\s*=/i.test(svg) && !/@font-face|@import/i.test(svg), id + ": SVG must not contain script handlers or bundled fonts");
			await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:830px;height:450px;overflow:hidden}body>svg{display:block}</style></head><body>' + svg + "</body></html>");
			const inspected = await page.evaluate(async () => {
				await document.fonts.ready;
				const roots = [...document.body.children].filter(element => element.localName === "svg");
				if (roots.length !== 1) throw new Error("Exactly one root SVG is required");
				const svg = roots[0];
				const box = svg.getBoundingClientRect(), view = svg.viewBox.baseVal;
				const external = [];
				for (const element of svg.querySelectorAll("*")) {
					const href = element.getAttribute("href") || element.getAttributeNS("http://www.w3.org/1999/xlink", "href");
					if (href && !href.startsWith("#") && !/^data:image\/(?:png|jpe?g|webp|svg\+xml);base64,/i.test(href)) external.push(href.slice(0,160));
					for (const attribute of element.attributes) {
						for (const match of attribute.value.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) if (!match[1].startsWith("#")) external.push(match[1].slice(0,160));
					}
				}
				const images = [...svg.querySelectorAll("image")];
				await Promise.all(images.map(image => new Promise((resolve,reject) => {
					const probe = document.createElement("img");
					probe.onload = resolve; probe.onerror = () => reject(new Error("Embedded image cannot be decoded"));
					probe.src = image.getAttribute("href") || image.getAttributeNS("http://www.w3.org/1999/xlink", "href");
				})));
				await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
				return {
					box: { width: box.width, height: box.height, left: box.left, top: box.top },
					viewBox: [view.x,view.y,view.width,view.height], external,
					texts: [...svg.querySelectorAll("text")].map(element => element.textContent),
					deviceScaleFactor: window.devicePixelRatio
				};
			});
			assert.deepEqual(inspected.box, { width: 830, height: 450, left: 0, top: 0 }, id + ": root SVG must occupy the exact CSS frame");
			assert.deepEqual(inspected.viewBox, [0,0,830,450], id + ": unexpected viewBox");
			assert.equal(inspected.deviceScaleFactor, 6, "Capture density must be 6x");
			assert.deepEqual(inspected.external, [], id + ": SVG must contain only self-contained resources");
			assert.ok(inspected.texts.length > 0, id + ": expected genuine renderer text, not a flattened screenshot");
			for (const text of inspected.texts) for (const glyph of text) if (!/[\r\n\t]/.test(glyph)) glyphs.add(glyph);

			const cdp = await context.newCDPSession(page);
			await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
			const { root: dom } = await cdp.send("DOM.getDocument");
			const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: dom.nodeId, selector: "svg text" });
			const used = new Map();
			for (const nodeId of nodeIds) {
				const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
				for (const item of fonts) if (item.glyphCount > 0) {
					const key = item.familyName + "/" + item.postScriptName;
					const prior = used.get(key);
					used.set(key, { ...item, glyphCount: item.glyphCount + (prior?.glyphCount || 0) });
				}
			}
			await cdp.detach();
			const actualFonts = [...used.values()];
			platformFonts.push({ id, fonts: actualFonts });
			requireVerified(actualFonts.length > 0 && actualFonts.every(item => /^Tahoma(?: Bold)?$/i.test(item.familyName) && /Tahoma.*Bold/i.test(item.postScriptName) && !item.isCustomFont),
				id + ": Chromium did not render every text glyph with installed Tahoma Bold", options, failures);

			const png = await page.locator("body > svg").screenshot({ type: "png", scale: "device", omitBackground: true, animations: "disabled" });
			const masterPixels = await rawPixels(png);
			assert.equal(masterPixels.info.width, 4980, id + ": unexpected master width");
			assert.equal(masterPixels.info.height, 2700, id + ": unexpected master height");
			const outputs = [];
			await writeFile(path.join(options.output, id + ".png"), png);
			outputs.push({ file: id + ".png", width: 4980, height: 2700, bytes: png.length, sha256: digest(png), role: "Chromium raster master" });
			for (const width of widths) {
				const height = width * frame.height / frame.width;
				const pipeline = sharp(png);
				if (width !== 4980) pipeline.resize(width, height, { fit: "fill", kernel: "lanczos3" });
				const webp = await pipeline.webp({ lossless: true, effort: 6 }).toBuffer();
				const decoded = await rawPixels(webp);
				assert.equal(decoded.info.width, width); assert.equal(decoded.info.height, height);
				assert.equal(decoded.info.width * frame.height, decoded.info.height * frame.width, "Every derivative must retain the 830:450 ratio");
				if (width === 4980) assert.ok(decoded.data.equals(masterPixels.data), id + ": lossless WebP master must decode to the exact PNG pixels");
				const file = id + "-" + width + ".webp";
				await writeFile(path.join(options.output, file), webp);
				outputs.push({ file, width, height, bytes: webp.length, sha256: digest(webp), lossless: true, pixelExactToPngMaster: width === 4980, resizeKernel: width === 4980 ? null : "lanczos3" });
			}
			await writeFile(path.join(options.output, id + ".svg"), svgBytes);
			assets.push({ id, svg: { file: id + ".svg", bytes: svgBytes.length, sha256: digest(svgBytes) }, outputs });
			console.log("Captured " + id + " at 4980 x 2700 with four lossless WebP sizes");
		}

		const probes = [...glyphs].sort((a,b) => a.codePointAt(0) - b.codePointAt(0)).map(glyph => ({ glyph, expected12: TAHOMA.advance12[glyph] ?? null }));
		requireVerified(probes.every(probe => probe.expected12 !== null), "Some rendered glyphs have no production Tahoma advance", options, failures);
		fileMetrics = probes.map(probe => {
			const metric = font?.metrics(probe.glyph);
			const actual12 = metric ? metric.a * 12 / font.upem : null;
			return { ...probe, actual12, delta12: actual12 === null || probe.expected12 === null ? null : actual12 - probe.expected12 };
		});
		requireVerified(fileMetrics.every(metric => metric.delta12 !== null && Math.abs(metric.delta12) < 0.000001), "Installed font advances differ from the production TAHOMA profile", options, failures);
		canvasMetrics = await page.evaluate(async probes => {
			await document.fonts.ready;
			const context = document.createElement("canvas").getContext("2d");
			context.fontKerning = "none";
			const measurements = [];
			for (const weight of [600,700]) for (const size of [12,48]) {
				context.font = weight + " " + size + "px Tahoma";
				for (const probe of probes) {
					const actual = context.measureText(probe.glyph).width;
					const expected = probe.expected12 === null ? null : probe.expected12 * size / 12;
					measurements.push({ glyph: probe.glyph, weight, size, expected, actual, delta: expected === null ? null : actual - expected, tolerance: 0.03 * size / 12 });
				}
			}
			return measurements;
		}, probes);
		requireVerified(canvasMetrics.every(metric => metric.delta !== null && Math.abs(metric.delta) <= metric.tolerance), "Canvas glyph widths differ from the production TAHOMA profile", options, failures);
		assert.deepEqual(blockedResources, [], "Self-contained SVG rendering must not request network resources");
		assert.deepEqual(pageErrors, [], "The renderer page must not raise JavaScript errors");
		const publishable = failures.length === 0 && !options.allowFontFallback;
		const provenance = {
			schemaVersion: 1,
			kind: "Production-renderer sample reconstruction, rasterized from self-contained SVG",
			verification: { publishable, status: publishable ? "verified-windows-tahoma" : "unverified-local-inspection", allowFontFallback: options.allowFontFallback, failures },
			compositionSha256: digest(compositionBytes), composition,
			capture: { ...frame, masterWidth: 4980, masterHeight: 2700, resizePolicy: "Only smaller responsive derivatives are resampled; the PNG and 4980px WebP have identical decoded pixels." },
			runtime: { platform: process.platform, architecture: process.arch, osRelease: os.release(), node: process.version, chrome: browser.version(), playwright: require("playwright/package.json").version, sharp: sharp.versions.sharp, libvips: sharp.versions.vips, libwebp: sharp.versions.webp, sourceCommit: execFileSync("git",["rev-parse","HEAD"],{ cwd: root, encoding: "utf8" }).trim(), workflowRunId: process.env.GITHUB_RUN_ID || null },
			font: { family: "Tahoma", weightFile: "tahomabd.ttf", installedPath: fontPath, sha256: fontBytes ? digest(fontBytes) : null, bytes: fontBytes?.length ?? null, unitsPerEm: font?.upem ?? null, bundled: false, productionProfile: "src/ui/face-font.ts:TAHOMA", profileSha256: digest(await readFile(path.join(root,"src/ui/face-font.ts"))), metricsSha256: digest(await readFile(path.join(root,"src/ui/tahoma-bold-metrics.ts"))), fileMetrics, canvasMetrics, platformFonts },
			limitations: ["These are production-renderer samples, not new hardware photographs or live captures.", "Chromium rasterization can differ from Stream Deck QtSvg rasterization even when installed font advances match.", "Composition-specific source and reconstruction limitations are retained verbatim in composition metadata."],
			assets
		};
		await writeFile(path.join(options.output,"composition.json"),compositionBytes);
		await writeFile(path.join(options.output,"provenance.json"),JSON.stringify(provenance,null,2) + "\n");
		console.log(publishable ? "PASS: Windows Tahoma gallery is verified for publication" : "UNVERIFIED: local inspection only; publication is blocked");
	} finally {
		await context.close();
		await browser.close();
	}
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
