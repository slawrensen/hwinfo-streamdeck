/**
 * Strip group membership and authority. Pure and SDK-free: the controller
 * feeds it lifecycle events and settings documents, and it answers which
 * group a visible context belongs to, where its slice sits, and which copy
 * of the group configuration is authoritative.
 *
 * Rules:
 * - A runtime group is device id + group id. The same id on two decks is two
 *   groups, so identical profiles on two devices never cross-control.
 * - Membership comes from the member's own saved copy (joined exactly true)
 *   and its encoder column. Nothing durable names a context or a device.
 * - The authority is the highest revision among the VISIBLE joined members.
 *   Equal top revisions with equal configs are one authority (sourced from
 *   the leftmost column); with different configs it is a tie conflict,
 *   drawn from the leftmost top copy and never written back.
 * - A copy that arrives from outside the plugin and differs from what the
 *   plugin knows is either a stale echo (same id, revision not newer: the
 *   controller re-stamps that one member) or foreign (anything else: shown
 *   as a conflict, never adopted silently, until the user chooses). In
 *   reply to the write that brought it, the controller moves a foreign
 *   copy into stripGroupPasted and puts the dial's accepted copy back in
 *   stripGroup, so after a restart the copy is still a conflict and never
 *   the authority or a membership. Appear reads stripGroupPasted as a
 *   pending foreign copy and writes nothing.
 * - Encoder geometry comes only from src/devices.ts. A config designed for
 *   another encoder count is a mismatch; a device with no touch strip is the
 *   unknown-device state. Neither stretches anything.
 * - Every appear gets a new epoch. A disappear whose column does not match
 *   the live record is a stale, out-of-order event and is ignored.
 * - Runtime view state (pause, cursor, highlight) belongs to the controller,
 *   per group, kept while the group is hidden for VIEW_LINEAGE_TTL_MS. The
 *   registry keeps each group's lineage, the contexts that were its joined
 *   members, and says when a group comes back into view whether its kept
 *   view may be restored: only when the context that brings it back was a
 *   member before. A same-device profile copy has the same device id and
 *   group id, so the same runtime key, but other contexts, so it never
 *   inherits another copy's paused view.
 */
import { monotonicNow } from "../clock";
import { deviceCapabilities, type DeviceCapabilities } from "../devices";
import { sortedJson } from "../sorted-json";
import { paneOfColumn, SLICE_W } from "./geometry";
import { STRIP_PASTED_FIELD, stripConfigToJson, stripGroupOf, stripGroupToJson, type StripConfigV1, type StripGroupCopy } from "./settings";

export type CapabilityLookup = { get(deviceId: string): DeviceCapabilities };

export type StripMember = {
	readonly context: string;
	readonly deviceId: string;
	readonly column: number;
	readonly epoch: number;
	/** The copy the plugin accepts for this member: what its settings held at
	 * appear, or what the plugin last wrote to it. */
	readonly copy: StripGroupCopy | undefined;
	/** A differing copy that arrived from outside the plugin, pending the
	 * user's choice. Never part of the authority. */
	readonly foreign: StripGroupCopy | undefined;
	/** Canonical JSON of the stored stripGroup last seen or written. */
	readonly known: string;
};

export type GroupHealth = "ok" | "mismatch" | "unknown-device";

export type StripAuthority = {
	readonly id: string;
	readonly rev: number;
	readonly config: StripConfigV1;
	/** The context whose copy the authority was read from. */
	readonly from: string;
};

export type StripConflict = { readonly kind: "tie" | "foreign"; readonly contexts: readonly string[] };

export type StripGroupState = {
	readonly key: string;
	readonly deviceId: string;
	readonly id: string;
	/** Encoders of the actual device (0 when it has no touch strip). */
	readonly deviceEncoders: number;
	readonly health: GroupHealth;
	readonly authority: StripAuthority | null;
	readonly conflict: StripConflict | null;
	/** Joined members that own a slice, by encoder column. */
	readonly byColumn: ReadonlyMap<number, StripMember>;
	/** Joined members outside the device's encoder span, or displaced from a
	 * column by a later appear. */
	readonly outside: readonly StripMember[];
	/** Visible members holding a dormant (left) copy of this group. */
	readonly dormant: readonly StripMember[];
};

