/**
 * Binds the two plugin-written global editors to the SDK and the poller:
 * one compare-and-swap writer over the app's global settings (a fresh read
 * per commit, the write adopted and applied at once because the app does
 * not echo a plugin's own write), the poller's held views, the session
 * catalog, and the one-shot read of the provider the poller is not using.
 * Created on the first panel request, so a deck whose panels never open
 * the editors pays nothing.
 */
import streamDeck from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { globalSettingsWriter, latestGlobalSettings } from "../global-settings";
import { monotonicNow } from "../clock";
import { mintCalculatedId } from "../hwinfo/calculated";
import { GadgetRegistryProvider } from "../hwinfo/gadget-registry";
import { SharedMemoryProvider, type SnapshotProvider, type SnapshotSource } from "../hwinfo/provider";
import { HwinfoError, type SensorSnapshot } from "../hwinfo/types";
import { poller } from "../poller";
import { getDataUnits } from "../ui/theme-store";
import { CalcEditor } from "./calc-editor";
import { EditorService } from "./editor-service";
import { LinkEditor } from "./link-editor";

/**
 * One read of a provider the poller is not using: a separate open, read
 * and close. It never touches the poller's provider, its evidence, rings,
 * history or ticks. Throws HwinfoError.
 */
export function peekProvider(source: SnapshotSource): SensorSnapshot {
	const provider: SnapshotProvider = source === "gadget" ? GadgetRegistryProvider.open() : SharedMemoryProvider.open();
	try {
		// One immediate retry, as the Gadget open does: a scan skipped for a
		// momentary interleave is usually whole on the next read.
		const snapshot = provider.read() ?? provider.read();
		if (snapshot === null) throw new HwinfoError("busy", "The readings changed during the read.");
		return snapshot;
	} finally {
		provider.close();
	}
}

let service: EditorService | undefined;

function editorService(): EditorService {
	if (service !== undefined) return service;
	const writer = globalSettingsWriter();
	const links = new LinkEditor({
		status: () => poller.getStatus(),
		raw: () => poller.getRawObservation(),
		mode: () => poller.getSourceMode(),
		catalog: poller.catalog,
		now: () => monotonicNow(),
		globals: () => latestGlobalSettings(),
		peek: (provider) => peekProvider(provider),
		dataUnits: () => getDataUnits()
	});
	const calc = new CalcEditor({
		status: () => poller.getStatus(),
		linked: () => poller.getLinkedObservation(),
		globals: () => latestGlobalSettings(),
		dataUnits: () => getDataUnits(),
		mintId: () => mintCalculatedId()
	});
	service = new EditorService({
		links,
		calc,
		writer,
		send: (payload) => {
			void streamDeck.ui.sendToPropertyInspector(payload);
		}
	});
	return service;
}

/** Answers a panel message for the link or calculation editor; false when
 * the message is not one of theirs. */
export function handleEditorRequest(payload: Readonly<Record<string, JsonValue | undefined>>): boolean {
	const event = payload.event;
	if (event !== "getLinks" && event !== "applyLink" && event !== "getCalculated" && event !== "previewCalculated" && event !== "applyCalculated") return false;
	return editorService().handle(payload);
}
