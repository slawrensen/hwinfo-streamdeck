/**
 * Guided Shared Memory / Gadget pairing (steer 7D) over the existing
 * explicit-link backend (reading-links.ts): a bounded catalog of the
 * readings each provider showed this session, the typed refusals a link
 * edit can meet, the row-scoped edit itself, link health and counterpart
 * suggestions. Pure: nothing here reads a provider, touches the poller or
 * writes settings. The settings panel's link editor (src/editors) feeds it
 * snapshots the poller already holds or a one-shot read the person asked
 * for, and commits an edit through the global compare-and-swap writer.
 *
 * Health is the same decision that applies links: every row runs through
 * readingLinkRows (the parser's row rules) and resolveReadingLink (the
 * per-link decision applyReadingLinks uses), so the panel can never call a
 * link active that the keys do not show.
 *
 * Names and values are never proof of a pair. A suggestion is a sorted
 * hint with its reason in words; only an explicit Link press commits one.
 */
import type { JsonValue } from "@elgato/utils";

import type { SnapshotSource } from "./provider";
import { LINK_GADGET_KEY, LINK_SHARED_MEMORY_KEY, READING_LINKS_MAX, readingLinkRows, resolveReadingLink, type ReadingLink } from "./reading-links";
import { SensorType, type SensorSnapshot } from "./types";

/** Readings the catalog remembers per provider (oldest sighting dropped first). */
export const LINK_CATALOG_MAX = 4096;

/** How a catalog sighting was made: the poller's own read, or a one-shot
 * read of the provider the poller is not using, made on a person's press. */
export type CatalogVia = "read" | "peek";

/** One reading a provider showed this session. Metadata only, plus the
 * value at the sighting; never a heartbeat. */
export interface CatalogEntry {
	readonly key: string;
	readonly provider: SnapshotSource;
	/** The source (sensor) name the provider showed it under. */
	readonly sensor: string;
	readonly label: string;
	/** HWiNFO's native unit, before any display conversion. */
	readonly unit: string;
	readonly type: SensorType;
	readonly value: number;
	/** Monotonic ms of the observation the entry was last refreshed from. */
	readonly seenAt: number;
	readonly via: CatalogVia;
	/** This key named another reading (another source or label) earlier
	 * this session, as after HWiNFO re-enumerated its sensors. */
	readonly renamed: boolean;
	/** A spelling the provider publishes only as an alias of another key
	 * (a 1.6 Gadget key kept resolvable). Links take current keys only. */
	readonly aliasOf?: string;
}

/**
 * The readings each provider showed in this plugin session, bounded at
 * 4096 per provider, so a pair can still be confirmed after Auto fell back
 * to Gadget (Shared Memory is unreadable then by definition) or before the
 * Gadget registry is read again. In memory only: nothing here reaches
 * settings or the disk, and a restart starts empty.
 *
 * Cheap on the tick path: a provider that hands back the same snapshot
 * instance (an unchanged skeleton, values updated in place) costs one
 * comparison; only a new instance is walked.
 */
export class ReadingCatalog {
	private readonly entries: Record<SnapshotSource, Map<string, CatalogEntry>> = { "shared-memory": new Map(), gadget: new Map() };
	private readonly last: Partial<Record<SnapshotSource, { readonly snapshot: SensorSnapshot; readonly at: number; readonly via: CatalogVia }>> = {};

	constructor(private readonly max = LINK_CATALOG_MAX) {}

	/** Records a provider's own (raw, unlinked) snapshot. */
	observe(snapshot: SensorSnapshot, provider: SnapshotSource, at: number, via: CatalogVia = "read"): void {
		const previous = this.last[provider];
		this.last[provider] = { snapshot, at, via };
		if (previous !== undefined && previous.snapshot === snapshot) return;
		const map = this.entries[provider];
		const put = (key: string, entry: Omit<CatalogEntry, "renamed">): void => {
			const before = map.get(key);
			const renamed = before !== undefined && (before.renamed || before.sensor !== entry.sensor || before.label !== entry.label);
			// Re-inserted so the map's order is the order of last sighting.
			map.delete(key);
			map.set(key, { ...entry, renamed });
		};
		for (const reading of snapshot.readings) {
			put(reading.key, { key: reading.key, provider, sensor: snapshot.sensors[reading.sensorIndex]?.name ?? "", label: reading.label, unit: reading.unit, type: reading.type, value: reading.value, seenAt: at, via });
		}
		for (const [key, reading] of snapshot.byKey) {
			if (reading.aliasOf === undefined || key !== reading.key) continue;
			put(key, { key, provider, sensor: snapshot.sensors[reading.sensorIndex]?.name ?? "", label: reading.label, unit: reading.unit, type: reading.type, value: reading.value, seenAt: at, via, aliasOf: reading.aliasOf });
		}
		while (map.size > this.max) {
			const oldest = map.keys().next();
			if (oldest.done === true) break;
			map.delete(oldest.value);
		}
	}

