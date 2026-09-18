/** Gadget has names, but no hardware IDs. Never number duplicate names. */
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { HwinfoError } from "./types";

const hash = (text: string): string => createHash("sha256").update(text).digest("hex");

/** The exact spellings 1.6 and earlier minted for a registry slot that had
 * no label. A live label spelled the same way cannot be told from such a
 * slot selection, so it gets a tagged key and no legacy alias. */
function isLegacyFallbackLabel(label: string): boolean {
	const fallback = /^Reading (0|[1-9]\d*)$/.exec(label);
	return fallback !== null && fallback[0] === label && Number(fallback[1]) < 1024;
}

/** Keep ordinary saved keys, including spaces. Reserved characters use a
 * separate namespace that cannot impersonate a legacy suffix or colon
 * partition. Literal names matching the old missing-label fallback use a
 * tagged tuple: an old slot selection cannot become a genuine named reading
 * on upgrade, even when its incomplete identity was never observed here.
 * The provider republishes a 1.6 spelling as a checked alias only where it
 * is unambiguous (see legacyGadgetKey); nothing is inferred from names. */
export function gadgetReadingKey(sensor: string, label: string): string {
	if (isLegacyFallbackLabel(label)) {
		return `g2:${Buffer.from(JSON.stringify(["named", sensor, label])).toString("base64url")}`;
	}
	return /[:~\r\n]/.test(sensor + label)
		? `g2:${Buffer.from(JSON.stringify([sensor, label])).toString("base64url")}`
		: `g:${sensor}:${label}`;
}

/**
 * The key 1.6 and earlier saved for this row when it differs from the
 * current one: "g:<source>:<label>" for names carrying a colon (HWiNFO's
 * standard "CPU [#0]: <model>" source names all do). Null when the current
 * key is that spelling already, when the label is a legacy fallback
 * spelling, or when a name carries a tilde: 1.6 spelled its duplicate
 * copies "<key>~n", so a literal tilde could impersonate an old duplicate
 * selection and stays unaliased. A caller publishes the legacy key as an
 * alias only when exactly one current row renders to it and no live row
 * owns it, so an old selection keeps resolving without ever choosing
 * between two readings.
 */
export function legacyGadgetKey(sensor: string, label: string): string | null {
	if (isLegacyFallbackLabel(label) || /~/.test(sensor + label)) return null;
	const legacy = `g:${sensor}:${label}`;
	return gadgetReadingKey(sensor, label) === legacy ? null : legacy;
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
