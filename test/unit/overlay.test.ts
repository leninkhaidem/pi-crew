import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { visibleWidth } from "@mariozechner/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerTreeCommand } from "../../src/commands/tree.js";
import { readState, writeState } from "../../src/state/store.js";
import type { SubagentState } from "../../src/types.js";
import {
	NO_ACTIVE_SUBAGENTS_MESSAGE,
	filterCurrentBatchActiveStates,
	filterSessionActiveStates,
	isSubagentsOverlayActive,
	killSelected,
	openSubagentsOverlay,
	renderSubagentsPanel,
} from "../../src/ui/overlay.js";
import { SubagentsPanel } from "../../src/ui/subagents-panel.js";

const watcherChanges = vi.hoisted(() => [] as Array<(states: SubagentState[]) => void>);
const watcherStops = vi.hoisted(() => [] as Array<ReturnType<typeof vi.fn>>);

vi.mock("../../src/ui/state-watcher.js", () => ({
	mountStateWatcher: vi.fn((args: { onChange: (states: SubagentState[]) => void }) => {
		watcherChanges.push(args.onChange);
		const stop = vi.fn();
		watcherStops.push(stop);
		return { stop };
	}),
}));

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
	agent: "explore",
	alias: "auth-search",
	agentSource: "bundled",
	task: "find auth and summarize every relevant file in a very long task title",
	cwd: "/proj",
	branch: null,
	model: "gpt-5.4-mini",
	provider: "openai-codex",
	thinking: "low",
	tools: null,
	maxTurns: null,
	pid: 1234,
	startedAt: 0,
	finishedAt: null,
	lastUpdate: 1,
	status: "running",
	exitCode: null,
	stopReason: null,
	errorMessage: null,
	turns: 1,
	usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0.0021, contextTokens: 150 },
	lastText: "last text",
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

