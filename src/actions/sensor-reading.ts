/**
 * "Sensor Reading" key action — shows one live HWiNFO reading with optional
 * thresholds, stat modes and a sparkline. Pressing the key cycles the stat
 * mode (current → min → max → avg), or opens the detail view when its press
 * behavior says so.
 *
 * Alerts (src/alerts): every key is stepped once per poller tick for every
 * reading its drawn layout shows, through the shared alert store, so dwell,
 * the recovery band and a deliberate snooze hold across frames. A key with
 * no new alert fields draws exactly what 1.7.1 drew.
 */
import streamDeck, { action, SingletonAction, type DidReceiveSettingsEvent, type KeyAction, type KeyDownEvent, type KeyUpEvent, type SendToPluginEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";

import { immediateKeyView, keyAlertPanelOf, keyAlerts, referencedSlotKeys, rowGivesWay, type KeyAlertView } from "../alerts/key-alerts";
import { parseAlertConfig, ruleFor, ruleUnitFor, valueInUnit } from "../alerts/rules";
import { alertIdentityOf, alertStore } from "../alerts/store";
import { monotonicNow } from "../clock";
import { readingRow } from "../detail/detail-faces";
import { trace } from "../recorder";
import { detailScopePayloadOf, onDetailPage, scopedKeyHidden, type DetailPageView } from "../detail/detail-scope";
import { detailMirrorBackOf, detailRoleOf, detailScopeOf, pressBehaviorOf } from "../detail/detail-settings";
import { PressEngine } from "../detail/press-engine";
import { tickSignature } from "../detail/tick-signature";
import type { DetailNavigator, DeviceDetailState } from "../detail/navigation";
import { deviceCapabilities } from "../devices";
import type { HistoryWindowId } from "../history/types";
import { parseHistoryWindow } from "../history/window";
import { buildThemesPayload, forgetPanelFace, handlePiRequest, pushPreviewToPi } from "../pi-protocol";
import { poller, type PollerStatus } from "../poller";
import { sortedJson } from "../sorted-json";
import type { Reading, SensorSnapshot } from "../hwinfo/types";
import { convertUnit, isStatMode, nextStatMode, parseThreshold, readingStatBadge, sharedStatBadge, statValue, type AlertLevel, type DecimalsSetting, type StatMode } from "../ui/format";
import { computeGauge, drawnZones, ZONE_BG_BLEND } from "../ui/gauge";
import { exactFallback, formatMeasurement, formatQuadMeasurement, type MeasureOptions } from "../ui/measure";
import { measureFor } from "../ui/reading-format";
import { KEY_TREND_WIDTH_PX, QUAD_DEFAULT_COLORS, quadIdentityOf, renderDualKey, renderQuadKey, renderReadingKey, renderStatusKey, renderTripleKey, type DrawnZone, type QuadKeyCell } from "../ui/key-renderer";
import { renderDetailBlankKey, renderDetailIdleBackKey } from "../ui/detail-renderer";
import { drawnKeyLayout, nonEmptyKey } from "../ui/key-layout";
import { keyLabel, missingReadingScreen, missingRowLabel, noSelectionScreen, statusScreen } from "../ui/state-screens";
import { artPlace, paintArt, withArtSky } from "../ui/deck-art";
import { lookOn } from "../ui/dial-background";
import { backgroundOption, keyIdentitySurface, keyLookOf } from "../ui/key-background";
import { countOwnLooks, keyBackgroundFor, keySkyFor, NO_OWN_LOOKS, OWN_LOOK_FIELDS, ownLooksOf, registerLooksPort, staleLooksReset } from "../ui/shared-looks";
import { HEX6, mixToward, quadIdentityColor, type QuadIdentity } from "../ui/text-colors";
import { decideLegacyDefault, effectiveTextFor, effectiveThemeFor, getDeckTheme, measureOptionsFrom, onThemeChange, typeAccentsEnabled } from "../ui/theme-store";
import { classifyTypeAccent, loadThemes, resolvePalette, type Palette, type ThemesConfig, type TypeAccentKey } from "../ui/themes";

/** Persisted per-key settings (written by the PI; all optional). */
export type ReadingSettings = {
	readingKey?: string;
	label?: string;
	decimals?: DecimalsSetting;
	fahrenheit?: boolean;
	statMode?: StatMode;
	sparkline?: boolean;
	/**
	 * Single-layout display strip: "sparkline", "bar", "ring" or "none". A
	 * valid value wins; anything else (absent, junk, a newer version's
	 * future value) falls back to the legacy `sparkline` field, which is
	 * never rewritten, so pre-Display profiles keep their exact face.
	 */
	displayMode?: string;
	/**
	 * Trend window for the single layout's Sparkline display: exactly "1m",
	 * "5m" or "15m" draws that span of real time (gaps and short history
	 * included). Anything else, the panel's "" default included, keeps the
	 * recent-samples line byte for byte. Read only through historyWindowOf;
	 * written only by the panel, never on appear, preview or data.
	 */
	historyWindow?: string;
	warnValue?: string;
	critValue?: string;
	alertBelow?: boolean;
	/**
	 * Per-reading limits (src/alerts/rules.ts), filed under a stable reading
	 * key: `{ warn?, crit?, below?, unit?, hyst? }` with the display unit the
	 * panel captured in the same write as the numbers. A reading with an
	 * entry uses it; reading 1 without one keeps the legacy pair above.
	 * Salvaged entry by entry, never rewritten.
	 */
	alertRules?: JsonValue;
	/** "Alert after": exactly "0", "2000", "5000", "10000" or "30000" ms;
	 * anything else is 0 (immediate, as 1.7.1). */
	alertDwellMs?: string;
	/** Recovery band for the legacy pair, in its unit; junk is 0. */
	alertHysteresis?: string;
	/** The displayed unit the legacy numbers were typed in (panel-stamped
	 * with a legacy edit), so a °C/°F switch converts instead of
	 * reinterpreting them. */
	alertDisplayUnit?: string;
	/** The exact Warn at, Critical at and Clear after text the stamp was
	 * saved with; the stamp counts only while they still match
	 * (rules.ts stampedDisplayUnit). */
	alertDisplayUnitFor?: JsonValue;
	/** Opt-in "a press while alerting snoozes it for": exactly "300000",
	 * "900000" or "3600000" ms; anything else is off. */
	alertSnoozeMs?: string;
	/** Per-key theme override; empty/absent follows the deck default. */
	theme?: string;
	/**
	 * What the key draws behind its readout (src/ui/key-background.ts):
	 * exactly "glass", "tint", "outline" or "clear" lets the page background
	 * set in the Stream Deck app show through, and "theme" draws the theme
	 * background; anything else (absent, "", junk, a newer version's value)
	 * follows the shared default (globals.keyBackground), Theme when none
	 * is stored, today's face. Read only through keyBackgroundFor (via
	 * keyLookOf); written only by the panel.
	 */
	keyBackground?: string;
	/** Words in the accent color on Glass, Tint and Outline: the exact true
	 * or false; anything else follows the shared default
	 * (globals.keyAccentWords), off when none is stored. Read only through
	 * keyAccentWordsFor (via keyLookOf). */
	keyAccentWords?: boolean;
	/** The art looks' Stars and Sky color (src/ui/deck-art.ts ART_STARS,
	 * ART_TONES): each one exact name; anything else follows the shared
	 * default (globals.keyStars, globals.keySkyColor), today's look when none
	 * is stored. Read only through keySkyFor; written only by the panel. */
	keyStars?: string;
	keySkyColor?: string;
	/** The looks generation (globals.looksResetGen) keyBackground or
	 * keyAccentWords was chosen at; absent is 0. An own choice older than
	 * the shared generation is dropped when the key appears
	 * (src/ui/shared-looks.ts, "Use it everywhere"). */
	looksGen?: number;
	/**
	 * Per-key Text setting (issue #2): "theme", "dim" or "custom"; anything
	 * else (absent, "", junk) follows the deck-wide Text default.
	 */
	textMode?: string;
	/** Custom text color (#RRGGBB); invalid values degrade to theme text. */
	textColor?: string;
	/** Custom mode: labels, units and stats at lower intensity. */
	textDimSecondary?: boolean;
	/**
	 * "dual" stacks a second readout under the first; "triple" shows three
	 * compact horizontal rows; "quad" splits the key into a 2x2 grid of up
	 * to four readouts; anything else (or too few usable readings for the
	 * marker) renders the unchanged single layout, so settings written by a
	 * newer version degrade safely after a rollback and old profiles are
	 * never migrated or rewritten.
	 */
	keyLayout?: string;
	/** The second row's reading; same stable identity as readingKey. */
	secondaryReadingKey?: string;
	secondaryLabel?: string;
	/** Fixed stat for the second row; the key press cycles only the first.
	 * Dual-only: the triple and quad layouts cycle every row together. */
	secondaryStatMode?: StatMode;
	/** Quad slots 3 and 4 (slots 1 and 2 reuse readingKey and
	 * secondaryReadingKey, so switching from dual keeps both sensors). The
	 * triple layout reuses slot 3 as its third row for the same reason. */
	quadReadingKey3?: string;
	quadReadingKey4?: string;
	/** Micro-labels for quad slots 3 and 4; label and secondaryLabel cover
	 * slots 1 and 2. Drawn only in the micro-label variant. quadLabel3 also
	 * serves as the triple layout's third-row label (full length there). */
	quadLabel3?: string;
	quadLabel4?: string;
	/** Quad variant: true draws micro-labels above plain values; the default
	 * (false) colors each value with its slot color instead. */
	quadLabels?: boolean;
	/** Per-slot identity colors, four #RRGGBB entries. Salvaged per entry:
	 * an invalid entry falls back to that slot's default alone. */
	quadColors?: string[];
	/**
	 * What a key press does (issue #5): "cycle-stat" (the unchanged
	 * default), "open-details" (switch this device to its bundled detail
	 * profile), or "tap-cycle-hold-details" (short tap cycles, a held
	 * press opens details). Absent or unrecognized values (the reserved
	 * "open-workspace" included) behave exactly as cycle-stat, so
	 * rolled-back and hand-edited profiles never break.
	 */
	pressBehavior?: string;
	/** What the detail view lists: "source" (every reading of this
	 * sensor's HWiNFO source, the default), "custom" (detailKeys), or
	 * "filter" (readings matching the detailFilter glob). */
	detailMode?: string;
	/** Custom detail list: stable reading keys in display order. */
	detailKeys?: string[];
	/** How the hand-grouped tile plan (detailTiles) walks detailKeys: 2
	 * gives every listed key a cell, the opener's own reading included
	 * (hidden in place), so a link or a re-pick moves no label or color.
	 * Absent on plans saved by 1.7.0, which keep the older walk. The panel
	 * writes it with the plan; nothing rewrites it. */
	detailTilesVersion?: number;
	/** Optional title for the detail view's title tile. */
	detailTitle?: string;
	/** Readings per detail tile: "2", "3" or "4" stack that many readings
	 * on each tile of the view (dual, triple and quad faces); anything
	 * else keeps the original one-reading tiles. The panel's select
	 * writes strings; the parser also takes the bare numbers. */
	detailDensity?: string;
	/** Exactly false disables the mirror: inside the view, the reading
	 * slot on this key's own cell doubles as a second Back by default
	 * (tap in, tap out, one finger); untick to keep the movable top-left
	 * Back as the one way out. */
	detailMirrorBack?: boolean;
	/**
	 * Baked navigation role. The revision-2 detail profiles ship their
	 * top-left cell as a normal Sensor Reading carrying exactly "back":
	 * that tile configures like any key (sensor, layouts, theme,
	 * thresholds) while its press stays pinned to returning to the
	 * previous profile. Absent, malformed and future values behave as an
	 * ordinary key; the value is never normalized or rewritten.
	 */
	detailRole?: string;
	/**
	 * Intentional empty cells of this opener's detail pages, per bundle
	 * key and logical page: `{ "standard": [[{ "column": 2, "row": 0 }]] }`.
	 * Read only through detailGapsOf; written only by the panel's Page
	 * layout editor, one toggle per frame, never on open or preview.
	 */
	detailGaps?: Record<string, Array<Array<{ column: number; row: number }>>>;
	/**
	 * A key placed by hand on the shared detail page: the HWiNFO sources
	 * whose detail pages it belongs to (detailScope.sources: Shared Memory
	 * `sensorIdHex:instance` or the Gadget source name). On a detail page
	 * opened from any other source it draws blank and ignores presses.
	 * Absent, junk or empty: shown on every detail page, as before.
	 */
	detailScope?: { sources?: string[] };
	/**
	 * Per-reading formats (issue #59, src/ui/reading-format.ts): under a
	 * stable reading key, `{ unit?, decimals? }` shows that reading in one
	 * fixed unit and with its own decimals on every layout, its MIN, MAX and
	 * AVG included. Absent, or nothing for a reading, keeps Decimals and the
	 * deck's Data units exactly as before. Written only by the panel, never
	 * by the plugin; display only (alerts, gauges and history never read it).
	 */
	readingFormats?: JsonValue;
};

type InstanceState = {
	settings: ReadingSettings;
	/** The device this instance sits on. */
	deviceId: string;
	/** The device's detail session when this instance last appeared:
	 *  a key that appears after an entry belongs to that detail page. */
	appearedUnder: DeviceDetailState | undefined;
	/** The reading key this instance is subscribed to in the poller's sparkline
	 *  store (undefined when nothing is selected). */
	subscribedKey: string | undefined;
	/** Last SVG sent — identical frames are skipped. */
	lastSvg: string;
};

/** Per-entry salvage of the quad identity colors: each slot independently
 *  keeps a valid #RRGGBB override or falls back to that slot's default, so
 *  one hand-edited bad hex costs exactly one cell. Each entry says which it
 *  was, because a chosen color renders exact and a default keeps its
 *  readable lift; the settings are never rewritten either way. */
function quadColorsOf(settings: ReadingSettings): readonly QuadIdentity[] {
	const raw: unknown = settings.quadColors;
	const entries: readonly unknown[] = Array.isArray(raw) ? raw : [];
	return QUAD_DEFAULT_COLORS.map((_, i) => {
		const entry = entries[i];
		return quadIdentityOf(typeof entry === "string" && HEX6.test(entry) ? entry : null, i);
	});
}

@action({ UUID: "com.lawrensen.hwinfo.reading" })
export class SensorReadingAction extends SingletonAction<ReadingSettings> {
	private readonly instances = new Map<string, InstanceState>();
	/** Taps of "tap cycles; hold opens" armed at key down to snooze. */
	private readonly snoozeTaps = new Set<string>();
	/** Tap-vs-hold sessions for the "tap cycles; hold opens" behavior. A
	 * tap armed to snooze snoozes instead of cycling; the hold keeps its
	 * action. */
	private readonly presses = new PressEngine((contextId, outcome) => {
		const state = this.instances.get(contextId);
		if (state !== undefined && this.hiddenByScope(state)) {
			// Hidden mid-press (the device entered another source's page).
			this.snoozeTaps.delete(contextId);
			return;
		}
		const snooze = this.snoozeTaps.delete(contextId);
		void (outcome === "hold" ? this.openDetails(contextId) : snooze ? this.snooze(contextId) : this.cycleStat(contextId));
	});

	constructor(private readonly detailNavigator: DetailNavigator) {
		super();
		// Advanced, Shared defaults: the count line and "Use it everywhere".
		registerLooksPort({
			count: () => {
				let count = NO_OWN_LOOKS;
				for (const state of this.instances.values()) count = countOwnLooks(count, "keys", ownLooksOf(state.settings, OWN_LOOK_FIELDS.key));
				return count;
			},
			sweep: (gen) => this.sweepLooks(gen)
		});
		// Isolated so a rendering bug in one action class can't starve the other
		// listeners on the shared "tick" event.
		poller.onTick((status) => {
			try {
				this.onPollerTick(status);
			} catch (err) {
				streamDeck.logger.error("SensorReadingAction tick failed", err);
			}
		});
		onThemeChange(() => {
			this.renderAll(poller.getStatus());
			// Keep the open PI's "Deck default" chip and live preview truthful
			// in real time (theme, Text and Data units are all deck-wide).
			if (streamDeck.ui.action?.manifestId === this.manifestId) {
				void streamDeck.ui.sendToPropertyInspector(buildThemesPayload());
				this.pushPanelPreview(poller.getStatus());
			}
		});
	}

	override onWillAppear(ev: WillAppearEvent<ReadingSettings>): void {
		// Stream Deck can replay willAppear for a context without an intervening
		// willDisappear (reconnect, wake) — retain + subscribe only on the first
		// sighting, and carry the existing subscription across a replay so the
		// sparkline history (now owned by the poller) is never dropped.
		streamDeck.logger.debug(`Key appeared on ${JSON.stringify(ev.action.device.name)}${ev.action.isKey() && ev.action.coordinates !== undefined ? ` at ${ev.action.coordinates.column},${ev.action.coordinates.row}` : ""} (${ev.action.id})`);
		const existing = this.instances.get(ev.action.id);
		// A replayed appear consumes any press armed before it (external
		// review AX27): its release or hold would act on the replacement
		// settings. The press stays held until its release, so a repeated
		// down cannot start it again (AX67).
		this.presses.consume(ev.action.id);
		this.snoozeTaps.delete(ev.action.id);
		const firstSighting = existing === undefined;
		if (firstSighting) {
			poller.retain();
		}
		// The baked Back marker ships inside the revision-2 profiles (1.4.91+),
		// so its presence can never signal a pre-theme install: without this
		// exclusion, a first launch that starts inside a detail profile would
		// wrongly migrate a fresh install onto the legacy graphite theme.
		decideLegacyDefault(Object.entries(ev.payload.settings).some(([key, v]) => key !== "detailRole" && v !== undefined));
		const key = nonEmptyKey(ev.payload.settings.readingKey);
		let subscribedKey = existing?.subscribedKey;
		if (subscribedKey !== key) {
			// Covers the first sighting (subscribedKey starts undefined) and a
			// replayed willAppear whose settings changed while the action was
			// out of sight — track the new key's ring exactly like
			// onDidReceiveSettings, or it never fills and the sparkline goes
			// permanently blank. The old ring stays warm by design.
			if (key !== undefined) {
				poller.subscribeSeries(key);
			}
			subscribedKey = key;
		}
		// Set-replacing and keyed by this action, so a replayed appear asks
		// for the same thing again and changes nothing.
		this.syncHistory(ev.action.id, ev.payload.settings);
		// An own Background or Words chosen before the last "Use it
		// everywhere" goes now, in one write (src/ui/shared-looks.ts); with
		// none, appearing writes nothing.
		const looksReset = staleLooksReset(ev.payload.settings, "key");
		if (looksReset !== undefined) this.writeLooks(ev.action, looksReset);
		this.instances.set(ev.action.id, {
			settings: (looksReset as ReadingSettings | undefined) ?? ev.payload.settings,
			deviceId: ev.action.device.id,
			appearedUnder: this.detailNavigator.stateFor(ev.action.device.id),
			subscribedKey,
			// Never carry the dedupe key across an appear. A replayed one
			// (reconnect, wake) can arrive with the app's own image cache cold,
			// and remembering our last frame would skip the repaint that fills
			// it: the key then sits on the action's static icon until the
			// composed bytes happen to change, which for a status screen or a
			// steady reading is never. DetailController does the same at its
			// own replay (controller.ts registerSlot).
			lastSvg: ""
		});
		// The first frame already shows the alert (a replay within the hidden
		// window keeps its dwell and snooze). Reads settings, writes none.
		const status = poller.getStatus();
		keyAlerts.appear(ev.action.id, ev.payload.settings, status, monotonicNow());
		this.renderAll(status, ev.action.id);
	}

	override onWillDisappear(ev: WillDisappearEvent<ReadingSettings>): void {
		// A key that vanishes mid-press (profile switch, page nav) must never
		// fire a late hold or tap — the session dies with the visibility.
		this.presses.cancel(ev.action.id);
		this.snoozeTaps.delete(ev.action.id);
		// A key with limits keeps being stepped with its last settings for
		// the hidden window, so a page flip comes back to the same alerts.
		keyAlerts.hide(ev.action.id, monotonicNow());
		if (this.instances.delete(ev.action.id)) {
			// The ring stays tracked: history keeps collecting off-screen while
			// anything else keeps the poller alive, and paging back resumes the
			// line from the samples it already had. A Trend window's series
			// lingers the same way (16 minutes) once its interest is dropped.
			poller.history.dropInterest(ev.action.id);
			poller.release();
		}
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<ReadingSettings>): void {
		this.settingsArrived(ev.action.id, ev.payload.settings);
	}

	/** One looks-reset write (src/ui/shared-looks.ts). */
	private writeLooks(action: { setSettings(settings: JsonObject): Promise<void> }, doc: Record<string, unknown>): void {
		void action.setSettings(doc as JsonObject).catch((err: unknown) => streamDeck.logger.warn(`looks reset write failed: ${String(err)}`));
	}

	/** "Use it everywhere": every visible key's own Background and Words
	 * chosen before generation `gen` go, one write each, and the face
	 * follows the shared ones at once. */
	private sweepLooks(gen: number): void {
		for (const [contextId, state] of [...this.instances]) {
			const doc = staleLooksReset(state.settings, "key", gen);
			const action = doc === undefined ? undefined : streamDeck.actions.getActionById(contextId);
			if (doc === undefined || action === undefined) continue;
			this.writeLooks(action, doc);
			this.settingsArrived(contextId, doc as ReadingSettings);
		}
	}

	private settingsArrived(contextId: string, settings: ReadingSettings): void {
		const state = this.instances.get(contextId);
		if (state === undefined) {
			return;
		}
		// Track the new reading's ring when the sensor changes; the old ring
		// stays warm in the poller. A °C/°F change resets nothing: the poller
		// stores native values, so the drawn shape is unit-invariant and the
		// history carries across.
		const nextSub = nonEmptyKey(settings.readingKey);
		if (state.subscribedKey !== nextSub) {
			if (nextSub !== undefined) {
				poller.subscribeSeries(nextSub);
			}
			state.subscribedKey = nextSub;
		}
		// A held key keeps the document it was pressed under. Any change
		// consumes the press (a Back role, another reading, behavior or
		// detail target would otherwise resolve under the new settings,
		// external review AX27); an unchanged echo leaves it armed, whatever
		// its key order (the app sorts keys, the plugin's own writes do not).
		if (sortedJson(state.settings) !== sortedJson(settings)) {
			this.presses.consume(contextId);
			this.snoozeTaps.delete(contextId);
		}
		state.settings = settings;
		this.syncHistory(contextId, state.settings);
		// A reading whose rule now compares differently starts its alert
		// fresh; the face follows the edit at once. Writes nothing.
		const status = poller.getStatus();
		keyAlerts.update(contextId, state.settings, status, monotonicNow());
		this.renderAll(status, contextId);
		// The panel sees an edit's result at once, not on the next tick.
		this.pushPanelPreview(status);
		this.pushDetailScope(false);
	}

	/**
	 * Key press behavior (issue #5). A baked Back role wins outright: the
	 * press asks the navigator for the previous profile and nothing else
	 * (no stat cycle, no detail entry, no tap/hold arming). Otherwise the
	 * default "cycle-stat" keeps the original semantics exactly: cycle
	 * current → min → max → avg on key DOWN. "open-details" enters the
	 * detail view on key down instead, and "tap-cycle-hold-details" arms
	 * the press engine (tap cycles on release, a 500 ms hold opens details
	 * once). Malformed or future pressBehavior values take the cycle-stat
	 * path.
	 *
	 * Precedence at key down: a held press (ignored), the Back role, a
	 * snooze armed at this down (the key opted in through alertSnoozeMs and
	 * its face shows an active, unsnoozed alert: the down-acting press or
	 * the tap snoozes instead, the hold keeps its action), then the
	 * behavior.
	 */
	override async onKeyDown(ev: KeyDownEvent<ReadingSettings>): Promise<void> {
		const contextId = ev.action.id;
		const state = this.instances.get(contextId);
		// A repeated down (replayed events) belongs to the press already
		// held, which settings or a replayed appear may have consumed; it
		// must not act under the replacement settings (external review AX67).
		// The behaviors that act on key down (cycle-stat, open-details, Back)
		// keep no press record, so a repeated down acts again, as in every
		// earlier build: a record there would swallow the first press after
		// a lost release.
		if (this.presses.isDown(contextId) || state === undefined) {
			return;
		}
		if (detailRoleOf(state.settings) === "back") {
			// No session is held here (the guard above), so no timer can fire
			// a ghost hold; the navigator stays the only authority for
			// profile navigation (device-scoped, debounced).
			await this.detailNavigator.leave(ev.action.device.id);
			return;
		}
		if (this.hiddenByScope(state)) {
			// A key limited to other sources' detail pages: blank and inert
			// here, so no stat cycle, no snooze, no write and no entry.
			return;
		}
		// Decided here, at key down, from what the face shows now.
		const snoozeArmed = keyAlerts.snoozeArmed(contextId);
		const behavior = pressBehaviorOf(state.settings);
		if (behavior === "tap-cycle-hold-details") {
			if (snoozeArmed) this.snoozeTaps.add(contextId);
			else this.snoozeTaps.delete(contextId);
			this.presses.keyDown(contextId);
			return;
		}
		if (snoozeArmed) {
			this.snooze(contextId);
			return;
		}
		if (behavior === "open-details") {
			await this.openDetails(contextId);
			return;
		}
		await this.cycleStat(contextId);
	}

	override onKeyUp(ev: KeyUpEvent<ReadingSettings>): void {
		const contextId = ev.action.id;
		const state = this.instances.get(contextId);
		if (state !== undefined && (detailRoleOf(state.settings) === "back" || this.hiddenByScope(state))) {
			// A Back tile's release does nothing; cancel defensively so a
			// session armed before the role arrived can never resolve as a
			// tap under the new role.
			this.presses.cancel(contextId);
			this.snoozeTaps.delete(contextId);
			return;
		}
		// Resolves only an armed tap/hold session; a no-session keyUp (the
		// other behaviors, or a press that outlived its key) is a no-op.
		this.presses.keyUp(contextId);
	}

	/** Snoozes every alerting reading of the key for its snooze length. */
	private snooze(contextId: string): void {
		const count = keyAlerts.snooze(contextId, monotonicNow());
		trace({ event: "snooze", context: contextId, note: `readings=${count}` });
		this.renderAll(poller.getStatus(), contextId);
	}

	/** The original press action, verbatim: cycle the stat and persist it. */
	private async cycleStat(contextId: string): Promise<void> {
		const state = this.instances.get(contextId);
		const act = this.actionById(contextId);
		if (state === undefined || act === undefined || state.settings.readingKey === undefined) {
			return;
		}
		const current = isStatMode(state.settings.statMode) ? state.settings.statMode : "current";
		const next = nextStatMode(current);
		state.settings = { ...state.settings, statMode: next };
		await act.setSettings(state.settings);
		this.renderAll(poller.getStatus(), contextId);
	}

	/**
	 * Opens the detail view for this key's device. Every refusal keeps the
	 * key exactly as it was (no stat cycle as a fallback) and shows the
	 * Stream Deck alert cue; the log names the device type, never a sensor.
	 */
	private async openDetails(contextId: string): Promise<void> {
		const state = this.instances.get(contextId);
		const act = this.actionById(contextId);
		if (state === undefined || act === undefined) {
			return;
		}
		const deviceId = act.device.id;
		const caps = deviceCapabilities.get(deviceId);
		const status = poller.getStatus();
		const result = await this.detailNavigator.enter({
			deviceId,
			deviceType: caps.type,
			// Variable-canvas guests (the Virtual Stream Deck) resolve their
			// bundle by reported grid; fixed classes ignore it.
			grid: { columns: caps.columns, rows: caps.rows },
			settings: state.settings,
			snapshot: status.state === "unavailable" ? null : status.snapshot,
			// Names the opener's source for keys limited to some sources'
			// detail pages (detailScope).
			source: status.state === "unavailable" ? undefined : status.source,
			// The opener's own cell: a detail reading slot on the same cell
			// becomes the mirror Back tile (tap in, tap out, one finger).
			// On by default; an explicit false skips the capture and the
			// whole mirror path stays inert.
			openerCell: detailMirrorBackOf(state.settings) && act.coordinates !== undefined ? { column: act.coordinates.column, row: act.coordinates.row } : undefined,
			// The Back tile stands for this key: it shows this key's live
			// alert (dwell, recovery band, snooze) while the view is open.
			openerContext: contextId
		});
		if (result !== "entered") {
			streamDeck.logger.info(`Detail entry ${result} (device type ${caps.type ?? "unknown"})`);
			await act.showAlert();
		}
	}

	/** The visible action proxy for a context (press outcomes arrive by id). */
	private actionById(contextId: string): KeyAction<ReadingSettings> | undefined {
		for (const act of this.actions) {
			if (act.id === contextId && act.isKey()) {
				return act;
			}
		}
		return undefined;
	}

	override onSendToPlugin(ev: SendToPluginEvent<JsonValue, ReadingSettings>): void {
		const payload = ev.payload;
		if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
			if (payload.event === "getPreview") {
				// A freshly loaded panel asks once: resend the face even when it
				// has not changed since the previous panel on this context.
				forgetPanelFace();
				this.pushPanelPreview(poller.getStatus());
				return;
			}
		}
		if (typeof payload === "object" && payload !== null && !Array.isArray(payload) && payload.event === "getDetailScope") {
			this.pushDetailScope(true);
			return;
		}
		handlePiRequest(payload);
	}

	/** What this action knows about the device an instance sits on. */
	private pageView(state: InstanceState): DetailPageView<DeviceDetailState> {
		const session = this.detailNavigator.stateFor(state.deviceId);
		return {
			session,
			appearedUnder: state.appearedUnder,
			surfaceLive: session !== undefined && session.surfaceCount > 0,
			sessionPending: session !== undefined && session.pending,
			recentlyLeft: this.detailNavigator.recentlyLeft(state.deviceId),
			openerSource: session?.openerSource?.id
		};
	}

	/** True while a key limited to some sources' detail pages sits on a
	 * detail page opened from another source (see scopedKeyHidden). */
	private hiddenByScope(state: InstanceState): boolean {
		return detailScopeOf(state.settings) !== undefined && scopedKeyHidden(state.settings, this.pageView(state));
	}

	private lastScopePush = "";

	/**
	 * Tells an open panel whether its key sits on a managed detail page,
	 * which source that page was opened from, and the names of the
	 * sources the key is limited to, so it can offer "Show only on ..."
	 * and list them. Read-only: nothing here writes settings. Sent when
	 * the panel asks and again whenever the answer changes.
	 */
	private pushDetailScope(force: boolean): void {
		const piAction = streamDeck.ui.action;
		if (piAction === undefined || piAction.manifestId !== this.manifestId) {
			return;
		}
		const state = this.instances.get(piAction.id);
		if (state === undefined) {
			return;
		}
		const view = this.pageView(state);
		const opener = view.session?.openerSource;
		const status = poller.getStatus();
		const scope = detailScopeOf(state.settings) ?? [];
		const payload = detailScopePayloadOf(piAction.id, onDetailPage(view), opener, scope, status.state === "unavailable" ? null : status.snapshot, status.state === "unavailable" ? undefined : status.source);
		const body = JSON.stringify(payload);
		if (!force && body === this.lastScopePush) {
			return;
		}
		this.lastScopePush = body;
		void streamDeck.ui.sendToPropertyInspector(payload);
	}

	override onPropertyInspectorDidAppear(): void {
		forgetPanelFace();
	}

	/** The open panel's preview, carrying the frame this action last sent
	 * to the device (never a separate render). No-op with no panel open. */
	private pushPanelPreview(status: PollerStatus): void {
		pushPreviewToPi(status, this.manifestId, this.instances, true, (id) => this.instances.get(id)?.lastSvg, (id) => {
			// What the key's alerts resolve to, for the panel's rows, notes
			// and summaries (read only, nothing written).
			const settings = this.instances.get(id)?.settings ?? {};
			return { keyAlerts: keyAlertPanelOf(settings, status.state === "unavailable" ? null : status.snapshot, keyAlerts.view(id)) };
		});
	}

	private lastTickSignature = "";
	/** The data part of the last tick signature (without the alert epoch). */
	private lastDataSignature = "";
	/** The right edge of every Trend window drawn since the data last
	 * changed: a repaint for any other reason (theme, settings, a detail
	 * session) redraws the same columns instead of sliding them. */
	private frameNow: number | null = null;

	/** Asks the history store for this key's Trend window, or releases it. */
	private syncHistory(contextId: string, settings: ReadingSettings): void {
		const key = nonEmptyKey(settings.readingKey);
		const window = historyWindowOf(settings);
		if (key !== undefined && window !== undefined) poller.history.setInterest(contextId, [{ savedKey: key, window }]);
		else poller.history.dropInterest(contextId);
	}

	private onPollerTick(status: PollerStatus): void {
		// The sparkline rings are filled by the poller now (once per fresh
		// snapshot, keyed by reading) so it survives this action's appear churn —
		// here we only render and feed the open PI's live preview.
		// Same gate as DetailController: an unchanged tick signature means every
		// key face would compose to the bytes the dedupe already holds, so skip
		// the compose itself, not just the setImage. Theme flips, settings
		// receipts, appears and detail-session changes repaint through their own
		// renderAll calls, never through this gate.
		// A key with a Trend window also repaints when its history moved
		// without the status moving (a run that ended on a skipped read).
		// Without one the gate is exactly the status signature.
		// Alerts first: every key, on screen or hidden, is stepped once for
		// every reading it shows. The alert epoch joins the gate, so a face
		// whose alert changed with time alone (a dwell completing, a snooze
		// ending) repaints while its values hold still; it never moves a
		// Trend window's right edge, which follows data only.
		keyAlerts.tick(status, monotonicNow());
		let windowed = false;
		for (const state of this.instances.values()) windowed ||= historyWindowOf(state.settings) !== undefined;
		const dataSignature = windowed ? `${tickSignature(status)}:h${poller.history.revision}` : tickSignature(status);
		const signature = `${dataSignature}:a${alertStore.epoch}`;
		if (signature !== this.lastTickSignature) {
			this.lastTickSignature = signature;
			if (dataSignature !== this.lastDataSignature) {
				this.lastDataSignature = dataSignature;
				this.frameNow = monotonicNow();
			}
			this.renderAll(status);
			// Scoped source names follow the data (HWiNFO started later).
			this.pushDetailScope(false);
		}
		this.pushPanelPreview(status);
	}

	/** Repaint hook for detail-state changes (enter, leave, cleanup): a
	 * Back tile's fallback face follows the device session, so it repaints
	 * on the same signal the hidden slots do, not only on the next tick.
	 * Frame dedupe makes a no-change call cost nothing. */
	repaint(): void {
		this.renderAll(poller.getStatus());
		this.pushDetailScope(false);
	}

	private renderAll(status: PollerStatus, only?: string): void {
		for (const act of this.actions) {
			if (!act.isKey() || (only !== undefined && act.id !== only)) {
				continue;
			}
			const state = this.instances.get(act.id);
			if (state === undefined) {
				continue;
			}
			// A Stars or Nebula face gets its piece of the deck's scene here,
			// where the key's place is known (deck-art.ts); any other face
			// passes through unchanged.
			const svg = paintArt(this.composeFor(act.id, state, act.device.id, status), () => {
				const caps = deviceCapabilities.get(act.device.id);
				return artPlace({ id: act.device.id, type: caps.type, columns: caps.columns, rows: caps.rows }, act.coordinates, act.id, false);
			});
			if (svg !== state.lastSvg) {
				state.lastSvg = svg;
				void act.setImage(`data:image/svg+xml,${encodeURIComponent(svg)}`);
			}
		}
	}

	/**
	 * One instance's face. An ordinary key takes the unchanged compose
	 * path. A Back-role tile takes the SAME path with the return hook:
	 * configured tiles render their own settings (their missing sensor
	 * shows the configured missing behavior, never the opener's), an
	 * unconfigured tile falls back to the live session's opener so a
	 * fresh profile works before any configuration, and with no session
	 * at all the honest idle Back face keeps the way out obvious.
	 */
	private composeFor(contextId: string, state: InstanceState, deviceId: string, status: PollerStatus): string {
		if (this.hiddenByScope(state)) {
			return scopedBlankFace(this.detailNavigator.stateFor(deviceId));
		}
		const now = this.frameNow ?? monotonicNow();
		const alerts = keyAlerts.isTracked(contextId) ? keyAlerts.view(contextId) : undefined;
		if (detailRoleOf(state.settings) !== "back") {
			return compose(state.settings, status, false, now, alerts);
		}
		if (nonEmptyKey(state.settings.readingKey) !== undefined) {
			return compose(state.settings, status, true, now, alerts);
		}
		const detail = this.detailNavigator.stateFor(deviceId);
		if (detail === undefined) {
			return renderDetailIdleBackKey();
		}
		return compose(backFallbackSettings(detail), status, true, undefined, backFallbackView(detail, status));
	}
}

