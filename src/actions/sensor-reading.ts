/**
 * "Sensor Reading" key action — shows one live HWiNFO reading with optional
 * thresholds, stat modes and a sparkline. Pressing the key cycles the stat
 * mode (current → min → max → avg).
 */
import streamDeck, { action, SingletonAction, type DidReceiveSettingsEvent, type KeyAction, type KeyDownEvent, type KeyUpEvent, type SendToPluginEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { readingRow } from "../detail/detail-faces";
import { detailMirrorBackOf, detailRoleOf, isWorkspaceBack, pressBehaviorOf, workspacePageOf } from "../detail/detail-settings";
import { PressEngine } from "../detail/press-engine";
import { tickSignature } from "../detail/tick-signature";
import type { DetailNavigator, DeviceDetailState } from "../detail/navigation";
import { deviceCapabilities } from "../devices";
import { buildThemesPayload, handlePiRequest, pushPreviewToPi } from "../pi-protocol";
import { poller, type PollerStatus } from "../poller";
import type { Reading, SensorSnapshot } from "../hwinfo/types";
import { alertLevel, convertUnit, isStatMode, nextStatMode, parseThreshold, STAT_BADGE, statValue, type AlertLevel, type DecimalsSetting, type StatMode } from "../ui/format";
import { computeGauge, drawnZones } from "../ui/gauge";
import { formatMeasurement, formatQuadMeasurement, type MeasureOptions } from "../ui/measure";
import { QUAD_DEFAULT_COLORS, renderDualKey, renderQuadKey, renderReadingKey, renderStatusKey, renderTripleKey, type DrawnZone, type QuadKeyCell } from "../ui/key-renderer";
import { renderDetailIdleBackKey } from "../ui/detail-renderer";
import { keyLabel, missingReadingScreen, noSelectionScreen, statusScreen } from "../ui/state-screens";
import { quadIdentityColor, resolveTextColors } from "../ui/text-colors";
import { decideLegacyDefault, effectiveTextFor, effectiveThemeFor, measureOptionsFrom, onThemeChange, typeAccentsEnabled } from "../ui/theme-store";
import { classifyTypeAccent, loadThemes, resolvePalette, type ThemesConfig, type TypeAccentKey } from "../ui/themes";

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
	warnValue?: string;
	critValue?: string;
	alertBelow?: boolean;
	/** Per-key theme override; empty/absent follows the deck default. */
	theme?: string;
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
	 * profile), "tap-cycle-hold-details" (short tap cycles, a held press
	 * opens details), or "open-workspace" (switch to one page of the
	 * bundled freeform workspace profile). Absent or unrecognized values
	 * behave exactly as cycle-stat, so rolled-back and hand-edited
	 * profiles never break.
	 */
	pressBehavior?: string;
	/** Which workspace page an "open-workspace" press shows, zero-indexed.
	 * The panel's select writes strings ("0".."3"); bare numbers count
	 * the same, junk degrades to page 0, and integers outside the shipped
	 * range clamp to the nearest page (see workspacePageOf). */
	workspacePage?: string;
	/** What the detail view lists: "source" (every reading of this
	 * sensor's HWiNFO source, the default), "custom" (detailKeys), or
	 * "filter" (readings matching the detailFilter glob). */
	detailMode?: string;
	/** Custom detail list: stable reading keys in display order. */
	detailKeys?: string[];
	/** Optional title for the detail view's title tile. */
	detailTitle?: string;
	/** Readings per detail tile: "2", "3" or "4" stack that many readings
	 * on each tile of the view (dual, triple and quad faces); anything
	 * else keeps the original one-reading tiles. The panel's select
	 * writes strings; the parser also takes the bare numbers. */
	detailDensity?: string;
	/** Exactly true: inside the view, the reading slot on this key's own
	 * cell doubles as a second Back (the mirror). Off by default: one
	 * movable Back beat two fixed ones for the issue #5 testers. */
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
	 * Baked into every workspace page's Back cell, and nowhere else. It
	 * exists only so the runtime can tell a workspace page's Back from a
	 * detail page's otherwise identical one; nothing writes it, and a
	 * value other than exactly true is not a workspace Back.
	 */
	workspaceBack?: boolean;
};

