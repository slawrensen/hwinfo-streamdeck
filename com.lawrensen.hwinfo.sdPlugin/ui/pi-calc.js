/* Advanced > Calculated readings: a sum, average, lowest, highest,
   difference or ratio of readings, published by the plugin under
   "Calculated (plugin)" in every reading picker (src/hwinfo/calculated.ts).
   The plugin owns the list: this panel shows it (label, live value,
   inputs, expression, unit, what is wrong), previews a draft through the
   plugin's own evaluator, and sends one explicit Save or Delete through
   the shell's applyGlobalField, which the plugin commits as a row-scoped
   compare-and-swap write.

   Opening the section, editing a draft, previewing it and Cancel write
   nothing. Live values refresh in place and never move a box. */
/* global SDPIComponents */
(() => {
	"use strict";

	const hw = self.hwShell;
	const section = document.getElementById("sec-calc");
	if (hw === undefined || section === null) return;
	const client = SDPIComponents.streamDeckClient;
	const $ = (id) => document.getElementById(id);
	const els = {
		list: $("calc-list"),
		create: $("calc-new"),
		form: $("calc-form"),
		op: $("calc-op"),
		inputs: $("calc-inputs"),
		add: $("calc-add-input"),
		percentRow: $("calc-percent-row"),
		percent: $("calc-percent"),
		label: $("calc-label"),
		value: $("calc-preview-value"),
		expression: $("calc-preview-expression"),
		message: $("calc-preview-message"),
		save: $("calc-save"),
		cancel: $("calc-cancel"),
		note: $("calc-note")
	};
	const MAX_INPUTS = 8;
	const TWO_ONLY = new Set(["diff", "ratio"]);
	const isDoc = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
	const newId = () => `calc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

	let workspace = null;
	let latestList = "";
	let latestPreview = "";
	let preview = null;
	let busy = false;
	let listSignature = "";
	/** The draft being edited, or null while the form is closed. */
	let draft = null;
	let editingId = "";
	let previewTimer = 0;

	function requestList() {
		latestList = newId();
		client.send("sendToPlugin", { event: "getCalculated", requestId: latestList });
	}

	function setNote(tone, text) {
		if (els.note === null) return;
		els.note.dataset.tone = text === "" ? "" : tone;
		els.note.textContent = text;
	}

	// --- the list -------------------------------------------------------------

	const rowLines = (row) => [
		row.label,
		row.ok ? (row.display === "" ? row.stateText || "No value" : `${row.display}${row.stateText === "" ? "" : ` · ${row.stateText}`}`) : `${row.reasonText} Kept as stored.`,
		row.inputs.length === 0 ? "" : `${row.opText} of: ${row.inputs.map((input) => (input.present ? `${input.label} (${input.source})` : `${input.label} (${input.key})`)).join(", ")}`,
		row.expression === "" ? "" : `Expression: ${row.expression}${row.unit === "" ? "" : ` · unit ${row.unit}`}`,
		row.labelRefusalText
	];

	let armedAt = 0;
	function deletePress(button, row, ev) {
		if (busy || workspace === null) return;
		if (button.dataset.armed !== "true") {
			button.dataset.armed = "true";
			button.textContent = "Press again to delete";
			armedAt = performance.now();
			hw.announce("calc", "Press again to delete.", { repeat: true });
			return;
		}
		if ((ev?.detail ?? 0) > 1 || performance.now() - armedAt < 450) return;
		button.dataset.armed = "false";
		button.textContent = "Delete";
		void commit({ event: "applyCalculated", op: "delete", id: row.id, baseSignature: workspace.signature }, "Deleted. Keys and dials that showed it now say the reading is missing.");
	}

	function renderList() {
		if (els.list === null) return;
		const rows = Array.isArray(workspace?.rows) ? workspace.rows : [];
		const signature = JSON.stringify(rows.map((row) => [row.index, row.id, row.ok, row.draft !== null]));
		if (signature !== listSignature) {
			listSignature = signature;
			const items = rows.map((row) => {
				const li = document.createElement("li");
				li.className = "hw-calc-row";
				li.dataset.ok = row.ok ? "true" : "false";
				for (const [i, line] of rowLines(row).entries()) {
					const p = document.createElement("p");
					p.className = i === 0 ? "hw-calc-name" : i === 1 ? "hw-calc-value" : "hw-calc-detail";
					p.dataset.line = String(i);
					p.textContent = line;
					p.hidden = line === "";
					li.append(p);
				}
				const actions = document.createElement("div");
				actions.className = "hw-actions";
				if (row.ok && row.id !== null && row.draft !== null) {
					const edit = document.createElement("button");
					edit.type = "button";
					edit.className = "hw-btn";
					edit.textContent = "Edit";
					edit.addEventListener("click", () => openForm(row.draft, row.id));
					actions.append(edit);
				}
				if (row.id !== null) {
					const del = document.createElement("button");
					del.type = "button";
					del.className = "hw-btn hw-calc-delete";
					del.textContent = "Delete";
					del.addEventListener("click", (ev) => deletePress(del, row, ev));
					del.addEventListener("blur", () => {
						del.dataset.armed = "false";
						del.textContent = "Delete";
					});
					actions.append(del);
				}
				li.append(actions);
				return li;
			});
			if (rows.length === 0) {
				const li = document.createElement("li");
				li.className = "hw-calc-empty";
				li.textContent = workspace?.unreadable === true ? "The stored calculatedReadings value is not a list. Fix or remove it in Configuration documents." : "None yet.";
				items.push(li);
			}
			hw.replaceKeepingFocus(els.list, items, els.create);
		} else {
			for (const [i, row] of rows.entries()) {
				const li = els.list.children[i];
				if (li === undefined) continue;
				const lines = rowLines(row);
				for (const p of li.children) {
					const at = Number(p.dataset?.line);
					if (!Number.isInteger(at) || lines[at] === undefined) continue;
					if (p.textContent !== lines[at]) p.textContent = lines[at];
					p.hidden = lines[at] === "";
				}
			}
		}
		if (els.create !== null) {
			const full = rows.length >= (workspace?.max ?? 32);
			els.create.setAttribute("aria-disabled", full || busy ? "true" : "false");
		}
	}

	// --- the form -------------------------------------------------------------

	/** Every reading the sensor tree lists, by source, as picker options. */
	function readingOptions(selected) {
		const groups = Array.isArray(hw.state.tree?.groups) ? hw.state.tree.groups : [];
		const first = document.createElement("option");
		first.value = "";
		first.textContent = groups.length === 0 ? "No readings from HWiNFO right now" : "Pick a reading";
		const out = [first];
		let found = selected === "";
		for (const group of groups) {
			const optgroup = document.createElement("optgroup");
			optgroup.label = group.name;
			for (const reading of group.readings) {
				// A definition never takes itself as an input.
				if (editingId !== "" && reading.key === editingId) continue;
				const option = document.createElement("option");
				option.value = reading.key;
				option.textContent = `${reading.label} · ${reading.display}`;
				optgroup.append(option);
				if (reading.key === selected || (Array.isArray(reading.keys) && reading.keys.includes(selected))) {
					option.value = selected;
					found = true;
				}
			}
			out.push(optgroup);
		}
		if (!found) {
			// A saved input HWiNFO does not list now stays as it is.
			const kept = document.createElement("option");
			kept.value = selected;
			kept.textContent = `Not in HWiNFO's list now (${selected})`;
			out.push(kept);
		}
		return out;
	}

	function renderInputs() {
		if (els.inputs === null || draft === null) return;
		const rows = draft.inputs.map((key, i) => {
			const row = document.createElement("div");
			row.className = "hw-calc-input";
			const label = document.createElement("label");
			label.className = "hw-sr-only";
			label.htmlFor = `calc-input-${i}`;
			label.textContent = TWO_ONLY.has(draft.op) ? (i === 0 ? "Reading A" : "Reading B") : `Reading ${i + 1}`;
			const select = document.createElement("select");
			select.id = `calc-input-${i}`;
			select.replaceChildren(...readingOptions(key));
			select.value = key;
			select.addEventListener("change", () => {
				draft.inputs[i] = select.value;
				schedulePreview();
			});
			row.append(label, select);
			if (draft.inputs.length > 2) {
				const remove = document.createElement("button");
				remove.type = "button";
				remove.className = "hw-btn";
				remove.textContent = "Remove";
				remove.setAttribute("aria-label", `Remove ${label.textContent}`);
				remove.addEventListener("click", () => {
					draft.inputs.splice(i, 1);
					renderForm();
					schedulePreview();
				});
				row.append(remove);
			}
			return row;
		});
		// Remove takes its own row away: focus moves to the next row's control.
		hw.replaceKeepingFocus(els.inputs, rows, els.add);
	}

	function renderForm() {
		if (els.form === null) return;
		els.form.hidden = draft === null;
		if (draft === null) return;
		if (els.op !== null && els.op.value !== draft.op) els.op.value = draft.op;
		if (TWO_ONLY.has(draft.op) && draft.inputs.length > 2) draft.inputs.length = 2;
		renderInputs();
		if (els.add !== null) els.add.hidden = TWO_ONLY.has(draft.op) || draft.inputs.length >= MAX_INPUTS;
		if (els.percentRow !== null) els.percentRow.hidden = draft.op !== "ratio";
		if (els.percent !== null) els.percent.checked = draft.op === "ratio" && draft.percent;
		if (els.label !== null && document.activeElement !== els.label && els.label.value !== draft.label) els.label.value = draft.label;
		renderPreview();
	}

	function renderPreview() {
		const complete = draft !== null && draft.inputs.every((key) => key !== "");
		const p = complete ? preview : null;
		const set = (el, text) => {
			if (el !== null && el.textContent !== text) el.textContent = text;
		};
		set(els.value, p === null ? "" : p.ok ? `${p.label || p.generatedLabel} = ${p.display || p.stateText || "no value"}` : "");
		set(els.expression, p !== null && p.ok && p.expression !== "" ? `Expression: ${p.expression}${p.unit === "" ? "" : ` · unit ${p.unit}`}` : "");
		const messages = [];
		if (!complete && draft !== null) messages.push("Pick a reading in every row.");
		if (p !== null && !p.ok) messages.push(p.reasonText);
		if (p !== null && p.ok && p.stateText !== "") messages.push(p.stateText);
		if (p !== null && p.labelRefusalText !== "") messages.push(p.labelRefusalText);
		set(els.message, messages.join(" "));
		if (els.label !== null && p !== null && p.generatedLabel !== "") els.label.placeholder = p.generatedLabel;
		if (els.save !== null) els.save.setAttribute("aria-disabled", p !== null && p.ok && !busy && p.labelRefusal === null ? "false" : "true");
	}

	function draftMessage() {
		return { op: draft.op, inputs: [...draft.inputs], percent: draft.op === "ratio" && draft.percent, label: draft.label };
	}

	function schedulePreview() {
		clearTimeout(previewTimer);
		preview = null;
		renderPreview();
		if (draft === null || !draft.inputs.every((key) => key !== "")) return;
		previewTimer = setTimeout(() => {
			latestPreview = newId();
			const message = { event: "previewCalculated", requestId: latestPreview, draft: draftMessage() };
			if (editingId !== "") message.editingId = editingId;
			client.send("sendToPlugin", message);
		}, 150);
	}

	function openForm(from, id) {
		const op = typeof from?.op === "string" ? from.op : "sum";
		const inputs = Array.isArray(from?.inputs) ? from.inputs.filter((key) => typeof key === "string") : [];
		while (inputs.length < 2) inputs.push("");
		draft = { op, inputs, percent: from?.percent === true, label: typeof from?.label === "string" ? from.label : "" };
		editingId = typeof id === "string" ? id : "";
		preview = null;
		setNote("", "");
		renderForm();
		schedulePreview();
		els.op?.focus({ preventScroll: false });
	}

	function closeForm() {
		// What slides under the pointer as the editor goes (New, where Cancel
		// was, or the next section) takes no press meant for Cancel or Save, a
		// slow second press past the double-click time included (pi-shell's
		// panel move guard, as Fill's question).
		if (draft !== null) hw.markPanelScroll();
		draft = null;
		editingId = "";
		preview = null;
		clearTimeout(previewTimer);
		renderForm();
	}

	async function commit(message, done) {
		busy = true;
		renderList();
		renderPreview();
		const reply = await hw.applyGlobalField(message);
		busy = false;
		if (reply === null) {
			setNote("warn", "No answer from the plugin. Check the list above before saving again.");
			requestList();
			renderPreview();
			return;
		}
		if (isDoc(reply.workspace)) adoptList(reply.workspace);
		if (reply.ok === true) {
			if (message.op !== "delete") closeForm();
			setNote("info", done);
			hw.announce("calc", done, { repeat: true });
			// The picker lists the new reading once the tree is fetched again.
			client.send("sendToPlugin", { event: "getSensorTree" });
		} else {
			setNote("warn", typeof reply.reasonText === "string" ? reply.reasonText : "The plugin refused the change.");
		}
		renderPreview();
	}

	function savePress() {
		if (busy || draft === null || workspace === null || els.save?.getAttribute("aria-disabled") === "true") return;
		const message = { event: "applyCalculated", op: editingId === "" ? "create" : "update", draft: draftMessage(), baseSignature: workspace.signature };
		if (editingId !== "") message.id = editingId;
		void commit(message, editingId === "" ? "Saved. Pick it under Reading, in the Calculated (plugin) group." : "Saved. Keys and dials showing it use the new definition.");
	}

	function adoptList(next) {
		if (!isDoc(next)) return;
		workspace = next;
		renderList();
		hw.scheduleRender();
	}

	client.sendToPropertyInspector.subscribe((ev) => {
		const p = ev?.payload;
		if (!isDoc(p)) return;
		if (p.event === "calculated" && p.requestId === latestList) adoptList(p.workspace);
		else if (p.event === "calculatedPreview" && p.requestId === latestPreview && draft !== null) {
			preview = isDoc(p.preview) ? p.preview : null;
			renderPreview();
		}
	});

	els.create?.addEventListener("click", () => {
		if (els.create.getAttribute("aria-disabled") !== "true") openForm(null, undefined);
	});
	els.cancel?.addEventListener("click", () => {
		closeForm();
		els.create?.focus();
	});
	els.save?.addEventListener("click", () => savePress());
	els.add?.addEventListener("click", () => {
		if (draft === null || draft.inputs.length >= MAX_INPUTS) return;
		draft.inputs.push("");
		renderForm();
		schedulePreview();
	});
	els.op?.addEventListener("change", () => {
		if (draft === null) return;
		draft.op = els.op.value;
		renderForm();
		schedulePreview();
	});
	els.percent?.addEventListener("click", () => {
		if (draft === null) return;
		draft.percent = els.percent.checked;
		schedulePreview();
	});
	els.label?.addEventListener("input", () => {
		if (draft === null) return;
		draft.label = els.label.value;
		schedulePreview();
	});
	hw.on("tree", () => {
		if (draft !== null) renderInputs();
	});

	let refreshTimer = 0;
	const open = () => section.open === true;
	section.addEventListener("toggle", () => {
		clearInterval(refreshTimer);
		if (!open()) return;
		requestList();
		refreshTimer = setInterval(() => {
			if (open() && document.visibilityState !== "hidden" && !busy) requestList();
		}, 2000);
	});
	hw.on("connected", () => {
		if (open()) requestList();
	});
	// The plugin committed calculatedReadings in an answer that came after
	// its hold. The list held here, which the summary also reads, is then out
	// of date, open or closed, so ask again. This editor's own Save and
	// Delete take the list their answer carries.
	hw.on("globals", (ev) => {
		if (ev?.origin === "plugin" && ev.field === "calculatedReadings" && workspace !== null && !busy) requestList();
	});
	hw.summary("calc", (state) => hw.model.calcSummary(state.globals, workspace));
	renderForm();
})();