/** A hidden scoped key's face: the detail page's own themed blank (the
 * opener's theme and key look, else the deck default), so it reads as
 * empty space beside the page's other unused tiles. */
function scopedBlankFace(detail: DeviceDetailState | undefined): string {
	const theme = detail?.presentation.theme;
	const themeId = typeof theme === "string" && theme !== "" ? theme : getDeckTheme();
	const palette = resolvePalette(loadThemes(), themeId, null, "normal");
	// The opener's key look too, like the page's other blank tiles.
	const look = lookOn(keyBackgroundFor(detail?.presentation.keyBackground), palette);
	return look === "theme" ? renderDetailBlankKey(palette) : withArtSky(renderDetailBlankKey(palette, look), keySkyFor(detail?.presentation));
}

/** The minimal synthetic settings for an unconfigured Back tile: the
 * opener's primary reading under the opener's presentation, single
 * layout, no strip, no stat — byte-equivalent to the hidden slot's
 * composeBackFace output by construction (same formatting, theme, text
 * and threshold authorities, statValue("current") = the live value).
 * Exported for the equivalence test. */
export function backFallbackSettings(detail: DeviceDetailState): ReadingSettings {
	const p = detail.presentation;
	return {
		readingKey: detail.primaryKey,
		label: p.label,
		decimals: p.decimals,
		fahrenheit: p.fahrenheit,
		theme: p.theme,
		textMode: p.textMode,
		textColor: p.textColor,
		textDimSecondary: p.textDimSecondary,
		...(p.keyBackground !== undefined ? { keyBackground: p.keyBackground } : {}),
		...(p.keyAccentWords !== undefined ? { keyAccentWords: p.keyAccentWords } : {}),
		...(p.keyStars !== undefined ? { keyStars: p.keyStars } : {}),
		...(p.keySkyColor !== undefined ? { keySkyColor: p.keySkyColor } : {}),
		warnValue: p.warnValue,
		critValue: p.critValue,
		alertBelow: p.alertBelow,
		...(p.alertRules !== undefined ? { alertRules: p.alertRules } : {}),
		...(typeof p.alertDisplayUnit === "string" ? { alertDisplayUnit: p.alertDisplayUnit } : {}),
		...(p.alertDisplayUnitFor !== undefined ? { alertDisplayUnitFor: p.alertDisplayUnitFor } : {}),
		...(p.readingFormats !== undefined ? { readingFormats: p.readingFormats } : {})
	};
}

