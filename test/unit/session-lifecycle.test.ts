import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig, SubagentState } from "../../src/types.js";

let tmp: string;
let activeToolNames: string[];
let createdResourceLoaderOptions: unknown;
let createdSessionOptions: unknown;
let createdServiceOptions: unknown;
let childModelRuntime: {
	getModel: ReturnType<typeof vi.fn>;
	getAvailable: ReturnType<typeof vi.fn>;
	setRuntimeApiKey: ReturnType<typeof vi.fn>;
	removeRuntimeApiKey: ReturnType<typeof vi.fn>;
};
let setActiveToolsByNameMock: ReturnType<typeof vi.fn>;
let writeStateInterceptor:
	| ((state: SubagentState, write: (state: SubagentState) => Promise<void>) => Promise<void>)
	| undefined;
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

vi.mock("@earendil-works/pi-coding-agent", () => ({
	SessionManager: { inMemory: vi.fn(() => ({})) },
	createAgentSessionServices: vi.fn(async (options: { resourceLoaderOptions?: unknown }) => {
		createdServiceOptions = options;
		createdResourceLoaderOptions = options.resourceLoaderOptions;
		return {
			cwd: tmp,
			agentDir: tmp,
			diagnostics: [],
			settingsManager: {},
			resourceLoader: {},
			modelRuntime: childModelRuntime,
		};
	}),
	createAgentSessionFromServices: vi.fn(async (options: unknown) => {
		createdSessionOptions = options;
		return { session: fakeSession };
	}),
}));

