/**
 * Localization infrastructure (English only in 1.8.0, docs/localization.md):
 * the language file the Stream Deck app reads (en.json) says exactly what
 * the manifest says, because a language file overrides the manifest in its
 * language; the catalog, en.json and ui/pi-strings.js agree; every key the
 * code and the panels ask for exists, and every catalog key is asked for;
 * the panel markup's English is the catalog's English; and t() falls back
 * to English whatever the lookup does.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { JsonObject } from "@elgato/utils";
import { I18nProvider } from "@elgato/utils/i18n";

import { enJson, piStringsJs } from "../scripts/lib/l10n-files";
import { catalogKeys, englishOf, pseudoLocalize, setTranslator, t, type CatalogKey } from "../src/i18n";
import type { PanelKey } from "../src/i18n-catalog";
import { EN, PANEL } from "../src/i18n-catalog";
import { STAT_BADGE } from "../src/ui/format";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PLUGIN = join(ROOT, "com.lawrensen.hwinfo.sdPlugin");
const UI = join(PLUGIN, "ui");
const read = (...parts: string[]): string => readFileSync(join(...parts), "utf8");

type ActionStrings = { Name: string; Tooltip: string; Encoder?: { TriggerDescription?: Record<string, string> } };
type Manifest = { Name: string; Description: string; Actions: Array<ActionStrings & { UUID: string }> };
const manifest = JSON.parse(read(PLUGIN, "manifest.json")) as Manifest;
const en = JSON.parse(read(PLUGIN, "en.json")) as Record<string, unknown>;

/** Every .ts file under src/, recursively. */
function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : []));
}

/** The text HTML shows for an attribute or text run: entities decoded,
 * white space collapsed. */
const shown = (raw: string): string => raw.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const PANELS = readdirSync(UI).filter((name) => name.endsWith(".html"));
const PANEL_SCRIPTS = readdirSync(UI).filter((name) => /^pi-[\w-]+\.js$/.test(name) && name !== "pi-strings.js");

/** [key, English as the markup writes it] for every data-l10n mark. */
function markupStrings(): Array<{ where: string; key: string; english: string }> {
	const out: Array<{ where: string; key: string; english: string }> = [];
	for (const panel of PANELS) {
		const html = read(UI, panel);
		// data-l10n targets the leading text: the text right after the tag.
		for (const m of html.matchAll(/<\w+\b[^>]*\sdata-l10n="([^"]+)"[^>]*>([^<]*)/g)) out.push({ where: `${panel} text`, key: m[1] as string, english: m[2] as string });
		for (const [data, attribute] of [["data-l10n-placeholder", "placeholder"], ["data-l10n-aria-label", "aria-label"], ["data-l10n-title", "title"]] as const) {
			for (const m of html.matchAll(new RegExp(`<\\w+\\b[^>]*\\s${data}="([^"]+)"[^>]*>`, "g"))) {
				const value = new RegExp(`\\s${attribute}="([^"]*)"`).exec(m[0])?.[1];
				out.push({ where: `${panel} ${attribute}`, key: m[1] as string, english: value ?? "(no attribute)" });
			}
		}
	}
	return out;
}

