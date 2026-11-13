/** Maps poller/selection states to key art and short dial texts. */
import { t } from "../i18n";
import type { PollerStatus } from "../poller";
import type { StatusKeyOptions } from "./key-renderer";

const BLUE = "#4cc2ff";
const AMBER = "#f5a623";
const RED = "#ff5d52";
/** The "no value" glyph a face draws (not a word, so not in the catalog). */
const NO_VALUE = "—";

/**
 * Key art for a non-data state, or `null` when live data is available.
 * Stale counts as a problem state; the mission of these screens is to tell
 * the user exactly what to do next.
 */
export function statusScreen(status: PollerStatus): StatusKeyOptions | null {
	if (status.state === "ok") {
		return null;
	}
	if (status.state === "stale") {
		// Sub-line matches the source in use (like the dial text + PI hint).
		return { icon: "clock", accent: AMBER, lines: status.source === "gadget" ? [t("face.staleGadget.title"), t("face.staleGadget.hint")] : [t("face.staleShared.title"), t("face.staleShared.hint")] };
	}
	switch (status.reason) {
		case "not-running":
			return { icon: "power", accent: BLUE, lines: [t("face.notRunning.title"), t("face.notRunning.hint")] };
		case "busy":
			// Both shared-memory contention and a changing Gadget scan can
			// reach this reason; neither proves the producer's process state.
			return { icon: "clock", accent: AMBER, lines: [t("face.busy.title"), t("face.busy.hint")] };
		case "gadget-empty":
			return { icon: "target", accent: AMBER, lines: [t("face.gadgetEmpty.title"), t("face.gadgetEmpty.hint")] };
		case "disabled":
			return { icon: "warning", accent: AMBER, lines: [t("face.disabled.title"), t("face.disabled.hint")] };
		case "access-denied":
			return { icon: "lock", accent: RED, lines: [t("face.accessDenied.title"), t("face.accessDenied.hint")] };
		case "unsupported-platform":
			return { icon: "warning", accent: RED, lines: [t("face.unsupported.title"), t("face.unsupported.hint")] };
		case "bridge-failed":
			// A bridge load failure does not identify damage or a security block.
			return { icon: "warning", accent: RED, lines: [t("face.bridgeFailed.title"), t("face.bridgeFailed.hint")] };
		default:
			return { icon: "warning", accent: RED, lines: [t("face.sourceError.title"), t("face.sourceError.hint")] };
	}
}

export function noSelectionScreen(): StatusKeyOptions {
	return { icon: "target", accent: BLUE, lines: [t("face.noSelection.title"), t("face.noSelection.hint")] };
}

export function missingReadingScreen(): StatusKeyOptions {
	return { icon: "question", accent: AMBER, lines: [t("face.missing.title"), t("face.missing.hint")] };
}

/** The placeholder row label for a configured key the snapshot does not
 * publish (its value is the one permitted em dash). */
export function missingRowLabel(): string {
	return t("face.missing.title");
}

/** Short two-line text for the Stream Deck + touchscreen. */
export function statusDialText(status: PollerStatus): { title: string; value: string } | null {
	if (status.state === "ok") {
		return null;
	}
	if (status.state === "stale") {
		// Match the recovery hint to the source in use, like statusScreen and
		// statusSentence do; a gadget-source dial must not be told to check
		// Shared Memory sharing that isn't even the source it's reading from.
		return status.source === "gadget" ? { title: t("dial.staleGadget.title"), value: t("dial.staleGadget.value") } : { title: t("dial.staleShared.title"), value: t("dial.staleShared.value") };
	}
	switch (status.reason) {
		case "not-running":
			return { title: t("dial.notRunning.title"), value: t("dial.notRunning.value") };
		case "busy":
			return { title: t("dial.busy.title"), value: t("dial.busy.value") };
		case "gadget-empty":
			return { title: t("dial.gadgetEmpty.title"), value: t("dial.gadgetEmpty.value") };
		case "disabled":
			return { title: t("dial.disabled.title"), value: t("dial.disabled.value") };
		case "access-denied":
			return { title: t("dial.accessDenied.title"), value: t("dial.accessDenied.value") };
		case "unsupported-platform":
			return { title: t("dial.unsupported.title"), value: NO_VALUE };
		case "bridge-failed":
			return { title: t("dial.bridgeFailed.title"), value: t("dial.bridgeFailed.value") };
		default:
			return { title: t("dial.sourceError.title"), value: t("dial.sourceError.value") };
	}
}

/** The Gadget-specific withholding notes appended to a hint sentence. A
 * shared name is withheld only while two ticked readings carry it, so the
 * remedy is to act on one of them. */
function gadgetWithheldNotes(snapshot: { blockedReadingCount?: number; contradictoryReadingCount?: number }): string {
	return (snapshot.blockedReadingCount ? ` ${t("sentence.gadgetWithheldNames")}` : "") + (snapshot.contradictoryReadingCount ? ` ${t("sentence.gadgetContradictory")}` : "");
}

/** Human sentence for PI hints. */
export function statusSentence(status: PollerStatus): string {
	if (status.state === "ok") {
		return status.source === "gadget" ? t("sentence.gadgetOk") + gadgetWithheldNotes(status.snapshot) : "";
	}
	if (status.state === "stale") {
		return status.source === "gadget"
			? t("sentence.gadgetStale") + gadgetWithheldNotes(status.snapshot)
			: t("sentence.sharedStale", { seconds: Math.round(status.staleForMs / 1000) });
	}
	switch (status.reason) {
		case "not-running":
			return t("sentence.notRunning");
		case "busy":
			return t("sentence.busy");
		case "gadget-empty":
			return t("sentence.gadgetEmpty");
		case "disabled":
			return t("sentence.disabled");
		case "access-denied":
			return t("sentence.accessDenied");
		case "unsupported-platform":
			return t("sentence.unsupported");
		case "bridge-failed":
			return t("sentence.bridgeFailed");
		default:
			return t("sentence.sourceError");
	}
}

/** Effective key label; spec truncation happens inside the renderer.
 * Settings are untyped JSON at runtime: a non-string custom label (a
 * hand-edited profile, a future version's shape) degrades to the fallback
 * instead of throwing mid-tick. */
export function keyLabel(custom: unknown, fallback: string): string {
	return typeof custom === "string" && custom.trim() !== "" ? custom.trim() : fallback;
}
