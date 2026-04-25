import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { discoverAgents } from "./agents/discovery.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerInstallDefaultsCommand } from "./commands/install-defaults.js";
import { registerTreeCommand } from "./commands/tree.js";
import { getGlobalConfigPath, loadConfig } from "./config/store.js";
import { createCompletionDispatcher } from "./notify/batcher.js";
import { createEmitter } from "./notify/events.js";
import { createApprovalGate } from "./runtime/approval.js";
import { createActiveCounter, createPoolLimiter } from "./runtime/concurrency.js";
import type { ActiveCounter, PoolLimiter } from "./runtime/concurrency.js";
import type { DispatchHandle, LifecycleEnv, LifecycleHooks } from "./runtime/lifecycle.js";
import { killTmuxWindow, launchTmuxView } from "./runtime/tmux.js";
import type { ExtensionRuntime } from "./runtime/types.js";
import { readState, writeState } from "./state/store.js";
import { sweep } from "./state/sweep.js";
import { buildSystemPromptBlock } from "./system-prompt.js";
import { registerDispatchTool } from "./tools/dispatch.js";
import { registerKillTool } from "./tools/kill.js";
import { registerRunTool } from "./tools/run.js";
import { registerStatusTool } from "./tools/status.js";
import { registerWaitTool } from "./tools/wait.js";
import type { PiCrewConfig } from "./types.js";
import { type FooterController, mountFooter } from "./ui/footer.js";
import { type WatcherHandle, mountStateWatcher } from "./ui/state-watcher.js";
import { type WidgetController, mountWidget } from "./ui/widget.js";

const __filename = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(__filename), "..");
const BUNDLED_AGENTS_DIR = path.join(PACKAGE_ROOT, "src", "agents", "defaults");

export default function (pi: ExtensionAPI) {
	const agentDir = getAgentDir();
	const userAgentsDir = path.join(agentDir, "agents");
	const handles = new Set<DispatchHandle>();
	const emitter = createEmitter(pi);
	const dispatcher = createCompletionDispatcher(pi);

	let cachedConfig: PiCrewConfig | null = null;
	const getConfig = async (): Promise<PiCrewConfig> => {
		if (cachedConfig) return cachedConfig;
		const r = await loadConfig(getGlobalConfigPath(agentDir));
		cachedConfig = r.config;
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

	// Concurrency primitives — initialised with defaults, refreshed once config loads.
	// Indirection via wrapper objects lets us swap underlying instances after the async
	// config load without invalidating references held by tools.
	let pool = createPoolLimiter(4);
	let activeCounter = createActiveCounter(16);

	void getConfig().then((c) => {
		pool = createPoolLimiter(c.global.maxConcurrent);
		activeCounter = createActiveCounter(c.global.maxActive);
	});

	const poolProxy: PoolLimiter = {
		run: (fn) => pool.run(fn),
	};
	const activeProxy: ActiveCounter = {
		tryAcquire: () => activeCounter.tryAcquire(),
		release: () => activeCounter.release(),
		current: () => activeCounter.current(),
	};

	const rt: ExtensionRuntime = {
		userAgentsDir,
		bundledAgentsDir: BUNDLED_AGENTS_DIR,
		agentDir,
		envFor(ctx: ExtensionContext): LifecycleEnv {
			return {
				agentDir,
				cwd: ctx.cwd,
				sessionId: resolveSessionId(ctx),
				parentAgentId: process.env.PI_SUBAGENT_PARENT_ID ?? null,
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
							task: state.task,
							cwd: state.cwd,
							model: state.model,
							provider: state.provider,
							sessionId: state.sessionId,
						});
					} else if (state.status === "running" && state.pid !== null) {
						emitter.start({ agentId: state.agentId, pid: state.pid });
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
			handles.add(h);
			void h.donePromise.finally(() => handles.delete(h));
		},
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
			pool: poolProxy,
			active: activeProxy,
		},
	};

	registerDispatchTool(pi, rt);
	registerRunTool(pi, rt);
	registerStatusTool(pi, rt);
	registerWaitTool(pi, rt);
	registerKillTool(pi, rt);
	registerConfigCommand(pi, rt);
	registerInstallDefaultsCommand(pi, rt);
	registerTreeCommand(pi, rt);

	let widget: WidgetController | null = null;
	let footer: FooterController | null = null;
	let watcher: WatcherHandle | null = null;

	pi.on("session_start", async (_event, ctx) => {
		const config = await getConfig();
		await sweep({ agentDir, retentionDays: config.global.retentionDays }).catch(() => undefined);
		const sessionId = rt.resolveSessionId(ctx);
		const sessionDir = path.join(agentDir, "subagents", sessionId);
		widget = mountWidget(ctx);
		footer = mountFooter(ctx);
		watcher = mountStateWatcher({
			sessionDir,
			onChange: (states) => {
				widget?.update(states);
				footer?.update(states);
			},
		});
	});

	pi.on("session_shutdown", async () => {
		// Mark running sub-agents as detached.
		for (const h of handles) {
			try {
				const current = await readState(h.state.paths.state);
				if (current && (current.status === "running" || current.status === "starting")) {
					const detached = { ...current, status: "detached" as const, lastUpdate: Date.now() };
					await writeState(detached);
					emitter.detached({ agentId: current.agentId });
				}
			} catch {
				// best effort
			}
		}
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
		watcher = null;
		widget = null;
		footer = null;
	});

	pi.on("before_agent_start", async (event, _ctx) => {
		const config = await getConfig();
		const discovered = discoverAgents({
			cwd: process.cwd(),
			scope: config.global.agentScope,
			userAgentsDir,
			bundledDir: BUNDLED_AGENTS_DIR,
		});
		const block = buildSystemPromptBlock({
			agents: discovered.agents.map((a) => ({
				name: a.name,
				description: a.description,
				source: a.source,
			})),
			configuredSlots: new Set(Object.keys(config.agents)),
			stateDirRoot: path.join(agentDir, "subagents"),
		});
		return {
			systemPrompt: `${event.systemPrompt}\n\n${block}`,
		};
	});
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
