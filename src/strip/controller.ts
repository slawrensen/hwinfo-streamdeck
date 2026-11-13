/**
 * Strip Display runtime: the glue between the Sensor Dial action and the
 * pure strip modules (registry, edits, scheduler, frame, scene, slicer,
 * input). The Sensor Dial asks claims(context) first in every handler and
 * hands a joined member's events here; an independent dial never reaches
 * any of this, so its face, writes and commands stay exactly as before.
 *
 * - Membership: every visible Sensor Dial is reported (appear, disappear,
 *   settings, device gone). The registry decides groups from each dial's
 *   own saved copy, its device id and its encoder column. Nothing durable
 *   names a context.
 * - Scheduling: one GroupScheduler per runtime group. Poller ticks that
 *   carry new data invalidate "data", theme changes "style", edits
 *   "config", appear and disappear "membership", input "view". Each frame
 *   captures one snapshot (status, the authority config, a copy of the
 *   view, one history view per series at one time) and sends each member
 *   its slice, deduped, never to a departed context.
 * - History: each group keeps interest in all three windows of every
 *   series it draws, under in-memory consumer ids strip:<group>:<pane>,
 *   dropped when the group has no visible member (the store lingers). A
 *   Group pane asks only for the window it shows, for the readings its rule
 *   stands for in the frame, from the history store's group allowance
 *   (strip:<group>:<pane>:group), so it never takes from the keys' budget.
 * - Writes: the plugin is the only writer of stripGroup. Every write is a
 *   complete document per member, issued in one synchronous loop, and only
 *   in reply to a deliberate request (a panel request, the repair of a
 *   stale whole-document panel write, or the move of a pasted copy into
 *   stripGroupPasted). Appearing, reconnecting, ticks,
 *   previews and input never write.
 * - Input: the dial's own gesture machine (src/gestures.ts) through
 *   routeStripInput. Rotation's window, inspect, the cursor and the
 *   highlight are runtime view state; inspect freezes a copy of the pane
 *   while polling, history and alerts carry on.
 */
import type { JsonObject, JsonValue } from "@elgato/utils";

import { monotonicNow } from "../clock";
import type { DialControlCommand, StripCommandId } from "../commands";
import type { StripGroupCount } from "../pi-protocol";
import { tickSignature } from "../detail/tick-signature";
import { deviceCapabilities, type DeviceCapabilities } from "../devices";
import { IDLE_GESTURE, routeGesture, type GestureState } from "../gestures";
import type { HistoryReader, HistoryWindowId } from "../history/types";
import type { PollerStatus } from "../poller";
import { hashId, trace, traceEnabled } from "../recorder";
import { artPlace, paintArt } from "../ui/deck-art";
import { planLooksReset, withStripGroup, type PlannedWrite, type ScreenKeyMap, type SettingsDoc } from "./edits";
import { STRIP_LOOK_FIELDS, staleLooks } from "../ui/shared-looks";
import { effectiveConfig, frameInput, freshView, groupFrameOf, LIVE, pauseLabel, paneSeriesInputs, screenIndexOf, stripMessage, type FrameSources, type GroupFrame, type GroupView, type PaneView, type ScaleTurn, type ScreenFrame } from "./frame";
import { displayStep, groupDrawOf, groupPlotOf, groupRuleOf, nextHome, type HomeState } from "./group";
import { tileGridFor } from "./tiles";
import { cursorAgoMs, DEFAULT_BUCKET_PX, paneExtents, panePlotOf, type BucketPx, type StripEncoders } from "./geometry";
import { autoTarget, stepSpan, toView, type HeldScale } from "./scale";
import type { DataUnitsPref } from "../ui/measure";
import { hasSeriesChoice, routeStripInput, screensTriggerDescriptions, stepWindow, stripTriggerDescriptions, type StripAction, type StripEncoderEvent, type StripHints, type StripRouting } from "./input";
import { buildStripState, handleStripRequest, type StripPiPort, type StripPreview, type StripDraftSpec } from "./pi";
import { stripGroupKey, StripRegistry, VIEW_LINEAGE_TTL_MS, type CapabilityLookup, type SettingsClass, type StripChange, type StripGroupState } from "./registry";
import { alignedNow, historyWidthFor, renderLogical, WINDOW_MS, type LogicalScene, type PaneScaleOut, type StripPaneInput, type StripSceneInput } from "./scene";
import { formatValue } from "../ui/format";
import { AggregateBudget, GroupScheduler, MIN_FRAME_MS, systemClock, type FrameMember, type InvalidateReason, type SchedulerClock } from "./scheduler";
import { SCREEN_NAME_MS, screenCritical, screenHasData, screenLabelOf, screenNeedsRule, screensColumnOf, screenStep, wipeOrder, autoScreenName } from "./screens";
import { activePanes, drawnSeries, HISTORY_WINDOWS, isRuleStyle, mintStripId, paneWindowOf, screenCountOf, screenKeysOf, screensOf, STRIP_PASTED_FIELD, type StripConfigV1, type StripPaneV1 } from "./settings";
import { feedbackUri, HOLD_PROBE_FRAMES, sliceStrip } from "./slicer";

/** What the controller needs from one visible Sensor Dial (the SDK's
 * DialAction satisfies it). */
export interface StripDialHandle {
	readonly id: string;
	readonly device: { readonly id: string };
	readonly coordinates?: { readonly column: number; readonly row: number };
	setFeedback(feedback: { canvas: string }): Promise<void>;
	setTriggerDescription(descriptions?: { rotate?: string; push?: string; touch?: string; longTouch?: string }): Promise<void>;
	setSettings(settings: JsonObject): Promise<void>;
}

/** What the controller needs from the Sensor Dial action. */
export interface StripHost {
	/** The whole settings document the plugin holds for a visible dial. */
	settingsOf(context: string): SettingsDoc | undefined;
	/** The plugin wrote this whole document: hold it as the dial's settings. */
	stored(context: string, settings: Record<string, unknown>): void;
	/** A visible dial joined a strip (true: its individual face, writes and
	 * commands are suspended) or left one (false: they resume). */
	claimChanged(context: string, claimed: boolean): void;
	status(): PollerStatus;
	readonly history: Pick<HistoryReader, "setInterest" | "dropInterest" | "view" | "refused" | "revision">;
	/** The context whose Sensor Dial panel is open, if any. */
	panelContext(): string | undefined;
	sendToPanel(payload: JsonValue): void;
	log?(message: string): void;
}

export type StripControllerOptions = {
	readonly capabilities?: CapabilityLookup;
	readonly clock?: SchedulerClock;
	readonly mintId?: () => string;
	readonly budget?: AggregateBudget;
};

/** A panel draft remembered across member panels: which strip (scope),
 * which dial's panel it was made in (origin), and when. */
type Memo = { readonly scope: MemoScope; readonly origin: string; readonly at: number; readonly draft: StripDraftSpec };

/** A joined member's strip (deck and group id), or its deck's new strip. */
type MemoScope = { readonly id: string; readonly key?: string };

type RuntimeGroup = {
	readonly key: string;
	scheduler: GroupScheduler;
	view: GroupView;
	/** The bucket width the last frame settled on (sliceStrip's hold). */
	heldBucketPx: BucketPx | undefined;
	/** Frames since sliceStrip last tried the widths finer than the hold,
	 * and what the strip drew then (its authority and its view): a probe is
	 * due every HOLD_PROBE_FRAMES frames and on any change of either. */
	sinceProbe: number;
	probeSig: string;
	probeView: GroupView | null;
	/** The last frame's logical scene (the panel's reference frame). */
	lastScene: LogicalScene | null;
	/** The interest last set, as a signature. */
	interest: string;
	/** The authority last drawn: id and revision, to consume held presses. */
	authority: string;
	/** The stored config the view was last reconciled with (null before
	 * the first). A paused pane's frozen copy and the session windows are
	 * rebased onto a new authority's config against it. */
	drawn: StripConfigV1 | null;
	/** Per pane, a Group pane's readings in the last frame, and what it
	 * remembers: the keys it drew under the rule they came from (`sig`),
	 * so a reading HWiNFO stops listing keeps its row. */
	groupFrames: [GroupFrame | undefined, GroupFrame | undefined];
	groupMemory: [{ sig: string; keys: readonly string[] }, { sig: string; keys: readonly string[] }];
	/** The Group panes' interest last set, as a signature. */
	groupInterest: string;
	/** Per pane, the reading the home readout names (nextHome), the data
	 * frame it was last judged at, and the rule it belongs to. */
	groupHome: [{ state: HomeState | undefined; at: number; sig: string } | undefined, { state: HomeState | undefined; at: number; sig: string } | undefined];
	/** Per pane, its held scales and reserved widths (src/strip/scale.ts,
	 * PaneScaleOut) after the last frame, the data frame they were judged at,
	 * the scales held before it (a repaint at the same time judges from
	 * these again), and what they belong to: the hold signature (`sig`) and
	 * the stored setup the reserved widths and a turned scale are for. */
	heldScales: [PaneHeld | undefined, PaneHeld | undefined];
	/** Per pane, the span (view units) the next frame will show after a
	 * scale detent or Auto scale since the last frame, so a detent that
	 * comes faster than a frame steps from where the one before it went;
	 * undefined once a frame has shown it (LogicalScene.scales). */
	scaleOnScreen: [number | undefined, number | undefined];
	/** Per pane, the stored setup its last frame drew (scaleSetupOf), live or
	 * paused: the setup a turn made now is for (ScaleTurn.sig). */
	scaleSetup: [string | undefined, string | undefined];
	/** Per pane, whether its last frame said it takes the scale dial. */
	dialFlags: [boolean, boolean];
	/** Strip Screens: the change running on the strip (a wipe, or the cut
	 * a turn during a wipe makes), if any. */
	transition: Transition | null;
	/** Until when the screen's name and place take the window words. */
	nameUntil: number;
	/** The timer that ends the name, and the one that asks for a wipe's
	 * next step (or the frame after it). */
	nameTimer: unknown;
	stepTimer: unknown;
	/** The automatic cycle: when the next screen is due; null while it is
	 * not armed (off, held, or HWiNFO stopped). */
	cycleDueAt: number | null;
	/** Each screen not on view keeps its first-pane memory (a Group's
	 * remembered readings and home), by screen key. */
	screenMemory: Map<string, ScreenMemory>;
	/** The hidden screens' critical marks for the position line, judged
	 * once per data frame and per stored copy. */
	alerts: { readonly at: number; readonly screen: number; readonly config: StripConfigV1; readonly marks: readonly boolean[] } | null;
	/** A hidden rule screen's readings for its critical mark, resolved at
	 * most every RULE_KEYS_MS (a new sensor shows within that). */
	ruleKeys: Map<string, { readonly sig: string; readonly at: number; readonly keys: readonly string[] }>;
};

/** How long a hidden rule screen's resolution serves its critical mark. */
const RULE_KEYS_MS = 10_000;

/** A screen change on the strip. A wipe sends one slice per frame (each
 * frame at least MIN_FRAME_MS apart): next from the right, previous from
 * the left, both screens as they were when it began: the slices on the
 * device (A) and the new screen built once (B). */
type Transition =
	| { readonly kind: "cut"; readonly direction: 1 | -1 }
	| { readonly kind: "wipe"; readonly direction: 1 | -1; step: number; slices: Map<string, string> | null; order: readonly number[]; builtAt: number | null };

type ScreenMemory = { readonly groupMemory: { sig: string; keys: readonly string[] }; readonly groupHome: RuntimeGroup["groupHome"][0]; readonly heldScale: PaneHeld | undefined };

/** A pane's scale state the runtime holds between frames. */
type PaneHeld = { readonly sig: string; readonly setup: string; readonly at: number; readonly base: Readonly<Record<string, HeldScale>> | undefined; readonly out: PaneScaleOut };