/**
 * The unconfigured Back tile's alert: what the key that opened the view
 * shows for its primary reading right now (dwell, recovery band and snooze
 * included), exactly as the hidden slot's composeBackFace reads it.
 * Undefined while that key is not being stepped (a plugin restart, or past
 * the hidden window): compose then compares the opener's rule once.
 */
export function backFallbackView(detail: DeviceDetailState, status: PollerStatus): KeyAlertView | undefined {
	if (status.state !== "ok" || detail.openerContext === undefined) {
		return undefined;
	}
	const reading = status.snapshot.byKey.get(detail.primaryKey);
	if (reading === undefined) {
		return undefined;
	}
	const shown = keyAlerts.shownFor(detail.openerContext, alertIdentityOf(reading));
	return shown === undefined ? undefined : { face: shown, slots: [shown], perRow: false };
}

/**
 * One key face from settings alone. `returnMark` rides every layout and
 * status screen (the Back tile is this same composition with the hook);
 * false keeps every output byte-identical to the pre-role renderer.
 * Exported so the fallback's byte-equivalence to the hidden slot's
 * composeBackFace is provable against the REAL path, not a copy.
 *
 * `alerts` is what the key's live alert path shows (KeyAlerts.view).
 * Without it every drawn reading's rule is compared once
 * (immediateKeyView), which is exactly what the live path shows at
 * "Alert after: Immediately" with no recovery band, and for a key with no
 * new alert fields exactly what 1.7.1 drew.
 */
