import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { TranscriptExcerpt } from "../runtime/transcript.js";
import type { SubagentState } from "../types.js";
import { formatStateActivity } from "./activity.js";
import { formatUsageStats } from "./format.js";

const MAX_PANEL_ITEMS = 5;
const MAX_TRANSCRIPT_LINES = 15;
const SPLIT_LAYOUT_MIN_WIDTH = 88;
const LEFT_PANE_MIN_WIDTH = 30;
const LEFT_PANE_MAX_WIDTH = 38;
const RIGHT_PANE_MIN_WIDTH = 34;
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
	currentBatchId?: string | null;
	maxHeight?: number;
}

export function renderSubagentsPanel(args: PanelRenderArgs): string[] {
	const panelArgs = {
		...args,
		states: args.states.filter(isActiveSubagentState),
		width: Math.max(1, Math.floor(args.width)),
	};
	const selected = selectedState(panelArgs);
	const expanded = panelArgs.states.find((state) => state.agentId === panelArgs.detailedAgentId);
	const mode = panelMode(panelArgs, expanded);
	const lines = [border("╭", "╮", " pi-crew sub-agents ", panelArgs.width, panelArgs.theme)];

	lines.push(row(headerLine(panelArgs, expanded), panelArgs.width, panelArgs.theme));
	lines.push(helpLine(panelArgs, mode, expanded ?? selected));

	if (panelArgs.states.length === 0) {
		lines.push(border("├", "┤", "", panelArgs.width, panelArgs.theme));
		lines.push(row(" No active sub-agents in this session.", panelArgs.width, panelArgs.theme, "muted"));
		lines.push(border("╰", "╯", "", panelArgs.width, panelArgs.theme));
	} else if (expanded) {
		lines.push(border("├", "┤", " details ", panelArgs.width, panelArgs.theme));
		appendDetailRows(lines, panelArgs, expanded);
		lines.push(border("╰", "╯", "", panelArgs.width, panelArgs.theme));
	} else if (mode === "split" && selected) {
		appendSplitDashboard(lines, panelArgs, selected);
	} else {
		lines.push(border("├", "┤", " agents ", panelArgs.width, panelArgs.theme));
		appendStateRows(lines, panelArgs);
		lines.push(border("╰", "╯", "", panelArgs.width, panelArgs.theme));
	}

	if (args.maxHeight && lines.length > args.maxHeight) {
		lines.length = args.maxHeight;
		lines[lines.length - 1] =
			mode === "split" && !expanded
				? splitBottomBorder(panelArgs)
				: border("╰", "╯", "", panelArgs.width, panelArgs.theme);
	}
	return lines;
}

function panelMode(args: PanelRenderArgs, expanded: SubagentState | undefined): "expanded" | "split" | "narrow-list" {
	if (expanded) return "expanded";
	if (args.states.length > 0 && canRenderSplit(args.width)) return "split";
	return "narrow-list";
}

function canRenderSplit(width: number): boolean {
	if (width < SPLIT_LAYOUT_MIN_WIDTH) return false;
	const innerWidth = Math.max(0, width - 2);
	return innerWidth - LEFT_PANE_MIN_WIDTH - 1 >= RIGHT_PANE_MIN_WIDTH;
}

function selectedState(args: PanelRenderArgs): SubagentState | undefined {
	if (args.states.length === 0) return undefined;
	const idx = Math.min(Math.max(0, args.selectedIdx), args.states.length - 1);
	return args.states[idx];
}

function headerLine(args: PanelRenderArgs, expanded: SubagentState | undefined): string {
	if (args.states.length === 0) return " 0 active";
	const summary = `${args.states.length} active · current session`;
	if (!expanded) return ` ${summary}`;
	return ` ${summary} · ${oneLine(expanded.alias)} #${oneLine(expanded.agentId)}`;
}

function helpLine(
	args: PanelRenderArgs,
	mode: "expanded" | "split" | "narrow-list",
	selected: SubagentState | undefined,
): string {
	const pending = args.states.find((state) => state.agentId === args.pendingKillAgentId);
	if (pending)
		return row(` Kill ${oneLine(pending.alias)} #${oneLine(pending.agentId)}? y/N`, args.width, args.theme, "warning");
	const killHelp = args.canKill === false || !selected ? "" : " · d kill";
	if (args.states.length === 0) return row(" esc close", args.width, args.theme, "dim");
	if (mode === "expanded") return row(` ←/esc back${killHelp}`, args.width, args.theme, "dim");
	if (mode === "split") return row(` ↑↓/j/k select · enter/→ expand · ←/esc close${killHelp}`, args.width, args.theme, "dim");
	return row(` ↑↓/j/k select · enter/→ details · ←/esc close${killHelp}`, args.width, args.theme, "dim");
}

