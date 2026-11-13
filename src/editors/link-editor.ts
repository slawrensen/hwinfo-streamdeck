/**
 * The settings panel's "Reading links" editor, plugin side (steer 7D):
 * builds the workspace the panel shows (every stored link with its health
 * and fallback readiness, the focused reading, its counterparts and the
 * missing prerequisites) and plans the row-scoped edits an explicit Link,
 * Unlink or relink press commits through the global compare-and-swap
 * writer. SDK-free: the poller's views, the catalog, the clock and the
 * one-shot provider read are injected, so the unit suite drives it.
 *
 * Building a workspace writes nothing and changes no poller state, ever.
 * Only a workspace request that asks to scan (a person pressed "Look on
 * Gadget" or "Look on Shared Memory") reads the provider the poller is not
 * using, at most once per 5 s per provider, through `peek`: a separate
 * open, read and close that never touches the poller's provider, its
 * evidence, rings or ticks. A forced Data source mode is never broken:
 * the other provider is not read while one is forced. A Gadget value read
 * once is shown with "age unknown": an unchanged Gadget value is never
 * taken for a producer heartbeat.
 */
import type { JsonObject, JsonValue } from "@elgato/utils";

import { globalFieldSignature } from "../global-writer";
import {
	counterpartReadiness,
	counterpartsFor,
	linkEndpointProvider,
	linkRowHealth,
	planLinkEdit,
	type CatalogEntry,
	type CounterpartReadiness,
	type EndpointLookup,
	type LinkEdit,
	type LinkEditPlan,
	type LinkEndpoint,
	type LinkHealth,
	type LinkRefusal,
	type ReadingCatalog
} from "../hwinfo/link-pairing";
import type { SnapshotSource } from "../hwinfo/provider";
import { READING_LINKS_MAX, readingLinkRows } from "../hwinfo/reading-links";
import { HwinfoError, SensorType, type SensorSnapshot } from "../hwinfo/types";
import type { PollerStatus, SourceMode } from "../poller";
import { formatMeasurement, type DataUnitsPref } from "../ui/measure";

/** One provider read at most this often per provider (a Gadget scan of a
 * large registry costs real time on the plugin's one thread). */
export const LINK_PEEK_INTERVAL_MS = 5000;
/** Counterparts sent with a workspace at most (suggestions always fit). */
export const LINK_CANDIDATES_MAX = 400;

export interface LinkEditorDeps {
	status(): PollerStatus;
	/** The provider's own observation behind the status (unlinked). */
	raw(): { readonly snapshot: SensorSnapshot; readonly source: SnapshotSource } | null;
	mode(): SourceMode;
	readonly catalog: ReadingCatalog;
	/** Monotonic milliseconds. */
	now(): number;
	/** The global document the plugin last received (the workspace basis). */
	globals(): JsonObject | undefined;
	/** One read of a provider the poller is not using; throws HwinfoError. */
	peek(provider: SnapshotSource): SensorSnapshot;
	dataUnits(): DataUnitsPref;
}

type PeekRecord = { readonly at: number; readonly ok: boolean; readonly reason?: string; readonly withheld: number };

export type LinkEndpointPayload = {
	key: string;
	provider: SnapshotSource;
	sensor: string;
	label: string;
	unit: string;
	type: number;
	/** The value as the faces would format it (native unit, no °F). */
	display: string;
	/** live | not-updating | age-unknown | seen | read-once */
	availability: string;
	/** The availability in words. */
	availabilityText: string;
};

export type LinkRowPayload = {
	index: number;
	sharedMemory: string | null;
	gadget: string | null;
	unit: string | null;
	health: LinkHealth;
	healthText: string;
	readiness: CounterpartReadiness | null;
	readinessText: string;
	sm: LinkEndpointPayload | null;
	gd: LinkEndpointPayload | null;
	/** An Unlink can match this row (it is an object with two string keys). */
	removable: boolean;
};

export type LinkCandidatePayload = LinkEndpointPayload & { suggestion: string | null; suggestionText: string; blocked: LinkRefusal | null; blockedText: string };

