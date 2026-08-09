import { once } from "node:events";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatch } from "../../src/runtime/lifecycle.js";
import { closeSpawnFds, spawnSubagent } from "../../src/runtime/spawn.js";
import {
	PI_CREW_SUPPRESS_SUBAGENT_TOOLS_ENV,
	PI_CREW_SUPPRESS_SUBAGENT_TOOLS_VALUE,
} from "../../src/runtime/tool-suppression.js";
import type { SubagentState } from "../../src/types.js";
import { prepareMockPi } from "../fixtures/mock-runner.js";

let writeStateInterceptor:
	| ((state: SubagentState, write: (state: SubagentState) => Promise<void>) => Promise<void>)
	| undefined;

vi.mock("../../src/state/store.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/state/store.js")>();
	return {
		...actual,
		writeState: (state: SubagentState) =>
			writeStateInterceptor ? writeStateInterceptor(state, actual.writeState) : actual.writeState(state),
	};
});

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

let tmp: string;
beforeEach(() => {
	writeStateInterceptor = undefined;
	tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-spawn-"));
});
afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

describe("spawnSubagent", () => {
	it.each(["high", "max"] as const)("passes the effective %s thinking level to pi", async (thinking) => {
		const mock = prepareMockPi({ events: [], exitCode: 0, delayMs: 1 });
		const runDir = path.join(tmp, `run-${thinking}`);
		mkdirSync(runDir, { recursive: true });

		try {
			const spawned = spawnSubagent({
				binary: mock.binary,
				model: "mock/mock-model",
				thinking,
				tools: null,
				systemPromptPath: path.join(runDir, "prompt.md"),
				task: "say ok",
				cwd: runDir,
				outputPath: path.join(runDir, "output.jsonl"),
				stderrPath: path.join(runDir, "stderr.log"),
				parentAgentId: "parent",
				sessionId: "session",
			});

			const thinkingFlagIndex = spawned.args.indexOf("--thinking");
			expect(thinkingFlagIndex).toBeGreaterThan(-1);
			expect(spawned.args[thinkingFlagIndex + 1]).toBe(thinking);

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
		expect(recordedEnv.PI_SUBAGENT_PARENT_ID).toBe("parent");
		expect(recordedEnv.PI_SUBAGENT_SESSION_ID).toBe("session");
	});

	it("fences subprocess spawn when pre-spawn state persistence resolves after abort", async () => {
		const ledger: string[] = [];
		const persistenceDone = deferred<void>();
		writeStateInterceptor = async (state, write) => {
			if (state.status === "starting") {
				ledger.push("persist:start");
				await persistenceDone.promise;
				await write(state);
				ledger.push("persist:end");
				return;
			}
			if (state.status === "aborted") ledger.push("terminal:aborted");
			await write(state);
		};
		const controller = new AbortController();
		const pending = dispatch(
			{
				agent: {
					name: "general-purpose",
					description: "test",
					tools: null,
					systemPrompt: "be brief",
					source: "bundled",
					filePath: "/fake.md",
				},
				model: { provider: "mock", modelId: "model", thinking: "low" },
				options: { agent: "general-purpose", alias: "deferred-persistence", task: "never" },
			},
			{
				agentDir: tmp,
				cwd: tmp,
				sessionId: "deferred-persistence",
				parentAgentId: null,
				executionMode: "subprocess",
				binary: "/definitely/not/spawned",
				signal: controller.signal,
			},
			{ onEnd: (state) => ledger.push(`end:${state.status}`) },
		);
		await vi.waitFor(() => expect(ledger).toContain("persist:start"));
		controller.abort();
		ledger.push("abort");
		persistenceDone.resolve();

		const handle = await pending;
		expect(handle.state.status).toBe("aborted");
		expect(handle.state.pid).toBeNull();
		expect(ledger).toEqual(["persist:start", "abort", "persist:end", "terminal:aborted", "end:aborted"]);
		expect(existsSync(handle.state.paths.prompt)).toBe(false);
		expect(existsSync(handle.state.paths.output)).toBe(false);
		expect(existsSync(handle.state.paths.stderr)).toBe(false);
	});

	it("rejects an already-aborted subprocess launch before files or spawn", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			dispatch(
				{
					agent: {
						name: "general-purpose",
						description: "test",
						tools: null,
						systemPrompt: "be brief",
						source: "bundled",
						filePath: "/fake.md",
					},
					model: { provider: "mock", modelId: "model", thinking: "low" },
					options: { agent: "general-purpose", alias: "aborted", task: "never" },
				},
				{
					agentDir: tmp,
					cwd: tmp,
					sessionId: "aborted",
					parentAgentId: null,
					executionMode: "subprocess",
					signal: controller.signal,
				},
			),
		).rejects.toThrow("Interrupted before sub-agent launch");
		expect(existsSync(path.join(tmp, "subagents"))).toBe(false);
	});

	it("rejects runtime-only parent auth before subprocess files or spawn", async () => {
		const runDir = path.join(tmp, "runtime-only");
		mkdirSync(runDir, { recursive: true });
		await expect(
			dispatch(
				{
					agent: {
						name: "general-purpose",
						description: "test",
						tools: null,
						systemPrompt: "be brief",
						source: "bundled",
						filePath: "/fake.md",
					},
					model: { provider: "mock", modelId: "model", thinking: "low" },
					options: { agent: "general-purpose", alias: "runtime-only", task: "never" },
				},
				{
					agentDir: tmp,
					cwd: runDir,
					sessionId: "runtime-only",
					parentAgentId: null,
					executionMode: "subprocess",
					binary: "/definitely/not/spawned",
					ctx: {
						modelRegistry: { getProviderAuthStatus: () => ({ configured: true, source: "runtime" }) },
					} as never,
				},
			),
		).rejects.toThrow("cannot use runtime-only authentication");
		expect(existsSync(path.join(tmp, "subagents"))).toBe(false);
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
const keys = ["${PI_CREW_SUPPRESS_SUBAGENT_TOOLS_ENV}", "PI_SUBAGENT_PARENT_ID", "PI_SUBAGENT_SESSION_ID"];
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
