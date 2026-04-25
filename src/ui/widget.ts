// src/ui/widget.ts
import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { type Component, type OverlayHandle, type TUI, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { SubagentState } from "../types.js";
import { formatToolCall, formatUsageStats } from "./format.js";

const MAX_ROWS = 4;
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface WidgetController {
	update(states: SubagentState[]): void;
	stop(): void;
}

interface ActivePanelArgs {
	states: SubagentState[];
	width: number;
	theme: Theme;
	frame?: number;
}

export function mountWidget(ctx: ExtensionContext): WidgetController {
	let lastSignature: string | null = null;
	let host: ActiveAgentsOverlayHost | null = null;
	let latestActive: SubagentState[] = [];
	let visible = false;

	const show = () => {
		visible = true;
		ctx.ui.setWidget("pi-crew", (tui, theme) => {
			host = new ActiveAgentsOverlayHost(tui, theme, latestActive);
			return host;
		});
	};

	const hide = () => {
		host?.dispose();
		host = null;
		lastSignature = null;
		visible = false;
		ctx.ui.setWidget("pi-crew", undefined);
	};

	return {
		update(states) {
			const active = sortActive(states.filter((s) => s.status === "running" || s.status === "starting"));
			if (active.length === 0) {
				if (visible) hide();
				return;
			}

			const signature = signatureFor(active);
			if (signature === lastSignature) return;
			lastSignature = signature;
			latestActive = active;
			if (host) host.update(active);
			else show();
		},
		stop: hide,
	};
}

class ActiveAgentsOverlayHost implements Component {
	private panel: ActiveAgentsPanel;
	private handle: OverlayHandle;
	private timer: NodeJS.Timeout;

	constructor(
		private tui: TUI,
		theme: Theme,
		states: SubagentState[],
	) {
		this.panel = new ActiveAgentsPanel(theme, states);
		this.timer = setInterval(() => {
			this.panel.tick();
			this.tui.requestRender();
		}, 80);
		this.handle = tui.showOverlay(this.panel, {
			nonCapturing: true,
			anchor: "top-right",
			width: "42%",
			minWidth: 56,
			maxHeight: "55%",
			margin: { top: 2, right: 2 },
		});
	}

	update(states: SubagentState[]): void {
		this.panel.update(states);
		this.tui.requestRender();
	}

	render(): string[] {
		return [];
	}

	invalidate(): void {
		this.panel.invalidate();
	}

	dispose(): void {
		clearInterval(this.timer);
		this.handle.hide();
	}
}

class ActiveAgentsPanel implements Component {
	constructor(
		private theme: Theme,
		private states: SubagentState[],
	) {}

	private frame = 0;

	update(states: SubagentState[]): void {
		this.states = states;
	}

	tick(): void {
		this.frame++;
	}

	render(width: number): string[] {
		return renderActiveAgentsPanel({ states: this.states, width, theme: this.theme, frame: this.frame });
	}

	invalidate(): void {
		// no cached state
	}
}

export function renderActiveAgentsPanel(args: ActivePanelArgs): string[] {
	const width = Math.max(40, args.width);
	const visible = args.states.slice(0, MAX_ROWS);
	const overflow = args.states.length - visible.length;
	const lines = [border("╭", "╮", ` ✻ pi-crew agents · ${args.states.length} active `, width, args.theme)];
	lines.push(
		row(" Claude-Code-style live tracker. Open /subagents for transcripts and controls.", width, args.theme, "dim"),
	);
	lines.push(border("├", "┤", "", width, args.theme));
	visible.forEach((state, index) =>
		appendAgent(lines, state, width, args.theme, args.frame ?? 0, index === visible.length - 1 && overflow <= 0),
	);
	if (overflow > 0)
		lines.push(row(` … ${overflow} more active sub-agent${overflow === 1 ? "" : "s"}`, width, args.theme, "muted"));
	lines.push(border("╰", "╯", "", width, args.theme));
	return lines;
}

function appendAgent(
	lines: string[],
	state: SubagentState,
	width: number,
	theme: Theme,
	frame: number,
	isLast: boolean,
): void {
	const connector = isLast ? "└─" : "├─";
	const stem = isLast ? "  " : "│ ";
	const spinner = state.status === "starting" ? "◌" : (SPINNER[frame % SPINNER.length] ?? "⠋");
	const title = `${theme.fg("accent", spinner)} ${theme.bold(state.agent)} #${state.agentId}  ${state.task}`;
	lines.push(row(` ${connector} ${title}`, width, theme));
	const stats = compactStats(state);
	lines.push(row(` ${stem}   ${stats}`, width, theme, "dim"));
	lines.push(row(` ${stem}   ⎿  ${activityFor(state)}`, width, theme, "dim"));
}

function compactStats(state: SubagentState): string {
	const parts = [state.model, state.thinking, formatTurns(state.turns, state.maxTurns)];
	const toolUses = state.toolUses ?? 0;
	if (toolUses > 0) parts.push(`${toolUses} tool use${toolUses === 1 ? "" : "s"}`);
	const usage = formatUsageStats(state.usage);
	if (usage) parts.push(usage);
	parts.push(formatDuration(Date.now() - state.startedAt));
	if (state.executionMode) parts.push(state.executionMode);
	return parts.join(" · ");
}

function activityFor(state: SubagentState): string {
	if (state.activity) return state.activity;
	if (state.activeTools && state.activeTools.length > 0) return `using ${state.activeTools.join(", ")}`;
	if (state.lastToolCall) return `tool ${formatToolCall(state.lastToolCall.name, state.lastToolCall.args)}`;
	if (state.lastText) return state.lastText;
	return "thinking…";
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

function border(left: string, right: string, title: string, width: number, theme: Theme): string {
	const fill = Math.max(0, width - visibleWidth(left) - visibleWidth(right) - visibleWidth(title));
	return theme.fg("borderAccent", `${left}${title}${"─".repeat(fill)}${right}`);
}

function row(content: string, width: number, theme: Theme, color: "text" | "muted" | "dim" = "text"): string {
	const innerWidth = Math.max(0, width - 2);
	const styled = theme.fg(color, content);
	const trimmed = truncateToWidth(styled, innerWidth, "…");
	const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(trimmed)));
	return `${theme.fg("borderMuted", "│")}${trimmed}${padding}${theme.fg("borderMuted", "│")}`;
}

function sortActive(states: SubagentState[]): SubagentState[] {
	return [...states].sort((a, b) => a.startedAt - b.startedAt);
}

function signatureFor(states: SubagentState[]): string {
	return JSON.stringify(
		states.map((state) => ({
			agentId: state.agentId,
			agent: state.agent,
			status: state.status,
			task: state.task,
			cwd: state.cwd,
			branch: state.branch,
			model: state.model,
			thinking: state.thinking,
			turns: state.turns,
			usage: state.usage,
			lastText: state.lastText,
			lastToolCall: state.lastToolCall,
			activeTools: state.activeTools,
			toolUses: state.toolUses,
			activity: state.activity,
			executionMode: state.executionMode,
		})),
	);
}

function shorten(p: string): string {
	if (p.length > 32) return `…${p.slice(-30)}`;
	return p;
}
