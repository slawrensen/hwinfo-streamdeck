/**
 * Device-scoped drill-down navigation. One state per physical Stream
 * Deck: two connected decks can show different groups on different pages
 * at the same time, and disconnecting one cancels only its own session.
 *
 * The SDK is injected (switchProfile), never imported: entry switches the
 * device to its class's bundled detail profile, Back restores the
 * previous profile by OMITTING the profile name (the SDK's single-level
 * previous-profile hop), and pagination never switches profiles at all —
 * it only moves plugin state inside the one active page.
 */
import type { JsonValue } from "@elgato/utils";

import { monotonicNow } from "../clock";
import type { SnapshotSource } from "../hwinfo/provider";
import type { SensorSnapshot } from "../hwinfo/types";
import { referencedSlotKeys } from "../alerts/key-alerts";
import { stampForLimitsCopy } from "../alerts/rules";
import { isStatMode, nextStatMode, type DecimalsSetting, type StatMode } from "../ui/format";
import { formatsForKeys } from "../ui/reading-format";
import { pageOf, projectDetailTiles, resolveDetailGroup, type DetailGroup, type DetailGroupSettings, type DetailPage } from "./detail-group";
import { detailSourceOf, type DetailSource } from "./detail-scope";
import { detailDensityOf, detailGapsOf, detailModeOf, detailTilesOf, type DetailDensity, type DetailTileSpec } from "./detail-settings";
import { detailProfileFor, readingSlotCapacity, type ManagedDetailProfile, type SlotCell } from "./managed-profiles";
import { gapSignature, reservedSlotsFor } from "./placement";

/** The opener's formats a detail session carries: the entries the key face
 * itself can find for the readings it draws, that is under each slot's
 * saved key and under every key of that slot reading's own walk (its key,
 * then its confirmed aliases, as readingFormatEntryOf looks), so an entry
 * filed under a linked spelling formats the tiles and the Back tile exactly
 * as it formats the key. Nothing when there are none. */
function formatsPresentation(settings: Parameters<typeof referencedSlotKeys>[0] & { readingFormats?: JsonValue }, snapshot: SensorSnapshot | null): { readingFormats?: JsonValue } {
	const keys: (string | undefined)[] = [];
	for (const slot of referencedSlotKeys(settings)) {
		if (slot === undefined) continue;
		keys.push(slot);
		const reading = snapshot?.byKey.get(slot);
		if (reading !== undefined) keys.push(reading.key, ...(reading.linkedKeys ?? []));
	}
	const carried = formatsForKeys(settings.readingFormats, keys);
	return carried === undefined ? {} : { readingFormats: carried as JsonValue };
}

export type SwitchProfileFn = (deviceId: string, profileName?: string, page?: number) => Promise<void>;

/** The opener's presentation, carried verbatim onto the detail surface
 *  (the Back tile keeps thresholds; reading slots deliberately don't). */
export type DetailPresentation = {
	readonly label?: string;
	readonly decimals?: DecimalsSetting;
	readonly fahrenheit?: boolean;
	readonly theme?: string;
	readonly textMode?: string;
	readonly textColor?: string;
	readonly textDimSecondary?: boolean;
	/** The opener's key look and accent words, carried verbatim (read only
	 * through keyBackgroundOf and keyAccentWordsOf): the detail tiles draw
	 * in the opener's look as they draw in its theme. */
	readonly keyBackground?: string;
	readonly keyAccentWords?: boolean;
	/** The opener's Sky (its keyStars and keySkyColor), carried verbatim
	 * (read only through keySkyFor). */
	readonly keyStars?: string;
	readonly keySkyColor?: string;
	readonly warnValue?: string;
	readonly critValue?: string;
	readonly alertBelow?: boolean;
	/** The opener's per-reading limits and its stamped display unit, for
	 * the Back tile's stateless fallback (the same rule resolution the key
	 * face uses); carried verbatim, never parsed here. */
	readonly alertRules?: JsonValue;
	readonly alertDisplayUnit?: JsonValue;
	/** What alertDisplayUnit was saved with (rules.ts stampedDisplayUnit). */
	readonly alertDisplayUnitFor?: JsonValue;
	/** The opener's per-reading formats (issue #59), only the entries the
	 * key face can find for the readings it draws (each slot's saved key and
	 * that reading's own key walk, formatsPresentation at entry), carried as
	 * stored and resolved by the faces like the key resolves them. */
	readonly readingFormats?: JsonValue;
};