export type LinkFocusPayload = {
	key: string;
	provider: SnapshotSource | null;
	/** Why this saved key cannot be linked at all (a calculated reading, an unknown spelling). */
	notLinkable: string;
	endpoint: LinkEndpointPayload | null;
	/** Stored index of the valid row that holds this key, or -1. */
	linkedRow: number;
	candidates: LinkCandidatePayload[];
	moreCandidates: number;
	/** Hash of what the candidate list shows apart from live values (keys,
	 * names, units, suggestions, refusals). A refresh that sends back the
	 * same signature gets only the chosen candidate, not the whole list. */
	candidatesSignature: string;
	/** True when `candidates` holds only the chosen one (the list the panel
	 * holds under `candidatesSignature` is still the list). */
	candidatesUnchanged: boolean;
};

export type LinkPrerequisite = { id: string; text: string; action: "source" | "setup" | "scan" | "config" | null };

export type LinkWorkspace = {
	signature: string;
	mode: SourceMode;
	active: SnapshotSource | null;
	state: PollerStatus["state"];
	max: number;
	rows: LinkRowPayload[];
	counts: { stored: number; active: number; waiting: number; ignored: number };
	focus: LinkFocusPayload | null;
	prerequisites: LinkPrerequisite[];
	scan: { provider: SnapshotSource; text: string; throttled: boolean } | null;
};

const PROVIDER_NAME: Readonly<Record<SnapshotSource, string>> = { "shared-memory": "Shared Memory", gadget: "Gadget registry" };
const OTHER: Readonly<Record<SnapshotSource, SnapshotSource>> = { "shared-memory": "gadget", gadget: "shared-memory" };
const TYPE_NAMES = ["no type", "Temperature", "Voltage", "Fan", "Current", "Power", "Clock", "Usage", "Other"];

/** The words for a refused edit; every one also says nothing changed by
 * being shown instead of a change. */
export function linkRefusalText(reason: LinkRefusal | "stale-basis" | "read-failed" | "write-failed", detail?: { unitA?: string; unitB?: string; typeA?: number; typeB?: number }): string {
	switch (reason) {
		case "malformed":
			return "A link needs one Shared Memory reading and one Gadget reading.";
		case "unreadable-list":
			return "The stored readingLinks value is not a list. Fix or remove it in Configuration documents first.";
		case "legacy-alias":
			return "This Gadget key is an older spelling. Pick the reading again while the Gadget source is active and link the new key.";
		case "missing-counterpart":
			return "That reading was not seen in this session, so its unit cannot be checked. Read the other source first.";
		case "ambiguous":
			return "That key named two different readings in this session (HWiNFO re-enumerated its sensors). Check HWiNFO and pick it again.";
		case "unit-mismatch":
			return `The units differ (${detail?.unitA || "no unit"} and ${detail?.unitB || "no unit"}). A link never converts units.`;
		case "type-mismatch":
			return `HWiNFO reports different reading types (${TYPE_NAMES[detail?.typeA ?? 0] ?? "?"} and ${TYPE_NAMES[detail?.typeB ?? 0] ?? "?"}).`;
		case "duplicate":
			return "These two readings are linked already.";
		case "conflict":
			return "One of these readings is in another link. Unlink that one first.";
		case "cap":
			return `The list holds ${READING_LINKS_MAX} links, the most it can hold. Unlink one first.`;
		case "not-linked":
			return "That link is no longer stored.";
		case "stale-basis":
			return "The links changed in another panel or document since this list was shown. Check the refreshed list and press again.";
		case "read-failed":
		case "write-failed":
			return "The Stream Deck app did not take the change. Nothing was linked or unlinked; try again.";
	}
}

function healthText(health: LinkHealth, row: { unit: string | null; found?: string }): string {
	switch (health) {
		case "active-shared-memory":
			return "In use: Shared Memory is publishing it.";
		case "active-gadget":
			return "In use: the Gadget registry is publishing it.";
		case "waiting":
			return "Waiting: the current source publishes neither reading.";
		case "both-live":
			return "Not applied: both readings are published at once.";
		case "unit-changed":
			return `Not applied: the reading now reports ${row.found || "no unit"}, the link says ${row.unit || "no unit"}.`;
		case "type-changed":
			return "Not applied: HWiNFO now reports another reading type.";
		case "malformed":
			return "Ignored by the plugin: not a valid link row. Kept as stored.";
		case "conflict":
			return "Ignored by the plugin: a reading in it is also in another row. Kept as stored.";
		case "cap":
			return `Ignored: the list holds more than ${READING_LINKS_MAX} rows.`;
		case "unknown":
			return "No HWiNFO data to check it against right now.";
	}
}

