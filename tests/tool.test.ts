import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_AGENT_CUES, runMoxTool } from "../src/mox.ts";
import { at, harness } from "./helpers.ts";

const tool = (h: ReturnType<typeof harness>, params: Parameters<typeof runMoxTool>[0]) => runMoxTool(params, { mox: h.mox, now: h.now });

test("schedule adds an agent cue and answers like /mox", () => {
	const h = harness();
	assert.equal(tool(h, { action: "schedule", time: "10:30", message: "  continúa con T3 " }), "Scheduled I for 10:30 (in 2h06m): continúa con T3");
	assert.deepEqual(h.mox.list(), [{ id: 1, at: at(10, 30), message: "continúa con T3", by: "agent" }]);
	assert.equal(tool(h, { action: "schedule", time: "+45s", message: "x" }), "Scheduled II for 08:24 (in 1m): x");
	assert.equal(tool(h, { action: "schedule", time: "8:00", message: "y" }), "Scheduled III for 08:00 tomorrow (in 23h36m): y");
});

test("an agent cue is delivered like any other cue", () => {
	const h = harness();
	tool(h, { action: "schedule", time: "+1m", message: "go on" });
	h.advance(60_000);
	assert.deepEqual(h.sent, [{ id: 1, at: at(8, 25), message: "go on", by: "agent" }]);
	assert.deepEqual(h.mox.list(), []);
});

test("schedule rejects a bad time, a missing time or a missing message and changes nothing", () => {
	const h = harness();
	const cases: [Parameters<typeof runMoxTool>[0], string][] = [
		[{ action: "schedule", time: "24:00", message: "x" }, 'Invalid time "24:00". Use 10:30 (24-hour), 7:54pm or +2h15m.'],
		[{ action: "schedule", time: "+0m", message: "x" }, 'Invalid time "+0m". Use 10:30 (24-hour), 7:54pm or +2h15m.'],
		[{ action: "schedule", message: "x" }, "Missing time. Use 10:30 (24-hour), 7:54pm or +2h15m."],
		[{ action: "schedule", time: "10:30", message: "   " }, "Missing message."],
		[{ action: "schedule", time: "10:30" }, "Missing message."],
	];
	for (const [params, message] of cases) assert.throws(() => tool(h, params), { message });
	assert.deepEqual(h.mox.list(), []);
	assert.deepEqual(h.statuses, []);
	assert.equal(h.timers.size, 0);
});

test(`the agent can have at most ${MAX_AGENT_CUES} pending cues; user cues do not count`, () => {
	const h = harness();
	assert.equal(MAX_AGENT_CUES, 3);
	h.run("9:00 user cue");
	for (let i = 0; i < 3; i++) tool(h, { action: "schedule", time: `+${i + 1}m`, message: `a${i}` });
	assert.throws(() => tool(h, { action: "schedule", time: "+9m", message: "one too many" }), {
		message: "The agent already has 3 pending cues, the limit. Cancel one or wait for one to be delivered.",
	});
	assert.equal(h.mox.list().length, 4);
	h.advance(60_000);
	assert.equal(tool(h, { action: "schedule", time: "+9m", message: "again" }), "Scheduled V for 08:34 (in 9m): again");
});

test("list shows every pending cue in plain text and marks the agent's", () => {
	const h = harness({ hasUI: true });
	assert.equal(tool(h, { action: "list" }), "No pending cues.");
	h.run("14:00 corre la suite");
	tool(h, { action: "schedule", time: "10:30", message: "continúa con T3" });
	assert.equal(tool(h, { action: "list" }), "II  10:30  2h06m  continúa con T3 (agent)\nI   14:00  5h36m  corre la suite");
});

test("cancel removes the agent's own cue by Roman or Arabic id", () => {
	const h = harness();
	tool(h, { action: "schedule", time: "10:30", message: "one" });
	tool(h, { action: "schedule", time: "14:00", message: "two" });
	assert.equal(tool(h, { action: "cancel", id: "ii" }), "Cancelled II (14:00): two");
	assert.equal(tool(h, { action: "cancel", id: "1" }), "Cancelled I (10:30): one");
	assert.deepEqual(h.mox.list(), []);
});

test("cancel refuses user cues, unknown and invalid ids, and changes nothing", () => {
	const h = harness();
	h.run("10:30 user cue");
	tool(h, { action: "schedule", time: "14:00", message: "agent cue" });
	const before = h.mox.list();
	const cases: [Parameters<typeof runMoxTool>[0], string][] = [
		[{ action: "cancel", id: "I" }, "Cue I was scheduled by the user; the agent can cancel only its own cues."],
		[{ action: "cancel", id: "V" }, "No pending cue V."],
		[{ action: "cancel", id: "IIII" }, 'Invalid cue id "IIII".'],
		[{ action: "cancel", id: "0" }, 'Invalid cue id "0".'],
		[{ action: "cancel" }, "Missing cue id."],
	];
	for (const [params, message] of cases) assert.throws(() => tool(h, params), { message });
	assert.deepEqual(h.mox.list(), before);
});

test("an unknown action is rejected", () => {
	const h = harness();
	assert.throws(() => tool(h, { action: "snooze" as never }), { message: 'Unknown action "snooze". Use schedule, list or cancel.' });
});

test("/mox list, /mox show and the footer mark agent cues; the user can cancel them", () => {
	const h = harness();
	tool(h, { action: "schedule", time: "10:30", message: "continúa con T3" });
	assert.equal(h.status(), "·MOX· 10:30 continúa con T3 (agent) · II h VI m (2h06m)");
	h.run("list");
	h.run("show I");
	h.run("cancel I");
	assert.deepEqual(h.notes, [
		["info", "I   10:30  2h06m  continúa con T3 (agent)"],
		["info", "I  10:30  2h06m (agent)\ncontinúa con T3"],
		["info", "Cancelled I (10:30): continúa con T3"],
	]);
});

test("user cues keep their unmarked list, show and footer", () => {
	const h = harness();
	h.run("10:30 continúa con T3");
	h.run("list");
	h.run("show I");
	assert.equal(h.status(), "·MOX· 10:30 continúa con T3 · II h VI m (2h06m)");
	assert.deepEqual(h.notes.slice(1), [
		["info", "I   10:30  2h06m  continúa con T3"],
		["info", "I  10:30  2h06m\ncontinúa con T3"],
	]);
});