function appendSplitDashboard(lines: string[], args: PanelRenderArgs, selected: SubagentState): void {
	const widths = splitWidths(args.width);
	lines.push(splitDivider("agents", "details", args, widths));
	const leftRows = buildAgentListRows(args, widths.left);
	const rightRows = buildSelectedDetailRows(args, selected, widths.right);
	const rowCount = Math.max(leftRows.length, rightRows.length, 1);
	for (let idx = 0; idx < rowCount; idx++) {
		lines.push(splitRow(leftRows[idx] ?? "", rightRows[idx] ?? "", widths, args.theme));
	}
	lines.push(splitBottomBorder(args));
}

interface SplitWidths {
	left: number;
	right: number;
}

function splitWidths(width: number): SplitWidths {
	const innerWidth = Math.max(0, width - 2);
	const left = Math.max(
		LEFT_PANE_MIN_WIDTH,
		Math.min(LEFT_PANE_MAX_WIDTH, Math.floor(innerWidth * 0.36), innerWidth - RIGHT_PANE_MIN_WIDTH - 1),
	);
	const right = Math.max(0, innerWidth - left - 1);
	return { left, right };
}

function splitDivider(leftTitle: string, rightTitle: string, args: PanelRenderArgs, widths: SplitWidths): string {
	const line = `├${titledRule(leftTitle, widths.left)}┬${titledRule(rightTitle, widths.right)}┤`;
	return args.theme.fg("borderAccent", truncateToWidth(line, args.width, ""));
}

function splitBottomBorder(args: PanelRenderArgs): string {
	const widths = splitWidths(args.width);
	const line = `╰${"─".repeat(widths.left)}┴${"─".repeat(widths.right)}╯`;
	return args.theme.fg("borderAccent", truncateToWidth(line, args.width, ""));
}

function titledRule(title: string, width: number): string {
	if (width <= 0) return "";
	const label = ` ${title} `;
	if (visibleWidth(label) >= width) return truncateToWidth(label, width, "");
	return `${label}${"─".repeat(width - visibleWidth(label))}`;
}

function splitRow(left: string, right: string, widths: SplitWidths, theme: Theme): string {
	const border = theme.fg("borderMuted", "│");
	return `${border}${cell(left, widths.left)}${border}${cell(right, widths.right)}${border}`;
}

function cell(content: string, width: number): string {
	if (width <= 0) return "";
	const singleLine = content.replace(/[\r\n]+/g, " ").replace(/\t/g, "  ");
	const trimmed = truncateToWidth(singleLine, width, "…");
	return `${trimmed}${" ".repeat(Math.max(0, width - visibleWidth(trimmed)))}`;
}

function buildAgentListRows(args: PanelRenderArgs, width: number): string[] {
	const rows: string[] = [];
	const offset = args.scrollOffset ?? 0;
	const visible = args.states.slice(offset, offset + MAX_PANEL_ITEMS);
	for (const [idx, state] of visible.entries()) {
		const absoluteIdx = offset + idx;
		const selected = absoluteIdx === args.selectedIdx;
		rows.push(compactAgentTitle(state, selected, args.theme));
		rows.push(compactAgentMeta(state, args.theme));
		const scope = scopeLabel(state, args.currentBatchId ?? null);
		if (scope) rows.push(args.theme.fg("muted", `  ${scope}`));
		rows.push(args.theme.fg("dim", `  ${oneLine(formatStateActivity(state))}`));
		if (idx < visible.length - 1) rows.push("");
	}
	const hiddenBefore = offset;
	const hiddenAfter = Math.max(0, args.states.length - offset - visible.length);
	if (hiddenBefore > 0 || hiddenAfter > 0) {
		if (rows.length > 0) rows.push("");
		rows.push(args.theme.fg("dim", `… ${hiddenBefore} above, ${hiddenAfter} below`));
	}
	return rows.map((line) => truncateToWidth(line, width, "…"));
}

function compactAgentTitle(state: SubagentState, selected: boolean, theme: Theme): string {
	const pointer = selected ? theme.fg("accent", "▸") : " ";
	return `${pointer} ${iconFor(state.status, theme)} ${theme.fg(selected ? "accent" : "text", oneLine(state.alias))}`;
}

function compactAgentMeta(state: SubagentState, theme: Theme): string {
	const elapsed = formatDuration(Date.now() - state.startedAt);
	return theme.fg("muted", `  ${oneLine(state.agent)} · ${elapsed}`);
}

