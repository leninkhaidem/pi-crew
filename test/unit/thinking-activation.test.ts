import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDetachController } from "../../src/runtime/detach.js";
import { registerDispatchTool } from "../../src/tools/dispatch.js";
import { registerRunTool } from "../../src/tools/run.js";
import {
	DEFAULT_GLOBAL_SETTINGS,
	DEFAULT_TMUX_SETTINGS,
	type PiCrewConfig,
	type SubagentState,
} from "../../src/types.js";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("../../src/runtime/lifecycle.js", () => ({ dispatch: mocks.dispatch }));

const warning = 'Warning: requested thinking level "max" is unsupported by the selected model; using "high" instead.';
let tmp: string;
let userAgentsDir: string;
let bundledAgentsDir: string;

beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-thinking-activation-"));
	userAgentsDir = path.join(tmp, "user");
	bundledAgentsDir = path.join(tmp, "bundled");
	mkdirSync(userAgentsDir, { recursive: true });
	mkdirSync(bundledAgentsDir, { recursive: true });
	for (const name of ["explore", "general-purpose"]) {
		writeFileSync(path.join(bundledAgentsDir, `${name}.md`), `---\nname: ${name}\ndescription: ${name}\n---\nbody\n`);
	}
	mocks.dispatch.mockReset();
	let sequence = 0;
	mocks.dispatch.mockImplementation(async (plan) => {
		const state = stateOf({
			agentId: `agent-${++sequence}`,
			agent: plan.agent.name,
			alias: plan.options.alias,
			task: plan.options.task,
			thinking: plan.model.thinking,
			thinkingAdjustment: plan.thinkingAdjustment,
			provider: plan.model.provider,
			model: plan.model.modelId,
		});
		return { agentId: state.agentId, state, donePromise: Promise.resolve(state) };
	});
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("normal launch activation", () => {
	it.each([
		["background", "general-purpose"],
		["coerced blocking explore", "explore"],
	] as const)("forwards effective thinking and warning for %s dispatch", async (_label, agent) => {
		const { rt, config } = runtime();
		const tool = registeredDispatch(rt);
		const result = await tool.execute(
			"call",
			{ agent, alias: "worker", task: "do work" },
			undefined,
			undefined,
			context(),
		);
		const plan = mocks.dispatch.mock.calls[0]?.[0];
		expect(plan.model.thinking).toBe("high");
		expect(plan.thinkingAdjustment).toEqual({ requested: "max", effective: "high" });
		expect(config.agents[agent]).toMatchObject({ thinking: "max" });
		expect(result.content[0]?.text).toContain(warning);
		expect(result.details).toMatchObject({
			thinking: "high",
			thinkingAdjustment: { requested: "max", effective: "high" },
		});
	});

	it.each([
		["single", { agent: "general-purpose", alias: "one", task: "one" }, 1],
		[
			"parallel",
			{
				tasks: [
					{ agent: "general-purpose", alias: "one", task: "one" },
					{ agent: "general-purpose", alias: "two", task: "two" },
				],
			},
			2,
		],
		[
			"chain",
			{
				chain: [
					{ agent: "general-purpose", alias: "one", task: "one" },
					{ agent: "general-purpose", alias: "two", task: "two {previous}" },
				],
			},
			2,
		],
	] as const)("forwards effective thinking through blocking %s runs", async (_label, params, count) => {
		const { rt, config } = runtime();
		const tool = registeredRun(rt);
		const result = await tool.execute("call", params as never, undefined, undefined, context());
		expect(mocks.dispatch).toHaveBeenCalledTimes(count);
		for (const [plan] of mocks.dispatch.mock.calls) {
			expect(plan.model.thinking).toBe("high");
			expect(plan.thinkingAdjustment).toEqual({ requested: "max", effective: "high" });
		}
		expect(config.agents["general-purpose"]).toMatchObject({ thinking: "max" });
		expect(result.content[0]?.text).toContain(warning);
		if (count === 2) {
			const results = result.details.results as Array<Record<string, unknown>>;
			expect(results).toHaveLength(2);
			expect(results.every((item) => item.thinking === "high")).toBe(true);
			expect(
				results.every(
					(item) => JSON.stringify(item.thinkingAdjustment) === JSON.stringify({ requested: "max", effective: "high" }),
				),
			).toBe(true);
		}
	});

	it("retains effective thinking and warning when Ctrl+B backgrounds a blocking run", async () => {
		let resolveDone!: (state: SubagentState) => void;
		const pending = new Promise<SubagentState>((resolve) => {
			resolveDone = resolve;
		});
		const adjusted = stateOf({
			agentId: "backgrounded",
			thinking: "high",
			thinkingAdjustment: { requested: "max", effective: "high" },
			status: "running",
			finishedAt: null,
		});
		mocks.dispatch.mockResolvedValueOnce({ agentId: adjusted.agentId, state: adjusted, donePromise: pending });
		const { rt, detach } = runtime();
		const tool = registeredRun(rt);
		const execution = tool.execute(
			"call",
			{ agent: "general-purpose", alias: "worker", task: "work" },
			undefined,
			undefined,
			context(),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		detach.detachAll();
		const result = await execution;
		expect(result.content[0]?.text).toContain(warning);
		expect(result.details).toMatchObject({
			status: "backgrounded",
			thinking: "high",
			thinkingAdjustment: { requested: "max", effective: "high" },
		});
		resolveDone({ ...adjusted, status: "done", finishedAt: 1 });
	});

	it("keeps item-specific provenance when Ctrl+B backgrounds a parallel batch", async () => {
		const pending = [deferredState(), deferredState()];
		mocks.dispatch.mockReset();
		mocks.dispatch
			.mockResolvedValueOnce(handleFor("batch-one", pending[0]!.promise))
			.mockResolvedValueOnce(handleFor("batch-two", pending[1]!.promise));
		const { rt, detach } = runtime();
		const execution = registeredRun(rt).execute(
			"call",
			{
				tasks: [
					{ agent: "general-purpose", alias: "one", task: "one" },
					{ agent: "general-purpose", alias: "two", task: "two" },
				],
			},
			undefined,
			undefined,
			context(),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		detach.detachAll();
		const result = await execution;
		const backgrounded = result.details.backgrounded as Array<Record<string, unknown>>;
		expect(backgrounded).toHaveLength(2);
		expect(backgrounded.every((item) => item.thinking === "high")).toBe(true);
		expect(
			backgrounded.every(
				(item) => JSON.stringify(item.thinkingAdjustment) === JSON.stringify({ requested: "max", effective: "high" }),
			),
		).toBe(true);
		expect(result.content[0]?.text.match(/Warning: requested thinking level/g)).toHaveLength(2);
		pending.forEach((item, index) => item.resolve(stateOf({ agentId: `batch-${index}`, status: "done" })));
	});

	it("keeps current-step provenance and abandoned metadata when Ctrl+B backgrounds a chain", async () => {
		const pending = deferredState();
		mocks.dispatch.mockReset();
		mocks.dispatch
			.mockResolvedValueOnce(handleFor("chain-done", Promise.resolve(stateOf({ agentId: "chain-done" }))))
			.mockResolvedValueOnce(handleFor("chain-pending", pending.promise));
		const { rt, detach } = runtime();
		const execution = registeredRun(rt).execute(
			"call",
			{
				chain: [
					{ agent: "general-purpose", alias: "one", task: "one" },
					{ agent: "general-purpose", alias: "two", task: "two" },
					{ agent: "general-purpose", alias: "three", task: "three" },
				],
			},
			undefined,
			undefined,
			context(),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		detach.detachAll();
		const result = await execution;
		expect(result.details.abandoned).toEqual(["three"]);
		expect(result.details.backgrounded).toEqual([
			expect.objectContaining({
				agentId: "chain-pending",
				thinking: "high",
				thinkingAdjustment: { requested: "max", effective: "high" },
			}),
		]);
		expect(result.content[0]?.text).toContain(warning);
		pending.resolve(stateOf({ agentId: "chain-pending", status: "done" }));
	});
});

function runtime() {
	const config: PiCrewConfig = {
		version: 1,
		agents: {
			explore: { provider: "example", modelId: "reasoner", thinking: "max" },
			"general-purpose": { provider: "example", modelId: "reasoner", thinking: "max" },
		},
		global: { ...DEFAULT_GLOBAL_SETTINGS },
		tmux: { ...DEFAULT_TMUX_SETTINGS },
	};
	const detach = createDetachController();
	return {
		config,
		detach,
		rt: {
			userAgentsDir,
			bundledAgentsDir,
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
		},
	};
}

function context() {
	return {
		cwd: tmp,
		modelRegistry: {
			find: vi.fn(() => ({
				provider: "example",
				id: "reasoner",
				reasoning: true,
				thinkingLevelMap: { xhigh: null, max: null },
			})),
		},
	} as never;
}

function registeredDispatch(rt: unknown): Tool {
	let tool: Tool | undefined;
	registerDispatchTool(
		{
			registerTool: (value: Tool) => {
				tool = value;
			},
		} as never,
		rt as never,
	);
	if (!tool) throw new Error("dispatch tool not registered");
	return tool;
}

function registeredRun(rt: unknown): Tool {
	let tool: Tool | undefined;
	registerRunTool(
		{
			registerTool: (value: Tool) => {
				tool = value;
			},
		} as never,
		rt as never,
	);
	if (!tool) throw new Error("run tool not registered");
	return tool;
}

interface ToolResult {
	content: Array<{ text: string }>;
	details: Record<string, unknown>;
}

interface Tool {
	execute(
		id: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
		onUpdate?: unknown,
		ctx?: unknown,
	): Promise<ToolResult>;
}

function deferredState() {
	let resolve!: (state: SubagentState) => void;
	const promise = new Promise<SubagentState>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function handleFor(agentId: string, donePromise: Promise<SubagentState>) {
	const state = stateOf({
		agentId,
		alias: agentId,
		status: "running",
		finishedAt: null,
		thinking: "high",
		thinkingAdjustment: { requested: "max", effective: "high" },
	});
	return { agentId, state, donePromise };
}

function stateOf(overrides: Partial<SubagentState>): SubagentState {
	return {
		schemaVersion: 1,
		agentId: "agent",
		parentAgentId: null,
		sessionId: "session",
		agent: "general-purpose",
		alias: "worker",
		agentSource: "bundled",
		task: "work",
		cwd: tmp,
		branch: null,
		model: "reasoner",
		provider: "example",
		thinking: "high",
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
		usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 3 },
		lastText: null,
		lastToolCall: null,
		finalOutput: "done",
		paths: { state: "/state", output: "/output", stderr: "/stderr", prompt: "/prompt" },
		...overrides,
	};
}
