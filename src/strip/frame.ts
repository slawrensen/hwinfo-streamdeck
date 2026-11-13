/**
 * One strip frame's inputs, from one snapshot. Pure: the controller hands
 * in the poller status, the history reader, the frame time and the group's
 * runtime view, and gets back the scene input that buildStripScene and
 * sliceStrip turn into slices. Nothing here writes or keeps state.
 *
 * - A reading's state comes from the poller status and the snapshot: a
 *   missing reading is "missing", a stale source is "stale", no source is
 *   "unavailable". Only a live, finite value is passed as the current
 *   value; everything else draws a status word, never a plausible number.
 * - History is asked for at one aligned time per pane, derived from the
 *   frame time, so every series in a pane shares one time domain and a
 *   frame with nothing new is byte-identical to the last one.
 * - A paused pane draws the copy it froze when inspection began; polling,
 *   history and alerts carry on underneath.
 * - The rotation window is a runtime view setting: it changes the
 *   effective config of the frame, never the stored copy.
 */
import type { HistoryReader, HistoryWindowId } from "../history/types";
import type { PollerStatus } from "../poller";
import { withArtSky, type ArtSky } from "../ui/deck-art";
import type { DialBackground } from "../ui/dial-background";
import { dialAccentWordsFor, dialBackgroundFor, stripSkyFor } from "../ui/shared-looks";
import type { TextSettings } from "../ui/text-colors";
import { effectiveTextFor, effectiveThemeFor, getDataUnits } from "../ui/theme-store";
import { loadThemes, resolvePalette, type Palette } from "../ui/themes";
import { DEFAULT_BUCKET_PX, type BucketPx, type StripEncoders } from "./geometry";
import { mergeRemembered, resolveGroup, ruleDrawMax, type GroupResolution } from "./group";
import { tileGridFor } from "./tiles";
import { alignedNow, historyWidthFor, stripAlertColors, stripBandsFor, stripMessageFace, WINDOW_MS, type GroupPaneInfo, type PaneScaleOut, type ScreenLabel, type StripPaneInput, type StripSceneInput, type StripSeriesInput } from "./scene";
import { activePanes, drawnSeries, isRuleStyle, paneWindowOf, screenKeysOf, screensOf, type StripConfigV1, type StripPaneV1 } from "./settings";

/** One pane's runtime view: live, or paused with a frozen copy. */
export type PaneView =
	| { readonly mode: "live" }
	| {
			readonly mode: "paused";
			/** The cursor, as ms before the newest bucket's end. */
			readonly agoMs: number;
			/** Wall-clock time the pause began ("14:02:51"). */
			readonly label: string;
			/** The frame time the copy was taken at. */
			readonly frozenAt: number;
			/** The window the copy was taken in. */
			readonly window: HistoryWindowId;
			readonly series: readonly StripSeriesInput[];
			/** A Group pane: the readings it drew when the copy was taken. */
			readonly group?: GroupFrame;
			/** The pane's scales as they stood when the copy was taken: frozen
			 * with it, so a pause never moves a scale. */
			readonly scales?: PaneScaleOut;
	  };

/** A pane's turned scale (the scale dial, src/strip/scale.ts stepSpan):
 * the span it was turned to (view units), the span on screen when the turn
 * began (a stop; landing on it ends the turn), and the stored setup it was
 * made for (a frame whose pane no longer matches drops it). Session state,
 * never written: the twin of the turned window. */
export type ScaleTurn = { readonly span: number; readonly start: number; readonly sig: string };

