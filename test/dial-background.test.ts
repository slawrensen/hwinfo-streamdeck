/**
 * Issue #41: a Sensor Dial's Background. Theme (absent, and every value but
 * the four exact strings) draws today's face byte for byte. Glass, Tint,
 * Outline and Clear let the touch strip picture set in the Stream Deck app show
 * behind the dial, each with its own contract, and none draws a mask or a
 * copy of a word (the cost that made the first outline expensive). Golden
 * faces (test/golden/dial-backgrounds.json) pin what each look draws; to
 * accept an intended change, rerun this file with HW_UPDATE_GOLDEN=1 and
 * review the diff.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";

import { dialGalleryFixture } from "../scripts/lib/dial-gallery";
import { composeDialSvg, type DialRenderState, type DialSettings } from "../src/actions/sensor-dial";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import type { PollerStatus } from "../src/poller";
import { SessionStatsStore } from "../src/stats";
import { dialAccentWordsOf, dialBackgroundOf, dialBackgroundTraits, dialPictureText, dialTextPalette, haloRingColor, SEE_THROUGH_FALLBACK_ADVANCE_12, type DialBackground } from "../src/ui/dial-background";
import { renderDialOverview, renderDialTwoRow } from "../src/ui/dial-renderer";
import { setFaceFont, type FaceFontId } from "../src/ui/face-font";
import { estimateKeyTextWidth, INK_CLEAR_GAP, inkEdges } from "../src/ui/format";
import { GLASS_INK_OPACITY, GLASS_OPACITY, glassSurfaces, glassTextPalette, TINT_OPACITY, tintOpen } from "../src/ui/glass";
import { ACCENT_WORD_BLEND, accentWords, contrastRatio, luminance, mixToward, noDimmerThan, parseTextSettings, pictureText, readableValueColor, resolveTextColors, type TextSettings } from "../src/ui/text-colors";
import { applyGlobalThemeSettings } from "../src/ui/theme-store";
import { alertValueColor, loadThemes, resolvePalette } from "../src/ui/themes";

const config = loadThemes();
const FONTS: FaceFontId[] = ["tahoma", "segoe-ui"];
const THEMES = ["void", "graphite", "ultraviolet", "midnight", "forest", "ember", "paper"];
const LOOKS = ["glass", "tint", "outline", "clear"] as const;
type Look = (typeof LOOKS)[number];
/** Values a stored document can hold that are not one of the four looks:
 * case and space variants, the names of the looks the study left out, and
 * non-strings. Every one must draw Theme. */
const JUNK: unknown[] = ["theme", "", "Glass", "glass ", " glass", "GLASS", "Tint", "tint ", " TINT", "Outline", "outline ", "CLEAR", " clear", "transparent", "glow", "shadow", "frost", "solid", "on", true, 1, 0, null, {}, [], ["glass"]];

function useFont(font: FaceFontId, typeAccents: "on" | "off" = "on"): void {
	setFaceFont(font);
	applyGlobalThemeSettings({ theme: "void", typeAccents, textMode: "theme", textFont: font });
}
afterEach(() => useFont("tahoma"));

// --- the 63 color goldens (3 views x 7 themes x Theme/Dim/Custom) ----------
const goldenKeys = Object.keys(JSON.parse(readFileSync(new URL("./golden/dial-color-baseline.json", import.meta.url), "utf8")) as Record<string, string>);
type Fixture = ReturnType<typeof dialGalleryFixture>;
const galleryFixture = (key: string, background?: unknown, extra: Record<string, unknown> = {}): Fixture => {
	const [view, theme, textMode] = key.split("/");
	const fixture = dialGalleryFixture(view === "overview" ? "overview" : "tworow");
	fixture.state.settings = { ...fixture.state.settings, dialView: view, theme, textMode, textColor: "#123abc", ...(background === undefined ? {} : { dialBackground: background }), ...extra } as DialSettings;
	return fixture;
};
const composeGallery = (key: string, background?: unknown, extra?: Record<string, unknown>): string => {
	const f = galleryFixture(key, background, extra);
	return composeDialSvg(f.state, { state: "ok", snapshot: f.snapshot, source: "shared-memory" }, f.historyOf);
};