/** Faces longer than this are never carried to the panel (bounded messages). */
const MAX_PANEL_CHARS = 64 * 1024;
/** Hidden groups whose view is kept at most. */
const KEPT_CAP = 64;
/** Labels remembered for readings that go missing; bounded. */
const LABEL_CAP = 256;
/** The open panel's strip state is pushed at most this often on data. */
const PANEL_PUSH_MS = 1000;
/** Panel drafts remembered across member panels: at most this many
 * strips, each for this long after its last change. Memory only. */
const MEMO_CAP = 16;
const MEMO_TTL_MS = 10 * 60 * 1000;
const MEMO_SEP = "\u001f";
/** Gesture hints for a member that draws an explanation instead of a slice. */
const IDLE_TRIGGERS = { rotate: "No action", push: "No action", touch: "No action", longTouch: "No action" };
const WINDOWS: readonly HistoryWindowId[] = HISTORY_WINDOWS;

function consumed(state: GestureState): GestureState {
	return state.downAt === null ? state : { downAt: state.downAt, rotatedWhileDown: true };
}

export class StripController implements StripPiPort {
	readonly registry: StripRegistry;
	private readonly capabilityLookup: CapabilityLookup;
	private readonly clock: SchedulerClock;
	private readonly budget: AggregateBudget;
	private readonly mint: () => string;
	private readonly handles = new Map<string, StripDialHandle>();
	private readonly gestures = new Map<string, GestureState>();
	private readonly triggers = new Map<string, string>();
	private readonly lastSlice = new Map<string, string>();
	private readonly groups = new Map<string, RuntimeGroup>();
	private readonly kept = new Map<string, { readonly at: number; readonly view: GroupView; readonly drawn: StripConfigV1 | null }>();
	private readonly claimed = new Set<string>();
	private readonly labels = new Map<string, string>();
	private readonly drafts = new Map<string, StripDraftSpec>();
	private readonly memos = new Map<string, Memo>();
	private frameNow: number | null = null;
	private frameSignature = "";
	private lastPanelBody = "";
	private lastPanelAt = Number.NEGATIVE_INFINITY;
	private panelTimer: unknown = null;

	constructor(
		private readonly host: StripHost,
		options: StripControllerOptions = {}
	) {
		this.capabilityLookup = options.capabilities ?? deviceCapabilities;
		this.clock = options.clock ?? systemClock(monotonicNow);
		this.registry = new StripRegistry(this.capabilityLookup, () => this.clock.now());
		this.budget = options.budget ?? new AggregateBudget(this.clock);
		this.mint = options.mintId ?? (() => mintStripId());
	}

	// ---- lifecycle ------------------------------------------------------------

	/** True when the context is a joined member: the strip owns its face,
	 * its input and its Control commands. */
	claims(context: string): boolean {
		return this.registry.claims(context);
	}

	/** willAppear of a Sensor Dial (replays included). Never writes. */
	appear(handle: StripDialHandle, settings: unknown): void {
		const context = handle.id;
		const column = handle.coordinates?.column ?? -1;
		this.handles.set(context, handle);
		// A replayed appear can come with the app's touchscreen cache cold:
		// the next frame resends every slice (the epoch also moves), and the
		// gesture hints go again.
		this.triggers.delete(context);
		this.lastSlice.delete(context);
		const held = this.gestures.get(context);
		if (held !== undefined) this.gestures.set(context, consumed(held));
		for (const group of this.groups.values()) group.scheduler.forget(context);
		const { change } = this.registry.appear({ context, deviceId: handle.device.id, column, settings });
		this.apply([change], "membership");
	}

	/** willDisappear. A disappear for an earlier placement of a context that
	 * has since appeared at another column is ignored. */
	disappear(context: string, column?: number): void {
		const member = this.registry.member(context);
		if (member === undefined) {
			this.handles.delete(context);
			return;
		}
		const change = this.registry.disappear(context, column ?? member.column);
		if (this.registry.member(context) === undefined) this.forgetContext(context);
		this.apply([change], "membership");
	}

	/** deviceDidDisconnect: every member on that device is gone. */
	deviceGone(deviceId: string): void {
		const change = this.registry.deviceGone(deviceId);
		for (const [context, handle] of [...this.handles]) {
			if (handle.device.id === deviceId) this.forgetContext(context);
		}
		this.apply([change], "membership");
	}

	/**
	 * didReceiveSettings from the app: a panel write or a pasted document.
	 * A whole document that carried an older copy of this dial's strip
	 * setup is repaired by writing the group's copy back into it (the reply
	 * to a deliberate user write, never on appear). A differing copy from
	 * elsewhere is shown as a conflict and never adopted silently.
	 */
	settingsChanged(context: string, settings: unknown): SettingsClass {
		const change = this.registry.settingsChanged(context, settings);
		const changes: StripChange[] = [change];
		const handle = this.handles.get(context);
		if (handle !== undefined && typeof settings === "object" && settings !== null && !Array.isArray(settings)) {
			let doc: Record<string, unknown> | undefined;
			if (change.restamp !== undefined) {
				doc = withStripGroup(settings as SettingsDoc, change.restamp.copy);
				if (change.restamp.pasted !== undefined) doc[STRIP_PASTED_FIELD] = change.restamp.pasted;
			} else if (change.quarantine !== undefined) {
				// A pasted copy is kept apart from the dial's own until the
				// person chooses, so a restart never reads it as the strip.
				doc = { ...(settings as SettingsDoc), [STRIP_PASTED_FIELD]: change.quarantine.pasted };
				if (change.quarantine.stripGroup === undefined) delete doc.stripGroup;
				else doc.stripGroup = change.quarantine.stripGroup;
			}
			if (doc !== undefined) {
				this.host.stored(context, doc);
				this.sendSettings(handle, doc);
				changes.push(this.registry.noteWritten(context, doc));
			}
		}
		this.apply(changes, "config");
		return change.settings ?? "unrelated";
	}

	/** Every live group redraws in the new look (deck theme, Text, units). */
	restyle(): void {
		for (const group of this.groups.values()) group.scheduler.invalidate("style");
	}

	/** One poller tick. Only a tick that carries new data moves the frame
	 * time; a held tick changes nothing on the strip. */
	onTick(status: PollerStatus): void {
		if (status.state !== "unavailable" && this.groups.size > 0) this.noteLabels(status);
		// The automatic screen cycle is timed on poll ticks, held ones too.
		for (const group of this.groups.values()) this.cycleTick(group, status);
		const signature = `${tickSignature(status)}:h${this.host.history.revision}`;
		if (signature === this.frameSignature) return;
		this.frameSignature = signature;
		this.frameNow = this.clock.now();
		for (const group of this.groups.values()) group.scheduler.invalidate("data");
		if (this.drafts.size > 0) this.schedulePanelPush();
	}

	/** The last slice this context was sent (the panel's face), if joined. */
	faceOf(context: string): string | undefined {
		return this.claims(context) ? this.lastSlice.get(context) : undefined;
	}

	/** A compact description of the dial's strip role for the dial panel's
	 * preview, or undefined for a dial with no strip copy at all. */
	previewOf(context: string): { status: string; column: number; groupId: string; rev: number; layout: string; mode: string } | undefined {
		const member = this.registry.member(context);
		if (member?.copy === undefined) return undefined;
		const status = this.registry.memberStatus(context) ?? "independent";
		const slot = this.registry.slotOf(context);
		const group = slot === undefined ? undefined : this.groups.get(slot.group.key);
		const mode = group === undefined || slot === undefined ? "live" : group.view.panes[slot.pane].mode;
		return { status, column: member.column, groupId: member.copy.id, rev: member.copy.rev, layout: member.copy.config.layout, mode };
	}

	// ---- input ----------------------------------------------------------------

	/** One encoder event of a joined member. Routed exactly once, in group
	 * coordinates; a member that cannot draw its slice ignores input. */
	input(context: string, event: StripEncoderEvent): void {
		const member = this.registry.member(context);
		if (member === undefined) return;
		if (event.column !== member.column) {
			// The event belongs to another placement than the one this
			// context appeared at: drop it rather than guess.
			this.host.log?.(`strip input dropped: column ${event.column} is not the appeared column ${member.column}`);
			return;
		}
		const slot = this.registry.slotOf(context);
		const group = slot === undefined ? undefined : this.groups.get(slot.group.key);
		if (slot === undefined || group === undefined || slot.group.authority === null) {
			// Keep the gesture machine honest even when nothing acts on it.
			const g = this.gestures.get(context) ?? IDLE_GESTURE;
			this.gestures.set(context, routeGesture(g, gestureInputOf(event), "off").state);
			return;
		}
		const config = effectiveConfig(slot.group.authority.config, group.view);
		const routing = this.routingOf(group, slot.group, config);
		if (routing === undefined) return;
		// Any input on the strip restarts the automatic cycle's wait.
		this.restartCycle(group, slot.group.authority.config);
		const routed = routeStripInput(routing, this.gestures.get(context) ?? IDLE_GESTURE, event);
		this.gestures.set(context, routed.state);
		if (routed.action === null) return;
		this.act(group, slot.group, routed.action);
	}

	/**
	 * A strip Control command. Reaches every live group whose Link ID
	 * matches the target ("" reaches every strip), in both panes of a split.
	 * Returns how many groups it reached.
	 */
	applyControl(command: DialControlCommand & { readonly command: StripCommandId }): number {
		let reached = 0;
		for (const group of this.groups.values()) {
			const state = this.registry.group(group.key);
			const authority = state?.authority;
			if (state === undefined || authority === null || authority === undefined || state.health !== "ok") continue;
			const linkId = authority.config.linkId?.trim() ?? "";
			if (command.target !== "" && linkId !== command.target) continue;
			reached++;
			this.restartCycle(group, authority.config);
			const panes = activePanes(authority.config).map((_, i) => (i === 1 ? 1 : 0) as 0 | 1);
			const config = effectiveConfig(authority.config, group.view);
			switch (command.command) {
				case "stripScreenNext":
				case "stripScreenPrev":
				case "stripScreenFirst": {
					// A strip with one screen counts as reached and stays as it is.
					const count = screenCountOf(authority.config);
					const at = screenIndexOf(authority.config, group.view);
					if (command.command === "stripScreenFirst") this.showScreen(group, state, 0, -1);
					else this.showScreen(group, state, screenStep(at, count, command.command === "stripScreenNext" ? 1 : -1, true), command.command === "stripScreenNext" ? 1 : -1);
					break;
				}
				case "stripLive":
					for (const p of panes) this.act(group, state, { kind: "live", pane: p });
					break;
				case "stripInspect":
					for (const p of panes) if (group.view.panes[p].mode === "live") this.act(group, state, { kind: "inspect", pane: p, cursor: 0 });
					break;
				case "stripToggleInspect": {
					const allPaused = panes.every((p) => group.view.panes[p].mode === "paused");
					for (const p of panes) {
						if (allPaused) this.act(group, state, { kind: "live", pane: p });
						else if (group.view.panes[p].mode === "live") this.act(group, state, { kind: "inspect", pane: p, cursor: 0 });
					}
					break;
				}
				case "stripWindowNext":
				case "stripWindowPrev": {
					const step = command.command === "stripWindowNext" ? 1 : -1;
					if (config.layout === "split" && !config.sharedWindow) for (const p of panes) this.act(group, state, { kind: "window", pane: p, step, scope: "pane" });
					else this.act(group, state, { kind: "window", pane: 0, step, scope: "shared" });
					break;
				}
				case "stripSeriesNext":
				case "stripSeriesPrev": {
					const step = command.command === "stripSeriesNext" ? 1 : -1;
					for (const p of panes) {
						const pane = config.panes[p];
						if (pane.style === "group") {
							if (this.groupKeysOf(group, p).length > 0) this.act(group, state, { kind: "groupStep", pane: p, step });
						} else if (hasSeriesChoice({ style: pane.style, seriesCount: pane.series.length, ...(pane.readout === undefined ? {} : { readout: pane.readout }), mode: group.view.panes[p].mode })) this.act(group, state, { kind: "series", pane: p, step });
					}
					break;
				}
			}
		}
		return reached;
	}

