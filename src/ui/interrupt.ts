import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey } from "@mariozechner/pi-tui";
import type { DetachController } from "../runtime/detach.js";
import type { SubagentState } from "../types.js";

export interface InterruptController {
	update(states: SubagentState[]): void;
	stop(): void;
}

interface InterruptArgs {
	ctx: Pick<ExtensionContext, "ui">;
	getBatchId(): string | null;
	abortStates(states: SubagentState[], reason: string): void | Promise<void>;
	loadStates?(): SubagentState[] | Promise<SubagentState[]>;
	detach?: DetachController;
	doubleEscapeMs?: number;
	now?: () => number;
}

export function mountInterruptHandler(args: InterruptArgs): InterruptController {
	let latestStates: SubagentState[] = [];
	let lastEscapeAt: number | null = null;
	const doubleEscapeMs = args.doubleEscapeMs ?? 3000;
	const now = args.now ?? (() => Date.now());
	const unsubscribe = args.ctx.ui.onTerminalInput((data) => {
		if (matchesKey(data, Key.ctrl("b"))) {
			if (!args.detach?.hasActiveScopes()) return undefined;
			args.detach.detachAll();
			args.ctx.ui.notify?.("Sub-agents backgrounded — results will arrive via notification.", "info");
			return { consume: true };
		}
		if (matchesKey(data, Key.ctrl("c"))) {
			const targets = currentBatchActiveStates(latestStates, args.getBatchId());
			if (targets.length === 0) return undefined;
			lastEscapeAt = null;
			void abortFresh(args, "killed by Ctrl+C", latestStates);
			return { consume: true };
		}
		if (matchesKey(data, Key.escape)) {
			const targets = currentBatchActiveStates(latestStates, args.getBatchId());
			if (targets.length === 0) return undefined;
			const at = now();
			const isDoubleEscape = lastEscapeAt !== null && at - lastEscapeAt <= doubleEscapeMs;
			lastEscapeAt = isDoubleEscape ? null : at;
			if (isDoubleEscape) {
				void abortFresh(args, "killed by double Escape", latestStates);
			} else {
				args.ctx.ui.notify?.("Press Escape again within 3s to abort active sub-agents.", "warning");
			}
			return { consume: true };
		}
		return undefined;
	});

	return {
		update(states) {
			latestStates = states;
		},
		stop() {
			unsubscribe();
		},
	};
}

async function abortFresh(args: InterruptArgs, reason: string, fallbackStates: SubagentState[]): Promise<void> {
	let states: SubagentState[];
	try {
		const loaded = args.loadStates ? await args.loadStates() : fallbackStates;
		states = loaded.length > 0 ? loaded : fallbackStates;
	} catch {
		states = fallbackStates;
	}
	const targets = currentBatchActiveStates(states, args.getBatchId());
	if (targets.length > 0) await args.abortStates(targets, reason);
}

function currentBatchActiveStates(states: SubagentState[], batchId: string | null): SubagentState[] {
	const active = states.filter(isActiveState);
	if (!batchId) return active;
	return active.filter((state) => state.batchId === batchId);
}

function isActiveState(state: SubagentState): boolean {
	return state.status === "running" || state.status === "starting";
}