export type StripSlot = {
	readonly group: StripGroupState;
	readonly column: number;
	readonly pane: 0 | 1;
	/** Group x of the slice's left edge. */
	readonly offsetX: number;
};

export type MemberStatus = "independent" | "dormant" | "joined" | "outside" | "mismatch" | "unknown-device";

/** How a settings document from outside the plugin was classified. */
export type SettingsClass = "untracked" | "unrelated" | "stale" | "foreign";

export type StripChange = {
	/** Group keys whose membership, authority or conflict may have changed. */
	readonly groups: readonly string[];
	readonly settings?: SettingsClass;
	/** Write this complete copy back to this context: the reply to a whole
	 * document that carried a stale or missing stripGroup. */
	readonly restamp?: { readonly context: string; readonly copy: StripGroupCopy; readonly pasted?: unknown };
	/** Write this context's document back with `stripGroup` (absent when
	 * undefined) and the foreign copy in stripGroupPasted: the reply to a
	 * write that brought a foreign copy, or that dropped a pending one. */
	readonly quarantine?: { readonly context: string; readonly stripGroup: unknown; readonly pasted: unknown };
	/** Groups that came back into view with this change (from no visible
	 * joined member to one). The controller restores a group's kept view
	 * only when restoreView is true, and otherwise starts it live. */
	readonly shown?: readonly { readonly key: string; readonly restoreView: boolean }[];
};

export type AppearInput = {
	readonly context: string;
	readonly deviceId: string;
	readonly column: number;
	/** The action's whole settings document as the app delivered it. */
	readonly settings: unknown;
};

const SEP = "\u001f";
/** Foreign copies remembered across a page swipe; bounded. */
const PENDING_FOREIGN_CAP = 64;
/** How long a hidden group's lineage lasts: the hidden-state TTL of
 * independent dials, so a page swipe and back restores the view. */
export const VIEW_LINEAGE_TTL_MS = 30 * 60_000;
/** Lineages of hidden groups remembered at most; the oldest go first. */
const LINEAGE_CAP = 64;
/** Contexts remembered per lineage (dials replaced over a long session);
 * the earliest go first. */
const LINEAGE_CONTEXTS_CAP = 32;
/** Contexts remembered as having left the screen while joined; bounded. */
const ABSENT_JOINED_CAP = 256;

/** The contexts that were joined members of one runtime group, and since
 * when the group has had no visible joined member (null while it has). */
type Lineage = { readonly contexts: Set<string>; hiddenAt: number | null };

export function stripGroupKey(deviceId: string, id: string): string {
	return `${deviceId}${SEP}${id}`;
}

/** The runtime group a record is a joined member of, if any. */
function joinedKeyOf(record: StripMember | undefined): string | undefined {
	return record?.copy?.joined === true ? stripGroupKey(record.deviceId, record.copy.id) : undefined;
}

function rawGroupOf(settings: unknown): unknown {
	return typeof settings === "object" && settings !== null && !Array.isArray(settings) ? (settings as Record<string, unknown>).stripGroup : undefined;
}

function canonical(raw: unknown): string {
	return sortedJson(raw === undefined ? null : raw);
}

/**
 * A parsed config's canonical stored form, unknown fields included, computed
 * once per config. Parsed configs are never mutated (a change is a new
 * copy), and the authority check asks for every top member's on each of its
 * calls, several times a frame.
 */
const canonicalConfigs = new WeakMap<StripConfigV1, string>();
function canonicalConfig(config: StripConfigV1): string {
	let text = canonicalConfigs.get(config);
	if (text === undefined) {
		text = sortedJson(stripConfigToJson(config));
		canonicalConfigs.set(config, text);
	}
	return text;
}

/** A copy's canonical stored form, unknown fields included, once per copy. */
const canonicalCopies = new WeakMap<StripGroupCopy, string>();
function canonicalCopy(copy: StripGroupCopy): string {
	let text = canonicalCopies.get(copy);
	if (text === undefined) {
		text = sortedJson(stripGroupToJson(copy));
		canonicalCopies.set(copy, text);
	}
	return text;
}

function sameCopy(a: StripGroupCopy | undefined, b: StripGroupCopy | undefined): boolean {
	return a !== undefined && b !== undefined && (a === b || canonicalCopy(a) === canonicalCopy(b));
}

