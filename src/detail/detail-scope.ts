/**
 * Source-scoped hand-placed keys on the shared detail page (7E). The one
 * detail page per deck class is shared by every opener, so a Sensor
 * Reading key placed on it shows on every drill-down. A key carrying
 * detailScope belongs only to the detail pages of the HWiNFO sources it
 * lists: while the device shows a managed detail page opened from any
 * other source, the key draws a blank face and its press does nothing.
 * Pure decisions; the action feeds the navigator's view of the device.
 */
import type { SnapshotSource } from "../hwinfo/provider";
import { keyProducerOf } from "../hwinfo/key-namespace";
import type { SensorSnapshot, SensorSource } from "../hwinfo/types";
import { detailRoleOf, detailScopeOf } from "./detail-settings";

/** An HWiNFO source as a scope names it, plus its display name. */
export type DetailSource = { readonly id: string; readonly name: string };

/**
 * The scope id of one source under the active data source. Shared Memory:
 * the sensor's stable `sensorIdHex:instance`, the same spelling as the
 * front of its reading keys. Gadget publishes no sensor ids, so the
 * source name is the identity there, exactly as HWiNFO writes it. Only a
 * reading whose own key is a Shared Memory key takes the id spelling: the
 * plugin's Calculated source (and any other producer's) is named by its
 * name on both data sources, so it can never pass for a hardware sensor.
 */
export function detailSourceIdOf(sensor: SensorSource, source: SnapshotSource, providerKey: string): string {
	return source === "shared-memory" && keyProducerOf(providerKey) === "shared-memory" ? `${sensor.id.toString(16)}:${sensor.instance}` : sensor.name;
}

/** The source that owns a reading key in a snapshot, or undefined when
 * the key does not resolve (missing, withheld, or an orphan row). */
export function detailSourceOf(snapshot: SensorSnapshot, readingKey: string, source: SnapshotSource): DetailSource | undefined {
	const reading = snapshot.byKey.get(readingKey);
	if (reading === undefined || reading.sensorIndex < 0) {
		return undefined;
	}
	const sensor = snapshot.sensors[reading.sensorIndex];
	if (sensor === undefined) {
		return undefined;
	}
	return { id: detailSourceIdOf(sensor, source, reading.aliasOf ?? reading.key), name: sensor.name };
}

/** The display name of a scope id in a snapshot, or undefined when no
 * source of the active data source carries that id right now. */
export function detailSourceNameOf(snapshot: SensorSnapshot, id: string, source: SnapshotSource): string | undefined {
	for (const reading of snapshot.readings) {
		if (reading.sensorIndex < 0) continue;
		const sensor = snapshot.sensors[reading.sensorIndex];
		if (sensor !== undefined && detailSourceIdOf(sensor, source, reading.aliasOf ?? reading.key) === id) return sensor.name;
	}
	return undefined;
}

/** The spelling of a Shared Memory scope id (`sensorIdHex:instance`), the
 * front of a Shared Memory reading key. Gadget names and the Calculated
 * source's name never take this shape. */
const SHARED_MEMORY_SOURCE_ID = /^[0-9a-f]{1,8}:\d{1,10}$/;

/** One scope entry as the settings panel lists it right now. */
export type DetailScopeEntry = {
	readonly id: string;
	/** The name to show: the source's name when it is in HWiNFO now, or
	 *  the id itself when the id is a name (Gadget, Calculated); null for
	 *  a Shared Memory id nothing names right now. */
	readonly name: string | null;
	/** present: the source is in HWiNFO now on the active data source.
	 *  other-source: saved while the plugin read the other data source,
	 *  so it cannot match until it is added again on this one.
	 *  absent: no source carries the id now. no-data: HWiNFO sends no
	 *  data, so nothing can be told yet. */
	readonly state: "present" | "other-source" | "absent" | "no-data";
	/** The data source the entry was saved with, for other-source. */
	readonly savedWith?: SnapshotSource;
};

/**
 * How one scope id reads against the live data. A Shared Memory id never
 * matches while the plugin reads Gadget (Gadget publishes no sensor ids),
 * and a Gadget name never matches a Shared Memory sensor (Shared Memory
 * names its sensors by id), so each is told apart from a sensor that
 * really left: an entry is "absent" only when the data source it was
 * saved with is the active one and nothing carries it.
 */