export function compose(settings: ReadingSettings, status: PollerStatus, returnMark = false, now: number = monotonicNow(), alerts?: KeyAlertView): string {
	// An art face carries the key's Sky in its backdrop marker (deck-art.ts);
	// any other face, and the default Sky, keep their bytes.
	return withArtSky(composeFace(settings, status, returnMark, now, alerts), keySkyFor(settings));
}

function composeFace(settings: ReadingSettings, status: PollerStatus, returnMark: boolean, now: number, alerts?: KeyAlertView): string {
	const screen = statusScreen(status);
	if (screen !== null) {
		return renderStatusKey({ ...screen, returnMark });
	}
	const { snapshot } = status as Extract<PollerStatus, { state: "ok" }>;
	const primaryKey = nonEmptyKey(settings.readingKey);
	if (primaryKey === undefined) {
		return renderStatusKey({ ...noSelectionScreen(), returnMark });
	}
	const view = alerts ?? immediateKeyView(settings, snapshot);
	// The layout gate lives in drawnKeyLayout (shared with the settings
	// panel's summary): the dual layout needs BOTH the exact "dual" marker
	// and a usable second reading; the quad grid and the triple rows need
	// their exact marker plus at least two resolvable slots among theirs
	// (the primary above is slot 1). Junk slots simply don't render, and
	// every other combination (absent, junk, rolled-back settings) falls
	// through to the unchanged single path below.
	const secondaryKey = nonEmptyKey(settings.secondaryReadingKey);
	const layout = drawnKeyLayout(settings);
	if (layout === "quad") {
		return composeQuad(settings, snapshot, referencedSlotKeys(settings), view, returnMark);
	}
	if (layout === "triple") {
		return composeTriple(settings, snapshot, referencedSlotKeys(settings), view, returnMark);
	}
	if (layout === "dual" && secondaryKey !== undefined) {
		return composeDual(settings, snapshot, primaryKey, secondaryKey, view, returnMark);
	}
	const reading = snapshot.byKey.get(primaryKey);
	if (reading === undefined) {
		return renderStatusKey({ ...missingReadingScreen(), returnMark });
	}

	const fahrenheit = settings.fahrenheit === true;
	const mode = isStatMode(settings.statMode) ? settings.statMode : "current";
	const measureOpts = measureFor(measureOptionsFrom(settings), settings.readingFormats, reading);
	const shownValue = statValue(reading, mode);
	const measured = formatMeasurement(shownValue, reading.unit, measureOpts);

	const config = loadThemes();
	const { level, themeId, accent } = primaryContext(settings, reading, view);
	const palette = resolvePalette(config, themeId, accent, level);
	const { background, text } = keyLookOf(settings, palette, effectiveTextFor(settings), level);
	const display = displayModeOf(settings);
	const badge = readingStatBadge(reading, mode);
	// A Trend window draws its time axis; with none, or one the history
	// budget refused, the strip keeps the recent-samples line.
	const window = historyWindowOf(settings);
	const timeline = window === undefined ? undefined : poller.history.view(primaryKey, window, KEY_TREND_WIDTH_PX, now, reading.linkedKeys);
	const band = snoozeBandOf(view, config, palette);
	return renderReadingKey({
		label: keyLabel(settings.label, reading.label),
		valueText: measured.valueText,
		unitText: measured.unitText,
		statBadge: badge,
		// Poller-owned NATIVE ring: the renderer self-normalizes over the
		// samples' own min/max and °C→°F is a positive affine map, so native
		// values draw a pixel-identical sparkline to converted ones (and the
		// shape survives a unit toggle unchanged).
		history: display === "sparkline" && timeline === undefined ? poller.getSeries(primaryKey) : undefined,
		timeline,
		gauge: display === "bar" || display === "ring" ? { kind: display, ...keyGauge(settings, reading, fahrenheit, config, palette.bg) } : undefined,
		palette,
		text,
		returnMark,
		...(band !== undefined ? { snoozeBand: band } : {}),
		...backgroundOption(background),
		...(measureOpts.exact === true ? { exactValue: true, exactFallback: exactFallback(shownValue, reading.unit, measureOpts, false) } : {})
	});
}

