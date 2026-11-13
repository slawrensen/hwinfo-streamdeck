/**
 * The Sensor Dial panel's strip requests, answered by the plugin, which is
 * the only writer of stripGroup.
 *
 * Requests (sendToPlugin; the member is the panel's own action):
 *   stripGet      the state below; with `draft`, a preview of a config
 *                 that is never written (null drops the draft)
 *   stripCreate   a new group over chosen visible Sensor Dials, rev 1
 *   stripEdit     a patch against `baseRev`; a stale base is refused, one
 *                 bad operation refuses the whole patch
 *   stripJoin / stripLeave / stripRestore / stripResolve / stripReid
 *   stripShowScreen  show the screen `screenId` on the strip: a runtime
 *                 view, never a write; answered with stripState (an
 *                 unknown id changes nothing and the state goes again)
 *
 * Replies: stripEditResult for every change request, and stripState (the
 * membership map, the group's config and a preview made of the plugin's
 * own slices) for stripGet and after every change while the panel is open.
 *
 * Every write is a complete document per member, planned by edits.ts and
 * written by the controller in one synchronous loop. Validation happens
 * before any write: an invalid request writes nothing.
 */
import type { JsonValue } from "@elgato/utils";

import type { DeviceCapabilities } from "../devices";
import type { StripEditResultPayload, StripEditReasonId, StripGroupCount, StripScreenEntry, StripStatePayload } from "../pi-protocol";
import { sharedLooks } from "../ui/shared-looks";
import { applyStripEdit, planCreate, planEditWrites, planJoin, planLeave, planReid, planResolve, planRestore, type EditBase, type MemberDoc, type PlannedWrite, type ScreenKeyMap, type SettingsDoc } from "./edits";
import { effectiveConfig, type GroupView } from "./frame";
import { isStripEncoders, type StripEncoders } from "./geometry";
import { hasSeriesChoice, screensTriggerDescriptions, stripTriggerDescriptions } from "./input";
import { screensColumnOf } from "./screens";
import { stripGroupKey, type StripGroupState, type StripMember, type StripRegistry } from "./registry";
import { activePanes, isRuleStyle, isStripLayout, MAX_READING_FORMATS, newStripConfig, paneWindowOf, screenCountOf, stripConfigToJson, stripReadingKeysOf, stripSeedOf, type StripConfigV1 } from "./settings";

/** A draft: a layout and an optional patch over the group's config (or,
 * for a dial with no group, over a new config seeded from this dial).
 * `baseRev` is the revision the panel drafted against (0 for a new strip),
 * kept so a draft remembered across member panels still meets the stale
 * check when it is applied. */
export type StripDraftSpec = { readonly layout?: "whole" | "split"; readonly patch: readonly unknown[]; readonly baseRev?: number };

export type StripPreview = { readonly kind: "live" | "draft" | "none"; readonly slices: readonly string[]; readonly frame?: string; readonly error?: string };

/** One blank line in the panel's list of gestures: a no-break space holds its height. */
const BLANK_ROW = "\u00a0";

/** What the request handlers need from the runtime. */
export interface StripPiPort {
	readonly registry: StripRegistry;
	capabilities(deviceId: string): DeviceCapabilities;
	/** Visible Sensor Dial contexts. */
	visible(): Iterable<string>;
	settingsOf(context: string): SettingsDoc | undefined;
	/** Writes the documents; returns the contexts no longer visible. An
	 * applied edit names where the screens of group `screens.group` went
	 * (StripEditResult.screenKeys), so the strip keeps the one it shows. */
	commit(writes: readonly PlannedWrite[], screens?: { readonly group: string; readonly keys: ScreenKeyMap }): string[];
	mintId(): string;
	livePreview(key: string, frame: boolean): StripPreview;
	draftPreview(context: string, config: StripConfigV1, frame: boolean): StripPreview;
	viewOf(key: string): GroupView | undefined;
	/** Whether a live group's pane takes the scale dial (its last frame). */
	scaleDialOf?(key: string, pane: 0 | 1): boolean;
	setDraft(context: string, draft: StripDraftSpec | null): void;
	draftOf(context: string): StripDraftSpec | undefined;
	/** The panel draft remembered for this dial's strip (or for a new strip
	 * on its deck), kept in plugin memory across member panels. */
	memoOf(context: string): StripDraftSpec | undefined;
	reply(payload: JsonValue): void;
	/** Forget the last pushed state, so the next push goes out. */
	forgetPanel(): void;
	/** Per active pane, a Group pane's rule against the snapshot now. */
	groupCounts(config: StripConfigV1): (StripGroupCount | null)[];
	/** Per active pane, the readings a rule pane draws now (none for other
	 * styles): the strip's Unit and decimals rows name them (issue #59). */
	drawnRuleKeys?(config: StripConfigV1): readonly (readonly string[])[];
	/** Strip Screens: the screens of a stored copy, the one its live group
	 * shows (by key), the cycle and whether it waits now. */
	screenState(key: string | undefined, stored: StripConfigV1): { screens: StripScreenEntry[]; screen: string; screenCycle: number | null; cycleHeld: boolean };
	/** Show a screen of this dial's strip (stripShowScreen). */
	showScreenFor(context: string, screenId: unknown): void;
}

