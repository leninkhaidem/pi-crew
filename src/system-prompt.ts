export interface SystemPromptArgs {
	agents: Array<{ name: string; description: string; source: string }>;
	configuredSlots: Set<string>;
	stateDirRoot: string;
	models?: Array<{ provider: string; id: string; name?: string; reasoning?: boolean }>;
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
		"  - Background completion is auto-injected into this conversation. Do not poll just to receive normal results.",
		"  - Sequential: `subagent_run` (blocks) — for chain mode.",
		"  - Parallel: `subagent_run` with `tasks: [...]`.",
		"",
		"Model overrides:",
		"  - Active agent UI shows each agent's alias plus provider/model/thinking.",
		"  - `subagent_dispatch`, `subagent_run`, and `subagent_resume` accept optional `provider`, `model`, and `thinking` overrides.",
		"  - If `model` is supplied without `provider`, provider is inferred from the configured slot or current parent model when possible.",
		"  - Valid thinking levels: off, minimal, low, medium, high, xhigh. Non-reasoning models force thinking off.",
		...formatModelLines(args),
		"",
		"Tracking:",
		"  - Prefer background completion notifications and blocking `subagent_run` results; do not fetch the same result again.",
		"  - `get_subagent_result` is last-resort recovery/debug: explicit user request, missed notification, failed/aborted/orphaned/detached run, or verbose transcript inspection.",
		"    Do not use it for routine polling or after a normal completion notification/blocking result; that duplicates context.",
		"  - `subagent_resume` — continue a session-mode sub-agent with a new prompt (resumes its conversation).",
		"  - `steer_subagent` — redirect a running session-mode sub-agent.",
		"  - `subagent_status` — peek at running/completed sub-agents.",
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
	const models = [...(args.models ?? [])].sort((a, b) => {
		const providerCmp = a.provider.localeCompare(b.provider);
		return providerCmp !== 0 ? providerCmp : a.id.localeCompare(b.id);
	});
	const lines = ["  - Available authenticated models:"];
	if (models.length === 0) {
		lines.push("    (none reported; use /model or /login in Pi to configure models)");
		return lines;
	}
	const maxModels = 40;
	for (const model of models.slice(0, maxModels)) {
		const current =
			args.currentModel?.provider === model.provider && args.currentModel.id === model.id ? " current parent" : "";
		const reasoning = model.reasoning ? "reasoning" : "non-reasoning";
		lines.push(`    - provider: ${model.provider}, model: ${model.id} — ${reasoning}${current}`);
	}
	if (models.length > maxModels) lines.push(`    - … ${models.length - maxModels} more models omitted`);
	return lines;
}