/** [key, English] for every T("key", "English") call in a panel script. */
function scriptStrings(): Array<{ where: string; key: string; english: string }> {
	const out: Array<{ where: string; key: string; english: string }> = [];
	for (const file of PANEL_SCRIPTS) {
		for (const m of read(UI, file).matchAll(/\b(?:T|hwT)\("([^"]+)", "((?:[^"\\]|\\.)*)"/g)) out.push({ where: file, key: m[1] as string, english: JSON.parse(`"${m[2] as string}"`) as string });
	}
	return out;
}

afterEach(() => setTranslator(null));

describe("en.json, the Stream Deck language file", () => {
	it("is the generated file (npm run l10n) and pi-strings.js is too", () => {
		assert.equal(read(PLUGIN, "en.json"), enJson(manifest, EN), "en.json drifted: run npm run l10n");
		assert.equal(read(UI, "pi-strings.js"), piStringsJs(PANEL), "ui/pi-strings.js drifted: run npm run l10n");
	});

	it("holds every manifest string word for word, and nothing the manifest lacks", () => {
		assert.equal(en.Name, manifest.Name);
		assert.equal(en.Description, manifest.Description);
		const uuids = manifest.Actions.map((action) => action.UUID);
		assert.deepEqual(Object.keys(en), ["Name", "Description", ...uuids, "Localization"]);
		for (const action of manifest.Actions) {
			const entry = en[action.UUID] as ActionStrings;
			assert.equal(entry.Name, action.Name, `${action.UUID} Name`);
			assert.equal(entry.Tooltip, action.Tooltip, `${action.UUID} Tooltip`);
			assert.deepEqual(entry.Encoder?.TriggerDescription, action.Encoder?.TriggerDescription, `${action.UUID} TriggerDescription`);
			assert.deepEqual(Object.keys(entry), action.Encoder?.TriggerDescription === undefined ? ["Name", "Tooltip"] : ["Name", "Tooltip", "Encoder"]);
		}
	});

	it("keeps the Marketplace's 250-character Description, and names REALiX exactly where the manifest does", () => {
		const description = en.Description as string;
		assert.ok(description.length >= 250, `Description is ${description.length} characters`);
		// The REALiX non-affiliation line lives in the README and the
		// Marketplace listing (the copy validator checks both), not in the
		// manifest Description; a language file follows its manifest.
		assert.equal(/REALiX|not affiliated/i.test(description), /REALiX|not affiliated/i.test(manifest.Description));
	});

	it("carries the runtime catalog as its Localization block", () => {
		assert.deepEqual(en.Localization, JSON.parse(JSON.stringify(EN)));
	});

	it("answers every catalog key through the SDK's own lookup with the catalog's English", () => {
		// The provider class streamDeck.i18n is, fed the way the SDK's file
		// provider feeds it (the Localization block of <language>.json).
		const localization = en.Localization as JsonObject;
		const german: JsonObject = { face: { missing: { title: "Sensor fehlt" } } };
		const provider = new I18nProvider<"en" | "de" | "fr">("en", (language) => (language === "en" ? localization : language === "de" ? german : null));
		for (const key of catalogKeys()) assert.equal(provider.translate(key), englishOf(key), key);
		// A language without a key falls back to en.json, and one with it wins.
		assert.equal(provider.translate("face.missing.hint", "de"), "pick again");
		assert.equal(provider.translate("face.missing.title", "de"), "Sensor fehlt");
		assert.equal(provider.translate("face.missing.title", "fr"), "Sensor missing");
		assert.equal(provider.translate("no.such.key"), "no.such.key");
	});
});

describe("catalog completeness", () => {
	const runtimeKeys = catalogKeys();
	const piKeys = catalogKeys(PANEL);
	const panelEnglish = (key: string): string | undefined => englishOf(key, PANEL);

	it("every t() key in src exists, and every runtime key is used", () => {
		const used = new Set<string>();
		for (const file of sourceFiles(join(ROOT, "src"))) {
			for (const m of read(file).matchAll(/\bt\("([^"]+)"/g)) {
				assert.ok(englishOf(m[1] as string) !== undefined, `${file}: t("${m[1] as string}") is not in the catalog`);
				used.add(m[1] as string);
			}
		}
		for (const key of runtimeKeys) assert.ok(used.has(key), `${key} is in the catalog but no t() asks for it`);
	});

	it("every panel key exists, and every pi key is used by the markup or a panel script", () => {
		const used = new Set<string>();
		for (const { where, key } of [...markupStrings(), ...scriptStrings()]) {
			assert.ok(panelEnglish(key) !== undefined, `${where}: ${key} is not in the panel catalog`);
			used.add(key);
		}
		for (const key of piKeys) assert.ok(used.has(key), `${key} is in the catalog but nothing in ui/ uses it`);
	});

	it("the panel markup's English is the catalog's English", () => {
		const marks = markupStrings();
		assert.ok(marks.length >= 200, `expected the 1.8 sections' marks, found ${marks.length}`);
		for (const { where, key, english } of marks) {
			assert.ok(shown(english) !== "", `${where}: ${key} marks an element whose leading text is empty`);
			assert.equal(shown(english), panelEnglish(key), `${where}: ${key}`);
		}
	});

	it("Unit and decimals per reading, the key's and the dial's Background, their accent words and Sky, and the shared looks carry a mark on every fixed text", () => {
		/** The markup from the element opening at `start` to the first `end` after it. */
		const block = (html: string, start: string, end: string): string => {
			const at = html.indexOf(start);
			assert.ok(at >= 0, start);
			return html.slice(at, html.indexOf(end, at) + end.length);
		};
		/** Display's Background block (its label, select and two help
		 * lines), Words, and the Sky's two fields. */
		const looks = (html: string): string =>
			block(html, `<label for="f-background"`, `id="background-help"`) +
			block(html, `id="background-help"`, "</p>") +
			block(html, `<p class="hw-help" id="art-help"`, "</p>") +
			block(html, `<div class="hw-field hw-inline-field" id="accent-words"`, "</div>") +
			block(html, `<div class="hw-row2" id="art-sky"`, `<select id="f-art-sky-color"`) +
			block(html, `<select id="f-art-sky-color"`, "</select>");
		/** Shared defaults' Background, Words and Sky, to the count line. */
		const shared = (html: string): string => block(html, `<label for="shared-background"`, `<div class="hw-status" id="own-looks"`);
		const reading = read(UI, "sensor-reading.html");
		const dial = read(UI, "sensor-dial.html");
		const blocks: Array<[string, string]> = [
			["sensor-reading.html #sec-formats", block(reading, `<details class="hw-sub" id="sec-formats">`, "</details>")],
			["sensor-dial.html #sec-formats", block(dial, `<details class="hw-sub" id="sec-formats">`, "</details>")],
			["sensor-reading.html Background", looks(reading)],
			["sensor-dial.html Background", looks(dial)],
			["sensor-reading.html shared looks", shared(reading)],
			["sensor-dial.html shared looks", shared(dial)]
		];
		for (const [where, html] of blocks) {
			for (const m of html.matchAll(/<(label|option|span|p|button|summary)\b([^>]*)>([^<]*)/g)) {
				if ((m[3] as string).trim() === "") continue;
				// A Default option names the shared value at runtime (pi-common.js), as Text color's does.
				if (m[1] === "option" && /\svalue=""/.test(m[2] as string)) continue;
				assert.match(m[2] as string, /\sdata-l10n="/, `${where}: <${m[1]}> "${(m[3] as string).trim()}" has no data-l10n mark`);
			}
			for (const m of html.matchAll(/<\w+\b[^>]*\saria-label="[^"]+"[^>]*>/g)) assert.match(m[0], /\sdata-l10n-aria-label="/, `${where}: ${m[0]}`);
		}
	});

	it("each panel script's English fallback is the catalog's English", () => {
		const calls = scriptStrings();
		assert.ok(calls.length >= 25, `expected the panel scripts' strings, found ${calls.length}`);
		for (const { where, key, english } of calls) assert.equal(english, panelEnglish(key), `${where}: ${key}`);
	});

	it("every panel that loads pi-shell.js loads pi-strings.js right before it", () => {
		for (const panel of PANELS) {
			const html = read(UI, panel);
			if (!html.includes("pi-shell.js")) continue;
			assert.match(html, /<script src="pi-strings\.js\?v=[^"]+"><\/script>\s*<script src="pi-shell\.js\?v=[^"]+"><\/script>/, panel);
		}
	});

	it("keys are dotted paths of plain names, and values are non-empty with no em dash", () => {
		for (const key of [...catalogKeys(), ...catalogKeys(PANEL)]) {
			assert.match(key, /^[a-z]+(\.[A-Za-z][A-Za-z0-9]*)+$/, key);
			const value = (englishOf(key) ?? englishOf(key, PANEL)) as string;
			assert.ok(value.trim() !== "" && value === value.trim(), `${key} is empty or padded`);
			assert.doesNotMatch(value, /—/, `${key} carries an em dash`);
		}
	});
});

describe("t()", () => {
	it("is the catalog's English with no lookup installed", () => {
		assert.equal(t("face.missing.title"), "Sensor missing");
		assert.equal(t("sentence.sharedStale", { seconds: 42 }), "No new Shared Memory measurement evidence for 42s. Check HWiNFO and Shared Memory Support; a busy connection can also prevent reads.");
	});

	it("takes the lookup's answer, and keeps English for an echo, an empty answer, a non-string or a throw", () => {
		setTranslator((key) => (key === "face.missing.title" ? "Sensor fehlt" : key));
		assert.equal(t("face.missing.title"), "Sensor fehlt");
		assert.equal(t("face.missing.hint"), "pick again");
		setTranslator(() => "");
		assert.equal(t("face.missing.title"), "Sensor missing");
		setTranslator(() => 7);
		assert.equal(t("face.missing.title"), "Sensor missing");
		setTranslator(() => {
			throw new TypeError("registration info has no language");
		});
		assert.equal(t("face.missing.title"), "Sensor missing");
	});

	it("fills parameters once, keeps an unknown one, and never re-reads a filled value", () => {
		assert.equal(t("preview.stats", { min: "{max}", max: "2", avg: "3" }), "min {max} · max 2 · avg 3");
		assert.equal(t("preview.stats", { min: "1" }), "min 1 · max {max} · avg {avg}");
	});

	it("asks the lookup once per key until a new lookup is installed", () => {
		let asked = 0;
		setTranslator((key) => {
			asked++;
			return key;
		});
		for (let i = 0; i < 5; i++) t("badge.min");
		assert.equal(asked, 1);
		setTranslator(() => "MÍN");
		assert.equal(t("badge.min"), "MÍN");
	});

	it("the stat badges follow the active language and keep their shape", () => {
		assert.deepEqual(Object.keys(STAT_BADGE), ["current", "min", "max", "avg"]);
		assert.deepEqual([STAT_BADGE.current, STAT_BADGE.min, STAT_BADGE.max, STAT_BADGE.avg], ["", "MIN", "MAX", "AVG"]);
		setTranslator((key) => pseudoLocalize(englishOf(key) ?? key));
		assert.equal(STAT_BADGE.max, pseudoLocalize("MAX"));
		assert.ok(Object.isFrozen(STAT_BADGE));
	});
});

describe("pseudo-locale", () => {
	it("grows every catalog string by at least 40% with accented letters and keeps its parameters", () => {
		for (const key of [...catalogKeys(), ...catalogKeys(PANEL)]) {
			const english = (englishOf(key) ?? englishOf(key, PANEL)) as string;
			const pseudo = pseudoLocalize(english);
			assert.ok([...pseudo].length >= Math.ceil([...english].length * 1.4), `${key}: ${pseudo}`);
			assert.deepEqual(pseudo.match(/\{\w+\}/g), english.match(/\{\w+\}/g), key);
			if (/[A-Za-z]/.test(english.replace(/\{\w+\}/g, ""))) assert.notEqual(pseudo.replace(/[[\]~]/g, ""), english, key);
		}
	});

	it("keys the type system knows are the catalogs' keys", () => {
		const key: CatalogKey = "strip.chooseReadings";
		const panelKey: PanelKey = "pi.strip.makeTheStrip";
		assert.equal(englishOf(key), "Choose readings in the dial settings");
		assert.equal(englishOf(panelKey, PANEL), "Make the strip");
		assert.equal(englishOf(panelKey), undefined, "the plugin bundle carries no panel strings");
	});
});