type InstanceState = {
	settings: ReadingSettings;
	/** The reading key this instance is subscribed to in the poller's sparkline
	 *  store (undefined when nothing is selected). */
	subscribedKey: string | undefined;
	/** Last SVG sent — identical frames are skipped. */
	lastSvg: string;
};

/** Settings are untyped JSON at runtime: anything but a non-empty string
 *  degrades to unset (no selection, no second reading, or an unconfigured
 *  quad slot rendered as an empty quadrant, never an error). */
function nonEmptyStringOf(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

const QUAD_HEX = /^#[0-9A-Fa-f]{6}$/;

/** Per-entry salvage of the quad identity colors: each slot independently
 *  keeps a valid #RRGGBB override or falls back to that slot's default, so
 *  one hand-edited bad hex costs exactly one cell. */
function quadColorsOf(settings: ReadingSettings): readonly [string, string, string, string] {
	const raw: unknown = settings.quadColors;
	const entries: readonly unknown[] = Array.isArray(raw) ? raw : [];
	return QUAD_DEFAULT_COLORS.map((fallback, i) => {
		const entry = entries[i];
		return typeof entry === "string" && QUAD_HEX.test(entry) ? entry : fallback;
	}) as unknown as readonly [string, string, string, string];
}

@action({ UUID: "com.lawrensen.hwinfo.reading" })
export class SensorReadingAction extends SingletonAction<ReadingSettings> {
	private readonly instances = new Map<string, InstanceState>();
	/** Tap-vs-hold sessions for the "tap cycles; hold opens" behavior. */
	private readonly presses = new PressEngine((contextId, outcome) => {
		void (outcome === "hold" ? this.openDetails(contextId) : this.cycleStat(contextId));
	});

	constructor(private readonly detailNavigator: DetailNavigator) {
		super();
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
				pushPreviewToPi(poller.getStatus(), this.manifestId, this.instances, true);
			}
		});
	}

	override onWillAppear(ev: WillAppearEvent<ReadingSettings>): void {
		// Stream Deck can replay willAppear for a context without an intervening
		// willDisappear (reconnect, wake) — retain + subscribe only on the first
		// sighting, and carry the existing subscription across a replay so the
		// sparkline history (now owned by the poller) is never dropped.
		streamDeck.logger.debug(`Key appeared on ${ev.action.device.name}${ev.action.isKey() && ev.action.coordinates !== undefined ? ` at ${ev.action.coordinates.column},${ev.action.coordinates.row}` : ""} (${ev.action.id})`);
		const existing = this.instances.get(ev.action.id);
		const firstSighting = existing === undefined;
		if (firstSighting) {
			poller.retain();
		}
		decideLegacyDefault(looksConfiguredForLegacyProbe(ev.payload.settings));
		const key = nonEmptyStringOf(ev.payload.settings.readingKey);
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
		this.instances.set(ev.action.id, {
			settings: ev.payload.settings,
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
		this.renderAll(poller.getStatus(), ev.action.id);
	}

	override onWillDisappear(ev: WillDisappearEvent<ReadingSettings>): void {
		// A key that vanishes mid-press (profile switch, page nav) must never
		// fire a late hold or tap — the session dies with the visibility.
		this.presses.cancel(ev.action.id);
		if (this.instances.delete(ev.action.id)) {
			// The ring stays tracked: history keeps collecting off-screen while
			// anything else keeps the poller alive, and paging back resumes the
			// line from the samples it already had.
			poller.release();
		}
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<ReadingSettings>): void {
		const state = this.instances.get(ev.action.id);
		if (state === undefined) {
			return;
		}
		// Track the new reading's ring when the sensor changes; the old ring
		// stays warm in the poller. A °C/°F change resets nothing: the poller
		// stores native values, so the drawn shape is unit-invariant and the
		// history carries across.
		const nextSub = nonEmptyStringOf(ev.payload.settings.readingKey);
		if (state.subscribedKey !== nextSub) {
			if (nextSub !== undefined) {
				poller.subscribeSeries(nextSub);
			}
			state.subscribedKey = nextSub;
		}
		state.settings = ev.payload.settings;
		if (detailRoleOf(state.settings) === "back") {
			// A visible key that became a Back tile mid-press must not
			// resolve its armed tap/hold session under the new role.
			this.presses.cancel(ev.action.id);
		}
		this.renderAll(poller.getStatus(), ev.action.id);
	}

	/**
	 * Key press behavior (issue #5). A baked Back role wins outright: the
	 * press asks the navigator for the previous profile and nothing else
	 * (no stat cycle, no detail entry, no tap/hold arming). Otherwise the
	 * default "cycle-stat" keeps the original semantics exactly: cycle
	 * current → min → max → avg on key DOWN. "open-details" enters the
	 * detail view on key down instead, "open-workspace" switches to the
	 * key's configured workspace page, and "tap-cycle-hold-details" arms
	 * the press engine (tap cycles on release, a 500 ms hold opens details
	 * once). Malformed or future pressBehavior values take the cycle-stat
	 * path.
	 */
	override async onKeyDown(ev: KeyDownEvent<ReadingSettings>): Promise<void> {
		const state = this.instances.get(ev.action.id);
		if (state === undefined) {
			return;
		}
		if (detailRoleOf(state.settings) === "back") {
			// Any stale tap/hold session dies first so its timer can never
			// fire a ghost hold; the navigator stays the only authority for
			// profile navigation (device-scoped, debounced).
			this.presses.cancel(ev.action.id);
			await this.detailNavigator.leave(ev.action.device.id);
			return;
		}
		const behavior = pressBehaviorOf(state.settings);
		if (behavior === "open-details") {
			await this.openDetails(ev.action.id);
			return;
		}
		if (behavior === "open-workspace") {
			await this.openWorkspace(ev.action.id);
			return;
		}
		if (behavior === "tap-cycle-hold-details") {
			this.presses.keyDown(ev.action.id);
			return;
		}
		await this.cycleStat(ev.action.id);
	}

	override onKeyUp(ev: KeyUpEvent<ReadingSettings>): void {
		const state = this.instances.get(ev.action.id);
		if (state !== undefined && detailRoleOf(state.settings) === "back") {
			// A Back tile's release does nothing; cancel defensively so a
			// session armed before the role arrived can never resolve as a
			// tap under the new role.
			this.presses.cancel(ev.action.id);
			return;
		}
		// Resolves only an armed tap/hold session; a no-session keyUp (the
		// other behaviors, or a press that outlived its key) is a no-op.
		this.presses.keyUp(ev.action.id);
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
			// The opener's own cell: a detail reading slot on the same cell
			// becomes the mirror Back tile (tap in, tap out, one finger).
			// Opt-in per key; without it the cell is simply not captured and
			// the whole mirror path stays inert.
			openerCell: detailMirrorBackOf(state.settings) && act.coordinates !== undefined ? { column: act.coordinates.column, row: act.coordinates.row } : undefined
		});
		if (result !== "entered") {
			streamDeck.logger.info(`Detail entry ${result} (device type ${caps.type ?? "unknown"})`);
			await act.showAlert();
		}
	}

	/**
	 * Opens the key's configured workspace page on this key's device. The
	 * same refusal contract as openDetails: every refusal keeps the key
	 * exactly as it was and shows the alert cue, and the log names the
	 * device type, never a sensor. The page index is parsed here (salvage
	 * plus clamp) and passed EXPLICITLY so the app can never substitute a
	 * remembered page.
	 */
	private async openWorkspace(contextId: string): Promise<void> {
		const state = this.instances.get(contextId);
		const act = this.actionById(contextId);
		if (state === undefined || act === undefined) {
			return;
		}
		const deviceId = act.device.id;
		const caps = deviceCapabilities.get(deviceId);
		const result = await this.detailNavigator.enterWorkspace({
			deviceId,
			deviceType: caps.type,
			grid: { columns: caps.columns, rows: caps.rows },
			page: workspacePageOf(state.settings)
		});
		if (result !== "entered") {
			streamDeck.logger.info(`Workspace entry ${result} (device type ${caps.type ?? "unknown"})`);
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
		handlePiRequest(ev.payload);
	}

	private lastTickSignature = "";

	private onPollerTick(status: PollerStatus): void {
		// The sparkline rings are filled by the poller now (once per fresh
		// snapshot, keyed by reading) so it survives this action's appear churn —
		// here we only render and feed the open PI's live preview.
		// Same gate as DetailController: an unchanged tick signature means every
		// key face would compose to the bytes the dedupe already holds, so skip
		// the compose itself, not just the setImage. Theme flips, settings
		// receipts, appears and detail-session changes repaint through their own
		// renderAll calls, never through this gate.
		const signature = tickSignature(status);
		if (signature !== this.lastTickSignature) {
			this.lastTickSignature = signature;
			this.renderAll(status);
		}
		pushPreviewToPi(status, this.manifestId, this.instances, true);
	}

	/** Repaint hook for detail-state changes (enter, leave, cleanup): a
	 * Back tile's fallback face follows the device session, so it repaints
	 * on the same signal the hidden slots do, not only on the next tick.
	 * Frame dedupe makes a no-change call cost nothing. */
	repaint(): void {
		this.renderAll(poller.getStatus());
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
			const svg = this.composeFor(state, act.device.id, status);
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
	private composeFor(state: InstanceState, deviceId: string, status: PollerStatus): string {
		if (detailRoleOf(state.settings) !== "back") {
			return compose(state.settings, status);
		}
		return backTileFace(state.settings, this.detailNavigator.stateFor(deviceId), status);
	}
}

/**
 * Whether a settings blob looks like a CONFIGURED key, for the legacy-theme
 * migration probe only. Both managed families bake a navigation marker into
 * their profiles (detailRole on every detail and workspace Back,
 * workspaceBack on the workspace one), so a first launch that happens to
 * start on one of those pages must not read as a pre-theme install and
 * migrate a fresh install onto the legacy graphite theme.
 *
 * Exported so the exclusion list is pinned by test rather than by comment:
 * every future baked marker has to be added here, and forgetting one is
 * silent and user-visible.
 */
export function looksConfiguredForLegacyProbe(settings: Record<string, unknown>): boolean {
	return Object.entries(settings).some(([key, v]) => key !== "detailRole" && key !== "workspaceBack" && v !== undefined);
}

/**
 * The face a Back-role tile shows. Its own configured reading wins; a
 * WORKSPACE Back always falls back to the honest idle face, because it
 * belongs to no detail session and the fallback below is keyed on the
 * DEVICE, so an unconfirmed session left on this deck (an install prompt
 * still open, or one that expired) would otherwise lend the workspace
 * page's only way out an abandoned opener's live sensor face. A detail
 * Back with no session shows the same idle face. Exported so the face
 * rules are testable without the action instance.
 */
export function backTileFace(settings: ReadingSettings, detail: DeviceDetailState | undefined, status: PollerStatus): string {
	if (nonEmptyStringOf(settings.readingKey) !== undefined) {
		return compose(settings, status, true);
	}
	if (isWorkspaceBack(settings) || detail === undefined) {
		return renderDetailIdleBackKey();
	}
	return compose(backFallbackSettings(detail), status, true);
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
		warnValue: p.warnValue,
		critValue: p.critValue,
		alertBelow: p.alertBelow
	};
}

