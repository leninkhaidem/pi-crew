import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { visibleWidth } from "@mariozechner/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_RECENT_TRANSCRIPT_EVENT_TEXT_LENGTH } from "../../src/runtime/transcript.js";
import { writeState } from "../../src/state/store.js";
import { registerGetSubagentResultTool } from "../../src/tools/result.js";
import type { SubagentState } from "../../src/types.js";

type RegisteredResultTool = {
	execute: (id: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
	renderResult: (
		result: unknown,
		options: unknown,
		theme: unknown,
		context: unknown,
	) => { render: (width: number) => string[] };
};

const stateOf = (agentDir: string, overrides: Partial<SubagentState>): SubagentState => {
	const agentId = overrides.agentId ?? "abc12345";
	const sessionId = overrides.sessionId ?? "sess";
	const dir = path.join(agentDir, "subagents", sessionId, agentId);
	return {
		schemaVersion: 1,
		agentId,
		parentAgentId: null,
		sessionId,
		agent: "explore",
		alias: "summarizer",
		agentSource: "bundled",
		task: "summarize",
		cwd: "/proj",
		branch: null,
		model: "gpt-5.4-mini",
		provider: "openai-codex",
		thinking: "low",
		tools: null,
		maxTurns: null,
		pid: null,
		startedAt: 0,
		finishedAt: 1,
		lastUpdate: 1,
		status: "done",
		exitCode: null,
		stopReason: "stop",
		errorMessage: null,
		turns: 1,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 },
		lastText: null,
		lastToolCall: null,
		finalOutput: "done",
		paths: {
			state: path.join(dir, "state.json"),
			output: path.join(dir, "output.jsonl"),
			stderr: path.join(dir, "stderr.log"),
			prompt: path.join(dir, "prompt.md"),
		},
		...overrides,
	};
};

function registerResultTool(agentDir: string, completionHandled = false) {
	let tool: RegisteredResultTool | undefined;
	const pi = {
		registerTool: vi.fn((registeredTool) => {
			tool = registeredTool;
		}),
	};
	const consumeCompletion = vi.fn();
	const completionHandledMock = vi.fn(() => completionHandled);

	registerGetSubagentResultTool(pi as never, {
		agentDir,
		consumeCompletion,
		completionHandled: completionHandledMock,
	} as never);
	if (!tool) throw new Error("result tool was not registered");
	return { tool, consumeCompletion, completionHandled: completionHandledMock };
}

