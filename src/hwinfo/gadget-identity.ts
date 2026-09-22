/** Gadget has names, but no hardware IDs. Never number duplicate names. */

/** The exact spellings 1.6 and earlier minted for a registry slot that had
 * no label. A live label spelled the same way cannot be told from such a
 * slot selection, so it gets a tagged key and no legacy alias. */
function isLegacyFallbackLabel(label: string): boolean {
	const fallback = /^Reading (0|[1-9]\d*)$/.exec(label);
	return fallback !== null && fallback[0] === label && Number(fallback[1]) < 1024;
}

/** Keep ordinary saved keys, including spaces. Reserved characters use a
 * separate namespace that cannot impersonate a legacy suffix or colon
 * partition. Literal names matching the old missing-label fallback use a
 * tagged tuple: an old slot selection cannot become a genuine named reading
 * on upgrade, even when its incomplete identity was never observed here.
 * The provider republishes a 1.6 spelling as a checked alias only where it
 * is unambiguous (see legacyGadgetKey); nothing is inferred from names. */
export function gadgetReadingKey(sensor: string, label: string): string {
	if (isLegacyFallbackLabel(label)) {
		return `g2:${Buffer.from(JSON.stringify(["named", sensor, label])).toString("base64url")}`;
	}
	return /[:~\r\n]/.test(sensor + label)
		? `g2:${Buffer.from(JSON.stringify([sensor, label])).toString("base64url")}`
		: `g:${sensor}:${label}`;
}

/**
 * The key 1.6 and earlier saved for this row when it differs from the
 * current one: "g:<source>:<label>" for names carrying a colon (HWiNFO's
 * standard "CPU [#0]: <model>" source names all do). Null when the current
 * key is that spelling already, when the label is a legacy fallback
 * spelling, or when a name carries a tilde: 1.6 spelled its duplicate
 * copies "<key>~n", so a literal tilde could impersonate an old duplicate
 * selection and stays unaliased. A caller publishes the legacy key as an
 * alias only when exactly one current row renders to it and no live row
 * owns it, so an old selection keeps resolving without ever choosing
 * between two readings.
 */
export function legacyGadgetKey(sensor: string, label: string): string | null {
	if (isLegacyFallbackLabel(label) || /~/.test(sensor + label)) return null;
	const legacy = `g:${sensor}:${label}`;
	return gadgetReadingKey(sensor, label) === legacy ? null : legacy;
}
