import { supportsThinkingLevel } from "./thinking.js";

export interface SystemPromptArgs {
	agents: Array<{ name: string; description: string; source: string }>;
	configuredSlots: Set<string>;
	stateDirRoot: string;
	models?: Array<{
		provider: string;
		id: string;
		name?: string;
		reasoning?: boolean;
		thinkingLevelMap?: unknown;
	}>;
	currentModel?: { provider: string; id: string } | null;
}

export function buildSystemPromptBlock(args: SystemPromptArgs): string {
	const configured: string[] = [];
	const unconfigured: string[] = [];
	for (const a of args.agents) {
		const line = `  ${a.name}: ${a.description}`;
		(args.configuredSlots.has(a.name) ? configured : unconfigured).push(line);
	}

	const lines = [
		"## pi-crew sub-agents",
		"",
		"You can delegate tasks to specialized sub-agents that run in isolated processes",
		"with their own context windows. Use this to keep your context window clean while",
		"heavy work happens elsewhere.",
		"",
		"When to delegate:",
		"  - Codebase understanding, reconnaissance, discovery, or summaries → use `explore`.",
		'    Examples: "what is this project about?", "explain this repo", "summarize the architecture", \'where is X\', \'find all Y\'.',
		"    Treat `explore` as the reconnaissance owner: use blocking `subagent_run`, then wait before reading/searching the same code.",
		"    Background `explore` requests are coerced to blocking; after it returns, do only targeted follow-up reads.",
		"  - Planning, code review, implementation, or any other role → use `general-purpose`.",
		"",
		"Dispatch model:",
		"  - Every sub-agent launch requires `alias`: a short instance/job name for UI, e.g. `schema-validator` or `repo-map`.",
		"  - Background: `subagent_dispatch` — returns immediately, you keep working. `explore` is coerced to blocking.",
		"  - Background completion is auto-injected into this conversation via notification.",
		"  - After `subagent_dispatch` or Ctrl+B backgrounding, do not poll, sleep, or call status/result tools just to wait for completion.",
		"  - Continue with independent work or respond to the user; use status/result only for explicit progress checks, stale jobs, or recovery/debugging.",
		"  - Sequential: `subagent_run` (blocks) — for chain mode.",
		"  - Parallel: `subagent_run` with `tasks: [...]`.",
		"",
		"Model overrides:",
		"  - Active agent UI shows each agent's alias plus provider/model/thinking.",
		"  - `subagent_dispatch` and `subagent_run` accept optional `provider`, `model`, and `thinking` overrides.",
		"  - `subagent_resume` includes these params for future use but they are not yet applied.",
		"  - If `model` is supplied without `provider`, provider is inferred from the configured slot or current parent model when possible.",
		"  - Valid thinking levels: off, minimal, low, medium, high, xhigh, max. Unsupported max uses the nearest supported lower level and reports requested/effective values; non-reasoning models force thinking off.",
		...formatModelLines(args),
		"",
		"Tracking:",
		"  - Prefer background completion notifications and blocking `subagent_run` results; do not fetch the same result again.",
		"  - `get_subagent_result` is last-resort recovery/debug: explicit user request, missed notification, failed/aborted/orphaned/detached run, bounded sanitized recentEvents inspection, or verbose transcript inspection.",
		"    Do not use it for routine polling or after a normal completion notification/blocking result; that duplicates context.",
		"  - `subagent_resume` — continue a session-mode sub-agent with a new prompt (resumes its conversation).",
		"  - `steer_subagent` — redirect a running session-mode sub-agent.",
		"  - `subagent_status` — not a wait/poll primitive; use for explicit progress checks, stale-job triage, kill/resume/steer decisions, or debugging.",
		"    Default shows current starting/running sub-agents; use scope:'stopped' for recent failed/orphaned/aborted/detached triage, or agentId for exact lookup. limit is only valid when scope:'stopped' is supplied explicitly.",
		"  - `subagent_kill` — abort if you change your mind.",
		"",
		"State directory:",
		`  ${args.stateDirRoot}/<sessionId>/<agentId>/`,
		"    state.json     — live snapshot (status, usage, last activity)",
		"    output.jsonl   — full subprocess JSONL stream — read for full trajectory.",
		"    stderr.log     — subprocess stderr.",
		"    prompt.md      — exact system prompt the sub-agent ran with.",
		"",
		"Available agents:",
		...configured,
	];
	if (unconfigured.length > 0) {
		const names = unconfigured.map((l) => l.trim().split(":")[0]).join(", ");
		lines.push("");
		lines.push(`  ✗ Unconfigured: ${names}`);
		lines.push("    (Run /subagent-config to set models)");
	}
	lines.push(
		"",
		"When delegating: keep tasks specific and self-contained. The sub-agent has",
		"no memory of this conversation — give it everything it needs in the task text.",
	);
	return lines.join("\n");
}

function formatModelLines(args: SystemPromptArgs): string[] {
	const byId = new Map<string, NonNullable<SystemPromptArgs["models"]>[number]>();
	for (const model of args.models ?? []) {
		const key = modelKey(model);
		if (!byId.has(key)) byId.set(key, model);
	}
	const all = [...byId.values()];
	const current = all.find((model) => isSameModel(model, args.currentModel));
	const remaining = all.filter((model) => model !== current);
	const maxCapable = remaining.filter(isMaxCapable).sort(compareModels);
	const others = remaining.filter((model) => !isMaxCapable(model)).sort(compareModels);
	const models = [...(current ? [current] : []), ...maxCapable, ...others];
	const lines = ["  - Available authenticated models:"];
	if (models.length === 0) {
		lines.push("    (none reported; use /model or /login in Pi to configure models)");
		return lines;
	}
	const maxModels = 40;
	const visible = models.slice(0, maxModels);
	for (const model of visible) {
		const currentLabel = isSameModel(model, args.currentModel) ? " current parent" : "";
		const maxLabel = isMaxCapable(model) ? " max-capable" : "";
		const reasoning = model.reasoning ? "reasoning" : "non-reasoning";
		lines.push(`    - provider: ${model.provider}, model: ${model.id} — ${reasoning}${maxLabel}${currentLabel}`);
	}
	if (models.length > maxModels) {
		const omitted = models.slice(maxModels);
		const omittedMax = omitted.filter(isMaxCapable).length;
		const maxSuffix = omittedMax > 0 ? ` (${omittedMax} max-capable)` : "";
		lines.push(`    - … ${omitted.length} more models omitted${maxSuffix}`);
	}
	return lines;
}

function compareModels(a: { provider: string; id: string }, b: { provider: string; id: string }): number {
	const providerCmp = a.provider.localeCompare(b.provider);
	return providerCmp !== 0 ? providerCmp : a.id.localeCompare(b.id);
}

function modelKey(model: { provider: string; id: string }): string {
	return `${model.provider}\u0000${model.id}`;
}

function isSameModel(
	model: { provider: string; id: string },
	other: { provider: string; id: string } | null | undefined,
): boolean {
	return Boolean(other && model.provider === other.provider && model.id === other.id);
}

function isMaxCapable(model: { reasoning?: boolean; thinkingLevelMap?: unknown }): boolean {
	return supportsThinkingLevel(model as { reasoning: boolean; thinkingLevelMap?: unknown }, "max", () => false);
}
