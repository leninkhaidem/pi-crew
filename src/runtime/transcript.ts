import fs from "node:fs/promises";
import { formatToolCall } from "../ui/format.js";
import { parseCompleteJsonl } from "./jsonl.js";

const TRANSCRIPT_TAIL_BYTES = 64 * 1024;
const MAX_DISPLAY_EVENTS = 20;
const MAX_EVENT_TEXT_LENGTH = 2000;

const SENSITIVE_KEYS = new Set([
	"thinking",
	"thinkingSignature",
	"encrypted_content",
	"encryptedContent",
	"reasoning_content",
	"reasoningContent",
]);

export type TranscriptExcerpt =
	| { kind: "events"; events: string[] }
	| { kind: "empty"; message: string }
	| { kind: "unreadable"; message: string };

/**
 * Keep persisted sub-agent transcripts useful without storing hidden reasoning
 * payloads. The returned event is safe to JSON.stringify; null means the event
 * should not be written at all.
 */
export function sanitizeTranscriptEvent(event: unknown): unknown | null {
	const ev = event as { type?: string; assistantMessageEvent?: unknown } | null;
	if (ev?.type === "message_update" && !hasVisibleTextDelta(ev.assistantMessageEvent)) return null;

	const sanitized = sanitizeValue(event);
	return sanitized === undefined ? null : sanitized;
}

export async function readRecentTranscriptExcerpt(outputPath: string): Promise<TranscriptExcerpt> {
	try {
		const tail = await readTail(outputPath, TRANSCRIPT_TAIL_BYTES);
		const parsed = parseCompleteJsonl(tail.text, {
			skipFirstPartial: tail.startedAfterBeginning,
			skipLastPartial: true,
		});
		const events = displayableEvents(parsed);
		if (events.length === 0) return { kind: "empty", message: "No recent transcript events." };
		return { kind: "events", events: events.slice(-MAX_DISPLAY_EVENTS) };
	} catch {
		return { kind: "unreadable", message: "Transcript unavailable." };
	}
}

async function readTail(filePath: string, maxBytes: number): Promise<{ text: string; startedAfterBeginning: boolean }> {
	const handle = await fs.open(filePath, "r");
	try {
		const stat = await handle.stat();
		const length = Math.min(stat.size, maxBytes);
		if (length === 0) return { text: "", startedAfterBeginning: false };
		const start = stat.size - length;
		const buffer = Buffer.alloc(length);
		await handle.read(buffer, 0, length, start);
		return { text: buffer.toString("utf8"), startedAfterBeginning: start > 0 };
	} finally {
		await handle.close();
	}
}

function displayableEvents(events: unknown[]): string[] {
	const displayable: string[] = [];
	for (const event of events) {
		const sanitized = sanitizeTranscriptEvent(event);
		const line = formatTranscriptEvent(sanitized);
		if (line) displayable.push(line);
	}
	return displayable;
}

function formatTranscriptEvent(event: unknown | null): string | null {
	const record = asRecord(event);
	if (!record) return null;
	const type = stringField(record, "type");
	if (type === "message_update") return formatMessageUpdate(record);
	if (type === "message_end") return formatMessageEnd(record);
	if (type === "tool_call_start") return formatToolCallStart(record);
	if (type === "tool_call_end") return formatToolCallEnd(record);
	if (type === "tool_execution_start") return formatToolExecutionStart(record);
	if (type === "tool_execution_update") return formatToolExecutionUpdate(record);
	if (type === "tool_execution_end") return formatToolExecutionEnd(record);
	if (type === "agent_start") return "agent: started";
	if (type === "agent_end") return formatAgentEnd(record);
	return formatGenericEvent(record, type);
}

function formatMessageUpdate(event: Record<string, unknown>): string | null {
	const update = asRecord(event.assistantMessageEvent);
	if (!hasVisibleTextDelta(update)) return null;
	const partial = asRecord(update?.partial);
	const content = formatContent(partial?.content);
	return content ? boundedLine(`assistant: ${content}`) : null;
}

function formatMessageEnd(event: Record<string, unknown>): string | null {
	const message = asRecord(event.message);
	if (!message) return null;
	const role = stringField(message, "role") ?? "assistant";
	if (role === "user") return null;
	const content = formatContent(message.content);
	if (!content) return null;
	return boundedLine(role === "toolResult" ? `tool result: ${content}` : `${role}: ${content}`);
}

function formatToolCallStart(event: Record<string, unknown>): string | null {
	const message = asRecord(event.message);
	const name = stringField(message, "name");
	if (!name) return null;
	return boundedLine(`tool: ${formatToolCall(name, asArgs(message?.arguments))}`);
}

