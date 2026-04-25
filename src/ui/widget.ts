// src/ui/widget.ts
import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { type Component, type OverlayHandle, type TUI, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { SubagentState } from "../types.js";
import { formatToolCall, formatUsageStats } from "./format.js";

const MAX_ROWS = 4;

export interface WidgetController {
	update(states: SubagentState[]): void;
	stop(): void;
}

interface ActivePanelArgs {
	states: SubagentState[];
	width: number;
	theme: Theme;
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

	constructor(
		private tui: TUI,
		theme: Theme,
		states: SubagentState[],
	) {
		this.panel = new ActiveAgentsPanel(theme, states);
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
		this.handle.hide();
	}
}

class ActiveAgentsPanel implements Component {
	constructor(
		private theme: Theme,
		private states: SubagentState[],
	) {}

	update(states: SubagentState[]): void {
		this.states = states;
	}

	render(width: number): string[] {
		return renderActiveAgentsPanel({ states: this.states, width, theme: this.theme });
	}

	invalidate(): void {
		// no cached state
	}
}

export function renderActiveAgentsPanel(args: ActivePanelArgs): string[] {
	const width = Math.max(40, args.width);
	const visible = args.states.slice(0, MAX_ROWS);
	const overflow = args.states.length - visible.length;
	const lines = [border("╭", "╮", ` ✻ pi-crew active agents · ${args.states.length} `, width, args.theme)];
	lines.push(row(" Live delegation panel. Your editor stays focused.", width, args.theme, "dim"));
	lines.push(row(" Open /subagents for transcripts, kill controls, and history.", width, args.theme, "dim"));
	lines.push(border("├", "┤", "", width, args.theme));
	for (const state of visible) appendAgent(lines, state, width, args.theme);
	if (overflow > 0)
		lines.push(row(` … ${overflow} more active sub-agent${overflow === 1 ? "" : "s"}`, width, args.theme, "muted"));
	lines.push(border("╰", "╯", "", width, args.theme));
	return lines;
}

function appendAgent(lines: string[], state: SubagentState, width: number, theme: Theme): void {
	const statusIcon = state.status === "starting" ? theme.fg("warning", "◌") : theme.fg("success", "●");
	const title = `${statusIcon} ${state.agent} #${state.agentId} ${state.status} · thinking ${state.thinking}`;
	lines.push(row(` ${title}`, width, theme));
	lines.push(row(`   task  ${state.task}`, width, theme, "muted"));
	const usage = formatUsageStats({ ...state.usage, turns: state.turns }, state.model);
	lines.push(row(`   ${usage} · cwd ${shorten(state.cwd)} · ${state.branch ?? "no branch"}`, width, theme, "dim"));
	const last = lastActivity(state);
	if (last) lines.push(row(`   ${last}`, width, theme, "dim"));
}

function lastActivity(state: SubagentState): string | null {
	if (state.lastToolCall) return `tool ${formatToolCall(state.lastToolCall.name, state.lastToolCall.args)}`;
	if (state.lastText) return `last ${state.lastText}`;
	return null;
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
		})),
	);
}

function shorten(p: string): string {
	if (p.length > 32) return `…${p.slice(-30)}`;
	return p;
}
