// src/cli/tail.ts
/**
 * pi-crew tail — render a sub-agent's output.jsonl as it streams.
 *
 * Usage: node dist/cli/tail.js <output.jsonl>
 */
import fs from "node:fs/promises";
import { createJsonlParser } from "../runtime/jsonl.js";
import { formatToolCall } from "../ui/format.js";

interface AssistantContent {
	type: string;
	text?: string;
}

interface AssistantMessage {
	role?: string;
	content?: AssistantContent[];
}

interface ToolCallMessage {
	name?: string;
	arguments?: Record<string, unknown>;
}

interface JsonlEvent {
	type?: string;
	message?: AssistantMessage | ToolCallMessage;
}

async function main(): Promise<void> {
	const target = process.argv[2];
	if (!target) {
		process.stderr.write("usage: pi-crew tail <output.jsonl>\n");
		process.exit(2);
	}
	let position = 0;
	const parser = createJsonlParser((event) => {
		const ev = event as JsonlEvent;
		if (ev.type === "message_end" && ev.message && (ev.message as AssistantMessage).role === "assistant") {
			const msg = ev.message as AssistantMessage;
			const text = (msg.content ?? [])
				.filter((c) => c.type === "text")
				.map((c) => c.text ?? "")
				.join("\n");
			if (text) process.stdout.write(`\n\x1b[37m${text}\x1b[0m\n`);
		} else if (ev.type === "tool_call_start" && ev.message) {
			const tc = ev.message as ToolCallMessage;
			if (tc.name) {
				process.stdout.write(`\x1b[36m→ ${formatToolCall(tc.name, tc.arguments ?? {})}\x1b[0m\n`);
			}
		} else if (ev.type === "agent_end") {
			process.stdout.write("\n\x1b[2m[done]\x1b[0m\n");
			process.exit(0);
		}
	});

	while (true) {
		try {
			const handle = await fs.open(target, "r");
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
			if (e.code !== "ENOENT") {
				process.stderr.write(`tail error: ${e.message}\n`);
			}
		}
		await new Promise((r) => setTimeout(r, 200));
	}
}

void main();