function readinessText(readiness: CounterpartReadiness, counterpart: SnapshotSource, entry: CatalogEntry | undefined): string {
	const name = PROVIDER_NAME[counterpart];
	switch (readiness) {
		case "ready":
			return `${name} reading seen in this session in the same unit: it takes over when ${name} is the source.`;
		case "unseen":
			return counterpart === "gadget" ? "Gadget reading not seen in this session. Press Look on Gadget to check it." : "Shared Memory reading not seen in this session.";
		case "unit-changed":
			return `${name} reading now reports ${entry?.unit || "no unit"}; it would not take over.`;
		case "type-changed":
			return "Shared Memory reports another reading type now; it would not take over.";
	}
}

export class LinkEditor {
	private readonly peeks: Partial<Record<SnapshotSource, PeekRecord>> = {};

	constructor(private readonly deps: LinkEditorDeps) {}

	/** Facts about one endpoint: the snapshot the poller holds when that
	 * provider publishes it now, else this session's catalog. */
	readonly endpointOf: EndpointLookup = (provider, key) => {
		const raw = this.deps.raw();
		const entry = this.deps.catalog.get(provider, key);
		const reading = raw !== null && raw.source === provider ? raw.snapshot.byKey.get(key) : undefined;
		if (reading === undefined || raw === null) return entry === undefined ? undefined : { ...entry, published: false };
		return {
			key,
			provider,
			sensor: raw.snapshot.sensors[reading.sensorIndex]?.name ?? "",
			label: reading.label,
			unit: reading.unit,
			type: reading.type,
			value: reading.value,
			seenAt: this.deps.catalog.lastSeen(provider)?.at ?? this.deps.now(),
			via: "read",
			renamed: entry?.renamed ?? false,
			...(reading.aliasOf === undefined ? {} : { aliasOf: reading.aliasOf }),
			published: true
		};
	};

	/** The stored readingLinks value the plugin last received. */
	private storedLinks(): unknown {
		return this.deps.globals()?.readingLinks;
	}

	private endpointPayload(endpoint: LinkEndpoint): LinkEndpointPayload {
		const status = this.deps.status();
		const m = formatMeasurement(endpoint.value, endpoint.unit, { decimals: "auto", fahrenheit: false, dataUnits: this.deps.dataUnits() });
		let availability: string;
		let availabilityText: string;
		// Gadget has no per-reading stamp and an unchanged value proves
		// nothing about the producer, so a Gadget reading is never "live".
		if (endpoint.published && status.state === "ok" && endpoint.provider === "shared-memory") {
			availability = "live";
			availabilityText = "Live on Shared Memory";
		} else if (endpoint.published && status.state === "ok") {
			availability = "age-unknown";
			availabilityText = "Published by the Gadget registry now, age unknown";
		} else if (endpoint.published && status.state === "stale") {
			availability = endpoint.provider === "gadget" ? "age-unknown" : "not-updating";
			availabilityText = endpoint.provider === "gadget" ? "Published by the Gadget registry, age unknown" : "Published by Shared Memory, not updating";
		} else {
			const ago = Math.max(0, Math.round((this.deps.now() - endpoint.seenAt) / 1000));
			const when = ago < 60 ? `${ago} s ago` : ago < 3600 ? `${Math.floor(ago / 60)} min ago` : `${Math.floor(ago / 3600)} h ago`;
			availability = endpoint.via === "peek" ? "read-once" : "seen";
			availabilityText =
				endpoint.via === "peek"
					? `Read once from ${PROVIDER_NAME[endpoint.provider]} ${when}${endpoint.provider === "gadget" ? ", age unknown" : ""}`
					: `Not published now; last seen on ${PROVIDER_NAME[endpoint.provider]} ${when}`;
		}
		return {
			key: endpoint.key,
			provider: endpoint.provider,
			sensor: endpoint.sensor,
			label: endpoint.label,
			unit: endpoint.unit,
			type: endpoint.type,
			display: `${m.valueText} ${m.unitText}`.trim(),
			availability,
			availabilityText
		};
	}

