/**
 * The Sensor Dial's side of the alert store's tick contract: which readings
 * a dial references, and one generation of steps over them.
 *
 * A dial references its selection, its rotation set, every member of its
 * rotation groups, and its step list (with no set, every reading of the
 * selected reading's sensor): the readings the face can draw and the ones
 * the auto cycle's critical jump hunts over. Every one is stepped each
 * generation, a reading with no rule included, so a rule that is cleared or
 * moves to another key ends its track at the prune. A dial that sets no
 * limit and holds no alert state skips the step: it would change nothing,
 * and every reading shows normal. Readings the snapshot does not publish
 * take a gap: nothing shows for them, and their latched level and any
 * snooze wait for valid data.
 *
 * Without current data (stale or unavailable) the whole dial takes a gap:
 * no new alarm is raised from data that is not current, and a snooze never
 * expires on it.
 *
 * Each step carries how its rule compares the reading (alertComparisonKey),
 * so ticking "Separate limits for" (an entry seeded from Warn at and
 * Critical at) or clearing it again keeps the reading's wait, recovery and
 * snooze when the comparison is the same; the store starts a track fresh
 * only when the comparison changes.
 */
import type { Reading, SensorSnapshot } from "../hwinfo/types";
import type { PollerStatus } from "../poller";
import { rotationGroupsOf } from "../rotation";
import { rotationKeysOf, stepListOf } from "../ui/dial-overview";
import { alertObservation, hasAnyLimit, parseAlertConfig, ruleFor, ruleUnitFor, type AlertSettings, type ResolvedRule } from "./rules";
import { alertIdentityOf, type AlertStore } from "./store";
import type { ShownAlert } from "./types";

/** The dial settings the referenced set is read from. */
export type DialAlertSettings = AlertSettings & Parameters<typeof stepListOf>[0] & { readingKey?: unknown; rotationGroups?: unknown; fahrenheit?: unknown };

/** The shown alert of every referenced reading, by the key the dial uses
 * for it (the spelling the face, the rows and the critical hunt look up). */
export type DialAlertView = ReadonlyMap<string, ShownAlert>;

export const NO_DIAL_ALERTS: DialAlertView = new Map();

/** The shortest step gap that counts as time with nothing observed. */
const MIN_STEP_GAP_MS = 5_000;

/**
 * How long a dial can go between alert steps before the time in between
 * counts as nothing observed (the poller idled with nothing on screen, or
 * the system slept): the history store's tick-gap rule, the larger of
 * three poll intervals and 5 s. Past it, a level still waiting for its
 * Alert after starts the wait again; a latched level and a snooze carry on.
 */
export function alertStepGapMs(intervalMs: number): number {
	return Math.max(3 * (Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 1000), MIN_STEP_GAP_MS);
}

/** How a rule compares one reading: its limits, direction and recovery band
 * and the unit it compares in, whoever's limits they are (the dial's own or
 * the reading's). Undefined while the rule stands down. */
export function alertComparisonKey(rule: ResolvedRule, reading: Pick<Reading, "unit" | "value">, fahrenheit: boolean): string | undefined {
	const unit = ruleUnitFor(rule, reading, fahrenheit);
	return unit === undefined ? undefined : JSON.stringify([rule.warn ?? null, rule.crit ?? null, rule.below, rule.hyst, unit]);
}

/** Every reading the dial references that the snapshot publishes (one entry
 * per spelling), and the referenced keys it does not publish. */
export function dialAlertReadings(settings: DialAlertSettings, snapshot: SensorSnapshot): { found: readonly Reading[]; missing: readonly string[] } {
	const selection = typeof settings.readingKey === "string" && settings.readingKey !== "" ? settings.readingKey : undefined;
	const groups = rotationGroupsOf(settings.rotationGroups);
	const keys: string[] = [];
	if (selection !== undefined) keys.push(selection);
	keys.push(...(rotationKeysOf(settings) ?? []));
	for (const group of groups ?? []) keys.push(...group.keys);
	const found = new Map<string, Reading>();
	const missing = new Set<string>();
	for (const key of keys) {
		const reading = snapshot.byKey.get(key);
		if (reading === undefined) missing.add(key);
		else if (!found.has(reading.key)) found.set(reading.key, reading);
	}
	for (const member of stepListOf(settings, selection, groups, snapshot)) {
		if (!found.has(member.key)) found.set(member.key, member);
	}
	return { found: [...found.values()], missing: [...missing] };
}

/**
 * One generation for one dial: steps every referenced reading under the
 * rule that applies to it (the dial has no slots, so slot 0), gaps the
 * readings it no longer finds, then prunes. Returns what each referenced
 * reading shows now. Without current data every track of the dial takes a
 * gap and nothing shows.
 */
export function stepDialAlerts(store: AlertStore, context: string, settings: DialAlertSettings, status: PollerStatus, now: number): DialAlertView {
	if (status.state !== "ok") {
		store.gap(context);
		return NO_DIAL_ALERTS;
	}
	const config = parseAlertConfig(settings);
	if (!hasAnyLimit(config) && !store.holds(context)) return NO_DIAL_ALERTS;
	const fahrenheit = settings.fahrenheit === true;
	const { found, missing } = dialAlertReadings(settings, status.snapshot);
	const view = new Map<string, ShownAlert>();
	const stepped = new Set<string>();
	for (const reading of found) {
		const rule = ruleFor(config, "dial", reading, 0);
		const identity = alertIdentityOf(reading);
		stepped.add(identity);
		const alike = rule === null ? undefined : alertComparisonKey(rule, reading, fahrenheit);
		view.set(reading.key, store.step(context, identity, rule, alertObservation(rule, reading, fahrenheit, true), now, config.dwellMs, alike));
	}
	store.gap(context, stepped);
	// A missing key's identity is unknown (its alias link needs the live
	// row), so the saved key stands in for it: its track, if it has one,
	// stays referenced and waits in its gap.
	store.prune(context, new Set([...stepped, ...missing]));
	return view;
}

/** Readings the view holds as critical (shown crit: not snoozed, not in a
 * gap), among `list`: what holds and pulls the auto cycle. */
export function criticalKeysOf(view: DialAlertView, list: readonly Pick<Reading, "key">[]): ReadonlySet<string> {
	const critical = new Set<string>();
	for (const member of list) {
		if (view.get(member.key)?.level === "crit") critical.add(member.key);
	}
	return critical;
}
