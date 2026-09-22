/** Public data model for HWiNFO sensor snapshots. */

/** Reading categories reported by HWiNFO. */
export enum SensorType {
	None = 0,
	Temperature = 1,
	Voltage = 2,
	Fan = 3,
	Current = 4,
	Power = 5,
	Clock = 6,
	Usage = 7,
	Other = 8
}

/** A sensor source, e.g. "CPU [#0]: AMD Ryzen 9 9950X3D". */
export interface SensorSource {
	/** Position in the shared-memory sensor section (what readings reference). */
	readonly index: number;
	readonly id: number;
	readonly instance: number;
	/** Effective display name (user rename respected, UTF-8 preferred). */
	readonly name: string;
}

/** A single reading, e.g. "CPU (Tctl/Tdie) = 56.3 °C". */
export interface Reading {
	/** Every key that resolves to this measurement (its provider key and the
	 * confirmed aliases: explicit cross-provider links, and legacy Gadget keys
	 * kept resolvable), in the runtime's lookup order. Absent when the key
	 * stands alone. */
	readonly linkedKeys?: readonly string[];
	/** The provider's own key when this entry is a confirmed alias of it;
	 * absent on the provider's own entry. Personalization stays keyed by the
	 * saved key; sessions and history follow this identity. */
	readonly aliasOf?: string;
	/**
	 * Stable identity of this reading across HWiNFO restarts. Shared Memory:
	 * `sensorId:sensorInstance:readingId` (sensor id and reading id in hex,
	 * the instance in decimal); a tuple that occurs twice, or whose owner is
	 * missing, is withheld rather than numbered. Gadget: the source name and
	 * label (see gadget-identity.ts). Persist this in action settings, never
	 * the array index.
	 */
	readonly key: string;
	readonly type: SensorType;
	/** Index of the owning sensor in {@link SensorSnapshot.sensors}. */
	readonly sensorIndex: number;
	readonly id: number;
	/** Effective display label (user rename respected, UTF-8 preferred). */
	readonly label: string;
	readonly unit: string;
	readonly value: number;
	/** Producer history capability. Omitted on legacy snapshots means producer
	 * history; unavailable sources must not substitute their current value. */
	readonly statistics?: "producer" | "unavailable";
	readonly valueMin: number;
	readonly valueMax: number;
	readonly valueAvg: number;
}

/**
 * One consistent decode of the whole shared-memory region.
 *
 * Liveness: a provider may return the SAME snapshot instance on every tick
 * with the value fields updated in place (the skeleton of keys, labels,
 * units and sensors rarely changes within an HWiNFO session), or a FRESH
 * instance when the skeleton did change (flipping HWiNFO's unit settings
 * rewrites units in place; the parser detects it and rebuilds). Read what
 * you need when the tick arrives; copy scalars you want to keep. Do not
 * cache `Reading` objects across ticks expecting historical values.
 */
export interface SensorSnapshot {
	/** Rendering invalidation for changed explicit provider links. */
	readonly bindingRevision?: number;
	/** Gadget readings withheld because their names are incomplete, or
	 * shared with another row until two scans running show otherwise. */
	readonly blockedReadingCount?: number;
	/** Gadget rows withheld because the formatted value contradicts the raw
	 * value; the plugin log names the slot. */
	readonly contradictoryReadingCount?: number;
	/** Finite same-measurement value changes, distinct from render/topology
	 * revision. Initial decoding is zero. Producer timestamps travel only in
	 * pollTime so their evidence can be aged independently of value changes. */
	readonly freshnessRevision?: number;
	/** Unix seconds of HWiNFO's last sensor poll. Gadget uses the time of an
	 * observed value change, or zero when no change has been observed. */
	readonly pollTime: number;
	/**
	 * Bumped by the provider whenever any value actually changed or the
	 * snapshot was rebuilt. pollTime alone cannot carry this: it has
	 * one-second grain, and HWiNFO polling faster than 1 Hz rewrites
	 * values in place under an unchanged stamp. Consumers gating work on
	 * "did the data move" key on this; absent means the provider cannot
	 * tell, and pollTime granularity is the honest fallback.
	 */
	readonly valueRevision?: number;
	readonly version: number;
	readonly revision: number;
	readonly sensors: readonly SensorSource[];
	readonly readings: readonly Reading[];
	/** Lookup by {@link Reading.key}. */
	readonly byKey: ReadonlyMap<string, Reading>;
}

/** Why HWiNFO data is unavailable — drives the key/dial status screens. */
export type HwinfoUnavailableReason =
	/** Not running on Windows. */
	| "unsupported-platform"
	/** Mapping absent: HWiNFO isn't running, or Shared Memory Support is off. */
	| "not-running"
	/** Mapping and mutex exist but the consistency mutex stayed busy while
	 * opening. HWiNFO IS running; momentary contention, retried next poll. */
	| "busy"
	/** Gadget registry exists but no sensor has "Report value in Gadget" ticked. */
	| "gadget-empty"
	/** Mapping exists but we may not read it (privilege mismatch). */
	| "access-denied"
	/** Header magic is "DEAD": shared-memory support was turned off (or the free-version 12 h timer expired). */
	| "disabled"
	/** Header failed validation — unrecognized or corrupt layout. */
	| "invalid"
	/** The hwsm native bridge would not load on a supported machine (missing
	 * or blocked bin/hwsm.node, e.g. an antivirus quarantine): permanent until
	 * the install is repaired, unlike the transient "invalid". */
	| "bridge-failed";

export class HwinfoError extends Error {
	constructor(
		readonly reason: HwinfoUnavailableReason,
		message: string
	) {
		super(message);
		this.name = "HwinfoError";
	}
}