	private routingOf(group: RuntimeGroup, state: StripGroupState, config: StripConfigV1): StripRouting | undefined {
		if (config.encoders === null) return undefined;
		const screensColumn = this.screensColumn(state);
		return {
			layout: config.layout,
			encoders: config.encoders,
			sharedWindow: config.sharedWindow,
			bucketPx: group.heldBucketPx ?? DEFAULT_BUCKET_PX,
			...(screensColumn === undefined ? {} : { screens: { column: screensColumn } }),
			panes: activePanes(config).map((pane, i) => {
				const p = (i === 1 ? 1 : 0) as 0 | 1;
				const count = isRuleStyle(pane.style) ? this.groupKeysOf(group, p).length : 0;
				const grid = this.tileGridOf(group, p, pane);
				return { style: pane.style, seriesCount: pane.series.length, ...(pane.readout === undefined ? {} : { readout: pane.readout }), mode: group.view.panes[p].mode, ...(isRuleStyle(pane.style) ? { group: { count, draw: groupDrawOf(groupRuleOf(pane).view, count), current: pane.overlays.current, ...(grid === undefined ? {} : { grid }) } } : {}), ...(group.dialFlags[p] ? { scaleDial: true } : {}) };
			})
		};
	}

	/** Applies one routed action to the group's runtime view. Never writes. */
	private act(group: RuntimeGroup, state: StripGroupState, action: StripAction): void {
		const authority = state.authority;
		if (authority === null || authority.config.encoders === null) return;
		if (action.kind === "screen") {
			// The Screens dial: one screen per detent, clamped at the ends.
			const at = screenIndexOf(authority.config, group.view);
			this.showScreen(group, state, screenStep(at, screenCountOf(authority.config), action.step, false), action.step > 0 ? 1 : -1);
			return;
		}
		const stored = authority.config;
		const encoders = authority.config.encoders;
		const view = group.view;
		const p = action.pane;
		const config = effectiveConfig(stored, view);
		const pane = config.panes[p];
		const extent = paneExtents(config.layout, encoders)[p];
		const bucketPx = group.heldBucketPx ?? DEFAULT_BUCKET_PX;
		const plot = extent === undefined ? undefined : pane.style === "group" ? groupPlotOf(pane, extent, groupDrawOf(groupRuleOf(pane).view, this.groupKeysOf(group, p).length), bucketPx, this.tileGridOf(group, p, pane)) : panePlotOf(pane, extent, bucketPx);
		const windowMs = WINDOW_MS[paneWindowOf(config, p)];
		const setPane = (next: PaneView): readonly [PaneView, PaneView] => (p === 0 ? [next, view.panes[1]] : [view.panes[0], next]);
		const withLane = (lane: number | undefined): readonly [number, number] => (lane === undefined ? view.highlight : p === 0 ? [lane, view.highlight[1]] : [view.highlight[0], lane]);
		let next: GroupView = view;
		switch (action.kind) {
			case "window": {
				if (action.scope === "shared") {
					const current = view.shared ?? stored.window;
					const chosen = stepWindow(WINDOWS, current, action.step);
					if (chosen !== current) next = { ...view, shared: chosen === stored.window ? null : chosen };
				} else {
					const current = view.pane[p] ?? paneWindowOf(stored, p);
					const chosen = stepWindow(WINDOWS, current, action.step);
					if (chosen !== current) next = { ...view, pane: p === 0 ? [chosen, view.pane[1]] : [view.pane[0], chosen] };
				}
				if (next !== view) next = this.refreeze(next, stored, encoders, group.heldBucketPx);
				break;
			}
			case "cursor": {
				const pv = view.panes[p];
				if (pv.mode !== "paused" || plot === undefined || plot.buckets === 0) break;
				const bucketMs = windowMs / plot.buckets;
				// Clockwise moves the cursor right, toward the newest bucket.
				const agoMs = Math.min(windowMs - bucketMs, Math.max(0, pv.agoMs - action.delta * bucketMs));
				if (agoMs !== pv.agoMs) next = { ...view, panes: setPane({ ...pv, agoMs }) };
				break;
			}
			case "series":
				next = { ...view, highlight: p === 0 ? [view.highlight[0] + action.step, view.highlight[1]] : [view.highlight[0], view.highlight[1] + action.step] };
				break;
			case "inspect": {
				if (plot === undefined) break;
				const frame = pane.style === "group" ? (group.groupFrames[p] ?? groupFrameOf(pane, this.host.status())) : undefined;
				const series = paneSeriesInputs(config, encoders, p, this.sources(), group.heldBucketPx ?? DEFAULT_BUCKET_PX, frame?.keys);
				// The scales freeze with the copy: a pause never moves one.
				const scales = group.heldScales[p]?.out;
				const paused: PaneView = { mode: "paused", agoMs: cursorAgoMs(plot, windowMs, action.cursor), label: pauseLabel(), frozenAt: this.frameTime(), window: paneWindowOf(config, p), series, ...(frame === undefined ? {} : { group: frame }), ...(scales === undefined ? {} : { scales }) };
				next = { ...view, panes: setPane(paused), highlight: withLane(action.lane) };
				break;
			}
			case "cursorTo": {
				const pv = view.panes[p];
				if (pv.mode !== "paused" || plot === undefined) break;
				next = { ...view, panes: setPane({ ...pv, agoMs: cursorAgoMs(plot, windowMs, action.cursor) }), highlight: withLane(action.lane) };
				break;
			}
			case "live":
				if (view.panes[p].mode !== "live") next = { ...view, panes: setPane(LIVE) };
				break;
			case "groupStep": {
				// Home is position 0, the readings 1 to N; clamped at both ends,
				// so a fast spin left always lands home.
				const keys = this.groupKeysOf(group, p);
				const current = view.groupHighlight[p];
				const at = current === null ? 0 : keys.indexOf(current) + 1;
				const move = Math.sign(action.step) * Math.min(Math.abs(Math.trunc(action.step)), keys.length);
				const to = Math.min(keys.length, Math.max(0, at + move));
				const key = to === 0 ? null : (keys[to - 1] as string);
				if (key !== current) next = { ...view, groupHighlight: withGroupHighlight(view, p, key) };
				break;
			}
			case "groupPick": {
				const key = this.groupKeysOf(group, p)[action.index];
				if (key === undefined) break;
				const pv = view.panes[p];
				const panes = action.cursor !== undefined && pv.mode === "paused" && plot !== undefined ? setPane({ ...pv, agoMs: cursorAgoMs(plot, windowMs, action.cursor) }) : view.panes;
				if (key !== view.groupHighlight[p] || panes !== view.panes) next = { ...view, panes, groupHighlight: withGroupHighlight(view, p, key) };
				break;
			}
			case "groupHome": {
				const panes = action.live && view.panes[p].mode !== "live" ? setPane(LIVE) : view.panes;
				if (view.groupHighlight[p] !== null || panes !== view.panes) next = { ...view, panes, groupHighlight: withGroupHighlight(view, p, null) };
				break;
			}
			case "scale":
			case "scaleAuto": {
				const turned = this.turnScale(group, view, p, action);
				if (turned === null) return;
				next = turned;
				break;
			}
		}
		if (next === view) return;
		group.view = next;
		group.scheduler.invalidate("view");
		this.syncTriggers(group, state);
		this.schedulePanelPush();
	}

	/**
	 * The scale dial on pane `p`, from what the last frame said about it
	 * (LogicalScene.scales, ScaleDialInfo). A detent (src/strip/scale.ts
	 * stepSpan) sets the turned span and drops the pane's held scales, so the
	 * next frame takes the new span at once (the hold is for the data, never
	 * for a person's turn); landing on the span the turn began from ends the
	 * turn and seeds the held scale with that span's placement, Auto going on
	 * from there with its hold. Back to the automatic scale (a long touch or
	 * long push) drops the turn and the held scales: the scale fits the
	 * readings now. A paused pane's frozen scales take the same change, and
	 * so do the live ones it goes back to: a turn made while paused is the
	 * live scale on the first frame after, never held off by the Auto scale
	 * held before the pause. A detent before the next frame steps from the
	 * span the last one set (scaleOnScreen), so a fast spin moves a stop per
	 * detent. Session state only. Null when nothing changes.
	 */
	private turnScale(group: RuntimeGroup, view: GroupView, p: 0 | 1, action: Extract<StripAction, { kind: "scale" | "scaleAuto" }>): GroupView | null {
		const pv = view.panes[p];
		const held = group.heldScales[p];
		const setTurn = (turn: ScaleTurn | null): readonly [ScaleTurn | null, ScaleTurn | null] => (p === 0 ? [turn, view.scaleTurn[1]] : [view.scaleTurn[0], turn]);
		/** `entries` for the scales on view (the frozen copy's while paused),
		 * `live` for the live ones (the same while live). */
		const withHeld = (entries: Record<string, HeldScale>, turn: ScaleTurn | null, live: Record<string, HeldScale> = entries): GroupView => {
			if (held !== undefined) group.heldScales[p] = { ...held, base: live, out: { ...held.out, held: { ...live } } };
			if (pv.mode === "paused") {
				const frozen: PaneView = { ...pv, scales: { held: entries, slots: pv.scales?.slots ?? {} } };
				return { ...view, panes: p === 0 ? [frozen, view.panes[1]] : [view.panes[0], frozen], scaleTurn: setTurn(turn) };
			}
			return { ...view, scaleTurn: setTurn(turn) };
		};
		const shown = group.lastScene?.scales[p]?.dial;
		if (action.kind === "scaleAuto") {
			// The next frame shows the automatic scale's target.
			let auto: number | undefined;
			if (shown !== undefined) {
				const target = autoTarget({ need: shown.need, view: shown.view, kind: shown.kind, maxTicks: shown.maxTicks });
				auto = toView(shown.view, target.hi) - toView(shown.view, target.lo);
			}
			group.scaleOnScreen[p] = auto;
			return withHeld({}, null);
		}
		if (shown === undefined) return null;
		const onScreen = group.scaleOnScreen[p] ?? shown.onScreen;
		const dial = { ...shown, onScreen };
		const start = view.scaleTurn[p]?.start ?? onScreen;
		const next = stepSpan(dial, onScreen, start, action.step);
		if (next === null) return null;
		if (next === "clear") {
			const placed = autoTarget({ need: dial.need, view: dial.view, kind: dial.kind, maxTicks: dial.maxTicks, span: start });
			const seed: HeldScale = { lo: placed.lo, hi: placed.hi, since: null };
			const live = { ...(held?.out.held ?? {}), [dial.key]: seed };
			group.scaleOnScreen[p] = start;
			return withHeld(pv.mode === "paused" ? { ...(pv.scales?.held ?? {}), [dial.key]: seed } : live, null, live);
		}
		group.scaleOnScreen[p] = next;
		return withHeld({}, { span: next, start, sig: group.scaleSetup[p] ?? held?.setup ?? "" });
	}

	/** A paused pane whose window changed takes a new copy of the same
	 * moment in the new window (every window is retained). */
	private refreeze(view: GroupView, stored: StripConfigV1, encoders: StripEncoders, bucketPx: BucketPx | undefined): GroupView {
		const config = effectiveConfig(stored, view);
		const panes = view.panes.map((pv, i) => {
			const p = (i === 1 ? 1 : 0) as 0 | 1;
			const window = paneWindowOf(config, p);
			if (pv.mode !== "paused" || pv.window === window) return pv;
			const width = historyWidthFor(config, encoders, p, bucketPx ?? DEFAULT_BUCKET_PX, tileGridFor(config.panes[p], pv.series.map((s) => s.name)));
			const at = alignedNow(pv.frozenAt, WINDOW_MS[window], width);
			const series = pv.series.map((s) => {
				const history = width > 0 ? this.host.history.view(s.key, window, width, at) : undefined;
				const { history: _old, ...rest } = s;
				void _old;
				return history === undefined ? rest : { ...rest, history };
			});
			// The copy in the new window takes a fresh target; its reserved
			// widths stay with the stored setup.
			const scales = pv.scales === undefined ? {} : { scales: { held: {}, slots: pv.scales.slots } };
			return { ...pv, window, series, agoMs: Math.min(pv.agoMs, WINDOW_MS[window] - 1), ...scales };
		}) as [PaneView, PaneView];
		return { ...view, panes };
	}

