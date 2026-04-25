import fs from "node:fs/promises";
import path from "node:path";
import { generateAgentId } from "../state/id.js";
import { computePaths } from "../state/paths.js";
import { readState, writeState } from "../state/store.js";
import type { AgentConfig, DispatchOptions, SubagentState, SubagentUsage } from "../types.js";
import { type SpawnedSubagent, closeSpawnFds, spawnSubagent } from "./spawn.js";
import { tailJsonl } from "./tail.js";

export interface LifecycleEnv {
	agentDir: string;
	cwd: string;
	sessionId: string | undefined;
	parentAgentId: string | null;
	binary?: string;
	branch?: string | null;
}

export interface LifecycleHooks {
	onStateUpdate?: (state: SubagentState) => void;
	onEnd?: (state: SubagentState) => void;
}

export interface DispatchPlan {
	agent: AgentConfig;
	model: { provider: string; modelId: string };
	options: DispatchOptions;
}

export interface DispatchHandle {
	agentId: string;
	state: SubagentState;
	donePromise: Promise<SubagentState>;
}

const STATE_DEBOUNCE_MS = 250;

export async function dispatch(
	plan: DispatchPlan,
	env: LifecycleEnv,
	hooks: LifecycleHooks = {},
): Promise<DispatchHandle> {
	const agentId = generateAgentId();
	const sessionIdResolved = env.sessionId ?? `ephemeral-${Date.now()}`;
	const paths = computePaths({
		agentDir: env.agentDir,
		sessionId: sessionIdResolved,
		agentId,
	});

	const cwd = plan.options.cwd ?? env.cwd;

	const initialState: SubagentState = {
		schemaVersion: 1,
		agentId,
		parentAgentId: env.parentAgentId,
		sessionId: sessionIdResolved,
		agent: plan.agent.name,
		agentSource: plan.agent.source,
		task: plan.options.task,
		cwd,
		branch: env.branch ?? null,
		model: plan.model.modelId,
		provider: plan.model.provider,
		tools: plan.agent.tools,
		maxTurns: plan.options.maxTurns ?? null,
		pid: null,
		startedAt: Date.now(),
		finishedAt: null,
		lastUpdate: Date.now(),
		status: "starting",
		exitCode: null,
		stopReason: null,
		errorMessage: null,
		turns: 0,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 },
		lastText: null,
		lastToolCall: null,
		finalOutput: null,
		paths,
	};

	await fs.mkdir(path.dirname(paths.state), { recursive: true });
	await fs.writeFile(paths.prompt, plan.agent.systemPrompt, { mode: 0o600 });
	// Pre-create empty output and stderr files so spawn fds open them with append mode.
	await fs.writeFile(paths.output, "", { mode: 0o600 });
	await fs.writeFile(paths.stderr, "", { mode: 0o600 });
	await writeState(initialState);
	hooks.onStateUpdate?.(initialState);

	let spawned: SpawnedSubagent;
	try {
		spawned = spawnSubagent({
			binary: env.binary,
			model: `${plan.model.provider}/${plan.model.modelId}`,
			tools: plan.agent.tools,
			systemPromptPath: paths.prompt,
			task: plan.options.task,
			cwd,
			outputPath: paths.output,
			stderrPath: paths.stderr,
			parentAgentId: agentId,
			sessionId: sessionIdResolved,
		});
	} catch (err) {
		const failed: SubagentState = {
			...initialState,
			status: "failed",
			errorMessage: (err as Error).message,
			finishedAt: Date.now(),
			lastUpdate: Date.now(),
		};
		await writeState(failed);
		hooks.onEnd?.(failed);
		return {
			agentId,
			state: failed,
			donePromise: Promise.resolve(failed),
		};
	}

	let state: SubagentState = { ...initialState, pid: spawned.pid, status: "running" };
	await writeState(state);
	hooks.onStateUpdate?.(state);

	let pendingUpdate: SubagentState | null = null;
	let writeTimer: NodeJS.Timeout | null = null;
	let closing = false;
	const scheduleWrite = (next: SubagentState) => {
		pendingUpdate = next;
		state = next;
		if (writeTimer) return;
		writeTimer = setTimeout(async () => {
			writeTimer = null;
			if (!pendingUpdate || closing) return;
			const snapshot = pendingUpdate;
			pendingUpdate = null;
			try {
				// Guard: skip write if the on-disk state has been externally finalized (e.g., subagent_kill).
				const diskState = await readState(paths.state);
				if (diskState && (diskState.status === "aborted" || diskState.status === "orphaned")) return;
				await writeState(snapshot);
				hooks.onStateUpdate?.(snapshot);
			} catch {
				// best effort; next write replaces it
			}
		}, STATE_DEBOUNCE_MS);
	};

	const tail = tailJsonl({
		path: paths.output,
		onEvent: (e) => {
			const ev = e as { type?: string; message?: unknown; messages?: unknown[] };
			if (ev.type === "message_end") {
				const msg = ev.message as
					| { role?: string; usage?: unknown; content?: unknown; stopReason?: string }
					| undefined;
				if (msg?.role === "assistant") {
					const u = msg.usage as Partial<SubagentUsage> | undefined;
					const costTotal: number = (u as { cost?: { total?: number } } | undefined)?.cost?.total ?? 0;
					const next: SubagentState = {
						...state,
						turns: state.turns + 1,
						usage: u
							? {
									input: state.usage.input + (u.input ?? 0),
									output: state.usage.output + (u.output ?? 0),
									cacheRead: state.usage.cacheRead + (u.cacheRead ?? 0),
									cacheWrite: state.usage.cacheWrite + (u.cacheWrite ?? 0),
									cost: state.usage.cost + costTotal,
									contextTokens: (u as { totalTokens?: number }).totalTokens ?? state.usage.contextTokens,
								}
							: state.usage,
						lastText: extractFirstText(msg.content) ?? state.lastText,
						stopReason: msg.stopReason ?? state.stopReason,
						lastUpdate: Date.now(),
					};
					scheduleWrite(next);
				}
			} else if (ev.type === "tool_call_start" && ev.message) {
				const tc = ev.message as { name?: string; arguments?: unknown };
				if (tc?.name) {
					scheduleWrite({
						...state,
						lastToolCall: { name: tc.name, args: (tc.arguments ?? {}) as Record<string, unknown> },
						lastUpdate: Date.now(),
					});
				}
			} else if (ev.type === "agent_end") {
				const last = extractLastAssistantText(ev.messages ?? []);
				if (last) {
					scheduleWrite({ ...state, finalOutput: last, lastUpdate: Date.now() });
				}
			}
		},
		onError: () => {
			// non-fatal; keep tailing
		},
	});

	const donePromise = new Promise<SubagentState>((resolve) => {
		spawned.proc.once("close", async (code) => {
			// Prevent any in-flight debounced write from overwriting externally-set terminal state.
			closing = true;
			pendingUpdate = null;
			if (writeTimer) {
				clearTimeout(writeTimer);
				writeTimer = null;
			}
			// Give tail one final tick to drain.
			await new Promise((r) => setTimeout(r, 150));
			await tail.stop();
			closeSpawnFds(spawned);

			// Re-read state to detect external finalization (e.g., subagent_kill set status to "aborted").
			const currentDisk = await readState(paths.state);
			const stderrText = await tryReadTail(paths.stderr);

			const finalState: SubagentState =
				currentDisk && (currentDisk.status === "aborted" || currentDisk.status === "orphaned")
					? {
							...currentDisk,
							exitCode: code,
							finishedAt: currentDisk.finishedAt ?? Date.now(),
							lastUpdate: Date.now(),
						}
					: {
							...state,
							exitCode: code,
							finishedAt: Date.now(),
							lastUpdate: Date.now(),
							status: code === 0 ? "done" : "failed",
							errorMessage: code === 0 ? null : stderrText.slice(-1024) || `exit code ${code}`,
							finalOutput: state.finalOutput ?? null,
						};
			await writeState(finalState);
			hooks.onEnd?.(finalState);
			resolve(finalState);
		});
	});

	return { agentId, state, donePromise };
}

function extractFirstText(content: unknown): string | null {
	if (!Array.isArray(content)) return null;
	for (const part of content) {
		if (part && typeof part === "object" && (part as { type?: string }).type === "text") {
			const t = (part as { text?: string }).text;
			return typeof t === "string" ? t.slice(0, 500) : null;
		}
	}
	return null;
}

function extractLastAssistantText(messages: unknown[]): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i] as { role?: string; content?: unknown[] };
		if (m?.role === "assistant" && Array.isArray(m.content)) {
			for (const part of m.content) {
				const p = part as { type?: string; text?: string };
				if (p?.type === "text" && typeof p.text === "string") {
					return p.text;
				}
			}
		}
	}
	return null;
}

async function tryReadTail(p: string): Promise<string> {
	try {
		const data = await fs.readFile(p, "utf-8");
		return data;
	} catch {
		return "";
	}
}
