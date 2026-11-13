/**
 * A Sensor Reading key's Background (src/ui/key-background.ts). Theme
 * (absent, and every value but the four exact strings) draws today's face
 * byte for byte on every layout. Glass, Tint, Outline and Clear let the page
 * background set in the Stream Deck app show behind the key, with the dial
 * looks' contracts (test/dial-background.test.ts), and none draws a mask, a
 * background-colored box or a copy of a word. An alerting face, a status
 * face and a missing-sensor face keep today's bytes on every look. Golden
 * faces (test/golden/key-backgrounds.json) pin what each look draws on each
 * layout; to accept an intended change, rerun this file with
 * HW_UPDATE_GOLDEN=1 and review the diff.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, before, describe, it } from "node:test";

import { composeKeyScenario, GALLERY_READINGS, GALLERY_STATUS, KEY_SCENARIOS, seedGallerySeries, type KeyScenario } from "../scripts/lib/key-gallery";
import { composeBackFace, composeChunkFace, composeGapFace, composePagerFace, composeReadingFace, composeTitleFace, type DetailFaceContext } from "../src/detail/detail-faces";
import { pageOf } from "../src/detail/detail-group";
import type { DeviceDetailState } from "../src/detail/navigation";
import type { PollerStatus } from "../src/poller";
import { haloRingColor, SEE_THROUGH_FALLBACK_ADVANCE_12 } from "../src/ui/dial-background";
import { renderDetailBlankKey } from "../src/ui/detail-renderer";
import { setFaceFont, type FaceFontId } from "../src/ui/face-font";
import { estimateKeyTextWidth, INK_CLEAR_GAP, inkEdges } from "../src/ui/format";
import { GLASS_INK_OPACITY, GLASS_OPACITY, glassSurfaces, TINT_OPACITY } from "../src/ui/glass";
import { keyAccentWordsOf, keyBackgroundOf, keyTextColors, lookAtLevel, type KeyBackground } from "../src/ui/key-background";
import { QUAD_DEFAULT_COLORS, renderReadingKey, renderTripleKey, RING_BADGE_HOLE_DEG } from "../src/ui/key-renderer";
import { automaticIdentityColor, contrastRatio, effectiveTextSettings, parseTextSettings, resolveTextColors, type TextSettings } from "../src/ui/text-colors";
import { applyGlobalThemeSettings } from "../src/ui/theme-store";
import { loadThemes, resolvePalette } from "../src/ui/themes";

const config = loadThemes();
const FONTS: FaceFontId[] = ["tahoma", "segoe-ui"];
const THEMES = ["void", "graphite", "ultraviolet", "midnight", "forest", "ember", "paper"];
const MODES = ["theme", "dim", "custom"] as const;
const LOOKS = ["glass", "tint", "outline", "clear"] as const;
type Look = (typeof LOOKS)[number];
/** Stored values that are not one of the four looks: every one draws Theme. */
const JUNK: unknown[] = ["theme", "", "Glass", "glass ", " glass", "GLASS", "Tint", "tint ", "Outline", "outline ", "CLEAR", " clear", "transparent", "frost", "solid", "on", true, 1, 0, null, {}, [], ["glass"]];
const HEAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144" width="144" height="144">';

function useFont(font: FaceFontId, typeAccents: "on" | "off" = "on"): void {
	setFaceFont(font);
	applyGlobalThemeSettings({ theme: "void", typeAccents, textMode: "theme", textFont: font });
}
before(() => seedGallerySeries());
afterEach(() => useFont("tahoma"));

/** The scenarios a look applies to: every face that is not alerting. */
const ALERTING = new Set(["single-crit"]);
const live = KEY_SCENARIOS.filter((s) => !ALERTING.has(s.id));
const scenario = (id: string): KeyScenario => KEY_SCENARIOS.find((s) => s.id === id) as KeyScenario;

