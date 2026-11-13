/**
 * Deck backgrounds, Stars, Dusk and Nebula
 * (src/ui/deck-art.ts): the plugin draws one scene per deck in the LCD
 * pixels of the device's published panel layout, and each key, dial and
 * strip slice shows its own rect of it; the Sky (Stars: All, Few or Off,
 * the Stars look keeping at least Few; Sky color: five tones) is an option
 * of every look. Dusk's strip draws its field at 0.2 of its light, and
 * Dusk stays its own look on every dark theme, in both face fonts and at
 * several deck seeds, by a whole-deck color difference rasterized with
 * librsvg.
 *
 * What is held here: the exact-value readers take the art names and
 * nothing near them, and a reader without them (1.7.1's) draws Theme; a
 * face nobody chose them for keeps its bytes (the existing goldens run
 * unchanged elsewhere); every art face uses the see-through structure and
 * carries one backdrop marker; painting is deterministic and places a face
 * by its device and coordinates, or alone when it cannot; the published
 * rects add up and the alignment pattern's pieces join exactly at them; no
 * star sits under a word or across a face edge; every text color reads at
 * 4.5:1 on the brightest color the art can draw (the ceiling), and the art
 * never draws past it; no art color is near the warn or critical hue; the
 * pieces stay inside their byte budgets; and golden faces pin what each
 * look draws on every theme and layout family. To accept an intended
 * change of a golden, rerun this file with HW_UPDATE_GOLDEN=1 and review
 * the diff.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";

import sharp from "sharp";

import { composeKeyScenario, KEY_SCENARIOS, seedGallerySeries } from "../scripts/lib/key-gallery";
import { fixtureCase } from "../scripts/lib/strip-fixtures";
import { composeDialSvg, type DialRenderState } from "../src/actions/sensor-dial";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import type { TextPrim } from "../src/strip/prims";
import { buildStripScene, renderLogical } from "../src/strip/scene";
import { sliceStrip, SLICE_PAYLOAD_LIMIT, svgBytes } from "../src/strip/slicer";
import { SessionStatsStore } from "../src/stats";
import { ART_HUES, ART_LOOKS, ART_PIECE_LIMIT, ART_STARS, ART_TONES, artAlignment, artCeiling, artColors, artMark, artPiece, artPlace, artScene, artSkyOf, artStarsOf, artTextPalette, artToneOf, artWindow, BAND_ALPHA, DECK_PANELS, DEFAULT_SKY, drawnStars, hueOf, isArtLook, keyRect, NEBULA_COVERAGE, NEBULA_MIN_COVERAGE, nebulaReach, ownArtSkyOf, paintArt, setArtAlignment, skyMark, sliceRect, textBoxes, withArtSky, type ArtLook, type ArtPlace, type ArtScene, type ArtSky, type ArtStars, type ArtTone } from "../src/ui/deck-art";
import { ciede2000 } from "../src/ui/color-difference";
import { dialBackgroundOf, dialBackgroundTraits, dialTextColors, ownBackgroundOf } from "../src/ui/dial-background";
import { setFaceFont } from "../src/ui/face-font";
import { keyBackgroundOf, keyTextColors } from "../src/ui/key-background";
import { parseSharedLooks, setSharedLooks, sharedLooks, NO_SHARED_LOOKS, keyBackgroundFor, dialBackgroundFor, keySkyFor, dialSkyFor, ownLooksOf, OWN_LOOK_FIELDS, STRIP_LOOK_FIELDS, staleLooksReset, stripSkyFor, withoutOwnLooks } from "../src/ui/shared-looks";
import { stripLookOf } from "../src/strip/frame";
import { stripConfigOf, stripConfigToJson, withDefaultLooks } from "../src/strip/settings";
import { contrastRatio, luminance, parseTextSettings, type TextSettings } from "../src/ui/text-colors";
import { applyGlobalThemeSettings } from "../src/ui/theme-store";
import { loadThemes, resolvePalette } from "../src/ui/themes";

const config = loadThemes();
const THEMES = Object.keys(config.themes);
const DARK = THEMES.filter((t) => t !== "paper");
const LOOKS: readonly ArtLook[] = ART_LOOKS;
const SEED = "golden-deck-0001";

setFaceFont("tahoma");
applyGlobalThemeSettings({ theme: "void", typeAccents: true, textMode: "theme", textFont: "tahoma" });
seedGallerySeries();
afterEach(() => {
	setArtAlignment(false);
	setSharedLooks(NO_SHARED_LOOKS);
});

const plusXl = DECK_PANELS[13]!;
const plus = DECK_PANELS[7]!;
const keyPlace = (column: number | undefined, row: number | undefined, over: Partial<ArtPlace> = {}): ArtPlace => ({ ...artPlace({ id: SEED, type: 13, columns: 9, rows: 4 }, column === undefined || row === undefined ? undefined : { column, row }, `key-${column}-${row}`, false), ...over });
const dialPlace = (column: number, type = 13, columns = 9, rows = 4): ArtPlace => artPlace({ id: SEED, type, columns, rows }, { column, row: 0 }, `dial-${column}`, true);

// ---- sample dials ---------------------------------------------------------------
let nextId = 1;
const reading = (label: string, type: SensorType, unit: string, value: number, min: number, max: number): Reading => {
	const id = nextId++;
	return { key: `31:0:${id.toString(16)}`, sensorIndex: 0, id, label, type, unit, value, valueMin: min, valueMax: max, valueAvg: value };
};
const wave = (base: number, amp: number): number[] => Array.from({ length: 36 }, (_, i) => base + amp * Math.sin(i / 3.1) + (amp / 3) * Math.cos(i * 1.7));
type DialCase = { id: string; view: "single" | "overview" | "tworow"; readings: Reading[]; history?: Record<string, number[]>; settings?: Record<string, unknown> };
const DIALS: DialCase[] = (() => {
	const power = reading("GPU Power", SensorType.Power, "W", 127, 15.9, 239);
	const ccds = [reading("CPU CCD1 (Tdie)", SensorType.Temperature, "°C", 52.5, 41, 78.5), reading("CPU CCD2 (Tdie)", SensorType.Temperature, "°C", 45.3, 40, 70), reading("CPU Core Max", SensorType.Temperature, "°C", 76, 50, 88)];
	const clocks = [reading("GPU Clock", SensorType.Clock, "MHz", 2745, 210, 2790), reading("GPU Memory Clock", SensorType.Clock, "MHz", 1250, 1250, 1250)];
	const hot = reading("GPU Hot Spot", SensorType.Temperature, "°C", 96.2, 48, 97.5);
	return [
		{ id: "single", view: "single", readings: [power], history: { [power.key]: [15.9, 239, 127] } },
		{ id: "overview", view: "overview", readings: ccds },
		{ id: "tworow", view: "tworow", readings: clocks, history: { [clocks[0]!.key]: wave(2600, 160), [clocks[1]!.key]: wave(1250, 0.5) } },
		{ id: "single-crit", view: "single", readings: [hot], settings: { warnValue: "80", critValue: "90", alertUnit: "°C" }, history: { [hot.key]: [48, 97.5, 96.2] } }
	];
})();
function dialFace(s: DialCase, theme: string, look?: string): string {
	const stats = new SessionStatsStore();
	for (const r of s.readings) for (const v of [...(s.history?.[r.key] ?? [r.valueMin, r.valueMax]), r.value]) stats.sample(r.key, v);
	const settings: Record<string, unknown> = { readingKey: s.readings[0]?.key, theme, textMode: "theme", ...(s.view !== "single" ? { dialView: s.view, rotationKeys: s.readings.map((r) => r.key) } : {}), ...(look === undefined ? {} : { dialBackground: look }), ...s.settings };
	const snapshot = { pollTime: 1, version: 2, revision: 0, sensors: [{ index: 0, id: 0x31, instance: 0, name: "Sample sensors" }], readings: s.readings, byKey: new Map(s.readings.map((r) => [r.key, r])) } as SensorSnapshot;
	const state = { settings, stats, statMode: "current", overlay: null, pinned: false, cyclePaused: false } as unknown as DialRenderState;
	return composeDialSvg(state, { state: "ok", snapshot, source: "shared-memory" }, (key) => s.history?.[key] ?? []);
}
const keyScenario = (id: string) => KEY_SCENARIOS.find((k) => k.id === id)!;
const MARKS = (svg: string): number => svg.split(" data-art=").length - 1;

// ---- readers --------------------------------------------------------------------------

/** 1.7.1's reader, verbatim: what an older build does with a stored look. */
function reader171(raw: unknown): string {
	return raw === "glass" || raw === "tint" || raw === "outline" || raw === "clear" ? raw : "theme";
}

describe("the stored look: the art looks' exact names", () => {
	const NEAR: unknown[] = ["Stars", "STARS", " stars", "stars ", "star", "starfield", "Nebula", "NEBULA", "nebula ", " nebula", "nebulae", "space", "Dusk", "dusk ", "dusky", "eclipse", "Milky Way", "milky way", "milky-way", "MilkyWay", "milkyway", "milkyway ", "moon", "Moonrise", "moonrise", " moonrise", "moonlight", "aurora", "ink", "dusk.deep-few", "", true, 1, null, {}, [], ["stars"]];

	it("the key, dial, own and shared readers take each art look exactly, and nothing near them", () => {
		for (const look of LOOKS) {
			assert.equal(dialBackgroundOf(look), look);
			assert.equal(keyBackgroundOf(look), look);
			assert.equal(ownBackgroundOf(look), look);
			assert.ok(isArtLook(look));
		}
		for (const raw of NEAR) {
			assert.equal(dialBackgroundOf(raw), "theme", JSON.stringify(raw));
			assert.equal(keyBackgroundOf(raw), "theme", JSON.stringify(raw));
			assert.equal(ownBackgroundOf(raw), null, JSON.stringify(raw));
			assert.equal(isArtLook(raw), false, JSON.stringify(raw));
		}
	});

	it("an older build (1.7.1's reader) draws Theme for both, so a rollback keeps today's face", () => {
		for (const look of LOOKS) assert.equal(reader171(look), "theme");
		// The same face the current build draws for a value it does not know.
		const theme = composeKeyScenario(keyScenario("single"), "midnight", "theme");
		assert.equal(composeKeyScenario(keyScenario("single"), "midnight", "theme", reader171("stars") === "theme" ? undefined : "stars"), theme);
	});

	it("Shared defaults carry them: one change sets every key and dial that has no look of its own", () => {
		setSharedLooks(parseSharedLooks({ keyBackground: "stars", dialBackground: "nebula" }));
		assert.equal(keyBackgroundFor(undefined), "stars");
		assert.equal(keyBackgroundFor(""), "stars");
		assert.equal(keyBackgroundFor("theme"), "theme", "an action's own Theme still wins");
		assert.equal(dialBackgroundFor(undefined), "nebula");
		const shared = composeKeyScenario(keyScenario("single"), "midnight", "theme");
		const own = composeKeyScenario(keyScenario("single"), "midnight", "theme", "stars");
		assert.equal(shared, own);
		setSharedLooks(parseSharedLooks({ keyBackground: "Stars", dialBackground: "nebulae" }));
		assert.equal(keyBackgroundFor(undefined), "theme");
		assert.equal(dialBackgroundFor(undefined), "theme");
	});

	it("the catalog is three art looks, in list order after Theme, Glass, Tint, Outline and Clear: Stars, Dusk, Nebula (no Milky Way, no Moonrise)", () => {
		assert.deepEqual([...ART_LOOKS], ["stars", "dusk", "nebula"]);
		for (const held of ["milkyway", "moonrise"]) assert.equal(isArtLook(held), false, held);
	});
});

