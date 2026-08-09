import { describe, expect, it, vi } from "vitest";
import { emptyConfig } from "../../src/config/schema.js";
import { resolveAgentSlot } from "../../src/tools/slot.js";

const pi = (thinking = "high") => ({ getThinkingLevel: () => thinking }) as never;

function model(provider: string, id: string, overrides: Record<string, unknown> = {}) {
	return {
		provider,
		id,
		name: id,
		api: "example",
		baseUrl: "https://invalid.example",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1,
		maxTokens: 1,
		...overrides,
	};
}

function context(
	available: Array<ReturnType<typeof model>>,
	current?: ReturnType<typeof model>,
	scopedModels: unknown = [],
) {
	return {
		model: current,
		scopedModels,
		modelRegistry: {
			getAvailable: vi.fn(() => available),
			find: vi.fn((provider: string, id: string) =>
				available.find((candidate) => candidate.provider === provider && candidate.id === id),
			),
		},
	} as never;
}

describe("resolveAgentSlot", () => {
	it("resolves configured and inherited slots against current availability", () => {
		const configured = model("configured", "chosen");
		const parent = model("parent", "current");
		const cfg = emptyConfig();
		cfg.agents.explore = { provider: configured.provider, modelId: configured.id, thinking: "low" };
		expect(resolveAgentSlot("explore", cfg, context([configured, parent], parent), pi())).toMatchObject({
			ok: true,
			inherited: false,
			slot: { provider: "configured", modelId: "chosen", thinking: "low" },
		});

		cfg.agents.explore = { mode: "inherit" };
		expect(resolveAgentSlot("explore", cfg, context([parent], parent), pi("xhigh"))).toMatchObject({
			ok: true,
			inherited: true,
			slot: { provider: "parent", modelId: "current", thinking: "xhigh" },
		});
	});

	it("reports no parent model and incomplete override identities explicitly", () => {
		expect(resolveAgentSlot("explore", emptyConfig(), context([]), pi())).toMatchObject({
			ok: false,
			error: "no_parent_model",
		});
		expect(resolveAgentSlot("explore", emptyConfig(), context([]), pi(), { model: "id" })).toMatchObject({
			ok: false,
			error: "provider_required",
		});
		expect(resolveAgentSlot("explore", emptyConfig(), context([]), pi(), { provider: "p" })).toMatchObject({
			ok: false,
			error: "model_required",
		});
	});

	it("uses explicit overrides over a concrete slot without weakening availability", () => {
		const selected = model("override", "selected");
		const cfg = emptyConfig();
		cfg.agents.explore = { provider: "configured", modelId: "old", thinking: "low" };
		expect(
			resolveAgentSlot("explore", cfg, context([selected]), pi(), {
				provider: "override",
				model: "selected",
				thinking: "minimal",
			}),
		).toMatchObject({
			ok: true,
			slot: { provider: "override", modelId: "selected", thinking: "minimal" },
		});
		expect(
			resolveAgentSlot("explore", cfg, context([]), pi(), { provider: "override", model: "selected" }),
		).toMatchObject({ ok: false, error: "model_not_found" });
	});

	it("fails stale configured, inherited, and override models outside a non-empty scope", () => {
		const parent = model("p", "same");
		const scopedCollision = model("other", "same");
		const scoped = [{ model: scopedCollision, thinkingLevel: "medium" }];
		const cfg = emptyConfig();
		cfg.agents.explore = { provider: "p", modelId: "same", thinking: "low" };
		for (const [config, overrides] of [
			[cfg, {}],
			[emptyConfig(), {}],
			[emptyConfig(), { provider: "p", model: "same" }],
		] as const) {
			const result = resolveAgentSlot(
				"explore",
				config,
				context([parent, scopedCollision], parent, scoped),
				pi(),
				overrides,
			);
			expect(result).toEqual({
				ok: false,
				error: "model_out_of_scope",
				provider: "p",
				model: "same",
				message:
					"Model p/same is outside the current session model scope. Choose an available scoped model or update the parent session scope.",
			});
		}
	});

	it("compares provider/model pairs case-sensitively and fails malformed non-empty scope closed", () => {
		const selected = model("Provider", "Model");
		for (const scopedModels of [
			[{ model: model("provider", "Model") }],
			[{ model: model("Provider", "model") }],
			[{ broken: true }],
			{ malformed: true },
		]) {
			expect(
				resolveAgentSlot("explore", emptyConfig(), context([selected], undefined, scopedModels), pi(), {
					provider: "Provider",
					model: "Model",
				}),
			).toMatchObject({ ok: false, error: "model_out_of_scope" });
		}
	});

	it("applies thinking precedence: call, present slot, scoped pin, then inherited/default", () => {
		const selected = model("p", "m", { thinkingLevelMap: { max: "max" } });
		const scoped = [{ model: selected, thinkingLevel: "medium" }];
		const cfg = emptyConfig();
		cfg.agents.explore = { provider: "p", modelId: "m" };
		const ctx = context([selected], selected, scoped);
		expect(resolveAgentSlot("explore", cfg, ctx, pi("high"))).toMatchObject({ slot: { thinking: "medium" } });
		cfg.agents.explore = { provider: "p", modelId: "m", thinking: "low" };
		expect(resolveAgentSlot("explore", cfg, ctx, pi("high"))).toMatchObject({ slot: { thinking: "low" } });
		expect(resolveAgentSlot("explore", cfg, ctx, pi("high"), { thinking: "max" })).toMatchObject({
			slot: { thinking: "max" },
		});
	});

	it("uses the selected model pin for a model-only override", () => {
		const parent = model("p", "parent");
		const selected = model("p", "selected");
		const scoped = [
			{ model: parent, thinkingLevel: "low" },
			{ model: selected, thinkingLevel: "xhigh" },
		];
		expect(
			resolveAgentSlot("explore", emptyConfig(), context([parent, selected], parent, scoped), pi("medium"), {
				model: "selected",
			}),
		).toMatchObject({ slot: { provider: "p", modelId: "selected", thinking: "xhigh" } });
	});

	it("clamps structurally unsupported max and non-reasoning requests", () => {
		const fallback = model("p", "fallback", {
			thinkingLevelMap: { max: null, xhigh: null, high: null, medium: "medium" },
		});
		expect(
			resolveAgentSlot("explore", emptyConfig(), context([fallback]), pi(), {
				provider: "p",
				model: "fallback",
				thinking: "max",
			}),
		).toMatchObject({
			slot: { thinking: "medium" },
			thinkingAdjustment: { requested: "max", effective: "medium" },
		});
		const plain = model("p", "plain", { reasoning: false });
		expect(
			resolveAgentSlot("explore", emptyConfig(), context([plain]), pi(), {
				provider: "p",
				model: "plain",
				thinking: "high",
			}),
		).toMatchObject({ slot: { thinking: "off" } });
	});
});
