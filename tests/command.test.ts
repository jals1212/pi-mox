import assert from "node:assert/strict";
import { test } from "node:test";
import { completeMoxArgs, defaultTimers, USAGE } from "../src/mox.ts";
import { at, harness } from "./helpers.ts";

const H = 60 * 60_000;
const M = 60_000;
const BRONZE = "\x1b[38;2;205;127;50m";
const MARBLE = "\x1b[38;2;184;184;176m";
const tomorrow = (h: number, m: number) => new Date(2026, 4, 13, h, m).getTime();

// S1, S3: absolute and relative time.
test("/mox 10:30 <message> schedules it for later today and shows it in the footer", () => {
	const f = harness();
	f.run("10:30 continúa con T3");
	assert.deepEqual(f.notes, [["info", "Scheduled I for 10:30 (in 2h06m): continúa con T3"]]);
	assert.equal(f.status(), "·MOX· 10:30 · II h VI m");
	assert.deepEqual(f.mox.list(), [{ id: 1, at: at(10, 30), message: "continúa con T3" }]);
	assert.deepEqual(f.sent, []);
});

test("a time already passed is scheduled for tomorrow", () => {
	const f = harness({ start: at(14, 0) });
	f.run("10:30 buenos días");
	assert.deepEqual(f.notes, [["info", "Scheduled I for 10:30 tomorrow (in 20h30m): buenos días"]]);
	assert.equal(f.status(), "·MOX· 10:30 · XX h XXX m");
	assert.equal(f.mox.list()[0].at, tomorrow(10, 30));
});

test("a time equal to now is scheduled for tomorrow", () => {
	const f = harness({ start: at(10, 30) });
	f.run("10:30 again");
	assert.deepEqual(f.notes, [["info", "Scheduled I for 10:30 tomorrow (in 24h00m): again"]]);
	assert.equal(f.status(), "·MOX· 10:30 · XXIV h");
	assert.equal(f.mox.list()[0].at, tomorrow(10, 30));
	assert.deepEqual(f.sent, []);
});

test("relative times +2h15m, +90m and +45s", () => {
	const a = harness();
	a.run("+2h15m check build");
	assert.deepEqual(a.notes, [["info", "Scheduled I for 10:39 (in 2h15m): check build"]]);
	assert.equal(a.status(), "·MOX· 10:39 · II h XV m");

	const b = harness();
	b.run("+90m lunch");
	assert.deepEqual(b.notes, [["info", "Scheduled I for 09:54 (in 1h30m): lunch"]]);
	assert.equal(b.status(), "·MOX· 09:54 · I h XXX m");

	const c = harness();
	c.run("+45s quick");
	assert.deepEqual(c.notes, [["info", "Scheduled I for 08:24 (in 1m): quick"]]);
	assert.equal(c.status(), "·MOX· 08:24 · I m");
	assert.equal(c.mox.list()[0].at, at(8, 24, 45));
});

test("the message is the rest of the line, trimmed, verbatim", () => {
	const f = harness();
	f.run("  10:30   keep   the  spacing: a, b!  ");
	assert.equal(f.mox.list()[0].message, "keep   the  spacing: a, b!");
});

test("invalid times are rejected with the usage line and change nothing", () => {
	const f = harness();
	f.run("10:30 first");
	f.notes.length = 0;
	const statuses = f.statuses.length;
	const timers = f.setCalls.length;
	for (const bad of ["24:00", "10:60", "1030", "+0m", "+", "10:5", "+2x", "soon"]) {
		f.run(`${bad} message`);
		const [type, text] = f.notes.pop()!;
		assert.equal(type, "error", bad);
		assert.equal(text, `Invalid time "${bad}".\n${USAGE}`, bad);
		assert.equal(f.notes.length, 0, bad);
	}
	assert.deepEqual(f.mox.list().map((cue) => cue.message), ["first"]);
	assert.equal(f.statuses.length, statuses);
	assert.equal(f.setCalls.length, timers);
});

