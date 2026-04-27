import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { discoverAgents } from "./agents/discovery.js";
import { registerAgentsCommand } from "./commands/agents.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerInstallDefaultsCommand } from "./commands/install-defaults.js";
import { registerTreeCommand } from "./commands/tree.js";
import { getGlobalConfigPath, loadConfig } from "./config/store.js";
import { createCompletionDispatcher } from "./notify/batcher.js";
import { createEmitter } from "./notify/events.js";
import { registerNotificationRenderer } from "./notify/renderer.js";
import { createApprovalGate } from "./runtime/approval.js";
import { createBatchTracker } from "./runtime/batch.js";
import { createActiveCounter, createPoolLimiter } from "./runtime/concurrency.js";
import { abortSubagentByStatePath } from "./runtime/kill.js";
import type { DispatchHandle, LifecycleEnv, LifecycleHooks } from "./runtime/lifecycle.js";
import { createParentAbortTracker } from "./runtime/parent-abort.js";
import { killTmuxWindow, launchTmuxView } from "./runtime/tmux.js";
import type { ExtensionRuntime } from "./runtime/types.js";
import { listStates, readState, writeState } from "./state/store.js";
import { sweep } from "./state/sweep.js";
import { buildSystemPromptBlock } from "./system-prompt.js";
import { registerAgentTool } from "./tools/agent.js";
import { registerDispatchTool } from "./tools/dispatch.js";
import { registerKillTool } from "./tools/kill.js";
import { registerGetSubagentResultTool } from "./tools/result.js";
import { registerRunTool } from "./tools/run.js";
import { registerStatusTool } from "./tools/status.js";
import { registerSteerTool } from "./tools/steer.js";
import type { PiCrewConfig } from "./types.js";
import { type FooterController, mountFooter } from "./ui/footer.js";
import { type InterruptController, mountInterruptHandler } from "./ui/interrupt.js";
import { type WatcherHandle, mountStateWatcher } from "./ui/state-watcher.js";
import { type WidgetController, mountWidget } from "./ui/widget.js";

const __filename = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(__filename), "..");
const BUNDLED_AGENTS_DIR = path.join(PACKAGE_ROOT, "src", "agents", "defaults");

