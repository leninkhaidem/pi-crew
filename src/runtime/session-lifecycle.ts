import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
	DefaultResourceLoader,
	type ExtensionContext,
	SessionManager,
	SettingsManager,
	createAgentSession,
} from "@mariozechner/pi-coding-agent";
import { generateAgentId } from "../state/id.js";
import { computePaths } from "../state/paths.js";
import { readState, writeState } from "../state/store.js";
import { type SubagentState, type SubagentUsage, defaultThinkingForAgent } from "../types.js";
import { describeActivity } from "./activity.js";
import { abortSubagentByStatePath } from "./kill.js";
import type { DispatchHandle, DispatchPlan, LifecycleEnv, LifecycleHooks } from "./lifecycle.js";

const STATE_DEBOUNCE_MS = 80;
const MAX_TURN_GRACE = 2;
const EXCLUDED_TOOL_NAMES = new Set([
	"subagent_dispatch",
	"subagent_run",
	"subagent_wait",
	"subagent_status",
	"subagent_kill",
]);

export async function dispatchSession(
	plan: DispatchPlan,
	env: LifecycleEnv & { ctx: ExtensionContext },
	hooks: LifecycleHooks = {},
): Promise<DispatchHandle> {
	const agentId = generateAgentId();
	const sessionIdResolved = env.sessionId;
	const paths = computePaths({ agentDir: env.agentDir, sessionId: sessionIdResolved, agentId });
	const cwd = plan.options.cwd ?? env.cwd;
	const thinking = plan.model.thinking ?? defaultThinkingForAgent(plan.agent.name);

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
		thinking,
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

	await fs.mkdir(path.dirname(paths.state), { recursive: true });
	await fs.writeFile(paths.prompt, plan.agent.systemPrompt, { mode: 0o600 });
	await fs.writeFile(paths.output, "", { mode: 0o600 });
	await fs.writeFile(paths.stderr, "", { mode: 0o600 });
	await writeState(initialState);
	hooks.onStateUpdate?.(initialState);

	const outputStream = fsSync.createWriteStream(paths.output, { flags: "a", mode: 0o600 });
	const appendEvent = (event: unknown) => {
		try {
			outputStream.write(`${JSON.stringify(event)}\n`);
		} catch {
			// best effort transcript
		}
	};

	const model = env.ctx.modelRegistry.find(plan.model.provider, plan.model.modelId);
	if (!model) {
		const failed: SubagentState = {
			...initialState,
			status: "failed",
			errorMessage: `Model not available: ${plan.model.provider}/${plan.model.modelId}`,
			finishedAt: Date.now(),
			lastUpdate: Date.now(),
			activity: "failed",
		};
		await writeState(failed);
		await closeStream(outputStream);
		hooks.onEnd?.(failed);
		return { agentId, state: failed, donePromise: Promise.resolve(failed) };
	}

	let state: SubagentState = { ...initialState };
	let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | null = null;
	let unsubscribe: () => void = () => undefined;
	let pendingUpdate: SubagentState | null = null;
	let writeTimer: NodeJS.Timeout | null = null;
	let closing = false;
	let abortReason: string | undefined;
	let hardAborted = false;
	let softLimitReached = false;
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
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir: env.agentDir,
			settingsManager: SettingsManager.create(cwd, env.agentDir),
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			systemPromptOverride: () => plan.agent.systemPrompt,
			appendSystemPromptOverride: () => [],
		});
		await loader.reload();
		const sessionOptions: Parameters<typeof createAgentSession>[0] = {
			cwd,
			agentDir: env.agentDir,
			modelRegistry: env.ctx.modelRegistry,
			model,
			thinkingLevel: thinking,
			resourceLoader: loader,
			sessionManager: SessionManager.inMemory(cwd),
			settingsManager: SettingsManager.create(cwd, env.agentDir),
		};
		if (plan.agent.tools) sessionOptions.tools = plan.agent.tools;
		const created = await createAgentSession(sessionOptions);
		session = created.session;
		session.setActiveToolsByName(session.getActiveToolNames().filter((name) => !EXCLUDED_TOOL_NAMES.has(name)));
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await fs.appendFile(paths.stderr, `${message}\n`).catch(() => undefined);
		const failed: SubagentState = {
			...initialState,
			status: "failed",
			errorMessage: message,
			finishedAt: Date.now(),
			lastUpdate: Date.now(),
			activity: "failed",
		};
		await writeState(failed);
		await closeStream(outputStream);
		hooks.onEnd?.(failed);
		return { agentId, state: failed, donePromise: Promise.resolve(failed) };
	}

	state = {
		...initialState,
		status: "running",
		lastUpdate: Date.now(),
		activity: "thinking…",
	};
	await writeState(state);
	hooks.onStateUpdate?.(state);

	unsubscribe = session.subscribe((event: unknown) => {
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
				await abortSubagentByStatePath(paths.state, abortReason).catch(() => undefined);
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

	const abort = async (reason = "killed by user") => {
		abortReason = reason;
		await abortSubagentByStatePath(paths.state, reason).catch(() => undefined);
		await session?.abort().catch(() => undefined);
	};

	const donePromise = (async (): Promise<SubagentState> => {
		let promptError: unknown;
		try {
			await session?.prompt(`Task: ${plan.options.task}`, { source: "extension" });
		} catch (err) {
			promptError = err;
		} finally {
			closing = true;
			pendingUpdate = null;
			if (writeTimer) {
				clearTimeout(writeTimer);
				writeTimer = null;
			}
			unsubscribe();
		}

		const currentDisk = await readState(paths.state);
		const finalText =
			state.finalOutput ?? extractLastAssistantText((session?.messages ?? []) as unknown[]) ?? state.lastText;
		const promptErrorMessage =
			promptError instanceof Error ? promptError.message : promptError ? String(promptError) : null;
		const externalTerminal =
			currentDisk &&
			(currentDisk.status === "aborted" || currentDisk.status === "orphaned" || currentDisk.status === "detached");
		const finalState: SubagentState = externalTerminal
			? {
					...currentDisk,
					finishedAt: currentDisk.finishedAt ?? Date.now(),
					lastUpdate: Date.now(),
					activeTools: [],
					activity: currentDisk.status,
				}
			: {
					...state,
					status: promptErrorMessage || hardAborted || abortReason ? "failed" : "done",
					exitCode: promptErrorMessage || hardAborted || abortReason ? -1 : null,
					errorMessage: promptErrorMessage ?? abortReason ?? null,
					finishedAt: Date.now(),
					lastUpdate: Date.now(),
					activeTools: [],
					activity: promptErrorMessage || hardAborted || abortReason ? "failed" : "done",
					finalOutput: finalText ?? null,
				};

		await writeState(finalState);
		await closeStream(outputStream);
		session?.dispose();
		hooks.onEnd?.(finalState);
		return finalState;
	})();

	return { agentId, state, donePromise, abort };
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
		const turns = state.turns + 1;
		ctx.scheduleWrite({ ...state, turns, lastUpdate: Date.now() });
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

async function closeStream(stream: fsSync.WriteStream): Promise<void> {
	await new Promise<void>((resolve) => {
		stream.end(() => resolve());
	});
}
