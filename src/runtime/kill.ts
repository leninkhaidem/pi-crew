import path from "node:path";
import { getRoot } from "../state/paths.js";
import { readState, writeState } from "../state/store.js";
import type { SubagentState } from "../types.js";

const SIGKILL_DELAY_MS = 5000;
const KILLABLE = new Set<SubagentState["status"]>(["starting", "running", "detached"]);

export type AbortSubagentResult =
	| {
			ok: true;
			agentId: string;
			killed: boolean;
			state: SubagentState;
			alreadyTerminal: boolean;
	  }
	| { ok: false; error: "not_found" | "state_unreadable"; agentId?: string };

export async function findSubagentStatePath(agentDir: string, agentId: string): Promise<string | null> {
	const root = getRoot({ agentDir });
	const fs = await import("node:fs/promises");
	const sessions = await fs.readdir(root).catch(() => [] as string[]);
	for (const session of sessions) {
		const subagents = await fs.readdir(path.join(root, session)).catch(() => [] as string[]);
		if (subagents.includes(agentId)) return path.join(root, session, agentId, "state.json");
	}
	return null;
}

export async function abortSubagentById(
	agentDir: string,
	agentId: string,
	reason = "killed by user",
): Promise<AbortSubagentResult> {
	const statePath = await findSubagentStatePath(agentDir, agentId);
	if (!statePath) return { ok: false, error: "not_found", agentId };
	return abortSubagentByStatePath(statePath, reason);
}

export async function abortSubagentByStatePath(
	statePath: string,
	reason = "killed by user",
): Promise<AbortSubagentResult> {
	const state = await readState(statePath);
	if (!state) return { ok: false, error: "state_unreadable" };

	if (!KILLABLE.has(state.status)) {
		return { ok: true, agentId: state.agentId, killed: false, state, alreadyTerminal: true };
	}

	const next: SubagentState = {
		...state,
		status: "aborted",
		exitCode: -1,
		errorMessage: reason,
		finishedAt: Date.now(),
		lastUpdate: Date.now(),
	};
	await writeState(next);

	let killed = false;
	if (state.pid) {
		try {
			process.kill(state.pid, "SIGTERM");
			killed = true;
		} catch {
			// already dead
		}
		if (killed) {
			setTimeout(() => {
				try {
					process.kill(state.pid as number, "SIGKILL");
				} catch {
					// ignore
				}
			}, SIGKILL_DELAY_MS);
		}
	}

	return { ok: true, agentId: state.agentId, killed, state: next, alreadyTerminal: false };
}
