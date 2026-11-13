/**
 * The shared defaults for a key's and a dial's Background and Words in the
 * accent color (src/ui/shared-looks.ts, Advanced, Shared defaults). An
 * action's own exact value wins; absent, the empty value the panel's
 * Default saves and junk follow the shared default; with no shared default
 * stored every face is the one drawn before these defaults existed (the
 * existing goldens, which run with none stored, hold that byte for byte;
 * this file holds a stored Theme and off to the same bytes). A change
 * repaints through the theme listeners and writes nothing.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, before, describe, it } from "node:test";

import { composeKeyScenario, KEY_SCENARIOS, seedGallerySeries } from "../scripts/lib/key-gallery";
import { dialGalleryFixture } from "../scripts/lib/dial-gallery";
import { composeDialSvg, type DialSettings } from "../src/actions/sensor-dial";
import { stripLookOf } from "../src/strip/frame";
import { newStripConfig, stripConfigOf, stripSeedOf } from "../src/strip/settings";
import { ownAccentWordsOf, ownBackgroundOf } from "../src/ui/dial-background";
import { setFaceFont } from "../src/ui/face-font";
import {
	countOwnLooks,
	dialAccentWordsFor,
	dialBackgroundFor,
	keyAccentWordsFor,
	keyBackgroundFor,
	looksGenOf,
	NO_OWN_LOOKS,
	NO_SHARED_LOOKS,
	OWN_LOOK_FIELDS,
	parseSharedLooks,
	registerLooksPort,
	sharedLooks,
	staleLooks,
	staleLooksReset
} from "../src/ui/shared-looks";
import { applyGlobalThemeSettings, onThemeChange } from "../src/ui/theme-store";

const BASE = { theme: "void", typeAccents: "on", textMode: "theme" } as const;
const LOOKS = ["glass", "tint", "outline", "clear"] as const;
/** Own values that are no look of the action's own: each follows the shared default. */
const FOLLOWS: unknown[] = [undefined, "", "Glass", "glass ", "transparent", 1, true, null, {}, ["glass"]];
/** Own values that are no Words choice of the action's own. */
const WORDS_FOLLOW: unknown[] = [undefined, "", "true", "on", 1, 0, null, {}];

const useShared = (shared: Record<string, unknown> = {}): void => {
	setFaceFont("tahoma");
	applyGlobalThemeSettings({ ...BASE, textFont: "tahoma", ...shared });
};
before(() => seedGallerySeries());
afterEach(() => useShared());

describe("resolution: an action's own value, else the shared default, else Theme and off", () => {
	it("reads only the exact names and booleans as an action's own", () => {
		for (const look of ["theme", ...LOOKS]) assert.equal(ownBackgroundOf(look), look);
		for (const raw of FOLLOWS) assert.equal(ownBackgroundOf(raw), null, JSON.stringify(raw));
		assert.equal(ownAccentWordsOf(true), true);
		assert.equal(ownAccentWordsOf(false), false);
		for (const raw of WORDS_FOLLOW) assert.equal(ownAccentWordsOf(raw), null, JSON.stringify(raw));
	});

	it("absent or explicit, under no shared default and under each shared look", () => {
		for (const shared of [undefined, "theme", ...LOOKS]) {
			useShared(shared === undefined ? {} : { keyBackground: shared, dialBackground: shared });
			const fallback = shared ?? "theme";
			for (const raw of FOLLOWS) {
				assert.equal(keyBackgroundFor(raw), fallback, `key ${JSON.stringify(raw)} under ${shared}`);
				assert.equal(dialBackgroundFor(raw), fallback, `dial ${JSON.stringify(raw)} under ${shared}`);
			}
			for (const own of ["theme", ...LOOKS]) {
				assert.equal(keyBackgroundFor(own), own, `the key's own ${own} wins over ${shared}`);
				assert.equal(dialBackgroundFor(own), own, `the dial's own ${own} wins over ${shared}`);
			}
		}
		for (const shared of [undefined, false, true]) {
			useShared(shared === undefined ? {} : { keyAccentWords: shared, dialAccentWords: shared });
			for (const raw of WORDS_FOLLOW) {
				assert.equal(keyAccentWordsFor(raw), shared === true, `key words ${JSON.stringify(raw)} under ${shared}`);
				assert.equal(dialAccentWordsFor(raw), shared === true, `dial words ${JSON.stringify(raw)} under ${shared}`);
			}
			for (const own of [true, false]) {
				assert.equal(keyAccentWordsFor(own), own);
				assert.equal(dialAccentWordsFor(own), own);
			}
		}
	});

	it("a shared default is read with the exact readers, and the key's and the dial's never mix", () => {
		assert.deepEqual(parseSharedLooks({}), NO_SHARED_LOOKS);
		assert.deepEqual(parseSharedLooks({ keyBackground: "Glass", keyAccentWords: "true", dialBackground: 7, dialAccentWords: 1 }), NO_SHARED_LOOKS);
		useShared({ keyBackground: "glass", keyAccentWords: true });
		assert.equal(dialBackgroundFor(undefined), "theme");
		assert.equal(dialAccentWordsFor(undefined), false);
		useShared({ dialBackground: "tint", dialAccentWords: true });
		assert.equal(keyBackgroundFor(undefined), "theme");
		assert.equal(keyAccentWordsFor(undefined), false);
	});
});

