import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import type { ExtensionRuntime } from "../runtime/types.js";
import { getRoot } from "../state/paths.js";
import { readState } from "../state/store.js";
import type { SubagentState } from "../types.js";

const TERMINAL = new Set<SubagentState["status"]>(["done", "failed", "aborted", "orphaned", "detached"]);

export function registerWaitTool(pi: ExtensionAPI, rt: ExtensionRuntime): void {
	pi.registerTool({
		name: "subagent_wait",
		label: "Subagent wait",
		description:
			"Block until specified sub-agents finish, then return final outputs. Args: { agentIds: string[], timeoutMs? }",
		parameters: Type.Object({
			agentIds: Type.Array(Type.String(), { minItems: 1 }),
			timeoutMs: Type.Optional(Type.Integer({ minimum: 1000 })),
		}),
		async execute(_id, params, signal) {
			const root = getRoot({ agentDir: rt.agentDir });
			const deadline = params.timeoutMs ? Date.now() + params.timeoutMs : null;
			const results: SubagentState[] = [];

			for (const id of params.agentIds) {
				let last: SubagentState | null = null;
				while (true) {
					if (signal?.aborted) break;
					if (deadline && Date.now() > deadline) break;
					last = await findById(root, id);
					if (last && TERMINAL.has(last.status)) break;
					await new Promise((r) => setTimeout(r, 500));
				}
				if (last) results.push(last);
				else results.push(stubMissing(id));
			}

			const text = results
				.map((r) =>
					r.status === "done"
						? `[${r.agent} #${r.agentId}] done\n${r.finalOutput ?? "(no output)"}`
						: `[${r.agent} #${r.agentId}] ${r.status} — ${r.errorMessage ?? "(no error)"}`,
				)
				.join("\n\n");

			return {
				content: [{ type: "text" as const, text }],
				details: { results },
			};
		},
	});
}

async function findById(root: string, id: string): Promise<SubagentState | null> {
	const fs = await import("node:fs/promises");
	const sessions = await fs.readdir(root).catch(() => [] as string[]);
	for (const s of sessions) {
		const sub = await fs.readdir(path.join(root, s)).catch(() => [] as string[]);
		if (sub.includes(id)) {
			return readState(path.join(root, s, id, "state.json"));
		}
	}
	return null;
}

function stubMissing(id: string): SubagentState {
	return {
		schemaVersion: 1,
		agentId: id,
		parentAgentId: null,
		sessionId: "",
		agent: "?",
		agentSource: "user",
		task: "",
		cwd: "",
		branch: null,
		model: "",
		provider: "",
		tools: null,
		maxTurns: null,
		pid: null,
		startedAt: 0,
		finishedAt: null,
		lastUpdate: 0,
		status: "failed",
		exitCode: null,
		stopReason: null,
		errorMessage: "agent not found",
		turns: 0,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 },
		lastText: null,
		lastToolCall: null,
		finalOutput: null,
		paths: { state: "", output: "", stderr: "", prompt: "" },
	};
}