/** A group's runtime view state. Never persisted. */
export type GroupView = {
	readonly panes: readonly [PaneView, PaneView];
	/** Rotation's window for the shared window (whole, or split sharing it). */
	readonly shared: HistoryWindowId | null;
	/** Rotation's window per pane (split with its own windows). */
	readonly pane: readonly [HistoryWindowId | null, HistoryWindowId | null];
	/** The highlighted series per pane (pressed rotation, or a lane tap). */
	readonly highlight: readonly [number, number];
	/** A Group pane's highlighted reading, by key; null is home (the
	 * group's highest reading shows). Session state, never written. */
	readonly groupHighlight: readonly [string | null, string | null];
	/** Strip Screens: the screen on view by its key (screenKeysOf); null is
	 * the first. Session state, never written: kept with the rest of the
	 * view across a page swipe, and a cold start shows the first. */
	readonly screen: string | null;
	/** The turned window of each screen not on view, by key (the one on
	 * view turns `shared`), so a screen keeps its window for the session. */
	readonly turned: Readonly<Record<string, HistoryWindowId>>;
	/** Each pane's turned scale (the scale dial), null on the automatic
	 * scale or typed ends; and pane 0's of each screen not on view, by key,
	 * as `turned` keeps their windows. Session state, never written. */
	readonly scaleTurn: readonly [ScaleTurn | null, ScaleTurn | null];
	readonly scaleTurns: Readonly<Record<string, ScaleTurn>>;
};

/** A Group pane's readings for one frame: the rule's resolution and the
 * keys that draw (the resolution with remembered readings kept in place). */
export type GroupFrame = { readonly resolution: GroupResolution; readonly keys: readonly string[] };

export const LIVE: PaneView = { mode: "live" };

export function freshView(): GroupView {
	return { panes: [LIVE, LIVE], shared: null, pane: [null, null], highlight: [0, 0], groupHighlight: [null, null], screen: null, turned: {}, scaleTurn: [null, null], scaleTurns: {} };
}

/** The position of the screen on view among the stored config's screens:
 * 0 for the first, for a key no screen has (removed), and while split. */
export function screenIndexOf(config: StripConfigV1, view: Pick<GroupView, "screen">): number {
	if (view.screen === null || config.layout !== "whole" || config.screens === undefined) return 0;
	return Math.max(0, screenKeysOf(config).indexOf(view.screen));
}

/** The config a frame draws: the stored copy with the screen on view in
 * panes[0] and the session's window choices applied (runtime view
 * settings, never written). Frames, slices, input, hints, interest, the
 * panel's counts and Control commands all read this one; only screen
 * navigation reads the stored list (screensOf on the stored copy). */
export function effectiveConfig(stored: StripConfigV1, view: GroupView): StripConfigV1 {
	const index = screenIndexOf(stored, view);
	const config = index === 0 ? stored : { ...stored, panes: [screensOf(stored)[index] as StripPaneV1, stored.panes[1]] as const };
	const splitOwn = config.layout === "split" && !config.sharedWindow;
	if (splitOwn) {
		const [a, b] = view.pane;
		if (a === null && b === null) return config;
		const panes: [StripPaneV1, StripPaneV1] = [a === null ? config.panes[0] : { ...config.panes[0], window: a }, b === null ? config.panes[1] : { ...config.panes[1], window: b }];
		return { ...config, panes };
	}
	return view.shared === null || view.shared === config.window ? config : { ...config, window: view.shared };
}

/** Where a frame reads its data from. One status, one reader, one time. */
export type FrameSources = {
	readonly status: PollerStatus;
	readonly history: Pick<HistoryReader, "view" | "refused">;
	/** The frame time (monotonic ms): the right edge before bucket alignment. */
	readonly now: number;
	/** The last label the plugin saw for a key, for a reading that is gone. */
	readonly labelOf?: (key: string) => string | undefined;
};

