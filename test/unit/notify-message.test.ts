import { describe, expect, it } from "vitest";
import { formatBatchedMessage, formatCompletionMessage } from "../../src/notify/message.js";
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
	model: "claude-haiku-4-5",
	provider: "anthropic",
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
	turns: 4,
	usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0.0021, contextTokens: 150 },
	lastText: null,
	lastToolCall: null,
	finalOutput: "Found 12 files in api/auth.",
	paths: {
		state: "/p/state.json",
		output: "/p/output.jsonl",
		stderr: "/p/stderr.log",
		prompt: "/p/prompt.md",
	},
	...overrides,
});

describe("formatCompletionMessage", () => {
	it("formats success with final output and paths", () => {
		const msg = formatCompletionMessage(stateOf({}));
		expect(msg).toContain("✓ subagent explore #abc12345 finished");
		expect(msg).toContain("Found 12 files in api/auth.");
		expect(msg).toContain("/p/output.jsonl");
		expect(msg).toContain("$0.0021");
	});

	it("includes long success output without truncation", () => {
		const longOutput = `start-${"x".repeat(2000)}-end`;
		const msg = formatCompletionMessage(stateOf({ finalOutput: longOutput }));
		expect(msg).toContain(longOutput);
		expect(msg).not.toContain("<truncated");
		expect(msg).toContain("/p/output.jsonl");
	});

	it("formats failure with stderr path", () => {
		const msg = formatCompletionMessage(stateOf({ status: "failed", exitCode: 1, errorMessage: "rate limit" }));
		expect(msg).toContain("✗ subagent explore #abc12345 failed");
		expect(msg).toContain("rate limit");
		expect(msg).toContain("/p/stderr.log");
	});

	it("formats aborted with reason", () => {
		const msg = formatCompletionMessage(stateOf({ status: "aborted", errorMessage: "user cancelled", exitCode: -1 }));
		expect(msg).toContain("✗ subagent explore #abc12345 aborted: user cancelled");
	});
});

describe("formatBatchedMessage", () => {
	it("formats multiple completions with complete final outputs", () => {
		const alpha = `alpha-${"x".repeat(800)}-end`;
		const beta = `beta-${"y".repeat(800)}-end`;
		const a = stateOf({ agentId: "aaaa1111", finalOutput: alpha });
		const b = stateOf({ agentId: "bbbb2222", agent: "general-purpose", finalOutput: beta });
		const msg = formatBatchedMessage([a, b]);
		expect(msg).toContain("Sub-agent batch update");
		expect(msg).toContain("✓ explore #aaaa1111");
		expect(msg).toContain("✓ general-purpose #bbbb2222");
		expect(msg).toContain(alpha);
		expect(msg).toContain(beta);
	});
});
