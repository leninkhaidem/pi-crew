// src/ui/widget.ts
import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { type Component, type TUI, truncateToWidth } from "@mariozechner/pi-tui";
import type { SubagentState } from "../types.js";
import { formatToolCall, formatUsageStats } from "./format.js";

const MAX_WIDGET_LINES = 12;
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
	let component: ActiveAgentsWidget | null = null;
	let tuiRef: TUI | null = null;
	let latestActive: SubagentState[] = [];
	let registered = false;
	let frame = 0;
	let timer: NodeJS.Timeout | null = null;

	const ensureTimer = () => {
		if (timer) return;
		timer = setInterval(() => {
			frame++;
			component?.setFrame(frame);
			tuiRef?.requestRender();
		}, 80);
	};

	const clearTimer = () => {
		if (!timer) return;
		clearInterval(timer);
		timer = null;
	};

	const show = () => {
		registered = true;
		ctx.ui.setWidget(
			"agents",
			(tui, theme) => {
				tuiRef = tui;
				component = new ActiveAgentsWidget(tui, theme, latestActive, frame);
				return component;
			},
			{ placement: "aboveEditor" },
		);
		ensureTimer();
	};

	const hide = () => {
		clearTimer();
		component?.dispose?.();
		component = null;
		tuiRef = null;
		lastSignature = null;
		registered = false;
		ctx.ui.setWidget("agents", undefined);
	};

	return {
		update(states) {
			const active = sortActive(states.filter((s) => s.status === "running" || s.status === "starting"));
			if (active.length === 0) {
				if (registered) hide();
				return;
			}

			latestActive = active;
			const signature = signatureFor(active);
			if (!registered) {
				lastSignature = signature;
				show();
				return;
			}
			if (signature === lastSignature) return;
			lastSignature = signature;
			component?.update(active);
			tuiRef?.requestRender();
		},
		stop: hide,
	};
}

class ActiveAgentsWidget implements Component {
	constructor(
		private tui: TUI,
		private theme: Theme,
		private states: SubagentState[],
		private frame: number,
	) {}

	update(states: SubagentState[]): void {
		this.states = states;
	}

	setFrame(frame: number): void {
		this.frame = frame;
	}

	render(width?: number): string[] {
		return renderActiveAgentsPanel({
			states: this.states,
			width: width ?? this.tui.terminal.columns,
			theme: this.theme,
			frame: this.frame,
		});
	}

	invalidate(): void {
		// no cached state
	}

	dispose(): void {
		// no resources owned by this component
	}
}

export function renderActiveAgentsPanel(args: ActivePanelArgs): string[] {
	const width = Math.max(1, args.width);
	const visibleStates = args.states.slice(0, Math.floor((MAX_WIDGET_LINES - 2) / 2));
	const overflow = args.states.length - visibleStates.length;
	const heading = `${args.theme.fg("accent", "●")} ${args.theme.fg("accent", "Agents")}`;
	const lines = [truncateToWidth(heading, width)];

	visibleStates.forEach((state, index) => {
		const isLast = index === visibleStates.length - 1 && overflow <= 0;
		appendAgent(lines, state, width, args.theme, args.frame ?? 0, isLast);
	});
	if (overflow > 0) {
		lines.push(
			truncateToWidth(`${args.theme.fg("dim", "└─")} ${args.theme.fg("dim", `+${overflow} more running`)}`, width),
		);
	}
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
	const stem = isLast ? "   " : "│  ";
	const spinner = state.status === "starting" ? "◌" : (SPINNER[frame % SPINNER.length] ?? "⠋");
	const stats = compactStats(state);
	const task = oneLine(state.task);
	const activity = oneLine(activityFor(state));
	lines.push(
		truncateToWidth(
			`${theme.fg("dim", connector)} ${theme.fg("accent", spinner)} ${theme.bold(state.agent)}  ${theme.fg("muted", task)} ${theme.fg("dim", "·")} ${theme.fg("dim", stats)}`,
			width,
		),
	);
	lines.push(truncateToWidth(`${theme.fg("dim", stem)}  ${theme.fg("dim", `⎿  ${activity}`)}`, width));
}

function compactStats(state: SubagentState): string {
	const parts = [formatTurns(state.turns, state.maxTurns)];
	const toolUses = state.toolUses ?? 0;
	if (toolUses > 0) parts.push(`${toolUses} tool use${toolUses === 1 ? "" : "s"}`);
	const usage = formatUsageStats(state.usage);
	if (usage) parts.push(usage);
	parts.push(formatDuration(Date.now() - state.startedAt));
	return parts.join(" · ");
}

function activityFor(state: SubagentState): string {
	if (state.activity) return state.activity;
	if (state.activeTools && state.activeTools.length > 0) return `using ${state.activeTools.join(", ")}`;
	if (state.lastToolCall) return `tool ${formatToolCall(state.lastToolCall.name, state.lastToolCall.args)}`;
	if (state.lastText) return state.lastText;
	return "thinking…";
}

function oneLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
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
			model: state.model,
			turns: state.turns,
			usage: state.usage,
			lastText: state.lastText,
			lastToolCall: state.lastToolCall,
			activeTools: state.activeTools,
			toolUses: state.toolUses,
			activity: state.activity,
		})),
	);
}
