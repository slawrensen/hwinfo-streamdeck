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

import { GlobalSettingsWriter } from "./global-writer";

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

const written: Array<(doc: JsonObject) => void> = [];

/**
 * The newest global document the plugin knows: the last one delivered, or
 * the last one the plugin wrote itself, whichever came later. The app
 * never echoes a plugin's own setGlobalSettings back to it, so without
 * this a plugin-side edit (the panel's link and calculation editors) would
 * not be in force until the next unrelated delivery. Undefined before the
 * first delivery. For reads that must not wait on a round trip, such as a
 * key press.
 */
export function latestGlobalSettings(): JsonObject | undefined {
	return latest;
}

/** Runs `fn` with every document the plugin writes itself (after the write
 * went out), so it is applied exactly like a delivery. */
export function onGlobalSettingsWritten(fn: (doc: JsonObject) => void): void {
	written.push(fn);
}

/** Writes the whole global document, then adopts it as the newest known
 * document and applies it through the onGlobalSettingsWritten listeners. */
export async function writeGlobalSettings(doc: JsonObject): Promise<void> {
	await streamDeck.settings.setGlobalSettings(doc);
	latest = doc;
	for (const fn of written) {
		try {
			fn(doc);
		} catch (err) {
			console.error("global settings listener failed", err);
		}
	}
}

let writer: GlobalSettingsWriter | undefined;

/**
 * The plugin's one serialized writer of the global settings (global-writer.ts):
 * a fresh read per commit, one field replaced, every other field kept, the
 * write applied through the onGlobalSettingsWritten listeners. Every
 * plugin-side global write goes through it (the link and calculation
 * editors), so no write is built from a document another
 * one has already replaced.
 */
export function globalSettingsWriter(): GlobalSettingsWriter {
	writer ??= new GlobalSettingsWriter({ read: () => readGlobalSettings<JsonObject>(), write: (doc) => writeGlobalSettings(doc) });
	return writer;
}
