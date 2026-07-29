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
import type { SensorSnapshot } from "../hwinfo/types";
import { isStatMode, STAT_MODES, type DecimalsSetting, type StatMode } from "../ui/format";
import { pageOf, resolveDetailGroup, type DetailGroup, type DetailGroupSettings, type DetailPage } from "./detail-group";
import { detailProfileFor, readingSlotCapacity } from "./managed-profiles";

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
	readonly warnValue?: string;
	readonly critValue?: string;
	readonly alertBelow?: boolean;
};

export type DeviceDetailState = {
	readonly deviceId: string;
	readonly profileName: string;
	readonly pageSize: number;
	readonly primaryKey: string;
	/** The opener's group settings, kept for source-mode re-resolution. */
	readonly groupSettings: DetailGroupSettings;
	readonly presentation: DetailPresentation;
	/** Last valid resolution; ridden on while HWiNFO restarts (transient
	 *  recovery), replaced whenever the primary resolves again. */
	group: DetailGroup;
	offset: number;
	/** Ephemeral per-reading stat modes for this detail session. */
	readonly statModes: Map<string, StatMode>;
	/** Registered visible detail slots on this device (controller-fed). */
	surfaceCount: number;
	/** True until the first detail slot appears after the switch. */
	pending: boolean;
};

export type EnterResult = "entered" | "unsupported" | "unresolved" | "switch-failed" | "already-active";

type NavigatorDeps = {
	switchProfile: SwitchProfileFn;
	/** Re-render hook; fired after any state change for a device. */
	onChanged?: (deviceId: string) => void;
	log?: { info(msg: string): void; warn(msg: string): void };
	/** Entry never confirmed by an appearing slot after this long: drop it. */
	pendingExpiryMs?: number;
	/** Every slot gone this long without Back (manual profile change): drop. */
	disappearGraceMs?: number;
	setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
	clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
	/** Clock for the leave debounce; tests inject a manual one. */
	now?: () => number;
};

const PENDING_EXPIRY_MS = 30_000;
const DISAPPEAR_GRACE_MS = 2_500;

/** Repeat Back presses inside this window are one hop, not two: the app
 * takes a beat to actually switch, and a double-tap during it would hop
 * "previous" twice (the second hop from the detail profile itself). */
const LEAVE_DEBOUNCE_MS = 1_500;

export class DetailNavigator {
	private readonly states = new Map<string, DeviceDetailState>();
	private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
	/** Devices with a switchToProfile entry call still in flight. */
	private readonly entering = new Set<string>();
	/** Last leave per device, for the double-press debounce. */
	private readonly leftAt = new Map<string, number>();
	private readonly deps: Required<Pick<NavigatorDeps, "switchProfile" | "pendingExpiryMs" | "disappearGraceMs" | "setTimer" | "clearTimer">> & NavigatorDeps;

	constructor(deps: NavigatorDeps) {
		this.deps = {
			pendingExpiryMs: PENDING_EXPIRY_MS,
			disappearGraceMs: DISAPPEAR_GRACE_MS,
			// unref'd: a cleanup timer must never keep the plugin process
			// alive after the app closes the socket (exit hygiene).
			setTimer: (fn, ms) => setTimeout(fn, ms).unref(),
			clearTimer: (h) => clearTimeout(h),
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
	diagnostics(): Array<{ deviceId: string; mode: string; pageSize: number; keys: number; offset: number; pending: boolean; surfaceCount: number }> {
		return [...this.states.values()].map((s) => ({
			deviceId: s.deviceId,
			mode: s.group.mode,
			pageSize: s.pageSize,
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
	async enter(request: { deviceId: string; deviceType: number | undefined; grid?: { columns: number; rows: number }; settings: DetailGroupSettings & DetailPresentation; snapshot: SensorSnapshot | null }): Promise<EnterResult> {
		const { deviceId, deviceType, grid, settings, snapshot } = request;
		const profile = detailProfileFor(deviceType, grid);
		if (profile === undefined) {
			this.deps.log?.info(`Detail entry refused: no bundled profile for device type ${deviceType ?? "unknown"}`);
			return "unsupported";
		}
		const existing = this.states.get(deviceId);
		if (existing !== undefined && existing.surfaceCount > 0) {
			// The detail surface is already live on this device; a second
			// entry would nest profile history. Refuse rather than stack.
			this.deps.log?.warn(`Detail entry refused: already active on ${deviceId}`);
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
		const state: DeviceDetailState = {
			deviceId,
			profileName: profile.name,
			pageSize: readingSlotCapacity(profile),
			primaryKey: group.primaryKey,
			groupSettings: {
				readingKey: settings.readingKey,
				detailMode: settings.detailMode,
				detailKeys: settings.detailKeys,
				detailTitle: settings.detailTitle
			},
			presentation: {
				label: settings.label,
				decimals: settings.decimals,
				fahrenheit: settings.fahrenheit,
				theme: settings.theme,
				textMode: settings.textMode,
				textColor: settings.textColor,
				textDimSecondary: settings.textDimSecondary,
				warnValue: settings.warnValue,
				critValue: settings.critValue,
				alertBelow: settings.alertBelow
			},
			group,
			offset: 0,
			statModes: new Map(),
			surfaceCount: 0,
			pending: true
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
		const now = (this.deps.now ?? Date.now)();
		const last = this.leftAt.get(deviceId);
		if (last !== undefined && now - last < LEAVE_DEBOUNCE_MS) {
			return;
		}
		this.leftAt.set(deviceId, now);
		this.clearCleanupTimer(deviceId);
		const had = this.states.delete(deviceId);
		if (had) {
			this.deps.onChanged?.(deviceId);
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
		state.offset = page.offset + direction * state.pageSize;
		this.deps.onChanged?.(deviceId);
	}

	/** The current logical page projection for a device's state. */
	pageFor(state: DeviceDetailState): DetailPage {
		return pageOf(state.group.keys, state.offset, state.pageSize);
	}

	/** A detail slot press cycles that reading's session-local stat mode. */
	cycleSlotStat(deviceId: string, readingKey: string): void {
		const state = this.states.get(deviceId);
		if (state === undefined) {
			return;
		}
		const current = state.statModes.get(readingKey) ?? "current";
		const mode = isStatMode(current) ? current : "current";
		const next = STAT_MODES[(STAT_MODES.indexOf(mode) + 1) % STAT_MODES.length] as StatMode;
		state.statModes.set(readingKey, next);
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
	refresh(deviceId: string, snapshot: SensorSnapshot | null): void {
		const state = this.states.get(deviceId);
		if (state === undefined || snapshot === null) {
			return;
		}
		const group = resolveDetailGroup(snapshot, state.groupSettings);
		if (group === null) {
			return;
		}
		const changed = group.title !== state.group.title || group.keys.length !== state.group.keys.length || group.keys.some((k, i) => k !== state.group.keys[i]);
		if (changed) {
			state.group = group;
			state.offset = pageOf(group.keys, state.offset, state.pageSize).offset;
		}
	}

	/** Controller: a detail slot registered on this device. */
	surfaceSeen(deviceId: string): void {
		const state = this.states.get(deviceId);
		if (state === undefined) {
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
		if (this.states.delete(deviceId)) {
			this.deps.log?.info(`Detail session dropped: ${deviceId} disconnected`);
		}
	}

	shutdown(): void {
		for (const deviceId of [...this.cleanupTimers.keys()]) {
			this.clearCleanupTimer(deviceId);
		}
		this.states.clear();
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
}