test("a missing message is rejected and changes nothing", () => {
	const f = harness();
	for (const args of ["10:30", "10:30   ", "+5m"]) f.run(args);
	assert.deepEqual(f.notes, [["error", `Missing message.\n${USAGE}`], ["error", `Missing message.\n${USAGE}`], ["error", `Missing message.\n${USAGE}`]]);
	assert.deepEqual(f.mox.list(), []);
	assert.deepEqual(f.statuses, []);
	assert.equal(f.timers.size, 0);
});

test("the usage line names the four forms", () => {
	assert.equal(USAGE, "Usage: /mox <time> <message>, /mox list, /mox show <id>, /mox cancel <id> (time: 10:30 or +2h15m)");
});

// S4, S8: list.
test("/mox list and bare /mox say so when nothing is pending", () => {
	const f = harness();
	f.run("list");
	f.run("");
	f.run("   ");
	assert.deepEqual(f.notes, [["info", "No pending cues."], ["info", "No pending cues."], ["info", "No pending cues."]]);
});

test("/mox list shows Roman id, HH:MM, remaining and message in the S8 format", () => {
	const f = harness();
	f.run("10:30 continúa con T3");
	f.run("14:00 corre la suite");
	f.notes.length = 0;
	f.run("list");
	assert.deepEqual(f.notes, [["info", "I   10:30  2h06m  continúa con T3\nII  14:00  5h36m  corre la suite"]]);
	f.notes.length = 0;
	f.run("");
	assert.deepEqual(f.notes, [["info", "I   10:30  2h06m  continúa con T3\nII  14:00  5h36m  corre la suite"]]);
});

test("/mox list shows a long or multi-line message as one line cut at 60 characters with …", () => {
	const f = harness();
	f.run(`10:30 Show the plan first\n  & 'C:\\Tools\\bootstrap.ps1' -App 'OAuth'\n${"x".repeat(80)}`);
	f.run("14:00 short\n\nsecond line");
	f.notes.length = 0;
	f.run("list");
	assert.deepEqual(f.notes, [
		[
			"info",
			"I   10:30  2h06m  Show the plan first & 'C:\\Tools\\bootstrap.ps1' -App 'OAuth'…\n" +
				"II  14:00  5h36m  short second line",
		],
	]);
	assert.equal(f.mox.list()[1].message, "short\n\nsecond line");
});

test("/mox list keeps a 60-character message and cuts a 61-character one to 59 plus …", () => {
	const f = harness();
	f.run(`10:30 ${"a".repeat(60)}`);
	f.run(`14:00 ${"b".repeat(61)}`);
	f.notes.length = 0;
	f.run("list");
	assert.deepEqual(f.notes, [["info", `I   10:30  2h06m  ${"a".repeat(60)}\nII  14:00  5h36m  ${"b".repeat(59)}…`]]);
});

test("/mox show <id> shows the whole message verbatim, by Roman or Arabic id", () => {
	const f = harness();
	const long = `Show the plan first\n  & 'C:\\Tools\\bootstrap.ps1' -App 'OAuth'\n${"x".repeat(80)}`;
	f.run(`10:30 ${long}`);
	f.notes.length = 0;
	f.run("show I");
	f.run("show 1");
	assert.deepEqual(f.notes, [["info", `I  10:30  2h06m\n${long}`], ["info", `I  10:30  2h06m\n${long}`]]);
});

test("/mox show rejects a missing, invalid or unknown id and changes nothing", () => {
	const f = harness();
	f.run("10:30 one");
	f.notes.length = 0;
	f.run("show");
	f.run("show abc");
	f.run("show V");
	assert.deepEqual(f.notes, [
		["error", `Missing cue id.\n${USAGE}`],
		["error", `Invalid cue id "abc".\n${USAGE}`],
		["error", `No pending cue V.\n${USAGE}`],
	]);
	assert.deepEqual(f.mox.list(), [{ id: 1, at: at(10, 30), message: "one" }]);
});