	/**
	 * Reads the provider the poller is not using, once, when allowed:
	 * Auto mode only, not within 5 s of the last read of that provider.
	 * The snapshot goes into the catalog as a "peek"; nothing else changes.
	 */
	private scan(asked: unknown): LinkWorkspace["scan"] {
		const raw = this.deps.raw();
		const status = this.deps.status();
		const active = raw?.source ?? (status.state === "unavailable" ? null : status.source);
		// The provider in use is read every tick already; only the other
		// one (either, while neither answers) is ever peeked.
		const named = asked === "gadget" || asked === "shared-memory" ? asked : undefined;
		const target: SnapshotSource = active === null ? (named ?? "gadget") : OTHER[active];
		if (this.deps.mode() !== "auto") return { provider: target, text: "Not read: the Data source setting keeps the plugin on one provider.", throttled: false };
		const last = this.peeks[target];
		const now = this.deps.now();
		if (last !== undefined && now - last.at < LINK_PEEK_INTERVAL_MS) return { provider: target, text: this.peekText(target, last), throttled: true };
		let record: PeekRecord;
		try {
			const snapshot = this.deps.peek(target);
			this.deps.catalog.observe(snapshot, target, now, "peek");
			record = { at: now, ok: true, withheld: (snapshot.blockedReadingCount ?? 0) + (snapshot.contradictoryReadingCount ?? 0) };
		} catch (err) {
			record = { at: now, ok: false, reason: err instanceof HwinfoError ? err.reason : "invalid", withheld: 0 };
		}
		this.peeks[target] = record;
		return { provider: target, text: this.peekText(target, record), throttled: false };
	}

	private peekText(provider: SnapshotSource, record: PeekRecord): string {
		const count = this.deps.catalog.size(provider);
		if (record.ok) return `Read ${PROVIDER_NAME[provider]} once: ${count} reading${count === 1 ? "" : "s"} known from it in this session.`;
		return `Could not read ${PROVIDER_NAME[provider]}: ${this.failureText(provider, record.reason)}`;
	}

	private failureText(provider: SnapshotSource, reason: string | undefined): string {
		if (provider === "gadget") {
			if (reason === "gadget-empty") return "the Gadget registry holds no readings. In HWiNFO, tick Report value in Gadget for the readings to link.";
			if (reason === "not-running") return "no Gadget registry key. In HWiNFO, tick Enable reporting to Gadget, then Report value in Gadget for the readings to link.";
			if (reason === "busy") return "the readings changed during the read. Try again in a few seconds.";
			return "the registry could not be read.";
		}
		if (reason === "disabled") return "Shared Memory is off (the free version turns it off after 12 hours). Readings seen earlier in this session can still be linked.";
		if (reason === "not-running") return "no Shared Memory. Enable Shared Memory Support in HWiNFO's settings.";
		if (reason === "access-denied") return "Windows denied access to Shared Memory.";
		if (reason === "busy") return "HWiNFO was busy. Try again in a few seconds.";
		return "Shared Memory could not be read.";
	}

	/** The panel's workspace for one request. Writes nothing. */
	workspace(request: { focusKey?: unknown; scan?: unknown; provider?: unknown; candidatesSignature?: unknown; chosen?: unknown }): LinkWorkspace {
		const scan = request.scan === true ? this.scan(request.provider) : null;
		const stored = this.storedLinks();
		const raw = this.deps.raw();
		const status = this.deps.status();
		const mode = this.deps.mode();
		const active = raw?.source ?? null;
		const storedRows: readonly unknown[] = Array.isArray(stored) ? (stored as unknown[]) : [];
		const rows: LinkRowPayload[] = linkRowHealth(stored, raw?.snapshot ?? null).map((row) => {
			const item = storedRows[row.index];
			const record = typeof item === "object" && item !== null && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
			const sharedMemory = typeof record?.sharedMemory === "string" ? record.sharedMemory : null;
			const gadget = typeof record?.gadget === "string" ? record.gadget : null;
			const unit = typeof record?.unit === "string" ? record.unit : null;
			const sm = sharedMemory === null || linkEndpointProvider(sharedMemory) !== "shared-memory" ? undefined : this.endpointOf("shared-memory", sharedMemory);
			const gd = gadget === null || linkEndpointProvider(gadget) !== "gadget" ? undefined : this.endpointOf("gadget", gadget);
			const found = row.health === "unit-changed" ? (sm?.published === true ? sm.unit : gd?.unit) : undefined;
			let readiness: CounterpartReadiness | null = null;
			let readyText = "";
			if (row.link !== undefined && (row.health === "active-shared-memory" || row.health === "active-gadget")) {
				const counterpart: SnapshotSource = row.health === "active-shared-memory" ? "gadget" : "shared-memory";
				const entry = this.deps.catalog.get(counterpart, counterpart === "gadget" ? row.link.gadget : row.link.sharedMemory);
				readiness = counterpartReadiness(row.link, entry);
				readyText = readinessText(readiness, counterpart, entry);
			}
			return {
				index: row.index,
				sharedMemory,
				gadget,
				unit,
				health: row.health,
				healthText: healthText(row.health, { unit, found }),
				readiness,
				readinessText: readyText,
				sm: sm === undefined ? null : this.endpointPayload(sm),
				gd: gd === undefined ? null : this.endpointPayload(gd),
				removable: sharedMemory !== null && gadget !== null
			};
		});
		const counts = {
			stored: rows.length,
			active: rows.filter((row) => row.health === "active-shared-memory" || row.health === "active-gadget").length,
			waiting: rows.filter((row) => row.health === "waiting").length,
			ignored: rows.filter((row) => row.health === "malformed" || row.health === "conflict" || row.health === "cap").length
		};
		return {
			signature: globalFieldSignature(stored),
			mode,
			active,
			state: status.state,
			max: READING_LINKS_MAX,
			rows,
			counts,
			focus: typeof request.focusKey === "string" && request.focusKey !== "" ? this.focus(request.focusKey, stored, request.candidatesSignature, request.chosen) : null,
			prerequisites: this.prerequisites(stored, status, mode, active),
			scan
		};
	}

