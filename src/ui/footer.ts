// src/ui/footer.ts
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { SubagentState } from "../types.js";
import { isActiveSubagentState } from "./subagents-panel.js";

const STATUS_KEY = "pi-crew";

export interface FooterController {
	update(states: SubagentState[]): void;
	stop(): void;
}

interface FooterArgs {
	onKill?: (state: SubagentState) => void | Promise<void>;
}

export function mountFooter(ctx: ExtensionContext, _args: FooterArgs = {}): FooterController {
	let activeStates: SubagentState[] = [];

	const renderStatus = () => {
		if (activeStates.length === 0) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		ctx.ui.setStatus(
			STATUS_KEY,
			`⟳ ${activeStates.length} ${pluralize("sub-agent", activeStates.length)} running · /subagents · Ctrl+B background · Esc Esc abort`,
		);
	};

	return {
		update(states) {
			activeStates = states.filter(isActiveSubagentState);
			renderStatus();
		},
		stop() {
			ctx.ui.setStatus(STATUS_KEY, undefined);
		},
	};
}

function pluralize(noun: string, count: number): string {
	return count === 1 ? noun : `${noun}s`;
}
