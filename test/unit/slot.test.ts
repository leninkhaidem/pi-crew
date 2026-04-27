import { describe, expect, it } from "vitest";
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

	it("explore still requires explicit config without overrides", () => {
		const result = resolveAgentSlot("explore", emptyConfig(), { model: undefined } as never, {} as never);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("unconfigured");
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
});