export type DeviceDetailState = {
	readonly deviceId: string;
	readonly pageSize: number;
	/** Readings per tile for this session (the opener's detailDensity). */
	readonly density: DetailDensity;
	/** The hand-grouped tile plan (custom mode only): explicit sizes and
	 *  per-tile dressing walked over the list, before the uniform fill. */
	readonly tilePlan: readonly DetailTileSpec[];
	readonly primaryKey: string;
	/** The opener's group settings, kept for source-mode re-resolution. */
	readonly groupSettings: DetailGroupSettings;
	readonly presentation: DetailPresentation;
	/** Last valid resolution; ridden on while HWiNFO restarts (transient
	 *  recovery), replaced whenever the primary resolves again. */
	group: DetailGroup;
	/** The opener key's grid cell on ITS profile, captured while the
	 *  mirror is on (detailMirrorBack, the default; exactly false skips
	 *  the capture): a detail reading slot at the same cell then becomes
	 *  a second Back tile, so the finger that pressed in presses right
	 *  back out. Null = no mirror. */
	readonly openerCell: { readonly column: number; readonly row: number } | null;
	/** The reading-slot index acting as the mirror Back (controller-fed
	 *  from the registered slots' coordinates); null = no mirror. */
	mirrorSlotIndex: number | null;
	/** The action context of the key that opened the view, so the Back
	 *  tile shows that key's live alert state (dwell, recovery, snooze)
	 *  rather than a stateless comparison. Absent when unknown. */
	readonly openerContext?: string;
	offset: number;
	/** Ephemeral per-reading stat modes for this detail session. */
	readonly statModes: Map<string, StatMode>;
	/** The bundle this session runs on; the opener's intentional empty
	 *  cells are kept per bundle. Absent on states built outside enter(). */
	readonly bundle?: ManagedDetailProfile["key"];
	/** The opener's intentional empty cells on that bundle, per logical
	 *  page (detailGaps, captured at entry like every other list knob).
	 *  Absent or empty = the original flow. */
	readonly gapCells?: readonly (readonly SlotCell[])[];
	/** Reading-slot index per registered cell ("column,row"), fed by the
	 *  controller from the slots' own coordinates, so a gap follows the
	 *  slot the user sees at that position even on a page whose slot
	 *  actions were moved. */
	slotIndexByCell?: ReadonlyMap<string, number>;
	/** The source of the opener's own reading, as detailScope names it;
	 *  undefined until the reading resolves. Re-resolved on fresh data and
	 *  kept while it does not resolve, like the group. */
	openerSource?: DetailSource;
	/** Registered visible detail slots on this device (controller-fed). */
	surfaceCount: number;
	/** True until the first detail slot appears after the switch. */
	pending: boolean;
	/** When this session's switch was dispatched (deps.now clock). A second
	 *  entry inside the app's switch beat is refused, not re-dispatched: the
	 *  app may record "previous" on a same-profile switch, which would turn
	 *  Back into a self-loop. */
	readonly dispatchedAt: number;
};

export type EnterResult = "entered" | "unsupported" | "unresolved" | "switch-failed" | "already-active";

type NavigatorDeps = {
	switchProfile: SwitchProfileFn;
	/** Re-render hook; fired after any state change for a device. */
	onChanged?: (deviceId: string) => void;
	/** SYNCHRONOUS repaint hook fired by leave() BEFORE the restore is
	 *  dispatched. Frames sent after switchToProfile land on a profile the
	 *  app is already tearing down and never reach its per-key image cache
	 *  (hardware-observed), so the blackout must beat the switch onto the
	 *  wire or the next entry replays stale faces. */
	onLeaving?: (deviceId: string) => void;
	log?: { info(msg: string): void; warn(msg: string): void };
	/** Entry never confirmed by an appearing slot after this long: drop it. */
	pendingExpiryMs?: number;
	/** Every slot gone this long without Back (manual profile change): drop. */
	disappearGraceMs?: number;
	setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
	clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
	/** Clock for the entry and leave debounces and the expired-prompt
	 * tombstones: monotonic by default, so a wall-clock correction never lets
	 * a second hop through or stalls Back (external review AX49); tests
	 * inject a manual one. */
	now?: () => number;
};

const PENDING_EXPIRY_MS = 30_000;
const DISAPPEAR_GRACE_MS = 2_500;

