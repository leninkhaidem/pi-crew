import { describe, expect, it } from "vitest";
import { generateAgentId } from "../../src/state/id.js";

describe("generateAgentId", () => {
	it("returns 8 hex characters", () => {
		const id = generateAgentId();
		expect(id).toMatch(/^[0-9a-f]{8}$/);
	});

	it("returns a different id each call (no collisions in 1000)", () => {
		const ids = new Set<string>();
		for (let i = 0; i < 1000; i++) ids.add(generateAgentId());
		expect(ids.size).toBe(1000);
	});
});
