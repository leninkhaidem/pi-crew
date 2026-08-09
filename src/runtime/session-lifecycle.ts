import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
	type AgentSessionServices,
	type ExtensionContext,
	SessionManager,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "@earendil-works/pi-coding-agent";
import { generateAgentId } from "../state/id.js";
import { computePaths } from "../state/paths.js";
import { readState, writeState } from "../state/store.js";
import { type SubagentState, type SubagentUsage, defaultThinkingForAgent } from "../types.js";
import { describeActivity } from "./activity.js";
import { abortSubagentByStatePath } from "./kill.js";
import type { DispatchHandle, DispatchPlan, LifecycleEnv, LifecycleHooks } from "./lifecycle.js";
import {
	OVERFLOW_RECOVERY_FAILED_STOP_REASON,
	OverflowRecoveryTracker,
	normalizeRecoveredOverflowStopReason,
	overflowRecoveryActivity,
} from "./overflow-recovery.js";
import { appendFinalResultContract } from "./result-contract.js";
import { suppressPiCrewOrchestrationTools, withoutPiCrewOrchestrationExtensions } from "./tool-suppression.js";
import { sanitizeTranscriptEvent } from "./transcript.js";

const STATE_DEBOUNCE_MS = 80;
const MAX_TURN_GRACE = 2;

