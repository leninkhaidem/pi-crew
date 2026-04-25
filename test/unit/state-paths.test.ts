import path from "node:path";
import { describe, expect, it } from "vitest";
import { computePaths, getRoot } from "../../src/state/paths.js";

describe("state paths", () => {
	it("getRoot returns ~/.pi/agent/subagents by default", () => {
		const root = getRoot({ agentDir: "/tmp/pi" });
		expect(root).toBe("/tmp/pi/subagents");
	});

	it("computePaths produces all four pointers", () => {
		const p = computePaths({
			agentDir: "/tmp/pi",
			sessionId: "abc",
			agentId: "12345678",
		});
		expect(p.state).toBe("/tmp/pi/subagents/abc/12345678/state.json");
		expect(p.output).toBe("/tmp/pi/subagents/abc/12345678/output.jsonl");
		expect(p.stderr).toBe("/tmp/pi/subagents/abc/12345678/stderr.log");
		expect(p.prompt).toBe("/tmp/pi/subagents/abc/12345678/prompt.md");
	});

	it("ephemeral session id is normalized", () => {
		const p = computePaths({
			agentDir: "/tmp/pi",
			sessionId: undefined,
			agentId: "deadbeef",
		});
		expect(p.state).toMatch(/^\/tmp\/pi\/subagents\/ephemeral-\d+\/deadbeef\/state\.json$/);
	});
});
