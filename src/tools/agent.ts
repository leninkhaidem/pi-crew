// src/tools/agent.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { discoverAgents } from "../agents/discovery.js";
import { dispatch as runDispatch } from "../runtime/lifecycle.js";
import type { ExtensionRuntime } from "../runtime/types.js";
import { formatParentSummary } from "../summary.js";
import type { AgentConfig, SubagentState } from "../types.js";
import { renderDispatchResult } from "../ui/render-result.js";
import { SlotOverrideProperties } from "./shared.js";
import { resolveAgentSlot } from "./slot.js";

export function registerAgentTool(pi: ExtensionAPI, rt: ExtensionRuntime): void {
	pi.registerTool({
		name: "Agent",
		label: "Agent",
		description: [
			"Launch a specialized sub-agent, Claude Code style.",
			"Foreground calls block and return the final result; background calls return an agent ID immediately.",
			"Supports per-call provider/model/thinking overrides; model without provider infers provider when possible.",
			"Args: { subagent_type, prompt, description?, run_in_background?, max_turns?, provider?, model?, thinking?, resume? }.",
		].join(" "),
		parameters: Type.Object({
			subagent_type: Type.String({ description: "Agent name, e.g. explore, general-purpose, or custom." }),
			prompt: Type.String({ description: "Task for the sub-agent." }),
			description: Type.Optional(Type.String({ description: "Short task label for UI." })),
			run_in_background: Type.Optional(Type.Boolean({ description: "If true, return immediately with an agent ID." })),
			max_turns: Type.Optional(Type.Integer({ minimum: 1, description: "Max agentic turns." })),
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
							task: params.prompt,
							cwd: params.cwd,
							maxTurns: params.max_turns,
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
								"Agent started in background.",
								`Agent ID: ${handle.agentId}`,
								`Type: ${agent.name}`,
								`Description: ${params.description ?? summarize(params.prompt)}`,
								`Use get_subagent_result with agent_id: "${handle.agentId}" to retrieve results.`,
							].join("\n"),
						},
					],
					details: { agentId: handle.agentId, status: handle.state.status, paths: handle.state.paths },
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
		details: { agentId: state.agentId, status: state.status, paths: state.paths, usage: state.usage },
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

function summarize(prompt: string): string {
	const first = prompt.replace(/\s+/g, " ").trim();
	return first.length <= 60 ? first : `${first.slice(0, 57)}…`;
}
