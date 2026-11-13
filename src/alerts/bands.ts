/**
 * Threshold bands for a graph: the warn and critical spans of one reading's
 * rule, converted into the graph's unit. Pure.
 *
 * Bands follow alertLevel exactly as the gauge zones do: critical owns its
 * side outright and warn covers the rest up to it, so a pair that goes
 * straight to critical draws no warn band. A rule that stands down for the
 * reading (a captured unit it no longer reports, a unit never captured), or
 * whose unit cannot be moved into the graph's unit, draws nothing.
 */
import type { Reading } from "../hwinfo/types";
import type { AlertBand, AlertSeverity } from "./types";
import { ruleFor, ruleUnitFor, valueInUnit, type AlertConfig } from "./rules";

export interface AlertBandOptions {
	/** The reading's visible name. Pass it when the graph carries more than
	 * one reading; every label then starts with it. */
	readonly name?: string;
}

/** A limit as a band label prints it: up to three decimals, no "-0". */
export function limitText(value: number): string {
	const rounded = Math.round(value * 1000) / 1000;
	return String(rounded === 0 ? 0 : rounded);
}

function bandLabel(level: AlertSeverity, limit: number, unit: string, name: string | undefined): string {
	const word = level === "crit" ? "critical" : "warn";
	const lead = name !== undefined && name.trim() !== "" ? `${name.trim()} ${word}` : word.charAt(0).toUpperCase() + word.slice(1);
	return `${lead} ${limitText(limit)}${unit === "" ? "" : ` ${unit}`}`;
}

/**
 * The bands for one drawn reading, in `graphUnit` (the unit the graph's
 * values are drawn in, after any °F conversion). `slot` is the reading's
 * position on a key face, as for ruleFor. Warn comes before critical.
 */
export function alertBands(config: AlertConfig, kind: "key" | "dial", reading: Pick<Reading, "key" | "linkedKeys" | "unit" | "value">, slot: number, fahrenheit: boolean, graphUnit: string, options: AlertBandOptions = {}): AlertBand[] {
	const rule = ruleFor(config, kind, reading, slot);
	if (rule === null) return [];
	const unit = ruleUnitFor(rule, reading, fahrenheit);
	if (unit === undefined) return [];
	const toGraph = (limit: number | undefined): number | undefined => {
		if (limit === undefined) return undefined;
		const moved = valueInUnit(limit, unit, graphUnit);
		return moved !== undefined && Number.isFinite(moved) ? moved : undefined;
	};
	if (valueInUnit(0, unit, graphUnit) === undefined) return [];
	const warn = toGraph(rule.warn);
	const crit = toGraph(rule.crit);
	const source = rule.source;
	const band = (level: AlertSeverity, from: number, to: number, limit: number): AlertBand => ({ level, from, to, readingKey: reading.key, label: bandLabel(level, limit, graphUnit, options.name), source });
	const bands: AlertBand[] = [];
	if (rule.below) {
		if (warn !== undefined && (crit === undefined || warn > crit)) bands.push(band("warn", crit ?? Number.NEGATIVE_INFINITY, warn, warn));
		if (crit !== undefined) bands.push(band("crit", Number.NEGATIVE_INFINITY, crit, crit));
	} else {
		if (warn !== undefined && (crit === undefined || crit > warn)) bands.push(band("warn", warn, crit ?? Number.POSITIVE_INFINITY, warn));
		if (crit !== undefined) bands.push(band("crit", crit, Number.POSITIVE_INFINITY, crit));
	}
	return bands;
}
