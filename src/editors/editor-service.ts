/**
 * The settings panel's requests for the two plugin-written global editors
 * (Reading links, Calculated readings), answered in one place. SDK-free:
 * the editors, the compare-and-swap writer and the reply channel are
 * injected (editor-runtime.ts binds them to the SDK and the poller), so
 * the unit suite drives every message end to end.
 *
 * Read requests (getLinks, getCalculated, previewCalculated) build a reply
 * and write nothing. Only applyLink and applyCalculated reach the writer,
 * each carrying the basis signature the panel saw; the reply always says
 * what happened, carries the raw field before and after (the panel shell
 * splices it into any whole-document write the panel still holds), and a
 * fresh workspace, so a stale panel catches up in the same answer.
 */
import type { JsonObject, JsonValue } from "@elgato/utils";

import type { GlobalCommitResult, GlobalSettingsWriter } from "../global-writer";
import type { CalculatedLabelRefusal } from "../hwinfo/calculated";
import type { LinkRefusal } from "../hwinfo/link-pairing";
import { calcDraftOf, calcRefusalText, type CalcEdit, type CalcEditor, type CalcEditRefusal } from "./calc-editor";
import { linkEditOf, linkRefusalText, type LinkEditor } from "./link-editor";

export const LINKS_FIELD = "readingLinks";
export const CALCULATED_FIELD = "calculatedReadings";

export interface EditorServiceDeps {
	readonly links: LinkEditor;
	readonly calc: CalcEditor;
	readonly writer: GlobalSettingsWriter;
	/** Sends one message to the open settings panel. */
	send(payload: JsonObject): void;
}

type Payload = Readonly<Record<string, JsonValue | undefined>>;

/** A request id is echoed only when it is a short string. */
function requestIdOf(payload: Payload): string {
	const id = payload.requestId;
	return typeof id === "string" && id.length <= 64 ? id : "";
}

/** The committed field, before and after, for the panel shell's splice. */
function committed(result: GlobalCommitResult<string, unknown>): JsonObject {
	if (!result.ok) return { field: result.field, signature: result.signature };
	return { field: result.field, previous: result.previous, previousPresent: result.previousPresent, next: result.next, signature: result.signature };
}

export class EditorService {
	constructor(private readonly deps: EditorServiceDeps) {}

	/** Answers one panel message; false when it is not one of these. */
	handle(payload: Payload): boolean {
		switch (payload.event) {
			case "getLinks":
				this.deps.send({ event: "links", requestId: requestIdOf(payload), workspace: this.deps.links.workspace({ focusKey: payload.focusKey, scan: payload.scan, provider: payload.provider, candidatesSignature: payload.candidatesSignature, chosen: payload.chosen }) as unknown as JsonObject });
				return true;
			case "applyLink":
				void this.applyLink(payload);
				return true;
			case "getCalculated":
				this.deps.send({ event: "calculated", requestId: requestIdOf(payload), workspace: this.deps.calc.workspace() as unknown as JsonObject });
				return true;
			case "previewCalculated": {
				const editingId = typeof payload.editingId === "string" && payload.editingId !== "" ? payload.editingId : undefined;
				this.deps.send({ event: "calculatedPreview", requestId: requestIdOf(payload), preview: this.deps.calc.preview(calcDraftOf(payload.draft), editingId) as unknown as JsonObject });
				return true;
			}
			case "applyCalculated":
				void this.applyCalculated(payload);
				return true;
			default:
				return false;
		}
	}

	/** One explicit Link, Unlink or relink press. */
	async applyLink(payload: Payload): Promise<void> {
		const requestId = requestIdOf(payload);
		const edit = linkEditOf(payload);
		const focusKey = payload.focusKey;
		if (edit === undefined || typeof payload.baseSignature !== "string") {
			this.deps.send({ event: "linkApplied", requestId, ok: false, reason: "malformed", reasonText: linkRefusalText("malformed"), workspace: this.deps.links.workspace({ focusKey }) as unknown as JsonObject });
			return;
		}
		const result = await this.deps.writer.commit<LinkRefusal>(LINKS_FIELD, payload.baseSignature, (current) => this.deps.links.plan(current, edit));
		const reasonText = result.ok ? "" : linkRefusalText(result.reason, this.deps.links.refusalDetail(edit));
		this.deps.send({ event: "linkApplied", requestId, ok: result.ok, ...(result.ok ? {} : { reason: result.reason }), reasonText, op: edit.op, ...committed(result), workspace: this.deps.links.workspace({ focusKey }) as unknown as JsonObject });
	}

	/** One explicit Save or Delete press in the calculation editor. */
	async applyCalculated(payload: Payload): Promise<void> {
		const requestId = requestIdOf(payload);
		const op = payload.op;
		const id = typeof payload.id === "string" ? payload.id : undefined;
		const draft = calcDraftOf(payload.draft);
		let edit: CalcEdit | undefined;
		if (op === "delete" && id !== undefined) edit = { op, id };
		else if (op === "update" && id !== undefined && draft !== undefined) edit = { op, id, draft };
		else if (op === "create" && draft !== undefined) edit = { op, draft };
		if (edit === undefined || typeof payload.baseSignature !== "string") {
			this.deps.send({ event: "calculatedApplied", requestId, ok: false, reason: "malformed-draft", reasonText: calcRefusalText("malformed-draft"), workspace: this.deps.calc.workspace() as unknown as JsonObject });
			return;
		}
		const planned = edit;
		let refusal: { labelRefusal?: CalculatedLabelRefusal; dependent?: string } = {};
		let createdId: string | undefined;
		const result = await this.deps.writer.commit<CalcEditRefusal>(CALCULATED_FIELD, payload.baseSignature, (current) => {
			const plan = this.deps.calc.plan(current, planned);
			if (!plan.ok) {
				refusal = { labelRefusal: plan.labelRefusal, dependent: plan.dependent };
				return { ok: false, reason: plan.reason };
			}
			createdId = plan.id;
			return { ok: true, next: plan.next };
		});
		const reasonText = result.ok ? "" : calcRefusalText(result.reason, { labelRefusal: refusal.labelRefusal, dependentLabel: this.deps.calc.labelOf(refusal.dependent) });
		this.deps.send({
			event: "calculatedApplied",
			requestId,
			ok: result.ok,
			...(result.ok ? {} : { reason: result.reason }),
			reasonText,
			op: planned.op,
			...(createdId === undefined || !result.ok ? {} : { id: createdId }),
			...committed(result),
			workspace: this.deps.calc.workspace() as unknown as JsonObject
		});
	}
}
