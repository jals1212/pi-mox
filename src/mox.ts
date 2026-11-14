// pi-mox core: time parsing, Roman numerals, the cue list and its wall-clock scheduler, and the /mox command.
// No Pi runtime imports here (see src/wire.ts for the wiring), so everything runs under plain `node --test`.

export const USAGE = "Usage: /mox <time> <message>, /mox list, /mox show <id>, /mox cancel <id> (time: 10:30 or +2h15m)";

/** A pending cue: a message to deliver at `at` (epoch milliseconds). `id` is shown as a Roman numeral. */
export interface Cue {
	id: number;
	at: number;
	message: string;
}

export interface Timers {
	setTimer(fn: () => void, ms: number): unknown;
	clearTimer(handle: unknown): void;
}

export interface MoxOptions extends Timers {
	now(): number;
	/** Deliver a due cue. Called once per cue, in time order; a throw goes to `onError`, never retried. */
	send(cue: Cue): void;
	/** Show the footer text, or clear it (`undefined`). */
	setStatus(text: string | undefined): void;
	/** Show the plain marker of the next cue (`·MOX· 10:30 <preview>`), or clear it (`undefined`). */
	setMarker?(text: string | undefined): void;
	onError?(error: unknown, cue: Cue): void;
	/** Paint the footer with ANSI colors (only when there is a UI). */
	color?(): boolean;
}

export interface Mox {
	add(at: number, message: string): Cue;
	cancel(id: number): Cue | undefined;
	/** Pending cues, nearest first. */
	list(): Cue[];
	/** Clear every timer, cue and the footer; ids start again from I. */
	shutdown(): void;
}

export interface CommandDeps {
	ctx: { hasUI: boolean; ui: { notify(message: string, type?: "info" | "warning" | "error"): void } };
	mox: Mox;
	now(): number;
}

// --- Colors (24-bit ANSI): bronze and marble gray. ---

const BRONZE = [205, 127, 50] as const; // #CD7F32
const MARBLE = [184, 184, 176] as const; // #B8B8B0

const paint = (rgb: readonly [number, number, number], text: string, on: boolean): string =>
	on ? `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${text}\x1b[39m` : text;

const BRAND = "·MOX·";

// --- Roman numerals ---

const ROMAN: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];

/** Canonical Roman numeral for 1..3999; larger numbers (and anything below 1) fall back to Arabic digits. */
export function toRoman(n: number): string {
	if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n);
	let rest = n;
	let out = "";
	for (const [value, letters] of ROMAN) {
		while (rest >= value) {
			out += letters;
			rest -= value;
		}
	}
	return out;
}

/** The number a canonical Roman numeral (any case) stands for, or undefined. */
export function fromRoman(text: string): number | undefined {
	const upper = text.toUpperCase();
	if (!/^[IVXLCDM]+$/.test(upper)) return undefined;
	let total = 0;
	let rest = upper;
	for (const [value, letters] of ROMAN) {
		while (rest.startsWith(letters)) {
			total += value;
			rest = rest.slice(letters.length);
		}
	}
	return rest === "" && total <= 3999 && toRoman(total) === upper ? total : undefined;
}

