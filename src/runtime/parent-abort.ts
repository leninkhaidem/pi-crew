import { abortSubagentByStatePath } from "./kill.js";
import type { DispatchHandle } from "./lifecycle.js";

const DEFAULT_REASON = "parent ask interrupted";

export interface ParentAbortTracker {
	track(signal: AbortSignal | undefined, handle: DispatchHandle): void;
	clear(): void;
}

export interface ParentAbortTrackerOptions {
	reason?: string;
	abortHandle?: (handle: DispatchHandle, reason: string) => Promise<unknown>;
}

interface Entry {
	handles: Set<DispatchHandle>;
	onAbort: () => void;
}

export function createParentAbortTracker(options: ParentAbortTrackerOptions = {}): ParentAbortTracker {
	const reason = options.reason ?? DEFAULT_REASON;
	const abortHandle =
		options.abortHandle ??
		((handle: DispatchHandle, why: string) => abortSubagentByStatePath(handle.state.paths.state, why));
	const entries = new Map<AbortSignal, Entry>();

	const abortAll = (signal: AbortSignal) => {
		const entry = entries.get(signal);
		if (!entry) return;
		entries.delete(signal);
		signal.removeEventListener("abort", entry.onAbort);
		const handles = [...entry.handles];
		entry.handles.clear();
		for (const handle of handles) {
			void abortHandle(handle, reason).catch(() => undefined);
		}
	};

	return {
		track(signal, handle) {
			if (!signal) return;
			if (signal.aborted) {
				void abortHandle(handle, reason).catch(() => undefined);
				return;
			}

			let entry = entries.get(signal);
			if (!entry) {
				entry = {
					handles: new Set(),
					onAbort: () => abortAll(signal),
				};
				entries.set(signal, entry);
				signal.addEventListener("abort", entry.onAbort, { once: true });
			}
			entry.handles.add(handle);

			void handle.donePromise
				.finally(() => {
					const current = entries.get(signal);
					if (!current) return;
					current.handles.delete(handle);
					if (current.handles.size === 0) {
						signal.removeEventListener("abort", current.onAbort);
						entries.delete(signal);
					}
				})
				.catch(() => undefined);
		},
		clear() {
			for (const [signal, entry] of entries) {
				signal.removeEventListener("abort", entry.onAbort);
			}
			entries.clear();
		},
	};
}
