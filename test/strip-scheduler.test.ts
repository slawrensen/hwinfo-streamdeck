/**
 * The per-group render scheduler on a fake clock: latest-only coalescing,
 * at least MIN_FRAME_MS between frames, SETTLE_MS after membership bursts,
 * dedupe keyed by epoch, no frame for departed contexts, and an aggregate
 * soft cap that holds data frames but never input frames.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AggregateBudget, GroupScheduler, MIN_FRAME_MS, SETTLE_MS, type FrameMember, type SchedulerClock } from "../src/strip/scheduler";

class FakeClock implements SchedulerClock {
	t = 0;
	private seq = 0;
	private readonly timers = new Map<number, { at: number; fn: () => void }>();
	now(): number {
		return this.t;
	}
	setTimeout(fn: () => void, ms: number): unknown {
		const id = ++this.seq;
		this.timers.set(id, { at: this.t + Math.max(0, ms), fn });
		return id;
	}
	clearTimeout(handle: unknown): void {
		this.timers.delete(handle as number);
	}
	get armed(): number {
		return this.timers.size;
	}
	/** Advance time, firing due timers in order. */
	advance(ms: number): void {
		const end = this.t + ms;
		for (;;) {
			let next: [number, { at: number; fn: () => void }] | undefined;
			for (const entry of this.timers) if (entry[1].at <= end && (next === undefined || entry[1].at < next[1].at)) next = entry;
			if (next === undefined) break;
			this.timers.delete(next[0]);
			this.t = Math.max(this.t, next[1].at);
			next[1].fn();
		}
		this.t = end;
	}
}

type Harness = { clock: FakeClock; scheduler: GroupScheduler; sent: { context: string; svg: string; at: number; generation: number }[]; members: FrameMember[]; current: Map<string, number>; frameSvg: { value: string }; renders: number[] };

