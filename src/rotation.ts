/**
 * Which readings a dial rotation (or autocycle) steps through, and where a
 * step lands. Pure and tiny (like the series ring) so the wrap and fallback
 * behavior is unit-testable without the Stream Deck runtime.
 */
import type { Reading, SensorSnapshot } from "./hwinfo/types";
import { liveKeyOf, readingMatchesKey } from "./hwinfo/reading-links";

/**
 * Resolves picked keys to readings in picked order, skipping keys the
 * snapshot does not publish. Two keys that resolve to one measurement (a
 * confirmed link's two endpoints both ticked) yield one entry, the first
 * picked, so a set can never list the same reading twice or strand a step
 * on the duplicate. The saved keys themselves are never rewritten.
 */
function pickedReadings(keys: readonly string[], snapshot: SensorSnapshot): readonly Reading[] {
	const seen = new Set<string>();
	const list: Reading[] = [];
	for (const key of keys) {
		const reading = snapshot.byKey.get(key);
		if (reading === undefined || seen.has(liveKeyOf(reading))) continue;
		seen.add(liveKeyOf(reading));
		list.push(reading);
	}
	return list;
}

/** The list position of the current selection: the entry saved under that
 * exact key first, else the entry a confirmed link resolves it to. */
function indexOfKey(list: readonly Reading[], currentKey: string | undefined): number {
	if (currentKey === undefined) return -1;
	const exact = list.findIndex((r) => r.key === currentKey);
	return exact !== -1 ? exact : list.findIndex((r) => readingMatchesKey(r, currentKey));
}

/**
 * The list a dial moves through. A rotation set (readings ticked in the
 * settings panel) wins, in picked order, skipping entries the snapshot does
 * not currently publish. Without a set: every reading of the sensor that owns
 * the current pick, or the whole snapshot when nothing is picked yet (so the
 * first turn adopts a reading).
 */
export function rotationReadings(setKeys: readonly string[] | undefined, currentKey: string | undefined, snapshot: SensorSnapshot): readonly Reading[] {
	// Settings arrive as untyped JSON: a malformed rotationKeys (a string has
	// a truthy .length too) must degrade to "no set", never throw mid-tick.
	if (Array.isArray(setKeys) && setKeys.length > 0) {
		return pickedReadings(setKeys, snapshot);
	}
	const current = currentKey !== undefined && currentKey !== "" ? snapshot.byKey.get(currentKey) : undefined;
	if (current !== undefined) {
		// The provider's own entries, whichever spelling the selection is
		// saved under: the selection resolves through indexOfKey, and a
		// row's name, color and session never depend on what is selected.
		return snapshot.readings.filter((r) => r.sensorIndex === current.sensorIndex);
	}
	return snapshot.readings;
}

/**
 * Steps `ticks` from the current reading, wrapping at both ends; enters at the
 * first entry when the current reading is not in the list.
 */
export function stepReading(list: readonly Reading[], currentKey: string | undefined, ticks: number): Reading | undefined {
	if (list.length === 0) {
		return undefined;
	}
	const index = indexOfKey(list, currentKey);
	if (index === -1) {
		return list[0];
	}
	return list[(((index + ticks) % list.length) + list.length) % list.length];
}

/** One parsed rotation group: a display name ("" renders as "group N"), its
 *  reading keys in picked order, and the 1-based position among the raw
 *  object entries, so the numbered fallback matches the PI's row numbering
 *  even when the projection skips draft rows (empty or fully duplicated). */
export type RotationGroup = {
	readonly name: string;
	readonly keys: readonly string[];
	readonly ordinal: number;
};

/**
 * Salvage-parses the rotationGroups setting into the runtime projection.
 * Settings are untyped JSON: keep object entries whose keys salvage to at
 * least one usable string, trim names, and require two or more surviving
 * groups; anything less returns undefined and the flat set keeps driving.
 * Membership is deduplicated across the WHOLE projection, not just within
 * a group: the first group containing a key owns it and later occurrences
 * are dropped. The active group is derived from the current reading, so an
 * overlapping key would otherwise re-resolve its earlier group right after
 * a jump landed on it, making the target group impossible to stay in. The
 * raw setting is never mutated or written back; only explicit PI edits
 * normalize what the user sees.
 */
