import { describe, expect, it } from "vitest";
import { parsePiCrewConfig } from "../../src/config/schema.js";

describe("parsePiCrewConfig", () => {
	it("accepts a complete config", () => {
		const r = parsePiCrewConfig({
			version: 1,
			agents: { explore: { provider: "anthropic", modelId: "claude-haiku-4-5" } },
			global: {
				maxConcurrent: 4,
				maxActive: 16,
				maxParallelTasksPerCall: 8,
				retentionDays: 7,
				notifyOnCompletion: true,
				agentScope: "user",
				confirmProjectAgents: true,
			},
			tmux: { mode: "off", killOnComplete: "off", graceSeconds: 30 },
		});
		expect(r.ok).toBe(true);
	});

	it("fills defaults when global/tmux missing", () => {
		const r = parsePiCrewConfig({
			version: 1,
			agents: {},
		});
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value.global.maxConcurrent).toBe(4);
			expect(r.value.tmux.mode).toBe("off");
		}
	});

	it("rejects bad version", () => {
		const r = parsePiCrewConfig({ version: 99, agents: {} });
		expect(r.ok).toBe(false);
	});

	it("rejects bad enum value", () => {
		const r = parsePiCrewConfig({
			version: 1,
			agents: {},
			tmux: { mode: "split", killOnComplete: "off", graceSeconds: 30 },
		});
		expect(r.ok).toBe(false);
	});
});
