import type { SubagentState } from "./types.js";

export interface SummaryPreview {
	text: string;
	truncated: boolean;
	omitted: number;
}

export interface ParentSummaryOptions {
	maxChars?: number;
	maxLines?: number;
	format?: "text" | "xml";
	full?: boolean;
}

const DEFAULT_MAX_CHARS = 600;
const DEFAULT_MAX_LINES = 12;

export function buildSummaryPreview(state: SubagentState, options: ParentSummaryOptions = {}): SummaryPreview {
	const source = state.finalOutput?.trim() || state.lastText?.trim() || fallbackText(state);
	if (options.full) return fullText(source);
	return compactText(source, {
		maxChars: options.maxChars ?? DEFAULT_MAX_CHARS,
		maxLines: options.maxLines ?? DEFAULT_MAX_LINES,
	});
}

export function formatParentSummary(state: SubagentState, options: ParentSummaryOptions = {}): string {
	return options.format === "xml" ? formatXmlSummary(state, options) : formatTextSummary(state, options);
}

function formatTextSummary(state: SubagentState, options: ParentSummaryOptions): string {
	const summary = buildSummaryPreview(state, options);
	const lines = [
		`[${state.agent} #${state.agentId}] ${state.status}${reasonSuffix(state)}`,
		`Summary: ${summary.text}`,
	];
	if (summary.truncated) lines.push(`Summary truncated (${summary.omitted} chars omitted). Use Trace for full output.`);
	lines.push(`Trace: ${state.paths.output}`);
	lines.push(`State: ${state.paths.state}`);
	return lines.join("\n");
}

function formatXmlSummary(state: SubagentState, options: ParentSummaryOptions): string {
	const summary = buildSummaryPreview(state, options);
	const lines = [
		"<subagent-result>",
		`<agent-id>${escapeXml(state.agentId)}</agent-id>`,
		`<agent>${escapeXml(state.agent)}</agent>`,
		`<status>${escapeXml(state.status)}</status>`,
		`<summary>${escapeXml(summary.text)}</summary>`,
	];
	if (summary.truncated) lines.push(`<truncated omitted-chars="${summary.omitted}">true</truncated>`);
	if (state.errorMessage) lines.push(`<error>${escapeXml(state.errorMessage)}</error>`);
	lines.push(`<usage turns="${state.turns}" cost="${state.usage.cost.toFixed(4)}" />`);
	lines.push(`<trace-file>${escapeXml(state.paths.output)}</trace-file>`);
	lines.push(`<state-file>${escapeXml(state.paths.state)}</state-file>`);
	lines.push("</subagent-result>");
	return lines.join("\n");
}

function fullText(text: string): SummaryPreview {
	return { text: normalizeText(text), truncated: false, omitted: 0 };
}

function compactText(text: string, opts: { maxChars: number; maxLines: number }): SummaryPreview {
	const normalized = normalizeText(text);
	const lines = normalized.split("\n");
	let clipped = lines.slice(0, opts.maxLines).join("\n");
	let truncated = lines.length > opts.maxLines;
	if (clipped.length > opts.maxChars) {
		clipped = clipped.slice(0, opts.maxChars).trimEnd();
		truncated = true;
	}
	const omitted = truncated ? Math.max(0, normalized.length - clipped.length) : 0;
	return { text: truncated ? `${clipped}…` : clipped, truncated, omitted };
}

function normalizeText(text: string): string {
	return text.replace(/\r\n/g, "\n").trim() || "(no output)";
}

function fallbackText(state: SubagentState): string {
	if (state.errorMessage) return state.errorMessage;
	if (state.exitCode !== null) return `exit ${state.exitCode}`;
	return "(no output)";
}

function reasonSuffix(state: SubagentState): string {
	if (state.status === "done") return "";
	const reason = state.errorMessage ?? (state.exitCode !== null ? `exit ${state.exitCode}` : null);
	return reason ? ` — ${reason}` : "";
}

function escapeXml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
