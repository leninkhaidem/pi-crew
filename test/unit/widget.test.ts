import { visibleWidth } from "@mariozechner/pi-tui";
import { describe, expect, it } from "vitest";
import type { SubagentState } from "../../src/types.js";
import { mountWidget, renderActiveAgentsPanel } from "../../src/ui/widget.js";

const stateOf = (overrides: Partial<SubagentState>): SubagentState => ({
	schemaVersion: 1,
	agentId: "abc12345",
	parentAgentId: null,
	sessionId: "sess",
	agent: "explore",
	alias: "auth-search",
	agentSource: "bundled",
	task: "find auth",
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

const theme = {
	bold: (s: string) => s,
	fg: (_token: string, s: string) => s,
};

describe("renderActiveAgentsPanel", () => {
	it("renders active sub-agents like the reference above-editor tracker", () => {
		const lines = renderActiveAgentsPanel({ states: [stateOf({})], width: 80, theme: theme as never });

		expect(lines[0]).toBe("● Agents");
		expect(lines.join("\n")).toContain("└─");
		expect(lines.join("\n")).toContain("auth-search");
		expect(lines.join("\n")).toContain("explore");
		expect(lines.join("\n")).toContain("openai-codex/gpt-5.4-mini");
		expect(lines.join("\n")).not.toContain("find auth");
		expect(lines.join("\n")).toContain("⎿");
		expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
	});

	it("never emits embedded newlines from multiline task or activity text", () => {
		const lines = renderActiveAgentsPanel({
			states: [
				stateOf({
					task: "Implement thing\n\nRequirements:\n- one\n- two",
					activity: "running command\nwith multiple lines",
					lastToolCall: { name: "bash", args: { command: "npm test\nnpm run lint" } },
				}),
			],
			width: 50,
			theme: theme as never,
		});

		expect(lines).toHaveLength(3);
		expect(lines.every((line) => !line.includes("\n") && visibleWidth(line) <= 50)).toBe(true);
		expect(lines.join("\n")).not.toContain("Implement thing");
		expect(lines.join("\n")).toContain("running command with multiple lines");
	});
});

describe("mountWidget", () => {
	it("clears the widget as soon as no sub-agents are active", () => {
		const calls: Array<{ id: string; value: unknown }> = [];
		const widget = mountWidget({
			ui: {
				setWidget: (id: string, value: unknown) => calls.push({ id, value }),
			},
		} as never);

		widget.update([stateOf({ status: "running" })]);
		widget.update([stateOf({ status: "done", finishedAt: Date.now(), exitCode: 0, finalOutput: "done" })]);

		expect(calls.at(-1)).toEqual({ id: "agents", value: undefined });
	});

	it("registers once above the editor and does not redraw the same active snapshot on every poll", () => {
		const calls: Array<{ id: string; value: unknown; options: unknown }> = [];
		const widget = mountWidget({
			ui: {
				setWidget: (id: string, value: unknown, options: unknown) => calls.push({ id, value, options }),
			},
		} as never);
		const state = stateOf({ status: "running" });

		widget.update([state]);
		widget.update([state]);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.id).toBe("agents");
		expect(calls[0]?.options).toEqual({ placement: "aboveEditor" });
	});
});
