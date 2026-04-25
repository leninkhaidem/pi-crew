// src/ui/state-watcher.ts
import fs from "node:fs";
import fsp from "node:fs/promises";
import { listStates } from "../state/store.js";
import type { SubagentState } from "../types.js";

export interface WatcherArgs {
	sessionDir: string;
	onChange: (states: SubagentState[]) => void;
	debounceMs?: number;
	pollIntervalMs?: number;
}

export interface WatcherHandle {
	stop(): void;
}

export function mountStateWatcher(args: WatcherArgs): WatcherHandle {
	const debounce = args.debounceMs ?? 250;
	const pollInterval = args.pollIntervalMs ?? 1000;
	let timer: NodeJS.Timeout | null = null;
	let stopped = false;

	const refresh = async () => {
		try {
			const states = await listStates(args.sessionDir, { includeDetached: true });
			args.onChange(states);
		} catch {
			// ignore
		}
	};

	const schedule = () => {
		if (stopped) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			void refresh();
		}, debounce);
	};

	void fsp.mkdir(args.sessionDir, { recursive: true }).catch(() => undefined);
	let watcher: fs.FSWatcher | null = null;
	try {
		watcher = fs.watch(args.sessionDir, { recursive: true }, () => schedule());
	} catch {
		watcher = null;
	}

	const poll = setInterval(() => schedule(), pollInterval);

	void refresh();

	return {
		stop() {
			stopped = true;
			if (timer) clearTimeout(timer);
			clearInterval(poll);
			watcher?.close();
		},
	};
}
