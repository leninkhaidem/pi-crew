// test/integration/lifecycle.test.ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatch } from "../../src/runtime/lifecycle.js";
import type { AgentConfig } from "../../src/types.js";
import { prepareMockPi } from "../fixtures/mock-runner.js";

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-life-"));
});
afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

const fakeAgent: AgentConfig = {
	name: "explore",
	description: "test",
	tools: ["read"],
	systemPrompt: "be brief",
	source: "bundled",
	filePath: "/fake.md",
};

describe("dispatch (with mock pi) — walking skeleton", () => {
	it("writes terminal state and final output", async () => {
		const mock = prepareMockPi({
			events: [
				{ type: "agent_start" },
				{
					type: "message_update",
					assistantMessageEvent: {
						type: "thinking_end",
						partial: {
							content: [{ type: "thinking", thinking: "hidden", thinkingSignature: "secret" }],
						},
					},
				},
				{
					type: "message_end",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "Found 12 files." }],
						usage: {
							input: 100,
							output: 20,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 120,
							cost: { total: 0.001 },
						},
						stopReason: "stop",
						model: "mock-haiku",
					},
				},
				{
					type: "agent_end",
					messages: [
						{
							role: "assistant",
							content: [{ type: "text", text: "Found 12 files." }],
						},
					],
				},
			],
			exitCode: 0,
			delayMs: 5,
		});

		try {
			const handle = await dispatch(
				{
					agent: fakeAgent,
					model: { provider: "mock", modelId: "mock-haiku", thinking: "low" },
					options: { agent: "explore", alias: "explore-test", task: "find auth" },
				},
				{
					agentDir: tmp,
					cwd: tmp,
					sessionId: "sess1",
					parentAgentId: null,
					binary: mock.binary,
				},
				{},
			);

			const final = await handle.donePromise;
			expect(final.status).toBe("done");
			expect(final.exitCode).toBe(0);
			expect(final.finalOutput).toContain("Found 12 files.");
			expect(final.usage.input).toBe(100);
			expect(final.usage.output).toBe(20);
			expect(final.turns).toBe(1);
			const transcript = readFileSync(final.paths.output, "utf-8");
			expect(transcript).not.toContain("thinkingSignature");
			expect(transcript).not.toContain("hidden");
		} finally {
			mock.cleanup();
		}
	}, 20_000);

	it("defaults thinking for legacy dispatch plans", async () => {
		const mock = prepareMockPi({
			events: [
				{
					type: "agent_end",
					messages: [{ role: "assistant", content: [{ type: "text", text: "ok" }] }],
				},
			],
			exitCode: 0,
			delayMs: 5,
		});

		try {
			const handle = await dispatch(
				{
					agent: fakeAgent,
					model: { provider: "mock", modelId: "mock-haiku" } as Parameters<typeof dispatch>[0]["model"],
					options: { agent: "explore", alias: "explore-test", task: "legacy plan" },
				},
				{
					agentDir: tmp,
					cwd: tmp,
					sessionId: "sess-legacy",
					parentAgentId: null,
					binary: mock.binary,
				},
			);

			const final = await handle.donePromise;
			expect(final.status).toBe("done");
			expect(final.thinking).toBe("low");
		} finally {
			mock.cleanup();
		}
	}, 20_000);

	it("hard-aborts subprocess mode after maxTurns plus grace", async () => {
		const assistantTurn = (text: string) => ({
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text }],
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { total: 0 } },
				stopReason: "toolUse",
			},
		});
		const mock = prepareMockPi({
			events: [assistantTurn("one"), assistantTurn("two"), assistantTurn("three"), assistantTurn("four")],
			exitCode: 0,
			delayMs: 50,
		});

		try {
			const handle = await dispatch(
				{
					agent: fakeAgent,
					model: { provider: "mock", modelId: "mock-haiku", thinking: "low" },
					options: { agent: "explore", alias: "explore-test", task: "loop", maxTurns: 1 },
				},
				{
					agentDir: tmp,
					cwd: tmp,
					sessionId: "sess-max-turns",
					parentAgentId: null,
					binary: mock.binary,
				},
			);
			const final = await handle.donePromise;
			expect(final.status).toBe("aborted");
			expect(final.errorMessage).toContain("maxTurns exceeded (1)");
			expect(final.turns).toBeGreaterThanOrEqual(3);
		} finally {
			mock.cleanup();
		}
	}, 20_000);

	it("handles subprocess overflow compaction and retry streams as recovered success", async () => {
		const mock = prepareMockPi({
			events: [
				{ type: "agent_start" },
				{
					type: "message_end",
					message: {
						role: "assistant",
						stopReason: "error",
						errorMessage: "Your input exceeds the context window of this model",
					},
				},
				{
					type: "agent_end",
					messages: [
						{
							role: "assistant",
							stopReason: "error",
							errorMessage: "Your input exceeds the context window of this model",
						},
					],
				},
				{ type: "compaction_start", reason: "overflow" },
				{
					type: "compaction_end",
					reason: "overflow",
					aborted: false,
					willRetry: true,
					result: { summary: "private compacted context", details: { secret: "omit" } },
				},
				{
					type: "message_end",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "Recovered subprocess output." }],
						usage: { input: 10, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 14, cost: { total: 0 } },
						stopReason: "stop",
					},
				},
				{
					type: "agent_end",
					messages: [{ role: "assistant", content: [{ type: "text", text: "Recovered subprocess output." }] }],
				},
			],
			exitCode: 0,
			delayMs: 5,
		});

		try {
			const handle = await dispatch(
				{
					agent: fakeAgent,
					model: { provider: "mock", modelId: "mock-haiku", thinking: "low" },
					options: { agent: "explore", alias: "explore-test", task: "recover" },
				},
				{
					agentDir: tmp,
					cwd: tmp,
					sessionId: "sess-overflow-success",
					parentAgentId: null,
					binary: mock.binary,
				},
			);
			const final = await handle.donePromise;

			expect(final.status).toBe("done");
			expect(final.finalOutput).toBe("Recovered subprocess output.");
			expect(final.errorMessage).toBeNull();
		} finally {
			mock.cleanup();
		}
	}, 20_000);

	it("fails subprocess overflow recovery when the child exits while recovery is pending", async () => {
		const mock = prepareMockPi({
			events: [{ type: "agent_start" }, { type: "compaction_start", reason: "overflow" }],
			exitCode: 0,
			delayMs: 5,
		});

		try {
			const handle = await dispatch(
				{
					agent: fakeAgent,
					model: { provider: "mock", modelId: "mock-haiku", thinking: "low" },
					options: { agent: "explore", alias: "explore-test", task: "recover" },
				},
				{
					agentDir: tmp,
					cwd: tmp,
					sessionId: "sess-overflow-interrupted",
					parentAgentId: null,
					binary: mock.binary,
				},
			);
			const final = await handle.donePromise;

			expect(final.status).toBe("failed");
			expect(final.exitCode).toBe(-1);
			expect(final.stopReason).toBe("context_overflow_recovery_failed");
			expect(final.errorMessage).toContain("Context overflow recovery failed");
			expect(final.finalOutput).toBeNull();
		} finally {
			mock.cleanup();
		}
	}, 20_000);

	it("preserves subprocess user abort while overflow recovery is pending", async () => {
		const mock = prepareMockPi({
			events: [
				{ type: "agent_start" },
				{ type: "compaction_start", reason: "overflow" },
				...Array.from({ length: 50 }, () => ({ type: "tool_execution_update", partialResult: "waiting" })),
			],
			exitCode: 0,
			delayMs: 50,
		});

		try {
			const handle = await dispatch(
				{
					agent: fakeAgent,
					model: { provider: "mock", modelId: "mock-haiku", thinking: "low" },
					options: { agent: "explore", alias: "explore-test", task: "recover" },
				},
				{
					agentDir: tmp,
					cwd: tmp,
					sessionId: "sess-overflow-user-abort",
					parentAgentId: null,
					binary: mock.binary,
				},
			);
			await new Promise((resolve) => setTimeout(resolve, 120));
			await handle.abort?.("user canceled");
			const final = await handle.donePromise;

			expect(final.status).toBe("aborted");
			expect(final.errorMessage).toBe("user canceled");
			expect(final.stopReason).not.toBe("context_overflow_recovery_failed");
		} finally {
			mock.cleanup();
		}
	}, 20_000);

	it("captures spawn errors instead of leaving the subprocess promise hanging", async () => {
		const handle = await dispatch(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "mock-haiku", thinking: "low" },
				options: { agent: "explore", alias: "explore-test", task: "missing binary" },
			},
			{
				agentDir: tmp,
				cwd: tmp,
				sessionId: "sess-spawn-error",
				parentAgentId: null,
				binary: path.join(tmp, "does-not-exist"),
			},
		);

		const final = await handle.donePromise;
		expect(final.status).toBe("failed");
		expect(final.errorMessage).toBeTruthy();
	}, 20_000);

	it("captures failure when subprocess exits non-zero", async () => {
		const mock = prepareMockPi({
			events: [{ type: "agent_start" }],
			exitCode: 1,
			stderr: "bad happened\n",
			delayMs: 5,
		});

		try {
			const handle = await dispatch(
				{
					agent: fakeAgent,
					model: { provider: "mock", modelId: "mock-haiku", thinking: "low" },
					options: { agent: "explore", alias: "explore-test", task: "should fail" },
				},
				{
					agentDir: tmp,
					cwd: tmp,
					sessionId: "sess2",
					parentAgentId: null,
					binary: mock.binary,
				},
			);
			const final = await handle.donePromise;
			expect(final.status).toBe("failed");
			expect(final.exitCode).toBe(1);
			expect(final.errorMessage).toContain("bad happened");
		} finally {
			mock.cleanup();
		}
	}, 20_000);
});