/** One reading's options on a key face: the key's own, with the reading's
 * own format when it has one (measureFor returns the key's object itself
 * otherwise, and for a missing reading). */
function slotMeasure(base: MeasureOptions, settings: ReadingSettings, reading: Reading | undefined): MeasureOptions {
	return reading === undefined ? base : measureFor(base, settings.readingFormats, reading);
}

/** The snoozed cue's color, or undefined when no deliberate snooze is
 * silencing anything on the key (the face is then byte for byte what it
 * was). The highest silenced level's alert fill, blended toward the face
 * like a gauge zone. */
function snoozeBandOf(view: KeyAlertView, config: ThemesConfig, palette: Palette): string | undefined {
	const snoozed = view.face.snoozed;
	return snoozed === null ? undefined : mixToward(config.alerts[snoozed].bg, palette.bg, ZONE_BG_BLEND);
}

/** The Trend window a key draws: only the single layout's Sparkline
 * display has one, and only for an exact window value. */
export function historyWindowOf(settings: ReadingSettings): HistoryWindowId | undefined {
	return displayModeOf(settings) === "sparkline" && drawnKeyLayout(settings) === "single" ? parseHistoryWindow(settings.historyWindow) : undefined;
}

/** The effective single-layout display strip; see ReadingSettings.displayMode. */
function displayModeOf(settings: ReadingSettings): "sparkline" | "bar" | "ring" | "none" {
	const mode = settings.displayMode;
	if (mode === "sparkline" || mode === "bar" || mode === "ring" || mode === "none") {
		return mode;
	}
	return settings.sparkline === true ? "sparkline" : "none";
}

