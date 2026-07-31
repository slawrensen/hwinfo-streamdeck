/**
 * The detail controller: owns every visible detail slot's registration,
 * routes slot presses, and renders the whole surface batched by device
 * and tick. Group resolution and the presentation context happen once
 * per device per pass (never once per slot), and byte-identical frames
 * are skipped, so a dense + XL page costs one resolution and at most 36
 * image updates per fresh snapshot.
 *
 * The SDK stays out: slots hand in a thin setImage handle, and the theme
 * authorities (theme-store) are only read, so everything above this line
 * is driven end-to-end by the mock-app e2e harness.
 */
import type { PollerStatus } from "../poller";
import type { SensorSnapshot } from "../hwinfo/types";
import { effectiveTextFor, getDeckTheme, measureOptionsFrom, typeAccentsEnabled } from "../ui/theme-store";
import { loadThemes } from "../ui/themes";
import { composeBackFace, composeIdleFace, composePagerFace, composeReadingFace, composeTitleFace, composeVoidFace, type DetailFaceContext } from "./detail-faces";
import type { DetailPage } from "./detail-group";
import type { DetailNavigator, DeviceDetailState } from "./navigation";
import { parseSlotBinding, type DetailSlotBinding } from "./slot-bindings";
import { tickSignature } from "./tick-signature";

export type SlotHandle = {
	setImage(svg: string): void;
};

type SlotRegistration = {
	readonly contextId: string;
	readonly deviceId: string;
	binding: DetailSlotBinding | null;
	/** The slot's grid cell as the app reported it; null when unknown.
	 *  Drives the mirror Back tile (the slot on the opener's own cell). */
	cell: { readonly column: number; readonly row: number } | null;
	handle: SlotHandle;
	lastSvg: string;
};

type ControllerDeps = {
	getStatus: () => PollerStatus;
	log?: { warn(msg: string): void };
};

export class DetailController {
	private readonly slots = new Map<string, SlotRegistration>();
	/** Devices with a repaint pending in the current coalescing window. */
	private readonly dirty = new Set<string>();
	private flushScheduled = false;

	constructor(
		private readonly navigator: DetailNavigator,
		private readonly deps: ControllerDeps
	) {}

	/**
	 * Coalesced repaint. The appear burst after a profile switch delivers
	 * dozens of registrations in one loop turn; repainting the device once
	 * per event is O(slots squared) composes for zero extra frames (the
	 * dedupe drops the repeats). One flush per loop turn instead, unref'd
	 * so an idle flush can never hold the process open on exit.
	 */
	requestRender(deviceId: string): void {
		this.dirty.add(deviceId);
		if (this.flushScheduled) {
			return;
		}
		this.flushScheduled = true;
		setImmediate(() => {
			this.flushScheduled = false;
			if (this.dirty.size === 0) {
				return;
			}
			const devices = [...this.dirty];
			this.dirty.clear();
			const status = this.deps.getStatus();
			for (const deviceId of devices) {
				this.renderDevice(deviceId, status);
			}
		}).unref();
	}

	/**
	 * A detail slot appeared. Baked settings parse strictly here — an
	 * unknown or malformed binding registers as null and renders the safe
	 * idle face instead of throwing. Replayed willAppear events (reconnect,
	 * wake) update in place without double-counting the surface.
	 */
	registerSlot(contextId: string, deviceId: string, rawSettings: unknown, cell: { column: number; row: number } | null, handle: SlotHandle): void {
		const binding = parseSlotBinding(rawSettings);
		const existing = this.slots.get(contextId);
		if (existing === undefined) {
			this.slots.set(contextId, { contextId, deviceId, binding, cell, handle, lastSvg: "" });
			this.navigator.surfaceSeen(deviceId);
		} else {
			existing.binding = binding;
			existing.cell = cell;
			existing.handle = handle;
			// A replayed appear (reconnect, wake) may come with the app's own
			// image cache cold: forget ours so the fresh handle gets a frame
			// even when the face bytes have not changed.
			existing.lastSvg = "";
		}
		this.refreshMirror(deviceId);
		this.requestRender(deviceId);
	}

	unregisterSlot(contextId: string): void {
		const slot = this.slots.get(contextId);
		if (slot !== undefined) {
			this.slots.delete(contextId);
			this.navigator.surfaceGone(slot.deviceId);
			this.refreshMirror(slot.deviceId);
		}
	}

	/**
	 * Recomputes the device's mirror Back slot: the READING slot whose
	 * cell matches the session's opener cell. Nav cells never mirror (the
	 * bindings differ), and a session without a known opener cell (older
	 * events, multi-action edge) simply has no mirror. The navigator
	 * repaints only when the value actually changes.
	 */
	private refreshMirror(deviceId: string): void {
		const state = this.navigator.stateFor(deviceId);
		if (state === undefined) {
			return;
		}
		let mirror: number | null = null;
		if (state.openerCell !== null) {
			for (const slot of this.slots.values()) {
				if (slot.deviceId === deviceId && slot.cell !== null && slot.binding !== null && slot.binding.slot === "reading" && slot.cell.column === state.openerCell.column && slot.cell.row === state.openerCell.row) {
					mirror = slot.binding.index;
					break;
				}
			}
		}
		this.navigator.setMirrorSlotIndex(deviceId, mirror);
	}

	/** True when this context is a registered detail slot. */
	hasSlot(contextId: string): boolean {
		return this.slots.has(contextId);
	}