/**
 * One key face from settings alone. `returnMark` rides every layout and
 * status screen (the Back tile is this same composition with the hook);
 * false keeps every output byte-identical to the pre-role renderer.
 * Exported so the fallback's byte-equivalence to the hidden slot's
 * composeBackFace is provable against the REAL path, not a copy.
 */
export function compose(settings: ReadingSettings, status: PollerStatus, returnMark = false): string {
	const screen = statusScreen(status);
	if (screen !== null) {
		return renderStatusKey({ ...screen, returnMark });
	}
	const { snapshot } = status as Extract<PollerStatus, { state: "ok" }>;
	const primaryKey = nonEmptyStringOf(settings.readingKey);
	if (primaryKey === undefined) {
		return renderStatusKey({ ...noSelectionScreen(), returnMark });
	}
	// The dual layout needs BOTH the exact "dual" marker and a usable second
	// reading; every other combination (absent, junk, rolled-back settings)
	// falls through to the unchanged single path below.
	const secondaryKey = nonEmptyStringOf(settings.secondaryReadingKey);
	// The quad grid needs the exact "quad" marker plus at least two
	// resolvable slots; the primary above is slot 1, so one more of slots
	// 2-4 must parse. Junk slots simply don't render. With only the primary
	// left, the marker degrades along the dual rules (not "dual", and no
	// second reading either way) onto the unchanged single path below.
	if (settings.keyLayout === "quad") {
		const slotKeys = [primaryKey, secondaryKey, nonEmptyStringOf(settings.quadReadingKey3), nonEmptyStringOf(settings.quadReadingKey4)];
		if (slotKeys.filter((k) => k !== undefined).length >= 2) {
			return composeQuad(settings, snapshot, slotKeys, returnMark);
		}
	}
	// Same gate as the quad above, over its first three slots.
	if (settings.keyLayout === "triple") {
		const slotKeys = [primaryKey, secondaryKey, nonEmptyStringOf(settings.quadReadingKey3)];
		if (slotKeys.filter((k) => k !== undefined).length >= 2) {
			return composeTriple(settings, snapshot, slotKeys, returnMark);
		}
	}
	if (settings.keyLayout === "dual" && secondaryKey !== undefined) {
		return composeDual(settings, snapshot, primaryKey, secondaryKey, returnMark);
	}
	const reading = snapshot.byKey.get(primaryKey);
	if (reading === undefined) {
		return renderStatusKey({ ...missingReadingScreen(), returnMark });
	}

	const fahrenheit = settings.fahrenheit === true;
	const mode = isStatMode(settings.statMode) ? settings.statMode : "current";
	const measureOpts = measureOptionsFrom(settings);
	const measured = formatMeasurement(statValue(reading, mode), reading.unit, measureOpts);

	const config = loadThemes();
	const { level, themeId, accent } = primaryContext(settings, reading, fahrenheit);
	const palette = resolvePalette(config, themeId, accent, level);
	const text = resolveTextColors(palette, effectiveTextFor(settings), level);
	const display = displayModeOf(settings);
	const badge = STAT_BADGE[mode];
	return renderReadingKey({
		label: keyLabel(settings.label, reading.label),
		valueText: measured.valueText,
		unitText: measured.unitText,
		statBadge: badge,
		// Poller-owned NATIVE ring: the renderer self-normalizes over the
		// samples' own min/max and °C→°F is a positive affine map, so native
		// values draw a pixel-identical sparkline to converted ones (and the
		// shape survives a unit toggle unchanged).
		history: display === "sparkline" ? poller.getSeries(primaryKey) : undefined,
		gauge: display === "bar" || display === "ring" ? { kind: display, ...keyGauge(settings, reading, fahrenheit, config, palette.bg) } : undefined,
		palette,
		text,
		returnMark
	});
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
 * (the gadget source reports min = max = value, which the union neutralizes)
 * plus the poller's observed series — expanded to keep threshold zones
 * inside the visible domain. The fill follows the LIVE value even while the
 * text shows MIN/MAX/AVG, matching the dial bar and alert behavior.
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
	const gauge = computeGauge({
		value: display(reading.value),
		evidence: Number.isFinite(min) && Number.isFinite(max) ? { min: display(min), max: display(max) } : undefined,
		unit: reading.unit === "°C" && fahrenheit ? "°F" : reading.unit,
		warn: parseThreshold(settings.warnValue),
		crit: parseThreshold(settings.critValue),
		alertBelow: settings.alertBelow === true
	});
	return { fraction: gauge.fraction, zones: drawnZones(gauge.zones, config.alerts, faceBg) };
}