export async function dispatchSession(
	plan: DispatchPlan,
	env: LifecycleEnv & { ctx: ExtensionContext },
	hooks: LifecycleHooks = {},
): Promise<DispatchHandle> {
	throwIfAborted(env.signal);
	const agentId = generateAgentId();
	const sessionIdResolved = env.sessionId;
	const paths = computePaths({ agentDir: env.agentDir, sessionId: sessionIdResolved, agentId });
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
		...(plan.thinkingAdjustment ? { thinkingAdjustment: plan.thinkingAdjustment } : {}),
		executionMode: "session",
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

	try {
		await fs.mkdir(path.dirname(paths.state), { recursive: true });
		throwIfAborted(env.signal);
		await fs.writeFile(paths.prompt, systemPrompt, { mode: 0o600 });
		throwIfAborted(env.signal);
		await fs.writeFile(paths.output, "", { mode: 0o600 });
		throwIfAborted(env.signal);
		await fs.writeFile(paths.stderr, "", { mode: 0o600 });
		throwIfAborted(env.signal);
		await writeState(initialState);
		throwIfAborted(env.signal);
		hooks.onStateUpdate?.(initialState);
	} catch (error) {
		if (!env.signal?.aborted) throw error;
		return finalizeCancelledStartup(initialState, hooks);
	}

	let outputStream = fsSync.createWriteStream(paths.output, { flags: "a", mode: 0o600 });
	let outputStreamClosed = false;
	const ensureOutputStream = () => {
		if (outputStreamClosed) {
			outputStream = fsSync.createWriteStream(paths.output, { flags: "a", mode: 0o600 });
			outputStreamClosed = false;
		}
		return outputStream;
	};
	const closeOutputStream = async () => {
		if (outputStreamClosed) return;
		outputStreamClosed = true;
		await closeStream(outputStream);
	};
	const appendEvent = (event: unknown) => {
		try {
			const sanitized = sanitizeTranscriptEvent(event);
			if (sanitized) ensureOutputStream().write(`${JSON.stringify(sanitized)}\n`);
		} catch {
			// best effort transcript
		}
	};

	let state: SubagentState = { ...initialState };
	let session: Awaited<ReturnType<typeof createAgentSessionFromServices>>["session"] | null = null;
	let services: AgentSessionServices | null = null;
	const runtimeOverride = { installed: false };
	let unsubscribe: () => void = () => undefined;
	let pendingUpdate: SubagentState | null = null;
	let writeTimer: NodeJS.Timeout | null = null;
	let closing = false;
	let abortReason: string | undefined;
	let hardAborted = false;
	let softLimitReached = false;
	let nonUserDisposeRequested = false;
	let recoveryTracker = new OverflowRecoveryTracker();
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

	try {
		throwIfAborted(env.signal);
		services = await createAgentSessionServices({
			cwd,
			agentDir: env.agentDir,
			modelRuntimeSignal: env.signal,
			resourceLoaderOptions: {
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
				systemPromptOverride: () => systemPrompt,
				appendSystemPromptOverride: () => [],
				extensionsOverride: withoutPiCrewOrchestrationExtensions,
			},
		});
		throwIfAborted(env.signal);
		const diagnostic = services.diagnostics.find((item) => item.type === "error");
		if (diagnostic)
			throw new Error("Child session service initialization failed; inspect provider/extension configuration.");
		await reconcileRuntimeAuth(env.ctx, services, plan.model.provider, runtimeOverride, env.signal);
		throwIfAborted(env.signal);
		const model = services.modelRuntime.getModel(plan.model.provider, plan.model.modelId);
		if (!model) throw new Error(`Model not available: ${plan.model.provider}/${plan.model.modelId}`);
		const available = await getAvailableModels(services, plan.model.provider, plan.model.modelId, env.signal);
		throwIfAborted(env.signal);
		if (!available.some((candidate) => candidate.provider === model.provider && candidate.id === model.id)) {
			throw new Error(`Model authentication unavailable: ${plan.model.provider}/${plan.model.modelId}`);
		}
		const created = await createAgentSessionFromServices({
			services,
			sessionManager: SessionManager.inMemory(cwd),
			model,
			thinkingLevel: thinking,
		});
		session = created.session;
		throwIfAborted(env.signal);
		suppressPiCrewOrchestrationTools(session);
		await session.bindExtensions({
			onError: (err) => {
				void fs
					.appendFile(paths.stderr, `extension error: ${err.extensionPath}: ${String(err.error)}\n`)
					.catch(() => undefined);
			},
		});
		throwIfAborted(env.signal);
		suppressPiCrewOrchestrationTools(session);
	} catch (err) {
		try {
			session?.dispose();
		} catch {
			// Best-effort cleanup must not replace the truthful startup failure.
		}
		const message = safeErrorMessage(err);
		if (!env.signal?.aborted) await fs.appendFile(paths.stderr, `${message}\n`).catch(() => undefined);
		const failed: SubagentState = {
			...initialState,
			status: env.signal?.aborted ? "aborted" : "failed",
			errorMessage: message,
			finishedAt: Date.now(),
			lastUpdate: Date.now(),
			activity: env.signal?.aborted ? "aborted" : "failed",
		};
		await writeState(failed);
		await closeOutputStream();
		hooks.onEnd?.(failed);
		return { agentId, state: failed, donePromise: Promise.resolve(failed) };
	}

	state = {
		...initialState,
		status: "running",
		lastUpdate: Date.now(),
		activity: "thinking…",
	};
	try {
		throwIfAborted(env.signal);
		await writeState(state);
		throwIfAborted(env.signal);
		hooks.onStateUpdate?.(state);
	} catch (error) {
		if (!env.signal?.aborted) throw error;
		try {
			session.dispose();
		} catch {
			// Best-effort cancellation cleanup.
		}
		const aborted: SubagentState = {
			...state,
			status: "aborted",
			exitCode: -1,
			errorMessage: "Interrupted before sub-agent launch.",
			finishedAt: Date.now(),
			lastUpdate: Date.now(),
			activity: "aborted",
		};
		await closeOutputStream();
		await writeState(aborted);
		hooks.onEnd?.(aborted);
		return { agentId, state: aborted, donePromise: Promise.resolve(aborted) };
	}

	const subscribeForRun = () => {
		unsubscribe = session!.subscribe((event: unknown) => {
			recoveryTracker.observeEvent(event);
			appendEvent(event);
			handleSessionEvent(event, {
				getState: () => state,
				scheduleWrite,
				activeTools,
				getToolUses: () => toolUses,
				setToolUses: (value) => {
					toolUses = value;
				},
				onHardAbort: async () => {
					if (!session || hardAborted) return;
					hardAborted = true;
					abortReason = `maxTurns exceeded (${plan.options.maxTurns})`;
					await writeState({ ...state, lastUpdate: Date.now() }).catch(() => undefined);
					await abortSubagentByStatePath(paths.state, abortReason).catch(() => undefined);
					recoveryTracker.markExternallyTerminal();
					await session.abort().catch(() => undefined);
				},
				onSoftLimit: async () => {
					if (!session || softLimitReached) return;
					softLimitReached = true;
					await session
						.steer("You have reached your turn limit. Wrap up immediately — provide your final answer now.")
						.catch(() => undefined);
				},
				maxTurns: plan.options.maxTurns,
			});
		});
	};

	const abort = async (reason = "killed by user") => {
		abortReason = reason;
		await writeState({ ...state, lastUpdate: Date.now() }).catch(() => undefined);
		await abortSubagentByStatePath(paths.state, reason).catch(() => undefined);
		recoveryTracker.markExternallyTerminal();
		await session?.abort().catch(() => undefined);
	};

	const steer = async (message: string) => {
		if (!session) throw new Error("session not available");
		await session.steer(message);
	};

	const markRunning = async (task: string, signal?: AbortSignal) => {
		activeTools.clear();
		abortReason = undefined;
		hardAborted = false;
		softLimitReached = false;
		closing = false;
		nonUserDisposeRequested = false;
		recoveryTracker = new OverflowRecoveryTracker();
		pendingUpdate = null;
		if (writeTimer) {
			clearTimeout(writeTimer);
			writeTimer = null;
		}
		const runningState: SubagentState = {
			...state,
			task,
			status: "running",
			exitCode: null,
			stopReason: null,
			errorMessage: null,
			finishedAt: null,
			lastUpdate: Date.now(),
			activeTools: [],
			activity: "thinking…",
			finalOutput: null,
		};
		throwIfAborted(signal);
		await writeState(runningState);
		throwIfAborted(signal);
		state = runningState;
		hooks.onStateUpdate?.(state);
	};

	const finalizeCancelledResume = async (task: string): Promise<SubagentState> => {
		closing = true;
		pendingUpdate = null;
		if (writeTimer) {
			clearTimeout(writeTimer);
			writeTimer = null;
		}
		activeTools.clear();
		const aborted: SubagentState = {
			...state,
			task,
			status: "aborted",
			exitCode: -1,
			stopReason: null,
			errorMessage: "Interrupted before sub-agent resume.",
			finishedAt: Date.now(),
			lastUpdate: Date.now(),
			activeTools: [],
			activity: "aborted",
			finalOutput: null,
		};
		await closeOutputStream();
		await writeState(aborted);
		state = aborted;
		hooks.onEnd?.(aborted);
		return aborted;
	};

	const runPrompt = async (task: string, signal?: AbortSignal): Promise<SubagentState> => {
		if (!session) throw new Error("session not available");
		throwIfAborted(signal);
		ensureOutputStream();
		throwIfAborted(signal);
		subscribeForRun();
		let promptError: unknown;
		try {
			throwIfAborted(signal);
			await session.prompt(`Task: ${task}`, { source: "extension" });
			if (signal?.aborted) abortReason = "Interrupted before sub-agent request completed.";
		} catch (err) {
			promptError = err;
			if (signal?.aborted) abortReason = "Interrupted before sub-agent request completed.";
		}

		const promptErrorMessage =
			promptError instanceof Error ? promptError.message : promptError ? String(promptError) : null;
		recoveryTracker.observePromptError(promptErrorMessage);
		if (nonUserDisposeRequested) recoveryTracker.markDisposed();
		await recoveryTracker.waitForRecoveryCompletion();

		closing = true;
		pendingUpdate = null;
		if (writeTimer) {
			clearTimeout(writeTimer);
			writeTimer = null;
		}
		unsubscribe();
		unsubscribe = () => undefined;

		const currentDisk = await readState(paths.state);
		const finalText =
			state.finalOutput ?? extractLastAssistantText((session?.messages ?? []) as unknown[]) ?? state.lastText;
		const recoveryFailureMessage = recoveryTracker.getFailureMessage();
		const nonAbortFailureMessage = recoveryFailureMessage ?? promptErrorMessage ?? null;
		const explicitAbortReason = abortReason ?? (hardAborted ? `maxTurns exceeded (${plan.options.maxTurns})` : null);
		const externalTerminal =
			currentDisk &&
			(currentDisk.status === "aborted" || currentDisk.status === "orphaned" || currentDisk.status === "detached");
		const stopReason = recoveryFailureMessage
			? OVERFLOW_RECOVERY_FAILED_STOP_REASON
			: recoveryTracker.isRecovered()
				? normalizeRecoveredOverflowStopReason(state.stopReason)
				: state.stopReason;
		const finalState: SubagentState = externalTerminal
			? {
					...currentDisk,
					finishedAt: currentDisk.finishedAt ?? Date.now(),
					lastUpdate: Date.now(),
					activeTools: [],
					activity: currentDisk.status,
				}
			: explicitAbortReason
				? {
						...state,
						status: "aborted",
						exitCode: -1,
						stopReason,
						errorMessage: explicitAbortReason,
						finishedAt: Date.now(),
						lastUpdate: Date.now(),
						activeTools: [],
						activity: "aborted",
						finalOutput: finalText ?? null,
					}
				: {
						...state,
						status: nonAbortFailureMessage ? "failed" : "done",
						exitCode: nonAbortFailureMessage ? -1 : null,
						stopReason,
						errorMessage: nonAbortFailureMessage,
						finishedAt: Date.now(),
						lastUpdate: Date.now(),
						activeTools: [],
						activity: nonAbortFailureMessage ? "failed" : "done",
						finalOutput: recoveryFailureMessage ? null : (finalText ?? null),
					};

		await flushStream(outputStream);
		await closeOutputStream();
		await writeState(finalState);
		state = finalState;
		hooks.onEnd?.(finalState);
		return finalState;
	};

	const prepareAndResume = async (
		task: string,
		signal: AbortSignal | undefined,
		currentCtx: ExtensionContext,
	): Promise<SubagentState> => {
		if (!session || !services) throw new Error("session not available");
		try {
			throwIfAborted(signal);
			await reconcileRuntimeAuth(currentCtx, services, state.provider, runtimeOverride, signal);
			throwIfAborted(signal);
			const model = services.modelRuntime.getModel(state.provider, state.model);
			if (!model) throw new Error(`Model not available: ${state.provider}/${state.model}`);
			const available = await getAvailableModels(services, state.provider, state.model, signal);
			throwIfAborted(signal);
			if (!available.some((candidate) => candidate.provider === state.provider && candidate.id === state.model)) {
				throw new Error(`Model authentication unavailable: ${state.provider}/${state.model}`);
			}
			await markRunning(task, signal);
			throwIfAborted(signal);
		} catch (error) {
			if (signal?.aborted) return finalizeCancelledResume(task);
			throw error;
		}
		return runPrompt(task, signal);
	};

	let resumeAdmissionReserved = false;
	const resume = (
		task: string,
		signal?: AbortSignal,
		currentCtx: ExtensionContext = env.ctx,
	): Promise<SubagentState> => {
		if (!session || !services) throw new Error("session not available");
		if (resumeAdmissionReserved || state.status === "running" || state.status === "starting") {
			throw new Error(`sub-agent #${agentId} is already running`);
		}
		resumeAdmissionReserved = true;
		return prepareAndResume(task, signal, currentCtx).finally(() => {
			resumeAdmissionReserved = false;
		});
	};

	const dispose = async () => {
		nonUserDisposeRequested = true;
		recoveryTracker.markDisposed();
		unsubscribe();
		session?.abort().catch(() => undefined);
		session?.dispose();
	};

	const donePromise = runPrompt(plan.options.task, env.signal);

	return { agentId, state, donePromise, abort, steer, resume, dispose };
}

