/**
 * HWiNFO "Gadget" registry backend — `HKCU\Software\HWiNFO64\VSB` holds
 * `Sensor<i>` / `Label<i>` / `Value<i>` / `ValueRaw<i>` REG_SZ values for every
 * reading the user ticked "Report value in Gadget" for (HWiNFO writes a fifth,
 * `Color<i>`, which this reader has no use for). Unlike shared memory it never
 * expires on the free version, but it carries no min/max/avg, no ids and no
 * poll timestamp. `Value` is display-formatted and may carry a thousands
 * separator ("2,295.0 MHz"); `ValueRaw` is the one to parse.
 *
 * The provider owns ONE opaque native GadgetKey for its lifetime (opened
 * under HKCU with query-only rights by the hwsm bridge); every value read
 * reuses the key and the bridge's native buffer, so a read allocates only
 * the value names it queries and the JavaScript strings it returns.
 *
 * Freshness: the registry is NOT cleared when HWiNFO exits, so absence can't
 * be detected structurally. Only changes to an already observed, unambiguous
 * reading in the same unit advance value evidence. Initial reads and topology
 * changes leave age unverified. Steady values cannot prove a producer exit.
 */
import { GadgetIdentityGuard, gadgetReadingKey } from "./gadget-identity";
import { getHwsm, hwsmCode, hwsmWin32, type HwsmGadgetKey } from "./hwsm-loader";
import { HwinfoError, SensorType, type Reading, type SensorSnapshot, type SensorSource } from "./types";

/** Overridable so the gadget e2e can point at a synthetic key. */
const VSB_SUBKEY = process.env.HWINFO_VSB_KEY || "Software\\HWiNFO64\\VSB";

/**
 * The scan bound. The numbering is sparse (see readEntries), so there is no
 * end-of-list marker to stop on and every read walks a fixed range instead.
 * The range a live set occupies is bounded by how many readings are ticked
 * at once, not by how many have ever been ticked: HWiNFO hands the flagged
 * readings a dense run of VSBidx values (issue #21 reports 39 flagged
 * readings running 0..38 with no gap in the configuration), and the holes
 * appear only in what gets written. 1024 slots is far above any set a person
 * would tick, and the bound is also what keeps a corrupt or hostile key from
 * turning one poll tick into an unbounded walk. A reading parked at an index
 * at or above it is not read.
 */
const MAX_ENTRIES = 1024;
/** Win32 ERROR_KEY_DELETED: the key vanished under our open handle. */
const ERROR_KEY_DELETED = 1018;

/** Maps a display unit to the closest HWiNFO sensor type for picker chips. */
function inferType(unit: string): SensorType {
	switch (unit) {
		case "°C":
		case "°F":
			return SensorType.Temperature;
		case "RPM":
			return SensorType.Fan;
		case "V":
		case "mV":
			return SensorType.Voltage;
		case "A":
			return SensorType.Current;
		case "W":
			return SensorType.Power;
		case "MHz":
		case "GHz":
			return SensorType.Clock;
		case "%":
			return SensorType.Usage;
		default:
			return SensorType.Other;
	}
}

/** "45.5 °C" → "°C"; "1 200 RPM" → "RPM"; "Yes" → "". */
function unitOf(formatted: string): string {
	const match = /^\s*-?[\d.,\s]*(.*)$/.exec(formatted);
	return (match?.[1] ?? "").trim();
}

/** Native registry failure → status-screen reason. */
function toHwinfoError(err: unknown): unknown {
	const code = hwsmCode(err);
	if (code === "") {
		return err;
	}
	if (code === "HWSM_REGISTRY_NOT_FOUND" || hwsmWin32(err) === ERROR_KEY_DELETED) {
		return new HwinfoError("not-running", `HWiNFO Gadget registry key HKCU\\${VSB_SUBKEY} is not present: enable Gadget reporting in HWiNFO, or start HWiNFO.`);
	}
	if (code === "HWSM_REGISTRY_ACCESS_DENIED") {
		return new HwinfoError("access-denied", `Reading HKCU\\${VSB_SUBKEY} was denied.`);
	}
	return new HwinfoError("invalid", (err as Error).message);
}

export class GadgetRegistryProvider {
	readonly source = "gadget";
	private readonly identity = new GadgetIdentityGuard(VSB_SUBKEY);

	private lastDigest = "";
	/** Counts digest changes: the same fact valueRevision carries for shared
	 * memory, so two registry rewrites within one second stay distinguishable
	 * even though the synthesized pollTime cannot move twice in it. */
	private valueRevision = 0;
	private lastChangeSec = 0;
	private freshnessRevision = 0;
	private lastValues = new Map<string, number>();

	private constructor(private readonly key: HwsmGadgetKey) {}

	/**
	 * Opens the backend, verifying the key exists AND currently has entries.
	 * A present-but-empty key throws "gadget-empty" — the user has Gadget
	 * reporting set up and needs to tick sensors, which (only) outranks a
	 * generic "not-running" from shared memory in the poller's auto mode.
	 */
	static open(): GadgetRegistryProvider {
		if (process.platform !== "win32") {
			throw new HwinfoError("unsupported-platform", "The HWiNFO Gadget registry only exists on Windows.");
		}
		const bridge = getHwsm();
		let key: HwsmGadgetKey;
		try {
			key = bridge.openGadgetKey(VSB_SUBKEY);
		} catch (err) {
			throw toHwinfoError(err);
		}
		const provider = new GadgetRegistryProvider(key);
		let snapshot: SensorSnapshot | null;
		try {
			snapshot = provider.read();
		} catch (err) {
			provider.close();
			throw err;
		}
		if (snapshot === null) {
			provider.close();
			throw new HwinfoError("busy", "Gadget readings changed during the scan. Retrying automatically.");
		}
		if (snapshot.readings.length === 0 && !snapshot.blockedReadingCount) {
			provider.close();
			// The key existing but holding no readings means HWiNFO IS (or was)
			// running with Gadget support — "start HWiNFO" would mislead here.
			throw new HwinfoError("gadget-empty", `HKCU\\${VSB_SUBKEY} exists but holds no readings: in HWiNFO's sensor window open Configure Sensors, HWiNFO Gadget tab, and tick "Report value in Gadget" for the sensors you need.`);
		}
		return provider;
	}

