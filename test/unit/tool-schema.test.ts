import { describe, expect, it, vi } from "vitest";
import { registerDispatchTool } from "../../src/tools/dispatch.js";
import { registerResumeTool } from "../../src/tools/resume.js";
import { registerRunTool } from "../../src/tools/run.js";

describe("sub-agent tool schemas", () => {
	it("do not expose max-turn controls in LLM-facing tools", () => {
		const tools = new Map<string, ToolLike>();
		const pi = {
			registerTool: vi.fn((tool: ToolLike & { name: string }) => {
				tools.set(tool.name, tool);
			}),
		};
		const rt = {} as never;

		registerDispatchTool(pi as never, rt);
		registerRunTool(pi as never, rt);
		registerResumeTool(pi as never, rt);

		expect(propertiesOf(tools.get("subagent_dispatch"))).not.toHaveProperty("maxTurns");
		expect(propertiesOf(tools.get("subagent_run"))).not.toHaveProperty("maxTurns");

		expect(propertiesOf(tools.get("subagent_dispatch"))).toHaveProperty("thinking");
		expect(propertiesOf(tools.get("subagent_run"))).toHaveProperty("provider");
		expect(propertiesOf(tools.get("subagent_resume"))).toHaveProperty("model");
		expect(propertiesOf(tools.get("subagent_dispatch"))).toHaveProperty("alias");
		expect(propertiesOf(tools.get("subagent_run"))).toHaveProperty("alias");
		expect(requiredOf(tools.get("subagent_resume"))).toContain("agent_id");
		expect(requiredOf(tools.get("subagent_resume"))).toContain("prompt");
		expect(requiredOf(tools.get("subagent_dispatch"))).toContain("alias");
	});
});

interface ToolLike {
	parameters?: { properties?: Record<string, unknown>; required?: string[] };
}

function propertiesOf(tool: ToolLike | undefined) {
	return tool?.parameters?.properties ?? {};
}

function requiredOf(tool: ToolLike | undefined) {
	return tool?.parameters?.required ?? [];
}
