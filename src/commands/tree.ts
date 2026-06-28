// src/commands/tree.ts
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { abortSubagentByStatePath } from "../runtime/kill.js";
import type { ExtensionRuntime } from "../runtime/types.js";
import type { SubagentState } from "../types.js";
import { openSubagentsOverlay } from "../ui/overlay.js";

export function registerTreeCommand(pi: ExtensionAPI, rt: ExtensionRuntime): void {
	const handler = async (_args: unknown, ctx: ExtensionCommandContext) => {
		const sessionId = rt.resolveSessionId(ctx);
		const batchId = rt.getCurrentBatchId(ctx);
		await openSubagentsOverlay(ctx, rt.agentDir, sessionId, batchId, async (state: SubagentState) => {
			const reason = "killed from /subagents";
			const handled = await rt.abortActiveHandle(state.agentId, reason);
			if (!handled) await abortSubagentByStatePath(state.paths.state, reason);
		});
	};

	pi.registerCommand("subagents", {
		description: "Open the pi-crew active sub-agents overlay.",
		handler,
	});
	pi.registerCommand("tasks", {
		description: "Alias for /subagents.",
		handler,
	});
}