export function describeScopeSource(snapshot: SensorSnapshot | null, id: string, source: SnapshotSource | undefined): DetailScopeEntry {
	const isSensorId = SHARED_MEMORY_SOURCE_ID.test(id);
	const asName = isSensorId ? null : id;
	if (snapshot === null || source === undefined) {
		return { id, name: asName, state: "no-data" };
	}
	const name = detailSourceNameOf(snapshot, id, source);
	if (name !== undefined) {
		return { id, name, state: "present" };
	}
	if (source === "gadget" && isSensorId) {
		return { id, name: null, state: "other-source", savedWith: "shared-memory" };
	}
	if (source === "shared-memory" && !isSensorId && snapshot.sensors.some((sensor) => sensor.name === id)) {
		return { id, name: id, state: "other-source", savedWith: "gadget" };
	}
	return { id, name: asName, state: "absent" };
}

/** The panel's detailScope answer, as JSON. */
export type DetailScopePayload = {
	event: "detailScope";
	context: string;
	onDetailPage: boolean;
	opener: { id: string; name: string } | null;
	sources: { id: string; name: string | null; state: DetailScopeEntry["state"]; savedWith?: SnapshotSource }[];
};

/** The panel's detailScope answer: whether the key sits on a managed
 * detail page, the opener's source, and how each listed source reads now.
 * Pure and read-only; the action sends it. */
export function detailScopePayloadOf(context: string, onPage: boolean, opener: DetailSource | undefined, scope: readonly string[], snapshot: SensorSnapshot | null, source: SnapshotSource | undefined): DetailScopePayload {
	return {
		event: "detailScope",
		context,
		onDetailPage: onPage,
		opener: opener === undefined ? null : { id: opener.id, name: opener.name },
		sources: scope.map((id) => {
			const entry = describeScopeSource(snapshot, id, source);
			return entry.savedWith === undefined ? { id: entry.id, name: entry.name, state: entry.state } : { id: entry.id, name: entry.name, state: entry.state, savedWith: entry.savedWith };
		})
	};
}

/** What the action knows about the device a key sits on. Sessions are
 * compared by identity: the navigator mints one object per entry. */
export type DetailPageView<Session> = {
	/** The device's live detail session, if any. */
	readonly session: Session | undefined;
	/** The session that was live when this key last appeared, if any. */
	readonly appearedUnder: Session | undefined;
	/** Detail slots of the session are registered on the device. */
	readonly surfaceLive: boolean;
	/** The session still waits for its first detail slot (the switch has
	 *  not landed yet, or the install prompt is open). */
	readonly sessionPending: boolean;
	/** The device left a detail page within the app's switch beat. */
	readonly recentlyLeft: boolean;
	/** The session opener's source id; undefined while it is unknown. */
	readonly openerSource: string | undefined;
};

/**
 * Whether a key sits on a managed detail page right now: a session is
 * live and either its slots are on the device (every visible key is then
 * on that page) or the key appeared while the session still waited for
 * its slots (the app may show placed keys before the hidden slots
 * register). A key from the page the opener was pressed on appeared
 * before the session and stays an ordinary key until the switch removes
 * it, and a key that appears after every slot left (a profile changed by
 * hand, the session not yet dropped) is on that other page, not this one.
 */
export function onDetailPage<Session>(view: DetailPageView<Session>): boolean {
	return view.session !== undefined && (view.surfaceLive || (view.sessionPending && view.appearedUnder === view.session));
}

/**
 * True when a key must draw blank and ignore presses. Never for the Back
 * tile (the way out) and never without a usable detailScope, so absent,
 * junk and empty scopes keep today's behavior byte for byte. On a detail
 * page the key shows only when the opener's source is known and listed;
 * an unknown source (HWiNFO down at entry) hides it until the source
 * resolves. Through the app's switch beat after Back, a scoped key from
 * that page stays blank too: the app replays each key's last image on
 * the next entry, and a blank replay is right on any page while a live
 * face would show on a page it does not belong to.
 */
export function scopedKeyHidden<Session>(settings: { detailScope?: unknown; detailRole?: unknown }, view: DetailPageView<Session>): boolean {
	if (detailRoleOf(settings) === "back") {
		return false;
	}
	const scope = detailScopeOf(settings);
	if (scope === undefined) {
		return false;
	}
	if (onDetailPage(view)) {
		return view.openerSource === undefined || !scope.includes(view.openerSource);
	}
	return view.session === undefined && view.appearedUnder !== undefined && view.recentlyLeft;
}
