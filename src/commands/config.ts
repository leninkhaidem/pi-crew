// src/commands/config.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { suggestDefaults } from "../config/auto.js";
import { getGlobalConfigPath, loadConfig } from "../config/store.js";
import { runConfigTui } from "../config/tui.js";
import { modelScopeSnapshot } from "../model-scope.js";
import type { ExtensionRuntime } from "../runtime/types.js";

export function registerConfigCommand(pi: ExtensionAPI, rt: ExtensionRuntime): void {
	pi.registerCommand("subagent-config", {
		description: "Configure pi-crew agent slots (model picker per agent).",
		handler: async (_args, ctx) => {
			const configPath = getGlobalConfigPath(rt.agentDir);
			const loaded = await loadConfig(configPath);
			const scope = modelScopeSnapshot(ctx);
			const models = scope.restricted ? scope.entries.map((entry) => entry.model) : ctx.modelRegistry.getAvailable();
			const current = Object.keys(loaded.config.agents).length === 0 ? suggestDefaults(models) : loaded.config;
			await runConfigTui(ctx, {
				configPath,
				currentConfig: current,
				availableModels: models,
				scopedThinkingLevels: scope.entries.flatMap((entry) =>
					entry.thinkingLevel
						? [{ provider: entry.model.provider, modelId: entry.model.id, thinkingLevel: entry.thinkingLevel }]
						: [],
				),
			});
		},
	});
}