test("/mox list orders by time, not by id", () => {
	const f = harness();
	f.run("14:00 later");
	f.run("10:30 sooner");
	f.notes.length = 0;
	f.run("list");
	assert.deepEqual(f.notes, [["info", "II  10:30  2h06m  sooner\nI   14:00  5h36m  later"]]);
});

test("/mox list rejects extra words", () => {
	const f = harness();
	f.run("list now");
	assert.deepEqual(f.notes, [["error", `list takes no arguments.\n${USAGE}`]]);
});

test("with a UI, list ids are bronze and the rest marble; without one it is plain", () => {
	const f = harness({ hasUI: true });
	f.run("10:30 a");
	f.notes.length = 0;
	f.run("list");
	assert.deepEqual(f.notes, [["info", `${BRONZE}I \x1b[39m  ${MARBLE}10:30  2h06m  a\x1b[39m`]]);
});

// S4: cancel.
test("/mox cancel accepts a Roman id in either case or an Arabic id", () => {
	for (const [arg, label, rest] of [["II", "II", "I III"], ["ii", "II", "I III"], ["2", "II", "I III"], ["iii", "III", "I II"], ["1", "I", "II III"]]) {
		const f = harness();
		f.run("10:30 one");
		f.run("11:00 two");
		f.run("12:00 three");
		f.notes.length = 0;
		f.run(`cancel ${arg}`);
		const cancelled = f.mox.list().length;
		assert.equal(cancelled, 2, arg);
		assert.equal(f.notes.length, 1, arg);
		assert.equal(f.notes[0][0], "info");
		assert.match(f.notes[0][1], new RegExp(`^Cancelled ${label} \\(\\d\\d:\\d\\d\\): `), arg);
		assert.equal(
			f.mox.list().map((cue) => cue.id).sort().join(" "),
			rest.split(" ").map((r) => ({ I: 1, II: 2, III: 3 })[r as "I"]).sort().join(" "),
			arg,
		);
	}
});

test("cancelling reports the cue, updates the footer and stops it from firing", () => {
	const f = harness();
	f.run("10:30 one");
	f.run("14:00 two");
	f.notes.length = 0;
	f.run("cancel I");
	assert.deepEqual(f.notes, [["info", "Cancelled I (10:30): one"]]);
	assert.equal(f.status(), "·MOX· 14:00 · V h XXXVI m");
	f.advance(10 * H);
	assert.deepEqual(f.sent, [{ id: 2, at: at(14, 0), message: "two" }]);
});

test("cancelling the last cue clears the footer and the timer", () => {
	const f = harness();
	f.run("10:30 one");
	f.run("cancel 1");
	assert.equal(f.status(), undefined);
	assert.equal(f.timers.size, 0);
	assert.deepEqual(f.mox.list(), []);
	f.advance(24 * H);
	assert.deepEqual(f.sent, []);
});

test("an unknown id is an error and changes nothing", () => {
	const f = harness();
	f.run("10:30 one");
	f.notes.length = 0;
	const statuses = f.statuses.length;
	f.run("cancel V");
	f.run("cancel 9");
	assert.deepEqual(f.notes, [["error", `No pending cue V.\n${USAGE}`], ["error", `No pending cue IX.\n${USAGE}`]]);
	assert.equal(f.mox.list().length, 1);
	assert.equal(f.statuses.length, statuses);
});

test("cancel with a missing or malformed id is an error and changes nothing", () => {
	const f = harness();
	f.run("10:30 one");
	f.notes.length = 0;
	f.run("cancel");
	f.run("cancel foo");
	f.run("cancel 0");
	f.run("cancel I II");
	assert.deepEqual(f.notes, [
		["error", `Missing cue id.\n${USAGE}`],
		["error", `Invalid cue id "foo".\n${USAGE}`],
		["error", `Invalid cue id "0".\n${USAGE}`],
		["error", `Invalid cue id "I II".\n${USAGE}`],
	]);
	assert.equal(f.mox.list().length, 1);
});

