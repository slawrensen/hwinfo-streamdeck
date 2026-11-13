/**
 * The plugin side of the Sensor Dial panel's Strip section for the
 * simulated host (pi-sim.mjs): a REAL StripController (src/strip/*) over
 * fake dial handles on one simulated deck, a real HistoryStore fed with the
 * fixture readings, and the panel's own dial as one of the members. Strip
 * requests from the panel are answered by the production handlers; a
 * plugin write to the open panel's dial reaches the panel as
 * didReceiveSettings, the way the Stream Deck app delivers it.
 *
 * Writes are recorded apart from the panel's own: `pluginWrites` holds
 * every document the plugin wrote (any member), `sim.writes` keeps only
 * the panel's setSettings. SIMULATED HOST, sample data.
 */
import { deriveCapabilities } from "../../src/devices.ts";
import { HistoryStore } from "../../src/history/store.ts";
import { monotonicNow } from "../../src/clock.ts";
import { StripController } from "../../src/strip/controller.ts";
import { stripGroupKey } from "../../src/strip/registry.ts";

const DEVICE = "dev1";

/** A Sensor Dial the simulated deck shows at one encoder column. */
class SimDial {
	constructor(rig, id, column) {
		this.rig = rig;
		this.id = id;
		this.device = { id: DEVICE };
		this.coordinates = { column, row: 0 };
		this.feedback = [];
	}
	setFeedback(feedback) {
		this.feedback.push(feedback.canvas);
		if (this.feedback.length > 8) this.feedback.shift();
		return Promise.resolve();
	}
	setTriggerDescription() {
		return Promise.resolve();
	}
	setSettings(doc) {
		this.rig.pluginWrote(this.id, doc);
		return Promise.resolve();
	}
}

/** Jittered copies of the fixture snapshot, one per tick, so history moves. */
function tickSnapshot(base, n) {
	const readings = base.readings.map((r, i) => {
		if (r.unit === "Yes/No") return { ...r };
		const value = r.value + Math.sin((n + i) / 4) * Math.max(0.5, Math.abs(r.value) * 0.05);
		return { ...r, value, valueMin: Math.min(r.valueMin, value), valueMax: Math.max(r.valueMax, value) };
	});
	return { ...base, pollTime: base.pollTime + n, valueRevision: base.pollTime + n, readings, byKey: new Map(readings.map((r) => [r.key, r])) };
}

/**
 * spec: { type: 7 | 13, column, dials: [[column, settings], ...],
 *         create?: { layout, from, patch }, groupBudgetBytes? }
 * (groupBudgetBytes: a smaller Group history allowance, so a test can
 * fill it.)
 * The panel's own dial sits at spec.column with the fixture's settings.
 */
