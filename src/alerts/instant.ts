/**
 * What a reading's alert shows from its value alone, with no history: the
 * level a fresh track reaches on this one observation with no dwell. Used
 * where nothing steps the alert store (sample galleries, renderer tests, the
 * panel simulator) and as the face's limits for a per-reading rule. With the
 * legacy pair it equals alertLevel exactly (the engine's parity property).
 * Pure; nothing here writes settings or touches the store.
 */
import type { Reading } from "../hwinfo/types";
import { convertUnit } from "../ui/format";
import { FRESH_TRACK, NORMAL_SHOWN, shown, stepAlert } from "./engine";
import { alertObservation, ruleFor, ruleUnitFor, valueInUnit, type AlertConfig, type ResolvedRule } from "./rules";
import type { ShownAlert } from "./types";

/** The shown alert of one observation on a fresh track, dwell ignored. */
export function instantAlert(config: AlertConfig, kind: "key" | "dial", reading: Pick<Reading, "key" | "linkedKeys" | "unit" | "value">, slot: number, fahrenheit: boolean): ShownAlert {
	const rule = ruleFor(config, kind, reading, slot);
	if (rule === null) return NORMAL_SHOWN;
	return shown(stepAlert(FRESH_TRACK, alertObservation(rule, reading, fahrenheit, true), rule, 0, 0));
}

/** A rule's limits in the unit the face shows the reading in, for the
 * gauge's zones and range: converted across °C and °F when the rule was
 * saved in the other one, and undefined when the rule stands down (a unit
 * it was not saved for, or one never captured). */
export function ruleLimitsOnFace(rule: ResolvedRule, reading: Pick<Reading, "unit" | "value">, fahrenheit: boolean): { warn?: number; crit?: number; below: boolean } | undefined {
	const target = ruleUnitFor(rule, reading, fahrenheit);
	if (target === undefined) return undefined;
	const displayed = convertUnit(reading.value, reading.unit, fahrenheit).unit;
	const move = (limit: number | undefined): number | undefined => (limit === undefined ? undefined : target === displayed ? limit : valueInUnit(limit, target, displayed));
	const warn = move(rule.warn);
	const crit = move(rule.crit);
	return { ...(warn !== undefined ? { warn } : {}), ...(crit !== undefined ? { crit } : {}), below: rule.below };
}
