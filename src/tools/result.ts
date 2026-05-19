// src/tools/result.ts
import fs from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import {
	MAX_RECENT_TRANSCRIPT_EVENTS,
	type TranscriptExcerpt,
	readRecentTranscriptExcerpt,
} from "../runtime/transcript.js";
import type { ExtensionRuntime } from "../runtime/types.js";
import { getRoot } from "../state/paths.js";
import { readState } from "../state/store.js";
import { formatParentSummary } from "../summary.js";
import type { SubagentState } from "../types.js";
import { renderDispatchResult } from "../ui/render-result.js";

const TERMINAL = new Set<SubagentState["status"]>(["done", "failed", "aborted", "orphaned", "detached"]);
const POLL_MS = 500;
const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60_000;
const VERBOSE_TRANSCRIPT_LIMIT = 20_000;

interface ResultToolParams {
	agent_id?: unknown;
	wait?: unknown;
	verbose?: unknown;
	timeoutMs?: unknown;
	recentEvents?: unknown;
}

interface ParsedResultRequest {
	agentId: string;
	wait: boolean;
	verbose: boolean;
	timeoutMs?: number;
	recentEvents?: number;
}

export function registerGetSubagentResultTool(pi: ExtensionAPI, rt: ExtensionRuntime): void {
	pi.registerTool({
		name: "get_subagent_result",
		label: "Get subagent result",
		description: [
			"Last-resort recovery/debug retrieval for a sub-agent result.",
			"Prefer proactive completion notifications and blocking subagent_run/foreground Agent results; do not fetch the same result again after normal completion.",
			"Use for explicit user requests, missed notifications, failed/aborted/orphaned/detached runs, bounded sanitized recent output, or verbose transcript inspection.",
			"Args: { agent_id, wait?, verbose?, recentEvents? }.",
		].join(" "),
		parameters: Type.Object({
			agent_id: Type.String({ description: "Sub-agent ID returned by Agent/subagent_dispatch." }),
			wait: Type.Optional(
				Type.Boolean({
					description:
						"Wait for completion before returning. Prefer blocking run tools unless this is explicit recovery/on-demand.",
				}),
			),
			verbose: Type.Optional(
				Type.Boolean({
					description: "Include transcript JSONL text, truncated for safety. Final output is not truncated.",
				}),
			),
			recentEvents: Type.Optional(
				Type.Integer({
					minimum: 1,
					description:
						"Include up to this many sanitized recent assistant/tool display events. Values above 20 are bounded to 20.",
				}),
			),
			timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, description: "Optional wait timeout in milliseconds." })),
		}),
		async execute(_id, params, signal) {
			const request = parseResultParams(params as ResultToolParams);
			const root = getRoot({ agentDir: rt.agentDir });
			let state = await findById(root, request.agentId);

			if (request.wait) {
				rt.consumeCompletion(request.agentId);
				const deadline = Date.now() + (request.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS);
				while (!signal?.aborted && Date.now() <= deadline) {
					state = await findById(root, request.agentId);
					if (state && TERMINAL.has(state.status)) break;
					await new Promise((r) => setTimeout(r, POLL_MS));
				}
			}

			if (!state) {
				return {
					content: [{ type: "text" as const, text: `Sub-agent not found: ${request.agentId}` }],
					details: { error: "not_found", agentId: request.agentId } as Record<string, unknown>,
				};
			}

			const alreadyHandled = TERMINAL.has(state.status) && rt.completionHandled(state.agentId);
			if (TERMINAL.has(state.status)) rt.consumeCompletion(state.agentId);
			const recentOutput = await readRequestedRecentOutput(state, request.recentEvents);
			const text = await formatResultText(state, request.verbose, alreadyHandled, recentOutput);
			const details: Record<string, unknown> = {
				agentId: state.agentId,
				alias: state.alias,
				agent: state.agent,
				status: state.status,
				provider: state.provider,
				model: state.model,
				thinking: state.thinking,
				turns: state.turns,
				paths: state.paths,
				usage: state.usage,
			};
			if (recentOutput) details.recentOutput = recentOutput.kind === "events" ? recentOutput.events : [];
			return {
				content: [{ type: "text" as const, text }],
				details,
			};
		},
		renderResult(result, _options, theme, _context) {
			return renderDispatchResult(
				result as Parameters<typeof renderDispatchResult>[0],
				{ expanded: false } as never,
				theme,
			);
		},
	});
}

