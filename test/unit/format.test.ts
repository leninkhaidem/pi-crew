import { describe, expect, it } from "vitest";
import { formatTokens, formatToolCall, formatUsageStats } from "../../src/ui/format.js";

describe("format helpers", () => {
	it("formatTokens compresses thousands", () => {
		expect(formatTokens(900)).toBe("900");
		expect(formatTokens(1500)).toBe("1.5k");
		expect(formatTokens(15000)).toBe("15k");
		expect(formatTokens(1500000)).toBe("1.5M");
	});

	it("formatToolCall handles bash", () => {
		const out = formatToolCall("bash", { command: "ls -la" });
		expect(out).toContain("ls -la");
	});

	it("formatToolCall handles read with offset/limit", () => {
		const out = formatToolCall("read", { file_path: "/tmp/x.ts", offset: 10, limit: 20 });
		expect(out).toContain("/tmp/x.ts");
		expect(out).toContain("10-29");
	});

	it("formatUsageStats joins parts", () => {
		const out = formatUsageStats(
			{
				input: 8000,
				output: 2000,
				cacheRead: 0,
				cacheWrite: 0,
				cost: 0.0021,
				contextTokens: 10000,
				turns: 4,
			},
			"claude-haiku-4-5",
		);
		expect(out).toContain("4 turns");
		expect(out).toContain("8k");
		expect(out).toContain("$0.0021");
		expect(out).toContain("claude-haiku-4-5");
	});
});