/** The pending pasted copy a document holds: a valid copy in
 * stripGroupPasted that differs from the dial's own copy. */
function pastedOf(settings: unknown, copy: StripGroupCopy | undefined): StripGroupCopy | undefined {
	if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return undefined;
	const pasted = stripGroupOf((settings as Record<string, unknown>)[STRIP_PASTED_FIELD]);
	return pasted === undefined || sameCopy(pasted, copy) ? undefined : pasted;
}

/** The stored form of a member's accepted copy: the stored value it was
 * read from when the plugin still knows it, else the parsed copy. */
function acceptedRaw(record: StripMember): unknown {
	if (record.copy === undefined) return undefined;
	const raw: unknown = record.known === "null" ? undefined : JSON.parse(record.known);
	return sameCopy(stripGroupOf(raw), record.copy) ? raw : stripGroupToJson(record.copy);
}

type PendingForeign = { readonly known: string; readonly prior: StripGroupCopy | undefined; readonly foreign: StripGroupCopy };

export class StripRegistry {
	private readonly members = new Map<string, StripMember>();
	private readonly pendingForeign = new Map<string, PendingForeign>();
	private readonly lineage = new Map<string, Lineage>();
	/** Contexts that left the screen while joined, and the group they were
	 * joined to. Their stored copy says joined; no write reached them. */
	private readonly absentJoined = new Map<string, string>();
	private epochCounter = 0;

	constructor(
		private readonly capabilities: CapabilityLookup = deviceCapabilities,
		private readonly now: () => number = monotonicNow
	) {}

	/** willAppear (including replays): replaces any record for the context
	 * with a new epoch, and moves it out of its old column or group. */
	appear(input: AppearInput): { epoch: number; change: StripChange } {
		const before = this.members.get(input.context);
		const raw = rawGroupOf(input.settings);
		const known = canonical(raw);
		const epoch = ++this.epochCounter;
		let copy = stripGroupOf(raw);
		let foreign = pastedOf(input.settings, copy);
		const pending = this.pendingForeign.get(input.context);
		if (pending !== undefined) {
			if (pending.known === known) {
				// The stored document still holds the unresolved foreign copy:
				// it stays pending instead of winning on the max-rev rule.
				copy = pending.prior;
				foreign = pending.foreign;
			} else {
				this.pendingForeign.delete(input.context);
			}
		}
		const record: StripMember = { context: input.context, deviceId: input.deviceId, column: input.column, epoch, copy, foreign, known };
		this.members.set(input.context, record);
		this.absentJoined.delete(input.context);
		return { epoch, change: this.withShown({ groups: this.keysOf(before, record) }, this.trackLineage(before, record)) };
	}

	/** willDisappear. Ignored when the column does not match the live record:
	 * the event belongs to an earlier placement of a context that has since
	 * appeared elsewhere. */
	disappear(context: string, column: number): StripChange {
		const record = this.members.get(context);
		if (record === undefined || record.column !== column) return { groups: [] };
		this.members.delete(context);
		this.noteAbsent(record);
		this.trackLineage(record, undefined);
		return { groups: this.keysOf(record) };
	}

	/** deviceDidDisconnect: every member on that device is gone. */
	deviceGone(deviceId: string): StripChange {
		const keys = new Set<string>();
		for (const record of [...this.members.values()]) {
			if (record.deviceId !== deviceId) continue;
			this.members.delete(record.context);
			this.noteAbsent(record);
			this.trackLineage(record, undefined);
			for (const key of this.keysOf(record)) keys.add(key);
		}
		return { groups: [...keys] };
	}

