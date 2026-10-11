/** JSON with every object's keys sorted: equal for equal documents, whatever
 * order their keys arrive in (the app sorts keys, the plugin's own writes do
 * not). Held presses compare settings documents with it. */
export function sortedJson(value: unknown): string {
	return JSON.stringify(value, (_, v: unknown) => (v !== null && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
}
