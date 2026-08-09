// src/tools/dispatch.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { discoverAgents } from "../agents/discovery.js";
import { dispatch as runDispatch } from "../runtime/lifecycle.js";
import type { ExtensionRuntime } from "../runtime/types.js";
import { formatParentSummary } from "../summary.js";
import { formatThinkingAdjustment } from "../thinking.js";
import type { SubagentState } from "../types.js";
import { renderDispatchCall } from "../ui/render-call.js";
import { renderDispatchResult } from "../ui/render-result.js";
import { AliasSchema, SlotOverrideProperties } from "./shared.js";
import { resolveAgentSlot } from "./slot.js";

export function registerDispatchTool(pi: ExtensionAPI, rt: ExtensionRuntime): void {
	pi.registerTool({
		name: "subagent_dispatch",
		label: "Subagent dispatch",
		description: [
			"Dispatch a sub-agent in the background. Returns agentId immediately.",
			"For explore, this is coerced to a blocking run to avoid duplicate reconnaissance.",
			"Args: { agent, alias, task, cwd?, provider?, model?, thinking? }",
			"Requires alias: a short instance name shown in sub-agent UI.",
			"Supports per-call provider/model/thinking overrides; model without provider infers provider when possible.",
			"Available agents: see 'pi-crew' section in system prompt.",
			"Completion is auto-injected into this conversation when the sub-agent finishes, except coerced blocking explore runs.",
			"Do not poll, sleep, or call status/result tools just to wait for normal background completion.",
		].join(" "),
		parameters: Type.Object({
			agent: Type.String({
				description: "Agent name. explore is coerced to blocking even through this background tool.",
			}),
			alias: AliasSchema,
			task: Type.String({ description: "Task description" }),
			cwd: Type.Optional(Type.String()),
			...SlotOverrideProperties,
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			const config = await rt.getConfig();
			if (signal?.aborted) return interruptedResult();
			const discovered = discoverAgents({
				cwd: ctx.cwd,
				scope: config.global.agentScope,
				userAgentsDir: rt.userAgentsDir,
				bundledDir: rt.bundledAgentsDir,
			});
			const agent = discovered.agents.find((a) => a.name === params.agent);
			if (!agent) {
				const available = discovered.agents.map((a) => a.name).join(", ");
				return {
					content: [{ type: "text" as const, text: `Unknown agent "${params.agent}". Available: ${available}` }],
					details: { error: "unknown_agent" },
				};
			}
			const forceBlocking = isExploreAgent(agent.name);
			const overrides = { provider: params.provider, model: params.model, thinking: params.thinking };
			let slotResolution = resolveAgentSlot(agent.name, config, ctx, pi, overrides);
			if (!slotResolution.ok) return slotFailureResult(slotResolution);
			const approved = await rt.ensureProjectAgentApproved({
				agentName: agent.name,
				agentSource: agent.source,
				ctx,
				signal,
			});
			if (signal?.aborted) return interruptedResult();
			if (!approved) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Project agent "${agent.name}" not approved. Set confirmProjectAgents: false in /subagent-config to disable prompts.`,
						},
					],
					details: { error: "project_agent_declined" },
				};
			}
			slotResolution = resolveAgentSlot(agent.name, config, ctx, pi, overrides);
			if (!slotResolution.ok) return slotFailureResult(slotResolution);
			if (signal?.aborted) return interruptedResult();
			if (!rt.concurrency.active.tryAcquire()) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Active sub-agent limit reached (${rt.concurrency.active.current()}). Wait for some to finish or kill them.`,
						},
					],
					details: { error: "max_active_reached" },
				};
			}
			let handle: Awaited<ReturnType<typeof runDispatch>>;
			try {
				handle = await runDispatch(
					{
						agent,
						model: slotResolution.slot,
						thinkingAdjustment: slotResolution.thinkingAdjustment,
						options: {
							agent: params.agent,
							alias: params.alias.trim(),
							task: params.task,
							cwd: params.cwd,
						},
					},
					{ ...rt.envFor(ctx), signal },
					rt.lifecycleHooks(),
				);
			} catch (err) {
				rt.concurrency.active.release();
				throw err;
			}
			if (signal?.aborted) {
				await handle.abort?.("Interrupted before sub-agent launch.");
				rt.concurrency.active.release();
				return interruptedResult();
			}
			rt.trackHandle(handle);
			rt.trackParentAbort(signal, handle);
			if (forceBlocking) {
				try {
					rt.consumeCompletion(handle.agentId);
					const final = await handle.donePromise;
					return stateResult(final);
				} finally {
					rt.concurrency.active.release();
				}
			}
			void handle.donePromise.finally(() => rt.concurrency.active.release());
			if (handle.state.status === "failed" || handle.state.status === "aborted") return stateResult(handle.state);
			const warning = formatThinkingAdjustment(handle.state.thinkingAdjustment);
			return {
				content: [
					{
						type: "text" as const,
						text: [
							`Started ${handle.state.alias} #${handle.agentId} (${agent.name}, ${handle.state.provider}/${handle.state.model}).`,
							...(warning ? [warning] : []),
							"Completion will be injected automatically.",
							"Do not poll or sleep for this result unless the user asks for progress or recovery.",
						].join("\n"),
					},
				],
				details: {
					agentId: handle.agentId,
					agent: agent.name,
					alias: handle.state.alias,
					task: params.task,
					status: handle.state.status,
					provider: handle.state.provider,
					model: handle.state.model,
					thinking: handle.state.thinking,
					...(handle.state.thinkingAdjustment ? { thinkingAdjustment: handle.state.thinkingAdjustment } : {}),
					turns: handle.state.turns,
					paths: handle.state.paths,
				},
			};
		},
		renderCall(args, theme, _context) {
			return renderDispatchCall(
				args as { agent?: string; alias?: string; task?: string; model?: string; provider?: string },
				theme,
			);
		},
		renderResult(result, options, theme, _context) {
			return renderDispatchResult(result as Parameters<typeof renderDispatchResult>[0], options, theme);
		},
	});
}

function slotFailureResult(resolution: Extract<ReturnType<typeof resolveAgentSlot>, { ok: false }>) {
	return {
		content: [{ type: "text" as const, text: resolution.message }],
		details: {
			error: resolution.error,
			...(resolution.provider ? { provider: resolution.provider } : {}),
			...(resolution.model ? { model: resolution.model } : {}),
			message: resolution.message,
		},
	};
}

function interruptedResult() {
	const message = "Interrupted before sub-agent launch.";
	return {
		content: [{ type: "text" as const, text: message }],
		details: { error: "aborted", message },
	};
}

function isExploreAgent(agentName: string): boolean {
	return agentName.toLowerCase() === "explore";
}

function stateResult(state: SubagentState) {
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
