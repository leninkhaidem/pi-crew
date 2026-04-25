import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeSpawnFds, spawnSubagent } from "../../src/runtime/spawn.js";
import { prepareMockPi } from "../fixtures/mock-runner.js";

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-spawn-"));
});
afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

describe("spawnSubagent", () => {
	it("passes the configured thinking level to pi", async () => {
		const mock = prepareMockPi({ events: [], exitCode: 0, delayMs: 1 });
		const runDir = path.join(tmp, "run");
		mkdirSync(runDir, { recursive: true });

		try {
			const spawned = spawnSubagent({
				binary: mock.binary,
				model: "mock/mock-model",
				thinking: "high",
				tools: null,
				systemPromptPath: path.join(runDir, "prompt.md"),
				task: "say ok",
				cwd: runDir,
				outputPath: path.join(runDir, "output.jsonl"),
				stderrPath: path.join(runDir, "stderr.log"),
				parentAgentId: "parent",
				sessionId: "session",
			} as Parameters<typeof spawnSubagent>[0] & { thinking: "high" });

			const thinkingFlagIndex = spawned.args.indexOf("--thinking");
			expect(thinkingFlagIndex).toBeGreaterThan(-1);
			expect(spawned.args[thinkingFlagIndex + 1]).toBe("high");

			await once(spawned.proc, "close");
			closeSpawnFds(spawned);
		} finally {
			mock.cleanup();
		}
	});
});
