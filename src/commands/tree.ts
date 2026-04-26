// src/commands/tree.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { abortSubagentByStatePath } from "../runtime/kill.js";
import type { ExtensionRuntime } from "../runtime/types.js";
import type { SubagentState } from "../types.js";
import { openTreeOverlay } from "../ui/overlay.js";

export function registerTreeCommand(pi: ExtensionAPI, rt: ExtensionRuntime): void {
	pi.registerCommand("tasks", {
		description: "Open the pi-crew active task panel.",
		handler: async (_args, ctx) => {
			const sessionId = rt.resolveSessionId(ctx);
			const batchId = rt.getCurrentBatchId(ctx);
			await openTreeOverlay(ctx, rt.agentDir, sessionId, batchId, async (state: SubagentState) => {
				const reason = "killed from /tasks";
				const handled = await rt.abortActiveHandle(state.agentId, reason);
				if (!handled) await abortSubagentByStatePath(state.paths.state, reason);
			});
		},
	});
}