describe("sub-agent overlay access", () => {
	beforeEach(() => {
		watcherChanges.length = 0;
		watcherStops.length = 0;
	});

	it("registers /subagents and /tasks as the same command handler", () => {
		const commands = new Map<string, { description: string; handler: unknown }>();
		registerTreeCommand(
			{ registerCommand: (name: string, command: { description: string; handler: unknown }) => commands.set(name, command) } as never,
			{} as never,
		);

		expect(commands.get("subagents")?.description).toContain("overlay");
		expect(commands.get("tasks")?.description).toBe("Alias for /subagents.");
		expect(commands.get("tasks")?.handler).toBe(commands.get("subagents")?.handler);
	});

	it("shows the exact info notification and does not mount an overlay when no active agents exist", async () => {
		const tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-overlay-empty-"));
		try {
			const custom = vi.fn();
			const notify = vi.fn();
			await openSubagentsOverlay(
				{ ui: { custom, notify } } as never,
				tmp,
				"sess",
				"batch-new",
				vi.fn(),
			);

			expect(notify).toHaveBeenCalledWith(NO_ACTIVE_SUBAGENTS_MESSAGE, "info");
			expect(custom).not.toHaveBeenCalled();
			expect(watcherChanges).toHaveLength(0);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("mounts ctx.ui.custom as a focused overlay instead of a below-editor widget", async () => {
		const tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-overlay-open-"));
		try {
			await writeSessionState(tmp, stateOf({ agentId: "current", alias: "current", batchId: "batch-new" }));
			const mounted = createCustomHarness();
			const opening = openSubagentsOverlay(mounted.ctx, tmp, "sess", "batch-new", vi.fn());
			await mounted.ready;

			expect(mounted.custom).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ overlay: true }));
			expect(mounted.custom.mock.calls[0]?.[1]).not.toMatchObject({ placement: "belowEditor" });
			expect(isSubagentsOverlayActive()).toBe(true);
			expect(mounted.component?.render(80).join("\n")).toContain("current");

			expect(mounted.component?.handleInput("\x1b")).toBe(true);
			await opening;
			expect(isSubagentsOverlayActive()).toBe(false);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("uses all active current-session agents with current-batch-first ordering and scope labels", () => {
		const currentRunning = stateOf({ agentId: "current-running", alias: "current", batchId: "batch-new", startedAt: 30 });
		const currentStarting = stateOf({ agentId: "current-starting", alias: "starting", batchId: "batch-new", status: "starting", startedAt: 10 });
		const older = stateOf({ agentId: "older", alias: "older", batchId: "batch-old", startedAt: 5 });
		const unbatched = stateOf({ agentId: "unbatched", alias: "legacy", batchId: null, startedAt: 1 });
		const done = stateOf({ agentId: "done", alias: "done", status: "done", finishedAt: 50 });

		expect(filterSessionActiveStates([older, done, currentRunning, unbatched, currentStarting], "batch-new")).toEqual([
			currentStarting,
			currentRunning,
			unbatched,
			older,
		]);
		expect(filterCurrentBatchActiveStates([older, currentRunning, unbatched], "batch-new")).toEqual([
			currentRunning,
		]);

		const rendered = renderSubagentsPanel({
			states: [older, done, currentRunning, unbatched, currentStarting],
			selectedIdx: 0,
			width: 100,
			currentBatchId: "batch-new",
			theme: theme as never,
		}).join("\n");
		expect(rendered).toContain("current");
		expect(rendered).toContain("starting");
		expect(rendered).toContain("older batch");
		expect(rendered).toContain("unbatched");
		expect(rendered).not.toContain("done ·");
	});

	it("keeps an open overlay mounted with an in-overlay empty state after active agents finish", async () => {
		const tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-overlay-empty-after-open-"));
		try {
			const running = stateOf({ agentId: "current", alias: "current", batchId: "batch-new" });
			await writeSessionState(tmp, running);
			const mounted = createCustomHarness();
			const opening = openSubagentsOverlay(mounted.ctx, tmp, "sess", "batch-new", vi.fn());
			await mounted.ready;

			watcherChanges[0]?.([stateOf({ ...running, status: "done", finishedAt: 2, exitCode: 0 })]);
			const rendered = mounted.component?.render(80).join("\n") ?? "";
			expect(rendered).toContain("0 active");
			expect(rendered).toContain(NO_ACTIVE_SUBAGENTS_MESSAGE);
			expect(watcherStops[0]).not.toHaveBeenCalled();

			expect(mounted.component?.handleInput("\x1b")).toBe(true);
			await opening;
			expect(watcherStops[0]).toHaveBeenCalledOnce();
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("cleans up watcher resources on close and does not register raw input handlers on repeated opens", async () => {
		const tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-overlay-reopen-"));
		try {
			await writeSessionState(tmp, stateOf({ agentId: "current", alias: "current", batchId: "batch-new" }));
			const onTerminalInput = vi.fn();

			for (let i = 0; i < 2; i++) {
				const mounted = createCustomHarness({ onTerminalInput });
				const opening = openSubagentsOverlay(mounted.ctx, tmp, "sess", "batch-new", vi.fn());
				await mounted.ready;
				expect(mounted.component?.handleInput("\x1b")).toBe(true);
				await opening;
			}

			expect(onTerminalInput).not.toHaveBeenCalled();
			expect(watcherStops).toHaveLength(2);
			expect(watcherStops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
			expect(isSubagentsOverlayActive()).toBe(false);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("UI kill writes an aborted state with an observable reason through the shared abort path", async () => {
		const tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-overlay-kill-"));
		try {
			const statePath = path.join(tmp, "subagents", "sess", "abc12345", "state.json");
			const running = stateOf({
				pid: null,
				paths: {
					state: statePath,
					output: path.join(path.dirname(statePath), "output.jsonl"),
					stderr: path.join(path.dirname(statePath), "stderr.log"),
					prompt: path.join(path.dirname(statePath), "prompt.md"),
				},
			});
			await writeState(running);

			await killSelected(running);

			const aborted = await readState(statePath);
			expect(aborted).toMatchObject({
				status: "aborted",
				exitCode: -1,
				errorMessage: "killed from /subagents panel",
			});
			expect(aborted?.finishedAt).toEqual(expect.any(Number));
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("keeps d kill confirmation and selected-agent-only abort behavior in the panel", () => {
		const killed: string[] = [];
		const panel = new SubagentsPanel({
			theme: theme as never,
			onClose: () => undefined,
			requestRender: () => undefined,
			onKill: (state) => {
				killed.push(state.agentId);
			},
		});
		panel.setStates([
			stateOf({ agentId: "first", alias: "first", startedAt: 1 }),
			stateOf({ agentId: "second", alias: "second", startedAt: 2 }),
		]);

		expect(panel.handleInput("\x1b[B")).toBe(true);
		expect(panel.handleInput("d")).toBe(true);
		expect(panel.render(80).join("\n")).toContain("Kill second");
		expect(panel.handleInput("y")).toBe(true);
		expect(killed).toEqual(["second"]);
	});
});

describe("renderSubagentsPanel", () => {
	it("renders a bordered transcript-focused detail view", () => {
		const lines = renderSubagentsPanel({
			states: [
				stateOf({
					activity: "reading files",
					activeTools: ["read"],
					lastToolCall: { name: "bash", args: { command: "secret command" } },
					lastText: "latest output text",
				}),
			],
			selectedIdx: 0,
			detailedAgentId: "abc12345",
			transcript: { kind: "events", events: ["assistant: sanitized transcript excerpt"] },
			width: 72,
			theme: theme as never,
		});
		const rendered = lines.join("\n");

		expect(lines[0]).toContain("╭");
		expect(lines.at(-1)).toContain("╰");
		expect(rendered).toContain("pi-crew sub-agents");
		expect(rendered).toContain("←/esc list");
		expect(rendered).toContain("d kill");
		expect(rendered).not.toContain("esc esc kills batch");
		expect(rendered).toContain("auth-search #abc12345");
		expect(rendered).toContain("status running");
		expect(rendered).toContain("alias auth-search");
		expect(rendered).toContain("model explore · openai-codex/gpt-5.4-mini · low");
		expect(rendered).toContain("cwd /proj");
		expect(rendered).toContain("elapsed");
		expect(rendered).toContain("usage");
		expect(rendered).toContain("task");
		expect(rendered).toContain("transcript");
		expect(rendered).toContain("sanitized transcript excerpt");
		expect(rendered).not.toContain("now");
		expect(rendered).not.toContain("secret command");
		expect(rendered).not.toContain("latest output text");
		expect(rendered).not.toContain("output.jsonl");
		expect(rendered).not.toContain("state.json");
		expect(lines.every((line) => visibleWidth(line) <= 72)).toBe(true);
	});

	it("renders an empty active panel when only terminal agents are present", () => {
		const lines = renderSubagentsPanel({
			states: [stateOf({ status: "done", finishedAt: 2, finalOutput: "done" })],
			selectedIdx: 0,
			width: 72,
			theme: theme as never,
		});

		expect(lines.join("\n")).toContain("0 active");
		expect(lines.join("\n")).toContain(NO_ACTIVE_SUBAGENTS_MESSAGE);
		expect(lines.join("\n")).not.toContain("done #");
	});

	it("strips terminal control sequences from untrusted state and transcript text", () => {
		const rendered = renderSubagentsPanel({
			states: [stateOf({ alias: "\u001b]52;c;bad\u0007auth-search", task: "safe\u001b[31m task" })],
			selectedIdx: 0,
			detailedAgentId: "abc12345",
			transcript: { kind: "events", events: ["hi\u001b[31mred\u001b[0m"] },
			width: 72,
			theme: theme as never,
		}).join("\n");

		expect(rendered).toContain("auth-search");
		expect(rendered).toContain("safe task");
		expect(rendered).toContain("hired");
		expect(rendered).not.toContain("\u001b");
		expect(rendered).not.toContain("52;c;bad");
	});

	it("does not emit embedded newlines for multiline state fields", () => {
		const lines = renderSubagentsPanel({
			states: [
				stateOf({
					task: "Task headline\n\nRequirements:\n- a",
					lastText: "line one\nline two",
					lastToolCall: { name: "bash", args: { command: "npm test\nnpm run lint" } },
				}),
			],
			selectedIdx: 0,
			width: 72,
			theme: theme as never,
		});

		expect(lines.every((line) => !line.includes("\n") && visibleWidth(line) <= 72)).toBe(true);
		expect(lines.join("\n")).toContain("running npm");
		expect(lines.join("\n")).not.toContain("Task headline Requirements:");
	});

	it("shows the last tool target in the active list when activity is generic", () => {
		const lines = renderSubagentsPanel({
			states: [
				stateOf({
					activity: "thinking…",
					lastToolCall: { name: "read", args: { path: "src/ui/overlay.ts" } },
				}),
			],
			selectedIdx: 0,
			width: 90,
			theme: theme as never,
		});

		const rendered = lines.join("\n");
		expect(rendered).toContain("reading src/ui/overlay.ts");
		expect(rendered).not.toContain("now thinking…");
	});

	it("supports selection, drill-in, and left-arrow backtracking", async () => {
		let closed = false;
		const panel = new SubagentsPanel({
			theme: theme as never,
			onClose: () => {
				closed = true;
			},
			requestRender: () => undefined,
			onKill: () => undefined,
			loadTranscript: async (state) => ({ kind: "events", events: [`assistant: ${state.alias} transcript`] }),
		});
		panel.setStates([
			stateOf({ agentId: "abc12345", alias: "auth-search", startedAt: 1 }),
			stateOf({ agentId: "def67890", alias: "api-search", startedAt: 2 }),
		]);

		expect(panel.handleInput("\x1b[B")).toBe(true);
		expect(panel.handleInput("\x1b[C")).toBe(true);
		await Promise.resolve();

		const detail = panel.render(80).join("\n");
		expect(detail).toContain("api-search #def67890");
		expect(detail).toContain("assistant: api-search transcript");

		expect(panel.handleInput("\x1b[D")).toBe(true);
		expect(panel.render(80).join("\n")).toContain("enter/→ details");
		expect(panel.handleInput("\x1b[D")).toBe(true);
		expect(closed).toBe(true);
	});

	it("refreshes detail transcript output when the transcript fingerprint changes", async () => {
		let loadCount = 0;
		const panel = new SubagentsPanel({
			theme: theme as never,
			onClose: () => undefined,
			requestRender: () => undefined,
			onKill: () => undefined,
			loadTranscript: async () => ({ kind: "events", events: [`assistant: transcript ${++loadCount}`] }),
		});
		const running = stateOf({
			agentId: "abc12345",
			alias: "auth-search",
			lastUpdate: 1,
			transcriptSize: 100,
			transcriptMtimeMs: 1,
		});

		panel.setStates([running]);
		expect(panel.handleInput("\x1b[C")).toBe(true);
		await Promise.resolve();
		expect(panel.render(80).join("\n")).toContain("assistant: transcript 1");

		panel.setStates([running]);
		await Promise.resolve();
		expect(panel.render(80).join("\n")).toContain("assistant: transcript 1");

		panel.setStates([{ ...running, lastUpdate: 2 }]);
		await Promise.resolve();
		expect(panel.render(80).join("\n")).toContain("assistant: transcript 1");

		panel.setStates([{ ...running, transcriptSize: 120, transcriptMtimeMs: 2 }]);
		await Promise.resolve();
		expect(panel.render(80).join("\n")).toContain("assistant: transcript 2");
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

function createCustomHarness(extraUi: Record<string, unknown> = {}) {
	let resolveReady: () => void = () => undefined;
	const ready = new Promise<void>((resolve) => {
		resolveReady = resolve;
	});
	const harness: {
		component: SubagentsPanel | undefined;
		custom: ReturnType<typeof vi.fn>;
		ctx: never;
		ready: Promise<void>;
	} = {
		component: undefined,
		custom: vi.fn(),
		ctx: undefined as never,
		ready,
	};
	harness.custom = vi.fn((factory, _options) => {
		return new Promise<void>((resolve) => {
			harness.component = factory({ requestRender: () => undefined }, theme, {}, () => resolve());
			resolveReady();
		});
	});
	harness.ctx = { ui: { custom: harness.custom, notify: vi.fn(), ...extraUi } } as never;
	return harness;
}