// ---- faces ------------------------------------------------------------------------------

describe("art faces: the see-through structure over one backdrop marker", () => {
	it("every key scenario on every dark theme carries one marker and no background-colored mask; Paper and an alerting key draw Theme byte for byte", () => {
		for (const theme of THEMES) {
			const p = config.themes[theme]!;
			for (const look of LOOKS) {
				for (const s of KEY_SCENARIOS) {
					const face = composeKeyScenario(s, theme, "theme", look);
					const themeFace = composeKeyScenario(s, theme, "theme");
					if (theme === "paper" || s.id === "single-crit") {
						assert.equal(face, themeFace, `${look} ${theme} ${s.id}`);
						continue;
					}
					assert.equal(MARKS(face), 1, `${look} ${theme} ${s.id}`);
					const masks = [...face.matchAll(new RegExp(`<rect [^>]*fill="${p.bg}"(?! data-art)[^>]*/>`, "gi"))];
					assert.deepEqual(masks, [], `${look} ${theme} ${s.id}: a mask in the background color`);
					// Painting is the only change the send path makes to it.
					assert.equal(MARKS(paintArt(face, keyPlace(2, 1))), 0);
				}
			}
		}
	});

	it("every dial view carries one marker, no overflow rect and no selected-row band; Paper draws Theme", () => {
		for (const look of LOOKS) {
			const traits = dialBackgroundTraits(look);
			assert.equal(traits.overflowRects, false);
			assert.equal(traits.band, false);
			assert.equal(traits.halo, false);
			assert.equal(traits.accentWords, false, "Words in the accent color stays with Glass, Tint and Outline");
			for (const theme of THEMES) {
				for (const s of DIALS) {
					const face = dialFace(s, theme, look);
					if (theme === "paper") {
						assert.equal(face, dialFace(s, theme), `${look} ${s.id}`);
						continue;
					}
					assert.equal(MARKS(face), 1, `${look} ${theme} ${s.id}`);
					const bg = config.themes[theme]!.bg;
					assert.deepEqual([...face.matchAll(new RegExp(`<rect [^>]*fill="${bg}"(?! data-art)[^>]*/>`, "gi"))], [], `${look} ${theme} ${s.id}: an overflow rect`);
				}
			}
		}
	});

	it("a strip draws one backdrop across all its slices, gutter included, and each slice carries it once", () => {
		for (const look of LOOKS) {
			for (const layout of ["whole", "split"] as const) {
				const c = fixtureCase({ styles: ["trend", "area"], layout, encoders: 6, background: look, accent: false, theme: "midnight" });
				const result = sliceStrip(c.input);
				assert.equal(MARKS(renderLogical(result.scene)), 1);
				for (const slice of result.slices) assert.equal(MARKS(slice as string), 1);
			}
			const paper = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 4, background: look, accent: false, theme: "paper" });
			const themed = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 4, background: "theme", accent: false, theme: "paper" });
			assert.deepEqual(sliceStrip(paper.input).slices, sliceStrip(themed.input).slices, "Paper draws Theme");
		}
	});

	it("a painted strip slice stays under the payload bound: the slicer keeps room for the longest piece", () => {
		for (const look of LOOKS) {
			for (const encoders of [4, 6] as const) {
				const c = fixtureCase({ styles: ["trend", "lanes"], layout: "split", encoders, background: look, accent: false, theme: "graphite" });
				const result = sliceStrip(c.input);
				result.slices.forEach((slice, column) => {
					const painted = paintArt(slice as string, dialPlace(column, encoders === 6 ? 13 : 7, encoders === 6 ? 9 : 4, encoders === 6 ? 4 : 2));
					assert.ok(svgBytes(painted) <= SLICE_PAYLOAD_LIMIT, `${look} ${encoders} column ${column}: ${svgBytes(painted)}`);
				});
			}
		}
	});
});

// ---- painting ---------------------------------------------------------------------------

describe("painting: deterministic, placed by device and coordinates, never thrown", () => {
	const face = composeKeyScenario(keyScenario("single-sparkline"), "midnight", "theme", "stars");

	it("a face with no marker passes through untouched", () => {
		const theme = composeKeyScenario(keyScenario("single-sparkline"), "midnight", "theme");
		assert.equal(paintArt(theme, keyPlace(1, 1)), theme);
		for (const look of ["glass", "tint", "outline", "clear"]) {
			const other = composeKeyScenario(keyScenario("dual"), "midnight", "theme", look);
			assert.equal(paintArt(other, keyPlace(1, 1)), other, look);
		}
	});

	it("the same face, device, position and seed always draw the same bytes; another seed or position draws another sky", () => {
		const a = paintArt(face, keyPlace(3, 2));
		assert.equal(paintArt(face, keyPlace(3, 2)), a);
		assert.notEqual(paintArt(face, keyPlace(3, 2, { deviceSeed: "another-deck" })), a);
		assert.notEqual(paintArt(face, keyPlace(4, 2)), a);
	});

	it("an unknown device, a grid the table does not know, missing or impossible coordinates: the look alone from the key's own seed", () => {
		const cases: ArtPlace[] = [
			keyPlace(1, 1, { deviceType: undefined }),
			keyPlace(1, 1, { deviceType: 99 }),
			keyPlace(1, 1, { deviceType: 12 }),
			keyPlace(1, 1, { columns: 8 }),
			keyPlace(undefined, undefined),
			keyPlace(9, 0),
			keyPlace(-1, 0),
			keyPlace(1.5, 0),
			keyPlace(Number.NaN, 0),
			keyPlace(0, 4)
		];
		for (const place of cases) {
			const window = artWindow(place, 144, 144);
			assert.equal(window.aligned, false, JSON.stringify(place));
			assert.deepEqual(window.rect, { x: 0, y: 0, w: 112, h: 112 });
			const painted = paintArt(face, place);
			assert.equal(MARKS(painted), 0);
			assert.equal(paintArt(face, place), painted, "deterministic alone too");
		}
		// A key with no coordinates (inside a Multi Action) seeds from its own id.
		const lone1 = paintArt(face, { ...keyPlace(undefined, undefined), ownSeed: "a" });
		const lone2 = paintArt(face, { ...keyPlace(undefined, undefined), ownSeed: "b" });
		assert.notEqual(lone1, lone2);
		// A dial on a deck with no strip, or past its encoders.
		assert.equal(artWindow(dialPlace(2, 2, 8, 4), 200, 100).aligned, false);
		assert.equal(artWindow(dialPlace(6), 200, 100).aligned, false);
		assert.equal(artWindow(dialPlace(4, 7, 4, 2), 200, 100).aligned, false);
		assert.equal(artWindow(dialPlace(3, 7, 4, 2), 200, 100).aligned, true);
	});

	it("a key is placed at its published rect and a dial at the strip above its encoder", () => {
		assert.deepEqual(artWindow(keyPlace(8, 3), 144, 144).rect, { x: 1159, y: 462, w: 112, h: 112 });
		assert.deepEqual(artWindow(dialPlace(5), 200, 100).rect, { x: 1040, y: 674, w: 200, h: 100 });
		assert.deepEqual(artWindow(dialPlace(0, 7, 4, 2), 200, 100).rect, { x: 0, y: 380, w: 200, h: 100 });
		assert.deepEqual(artWindow(artPlace({ id: SEED, type: 2, columns: 8, rows: 4 }, { column: 7, row: 3 }, "x", false), 144, 144).rect, { x: 910, y: 452, w: 96, h: 96 });
		assert.deepEqual(artWindow(artPlace({ id: SEED, type: 0, columns: 5, rows: 3 }, { column: 4, row: 2 }, "x", false), 144, 144).rect, { x: 399, y: 199, w: 72, h: 72 });
		assert.deepEqual(artWindow(artPlace({ id: SEED, type: 9, columns: 4, rows: 2 }, { column: 3, row: 1 }, "x", false), 144, 144).rect, { x: 381, y: 135, w: 96, h: 96 });
	});
});

// ---- geometry and the alignment pattern ----------------------------------------------

/** The piece's transform: face = s * panel + t, per axis. */
function transformOf(piece: string): { sx: number; sy: number; tx: number; ty: number } {
	const m = /<g transform="matrix\(([-\d.e]+) 0 0 ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)\)">/.exec(piece);
	assert.ok(m, piece.slice(0, 200));
	return { sx: Number(m[1]), sy: Number(m[2]), tx: Number(m[3]), ty: Number(m[4]) };
}

