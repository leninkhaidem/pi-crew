// src/ui/overlay.ts
import path from "node:path";
import type { ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { getRoot } from "../state/paths.js";
import type { SubagentState } from "../types.js";
import { formatToolCall, formatUsageStats } from "./format.js";
import { mountStateWatcher } from "./state-watcher.js";

const PANEL_WIDGET_KEY = "subagents-panel";
const KEY_UP = "\x1b[A";
const KEY_DOWN = "\x1b[B";
const KEY_ENTER = "\r";
const KEY_ESC = "\x1b";
const KEY_D = "D";
const KEY_J = "j";
const KEY_K = "k";
const KEY_Y = "y";
const KEY_Y_UPPER = "Y";
const KEY_N = "n";
const KEY_N_UPPER = "N";
const KEY_CTRL_C = "\x03";
const MAX_PANEL_ITEMS = 5;

interface PanelRenderArgs {
	states: SubagentState[];
	selectedIdx: number;
	width: number;
	theme: Theme;
	scrollOffset?: number;
	detailedAgentId?: string | null;
	pendingKillAgentId?: string | null;
}

class SubagentsPanel implements Component {
	private states: SubagentState[] = [];
	private selectedIdx = 0;
	private scrollOffset = 0;
	private detailedAgentId: string | null = null;
	private pendingKillAgentId: string | null = null;

	constructor(
		private theme: Theme,
		private onClose: () => void,
		private requestRender: () => void,
		private onKill: (state: SubagentState) => void | Promise<void>,
	) {}

	setStates(s: SubagentState[]) {
		this.states = sortStates(s.filter(isActiveState));
		if (this.detailedAgentId && !this.states.some((state) => state.agentId === this.detailedAgentId)) {
			this.detailedAgentId = null;
		}
		if (this.pendingKillAgentId && !this.states.some((state) => state.agentId === this.pendingKillAgentId)) {
			this.pendingKillAgentId = null;
		}
		this.selectedIdx = this.states.length === 0 ? 0 : Math.min(Math.max(0, this.selectedIdx), this.states.length - 1);
		this.ensureSelectionVisible();
		this.requestRender();
	}

	handleInput(data: string): boolean {
		if (data === KEY_CTRL_C) return false;
		if (this.pendingKillAgentId) return this.handleKillConfirmation(data);
		if (this.states.length === 0) {
			if (data === KEY_ESC) this.onClose();
			return true;
		}
		if (data === KEY_UP || data === KEY_K) {
			this.moveSelection(-1);
			return true;
		}
		if (data === KEY_DOWN || data === KEY_J) {
			this.moveSelection(1);
			return true;
		}
		if (data === KEY_ENTER) {
			this.toggleDetailsSelected();
			return true;
		}
		if (data === KEY_D) {
			const state = this.states[this.selectedIdx];
			if (state && isActiveState(state)) {
				this.pendingKillAgentId = state.agentId;
				this.requestRender();
			}
			return true;
		}
		if (data === KEY_ESC) {
			this.onClose();
			return true;
		}
		return true;
	}

	render(width: number): string[] {
		return renderSubagentsPanel({
			states: this.states,
			selectedIdx: this.selectedIdx,
			width,
			theme: this.theme,
			scrollOffset: this.scrollOffset,
			detailedAgentId: this.detailedAgentId,
			pendingKillAgentId: this.pendingKillAgentId,
		});
	}

	invalidate(): void {
		// no cached state
	}

	private handleKillConfirmation(data: string): boolean {
		const agentId = this.pendingKillAgentId;
		if (!agentId) return true;
		if (data === KEY_Y || data === KEY_Y_UPPER) {
			const state = this.states.find((candidate) => candidate.agentId === agentId);
			this.pendingKillAgentId = null;
			if (state && isActiveState(state)) {
				if (this.detailedAgentId === state.agentId) this.detailedAgentId = null;
				void Promise.resolve(this.onKill(state)).finally(() => this.requestRender());
			}
			this.requestRender();
			return true;
		}
		if (data === KEY_N || data === KEY_N_UPPER || data === KEY_ESC) {
			this.pendingKillAgentId = null;
			this.requestRender();
			return true;
		}
		return true;
	}

	private moveSelection(delta: number): void {
		this.selectedIdx = Math.min(this.states.length - 1, Math.max(0, this.selectedIdx + delta));
		this.ensureSelectionVisible();
		if (this.detailedAgentId) this.showDetailsForSelected();
		this.requestRender();
	}

	private toggleDetailsSelected(): void {
		const cur = this.states[this.selectedIdx];
		if (!cur) return;
		this.detailedAgentId = this.detailedAgentId === cur.agentId ? null : cur.agentId;
		this.requestRender();
	}

	private showDetailsForSelected(): void {
		const cur = this.states[this.selectedIdx];
		if (!cur || this.detailedAgentId === cur.agentId) return;
		this.detailedAgentId = cur.agentId;
	}

	private ensureSelectionVisible(): void {
		if (this.selectedIdx < this.scrollOffset) this.scrollOffset = this.selectedIdx;
		const bottom = this.scrollOffset + MAX_PANEL_ITEMS - 1;
		if (this.selectedIdx > bottom) this.scrollOffset = this.selectedIdx - MAX_PANEL_ITEMS + 1;
		this.scrollOffset = Math.max(0, this.scrollOffset);
	}
}

export function renderSubagentsPanel(args: PanelRenderArgs): string[] {
	const panelArgs = { ...args, states: args.states.filter(isActiveState), width: Math.max(40, args.width) };
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

export function filterCurrentBatchActiveStates(states: SubagentState[], batchId: string | null): SubagentState[] {
	if (!batchId) return [];
	return states.filter((state) => state.batchId === batchId && isActiveState(state));
}

export async function openTreeOverlay(
	ctx: ExtensionCommandContext,
	agentDir: string,
	sessionId: string,
	batchId: string | null,
	onKill: (state: SubagentState) => void | Promise<void> = killSelected,
): Promise<void> {
	let watcherHandle: { stop: () => void } | null = null;
	let unsubscribeInput: (() => void) | null = null;
	let panel: SubagentsPanel | null = null;
	let closed = false;

	await new Promise<void>((resolve) => {
		const close = () => {
			if (closed) return;
			closed = true;
			watcherHandle?.stop();
			unsubscribeInput?.();
			ctx.ui.setWidget(PANEL_WIDGET_KEY, undefined);
			resolve();
		};

		ctx.ui.setWidget(
			PANEL_WIDGET_KEY,
			(tui, theme) => {
				panel = new SubagentsPanel(theme, close, () => tui.requestRender(), onKill);
				return panel;
			},
			{ placement: "belowEditor" },
		);

		unsubscribeInput = ctx.ui.onTerminalInput((data) => {
			if (!panel || closed) return undefined;
			return panel.handleInput(data) ? { consume: true } : undefined;
		});

		watcherHandle = mountStateWatcher({
			sessionDir: path.join(getRoot({ agentDir }), sessionId),
			onChange: (states) => panel?.setStates(filterCurrentBatchActiveStates(states, batchId)),
		});
	});
}

function helpLine(args: PanelRenderArgs): string {
	const pending = args.states.find((state) => state.agentId === args.pendingKillAgentId);
	if (pending) return row(` Kill ${pending.alias} #${pending.agentId}? y/N`, args.width, args.theme, "warning");
	const detailVerb = args.detailedAgentId ? "enter hide details" : "enter details";
	return row(` ↑↓/j/k select · ${detailVerb} · D kill · esc close`, args.width, args.theme, "dim");
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
	lines.push(row(detailLine(args.theme, "now", activityFor(state)), args.width, args.theme));
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
	lines.push(
		row(
			detailLine(
				args.theme,
				"usage",
				`${formatUsageStats({ ...state.usage, turns: state.turns })} · ${formatDuration(Date.now() - state.startedAt)}`,
			),
			args.width,
			args.theme,
		),
	);
}

function detailLine(theme: Theme, label: string, value: string): string {
	return ` ${theme.fg("dim", label.padEnd(5))} ${oneLine(value)}`;
}

function summaryLine(state: SubagentState, selected: boolean, detailed: boolean, theme: Theme): string {
	const pointer = selected ? theme.fg("accent", "▸") : " ";
	const detail = detailed ? theme.fg("accent", "◉") : " ";
	const icon = iconFor(state.status, theme);
	const elapsed = formatDuration(Date.now() - state.startedAt);
	return `${pointer}${detail} ${icon} ${state.alias} · ${state.agent} · ${state.status} · ${elapsed} · ${activityFor(state)}`;
}

function activityFor(state: SubagentState): string {
	if (state.activity) return state.activity;
	if (state.activeTools && state.activeTools.length > 0) return `using ${state.activeTools.join(", ")}`;
	if (state.lastToolCall) return `tool ${formatToolCall(state.lastToolCall.name, state.lastToolCall.args)}`;
	if (state.lastText) return state.lastText;
	return "thinking…";
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

function isActiveState(state: SubagentState): boolean {
	return state.status === "running" || state.status === "starting";
}

function iconFor(status: SubagentState["status"], theme: Theme): string {
	if (status === "starting") return theme.fg("warning", "◌");
	if (status === "running") return theme.fg("warning", "⏳");
	if (status === "done") return theme.fg("success", "✓");
	return theme.fg("error", "✗");
}

function sortStates(states: SubagentState[]): SubagentState[] {
	return [...states].sort((a, b) => {
		const ra = isActiveState(a) ? 0 : 1;
		const rb = isActiveState(b) ? 0 : 1;
		if (ra !== rb) return ra - rb;
		return ra === 0 ? a.startedAt - b.startedAt : (b.finishedAt ?? 0) - (a.finishedAt ?? 0);
	});
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

function killSelected(state: SubagentState | undefined): void {
	if (!state || !isActiveState(state) || !state.pid) return;
	try {
		process.kill(state.pid, "SIGTERM");
	} catch {
		// ignore
	}
}
