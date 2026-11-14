// Real loopback peers exercise the browser client's failure boundary. These
// tests need neither Chromium nor Windows and never touch a user's browser.
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { WebSocketServer } from "ws";
import { connectCdp, createPageTarget, waitForInitialDocument } from "../scripts/lib/cdp.mjs";

async function peer(t, handler, options = {}) {
	const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
	let client;
	t.after(async () => {
		client?.close();
		for (const socket of server.clients) socket.terminate();
		await new Promise((resolve) => server.close(resolve));
	});
	server.on("connection", (socket) => socket.on("message", (bytes) => handler(socket, JSON.parse(bytes.toString()))));
	await once(server, "listening");
	client = await connectCdp(`ws://127.0.0.1:${server.address().port}`, { commandTimeoutMs: 500, navigationTimeoutMs: 500, ...options });
	return client;
}

test("CDP correlates concurrent replies and preserves protocol failures", { timeout: 5000 }, async (t) => {
	const received = [];
	const client = await peer(t, (socket, message) => {
		received.push(message);
		if (received.length !== 2) return;
		socket.send(JSON.stringify({ id: received[1].id, error: { message: "unknown command" } }));
		socket.send(JSON.stringify({ id: received[0].id, result: { value: 42 } }));
	});
	const results = await Promise.allSettled([client.send("Runtime.good"), client.send("Runtime.bad")]);
	assert.deepEqual(results[0], { status: "fulfilled", value: { value: 42 } });
	assert.equal(results[1].status, "rejected");
	assert.match(results[1].reason.message, /Runtime\.bad: unknown command/);
});

test("CDP times out a missing reply and ignores its late reply without poisoning the next call", { timeout: 5000 }, async (t) => {
	let first;
	const client = await peer(t, (socket, message) => {
		if (first === undefined) { first = message; return; }
		socket.send(JSON.stringify({ id: first.id, result: { stale: true } }));
		socket.send(JSON.stringify({ id: message.id, result: { current: true } }));
	}, { commandTimeoutMs: 60 });
	await assert.rejects(client.send("Runtime.withheld"), /Runtime\.withheld: CDP command timed out after 60 ms/);
	assert.deepEqual(await client.send("Runtime.next"), { current: true });
});

test("CDP socket closure rejects every outstanding call and refuses new calls", { timeout: 5000 }, async (t) => {
	let count = 0;
	const client = await peer(t, (socket) => { if (++count === 2) socket.close(1011, "browser stopped"); });
	const results = await Promise.allSettled([client.send("Runtime.first"), client.send("Runtime.second")]);
	for (const result of results) {
		assert.equal(result.status, "rejected");
		assert.match(result.reason.message, /CDP socket closed \(1011\)/);
	}
	await assert.rejects(client.send("Runtime.afterClose"), /CDP socket closed/);
});

test("CDP malformed responses reject pending calls instead of escaping the socket callback", { timeout: 5000 }, async (t) => {
	const client = await peer(t, (socket) => socket.send("{broken"));
	await assert.rejects(client.send("Runtime.first"), /Invalid CDP response/);
	await assert.rejects(client.send("Runtime.afterFailure"), /Invalid CDP response/);
});

test("CDP client cleanup rejects in-flight work and is repeatable", { timeout: 5000 }, async (t) => {
	const client = await peer(t, () => {});
	const pending = client.send("Runtime.waiting");
	client.close();
	client.close();
	await assert.rejects(pending, /CDP connection closed by client/);
});

test("CDP refuses a stalled WebSocket handshake within its connect deadline", { timeout: 5000 }, async (t) => {
	const server = createServer();
	const sockets = new Set();
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
	});
	server.on("upgrade", () => {}); // Accept TCP, deliberately never answer the upgrade.
	t.after(async () => {
		for (const socket of sockets) socket.destroy();
		await new Promise((resolve) => server.close(resolve));
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	await assert.rejects(connectCdp(`ws://127.0.0.1:${server.address().port}`, { connectTimeoutMs: 60 }), /CDP connect timed out after 60 ms/);
});

