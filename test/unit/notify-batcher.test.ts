import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCompletionDispatcher } from "../../src/notify/batcher.js";
import type { SubagentState } from "../../src/types.js";

const stateOf = (overrides: Partial<SubagentState>): SubagentState => ({
	schemaVersion: 1,
	agentId: "abc12345",
	parentAgentId: null,
	sessionId: "sess",
	agent: "explore",
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

	it("keeps successful completion messages hidden from the UI", () => {
		const sendMessage = vi.fn();
		const dispatcher = createCompletionDispatcher({ sendMessage } as never);

		dispatcher.push(stateOf({}));
		vi.runAllTimers();

		expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ customType: "pi-crew", display: false }), {
			triggerTurn: false,
		});
	});

	it("still displays failed completion messages", () => {
		const sendMessage = vi.fn();
		const dispatcher = createCompletionDispatcher({ sendMessage } as never);

		dispatcher.push(stateOf({ status: "failed", exitCode: 1, errorMessage: "boom", finalOutput: null }));
		vi.runAllTimers();

		expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ customType: "pi-crew", display: true }), {
			triggerTurn: false,
		});
	});
});