	/**
	 * didReceiveSettings from the app (a PI write or a pasted document). The
	 * plugin's own writes are reported through noteWritten instead.
	 */
	settingsChanged(context: string, settings: unknown): StripChange {
		const record = this.members.get(context);
		if (record === undefined) return { groups: [], settings: "untracked" };
		const raw = rawGroupOf(settings);
		const known = canonical(raw);
		const pasted = pastedOf(settings, record.copy);
		if (known === record.known) {
			if (pasted !== undefined) {
				if (sameCopy(pasted, record.foreign)) return { groups: [], settings: "unrelated" };
				// A document carrying another pasted copy: that one is the
				// question now.
				const next: StripMember = { ...record, foreign: pasted };
				this.members.set(context, next);
				this.pendingForeign.delete(context);
				return { groups: this.keysOf(record, next), settings: "foreign" };
			}
			if (record.foreign === undefined) return { groups: [], settings: "unrelated" };
			// A whole document written from an older view dropped the pasted
			// copy still waiting for a choice: put it back.
			return { groups: [], settings: "stale", quarantine: { context, stripGroup: acceptedRaw(record), pasted: stripGroupToJson(record.foreign) } };
		}
		const incoming = stripGroupOf(raw);
		if (incoming === undefined && record.copy === undefined) {
			// Junk replaced junk (or nothing): no strip meaning either way.
			this.members.set(context, { ...record, known, foreign: undefined });
			this.pendingForeign.delete(context);
			return { groups: this.keysOf(record), settings: "unrelated" };
		}
		const accepted = record.copy;
		if (accepted !== undefined) {
			const authority = this.group(stripGroupKey(record.deviceId, accepted.id))?.authority ?? null;
			const newest = Math.max(authority?.rev ?? 0, accepted.rev);
			const stale = incoming === undefined || (incoming.id === accepted.id && incoming.rev <= newest);
			if (stale) {
				// A whole document written from an older view of this dial: keep
				// the group, and put the member's copy back on disk.
				const restamp: StripGroupCopy = accepted.joined && authority !== null ? { v: 1, id: authority.id, rev: authority.rev, joined: true, config: authority.config } : accepted;
				// A pasted copy still waiting for a choice stays one.
				const waiting = pasted ?? record.foreign;
				this.members.set(context, { ...record, known, foreign: waiting });
				this.pendingForeign.delete(context);
				const moved = waiting !== record.foreign && !sameCopy(waiting, record.foreign);
				return { groups: moved ? this.keysOf(record, { ...record, foreign: waiting }) : [], settings: "stale", restamp: { context, copy: restamp, ...(waiting === undefined || pasted !== undefined ? {} : { pasted: stripGroupToJson(waiting) }) } };
			}
		}
		const foreign = incoming as StripGroupCopy;
		const next: StripMember = { ...record, known, foreign };
		this.members.set(context, next);
		this.rememberForeign(context, { known, prior: accepted, foreign });
		return { groups: this.keysOf(record, next), settings: "foreign", quarantine: { context, stripGroup: acceptedRaw(record), pasted: raw } };
	}

	/** The plugin wrote this whole settings document to the context. Its
	 * stripGroup becomes the accepted copy, and its stripGroupPasted the
	 * pending foreign copy (none when absent: the choice was made). */
	noteWritten(context: string, settings: unknown): StripChange {
		const record = this.members.get(context);
		this.pendingForeign.delete(context);
		if (record === undefined) return { groups: [] };
		const raw = rawGroupOf(settings);
		const copy = stripGroupOf(raw);
		const next: StripMember = { ...record, copy, foreign: pastedOf(settings, copy), known: canonical(raw) };
		this.members.set(context, next);
		return this.withShown({ groups: this.keysOf(record, next) }, this.trackLineage(record, next));
	}

	/**
	 * How many dials of this group's lineage are off screen (another page, a
	 * dial stack, a deck unplugged) and were joined when they left. A
	 * request can write only visible dials, so these keep the copy they had.
	 * A dial removed from the profile also counts: the app reports both the
	 * same way.
	 */
	offscreenJoined(key: string): number {
		let n = 0;
		for (const context of this.lineage.get(key)?.contexts ?? []) if (!this.members.has(context) && this.absentJoined.get(context) === key) n++;
		return n;
	}

	/** The contexts in a group's lineage (tests and diagnostics). */
	lineageOf(key: string): readonly string[] {
		return [...(this.lineage.get(key)?.contexts ?? [])];
	}

	/** True when the context is a joined member: its individual face, its
	 * individual commands and its individual writes are suspended. */
	claims(context: string): boolean {
		return this.members.get(context)?.copy?.joined === true;
	}

	isCurrent(context: string, epoch: number): boolean {
		return this.members.get(context)?.epoch === epoch;
	}

	member(context: string): StripMember | undefined {
		return this.members.get(context);
	}

