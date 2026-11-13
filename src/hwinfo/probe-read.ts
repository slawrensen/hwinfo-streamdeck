import type { SnapshotProvider } from "./provider";
import type { SensorSnapshot } from "./types";

/** The standalone probe can wait briefly for a genuine guarded snapshot.
 * The plugin's nonblocking poll path does not use this helper. */
export async function readProbeSnapshot(provider: Pick<SnapshotProvider, "read">, onBusy: () => void): Promise<SensorSnapshot | null> {
	const deadline = performance.now() + 150;
	const first = provider.read();
	if (first !== null) return first;
	onBusy();
	while (performance.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, Math.min(10, deadline - performance.now())));
		if (performance.now() >= deadline) break;
		const next = provider.read();
		if (next !== null) return next;
	}
	return null;
}