	/**
	 * The view under a new authority config (an applied edit, a restore, a
	 * resolve, a newer copy coming into view). A session window whose saved
	 * window the change touched goes back to the saved one. A paused pane
	 * stays paused at the same moment and cursor, and its frozen copy is
	 * re-derived for the new pane: readings it held keep their frozen
	 * values, history is asked again at the frozen time wherever the window
	 * or the plot width changed, and a reading new to the pane gets the
	 * frozen time's history and no current value (the value now is not the
	 * value then). A whole strip paused goes on paused in both halves of a
	 * split, and a paused half pauses the whole strip it becomes.
	 */
	private rebase(group: RuntimeGroup, before: StripConfigV1, after: StripConfigV1, screenKeys?: ScreenKeyMap): GroupView {
		const view = this.screenRebased(group, before, after, screenKeys);
		const layoutChanged = before.layout !== after.layout || before.encoders !== after.encoders;
		const sharingChanged = layoutChanged || before.sharedWindow !== after.sharedWindow;
		const windowReset = sharingChanged || before.window !== after.window;
		const shared = windowReset ? null : view.shared;
		const turned = windowReset ? {} : view.turned;
		const paneWindows = [0, 1].map((i) => (sharingChanged || before.panes[i === 1 ? 1 : 0].window !== after.panes[i === 1 ? 1 : 0].window ? null : view.pane[i === 1 ? 1 : 0])) as [HistoryWindowId | null, HistoryWindowId | null];
		// A changed setup starts every Group pane at home again.
		const windowed: GroupView = { ...view, shared, turned, pane: paneWindows, groupHighlight: [null, null] };
		const encoders = after.encoders;
		const paused = view.panes.some((pv) => pv.mode === "paused");
		if (!paused) return windowed;
		if (encoders === null) return { ...windowed, panes: [LIVE, LIVE], highlight: [0, 0] };
		const sourceOf = (p: 0 | 1): PaneView => {
			if (!layoutChanged) return view.panes[p];
			if (after.layout === "whole") return view.panes[0].mode === "paused" ? view.panes[0] : view.panes[1];
			return before.layout === "whole" ? view.panes[0] : view.panes[p];
		};
		const config = effectiveConfig(after, windowed);
		const bucketPx = group.heldBucketPx ?? DEFAULT_BUCKET_PX;
		const status = this.host.status();
		const panes: [PaneView, PaneView] = [LIVE, LIVE];
		const highlight: [number, number] = [view.highlight[0], view.highlight[1]];
		activePanes(after).forEach((_, i) => {
			const p = (i === 1 ? 1 : 0) as 0 | 1;
			const source = sourceOf(p);
			if (source.mode !== "paused") return;
			const window = paneWindowOf(config, p);
			const windowMs = WINDOW_MS[window];
			const frame = config.panes[p].style === "group" ? groupFrameOf(config.panes[p], status) : undefined;
			const derived = paneSeriesInputs(config, encoders, p, { status, history: this.host.history, now: source.frozenAt, labelOf: (key) => this.labels.get(key) }, bucketPx, frame?.keys);
			const width = historyWidthFor(config, encoders, p, bucketPx, tileGridFor(config.panes[p], derived.map((d) => d.name)));
			const series = derived.map((d) => {
				const old = source.series.find((s) => s.key === d.key);
				if (old === undefined) {
					const { current: _now, ...then } = d;
					void _now;
					return then;
				}
				const fits = old.history !== undefined && old.history.windowMs === windowMs && old.history.widthPx === width;
				const { history: _old, ...rest } = old;
				void _old;
				const history = fits ? old.history : d.history;
				return { ...rest, name: d.name === "" ? old.name : d.name, ...(history === undefined ? {} : { history }) };
			});
			const sameReadings = !layoutChanged && series.length === source.series.length && series.every((s, n) => s.key === source.series[n]?.key);
			if (!sameReadings) highlight[p] = 0;
			panes[p] = { mode: "paused", agoMs: Math.min(source.agoMs, windowMs - 1), label: source.label, frozenAt: source.frozenAt, window, series, ...(frame === undefined ? {} : { group: frame }) };
		});
		return { panes, shared, pane: paneWindows, highlight, groupHighlight: [null, null], screen: view.screen, turned, scaleTurn: view.scaleTurn, scaleTurns: view.scaleTurns };
	}

	/**
	 * The view's screen under a new stored copy: the screen on view (the
	 * first, on a strip never moved to another) stays on view wherever it
	 * moved, so a screen moved from the panel keeps the strip. An applied
	 * edit's `screenKeys` says where each screen went, so a screen keyed by
	 * its place keeps the view when the edit gives it an id; without it a
	 * key names the same screen before and after. A screen that is gone
	 * falls back to the first, which draws live (leaving a screen ends its
	 * inspect); the memory and turned windows of screens that are gone are
	 * dropped.
	 */
	private screenRebased(group: RuntimeGroup, before: StripConfigV1, after: StripConfigV1, screenKeys?: ScreenKeyMap): GroupView {
		const view = group.view;
		const keys = screenKeysOf(after);
		const keyNow = (key: string): string | undefined => (screenKeys === undefined ? (keys.includes(key) ? key : undefined) : screenKeys.get(key));
		const follow = <T>(byKey: Readonly<Record<string, T>>): Record<string, T> => {
			const out: Record<string, T> = {};
			for (const [key, value] of Object.entries(byKey)) {
				const now = keyNow(key);
				if (now !== undefined) out[now] = value;
			}
			return out;
		};
		const memory = [...group.screenMemory];
		group.screenMemory.clear();
		for (const [key, kept] of memory) {
			const now = keyNow(key);
			if (now !== undefined) group.screenMemory.set(now, kept);
		}
		const turned = follow(view.turned);
		const scaleTurns = follow(view.scaleTurns);
		const shown = keyNow(view.screen ?? (screenKeysOf(before)[0] as string));
		if (shown !== undefined) return { ...view, screen: shown, turned, scaleTurns };
		const first = keys[0] as string;
		const shared = turned[first] ?? null;
		delete turned[first];
		const firstTurn = scaleTurns[first] ?? null;
		delete scaleTurns[first];
		group.heldScales[0] = undefined;
		group.scaleOnScreen[0] = undefined;
		return { ...view, screen: null, turned, shared, panes: [LIVE, view.panes[1]], highlight: [0, view.highlight[1]], scaleTurn: [firstTurn, view.scaleTurn[1]], scaleTurns };
	}

	// ---- screens ------------------------------------------------------------------

	/** The Screens dial's column: with two or more screens on a whole strip,
	 * the rightmost present member. */
	private screensColumn(state: StripGroupState): number | undefined {
		const stored = state.authority?.config;
		if (stored === undefined || screenCountOf(stored) < 2) return undefined;
		return screensColumnOf(state.byColumn.keys());
	}

	/**
	 * Shows screen `target` of the stored list. Runtime view only: nothing
	 * is written. The screen left ends its inspect and its highlight, keeps
	 * its turned window and its Group memory for when it comes back; the
	 * new one draws live. A wipe carries the change across the strip in
	 * `direction` (1 next, -1 previous); a change while one runs cuts
	 * straight to the target. The name and place show for SCREEN_NAME_MS.
	 */
	private showScreen(group: RuntimeGroup, state: StripGroupState, target: number, direction: 1 | -1): boolean {
		const stored = state.authority?.config;
		if (stored === undefined || state.health !== "ok" || screenCountOf(stored) < 2) return false;
		const keys = screenKeysOf(stored);
		const from = screenIndexOf(stored, group.view);
		if (target === from || target < 0 || target >= keys.length) return false;
		const fromKey = keys[from] as string;
		const toKey = keys[target] as string;
		const view = group.view;
		const turned: Record<string, HistoryWindowId> = { ...view.turned };
		if (view.shared === null) delete turned[fromKey];
		else turned[fromKey] = view.shared;
		const shared = turned[toKey] ?? null;
		delete turned[toKey];
		// A screen keeps its turned scale for the session, as its window.
		const scaleTurns: Record<string, ScaleTurn> = { ...view.scaleTurns };
		const leaving = view.scaleTurn[0];
		if (leaving === null) delete scaleTurns[fromKey];
		else scaleTurns[fromKey] = leaving;
		const arriving = scaleTurns[toKey] ?? null;
		delete scaleTurns[toKey];
		group.view = { ...view, screen: toKey, turned, shared, panes: [LIVE, view.panes[1]], highlight: [0, view.highlight[1]], groupHighlight: [null, view.groupHighlight[1]], scaleTurn: [arriving, view.scaleTurn[1]], scaleTurns };
		group.screenMemory.set(fromKey, { groupMemory: group.groupMemory[0], groupHome: group.groupHome[0], heldScale: group.heldScales[0] });
		const memory = group.screenMemory.get(toKey);
		group.screenMemory.delete(toKey);
		group.groupMemory[0] = memory?.groupMemory ?? { sig: "", keys: [] };
		group.groupHome[0] = memory?.groupHome;
		group.heldScales[0] = memory?.heldScale;
		group.scaleOnScreen[0] = undefined;
		group.dialFlags[0] = false;
		group.groupFrames[0] = undefined;
		// A heavy screen's coarse buckets are not the next one's.
		group.heldBucketPx = undefined;
		const running = group.transition !== null;
		this.endTransition(group);
		group.transition = running ? { kind: "cut", direction } : { kind: "wipe", direction, step: 0, slices: null, order: [], builtAt: null };
		group.nameUntil = this.now() + SCREEN_NAME_MS;
		if (group.nameTimer !== null) this.clock.clearTimeout(group.nameTimer);
		group.nameTimer = this.clock.setTimeout(() => {
			group.nameTimer = null;
			group.scheduler.invalidate("view");
		}, SCREEN_NAME_MS);
		this.syncInterest(group, state);
		group.scheduler.invalidate("view");
		this.syncTriggers(group, state);
		this.schedulePanelPush();
		return true;
	}

	/** Ends a running screen change and its pending step. */
	private endTransition(group: RuntimeGroup): void {
		group.transition = null;
		if (group.stepTimer !== null) this.clock.clearTimeout(group.stepTimer);
		group.stepTimer = null;
	}

	/** One more frame, MIN_FRAME_MS after this one (a wipe's next step, or
	 * the data that arrived while it ran). */
	private afterFrame(group: RuntimeGroup, reason: InvalidateReason): void {
		if (group.stepTimer !== null) this.clock.clearTimeout(group.stepTimer);
		group.stepTimer = this.clock.setTimeout(() => {
			group.stepTimer = null;
			group.scheduler.invalidate(reason);
		}, MIN_FRAME_MS);
	}

	/** Any strip input or strip Control command: the next automatic screen
	 * comes one full period from now. */
	private restartCycle(group: RuntimeGroup, stored: StripConfigV1): void {
		if (group.cycleDueAt !== null && stored.screenCycle !== undefined) group.cycleDueAt = this.now() + stored.screenCycle * 1000;
	}

	/** Whether the automatic cycle waits: HWiNFO stopped, a pane inspecting,
	 * or a member's settings panel open (so the editor never changes under
	 * the pointer). */
	private cycleHeld(group: RuntimeGroup, status: PollerStatus): boolean {
		return status.state !== "ok" || group.view.panes.some((pv) => pv.mode === "paused") || this.panelWatches(group.key);
	}