describe("the published panels, and the alignment pattern joining exactly at them", () => {
	it("the + XL, +, XL, MK.2 and Neo rects match Elgato's layouts and add up across each panel", () => {
		assert.deepEqual(plusXl.keyX, [11, 154, 298, 441, 585, 728, 872, 1015, 1159]);
		for (let c = 0; c < 9; c++) assert.equal(plusXl.keyX[c], 11 + 143 * c + Math.floor(c / 2));
		assert.equal(11 + 9 * 112 + (plusXl.keyX[8]! - plusXl.keyX[0]! - 8 * 112) + 9, 1280, "+ XL across");
		assert.equal(plusXl.keyY[3]! + 112 + 100 + 100 + 26, 800, "+ XL down: keys, the band, the strip, the edge");
		assert.equal(13 + 4 * 120 + 3 * 99 + 10, 800, "+ across");
		assert.equal(plus.keyY[1]! + 120 + 88 + 100, 480, "+ down");
		for (const [type, panel] of Object.entries(DECK_PANELS)) {
			for (let r = 0; r < panel.rows; r++) {
				for (let c = 0; c < panel.columns; c++) {
					const k = keyRect(panel, c, r)!;
					assert.ok(k.x >= 0 && k.y >= 0 && k.x + k.w <= panel.w && k.y + k.h <= panel.h, `${type} ${c},${r}`);
					if (c > 0) assert.ok(keyRect(panel, c - 1, r)!.x + panel.key < k.x, `${type}: keys never overlap`);
					if (panel.strip !== null) assert.ok(k.y + k.h <= panel.strip.y, `${type}: keys sit above the strip`);
				}
			}
			if (panel.strip !== null) {
				const n = panel.strip.w / 200;
				for (let c = 0; c < n; c++) assert.equal(sliceRect(panel, c)!.x, panel.strip.x + 200 * c, "slices tile the strip");
				assert.equal(sliceRect(panel, n), null);
				assert.ok(panel.strip.x + panel.strip.w <= panel.w && panel.strip.y + panel.strip.h <= panel.h);
			}
		}
	});

	it("every piece maps its published rect exactly onto its face and carries the one master pattern, so lines continue across every bezel and seam", () => {
		setArtAlignment(true);
		assert.equal(artAlignment(), true);
		for (const [type, panel] of [[13, plusXl], [7, plus], [2, DECK_PANELS[2]!], [0, DECK_PANELS[0]!], [9, DECK_PANELS[9]!]] as const) {
			let master: string | undefined;
			const check = (svg: string, place: ArtPlace, w: number, h: number): void => {
				const window = artWindow(place, w, h);
				assert.equal(window.aligned, true);
				const painted = paintArt(svg, place);
				const piece = painted.slice(painted.indexOf("<rect"), painted.lastIndexOf("</g>") + 4);
				const t = transformOf(piece);
				const { x, y, w: rw, h: rh } = window.rect;
				// The rect's corners land on the face's corners, to a millionth of a pixel.
				for (const [got, want] of [[t.sx * x + t.tx, 0], [t.sx * (x + rw) + t.tx, w], [t.sy * y + t.ty, 0], [t.sy * (y + rh) + t.ty, h]] as const) assert.ok(Math.abs(got - want) < 1e-3, `${type} ${JSON.stringify(window.rect)}: ${got} vs ${want}`);
				const body = piece.slice(piece.indexOf(">", piece.indexOf("<g transform")) + 1, -4);
				master ??= body;
				assert.equal(body, master, "the same master pattern in every piece");
			};
			const key = composeKeyScenario(keyScenario("single"), "midnight", "theme", "nebula");
			for (let r = 0; r < panel.rows; r++) for (let c = 0; c < panel.columns; c++) check(key, artPlace({ id: SEED, type, columns: panel.columns, rows: panel.rows }, { column: c, row: r }, "k", false), 144, 144);
			if (panel.strip !== null) {
				const dial = dialFace(DIALS[0]!, "midnight", "stars");
				for (let c = 0; c < panel.strip.w / 200; c++) check(dial, dialPlace(c, type, panel.columns, panel.rows), 200, 100);
			}
		}
	});

	it("neighbouring faces meet at the published gap: a line that leaves one key's right edge enters the next key's left edge one bezel later", () => {
		// The diagonal x - y = k in panel pixels crosses key (c, r)'s right
		// edge at y = x - k and key (c + 1, r)'s left edge at the same line:
		// the drawn segment is the master's, cut only by each face's viewport.
		setArtAlignment(true);
		const scene = artScene("stars", { id: "plusxl", w: 1280, h: 800 }, SEED, "#071120", "#788CA9");
		assert.match(scene.ghost ?? "", /^<path d="M-800 0L0 800M-800 800L0 0/);
		const left = artPiece(scene, keyRect(plusXl, 3, 1)!, 144, 144, []);
		const right = artPiece(scene, keyRect(plusXl, 4, 1)!, 144, 144, []);
		const a = transformOf(left);
		const b = transformOf(right);
		// Panel x of each face's edge from its own transform.
		const leftEdge = (144 - a.tx) / a.sx;
		const rightEdge = -b.tx / b.sx;
		assert.ok(Math.abs(leftEdge - (441 + 112)) < 1e-3 && Math.abs(rightEdge - 585) < 1e-3);
		assert.ok(Math.abs(rightEdge - leftEdge - 32) < 1e-3, "the published 32 px gap between columns 3 and 4");
	});
});

/** The least share of a panel's faces the field look lights. */
const LIT_SHARE: Readonly<Record<string, number>> = { dusk: 0.75 };

describe("the field looks: one field of light, continuous across every bezel and seam", () => {
	it("every key and slice of every panel maps its rect exactly onto its face and carries the scene's own gradients, numbers unchanged, so the light continues where the glass shows it", () => {
		for (const look of ["dusk"] as const) {
			for (const [type, panel] of Object.entries(DECK_PANELS)) {
				const defs = new Map<string, string>();
				let faces = 0;
				let lit = 0;
				const check = (svg: string, place: ArtPlace, w: number, h: number): void => {
					const window = artWindow(place, w, h);
					assert.equal(window.aligned, true);
					const painted = paintArt(svg, place);
					faces++;
					if (!painted.includes('<g transform="matrix(')) return;
					const t = transformOf(painted);
					const { x, y, w: rw, h: rh } = window.rect;
					for (const [got, want] of [[t.sx * x + t.tx, 0], [t.sx * (x + rw) + t.tx, w], [t.sy * y + t.ty, 0], [t.sy * (y + rh) + t.ty, h]] as const) assert.ok(Math.abs(got - want) < 1e-3, `${look} ${type} ${JSON.stringify(window.rect)}: ${got} vs ${want}`);
					// Each gradient and circle is the scene's, in panel pixels: the
					// same definition in every piece that draws it.
					for (const m of painted.matchAll(/<(linearGradient|radialGradient) id="([a-z0-9]+)"[\s\S]*?<\/\1>/g)) {
						const known = defs.get(m[2] as string);
						if (known === undefined) defs.set(m[2] as string, m[0]);
						else assert.equal(m[0], known, `${look} ${type}: gradient ${m[2]} differs between faces`);
					}
					for (const m of painted.matchAll(/<circle cx="(-?[\d.]+)" cy="(-?[\d.]+)" r="([\d.]+)" fill="url\(#([ns]\d)\)"\/>/g)) {
						const known = defs.get(`circle-${m[4]}-${m[3]}`);
						if (known === undefined) defs.set(`circle-${m[4]}-${m[3]}`, m[0]);
						else assert.equal(m[0], known, `${look} ${type}: circle ${m[4]} moved between faces`);
					}
					if (/url\(#[ns]\d\)/.test(painted)) lit++;
				};
				const key = composeKeyScenario(keyScenario("single"), "midnight", "theme", look);
				for (let r = 0; r < panel.rows; r++) for (let c = 0; c < panel.columns; c++) check(key, artPlace({ id: SEED, type: Number(type), columns: panel.columns, rows: panel.rows }, { column: c, row: r }, "k", false), 144, 144);
				if (panel.strip !== null) {
					const strip = sliceStrip(fixtureCase({ styles: ["trend"], layout: "whole", encoders: panel.strip.w === 800 ? 4 : 6, background: look, accent: false, theme: "midnight" }).input);
					strip.slices.forEach((slice, c) => check(slice as string, dialPlace(c, Number(type), panel.columns, panel.rows), 200, 100));
				}
				assert.ok(lit >= faces * (LIT_SHARE[look] as number), `${look} ${type}: only ${lit} of ${faces} faces carry the light`);
			}
		}
	});
});

describe("Dusk: one glow over the keys, the strip held dark under it", () => {
	it("every strip slice draws Dusk's field at 0.2 of its light under its own id (s0), every key the full field (n0); Stars and Nebula slices hold nothing", () => {
		for (const theme of DARK) {
			const p = config.themes[theme]!;
			for (const [type, panel] of [[13, plusXl], [7, plus]] as const) {
				const scene = artScene("dusk", { id: panel.id, w: panel.w, h: panel.h }, SEED, p.bg, p.label, p.value);
				const peak = scene.profiles[0]!.alpha;
				const held = Math.floor(peak * 0.2 * 1000) / 1000;
				const firstStop = (painted: string, id: string): number | undefined => {
					const m = new RegExp(`<radialGradient id="${id}"><stop(?: offset="[^"]*")? stop-color="#[0-9A-F]{6}" stop-opacity="([\\d.]+)"/>`).exec(painted);
					return m === null ? undefined : Number(m[1]);
				};
				const strip = sliceStrip(fixtureCase({ styles: ["trend"], layout: "whole", encoders: panel.strip!.w === 800 ? 4 : 6, background: "dusk", accent: false, theme }).input);
				strip.slices.forEach((slice, c) => {
					const painted = paintArt(slice as string, dialPlace(c, type, panel.columns, panel.rows));
					assert.ok(!painted.includes('id="n0"'), `${theme} ${type} slice ${c}: the full field`);
					assert.equal(firstStop(painted, "s0"), held, `${theme} ${type} slice ${c}`);
				});
				const key = paintArt(composeKeyScenario(keyScenario("single"), theme, "theme", "dusk"), artPlace({ id: SEED, type, columns: panel.columns, rows: panel.rows }, { column: 1, row: panel.rows - 1 }, "k", false));
				assert.equal(firstStop(key, "n0"), peak, `${theme} ${type}: a key draws the full field`);
			}
			// Named on purpose: the hold is Dusk's alone, and these are the art
			// looks pinned to draw none (a new look decides its own).
			for (const look of ["stars", "nebula"] as const) {
				const strip = sliceStrip(fixtureCase({ styles: ["trend"], layout: "whole", encoders: 6, background: look, accent: false, theme }).input);
				for (const [c, slice] of strip.slices.entries()) assert.ok(!/id="s\d"/.test(paintArt(slice as string, dialPlace(c))), `${look} ${theme}: no hold`);
			}
		}
	});
});

// ---- stars and words -------------------------------------------------------------------

/** Every star square in a painted face, in face units. */
function starsIn(painted: string): { x0: number; y0: number; x1: number; y1: number }[] {
	if (!painted.includes('<g transform="matrix(')) return [];
	const t = transformOf(painted);
	const out: { x0: number; y0: number; x1: number; y1: number }[] = [];
	for (const p of painted.matchAll(/<path fill="#[0-9A-F]{6}" d="([^"]*)"\/>/g)) {
		for (const m of (p[1] as string).matchAll(/M([\d.]+) ([\d.]+)(h1v1h-1z|l\.5-\.5h1l\.5\.5v1l-\.5\.5h-1l-\.5-\.5z)/g)) {
			const x = Number(m[1]);
			const round = (m[3] as string).startsWith("l");
			const y = Number(m[2]) - (round ? 0.5 : 0);
			const size = round ? 2 : 1;
			out.push({ x0: t.sx * x + t.tx, y0: t.sy * y + t.ty, x1: t.sx * (x + size) + t.tx, y1: t.sy * (y + size) + t.ty });
		}
	}
	for (const m of painted.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="url\(#g\)"\/>/g)) {
		const [cx, cy, r] = [Number(m[1]), Number(m[2]), Number(m[3])];
		out.push({ x0: t.sx * (cx - r) + t.tx, y0: t.sy * (cy - r) + t.ty, x1: t.sx * (cx + r) + t.tx, y1: t.sy * (cy + r) + t.ty });
	}
	return out;
}

describe("stars stay out of the words and inside the face", () => {
	it("no star or glow touches any text box of its face, and none crosses a face edge, on every key layout, dial view and strip slice", () => {
		let seen = 0;
		const check = (face: string, place: ArtPlace, w: number, h: number, where: string): void => {
			const painted = paintArt(face, place);
			const boxes = textBoxes(face);
			assert.ok(boxes !== null, where);
			for (const s of starsIn(painted)) {
				seen++;
				assert.ok(s.x0 >= -1e-3 && s.y0 >= -1e-3 && s.x1 <= w + 1e-3 && s.y1 <= h + 1e-3, `${where}: a star across the edge ${JSON.stringify(s)}`);
				for (const b of boxes) assert.ok(s.x1 <= b.x0 || s.x0 >= b.x1 || s.y1 <= b.y0 || s.y0 >= b.y1, `${where}: a star in a text box ${JSON.stringify(s)} ${JSON.stringify(b)}`);
			}
		};
		for (const look of LOOKS) {
			for (const s of KEY_SCENARIOS) for (let i = 0; i < 6; i++) check(composeKeyScenario(s, "midnight", "theme", look), keyPlace(i, i % 4, { deviceSeed: `seed-${i}` }), 144, 144, `${look} ${s.id} ${i}`);
			for (const s of DIALS) for (let c = 0; c < 6; c++) check(dialFace(s, "graphite", look), dialPlace(c), 200, 100, `${look} ${s.id} ${c}`);
			const strip = sliceStrip(fixtureCase({ styles: ["trend", "lanes"], layout: "split", encoders: 6, background: look, accent: false, theme: "void" }).input);
			strip.slices.forEach((slice, c) => check(slice as string, dialPlace(c), 200, 100, `${look} strip ${c}`));
		}
		assert.ok(seen > 200, `the check saw ${seen} stars`);
	});

	it("text the painter cannot read draws no star at all", () => {
		const face = composeKeyScenario(keyScenario("single"), "midnight", "theme", "stars").replace('font-size="44"', 'font-size="big"');
		assert.equal(textBoxes(face), null);
		assert.deepEqual(starsIn(paintArt(face, keyPlace(2, 2))), []);
	});

	it("a text box covers its estimated ink with room to spare, snapped outward", () => {
		const [box] = textBoxes('<svg><text x="72" y="94" text-anchor="middle" font-family="Tahoma" font-size="44" font-weight="700" fill="#FFFFFF">56.3</text></svg>')!;
		assert.ok(box !== undefined && box.x0 <= 30 && box.x1 >= 114 && box.y0 <= 94 - 0.76 * 44 && box.y1 >= 94 + 0.03 * 44);
		assert.equal(box.x0 % 12, 0);
		assert.equal(box.x1 % 12, 0);
	});

	it("a text's size and anchor come from the group around it when it leaves them out, as the renderer inherits them", () => {
		const inline = textBoxes('<svg><text x="94" y="18" text-anchor="end" font-size="13">33</text><text x="32" y="18" text-anchor="start" font-size="11">3</text><text x="100" y="90" text-anchor="middle" font-size="16">1 min</text></svg>');
		const grouped = textBoxes('<svg><g text-anchor="end" font-family="Tahoma" font-size="13" fill="#FFFFFF"><text x="94" y="18">33</text><g font-size="11"/><g font-size="11"><text x="32" y="18" text-anchor="start">3</text></g></g><text x="100" y="90" text-anchor="middle" font-size="16">1 min</text></svg>');
		assert.ok(inline !== null);
		assert.deepEqual(grouped, inline);
		assert.equal(textBoxes('<svg><g fill="#FFFFFF"><text x="94" y="18">33</text></g></svg>'), null, "no size anywhere: unreadable, no star");
		assert.equal(textBoxes('<svg><g font-size="13"></g><text x="94" y="18">33</text></svg>'), null, "a closed group gives nothing to the text after it");
	});
});

// ---- contrast ------------------------------------------------------------------------------

const lift = (a: string, b: string): number => Math.max(...[1, 3, 5].map((o) => Math.abs(parseInt(a.slice(o, o + 2), 16) - parseInt(b.slice(o, o + 2), 16))));
const channels = (c: string): number[] => [1, 3, 5].map((o) => parseInt(c.slice(o, o + 2), 16));

/** A field's share and color at d (the field looks): its stops, share and
 * color each linear between them (any blend of the stop colors stays among
 * them), the first stop's inside it, nothing at and past the rim. */
function fieldAt(stops: readonly (readonly [number, number, string?])[], fallback: string, d: number): { share: number; color: number[] } {
	const color = (i: number): number[] => channels(stops[i]![2] ?? fallback);
	if (d >= 1) return { share: 0, color: color(stops.length - 1) };
	if (d <= stops[0]![0]) return { share: stops[0]![1], color: color(0) };
	for (let i = 1; i < stops.length; i++) {
		const [o0, f0] = stops[i - 1]!;
		const [o1, f1] = stops[i]!;
		if (d <= o1) {
			const k = (d - o0) / (o1 - o0);
			const [a, b] = [color(i - 1), color(i)];
			return { share: f0 + (f1 - f0) * k, color: a.map((v, j) => v + (b[j]! - v) * k) };
		}
	}
	return { share: 0, color: color(stops.length - 1) };
}

/** The scene's composite at a panel point, per channel, as source-over in
 * 8-bit sRGB: the base, the band, then each cloud in draw order. Stars are
 * left out: they never sit under text. */
const BLOBS = new WeakMap<ArtScene, ArtScene["items"]>();
function compositeAt(scene: ArtScene, x: number, y: number): number[] {
	let blobs = BLOBS.get(scene);
	if (blobs === undefined) {
		blobs = scene.items.filter((it) => it.kind === "blob");
		BLOBS.set(scene, blobs);
	}
	let c = channels(scene.bg);
	const over = (color: string | number[], a: number): void => {
		const top = typeof color === "string" ? channels(color) : color;
		c = c.map((v, i) => v + (top[i]! - v) * a);
	};
	if (scene.band !== null) {
		const b = scene.band;
		const len2 = (b.x2 - b.x1) ** 2 + (b.y2 - b.y1) ** 2;
		const t = Math.max(0, Math.min(1, ((x - b.x1) * (b.x2 - b.x1) + (y - b.y1) * (b.y2 - b.y1)) / len2));
		over(b.color, b.alpha * (1 - Math.abs(2 * t - 1)));
	}
	for (const it of blobs) {
		if (it.kind !== "blob") continue;
		const p = scene.profiles[it.profile]!;
		const d = Math.hypot(x - it.cx, y - it.cy) / it.r;
		if (d >= 1) continue;
		if (p.shape !== undefined) {
			const f = fieldAt(p.shape, p.color, d);
			over(f.color, p.alpha * f.share);
			continue;
		}
		const shape = d >= 1 ? 0 : d <= 0.45 ? 1 - (0.4 * d) / 0.45 : (0.6 * (1 - d)) / 0.55;
		over(p.color, p.alpha * shape);
	}
	return c;
}

describe("contrast holds by construction", () => {
	const settings: TextSettings[] = [parseTextSettings({ textMode: "theme" })!, parseTextSettings({ textMode: "dim" })!, parseTextSettings({ textMode: "dim", textDimSecondary: true })!];

	it("every text role resolves to at least 4.5:1 on the look's ceiling, keys and dials, Theme and Dim, on every dark theme", () => {
		for (const look of LOOKS) {
			for (const theme of DARK) {
				const palette = resolvePalette(config, theme, null, "normal");
				const ceiling = artCeiling(look, palette);
				for (const s of settings) {
					const k = keyTextColors(look, palette, s);
					const d = dialTextColors(look, palette, s);
					for (const [role, color] of [...Object.entries(k), ...Object.entries(d)]) assert.ok(contrastRatio(color, ceiling) >= 4.5, `${look} ${theme} ${s.mode} ${role} ${color} on ${ceiling}: ${contrastRatio(color, ceiling).toFixed(2)}`);
				}
				// The value keeps its lead over the label: the Glass rule, which
				// gives way only to the label's own 4.5:1 floor (Ember's amber
				// value cannot get brighter without turning white).
				const t = artTextPalette(look, palette);
				assert.ok(contrastRatio(t.value, ceiling) / contrastRatio(t.label, ceiling) >= 1.72, `${look} ${theme}`);
			}
		}
	});

	it("a Trend strip's warn and crit words beside its limit bands read at 4.5:1 on the ceiling in their own hue, on Stars and Nebula and every dark theme; Theme draws them in the alert colors exactly", () => {
		// The fixture's Trend holds warn 70 and crit 85 on its first reading;
		// on a + XL both words are drawn (scene.ts bandLabels). The floor is
		// the one the badges and values keep on the ceiling (above).
		const words = (background: ArtLook | "theme", theme: string): { alert: { readonly warn: string; readonly crit: string }; drawn: { level: "warn" | "crit"; fill: string }[] } => {
			const { input } = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 6, background, accent: false, theme });
			const drawn = buildStripScene(input)
				.prims.filter((p): p is TextPrim => p.k === "text")
				.flatMap((p) => {
					const level = /(?:^|\s)(warn|crit) \d/.exec(p.text)?.[1] as "warn" | "crit" | undefined;
					return level === undefined ? [] : [{ level, fill: p.fill }];
				});
			return { alert: input.alertColors, drawn };
		};
		const apart = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
		const misses: string[] = [];
		for (const theme of DARK) {
			const palette = resolvePalette(config, theme, null, "normal");
			for (const look of LOOKS) {
				const ceiling = artCeiling(look, palette);
				const { alert, drawn } = words(look, theme);
				assert.deepEqual(drawn.map((w) => w.level).sort(), ["crit", "warn"], `${look} ${theme}: both words drawn`);
				for (const w of drawn) {
					if (contrastRatio(w.fill, ceiling) < 4.5) misses.push(`${look} ${theme} ${w.level} ${w.fill} on ${ceiling}: ${contrastRatio(w.fill, ceiling).toFixed(2)}`);
					if (apart(hueOf(w.fill).hue, hueOf(alert[w.level]).hue) > 4) misses.push(`${look} ${theme} ${w.level} ${w.fill} left the hue of ${alert[w.level]}`);
				}
			}
			const { alert, drawn } = words("theme", theme);
			assert.deepEqual(drawn.map((w) => w.level).sort(), ["crit", "warn"], `theme ${theme}: both words drawn`);
			for (const w of drawn) {
				assert.equal(w.fill, alert[w.level], `theme ${theme} ${w.level}`);
				assert.ok(contrastRatio(w.fill, palette.bg) >= 4.5, `theme ${theme} ${w.level} ${w.fill} on ${palette.bg}: ${contrastRatio(w.fill, palette.bg).toFixed(2)}`);
			}
		}
		assert.deepEqual(misses, []);
	});

	it("the art never draws past its ceiling: the nebula's clouds and the stars' band, sampled densely on every panel and many seeds", () => {
		// Stars: channel by channel. Nebula: by luminance, all text contrast
		// depends on (its ceiling is the brightest composite by luminance,
		// deck-art.ts cloudCeiling); its scene reaches as far as the theme's
		// value color allows (nebulaReach), as a painted face's does.
		const panels = [...Object.values(DECK_PANELS).map((p) => ({ id: p.id, w: p.w, h: p.h })), { id: "lone112x112", w: 112, h: 112 }, { id: "lone200x100", w: 200, h: 100 }];
		const hex = (c: readonly number[]): string => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
		for (const look of LOOKS) {
			for (const theme of DARK) {
				const p = config.themes[theme]!;
				const top = artCeiling(look, p);
				const ceiling = channels(top);
				for (const panel of panels) {
					// Three seeds for the cloud fields, two for the one-field looks (a
					// smooth gradient has no small structure for a seed to move).
					for (let seed = 0; seed < (look === "stars" || look === "nebula" ? 3 : 2); seed++) {
						const scene = artScene(look, panel, `seed-${seed}`, p.bg, p.label, p.value);
						const step = Math.max(3, Math.round(panel.w / 240)) + 0.5;
						for (let y = 0; y <= panel.h; y += step) {
							for (let x = 0; x <= panel.w; x += step) {
								const c = compositeAt(scene, x, y);
								if (look !== "stars") assert.ok(luminance(hex(c.map((v) => Math.ceil(v - 1e-9)))) <= luminance(top), `${look} ${theme} ${panel.id} seed ${seed} at ${x},${y}: ${c.map((v) => v.toFixed(1))} over ${top}`);
								else for (let i = 0; i < 3; i++) assert.ok(c[i]! <= ceiling[i]!, `${look} ${theme} ${panel.id} seed ${seed} at ${x},${y}: ${c.map((v) => v.toFixed(1))} over ${ceiling}`);
							}
						}
					}
				}
			}
		}
		assert.ok(NEBULA_COVERAGE <= 0.4 && BAND_ALPHA <= 0.15);
	});

	it("every Sky tone stays under its look's ceiling, by luminance (all text contrast depends on), on every look, dark theme and panel", () => {
		const panels = [...Object.values(DECK_PANELS).map((p) => ({ id: p.id, w: p.w, h: p.h })), { id: "lone112x112", w: 112, h: 112 }, { id: "lone200x100", w: 200, h: 100 }];
		const hex = (c: readonly number[]): string => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
		for (const look of LOOKS) {
			for (const theme of DARK) {
				const p = config.themes[theme]!;
				const top = luminance(artCeiling(look, p));
				for (const tone of ART_TONES.filter((t) => t !== "theme")) {
					for (const panel of panels) {
						const scene = artScene(look, panel, "seed-tone", p.bg, p.label, p.value, { tone, stars: "off" });
						const step = Math.max(6, Math.round(panel.w / 120)) + 0.5;
						for (let y = 0; y <= panel.h; y += step) {
							for (let x = 0; x <= panel.w; x += step) {
								const c = compositeAt(scene, x, y);
								assert.ok(luminance(hex(c.map((v) => Math.ceil(v - 1e-9)))) <= top, `${look} ${tone} ${theme} ${panel.id} at ${x},${y}`);
							}
						}
					}
				}
			}
		}
	});

	it("no look's ceiling is brighter than Nebula's on the same theme, by luminance: no label lifts further than on Nebula", () => {
		for (const theme of DARK) {
			const p = config.themes[theme]!;
			const top = luminance(artCeiling("nebula", p));
			for (const look of LOOKS) assert.ok(luminance(artCeiling(look, p)) <= top, `${look} ${theme}: ${artCeiling(look, p)} over Nebula's ${artCeiling("nebula", p)}`);
		}
	});

	it("Nebula reaches as far as each theme's value lead allows: 0.4 on the cool themes, less on Ember, never under the first candidate's 0.27", () => {
		for (const theme of DARK) {
			const reach = nebulaReach(config.themes[theme]!);
			assert.ok(reach >= NEBULA_MIN_COVERAGE && reach <= NEBULA_COVERAGE, `${theme} ${reach}`);
			if (theme !== "ember") assert.equal(reach, NEBULA_COVERAGE, theme);
		}
		assert.ok(nebulaReach(config.themes.ember!) < NEBULA_COVERAGE, "Ember's amber value cannot get brighter, so its clouds stop lower");
	});

	it("the lift stays moderate: labels and units move at most 45 levels per channel on Stars and 60 on every other look (Nebula's clouds were raised, 2026-10-26; no look's ceiling passes Nebula's), values at most 10", () => {
		for (const look of LOOKS) {
			const most = look === "stars" ? 45 : 60;
			for (const theme of DARK) {
				const palette = resolvePalette(config, theme, null, "normal");
				const t = artTextPalette(look, palette);
				assert.ok(lift(palette.value, t.value) <= 10, `${look} ${theme} value`);
				assert.ok(lift(palette.label, t.label) <= most && lift(palette.unit, t.unit) <= most, `${look} ${theme} label ${palette.label}->${t.label}, unit ${palette.unit}->${t.unit}`);
			}
		}
	});
});

