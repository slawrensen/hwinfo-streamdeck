/**
 * One string per distinct data state, for skipping whole detail render
 * passes. pollTime alone is too coarse a gate: it is unix seconds, and
 * HWiNFO polling faster than 1 Hz rewrites values in place under an
 * unchanged stamp, so the provider's valueRevision (bumped on any actual
 * store, and on every rebuild) carries the moves the stamp cannot. The
 * reading count guards a rebuild against a skeleton that happens to keep
 * both numbers. Kept SDK-free and pure so the unit suite can prove the
 * gate without the controller's dependency graph.
 */
import type { PollerStatus } from "../poller";

export function tickSignature(status: PollerStatus): string {
	if (status.state === "ok") {
		return `ok:${status.snapshot.pollTime}:${status.snapshot.valueRevision ?? 0}:${status.snapshot.readings.length}`;
	}
	// Stale and unavailable states hold still by definition: the values are
	// frozen (stale) or absent, so the face only changes with the state.
	return status.state === "stale" ? `stale:${status.source}` : `unavailable:${status.reason}`;
}