// --- Time ---

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local HH:MM. */
export function formatClock(at: number): string {
	const d = new Date(at);
	return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const minutesLeft = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

/** Remaining time for lists: `2h06m`, or `45m` under an hour; minutes rounded up. */
export function formatRemaining(ms: number): string {
	const total = minutesLeft(ms);
	const hours = Math.floor(total / 60);
	return hours > 0 ? `${hours}h${pad2(total % 60)}m` : `${total}m`;
}

/** Remaining time for the footer, in Roman numerals: `II h VI m`; hours omitted at 0, minutes at 0. */
export function formatRemainingRoman(ms: number): string {
	const total = minutesLeft(ms);
	const hours = Math.floor(total / 60);
	const minutes = total % 60;
	const parts: string[] = [];
	if (hours > 0) parts.push(`${toRoman(hours)} h`);
	if (minutes > 0) parts.push(`${toRoman(minutes)} m`);
	return parts.join(" ");
}

const ABSOLUTE = /^(\d{1,2}):(\d{2})$/;
const RELATIVE = /^\+(?:(\d{1,7})h)?(?:(\d{1,7})m)?(?:(\d{1,7})s)?$/;

/**
 * Epoch milliseconds for a time token, or undefined when it is not valid.
 * `H:MM`/`HH:MM` (24-hour) is today, or tomorrow when that time is not after `now`;
 * `+2h15m`, `+90m`, `+45s` (h, m, s in that order, total > 0) is that long from `now`.
 */
export function parseSchedule(token: string, now: number): number | undefined {
	const abs = ABSOLUTE.exec(token);
	if (abs) {
		const hours = Number(abs[1]);
		const minutes = Number(abs[2]);
		if (hours > 23 || minutes > 59) return undefined;
		const target = new Date(now);
		target.setHours(hours, minutes, 0, 0);
		if (target.getTime() <= now) target.setDate(target.getDate() + 1);
		return target.getTime();
	}
	const rel = RELATIVE.exec(token);
	if (rel && (rel[1] !== undefined || rel[2] !== undefined || rel[3] !== undefined)) {
		const total = (Number(rel[1] ?? 0) * 3600 + Number(rel[2] ?? 0) * 60 + Number(rel[3] ?? 0)) * 1000;
		return total > 0 ? now + total : undefined;
	}
	return undefined;
}

// --- Timers ---

/** Real timers; the handle is unref'd so a pending cue never keeps Pi alive. */
export const defaultTimers: Timers = {
	setTimer(fn, ms) {
		const handle = setTimeout(fn, ms);
		handle.unref();
		return handle;
	},
	clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

// --- Cue list and scheduler ---

/** The timer re-checks the wall clock at least this often, so a machine that slept fires overdue cues on waking. */
const TICK_MS = 30_000;

const byTime = (a: Cue, b: Cue) => a.at - b.at || a.id - b.id;

export function createMox(options: MoxOptions): Mox {
	let cues: Cue[] = [];
	let nextId = 1;
	let handle: unknown;
	let armed = false;

	const statusText = (): string | undefined => {
		const sorted = [...cues].sort(byTime);
		const next = sorted[0];
		if (!next) return undefined;
		const more = sorted.length > 1 ? ` (+${sorted.length - 1})` : "";
		const rest = `${formatClock(next.at)} ${previewMessage(next.message)} · ${formatRemainingRoman(next.at - options.now())}${more}`;
		const color = options.color?.() ?? false;
		return `${paint(BRONZE, BRAND, color)} ${paint(MARBLE, rest, color)}`;
	};

	const markerText = (): string | undefined => {
		const next = [...cues].sort(byTime)[0];
		return next && `${BRAND} ${formatClock(next.at)} ${previewMessage(next.message)}`;
	};

	const show = () => {
		options.setStatus(statusText());
		options.setMarker?.(markerText());
	};

	const disarm = () => {
		if (armed) options.clearTimer(handle);
		armed = false;
	};

	const arm = () => {
		disarm();
		const next = [...cues].sort(byTime)[0];
		if (!next) return;
		handle = options.setTimer(tick, Math.max(0, Math.min(TICK_MS, next.at - options.now())));
		armed = true;
	};

	const tick = () => {
		armed = false;
		const now = options.now();
		const due = cues.filter((cue) => cue.at <= now).sort(byTime);
		cues = cues.filter((cue) => cue.at > now);
		for (const cue of due) {
			try {
				options.send(cue);
			} catch (error) {
				options.onError?.(error, cue);
			}
		}
		show();
		arm();
	};

	const changed = () => {
		show();
		arm();
	};

	return {
		add(at, message) {
			const cue = { id: nextId++, at, message };
			cues.push(cue);
			changed();
			return cue;
		},
		cancel(id) {
			const cue = cues.find((candidate) => candidate.id === id);
			if (!cue) return undefined;
			cues = cues.filter((candidate) => candidate !== cue);
			changed();
			return cue;
		},
		list: () => [...cues].sort(byTime).map((cue) => ({ ...cue })),
		shutdown() {
			disarm();
			cues = [];
			nextId = 1;
			options.setStatus(undefined);
			options.setMarker?.(undefined);
		},
	};
}

// --- Command ---

const PREVIEW_CHARS = 60;

/** One-line preview for lists: whitespace runs collapse to one space; over 60 characters it ends in `…`. */
export function previewMessage(message: string): string {
	const line = message.replace(/\s+/g, " ").trim();
	return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS - 1).trimEnd()}…` : line;
}

const parseId = (text: string) => (/^\d+$/.test(text) ? Number(text) : fromRoman(text));

const dayStart = (ms: number) => new Date(new Date(ms).setHours(0, 0, 0, 0)).getTime();

function dayLabel(at: number, now: number): string {
	const days = Math.round((dayStart(at) - dayStart(now)) / 86_400_000);
	if (days === 0) return "";
	if (days === 1) return " tomorrow";
	const d = new Date(at);
	return ` ${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** `/mox <args>`: schedule, list or cancel. Results and errors go through `ctx.ui.notify`. */
export function runMoxCommand(args: string, deps: CommandDeps): void {
	const { ctx, mox } = deps;
	const info = (message: string) => ctx.ui.notify(message, "info");
	const fail = (message: string) => ctx.ui.notify(`${message}\n${USAGE}`, "error");
	const text = args.trim();
	const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text);
	const word = match?.[1];
	const rest = match?.[2]?.trim() ?? "";

	if (word === undefined || word === "list") {
		if (rest !== "") return fail("list takes no arguments.");
		const cues = mox.list();
		if (cues.length === 0) return info("No pending cues.");
		const now = deps.now();
		const width = Math.max(2, ...cues.map((cue) => toRoman(cue.id).length));
		return info(
			cues
				.map((cue) => {
					const line = `${formatClock(cue.at)}  ${formatRemaining(cue.at - now)}  ${previewMessage(cue.message)}`;
					return `${paint(BRONZE, toRoman(cue.id).padEnd(width), ctx.hasUI)}  ${paint(MARBLE, line, ctx.hasUI)}`;
				})
				.join("\n"),
		);
	}

	if (word === "show") {
		if (rest === "") return fail("Missing cue id.");
		const id = parseId(rest);
		if (id === undefined || id < 1) return fail(`Invalid cue id "${rest}".`);
		const cue = mox.list().find((candidate) => candidate.id === id);
		if (!cue) return fail(`No pending cue ${toRoman(id)}.`);
		const head = `${toRoman(cue.id)}  ${formatClock(cue.at)}  ${formatRemaining(cue.at - deps.now())}`;
		return info(`${paint(BRONZE, head, ctx.hasUI)}\n${paint(MARBLE, cue.message, ctx.hasUI)}`);
	}

	if (word === "cancel") {
		if (rest === "") return fail("Missing cue id.");
		const id = parseId(rest);
		if (id === undefined || id < 1) return fail(`Invalid cue id "${rest}".`);
		const cue = mox.cancel(id);
		if (!cue) return fail(`No pending cue ${toRoman(id)}.`);
		return info(`Cancelled ${toRoman(cue.id)} (${formatClock(cue.at)}): ${cue.message}`);
	}

	const now = deps.now();
	const at = parseSchedule(word, now);
	if (at === undefined) return fail(`Invalid time "${word}".`);
	if (rest === "") return fail("Missing message.");
	const cue = mox.add(at, rest);
	info(`Scheduled ${toRoman(cue.id)} for ${formatClock(at)}${dayLabel(at, now)} (in ${formatRemaining(at - now)}): ${rest}`);
}

/** Autocompletion: `list`, `show`, `cancel`, and pending ids after `show` or `cancel`. */
export function completeMoxArgs(prefix: string, mox: Mox): { value: string; label: string }[] | null {
	const words = prefix.split(" ");
	if (words.length === 1) {
		const items = ["list", "show", "cancel"].filter((sub) => sub.startsWith(words[0])).map((sub) => ({ value: sub, label: sub }));
		return items.length > 0 ? items : null;
	}
	const sub = words[0];
	if (words.length !== 2 || (sub !== "cancel" && sub !== "show")) return null;
	const typed = words[1].toUpperCase();
	const items = mox
		.list()
		.sort((a, b) => a.id - b.id)
		.filter((cue) => toRoman(cue.id).startsWith(typed) || String(cue.id).startsWith(typed))
		.map((cue) => ({
			value: `${sub} ${toRoman(cue.id)}`,
			label: `${toRoman(cue.id)}  ${formatClock(cue.at)}  ${previewMessage(cue.message)}`,
		}));
	return items.length > 0 ? items : null;
}

/** Text of a delivered cue: `·MOX· 10:30 — <message>`, ·MOX· in bronze, the rest in marble. */
export function renderMoxText(content: string, at: number | undefined): string {
	const body = at === undefined ? content : `${formatClock(at)} — ${content}`;
	return `${paint(BRONZE, BRAND, true)} ${paint(MARBLE, body, true)}`;
}
