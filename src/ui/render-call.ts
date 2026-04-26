// src/ui/render-call.ts
import type { Theme } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

export function renderDispatchCall(
	args: { agent?: string; alias?: string; model?: string; provider?: string },
	theme: Theme,
) {
	const agent = args?.agent ?? "?";
	const alias = args?.alias ?? "?";
	const model = args?.model ? `${args.provider ? `${args.provider}/` : ""}${args.model}` : "model pending";
	const text = `${theme.fg("toolTitle", theme.bold("subagent_dispatch "))}${theme.fg("accent", alias)} ${theme.fg("dim", `(${agent}, ${model})`)}`;
	return new Text(text, 0, 0);
}

export function renderRunCall(
	args: { agent?: string; alias?: string; task?: string; tasks?: unknown[]; chain?: unknown[] },
	theme: Theme,
) {
	if (Array.isArray(args?.chain)) {
		return new Text(theme.fg("toolTitle", `subagent_run chain (${args.chain.length} steps)`), 0, 0);
	}
	if (Array.isArray(args?.tasks)) {
		return new Text(theme.fg("toolTitle", `subagent_run parallel (${args.tasks.length} tasks)`), 0, 0);
	}
	return renderDispatchCall(args, theme);
}
