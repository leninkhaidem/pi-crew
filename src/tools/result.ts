// src/tools/result.ts
import fs from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import type { ExtensionRuntime } from "../runtime/types.js";
import { getRoot } from "../state/paths.js";
import { readState } from "../state/store.js";
import { formatParentSummary } from "../summary.js";
import type { SubagentState } from "../types.js";

const TERMINAL = new Set<SubagentState["status"]>(["done", "failed", "aborted", "orphaned", "detached"]);
const POLL_MS = 500;
const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60_000;
const VERBOSE_TRANSCRIPT_LIMIT = 20_000;

export function registerGetSubagentResultTool(pi: ExtensionAPI, rt: ExtensionRuntime): void {
	pi.registerTool({
		name: "get_subagent_result",
		label: "Get subagent result",
		description: [
			"Check status and retrieve results from a background sub-agent.",
			"Args: { agent_id, wait?, verbose? }.",
			"If wait is true, blocks until the sub-agent reaches a terminal state.",
		].join(" "),
		parameters: Type.Object({
			agent_id: Type.String({ description: "Sub-agent ID returned by Agent/subagent_dispatch." }),
			wait: Type.Optional(Type.Boolean({ description: "Wait for completion before returning. Default: false." })),
			verbose: Type.Optional(
				Type.Boolean({
					description: "Include transcript JSONL text, truncated for safety. Final output is not truncated.",
				}),
			),
			timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, description: "Optional wait timeout in milliseconds." })),
		}),
		async execute(_id, params, signal) {
			const root = getRoot({ agentDir: rt.agentDir });
			let state = await findById(root, params.agent_id);

			if (params.wait) {
				rt.consumeCompletion(params.agent_id);
				const deadline = Date.now() + (params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS);
				while (!signal?.aborted && Date.now() <= deadline) {
					state = await findById(root, params.agent_id);
					if (state && TERMINAL.has(state.status)) break;
					await new Promise((r) => setTimeout(r, POLL_MS));
				}
			}

			if (!state) {
				return {
					content: [{ type: "text" as const, text: `Sub-agent not found: ${params.agent_id}` }],
					details: { error: "not_found", agentId: params.agent_id } as Record<string, unknown>,
				};
			}

			if (TERMINAL.has(state.status)) rt.consumeCompletion(state.agentId);
			const text = await formatResultText(state, params.verbose ?? false);
			return {
				content: [{ type: "text" as const, text }],
				details: { agentId: state.agentId, status: state.status, paths: state.paths, usage: state.usage } as Record<
					string,
					unknown
				>,
			};
		},
	});
}

async function formatResultText(state: SubagentState, verbose: boolean): Promise<string> {
	const lines = [formatParentSummary(state, { full: true })];
	if (!TERMINAL.has(state.status)) {
		lines.push("");
		lines.push(`Status: ${state.status}`);
		if (state.activity) lines.push(`Activity: ${state.activity}`);
		if (state.lastText) lines.push(`Last text: ${state.lastText}`);
		lines.push(`State: ${state.paths.state}`);
		lines.push(`Trace: ${state.paths.output}`);
	}
	if (verbose) {
		lines.push("");
		lines.push("--- Transcript JSONL ---");
		lines.push(await readTranscript(state.paths.output));
	}
	return lines.join("\n");
}

async function readTranscript(outputPath: string): Promise<string> {
	try {
		const raw = await fs.readFile(outputPath, "utf-8");
		if (raw.length <= VERBOSE_TRANSCRIPT_LIMIT) return raw.trimEnd() || "(empty transcript)";
		return `${raw.slice(0, VERBOSE_TRANSCRIPT_LIMIT)}\n... (truncated; full transcript at ${outputPath})`;
	} catch (err) {
		return `(unable to read transcript: ${(err as Error).message})`;
	}
}

async function findById(root: string, id: string): Promise<SubagentState | null> {
	const sessions = await fs.readdir(root).catch(() => [] as string[]);
	for (const s of sessions) {
		const sub = await fs.readdir(path.join(root, s)).catch(() => [] as string[]);
		if (sub.includes(id)) return readState(path.join(root, s, id, "state.json"));
	}
	return null;
}
