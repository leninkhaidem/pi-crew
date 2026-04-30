// src/tools/resume.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import type { ExtensionRuntime } from "../runtime/types.js";
import { formatParentSummary } from "../summary.js";
import type { SubagentState } from "../types.js";
import { renderDispatchResult } from "../ui/render-result.js";
import { SlotOverrideProperties } from "./shared.js";

export function registerResumeTool(pi: ExtensionAPI, rt: ExtensionRuntime): void {
	pi.registerTool({
		name: "subagent_resume",
		label: "Resume subagent",
		description: [
			"Resume a session-mode sub-agent with a new prompt.",
			"The agent continues its existing conversation with the new task appended.",
			"Only works for in-memory session-mode agents started in this parent session.",
			"Args: { agent_id, prompt, provider?, model?, thinking? }.",
		].join(" "),
		parameters: Type.Object({
			agent_id: Type.String({ description: "Sub-agent ID to resume." }),
			prompt: Type.String({ description: "New task or follow-up instruction." }),
			...SlotOverrideProperties,
		}),
		async execute(_id, params, signal) {
			if (!rt.concurrency.active.tryAcquire()) {
				return activeLimitResult(rt.concurrency.active.current());
			}
			try {
				rt.consumeCompletion(params.agent_id);
				const resumed = await rt.resumeHandle(params.agent_id, params.prompt, signal).catch(() => null);
				if (!resumed) {
					return notFoundResult(params.agent_id);
				}
				return successResult(resumed);
			} finally {
				rt.concurrency.active.release();
			}
		},
		renderResult(result, options, theme, _context) {
			return renderDispatchResult(result as Parameters<typeof renderDispatchResult>[0], options, theme);
		},
	});
}

function activeLimitResult(current: number) {
	return {
		content: [
			{
				type: "text" as const,
				text: `Active sub-agent limit reached (${current}). Wait for some to finish or kill them.`,
			},
		],
		details: { error: "max_active_reached" } as Record<string, unknown>,
	};
}

function notFoundResult(agentId: string) {
	return {
		content: [
			{
				type: "text" as const,
				text: `Cannot resume #${agentId}. The agent was not found, is not a session-mode agent, or was created before this parent session.`,
			},
		],
		details: { error: "resume_unavailable", agentId } as Record<string, unknown>,
	};
}

function successResult(state: SubagentState) {
	return {
		content: [{ type: "text" as const, text: formatParentSummary(state, { full: true }) }],
		details: {
			agentId: state.agentId,
			alias: state.alias,
			agent: state.agent,
			status: state.status,
			provider: state.provider,
			model: state.model,
			thinking: state.thinking,
			turns: state.turns,
			finalOutput: state.finalOutput,
			errorMessage: state.errorMessage,
			paths: state.paths,
			usage: state.usage,
		},
	};
}