test("CDP socket errors fail the handshake with the original cause", { timeout: 5000 }, async (t) => {
	const server = createServer((_request, response) => { response.writeHead(503); response.end(); });
	t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	await assert.rejects(connectCdp(`ws://127.0.0.1:${server.address().port}`), /CDP socket error: Unexpected server response: 503/);
});

test("navigation errors fail even if a load event arrives first", { timeout: 5000 }, async (t) => {
	const client = await peer(t, (socket, message) => {
		socket.send(JSON.stringify({ method: "Page.loadEventFired", params: {} }));
		socket.send(JSON.stringify({ id: message.id, result: { frameId: "main", errorText: "net::ERR_CONNECTION_REFUSED" } }));
	});
	await assert.rejects(client.goto("http://127.0.0.1/unavailable"), /Page\.navigate: net::ERR_CONNECTION_REFUSED/);
});

test("a navigation failure retains its protocol result and ordered document evidence", { timeout: 5000 }, async (t) => {
	const client = await peer(t, (socket, message) => {
		const emit = (method, params) => socket.send(JSON.stringify({ method, params }));
		emit("Network.requestWillBeSent", { type: "Document", requestId: "request", frameId: "main", loaderId: "load", request: { url: "http://127.0.0.1/file", method: "GET" } });
		emit("Network.responseReceived", { type: "Document", requestId: "request", response: { status: 200, mimeType: "application/octet-stream", headers: { "Content-Disposition": "attachment" } } });
		emit("Network.loadingFailed", { type: "Document", requestId: "request", errorText: "net::ERR_ABORTED", canceled: true });
		socket.send(JSON.stringify({ id: message.id, result: { frameId: "main", loaderId: "load", errorText: "net::ERR_ABORTED", isDownload: true } }));
	});
	await assert.rejects(client.goto("http://127.0.0.1/file"), (error) => {
		assert.match(error.message, /net::ERR_ABORTED.*"isDownload":true/);
		assert.equal(error.cdpNavigation.result.isDownload, true);
		assert.deepEqual(error.cdpNavigation.events.map((e) => e.method), ["Network.requestWillBeSent", "Network.responseReceived", "Network.loadingFailed"]);
		assert.equal(error.cdpNavigation.events[1].detail.response.headers["Content-Disposition"], "attachment");
		assert.equal(error.cdpNavigation.events[2].detail.canceled, true);
		return true;
	});
});

test("navigation failure evidence is bounded and excludes unrelated subresource requests", { timeout: 5000 }, async (t) => {
	const client = await peer(t, (socket, message) => {
		socket.send(JSON.stringify({ method: "Network.requestWillBeSent", params: { type: "Image" } }));
		for (let i = 0; i < 70; i++) socket.send(JSON.stringify({ method: "Page.lifecycleEvent", params: { name: "init", frameId: "main", loaderId: `load-${i}` } }));
		socket.send(JSON.stringify({ id: message.id, result: { frameId: "main", errorText: "net::ERR_ABORTED" } }));
	});
	await assert.rejects(client.goto("http://127.0.0.1/fails"), (error) => {
		assert.equal(error.cdpNavigation.events.length, 64);
		assert.equal(error.cdpNavigation.droppedEvents, 6);
		assert.equal(error.cdpNavigation.events[0].detail.loaderId, "load-6");
		return true;
	});
});

test("navigation without a load event fails, then a later navigation can complete", { timeout: 5000 }, async (t) => {
	let count = 0;
	const client = await peer(t, (socket, message) => {
		socket.send(JSON.stringify({ id: message.id, result: { frameId: "main", loaderId: `load-${++count}` } }));
		if (count === 2) socket.send(JSON.stringify({ method: "Page.lifecycleEvent", params: { name: "load", frameId: "main", loaderId: "load-2" } }));
	}, { navigationTimeoutMs: 60 });
	await assert.rejects(client.goto("http://127.0.0.1/never-loads"), /Page\.navigate: load timed out after 60 ms/);
	await client.goto("http://127.0.0.1/loads");
});

