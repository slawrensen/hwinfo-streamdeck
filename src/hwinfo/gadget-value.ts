const NUMERIC_PREFIX = /^\s*([-+−]?(?:\d[\d., \u00a0\u202f'’]*|[.,]\d+)(?:[eE][+-]?\d+)?)/u;

/** Whether the formatted display starts with a number the raw value can be
 * checked against. A Yes/No or other word display has no unit of its own. */
export function gadgetDisplayIsNumeric(formatted: string): boolean {
	return NUMERIC_PREFIX.test(formatted);
}

/** Extract units with the same number grammar used for contradiction
 * checks. HWiNFO's boolean readings display the word itself, and Shared
 * Memory reports their unit as "Yes/No": the same one unit here keeps a
 * threshold, a session and a reading link on the reading across the flip
 * (the word as the unit changed exactly when the value did). Any other
 * nonnumeric text is retained rather than guessed at. */
export function gadgetUnitOf(formatted: string): string {
	const match = NUMERIC_PREFIX.exec(formatted);
	const unit = (match ? formatted.slice(match[0].length) : formatted).trim();
	return match === null && (unit === "Yes" || unit === "No") ? "Yes/No" : unit;
}

/** The number a row's raw field carries. HWiNFO writes it with the system
 * locale's decimal separator, and writes a boolean reading's raw field as
 * the word itself ("Yes" or "No", seen on 8.48), not as 1 or 0: the word
 * reads as the number Shared Memory reports for the same reading. Any other
 * text stays unavailable, and nothing is repaired from the display field. */
export function gadgetRawValue(raw: string): number {
	if (raw === "Yes") return 1;
	if (raw === "No") return 0;
	return Number.parseFloat(raw.replace(",", "."));
}

/** Whether the formatted numeric precision can describe the authoritative
 * raw value. Agreement is a contradiction check, never an atomicity claim.
 * Nonnumeric/boolean displays and unavailable raw values remain unchanged. */
export function gadgetValueAgrees(formatted: string, raw: number): boolean {
	if (!Number.isFinite(raw)) return true;
	const match = NUMERIC_PREFIX.exec(formatted);
	if (!match) return true;
	const token = (match[1] as string).trim().replace("−", "-").replace(/[\u00a0\u202f]/gu, " ").replace(/’/gu, "'");
	for (const decimal of [null, ".", ","] as const) {
		const candidate = numericCandidate(token, decimal);
		if (candidate === null) continue;
		const tolerance = candidate.quantum / 2 + Number.EPSILON * Math.max(Math.abs(raw), Math.abs(candidate.value)) * 4;
		if (Math.abs(candidate.value - raw) <= tolerance) return true;
	}
	return false;
}

function numericCandidate(token: string, decimal: "." | "," | null): { value: number; quantum: number } | null {
	const exponentMatch = /[eE]([+-]?\d+)$/.exec(token);
	const exponent = exponentMatch ? Number(exponentMatch[1]) : 0;
	const mantissa = exponentMatch ? token.slice(0, exponentMatch.index) : token;
	const negative = mantissa.startsWith("-");
	const unsigned = /^[+-]/.test(mantissa) ? mantissa.slice(1) : mantissa;
	const parts = decimal === null ? [unsigned] : unsigned.split(decimal);
	if (decimal !== null && parts.length !== 2) return null;
	const integer = parts[0] as string;
	const fraction = parts[1] ?? "";
	if (!/^\d*$/.test(fraction)) return null;
	const grouping = integer.replace(/\d/g, "");
	let digits = integer;
	if (grouping !== "") {
		if (![...grouping].every((separator) => separator === grouping[0])) return null;
		const groups = integer.split(grouping[0] as string);
		if (!/^\d{1,3}$/.test(groups[0] as string) || !/^\d{3}$/.test(groups.at(-1) as string)) return null;
		const middle = groups.slice(1, -1);
		if (!middle.every((part) => /^\d{3}$/.test(part)) && !middle.every((part) => /^\d{2}$/.test(part))) return null;
		digits = groups.join("");
	}
	if (!/^\d*$/.test(digits) || digits.length + fraction.length === 0) return null;
	const value = Number(`${negative ? "-" : ""}${digits || "0"}.${fraction || "0"}e${exponent}`);
	const quantum = 10 ** (exponent - fraction.length);
	return Number.isFinite(value) && Number.isFinite(quantum) && quantum > 0 ? { value, quantum } : null;
}