	/** Where a joined member's slice sits, when its group is healthy and it
	 * owns its column. */
	slotOf(context: string): StripSlot | undefined {
		const record = this.members.get(context);
		if (record?.copy?.joined !== true) return undefined;
		const group = this.group(stripGroupKey(record.deviceId, record.copy.id));
		if (group === undefined || group.health !== "ok" || group.authority === null) return undefined;
		if (group.byColumn.get(record.column)?.context !== context) return undefined;
		const encoders = group.authority.config.encoders;
		if (encoders === null) return undefined;
		return { group, column: record.column, pane: paneOfColumn(group.authority.config.layout, encoders, record.column), offsetX: record.column * SLICE_W };
	}

	memberStatus(context: string): MemberStatus | undefined {
		const record = this.members.get(context);
		if (record === undefined) return undefined;
		if (record.copy === undefined) return "independent";
		if (!record.copy.joined) return "dormant";
		const group = this.group(stripGroupKey(record.deviceId, record.copy.id));
		if (group === undefined) return "independent";
		if (group.health !== "ok") return group.health;
		return group.byColumn.get(record.column)?.context === context ? "joined" : "outside";
	}

	groupOf(context: string): StripGroupState | undefined {
		const record = this.members.get(context);
		return record?.copy === undefined ? undefined : this.group(stripGroupKey(record.deviceId, record.copy.id));
	}

	/** Every group with at least one visible member (joined or dormant). */
	groups(): StripGroupState[] {
		const keys = new Set<string>();
		for (const record of this.members.values()) {
			if (record.copy !== undefined) keys.add(stripGroupKey(record.deviceId, record.copy.id));
		}
		return [...keys].map((key) => this.group(key) as StripGroupState);
	}

	group(key: string): StripGroupState | undefined {
		const at = key.indexOf(SEP);
		if (at < 0) return undefined;
		const deviceId = key.slice(0, at);
		const id = key.slice(at + 1);
		const all = [...this.members.values()].filter((m) => m.deviceId === deviceId && m.copy?.id === id);
		const foreignHere = [...this.members.values()].filter((m) => m.deviceId === deviceId && m.foreign !== undefined && (m.copy?.id === id || m.foreign.id === id));
		if (all.length === 0 && foreignHere.length === 0) return undefined;
		const joined = all.filter((m) => m.copy?.joined === true);
		const caps = this.capabilities.get(deviceId);
		const deviceEncoders = caps.touch === null ? 0 : caps.encoders;
		const { authority, tie } = resolveAuthority(joined);
		const health: GroupHealth = deviceEncoders === 0 ? "unknown-device" : authority !== null && authority.config.encoders !== deviceEncoders ? "mismatch" : "ok";
		const byColumn = new Map<number, StripMember>();
		const outside: StripMember[] = [];
		for (const m of [...joined].sort((a, b) => b.epoch - a.epoch)) {
			if (m.column < 0 || m.column >= deviceEncoders || byColumn.has(m.column)) outside.push(m);
			else byColumn.set(m.column, m);
		}
		const conflict: StripConflict | null = foreignHere.length > 0 ? { kind: "foreign", contexts: foreignHere.map((m) => m.context) } : tie.length > 0 ? { kind: "tie", contexts: tie } : null;
		return { key, deviceId, id, deviceEncoders, health, authority, conflict, byColumn, outside, dormant: all.filter((m) => m.copy?.joined !== true) };
	}

	private keysOf(...records: (StripMember | undefined)[]): string[] {
		const keys = new Set<string>();
		for (const record of records) {
			if (record === undefined) continue;
			if (record.copy !== undefined) keys.add(stripGroupKey(record.deviceId, record.copy.id));
			if (record.foreign !== undefined) keys.add(stripGroupKey(record.deviceId, record.foreign.id));
		}
		return [...keys];
	}

	private withShown(change: StripChange, shown: StripChange["shown"]): StripChange {
		return shown === undefined ? change : { ...change, shown };
	}

	/** Visible joined members of a runtime group, one context left out. */
	private joinedCount(key: string, except?: string): number {
		let n = 0;
		for (const m of this.members.values()) if (m.context !== except && joinedKeyOf(m) === key) n++;
		return n;
	}

