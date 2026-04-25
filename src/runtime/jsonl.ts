export type JsonlEventHandler = (event: unknown) => void;
export type JsonlErrorHandler = (line: string, err: unknown) => void;

export interface JsonlParser {
	write(chunk: Buffer | string): void;
	flush(): void;
}

export function createJsonlParser(onEvent: JsonlEventHandler, onError?: JsonlErrorHandler): JsonlParser {
	let pending = "";

	const tryDispatch = (line: string) => {
		const trimmed = line.trim();
		if (!trimmed) return;
		try {
			onEvent(JSON.parse(trimmed));
		} catch (err) {
			if (onError) onError(trimmed, err);
		}
	};

	return {
		write(chunk: Buffer | string) {
			pending += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
			let idx: number;
			// biome-ignore lint/suspicious/noAssignInExpressions: idiomatic line splitter
			while ((idx = pending.indexOf("\n")) >= 0) {
				const line = pending.slice(0, idx);
				pending = pending.slice(idx + 1);
				tryDispatch(line);
			}
		},
		flush() {
			if (pending.length > 0) {
				tryDispatch(pending);
				pending = "";
			}
		},
	};
}
