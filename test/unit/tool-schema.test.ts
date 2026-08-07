import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { describe, expect, it, vi } from "vitest";
import { registerDispatchTool } from "../../src/tools/dispatch.js";
import { registerGetSubagentResultTool } from "../../src/tools/result.js";
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

		const canonical = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
		for (const name of ["subagent_dispatch", "subagent_run", "subagent_resume"]) {
			const thinking = propertiesOf(tools.get(name)).thinking;
			expect(literalValuesOf(thinking)).toEqual(canonical);
			expect(JSON.stringify(thinking)).not.toContain("maximum");
		}
		expect(tools.get("subagent_resume")?.description).toContain("provider?, model?, thinking?");
	});

	it("exposes bounded recent output retrieval on the result tool", () => {
		const tools = new Map<string, ToolLike>();
		const pi = {
			registerTool: vi.fn((tool: ToolLike & { name: string }) => {
				tools.set(tool.name, tool);
			}),
		};
		const rt = {} as never;

		registerGetSubagentResultTool(pi as never, rt);

		const resultTool = tools.get("get_subagent_result");
		const properties = propertiesOf(resultTool);
		expect(Object.keys(properties).sort()).toEqual(["agent_id", "recentEvents", "timeoutMs", "verbose", "wait"]);
		expect(properties.recentEvents).toMatchObject({ type: "integer", minimum: 1 });
		expect(resultTool?.description).toContain("recentEvents");
		expect(resultTool?.description).toContain("bounded sanitized recent output");
	});

	it("exposes only valid subagent_status argument combinations", () => {
		const tools = new Map<string, ToolLike>();
		const pi = {
			registerTool: vi.fn((tool: ToolLike & { name: string }) => {
				tools.set(tool.name, tool);
			}),
		};
		const rt = {} as never;

		registerStatusTool(pi as never, rt);

		const statusTool = tools.get("subagent_status");
		expect(statusTool?.parameters).toMatchObject({ type: "object" });
		expect(Object.keys(propertiesOf(statusTool)).sort()).toEqual(["agentId", "limit", "scope"]);

		expect(check(statusTool, {})).toBe(true);
		expect(check(statusTool, { scope: "active" })).toBe(true);
		expect(check(statusTool, { scope: "stopped" })).toBe(true);
		expect(check(statusTool, { scope: "stopped", limit: 1 })).toBe(true);
		expect(check(statusTool, { agentId: "exact-id" })).toBe(true);
		expect(check(statusTool, { agentId: "exact-id", scope: "active" })).toBe(true);
		expect(check(statusTool, { agentId: "exact-id", scope: "stopped" })).toBe(true);

		expect(check(statusTool, { limit: 1 })).toBe(false);
		expect(check(statusTool, { scope: "active", limit: 1 })).toBe(false);
		expect(check(statusTool, { agentId: "exact-id", limit: 1 })).toBe(false);
		expect(check(statusTool, { agentId: "exact-id", scope: "stopped", limit: 1 })).toBe(false);
		expect(check(statusTool, { includeDetached: true })).toBe(false);

		expect(statusTool?.description).toContain("{ agentId }");
		expect(statusTool?.description).toContain("{ scope: 'stopped', limit? }");
		expect(statusTool?.description).toContain("limit requires explicit scope:'stopped'");
		expect(statusTool?.description).not.toContain("scope?: 'active'|'stopped', limit?");
		expect(statusTool?.description).not.toContain("'session'|'all'");
		expect(statusTool?.description).not.toContain("includeDetached");
	});
});

interface ToolLike {
	description?: string;
	parameters?: unknown;
}

function propertiesOf(tool: ToolLike | undefined) {
	return schemaRecord(tool?.parameters, "properties");
}

function requiredOf(tool: ToolLike | undefined) {
	return schemaArray(tool?.parameters, "required");
}

function check(tool: ToolLike | undefined, value: unknown) {
	return isSchema(tool?.parameters) ? Value.Check(tool.parameters, value) : false;
}

function isSchema(schema: unknown): schema is TSchema {
	return Boolean(schema && typeof schema === "object");
}

function schemaRecord(schema: unknown, key: string) {
	if (!schema || typeof schema !== "object" || !(key in schema)) return {};
	const value = (schema as Record<string, unknown>)[key];
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function schemaArray(schema: unknown, key: string) {
	if (!schema || typeof schema !== "object" || !(key in schema)) return [];
	const value = (schema as Record<string, unknown>)[key];
	return Array.isArray(value) ? value : [];
}

function literalValuesOf(schema: unknown): unknown[] {
	if (!schema || typeof schema !== "object" || !("anyOf" in schema)) return [];
	const variants = (schema as { anyOf: Array<{ const?: unknown }> }).anyOf;
	return variants.map((variant) => variant.const);
}