/**
 * The Bar/Ring gauge for a single-reading key. Bounds are automatic: percent
 * and yes/no readings get their fixed domains; everything else derives from
 * values actually visited — HWiNFO's own session min/max where trustworthy
 * (Gadget leaves these fields unavailable)
 * plus the poller's observed series — expanded to keep threshold zones
 * inside the visible domain. The fill follows the LIVE value even while the
 * text shows MIN/MAX/AVG, matching the dial bar and alert behavior.
 *
 * The zones follow the limits that apply to the reading: the legacy pair
 * exactly as before, or the reading's own `alertRules` entry moved into the
 * displayed unit (none while that rule stands down on a unit change).
 */
function keyGauge(settings: ReadingSettings, reading: Reading, fahrenheit: boolean, config: ThemesConfig, faceBg: string): { fraction: number; zones: DrawnZone[] } {
	const display = (value: number): number => convertUnit(value, reading.unit, fahrenheit).value;
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const candidate of [reading.valueMin, reading.valueMax, ...(poller.getSeries(reading.key) ?? [])]) {
		if (Number.isFinite(candidate)) {
			min = Math.min(min, candidate);
			max = Math.max(max, candidate);
		}
	}
	const limits = gaugeLimits(settings, reading, fahrenheit);
	const gauge = computeGauge({
		value: display(reading.value),
		evidence: Number.isFinite(min) && Number.isFinite(max) ? { min: display(min), max: display(max) } : undefined,
		unit: reading.unit === "°C" && fahrenheit ? "°F" : reading.unit,
		warn: limits.warn,
		crit: limits.crit,
		alertBelow: limits.below
	});
	return { fraction: gauge.fraction, zones: drawnZones(gauge.zones, config.alerts, faceBg) };
}

