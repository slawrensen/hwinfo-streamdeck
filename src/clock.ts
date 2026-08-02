/**
 * Monotonic milliseconds, for every judgment of the form "how long since X".
 *
 * `Date.now()` is wall-clock and can move backwards: a VM or laptop resume
 * where the host corrects guest time, the first NTP sync after a boot with a
 * dead CMOS battery, a Windows/Linux dual boot fixing an RTC-in-UTC mismatch.
 * Elapsed time computed across such a jump goes NEGATIVE, and the poller's
 * staleness test (`now - lastAdvance > STALE_AFTER_MS`) then cannot fire for
 * the length of the jump. That is the worst possible direction for a monitor:
 * a frozen HWiNFO keeps showing its last numbers as if they were live, with
 * no "Not updating" cue, for as long as the correction lasts.
 *
 * `performance.now()` is monotonic from process start and immune to all of
 * it. It is not comparable across processes and is not a date; nothing here
 * ever needs either.
 */

/** Milliseconds since process start, never decreasing. */
export function monotonicNow(): number {
	return Math.round(performance.now());
}
