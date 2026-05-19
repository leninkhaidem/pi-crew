import { describe, expect, it, vi } from "vitest";
import { registerDispatchTool } from "../../src/tools/dispatch.js";
import { registerResumeTool } from "../../src/tools/resume.js";
import { registerRunTool } from "../../src/tools/run.js";
import { registerStatusTool } from "../../src/tools/status.js";

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

	it("exposes only active/stopped status listing and exact-id lookup", () => {
		const tools = new Map<string, ToolLike>();
		const pi = {
			registerTool: vi.fn((tool: ToolLike & { name: string }) => {
				tools.set(tool.name, tool);
			}),
		};
		const rt = {} as never;

		registerStatusTool(pi as never, rt);

		const statusTool = tools.get("subagent_status");
		const properties = propertiesOf(statusTool);
		expect(Object.keys(properties).sort()).toEqual(["agentId", "limit", "scope"]);
		expect(properties).toHaveProperty("agentId");
		expect(properties).toHaveProperty("limit");
		expect(properties).not.toHaveProperty("includeDetached");
		expect(statusTool?.parameters?.additionalProperties).toBe(false);
		expect(statusTool?.description).toContain("{ agentId }");
		expect(statusTool?.description).toContain("scope?: 'active'|'stopped'");
		expect(statusTool?.description).not.toContain("'session'|'all'");
		expect(statusTool?.description).not.toContain("includeDetached");
		expect(literalValuesOf(properties.scope)).toEqual(["active", "stopped"]);
		expect(properties.limit).toMatchObject({ type: "integer", minimum: 1 });
		expect(properties.limit).not.toHaveProperty("maximum");
	});
});

interface ToolLike {
	description?: string;
	parameters?: { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
}

function propertiesOf(tool: ToolLike | undefined) {
	return tool?.parameters?.properties ?? {};
}

function requiredOf(tool: ToolLike | undefined) {
	return tool?.parameters?.required ?? [];
}

function literalValuesOf(schema: unknown): unknown[] {
	if (!schema || typeof schema !== "object" || !("anyOf" in schema)) return [];
	const variants = (schema as { anyOf: Array<{ const?: unknown }> }).anyOf;
	return variants.map((variant) => variant.const);
}
