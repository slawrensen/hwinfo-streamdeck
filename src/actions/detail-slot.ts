/**
 * The hidden detail-slot action. Every cell of a bundled detail profile
 * carries one instance with a static role binding baked into its
 * settings ({ slot: "back" } ... { slot: "reading", index: n }); the
 * profile itself never contains reading keys or sensor data. The action
 * stays thin: it registers the slot with the detail controller, retains
 * the one shared poller while visible, and routes presses — rendering
 * and state all live behind the controller.
 */
import { action, SingletonAction, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";

import type { DetailController } from "../detail/controller";
import { poller } from "../poller";

/** The baked binding shape; parsed strictly by the controller. */
type DetailSlotSettings = {
	slot?: string;
	index?: number;
};

@action({ UUID: "com.lawrensen.hwinfo.detail-slot" })
export class DetailSlotAction extends SingletonAction<DetailSlotSettings> {
	/** Contexts that have appeared (guards the retain against replays). */
	private readonly appeared = new Set<string>();

	constructor(private readonly controller: DetailController) {
		super();
	}

	override onWillAppear(ev: WillAppearEvent<DetailSlotSettings>): void {
		// Stream Deck can replay willAppear without an intervening
		// willDisappear (reconnect, wake): retain only on the first sighting,
		// and let the controller refresh the handle in place.
		if (!this.appeared.has(ev.action.id)) {
			this.appeared.add(ev.action.id);
			poller.retain();
		}
		const act = ev.action;
		this.controller.registerSlot(act.id, act.device.id, ev.payload.settings, {
			setImage: (svg: string): void => {
				void act.setImage(`data:image/svg+xml,${encodeURIComponent(svg)}`);
			}
		});
	}

	override onWillDisappear(ev: WillDisappearEvent<DetailSlotSettings>): void {
		if (this.appeared.delete(ev.action.id)) {
			this.controller.unregisterSlot(ev.action.id);
			poller.release();
		}
	}

	override onKeyDown(ev: KeyDownEvent<DetailSlotSettings>): void {
		this.controller.slotKeyDown(ev.action.id);
	}
}
