import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { EV } from "../notify/events.js";
import { abortSubagentById } from "../runtime/kill.js";
import type { ExtensionRuntime } from "../runtime/types.js";

export function registerKillTool(pi: ExtensionAPI, rt: ExtensionRuntime): void {
	pi.registerTool({
		name: "subagent_kill",
		label: "Subagent kill",
		description: "Abort a running sub-agent (SIGTERM, then SIGKILL after 5s). Args: { agentId, reason? }",
		parameters: Type.Object({
			agentId: Type.String(),
			reason: Type.Optional(Type.String()),
		}),
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const result = await abortSubagentById(rt.agentDir, params.agentId, params.reason ?? "killed by user");
			if (!result.ok && result.error === "not_found") {
				return {
					content: [{ type: "text" as const, text: `No sub-agent #${params.agentId} found.` }],
					details: { error: "not_found" },
				};
			}
			if (!result.ok) {
				return {
					content: [{ type: "text" as const, text: "State unreadable." }],
					details: { error: "state_unreadable" },
				};
			}
			pi.events.emit(EV.killed, {
				agentId: params.agentId,
				reason: params.reason,
				killed: result.killed,
			});
			const verb = result.alreadyTerminal ? "Already stopped" : "Killed";
			return {
				content: [{ type: "text" as const, text: `${verb} #${params.agentId}: ${params.reason ?? ""}` }],
				details: { agentId: params.agentId, killed: result.killed },
			};
		},
	});
}