function parseResultParams(params: ResultToolParams): ParsedResultRequest {
	if (!params || typeof params !== "object") {
		throw new TypeError("Invalid get_subagent_result arguments: expected an object.");
	}
	if (typeof params.agent_id !== "string" || params.agent_id.length === 0) {
		throw new TypeError("Invalid get_subagent_result arguments: agent_id must be a non-empty string.");
	}
	const wait = params.wait ?? false;
	if (typeof wait !== "boolean") {
		throw new TypeError("Invalid get_subagent_result arguments: wait must be a boolean.");
	}
	const verbose = params.verbose ?? false;
	if (typeof verbose !== "boolean") {
		throw new TypeError("Invalid get_subagent_result arguments: verbose must be a boolean.");
	}
	const timeoutMs = params.timeoutMs;
	if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 1000)) {
		throw new TypeError("Invalid get_subagent_result arguments: timeoutMs must be an integer >= 1000.");
	}
	const recentEvents = params.recentEvents;
	if (recentEvents !== undefined) {
		if (typeof recentEvents !== "number" || !Number.isInteger(recentEvents) || recentEvents <= 0) {
			throw new TypeError("Invalid get_subagent_result arguments: recentEvents must be a positive integer.");
		}
	}
	return {
		agentId: params.agent_id,
		wait,
		verbose,
		timeoutMs,
		recentEvents: recentEvents === undefined ? undefined : Math.min(recentEvents, MAX_RECENT_TRANSCRIPT_EVENTS),
	};
}

async function readRequestedRecentOutput(
	state: SubagentState,
	recentEvents: number | undefined,
): Promise<TranscriptExcerpt | undefined> {
	if (recentEvents === undefined) return undefined;
	return readRecentTranscriptExcerpt(state.paths.output, { maxEvents: recentEvents });
}

async function formatResultText(
	state: SubagentState,
	verbose: boolean,
	alreadyHandled = false,
	recentOutput?: TranscriptExcerpt,
): Promise<string> {
	if (alreadyHandled && state.status === "done" && !verbose) {
		return appendRecentOutput([formatAlreadyHandledText(state)], recentOutput).join("\n");
	}
	const lines = [formatParentSummary(state, { full: true })];
	if (!TERMINAL.has(state.status)) {
		lines.push("");
		lines.push(`Status: ${state.status}`);
		if (state.activity) lines.push(`Activity: ${state.activity}`);
		if (state.lastText) lines.push(`Last text: ${state.lastText}`);
		lines.push(`State: ${state.paths.state}`);
		lines.push(`Trace: ${state.paths.output}`);
	}
	appendRecentOutput(lines, recentOutput);
	if (verbose) {
		lines.push("");
		lines.push("--- Transcript JSONL ---");
		lines.push(await readTranscript(state.paths.output));
	}
	return lines.join("\n");
}

function appendRecentOutput(lines: string[], recentOutput?: TranscriptExcerpt): string[] {
	if (!recentOutput) return lines;
	lines.push("");
	lines.push("--- Recent Output ---");
	if (recentOutput.kind === "events") {
		lines.push(...recentOutput.events);
	} else {
		lines.push(recentOutput.message);
	}
	return lines;
}

function formatAlreadyHandledText(state: SubagentState): string {
	return [
		`${state.alias} #${state.agentId} (${state.agent}) already completed and its result was already delivered to this conversation.`,
		"Use the existing completion notification or blocking result in context; call with verbose=true only for transcript debugging.",
	].join("\n");
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
