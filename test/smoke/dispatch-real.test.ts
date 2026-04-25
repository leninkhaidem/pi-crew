// test/smoke/dispatch-real.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatch } from "../../src/runtime/lifecycle.js";
import type { AgentConfig } from "../../src/types.js";

if (!process.env.PI_CREW_E2E) {
	describe.skip("real pi (set PI_CREW_E2E=1 to enable)", () => {
		it("placeholder", () => {});
	});
} else {
	let tmp: string;
	beforeEach(() => {
		tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-smoke-"));
	});
	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	const fakeAgent: AgentConfig = {
		name: "explore",
		description: "test",
		tools: ["read", "ls"],
		systemPrompt: "Be terse. Reply 'done' and stop.",
		source: "bundled",
		filePath: "/fake.md",
	};

	describe("real pi smoke", () => {
		it("dispatches and completes (whichever default model is configured)", async () => {
			const handle = await dispatch(
				{
					agent: fakeAgent,
					model: { provider: "openai-codex", modelId: "gpt-5.5", thinking: "low" },
					options: { agent: "explore", task: "say done" },
				},
				{ agentDir: tmp, cwd: tmp, sessionId: "smoke", parentAgentId: null },
				{},
			);
			const final = await handle.donePromise;
			expect(final.status).toBe("done");
			expect(final.exitCode).toBe(0);
		}, 60_000);
	});
}
