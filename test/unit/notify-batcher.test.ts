import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCompletionDispatcher } from "../../src/notify/batcher.js";
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

describe("createCompletionDispatcher", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("sends successful completion summaries as follow-up messages", () => {
		const sendMessage = vi.fn();
		const dispatcher = createCompletionDispatcher({ sendMessage } as never);

		dispatcher.push(stateOf({}));
		vi.runAllTimers();

		expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ customType: "pi-crew", display: true }), {
			deliverAs: "followUp",
			triggerTurn: true,
		});
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
	});

	it("still displays failed completion messages", () => {
		const sendMessage = vi.fn();
		const dispatcher = createCompletionDispatcher({ sendMessage } as never);

		dispatcher.push(stateOf({ status: "failed", exitCode: 1, errorMessage: "boom", finalOutput: null }));
		vi.runAllTimers();

		expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ customType: "pi-crew", display: true }), {
			deliverAs: "followUp",
			triggerTurn: true,
		});
	});
});
