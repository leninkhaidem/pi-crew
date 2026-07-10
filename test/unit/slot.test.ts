import { describe, expect, it, vi } from "vitest";
import { emptyConfig } from "../../src/config/schema.js";
import { resolveAgentSlot } from "../../src/tools/slot.js";

describe("resolveAgentSlot", () => {
	it("general-purpose honors an explicit configured slot", () => {
		const cfg = emptyConfig();
		cfg.agents["general-purpose"] = { provider: "configured", modelId: "configured-model", thinking: "low" };
		const ctx = { model: { provider: "parent", id: "parent-model" } } as never;
		const pi = { getThinkingLevel: () => "xhigh" } as never;

		const result = resolveAgentSlot("general-purpose", cfg, ctx, pi);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.inherited).toBe(false);
			expect(result.slot).toEqual({ provider: "configured", modelId: "configured-model", thinking: "low" });
		}
	});

	it("explicit inherited slots use parent model and thinking", () => {
		const cfg = emptyConfig();
		cfg.agents.explore = { mode: "inherit" };
		const ctx = { model: { provider: "parent", id: "parent-model" } } as never;
		const pi = { getThinkingLevel: () => "xhigh" } as never;

		const result = resolveAgentSlot("explore", cfg, ctx, pi);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.inherited).toBe(true);
			expect(result.slot).toEqual({ provider: "parent", modelId: "parent-model", thinking: "xhigh" });
		}
	});

	it("general-purpose inherits parent model and thinking when unset", () => {
		const ctx = { model: { provider: "parent", id: "model-id" } } as never;
		const pi = { getThinkingLevel: () => "xhigh" } as never;

		const result = resolveAgentSlot("general-purpose", emptyConfig(), ctx, pi);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.inherited).toBe(true);
			expect(result.slot).toEqual({ provider: "parent", modelId: "model-id", thinking: "xhigh" });
		}
	});

	it("returns no-parent-model for explicit inherit without a parent model", () => {
		const cfg = emptyConfig();
		cfg.agents.explore = { mode: "inherit" };

		const result = resolveAgentSlot("explore", cfg, { model: undefined } as never, {} as never);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("no_parent_model");
	});

	it("explore inherits parent model when unconfigured and parent model available", () => {
		const ctx = { model: { provider: "parent", id: "parent-model" } } as never;
		const pi = { getThinkingLevel: () => "high" } as never;

		const result = resolveAgentSlot("explore", emptyConfig(), ctx, pi);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.inherited).toBe(true);
			expect(result.slot).toEqual({ provider: "parent", modelId: "parent-model", thinking: "high" });
		}
	});

	it("returns no_parent_model for unconfigured agent without a parent model", () => {
		const result = resolveAgentSlot("explore", emptyConfig(), { model: undefined } as never, {} as never);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("no_parent_model");
	});

	it("per-call overrides take precedence over inherited slots", () => {
		const cfg = emptyConfig();
		cfg.agents.explore = { mode: "inherit" };
		const ctx = { model: { provider: "parent", id: "parent-model" } } as never;
		const pi = { getThinkingLevel: () => "high" } as never;

		const result = resolveAgentSlot("explore", cfg, ctx, pi, {
			provider: "override-provider",
			model: "override-model",
			thinking: "minimal",
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.slot).toEqual({
				provider: "override-provider",
				modelId: "override-model",
				thinking: "minimal",
			});
		}
	});

	it("uses configured provider when only model override is provided", () => {
		const cfg = emptyConfig();
		cfg.agents.explore = { provider: "configured-provider", modelId: "configured-model", thinking: "low" };

		const result = resolveAgentSlot("explore", cfg, { model: undefined } as never, {} as never, {
			model: "gpt-5.4-mini",
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.slot).toEqual({ provider: "configured-provider", modelId: "gpt-5.4-mini", thinking: "low" });
		}
	});

	it("per-call overrides take precedence over concrete slots", () => {
		const cfg = emptyConfig();
		cfg.agents.explore = { provider: "configured-provider", modelId: "configured-model", thinking: "low" };

		const result = resolveAgentSlot("explore", cfg, { model: undefined } as never, {} as never, {
			provider: "override-provider",
			model: "override-model",
			thinking: "high",
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.slot).toEqual({
				provider: "override-provider",
				modelId: "override-model",
				thinking: "high",
			});
		}
	});

	it("uses parent provider when only model override is provided and the agent has no configured slot", () => {
		const result = resolveAgentSlot(
			"explore",
			emptyConfig(),
			{ model: { provider: "parent-provider", id: "parent-model" } } as never,
			{} as never,
			{ model: "gpt-5.4-mini" },
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.slot).toEqual({ provider: "parent-provider", modelId: "gpt-5.4-mini", thinking: undefined });
		}
	});

	it("allows fully specified model/provider overrides without parent or config", () => {
		const result = resolveAgentSlot("explore", emptyConfig(), { model: undefined } as never, {} as never, {
			provider: "openai-codex",
			model: "gpt-5.4-mini",
			thinking: "minimal",
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.slot).toEqual({ provider: "openai-codex", modelId: "gpt-5.4-mini", thinking: "minimal" });
		}
	});

	it("requires provider when model override cannot infer one", () => {
		const result = resolveAgentSlot("explore", emptyConfig(), { model: undefined } as never, {} as never, {
			model: "gpt-5.4-mini",
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("provider_required");
	});

	it("rejects unavailable provider/model overrides when the registry can validate them", () => {
		const result = resolveAgentSlot(
			"explore",
			emptyConfig(),
			{ model: undefined, modelRegistry: { find: () => undefined } } as never,
			{} as never,
			{ provider: "openai-codex", model: "missing-model" },
		);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("model_not_found");
	});

	it.each([
		["configured", false, {}],
		["implicit inheritance", true, {}],
		["explicit inheritance", true, {}],
		["thinking-only override", false, { thinking: "max" }],
		["model-only override", false, { model: "selected" }],
		["full override", false, { provider: "example", model: "selected", thinking: "max" }],
	] as const)("resolves supported max after %s precedence", (_name, inherited, overrides) => {
		const cfg = emptyConfig();
		if (_name === "configured" || _name.includes("override")) {
			cfg.agents.explore = { provider: "example", modelId: "selected", thinking: "max" };
		} else if (_name === "explicit inheritance") cfg.agents.explore = { mode: "inherit" };
		const model = registryModel({ thinkingLevelMap: { max: "provider-max" } });
		const find = vi.fn(() => model);
		const result = resolveAgentSlot(
			"explore",
			cfg,
			{ model: { provider: "example", id: "selected" }, modelRegistry: { find } } as never,
			{ getThinkingLevel: () => "max" } as never,
			overrides as never,
		);
		expect(result).toMatchObject({
			ok: true,
			inherited,
			slot: { provider: "example", modelId: "selected", thinking: "max" },
		});
		if (result.ok) expect(result.thinkingAdjustment).toBeUndefined();
		expect(find).toHaveBeenCalledWith("example", "selected");
	});

	it.each([
		["configured", false, {}],
		["implicit inheritance", true, {}],
		["explicit inheritance", true, {}],
		["thinking-only override", false, { thinking: "max" }],
		["model-only override", false, { model: "missing" }],
		["full override", false, { provider: "example", model: "missing", thinking: "max" }],
	] as const)("fails missing registry lookup before dispatch for max via %s", (name, _inherited, overrides) => {
		const cfg = emptyConfig();
		if (name === "configured" || name.includes("override")) {
			cfg.agents.explore = { provider: "example", modelId: "missing", thinking: "max" };
		} else if (name === "explicit inheritance") cfg.agents.explore = { mode: "inherit" };
		const result = resolveAgentSlot(
			"explore",
			cfg,
			{ model: { provider: "example", id: "missing" }, modelRegistry: { find: () => undefined } } as never,
			{ getThinkingLevel: () => "max" } as never,
			overrides as never,
		);
		expect(result).toMatchObject({ ok: false, error: "model_not_found" });
	});

	it("uses a found absent-map model distinctly from a missing max model", () => {
		const cfg = emptyConfig();
		cfg.agents.explore = { provider: "example", modelId: "legacy", thinking: "max" };
		const found = resolveAgentSlot(
			"explore",
			cfg,
			{ modelRegistry: { find: () => registryModel({ id: "legacy" }) } } as never,
			{} as never,
		);
		expect(found).toMatchObject({
			ok: true,
			slot: { thinking: expect.stringMatching(/^(xhigh|high)$/) },
			thinkingAdjustment: { requested: "max" },
		});

		const missing = resolveAgentSlot(
			"explore",
			cfg,
			{ modelRegistry: { find: () => undefined } } as never,
			{} as never,
		);
		expect(missing).toMatchObject({ ok: false, error: "model_not_found" });
		if (!missing.ok) expect(missing.message).toContain("example/legacy");
	});

	it("applies representative max holes, non-reasoning coercion, and explicit no-lower failure", () => {
		const cfg = emptyConfig();
		cfg.agents.explore = { provider: "example", modelId: "selected", thinking: "max" };
		const fallback = resolveAgentSlot(
			"explore",
			cfg,
			{
				modelRegistry: {
					find: () => registryModel({ thinkingLevelMap: { xhigh: null, high: null, medium: "m" } }),
				},
			} as never,
			{} as never,
		);
		expect(fallback).toMatchObject({
			ok: true,
			slot: { thinking: "medium" },
			thinkingAdjustment: { requested: "max", effective: "medium" },
		});

		cfg.agents.explore = { provider: "example", modelId: "selected", thinking: "high" };
		const nonReasoning = resolveAgentSlot(
			"explore",
			cfg,
			{ modelRegistry: { find: () => registryModel({ reasoning: false }) } } as never,
			{} as never,
		);
		expect(nonReasoning).toMatchObject({
			ok: true,
			slot: { thinking: "off" },
			thinkingAdjustment: { requested: "high", effective: "off" },
		});

		cfg.agents.explore = { provider: "example", modelId: "selected", thinking: "max" };
		const unsupported = resolveAgentSlot(
			"explore",
			cfg,
			{
				modelRegistry: {
					find: () =>
						registryModel({
							thinkingLevelMap: {
								off: null,
								minimal: null,
								low: null,
								medium: null,
								high: null,
								xhigh: null,
								max: null,
							},
						}),
				},
			} as never,
			{} as never,
		);
		expect(unsupported).toMatchObject({ ok: false, error: "no_supported_thinking_level" });
	});

	it("leaves lower-level baseline behavior unchanged when registry lookup is unavailable or metadata has a hole", () => {
		const cfg = emptyConfig();
		cfg.agents.explore = { provider: "example", modelId: "selected", thinking: "high" };
		const missing = resolveAgentSlot(
			"explore",
			cfg,
			{ modelRegistry: { find: () => undefined } } as never,
			{} as never,
		);
		expect(missing).toMatchObject({ ok: true, slot: { thinking: "high" } });

		const hole = resolveAgentSlot(
			"explore",
			cfg,
			{ modelRegistry: { find: () => registryModel({ thinkingLevelMap: { high: null } }) } } as never,
			{} as never,
		);
		expect(hole).toMatchObject({ ok: true, slot: { thinking: "high" } });
	});
});

function registryModel(overrides: { id?: string; reasoning?: boolean; thinkingLevelMap?: unknown } = {}) {
	const model: Record<string, unknown> = {
		provider: "example",
		id: overrides.id ?? "selected",
		name: "Selected",
		api: "example",
		baseUrl: "https://invalid.example",
		reasoning: overrides.reasoning ?? true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1,
		maxTokens: 1,
	};
	if (Object.prototype.hasOwnProperty.call(overrides, "thinkingLevelMap")) {
		model.thinkingLevelMap = overrides.thinkingLevelMap;
	}
	return model;
}
