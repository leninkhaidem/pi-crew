// src/ui/render-result.ts
import { type Theme, getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import type { AgentToolResult, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { formatThinkingAdjustment } from "../thinking.js";
import type { ThinkingAdjustment } from "../types.js";
import { type UsageStatsLike, formatUsageStats } from "./format.js";

interface DispatchDetails {
	agentId?: string;
	alias?: string;
	agent?: string;
	status?: string;
	provider?: string;
	model?: string;
	thinking?: string;
	thinkingAdjustment?: ThinkingAdjustment;
	turns?: number;
	usage?: UsageStatsLike;
	finalOutput?: string | null;
	errorMessage?: string | null;
}

interface BatchDetails {
	results: DispatchDetails[];
	backgrounded?: DispatchDetails[];
	abandoned?: string[];
	errors?: string[];
	partial?: boolean;
}

type ResultDetails = DispatchDetails | BatchDetails;

export function renderDispatchResult(
	result: AgentToolResult<ResultDetails>,
	options: ToolRenderResultOptions,
	theme: Theme,
) {
	const details = result.details ?? {};
	const first = result.content[0];
	const text = (first && "text" in first ? first.text : undefined) ?? "(no output)";
	if (!options.expanded) {
		return new Text(
			isBatchDetails(details)
				? formatCompactBatchResult(details, text, theme)
				: formatCompactResult(details, text, theme),
			0,
			0,
		);
	}
	const md = getMarkdownTheme();
	const c = new Container();
	const scalarDetails = isBatchDetails(details) ? {} : details;
	c.addChild(
		new Text(theme.fg("accent", `${scalarDetails.alias ?? "subagent"} #${scalarDetails.agentId ?? "?"}`), 0, 0),
	);
	c.addChild(new Spacer(1));
	c.addChild(new Markdown(text.trim(), 0, 0, md));
	const warning = formatThinkingAdjustment(scalarDetails.thinkingAdjustment);
	if (warning && !text.includes(warning)) {
		c.addChild(new Spacer(1));
		c.addChild(new Text(theme.fg("warning", warning), 0, 0));
	}
	if (scalarDetails.usage) {
		c.addChild(new Spacer(1));
		c.addChild(new Text(theme.fg("dim", formatUsageStats(scalarDetails.usage)), 0, 0));
	}
	return c;
}

function isBatchDetails(details: ResultDetails): details is BatchDetails {
	return "results" in details && Array.isArray(details.results);
}

function formatCompactBatchResult(details: BatchDetails, fallbackText: string, theme: Theme): string {
	const items = [...details.results, ...(details.backgrounded ?? [])];
	const lines = items.map((item) => formatCompactResult(item, fallbackText, theme));
	for (const alias of details.abandoned ?? []) {
		lines.push(`${theme.fg("warning", "○")} ${theme.bold(alias)} abandoned`);
	}
	for (const error of details.errors ?? []) lines.push(theme.fg("warning", `! ${firstLine(error)}`));
	return lines.length > 0 ? lines.join("\n") : theme.fg("dim", firstLine(fallbackText));
}

function formatCompactResult(details: DispatchDetails, fallbackText: string, theme: Theme): string {
	if (!details.agentId && !details.alias) return theme.fg("dim", firstLine(fallbackText));
	const ok =
		!details.status || details.status === "done" || details.status === "running" || details.status === "starting";
	const icon =
		details.status === "done"
			? theme.fg("success", "✓")
			: details.status
				? theme.fg("warning", "●")
				: theme.fg("dim", "●");
	const alias = details.alias ?? "subagent";
	const agent = details.agent ? ` (${details.agent})` : "";
	const status = details.status ? ` ${details.status}` : "";
	const model = details.model ? `${details.provider ? `${details.provider}/` : ""}${details.model}` : null;
	const stats = compactStats(details, model);
	const lines = [`${icon} ${theme.bold(`${alias} #${details.agentId ?? "?"}`)}${theme.fg("dim", agent)}${status}`];
	if (stats) lines.push(theme.fg("dim", `  ${stats}`));
	const warning = formatThinkingAdjustment(details.thinkingAdjustment);
	if (warning) lines.push(theme.fg("warning", `  ${warning}`));
	if (!ok && details.errorMessage) lines.push(theme.fg("warning", `  ${firstLine(details.errorMessage)}`));
	return lines.join("\n");
}

function compactStats(details: DispatchDetails, model: string | null): string {
	const parts: string[] = [];
	if (model) parts.push(model);
	if (details.thinking) parts.push(details.thinking);
	if (typeof details.turns === "number") parts.push(`${details.turns} turn${details.turns === 1 ? "" : "s"}`);
	if (details.usage?.cost) parts.push(`$${details.usage.cost.toFixed(4)}`);
	return parts.join(" · ");
}

function firstLine(text: string): string {
	const line = text.trim().split("\n")[0] ?? "";
	return line.length <= 160 ? line : `${line.slice(0, 157)}…`;
}