	/**
	 * The automatic cycle, timed on poll ticks: armed one full period after
	 * it may run, it shows the next screen that has something to draw
	 * (wrapping, with the next wipe), and arms again. Held, it disarms, so
	 * it starts a full period after it is released.
	 */
	private cycleTick(group: RuntimeGroup, status: PollerStatus): void {
		const state = this.registry.group(group.key);
		const stored = state?.authority?.config;
		const period = stored?.screenCycle;
		if (state === undefined || stored === undefined || period === undefined || state.health !== "ok" || screenCountOf(stored) < 2 || this.cycleHeld(group, status)) {
			group.cycleDueAt = null;
			return;
		}
		const now = this.now();
		if (group.cycleDueAt === null) {
			group.cycleDueAt = now + period * 1000;
			return;
		}
		if (now < group.cycleDueAt) return;
		group.cycleDueAt = now + period * 1000;
		const screens = screensOf(stored);
		const from = screenIndexOf(stored, group.view);
		for (let k = 1; k < screens.length; k++) {
			const i = (from + k) % screens.length;
			if (screenHasData(screens[i] as StripPaneV1, status)) {
				this.showScreen(group, state, i, 1);
				return;
			}
		}
	}

	/** What a frame draws about the screens: the position line, each
	 * hidden screen's critical mark (judged once per data frame), and the
	 * name and place while they are due. */
	private screenFrameOf(group: RuntimeGroup, stored: StripConfigV1, status: PollerStatus): ScreenFrame | undefined {
		const count = screenCountOf(stored);
		if (count < 2) return undefined;
		const at = screenIndexOf(stored, group.view);
		const screens = screensOf(stored);
		const frameAt = this.frameTime();
		if (group.alerts === null || group.alerts.at !== frameAt || group.alerts.screen !== at || group.alerts.config !== stored) {
			const keys = screenKeysOf(stored);
			const marks = screens.map((pane, i) => i !== at && screenCritical(pane, status, stored.fahrenheit, this.ruleKeysOf(group, keys[i] as string, pane, status)));
			group.alerts = { at: frameAt, screen: at, config: stored, marks };
		}
		const alerts = group.alerts.marks;
		const snapshot = status.state === "unavailable" ? null : status.snapshot;
		const label = this.now() < group.nameUntil ? screenLabelOf(screens[at] as StripPaneV1, at, count, snapshot, (key) => this.labels.get(key), { fahrenheit: stored.fahrenheit }) : undefined;
		return { count, at, alerts, ...(label === undefined ? {} : { label }) };
	}

	/** A hidden rule screen's readings for its critical mark: resolved
	 * again once RULE_KEYS_MS old or when its rule changed, so a strip of
	 * filter screens does not resolve each of them on every data frame. */
	private ruleKeysOf(group: RuntimeGroup, key: string, pane: StripPaneV1, status: PollerStatus): readonly string[] | undefined {
		if (!screenNeedsRule(pane) || status.state !== "ok") return undefined;
		const sig = groupSignature(pane);
		const now = this.now();
		const kept = group.ruleKeys.get(key);
		if (kept !== undefined && kept.sig === sig && now - kept.at < RULE_KEYS_MS) return kept.keys;
		const keys = groupFrameOf(pane, status).keys;
		group.ruleKeys.set(key, { sig, at: now, keys });
		for (const k of [...group.ruleKeys.keys()]) if (now - (group.ruleKeys.get(k)?.at ?? now) > RULE_KEYS_MS * 6) group.ruleKeys.delete(k);
		return keys;
	}

	/** One frame of a wipe: the columns it has reached show the new screen
	 * (built once, at its first frame), the rest keep the slice they show,
	 * so each frame changes one slice and sends one. */
	private wipeStep(group: RuntimeGroup, members: readonly FrameMember[], wipe: Extract<Transition, { kind: "wipe" }>): Map<string, string> {
		const state = this.registry.group(group.key);
		const slices = wipe.slices ?? new Map<string, string>();
		wipe.step++;
		const wiped = new Set(wipe.order.slice(0, wipe.step));
		const out = new Map<string, string>();
		for (const m of members) {
			const next = slices.get(m.context);
			if (next === undefined) continue;
			const owns = state?.byColumn.get(m.column)?.context === m.context;
			const shown = owns && !wiped.has(m.column) ? this.lastSlice.get(m.context) : undefined;
			out.set(m.context, shown ?? next);
		}
		if (wipe.step >= wipe.order.length) {
			const builtAt = wipe.builtAt;
			this.endTransition(group);
			// Data that came while the wipe ran draws next.
			if (this.frameNow !== builtAt) this.afterFrame(group, "data");
		} else {
			this.afterFrame(group, "view");
		}
		return out;
	}

	/** The panel's view of the screens (src/strip/pi.ts): each screen with
	 * its id, name, automatic name, style and place, the one on view, the
	 * cycle and whether it waits now. */
	screenState(key: string | undefined, stored: StripConfigV1): { screens: { screenId: string; name: string; autoName: string; style: string; index: number }[]; screen: string; screenCycle: number | null; cycleHeld: boolean } {
		const group = key === undefined ? undefined : this.groups.get(key);
		const keys = screenKeysOf(stored);
		const status = this.host.status();
		const snapshot = status.state === "unavailable" ? null : status.snapshot;
		const at = group === undefined ? 0 : screenIndexOf(stored, group.view);
		const screens = screensOf(stored).map((pane, index) => ({ screenId: keys[index] as string, name: pane.name ?? "", autoName: autoScreenName(pane, snapshot, (k) => this.labels.get(k), { fahrenheit: stored.fahrenheit }), style: pane.storedStyle ?? pane.style, index }));
		const cycling = stored.screenCycle !== undefined && screenCountOf(stored) >= 2;
		return { screens, screen: keys[at] as string, screenCycle: stored.screenCycle ?? null, cycleHeld: cycling && group !== undefined && this.cycleHeld(group, status) };
	}

	/** The panel chose a screen (stripShowScreen): show it on the strip, as
	 * a runtime view, never a write. Unknown ids change nothing. */
	showScreenFor(context: string, screenId: unknown): void {
		const slot = this.registry.slotOf(context);
		const group = slot === undefined ? undefined : this.groups.get(slot.group.key);
		const stored = slot?.group.authority?.config;
		if (slot === undefined || group === undefined || stored === undefined || typeof screenId !== "string") return;
		const target = screenKeysOf(stored).indexOf(screenId);
		const at = screenIndexOf(stored, group.view);
		if (target < 0 || target === at) return;
		this.restartCycle(group, stored);
		this.showScreen(group, slot.group, target, target > at ? 1 : -1);
	}

	// ---- membership bookkeeping ---------------------------------------------------

	private forgetContext(context: string): void {
		this.handles.delete(context);
		this.gestures.delete(context);
		this.triggers.delete(context);
		this.lastSlice.delete(context);
		this.claimed.delete(context);
		for (const group of this.groups.values()) group.scheduler.forget(context);
		if (this.drafts.delete(context)) this.dropDraftInterest(context);
	}

	private dropDraftInterest(context: string): void {
		this.host.history.dropInterest(draftConsumer(context));
		this.host.history.dropInterest(draftGroupConsumer(context));
		this.host.history.dropInterest(`${draftGroupConsumer(context)}:ambient`);
	}

	private apply(changes: readonly StripChange[], reason: InvalidateReason, screens?: { readonly group: string; readonly keys: ScreenKeyMap }): void {
		const restore = new Map<string, boolean>();
		const touched = new Set<string>();
		for (const change of changes) {
			for (const key of change.groups) touched.add(key);
			for (const shown of change.shown ?? []) {
				restore.set(shown.key, shown.restoreView);
				touched.add(shown.key);
			}
		}
		for (const key of touched) this.refresh(key, reason, restore.get(key), screens?.group === key ? screens.keys : undefined);
		this.reconcileClaims();
		if (touched.size > 0) this.pushPanel();
	}

	private refresh(key: string, reason: InvalidateReason, restore: boolean | undefined, screenKeys?: ScreenKeyMap): void {
		const state = this.registry.group(key);
		const joined = state === undefined ? 0 : state.byColumn.size + state.outside.length;
		let group = this.groups.get(key);
		if (state === undefined || joined === 0) {
			if (group !== undefined) this.disposeGroup(group);
			return;
		}
		if (group === undefined) group = this.create(key, restore === true);
		const authority = state.authority === null ? "" : `${state.authority.id}@${state.authority.rev}`;
		if (reason === "membership" || authority !== group.authority) {
			// A membership or authority change during a held press consumes it.
			for (const m of [...state.byColumn.values(), ...state.outside]) {
				const held = this.gestures.get(m.context);
				if (held !== undefined) this.gestures.set(m.context, consumed(held));
			}
			// A screen change in flight ends: the next frame draws whole.
			this.endTransition(group);
		}
		const config = state.authority?.config ?? null;
		if (authority !== group.authority && group.drawn !== null && config !== null) group.view = this.rebase(group, group.drawn, config, screenKeys);
		if (config !== null) group.drawn = config;
		group.authority = authority;
		this.syncInterest(group, state);
		group.scheduler.invalidate(reason);
		this.syncTriggers(group, state);
	}

	private create(key: string, restore: boolean): RuntimeGroup {
		this.pruneKept();
		const kept = this.kept.get(key);
		this.kept.delete(key);
		const restored = restore && kept !== undefined ? kept : undefined;
		const group: RuntimeGroup = { key, view: restored?.view ?? freshView(), heldBucketPx: undefined, sinceProbe: 0, probeSig: "", probeView: null, lastScene: null, interest: "", authority: "", drawn: restored?.drawn ?? null, groupFrames: [undefined, undefined], groupMemory: [{ sig: "", keys: [] }, { sig: "", keys: [] }], groupInterest: "", groupHome: [undefined, undefined], heldScales: [undefined, undefined], scaleOnScreen: [undefined, undefined], scaleSetup: [undefined, undefined], dialFlags: [false, false], transition: null, nameUntil: Number.NEGATIVE_INFINITY, nameTimer: null, stepTimer: null, cycleDueAt: null, screenMemory: new Map(), alerts: null, ruleKeys: new Map(), scheduler: undefined as unknown as GroupScheduler };
		group.scheduler = new GroupScheduler({
			clock: this.clock,
			members: () => this.frameMembers(key),
			isCurrent: (context, epoch) => this.registry.isCurrent(context, epoch),
			render: (members, generation) => this.renderFrame(group, members, generation),
			send: (context, svg, generation) => this.send(context, svg, generation),
			budget: this.budget
		});
		this.groups.set(key, group);
		return group;
	}

	private disposeGroup(group: RuntimeGroup): void {
		group.scheduler.dispose();
		this.endTransition(group);
		if (group.nameTimer !== null) this.clock.clearTimeout(group.nameTimer);
		group.nameTimer = null;
		group.nameUntil = Number.NEGATIVE_INFINITY;
		group.cycleDueAt = null;
		this.groups.delete(group.key);
		this.host.history.dropInterest(paneConsumer(group.key, 0));
		this.host.history.dropInterest(paneConsumer(group.key, 1));
		this.host.history.dropInterest(groupConsumer(group.key, 0));
		this.host.history.dropInterest(groupConsumer(group.key, 1));
		this.kept.delete(group.key);
		this.kept.set(group.key, { at: this.now(), view: group.view, drawn: group.drawn });
		this.pruneKept();
	}

	private pruneKept(): void {
		const now = this.now();
		for (const [key, entry] of this.kept) if (now - entry.at > VIEW_LINEAGE_TTL_MS) this.kept.delete(key);
		while (this.kept.size > KEPT_CAP) this.kept.delete(this.kept.keys().next().value as string);
	}

	private reconcileClaims(): void {
		for (const context of [...this.handles.keys()]) {
			const now = this.registry.claims(context);
			const before = this.claimed.has(context);
			if (now === before) continue;
			if (now) {
				this.claimed.add(context);
				this.host.claimChanged(context, true);
			} else {
				this.claimed.delete(context);
				this.gestures.delete(context);
				this.triggers.delete(context);
				this.lastSlice.delete(context);
				for (const group of this.groups.values()) group.scheduler.forget(context);
				this.host.claimChanged(context, false);
			}
		}
		for (const context of [...this.claimed]) if (!this.handles.has(context)) this.claimed.delete(context);
	}

