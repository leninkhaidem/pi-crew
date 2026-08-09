import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	PI_CREW_ORCHESTRATION_TOOL_NAMES,
	PI_CREW_SUPPRESS_SUBAGENT_TOOLS_ENV,
	PI_CREW_SUPPRESS_SUBAGENT_TOOLS_VALUE,
} from "../../src/runtime/tool-suppression.js";
import { buildSystemPromptBlock } from "../../src/system-prompt.js";

const mockedPiCodingAgent = vi.hoisted(() => ({ agentDir: "" }));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return { ...actual, getAgentDir: () => mockedPiCodingAgent.agentDir };
});

describe("buildSystemPromptBlock", () => {
	it("lists all agents as available when all are configured (inherit by default)", () => {
		const block = buildSystemPromptBlock({
			agents: [
				{ name: "explore", description: "recon", source: "bundled" },
				{ name: "general-purpose", description: "general", source: "bundled" },
			],
			configuredSlots: new Set(["explore", "general-purpose"]),
			stateDirRoot: "/home/u/.pi/agent/subagents",
		});
		expect(block).toContain("## pi-crew sub-agents");
		expect(block).toContain("explore: recon");
		expect(block).toContain("general-purpose: general");
		expect(block).not.toContain("Unconfigured");
		expect(block).toContain("/home/u/.pi/agent/subagents/<sessionId>/<agentId>/");
		expect(block).toContain("Every sub-agent launch requires `alias`");
		expect(block).toContain("Prefer background completion notifications and blocking `subagent_run` results");
		expect(block).toContain(
			"Do not use it for routine polling or after a normal completion notification/blocking result",
		);
		expect(block).not.toContain("subagent_wait");
	});

	it("omits Unconfigured line when all configured", () => {
		const block = buildSystemPromptBlock({
			agents: [{ name: "explore", description: "recon", source: "bundled" }],
			configuredSlots: new Set(["explore"]),
			stateDirRoot: "/x",
		});
		expect(block).not.toContain("Unconfigured");
	});

	it("routes broad codebase understanding requests to explore", () => {
		const block = buildSystemPromptBlock({
			agents: [{ name: "explore", description: "recon", source: "bundled" }],
			configuredSlots: new Set(["explore"]),
			stateDirRoot: "/x",
		});
		expect(block).toContain('"what is this project about?"');
		expect(block).toContain("Treat `explore` as the reconnaissance owner");
		expect(block).toContain("use blocking `subagent_run`");
		expect(block).not.toContain("`Agent`");
		expect(block).toContain("Background `explore` requests are coerced to blocking");
	});

	it("includes available models and per-call override guidance", () => {
		const block = buildSystemPromptBlock({
			agents: [{ name: "explore", description: "recon", source: "bundled" }],
			configuredSlots: new Set(["explore"]),
			stateDirRoot: "/x",
			models: [
				{ provider: "openai-codex", id: "gpt-5.4-mini", reasoning: true },
				{ provider: "local", id: "qwen", reasoning: false },
			],
			currentModel: { provider: "openai-codex", id: "gpt-5.4-mini" },
		});
		expect(block).toContain("Active agent UI shows each agent's alias plus provider/model/thinking");
		expect(block).toContain("accept optional `provider`, `model`, and `thinking` overrides");
		expect(block).toContain(
			"If `model` is supplied without `provider`, provider is inferred from the configured slot or current parent model when possible.",
		);
		expect(block).toContain("provider: openai-codex, model: gpt-5.4-mini — reasoning current parent");
		expect(block).toContain("provider: local, model: qwen — non-reasoning");
		expect(block).toContain("off, minimal, low, medium, high, xhigh, max");
	});

	it("labels max capability only for an own string max mapping", () => {
		const inherited = Object.create({ max: "inherited" }) as Record<string, unknown>;
		const models = [
			{ provider: "p", id: "string", reasoning: true, thinkingLevelMap: { max: "provider-max" } },
			{ provider: "p", id: "non-reasoning-string", reasoning: false, thinkingLevelMap: { max: "provider-max" } },
			{ provider: "p", id: "absent", reasoning: true },
			{ provider: "p", id: "null-map", reasoning: true, thinkingLevelMap: null },
			{ provider: "p", id: "array-map", reasoning: true, thinkingLevelMap: ["max"] },
			{ provider: "p", id: "missing-entry", reasoning: true, thinkingLevelMap: {} },
			{ provider: "p", id: "null-entry", reasoning: true, thinkingLevelMap: { max: null } },
			{ provider: "p", id: "inherited-entry", reasoning: true, thinkingLevelMap: inherited },
		];
		const block = buildSystemPromptBlock({
			agents: [],
			configuredSlots: new Set(),
			stateDirRoot: "/x",
			models,
		});
		expect(block).toContain("model: string — reasoning max-capable");
		for (const id of models.slice(1).map((model) => model.id)) {
			const line = block.split("\n").find((candidate) => candidate.includes(`model: ${id} —`));
			expect(line).not.toContain("max-capable");
		}
	});

	it("bounds and deterministically prioritizes current, max-capable, then other authenticated models", () => {
		const maxModels = Array.from({ length: 42 }, (_, index) => ({
			provider: index % 2 === 0 ? "b" : "a",
			id: `max-${index.toString().padStart(2, "0")}`,
			reasoning: true,
			thinkingLevelMap: { max: "max" },
		}));
		const current = { provider: "z", id: "current", reasoning: false };
		const duplicateCurrent = { ...current };
		const misleadingMax = {
			provider: "0",
			id: "non-reasoning-string-max",
			reasoning: false,
			thinkingLevelMap: { max: "max" },
		};
		const other = { provider: "a", id: "other", reasoning: true };
		const block = buildSystemPromptBlock({
			agents: [],
			configuredSlots: new Set(),
			stateDirRoot: "/x",
			models: [other, misleadingMax, ...maxModels.reverse(), current, duplicateCurrent],
			currentModel: { provider: "z", id: "current" },
		});
		const modelLines = block.split("\n").filter((line) => line.startsWith("    - provider:"));
		expect(modelLines).toHaveLength(40);
		expect(modelLines[0]).toContain("provider: z, model: current");
		expect(modelLines.filter((line) => line.includes("model: current"))).toHaveLength(1);
		expect(modelLines.some((line) => line.includes("model: non-reasoning-string-max"))).toBe(false);
		expect(modelLines.slice(1).every((line) => line.includes("max-capable"))).toBe(true);
		const maxKeys = modelLines.slice(1).map(
			(line) =>
				line
					.match(/provider: ([^,]+), model: ([^ ]+)/)
					?.slice(1)
					.join("/") ?? "",
		);
		expect(maxKeys).toEqual([...maxKeys].sort());
		expect(block).toContain("… 5 more models omitted (3 max-capable)");
	});
});

