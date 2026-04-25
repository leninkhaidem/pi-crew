// src/ui/render-result.ts
import { type Theme, getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import type { AgentToolResult, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { type UsageStatsLike, formatUsageStats } from "./format.js";

interface DispatchDetails {
	agentId?: string;
	usage?: UsageStatsLike;
}

export function renderDispatchResult(
	result: AgentToolResult<DispatchDetails>,
	options: ToolRenderResultOptions,
	theme: Theme,
) {
	const details = result.details ?? {};
	const first = result.content[0];
	const text = (first && "text" in first ? first.text : undefined) ?? "(no output)";
	if (!options.expanded) {
		return new Text(theme.fg("dim", text), 0, 0);
	}
	const md = getMarkdownTheme();
	const c = new Container();
	c.addChild(new Text(theme.fg("accent", `#${details.agentId ?? "?"}`), 0, 0));
	c.addChild(new Spacer(1));
	c.addChild(new Markdown(text.trim(), 0, 0, md));
	if (details.usage) {
		c.addChild(new Spacer(1));
		c.addChild(new Text(theme.fg("dim", formatUsageStats(details.usage)), 0, 0));
	}
	return c;
}
