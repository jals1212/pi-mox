import assert from "node:assert/strict";
import { test } from "node:test";
import { createHerdrPublisher, herdrAppTerminal, herdrPane, herdrReport } from "../src/herdr.ts";
import { registerMox } from "../src/wire.ts";
import { at } from "./helpers.ts";

const H = 60 * 60_000;

test("herdrPane needs HERDR_ENV=1, a pane id and a socket; herdrAppTerminal needs HC_TERMINAL_ID", () => {
	assert.deepEqual(herdrPane({ HERDR_ENV: "1", HERDR_PANE_ID: "p1", HERDR_SOCKET_PATH: "/s" }), { pane: "p1", socket: "/s" });
	assert.equal(herdrPane({ HERDR_PANE_ID: "p1", HERDR_SOCKET_PATH: "/s" }), null);
	assert.equal(herdrPane({ HERDR_ENV: "1", HERDR_SOCKET_PATH: "/s" }), null);
	assert.deepEqual(herdrAppTerminal({ HC_TERMINAL_ID: " t9 " }), { terminal: "t9" });
	assert.equal(herdrAppTerminal({}), null);
});

test("herdrReport sets the $mox token with a TTL, and clears it without one", () => {
	assert.deepEqual(herdrReport("p1", "·MOX· 10:30 x"), {
		method: "pane.report_metadata",
		params: { pane_id: "p1", source: "pi-mox", tokens: { mox: "·MOX· 10:30 x" }, ttl_ms: 30_000 },
	});
	assert.deepEqual(herdrReport("p1", null), { method: "pane.report_metadata", params: { pane_id: "p1", source: "pi-mox", tokens: { mox: null } } });
});

test("the publisher reports changes, refreshes an unchanged value, and retries a failed report", async () => {
	let t = 0;
	const sent: (string | null)[] = [];
	let ok = true;
	const p = createHerdrPublisher({ send: async (v) => (sent.push(v), ok), now: () => t, refreshMs: 10_000 });
	p.update("a");
	await p.idle();
	p.update("a");
	await p.idle();
	assert.deepEqual(sent, ["a"]);
	t = 10_000;
	p.update("a");
	await p.idle();
	assert.deepEqual(sent, ["a", "a"]);
	ok = false;
	p.update(null);
	await p.idle();
	ok = true;
	p.update(null);
	await p.idle();
	assert.deepEqual(sent, ["a", "a", null, null]);
});

function setup(env: Record<string, string>) {
	let t = at(8, 24);
	let handle = 0;
	const timers = new Map<number, { fireAt: number; fn: () => void }>();
	const commands = new Map<string, any>();
	const events = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const pane: (string | null)[] = [];
	const app: (string | null)[] = [];
	const pi = {
		registerCommand: (name: string, command: unknown) => void commands.set(name, command),
		registerMessageRenderer: () => {},
		on: (event: string, fn: (event: unknown, ctx: unknown) => unknown) => void events.set(event, fn),
		sendMessage: () => {},
	};
	registerMox(pi as never, {
		Text: class {} as never,
		now: () => t,
		timers: {
			setTimer: (fn, ms) => {
				timers.set(++handle, { fireAt: t + ms, fn });
				return handle;
			},
			clearTimer: (h) => void timers.delete(h as number),
		},
		env,
		herdrSend: { pane: async (v) => (pane.push(v), true), app: async (v) => (app.push(v), true) },
	});
	const ctx = { hasUI: true, ui: { notify: () => {}, setStatus: () => {} } };
	const advance = (ms: number) => {
		const end = t + ms;
		for (;;) {
			const due = [...timers.entries()].filter(([, x]) => x.fireAt <= end).sort((a, b) => a[1].fireAt - b[1].fireAt)[0];
			if (!due) break;
			timers.delete(due[0]);
			t = Math.max(t, due[1].fireAt);
			due[1].fn();
		}
		t = Math.max(t, end);
	};
	const flush = () => new Promise((resolve) => setImmediate(resolve));
	return { commands, events, ctx, pane, app, timers, advance, flush };
}

const BOTH = { HERDR_ENV: "1", HERDR_PANE_ID: "p1", HERDR_SOCKET_PATH: "/s", HC_TERMINAL_ID: "t1" };

test("in Herdr the marker shows the next cue, plain: ·MOX· <time> <preview>, in the pane token and the app label", async () => {
	const s = setup(BOTH);
	await s.events.get("session_start")!({}, s.ctx);
	await s.commands.get("mox").handler("14:00 corre la suite", s.ctx);
	await s.flush();
	await s.commands.get("mox").handler("10:30 revisar\n  PR", s.ctx);
	await s.flush();
	assert.deepEqual(s.pane, ["·MOX· 14:00 corre la suite", "·MOX· 10:30 revisar PR"]);
	assert.deepEqual(s.app, ["·MOX· 14:00 corre la suite", "·MOX· 10:30 revisar PR"]);
	s.advance(2 * H + 6 * 60_000);
	await s.flush();
	assert.equal(s.pane.at(-1), "·MOX· 14:00 corre la suite");
	assert.equal(s.app.at(-1), "·MOX· 14:00 corre la suite");
	await s.commands.get("mox").handler("cancel I", s.ctx);
	await s.flush();
	assert.equal(s.pane.at(-1), null);
	assert.equal(s.app.at(-1), null);
});

test("the pane token is reported again every 10 seconds while a cue waits; the app label is not", async () => {
	const s = setup(BOTH);
	await s.events.get("session_start")!({}, s.ctx);
	await s.commands.get("mox").handler("10:30 x", s.ctx);
	await s.flush();
	s.advance(10_000);
	await s.flush();
	s.advance(10_000);
	await s.flush();
	assert.deepEqual(s.pane, ["·MOX· 10:30 x", "·MOX· 10:30 x", "·MOX· 10:30 x"]);
	assert.deepEqual(s.app, ["·MOX· 10:30 x"]);
});

test("session_shutdown clears the marker and leaves no timer", async () => {
	const s = setup(BOTH);
	await s.events.get("session_start")!({}, s.ctx);
	await s.commands.get("mox").handler("10:30 x", s.ctx);
	await s.flush();
	await s.events.get("session_shutdown")!({}, s.ctx);
	await s.flush();
	assert.equal(s.pane.at(-1), null);
	assert.equal(s.app.at(-1), null);
	assert.equal(s.timers.size, 0);
});

test("outside Herdr nothing is reported and no refresh timer is set", async () => {
	const s = setup({});
	await s.events.get("session_start")!({}, s.ctx);
	await s.commands.get("mox").handler("10:30 x", s.ctx);
	await s.flush();
	assert.deepEqual(s.pane, []);
	assert.deepEqual(s.app, []);
	assert.equal(s.timers.size, 1);
});