export function rotationGroupsOf(raw: unknown): readonly RotationGroup[] | undefined {
	if (!Array.isArray(raw)) {
		return undefined;
	}
	const groups: RotationGroup[] = [];
	const claimed = new Set<string>();
	let ordinal = 0;
	for (const entry of raw) {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
			continue;
		}
		ordinal++;
		const { name, keys } = entry as { name?: unknown; keys?: unknown };
		if (!Array.isArray(keys)) {
			continue;
		}
		const salvaged: string[] = [];
		for (const key of keys) {
			if (typeof key === "string" && key.trim() !== "" && !claimed.has(key)) {
				claimed.add(key);
				salvaged.push(key);
			}
		}
		if (salvaged.length === 0) {
			continue;
		}
		groups.push({ name: typeof name === "string" ? name.trim() : "", keys: salvaged, ordinal });
	}
	return groups.length >= 2 ? groups : undefined;
}

/** Lowest-index group containing the key; -1 with no owner (or no key).
 *  With a snapshot, a group that holds another confirmed spelling of the
 *  same measurement owns it too (the exact spelling wins when both exist),
 *  so a selection picked under the live provider's key stays inside the
 *  group its saved spelling was ticked into. */
export function activeGroupIndex(groups: readonly RotationGroup[], currentKey: string | undefined, snapshot?: SensorSnapshot): number {
	if (currentKey === undefined || currentKey === "") {
		return -1;
	}
	const exact = groups.findIndex((g) => g.keys.includes(currentKey));
	if (exact !== -1 || snapshot === undefined) {
		return exact;
	}
	const aliases = snapshot.byKey.get(currentKey)?.linkedKeys;
	return aliases === undefined ? -1 : groups.findIndex((g) => g.keys.some((key) => aliases.includes(key)));
}

/** The group's display name for overlays and hints: as typed, or "group N".
 *  N is the group's ordinal among the raw rows, not its projection index,
 *  so the fallback matches the PI's "Group N" placeholders. */
export function groupDisplayName(groups: readonly RotationGroup[], index: number): string {
	const group = groups[index];
	if (group === undefined) {
		return `group ${index + 1}`;
	}
	return group.name !== "" ? group.name : `group ${group.ordinal}`;
}

/**
 * The list plain stepping moves through when groups apply: the active
 * group's members the snapshot publishes, in picked order. A current reading
 * outside every group enters at group 0, so rotation pulls a stray selection
 * into the groups instead of stranding it.
 */
export function groupReadings(groups: readonly RotationGroup[], currentKey: string | undefined, snapshot: SensorSnapshot): readonly Reading[] {
	const index = activeGroupIndex(groups, currentKey, snapshot);
	const group = groups[index === -1 ? 0 : index];
	return group === undefined ? [] : pickedReadings(group.keys, snapshot);
}

/**
 * Steps `ticks` whole groups: lands on the first snapshot-present member of
 * the target group, wrapping at both ends. The user-defined analog of
 * stepSensorSource, behind pressed rotation once groups exist. Groups whose
 * members the snapshot does not publish (sensor asleep, dropout), or which
 * only repeat the current measurement under a confirmed alias, cannot be
 * landed in and are skipped; with fewer than two groups present there is
 * nowhere to jump and it returns undefined. A current reading outside every
 * present group enters at the first one.
 */
export function stepGroup(groups: readonly RotationGroup[], currentKey: string | undefined, ticks: number, snapshot: SensorSnapshot): Reading | undefined {
	const currentGroup = activeGroupIndex(groups, currentKey, snapshot);
	const present: { index: number; first: Reading }[] = [];
	for (const [index, group] of groups.entries()) {
		// The two saved spellings may belong to different groups. A target
		// must offer a different measurement or advance() would reject the
		// alias as a no-op and strand all later members of that group.
		const first = group.keys.map((key) => snapshot.byKey.get(key)).find((r): r is Reading => r !== undefined && (index === currentGroup || !readingMatchesKey(r, currentKey)));
		if (first !== undefined) {
			present.push({ index, first });
		}
	}
	if (present.length === 0) {
		return undefined;
	}
	const position = present.findIndex((p) => p.index === currentGroup);
	if (position === -1) {
		return present[0]?.first;
	}
	if (present.length < 2) {
		return undefined;
	}
	return present[(((position + ticks) % present.length) + present.length) % present.length]?.first;
}

