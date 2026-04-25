import { describe, expect, it } from "vitest";
import { suggestDefaults } from "../../src/config/auto.js";

const M = (provider: string, id: string, reasoning: boolean, costInput: number) =>
	({
		provider,
		id,
		reasoning,
		cost: { input: costInput, output: 0, cacheRead: 0, cacheWrite: 0 },
		// biome-ignore lint/suspicious/noExplicitAny: pragmatic for unit testing
	}) as any;

describe("suggestDefaults", () => {
	it("picks cheapest reasoning=false for explore", () => {
		const models = [
			M("anthropic", "claude-haiku-4-5", false, 0.25),
			M("anthropic", "claude-sonnet-4-5", true, 3),
			M("openai", "gpt-5-mini", false, 0.15),
		];
		const r = suggestDefaults(models);
		expect(r.agents.explore?.modelId).toBe("gpt-5-mini");
	});

	it("picks most-capable reasoning model for plan/code-reviewer", () => {
		const models = [
			M("anthropic", "claude-haiku-4-5", false, 0.25),
			M("anthropic", "claude-sonnet-4-5", true, 3),
			M("anthropic", "claude-opus-4", true, 15),
		];
		const r = suggestDefaults(models);
		expect(r.agents.plan?.modelId).toBe("claude-opus-4");
		expect(r.agents["code-reviewer"]?.modelId).toBe("claude-opus-4");
	});

	it("general-purpose prefers sonnet over opus when both available", () => {
		const models = [M("anthropic", "claude-sonnet-4-5", true, 3), M("anthropic", "claude-opus-4", true, 15)];
		const r = suggestDefaults(models);
		expect(r.agents["general-purpose"]?.modelId).toBe("claude-sonnet-4-5");
	});

	it("returns empty agents when no models authenticated", () => {
		const r = suggestDefaults([]);
		expect(r.agents).toEqual({});
	});
});
