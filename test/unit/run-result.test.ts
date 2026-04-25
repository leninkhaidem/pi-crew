import { describe, expect, it } from "vitest";
import { formatRunStateResult } from "../../src/tools/run.js";
import type { SubagentState } from "../../src/types.js";

const stateOf = (overrides: Partial<SubagentState>): SubagentState => ({
	schemaVersion: 1,
	agentId: "abc12345",
	parentAgentId: null,
	sessionId: "sess",
	agent: "general-purpose",
	agentSource: "bundled",
	task: "do work",
	cwd: "/proj",
	branch: null,
	model: "gpt-5.5",
	provider: "openai-codex",
	thinking: "xhigh",
	tools: null,
	maxTurns: null,
	pid: 1234,
	startedAt: 0,
	finishedAt: null,
	lastUpdate: 1,
	status: "done",
	exitCode: 0,
	stopReason: null,
	errorMessage: null,
	turns: 1,
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 },
	lastText: null,
	lastToolCall: null,
	finalOutput: "done output",
	paths: {
		state: "/p/state.json",
		output: "/p/output.jsonl",
		stderr: "/p/stderr.log",
		prompt: "/p/prompt.md",
	},
	...overrides,
});

describe("formatRunStateResult", () => {
	it("returns a compact summary with trace pointers for single-agent success output", () => {
		const result = formatRunStateResult(stateOf({}), { single: true });
		expect(result).toContain("[general-purpose #abc12345] done");
		expect(result).toContain("Summary: done output");
		expect(result).toContain("Trace: /p/output.jsonl");
		expect(result).toContain("State: /p/state.json");
	});

	it("shows aborted single-agent runs with status and reason instead of no output", () => {
		const result = formatRunStateResult(
			stateOf({ status: "aborted", exitCode: 143, errorMessage: "parent ask interrupted", finalOutput: null }),
			{ single: true },
		);

		expect(result).toContain("[general-purpose #abc12345] aborted — parent ask interrupted");
		expect(result).toContain("Trace: /p/output.jsonl");
	});

	it("shows failed batch runs with status and reason", () => {
		const result = formatRunStateResult(
			stateOf({ status: "failed", exitCode: 1, errorMessage: "boom", finalOutput: null }),
		);

		expect(result).toContain("[general-purpose #abc12345] failed — boom");
		expect(result).toContain("State: /p/state.json");
	});
});