describe("pi-crew extension startup", () => {
	const envKeys = [PI_CREW_SUPPRESS_SUBAGENT_TOOLS_ENV, "PI_SUBAGENT_PARENT_ID", "PI_SUBAGENT_SESSION_ID"];
	let tmp: string;
	let previousEnv: Record<string, string | undefined>;

	beforeEach(() => {
		tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-index-"));
		mockedPiCodingAgent.agentDir = path.join(tmp, "agent");
		previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
		for (const key of envKeys) delete process.env[key];
	});

	afterEach(() => {
		for (const key of envKeys) restoreEnv(key, previousEnv[key]);
		rmSync(tmp, { recursive: true, force: true });
	});

	it("registers orchestration tools for unmarked parent sessions even with lineage variables", async () => {
		process.env.PI_SUBAGENT_PARENT_ID = "parent";
		process.env.PI_SUBAGENT_SESSION_ID = "session";
		const pi = createFakePi();

		await loadPiCrewExtension(pi);

		expect([...pi.tools.keys()]).toEqual(expect.arrayContaining([...PI_CREW_ORCHESTRATION_TOOL_NAMES]));
	});

	it("skips orchestration tool registration when the pi-crew suppress marker is present", async () => {
		process.env.PI_SUBAGENT_PARENT_ID = "parent";
		process.env.PI_SUBAGENT_SESSION_ID = "session";
		process.env[PI_CREW_SUPPRESS_SUBAGENT_TOOLS_ENV] = PI_CREW_SUPPRESS_SUBAGENT_TOOLS_VALUE;
		const pi = createFakePi();

		await loadPiCrewExtension(pi);

		for (const toolName of PI_CREW_ORCHESTRATION_TOOL_NAMES) {
			expect(pi.tools.has(toolName)).toBe(false);
		}
	});

	it("injects sub-agent prompt guidance for unmarked parent sessions", async () => {
		const pi = createFakePi();
		await loadPiCrewExtension(pi);

		const prompt = await runBeforeAgentStart(pi, tmp, "parent prompt");

		expect(prompt).toContain("parent prompt");
		expect(prompt).toContain("## pi-crew sub-agents");
	});

	it("projects a non-empty scope only, with pins and case-sensitive provider/model identities", async () => {
		const pi = createFakePi();
		await loadPiCrewExtension(pi);
		const allowed = { provider: "Provider", id: "same", name: "Allowed", reasoning: true, thinkingLevelMap: {} };
		const catalogOnly = { provider: "Provider", id: "other", name: "Hidden", reasoning: true };
		const collision = { provider: "provider", id: "same", name: "Hidden collision", reasoning: true };
		const prompt = await runBeforeAgentStart(pi, tmp, "parent", {
			modelRegistry: { getAvailable: () => [allowed, catalogOnly, collision] },
			model: catalogOnly,
			scopedModels: [{ model: allowed, thinkingLevel: "high" }],
		});
		expect(prompt).toContain("Available scoped models");
		expect(prompt).toContain("provider: Provider, model: same");
		expect(prompt).toContain("scoped thinking default: high");
		expect(prompt).not.toContain("model: other");
		expect(prompt).not.toContain("provider: provider, model: same");
		const scopedModelLine = prompt.split("\n").find((line) => line.includes("provider: Provider, model: same"));
		expect(scopedModelLine).not.toContain("current parent");
	});

	it("fails malformed non-empty scope closed instead of exposing the authenticated catalogue", async () => {
		const pi = createFakePi();
		await loadPiCrewExtension(pi);
		const prompt = await runBeforeAgentStart(pi, tmp, "parent", {
			modelRegistry: { getAvailable: () => [{ provider: "secret", id: "hidden", reasoning: true }] },
			scopedModels: [{ malformed: true }],
		});
		expect(prompt).toContain("Available scoped models");
		expect(prompt).not.toContain("secret");
		expect(prompt).not.toContain("hidden");
	});

	it("omits sub-agent prompt guidance when the pi-crew suppress marker is present", async () => {
		process.env[PI_CREW_SUPPRESS_SUBAGENT_TOOLS_ENV] = PI_CREW_SUPPRESS_SUBAGENT_TOOLS_VALUE;
		const pi = createFakePi();
		await loadPiCrewExtension(pi);

		const prompt = await runBeforeAgentStart(pi, tmp, "child prompt");

		expect(prompt).toBe("child prompt");
		expect(prompt).not.toContain("## pi-crew sub-agents");
	});
});

