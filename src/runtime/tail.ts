import fs from "node:fs/promises";
import { type JsonlParser, createJsonlParser } from "./jsonl.js";

export interface TailHandle {
	stop(): Promise<void>;
}

export interface TailArgs {
	path: string;
	onEvent: (event: unknown) => void;
	onError?: (line: string, err: unknown) => void;
	pollIntervalMs?: number;
	signal?: AbortSignal;
}

export function tailJsonl(args: TailArgs): TailHandle {
	const parser: JsonlParser = createJsonlParser(args.onEvent, args.onError);
	const interval = args.pollIntervalMs ?? 100;
	let position = 0;
	let stopped = false;

	const tick = async () => {
		if (stopped || args.signal?.aborted) return;
		try {
			const handle = await fs.open(args.path, "r");
			try {
				const stat = await handle.stat();
				if (stat.size > position) {
					const len = stat.size - position;
					const buf = Buffer.alloc(len);
					await handle.read(buf, 0, len, position);
					position = stat.size;
					parser.write(buf);
				}
			} finally {
				await handle.close();
			}
		} catch (err) {
			const e = err as NodeJS.ErrnoException;
			if (e.code !== "ENOENT") throw err;
		}
		if (!stopped) setTimeout(tick, interval);
	};

	void tick();
	return {
		async stop() {
			stopped = true;
			parser.flush();
		},
	};
}
