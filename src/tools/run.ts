// src/tools/run.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { discoverAgents } from "../agents/discovery.js";
import { dispatch as runDispatch } from "../runtime/lifecycle.js";
import type { ExtensionRuntime } from "../runtime/types.js";
import { formatParentSummary } from "../summary.js";
import type { SubagentState } from "../types.js";
import { renderRunCall } from "../ui/render-call.js";
import { renderDispatchResult } from "../ui/render-result.js";
import { AliasSchema, ChainItemSchema, SlotOverrideProperties, TaskItemSchema } from "./shared.js";
import { type SlotOverrides, resolveAgentSlot } from "./slot.js";

export function registerRunTool(pi: ExtensionAPI, rt: ExtensionRuntime): void {
	pi.registerTool({
		name: "subagent_run",
		label: "Subagent run",
		description: [
			"Run sub-agent(s) and BLOCK until done. Use only when next step depends on result.",
			"Args: { agent, alias, task } | { tasks: [...] } | { chain: [...] with {previous} placeholder }",
			"Each sub-agent item requires alias: a short instance name shown in sub-agent UI.",
			"Supports per-call provider/model/thinking overrides; model without provider infers provider when possible.",
			"Returns final assistant text. Prefer subagent_dispatch unless sequential.",
		].join(" "),
		parameters: Type.Object({
			agent: Type.Optional(Type.String()),
			alias: Type.Optional(AliasSchema),
			task: Type.Optional(Type.String()),
			tasks: Type.Optional(Type.Array(TaskItemSchema)),
			chain: Type.Optional(Type.Array(ChainItemSchema)),
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

			const single =
				params.agent && params.task ? { agent: params.agent, alias: params.alias, task: params.task } : null;
			const tasks = params.tasks;
			const chain = params.chain;

			if ([single, tasks, chain].filter(Boolean).length !== 1) {
				return {
					content: [{ type: "text" as const, text: "Provide exactly one of {agent,task}, {tasks}, or {chain}." }],
					details: { error: "invalid_args" },
				};
			}

			const oneShot = async (
				agentName: string,
				alias: string,
				task: string,
				cwd: string | undefined,
				overrides: SlotOverrides = {},
			): Promise<SubagentState> => {
				if (signal?.aborted) throw new Error("Interrupted before sub-agent launch.");
				if (!rt.concurrency.active.tryAcquire()) {
					throw new Error(`Active sub-agent limit reached (${rt.concurrency.active.current()}). Wait or kill some.`);
				}
				try {
					const agent = discovered.agents.find((a) => a.name === agentName);
					if (!agent) throw new Error(`Unknown agent "${agentName}".`);
					const slotResolution = resolveAgentSlot(agent.name, config, ctx, pi, overrides);
					if (!slotResolution.ok) throw new Error(slotResolution.message);
					const slot = slotResolution.slot;
					const approved = await rt.ensureProjectAgentApproved({
						agentName: agent.name,
						agentSource: agent.source,
						ctx,
					});
					if (!approved) {
						throw new Error(
							`Project agent "${agent.name}" not approved. Set confirmProjectAgents: false in /subagent-config to disable prompts.`,
						);
					}
					const handle = await runDispatch(
						{ agent, model: slot, options: { agent: agentName, alias: alias.trim(), task, cwd } },
						rt.envFor(ctx),
						rt.lifecycleHooks(),
					);
					rt.trackHandle(handle);
					rt.trackParentAbort(signal, handle);
					rt.consumeCompletion(handle.agentId);
					return await handle.donePromise;
				} finally {
					rt.concurrency.active.release();
				}
			};

			try {
				if (single) {
					if (!single.alias?.trim()) {
						return {
							content: [{ type: "text" as const, text: "Provide alias for the sub-agent run." }],
							details: { error: "alias_required" },
						};
					}
					const final = await oneShot(single.agent, single.alias, single.task, params.cwd, {
						provider: params.provider,
						model: params.model,
						thinking: params.thinking,
					});
					return toolResult(final);
				}
				if (tasks) {
					if (tasks.length > config.global.maxParallelTasksPerCall) {
						return {
							content: [
								{
									type: "text" as const,
									text: `Too many parallel tasks (${tasks.length}); max is ${config.global.maxParallelTasksPerCall}. Split the call into batches.`,
								},
							],
							details: { error: "too_many_tasks", maxParallelTasksPerCall: config.global.maxParallelTasksPerCall },
						};
					}
					const settled = await Promise.allSettled(
						tasks.map((t) =>
							rt.concurrency.pool.run(() =>
								oneShot(t.agent, t.alias, t.task, t.cwd, {
									provider: t.provider,
									model: t.model,
									thinking: t.thinking,
								}),
							),
						),
					);
					const states: SubagentState[] = [];
					const errors: string[] = [];
					for (const r of settled) {
						if (r.status === "fulfilled") states.push(r.value);
						else errors.push((r.reason as Error).message);
					}
					return toolResultBatch(states, errors.length > 0, errors);
				}
				if (chain) {
					const results: SubagentState[] = [];
					let previous = "";
					for (const step of chain) {
						const taskText = step.task.replace(/\{previous\}/g, previous);
						const r = await oneShot(step.agent, step.alias, taskText, step.cwd, {
							provider: step.provider,
							model: step.model,
							thinking: step.thinking,
						});
						results.push(r);
						if (r.status !== "done") return toolResultBatch(results, true);
						previous = r.finalOutput ?? "";
					}
					return toolResultBatch(results);
				}
			} catch (err) {
				return {
					content: [{ type: "text" as const, text: (err as Error).message }],
					details: { error: "dispatch_failed", message: (err as Error).message },
				};
			}
			return { content: [{ type: "text" as const, text: "(unreachable)" }], details: { error: "unreachable" } };
		},
		renderCall(args, theme, _context) {
			return renderRunCall(
				args as { agent?: string; alias?: string; task?: string; tasks?: unknown[]; chain?: unknown[] },
				theme,
			);
		},
		renderResult(result, options, theme, _context) {
			return renderDispatchResult(result as Parameters<typeof renderDispatchResult>[0], options, theme);
		},
	});
}

function toolResult(state: SubagentState) {
	return {
		content: [{ type: "text" as const, text: formatRunStateResult(state, { single: true }) }],
		details: {
			agentId: state.agentId,
			alias: state.alias,
			status: state.status,
			finalOutput: state.finalOutput,
			errorMessage: state.errorMessage,
			paths: state.paths,
			usage: state.usage,
		},
	};
}

function toolResultBatch(states: SubagentState[], partial = false, errors: string[] = []) {
	const stateLines = states.map((s) => formatRunStateResult(s));
	const errLines = errors.map((e) => `[error] ${e}`);
	const text = [...stateLines, ...errLines].join("\n\n");
	return {
		content: [{ type: "text" as const, text }],
		details: {
			results: states.map((s) => ({
				agentId: s.agentId,
				alias: s.alias,
				status: s.status,
				finalOutput: s.finalOutput,
				errorMessage: s.errorMessage,
				paths: s.paths,
			})),
			...(partial ? { partial: true } : {}),
			...(errors.length > 0 ? { errors } : {}),
		},
	};
}

export function formatRunStateResult(state: SubagentState, _options: { single?: boolean } = {}): string {
	return formatParentSummary(state, { full: true });
}