	read(): SensorSnapshot | null {
		try {
			return this.readEntries();
		} catch (err) {
			throw toHwinfoError(err);
		}
	}

	private readEntries(): SensorSnapshot | null {
		const sensors: SensorSource[] = [];
		const sensorIndexByName = new Map<string, number>();
		const readings: Reading[] = [];
		const byKey = new Map<string, Reading>();
		const digestParts: string[] = [];
		const values = new Map<string, number>();

		// The indexes are SPARSE. HWiNFO reserves a VSB index the moment a
		// reading is ticked "Report value in Gadget" and keeps that
		// reservation while the reading is disabled in the sensor window,
		// writing nothing into the slot: a permanent hole. So a missing
		// Sensor<i> is an unused slot, never an end-of-list marker, and the
		// scan runs the whole bounded range. queryString returns null for
		// exactly one condition, ERROR_FILE_NOT_FOUND; every other registry
		// failure throws, so skipping a null cannot swallow a real fault.
		for (let i = 0; i < MAX_ENTRIES; i++) {
			const sensorName = this.key.queryString(`Sensor${i}`);
			if (sensorName === null) {
				continue;
			}
			const labelField = this.key.queryString(`Label${i}`);
			const formattedField = this.key.queryString(`Value${i}`);
			const rawField = this.key.queryString(`ValueRaw${i}`);
			// Gadget has no atomic row or producer sequence. One bounded
			// validation pass catches observable field interleavings and
			// withholds the entire scan before any evidence/history commits.
			// A writer paused in an intermediate state can still look stable;
			// agreement here is not an atomicity or producer-liveness claim.
			const verifiedSensor = this.key.queryString(`Sensor${i}`);
			const verifiedLabel = this.key.queryString(`Label${i}`);
			const verifiedFormatted = this.key.queryString(`Value${i}`);
			const verifiedRaw = this.key.queryString(`ValueRaw${i}`);
			if (sensorName !== verifiedSensor || labelField !== verifiedLabel || formattedField !== verifiedFormatted || rawField !== verifiedRaw) return null;
			const label = labelField ?? `Reading ${i}`;
			const formatted = formattedField ?? "";
			const raw = rawField ?? "";

			let sensorIndex = sensorIndexByName.get(sensorName);
			if (sensorIndex === undefined) {
				sensorIndex = sensors.length;
				sensorIndexByName.set(sensorName, sensorIndex);
				sensors.push({ index: sensorIndex, id: 0, instance: sensorIndex, name: sensorName });
			}

			const unit = unitOf(formatted);
			// HWiNFO writes ValueRaw with the system locale's decimal separator.
			const value = Number.parseFloat(raw.replace(",", "."));

			const key = gadgetReadingKey(sensorName, label);
			const reading: Reading = {
				key,
				type: inferType(unit),
				sensorIndex,
				id: i,
				label,
				unit,
				// The gadget interface exposes only the current value.
				value,
				statistics: "unavailable",
				valueMin: Number.NaN,
				valueMax: Number.NaN,
				valueAvg: Number.NaN
			};
			readings.push(reading);
			byKey.set(key, reading);
			digestParts.push(JSON.stringify([i, key, unit, raw]));
			// Compare only the same named reading in the same unit. A new
			// slot or rename is topology, not evidence of a new measurement.
			const evidenceKey = JSON.stringify([key, unit]);
			values.set(evidenceKey, value);
		}

		const digest = digestParts.join("|");
		if (digest !== this.lastDigest) {
			this.lastDigest = digest;
			this.valueRevision++;
		}
		const blocked = this.identity.blocked(readings.map((reading) => reading.key));
		const safeReadings = readings.filter((reading) => !blocked.has(reading.key));
		let valueChanged = false;
		const safeValues = new Map<string, number>();
		for (const reading of safeReadings) {
			const evidenceKey = JSON.stringify([reading.key, reading.unit]);
			const value = values.get(evidenceKey) as number;
			const previous = this.lastValues.get(evidenceKey);
			if (previous !== undefined && Number.isFinite(previous) && Number.isFinite(value) && previous !== value) valueChanged = true;
			safeValues.set(evidenceKey, value);
		}
		this.lastValues = safeValues;
		if (valueChanged) {
			this.lastChangeSec = Math.floor(Date.now() / 1000);
			this.freshnessRevision++;
		}

		for (const key of blocked) byKey.delete(key);
		return { pollTime: this.lastChangeSec, valueRevision: this.valueRevision, freshnessRevision: this.freshnessRevision, version: 0, revision: 0, sensors, readings: safeReadings, byKey, blockedReadingCount: readings.length - safeReadings.length };
	}

	close(): void {
		this.key.close(); // idempotent on the native side
	}

	/**
	 * Carries the staleness baseline across a poller reopen probe — a fresh
	 * provider would otherwise treat a frozen registry as newly changed and
	 * flap the status back to "ok" for another stale window.
	 */
	adoptFreshness(from: GadgetRegistryProvider): void {
		this.lastDigest = from.lastDigest;
		this.lastChangeSec = from.lastChangeSec;
		this.valueRevision = from.valueRevision;
		this.freshnessRevision = from.freshnessRevision;
		this.lastValues = from.lastValues;
	}
}
