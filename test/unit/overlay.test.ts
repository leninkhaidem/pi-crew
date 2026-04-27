import { visibleWidth } from "@mariozechner/pi-tui";
import { describe, expect, it } from "vitest";
import type { SubagentState } from "../../src/types.js";
import { filterCurrentBatchActiveStates, renderSubagentsPanel } from "../../src/ui/overlay.js";

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

	it("renders a bordered below-input panel with inline details", () => {
		const lines = renderSubagentsPanel({
			states: [stateOf({})],
			selectedIdx: 0,
			detailedAgentId: "abc12345",
			width: 72,
			theme: theme as never,
		});

		expect(lines[0]).toContain("╭");
		expect(lines.at(-1)).toContain("╰");
		expect(lines.join("\n")).toContain("pi-crew sub-agents");
		expect(lines.join("\n")).toContain("enter hide details");
		expect(lines.join("\n")).toContain("d kill");
		expect(lines.join("\n")).toContain("esc esc kills batch");
		expect(lines.join("\n")).toContain("auth-search #abc12345");
		expect(lines.join("\n")).toContain("model");
		expect(lines.join("\n")).toContain("task");
		expect(lines.join("\n")).not.toContain("output.jsonl");
		expect(lines.join("\n")).not.toContain("state.json");
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

	it("shows the last tool target when activity is generic", () => {
		const lines = renderSubagentsPanel({
			states: [
				stateOf({
					activity: "thinking…",
					lastToolCall: { name: "read", args: { path: "src/ui/overlay.ts" } },
				}),
			],
			selectedIdx: 0,
			detailedAgentId: "abc12345",
			width: 90,
			theme: theme as never,
		});

		const rendered = lines.join("\n");
		expect(rendered).toContain("reading src/ui/overlay.ts");
		expect(rendered).not.toContain("now thinking…");
	});
});