test("navigation cannot pass on a load event when its command never replies", { timeout: 5000 }, async (t) => {
	const client = await peer(t, (socket) => socket.send(JSON.stringify({ method: "Page.lifecycleEvent", params: { name: "load", frameId: "main", loaderId: "early" } })), { commandTimeoutMs: 60 });
	await assert.rejects(client.goto("http://127.0.0.1/no-command-result"), /Page\.navigate: CDP command timed out/);
});

test("a previous page or a child frame cannot satisfy the current navigation", { timeout: 5000 }, async (t) => {
	let count = 0;
	const client = await peer(t, (socket, message) => {
		socket.send(JSON.stringify({ id: message.id, result: { frameId: "main", loaderId: `load-${++count}` } }));
		if (count !== 2) return;
		for (const params of [
			{ name: "load", frameId: "main", loaderId: "load-1" },
			{ name: "load", frameId: "child", loaderId: "load-2" },
			{ name: "DOMContentLoaded", frameId: "main", loaderId: "load-2" }
		]) socket.send(JSON.stringify({ method: "Page.lifecycleEvent", params }));
		socket.send(JSON.stringify({ method: "Page.loadEventFired", params: {} }));
	}, { navigationTimeoutMs: 60 });
	await assert.rejects(client.goto("http://127.0.0.1/previous"), /load timed out/);
	await assert.rejects(client.goto("http://127.0.0.1/current"), /load timed out/);
});

test("a matching lifecycle load received before the navigation reply is retained", { timeout: 5000 }, async (t) => {
	const client = await peer(t, (socket, message) => {
		for (const loaderId of ["old", "current"]) {
			socket.send(JSON.stringify({ method: "Page.lifecycleEvent", params: { name: "load", frameId: "main", loaderId } }));
		}
		socket.send(JSON.stringify({ id: message.id, result: { frameId: "main", loaderId: "current" } }));
	});
	await client.goto("http://127.0.0.1/fast");
});

test("browser loss after navigation acceptance rejects the load wait", { timeout: 5000 }, async (t) => {
	const client = await peer(t, (socket, message) => {
		socket.send(JSON.stringify({ id: message.id, result: { frameId: "main", loaderId: "loading" } }));
		socket.close(1011);
	});
	await assert.rejects(client.goto("http://127.0.0.1/loading"), /CDP socket closed \(1011\)/);
});

test("same-document navigation completes without waiting for an event that cannot fire", { timeout: 5000 }, async (t) => {
	const client = await peer(t, (socket, message) => socket.send(JSON.stringify({ id: message.id, result: { frameId: "main" } })));
	await client.goto("http://127.0.0.1/page#section");
});

test("a download is not accepted as a loaded page", { timeout: 5000 }, async (t) => {
	const client = await peer(t, (socket, message) => socket.send(JSON.stringify({ id: message.id, result: { frameId: "main", isDownload: true } })));
	await assert.rejects(client.goto("http://127.0.0.1/file"), /download instead of a page/);
});

