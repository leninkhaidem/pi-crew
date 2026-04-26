import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAgentTool } from "../../src/tools/agent.js";
import { registerDispatchTool } from "../../src/tools/dispatch.js";
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

const config: PiCrewConfig = {
	version: 1,
	agents: { explore: { provider: "openai-codex", modelId: "gpt-5.4-mini", thinking: "low" } },
	global: DEFAULT_GLOBAL_SETTINGS,
	tmux: DEFAULT_TMUX_SETTINGS,
};

type ToolExecute = (
	id: string,
	params: Record<string, unknown>,
	signal?: AbortSignal,
	onUpdate?: unknown,
	ctx?: unknown,
) => Promise<unknown>;

function writeAgent(dir: string, name: string): void {
	writeFileSync(
		path.join(dir, `${name}.md`),
		["---", `name: ${name}`, `description: ${name} agent`, "---", "", "body", ""].join("\n"),
	);
}

function stateOf(overrides: Partial<SubagentState> = {}): SubagentState {
	return {
		schemaVersion: 1,
		agentId: "abc12345",
		parentAgentId: null,
		sessionId: "sess",
		agent: "explore",
		alias: "repo-map",
		agentSource: "bundled",
		task: "map repo",
		cwd: "/proj",
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
		turns: 2,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 },
		lastText: null,
		lastToolCall: null,
		finalOutput: "EXPLORE_DONE",
		paths: {
			state: "/p/state.json",
			output: "/p/output.jsonl",
			stderr: "/p/stderr.log",
			prompt: "/p/prompt.md",
		},
		...overrides,
	};
}

function runtime(userAgentsDir: string, bundledAgentsDir: string) {
	const release = vi.fn();
	const consumeCompletion = vi.fn();
	return {
		rt: {
			userAgentsDir,
			bundledAgentsDir,
			getConfig: vi.fn(async () => config),
			ensureProjectAgentApproved: vi.fn(async () => true),
			envFor: vi.fn(() => ({})),
			lifecycleHooks: vi.fn(() => ({})),
			trackHandle: vi.fn(),
			trackParentAbort: vi.fn(),
			consumeCompletion,
			concurrency: { active: { tryAcquire: vi.fn(() => true), release, current: vi.fn(() => 0) } },
		},
		release,
		consumeCompletion,
	};
}

describe("explore blocking coercion", () => {
	let tmp: string;
	let userAgentsDir: string;
	let bundledAgentsDir: string;

	beforeEach(() => {
		tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-explore-blocking-"));
		userAgentsDir = path.join(tmp, "user-agents");
		bundledAgentsDir = path.join(tmp, "bundled-agents");
		mkdirSync(userAgentsDir, { recursive: true });
		mkdirSync(bundledAgentsDir, { recursive: true });
		writeAgent(bundledAgentsDir, "explore");
		writeAgent(bundledAgentsDir, "general-purpose");
		mocks.dispatch.mockReset();
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("coerces explore in subagent_dispatch to a blocking result", async () => {
		const final = stateOf();
		mocks.dispatch.mockResolvedValue({ agentId: final.agentId, state: final, donePromise: Promise.resolve(final) });
		const tools = new Map<string, { execute: ToolExecute }>();
		const pi = { registerTool: vi.fn((tool) => tools.set(tool.name, tool)) };
		const { rt, consumeCompletion, release } = runtime(userAgentsDir, bundledAgentsDir);

		registerDispatchTool(pi as never, rt as never);
		const result = (await tools
			.get("subagent_dispatch")
			?.execute("call", { agent: "explore", alias: "repo-map", task: "map repo" }, undefined, undefined, {
				cwd: tmp,
			})) as { content: Array<{ text: string }>; details: { status: string } };

		expect(result.content[0]?.text).toContain("EXPLORE_DONE");
		expect(result.content[0]?.text).not.toContain("Started repo-map");
		expect(result.details.status).toBe("done");
		expect(consumeCompletion).toHaveBeenCalledWith("abc12345");
		expect(release).toHaveBeenCalledOnce();
	});

	it("ignores run_in_background for explore in Agent and blocks", async () => {
		const final = stateOf();
		mocks.dispatch.mockResolvedValue({ agentId: final.agentId, state: final, donePromise: Promise.resolve(final) });
		const tools = new Map<string, { execute: ToolExecute }>();
		const pi = { registerTool: vi.fn((tool) => tools.set(tool.name, tool)) };
		const { rt, consumeCompletion, release } = runtime(userAgentsDir, bundledAgentsDir);

		registerAgentTool(pi as never, rt as never);
		const result = (await tools
			.get("Agent")
			?.execute(
				"call",
				{ subagent_type: "explore", alias: "repo-map", prompt: "map repo", run_in_background: true },
				undefined,
				undefined,
				{ cwd: tmp },
			)) as { content: Array<{ text: string }>; details: { status: string } };

		expect(result.content[0]?.text).toContain("EXPLORE_DONE");
		expect(result.content[0]?.text).not.toContain("Started repo-map");
		expect(result.details.status).toBe("done");
		expect(consumeCompletion).toHaveBeenCalledWith("abc12345");
		expect(release).toHaveBeenCalledOnce();
	});
});