/** The gauge zones' limits in the displayed unit: the legacy pair exactly
 * as 1.7.1 read it while no new alert field is set; otherwise the rule the
 * first reading resolves to (its own `alertRules` entry, or the legacy pair
 * moved across °C and °F from the unit it was typed in), moved into the
 * displayed unit, and none while that rule stands down. */
function gaugeLimits(settings: ReadingSettings, reading: Reading, fahrenheit: boolean): { warn?: number; crit?: number; below: boolean } {
	const legacy = { warn: parseThreshold(settings.warnValue), crit: parseThreshold(settings.critValue), below: settings.alertBelow === true };
	if (settings.alertRules === undefined && settings.alertDisplayUnit === undefined) {
		return legacy;
	}
	const rule = ruleFor(parseAlertConfig(settings), "key", reading, 0);
	if (rule === null) {
		return { below: legacy.below };
	}
	const ruleUnit = ruleUnitFor(rule, reading, fahrenheit);
	const shown = convertUnit(reading.value, reading.unit, fahrenheit).unit;
	const moved = (limit: number | undefined): number | undefined => (limit === undefined || ruleUnit === undefined ? undefined : valueInUnit(limit, ruleUnit, shown));
	return { warn: moved(rule.warn), crit: moved(rule.crit), below: rule.below };
}

/** Alert level, theme override and type accent for a key face: the level
 *  is the highest shown over the drawn readings (KeyAlertView.face); the
 *  theme and the accent follow the primary (first) reading. */
function primaryContext(settings: ReadingSettings, primary: Reading | undefined, view: KeyAlertView): { level: AlertLevel; themeId: string; accent: TypeAccentKey | null } {
	const themeId = effectiveThemeFor(settings);
	const accent = primary !== undefined && typeAccentsEnabled() ? classifyTypeAccent(primary.type, primary.unit, primary.label) : null;
	return { level: view.face.level, themeId, accent };
}

/** A row's value color: the alert palette's unit token for a row that
 *  gives way (rowGivesWay), else the shared value color (undefined). */
function rowValueColor(view: KeyAlertView, slot: number, unitColor: string): string | undefined {
	return rowGivesWay(view, slot) ? unitColor : undefined;
}

/**
 * The dual face. The whole key recolors on alert exactly like the single
 * layout, at the highest level its two readings show: with no `alertRules`
 * that is the first reading's legacy alert alone, as in 1.7.1; with rules,
 * a row that is not alerting draws its value in the alert palette's unit
 * color so the alerting row stands out. The type accent comes from the
 * FIRST reading. A row whose reading the snapshot does not publish renders
 * the placeholder glyph instead of tearing down the other, still-live row;
 * both missing is the same "Sensor missing" screen the single layout shows.
 *
 * Stat display: the second row FOLLOWS the first's stat mode unless
 * "Row 2 shows" pins it (so the key press cycles both rows together by
 * default, like the dial's tap switches its whole face). A following row
 * shares ONE badge, centered in the divider gap. A pinned row keeps its own
 * badge on its own label line, and so does the first row beside it, even
 * when both happen to show the same stat: each badge stays put, so a press
 * only ever changes the first row's label line.
 */