/** Alert level, theme override and type accent for a key face; all three
 *  follow the primary (first) reading, whatever the layout. */
function primaryContext(settings: ReadingSettings, primary: Reading | undefined, fahrenheit: boolean): { level: AlertLevel; themeId: string; accent: TypeAccentKey | null } {
	const level =
		primary !== undefined
			? alertLevel(convertUnit(primary.value, primary.unit, fahrenheit).value, parseThreshold(settings.warnValue), parseThreshold(settings.critValue), settings.alertBelow === true)
			: "normal";
	const themeId = effectiveThemeFor(settings);
	const accent = primary !== undefined && typeAccentsEnabled() ? classifyTypeAccent(primary.type, primary.unit, primary.label) : null;
	return { level, themeId, accent };
}

/**
 * The dual face. Alerts and the type accent come from the FIRST reading only
 * (per-second-row thresholds are deliberately out of scope), and the whole
 * key recolors on alert exactly like the single layout. A row whose reading
 * the snapshot does not publish renders the placeholder glyph instead of
 * tearing down the other, still-live row; both missing is the same
 * "Sensor missing" screen the single layout shows.
 *
 * Stat display: the second row FOLLOWS the first's stat mode unless
 * "Second shows" pins it (so the key press cycles both rows together by
 * default, like the dial's tap switches its whole face). When both rows
 * show the same stat, ONE badge sits centered in the divider gap and the
 * labels keep their full width; only rows whose stat differs carry their
 * own badge, inline after the unit.
 */
