/**
 * Expansion check: every runtime catalog string in a pseudo-locale (40%
 * longer, accented Latin, src/i18n.ts pseudoLocalize) drawn through the key,
 * dial and strip renderers. A line must either draw whole or be cut with an
 * ellipsis by the renderer's own fit (truncation by design); no line may
 * draw past the face. Where a face does not fit text at all, the test
 * records it: under the Segoe UI face font the key status lines have a
 * fixed size, and a dial status face's title and value line are cut by
 * character count, so a language longer than English runs off the face
 * there. (Tahoma's dial value line is cut by count too, but every pseudo
 * string fits it.) English fits; closing those gaps is
 * a precondition for adding a language (docs/localization.md).
 * Numbers keep the '.' decimal separator whatever the language.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { makeView } from "../scripts/lib/strip-fixtures";
import type { SensorSnapshot } from "../src/hwinfo/types";
import { englishOf, pseudoLocalize, setTranslator, t } from "../src/i18n";
import type { PollerStatus } from "../src/poller";
import { buildStripScene, type StripSceneInput, type StripSeriesInput } from "../src/strip/scene";
import { stripConfigOf, stripPaneOf, type StripStyle } from "../src/strip/settings";
import { renderDial } from "../src/ui/dial-renderer";
import { setFaceFont } from "../src/ui/face-font";
import { estimateKeyTextWidth, inksWithin, STAT_BADGE } from "../src/ui/format";
import { renderReadingKey, renderStatusKey, type StatusKeyOptions } from "../src/ui/key-renderer";
import { formatMeasurement, formatStat } from "../src/ui/measure";
import { missingReadingScreen, noSelectionScreen, statusDialText, statusScreen } from "../src/ui/state-screens";
import { loadThemes, resolvePalette } from "../src/ui/themes";

const palette = resolvePalette(loadThemes(), "void", null, "normal");
const EMPTY: SensorSnapshot = { pollTime: 1, version: 1, revision: 0, sensors: [], readings: [], byKey: new Map() };
const STATUSES: Array<[string, PollerStatus]> = [
	["stale shared", { state: "stale", snapshot: EMPTY, source: "shared-memory", staleForMs: 20_000 }],
	["stale gadget", { state: "stale", snapshot: EMPTY, source: "gadget", staleForMs: 20_000 }],
	...(["unsupported-platform", "not-running", "busy", "gadget-empty", "access-denied", "disabled", "invalid", "bridge-failed"] as const).map((reason): [string, PollerStatus] => [reason, { state: "unavailable", reason, message: "" }])
];

/** Every key status face, named. */
function keyFaces(): Array<[string, StatusKeyOptions]> {
	return [
		...STATUSES.map(([name, status]): [string, StatusKeyOptions] => [name, statusScreen(status) as StatusKeyOptions]),
		["no selection", noSelectionScreen()],
		["missing", missingReadingScreen()]
	];
}

/** Every dial status text, named. */
function dialTexts(): Array<[string, { title: string; value: string; hint?: string }]> {
	return [
		...STATUSES.map(([name, status]): [string, { title: string; value: string }] => [name, statusDialText(status) as { title: string; value: string }]),
		// The face a dial with no reading picked draws (src/actions/sensor-dial.ts).
		["no selection", { title: t("dial.noSelection.title"), value: t("dial.noSelection.value"), hint: t("dial.noSelection.hint") }]
	];
}

type Drawn = { x: number; size: number; weight: number; text: string };
const drawn = (svg: string): Drawn[] =>
	[...svg.matchAll(/<text x="([\d.]+)" y="[\d.]+"[^>]*font-size="(\d+)" font-weight="(\d+)"[^>]*>(.*?)<\/text>/g)].map((m) => ({
		x: Number(m[1]),
		size: Number(m[2]),
		weight: Number(m[3]),
		text: (m[4] as string).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
	}));

/** Whole, or the renderer's ellipsis cut of the source line. */
function wholeOrCut(shown: string, source: string): "whole" | "cut" | "other" {
	if (shown === source) return "whole";
	if (shown.endsWith("…") && source.startsWith(shown.slice(0, -1).trimEnd())) return "cut";
	return "other";
}

