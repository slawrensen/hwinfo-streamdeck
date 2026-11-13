/**
 * The Sensor Reading key's alert path: which readings a key alerts on, the
 * in-memory state behind them, and what its face shows. Pure (no SDK, no
 * poller): the action feeds it the poller status and the monotonic clock.
 *
 * A key references the readings its drawn layout shows: one on the single
 * layout, two on the dual, three on the triple, four on the quad. Each one
 * resolves its own rule (rules.ts ruleFor): a per-reading `alertRules`
 * entry, else the legacy pair on the first reading only, exactly as 1.7.1
 * read it. The face level is the highest shown level over those readings,
 * so a key with no `alertRules` alerts from its first reading alone, and at
 * dwell 0 with no recovery band it shows exactly what alertLevel showed.
 *
 * Tick contract (store.ts): every referenced reading is stepped once per
 * poller tick, a null rule included, then the context is pruned once. A
 * key that leaves the screen keeps being stepped with its last settings for
 * the store's hidden window, so a detail view's Back tile (which stands for
 * the key that opened it) shows the opener's live alert, and a page flip
 * comes back to the same dwell and snooze. Nothing here writes settings:
 * appearing, settings receipt and ticks only read them.
 */
import type { Reading, SensorSnapshot } from "../hwinfo/types";
import { alertLevel, convertUnit } from "../ui/format";
import { drawnKeyLayout, nonEmptyKey } from "../ui/key-layout";
import { aggregateShown, NORMAL_SHOWN } from "./engine";
import { alertFlags, alertObservation, hasAnyLimit, parseAlertConfig, readingRuleOf, ruleFor, ruleSignature, ruleValue, valueInUnit, type AlertConfig, type AlertSettings, type LegacyAlertPair, type ParsedAlertRule } from "./rules";
import { alertIdentityOf, alertStore, HIDDEN_TTL_MS, type AlertStore } from "./store";
import type { AlertLevel, AlertSeverity, ShownAlert } from "./types";

/** The settings the key alert path reads: the slot keys, the layout, °F and
 * every alert field. Any key settings object fits. */
export type KeyAlertSettings = AlertSettings & {
	readonly readingKey?: unknown;
	readonly secondaryReadingKey?: unknown;
	readonly quadReadingKey3?: unknown;
	readonly quadReadingKey4?: unknown;
	readonly keyLayout?: unknown;
	readonly fahrenheit?: unknown;
};

/** What one key face shows for alerts. */
export interface KeyAlertView {
	/** The highest shown level over the key's readings, and the highest
	 * level a deliberate snooze is silencing. */
	readonly face: ShownAlert;
	/** One entry per drawn slot, in slot order: what that reading shows, or
	 * undefined for an empty slot or a reading the snapshot lacks. */
	readonly slots: readonly (ShownAlert | undefined)[];
	/** The key carries per-reading rules (`alertRules` has entries): rows
	 * alert on their own, so a row that is not alerting gives way to the one
	 * that is. False keeps the 1.7.1 face exactly (the whole key recolors
	 * from the first reading). */
	readonly perRow: boolean;
}

export const NORMAL_VIEW: KeyAlertView = Object.freeze({ face: NORMAL_SHOWN, slots: Object.freeze([]), perRow: false });

/** The saved key in each slot the drawn layout shows (undefined for an
 * empty slot), in slot order. */
export function referencedSlotKeys(settings: KeyAlertSettings): readonly (string | undefined)[] {
	const primary = nonEmptyKey(settings.readingKey);
	const secondary = nonEmptyKey(settings.secondaryReadingKey);
	switch (drawnKeyLayout(settings)) {
		case "quad":
			return [primary, secondary, nonEmptyKey(settings.quadReadingKey3), nonEmptyKey(settings.quadReadingKey4)];
		case "triple":
			return [primary, secondary, nonEmptyKey(settings.quadReadingKey3)];
		case "dual":
			return [primary, secondary];
		default:
			return primary === undefined ? [] : [primary];
	}
}

/**
 * The level one reading shows with no state: its rule compared once, as
 * alertLevel compares, no dwell and no recovery band. For the legacy pair
 * on the first reading this is exactly 1.7.1's comparison.
 */