interface FakePi {
	tools: Map<string, RegisteredTool>;
	handlers: Map<string, PiHandler[]>;
	registerTool: ReturnType<typeof vi.fn>;
	registerCommand: ReturnType<typeof vi.fn>;
	registerMessageRenderer: ReturnType<typeof vi.fn>;
	on: ReturnType<typeof vi.fn>;
}

interface RegisteredTool {
	name: string;
}

interface PiEvent {
	systemPrompt: string;
	message?: unknown;
	turnIndex?: number;
}

interface PiContext {
	cwd: string;
	sessionManager: { getSessionFile(): string | undefined };
	modelRegistry: { getAvailable(): unknown[] };
	model: unknown;
	scopedModels: unknown;
}

type PiHandler = (event: PiEvent, ctx: PiContext) => unknown;

function createFakePi(): FakePi {
	const tools = new Map<string, RegisteredTool>();
	const handlers = new Map<string, PiHandler[]>();
	return {
		tools,
		handlers,
		registerTool: vi.fn((tool: RegisteredTool) => {
			tools.set(tool.name, tool);
		}),
		registerCommand: vi.fn(),
		registerMessageRenderer: vi.fn(),
		on: vi.fn((event: string, handler: PiHandler) => {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		}),
	};
}

async function loadPiCrewExtension(pi: FakePi): Promise<void> {
	const { default: piCrew } = await import("../../src/index.js");
	piCrew(pi as never);
}

async function runBeforeAgentStart(
	pi: FakePi,
	cwd: string,
	systemPrompt: string,
	overrides: Partial<PiContext> = {},
): Promise<string> {
	const handler = pi.handlers.get("before_agent_start")?.[0];
	if (!handler) throw new Error("before_agent_start handler was not registered");
	const result = await handler({ systemPrompt }, { ...createFakeContext(cwd), ...overrides });
	return (result as { systemPrompt: string }).systemPrompt;
}

function createFakeContext(cwd: string): PiContext {
	return {
		cwd,
		sessionManager: { getSessionFile: () => path.join(cwd, "session.jsonl") },
		modelRegistry: { getAvailable: () => [] },
		model: null,
		scopedModels: [],
	};
}

function restoreEnv(key: string, value: string | undefined): void {
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}