const isObject = (raw: unknown): raw is Record<string, unknown> => typeof raw === "object" && raw !== null && !Array.isArray(raw);

/** Strip requests carry an event name starting with "strip". */
export function isStripRequest(payload: unknown): boolean {
	return isObject(payload) && typeof payload.event === "string" && payload.event.startsWith("strip");
}

/** The encoders a device's strip has (0 without a touch strip). */
function stripEncodersOf(caps: DeviceCapabilities): StripEncoders | undefined {
	const n = caps.touch === null ? 0 : caps.encoders;
	return isStripEncoders(n) ? n : undefined;
}

/** Columns from a request: a list of distinct whole numbers inside the
 * strip, or "all". undefined when absent, null when malformed. */
export function columnsOf(raw: unknown, encoders: number): number[] | "all" | undefined | null {
	if (raw === undefined) return undefined;
	if (raw === "all") return "all";
	if (!Array.isArray(raw) || raw.length === 0 || raw.length > encoders) return null;
	const out: number[] = [];
	for (const c of raw) {
		if (typeof c !== "number" || !Number.isInteger(c) || c < 0 || c >= encoders || out.includes(c)) return null;
		out.push(c);
	}
	return out.sort((a, b) => a - b);
}

/** The visible Sensor Dial at a column of a device (the newest appear
 * wins when two claim one column). */
function visibleAt(port: StripPiPort, deviceId: string, column: number): StripMember | undefined {
	let best: StripMember | undefined;
	for (const context of port.visible()) {
		const m = port.registry.member(context);
		if (m === undefined || m.deviceId !== deviceId || m.column !== column) continue;
		if (best === undefined || m.epoch > best.epoch) best = m;
	}
	return best;
}

function docOf(port: StripPiPort, context: string): MemberDoc {
	return { context, settings: port.settingsOf(context) ?? {} };
}

/** Dial numbers in words: "2", "2 and 4", "1, 3 and 4". */
function numbersInWords(numbers: readonly number[]): string {
	return numbers.length === 1 ? String(numbers[0]) : `${numbers.slice(0, -1).join(", ")} and ${String(numbers[numbers.length - 1])}`;
}

function joinedOf(state: StripGroupState): StripMember[] {
	return [...state.byColumn.values(), ...state.outside];
}

/** The highest revision a visible dial of the strip holds, joined or left. */
function newestRevOf(state: StripGroupState): number {
	let rev = 0;
	for (const m of [...joinedOf(state), ...state.dormant]) rev = Math.max(rev, m.copy?.rev ?? 0);
	return rev;
}

function baseOf(state: StripGroupState | undefined): EditBase | null {
	return state?.authority === null || state?.authority === undefined ? null : { id: state.authority.id, rev: state.authority.rev, config: state.authority.config };
}

export function parseDraft(raw: unknown): StripDraftSpec | null {
	if (!isObject(raw)) return null;
	const layout = isStripLayout(raw.layout) ? raw.layout : undefined;
	const patch = Array.isArray(raw.patch) ? raw.patch.slice(0, 64) : [];
	const baseRev = typeof raw.baseRev === "number" && Number.isSafeInteger(raw.baseRev) && raw.baseRev >= 0 ? raw.baseRev : undefined;
	return { ...(layout === undefined ? {} : { layout }), patch, ...(baseRev === undefined ? {} : { baseRev }) };
}