const count = (s: string, needle: string): number => s.split(needle).length - 1;
/** The drawn text runs with every fill removed: position, font and words. */
const runsOf = (svg: string): string[] => [...svg.matchAll(/<text\b[\s\S]*?<\/text>/g)].map((m) => m[0].replace(/ fill="#[0-9A-Fa-f]{6}"/g, ""));
/** Every text and tspan fill. */
const wordFills = (svg: string): string[] => [...svg.matchAll(/<(?:text|tspan)\b[^>]*? fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1] as string);
/** The fills of the 700-weight runs: values (and the 12 px badges). */
const valueFills = (svg: string): string[] => [...svg.matchAll(/font-size="(?:[2-9][0-9]|1[4-9])" font-weight="700" fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1] as string);

/** Every live face of one look beside Theme's face for the same inputs. */
function eachFace(font: FaceFontId, look: Look, fn: (face: string, theme: string, where: string, themeFace: string, mode: string, s: KeyScenario) => void): void {
	useFont(font);
	for (const theme of THEMES) for (const mode of MODES) for (const s of live) {
		fn(composeKeyScenario(s, theme, mode, look), theme, `${font} ${look} ${s.id}/${theme}/${mode}`, composeKeyScenario(s, theme, mode), mode, s);
	}
}

describe("the stored key Background: one exact-value reader", () => {
	it("reads the four looks and nothing else; accent words only as the exact true", () => {
		for (const look of LOOKS) assert.equal(keyBackgroundOf(look), look);
		for (const raw of [undefined, ...JUNK]) assert.equal(keyBackgroundOf(raw), "theme", JSON.stringify(raw));
		assert.equal(keyAccentWordsOf(true), true);
		for (const raw of [undefined, false, "true", 1, "on", null, {}, [true]]) assert.equal(keyAccentWordsOf(raw), false, JSON.stringify(raw));
	});

	for (const font of FONTS) {
		it(`${font}: absent and every other value draw today's face byte for byte on every layout, theme and text mode`, () => {
			useFont(font);
			let compared = 0;
			for (const theme of THEMES) for (const mode of MODES) for (const s of KEY_SCENARIOS) {
				const base = composeKeyScenario(s, theme, mode);
				for (const raw of JUNK) {
					assert.equal(composeKeyScenario(s, theme, mode, raw), base, `${s.id}/${theme}/${mode} ${JSON.stringify(raw)}`);
					compared++;
				}
				// Accent words alone, and on Theme or Clear, change nothing.
				assert.equal(composeKeyScenario(s, theme, mode, undefined, { keyAccentWords: true }), base, `${s.id}/${theme}/${mode} accent words alone`);
				if (mode !== "custom") assert.equal(composeKeyScenario(s, theme, mode, "clear", { keyAccentWords: true }), composeKeyScenario(s, theme, mode, "clear"), `${s.id}/${theme}/${mode} Clear ignores accent words`);
			}
			assert.equal(compared, THEMES.length * MODES.length * KEY_SCENARIOS.length * JUNK.length);
		});
	}
});