function composeDual(settings: ReadingSettings, snapshot: SensorSnapshot, primaryKey: string, secondaryKey: string, returnMark = false): string {
	const primary = snapshot.byKey.get(primaryKey);
	const secondary = snapshot.byKey.get(secondaryKey);
	if (primary === undefined && secondary === undefined) {
		return renderStatusKey({ ...missingReadingScreen(), returnMark });
	}
	const fahrenheit = settings.fahrenheit === true;
	const measureOpts = measureOptionsFrom(settings);
	const { level, themeId, accent } = primaryContext(settings, primary, fahrenheit);
	const palette = resolvePalette(loadThemes(), themeId, accent, level);
	const topMode = isStatMode(settings.statMode) ? settings.statMode : "current";
	// Absent, "follow", or junk all follow the first row (append-only
	// salvage); only an explicit stat mode pins the second row.
	const bottomMode = isStatMode(settings.secondaryStatMode) ? settings.secondaryStatMode : topMode;
	const shared = topMode === bottomMode;
	return renderDualKey({
		top: readingRow(primary, topMode, measureOpts, settings.label, shared ? "" : STAT_BADGE[topMode]),
		bottom: readingRow(secondary, bottomMode, measureOpts, settings.secondaryLabel, shared ? "" : STAT_BADGE[bottomMode]),
		sharedBadge: shared ? STAT_BADGE[topMode] : "",
		palette,
		text: resolveTextColors(palette, effectiveTextFor(settings), level),
		returnMark
	});
}