function composeDual(settings: ReadingSettings, snapshot: SensorSnapshot, primaryKey: string, secondaryKey: string, view: KeyAlertView, returnMark = false): string {
	const primary = snapshot.byKey.get(primaryKey);
	const secondary = snapshot.byKey.get(secondaryKey);
	if (primary === undefined && secondary === undefined) {
		return renderStatusKey({ ...missingReadingScreen(), returnMark });
	}
	const measureOpts = measureOptionsFrom(settings);
	const config = loadThemes();
	const { level, themeId, accent } = primaryContext(settings, primary, view);
	const palette = resolvePalette(config, themeId, accent, level);
	const { background, text } = keyLookOf(settings, palette, effectiveTextFor(settings), level);
	const topMode = isStatMode(settings.statMode) ? settings.statMode : "current";
	// Absent, "follow", or junk all follow the first row (append-only
	// salvage); only an explicit stat mode pins the second row.
	const pinned = isStatMode(settings.secondaryStatMode);
	const bottomMode = pinned ? (settings.secondaryStatMode as StatMode) : topMode;
	const shared = !pinned || bottomMode === topMode;
	const band = snoozeBandOf(view, config, palette);
	return renderDualKey({
		top: readingRow(primary, topMode, slotMeasure(measureOpts, settings, primary), settings.label, shared ? "" : readingStatBadge(primary ?? secondary, topMode), missingRowLabel(), rowValueColor(view, 0, text.unit)),
		bottom: readingRow(secondary, bottomMode, slotMeasure(measureOpts, settings, secondary), settings.secondaryLabel, shared ? "" : readingStatBadge(secondary, bottomMode), missingRowLabel(), rowValueColor(view, 1, text.unit)),
		sharedBadge: shared ? sharedStatBadge([primary, secondary], topMode) : "",
		palette,
		text,
		returnMark,
		...(band !== undefined ? { snoozeBand: band } : {}),
		...backgroundOption(background)
	});
}

/**
 * The triple face: three compact horizontal rows over the first, second and
 * third sensor slots (the same slots the dual and quad layouts read, so
 * switching layouts keeps every selection). The whole key recolors on
 * alert at the highest level its rows show (the first reading alone with
 * no `alertRules`, as in 1.7.1; with rules, rows that are not alerting give
 * way, as on the dual face); the type accent comes from the FIRST reading.
 * A configured row the snapshot does not publish renders the placeholder
 * glyph; an unconfigured slot renders an empty band; every configured row
 * missing is the same "Sensor missing" screen. Every row shows the same
 * stat (statMode; the key press cycles all rows together), badged once on
 * the first separator. Values format through the normal measurement path:
 * the rows have room for full values, so the quad's 4-glyph compaction
 * would only cost precision.
 */
function composeTriple(settings: ReadingSettings, snapshot: SensorSnapshot, slotKeys: ReadonlyArray<string | undefined>, view: KeyAlertView, returnMark = false): string {
	const readings = slotKeys.map((key) => (key === undefined ? undefined : snapshot.byKey.get(key)));
	if (readings.every((r) => r === undefined)) {
		return renderStatusKey({ ...missingReadingScreen(), returnMark });
	}
	const measureOpts = measureOptionsFrom(settings);
	const config = loadThemes();
	const { level, themeId, accent } = primaryContext(settings, readings[0], view);
	const mode = isStatMode(settings.statMode) ? settings.statMode : "current";
	const palette = resolvePalette(config, themeId, accent, level);
	const { background, text } = keyLookOf(settings, palette, effectiveTextFor(settings), level);
	const customLabels = [settings.label, settings.secondaryLabel, settings.quadLabel3];
	const band = snoozeBandOf(view, config, palette);
	return renderTripleKey({
		rows: slotKeys.map((key, i) => (key === undefined ? null : readingRow(readings[i], mode, slotMeasure(measureOpts, settings, readings[i]), customLabels[i], "", missingRowLabel(), rowValueColor(view, i, text.unit)))),
		sharedBadge: sharedStatBadge(readings, mode),
		palette,
		text,
		returnMark,
		...(band !== undefined ? { snoozeBand: band } : {}),
		...backgroundOption(background)
	});
}

/**
 * The quad face: up to four readouts in a 2x2 grid. On warn/crit (the
 * highest level its cells show; the first reading alone with no
 * `alertRules`, as in 1.7.1) the whole key takes the global alert palette
 * with the slot identity colors ignored, so the alert recolor stays
 * unmistakable; with rules, cells that are not alerting draw their value in
 * the alert palette's unit color. The type accent comes from the FIRST
 * reading. A configured slot the snapshot does not publish renders the
 * placeholder glyph; an unconfigured (or junk) slot renders an empty
 * quadrant; every configured slot missing is the same "Sensor missing"
 * screen.
 *
 * Every slot shows the same stat (statMode; the key press cycles it),
 * badged once at the cross intersection. Per-slot pins are dual-only.
 */
function composeQuad(settings: ReadingSettings, snapshot: SensorSnapshot, slotKeys: ReadonlyArray<string | undefined>, view: KeyAlertView, returnMark = false): string {
	const readings = slotKeys.map((key) => (key === undefined ? undefined : snapshot.byKey.get(key)));
	if (readings.every((r) => r === undefined)) {
		return renderStatusKey({ ...missingReadingScreen(), returnMark });
	}
	const measureOpts = measureOptionsFrom(settings);
	const config = loadThemes();
	const { level, themeId, accent } = primaryContext(settings, readings[0], view);
	const mode = isStatMode(settings.statMode) ? settings.statMode : "current";
	const labeled = settings.quadLabels === true;
	const palette = resolvePalette(config, themeId, accent, level);
	const textSettings = effectiveTextFor(settings);
	const { background, text } = keyLookOf(settings, palette, textSettings, level);
	// Glass resolves the automatic cell hues on its hardest panel.
	const identitySurface = keyIdentitySurface(background, palette);
	// On alert the identity color collapses into the alert palette's own
	// text token (the value in the default variant, the micro-label in the
	// labeled one): the whole key is alert-colored, nothing else survives.
	const alertColor = level !== "normal" ? (labeled ? palette.label : palette.value) : null;
	const colors = quadColorsOf(settings);
	const customLabels = [settings.label, settings.secondaryLabel, settings.quadLabel3, settings.quadLabel4];
	const band = snoozeBandOf(view, config, palette);
	return renderQuadKey({
		cells: slotKeys.map((key, i) => {
			if (key === undefined) return null;
			const givesWay = rowValueColor(view, i, text.unit);
			// The default variant's value IS the cell color; the labeled one
			// keeps its micro-label in the alert token and moves the value.
			const color = givesWay !== undefined && !labeled ? givesWay : (alertColor ?? quadIdentityColor(colors[i] as QuadIdentity, labeled, textSettings, text, identitySurface));
			return quadCell(readings[i], customLabels[i], labeled, mode, slotMeasure(measureOpts, settings, readings[i]), color, labeled ? givesWay : undefined);
		}),
		labels: labeled,
		sharedBadge: sharedStatBadge(readings, mode),
		palette,
		text,
		returnMark,
		...(band !== undefined ? { snoozeBand: band } : {}),
		...backgroundOption(background)
	});
}

function quadCell(reading: Reading | undefined, customLabel: string | undefined, labeled: boolean, mode: StatMode, measureOpts: MeasureOptions, color: string, valueColor?: string): QuadKeyCell {
	// The micro-label falls back to the reading label's first word; the
	// renderer hard-cuts to 4 code points and uppercases either source.
	const fallbackLabel = reading === undefined ? "" : (reading.label.split(" ")[0] ?? "");
	const label = labeled ? keyLabel(customLabel, fallbackLabel) : "";
	const own = valueColor === undefined ? {} : { valueColor };
	if (reading === undefined) {
		// The one permitted em dash: the key face's "no value" placeholder.
		return { label, valueText: "—", unitText: "", color, ...own };
	}
	const value = statValue(reading, mode);
	const measured = formatQuadMeasurement(value, reading.unit, measureOpts);
	return { label, valueText: measured.valueText, unitText: measured.unitText, color, ...own, ...(measureOpts.exact === true ? { exact: true, fallback: exactFallback(value, reading.unit, measureOpts, true) } : {}) };
}
