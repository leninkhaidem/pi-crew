import { describe, expect, it, vi } from "vitest";
import { createDetachController } from "../../src/runtime/detach.js";
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

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const drain = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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
	const resumeHandle = vi.fn<(id: string, task: string, signal?: AbortSignal) => Promise<SubagentState> | null>();
	if (resumeResult === null) {
		resumeHandle.mockReturnValue(null);
	} else {
		resumeHandle.mockResolvedValue(resumeResult);
	}
	const consumeCompletion = vi.fn();
	const detach = createDetachController();
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
			detach,
		},
		release,
		consumeCompletion,
		resumeHandle,
		detach,
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
	it("registers a detach scope while resume is pending and returns promptly when backgrounded", async () => {
		const pending = deferred<SubagentState>();
		const { rt, release, consumeCompletion, detach } = createRuntime();
		rt.resumeHandle.mockReturnValue(pending.promise);
		const tool = registerAndGetTool(rt);

		const toolPromise = tool.execute("call-detach", {
			agent_id: "resume-001",
			prompt: "continue in background",
		});
		await Promise.resolve();

		expect(detach.hasActiveScopes()).toBe(true);
		detach.detachAll();
		const result = (await toolPromise) as { content: Array<{ text: string }>; details: Record<string, unknown> };
		expect(result.details.status).toBe("backgrounded");
		expect(result.content[0]?.text).toContain("moved to background");
		expect(result.content[0]?.text).toContain("Completion will be injected automatically");
		expect(consumeCompletion).not.toHaveBeenCalled();
		expect(release).not.toHaveBeenCalled();

		pending.resolve(stateOf());
		await drain();
		expect(release).toHaveBeenCalledOnce();
		await drain();
		expect(release).toHaveBeenCalledOnce();
	});

	it("returns active-limit-reached error when concurrency limit is hit", async () => {
		const { rt, detach } = createRuntime({ tryAcquire: false });
		const tool = registerAndGetTool(rt);

		const result = (await tool.execute("call-1", {
			agent_id: "resume-001",
			prompt: "continue",
		})) as { content: Array<{ text: string }>; details: Record<string, unknown> };

		expect(result.details.error).toBe("max_active_reached");
		expect(result.content[0]?.text).toContain("Active sub-agent limit reached");
		expect(result.content[0]?.text).toContain("3");
		expect(detach.hasActiveScopes()).toBe(false);
	});

	it("does not consume completion state when resume admission is unavailable", async () => {
		const { rt, release, consumeCompletion, detach } = createRuntime({ resumeResult: null });
		const tool = registerAndGetTool(rt);

		const result = (await tool.execute("call-2", {
			agent_id: "no-such-agent",
			prompt: "hello",
		})) as { content: Array<{ text: string }>; details: Record<string, unknown> };

		expect(result.details.error).toBe("resume_unavailable");
		expect(result.details.agentId).toBe("no-such-agent");
		expect(result.content[0]?.text).toContain("Cannot resume");
		expect(consumeCompletion).not.toHaveBeenCalled();
		expect(detach.hasActiveScopes()).toBe(false);
		expect(release).toHaveBeenCalledOnce();
	});

	it("returns success result with agentId, alias, status, finalOutput, usage, and persisted adjustment", async () => {
		const state = stateOf({
			thinking: "high",
			thinkingAdjustment: { requested: "max", effective: "high" },
		});
		const { rt, release, consumeCompletion, resumeHandle, detach } = createRuntime({
			resumeResult: state,
		});
		const tool = registerAndGetTool(rt);

		const result = (await tool.execute("call-3", {
			agent_id: "resume-001",
			prompt: "follow-up task",
			provider: "reserved-provider",
			model: "reserved-model",
			thinking: "max",
		})) as { content: Array<{ text: string }>; details: Record<string, unknown> };

		expect(result.details.agentId).toBe("resume-001");
		expect(result.details.alias).toBe("my-session");
		expect(result.details.status).toBe("done");
		expect(result.details.finalOutput).toBe("Resumed successfully");
		expect(result.details.usage).toEqual(state.usage);
		expect(result.details.agent).toBe("general-purpose");
		expect(result.details.thinking).toBe("high");
		expect(result.details.thinkingAdjustment).toEqual({ requested: "max", effective: "high" });
		expect(result.content[0]?.text).toContain('requested thinking level "max"');
		expect(consumeCompletion).toHaveBeenCalledWith("resume-001");
		expect(resumeHandle).toHaveBeenCalledWith("resume-001", "follow-up task", undefined);
		expect(detach.hasActiveScopes()).toBe(false);
		expect(release).toHaveBeenCalledOnce();
	});

	it("does not consume completion state when an admitted resume later rejects", async () => {
		const { rt, release, consumeCompletion, detach } = createRuntime();
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
		expect(consumeCompletion).not.toHaveBeenCalled();
		expect(detach.hasActiveScopes()).toBe(false);
		expect(release).toHaveBeenCalledOnce();
	});
});
