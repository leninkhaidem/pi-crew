const SENSITIVE_KEYS = new Set([
	"thinking",
	"thinkingSignature",
	"encrypted_content",
	"encryptedContent",
	"reasoning_content",
	"reasoningContent",
]);

/**
 * Keep persisted sub-agent transcripts useful without storing hidden reasoning
 * payloads or noisy streaming deltas. The returned event is safe to JSON.stringify;
 * null means the event should not be written at all.
 */
export function sanitizeTranscriptEvent(event: unknown): unknown | null {
	const ev = event as { type?: string } | null;
	if (ev?.type === "message_update") return null;

	const sanitized = sanitizeValue(event);
	return sanitized === undefined ? null : sanitized;
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

function isThinkingPart(value: unknown): boolean {
	return Boolean(value && typeof value === "object" && (value as { type?: string }).type === "thinking");
}