async function finalizeCancelledStartup(initialState: SubagentState, hooks: LifecycleHooks): Promise<DispatchHandle> {
	await Promise.all(
		[initialState.paths.prompt, initialState.paths.output, initialState.paths.stderr].map((file) =>
			fs.rm(file, { force: true }).catch(() => undefined),
		),
	);
	const aborted: SubagentState = {
		...initialState,
		status: "aborted",
		exitCode: -1,
		errorMessage: "Interrupted before sub-agent launch.",
		finishedAt: Date.now(),
		lastUpdate: Date.now(),
		activity: "aborted",
	};
	await writeState(aborted);
	hooks.onEnd?.(aborted);
	return { agentId: aborted.agentId, state: aborted, donePromise: Promise.resolve(aborted) };
}

async function getAvailableModels(
	services: AgentSessionServices,
	provider: string,
	modelId: string,
	signal?: AbortSignal,
) {
	try {
		return await services.modelRuntime.getAvailable(provider, { signal });
	} catch {
		throw new Error(`Model authentication unavailable: ${provider}/${modelId}`);
	}
}

interface RuntimeOverrideState {
	installed: boolean;
}

async function reconcileRuntimeAuth(
	parentCtx: ExtensionContext,
	services: AgentSessionServices,
	provider: string,
	override: RuntimeOverrideState,
	signal?: AbortSignal,
): Promise<void> {
	throwIfAborted(signal);
	let source: string | undefined;
	try {
		source = parentCtx.modelRegistry.getProviderAuthStatus(provider).source;
	} catch {
		source = undefined;
	}
	if (source !== "runtime") {
		if (override.installed) {
			try {
				await services.modelRuntime.removeRuntimeApiKey(provider, { signal });
			} catch {
				throw new Error(`Runtime authentication removal failed for ${provider}.`);
			}
			throwIfAborted(signal);
			override.installed = false;
		}
		return;
	}

	let apiKey: string | undefined;
	try {
		apiKey = await parentCtx.modelRegistry.getApiKeyForProvider(provider);
	} catch {
		throw new Error(`Runtime authentication is unavailable for ${provider}.`);
	}
	throwIfAborted(signal);
	if (!apiKey) throw new Error(`Runtime authentication is unavailable for ${provider}.`);
	// The SDK may report synchronization failure after committing the key. Mark the
	// possible mutation before awaiting so a later non-runtime turn always removes it.
	override.installed = true;
	try {
		await services.modelRuntime.setRuntimeApiKey(provider, apiKey, { signal });
	} catch {
		throw new Error(`Runtime authentication reconciliation failed for ${provider}.`);
	}
	throwIfAborted(signal);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new Error("Interrupted before sub-agent launch.");
}

function safeErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Child session initialization failed.";
}

interface EventHandlerContext {
	getState(): SubagentState;
	scheduleWrite(state: SubagentState): void;
	activeTools: Map<string, string>;
	getToolUses(): number;
	setToolUses(value: number): void;
	onSoftLimit(): Promise<void>;
	onHardAbort(): Promise<void>;
	maxTurns: number | undefined;
}

function handleSessionEvent(event: unknown, ctx: EventHandlerContext): void {
	const ev = event as {
		type?: string;
		message?: unknown;
		messages?: unknown[];
		assistantMessageEvent?: unknown;
		toolCallId?: string;
		toolName?: string;
		args?: unknown;
		turnIndex?: number;
	};
	const state = ctx.getState();
	const recoveryActivity = overflowRecoveryActivity(event);
	if (recoveryActivity) {
		ctx.scheduleWrite({ ...state, activity: recoveryActivity, lastUpdate: Date.now() });
		return;
	}
	if (ev.type === "message_update") {
		const update = ev.assistantMessageEvent as { type?: string; partial?: { content?: unknown[] } } | undefined;
		if (update?.type === "text_delta") {
			const text = extractFirstText(update.partial?.content) ?? state.lastText;
			if (text) {
				ctx.scheduleWrite({
					...state,
					lastText: text,
					activity: describeActivity(ctx.activeTools, text),
					lastUpdate: Date.now(),
				});
			}
		}
	} else if (ev.type === "message_end") {
		const msg = ev.message as { role?: string; usage?: unknown; content?: unknown; stopReason?: string } | undefined;
		if (msg?.role === "assistant") {
			const u = msg.usage as Partial<SubagentUsage> | undefined;
			const costTotal: number = (u as { cost?: { total?: number } } | undefined)?.cost?.total ?? 0;
			const text = extractFirstText(msg.content) ?? state.lastText;
			ctx.scheduleWrite({
				...state,
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
				lastText: text,
				activity: describeActivity(ctx.activeTools, text),
				stopReason: msg.stopReason ?? state.stopReason,
				lastUpdate: Date.now(),
			});
		}
	} else if (ev.type === "turn_end") {
		const msg = ev.message as { role?: string; stopReason?: string } | undefined;
		const turns = state.turns + 1;
		ctx.scheduleWrite({ ...state, turns, lastUpdate: Date.now() });
		if (msg?.role === "assistant" && msg.stopReason === "stop") return;
		if (ctx.maxTurns && turns >= ctx.maxTurns + MAX_TURN_GRACE) {
			void ctx.onHardAbort();
		} else if (ctx.maxTurns && turns >= ctx.maxTurns) {
			void ctx.onSoftLimit();
		}
	} else if (ev.type === "tool_execution_start") {
		if (ev.toolName) {
			ctx.activeTools.set(ev.toolCallId ?? `${ev.toolName}-${Date.now()}`, ev.toolName);
			ctx.scheduleWrite({
				...state,
				lastToolCall: { name: ev.toolName, args: (ev.args ?? {}) as Record<string, unknown> },
				activeTools: [...ctx.activeTools.values()],
				toolUses: ctx.getToolUses(),
				activity: describeActivity(ctx.activeTools, state.lastText),
				lastUpdate: Date.now(),
			});
		}
	} else if (ev.type === "tool_execution_end") {
		if (ev.toolCallId) ctx.activeTools.delete(ev.toolCallId);
		else if (ev.toolName) deleteOneTool(ctx.activeTools, ev.toolName);
		const toolUses = ctx.getToolUses() + 1;
		ctx.setToolUses(toolUses);
		ctx.scheduleWrite({
			...state,
			activeTools: [...ctx.activeTools.values()],
			toolUses,
			activity: describeActivity(ctx.activeTools, state.lastText),
			lastUpdate: Date.now(),
		});
	} else if (ev.type === "agent_end") {
		const last = extractLastAssistantText(ev.messages ?? []);
		if (last) ctx.scheduleWrite({ ...state, finalOutput: last, lastUpdate: Date.now() });
	}
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
				if (p?.type === "text" && typeof p.text === "string") return p.text;
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

async function flushStream(stream: fsSync.WriteStream): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		stream.write("", (err) => (err ? reject(err) : resolve()));
	});
}

async function closeStream(stream: fsSync.WriteStream): Promise<void> {
	await new Promise<void>((resolve) => {
		stream.end(() => resolve());
	});
}
