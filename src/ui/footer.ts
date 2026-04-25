// src/ui/footer.ts
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { SubagentState } from "../types.js";

export interface FooterController {
	update(states: SubagentState[]): void;
	stop(): void;
}

export function mountFooter(ctx: ExtensionContext): FooterController {
	const update = (states: SubagentState[]) => {
		const running = states.filter((s) => s.status === "running" || s.status === "starting").length;
		if (running === 0) {
			ctx.ui.setStatus("pi-crew", undefined);
			return;
		}
		ctx.ui.setStatus("pi-crew", `⟳ ${running} running`);
	};

	return {
		update,
		stop() {
			ctx.ui.setStatus("pi-crew", undefined);
		},
	};
}
