/**
 * Ember's dial bar in alert (no palette change). On a dial the alert shows
 * only through the bar fill, and a normal bar color close to the alert fill
 * makes the change hard to see: Ember's accent #E0912F measures 3.26
 * (CIEDE2000) from the warning fill #E8940D. When the normal bar color is
 * within ALERT_TRACK_DISTANCE of the fill for the current level, the alert
 * also paints the unfilled track in that level's muted zone color, so the
 * bar's whole length changes. Every other theme accent and type accent
 * measures above the limit (test/themes-alert-distance.test.ts records the
 * numbers), so their dials draw exactly as before.
 */
import type { AlertLevel } from "../alerts/types";
import { ciede2000 } from "./color-difference";
import { ZONE_BG_BLEND } from "./gauge";
import { mixToward } from "./text-colors";

/** CIEDE2000 at or under which a normal bar color reads as the alert fill. */
export const ALERT_TRACK_DISTANCE = 10;

/** Whether the bar's normal color is too close to the alert fill to show
 * the alert by the fill alone. */
export function barNeedsAlertTrack(normalBarColor: string, alertFill: string): boolean {
	return ciede2000(normalBarColor, alertFill) <= ALERT_TRACK_DISTANCE;
}

/**
 * The fill for the dial bar's unfilled track while alerting, or null to
 * keep the ordinary track: null at normal, and null whenever the normal bar
 * color is far enough from the alert fill. The color is the level's zone
 * shade (drawnZones' blend toward the face background).
 */
export function alertTrackFill(normalBarColor: string, level: AlertLevel, alerts: Readonly<Record<"warn" | "crit", { readonly bg: string }>>, faceBg: string): string | null {
	if (level === "normal") return null;
	const fill = alerts[level].bg;
	return barNeedsAlertTrack(normalBarColor, fill) ? mixToward(fill, faceBg, ZONE_BG_BLEND) : null;
}
