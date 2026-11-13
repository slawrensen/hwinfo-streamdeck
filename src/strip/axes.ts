/**
 * The Scale and grid overlay's numbers, as pure functions: value ticks at
 * round numbers, and time ticks for the window.
 *
 * Value ticks are chosen in the unit the reader sees (°F when the group
 * shows °F): 1, 2, 2.5 or 5 times a power of ten, as many as the plot
 * height leaves room for. A scale that follows the readings widens to the
 * enclosing ticks, so its top and bottom are labelled numbers; a typed end
 * stays exactly where it was typed.
 */

/** Steps tried, in order, within each power of ten. */
const MANTISSAS = [1, 2, 2.5, 5] as const;

export type ValueTicks = {
	/** Scale ends after widening (display units). */
	readonly lo: number;
	readonly hi: number;
	readonly step: number;
	/** Tick values, low to high (display units). */
	readonly values: readonly number[];
	/** Decimals that show every tick exactly. */
	readonly decimals: number;
};

function decimalsOf(step: number): number {
	for (let d = 0; d <= 6; d++) {
		const scaled = step * 10 ** d;
		if (Math.abs(scaled - Math.round(scaled)) < 1e-9 * Math.max(1, scaled)) return d;
	}
	return 6;
}

/**
 * Round-number ticks over [lo, hi] (display units), at most `maxTicks` of
 * them and at least two. `keep.lo`/`keep.hi` hold a typed end in place;
 * otherwise the end widens to the next tick. Null for an empty or
 * non-finite range.
 */
export function valueTicks(lo: number, hi: number, maxTicks: number, keep: { readonly lo?: boolean; readonly hi?: boolean } = {}): ValueTicks | null {
	if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return null;
	const most = Math.max(2, Math.floor(maxTicks));
	const span = hi - lo;
	const start = Math.floor(Math.log10(span / most)) - 1;
	for (let power = start; power <= start + 4; power++) {
		for (const m of MANTISSAS) {
			const step = m * 10 ** power;
			const first = keep.lo === true ? Math.ceil(lo / step - 1e-9) * step : Math.floor(lo / step + 1e-9) * step;
			const last = keep.hi === true ? Math.floor(hi / step + 1e-9) * step : Math.ceil(hi / step - 1e-9) * step;
			const count = Math.round((last - first) / step) + 1;
			if (count > most || count < 2) continue;
			const values = Array.from({ length: count }, (_, i) => Number((first + i * step).toFixed(10)));
			return { lo: keep.lo === true ? lo : (values[0] as number), hi: keep.hi === true ? hi : (values[values.length - 1] as number), step, values, decimals: decimalsOf(step) };
		}
	}
	return null;
}

export type TimeTick = {
	/** ms before the newest moment (the right edge). */
	readonly agoMs: number;
	/** The tick's label: "-30s", "-2m". */
	readonly label: string;
};

/** Time tick spacing per window: four or five intervals. */
const TIME_STEP_MS: Readonly<Record<number, number>> = { 60_000: 15_000, 300_000: 60_000, 900_000: 300_000 };

/** A time span as a short label: whole minutes as "m", else seconds. */
export function shortSpan(ms: number): string {
	const seconds = Math.round(ms / 1000);
	return seconds % 60 === 0 && seconds >= 60 ? `${seconds / 60}m` : `${seconds}s`;
}

/**
 * The ticks between the window's start and now, excluding both ends (the
 * start is labelled by the window itself, now by LIVE or PAUSED): every 15 s
 * on 1 minute, every minute on 5, every 5 minutes on 15. Another window
 * length gets a quarter of itself.
 */
export function timeTicks(windowMs: number): TimeTick[] {
	if (!(windowMs > 0)) return [];
	const step = TIME_STEP_MS[windowMs] ?? windowMs / 4;
	const out: TimeTick[] = [];
	for (let ago = step; ago < windowMs - 1e-6; ago += step) out.push({ agoMs: ago, label: `-${shortSpan(ago)}` });
	return out;
}
