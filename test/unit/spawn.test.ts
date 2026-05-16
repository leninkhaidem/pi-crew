import { once } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PI_SUBAGENT_INITIATOR_AGENT, PI_SUBAGENT_INITIATOR_ENV } from "../../src/runtime/copilot-initiator.js";
import { dispatch } from "../../src/runtime/lifecycle.js";
import { closeSpawnFds, spawnSubagent } from "../../src/runtime/spawn.js";
import {
	PI_CREW_SUPPRESS_SUBAGENT_TOOLS_ENV,
	PI_CREW_SUPPRESS_SUBAGENT_TOOLS_VALUE,
} from "../../src/runtime/tool-suppression.js";
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

	it("marks spawned sub-agents to suppress nested pi-crew tools", async () => {
		const runDir = path.join(tmp, "run");
		mkdirSync(runDir, { recursive: true });
		const envPath = path.join(runDir, "env.json");
		const binary = path.join(runDir, "pi-env-recorder");
		writeEnvRecorder(binary, envPath);

		const spawned = spawnSubagent({
			binary,
			model: "mock/mock-model",
			thinking: "low",
			tools: null,
			systemPromptPath: path.join(runDir, "prompt.md"),
			task: "say ok",
			cwd: runDir,
			outputPath: path.join(runDir, "output.jsonl"),
			stderrPath: path.join(runDir, "stderr.log"),
			parentAgentId: "parent",
			sessionId: "session",
		});

		const [code] = await once(spawned.proc, "close");
		closeSpawnFds(spawned);
		const recordedEnv = JSON.parse(readFileSync(envPath, "utf-8")) as Record<string, string | null>;

		expect(code).toBe(0);
		expect(recordedEnv[PI_CREW_SUPPRESS_SUBAGENT_TOOLS_ENV]).toBe(PI_CREW_SUPPRESS_SUBAGENT_TOOLS_VALUE);
		expect(recordedEnv[PI_SUBAGENT_INITIATOR_ENV]).toBe(PI_SUBAGENT_INITIATOR_AGENT);
		expect(recordedEnv.PI_SUBAGENT_PARENT_ID).toBe("parent");
		expect(recordedEnv.PI_SUBAGENT_SESSION_ID).toBe("session");
	});

	it("persists subprocess child prompts without pi-crew delegation guidance", async () => {
		const mock = prepareMockPi({ events: [], exitCode: 0, delayMs: 1 });
		const runDir = path.join(tmp, "run");
		mkdirSync(runDir, { recursive: true });

		try {
			const handle = await dispatch(
				{
					agent: {
						name: "general-purpose",
						description: "test",
						tools: null,
						systemPrompt: "be brief",
						source: "bundled",
						filePath: "/fake.md",
					},
					model: { provider: "mock", modelId: "mock-model", thinking: "low" },
					options: { agent: "general-purpose", alias: "general-test", task: "say ok" },
				},
				{
					agentDir: tmp,
					cwd: runDir,
					sessionId: "session",
					parentAgentId: null,
					binary: mock.binary,
					executionMode: "subprocess",
				},
			);
			const final = await handle.donePromise;
			const prompt = readFileSync(final.paths.prompt, "utf-8");

			expect(prompt).toContain("be brief");
			expect(prompt).not.toContain("## pi-crew sub-agents");
		} finally {
			mock.cleanup();
		}
	});
});

function writeEnvRecorder(binary: string, outputPath: string): void {
	const scriptPath = `${binary}.mjs`;
	const script = `import { writeFileSync } from "node:fs";
const keys = ["${PI_CREW_SUPPRESS_SUBAGENT_TOOLS_ENV}", "${PI_SUBAGENT_INITIATOR_ENV}", "PI_SUBAGENT_PARENT_ID", "PI_SUBAGENT_SESSION_ID"];
const entries = keys.map((key) => [key, process.env[key] ?? null]);
writeFileSync(process.env.PI_CREW_ENV_OUTPUT, JSON.stringify(Object.fromEntries(entries)));
`;
	writeFileSync(scriptPath, script);
	writeFileSync(
		binary,
		`#!/usr/bin/env bash\nexec env PI_CREW_ENV_OUTPUT="${outputPath}" "${process.execPath}" "${scriptPath}" "$@"\n`,
	);
	chmodSync(binary, 0o755);
}
