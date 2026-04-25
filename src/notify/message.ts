import type { SubagentState } from "../types.js";

const PREVIEW_LEN = 200;

export function formatUsage(state: SubagentState): string {
	const u = state.usage;
	const parts: string[] = [];
	parts.push(`${state.model}`);
	parts.push(`${state.turns} turn${state.turns === 1 ? "" : "s"}`);
	if (u.cost > 0) parts.push(`$${u.cost.toFixed(4)}`);
	return parts.join(", ");
}

export function formatCompletionMessage(state: SubagentState): string {
	const usage = formatUsage(state);
	if (state.status === "done") {
		return [
			`✓ subagent ${state.agent} #${state.agentId} finished (${usage}).`,
			"",
			state.finalOutput ?? "(no output)",
			"",
			`Full transcript: ${state.paths.output}`,
			`State: ${state.paths.state}`,
		].join("\n");
	}
	if (state.status === "aborted") {
		return [
			`✗ subagent ${state.agent} #${state.agentId} aborted: ${state.errorMessage ?? "(no reason)"}.`,
			`State: ${state.paths.state}`,
		].join("\n");
	}
	const err = state.errorMessage ?? `exit ${state.exitCode}`;
	return [
		`✗ subagent ${state.agent} #${state.agentId} ${state.status} (exit ${state.exitCode}, "${err}").`,
		`Stderr: ${state.paths.stderr}`,
		`State: ${state.paths.state}`,
	].join("\n");
}

export function formatBatchedMessage(states: SubagentState[]): string {
	const lines = ["Sub-agent batch update:", ""];
	for (const s of states) {
		const icon = s.status === "done" ? "✓" : "✗";
		const ext =
			s.status === "done"
				? `done (${s.turns} turns, $${s.usage.cost.toFixed(4)})`
				: `failed: ${s.errorMessage ?? "unknown"}`;
		lines.push(`  ${icon} ${s.agent} #${s.agentId} ${ext}`);
	}
	lines.push("");
	lines.push("Details for each:");
	for (const s of states) {
		const out = s.finalOutput ?? s.errorMessage ?? "(no output)";
		const preview = out.length > PREVIEW_LEN ? `${out.slice(0, PREVIEW_LEN)}…` : out;
		lines.push(`  - #${s.agentId}: ${preview}`);
		const trail = s.status === "done" ? `    Full: ${s.paths.output}` : `    Stderr: ${s.paths.stderr}`;
		lines.push(trail);
	}
	return lines.join("\n");
}