	private focus(key: string, stored: unknown, heldSignature?: unknown, chosen?: unknown): LinkFocusPayload {
		const provider = linkEndpointProvider(key) ?? null;
		const base: LinkFocusPayload = { key, provider, notLinkable: "", endpoint: null, linkedRow: -1, candidates: [], moreCandidates: 0, candidatesSignature: globalFieldSignature([key]), candidatesUnchanged: false };
		if (provider === null) {
			return { ...base, notLinkable: key.startsWith("calc:") ? "A calculated reading is not linked itself; it follows its inputs, which can be." : "This saved key is not a current Shared Memory or Gadget key, so it cannot be linked." };
		}
		const linked = readingLinkRows(stored).find((row) => row.verdict === "valid" && (row.link.sharedMemory === key || row.link.gadget === key));
		const linkedRow = linked?.index ?? -1;
		const endpoint = this.endpointOf(provider, key);
		if (endpoint === undefined) return { ...base, linkedRow };
		const other = OTHER[provider];
		const pool = this.deps.catalog.list(other).map((entry) => this.endpointOf(other, entry.key) ?? { ...entry, published: false });
		// A linked focus offers a relink of its own row (the panel's Replace link).
		const replacing = linked?.verdict === "valid" ? { sharedMemory: linked.link.sharedMemory, gadget: linked.link.gadget } : undefined;
		const all = counterpartsFor(endpoint, pool, stored, this.endpointOf, replacing);
		const suggested = all.filter((c) => c.suggestion !== undefined);
		const kept = all.length <= LINK_CANDIDATES_MAX ? all : [...suggested, ...all.filter((c) => c.suggestion === undefined).slice(0, Math.max(0, LINK_CANDIDATES_MAX - suggested.length))];
		const candidates = kept.map((c): LinkCandidatePayload => {
			const sm = provider === "shared-memory" ? endpoint : c.endpoint;
			const gd = provider === "shared-memory" ? c.endpoint : endpoint;
			return {
				...this.endpointPayload(c.endpoint),
				suggestion: c.suggestion ?? null,
				suggestionText: c.suggestion === "same-name" ? "Same source name, label and unit" : c.suggestion === "same-label" ? "Same label and unit" : "",
				blocked: c.blocked ?? null,
				blockedText: c.blocked === undefined ? "" : linkRefusalText(c.blocked, { unitA: sm.unit, unitB: gd.unit, typeA: sm.type, typeB: gd.type })
			};
		});
		const moreCandidates = all.length - kept.length;
		const candidatesSignature = globalFieldSignature([key, moreCandidates, ...candidates.map((c) => [c.key, c.provider, c.sensor, c.label, c.unit, c.type, c.suggestion, c.suggestionText, c.blocked, c.blockedText])]);
		// The 2 s refresh of an open section: the list the panel holds is
		// still the list, so only the chosen candidate (its live value) goes.
		if (heldSignature === candidatesSignature) {
			return { ...base, endpoint: this.endpointPayload(endpoint), linkedRow, candidates: candidates.filter((c) => c.key === chosen), moreCandidates, candidatesSignature, candidatesUnchanged: true };
		}
		return { ...base, endpoint: this.endpointPayload(endpoint), linkedRow, candidates, moreCandidates, candidatesSignature, candidatesUnchanged: false };
	}

