/**
 * The layout a Sensor Reading key actually draws, from its settings alone.
 * compose() branches on this, and the settings panel's summary reports it,
 * so "Quad chosen but only one reading picked" can never read differently
 * in the two places.
 *
 * Only exact markers count, and a multi layout needs enough usable slots:
 * quad and triple need two non-empty slot keys among their slots (the
 * primary included), dual needs the second key. Anything else (absent,
 * junk, a newer version's value, too few picks) draws the unchanged single
 * layout, so rolled-back settings degrade safely and are never rewritten.
 */
export type KeyLayout = "single" | "dual" | "triple" | "quad";

/** Settings are untyped JSON at runtime: only a non-empty string is a key. */
export function nonEmptyKey(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

export function drawnKeyLayout(settings: { readingKey?: unknown; secondaryReadingKey?: unknown; quadReadingKey3?: unknown; quadReadingKey4?: unknown; keyLayout?: unknown }): KeyLayout {
	const slots = [nonEmptyKey(settings.readingKey), nonEmptyKey(settings.secondaryReadingKey), nonEmptyKey(settings.quadReadingKey3), nonEmptyKey(settings.quadReadingKey4)];
	if (slots[0] === undefined) {
		return "single";
	}
	if (settings.keyLayout === "quad" && slots.filter((k) => k !== undefined).length >= 2) {
		return "quad";
	}
	if (settings.keyLayout === "triple" && slots.slice(0, 3).filter((k) => k !== undefined).length >= 2) {
		return "triple";
	}
	if (settings.keyLayout === "dual" && slots[1] !== undefined) {
		return "dual";
	}
	return "single";
}
