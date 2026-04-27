import { visibleWidth } from "@mariozechner/pi-tui";
import { describe, expect, it } from "vitest";
import type { SubagentState } from "../../src/types.js";
import { filterCurrentBatchActiveStates, renderSubagentsPanel } from "../../src/ui/overlay.js";
import { SubagentsPanel } from "../../src/ui/subagents-panel.js";

const theme = {
	bold: (s: string) => s,
	fg: (_token: string, s: string) => s,
};

const stateOf = (overrides: Partial<SubagentState>): SubagentState => ({
	schemaVersion: 1,
	agentId: "abc12345",
	parentAgentId: null,
	sessionId: "sess",
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

describe("renderSubagentsPanel", () => {
	it("filters states to active agents in the current batch", () => {
		const running = stateOf({ agentId: "current1", batchId: "batch-new", status: "running" });
		const starting = stateOf({ agentId: "current2", batchId: "batch-new", status: "starting" });
		const done = stateOf({ agentId: "done1", batchId: "batch-new", status: "done", finishedAt: 2 });
		const historical = stateOf({ agentId: "old1", batchId: "batch-old" });
		const unbatched = stateOf({ agentId: "legacy", batchId: null });

		expect(filterCurrentBatchActiveStates([historical, running, done, starting, unbatched], "batch-new")).toEqual([
			running,
			starting,
		]);
		expect(filterCurrentBatchActiveStates([historical, running], null)).toEqual([]);
	});

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
		expect(lines.join("\n")).toContain("No running sub-agents in current batch.");
		expect(lines.join("\n")).not.toContain("done #");
	});

	it("strips terminal control sequences from untrusted state and transcript text", () => {
		const rendered = renderSubagentsPanel({
			states: [stateOf({ alias: "\u001b]52;c;bad\u0007auth-search", task: "safe\u001b[31m task" })],
			selectedIdx: 0,
			detailedAgentId: "abc12345",
			transcript: { kind: "events", events: ["assistant: hi\u001b[31mred\u001b[0m"] },
			width: 72,
			theme: theme as never,
		}).join("\n");

		expect(rendered).toContain("auth-search");
		expect(rendered).toContain("safe task");
		expect(rendered).toContain("assistant: hired");
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
