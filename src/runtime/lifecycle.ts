import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { generateAgentId } from "../state/id.js";
import { computePaths } from "../state/paths.js";
import { readState, writeState } from "../state/store.js";
import {
	type AgentConfig,
	type AgentSlot,
	type DispatchOptions,
	type ExecutionMode,
	type SubagentState,
	type SubagentUsage,
	defaultThinkingForAgent,
} from "../types.js";
import { describeActivity } from "./activity.js";
import { createJsonlParser } from "./jsonl.js";
import { abortSubagentByStatePath } from "./kill.js";
import { appendFinalResultContract } from "./result-contract.js";
import { dispatchSession } from "./session-lifecycle.js";
import { type SpawnedSubagent, closeSpawnFds, spawnSubagent } from "./spawn.js";
import { sanitizeTranscriptEvent } from "./transcript.js";

export interface LifecycleEnv {
	agentDir: string;
	cwd: string;
	sessionId: string;
	batchId?: string | null;
	parentAgentId: string | null;
	binary?: string;
	branch?: string | null;
	executionMode?: ExecutionMode;
	ctx?: ExtensionContext;
}

export interface LifecycleHooks {
	onStateUpdate?: (state: SubagentState) => void;
	onEnd?: (state: SubagentState) => void;
}

export interface DispatchPlan {
	agent: AgentConfig;
	model: AgentSlot;
	options: DispatchOptions;
}

export interface DispatchHandle {
	agentId: string;
	state: SubagentState;
	donePromise: Promise<SubagentState>;
	abort?: (reason?: string) => Promise<void>;
	steer?: (message: string) => Promise<void>;
	resume?: (task: string, signal?: AbortSignal) => Promise<SubagentState>;
	dispose?: () => Promise<void> | void;
}

const STATE_DEBOUNCE_MS = 250;
const MAX_TURN_GRACE = 2;

