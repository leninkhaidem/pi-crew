// test/integration/lifecycle.test.ts
import { mkdtempSync, rmSync } from "node:fs";
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
					model: { provider: "mock", modelId: "mock-haiku" },
					options: { agent: "explore", task: "find auth" },
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
		} finally {
			mock.cleanup();
		}
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
					model: { provider: "mock", modelId: "mock-haiku" },
					options: { agent: "explore", task: "should fail" },
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