	private syncInterest(group: RuntimeGroup, state: StripGroupState): void {
		// The screen on view only: a hidden screen holds no interest (its
		// history lingers in the store for a while after it leaves).
		const stored = state.health === "ok" ? state.authority?.config : undefined;
		const config = stored === undefined ? undefined : effectiveConfig(stored, group.view);
		const entries: [string[], string[]] = [[], []];
		if (config !== undefined) {
			activePanes(config).forEach((pane, i) => {
				// Only the readings the style draws: a reading kept past its
				// style's limit holds no history budget. A Group or Ambient pane's
				// readings are asked for per frame from the group allowance
				// instead (syncGroupInterest).
				entries[i === 1 ? 1 : 0] = isRuleStyle(pane.style) ? [] : drawnSeries(pane).map((s) => s.key);
			});
		}
		const signature = JSON.stringify(entries);
		if (signature === group.interest) return;
		group.interest = signature;
		entries.forEach((keys, i) => {
			const id = paneConsumer(group.key, i);
			if (keys.length === 0) this.host.history.dropInterest(id);
			else this.host.history.setInterest(id, keys.map((savedKey) => ({ savedKey, window: WINDOWS })));
		});
	}

	/**
	 * Each Group pane's readings for the next frame: its rule against the
	 * snapshot, with the readings it drew before kept in place where HWiNFO
	 * no longer lists them (forgotten when the rule changes). Sets the panes'
	 * interest: the shown window only, from the group allowance.
	 */
	private groupFramesOf(group: RuntimeGroup, config: StripConfigV1, status: PollerStatus): [GroupFrame | undefined, GroupFrame | undefined] {
		const frames: [GroupFrame | undefined, GroupFrame | undefined] = [undefined, undefined];
		activePanes(config).forEach((pane, i) => {
			const p = (i === 1 ? 1 : 0) as 0 | 1;
			if (!isRuleStyle(pane.style)) return;
			const sig = groupSignature(pane);
			const memory = group.groupMemory[p];
			const frame = groupFrameOf(pane, status, memory.sig === sig ? memory.keys : []);
			group.groupMemory[p] = { sig, keys: frame.keys };
			frames[p] = frame;
		});
		group.groupFrames = frames;
		this.syncGroupInterest(group, config, frames);
		return frames;
	}

	/**
	 * The live Group panes' home readings, held against close calls: judged
	 * once per data frame (a repaint for input judges nothing), against a
	 * margin of 0.5 % of the readings' span or one display step, whichever
	 * is larger. A paused pane names its highest at the cursor instead.
	 */
	private withHomeKeys(group: RuntimeGroup, config: StripConfigV1, input: StripSceneInput): StripSceneInput {
		const at = this.frameTime();
		let changed = false;
		const panes = input.panes.map((paneInput, i) => {
			const p = (i === 1 ? 1 : 0) as 0 | 1;
			const pane = config.panes[p];
			if (pane.style !== "group" || paneInput.group === undefined || paneInput.view.mode !== "live") return paneInput;
			const sig = groupSignature(pane);
			const before = group.groupHome[p];
			let state = before !== undefined && before.sig === sig ? before.state : undefined;
			if (before === undefined || before.sig !== sig || before.at !== at) {
				const candidates = paneInput.series.flatMap((s) => (s.state !== "missing" && s.current !== undefined && Number.isFinite(s.current) ? [{ key: s.key, value: s.current }] : []));
				let lo = Number.POSITIVE_INFINITY;
				let hi = Number.NEGATIVE_INFINITY;
				for (const s of paneInput.series) {
					for (const v of [s.history?.extent?.min, s.history?.extent?.max, s.current]) {
						if (v === undefined || !Number.isFinite(v)) continue;
						lo = Math.min(lo, v);
						hi = Math.max(hi, v);
					}
				}
				const current = candidates.find((c) => c.key === state?.key) ?? candidates[0];
				const step = current === undefined ? 0 : displayStep(formatValue(current.value, config.decimals));
				const margin = Math.max(hi > lo ? 0.005 * (hi - lo) : 0, step);
				state = nextHome(state, candidates, margin, pane.group?.limits?.below === true);
				group.groupHome[p] = { state, at, sig };
			}
			if (state === undefined) return paneInput;
			changed = true;
			return { ...paneInput, group: { ...paneInput.group, homeKey: state.key } };
		});
		return changed ? { ...input, panes } : input;
	}

	private syncGroupInterest(group: RuntimeGroup, config: StripConfigV1, frames: readonly (GroupFrame | undefined)[]): void {
		const entries = [0, 1].map((p) => {
			const frame = frames[p];
			if (frame === undefined) return [];
			const window = paneWindowOf(config, p);
			return frame.keys.map((savedKey) => ({ savedKey, window }));
		});
		// An Ambient pane pays from the Ambient share of the group allowance.
		const pools = [0, 1].map((p) => poolOf(config.panes[p === 1 ? 1 : 0]));
		const signature = JSON.stringify([entries, pools]);
		if (signature === group.groupInterest) return;
		group.groupInterest = signature;
		entries.forEach((list, p) => {
			const id = groupConsumer(group.key, p);
			if (list.length === 0) this.host.history.dropInterest(id);
			else this.host.history.setInterest(id, list, { pool: pools[p] as "group" | "ambient" });
		});
	}

	/**
	 * Each pane's scale state for this frame (src/strip/scale.ts): the
	 * scales it held after the last data frame, judged again at this frame's
	 * time (a repaint for input passes the time and the scales of the last
	 * data frame, so it judges nothing new), its reserved widths while the
	 * stored setup holds, and its turned span. A paused pane passes the
	 * scales it froze. A turn made for another stored setup is dropped; a
	 * changed hold signature (window, readings, units, °F, Data units, the
	 * typed scale, the plot) starts the held scales over at their targets.
	 * Returns the input and, per live pane, what to hold after the frame.
	 */
	private withScales(group: RuntimeGroup, config: StripConfigV1, encoders: StripEncoders, input: StripSceneInput): { input: StripSceneInput; pending: [Omit<PaneHeld, "out"> | undefined, Omit<PaneHeld, "out"> | undefined] } {
		const at = this.frameTime();
		const pending: [Omit<PaneHeld, "out"> | undefined, Omit<PaneHeld, "out"> | undefined] = [undefined, undefined];
		let view = group.view;
		const panes = input.panes.map((paneInput, i): StripPaneInput => {
			const p = (i === 1 ? 1 : 0) as 0 | 1;
			const setup = scaleSetupOf(config, encoders, p, paneInput, input.dataUnits);
			group.scaleSetup[p] = setup;
			const sig = JSON.stringify([setup, paneWindowOf(config, p)]);
			let turn = view.scaleTurn[p];
			if (turn !== null && turn.sig !== setup) {
				view = { ...view, scaleTurn: p === 0 ? [null, view.scaleTurn[1]] : [view.scaleTurn[0], null] };
				turn = null;
			}
			const span = turn === null ? {} : { span: turn.span };
			const pv = view.panes[p];
			if (pv.mode === "paused") {
				const frozen = pv.scales;
				return { ...paneInput, scale: { ...(frozen === undefined ? {} : { prev: frozen.held, slots: frozen.slots }), at: pv.frozenAt, ...span } };
			}
			const before = group.heldScales[p];
			const prev = before !== undefined && before.sig === sig ? (before.at === at ? before.base : before.out.held) : undefined;
			const slots = before !== undefined && before.setup === setup ? before.out.slots : undefined;
			pending[p] = { sig, setup, at, base: prev };
			return { ...paneInput, scale: { ...(prev === undefined ? {} : { prev }), at, ...span, ...(slots === undefined ? {} : { slots }) } };
		});
		if (view !== group.view) group.view = view;
		return { input: { ...input, panes }, pending };
	}

	/** Keeps what a frame's scales came to (live panes), and whether each
	 * pane takes the scale dial; true when that changed (the hints follow).
	 * The frame shows the spans the detents before it set. */
	private keepScales(group: RuntimeGroup, scene: LogicalScene, pending: readonly (Omit<PaneHeld, "out"> | undefined)[]): boolean {
		let flipped = false;
		group.scaleOnScreen = [undefined, undefined];
		for (const p of [0, 1] as const) {
			const out = scene.scales[p] ?? null;
			const pend = pending[p];
			if (pend !== undefined && out !== null) group.heldScales[p] = { ...pend, out };
			const flag = out?.dial !== undefined;
			if (flag !== group.dialFlags[p]) {
				group.dialFlags[p] = flag;
				flipped = true;
			}
		}
		return flipped;
	}

	/** A Group pane's drawn readings as the person sees them: the frozen
	 * copy's while paused, else the last frame's. */
	private groupKeysOf(group: RuntimeGroup, p: 0 | 1): readonly string[] {
		const pv = group.view.panes[p];
		if (pv.mode === "paused" && pv.group !== undefined) return pv.group.keys;
		return group.groupFrames[p]?.keys ?? [];
	}

	/** A Tiles pane's grid (src/strip/tiles.ts) as the person sees it: from
	 * the frozen copy's readings while paused, else from the drawn readings'
	 * labels as a frame names them (paneSeriesInputs). Undefined on any
	 * other pane. */
	private tileGridOf(group: RuntimeGroup, p: 0 | 1, pane: StripPaneV1): readonly number[] | undefined {
		if (pane.style !== "group" || groupRuleOf(pane).view !== "tiles") return undefined;
		const pv = group.view.panes[p];
		if (pv.mode === "paused" && pv.group !== undefined) return tileGridFor(pane, pv.series.map((s) => s.name));
		const status = this.host.status();
		const snapshot = status.state === "unavailable" ? undefined : status.snapshot;
		return tileGridFor(pane, this.groupKeysOf(group, p).map((key) => snapshot?.byKey.get(key)?.label ?? this.labels.get(key) ?? ""));
	}

	private syncTriggers(group: RuntimeGroup, state: StripGroupState): void {
		const authority = state.authority;
		const ok = state.health === "ok" && authority !== null && authority.config.encoders !== null;
		for (const m of [...state.byColumn.values(), ...state.outside]) {
			const handle = this.handles.get(m.context);
			if (handle === undefined) continue;
			let text: StripHints = IDLE_TRIGGERS;
			if (ok && state.byColumn.get(m.column)?.context === m.context && authority.config.encoders !== null) {
				const config = effectiveConfig(authority.config, group.view);
				const p = config.layout === "whole" ? 0 : m.column < authority.config.encoders / 2 ? 0 : 1;
				const pane = config.panes[p];
				const mode = group.view.panes[p].mode;
				text = stripTriggerDescriptions({ layout: config.layout, sharedWindow: config.sharedWindow, mode, seriesChoice: hasSeriesChoice({ style: pane.style, seriesCount: pane.series.length, ...(pane.readout === undefined ? {} : { readout: pane.readout }), mode }), group: pane.style === "group", style: pane.style, scaleDial: group.dialFlags[p], tiles: pane.style === "group" && groupRuleOf(pane).view === "tiles", highlighted: group.view.groupHighlight[p] !== null });
				if (m.column === this.screensColumn(state)) text = screensTriggerDescriptions(text);
			}
			const signature = JSON.stringify(text);
			if (this.triggers.get(m.context) === signature) continue;
			this.triggers.set(m.context, signature);
			void handle.setTriggerDescription(text).catch(() => this.triggers.delete(m.context));
		}
	}

	// ---- frames -----------------------------------------------------------------

	private now(): number {
		return this.clock.now();
	}

	/** The frame time: the moment the data last changed (a frame with
	 * nothing new draws the same bytes and is not resent). */
	private frameTime(): number {
		this.frameNow ??= this.now();
		return this.frameNow;
	}

	private sources(): FrameSources {
		return { status: this.host.status(), history: this.host.history, now: this.frameTime(), labelOf: (key) => this.labels.get(key) };
	}

