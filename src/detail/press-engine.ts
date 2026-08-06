/**
 * A small tap-vs-hold press engine for the "Tap cycles; hold opens
 * details" behavior. One session per action context: keyDown arms a
 * timer, an early keyUp is a tap, crossing HOLD_THRESHOLD_MS fires the
 * hold exactly once, and the keyUp after a consumed hold does nothing.
 * Cancellation (willDisappear, device disconnect, shutdown, a profile
 * transition) kills the session so a stale timer can never fire a ghost
 * action: every timer callback re-validates its own generation first.
 */
import { HOLD_THRESHOLD_MS } from "./detail-settings";

export type PressOutcome = "tap" | "hold";

type PressSession = {
	generation: number;
	timer: ReturnType<typeof setTimeout> | null;
	holdConsumed: boolean;
};

type TimerDeps = {
	setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
	clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
};

export class PressEngine {
	private readonly sessions = new Map<string, PressSession>();
	private generation = 0;

	constructor(
		private readonly onOutcome: (contextId: string, outcome: PressOutcome) => void,
		private readonly holdMs: number = HOLD_THRESHOLD_MS,
		// unref'd: an armed hold must never keep the process alive on exit.
		private readonly timers: TimerDeps = { setTimer: (fn, ms) => setTimeout(fn, ms).unref(), clearTimer: (h) => clearTimeout(h) }
	) {}

	/** Arms a session. A repeated keyDown without a keyUp (replayed events)
	 *  replaces the session rather than stacking timers. */
	keyDown(contextId: string): void {
		this.cancel(contextId);
		const generation = ++this.generation;
		const session: PressSession = { generation, timer: null, holdConsumed: false };
		this.sessions.set(contextId, session);
		session.timer = this.timers.setTimer(() => {
			// A canceled or superseded session must never fire: the map entry
			// and its generation both have to still be ours.
			const live = this.sessions.get(contextId);
			if (live === undefined || live.generation !== generation || live.holdConsumed) {
				return;
			}
			live.holdConsumed = true;
			live.timer = null;
			this.onOutcome(contextId, "hold");
		}, this.holdMs);
	}

	/** Resolves a session: tap when released early, silence after a hold. */
	keyUp(contextId: string): void {
		const session = this.sessions.get(contextId);
		if (session === undefined) {
			return;
		}
		this.sessions.delete(contextId);
		if (session.timer !== null) {
			this.timers.clearTimer(session.timer);
			session.timer = null;
		}
		if (!session.holdConsumed) {
			this.onOutcome(contextId, "tap");
		}
	}

	/** Kills a session with no outcome (disappear, disconnect, transition). */
	cancel(contextId: string): void {
		const session = this.sessions.get(contextId);
		if (session === undefined) {
			return;
		}
		this.sessions.delete(contextId);
		if (session.timer !== null) {
			this.timers.clearTimer(session.timer);
			session.timer = null;
		}
	}

	/** True while a session is armed or consumed-but-unreleased. */
	hasSession(contextId: string): boolean {
		return this.sessions.has(contextId);
	}
}