/** A draft in the form the panel reads back (patch entries are data). */
function draftToJson(draft: StripDraftSpec | undefined): StripStatePayload["draft"] {
	if (draft === undefined) return null;
	return { ...(draft.layout === undefined ? {} : { layout: draft.layout }), patch: JSON.parse(JSON.stringify(draft.patch)) as JsonValue[], ...(draft.baseRev === undefined ? {} : { baseRev: draft.baseRev }) };
}

/** This dial's stored stripGroup exactly as written (null when it has
 * none), so the panel can carry the newest copy in its own writes. */
function storedOf(port: StripPiPort, context: string): JsonValue {
	const raw = port.settingsOf(context)?.stripGroup;
	return raw === undefined ? null : (JSON.parse(JSON.stringify(raw)) as JsonValue);
}

/** The config a draft describes, or why it cannot be drawn. Pure. */
export function draftConfigOf(port: StripPiPort, context: string, draft: StripDraftSpec): { readonly ok: true; readonly config: StripConfigV1 } | { readonly ok: false; readonly error: string } {
	const member = port.registry.member(context);
	if (member === undefined) return { ok: false, error: "This dial is not on screen." };
	const encoders = stripEncodersOf(port.capabilities(member.deviceId));
	if (encoders === undefined) return { ok: false, error: "The strip needs a Stream Deck + or + XL." };
	const state = member.copy?.joined === true ? port.registry.group(stripGroupKey(member.deviceId, member.copy.id)) : undefined;
	const live = baseOf(state);
	const base: EditBase = live ?? { id: "draft", rev: 0, config: newStripConfig(draft.layout ?? "whole", encoders, stripSeedOf(port.settingsOf(context))) };
	const patch = live !== null && draft.layout !== undefined && draft.layout !== live.config.layout ? [{ op: "set", path: "layout", value: draft.layout }, ...draft.patch] : [...draft.patch];
	if (patch.length === 0) return { ok: true, config: base.config };
	const result = applyStripEdit(base, base.rev, patch, { deviceEncoders: encoders });
	return result.ok ? { ok: true, config: result.copy.config } : { ok: false, error: result.detail ?? result.reason };
}

/** The panel's view of this dial's strip: device, membership map, group,
 * and a preview made of plugin-rendered slices. */
