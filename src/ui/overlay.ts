// src/ui/overlay.ts
import path from "node:path";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { abortSubagentByStatePath } from "../runtime/kill.js";
import { getRoot } from "../state/paths.js";
import { listStates } from "../state/store.js";
import type { SubagentState } from "../types.js";
import { mountStateWatcher } from "./state-watcher.js";
import { SubagentsPanel, isActiveSubagentState, renderSubagentsPanel } from "./subagents-panel.js";

export { renderSubagentsPanel };

export const NO_ACTIVE_SUBAGENTS_MESSAGE = "No active sub-agents in this session.";

let activeOverlayCount = 0;

export function isSubagentsOverlayActive(): boolean {
	return activeOverlayCount > 0;
}

function markOverlayActive(): () => void {
	activeOverlayCount++;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		activeOverlayCount = Math.max(0, activeOverlayCount - 1);
	};
}

export function filterCurrentBatchActiveStates(states: SubagentState[], batchId: string | null): SubagentState[] {
	if (!batchId) return [];
	return states.filter((state) => state.batchId === batchId && isActiveSubagentState(state));
}

export function filterSessionActiveStates(states: SubagentState[], currentBatchId: string | null): SubagentState[] {
	return sortSessionActiveStates(states.filter(isActiveSubagentState), currentBatchId);
}

export function sortSessionActiveStates(states: SubagentState[], currentBatchId: string | null): SubagentState[] {
	return [...states].sort((a, b) => {
		const aRank = currentBatchId && a.batchId === currentBatchId ? 0 : 1;
		const bRank = currentBatchId && b.batchId === currentBatchId ? 0 : 1;
		if (aRank !== bRank) return aRank - bRank;
		if (a.startedAt !== b.startedAt) return a.startedAt - b.startedAt;
		return a.agentId.localeCompare(b.agentId);
	});
}

export async function openSubagentsOverlay(
	ctx: ExtensionCommandContext,
	agentDir: string,
	sessionId: string,
	batchId: string | null,
	onKill: (state: SubagentState) => void | Promise<void> = killSelected,
): Promise<void> {
	const sessionDir = path.join(getRoot({ agentDir }), sessionId);
	const initialStates = filterSessionActiveStates(await listStates(sessionDir, { includeDetached: true }), batchId);
	if (initialStates.length === 0) {
		ctx.ui.notify(NO_ACTIVE_SUBAGENTS_MESSAGE, "info");
		return;
	}

	const refs: { watcherHandle?: { stop: () => void }; panel?: SubagentsPanel } = {};
	const releaseOverlayActive = markOverlayActive();

	try {
		await ctx.ui.custom<void>(
			(tui, theme, _keybindings, done) => {
				let closed = false;
				const close = () => {
					if (closed) return;
					closed = true;
					done(undefined);
				};

				const panel = new SubagentsPanel({
					theme,
					onClose: close,
					requestRender: () => tui.requestRender(),
					onKill,
					canKill: Boolean(onKill),
					currentBatchId: batchId,
				});
				refs.panel = panel;
				panel.setStates(initialStates);

				refs.watcherHandle = mountStateWatcher({
					sessionDir,
					onChange: (states) => refs.panel?.setStates(filterSessionActiveStates(states, batchId)),
				});

				return panel;
			},
			{
				overlay: true,
				overlayOptions: { anchor: "center", width: "80%", minWidth: 50, maxHeight: "80%" },
			},
		);
	} finally {
		refs.watcherHandle?.stop();
		refs.watcherHandle = undefined;
		refs.panel?.dispose?.();
		refs.panel = undefined;
		releaseOverlayActive();
	}
}

export async function openTreeOverlay(
	ctx: ExtensionCommandContext,
	agentDir: string,
	sessionId: string,
	batchId: string | null,
	onKill: (state: SubagentState) => void | Promise<void> = killSelected,
): Promise<void> {
	return openSubagentsOverlay(ctx, agentDir, sessionId, batchId, onKill);
}

export async function killSelected(state: SubagentState | undefined): Promise<void> {
	if (!state || !isActiveSubagentState(state)) return;
	const result = await abortSubagentByStatePath(state.paths.state, "killed from /subagents panel");
	if (result.ok || !state.pid) return;
	try {
		process.kill(state.pid, "SIGTERM");
	} catch {
		// ignore
	}
}
