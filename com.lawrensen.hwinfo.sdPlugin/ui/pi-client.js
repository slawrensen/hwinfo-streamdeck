/*! The panel client: the socket to the Stream Deck app and the two
   settings stores, ported from the client and stores of
   sdpi-components v4.0.1, Copyright Corsair Memory Inc. and other contributors (https://sdpi-components.dev),
   MIT (NOTICE.md). The panels draw no sdpi element, so the library's Lit
   elements stay out; what the panels call behaves as the library did:

   - connectElgatoStreamDeckSocket runs once. It hands the action's
     settings to the settings channel first, then the connection info,
     then opens the socket, registers, and only then lets sends through.
   - A message dispatches on its own channel before the generic one.
   - Each store is the first subscriber on its channel and holds the
     received document itself (pi-shell.js holds the same object). A
     store write sets one dotted path in place when it changes, and saves
     the whole document through the client's setSettings or
     setGlobalSettings, looked up on every save, so the shell sees it.
   - The shared document is asked for once, on the first shared binding. */
(() => {
	"use strict";

	/** Handlers in an array: a dispatch walks the array it started with,
	 * and unsubscribe swaps in a filtered copy (get() unsubscribes from
	 * inside a dispatch). */
	class Channel {
		constructor() {
			this.handlers = [];
		}
		dispatch(ev) {
			for (const fn of this.handlers) fn(ev);
		}
		subscribe(fn) {
			this.handlers.push(fn);
		}
		unsubscribe(fn) {
			this.handlers = this.handlers.filter((h) => h !== fn);
		}
	}

	const deferred = () => {
		const d = {};
		d.promise = new Promise((resolve) => (d.resolve = resolve));
		return d;
	};
	const read = (path, doc) => path.split(".").reduce((at, part) => at && at[part], doc);
	const write = (path, doc, value) => {
		const parts = path.split(".");
		parts.reduce((at, part, i) => (i === parts.length - 1 ? (at[part] = value) : at[part] || (at[part] = {})), doc);
	};

	const socket = deferred();
	const connection = deferred();
	let started = false;

	const client = {
		message: new Channel(),
		didReceiveGlobalSettings: new Channel(),
		didReceiveSettings: new Channel(),
		sendToPropertyInspector: new Channel(),
		async connect(port, uuid, registerEvent, info, actionInfo) {
			if (started) return;
			const conn = { actionInfo, info, propertyInspectorUUID: uuid, registerEvent };
			if (conn.actionInfo) this.didReceiveSettings.dispatch(conn.actionInfo);
			connection.resolve(conn);
			const ws = new WebSocket(`ws://localhost:${port}`);
			ws.onmessage = this.handleMessage.bind(this);
			ws.onopen = () => {
				ws.send(JSON.stringify({ event: conn.registerEvent, uuid: conn.propertyInspectorUUID }));
				socket.resolve(ws);
			};
			started = true;
		},
		async getGlobalSettings() {
			return (await this.get("getGlobalSettings", "didReceiveGlobalSettings")).payload.settings;
		},
		setGlobalSettings(doc) {
			return this.send("setGlobalSettings", doc);
		},
		setSettings(doc) {
			return this.send("setSettings", doc);
		},
		async getConnectionInfo() {
			return connection.promise;
		},
		/** Sends `event` and settles with the first `replyEvent` message
		 * that passes `filter`; it listens before it sends. */
		async get(event, replyEvent, filter, payload) {
			const reply = deferred();
			const take = (ev) => {
				if (ev.event === replyEvent && (filter === undefined || filter(ev))) {
					this.message.unsubscribe(take);
					reply.resolve(ev);
				}
			};
			this.message.subscribe(take);
			await this.send(event, payload);
			return reply.promise;
		},
		async send(event, payload) {
			const conn = await connection.promise;
			(await socket.promise).send(JSON.stringify({ event, context: conn.propertyInspectorUUID, payload, action: conn.actionInfo.action }));
		},
		handleMessage(raw) {
			const ev = JSON.parse(raw.data);
			if (ev.event === "didReceiveGlobalSettings") this.didReceiveGlobalSettings.dispatch(ev);
			else if (ev.event === "didReceiveSettings") this.didReceiveSettings.dispatch(ev);
			else if (ev.event === "sendToPropertyInspector") this.sendToPropertyInspector.dispatch(ev);
			this.message.dispatch(ev);
		}
	};

	/** The newest value wins; every caller's promise settles after its save. */
	function debounced(fn, ms) {
		let timer;
		let pending;
		return (value) => {
			clearTimeout(timer);
			pending = pending || deferred();
			timer = setTimeout(async () => {
				const done = pending;
				pending = undefined;
				await fn(value);
				done.resolve();
			}, ms);
			return pending.promise;
		};
	}

	class Store {
		constructor(channel, save) {
			this.channel = channel;
			this.save = save;
			this.ready = new Promise((resolve) => {
				channel.subscribe((ev) => {
					this._settings = ev.payload.settings;
					resolve();
				});
			});
		}
		/** [get, set] for one dotted path. `cb` hears the path on each
		 * received document; a `debounce` of null or 0 sets at once; `save`
		 * false stages the value for the next save. */
		use(path, cb, debounce = 250, save = true) {
			if (cb) {
				this.channel.subscribe((ev) => {
					if (ev?.payload?.settings !== undefined) cb(read(path, ev.payload.settings));
				});
			}
			const set = (value) => this.set(path, value, save);
			return [async () => (await this.ready, read(path, await this._settings)), debounce ? debounced(set, debounce) : set];
		}
		async set(path, value, save = true) {
			await this.ready;
			if (read(path, this._settings) !== value) {
				write(path, this._settings, value);
				if (save) await this.save(this._settings);
			}
		}
	}

	const settings = new Store(client.didReceiveSettings, (doc) => client.setSettings(doc));
	const globals = new Store(client.didReceiveGlobalSettings, (doc) => client.setGlobalSettings(doc));
	let askedGlobals = false;
	const useGlobalSettings = (path, cb, debounce = 250, save = true) => {
		if (!askedGlobals) {
			client.getGlobalSettings();
			askedGlobals = true;
		}
		return globals.use(path, cb, debounce, save);
	};

	const earlier = window.connectElgatoStreamDeckSocket;
	window.connectElgatoStreamDeckSocket = (port, uuid, registerEvent, info, actionInfo) => {
		if (earlier) earlier(port, uuid, registerEvent, info, actionInfo);
		client.connect(port, uuid, registerEvent, JSON.parse(info), JSON.parse(actionInfo));
	};
	window.SDPIComponents = { streamDeckClient: client, useSettings: settings.use.bind(settings), useGlobalSettings };

	// The library's scrollbar, in the same place in the cascade (ahead of
	// pi.css, which sets the page background itself).
	const style = document.createElement("style");
	style.textContent = "::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{-webkit-box-shadow:inset 0 0 6px rgba(0,0,0,.3);box-shadow:inset 0 0 6px rgba(0,0,0,.3)}::-webkit-scrollbar-thumb{background-color:#666;border-radius:5px;outline:1px solid #708090}";
	document.head.appendChild(style);
})();
