/**
 * The settings panel's "Calculated readings" editor, plugin side (steer
 * 7G): the list the panel shows (every stored definition with its verdict,
 * label, live value, inputs, expression and unit), the live preview of a
 * draft, and the row-scoped plans an explicit Save or Delete commits
 * through the global compare-and-swap writer. SDK-free (views injected).
 *
 * Nothing here writes: a preview evaluates the draft against the snapshot
 * the poller already holds, through the same parser and evaluator the
 * poller publishes with, and is thrown away. A plan only computes the next
 * stored value; the writer commits it after its basis check.
 *
 * The stored rows follow src/hwinfo/calculated.ts: {id, op, inputs, unit,
 * sensorType, percent?, label?}. An edit replaces one row in place
 * (keeping that row's unknown fields), appends one, or removes one; every
 * other stored row rides along as the same value in the same position.
 */
import type { JsonObject, JsonValue } from "@elgato/utils";

import { globalFieldSignature } from "../global-writer";
import {
	CALCULATED_INPUTS_MAX,
	CALCULATED_INPUTS_MIN,
	CALCULATED_OPS,
	CALCULATED_READINGS_MAX,
	calculatedExpressionOf,
	calculatedHeldUnit,
	calculatedInfoOf,
	calculatedLabelRefusal,
	calculatedOpsFor,
	parseCalculatedReadings,
	withCalculatedReadings,
	type CalculatedLabelRefusal,
	type CalculatedOp,
	type CalculatedPlan,
	type CalculatedRefusal,
	type CalculatedState
} from "../hwinfo/calculated";
import type { Reading, SensorSnapshot } from "../hwinfo/types";
import type { PollerStatus } from "../poller";
import { formatMeasurement, type DataUnitsPref } from "../ui/measure";

/** What a person is editing: no id, no unit (the plugin reads both). */
export type CalcDraft = { readonly op: CalculatedOp; readonly inputs: readonly string[]; readonly percent: boolean; readonly label: string };

export type CalcEdit =
	| { readonly op: "create"; readonly draft: CalcDraft }
	| { readonly op: "update"; readonly id: string; readonly draft: CalcDraft }
	| { readonly op: "delete"; readonly id: string };

/** Why an edit is refused. Parser refusals (CalculatedRefusal) name the
 * rule the row broke; the rest are the editor's own checks. */
export type CalcEditRefusal =
	| CalculatedRefusal
	/** The draft is not an operation over 2 to 8 reading keys. */
	| "malformed-draft"
	/** The stored calculatedReadings value is not a list. */
	| "unreadable-list"
	/** 32 definitions are stored already. */
	| "cap"
	/** Update or delete: no stored row has that id. */
	| "not-found"
	/** Delete: a later definition uses this one. */
	| "referenced"
	/** An input is not in HWiNFO's current list, so its unit cannot be read. */
	| "input-missing"
	/** The inputs' units cannot be held to one unit. */
	| "input-units"
	/** Two inputs are one measurement (a linked pair listed twice, or a
	 * reading counted twice through nested sums and averages). */
	| "input-ambiguous"
	/** The custom label is refused (see labelRefusal). */
	| "label"
	/** The change would make another definition invalid. */
	| "breaks-dependent";

