import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listStates, readState, writeState } from "../../src/state/store.js";
import type { SubagentState } from "../../src/types.js";

let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-state-"));
});
afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

const baseState = (agentId: string): SubagentState => ({
	schemaVersion: 1,
	agentId,
	parentAgentId: null,
	sessionId: "sess",
	agent: "explore",
	alias: "foo-search",
	agentSource: "bundled",
	task: "find foo",
	cwd: tmp,
	branch: null,
	model: "haiku",
	provider: "anthropic",
	thinking: "low",
	tools: ["read"],
	maxTurns: null,
	pid: null,
	startedAt: 1,
	finishedAt: null,
	lastUpdate: 1,
	status: "starting",
	exitCode: null,
	stopReason: null,
	errorMessage: null,
	turns: 0,
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 },
	lastText: null,
	lastToolCall: null,
	finalOutput: null,
	paths: {
		state: path.join(tmp, "sess", agentId, "state.json"),
		output: path.join(tmp, "sess", agentId, "output.jsonl"),
		stderr: path.join(tmp, "sess", agentId, "stderr.log"),
		prompt: path.join(tmp, "sess", agentId, "prompt.md"),
	},
});

describe("state store", () => {
	it("writeState then readState round-trips", async () => {
		const s = baseState("aaaaaaaa");
		await writeState(s);
		const back = await readState(s.paths.state);
		expect(back).toEqual(s);
	});

	it("readState returns null for missing file", async () => {
		const got = await readState(path.join(tmp, "nope.json"));
		expect(got).toBeNull();
	});

	it("readState normalizes mutable path fields to the actual state file location", async () => {
		const s = baseState("paths001");
		await writeState(s);
		writeFileSync(
			s.paths.state,
			JSON.stringify({
				...s,
				paths: {
					state: "/tmp/fake/state.json",
					output: "/etc/passwd",
					stderr: "/tmp/fake/stderr.log",
					prompt: "/tmp/fake/prompt.md",
				},
			}),
		);

		const back = await readState(s.paths.state);

		expect(back?.paths).toEqual(s.paths);
	});

	it("readState fills thinking and alias for legacy state files", async () => {
		const s = baseState("legacy01");
		const { thinking: _thinking, alias: _alias, ...legacy } = s;
		await writeState(legacy as SubagentState);
		const back = await readState(s.paths.state);
		expect(back?.thinking).toBe("low");
		expect(back?.alias).toBe("explore");
	});

	it("round-trips only the minimal valid differing thinking adjustment", async () => {
		const s = baseState("adjust01");
		s.thinking = "high";
		s.thinkingAdjustment = { requested: "max", effective: "high" };
		await writeState(s);
		const raw = JSON.parse(readFileSync(s.paths.state, "utf-8")) as Record<string, unknown>;
		raw.thinkingAdjustment = { requested: "max", effective: "high", ignored: "drop" };
		writeFileSync(s.paths.state, JSON.stringify(raw));

		const back = await readState(s.paths.state);
		expect(back?.thinking).toBe("high");
		expect(back?.thinkingAdjustment).toEqual({ requested: "max", effective: "high" });
		expect(Object.keys(back?.thinkingAdjustment ?? {})).toEqual(["requested", "effective"]);
	});

	it("drops malformed, invalid, partial, and equal adjustments without rejecting legacy state", async () => {
		const malformed: unknown[] = [
			undefined,
			null,
			[],
			"max/high",
			1,
			{},
			{ requested: "max" },
			{ effective: "high" },
			{ requested: 1, effective: "high" },
			{ requested: "max", effective: false },
			{ requested: "maximum", effective: "high" },
			{ requested: "max", effective: "maximum" },
			{ requested: "max", effective: "max" },
			{ requested: "off", effective: "off" },
			{ requested: "minimal", effective: "minimal" },
			{ requested: "low", effective: "low" },
			{ requested: "medium", effective: "medium" },
			{ requested: "high", effective: "high" },
			{ requested: "xhigh", effective: "xhigh" },
		];
		for (const [index, thinkingAdjustment] of malformed.entries()) {
			const s = baseState(`bad${index.toString().padStart(5, "0")}`);
			await writeState(s);
			const raw = JSON.parse(readFileSync(s.paths.state, "utf-8")) as Record<string, unknown>;
			if (thinkingAdjustment !== undefined) raw.thinkingAdjustment = thinkingAdjustment;
			writeFileSync(s.paths.state, JSON.stringify(raw));
			const back = await readState(s.paths.state);
			expect(back?.agentId).toBe(s.agentId);
			expect(back).not.toHaveProperty("thinkingAdjustment");
		}
	});

	it("readState retries on torn read (SyntaxError) up to 3 times", async () => {
		const s = baseState("bbbbbbbb");
		await writeState(s);
		// corrupt the file with partial content, then fix
		const target = s.paths.state;
		writeFileSync(target, "{ partial");
		setTimeout(() => writeFileSync(target, JSON.stringify(s)), 60);
		const back = await readState(target);
		expect(back?.agentId).toBe("bbbbbbbb");
	});

	it("listStates returns all states for a session", async () => {
		const a = baseState("11111111");
		const b = baseState("22222222");
		await writeState(a);
		await writeState(b);
		writeFileSync(a.paths.output, "{}\n");
		const list = await listStates(path.join(tmp, "sess"));
		expect(list.map((s) => s.agentId).sort()).toEqual(["11111111", "22222222"]);
		expect(list.find((s) => s.agentId === "11111111")?.transcriptSize).toBe(3);
	});
});
