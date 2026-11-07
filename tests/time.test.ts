import assert from "node:assert/strict";
import { test } from "node:test";
import { formatClock, formatRemaining, formatRemainingRoman, fromRoman, parseSchedule, toRoman } from "../src/mox.ts";
import { at } from "./helpers.ts";

// S8: ids and the footer countdown are Roman numerals.
test("toRoman writes canonical Roman numerals", () => {
	const cases: [number, string][] = [[1, "I"], [2, "II"], [4, "IV"], [6, "VI"], [9, "IX"], [14, "XIV"], [30, "XXX"], [40, "XL"], [90, "XC"], [400, "CD"], [1994, "MCMXCIV"], [3999, "MMMCMXCIX"]];
	for (const [n, roman] of cases) assert.equal(toRoman(n), roman);
});

test("fromRoman reads Roman numerals in any case and nothing else", () => {
	assert.equal(fromRoman("II"), 2);
	assert.equal(fromRoman("ii"), 2);
	assert.equal(fromRoman("Xiv"), 14);
	assert.equal(fromRoman("MCMXCIV"), 1994);
	for (const bad of ["", "IIII", "IC", "VX", "2", "foo", "I I"]) assert.equal(fromRoman(bad), undefined, bad);
});

// S3: absolute time, today or tomorrow.
test("an absolute time is today when it is still ahead", () => {
	assert.equal(parseSchedule("10:30", at(8, 24)), at(10, 30));
	assert.equal(parseSchedule("9:05", at(8, 24)), at(9, 5));
	assert.equal(parseSchedule("23:59", at(8, 24)), at(23, 59));
});

test("an absolute time that has passed is tomorrow", () => {
	assert.equal(parseSchedule("10:30", at(14, 0)), new Date(2026, 4, 13, 10, 30).getTime());
	assert.equal(parseSchedule("10:30", at(10, 30, 20)), new Date(2026, 4, 13, 10, 30).getTime());
	assert.equal(parseSchedule("0:00", at(8, 24)), new Date(2026, 4, 13, 0, 0).getTime());
});

test("an absolute time equal to now is tomorrow", () => {
	assert.equal(parseSchedule("10:30", at(10, 30)), new Date(2026, 4, 13, 10, 30).getTime());
});

test("a relative time adds hours, minutes and seconds to now", () => {
	assert.equal(parseSchedule("+2h15m", at(8, 24)), at(10, 39));
	assert.equal(parseSchedule("+90m", at(8, 24)), at(9, 54));
	assert.equal(parseSchedule("+45s", at(8, 24)), at(8, 24, 45));
	assert.equal(parseSchedule("+1h30s", at(8, 24)), at(9, 24, 30));
	assert.equal(parseSchedule("+3h", at(8, 24)), at(11, 24));
});

test("invalid times are rejected", () => {
	for (const bad of ["24:00", "10:60", "1030", "10:5", "+0m", "+0h0m0s", "+", "+2x", "+15m2h", "+2h 15m", "-5m", "abc", "", "10:30:00", "+99999999h"])
		assert.equal(parseSchedule(bad, at(8, 24)), undefined, JSON.stringify(bad));
});

test("formatClock shows local HH:MM with a leading zero", () => {
	assert.equal(formatClock(at(10, 30)), "10:30");
	assert.equal(formatClock(at(8, 5)), "08:05");
	assert.equal(formatClock(at(0, 0)), "00:00");
});

// S8 list: Arabic remaining; S8 footer: Roman remaining.
test("formatRemaining rounds minutes up and omits hours below one", () => {
	assert.equal(formatRemaining((2 * 60 + 6) * 60_000), "2h06m");
	assert.equal(formatRemaining(2 * 60 * 60_000), "2h00m");
	assert.equal(formatRemaining(45 * 60_000), "45m");
	assert.equal(formatRemaining(2 * 60 * 60_000 + 1), "2h01m");
	assert.equal(formatRemaining(45_000), "1m");
	assert.equal(formatRemaining(0), "1m");
});

test("formatRemainingRoman: minutes rounded up, hours omitted at 0, under a minute is I m", () => {
	assert.equal(formatRemainingRoman((2 * 60 + 6) * 60_000), "II h VI m");
	assert.equal(formatRemainingRoman((2 * 60 + 5) * 60_000 + 1000), "II h VI m");
	assert.equal(formatRemainingRoman(45 * 60_000), "XLV m");
	assert.equal(formatRemainingRoman(30_000), "I m");
	assert.equal(formatRemainingRoman(1), "I m");
	assert.equal(formatRemainingRoman(0), "I m");
	assert.equal(formatRemainingRoman(2 * 60 * 60_000), "II h");
	assert.equal(formatRemainingRoman(20 * 60 * 60_000 + 30 * 60_000), "XX h XXX m");
});