export type CalcEditPlan =
	| { readonly ok: true; readonly next: JsonValue[]; readonly id: string }
	| { readonly ok: false; readonly reason: CalcEditRefusal; readonly labelRefusal?: CalculatedLabelRefusal; readonly dependent?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a draft out of a panel message; undefined when malformed. */
export function calcDraftOf(raw: unknown): CalcDraft | undefined {
	if (!isRecord(raw)) return undefined;
	const op = raw.op;
	if (typeof op !== "string" || !(CALCULATED_OPS as readonly string[]).includes(op)) return undefined;
	const inputs = raw.inputs;
	if (!Array.isArray(inputs) || inputs.length < CALCULATED_INPUTS_MIN || inputs.length > CALCULATED_INPUTS_MAX) return undefined;
	if (!inputs.every((key): key is string => typeof key === "string" && key !== "")) return undefined;
	const label = typeof raw.label === "string" ? raw.label : "";
	return { op: op as CalculatedOp, inputs, percent: raw.percent === true, label };
}

const OP_TEXT: Readonly<Record<CalculatedOp, string>> = { sum: "Sum", avg: "Average", min: "Lowest", max: "Highest", diff: "Difference (A - B)", ratio: "Ratio (A / B)" };

export function calcRefusalText(reason: CalcEditRefusal | "stale-basis" | "read-failed" | "write-failed", detail: { labelRefusal?: CalculatedLabelRefusal; dependentLabel?: string } = {}): string {
	switch (reason) {
		case "malformed":
		case "malformed-id":
		case "malformed-unit":
		case "malformed-type":
			return "This stored row is not a valid definition.";
		case "duplicate-id":
			return "Two stored rows share this id, so neither applies.";
		case "unknown-op":
			return "This operation is not one this version knows.";
		case "malformed-percent":
			return "Show as a percentage applies to a ratio only.";
		case "malformed-input":
		case "malformed-draft":
			return `Pick ${CALCULATED_INPUTS_MIN} to ${CALCULATED_INPUTS_MAX} readings.`;
		case "input-count":
			return `Pick ${CALCULATED_INPUTS_MIN} to ${CALCULATED_INPUTS_MAX} readings; a difference or a ratio takes exactly 2.`;
		case "duplicate-input":
			return "The same reading is picked twice.";
		case "op-not-allowed":
			return "This operation does not fit these units: temperatures, clocks, voltages, fan speeds and percentages cannot be summed, and Yes/No readings only take Lowest (all) or Highest (any).";
		case "self-reference":
			return "A calculated reading cannot use itself.";
		case "forward-reference":
			return "An input is a calculated reading listed after this one. Only earlier ones can be used.";
		case "missing-reference":
			return "An input is a calculated reading that no longer exists.";
		case "invalid-reference":
			return "An input is a calculated reading that is not valid.";
		case "unit-mismatch":
		case "input-units":
			return "The inputs report different units. All inputs need one unit (data sizes and rates of one kind convert).";
		case "too-deep":
			return "Calculated readings can nest at most 3 levels deep.";
		case "unreadable-list":
			return "The stored calculatedReadings value is not a list. Fix or remove it in Configuration documents first.";
		case "cap":
			return `At most ${CALCULATED_READINGS_MAX} calculated readings can be stored.`;
		case "not-found":
			return "That calculated reading is no longer stored.";
		case "referenced":
			return `${detail.dependentLabel ?? "Another calculated reading"} uses this one. Delete or change that one first.`;
		case "input-missing":
			return "An input is not in HWiNFO's current list, so its unit cannot be read. Pick inputs HWiNFO publishes now.";
		case "input-ambiguous":
			return "Two inputs are the same measurement (a linked pair, or one reading counted twice).";
		case "label":
			return calcLabelRefusalText(detail.labelRefusal ?? "not-text");
		case "breaks-dependent":
			return `This change would make ${detail.dependentLabel ?? "another calculated reading"} invalid, because it uses this one.`;
		case "stale-basis":
			return "The calculated readings changed in another panel or document since this list was shown. Check the refreshed list and save again.";
		case "read-failed":
		case "write-failed":
			return "The Stream Deck app did not take the change. Nothing was saved; try again.";
	}
}

export function calcLabelRefusalText(refusal: CalculatedLabelRefusal): string {
	switch (refusal) {
		case "claims-system-power":
			return "A sum of sensor powers is not what the machine draws, so a label cannot name wall, system, total, PSU or outlet power. The generated label is used instead.";
		case "too-long":
			return "A label can be at most 64 characters. The generated label is used instead.";
		case "control-character":
			return "A label cannot contain line breaks or control characters. The generated label is used instead.";
		case "not-text":
			return "The stored label is not text. The generated label is used instead.";
	}
}

export function calcStateText(state: CalculatedState, failedInputLabel?: string): string {
	const named = failedInputLabel === undefined ? "" : `: ${failedInputLabel}`;
	switch (state) {
		case "ok":
			return "";
		case "invalid-definition":
			return "Not valid; it shows no value.";
		case "input-missing":
			return `No value: an input is missing${named}.`;
		case "input-ambiguous":
			return "No value: two inputs are the same measurement.";
		case "unit-mismatch":
			return `No value: an input's unit no longer matches${named}.`;
		case "input-stale":
			return `No value: an input is not updating${named}.`;
		case "input-non-finite":
			return `No value: an input has no value${named}.`;
		case "division-by-zero":
			return "No value: division by zero.";
		case "overflow":
			return "No value: the result is out of range.";
	}
}

/** Stored rows as a list; undefined for a value that is not one. */
function rowsOf(raw: unknown): readonly unknown[] | undefined {
	if (raw === undefined || raw === null) return [];
	return Array.isArray(raw) ? (raw as unknown[]) : undefined;
}

function rowIndexOf(rows: readonly unknown[], id: string): number {
	return rows.findIndex((row) => isRecord(row) && row.id === id);
}

function sameList(a: readonly unknown[], b: readonly unknown[]): boolean {
	return a.length === b.length && a.every((item, i) => item === b[i]);
}

/** The definition label for a stored id in a decorated snapshot. */
function labelOfId(decorated: SensorSnapshot | null, id: string): string | undefined {
	return decorated?.byKey.get(id)?.label;
}

export interface CalcEditorDeps {
	status(): PollerStatus;
	/** The held observation with links applied and no calculated readings
	 * (what the poller derives calculated readings from); null while
	 * unavailable. */
	linked(): SensorSnapshot | null;
	globals(): JsonObject | undefined;
	dataUnits(): DataUnitsPref;
	mintId(): string;
}

/** What a draft would publish, for the panel's live line. */
export type CalcPreview = {
	ok: boolean;
	reason: CalcEditRefusal | null;
	reasonText: string;
	generatedLabel: string;
	label: string;
	labelRefusal: CalculatedLabelRefusal | null;
	labelRefusalText: string;
	display: string;
	unit: string;
	state: CalculatedState | null;
	stateText: string;
	expression: string;
	/** Operations the first input's unit allows (empty without an input). */
	allowedOps: CalculatedOp[];
};

export type CalcInputPayload = { key: string; label: string; source: string; present: boolean };

export type CalcRowPayload = {
	index: number;
	id: string | null;
	ok: boolean;
	reason: CalculatedRefusal | null;
	reasonText: string;
	label: string;
	custom: boolean;
	labelRefusal: CalculatedLabelRefusal | null;
	labelRefusalText: string;
	opText: string;
	inputs: CalcInputPayload[];
	display: string;
	unit: string;
	state: CalculatedState | null;
	stateText: string;
	expression: string;
	/** The stored row as a draft, for Edit (null when the row is not one). */
	draft: { op: string; inputs: string[]; percent: boolean; label: string } | null;
};

export type CalcWorkspace = {
	signature: string;
	rows: CalcRowPayload[];
	overCap: boolean;
	unreadable: boolean;
	max: number;
	maxInputs: number;
	ops: { op: CalculatedOp; text: string }[];
};

export class CalcEditor {
	constructor(private readonly deps: CalcEditorDeps) {}

	private stored(): unknown {
		return this.deps.globals()?.calculatedReadings;
	}

	private format(reading: Reading | undefined): { display: string; unit: string } {
		if (reading === undefined) return { display: "", unit: "" };
		const m = formatMeasurement(reading.value, reading.unit, { decimals: "auto", fahrenheit: false, dataUnits: this.deps.dataUnits() });
		return { display: `${m.valueText} ${m.unitText}`.trim(), unit: reading.unit };
	}

	/** The snapshot an input is resolved in: the linked observation plus
	 * the given plan's calculated readings. */
	private decorated(plan: CalculatedPlan): SensorSnapshot | null {
		const linked = this.deps.linked();
		return linked === null ? null : withCalculatedReadings(linked, plan);
	}

	/**
	 * Plans one edit against the stored value (the writer's fresh read when
	 * committing, the last received document when previewing).
	 */
	plan(raw: unknown, edit: CalcEdit): CalcEditPlan {
		const rows = rowsOf(raw);
		if (rows === undefined) return { ok: false, reason: "unreadable-list" };
		const before = parseCalculatedReadings(rows);
		if (edit.op === "delete") {
			const at = rowIndexOf(rows, edit.id);
			if (at < 0) return { ok: false, reason: "not-found" };
			const user = rows.find((row, i) => i !== at && isRecord(row) && Array.isArray(row.inputs) && row.inputs.includes(edit.id));
			if (user !== undefined) return { ok: false, reason: "referenced", dependent: String((user as Record<string, unknown>).id) };
			return { ok: true, next: rows.filter((_row, i) => i !== at) as JsonValue[], id: edit.id };
		}
		const draft = edit.draft;
		if (calcDraftOf(draft) === undefined) return { ok: false, reason: "malformed-draft" };
		const at = edit.op === "update" ? rowIndexOf(rows, edit.id) : rows.length;
		if (at < 0) return { ok: false, reason: "not-found" };
		if (edit.op === "create" && rows.length >= CALCULATED_READINGS_MAX) return { ok: false, reason: "cap" };
		const existing = edit.op === "update" ? (rows[at] as Record<string, unknown>) : undefined;
		const id = edit.op === "update" ? edit.id : this.deps.mintId();
		// The unit and type come from what the inputs report now; an edit
		// that keeps the stored inputs keeps the stored unit and type.
		let unit: unknown = existing?.unit;
		let sensorType: unknown = existing?.sensorType;
		const keepsInputs = existing !== undefined && Array.isArray(existing.inputs) && sameList(existing.inputs as unknown[], draft.inputs) && typeof unit === "string" && typeof sensorType === "number";
		const current = this.decorated(before);
		if (!keepsInputs) {
			const first = current?.byKey.get(draft.inputs[0] as string);
			if (current === null || draft.inputs.some((key) => current.byKey.get(key) === undefined) || first === undefined) return { ok: false, reason: "input-missing" };
			unit = first.unit;
			sensorType = first.type;
		}
		const row: Record<string, unknown> = { ...(existing ?? {}), id, op: draft.op, inputs: [...draft.inputs], unit, sensorType };
		if (draft.op === "ratio" && draft.percent) row.percent = true;
		else delete row.percent;
		const label = draft.label.trim();
		if (label !== "") row.label = label;
		else delete row.label;
		const next = [...rows];
		next[at] = row;
		const plan = parseCalculatedReadings(next);
		if (plan.overCap) return { ok: false, reason: "cap" };
		const verdict = plan.rows.find((r) => r.index === at);
		if (verdict === undefined) return { ok: false, reason: "malformed-draft" };
		if (!verdict.ok) return { ok: false, reason: verdict.reason };
		if (label !== "" && verdict.labelRefusal !== undefined) return { ok: false, reason: "label", labelRefusal: verdict.labelRefusal };
		const okBefore = new Set(before.rows.filter((r) => r.ok).map((r) => r.id));
		const broken = plan.rows.find((r) => r.index !== at && r.id !== undefined && okBefore.has(r.id) && !r.ok);
		if (broken?.id !== undefined) return { ok: false, reason: "breaks-dependent", dependent: broken.id };
		const decorated = this.decorated(plan);
		const reading = decorated?.byKey.get(id);
		const state = reading === undefined ? undefined : calculatedInfoOf(reading)?.state;
		// Counting one measurement twice depends on the operation too, so it
		// is judged on every save. A missing input or a drifted unit on
		// inputs that were accepted before is the runtime's own state (no
		// value, named in the list), never a reason to refuse a label or
		// operation edit.
		if (state === "input-ambiguous") return { ok: false, reason: "input-ambiguous" };
		if (!keepsInputs && state === "unit-mismatch") return { ok: false, reason: "input-units" };
		if (!keepsInputs && (state === "input-missing" || reading === undefined)) return { ok: false, reason: "input-missing" };
		return { ok: true, next: next as JsonValue[], id };
	}

	/** What the draft would publish. Writes nothing. */
	preview(draft: CalcDraft | undefined, editingId: string | undefined): CalcPreview {
		const empty: CalcPreview = { ok: false, reason: "malformed-draft", reasonText: calcRefusalText("malformed-draft"), generatedLabel: "", label: "", labelRefusal: null, labelRefusalText: "", display: "", unit: "", state: null, stateText: "", expression: "", allowedOps: [] };
		if (draft === undefined) return empty;
		const stored = this.stored();
		const rows = rowsOf(stored);
		const current = rows === undefined ? null : this.decorated(parseCalculatedReadings(rows));
		const first = current?.byKey.get(draft.inputs[0] as string);
		const allowedOps = first === undefined ? [] : [...calculatedOpsFor(calculatedHeldUnit(first.unit))];
		// Evaluated without the custom label, so the generated label shows;
		// the custom label is judged on its own by the parser's rule.
		const unlabeled: CalcDraft = { ...draft, label: "" };
		const edit: CalcEdit = editingId === undefined ? { op: "create", draft: unlabeled } : { op: "update", id: editingId, draft: unlabeled };
		const result = this.plan(stored, edit);
		const label = draft.label.trim();
		const labelRefusal = label === "" || first === undefined ? undefined : calculatedLabelRefusal(draft.op, calculatedHeldUnit(first.unit), label);
		if (!result.ok) return { ...empty, reason: result.reason, reasonText: calcRefusalText(result.reason, { dependentLabel: result.dependent === undefined ? undefined : labelOfId(current, result.dependent) }), allowedOps, labelRefusal: labelRefusal ?? null, labelRefusalText: labelRefusal === undefined ? "" : calcLabelRefusalText(labelRefusal) };
		const plan = parseCalculatedReadings(result.next);
		const decorated = this.decorated(plan);
		const reading = decorated?.byKey.get(result.id);
		const info = reading === undefined ? undefined : calculatedInfoOf(reading);
		const formatted = this.format(reading);
		const failed = info?.failedInput === undefined ? undefined : decorated?.byKey.get(info.failedInput)?.label;
		return {
			ok: true,
			reason: null,
			reasonText: "",
			generatedLabel: reading?.label ?? "",
			label: labelRefusal === undefined && label !== "" ? label : (reading?.label ?? ""),
			labelRefusal: labelRefusal ?? null,
			labelRefusalText: labelRefusal === undefined ? "" : calcLabelRefusalText(labelRefusal),
			display: formatted.display,
			unit: formatted.unit,
			state: info?.state ?? null,
			stateText: info === undefined ? "" : calcStateText(info.state, failed),
			expression: decorated === null ? "" : (calculatedExpressionOf(result.id, plan, decorated) ?? ""),
			allowedOps
		};
	}

	/** The list the panel shows. Writes nothing. */
	workspace(): CalcWorkspace {
		const stored = this.stored();
		const rows = rowsOf(stored);
		// Verdicts from the same document the rows come from (the poller
		// adopts that document through the same delivery).
		const plan = parseCalculatedReadings(stored);
		const status = this.deps.status();
		const snapshot = status.state === "unavailable" ? null : status.snapshot;
		const out: CalcRowPayload[] = [];
		for (let index = 0; index < (rows?.length ?? 0); index++) {
			const row = rows?.[index];
			const record = isRecord(row) ? row : null;
			const id = typeof record?.id === "string" ? record.id : null;
			const verdict = plan.rows.find((r) => r.index === index);
			const reading = id === null ? undefined : snapshot?.byKey.get(id);
			const info = reading === undefined ? undefined : calculatedInfoOf(reading);
			const inputs = Array.isArray(record?.inputs) ? (record.inputs as unknown[]).filter((key): key is string => typeof key === "string") : [];
			const formatted = this.format(info === undefined || info.state === "invalid-definition" ? undefined : reading);
			const failed = info?.failedInput === undefined ? undefined : snapshot?.byKey.get(info.failedInput)?.label;
			const ok = verdict?.ok === true;
			const labelRefusal = verdict?.ok === true ? (verdict.labelRefusal ?? null) : null;
			out.push({
				index,
				id,
				ok,
				reason: verdict !== undefined && !verdict.ok ? verdict.reason : null,
				reasonText: verdict !== undefined && !verdict.ok ? calcRefusalText(verdict.reason) : plan.overCap ? `More than ${CALCULATED_READINGS_MAX} rows are stored, so none applies.` : "",
				label: reading !== undefined && info?.state !== "invalid-definition" ? reading.label : typeof record?.label === "string" && record.label.trim() !== "" ? record.label.trim() : "Calculated reading",
				custom: ok && id !== null && plan.byId.get(id)?.label !== undefined,
				labelRefusal,
				labelRefusalText: labelRefusal === null ? "" : calcLabelRefusalText(labelRefusal),
				opText: typeof record?.op === "string" && Object.hasOwn(OP_TEXT, record.op) ? `${OP_TEXT[record.op as CalculatedOp]}${record.op === "ratio" && record.percent === true ? " as a percentage" : ""}` : "",
				inputs: inputs.map((key) => {
					const input = snapshot?.byKey.get(key);
					return { key, label: input?.label ?? "Missing reading", source: input === undefined ? "" : (snapshot?.sensors[input.sensorIndex]?.name ?? ""), present: input !== undefined };
				}),
				display: formatted.display,
				unit: formatted.unit,
				state: info?.state ?? null,
				stateText: info === undefined ? "" : calcStateText(info.state, failed),
				expression: ok && id !== null && snapshot !== null ? (calculatedExpressionOf(id, plan, snapshot) ?? "") : "",
				draft: record === null || typeof record.op !== "string" ? null : { op: record.op, inputs, percent: record.percent === true, label: typeof record.label === "string" ? record.label : "" }
			});
		}
		return {
			signature: globalFieldSignature(stored),
			rows: out,
			overCap: plan.overCap,
			unreadable: rows === undefined,
			max: CALCULATED_READINGS_MAX,
			maxInputs: CALCULATED_INPUTS_MAX,
			ops: CALCULATED_OPS.map((op) => ({ op, text: OP_TEXT[op] }))
		};
	}

	/** The label of a stored definition id, for refusal words. */
	labelOf(id: string | undefined): string | undefined {
		if (id === undefined) return undefined;
		const status = this.deps.status();
		return status.state === "unavailable" ? undefined : status.snapshot.byKey.get(id)?.label;
	}
}
