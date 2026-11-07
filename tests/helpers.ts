import { createMox, runMoxCommand, type Cue, type CommandDeps, type Mox } from "../src/mox.ts";

/** Local wall-clock time on 2026-05-12 (month index 4), as epoch milliseconds. */
export const at = (h: number, m: number, s = 0, ms = 0): number => new Date(2026, 4, 12, h, m, s, ms).getTime();

export interface Harness {
	mox: Mox;
	deps: CommandDeps;
	notes: [string, string][];
	/** Every text passed to the status line, in order (`undefined` = cleared). */
	statuses: (string | undefined)[];
	sent: Cue[];
	errors: [unknown, Cue][];
	/** Pending timers: handle -> { fireAt, ms }. */
	timers: Map<number, { fireAt: number; ms: number; fn: () => void }>;
	setCalls: number[];
	clearCalls: number;
	now(): number;
	/** Run the command through the public runner. */
	run(args: string): void;
	/** Move the clock forward, firing timers when they come due, like a running process. */
	advance(ms: number): void;
	/** Move the clock forward without firing anything (the machine slept). */
	jump(ms: number): void;
	status(): string | undefined;
}

export function harness(options: { start?: number; hasUI?: boolean; send?: (cue: Cue) => void } = {}): Harness {
	let t = options.start ?? at(8, 24);
	let nextHandle = 1;
	const h: Harness = {
		notes: [],
		statuses: [],
		sent: [],
		errors: [],
		timers: new Map(),
		setCalls: [],
		clearCalls: 0,
		now: () => t,
		status: () => h.statuses.at(-1),
		jump: (ms) => void (t += ms),
		advance(ms) {
			const end = t + ms;
			for (;;) {
				const due = [...h.timers.entries()].filter(([, timer]) => timer.fireAt <= end).sort((a, b) => a[1].fireAt - b[1].fireAt)[0];
				if (!due) break;
				h.timers.delete(due[0]);
				t = Math.max(t, due[1].fireAt);
				due[1].fn();
			}
			t = Math.max(t, end);
		},
		run: (args) => runMoxCommand(args, h.deps),
	} as Harness;
	h.mox = createMox({
		now: () => t,
		setTimer(fn, ms) {
			const handle = nextHandle++;
			h.timers.set(handle, { fireAt: t + ms, ms, fn });
			h.setCalls.push(ms);
			return handle;
		},
		clearTimer(handle) {
			h.clearCalls++;
			h.timers.delete(handle as number);
		},
		send: (cue) => {
			h.sent.push(cue);
			options.send?.(cue);
		},
		setStatus: (text) => void h.statuses.push(text),
		onError: (error, cue) => void h.errors.push([error, cue]),
		color: () => options.hasUI === true,
	});
	h.deps = {
		ctx: { hasUI: options.hasUI ?? false, ui: { notify: (message, type = "info") => void h.notes.push([type, message]) } },
		mox: h.mox,
		now: () => t,
	};
	return h;
}
