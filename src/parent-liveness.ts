/**
 * Parent-liveness rules for the watchdog that exits this process when the
 * Stream Deck app dies without tearing us down.
 *
 * The rules live here, apart from the timer and the SDK, because the naive
 * version of this check cost a user his plugin: probing `process.ppid` with
 * `process.kill(pid, 0)` and treating ANY throw as "the app is gone" exits
 * 30 seconds after every launch on a machine where that probe cannot answer
 * (issue #17). A parent PID is a hint about the app, never proof, so:
 *
 *  - EPERM means the process EXISTS and we may not open it (a privilege or
 *    integrity boundary, or a security product hooking OpenProcess). That is
 *    evidence of life, not death.
 *  - A probe that already fails at startup means this machine cannot answer
 *    the question at all, so the watchdog never arms.
 *  - Only a repeated ESRCH is worth acting on, and even then the app itself
 *    gets the last word: it is asked directly, and an answer disarms the
 *    watchdog for good (the PID signal is proven unreliable here, so it must
 *    never be trusted again in this process).
 *
 * What survives from the original: if the app really is gone, the PID is
 * gone AND it cannot answer, so we still exit and leave no orphan polling
 * for nobody.
 */

/** What a parent-PID probe established. */
export type ParentProbe =
	/** The parent process is there. */
	| "alive"
	/** No such process (ESRCH): the PID is genuinely gone. */
	| "gone"
	/** It exists but we cannot open it (EPERM), or the probe itself failed. */
	| "blocked";

/** What the caller should do after a probe. */
export type WatchdogAction =
	/** Do nothing; the plugin keeps running. */
	| "stay"
	/** Ask the app directly, and exit only if it does not answer. */
	| "confirm-with-app";

/** Consecutive "gone" probes before the app is asked. One is a blip. */
export const GONE_STRIKES = 2;

/**
 * Maps a failed `process.kill(pid, 0)` to a probe result. Only ESRCH ("no
 * such process") means gone; everything else, EPERM above all, means the
 * question could not be answered and the plugin stays.
 */
export function classifyProbeError(err: unknown): ParentProbe {
	const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
	return code === "ESRCH" ? "gone" : "blocked";
}

/** Error code of a failed probe, for the log line that made this diagnosable. */
export function probeErrorCode(err: unknown): string {
	const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
	return code === "" ? String(err) : code;
}

export class ParentLiveness {
	private strikes = 0;
	private disarmed: boolean;

	/** Arms only when the parent could be probed at startup: a machine that
	 *  cannot answer at t=0 will not answer later either, and a check that
	 *  cannot answer must not be allowed to kill anything. */
	constructor(startupProbe: ParentProbe) {
		this.disarmed = startupProbe !== "alive";
	}

	get armed(): boolean {
		return !this.disarmed;
	}

	/** Stand down for the rest of the process lifetime. Called when the app
	 *  answers a confirmation, which proves the PID signal lies here. */
	disarm(): void {
		this.disarmed = true;
	}

	observe(probe: ParentProbe): WatchdogAction {
		if (this.disarmed) {
			return "stay";
		}
		if (probe !== "gone") {
			this.strikes = 0; // alive, or unanswerable: either way, not evidence of death
			return "stay";
		}
		this.strikes++;
		if (this.strikes < GONE_STRIKES) {
			return "stay";
		}
		// Spend the strikes on the question: the caller either exits, disarms,
		// or (if it does neither) has to earn a fresh run before asking again.
		this.strikes = 0;
		return "confirm-with-app";
	}
}
