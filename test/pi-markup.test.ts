/**
 * Static gates on the shipped panel markup. An aria-describedby target is
 * read out for its content, unless it carries its own aria-label or
 * aria-labelledby: the accessible description then takes that name instead,
 * so a screen reader heard "What the dial does now" for the Gestures select
 * rather than the gesture map written under it (RC review PI-03).
 */
import { ART_STARS, ART_TONES, artStarsOf, artToneOf } from "../src/ui/deck-art";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { pressBehaviorOf } from "../src/detail/detail-settings";

const UI_DIR = fileURLToPath(new URL("../com.lawrensen.hwinfo.sdPlugin/ui/", import.meta.url));

describe("a dial in a strip", () => {
	const dial = readFileSync(join(UI_DIR, "sensor-dial.html"), "utf8");

	it("Strip Link ID is the last fold of the strip's own controls, past More", () => {
		const more = dial.indexOf('id="sec-stripmore"');
		const link = dial.indexOf('id="sec-striplink"');
		const bar = dial.indexOf('id="strip-bar"');
		assert.ok(more > 0 && more < link && link < bar, JSON.stringify({ more, link, bar }));
	});

	it("a band row's reading takes its own row, so Warn at and Critical at share the next", () => {
		assert.match(readFileSync(join(UI_DIR, "pi.css"), "utf8"), /\.hw-strip-band > select \{\s*grid-column: 1 \/ -1;/);
	});

	it("Brief gaps is one select, last in that fold, and says it is the strip's", () => {
		assert.equal((dial.match(/data-l10n="pi\.strip\.briefGaps"/g) ?? []).length, 1);
		assert.doesNotMatch(dial, /sp[01]-gap-mode/);
		const body = dial.slice(dial.indexOf('id="strip-more-body"'), dial.indexOf('id="sec-striplink"'));
		const field = body.slice(body.indexOf('id="strip-gap-mode-item"'));
		assert.ok(body.indexOf('id="sp1-extra"') < body.indexOf('id="strip-gap-mode-item"'));
		assert.match(field, /<label for="strip-gap-mode">.*data-l10n="pi\.strip\.thisStrip">This strip<\/span><\/label>/);
		assert.deepEqual([...field.matchAll(/<option value="(\w+)" data-l10n="[^"]+">([^<]+)</g)].map((x) => [x[1], x[2]]), [["connect", "Connect"], ["mark", "Connect in color"], ["gaps", "Leave gaps"]]);
		assert.doesNotMatch(field, /hw-help|hw-hint/);
	});

	it("the fold past the readings is named for what it holds", () => {
		assert.match(dial, /<details class="hw-sub" id="sec-stripmore">\s*<summary><span class="hw-sub-title" data-l10n="pi\.strip\.scaleAndAlerts">Scale and alerts<\/span><span class="hw-sec-sum" id="strip-more-sum"><\/span><\/summary>/);
	});

	it("the first graph's Filter and Unit rows can hold the sensor reload, one row like the search's", () => {
		assert.match(dial, /<div class="hw-picker"><input id="sp0-filter"[^>]*\/><\/div>/);
		assert.match(dial, /<div class="hw-picker"><select id="sp0-unit"[^>]*><\/select><\/div>/);
		assert.match(readFileSync(join(UI_DIR, "pi.css"), "utf8"), /\.hw-picker > select \{\s*flex: 1 1 0;/);
	});

	it("the reload follows the field the first graph's readings go by, so a screen with no search has it too", () => {
		assert.match(readFileSync(join(UI_DIR, "pi-strip.js"), "utf8"), /model\.readingsFieldOf\(working\.panes\[0\]\)/);
	});

	it("Reading, Alerts and Controls step aside, so no line says they wait", () => {
		assert.doesNotMatch(readFileSync(join(UI_DIR, "pi-strip.js"), "utf8"), /Kept, unused/);
		assert.doesNotMatch(readFileSync(join(UI_DIR, "pi.css"), "utf8"), /hw-strip-dormant|hw-dormant/);
	});

	it("the Control key's Link ID help names no section of another panel", () => {
		assert.match(readFileSync(join(UI_DIR, "control.html"), "utf8"), /<span id="target-text">Steers only the dials with this Link ID\.<\/span>/);
	});
});

describe("the panel's field style", () => {
	it("takes a search field too, so it is as tall as its neighbors and fits a narrow panel", () => {
		const css = readFileSync(join(UI_DIR, "pi.css"), "utf8");
		const rule = css.slice(css.indexOf(".hw-field select,"), css.indexOf("{", css.indexOf(".hw-field select,")));
		assert.match(rule, /\.hw-field input\[type="search"\]/);
	});
});

describe("panel descriptions are read for their content", () => {
	const panels = readdirSync(UI_DIR).filter((name) => name.endsWith(".html"));

	it("enumerates the shipped panels", () => {
		assert.ok(panels.length >= 4, `expected the shipped panels under ui/, found ${panels.length}`);
	});

	for (const panel of panels) {
		it(`${panel}: every aria-describedby target exists and has no name of its own`, () => {
			const html = readFileSync(join(UI_DIR, panel), "utf8");
			for (const [, ids] of html.matchAll(/aria-describedby="([^"]*)"/g)) {
				for (const id of (ids ?? "").split(/\s+/).filter((part) => part !== "")) {
					const tags = [...html.matchAll(new RegExp(String.raw`<[a-z][\w-]*\b[^>]*\bid="${id}"[^>]*>`, "g"))].map((m) => m[0]);
					assert.equal(tags.length, 1, `${panel}: aria-describedby names #${id}, found ${tags.length} elements with that id`);
					assert.doesNotMatch(tags[0] as string, /\baria-label(?:ledby)?=/, `${panel}: #${id} describes a control but carries its own name: ${tags[0]}`);
				}
			}
		});
	}
});

describe("the Control key's commands", () => {
	const html = readFileSync(join(UI_DIR, "control.html"), "utf8");

	it("every offered command is one the plugin accepts, and every Strip command is offered", async () => {
		const { isControlCommand, isStripCommand } = await import("../src/commands");
		const select = /<select id="f-command"([^>]*)>([\s\S]*?)<\/select>/.exec(html);
		assert.ok(select, "the Command select is in the Control panel");
		const values = [...(select[2] as string).matchAll(/<option value="([^"]*)">/g)].map((m) => m[1] as string);
		for (const value of values) assert.ok(isControlCommand(value), `${value} is a Control command`);
		const strip = values.filter((value) => isControlCommand(value) && isStripCommand(value));
		assert.deepEqual(strip, ["stripLive", "stripInspect", "stripToggleInspect", "stripWindowNext", "stripWindowPrev", "stripSeriesNext", "stripSeriesPrev", "stripScreenNext", "stripScreenPrev", "stripScreenFirst"]);
		assert.equal(new Set(values).size, values.length, "no command offered twice");
	});
});

describe("the dial's Background controls", () => {
	const html = readFileSync(join(UI_DIR, "sensor-dial.html"), "utf8");

	it("the select saves dialBackground with the exact values the plugin reads, Default (the shared look) first", async () => {
		const { DIAL_BACKGROUNDS, dialBackgroundOf, ownBackgroundOf } = await import("../src/ui/dial-background");
		const select = /<select id="f-background"([^>]*)>([\s\S]*?)<\/select>/.exec(html);
		assert.ok(select, "the Background select is in the dial panel");
		assert.match(select[1] as string, /\bdata-setting="dialBackground"/);
		assert.match(select[1] as string, /\bdata-default=""/);
		const values = [...(select[2] as string).matchAll(/<option value="([^"]*)"[^>]*>/g)].map((m) => m[1]);
		assert.deepEqual(values, ["", ...DIAL_BACKGROUNDS]);
		assert.equal(ownBackgroundOf(""), null, "Default saves the empty value, which follows the shared look");
		for (const value of values.slice(1)) assert.equal(dialBackgroundOf(value), value, `the plugin reads ${value} as itself`);
	});

	it("Words in the accent color is an unbound select with Default, On and Off, so only a user's pick saves it", () => {
		const select = /<select id="f-accent-words"([^>]*)>([\s\S]*?)<\/select>/.exec(html);
		assert.ok(select, "the select is in the dial panel");
		assert.doesNotMatch(select[1] as string, /data-setting=/, "the sdpi binder would save the option text, not the boolean the plugin reads");
		assert.deepEqual([...(select[2] as string).matchAll(/<option value="([^"]*)"[^>]*>([^<]*)/g)].map((m) => [m[1], m[2]]), [["", "Off (shared)"], ["on", "On"], ["off", "Off"]]);
	});

	it("the Sky is two unbound selects in the Words slot, Stars and Sky color, a pair of fields under Background, each Default then the exact names the plugin reads; Shared defaults holds the same pair in the slot under its Background", () => {
		assertSkyMarkup(html);
	});

	it("every Default option names the value it follows first, then (shared); Shared defaults gives Background the full width", () => {
		assertValueFirstDefaults(html);
	});
});

describe("the key's Background controls", () => {
	const html = readFileSync(join(UI_DIR, "sensor-reading.html"), "utf8");

	it("the select in the Display section saves keyBackground with the exact values the plugin reads, Default (the shared look) first", async () => {
		const { keyBackgroundOf } = await import("../src/ui/key-background");
		const { DIAL_BACKGROUNDS, ownBackgroundOf } = await import("../src/ui/dial-background");
		const display = /<details class="hw-sec" id="sec-display"[\s\S]*?<\/details>\s*<details class="hw-sec" id="sec-alerts"/.exec(html)?.[0] ?? "";
		const select = /<select id="f-background"([^>]*)>([\s\S]*?)<\/select>/.exec(display);
		assert.ok(select, "the Background select is in the key panel's Display section");
		assert.match(select[1] as string, /\bdata-setting="keyBackground"/);
		assert.match(select[1] as string, /\bdata-default=""/);
		const values = [...(select[2] as string).matchAll(/<option value="([^"]*)"[^>]*>/g)].map((m) => m[1]);
		assert.deepEqual(values, ["", ...DIAL_BACKGROUNDS]);
		assert.equal(ownBackgroundOf(""), null, "Default saves the empty value, which follows the shared look");
		for (const value of values.slice(1)) assert.equal(keyBackgroundOf(value), value, `the plugin reads ${value} as itself`);
	});

	it("Words in the accent color is an unbound select with Default, On and Off, so only a user's pick saves it", () => {
		const select = /<select id="f-accent-words"([^>]*)>([\s\S]*?)<\/select>/.exec(html);
		assert.ok(select, "the select is in the key panel");
		assert.doesNotMatch(select[1] as string, /data-setting=/, "the sdpi binder would save the option text, not the boolean the plugin reads");
		assert.deepEqual([...(select[2] as string).matchAll(/<option value="([^"]*)"[^>]*>([^<]*)/g)].map((m) => [m[1], m[2]]), [["", "Off (shared)"], ["on", "On"], ["off", "Off"]]);
	});

	it("the Sky is two unbound selects in the Words slot, Stars and Sky color, a pair of fields under Background, each Default then the exact names the plugin reads; Shared defaults holds the same pair in the slot under its Background", () => {
		assertSkyMarkup(html);
	});

	it("every Default option names the value it follows first, then (shared); Shared defaults gives Background the full width", () => {
		assertValueFirstDefaults(html);
	});
});

/** The Sky's markup on a key or dial panel (src/ui/deck-art.ts ART_STARS,
 * ART_TONES): on the action, Stars and Sky color are unbound selects (only
 * a person's pick writes), Default first, a pair of label-over fields
 * (hw-row2) hidden until an art look is chosen; in Shared defaults, the
 * same names with no Default, the same pair in the one slot under the
 * full-width Background (Words, a checkbox, takes that slot on the
 * see-through looks), hidden until it is offered. */
function assertSkyMarkup(html: string): void {
	const optionsOf = (id: string): { attrs: string; values: string[] } => {
		const select = new RegExp(`<select id="${id}"([^>]*)>([\\s\\S]*?)</select>`).exec(html);
		assert.ok(select, `${id} is in the panel`);
		return { attrs: select[1] as string, values: [...(select[2] as string).matchAll(/<option value="([^"]*)"[^>]*>/g)].map((m) => m[1] as string) };
	};
	const stars = optionsOf("f-art-stars");
	const tone = optionsOf("f-art-sky-color");
	for (const own of [stars, tone]) assert.doesNotMatch(own.attrs, /data-setting=/, "only a person's pick writes it");
	assert.deepEqual(stars.values, ["", ...ART_STARS]);
	assert.deepEqual(tone.values, ["", ...ART_TONES]);
	for (const value of stars.values.slice(1)) assert.equal(artStarsOf(value), value);
	for (const value of tone.values.slice(1)) assert.equal(artToneOf(value), value);
	assert.match(html, /<div class="hw-row2" id="art-sky" hidden>/, "a pair of fields, hidden until an art look is chosen");
	const block = /id="art-sky" hidden>((?:[\s\S]*?<\/select>\s*<\/div>){2})\s*<\/div>/.exec(html)?.[1] ?? "";
	assert.ok(block.includes('id="f-art-stars"') && block.includes('id="f-art-sky-color"'), "both in the one block");
	assert.deepEqual([...block.matchAll(/<div class="hw-field">\s*<label for="([^"]+)"/g)].map((m) => m[1]), ["f-art-stars", "f-art-sky-color"], "label over select, one field each");
	assert.deepEqual(optionsOf("shared-stars").values, [...ART_STARS]);
	assert.deepEqual(optionsOf("shared-sky-color").values, [...ART_TONES]);
	const rows = /<div class="hw-field">\s*<label for="shared-background"([\s\S]*?)<div class="hw-row2" id="shared-sky-item" hidden>([\s\S]*?)<div class="hw-status" id="own-looks"/.exec(html);
	assert.ok(rows, "the Sky row comes right after the Background field and Words, before the count line");
	const [looks, skyRow] = [rows[1] as string, rows[2] as string];
	assert.match(looks, /<\/select>\s*<\/div>\s*<label class="hw-check" id="shared-words-item" hidden><input type="checkbox" id="shared-accent-words" \/><span data-l10n="pi\.sharedLooks\.wordsLabel">Words in the accent color<\/span><\/label>\s*$/, "a full-width Background, then Words alone in the slot under it");
	assert.ok(looks.split("<select").length === 2, "Background is the one select before the slot");
	const fields = [...skyRow.matchAll(/<div class="hw-field">\s*<label for="([^"]+)"/g)].map((m) => m[1]);
	assert.deepEqual(fields, ["shared-stars", "shared-sky-color"], "Stars, then Sky color, one field each");
	// The labels: three amounts, and the stored warm and cool show as Warmer
	// and Cooler (true against every theme's own hue), on the action and in
	// Shared defaults alike.
	const labelsOf = (id: string): string[][] => [...(new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`).exec(html)?.[1] ?? "").matchAll(/<option value="([^"]+)"[^>]*>([^<]*)/g)].map((m) => [m[1] as string, m[2] as string]);
	for (const id of ["f-art-stars", "shared-stars"]) assert.deepEqual(labelsOf(id), [["all", "All"], ["few", "Few"], ["off", "Off"]], id);
	for (const id of ["f-art-sky-color", "shared-sky-color"]) assert.deepEqual(labelsOf(id), [["theme", "Theme"], ["deep", "Deep"], ["warm", "Warmer"], ["cool", "Cooler"], ["mono", "Mono"]], id);
	// One line under Background on the art looks, hidden until it adds a
	// fact (on Paper the art draws no sky), and the Background select and
	// the Sky's two settings name it. The markup names every line a control
	// can be described by; pi-common.js (renderLook) keeps only the lines
	// that show, which e2e:pi-panels reads from the accessibility tree.
	assert.match(html, /<p class="hw-help" id="art-help" data-l10n="pi\.keyBackground\.artPaper" hidden>Paper draws no sky; a dark theme shows it\.<\/p>/);
	assert.match(html, /<select id="f-background" [^>]*aria-describedby="background-help art-help">/);
	for (const id of ["f-art-stars", "f-art-sky-color"]) assert.match(html, new RegExp(`<select id="${id}" aria-describedby="art-help">`), id);
	const bgField = /<select id="f-background"[\s\S]*?<\/select>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
	assert.deepEqual([...bgField.matchAll(/<p class="hw-help" id="([^"]+)"/g)].map((m) => m[1]), ["background-help", "art-help"], "the help lines under Background, in order: one on the art looks");
}

/** The Default options of Display (Text color, Background, Words, Stars,
 * Sky color) name the value they follow first, then "(shared)", in one
 * form; the markup holds the text for nothing stored and pi-common.js
 * (sharedValue) rewrites it for the shared value at runtime. The Theme
 * band keeps "Default (shared: X)", which the runtime writes, never the
 * markup. In Shared defaults, Background is a full-width field, so its
 * select keeps one width whichever slot shows under it. */
function assertValueFirstDefaults(html: string): void {
	const defaultOf = (id: string): string | undefined => new RegExp(`<select id="${id}"[^>]*>\\s*<option value="">([^<]*)</option>`).exec(html)?.[1];
	assert.deepEqual(
		["f-text", "f-background", "f-accent-words", "f-art-stars", "f-art-sky-color"].map(defaultOf),
		["Theme text (shared)", "Theme (shared)", "Off (shared)", "All (shared)", "Theme (shared)"]
	);
	assert.doesNotMatch(html, /Default \(shared:/, "no option in the markup reads Default (shared: X)");
	assert.match(html, /<div class="hw-field">\s*<label for="shared-background"/);
	assert.doesNotMatch(html, /<div class="hw-row2">\s*<div class="hw-field">\s*<label for="shared-background"/, "the shared Background shares its row with nothing");
	assert.doesNotMatch(html, /id="shared-words-item"[^>]*style=/, "Words in Shared defaults is shown or hidden, never kept as an invisible half");
}

/** The visible text of a markup fragment: tags dropped, spaces collapsed. */
const textOf = (fragment: string): string => fragment.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

/** Every control a panel binds to a stored setting (data-setting), keyed by
 * the setting and its store (data-global is the shared settings, the rest
 * the action's own), with the label a person reads for it: the <label
 * for> that names it, else the <label> it sits in. */
function boundControls(panel: string): { key: string; label: string | null }[] {
	const html = readFileSync(join(UI_DIR, panel), "utf8");
	const out: { key: string; label: string | null }[] = [];
	for (const match of html.matchAll(/<(?:input|select|textarea)\b([^>]*)>/g)) {
		const attrs = match[1] as string;
		const setting = /\bdata-setting="([^"]*)"/.exec(attrs)?.[1];
		if (setting === undefined) continue;
		const key = /\bdata-global\b/.test(attrs) ? `shared ${setting}` : setting;
		const id = /\bid="([^"]*)"/.exec(attrs)?.[1];
		const named = id === undefined ? null : new RegExp(String.raw`<label\b[^>]*\bfor="${id}"[^>]*>([\s\S]*?)</label>`).exec(html);
		if (named !== null) {
			out.push({ key, label: textOf(named[1] as string) });
			continue;
		}
		const before = html.slice(0, match.index);
		const open = before.lastIndexOf("<label");
		const wrapped = open > before.lastIndexOf("</label>");
		out.push({ key, label: wrapped ? textOf(html.slice(open, html.indexOf("</label>", match.index))) : null });
	}
	return out;
}

describe("one label per stored setting (cohesion rule 1)", () => {
	const panels = readdirSync(UI_DIR).filter((name) => name.endsWith(".html"));
	// A setting listed here may still carry two labels, each with its reason.
	const TWO_LABELS_UNTIL: Record<string, string> = {
		// "Label on the key" and "Title on the dial": the dial's Title words
		// change with Label when the dial moves on, in 1.9 (naming table).
		label: "1.9"
	};

	it("every bound control has a label to read", () => {
		for (const panel of panels) {
			for (const { key, label } of boundControls(panel)) assert.ok(label !== null && label !== "", `${panel}: ${key} has no <label for> and sits in no <label>`);
		}
	});

	it("a stored setting reads the same on every panel that shows it", () => {
		const labels = new Map<string, Map<string, string>>();
		for (const panel of panels) {
			for (const { key, label } of boundControls(panel)) {
				if (label === null) continue;
				const byLabel = labels.get(key) ?? new Map<string, string>();
				if (!byLabel.has(label)) byLabel.set(label, panel);
				labels.set(key, byLabel);
			}
		}
		const split = [...labels].filter(([key, byLabel]) => byLabel.size > 1 && !Object.hasOwn(TWO_LABELS_UNTIL, key));
		assert.deepEqual(split.map(([key, byLabel]) => `${key}: ${[...byLabel].map(([label, panel]) => `"${label}" (${panel})`).join(", ")}`), []);
		// An allowance that no longer splits is stale: drop it.
		for (const key of Object.keys(TWO_LABELS_UNTIL)) assert.ok((labels.get(key)?.size ?? 0) > 1, `${key} reads the same everywhere now; drop it from TWO_LABELS_UNTIL`);
	});

	it("a shared default's help reads the same on the key and the dial", () => {
		const helps = (panel: string): Map<string, string> => {
			const html = readFileSync(join(UI_DIR, panel), "utf8");
			const out = new Map<string, string>();
			for (const match of html.matchAll(/<(?:input|select|textarea)\b([^>]*\bdata-global\b[^>]*)>/g)) {
				const setting = /\bdata-setting="([^"]*)"/.exec(match[1] as string)?.[1];
				const ids = /\baria-describedby="([^"]*)"/.exec(match[1] as string)?.[1];
				if (setting === undefined || ids === undefined) continue;
				const text = ids
					.split(/\s+/)
					.map((id) => new RegExp(String.raw`<p\b[^>]*\bid="${id}"[^>]*>([\s\S]*?)</p>`).exec(html)?.[1])
					.map((p) => (p === undefined ? "" : textOf(p)))
					.join(" ");
				out.set(setting, text);
			}
			return out;
		};
		const key = helps("sensor-reading.html");
		const dial = helps("sensor-dial.html");
		assert.ok(key.size >= 3, `the key panel's shared defaults with help, found ${key.size}`);
		assert.deepEqual([...key.keys()].sort(), [...dial.keys()].sort(), "the same shared defaults carry help on both panels");
		for (const [setting, text] of key) assert.equal(text, dial.get(setting), `shared ${setting}: the key and the dial say it differently`);
	});
});

describe("the key's snooze help matches what a press does while it is armed (K2-5)", () => {
	const html = readFileSync(join(UI_DIR, "sensor-reading.html"), "utf8");
	const help = (/<p class="hw-help" id="snooze-help"[^>]*>([^<]*)<\/p>/.exec(html)?.[1] ?? "").trim();
	const select = /<select id="f-press"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] ?? "";
	const options = [...select.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => ({ value: m[1] as string, text: m[2] as string }));

	it("never promises a hold on every key: a hold does only what the Press choice sets for it", () => {
		assert.ok(help !== "", "the snooze help is present");
		assert.doesNotMatch(help, /A hold keeps its action/, "an unconditional promise is false for a press choice that has no hold");
		assert.match(help, /what Press sets for it/);
	});

	it("the Press choices the help points at are exactly the ones whose hold does something", () => {
		assert.equal(options.length, 3);
		for (const { value, text } of options) {
			const hasHold = pressBehaviorOf({ pressBehavior: value }) === "tap-cycle-hold-details";
			assert.equal(/\bhold\b/.test(text), hasHold, `${value}: "${text}"`);
		}
	});
});

describe("Unit and decimals per reading sits under Decimals in both panels (issue #59)", () => {
	for (const panel of ["sensor-reading.html", "sensor-dial.html"]) {
		const html = readFileSync(join(UI_DIR, panel), "utf8");
		it(`${panel}: a closed sub-section right after the Decimals row, with its summary and rows`, () => {
			const decimals = html.indexOf('id="f-decimals"');
			const formats = html.indexOf('<details class="hw-sub" id="sec-formats">');
			assert.ok(decimals > 0 && formats > decimals, "after Decimals");
			assert.equal((html.slice(decimals, formats).match(/<details/g) ?? []).length, 0, "nothing folds between them");
			assert.doesNotMatch(html.slice(formats, formats + 60), /\bopen\b/, "closed by default");
			assert.match(html, /data-summary="formats"/);
			assert.match(html, /<div id="format-rows" class="hw-format-rows" role="group" aria-label="[^"]+"/);
			assert.match(html, /id="formats-note" aria-live="polite" hidden/);
		});
		it(`${panel}: the help says what the setting does first, in at most two sentences (issue #59 G5)`, () => {
			const help = (/<p class="hw-help" id="formats-help"[^>]*>([^<]*)<\/p>/.exec(html)?.[1] ?? "").trim();
			assert.ok(help.startsWith("A unit picked here stays at any value."), help);
			assert.ok((help.match(/\.(\s|$)/g) ?? []).length <= 2, help);
			assert.match(html, /<p class="hw-help" id="formats-help" data-l10n="pi\.formats\.staysAtAnyValue">/, "its catalog mark names what it says");
		});
	}
	it("limit help says limits stay in HWiNFO's unit even with a fixed unit", () => {
		assert.match(readFileSync(join(UI_DIR, "sensor-reading.html"), "utf8"), /id="alerts-help">[^<]*HWiNFO's number and unit, even where the key shows another/);
		const dial = readFileSync(join(UI_DIR, "sensor-dial.html"), "utf8");
		assert.match(dial, /id="alerts-help">[^<]*HWiNFO's number and unit, even where the dial shows another/);
		assert.match(dial, /id="bar-help">[^<]*HWiNFO's unit for the reading/);
	});
});

// Help never grows (the owner, 2026-10-25: panel help "way more minimal, no
// increase from before"): the strip's Scale from and Scale to carry no
// standing help line. Their placeholder Auto and the unit tag in each label
// say it; docs/strip-display.md explains the automatic scale. One short
// line shows only while stored ends do not apply to the graph.
describe("the strip's Scale from and Scale to carry no standing help line", () => {
	const html = readFileSync(join(UI_DIR, "sensor-dial.html"), "utf8");
	for (const pane of ["sp0", "sp1"]) {
		it(`${pane}: the only line under the fields is the not-used one, hidden until it applies, one short sentence`, () => {
			const tags = [...html.matchAll(new RegExp(String.raw`<p\b[^>]*\bid="${pane}-scale-help"[^>]*>([^<]*)</p>`, "g"))];
			assert.equal(tags.length, 1, `one #${pane}-scale-help`);
			const [tag, text] = [tags[0]?.[0] ?? "", (tags[0]?.[1] ?? "").trim()];
			assert.match(tag, /data-l10n="pi\.strip\.scaleNotUsed"/);
			assert.match(tag, /\bhidden\b/, "hidden as the panel opens");
			assert.ok((text.match(/\.(\s|$)/g) ?? []).length === 1 && text.length <= 48, `one short sentence: ${text}`);
			const row = html.indexOf(`id="${pane}-scale-row"`);
			const bands = html.indexOf(`id="${pane}-bands-label"`);
			assert.equal((html.slice(row, bands).match(/class="hw-help"/g) ?? []).length, 1, "no other help between the fields and Alert bands");
			assert.match(html.slice(row, bands), new RegExp(String.raw`id="${pane}-min"[^>]*placeholder="Auto"`));
		});
	}
});