/**
 * Steps `ticks` whole sensor sources instead of readings: lands on the first
 * list entry of the previous/next sensor represented in the list, wrapping.
 * This is the coarse jump behind the elite preset's pressed rotation while
 * no rotation groups are defined (stepGroup takes over once they are). With
 * one sensor in the list there is nowhere to jump and it returns undefined.
 */
export function stepSensorSource(list: readonly Reading[], currentKey: string | undefined, ticks: number): Reading | undefined {
	if (list.length === 0) {
		return undefined;
	}
	const sources: number[] = [];
	for (const reading of list) {
		if (!sources.includes(reading.sensorIndex)) {
			sources.push(reading.sensorIndex);
		}
	}
	const position = indexOfKey(list, currentKey);
	const current = position === -1 ? undefined : list[position];
	if (current === undefined) {
		return list[0];
	}
	if (sources.length < 2) {
		return undefined;
	}
	const index = sources.indexOf(current.sensorIndex);
	const target = sources[(((index + ticks) % sources.length) + sources.length) % sources.length];
	return list.find((r) => r.sensorIndex === target);
}

/**
 * The overview viewport: which slice of the rotation list the three-row
 * touchscreen face shows, and where the selection sits inside it. Stateless
 * by design (centered selection, clamped at both ends), so the window is a
 * pure function of (list, selection) and survives page navigation, hidden
 * state restoration and reconnects with no bookkeeping. A selection outside
 * the list (stray pick, set edited underneath) anchors the window at the
 * top with no highlighted row, which is also the honest render.
 */
export function overviewWindow(list: readonly Reading[], currentKey: string | undefined, size: number): { rows: readonly Reading[]; selectedIndex: number } {
	if (list.length === 0 || size <= 0) {
		return { rows: [], selectedIndex: -1 };
	}
	const index = indexOfKey(list, currentKey);
	const start = index === -1 ? 0 : Math.max(0, Math.min(index - Math.floor((size - 1) / 2), list.length - size));
	const rows = list.slice(start, start + size);
	return { rows, selectedIndex: index === -1 ? -1 : index - start };
}

/**
 * Where an auto-cycle step should land, or undefined to hold this tick.
 *
 * Plain cycling ignores alerts entirely. With `alertAware` (the "On alert"
 * setting), the cycle never rotates away from a member that is currently
 * critical (a manual turn is the acknowledgement that releases it), and a
 * due step goes to an alerting member instead of the next one in order;
 * criticals are evaluated for every listed member, visible or not, each
 * time a step is due. The alert hunt runs over `alertList`, a superset of
 * `list`: with rotation groups the cycle steps inside the active group but
 * an alert anywhere in the set still interrupts, and landing on it makes
 * its group the active one. Ungrouped callers pass the same list twice.
 */
export function autoCycleTarget(list: readonly Reading[], alertList: readonly Reading[], currentKey: string | undefined, criticalKeys: ReadonlySet<string>, alertAware: boolean): Reading | undefined {
	if (alertAware) {
		// The selection is the entry it resolves to, whichever spelling it
		// is saved under: a critical reading holds the cycle, and the hunt
		// never "moves" onto the measurement already on the dial.
		const current = alertList[indexOfKey(alertList, currentKey)];
		if ((current !== undefined && criticalKeys.has(current.key)) || (currentKey !== undefined && criticalKeys.has(currentKey))) {
			return undefined;
		}
		const alerting = alertList.find((r) => r !== current && r.key !== currentKey && criticalKeys.has(r.key));
		if (alerting !== undefined) {
			return alerting;
		}
	}
	return stepReading(list, currentKey, 1);
}
