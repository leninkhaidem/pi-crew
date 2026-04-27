import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { SubagentState } from "../types.js";
import { formatStateActivity } from "./activity.js";
import { formatToolCall, formatUsageStats } from "./format.js";

const MAX_PANEL_ITEMS = 5;

export interface PanelRenderArgs {
	states: SubagentState[];
	selectedIdx: number;
	width: number;
	theme: Theme;
	scrollOffset?: number;
	detailedAgentId?: string | null;
	pendingKillAgentId?: string | null;
}

export function renderSubagentsPanel(args: PanelRenderArgs): string[] {
	const panelArgs = { ...args, states: args.states.filter(isActiveSubagentState), width: Math.max(40, args.width) };
	const lines = [border("╭", "╮", " pi-crew sub-agents ", panelArgs.width, panelArgs.theme)];
	lines.push(row(` ${panelArgs.states.length} active`, panelArgs.width, panelArgs.theme));
	lines.push(helpLine(panelArgs));
	lines.push(border("├", "┤", "", panelArgs.width, panelArgs.theme));
	if (panelArgs.states.length === 0) {
		lines.push(row(" No running sub-agents in current batch.", panelArgs.width, panelArgs.theme, "muted"));
	} else {
		appendStateRows(lines, panelArgs);
		appendDetailRowsForSelection(lines, panelArgs);
	}
	lines.push(border("╰", "╯", "", panelArgs.width, panelArgs.theme));
	return lines;
}

function helpLine(args: PanelRenderArgs): string {
	const pending = args.states.find((state) => state.agentId === args.pendingKillAgentId);
	if (pending) return row(` Kill ${pending.alias} #${pending.agentId}? y/N`, args.width, args.theme, "warning");
	const detailVerb = args.detailedAgentId ? "enter hide details" : "enter details";
	return row(` ↑↓/j/k select · ${detailVerb} · ← close/back · d kill · esc back`, args.width, args.theme, "dim");
}

function appendStateRows(lines: string[], args: PanelRenderArgs): void {
	const offset = args.scrollOffset ?? 0;
	const visible = args.states.slice(offset, offset + MAX_PANEL_ITEMS);
	for (const [idx, state] of visible.entries()) {
		const absoluteIdx = offset + idx;
		const selected = absoluteIdx === args.selectedIdx;
		const detailed = state.agentId === args.detailedAgentId;
		lines.push(row(summaryLine(state, selected, detailed, args.theme), args.width, args.theme));
	}
	const hiddenBefore = offset;
	const hiddenAfter = Math.max(0, args.states.length - offset - visible.length);
	if (hiddenBefore > 0 || hiddenAfter > 0) {
		lines.push(row(` … ${hiddenBefore} above, ${hiddenAfter} below`, args.width, args.theme, "dim"));
	}
}

function appendDetailRowsForSelection(lines: string[], args: PanelRenderArgs): void {
	const state = args.states.find((candidate) => candidate.agentId === args.detailedAgentId);
	if (!state) return;
	lines.push(border("├", "┤", ` ${state.alias} #${state.agentId} `, args.width, args.theme));
	lines.push(
		row(
			detailLine(args.theme, "model", `${state.agent} · ${state.provider}/${state.model} · ${state.thinking}`),
			args.width,
			args.theme,
		),
	);
	lines.push(row(detailLine(args.theme, "task", state.task), args.width, args.theme));
	lines.push(row(detailLine(args.theme, "cwd", state.cwd), args.width, args.theme));
	lines.push(row(detailLine(args.theme, "now", formatStateActivity(state)), args.width, args.theme));
	if (state.lastToolCall) {
		lines.push(
			row(
				detailLine(args.theme, "tool", formatToolCall(state.lastToolCall.name, state.lastToolCall.args)),
				args.width,
				args.theme,
			),
		);
	}
	if (state.lastText) lines.push(row(detailLine(args.theme, "text", state.lastText), args.width, args.theme));
	lines.push(row(detailLine(args.theme, "usage", detailUsage(state)), args.width, args.theme));
}

function detailUsage(state: SubagentState): string {
	return `${formatUsageStats({ ...state.usage, turns: state.turns })} · ${formatDuration(Date.now() - state.startedAt)}`;
}

function detailLine(theme: Theme, label: string, value: string): string {
	return ` ${theme.fg("dim", label.padEnd(5))} ${oneLine(value)}`;
}

function summaryLine(state: SubagentState, selected: boolean, detailed: boolean, theme: Theme): string {
	const pointer = selected ? theme.fg("accent", "▸") : " ";
	const detail = detailed ? theme.fg("accent", "◉") : " ";
	const icon = iconFor(state.status, theme);
	const elapsed = formatDuration(Date.now() - state.startedAt);
	return `${pointer}${detail} ${icon} ${state.alias} · ${state.agent} · ${state.status} · ${elapsed} · ${formatStateActivity(state)}`;
}

function border(left: string, right: string, title: string, width: number, theme: Theme): string {
	const fill = Math.max(0, width - visibleWidth(left) - visibleWidth(right) - visibleWidth(title));
	return theme.fg("borderAccent", `${left}${title}${"─".repeat(fill)}${right}`);
}

function row(
	content: string,
	width: number,
	theme: Theme,
	color: "text" | "muted" | "dim" | "warning" = "text",
): string {
	const innerWidth = Math.max(0, width - 2);
	const singleLine = content.replace(/\s+/g, " ").trim();
	const trimmed = truncateToWidth(theme.fg(color, singleLine), innerWidth, "…");
	const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(trimmed)));
	return `${theme.fg("borderMuted", "│")}${trimmed}${padding}${theme.fg("borderMuted", "│")}`;
}

export function isActiveSubagentState(state: SubagentState): boolean {
	return state.status === "running" || state.status === "starting";
}

function iconFor(status: SubagentState["status"], theme: Theme): string {
	if (status === "starting") return theme.fg("warning", "◌");
	if (status === "running") return theme.fg("warning", "⏳");
	if (status === "done") return theme.fg("success", "✓");
	return theme.fg("error", "✗");
}

function formatDuration(ms: number): string {
	const seconds = Math.max(0, ms) / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${Math.floor(seconds % 60)}s`;
}

function oneLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}
