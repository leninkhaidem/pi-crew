// src/tools/run.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { discoverAgents } from "../agents/discovery.js";
import { dispatch as runDispatch } from "../runtime/lifecycle.js";
import type { ExtensionRuntime } from "../runtime/types.js";
import type { SubagentState } from "../types.js";
import { renderRunCall } from "../ui/render-call.js";
import { renderDispatchResult } from "../ui/render-result.js";
import { ChainItemSchema, TaskItemSchema } from "./shared.js";

export function registerRunTool(pi: ExtensionAPI, rt: ExtensionRuntime): void {
	pi.registerTool({
		name: "subagent_run",
		label: "Subagent run",
		description: [
			"Run sub-agent(s) and BLOCK until done. Use only when next step depends on result.",
			"Args: { agent, task } | { tasks: [...] } | { chain: [...] with {previous} placeholder }",
			"Returns final assistant text. Prefer subagent_dispatch unless sequential.",
		].join(" "),
		parameters: Type.Object({
			agent: Type.Optional(Type.String()),
			task: Type.Optional(Type.String()),
			tasks: Type.Optional(Type.Array(TaskItemSchema)),
			chain: Type.Optional(Type.Array(ChainItemSchema)),
			cwd: Type.Optional(Type.String()),
			maxTurns: Type.Optional(Type.Integer({ minimum: 1 })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const config = await rt.getConfig();
			const discovered = discoverAgents({
				cwd: ctx.cwd,
				scope: config.global.agentScope,
				userAgentsDir: rt.userAgentsDir,
				bundledDir: rt.bundledAgentsDir,
			});

			const single = params.agent && params.task ? { agent: params.agent, task: params.task } : null;
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
				task: string,
				cwd: string | undefined,
				maxTurns: number | undefined,
			): Promise<SubagentState> => {
				if (!rt.concurrency.active.tryAcquire()) {
					throw new Error(`Active sub-agent limit reached (${rt.concurrency.active.current()}). Wait or kill some.`);
				}
				try {
					const slot = config.agents[agentName];
					if (!slot) {
						throw new Error(`Configuration required for "${agentName}". Run /subagent-config.`);
					}
					const agent = discovered.agents.find((a) => a.name === agentName);
					if (!agent) throw new Error(`Unknown agent "${agentName}".`);
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
						{ agent, model: slot, options: { agent: agentName, task, cwd, maxTurns } },
						rt.envFor(ctx),
						rt.lifecycleHooks(),
					);
					rt.trackHandle(handle);
					return await handle.donePromise;
				} finally {
					rt.concurrency.active.release();
				}
			};

			try {
				if (single) {
					const final = await oneShot(single.agent, single.task, params.cwd, params.maxTurns);
					return toolResult(final);
				}
				if (tasks) {
					const slice = tasks.slice(0, config.global.maxParallelTasksPerCall);
					const results = await Promise.all(
						slice.map((t) => rt.concurrency.pool.run(() => oneShot(t.agent, t.task, t.cwd, t.maxTurns))),
					);
					return toolResultBatch(results);
				}
				if (chain) {
					const results: SubagentState[] = [];
					let previous = "";
					for (const step of chain) {
						const taskText = step.task.replace(/\{previous\}/g, previous);
						const r = await oneShot(step.agent, taskText, step.cwd, step.maxTurns);
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
			return renderRunCall(args as { agent?: string; task?: string; tasks?: unknown[]; chain?: unknown[] }, theme);
		},
		renderResult(result, options, theme, _context) {
			return renderDispatchResult(result as Parameters<typeof renderDispatchResult>[0], options, theme);
		},
	});
}

function toolResult(state: SubagentState) {
	return {
		content: [{ type: "text" as const, text: state.finalOutput ?? "(no output)" }],
		details: { agentId: state.agentId, status: state.status, paths: state.paths, usage: state.usage },
	};
}

function toolResultBatch(states: SubagentState[], _partial = false) {
	const text = states
		.map((s) => `[${s.agent} #${s.agentId}] ${s.status}\n${s.finalOutput ?? "(no output)"}`)
		.join("\n\n");
	return {
		content: [{ type: "text" as const, text }],
		details: {
			results: states.map((s) => ({ agentId: s.agentId, status: s.status, paths: s.paths })),
		},
	};
}