	/**
	 * Lineage bookkeeping for one context's change from `before` to `after`
	 * (either may be absent). A context that is now a joined member joins
	 * its group's lineage. A group that had no visible joined member and now
	 * has one is reported as shown, restorable only when its lineage, still
	 * within VIEW_LINEAGE_TTL_MS, already held that context; otherwise the
	 * lineage starts over with it. A group left with no visible joined
	 * member starts its hidden clock.
	 */
	private trackLineage(before: StripMember | undefined, after: StripMember | undefined): StripChange["shown"] {
		const now = this.now();
		this.pruneLineage(now);
		const beforeKey = joinedKeyOf(before);
		const afterKey = joinedKeyOf(after);
		let shown: StripChange["shown"];
		if (after !== undefined && afterKey !== undefined) {
			let entry = this.lineage.get(afterKey);
			if (beforeKey !== afterKey && this.joinedCount(afterKey, after.context) === 0) {
				// pruneLineage just dropped every lineage hidden past the TTL.
				const restoreView = entry !== undefined && entry.contexts.has(after.context);
				if (!restoreView) entry = undefined;
				shown = [{ key: afterKey, restoreView }];
			}
			if (entry === undefined) {
				entry = { contexts: new Set(), hiddenAt: null };
				this.lineage.set(afterKey, entry);
			}
			entry.contexts.delete(after.context);
			entry.contexts.add(after.context);
			while (entry.contexts.size > LINEAGE_CONTEXTS_CAP) entry.contexts.delete(entry.contexts.values().next().value as string);
			entry.hiddenAt = null;
		}
		if (beforeKey !== undefined && beforeKey !== afterKey && this.joinedCount(beforeKey) === 0) {
			const entry = this.lineage.get(beforeKey);
			if (entry !== undefined) entry.hiddenAt = now;
		}
		return shown;
	}

	/** Lineages of groups hidden past the TTL are forgotten, and at most
	 * LINEAGE_CAP hidden ones are kept (the longest hidden go first). */
	private pruneLineage(now: number): void {
		const hidden: [string, number][] = [];
		for (const [key, entry] of this.lineage) {
			if (entry.hiddenAt === null) continue;
			if (now - entry.hiddenAt > VIEW_LINEAGE_TTL_MS) this.lineage.delete(key);
			else hidden.push([key, entry.hiddenAt]);
		}
		hidden.sort((a, b) => a[1] - b[1]);
		while (hidden.length > LINEAGE_CAP) this.lineage.delete((hidden.shift() as [string, number])[0]);
	}

	private noteAbsent(record: StripMember): void {
		const key = joinedKeyOf(record);
		this.absentJoined.delete(record.context);
		if (key === undefined) return;
		this.absentJoined.set(record.context, key);
		while (this.absentJoined.size > ABSENT_JOINED_CAP) this.absentJoined.delete(this.absentJoined.keys().next().value as string);
	}

	private rememberForeign(context: string, pending: PendingForeign): void {
		this.pendingForeign.delete(context);
		this.pendingForeign.set(context, pending);
		while (this.pendingForeign.size > PENDING_FOREIGN_CAP) {
			const oldest = this.pendingForeign.keys().next().value as string;
			this.pendingForeign.delete(oldest);
		}
	}
}

/**
 * The authority among joined members: the maximum revision. Top copies
 * with equal configs agree (the leftmost column is the source); otherwise
 * the leftmost top copy is drawn and every top context is in the tie.
 */
export function resolveAuthority(joined: readonly StripMember[]): { authority: StripAuthority | null; tie: string[] } {
	let max = -1;
	for (const m of joined) if (m.copy !== undefined && m.copy.rev > max) max = m.copy.rev;
	const top = joined.filter((m) => m.copy?.rev === max).sort((a, b) => a.column - b.column || a.epoch - b.epoch);
	const first = top[0];
	if (first?.copy === undefined) return { authority: null, tie: [] };
	const shape = canonicalConfig(first.copy.config);
	const agree = top.every((m) => m.copy !== undefined && canonicalConfig(m.copy.config) === shape);
	return { authority: { id: first.copy.id, rev: first.copy.rev, config: first.copy.config, from: first.context }, tie: agree ? [] : top.map((m) => m.context) };
}
