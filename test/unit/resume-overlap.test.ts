import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GLOBAL_SETTINGS, DEFAULT_TMUX_SETTINGS, type SubagentState } from "../../src/types.js";

const mocks = vi.hoisted(() => ({
	dispatch: vi.fn(),
	activeRelease: vi.fn(),
	configLoads: [] as Array<Promise<unknown>>,
}));

vi.mock("../../src/runtime/lifecycle.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/runtime/lifecycle.js")>();
	return { ...actual, dispatch: mocks.dispatch };
});

vi.mock("../../src/runtime/concurrency.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/runtime/concurrency.js")>();
	return {
		...actual,
		createActiveCounter(max: number) {
			const counter = actual.createActiveCounter(max);
			return {
				...counter,
				release() {
					mocks.activeRelease();
					counter.release();
				},
			};
		},
	};
});

vi.mock("../../src/config/store.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/config/store.js")>();
	return {
		...actual,
		loadConfig: vi.fn(() => {
			const pending = mocks.configLoads.shift();
			if (pending) return pending;
			return Promise.resolve(configResult());
		}),
	};
});

function configResult() {
	return {
		config: {
			version: 1 as const,
			agents: {
				"general-purpose": { provider: "mock", modelId: "model", thinking: "low" as const },
			},
			global: { ...DEFAULT_GLOBAL_SETTINGS, maxActive: 16, notifyOnCompletion: true },
			tmux: { ...DEFAULT_TMUX_SETTINGS, killOnComplete: "never" as const },
		},
		errors: [],
	};
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

const drain = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function stateOf(overrides: Partial<SubagentState> = {}): SubagentState {
	return {
		schemaVersion: 1,
		agentId: "resume-overlap-agent",
		parentAgentId: null,
		sessionId: "sess",
		agent: "general-purpose",
		alias: "worker",
		agentSource: "bundled",
		task: "initial",
		cwd: "/proj",
		branch: null,
		model: "model",
		provider: "mock",
		thinking: "low",
		executionMode: "session",
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
		turns: 1,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 },
		lastText: null,
		lastToolCall: null,
		activeTools: [],
		toolUses: 0,
		activity: "done",
		finalOutput: "done",
		paths: {
			state: "/missing/state.json",
			output: "/missing/output.jsonl",
			stderr: "/missing/stderr.log",
			prompt: "/missing/prompt.md",
		},
		...overrides,
	};
}

type ToolExecute = (
	id: string,
	params: Record<string, unknown>,
	signal?: AbortSignal,
	onUpdate?: unknown,
	ctx?: unknown,
) => Promise<unknown>;

describe("resume overlap integration", () => {
	let tmp: string;

	afterEach(() => {
		vi.useRealTimers();
		if (tmp) rmSync(tmp, { recursive: true, force: true });
	});

	it("delivers detached A once after overlapping B is rejected and releases both slots once", async () => {
		tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-resume-overlap-"));
		mocks.configLoads.length = 0;
		const resumeA = deferred<SubagentState>();
		let hooks: { onEnd?: (state: SubagentState) => void } = {};
		let running = false;
		const handle = {
			agentId: "resume-overlap-agent",
			state: stateOf(),
			donePromise: Promise.resolve(stateOf()),
			resume: vi.fn((task: string) => {
				if (running) throw new Error("already running");
				running = true;
				return resumeA.promise.then((state) => {
					running = false;
					hooks.onEnd?.(state);
					return state;
				});
			}),
		};
		mocks.dispatch.mockImplementation(async (_plan, _env, lifecycleHooks) => {
			hooks = lifecycleHooks;
			return handle;
		});
		mocks.activeRelease.mockClear();

		const tools = new Map<string, { execute: ToolExecute }>();
		const handlers = new Map<string, Array<(...args: never[]) => unknown>>();
		let terminalInput: ((data: string) => unknown) | undefined;
		const sendMessage = vi.fn();
		const pi = {
			registerTool: vi.fn((tool: { name: string; execute: ToolExecute }) => tools.set(tool.name, tool)),
			registerCommand: vi.fn(),
			registerMessageRenderer: vi.fn(),
			events: { emit: vi.fn() },
			sendMessage,
			getThinkingLevel: vi.fn(() => "low"),
			on: vi.fn((event: string, handler: (...args: never[]) => unknown) => {
				handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			}),
		};
		const ctx = {
			cwd: tmp,
			hasUI: false,
			model: { provider: "mock", id: "model" },
			scopedModels: [],
			modelRegistry: {
				find: vi.fn(() => ({ provider: "mock", id: "model", reasoning: true })),
				getAvailable: () => [{ provider: "mock", id: "model", reasoning: true }],
			},
			sessionManager: { getSessionFile: () => path.join(tmp, "sess.jsonl") },
			ui: {
				confirm: vi.fn(async () => true),
				notify: vi.fn(),
				setWidget: vi.fn(),
				setStatus: vi.fn(),
				onTerminalInput: vi.fn((handler: (data: string) => unknown) => {
					terminalInput = handler;
					return vi.fn();
				}),
			},
		};

		const { default: piCrew } = await import("../../src/index.js");
		piCrew(pi as never);
		await handlers.get("session_start")?.[0]?.({} as never, ctx as never);
		await tools
			.get("subagent_dispatch")
			?.execute("dispatch", { agent: "general-purpose", alias: "worker", task: "initial" }, undefined, undefined, ctx);
		await drain();
		mocks.activeRelease.mockClear();

		const priorConfig = deferred<unknown>();
		mocks.configLoads.push(priorConfig.promise);
		hooks.onEnd?.(stateOf({ task: "prior generation", finalOutput: "stale prior completion" }));
		await Promise.resolve();

		const acceptedA = tools
			.get("subagent_resume")
			?.execute("resume-a", { agent_id: handle.agentId, prompt: "accepted A" }, undefined, undefined, ctx);
		await Promise.resolve();
		terminalInput?.("\x02");
		const resultA = (await acceptedA) as { details: Record<string, unknown> };
		expect(resultA.details.status).toBe("backgrounded");

		const resultB = (await tools
			.get("subagent_resume")
			?.execute("resume-b", { agent_id: handle.agentId, prompt: "rejected B" }, undefined, undefined, ctx)) as {
			details: Record<string, unknown>;
		};
		expect(resultB.details.error).toBe("resume_unavailable");
		expect(mocks.activeRelease).toHaveBeenCalledOnce();

		resumeA.resolve(stateOf({ task: "accepted A", finalOutput: "A complete" }));
		await drain();
		priorConfig.resolve(configResult());
		await drain();
		await drain();
		expect(mocks.activeRelease).toHaveBeenCalledTimes(2);
		await handlers.get("session_shutdown")?.[0]?.();
		expect(sendMessage).toHaveBeenCalledOnce();

		const message = sendMessage.mock.calls[0]?.[0] as { details?: { states?: SubagentState[] } };
		expect(message.details?.states?.[0]?.finalOutput).toBe("A complete");
		expect(mocks.activeRelease).toHaveBeenCalledTimes(2);
	});
});
