// src/tools/dispatch.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { discoverAgents } from "../agents/discovery.js";
import { dispatch as runDispatch } from "../runtime/lifecycle.js";
import type { ExtensionRuntime } from "../runtime/types.js";
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
			"Args: { agent, alias, task, cwd?, provider?, model?, thinking? }",
			"Requires alias: a short instance name shown in sub-agent UI.",
			"Supports per-call provider/model/thinking overrides; model without provider infers provider when possible.",
			"Available agents: see 'pi-crew' section in system prompt.",
			"Completion is auto-pushed into this conversation when the sub-agent finishes.",
		].join(" "),
		parameters: Type.Object({
			agent: Type.String({
				description: "Agent name (general-purpose, explore, or custom)",
			}),
			alias: AliasSchema,
			task: Type.String({ description: "Task description" }),
			cwd: Type.Optional(Type.String()),
			...SlotOverrideProperties,
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			const config = await rt.getConfig();
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
						model: slot,
						options: {
							agent: params.agent,
							alias: params.alias.trim(),
							task: params.task,
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
					agent: agent.name,
					alias: handle.state.alias,
					task: params.task,
					status: handle.state.status,
					provider: handle.state.provider,
					model: handle.state.model,
					thinking: handle.state.thinking,
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