/** Repeat Back presses inside this window are one hop, not two: the app
 * takes a beat to actually switch, and a double-tap during it would hop
 * "previous" twice (the second hop from the detail profile itself). The
 * same window guards repeat ENTRIES: a double-tapped opener must not
 * dispatch a second switch while the first is still landing. */
const LEAVE_DEBOUNCE_MS = 1_500;

/** How long after a pending expiry a late-appearing surface still means
 * "the user finally accepted the install prompt": the slots appear with no
 * session to serve them, so the only honest move is to back out to where
 * they came from instead of stranding them on an idle page. */
const PENDING_TOMBSTONE_MS = 10 * 60_000;

export class DetailNavigator {
	private readonly states = new Map<string, DeviceDetailState>();
	private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
	/** Devices with a switchToProfile entry call still in flight. */
	private readonly entering = new Set<string>();
	/** Last leave per device, for the double-press debounce. */
	private readonly leftAt = new Map<string, number>();
	/** Pending sessions that expired unconfirmed (declined-or-ignored
	 *  install prompt), so a late accept can be recognized and backed out. */
	private readonly expiredPendingAt = new Map<string, number>();
	/** One-shot post-leave repaints, keyed by device (see leave()). */
	private readonly leaveRepaintTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly deps: Required<Pick<NavigatorDeps, "switchProfile" | "pendingExpiryMs" | "disappearGraceMs" | "setTimer" | "clearTimer" | "now">> & NavigatorDeps;

	constructor(deps: NavigatorDeps) {
		this.deps = {
			pendingExpiryMs: PENDING_EXPIRY_MS,
			disappearGraceMs: DISAPPEAR_GRACE_MS,
			// unref'd: a cleanup timer must never keep the plugin process
			// alive after the app closes the socket (exit hygiene).
			setTimer: (fn, ms) => setTimeout(fn, ms).unref(),
			clearTimer: (h) => clearTimeout(h),
			now: monotonicNow,
			...deps
		};
	}

	stateFor(deviceId: string): DeviceDetailState | undefined {
		return this.states.get(deviceId);
	}

	/** Devices currently holding a detail session. */
	activeDeviceIds(): string[] {
		return [...this.states.keys()];
	}

	/** Redacted facts for diagnostics (device IDs are hashed by the report). */
	diagnostics(): Array<{ deviceId: string; mode: string; pageSize: number; density: number; keys: number; offset: number; pending: boolean; surfaceCount: number }> {
		return [...this.states.values()].map((s) => ({
			deviceId: s.deviceId,
			mode: s.group.mode,
			pageSize: s.pageSize,
			density: s.density,
			keys: s.group.keys.length,
			offset: s.offset,
			pending: s.pending,
			surfaceCount: s.surfaceCount
		}));
	}

