/**
 * "Sensor Dial" encoder action (Stream Deck + / + XL) — live value on the
 * touchscreen with a range bar and session min/max.
 *
 * Gestures route through the control scheme (src/controls.ts). The default
 * (legacy) scheme is the exact 1.1.x behavior:
 *
 *   rotate      cycle through the rotation set / same sensor's readings
 *   push        reset the session min/max/avg (fires on dial DOWN)
 *   touch       cycle displayed stat (current → min → max → avg, session)
 *   long touch  back to the current value
 *
 * The elite and custom presets classify presses on release through the
 * gesture machine (src/gestures.ts), route pressed rotation separately
 * (jumping between named rotation groups once the settings define them,
 * else between sensor sources), and can enable touch zones. Session stats are keyed per reading
 * (src/stats.ts) and, together with the display/pause/pin state, survive
 * page and profile navigation through a bounded hidden-state cache. The
 * Stream Deck app owns horizontal touch-strip swipes (page navigation);
 * this class only preserves state across the willDisappear/willAppear it
 * causes.
 */
import { createHmac, randomBytes } from "node:crypto";

import streamDeck, { action, SingletonAction, type DialAction, type DialDownEvent, type DialRotateEvent, type DialUpEvent, type DidReceiveSettingsEvent, type PropertyInspectorDidDisappearEvent, type SendToPluginEvent, type TouchTapEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { alertStepGapMs, criticalKeysOf, NO_DIAL_ALERTS, stepDialAlerts, type DialAlertView } from "../alerts/dial";
import { aggregateShown, NORMAL_SHOWN } from "../alerts/engine";
import { instantAlert, ruleLimitsOnFace } from "../alerts/instant";
import { DEFAULT_COMMAND_SNOOZE_MS, parseAlertConfig, parseAlertSnoozeMs, readingRuleOf, ruleFor } from "../alerts/rules";
import { alertStore } from "../alerts/store";
import type { ShownAlert } from "../alerts/types";
import { monotonicNow } from "../clock";
import { isStripCommand, registerDialCommandHandler, type ControlCommandId, type DialControlCommand } from "../commands";
import { parseResetScope, resolveControls, schemeCanSwitchGroups, triggerDescriptions, type ControlScheme, type GestureCommandId, type ResetScope } from "../controls";
import { tickSignature } from "../detail/tick-signature";
import { deviceCapabilities, tapCanvasWidth } from "../devices";
import { registerDiagnostics } from "../diagnostics";
import { IDLE_GESTURE, routeGesture, type GestureState } from "../gestures";
import type { HistoryView, HistoryWindowId } from "../history/types";
import { parseHistoryWindow } from "../history/window";
import { t } from "../i18n";
import { measurementIdentityOf } from "../hwinfo/calculated";
import { readingMatchesKey } from "../hwinfo/reading-links";
import type { Reading, SensorSnapshot } from "../hwinfo/types";
import { buildThemesPayload, forgetPanelFace, handlePiRequest, pushPreviewToPi } from "../pi-protocol";
import { poller, type PollerStatus } from "../poller";
import { describeGestureState, hashId, trace, traceEnabled } from "../recorder";
import { activeGroupIndex, autoCycleTarget, groupDisplayName, overviewWindow, rotationGroupsOf, rotationReadings, stepGroup, stepReading, stepSensorSource } from "../rotation";
import { rowStatValue, SessionStatsStore, sessionResetMessage, type SessionStats } from "../stats";
import { StripController, type StripHost } from "../strip/controller";
import type { SettingsDoc } from "../strip/edits";
import { isStripRequest } from "../strip/pi";
import { artPlace, paintArt, withArtSky } from "../ui/deck-art";
import { dialPictureText, dialTextColors, dialTextPalette, lookOn } from "../ui/dial-background";
import { countOwnLooks, dialAccentWordsFor, dialBackgroundFor, dialSkyFor, NO_OWN_LOOKS, OWN_LOOK_FIELDS, ownLooksOf, registerLooksPort, sharedLooks, staleLooksReset, STRIP_LOOK_FIELDS, type OwnLooksCount } from "../ui/shared-looks";
import { dialStatsLineFits, footerFits, overviewStatsFit, renderDial, renderDialOverview, renderDialTwoRow, type OverviewRow } from "../ui/dial-renderer";
import { dialViewOf, overviewRowColors, rotationKeysOf, stepListOf } from "../ui/dial-overview";
import { alertTrackFill } from "../ui/alert-track";
import { convertUnit, dedupeSharedLabelPrefix, nextStatMode, parseThreshold, STAT_BADGE, thresholdsApplyTo, type DecimalsSetting, type StatMode } from "../ui/format";
import { computeGauge, drawnZones, ZONE_BG_BLEND } from "../ui/gauge";
import { nonEmptyKey } from "../ui/key-layout";
import { exactFallback, exactStatTexts, formatMeasurement, formatStat, isDataUnit, type MeasureOptions } from "../ui/measure";
import { measureFor } from "../ui/reading-format";
import { statusDialText } from "../ui/state-screens";
import { mixToward, resolveTextColors, type TextColors } from "../ui/text-colors";
import { decideLegacyDefault, effectiveTextFor, effectiveThemeFor, measureOptionsFrom, onThemeChange, typeAccentsEnabled } from "../ui/theme-store";
import { classifyTypeAccent, loadThemes, resolvePalette, type Palette, type ThemesConfig } from "../ui/themes";

/** Persisted per-dial settings (written by the PI; all optional). */
export type DialSettings = {
	readingKey?: string;
	label?: string;
	decimals?: DecimalsSetting;
	fahrenheit?: boolean;
	/** Manual range for the bar; session min/max is used when absent. */
	barMin?: string;
	barMax?: string;
	warnValue?: string;
	critValue?: string;
	alertBelow?: boolean;
	/** Per-dial theme override; empty/absent follows the deck default. */
	theme?: string;
	/**
	 * Per-dial Text setting (issue #2): "theme", "dim" or "custom"; anything
	 * else (absent, "", junk) follows the deck-wide Text default.
	 */
	textMode?: string;
	/** Custom text color (#RRGGBB); invalid values degrade to theme text. */
	textColor?: string;
	/** Custom mode: labels, units and stats at lower intensity. */
	textDimSecondary?: boolean;
	/** Multi-row normal numbers use sensor-type colors only on exact true. */
	sensorValueColors?: boolean;
	/** Optional numeric color overrides by stable reading key; multi-row only. */
	readingColors?: Record<string, string>;
	/** Rotation set: rotate/autocycle move only through these picked readings. */
	rotationKeys?: string[];
	/**
	 * Named rotation groups (optional): plain rotate stays inside the active
	 * group, a Switch gesture (Elite press+rotate) jumps between groups. The
	 * PI keeps rotationKeys mirrored to the union of all group keys so
	 * set-wide consumers (stats, reset reach) and older plugin versions after
	 * a rollback keep reading the flat set unchanged.
	 */
	rotationGroups?: { name?: string; keys?: string[] }[];
	/** Ignore dial turns entirely (protection against accidental bumps). */
	rotationDisabled?: boolean;
	/** Autocycle interval in ms as the PI select writes it; absent/"off" = off. */
	autoCycleMs?: string;
	/** Control preset: "legacy" (default, exact 1.1.x), "elite" or "custom". */
	controlPreset?: string;
	/** Touch zones for elite/custom: "off" (default), "two" or "three". */
	touchZones?: string;
	/** Custom preset gesture assignments (GestureCommandId strings). */
	gestureRotate?: string;
	gesturePressedRotate?: string;
	gestureShortPress?: string;
	gestureLongPress?: string;
	gestureTap?: string;
	gestureTouchHold?: string;
	/** Reset reach for the reset command: "current" (default), "set", "all". */
	resetScope?: string;
	/** "auto" (default): rotation clears the custom label; "fixed" keeps it. */
	labelMode?: string;
	/** Optional ID the HWiNFO Control action can target. */
	linkId?: string;
	/** Autocycle jumps to an alerting member instead of the next one. */
	alertInterrupt?: boolean;
	/**
	 * Unit the thresholds/bar range were configured against; stamped by the
	 * plugin (never the PI) so they cannot fire on an incompatible unit
	 * after rotating to a different kind of reading.
	 */
	alertUnit?: string;
	/**
	 * Separate limits per reading, keyed by a stable reading key (src/alerts/
	 * rules.ts parses them; the panel's "Separate limits for" box writes one
	 * entry with the unit on screen). An entry replaces Warn at, Critical at
	 * and the direction for its reading only; the legacy fields above keep
	 * their 1.7.1 meaning everywhere else and alertUnit never scopes an
	 * entry. Salvaged entry by entry, never written back.
	 */
	alertRules?: Record<string, { warn?: string; crit?: string; below?: boolean; unit?: string; hyst?: string }>;
	/** "Alert after": exactly "0", "2000", "5000", "10000" or "30000" ms a
	 * reading must stay past a limit before it shows; anything else is
	 * immediate, as 1.7.1. */
	alertDwellMs?: string;
	/** Recovery band for Warn at and Critical at, in their unit: a level
	 * holds until the value comes back past its limit by this much. Junk or
	 * a negative number is 0 (clears at the limit, as 1.7.1). */
	alertHysteresis?: string;
	/** The unit Warn at and Critical at were typed in: the panel stamps it
	 * in the same write as an edit of either (or of the recovery band), and
	 * rules.ts converts the pair across °C and °F instead of reinterpreting
	 * it. Absent (1.7.1 and earlier) compares in the unit on the face. */
	alertDisplayUnit?: string;
	/** The exact Warn at, Critical at and Clear after text the stamp was
	 * saved with; the stamp counts only while they still match
	 * (rules.ts stampedDisplayUnit). */
	alertDisplayUnitFor?: JsonValue;
	/** How long the Snooze alerts gesture and the Control key's snooze last:
	 * exactly "300000", "900000" or "3600000" ms; anything else is 15 minutes
	 * (DEFAULT_COMMAND_SNOOZE_MS). Snoozes live in memory only. */
	alertSnoozeMs?: string;
	/**
	 * "overview" lists up to three rotation-list rows at once, "tworow" two
	 * bigger ones with sparklines (the selected row marked, the window
	 * following rotation in both); anything else renders the unchanged
	 * single view, so settings from a newer version degrade safely after a
	 * rollback and old profiles are never migrated or rewritten.
	 */
	dialView?: string;
	/**
	 * Per-reading display names, keyed by the stable reading identity
	 * (renamed by clicking a rotation-set chip's name in the PI). Shown as
	 * the overview row label and as the dial title while that reading is
	 * selected; the per-dial `label` field still overrides while set.
	 */
	rotationNames?: Record<string, string>;
	/**
	 * Overview row labels: anything but the exact "full" shortens shared
	 * label prefixes and shows them once in the context line (the default);
	 * "full" keeps every row label exactly as named.
	 */
	overviewLabels?: string;
	/**
	 * Three-row overview context line position: the exact "bottom" moves it
	 * under the rows (above a thin rule); anything else is the top default,
	 * so rolled-back or hand-edited settings degrade safely.
	 */
	overviewHeader?: string;
	/**
	 * Three-row overview separators: the exact "off" hides the thin lines
	 * between rows (and the bottom-mode rule); anything else keeps them.
	 */
	overviewSeparators?: string;
	/**
	 * What the dial draws behind its readout (issue #41): the exact "glass",
	 * "tint", "outline" or "clear" lets the touch strip picture set in the Stream
	 * Deck app show behind the dial, and "theme" draws the theme background;
	 * anything else (absent, "", junk, a newer version's value) follows the
	 * shared default (globals.dialBackground), Theme when none is stored, so
	 * a rollback or a hand edit degrades to today's face byte for byte. Read
	 * only through dialBackgroundFor.
	 */
	dialBackground?: string;
	/**
	 * Words in the accent color: on Glass, Tint and Outline the exact true
	 * draws titles and the selected row's name in the dial's accent, and
	 * units, stats and other row names tinted toward it (accentWords);
	 * false keeps today's words; anything else follows the shared default
	 * (globals.dialAccentWords), off when none is stored. Every other look
	 * keeps today's words byte for byte. Read only through dialAccentWordsFor.
	 */
	dialAccentWords?: boolean;
	/** The art looks' Stars and Sky color (src/ui/deck-art.ts ART_STARS,
	 * ART_TONES): each one exact name; anything else follows the shared
	 * default (globals.dialStars, globals.dialSkyColor). Read only through
	 * dialSkyFor. */
	dialStars?: string;
	dialSkyColor?: string;
	/** The looks generation (globals.looksResetGen) dialBackground or
	 * dialAccentWords was chosen at; absent is 0. An own choice older than
	 * the shared generation is dropped when the dial appears
	 * (src/ui/shared-looks.ts, "Use it everywhere"). */
	looksGen?: number;
	/**
	 * Trend window for the two-row view's row trends: exactly "1m", "5m" or
	 * "15m" draws that span of real time per visible row. Anything else, the
	 * panel's "" default included, keeps the recent-samples line byte for
	 * byte; the single and three-row views ignore it. Read only through
	 * dialHistoryWindowOf; written only by the panel.
	 */
	dialHistoryWindow?: string;
	/**
	 * Per-reading formats (issue #59, src/ui/reading-format.ts), keyed by
	 * reading, never by rotation step: each reading the dial shows keeps its
	 * own fixed unit and decimals on every view, its rows and its stats
	 * included. Absent keeps Decimals and the deck's Data units exactly as
	 * before. Written only by the panel; display only.
	 */
	readingFormats?: JsonValue;
};

export type InstanceState = {
	settings: DialSettings;
	/** Session stats per reading identity; survives rotation and hiding. */
	stats: SessionStatsStore;
	/** Ephemeral display mode; reset to "current" on long touch. */
	statMode: StatMode;
	lastFeedback: string;
	/** Next autocycle due time (monotonicNow, so a wall-clock correction never
	 * moves it, AX43); null re-arms on the next tick. */
	nextCycleAt: number | null;
	cyclePaused: boolean;
	/** Pinned: selection cannot change (turns, taps, autocycle) until unpinned. */
	pinned: boolean;
	gesture: GestureState;
	/** The held press was kept through a replayed appear (AX68). Its release
	 * may have been lost in the replay, so a turn the app reports as not
	 * pressed ends it instead of routing as a pressed turn. */
	replayedPress?: boolean;
	/** Transient on-device hint ("cycle paused"); cleared at `until`. */
	overlay: { text: string; until: number } | null;
	overlayTimer: NodeJS.Timeout | null;
	deviceId: string;
	/** A threshold edit is waiting for a resolvable reading to stamp its unit. */
	pendingAlertUnitStamp: boolean;
	/** The reading on screen when that edit landed: the stamp takes its
	 * unit even if the selection moves before data returns (AX28). */
	pendingAlertUnitKey?: string;
	/** A stale or unavailable tick ended this dial's sessions; the first live
	 * frame afterwards says so once, so a collapsed min/max is explained. */
	gapReset?: boolean;
	/** What each referenced reading's alert shows (after dwell, recovery and
	 * snooze), by the key the dial uses for it, from the last step of the
	 * shared alert store. Absent until the first step; faces composed
	 * without it (samples, tests) read the rules from the live value. */
	alertShown?: DialAlertView;
	/** Monotonic time of the last alert step, so time in which nothing was
	 * observed (away while the poller idled) never counts toward a wait. */
	alertSteppedAt?: number;
	/** The dial is a joined member of a Strip Display: the strip owns its
	 * face, input and Control commands, and its individual face, stats,
	 * autocycle and writes are suspended until it leaves. Kept with the
	 * parked state, so a return as an independent dial resets its sessions. */
	stripJoined?: boolean;
};

/** How long a hidden dial's state (stats, pause, pin) is kept for its return. */
const HIDDEN_STATE_TTL_MS = 30 * 60_000;
const HIDDEN_STATE_CAP = 64;
/** On-device hint duration. */
const OVERLAY_MS = 1600;

/** What the release of a held press acts on: the gesture map, the reset
 * reach and the reading or rotation it targets. Equal for an unchanged
 * settings echo. */
export function pressContextOf(settings: DialSettings): string {
	return JSON.stringify([resolveControls(settings), parseResetScope(settings.resetScope), settings.readingKey ?? null, rotationKeysOf(settings) ?? null, rotationGroupsOf(settings.rotationGroups) ?? null]);
}

@action({ UUID: "com.lawrensen.hwinfo.dial" })
export class SensorDialAction extends SingletonAction<DialSettings> {
	private readonly instances = new Map<string, InstanceState>();
	/** State of dials that navigated off-screen, kept for their reappearance. */
	private readonly hidden = new Map<string, { at: number; state: InstanceState }>();
	/**
	 * Strip Display (src/strip/controller.ts). Every handler asks
	 * strip.claims(context) first and hands a joined member's events to it;
	 * an independent dial never reaches the strip beyond being counted on
	 * its deck, so its face, writes and commands stay exactly as before.
	 */
	private stripController: StripController | undefined;
	/** Created on first use, so a dial built without its constructor (the
	 * unit suites' seams) still has one. */
	private get strip(): StripController {
		this.stripController ??= new StripController(this.stripHost());
		return this.stripController;
	}

	/** What the strip needs from this action: the dials' documents, the
	 * claim hand-over, the poller and the open panel. */
	private stripHost(): StripHost {
		return {
			settingsOf: (context) => this.instances.get(context)?.settings as SettingsDoc | undefined,
			stored: (context, settings) => {
				const state = this.instances.get(context);
				if (state !== undefined) state.settings = settings as DialSettings;
			},
			claimChanged: (context, claimed) => this.stripClaimChanged(context, claimed),
			status: () => poller.getStatus(),
			history: poller.history,
			panelContext: () => (streamDeck.ui.action?.manifestId === this.manifestId ? streamDeck.ui.action?.id : undefined),
			sendToPanel: (payload) => {
				if (streamDeck.ui.action?.manifestId === this.manifestId) void streamDeck.ui.sendToPropertyInspector(payload);
			},
			log: (message) => streamDeck.logger.warn(message)
		};
	}

	constructor() {
		super();
		// Isolated so a rendering bug in one action class can't starve the other
		// listeners on the shared "tick" event.
		poller.onTick((status) => {
			try {
				this.onPollerTick(status);
			} catch (err) {
				streamDeck.logger.error("SensorDialAction tick failed", err);
			}
		});
		// The strip's own listener, isolated from the independent dials' one.
		poller.onTick((status) => {
			try {
				this.strip.onTick(status);
			} catch (err) {
				streamDeck.logger.error("Strip tick failed", err);
			}
		});
		onThemeChange(() => {
			this.strip.restyle();
			this.renderAll(poller.getStatus());
			// Keep the open PI's "Deck default" chip and live preview truthful
			// in real time (theme, Text and Data units are all deck-wide).
			if (streamDeck.ui.action?.manifestId === this.manifestId) {
				void streamDeck.ui.sendToPropertyInspector(buildThemesPayload());
				this.pushPanelPreview(poller.getStatus());
			}
		});
		registerDialCommandHandler((command) => this.applyControlCommand(command));
		// Advanced, Shared defaults: the count line and "Use it everywhere".
		registerLooksPort({ count: () => this.ownLooksCount(), sweep: (gen) => this.sweepLooks(gen, undefined, true) });
		registerDiagnostics("sensorDial", () => this.diagnostics());
		// Counts only, like the dial table: no ids, keys, labels or values.
		registerDiagnostics("strip", () => this.strip.diagnostics());
	}

	/** Each deck this process has heard about: "up" after a connect, "away"
	 * after a disconnect. Created on first use, like the strip, for the unit
	 * suites' seams. */
	private decksStore: Map<string, "up" | "away"> | undefined;
	private get decks(): Map<string, "up" | "away"> {
		this.decksStore ??= new Map();
		return this.decksStore;
	}

	/** deviceDidDisconnect: the strip members on that deck are gone (a
	 * willDisappear may never come for them). */
	deviceDisconnected(deviceId: string): void {
		this.decks.set(deviceId, "away");
		this.strip.deviceGone(deviceId);
		// A press held across the disconnect never gets its release.
		for (const act of this.actions) {
			if (act.device.id !== deviceId) continue;
			const state = this.instances.get(act.id);
			if (state === undefined) continue;
			state.gesture = IDLE_GESTURE;
			state.replayedPress = false;
		}
	}

	/** deviceDidConnect need not replay willAppear. The SDK keeps visible
	 * actions until willDisappear, so restore only those still on this deck,
	 * as onWillAppear hands them over: a strip's dial rejoins, a dial whose
	 * copy no longer joins it takes its face back, and an independent dial
	 * repaints, because the app's touchscreen cache can come back cold.
	 * Not on a deck's first connect in this process: at every start the app
	 * sends a deck's willAppear events before its first deviceDidConnect,
	 * and those appearances already did all of this. Any later connect
	 * restores, with or without a disconnect seen before it. */
	deviceConnected(deviceId: string): void {
		const before = this.decks.get(deviceId);
		this.decks.set(deviceId, "up");
		if (before === undefined) return;
		let restored = 0;
		for (const act of this.actions) {
			if (act.device.id !== deviceId || !act.isDial()) continue;
			const state = this.instances.get(act.id);
			if (state === undefined) continue;
			try {
				this.strip.appear(act, state.settings);
				restored++;
				if (this.strip.claims(act.id)) continue;
				if (state.stripJoined === true) {
					this.leftStrip(state);
					this.pushTriggerDescriptions(act, state.settings);
				}
				state.lastFeedback = "";
				this.renderAll(poller.getStatus(), act.id);
			} catch (err) {
				streamDeck.logger.error("A dial could not be restored after its deck reconnected", err);
			}
		}
		if (restored > 0) streamDeck.logger.info(`Restored ${restored} dials after their deck reconnected`);
	}

	override onWillAppear(ev: WillAppearEvent<DialSettings>): void {
		streamDeck.logger.debug(`Dial appeared on ${JSON.stringify(ev.action.device.name)}${ev.action.isDial() ? ` at ${ev.action.coordinates.column},${ev.action.coordinates.row}` : ""} (${ev.action.id})`);
		this.traceLifecycle("willAppear", ev.action.id, ev.action.device.id);
		// Stream Deck can replay willAppear for a context without an intervening
		// willDisappear (reconnect, wake): retain only on the first sighting.
		// Page/profile navigation DOES send willDisappear; that state waits in
		// the hidden cache and is restored here, so stats, pause and pin state
		// survive page swipes and folder hops.
		const replayed = this.instances.get(ev.action.id);
		// The TTL is enforced here too, not only by the tick sweep: with the
		// poller idle (nothing visible) the sweep never runs, and a return
		// hours later must not resurrect stale pause/pin/stats state.
		const hiddenEntry = this.hidden.get(ev.action.id);
		const restored = replayed ?? (hiddenEntry !== undefined && monotonicNow() - hiddenEntry.at <= HIDDEN_STATE_TTL_MS ? hiddenEntry.state : undefined);
		this.hidden.delete(ev.action.id);
		// Alert state follows the same 30 minute window: kept across a page
		// or profile flip, dropped past it (alert snoozes included).
		alertStore.appear(ev.action.id, monotonicNow());
		if (replayed === undefined) {
			poller.retain();
		}
		decideLegacyDefault(Object.values(ev.payload.settings).some((v) => v !== undefined));
		if (restored !== undefined && restored.overlayTimer !== null) {
			clearTimeout(restored.overlayTimer);
		}
		const keepsPress = replayed !== undefined && replayed.gesture.downAt !== null;
		const state: InstanceState = {
			settings: ev.payload.settings,
			stats: restored?.stats ?? new SessionStatsStore(),
			statMode: restored !== undefined && restored.settings.readingKey === ev.payload.settings.readingKey ? restored.statMode : "current",
			// Empty on purpose, even when state is restored: a replayed appear
			// can come with the app's touchscreen cache cold, and remembering
			// the last payload would skip the repaint that fills it.
			lastFeedback: "",
			nextCycleAt: null,
			cyclePaused: restored?.cyclePaused ?? false,
			pinned: restored?.pinned ?? false,
			// A replayed appear consumes a held press through its release,
			// repeated downs included (external review AX68); a dial that
			// disappeared dropped its press on the way out.
			gesture: keepsPress ? { downAt: replayed.gesture.downAt, rotatedWhileDown: true } : IDLE_GESTURE,
			replayedPress: keepsPress,
			overlay: null,
			overlayTimer: null,
			deviceId: ev.action.device.id,
			pendingAlertUnitStamp: restored?.pendingAlertUnitStamp ?? false,
			pendingAlertUnitKey: restored?.pendingAlertUnitKey,
			// A gap that ended this dial's sessions while it was hidden, or
			// before a replayed appear, is still owed its one explanation.
			gapReset: restored?.gapReset ?? false,
			// Stepped again by the first render below, under these settings,
			// after a gap when it has been away longer than a few polls.
			alertShown: restored?.alertShown,
			alertSteppedAt: restored?.alertSteppedAt,
			stripJoined: restored?.stripJoined === true
		};
		this.instances.set(ev.action.id, state);
		if (ev.action.isDial()) {
			// Every visible Sensor Dial is counted on its deck (the strip's
			// slot map). A joined member is the strip's from here on: no
			// individual hints, stats or face. Appearing writes only to drop
			// an own Background or Words chosen before the last "Use it
			// everywhere" (one write; its strip's in one edit).
			this.strip.appear(ev.action, ev.payload.settings);
			const looksGen = sharedLooks().resetGen;
			if (looksGen > 0) this.sweepLooks(looksGen, [ev.action.id], false);
			if (this.strip.claims(ev.action.id)) {
				return;
			}
			// It left its strip while it was away (or its copy changed):
			// its sessions were not observed meanwhile.
			if (state.stripJoined === true) this.leftStrip(state);
			this.pushTriggerDescriptions(ev.action, ev.payload.settings);
		}
		// retain() may synchronously read a different source or native unit
		// before this instance is restored. Validate its session against that
		// observation before drawing the first frame, just as each tick does.
		const status = poller.getStatus();
		if (status.state === "ok") {
			this.sampleStats(state, status.snapshot, status.source);
		} else {
			if (state.stats.size > 0) state.gapReset = true;
			state.stats.reset();
		}
		this.renderAll(status, ev.action.id);
	}

	override onWillDisappear(ev: WillDisappearEvent<DialSettings>): void {
		this.traceLifecycle("willDisappear", ev.action.id, ev.action.device.id);
		// A disappear for an earlier placement (another column) is ignored
		// by the strip; its view and copy stay with the group.
		this.strip.disappear(ev.action.id, columnOf(ev.payload));
		const state = this.instances.get(ev.action.id);
		if (state === undefined || !this.instances.delete(ev.action.id)) {
			return;
		}
		poller.release();
		// The rows' rings stay tracked in the poller: history keeps
		// collecting off-screen while the poller stays alive, so the two-row
		// view resumes its lines on return. Trend window series linger the
		// same way (16 minutes) once the rows' interest is dropped.
		poller.history.dropInterest(rowsConsumerId(ev.action.id));
		// A press cannot span a disappearance; drop any half-tracked gesture
		// and its overlay timer, then park the state for the action's return.
		state.gesture = routeGesture(state.gesture, { kind: "detach" }, "off").state;
		if (state.overlayTimer !== null) {
			clearTimeout(state.overlayTimer);
			state.overlayTimer = null;
		}
		state.overlay = null;
		state.lastFeedback = ""; // the strip may be repainted by others meanwhile
		const now = monotonicNow();
		this.hidden.set(ev.action.id, { at: now, state });
		// Its alerts keep stepping while hidden (onPollerTick), for the same
		// 30 minute window as its stats, pause and pin.
		alertStore.hide(ev.action.id, now);
		if (this.hidden.size > HIDDEN_STATE_CAP) {
			const oldest = this.hidden.keys().next().value;
			if (oldest !== undefined) {
				this.hidden.delete(oldest);
				alertStore.forget(oldest);
			}
		}
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<DialSettings>): void {
		this.settingsArrived(ev.action, ev.payload.settings);
	}

	/** The visible independent dials and strips that keep their own
	 * Background or Words (a joined member's own is not drawn). */
	private ownLooksCount(): OwnLooksCount {
		let count = NO_OWN_LOOKS;
		for (const [context, state] of this.instances) {
			if (!this.strip.claims(context)) count = countOwnLooks(count, "dials", ownLooksOf(state.settings, OWN_LOOK_FIELDS.dial));
		}
		for (const config of this.strip.liveConfigs()) count = countOwnLooks(count, "strips", ownLooksOf(config, STRIP_LOOK_FIELDS));
		return count;
	}

	/**
	 * "Use it everywhere" over the visible dials in `scope` (all when
	 * absent): own Background and Words chosen before generation `gen` go,
	 * one write per dial through the strip's single writer, a strip's in
	 * one edit (StripController.resetLooks). `render` repaints the
	 * independent dials written (an appear paints its own first frame).
	 */
	private sweepLooks(gen: number, scope: readonly string[] | undefined, render: boolean): void {
		const written = this.strip.resetLooks(gen, scope, (settings) => staleLooksReset(settings, "dial", gen));
		if (!render || written.length === 0) return;
		const status = poller.getStatus();
		for (const context of written) if (!this.strip.claims(context)) this.renderAll(status, context);
		this.pushPanelPreview(status);
	}

	private settingsArrived(action: DidReceiveSettingsEvent<DialSettings>["action"], settings: DialSettings): void {
		const state = this.instances.get(action.id);
		if (state === undefined) {
			return;
		}
		const previous = state.settings;
		// A held press keeps the command it started with. A settings change
		// that would give its release a different command, target or reset
		// reach consumes the press, and the next press uses the new settings
		// (external review AX26: Pause/resume became "reset all dials"). An
		// unchanged echo leaves the press alone.
		if (state.gesture.downAt !== null && pressContextOf(previous) !== pressContextOf(settings)) {
			state.gesture = { downAt: state.gesture.downAt, rotatedWhileDown: true };
		}
		if (previous.readingKey !== settings.readingKey) {
			state.statMode = "current";
		}
		state.settings = settings;
		// The strip classifies the document (an echo, a stale whole-document
		// write that rolled back this dial's strip copy, or a pasted copy). A
		// stale one is answered by writing the group's copy back into it
		// (stored() replaces state.settings); nothing is adopted silently.
		if (action.isDial()) this.strip.settingsChanged(action.id, settings);
		const joined = this.strip.claims(action.id);
		state.nextCycleAt = null; // the interval may have changed: re-arm on the next tick
		// Thresholds edited in the PI are meant for the reading on screen NOW:
		// clear the old unit anchor, PERSIST the clear (a stale stamp must not
		// resurrect from a later whole-settings write), then stamp the new unit
		// as soon as the reading is resolvable (immediately, or a later tick).
		const thresholdsChanged =
			previous.warnValue !== state.settings.warnValue || previous.critValue !== state.settings.critValue || previous.barMin !== state.settings.barMin || previous.barMax !== state.settings.barMax;
		if (thresholdsChanged && action.isDial()) {
			state.settings = { ...state.settings, alertUnit: undefined };
			state.pendingAlertUnitStamp = [state.settings.warnValue, state.settings.critValue, state.settings.barMin, state.settings.barMax].some((v) => parseThreshold(v) !== undefined);
			// Only a reading actually on screen anchors the stamp: one the
			// dial showed as missing leaves it to the next reading chosen.
			const onScreen = nonEmptyKey(state.settings.readingKey);
			const seen = poller.getStatus();
			state.pendingAlertUnitKey = onScreen !== undefined && (seen.state === "unavailable" || seen.snapshot.byKey.has(onScreen)) ? onScreen : undefined;
			void action.setSettings(state.settings);
			// A joined member stamps once it is an independent dial again.
			if (!joined) this.stampAlertUnit(action, state);
		}
		if (joined) {
			this.pushPanelPreview(poller.getStatus());
			return;
		}
		if (action.isDial()) {
			this.pushTriggerDescriptions(action, state.settings);
		}
		this.renderAll(poller.getStatus(), action.id);
		// The panel sees an edit's result at once, not on the next tick.
		this.pushPanelPreview(poller.getStatus());
	}

	/** Rotate: routed by the scheme (legacy: step, whether pressed or not). */
	override async onDialRotate(ev: DialRotateEvent<DialSettings>): Promise<void> {
		const state = this.instances.get(ev.action.id);
		if (state === undefined) {
			return;
		}
		if (this.strip.claims(ev.action.id)) {
			this.strip.input(ev.action.id, { kind: "dialRotate", column: ev.payload.coordinates.column, at: performance.now(), ticks: ev.payload.ticks, pressed: ev.payload.pressed });
			return;
		}
		if (state.replayedPress === true && !ev.payload.pressed) {
			state.gesture = IDLE_GESTURE;
			state.replayedPress = false;
		}
		const scheme = resolveControls(state.settings);
		const routed = routeGesture(state.gesture, { kind: "dialRotate", at: performance.now(), ticks: ev.payload.ticks, pressed: ev.payload.pressed }, scheme.touchZones);
		this.traceGesture("dialRotate", ev.action.id, state, routed.state, { ticks: ev.payload.ticks, pressed: ev.payload.pressed });
		state.gesture = routed.state;
		if (routed.gesture === null) {
			return;
		}
		// "Ignore turns" and pin make turn gestures true no-ops (autocycle,
		// touch and the control action are deliberate and stay live).
		if (state.settings.rotationDisabled === true || state.pinned) {
			return;
		}
		if (routed.gesture.kind === "rotate") {
			await this.executeCommand(ev.action, state, scheme.rotate, routed.gesture.ticks);
		} else if (routed.gesture.kind === "pressedRotate") {
			await this.executeCommand(ev.action, state, scheme.pressedRotate, routed.gesture.ticks);
		}
	}

	/** Push down: legacy fires its command here, untimed (exact 1.1.x). */
	override async onDialDown(ev: DialDownEvent<DialSettings>): Promise<void> {
		const state = this.instances.get(ev.action.id);
		if (state === undefined) {
			return;
		}
		if (this.strip.claims(ev.action.id)) {
			this.strip.input(ev.action.id, { kind: "dialDown", column: ev.payload.coordinates.column, at: performance.now() });
			return;
		}
		const scheme = resolveControls(state.settings);
		const firstDown = state.gesture.downAt === null;
		const routed = routeGesture(state.gesture, { kind: "dialDown", at: performance.now() }, scheme.touchZones);
		this.traceGesture("dialDown", ev.action.id, state, routed.state, {});
		state.gesture = routed.state;
		// The router retains a replayed down as the same press. Legacy's
		// immediate command must also run only once, or it erases new stats.
		if (scheme.pushTiming === "down" && firstDown) {
			// Mark the press consumed so a preset switch mid-press can never
			// fire a second command on release.
			state.gesture = { downAt: state.gesture.downAt, rotatedWhileDown: true };
			await this.executeCommand(ev.action, state, scheme.shortPress, 0);
		}
	}

	/** Release: short/long press classification (never after pressed rotation). */
	override async onDialUp(ev: DialUpEvent<DialSettings>): Promise<void> {
		const state = this.instances.get(ev.action.id);
		if (state === undefined) {
			return;
		}
		if (this.strip.claims(ev.action.id)) {
			this.strip.input(ev.action.id, { kind: "dialUp", column: ev.payload.coordinates.column, at: performance.now() });
			return;
		}
		const scheme = resolveControls(state.settings);
		const routed = routeGesture(state.gesture, { kind: "dialUp", at: performance.now() }, scheme.touchZones);
		this.traceGesture("dialUp", ev.action.id, state, routed.state, {});
		state.gesture = routed.state;
		state.replayedPress = false;
		if (routed.gesture === null || scheme.pushTiming !== "release") {
			return;
		}
		await this.executeCommand(ev.action, state, routed.gesture.kind === "longPress" ? scheme.longPress : scheme.shortPress, 0);
	}

	/** Touch: tap (optionally zoned) and hold, mutually exclusive. */
	override async onTouchTap(ev: TouchTapEvent<DialSettings>): Promise<void> {
		const state = this.instances.get(ev.action.id);
		if (state === undefined) {
			return;
		}
		if (this.strip.claims(ev.action.id)) {
			this.strip.input(ev.action.id, { kind: "touchTap", column: ev.payload.coordinates.column, at: performance.now(), hold: ev.payload.hold, tapPos: ev.payload.tapPos });
			return;
		}
		const scheme = resolveControls(state.settings);
		const canvasWidth = tapCanvasWidth(deviceCapabilities.get(ev.action.device.id));
		const routed = routeGesture(state.gesture, { kind: "touchTap", at: performance.now(), hold: ev.payload.hold, x: ev.payload.tapPos[0], canvasWidth }, scheme.touchZones);
		this.traceGesture("touchTap", ev.action.id, state, routed.state, { hold: ev.payload.hold, tapX: ev.payload.tapPos[0], tapY: ev.payload.tapPos[1] });
		state.gesture = routed.state;
		if (routed.gesture === null) {
			return;
		}
		if (routed.gesture.kind === "touchHold") {
			await this.executeCommand(ev.action, state, scheme.touchHold, 0);
			return;
		}
		if (routed.gesture.kind !== "tap") {
			return;
		}
		if (scheme.touchZones !== "off" && routed.gesture.zone === "left") {
			await this.executeCommand(ev.action, state, "step", -1); // advance() itself honors pin
		} else if (scheme.touchZones !== "off" && routed.gesture.zone === "right") {
			await this.executeCommand(ev.action, state, "step", 1);
		} else {
			await this.executeCommand(ev.action, state, scheme.tap, 0);
		}
	}

	override onSendToPlugin(ev: SendToPluginEvent<JsonValue, DialSettings>): void {
		const payload = ev.payload;
		if (isStripRequest(payload)) {
			// The plugin is the only writer of stripGroup: the panel asks,
			// the strip validates, writes and answers.
			this.strip.handlePi(ev.action.id, payload);
			return;
		}
		if (typeof payload === "object" && payload !== null && !Array.isArray(payload) && payload.event === "getPreview") {
			// A freshly loaded panel asks once: resend the face even when it
			// has not changed since the previous panel on this context.
			forgetPanelFace();
			this.pushPanelPreview(poller.getStatus());
			return;
		}
		handlePiRequest(payload);
	}

	override onPropertyInspectorDidAppear(): void {
		forgetPanelFace();
		this.strip.forgetPanel();
	}

	override onPropertyInspectorDidDisappear(ev: PropertyInspectorDidDisappearEvent<DialSettings>): void {
		// A draft preview lives only while its panel is open.
		this.strip.panelClosed(ev.action.id);
	}

	/** The open panel's preview, carrying the frame this action last sent
	 * to the device (never a separate render). No-op with no panel open. */
	private pushPanelPreview(status: PollerStatus): void {
		// A joined member's face is its strip slice, and its preview names
		// its strip role; a dial with no strip copy gets neither.
		pushPreviewToPi(
			status,
			this.manifestId,
			this.instances,
			false,
			(id) => this.strip.faceOf(id) ?? this.instances.get(id)?.lastFeedback,
			(id) => {
				const strip = this.strip.previewOf(id);
				const state = this.instances.get(id);
				// The overflow note measures what the face draws after a tap.
				const dialStats = state === undefined ? undefined : { mode: state.statMode, stats: (key: string) => state.stats.get(key) };
				return { ...(strip === undefined ? {} : { strip }), ...(dialStats === undefined ? {} : { dialStats }) };
			}
		);
	}

	/** One gesture (or control command) becomes exactly one of these. */
	private async executeCommand(action: DialAction<DialSettings>, state: InstanceState, command: GestureCommandId, ticks: number): Promise<void> {
		switch (command) {
			case "none":
				return;
			case "step":
				await this.advance(action, state, ticks === 0 ? 1 : ticks, "reading");
				return;
			case "stepGroup":
				await this.advance(action, state, ticks === 0 ? 1 : ticks, "group");
				return;
			default:
				this.executeStateCommand(action.id, state, { command: GESTURE_STATE_COMMANDS[command], target: "", scope: parseResetScope(state.settings.resetScope) });
		}
		this.renderAll(poller.getStatus());
	}

	private setPaused(state: InstanceState, paused: boolean): void {
		state.cyclePaused = paused;
		state.nextCycleAt = null;
		this.showOverlay(state, paused ? "cycle paused" : "cycle resumed");
	}

	private setPinned(state: InstanceState, pinned: boolean): void {
		state.pinned = pinned;
		state.nextCycleAt = null;
		this.showOverlay(state, pinned ? "pinned" : "unpinned");
	}

	/**
	 * Snoozes every alert this dial shows now, each at its current level,
	 * for the dial's snooze length. A higher level still breaks through
	 * (after its dwell), recovery ends the snooze, and the end time takes
	 * effect on the next valid reading. Nothing is written to settings.
	 */
	private snoozeAlerts(contextId: string, state: InstanceState): void {
		const ms = parseAlertSnoozeMs(state.settings.alertSnoozeMs) ?? DEFAULT_COMMAND_SNOOZE_MS;
		const snoozed = alertStore.snoozeContext(contextId, monotonicNow(), ms);
		this.refreshVisibleAlerts(contextId, state);
		this.showOverlay(state, snoozed > 0 ? `alerts snoozed ${Math.round(ms / 60_000)} min` : "no alert to snooze");
	}

	/** Ends this dial's alert snoozes at once. */
	private unsnoozeAlerts(contextId: string, state: InstanceState): void {
		const had = [...(state.alertShown ?? NO_DIAL_ALERTS).values()].some((alert) => alert.snoozed !== null);
		alertStore.unsnoozeContext(contextId);
		this.refreshVisibleAlerts(contextId, state);
		this.showOverlay(state, had ? "alert snooze ended" : "no snooze to end");
	}

	/**
	 * One step of this dial's alerts in the shared store (see
	 * src/alerts/dial.ts), kept on the instance for the face and the auto
	 * cycle. While the poller rides out a source reopen on its last values,
	 * nothing new is observed: the store is left alone and the face keeps
	 * what it showed.
	 */
	private refreshAlerts(contextId: string, state: InstanceState, status: PollerStatus, now: number = monotonicNow()): void {
		if (status.state === "ok" && poller.isHolding()) return;
		// Time in which nothing was observed is not time past a limit: away
		// while the poller idled (no action on screen) or through a sleep,
		// a level still waiting for its Alert after starts the wait again.
		if (state.alertSteppedAt !== undefined && now - state.alertSteppedAt > alertStepGapMs(poller.diagnostics().intervalMs)) alertStore.gap(contextId);
		state.alertShown = stepDialAlerts(alertStore, contextId, state.settings, status, now);
		state.alertSteppedAt = now;
	}

	/**
	 * After a snooze command: a dial on screen shows the result at once. A
	 * hidden dial is left to the next poller tick, which steps it with
	 * current data; while nothing is on screen the poller idles and its
	 * last status is old, and a step on it could end a snooze (or finish a
	 * wait) on data that is not current.
	 */
	private refreshVisibleAlerts(contextId: string, state: InstanceState): void {
		if (this.instances.get(contextId) === state) this.refreshAlerts(contextId, state, poller.getStatus());
	}

	/**
	 * Resets session stats. "current" and "set" stay inside this dial;
	 * "all" reaches every dial (visible and hidden) and is only ever
	 * reachable through the explicit resetScope setting or the control
	 * action, never a default gesture.
	 */
	private resetStats(state: InstanceState, scope: ResetScope): void {
		if (scope === "all") {
			for (const other of this.instances.values()) {
				other.stats.reset();
			}
			for (const entry of this.hidden.values()) {
				entry.state.stats.reset();
			}
			this.showOverlay(state, "all dials reset");
			return;
		}
		const key = nonEmptyKey(state.settings.readingKey);
		// A reset aims at measurements: a reading sampled under two confirmed
		// spellings (its saved key and its live row) resets under both.
		const status = poller.getStatus();
		const snapshot = status.state === "unavailable" ? undefined : status.snapshot;
		const resetKeys = (keys: readonly string[]): void => {
			state.stats.reset(keys);
			state.stats.resetIdentities(new Set(keys.map((k) => { const reading = snapshot?.byKey.get(k); return reading === undefined ? k : measurementIdentityOf(reading); })));
		};
		if (scope === "set") {
			resetKeys([...(rotationKeysOf(state.settings) ?? []), ...(key === undefined ? [] : [key])]);
			this.showOverlay(state, "set stats reset");
			return;
		}
		if (key !== undefined) {
			resetKeys([key]);
		}
		this.showOverlay(state, "stats reset");
	}

	/** Shared by rotate, taps, autocycle and the control action. */
	private async advance(action: DialAction<DialSettings>, state: InstanceState, ticks: number, granularity: "reading" | "group"): Promise<void> {
		const status = poller.getStatus();
		if (status.state === "unavailable" || state.pinned) {
			return;
		}
		const { snapshot } = status;
		const key = nonEmptyKey(state.settings.readingKey);
		// A saved reading the snapshot doesn't publish right now (HWiNFO
		// restart, sensor dropout) is a transient state: never let a turn
		// replace the saved selection with an unrelated reading.
		if (key !== undefined && !snapshot.byKey.has(key)) {
			return;
		}
		const groups = rotationGroupsOf(state.settings.rotationGroups);
		let next: Reading | undefined;
		if (granularity === "group") {
			if (groups !== undefined) {
				next = stepGroup(groups, key, ticks, snapshot);
			} else {
				// Without groups the jump moves between sensor sources, and with
				// no rotation set either it must roam the whole snapshot, or it
				// could never leave the sensor it is scoped to.
				const setKeys = rotationKeysOf(state.settings);
				next = stepSensorSource(setKeys === undefined ? snapshot.readings : rotationReadings(setKeys, key, snapshot), key, ticks);
			}
		} else {
			next = stepReading(stepListOf(state.settings, key, groups, snapshot), key, ticks);
		}
		// Landing on the measurement already selected (its other confirmed
		// spelling) is no move: never rewrite the saved key for nothing.
		if (next === undefined || readingMatchesKey(next, state.settings.readingKey)) {
			return;
		}
		// A group jump names its landing group; set before adopting so the
		// adopt's own render already paints the overlay.
		if (granularity === "group" && groups !== undefined) {
			const landed = activeGroupIndex(groups, next.key, snapshot);
			if (landed !== -1) {
				this.showOverlay(state, groupDisplayName(groups, landed));
			}
		}
		await this.adoptReading(action, state, next.key);
	}

	/** Moves the selection and persists it; per-reading stats stay intact. */
	private async adoptReading(action: DialAction<DialSettings>, state: InstanceState, nextKey: string): Promise<void> {
		const before = nonEmptyKey(state.settings.readingKey);
		// The custom label described the reading it was written for; in the
		// default "auto" label mode, moving to a different reading drops it
		// so the title always names what the value actually is. "fixed"
		// keeps the label as a deliberate constant title for the slot.
		const keepLabel = state.settings.labelMode === "fixed";
		state.settings = { ...state.settings, readingKey: nextKey, label: keepLabel ? state.settings.label : undefined };
		state.statMode = "current";
		state.nextCycleAt = null; // any move defers the next automatic step by a full interval
		trace({ event: "selection", context: action.id, selectionBefore: before === undefined ? undefined : hashSelection(before), selectionAfter: hashSelection(nextKey) });
		await action.setSettings(state.settings);
		// A source/unit transition can land while the host write is pending.
		// Never redraw the older observation captured when selection began.
		this.renderAll(poller.getStatus());
	}

	/** The right edge of every Trend window drawn since the data last
	 * changed. Dials repaint on a tick that brings new data, a changed alert
	 * or a change the tick made itself, and dedupe identical frames, so the
	 * window moves with new data only, never with the clock alone. */
	private frameNow: number | null = null;
	private frameSignature = "";
	/** The data and alert epoch the last tick composed faces for, and whether
	 * this tick changed a face input itself (a gap note, a unit stamp, an
	 * auto cycle move). */
	private drawnTick = "";
	private tickDirty = false;
	private readonly timelineOf: TimelineSource = (key, window, widthPx, linkedKeys) => poller.history.view(key, window, widthPx, this.frameNow ?? monotonicNow(), linkedKeys);

	private onPollerTick(status: PollerStatus): void {
		const frame = `${tickSignature(status)}:h${poller.history.revision}`;
		const fresh = frame !== this.frameSignature;
		if (fresh) {
			this.frameSignature = frame;
			this.frameNow = monotonicNow();
		}
		const now = monotonicNow();
		if (status.state === "ok") {
			// Stats accumulate for the selected reading and every rotation-set
			// member, visible or hidden, so rotating (back) to a member shows
			// its true session, and hidden members keep alert coverage. The
			// two-row view's sparkline subscriptions ride the same sweep.
			for (const [id, state] of this.instances) {
				// A strip member's individual sessions and alerts are
				// suspended: the strip draws its face. Its alerts take a gap
				// on its first step after it leaves (alertStepGapMs), as time
				// not observed for this dial.
				if (state.stripJoined === true) continue;
				if (state.gapReset === true) {
					// The status face hid the reset while the source was out;
					// name it on the first live frame so the collapsed
					// min/max is not read as a plugin fault.
					state.gapReset = false;
					this.showOverlay(state, sessionResetMessage("gap"));
					this.tickDirty = true;
				}
				// Visible dials are sampled once, by renderAll below (MS02).
				this.syncRowSeries(state, status.snapshot);
				// Alerts step once per tick, before the auto cycle reads
				// them; renderAll below draws this step.
				this.refreshAlerts(id, state, status, now);
			}
			// Completes a unit stamp whose threshold edit landed while the
			// reading was unresolvable; no-op otherwise.
			for (const act of this.actions) {
				if (act.isDial()) {
					const state = this.instances.get(act.id);
					if (state !== undefined && state.pendingAlertUnitStamp && state.stripJoined !== true) {
						this.stampAlertUnit(act, state);
					}
				}
			}
			for (const [id, entry] of this.hidden) {
				if (now - entry.at > HIDDEN_STATE_TTL_MS) {
					this.hidden.delete(id);
					alertStore.forget(id);
					continue;
				}
				if (entry.state.stripJoined === true) continue;
				this.sampleStats(entry.state, status.snapshot, status.source);
				// Hidden dials keep stepping with their last settings, so a
				// dwell, recovery or snooze carries on while they are away.
				this.refreshAlerts(id, entry.state, status, now);
			}
			this.autoCycle(status, now);
		} else {
			// A stale or unavailable source ends every session (a frozen or
			// absent producer is not evidence). Remember which dials lost a
			// session so the return to live data can say so. Alerts take a
			// gap: nothing shows, no dwell runs, and no snooze ends.
			for (const [id, state] of this.instances) {
				if (state.stats.size > 0) state.gapReset = true;
				state.stats.reset();
				if (state.stripJoined !== true) this.refreshAlerts(id, state, status, now);
			}
			for (const [id, entry] of this.hidden) {
				if (entry.state.stats.size > 0) entry.state.gapReset = true;
				entry.state.stats.reset();
				if (entry.state.stripJoined !== true) this.refreshAlerts(id, entry.state, status, now);
			}
		}
		alertStore.sweep(now);
		// A held tick (the same data, no alert change and nothing the tick
		// changed itself) would compose the faces already sent: skip it. The
		// epoch is read after every alert step above, so a dwell or a snooze
		// that ends on time alone still draws on its tick.
		const gate = `${frame}:a${alertStore.epoch}`;
		if (gate !== this.drawnTick || this.tickDirty) {
			this.drawnTick = gate;
			this.tickDirty = false;
			this.renderAll(status, undefined, true);
		}
		this.pushPanelPreview(status);
	}

	private sampleStats(state: InstanceState, snapshot: SensorSnapshot, source: string): void {
		const keys = new Set<string>(rotationKeysOf(state.settings) ?? []);
		const current = nonEmptyKey(state.settings.readingKey);
		if (current !== undefined) {
			keys.add(current);
		}
		// The multi-row views show session min/max/avg for every visible row,
		// so their step list samples too (a sensor-scoped view has no rotation
		// set; without this its non-selected rows would show live values under
		// a MIN badge). prune() below bounds the total by relevance as always.
		if (dialViewOf(state.settings) !== "single") {
			for (const member of stepListOf(state.settings, current, rotationGroupsOf(state.settings.rotationGroups), snapshot)) {
				keys.add(member.key);
			}
		}
		state.stats.validateRetained(snapshot, source, keys);
		for (const key of keys) {
			const reading = snapshot.byKey.get(key);
			if (reading !== undefined) {
				const resetReason = state.stats.observe(reading, snapshot, source);
				if (key === current && resetReason !== undefined) this.showOverlay(state, sessionResetMessage(resetReason));
			} else {
				state.stats.reset([key]);
			}
		}
		// Bound by relevance: every actively sampled reading is kept whatever
		// the set size (an insert-time cap would thrash and zero all sessions
		// each tick the moment a set outgrew it); strays from reselection are
		// dropped oldest-first past the slack.
		state.stats.prune(keys, 64);
	}

	/**
	 * Subscribes the two-row view's visible rows to poller series (they feed
	 * the row sparklines). The poller keeps each ring for the process and
	 * ignores a repeat subscription, so a row scrolling away and back keeps
	 * its history and nothing here needs tracking (external review MS05).
	 */
	private syncRowSeries(state: InstanceState, snapshot: SensorSnapshot): void {
		for (const key of twoRowKeys(state.settings, snapshot)) poller.subscribeSeries(key);
	}

	/**
	 * Keeps the history store's interest equal to the rows a Trend window
	 * draws: the visible rows of a two-row view with a window, else none.
	 * Set-replacing per dial, so a row that scrolls out is released (and
	 * lingers 16 minutes) and a repeat changes nothing. Without live data the
	 * rows are unknown and the last interest stands, unless the window
	 * itself is gone.
	 */
	private syncRowHistory(contextId: string, state: InstanceState, status: PollerStatus): void {
		const window = dialHistoryWindowOf(state.settings);
		if (window === undefined) {
			poller.history.dropInterest(rowsConsumerId(contextId));
			return;
		}
		if (status.state !== "ok") return;
		poller.history.setInterest(rowsConsumerId(contextId), twoRowKeys(state.settings, status.snapshot).map((savedKey) => ({ savedKey, window })));
	}

	/** Advances autocycling dials whose interval elapsed (timed by poll ticks). */
	private autoCycle(status: Extract<PollerStatus, { state: "ok" }>, now: number): void {
		for (const act of this.actions) {
			if (!act.isDial()) {
				continue;
			}
			const state = this.instances.get(act.id);
			// A strip member never autocycles: adoptReading would rewrite its
			// saved individual reading behind the strip.
			if (state === undefined || state.stripJoined === true) {
				continue;
			}
			const interval = parseAutoCycleMs(state.settings.autoCycleMs);
			if (interval === null || state.cyclePaused || state.pinned) {
				state.nextCycleAt = null;
			} else if (state.nextCycleAt === null) {
				state.nextCycleAt = now + interval;
			} else if (now >= state.nextCycleAt) {
				const key = nonEmptyKey(state.settings.readingKey);
				if (key !== undefined && !status.snapshot.byKey.has(key)) {
					continue; // transient dropout: hold, retry next tick
				}
				const groups = rotationGroupsOf(state.settings.rotationGroups);
				const list = stepListOf(state.settings, key, groups, status.snapshot);
				// While groups scope the step list, alerts are still hunted
				// across every group. The scan list comes from the parsed
				// groups (the authority), not the rotationKeys mirror, which
				// can go stale after settings edits under a rolled-back
				// version. Ungrouped and Legacy dials pass their own list.
				const alertList = groups !== undefined && schemeCanSwitchGroups(resolveControls(state.settings)) ? rotationReadings(groups.flatMap((g) => g.keys), key, status.snapshot) : list;
				const target = autoCycleTarget(list, alertList, key, this.criticalKeys(state, alertList), state.settings.alertInterrupt === true);
				if (target === undefined || readingMatchesKey(target, key)) {
					// Held (critical member on screen, or nowhere to go):
					// wait a full interval before looking again.
					state.nextCycleAt = now + interval;
					continue;
				}
				// The outgoing reading takes this tick's sample before the move;
				// renderAll samples the new selection. adoptReading leaves
				// nextCycleAt null; the next tick re-arms a full interval out.
				this.sampleStats(state, status.snapshot, status.source);
				// The tick draws the move at once; the adopt draws again after its write.
				this.tickDirty = true;
				void this.adoptReading(act, state, target.key);
			}
		}
	}

	/** Rotation-set members whose alert shows critical now, from this
	 * tick's step: the engine level is critical and not snoozed. With no
	 * dwell, recovery band or snooze this is exactly the 1.7.1 test (the
	 * legacy pair under alertUnit, crit first, on the live value). */
	private criticalKeys(state: InstanceState, list: readonly { key: string }[]): ReadonlySet<string> {
		return criticalKeysOf(state.alertShown ?? NO_DIAL_ALERTS, list);
	}

	/**
	 * Stamps the unit the thresholds/bar range apply to, from the reading on
	 * screen when the user edited them (the pending flag and key are set only
	 * there; with no reading selected yet, the first one chosen).
	 * Settings that predate unit scoping are never stamped uninvited: they
	 * keep the old apply-everywhere behavior until the next threshold edit,
	 * because guessing their unit from whatever reading happens to be
	 * selected at upgrade time would silently disable alerts configured for
	 * a different reading. An empty string is a real unit (unitless
	 * readings), so the pending flag, not the value, decides whether to
	 * stamp again.
	 */
	private stampAlertUnit(action: DialAction<DialSettings>, state: InstanceState): void {
		if (!state.pendingAlertUnitStamp) {
			return;
		}
		const status = poller.getStatus();
		if (status.state === "unavailable") {
			return; // stamped by a later tick, once the reading resolves
		}
		const key = state.pendingAlertUnitKey ?? nonEmptyKey(state.settings.readingKey);
		const reading = key === undefined ? undefined : status.snapshot.byKey.get(key);
		if (reading === undefined) {
			return;
		}
		state.pendingAlertUnitStamp = false;
		state.pendingAlertUnitKey = undefined;
		state.settings = { ...state.settings, alertUnit: reading.unit };
		this.tickDirty = true;
		void action.setSettings(state.settings);
	}

	/** Applies a control-action command; returns how many dials it reached. */
	private applyControlCommand(command: DialControlCommand): number {
		// Strip commands reach strip groups only (by the group's own Link
		// ID); every other command skips joined members and never counts
		// them, so the Control key's tick stays truthful.
		const id = command.command;
		if (isStripCommand(id)) {
			return this.strip.applyControl({ ...command, command: id });
		}
		let applied = 0;
		for (const act of this.actions) {
			if (!act.isDial()) {
				continue;
			}
			const state = this.instances.get(act.id);
			if (state === undefined || state.stripJoined === true || !matchesTarget(command.target, state.settings)) {
				continue;
			}
			applied++;
			void this.executeControl(act, state, command);
		}
		// State-only commands also reach hidden dials, whose pause/pin/stats
		// state is live and waiting to reappear. Selection changes need a
		// visible action and skip them. The TTL is enforced here too: with
		// the poller idle the tick sweep never runs, and an expired entry
		// will be discarded at restore, so counting it as "reached" would
		// show the control key a false ok tick.
		if (!SELECTION_COMMANDS.has(command.command)) {
			const now = monotonicNow();
			for (const [id, entry] of this.hidden) {
				if (now - entry.at > HIDDEN_STATE_TTL_MS) {
					this.hidden.delete(id);
					alertStore.forget(id);
					continue;
				}
				if (entry.state.stripJoined === true || !matchesTarget(command.target, entry.state.settings)) {
					continue;
				}
				applied++;
				this.executeStateCommand(id, entry.state, command);
			}
		}
		this.renderAll(poller.getStatus());
		return applied;
	}

	private async executeControl(action: DialAction<DialSettings>, state: InstanceState, command: DialControlCommand): Promise<void> {
		switch (command.command) {
			case "next":
				await this.advance(action, state, 1, "reading");
				return;
			case "prev":
				await this.advance(action, state, -1, "reading");
				return;
			case "nextGroup":
				await this.advance(action, state, 1, "group");
				return;
			case "prevGroup":
				await this.advance(action, state, -1, "group");
				return;
			default:
				this.executeStateCommand(action.id, state, command);
		}
	}

	/** The non-selection commands, shared by visible and hidden dials. */
	private executeStateCommand(contextId: string, state: InstanceState, command: DialControlCommand): void {
		switch (command.command) {
			case "cycleStat":
				state.statMode = nextStatMode(state.statMode);
				return;
			case "showCurrent":
			case "backToCurrent":
				state.statMode = "current";
				return;
			case "showMin":
				state.statMode = "min";
				return;
			case "showMax":
				state.statMode = "max";
				return;
			case "showAvg":
				state.statMode = "avg";
				return;
			case "pauseCycle":
				if (!state.cyclePaused) {
					this.setPaused(state, true);
				}
				return;
			case "resumeCycle":
				if (state.cyclePaused) {
					this.setPaused(state, false);
				}
				return;
			case "toggleCycle":
				this.setPaused(state, !state.cyclePaused);
				return;
			case "pin":
				if (!state.pinned) {
					this.setPinned(state, true);
				}
				return;
			case "unpin":
				if (state.pinned) {
					this.setPinned(state, false);
				}
				return;
			case "togglePin":
				this.setPinned(state, !state.pinned);
				return;
			case "resetStats":
				this.resetStats(state, command.scope);
				return;
			case "snoozeAlerts":
				this.snoozeAlerts(contextId, state);
				return;
			case "unsnoozeAlerts":
				this.unsnoozeAlerts(contextId, state);
				return;
		}
	}

	private showOverlay(state: InstanceState, text: string): void {
		state.overlay = { text, until: monotonicNow() + OVERLAY_MS };
		if (state.overlayTimer !== null) {
			clearTimeout(state.overlayTimer);
		}
		const timer = setTimeout(() => {
			state.overlay = null;
			state.overlayTimer = null;
			this.renderAll(poller.getStatus());
		}, OVERLAY_MS);
		timer.unref();
		state.overlayTimer = timer;
	}

	/**
	 * A visible dial joined a strip (its individual face, hints, stats,
	 * autocycle and writes are suspended) or left one (they resume: its
	 * sessions restart, said once by the session-reset hint, and its own
	 * face and hints come back).
	 */
	private stripClaimChanged(context: string, claimed: boolean): void {
		const state = this.instances.get(context);
		if (state === undefined) return;
		if (claimed) {
			state.stripJoined = true;
			state.gesture = IDLE_GESTURE;
			state.replayedPress = false;
			// Empty, so leaving repaints the individual face whatever it was.
			state.lastFeedback = "";
			if (state.overlayTimer !== null) {
				clearTimeout(state.overlayTimer);
				state.overlayTimer = null;
			}
			state.overlay = null;
			state.nextCycleAt = null;
			// Its own alerts stop stepping while it is grouped (the strip's
			// pane bands own its face). The last step is dropped so the panel
			// never reports a frozen level; alertSteppedAt stays, so the first
			// step after it leaves takes a gap first.
			state.alertShown = undefined;
			poller.history.dropInterest(rowsConsumerId(context));
			return;
		}
		this.leftStrip(state);
		const act = this.actions.find((a) => a.id === context);
		if (act?.isDial() === true) this.pushTriggerDescriptions(act, state.settings);
		const status = poller.getStatus();
		this.renderAll(status, context);
		this.pushPanelPreview(status);
	}

	/** A dial back from a strip: its readings were not observed for it while
	 * it was grouped, so its sessions start over and the face says so. */
	private leftStrip(state: InstanceState): void {
		state.stripJoined = false;
		state.stats.reset();
		state.gapReset = false;
		state.statMode = "current";
		state.gesture = IDLE_GESTURE;
		state.replayedPress = false;
		state.lastFeedback = "";
		state.nextCycleAt = null;
		this.showOverlay(state, sessionResetMessage("strip"));
	}

	/** The app's own gesture hints follow the active scheme (6.4-era API). */
	private pushTriggerDescriptions(action: DialAction<DialSettings>, settings: DialSettings): void {
		const scheme: ControlScheme = resolveControls(settings);
		// Legacy matches the manifest text; undefined restores exactly that.
		void action.setTriggerDescription(scheme.preset === "legacy" ? undefined : triggerDescriptions(scheme, rotationGroupsOf(settings.rotationGroups) !== undefined));
	}

	/** `alertsStepped`: the poller tick already stepped every visible dial's
	 * alerts against this status (before the auto cycle read them). */
	private renderAll(status: PollerStatus, only?: string, alertsStepped = false): void {
		for (const act of this.actions) {
			if (!act.isDial() || (only !== undefined && act.id !== only)) {
				continue;
			}
			const state = this.instances.get(act.id);
			// A strip member's face is the strip's slice (src/strip).
			if (state === undefined || state.stripJoined === true) {
				continue;
			}
			// Settings, gestures, theme changes and overlay expiry can render
			// before the next tick. Revalidate every displayed session here so
			// a retained untracked reading never borrows its old unit/source.
			// observe() deduplicates unchanged evidence, including tick renders.
			if (status.state === "ok") this.sampleStats(state, status.snapshot, status.source);
			else state.stats.reset();
			// The same for alerts: an edited rule or a new selection shows at
			// once, and the face's alert always belongs to the values it
			// draws. Another step on the same data changes nothing at
			// defaults and only lets time-based transitions land sooner.
			if (!alertsStepped) this.refreshAlerts(act.id, state, status);
			// Before composing, so a row that just scrolled into view draws
			// its (short) window at once, never one frame of the old line.
			this.syncRowHistory(act.id, state, status);
			// A Stars or Nebula face gets the strip's piece above this dial.
			const svg = paintArt(composeDialSvg(state, status, undefined, this.timelineOf), () => {
				const caps = deviceCapabilities.get(act.device.id);
				return artPlace({ id: act.device.id, type: caps.type, columns: caps.columns, rows: caps.rows }, act.coordinates, act.id, true);
			});
			if (svg !== state.lastFeedback) {
				state.lastFeedback = svg;
				const queuedAt = performance.now();
				const send = act.setFeedback({ canvas: `data:image/svg+xml,${encodeURIComponent(svg)}` });
				if (traceEnabled()) {
					void send.then(() => trace({ event: "render", context: act.id, renderQueuedAt: queuedAt, renderDoneAt: performance.now() }));
				} else {
					void send;
				}
			}
		}
	}

	private traceLifecycle(event: string, context: string, deviceId: string): void {
		const caps = deviceCapabilities.get(deviceId);
		trace({ event, context, device: hashId(deviceId), deviceType: caps.type, grid: `${caps.columns}x${caps.rows}` });
	}

	private traceGesture(event: string, context: string, state: InstanceState, after: GestureState, extra: { ticks?: number; pressed?: boolean; hold?: boolean; tapX?: number; tapY?: number }): void {
		// Hashed with this process's key (hashSelection): gadget-source
		// reading keys embed HWiNFO sensor/reading names, which are
		// user-renamable text. nonEmptyKey also shields the hash from
		// malformed non-string settings values.
		const selection = nonEmptyKey(state.settings.readingKey);
		trace({
			event,
			context,
			device: hashId(state.deviceId),
			controller: "Encoder",
			...extra,
			gestureBefore: describeGestureState(state.gesture),
			gestureAfter: describeGestureState(after),
			selectionBefore: selection === undefined ? undefined : hashSelection(selection)
		});
	}

	private diagnostics(): unknown {
		const summarize = (state: InstanceState, visible: boolean): unknown => ({
			visible,
			device: hashId(state.deviceId),
			preset: resolveControls(state.settings).preset,
			// Hashed with this process's key, as the trace does (hashSelection).
			selection: nonEmptyKey(state.settings.readingKey) === undefined ? null : hashSelection(nonEmptyKey(state.settings.readingKey) ?? ""),
			view: dialViewOf(state.settings),
			statMode: state.statMode,
			rotationSet: rotationKeysOf(state.settings)?.length ?? 0,
			// Counts only: group and reading names carry user text, like keys.
			rotationGroups: rotationGroupsOf(state.settings.rotationGroups)?.length ?? 0,
			rotationNames: Object.values(rotationNamesOf(state.settings) ?? {}).filter((value) => typeof value === "string" && value.trim() !== "").length,
			autoCycleMs: parseAutoCycleMs(state.settings.autoCycleMs),
			cyclePaused: state.cyclePaused,
			pinned: state.pinned,
			trackedStats: state.stats.size,
			linkId: typeof state.settings.linkId === "string" && state.settings.linkId.trim() !== "" ? hashId(state.settings.linkId.trim()) : null
		});
		return {
			visible: [...this.instances.values()].map((s) => summarize(s, true)),
			hidden: [...this.hidden.values()].map((entry) => summarize(entry.state, false))
		};
	}
}

/** Commands that change the selection and therefore need a visible action. */
const SELECTION_COMMANDS: ReadonlySet<string> = new Set(["next", "prev", "nextGroup", "prevGroup"]);

/** The state-only gesture commands, mapped to their executeStateCommand ids
 *  (the gestures toggle where the control action also has explicit on/off). */
const GESTURE_STATE_COMMANDS: Record<Exclude<GestureCommandId, "none" | "step" | "stepGroup">, ControlCommandId> = {
	cycleStat: "cycleStat",
	backToCurrent: "backToCurrent",
	pauseResume: "toggleCycle",
	pin: "togglePin",
	resetStats: "resetStats",
	// A snooze is not a toggle: pressing again while snoozed changes nothing
	// (the store keeps a running snooze as it is). The Control key ends one.
	snooze: "snoozeAlerts"
};

/** The encoder column a lifecycle payload carries (a single action's
 * coordinates), if any. */
function columnOf(payload: unknown): number | undefined {
	if (typeof payload !== "object" || payload === null) return undefined;
	const coordinates = (payload as { coordinates?: unknown }).coordinates;
	if (typeof coordinates !== "object" || coordinates === null) return undefined;
	const column = (coordinates as { column?: unknown }).column;
	return typeof column === "number" && Number.isInteger(column) ? column : undefined;
}

/** A key made fresh for each plugin process: see {@link hashSelection}. */
const SELECTION_HASH_KEY = randomBytes(32);

/**
 * The trace's and the support report's stand-in for a reading key: an
 * HMAC-SHA256 under a key made fresh for each plugin process, cut to 12
 * hex. Equal keys still match within one report and one trace. A plain
 * hash (hashId) would not hide what the key says: a Gadget key carries
 * HWiNFO's sensor and reading names, which a word list could match.
 */
function hashSelection(key: string): string {
	return createHmac("sha256", SELECTION_HASH_KEY).update(key).digest("hex").slice(0, 12);
}

/** The Trend window a dial draws: only the two-row view has one, and only
 * for an exact window value. */
export function dialHistoryWindowOf(settings: DialSettings): HistoryWindowId | undefined {
	return dialViewOf(settings) === "tworow" ? parseHistoryWindow(settings.dialHistoryWindow) : undefined;
}

/** The two-row view's visible row keys (none for the other views, or with
 * the selection missing from the snapshot). */
function twoRowKeys(settings: DialSettings, snapshot: SensorSnapshot): string[] {
	if (dialViewOf(settings) !== "tworow") return [];
	const key = nonEmptyKey(settings.readingKey);
	const reading = key === undefined ? undefined : snapshot.byKey.get(key);
	if (reading === undefined) return [];
	const list = stepListOf(settings, key, rotationGroupsOf(settings.rotationGroups), snapshot);
	return overviewWindow(list.length === 0 ? [reading] : list, key, 2).rows.map((member) => member.key);
}

/** The history consumer id for a dial's visible rows (in memory only). */
function rowsConsumerId(contextId: string): string {
	return `${contextId}:rows`;
}

/** A row's Trend window view at a width only the renderer knows. */
export type TimelineSource = (key: string, window: HistoryWindowId, widthPx: number, linkedKeys: readonly string[] | undefined) => HistoryView | undefined;

const liveTimelineOf: TimelineSource = (key, window, widthPx, linkedKeys) => poller.history.view(key, window, widthPx, monotonicNow(), linkedKeys);

function matchesTarget(target: string, settings: DialSettings): boolean {
	return target === "" || (typeof settings.linkId === "string" && settings.linkId.trim() === target);
}

/** The PI writes "off" or a millisecond count; anything else means off
 * too. Only a string or number counts: settings are untyped JSON, and a
 * boolean or array coerces to a number while an object can throw (AX31). */
function parseAutoCycleMs(raw: unknown): number | null {
	const ms = (typeof raw === "string" && raw !== "") || typeof raw === "number" ? Number(raw) : NaN;
	return Number.isInteger(ms) && ms > 0 ? ms : null;
}

/** The render-only state, shared by runtime, regressions and sample galleries. */
export type DialRenderState = Pick<InstanceState, "settings" | "stats" | "statMode" | "overlay" | "pinned" | "cyclePaused" | "alertShown">;

/** What a reading's alert shows on this face: the dial's last store step
 * when it has one, else the reading's rule on its live value alone. */
function alertOnFace(state: DialRenderState, reading: Reading): ShownAlert {
	if (state.alertShown !== undefined) return state.alertShown.get(reading.key) ?? NORMAL_SHOWN;
	return instantAlert(parseAlertConfig(state.settings), "dial", reading, 0, state.settings.fahrenheit === true);
}

/**
 * The snoozed cue's color for a dial face, the key's band color
 * (snoozeBandOf in sensor-reading.ts): the most severe level a deliberate
 * snooze silences among the readings the face shows, mixed toward the
 * theme background. Undefined when nothing on the face is snoozed, so a
 * face with no snooze draws no band and stays byte for byte as before.
 * Joined strip members are drawn by the strip's own renderer, which owns
 * its cue; this is the independent dial's face.
 */
export function dialSnoozeBandOf(shown: readonly ShownAlert[], config: ThemesConfig, palette: Palette): string | undefined {
	const worst = aggregateShown(shown).snoozed;
	return worst === null ? undefined : mixToward(config.alerts[worst].bg, palette.bg, ZONE_BG_BLEND);
}

export function composeDialSvg(state: DialRenderState, status: PollerStatus, historyOf: (key: string) => readonly number[] | undefined = (key) => poller.getSeries(key), timelineOf: TimelineSource = liveTimelineOf): string {
	// An art face carries the dial's Sky in its backdrop marker (deck-art.ts).
	return withArtSky(composeDialFace(state, status, historyOf, timelineOf), dialSkyFor(state.settings));
}

function composeDialFace(state: DialRenderState, status: PollerStatus, historyOf: (key: string) => readonly number[] | undefined, timelineOf: TimelineSource): string {
	const settings = state.settings;
	const config = loadThemes();
	const themeId = effectiveThemeFor(settings);
	// Dial faces stay themed while alerting, so the Text setting resolves at
	// level "normal" here; the alert expression (bar fill, alerting row
	// values) is fixed separately and custom text never recolors it. The
	// dial's background look (issue #41) decides the surface text resolves
	// on; the renderers still draw with the theme's real palette.
	const background = lookOn(dialBackgroundFor(settings.dialBackground), resolvePalette(config, themeId, null, "normal"));
	const accentWords = dialAccentWordsFor(settings.dialAccentWords);
	const textOf = (palette: Parameters<typeof resolveTextColors>[0]): TextColors => dialTextColors(background, palette, effectiveTextFor(settings), accentWords);

	const problem = statusDialText(status);
	if (problem !== null) {
		const palette = resolvePalette(config, themeId, null, "normal");
		return renderDial({ title: problem.title, valueText: problem.value, unitText: "", statsText: "", fraction: NaN, palette, barColor: palette.accent, text: textOf(palette), background });
	}
	const { snapshot } = status as Extract<PollerStatus, { state: "ok" }>;
	if (settings.readingKey === undefined || settings.readingKey === "") {
		const palette = resolvePalette(config, themeId, null, "normal");
		return renderDial({ title: t("dial.noSelection.title"), valueText: t("dial.noSelection.value"), unitText: "", statsText: t("dial.noSelection.hint"), fraction: NaN, palette, barColor: palette.accent, text: textOf(palette), background });
	}
	const reading = snapshot.byKey.get(settings.readingKey);
	if (reading === undefined) {
		// Turns are ignored here on purpose (see advance): the saved selection
		// survives a transient HWiNFO outage instead of being rotated away.
		const palette = resolvePalette(config, themeId, null, "normal");
		return renderDial({ title: t("dial.missing.title"), valueText: t("dial.missing.value"), unitText: "", statsText: t("dial.missing.hint"), fraction: NaN, palette, barColor: palette.accent, text: textOf(palette), background });
	}

	// Status, no-selection and missing faces above are shared with the single
	// view on purpose: the multi-row views only change how live data is laid
	// out.
	const view = dialViewOf(settings);
	if (view !== "single") {
		return composeOverviewSvg(state, snapshot, reading, config, themeId, view === "tworow" ? 2 : 3, historyOf, timelineOf);
	}

	const fahrenheit = settings.fahrenheit === true;
	const measureOpts = measureFor(measureOptionsFrom(settings), settings.readingFormats, reading);
	const stats = state.stats.get(settings.readingKey) ?? { min: reading.value, max: reading.value, sum: reading.value, count: 1 };

	const nativeShown = rowStatValue(reading.value, stats, state.statMode);
	const shown = formatMeasurement(nativeShown, reading.unit, measureOpts);
	const badge = STAT_BADGE[state.statMode];

	const min = convertUnit(stats.min, reading.unit, fahrenheit).value;
	const max = convertUnit(stats.max, reading.unit, fahrenheit).value;
	const live = convertUnit(reading.value, reading.unit, fahrenheit).value;

	// Thresholds and the manual bar range only apply to readings in the unit
	// they were configured against (mixed-unit rotation safety). Bounds and
	// zones come from the shared gauge model: manual sides win exactly,
	// automatic sides stay the session min/max (the dial's established
	// behavior) and only expand when thresholds would fall outside. A
	// reading with separate limits of its own draws those (in the unit on
	// the face, nothing while they stand down); every other reading draws
	// the legacy pair as before, converted to the face's unit when the panel
	// stamped it in the other of °C and °F (alertDisplayUnit), which is
	// where the alert itself compares it.
	const scoped = thresholdsApplyTo(settings.alertUnit, reading.unit);
	const alertConfig = parseAlertConfig(settings);
	const own = readingRuleOf(alertConfig, reading) !== undefined;
	const rule = own || scoped ? ruleFor(alertConfig, "dial", reading, 0) : null;
	const limits = rule === null ? undefined : ruleLimitsOnFace(rule, reading, fahrenheit);
	const warn = limits?.warn;
	const crit = limits?.crit;
	const gauge = computeGauge({
		value: live,
		manualMin: scoped ? parseThreshold(settings.barMin) : undefined,
		manualMax: scoped ? parseThreshold(settings.barMax) : undefined,
		evidence: { min, max },
		warn,
		crit,
		alertBelow: own ? limits?.below === true : settings.alertBelow === true
	});
	const fraction = Number.isFinite(gauge.fraction) ? gauge.fraction : 0.5;

	// Dials stay themed while alerting — only the bar fill flips to the alert
	// field color (the touchscreen slot is too small for a full polarity flip).
	// The level is what the alert shows after dwell, recovery and snooze.
	const shownAlert = alertOnFace(state, reading);
	const level = shownAlert.level;
	const accent = typeAccentsEnabled() ? classifyTypeAccent(reading.type, reading.unit, reading.label) : null;
	const palette = resolvePalette(config, themeId, accent, "normal");
	const snoozeBand = dialSnoozeBandOf([shownAlert], config, palette);

	// Title precedence: the per-dial label (transient or fixed), then the
	// reading's own per-member name, then HWiNFO's label.
	const label = customLabelOf(settings) ?? readingNameOf(rotationNamesOf(settings), reading) ?? reading.label;
	// A transient hint owns the whole stats line for its moment (appending it
	// to min/max would run past the 200 px canvas); persistent states replace
	// only the trailing "session" tag. The renderer fits the line by its drawn
	// width, so no combination can clip off-canvas. Data units carry their
	// own tier suffix per stat, so that variant packs tighter.
	const overlay = state.overlay;
	const stateTag = state.pinned ? "pinned" : state.cyclePaused && parseAutoCycleMs(settings.autoCycleMs) !== null ? "cycle paused" : "session";
	const minText = formatStat(stats.min, reading.unit, measureOpts);
	const maxText = formatStat(stats.max, reading.unit, measureOpts);
	const overlayShown = overlay !== null && overlay.until > monotonicNow();
	const statsLine = overlayShown
		? overlay.text
		: measureOpts.exact === true
			? exactStatsLine(statPairs(stats, reading.unit, measureOpts), stateTag, isDataUnit(reading.unit), dialStatsLineFits)
			: isDataUnit(reading.unit)
				? `▼${minText} ▲${maxText} ${stateTag}`
				: `▼ ${minText}   ▲ ${maxText}   ${stateTag}`;
	return renderDial({
		title: label,
		valueText: shown.valueText,
		unitText: `${shown.unitText}${badge !== "" ? " · " + badge : ""}`.trim(),
		statsText: statsLine,
		fraction,
		palette,
		barColor: level !== "normal" ? config.alerts[level].bg : palette.accent,
		// Ember's accent sits 3.26 (CIEDE2000) from the warning fill: when the
		// normal bar color is that close, the alert lights the whole track
		// in its zone shade (no palette change, owner decision Option B).
		trackColor: alertTrackFill(palette.accent, level, config.alerts, palette.bg) ?? undefined,
		zones: drawnZones(gauge.zones, config.alerts, palette.bg),
		text: textOf(palette),
		background,
		...(snoozeBand !== undefined ? { snoozeBand } : {}),
		...(measureOpts.exact === true ? { exactValue: true, exactFallback: exactFallback(nativeShown, reading.unit, measureOpts, false).map((m) => ({ ...m, unitText: `${m.unitText}${badge !== "" ? " · " + badge : ""}`.trim() })) } : {})
	});
}

/** The session low and high side by side for each of their texts
 * (exactStatTexts): the stats themselves, then with no decimals, then
 * compact. A stat with fewer texts (no value) keeps its last. */
function statPairs(stats: SessionStats, unit: string, opts: MeasureOptions): [string, string][] {
	const minTexts = exactStatTexts(stats.min, unit, opts);
	const maxTexts = exactStatTexts(stats.max, unit, opts);
	const count = Math.max(minTexts.length, maxTexts.length);
	return Array.from({ length: count }, (_, i): [string, string] => [minTexts[Math.min(i, minTexts.length - 1)] as string, maxTexts[Math.min(i, maxTexts.length - 1)] as string]);
}

/**
 * The single view's stats line for a reading with its own format, numbers
 * first: the whole line while it fits (12 or 11 px), else without its tag
 * (no "p…" stub); then the same with both numbers' decimals dropped, then
 * compact (exactStatTexts). A number is always drawn, never cut part-way
 * (a cut number reads as another number). The line keeps the layout the
 * action already draws for the reading's unit (tight for data units).
 */
function exactStatsLine(pairs: readonly [string, string][], tag: string, data: boolean, fits: (line: string) => boolean): string {
	const line = (min: string, max: string, withTag: boolean): string => {
		const numbers = data ? `▼${min} ▲${max}` : `▼ ${min}   ▲ ${max}`;
		return withTag && tag !== "" ? (data ? `${numbers} ${tag}` : `${numbers}   ${tag}`) : numbers;
	};
	const candidates = pairs.flatMap(([min, max]) => [line(min, max, true), line(min, max, false)]);
	return candidates.find(fits) ?? (candidates[candidates.length - 1] as string);
}

function customLabelOf(settings: DialSettings): string | undefined {
	return typeof settings.label === "string" && settings.label.trim() !== "" ? settings.label.trim() : undefined;
}

/** A reading's per-member name: saved under the key it shows as, else under
 *  a confirmed alias of it, the same walk the reading colors take, so a
 *  renamed reading keeps its name on whichever provider is live. Settings
 *  are untyped JSON: only an own, non-empty string counts (the PI's chip
 *  rename writes them), so "__proto__" or "constructor" is an entry like
 *  any other (external review AX35) and anything else is no name. */
function readingNameOf(names: Record<string, unknown> | undefined, reading: Pick<Reading, "key" | "linkedKeys">): string | undefined {
	if (names === undefined) return undefined;
	for (const key of [reading.key, ...(reading.linkedKeys ?? [])]) {
		const value = Object.hasOwn(names, key) ? names[key] : undefined;
		if (typeof value === "string" && value.trim() !== "") return value.trim();
	}
	return undefined;
}

/** The stored name map as it is: readingNameOf checks only the names a
 *  face draws, so no tick rebuilds the whole map (external review MS07). */
function rotationNamesOf(settings: DialSettings): Record<string, unknown> | undefined {
	const raw: unknown = settings.rotationNames;
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return undefined;
	}
	return raw as Record<string, unknown>;
}

