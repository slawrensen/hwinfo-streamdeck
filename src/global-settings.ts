/**
 * The plugin's global settings as last delivered.
 *
 * The app answers a getGlobalSettings request with the same
 * didReceiveGlobalSettings event it sends for every change, so the
 * listeners that apply settings see the reply like any other delivery. A
 * newer document can arrive right behind the reply (two frames in one
 * socket read) and reach those listeners before the code awaiting the
 * reply resumes. Code that awaited a read therefore acts on the latest
 * document, never on the reply it was handed, or it would apply or write
 * back settings older than ones already delivered (external review AX61).
 */
import streamDeck from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

let latest: JsonObject | undefined;
let deliveries = 0;

// Registered on import, ahead of any read, so every delivery is seen
// whichever listeners apply it.
streamDeck.settings.onDidReceiveGlobalSettings((ev) => {
	latest = ev.settings;
	deliveries++;
});

/** Reads the global settings: the latest document delivered while the read
 * was out (the reply itself unless a newer one followed it). A document
 * delivered before the read began never stands in for the reply. */
export async function readGlobalSettings<T extends JsonObject>(): Promise<T> {
	const before = deliveries;
	const reply = await streamDeck.settings.getGlobalSettings<T>();
	return (deliveries > before && latest !== undefined ? latest : reply) as T;
}