vi.mock("../../src/state/store.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/state/store.js")>();
	return {
		...actual,
		writeState: (state: SubagentState) =>
			writeStateInterceptor ? writeStateInterceptor(state, actual.writeState) : actual.writeState(state),
	};
});

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

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
		createdServiceOptions = undefined;
		writeStateInterceptor = undefined;
		childModelRuntime = {
			getModel: vi.fn((provider: string, id: string) => ({ provider, id, reasoning: true })),
			getAvailable: vi.fn(async (provider: string) => [{ provider, id: "model", reasoning: true }]),
			setRuntimeApiKey: vi.fn(async () => undefined),
			removeRuntimeApiKey: vi.fn(async () => undefined),
		};
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
		expect(final.stopReason).toBe("stop");
		expect(final.stopReason).not.toBe("error");
		expect(final.stopReason).not.toBe("context_overflow_recovery_failed");
		expect(final.finalOutput).toBe("retry recovered output");
		expect(final.errorMessage).toBeNull();
	});

	it("preserves terminal length output after overflow retry in session mode", async () => {
		vi.useFakeTimers();
		const { OVERFLOW_RECOVERY_TIMEOUT_MS } = await import("../../src/runtime/overflow-recovery.js");
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
			const terminal = {
				role: "assistant",
				stopReason: "length",
				content: [{ type: "text", text: "retry reached its output limit" }],
			};
			fakeSession.messages = [terminal];
			subscriber?.({ type: "message_end", message: terminal });
			subscriber?.({ type: "agent_end", messages: [terminal] });
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
				sessionId: "sess-length-recovery",
				parentAgentId: null,
				ctx: {
					modelRegistry: { find: vi.fn(() => ({ provider: "mock", id: "model" })) },
				} as never,
			},
		);
		await vi.advanceTimersByTimeAsync(OVERFLOW_RECOVERY_TIMEOUT_MS);
		const final = await handle.donePromise;

		expect(final.status).toBe("done");
		expect(final.stopReason).toBe("length");
		expect(final.finalOutput).toBe("retry reached its output limit");
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
		expect(final.stopReason).toBeNull();
		expect(final.stopReason).not.toBe("error");
		expect(final.stopReason).not.toBe("context_overflow_recovery_failed");
		expect(final.finalOutput).toBe("agent_end retry output");
		expect(final.errorMessage).toBeNull();
	});

	it("preserves completed output after successful overflow compaction without retry", async () => {
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		fakeSession.messages = [{ role: "assistant", content: [{ type: "text", text: "completed before compaction" }] }];
		fakeSession.prompt = vi.fn(async () => {
			subscriber?.({
				type: "message_end",
				message: {
					role: "assistant",
					stopReason: "stop",
					content: [{ type: "text", text: "completed before compaction" }],
					usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { total: 0 } },
				},
			});
			subscriber?.({ type: "turn_end", message: { role: "assistant", stopReason: "stop" } });
			subscriber?.({
				type: "agent_end",
				messages: [{ role: "assistant", content: [{ type: "text", text: "completed before compaction" }] }],
			});
			subscriber?.({ type: "compaction_start", reason: "overflow" });
			subscriber?.({ type: "compaction_end", reason: "overflow", aborted: false, willRetry: false });
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
		expect(final.stopReason).toBe("stop");
		expect(final.stopReason).not.toBe("context_overflow_recovery_failed");
		expect(final.finalOutput).toBe("completed before compaction");
		expect(final.errorMessage).toBeNull();
	});

	it("does not reuse stale completed output after a later overflow failure", async () => {
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		fakeSession.messages = [{ role: "assistant", content: [{ type: "text", text: "earlier completed output" }] }];
		fakeSession.prompt = vi.fn(async () => {
			subscriber?.({
				type: "message_end",
				message: {
					role: "assistant",
					stopReason: "stop",
					content: [{ type: "text", text: "earlier completed output" }],
					usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { total: 0 } },
				},
			});
			subscriber?.({
				type: "agent_end",
				messages: [{ role: "assistant", content: [{ type: "text", text: "earlier completed output" }] }],
			});
			subscriber?.({
				type: "message_end",
				message: {
					role: "assistant",
					stopReason: "error",
					errorMessage: "Your input exceeds the context window of this model",
				},
			});
			subscriber?.({
				type: "agent_end",
				messages: [
					{ role: "assistant", content: [{ type: "text", text: "earlier completed output" }] },
					{
						role: "assistant",
						stopReason: "error",
						errorMessage: "Your input exceeds the context window of this model",
					},
				],
			});
			subscriber?.({ type: "compaction_start", reason: "overflow" });
			subscriber?.({ type: "compaction_end", reason: "overflow", aborted: false, willRetry: false });
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
				sessionId: "sess-stale-overflow",
				parentAgentId: null,
				ctx: {
					modelRegistry: { find: vi.fn(() => ({ provider: "mock", id: "model" })) },
				} as never,
			},
		);
		const final = await handle.donePromise;

		expect(final.status).toBe("failed");
		expect(final.stopReason).toBe("context_overflow_recovery_failed");
		expect(final.errorMessage).toContain("did not retry");
		expect(final.finalOutput).toBeNull();
	});

	it("does not treat terminal overflow error text as completed in session mode", async () => {
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		fakeSession.messages = [];
		fakeSession.prompt = vi.fn(async () => {
			subscriber?.({
				type: "message_end",
				message: {
					role: "assistant",
					stopReason: "error",
					errorMessage: "Your input exceeds the context window of this model",
					content: [{ type: "text", text: "Partial overflow error text" }],
				},
			});
			subscriber?.({
				type: "agent_end",
				messages: [
					{
						role: "assistant",
						stopReason: "error",
						errorMessage: "Your input exceeds the context window of this model",
						content: [{ type: "text", text: "Partial overflow error text" }],
					},
				],
			});
			subscriber?.({ type: "compaction_start", reason: "overflow" });
			subscriber?.({ type: "compaction_end", reason: "overflow", aborted: false, willRetry: false });
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
				sessionId: "sess-terminal-overflow-error-text",
				parentAgentId: null,
				ctx: {
					modelRegistry: { find: vi.fn(() => ({ provider: "mock", id: "model" })) },
				} as never,
			},
		);
		const final = await handle.donePromise;

		expect(final.status).toBe("failed");
		expect(final.stopReason).toBe("context_overflow_recovery_failed");
		expect(final.errorMessage).toContain("did not retry");
		expect(final.finalOutput).toBeNull();
	});

	it("reports successful overflow compaction without retry neutrally", async () => {
		const activityUpdates: string[] = [];
		let resolvePrompt!: () => void;
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		fakeSession.messages = [{ role: "assistant", content: [{ type: "text", text: "completed before compaction" }] }];
		fakeSession.prompt = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolvePrompt = resolve;
					subscriber?.({
						type: "message_end",
						message: {
							role: "assistant",
							stopReason: "stop",
							content: [{ type: "text", text: "completed before compaction" }],
							usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { total: 0 } },
						},
					});
					subscriber?.({
						type: "agent_end",
						messages: [{ role: "assistant", content: [{ type: "text", text: "completed before compaction" }] }],
					});
					subscriber?.({ type: "compaction_start", reason: "overflow" });
					setTimeout(() => {
						subscriber?.({ type: "compaction_end", reason: "overflow", aborted: false, willRetry: false });
					}, 120);
				}),
		);

		const handle = await dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "general-test", task: "recover" },
			},
			{
				agentDir: tmp,
				cwd: tmp,
				sessionId: "sess-neutral-overflow",
				parentAgentId: null,
				ctx: {
					modelRegistry: { find: vi.fn(() => ({ provider: "mock", id: "model" })) },
				} as never,
			},
			{
				onStateUpdate: (next) => {
					if (next.activity) activityUpdates.push(next.activity);
				},
			},
		);

		await vi.waitFor(() => expect(activityUpdates).toContain("recovering context overflow…"), { timeout: 1_000 });
		await vi.waitFor(() => expect(activityUpdates).toContain("context overflow compaction completed"), {
			timeout: 1_000,
		});
		expect(activityUpdates).not.toContain("context overflow recovery failed");
		resolvePrompt();
		const final = await handle.donePromise;

		expect(final.status).toBe("done");
		expect(final.stopReason).toBe("stop");
		expect(final.finalOutput).toBe("completed before compaction");
		expect(final.errorMessage).toBeNull();
	});

	it("preserves canonical overflow recovery error from compaction", async () => {
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		const canonicalError = "Context overflow recovery failed after 3 attempts: token budget exhausted.";
		fakeSession.messages = [];
		fakeSession.prompt = vi.fn(async () => {
			subscriber?.({ type: "compaction_start", reason: "overflow" });
			subscriber?.({
				type: "compaction_end",
				reason: "overflow",
				aborted: false,
				willRetry: false,
				errorMessage: canonicalError,
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
				sessionId: "sess-canonical-overflow-error",
				parentAgentId: null,
				ctx: {
					modelRegistry: { find: vi.fn(() => ({ provider: "mock", id: "model" })) },
				} as never,
			},
		);
		const final = await handle.donePromise;

		expect(final.status).toBe("failed");
		expect(final.stopReason).toBe("context_overflow_recovery_failed");
		expect(final.errorMessage).toBe(canonicalError);
		expect(final.finalOutput).toBeNull();
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
		if (_name === "compaction failure") {
			expect(final.errorMessage).toBe("Context overflow recovery failed: Compaction failed: compact failed");
		}
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

	it("finalizes session-mode max-turn hard aborts as aborted rather than failed", async () => {
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		fakeSession.prompt = vi.fn(async () => {
			subscriber?.({ type: "turn_end", message: { role: "assistant", stopReason: "toolUse" } });
			subscriber?.({ type: "turn_end", message: { role: "assistant", stopReason: "toolUse" } });
			subscriber?.({ type: "turn_end", message: { role: "assistant", stopReason: "toolUse" } });
		});

		const handle = await dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "general-test", task: "loop", maxTurns: 1 },
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

		expect(final.status).toBe("aborted");
		expect(final.errorMessage).toBe("maxTurns exceeded (1)");
	});

	it("reserves resume admission before an asynchronous preflight can admit overlap", async () => {
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		const ctx = {
			scopedModels: [],
			modelRegistry: { getProviderAuthStatus: () => ({ configured: true, source: "stored" }) },
		} as never;
		const handle = await dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "preflight-overlap", task: "initial" },
			},
			{ agentDir: tmp, cwd: tmp, sessionId: "preflight-overlap", parentAgentId: null, ctx },
		);
		await handle.donePromise;

		const preflight = deferred<Array<{ provider: string; id: string; reasoning: boolean }>>();
		childModelRuntime.getAvailable.mockImplementationOnce(() => preflight.promise);
		const accepted = handle.resume?.("accepted resume", undefined, ctx);
		await vi.waitFor(() => expect(childModelRuntime.getAvailable).toHaveBeenCalledTimes(2));

		let overlapError: unknown;
		try {
			handle.resume?.("overlapping resume", undefined, ctx);
		} catch (error) {
			overlapError = error;
		}
		expect(overlapError).toMatchObject({ message: expect.stringContaining("already running") });
		preflight.resolve([{ provider: "mock", id: "model", reasoning: true }]);
		await accepted;
		expect(fakeSession.prompt).toHaveBeenCalledTimes(2);
	});

	it("rejects an overlapping resume synchronously at the admission boundary", async () => {
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		const handle = await dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "general-test", task: "initial" },
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

		let settleResume!: () => void;
		fakeSession.prompt = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					settleResume = resolve;
				}),
		);
		const accepted = handle.resume?.("accepted resume");
		await vi.waitFor(() => expect(fakeSession.prompt).toHaveBeenCalledTimes(1));
		let synchronousError: unknown;
		let overlap: Promise<unknown> | undefined;
		try {
			overlap = handle.resume?.("overlapping resume");
		} catch (error) {
			synchronousError = error;
		}
		void overlap?.catch(() => undefined);

		settleResume();
		await accepted;
		expect(synchronousError).toMatchObject({ message: expect.stringContaining("already running") });
		expect(fakeSession.prompt).toHaveBeenCalledTimes(1);
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

	it("forwards supported max through the narrow session SDK boundary and persists effective provenance", async () => {
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		const handle = await dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "max" },
				options: { agent: "general-purpose", alias: "max-test", task: "say ok" },
			},
			{
				agentDir: tmp,
				cwd: tmp,
				sessionId: "sess-max",
				parentAgentId: null,
				ctx: { modelRegistry: { find: vi.fn(() => ({ provider: "mock", id: "model" })) } } as never,
			},
		);
		const final = await handle.donePromise;
		expect((createdSessionOptions as { thinkingLevel?: string }).thinkingLevel).toBe("max");
		expect(final.thinking).toBe("max");
		expect(final.thinkingAdjustment).toBeUndefined();
	});

	it("keeps exported low-level session dispatch and resume caller-owned despite excluding scopes", async () => {
		const [{ dispatch }, { dispatchSubagent }] = await Promise.all([
			import("../../src/runtime/lifecycle.js"),
			import("../../src/index.js"),
		]);
		expect(dispatchSubagent).toBe(dispatch);
		const modelRegistry = {
			getProviderAuthStatus: vi.fn(() => ({ configured: true, source: "stored" })),
		};
		const handle = await dispatchSubagent(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "low-level", task: "first" },
			},
			{
				agentDir: tmp,
				cwd: tmp,
				sessionId: "low-level",
				parentAgentId: null,
				executionMode: "session",
				ctx: {
					scopedModels: [{ model: { provider: "other", id: "model" } }],
					modelRegistry,
				} as never,
			},
		);
		expect((await handle.donePromise).status).toBe("done");
		const resumed = await handle.resume?.("second", undefined, {
			scopedModels: [{ model: { provider: "another", id: "model" } }],
			modelRegistry,
		} as never);
		expect(resumed?.status).toBe("done");
		expect(fakeSession.prompt).toHaveBeenCalledTimes(2);
	});

	it("uses public services/runtime auth APIs and forwards the current cancellation signal", async () => {
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		const controller = new AbortController();
		const getApiKeyForProvider = vi.fn(async () => "RUNTIME_SENTINEL");
		const handle = await dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "runtime-auth", task: "say ok" },
			},
			{
				agentDir: tmp,
				cwd: tmp,
				sessionId: "runtime-auth",
				parentAgentId: null,
				signal: controller.signal,
				ctx: {
					scopedModels: [],
					modelRegistry: {
						getProviderAuthStatus: vi.fn(() => ({ configured: true, source: "runtime" })),
						getApiKeyForProvider,
					},
				} as never,
			},
		);
		const final = await handle.donePromise;
		expect((createdServiceOptions as { modelRuntimeSignal?: AbortSignal }).modelRuntimeSignal).toBe(controller.signal);
		expect(getApiKeyForProvider).toHaveBeenCalledOnce();
		expect(childModelRuntime.setRuntimeApiKey).toHaveBeenCalledWith("mock", "RUNTIME_SENTINEL", {
			signal: controller.signal,
		});
		expect(JSON.stringify(final)).not.toContain("RUNTIME_SENTINEL");
		expect(readFileSync(final.paths.output, "utf-8")).not.toContain("RUNTIME_SENTINEL");
	});

	it.each(["stored", "environment", "fallback", "models_json_key", "models_json_command", undefined])(
		"never extracts or copies non-runtime auth source %s",
		async (source) => {
			const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
			const getApiKeyForProvider = vi.fn(async () => "DO_NOT_EXTRACT");
			const handle = await dispatchSession(
				{
					agent: fakeAgent,
					model: { provider: "mock", modelId: "model", thinking: "low" },
					options: { agent: "general-purpose", alias: `source-${source}`, task: "say ok" },
				},
				{
					agentDir: tmp,
					cwd: tmp,
					sessionId: `source-${source}`,
					parentAgentId: null,
					ctx: {
						scopedModels: [],
						modelRegistry: {
							getProviderAuthStatus: vi.fn(() => ({ configured: source !== undefined, source })),
							getApiKeyForProvider,
						},
					} as never,
				},
			);
			await handle.donePromise;
			expect(getApiKeyForProvider).not.toHaveBeenCalled();
			expect(childModelRuntime.setRuntimeApiKey).not.toHaveBeenCalled();
		},
	);

	it.each(["stored", "environment", "fallback", "models_json_key", "models_json_command", undefined])(
		"removes a prior runtime override before resume auth recheck for %s",
		async (nextSource) => {
			const ledger: string[] = [];
			childModelRuntime.setRuntimeApiKey.mockImplementation(async () => {
				ledger.push("set");
			});
			childModelRuntime.removeRuntimeApiKey.mockImplementation(async () => {
				ledger.push("remove");
			});
			childModelRuntime.getAvailable.mockImplementation(async (provider: string) => {
				ledger.push("available");
				return [{ provider, id: "model", reasoning: true }];
			});
			let source: string | undefined = "runtime";
			const getApiKeyForProvider = vi.fn(async () => "ROTATING_SENTINEL");
			const ctx = {
				scopedModels: [],
				modelRegistry: {
					getProviderAuthStatus: vi.fn(() => ({ configured: source !== undefined, source })),
					getApiKeyForProvider,
				},
			} as never;
			const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
			const handle = await dispatchSession(
				{
					agent: fakeAgent,
					model: { provider: "mock", modelId: "model", thinking: "low" },
					options: { agent: "general-purpose", alias: "transition", task: "first" },
				},
				{ agentDir: tmp, cwd: tmp, sessionId: `transition-${nextSource}`, parentAgentId: null, ctx },
			);
			await handle.donePromise;
			ledger.length = 0;
			source = nextSource;
			await handle.resume?.("next", undefined, ctx);
			expect(ledger.slice(0, 2)).toEqual(["remove", "available"]);
			expect(getApiKeyForProvider).toHaveBeenCalledTimes(1);
		},
	);

	it("removes a possibly committed runtime key after synchronization reports failure", async () => {
		const ledger: string[] = [];
		let source: string | undefined = "stored";
		const ctx = {
			scopedModels: [],
			modelRegistry: {
				getProviderAuthStatus: () => ({ configured: true, source }),
				getApiKeyForProvider: vi.fn(async () => "RUNTIME_SENTINEL"),
			},
		} as never;
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		const handle = await dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "partial-key-sync", task: "initial" },
			},
			{ agentDir: tmp, cwd: tmp, sessionId: "partial-key-sync", parentAgentId: null, ctx },
		);
		await handle.donePromise;

		source = "runtime";
		childModelRuntime.setRuntimeApiKey.mockImplementationOnce(async () => {
			ledger.push("set:committed");
			throw new Error("synchronization failed after commit");
		});
		await expect(handle.resume?.("failed rotation", undefined, ctx)).rejects.toThrow(
			"Runtime authentication reconciliation failed",
		);

		source = "stored";
		childModelRuntime.removeRuntimeApiKey.mockImplementationOnce(async () => {
			ledger.push("remove");
		});
		childModelRuntime.getAvailable.mockImplementationOnce(async (provider: string) => {
			ledger.push("available");
			return [{ provider, id: "model", reasoning: true }];
		});
		await handle.resume?.("non-runtime retry", undefined, ctx);

		expect(ledger).toEqual(["set:committed", "remove", "available"]);
		expect(fakeSession.prompt).toHaveBeenCalledTimes(2);
	});

	it("rotates runtime auth on every resume and blocks prompt when child auth becomes unavailable", async () => {
		let key = "RUNTIME_ONE";
		const getApiKeyForProvider = vi.fn(async () => key);
		const ctx = {
			scopedModels: [],
			modelRegistry: {
				getProviderAuthStatus: vi.fn(() => ({ configured: true, source: "runtime" })),
				getApiKeyForProvider,
			},
		} as never;
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		const handle = await dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "rotate", task: "first" },
			},
			{ agentDir: tmp, cwd: tmp, sessionId: "rotate", parentAgentId: null, ctx },
		);
		await handle.donePromise;
		key = "RUNTIME_TWO";
		childModelRuntime.getAvailable.mockResolvedValueOnce([]);
		await expect(handle.resume?.("blocked", undefined, ctx)).rejects.toThrow("authentication unavailable");
		expect(childModelRuntime.setRuntimeApiKey).toHaveBeenLastCalledWith("mock", "RUNTIME_TWO", {
			signal: undefined,
		});
		expect(getApiKeyForProvider).toHaveBeenCalledTimes(2);
		expect(fakeSession.prompt).toHaveBeenCalledTimes(1);
	});

	it("finalizes cancellation after resume running-state persistence resolves post-abort", async () => {
		const ledger: string[] = [];
		const ctx = {
			scopedModels: [],
			modelRegistry: { getProviderAuthStatus: () => ({ configured: true, source: "stored" }) },
		} as never;
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		const handle = await dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "cancel-resume-write", task: "initial" },
			},
			{ agentDir: tmp, cwd: tmp, sessionId: "cancel-resume-write", parentAgentId: null, ctx },
			{
				onStateUpdate: (next) => ledger.push(`update:${next.status}`),
				onEnd: (next) => ledger.push(`end:${next.status}`),
			},
		);
		await handle.donePromise;
		ledger.length = 0;

		const runningWrite = deferred<void>();
		writeStateInterceptor = async (next, write) => {
			if (next.task === "cancel during persistence" && next.status === "running") {
				ledger.push("write:running:start");
				await runningWrite.promise;
				await write(next);
				ledger.push("write:running:end");
				return;
			}
			if (next.task === "cancel during persistence" && next.status === "aborted") {
				ledger.push("write:aborted");
			}
			await write(next);
		};
		const controller = new AbortController();
		const resumed = handle.resume?.("cancel during persistence", controller.signal, ctx);
		await vi.waitFor(() => expect(ledger).toContain("write:running:start"));
		controller.abort();
		ledger.push("abort");
		runningWrite.resolve();

		const result = await resumed;
		expect(result?.status).toBe("aborted");
		expect(result?.errorMessage).toBe("Interrupted before sub-agent resume.");
		expect(fakeSession.prompt).toHaveBeenCalledTimes(1);
		expect(JSON.parse(readFileSync(result!.paths.state, "utf-8"))).toMatchObject({
			status: "aborted",
			task: "cancel during persistence",
		});
		expect(ledger).toEqual(["write:running:start", "abort", "write:running:end", "write:aborted", "end:aborted"]);
	});

	it("fences prompt startup after a signal-ignoring extension-bind barrier resolves post-abort", async () => {
		const ledger: string[] = [];
		let resolveBind!: () => void;
		fakeSession.bindExtensions = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					ledger.push("bind:start");
					resolveBind = resolve;
				}),
		);
		fakeSession.dispose = vi.fn(() => ledger.push("cleanup:dispose"));
		const controller = new AbortController();
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		const pending = dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "cancel-bind", task: "never prompt" },
			},
			{
				agentDir: tmp,
				cwd: tmp,
				sessionId: "cancel-bind",
				parentAgentId: null,
				signal: controller.signal,
				ctx: {
					scopedModels: [],
					modelRegistry: { getProviderAuthStatus: () => ({ configured: true, source: "stored" }) },
				} as never,
			},
		);
		while (!ledger.includes("bind:start")) await new Promise((resolve) => setTimeout(resolve, 0));
		controller.abort();
		ledger.push("abort");
		resolveBind();
		const handle = await pending;
		expect(handle.state.status).toBe("aborted");
		expect(fakeSession.prompt).not.toHaveBeenCalled();
		expect(ledger).toEqual(["bind:start", "abort", "cleanup:dispose"]);
	});

	it("fences post-service startup work when an ignoring deferred service resolves after abort", async () => {
		const sdk = await import("@earendil-works/pi-coding-agent");
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		let resolveServices!: (value: unknown) => void;
		const deferredServices = new Promise((resolve) => {
			resolveServices = resolve;
		});
		const serviceMock = vi.mocked(sdk.createAgentSessionServices);
		const serviceCallCount = serviceMock.mock.calls.length;
		serviceMock.mockImplementationOnce(async () => (await deferredServices) as never);
		const createSessionCount = vi.mocked(sdk.createAgentSessionFromServices).mock.calls.length;
		const controller = new AbortController();
		const pending = dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "cancel", task: "never prompt" },
			},
			{
				agentDir: tmp,
				cwd: tmp,
				sessionId: "cancel",
				parentAgentId: null,
				signal: controller.signal,
				ctx: { scopedModels: [], modelRegistry: {} } as never,
			},
		);
		while (serviceMock.mock.calls.length === serviceCallCount) {
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		controller.abort();
		resolveServices({
			cwd: tmp,
			agentDir: tmp,
			diagnostics: [],
			settingsManager: {},
			resourceLoader: {},
			modelRuntime: childModelRuntime,
		});
		const handle = await pending;
		expect(handle.state.status).toBe("aborted");
		expect(childModelRuntime.setRuntimeApiKey).not.toHaveBeenCalled();
		expect(childModelRuntime.getAvailable).not.toHaveBeenCalled();
		expect(vi.mocked(sdk.createAgentSessionFromServices).mock.calls).toHaveLength(createSessionCount);
		expect(fakeSession.prompt).not.toHaveBeenCalled();
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
