import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey } from "@mariozechner/pi-tui";
import type { DetachController } from "../runtime/detach.js";
import type { SubagentState } from "../types.js";
import { isSubagentsOverlayActive } from "./overlay.js";

export interface InterruptController {
	update(states: SubagentState[]): void;
	stop(): void;
}

interface InterruptArgs {
	ctx: Pick<ExtensionContext, "ui">;
	getBatchId(): string | null;
	abortStates(states: SubagentState[], reason: string): void | Promise<void>;
	loadStates?(): SubagentState[] | Promise<SubagentState[]>;
	hasActiveSubagentWork?(): boolean;
	detach?: DetachController;
	doubleEscapeMs?: number;
	now?: () => number;
}

type EscapeScope = "current-batch" | "current-session";

interface EscapeTargets {
	scope: EscapeScope;
	states: SubagentState[];
}

interface EscapeWarning {
	at: number;
	scope: EscapeScope;
}

export function mountInterruptHandler(args: InterruptArgs): InterruptController {
	let latestStates: SubagentState[] = [];
	let lastEscapeWarning: EscapeWarning | null = null;
	let stopped = false;
	const doubleEscapeMs = args.doubleEscapeMs ?? 3000;
	const now = args.now ?? (() => Date.now());
	let pendingEscapeRefresh: Promise<void> | null = null;
	const warnForTargets = (targets: EscapeTargets) => {
		lastEscapeWarning = { at: now(), scope: targets.scope };
		args.ctx.ui.notify?.(escapeWarningMessage(targets), "warning");
	};
	const refreshEmptySnapshot = (warnIfTargets: boolean) => {
		if (!args.loadStates || pendingEscapeRefresh) return;
		pendingEscapeRefresh = (async () => {
			try {
				const states = await args.loadStates?.();
				if (!states || stopped) return;
				latestStates = states;
				const targets = escapeTargets(states, args.getBatchId());
				if (targets && warnIfTargets) {
					warnForTargets(targets);
					return;
				}
				lastEscapeWarning = null;
			} catch {
				// Failed refreshes are retried/consumed on later Escapes when active work is known.
			}
		})().finally(() => {
			pendingEscapeRefresh = null;
		});
	};
	const unsubscribe = args.ctx.ui.onTerminalInput((data) => {
		if (matchesKey(data, Key.ctrl("b"))) {
			if (!args.detach?.hasActiveScopes()) return undefined;
			args.detach.detachAll();
			args.ctx.ui.notify?.("Sub-agents backgrounded — results will arrive via notification.", "info");
			return { consume: true };
		}
		if (matchesKey(data, Key.ctrl("c"))) {
			const batchId = args.getBatchId();
			const targets = currentBatchActiveStates(latestStates, batchId);
			if (targets.length === 0) return undefined;
			lastEscapeWarning = null;
			const scope = batchId ? "current-batch" : "current-session";
			void abortFresh(args, "killed by Ctrl+C", latestStates, scope, batchId);
			return { consume: true };
		}
		if (matchesKey(data, Key.escape)) {
			if (isSubagentsOverlayActive()) {
				lastEscapeWarning = null;
				return undefined;
			}
			const at = now();
			const previousWarning = lastEscapeWarning;
			const isDoubleEscape = previousWarning !== null && at - previousWarning.at <= doubleEscapeMs;
			if (isDoubleEscape) {
				lastEscapeWarning = null;
				void abortFresh(args, "killed by double Escape", latestStates, previousWarning.scope);
				return { consume: true };
			}
			const targets = escapeTargets(latestStates, args.getBatchId());
			if (targets) {
				warnForTargets(targets);
				return { consume: true };
			}
			if (args.loadStates) {
				const protectActiveWork = args.hasActiveSubagentWork?.() === true;
				if (pendingEscapeRefresh) return protectActiveWork ? { consume: true } : undefined;
				refreshEmptySnapshot(protectActiveWork);
				return protectActiveWork ? { consume: true } : undefined;
			}
			return undefined;
		}
		return undefined;
	});

	return {
		update(states) {
			latestStates = states;
		},
		stop() {
			stopped = true;
			unsubscribe();
		},
	};
}

async function abortFresh(
	args: InterruptArgs,
	reason: string,
	fallbackStates: SubagentState[],
	warnedScope: EscapeScope,
	batchId?: string | null,
): Promise<void> {
	let states: SubagentState[];
	try {
		states = args.loadStates ? await args.loadStates() : fallbackStates;
	} catch {
		states = fallbackStates;
	}
	const targetBatchId = batchId === undefined ? args.getBatchId() : batchId;
	const batchTargets = strictCurrentBatchActiveStates(states, targetBatchId);
	const targets = batchTargets.length > 0 ? batchTargets : warnedScope === "current-session" ? activeStates(states) : [];
	if (targets.length > 0) await args.abortStates(targets, reason);
}

function escapeTargets(states: SubagentState[], batchId: string | null): EscapeTargets | null {
	const batchTargets = strictCurrentBatchActiveStates(states, batchId);
	if (batchTargets.length > 0) return { scope: "current-batch", states: batchTargets };
	const sessionTargets = activeStates(states);
	if (sessionTargets.length === 0) return null;
	return { scope: "current-session", states: sessionTargets };
}

function escapeWarningMessage(targets: EscapeTargets): string {
	const count = targets.states.length;
	const noun = count === 1 ? "sub-agent" : "sub-agents";
	const scope = targets.scope === "current-batch" ? "current batch" : "this session";
	return `Press Escape again within 3s to abort ${count} active ${noun} in ${scope}.`;
}

function currentBatchActiveStates(states: SubagentState[], batchId: string | null): SubagentState[] {
	const active = activeStates(states);
	if (!batchId) return active;
	return active.filter((state) => state.batchId === batchId);
}

function strictCurrentBatchActiveStates(states: SubagentState[], batchId: string | null): SubagentState[] {
	if (!batchId) return [];
	return activeStates(states).filter((state) => state.batchId === batchId);
}

function activeStates(states: SubagentState[]): SubagentState[] {
	return states.filter(isActiveState);
}

function isActiveState(state: SubagentState): boolean {
	return state.status === "running" || state.status === "starting";
}