	/**
	 * Opens the detail view for a device. Order per the design: validate
	 * the device class has a bundled profile, resolve the group, set state,
	 * switch, and roll the state back if the switch call itself fails. A
	 * declined install prompt surfaces no error to the plugin, so entry
	 * stays `pending` until a detail slot appears and quietly expires when
	 * none ever does.
	 */
	async enter(request: { deviceId: string; deviceType: number | undefined; grid?: { columns: number; rows: number }; settings: DetailGroupSettings & DetailPresentation & { detailDensity?: unknown; detailTiles?: unknown; detailGaps?: unknown; keyLayout?: unknown; secondaryReadingKey?: unknown; quadReadingKey3?: unknown; quadReadingKey4?: unknown }; snapshot: SensorSnapshot | null; source?: SnapshotSource; openerCell?: { column: number; row: number }; openerContext?: string }): Promise<EnterResult> {
		const { deviceId, deviceType, grid, settings, snapshot, source, openerCell, openerContext } = request;
		const profile = detailProfileFor(deviceType, grid);
		if (profile === undefined) {
			this.deps.log?.info(`Detail entry refused: no bundled profile for device type ${deviceType ?? "unknown"}`);
			return "unsupported";
		}
		const now = this.deps.now();
		const existing = this.states.get(deviceId);
		if (existing !== undefined && existing.surfaceCount > 0) {
			// The detail surface is already live on this device; a second
			// entry would nest profile history. Refuse rather than stack.
			this.deps.log?.warn(`Detail entry refused: already active on ${deviceId}`);
			return "already-active";
		}
		if (existing !== undefined && now - existing.dispatchedAt < LEAVE_DEBOUNCE_MS) {
			// A switch for this device was dispatched moments ago and its
			// slots have not appeared yet (the app's switch beat, or the
			// install prompt just opened). A double-tapped opener must not
			// dispatch again: switching to the already-active profile could
			// set the app's "previous" register to the detail profile itself,
			// turning Back into a self-loop. A pending session older than the
			// beat stays retryable (the declined-install path).
			this.deps.log?.warn(`Detail entry refused: switch just dispatched on ${deviceId}`);
			return "already-active";
		}
		if (this.entering.has(deviceId)) {
			// A switch call for this device is still in flight; stacking a
			// second would race its rollback. (A settled-but-declined install
			// leaves a pending state instead, which stays retryable.)
			this.deps.log?.warn(`Detail entry refused: switch in flight on ${deviceId}`);
			return "already-active";
		}
		const group = resolveDetailGroup(snapshot, settings);
		if (group === null) {
			return "unresolved";
		}
		this.clearCleanupTimer(deviceId);
		this.clearLeaveRepaint(deviceId);
		// A fresh session invalidates the last-leave debounce (Back on the
		// new view must work immediately) and any expired-pending tombstone
		// (the slots about to appear belong to THIS session). The tombstone
		// is captured first: a failed dispatch below must put it back, or a
		// late accept of the prompt it tracked would strand the idle page.
		this.leftAt.delete(deviceId);
		const priorTombstone = this.expiredPendingAt.get(deviceId);
		this.expiredPendingAt.delete(deviceId);
		// A retry can replace a STILL-PENDING predecessor whose install
		// prompt is still open; clearCleanupTimer above killed its expiry
		// timer, so if the retry's dispatch fails, the rollback must leave
		// the tombstone that timer would have written.
		const replacedPending = existing !== undefined && existing.pending;
		const state: DeviceDetailState = {
			deviceId,
			pageSize: readingSlotCapacity(profile),
			density: detailDensityOf(settings),
			// Positional grouping needs the positional list: source and
			// filter groups reshuffle with HWiNFO's layout, so specs there
			// would dress the wrong readings mid-session.
			tilePlan: detailModeOf(settings) === "custom" ? detailTilesOf(settings) : [],
			primaryKey: group.primaryKey,
			groupSettings: {
				readingKey: settings.readingKey,
				detailMode: settings.detailMode,
				detailKeys: settings.detailKeys,
				detailTitle: settings.detailTitle,
				detailFilter: settings.detailFilter,
				detailTilesVersion: settings.detailTilesVersion
			},
			presentation: {
				label: settings.label,
				decimals: settings.decimals,
				fahrenheit: settings.fahrenheit,
				theme: settings.theme,
				textMode: settings.textMode,
				textColor: settings.textColor,
				textDimSecondary: settings.textDimSecondary,
				...(settings.keyBackground !== undefined ? { keyBackground: settings.keyBackground } : {}),
				...(settings.keyAccentWords !== undefined ? { keyAccentWords: settings.keyAccentWords } : {}),
				...(settings.keyStars !== undefined ? { keyStars: settings.keyStars } : {}),
				...(settings.keySkyColor !== undefined ? { keySkyColor: settings.keySkyColor } : {}),
				warnValue: settings.warnValue,
				critValue: settings.critValue,
				alertBelow: settings.alertBelow,
				...(settings.alertRules !== undefined ? { alertRules: settings.alertRules } : {}),
				// The stamp only while it covers the numbers copied, re-recorded
				// for the two the copy carries.
				...(stampForLimitsCopy(settings) ?? {}),
				...formatsPresentation(settings, snapshot)
			},
			group,
			bundle: profile.key,
			// Positional, so they apply in every mode; another bundle's cells
			// (a Virtual Stream Deck that now fits a different layout) never do.
			gapCells: detailGapsOf(settings, profile),
			slotIndexByCell: new Map(),
			openerSource: snapshot === null || source === undefined ? undefined : detailSourceOf(snapshot, group.primaryKey, source),
			openerCell: openerCell === undefined ? null : { column: openerCell.column, row: openerCell.row },
			mirrorSlotIndex: null,
			...(openerContext !== undefined ? { openerContext } : {}),
			offset: 0,
			statModes: new Map(),
			surfaceCount: 0,
			pending: true,
			dispatchedAt: now
		};
		this.states.set(deviceId, state);
		this.entering.add(deviceId);
		try {
			await this.deps.switchProfile(deviceId, profile.name);
		} catch (err) {
			// Roll back only OUR session: a late rejection must never delete
			// a newer session that replaced this one meanwhile.
			if (this.states.get(deviceId) === state) {
				this.states.delete(deviceId);
				if (priorTombstone !== undefined) {
					this.expiredPendingAt.set(deviceId, priorTombstone);
				} else if (replacedPending) {
					this.expiredPendingAt.set(deviceId, this.deps.now());
				}
			}
			this.deps.log?.warn(`Detail profile switch failed on ${deviceId}: ${String(err)}`);
			return "switch-failed";
		} finally {
			this.entering.delete(deviceId);
		}
		this.armCleanupTimer(deviceId, this.deps.pendingExpiryMs, "entry never confirmed");
		this.deps.onChanged?.(deviceId);
		return "entered";
	}

