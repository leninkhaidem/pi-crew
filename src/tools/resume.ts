// src/tools/resume.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { isModelInScope, modelOutOfScopeMessage, modelScopeSnapshot } from "../model-scope.js";
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
			"If backgrounded with Ctrl+B, completion is injected automatically; do not poll or sleep.",
			"Args: { agent_id, prompt, provider?, model?, thinking? }.",
		].join(" "),
		parameters: Type.Object({
			agent_id: Type.String({ description: "Sub-agent ID to resume." }),
			prompt: Type.String({ description: "New task or follow-up instruction." }),
			...SlotOverrideProperties,
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			if (signal?.aborted) return abortedResult();
			if (!rt.concurrency.active.tryAcquire()) {
				return activeLimitResult(rt.concurrency.active.current());
			}
			const scope = rt.detach.createScope();
			let releaseOnSettlement = false;
			try {
				const identity = rt.getResumeIdentity(params.agent_id);
				if (identity) {
					const currentScope = modelScopeSnapshot(ctx);
					if (!isModelInScope(currentScope, identity.provider, identity.model)) {
						return scopeFailureResult(params.agent_id, identity.provider, identity.model);
					}
				}
				const acceptedResume = rt.resumeHandle(params.agent_id, params.prompt, signal, ctx);
				if (!acceptedResume) return notFoundResult(params.agent_id);
				const resumePromise = acceptedResume.then(
					(state) => ({ state, error: null as Error | null }),
					(error) => ({ state: null, error: error instanceof Error ? error : new Error(String(error)) }),
				);
				const outcome = await Promise.race([
					resumePromise.then((result) => ({ kind: "settled" as const, ...result })),
					scope.detached.then(() => ({ kind: "backgrounded" as const })),
				]);
				if (outcome.kind === "backgrounded") {
					releaseOnSettlement = true;
					void resumePromise.then(
						() => rt.concurrency.active.release(),
						() => rt.concurrency.active.release(),
					);
					return backgroundedResult(params.agent_id);
				}
				if (outcome.error) return resumeFailureResult(params.agent_id, outcome.error.message);
				if (!outcome.state) return notFoundResult(params.agent_id);
				rt.consumeCompletion(params.agent_id);
				return successResult(outcome.state);
			} finally {
				scope.dispose();
				if (!releaseOnSettlement) rt.concurrency.active.release();
			}
		},
		renderResult(result, options, theme, _context) {
			return renderDispatchResult(result as Parameters<typeof renderDispatchResult>[0], options, theme);
		},
	});
}

function abortedResult() {
	return resumeFailureResult("", "Interrupted before sub-agent resume.", "aborted");
}

function scopeFailureResult(agentId: string, provider: string, model: string) {
	const message = modelOutOfScopeMessage(provider, model);
	return {
		content: [{ type: "text" as const, text: message }],
		details: { error: "model_out_of_scope", agentId, provider, model, message } as Record<string, unknown>,
	};
}

function resumeFailureResult(agentId: string, message: string, error = "resume_failed") {
	return {
		content: [{ type: "text" as const, text: message }],
		details: { error, ...(agentId ? { agentId } : {}), message } as Record<string, unknown>,
	};
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

function backgroundedResult(agentId: string) {
	return {
		content: [
			{
				type: "text" as const,
				text: [
					`Sub-agent #${agentId} moved to background.`,
					"Completion will be injected automatically.",
					"Do not poll or sleep for this result unless the user asks for progress or recovery.",
				].join("\n"),
			},
		],
		details: { agentId, status: "backgrounded" } as Record<string, unknown>,
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
			...(state.thinkingAdjustment ? { thinkingAdjustment: state.thinkingAdjustment } : {}),
			turns: state.turns,
			finalOutput: state.finalOutput,
			errorMessage: state.errorMessage,
			paths: state.paths,
			usage: state.usage,
		},
	};
}