test("an id is cancelled once; the second time it is unknown", () => {
	const f = harness();
	f.run("10:30 one");
	f.run("cancel I");
	f.notes.length = 0;
	f.run("cancel I");
	assert.deepEqual(f.notes, [["error", `No pending cue I.\n${USAGE}`]]);
});

// Ids.
test("ids are never reused, after cancel or after firing", () => {
	const f = harness();
	f.run("10:30 one");
	f.run("11:00 two");
	f.run("cancel II");
	f.run("12:00 three");
	assert.deepEqual(f.mox.list().map((cue) => cue.id), [1, 3]);
	f.advance(2 * H + 10 * M);
	assert.deepEqual(f.sent.map((cue) => cue.id), [1]);
	f.run("18:00 four");
	f.run("cancel III");
	f.run("19:00 five");
	assert.deepEqual(f.mox.list().map((cue) => cue.id), [4, 5]);
	f.notes.length = 0;
	f.run("list");
	assert.match(f.notes[0][1], /^IV {2}18:00 .*\nV {3}19:00 /);
});

// S1, S6, S7: scheduler and firing.
test("a cue fires once at its time and is removed", () => {
	const f = harness();
	f.run("10:30 continúa con T3");
	f.advance(2 * H + 5 * M);
	assert.deepEqual(f.sent, []);
	assert.equal(f.status(), "·MOX· 10:30 · I m");
	f.advance(M);
	assert.deepEqual(f.sent, [{ id: 1, at: at(10, 30), message: "continúa con T3" }]);
	assert.deepEqual(f.mox.list(), []);
	assert.equal(f.status(), undefined);
	assert.equal(f.timers.size, 0);
	f.advance(48 * H);
	assert.equal(f.sent.length, 1);
});

test("due cues fire in time order, not creation order", () => {
	const f = harness();
	f.run("14:00 second");
	f.run("10:30 first");
	f.jump(6 * H);
	f.advance(0);
	assert.deepEqual(f.sent.map((cue) => cue.message), ["first", "second"]);
	assert.deepEqual(f.mox.list(), []);
	assert.equal(f.status(), undefined);
});

test("cues due at the same time fire in id order", () => {
	const f = harness();
	f.run("10:30 a");
	f.run("10:30 b");
	f.run("10:30 c");
	f.advance(3 * H);
	assert.deepEqual(f.sent.map((cue) => cue.message), ["a", "b", "c"]);
});

test("an overdue cue fires after a clock jump (the machine slept), once", () => {
	const f = harness();
	f.run("10:30 overdue");
	f.jump(5 * H);
	assert.deepEqual(f.sent, []);
	f.advance(0);
	assert.deepEqual(f.sent, [{ id: 1, at: at(10, 30), message: "overdue" }]);
	assert.deepEqual(f.mox.list(), []);
	f.advance(24 * H);
	assert.equal(f.sent.length, 1);
});

test("one timer at most, re-armed for at most 30 seconds, shorter when a cue is closer", () => {
	const f = harness();
	f.run("10:30 far");
	f.run("14:00 farther");
	assert.equal(f.timers.size, 1);
	assert.deepEqual(f.setCalls.at(-1), 30_000);
	f.run("+10s soon");
	assert.equal(f.timers.size, 1);
	assert.equal(f.setCalls.at(-1), 10_000);
	f.advance(10_000);
	assert.deepEqual(f.sent.map((cue) => cue.message), ["soon"]);
	assert.equal(f.timers.size, 1);
	assert.equal([...f.timers.values()][0].ms, 30_000);
});

