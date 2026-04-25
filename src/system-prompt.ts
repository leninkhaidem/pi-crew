export interface SystemPromptArgs {
	agents: Array<{ name: string; description: string; source: string }>;
	configuredSlots: Set<string>;
	stateDirRoot: string;
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
		"  - Codebase reconnaissance ('where is X', 'find all Y') → use `explore`",
		"  - Multi-file refactor planning → use `plan`",
		"  - Code review of a diff or files → use `code-reviewer`",
		"  - Anything else needing isolation or large search → use `general-purpose`",
		"",
		"Dispatch model:",
		"  - Default: `subagent_dispatch` (background) — returns immediately, you keep working.",
		"    Completion is auto-injected into this conversation.",
		"  - Sequential: `subagent_run` (blocks) — for chain mode.",
		"  - Parallel: `subagent_run` with `tasks: [...]`.",
		"",
		"Tracking:",
		"  - `subagent_status` — peek at running/completed sub-agents.",
		"  - `subagent_wait` — block on specific ids when you need their result.",
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