const pseudo = (key: string): string => pseudoLocalize(englishOf(key) ?? key);

describe("pseudo-locale through the renderers", () => {
	before(() => setTranslator(pseudo));
	after(() => {
		setTranslator(null);
		setFaceFont("tahoma");
	});

	it("Tahoma key status faces: every line inks inside the lens, whole or cut with an ellipsis", () => {
		setFaceFont("tahoma");
		let cut = 0;
		for (const [name, face] of keyFaces()) {
			const lines = drawn(renderStatusKey(face));
			assert.equal(lines.length, face.lines.length, name);
			lines.forEach((line, i) => {
				const how = wholeOrCut(line.text, face.lines[i] as string);
				assert.notEqual(how, "other", `${name} line ${i}: ${line.text}`);
				if (how === "cut") cut++;
				assert.ok(inksWithin([{ text: line.text, fontSize: line.size }], "middle", line.x, 10, 133), `${name} line ${i} inks past the lens: ${line.text}`);
			});
		}
		// Recorded: at +40% most headlines step down to 14 px and still cut.
		assert.ok(cut > 0, "the pseudo-locale should exercise the ellipsis");
	});

	it("Segoe UI key status faces: recorded, the fixed-size lines run off the key", () => {
		setFaceFont("segoe-ui");
		// Segoe UI has no ink model: the estimate against the key's own edges
		// (1.7 drew "Shared Memory" past the lens, inside the key, on purpose).
		const over = (face: StatusKeyOptions): boolean =>
			drawn(renderStatusKey(face)).some((line) => {
				const half = estimateKeyTextWidth(line.text, line.size) / 2;
				return line.x - half < 0 || line.x + half > 144;
			});
		const runOff = keyFaces().filter(([, face]) => over(face)).map(([name]) => name);
		// The gap a new language must close first (docs/localization.md):
		// Segoe UI draws status lines at a fixed 19 and 13 px with no fit.
		assert.ok(runOff.length > 0, "the Segoe UI status lines now fit: update docs/localization.md and this record");
		// English fits today, so no shipped face is affected.
		setTranslator(null);
		const english = keyFaces().filter(([, face]) => over(face)).map(([name]) => name);
		setTranslator(pseudo);
		assert.deepEqual(english, [], "an English status line runs off a Segoe UI key");
	});

	/** Whether a drawn dial line stays inside the 200 px slot. */
	const dialFits = (font: "tahoma" | "segoe-ui", line: Drawn): boolean =>
		font === "tahoma"
			? inksWithin([{ text: line.text, fontSize: line.size, fontWeight: line.weight === 700 ? 700 : undefined }], "start", line.x, 1, 198)
			: line.x + estimateKeyTextWidth(line.text, line.size, line.weight === 700 ? { fontWeight: 700 } : undefined) <= 199;
	const dialLines = (text: { title: string; value: string; hint?: string }): Drawn[] =>
		drawn(renderDial({ title: text.title, valueText: text.value, unitText: "", statsText: text.hint ?? "", fraction: Number.NaN, palette, barColor: palette.accent }));

	/** The dial lines (0 title, 1 value, 2 hint) that stay inside the slot
	 * at +40%: Tahoma fits the title and hint by ink, and its count-cut value
	 * line fits too; Segoe UI fits the hint by its footer estimate and cuts
	 * the title and value by count. */
	const WIDTH_FITTED = { tahoma: [0, 1, 2], "segoe-ui": [2] } as const;

	for (const font of ["tahoma", "segoe-ui"] as const) {
		it(`${font} dial status faces: the fitting lines stay inside the 200 px slot, whole or cut`, () => {
			setFaceFont(font);
			for (const [name, text] of dialTexts()) {
				const lines = dialLines(text);
				const sources = [text.title, text.value, ...(text.hint === undefined ? [] : [text.hint])];
				lines.forEach((line, i) => {
					assert.notEqual(wholeOrCut(line.text, sources[i] as string), "other", `${name} line ${i}: ${line.text}`);
					// Segoe UI has no ink model: its hint fit is the renderer's own
					// footer estimate, so whole-or-cut is the proof there.
					if (font === "tahoma" && (WIDTH_FITTED[font] as readonly number[]).includes(i)) assert.ok(dialFits(font, line), `${font} ${name} line ${i} runs past the slot: ${line.text} at ${line.size}px`);
				});
			}
		});

	}

	it("segoe-ui dial status faces: recorded, the title and value cut by length run past the slot", () => {
		setFaceFont("segoe-ui");
		const runOff = (): string[] => dialTexts().filter(([, text]) => dialLines(text).some((line, i) => !(WIDTH_FITTED["segoe-ui"] as readonly number[]).includes(i) && !dialFits("segoe-ui", line))).map(([name]) => name);
		assert.ok(runOff().length > 0, "every dial status line now fits by width: update docs/localization.md and this record");
		setTranslator(null);
		const english = runOff();
		setTranslator(pseudo);
		assert.deepEqual(english, [], "an English dial status line runs past the slot");
	});

	it("the stat badge draws whole on a single reading key", () => {
		setFaceFont("tahoma");
		for (const mode of ["min", "max", "avg"] as const) {
			const svg = renderReadingKey({ label: "CPU", valueText: "56.3", unitText: "°C", statBadge: STAT_BADGE[mode], palette });
			const badge = drawn(svg).find((line) => line.text === STAT_BADGE[mode].toUpperCase());
			assert.ok(badge !== undefined, `${mode}: the badge ${STAT_BADGE[mode]} is drawn whole`);
		}
	});

	for (const [encoders, layout] of [[4, "whole"], [4, "split"], [6, "split"]] as const) {
		it(`strip empty panes on ${encoders} dials, ${layout}: the message fits its pane`, () => {
			setFaceFont("tahoma");
			const series: StripSeriesInput = { key: "cpu", name: "CPU", unit: "°C", state: "ok", history: makeView({ windowMs: 300_000, widthPx: 400, unit: "°C", value: () => 50 }) };
			for (const [style, list, key] of [["trend", [], "strip.chooseReadings"], ["lanes", [series], "strip.lanesNeedSecond"], ["compare", [series], "strip.compareNeedSecond"]] as Array<[StripStyle, StripSeriesInput[], string]>) {
				const pane = stripPaneOf({ style, series: list.map((s) => ({ key: s.key })), overlays: {}, bands: [], scale: {} });
				const config = { ...stripConfigOf({ encoders, layout, fahrenheit: false, background: "theme" }), panes: [pane, pane] as const };
				const input: StripSceneInput = { config, encoders, palette, text: { mode: "theme", color: undefined, dimSecondary: false }, alertColors: { warn: "#FFB000", crit: "#FF3B30" }, dataUnits: "decimal", panes: [{ series: list, bands: [], view: { mode: "live" }, highlight: 0 }, { series: list, bands: [], view: { mode: "live" }, highlight: 0 }] };
				const paneWidth = (encoders * 200) / (layout === "split" ? 2 : 1);
				const texts = buildStripScene(input).prims.filter((p) => p.k === "text");
				const message = texts.find((p) => p.text.startsWith("[") && wholeOrCut(p.text, pseudo(key)) !== "other");
				assert.ok(message !== undefined, `${style}: no ${key} drawn among ${JSON.stringify(texts.map((p) => p.text))}`);
				assert.ok(estimateKeyTextWidth(message.text, message.size) <= paneWidth - 8, `${style}: ${message.text} is wider than its ${paneWidth} px pane`);
			}
		});
	}

	it("numbers keep the '.' decimal separator in any language", () => {
		const opts = { decimals: "auto" as const, fahrenheit: false, dataUnits: "decimal" as const };
		assert.equal(formatMeasurement(1.256, "V", opts).valueText, "1.26");
		assert.match(formatStat(56.25, "°C", opts), /^56\.\d/);
	});
});
