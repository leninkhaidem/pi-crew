// src/runtime/types.ts
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { PiCrewConfig } from "../types.js";
import type { DispatchHandle, LifecycleEnv, LifecycleHooks } from "./lifecycle.js";

export interface ExtensionRuntime {
	userAgentsDir: string;
	bundledAgentsDir: string;
	agentDir: string;
	envFor(ctx: ExtensionContext): LifecycleEnv;
	lifecycleHooks(): LifecycleHooks;
	trackHandle(handle: DispatchHandle): void;
	getConfig(): Promise<PiCrewConfig>;
}