// --- the study's ten scenarios: every view, alerts, the status faces -------
type Scenario = { id: string; view: "single" | "overview" | "tworow"; readings: Reading[]; selected?: number; settings?: Record<string, unknown>; history?: Record<string, number[]>; status?: PollerStatus; noSelection?: boolean; missing?: boolean };
let nextId = 1;
const reading = (label: string, type: SensorType, unit: string, value: number, min: number, max: number): Reading => {
	const id = nextId++;
	return { key: `31:0:${id.toString(16)}`, sensorIndex: 0, id, label, type, unit, value, valueMin: min, valueMax: max, valueAvg: value };
};
const wave = (base: number, amp: number): number[] => Array.from({ length: 36 }, (_, i) => base + amp * Math.sin(i / 3.1) + (amp / 3) * Math.cos(i * 1.7));
const ALERTS = { warnValue: "80", critValue: "90", alertUnit: "°C" };
const SCENARIOS: Scenario[] = (() => {
	const power = reading("GPU Power", SensorType.Power, "W", 18.9, 15.9, 58.9);
	const pkg = reading("CPU Package", SensorType.Temperature, "°C", 83.4, 41, 88.9);
	const hot = reading("GPU Hot Spot", SensorType.Temperature, "°C", 96.2, 48, 97.5);
	const ccds = [reading("CPU CCD1 (Tdie)", SensorType.Temperature, "°C", 52.5, 41, 78.5), reading("CPU CCD2 (Tdie)", SensorType.Temperature, "°C", 45.3, 40, 70), reading("CPU Core Max", SensorType.Temperature, "°C", 86, 50, 88)];
	const gpu = [reading("GPU Temperature", SensorType.Temperature, "°C", 71.4, 48, 79), reading("GPU Hot Spot", SensorType.Temperature, "°C", 92.3, 50, 95), reading("GPU Fan", SensorType.Fan, "RPM", 1840, 0, 2100)];
	const clocks = [reading("GPU Clock", SensorType.Clock, "MHz", 2745, 210, 2790), reading("GPU Memory Clock", SensorType.Clock, "MHz", 1250, 1250, 1250)];
	const wraps = [reading("CPU Package Power (SVI3 TFN)", SensorType.Power, "W", 88.4, 30, 142), reading("GPU Memory Junction Temperature", SensorType.Temperature, "°C", 94, 60, 96)];
	const spare = reading("CPU Package", SensorType.Temperature, "°C", 60, 40, 80);
	return [
		{ id: "single-power", view: "single", readings: [power], history: { [power.key]: [15.9, 58.9, 18.9] } },
		{ id: "single-warn", view: "single", readings: [pkg], settings: ALERTS, history: { [pkg.key]: [41, 88.9, 83.4] } },
		{ id: "single-crit", view: "single", readings: [hot], settings: ALERTS, history: { [hot.key]: [48, 97.5, 96.2] } },
		{ id: "three-top", view: "overview", readings: ccds, settings: ALERTS },
		{ id: "three-bottom", view: "overview", readings: gpu, selected: 1, settings: { ...ALERTS, overviewHeader: "bottom", sensorValueColors: true } },
		{ id: "two-spark", view: "tworow", readings: clocks, history: { [clocks[0]!.key]: wave(2600, 160), [clocks[1]!.key]: wave(1250, 0.5) } },
		{ id: "two-wrap", view: "tworow", readings: wraps, selected: 1, settings: ALERTS, history: { [wraps[0]!.key]: wave(80, 30), [wraps[1]!.key]: wave(90, 3) } },
		{ id: "status-start", view: "single", readings: [], status: { state: "unavailable", reason: "not-running", message: "" } },
		{ id: "status-pick", view: "single", readings: [spare], noSelection: true },
		{ id: "status-missing", view: "single", readings: [spare], missing: true }
	];
})();
const isStatus = (s: Scenario): boolean => s.id.startsWith("status");

function composeScenario(s: Scenario, theme: string, textMode: "theme" | "dim" | "custom", background?: unknown, extra: Record<string, unknown> = {}): string {
	const stats = new SessionStatsStore();
	for (const r of s.readings) for (const v of [...(s.history?.[r.key] ?? [r.valueMin, r.valueMax]), r.value]) stats.sample(r.key, v);
	const settings: Record<string, unknown> = {
		readingKey: s.noSelection ? undefined : s.missing ? "31:0:ffff" : s.readings[s.selected ?? 0]?.key,
		theme,
		...(textMode === "custom" ? { textMode, textColor: "#FFD60A" } : { textMode }),
		...(s.view !== "single" ? { dialView: s.view, rotationKeys: s.readings.map((r) => r.key) } : {}),
		...(background === undefined ? {} : { dialBackground: background }),
		...s.settings,
		...extra
	};
	const snapshot: SensorSnapshot = { pollTime: 1, version: 2, revision: 0, sensors: [{ index: 0, id: 0x31, instance: 0, name: "Sample sensors" }], readings: s.readings, byKey: new Map(s.readings.map((r) => [r.key, r])) } as SensorSnapshot;
	const state = { settings, stats, statMode: "current", overlay: null, pinned: false, cyclePaused: false } as unknown as DialRenderState;
	return composeDialSvg(state, s.status ?? { state: "ok", snapshot, source: "shared-memory" }, (key) => s.history?.[key] ?? []);
}

/** Every face of one look: the 63 goldens and the ten scenarios in every
 * theme and text mode, with Theme's face for the same inputs. */
function eachFace(font: FaceFontId, look: Look, fn: (face: string, theme: string, where: string, themeFace: string, mode: string, view: string) => void): void {
	useFont(font);
	for (const key of goldenKeys) {
		const [view, theme, mode] = key.split("/") as [string, string, string];
		fn(composeGallery(key, look), theme, `${font} ${look} ${key}`, composeGallery(key), mode, view);
	}
	for (const theme of THEMES) for (const mode of ["theme", "dim", "custom"] as const) for (const s of SCENARIOS) {
		fn(composeScenario(s, theme, mode, look), theme, `${font} ${look} ${s.id}/${theme}/${mode}`, composeScenario(s, theme, mode), mode, isStatus(s) ? "status" : s.view);
	}
}

