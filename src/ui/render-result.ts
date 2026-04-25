// src/ui/render-result.ts
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { type UsageStatsLike, formatUsageStats } from "./format.js";

interface ThemeLike {
	fg: (color: string, text: string) => string;
	bold: (text: string) => string;
}

interface DispatchDetails {
	agentId?: string;
	usage?: UsageStatsLike;
}

interface ToolResultLike {
	content?: Array<{ type: string; text?: string }>;
	details?: DispatchDetails;
}

interface RenderOptions {
	expanded: boolean;
}

export function renderDispatchResult(result: ToolResultLike, options: RenderOptions, theme: ThemeLike) {
	const details = result.details ?? {};
	const text = result.content?.[0]?.text ?? "(no output)";
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
