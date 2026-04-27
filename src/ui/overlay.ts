// src/ui/overlay.ts
import path from "node:path";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { getRoot } from "../state/paths.js";
import type { SubagentState } from "../types.js";
import { mountStateWatcher } from "./state-watcher.js";
import { SubagentsPanel, isActiveSubagentState, renderSubagentsPanel } from "./subagents-panel.js";

export { renderSubagentsPanel };

const PANEL_WIDGET_KEY = "subagents-panel";

export function filterCurrentBatchActiveStates(states: SubagentState[], batchId: string | null): SubagentState[] {
	if (!batchId) return [];
	return states.filter((state) => state.batchId === batchId && isActiveSubagentState(state));
}

export async function openTreeOverlay(
	ctx: ExtensionCommandContext,
	agentDir: string,
	sessionId: string,
	batchId: string | null,
	onKill: (state: SubagentState) => void | Promise<void> = killSelected,
): Promise<void> {
	let watcherHandle: { stop: () => void } | null = null;
	let unsubscribeInput: (() => void) | null = null;
	let panel: SubagentsPanel | null = null;
	let closed = false;

	await new Promise<void>((resolve) => {
		const close = () => {
			if (closed) return;
			closed = true;
			watcherHandle?.stop();
			unsubscribeInput?.();
			ctx.ui.setWidget(PANEL_WIDGET_KEY, undefined);
			resolve();
		};

		ctx.ui.setWidget(
			PANEL_WIDGET_KEY,
			(tui, theme) => {
				panel = new SubagentsPanel({ theme, onClose: close, requestRender: () => tui.requestRender(), onKill });
				return panel;
			},
			{ placement: "belowEditor" },
		);

		unsubscribeInput = ctx.ui.onTerminalInput((data) => {
			if (!panel || closed) return undefined;
			return panel.handleInput(data) ? { consume: true } : undefined;
		});

		watcherHandle = mountStateWatcher({
			sessionDir: path.join(getRoot({ agentDir }), sessionId),
			onChange: (states) => panel?.setStates(filterCurrentBatchActiveStates(states, batchId)),
		});
	});
}

function killSelected(state: SubagentState | undefined): void {
	if (!state || !isActiveSubagentState(state) || !state.pid) return;
	try {
		process.kill(state.pid, "SIGTERM");
	} catch {
		// ignore
	}
}
