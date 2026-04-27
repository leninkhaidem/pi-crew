// src/ui/footer.ts
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { type TUI, Key, matchesKey } from "@mariozechner/pi-tui";
import type { SubagentState } from "../types.js";
import { SubagentsPanel, isActiveSubagentState } from "./subagents-panel.js";

const STATUS_KEY = "pi-crew";
const PANEL_WIDGET_KEY = "pi-crew-footer-details";

export interface FooterController {
	update(states: SubagentState[]): void;
	stop(): void;
}

interface FooterArgs {
	onKill?: (state: SubagentState) => void | Promise<void>;
}

type FooterUi = ExtensionContext["ui"] &
	Partial<Pick<ExtensionContext["ui"], "getEditorText" | "onTerminalInput" | "setWidget">>;

export function mountFooter(ctx: ExtensionContext, args: FooterArgs = {}): FooterController {
	const ui = ctx.ui as FooterUi;
	let activeStates: SubagentState[] = [];
	let focused = false;
	let panelOpen = false;
	let panel: SubagentsPanel | null = null;

	const renderStatus = () => {
		if (activeStates.length === 0) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		const marker = focused ? "▸ " : "";
		ctx.ui.setStatus(STATUS_KEY, `${marker}⟳ ${activeStates.length} running`);
	};

	const closePanel = () => {
		if (!panelOpen) return;
		panelOpen = false;
		panel = null;
		focused = false;
		ui.setWidget?.(PANEL_WIDGET_KEY, undefined);
		renderStatus();
	};

	const canUseFooterNavigation = () => activeStates.length > 0 && (ui.getEditorText?.() ?? "") === "";

	const openPanel = () => {
		if (!canUseFooterNavigation() || !ui.setWidget) return false;
		panelOpen = true;
		focused = false;
		ui.setWidget(
			PANEL_WIDGET_KEY,
			(tui: TUI, theme) => {
				panel = new SubagentsPanel({
					theme,
					onClose: closePanel,
					requestRender: () => tui.requestRender(),
					onKill: args.onKill,
					canKill: Boolean(args.onKill),
				});
				panel.setStates(activeStates);
				return panel;
			},
			{ placement: "belowEditor" },
		);
		renderStatus();
		return true;
	};

	const clearFocus = () => {
		if (!focused) return;
		focused = false;
		renderStatus();
	};

	const unsubscribeInput = ui.onTerminalInput?.((data) => {
		if (panelOpen && panel) return panel.handleInput(data) ? { consume: true } : undefined;
		if (panelOpen) {
			if (matchesKey(data, Key.ctrl("c"))) return undefined;
			if (matchesKey(data, Key.escape) || matchesKey(data, Key.left)) closePanel();
			return { consume: true };
		}
		if ((matchesKey(data, Key.down) || matchesKey(data, Key.enter)) && focused && canUseFooterNavigation()) {
			return openPanel() ? { consume: true } : undefined;
		}
		if (matchesKey(data, Key.down) && !focused && canUseFooterNavigation()) {
			focused = true;
			renderStatus();
			return { consume: true };
		}
		if (focused && (matchesKey(data, Key.left) || matchesKey(data, Key.escape))) {
			clearFocus();
			return { consume: true };
		}
		if (focused && !canUseFooterNavigation()) clearFocus();
		return undefined;
	});

	return {
		update(states) {
			activeStates = states.filter(isActiveSubagentState);
			if (activeStates.length === 0) {
				closePanel();
				focused = false;
			}
			panel?.setStates(activeStates);
			renderStatus();
		},
		stop() {
			unsubscribeInput?.();
			closePanel();
			ctx.ui.setStatus(STATUS_KEY, undefined);
		},
	};
}
