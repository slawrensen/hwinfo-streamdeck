/**
 * Dial command dispatch: the HWiNFO Control key action publishes commands
 * here and the Sensor Dial action registers the one handler that applies
 * them to its matching instances. A plain registration instead of an event
 * emitter keeps the return channel: the control key learns how many dials a
 * command actually reached, so it can show the ok tick or the alert icon.
 *
 * Commands are explicit (pause vs resume vs toggle) so a Multi Action can
 * be made idempotent, and the command carries its own target: the key that
 * sends it may sit on a different device (a pedal driving a deck's dials),
 * so the sender's physical device is never consulted.
 */
import type { ResetScope } from "./controls";

const CONTROL_COMMANDS = [
	"next",
	"prev",
	"nextGroup",
	"prevGroup",
	"cycleStat",
	"showCurrent",
	"showMin",
	"showMax",
	"showAvg",
	"pauseCycle",
	"resumeCycle",
	"toggleCycle",
	"pin",
	"unpin",
	"togglePin",
	"backToCurrent",
	"resetStats",
	// Append-only. A snooze silences the alerts a dial shows now, at their
	// current level, until they recover, escalate or the time runs out.
	"snoozeAlerts",
	"unsnoozeAlerts",
	// Strip Display commands (appended): they reach strip groups only, by the
	// group's own Link ID, and change the strip's view for this session.
	"stripLive",
	"stripInspect",
	"stripToggleInspect",
	"stripWindowNext",
	"stripWindowPrev",
	"stripSeriesNext",
	"stripSeriesPrev",
	// Strip Screens (appended): the next or previous screen (both wrap, so
	// one key can cycle), and the first screen (an idempotent home for a
	// Multi Action). A strip with one screen counts as reached and stays.
	"stripScreenNext",
	"stripScreenPrev",
	"stripScreenFirst"
] as const;

export type ControlCommandId = (typeof CONTROL_COMMANDS)[number];

const STRIP_COMMANDS = ["stripLive", "stripInspect", "stripToggleInspect", "stripWindowNext", "stripWindowPrev", "stripSeriesNext", "stripSeriesPrev", "stripScreenNext", "stripScreenPrev", "stripScreenFirst"] as const;
export type StripCommandId = (typeof STRIP_COMMANDS)[number];

/** The commands that steer strip groups; every other command steers
 * independent dials and skips dials that are joined to a strip. */
export function isStripCommand(id: ControlCommandId): id is StripCommandId {
	return (STRIP_COMMANDS as readonly string[]).includes(id);
}

export function isControlCommand(raw: unknown): raw is ControlCommandId {
	return typeof raw === "string" && (CONTROL_COMMANDS as readonly string[]).includes(raw);
}

export type DialControlCommand = {
	readonly command: ControlCommandId;
	/** Empty string reaches every dial (every strip group for a strip
	 * command); otherwise only dials, or strip groups, whose Link ID matches. */
	readonly target: string;
	/** Reset reach for resetStats; ignored by every other command. */
	readonly scope: ResetScope;
};

type Handler = (command: DialControlCommand) => number;

let handler: Handler | null = null;

/** The dial action class registers itself here once, at construction. */
export function registerDialCommandHandler(next: Handler): void {
	handler = next;
}

/** Returns how many dial instances (strip groups, for a strip command) the
 * command was applied to. */
export function dispatchDialCommand(command: DialControlCommand): number {
	return handler === null ? 0 : handler(command);
}
