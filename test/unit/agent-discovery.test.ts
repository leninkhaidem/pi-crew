import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverAgents } from "../../src/agents/discovery.js";

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-disc-"));
});
afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

const writeAgent = (dir: string, name: string, body: string) => {
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, `${name}.md`), `---\nname: ${name}\ndescription: ${name} desc\n---\n${body}`);
};

describe("discoverAgents", () => {
	it("returns bundled defaults when no user/project agents", () => {
		const r = discoverAgents({
			cwd: tmp,
			scope: "user",
			userAgentsDir: path.join(tmp, "user"),
			bundledDir: path.resolve("src/agents/defaults"),
		});
		const names = r.agents.map((a) => a.name).sort();
		expect(names).toEqual(["code-reviewer", "explore", "general-purpose", "plan"]);
		expect(r.agents.every((a) => a.source === "bundled")).toBe(true);
	});

	it("user agent shadows bundled default with same name", () => {
		const userDir = path.join(tmp, "user");
		writeAgent(userDir, "explore", "custom explore prompt");
		const r = discoverAgents({
			cwd: tmp,
			scope: "user",
			userAgentsDir: userDir,
			bundledDir: path.resolve("src/agents/defaults"),
		});
		const explore = r.agents.find((a) => a.name === "explore");
		expect(explore?.source).toBe("user");
		expect(explore?.systemPrompt).toContain("custom explore prompt");
	});

	it("project agent shadows user agent when scope=both", () => {
		const userDir = path.join(tmp, "user");
		const projDir = path.join(tmp, ".pi", "agents");
		writeAgent(userDir, "explore", "user version");
		writeAgent(projDir, "explore", "project version");
		const r = discoverAgents({
			cwd: tmp,
			scope: "both",
			userAgentsDir: userDir,
			bundledDir: path.resolve("src/agents/defaults"),
		});
		const explore = r.agents.find((a) => a.name === "explore");
		expect(explore?.source).toBe("project");
		expect(explore?.systemPrompt).toContain("project version");
	});

	it("scope=user excludes project agents", () => {
		const userDir = path.join(tmp, "user");
		const projDir = path.join(tmp, ".pi", "agents");
		writeAgent(projDir, "secret", "should not appear");
		const r = discoverAgents({
			cwd: tmp,
			scope: "user",
			userAgentsDir: userDir,
			bundledDir: path.resolve("src/agents/defaults"),
		});
		expect(r.agents.find((a) => a.name === "secret")).toBeUndefined();
	});

	it("returns projectAgentsDir when present", () => {
		const projDir = path.join(tmp, ".pi", "agents");
		mkdirSync(projDir, { recursive: true });
		const r = discoverAgents({
			cwd: tmp,
			scope: "both",
			userAgentsDir: path.join(tmp, "user"),
			bundledDir: path.resolve("src/agents/defaults"),
		});
		expect(r.projectAgentsDir).toBe(projDir);
	});
});
