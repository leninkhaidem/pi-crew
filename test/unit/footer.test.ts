import { describe, expect, it } from "vitest";
import type { SubagentState } from "../../src/types.js";
import { mountFooter } from "../../src/ui/footer.js";

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
	finishedAt: null,
	lastUpdate: 1,
	status: "running",
	exitCode: null,
	stopReason: null,
	errorMessage: null,
	turns: 1,
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 },
	lastText: null,
	lastToolCall: null,
	finalOutput: null,
	paths: {
		state: "/p/state.json",
		output: "/p/output.jsonl",
		stderr: "/p/stderr.log",
		prompt: "/p/prompt.md",
	},
	...overrides,
});

describe("mountFooter", () => {
	it("clears the footer status when no sub-agents are active", () => {
		const calls: Array<{ id: string; value: string | undefined }> = [];
		const footer = mountFooter({
			ui: {
				setStatus: (id: string, value: string | undefined) => calls.push({ id, value }),
			},
		} as never);

		footer.update([
			stateOf({ status: "done", finishedAt: 2, exitCode: 0 }),
			stateOf({ agentId: "def67890", status: "failed", finishedAt: 3, exitCode: 1 }),
		]);

		expect(calls).toEqual([{ id: "pi-crew", value: undefined }]);
	});

	it("shows only the active running count", () => {
		const calls: Array<{ id: string; value: string | undefined }> = [];
		const footer = mountFooter({
			ui: {
				setStatus: (id: string, value: string | undefined) => calls.push({ id, value }),
			},
		} as never);

		footer.update([
			stateOf({ status: "running" }),
			stateOf({ agentId: "def67890", status: "starting" }),
			stateOf({ agentId: "ghi23456", status: "done", finishedAt: 2, exitCode: 0 }),
		]);

		expect(calls).toEqual([{ id: "pi-crew", value: "⟳ 2 running" }]);
	});
});
