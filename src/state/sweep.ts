import fs from "node:fs/promises";
import path from "node:path";
import type { SubagentState } from "../types.js";
import { getRoot } from "./paths.js";
import { readState, writeState } from "./store.js";

export interface SweepArgs {
	agentDir: string;
	retentionDays: number;
}

export interface SweepReport {
	scanned: number;
	swept: number;
	orphans: number;
	errors: number;
}

const TERMINAL = new Set<SubagentState["status"]>(["done", "failed", "aborted", "orphaned", "detached"]);

export async function sweep(args: SweepArgs): Promise<SweepReport> {
	const root = getRoot({ agentDir: args.agentDir });
	const report: SweepReport = { scanned: 0, swept: 0, orphans: 0, errors: 0 };

	let sessions: string[];
	try {
		sessions = await fs.readdir(root);
	} catch (err) {
		const e = err as NodeJS.ErrnoException;
		if (e.code === "ENOENT") return report;
		throw err;
	}

	const cutoff = Date.now() - args.retentionDays * 86400_000;

	for (const sess of sessions) {
		const sessDir = path.join(root, sess);
		let agents: string[];
		try {
			agents = await fs.readdir(sessDir);
		} catch {
			continue;
		}
		for (const a of agents) {
			report.scanned++;
			const stateFile = path.join(sessDir, a, "state.json");
			let state: SubagentState | null;
			try {
				state = await readState(stateFile);
			} catch {
				report.errors++;
				continue;
			}
			if (!state) continue;

			if ((state.status === "running" || state.status === "detached") && shouldMarkOrphaned(state)) {
				const next: SubagentState = {
					...state,
					status: "orphaned",
					errorMessage: "subprocess died without writing exit; pid no longer exists",
					finishedAt: state.finishedAt ?? Date.now(),
					lastUpdate: Date.now(),
				};
				try {
					await writeState(next);
					report.orphans++;
					state = next;
				} catch {
					report.errors++;
				}
			}

			if (TERMINAL.has(state.status) && state.finishedAt && state.finishedAt < cutoff) {
				try {
					await fs.rm(path.join(sessDir, a), { recursive: true, force: true });
					report.swept++;
				} catch {
					report.errors++;
				}
			}
		}
		try {
			const remaining = await fs.readdir(sessDir);
			if (remaining.length === 0) await fs.rmdir(sessDir);
		} catch {
			// ignore
		}
	}

	return report;
}

function shouldMarkOrphaned(state: SubagentState): boolean {
	if (state.executionMode === "session") return false;
	if (state.pid === null) return false;
	return !pidAlive(state.pid);
}

function pidAlive(pid: number | null): boolean {
	if (!pid) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		const e = err as NodeJS.ErrnoException;
		return e.code === "EPERM";
	}
}