export function createStripRig(sim, spec) {
	const caps = spec.type === 13 ? deriveCapabilities({ type: 13, columns: 9, rows: 4 }) : deriveCapabilities({ type: 7, columns: 4, rows: 2 });
	const history = new HistoryStore({ now: monotonicNow, ...(spec.groupBudgetBytes === undefined ? {} : { groupBudgetBytes: spec.groupBudgetBytes }) });
	const settings = new Map();
	const dials = new Map();
	let quiet = true; // no host pushes while the rig builds itself
	let n = 0;
	let status = { state: "ok", snapshot: tickSnapshot(sim.snapshot, 0), source: "shared-memory" };
	const rig = {
		pluginWrites: [],
		/** Holds back the host's didReceiveSettings for a plugin write to the
		 * open panel's dial (ms), so a panel save can race the echo. */
		echoDelayMs: 0,
		/** True: strip states for the open panel are held back (editFrom). */
		holdState: false,
		dials,
		settings,
		/** The member context at an encoder column. */
		contextAt: (column) => `${sim.fixture}-dial${column}`,
		pluginWrote(context, doc) {
			rig.pluginWrites.push({ context, doc: structuredClone(doc) });
			settings.set(context, structuredClone(doc));
			if (context === sim.context) {
				sim.settings = structuredClone(doc);
				const echo = structuredClone(doc);
				if (quiet) return;
				if (rig.echoDelayMs > 0) setTimeout(() => sim.pushSettings(echo), rig.echoDelayMs);
				else sim.pushSettings(echo);
			}
		}
	};
	const host = {
		settingsOf: (context) => settings.get(context),
		stored: (context, doc) => settings.set(context, structuredClone(doc)),
		claimChanged: () => {},
		status: () => status,
		history,
		panelContext: () => (quiet ? undefined : sim.context),
		sendToPanel: (payload) => {
			if (rig.holdState && payload?.event === "stripState") return;
			if (!quiet) sim.sendToPi(JSON.parse(JSON.stringify(payload)));
		}
	};
	const ctl = new StripController(host, { capabilities: { get: (id) => (id === DEVICE ? caps : deriveCapabilities({})) } });
	rig.ctl = ctl;

	const ingest = (at) => {
		n += 1;
		const snapshot = tickSnapshot(sim.snapshot, n);
		history.ingest({ kind: "ok", at, snapshot, source: "shared-memory", evidence: true, stampAdvanced: true, evidenceAgeMs: 0 });
		status = { state: "ok", snapshot, source: "shared-memory" };
	};
	// A minute and a half of history already collected, so previews draw.
	const now = monotonicNow();
	for (let i = 90; i >= 1; i--) ingest(now - i * 1000);

	const members = [[spec.column, sim.settings], ...spec.dials];
	for (const [column, doc] of members) {
		const id = column === spec.column ? sim.context : rig.contextAt(column);
		const dial = new SimDial(rig, id, column);
		dials.set(id, dial);
		settings.set(id, structuredClone(doc));
		ctl.appear(dial, structuredClone(doc));
	}
	if (spec.create !== undefined) {
		const from = spec.create.from === spec.column ? sim.context : rig.contextAt(spec.create.from);
		ctl.handlePi(from, { event: "stripCreate", opId: "fixture", layout: spec.create.layout, ...(spec.create.patch ? { patch: spec.create.patch } : {}) });
		// The fixture's own document is what the plugin wrote.
		sim.settings = structuredClone(settings.get(sim.context));
		rig.pluginWrites.length = 0;
	}
	ctl.onTick(status);

	// While stale (rig.setStale), HWiNFO's list stays but nothing new comes.
	let stale = false;
	const timer = setInterval(() => {
		if (stale) {
			history.ingest({ kind: "stale", at: monotonicNow() });
			status = { state: "stale", snapshot: status.state === "unavailable" ? tickSnapshot(sim.snapshot, n) : status.snapshot, source: "shared-memory", staleForMs: 5000 };
		} else ingest(monotonicNow());
		ctl.onTick(status);
	}, 1000);
	timer.unref?.();

	/** The panel connected: pushes may flow (the PI appeared). */
	rig.ready = () => {
		quiet = false;
		ctl.forgetPanel();
	};
	/** A panel request (sendToPlugin) from the open panel. */
	rig.request = (payload) => ctl.handlePi(sim.context, payload);
	/** The panel saved its whole document: the plugin hears it (a stale
	 * stripGroup in it is repaired by a plugin write). */
	rig.panelWrote = (doc) => {
		settings.set(sim.context, structuredClone(doc));
		ctl.settingsChanged(sim.context, structuredClone(doc));
	};
	/** The dial preview's strip role and face, as the dial action sends. */
	rig.previewOf = () => ctl.previewOf(sim.context);
	rig.faceOf = () => ctl.faceOf(sim.context);
	/** Moves the panel to another member of this deck (the person selects
	 * another dial): the old panel disappears, the new one appears. */
	rig.openMember = (column) => {
		ctl.panelClosed(sim.context);
		quiet = true;
		sim.context = rig.contextAt(column);
		if (column === spec.column) sim.context = `ctx-${sim.fixture}`;
		sim.settings = structuredClone(settings.get(sim.context) ?? {});
	};
	/** Another dial's panel applies a change: the group's revision moves.
	 * With `hold`, every strip state for the open panel is held back from
	 * then on (still on its way) until `rig.holdState` is set false again,
	 * so the panel's next change is against an older revision. */
	rig.editFrom = (column, patch, { hold = false } = {}) => {
		const context = column === spec.column ? `ctx-${sim.fixture}` : rig.contextAt(column);
		const member = ctl.registry.member(context);
		const state = member?.copy === undefined ? undefined : ctl.registry.group(stripGroupKey(DEVICE, member.copy.id));
		const rev = state?.authority?.rev ?? 0;
		const replies = [];
		const send = host.sendToPanel;
		host.sendToPanel = (payload) => {
			if (payload?.event === "stripEditResult") replies.push(payload);
			else send(payload);
		};
		if (hold) rig.holdState = true;
		try {
			ctl.handlePi(context, { event: "stripEdit", opId: "elsewhere", groupId: member?.copy?.id, baseRev: rev, patch });
		} finally {
			host.sendToPanel = send;
		}
		return replies[0];
	};
	/** Takes a member off the deck (another plugin's action placed there,
	 * or a dial stack hiding it). */
	rig.hide = (column) => {
		const context = column === spec.column ? `ctx-${sim.fixture}` : rig.contextAt(column);
		ctl.disappear(context, column);
		dials.delete(context);
	};
	/** A Sensor Dial dragged to an empty slot. */
	rig.place = (column, doc) => {
		const id = rig.contextAt(column);
		const dial = new SimDial(rig, id, column);
		dials.set(id, dial);
		settings.set(id, structuredClone(doc));
		ctl.appear(dial, structuredClone(doc));
	};
	/** An encoder event on the dial at `column` (the app sends it to that
	 * context only). */
	rig.input = (column, event) => {
		const context = column === spec.column ? `ctx-${sim.fixture}` : rig.contextAt(column);
		ctl.input(context, { column, at: monotonicNow(), ...event });
	};
	/** The last slice each column was sent, as SVG text ("" where none). */
	rig.slices = () => Array.from({ length: spec.type === 13 ? 6 : 4 }, (_, column) => {
		const dial = dials.get(column === spec.column ? `ctx-${sim.fixture}` : rig.contextAt(column));
		const uri = dial?.feedback.at(-1) ?? "";
		return uri === "" ? "" : decodeURIComponent(uri.slice("data:image/svg+xml,".length));
	});
	rig.history = history;
	/** HWiNFO stops writing (true) or writes again (false), from the next tick. */
	rig.setStale = (on) => {
		stale = on;
	};
	rig.stop = () => {
		clearInterval(timer);
		ctl.dispose();
	};
	return rig;
}