describe("faces: a key", () => {
	const golden = JSON.parse(readFileSync(new URL("./golden/key-backgrounds.json", import.meta.url), "utf8")) as Record<string, string>;

	it("with no shared default stored, or a stored Theme and off, draws the same bytes", () => {
		for (const s of KEY_SCENARIOS) {
			useShared();
			const none = composeKeyScenario(s, "midnight", "theme");
			useShared({ keyBackground: "theme", keyAccentWords: false, dialBackground: "theme", dialAccentWords: false });
			assert.equal(composeKeyScenario(s, "midnight", "theme"), none, s.id);
		}
	});

	it("follows a shared look exactly as its own look would draw (the pinned goldens), and its own look wins", () => {
		for (const look of LOOKS) {
			for (const s of KEY_SCENARIOS) {
				const pinned = golden[`${look}/tahoma/midnight/${s.id}`];
				assert.ok(pinned !== undefined, `${look}/${s.id} is pinned`);
				useShared({ keyBackground: look });
				assert.equal(composeKeyScenario(s, "midnight", "theme"), pinned, `${look} ${s.id}: absent follows the shared look`);
				assert.equal(composeKeyScenario(s, "midnight", "theme", ""), pinned, `${look} ${s.id}: Default's empty value follows it`);
				const themeFace = composeKeyScenario(s, "midnight", "theme", "theme");
				useShared();
				assert.equal(themeFace, composeKeyScenario(s, "midnight", "theme"), `${look} ${s.id}: the key's own Theme keeps today's face`);
				useShared({ keyBackground: "clear" });
				assert.equal(composeKeyScenario(s, "midnight", "theme", look), pinned, `${look} ${s.id}: the key's own look wins over a shared Clear`);
			}
		}
	});

	it("follows the shared Words in the accent color, and its own false keeps plain words", () => {
		for (const look of ["glass", "tint", "outline"] as const) {
			for (const id of ["single-sparkline", "dual-max", "quad-labels-min"]) {
				const s = KEY_SCENARIOS.find((x) => x.id === id)!;
				useShared({ keyAccentWords: true });
				assert.equal(composeKeyScenario(s, "midnight", "theme", look), golden[`${look}+accent words/tahoma/midnight/${id}`], `${look} ${id}: the shared words`);
				assert.equal(composeKeyScenario(s, "midnight", "theme", look, { keyAccentWords: false }), golden[`${look}/tahoma/midnight/${id}`], `${look} ${id}: its own off`);
				useShared();
				assert.equal(composeKeyScenario(s, "midnight", "theme", look, { keyAccentWords: true }), golden[`${look}+accent words/tahoma/midnight/${id}`], `${look} ${id}: its own on`);
			}
		}
	});
});

