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
			expect(r.value.global.executionMode).toBe("session");
			expect(r.value.tmux.mode).toBe("off");
		}
	});

	it("accepts global subprocess execution mode", () => {
		const r = parsePiCrewConfig({
			version: 1,
			agents: {},
			global: {
				maxConcurrent: 4,
				maxActive: 16,
				maxParallelTasksPerCall: 8,
				retentionDays: 7,
				notifyOnCompletion: true,
				agentScope: "user",
				confirmProjectAgents: true,
				executionMode: "subprocess",
			},
		});
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value.global.executionMode).toBe("subprocess");
	});

	it("fills per-slot thinking defaults when missing", () => {
		const r = parsePiCrewConfig({
			version: 1,
			agents: {
				explore: { provider: "anthropic", modelId: "claude-haiku-4-5" },
				"general-purpose": { provider: "anthropic", modelId: "claude-sonnet-4-5" },
				plan: { provider: "anthropic", modelId: "claude-opus-4" },
				"code-reviewer": { provider: "anthropic", modelId: "claude-opus-4" },
				custom: { provider: "openai", modelId: "gpt-5" },
			},
		});
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect((r.value.agents.explore as { thinking?: string } | undefined)?.thinking).toBe("low");
			expect((r.value.agents["general-purpose"] as { thinking?: string } | undefined)?.thinking).toBe("medium");
			expect((r.value.agents.plan as { thinking?: string } | undefined)?.thinking).toBe("high");
			expect((r.value.agents["code-reviewer"] as { thinking?: string } | undefined)?.thinking).toBe("high");
			expect((r.value.agents.custom as { thinking?: string } | undefined)?.thinking).toBe("medium");
		}
	});

	it("accepts explicit thinking levels", () => {
		const r = parsePiCrewConfig({
			version: 1,
			agents: { explore: { provider: "anthropic", modelId: "claude-haiku-4-5", thinking: "off" } },
		});
		expect(r.ok).toBe(true);
		if (r.ok) expect((r.value.agents.explore as { thinking?: string } | undefined)?.thinking).toBe("off");
	});

	it("preserves unknown per-slot config keys", () => {
		const r = parsePiCrewConfig({
			version: 1,
			agents: {
				explore: {
					provider: "anthropic",
					modelId: "claude-haiku-4-5",
					experimentalFlag: true,
				},
			},
		});
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect((r.value.agents.explore as { experimentalFlag?: boolean } | undefined)?.experimentalFlag).toBe(true);
		}
	});

	it("rejects bad thinking levels", () => {
		const r = parsePiCrewConfig({
			version: 1,
			agents: { explore: { provider: "anthropic", modelId: "claude-haiku-4-5", thinking: "maximum" } },
		});
		expect(r.ok).toBe(false);
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