	/**
	 * Back: drop this device's session and ask the app to restore the
	 * previous profile (name omitted). Works with no state too, so a
	 * plugin restarted inside the detail profile still gets out. Repeat
	 * presses inside the debounce window collapse into the one hop the
	 * user meant; a later stateless Back (past the window) still works.
	 */
	async leave(deviceId: string): Promise<void> {
		const now = this.deps.now();
		const last = this.leftAt.get(deviceId);
		if (last !== undefined && now - last < LEAVE_DEBOUNCE_MS) {
			return;
		}
		this.leftAt.set(deviceId, now);
		// If the restore below no-ops (a restart-shaped surface with an empty
		// previous register), the blacked-out slots stay visible with nothing
		// left to repaint them: the tick gate holds still while HWiNFO is
		// down or stale. One shot past the beat restores honest idle faces;
		// a real restore removes the slots first and it repaints nothing.
		this.clearLeaveRepaint(deviceId);
		this.leaveRepaintTimers.set(deviceId, this.deps.setTimer(() => {
			this.leaveRepaintTimers.delete(deviceId);
			this.deps.onChanged?.(deviceId);
		}, LEAVE_DEBOUNCE_MS));
		this.clearCleanupTimer(deviceId);
		const had = this.states.delete(deviceId);
		if (had) {
			this.deps.onChanged?.(deviceId);
		}
		// The blackout ships first, synchronously: with leftAt stamped and
		// the state gone, this pass paints the still-visible surface pure
		// black, and only then does the restore go out. Reversed, the black
		// frames chase a switch already in flight and the app's image cache
		// keeps the old faces for the next entry to flash. A cosmetic hook
		// must never block the way out, so it cannot abort the restore.
		try {
			this.deps.onLeaving?.(deviceId);
		} catch (err) {
			this.deps.log?.warn(`Leave blackout failed on ${deviceId}: ${String(err)}`);
		}
		try {
			await this.deps.switchProfile(deviceId);
		} catch (err) {
			this.deps.log?.warn(`Previous-profile restore failed on ${deviceId}: ${String(err)}`);
		}
	}

	/** Logical pagination inside the one physical page; no wraparound. */
	pageNext(deviceId: string): void {
		this.movePage(deviceId, +1);
	}

	pagePrevious(deviceId: string): void {
		this.movePage(deviceId, -1);
	}

	private movePage(deviceId: string, direction: 1 | -1): void {
		const state = this.states.get(deviceId);
		if (state === undefined) {
			return;
		}
		const page = this.pageFor(state);
		if (direction > 0 ? !page.hasNext : !page.hasPrevious) {
			return;
		}
		// Forward adds THIS page's stride (a mirror Back costs one tile on
		// every page, and hand-grouped tiles make strides vary); backward
		// must land on the previous page's own start, which only the
		// projection knows.
		state.offset = direction > 0 ? page.offset + page.step : page.previousOffset;
		this.deps.onChanged?.(deviceId);
	}

	/** The current logical page projection for a device's state. Without
	 *  a gap that maps onto a registered slot this is the original single
	 *  mirror index, byte for byte; with one, each page reserves the mirror
	 *  plus its own gaps (see placement.ts). */
	pageFor(state: DeviceDetailState): DetailPage {
		const reserved = state.gapCells === undefined || state.gapCells.length === 0 ? undefined : reservedSlotsFor(state.gapCells, state.slotIndexByCell ?? new Map(), state.mirrorSlotIndex, state.pageSize);
		return pageOf(state.group.keys, state.offset, state.pageSize, reserved ?? state.mirrorSlotIndex ?? undefined, state.density, projectDetailTiles(state.group, state.tilePlan));
	}