describe("what keeps today's face on every look", () => {
	it("an alerting key keeps its warn or critical field (the alert is the background)", () => {
		for (const font of FONTS) {
			useFont(font);
			for (const theme of THEMES) for (const look of LOOKS) {
				const s = scenario("single-crit");
				const face = composeKeyScenario(s, theme, "theme", look, { keyAccentWords: true });
				assert.equal(face, composeKeyScenario(s, theme, "theme"), `${font} ${theme} ${look}`);
				assert.ok(face.includes(`<rect width="144" height="144" fill="${config.alerts.crit.bg}"/>`), `${font} ${theme} ${look}: the critical field`);
				// Every layout at warn: the first reading's legacy limits.
				for (const layout of ["dual", "triple", "quad"]) {
					const warn = { ...scenario(layout), settings: { ...scenario(layout).settings, warnValue: "50" } };
					assert.equal(composeKeyScenario(warn, theme, "dim", look), composeKeyScenario(warn, theme, "dim"), `${font} ${theme} ${look} ${layout} at warn`);
				}
			}
			assert.equal(lookAtLevel("glass", "warn"), "theme");
			assert.equal(lookAtLevel("clear", "crit"), "theme");
			assert.equal(lookAtLevel("tint", "normal"), "tint");
		}
	});

	it("status screens and a missing sensor keep their bytes", () => {
		const statuses: PollerStatus[] = (["not-running", "busy", "disabled", "access-denied", "gadget-empty", "error", "bridge-failed"] as const).map((reason) => ({ state: "unavailable", reason, message: "" }) as PollerStatus);
		for (const look of LOOKS) for (const s of KEY_SCENARIOS) {
			for (const status of statuses) assert.equal(composeKeyScenario(s, "midnight", "theme", look, {}, status), composeKeyScenario(s, "midnight", "theme", undefined, {}, status), `${look} ${s.id} ${JSON.stringify(status)}`);
			const missing = { ...s, settings: { ...s.settings, readingKey: "31:0:ffff", secondaryReadingKey: "31:0:fffe", quadReadingKey3: undefined, quadReadingKey4: undefined } };
			assert.equal(composeKeyScenario(missing, "midnight", "theme", look), composeKeyScenario(missing, "midnight", "theme"), `${look} ${s.id} missing`);
		}
	});

	it("composes the same bytes twice, so the key's frame dedupe still skips unchanged frames", () => {
		for (const look of LOOKS) for (const s of live) assert.equal(composeKeyScenario(s, "midnight", "dim", look), composeKeyScenario(s, "midnight", "dim", look), `${look} ${s.id}`);
	});
});

