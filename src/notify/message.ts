import { buildSummaryPreview, formatParentSummary } from "../summary.js";
import type { SubagentState } from "../types.js";

export function formatUsage(state: SubagentState): string {
	const u = state.usage;
	const parts: string[] = [];
	parts.push(`${state.provider}/${state.model}`);
	parts.push(`${state.turns} turn${state.turns === 1 ? "" : "s"}`);
	if (u.cost > 0) parts.push(`$${u.cost.toFixed(4)}`);
	return parts.join(", ");
}

export function formatCompletionMessage(state: SubagentState): string {
	const usage = formatUsage(state);
	if (state.status === "done") {
		return [
			`✓ subagent ${state.alias} (${state.agent}) #${state.agentId} finished (${usage}).`,
			"",
			formatParentSummary(state, { format: "xml", full: true }),
		].join("\n");
	}
	if (state.status === "aborted") {
		return [
			`✗ subagent ${state.alias} (${state.agent}) #${state.agentId} aborted: ${state.errorMessage ?? "(no reason)"}.`,
			"",
			formatParentSummary(state, { format: "xml", full: true }),
		].join("\n");
	}
	const err = state.errorMessage ?? `exit ${state.exitCode}`;
	return [
		`✗ subagent ${state.alias} (${state.agent}) #${state.agentId} ${state.status} (exit ${state.exitCode}, "${err}").`,
		"",
		formatParentSummary(state, { format: "xml", full: true }),
		`Stderr: ${state.paths.stderr}`,
	].join("\n");
}

export function formatBatchedMessage(states: SubagentState[]): string {
	const lines = ["Sub-agent batch update:", ""];
	for (const s of states) {
		const icon = s.status === "done" ? "✓" : "✗";
		const ext =
			s.status === "done"
				? `done (${s.provider}/${s.model}, ${s.turns} turns, $${s.usage.cost.toFixed(4)})`
				: `failed (${s.provider}/${s.model}): ${s.errorMessage ?? "unknown"}`;
		lines.push(`  ${icon} ${s.alias} (${s.agent}) #${s.agentId} ${ext}`);
	}
	lines.push("");
	lines.push("Details for each:");
	for (const s of states) {
		const output = buildSummaryPreview(s, { full: true }).text;
		lines.push(`  - ${s.alias} #${s.agentId}: ${output}`);
		lines.push(`    Trace: ${s.paths.output}`);
		lines.push(`    State: ${s.paths.state}`);
	}
	return lines.join("\n");
}