const count = (s: string, needle: string): number => s.split(needle).length - 1;
/** The drawn text runs with every fill removed: position, font and words. */
const runsOf = (svg: string): string[] => [...svg.matchAll(/<text\b[\s\S]*?<\/text>/g)].map((m) => m[0].replace(/ fill="#[0-9A-Fa-f]{6}"/g, ""));
/** Each text or tspan fill with the y of its text element. */
const textFills = (svg: string): { fill: string; y: number; size: number }[] =>
	[...svg.matchAll(/<text\b([^>]*)>([^<]*)(?:<tspan\b([^>]*)>[^<]*<\/tspan>)?<\/text>/g)].flatMap((m) => {
		const y = Number(/ y="([0-9.]+)"/.exec(m[1] as string)?.[1]);
		const own = { fill: /fill="(#[0-9A-Fa-f]{6})"/.exec(m[1] as string)?.[1] as string, y, size: Number(/font-size="([0-9]+)"/.exec(m[1] as string)?.[1]) };
		return m[3] === undefined ? [own] : [own, { fill: /fill="(#[0-9A-Fa-f]{6})"/.exec(m[3])?.[1] as string, y, size: 17 }];
	});

describe("the stored Background: one exact-value reader", () => {
	it("reads the four looks and nothing else", () => {
		for (const look of LOOKS) assert.equal(dialBackgroundOf(look), look);
		for (const raw of [undefined, ...JUNK]) assert.equal(dialBackgroundOf(raw), "theme", JSON.stringify(raw));
	});

	for (const font of FONTS) {
		it(`${font}: absent and every other value draw today's face byte for byte, on the 63 goldens, the scenarios and the status faces`, () => {
			useFont(font);
			let compared = 0;
			for (const key of goldenKeys) {
				const base = composeGallery(key);
				for (const raw of JUNK) {
					assert.equal(composeGallery(key, raw), base, `${key} ${JSON.stringify(raw)}`);
					compared++;
				}
			}
			for (const theme of ["void", "paper"]) for (const s of SCENARIOS) {
				const base = composeScenario(s, theme, "theme");
				for (const raw of JUNK) {
					assert.equal(composeScenario(s, theme, "theme", raw), base, `${s.id}/${theme} ${JSON.stringify(raw)}`);
					compared++;
				}
			}
			// Every problem face the poller can report, not only the three above.
			const statuses: PollerStatus[] = (["not-running", "busy", "disabled", "access-denied", "gadget-empty", "unsupported-platform", "error", "bridge-failed"] as const).map((reason) => ({ state: "unavailable", reason, message: "" }) as PollerStatus);
			for (const status of statuses) {
				const s: Scenario = { id: "status", view: "single", readings: [], status };
				const base = composeScenario(s, "midnight", "theme");
				for (const raw of JUNK) assert.equal(composeScenario(s, "midnight", "theme", raw), base, `${JSON.stringify(status)} ${JSON.stringify(raw)}`);
			}
			assert.equal(compared, (goldenKeys.length + 2 * SCENARIOS.length) * JUNK.length);
		});
	}
});

