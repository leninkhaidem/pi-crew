import { visibleWidth } from "@mariozechner/pi-tui";
import { describe, expect, it } from "vitest";
import type { SubagentState } from "../../src/types.js";
import { filterCurrentBatchStates, renderSubagentsPanel } from "../../src/ui/overlay.js";

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
	it("filters states to the current batch", () => {
		const current = stateOf({ agentId: "current1", batchId: "batch-new" });
		const historical = stateOf({ agentId: "old1", batchId: "batch-old" });
		const unbatched = stateOf({ agentId: "legacy", batchId: null });

		expect(filterCurrentBatchStates([historical, current, unbatched], "batch-new")).toEqual([current]);
		expect(filterCurrentBatchStates([historical, current], null)).toEqual([]);
	});

	it("renders a bordered overlay panel within the requested width", () => {
		const lines = renderSubagentsPanel({
			states: [stateOf({})],
			selectedIdx: 0,
			expanded: new Set(["abc12345"]),
			width: 72,
			theme: theme as never,
		});

		expect(lines[0]).toContain("╭");
		expect(lines.at(-1)).toContain("╰");
		expect(lines.join("\n")).toContain("pi-crew sub-agents");
		expect(lines.join("\n")).toContain("esc close");
		expect(lines.every((line) => visibleWidth(line) <= 72)).toBe(true);
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
			expanded: new Set(["abc12345"]),
			width: 72,
			theme: theme as never,
		});

		expect(lines.every((line) => !line.includes("\n") && visibleWidth(line) <= 72)).toBe(true);
		expect(lines.join("\n")).toContain("Task headline Requirements:");
	});
});