function formatToolCallEnd(event: Record<string, unknown>): string | null {
	const message = asRecord(event.message);
	const name = stringField(message, "name") ?? stringField(event, "toolName") ?? "tool";
	return boundedLine(`tool: ${name} completed`);
}

function formatToolExecutionStart(event: Record<string, unknown>): string | null {
	const name = stringField(event, "toolName");
	if (!name) return null;
	return boundedLine(`tool: ${formatToolCall(name, asArgs(event.args))}`);
}

function formatToolExecutionUpdate(event: Record<string, unknown>): string | null {
	const content = formatToolResultContent(event.partialResult);
	if (!content) return null;
	const name = stringField(event, "toolName") ?? "tool";
	return boundedLine(`tool output (${name}): ${content}`);
}

function formatToolExecutionEnd(event: Record<string, unknown>): string | null {
	const name = stringField(event, "toolName") ?? "tool";
	const content = formatToolResultContent(event.result);
	return boundedLine(content ? `tool result (${name}): ${content}` : `tool: ${name} completed`);
}

function formatAgentEnd(event: Record<string, unknown>): string | null {
	const messages = Array.isArray(event.messages) ? event.messages : [];
	const last = messages
		.map(asRecord)
		.filter((msg) => msg?.role === "assistant")
		.at(-1);
	const content = last ? formatContent(last.content) : "completed";
	return boundedLine(`agent: ${content || "completed"}`);
}

function formatGenericEvent(event: Record<string, unknown>, type: string | undefined): string | null {
	const text = stringField(event, "text") ?? stringField(event, "content") ?? stringField(event, "message");
	if (!text) return null;
	return boundedLine(`${type ?? "event"}: ${text}`);
}

function formatContent(content: unknown): string {
	if (typeof content === "string") return oneLine(content);
	if (!Array.isArray(content)) return "";
	const parts = content.map(formatContentPart).filter((part) => part.length > 0);
	return oneLine(parts.join(" "));
}

function formatContentPart(part: unknown): string {
	if (typeof part === "string") return part;
	const record = asRecord(part);
	if (!record) return "";
	const type = stringField(record, "type");
	if (type === "text") return stringField(record, "text") ?? "";
	if (type === "tool_use" || type === "tool_call" || type === "toolCall") {
		return `[tool use: ${stringField(record, "name") ?? "tool"}]`;
	}
	if (type === "tool_result" || type === "toolResult") return `tool result: ${formatContent(record.content)}`;
	return stringField(record, "text") ?? "";
}

function formatToolResultContent(value: unknown): string {
	const record = asRecord(value);
	if (!record) return formatContent(value);
	return (
		formatContent(record.content) ||
		stringField(record, "text") ||
		stringField(record, "output") ||
		stringField(record, "message") ||
		""
	);
}

function asArgs(value: unknown): Record<string, unknown> {
	return asRecord(value) ?? {};
}

function boundedLine(value: string): string {
	const line = oneLine(value);
	return line.length > MAX_EVENT_TEXT_LENGTH ? `${line.slice(0, MAX_EVENT_TEXT_LENGTH - 1)}…` : line;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringField(record: Record<string, unknown> | null, key: string): string | undefined {
	const value = record?.[key];
	return typeof value === "string" ? value : undefined;
}

function sanitizeValue(value: unknown, key?: string): unknown {
	if (key && SENSITIVE_KEYS.has(key)) return undefined;

	if (Array.isArray(value)) {
		const out: unknown[] = [];
		for (const item of value) {
			if (isThinkingPart(item)) continue;
			const sanitized = sanitizeValue(item);
			if (sanitized !== undefined) out.push(sanitized);
		}
		return out;
	}

	if (value && typeof value === "object") {
		if (isThinkingPart(value)) return undefined;
		const out: Record<string, unknown> = {};
		for (const [childKey, childValue] of Object.entries(value)) {
			const sanitized = sanitizeValue(childValue, childKey);
			if (sanitized !== undefined) out[childKey] = sanitized;
		}
		return out;
	}

	return value;
}

function hasVisibleTextDelta(update: unknown): boolean {
	const record = asRecord(update);
	if (stringField(record, "type") !== "text_delta") return false;
	const partial = asRecord(record?.partial);
	return containsVisibleText(partial?.content);
}

function containsVisibleText(value: unknown): boolean {
	if (typeof value === "string") return value.trim().length > 0;
	if (!Array.isArray(value)) return false;
	return value.some((part) => {
		if (typeof part === "string") return part.trim().length > 0;
		const record = asRecord(part);
		return stringField(record, "type") === "text" && Boolean(stringField(record, "text")?.trim());
	});
}

function isThinkingPart(value: unknown): boolean {
	return Boolean(value && typeof value === "object" && (value as { type?: string }).type === "thinking");
}

function oneLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}
