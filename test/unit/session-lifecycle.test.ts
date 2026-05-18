import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "../../src/types.js";

let tmp: string;
let activeToolNames: string[];
let createdResourceLoaderOptions: unknown;
let createdSessionOptions: unknown;
let setActiveToolsByNameMock: ReturnType<typeof vi.fn>;
let fakeSession: {
	messages: unknown[];
	subscribe: ReturnType<typeof vi.fn>;
	getActiveToolNames: ReturnType<typeof vi.fn>;
	setActiveToolsByName: (toolNames: string[]) => void;
	bindExtensions: ReturnType<typeof vi.fn>;
	prompt: ReturnType<typeof vi.fn>;
	abort: ReturnType<typeof vi.fn>;
	steer: ReturnType<typeof vi.fn>;
	dispose: ReturnType<typeof vi.fn>;
};

vi.mock("@mariozechner/pi-coding-agent", () => ({
	DefaultResourceLoader: class {
		constructor(options: unknown) {
			createdResourceLoaderOptions = options;
		}

		async reload() {
			return undefined;
		}
	},
	SessionManager: { inMemory: vi.fn(() => ({})) },
	SettingsManager: { create: vi.fn(() => ({})) },
	createAgentSession: vi.fn(async (options: unknown) => {
		createdSessionOptions = options;
		return { session: fakeSession };
	}),
}));

const fakeAgent: AgentConfig = {
	name: "general-purpose",
	description: "test",
	tools: null,
	systemPrompt: "be brief",
	source: "bundled",
	filePath: "/fake.md",
};

