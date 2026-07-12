import { describe, expect, it, vi } from "vitest";
import { EV, createEmitter } from "../../src/notify/events.js";

describe("public pi.events payload compatibility", () => {
	it("emits unchanged dispatch and end payload objects without adjustment fields", () => {
		const emit = vi.fn();
		const emitter = createEmitter({ events: { emit } } as never);
		const dispatch = {
			agentId: "agent",
			parentAgentId: null,
			agent: "explore",
			alias: "scan",
			task: "scan",
			cwd: "/repo",
			model: "reasoner",
			provider: "example",
			sessionId: "session",
		};
		const end = {
			agentId: "agent",
			status: "done" as const,
			exitCode: 0,
			stopReason: "stop",
			finalOutput: "done",
			usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 5, contextTokens: 6 },
			errorMessage: null,
		};
		emitter.dispatch(dispatch);
		emitter.end(end);
		expect(emit).toHaveBeenNthCalledWith(1, EV.dispatch, dispatch);
		expect(emit).toHaveBeenNthCalledWith(2, EV.end, end);
		expect(Object.keys(emit.mock.calls[0]?.[1] ?? {}).sort()).toEqual(Object.keys(dispatch).sort());
		expect(Object.keys(emit.mock.calls[1]?.[1] ?? {}).sort()).toEqual(Object.keys(end).sort());
		expect(JSON.stringify(emit.mock.calls)).not.toContain("thinkingAdjustment");
	});
});
