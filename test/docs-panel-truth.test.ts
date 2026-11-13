// The key and dial pages describe the shipped settings panels: which
// sections a panel has, which settings Shared defaults holds, and what the
// Advanced capture shows. Nothing held those words to the panel markup, so
// the 1.8 panels grew a shared Background and Words, four Advanced groups
// and a Strip section on the dial while the pages kept the 1.7.0 lists and
// the 1.7.0 captures. These checks read the shipped panel HTML and require
// the page to name what the panel shows.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const UI = path.join(ROOT, "com.lawrensen.hwinfo.sdPlugin", "ui");
const panel = (name: string): string => fs.readFileSync(path.join(UI, name), "utf8");
const page = (name: string): string => fs.readFileSync(path.join(ROOT, "docs", name), "utf8");

const decode = (text: string): string => text.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const names = (text: string, label: string): boolean => new RegExp(`(?<![\\w-])${escape(label)}(?![\\w-])`).test(text);

describe("the strip page and the 1.8 notes say what the strip draws", () => {
	const notes = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8").replace(/\s+/g, " ");
	const strip = page("strip-display.md");
	it("words on the see-through looks have small tabs behind them", () => {
		assert.doesNotMatch(strip, /with nothing behind them/);
		assert.doesNotMatch(notes, /with nothing behind them/);
		assert.match(strip, /small tab/);
	});
	it("the sensor list's reload has a place on a screen with no search", () => {
		assert.match(strip, /the sensor list's reload moves to the strip's \*\*Readings\*\* row \(beside \*\*Filter\*\* or \*\*Unit\*\* on a screen with no search\)/);
	});
	it("Events sets 15 minutes only where no other graph shares the window (startEvents)", () => {
		assert.doesNotMatch(strip, /Choosing Events sets the time window to 15 minutes in the same change/);
		assert.match(strip, /On a strip of one screen, or a half with its own window, choosing Events sets the time window to 15 minutes in the same change; otherwise the window stays as it is\./);
	});
	it("a brief gap draws straight across, so Ambient does not keep every gap", () => {
		assert.doesNotMatch(notes, /keeps gaps/);
	});
});

/** The markup of one Advanced group, from its details tag to the next group. */
function group(html: string, id: string): string {
	const start = html.indexOf(`<details class="hw-sub" id="${id}">`);
	assert.ok(start >= 0, `#${id} is in the panel`);
	const next = html.indexOf(`<details class="hw-sub"`, start + 1);
	return html.slice(start, next < 0 ? undefined : next);
}

/** The setting labels Shared defaults holds: each field's label, and a
 * check box that is a setting of its own (Words in the accent color, which
 * carries an id; Dim labels belongs to the custom text color). The Shared
 * custom text color well belongs to Text color (it opens on Custom color),
 * so the page covers it under Text color. With `shownAtFirst`, only the
 * fields a panel on the default Background shows (Words appears on Glass,
 * Tint and Outline). */
function sharedLabels(html: string, shownAtFirst = false): string[] {
	const block = group(html, "sec-shared");
	// Hidden at first: inside any div the panel opens hidden (the attribute
	// or visibility: hidden), its own field or a row around it (Stars and
	// Sky color, a row shown on the art looks only).
	const hiddenAtFirst = (index: number): boolean => {
		const open: boolean[] = [];
		for (const m of block.slice(0, index).matchAll(/<div\b([^>]*)>|<\/div>/g)) {
			if (m[0] === "</div>") open.pop();
			else open.push(/\shidden(?=[\s>=/]|$)|visibility: hidden/.test(m[1] ?? ""));
		}
		return open.includes(true);
	};
	const labels = [...block.matchAll(/<label for="([^"]+)"[^>]*>([^<]+)<\/label>|<span class="hw-label"[^>]*>([^<]+)<\/span>|<label class="hw-check" id="[^"]+"([^>]*)><input\b[^>]*><span\b[^>]*>([^<]+)<\/span><\/label>/g)]
		.filter((match) => match[1] !== "deck-text-color")
		.filter((match) => !shownAtFirst || !(hiddenAtFirst(match.index) || /\shidden(?=[\s>=/]|$)/.test(match[4] ?? "")))
		.map((match) => (match[2] ?? match[3] ?? match[5] ?? "").trim());
	assert.ok(labels.length >= 5, `Shared defaults labels found: ${labels.join(", ")}`);
	return labels;
}

