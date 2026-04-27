import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { TranscriptExcerpt } from "../runtime/transcript.js";
import type { SubagentState } from "../types.js";
import { formatStateActivity } from "./activity.js";
import { formatUsageStats } from "./format.js";

const MAX_PANEL_ITEMS = 5;
const MAX_TRANSCRIPT_LINES = 15;
const ESC = "\\u001B";
const BEL = "\\u0007";
const ANSI_OR_OSC_PATTERN = new RegExp(
	`${ESC}(?:\\][\\s\\S]*?(?:${BEL}|${ESC}\\\\)|[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])`,
	"g",
);

export interface PanelRenderArgs {
	states: SubagentState[];
	selectedIdx: number;
	width: number;
	theme: Theme;
	scrollOffset?: number;
	detailedAgentId?: string | null;
	pendingKillAgentId?: string | null;
	transcript?: TranscriptExcerpt | "loading";
	canKill?: boolean;
	maxHeight?: number;
}

export function renderSubagentsPanel(args: PanelRenderArgs): string[] {
	const panelArgs = { ...args, states: args.states.filter(isActiveSubagentState), width: Math.max(40, args.width) };
	const lines = [border("╭", "╮", " pi-crew sub-agents ", panelArgs.width, panelArgs.theme)];
	const detailed = panelArgs.states.find((state) => state.agentId === panelArgs.detailedAgentId);
	lines.push(row(headerLine(panelArgs, detailed), panelArgs.width, panelArgs.theme));
	lines.push(helpLine(panelArgs, Boolean(detailed)));
	lines.push(border("├", "┤", "", panelArgs.width, panelArgs.theme));
	if (panelArgs.states.length === 0) {
		lines.push(row(" No running sub-agents in current batch.", panelArgs.width, panelArgs.theme, "muted"));
	} else if (detailed) {
		appendDetailRows(lines, panelArgs, detailed);
	} else {
		appendStateRows(lines, panelArgs);
	}
	lines.push(border("╰", "╯", "", panelArgs.width, panelArgs.theme));
	if (args.maxHeight && lines.length > args.maxHeight) {
		lines.length = args.maxHeight;
		lines[lines.length - 1] = border("╰", "╯", "", panelArgs.width, panelArgs.theme);
	}
	return lines;
}

function headerLine(args: PanelRenderArgs, detailed: SubagentState | undefined): string {
	if (!detailed) return ` ${args.states.length} active`;
	return ` ${args.states.length} active · ${oneLine(detailed.alias)} #${oneLine(detailed.agentId)}`;
}

function helpLine(args: PanelRenderArgs, isDetail: boolean): string {
	const pending = args.states.find((state) => state.agentId === args.pendingKillAgentId);
	if (pending)
		return row(` Kill ${oneLine(pending.alias)} #${oneLine(pending.agentId)}? y/N`, args.width, args.theme, "warning");
	const killHelp = args.canKill === false ? "" : " · d kill";
	if (isDetail) return row(` ←/esc list${killHelp}`, args.width, args.theme, "dim");
	return row(` ↑↓/j/k select · enter/→ details · ←/esc close${killHelp}`, args.width, args.theme, "dim");
}

function appendStateRows(lines: string[], args: PanelRenderArgs): void {
	const offset = args.scrollOffset ?? 0;
	const visible = args.states.slice(offset, offset + MAX_PANEL_ITEMS);
	for (const [idx, state] of visible.entries()) {
		const absoluteIdx = offset + idx;
		const selected = absoluteIdx === args.selectedIdx;
		lines.push(row(summaryLine(state, selected, args.theme), args.width, args.theme));
	}
	const hiddenBefore = offset;
	const hiddenAfter = Math.max(0, args.states.length - offset - visible.length);
	if (hiddenBefore > 0 || hiddenAfter > 0) {
		lines.push(row(` … ${hiddenBefore} above, ${hiddenAfter} below`, args.width, args.theme, "dim"));
	}
}

