/**
 * The one registry of reading-key spellings. A saved reading key is stable
 * identity (never a list position); every producer owns a disjoint spelling
 * so no two producers can mint the same key.
 *
 * - Shared Memory: `sensorIdHex:instanceDec:readingIdHex` (layout.ts).
 * - Gadget: `g:` and `g2:` prefixes (gadget-identity.ts).
 * - Calculated readings (plugin-side): `calc:` + 22 base64url characters.
 */

/** Shared Memory key: hex sensor id, decimal instance, hex reading id. */
export const SHARED_MEMORY_KEY = /^[0-9a-f]{1,8}:\d{1,10}:[0-9a-f]{1,8}$/i;

export const GADGET_KEY_PREFIXES = ["g:", "g2:"] as const;
export const CALCULATED_KEY_PREFIX = "calc:";
export const CALCULATED_KEY = /^calc:[A-Za-z0-9_-]{22}$/;

export type KeyProducer = "shared-memory" | "gadget" | "calculated" | "unknown";

/** Which producer a saved key belongs to, by spelling alone. */
export function keyProducerOf(key: string): KeyProducer {
	if (key.startsWith(CALCULATED_KEY_PREFIX)) return CALCULATED_KEY.test(key) ? "calculated" : "unknown";
	if (GADGET_KEY_PREFIXES.some((p) => key.startsWith(p))) return "gadget";
	if (SHARED_MEMORY_KEY.test(key)) return "shared-memory";
	return "unknown";
}