export async function dispatch(
	plan: DispatchPlan,
	env: LifecycleEnv,
	hooks: LifecycleHooks = {},
): Promise<DispatchHandle> {
	const actualExecutionMode = env.executionMode === "session" && env.ctx ? "session" : "subprocess";
	if (actualExecutionMode === "session" && env.ctx) {
		return dispatchSession(plan, env as LifecycleEnv & { ctx: ExtensionContext }, hooks);
	}
	const agentId = generateAgentId();
	const sessionIdResolved = env.sessionId;
	const paths = computePaths({
		agentDir: env.agentDir,
		sessionId: sessionIdResolved,
		agentId,
	});

	const cwd = plan.options.cwd ?? env.cwd;
	const thinking = plan.model.thinking ?? defaultThinkingForAgent(plan.agent.name);
	const systemPrompt = appendFinalResultContract(plan.agent.systemPrompt);

	const initialState: SubagentState = {
		schemaVersion: 1,
		agentId,
		parentAgentId: env.parentAgentId,
		sessionId: sessionIdResolved,
		batchId: env.batchId ?? null,
		agent: plan.agent.name,
		alias: plan.options.alias,
		agentSource: plan.agent.source,
		task: plan.options.task,
		cwd,
		branch: env.branch ?? null,
		model: plan.model.modelId,
		provider: plan.model.provider,
		thinking,
		executionMode: actualExecutionMode,
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
		activeTools: [],
		toolUses: 0,
		activity: "starting…",
		finalOutput: null,
		paths,
	};

	await fs.mkdir(path.dirname(paths.state), { recursive: true });
	await fs.writeFile(paths.prompt, systemPrompt, { mode: 0o600 });
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
			thinking,
			tools: null,
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
	const activeTools = new Map<string, string>();
	let toolUses = 0;
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
				if (
					diskState &&
					(diskState.status === "aborted" || diskState.status === "orphaned" || diskState.status === "detached")
				)
					return;
				await writeState(snapshot);
				hooks.onStateUpdate?.(snapshot);
			} catch {
				// best effort; next write replaces it
			}
		}, STATE_DEBOUNCE_MS);
	};

	let maxTurnAbortRequested = false;
	const abort = async (reason = "killed by user") => {
		await writeState({ ...state, lastUpdate: Date.now() }).catch(() => undefined);
		await abortSubagentByStatePath(paths.state, reason).catch(() => undefined);
	};
	const abortForMaxTurns = () => {
		if (!plan.options.maxTurns || maxTurnAbortRequested) return;
		maxTurnAbortRequested = true;
		void abort(`maxTurns exceeded (${plan.options.maxTurns})`);
	};

	const handleTranscriptEvent = (e: unknown) => {
		const ev = e as { type?: string; message?: unknown; messages?: unknown[]; assistantMessageEvent?: unknown };
		if (ev.type === "message_update") {
			const update = ev.assistantMessageEvent as { type?: string; partial?: { content?: unknown[] } } | undefined;
			if (update?.type === "text_delta") {
				const text = extractFirstText(update.partial?.content) ?? state.lastText;
				if (text) {
					scheduleWrite({
						...state,
						lastText: text,
						activity: describeActivity(activeTools, text),
						lastUpdate: Date.now(),
					});
				}
			}
		} else if (ev.type === "message_end") {
			const msg = ev.message as { role?: string; usage?: unknown; content?: unknown; stopReason?: string } | undefined;
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
				if (msg.stopReason !== "stop" && plan.options.maxTurns && next.turns >= plan.options.maxTurns + MAX_TURN_GRACE)
					abortForMaxTurns();
			}
		} else if (ev.type === "tool_execution_start") {
			const tc = ev as { toolCallId?: string; toolName?: string; args?: unknown };
			if (tc.toolName) {
				activeTools.set(tc.toolCallId ?? `${tc.toolName}-${Date.now()}`, tc.toolName);
				scheduleWrite({
					...state,
					lastToolCall: { name: tc.toolName, args: (tc.args ?? {}) as Record<string, unknown> },
					activeTools: [...activeTools.values()],
					toolUses,
					activity: describeActivity(activeTools, state.lastText),
					lastUpdate: Date.now(),
				});
			}
		} else if (ev.type === "tool_execution_end") {
			const tc = ev as { toolCallId?: string; toolName?: string };
			if (tc.toolCallId) activeTools.delete(tc.toolCallId);
			else if (tc.toolName) deleteOneTool(activeTools, tc.toolName);
			toolUses++;
			scheduleWrite({
				...state,
				activeTools: [...activeTools.values()],
				toolUses,
				activity: describeActivity(activeTools, state.lastText),
				lastUpdate: Date.now(),
			});
		} else if (ev.type === "tool_call_start" && ev.message) {
			const tc = ev.message as { name?: string; arguments?: unknown };
			if (tc?.name) {
				activeTools.set(`${tc.name}-${Date.now()}`, tc.name);
				scheduleWrite({
					...state,
					lastToolCall: { name: tc.name, args: (tc.arguments ?? {}) as Record<string, unknown> },
					activeTools: [...activeTools.values()],
					toolUses,
					activity: describeActivity(activeTools, state.lastText),
					lastUpdate: Date.now(),
				});
			}
		} else if (ev.type === "agent_end") {
			const last = extractLastAssistantText(ev.messages ?? []);
			if (last) scheduleWrite({ ...state, finalOutput: last, activity: "finalizing…", lastUpdate: Date.now() });
		}
	};

	const outputStream = fsSync.createWriteStream(paths.output, { flags: "a", mode: 0o600 });
	const stdoutParser = createJsonlParser((event) => {
		handleTranscriptEvent(event);
		const sanitized = sanitizeTranscriptEvent(event);
		if (sanitized) outputStream.write(`${JSON.stringify(sanitized)}\n`);
	});
	spawned.proc.stdout?.on("data", (chunk) => stdoutParser.write(chunk));

	const donePromise = new Promise<SubagentState>((resolve) => {
		let finalized = false;
		const finalize = async (finalState: SubagentState) => {
			if (finalized) return;
			finalized = true;
			closing = true;
			pendingUpdate = null;
			if (writeTimer) {
				clearTimeout(writeTimer);
				writeTimer = null;
			}
			stdoutParser.flush();
			await closeStream(outputStream);
			closeSpawnFds(spawned);
			await writeState(finalState);
			hooks.onEnd?.(finalState);
			resolve(finalState);
		};

		spawned.proc.once("error", async (err) => {
			stdoutParser.flush();
			const currentDisk = await readState(paths.state);
			const finalState: SubagentState = isExternallyTerminal(currentDisk)
				? {
						...currentDisk,
						finishedAt: currentDisk.finishedAt ?? Date.now(),
						lastUpdate: Date.now(),
					}
				: {
						...state,
						exitCode: -1,
						finishedAt: Date.now(),
						lastUpdate: Date.now(),
						status: "failed",
						errorMessage: err.message,
						activeTools: [],
						activity: "failed",
						finalOutput: state.finalOutput ?? null,
					};
			await finalize(finalState);
		});

		spawned.proc.once("close", async (code) => {
			stdoutParser.flush();
			// Re-read state to detect external finalization (e.g., subagent_kill set status to "aborted").
			const currentDisk = await readState(paths.state);
			const stderrText = await tryReadTail(paths.stderr);

			const finalState: SubagentState = isExternallyTerminal(currentDisk)
				? {
						...currentDisk,
						exitCode: code ?? currentDisk.exitCode,
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
						activeTools: [],
						activity: code === 0 ? "done" : "failed",
						finalOutput: state.finalOutput ?? null,
					};
			await finalize(finalState);
		});
	});

	return { agentId, state, donePromise, abort };
}

function isExternallyTerminal(state: SubagentState | null): state is SubagentState {
	return Boolean(state && (state.status === "aborted" || state.status === "orphaned" || state.status === "detached"));
}

async function closeStream(stream: fsSync.WriteStream): Promise<void> {
	await new Promise<void>((resolve) => {
		stream.end(() => resolve());
	});
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

function deleteOneTool(activeTools: Map<string, string>, toolName: string): void {
	for (const [key, name] of activeTools) {
		if (name === toolName) {
			activeTools.delete(key);
			return;
		}
	}
}

async function tryReadTail(p: string): Promise<string> {
	try {
		const data = await fs.readFile(p, "utf-8");
		return data;
	} catch {
		return "";
	}
}
