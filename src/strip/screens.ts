/**
 * Strip Screens: a Whole strip keeps up to MAX_SCREENS screens (panes[0]
 * and `config.screens`, src/strip/settings.ts) and shows one at a time.
 * The pure pieces the runtime uses:
 *
 * - which screen comes next (a turn clamps at the ends, Control and the
 *   automatic cycle wrap);
 * - the Screens dial: the rightmost present member, the last dial of the
 *   strip unless it is missing; its plain turn moves screens;
 * - the wipe: one slice per frame, next from the right, previous from the
 *   left, so the change starts above the Screens dial;
 * - a screen's automatic name, its name and place for 1.6 s after a
 *   change, and whether it has anything to draw or a reading past its
 *   critical limit (the position line's dashed segment).
 *
 * The screen on view is runtime view state (GroupView.screen): moving
 * between screens never writes a setting.
 */
import { t } from "../i18n";
import type { SensorSnapshot } from "../hwinfo/types";
import type { PollerStatus } from "../poller";
import { convertUnit } from "../ui/format";
import { toNative } from "./graph";
import type { ScreenLabel } from "./scene";
import { groupRuleOf, resolveGroup } from "./group";
import { stampedLimits } from "./scale";
import { drawnSeries, isRuleStyle, type StripPaneV1 } from "./settings";

/** How long a screen's name and place take the window words after a change. */
export const SCREEN_NAME_MS = 1600;

/** The screen after `step` moves from `current` of `count`: clamped at the
 * ends (a turn), or wrapping (Control keys and the automatic cycle). */
export function screenStep(current: number, count: number, step: number, wrap: boolean): number {
	if (count <= 1) return 0;
	const move = Math.trunc(step);
	if (wrap) return (((current + move) % count) + count) % count;
	return Math.min(count - 1, Math.max(0, current + Math.sign(move) * Math.min(Math.abs(move), count)));
}

/** The Screens dial's column: the rightmost present member (column 3 on a
 * Stream Deck +, 5 on a + XL, unless that dial is missing). */
export function screensColumnOf(present: Iterable<number>): number | undefined {
	let out: number | undefined;
	for (const c of present) if (out === undefined || c > out) out = c;
	return out;
}

/** The order a wipe replaces the present slices in: next (1) from the
 * right, previous (-1) from the left. */
export function wipeOrder(present: Iterable<number>, direction: 1 | -1): number[] {
	const columns = [...present].sort((a, b) => a - b);
	return direction > 0 ? columns.reverse() : columns;
}

/** How the strip shows its readings: `fahrenheit` is the strip's °F. */
export type ScreenNameOptions = { readonly fahrenheit?: boolean };

/** The name a screen shows when it has none of its own: a filter rule's
 * filter as typed, a folder rule's folder, a unit rule "Every <unit>", and
 * a screen of ticked readings (or a custom list) its first reading's name
 * with "+N" for the others; "" when it has no readings yet, or when its
 * first reading has no name here (HWiNFO does not list it and it was
 * never seen): a saved key is never a name. A unit rule names the unit
 * the strip shows ("Every °F" for °C readings with °F ticked). The panel
 * names screens by the same rules (ui/pi-strip-model.js autoName). */
export function autoScreenName(pane: StripPaneV1, snapshot: SensorSnapshot | null, labelOf: (key: string) => string | undefined = () => undefined, options: ScreenNameOptions = {}): string {
	const { name, more } = autoScreenParts(pane, snapshot, labelOf, options);
	return more > 0 ? t("strip.screen.more", { name, count: more }) : name;
}

/** The automatic name in its parts: the words, and how many more readings
 * "+N" counts (0: none), so a shortened name keeps its count. */
export function autoScreenParts(pane: StripPaneV1, snapshot: SensorSnapshot | null, labelOf: (key: string) => string | undefined = () => undefined, options: ScreenNameOptions = {}): { readonly name: string; readonly more: number } {
	const label = (key: string, own?: string): string => own ?? snapshot?.byKey.get(key)?.label ?? labelOf(key) ?? "";
	// No name, no count: "+2" alone names nothing.
	const named = (name: string, more = 0): { name: string; more: number } => ({ name, more: name === "" ? 0 : more });
	if (isRuleStyle(pane.style)) {
		const rule = groupRuleOf(pane);
		if (rule.from === "filter") return named(rule.filter ?? "");
		if (rule.from === "unit") return named(rule.unit === undefined ? "" : t("strip.screen.everyUnit", { unit: convertUnit(0, rule.unit, options.fahrenheit === true).unit }));
		if (rule.from === "list") {
			const first = rule.keys[0];
			return first === undefined ? named("") : named(label(first), rule.keys.length - 1);
		}
		const anchor = pane.series[0]?.key;
		const reading = anchor === undefined ? undefined : snapshot?.byKey.get(anchor);
		const folder = reading === undefined || reading.sensorIndex < 0 ? undefined : snapshot?.sensors[reading.sensorIndex]?.name;
		return named(folder ?? "");
	}
	const drawn = drawnSeries(pane);
	const first = drawn[0];
	return first === undefined ? named("") : named(label(first.key, first.name), drawn.length - 1);
}

