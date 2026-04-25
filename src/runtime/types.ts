// src/runtime/types.ts
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { PiCrewConfig, SubagentState } from "../types.js";
import type { ActiveCounter, PoolLimiter } from "./concurrency.js";
import type { DispatchHandle, LifecycleEnv, LifecycleHooks } from "./lifecycle.js";

export interface ExtensionRuntime {
	userAgentsDir: string;
	bundledAgentsDir: string;
	agentDir: string;
	envFor(ctx: ExtensionContext): LifecycleEnv;
	lifecycleHooks(): LifecycleHooks;
	trackHandle(handle: DispatchHandle): void;
	trackParentAbort(signal: AbortSignal | undefined, handle: DispatchHandle): void;
	abortActiveHandle(agentId: string, reason?: string): Promise<boolean>;
	steerHandle(agentId: string, message: string): Promise<"ok" | "not_found" | "unsupported">;
	resumeHandle(agentId: string, task: string, signal?: AbortSignal): Promise<SubagentState | null>;
	consumeCompletion(agentId: string): void;
	getCurrentBatchId(ctx: ExtensionContext): string | null;
	getConfig(): Promise<PiCrewConfig>;
	concurrency: {
		pool: PoolLimiter;
		active: ActiveCounter;
	};
	/** Resolve the current session id consistently across tools/commands/UI. */
	resolveSessionId(ctx: ExtensionContext): string;
	/**
	 * Confirm a project-scoped agent before dispatch. Returns true if approved
	 * (already confirmed this session, or just confirmed via UI prompt, or
	 * `confirmProjectAgents: false`). Returns false if user declined.
	 */
	ensureProjectAgentApproved(args: {
		agentName: string;
		agentSource: "user" | "project" | "bundled";
		ctx: ExtensionContext;
	}): Promise<boolean>;
}
