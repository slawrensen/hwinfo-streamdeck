/**
 * Shared alert contract. The engine (src/alerts/engine.ts) is pure and runs
 * in memory only; nothing here is persisted.
 */

export type AlertSeverity = "warn" | "crit";
export type AlertLevel = "normal" | AlertSeverity;

/** What a face shows for one reading after dwell, recovery and snooze. */
export interface ShownAlert {
	readonly level: AlertLevel;
	/** The level that is currently silenced by a deliberate snooze, if any. */
	readonly snoozed: AlertSeverity | null;
}

/**
 * A threshold band for a graph, always scoped to ONE reading and labelled
 * with it, already converted into the graph's unit. A band is never drawn
 * for a reading whose rule unit does not match the graph unit.
 */
export interface AlertBand {
	readonly level: AlertSeverity;
	/** Band edges in the graph unit; from < to. Infinity marks an open edge. */
	readonly from: number;
	readonly to: number;
	/** The saved key of the reading the rule belongs to. */
	readonly readingKey: string;
	/** Visible label, e.g. "CPU warn 80 °C" (reading name first when a graph
	 * carries more than one reading). */
	readonly label: string;
	readonly source: "reading" | "legacy" | "strip";
}
