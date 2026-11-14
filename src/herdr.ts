// Herdr (https://herdr.dev) marker: the next cue, as the pane's `$mox` metadata token in the Herdr TUI and as
// the terminal's `mox` label in the Herdr app. Display only: it never touches the agent's state in Herdr.
import { execFile } from "node:child_process";
import { createConnection } from "node:net";

/** The token's name, as a sidebar row names it (`$mox`), and the app label's name. */
export const HERDR_TOKEN = "mox";
/** Who reports the token. */
export const HERDR_SOURCE = "pi-mox";
/** Herdr drops the token this long after the last report: a Pi gone leaves nothing behind. */
export const HERDR_TTL_MS = 30_000;
/** A token unchanged is reported again this often, well inside its TTL. */
export const HERDR_REFRESH_MS = 10_000;

/** Sends one value (null clears it); resolves true when Herdr accepted it. */
export type HerdrSend = (value: string | null) => Promise<boolean>;

type Env = Record<string, string | undefined>;

/** The pane and socket of the Herdr pane this process runs in, or null outside one. */
export function herdrPane(env: Env = process.env): { pane: string; socket: string } | null {
	const pane = env.HERDR_PANE_ID?.trim();
	const socket = env.HERDR_SOCKET_PATH?.trim();
	return env.HERDR_ENV === "1" && pane && socket ? { pane, socket } : null;
}

/** The address of the Herdr app (hc) terminal this process runs in, or null outside one. */
export function herdrAppTerminal(env: Env = process.env): { terminal: string } | null {
	const terminal = env.HC_TERMINAL_ID?.trim();
	return terminal ? { terminal } : null;
}

/** The socket request that sets the token (with its TTL), or clears it (null). */
export function herdrReport(pane: string, value: string | null) {
	const params: { pane_id: string; source: string; tokens: Record<string, string | null>; ttl_ms?: number } = {
		pane_id: pane,
		source: HERDR_SOURCE,
		tokens: { [HERDR_TOKEN]: value },
	};
	if (value !== null) params.ttl_ms = HERDR_TTL_MS;
	return { method: "pane.report_metadata", params };
}

let requests = 0;

/** Sends the token over Herdr's socket (one JSON line, one reply); false on any error or after `timeoutMs`. */
export function herdrSend({ pane, socket }: { pane: string; socket: string }, { timeoutMs = 2000 } = {}): HerdrSend {
	return (value) =>
		new Promise((resolve) => {
			const id = `pi-mox-${process.pid}-${++requests}`;
			let reply = "";
			let done = false;
			const conn = createConnection(socket);
			const finish = (ok: boolean) => {
				if (done) return;
				done = true;
				clearTimeout(timer);
				conn.destroy();
				resolve(ok);
			};
			const timer = setTimeout(() => finish(false), timeoutMs);
			timer.unref();
			conn.on("connect", () => conn.write(`${JSON.stringify({ id, ...herdrReport(pane, value) })}\n`));
			conn.on("data", (data) => {
				reply += data;
				const end = reply.indexOf("\n");
				if (end < 0) return;
				try {
					const answer = JSON.parse(reply.slice(0, end));
					finish(answer.id === id && answer.result?.type === "ok");
				} catch {
					finish(false);
				}
			});
			conn.on("error", () => finish(false));
			conn.on("close", () => finish(false));
		});
}

/** Sets the terminal's `mox` label (`hc label <t> mox=<value>`; empty removes it); false on any error. */
export function herdrAppSend({ terminal }: { terminal: string }, { bin = "hc", timeoutMs = 2000 } = {}): HerdrSend {
	return (value) =>
		new Promise((resolve) => {
			execFile(bin, ["label", terminal, `${HERDR_TOKEN}=${value ?? ""}`], { timeout: timeoutMs, windowsHide: true }, (error) => resolve(!error));
		});
}

/**
 * Keeps Herdr in step with `update(value)` (null clears it): a report when the value changes, and again every
 * `refreshMs` while it stays; one report at a time (the latest value waits for the one on its way). A failed
 * report is tried again at the next update. `idle()` resolves once nothing is on its way.
 */
export function createHerdrPublisher({ send, now = Date.now, refreshMs = HERDR_REFRESH_MS }: { send: HerdrSend; now?: () => number; refreshMs?: number }) {
	let shown: string | null = null;
	let sentAt = 0;
	let inFlight: Promise<void> | null = null;
	let pending: string | null | undefined;
	const update = (value: string | null): void => {
		if (inFlight) {
			pending = value;
			return;
		}
		const due = value !== shown || (value !== null && now() - sentAt >= refreshMs);
		if (!due) return;
		let sending: Promise<boolean>;
		try {
			sending = Promise.resolve(send(value));
		} catch {
			sending = Promise.resolve(false);
		}
		inFlight = sending
			.catch(() => false)
			.then((ok) => {
				if (ok) {
					shown = value;
					sentAt = now();
				}
				inFlight = null;
				if (pending !== undefined) {
					const next = pending;
					pending = undefined;
					update(next);
				}
			});
	};
	return {
		update,
		async idle() {
			while (inFlight) await inFlight;
		},
	};
}
