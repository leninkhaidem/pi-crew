import { visibleWidth } from "@mariozechner/pi-tui";
import { describe, expect, it } from "vitest";
import { renderDispatchResult } from "../../src/ui/render-result.js";

const theme = {
	bold: (s: string) => s,
	fg: (_token: string, s: string) => s,
};

describe("renderDispatchResult", () => {
	it("renders blocking sub-agent results compactly by default while hiding verbose output", () => {
		const longOutput = `LONG_START ${"x".repeat(2000)} LONG_END`;
		const component = renderDispatchResult(
			{
				content: [{ type: "text", text: longOutput }],
				details: {
					agentId: "abc12345",
					alias: "deep-audit",
					agent: "explore",
					status: "done",
					provider: "openai-codex",
					model: "gpt-5.4-mini",
					thinking: "low",
					turns: 7,
					usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.0123, contextTokens: 3 },
					finalOutput: longOutput,
				},
			},
			{ expanded: false } as never,
			theme as never,
		);

		const lines = component.render(100);
		const rendered = lines.join("\n");
		expect(rendered).toContain("deep-audit #abc12345");
		expect(rendered).toContain("openai-codex/gpt-5.4-mini");
		expect(rendered).toContain("7 turns");
		expect(rendered).not.toContain("LONG_START");
		expect(lines.every((line) => visibleWidth(line) <= 100)).toBe(true);
	});
});