	private noteLabels(status: Extract<PollerStatus, { state: "ok" | "stale" }>): void {
		for (const group of this.groups.values()) {
			const config = this.registry.group(group.key)?.authority?.config;
			if (config === undefined) continue;
			// A Group pane's readings too, so one HWiNFO stops listing keeps
			// its name on the strip; and every screen's, for its name.
			const panes = config.layout === "whole" ? screensOf(config) : activePanes(config);
			const keys = [...panes.flatMap((pane) => pane.series.map((s) => s.key)), ...group.groupFrames.flatMap((frame) => frame?.keys ?? [])];
			for (const key of keys) {
				const label = status.snapshot.byKey.get(key)?.label;
				if (label === undefined || this.labels.get(key) === label) continue;
				this.labels.delete(key);
				this.labels.set(key, label);
				while (this.labels.size > LABEL_CAP) this.labels.delete(this.labels.keys().next().value as string);
			}
		}
	}

	private frameMembers(key: string): FrameMember[] {
		const state = this.registry.group(key);
		if (state === undefined) return [];
		// During a screen change the slices go out in its direction (next
		// from the right, previous from the left), never in appear order.
		const direction = this.groups.get(key)?.transition?.direction;
		const owners = direction === undefined ? [...state.byColumn.values()] : [...state.byColumn.values()].sort((a, b) => direction * (b.column - a.column));
		return [...owners, ...state.outside].map((m) => ({ context: m.context, epoch: m.epoch, column: m.column }));
	}

	/** A Stars or Nebula face's piece of the deck's scene above this
	 * column (src/ui/deck-art.ts); any other face passes through. */
	private painted(svg: string, deviceId: string, column: number, context: string): string {
		return paintArt(svg, () => {
			const caps = this.capabilityLookup.get(deviceId);
			return artPlace({ id: deviceId, type: caps.type, columns: caps.columns, rows: caps.rows }, { column, row: 0 }, context, true);
		});
	}

	/** One frame of one group from one snapshot, synchronously. */
	private renderFrame(group: RuntimeGroup, members: readonly FrameMember[], generation: number): Map<string, string> {
		const transition = group.transition;
		// A wipe's later frames: the slices it began with, one more column.
		if (transition?.kind === "wipe" && transition.slices !== null) return this.wipeStep(group, members, transition);
		const out = new Map<string, string>();
		const state = this.registry.group(group.key);
		const authority = state?.authority;
		if (state === undefined || authority === null || authority === undefined) {
			this.endTransition(group);
			return out;
		}
		const stored = authority.config;
		if (state.health !== "ok" || stored.encoders === null) {
			this.endTransition(group);
			const face = stripMessage(healthLines(state, stored), stored);
			for (const m of members) out.set(m.context, this.painted(face, state.deviceId, m.column, m.context));
			group.lastScene = null;
			group.scaleOnScreen = [undefined, undefined];
			return out;
		}
		const encoders = stored.encoders;
		const present = Array.from({ length: encoders }, (_, c) => state.byColumn.has(c));
		// An empty slot whose dial is on screen holding a left copy of this
		// strip: that dial left, it is not missing.
		const left = present.map((here, c) => !here && state.dormant.some((m) => m.column === c));
		const notice = state.conflict === null ? undefined : state.conflict.kind === "tie" ? "Strip copies differ, see dial settings" : "Pasted strip setup differs, see dial settings";
		const effective = effectiveConfig(stored, group.view);
		const sources = this.sources();
		const groups = this.groupFramesOf(group, effective, sources.status);
		const screens = stored.layout === "whole" ? this.screenFrameOf(group, stored, sources.status) : undefined;
		const input = frameInput({
			config: effective,
			encoders,
			view: group.view,
			sources,
			present,
			left,
			generation,
			historyBucketPx: group.heldBucketPx ?? DEFAULT_BUCKET_PX,
			groups,
			...(notice === undefined ? {} : { notice }),
			...(screens === undefined ? {} : { screens })
		});
		const probeSig = `${authority.id}:${authority.rev}`;
		const probe = group.heldBucketPx === undefined || probeSig !== group.probeSig || group.view !== group.probeView || group.sinceProbe + 1 >= HOLD_PROBE_FRAMES;
		const scaled = this.withScales(group, effective, encoders, this.withHomeKeys(group, effective, input));
		const result = sliceStrip(scaled.input, group.heldBucketPx, probe);
		group.sinceProbe = probe ? 0 : group.sinceProbe + 1;
		group.probeSig = probeSig;
		group.probeView = group.view;
		group.heldBucketPx = result.bucketPx;
		group.lastScene = result.scene;
		// A pane that starts or stops taking the scale dial (a Yes/No reading
		// arrived, a typed end applies) re-sends its hints.
		if (this.keepScales(group, result.scene, scaled.pending)) this.syncTriggers(group, state);
		let outsideFace: string | undefined;
		for (const m of members) {
			if (state.byColumn.get(m.column)?.context === m.context) {
				const svg = result.slices[m.column];
				if (typeof svg === "string") out.set(m.context, this.painted(svg, state.deviceId, m.column, m.context));
			} else {
				outsideFace ??= stripMessage(["This dial is outside", "its strip"], stored);
				out.set(m.context, this.painted(outsideFace, state.deviceId, m.column, m.context));
			}
		}
		if (this.panelWatches(group.key)) this.schedulePanelPush();
		if (transition === null) return out;
		if (transition.kind === "cut") {
			this.endTransition(group);
			return out;
		}
		// A wipe's first frame: the new screen is built once, here, and the
		// wipe steps over the slices it changes (an identical one costs no
		// frame; a slice never shown takes the new screen at once).
		transition.slices = out;
		transition.order = wipeOrder(
			members.filter((m) => state.byColumn.get(m.column)?.context === m.context && this.lastSlice.has(m.context) && out.get(m.context) !== this.lastSlice.get(m.context)).map((m) => m.column),
			transition.direction
		);
		transition.builtAt = this.frameNow;
		return this.wipeStep(group, members, transition);
	}

	private send(context: string, svg: string, generation: number): Promise<void> | void {
		const handle = this.handles.get(context);
		if (handle === undefined) return;
		this.lastSlice.set(context, svg);
		const queuedAt = performance.now();
		const sent = handle.setFeedback({ canvas: feedbackUri(svg) });
		if (traceEnabled()) void sent.then(() => trace({ event: "stripRender", context, note: `frame ${generation}`, renderQueuedAt: queuedAt, renderDoneAt: performance.now() }));
		return sent;
	}

	// ---- writes ---------------------------------------------------------------------

	private sendSettings(handle: StripDialHandle, settings: Record<string, unknown>): void {
		void handle.setSettings(settings as JsonObject).catch((err: unknown) => this.host.log?.(`strip settings write failed: ${String(err)}`));
	}

	/**
	 * Writes complete documents, one per member, in one synchronous loop
	 * (no await inside), then settles membership once. Returns the contexts
	 * that could not be written because they are no longer visible.
	 */
	commit(writes: readonly PlannedWrite[], screens?: { readonly group: string; readonly keys: ScreenKeyMap }): string[] {
		const unwritten: string[] = [];
		const changes: StripChange[] = [];
		for (const w of writes) {
			const handle = this.handles.get(w.context);
			if (handle === undefined || this.registry.member(w.context) === undefined) {
				unwritten.push(w.context);
				continue;
			}
			this.host.stored(w.context, w.settings);
			this.sendSettings(handle, w.settings);
			changes.push(this.registry.noteWritten(w.context, w.settings));
		}
		this.apply(changes, "config", screens);
		return unwritten;
	}

	/** The config of every strip on screen (a live group with a visible
	 * joined member), once each. */
	liveConfigs(): StripConfigV1[] {
		const out: StripConfigV1[] = [];
		for (const group of this.registry.groups()) if (group.authority !== null && (group.byColumn.size > 0 || group.outside.length > 0)) out.push(group.authority.config);
		return out;
	}

	/**
	 * "Use it everywhere" (src/ui/shared-looks.ts) over the visible dials in
	 * `scope` (every visible dial when absent), one write per dial at most:
	 * a live strip whose own Background or Words predates generation `gen`
	 * goes back to Default in one edit (rev + 1) written to each visible
	 * joined member; a member holding an older such copy than its group's
	 * takes the group's copy; `own` drops a dial's own stale looks in the
	 * same write (undefined when it has none). A strip whose copies differ
	 * (a tie or a pasted copy waiting for a choice) is left for the person.
	 * Returns the contexts written.
	 */
	resetLooks(gen: number, scope: Iterable<string> | undefined, own: (settings: SettingsDoc) => Record<string, unknown> | undefined): string[] {
		const writes: PlannedWrite[] = [];
		const done = new Set<string>();
		const groupsSeen = new Set<string>();
		const ownOrSame = (settings: SettingsDoc): SettingsDoc => own(settings) ?? settings;
		for (const context of scope ?? [...this.handles.keys()]) {
			if (done.has(context)) continue;
			const member = this.registry.member(context);
			const settings = this.host.settingsOf(context);
			if (member === undefined || settings === undefined) continue;
			const copy = member.copy;
			const state = copy?.joined === true ? this.registry.group(stripGroupKey(member.deviceId, copy.id)) : undefined;
			const authority = state?.conflict === null && member.foreign === undefined ? state.authority : null;
			if (state !== undefined && authority !== null && !groupsSeen.has(state.key)) {
				groupsSeen.add(state.key);
				if (staleLooks(authority.config, STRIP_LOOK_FIELDS, gen)) {
					const joined = [...state.byColumn.values(), ...state.outside].flatMap((m) => {
						const doc = this.host.settingsOf(m.context);
						return doc === undefined || done.has(m.context) ? [] : [{ context: m.context, settings: doc }];
					});
					for (const w of planLooksReset(authority, joined, ownOrSame).writes) {
						writes.push(w);
						done.add(w.context);
					}
					if (done.has(context)) continue;
				}
			}
			let doc = own(settings);
			if (copy !== undefined && authority !== null && copy.rev < authority.rev && staleLooks(copy.config, STRIP_LOOK_FIELDS, gen)) {
				doc = withStripGroup(doc ?? settings, { v: 1, id: authority.id, rev: authority.rev, joined: true, config: authority.config });
			}
			if (doc === undefined) continue;
			writes.push({ context, settings: doc });
			done.add(context);
		}
		if (writes.length === 0) return [];
		const unwritten = new Set(this.commit(writes));
		return writes.map((w) => w.context).filter((c) => !unwritten.has(c));
	}

	// ---- panel ----------------------------------------------------------------------

	/** A panel request (sendToPlugin) from the Sensor Dial panel of `context`. */
	handlePi(context: string, payload: unknown): void {
		handleStripRequest(this, context, payload);
	}

	/** The panel closed: its draft preview stops, and a strip it held
	 * waits one full period before its next automatic screen. */
	panelClosed(context: string): void {
		if (this.drafts.delete(context)) this.dropDraftInterest(context);
		this.lastPanelBody = "";
		const member = this.registry.member(context);
		const group = member?.copy === undefined ? undefined : this.groups.get(stripGroupKey(member.deviceId, member.copy.id));
		if (group !== undefined) group.cycleDueAt = null;
	}

	capabilities(deviceId: string): DeviceCapabilities {
		return this.capabilityLookup.get(deviceId);
	}

	visible(): Iterable<string> {
		return this.handles.keys();
	}

	settingsOf(context: string): SettingsDoc | undefined {
		return this.host.settingsOf(context);
	}

	mintId(): string {
		return this.mint();
	}

	/** Per active pane of `config` (the panel passes the effective one: the
	 * screen on view), a rule pane's count now. */
	groupCounts(config: StripConfigV1): (StripGroupCount | null)[] {
		const status = this.host.status();
		return activePanes(config).map((pane) => {
			if (!isRuleStyle(pane.style)) return null;
			const r = groupFrameOf(pane, status).resolution;
			return { status: r.status, title: r.title, unit: r.unit, drawn: r.keys.length, sameUnit: r.sameUnit, otherUnits: r.otherUnits, ...(r.units === undefined ? {} : { units: r.units }) };
		});
	}

	/** Per active pane of `config`, the readings a rule pane draws now. */
	drawnRuleKeys(config: StripConfigV1): (readonly string[])[] {
		const status = this.host.status();
		return activePanes(config).map((pane) => (isRuleStyle(pane.style) ? groupFrameOf(pane, status).keys : []));
	}

