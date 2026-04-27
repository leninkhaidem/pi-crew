import type { SubagentState } from "../types.js";
import { formatToolCall } from "./format.js";

const TOOL_ACTION: Record<string, string> = {
	read: "reading",
	bash: "running command",
	edit: "editing",
	write: "writing",
	grep: "searching",
	find: "finding files",
	ls: "listing files",
};

const GENERIC_ACTIVITIES = new Set([
	"",
	"thinking…",
	"thinking...",
	"starting…",
	"starting...",
	"finalizing…",
	"finalizing...",
	"done",
	"failed",
	"aborted",
	"running",
]);

export function formatStateActivity(state: SubagentState): string {
	const activeTool = activeToolActivityFor(state);
	if (activeTool) return activeTool;
	const lastTool = state.lastToolCall ? formatToolActivity(state.lastToolCall.name, state.lastToolCall.args) : null;
	if (state.activity && !isGenericActivity(state.activity, state.lastToolCall?.name)) return state.activity;
	if (lastTool) return lastTool;
	if (state.lastText) return state.lastText;
	return state.activity || "thinking…";
}

function activeToolActivityFor(state: SubagentState): string | null {
	if (!state.activeTools || state.activeTools.length === 0) return null;
	if (state.lastToolCall && state.activeTools.includes(state.lastToolCall.name)) {
		return formatToolActivity(state.lastToolCall.name, state.lastToolCall.args);
	}
	return `using ${state.activeTools.join(", ")}`;
}

function formatToolActivity(name: string, args: Record<string, unknown>): string {
	const rendered = formatToolCall(name, args);
	switch (name) {
		case "read":
			return `reading ${rendered.replace(/^read\s+/, "")}`;
		case "edit":
			return `editing ${rendered.replace(/^edit\s+/, "")}`;
		case "write":
			return `writing ${rendered.replace(/^write\s+/, "")}`;
		case "bash":
			return `running ${rendered.replace(/^\$\s+/, "")}`;
		case "grep":
			return `searching ${rendered.replace(/^grep\s+/, "")}`;
		case "find":
			return `finding ${rendered.replace(/^find\s+/, "")}`;
		case "ls":
			return `listing ${rendered.replace(/^ls\s+/, "")}`;
		default:
			return `using ${rendered}`;
	}
}

function isGenericActivity(activity: string, lastToolName?: string): boolean {
	const normalized = activity.replace(/\s+/g, " ").trim();
	if (GENERIC_ACTIVITIES.has(normalized)) return true;
	if (!lastToolName) return false;
	return normalized === TOOL_ACTION[lastToolName];
}
