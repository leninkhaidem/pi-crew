// src/commands/tree.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { abortSubagentByStatePath } from "../runtime/kill.js";
import type { ExtensionRuntime } from "../runtime/types.js";
import type { SubagentState } from "../types.js";
import { openTreeOverlay } from "../ui/overlay.js";

export function registerTreeCommand(pi: ExtensionAPI, rt: ExtensionRuntime): void {
	pi.registerCommand("subagents", {
		description: "Open the pi-crew sub-agent tree overlay.",
		handler: async (_args, ctx) => {
			const sessionId = rt.resolveSessionId(ctx);
			await openTreeOverlay(ctx, rt.agentDir, sessionId, async (state: SubagentState) => {
				const reason = "killed from /subagents";
				const handled = await rt.abortActiveHandle(state.agentId, reason);
				if (!handled) await abortSubagentByStatePath(state.paths.state, reason);
			});
		},
	});
}
