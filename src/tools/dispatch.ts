// src/tools/dispatch.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { discoverAgents } from "../agents/discovery.js";
import { dispatch as runDispatch } from "../runtime/lifecycle.js";
import type { ExtensionRuntime } from "../runtime/types.js";
import { renderDispatchCall } from "../ui/render-call.js";
import { renderDispatchResult } from "../ui/render-result.js";

export function registerDispatchTool(pi: ExtensionAPI, rt: ExtensionRuntime): void {
	pi.registerTool({
		name: "subagent_dispatch",
		label: "Subagent dispatch",
		description: [
			"Dispatch a sub-agent in the background. Returns agentId immediately.",
			"Args: { agent, task, cwd?, maxTurns? }",
			"Available agents: see 'pi-crew' section in system prompt.",
			"Completion is auto-pushed into this conversation when the sub-agent finishes.",
		].join(" "),
		parameters: Type.Object({
			agent: Type.String({
				description: "Agent name (general-purpose, explore, plan, code-reviewer, ...)",
			}),
			task: Type.String({ description: "Task description" }),
			cwd: Type.Optional(Type.String()),
			maxTurns: Type.Optional(Type.Integer({ minimum: 1 })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const config = await rt.getConfig();
			const slot = config.agents[params.agent];
			if (!slot) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Configuration required for agent "${params.agent}". Run /subagent-config to set models.`,
						},
					],
					details: { error: "unconfigured" },
				};
			}
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
			const approved = await rt.ensureProjectAgentApproved({
				agentName: agent.name,
				agentSource: agent.source,
				ctx,
			});
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
			const handle = await runDispatch(
				{
					agent,
					model: slot,
					options: {
						agent: params.agent,
						task: params.task,
						cwd: params.cwd,
						maxTurns: params.maxTurns,
					},
				},
				rt.envFor(ctx),
				rt.lifecycleHooks(),
			);
			rt.trackHandle(handle);
			return {
				content: [
					{
						type: "text" as const,
						text: [
							`Dispatched #${handle.agentId} (${agent.name}): ${params.task}`,
							`State: ${handle.state.paths.state}`,
							`Output: ${handle.state.paths.output}`,
						].join("\n"),
					},
				],
				details: {
					agentId: handle.agentId,
					agent: agent.name,
					task: params.task,
					status: handle.state.status,
					paths: handle.state.paths,
				},
			};
		},
		renderCall(args, theme, _context) {
			return renderDispatchCall(args as { agent?: string; task?: string }, theme);
		},
		renderResult(result, options, theme, _context) {
			return renderDispatchResult(result as Parameters<typeof renderDispatchResult>[0], options, theme);
		},
	});
}
