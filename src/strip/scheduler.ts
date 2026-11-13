/**
 * One render scheduler per strip group. The SDK's setFeedback resolves when
 * the message is sent and the app never acknowledges it, so the plugin
 * cannot bound frames in flight; it bounds its own pending work instead:
 *
 * - a generation counter and ONE dirty flag: superseded states are never
 *   built, only the latest;
 * - at least MIN_FRAME_MS between frames (at most 10 setFeedback calls per
 *   second per context, Elgato's touch strip guidance);
 * - a membership change waits SETTLE_MS so a page's burst of appears
 *   becomes one first frame;
 * - the build is synchronous (capture, compose, slice, send in one turn), so
 *   no lifecycle event can interleave inside a frame;
 * - a context is painted only while the registry says its epoch is current
 *   (a departed or re-placed context never gets a late frame);
 * - identical slices are not resent, keyed by the member's epoch, and
 *   forget() clears that memory on every appear (a cold app image cache
 *   needs the frame again) and disappear;
 * - an aggregate soft cap across every group defers frames caused only by
 *   new data; frames caused by input, edits or membership are never held.
 *
 * The clock is injected, so tests drive it with a fake.
 */

export const MIN_FRAME_MS = 100;
export const SETTLE_MS = 30;
/** A run of membership events slides the first frame at most this far. */
export const SETTLE_CAP_MS = 250;
export const AGGREGATE_CAP_PER_S = 30;

export type InvalidateReason = "data" | "config" | "membership" | "view" | "style";

export interface SchedulerClock {
	now(): number;
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
}

/** A real clock on monotonic time; timers are unref'd. */
export function systemClock(now: () => number): SchedulerClock {
	return {
		now,
		setTimeout: (fn, ms) => {
			const handle = setTimeout(fn, Math.max(0, ms));
			handle.unref?.();
			return handle;
		},
		clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
	};
}

export type FrameMember = { readonly context: string; readonly epoch: number; readonly column: number };

/** Sends counted across every group in a sliding one-second window. */
export class AggregateBudget {
	private readonly sent: number[] = [];

	constructor(
		private readonly clock: Pick<SchedulerClock, "now">,
		readonly capPerSecond: number = AGGREGATE_CAP_PER_S
	) {}

	private prune(now: number): void {
		while (this.sent.length > 0 && (this.sent[0] as number) <= now - 1000) this.sent.shift();
	}

	/** Sends inside the current one-second window. */
	used(): number {
		this.prune(this.clock.now());
		return this.sent.length;
	}

	/** Whether `n` more sends fit under the cap now. */
	fits(n: number): boolean {
		return this.used() + n <= this.capPerSecond;
	}

	/** When the oldest send leaves the window (the next chance to fit). */
	nextRoomAt(): number {
		const now = this.clock.now();
		this.prune(now);
		return this.sent.length === 0 ? now : (this.sent[0] as number) + 1000;
	}

	record(n: number): void {
		const now = this.clock.now();
		for (let i = 0; i < n; i++) this.sent.push(now);
	}
}

export interface GroupSchedulerDeps {
	readonly clock: SchedulerClock;
	/** The group's members at frame time (a snapshot; epochs included). */
	members(): readonly FrameMember[];
	/** The registry's departed/re-placed guard. */
	isCurrent(context: string, epoch: number): boolean;
	/** Build every slice of one frame, synchronously, from one snapshot. */
	render(members: readonly FrameMember[], generation: number): ReadonlyMap<string, string>;
	/** setFeedback for one member; a rejection forgets that slice. */
	send(context: string, svg: string, generation: number): Promise<void> | void;
	readonly budget?: AggregateBudget;
}

export class GroupScheduler {
	private generationValue = 0;
	private dirty = false;
	private reasons = new Set<InvalidateReason>();
	private timer: unknown = null;
	private dueAt = Number.POSITIVE_INFINITY;
	private lastFrameAt = Number.NEGATIVE_INFINITY;
	private settleSince: number | null = null;
	private disposed = false;
	private readonly lastSent = new Map<string, { readonly epoch: number; readonly svg: string }>();
	/** Frames built and sends made, for traces and tests. */
	frames = 0;
	sends = 0;

	constructor(private readonly deps: GroupSchedulerDeps) {}

	get generation(): number {
		return this.generationValue;
	}

	get pending(): boolean {
		return this.dirty;
	}

	invalidate(reason: InvalidateReason): void {
		if (this.disposed) return;
		this.generationValue++;
		this.dirty = true;
		this.reasons.add(reason);
		const now = this.deps.clock.now();
		let due = Math.max(now, this.lastFrameAt + MIN_FRAME_MS);
		if (reason === "membership") {
			this.settleSince ??= now;
			due = Math.max(due, Math.min(now + SETTLE_MS, this.settleSince + SETTLE_CAP_MS));
		} else if (this.settleSince !== null) {
			due = Math.max(due, this.dueAt);
		}
		this.arm(due, reason === "membership");
	}

	/** Drop the dedupe memory for a context (every appear and disappear). */
	forget(context: string): void {
		this.lastSent.delete(context);
	}

	dispose(): void {
		this.disposed = true;
		this.cancel();
		this.dirty = false;
		this.reasons.clear();
		this.lastSent.clear();
	}

	private cancel(): void {
		if (this.timer !== null) this.deps.clock.clearTimeout(this.timer);
		this.timer = null;
		this.dueAt = Number.POSITIVE_INFINITY;
	}

	/** Arms the one timer for `due`. An earlier armed timer is kept (the dirty
	 * flag coalesces), except that a membership settle may push it later. */
	private arm(due: number, settle: boolean): void {
		if (this.timer !== null && (settle ? this.dueAt >= due : this.dueAt <= due)) return;
		this.cancel();
		this.dueAt = due;
		this.timer = this.deps.clock.setTimeout(() => this.frame(), due - this.deps.clock.now());
	}

	private frame(): void {
		this.timer = null;
		this.dueAt = Number.POSITIVE_INFINITY;
		if (this.disposed || !this.dirty) return;
		const members = this.deps.members().filter((m) => this.deps.isCurrent(m.context, m.epoch));
		const budget = this.deps.budget;
		const dataOnly = [...this.reasons].every((r) => r === "data");
		if (dataOnly && budget !== undefined && members.length > 0 && !budget.fits(members.length)) {
			// Soft cap: a frame that only carries new data waits for room.
			this.arm(Math.max(budget.nextRoomAt(), this.deps.clock.now() + 1), false);
			return;
		}
		this.dirty = false;
		this.reasons = new Set();
		this.settleSince = null;
		const generation = this.generationValue;
		const slices = this.deps.render(members, generation);
		this.frames++;
		let sent = 0;
		for (const m of members) {
			const svg = slices.get(m.context);
			if (svg === undefined) continue;
			const prev = this.lastSent.get(m.context);
			if (prev !== undefined && prev.epoch === m.epoch && prev.svg === svg) continue;
			this.lastSent.set(m.context, { epoch: m.epoch, svg });
			sent++;
			try {
				const result = this.deps.send(m.context, svg, generation);
				if (result instanceof Promise) result.catch(() => this.dropIfSame(m.context, svg));
			} catch {
				this.dropIfSame(m.context, svg);
			}
		}
		this.sends += sent;
		budget?.record(sent);
		this.lastFrameAt = this.deps.clock.now();
	}

	private dropIfSame(context: string, svg: string): void {
		if (this.lastSent.get(context)?.svg === svg) this.lastSent.delete(context);
	}
}