/** What the window words say for 1.6 s after a change: the screen's name
 * (its own, else the automatic one in its parts, so "+N" stays when the
 * name shortens; "" when it has neither) and its place ("2 of 5"). */
export function screenLabelOf(pane: StripPaneV1, index: number, count: number, snapshot: SensorSnapshot | null, labelOf?: (key: string) => string | undefined, options: ScreenNameOptions = {}): ScreenLabel {
	const place = t("strip.screen.place", { n: index + 1, count });
	if (pane.name !== undefined) return { name: pane.name, place };
	const auto = autoScreenParts(pane, snapshot, labelOf, options);
	return { name: auto.name, place, ...(auto.more > 0 ? { more: auto.more } : {}) };
}

function snapshotOf(status: PollerStatus): SensorSnapshot | null {
	return status.state === "unavailable" ? null : status.snapshot;
}

/** Whether a screen has anything to draw now: one of its readings is in
 * HWiNFO's list (the automatic cycle skips a screen that has none). */
export function screenHasData(pane: StripPaneV1, status: PollerStatus): boolean {
	const snapshot = snapshotOf(status);
	if (snapshot === null) return false;
	if (isRuleStyle(pane.style)) return resolveGroup(snapshot, pane).keys.some((key) => snapshot.byKey.has(key));
	return drawnSeries(pane).some((s) => snapshot.byKey.has(s.key));
}

/** A live value against a critical limit in the unit on view (as
 * stampedLimits gives it): at or past it (at or under it when lower is
 * worse), in the reading's native unit, as the scene's bands test it. */
function pastCritical(value: number, unit: string, crit: number, below: boolean, fahrenheit: boolean): boolean {
	const limit = toNative(crit, unit, fahrenheit);
	return below ? value <= limit : value >= limit;
}

/** Whether a screen's critical mark needs its rule's readings: a Group
 * screen with a critical limit. */
export function screenNeedsRule(pane: StripPaneV1): boolean {
	return pane.style === "group" && pane.group?.limits?.crit !== undefined;
}

/**
 * Whether a screen holds a reading past its critical limit now: a series
 * screen by its bands, a Group screen by its group limits over
 * the readings its rule stands for (`ruleKeys`, a recent resolution the
 * caller keeps, else resolved here; Ambient draws no limits), each limit
 * read in the unit it was typed in as the scene draws it (stampedLimits).
 * Live values only: a stale or missing reading marks nothing.
 */
export function screenCritical(pane: StripPaneV1, status: PollerStatus, fahrenheit: boolean, ruleKeys?: readonly string[]): boolean {
	if (status.state !== "ok") return false;
	const snapshot = status.snapshot;
	if (pane.style === "ambient") return false;
	if (pane.style === "group") {
		const limits = pane.group?.limits;
		if (limits?.crit === undefined) return false;
		for (const key of ruleKeys ?? resolveGroup(snapshot, pane).keys) {
			const r = snapshot.byKey.get(key);
			if (r === undefined || !Number.isFinite(r.value)) continue;
			const crit = stampedLimits(limits, r.unit, fahrenheit)?.crit;
			if (crit !== undefined && pastCritical(r.value, r.unit, crit, limits.below, fahrenheit)) return true;
		}
		return false;
	}
	const drawn = new Set(drawnSeries(pane).map((s) => s.key));
	for (const band of pane.bands) {
		if (band.crit === undefined || !drawn.has(band.key)) continue;
		const r = snapshot.byKey.get(band.key);
		if (r === undefined || !Number.isFinite(r.value)) continue;
		const crit = stampedLimits(band, r.unit, fahrenheit)?.crit;
		if (crit !== undefined && pastCritical(r.value, r.unit, crit, band.below, fahrenheit)) return true;
	}
	return false;
}