/**
 * The overview face: rows are the exact rotation step list, the three-row
 * window follows the selection statelessly (see overviewWindow), and the
 * footer carries the single view's stats-line mechanics unchanged: session
 * min/max of the selected reading, transient overlays (group-jump names,
 * "cycle paused", reset confirmations), pinned and paused tags, and the
 * stat badge when a non-current stat is displayed. Row values honor the
 * displayed stat from each member's own session, and warn/critical tint a
 * row's value under the same alertUnit scoping as the single view's bar.
 */
function composeOverviewSvg(state: DialRenderState, snapshot: SensorSnapshot, reading: Reading, config: ThemesConfig, themeId: string, rowCount: 2 | 3, historyOf: (key: string) => readonly number[] | undefined, timelineOf: TimelineSource): string {
	const settings = state.settings;
	const window = rowCount === 2 ? dialHistoryWindowOf(settings) : undefined;
	const baseOpts = measureOptionsFrom(settings);
	const optsOf = (member: Reading): MeasureOptions => measureFor(baseOpts, settings.readingFormats, member);
	const stepList = stepListOf(settings, reading.key, rotationGroupsOf(settings.rotationGroups), snapshot);
	// A set whose members are all absent from the snapshot (sensor asleep)
	// still has a live selection to show; never render an empty face.
	const list = stepList.length === 0 ? [reading] : stepList;
	const { rows, selectedIndex } = overviewWindow(list, reading.key, rowCount);

	// Row names, resolved over the VISIBLE window: a user-typed name (the
	// per-dial label on the selected row, or a per-reading rotationNames
	// entry) wins verbatim and is never altered; among the rest, the leading
	// words all rows share are dropped ("GPU Temperature / GPU Hot Spot"
	// reads as "Temperature / Hot Spot") and come back once as the footer's
	// context prefix, unless "Row labels" is set to full.
	const names = rotationNamesOf(settings);
	const customLabel = customLabelOf(settings);
	const candidates = rows.map((member, index) => {
		const override = index === selectedIndex && customLabel !== undefined ? customLabel : readingNameOf(names, member);
		return { text: override ?? member.label, locked: override !== undefined };
	});
	const shorten = settings.overviewLabels !== "full";
	const deduped = shorten
		? dedupeSharedLabelPrefix(
				candidates.map((c) => c.text),
				candidates.map((c) => c.locked)
			)
		: { labels: candidates.map((c) => c.text), prefix: "" };

	// The accent (selection bar) follows the reading on the dial, exactly
	// like the single view's accent follows it.
	const accent = typeAccentsEnabled() ? classifyTypeAccent(reading.type, reading.unit, reading.label) : null;
	const palette = resolvePalette(config, themeId, accent, "normal");
	const textSettings = effectiveTextFor(settings);
	// The background look (issue #41): Glass resolves every row on its
	// hardest panel and band, so alert, sensor-type and Dim numbers keep
	// their floor over any picture; Outline and Clear recolor labels and
	// units on each row's own surface, and so do accent words. Theme resolves
	// exactly as before.
	const background = lookOn(dialBackgroundFor(settings.dialBackground), palette);
	const accentWords = dialAccentWordsFor(settings.dialAccentWords);
	const textPalette = dialTextPalette(background, palette);
	const text = dialPictureText(background, resolveTextColors(textPalette, textSettings, "normal"), textPalette.bg, textSettings, accentWords);
	const overviewRows: (OverviewRow & { history?: readonly number[]; timeline?: (widthPx: number) => HistoryView | undefined })[] = rows.map((member, index) => {
		const selected = index === selectedIndex;
		const nativeShown = rowStatValue(member.value, state.stats.get(member.key), state.statMode);
		const memberOpts = optsOf(member);
		const shown = formatMeasurement(nativeShown, member.unit, memberOpts);
		const colors = overviewRowColors({ settings, reading: member, level: alertOnFace(state, member).level, shownValue: nativeShown, selected, rowCount,
			palette: textPalette, config, themeId, typeAccents: typeAccentsEnabled(), textSettings });
		const rowText = dialPictureText(background, colors.text, colors.background, textSettings, accentWords);
		return {
			label: deduped.labels[index] ?? member.label,
			valueText: shown.valueText,
			unitText: shown.unitText,
			selected,
			...(memberOpts.exact === true ? { exact: true, fallback: exactFallback(nativeShown, member.unit, memberOpts, false) } : {}),
			// An alerting row's value is the alert indicator and stays fixed;
			// custom text never recolors it.
			valueColor: colors.value,
			// The selected two-row band resolves its label on the track like its unit.
			selectedLabelColor: rowText.label,
			unitColor: rowText.unit,
			// The two-row view draws each visible reading's trend from the
			// poller's series store, which syncRowSeries keeps subscribed; a
			// Trend window draws from the history store instead (the series
			// stays the fallback when the budget refuses the window).
			...(rowCount === 2 ? { history: historyOf(member.key) } : {}),
			...(window !== undefined ? { timeline: (widthPx: number) => timelineOf(member.key, window, widthPx, member.linkedKeys) } : {})
		};
	});

	const stats = state.stats.get(reading.key) ?? { min: reading.value, max: reading.value, sum: reading.value, count: 1 };
	// The footer's stats are the reading on the dial's, in its own format.
	const measureOpts = optsOf(reading);
	const minText = formatStat(stats.min, reading.unit, measureOpts);
	const maxText = formatStat(stats.max, reading.unit, measureOpts);
	const badge = STAT_BADGE[state.statMode];
	// One tag slot: pinned wins, then paused, then the stat badge; "session"
	// fills the quiet default, but yields to the shared-prefix context.
	const stateTag = state.pinned ? "pinned" : state.cyclePaused && parseAutoCycleMs(settings.autoCycleMs) !== null ? "cycle paused" : badge !== "" || deduped.prefix !== "" ? "" : "session";
	const tags = [badge, stateTag].filter((part) => part !== "").join(" · ");
	const overlay = state.overlay;
	const overlayActive = overlay !== null && overlay.until > monotonicNow();
	// The snoozed cue covers the rows the face shows, as the snooze does.
	const snoozeBand = dialSnoozeBandOf(rows.map((member) => alertOnFace(state, member)), config, palette);
	const band = snoozeBand !== undefined ? { snoozeBand } : {};
	if (rowCount === 2) {
		// The two-row face keeps the single footer line: the stripped shared
		// prefix TRAILS it so the renderer's fitting may shorten the context
		// ("· Virtual Mem…") but can never eat a number; the tight variant
		// (markers hugging their numbers) usually saves the whole text first.
		const context = deduped.prefix !== "" ? `· ${deduped.prefix}` : "";
		const roomy = [`▼ ${minText}`, `▲ ${maxText}`, tags, context].filter((part) => part !== "").join("  ");
		const tight = [`▼${minText}`, `▲${maxText}`, tags, context].filter((part) => part !== "").join(" ");
		// A reading with its own format keeps its numbers whole: the tags and
		// context give way first, then both numbers drop their decimals, then
		// compact (exactStatTexts).
		const exactFooter = (): string => {
			const lines = statPairs(stats, reading.unit, measureOpts).flatMap(([min, max]) => [[`▼${min}`, `▲${max}`, tags, context].filter((part) => part !== "").join(" "), `▼${min} ▲${max}`]);
			return lines.find(footerFits) ?? (lines[lines.length - 1] as string);
		};
		const footer = overlayActive ? overlay.text : footerFits(roomy) ? roomy : measureOpts.exact === true ? exactFooter() : tight;
		return renderDialTwoRow({ rows: overviewRows, footerText: footer, palette, text, background, ...band });
	}
	// The three-row wide tile splits that line: the stats are their own
	// right-anchored element the renderer never clips, and the left region
	// carries the tags and shared name (or a transient overlay, which takes
	// the whole line exactly as it took the whole footer).
	const contextText = overlayActive ? overlay.text : [tags, deduped.prefix].filter((part) => part !== "").join(" · ");
	const exactStats = (): string => {
		const lines = statPairs(stats, reading.unit, measureOpts).map(([min, max]) => `▼${min} ▲${max}`);
		return lines.find(overviewStatsFit) ?? (lines[lines.length - 1] as string);
	};
	const statsText = overlayActive ? "" : measureOpts.exact === true ? exactStats() : `▼${minText} ▲${maxText}`;
	return renderDialOverview({
		rows: overviewRows,
		contextText,
		statsText,
		header: settings.overviewHeader === "bottom" ? "bottom" : "top",
		separators: settings.overviewSeparators !== "off",
		palette,
		text,
		background,
		...band
	});
}