export function buildStripState(port: StripPiPort, context: string, options: { readonly requestId?: string; readonly frame?: boolean }): StripStatePayload {
	const head = { event: "stripState" as const, context, ...(options.requestId === undefined ? {} : { requestId: options.requestId }) };
	const member = port.registry.member(context);
	if (member === undefined) {
		return { ...head, device: { model: "Unknown device", encoders: 0, strip: false }, self: { column: -1, status: "unknown", groupId: null, rev: 0, joined: false, foreign: null }, group: null, slots: [], base: null, draft: null, stored: storedOf(port, context), preview: { kind: "none", slices: [] } };
	}
	const caps = port.capabilities(member.deviceId);
	const encoders = stripEncodersOf(caps) ?? 0;
	const copy = member.copy;
	const key = copy === undefined ? undefined : stripGroupKey(member.deviceId, copy.id);
	const state = key === undefined ? undefined : port.registry.group(key);
	const slots = Array.from({ length: encoders }, (_, column) => {
		const at = visibleAt(port, member.deviceId, column);
		const groupId = at?.copy?.id ?? null;
		let slot: StripStatePayload["slots"][number]["state"] = "none";
		if (at !== undefined) {
			if (at.copy === undefined) slot = "independent";
			else if (!at.copy.joined) slot = "dormant";
			else if (copy === undefined || at.copy.id !== copy.id) slot = "other";
			else slot = state?.byColumn.get(column)?.context === at.context ? "joined" : "outside";
		}
		return { column, state: slot, self: at?.context === context, groupId };
	});
	const self = {
		column: member.column,
		status: port.registry.memberStatus(context) ?? "independent",
		groupId: copy?.id ?? null,
		rev: copy?.rev ?? 0,
		joined: copy?.joined === true,
		foreign: member.foreign === undefined ? null : { groupId: member.foreign.id, rev: member.foreign.rev }
	};
	let group: StripStatePayload["group"] = null;
	if (copy !== undefined) {
		const authority = state?.authority ?? null;
		const config = authority?.config ?? copy.config;
		const view = key === undefined ? undefined : port.viewOf(key);
		const columnOf = (ctx: string): number => port.registry.member(ctx)?.column ?? -1;
		const p = config.layout === "whole" || config.encoders === null ? 0 : member.column < config.encoders / 2 ? 0 : 1;
		const mode = view?.panes[p].mode ?? "live";
		// The screen on view: its gestures, its counts and its window.
		const shown = view === undefined ? config : effectiveConfig(config, view);
		const pane = shown.panes[p];
		const scaleDial = key !== undefined && port.scaleDialOf?.(key, p) === true;
		const own = stripTriggerDescriptions({ layout: config.layout, sharedWindow: config.sharedWindow, mode, seriesChoice: hasSeriesChoice({ style: pane.style, seriesCount: pane.series.length, ...(pane.readout === undefined ? {} : { readout: pane.readout }), mode }), group: pane.style === "group", style: pane.style, scaleDial, tiles: pane.style === "group" && pane.group?.view === "tiles", highlighted: (view?.groupHighlight[p] ?? null) !== null });
		const screensDial = state !== undefined && screenCountOf(config) >= 2 && screensColumnOf(state.byColumn.keys()) === member.column && state.byColumn.get(member.column)?.context === context;
		const controls = screensDial ? screensTriggerDescriptions(own) : own;
		const screenView = port.screenState(key, config);
		group = {
			id: copy.id,
			rev: authority?.rev ?? copy.rev,
			live: authority !== null,
			health: state?.health ?? "ok",
			conflict: state?.conflict === null || state?.conflict === undefined ? null : { kind: state.conflict.kind, columns: state.conflict.contexts.map(columnOf) },
			config: stripConfigToJson(config) as JsonValue,
			// The window each half shows now: rotation's choice for this
			// session over the saved default.
			panes: activePanes(config).map((_, i) => {
				const index = i === 1 ? 1 : 0;
				return { mode: view?.panes[index].mode ?? "live", window: paneWindowOf(shown, index) };
			}),
			controls: [
				["rotate", controls.rotate],
				["push", controls.push],
				["touch", controls.touch],
				// No long touch to name (Tiles with nothing highlighted): a blank
				// row, so the panel below this list stays put when the line comes
				// back with a highlight or as Screens moves on to another view.
				controls.longTouch === undefined ? [BLANK_ROW, BLANK_ROW] : ["longTouch", controls.longTouch]
			],
			...(activePanes(shown).some((x) => isRuleStyle(x.style)) ? { counts: port.groupCounts(shown) } : {}),
			// The readings the strip's own Unit and decimals rows name (issue
			// #59): every stored screen's and pane's, then those its rules draw
			// on the screen on view.
			readings: readingsOf(config, port.drawnRuleKeys?.(shown) ?? []),
			// Strip Screens: the list, the one on view, the cycle.
			screens: screenView.screens,
			screen: screenView.screen,
			screenCycle: screenView.screenCycle,
			cycleHeld: screenView.cycleHeld
		};
	}
	// A new strip's draft base: a strip seeded from this dial (the look and
	// its reading), exactly what stripCreate would start from. A running
	// strip's draft applies to group.config, which this state already
	// carries, so its base is null.
	const liveBase = copy?.joined === true ? baseOf(state) : null;
	const base: JsonValue = liveBase !== null ? null : encoders > 0 && isStripEncoders(encoders) ? (stripConfigToJson(newStripConfig("whole", encoders, stripSeedOf(port.settingsOf(context)))) as JsonValue) : null;
	let preview: StripPreview = { kind: "none", slices: [] };
	const draft = port.draftOf(context);
	if (draft !== undefined) {
		const drafted = draftConfigOf(port, context, draft);
		preview = drafted.ok ? port.draftPreview(context, drafted.config, options.frame === true) : { kind: "draft", slices: [], error: drafted.error };
	} else if (copy?.joined === true && key !== undefined && state?.authority !== null && state !== undefined) {
		preview = port.livePreview(key, options.frame === true);
	}
	return {
		...head,
		device: { model: caps.model, encoders, strip: encoders > 0 },
		self,
		group,
		slots,
		base,
		draft: draftToJson(port.memoOf(context)),
		stored: storedOf(port, context),
		preview: { kind: preview.kind, slices: [...preview.slices], ...(preview.frame === undefined ? {} : { frame: preview.frame }), ...(preview.error === undefined ? {} : { error: preview.error }) }
	};
}