describe("Glass: the theme background as a panel at 80 %", () => {
	for (const font of FONTS) {
		it(`${font}: one panel, structure in label ink, no opaque box, no mask, filter or painter opacity, the same words in the same places`, () => {
			eachFace(font, "glass", (face, theme, where, themeFace) => {
				const p = config.themes[theme]!;
				assert.ok(face.startsWith(`${HEAD}<defs><linearGradient id="p" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100"><stop offset="0" stop-color="${p.bg}" stop-opacity="${GLASS_OPACITY}"/>`), `${where}: the panel paint opens the face`);
				assert.ok(face.includes(`<linearGradient id="i" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100"><stop offset="0" stop-color="${p.label}" stop-opacity="${GLASS_INK_OPACITY}"/>`), `${where}: the ink paint`);
				assert.equal(count(face, '<rect width="144" height="144" fill="url(#p)"/>'), 1, `${where}: one panel`);
				assert.ok(!face.includes(`"${p.track}"`), `${where}: no opaque track`);
				assert.ok(!new RegExp(`<rect\\b[^>]*fill="${p.bg}"`).test(face), `${where}: no background-colored box`);
				assert.doesNotMatch(face, /<mask|<g\b|<use\b|<clipPath|clip-path|<filter|rgba\(|paint-order| (?:fill-|stroke-)?opacity="|#[0-9A-Fa-f]{8}\b/, `${where}: nothing costly or unsupported`);
				assert.deepEqual(runsOf(face), runsOf(themeFace), `${where}: the same words at the same places`);
			});
		});
	}

	it("built-in text keeps 4.5:1 on the hardest panel in Theme and Dim; Custom stays exact", () => {
		for (const font of FONTS) {
			eachFace(font, "glass", (face, theme, where, _themeFace, mode, s) => {
				const { surface } = glassSurfaces(config.themes[theme]!);
				for (const fill of wordFills(face)) {
					if (mode === "custom") {
						// The quad's default variant colors its values by cell identity.
						assert.ok(fill.toUpperCase() === "#FFD60A" || s.layout === "quad", `${where}: custom ${fill}`);
						continue;
					}
					assert.ok(contrastRatio(fill, surface) >= 4.5, `${where}: ${fill} on ${surface} = ${contrastRatio(fill, surface).toFixed(2)}`);
				}
			});
		}
	});
});

describe("Outline: no background, a 1 px edge from one filter pass", () => {
	for (const font of FONTS) {
		it(`${font}: one filter and one group holding every word and mark, structure outside it, no box, shaded area, mask or copy`, () => {
			eachFace(font, "outline", (face, theme, where, themeFace) => {
				const p = config.themes[theme]!;
				assert.ok(face.startsWith(`${HEAD}<defs><filter id="h" filterUnits="userSpaceOnUse" x="0" y="0" width="144" height="144" `), where);
				assert.doesNotMatch(face, /<rect width="144" height="144"/, `${where}: face fill`);
				assert.doesNotMatch(face, /<path d="M[0-9.]+,134 /, `${where}: the graph's shaded area`);
				assert.doesNotMatch(face, /<mask|<use\b|clip-?path|rgba\(|#[0-9A-Fa-f]{8}\b|paint-order|opacity="|<text\b[^>]*\bstroke=/, `${where}: unsupported or costly paint`);
				assert.ok(!new RegExp(`<rect\\b[^>]*fill="${p.bg}"`).test(face), `${where}: no background-colored box`);
				assert.equal(count(face, "<filter "), 1, `${where}: one filter`);
				assert.equal(count(face, '<g filter="url(#h)">'), 1, `${where}: one group`);
				assert.ok(face.endsWith("</g></svg>"), `${where}: the group closes the face`);
				const group = face.slice(face.indexOf('<g filter="url(#h)">'));
				assert.equal(count(group, "<text"), count(face, "<text"), `${where}: every word inside the group`);
				assert.equal(count(group, 'height="2" fill='), 0, `${where}: dividers keep their hairline outside the group`);
				assert.deepEqual(runsOf(face), runsOf(themeFace), `${where}: the same words at the same places`);
			});
		});
	}

	it("rings dark themes in black and Paper in its background; built-in text keeps 4.5:1 against the ring", () => {
		for (const font of FONTS) {
			eachFace(font, "outline", (face, theme, where, _themeFace, mode) => {
				if (mode === "custom") return;
				const ring = haloRingColor(config.themes[theme]!);
				for (const fill of wordFills(face)) assert.ok(contrastRatio(fill, ring) >= 4.5, `${where}: ${fill} against ${ring} = ${contrastRatio(fill, ring).toFixed(2)}`);
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
				const panel = `<defs><linearGradient id="t" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100"><stop offset="0" stop-color="${p.bg}" stop-opacity="${TINT_OPACITY}"/><stop offset="1" stop-color="${p.bg}" stop-opacity="${TINT_OPACITY}"/></linearGradient></defs><rect width="144" height="144" fill="url(#t)"/>`;
				const twin = outline.get(where.replace(" tint ", " ")) as string;
				assert.equal(face, `${HEAD}${panel}${twin.slice(HEAD.length)}`, `${where}: Outline plus the panel`);
				compared++;
			});
			assert.equal(compared, outline.size);
		});
	}
});

describe("Clear: no background and no edge, one ink", () => {
	for (const font of FONTS) {
		it(`${font}: only #RRGGBB paint, no box, graphics on their track, the same words in the same places`, () => {
			eachFace(font, "clear", (face, theme, where, themeFace, _mode, s) => {
				const p = config.themes[theme]!;
				assert.doesNotMatch(face, /<rect width="144" height="144"/, `${where}: face fill`);
				assert.doesNotMatch(face, /<defs|<g[ >]|<filter|<mask|opacity|rgba\(|paint-order|clip-path/, `${where}: nothing costly or unsupported`);
				for (const m of face.matchAll(/\b(?:fill|stroke)="([^"]*)"/g)) assert.ok(m[1] === "none" || /^#[0-9A-Fa-f]{6}$/.test(m[1] as string), `${where}: paint ${m[1]}`);
				assert.ok(!new RegExp(`<rect\\b[^>]*fill="${p.bg}"`).test(face), `${where}: no background-colored box`);
				if (s.id.includes("bar")) assert.match(face, new RegExp(`<rect x="(15|39)" y="119" width="(114|90)" height="12" rx="6" fill="${p.track}"/>`), `${where}: the bar on its backing`);
				if (s.id.includes("ring")) assert.match(face, new RegExp(`stroke="${p.track}" stroke-width="12"`), `${where}: the ring on its backing`);
				assert.deepEqual(runsOf(face), runsOf(themeFace), `${where}: the same words at the same places`);
			});
		});
	}

	it("Theme and Dimmed text draw every word in the value color, quad cell colors aside; Custom keeps its exact colors", () => {
		useFont("tahoma");
		for (const theme of THEMES) for (const mode of ["theme", "dim"] as const) for (const s of live.filter((x) => x.layout !== "quad")) {
			const face = composeKeyScenario(s, theme, mode, "clear");
			assert.equal(new Set(wordFills(face)).size, 1, `${s.id}/${theme}/${mode}: one ink (${[...new Set(wordFills(face))].join(", ")})`);
		}
		const custom = parseTextSettings({ textMode: "custom", textColor: "#3366FF", textDimSecondary: true }) as TextSettings;
		const palette = config.themes.void!;
		assert.deepEqual(keyTextColors("clear", palette, custom), resolveTextColors(palette, custom, "normal"));
	});

	it("a four-reading key keeps its cell colors on Clear (values or micro-labels) and draws every other word in the one ink", () => {
		useFont("tahoma");
		let checked = 0;
		for (const theme of THEMES) for (const mode of ["theme", "dim"] as const) for (const s of live.filter((x) => x.layout === "quad")) {
			const labeled = s.settings.quadLabels === true;
			const cells = QUAD_DEFAULT_COLORS.map((c) => automaticIdentityColor(c, mode, labeled, config.themes[theme]!.bg));
			const clear = new Set(wordFills(composeKeyScenario(s, theme, mode, "clear")));
			const themeFills = new Set(wordFills(composeKeyScenario(s, theme, mode)));
			for (const cell of cells) {
				assert.ok(clear.has(cell), `${s.id}/${theme}/${mode}: cell color ${cell} kept`);
				assert.ok(themeFills.has(cell), `${s.id}/${theme}/${mode}: the same cell color as Theme draws`);
			}
			const others = [...clear].filter((f) => !cells.includes(f));
			assert.equal(others.length, 1, `${s.id}/${theme}/${mode}: one ink besides the cells (${others.join(", ")})`);
			checked++;
		}
		assert.equal(checked, THEMES.length * 2 * 3);
	});
});

describe("Words in the accent color: Glass, Tint and Outline only, word fills only", () => {
	/** The face without its word fills, nor the Back hook's paint (the hook
	 * is drawn in the unit color, a word color). */
	const unfilled = (svg: string): string =>
		svg
			.replace(/(<(?:text|tspan)\b[^>]*?) fill="#[0-9A-Fa-f]{6}"/g, "$1")
			.replace(/(<path d="M[0-9]+ [0-9]+ v5[^>]*?) stroke="#[0-9A-Fa-f]{6}"/g, "$1")
			.replace(/(<polygon\b[^>]*?) fill="#[0-9A-Fa-f]{6}"/g, "$1");
	for (const font of FONTS) {
		it(`${font}: only word fills change; values, cell colors and Custom text keep their bytes; every word keeps 4.5:1 on the look's surface`, () => {
			useFont(font);
			for (const look of ["glass", "tint", "outline"] as const) for (const theme of THEMES) for (const mode of MODES) for (const s of live) {
				const where = `${font} ${look} ${s.id}/${theme}/${mode}`;
				const face = composeKeyScenario(s, theme, mode, look, { keyAccentWords: true });
				const plain = composeKeyScenario(s, theme, mode, look);
				assert.equal(unfilled(face), unfilled(plain), `${where}: the same elements besides word fills`);
				if (mode === "custom") {
					assert.equal(face, plain, `${where}: Custom stays exact`);
					continue;
				}
				if (s.layout !== "quad") assert.deepEqual(valueFills(face).slice(0, 1), valueFills(plain).slice(0, 1), `${where}: the value`);
				const p = config.themes[theme]!;
				const here = look === "glass" ? glassSurfaces(p).surface : haloRingColor(p);
				for (const fill of wordFills(face)) assert.ok(contrastRatio(fill, here) >= 4.5, `${where}: ${fill} on ${here}`);
			}
		});
	}
});

describe("no mask: the gaps a Theme face paints over are left out of the structure", () => {
	const track = config.themes.midnight!.track;
	it("a divider, separator or cross arm is drawn in pieces around the badge and the hook", () => {
		useFont("tahoma");
		for (const look of ["clear", "outline"] as const) {
			const dual = composeKeyScenario(scenario("dual-max"), "midnight", "theme", look);
			assert.ok(dual.includes(`<rect x="12" y="71" width="35" height="2" fill="${track}"/><rect x="97" y="71" width="35" height="2" fill="${track}"/>`), `${look}: dual divider around the badge`);
			const backDual = composeKeyScenario(scenario("back-dual-max"), "midnight", "theme", look);
			assert.ok(backDual.includes(`<rect x="40" y="71" width="7" height="2" fill="${track}"/><rect x="97" y="71" width="35" height="2" fill="${track}"/>`), `${look}: and past the hook`);
			const triple = composeKeyScenario(scenario("back-triple-avg"), "midnight", "theme", look);
			assert.ok(triple.includes(`<rect x="40" y="47" width="7" height="2" fill="${track}"/><rect x="97" y="47" width="35" height="2" fill="${track}"/>`), `${look}: the first separator`);
			assert.ok(triple.includes(`<rect x="12" y="95" width="120" height="2" fill="${track}"/>`), `${look}: the second separator whole`);
			const quad = composeKeyScenario(scenario("back-quad-min"), "midnight", "theme", look);
			assert.ok(quad.includes(`<rect x="71" y="12" width="2" height="51" fill="${track}"/><rect x="71" y="77" width="2" height="55" fill="${track}"/>`), `${look}: the upright arm around the badge`);
		}
	});

	it("a ring under a stat badge leaves its crown open; without a badge it is one arc", () => {
		useFont("tahoma");
		const p = config.themes.midnight!;
		for (const look of LOOKS) {
			const paint = look === "glass" ? "url(#i)" : p.track;
			assert.equal(count(composeKeyScenario(scenario("single-ring-max"), "midnight", "theme", look), `stroke="${paint}"`), 2, `${look}: two track arcs`);
			assert.equal(count(composeKeyScenario(scenario("single-ring"), "midnight", "theme", look), `stroke="${paint}"`), 1, `${look}: one track arc`);
		}
		// The arcs end where the crown's centerline is past the badge's gap.
		assert.ok(46 * Math.sin((RING_BADGE_HOLE_DEG * Math.PI) / 180) - 5 >= 25, "the cap clears x 47..97");
	});

	it("a Back tile's graph starts clear of the hook instead of under a mask", () => {
		useFont("tahoma");
		for (const look of LOOKS) {
			const spark = composeKeyScenario(scenario("back-sparkline"), "midnight", "theme", look);
			const xs = [...(/<polyline points="([^"]+)"/.exec(spark)?.[1] ?? "").matchAll(/([0-9.]+),/g)].map((m) => Number(m[1]));
			assert.ok(xs.length > 2 && Math.min(...xs) >= 40 && Math.max(...xs) <= 136, `${look}: the line spans x 40..136`);
			const bar = composeKeyScenario(scenario("back-bar"), "midnight", "theme", look);
			assert.match(bar, / x="(40|39)" y="(120|119)" width="(88|90)"/, `${look}: the bar starts at x 40`);
		}
	});

	it("cuts a three-row label to the room its value leaves, pricing fallback glyphs at their measured width", () => {
		for (const font of FONTS) {
			useFont(font);
			const palette = resolvePalette(config, "midnight", null, "normal");
			const rows = [{ label: "⚡⚡⚡⚡⚡⚡⚡⚡", valueText: "1234.5", unitText: "MHz" }];
			for (const look of LOOKS) {
				const face = renderTripleKey({ rows, palette, background: look });
				const label = /text-anchor="start"[^>]*>([^<]*)<\/text>/.exec(face)?.[1] ?? "";
				if (label === "") continue;
				const size = Number(/text-anchor="start"[^>]*font-size="([0-9]+)"/.exec(face)?.[1]);
				const valueSize = Number(/text-anchor="end"[^>]*font-size="([0-9]+)"/.exec(face)?.[1]);
				if (font === "tahoma") {
					const chunk = inkEdges([{ text: "1234.5", fontSize: valueSize, fontWeight: 700 }, { text: "MHz", fontSize: 14 }], "end", 132).left;
					assert.ok(inkEdges([{ text: label, fontSize: size, fallbackAdvance12: SEE_THROUGH_FALLBACK_ADVANCE_12 }], "start", 12).right <= chunk - INK_CLEAR_GAP, `${font} ${look}: "${label}"`);
				} else {
					assert.ok(12 + estimateKeyTextWidth(label, size, { fallbackAdvance12: SEE_THROUGH_FALLBACK_ADVANCE_12 }) <= 132 - estimateKeyTextWidth("1234.5", valueSize, { fontWeight: 700 }) - estimateKeyTextWidth("MHz", 14) - 8 + 2, `${font} ${look}: "${label}"`);
				}
			}
		}
	});

	it("draws a Trend window's shaded area only where the look keeps it", () => {
		const palette = resolvePalette(config, "midnight", null, "normal");
		const view = { widthPx: 128, window: "1m", cols: { n: 3, x: [10, 60, 120], seg: [0, 0, 0], first: [1, 2, 3], last: [1, 2, 3], min: [1, 2, 3], max: [1, 2, 3] }, extent: { min: 1, max: 3 }, segments: [{ open: true }] };
		for (const look of [undefined, ...LOOKS] as (KeyBackground | undefined)[]) {
			const face = renderReadingKey({ label: "CPU", valueText: "56.3", unitText: "°C", statBadge: "", palette, timeline: view as never, background: look });
			assert.equal(/<path d="M[^"]*Z" fill=/.test(face), look !== "tint" && look !== "outline", `${look}: shaded area`);
		}
	});
});

// --- the detail view draws in the opener's look ------------------------------
function detailState(presentation: DeviceDetailState["presentation"]): DeviceDetailState {
	const R = GALLERY_READINGS;
	return {
		deviceId: "dev1",
		pageSize: 11,
		density: 1,
		tilePlan: [],
		primaryKey: R.cpu.key,
		groupSettings: { readingKey: R.cpu.key },
		presentation,
		group: { mode: "source", primaryKey: R.cpu.key, title: "Sample sensors", keys: [R.gpu.key, R.fan.key, R.clock.key, R.hot.key] },
		offset: 0,
		statModes: new Map(),
		surfaceCount: 1,
		pending: false,
		dispatchedAt: 0,
		openerCell: null,
		mirrorSlotIndex: null
	} as unknown as DeviceDetailState;
}

describe("detail tiles follow the opener's key look", () => {
	const ctx: DetailFaceContext = { config, deckThemeId: "midnight", typeAccents: true, measure: { decimals: "auto", fahrenheit: false, dataUnits: "decimal" }, text: effectiveTextSettings(parseTextSettings({}), null) };
	const R = GALLERY_READINGS;
	const faces = (presentation: DeviceDetailState["presentation"]): string[] => {
		const state = detailState(presentation);
		const page = pageOf(state.group.keys, 0, 11);
		return [
			composeBackFace(state, GALLERY_STATUS, ctx),
			composeReadingFace(state, R.gpu.key, "current", GALLERY_STATUS, ctx),
			composeReadingFace(state, undefined, "current", GALLERY_STATUS, ctx),
			composeReadingFace(state, "31:0:ffff", "current", GALLERY_STATUS, ctx),
			composeChunkFace(state, [R.gpu.key, R.fan.key], "max", GALLERY_STATUS, ctx),
			composeChunkFace(state, [R.gpu.key, R.fan.key, R.clock.key], "current", GALLERY_STATUS, ctx),
			composeChunkFace(state, [R.gpu.key, R.fan.key, R.clock.key, R.hot.key], "min", GALLERY_STATUS, ctx),
			composeTitleFace(state, page, ctx),
			composePagerFace("next", page, state, ctx),
			composeGapFace(state, ctx)
		];
	};

	it("no look, or a value the reader does not know, keeps every detail face's bytes", () => {
		useFont("tahoma");
		const base = faces({ theme: "midnight" });
		for (const raw of JUNK) assert.deepEqual(faces({ theme: "midnight", keyBackground: raw as string }), base, JSON.stringify(raw));
	});

	it("each look draws every tile in its form: no opaque face fill, the panel on Glass and Tint, nothing at all on an empty Outline or Clear tile", () => {
		useFont("tahoma");
		const p = config.themes.midnight!;
		for (const look of LOOKS) {
			for (const face of faces({ theme: "midnight", keyBackground: look })) {
				assert.ok(!face.includes(`<rect width="144" height="144" fill="${p.bg}"/>`), `${look}: ${face.slice(0, 160)}`);
				if (look === "glass") assert.ok(face.includes('fill="url(#p)"'), `${look}: the panel`);
				if (look === "tint") assert.ok(face.includes('fill="url(#t)"'), `${look}: the panel`);
			}
			const blank = renderDetailBlankKey(p, look);
			if (look === "outline" || look === "clear") assert.equal(blank, `${HEAD}</svg>`, `${look}: an empty tile draws nothing, not even a filter`);
		}
		// The Back tile at an alert keeps its field.
		const hot = detailState({ theme: "midnight", keyBackground: "glass", warnValue: "50" });
		assert.ok(composeBackFace(hot, GALLERY_STATUS, ctx).includes(`<rect width="144" height="144" fill="${config.alerts.warn.bg}"/>`));
	});
});

// --- what a user sees, pinned ------------------------------------------------
const GOLDEN = new URL("./golden/key-backgrounds.json", import.meta.url);
const PINNED: { font: FaceFontId; theme: string }[] = [
	{ font: "tahoma", theme: "midnight" },
	{ font: "segoe-ui", theme: "midnight" },
	{ font: "tahoma", theme: "paper" }
];
/** One face per layout family for the second font, the light theme and
 * accent words; the first pin carries every scenario. */
const PER_LAYOUT = ["single-sparkline", "single-ring-max", "dual-max", "triple-avg", "quad-labels-min", "back-bar"];
function pinnedFaces(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [i, { font, theme }] of PINNED.entries()) {
		useFont(font);
		for (const look of LOOKS) for (const s of KEY_SCENARIOS) if (i === 0 || PER_LAYOUT.includes(s.id)) out[`${look}/${font}/${theme}/${s.id}`] = composeKeyScenario(s, theme, "theme", look);
	}
	useFont("tahoma");
	for (const look of ["glass", "tint", "outline"] as const) for (const id of PER_LAYOUT) out[`${look}+accent words/tahoma/midnight/${id}`] = composeKeyScenario(scenario(id), "midnight", "theme", look, { keyAccentWords: true });
	return out;
}

describe("golden key faces per look", () => {
	it("draw exactly the pinned SVG (four looks x every layout, the Back tile, a snoozed and an alerting face; Tahoma and Segoe UI; a dark and a light theme; accent words)", () => {
		const faces = pinnedFaces();
		if (process.env.HW_UPDATE_GOLDEN === "1" || !existsSync(GOLDEN)) {
			if (process.env.HW_UPDATE_GOLDEN !== "1") assert.fail("test/golden/key-backgrounds.json is missing; create it with HW_UPDATE_GOLDEN=1");
			writeFileSync(GOLDEN, `${JSON.stringify(faces, null, "\t")}\n`);
		}
		const pinned = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;
		assert.deepEqual(Object.keys(faces).sort(), Object.keys(pinned).sort());
		for (const [key, face] of Object.entries(faces)) assert.equal(face, pinned[key], `${key} changed; rerun with HW_UPDATE_GOLDEN=1 if intended, and review the diff`);
	});
});