function jsonl(events: unknown[]): string {
	return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

describe("get_subagent_result", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-result-"));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("returns the complete final output to the parent while rendering compactly for the user", async () => {
		const longOutput = `start-${"x".repeat(2000)}-end`;
		await writeState(stateOf(tmp, { finalOutput: longOutput }));
		let tool: RegisteredResultTool | undefined;
		const pi = {
			registerTool: vi.fn((registeredTool) => {
				tool = registeredTool;
			}),
		};
		const consumeCompletion = vi.fn();
		const completionHandled = vi.fn(() => false);

		registerGetSubagentResultTool(pi as never, { agentDir: tmp, consumeCompletion, completionHandled } as never);
		const result = (await tool?.execute("call", { agent_id: "abc12345" })) as {
			content: Array<{ type: "text"; text: string }>;
		};

		expect(result.content[0]?.text).toContain(longOutput);
		expect(result.content[0]?.text).not.toContain("Summary truncated");
		expect(consumeCompletion).toHaveBeenCalledWith("abc12345");
		expect(completionHandled).toHaveBeenCalledWith("abc12345");

		const theme = {
			bold: (s: string) => s,
			fg: (_token: string, s: string) => s,
		};
		const component = tool?.renderResult(result, { expanded: true }, theme, {});
		const lines = component?.render(100) ?? [];
		const rendered = lines.join("\n");

		expect(rendered).toContain("summarizer #abc12345");
		expect(rendered).toContain("done");
		expect(rendered).not.toContain(longOutput);
		expect(lines.every((line) => visibleWidth(line) <= 100)).toBe(true);
	});

	it("does not feed duplicate final output back to the parent when completion was already handled", async () => {
		const longOutput = `start-${"x".repeat(2000)}-end`;
		await writeState(stateOf(tmp, { finalOutput: longOutput }));
		let tool: RegisteredResultTool | undefined;
		const pi = {
			registerTool: vi.fn((registeredTool) => {
				tool = registeredTool;
			}),
		};
		const consumeCompletion = vi.fn();
		const completionHandled = vi.fn(() => true);

		registerGetSubagentResultTool(pi as never, { agentDir: tmp, consumeCompletion, completionHandled } as never);
		const result = (await tool?.execute("call", { agent_id: "abc12345" })) as {
			content: Array<{ type: "text"; text: string }>;
		};

		expect(result.content[0]?.text).toContain("already completed");
		expect(result.content[0]?.text).toContain("already delivered");
		expect(result.content[0]?.text).not.toContain(longOutput);
		expect(consumeCompletion).toHaveBeenCalledWith("abc12345");
	});

	it("omits recent output when recentEvents is absent", async () => {
		const state = stateOf(tmp, { finalOutput: "done" });
		await writeState(state);
		writeFileSync(
			state.paths.output,
			jsonl([{ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "recent" }] } }]),
		);
		const { tool } = registerResultTool(tmp);

		const result = (await tool.execute("call", { agent_id: "abc12345" })) as {
			content: Array<{ type: "text"; text: string }>;
			details: Record<string, unknown>;
		};

		expect(result.content[0]?.text).not.toContain("--- Recent Output ---");
		expect(result.details).not.toHaveProperty("recentOutput");
	});

	it("validates recentEvents as a positive integer", async () => {
		await writeState(stateOf(tmp, {}));
		const { tool } = registerResultTool(tmp);

		for (const recentEvents of [0, -1, 1.5, "2", Number.NaN, null, { count: 2 }]) {
			await expect(tool.execute("call", { agent_id: "abc12345", recentEvents })).rejects.toThrow(
				"recentEvents must be a positive integer",
			);
		}
	});

	it("returns requested sanitized recent output in text and details and caps counts at 20", async () => {
		const state = stateOf(tmp, { finalOutput: "done" });
		await writeState(state);
		writeFileSync(
			state.paths.output,
			jsonl([
				{
					type: "message_end",
					message: { role: "assistant", content: [{ type: "thinking", thinking: "secret thought" }] },
				},
				...Array.from({ length: 25 }, (_, idx) => ({
					type: "message_end",
					message: { role: "assistant", content: [{ type: "text", text: `event ${idx}` }] },
				})),
			]),
		);
		const { tool } = registerResultTool(tmp);

		const small = (await tool.execute("call", { agent_id: "abc12345", recentEvents: 3 })) as {
			content: Array<{ type: "text"; text: string }>;
			details: { recentOutput?: string[] };
		};
		const capped = (await tool.execute("call", { agent_id: "abc12345", recentEvents: 200 })) as {
			content: Array<{ type: "text"; text: string }>;
			details: { recentOutput?: string[] };
		};

		expect(small.details.recentOutput).toEqual(["event 22", "event 23", "event 24"]);
		expect(small.content[0]?.text).toContain("--- Recent Output ---");
		expect(small.content[0]?.text).toContain("event 22");
		expect(small.content[0]?.text).not.toContain("secret thought");
		expect(small.content[0]?.text).not.toContain('"type":"message_end"');
		expect(capped.details.recentOutput).toHaveLength(20);
		expect(capped.details.recentOutput?.[0]).toBe("event 5");
		expect(capped.details.recentOutput?.at(-1)).toBe("event 24");
	});

	it("keeps raw transcript JSONL behind explicit verbose mode", async () => {
		const state = stateOf(tmp, { finalOutput: "done" });
		await writeState(state);
		writeFileSync(
			state.paths.output,
			jsonl([
				{
					type: "message_end",
					message: {
						role: "assistant",
						content: [
							{ type: "thinking", thinking: "secret thought" },
							{ type: "text", text: "visible answer" },
						],
					},
				},
			]),
		);
		const { tool } = registerResultTool(tmp);

		const recent = (await tool.execute("call", { agent_id: "abc12345", recentEvents: 1 })) as {
			content: Array<{ type: "text"; text: string }>;
		};
		const verbose = (await tool.execute("call", { agent_id: "abc12345", verbose: true })) as {
			content: Array<{ type: "text"; text: string }>;
		};

		expect(recent.content[0]?.text).toContain("visible answer");
		expect(recent.content[0]?.text).not.toContain("secret thought");
		expect(recent.content[0]?.text).not.toContain('"type":"message_end"');
		expect(recent.content[0]?.text).not.toContain("--- Transcript JSONL ---");
		expect(verbose.content[0]?.text).toContain("--- Transcript JSONL ---");
		expect(verbose.content[0]?.text).toContain('"type":"message_end"');
		expect(verbose.content[0]?.text).toContain("secret thought");
	});

	it("preserves transcript event size bounds in recent output text and details", async () => {
		const state = stateOf(tmp, { finalOutput: "done" });
		await writeState(state);
		writeFileSync(
			state.paths.output,
			jsonl([
				{
					type: "message_end",
					message: {
						role: "assistant",
						content: [{ type: "text", text: `assistant-${"a".repeat(2500)}` }],
					},
				},
				{
					type: "tool_execution_end",
					result: { content: [{ type: "text", text: `tool-${"t".repeat(2500)}` }] },
				},
			]),
		);
		const { tool } = registerResultTool(tmp);

		const result = (await tool.execute("call", { agent_id: "abc12345", recentEvents: 2 })) as {
			content: Array<{ type: "text"; text: string }>;
			details: { recentOutput?: string[] };
		};

		expect(result.details.recentOutput).toHaveLength(2);
		expect(result.details.recentOutput?.every((event) => event.length <= MAX_RECENT_TRANSCRIPT_EVENT_TEXT_LENGTH)).toBe(
			true,
		);
		expect(result.details.recentOutput?.every((event) => result.content[0]?.text.includes(event))).toBe(true);
		expect(result.content[0]?.text).not.toContain("a".repeat(MAX_RECENT_TRANSCRIPT_EVENT_TEXT_LENGTH));
		expect(result.content[0]?.text).not.toContain("t".repeat(MAX_RECENT_TRANSCRIPT_EVENT_TEXT_LENGTH));
	});

	it("retrieves retained successful done agents by exact id", async () => {
		const retained = stateOf(tmp, {
			agentId: "retained-done",
			sessionId: "old-session",
			alias: "retained",
			finalOutput: "retained final output",
			status: "done",
		});
		await writeState(stateOf(tmp, { agentId: "current-running", sessionId: "current", status: "running" }));
		await writeState(retained);
		const { tool } = registerResultTool(tmp);

		const result = (await tool.execute("call", { agent_id: "retained-done" })) as {
			content: Array<{ type: "text"; text: string }>;
			details: Record<string, unknown>;
		};

		expect(result.details.agentId).toBe("retained-done");
		expect(result.details.status).toBe("done");
		expect(result.content[0]?.text).toContain("retained final output");
	});
});