	/** The entry for a key, its value and sighting time taken from the
	 * provider's latest observation when that still lists it. */
	get(provider: SnapshotSource, key: string): CatalogEntry | undefined {
		const entry = this.entries[provider].get(key);
		if (entry === undefined) return undefined;
		const last = this.last[provider];
		const current = last?.snapshot.byKey.get(key);
		return current === undefined || last === undefined ? entry : { ...entry, value: current.value, seenAt: last.at, via: last.via };
	}

	/** Every entry of one provider, most recently seen first. */
	list(provider: SnapshotSource): CatalogEntry[] {
		return [...this.entries[provider].keys()].reverse().map((key) => this.get(provider, key) as CatalogEntry);
	}

	/** When the provider was last observed, and how. */
	lastSeen(provider: SnapshotSource): { readonly at: number; readonly via: CatalogVia } | undefined {
		const last = this.last[provider];
		return last === undefined ? undefined : { at: last.at, via: last.via };
	}

	size(provider: SnapshotSource): number {
		return this.entries[provider].size;
	}
}

/** The provider a link endpoint key belongs to, by spelling alone. */
export function linkEndpointProvider(key: string): SnapshotSource | undefined {
	if (LINK_SHARED_MEMORY_KEY.test(key)) return "shared-memory";
	if (LINK_GADGET_KEY.test(key)) return "gadget";
	return undefined;
}

/** Everything known about one endpoint of a prospective link. */
export interface LinkEndpoint extends CatalogEntry {
	/** Published by the snapshot the poller holds now. */
	readonly published: boolean;
}

/** Why a link edit is refused. Every refusal writes nothing. */
export type LinkRefusal =
	/** A key is not a current Shared Memory or Gadget key, or the two keys
	 * are not one of each. */
	| "malformed"
	/** The stored readingLinks value is not a list (fix it in the
	 * Configuration documents first; this editor never replaces it). */
	| "unreadable-list"
	/** The Gadget key is a 1.6 spelling the provider keeps only as an alias. */
	| "legacy-alias"
	/** An endpoint was not seen in this session, so its unit and type
	 * cannot be checked. */
	| "missing-counterpart"
	/** An endpoint named two different readings this session and is not
	 * published now, so which reading it means cannot be told. */
	| "ambiguous"
	| "unit-mismatch"
	| "type-mismatch"
	/** The same pair is stored already. */
	| "duplicate"
	/** An endpoint appears in another stored row; a second row would void
	 * both (the conflict rule). */
	| "conflict"
	/** The list holds 128 rows already (a 129th turns every link off). */
	| "cap"
	/** Unlink or relink: no stored row holds that pair. */
	| "not-linked";

export type LinkEdit =
	| { readonly op: "link"; readonly sharedMemory: string; readonly gadget: string }
	| { readonly op: "unlink"; readonly sharedMemory: string; readonly gadget: string }
	| { readonly op: "relink"; readonly sharedMemory: string; readonly gadget: string; readonly previous: { readonly sharedMemory: string; readonly gadget: string } };

export type LinkEditPlan =
	| { readonly ok: true; readonly next: JsonValue[]; readonly row?: ReadingLink }
	| { readonly ok: false; readonly reason: LinkRefusal };

/** Endpoint facts by provider and key (the editor combines the poller's
 * current snapshot with the catalog). */
export type EndpointLookup = (provider: SnapshotSource, key: string) => LinkEndpoint | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** HWiNFO types that name one kind of quantity; Other and None do not
 * (HWiNFO types several percent readings as Other), so only two specific
 * types can disagree. */
function specificType(type: number): boolean {
	return type >= SensorType.Temperature && type <= SensorType.Usage;
}

/**
 * Checks one prospective pair against the stored rows and the endpoints'
 * facts. `ignore` is the stored index a relink replaces.
 */
