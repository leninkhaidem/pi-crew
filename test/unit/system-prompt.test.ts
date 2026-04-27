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

vi.mock("@mariozechner/pi-coding-agent", () => ({
	getAgentDir: () => mockedPiCodingAgent.agentDir,
}));

describe("buildSystemPromptBlock", () => {
	it("includes default agents and ✗ for unconfigured", () => {
		const block = buildSystemPromptBlock({
			agents: [
				{ name: "explore", description: "recon", source: "bundled" },
				{ name: "general-purpose", description: "general", source: "bundled" },
			],
			configuredSlots: new Set(["general-purpose"]),
			stateDirRoot: "/home/u/.pi/agent/subagents",
		});
		expect(block).toContain("## pi-crew sub-agents");
		expect(block).toContain("general-purpose: general");
		expect(block).toContain("✗ Unconfigured: explore");
		expect(block).toContain("/home/u/.pi/agent/subagents/<sessionId>/<agentId>/");
		expect(block).toContain("Every sub-agent launch requires `alias`");
		expect(block).toContain(
			"Prefer background completion notifications and blocking `subagent_run`/foreground `Agent` results",
		);
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
		expect(block).toContain("use blocking `subagent_run` or foreground `Agent`");
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
	model: null;
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

function restoreEnv(key: string, value: string | undefined): void {
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}
