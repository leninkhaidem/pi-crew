import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { SubagentState } from "../types.js";
import { formatBatchedMessage, formatCompletionMessage } from "./message.js";

const BATCH_WINDOW_MS = 2000;

export interface CompletionDispatcher {
	push(state: SubagentState, generation?: number): void;
	consume(agentId: string): void;
	rearm(agentId: string): void;
	generation(agentId: string): number;
	wasHandled(agentId: string): boolean;
	flush(): void;
}

export function createCompletionDispatcher(pi: ExtensionAPI): CompletionDispatcher {
	let queue: SubagentState[] = [];
	let timer: NodeJS.Timeout | null = null;
	const consumed = new Set<string>();
	const delivered = new Set<string>();
	const generations = new Map<string, number>();

	const flushNow = () => {
		if (queue.length === 0) return;
		const batch = queue.filter((state) => !consumed.has(state.agentId));
		queue = [];
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		if (batch.length === 0) return;
		const content =
			batch.length === 1 ? formatCompletionMessage(batch[0] as SubagentState) : formatBatchedMessage(batch);
		pi.sendMessage(
			{ customType: "pi-crew", display: true, content, details: { states: batch } },
			{ deliverAs: "steer", triggerTurn: true },
		);
		for (const state of batch) delivered.add(state.agentId);
	};

	return {
		push(state, generation = generations.get(state.agentId) ?? 0) {
			if (generation !== (generations.get(state.agentId) ?? 0) || consumed.has(state.agentId)) return;
			queue.push(state);
			if (timer) return;
			timer = setTimeout(flushNow, BATCH_WINDOW_MS);
		},
		consume(agentId) {
			consumed.add(agentId);
			queue = queue.filter((state) => state.agentId !== agentId);
			if (queue.length === 0 && timer) {
				clearTimeout(timer);
				timer = null;
			}
		},
		rearm(agentId) {
			generations.set(agentId, (generations.get(agentId) ?? 0) + 1);
			consumed.delete(agentId);
			delivered.delete(agentId);
			queue = queue.filter((state) => state.agentId !== agentId);
			if (queue.length === 0 && timer) {
				clearTimeout(timer);
				timer = null;
			}
		},
		generation(agentId) {
			return generations.get(agentId) ?? 0;
		},
		wasHandled(agentId) {
			return consumed.has(agentId) || delivered.has(agentId);
		},
		flush: flushNow,
	};
}