	viewOf(key: string): GroupView | undefined {
		return this.groups.get(key)?.view;
	}

	scaleDialOf(key: string, pane: 0 | 1): boolean {
		return this.groups.get(key)?.dialFlags[pane] === true;
	}

	setDraft(context: string, draft: StripDraftSpec | null): void {
		const scope = this.memoScope(context);
		if (draft === null) {
			if (this.drafts.delete(context)) this.dropDraftInterest(context);
			if (scope !== undefined) this.forgetMemos(scope, context);
			return;
		}
		this.drafts.set(context, draft);
		if (scope === undefined) return;
		// One remembered draft per strip copy, newest last, so the cap
		// drops the strip edited longest ago.
		this.forgetMemos(scope, context);
		this.memos.set(`${scope.id}${MEMO_SEP}${context}`, { scope, origin: context, at: this.now(), draft });
		while (this.memos.size > MEMO_CAP) {
			const oldest = this.memos.keys().next().value;
			if (oldest === undefined) break;
			this.memos.delete(oldest);
		}
	}

	draftOf(context: string): StripDraftSpec | undefined {
		return this.drafts.get(context);
	}

	memoOf(context: string): StripDraftSpec | undefined {
		const scope = this.memoScope(context);
		if (scope === undefined) return undefined;
		let found: Memo | undefined;
		for (const [id, memo] of [...this.memos]) {
			if (memo.scope.id !== scope.id) continue;
			if (this.now() - memo.at > MEMO_TTL_MS) {
				this.memos.delete(id);
				continue;
			}
			if (this.memoReaches(memo, context)) found = memo;
		}
		return found?.draft;
	}

	/** Which remembered draft a dial's panel shares: its strip's (deck and
	 * group id) while it is a joined member, else the deck's new strip. */
	private memoScope(context: string): MemoScope | undefined {
		const member = this.registry.member(context);
		if (member === undefined) return undefined;
		if (member.copy?.joined !== true) return { id: `${member.deviceId}new` };
		const key = stripGroupKey(member.deviceId, member.copy.id);
		return { id: key, key };
	}

	/**
	 * Whether a remembered draft belongs to this dial's strip copy. A
	 * same-deck profile copy shares the deck and group id, so a strip's
	 * draft reaches only dials of the lineage it was made in (the contexts
	 * that were members of the copy on screen), and a new-strip draft only
	 * while the dial it was made on is on screen, like this one.
	 */
	private memoReaches(memo: Memo, context: string): boolean {
		if (memo.origin === context) return true;
		if (memo.scope.key === undefined) return this.handles.has(memo.origin);
		const lineage = this.registry.lineageOf(memo.scope.key);
		return lineage.includes(memo.origin) && lineage.includes(context);
	}

	private forgetMemos(scope: MemoScope, context: string): void {
		for (const [id, memo] of [...this.memos]) if (memo.scope.id === scope.id && this.memoReaches(memo, context)) this.memos.delete(id);
	}

	reply(payload: JsonValue): void {
		this.host.sendToPanel(payload);
	}

	/** The live strip as the device shows it: each column's last slice, and
	 * on request the full-width reference frame of the same frame. */
	livePreview(key: string, frame: boolean): StripPreview {
		const group = this.groups.get(key);
		const state = this.registry.group(key);
		const encoders = state?.authority?.config.encoders ?? state?.deviceEncoders ?? 0;
		const slices = Array.from({ length: encoders }, (_, c) => {
			const owner = state?.byColumn.get(c);
			const svg = owner === undefined ? undefined : this.lastSlice.get(owner.context);
			return svg !== undefined && svg.length <= MAX_PANEL_CHARS ? svg : "";
		});
		const reference = frame && group?.lastScene ? renderLogical(group.lastScene) : undefined;
		return { kind: "live", slices, ...(reference === undefined ? {} : { frame: reference.length <= MAX_PANEL_CHARS ? reference : "" }) };
	}

	/** A preview of a configuration that is never written: drawn from the
	 * live data at the frame time over every slot, sent to the panel only. */
	draftPreview(context: string, draft: StripConfigV1, frame: boolean): StripPreview {
		if (draft.encoders === null) return { kind: "draft", slices: [], error: "The strip needs a Stream Deck + or + XL." };
		// A draft of a strip draws the screen its strip shows now.
		const member = this.registry.member(context);
		const shown = member?.copy === undefined ? undefined : this.groups.get(stripGroupKey(member.deviceId, member.copy.id))?.view.screen;
		const view: GroupView = { ...freshView(), screen: shown ?? null };
		const config = effectiveConfig(draft, view);
		const keys = activePanes(config).flatMap((pane) => (isRuleStyle(pane.style) ? [] : drawnSeries(pane).map((s) => s.key)));
		if (keys.length === 0) this.host.history.dropInterest(draftConsumer(context));
		else this.host.history.setInterest(draftConsumer(context), keys.map((savedKey) => ({ savedKey, window: WINDOWS })));
		// A Group pane's draft draws its rule's readings, from the group
		// allowance, the shown window only, like the strip itself.
		const sources = this.sources();
		const groups = activePanes(config).map((pane) => (isRuleStyle(pane.style) ? groupFrameOf(pane, sources.status) : undefined));
		// A draft's Ambient readings pay from the Ambient share like the strip's.
		for (const [p, pool] of [
			[0, "group"],
			[1, "ambient"]
		] as const) {
			const entries = groups.flatMap((frame, i) => (frame === undefined || poolOf(config.panes[i === 1 ? 1 : 0]) !== pool ? [] : frame.keys.map((savedKey) => ({ savedKey, window: paneWindowOf(config, i) }))));
			const id = p === 0 ? draftGroupConsumer(context) : `${draftGroupConsumer(context)}:ambient`;
			if (entries.length === 0) this.host.history.dropInterest(id);
			else this.host.history.setInterest(id, entries, { pool });
		}
		const count = screenCountOf(draft);
		const screens: ScreenFrame | undefined = count < 2 ? undefined : { count, at: screenIndexOf(draft, view), alerts: [] };
		const input = frameInput({ config, encoders: draft.encoders, view, sources, groups, ...(screens === undefined ? {} : { screens }) });
		const result = sliceStrip(input);
		const slices = result.slices.map((s, c) => (s === null ? "" : this.painted(s, this.handles.get(context)?.device.id ?? "", c, context))).map((s) => (s.length <= MAX_PANEL_CHARS ? s : ""));
		const reference = frame ? renderLogical(result.scene) : undefined;
		return { kind: "draft", slices, ...(reference === undefined ? {} : { frame: reference.length <= MAX_PANEL_CHARS ? reference : "" }) };
	}

	/** Whether the open panel is on a member of this group. */
	private panelWatches(key: string): boolean {
		const context = this.host.panelContext();
		if (context === undefined) return false;
		const member = this.registry.member(context);
		return member?.copy !== undefined && stripGroupKey(member.deviceId, member.copy.id) === key;
	}

	/** Pushes the open panel's strip state when it changed. */
	private pushPanel(): void {
		const context = this.host.panelContext();
		if (context === undefined || !this.handles.has(context)) return;
		const member = this.registry.member(context);
		// A dial with no strip copy and no draft has nothing to show.
		if (member?.copy === undefined && member?.foreign === undefined && !this.drafts.has(context)) return;
		const payload = buildStripState(this, context, {});
		const body = JSON.stringify(payload);
		if (body === this.lastPanelBody) return;
		this.lastPanelBody = body;
		this.lastPanelAt = this.now();
		this.host.sendToPanel(payload);
	}

	/** At most one push per PANEL_PUSH_MS for data-driven changes. */
	private schedulePanelPush(): void {
		if (this.panelTimer !== null) return;
		const wait = Math.max(0, this.lastPanelAt + PANEL_PUSH_MS - this.now());
		this.panelTimer = this.clock.setTimeout(() => {
			this.panelTimer = null;
			this.pushPanel();
		}, wait);
	}

	/** Forget the last pushed state (a panel asked again). */
	forgetPanel(): void {
		this.lastPanelBody = "";
	}

	// ---- diagnostics ----------------------------------------------------------------

	/** Counts only: no ids, keys, labels or values. */
	diagnostics(): unknown {
		let frames = 0;
		let sends = 0;
		for (const group of this.groups.values()) {
			frames += group.scheduler.frames;
			sends += group.scheduler.sends;
		}
		return { liveGroups: this.groups.size, keptViews: this.kept.size, joinedMembers: this.claimed.size, frames, sends, devices: [...new Set([...this.handles.values()].filter((h) => this.claimed.has(h.id)).map((h) => hashId(h.device.id)))].length };
	}

	/** Stops every timer (tests). */
	dispose(): void {
		for (const group of [...this.groups.values()]) this.disposeGroup(group);
		if (this.panelTimer !== null) this.clock.clearTimeout(this.panelTimer);
		this.panelTimer = null;
	}
}

function paneConsumer(key: string, pane: number): string {
	return `strip:${key}:${pane}`;
}

function draftConsumer(context: string): string {
	return `strip:draft:${context}`;
}

/** A Group pane's interest: paid from the history store's group allowance. */
function groupConsumer(key: string, pane: number): string {
	return `strip:${key}:${pane}:group`;
}

function draftGroupConsumer(context: string): string {
	return `strip:draft:${context}:group`;
}

/** The allowance a rule pane's history is paid from. */
function poolOf(pane: StripPaneV1): "group" | "ambient" {
	return pane.style === "ambient" ? "ambient" : "group";
}

/** What a Group pane's memory belongs to: its rule and its first reading
 * (a Folder rule's folder). */
/**
 * The stored setup a pane's scales are for: its style, the readings it
 * draws and their units, °F, Data units, the typed scale, and what sets its
 * plot and its end column (readout, value box, unit box, Scale and grid,
 * layout, deck), and its readings' own unit and decimals (issue #59: a
 * fixed unit changes what the scale prints). The reserved widths and a
 * turned scale last while it holds; with the window, it is the hold
 * signature. A reading's unit here is its history's as the view gives it,
 * "" before the first sample (not drawnUnitOf): the widths reserved on a
 * frame with no history start over once the history arrives.
 */
function scaleSetupOf(config: StripConfigV1, encoders: StripEncoders, p: 0 | 1, input: StripPaneInput, dataUnits: DataUnitsPref): string {
	const pane = config.panes[p];
	const formats = config.readingFormats;
	const own = formats === undefined ? [] : [input.series.map((s) => (Object.hasOwn(formats, s.key) ? formats[s.key] : null))];
	return JSON.stringify([pane.style, input.series.map((s) => [s.key, s.history?.unit ?? s.unit]), config.fahrenheit, dataUnits, pane.scale, pane.readout ?? "", pane.overlays.current, pane.overlays.unit, pane.overlays.axes === true, config.layout, encoders, ...own]);
}

function groupSignature(pane: StripPaneV1): string {
	return JSON.stringify([pane.group ?? null, pane.series[0]?.key ?? null]);
}

function withGroupHighlight(view: GroupView, p: 0 | 1, key: string | null): readonly [string | null, string | null] {
	return p === 0 ? [key, view.groupHighlight[1]] : [view.groupHighlight[0], key];
}

function gestureInputOf(event: StripEncoderEvent): Parameters<typeof routeGesture>[1] {
	switch (event.kind) {
		case "dialRotate":
			return { kind: "dialRotate", at: event.at, ticks: event.ticks, pressed: event.pressed };
		case "touchTap":
			return { kind: "touchTap", at: event.at, hold: event.hold, x: 0, canvasWidth: 0 };
		default:
			return { kind: event.kind, at: event.at };
	}
}

/** The two lines a member shows when its group cannot draw slices. */
function healthLines(state: StripGroupState, config: StripConfigV1): string[] {
	if (state.health === "unknown-device") return ["Strip needs a", "Stream Deck + or + XL"];
	if (config.encoders === 6) return ["Strip set up for", "Stream Deck + XL (6 dials)"];
	if (config.encoders === 4) return ["Strip set up for", "Stream Deck + (4 dials)"];
	return ["Strip setup has no", "dial count, see settings"];
}