describe("no art color reads as an alert", () => {
	const hues = [config.alerts.warn.bg, config.alerts.crit.bg, config.alertValues.warn, config.alertValues.crit].map((c) => hueOf(c).hue);
	const apart = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

	it("every theme's art colors, in every tone, sit at least 90 degrees from the warn and critical hues", () => {
		for (const theme of THEMES) {
			const p = config.themes[theme]!;
			for (const tone of ART_TONES) {
				const colors = artColors(p.bg, p.label, tone);
				for (const c of [colors.primary, colors.secondary, ...colors.clouds]) {
					const { hue } = hueOf(c);
					assert.ok(hue >= ART_HUES.from - 1 && hue <= ART_HUES.to + 1, `${theme} ${tone} ${c} ${hue}`);
					for (const h of hues) assert.ok(apart(hue, h) >= 90, `${theme} ${tone} ${c} is ${apart(hue, h).toFixed(0)} degrees from an alert hue`);
				}
			}
		}
	});

	it("every gradient a scene draws (every look, tone and dark theme) keeps its stops in the art hues, within 35 degrees of the art hue: the theme's color, one neighbour", () => {
		for (const theme of DARK) {
			const p = config.themes[theme]!;
			for (const look of LOOKS) {
				for (const tone of ART_TONES) {
					const art = hueOf(artColors(p.bg, p.label, tone).primary).hue;
					const scene = artScene(look, { id: "plusxl", w: 1280, h: 800 }, SEED, p.bg, p.label, p.value, { tone, stars: "off" });
					const colors = [...(scene.band === null ? [] : [scene.band.color]), ...scene.profiles.flatMap((q) => [q.color, ...(q.shape ?? []).map((s) => s[2] ?? q.color)])].filter((c) => c !== "#000000");
					for (const c of colors) {
						const { hue, saturation } = hueOf(c);
						if (saturation < 0.04) continue;
						for (const h of hues) assert.ok(apart(hue, h) >= 90, `${look} ${tone} ${theme} ${c}`);
						if (look !== "nebula") assert.ok(apart(hue, art) <= 35, `${look} ${tone} ${theme}: ${c} at ${hue.toFixed(0)} is ${apart(hue, art).toFixed(0)} degrees from the art hue ${art.toFixed(0)}`);
					}
				}
			}
		}
	});
});

