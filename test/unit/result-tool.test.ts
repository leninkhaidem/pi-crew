import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeState } from "../../src/state/store.js";
import { registerGetSubagentResultTool } from "../../src/tools/result.js";
import type { SubagentState } from "../../src/types.js";

const stateOf = (agentDir: string, overrides: Partial<SubagentState>): SubagentState => {
	const agentId = overrides.agentId ?? "abc12345";
	const sessionId = overrides.sessionId ?? "sess";
	const dir = path.join(agentDir, "subagents", sessionId, agentId);
	return {
		schemaVersion: 1,
		agentId,
		parentAgentId: null,
		sessionId,
		agent: "explore",
		alias: "summarizer",
		agentSource: "bundled",
		task: "summarize",
		cwd: "/proj",
		branch: null,
		model: "gpt-5.4-mini",
		provider: "openai-codex",
		thinking: "low",
		tools: null,
		maxTurns: null,
		pid: null,
		startedAt: 0,
		finishedAt: 1,
		lastUpdate: 1,
		status: "done",
		exitCode: null,
		stopReason: "stop",
		errorMessage: null,
		turns: 1,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 },
		lastText: null,
		lastToolCall: null,
		finalOutput: "done",
		paths: {
			state: path.join(dir, "state.json"),
			output: path.join(dir, "output.jsonl"),
			stderr: path.join(dir, "stderr.log"),
			prompt: path.join(dir, "prompt.md"),
		},
		...overrides,
	};
};

describe("get_subagent_result", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-result-"));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("returns the complete final output without summary truncation", async () => {
		const longOutput = `start-${"x".repeat(2000)}-end`;
		await writeState(stateOf(tmp, { finalOutput: longOutput }));
		let execute: ((id: string, params: { agent_id: string }, signal?: AbortSignal) => Promise<unknown>) | undefined;
		const pi = {
			registerTool: vi.fn((tool) => {
				execute = tool.execute;
			}),
		};
		const consumeCompletion = vi.fn();

		registerGetSubagentResultTool(pi as never, { agentDir: tmp, consumeCompletion } as never);
		const result = (await execute?.("call", { agent_id: "abc12345" })) as {
			content: Array<{ type: "text"; text: string }>;
		};

		expect(result.content[0]?.text).toContain(longOutput);
		expect(result.content[0]?.text).not.toContain("Summary truncated");
		expect(consumeCompletion).toHaveBeenCalledWith("abc12345");
	});
});
