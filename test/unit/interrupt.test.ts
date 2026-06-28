import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { writeState } from "../../src/state/store.js";
import type { SubagentState } from "../../src/types.js";
import { openSubagentsOverlay } from "../../src/ui/overlay.js";
import { mountInterruptHandler } from "../../src/ui/interrupt.js";
import type { SubagentsPanel } from "../../src/ui/subagents-panel.js";

type TerminalHandler = (data: string) => { consume?: boolean } | undefined;

const theme = {
	bold: (s: string) => s,
	fg: (_token: string, s: string) => s,
};

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
	it("aborts active sub-agents in the current batch on double escape after a scoped warning", async () => {
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
		expect(notify).toHaveBeenCalledWith(
			"Press Escape again within 3s to abort 1 active sub-agent in current batch.",
			"warning",
		);
		expect(abortStates).not.toHaveBeenCalled();
		now += 1500;
		expect(handler?.("\x1b")).toEqual({ consume: true });
		await Promise.resolve();

		expect(abortStates).toHaveBeenCalledWith([current], "killed by double Escape");
	});

	it("loads fresh states for first Escape when watcher state is empty and warns before aborting", async () => {
		let handler: TerminalHandler | undefined;
		let now = 1000;
		const notify = vi.fn();
		const abortStates = vi.fn();
		const current = stateOf({ agentId: "fresh-current", batchId: "batch-new" });
		const old = stateOf({ agentId: "fresh-old", batchId: "batch-old" });
		const loadStates = vi.fn(async () => [current, old]);
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
			getBatchId: () => "batch-new",
			now: () => now,
			loadStates,
			abortStates,
		});

		expect(handler?.("\x1b")).toEqual({ consume: true });
		expect(loadStates).toHaveBeenCalledOnce();
		expect(abortStates).not.toHaveBeenCalled();
		await Promise.resolve();
		await Promise.resolve();

		expect(notify).toHaveBeenCalledWith(
			"Press Escape again within 3s to abort 1 active sub-agent in current batch.",
			"warning",
		);
		expect(abortStates).not.toHaveBeenCalled();
		now += 200;
		expect(handler?.("\x1b")).toEqual({ consume: true });
		await Promise.resolve();
		await Promise.resolve();

		expect(loadStates).toHaveBeenCalledTimes(2);
		expect(abortStates).toHaveBeenCalledWith([current], "killed by double Escape");
	});

	it("uses all-session fresh fallback for first Escape when empty watcher has no current-batch targets", async () => {
		let handler: TerminalHandler | undefined;
		let now = 1000;
		const notify = vi.fn();
		const abortStates = vi.fn();
		const old = stateOf({ agentId: "fresh-old", batchId: "batch-old" });
		const loadStates = vi.fn(async () => [old]);
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
			getBatchId: () => "batch-new",
			now: () => now,
			loadStates,
			abortStates,
		});

		expect(handler?.("\x1b")).toEqual({ consume: true });
		expect(loadStates).toHaveBeenCalledOnce();
		expect(abortStates).not.toHaveBeenCalled();
		await Promise.resolve();
		await Promise.resolve();

		expect(notify).toHaveBeenCalledWith(
			"Press Escape again within 3s to abort 1 active sub-agent in this session.",
			"warning",
		);
		now += 200;
		expect(handler?.("\x1b")).toEqual({ consume: true });
		await Promise.resolve();
		await Promise.resolve();

		expect(abortStates).toHaveBeenCalledWith([old], "killed by double Escape");
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

	it("warns and consumes single Escape for older, missing-batch, or unbatched active agents, then falls back to all active session agents", async () => {
		let handler: TerminalHandler | undefined;
		let now = 1000;
		const notify = vi.fn();
		const abortStates = vi.fn();
		const old = stateOf({ agentId: "old", batchId: "batch-old" });
		const missingBatch = stateOf({ agentId: "missing", batchId: undefined });
		const unbatched = stateOf({ agentId: "legacy", batchId: null });
		const controller = mountInterruptHandler({
			ctx: {
				ui: {
					notify,
					onTerminalInput: (registered: TerminalHandler) => {
						handler = registered;
						return vi.fn();
					},
				},
			} as never,
			getBatchId: () => "batch-new",
			now: () => now,
			abortStates,
			loadStates: async () => [old, missingBatch, unbatched],
		});
		controller.update([old, missingBatch, unbatched]);

		expect(handler?.("\x1b")).toEqual({ consume: true });
		expect(notify).toHaveBeenCalledWith(
			"Press Escape again within 3s to abort 3 active sub-agents in this session.",
			"warning",
		);
		now += 500;
		expect(handler?.("\x1b")).toEqual({ consume: true });
		await Promise.resolve();
		await Promise.resolve();

		expect(abortStates).toHaveBeenCalledWith([old, missingBatch, unbatched], "killed by double Escape");
	});

	it("uses all-active session warning and fallback when no current batch is known", async () => {
		let handler: TerminalHandler | undefined;
		let now = 1000;
		const notify = vi.fn();
		const abortStates = vi.fn();
		const active = stateOf({ agentId: "active", batchId: "batch-new" });
		const controller = mountInterruptHandler({
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
			now: () => now,
			abortStates,
			loadStates: async () => [active],
		});
		controller.update([active]);

		expect(handler?.("\x1b")).toEqual({ consume: true });
		expect(notify).toHaveBeenCalledWith(
			"Press Escape again within 3s to abort 1 active sub-agent in this session.",
			"warning",
		);
		now += 200;
		expect(handler?.("\x1b")).toEqual({ consume: true });
		await Promise.resolve();
		await Promise.resolve();

		expect(abortStates).toHaveBeenCalledWith([active], "killed by double Escape");
	});

	it("refreshes state once before double-Escape abort and narrows to current-batch agents when present", async () => {
		let handler: TerminalHandler | undefined;
		let now = 1000;
		const staleOld = stateOf({ agentId: "stale-old", batchId: "batch-old" });
		const freshCurrent = stateOf({ agentId: "fresh", batchId: "batch-new" });
		const freshOld = stateOf({ agentId: "fresh-old", batchId: "batch-old" });
		const loadStates = vi.fn(async () => [freshCurrent, freshOld]);
		const abortStates = vi.fn();
		const controller = mountInterruptHandler({
			ctx: {
				ui: {
					notify: vi.fn(),
					onTerminalInput: (registered: TerminalHandler) => {
						handler = registered;
						return vi.fn();
					},
				},
			} as never,
			getBatchId: () => "batch-new",
			now: () => now,
			loadStates,
			abortStates,
		});
		controller.update([staleOld]);

		expect(handler?.("\x1b")).toEqual({ consume: true });
		now += 200;
		expect(handler?.("\x1b")).toEqual({ consume: true });
		await Promise.resolve();
		await Promise.resolve();

		expect(loadStates).toHaveBeenCalledOnce();
		expect(abortStates).toHaveBeenCalledWith([freshCurrent], "killed by double Escape");
	});

	it("does not all-active fallback after a current-batch warning when no fresh current-batch targets remain", async () => {
		let handler: TerminalHandler | undefined;
		let now = 1000;
		const notify = vi.fn();
		const abortStates = vi.fn();
		const current = stateOf({ agentId: "current", batchId: "batch-new" });
		const old = stateOf({ agentId: "old", batchId: "batch-old" });
		const controller = mountInterruptHandler({
			ctx: {
				ui: {
					notify,
					onTerminalInput: (registered: TerminalHandler) => {
						handler = registered;
						return vi.fn();
					},
				},
			} as never,
			getBatchId: () => "batch-new",
			now: () => now,
			loadStates: async () => [old],
			abortStates,
		});
		controller.update([current, old]);

		expect(handler?.("\x1b")).toEqual({ consume: true });
		expect(notify).toHaveBeenCalledWith(
			"Press Escape again within 3s to abort 1 active sub-agent in current batch.",
			"warning",
		);
		now += 200;
		expect(handler?.("\x1b")).toEqual({ consume: true });
		await Promise.resolve();
		await Promise.resolve();

		expect(abortStates).not.toHaveBeenCalled();
	});

	it("ignores interrupt keys when no sub-agents are active", () => {
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
		controller.update([stateOf({ agentId: "done", status: "done", finishedAt: 1 })]);

		expect(handler?.("\x1b")).toBeUndefined();
		expect(abortStates).not.toHaveBeenCalled();
	});

	it("aborts active sub-agents in the current batch on ctrl+c without changing overlay close semantics", async () => {
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

	it("backgrounds active detach scopes on ctrl+b without changing existing notification text", () => {
		let handler: TerminalHandler | undefined;
		const detachAll = vi.fn();
		const notify = vi.fn();
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
			getBatchId: () => "batch-new",
			abortStates: vi.fn(),
			detach: { hasActiveScopes: () => true, detachAll } as never,
		});

		expect(handler?.("\x02")).toEqual({ consume: true });
		expect(detachAll).toHaveBeenCalledOnce();
		expect(notify).toHaveBeenCalledWith(
			"Sub-agents backgrounded — results will arrive via notification.",
			"info",
		);
	});

	it("lets overlay Escape close before ambient interrupt handling and does not arm double-Escape state", async () => {
		const tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-interrupt-overlay-"));
		try {
			const running = stateOf({ agentId: "current", alias: "current", batchId: "batch-new" });
			await writeSessionState(tmp, running);
			const mounted = createCustomHarness();
			const opening = openSubagentsOverlay(mounted.ctx, tmp, "sess", "batch-new", vi.fn());
			await mounted.ready;

			let handler: TerminalHandler | undefined;
			let now = 1000;
			const notify = vi.fn();
			const abortStates = vi.fn();
			const controller = mountInterruptHandler({
				ctx: {
					ui: {
						notify,
						onTerminalInput: (registered: TerminalHandler) => {
							handler = registered;
							return vi.fn();
						},
					},
				} as never,
				getBatchId: () => "batch-new",
				now: () => now,
				abortStates,
			});
			controller.update([running]);

			expect(handler?.("\x1b")).toBeUndefined();
			expect(notify).not.toHaveBeenCalled();
			expect(abortStates).not.toHaveBeenCalled();
			expect(mounted.component?.handleInput("\x1b")).toBe(true);
			await opening;

			now += 100;
			expect(handler?.("\x1b")).toEqual({ consume: true });
			expect(notify).toHaveBeenCalledWith(
				"Press Escape again within 3s to abort 1 active sub-agent in current batch.",
				"warning",
			);
			expect(abortStates).not.toHaveBeenCalled();
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
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

async function writeSessionState(agentDir: string, state: SubagentState): Promise<void> {
	const statePath = path.join(agentDir, "subagents", state.sessionId, state.agentId, "state.json");
	await writeState({
		...state,
		paths: {
			state: statePath,
			output: path.join(path.dirname(statePath), "output.jsonl"),
			stderr: path.join(path.dirname(statePath), "stderr.log"),
			prompt: path.join(path.dirname(statePath), "prompt.md"),
		},
	});
}

function createCustomHarness() {
	let resolveReady: () => void = () => undefined;
	const ready = new Promise<void>((resolve) => {
		resolveReady = resolve;
	});
	const harness: {
		component: SubagentsPanel | undefined;
		ctx: never;
		ready: Promise<void>;
	} = {
		component: undefined,
		ctx: undefined as never,
		ready,
	};
	const custom = vi.fn(
		(
			factory: (
				tui: { requestRender(): void },
				themeArg: typeof theme,
				keybindings: unknown,
				done: () => void,
			) => SubagentsPanel,
		) => {
			return new Promise<void>((resolve) => {
				harness.component = factory({ requestRender: () => undefined }, theme, {}, () => resolve());
				resolveReady();
			});
		},
	);
	harness.ctx = { ui: { custom, notify: vi.fn() } } as never;
	return harness;
}
