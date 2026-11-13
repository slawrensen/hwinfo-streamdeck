/* Advanced > Reading links: pairs a Shared Memory reading with the Gadget
   reading of the same sensor, so a key or dial keeps its reading when Auto
   switches source (docs/data-sources.md). The plugin owns the list: this
   panel asks for the workspace (stored links with their health, the
   reading in focus, its counterparts, the missing prerequisites) and sends
   one explicit Link or Unlink press through the shell's applyGlobalField,
   which the plugin commits as a row-scoped compare-and-swap write.

   Opening the section, picking the reading in focus, filtering the list,
   choosing a counterpart and leaving all write nothing; the other source
   is read only when "Look on Gadget" (or "Look on Shared Memory") is
   pressed. Live values refresh in place and never move a box. */
/* global SDPIComponents, hwT */
(() => {
	"use strict";

	/** A panel string (ui/pi-strings.js, catalog key pi.*), or the English
	 * written here when that script is not loaded (a unit test that runs
	 * this file alone). */
	const T = (key, english, params) => (typeof hwT === "function" ? hwT(key, english, params) : english.replace(/\{(\w+)\}/g, (whole, name) => (params !== undefined && Object.hasOwn(params, name) ? String(params[name]) : whole)));

	const hw = self.hwShell;
	const section = document.getElementById("sec-links");
	if (hw === undefined || section === null) return;
	const client = SDPIComponents.streamDeckClient;
	const $ = (id) => document.getElementById(id);
	const els = {
		focusRow: $("links-focus-row"),
		focus: $("links-focus"),
		card: $("links-card"),
		scan: $("links-scan"),
		filter: $("links-filter"),
		candidate: $("links-candidate"),
		chosen: $("links-chosen"),
		scope: $("links-scope"),
		link: $("links-link"),
		note: $("links-note"),
		list: $("links-list"),
		prereq: $("links-prereq")
	};
	const PROVIDER = { "shared-memory": "Shared Memory", gadget: "Gadget" };
	const SM_KEY = /^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/i;
	const linkable = (key) => typeof key === "string" && (SM_KEY.test(key) || /^g2?:/.test(key));

	let workspace = null;
	let latestRequest = "";
	let focusKey = "";
	let pairFocus = "";
	let busy = false;
	let listSignature = "";
	let candidateSignature = "";
	const isDoc = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
	const newId = () => `links-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

	/** The readings this key or dial uses, its own reading first. */
	function focusChoices() {
		const s = hw.state.settings;
		const keys = [s.readingKey, s.secondaryReadingKey, s.quadReadingKey3, s.quadReadingKey4, ...(Array.isArray(s.rotationKeys) ? s.rotationKeys : [])];
		if (pairFocus !== "") keys.unshift(pairFocus);
		return [...new Set(keys.filter(linkable))];
	}

	function request(scan = false, full = false) {
		latestRequest = newId();
		const message = { event: "getLinks", requestId: latestRequest };
		if (focusKey !== "") message.focusKey = focusKey;
		// The candidate list (up to 400 readings) goes again only when it
		// changed; otherwise the plugin sends the chosen one's live value.
		const held = workspace?.focus;
		if (!full && focusKey !== "" && isDoc(held) && held.key === focusKey && typeof held.candidatesSignature === "string") {
			message.candidatesSignature = held.candidatesSignature;
			const chosen = els.candidate?.value ?? "";
			if (chosen !== "") message.chosen = chosen;
		}
		if (scan) {
			message.scan = true;
			const provider = scanTarget();
			if (provider !== null) message.provider = provider;
		}
		client.send("sendToPlugin", message);
	}

	/** The provider "Look on ..." reads: the one not in use. */
	function scanTarget() {
		const active = workspace?.active ?? hw.state.preview?.source ?? null;
		if (active === "shared-memory") return "gadget";
		if (active === "gadget") return "shared-memory";
		return focusKey !== "" && SM_KEY.test(focusKey) ? "gadget" : focusKey !== "" ? "shared-memory" : null;
	}

	function setNote(tone, text) {
		if (els.note === null) return;
		els.note.dataset.tone = text === "" ? "" : tone;
		els.note.textContent = text;
	}

	function endpointLine(endpoint) {
		if (!isDoc(endpoint)) return "";
		const unit = endpoint.unit === "" ? "no unit" : endpoint.unit;
		return `${PROVIDER[endpoint.provider] ?? endpoint.provider}: ${endpoint.label} (${endpoint.sensor || "no source name"}), ${unit}`;
	}
	const valueLine = (endpoint) => (isDoc(endpoint) ? `${endpoint.display} · ${endpoint.availabilityText}` : "");

	function renderFocusChoices() {
		const choices = focusChoices();
		if (!choices.includes(focusKey)) focusKey = choices[0] ?? "";
		if (els.focus === null || els.focusRow === null) return;
		els.focusRow.hidden = choices.length < 2;
		// The names ride in the signature: the list rebuilds when the tree
		// first names a reading or renames one, never on every tree (a
		// rebuild closes an open list).
		const named = choices.map((key) => [key, hw.labelOf(key) ?? key]);
		const signature = JSON.stringify(named);
		if (els.focus.dataset.signature !== signature) {
			els.focus.dataset.signature = signature;
			els.focus.replaceChildren(
				...named.map(([key, label]) => {
					const option = document.createElement("option");
					option.value = key;
					option.textContent = label;
					return option;
				})
			);
		}
		els.focus.value = focusKey;
	}

	function renderCard(focus) {
		if (els.card === null) return;
		const lines = [];
		if (focusKey === "") lines.push("Pick a reading under Reading first; its link shows here.");
		else if (!isDoc(focus)) lines.push("Loading the reading's sources...");
		else if (focus.notLinkable !== "") lines.push(focus.notLinkable);
		else if (!isDoc(focus.endpoint)) lines.push(`This reading was not seen on ${PROVIDER[focus.provider] ?? "its source"} in this session, so its unit cannot be checked. ${focus.provider === "shared-memory" ? "Look on Shared Memory while it is readable." : "Look on Gadget, or tick Report value in Gadget for it in HWiNFO."}`);
		else lines.push(endpointLine(focus.endpoint), valueLine(focus.endpoint));
		// The value line changes on its own (value, source, availability):
		// one line high and ellipsized like #links-chosen, so it never wraps
		// and moves the controls below.
		const valueAt = isDoc(focus) && focus.notLinkable === "" && isDoc(focus.endpoint) ? 1 : -1;
		const text = lines.join("\n");
		if (els.card.dataset.text === text) return;
		els.card.dataset.text = text;
		els.card.replaceChildren(
			...lines.map((line, i) => {
				const p = document.createElement("p");
				if (i === valueAt) p.className = "hw-link-value";
				p.textContent = line;
				return p;
			})
		);
	}

	function selectedCandidate() {
		const key = els.candidate?.value ?? "";
		return workspace?.focus?.candidates?.find((c) => c.key === key && c.blocked === null) ?? null;
	}

	function renderCandidates() {
		if (els.candidate === null) return;
		const focus = workspace?.focus;
		const filter = (els.filter?.value ?? "").trim().toLowerCase();
		const list = isDoc(focus) && Array.isArray(focus.candidates) ? focus.candidates : [];
		const shown = filter === "" ? list : list.filter((c) => `${c.label} ${c.sensor} ${c.unit}`.toLowerCase().includes(filter));
		const signature = JSON.stringify([focusKey, filter, shown.map((c) => [c.key, c.suggestion, c.blocked, c.label, c.sensor])]);
		if (signature !== candidateSignature) {
			candidateSignature = signature;
			const previous = els.candidate.value;
			const placeholder = document.createElement("option");
			placeholder.value = "";
			placeholder.textContent = list.length === 0 ? "No readings from the other source yet" : shown.length === 0 ? "Nothing matches the filter" : "Pick the matching reading";
			const options = shown.map((c) => {
				const option = document.createElement("option");
				option.value = c.key;
				const why = c.blocked !== null ? ` (${c.blockedText})` : c.suggestion !== null ? ` (suggested: ${c.suggestionText.toLowerCase()})` : "";
				// No live value in the option text: options are rebuilt only when
				// the list changes (a rebuild closes an open list), so the value
				// lives in the line under the list instead.
				option.textContent = `${c.label} · ${c.sensor || "no source name"} · ${c.unit || "no unit"}${why}`;
				option.disabled = c.blocked !== null;
				return option;
			});
			els.candidate.replaceChildren(placeholder, ...options);
			// Nothing is preselected; a choice the person made survives a refresh.
			els.candidate.value = shown.some((c) => c.key === previous && c.blocked === null) ? previous : "";
		}
		renderScope();
	}

	function renderScope() {
		const focus = workspace?.focus;
		const chosen = selectedCandidate();
		const ready = isDoc(focus) && isDoc(focus.endpoint) && chosen !== null && !busy;
		if (els.chosen !== null) {
			const lines = chosen === null ? [] : [endpointLine(chosen), valueLine(chosen)];
			const text = lines.join("\n");
			if (els.chosen.dataset.text !== text) {
				els.chosen.dataset.text = text;
				els.chosen.replaceChildren(
					...lines.map((line, i) => {
						const p = document.createElement("p");
						if (i === 1) p.className = "hw-link-value";
						p.textContent = line;
						return p;
					})
				);
			}
			els.chosen.hidden = chosen === null;
		}
		if (els.scope !== null) {
			const text = ready ? `Links ${focus.endpoint.label} (${PROVIDER[focus.endpoint.provider]}, ${focus.endpoint.unit || "no unit"}) with ${chosen.label} (${PROVIDER[chosen.provider]}, ${chosen.unit || "no unit"}) for every key and dial.` : "";
			if (els.scope.textContent !== text) els.scope.textContent = text;
			els.scope.hidden = text === "";
		}
		if (els.link !== null) {
			const replacing = isDoc(focus) && focus.linkedRow >= 0;
			const label = replacing ? "Replace link" : T("pi.links.link", "Link");
			if (els.link.textContent !== label) els.link.textContent = label;
			els.link.setAttribute("aria-disabled", ready ? "false" : "true");
		}
	}

	function renderScan() {
		if (els.scan === null) return;
		const target = scanTarget();
		const text = target === null ? "Look on the other source" : `Look on ${PROVIDER[target]}`;
		if (els.scan.textContent !== text) els.scan.textContent = text;
		const forced = workspace !== null && workspace.mode !== "auto";
		els.scan.setAttribute("aria-disabled", forced || busy ? "true" : "false");
	}

	/** Disarms an Unlink when focus leaves it. */
	function disarm(button) {
		button.dataset.armed = "false";
		button.textContent = "Unlink";
	}

	function rowLines(row) {
		return [row.sm === null ? `Shared Memory: ${row.sharedMemory ?? "not a reading key"}` : endpointLine(row.sm), row.sm === null ? "" : valueLine(row.sm), row.gd === null ? `Gadget: ${row.gadget ?? "not a reading key"}` : endpointLine(row.gd), row.gd === null ? "" : valueLine(row.gd), row.healthText, row.readinessText];
	}

	function renderList() {
		if (els.list === null) return;
		const rows = Array.isArray(workspace?.rows) ? workspace.rows : [];
		const signature = JSON.stringify(rows.map((row) => [row.index, row.sharedMemory, row.gadget, row.removable, row.health, row.readiness]));
		if (signature !== listSignature) {
			listSignature = signature;
			const items = rows.map((row) => {
				const li = document.createElement("li");
				li.className = "hw-link-row";
				li.dataset.health = row.health;
				for (const [i, line] of rowLines(row).entries()) {
					const p = document.createElement("p");
					p.className = i === 1 || i === 3 ? "hw-link-value" : i >= 4 ? "hw-link-health" : "hw-link-end";
					p.dataset.line = String(i);
					p.textContent = line;
					p.hidden = line === "";
					li.append(p);
				}
				if (row.removable) {
					const button = document.createElement("button");
					button.type = "button";
					button.className = "hw-btn hw-link-unlink";
					button.textContent = "Unlink";
					button.dataset.sharedMemory = row.sharedMemory;
					button.dataset.gadget = row.gadget;
					button.addEventListener("click", (ev) => unlinkPress(button, ev));
					button.addEventListener("blur", () => disarm(button));
					const actions = document.createElement("div");
					actions.className = "hw-actions";
					actions.append(button);
					li.append(actions);
				}
				return li;
			});
			if (rows.length === 0) {
				const li = document.createElement("li");
				li.className = "hw-link-empty";
				li.textContent = "No links stored.";
				items.push(li);
			}
			// An unlinked row goes: focus moves to the next row's Unlink, or the list.
			hw.replaceKeepingFocus(els.list, items, els.candidate);
			return;
		}
		// Same rows: only the words inside fixed lines change.
		for (const [i, row] of rows.entries()) {
			const li = els.list.children[i];
			if (li === undefined) continue;
			const lines = rowLines(row);
			for (const p of li.children) {
				const at = Number(p.dataset?.line);
				if (!Number.isInteger(at) || lines[at] === undefined) continue;
				if (p.textContent !== lines[at]) p.textContent = lines[at];
			}
		}
	}

	function renderPrereq() {
		if (els.prereq === null) return;
		const list = Array.isArray(workspace?.prerequisites) ? workspace.prerequisites : [];
		const signature = JSON.stringify(list);
		if (els.prereq.dataset.signature === signature) return;
		els.prereq.dataset.signature = signature;
		els.prereq.hidden = list.length === 0;
		// A pressed "Look on ..." line goes once the scan answers: focus moves
		// to the next line's action, or the Look on button above.
		hw.replaceKeepingFocus(
			els.prereq,
			list.map((item) => {
				const li = document.createElement("li");
				li.textContent = `${item.text} `;
				const action = { source: ["shared-source", "Data source setting"], setup: ["setup-help", "HWiNFO setup steps"], config: ["sec-config", "Configuration documents"] }[item.action];
				if (action !== undefined) {
					const button = document.createElement("button");
					button.type = "button";
					button.className = "hw-link";
					button.dataset.reveal = action[0];
					button.textContent = action[1];
					li.append(button);
				} else if (item.action === "scan") {
					const button = document.createElement("button");
					button.type = "button";
					button.className = "hw-link";
					button.textContent = els.scan?.textContent ?? "Look on the other source";
					button.addEventListener("click", () => scanPress());
					li.append(button);
				}
				return li;
			}),
			els.scan
		);
	}

	function render() {
		renderFocusChoices();
		renderCard(workspace?.focus?.key === focusKey ? workspace.focus : null);
		renderCandidates();
		renderScan();
		renderList();
		renderPrereq();
		if (workspace?.scan !== null && workspace?.scan !== undefined && els.note !== null && els.note.dataset.scan === "pending") {
			els.note.dataset.scan = "";
			setNote(workspace.scan.text.startsWith("Could not") || workspace.scan.text.startsWith("Not read") ? "warn" : "info", workspace.scan.text);
		}
	}

	function adopt(next) {
		if (!isDoc(next)) return;
		if (isDoc(next.focus) && next.focus.candidatesUnchanged === true) {
			const held = workspace?.focus;
			if (!isDoc(held) || held.key !== next.focus.key || held.candidatesSignature !== next.focus.candidatesSignature || !Array.isArray(held.candidates)) {
				// Not the list this panel holds (a refocus crossed the reply):
				// ask for the whole list.
				request(false, true);
				return;
			}
			const fresh = new Map((Array.isArray(next.focus.candidates) ? next.focus.candidates : []).map((c) => [c.key, c]));
			next = { ...next, focus: { ...next.focus, candidates: held.candidates.map((c) => fresh.get(c.key) ?? c), candidatesUnchanged: false } };
		}
		workspace = next;
		hw.scheduleRender();
		render();
	}

	client.sendToPropertyInspector.subscribe((ev) => {
		const p = ev?.payload;
		if (!isDoc(p) || p.event !== "links" || p.requestId !== latestRequest) return;
		adopt(p.workspace);
	});

	function scanPress() {
		if (busy || els.scan?.getAttribute("aria-disabled") === "true") return;
		if (els.note !== null) els.note.dataset.scan = "pending";
		request(true);
	}

	async function commit(message, done) {
		busy = true;
		render();
		const reply = await hw.applyGlobalField({ ...message, focusKey });
		busy = false;
		if (reply === null) {
			setNote("warn", "No answer from the plugin. Check the list below before pressing again.");
			request();
			return;
		}
		if (isDoc(reply.workspace)) adopt(reply.workspace);
		else render();
		if (reply.ok === true) {
			setNote("info", done);
			hw.announce("links", done, { repeat: true });
		} else {
			setNote("warn", typeof reply.reasonText === "string" ? reply.reasonText : "The plugin refused the change.");
		}
	}

	function linkPress() {
		const focus = workspace?.focus;
		const chosen = selectedCandidate();
		if (busy || !isDoc(focus) || !isDoc(focus.endpoint) || chosen === null || workspace === null) return;
		const pair = focus.endpoint.provider === "shared-memory" ? { sharedMemory: focus.endpoint.key, gadget: chosen.key } : { sharedMemory: chosen.key, gadget: focus.endpoint.key };
		const row = focus.linkedRow >= 0 ? workspace.rows.find((r) => r.index === focus.linkedRow) : undefined;
		if (row !== undefined && row.sharedMemory !== null && row.gadget !== null) {
			void commit({ event: "applyLink", op: "relink", ...pair, previous: { sharedMemory: row.sharedMemory, gadget: row.gadget }, baseSignature: workspace.signature }, "Link replaced. Every key and dial showing either reading follows the new pair.");
		} else {
			void commit({ event: "applyLink", op: "link", ...pair, baseSignature: workspace.signature }, "Linked. Every key and dial showing either reading follows the pair.");
		}
	}

	let armedAt = 0;
	function unlinkPress(button, ev) {
		if (busy || workspace === null) return;
		if (button.dataset.armed !== "true") {
			button.dataset.armed = "true";
			button.textContent = "Press again to unlink";
			armedAt = performance.now();
			hw.announce("links", "Press again to unlink.", { repeat: true });
			return;
		}
		// The second click of one double-click only waits.
		if ((ev?.detail ?? 0) > 1 || performance.now() - armedAt < 450) return;
		disarm(button);
		void commit({ event: "applyLink", op: "unlink", sharedMemory: button.dataset.sharedMemory, gadget: button.dataset.gadget, baseSignature: workspace.signature }, "Unlinked. Each reading now stands on its own.");
	}

	els.scan?.addEventListener("click", () => scanPress());
	els.link?.addEventListener("click", () => {
		if (els.link.getAttribute("aria-disabled") !== "true") linkPress();
	});
	els.filter?.addEventListener("input", () => renderCandidates());
	els.candidate?.addEventListener("change", () => renderScope());
	els.focus?.addEventListener("change", () => {
		focusKey = els.focus.value;
		setNote("", "");
		candidateSignature = "";
		render();
		request();
	});

	// While the section is open its numbers follow the plugin (reads only).
	let refreshTimer = 0;
	const open = () => section.open === true;
	function startRefresh() {
		clearInterval(refreshTimer);
		refreshTimer = setInterval(() => {
			if (open() && document.visibilityState !== "hidden" && !busy) request();
		}, 2000);
	}
	section.addEventListener("toggle", () => {
		if (open()) {
			render();
			request();
			startRefresh();
		} else {
			clearInterval(refreshTimer);
		}
	});
	hw.on("pair", (key) => {
		if (!linkable(key)) return;
		pairFocus = key;
		focusKey = key;
		candidateSignature = "";
		render();
		request();
		startRefresh();
	});
	hw.on("settings", () => {
		const before = focusKey;
		renderFocusChoices();
		if (open() && focusKey !== before) request();
	});
	// The settings reach the panel before the tree that names their readings.
	hw.on("tree", () => renderFocusChoices());
	hw.on("connected", () => {
		render();
		if (open()) {
			request();
			startRefresh();
		}
	});
	// The plugin committed readingLinks in an answer that came after its
	// hold. The list held here, which the summary also reads, is then out of
	// date, open or closed, so ask again. This editor's own presses take the
	// list their answer carries.
	hw.on("globals", (ev) => {
		if (ev?.origin === "plugin" && ev.field === "readingLinks" && workspace !== null && !busy) request();
	});
	hw.summary("links", (state) => hw.model.linksSummary(state.globals, workspace));
	render();
})();