	private prerequisites(stored: unknown, status: PollerStatus, mode: SourceMode, active: SnapshotSource | null): LinkPrerequisite[] {
		const out: LinkPrerequisite[] = [];
		if (stored !== undefined && stored !== null && !Array.isArray(stored)) {
			out.push({ id: "unreadable", text: linkRefusalText("unreadable-list"), action: "config" });
		} else if (Array.isArray(stored) && stored.length > READING_LINKS_MAX) {
			out.push({ id: "over-cap", text: `The list holds more than ${READING_LINKS_MAX} rows, so no link applies. Remove rows in Configuration documents.`, action: "config" });
		} else if (Array.isArray(stored) && stored.length === READING_LINKS_MAX) {
			out.push({ id: "cap", text: linkRefusalText("cap"), action: null });
		}
		if (status.state === "unavailable") out.push({ id: "unavailable", text: "HWiNFO data is unavailable, so link health cannot be checked now.", action: "setup" });
		if (mode !== "auto") {
			out.push({
				id: "forced-source",
				text: `Data source is set to ${mode === "gadget" ? "Gadget registry only" : "Shared Memory only"}, so the other provider is never read and a link never takes over. Links apply in Auto.`,
				action: "source"
			});
		}
		const other: SnapshotSource = active === null ? "gadget" : OTHER[active];
		const peek = this.peeks[other];
		if (mode === "auto" && peek !== undefined && !peek.ok) {
			out.push({ id: `${other}-unreadable`, text: `${PROVIDER_NAME[other]}: ${this.failureText(other, peek.reason)}`, action: other === "gadget" ? "setup" : null });
		} else if (mode === "auto" && this.deps.catalog.lastSeen(other) === undefined) {
			out.push({ id: "not-read", text: `${PROVIDER_NAME[other]} has not been read in this session, so its readings and units are unknown.`, action: "scan" });
		}
		const raw = this.deps.raw();
		const withheld = raw?.source === "gadget" ? (raw.snapshot.blockedReadingCount ?? 0) : (peek?.withheld ?? 0);
		if (withheld > 0) {
			out.push({ id: "withheld", text: `${withheld} Gadget reading${withheld === 1 ? " is" : "s are"} withheld (two rows share a name, or a value contradicts itself) and cannot be linked until HWiNFO shows one name per row.`, action: null });
		}
		return out;
	}

	/** Plans an explicit edit against the stored value the writer read. */
	plan(current: unknown, edit: LinkEdit): LinkEditPlan {
		return planLinkEdit(current, edit, this.endpointOf);
	}

	/** The detail words for a refusal of `edit` (units and types named). */
	refusalDetail(edit: LinkEdit): { unitA?: string; unitB?: string; typeA?: number; typeB?: number } {
		const sm = this.endpointOf("shared-memory", edit.sharedMemory);
		const gd = this.endpointOf("gadget", edit.gadget);
		return { unitA: sm?.unit, unitB: gd?.unit, typeA: sm?.type ?? SensorType.None, typeB: gd?.type ?? SensorType.None };
	}
}

/** Reads a link edit out of a panel message; undefined when malformed. */
export function linkEditOf(payload: Readonly<Record<string, JsonValue | undefined>>): LinkEdit | undefined {
	const op = payload.op;
	const sharedMemory = payload.sharedMemory;
	const gadget = payload.gadget;
	if (typeof sharedMemory !== "string" || typeof gadget !== "string") return undefined;
	if (op === "link" || op === "unlink") return { op, sharedMemory, gadget };
	if (op === "relink") {
		const previous = payload.previous;
		if (typeof previous !== "object" || previous === null || Array.isArray(previous)) return undefined;
		const p = previous as Record<string, JsonValue | undefined>;
		if (typeof p.sharedMemory !== "string" || typeof p.gadget !== "string") return undefined;
		return { op, sharedMemory, gadget, previous: { sharedMemory: p.sharedMemory, gadget: p.gadget } };
	}
	return undefined;
}