describe("faces: a dial", () => {
	const goldenKeys = Object.keys(JSON.parse(readFileSync(new URL("./golden/dial-color-baseline.json", import.meta.url), "utf8")) as Record<string, string>);
	const face = (key: string, own: Record<string, unknown> = {}): string => {
		const [view, theme, textMode] = key.split("/");
		const f = dialGalleryFixture(view === "overview" ? "overview" : "tworow");
		f.state.settings = { ...f.state.settings, dialView: view, theme, textMode, textColor: "#123abc", ...own } as DialSettings;
		return composeDialSvg(f.state, { state: "ok", snapshot: f.snapshot, source: "shared-memory" }, f.historyOf);
	};

	it("with no shared default stored, or a stored Theme and off, draws the same bytes (the 63 color goldens' inputs)", () => {
		for (const key of goldenKeys) {
			useShared();
			const none = face(key);
			useShared({ dialBackground: "theme", dialAccentWords: false, keyBackground: "glass", keyAccentWords: true });
			assert.equal(face(key), none, `${key}: a stored Theme and off, and the key's shared looks, change nothing`);
		}
	});

	it("follows a shared look and shared words as its own would draw, and its own values win", () => {
		for (const look of LOOKS) {
			for (const key of goldenKeys) {
				useShared();
				const own = face(key, { dialBackground: look });
				const ownWords = face(key, { dialBackground: look, dialAccentWords: true });
				const plain = face(key);
				useShared({ dialBackground: look });
				assert.equal(face(key), own, `${look} ${key}: absent follows`);
				assert.equal(face(key, { dialBackground: "" }), own, `${look} ${key}: Default's empty value follows`);
				assert.equal(face(key, { dialBackground: "theme" }), plain, `${look} ${key}: its own Theme wins`);
				useShared({ dialBackground: look, dialAccentWords: true });
				assert.equal(face(key), ownWords, `${look} ${key}: the shared words follow`);
				assert.equal(face(key, { dialAccentWords: false }), own, `${look} ${key}: its own off wins`);
			}
		}
	});

	it("a new strip stores no Background or Words and follows the shared dial ones, whatever its dial keeps", () => {
		for (const dial of [{}, { dialBackground: "clear", dialAccentWords: false }]) {
			const config = newStripConfig("whole", 6, stripSeedOf({ readingKey: "f0000501:0:1000000", ...dial }));
			assert.equal(config.background, undefined);
			assert.equal(config.accentWords, undefined);
			useShared({ dialBackground: "tint", dialAccentWords: true });
			assert.deepEqual([stripLookOf(config).background, stripLookOf(config).accent], ["tint", true], JSON.stringify(dial));
			useShared({ dialBackground: "nebula" });
			assert.deepEqual([stripLookOf(config).background, stripLookOf(config).accent], ["nebula", false], "a shared change repaints it with no write");
			useShared();
			assert.deepEqual([stripLookOf(config).background, stripLookOf(config).accent], ["theme", false], "no shared default: Theme, as before");
		}
	});

	it("a strip's own Background and Words win over the shared ones, its own Theme and false included", () => {
		useShared({ dialBackground: "nebula", dialAccentWords: true });
		assert.equal(stripLookOf(stripConfigOf({ background: "clear" })).background, "clear");
		assert.equal(stripLookOf(stripConfigOf({ background: "theme" })).background, "theme");
		assert.equal(stripLookOf(stripConfigOf({ accentWords: false })).accent, false);
		assert.equal(stripLookOf(stripConfigOf({ background: "Clear" })).background, "nebula", "junk follows the shared one");
	});
});