test("page creation attaches the returned target, never the preexisting startup page", { timeout: 5000 }, async (t) => {
	const requests = [];
	const attached = [];
	let origin;
	const target = (id) => ({ type: "page", id, webSocketDebuggerUrl: `${origin.replace("http:", "ws:")}/devtools/page/${id}` });
	const server = createServer((request, response) => {
		requests.push({ method: request.method, url: request.url });
		response.setHeader("content-type", "application/json");
		if (request.method === "PUT" && request.url === "/json/new?about:blank") response.end(JSON.stringify(target("owned")));
		else if (request.url === "/json/list") response.end(JSON.stringify([target("startup"), target("owned")]));
		else { response.writeHead(404); response.end(); }
	});
	const sockets = new WebSocketServer({ server });
	let client;
	sockets.on("connection", (socket, request) => {
		attached.push(request.url);
		socket.on("message", (bytes) => socket.send(JSON.stringify({ id: JSON.parse(bytes.toString()).id, result: { target: request.url } })));
	});
	t.after(async () => {
		client?.close();
		for (const socket of sockets.clients) socket.terminate();
		await new Promise((resolve) => sockets.close(resolve));
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	origin = `http://127.0.0.1:${server.address().port}`;
	const created = await createPageTarget(origin);
	client = await connectCdp(created.webSocketDebuggerUrl);
	assert.deepEqual(await client.send("Runtime.identify"), { target: "/devtools/page/owned" });
	assert.deepEqual(requests, [{ method: "PUT", url: "/json/new?about:blank" }]);
	assert.deepEqual(attached, ["/devtools/page/owned"]);
});

test("page creation refuses a socket that names a different target", { timeout: 5000 }, async (t) => {
	const server = createServer((_request, response) => response.end(JSON.stringify({
		type: "page", id: "owned", webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/devtools/page/startup`
	})));
	t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	await assert.rejects(createPageTarget(`http://127.0.0.1:${server.address().port}`), /socket for a different target or browser/);
});

test("page creation failure is not retried with an unrelated page", { timeout: 5000 }, async (t) => {
	let requests = 0;
	const server = createServer((_request, response) => { requests++; response.writeHead(503); response.end(); });
	t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	await assert.rejects(createPageTarget(`http://127.0.0.1:${server.address().port}`), /page creation failed: HTTP 503/);
	assert.equal(requests, 1);
});

test("page creation times out a stalled response body", { timeout: 5000 }, async (t) => {
	const server = createServer((_request, response) => { response.writeHead(200, { "content-type": "application/json" }); response.write('{"type":'); });
	t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	await assert.rejects(createPageTarget(`http://127.0.0.1:${server.address().port}`, 60), (error) => error.name === "AbortError" || error.name === "TimeoutError");
});

test("startup waits for a committed blank page, not an already-complete initial placeholder", { timeout: 5000 }, async (t) => {
	let histories = 0;
	let evaluatedBeforeCommit = false;
	const client = await peer(t, (socket, message) => {
		let result;
		if (message.method === "Page.getNavigationHistory") {
			result = ++histories === 1 ? { currentIndex: -1, entries: [] } : { currentIndex: 0, entries: [{ url: "about:blank" }] };
		} else if (message.method === "Page.getFrameTree") {
			result = { frameTree: { frame: { id: "main", url: "about:blank", loaderId: histories === 1 ? "placeholder" : "committed" } } };
		} else if (message.method === "Runtime.evaluate") {
			evaluatedBeforeCommit ||= histories === 1;
			result = { result: { value: { ready: "complete", url: "about:blank" } } };
		}
		socket.send(JSON.stringify({ id: message.id, result }));
	});
	await waitForInitialDocument(client, 500);
	assert.equal(histories, 2);
	assert.equal(evaluatedBeforeCommit, false);
});

test("startup rechecks when the document loader changes during its readiness check", { timeout: 5000 }, async (t) => {
	let frames = 0;
	const client = await peer(t, (socket, message) => {
		let result;
		if (message.method === "Page.getNavigationHistory") result = { currentIndex: 0, entries: [{ url: "about:blank" }] };
		else if (message.method === "Page.getFrameTree") result = { frameTree: { frame: { id: "main", url: "about:blank", loaderId: ++frames === 1 ? "old" : "settled" } } };
		else if (message.method === "Runtime.evaluate") result = { result: { value: { ready: "complete", url: "about:blank" } } };
		socket.send(JSON.stringify({ id: message.id, result }));
	});
	await waitForInitialDocument(client, 500);
	assert.equal(frames, 4);
});

test("startup fails instead of navigating a fixture when no initial page commits", { timeout: 5000 }, async (t) => {
	const client = await peer(t, (socket, message) => {
		const result = message.method === "Page.getNavigationHistory" ? { currentIndex: -1, entries: [] } : { frameTree: { frame: { id: "main", url: "about:blank", loaderId: "placeholder" } } };
		socket.send(JSON.stringify({ id: message.id, result }));
	});
	await assert.rejects(waitForInitialDocument(client, 60), /initial about:blank did not settle within 60 ms/);
});
