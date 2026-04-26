// src/tools/agent.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { discoverAgents } from "../agents/discovery.js";
import { dispatch as runDispatch } from "../runtime/lifecycle.js";
import type { ExtensionRuntime } from "../runtime/types.js";
import { formatParentSummary } from "../summary.js";
import type { AgentConfig, SubagentState } from "../types.js";
import { renderDispatchResult } from "../ui/render-result.js";
import { AliasSchema, SlotOverrideProperties } from "./shared.js";
import { resolveAgentSlot } from "./slot.js";

export function registerAgentTool(pi: ExtensionAPI, rt: ExtensionRuntime): void {
	pi.registerTool({
		name: "Agent",
		label: "Agent",
		description: [
			"Launch a specialized sub-agent, Claude Code style.",
			"Foreground calls block and return the final result; background calls return an agent ID immediately.",
			"Requires alias: a short instance name shown in sub-agent UI.",
			"Supports per-call provider/model/thinking overrides; model without provider infers provider when possible.",
			"Args: { subagent_type, alias, prompt, run_in_background?, provider?, model?, thinking?, resume? }.",
		].join(" "),
		parameters: Type.Object({
			subagent_type: Type.String({ description: "Agent name, e.g. explore, general-purpose, or custom." }),
			alias: AliasSchema,
			prompt: Type.String({ description: "Task for the sub-agent." }),
			run_in_background: Type.Optional(Type.Boolean({ description: "If true, return immediately with an agent ID." })),
			...SlotOverrideProperties,
			resume: Type.Optional(Type.String({ description: "Existing session-mode agent ID to continue." })),
			cwd: Type.Optional(Type.String({ description: "Working directory override." })),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			if (params.resume) {
				if (!rt.concurrency.active.tryAcquire()) {
					return limitResult(rt.concurrency.active.current());
				}
				try {
					rt.consumeCompletion(params.resume);
					const resumed = await rt.resumeHandle(params.resume, params.prompt, signal).catch(() => null);
					if (!resumed) {
						return {
							content: [
								{
									type: "text" as const,
									text: `Cannot resume #${params.resume}. The agent was not found, is not a session-mode agent, or was created before this parent session.`,
								},
							],
							details: { error: "resume_unavailable", agentId: params.resume } as Record<string, unknown>,
						};
					}
					return stateResult(resumed);
				} finally {
					rt.concurrency.active.release();
				}
			}

			const config = await rt.getConfig();
			const discovered = discoverAgents({
				cwd: ctx.cwd,
				scope: config.global.agentScope,
				userAgentsDir: rt.userAgentsDir,
				bundledDir: rt.bundledAgentsDir,
			});
			const agent = resolveAgent(discovered.agents, params.subagent_type);
			if (!agent) {
				const available = discovered.agents.map((a) => a.name).join(", ");
				return {
					content: [
						{ type: "text" as const, text: `Unknown agent "${params.subagent_type}". Available: ${available}` },
					],
					details: { error: "unknown_agent" },
				};
			}
			const slotResolution = resolveAgentSlot(agent.name, config, ctx, pi, {
				provider: params.provider,
				model: params.model,
				thinking: params.thinking,
			});
			if (!slotResolution.ok) {
				return {
					content: [{ type: "text" as const, text: slotResolution.message }],
					details: { error: slotResolution.error },
				};
			}
			const slot = slotResolution.slot;
			const approved = await rt.ensureProjectAgentApproved({ agentName: agent.name, agentSource: agent.source, ctx });
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
			if (!rt.concurrency.active.tryAcquire()) return limitResult(rt.concurrency.active.current());

			let handle: Awaited<ReturnType<typeof runDispatch>>;
			try {
				handle = await runDispatch(
					{
						agent,
						model: slot,
						options: {
							agent: agent.name,
							alias: params.alias.trim(),
							task: params.prompt,
							cwd: params.cwd,
						},
					},
					rt.envFor(ctx),
					rt.lifecycleHooks(),
				);
			} catch (err) {
				rt.concurrency.active.release();
				throw err;
			}
			rt.trackHandle(handle);
			rt.trackParentAbort(signal, handle);

			if (params.run_in_background) {
				void handle.donePromise.finally(() => rt.concurrency.active.release());
				return {
					content: [
						{
							type: "text" as const,
							text: [
								`Started ${handle.state.alias} #${handle.agentId} (${agent.name}, ${handle.state.provider}/${handle.state.model}).`,
								"Completion will be posted automatically.",
							].join("\n"),
						},
					],
					details: {
						agentId: handle.agentId,
						alias: handle.state.alias,
						agent: handle.state.agent,
						status: handle.state.status,
						provider: handle.state.provider,
						model: handle.state.model,
						thinking: handle.state.thinking,
						turns: handle.state.turns,
						paths: handle.state.paths,
					},
				};
			}

			try {
				rt.consumeCompletion(handle.agentId);
				const final = await handle.donePromise;
				return stateResult(final);
			} finally {
				rt.concurrency.active.release();
			}
		},
		renderResult(result, options, theme, _context) {
			return renderDispatchResult(result as Parameters<typeof renderDispatchResult>[0], options, theme);
		},
	});
}

function resolveAgent(agents: AgentConfig[], name: string): AgentConfig | undefined {
	return agents.find((a) => a.name === name) ?? agents.find((a) => a.name.toLowerCase() === name.toLowerCase());
}

function stateResult(state: SubagentState) {
	return {
		content: [{ type: "text" as const, text: formatParentSummary(state, { maxChars: 1200, maxLines: 16 }) }],
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

function limitResult(current: number) {
	return {
		content: [
			{
				type: "text" as const,
				text: `Active sub-agent limit reached (${current}). Wait for some to finish or kill them.`,
			},
		],
		details: { error: "max_active_reached" },
	};
}