// ---- the Sky: stars and colors as options of every look -------------------------------------

const sky = (tone: ArtTone, stars: ArtStars): ArtSky => ({ tone, stars });

describe("the Sky: Stars and Sky color are options of the same scene", () => {
	const paths = (painted: string): string[] => [...painted.matchAll(/<path fill="#[0-9A-F]{6}" d="([^"]*)"\/>/g)].flatMap((m) => (m[1] as string).split("M").filter((d) => d !== ""));

	it("the readers take the exact names of each axis (three amounts, five tones) and anything else is null: some, and combined names such as deep-few, included", () => {
		assert.deepEqual([...ART_STARS], ["all", "few", "off"]);
		assert.deepEqual([...ART_TONES], ["theme", "deep", "warm", "cool", "mono"]);
		for (const s of ART_STARS) assert.equal(artStarsOf(s), s);
		for (const t of ART_TONES) assert.equal(artToneOf(t), t);
		const NEAR: unknown[] = [undefined, null, "", "All", "ALL", " all", "all ", "some", "Some", "none", "stars", "deep-few", "deep-none", "warm-few", "warm-none", "On", "off ", "Cool", "COOL", "cool ", "warmer", "Warmer", "cooler", "mono-few", "deep-all", "warm-stars", "theme-few", "teal", "grey", 1, true, {}, ["cool"]];
		for (const raw of NEAR) {
			assert.equal(artStarsOf(raw), null, JSON.stringify(raw));
			assert.equal(artToneOf(raw), null, JSON.stringify(raw));
		}
		// Each axis: its own exact name, else null (the shared one follows).
		assert.deepEqual(ownArtSkyOf({}), { tone: null, stars: null });
		assert.deepEqual(ownArtSkyOf({ stars: "few", tone: "mono" }), { tone: "mono", stars: "few" });
		assert.deepEqual(ownArtSkyOf({ stars: "some", tone: "Cool" }), { tone: null, stars: null });
		assert.deepEqual(artSkyOf({ tone: null, stars: "off" }, sky("cool", "few")), sky("cool", "off"));
		assert.equal(artSkyOf({ tone: null, stars: null }), DEFAULT_SKY);
	});

	it("the Stars look keeps at least Few: a stored or shared Off draws Few there, byte for byte, and every other look draws Off as Off", () => {
		for (const look of LOOKS) for (const stars of ART_STARS) assert.equal(drawnStars(look, stars), look === "stars" && stars === "off" ? "few" : stars, `${look} ${stars}`);
		let drawn = 0;
		for (const theme of DARK) {
			for (const id of ["single", "dual", "quad"]) {
				const at = (look: ArtLook, stars: ArtStars, c: number, r: number): string => paintArt(withArtSky(composeKeyScenario(keyScenario(id), theme, "theme", look), sky("theme", stars)), keyPlace(c, r));
				for (const [c, r] of [[0, 0], [4, 2], [8, 3]] as const) {
					assert.equal(at("stars", "off", c, r), at("stars", "few", c, r), `${theme} ${id}: Stars Off draws Few`);
					drawn += paths(at("stars", "off", c, r)).length;
				}
			}
			// A strip on Stars with Off (its own, or the shared one it follows): the slices draw Few.
			const c = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 6, background: "stars", accent: false, theme });
			const off = sliceStrip({ ...c.input, config: { ...c.input.config, stars: "off" } });
			const few = sliceStrip({ ...c.input, config: { ...c.input.config, stars: "few" } });
			off.slices.forEach((slice, i) => assert.equal(paintArt(slice as string, dialPlace(i)), paintArt(few.slices[i] as string, dialPlace(i)), `${theme} strip ${i}`));
		}
		assert.ok(drawn > 0, `"Background: Stars" with Off still draws stars (${drawn} on the sampled keys)`);
		setSharedLooks(parseSharedLooks({ keyBackground: "stars", keyStars: "off" }));
		assert.equal(paintArt(composeKeyScenario(keyScenario("single"), "midnight", "theme"), keyPlace(4, 2)), paintArt(withArtSky(composeKeyScenario(keyScenario("single"), "midnight", "theme", "stars"), sky("theme", "few")), keyPlace(4, 2)), "a shared Off on a key that follows the shared Stars draws Few");
		setSharedLooks(NO_SHARED_LOOKS);
		// Dusk and Nebula: Off is the field alone, not Few.
		for (const look of ["dusk", "nebula"] as const) {
			const face = composeKeyScenario(keyScenario("single"), "midnight", "theme", look);
			const deck = (stars: ArtStars): string[] => Array.from({ length: 36 }, (_, i) => paintArt(withArtSky(face, sky("theme", stars)), keyPlace(i % 9, Math.floor(i / 9))));
			const off = deck("off");
			assert.equal(off.flatMap(paths).length, 0, `${look}: Off draws no star`);
			assert.ok(deck("few").flatMap(paths).length > 0, `${look}: Few draws stars`);
		}
	});

	it("the default writes the marker as before byte for byte; every other Sky rides in the marker, stamped once, and the painter reads it", () => {
		const p = config.themes.midnight!;
		assert.equal(artMark("nebula", 144, 144, p), artMark("nebula", 144, 144, p, DEFAULT_SKY));
		assert.equal(artMark("stars", 144, 144, p), `<rect width="144" height="144" fill="${p.bg}" data-art="stars ${p.label}"/>`);
		assert.equal(artMark("dusk", 144, 144, p, sky("deep", "few")), `<rect width="144" height="144" fill="${p.bg}" data-art="dusk.deep-few ${p.label} ${p.value}"/>`);
		assert.equal(skyMark(sky("cool", "all")), "cool");
		assert.equal(skyMark(sky("theme", "off")), "off");
		assert.equal(skyMark(sky("mono", "few")), "mono-few");
		const names = new Set<string>();
		for (const look of LOOKS) {
			const face = composeKeyScenario(keyScenario("dual"), "midnight", "theme", look);
			assert.equal(withArtSky(face, DEFAULT_SKY), face, "the default leaves the face as it was");
			assert.equal(withArtSky(withArtSky(face, sky("theme", "few")), sky("deep", "all")), withArtSky(face, sky("theme", "few")), "a stamped marker keeps its Sky");
			const plain = paintArt(face, keyPlace(3, 1));
			const drawn = new Set<string>();
			for (const tone of ART_TONES) {
				for (const stars of ART_STARS) {
					const name = skyMark(sky(tone, stars));
					names.add(name);
					const stamped = withArtSky(face, sky(tone, stars));
					assert.equal(stamped.includes(`data-art="${look}${name === "" ? "" : `.${name}`} `), true, `${look} ${name}`);
					const painted = paintArt(stamped, keyPlace(3, 1));
					assert.equal(MARKS(painted), 0, `${look} ${name}: the painter reads the marker`);
					drawn.add(painted);
				}
			}
			assert.ok(drawn.size >= ART_TONES.length, `${look}: ${drawn.size} of 15 Skies draw their own bytes on one key`);
			for (const tone of ["deep", "warm", "cool", "mono"] as const) assert.notEqual(paintArt(withArtSky(face, sky(tone, "all")), keyPlace(3, 1)), plain, `${look}: ${tone} draws other colors`);
		}
		assert.equal(names.size, 15);
		const theme = composeKeyScenario(keyScenario("dual"), "midnight", "theme");
		assert.equal(withArtSky(theme, sky("deep", "few")), theme, "a face with no marker is left alone");
	});

	it("three nested levels: Off draws no star and no glow (Dusk, Nebula), Few is the brightest fifth of All's stars (rank 0.8 or more), the same stars at the same places; a tone never moves one", () => {
		const p = config.themes.midnight!;
		for (const look of LOOKS) {
			// The scene: Few keeps exactly All's stars of rank 0.8 or more.
			const view = { id: "plusxl", w: 1280, h: 800 };
			const starsOf = (stars: ArtStars) => artScene(look, view, SEED, p.bg, p.label, p.value, sky("theme", stars)).items.filter((it) => it.kind === "star");
			const allStars = starsOf("all");
			const fewStars = starsOf("few");
			assert.deepEqual(fewStars, allStars.filter((it) => it.kind === "star" && it.rank >= 0.8), `${look}: Few is All's brightest fifth`);
			assert.ok(fewStars.length >= allStars.length * 0.15 && fewStars.length <= allStars.length * 0.25, `${look}: ${fewStars.length} of ${allStars.length}`);
			if (look !== "stars") assert.deepEqual(starsOf("off"), [], `${look} off`);
			// The faces.
			const counts = { all: 0, few: 0 };
			for (let r = 0; r < 4; r++) {
				for (let c = 0; c < 9; c++) {
					const face = composeKeyScenario(keyScenario("single"), "midnight", "theme", look);
					const at = (s: ArtSky): string => paintArt(withArtSky(face, s), keyPlace(c, r));
					const all = paths(at(DEFAULT_SKY));
					const few = paths(at(sky("theme", "few")));
					counts.all += all.length;
					counts.few += few.length;
					for (const d of few) assert.ok(all.includes(d), `${look} ${c},${r}: a Few star that All does not draw`);
					const off = at(sky("theme", "off"));
					if (look === "stars") assert.equal(off, at(sky("theme", "few")), "the Stars look's Off draws Few");
					else {
						assert.deepEqual(paths(off), [], `${look} off`);
						assert.ok(!off.includes("url(#g)"), `${look} off draws no glow`);
					}
					for (const tone of ["deep", "warm", "cool", "mono"] as const) {
						assert.deepEqual(paths(at(sky(tone, "all"))).sort(), [...all].sort(), `${look} ${tone}: the stars stay put`);
						assert.deepEqual(paths(at(sky(tone, "few"))).sort(), [...few].sort(), `${look} ${tone} few: the same stars`);
					}
				}
			}
			assert.ok(counts.few > 0 && counts.few < counts.all * 0.3, `${look}: few ${counts.few}, all ${counts.all}`);
		}
	});

	it("fewer stars never cost more: on every panel, look, tone and seed, each face's piece at Few and Off has no more bytes and no more elements than at the amount above it", () => {
		const elements = (s: string): number => (s.match(/<[a-z]/g) ?? []).length;
		const p = config.themes.midnight!;
		let faces = 0;
		for (const look of LOOKS) {
			for (const tone of ART_TONES) {
				for (let seed = 0; seed < 3; seed++) {
					for (const panel of Object.values(DECK_PANELS)) {
						const view = { id: panel.id, w: panel.w, h: panel.h };
						const scenes = ART_STARS.map((stars) => artScene(look, view, `cost-${seed}`, p.bg, p.label, p.value, sky(tone, stars)));
						const rects = [...Array.from({ length: panel.rows * panel.columns }, (_, i) => ({ rect: keyRect(panel, i % panel.columns, Math.floor(i / panel.columns))!, w: 144, h: 144 })), ...(panel.strip === null ? [] : Array.from({ length: panel.strip.w / 200 }, (_, c) => ({ rect: sliceRect(panel, c)!, w: 200, h: 100 })))];
						for (const { rect, w, h } of rects) {
							faces++;
							const pieces = scenes.map((scene) => artPiece(scene, rect, w, h, [{ x0: 24, y0: 40, x1: 120, y1: 80 }]));
							for (let j = 1; j < pieces.length; j++) {
								assert.ok(pieces[j]!.length <= pieces[j - 1]!.length, `${look} ${tone} ${panel.id} ${rect.x},${rect.y}: ${ART_STARS[j]} ${pieces[j]!.length} B over ${ART_STARS[j - 1]} ${pieces[j - 1]!.length} B`);
								assert.ok(elements(pieces[j]!) <= elements(pieces[j - 1]!), `${look} ${tone} ${panel.id} ${rect.x},${rect.y}: ${ART_STARS[j]} elements`);
							}
						}
					}
				}
			}
		}
		assert.ok(faces > 2000, `${faces} faces`);
	});

	it("a tone costs what the theme tone costs: the same elements on every face, and within 1 % of its bytes (only the colors change)", () => {
		const elements = (s: string): number => (s.match(/<[a-z]/g) ?? []).length;
		for (const look of LOOKS) {
			for (const theme of DARK) {
				const p = config.themes[theme]!;
				const view = { id: "plusxl", w: 1280, h: 800 };
				const own = artScene(look, view, SEED, p.bg, p.label, p.value);
				for (const tone of ["deep", "warm", "cool", "mono"] as const) {
					const scene = artScene(look, view, SEED, p.bg, p.label, p.value, sky(tone, "all"));
					let base = 0;
					let toned = 0;
					for (let i = 0; i < 36; i++) {
						const rect = keyRect(plusXl, i % 9, Math.floor(i / 9))!;
						const a = artPiece(own, rect, 144, 144, []);
						const b = artPiece(scene, rect, 144, 144, []);
						assert.equal(elements(b), elements(a), `${look} ${theme} ${tone} key ${i}`);
						base += a.length;
						toned += b.length;
					}
					assert.ok(Math.abs(toned - base) <= base * 0.01, `${look} ${theme} ${tone}: ${toned} B against ${base} B`);
				}
			}
		}
	});

	it("every tone is its own color where it is drawn: Cool and Mono sit at least 5 (CIEDE2000) from every other tone on Dusk and Nebula and 1.2 on Stars; Deep is darker, Warm moves 6 or reaches the warm end, on every look and dark theme", () => {
		// The drawn field, not a stop color: the composite (compositeAt, stars
		// off) at points 6 px apart on every + XL key and strip slice, over
		// the brightest tenth of the theme tone's points (what reads as the
		// sky's color), the mean distance per point. On Stars only the band,
		// at BAND_ALPHA, carries the tone, so the Sky color is subtle there and
		// the floor lower; the floor still keeps every tone from collapsing
		// into another.
		const FLOOR: Readonly<Record<ArtLook, number>> = { stars: 1.2, dusk: 5, nebula: 5 };
		const view = { id: "plusxl", w: 1280, h: 800 };
		const hex = (c: readonly number[]): string => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
		const points: [number, number][] = [];
		const rects = [...Array.from({ length: 36 }, (_, i) => keyRect(plusXl, i % 9, Math.floor(i / 9))!), ...Array.from({ length: 6 }, (_, c) => sliceRect(plusXl, c)!)];
		for (const r of rects) for (let y = r.y + 3; y < r.y + r.h; y += 6) for (let x = r.x + 3; x < r.x + r.w; x += 6) points.push([x, y]);
		for (const theme of DARK) {
			const p = config.themes[theme]!;
			for (const look of LOOKS) {
				const scene = (tone: ArtTone): ArtScene => artScene(look, view, SEED, p.bg, p.label, p.value, sky(tone, "off"));
				const own = scene("theme");
				const lit = points.map(([x, y]) => ({ x, y, l: luminance(hex(compositeAt(own, x, y))) })).sort((a, b) => b.l - a.l).slice(0, Math.floor(points.length / 10));
				const drawn = new Map(ART_TONES.map((tone) => [tone, lit.map(({ x, y }) => hex(compositeAt(scene(tone), x, y)))] as const));
				for (const tone of ["cool", "mono"] as const) {
					for (const other of ART_TONES.filter((t) => t !== tone)) {
						const a = drawn.get(tone)!;
						const b = drawn.get(other)!;
						const de = a.reduce((sum, c, i) => sum + ciede2000(c, b[i]!), 0) / a.length;
						assert.ok(de >= FLOOR[look], `${look} ${theme}: ${tone} vs ${other} drawn ${de.toFixed(1)} under ${FLOOR[look]}`);
					}
				}
				// Warm and Deep, on the field's own color.
				const field = (tone: ArtTone): string => {
					const s = scene(tone);
					return s.band?.color ?? s.profiles[0]!.color;
				};
				// Warm is as warm as the alert rule lets it be: 6 or more from the
				// theme's own, or its hue at the warm end of ART_HUES (Forest's
				// green sits 18 degrees from it).
				const warmHue = hueOf(artColors(p.bg, p.label, "warm").primary).hue;
				const atEnd = Math.abs(warmHue - ART_HUES.from) <= 1 || Math.abs(warmHue - ART_HUES.to) <= 1;
				assert.ok(ciede2000(field("warm"), field("theme")) >= 6 || atEnd, `${look} ${theme}: Warm ${field("warm")} vs ${field("theme")}: ${ciede2000(field("warm"), field("theme")).toFixed(1)}`);
				assert.ok(luminance(field("deep")) < luminance(field("theme")), `${look} ${theme}: Deep is darker`);
			}
		}
	});

	it("Cool turns toward teal and cyan (a blue theme's to 185-195, a green one's to 175-185, a violet one's toward blue) and Dusk drifts to its own second hue; Mono is the same silver-blue near grey on every theme", () => {
		const own = (theme: string): number => hueOf(artColors(config.themes[theme]!.bg, config.themes[theme]!.label).primary).hue;
		const cool = (theme: string): { hue: number; second: number } => {
			const c = artColors(config.themes[theme]!.bg, config.themes[theme]!.label, "cool");
			return { hue: hueOf(c.primary).hue, second: hueOf(c.secondary).hue };
		};
		for (const theme of ["void", "graphite", "midnight"]) {
			assert.ok(cool(theme).hue >= 185 && cool(theme).hue <= 195, `${theme} ${cool(theme).hue}`);
			assert.ok(cool(theme).second >= 165 && cool(theme).second < cool(theme).hue, `${theme}: its teal ${cool(theme).second}`);
		}
		assert.ok(cool("forest").hue >= 175 && cool("forest").hue <= 185, `forest ${cool("forest").hue}`);
		for (const theme of ["ultraviolet", "ember"]) assert.ok(cool(theme).hue < own(theme) - 30 && cool(theme).hue >= 200 && cool(theme).hue <= 235, `${theme} ${own(theme)} -> ${cool(theme).hue}`);
		for (const theme of DARK) {
			const p = config.themes[theme]!;
			// Dusk's sky above the horizon: Cool's second hue, never back
			// toward the theme's own (Ultraviolet's and Ember's 30 degrees on).
			const dusk = artScene("dusk", { id: "plusxl", w: 1280, h: 800 }, SEED, p.bg, p.label, p.value, sky("cool", "off")).profiles[0]!;
			const upper = hueOf(dusk.shape!.at(-1)![2] ?? dusk.color).hue;
			assert.ok(Math.abs(upper - cool(theme).second) <= 3, `${theme}: Cool's Dusk sky at ${upper.toFixed(0)}, its second hue ${cool(theme).second.toFixed(0)}`);
			const c = artColors(p.bg, p.label, "mono");
			const first = hueOf(c.primary);
			const second = hueOf(c.secondary);
			assert.ok(first.saturation <= 0.15 && second.saturation <= 0.15, `${theme} mono ${c.primary} ${c.secondary}`);
			assert.ok(Math.abs(first.hue - 215) <= 5 && Math.abs(second.hue - 175) <= 5, `${theme} mono hues ${first.hue.toFixed(0)}, ${second.hue.toFixed(0)}`);
		}
	});
});

