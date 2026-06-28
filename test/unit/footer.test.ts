import { describe, expect, it, vi } from "vitest";
import type { SubagentState } from "../../src/types.js";
import { mountFooter } from "../../src/ui/footer.js";
import { SubagentsPanel } from "../../src/ui/subagents-panel.js";

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

describe("mountFooter", () => {
	it("clears the footer status when no sub-agents are active", () => {
		const calls: Array<{ id: string; value: string | undefined }> = [];
		const footer = mountFooter({
			ui: {
				setStatus: (id: string, value: string | undefined) => calls.push({ id, value }),
			},
		} as never);

		footer.update([
			stateOf({ status: "done", finishedAt: 2, exitCode: 0 }),
			stateOf({ agentId: "def67890", status: "failed", finishedAt: 3, exitCode: 1 }),
		]);

		expect(calls).toEqual([{ id: "pi-crew", value: undefined }]);
	});

	it("shows only the active running count with explicit command and cancellation hints", () => {
		const calls: Array<{ id: string; value: string | undefined }> = [];
		const footer = mountFooter({
			ui: {
				setStatus: (id: string, value: string | undefined) => calls.push({ id, value }),
			},
		} as never);

		footer.update([
			stateOf({ status: "running" }),
			stateOf({ agentId: "def67890", status: "starting" }),
			stateOf({ agentId: "ghi23456", status: "done", finishedAt: 2, exitCode: 0 }),
		]);

		expect(calls).toEqual([
			{
				id: "pi-crew",
				value: "⟳ 2 sub-agents running · /subagents · Ctrl+B background · Esc Esc abort",
			},
		]);
	});

	it("does not register ambient terminal input or consume Down/Enter from editor-empty or editor-nonempty states", () => {
		const setStatus = vi.fn();
		const onTerminalInput = vi.fn((_handler: TerminalHandler) => () => undefined);
		const setWidget = vi.fn();
		const footer = mountFooter({
			ui: {
				setStatus,
				getEditorText: () => "",
				onTerminalInput,
				setWidget,
			},
		} as never);

		footer.update([stateOf({ status: "running" })]);
		expect(onTerminalInput).not.toHaveBeenCalled();
		expect(setWidget).not.toHaveBeenCalled();
		expect(setStatus).toHaveBeenLastCalledWith(
			"pi-crew",
			"⟳ 1 sub-agent running · /subagents · Ctrl+B background · Esc Esc abort",
		);

		footer.update([stateOf({ status: "running", lastUpdate: 2 })]);
		expect(setWidget).not.toHaveBeenCalled();
		expect(onTerminalInput).not.toHaveBeenCalled();
	});

	it("leaves Up/Down navigation inside an explicitly opened panel intact", () => {
		const panel = new SubagentsPanel({
			theme: theme as never,
			onClose: () => undefined,
			requestRender: () => undefined,
		});
		panel.setStates([
			stateOf({ agentId: "abc12345", alias: "first", startedAt: 1 }),
			stateOf({ agentId: "def67890", alias: "second", startedAt: 2 }),
		]);

		expect(panel.handleInput("\x1b[B")).toBe(true);
		expect(panel.render(80).join("\n")).toContain("▸ ⏳ second");
		expect(panel.handleInput("\x1b[A")).toBe(true);
		expect(panel.render(80).join("\n")).toContain("▸ ⏳ first");
	});
});