export default function (pi: ExtensionAPI) {
	const agentDir = getAgentDir();
	const userAgentsDir = path.join(agentDir, "agents");
	const handles = new Map<string, DispatchHandle>();
	const startedAgents = new Set<string>();
	const emitter = createEmitter(pi);
	const dispatcher = createCompletionDispatcher(pi);
	const batches = createBatchTracker();

	let cachedConfig: PiCrewConfig | null = null;
	let applyLoadedConfig: (config: PiCrewConfig) => void = () => undefined;
	const getConfig = async (): Promise<PiCrewConfig> => {
		const r = await loadConfig(getGlobalConfigPath(agentDir));
		cachedConfig = r.config;
		applyLoadedConfig(cachedConfig);
		return cachedConfig;
	};

	let cachedEphemeralId: string | null = null;
	const ephemeralSessionId = (): string => {
		if (!cachedEphemeralId) cachedEphemeralId = `ephemeral-${Date.now()}`;
		return cachedEphemeralId;
	};

	const resolveSessionId = (ctx: ExtensionContext): string => {
		const sessionFile = ctx.sessionManager.getSessionFile();
		return sessionFile ? path.basename(sessionFile, ".jsonl") : ephemeralSessionId();
	};

	const approvalGate = createApprovalGate({
		isConfirmEnabled: async () => (await getConfig()).global.confirmProjectAgents,
	});
	const parentAbortTracker = createParentAbortTracker();

	// Concurrency primitives — initialised with defaults, updated via setMax once config loads.
	// Using setMax avoids swapping instances, which would invalidate references held by in-flight tools.
	const pool = createPoolLimiter(4);
	const activeCounter = createActiveCounter(16);

	applyLoadedConfig = (c) => {
		pool.setMax(c.global.maxConcurrent);
		activeCounter.setMax(c.global.maxActive);
	};
	void getConfig();

	const rt: ExtensionRuntime = {
		userAgentsDir,
		bundledAgentsDir: BUNDLED_AGENTS_DIR,
		agentDir,
		envFor(ctx: ExtensionContext): LifecycleEnv {
			const sessionId = resolveSessionId(ctx);
			return {
				agentDir,
				cwd: ctx.cwd,
				sessionId,
				batchId: batches.beginDispatch(sessionId),
				parentAgentId: process.env.PI_SUBAGENT_PARENT_ID ?? null,
				executionMode: cachedConfig?.global.executionMode ?? "session",
				ctx,
			};
		},
		lifecycleHooks(): LifecycleHooks {
			return {
				onStateUpdate: (state) => {
					if (state.status === "starting") {
						emitter.dispatch({
							agentId: state.agentId,
							parentAgentId: state.parentAgentId,
							agent: state.agent,
							alias: state.alias,
							task: state.task,
							cwd: state.cwd,
							model: state.model,
							provider: state.provider,
							sessionId: state.sessionId,
						});
					} else if (state.status === "running" && !startedAgents.has(state.agentId)) {
						startedAgents.add(state.agentId);
						if (state.pid !== null) emitter.start({ agentId: state.agentId, pid: state.pid });
						void getConfig().then((c) => {
							launchTmuxView(state, c.tmux, PACKAGE_ROOT);
						});
					}
				},
				onEnd: (state) => {
					emitter.end({
						agentId: state.agentId,
						status: state.status,
						exitCode: state.exitCode,
						stopReason: state.stopReason,
						finalOutput: state.finalOutput,
						usage: state.usage,
						errorMessage: state.errorMessage,
					});
					void getConfig().then((c) => {
						if (c.global.notifyOnCompletion) dispatcher.push(state);
						if (c.tmux.killOnComplete === "after-grace") {
							setTimeout(() => {
								killTmuxWindow(state, c.tmux);
							}, c.tmux.graceSeconds * 1000);
						}
					});
				},
			};
		},
		trackHandle: (h) => {
			handles.set(h.agentId, h);
			void h.donePromise.finally(() => {
				// Keep session-mode handles with resume/steer support until session shutdown.
				// Subprocess handles cannot be resumed and can be dropped once terminal.
				if (!h.resume && !h.steer) handles.delete(h.agentId);
			});
		},
		trackParentAbort: (signal, handle) => parentAbortTracker.track(signal, handle),
		abortActiveHandle: async (agentId, reason) => {
			const handle = handles.get(agentId);
			if (!handle?.abort) return false;
			await handle.abort(reason);
			return true;
		},
		steerHandle: async (agentId, message) => {
			const handle = handles.get(agentId);
			if (!handle) return "not_found";
			if (!handle.steer) return "unsupported";
			await handle.steer(message);
			return "ok";
		},
		resumeHandle: async (agentId, task, signal) => {
			const handle = handles.get(agentId);
			if (!handle?.resume) return null;
			const resumePromise = handle.resume(task, signal);
			const resumedHandle: DispatchHandle = { ...handle, donePromise: resumePromise };
			handles.set(agentId, resumedHandle);
			parentAbortTracker.track(signal, resumedHandle);
			return resumePromise;
		},
		consumeCompletion: (agentId) => dispatcher.consume(agentId),
		completionHandled: (agentId) => dispatcher.wasHandled(agentId),
		getCurrentBatchId: (ctx) => batches.currentBatchId(resolveSessionId(ctx)),
		getConfig,
		resolveSessionId,
		ensureProjectAgentApproved: async (args) =>
			approvalGate({
				agentName: args.agentName,
				agentSource: args.agentSource,
				hasUI: args.ctx.hasUI,
				confirm: (title, message) => args.ctx.ui.confirm(title, message),
			}),
		concurrency: {
			pool,
			active: activeCounter,
		},
	};

	registerNotificationRenderer(pi);

	registerAgentTool(pi, rt);
	registerDispatchTool(pi, rt);
	registerRunTool(pi, rt);
	registerStatusTool(pi, rt);
	registerGetSubagentResultTool(pi, rt);
	registerSteerTool(pi, rt);
	registerKillTool(pi, rt);

	pi.on("message_start", (event, ctx) => {
		if ((event.message as { role?: string }).role === "user") batches.noteUserMessage(resolveSessionId(ctx));
	});

	pi.on("turn_start", (event, ctx) => {
		batches.noteTurn(resolveSessionId(ctx), event.turnIndex);
	});

	let widget: WidgetController | null = null;
	let footer: FooterController | null = null;
	let interrupt: InterruptController | null = null;
	let watcher: WatcherHandle | null = null;

	registerConfigCommand(pi, rt);
	registerInstallDefaultsCommand(pi, rt);
	registerAgentsCommand(pi, rt);
	registerTreeCommand(pi, rt);

	pi.on("session_start", async (_event, ctx) => {
		const config = await getConfig();
		await sweep({ agentDir, retentionDays: config.global.retentionDays }).catch(() => undefined);
		const sessionId = rt.resolveSessionId(ctx);
		const sessionDir = path.join(agentDir, "subagents", sessionId);
		widget = mountWidget(ctx);
		footer = mountFooter(ctx);
		interrupt = mountInterruptHandler({
			ctx,
			getBatchId: () => rt.getCurrentBatchId(ctx),
			loadStates: () => listStates(sessionDir, { includeDetached: true }),
			abortStates: async (states, reason) => {
				await Promise.all(
					states.map(async (state) => {
						const handled = await rt.abortActiveHandle(state.agentId, reason);
						const result = handled ? null : await abortSubagentByStatePath(state.paths.state, reason);
						emitter.killed({ agentId: state.agentId, reason, killed: handled || result?.ok === true });
					}),
				);
			},
		});
		watcher = mountStateWatcher({
			sessionDir,
			onChange: (states) => {
				widget?.update(states);
				footer?.update(states);
				interrupt?.update(states);
			},
		});
	});

	pi.on("session_shutdown", async () => {
		// Subprocess agents can keep running as detached work. In-process session agents cannot
		// survive shutdown/reload cleanly, so abort them instead of leaving hidden work behind.
		for (const h of handles.values()) {
			try {
				const current = await readState(h.state.paths.state);
				if (current && (current.status === "running" || current.status === "starting")) {
					if (h.abort) {
						await h.abort("parent session shutdown");
					} else {
						const detached = { ...current, status: "detached" as const, lastUpdate: Date.now() };
						await writeState(detached);
						emitter.detached({ agentId: current.agentId });
					}
				}
				await h.dispose?.();
			} catch {
				// best effort
			}
		}
		handles.clear();
		parentAbortTracker.clear();
		startedAgents.clear();
		// Reset cached ephemeral id so next session_start gets a fresh one.
		cachedEphemeralId = null;
		// Reset project-agent approvals so each new session re-prompts.
		approvalGate.reset();
		try {
			dispatcher.flush();
		} catch {
			// best effort — session may already be gone
		}
		watcher?.stop();
		widget?.stop();
		footer?.stop();
		interrupt?.stop();
		watcher = null;
		widget = null;
		footer = null;
		interrupt = null;
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const config = await getConfig();
		const discovered = discoverAgents({
			cwd: ctx.cwd,
			scope: config.global.agentScope,
			userAgentsDir,
			bundledDir: BUNDLED_AGENTS_DIR,
		});
		const configuredSlots = new Set(Object.keys(config.agents));
		configuredSlots.add("general-purpose");
		const availableModels = safeAvailableModels(ctx);
		const block = buildSystemPromptBlock({
			agents: discovered.agents.map((a) => ({
				name: a.name,
				description: a.description,
				source: a.source,
			})),
			configuredSlots,
			stateDirRoot: path.join(agentDir, "subagents"),
			models: availableModels.map((model) => ({
				provider: model.provider,
				id: model.id,
				name: model.name,
				reasoning: model.reasoning,
			})),
			currentModel: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : null,
		});
		return {
			systemPrompt: `${event.systemPrompt}\n\n${block}`,
		};
	});
}

function safeAvailableModels(ctx: ExtensionContext) {
	try {
		return ctx.modelRegistry.getAvailable();
	} catch {
		return [];
	}
}

// Programmatic API re-exports
export { dispatch as dispatchSubagent } from "./runtime/lifecycle.js";
export { readState as getSubagentState, listStates as listSubagentStates } from "./state/store.js";
export type { LifecycleEnv, LifecycleHooks, DispatchPlan, DispatchHandle } from "./runtime/lifecycle.js";
export type { AgentDiscoveryResult, AgentScope, DiscoverArgs } from "./agents/discovery.js";
export type {
	AgentConfig,
	AgentSlot,
	GlobalSettings,
	PiCrewConfig,
	PiCrewConfigChangedEvent,
	PiCrewDetachedEvent,
	PiCrewDispatchEvent,
	PiCrewEndEvent,
	PiCrewKilledEvent,
	PiCrewOrphanedEvent,
	PiCrewStartEvent,
	SubagentState,
	SubagentStatus,
	SubagentUsage,
	TmuxSettings,
} from "./types.js";
