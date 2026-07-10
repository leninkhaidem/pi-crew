import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCompletionDispatcher } from "../../src/notify/batcher.js";
import { registerNotificationRenderer } from "../../src/notify/renderer.js";
import type { SubagentState } from "../../src/types.js";

const stateOf = (overrides: Partial<SubagentState>): SubagentState => ({
	schemaVersion: 1,
	agentId: "abc12345",
	parentAgentId: null,
	sessionId: "sess",
	agent: "explore",
	alias: "auth-search",
	agentSource: "bundled",
	task: "find auth",
	cwd: "/proj",
	branch: null,
	model: "gpt-5.4-mini",
	provider: "openai-codex",
	thinking: "low",
	tools: null,
	maxTurns: null,
	pid: 1234,
	startedAt: 0,
	finishedAt: 1,
	lastUpdate: 1,
	status: "done",
	exitCode: 0,
	stopReason: "stop",
	errorMessage: null,
	turns: 1,
	usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0.0021, contextTokens: 150 },
	lastText: null,
	lastToolCall: null,
	finalOutput: "Found auth files.",
	paths: {
		state: "/p/state.json",
		output: "/p/output.jsonl",
		stderr: "/p/stderr.log",
		prompt: "/p/prompt.md",
	},
	...overrides,
});

describe("notification renderer", () => {
	it("shows effective thinking and canonical warning in compact and expanded completion UI", () => {
		let renderer:
			| ((
					message: { details: { states: SubagentState[] } },
					options: { expanded: boolean },
					theme: unknown,
			  ) => { render(width: number): string[] } | undefined)
			| undefined;
		registerNotificationRenderer({
			registerMessageRenderer: (_type: string, value: typeof renderer) => {
				renderer = value;
			},
		} as never);
		const adjusted = stateOf({
			thinking: "high",
			thinkingAdjustment: { requested: "max", effective: "high" },
		});
		for (const expanded of [false, true]) {
			const component = renderer?.(
				{ details: { states: [adjusted] } },
				{ expanded },
				{ bold: (text: string) => text, fg: (_name: string, text: string) => text },
			);
			const rendered = component?.render(180).join("\n") ?? "";
			expect(rendered).toContain("openai-codex/gpt-5.4-mini · high");
			expect(rendered).toContain('requested thinking level "max"');
			expect(rendered).toContain("Found auth files.");
		}
	});
});

describe("createCompletionDispatcher", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("sends successful completion summaries as steering messages", () => {
		const sendMessage = vi.fn();
		const dispatcher = createCompletionDispatcher({ sendMessage } as never);

		dispatcher.push(stateOf({}));
		expect(dispatcher.wasHandled("abc12345")).toBe(false);
		vi.runAllTimers();

		expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ customType: "pi-crew", display: true }), {
			deliverAs: "steer",
			triggerTurn: true,
		});
		expect(dispatcher.wasHandled("abc12345")).toBe(true);
	});

	it("keeps complete detailed state text in injected completion messages", () => {
		const sendMessage = vi.fn();
		const dispatcher = createCompletionDispatcher({ sendMessage } as never);
		const finalOutput = "x".repeat(2000);
		const lastText = "y".repeat(2000);

		dispatcher.push(stateOf({ finalOutput, lastText }));
		vi.runAllTimers();

		const message = sendMessage.mock.calls[0]?.[0] as { details?: { states?: SubagentState[] } };
		expect(message.details?.states?.[0]?.finalOutput).toBe(finalOutput);
		expect(message.details?.states?.[0]?.lastText).toBe(lastText);
	});

	it("suppresses consumed completions", () => {
		const sendMessage = vi.fn();
		const dispatcher = createCompletionDispatcher({ sendMessage } as never);

		dispatcher.push(stateOf({}));
		dispatcher.consume("abc12345");
		vi.runAllTimers();

		expect(sendMessage).not.toHaveBeenCalled();
		expect(dispatcher.wasHandled("abc12345")).toBe(true);
	});

	it("preserves structured adjustment provenance in injected completion details", () => {
		const sendMessage = vi.fn();
		const dispatcher = createCompletionDispatcher({ sendMessage } as never);
		dispatcher.push(stateOf({ thinking: "high", thinkingAdjustment: { requested: "max", effective: "high" } }));
		vi.runAllTimers();
		const message = sendMessage.mock.calls[0]?.[0] as { content: string; details: { states: SubagentState[] } };
		expect(message.content).toContain('requested thinking level "max"');
		expect(message.details.states[0]?.thinking).toBe("high");
		expect(message.details.states[0]?.thinkingAdjustment).toEqual({ requested: "max", effective: "high" });
	});

	it("still displays failed completion messages", () => {
		const sendMessage = vi.fn();
		const dispatcher = createCompletionDispatcher({ sendMessage } as never);

		dispatcher.push(stateOf({ status: "failed", exitCode: 1, errorMessage: "boom", finalOutput: null }));
		vi.runAllTimers();

		expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ customType: "pi-crew", display: true }), {
			deliverAs: "steer",
			triggerTurn: true,
		});
	});
});
