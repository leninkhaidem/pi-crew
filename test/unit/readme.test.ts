import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("README thinking contract", () => {
	it("documents structural max support and truthful generic downgrade behavior", () => {
		const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf-8");
		expect(readme).toContain("off|minimal|low|medium|high|xhigh|max");
		expect(readme).toContain("thinkingLevelMap.max");
		expect(readme).toContain("Model and provider names are never used as capability rules");
		expect(readme).toContain("requested and effective values");
		expect(readme).toContain("xhigh`, `high`, `medium`, `low`, `minimal`, `off`");
		expect(readme).toContain("generic model");
		expect(readme).not.toMatch(/authenticated models (include|are|:)/i);
		expect(readme).not.toContain("maximum");
	});
});