/** The group titles inside a panel's Advanced section. */
function advancedGroups(html: string): string[] {
	const start = html.indexOf(`id="sec-advanced"`);
	assert.ok(start >= 0, "the panel has an Advanced section");
	const next = html.indexOf(`<details class="hw-sec"`, start);
	const block = html.slice(start, next < 0 ? undefined : next);
	return [...block.matchAll(/<span class="hw-sub-title"[^>]*>([^<]+)<\/span>/g)].map((match) => (match[1] ?? "").trim());
}

/** The top-level section titles of a panel. */
function sections(html: string): string[] {
	return [...html.matchAll(/<span class="hw-sec-title"[^>]*>([^<]+)<\/span>/g)].map((match) => (match[1] ?? "").trim());
}

/** The alt text of the image a page shows from this file. */
function altOf(markdown: string, file: string): string {
	const tag = new RegExp(`<img src="\\{\\{ '/assets/img/${escape(file)}' \\| relative_url \\}\\}"[^>]*\\balt="([^"]*)"`).exec(markdown);
	assert.ok(tag, `the page shows ${file}`);
	return decode(tag[1] ?? "");
}

describe("the key page's Shared defaults line names what the panels show", () => {
	const markdown = page("sensor-reading.md");
	const bullet = /^- \*\*Shared defaults:\*\* (.+)$/m.exec(markdown)?.[1];

	it("the Advanced reference has a Shared defaults line", () => {
		assert.ok(bullet, "docs/sensor-reading.md lists Shared defaults under Advanced");
	});

	// The dial page sends its readers to this same line for Shared defaults.
	for (const file of ["sensor-reading.html", "sensor-dial.html"]) {
		it(`every Shared defaults setting on ${file} is named`, () => {
			const missing = sharedLabels(panel(file)).filter((label) => !names(bullet ?? "", label));
			assert.deepEqual(missing, [], `docs/sensor-reading.md "Shared defaults: ${bullet}" leaves out what ${file} shows there`);
		});
	}
});

describe("the Advanced captures show the shipped Advanced section", () => {
	// The capture is shot with every Advanced group open and its description
	// says what the picture holds: a group or a Shared defaults setting the
	// panel has and the description does not name is one the picture lacks.
	for (const [doc, file, html] of [
		["sensor-reading.md", "pi-live-key-advanced.png", "sensor-reading.html"],
		["sensor-dial.md", "pi-live-dial-advanced.png", "sensor-dial.html"]
	] as const) {
		it(`${file} on docs/${doc} shows every group and shared setting of ${html}`, () => {
			const alt = altOf(page(doc), file);
			const missing = [...advancedGroups(panel(html)), ...sharedLabels(panel(html), true)].filter((label) => !names(alt, label));
			assert.deepEqual(missing, [], `${file} (described as: ${alt.slice(0, 120)}...) does not show these parts of the ${html} Advanced section; retake it with scripts/capture-pi.mjs`);
		});
	}
});

describe("each page names every section its panel has", () => {
	it("the key page names the key panel's sections", () => {
		const markdown = page("sensor-reading.md");
		const intro = /^\*\*Reading\*\* and \*\*Display\*\* open first\..*$/m.exec(markdown)?.[0] ?? "";
		const missing = sections(panel("sensor-reading.html")).filter((title) => !intro.includes(`**${title}**`));
		assert.deepEqual(missing, [], `docs/sensor-reading.md "${intro}"`);
	});

	it("the dial page names the dial panel's sections", () => {
		const markdown = page("sensor-dial.md");
		const intro = /^The panel groups settings under .*$/m.exec(markdown)?.[0] ?? "";
		assert.ok(intro, "docs/sensor-dial.md says how the panel groups its settings");
		const missing = sections(panel("sensor-dial.html")).filter((title) => !intro.includes(`**${title}**`));
		assert.deepEqual(missing, [], `docs/sensor-dial.md "${intro}"`);
	});
});

describe("the Control key's settings carry their panel names", () => {
	it("the Configuration documents note calls the Control key's target Link ID", () => {
		const html = panel("control.html");
		assert.match(html, /<label for="f-target">Link ID<\/label>/, "the Control panel labels its target Link ID");
		const clause = /the HWiNFO Control key holds just ([^;]+?), so it has no wells/.exec(page("sensor-reading.md"))?.[1];
		assert.ok(clause, "docs/sensor-reading.md says what the Control key holds");
		assert.ok(names(clause, "Link ID") && !/\btarget\b/i.test(clause), `docs/sensor-reading.md says the Control key holds "${clause}"; the panel calls that setting Link ID`);
	});
});