/** The series inputs of one pane at the frame time. */
export function paneSeriesInputs(config: StripConfigV1, encoders: StripEncoders, paneIndex: 0 | 1, sources: FrameSources, bucketPx: BucketPx = DEFAULT_BUCKET_PX, groupKeys?: readonly string[]): StripSeriesInput[] {
	const pane = config.panes[paneIndex];
	const window = paneWindowOf(config, paneIndex);
	const { status } = sources;
	// A Group or Ambient pane draws its rule's readings, not its series
	// list.
	const drawn = isRuleStyle(pane.style) ? (groupKeys ?? groupFrameOf(pane, status).keys).map((key) => ({ key, name: undefined })) : drawnSeries(pane);
	const readings = drawn.map((s) => (status.state === "unavailable" ? undefined : status.snapshot.byKey.get(s.key)));
	const names = drawn.map((s, i) => s.name ?? readings[i]?.label ?? sources.labelOf?.(s.key) ?? "");
	// A Tiles pane's history is asked at its tiles' time grid, which its
	// readings' labels lay out.
	const width = historyWidthFor(config, encoders, paneIndex, bucketPx, tileGridFor(pane, names));
	const at = alignedNow(sources.now, WINDOW_MS[window], width);
	return drawn.map((s, i) => {
		const reading = readings[i];
		const state: StripSeriesInput["state"] = status.state === "unavailable" ? "unavailable" : reading === undefined ? "missing" : status.state === "stale" ? "stale" : "ok";
		const history = width > 0 ? sources.history.view(s.key, window, width, at, reading?.linkedKeys) : undefined;
		// The budget refused this window: no line will draw, and the strip
		// says why instead of leaving an empty graph.
		const noRoom = history === undefined && sources.history.refused?.(s.key, window) === true;
		const value = reading?.value;
		return {
			key: s.key,
			name: names[i] as string,
			unit: reading?.unit ?? history?.unit ?? "",
			state,
			...(history === undefined ? {} : { history }),
			...(noRoom ? { noRoom: true as const } : {}),
			...(state === "ok" && typeof value === "number" && Number.isFinite(value) ? { current: value } : {})
		};
	});
}

/** A Group pane's readings in one snapshot, with `remembered` (the keys it
 * drew before) kept in place where HWiNFO no longer lists them. */
export function groupFrameOf(pane: StripPaneV1, status: PollerStatus, remembered: readonly string[] = []): GroupFrame {
	const snapshot = status.state === "unavailable" ? null : status.snapshot;
	const resolution = resolveGroup(snapshot, pane);
	if (snapshot === null) {
		// HWiNFO is away: the readings drawn before stay, each saying so.
		const keys = remembered.length > 0 ? remembered : resolution.keys;
		return { resolution: { ...resolution, keys, sameUnit: Math.max(resolution.sameUnit, keys.length) }, keys };
	}
	const keys = mergeRemembered(resolution.keys, remembered, (key) => snapshot.byKey.has(key), ruleDrawMax(pane));
	return { resolution, keys };
}

/** What a Group pane says about its readings, for the scene. */
function groupInfoOf(frame: GroupFrame, series: readonly StripSeriesInput[], highlightKey: string | null): GroupPaneInfo {
	const r = frame.resolution;
	return {
		status: r.status,
		title: r.title,
		unit: r.unit,
		sameUnit: Math.max(r.sameUnit, frame.keys.length),
		otherUnits: r.otherUnits,
		refused: series.filter((s) => s.noRoom === true).length,
		highlightKey: highlightKey !== null && series.some((s) => s.key === highlightKey) ? highlightKey : null
	};
}

/** The group's look, resolved once per frame: its own Background and
 * Words, else the shared dial ones (Default, shared-looks.ts), so a shared
 * change repaints every strip on Default with no write. */
export type StripLook = {
	readonly palette: Palette;
	readonly text: TextSettings;
	readonly background: DialBackground;
	readonly accent: boolean;
	/** The art looks' Sky (deck-art.ts), resolved like the Background. */
	readonly sky: ArtSky;
	/** Lifted on the surface the Background's words sit on (stripAlertColors). */
	readonly alertColors: { readonly warn: string; readonly crit: string };
};

export function stripLookOf(config: StripConfigV1 | undefined): StripLook {
	const themes = loadThemes();
	const palette = resolvePalette(themes, effectiveThemeFor({ theme: config?.theme }), null, "normal");
	const text = effectiveTextFor({ textMode: config?.textMode, textColor: config?.textColor, textDimSecondary: config?.textDimSecondary });
	const background = dialBackgroundFor(config?.background);
	return {
		palette,
		text,
		background,
		accent: dialAccentWordsFor(config?.accentWords),
		sky: stripSkyFor(config),
		alertColors: stripAlertColors(themes.alertValues, palette, background)
	};
}

/** An explained face for a member that cannot draw its slice, in the
 * group's look (or the deck default when there is no config). */