export function immediateLevel(config: AlertConfig, reading: Pick<Reading, "key" | "linkedKeys" | "unit" | "value">, slot: number, fahrenheit: boolean): AlertLevel {
	const rule = ruleFor(config, "key", reading, slot);
	if (rule === null) return "normal";
	const value = ruleValue(rule, reading, fahrenheit);
	return value === undefined ? "normal" : alertLevel(value, rule.warn, rule.crit, rule.below);
}

/**
 * A key's view with no state, from its settings and one snapshot alone:
 * every referenced reading compared once (immediateLevel). The pure
 * composition path uses it; a live key shows the stateful view instead,
 * which equals this one at dwell 0 with no recovery band.
 */
export function immediateKeyView(settings: KeyAlertSettings, snapshot: Pick<SensorSnapshot, "byKey">): KeyAlertView {
	const config = parseAlertConfig(settings);
	const fahrenheit = settings.fahrenheit === true;
	const slots = referencedSlotKeys(settings).map((key, slot): ShownAlert | undefined => {
		const reading = key === undefined ? undefined : snapshot.byKey.get(key);
		if (reading === undefined) return undefined;
		const level = immediateLevel(config, reading, slot, fahrenheit);
		return level === "normal" ? NORMAL_SHOWN : { level, snoozed: null };
	});
	return { face: aggregateShown(slots.filter((s): s is ShownAlert => s !== undefined)), slots, perRow: config.rules.size > 0 };
}

/** The status a step needs: ok with a snapshot, or anything else. */
export type KeyAlertStatus = { readonly state: "ok"; readonly snapshot: Pick<SensorSnapshot, "byKey"> } | { readonly state: "stale" | "unavailable" };

type Tracked = {
	settings: KeyAlertSettings;
	config: AlertConfig;
	fahrenheit: boolean;
	/** Monotonic time the key left the screen; null while it is on screen. */
	hiddenAt: number | null;
	view: KeyAlertView;
	/** The measurement identity of each slot at the last step. */
	identities: readonly (string | undefined)[];
};

export interface KeyAlertsOptions {
	readonly hiddenTtlMs?: number;
	/** Most hidden keys kept stepping; the longest hidden goes first. */
	readonly maxHidden?: number;
}

/** Hidden keys kept stepping at most (keys with limits only). */
export const MAX_HIDDEN_KEYS = 512;

export class KeyAlerts {
	private readonly tracked = new Map<string, Tracked>();
	private readonly hiddenTtlMs: number;
	private readonly maxHidden: number;

	constructor(
		private readonly store: AlertStore,
		options: KeyAlertsOptions = {}
	) {
		this.hiddenTtlMs = options.hiddenTtlMs ?? HIDDEN_TTL_MS;
		this.maxHidden = options.maxHidden ?? MAX_HIDDEN_KEYS;
	}

	/**
	 * A key appeared (a first sighting or a replay): track it on screen with
	 * these settings and step it once, so its first frame already shows the
	 * alert, as 1.7.1's did. A replay within the hidden window keeps its
	 * dwell and snooze.
	 */
	appear(context: string, settings: KeyAlertSettings, status: KeyAlertStatus, now: number): void {
		this.store.appear(context, now);
		const existing = this.tracked.get(context);
		if (existing !== undefined) {
			existing.hiddenAt = null;
			this.adopt(context, existing, settings, status);
		} else {
			const config = parseAlertConfig(settings);
			this.tracked.set(context, { settings, config, fahrenheit: settings.fahrenheit === true, hiddenAt: null, view: NORMAL_VIEW, identities: [] });
		}
		this.stepOne(context, this.tracked.get(context) as Tracked, status, now);
	}

	/**
	 * New settings for a tracked key. A reading whose rule now compares
	 * differently (limits, direction, unit, recovery band, the slot that
	 * decides whether the legacy pair covers it, or °F) starts fresh; a
	 * changed dwell or snooze length keeps every track. Then one step, so the
	 * face follows the edit at once.
	 */
	update(context: string, settings: KeyAlertSettings, status: KeyAlertStatus, now: number): void {
		const tracked = this.tracked.get(context);
		if (tracked === undefined) return;
		this.adopt(context, tracked, settings, status);
		this.stepOne(context, tracked, status, now);
	}

