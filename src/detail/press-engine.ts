/**
 * A small tap-vs-hold press engine for the "Tap cycles; hold opens
 * details" behavior. One session per action context: keyDown arms a
 * timer, an early keyUp is a tap, crossing HOLD_THRESHOLD_MS fires the
 * hold exactly once, and the keyUp after a consumed hold does nothing.
 * A release is classified by the time held as well as by the timer, so a
 * release after the threshold is a hold even when a busy or suspended
 * event loop delivers it before the timer runs (external review AX62).
 * Cancellation (willDisappear, device disconnect, shutdown, a profile
 * transition) kills the session so a stale timer can never fire a ghost
 * action: every timer callback re-validates its own generation first.
 */
import { monotonicNow } from "../clock";
import { HOLD_THRESHOLD_MS } from "./detail-settings";

export type PressOutcome = "tap" | "hold";

type PressSession = {
	generation: number;
	downAt: number;
	timer: ReturnType<typeof setTimeout> | null;
	holdConsumed: boolean;
};

type TimerDeps = {
	setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
	clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
	now?: () => number;
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
	 *  is the same press: it keeps the first down's deadline and anything
	 *  that consumed it, so it can neither re-arm nor fire a second hold
	 *  (external review AX67). */
	keyDown(contextId: string): void {
		if (this.sessions.has(contextId)) {
			return;
		}
		const generation = ++this.generation;
		const session: PressSession = { generation, downAt: this.now(), timer: null, holdConsumed: false };
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
			this.onOutcome(contextId, this.now() - session.downAt >= this.holdMs ? "hold" : "tap");
		}
	}

	/** Whether a press is held (armed or consumed) on this context. */
	isDown(contextId: string): boolean {
		return this.sessions.has(contextId);
	}

	/** Ends a held press with no outcome but keeps it held until its
	 * release: changed settings or a replayed appear (AX27, AX67). */
	consume(contextId: string): void {
		const session = this.sessions.get(contextId);
		if (session === undefined) {
			return;
		}
		if (session.timer !== null) {
			this.timers.clearTimer(session.timer);
			session.timer = null;
		}
		session.holdConsumed = true;
	}

	private now(): number {
		return (this.timers.now ?? monotonicNow)();
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
}
