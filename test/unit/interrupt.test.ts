import { describe, expect, it, vi } from "vitest";
import type { SubagentState } from "../../src/types.js";
import { mountInterruptHandler } from "../../src/ui/interrupt.js";

type TerminalHandler = (data: string) => { consume?: boolean } | undefined;

const stateOf = (overrides: Partial<SubagentState>): SubagentState => ({
	schemaVersion: 1,
	agentId: "abc12345",
	parentAgentId: null,
	sessionId: "sess",
	batchId: "batch-new",
	agent: "general-purpose",
	alias: "worker",
	agentSource: "bundled",
	task: "work",
	cwd: "/tmp",
	branch: null,
	model: "gpt-5.4-mini",
	provider: "openai-codex",
	thinking: "low",
	tools: null,
	maxTurns: null,
	pid: null,
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

describe("mountInterruptHandler", () => {
	it("aborts active sub-agents in the current batch on double escape", async () => {
		let handler: TerminalHandler | undefined;
		let now = 1000;
		const unsubscribe = vi.fn();
		const notify = vi.fn();
		const abortStates = vi.fn();
		const controller = mountInterruptHandler({
			ctx: {
				ui: {
					notify,
					onTerminalInput: (registered: TerminalHandler) => {
						handler = registered;
						return unsubscribe;
					},
				},
			} as never,
			getBatchId: () => "batch-new",
			now: () => now,
			abortStates,
		});
		const current = stateOf({ agentId: "current", batchId: "batch-new" });
		const old = stateOf({ agentId: "old", batchId: "batch-old" });
		controller.update([current, old, stateOf({ agentId: "done", status: "done", finishedAt: 1 })]);

		expect(handler?.("\x1b")).toEqual({ consume: true });
		expect(notify).toHaveBeenCalledWith("Press Escape again within 3s to abort active sub-agents.", "warning");
		expect(abortStates).not.toHaveBeenCalled();
		now += 1500;
		expect(handler?.("\x1b")).toEqual({ consume: true });
		await Promise.resolve();

		expect(abortStates).toHaveBeenCalledWith([current], "killed by double Escape");
	});

	it("does not abort when the second escape is outside the timeout", async () => {
		let handler: TerminalHandler | undefined;
		let now = 1000;
		const abortStates = vi.fn();
		const controller = mountInterruptHandler({
			ctx: {
				ui: {
					onTerminalInput: (registered: TerminalHandler) => {
						handler = registered;
						return vi.fn();
					},
				},
			} as never,
			getBatchId: () => "batch-new",
			now: () => now,
			doubleEscapeMs: 1000,
			abortStates,
		});
		controller.update([stateOf({ agentId: "current", batchId: "batch-new" })]);

		expect(handler?.("\x1b")).toEqual({ consume: true });
		now += 1500;
		expect(handler?.("\x1b")).toEqual({ consume: true });
		await Promise.resolve();

		expect(abortStates).not.toHaveBeenCalled();
	});

	it("aborts active sub-agents in the current batch on ctrl+c", async () => {
		let handler: TerminalHandler | undefined;
		const abortStates = vi.fn();
		const controller = mountInterruptHandler({
			ctx: {
				ui: {
					onTerminalInput: (registered: TerminalHandler) => {
						handler = registered;
						return vi.fn();
					},
				},
			} as never,
			getBatchId: () => "batch-new",
			abortStates,
		});
		const current = stateOf({ agentId: "current", batchId: "batch-new" });
		controller.update([current]);

		expect(handler?.("\x03")).toEqual({ consume: true });
		await Promise.resolve();
		expect(abortStates).toHaveBeenCalledWith([current], "killed by Ctrl+C");
	});

	it("uses a fresh state snapshot when aborting", async () => {
		let handler: TerminalHandler | undefined;
		let now = 1000;
		const stale = stateOf({ agentId: "stale", batchId: "batch-new" });
		const fresh = stateOf({ agentId: "fresh", batchId: "batch-new" });
		const old = stateOf({ agentId: "old", batchId: "batch-old" });
		const abortStates = vi.fn();
		const controller = mountInterruptHandler({
			ctx: {
				ui: {
					onTerminalInput: (registered: TerminalHandler) => {
						handler = registered;
						return vi.fn();
					},
				},
			} as never,
			getBatchId: () => "batch-new",
			now: () => now,
			loadStates: async () => [stale, fresh, old],
			abortStates,
		});
		controller.update([stale]);

		expect(handler?.("\x1b")).toEqual({ consume: true });
		now += 200;
		expect(handler?.("\x1b")).toEqual({ consume: true });
		await Promise.resolve();
		await Promise.resolve();

		expect(abortStates).toHaveBeenCalledWith([stale, fresh], "killed by double Escape");
	});

	it("ignores interrupt keys when no current-batch sub-agents are active", () => {
		let handler: TerminalHandler | undefined;
		const abortStates = vi.fn();
		const controller = mountInterruptHandler({
			ctx: {
				ui: {
					onTerminalInput: (registered: TerminalHandler) => {
						handler = registered;
						return vi.fn();
					},
				},
			} as never,
			getBatchId: () => "batch-new",
			abortStates,
		});
		controller.update([stateOf({ agentId: "old", batchId: "batch-old" })]);

		expect(handler?.("\x1b")).toBeUndefined();
		expect(abortStates).not.toHaveBeenCalled();
	});

	it("unsubscribes on stop", () => {
		const unsubscribe = vi.fn();
		const controller = mountInterruptHandler({
			ctx: {
				ui: {
					onTerminalInput: () => unsubscribe,
				},
			} as never,
			getBatchId: () => "batch-new",
			abortStates: vi.fn(),
		});

		controller.stop();

		expect(unsubscribe).toHaveBeenCalledOnce();
	});
});
