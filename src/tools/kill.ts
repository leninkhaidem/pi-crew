import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { EV } from "../notify/events.js";
import type { ExtensionRuntime } from "../runtime/types.js";
import { getRoot } from "../state/paths.js";
import { readState, writeState } from "../state/store.js";

const SIGKILL_DELAY_MS = 5000;

export function registerKillTool(pi: ExtensionAPI, rt: ExtensionRuntime): void {
	pi.registerTool({
		name: "subagent_kill",
		label: "Subagent kill",
		description: "Abort a running sub-agent (SIGTERM, then SIGKILL after 5s). Args: { agentId, reason? }",
		parameters: Type.Object({
			agentId: Type.String(),
			reason: Type.Optional(Type.String()),
		}),
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const root = getRoot({ agentDir: rt.agentDir });
			const fs = await import("node:fs/promises");
			const sessions = await fs.readdir(root).catch(() => [] as string[]);
			let statePath: string | null = null;
			for (const s of sessions) {
				const sub = await fs.readdir(path.join(root, s)).catch(() => [] as string[]);
				if (sub.includes(params.agentId)) {
					statePath = path.join(root, s, params.agentId, "state.json");
					break;
				}
			}
			if (!statePath) {
				return {
					content: [{ type: "text" as const, text: `No sub-agent #${params.agentId} found.` }],
					details: { error: "not_found" },
				};
			}
			const state = await readState(statePath);
			if (!state) {
				return {
					content: [{ type: "text" as const, text: "State unreadable." }],
					details: { error: "state_unreadable" },
				};
			}
			let killed = false;
			if (state.pid && state.status === "running") {
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
			const next = {
				...state,
				status: "aborted" as const,
				exitCode: -1,
				errorMessage: params.reason ?? "killed by user",
				finishedAt: Date.now(),
				lastUpdate: Date.now(),
			};
			await writeState(next);
			pi.events.emit(EV.killed, {
				agentId: params.agentId,
				reason: params.reason,
				killed,
			});
			return {
				content: [{ type: "text" as const, text: `Killed #${params.agentId}: ${params.reason ?? ""}` }],
				details: { agentId: params.agentId, killed },
			};
		},
	});
}
