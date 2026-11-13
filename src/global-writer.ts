/**
 * The plugin's one write path for the global settings fields the settings
 * panel edits through the plugin (readingLinks and calculatedReadings):
 * a serialized compare-and-swap on a single field.
 *
 * Every commit, in arrival order and one at a time:
 *   1. re-reads the latest global document (never a copy a panel or an
 *      earlier commit held),
 *   2. compares the field's signature with the `baseSignature` the panel
 *      saw, and refuses a stale one with the typed reason "stale-basis"
 *      (nothing is written),
 *   3. hands the field's raw value to an edit that changes only the
 *      targeted row and returns the next raw value (or a typed refusal),
 *   4. writes the latest document with that one field replaced, so every
 *      other field, known or not, rides along exactly as it was read.
 *
 * Opening, searching, previewing and cancelling never reach this module:
 * only an explicit apply message does. Pure and SDK-free (the store is
 * injected), so the unit suite proves the queue, the refusal and the
 * preservation without a socket.
 */
import { createHash } from "node:crypto";

import type { JsonObject, JsonValue } from "@elgato/utils";

import { sortedJson } from "./sorted-json";

/**
 * Stable JSON: object keys sorted, arrays in order, undefined object
 * members dropped (as JSON.stringify drops them). The Stream Deck app
 * re-serializes plugin-to-panel messages with sorted keys, so a signature
 * must not depend on key order. `undefined` itself (an absent field) has
 * its own spelling, distinct from null.
 */
export function canonicalJson(value: unknown): string {
	return value === undefined ? "\u0000absent" : (sortedJson(value) ?? "null");
}

/** The compare-and-swap basis of a raw field value: a short digest of its
 * canonical JSON. Any change to the stored value, an unknown row or field
 * included, changes it. */
export function globalFieldSignature(value: unknown): string {
	return createHash("sha256").update(canonicalJson(value)).digest("base64url").slice(0, 22);
}

export interface GlobalSettingsStore {
	/** The latest global document (a fresh read, never a cached copy). */
	read(): Promise<JsonObject>;
	/** Writes the whole document. */
	write(doc: JsonObject): Promise<void>;
}

/** What an edit decided: the field's next raw value, or why not. */
export type GlobalFieldEditOutcome<R extends string, D> =
	| { readonly ok: true; readonly next: JsonValue; readonly detail?: D }
	| { readonly ok: false; readonly reason: R; readonly detail?: D };

export type GlobalFieldEdit<R extends string, D> = (current: unknown, latest: Readonly<JsonObject>) => GlobalFieldEditOutcome<R, D>;

/** Refusals the writer itself produces, beside an edit's own. */
export type GlobalWriterRefusal = "stale-basis" | "read-failed" | "write-failed";

export type GlobalCommitResult<R extends string, D> =
	| {
			readonly ok: true;
			readonly field: string;
			/** The raw value the edit replaced (null when absent; see previousPresent). */
			readonly previous: JsonValue;
			readonly previousPresent: boolean;
			readonly previousSignature: string;
			readonly next: JsonValue;
			readonly signature: string;
			readonly detail?: D;
	  }
	| {
			readonly ok: false;
			readonly field: string;
			readonly reason: R | GlobalWriterRefusal;
			/** The field's signature as read (empty when the read failed). */
			readonly signature: string;
			readonly detail?: D;
	  };

export class GlobalSettingsWriter {
	private queue: Promise<unknown> = Promise.resolve();

	constructor(private readonly store: GlobalSettingsStore) {}

	/**
	 * Queues one compare-and-swap of `field`. Commits run strictly one after
	 * another, so a second commit always reads the document the first one
	 * wrote: two panels holding the same basis get one success and one
	 * "stale-basis", never a lost update.
	 */
	commit<R extends string, D = never>(field: string, baseSignature: string, edit: GlobalFieldEdit<R, D>): Promise<GlobalCommitResult<R, D>> {
		const run = async (): Promise<GlobalCommitResult<R, D>> => {
			let latest: JsonObject;
			try {
				latest = await this.store.read();
			} catch {
				return { ok: false, field, reason: "read-failed", signature: "" };
			}
			if (typeof latest !== "object" || latest === null || Array.isArray(latest)) latest = {};
			const current = latest[field];
			const signature = globalFieldSignature(current);
			if (signature !== baseSignature) return { ok: false, field, reason: "stale-basis", signature };
			let outcome: GlobalFieldEditOutcome<R, D>;
			try {
				outcome = edit(current, latest);
			} catch {
				// An edit is pure planning; a throw is a defect, never a write.
				return { ok: false, field, reason: "write-failed", signature };
			}
			if (!outcome.ok) return { ok: false, field, reason: outcome.reason, signature, ...(outcome.detail === undefined ? {} : { detail: outcome.detail }) };
			const doc: JsonObject = { ...latest, [field]: outcome.next };
			try {
				await this.store.write(doc);
			} catch {
				return { ok: false, field, reason: "write-failed", signature };
			}
			return {
				ok: true,
				field,
				previous: current === undefined ? null : (current as JsonValue),
				previousPresent: current !== undefined,
				previousSignature: signature,
				next: outcome.next,
				signature: globalFieldSignature(outcome.next),
				...(outcome.detail === undefined ? {} : { detail: outcome.detail })
			};
		};
		const result = this.queue.then(run, run);
		this.queue = result.catch(() => undefined);
		return result;
	}
}
