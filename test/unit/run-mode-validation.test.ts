import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDetachController } from "../../src/runtime/detach.js";
import { registerRunTool } from "../../src/tools/run.js";
import {
	DEFAULT_GLOBAL_SETTINGS,
	DEFAULT_TMUX_SETTINGS,
	type PiCrewConfig,
	type SubagentState,
} from "../../src/types.js";

const mocks = vi.hoisted(() => ({
	dispatch: vi.fn(),
}));

vi.mock("../../src/runtime/lifecycle.js", () => ({
	dispatch: mocks.dispatch,
}));

type ToolExecute = (
	id: string,
	params: Record<string, unknown>,
	signal?: AbortSignal,
	onUpdate?: unknown,
	ctx?: unknown,
) => Promise<unknown>;

type RunTool = { execute: ToolExecute };

const config: PiCrewConfig = {
	version: 1,
	agents: {
		"general-purpose": { provider: "openai-codex", modelId: "gpt-5.4-mini", thinking: "low" },
	},
	global: { ...DEFAULT_GLOBAL_SETTINGS },
	tmux: DEFAULT_TMUX_SETTINGS,
};

let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-fix-run-mode-selection-v072-a1-test-"));
	const bundledAgentsDir = path.join(tmp, "bundled-agents");
	mkdirSync(bundledAgentsDir, { recursive: true });
	writeFileSync(
		path.join(bundledAgentsDir, "general-purpose.md"),
		"---\nname: general-purpose\ndescription: test agent\n---\n\nbody\n",
	);
	mocks.dispatch.mockReset();
	mocks.dispatch.mockImplementation(async () => {
		const state = stateOf();
		return { agentId: state.agentId, state, donePromise: Promise.resolve(state) };
	});
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

describe("subagent_run mode selection", () => {
	it("accepts single mode with empty tasks and chain placeholders", async () => {
		const result = await execute({ agent: "general-purpose", alias: "worker", task: "do work", tasks: [], chain: [] });

		expect(result).not.toMatchObject({ details: { error: "invalid_args" } });
		expect(result).toMatchObject({ details: { status: "done" } });
		expect(mocks.dispatch).toHaveBeenCalledOnce();
	});

	it("accepts batch mode with an empty chain placeholder", async () => {
		const result = await execute({
			tasks: [{ agent: "general-purpose", alias: "worker", task: "do work" }],
			chain: [],
		});

		expect(result).not.toMatchObject({ details: { error: "invalid_args" } });
		expect(result).toMatchObject({ details: { results: [{ status: "done" }] } });
		expect(mocks.dispatch).toHaveBeenCalledOnce();
	});

	it.each([
		["empty-only arrays", { tasks: [], chain: [] }],
		["single and batch modes", { agent: "general-purpose", alias: "worker", task: "do work", tasks: [task()] }],
		["batch and chain modes", { tasks: [task()], chain: [chainStep()] }],
	])("rejects %s", async (_label, params) => {
		const result = await execute(params);

		expect(result).toMatchObject({ details: { error: "invalid_args" } });
		expect(mocks.dispatch).not.toHaveBeenCalled();
	});
});

async function execute(params: Record<string, unknown>) {
	const tools = new Map<string, RunTool>();
	const detach = createDetachController();
	const pi = { registerTool: vi.fn((tool: RunTool & { name: string }) => tools.set(tool.name, tool)) };
	const rt = {
		userAgentsDir: path.join(tmp, "user-agents"),
		bundledAgentsDir: path.join(tmp, "bundled-agents"),
		getConfig: vi.fn(async () => config),
		ensureProjectAgentApproved: vi.fn(async () => true),
		envFor: vi.fn(() => ({})),
		lifecycleHooks: vi.fn(() => ({})),
		trackHandle: vi.fn(),
		trackParentAbort: vi.fn(),
		consumeCompletion: vi.fn(),
		concurrency: {
			active: { tryAcquire: vi.fn(() => true), release: vi.fn(), current: vi.fn(() => 0) },
			pool: { run: (fn: () => unknown) => fn() },
		},
		detach,
	};

	registerRunTool(pi as never, rt as never);
	return tools.get("subagent_run")!.execute("call", params, undefined, undefined, { cwd: tmp });
}

function task() {
	return { agent: "general-purpose", alias: "worker", task: "do work" };
}

function chainStep() {
	return { agent: "general-purpose", alias: "step", task: "do work" };
}

function stateOf(): SubagentState {
	return {
		schemaVersion: 1,
		agentId: "agent-abc123",
		parentAgentId: null,
		sessionId: "sess",
		agent: "general-purpose",
		alias: "worker",
		agentSource: "bundled",
		task: "do work",
		cwd: tmp,
		branch: null,
		model: "gpt-5.4-mini",
		provider: "openai-codex",
		thinking: "low",
		tools: null,
		maxTurns: null,
		pid: null,
		startedAt: 0,
		finishedAt: 1,
		lastUpdate: 1,
		status: "done",
		exitCode: 0,
		stopReason: "stop",
		errorMessage: null,
		turns: 1,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 },
		lastText: null,
		lastToolCall: null,
		finalOutput: "task done",
		paths: {
			state: "/tmp/state.json",
			output: "/tmp/output.jsonl",
			stderr: "/tmp/stderr.log",
			prompt: "/tmp/prompt.md",
		},
	};
}