	/** The key left the screen. A key with limits keeps being stepped with
	 * its last settings for the hidden window; one with none is dropped. */
	hide(context: string, now: number): void {
		const tracked = this.tracked.get(context);
		if (tracked === undefined) return;
		if (!hasAnyLimit(tracked.config)) {
			this.tracked.delete(context);
			this.store.forget(context);
			return;
		}
		tracked.hiddenAt = now;
		this.store.hide(context, now);
		this.enforceHiddenCap(context);
	}

	/** One poller tick: steps every tracked key, on screen or hidden, and
	 * drops hidden keys past the window. */
	tick(status: KeyAlertStatus, now: number): void {
		// A Map visits each entry once while the current one is deleted.
		for (const [context, tracked] of this.tracked) {
			if (tracked.hiddenAt !== null && now - tracked.hiddenAt > this.hiddenTtlMs) {
				this.tracked.delete(context);
				this.store.forget(context);
				continue;
			}
			this.stepOne(context, tracked, status, now);
		}
		this.store.sweep(now);
	}

	/** What the key's face shows now; the normal view for a key not tracked. */
	view(context: string): KeyAlertView {
		return this.tracked.get(context)?.view ?? NORMAL_VIEW;
	}

	/** Whether the key is being stepped (on screen, or hidden within the
	 * window). */
	isTracked(context: string): boolean {
		return this.tracked.has(context);
	}

	/**
	 * What one reading of a key shows, for a detail view's Back tile standing
	 * for that key; undefined when the key is not being stepped (a plugin
	 * restart, or past the hidden window), so the caller falls back to the
	 * stateless comparison.
	 */
	shownFor(context: string, identity: string): ShownAlert | undefined {
		return this.tracked.has(context) ? this.store.shownFor(context, identity) : undefined;
	}

	/** The key opted in to "a press while alerting snoozes" and its face shows
	 * an active, unsnoozed alert. Decided at key down. */
	snoozeArmed(context: string): boolean {
		const tracked = this.tracked.get(context);
		return tracked !== undefined && tracked.config.snoozeMs !== null && tracked.view.face.level !== "normal";
	}

	/**
	 * Snoozes every alerting reading of the key at its current level for the
	 * key's snooze length. Returns how many readings were snoozed (0 when the
	 * key has no snooze length or nothing alerts any more). The view follows
	 * at once.
	 */
	snooze(context: string, now: number): number {
		const tracked = this.tracked.get(context);
		if (tracked === undefined || tracked.config.snoozeMs === null) return 0;
		const identities = new Set(tracked.identities.filter((id): id is string => id !== undefined));
		const count = this.store.snoozeContext(context, now, tracked.config.snoozeMs, identities);
		if (count > 0) {
			const slots = tracked.view.slots.map((shown) => (shown === undefined || shown.level === "normal" ? shown : { level: "normal" as const, snoozed: shown.level }));
			tracked.view = { face: aggregateShown(slots.filter((s): s is ShownAlert => s !== undefined)), slots, perRow: tracked.view.perRow };
		}
		return count;
	}

	/** Adopts new settings, resetting the readings whose rule changed. */
	private adopt(context: string, tracked: Tracked, settings: KeyAlertSettings, status: KeyAlertStatus): void {
		const config = parseAlertConfig(settings);
		const fahrenheit = settings.fahrenheit === true;
		if (status.state === "ok") {
			const before = ruleSignatures(tracked.settings, tracked.config, status.snapshot);
			const after = ruleSignatures(settings, config, status.snapshot);
			for (const identity of new Set([...before.keys(), ...after.keys()])) {
				if (fahrenheit !== tracked.fahrenheit || before.get(identity) !== after.get(identity)) this.store.reset(context, identity);
			}
		} else if (fahrenheit !== tracked.fahrenheit) {
			this.store.reset(context);
		}
		tracked.settings = settings;
		tracked.config = config;
		tracked.fahrenheit = fahrenheit;
	}

