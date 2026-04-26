import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "../../src/types.js";

let tmp: string;
let fakeSession: {
	messages: unknown[];
	subscribe: ReturnType<typeof vi.fn>;
	getActiveToolNames: ReturnType<typeof vi.fn>;
	setActiveToolsByName: ReturnType<typeof vi.fn>;
	bindExtensions: ReturnType<typeof vi.fn>;
	prompt: ReturnType<typeof vi.fn>;
	abort: ReturnType<typeof vi.fn>;
	steer: ReturnType<typeof vi.fn>;
	dispose: ReturnType<typeof vi.fn>;
};

vi.mock("@mariozechner/pi-coding-agent", () => ({
	DefaultResourceLoader: class {
		async reload() {
			return undefined;
		}
	},
	SessionManager: { inMemory: vi.fn(() => ({})) },
	SettingsManager: { create: vi.fn(() => ({})) },
	createAgentSession: vi.fn(async () => ({ session: fakeSession })),
}));

const fakeAgent: AgentConfig = {
	name: "general-purpose",
	description: "test",
	tools: null,
	systemPrompt: "be brief",
	source: "bundled",
	filePath: "/fake.md",
};

describe("dispatchSession", () => {
	let subscriber: ((event: unknown) => void) | undefined;

	beforeEach(() => {
		tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-session-"));
		subscriber = undefined;
		fakeSession = {
			messages: [{ role: "assistant", content: [{ type: "text", text: "ok" }] }],
			subscribe: vi.fn((listener) => {
				subscriber = listener;
				return () => undefined;
			}),
			getActiveToolNames: vi.fn(() => ["read", "subagent_dispatch", "bash"]),
			setActiveToolsByName: vi.fn(),
			bindExtensions: vi.fn(async () => undefined),
			prompt: vi.fn(async () => undefined),
			abort: vi.fn(async () => undefined),
			steer: vi.fn(async () => undefined),
			dispose: vi.fn(),
		};
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("does not fail completed final answers that arrive on the max-turn hard-abort boundary", async () => {
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");
		fakeSession.prompt = vi.fn(async () => {
			subscriber?.({ type: "turn_end", message: { role: "assistant", stopReason: "toolUse" } });
			subscriber?.({ type: "turn_end", message: { role: "assistant", stopReason: "toolUse" } });
			fakeSession.messages = [{ role: "assistant", content: [{ type: "text", text: "final answer" }] }];
			subscriber?.({
				type: "message_end",
				message: {
					role: "assistant",
					stopReason: "stop",
					content: [{ type: "text", text: "final answer" }],
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { total: 0 } },
				},
			});
			subscriber?.({ type: "turn_end", message: { role: "assistant", stopReason: "stop" } });
		});

		const handle = await dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "general-test", task: "say ok", maxTurns: 1 },
			},
			{
				agentDir: tmp,
				cwd: tmp,
				sessionId: "sess",
				parentAgentId: null,
				ctx: {
					modelRegistry: { find: vi.fn(() => ({ provider: "mock", id: "model" })) },
				} as never,
			},
		);
		const final = await handle.donePromise;

		expect(final.status).toBe("done");
		expect(final.finalOutput).toBe("final answer");
		expect(fakeSession.abort).not.toHaveBeenCalled();
	});

	it("binds extensions so extension-provided skills/resources are inherited by session-mode sub-agents", async () => {
		const { dispatchSession } = await import("../../src/runtime/session-lifecycle.js");

		const handle = await dispatchSession(
			{
				agent: fakeAgent,
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "general-test", task: "say ok" },
			},
			{
				agentDir: tmp,
				cwd: tmp,
				sessionId: "sess",
				parentAgentId: null,
				ctx: {
					modelRegistry: { find: vi.fn(() => ({ provider: "mock", id: "model" })) },
				} as never,
			},
		);
		await handle.donePromise;

		expect(fakeSession.setActiveToolsByName).toHaveBeenCalledWith(["read", "bash"]);
		expect(fakeSession.bindExtensions).toHaveBeenCalledTimes(1);
		expect(fakeSession.bindExtensions).toHaveBeenCalledWith(expect.objectContaining({ onError: expect.any(Function) }));
	});
});
