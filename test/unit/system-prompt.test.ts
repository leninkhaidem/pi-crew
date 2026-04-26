import { describe, expect, it } from "vitest";
import { buildSystemPromptBlock } from "../../src/system-prompt.js";

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
		expect(block).toContain("dispatch `explore` before doing your own file/search reconnaissance");
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
		expect(block).toContain("accept optional `provider`, `model`, and `thinking` overrides");
		expect(block).toContain(
			"If `model` is supplied without `provider`, provider is inferred from the configured slot or current parent model when possible.",
		);
		expect(block).toContain("provider: openai-codex, model: gpt-5.4-mini — reasoning current parent");
		expect(block).toContain("provider: local, model: qwen — non-reasoning");
	});
});