	private stepOne(context: string, tracked: Tracked, status: KeyAlertStatus, now: number): void {
		const keys = referencedSlotKeys(tracked.settings);
		const perRow = tracked.config.rules.size > 0;
		if (status.state !== "ok") {
			// Data not current: no reading starts or keeps showing an alarm,
			// and no snooze can expire (its end waits for a valid reading).
			this.store.gap(context);
			tracked.view = { face: NORMAL_SHOWN, slots: keys.map(() => undefined), perRow };
			tracked.identities = keys.map(() => undefined);
			return;
		}
		const snapshot = status.snapshot;
		if (!hasAnyLimit(tracked.config) && !this.store.holds(context)) {
			this.stepWithoutLimits(tracked, keys, snapshot, perRow);
			return;
		}
		const keep = new Set<string>();
		const identities: (string | undefined)[] = [];
		let missing = false;
		const slots = keys.map((key, slot): ShownAlert | undefined => {
			const reading = key === undefined ? undefined : snapshot.byKey.get(key);
			if (reading === undefined) {
				identities.push(undefined);
				missing ||= key !== undefined;
				return undefined;
			}
			const identity = alertIdentityOf(reading);
			identities.push(identity);
			keep.add(identity);
			const rule = ruleFor(tracked.config, "key", reading, slot);
			return this.store.step(context, identity, rule, alertObservation(rule, reading, tracked.fahrenheit, true), now, tracked.config.dwellMs);
		});
		// A reading the snapshot lacks has no identity to step; whatever its
		// tracks held waits in a gap.
		if (missing) this.store.gap(context, keep);
		this.store.prune(context, keep);
		tracked.view = { face: aggregateShown(slots.filter((s): s is ShownAlert => s !== undefined)), slots, perRow };
		tracked.identities = identities;
	}

	/**
	 * The step of a key with no limit at all whose context holds no alert
	 * state: every slot resolves no rule, so stepping, the gap and the prune
	 * would leave the store untouched (AlertStore.holds), and every present
	 * slot shows the normal alert. Only the view and the slot identities
	 * follow the snapshot, and both keep their objects while they hold
	 * still, so a deck of keys without limits costs no garbage per tick.
	 */
	private stepWithoutLimits(tracked: Tracked, keys: readonly (string | undefined)[], snapshot: Pick<SensorSnapshot, "byKey">, perRow: boolean): void {
		const before = tracked.view;
		let sameView = before.perRow === perRow && before.slots.length === keys.length && before.face.level === "normal" && before.face.snoozed === null;
		let sameIdentities = tracked.identities.length === keys.length;
		for (let slot = 0; slot < keys.length; slot++) {
			const key = keys[slot];
			const reading = key === undefined ? undefined : snapshot.byKey.get(key);
			sameView &&= before.slots[slot] === (reading === undefined ? undefined : NORMAL_SHOWN);
			sameIdentities &&= tracked.identities[slot] === (reading === undefined ? undefined : alertIdentityOf(reading));
		}
		if (sameView && sameIdentities) return;
		const readings = keys.map((key) => (key === undefined ? undefined : snapshot.byKey.get(key)));
		if (!sameView) {
			const slots = readings.map((reading): ShownAlert | undefined => (reading === undefined ? undefined : NORMAL_SHOWN));
			tracked.view = { face: aggregateShown(slots.filter((s): s is ShownAlert => s !== undefined)), slots, perRow };
		}
		if (!sameIdentities) tracked.identities = readings.map((reading) => (reading === undefined ? undefined : alertIdentityOf(reading)));
	}

	/** Over the cap, the longest hidden key stops being stepped. */
	private enforceHiddenCap(keep: string): void {
		let hidden = 0;
		for (const tracked of this.tracked.values()) if (tracked.hiddenAt !== null) hidden++;
		while (hidden > this.maxHidden) {
			let victim: string | undefined;
			let oldest = Number.POSITIVE_INFINITY;
			for (const [context, tracked] of this.tracked) {
				if (context === keep || tracked.hiddenAt === null || tracked.hiddenAt >= oldest) continue;
				oldest = tracked.hiddenAt;
				victim = context;
			}
			if (victim === undefined) return;
			this.tracked.delete(victim);
			this.store.forget(victim);
			hidden--;
		}
	}
}

