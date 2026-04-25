import { describe, expect, it } from "vitest";
import { sanitizeTranscriptEvent } from "../../src/runtime/transcript.js";

describe("sanitizeTranscriptEvent", () => {
	it("drops thinking update events entirely", () => {
		const event = {
			type: "message_update",
			assistantMessageEvent: {
				type: "thinking_end",
				content: "hidden",
				partial: {
					content: [{ type: "thinking", thinking: "hidden", thinkingSignature: "secret" }],
				},
			},
		};

		expect(sanitizeTranscriptEvent(event)).toBeNull();
	});

	it("drops streaming text deltas from persisted transcripts", () => {
		expect(
			sanitizeTranscriptEvent({
				type: "message_update",
				assistantMessageEvent: { type: "text_delta", partial: { content: [{ type: "text", text: "partial" }] } },
			}),
		).toBeNull();
	});

	it("removes thinking parts and signatures from retained events", () => {
		const event = {
			type: "message_end",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "hidden", thinkingSignature: "secret" },
					{ type: "text", text: "visible" },
				],
			},
		};

		const sanitized = sanitizeTranscriptEvent(event);
		expect(JSON.stringify(sanitized)).not.toContain("thinkingSignature");
		expect(JSON.stringify(sanitized)).not.toContain("hidden");
		expect(JSON.stringify(sanitized)).toContain("visible");
	});
});
