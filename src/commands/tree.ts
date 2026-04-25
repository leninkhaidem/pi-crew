// src/commands/tree.ts
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ExtensionRuntime } from "../runtime/types.js";
import { openTreeOverlay } from "../ui/overlay.js";

export function registerTreeCommand(pi: ExtensionAPI, rt: ExtensionRuntime): void {
	pi.registerCommand("subagents", {
		description: "Open the pi-crew sub-agent tree overlay.",
		handler: async (_args, ctx) => {
			const sessionFile = ctx.sessionManager.getSessionFile();
			const sessionId = sessionFile ? path.basename(sessionFile, ".jsonl") : `ephemeral-${Date.now()}`;
			await openTreeOverlay(ctx, rt.agentDir, sessionId);
		},
	});
}