function buildSelectedDetailRows(args: PanelRenderArgs, state: SubagentState, width: number): string[] {
	const rows: string[] = [];
	rows.push(`${args.theme.fg("accent", oneLine(state.alias))} ${args.theme.fg("dim", `#${oneLine(state.agentId)}`)}`);
	rows.push(detailCellLine(args.theme, "status", state.status));
	rows.push(detailCellLine(args.theme, "alias", state.alias));
	rows.push(
		detailCellLine(
			args.theme,
			"model",
			`${oneLine(state.agent)} · ${oneLine(state.provider)}/${oneLine(state.model)} · ${oneLine(state.thinking)}`,
		),
	);
	rows.push(detailCellLine(args.theme, "cwd", state.cwd));
	rows.push(detailCellLine(args.theme, "elapsed", formatDuration(Date.now() - state.startedAt)));
	rows.push(detailCellLine(args.theme, "usage", formatUsageStats({ ...state.usage, turns: state.turns }) || "no usage yet"));
	rows.push("");
	rows.push(sectionCellTitle(args.theme, "task", width));
	rows.push(...wrapText(state.task, Math.max(10, width)).map((line) => `  ${line}`));
	rows.push("");
	rows.push(sectionCellTitle(args.theme, "recent transcript", width));
	rows.push(...transcriptChunks(args.transcript, Math.max(10, width - 2)).map((line) => `  ${line}`));
	return rows.map((line) => truncateToWidth(line, width, "…"));
}

function sectionCellTitle(theme: Theme, title: string, width: number): string {
	const label = `─ ${title} `;
	if (visibleWidth(label) >= width) return theme.fg("borderAccent", truncateToWidth(label, width, ""));
	return theme.fg("borderAccent", `${label}${"─".repeat(width - visibleWidth(label))}`);
}

function detailCellLine(theme: Theme, label: string, value: string): string {
	return `${theme.fg("dim", label.padEnd(7))} ${oneLine(value)}`;
}

function appendStateRows(lines: string[], args: PanelRenderArgs): void {
	const offset = args.scrollOffset ?? 0;
	const visible = args.states.slice(offset, offset + MAX_PANEL_ITEMS);
	for (const [idx, state] of visible.entries()) {
		const absoluteIdx = offset + idx;
		const selected = absoluteIdx === args.selectedIdx;
		lines.push(row(summaryLine(state, selected, args.theme, args.currentBatchId ?? null), args.width, args.theme));
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
	lines.push(border("├", "┤", " recent transcript ", args.width, args.theme));
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
	const innerWidth = Math.max(10, args.width - 12);
	const textLines = value.replace(/\r\n/g, "\n").split("\n");
	let first = true;
	for (const textLine of textLines) {
		const chunks = wrapText(textLine || " ", innerWidth);
		for (const chunk of chunks) {
			lines.push(row(detailLine(args.theme, first ? label : "", chunk), args.width, args.theme));
			first = false;
		}
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
		const eventLines = event.split("\n");
		for (const eventLine of eventLines) {
			for (const line of wrapText(eventLine || " ", width)) {
				if (out.length >= MAX_TRANSCRIPT_LINES) return out;
				out.push(line);
			}
		}
	}
	return out.length > 0 ? out : ["No recent transcript events."];
}

function detailLine(theme: Theme, label: string, value: string): string {
	return ` ${theme.fg("dim", label.padEnd(7))} ${oneLine(value)}`;
}

function summaryLine(state: SubagentState, selected: boolean, theme: Theme, currentBatchId: string | null): string {
	const pointer = selected ? theme.fg("accent", "▸") : " ";
	const icon = iconFor(state.status, theme);
	const elapsed = formatDuration(Date.now() - state.startedAt);
	const scope = scopeLabel(state, currentBatchId);
	const scopePart = scope ? ` · ${scope}` : "";
	return `${pointer} ${icon} ${oneLine(state.alias)} · ${oneLine(state.agent)} · ${oneLine(state.status)} · ${elapsed}${scopePart} · ${oneLine(formatStateActivity(state))}`;
}

function wrapText(value: string, width: number): string[] {
	const cleaned = stripUnsafeControls(value).replace(/\s+/g, " ").trim();
	if (!cleaned) return ["—"];
	const words = cleaned.split(" ").filter(Boolean);
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
	if (width <= 0) return "";
	const fill = Math.max(0, width - visibleWidth(left) - visibleWidth(right) - visibleWidth(title));
	const line = `${left}${title}${"─".repeat(fill)}${right}`;
	return theme.fg("borderAccent", truncateToWidth(line, width, ""));
}

function row(
	content: string,
	width: number,
	theme: Theme,
	color: "text" | "muted" | "dim" | "warning" = "text",
): string {
	if (width <= 0) return "";
	if (width === 1) return theme.fg("borderMuted", "│");
	const innerWidth = Math.max(0, width - 2);
	const singleLine = content.replace(/\s+/g, " ").trim();
	const trimmed = truncateToWidth(theme.fg(color, singleLine), innerWidth, "…");
	const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(trimmed)));
	return `${theme.fg("borderMuted", "│")}${trimmed}${padding}${theme.fg("borderMuted", "│")}`;
}

export function isActiveSubagentState(state: SubagentState): boolean {
	return state.status === "running" || state.status === "starting";
}

function scopeLabel(state: SubagentState, currentBatchId: string | null): string | null {
	if (currentBatchId && state.batchId !== currentBatchId) return state.batchId ? "older batch" : "unbatched";
	if (!currentBatchId && !state.batchId) return "unbatched";
	return null;
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
