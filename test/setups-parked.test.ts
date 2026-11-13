/**
 * Setups (copying a whole deck's keys and dials as a setup, reviewing and
 * applying one, the eight bundled starters) left 1.8 on the owner's word,
 * 2026-11-04, and waits on branch park/1.8-before-cuts. 1.7.1 never had it.
 *
 * These hold what a person and the package meet once it is out: no fold, no
 * page, no link, no starter, no suite. They also hold what sat beside it and
 * stays: every other Advanced group, the strip's own Build screens, and the
 * documents a key or dial already stores, which name nothing of Setups.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { stripGroupOf } from "../src/strip/settings";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PLUGIN = path.join(ROOT, "com.lawrensen.hwinfo.sdPlugin");
const UI = path.join(PLUGIN, "ui");
const read = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), "utf8");
const ui = (name: string): string => readFileSync(path.join(UI, name), "utf8");

/** Every file under `dir`, with its path from the repo root, forward slashes. */
function filesUnder(dir: string): string[] {
	return readdirSync(path.join(ROOT, dir), { withFileTypes: true, recursive: true })
		.filter((entry) => entry.isFile())
		.map((entry) => path.relative(ROOT, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"));
}

describe("the panels have no Setups", () => {
	for (const file of ["sensor-reading.html", "sensor-dial.html"]) {
		it(`${file} has no Setups fold, control, string or script`, () => {
			assert.doesNotMatch(ui(file), /sec-setups|id="setups-|pi\.setups\.|pi-recipes\.js|setups\.html/);
		});

		it(`${file} keeps every other Advanced group, in order`, () => {
			const advanced = ui(file).slice(ui(file).indexOf(`id="sec-advanced"`));
			const groups = [...advanced.matchAll(/<details class="hw-sub" id="([^"]+)"/g)].map((match) => match[1]);
			assert.deepEqual(groups, ["sec-shared", "sec-connection", "sec-links", "sec-calc", "sec-support", "sec-config"]);
		});
	}

	it("the Strip section keeps its own Build screens", () => {
		assert.match(ui("sensor-dial.html"), /id="strip-build"/);
		assert.match(ui("pi-strings.js"), /"buildLink": "Build screens"/);
	});

	it("no panel file is left behind: no module, no style, no shell call, no string", () => {
		assert.equal(existsSync(path.join(UI, "pi-recipes.js")), false, "ui/pi-recipes.js ships");
		assert.doesNotMatch(ui("pi.css"), /hw-setup-|Advanced > Setups/);
		assert.doesNotMatch(ui("pi-shell.js"), /applyGlobalFields|Setups/);
		assert.doesNotMatch(ui("pi-strings.js"), /"setups"|"setupToApply"/);
		assert.doesNotMatch(read("src", "i18n-catalog.ts"), /\bsetups:|setupToApply/);
	});

	it("the help budget measures no Setups fold", () => {
		assert.doesNotMatch(read("scripts", "fixtures", "pi-help-baseline.json"), /sec-setups/);
	});
});

describe("the plugin has no Setups code", () => {
	it("src/recipes and the settings field registry only it read are gone", () => {
		assert.equal(existsSync(path.join(ROOT, "src", "recipes")), false, "src/recipes is there");
		assert.equal(existsSync(path.join(ROOT, "src", "settings-keys.ts")), false, "src/settings-keys.ts is there");
	});

	it("nothing in src, scripts or test reaches for it", () => {
		const self = "test/setups-parked.test.ts";
		const reaches = [...filesUnder("src"), ...filesUnder("scripts"), ...filesUnder("test")]
			.filter((file) => /\.(ts|mjs)$/.test(file) && file !== self)
			.filter((file) => /recipes\/(apply|cells|export|plan|ports|recipe-format|service)|settings-keys|registerRecipe|handleRecipeRequest|writeFromRecipe|recipeApply|hwinfoRecipe/.test(read(file)));
		assert.deepEqual(reaches, []);
	});
});

describe("the package and the suites have no Setups", () => {
	it("no bundled starter ships, and the pack contract lists none", () => {
		assert.equal(existsSync(path.join(PLUGIN, "recipes")), false, "the plugin holds a recipes folder");
		assert.doesNotMatch(read("scripts", "lib", "pack-contract.mjs"), /recipes\/|pi-recipes/);
	});

	it("no suite runs it", () => {
		const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
		assert.equal(scripts["e2e:recipes"], undefined, "package.json has e2e:recipes");
		assert.doesNotMatch(scripts.test ?? "", /test\/(recipes|pi-recipes|settings-keys)/);
		assert.equal(existsSync(path.join(ROOT, "scripts", "e2e-recipes.mjs")), false, "scripts/e2e-recipes.mjs is there");
		assert.doesNotMatch(read("scripts", "hygiene.mjs"), /e2e:recipes/);
		assert.doesNotMatch(read("AGENTS.md"), /e2e:recipes/);
	});
});

describe("the docs name no Setups", () => {
	it("the page and its nav link are gone", () => {
		assert.equal(existsSync(path.join(ROOT, "docs", "setups.md")), false, "docs/setups.md is there");
		assert.doesNotMatch(read("docs", "_data", "navigation.yml"), /setups/i);
	});

	// docs/legacy is the 1.7 site as it shipped and stays as it is. A plain
	// "setup" (HWiNFO setup steps, a strip's setup) is another word.
	const pages = readdirSync(path.join(ROOT, "docs"), { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => `docs/${entry.name}`);
	for (const file of ["README.md", ...pages]) {
		it(`${file} never names the feature or links its page`, () => {
			assert.doesNotMatch(read(file), /\bSetups\b|setups\.(md|html)|Setup to apply|Copy this deck's setup/);
		});
	}

	it("the 1.8 changelog entry never names it", () => {
		const changelog = read("CHANGELOG.md").replace(/\r\n/g, "\n");
		const start = changelog.indexOf("## 1.8.0.0 - ");
		const end = changelog.indexOf("\n## 1.7.1.0 - ", start);
		assert.ok(start >= 0 && end > start, "the CHANGELOG has its 1.8.0.0 and 1.7.1.0 entries");
		assert.doesNotMatch(changelog.slice(start, end), /\bSetups\b/);
	});
});

describe("a stored document does not depend on Setups", () => {
	// What a Setups Apply wrote is the action's plain settings: the target's
	// document with the setup's fields over it, no field of its own
	// (composeDocument, on branch park/1.8-before-cuts). A document that
	// came that way on a 1.8 candidate reads as any other.
	it("a dial's strip copy reads as a strip", () => {
		const strip = stripGroupOf({ v: 1, id: "0123456789abcdef0123456789abcdef", rev: 2, joined: true, config: { layout: "whole", encoders: 4, window: "5m", background: "clear", looksGen: 3, panes: [{ style: "trend", series: [{ key: "f0000300:0:1000000" }] }, { style: "trend", series: [] }] } });
		assert.ok(strip !== undefined);
		assert.equal(strip.config.layout, "whole");
		assert.equal(strip.config.background, "clear");
	});
});
