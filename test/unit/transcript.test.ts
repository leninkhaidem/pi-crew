import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readRecentTranscriptExcerpt, sanitizeTranscriptEvent } from "../../src/runtime/transcript.js";

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

	it("keeps visible streaming text deltas while dropping hidden thinking updates", () => {
		expect(
			sanitizeTranscriptEvent({
				type: "message_update",
				assistantMessageEvent: { type: "text_delta", partial: { content: [{ type: "text", text: "partial" }] } },
			}),
		).toEqual({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", partial: { content: [{ type: "text", text: "partial" }] } },
		});
		expect(
			sanitizeTranscriptEvent({
				type: "message_update",
				assistantMessageEvent: {
					type: "thinking_delta",
					partial: { content: [{ type: "thinking", thinking: "hidden" }] },
				},
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

describe("readRecentTranscriptExcerpt", () => {
	it("reads a bounded recent formatted transcript excerpt", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pi-crew-transcript-"));
		try {
			const outputPath = path.join(dir, "output.jsonl");
			const events = Array.from({ length: 25 }, (_, idx) =>
				JSON.stringify({
					type: "message_end",
					message: { role: "assistant", content: [{ type: "text", text: `event ${idx}` }] },
				}),
			);
			const hidden = JSON.stringify({
				type: "message_end",
				message: { role: "assistant", content: [{ type: "thinking", thinking: "hidden" }] },
			});
			writeFileSync(
				outputPath,
				[
					"x".repeat(70 * 1024),
					"{ malformed",
					hidden,
					...events,
					JSON.stringify({ type: "message_end", message: { role: "assistant", content: "partial" } }),
				].join("\n"),
			);

			const excerpt = await readRecentTranscriptExcerpt(outputPath);

			expect(excerpt.kind).toBe("events");
			if (excerpt.kind !== "events") return;
			expect(excerpt.events).toHaveLength(20);
			expect(excerpt.events[0]).toContain("event 5");
			expect(excerpt.events.at(-1)).toContain("event 24");
			expect(JSON.stringify(excerpt)).not.toContain("hidden");
			expect(JSON.stringify(excerpt)).not.toContain("partial");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("formats live transcript events without duplicating the task prompt", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pi-crew-transcript-"));
		try {
			const outputPath = path.join(dir, "output.jsonl");
			const lines = [
				JSON.stringify({
					type: "message_end",
					message: { role: "user", content: [{ type: "text", text: "Task: find auth" }] },
				}),
				JSON.stringify({ type: "tool_execution_start", toolName: "read", args: { path: "src/auth.ts" } }),
				JSON.stringify({
					type: "tool_execution_update",
					toolName: "bash",
					partialResult: { content: [{ type: "text", text: "line one" }] },
				}),
				JSON.stringify({ type: "tool_execution_end", toolName: "read" }),
				JSON.stringify({
					type: "message_update",
					assistantMessageEvent: { type: "text_delta", partial: { content: [{ type: "text", text: "working" }] } },
				}),
				JSON.stringify({
					type: "message_end",
					message: { role: "assistant", content: [{ type: "text", text: "done" }] },
				}),
			];
			writeFileSync(outputPath, `${lines.join("\n")}\n`);

			const excerpt = await readRecentTranscriptExcerpt(outputPath);

			expect(excerpt.kind).toBe("events");
			if (excerpt.kind !== "events") return;
			expect(excerpt.events.join("\n")).not.toContain("Task: find auth");
			expect(excerpt.events).toContain('tool: read {"path":"src/auth.ts"}');
			expect(excerpt.events).toContain("tool output (bash): line one");
			expect(excerpt.events).toContain("tool: read completed");
			expect(excerpt.events).toContain("assistant: working");
			expect(excerpt.events).toContain("assistant: done");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns fallbacks for empty or unreadable transcript data", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pi-crew-transcript-"));
		try {
			const emptyPath = path.join(dir, "empty.jsonl");
			writeFileSync(emptyPath, "");

			expect(await readRecentTranscriptExcerpt(emptyPath)).toEqual({
				kind: "empty",
				message: "No recent transcript events.",
			});
			expect(await readRecentTranscriptExcerpt(path.join(dir, "missing.jsonl"))).toEqual({
				kind: "unreadable",
				message: "Transcript unavailable.",
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
