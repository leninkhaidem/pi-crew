import { describe, expect, it } from "vitest";
import { buildSystemPromptBlock } from "../../src/system-prompt.js";

describe("buildSystemPromptBlock", () => {
	it("includes all 4 default agents and ✗ for unconfigured", () => {
		const block = buildSystemPromptBlock({
			agents: [
				{ name: "explore", description: "recon", source: "bundled" },
				{ name: "plan", description: "planner", source: "bundled" },
				{ name: "code-reviewer", description: "review", source: "bundled" },
				{ name: "general-purpose", description: "general", source: "bundled" },
			],
			configuredSlots: new Set(["explore", "plan"]),
			stateDirRoot: "/home/u/.pi/agent/subagents",
		});
		expect(block).toContain("## pi-crew sub-agents");
		expect(block).toContain("explore: recon");
		expect(block).toContain("✗ Unconfigured: code-reviewer, general-purpose");
		expect(block).toContain("/home/u/.pi/agent/subagents/<sessionId>/<agentId>/");
	});

	it("omits Unconfigured line when all configured", () => {
		const block = buildSystemPromptBlock({
			agents: [{ name: "explore", description: "recon", source: "bundled" }],
			configuredSlots: new Set(["explore"]),
			stateDirRoot: "/x",
		});
		expect(block).not.toContain("Unconfigured");
	});
});