test("the footer counts down as time passes", () => {
	const f = harness();
	f.run("10:30 one");
	assert.equal(f.status(), "·MOX· 10:30 · II h VI m");
	f.advance(6 * M);
	assert.equal(f.status(), "·MOX· 10:30 · II h");
	f.advance(H + 30 * M + 31_000);
	assert.equal(f.status(), "·MOX· 10:30 · XXX m");
});

test("the footer adds (+N) when more cues wait and shows the nearest first", () => {
	const f = harness();
	f.run("14:00 later");
	assert.equal(f.status(), "·MOX· 14:00 · V h XXXVI m");
	f.run("10:30 sooner");
	assert.equal(f.status(), "·MOX· 10:30 · II h VI m (+1)");
	f.run("12:00 middle");
	assert.equal(f.status(), "·MOX· 10:30 · II h VI m (+2)");
	f.run("cancel II");
	assert.equal(f.status(), "·MOX· 12:00 · III h XXXVI m (+1)");
});

test("with a UI the footer paints ·MOX· bronze and the rest marble", () => {
	const f = harness({ hasUI: true });
	f.run("10:30 a");
	assert.equal(f.status(), `${BRONZE}·MOX·\x1b[39m ${MARBLE}10:30 · II h VI m\x1b[39m`);
});

test("a delivery failure is reported once, not retried, and the other cues still fire", () => {
	const f = harness({
		send: (cue) => {
			if (cue.message === "boom") throw new Error("send failed");
		},
	});
	f.run("10:30 boom");
	f.run("10:30 fine");
	f.advance(3 * H);
	assert.deepEqual(f.sent.map((cue) => cue.message), ["boom", "fine"]);
	assert.equal(f.errors.length, 1);
	assert.equal((f.errors[0][0] as Error).message, "send failed");
	assert.equal(f.errors[0][1].message, "boom");
	assert.deepEqual(f.mox.list(), []);
	f.advance(24 * H);
	assert.equal(f.sent.length, 2);
});

// S5: memory only.
test("shutdown clears timers, cues and the footer", () => {
	const f = harness();
	f.run("10:30 one");
	f.run("14:00 two");
	f.mox.shutdown();
	assert.equal(f.timers.size, 0);
	assert.deepEqual(f.mox.list(), []);
	assert.equal(f.status(), undefined);
	f.jump(10 * H);
	f.advance(10 * H);
	assert.deepEqual(f.sent, []);
	f.notes.length = 0;
	f.run("list");
	assert.deepEqual(f.notes, [["info", "No pending cues."]]);
});

test("the real timers are unref'd so they never keep Pi alive", () => {
	let fired = false;
	const handle = defaultTimers.setTimer(() => void (fired = true), 60_000) as NodeJS.Timeout;
	assert.equal(handle.hasRef(), false);
	defaultTimers.clearTimer(handle);
	assert.equal(fired, false);
});

// Autocompletion.
test("completions: subcommands, then pending ids after cancel", () => {
	const f = harness();
	f.run("14:00 later");
	f.run("10:30 sooner");
	const values = (prefix: string) => completeMoxArgs(prefix, f.mox)?.map((item) => item.value) ?? null;
	assert.deepEqual(values(""), ["list", "show", "cancel"]);
	assert.deepEqual(values("s"), ["show"]);
	assert.deepEqual(values("show "), ["show I", "show II"]);
	assert.deepEqual(values("c"), ["cancel"]);
	assert.deepEqual(values("l"), ["list"]);
	assert.deepEqual(values("10"), null);
	assert.deepEqual(values("cancel "), ["cancel I", "cancel II"]);
	assert.deepEqual(values("cancel I"), ["cancel I", "cancel II"]);
	assert.deepEqual(values("cancel II"), ["cancel II"]);
	assert.deepEqual(values("cancel V"), null);
	assert.deepEqual(values("cancel I "), null);
	assert.deepEqual(values("list "), null);
	f.run("cancel I");
	assert.deepEqual(values("cancel "), ["cancel II"]);
	f.mox.shutdown();
	assert.deepEqual(values("cancel "), null);
});
