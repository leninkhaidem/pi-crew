import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { SubagentState } from "../types.js";
import { formatBatchedMessage, formatCompletionMessage } from "./message.js";

const BATCH_WINDOW_MS = 2000;

export interface CompletionDispatcher {
	push(state: SubagentState): void;
	flush(): void;
}

export function createCompletionDispatcher(pi: ExtensionAPI): CompletionDispatcher {
	let queue: SubagentState[] = [];
	let timer: NodeJS.Timeout | null = null;

	const flushNow = () => {
		if (queue.length === 0) return;
		const batch = queue;
		queue = [];
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		const content =
			batch.length === 1 ? formatCompletionMessage(batch[0] as SubagentState) : formatBatchedMessage(batch);
		pi.sendMessage({ customType: "pi-crew", display: true, content }, { triggerTurn: false });
	};

	return {
		push(state) {
			queue.push(state);
			if (timer) return;
			timer = setTimeout(flushNow, BATCH_WINDOW_MS);
		},
		flush: flushNow,
	};
}