/**
 * The triple face: three compact horizontal rows over the first, second and
 * third sensor slots (the same slots the dual and quad layouts read, so
 * switching layouts keeps every selection). Alerts and the type accent come
 * from the FIRST reading only and the whole key recolors on alert, exactly
 * like the other multi-reading layouts. A configured row the snapshot does
 * not publish renders the placeholder glyph; an unconfigured slot renders an
 * empty band; every configured row missing is the same "Sensor missing"
 * screen. Every row shows the same stat (statMode; the key press cycles all
 * rows together), badged once on the first separator. Values format through
 * the normal measurement path — the rows have room for full values, so the
 * quad's 4-glyph compaction would only cost precision.
 */
function composeTriple(settings: ReadingSettings, snapshot: SensorSnapshot, slotKeys: ReadonlyArray<string | undefined>, returnMark = false): string {
	const readings = slotKeys.map((key) => (key === undefined ? undefined : snapshot.byKey.get(key)));
	if (readings.every((r) => r === undefined)) {
		return renderStatusKey({ ...missingReadingScreen(), returnMark });
	}
	const fahrenheit = settings.fahrenheit === true;
	const measureOpts = measureOptionsFrom(settings);
	const { level, themeId, accent } = primaryContext(settings, readings[0], fahrenheit);
	const mode = isStatMode(settings.statMode) ? settings.statMode : "current";
	const palette = resolvePalette(loadThemes(), themeId, accent, level);
	const customLabels = [settings.label, settings.secondaryLabel, settings.quadLabel3];
	return renderTripleKey({
		rows: slotKeys.map((key, i) => (key === undefined ? null : readingRow(readings[i], mode, measureOpts, customLabels[i]))),
		sharedBadge: STAT_BADGE[mode],
		palette,
		text: resolveTextColors(palette, effectiveTextFor(settings), level),
		returnMark
	});
}