describe("dispatchSession", () => {
	let subscriber: ((event: unknown) => void) | undefined;

	it("defines the pi-crew orchestration tools suppressed from sub-agents", async () => {
		const requiredTools = [
			"subagent_resume",
			"subagent_dispatch",
			"subagent_run",
			"subagent_status",
			"get_subagent_result",
			"steer_subagent",
			"subagent_kill",
		];
		const { PI_CREW_ORCHESTRATION_TOOL_NAMES, withoutPiCrewOrchestrationTools } = await import(
			"../../src/runtime/tool-suppression.js"
		);

		expect(PI_CREW_ORCHESTRATION_TOOL_NAMES).toEqual(expect.arrayContaining(requiredTools));
		expect(new Set(PI_CREW_ORCHESTRATION_TOOL_NAMES).size).toBe(PI_CREW_ORCHESTRATION_TOOL_NAMES.length);
		expect(withoutPiCrewOrchestrationTools([...requiredTools, "read", "bash"])).toEqual(["read", "bash"]);
	});

	beforeEach(() => {
		tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-session-"));
		subscriber = undefined;
		createdResourceLoaderOptions = undefined;
		createdSessionOptions = undefined;
		activeToolNames = ["read", "subagent_resume", "subagent_dispatch", "get_subagent_result", "steer_subagent", "bash"];
		setActiveToolsByNameMock = vi.fn((toolNames: string[]) => {
			activeToolNames = [...toolNames];
		});
		fakeSession = {
			messages: [{ role: "assistant", content: [{ type: "text", text: "ok" }] }],
			subscribe: vi.fn((listener) => {
				subscriber = listener;
				return () => undefined;
			}),
			getActiveToolNames: vi.fn(() => activeToolNames),
			setActiveToolsByName: setActiveToolsByNameMock,
			bindExtensions: vi.fn(async () => undefined),
			prompt: vi.fn(async () => undefined),
			abort: vi.fn(async () => undefined),
			steer: vi.fn(async () => undefined),
			dispose: vi.fn(),
		};
	});

	afterEach(() => {
		vi.useRealTimers();
		rmSync(tmp, { recursive: true, force: true });
	});

	it("waits for session-mode overflow compaction and retry events after prompt resolves", async () => {
		vi.useFakeTimers();
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		fakeSession.messages = [];
		fakeSession.prompt = vi.fn(async () => {
			subscriber?.({
				type: "message_end",
				message: {
					role: "assistant",
					provider: "mock",
					model: "model",
					stopReason: "error",
					errorMessage: "Your input exceeds the context window of this model",
				},
			});
			subscriber?.({
				type: "agent_end",
				messages: [
					{
						role: "assistant",
						stopReason: "error",
						errorMessage: "Your input exceeds the context window of this model",
					},
				],
			});
			subscriber?.({ type: "compaction_start", reason: "overflow" });
			setTimeout(() => {
				subscriber?.({
					type: "compaction_end",
					reason: "overflow",
					aborted: false,
					willRetry: true,
					result: { summary: "private compacted context", details: { secret: "omit" } },
				});
				fakeSession.messages = [{ role: "assistant", content: [{ type: "text", text: "retry recovered output" }] }];
				subscriber?.({
					type: "message_end",
					message: {
						role: "assistant",
						stopReason: "stop",
						content: [{ type: "text", text: "retry recovered output" }],
						usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { total: 0 } },
					},
				});
				subscriber?.({
					type: "agent_end",
					messages: [{ role: "assistant", content: [{ type: "text", text: "retry recovered output" }] }],
				});
			}, 10);
		});

		const handle = await dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "general-test", task: "recover" },
			},
			{
				agentDir: tmp,
				cwd: tmp,
				sessionId: "sess",
				parentAgentId: null,
				ctx: {
					modelRegistry: { find: vi.fn(() => ({ provider: "mock", id: "model" })) },
				} as never,
			},
		);
		await vi.advanceTimersByTimeAsync(10);
		const final = await handle.donePromise;

		expect(final.status).toBe("done");
		expect(final.finalOutput).toBe("retry recovered output");
		expect(final.errorMessage).toBeNull();
	});

	it("recovers session-mode overflow when only the retry agent_end carries success output", async () => {
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		fakeSession.messages = [];
		fakeSession.prompt = vi.fn(async () => {
			subscriber?.({
				type: "message_end",
				message: {
					role: "assistant",
					provider: "mock",
					model: "model",
					stopReason: "error",
					errorMessage: "Your input exceeds the context window of this model",
				},
			});
			subscriber?.({ type: "agent_end", messages: [] });
			subscriber?.({ type: "compaction_start", reason: "overflow" });
			subscriber?.({ type: "compaction_end", reason: "overflow", aborted: false, willRetry: true });
			fakeSession.messages = [{ role: "assistant", content: [{ type: "text", text: "agent_end retry output" }] }];
			subscriber?.({
				type: "agent_end",
				messages: [{ role: "assistant", content: [{ type: "text", text: "agent_end retry output" }] }],
			});
		});

		const handle = await dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "general-test", task: "recover" },
			},
			{
				agentDir: tmp,
				cwd: tmp,
				sessionId: "sess",
				parentAgentId: null,
				ctx: {
					modelRegistry: { find: vi.fn(() => ({ provider: "mock", id: "model" })) },
				} as never,
			},
		);
		const final = await handle.donePromise;

		expect(final.status).toBe("done");
		expect(final.finalOutput).toBe("agent_end retry output");
		expect(final.errorMessage).toBeNull();
	});

	it.each([
		[
			"compaction failure",
			{ type: "compaction_end", reason: "overflow", aborted: false, willRetry: false, errorMessage: "compact failed" },
		],
		["compaction abort", { type: "compaction_end", reason: "overflow", aborted: true, willRetry: false }],
		["no retry", { type: "compaction_end", reason: "overflow", aborted: false, willRetry: false }],
	])("fails session-mode overflow recovery on %s", async (_name, endEvent) => {
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		fakeSession.messages = [];
		fakeSession.prompt = vi.fn(async () => {
			subscriber?.({ type: "compaction_start", reason: "overflow" });
			subscriber?.(endEvent);
		});

		const handle = await dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "general-test", task: "recover" },
			},
			{
				agentDir: tmp,
				cwd: tmp,
				sessionId: "sess",
				parentAgentId: null,
				ctx: {
					modelRegistry: { find: vi.fn(() => ({ provider: "mock", id: "model" })) },
				} as never,
			},
		);
		const final = await handle.donePromise;

		expect(final.status).toBe("failed");
		expect(final.stopReason).toBe("context_overflow_recovery_failed");
		expect(final.errorMessage).toContain("Context overflow recovery failed");
		expect(final.finalOutput).toBeNull();
	});

	it.each([
		["retry abort", { stopReason: "aborted" }],
		["retry error", { stopReason: "error", errorMessage: "retry provider failure" }],
	])("fails session-mode overflow recovery on %s", async (_name, retryMessage) => {
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		fakeSession.messages = [];
		fakeSession.prompt = vi.fn(async () => {
			subscriber?.({
				type: "message_end",
				message: {
					role: "assistant",
					stopReason: "error",
					errorMessage: "Your input exceeds the context window of this model",
				},
			});
			subscriber?.({ type: "agent_end", messages: [] });
			subscriber?.({ type: "compaction_start", reason: "overflow" });
			subscriber?.({ type: "compaction_end", reason: "overflow", aborted: false, willRetry: true });
			subscriber?.({ type: "message_end", message: { role: "assistant", ...retryMessage } });
		});

		const handle = await dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "general-test", task: "recover" },
			},
			{
				agentDir: tmp,
				cwd: tmp,
				sessionId: "sess",
				parentAgentId: null,
				ctx: {
					modelRegistry: { find: vi.fn(() => ({ provider: "mock", id: "model" })) },
				} as never,
			},
		);
		const final = await handle.donePromise;

		expect(final.status).toBe("failed");
		expect(final.stopReason).toBe("context_overflow_recovery_failed");
		expect(final.errorMessage).toContain("Context overflow recovery failed");
		expect(final.finalOutput).toBeNull();
	});

	it("fails session-mode overflow recovery when retry never starts", async () => {
		vi.useFakeTimers();
		const { OVERFLOW_RECOVERY_TIMEOUT_MS } = await import("../../src/runtime/overflow-recovery.js");
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		fakeSession.messages = [];
		fakeSession.prompt = vi.fn(async () => {
			subscriber?.({ type: "compaction_start", reason: "overflow" });
			subscriber?.({ type: "compaction_end", reason: "overflow", aborted: false, willRetry: true });
		});

		const handle = await dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "general-test", task: "recover" },
			},
			{
				agentDir: tmp,
				cwd: tmp,
				sessionId: "sess",
				parentAgentId: null,
				ctx: {
					modelRegistry: { find: vi.fn(() => ({ provider: "mock", id: "model" })) },
				} as never,
			},
		);
		await vi.advanceTimersByTimeAsync(OVERFLOW_RECOVERY_TIMEOUT_MS);
		const final = await handle.donePromise;

		expect(final.status).toBe("failed");
		expect(final.errorMessage).toContain("idle timeout");
		expect(final.finalOutput).toBeNull();
	});

	it("fails session-mode overflow recovery on non-user dispose while pending", async () => {
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		fakeSession.messages = [];
		fakeSession.prompt = vi.fn(async () => {
			subscriber?.({ type: "compaction_start", reason: "overflow" });
			subscriber?.({ type: "compaction_end", reason: "overflow", aborted: false, willRetry: true });
		});

		const handle = await dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "general-test", task: "recover" },
			},
			{
				agentDir: tmp,
				cwd: tmp,
				sessionId: "sess",
				parentAgentId: null,
				ctx: {
					modelRegistry: { find: vi.fn(() => ({ provider: "mock", id: "model" })) },
				} as never,
			},
		);
		await handle.dispose?.();
		const final = await handle.donePromise;

		expect(final.status).toBe("failed");
		expect(final.errorMessage).toContain("lifecycle disposal");
		expect(final.finalOutput).toBeNull();
	});

	it("preserves user abort while session-mode overflow recovery is pending", async () => {
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		fakeSession.messages = [];
		fakeSession.prompt = vi.fn(async () => {
			subscriber?.({ type: "compaction_start", reason: "overflow" });
			subscriber?.({ type: "compaction_end", reason: "overflow", aborted: false, willRetry: true });
		});

		const handle = await dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "general-test", task: "recover" },
			},
			{
				agentDir: tmp,
				cwd: tmp,
				sessionId: "sess",
				parentAgentId: null,
				ctx: {
					modelRegistry: { find: vi.fn(() => ({ provider: "mock", id: "model" })) },
				} as never,
			},
		);
		await handle.abort?.("user canceled");
		const final = await handle.donePromise;

		expect(final.status).toBe("aborted");
		expect(final.errorMessage).toBe("user canceled");
		expect(final.stopReason).not.toBe("context_overflow_recovery_failed");
	});

	it("does not classify generic session-mode prompt errors as overflow recovery", async () => {
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		fakeSession.prompt = vi.fn(async () => {
			throw new Error("rate limit: too many requests");
		});

		const handle = await dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "general-test", task: "say ok" },
			},
			{
				agentDir: tmp,
				cwd: tmp,
				sessionId: "sess",
				parentAgentId: null,
				ctx: {
					modelRegistry: { find: vi.fn(() => ({ provider: "mock", id: "model" })) },
				} as never,
			},
		);
		const final = await handle.donePromise;

		expect(final.status).toBe("failed");
		expect(final.errorMessage).toBe("rate limit: too many requests");
		expect(final.stopReason).not.toBe("context_overflow_recovery_failed");
	});

	it("does not fail completed final answers that arrive on the max-turn hard-abort boundary", async () => {
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		fakeSession.prompt = vi.fn(async () => {
			subscriber?.({ type: "turn_end", message: { role: "assistant", stopReason: "toolUse" } });
			subscriber?.({ type: "turn_end", message: { role: "assistant", stopReason: "toolUse" } });
			fakeSession.messages = [{ role: "assistant", content: [{ type: "text", text: "final answer" }] }];
			subscriber?.({
				type: "message_end",
				message: {
					role: "assistant",
					stopReason: "stop",
					content: [{ type: "text", text: "final answer" }],
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { total: 0 } },
				},
			});
			subscriber?.({ type: "turn_end", message: { role: "assistant", stopReason: "stop" } });
		});

		const handle = await dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "general-test", task: "say ok", maxTurns: 1 },
			},
			{
				agentDir: tmp,
				cwd: tmp,
				sessionId: "sess",
				parentAgentId: null,
				ctx: {
					modelRegistry: { find: vi.fn(() => ({ provider: "mock", id: "model" })) },
				} as never,
			},
		);
		const final = await handle.donePromise;

		expect(final.status).toBe("done");
		expect(final.finalOutput).toBe("final answer");
		expect(fakeSession.abort).not.toHaveBeenCalled();
	});

	it("binds extensions so extension-provided skills/resources are inherited by session-mode sub-agents", async () => {
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");

		const handle = await dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "general-test", task: "say ok" },
			},
			{
				agentDir: tmp,
				cwd: tmp,
				sessionId: "sess",
				parentAgentId: null,
				ctx: {
					modelRegistry: { find: vi.fn(() => ({ provider: "mock", id: "model" })) },
				} as never,
			},
		);
		await handle.donePromise;

		expect(setActiveToolsByNameMock).toHaveBeenCalledWith(["read", "bash"]);
		expect(fakeSession.bindExtensions).toHaveBeenCalledTimes(1);
		expect(fakeSession.bindExtensions).toHaveBeenCalledWith(expect.objectContaining({ onError: expect.any(Function) }));
	});

	it("filters pi-crew extension handlers before binding session-mode sub-agents", async () => {
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		const { PI_CREW_ORCHESTRATION_TOOL_NAMES } = await import("../../src/runtime/tool-suppression.js");

		const handle = await dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "general-test", task: "say ok" },
			},
			{
				agentDir: tmp,
				cwd: tmp,
				sessionId: "sess",
				parentAgentId: null,
				ctx: {
					modelRegistry: { find: vi.fn(() => ({ provider: "mock", id: "model" })) },
				} as never,
			},
		);
		await handle.donePromise;

		const options = createdResourceLoaderOptions as {
			extensionsOverride?: (base: { extensions: Array<{ tools: Map<string, unknown> }> }) => {
				extensions: Array<{ tools: Map<string, unknown> }>;
			};
		};
		const piCrewExtension = { tools: new Map([[PI_CREW_ORCHESTRATION_TOOL_NAMES[0], {}]]) };
		const nonPiCrewExtension = { tools: new Map([["extension_tool", {}]]) };

		const filtered = options.extensionsOverride?.({ extensions: [piCrewExtension, nonPiCrewExtension] });

		expect(filtered?.extensions).toEqual([nonPiCrewExtension]);
	});

	it("keeps pi-crew orchestration tools inactive after extension binding and tool refresh", async () => {
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		const { PI_CREW_ORCHESTRATION_TOOL_NAMES } = await import("../../src/runtime/tool-suppression.js");
		fakeSession.bindExtensions = vi.fn(async () => {
			fakeSession.setActiveToolsByName([...activeToolNames, "subagent_status", "extension_tool"]);
		});

		const handle = await dispatchSession(
			{
				agent: { ...fakeAgent, tools: ["read", "subagent_resume", "get_subagent_result", "steer_subagent", "bash"] },
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "general-test", task: "say ok" },
			},
			{
				agentDir: tmp,
				cwd: tmp,
				sessionId: "sess",
				parentAgentId: null,
				ctx: {
					modelRegistry: { find: vi.fn(() => ({ provider: "mock", id: "model" })) },
				} as never,
			},
		);
		await handle.donePromise;
		fakeSession.setActiveToolsByName(["read", "subagent_resume", "steer_subagent", "extension_tool"]);

		const createdTools = (createdSessionOptions as { tools?: string[] }).tools;
		expect(createdTools).toBeUndefined();
		expect(activeToolNames).toEqual(["read", "extension_tool"]);
		for (const call of setActiveToolsByNameMock.mock.calls) {
			for (const toolName of PI_CREW_ORCHESTRATION_TOOL_NAMES) {
				expect(call[0]).not.toContain(toolName);
			}
		}
	});

	it("persists session-mode child prompts without pi-crew delegation guidance", async () => {
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");

		const handle = await dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "general-test", task: "say ok" },
			},
			{
				agentDir: tmp,
				cwd: tmp,
				sessionId: "sess",
				parentAgentId: null,
				ctx: {
					modelRegistry: { find: vi.fn(() => ({ provider: "mock", id: "model" })) },
				} as never,
			},
		);
		await handle.donePromise;

		const prompt = readFileSync(handle.state.paths.prompt, "utf-8");
		expect(prompt).toContain("be brief");
		expect(prompt).not.toContain("## pi-crew sub-agents");
	});
});
