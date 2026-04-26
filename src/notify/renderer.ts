import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import type { SubagentState } from "../types.js";
import { formatUsageStats } from "../ui/format.js";

export interface PiCrewNotificationDetails {
	states: SubagentState[];
}

export function registerNotificationRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<PiCrewNotificationDetails>("pi-crew", (message, { expanded }, theme) => {
		const states = message.details?.states;
		if (!states || states.length === 0) return undefined;
		return new Text(states.map((state) => renderState(state, expanded, theme)).join("\n"), 0, 0);
	});
}

function renderState(state: SubagentState, expanded: boolean, theme: Theme): string {
	const ok = state.status === "done";
	const icon = ok ? theme.fg("success", "✓") : theme.fg("error", "✗");
	const title = `${icon} ${theme.bold(`${state.alias} #${state.agentId}`)} ${theme.fg("dim", `(${state.agent})`)} ${theme.fg(ok ? "dim" : "warning", state.status)}`;
	const stats = notificationStats(state);
	const reason = ok
		? (state.finalOutput ?? "No output.")
		: (state.errorMessage ?? `exit ${state.exitCode ?? "unknown"}`);
	const preview = expanded ? reason : reason.split("\n")[0]?.slice(0, 160) || "No output.";
	const lines = [title, `  ${theme.fg("dim", stats)}`, `  ${theme.fg("dim", `⎿  ${preview}`)}`];
	if (!ok || expanded) lines.push(`  ${theme.fg("muted", `state: ${state.paths.state}`)}`);
	if (expanded) lines.push(`  ${theme.fg("muted", `transcript: ${state.paths.output}`)}`);
	return lines.join("\n");
}

function notificationStats(state: SubagentState): string {
	const parts = [`${state.provider}/${state.model}`, state.thinking, formatTurns(state.turns, state.maxTurns)];
	const toolUses = state.toolUses ?? 0;
	if (toolUses > 0) parts.push(`${toolUses} tool use${toolUses === 1 ? "" : "s"}`);
	const usage = formatUsageStats(state.usage);
	if (usage) parts.push(usage);
	if (state.finishedAt) parts.push(formatDuration(state.finishedAt - state.startedAt));
	return parts.join(" · ");
}

function formatTurns(turns: number, maxTurns: number | null): string {
	return maxTurns ? `⟳${turns}≤${maxTurns}` : `⟳${turns}`;
}

function formatDuration(ms: number): string {
	const seconds = Math.max(0, ms) / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${Math.floor(seconds % 60)}s`;
}