	/** The source of the opener this device's detail page was opened
	 *  from, as detailScope names it; undefined with no session or while
	 *  the opener's reading has not resolved. */
	openerSourceFor(deviceId: string): DetailSource | undefined {
		return this.states.get(deviceId)?.openerSource;
	}

	/**
	 * True inside the switch beat after a Back on this device. The
	 * controller renders a just-left surface PURE BLACK instead of the
	 * idle faces: the app caches each key's last image per profile and
	 * replays it on the next entry, so idle frames painted here would
	 * flash as "No detail selected" walls forever after. Past the beat
	 * (the switch never happened, or a restart-shaped surface) the honest
	 * idle faces return on the next tick.
	 */
	recentlyLeft(deviceId: string): boolean {
		const last = this.leftAt.get(deviceId);
		return last !== undefined && this.deps.now() - last < LEAVE_DEBOUNCE_MS;
	}

	/**
	 * Controller: the reading-slot index whose registered cell matches the
	 * opener's own cell (the mirror Back tile), or null when none does.
	 * Only the controller sees slot coordinates, so it feeds this; a
	 * repaint follows only on a real change.
	 */
	setMirrorSlotIndex(deviceId: string, index: number | null): void {
		const state = this.states.get(deviceId);
		if (state === undefined || state.mirrorSlotIndex === index) {
			return;
		}
		state.mirrorSlotIndex = index;
		this.deps.onChanged?.(deviceId);
	}

	/**
	 * Controller: the reading-slot index of every registered cell on this
	 * device, so the opener's gap cells map onto the slots actually there.
	 * Stored on every change; a repaint follows only when the slots a gap
	 * reserves moved (a session without gaps never repaints for this).
	 */
	setSlotCells(deviceId: string, cells: ReadonlyMap<string, number>): void {
		const state = this.states.get(deviceId);
		if (state === undefined) {
			return;
		}
		const gaps = state.gapCells ?? [];
		const before = gaps.length === 0 ? "" : gapSignature(gaps, state.slotIndexByCell ?? new Map(), state.pageSize);
		state.slotIndexByCell = cells;
		if (gaps.length > 0 && gapSignature(gaps, cells, state.pageSize) !== before) {
			this.deps.onChanged?.(deviceId);
		}
	}

	/** A detail tile press cycles its readings' session-local stat mode:
	 * the whole chunk moves together (a dense tile shows one shared badge,
	 * so per-reading modes inside one tile could not be displayed
	 * honestly), and the tile's current mode derives from its FIRST
	 * reading, the same cell the badge and type accent follow. */
	cycleChunkStat(deviceId: string, readingKeys: readonly string[]): void {
		const state = this.states.get(deviceId);
		const first = readingKeys[0];
		if (state === undefined || first === undefined) {
			return;
		}
		const next = nextStatMode(this.statModeFor(state, first));
		for (const key of readingKeys) {
			state.statModes.set(key, next);
		}
		this.deps.onChanged?.(deviceId);
	}

	statModeFor(state: DeviceDetailState, readingKey: string): StatMode {
		const mode = state.statModes.get(readingKey);
		return mode !== undefined && isStatMode(mode) ? mode : "current";
	}

	/**
	 * Source-mode re-resolution against a fresh snapshot: when the primary
	 * resolves, the member list and title follow HWiNFO's current layout;
	 * while it doesn't (HWiNFO restarting, source renumbering mid-change),
	 * the last valid list is ridden on and the offset stays put. Custom
	 * groups re-project only their configured keys (order is theirs).
	 */
	refresh(deviceId: string, snapshot: SensorSnapshot | null, source?: SnapshotSource): void {
		const state = this.states.get(deviceId);
		if (state === undefined || snapshot === null) {
			return;
		}
		if (source !== undefined) {
			// The opener's source follows the data source in use (a fallback
			// to Gadget names it differently) and rides its last value while
			// the reading does not resolve. Scoped keys repaint on a change.
			const next = detailSourceOf(snapshot, state.primaryKey, source);
			if (next !== undefined && (next.id !== state.openerSource?.id || next.name !== state.openerSource.name)) {
				state.openerSource = next;
				this.deps.onChanged?.(deviceId);
			}
		}
		const group = resolveDetailGroup(snapshot, state.groupSettings);
		if (group === null) {
			return;
		}
		const changed = group.title !== state.group.title || group.keys.length !== state.group.keys.length || group.keys.some((k, i) => k !== state.group.keys[i]) || JSON.stringify(group.sourceKeys) !== JSON.stringify(state.group.sourceKeys);
		if (changed) {
			state.group = group;
			state.offset = this.pageFor(state).offset;
		}
	}

