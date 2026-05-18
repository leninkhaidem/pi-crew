import fs from "node:fs/promises";
import { parseCompleteJsonl } from "./jsonl.js";

const TRANSCRIPT_TAIL_BYTES = 64 * 1024;
const MAX_DISPLAY_EVENTS = 20;
const MAX_EVENT_TEXT_LENGTH = 2000;

const SENSITIVE_KEYS = ["thinking", "reasoning", "encrypted", "signature", "redacted"];

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
	const ev = event as { type?: string } | null;
	if (ev?.type === "message_update") return null;
	if (ev?.type && isSensitiveToken(ev.type)) return null;
	if (ev?.type === "compaction_start" || ev?.type === "compaction_end") return sanitizeCompactionEvent(event);

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
	if (type === "message_end") return formatMessageEnd(record);
	if (type === "tool_execution_update") return formatToolExecutionUpdate(record);
	if (type === "tool_execution_end") return formatToolExecutionEnd(record);
	return null;
}

function formatMessageEnd(event: Record<string, unknown>): string | null {
	const message = asRecord(event.message);
	if (!message) return null;
	const role = stringField(message, "role") ?? "assistant";
	if (role === "user" || role === "toolResult") return null;
	const content = formatContent(message.content);
	if (!content) return null;
	return boundedText(content);
}

function formatToolExecutionUpdate(event: Record<string, unknown>): string | null {
	const content = formatToolResultContent(event.partialResult);
	if (!content) return null;
	return boundedText(content);
}

function formatToolExecutionEnd(event: Record<string, unknown>): string | null {
	const content = formatToolResultContent(event.result);
	return content ? boundedText(content) : null;
}

function formatContent(content: unknown): string {
	if (typeof content === "string") return cleanText(content);
	if (!Array.isArray(content)) return "";
	const parts = content.map(formatContentPart).filter((part) => part.length > 0);
	return cleanText(parts.join("\n"));
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
	return "";
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

function boundedText(value: string): string {
	const text = cleanText(value);
	return text.length > MAX_EVENT_TEXT_LENGTH ? `${text.slice(0, MAX_EVENT_TEXT_LENGTH - 1)}…` : text;
}

function cleanText(value: string): string {
	return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\t/g, "  ").trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringField(record: Record<string, unknown> | null, key: string): string | undefined {
	const value = record?.[key];
	return typeof value === "string" ? value : undefined;
}

function sanitizeCompactionEvent(event: unknown): unknown | null {
	const record = asRecord(event);
	if (!record) return null;
	const out: Record<string, unknown> = {};
	for (const key of ["type", "reason", "aborted", "willRetry", "errorMessage"]) {
		if (record[key] !== undefined) out[key] = sanitizeValue(record[key], key);
	}
	return out;
}

function sanitizeValue(value: unknown, key?: string): unknown {
	if (key && isSensitiveToken(key)) return undefined;

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

function isThinkingPart(value: unknown): boolean {
	const type = value && typeof value === "object" ? (value as { type?: string }).type : undefined;
	return Boolean(type && isSensitiveToken(type));
}

function isSensitiveToken(value: string): boolean {
	const normalized = value.toLowerCase().replace(/[_-]/g, "");
	return SENSITIVE_KEYS.some((key) => normalized.includes(key));
}

function oneLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}
