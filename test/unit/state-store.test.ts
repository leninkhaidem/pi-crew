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

	it("readState fills thinking and alias for legacy state files", async () => {
		const s = baseState("legacy01");
		const { thinking: _thinking, alias: _alias, ...legacy } = s;
		await writeState(legacy as SubagentState);
		const back = await readState(s.paths.state);
		expect(back?.thinking).toBe("low");
		expect(back?.alias).toBe("explore");
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
		const list = await listStates(path.join(tmp, "sess"));
		expect(list.map((s) => s.agentId).sort()).toEqual(["11111111", "22222222"]);
	});
});