/** The key alert path every Sensor Reading key shares, over the one alert
 * store every action shares. */
export const keyAlerts = new KeyAlerts(alertStore);

/**
 * Whether a drawn slot gives way to the rows that alert: only on a key with
 * per-reading rules (`alertRules` has entries) whose face alerts, and only
 * for a slot that is not alerting itself. Such a row draws its value in the
 * alert palette's unit color, so the row that alerts stands out. A key with
 * no rules never gives way: its whole face recolors exactly as in 1.7.1.
 */
export function rowGivesWay(view: KeyAlertView, slot: number): boolean {
	return view.perRow && view.face.level !== "normal" && (view.slots[slot]?.level ?? "normal") === "normal";
}

/** One reading of a key, as the settings panel shows its alerts. */
export type KeyAlertPanelSlot = {
	slot: number;
	/** The saved key in the slot. */
	key: string;
	/** The reading's own name; null while the snapshot lacks it. */
	label: string | null;
	/** The measurement the reading is (store.ts alertIdentityOf): two slots
	 * with one identity show one reading, which has one set of limits. Null
	 * while the reading is missing. */
	identity: string | null;
	/** The unit the key shows for this reading (°F applied). Null while the
	 * reading is missing. */
	displayUnit: string | null;
	/** The unit the numbers of this reading's own `alertRules` entry are in,
	 * and the unit a panel edit of that entry writes with them: the unit the
	 * entry was saved with while the reading still reports it (or its °C/°F
	 * counterpart, which the plugin converts), else the displayed unit (a
	 * first save captures it; an entry whose unit no longer applies, or was
	 * never captured, takes it on the next edit, as its note says). Null
	 * while the reading is missing, so the panel saves nothing then. */
	limitUnit: string | null;
	/** Where the reading's limits come from: its own `alertRules` entry, the
	 * legacy pair (the first reading only), or none. A missing reading
	 * reports its own entry when one is saved under its key. */
	source: "reading" | "legacy" | null;
	/** The `alertRules` key the reading's own limits are filed under. */
	ruleKey: string | null;
	level: AlertLevel;
	snoozed: AlertSeverity | null;
	/** Validation notes (rules.ts alertFlags); they never block a write. */
	flags: { code: string; message: string }[];
};

/** What the settings panel shows about a key's alerts. */
export type KeyAlertPanel = {
	dwellMs: number;
	/** The legacy pair's recovery band. */
	hyst: number;
	snoozeMs: number | null;
	/** The unit Warn at, Critical at and the legacy recovery band are in for
	 * reading 1, and the unit an edit of them stamps (alertDisplayUnit):
	 * see {@link legacyLimitUnit}. Null while reading 1 is missing. */
	legacyUnit: string | null;
	face: { level: AlertLevel; snoozed: AlertSeverity | null };
	slots: KeyAlertPanelSlot[];
};

/** Whether a unit-bearing number is set: a limit, or a recovery band above
 * 0 (a band of 0 means the same in every unit). */
function holdsNumbers(limits: { readonly warn?: number; readonly crit?: number; readonly hyst: number }): boolean {
	return limits.warn !== undefined || limits.crit !== undefined || limits.hyst > 0;
}

/** Whether a saved unit still applies to a reading shown in `displayed`:
 * the same unit, or its °C/°F counterpart (rules.ts converts across that
 * pair and stands down on any other change). */
function unitApplies(saved: string, displayed: string): boolean {
	return valueInUnit(0, saved, displayed) !== undefined;
}

/**
 * The unit the legacy pair's numbers are in for a reading shown in
 * `displayed`: the stamped unit (alertDisplayUnit) while it is the °C/°F
 * counterpart of the displayed one and a number is set, since the plugin
 * then converts (rules.ts ruleUnitFor); otherwise the displayed unit, which
 * is what an unstamped pair is compared in, exactly as 1.7.1. A panel edit
 * stamps this unit, so the numbers the person did not touch keep their
 * meaning.
 */
