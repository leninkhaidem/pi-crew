import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeState } from "../../src/state/store.js";
import { registerStatusTool } from "../../src/tools/status.js";
import type { SubagentState, SubagentStatus } from "../../src/types.js";

type RegisteredStatusTool = {
	description: string;
	execute: (
		id: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
		onUpdate?: unknown,
		ctx?: unknown,
	) => Promise<{
		content: Array<{ type: "text"; text: string }>;
		details: Record<string, unknown>;
	}>;
};

const stateOf = (agentDir: string, overrides: Partial<SubagentState>): SubagentState => {
	const agentId = overrides.agentId ?? "agent001";
	const sessionId = overrides.sessionId ?? "sess";
	const status = overrides.status ?? "running";
	const dir = path.join(agentDir, "subagents", sessionId, agentId);
	return {
		schemaVersion: 1,
		agentId,
		parentAgentId: null,
		sessionId,
		agent: "explore",
		alias: `alias-${agentId}`,
		agentSource: "bundled",
		task: `task for ${agentId}`,
		cwd: "/proj",
		branch: null,
		model: "gpt-5.4-mini",
		provider: "openai-codex",
		thinking: "low",
		tools: null,
		maxTurns: null,
		pid: null,
		startedAt: 0,
		finishedAt: status === "starting" || status === "running" ? null : 1,
		lastUpdate: 1,
		status,
		exitCode: null,
		stopReason: null,
		errorMessage: null,
		turns: 1,
		usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 3 },
		lastText: "last secret text",
		lastToolCall: { name: "read", args: { path: "file" } },
		finalOutput: null,
		paths: {
			state: path.join(dir, "state.json"),
			output: path.join(dir, "output.jsonl"),
			stderr: path.join(dir, "stderr.log"),
			prompt: path.join(dir, "prompt.md"),
		},
		...overrides,
	};
};

