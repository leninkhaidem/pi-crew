import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { listStates, writeState } from "../../src/state/store.js";
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

	it("consumes an empty-watcher Escape, warns asynchronously when refresh finds current-batch active agents, then aborts on the next Escape", async () => {
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
			hasActiveSubagentWork: () => true,
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

		now += 200;
		expect(handler?.("\x1b")).toEqual({ consume: true });
		await Promise.resolve();
		await Promise.resolve();

		expect(loadStates).toHaveBeenCalledTimes(2);
		expect(abortStates).toHaveBeenCalledWith([current], "killed by double Escape");
	});

	it("consumes an empty-watcher Escape, warns asynchronously with all-session scope when refresh finds only older active agents, then aborts on the next Escape", async () => {
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
			hasActiveSubagentWork: () => true,
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

		expect(loadStates).toHaveBeenCalledTimes(2);
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

	it("does not abort stale fallback agents after a warning when a fresh load succeeds with no active targets", async () => {
		const cases: Array<{
			name: string;
			batchId: string;
			staleState: SubagentState;
			freshStates: SubagentState[];
			expectedWarning: string;
		}> = [
			{
				name: "current-batch empty fresh state",
				batchId: "batch-new",
				staleState: stateOf({ agentId: "stale-current-empty", batchId: "batch-new" }),
				freshStates: [],
				expectedWarning: "Press Escape again within 3s to abort 1 active sub-agent in current batch.",
			},
			{
				name: "all-session empty fresh state",
				batchId: "batch-new",
				staleState: stateOf({ agentId: "stale-old-empty", batchId: "batch-old" }),
				freshStates: [],
				expectedWarning: "Press Escape again within 3s to abort 1 active sub-agent in this session.",
			},
			{
				name: "current-batch terminal-only fresh state",
				batchId: "batch-new",
				staleState: stateOf({ agentId: "stale-current-terminal", batchId: "batch-new" }),
				freshStates: [stateOf({ agentId: "fresh-done", status: "done", finishedAt: 2, exitCode: 0 })],
				expectedWarning: "Press Escape again within 3s to abort 1 active sub-agent in current batch.",
			},
		];

		for (const testCase of cases) {
			let handler: TerminalHandler | undefined;
			let now = 1000;
			const notify = vi.fn();
			const abortStates = vi.fn();
			const loadStates = vi.fn(async () => testCase.freshStates);
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
				getBatchId: () => testCase.batchId,
				now: () => now,
				loadStates,
				abortStates,
			});
			controller.update([testCase.staleState]);

			expect(handler?.("\x1b")).toEqual({ consume: true });
			expect(notify).toHaveBeenCalledWith(testCase.expectedWarning, "warning");
			now += 200;
			expect(handler?.("\x1b")).toEqual({ consume: true });
			await Promise.resolve();
			await Promise.resolve();

			expect(loadStates).toHaveBeenCalledOnce();
			expect(abortStates, testCase.name).not.toHaveBeenCalled();
			controller.stop();
		}
	});

	it("passes through empty-watcher Escapes when no active sub-agent work is known", async () => {
		for (const setupTerminalState of [false, true]) {
			const tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-interrupt-empty-"));
			try {
				if (setupTerminalState) {
					await writeSessionState(
						tmp,
						stateOf({ agentId: "done", status: "done", finishedAt: 2, exitCode: 0 }),
					);
				}
				let handler: TerminalHandler | undefined;
				const notify = vi.fn();
				const abortStates = vi.fn();
				const sessionDir = path.join(tmp, "subagents", "sess");
				const loadStates = vi.fn(() => listStates(sessionDir, { includeDetached: true }));
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
					loadStates,
					abortStates,
				});

				expect(handler?.("\x1b")).toBeUndefined();
				expect(loadStates).toHaveBeenCalledOnce();
				expect(handler?.("\x1b")).toBeUndefined();
				expect(loadStates).toHaveBeenCalledOnce();
				await loadStates.mock.results[0]?.value;
				await Promise.resolve();
				await Promise.resolve();

				expect(notify).not.toHaveBeenCalled();
				expect(abortStates).not.toHaveBeenCalled();
				expect(handler?.("\x1b")).toBeUndefined();
				expect(loadStates).toHaveBeenCalledTimes(2);
				await loadStates.mock.results[1]?.value;
				await Promise.resolve();
				await Promise.resolve();
				expect(notify).not.toHaveBeenCalled();
				expect(abortStates).not.toHaveBeenCalled();
			} finally {
				rmSync(tmp, { recursive: true, force: true });
			}
		}
	});

	it("revalidates after a no-active refresh and warns/aborts if later refresh finds active agents", async () => {
		const current = stateOf({ agentId: "fresh-current", batchId: "batch-new" });
		const old = stateOf({ agentId: "fresh-old", batchId: "batch-old" });
		const cases: Array<{
			name: string;
			freshActive: SubagentState[];
			expectedWarning: string;
			expectedAbortTargets: SubagentState[];
		}> = [
			{
				name: "current-batch active after confirmation",
				freshActive: [current, old],
				expectedWarning: "Press Escape again within 3s to abort 1 active sub-agent in current batch.",
				expectedAbortTargets: [current],
			},
			{
				name: "all-session active after confirmation",
				freshActive: [old],
				expectedWarning: "Press Escape again within 3s to abort 1 active sub-agent in this session.",
				expectedAbortTargets: [old],
			},
		];

		for (const testCase of cases) {
			let handler: TerminalHandler | undefined;
			let now = 1000;
			const notify = vi.fn();
			const abortStates = vi.fn();
			const loadResults: SubagentState[][] = [[], testCase.freshActive, testCase.freshActive];
			const loadStates = vi.fn(async () => loadResults.shift() ?? testCase.freshActive);
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
				loadStates,
				hasActiveSubagentWork: () => true,
				abortStates,
			});

			expect(handler?.("\x1b")).toEqual({ consume: true });
			expect(loadStates).toHaveBeenCalledOnce();
			await Promise.resolve();
			await Promise.resolve();
			expect(notify, testCase.name).not.toHaveBeenCalled();
			expect(abortStates, testCase.name).not.toHaveBeenCalled();

			now += 200;
			expect(handler?.("\x1b")).toEqual({ consume: true });
			expect(loadStates).toHaveBeenCalledTimes(2);
			await Promise.resolve();
			await Promise.resolve();
			expect(notify, testCase.name).toHaveBeenCalledWith(testCase.expectedWarning, "warning");

			now += 200;
			expect(handler?.("\x1b")).toEqual({ consume: true });
			await Promise.resolve();
			await Promise.resolve();
			expect(loadStates).toHaveBeenCalledTimes(3);
			expect(abortStates, testCase.name).toHaveBeenCalledWith(
				testCase.expectedAbortTargets,
				"killed by double Escape",
			);
			controller.stop();
		}
	});

	it("retries after failed empty-watcher refreshes and keeps revalidating after no-active success", async () => {
		let handler: TerminalHandler | undefined;
		let calls = 0;
		const notify = vi.fn();
		const abortStates = vi.fn();
		const loadStates = vi.fn(async () => {
			calls += 1;
			if (calls === 1) throw new Error("state load failed");
			return [];
		});
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
			loadStates,
			hasActiveSubagentWork: () => true,
			abortStates,
		});

		expect(handler?.("\x1b")).toEqual({ consume: true });
		expect(loadStates).toHaveBeenCalledOnce();
		await Promise.resolve();
		await Promise.resolve();

		expect(handler?.("\x1b")).toEqual({ consume: true });
		expect(loadStates).toHaveBeenCalledTimes(2);
		await Promise.resolve();
		await Promise.resolve();

		expect(handler?.("\x1b")).toEqual({ consume: true });
		expect(loadStates).toHaveBeenCalledTimes(3);
		await Promise.resolve();
		await Promise.resolve();
		expect(notify).not.toHaveBeenCalled();
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

	it("aborts all active session sub-agents on ctrl+c when no current batch is known", async () => {
		let handler: TerminalHandler | undefined;
		const abortStates = vi.fn();
		const current = stateOf({ agentId: "current", batchId: "batch-new" });
		const old = stateOf({ agentId: "old", batchId: "batch-old" });
		const unbatched = stateOf({ agentId: "legacy", batchId: null });
		const done = stateOf({ agentId: "done", status: "done", finishedAt: 1 });
		const active = [current, old, unbatched];
		const loadStates = vi.fn(async () => active);
		const controller = mountInterruptHandler({
			ctx: {
				ui: {
					onTerminalInput: (registered: TerminalHandler) => {
						handler = registered;
						return vi.fn();
					},
				},
			} as never,
			getBatchId: () => null,
			loadStates,
			abortStates,
		});
		controller.update([...active, done]);

		expect(handler?.("\x03")).toEqual({ consume: true });
		await Promise.resolve();
		await Promise.resolve();

		expect(loadStates).toHaveBeenCalledOnce();
		expect(abortStates).toHaveBeenCalledWith(active, "killed by Ctrl+C");
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

	it("clears an ambient Escape warning when Escape closes the subagents overlay", async () => {
		const tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-interrupt-overlay-warning-"));
		try {
			const running = stateOf({ agentId: "current", alias: "current", batchId: "batch-new" });
			await writeSessionState(tmp, running);
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

			expect(handler?.("\x1b")).toEqual({ consume: true });
			expect(notify).toHaveBeenCalledWith(
				"Press Escape again within 3s to abort 1 active sub-agent in current batch.",
				"warning",
			);

			const mounted = createCustomHarness();
			const opening = openSubagentsOverlay(mounted.ctx, tmp, "sess", "batch-new", vi.fn());
			await mounted.ready;

			now += 100;
			expect(handler?.("\x1b")).toBeUndefined();
			expect(mounted.component?.handleInput("\x1b")).toBe(true);
			await opening;

			now += 100;
			expect(handler?.("\x1b")).toEqual({ consume: true });
			expect(notify).toHaveBeenCalledTimes(2);
			expect(abortStates).not.toHaveBeenCalled();

			now += 100;
			expect(handler?.("\x1b")).toEqual({ consume: true });
			await Promise.resolve();
			expect(abortStates).toHaveBeenCalledWith([running], "killed by double Escape");
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
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
