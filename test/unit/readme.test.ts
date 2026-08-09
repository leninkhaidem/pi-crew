import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("README public contract", () => {
	it("documents the current SDK, tool, scope, thinking, and runtime boundaries", () => {
		const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf-8");
		expect(readme).toContain("off|minimal|low|medium|high|xhigh|max");
		expect(readme).toContain("thinkingLevelMap.max");
		expect(readme).toContain("Model and provider names are never used as capability rules");
		expect(readme).toContain("per-call choice, an explicitly saved slot choice, the selected scoped-model pin");
		expect(readme).toContain("exact case-sensitive provider/model pairs");
		expect(readme).toContain("public `@earendil-works/*` 0.84.1 SDK");
		expect(readme).toContain("not a claim that future pre-1.0 releases have been verified");
		expect(readme).toContain("Subprocess mode rejects runtime-only authentication before spawning");
		expect(readme).not.toContain("`Agent`");
		expect(readme).not.toContain("maximum");
	});
});