describe("the stored Sky: Stars and Sky color beside Background, per key, dial and strip and shared, today's look by default", () => {
	it("a key and a dial take each axis's own exact name, else the shared one, else today's; the composer stamps it into the marker", () => {
		assert.equal(keySkyFor(undefined), DEFAULT_SKY);
		assert.deepEqual(dialSkyFor({ dialStars: "Few", dialSkyColor: "COOL" }), DEFAULT_SKY);
		setSharedLooks(parseSharedLooks({ keyBackground: "nebula", dialBackground: "dusk", keyStars: "few", keySkyColor: "cool", dialStars: "off" }));
		assert.deepEqual(keySkyFor(undefined), sky("cool", "few"));
		assert.deepEqual(keySkyFor({ keyStars: "", keySkyColor: "" }), sky("cool", "few"), "Default (the empty value) follows the shared one");
		assert.deepEqual(keySkyFor({ keyStars: "all" }), sky("cool", "all"), "an own Stars wins, the shared Sky color stays");
		assert.deepEqual(keySkyFor({ keySkyColor: "mono" }), sky("mono", "few"));
		assert.deepEqual(keySkyFor({ keyStars: "some" }), sky("cool", "few"), "a name this build does not know (some) follows the shared one");
		assert.deepEqual(dialSkyFor(undefined), sky("theme", "off"));
		assert.match(composeKeyScenario(keyScenario("single"), "midnight", "theme"), / data-art="nebula\.cool-few #/);
		assert.match(composeKeyScenario(keyScenario("single"), "midnight", "theme", undefined, { keyStars: "off" }), / data-art="nebula\.cool-off #/);
		assert.match(dialFace(DIALS[0]!, "midnight"), / data-art="dusk\.off #/);
		assert.match(dialFace({ ...DIALS[0]!, settings: { dialSkyColor: "warm", dialStars: "all" } }, "midnight"), / data-art="dusk\.warm #/);
		setSharedLooks(parseSharedLooks({ keyStars: "Few", dialSkyColor: 3 }));
		assert.equal(sharedLooks().keySky, DEFAULT_SKY);
		assert.equal(sharedLooks().dialSky, DEFAULT_SKY);
		// A combined Sky field (keySky, dialSky) is no setting: nothing reads
		// it, on an action or shared.
		setSharedLooks(parseSharedLooks({ keySky: "deep-few", dialSky: "warm" } as Record<string, unknown>));
		assert.equal(sharedLooks().keySky, DEFAULT_SKY);
		assert.equal(sharedLooks().dialSky, DEFAULT_SKY);
		assert.equal(keySkyFor({ keySky: "warm-none" } as Record<string, unknown>), DEFAULT_SKY);
		// Today's Sky leaves every face as it was, byte for byte.
		setSharedLooks(NO_SHARED_LOOKS);
		assert.equal(composeKeyScenario(keyScenario("single"), "midnight", "theme", "nebula", { keyStars: "all", keySkyColor: "theme" }), composeKeyScenario(keyScenario("single"), "midnight", "theme", "nebula"));
		assert.equal(composeKeyScenario(keyScenario("single"), "midnight", "theme", "nebula", { keySky: "deep-few" }), composeKeyScenario(keyScenario("single"), "midnight", "theme", "nebula"));
	});

	it("an own Stars or Sky color counts and goes with the own Background: the count line, Use it everywhere, and a strip's copy", () => {
		assert.equal(ownLooksOf({ keyStars: "few" }, OWN_LOOK_FIELDS.key).background, true);
		assert.equal(ownLooksOf({ keySkyColor: "mono" }, OWN_LOOK_FIELDS.key).background, true);
		assert.equal(ownLooksOf({ keyStars: "Few", keySkyColor: "", keySky: "cool" }, OWN_LOOK_FIELDS.key).background, false);
		assert.equal(ownLooksOf({ keyStars: "some" }, OWN_LOOK_FIELDS.key).background, false, "a name this build does not know is no own Sky");
		assert.deepEqual(withoutOwnLooks({ keyBackground: "dusk", keyStars: "off", keySkyColor: "cool", readingKey: "x" }, OWN_LOOK_FIELDS.key), { readingKey: "x" });
		const dropped = staleLooksReset({ dialStars: "off", dialSkyColor: "warm", looksGen: 1 }, "dial", 2);
		assert.deepEqual([dropped?.dialStars, dropped?.dialSkyColor], [undefined, undefined], "Use it everywhere drops an older own Sky");
		assert.equal(ownLooksOf({ stars: "few" }, STRIP_LOOK_FIELDS).background, true);
		assert.equal(ownLooksOf({ skyColor: "cool" }, STRIP_LOOK_FIELDS).background, true);
		assert.equal(ownLooksOf({ sky: "warm" }, STRIP_LOOK_FIELDS).background, false);
	});

	it("a strip keeps its own exact Stars and Sky color through a round trip, drops anything else from them, keeps a field it does not know, resolves them per axis and draws them", () => {
		const own = stripConfigOf({ stars: "few", skyColor: "mono" });
		assert.deepEqual([own.stars, own.skyColor], ["few", "mono"]);
		const near = stripConfigOf({ stars: "Few", skyColor: "cool " });
		assert.deepEqual([near.stars, near.skyColor], [undefined, undefined]);
		for (const stars of ART_STARS) for (const tone of ART_TONES) {
			const json = stripConfigToJson(stripConfigOf({ stars, skyColor: tone }));
			assert.deepEqual([json.stars, json.skyColor], [stars, tone]);
			assert.deepEqual(stripConfigOf(json), stripConfigOf({ stars, skyColor: tone }), `${stars} ${tone} round trip`);
		}
		const unknown = stripConfigOf({ stars: "some" });
		assert.equal(unknown.stars, undefined, "some is no amount: Default");
		// A stored field this build does not know (a combined sky) is kept as
		// it was when the strip is written, and ignored.
		const raw = { ...stripConfigToJson(stripConfigOf({})), sky: "deep-few" };
		assert.equal(stripConfigToJson(stripConfigOf(raw), raw).sky, "deep-few");
		assert.deepEqual(stripSkyFor(stripConfigOf(raw)), DEFAULT_SKY);
		const reset = withDefaultLooks(stripConfigOf({ background: "dusk", stars: "off", skyColor: "deep" }));
		assert.deepEqual([reset.stars, reset.skyColor], [undefined, undefined]);
		setSharedLooks(parseSharedLooks({ dialStars: "few", dialSkyColor: "cool" }));
		assert.deepEqual(stripSkyFor(stripConfigOf({ skyColor: "mono" })), sky("mono", "few"));
		assert.deepEqual(stripSkyFor(stripConfigOf({ stars: "all" })), sky("cool", "all"));
		assert.deepEqual(stripLookOf(stripConfigOf({})).sky, sky("cool", "few"));
		setSharedLooks(NO_SHARED_LOOKS);
		const c = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 6, background: "dusk", accent: false, theme: "midnight" });
		const result = sliceStrip({ ...c.input, config: { ...c.input.config, stars: "off", skyColor: "deep" } });
		for (const slice of result.slices) assert.match(slice as string, / data-art="dusk\.deep-off #/);
		const plain = sliceStrip({ ...c.input, config: { ...c.input.config, stars: "all", skyColor: "theme" } });
		assert.deepEqual(plain.slices, sliceStrip(c.input).slices, "the default Sky draws the strip as before");
	});
});

// ---- Dusk stays its own look -------------------------------------------------------------

/**
 * A whole-deck color difference: a + XL deck as the plugin sends it (36
 * keys of twelve scenarios and a Trend strip with its words), rasterized by
 * librsvg at its LCD size on a black LCD, scaled to a quarter (320 x 200,
 * cubic), CIE76 mean over face pixels only: the midnight Theme deck's
 * pixels brighter than a channel sum of 6, each small pixel kept only when
 * its whole 6 x 6 neighbourhood is face. The words are the same in both
 * decks, so a larger face font dilutes the difference: both are measured.
 */
const GATE_KEYS = ["single-sparkline", "single-ring", "single-bar", "dual", "single", "triple", "quad-labels-min", "single-ring-max", "dual-max", "quad", "triple-avg", "back-bar"];
const GATE_SEEDS = [SEED, "DEADBEEF00112233", "A1C9E44B7D2F8061"];
const GATE_FONTS = ["tahoma", "segoe-ui"] as const;
const GATE_SIZE = /(<svg\b[^>]*?)\swidth="[\d.]+"\s+height="[\d.]+"/;
function useFaceFont(font: (typeof GATE_FONTS)[number]): void {
	setFaceFont(font);
	applyGlobalThemeSettings({ theme: "void", typeAccents: true, textMode: "theme", textFont: font });
}
/** Each item through `f`, two at a time, in order. */
async function inPairs<T, R>(items: readonly T[], f: (item: T) => Promise<R>): Promise<R[]> {
	const out: R[] = [];
	for (let i = 0; i < items.length; i += 2) out.push(...(await Promise.all(items.slice(i, i + 2).map(f))));
	return out;
}
async function gateDeck(look: ArtLook | "theme", theme: string, stars: ArtStars, seed: string): Promise<Buffer> {
	// Each face at its LCD size (a face the pattern missed would draw at its
	// own size, so it fails here instead).
	const sized = (svg: string, w: number, h: number): Buffer => {
		assert.match(svg, GATE_SIZE);
		return Buffer.from(svg.replace(GATE_SIZE, `$1 width="${w}" height="${h}"`));
	};
	const deck = { id: seed, type: 13, columns: 9, rows: 4 };
	const faces: { svg: string; rect: { x: number; y: number; w: number; h: number } }[] = [];
	for (let r = 0; r < 4; r++) {
		for (let c = 0; c < 9; c++) {
			const s = keyScenario(GATE_KEYS[(r * 9 + c) % GATE_KEYS.length]!);
			const face = look === "theme" ? composeKeyScenario(s, theme, "theme") : withArtSky(composeKeyScenario(s, theme, "theme", look), sky("theme", stars));
			faces.push({ svg: paintArt(face, artPlace(deck, { column: c, row: r }, `k-${c}-${r}`, false)), rect: keyRect(plusXl, c, r)! });
		}
	}
	const strip = sliceStrip(fixtureCase({ styles: ["trend"], layout: "whole", encoders: 6, background: look, accent: false, theme }).input);
	for (let c = 0; c < 6; c++) {
		const slice = look === "theme" ? (strip.slices[c] as string) : withArtSky(strip.slices[c] as string, sky("theme", stars));
		faces.push({ svg: paintArt(slice, artPlace(deck, { column: c, row: 0 }, `d-${c}`, true)), rect: sliceRect(plusXl, c)! });
	}
	// Raw pixels throughout: the same pixels a PNG round trip keeps, without
	// its compression.
	const layers = await inPairs(faces, async ({ svg, rect }) => ({ input: await sharp(sized(svg, rect.w, rect.h)).ensureAlpha().raw().toBuffer(), raw: { width: rect.w, height: rect.h, channels: 4 as const }, left: rect.x, top: rect.y }));
	return sharp({ create: { width: 1280, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).composite(layers).removeAlpha().raw().toBuffer();
}
const DECK_RAW = { raw: { width: 1280, height: 800, channels: 3 as const } };
function cieLab(r: number, g: number, b: number): [number, number, number] {
	const lin = (v: number): number => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
	const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
	const [R, G, B] = [lin(r), lin(g), lin(b)];
	const X = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
	const Y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
	const Z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
	return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
async function quarterLab(deck: Buffer): Promise<Float32Array> {
	const raw = await sharp(deck, DECK_RAW).resize(320, 200, { kernel: "cubic" }).raw().toBuffer();
	const out = new Float32Array(320 * 200 * 3);
	for (let i = 0; i < 320 * 200; i++) out.set(cieLab(raw[3 * i]!, raw[3 * i + 1]!, raw[3 * i + 2]!), 3 * i);
	return out;
}
function faceMask(full: Buffer): Uint8Array {
	const face = new Uint8Array(1280 * 800);
	for (let i = 0; i < 1280 * 800; i++) face[i] = full[3 * i]! + full[3 * i + 1]! + full[3 * i + 2]! > 6 ? 1 : 0;
	const mask = new Uint8Array(320 * 200);
	for (let y = 0; y < 200; y++) {
		for (let x = 0; x < 320; x++) {
			let all = 1;
			for (let dy = -1; dy < 5 && all === 1; dy++) for (let dx = -1; dx < 5 && all === 1; dx++) if (face[Math.min(799, Math.max(0, 4 * y + dy)) * 1280 + Math.min(1279, Math.max(0, 4 * x + dx))] === 0) all = 0;
			mask[y * 320 + x] = all;
		}
	}
	return mask;
}
function deckDistance(mask: Uint8Array, a: Float32Array, b: Float32Array): number {
	let n = 0;
	let sum = 0;
	for (let i = 0; i < 320 * 200; i++) {
		if (mask[i] === 0) continue;
		n++;
		sum += Math.hypot(a[3 * i]! - b[3 * i]!, a[3 * i + 1]! - b[3 * i + 1]!, a[3 * i + 2]! - b[3 * i + 2]!);
	}
	return sum / n;
}

describe("Dusk stays its own look on every dark theme", () => {
	it("at Sky color Theme with no stars, Dusk sits at least 6.0 from the Theme deck and 5.0 from Stars (Few, the least it draws) and from Nebula (Off), in Tahoma and Segoe UI at three deck seeds, and from Stars All and Nebula All at the golden seed", async () => {
		sharp.concurrency(2);
		const seen: string[] = [];
		try {
			for (const font of GATE_FONTS) {
				useFaceFont(font);
				const mask = faceMask(await gateDeck("theme", "midnight", "all", SEED));
				for (const theme of DARK) {
					const plain = await quarterLab(await gateDeck("theme", theme, "all", SEED));
					for (const seed of GATE_SEEDS) {
						const dusk = await quarterLab(await gateDeck("dusk", theme, "off", seed));
						const against: [string, ArtLook | "theme", ArtStars, number][] = [["Theme", "theme", "all", 6], ["Stars Few", "stars", "few", 5], ["Nebula Off", "nebula", "off", 5]];
						if (seed === SEED) against.push(["Stars All", "stars", "all", 5], ["Nebula All", "nebula", "all", 5]);
						for (const [name, look, stars, floor] of against) {
							const d = deckDistance(mask, dusk, look === "theme" ? plain : await quarterLab(await gateDeck(look, theme, stars, seed)));
							seen.push(`${font} ${seed} ${theme} ${name} ${d.toFixed(2)}`);
							assert.ok(d >= floor, `${font} ${seed} ${theme}: Dusk is ${d.toFixed(2)} from ${name}, under ${floor} (${seen.join(", ")})`);
						}
					}
				}
			}
		} finally {
			useFaceFont("tahoma");
		}
	});
});

// ---- bytes -----------------------------------------------------------------------------------

describe("cost: no image files, a bounded piece per face", () => {
	const uri = (svg: string): number => `data:image/svg+xml,${encodeURIComponent(svg)}`.length;

	it("a full + XL deck adds at most 1.6 KB per key image at the median, as sent, for every look", () => {
		const ids = ["single-sparkline", "single-ring", "single-bar", "dual", "single", "triple", "quad-labels-min", "single-ring-max", "dual-max", "quad", "triple-avg", "back-bar"];
		for (const look of LOOKS) {
			const extra: number[] = [];
			for (let r = 0; r < 4; r++) {
				for (let c = 0; c < 9; c++) {
					const s = keyScenario(ids[(r * 9 + c) % ids.length]!);
					extra.push(uri(paintArt(composeKeyScenario(s, "midnight", "theme", look), keyPlace(c, r))) - uri(composeKeyScenario(s, "midnight", "theme")));
				}
			}
			extra.sort((a, b) => a - b);
			assert.ok(extra[18]! <= 1600, `${look}: median ${extra[18]}`);
		}
	});

	it("no piece passes ART_PIECE_LIMIT, on any panel, seed or look, alignment pattern included", () => {
		for (const align of [false, true]) {
			setArtAlignment(align);
			for (const look of LOOKS) {
				for (let seed = 0; seed < 8; seed++) {
					for (const [type, panel] of Object.entries(DECK_PANELS)) {
						const view = { id: panel.id, w: panel.w, h: panel.h };
						// Midnight's colors, its value too: Nebula at its full reach.
						const scene = artScene(look, view, `s${seed}`, "#071120", "#788CA9", "#EFF6FF");
						for (let r = 0; r < panel.rows; r++) for (let c = 0; c < panel.columns; c++) assert.ok(artPiece(scene, keyRect(panel, c, r)!, 144, 144, []).length <= ART_PIECE_LIMIT, `${type} key`);
						if (panel.strip !== null) for (let c = 0; c < panel.strip.w / 200; c++) assert.ok(artPiece(scene, sliceRect(panel, c)!, 200, 100, []).length <= ART_PIECE_LIMIT, `${type} slice`);
					}
				}
			}
		}
	});
});

// ---- goldens -----------------------------------------------------------------------------------

const GOLDEN = new URL("./golden/deck-art.json", import.meta.url);
const FAMILIES = ["single-sparkline", "dual-max", "triple-avg", "quad-labels-min"];

function goldenFaces(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const look of LOOKS) {
		for (const theme of THEMES) {
			for (const id of FAMILIES) out[`${look}/${theme}/key/${id}`] = paintArt(composeKeyScenario(keyScenario(id), theme, "theme", look), keyPlace(3, 1));
			for (const s of DIALS.slice(0, 3)) out[`${look}/${theme}/dial/${s.id}`] = paintArt(dialFace(s, theme, look), dialPlace(2));
			const strip = sliceStrip(fixtureCase({ styles: ["trend"], layout: "whole", encoders: 6, background: look, accent: false, theme }).input);
			out[`${look}/${theme}/strip/slice-4`] = paintArt(strip.slices[4] as string, dialPlace(4));
		}
	}
	return out;
}

/** sha256 over the 112 Stars and Nebula golden faces (key, then face, in
 * key order): a change to Dusk or to the catalog must not move a byte of
 * theirs. It moved twice, each time in 10 strip slices' warn and crit
 * band colors only: to the ones stripAlertColors lifts on the art's
 * ceiling, then to that lift at a held hue. A third time on 2026-10-28,
 * in the 14 Stars and Nebula strip slices only (and the 7 Dusk ones in
 * test/golden/deck-art.json; no key or dial face moved): the Y scale's
 * reserved end column starts the row words further right, so the warn and
 * crit band labels sit further along their row, and on Stars one star that
 * now falls under a label is left out, as stars under words always are. A
 * fourth on 2026-11-04, in the same 14 slices and the 7 Dusk ones: the names
 * row of a Trend of two stopped repeating the value shown large, so the band
 * labels after it sit a little further left. */
const STARS_NEBULA_DIGEST = "479897e92fe2a2637b61d309d6d9f8f77383d4df7458b0e952adb1b0af0f2b49";

describe("golden deck-art faces", () => {
	it("Stars and Nebula keep their pinned bytes, whatever Dusk draws", () => {
		const faces = goldenFaces();
		const keys = Object.keys(faces).filter((k) => k.startsWith("stars/") || k.startsWith("nebula/")).sort();
		assert.equal(keys.length, 112);
		assert.equal(createHash("sha256").update(keys.map((k) => `${k}\n${faces[k]}`).join("\n")).digest("hex"), STARS_NEBULA_DIGEST);
	});

	it("draw exactly the pinned SVG (Stars, Dusk and Nebula x every theme x key layouts, dial views and a strip slice, at fixed places on a + XL)", () => {
		const faces = goldenFaces();
		if (process.env.HW_UPDATE_GOLDEN === "1" || !existsSync(GOLDEN)) {
			if (process.env.HW_UPDATE_GOLDEN !== "1") assert.fail("test/golden/deck-art.json is missing; create it with HW_UPDATE_GOLDEN=1");
			writeFileSync(GOLDEN, `${JSON.stringify(faces, null, "\t")}\n`);
		}
		const pinned = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;
		assert.deepEqual(Object.keys(faces).sort(), Object.keys(pinned).sort());
		for (const [key, face] of Object.entries(faces)) assert.equal(face, pinned[key], `${key} changed; rerun with HW_UPDATE_GOLDEN=1 if intended, and review the diff`);
	});
});
