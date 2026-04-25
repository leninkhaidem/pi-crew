// src/commands/tree.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ExtensionRuntime } from "../runtime/types.js";
import { openTreeOverlay } from "../ui/overlay.js";

export function registerTreeCommand(pi: ExtensionAPI, rt: ExtensionRuntime): void {
	pi.registerCommand("subagents", {
		description: "Open the pi-crew sub-agent tree overlay.",
		handler: async (_args, ctx) => {
			const sessionId = rt.resolveSessionId(ctx);
			await openTreeOverlay(ctx, rt.agentDir, sessionId);
		},
	});
}
