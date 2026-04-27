import { describe, expect, it } from "vitest";
import type { SubagentState } from "../../src/types.js";
import { mountFooter } from "../../src/ui/footer.js";

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

	it("shows only the active running count", () => {
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

		expect(calls).toEqual([{ id: "pi-crew", value: "⟳ 2 running" }]);
	});

	it("focuses the below-input running status with Down only when the editor is empty", () => {
		let handler: TerminalHandler | undefined;
		let editorText = "";
		const calls: Array<{ id: string; value: string | undefined }> = [];
		const footer = mountFooter({
			ui: {
				setStatus: (id: string, value: string | undefined) => calls.push({ id, value }),
				getEditorText: () => editorText,
				onTerminalInput: (registered: TerminalHandler) => {
					handler = registered;
					return () => undefined;
				},
			},
		} as never);
		footer.update([stateOf({ status: "running" })]);

		expect(handler?.("\x1b[B")).toEqual({ consume: true });
		expect(calls.at(-1)).toEqual({ id: "pi-crew", value: "▸ ⟳ 1 running" });

		editorText = "hello";
		expect(handler?.("\x1b[B")).toBeUndefined();
		expect(calls.at(-1)).toEqual({ id: "pi-crew", value: "⟳ 1 running" });
	});

	it("opens and closes the active list from the focused running status", () => {
		let handler: TerminalHandler | undefined;
		let widgetFactory: unknown;
		const widgetCalls: Array<{ id: string; value: unknown; options: unknown }> = [];
		const footer = mountFooter({
			ui: {
				setStatus: () => undefined,
				getEditorText: () => "",
				onTerminalInput: (registered: TerminalHandler) => {
					handler = registered;
					return () => undefined;
				},
				setWidget: (id: string, value: unknown, options: unknown) => {
					widgetCalls.push({ id, value, options });
					if (typeof value === "function") widgetFactory = value;
				},
			},
		} as never);
		footer.update([stateOf({ status: "running" })]);

		expect(handler?.("\x1b[B")).toEqual({ consume: true });
		expect(handler?.("\r")).toEqual({ consume: true });
		expect(widgetCalls.at(-1)).toMatchObject({ id: "pi-crew-footer-details", options: { placement: "belowEditor" } });

		expect(typeof widgetFactory).toBe("function");
		(widgetFactory as (tui: { requestRender(): void }, theme: unknown) => unknown)(
			{ requestRender: () => undefined },
			theme,
		);
		expect(handler?.("\x1b")).toEqual({ consume: true });
		expect(widgetCalls.at(-1)).toEqual({ id: "pi-crew-footer-details", value: undefined, options: undefined });
	});
});
