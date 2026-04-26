import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sweep } from "../../src/state/sweep.js";

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-sweep-"));
});
afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

const writeStateFile = (sessionId: string, agentId: string, partial: Record<string, unknown>) => {
	const dir = path.join(tmp, "subagents", sessionId, agentId);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		path.join(dir, "state.json"),
		JSON.stringify({
			schemaVersion: 1,
			agentId,
			parentAgentId: null,
			sessionId,
			agent: "explore",
			alias: "sweep-agent",
			agentSource: "bundled",
			task: "x",
			cwd: tmp,
			branch: null,
			model: "haiku",
			provider: "anthropic",
			thinking: "low",
			tools: null,
			maxTurns: null,
			pid: null,
			startedAt: 0,
			finishedAt: null,
			lastUpdate: 0,
			status: "done",
			exitCode: 0,
			stopReason: "stop",
			errorMessage: null,
			turns: 0,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 },
			lastText: null,
			lastToolCall: null,
			finalOutput: null,
			paths: {
				state: path.join(dir, "state.json"),
				output: path.join(dir, "output.jsonl"),
				stderr: path.join(dir, "stderr.log"),
				prompt: path.join(dir, "prompt.md"),
			},
			...partial,
		}),
	);
	return path.join(dir, "state.json");
};

describe("sweep", () => {
	it("flips running with dead pid → orphaned", async () => {
		writeStateFile("s1", "aaaaaaaa", { status: "running", pid: 999999 });
		const r = await sweep({ agentDir: tmp, retentionDays: 7 });
		expect(r.orphans).toBe(1);
	});

	it("flips detached with dead pid → orphaned", async () => {
		writeStateFile("s1", "bbbbbbbb", { status: "detached", pid: 999999 });
		const r = await sweep({ agentDir: tmp, retentionDays: 7 });
		expect(r.orphans).toBe(1);
	});

	it("does not orphan running session-mode agents that have no subprocess pid", async () => {
		const stateFile = writeStateFile("s1", "session1", { status: "running", executionMode: "session", pid: null });
		const r = await sweep({ agentDir: tmp, retentionDays: 7 });
		expect(r.orphans).toBe(0);
		expect(JSON.parse(readFileSync(stateFile, "utf-8")).status).toBe("running");
	});

	it("deletes terminal states older than retentionDays", async () => {
		const old = Date.now() - 10 * 86400_000;
		writeStateFile("s1", "11111111", { status: "done", finishedAt: old });
		const r = await sweep({ agentDir: tmp, retentionDays: 7 });
		expect(r.swept).toBe(1);
		expect(existsSync(path.join(tmp, "subagents", "s1", "11111111"))).toBe(false);
	});

	it("preserves recent terminal states", async () => {
		writeStateFile("s1", "22222222", { status: "done", finishedAt: Date.now() });
		const r = await sweep({ agentDir: tmp, retentionDays: 7 });
		expect(r.swept).toBe(0);
	});

	it("removes empty session directories after sweep", async () => {
		const old = Date.now() - 10 * 86400_000;
		writeStateFile("emptysess", "33333333", { status: "done", finishedAt: old });
		await sweep({ agentDir: tmp, retentionDays: 7 });
		expect(existsSync(path.join(tmp, "subagents", "emptysess"))).toBe(false);
	});
});