describe("Use it everywhere: the looks generation", () => {
	it("reads looksResetGen and looksGen as whole numbers above 0, anything else 0", () => {
		for (const [raw, gen] of [[1, 1], [7, 7], [0, 0], [-2, 0], [1.5, 0], ["3", 0], [null, 0], [undefined, 0], [Number.MAX_SAFE_INTEGER + 1, 0]] as const) assert.equal(looksGenOf(raw), gen, String(raw));
		assert.equal(parseSharedLooks({ looksResetGen: 4 }).resetGen, 4);
		assert.equal(parseSharedLooks({ looksResetGen: "4" }).resetGen, 0);
	});

	it("an own Background or Words stamped before the shared generation is stale; Default, a later stamp and no reset are not", () => {
		const fields = OWN_LOOK_FIELDS.dial;
		assert.equal(staleLooks({ dialBackground: "clear" }, fields, 1), true);
		assert.equal(staleLooks({ dialAccentWords: false }, fields, 1), true);
		assert.equal(staleLooks({ dialBackground: "clear", looksGen: 1 }, fields, 2), true);
		assert.equal(staleLooks({ dialBackground: "clear", looksGen: 2 }, fields, 2), false, "chosen after the reset: kept");
		assert.equal(staleLooks({ dialBackground: "clear" }, fields, 0), false, "no reset ever made");
		assert.equal(staleLooks({ dialBackground: "", dialAccentWords: "" }, fields, 3), false, "Default holds nothing to drop");
		assert.equal(staleLooks({ keyBackground: "clear" }, fields, 3), false, "the key's fields are not the dial's");
	});

	it("the reset drops exactly the two own fields and stamps the generation, every other field as it was", () => {
		const doc = { readingKey: "a:0:1", dialBackground: "nebula", dialAccentWords: true, theme: "ember", textMode: "dim", label: "CPU", future: { x: 1 } };
		assert.deepEqual(staleLooksReset(doc, "dial", 1), { readingKey: "a:0:1", theme: "ember", textMode: "dim", label: "CPU", future: { x: 1 }, looksGen: 1 });
		assert.equal(staleLooksReset({ ...doc, looksGen: 1 }, "dial", 1), undefined, "nothing to drop: no write");
		assert.deepEqual(staleLooksReset({ keyBackground: "stars", keyAccentWords: false, readingKey: "k", looksGen: 1 }, "key", 2), { readingKey: "k", looksGen: 2 });
		// A build without looksGen (1.7.1) sets a look on the written document:
		// chosen after this reset, so it stays until the next one.
		const later = { ...staleLooksReset(doc, "dial", 1), dialBackground: "glass" };
		assert.equal(staleLooks(later, OWN_LOOK_FIELDS.dial, 1), false);
		assert.equal(staleLooks(later, OWN_LOOK_FIELDS.dial, 2), true);
	});

	it("the count adds one per action with its own look, a strip once", () => {
		let count = NO_OWN_LOOKS;
		count = countOwnLooks(count, "dials", { background: true, words: false });
		count = countOwnLooks(count, "dials", { background: false, words: false });
		count = countOwnLooks(count, "strips", { background: true, words: true });
		count = countOwnLooks(count, "keys", { background: false, words: true });
		assert.deepEqual(count, { keys: 1, dials: 1, strips: 1, background: 2, words: 2 });
	});

	it("a rising looksResetGen runs every registered sweep once, before the repaint; the same or a lower one runs none", () => {
		useShared();
		const swept: number[] = [];
		let repaintedAfter = -1;
		registerLooksPort({ count: () => NO_OWN_LOOKS, sweep: (gen) => swept.push(gen) });
		onThemeChange(() => {
			repaintedAfter = swept.length;
		});
		useShared({ looksResetGen: 2 });
		assert.deepEqual(swept, [2]);
		assert.equal(repaintedAfter, 1, "the sweep ran before the repaint");
		useShared({ looksResetGen: 2 });
		useShared({ looksResetGen: 2, theme: "ember" });
		assert.deepEqual(swept, [2], "the same generation sweeps nothing");
		useShared({ looksResetGen: 3 });
		assert.deepEqual(swept, [2, 3]);
	});
});

describe("a shared default change repaints and writes nothing", () => {
	it("notifies the theme listeners once per change, never for the same document again", () => {
		useShared();
		let repaints = 0;
		onThemeChange(() => {
			repaints += 1;
		});
		for (const [doc, expected] of [
			[{ keyBackground: "glass" }, 1],
			[{ keyBackground: "glass" }, 1],
			[{ keyBackground: "glass", keyAccentWords: true }, 2],
			[{ keyBackground: "glass", keyAccentWords: true, dialBackground: "outline" }, 3],
			[{ keyBackground: "glass", keyAccentWords: true, dialBackground: "outline", dialAccentWords: true }, 4],
			[{ keyBackground: "Glass", keyAccentWords: "yes", dialBackground: 3, dialAccentWords: 1 }, 5],
			[{}, 5]
		] as const) {
			useShared(doc);
			assert.equal(repaints, expected, JSON.stringify(doc));
		}
		assert.deepEqual(sharedLooks(), NO_SHARED_LOOKS);
	});
});
