// test/unit/detach.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCompletionDispatcher } from "../../src/notify/batcher.js";
import { createActiveCounter } from "../../src/runtime/concurrency.js";
import { createDetachController } from "../../src/runtime/detach.js";
import { registerRunTool } from "../../src/tools/run.js";
import {
	DEFAULT_GLOBAL_SETTINGS,
	DEFAULT_TMUX_SETTINGS,
	type PiCrewConfig,
	type SubagentState,
} from "../../src/types.js";
import { mountInterruptHandler } from "../../src/ui/interrupt.js";

// ─── vi.hoisted mock for lifecycle dispatch ───────────────────────────────────

const mocks = vi.hoisted(() => ({
	dispatch: vi.fn(),
}));

vi.mock("../../src/runtime/lifecycle.js", () => ({
	dispatch: mocks.dispatch,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a promise that you can resolve/reject from outside. */
function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Drain all pending microtasks then execute one more round-trip. */
const drain = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const config: PiCrewConfig = {
	version: 1,
	agents: {
		"general-purpose": { provider: "openai-codex", modelId: "gpt-5.4-mini", thinking: "low" },
	},
	global: { ...DEFAULT_GLOBAL_SETTINGS },
	tmux: DEFAULT_TMUX_SETTINGS,
};

function stateOf(overrides: Partial<SubagentState> = {}): SubagentState {
	return {
		schemaVersion: 1,
		agentId: "agent-abc123",
		parentAgentId: null,
		sessionId: "sess",
		agent: "general-purpose",
		alias: "worker",
		agentSource: "bundled",
		task: "do work",
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
		turns: 2,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 },
		lastText: null,
		lastToolCall: null,
		finalOutput: "task done",
		paths: {
			state: "/p/state.json",
			output: "/p/output.jsonl",
			stderr: "/p/stderr.log",
			prompt: "/p/prompt.md",
		},
		...overrides,
	};
}

function writeAgent(dir: string, name: string): void {
	writeFileSync(
		path.join(dir, `${name}.md`),
		["---", `name: ${name}`, `description: ${name} agent`, "---", "", "body", ""].join("\n"),
	);
}

type ToolExecute = (
	id: string,
	params: Record<string, unknown>,
	signal?: AbortSignal,
	onUpdate?: unknown,
	ctx?: unknown,
) => Promise<unknown>;

function makeRuntime(userAgentsDir: string, bundledAgentsDir: string) {
	const release = vi.fn();
	const consumeCompletion = vi.fn();
	const detach = createDetachController();
	return {
		rt: {
			userAgentsDir,
			bundledAgentsDir,
			getConfig: vi.fn(async () => config),
			ensureProjectAgentApproved: vi.fn(async () => true),
			envFor: vi.fn(() => ({})),
			lifecycleHooks: vi.fn(() => ({})),
			trackHandle: vi.fn(),
			trackParentAbort: vi.fn(),
			consumeCompletion,
			concurrency: {
				active: { tryAcquire: vi.fn(() => true), release, current: vi.fn(() => 0) },
				pool: { run: (fn: () => unknown) => fn() },
			},
			detach,
		},
		release,
		consumeCompletion,
		detach,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 1: DetachController unit tests (pure, no mocking)
// ─────────────────────────────────────────────────────────────────────────────

describe("DetachController", () => {
	it("createScope() returns a scope with detached promise, resolve(), and dispose()", () => {
		const ctrl = createDetachController();
		const scope = ctrl.createScope();
		expect(scope).toHaveProperty("detached");
		expect(scope.detached).toBeInstanceOf(Promise);
		expect(typeof scope.resolve).toBe("function");
		expect(typeof scope.dispose).toBe("function");
	});

	it("hasActiveScopes() is false initially, true after createScope(), false after dispose()", () => {
		const ctrl = createDetachController();
		expect(ctrl.hasActiveScopes()).toBe(false);

		const scope = ctrl.createScope();
		expect(ctrl.hasActiveScopes()).toBe(true);

		scope.dispose();
		expect(ctrl.hasActiveScopes()).toBe(false);
	});

	it("detachAll() resolves all active scopes' detached promises", async () => {
		const ctrl = createDetachController();
		const s1 = ctrl.createScope();
		const s2 = ctrl.createScope();

		let resolved1 = false;
		let resolved2 = false;
		void s1.detached.then(() => {
			resolved1 = true;
		});
		void s2.detached.then(() => {
			resolved2 = true;
		});

		ctrl.detachAll();
		await Promise.resolve();
		await Promise.resolve();

		expect(resolved1).toBe(true);
		expect(resolved2).toBe(true);
	});

	it("detachAll() is a no-op when no scopes are active", () => {
		const ctrl = createDetachController();
		expect(() => ctrl.detachAll()).not.toThrow();
		expect(ctrl.hasActiveScopes()).toBe(false);
	});

	it("dispose() removes scope without resolving its promise", async () => {
		const ctrl = createDetachController();
		const scope = ctrl.createScope();

		let resolved = false;
		void scope.detached.then(() => {
			resolved = true;
		});

		scope.dispose();
		await Promise.resolve();
		await Promise.resolve();

		expect(ctrl.hasActiveScopes()).toBe(false);
		expect(resolved).toBe(false);
	});

	it("multiple scopes: detachAll() resolves all, dispose() only removes one", async () => {
		const ctrl = createDetachController();
		const s1 = ctrl.createScope();
		const s2 = ctrl.createScope();
		const s3 = ctrl.createScope();

		// Dispose only s2
		s2.dispose();
		expect(ctrl.hasActiveScopes()).toBe(true); // s1 and s3 still active

		let resolved1 = false;
		let resolved3 = false;
		void s1.detached.then(() => {
			resolved1 = true;
		});
		void s3.detached.then(() => {
			resolved3 = true;
		});

		ctrl.detachAll();
		await Promise.resolve();
		await Promise.resolve();

		expect(resolved1).toBe(true);
		expect(resolved3).toBe(true);
		expect(ctrl.hasActiveScopes()).toBe(false);
	});

	it("scope.resolve() removes it from the controller and resolves its promise", async () => {
		const ctrl = createDetachController();
		const scope = ctrl.createScope();

		let resolved = false;
		void scope.detached.then(() => {
			resolved = true;
		});

		scope.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(ctrl.hasActiveScopes()).toBe(false);
		expect(resolved).toBe(true);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 2: Interrupt handler Ctrl+B tests
// ─────────────────────────────────────────────────────────────────────────────

type TerminalHandler = (data: string) => { consume?: boolean } | undefined;

describe("mountInterruptHandler — Ctrl+B", () => {
	it("Ctrl+B is consumed and calls detachAll() when active scopes exist", () => {
		let handler: TerminalHandler | undefined;
		const detach = createDetachController();
		detach.createScope(); // register one active scope

		mountInterruptHandler({
			ctx: {
				ui: {
					notify: vi.fn(),
					onTerminalInput: (registered: TerminalHandler) => {
						handler = registered;
						return vi.fn();
					},
				},
			} as never,
			getBatchId: () => null,
			abortStates: vi.fn(),
			detach,
		});

		const result = handler?.("\x02"); // Ctrl+B
		expect(result).toEqual({ consume: true });
		// detachAll() cleared the scopes
		expect(detach.hasActiveScopes()).toBe(false);
	});

	it("Ctrl+B passes through (returns undefined) when no active scopes", () => {
		let handler: TerminalHandler | undefined;
		const detach = createDetachController();
		// No scopes registered

		mountInterruptHandler({
			ctx: {
				ui: {
					notify: vi.fn(),
					onTerminalInput: (registered: TerminalHandler) => {
						handler = registered;
						return vi.fn();
					},
				},
			} as never,
			getBatchId: () => null,
			abortStates: vi.fn(),
			detach,
		});

		const result = handler?.("\x02"); // Ctrl+B
		expect(result).toBeUndefined();
	});

	it("Ctrl+B shows a notification via ctx.ui.notify when scopes are active", () => {
		let handler: TerminalHandler | undefined;
		const notify = vi.fn();
		const detach = createDetachController();
		detach.createScope();

		mountInterruptHandler({
			ctx: {
				ui: {
					notify,
					onTerminalInput: (registered: TerminalHandler) => {
						handler = registered;
						return vi.fn();
					},
				},
			} as never,
			getBatchId: () => null,
			abortStates: vi.fn(),
			detach,
		});

		handler?.("\x02"); // Ctrl+B
		expect(notify).toHaveBeenCalledWith(expect.any(String), "info");
	});

	it("Ctrl+B does NOT trigger detachAll() when no active scopes (no side effects)", () => {
		let handler: TerminalHandler | undefined;
		const notify = vi.fn();
		const detach = createDetachController();

		const detachAllSpy = vi.spyOn(detach, "detachAll");

		mountInterruptHandler({
			ctx: {
				ui: {
					notify,
					onTerminalInput: (registered: TerminalHandler) => {
						handler = registered;
						return vi.fn();
					},
				},
			} as never,
			getBatchId: () => null,
			abortStates: vi.fn(),
			detach,
		});

		handler?.("\x02"); // Ctrl+B with no scopes
		expect(detachAllSpy).not.toHaveBeenCalled();
		expect(notify).not.toHaveBeenCalled();
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 3: Concurrency tracking with detach
// ─────────────────────────────────────────────────────────────────────────────

describe("Concurrency tracking with detach", () => {
	let tmp: string;
	let userAgentsDir: string;
	let bundledAgentsDir: string;

	beforeEach(() => {
		tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-detach-"));
		userAgentsDir = path.join(tmp, "user-agents");
		bundledAgentsDir = path.join(tmp, "bundled-agents");
		mkdirSync(userAgentsDir, { recursive: true });
		mkdirSync(bundledAgentsDir, { recursive: true });
		writeAgent(bundledAgentsDir, "general-purpose");
		mocks.dispatch.mockReset();
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("subagent_run single mode: active slot deferred until donePromise settles", async () => {
		const finalState = stateOf();
		const doneDef = deferred<SubagentState>();

		mocks.dispatch.mockResolvedValue({
			agentId: finalState.agentId,
			state: finalState,
			donePromise: doneDef.promise,
		});

		const { rt, release, detach } = makeRuntime(userAgentsDir, bundledAgentsDir);
		const tools = new Map<string, { execute: ToolExecute }>();
		const pi = { registerTool: vi.fn((tool: { name: string; execute: ToolExecute }) => tools.set(tool.name, tool)) };

		registerRunTool(pi as never, rt as never);

		const toolPromise = tools.get("subagent_run")?.execute(
			"call",
			{ agent: "general-purpose", alias: "worker", task: "do work" },
			undefined,
			undefined,
			{ cwd: tmp },
		);

		await drain();
		detach.detachAll();

		const result = (await toolPromise) as { details: { status: string } };
		expect(result.details.status).toBe("backgrounded");
		expect(release).not.toHaveBeenCalled();

		// Sub-agent finishes
		doneDef.resolve(finalState);
		await drain();

		expect(release).toHaveBeenCalledOnce();
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 4: CompletionDispatcher with detach
// ─────────────────────────────────────────────────────────────────────────────

describe("CompletionDispatcher with detach", () => {
	let tmp: string;
	let userAgentsDir: string;
	let bundledAgentsDir: string;

	beforeEach(() => {
		vi.useFakeTimers();
		tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-detach-dispatcher-"));
		userAgentsDir = path.join(tmp, "user-agents");
		bundledAgentsDir = path.join(tmp, "bundled-agents");
		mkdirSync(userAgentsDir, { recursive: true });
		mkdirSync(bundledAgentsDir, { recursive: true });
		writeAgent(bundledAgentsDir, "general-purpose");
		mocks.dispatch.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
		rmSync(tmp, { recursive: true, force: true });
	});

	it("push() delivers a notification when consume() was never called (detach path)", () => {
		const sendMessage = vi.fn();
		const dispatcher = createCompletionDispatcher({ sendMessage } as never);

		const finalState = stateOf({ agentId: "detached-agent-xyz" });

		// Simulate what happens at sub-agent completion when detached:
		// the lifecycle hook calls dispatcher.push(), but consumeCompletion() was never called
		dispatcher.push(finalState);
		vi.runAllTimers();

		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ customType: "pi-crew", display: true }),
			{ deliverAs: "followUp", triggerTurn: true },
		);
		expect(dispatcher.wasHandled("detached-agent-xyz")).toBe(true);
	});

	it("push() does NOT deliver a notification when consume() was called first (normal foreground path)", () => {
		const sendMessage = vi.fn();
		const dispatcher = createCompletionDispatcher({ sendMessage } as never);

		const finalState = stateOf({ agentId: "foreground-agent-xyz" });

		// Normal foreground path: consumeCompletion() is called, then push() is called by lifecycle
		dispatcher.consume("foreground-agent-xyz");
		dispatcher.push(finalState);
		vi.runAllTimers();

		// Notification should NOT have been sent
		expect(sendMessage).not.toHaveBeenCalled();
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 5: subagent_run tool detach across modes
// ─────────────────────────────────────────────────────────────────────────────

describe("subagent_run — detach across modes", () => {
	let tmp: string;
	let userAgentsDir: string;
	let bundledAgentsDir: string;

	beforeEach(() => {
		tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-run-detach-"));
		userAgentsDir = path.join(tmp, "user-agents");
		bundledAgentsDir = path.join(tmp, "bundled-agents");
		mkdirSync(userAgentsDir, { recursive: true });
		mkdirSync(bundledAgentsDir, { recursive: true });
		writeAgent(bundledAgentsDir, "general-purpose");
		mocks.dispatch.mockReset();
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("single mode: returns backgrounded result when detach fires", async () => {
		const finalState = stateOf({ agentId: "run-single-001" });
		const doneDef = deferred<SubagentState>();

		mocks.dispatch.mockResolvedValue({
			agentId: finalState.agentId,
			state: finalState,
			donePromise: doneDef.promise,
		});

		const { rt, detach } = makeRuntime(userAgentsDir, bundledAgentsDir);
		const tools = new Map<string, { execute: ToolExecute }>();
		const pi = { registerTool: vi.fn((tool: { name: string; execute: ToolExecute }) => tools.set(tool.name, tool)) };

		registerRunTool(pi as never, rt as never);

		const toolPromise = tools.get("subagent_run")?.execute(
			"call",
			{ agent: "general-purpose", alias: "worker", task: "do work" },
			undefined,
			undefined,
			{ cwd: tmp },
		);

		await drain();
		detach.detachAll();

		const result = (await toolPromise) as {
			content: Array<{ text: string }>;
			details: { status: string; agentId: string };
		};

		expect(result.details.status).toBe("backgrounded");
		expect(result.details.agentId).toBe("run-single-001");
		expect(result.content[0]?.text).toContain("moved to background");

		doneDef.resolve(finalState);
	});

	it("tasks mode: returns mixed completed + backgrounded results when detach fires mid-batch", async () => {
		// Task 0 completes immediately; Task 1 is still in-flight when detach fires.
		const state0 = stateOf({ agentId: "run-tasks-000", alias: "task-0", finalOutput: "output-0" });
		const state1 = stateOf({ agentId: "run-tasks-001", alias: "task-1" });
		const doneDef1 = deferred<SubagentState>();

		let callCount = 0;
		mocks.dispatch.mockImplementation(async () => {
			const n = callCount++;
			if (n === 0) {
				return { agentId: state0.agentId, state: state0, donePromise: Promise.resolve(state0) };
			}
			return { agentId: state1.agentId, state: state1, donePromise: doneDef1.promise };
		});

		const { rt, detach } = makeRuntime(userAgentsDir, bundledAgentsDir);
		const tools = new Map<string, { execute: ToolExecute }>();
		const pi = { registerTool: vi.fn((tool: { name: string; execute: ToolExecute }) => tools.set(tool.name, tool)) };

		registerRunTool(pi as never, rt as never);

		const toolPromise = tools.get("subagent_run")?.execute(
			"call",
			{
				tasks: [
					{ agent: "general-purpose", alias: "task-0", task: "first task" },
					{ agent: "general-purpose", alias: "task-1", task: "second task" },
				],
			},
			undefined,
			undefined,
			{ cwd: tmp },
		);

		await drain();
		detach.detachAll();

		const result = (await toolPromise) as {
			content: Array<{ text: string }>;
			details: {
				results: Array<{ agentId: string; status: string }>;
				backgrounded?: Array<{ agentId: string; status: string }>;
				partial?: boolean;
			};
		};

		// One completed, one backgrounded
		expect(result.details.results).toHaveLength(1);
		expect(result.details.results[0]?.agentId).toBe("run-tasks-000");
		expect(result.details.results[0]?.status).toBe("done");

		expect(result.details.backgrounded).toHaveLength(1);
		expect(result.details.backgrounded?.[0]?.agentId).toBe("run-tasks-001");
		expect(result.details.backgrounded?.[0]?.status).toBe("backgrounded");

		expect(result.details.partial).toBe(true);

		doneDef1.resolve(state1);
	});

	it("chain mode: detaches current step and abandons remaining steps", async () => {
		// Step 0 completes immediately; Step 1 is running and gets detached; Step 2 is abandoned.
		const state0 = stateOf({ agentId: "run-chain-000", alias: "step-0", finalOutput: "step-0-output" });
		const state1 = stateOf({ agentId: "run-chain-001", alias: "step-1" });
		const doneDef1 = deferred<SubagentState>();

		let callCount = 0;
		mocks.dispatch.mockImplementation(async () => {
			const n = callCount++;
			if (n === 0) {
				return { agentId: state0.agentId, state: state0, donePromise: Promise.resolve(state0) };
			}
			return { agentId: state1.agentId, state: state1, donePromise: doneDef1.promise };
		});

		const { rt, detach } = makeRuntime(userAgentsDir, bundledAgentsDir);
		const tools = new Map<string, { execute: ToolExecute }>();
		const pi = { registerTool: vi.fn((tool: { name: string; execute: ToolExecute }) => tools.set(tool.name, tool)) };

		registerRunTool(pi as never, rt as never);

		const toolPromise = tools.get("subagent_run")?.execute(
			"call",
			{
				chain: [
					{ agent: "general-purpose", alias: "step-0", task: "first step" },
					{ agent: "general-purpose", alias: "step-1", task: "second step, prev: {previous}" },
					{ agent: "general-purpose", alias: "step-2", task: "third step" },
				],
			},
			undefined,
			undefined,
			{ cwd: tmp },
		);

		// Wait for step-0 to complete and step-1 to start, then trigger detach
		await drain();
		detach.detachAll();

		const result = (await toolPromise) as {
			content: Array<{ text: string }>;
			details: {
				results: Array<{ agentId: string; status: string }>;
				backgrounded?: Array<{ agentId: string; status: string }>;
				abandoned?: string[];
				partial?: boolean;
			};
		};

		// Step-0 completed normally
		expect(result.details.results).toHaveLength(1);
		expect(result.details.results[0]?.agentId).toBe("run-chain-000");

		// Step-1 was backgrounded
		expect(result.details.backgrounded).toHaveLength(1);
		expect(result.details.backgrounded?.[0]?.agentId).toBe("run-chain-001");
		expect(result.details.backgrounded?.[0]?.status).toBe("backgrounded");

		// Step-2 was abandoned
		expect(result.details.abandoned).toEqual(["step-2"]);

		expect(result.details.partial).toBe(true);

		doneDef1.resolve(state1);
	});
});