describe("subagent_status", () => {
	let tmp: string;
	let tool: RegisteredStatusTool;

	beforeEach(() => {
		tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-status-"));
		const pi = {
			registerTool: vi.fn((registeredTool: RegisteredStatusTool) => {
				tool = registeredTool;
			}),
		};
		registerStatusTool(pi as never, { agentDir: tmp, resolveSessionId: () => "sess" } as never);
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("defaults to an uncapped current-session active listing without terminal states", async () => {
		for (let index = 0; index < 12; index++) {
			await writeState(stateOf(tmp, { agentId: `run${index.toString().padStart(2, "0")}`, status: "running" }));
		}
		await writeState(stateOf(tmp, { agentId: "starting", status: "starting" }));
		for (const status of ["done", "failed", "aborted", "orphaned", "detached"] as const) {
			await writeState(stateOf(tmp, { agentId: status, status }));
		}
		await writeState(stateOf(tmp, { agentId: "other-session", sessionId: "other", status: "running" }));

		const result = await tool.execute("call", {}, undefined, undefined, {});
		const states = result.details.states as Array<{ agentId: string; status: SubagentStatus }>;

		expect(result.details.count).toBe(13);
		expect(states).toHaveLength(13);
		expect(states.every((state) => state.status === "running" || state.status === "starting")).toBe(true);
		expect(states.map((state) => state.agentId)).not.toEqual(
			expect.arrayContaining(["done", "failed", "aborted", "orphaned", "detached", "other-session"]),
		);
		expect(result.content[0]?.text).toContain("run11");
	});

	it("returns stopped triage entries with priority sorting, default cap, omission metadata, and compact fields", async () => {
		const longTask = `investigate ${"x".repeat(180)}`;
		const fixtures: Array<[string, SubagentStatus, number]> = [
			["detached-newest", "detached", 9999],
			["aborted-new", "aborted", 9000],
			["aborted-old", "aborted", 8000],
			["orphaned", "orphaned", 7000],
			["failed-new", "failed", 2000],
			["failed-old", "failed", 1000],
		];
		for (const [agentId, status, time] of fixtures) {
			await writeState(
				stateOf(tmp, {
					agentId,
					status,
					finishedAt: status === "orphaned" ? null : time,
					lastUpdate: time,
					task: longTask,
					errorMessage: `error for ${agentId} ${"y".repeat(180)}`,
				}),
			);
		}
		await writeState(stateOf(tmp, { agentId: "done", status: "done", task: "successful done" }));
		await writeState(stateOf(tmp, { agentId: "other-session-failed", sessionId: "other", status: "failed" }));

		const result = await tool.execute("call", { scope: "stopped" }, undefined, undefined, {});
		const details = result.details as {
			count: number;
			totalStopped: number;
			omitted: number;
			limit: number;
			statusCounts: Record<string, number>;
			states: Array<Record<string, unknown>>;
		};

		expect(details.count).toBe(5);
		expect(details.totalStopped).toBe(6);
		expect(details.omitted).toBe(1);
		expect(details.limit).toBe(5);
		expect(details.statusCounts).toEqual({ failed: 2, orphaned: 1, aborted: 2, detached: 1 });
		expect(details.states.map((state) => state.agentId)).toEqual([
			"failed-new",
			"failed-old",
			"orphaned",
			"aborted-new",
			"aborted-old",
		]);
		expect(details.states.map((state) => state.status)).not.toContain("done");
		for (const state of details.states) {
			expect(Object.keys(state).sort()).toEqual([
				"agent",
				"agentId",
				"alias",
				"errorMessagePreview",
				"finishedAt",
				"status",
				"taskPreview",
			]);
			expect(`${state.taskPreview}`).toHaveLength(120);
			expect(`${state.taskPreview}`).toMatch(/…$/);
			expect(`${state.errorMessagePreview}`).toHaveLength(120);
		}
		expect(result.content[0]?.text).toContain("showing 5/6 (limit 5, omitted 1)");
		expect(result.content[0]?.text).not.toContain("output.jsonl");
		expect(result.content[0]?.text).not.toContain("last secret text");
		expect(result.content[0]?.text).not.toContain("successful done");
		expect(result.content[0]?.text).not.toContain("detached-newest");
	});

	it("clamps valid stopped limits above the maximum to ten", async () => {
		for (let index = 0; index < 12; index++) {
			await writeState(
				stateOf(tmp, {
					agentId: `failed${index.toString().padStart(2, "0")}`,
					status: "failed",
					finishedAt: index,
					lastUpdate: index,
				}),
			);
		}

		const result = await tool.execute("call", { scope: "stopped", limit: 50 }, undefined, undefined, {});

		expect(result.details.limit).toBe(10);
		expect(result.details.count).toBe(10);
		expect(result.details.totalStopped).toBe(12);
		expect(result.details.omitted).toBe(2);
	});

	it("rejects invalid stopped limits and removed broad-list arguments", async () => {
		for (const limit of [0, -1, 1.5, "5", Number.NaN]) {
			await expect(tool.execute("call", { scope: "stopped", limit }, undefined, undefined, {})).rejects.toThrow(
				/positive integer/,
			);
		}
		await expect(tool.execute("call", { scope: "session" }, undefined, undefined, {})).rejects.toThrow(
			/scope must be 'active' or 'stopped'/,
		);
		await expect(tool.execute("call", { scope: "all" }, undefined, undefined, {})).rejects.toThrow(
			/scope must be 'active' or 'stopped'/,
		);
		await expect(
			tool.execute("call", { scope: "stopped", includeDetached: true }, undefined, undefined, {}),
		).rejects.toThrow(/unsupported field 'includeDetached'/);
		await expect(tool.execute("call", { limit: 1 }, undefined, undefined, {})).rejects.toThrow(
			/limit is only valid with scope:'stopped'/,
		);
	});

	it("keeps exact agentId lookup across retained sessions without enabling broad listings", async () => {
		await writeState(stateOf(tmp, { agentId: "done-id", sessionId: "old", status: "done", finalOutput: "finished" }));

		const result = await tool.execute("call", { agentId: "done-id" }, undefined, undefined, {});
		const states = result.details.states as Array<{ agentId: string; status: string; paths: unknown; usage: unknown }>;

		expect(result.details.count).toBe(1);
		expect(states[0]).toMatchObject({ agentId: "done-id", status: "done" });
		expect(states[0]?.paths).toBeDefined();
		expect(states[0]?.usage).toBeDefined();
	});
});
