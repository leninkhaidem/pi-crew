import path from "node:path";
import type { SubagentPaths } from "../types.js";

export interface PathArgs {
	agentDir: string;
	sessionId: string | undefined;
	agentId: string;
}

export function getRoot(opts: { agentDir: string }): string {
	return path.join(opts.agentDir, "subagents");
}

export function resolveSessionId(sessionId: string | undefined): string {
	if (sessionId && sessionId.length > 0) return sessionId;
	return `ephemeral-${Date.now()}`;
}

export function computePaths(args: PathArgs): SubagentPaths {
	const sid = resolveSessionId(args.sessionId);
	const dir = path.join(args.agentDir, "subagents", sid, args.agentId);
	return {
		state: path.join(dir, "state.json"),
		output: path.join(dir, "output.jsonl"),
		stderr: path.join(dir, "stderr.log"),
		prompt: path.join(dir, "prompt.md"),
	};
}
