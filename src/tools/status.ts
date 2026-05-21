import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import type { ExtensionRuntime } from "../runtime/types.js";
import { getRoot } from "../state/paths.js";
import { listStates, readState } from "../state/store.js";
import type { SubagentState, SubagentStatus } from "../types.js";

const ACTIVE_STATUSES = new Set<SubagentStatus>(["starting", "running"]);
const STOPPED_STATUSES = ["failed", "orphaned", "aborted", "detached"] as const satisfies readonly SubagentStatus[];
const STOPPED_STATUS_PRIORITY = new Map<SubagentStatus, number>(
	STOPPED_STATUSES.map((status, index) => [status, index]),
);
const DEFAULT_STOPPED_LIMIT = 5;
const MAX_STOPPED_LIMIT = 10;
const PREVIEW_LENGTH = 120;

const ScopeSchema = Type.Union([Type.Literal("active"), Type.Literal("stopped")], {
	default: "active",
	description: "Listing view. Defaults to active current-session sub-agents.",
});

interface StatusToolParams {
	agentId?: unknown;
	scope?: unknown;
	limit?: unknown;
}

interface ParsedStatusRequest {
	agentId?: string;
	scope: "active" | "stopped";
	limit?: number;
}

type StoppedStatus = (typeof STOPPED_STATUSES)[number];
type StatusCounts = Record<StoppedStatus, number>;

