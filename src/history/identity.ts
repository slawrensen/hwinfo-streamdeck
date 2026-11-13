/**
 * The one rule for "is this still the same measurement": a dial's session
 * statistics (stats.ts) and a history segment (store.ts) both end on the
 * same change, checked in the same order. The source comes first, then the
 * unit, the reading type and finally the binding: a saved key that came to
 * stand for another provider key (a re-paired link). Gaining or losing an
 * alias while the key keeps resolving to the same measurement is no break.
 * A calculated reading (src/hwinfo/calculated.ts) is the same measurement
 * only while its definition and what its inputs resolve to stay the same;
 * a changed definition is a "definition" break.
 */
import { calculatedInfoOf, measurementIdentityOf } from "../hwinfo/calculated";
import type { Reading } from "../hwinfo/types";

export type IdentityBreak = "source" | "unit" | "type" | "binding" | "definition";

/** What a previous observation was of. `identity` is measurementIdentityOf
 * (reading): liveKeyOf for a provider reading, unchanged from 1.7.1. */
export interface ObservedIdentity {
	readonly source: string;
	readonly unit: string;
	readonly type: Reading["type"];
	readonly identity: string;
}

export function identityBreak(previous: ObservedIdentity, reading: Reading, source: string): IdentityBreak | undefined {
	if (previous.source !== source) return "source";
	if (previous.unit !== reading.unit) return "unit";
	if (previous.type !== reading.type) return "type";
	if (previous.identity !== measurementIdentityOf(reading)) return calculatedInfoOf(reading) === undefined ? "binding" : "definition";
	return undefined;
}