	/** Routes a slot press. Everything acts on key-down, like the opener. */
	slotKeyDown(contextId: string): void {
		const slot = this.slots.get(contextId);
		if (slot === undefined || slot.binding === null) {
			return;
		}
		const binding = slot.binding;
		if (binding.slot === "back") {
			// Back works with or without state (restart inside the profile).
			void this.navigator.leave(slot.deviceId);
			return;
		}
		const state = this.navigator.stateFor(slot.deviceId);
		if (state === undefined) {
			return;
		}
		if (binding.slot === "previous") {
			this.navigator.pagePrevious(slot.deviceId);
		} else if (binding.slot === "next") {
			this.navigator.pageNext(slot.deviceId);
		} else if (binding.slot === "reading") {
			if (state.mirrorSlotIndex !== null && binding.index === state.mirrorSlotIndex) {
				// The mirror Back tile: the finger that pressed in presses
				// right back out, same cell, same key.
				void this.navigator.leave(slot.deviceId);
				return;
			}
			const key = this.navigator.pageFor(state).slots[binding.index];
			if (key !== undefined) {
				this.navigator.cycleSlotStat(slot.deviceId, key);
			}
		}
		// "title" is informational; a press does nothing.
	}

	/** Poller tick: re-resolve live sessions, then repaint every surface.
	 * Gated on the DATA actually changing: HWiNFO publishes about every
	 * two seconds while the poll option goes down to 250 ms, so most ticks
	 * carry the identical snapshot and every face would compose to the
	 * identical bytes the dedupe then drops. Skipping those passes outright
	 * removes the compose cost too (tick-signature.ts owns what "changed"
	 * means; the provider's valueRevision keeps sub-second HWiNFO polls
	 * visible through pollTime's one-second grain). Every face is a pure
	 * function of this signature: session changes repaint via
	 * requestRender, theme changes via renderAll, new slots via
	 * registerSlot, and no status face renders wall-clock time (staleForMs
	 * is deliberately not displayed).
	 */
	private lastTickSignature = "";

	onTick(status: PollerStatus): void {
		const signature = tickSignature(status);
		if (signature === this.lastTickSignature) {
			return;
		}
		this.lastTickSignature = signature;
		const snapshot: SensorSnapshot | null = status.state === "unavailable" ? null : status.snapshot;
		for (const deviceId of this.navigator.activeDeviceIds()) {
			this.navigator.refresh(deviceId, snapshot);
		}
		this.renderAll(status);
	}

	renderAll(status: PollerStatus = this.deps.getStatus()): void {
		// A full pass supersedes any queued partial flush.
		this.dirty.clear();
		const devices = new Set<string>();
		for (const slot of this.slots.values()) {
			devices.add(slot.deviceId);
		}
		for (const deviceId of devices) {
			this.renderDevice(deviceId, status);
		}
	}

	renderDevice(deviceId: string, status: PollerStatus = this.deps.getStatus()): void {
		const state = this.navigator.stateFor(deviceId);
		const page = state === undefined ? null : this.navigator.pageFor(state);
		let ctx: DetailFaceContext | null = null;
		if (state !== undefined) {
			try {
				ctx = this.contextFor(state);
			} catch (err) {
				// A theme-config failure degrades this pass to idle faces
				// instead of aborting the whole device (and, via onChanged,
				// a caller like enter()).
				this.deps.log?.warn(`detail presentation context failed: ${String(err)}`);
			}
		}
		for (const slot of this.slots.values()) {
			if (slot.deviceId !== deviceId) {
				continue;
			}
			let svg: string;
			try {
				svg = this.composeSlot(slot, state, page, ctx, status);
			} catch (err) {
				// One bad face must not take down the tick for the whole page.
				this.deps.log?.warn(`detail slot render failed (${slot.contextId}): ${String(err)}`);
				continue;
			}
			if (svg !== slot.lastSvg) {
				slot.lastSvg = svg;
				slot.handle.setImage(svg);
			}
		}
	}

	/** The per-device presentation context (resolved once per pass). */
	private contextFor(state: DeviceDetailState): DetailFaceContext {
		return {
			config: loadThemes(),
			deckThemeId: getDeckTheme(),
			typeAccents: typeAccentsEnabled(),
			measure: measureOptionsFrom(state.presentation),
			text: effectiveTextFor(state.presentation)
		};
	}

	private composeSlot(slot: SlotRegistration, state: DeviceDetailState | undefined, page: DetailPage | null, ctx: DetailFaceContext | null, status: PollerStatus): string {
		const binding = slot.binding;
		if (binding === null) {
			// Unknown or future baked settings: a quiet, safe face.
			return composeIdleFace("reading");
		}
		if (state === undefined || page === null || ctx === null) {
			if (binding.slot !== "back" && this.navigator.recentlyLeft(slot.deviceId)) {
				// Just left: black through the app's switch beat, so the
				// image cache replays black on the next entry instead of an
				// idle wall. The honest idle faces return on the first tick
				// past the beat (a no-op switch, a restart-shaped surface).
				return composeVoidFace();
			}
			return composeIdleFace(binding.slot === "reading" ? "reading" : binding.slot);
		}
		switch (binding.slot) {
			case "back":
				return composeBackFace(state, status, ctx);
			case "title":
				return composeTitleFace(state, page, ctx);
			case "previous":
				return composePagerFace("previous", page, state, ctx);
			case "next":
				return composePagerFace("next", page, state, ctx);
			case "reading": {
				if (state.mirrorSlotIndex !== null && binding.index === state.mirrorSlotIndex) {
					// The mirror Back tile renders exactly like the canonical
					// Back: the opener's live reading plus the return mark.
					return composeBackFace(state, status, ctx);
				}
				const key = page.slots[binding.index];
				const mode = key === undefined ? "current" : this.navigator.statModeFor(state, key);
				return composeReadingFace(state, key, mode, status, ctx);
			}
		}
	}
}
