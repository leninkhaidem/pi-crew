// src/ui/render-call.ts
import { Text } from "@mariozechner/pi-tui";

interface ThemeLike {
	fg: (color: string, text: string) => string;
	bold: (text: string) => string;
}

export function renderDispatchCall(args: { agent?: string; task?: string }, theme: ThemeLike) {
	const agent = args?.agent ?? "?";
	const task = args?.task ?? "?";
	const preview = task.length > 60 ? `${task.slice(0, 60)}…` : task;
	const text = `${theme.fg("toolTitle", theme.bold("subagent_dispatch ")) + theme.fg("accent", agent)}\n  ${theme.fg("dim", preview)}`;
	return new Text(text, 0, 0);
}

export function renderRunCall(
	args: { agent?: string; task?: string; tasks?: unknown[]; chain?: unknown[] },
	theme: ThemeLike,
) {
	if (Array.isArray(args?.chain)) {
		return new Text(theme.fg("toolTitle", `subagent_run chain (${args.chain.length} steps)`), 0, 0);
	}
	if (Array.isArray(args?.tasks)) {
		return new Text(theme.fg("toolTitle", `subagent_run parallel (${args.tasks.length} tasks)`), 0, 0);
	}
	return renderDispatchCall(args, theme);
}