export function legacyLimitUnit(legacy: LegacyAlertPair, displayed: string): string {
	const stamped = legacy.displayUnit;
	return stamped !== undefined && holdsNumbers(legacy) && unitApplies(stamped, displayed) ? stamped : displayed;
}

/** The unit an `alertRules` entry's numbers are in for a reading shown in
 * `displayed` (see {@link KeyAlertPanelSlot.limitUnit}). */
function entryLimitUnit(entry: ParsedAlertRule | undefined, displayed: string): string {
	return entry?.unit !== undefined && holdsNumbers(entry) && unitApplies(entry.unit, displayed) ? entry.unit : displayed;
}

/** The panel's alert block for one key: timing, the face, and every drawn
 * slot with its rule source, live level, units and notes. */
export function keyAlertPanelOf(settings: KeyAlertSettings, snapshot: Pick<SensorSnapshot, "byKey"> | null, view: KeyAlertView): KeyAlertPanel {
	const config = parseAlertConfig(settings);
	const fahrenheit = settings.fahrenheit === true;
	const slots: KeyAlertPanelSlot[] = [];
	let legacyUnit: string | null = null;
	referencedSlotKeys(settings).forEach((key, slot) => {
		if (key === undefined) return;
		const reading = snapshot?.byKey.get(key);
		const shown = view.slots[slot];
		if (reading === undefined) {
			// No reading, so no links to walk: only an entry under the saved
			// key itself is known to be this reading's.
			const own = config.rules.has(key);
			slots.push({
				slot,
				key,
				label: null,
				identity: null,
				displayUnit: null,
				limitUnit: null,
				source: own ? "reading" : null,
				ruleKey: own ? key : null,
				level: "normal",
				snoozed: null,
				flags: slot === 0 && !own ? alertFlags(config, "key", undefined, 0, fahrenheit).map((f) => ({ code: f.code, message: f.message })) : []
			});
			return;
		}
		const rule = ruleFor(config, "key", reading, slot);
		const entry = readingRuleOf(config, reading);
		const displayUnit = convertUnit(reading.value, reading.unit, fahrenheit).unit;
		if (slot === 0) legacyUnit = legacyLimitUnit(config.legacy, displayUnit);
		slots.push({
			slot,
			key,
			label: reading.label,
			identity: alertIdentityOf(reading),
			displayUnit,
			limitUnit: entryLimitUnit(entry?.rule, displayUnit),
			// An entry with no usable limit still decides this reading (it
			// alerts on nothing and the legacy pair does not cover it).
			source: entry !== undefined ? "reading" : (rule?.source ?? null),
			ruleKey: entry?.key ?? null,
			level: shown?.level ?? "normal",
			snoozed: shown?.snoozed ?? null,
			flags: alertFlags(config, "key", reading, slot, fahrenheit).map((f) => ({ code: f.code, message: f.message }))
		});
	});
	return {
		dwellMs: config.dwellMs,
		hyst: config.legacy.hyst,
		snoozeMs: config.snoozeMs,
		legacyUnit,
		face: { level: view.face.level, snoozed: view.face.snoozed },
		slots
	};
}

/** Per measurement identity, the rules its slots resolve to (null rules
 * included, in a fixed order), as one comparable string. A reading that
 * only moved to another slot under the same rule compares equal. */
function ruleSignatures(settings: KeyAlertSettings, config: AlertConfig, snapshot: Pick<SensorSnapshot, "byKey">): Map<string, string> {
	const out = new Map<string, string[]>();
	referencedSlotKeys(settings).forEach((key, slot) => {
		const reading = key === undefined ? undefined : snapshot.byKey.get(key);
		if (reading === undefined) return;
		const rule = ruleFor(config, "key", reading, slot);
		const identity = alertIdentityOf(reading);
		const list = out.get(identity) ?? [];
		list.push(rule === null ? "null" : ruleSignature(rule));
		out.set(identity, list);
	});
	return new Map([...out].map(([identity, list]) => [identity, list.sort().join("|")]));
}
