// src/tools/steer.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import type { ExtensionRuntime } from "../runtime/types.js";

export function registerSteerTool(pi: ExtensionAPI, rt: ExtensionRuntime): void {
	pi.registerTool({
		name: "steer_subagent",
		label: "Steer subagent",
		description: [
			"Send a steering message to a running session-mode sub-agent.",
			"The message is injected into the sub-agent conversation without restarting it.",
			"Args: { agent_id, message }.",
		].join(" "),
		parameters: Type.Object({
			agent_id: Type.String({ description: "Sub-agent ID." }),
			message: Type.String({ description: "Steering instruction to send." }),
		}),
		async execute(_id, params) {
			try {
				const result = await rt.steerHandle(params.agent_id, params.message);
				if (result === "ok") {
					return {
						content: [{ type: "text" as const, text: `Steering message sent to #${params.agent_id}.` }],
						details: { agentId: params.agent_id, steered: true } as Record<string, unknown>,
					};
				}
				if (result === "unsupported") {
					return {
						content: [
							{
								type: "text" as const,
								text: `Sub-agent #${params.agent_id} cannot be steered. Steering is available for in-memory session-mode agents only.`,
							},
						],
						details: { error: "unsupported", agentId: params.agent_id } as Record<string, unknown>,
					};
				}
				return {
					content: [{ type: "text" as const, text: `Sub-agent not found: ${params.agent_id}` }],
					details: { error: "not_found", agentId: params.agent_id } as Record<string, unknown>,
				};
			} catch (err) {
				return {
					content: [{ type: "text" as const, text: `Failed to steer #${params.agent_id}: ${(err as Error).message}` }],
					details: { error: "steer_failed", agentId: params.agent_id, message: (err as Error).message } as Record<
						string,
						unknown
					>,
				};
			}
		},
	});
}
