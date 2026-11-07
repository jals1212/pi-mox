// pi-mox wiring: connects the core (src/mox.ts) to Pi's extension API. Pi runtime values (the `Text` component)
// are passed in by extensions/mox.ts, so this file has type-only imports and runs under plain `node --test`.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Text } from "@earendil-works/pi-tui";
import { completeMoxArgs, createMox, defaultTimers, renderMoxText, runMoxCommand, toRoman, type Timers } from "./mox.ts";

export interface WireOptions {
	Text: typeof Text;
	now?: () => number;
	timers?: Timers;
	/** Where notifications go when there is no UI (print and JSON modes); stdout stays free for Pi's output. */
	stderr?: (text: string) => void;
}

export function registerMox(pi: ExtensionAPI, options: WireOptions): void {
	const now = options.now ?? Date.now;
	const timers = options.timers ?? defaultTimers;
	const stderr = options.stderr ?? ((text: string) => void process.stderr.write(text));

	// The UI of the latest session or command context; cues are shared by the whole Pi process.
	let ui: { hasUI: boolean; ui: ExtensionContext["ui"] } | undefined;
	const use = (ctx: ExtensionContext) => {
		ui = { hasUI: ctx.hasUI, ui: ctx.ui };
	};
	const notify = (message: string, type: "info" | "warning" | "error" = "info") => {
		if (ui?.hasUI) ui.ui.notify(message, type);
		else stderr(`${message}\n`);
	};

	const mox = createMox({
		...timers,
		now,
		color: () => ui?.hasUI === true,
		setStatus: (text) => {
			if (ui?.hasUI) ui.ui.setStatus("mox", text);
		},
		// Fired once, queued behind the current run: starts a turn when idle, waits when busy.
		send: (cue) =>
			pi.sendMessage(
				{ customType: "mox", content: cue.message, display: true, details: { id: toRoman(cue.id), at: cue.at } },
				{ triggerTurn: true, deliverAs: "followUp" },
			),
		onError: (error, cue) => notify(`·MOX· could not deliver ${toRoman(cue.id)}: ${error instanceof Error ? error.message : String(error)}`, "error"),
	});

	pi.registerMessageRenderer("mox", (message, renderOptions) => {
		const at = (message.details as { at?: unknown } | undefined)?.at;
		const content = typeof message.content === "string" ? message.content : message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
		return new options.Text(renderMoxText(content, typeof at === "number" ? at : undefined), renderOptions.outputPad ?? 1, 0);
	});

	pi.registerCommand("mox", {
		description: "Schedule a message for the agent: /mox <10:30|+2h15m> <message>, /mox list, /mox cancel <id>",
		getArgumentCompletions: (prefix) => completeMoxArgs(prefix, mox),
		handler: async (args, ctx) => {
			use(ctx);
			runMoxCommand(args, { ctx: { hasUI: ctx.hasUI, ui: { notify } }, mox, now });
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		use(ctx);
	});

	// Cues live in memory only: a closed session keeps none of them.
	pi.on("session_shutdown", async () => {
		mox.shutdown();
		ui = undefined;
	});
}
