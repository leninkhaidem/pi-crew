import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import type { ExtensionRuntime } from "../runtime/types.js";
import { getRoot } from "../state/paths.js";
import { listStates, readState } from "../state/store.js";
import type { SubagentState, SubagentStatus } from "../types.js";

const ScopeSchema = Type.Union([Type.Literal("active"), Type.Literal("session"), Type.Literal("all")], {
	default: "active",
});

export function registerStatusTool(pi: ExtensionAPI, rt: ExtensionRuntime): void {
	pi.registerTool({
		name: "subagent_status",
		label: "Subagent status",
		description: [
			"Peek at running/recent sub-agents.",
			"Returns { agentId, alias, agent, task, status, lastText, usage, paths } per agent.",
			"Args: { agentId? } | { scope?: 'active'|'session'|'all', includeDetached? }",
			"For full transcript, read paths.output (a JSONL file).",
		].join(" "),
		parameters: Type.Object({
			agentId: Type.Optional(Type.String()),
			scope: Type.Optional(ScopeSchema),
			includeDetached: Type.Optional(Type.Boolean()),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const sessionId = rt.resolveSessionId(ctx);
			const root = getRoot({ agentDir: rt.agentDir });
			const scope = params.scope ?? "active";
			let states: SubagentState[] = [];

			if (params.agentId) {
				const found = await findById(root, params.agentId);
				if (found) states = [found];
			} else if (scope === "session") {
				states = await listStates(path.join(root, sessionId), {
					includeDetached: params.includeDetached ?? false,
				});
			} else if (scope === "all") {
				const fs = await import("node:fs/promises");
				const sessions = await fs.readdir(root).catch(() => [] as string[]);
				for (const s of sessions) {
					const list = await listStates(path.join(root, s), {
						includeDetached: params.includeDetached ?? true,
					});
					states.push(...list);
				}
			} else {
				const list = await listStates(path.join(root, sessionId));
				states = list.filter((s) => s.status === "running" || s.status === "starting");
			}

			const text = formatStatusList(states);
			return {
				content: [{ type: "text" as const, text }],
				details: { count: states.length, states: states.map(compactStateDetails) },
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

function compactStateDetails(state: SubagentState) {
	return {
		agentId: state.agentId,
		alias: state.alias,
		agent: state.agent,
		task: state.task,
		status: state.status,
		lastText: state.lastText,
		lastToolCall: state.lastToolCall,
		usage: state.usage,
		paths: state.paths,
	};
}

function formatStatusList(states: SubagentState[]): string {
	if (states.length === 0) return "(no sub-agents)";
	const lines: string[] = [];
	for (const s of states) {
		const icon = iconFor(s.status);
		lines.push(`${icon} ${s.alias} #${s.agentId} (${s.agent}, ${s.model}, ${s.thinking}) ${s.status} — ${truncateLine(s.task, 120)}`);
		if (s.lastText) lines.push(`    last: ${truncateLine(s.lastText, 120)}`);
		if (s.lastToolCall) lines.push(`    tool: ${s.lastToolCall.name}`);
		lines.push(`    state: ${s.paths.state}`);
		lines.push(`    output: ${s.paths.output}`);
	}
	return lines.join("\n");
}

function truncateLine(text: string, maxLen: number): string {
	const line = text.trim().split("\n")[0] ?? "";
	return line.length <= maxLen ? line : `${line.slice(0, maxLen - 1)}…`;
}

function iconFor(s: SubagentStatus): string {
	if (s === "running" || s === "starting") return "⏳";
	if (s === "done") return "✓";
	return "✗";
}