function harness(opts: { budget?: AggregateBudget; clock?: FakeClock; failSend?: Set<string> } = {}): Harness {
	const clock = opts.clock ?? new FakeClock();
	const members: FrameMember[] = [0, 1, 2, 3].map((column) => ({ context: `c${column}`, epoch: 1, column }));
	const current = new Map(members.map((m) => [m.context, m.epoch]));
	const sent: Harness["sent"] = [];
	const frameSvg = { value: "frame-A" };
	const renders: number[] = [];
	const scheduler = new GroupScheduler({
		clock,
		members: () => members,
		isCurrent: (context, epoch) => current.get(context) === epoch,
		render: (ms, generation) => {
			renders.push(generation);
			return new Map(ms.map((m) => [m.context, `${frameSvg.value}:${m.column}`]));
		},
		send: (context, svg, generation) => {
			sent.push({ context, svg, at: clock.now(), generation });
			return opts.failSend?.has(context) === true ? Promise.reject(new Error("socket closed")) : Promise.resolve();
		},
		...(opts.budget === undefined ? {} : { budget: opts.budget })
	});
	return { clock, scheduler, sent, members, current, frameSvg, renders };
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("GroupScheduler", () => {
	it("the first invalidate after idle draws at once; a burst after it waits MIN_FRAME_MS (trailing frame)", () => {
		const h = harness();
		h.scheduler.invalidate("view");
		h.clock.advance(0);
		assert.equal(h.renders.length, 1);
		assert.equal(h.sent.length, 4);
		h.frameSvg.value = "frame-B";
		h.scheduler.invalidate("view");
		h.clock.advance(MIN_FRAME_MS - 1);
		assert.equal(h.renders.length, 1, "no frame before the minimum spacing");
		h.clock.advance(1);
		assert.equal(h.renders.length, 2);
		assert.equal(h.sent.length, 8);
	});

	it("50 rotate events in 500 ms coalesce to at most one frame per 100 ms, latest only", () => {
		const h = harness();
		for (let i = 0; i < 50; i++) {
			h.frameSvg.value = `frame-${i}`;
			h.scheduler.invalidate("view");
			h.clock.advance(10);
		}
		h.clock.advance(200);
		assert.ok(h.renders.length <= 6, `frames ${h.renders.length}`);
		const times = [...new Set(h.sent.map((s) => s.at))];
		for (let i = 1; i < times.length; i++) assert.ok((times[i] as number) - (times[i - 1] as number) >= MIN_FRAME_MS);
		assert.equal(h.sent[h.sent.length - 1]?.svg, "frame-49:3", "the last frame carries the latest state");
		// Per context: never more than 10 sends per second.
		for (const m of h.members) assert.ok(h.sent.filter((s) => s.context === m.context).length <= 7);
	});

	it("superseded states are never built: generations skip", () => {
		const h = harness();
		h.scheduler.invalidate("data");
		h.clock.advance(0);
		for (let i = 0; i < 5; i++) h.scheduler.invalidate("data");
		h.clock.advance(MIN_FRAME_MS);
		assert.deepEqual(h.renders, [1, 6]);
	});

	it("a membership burst becomes one first frame after SETTLE_MS", () => {
		const h = harness();
		for (let i = 0; i < 4; i++) {
			h.scheduler.invalidate("membership");
			h.clock.advance(5);
		}
		assert.equal(h.renders.length, 0);
		h.clock.advance(SETTLE_MS);
		assert.equal(h.renders.length, 1);
		assert.equal(h.sent.length, 4);
	});

	it("a data tick during a settle does not jump ahead of it", () => {
		const h = harness();
		h.scheduler.invalidate("membership");
		h.clock.advance(5);
		h.scheduler.invalidate("data");
		h.clock.advance(5);
		assert.equal(h.renders.length, 0);
		h.clock.advance(SETTLE_MS);
		assert.equal(h.renders.length, 1);
	});

	it("identical slices are not resent; a changed slice is", () => {
		const h = harness();
		h.scheduler.invalidate("data");
		h.clock.advance(0);
		h.scheduler.invalidate("data");
		h.clock.advance(MIN_FRAME_MS);
		assert.equal(h.renders.length, 2);
		assert.equal(h.sent.length, 4, "second frame: nothing changed, nothing sent");
		h.frameSvg.value = "frame-B";
		h.scheduler.invalidate("data");
		h.clock.advance(MIN_FRAME_MS);
		assert.equal(h.sent.length, 8);
	});

	it("forget() (every appear) resends to a cold image cache; a new epoch resends too", () => {
		const h = harness();
		h.scheduler.invalidate("data");
		h.clock.advance(0);
		h.scheduler.forget("c2");
		h.scheduler.invalidate("membership");
		h.clock.advance(MIN_FRAME_MS + SETTLE_MS);
		assert.deepEqual(h.sent.slice(4).map((s) => s.context), ["c2"]);
		const m1 = h.members[1] as FrameMember;
		h.members[1] = { ...m1, epoch: 2 };
		h.current.set("c1", 2);
		h.scheduler.invalidate("membership");
		h.clock.advance(MIN_FRAME_MS + SETTLE_MS);
		assert.deepEqual(h.sent.slice(5).map((s) => s.context), ["c1"]);
	});

	it("a departed or re-placed context is never painted", () => {
		const h = harness();
		h.current.delete("c3");
		h.current.set("c0", 99);
		h.scheduler.invalidate("data");
		h.clock.advance(0);
		assert.deepEqual(h.sent.map((s) => s.context).sort(), ["c1", "c2"]);
	});

	it("a failed send forgets that slice so the next frame retries it", async () => {
		const h = harness({ failSend: new Set(["c1"]) });
		h.scheduler.invalidate("data");
		h.clock.advance(0);
		await flush();
		h.scheduler.invalidate("data");
		h.clock.advance(MIN_FRAME_MS);
		assert.deepEqual(h.sent.slice(4).map((s) => s.context), ["c1"]);
	});

	it("dispose: no timer left, no frame after", () => {
		const h = harness();
		h.scheduler.invalidate("data");
		h.scheduler.dispose();
		h.clock.advance(1000);
		assert.equal(h.renders.length, 0);
		assert.equal(h.clock.armed, 0);
		h.scheduler.invalidate("view");
		h.clock.advance(1000);
		assert.equal(h.renders.length, 0);
	});

	it("the aggregate cap holds data frames, never input frames", () => {
		const clock = new FakeClock();
		const budget = new AggregateBudget(clock, 6);
		const a = harness({ clock, budget });
		const b = harness({ clock, budget });
		a.scheduler.invalidate("data");
		clock.advance(0);
		assert.equal(a.sent.length, 4);
		b.frameSvg.value = "b";
		b.scheduler.invalidate("data");
		clock.advance(0);
		assert.equal(b.sent.length, 0, "4 + 4 would pass the cap of 6: the data frame waits");
		b.scheduler.invalidate("view");
		clock.advance(MIN_FRAME_MS);
		assert.equal(b.sent.length, 4, "an input frame is never held");
		const c = harness({ clock, budget });
		c.scheduler.invalidate("data");
		clock.advance(500);
		assert.equal(c.sent.length, 0);
		clock.advance(600);
		assert.equal(c.sent.length, 4, "the held data frame draws once the window has room");
	});
});
