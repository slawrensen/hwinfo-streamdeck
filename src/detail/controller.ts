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
import { composeBackFace, composeIdleFace, composePagerFace, composeReadingFace, composeTitleFace, type DetailFaceContext } from "./detail-faces";
import type { DetailPage } from "./detail-group";
import type { DetailNavigator, DeviceDetailState } from "./navigation";
import { parseSlotBinding, type DetailSlotBinding } from "./slot-bindings";

export type SlotHandle = {
	setImage(svg: string): void;
};

type SlotRegistration = {
	readonly contextId: string;
	readonly deviceId: string;
	binding: DetailSlotBinding | null;
	handle: SlotHandle;
	lastSvg: string;
};

type ControllerDeps = {
	getStatus: () => PollerStatus;
	log?: { warn(msg: string): void };
};

export class DetailController {
	private readonly slots = new Map<string, SlotRegistration>();

	constructor(
		private readonly navigator: DetailNavigator,
		private readonly deps: ControllerDeps
	) {}

	/**
	 * A detail slot appeared. Baked settings parse strictly here — an
	 * unknown or malformed binding registers as null and renders the safe
	 * idle face instead of throwing. Replayed willAppear events (reconnect,
	 * wake) update in place without double-counting the surface.
	 */
	registerSlot(contextId: string, deviceId: string, rawSettings: unknown, handle: SlotHandle): void {
		const binding = parseSlotBinding(rawSettings);
		const existing = this.slots.get(contextId);
		if (existing === undefined) {
			this.slots.set(contextId, { contextId, deviceId, binding, handle, lastSvg: "" });
			this.navigator.surfaceSeen(deviceId);
		} else {
			existing.binding = binding;
			existing.handle = handle;
		}
		this.renderDevice(deviceId);
	}

	unregisterSlot(contextId: string): void {
		const slot = this.slots.get(contextId);
		if (slot !== undefined) {
			this.slots.delete(contextId);
			this.navigator.surfaceGone(slot.deviceId);
		}
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
			const key = this.navigator.pageFor(state).slots[binding.index];
			if (key !== undefined) {
				this.navigator.cycleSlotStat(slot.deviceId, key);
			}
		}
		// "title" is informational; a press does nothing.
	}

	/** Poller tick: re-resolve live sessions, then repaint every surface. */
	onTick(status: PollerStatus): void {
		const snapshot: SensorSnapshot | null = status.state === "unavailable" ? null : status.snapshot;
		for (const deviceId of this.navigator.activeDeviceIds()) {
			this.navigator.refresh(deviceId, snapshot);
		}
		this.renderAll(status);
	}

	renderAll(status: PollerStatus = this.deps.getStatus()): void {
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
		const ctx = state === undefined ? null : this.contextFor(state);
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
				const key = page.slots[binding.index];
				const mode = key === undefined ? "current" : this.navigator.statModeFor(state, key);
				return composeReadingFace(state, key, mode, status, ctx);
			}
		}
	}
}