export function registerStatusTool(pi: ExtensionAPI, rt: ExtensionRuntime): void {
	pi.registerTool({
		name: "subagent_status",
		label: "Subagent status",
		description: [
			"Peek at current sub-agents without completed-agent noise.",
			"Do not use for routine polling or wait loops after background dispatch/detach; completion notifications are injected automatically.",
			"Use for explicit progress checks, stale-job triage, kill/resume/steer decisions, or debugging.",
			"Default args {} return all current active agents (starting/running), uncapped.",
			"Args: { agentId } for exact lookup, or { scope?: 'active'|'stopped', limit? }.",
			"scope:'stopped' returns recent problematic stopped agents only (failed/orphaned/aborted/detached), capped to 5 by default and 10 at most.",
		].join(" "),
		parameters: Type.Object(
			{
				agentId: Type.Optional(Type.String({ description: "Exact sub-agent ID to inspect across retained sessions." })),
				scope: Type.Optional(ScopeSchema),
				limit: Type.Optional(
					Type.Integer({
						minimum: 1,
						description: "Positive integer requested for scope:'stopped'. Values above 10 are bounded to 10.",
					}),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const request = parseStatusParams(params as StatusToolParams);
			const sessionId = rt.resolveSessionId(ctx);
			const root = getRoot({ agentDir: rt.agentDir });

			if (request.agentId) {
				const found = await findById(root, request.agentId);
				const states = found ? [found] : [];
				const text = formatStatusList(states);
				return {
					content: [{ type: "text" as const, text }],
					details: { count: states.length, states: states.map(compactStateDetails) },
				};
			}

			if (request.scope === "stopped") {
				const states = await listStoppedStates(path.join(root, sessionId));
				const limit = Math.min(request.limit ?? DEFAULT_STOPPED_LIMIT, MAX_STOPPED_LIMIT);
				const statusCounts = countStoppedStatuses(states);
				const visibleStates = states.slice(0, limit);
				const text = formatStoppedList(visibleStates, {
					limit,
					totalStopped: states.length,
					omitted: Math.max(0, states.length - visibleStates.length),
					statusCounts,
				});
				return {
					content: [{ type: "text" as const, text }],
					details: {
						count: visibleStates.length,
						totalStopped: states.length,
						omitted: Math.max(0, states.length - visibleStates.length),
						limit,
						statusCounts,
						states: visibleStates.map(compactStoppedDetails),
					},
				};
			}

			const states = await listActiveStates(path.join(root, sessionId));
			const text = formatStatusList(states);
			return {
				content: [{ type: "text" as const, text }],
				details: { count: states.length, states: states.map(compactStateDetails) },
			};
		},
	});
}

function parseStatusParams(params: StatusToolParams): ParsedStatusRequest {
	if (!params || typeof params !== "object")
		throw new TypeError("Invalid subagent_status arguments: expected an object.");
	for (const key of Object.keys(params)) {
		if (key !== "agentId" && key !== "scope" && key !== "limit") {
			throw new TypeError(`Invalid subagent_status arguments: unsupported field '${key}'.`);
		}
	}
	const agentId = params.agentId;
	if (agentId !== undefined && typeof agentId !== "string") {
		throw new TypeError("Invalid subagent_status arguments: agentId must be a string.");
	}
	const scope = params.scope ?? "active";
	if (scope !== "active" && scope !== "stopped") {
		throw new TypeError("Invalid subagent_status arguments: scope must be 'active' or 'stopped'.");
	}
	const limit = params.limit;
	if (limit !== undefined) {
		if (scope !== "stopped" || agentId !== undefined) {
			throw new TypeError("Invalid subagent_status arguments: limit is only valid with scope:'stopped'.");
		}
		if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0) {
			throw new TypeError("Invalid subagent_status arguments: limit must be a positive integer.");
		}
	}
	return { agentId, scope, limit };
}

async function listActiveStates(sessionDir: string): Promise<SubagentState[]> {
	const list = await listStates(sessionDir);
	return list.filter((state) => ACTIVE_STATUSES.has(state.status));
}

async function listStoppedStates(sessionDir: string): Promise<SubagentState[]> {
	const list = await listStates(sessionDir, { includeDetached: true });
	return list.filter(isStoppedState).sort(compareStoppedStates);
}

function isStoppedState(state: SubagentState): boolean {
	return STOPPED_STATUS_PRIORITY.has(state.status);
}

function compareStoppedStates(a: SubagentState, b: SubagentState): number {
	const priority =
		(STOPPED_STATUS_PRIORITY.get(a.status) ?? Number.MAX_SAFE_INTEGER) -
		(STOPPED_STATUS_PRIORITY.get(b.status) ?? Number.MAX_SAFE_INTEGER);
	if (priority !== 0) return priority;
	return stoppedSortTime(b) - stoppedSortTime(a);
}

function stoppedSortTime(state: SubagentState): number {
	return state.finishedAt ?? state.lastUpdate;
}

function countStoppedStatuses(states: SubagentState[]): StatusCounts {
	const counts: StatusCounts = { failed: 0, orphaned: 0, aborted: 0, detached: 0 };
	for (const state of states) {
		if (isStoppedStatus(state.status)) counts[state.status] += 1;
	}
	return counts;
}

function isStoppedStatus(status: SubagentStatus): status is StoppedStatus {
	return STOPPED_STATUS_PRIORITY.has(status);
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

function compactStoppedDetails(state: SubagentState) {
	return {
		agentId: state.agentId,
		alias: state.alias,
		agent: state.agent,
		status: state.status,
		taskPreview: truncateLine(state.task, PREVIEW_LENGTH),
		finishedAt: state.finishedAt,
		errorMessagePreview: state.errorMessage ? truncateLine(state.errorMessage, PREVIEW_LENGTH) : null,
	};
}

function formatStatusList(states: SubagentState[]): string {
	if (states.length === 0) return "(no sub-agents)";
	const lines: string[] = [];
	for (const s of states) {
		const icon = iconFor(s.status);
		lines.push(
			`${icon} ${s.alias} #${s.agentId} (${s.agent}, ${s.model}, ${s.thinking}) ${s.status} — ${truncateLine(s.task, PREVIEW_LENGTH)}`,
		);
		if (s.lastText) lines.push(`    last: ${truncateLine(s.lastText, PREVIEW_LENGTH)}`);
		if (s.lastToolCall) lines.push(`    tool: ${s.lastToolCall.name}`);
		lines.push(`    state: ${s.paths.state}`);
		lines.push(`    output: ${s.paths.output}`);
	}
	return lines.join("\n");
}

function formatStoppedList(
	states: SubagentState[],
	meta: { limit: number; totalStopped: number; omitted: number; statusCounts: StatusCounts },
): string {
	const lines = [
		`Stopped sub-agents: showing ${states.length}/${meta.totalStopped} (limit ${meta.limit}, omitted ${meta.omitted})`,
		`Counts: failed=${meta.statusCounts.failed}, orphaned=${meta.statusCounts.orphaned}, aborted=${meta.statusCounts.aborted}, detached=${meta.statusCounts.detached}`,
	];
	if (states.length === 0) {
		lines.push("(no stopped sub-agents needing triage)");
		return lines.join("\n");
	}
	for (const s of states) {
		const details = compactStoppedDetails(s);
		lines.push(`✗ ${details.alias} #${details.agentId} (${details.agent}) ${details.status} — ${details.taskPreview}`);
		lines.push(`    finishedAt: ${details.finishedAt ?? "null"}`);
		lines.push(`    errorMessagePreview: ${details.errorMessagePreview ?? ""}`);
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