export function stripMessage(lines: readonly string[], config: StripConfigV1 | undefined): string {
	const look = stripLookOf(config);
	return withArtSky(stripMessageFace(lines, { background: look.background, palette: look.palette, text: look.text, accent: look.accent }), look.sky);
}

export type FrameParams = {
	/** The effective config (effectiveConfig of the authority and the view). */
	readonly config: StripConfigV1;
	readonly encoders: StripEncoders;
	readonly view: GroupView;
	readonly sources: FrameSources;
	/** Per encoder column: false where no member owns the slot. */
	readonly present?: readonly boolean[];
	/** Per encoder column: true where the slot's dial left the strip. */
	readonly left?: readonly boolean[];
	/** Replaces each pane's bottom-left line (a conflict). */
	readonly notice?: string;
	readonly generation?: number;
	/** The width the history is asked at (the group's held bucket width). */
	readonly historyBucketPx?: BucketPx;
	/** Per pane, a Group pane's readings for this frame (the controller's,
	 * with its remembered readings); resolved fresh when absent. */
	readonly groups?: readonly (GroupFrame | undefined)[];
	/** Strip Screens (a whole strip with two or more): the position line
	 * and, for a moment after a change, the screen's name and place. */
	readonly screens?: ScreenFrame;
};

/** What a frame draws about the screens: how many, the one on view, the
 * hidden ones holding a reading past a critical limit, and the name and
 * place the window words take for a moment after a change. */
export type ScreenFrame = {
	readonly count: number;
	readonly at: number;
	readonly alerts: readonly boolean[];
	readonly label?: ScreenLabel;
};

/** The scene input of one frame. */
export function frameInput(params: FrameParams): StripSceneInput {
	const { config, encoders, view, sources } = params;
	const look = stripLookOf(config);
	const measure = { fahrenheit: config.fahrenheit, decimals: config.decimals, dataUnits: getDataUnits() };
	const screens = config.layout === "whole" && params.screens !== undefined && params.screens.count >= 2 ? params.screens : undefined;
	const panes: StripPaneInput[] = activePanes(config).map((pane, i) => {
		const index = (i === 1 ? 1 : 0) as 0 | 1;
		const paneView = view.panes[index];
		const groupFrame = !isRuleStyle(pane.style) ? undefined : paneView.mode === "paused" && paneView.group !== undefined ? paneView.group : (params.groups?.[index] ?? groupFrameOf(pane, sources.status));
		const series = paneView.mode === "paused" ? paneView.series : paneSeriesInputs(config, encoders, index, sources, params.historyBucketPx, groupFrame?.keys);
		return {
			series,
			bands: stripBandsFor(pane, series, measure, config.readingFormats),
			view: paneView.mode === "paused" ? { mode: "paused", label: paneView.label, agoMs: paneView.agoMs } : { mode: "live" },
			highlight: view.highlight[index],
			...(groupFrame === undefined ? {} : { group: groupInfoOf(groupFrame, series, view.groupHighlight[index]) }),
			...(params.notice === undefined ? {} : { notice: params.notice }),
			...(screens?.label === undefined || index !== 0 ? {} : { screenLabel: screens.label })
		};
	});
	// The scene draws the config's look: the resolved one (the same object
	// when the strip keeps its own).
	const drawn = config.background === look.background && config.accentWords === look.accent && config.stars === look.sky.stars && config.skyColor === look.sky.tone ? config : { ...config, background: look.background, accentWords: look.accent, stars: look.sky.stars, skyColor: look.sky.tone };
	return {
		config: drawn,
		encoders,
		palette: look.palette,
		text: look.text,
		alertColors: look.alertColors,
		dataUnits: getDataUnits(),
		panes,
		...(params.present === undefined ? {} : { present: params.present }),
		...(params.left === undefined || !params.left.includes(true) ? {} : { left: params.left }),
		...(params.generation === undefined ? {} : { generation: params.generation }),
		...(screens === undefined ? {} : { screens: { count: screens.count, at: screens.at, alerts: screens.alerts } })
	};
}

/** The wall-clock label of a pause ("14:02:51"). */
export function pauseLabel(date: Date = new Date()): string {
	return date.toTimeString().slice(0, 8);
}