function appendDetailRows(lines: string[], args: PanelRenderArgs, state: SubagentState): void {
	appendMetadataRows(lines, args, state);
	lines.push(border("├", "┤", " task ", args.width, args.theme));
	appendWrappedDetail(lines, args, "task", state.task);
	lines.push(border("├", "┤", " transcript ", args.width, args.theme));
	appendTranscriptRows(lines, args);
}

function appendMetadataRows(lines: string[], args: PanelRenderArgs, state: SubagentState): void {
	lines.push(row(detailLine(args.theme, "status", state.status), args.width, args.theme));
	lines.push(row(detailLine(args.theme, "alias", state.alias), args.width, args.theme));
	lines.push(
		row(
			detailLine(
				args.theme,
				"model",
				`${oneLine(state.agent)} · ${oneLine(state.provider)}/${oneLine(state.model)} · ${oneLine(state.thinking)}`,
			),
			args.width,
			args.theme,
		),
	);
	lines.push(row(detailLine(args.theme, "cwd", state.cwd), args.width, args.theme));
	lines.push(
		row(detailLine(args.theme, "elapsed", formatDuration(Date.now() - state.startedAt)), args.width, args.theme),
	);
	lines.push(
		row(
			detailLine(args.theme, "usage", formatUsageStats({ ...state.usage, turns: state.turns }) || "no usage yet"),
			args.width,
			args.theme,
		),
	);
}

function appendWrappedDetail(lines: string[], args: PanelRenderArgs, label: string, value: string): void {
	const chunks = wrapText(value, Math.max(10, args.width - 12));
	for (const [idx, chunk] of chunks.entries()) {
		lines.push(row(detailLine(args.theme, idx === 0 ? label : "", chunk), args.width, args.theme));
	}
}

function appendTranscriptRows(lines: string[], args: PanelRenderArgs): void {
	const chunks = transcriptChunks(args.transcript, Math.max(10, args.width - 6));
	for (const chunk of chunks) lines.push(row(` ${chunk}`, args.width, args.theme));
}

function transcriptChunks(excerpt: TranscriptExcerpt | "loading" | undefined, width: number): string[] {
	if (!excerpt || excerpt === "loading") return ["Loading recent transcript…"];
	if (excerpt.kind !== "events") return [excerpt.message];
	const out: string[] = [];
	for (const event of excerpt.events) {
		for (const line of wrapText(`• ${event}`, width)) {
			if (out.length >= MAX_TRANSCRIPT_LINES) return out;
			out.push(line);
		}
	}
	return out.length > 0 ? out : ["No recent transcript events."];
}

function detailLine(theme: Theme, label: string, value: string): string {
	return ` ${theme.fg("dim", label.padEnd(7))} ${oneLine(value)}`;
}

function summaryLine(state: SubagentState, selected: boolean, theme: Theme): string {
	const pointer = selected ? theme.fg("accent", "▸") : " ";
	const icon = iconFor(state.status, theme);
	const elapsed = formatDuration(Date.now() - state.startedAt);
	return `${pointer} ${icon} ${oneLine(state.alias)} · ${oneLine(state.agent)} · ${oneLine(state.status)} · ${elapsed} · ${oneLine(formatStateActivity(state))}`;
}

function wrapText(value: string, width: number): string[] {
	const words = oneLine(value).split(" ").filter(Boolean);
	if (words.length === 0) return ["—"];
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		if (visibleWidth(word) > width) {
			if (current) lines.push(current);
			lines.push(truncateToWidth(word, width, "…"));
			current = "";
		} else if (!current || visibleWidth(`${current} ${word}`) <= width) {
			current = current ? `${current} ${word}` : word;
		} else {
			lines.push(current);
			current = word;
		}
	}
	if (current) lines.push(current);
	return lines;
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
	return stripUnsafeControls(value).replace(/\s+/g, " ").trim();
}

function stripUnsafeControls(value: string): string {
	let out = "";
	for (const ch of value.replace(ANSI_OR_OSC_PATTERN, "")) {
		const code = ch.charCodeAt(0);
		if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || (code >= 127 && code <= 159)) continue;
		out += ch;
	}
	return out;
}