/** The strip's readings for the panel's rows, each once, at most the
 * number of formats a strip keeps. */
function readingsOf(config: StripConfigV1, ruleKeys: readonly (readonly string[])[]): string[] {
	const out = stripReadingKeysOf(config);
	for (const keys of ruleKeys) for (const key of keys) if (!out.includes(key)) out.push(key);
	return out.slice(0, MAX_READING_FORMATS);
}

type Op = StripEditResultPayload["op"];

function result(context: string, opId: string, op: Op, outcome: { ok: boolean; reason?: StripEditReasonId; detail?: string; rev: number; groupId: string | null; config: StripConfigV1 | null; unwritten?: number[]; offscreen?: number }, stored: JsonValue): StripEditResultPayload {
	return {
		event: "stripEditResult",
		context,
		opId,
		op,
		ok: outcome.ok,
		...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
		...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
		rev: outcome.rev,
		groupId: outcome.groupId,
		config: outcome.config === null ? null : (stripConfigToJson(outcome.config) as JsonValue),
		...(outcome.unwritten === undefined || outcome.unwritten.length === 0 ? {} : { unwritten: outcome.unwritten }),
		...(outcome.offscreen === undefined || outcome.offscreen === 0 ? {} : { offscreen: outcome.offscreen }),
		stored
	};
}

const OPS: Readonly<Record<string, Op>> = {
	stripCreate: "create",
	stripEdit: "edit",
	stripJoin: "join",
	stripLeave: "leave",
	stripRestore: "restore",
	stripResolve: "resolve",
	stripReid: "reid"
};