describe("Glass: the theme background as a panel at 80 %", () => {
	for (const font of FONTS) {
		it(`${font}: one panel, structure in label ink, no opaque box, no mask, filter, copy or painter opacity`, () => {
			eachFace(font, "glass", (face, theme, where, themeFace) => {
				const p = config.themes[theme]!;
				assert.ok(face.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"><defs><linearGradient id="p" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100"><stop offset="0" stop-color="${p.bg}" stop-opacity="${GLASS_OPACITY}"/>`), `${where}: the panel paint opens the face`);
				assert.ok(face.includes(`<linearGradient id="i" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100"><stop offset="0" stop-color="${p.label}" stop-opacity="${GLASS_INK_OPACITY}"/>`), `${where}: the ink paint`);
				assert.equal(count(face, '<rect width="200" height="100" fill="url(#p)"/>'), 1, `${where}: one panel`);
				assert.ok(!face.includes(`fill="${p.track}"`), `${where}: no opaque track`);
				assert.ok(!new RegExp(`<rect\\b[^>]*fill="${p.bg}"`).test(face), `${where}: no opaque background box`);
				assert.doesNotMatch(face, /<mask|<g\b|<use\b|<clipPath|clip-path|<filter|rgba\(|paint-order| (?:fill-|stroke-)?opacity="|#[0-9A-Fa-f]{8}\b/, `${where}: nothing costly or unsupported`);
				// Every track-token fill today is label ink on glass, the
				// two-row value window aside (it is not drawn).
				const todayTrack = count(themeFace, `fill="${p.track}"`);
				const windowOnTrack = (themeFace.match(new RegExp(`<rect x="[0-9.]+" y="[0-9.]+" width="[0-9.]+" height="22" fill="${p.track}"/>`, "g")) ?? []).length;
				assert.equal(count(face, 'fill="url(#i)"'), todayTrack - windowOnTrack, `${where}: structure becomes ink`);
				assert.deepEqual(runsOf(face), runsOf(themeFace), `${where}: the same words at the same places`);
			});
		});
	}

	it("built-in text keeps 4.5:1 on the hardest panel (on the band for the selected two-row row), in Theme and Dim; Custom stays exact", () => {
		for (const font of FONTS) {
			eachFace(font, "glass", (face, theme, where, _themeFace, mode, view) => {
				const { surface, band } = glassSurfaces(config.themes[theme]!);
				const bandTop = /<rect x="0" y="(4|46)" width="200" height="40" fill="url\(#i\)"\/>/.exec(face)?.[1];
				for (const { fill, y } of textFills(face)) {
					if (mode === "custom") {
						assert.ok(fill.toLowerCase() === "#123abc" || fill.toLowerCase() === "#ffd60a" || !/^(single|status)$/.test(view), `${where}: custom ${fill}`);
						continue;
					}
					const onBand = view === "tworow" && bandTop !== undefined && y > Number(bandTop) && y <= Number(bandTop) + 40;
					const here = onBand ? band : surface;
					assert.ok(contrastRatio(fill, here) >= 4.5, `${where}: ${fill} on ${here} = ${contrastRatio(fill, here).toFixed(2)}`);
				}
			});
		}
	});

	it("lifts every text token toward the theme's own polarity and keeps the label's step only while the value stays 1.75x the label", () => {
		for (const [id, p] of Object.entries(config.themes)) {
			const tp = glassTextPalette(p);
			const light = luminance(p.value) > luminance(p.bg);
			for (const token of ["value", "label", "unit"] as const) {
				if (light) assert.ok(luminance(tp[token]) >= luminance(p[token]) - 1e-9, `${id}.${token}`);
				else assert.ok(luminance(tp[token]) <= luminance(p[token]) + 1e-9, `${id}.${token}`);
			}
			assert.equal(luminance(tp.value) > luminance(tp.bg), light, `${id}: surface polarity`);
			const unit = readableValueColor(tp.unit, tp.bg);
			const label = contrastRatio(tp.label, tp.bg);
			assert.ok(label >= contrastRatio(unit, tp.bg) - 1e-9, `${id}: label no dimmer than unit`);
			assert.ok(label <= 4.5 + 0.05 || contrastRatio(tp.value, tp.bg) / label >= 1.75 - 0.02, `${id}: value over label ${(contrastRatio(tp.value, tp.bg) / label).toFixed(2)}`);
		}
	});
});

describe("Outline: no background, a 1 px edge from one filter pass", () => {
	for (const font of FONTS) {
		it(`${font}: one filter and one group, no background, band, shaded area or empty bar, no mask, copy or partial paint`, () => {
			eachFace(font, "outline", (face, theme, where, themeFace, _mode, view) => {
				const palette = resolvePalette(config, theme, null, "normal");
				const ring = haloRingColor(palette);
				assert.match(face, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 200 100" width="200" height="100"><defs><filter id="h" /, where);
				assert.doesNotMatch(face, /<rect width="200" height="100"/, `${where}: slot fill`);
				assert.doesNotMatch(face, /height="40"/, `${where}: two-row band`);
				assert.doesNotMatch(face, /<path\b/, `${where}: trend shaded area`);
				assert.doesNotMatch(face, /<mask|<use\b|clip-?path|rgba\(|#[0-9A-Fa-f]{8}\b|paint-order|opacity="|<text\b[^>]*\bstroke=/, `${where}: unsupported or costly paint`);
				assert.equal(count(face, "<filter "), 1, `${where}: one filter`);
				assert.equal(count(face, '<g filter="url(#h)">'), 1, `${where}: one group`);
				assert.ok(face.endsWith("</g></svg>"), `${where}: the group closes the face`);
				const group = face.slice(face.indexOf('<g filter="url(#h)">'));
				assert.equal(count(group, "<text"), count(face, "<text"), `${where}: every word inside the group`);
				assert.ok(!/ d[xy]="0"/.test(face), `${where}: zero offsets left to their default`);
				assert.equal(count(face, '<feMergeNode in="c"/><feMergeNode in="d"/><feMergeNode in="q"/>'), 3, `${where}: the ring's layers stacked three times`);
				if (view === "status") assert.doesNotMatch(face, /<rect\b/, `${where}: no bar on a status face`);
				if (view === "single") {
					assert.ok(face.indexOf(`<rect x="11" y="83" width="178" height="8" rx="4" fill="${ring}"/>`) > 0, `${where}: the bar's rim`);
					assert.ok(face.indexOf(`<rect x="11" y="83"`) < face.indexOf('<g filter="url(#h)">'), `${where}: the bar before the group`);
				}
				assert.match(face, view === "single" || view === "status" ? / x="0" y="4" width="200" height="80" / : / x="0" y="0" width="200" height="100" /, `${where}: filter region`);
				if (view === "overview") {
					const before = face.slice(0, face.indexOf('<g filter="url(#h)">'));
					assert.equal(count(before, 'height="1"'), count(themeFace, 'height="1"'), `${where}: separators stay hairlines outside the group`);
				}
				assert.deepEqual(runsOf(face), runsOf(themeFace), `${where}: the same words at the same places`);
			});
		});
	}

	it("rings dark themes in black and Paper in its background; built-in text keeps 4.5:1 against the ring", () => {
		for (const id of THEMES) assert.equal(haloRingColor(config.themes[id]!), id === "paper" ? config.themes.paper!.bg : "#000000", id);
		for (const font of FONTS) {
			eachFace(font, "outline", (face, theme, where, _themeFace, mode) => {
				const ring = haloRingColor(config.themes[theme]!);
				for (const { fill } of textFills(face)) {
					if (mode === "custom") continue;
					assert.ok(contrastRatio(fill, ring) >= 4.5, `${where}: ${fill} against ${ring} = ${contrastRatio(fill, ring).toFixed(2)}`);
				}
			});
		}
	});
});

describe("Tint: Outline's edge over the theme background at 50 %", () => {
	for (const font of FONTS) {
		it(`${font}: exactly the Outline face for the same inputs, with one flat panel under everything`, () => {
			const outline = new Map<string, string>();
			eachFace(font, "outline", (face, _theme, where) => outline.set(where.replace(" outline ", " "), face));
			let compared = 0;
			eachFace(font, "tint", (face, theme, where) => {
				const p = config.themes[theme]!;
				const panel = `<defs><linearGradient id="t" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100"><stop offset="0" stop-color="${p.bg}" stop-opacity="${TINT_OPACITY}"/><stop offset="1" stop-color="${p.bg}" stop-opacity="${TINT_OPACITY}"/></linearGradient></defs><rect width="200" height="100" fill="url(#t)"/>`;
				assert.equal(tintOpen(p), panel, `${where}: the panel`);
				const head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">';
				const twin = outline.get(where.replace(" tint ", " "));
				assert.ok(twin !== undefined && twin.startsWith(head), `${where}: an Outline twin`);
				assert.equal(face, `${head}${panel}${twin.slice(head.length)}`, `${where}: Outline plus the panel`);
				compared++;
			});
			assert.equal(compared, outline.size);
		});
	}

	it("keeps Glass's panel form at a lower opacity", () => {
		assert.ok(TINT_OPACITY < GLASS_OPACITY);
		assert.equal(TINT_OPACITY, 0.5);
	});
});

describe("Clear: no background and no edge, one ink", () => {
	for (const font of FONTS) {
		it(`${font}: only today's elements, #RRGGBB paint, graphics on their track, no bar on status faces`, () => {
			eachFace(font, "clear", (face, theme, where, themeFace, _mode, view) => {
				const p = config.themes[theme]!;
				assert.doesNotMatch(face, /<rect width="200" height="100"/, `${where}: slot fill`);
				assert.doesNotMatch(face, /height="40"/, `${where}: two-row band`);
				assert.doesNotMatch(face, /<mask|<defs|<g[ >]|<use\b|opacity|rgba\(|paint-order|clip-path|filter/, `${where}: nothing costly or unsupported`);
				for (const m of face.matchAll(/\b(?:fill|stroke)="([^"]*)"/g)) assert.ok(m[1] === "none" || /^#[0-9A-Fa-f]{6}$/.test(m[1] as string), `${where}: paint ${m[1]}`);
				assert.ok(!new RegExp(`<rect\\b[^>]*fill="${p.bg}"`).test(face), `${where}: no background-colored box`);
				if (view === "status") assert.doesNotMatch(face, /<rect\b/, `${where}: no bar on a status face`);
				if (view === "single") {
					assert.match(face, new RegExp(`<rect x="11" y="83" width="178" height="8" rx="4" fill="${p.track}"/>`), `${where}: the bar groove`);
					assert.doesNotMatch(face, /width="176" height="6"/, `${where}: the groove is the track`);
				}
				if (view === "overview") assert.match(face, new RegExp(`<rect x="0" y="(16|2)" width="5" height="(84|78)" fill="${p.track}"/>`), `${where}: the groove 1 px wider than the thumb`);
				if (view === "tworow") assert.match(face, new RegExp(`<rect x="1" y="(7|49)" width="6" height="34" rx="3" fill="${p.track}"/><rect x="2" y="(8|50)" width="4" height="32" rx="2" fill="#`), `${where}: the rail on its backing`);
				assert.deepEqual(runsOf(face), runsOf(themeFace), `${where}: the same words at the same places`);
			});
		});
	}

	it("Theme and Dimmed text draw labels, units and stats in the value color; Custom keeps its exact colors", () => {
		for (const palette of Object.values(config.themes)) {
			for (const mode of ["theme", "dim"]) {
				const settings = parseTextSettings({ textMode: mode }) as TextSettings;
				const resolved = resolveTextColors(palette, settings, "normal");
				assert.deepEqual(pictureText(resolved, palette.bg, settings, 0), { ...resolved, label: resolved.value, unit: resolved.value });
			}
			const custom = parseTextSettings({ textMode: "custom", textColor: "#3366FF", textDimSecondary: true }) as TextSettings;
			const resolved = resolveTextColors(palette, custom, "normal");
			assert.deepEqual(pictureText(resolved, palette.bg, custom, 0), resolved);
		}
		useFont("tahoma");
		const face = composeScenario(SCENARIOS[0]!, "ember", "theme", "clear");
		assert.deepEqual([...new Set([...face.matchAll(/<(?:text|tspan)\b[^>]* fill="(#[0-9A-F]{6})"/g)].map((m) => m[1]))], ["#FFB84D"]);
	});
});

describe("Words in the accent color: Glass, Tint and Outline only, word fills only", () => {
	const ACCENT = { dialAccentWords: true };
	const ACCENT_LOOKS = ["glass", "tint", "outline"] as const;
	const JUNK_WORDS: unknown[] = [false, "true", "True", "on", "yes", 1, 0, null, {}, [], [true], "accent"];
	/** The face with every text and tspan fill removed: what it draws besides
	 * the colors of its words. */
	const unfilled = (svg: string): string => svg.replace(/(<(?:text|tspan)\b[^>]*?) fill="#[0-9A-Fa-f]{6}"/g, "$1");
	/** The fills of the 700-weight runs: every value the face draws. */
	const valueFills = (svg: string): string[] => [...svg.matchAll(/font-weight="700" fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1] as string);

	/** Every face of one look with the box on, beside the same look's face
	 * without it: the 63 goldens and the ten scenarios in every theme and
	 * text mode. */
	function eachAccentFace(font: FaceFontId, look: Look, typeAccents: "on" | "off", fn: (face: string, plain: string, theme: string, where: string, mode: string, view: string) => void): void {
		useFont(font, typeAccents);
		for (const key of goldenKeys) {
			const [view, theme, mode] = key.split("/") as [string, string, string];
			fn(composeGallery(key, look, ACCENT), composeGallery(key, look), theme, `${font} ${look} type accents ${typeAccents} ${key}`, mode, view);
		}
		for (const theme of THEMES) for (const mode of ["theme", "dim", "custom"] as const) for (const s of SCENARIOS) {
			fn(composeScenario(s, theme, mode, look, ACCENT), composeScenario(s, theme, mode, look), theme, `${font} ${look} type accents ${typeAccents} ${s.id}/${theme}/${mode}`, mode, isStatus(s) ? "status" : s.view);
		}
	}

	it("reads the exact true and nothing else, and only the looks with a panel or an edge take it", () => {
		assert.equal(dialAccentWordsOf(true), true);
		for (const raw of [undefined, ...JUNK_WORDS]) assert.equal(dialAccentWordsOf(raw), false, JSON.stringify(raw));
		assert.deepEqual(
			LOOKS.filter((look) => dialBackgroundTraits(look).accentWords),
			[...ACCENT_LOOKS]
		);
		assert.equal(dialBackgroundTraits("theme").accentWords, false);
	});

	for (const font of FONTS) {
		it(`${font}: every other value on every look, and the exact true on Theme and Clear, draw today's face byte for byte`, () => {
			useFont(font);
			let compared = 0;
			for (const key of goldenKeys) for (const look of [undefined, ...LOOKS]) {
				const base = composeGallery(key, look);
				for (const raw of JUNK_WORDS) {
					assert.equal(composeGallery(key, look, { dialAccentWords: raw }), base, `${key} ${look} ${JSON.stringify(raw)}`);
					compared++;
				}
			}
			// Theme (absent, or a value dialBackgroundOf does not know) and Clear ignore the box.
			for (const theme of THEMES) for (const s of SCENARIOS) for (const look of [undefined, "theme", "Glass", "outline ", "clear"]) {
				for (const mode of ["theme", "dim"] as const) assert.equal(composeScenario(s, theme, mode, look, ACCENT), composeScenario(s, theme, mode, look), `${s.id}/${theme}/${mode} ${JSON.stringify(look)}`);
				compared++;
			}
			assert.equal(compared, goldenKeys.length * (LOOKS.length + 1) * JUNK_WORDS.length + THEMES.length * SCENARIOS.length * 5);
		});

		it(`${font}: only word fills change; values, alerts, sensor-type colors, reading colors and Custom text keep their bytes`, () => {
			for (const look of ACCENT_LOOKS) for (const typeAccents of ["on", "off"] as const) {
				eachAccentFace(font, look, typeAccents, (face, plain, _theme, where, mode) => {
					assert.equal(unfilled(face), unfilled(plain), `${where}: the same elements, words and paint besides word fills`);
					assert.deepEqual(valueFills(face), valueFills(plain), `${where}: values`);
					if (mode === "custom") assert.equal(face, plain, `${where}: Custom text stays exact`);
					else assert.notEqual(face, plain, `${where}: the words change`);
				});
			}
			// Chosen reading colors stay exact (the three-row gallery's rows 1 and 3).
			useFont(font);
			for (const look of ACCENT_LOOKS) {
				const chosen = { sensorValueColors: true, readingColors: { "31:0:1": "#FF00AA", "31:0:3": "#00AAFF" } };
				const face = composeGallery("overview/midnight/theme", look, { ...chosen, ...ACCENT });
				assert.deepEqual(valueFills(face), valueFills(composeGallery("overview/midnight/theme", look, chosen)), look);
				assert.ok(valueFills(face).includes("#FF00AA") && valueFills(face).includes("#00AAFF"), look);
			}
		});
	}

	it("every word keeps 4.5:1 on its look's guaranteed surface (Glass's hardest panel and band, the Tint and Outline edge), in Theme and Dimmed text, with type accents on and off", () => {
		for (const font of FONTS) for (const look of ACCENT_LOOKS) for (const typeAccents of ["on", "off"] as const) {
			eachAccentFace(font, look, typeAccents, (face, _plain, theme, where, mode, view) => {
				if (mode === "custom") return;
				const p = config.themes[theme]!;
				const { surface, band } = glassSurfaces(p);
				const bandTop = /<rect x="0" y="(4|46)" width="200" height="40" fill="url\(#i\)"\/>/.exec(face)?.[1];
				for (const { fill, y } of textFills(face)) {
					const onBand = look === "glass" && view === "tworow" && bandTop !== undefined && y > Number(bandTop) && y <= Number(bandTop) + 40;
					const here = look === "glass" ? (onBand ? band : surface) : haloRingColor(p);
					assert.ok(contrastRatio(fill, here) >= 4.5, `${where}: ${fill} on ${here} = ${contrastRatio(fill, here).toFixed(2)}`);
				}
			});
		}
	});

	it("labels take the accent, units and stats their own color halfway toward it; both lift to the floor and the label never reads dimmer than the unit, for every theme and sensor type accent", () => {
		let checked = 0;
		for (const [id, base] of Object.entries(config.themes)) {
			const accents = [base.accent, ...(config.typeAccentsDisabledOn.includes(id) ? [] : Object.values(config.typeAccents))];
			for (const accent of accents) for (const look of ACCENT_LOOKS) for (const mode of ["theme", "dim"]) {
				const palette = { ...base, accent };
				const settings = parseTextSettings({ textMode: mode }) as TextSettings;
				const tp = dialTextPalette(look, palette);
				const { surface, band } = glassSurfaces(palette);
				const ring = haloRingColor(palette);
				// The face's own words, and the selected two-row row's on the track (Glass: the band).
				for (const [on, guaranteed] of [
					[tp.bg, look === "glass" ? surface : ring],
					[tp.track, look === "glass" ? band : ring]
				] as const) {
					const resolved = resolveTextColors({ ...tp, bg: on }, settings, "normal");
					const today = dialPictureText(look, resolved, on, settings);
					const words = dialPictureText(look, resolved, on, settings, true);
					const where = `${id} ${accent} ${look} ${mode} on ${on}`;
					const unit = readableValueColor(mixToward(today.unit, resolved.badge, ACCENT_WORD_BLEND), on);
					assert.deepEqual(words, { ...today, label: noDimmerThan(readableValueColor(resolved.badge, on), unit, on), unit }, where);
					for (const color of [words.label, words.unit]) assert.ok(contrastRatio(color, guaranteed) >= 4.5, `${where}: ${color} on ${guaranteed}`);
					assert.ok(contrastRatio(words.label, on) >= contrastRatio(words.unit, on) - 1e-9, `${where}: label no dimmer than unit`);
					checked++;
				}
			}
		}
		// Six themes with the theme accent and seven type accents, Paper with its own.
		assert.equal(checked, (6 * 8 + 1) * 3 * 2 * 2);
		const custom = parseTextSettings({ textMode: "custom", textColor: "#3366FF", textDimSecondary: true }) as TextSettings;
		const resolved = resolveTextColors(config.themes.void!, custom, "normal");
		assert.deepEqual(accentWords(resolved, "#000000", custom), resolved);
	});

	it("Tint stays Outline plus its panel with the box on", () => {
		useFont("tahoma");
		const head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">';
		for (const theme of THEMES) for (const mode of ["theme", "dim"] as const) for (const s of SCENARIOS) {
			const outline = composeScenario(s, theme, mode, "outline", ACCENT);
			assert.equal(composeScenario(s, theme, mode, "tint", ACCENT), `${head}${tintOpen(config.themes[theme]!)}${outline.slice(head.length)}`, `${s.id}/${theme}/${mode}`);
		}
	});
});

describe("cut, not mask: the see-through looks draw no overflow rect", () => {
	const palette = resolvePalette(config, "midnight", null, "normal");
	const row = (label: string, valueText: string, unitText = "°C", selected = false) => ({ label, valueText, unitText, selected, valueColor: palette.value });

	it("prices a fallback glyph at its measured width, on those looks only", () => {
		for (const font of FONTS) {
			useFont(font);
			for (const ch of ["⚡", "⚙", "❤", "🔥", "😀"]) {
				assert.ok(estimateKeyTextWidth(ch, 12, { fallbackAdvance12: SEE_THROUGH_FALLBACK_ADVANCE_12 }) >= 16.8 - 1.6, `${font} ${ch}`);
			}
			for (const s of ["CPU Package", "温度", "Температура"]) assert.equal(estimateKeyTextWidth(s, 12, { fallbackAdvance12: SEE_THROUGH_FALLBACK_ADVANCE_12 }), estimateKeyTextWidth(s, 12), `${font} ${s}`);
			const label = "⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡";
			const theme = renderDialOverview({ rows: [row(label, "71.4", "°C", true)], contextText: "", statsText: "", palette });
			for (const look of LOOKS) {
				const face = renderDialOverview({ rows: [row(label, "71.4", "°C", true)], contextText: "", statsText: "", palette, background: look });
				const drawn = /font-size="12" font-weight="600" fill="#[0-9A-F]{6}">([^<]*)<\/text>/.exec(face)?.[1] ?? "";
				assert.ok(Array.from(drawn).length < Array.from(/font-size="12" font-weight="600" fill="#[0-9A-F]{6}">([^<]*)<\/text>/.exec(theme)?.[1] ?? "").length, `${font} ${look}: cut sooner than under Theme's rect (${drawn})`);
				assert.ok(12 + estimateKeyTextWidth(drawn, 12, { fallbackAdvance12: SEE_THROUGH_FALLBACK_ADVANCE_12 }) <= 168 - estimateKeyTextWidth("71.4", 20, { fontWeight: 700 }) - 2, `${font} ${look}: ends before the value`);
			}
		}
	});

	it("leaves off a three-row label its row's value leaves no room for, which Theme hides under its rect", () => {
		for (const font of FONTS) {
			useFont(font);
			// Tahoma books the value's measured width and Theme cuts the label
			// to a bare ellipsis; Segoe UI's Theme booking counts characters,
			// so its label runs under the wide value, hidden by the rect.
			const rows = [row("Package", "WWWWWWWWWWWW", "", true)];
			assert.match(renderDialOverview({ rows, contextText: "", statsText: "", palette }), /font-size="12" font-weight="600" fill="#[0-9A-F]{6}">[^<]+<\/text><rect /, font);
			for (const look of LOOKS) assert.doesNotMatch(renderDialOverview({ rows, contextText: "", statsText: "", palette, background: look }), /font-size="12" font-weight="600"/, `${font} ${look}`);
		}
	});

	it("books a wide text value at its measured ink, so the label ends before it", () => {
		useFont("segoe-ui");
		for (const look of LOOKS) {
			const face = renderDialOverview({ rows: [row("Interface Status Long", "WWWWWW", "", true)], contextText: "", statsText: "", palette, background: look });
			const label = /font-size="12" font-weight="600" fill="#[0-9A-F]{6}">([^<]*)<\/text>/.exec(face)?.[1] ?? "";
			const size = Number(/font-size="([0-9]+)" font-weight="700"/.exec(face)?.[1]);
			assert.ok(12 + estimateKeyTextWidth(label, 12) <= 168 - estimateKeyTextWidth("WWWWWW", size, { fontWeight: 700 }), `${look}: ${label}`);
		}
	});

	it("cuts a two-row second line to the room the value leaves, in both fonts", () => {
		for (const font of FONTS) {
			useFont(font);
			const rows = [{ label: "WWWWWW WWWWWW WWWWWW WWWWWW WWWWWW", valueText: "1234.5", unitText: "MHz", selected: true, valueColor: palette.value }];
			for (const look of LOOKS) {
				const face = renderDialTwoRow({ rows, footerText: "", palette, background: look });
				const line2 = /<text x="12" y="40"[^>]*>([^<]*)<\/text>/.exec(face)?.[1];
				if (line2 === undefined) continue;
				const valueEnd = Number(/<text x="([0-9.]+)" y="40" text-anchor="end"/.exec(face)?.[1]);
				// Tahoma fits by measured ink to a clear gap before this row's
				// value ink; Segoe UI by its width estimate to the value's window.
				if (font === "tahoma") {
					const valueInk = inkEdges([{ text: "1234.5", fontSize: 26, fontWeight: 700 }], "end", valueEnd).left;
					assert.ok(inkEdges([{ text: line2, fontSize: 13 }], "start", 12).right <= valueInk - INK_CLEAR_GAP, `${font} ${look}: "${line2}" inks clear of the value`);
				} else {
					assert.ok(12 + estimateKeyTextWidth(line2, 13) <= valueEnd - estimateKeyTextWidth("1234.5", 26, { fontWeight: 700 }) - 4, `${font} ${look}: "${line2}" ends before the value's window`);
				}
			}
		}
	});
});

describe("every look", () => {
	it("composes the same bytes twice, so the feedback dedupe still skips unchanged frames", () => {
		for (const look of LOOKS) for (const s of SCENARIOS) assert.equal(composeScenario(s, "midnight", "dim", look), composeScenario(s, "midnight", "dim", look), `${look} ${s.id}`);
	});

	it("keeps the alert expression: the bar fill in the single view, the value color in an overview, resolved on the look's surface", () => {
		for (const font of FONTS) {
			useFont(font);
			for (const theme of THEMES) for (const look of LOOKS) {
				const crit = composeScenario(SCENARIOS.find((s) => s.id === "single-crit")!, theme, "theme", look);
				assert.ok(crit.includes(`fill="${config.alerts.crit.bg}"/>`), `${font} ${theme} ${look}: the critical bar fill`);
				const warnRow = composeScenario(SCENARIOS.find((s) => s.id === "three-top")!, theme, "theme", look);
				const surface = look === "glass" ? glassTextPalette(config.themes[theme]!).bg : config.themes[theme]!.bg;
				assert.match(warnRow, new RegExp(`font-weight="700" fill="${alertValueColor(config, "warn", surface)}">86\\.0</text>`), `${font} ${theme} ${look}: the warn row value`);
			}
		}
	});
});

// --- what a user sees, pinned ----------------------------------------------
const GOLDEN = new URL("./golden/dial-backgrounds.json", import.meta.url);
const PINNED: { font: FaceFontId; theme: string }[] = [
	{ font: "tahoma", theme: "midnight" },
	{ font: "segoe-ui", theme: "midnight" },
	{ font: "tahoma", theme: "paper" }
];
const PINNED_SCENARIOS = ["single-warn", "three-bottom", "two-wrap", "status-start"];
function pinnedFaces(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const { font, theme } of PINNED) {
		useFont(font);
		for (const look of LOOKS as readonly DialBackground[]) for (const id of PINNED_SCENARIOS) {
			out[`${look}/${font}/${theme}/${id}`] = composeScenario(SCENARIOS.find((s) => s.id === id)!, theme, "theme", look);
		}
	}
	// Words in the accent color: the colors are the change, so one font.
	useFont("tahoma");
	for (const theme of ["midnight", "paper"]) for (const look of ["glass", "tint", "outline"] as const) for (const id of PINNED_SCENARIOS) {
		out[`${look}+accent words/tahoma/${theme}/${id}`] = composeScenario(SCENARIOS.find((s) => s.id === id)!, theme, "theme", look, { dialAccentWords: true });
	}
	return out;
}

describe("golden faces per look", () => {
	it("draw exactly the pinned SVG (Glass, Tint, Outline and Clear; every view and a status face; Tahoma and Segoe UI; a dark and a light theme; accent words on the three looks that take them)", () => {
		const faces = pinnedFaces();
		if (process.env.HW_UPDATE_GOLDEN === "1" || !existsSync(GOLDEN)) {
			if (process.env.HW_UPDATE_GOLDEN !== "1") assert.fail("test/golden/dial-backgrounds.json is missing; create it with HW_UPDATE_GOLDEN=1");
			writeFileSync(GOLDEN, `${JSON.stringify(faces, null, "\t")}\n`);
		}
		const pinned = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;
		assert.deepEqual(Object.keys(faces).sort(), Object.keys(pinned).sort());
		for (const [key, face] of Object.entries(faces)) assert.equal(face, pinned[key], `${key} changed; rerun with HW_UPDATE_GOLDEN=1 if intended, and review the diff`);
	});
});