function checkPair(rows: readonly unknown[], sharedMemory: string, gadget: string, lookup: EndpointLookup, ignore: number): { ok: true; row: ReadingLink } | { ok: false; reason: LinkRefusal } {
	if (!LINK_SHARED_MEMORY_KEY.test(sharedMemory) || !LINK_GADGET_KEY.test(gadget)) return { ok: false, reason: "malformed" };
	for (let i = 0; i < rows.length; i++) {
		if (i === ignore) continue;
		const row = rows[i];
		if (!isRecord(row)) continue;
		const ends = [row.sharedMemory, row.gadget];
		if (row.sharedMemory === sharedMemory && row.gadget === gadget) return { ok: false, reason: "duplicate" };
		if (ends.includes(sharedMemory) || ends.includes(gadget)) return { ok: false, reason: "conflict" };
	}
	const sm = lookup("shared-memory", sharedMemory);
	const gd = lookup("gadget", gadget);
	if (sm === undefined || gd === undefined) return { ok: false, reason: "missing-counterpart" };
	if (gd.aliasOf !== undefined || sm.aliasOf !== undefined) return { ok: false, reason: "legacy-alias" };
	if ((sm.renamed && !sm.published) || (gd.renamed && !gd.published)) return { ok: false, reason: "ambiguous" };
	if (sm.unit !== gd.unit) return { ok: false, reason: "unit-mismatch" };
	if (specificType(sm.type) && specificType(gd.type) && sm.type !== gd.type) return { ok: false, reason: "type-mismatch" };
	if (sm.unit.length > 32) return { ok: false, reason: "malformed" };
	return { ok: true, row: { sharedMemory, gadget, unit: sm.unit, sensorType: sm.type } };
}

/**
 * Plans one link edit on the stored readingLinks value. Only the targeted
 * row changes: a link appends one row, an unlink removes exactly the rows
 * holding that pair, a relink replaces one row in place (keeping that
 * row's unknown fields). Every other stored element, malformed and
 * forward-version rows included, is carried as the same value in the same
 * position. An absent value is an empty list; any other non-list value is
 * refused, never overwritten.
 */
export function planLinkEdit(raw: unknown, edit: LinkEdit, lookup: EndpointLookup): LinkEditPlan {
	if (raw !== undefined && raw !== null && !Array.isArray(raw)) return { ok: false, reason: "unreadable-list" };
	const rows: readonly unknown[] = Array.isArray(raw) ? (raw as unknown[]) : [];
	const holds = (row: unknown, pair: { sharedMemory: string; gadget: string }): boolean => isRecord(row) && row.sharedMemory === pair.sharedMemory && row.gadget === pair.gadget;
	if (edit.op === "unlink") {
		const next = rows.filter((row) => !holds(row, edit));
		if (next.length === rows.length) return { ok: false, reason: "not-linked" };
		return { ok: true, next: next as JsonValue[] };
	}
	if (edit.op === "relink") {
		const at = rows.findIndex((row) => holds(row, edit.previous));
		if (at < 0) return { ok: false, reason: "not-linked" };
		// Replacing a link with the same pair changes nothing worth a write.
		if (edit.previous.sharedMemory === edit.sharedMemory && edit.previous.gadget === edit.gadget) return { ok: false, reason: "duplicate" };
		const checked = checkPair(rows, edit.sharedMemory, edit.gadget, lookup, at);
		if (!checked.ok) return checked;
		const next = [...rows];
		next[at] = { ...(rows[at] as Record<string, unknown>), ...checked.row };
		return { ok: true, next: next as JsonValue[], row: checked.row };
	}
	if (rows.length >= READING_LINKS_MAX) return { ok: false, reason: "cap" };
	const checked = checkPair(rows, edit.sharedMemory, edit.gadget, lookup, -1);
	if (!checked.ok) return checked;
	return { ok: true, next: [...rows, checked.row] as JsonValue[], row: checked.row };
}

/** What a stored row does now. */
export type LinkHealth =
	/** Applied: the Shared Memory endpoint is live and the Gadget one resolves to it. */
	| "active-shared-memory"
	/** Applied: the Gadget endpoint is live and the Shared Memory one resolves to it. */
	| "active-gadget"
	/** Valid, but neither endpoint is published by the current snapshot. */
	| "waiting"
	/** Both endpoints are published at once; the plugin never chooses. */
	| "both-live"
	/** The published endpoint's unit is no longer the stored one. */
	| "unit-changed"
	/** The Shared Memory endpoint's type is no longer the stored one. */
	| "type-changed"
	/** Ignored by the plugin: not a well-formed row. */
	| "malformed"
	/** Ignored by the plugin: an endpoint appears in another row. */
	| "conflict"
	/** Ignored: the list holds more than 128 rows. */
	| "cap"
	/** No HWiNFO snapshot to judge against. */
	| "unknown";

