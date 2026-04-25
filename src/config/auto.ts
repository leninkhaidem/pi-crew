import type { Api, Model } from "@mariozechner/pi-ai";
import { type PiCrewConfig, defaultThinkingForAgent } from "../types.js";
import { emptyConfig } from "./schema.js";

const AGENTS = ["explore"] as const;

function pickCheapestNonReasoning(models: Model<Api>[]): Model<Api> | null {
	const candidates = models.filter((m) => !m.reasoning);
	if (candidates.length === 0) return null;
	candidates.sort((a, b) => a.cost.input - b.cost.input);
	return candidates[0] ?? null;
}

export function suggestDefaults(models: Model<Api>[]): PiCrewConfig {
	const cfg = emptyConfig();
	if (models.length === 0) return cfg;

	const explore = pickCheapestNonReasoning(models) ?? models[0] ?? null;

	const set = (slot: string, m: Model<Api> | null) => {
		if (!m) return;
		cfg.agents[slot] = { provider: m.provider, modelId: m.id, thinking: defaultThinkingForAgent(slot) };
	};
	set("explore", explore);
	return cfg;
}

export const AGENT_SLOT_NAMES = AGENTS;
