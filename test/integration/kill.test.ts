// test/integration/kill.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { abortSubagentByStatePath } from "../../src/runtime/kill.js";
import { dispatch } from "../../src/runtime/lifecycle.js";
import { readState, writeState } from "../../src/state/store.js";
import type { AgentConfig, SubagentState } from "../../src/types.js";
import { prepareMockPi } from "../fixtures/mock-runner.js";

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-kill-"));
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

describe("kill flow", () => {
	it("kills a running process and preserves the interrupted status", async () => {
		const mock = prepareMockPi({
			events: [
				{ type: "agent_start" },
				{
					type: "message_end",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "still working" }],
						usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { total: 0 } },
						stopReason: "stop",
						model: "mock",
					},
				},
			],
			exitCode: 0,
			delayMs: 1000,
		});

		try {
			const handle = await dispatch(
				{
					agent: fakeAgent,
					model: { provider: "mock", modelId: "mock", thinking: "low" },
					options: { agent: "explore", alias: "explore-test", task: "test parent interrupt" },
				},
				{
					agentDir: tmp,
					cwd: tmp,
					sessionId: "sess-parent-interrupt",
					parentAgentId: null,
					binary: mock.binary,
				},
			);

			const result = await abortSubagentByStatePath(handle.state.paths.state, "parent ask interrupted");
			expect(result.ok).toBe(true);
			const final = await handle.donePromise;
			expect(final.status).toBe("aborted");
			expect(final.errorMessage).toBe("parent ask interrupted");
		} finally {
			mock.cleanup();
		}
	}, 20_000);

	it("preserves aborted status when external writer finalizes state before subprocess close", async () => {
		// Mock pi: emits a few events spaced 100ms apart, then exits 0.
		// Plenty of time for our test to write "aborted" status mid-flight.
		const mock = prepareMockPi({
			events: [
				{ type: "agent_start" },
				{
					type: "message_end",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "step 1" }],
						usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { total: 0 } },
						stopReason: "stop",
						model: "mock",
					},
				},
				{
					type: "message_end",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "step 2" }],
						usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { total: 0 } },
						stopReason: "stop",
						model: "mock",
					},
				},
				{
					type: "agent_end",
					messages: [{ role: "assistant", content: [{ type: "text", text: "done" }] }],
				},
			],
			exitCode: 1, // Will be remapped to "aborted" since we externally write that status first.
			delayMs: 100,
		});

		try {
			const handle = await dispatch(
				{
					agent: fakeAgent,
					model: { provider: "mock", modelId: "mock", thinking: "low" },
					options: { agent: "explore", alias: "explore-test", task: "test kill" },
				},
				{
					agentDir: tmp,
					cwd: tmp,
					sessionId: "sess-kill",
					parentAgentId: null,
					binary: mock.binary,
				},
			);

			// Simulate subagent_kill: externally write "aborted" status to the state file.
			// Wait briefly so the dispatch lifecycle has had time to start the subprocess.
			await new Promise((r) => setTimeout(r, 50));
			const current = await readState(handle.state.paths.state);
			expect(current).not.toBeNull();
			const aborted: SubagentState = {
				...(current as SubagentState),
				status: "aborted",
				exitCode: -1,
				errorMessage: "killed by user",
				finishedAt: Date.now(),
				lastUpdate: Date.now(),
			};
			await writeState(aborted);

			// Now wait for the subprocess to actually exit and close handler to run.
			const final = await handle.donePromise;

			// Critical assertion: status must remain "aborted", not "failed".
			expect(final.status).toBe("aborted");
			expect(final.errorMessage).toBe("killed by user");
			// exitCode should reflect the actual subprocess exit (still tracked).
			expect(final.exitCode).toBe(1);
		} finally {
			mock.cleanup();
		}
	}, 20_000);

	it("preserves detached status when external writer finalizes state before subprocess close", async () => {
		const mock = prepareMockPi({
			events: [
				{ type: "agent_start" },
				{
					type: "message_end",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "step 1" }],
						usage: {
							input: 10,
							output: 5,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 15,
							cost: { total: 0 },
						},
						stopReason: "stop",
						model: "mock",
					},
				},
				{
					type: "agent_end",
					messages: [{ role: "assistant", content: [{ type: "text", text: "done" }] }],
				},
			],
			exitCode: 0,
			delayMs: 100,
		});

		try {
			const handle = await dispatch(
				{
					agent: fakeAgent,
					model: { provider: "mock", modelId: "mock", thinking: "low" },
					options: { agent: "explore", alias: "explore-test", task: "test detached" },
				},
				{
					agentDir: tmp,
					cwd: tmp,
					sessionId: "sess-detached",
					parentAgentId: null,
					binary: mock.binary,
				},
			);

			// Simulate session_shutdown writing detached to disk while subprocess still runs.
			await new Promise((r) => setTimeout(r, 50));
			const current = await readState(handle.state.paths.state);
			expect(current).not.toBeNull();
			const detached: SubagentState = {
				...(current as SubagentState),
				status: "detached",
				lastUpdate: Date.now(),
			};
			await writeState(detached);

			const final = await handle.donePromise;
			expect(final.status).toBe("detached");
		} finally {
			mock.cleanup();
		}
	}, 20_000);

	it("normal failure path still writes 'failed' when no external override", async () => {
		const mock = prepareMockPi({
			events: [{ type: "agent_start" }],
			exitCode: 1,
			stderr: "boom\n",
			delayMs: 5,
		});
		try {
			const handle = await dispatch(
				{
					agent: fakeAgent,
					model: { provider: "mock", modelId: "mock", thinking: "low" },
					options: { agent: "explore", alias: "explore-test", task: "test fail" },
				},
				{
					agentDir: tmp,
					cwd: tmp,
					sessionId: "sess-fail",
					parentAgentId: null,
					binary: mock.binary,
				},
			);
			const final = await handle.donePromise;
			expect(final.status).toBe("failed");
			expect(final.errorMessage).toContain("boom");
		} finally {
			mock.cleanup();
		}
	}, 20_000);
});
