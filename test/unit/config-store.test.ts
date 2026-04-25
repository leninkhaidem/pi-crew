import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, saveConfig } from "../../src/config/store.js";

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-conf-"));
});
afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

describe("config store", () => {
	it("loadConfig returns empty config when no file present", async () => {
		const r = await loadConfig(path.join(tmp, "missing.json"));
		expect(r.config.agents).toEqual({});
		expect(r.path).toBe(path.join(tmp, "missing.json"));
		expect(r.fromDisk).toBe(false);
	});

	it("saveConfig then loadConfig round-trips", async () => {
		const target = path.join(tmp, "pi-crew.json");
		await saveConfig(target, {
			version: 1,
			agents: { explore: { provider: "anthropic", modelId: "claude-haiku-4-5", thinking: "low" } },
			global: {
				maxConcurrent: 4,
				maxActive: 16,
				maxParallelTasksPerCall: 8,
				retentionDays: 7,
				notifyOnCompletion: true,
				agentScope: "user",
				confirmProjectAgents: true,
				executionMode: "session",
			},
			tmux: { mode: "off", killOnComplete: "off", graceSeconds: 30 },
		});
		const r = await loadConfig(target);
		expect(r.config.agents.explore?.provider).toBe("anthropic");
		expect(r.fromDisk).toBe(true);
	});

	it("loadConfig surfaces parse errors as empty + error list", async () => {
		const target = path.join(tmp, "bad.json");
		writeFileSync(target, JSON.stringify({ version: 99 }));
		const r = await loadConfig(target);
		expect(r.config.agents).toEqual({});
		expect(r.errors.length).toBeGreaterThan(0);
	});
});
