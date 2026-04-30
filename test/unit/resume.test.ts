import { describe, expect, it, vi } from "vitest";
import { registerResumeTool } from "../../src/tools/resume.js";
import type { SubagentState } from "../../src/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type ToolExecute = (
	id: string,
	params: Record<string, unknown>,
	signal?: AbortSignal,
	onUpdate?: unknown,
	ctx?: unknown,
) => Promise<unknown>;

function stateOf(overrides: Partial<SubagentState> = {}): SubagentState {
	return {
		schemaVersion: 1,
		agentId: "resume-001",
		parentAgentId: null,
		sessionId: "sess",
		agent: "general-purpose",
		alias: "my-session",
		agentSource: "bundled",
		task: "follow-up task",
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
		exitCode: 0,
		stopReason: "stop",
		errorMessage: null,
		turns: 4,
		usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0.01, contextTokens: 150 },
		lastText: null,
		lastToolCall: null,
		finalOutput: "Resumed successfully",
		paths: {
			state: "/p/state.json",
			output: "/p/output.jsonl",
			stderr: "/p/stderr.log",
			prompt: "/p/prompt.md",
		},
		...overrides,
	};
}

function createRuntime(overrides: { tryAcquire?: boolean; resumeResult?: SubagentState | null } = {}) {
	const { tryAcquire = true, resumeResult = stateOf() } = overrides;
	const release = vi.fn();
	const resumeHandle = vi.fn<(id: string, task: string, signal?: AbortSignal) => Promise<SubagentState | null>>();
	if (resumeResult === null) {
		resumeHandle.mockResolvedValue(null);
	} else {
		resumeHandle.mockResolvedValue(resumeResult);
	}
	const consumeCompletion = vi.fn();
	return {
		rt: {
			concurrency: {
				active: {
					tryAcquire: vi.fn(() => tryAcquire),
					release,
					current: vi.fn(() => (tryAcquire ? 0 : 3)),
				},
			},
			consumeCompletion,
			resumeHandle,
		},
		release,
		consumeCompletion,
		resumeHandle,
	};
}

function registerAndGetTool(rt: ReturnType<typeof createRuntime>["rt"]) {
	const tools = new Map<string, { execute: ToolExecute }>();
	const pi = { registerTool: vi.fn((tool: { name: string; execute: ToolExecute }) => tools.set(tool.name, tool)) };
	registerResumeTool(pi as never, rt as never);
	return tools.get("subagent_resume")!;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("subagent_resume tool", () => {
	it("returns active-limit-reached error when concurrency limit is hit", async () => {
		const { rt } = createRuntime({ tryAcquire: false });
		const tool = registerAndGetTool(rt);

		const result = (await tool.execute("call-1", {
			agent_id: "resume-001",
			prompt: "continue",
		})) as { content: Array<{ text: string }>; details: Record<string, unknown> };

		expect(result.details.error).toBe("max_active_reached");
		expect(result.content[0]?.text).toContain("Active sub-agent limit reached");
		expect(result.content[0]?.text).toContain("3");
	});

	it("returns resume_unavailable when agent not found or not session-mode", async () => {
		const { rt, release, consumeCompletion } = createRuntime({ resumeResult: null });
		const tool = registerAndGetTool(rt);

		const result = (await tool.execute("call-2", {
			agent_id: "no-such-agent",
			prompt: "hello",
		})) as { content: Array<{ text: string }>; details: Record<string, unknown> };

		expect(result.details.error).toBe("resume_unavailable");
		expect(result.details.agentId).toBe("no-such-agent");
		expect(result.content[0]?.text).toContain("Cannot resume");
		expect(consumeCompletion).toHaveBeenCalledWith("no-such-agent");
		expect(release).toHaveBeenCalledOnce();
	});

	it("returns success result with agentId, alias, status, finalOutput, usage", async () => {
		const state = stateOf();
		const { rt, release, consumeCompletion } = createRuntime({ resumeResult: state });
		const tool = registerAndGetTool(rt);

		const result = (await tool.execute("call-3", {
			agent_id: "resume-001",
			prompt: "follow-up task",
		})) as { content: Array<{ text: string }>; details: Record<string, unknown> };

		expect(result.details.agentId).toBe("resume-001");
		expect(result.details.alias).toBe("my-session");
		expect(result.details.status).toBe("done");
		expect(result.details.finalOutput).toBe("Resumed successfully");
		expect(result.details.usage).toEqual(state.usage);
		expect(result.details.agent).toBe("general-purpose");
		expect(result.content[0]?.text).toBeTruthy();
		expect(consumeCompletion).toHaveBeenCalledWith("resume-001");
		expect(release).toHaveBeenCalledOnce();
	});

	it("returns not-found result when resumeHandle throws (catch path)", async () => {
		const { rt, release } = createRuntime();
		// Override resumeHandle to reject
		rt.resumeHandle.mockRejectedValue(new Error("session expired"));
		const tool = registerAndGetTool(rt);

		const result = (await tool.execute("call-4", {
			agent_id: "broken-agent",
			prompt: "try again",
		})) as { content: Array<{ text: string }>; details: Record<string, unknown> };

		expect(result.details.error).toBe("resume_unavailable");
		expect(result.details.agentId).toBe("broken-agent");
		expect(result.content[0]?.text).toContain("Cannot resume");
		expect(release).toHaveBeenCalledOnce();
	});
});
