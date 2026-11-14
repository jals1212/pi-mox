import assert from "node:assert/strict";
import { test } from "node:test";
import { registerMox } from "../src/wire.ts";
import { at } from "./helpers.ts";

const BRONZE = "\x1b[38;2;205;127;50m";
const H = 60 * 60_000;

class FakeText {
	text: string;
	x: number;
	y: number;
	constructor(text: string, x: number, y: number) {
		this.text = text;
		this.x = x;
		this.y = y;
	}
}

function setup(options: { hasUI?: boolean; sendThrows?: boolean } = {}) {
	let t = at(8, 24);
	let handle = 0;
	const timers = new Map<number, { fireAt: number; fn: () => void }>();
	const commands = new Map<string, any>();
	const renderers = new Map<string, any>();
	const events = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const sent: { message: any; options: any }[] = [];
	const notes: [string, string][] = [];
	const statuses: [string, string | undefined][] = [];
	const stderr: string[] = [];
	const pi = {
		registerCommand: (name: string, command: unknown) => void commands.set(name, command),
		registerMessageRenderer: (type: string, renderer: unknown) => void renderers.set(type, renderer),
		on: (event: string, fn: (event: unknown, ctx: unknown) => unknown) => void events.set(event, fn),
		sendMessage: (message: unknown, opts: unknown) => {
			if (options.sendThrows) throw new Error("not now");
			sent.push({ message, options: opts });
		},
	};
	registerMox(pi as never, {
		Text: FakeText as never,
		now: () => t,
		timers: {
			setTimer: (fn, ms) => {
				timers.set(++handle, { fireAt: t + ms, fn });
				return handle;
			},
			clearTimer: (h) => void timers.delete(h as number),
		},
		stderr: (text) => void stderr.push(text),
		env: {},
	});
	const ctx = {
		hasUI: options.hasUI ?? true,
		ui: {
			notify: (message: string, type = "info") => void notes.push([type, message]),
			setStatus: (key: string, text: string | undefined) => void statuses.push([key, text]),
		},
	};
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
	return { commands, renderers, events, sent, notes, statuses, stderr, timers, ctx, advance };
}

test("registers /mox, the mox message renderer, and the session hooks", () => {
	const s = setup();
	assert.ok(s.commands.has("mox"));
	assert.match(s.commands.get("mox").description, /^Schedule a message/);
	assert.ok(s.renderers.has("mox"));
	assert.ok(s.events.has("session_start"));
	assert.ok(s.events.has("session_shutdown"));
});

test("at its time the message is delivered verbatim as a followUp that triggers a turn", async () => {
	const s = setup();
	await s.commands.get("mox").handler("10:30 continúa con T3", s.ctx);
	assert.deepEqual(s.notes, [["info", "Scheduled I for 10:30 (in 2h06m): continúa con T3"]]);
	assert.deepEqual(s.statuses.at(-1), ["mox", "\x1b[38;2;205;127;50m·MOX·\x1b[39m \x1b[38;2;184;184;176m10:30 continúa con T3 · II h VI m\x1b[39m"]);
	assert.deepEqual(s.sent, []);
	s.advance(2 * H + 6 * 60_000);
	assert.equal(s.sent.length, 1);
	assert.deepEqual(s.sent[0].message, { customType: "mox", content: "continúa con T3", display: true, details: { id: "I", at: at(10, 30) } });
	assert.deepEqual(s.sent[0].options, { triggerTurn: true, deliverAs: "followUp" });
	assert.equal(s.statuses.at(-1)?.[1], undefined);
	assert.equal(s.statuses.at(-1)?.[0], "mox");
});

test("a delivery failure is reported as an error and not retried", async () => {
	const s = setup({ sendThrows: true });
	await s.commands.get("mox").handler("+1m x", s.ctx);
	s.notes.length = 0;
	s.advance(10 * 60_000);
	assert.deepEqual(s.notes, [["error", "·MOX· could not deliver I: not now"]]);
	assert.deepEqual(s.sent, []);
	assert.equal(s.timers.size, 0);
});

test("the renderer shows ·MOX· in bronze, the time and the message", () => {
	const s = setup();
	const render = s.renderers.get("mox");
	const theme = {};
	const out = render({ customType: "mox", content: "continúa con T3", details: { id: "I", at: at(10, 30) } }, { expanded: false, outputPad: 1 }, theme);
	assert.ok(out instanceof FakeText);
	assert.equal(out.text, `${BRONZE}·MOX·\x1b[39m \x1b[38;2;184;184;176m10:30 — continúa con T3\x1b[39m`);
	assert.equal(out.x, 1);
	assert.equal(out.y, 0);
	const bare = render({ customType: "mox", content: "no details" }, { expanded: false, outputPad: 1 }, theme);
	assert.equal(bare.text, `${BRONZE}·MOX·\x1b[39m \x1b[38;2;184;184;176mno details\x1b[39m`);
});

test("session_start brings the footer up for pending cues; session_shutdown clears timers, cues and footer", async () => {
	const s = setup();
	await s.events.get("session_start")!({}, s.ctx);
	await s.commands.get("mox").handler("10:30 one", s.ctx);
	await s.commands.get("mox").handler("14:00 two", s.ctx);
	assert.equal(s.timers.size, 1);
	await s.events.get("session_shutdown")!({}, s.ctx);
	assert.equal(s.timers.size, 0);
	assert.deepEqual(s.statuses.at(-1), ["mox", undefined]);
	s.notes.length = 0;
	await s.commands.get("mox").handler("list", s.ctx);
	assert.deepEqual(s.notes, [["info", "No pending cues."]]);
	s.advance(24 * H);
	assert.deepEqual(s.sent, []);
});

test("without a UI the notifications go to stderr and the footer is not touched", async () => {
	const s = setup({ hasUI: false });
	await s.commands.get("mox").handler("10:30 one", s.ctx);
	assert.deepEqual(s.stderr, ["Scheduled I for 10:30 (in 2h06m): one\n"]);
	assert.deepEqual(s.notes, []);
	assert.deepEqual(s.statuses, []);
	await s.commands.get("mox").handler("list", s.ctx);
	assert.equal(s.stderr[1], "I   10:30  2h06m  one\n");
	s.advance(3 * H);
	assert.equal(s.sent.length, 1);
});

test("the command completes subcommands and pending ids", async () => {
	const s = setup();
	await s.commands.get("mox").handler("10:30 one", s.ctx);
	const complete = s.commands.get("mox").getArgumentCompletions;
	assert.deepEqual(complete("").map((i: { value: string }) => i.value), ["list", "show", "cancel"]);
	assert.deepEqual(complete("cancel ").map((i: { value: string }) => i.value), ["cancel I"]);
	assert.equal(complete("x"), null);
});