/** One panel request from the Sensor Dial panel of `context`. */
export function handleStripRequest(port: StripPiPort, context: string, payload: unknown): void {
	if (!isObject(payload) || typeof payload.event !== "string") return;
	if (payload.event === "stripShowScreen") {
		port.showScreenFor(context, payload.screenId);
		port.forgetPanel();
		port.reply(buildStripState(port, context, {}));
		return;
	}
	if (payload.event === "stripGet") {
		if ("draft" in payload) port.setDraft(context, payload.draft === null ? null : parseDraft(payload.draft));
		port.forgetPanel();
		port.reply(buildStripState(port, context, { ...(typeof payload.requestId === "string" ? { requestId: payload.requestId } : {}), frame: payload.frame === true }));
		return;
	}
	const op = Object.hasOwn(OPS, payload.event) ? OPS[payload.event] : undefined;
	if (op === undefined) return;
	const opId = typeof payload.opId === "string" ? payload.opId.slice(0, 64) : "";
	const reply = (outcome: Parameters<typeof result>[3]): void => port.reply(result(context, opId, op, outcome, storedOf(port, context)) as JsonValue);
	const member = port.registry.member(context);
	if (member === undefined) {
		reply({ ok: false, reason: "no-group", detail: "This dial is not on screen.", rev: 0, groupId: null, config: null });
		return;
	}
	const encoders = stripEncodersOf(port.capabilities(member.deviceId));
	if (encoders === undefined) {
		reply({ ok: false, reason: "device", detail: "The strip needs a Stream Deck + or + XL.", rev: 0, groupId: null, config: null });
		return;
	}
	const groupId = typeof payload.groupId === "string" ? payload.groupId : undefined;
	const key = groupId === undefined ? undefined : stripGroupKey(member.deviceId, groupId);
	const state = key === undefined ? undefined : port.registry.group(key);
	const base = baseOf(state);
	const refuse = (reason: StripEditReasonId, detail?: string): void => reply({ ok: false, reason, ...(detail === undefined ? {} : { detail }), rev: base?.rev ?? 0, groupId: groupId ?? null, config: base?.config ?? null });
	const columnNumbers = (writes: readonly string[]): number[] => writes.map((ctx) => port.registry.member(ctx)?.column ?? -1);
	const done = (copyRev: number, id: string, config: StripConfigV1, writes: readonly PlannedWrite[], screens?: ScreenKeyMap): void => {
		const unwritten = port.commit(writes, screens === undefined || key === undefined ? undefined : { group: key, keys: screens });
		reply({ ok: true, rev: copyRev, groupId: id, config, unwritten: columnNumbers(unwritten) });
	};
	/** The visible dials at the columns, each free to join (not joined to
	 * another group unless the request takes it). */
	const dialsAt = (columns: readonly number[], take: readonly number[], own: string | undefined): { ok: true; docs: MemberDoc[] } | { ok: false; reason: StripEditReasonId; detail: string } => {
		const docs: MemberDoc[] = [];
		const missing: number[] = [];
		const taken: number[] = [];
		for (const c of columns) {
			const at = visibleAt(port, member.deviceId, c);
			if (at === undefined) {
				missing.push(c + 1);
				continue;
			}
			if (at.copy?.joined === true && at.copy.id !== own && !take.includes(c)) taken.push(c + 1);
			docs.push(docOf(port, at.context));
		}
		if (missing.length > 0) return { ok: false, reason: "incomplete", detail: `No Sensor Dial at ${missing.length === 1 ? "dial" : "dials"} ${numbersInWords(missing)}` };
		if (taken.length > 0) return { ok: false, reason: "conflict", detail: `${taken.length === 1 ? "Dial" : "Dials"} ${numbersInWords(taken)} ${taken.length === 1 ? "is" : "are"} in another strip` };
		return { ok: true, docs };
	};
	const take = columnsOf(payload.take, encoders);
	const takeList = Array.isArray(take) ? take : [];
	if (take === null) {
		refuse("invalid", "take: columns inside the strip");
		return;
	}
	switch (op) {
		case "create": {
			const layout = payload.layout;
			if (!isStripLayout(layout)) return refuse("invalid", "layout: whole or split");
			const columns = columnsOf(payload.columns, encoders);
			if (columns === null) return refuse("invalid", "columns: columns inside the strip");
			const chosen = columns === undefined || columns === "all" ? Array.from({ length: encoders }, (_, c) => c) : columns;
			const dials = dialsAt(chosen, takeList, undefined);
			if (!dials.ok) return refuse(dials.reason, dials.detail);
			const plan = planCreate({ id: port.mintId(), layout, encoders, seedFrom: port.settingsOf(context) ?? {}, members: dials.docs, looksGen: sharedLooks().resetGen, ...(payload.patch === undefined ? {} : { patch: payload.patch }) });
			if (!plan.ok) return refuse("invalid", plan.detail);
			// The deck's new-strip draft became this strip: forget it.
			port.setDraft(context, null);
			return done(plan.copy.rev, plan.copy.id, plan.copy.config, plan.writes);
		}
		case "edit": {
			if (state === undefined || base === null || member.copy?.id !== groupId) return refuse("no-group");
			const edited = applyStripEdit(base, payload.baseRev, payload.patch, { deviceEncoders: encoders, looksGen: sharedLooks().resetGen });
			if (!edited.ok) return reply({ ok: false, reason: edited.reason, ...(edited.detail === undefined ? {} : { detail: edited.detail }), rev: edited.rev, groupId: groupId ?? null, config: edited.config });
			// The edit goes above every copy a visible dial of the strip
			// holds, left copies included: a dial that was hidden while every
			// dial left comes back running the older copy it had, and a later
			// Rejoin or Restore must never take their setup over this edit.
			const copy = { ...edited.copy, rev: Math.max(edited.copy.rev, newestRevOf(state) + 1) };
			return done(copy.rev, copy.id, copy.config, planEditWrites(copy, joinedOf(state).map((m) => docOf(port, m.context))), edited.screenKeys);
		}
		case "join": {
			if (state === undefined || base === null || groupId === undefined) return refuse("no-group");
			const columns = columnsOf(payload.columns ?? [member.column], encoders);
			if (columns === null || columns === undefined) return refuse("invalid", "columns: columns inside the strip");
			const chosen = (columns === "all" ? Array.from({ length: encoders }, (_, c) => c) : columns).filter((c) => {
				const at = visibleAt(port, member.deviceId, c);
				return columns !== "all" || (at !== undefined && !(at.copy?.joined === true && at.copy.id === groupId));
			});
			const dials = dialsAt(chosen, takeList, groupId);
			if (!dials.ok) return refuse(dials.reason, dials.detail);
			if (dials.docs.length === 0) return refuse("invalid", "No dial to join");
			const plan = planJoin(base, dials.docs, joinedOf(state).map((m) => docOf(port, m.context)));
			return done(plan.copy.rev, plan.copy.id, plan.copy.config, plan.writes);
		}
		case "leave": {
			if (state === undefined || base === null) return refuse("no-group");
			const columns = columnsOf(payload.columns ?? [member.column], encoders);
			if (columns === null || columns === undefined) return refuse("invalid", "columns: columns inside the strip");
			const leaving = joinedOf(state).filter((m) => columns === "all" || columns.includes(m.column));
			if (leaving.length === 0) return refuse("invalid", "No joined dial at those columns");
			const unwritten = port.commit(planLeave(base, leaving.map((m) => docOf(port, m.context))));
			// Dials off screen cannot be written: they keep their joined copy
			// and come back in the strip, so the panel must not say every
			// dial left.
			const offscreen = columns === "all" && key !== undefined ? port.registry.offscreenJoined(key) : 0;
			return reply({ ok: true, rev: base.rev, groupId: base.id, config: base.config, unwritten: columnNumbers(unwritten), offscreen });
		}
		case "restore": {
			if (groupId === undefined) return refuse("no-group");
			const columns = columnsOf(payload.columns ?? "all", encoders);
			if (columns === null || columns === undefined) return refuse("invalid", "columns: columns inside the strip");
			// The newest setup comes from every visible left copy of the
			// strip on this deck, whatever the columns; only the dials at the
			// requested columns are written.
			const docs: MemberDoc[] = [];
			const left: MemberDoc[] = [];
			for (const context of port.visible()) {
				const m = port.registry.member(context);
				if (m === undefined || m.deviceId !== member.deviceId || m.copy?.id !== groupId || m.copy.joined) continue;
				const doc = docOf(port, context);
				left.push(doc);
				if (columns === "all" || columns.includes(m.column)) docs.push(doc);
			}
			const joined = state === undefined ? [] : joinedOf(state).map((m) => docOf(port, m.context));
			const plan = planRestore(groupId, base, docs, joined, left);
			if (plan === undefined) return refuse("no-group", "No dial holds a left copy of this strip");
			return done(plan.copy.rev, plan.copy.id, plan.copy.config, plan.writes);
		}
		case "resolve": {
			const foreign = member.foreign;
			const use = payload.use;
			if (foreign === undefined) return refuse("no-group", "This dial has no differing copy");
			if (use !== "group" && use !== "thisDial") return refuse("invalid", "use: group or thisDial");
			const prior = member.copy;
			const id = prior?.id ?? foreign.id;
			if (groupId !== undefined && groupId !== id && groupId !== foreign.id) return refuse("no-group");
			const owner = port.registry.group(stripGroupKey(member.deviceId, id));
			const authority = baseOf(owner);
			const joined = owner === undefined ? [] : joinedOf(owner).filter((m) => m.context !== context);
			const plan = planResolve({ use, dial: docOf(port, context), prior, foreign, authority, joined: joined.map((m) => docOf(port, m.context)) });
			const config = plan.copy?.config ?? null;
			const unwritten = port.commit(plan.writes);
			return reply({ ok: true, rev: plan.copy?.rev ?? 0, groupId: plan.copy?.id ?? null, config, unwritten: columnNumbers(unwritten) });
		}
		case "reid": {
			if (state === undefined || base === null) return refuse("no-group");
			const plan = planReid(base, port.mintId(), joinedOf(state).map((m) => docOf(port, m.context)));
			return done(plan.copy.rev, plan.copy.id, plan.copy.config, plan.writes);
		}
	}
}
