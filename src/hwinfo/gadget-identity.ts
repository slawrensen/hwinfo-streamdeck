/** Gadget has names, but no hardware IDs. Never number duplicate names. */
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { HwinfoError } from "./types";

const hash = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Keep ordinary saved keys, including spaces. Reserved characters use a
 * separate namespace that cannot impersonate a legacy suffix or colon
 * partition. No aliases from those ambiguous legacy strings. */
export function gadgetReadingKey(sensor: string, label: string): string {
	return /[:~\r\n]/.test(sensor + label)
		? `g2:${Buffer.from(JSON.stringify([sensor, label])).toString("base64url")}`
		: `g:${sensor}:${label}`;
}

/** Append-only local deny list of name hashes, never values. Remember
 * observed ambiguity before returning a snapshot, so removing a duplicate
 * and restarting cannot make the remaining reading adopt its name again.
 * Processes share the journal; reread it before each scan. History before
 * the first observation cannot be reconstructed. */
export class GadgetIdentityGuard {
	private readonly file: string;

	constructor(subkey: string) {
		this.file = process.env.HWINFO_GADGET_IDENTITY_FILE || join(process.env.LOCALAPPDATA || tmpdir(), "HWiNFO Sensors", `gadget-identity-${hash(subkey.toLowerCase())}.jsonl`);
	}

	blocked(keys: readonly string[]): ReadonlySet<string> {
		try {
			let text = "";
			try {
				if (statSync(this.file).size > 1024 * 1024) throw new Error("identity journal exceeds 1 MiB");
				text = readFileSync(this.file, "utf8");
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
			}
			if (text !== "" && !/^(?:[a-f0-9]{64}\n)+$/.test(text)) throw new Error("invalid identity journal");
			const denied = new Set(text.split("\n").filter(Boolean));
			const seen = new Set<string>();
			const additions = new Set<string>();
			for (const key of keys) {
				const id = hash(key);
				if (seen.has(id) && !denied.has(id)) additions.add(id);
				seen.add(id);
			}
			if (additions.size > 0) {
				mkdirSync(dirname(this.file), { recursive: true });
				appendFileSync(this.file, [...additions].map((id) => `${id}\n`).join(""), { encoding: "utf8", flush: true });
				for (const id of additions) denied.add(id);
			}
			return new Set(keys.filter((key) => denied.has(hash(key))));
		} catch {
			throw new HwinfoError("invalid", "Gadget identity history could not be read or saved. Restore the local identity journal or use Shared Memory Support.");
		}
	}
}
