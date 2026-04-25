// src/ui/footer.ts
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { SubagentState } from "../types.js";

export interface FooterController {
	update(states: SubagentState[]): void;
	stop(): void;
}

export function mountFooter(ctx: ExtensionContext): FooterController {
	const update = (states: SubagentState[]) => {
		const counts = { running: 0, done: 0, failed: 0 };
		for (const s of states) {
			if (s.status === "running" || s.status === "starting") counts.running++;
			else if (s.status === "done") counts.done++;
			else counts.failed++;
		}
		if (states.length === 0) {
			ctx.ui.setStatus("pi-crew", undefined);
			return;
		}
		ctx.ui.setStatus("pi-crew", `⟳ ${counts.running} running · ${counts.done} done · ${counts.failed} failed`);
	};

	return {
		update,
		stop() {
			ctx.ui.setStatus("pi-crew", undefined);
		},
	};
}
