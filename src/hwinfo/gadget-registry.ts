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
import { gadgetReadingKey, legacyGadgetKey } from "./gadget-identity";
import { gadgetDisplayIsNumeric, gadgetRawValue, gadgetUnitOf, gadgetValueAgrees } from "./gadget-value";
import { getHwsm, hwsmCode, hwsmWin32, type HwsmGadgetKey } from "./hwsm-loader";
import { HwinfoError, SensorType, type Reading, type SensorSnapshot, type SensorSource } from "./types";

/** Where a name seen on more than one row stands. "suspect": one sighting,
 * and that scan was skipped as a possibly torn read. "held": on more than
 * one row on consecutive complete scans, so its rows are withheld.
 * "releasing": held, and the last complete scan no longer showed it on more
 * than one row; still withheld, forgotten when the next scan agrees. */
type NameState = "suspect" | "held" | "releasing";

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

	private lastDigest = "";
	/** Counts digest changes: the same fact valueRevision carries for shared
	 * memory, so two registry rewrites within one second stay distinguishable
	 * even though the synthesized pollTime cannot move twice in it. */
	private valueRevision = 0;
	private lastChangeSec = 0;
	private freshnessRevision = 0;
	private lastValues = new Map<string, number>();
	/** The reading each slot's formatted/raw disagreement was reported for.
	 * Slot numbers are reused: another reading contradicting in a reported
	 * slot is news, the same one on a later scan or session is not. */
	private readonly reportedSlots = new Map<number, string>();
	/** Unlogged notices, by slot for a contradiction and by reading key for
	 * a shared name, so a reopen that adopts the previous provider's report
	 * lists can take back what it re-raised. */
	private readonly pendingNotices = new Map<number | string, string>();
	/** Consecutive scans each slot has contradicted itself. One sighting is
	 * indistinguishable from reading between HWiNFO's two stores for a row,
	 * so it skips the scan like any interleave; the second withholds the row. */
	private contradictionStreak = new Map<number, number>();
	/** Names seen on more than one row, by reading key (see readEntries).
	 * Rebuilt by every complete scan, so an entry lives while its name is
	 * shared plus one scan. In memory only: nothing here reaches the disk or
	 * outlives the process. */
	private nameStates = new Map<string, NameState>();
	/** Shared names the log already carries, so a standing pair is one line.
	 * An entry goes when its name is forgotten: sharing it again is news. */
	private readonly reportedNames = new Set<string>();

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
			// One immediate retry: a scan skipped for a momentary interleave
			// is usually whole on the next read, and a row that contradicts
			// itself, or a name that sits on two rows, twice running is
			// withheld on its own instead of keeping the whole source at
			// "busy" forever.
			snapshot = provider.read() ?? provider.read();
		} catch (err) {
			provider.close();
			throw err;
		}
		if (snapshot === null) {
			provider.close();
			throw new HwinfoError("busy", "Gadget readings changed during the scan. Retrying automatically.");
		}
		// Withheld rows are rows: a key whose only readings are withheld is
		// not empty, and staying open lets the log and the panel say why.
		if (snapshot.readings.length === 0 && !snapshot.blockedReadingCount && !snapshot.contradictoryReadingCount) {
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

	/** One warning per offending slot or shared name, drained by the poller's
	 * logger. The strings are what HWiNFO's own Gadget tab shows; no other
	 * value leaks. */
	notices(): string[] {
		const lines = [...this.pendingNotices.values()];
		this.pendingNotices.clear();
		return lines;
	}

	private readEntries(): SensorSnapshot | null {
		const sensors: SensorSource[] = [];
		const sensorIndexByName = new Map<string, number>();
		const readings: Reading[] = [];
		let incompleteIdentityCount = 0;
		const byKey = new Map<string, Reading>();
		const digestParts: string[] = [];
		const values = new Map<string, number>();
		/** Reading key -> evidence key (name and, for numeric displays, unit). */
		const evidenceKeys = new Map<string, string>();
		/** Every keyed row's names, withheld ones included: a row that is
		 * withheld this scan still owns its 1.6 spelling, and still counts
		 * toward its own name. */
		const namedRows: { slot: number; key: string; sensor: string; label: string }[] = [];
		const contradictions: { slot: number; identity: string; notice: string }[] = [];

		// The indexes are SPARSE. HWiNFO reserves a VSB index the moment a
		// reading is ticked "Report value in Gadget" and keeps that
		// reservation while the reading is disabled in the sensor window,
		// writing nothing into the slot: a permanent hole. So a missing
		// Sensor<i> is an unused slot, never an end-of-list marker, and the
		// scan runs the whole bounded range. queryString returns null for
		// exactly one condition, ERROR_FILE_NOT_FOUND; every other registry
		// failure throws, so skipping a null cannot swallow a real fault.
		// A scan that returns or throws from inside this loop saw only a
		// prefix of the rows: it commits nothing, names included.
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
			// withholds the entire scan before measurement evidence commits.
			// A writer paused in an intermediate state can still look stable;
			// agreement here is not an atomicity or producer-liveness claim.
			const verifiedSensor = this.key.queryString(`Sensor${i}`);
			const verifiedLabel = this.key.queryString(`Label${i}`);
			if (sensorName !== verifiedSensor || labelField !== verifiedLabel) return null;
			// Registry positions identify scan locations, never readings.
			// Preserve meaningful producer names exactly, but withhold an
			// incomplete row instead of inventing a persistent slot label.
			if (!sensorName.trim() || !labelField?.trim()) {
				incompleteIdentityCount++;
				continue;
			}
			const label = labelField;
			const key = gadgetReadingKey(sensorName, label);
			// A row counts toward its name whatever becomes of its number:
			// a twin that is withheld as contradictory below, or carries no
			// usable value, still makes the name ambiguous. Keep the original
			// bounded query order so the repeated identity check still spans
			// the first value reads.
			namedRows.push({ slot: i, key, sensor: sensorName, label });
			const verifiedFormatted = this.key.queryString(`Value${i}`);
			const verifiedRaw = this.key.queryString(`ValueRaw${i}`);
			if (formattedField !== verifiedFormatted || rawField !== verifiedRaw) return null;
			const formatted = formattedField ?? "";
			const raw = rawField ?? "";

			let sensorIndex = sensorIndexByName.get(sensorName);
			if (sensorIndex === undefined) {
				sensorIndex = sensors.length;
				sensorIndexByName.set(sensorName, sensorIndex);
				sensors.push({ index: sensorIndex, id: 0, instance: sensorIndex, name: sensorName });
			}

			const unit = gadgetUnitOf(formatted);
			const value = gadgetRawValue(raw);
			// A formatted number that cannot describe the raw one is a
			// contradiction in THIS row. What happens to it is decided
			// after the scan (see below): never publish the row.
			if (!gadgetValueAgrees(formatted, value)) {
				contradictions.push({ slot: i, identity: `${sensorName}\u0000${label}`, notice: `Gadget slot ${i} withheld: formatted value "${formatted}" does not agree with raw value "${raw}" (${sensorName} / ${label}).` });
				continue;
			}

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
			// A word display (Yes/No) has no unit: its raw flip is the
			// evidence, so the word must not partition it.
			const evidenceKey = JSON.stringify([key, gadgetDisplayIsNumeric(formatted) ? unit : ""]);
			evidenceKeys.set(key, evidenceKey);
			values.set(evidenceKey, value);
		}

		// A name on more than one row. HWiNFO renumbers the rows densely and
		// not atomically: after any tick or untick it rewrites them one slot
		// at a time, and the reading the rewrite is passing sits in two
		// adjacent slots for that moment. So a first sighting skips the scan
		// like any interleave. The rewrite leaves a row in under a
		// millisecond and two scans are never closer than one scan takes, so
		// a name shared on consecutive complete scans is a standing pair
		// (HWiNFO reports some readings twice under one name, a fan in RPM
		// and in percent; a block it left behind can repeat a live row): its
		// rows are withheld, and only they. Leaving takes two clean scans as
		// well: a tick makes a reading ABSENT for that same moment, and a
		// twin hidden that way must not hand the shared name to the other
		// one for a tick.
		const rowsByName = new Map<string, typeof namedRows>();
		for (const row of namedRows) {
			const rows = rowsByName.get(row.key);
			if (rows === undefined) rowsByName.set(row.key, [row]);
			else rows.push(row);
		}
		const nameStates = new Map<string, NameState>();
		let firstSighting = false;
		for (const [key, rows] of rowsByName) {
			if (rows.length < 2) continue;
			const known = this.nameStates.has(key);
			nameStates.set(key, known ? "held" : "suspect");
			if (!known) firstSighting = true;
		}
		for (const [key, state] of this.nameStates) {
			if (state === "held" && !nameStates.has(key)) nameStates.set(key, "releasing");
		}
		this.nameStates = nameStates;
		for (const key of this.reportedNames) {
			if (!nameStates.has(key)) this.reportedNames.delete(key);
		}

		// A first contradictory sighting cannot be told from a read that
		// landed between HWiNFO's two stores for that row, so it skips the
		// whole scan exactly like a detected interleave: the keys hold their
		// values for a tick instead of flashing "Sensor missing". A slot that
		// contradicts itself on consecutive scans is a persistent condition:
		// it is withheld on its own, counted and logged once, and every
		// healthy row keeps serving. A whole-scan refusal there would take
		// the source down forever under a "retrying" screen.
		const streak = new Map<number, number>();
		for (const { slot } of contradictions) streak.set(slot, (this.contradictionStreak.get(slot) ?? 0) + 1);
		this.contradictionStreak = streak;
		// Both records advance on every complete scan before either may skip
		// it. Skipping for one before the other advanced would take a key
		// holding a standing pair AND a standing contradiction two skips to
		// confirm, and open() reads only twice.
		if (firstSighting || [...streak.values()].some((count) => count < 2)) return null;
		for (const { slot, identity, notice } of contradictions) {
			if (this.reportedSlots.get(slot) !== identity) {
				this.reportedSlots.set(slot, identity);
				this.pendingNotices.set(slot, notice);
			}
		}
		const contradictoryCount = contradictions.length;
		// Past the skip every recorded name is "held" or "releasing", and a
		// row carrying one is withheld. The log says so once, on the scan the
		// name is first held.
		const blocked: ReadonlySet<string> = new Set(nameStates.keys());
		for (const [key, state] of nameStates) {
			const rows = rowsByName.get(key) ?? [];
			const [named] = rows;
			if (state !== "held" || named === undefined || this.reportedNames.has(key)) continue;
			this.reportedNames.add(key);
			const slots = rows.map((row) => row.slot);
			const remedy = slots.length === 2 ? "Untick or relabel one of them in HWiNFO and the other comes back on its own." : "Untick or relabel them in HWiNFO until one is left, and it comes back on its own.";
			this.pendingNotices.set(key, `Gadget slots ${slots.slice(0, -1).join(", ")} and ${slots.at(-1)} withheld while they report one name (${named.sensor} / ${named.label}). ${remedy}`);
		}

		const digest = digestParts.join("|");
		if (digest !== this.lastDigest) {
			this.lastDigest = digest;
			this.valueRevision++;
		}
		const safeReadings = readings.filter((reading) => !blocked.has(reading.key));
		let valueChanged = false;
		const safeValues = new Map<string, number>();
		for (const reading of safeReadings) {
			const evidenceKey = evidenceKeys.get(reading.key) as string;
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
		// Selections saved by 1.6 and earlier used "g:<source>:<label>" for
		// every row, and HWiNFO's standard source names carry a colon, so
		// nearly every old Gadget selection spells a key this build no
		// longer mints. Republish that spelling as a checked alias of the
		// row it names, but only when exactly one current row (withheld ones
		// included) renders to it and no live row owns it outright: an
		// ambiguous spelling resolves to nothing, never to a guess. The
		// ambiguity is judged per scan: once a colliding row is unticked,
		// the remaining row answers to the shared spelling.
		const legacyOwners = new Map<string, number>();
		for (const row of namedRows) {
			const legacy = legacyGadgetKey(row.sensor, row.label);
			if (legacy !== null) legacyOwners.set(legacy, (legacyOwners.get(legacy) ?? 0) + 1);
		}
		const published = safeReadings.map((reading) => {
			const legacy = legacyGadgetKey(sensors[reading.sensorIndex]?.name ?? "", reading.label);
			if (legacy === null || legacyOwners.get(legacy) !== 1 || byKey.has(legacy)) return reading;
			const linkedKeys = [reading.key, legacy];
			const live: Reading = { ...reading, linkedKeys };
			byKey.set(reading.key, live);
			byKey.set(legacy, { ...reading, key: legacy, linkedKeys, aliasOf: reading.key });
			return live;
		});
		return { pollTime: this.lastChangeSec, valueRevision: this.valueRevision, freshnessRevision: this.freshnessRevision, version: 0, revision: 0, sensors, readings: published, byKey, blockedReadingCount: incompleteIdentityCount + readings.length - safeReadings.length, ...(contradictoryCount > 0 ? { contradictoryReadingCount: contradictoryCount } : {}) };
	}

	close(): void {
		this.key.close(); // idempotent on the native side
	}

	/**
	 * Carries the staleness baseline across a poller reopen probe — a fresh
	 * provider would otherwise treat a frozen registry as newly changed and
	 * flap the status back to "ok" for another stale window.
	 */
	adoptFreshness(from: GadgetRegistryProvider, baseline = true): void {
		// What was already reported stays reported however long ago it was.
		// The value baseline is the caller's call: it is comparable only
		// while it is recent.
		if (baseline) {
			this.lastDigest = from.lastDigest;
			this.lastChangeSec = from.lastChangeSec;
			this.valueRevision = from.valueRevision;
			this.freshnessRevision = from.freshnessRevision;
			this.lastValues = from.lastValues;
		}
		// The verification read inside open() ran before this adoption; a
		// slot the previous provider already reported is not news.
		for (const [slot, identity] of from.reportedSlots) {
			if (this.reportedSlots.get(slot) === identity) this.pendingNotices.delete(slot);
			else if (!this.reportedSlots.has(slot)) this.reportedSlots.set(slot, identity);
		}
		for (const [slot, count] of from.contradictionStreak) {
			this.contradictionStreak.set(slot, Math.max(count, this.contradictionStreak.get(slot) ?? 0));
		}
		// A name the previous provider held stays held. A key HWiNFO is still
		// refilling after a restart can show one twin alone, and this
		// provider must not publish it on the strength of that one scan.
		// What its own verification read recorded stands.
		for (const [key, state] of from.nameStates) {
			if (!this.nameStates.has(key)) this.nameStates.set(key, state);
		}
		for (const key of from.reportedNames) {
			if (this.reportedNames.has(key)) this.pendingNotices.delete(key);
			else this.reportedNames.add(key);
		}
	}
}
