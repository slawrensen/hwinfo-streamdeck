/**
 * Strict parsing of the settings baked into detail-profile cells. Every
 * key in a bundled detail profile carries exactly one of:
 *
 *   { "slot": "back" } | { "slot": "title" } | { "slot": "previous" }
 *   | { "slot": "next" } | { "slot": "reading", "index": <int >= 0> }
 *
 * The profile never contains reading keys, sensor labels, values or user
 * data — slots ask the device-scoped detail state what to show at
 * runtime. Anything unknown, malformed, negative, fractional, oversized
 * or from a future version parses to null, and the caller renders a safe
 * empty tile instead of throwing mid-tick.
 */

export type DetailSlotBinding = { readonly slot: "back" | "title" | "previous" | "next" } | { readonly slot: "reading"; readonly index: number };

/** Indices past any real device's slot plan are junk, not future growth. */
const MAX_READING_INDEX = 255;

export function parseSlotBinding(raw: unknown): DetailSlotBinding | null {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return null;
	}
	const slot = (raw as { slot?: unknown }).slot;
	if (slot === "back" || slot === "title" || slot === "previous" || slot === "next") {
		return { slot };
	}
	if (slot === "reading") {
		const index = (raw as { index?: unknown }).index;
		if (typeof index === "number" && Number.isInteger(index) && index >= 0 && index <= MAX_READING_INDEX) {
			return { slot: "reading", index };
		}
	}
	return null;
}
