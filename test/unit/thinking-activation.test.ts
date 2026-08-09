import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
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
		const state = stateForPlan(plan, {
			agentId: `agent-${++sequence}`,
			finalOutput: `output:${plan.options.alias}`,
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

	it("keeps mixed adjusted and unadjusted parallel launches associated with their real result shapes", async () => {
		const { rt } = runtime();
		const tool = registeredRun(rt);
		const result = await tool.execute(
			"call",
			{
				tasks: [
					{ agent: "general-purpose", alias: "adjusted-parallel", task: "adjusted", model: "reasoner" },
					{ agent: "general-purpose", alias: "plain-parallel", task: "plain", model: "max-capable" },
				],
			},
			undefined,
			undefined,
			context(),
		);

		expectLaunchAssociation([
			{ alias: "adjusted-parallel", model: "reasoner", thinking: "high", adjusted: true },
			{ alias: "plain-parallel", model: "max-capable", thinking: "max", adjusted: false },
		]);
		const results = result.details.results as Array<Record<string, unknown>>;
		expect(results).toEqual([
			expect.objectContaining({
				agentId: "agent-1",
				alias: "adjusted-parallel",
				model: "reasoner",
				thinking: "high",
				thinkingAdjustment: { requested: "max", effective: "high" },
				status: "done",
				finalOutput: "output:adjusted-parallel",
			}),
			expect.objectContaining({
				agentId: "agent-2",
				alias: "plain-parallel",
				model: "max-capable",
				thinking: "max",
				status: "done",
				finalOutput: "output:plain-parallel",
			}),
		]);
		expect(results[1]).not.toHaveProperty("thinkingAdjustment");
		expect(result.content[0]?.text).toContain("output:adjusted-parallel");
		expect(result.content[0]?.text).toContain("output:plain-parallel");
		assertRealBatchRendering(tool, result, [
			{ agentId: "agent-1", alias: "adjusted-parallel", status: "done", thinking: "high", warning: true },
			{ agentId: "agent-2", alias: "plain-parallel", status: "done", thinking: "max", warning: false },
		]);
	});

	it("keeps mixed chain launch provenance bound through failure and partial output", async () => {
		mocks.dispatch.mockImplementation(async (plan) => {
			const failed = plan.options.alias === "plain-chain";
			const state = stateForPlan(plan, {
				agentId: `chain-${plan.options.alias}`,
				status: failed ? "failed" : "done",
				exitCode: failed ? 1 : 0,
				errorMessage: failed ? "plain chain failed" : null,
				finalOutput: failed ? null : "adjusted chain output",
			});
			return { agentId: state.agentId, state, donePromise: Promise.resolve(state) };
		});
		const { rt } = runtime();
		const tool = registeredRun(rt);
		const result = await tool.execute(
			"call",
			{
				chain: [
					{ agent: "general-purpose", alias: "adjusted-chain", task: "first", model: "reasoner" },
					{ agent: "general-purpose", alias: "plain-chain", task: "second {previous}", model: "max-capable" },
					{ agent: "general-purpose", alias: "not-launched", task: "third", model: "reasoner" },
				],
			},
			undefined,
			undefined,
			context(),
		);

		expectLaunchAssociation([
			{ alias: "adjusted-chain", model: "reasoner", thinking: "high", adjusted: true },
			{ alias: "plain-chain", model: "max-capable", thinking: "max", adjusted: false },
		]);
		expect(result.details.partial).toBe(true);
		expect(result.details.results).toEqual([
			expect.objectContaining({
				agentId: "chain-adjusted-chain",
				alias: "adjusted-chain",
				model: "reasoner",
				thinking: "high",
				status: "done",
				finalOutput: "adjusted chain output",
				thinkingAdjustment: { requested: "max", effective: "high" },
			}),
			expect.objectContaining({
				agentId: "chain-plain-chain",
				alias: "plain-chain",
				model: "max-capable",
				status: "failed",
				errorMessage: "plain chain failed",
				finalOutput: null,
				thinking: "max",
			}),
		]);
		assertRealBatchRendering(tool, result, [
			{
				agentId: "chain-adjusted-chain",
				alias: "adjusted-chain",
				status: "done",
				thinking: "high",
				warning: true,
			},
			{
				agentId: "chain-plain-chain",
				alias: "plain-chain",
				status: "failed",
				thinking: "max",
				warning: false,
				error: "plain chain failed",
			},
		]);
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

	it("keeps mixed Ctrl+B batch plans associated with completed and backgrounded details", async () => {
		const pending = deferredState();
		let backgroundFinal!: SubagentState;
		mocks.dispatch.mockImplementation(async (plan) => {
			const state = stateForPlan(plan, {
				agentId: `ctrl-b-batch-${plan.options.alias}`,
				status: plan.options.alias === "plain-background" ? "running" : "done",
				finishedAt: plan.options.alias === "plain-background" ? null : 1,
				finalOutput: plan.options.alias === "plain-background" ? null : "adjusted batch output",
			});
			if (plan.options.alias === "plain-background") {
				backgroundFinal = { ...state, status: "done", finishedAt: 1, finalOutput: "plain batch output" };
			}
			return {
				agentId: state.agentId,
				state,
				donePromise: plan.options.alias === "plain-background" ? pending.promise : Promise.resolve(state),
			};
		});
		const { rt, detach } = runtime();
		const tool = registeredRun(rt);
		const execution = tool.execute(
			"call",
			{
				tasks: [
					{ agent: "general-purpose", alias: "adjusted-complete", task: "one", model: "reasoner" },
					{ agent: "general-purpose", alias: "plain-background", task: "two", model: "max-capable" },
				],
			},
			undefined,
			undefined,
			context(),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		detach.detachAll();
		const result = await execution;

		expectLaunchAssociation([
			{ alias: "adjusted-complete", model: "reasoner", thinking: "high", adjusted: true },
			{ alias: "plain-background", model: "max-capable", thinking: "max", adjusted: false },
		]);
		expect(result.details.partial).toBe(true);
		expect(result.details.results).toEqual([
			expect.objectContaining({
				agentId: "ctrl-b-batch-adjusted-complete",
				alias: "adjusted-complete",
				model: "reasoner",
				thinking: "high",
				status: "done",
				finalOutput: "adjusted batch output",
				thinkingAdjustment: { requested: "max", effective: "high" },
			}),
		]);
		expect(result.details.backgrounded).toEqual([
			expect.objectContaining({
				agentId: "ctrl-b-batch-plain-background",
				alias: "plain-background",
				model: "max-capable",
				status: "backgrounded",
				thinking: "max",
			}),
		]);
		expect((result.details.backgrounded as Array<Record<string, unknown>>)[0]).not.toHaveProperty("thinkingAdjustment");
		assertRealBatchRendering(tool, result, [
			{
				agentId: "ctrl-b-batch-adjusted-complete",
				alias: "adjusted-complete",
				status: "done",
				thinking: "high",
				warning: true,
			},
			{
				agentId: "ctrl-b-batch-plain-background",
				alias: "plain-background",
				status: "backgrounded",
				thinking: "max",
				warning: false,
			},
		]);
		pending.resolve(backgroundFinal);
	});

	it("keeps mixed Ctrl+B chain plans associated with current and abandoned steps", async () => {
		const pending = deferredState();
		let backgroundFinal!: SubagentState;
		mocks.dispatch.mockImplementation(async (plan) => {
			const backgrounded = plan.options.alias === "plain-chain-background";
			const state = stateForPlan(plan, {
				agentId: `ctrl-b-chain-${plan.options.alias}`,
				status: backgrounded ? "running" : "done",
				finishedAt: backgrounded ? null : 1,
				finalOutput: backgrounded ? null : "adjusted chain output",
			});
			if (backgrounded) {
				backgroundFinal = { ...state, status: "done", finishedAt: 1, finalOutput: "plain chain output" };
			}
			return { agentId: state.agentId, state, donePromise: backgrounded ? pending.promise : Promise.resolve(state) };
		});
		const { rt, detach } = runtime();
		const tool = registeredRun(rt);
		const execution = tool.execute(
			"call",
			{
				chain: [
					{ agent: "general-purpose", alias: "adjusted-chain-complete", task: "one", model: "reasoner" },
					{
						agent: "general-purpose",
						alias: "plain-chain-background",
						task: "two {previous}",
						model: "max-capable",
					},
					{ agent: "general-purpose", alias: "abandoned-chain", task: "three", model: "reasoner" },
				],
			},
			undefined,
			undefined,
			context(),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		detach.detachAll();
		const result = await execution;

		expectLaunchAssociation([
			{ alias: "adjusted-chain-complete", model: "reasoner", thinking: "high", adjusted: true },
			{ alias: "plain-chain-background", model: "max-capable", thinking: "max", adjusted: false },
		]);
		expect(result.details.partial).toBe(true);
		expect(result.details.abandoned).toEqual(["abandoned-chain"]);
		expect(result.details.results).toEqual([
			expect.objectContaining({
				agentId: "ctrl-b-chain-adjusted-chain-complete",
				alias: "adjusted-chain-complete",
				model: "reasoner",
				thinking: "high",
				finalOutput: "adjusted chain output",
				thinkingAdjustment: { requested: "max", effective: "high" },
			}),
		]);
		expect(result.details.backgrounded).toEqual([
			expect.objectContaining({
				agentId: "ctrl-b-chain-plain-chain-background",
				alias: "plain-chain-background",
				model: "max-capable",
				status: "backgrounded",
				thinking: "max",
			}),
		]);
		assertRealBatchRendering(
			tool,
			result,
			[
				{
					agentId: "ctrl-b-chain-adjusted-chain-complete",
					alias: "adjusted-chain-complete",
					status: "done",
					thinking: "high",
					warning: true,
				},
				{
					agentId: "ctrl-b-chain-plain-chain-background",
					alias: "plain-chain-background",
					status: "backgrounded",
					thinking: "max",
					warning: false,
				},
			],
			"abandoned-chain",
		);
		pending.resolve(backgroundFinal);
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
	const models = {
		reasoner: {
			provider: "example",
			id: "reasoner",
			reasoning: true,
			thinkingLevelMap: { xhigh: null, max: null },
		},
		"max-capable": {
			provider: "example",
			id: "max-capable",
			reasoning: true,
			thinkingLevelMap: { max: "provider-max" },
		},
	};
	return {
		cwd: tmp,
		modelRegistry: {
			find: vi.fn((provider: string, modelId: string) =>
				provider === "example" ? models[modelId as keyof typeof models] : undefined,
			),
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
	renderResult(
		result: ToolResult,
		options: { expanded: boolean },
		theme: typeof renderTheme,
		context: unknown,
	): { render(width: number): string[] };
}

interface TestDispatchPlan {
	agent: { name: string };
	model: { provider: string; modelId: string; thinking: SubagentState["thinking"] };
	thinkingAdjustment?: NonNullable<SubagentState["thinkingAdjustment"]>;
	options: { alias: string; task: string };
}

interface ExpectedLaunch {
	alias: string;
	model: string;
	thinking: SubagentState["thinking"];
	adjusted: boolean;
}

interface ExpectedRender {
	agentId: string;
	alias: string;
	status: string;
	thinking: SubagentState["thinking"];
	warning: boolean;
	error?: string;
}

const renderTheme = {
	bold: (text: string) => text,
	fg: (_token: string, text: string) => text,
};

function stateForPlan(plan: TestDispatchPlan, overrides: Partial<SubagentState> = {}): SubagentState {
	return stateOf({
		agent: plan.agent.name,
		alias: plan.options.alias,
		task: plan.options.task,
		thinking: plan.model.thinking,
		thinkingAdjustment: plan.thinkingAdjustment,
		provider: plan.model.provider,
		model: plan.model.modelId,
		...overrides,
	});
}

function expectLaunchAssociation(expected: ExpectedLaunch[]): void {
	expect(mocks.dispatch).toHaveBeenCalledTimes(expected.length);
	for (const [index, item] of expected.entries()) {
		const plan = mocks.dispatch.mock.calls[index]?.[0] as TestDispatchPlan;
		expect(plan.options.alias).toBe(item.alias);
		expect(plan.model).toMatchObject({ provider: "example", modelId: item.model, thinking: item.thinking });
		if (item.adjusted) {
			expect(plan.thinkingAdjustment).toEqual({ requested: "max", effective: "high" });
		} else {
			expect(plan.thinkingAdjustment).toBeUndefined();
		}
	}
}

function assertRealBatchRendering(
	tool: Tool,
	result: ToolResult,
	expected: ExpectedRender[],
	abandoned?: string,
): void {
	const compactLines = tool.renderResult(result, { expanded: false }, renderTheme, {}).render(100);
	const compact = compactLines.join("\n");
	const expanded = tool.renderResult(result, { expanded: true }, renderTheme, {}).render(100).join("\n");
	expect(compactLines.every((line) => visibleWidth(line) <= 100)).toBe(true);
	for (const item of expected) {
		expect(compact).toContain(`${item.alias} #${item.agentId}`);
		expect(compact).toContain(item.status);
		expect(compact).toContain(item.thinking);
		expect(expanded).toContain(item.alias);
		expect(expanded).toContain(item.status);
		if (item.error) {
			expect(compact).toContain(item.error);
			expect(expanded).toContain(item.error);
		}
	}
	const warningCount = expected.filter((item) => item.warning).length;
	expect(compact.match(/Warning: requested thinking level/g) ?? []).toHaveLength(warningCount);
	expect(expanded.match(/Warning: requested thinking level/g) ?? []).toHaveLength(warningCount);
	if (abandoned) {
		expect(compact).toContain(`${abandoned} abandoned`);
		expect(expanded).toContain(`[abandoned] ${abandoned}`);
	}
	for (const item of result.details.results as Array<Record<string, unknown>>) {
		if (typeof item.finalOutput === "string") {
			expect(compact).not.toContain(item.finalOutput);
			expect(expanded).toContain(item.finalOutput);
		}
	}
}

function deferredState() {
	let resolve!: (state: SubagentState) => void;
	const promise = new Promise<SubagentState>((done) => {
		resolve = done;
	});
	return { promise, resolve };
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
