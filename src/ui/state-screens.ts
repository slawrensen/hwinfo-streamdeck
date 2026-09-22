/** Maps poller/selection states to key art and short dial texts. */
import type { PollerStatus } from "../poller";
import type { StatusKeyOptions } from "./key-renderer";

const BLUE = "#4cc2ff";
const AMBER = "#f5a623";
const RED = "#ff5d52";

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
		return { icon: "clock", accent: AMBER, lines: [status.source === "gadget" ? "Age unknown" : "Not updating", status.source === "gadget" ? "check Gadget" : "check sharing"] };
	}
	switch (status.reason) {
		case "not-running":
			return { icon: "power", accent: BLUE, lines: ["Start HWiNFO", "not detected"] };
		case "busy":
			// Both shared-memory contention and a changing Gadget scan can
			// reach this reason; neither proves the producer's process state.
			return { icon: "clock", accent: AMBER, lines: ["Source busy", "retrying"] };
		case "gadget-empty":
			return { icon: "target", accent: AMBER, lines: ["Tick sensors", "in Gadget"] };
		case "disabled":
			return { icon: "warning", accent: AMBER, lines: ["Shared Memory", "is off"] };
		case "access-denied":
			return { icon: "lock", accent: RED, lines: ["Access denied", "open settings"] };
		case "unsupported-platform":
			return { icon: "warning", accent: RED, lines: ["Needs x64", "Windows"] };
		case "bridge-failed":
			// A bridge load failure does not identify damage or a security block.
			return { icon: "warning", accent: RED, lines: ["Bridge failed", "reinstall"] };
		default:
			return { icon: "warning", accent: RED, lines: ["Source error", "open settings"] };
	}
}

export function noSelectionScreen(): StatusKeyOptions {
	return { icon: "target", accent: BLUE, lines: ["Pick a sensor", "in settings"] };
}

export function missingReadingScreen(): StatusKeyOptions {
	return { icon: "question", accent: AMBER, lines: ["Sensor missing", "pick again"] };
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
		return { title: status.source === "gadget" ? "Age unknown" : "No new data", value: status.source === "gadget" ? "check Gadget" : "check sharing" };
	}
	switch (status.reason) {
		case "not-running":
			return { title: "Start HWiNFO", value: "not detected" };
		case "busy":
			return { title: "Source busy", value: "retrying" };
		case "gadget-empty":
			return { title: "Gadget empty", value: "tick sensors" };
		case "disabled":
			return { title: "Shared Memory off", value: "enable in HWiNFO" };
		case "access-denied":
			return { title: "Access denied", value: "open settings" };
		case "unsupported-platform":
			return { title: "Needs x64 Windows", value: "—" };
		case "bridge-failed":
			return { title: "Bridge failed", value: "reinstall it" };
		default:
			return { title: "Source error", value: "open settings" };
	}
}

/** The Gadget-specific withholding notes appended to a hint sentence. A
 * shared name is withheld only while two ticked readings carry it, so the
 * remedy is to act on one of them. */
function gadgetWithheldNotes(snapshot: { blockedReadingCount?: number; contradictoryReadingCount?: number }): string {
	return (snapshot.blockedReadingCount ? " Gadget rows with an incomplete name are withheld, and so are two ticked readings that share a source name and label (HWiNFO lists some twice, such as a fan in RPM and in percent). Untick or relabel one of the two in HWiNFO and the other comes back on its own." : "")
		+ (snapshot.contradictoryReadingCount ? " A Gadget row whose formatted value contradicts its raw value is withheld; the plugin log names the slot." : "");
}

/** Human sentence for PI hints. */
export function statusSentence(status: PollerStatus): string {
	if (status.state === "ok") {
		return status.source === "gadget" ? "Reading via HWiNFO's Gadget registry (current values only, no min/max/avg). A value change was observed; the registry has no producer timestamp. Auto switches providers; saved keys need explicit reading links to work across sources. Enable Shared Memory Support for stable hardware IDs." + gadgetWithheldNotes(status.snapshot) : "";
	}
	if (status.state === "stale") {
		return status.source === "gadget"
			? "Gadget freshness is unknown. Unchanged values may be steady readings or left by a killed or crashed HWiNFO. A successful registry read cannot distinguish them. Check HWiNFO and Gadget reporting, or use Shared Memory Support." + gadgetWithheldNotes(status.snapshot)
			: `No new Shared Memory measurement evidence for ${Math.round(status.staleForMs / 1000)}s. Check HWiNFO and Shared Memory Support; a busy connection can also prevent reads.`;
	}
	switch (status.reason) {
		case "not-running":
			return "The plugin could not open a sensor feed. Check that HWiNFO is running in Sensors-only mode with Shared Memory Support enabled, or enable Gadget reporting and tick the sensors you need.";
		case "busy":
			return "The sensor source was busy or changed during a read. The plugin retries automatically. If this persists, open settings and choose \"Copy support report\" for support.";
		case "gadget-empty":
			return "The Gadget registry is present but has no readable sensor rows. In HWiNFO, open Configure Sensors and the HWiNFO Gadget tab. Check Enable reporting to Gadget and tick \"Report value in Gadget\" for the readings you need.";
		case "disabled":
			return "HWiNFO reports Shared Memory Support as disabled. Re-enable it in HWiNFO Settings; the free version switches it off after 12 hours.";
		case "access-denied":
			return "Windows denied access needed to read the sensor source. Open settings and choose \"Copy support report\" for support. This error alone does not identify which access rule failed.";
		case "unsupported-platform":
			return "This plugin needs 64-bit (x64) Windows: HWiNFO's interfaces aren't readable on this system (macOS and Windows-on-ARM are unsupported).";
		case "bridge-failed":
			return "The native HWiNFO bridge (bin/hwsm.node) could not load. Reinstall the plugin from its release package. If Windows or security software reports a block, keep that report and the package hash for support. A load failure alone does not identify the cause.";
		default:
			return "The sensor source could not be opened or validated. Open settings and choose \"Copy support report\" for support.";
	}
}

/** Effective key label; spec truncation happens inside the renderer.
 * Settings are untyped JSON at runtime: a non-string custom label (a
 * hand-edited profile, a future version's shape) degrades to the fallback
 * instead of throwing mid-tick. */
export function keyLabel(custom: unknown, fallback: string): string {
	return typeof custom === "string" && custom.trim() !== "" ? custom.trim() : fallback;
}
