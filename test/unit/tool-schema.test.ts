import { describe, expect, it, vi } from "vitest";
import { registerAgentTool } from "../../src/tools/agent.js";
import { registerDispatchTool } from "../../src/tools/dispatch.js";
import { registerRunTool } from "../../src/tools/run.js";

describe("sub-agent tool schemas", () => {
	it("do not expose max-turn controls in LLM-facing tools", () => {
		const tools = new Map<string, { parameters?: { properties?: Record<string, unknown> } }>();
		const pi = {
			registerTool: vi.fn((tool: { name: string; parameters?: { properties?: Record<string, unknown> } }) => {
				tools.set(tool.name, tool);
			}),
		};
		const rt = {} as never;

		registerAgentTool(pi as never, rt);
		registerDispatchTool(pi as never, rt);
		registerRunTool(pi as never, rt);

		expect(propertiesOf(tools.get("Agent"))).not.toHaveProperty("max_turns");
		expect(propertiesOf(tools.get("subagent_dispatch"))).not.toHaveProperty("maxTurns");
		expect(propertiesOf(tools.get("subagent_run"))).not.toHaveProperty("maxTurns");

		expect(propertiesOf(tools.get("Agent"))).toHaveProperty("model");
		expect(propertiesOf(tools.get("subagent_dispatch"))).toHaveProperty("thinking");
		expect(propertiesOf(tools.get("subagent_run"))).toHaveProperty("provider");
	});
});

function propertiesOf(tool: { parameters?: { properties?: Record<string, unknown> } } | undefined) {
	return tool?.parameters?.properties ?? {};
}