	/** Controller: a detail slot registered on this device. */
	surfaceSeen(deviceId: string): void {
		const state = this.states.get(deviceId);
		if (state === undefined) {
			// No session owns this surface. If a pending entry expired here
			// recently, this is the install prompt accepted LATE: the app
			// just switched into the view, and idling there would strand the
			// user on a page nobody asked for anymore. Back out to where
			// they were; the next opener press enters normally (installed
			// now, so no prompt). A stale tombstone changes nothing, and a
			// plugin restart inside the view has no tombstone at all: both
			// keep the honest idle surface.
			const expiredAt = this.expiredPendingAt.get(deviceId);
			if (expiredAt !== undefined && this.deps.now() - expiredAt < PENDING_TOMBSTONE_MS) {
				this.expiredPendingAt.delete(deviceId);
				this.deps.log?.info(`Detail surface appeared after its pending entry expired on ${deviceId}: restoring the previous profile`);
				void this.leave(deviceId);
			}
			return;
		}
		state.surfaceCount++;
		state.pending = false;
		this.clearCleanupTimer(deviceId);
	}

	/**
	 * Controller: a detail slot on this device disappeared. When the last
	 * one goes without Back having been pressed (the user switched
	 * profiles by hand), the state is dropped after a short grace window
	 * — long enough to survive appear/disappear churn, short enough not
	 * to hold a dead session.
	 */
	surfaceGone(deviceId: string): void {
		const state = this.states.get(deviceId);
		if (state === undefined) {
			return;
		}
		state.surfaceCount = Math.max(0, state.surfaceCount - 1);
		if (state.surfaceCount === 0) {
			this.armCleanupTimer(deviceId, this.deps.disappearGraceMs, "detail surface disappeared");
		}
	}

	deviceDisconnected(deviceId: string): void {
		this.clearCleanupTimer(deviceId);
		this.clearLeaveRepaint(deviceId);
		// The debounce stamp and tombstone die with the device: neither may
		// influence a session after a reconnect, and the maps must not grow
		// with device churn.
		this.leftAt.delete(deviceId);
		this.expiredPendingAt.delete(deviceId);
		if (this.states.delete(deviceId)) {
			this.deps.log?.info(`Detail session dropped: ${deviceId} disconnected`);
		}
	}

	shutdown(): void {
		for (const deviceId of [...this.cleanupTimers.keys()]) {
			this.clearCleanupTimer(deviceId);
		}
		for (const deviceId of [...this.leaveRepaintTimers.keys()]) {
			this.clearLeaveRepaint(deviceId);
		}
		this.states.clear();
		this.leftAt.clear();
		this.expiredPendingAt.clear();
	}

	private armCleanupTimer(deviceId: string, ms: number, reason: string): void {
		this.clearCleanupTimer(deviceId);
		const handle = this.deps.setTimer(() => {
			this.cleanupTimers.delete(deviceId);
			const state = this.states.get(deviceId);
			// Slots came (back) meanwhile: the session is live again.
			if (state === undefined || state.surfaceCount > 0) {
				return;
			}
			if (state.pending) {
				// The entry was never confirmed (install prompt declined or
				// still open). Leave a tombstone so a LATE accept is
				// recognized in surfaceSeen and backed out instead of
				// stranding the user on an idle page.
				this.expiredPendingAt.set(deviceId, this.deps.now());
			}
			this.states.delete(deviceId);
			this.deps.log?.info(`Detail session dropped on ${deviceId}: ${reason}`);
			this.deps.onChanged?.(deviceId);
		}, ms);
		this.cleanupTimers.set(deviceId, handle);
	}

	private clearCleanupTimer(deviceId: string): void {
		const handle = this.cleanupTimers.get(deviceId);
		if (handle !== undefined) {
			this.deps.clearTimer(handle);
			this.cleanupTimers.delete(deviceId);
		}
	}

	private clearLeaveRepaint(deviceId: string): void {
		const handle = this.leaveRepaintTimers.get(deviceId);
		if (handle !== undefined) {
			this.deps.clearTimer(handle);
			this.leaveRepaintTimers.delete(deviceId);
		}
	}
}
