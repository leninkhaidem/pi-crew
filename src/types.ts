/**
 * pi-crew shared types.
 *
 * Public exports re-exposed via package's "./events" entrypoint for external
 * subscribers.
 */

// ─────────────────────── Sub-agent state (on disk) ───────────────────────

export type SubagentStatus = "starting" | "running" | "done" | "failed" | "aborted" | "orphaned" | "detached";

export interface SubagentUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
}

export interface SubagentToolCall {
	name: string;
	args: Record<string, unknown>;
}

export interface SubagentPaths {
	state: string;
	output: string;
	stderr: string;
	prompt: string;
}

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const DEFAULT_AGENT_THINKING: Record<string, ThinkingLevel> = {
	explore: "low",
	"general-purpose": "medium",
	plan: "high",
	"code-reviewer": "high",
};

export function defaultThinkingForAgent(agentName: string): ThinkingLevel {
	return DEFAULT_AGENT_THINKING[agentName] ?? "medium";
}

export interface SubagentState {
	schemaVersion: 1;
	agentId: string;
	parentAgentId: string | null;
	sessionId: string;
	agent: string;
	agentSource: "user" | "project" | "bundled";
	task: string;
	cwd: string;
	branch: string | null;
	model: string;
	provider: string;
	thinking: ThinkingLevel;
	tools: string[] | null;
	maxTurns: number | null;
	pid: number | null;
	startedAt: number;
	finishedAt: number | null;
	lastUpdate: number;
	status: SubagentStatus;
	exitCode: number | null;
	stopReason: string | null;
	errorMessage: string | null;
	turns: number;
	usage: SubagentUsage;
	lastText: string | null;
	lastToolCall: SubagentToolCall | null;
	finalOutput: string | null;
	paths: SubagentPaths;
}

// ─────────────────────── Agent definition (.md frontmatter) ───────────────

export interface AgentConfig {
	name: string;
	description: string;
	tools: string[] | null;
	systemPrompt: string;
	source: "user" | "project" | "bundled";
	filePath: string;
}

// ─────────────────────── Configuration (pi-crew.json) ─────────────────────

export interface AgentSlot {
	provider: string;
	modelId: string;
	thinking?: ThinkingLevel;
}

export interface GlobalSettings {
	maxConcurrent: number;
	maxActive: number;
	maxParallelTasksPerCall: number;
	retentionDays: number;
	notifyOnCompletion: boolean;
	agentScope: "user" | "project" | "both";
	confirmProjectAgents: boolean;
}

export interface TmuxSettings {
	mode: "off" | "window" | "external-session";
	killOnComplete: "off" | "after-grace";
	graceSeconds: number;
}

export interface PiCrewConfig {
	version: 1;
	agents: Record<string, AgentSlot>;
	global: GlobalSettings;
	tmux: TmuxSettings;
}

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
	maxConcurrent: 4,
	maxActive: 16,
	maxParallelTasksPerCall: 8,
	retentionDays: 7,
	notifyOnCompletion: true,
	agentScope: "user",
	confirmProjectAgents: true,
};

export const DEFAULT_TMUX_SETTINGS: TmuxSettings = {
	mode: "off",
	killOnComplete: "off",
	graceSeconds: 30,
};

// ─────────────────────── Event payloads (pi.events) ──────────────────────

export interface PiCrewDispatchEvent {
	agentId: string;
	parentAgentId: string | null;
	agent: string;
	task: string;
	cwd: string;
	model: string;
	provider: string;
	sessionId: string;
}

export interface PiCrewStartEvent {
	agentId: string;
	pid: number;
}

export interface PiCrewEndEvent {
	agentId: string;
	status: SubagentStatus;
	exitCode: number | null;
	stopReason: string | null;
	finalOutput: string | null;
	usage: SubagentUsage;
	errorMessage: string | null;
}

export interface PiCrewKilledEvent {
	agentId: string;
	reason: string | undefined;
	killed: boolean;
}

export interface PiCrewOrphanedEvent {
	agentId: string;
	lastUpdate: number;
	pid: number | null;
}

export interface PiCrewDetachedEvent {
	agentId: string;
}

export interface PiCrewConfigChangedEvent {
	before: PiCrewConfig;
	after: PiCrewConfig;
	changedKeys: string[];
}

// ─────────────────────── Dispatch options ────────────────────────────────

export interface DispatchOptions {
	agent: string;
	task: string;
	cwd?: string;
	maxTurns?: number;
}