export interface LinkRowHealth {
	readonly index: number;
	readonly health: LinkHealth;
	/** The row's endpoints when it is well formed. */
	readonly link?: ReadingLink;
}

/**
 * One health per stored row, by the parser's row rules and the per-link
 * decision applyReadingLinks uses, against the provider's own (raw,
 * unlinked) snapshot, or null when there is none.
 */
export function linkRowHealth(raw: unknown, snapshot: Pick<SensorSnapshot, "byKey"> | null): LinkRowHealth[] {
	return readingLinkRows(raw).map((row): LinkRowHealth => {
		if (row.verdict === "malformed" || row.verdict === "cap") return { index: row.index, health: row.verdict };
		if (row.verdict === "conflict") return { index: row.index, health: "conflict", link: row.link };
		if (snapshot === null) return { index: row.index, health: "unknown", link: row.link };
		const resolution = resolveReadingLink(snapshot, row.link);
		const health: LinkHealth =
			resolution.state === "shared-memory" ? "active-shared-memory" : resolution.state === "gadget" ? "active-gadget" : resolution.state === "neither-live" ? "waiting" : resolution.state;
		return { index: row.index, health, link: row.link };
	});
}

/** Whether a link's other endpoint (the one the current source does not
 * publish) would take over: seen this session in the stored unit (and,
 * for Shared Memory, the stored type). */
export type CounterpartReadiness = "ready" | "unseen" | "unit-changed" | "type-changed";

export function counterpartReadiness(link: ReadingLink, counterpart: Pick<CatalogEntry, "provider" | "unit" | "type"> | undefined): CounterpartReadiness {
	if (counterpart === undefined) return "unseen";
	if (counterpart.unit !== link.unit) return "unit-changed";
	if (counterpart.provider === "shared-memory" && counterpart.type !== link.sensorType) return "type-changed";
	return "ready";
}

/** Folded text for name comparison: NFKC, case folded, spaces collapsed. */
function folded(text: string): string {
	return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export type CounterpartSuggestion = "same-name" | "same-label";

export interface Counterpart {
	readonly endpoint: LinkEndpoint;
	/** Why it is listed first; never preselected, never applied alone. */
	readonly suggestion?: CounterpartSuggestion;
	/** Why a Link press would be refused for this pair. */
	readonly blocked?: LinkRefusal;
}

/**
 * The other provider's readings as counterparts for `focus`, in display
 * order: suggestions first (same source name and label, then same label,
 * both in the same unit), then the rest of the same unit, then readings
 * in another unit (blocked). Each carries the refusal a Link press would
 * meet, computed by planLinkEdit itself. When the focus is linked already
 * (`replacing` is its stored pair), the press is a relink of that row, so
 * that row never blocks a candidate; its own counterpart is a duplicate.
 */
export function counterpartsFor(focus: LinkEndpoint, candidates: readonly LinkEndpoint[], raw: unknown, lookup: EndpointLookup, replacing?: { readonly sharedMemory: string; readonly gadget: string }): Counterpart[] {
	const focusLabel = folded(focus.label);
	const focusSensor = folded(focus.sensor);
	const ranked = candidates
		.filter((candidate) => candidate.provider !== focus.provider && candidate.aliasOf === undefined)
		.map((endpoint): { rank: number; item: Counterpart } => {
			const pair = focus.provider === "shared-memory" ? { sharedMemory: focus.key, gadget: endpoint.key } : { sharedMemory: endpoint.key, gadget: focus.key };
			const plan = planLinkEdit(raw, replacing === undefined ? { op: "link", ...pair } : { op: "relink", ...pair, previous: replacing }, lookup);
			const sameUnit = endpoint.unit === focus.unit;
			const sameLabel = sameUnit && folded(endpoint.label) === focusLabel;
			const suggestion: CounterpartSuggestion | undefined = sameLabel ? (folded(endpoint.sensor) === focusSensor ? "same-name" : "same-label") : undefined;
			const rank = suggestion === "same-name" ? 0 : suggestion === "same-label" ? 1 : sameUnit ? 2 : 3;
			return { rank, item: { endpoint, ...(suggestion === undefined ? {} : { suggestion }), ...(plan.ok ? {} : { blocked: plan.reason }) } };
		});
	ranked.sort((a, b) => a.rank - b.rank || a.item.endpoint.sensor.localeCompare(b.item.endpoint.sensor) || a.item.endpoint.label.localeCompare(b.item.endpoint.label));
	return ranked.map((entry) => entry.item);
}
