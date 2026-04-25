// src/ui/overlay.ts
import path from "node:path";
import type { ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { getRoot } from "../state/paths.js";
import type { SubagentState } from "../types.js";
import { formatToolCall, formatUsageStats } from "./format.js";
import { mountStateWatcher } from "./state-watcher.js";

const KEY_UP = "\x1b[A";
const KEY_DOWN = "\x1b[B";
const KEY_ENTER = "\r";
const KEY_ESC = "\x1b";
const KEY_K = "k";
const MAX_PANEL_ITEMS = 8;

interface PanelRenderArgs {
	states: SubagentState[];
	selectedIdx: number;
	expanded: Set<string>;
	width: number;
	theme: Theme;
}

class TreeOverlay implements Component {
	private states: SubagentState[] = [];
	private selectedIdx = 0;
	private expanded = new Set<string>();

	constructor(
		private theme: Theme,
		private onClose: () => void,
		private requestRender: () => void,
		private onKill: (state: SubagentState) => void | Promise<void>,
	) {}

	setStates(s: SubagentState[]) {
		this.states = sortStates(s);
		if (this.selectedIdx >= s.length) this.selectedIdx = Math.max(0, s.length - 1);
		this.requestRender();
	}

	handleInput(data: string): void {
		if (data === KEY_UP) {
			this.selectedIdx = Math.max(0, this.selectedIdx - 1);
			this.requestRender();
			return;
		}
		if (data === KEY_DOWN) {
			this.selectedIdx = Math.min(this.states.length - 1, this.selectedIdx + 1);
			this.requestRender();
			return;
		}
		if (data === KEY_ENTER) {
			this.toggleSelected();
			return;
		}
		if (data === KEY_K) {
			const state = this.states[this.selectedIdx];
			if (state && (state.status === "running" || state.status === "starting")) {
				void Promise.resolve(this.onKill(state)).finally(() => this.requestRender());
			}
			return;
		}
		if (data === KEY_ESC) this.onClose();
	}

	render(width: number): string[] {
		return renderSubagentsPanel({
			states: this.states,
			selectedIdx: this.selectedIdx,
			expanded: this.expanded,
			width,
			theme: this.theme,
		});
	}

	invalidate(): void {
		// no cached state
	}

	private toggleSelected(): void {
		const cur = this.states[this.selectedIdx];
		if (!cur) return;
		if (this.expanded.has(cur.agentId)) this.expanded.delete(cur.agentId);
		else this.expanded.add(cur.agentId);
		this.requestRender();
	}
}

export function renderSubagentsPanel(args: PanelRenderArgs): string[] {
	const panelArgs = { ...args, width: Math.max(40, args.width) };
	const counts = countByStatus(panelArgs.states);
	const lines = [border("╭", "╮", " pi-crew sub-agents ", panelArgs.width, panelArgs.theme)];
	lines.push(
		row(` ${counts.running} running  ${counts.done} done  ${counts.failed} failed`, panelArgs.width, panelArgs.theme),
	);
	lines.push(row(" ↑↓ select · enter expand · k kill running · esc close", panelArgs.width, panelArgs.theme, "dim"));
	lines.push(border("├", "┤", "", panelArgs.width, panelArgs.theme));
	if (panelArgs.states.length === 0) {
		lines.push(row(" No sub-agents for this session.", panelArgs.width, panelArgs.theme, "muted"));
	} else {
		appendStateRows(lines, panelArgs);
	}
	lines.push(border("╰", "╯", "", panelArgs.width, panelArgs.theme));
	return lines;
}

export async function openTreeOverlay(
	ctx: ExtensionCommandContext,
	agentDir: string,
	sessionId: string,
	onKill: (state: SubagentState) => void | Promise<void> = killSelected,
): Promise<void> {
	let watcherHandle: { stop: () => void } | null = null;
	await ctx.ui.custom<void>(
		(tui, theme, _kb, done) => {
			const overlay = new TreeOverlay(
				theme,
				() => {
					watcherHandle?.stop();
					done(undefined);
				},
				() => tui.requestRender(),
				onKill,
			);
			watcherHandle = mountStateWatcher({
				sessionDir: path.join(getRoot({ agentDir }), sessionId),
				onChange: (states) => overlay.setStates(states),
			});
			return overlay;
		},
		{
			overlay: true,
			overlayOptions: { width: "90%", minWidth: 70, maxHeight: "85%", anchor: "center", margin: 2 },
		},
	);
}

function appendStateRows(lines: string[], args: PanelRenderArgs): void {
	const visible = args.states.slice(0, MAX_PANEL_ITEMS);
	for (const [idx, state] of visible.entries()) {
		const selected = idx === args.selectedIdx;
		lines.push(row(summaryLine(state, selected, args.theme), args.width, args.theme));
		lines.push(row(`    ${state.task}`, args.width, args.theme, "muted"));
		if (args.expanded.has(state.agentId)) appendExpandedRows(lines, state, args.width, args.theme);
	}
	const overflow = args.states.length - visible.length;
	if (overflow > 0) lines.push(row(` … ${overflow} more not shown`, args.width, args.theme, "dim"));
}

function appendExpandedRows(lines: string[], state: SubagentState, width: number, theme: Theme): void {
	lines.push(row(`    cwd: ${state.cwd}`, width, theme, "dim"));
	lines.push(row(`    state: ${state.paths.state}`, width, theme, "dim"));
	lines.push(row(`    output: ${state.paths.output}`, width, theme, "dim"));
	if (state.lastToolCall)
		lines.push(row(`    last tool: ${formatToolCall(state.lastToolCall.name, state.lastToolCall.args)}`, width, theme));
	if (state.lastText) lines.push(row(`    last text: ${state.lastText}`, width, theme));
}

function summaryLine(state: SubagentState, selected: boolean, theme: Theme): string {
	const pointer = selected ? theme.fg("accent", "▸") : " ";
	const icon = iconFor(state.status, theme);
	const usage = formatUsageStats({ ...state.usage, turns: state.turns }, state.model);
	return `${pointer} ${icon} ${state.agent} #${state.agentId} ${state.status} · ${state.thinking} · ${usage}`;
}

function border(left: string, right: string, title: string, width: number, theme: Theme): string {
	const fill = Math.max(0, width - visibleWidth(left) - visibleWidth(right) - visibleWidth(title));
	return theme.fg("borderAccent", `${left}${title}${"─".repeat(fill)}${right}`);
}

function row(content: string, width: number, theme: Theme, color: "text" | "muted" | "dim" = "text"): string {
	const innerWidth = Math.max(0, width - 2);
	const trimmed = truncateToWidth(theme.fg(color, content), innerWidth, "…");
	const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(trimmed)));
	return `${theme.fg("borderMuted", "│")}${trimmed}${padding}${theme.fg("borderMuted", "│")}`;
}

function countByStatus(states: SubagentState[]) {
	let running = 0;
	let done = 0;
	let failed = 0;
	for (const state of states) {
		if (state.status === "running" || state.status === "starting") running++;
		else if (state.status === "done") done++;
		else failed++;
	}
	return { running, done, failed };
}

function iconFor(status: SubagentState["status"], theme: Theme): string {
	if (status === "running" || status === "starting") return theme.fg("warning", "⏳");
	if (status === "done") return theme.fg("success", "✓");
	return theme.fg("error", "✗");
}

function sortStates(states: SubagentState[]): SubagentState[] {
	return [...states].sort((a, b) => {
		const ra = a.status === "running" || a.status === "starting" ? 0 : 1;
		const rb = b.status === "running" || b.status === "starting" ? 0 : 1;
		if (ra !== rb) return ra - rb;
		return ra === 0 ? a.startedAt - b.startedAt : (b.finishedAt ?? 0) - (a.finishedAt ?? 0);
	});
}

function killSelected(state: SubagentState | undefined): void {
	if (!state || (state.status !== "running" && state.status !== "starting") || !state.pid) return;
	try {
		process.kill(state.pid, "SIGTERM");
	} catch {
		// ignore
	}
}