/**
 * The quad face: up to four readouts in a 2x2 grid. Alerts and the type
 * accent come from the FIRST reading only, exactly like the dual layout,
 * and on warn/crit the whole key takes the global alert palette with the
 * slot identity colors ignored, so the alert recolor stays unmistakable.
 * A configured slot the snapshot does not publish renders the placeholder
 * glyph; an unconfigured (or junk) slot renders an empty quadrant; every
 * configured slot missing is the same "Sensor missing" screen.
 *
 * Every slot shows the same stat (statMode; the key press cycles it),
 * badged once at the cross intersection. Per-slot pins are dual-only.
 */
function composeQuad(settings: ReadingSettings, snapshot: SensorSnapshot, slotKeys: ReadonlyArray<string | undefined>, returnMark = false): string {
	const readings = slotKeys.map((key) => (key === undefined ? undefined : snapshot.byKey.get(key)));
	if (readings.every((r) => r === undefined)) {
		return renderStatusKey({ ...missingReadingScreen(), returnMark });
	}
	const fahrenheit = settings.fahrenheit === true;
	const measureOpts = measureOptionsFrom(settings);
	const primary = readings[0];
	const { level, themeId, accent } = primaryContext(settings, primary, fahrenheit);
	const mode = isStatMode(settings.statMode) ? settings.statMode : "current";
	const labeled = settings.quadLabels === true;
	const palette = resolvePalette(loadThemes(), themeId, accent, level);
	const textSettings = effectiveTextFor(settings);
	const text = resolveTextColors(palette, textSettings, level);
	// On alert the identity color collapses into the alert palette's own
	// text token (the value in the default variant, the micro-label in the
	// labeled one): the whole key is alert-colored, nothing else survives.
	const alertColor = level !== "normal" ? (labeled ? palette.label : palette.value) : null;
	const colors = quadColorsOf(settings);
	const customLabels = [settings.label, settings.secondaryLabel, settings.quadLabel3, settings.quadLabel4];
	return renderQuadKey({
		cells: slotKeys.map((key, i) => (key === undefined ? null : quadCell(readings[i], customLabels[i], labeled, mode, measureOpts, alertColor ?? quadIdentityColor(colors[i] as string, labeled, textSettings, text, palette)))),
		labels: labeled,
		sharedBadge: STAT_BADGE[mode],
		palette,
		text,
		returnMark
	});
}

function quadCell(reading: Reading | undefined, customLabel: string | undefined, labeled: boolean, mode: StatMode, measureOpts: MeasureOptions, color: string): QuadKeyCell {
	// The micro-label falls back to the reading label's first word; the
	// renderer hard-cuts to 4 code points and uppercases either source.
	const fallbackLabel = reading === undefined ? "" : (reading.label.split(" ")[0] ?? "");
	const label = labeled ? keyLabel(customLabel, fallbackLabel) : "";
	if (reading === undefined) {
		// The one permitted em dash: the key face's "no value" placeholder.
		return { label, valueText: "—", unitText: "", color };
	}
	const measured = formatQuadMeasurement(statValue(reading, mode), reading.unit, measureOpts);
	return { label, valueText: measured.valueText, unitText: measured.unitText, color };
}
