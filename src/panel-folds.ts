/**
 * Which settings-panel sections a person left open or folded, per kind of
 * panel, for as long as the plugin runs. A view preference, never a
 * setting: nothing here reaches any key's or dial's settings, and nothing
 * is written to disk, so a restart of the app or the plugin shows the
 * panels' defaults again.
 *
 * The panel cannot keep this itself: the Stream Deck app gives every
 * panel it opens (each key selected) fresh web storage, which survives
 * only a reload of that same panel (bench 2026-09-24). The plugin process
 * outlives the panels, so it holds the folds and hands them to each panel
 * that opens.
 *
 * Everything from a panel is salvaged per entry: only section ids of the
 * panel's shape with boolean values survive, junk is dropped, nothing
 * throws.
 */

export type PanelKind = "key" | "dial" | "control";
export type Folds = Record<string, boolean>;

const KINDS: readonly PanelKind[] = ["key", "dial", "control"];
const SECTION_ID = /^sec-[a-z]{1,24}$/;
/** More sections than any panel has; a bound on what a panel can store. */
const MAX_SECTIONS = 12;

export function panelKindOf(raw: unknown): PanelKind | undefined {
	return typeof raw === "string" && (KINDS as readonly string[]).includes(raw) ? (raw as PanelKind) : undefined;
}

export function salvageFolds(raw: unknown): Folds {
	const folds: Folds = {};
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return folds;
	for (const [id, open] of Object.entries(raw)) {
		if (Object.keys(folds).length >= MAX_SECTIONS) break;
		if (SECTION_ID.test(id) && typeof open === "boolean") folds[id] = open;
	}
	return folds;
}

export class PanelFoldMemory {
	private readonly byKind = new Map<PanelKind, Folds>();

	get(kind: PanelKind): Folds {
		return { ...(this.byKind.get(kind) ?? {}) };
	}

	/** Merges what a panel sent (salvaged) into one kind's folds. A merge,
	 * not a replace: a panel that gave up waiting for the plugin's answer
	 * knows only the sections toggled on it, and must not erase the rest. */
	set(kind: PanelKind, raw: unknown): void {
		this.byKind.set(kind, salvageFolds({ ...this.byKind.get(kind), ...salvageFolds(raw) }));
	}
}

/** The plugin's one memory, shared by every panel it serves. */
export const panelFolds = new PanelFoldMemory();
