// pi-mox: schedule a message for the agent. Adds /mox, the ·MOX· footer and the delivered-message renderer.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { registerMox } from "../src/wire.ts";

export default function (pi: ExtensionAPI) {
	registerMox(pi, { Text });
}
