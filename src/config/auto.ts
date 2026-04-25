import type { Api, Model } from "@mariozechner/pi-ai";
import type { PiCrewConfig } from "../types.js";
import { emptyConfig } from "./schema.js";

const AGENTS = ["general-purpose", "explore", "plan", "code-reviewer"] as const;

function pickCheapestNonReasoning(models: Model<Api>[]): Model<Api> | null {
	const candidates = models.filter((m) => !m.reasoning);
	if (candidates.length === 0) return null;
	candidates.sort((a, b) => a.cost.input - b.cost.input);
	return candidates[0] ?? null;
}

function pickMostCapableReasoning(models: Model<Api>[]): Model<Api> | null {
	const candidates = models.filter((m) => m.reasoning);
	if (candidates.length === 0) return models[0] ?? null;
	// "Most capable" approximated by highest input cost (proxy for capability tier).
	candidates.sort((a, b) => b.cost.input - a.cost.input);
	return candidates[0] ?? null;
}

function pickGeneralPurpose(models: Model<Api>[]): Model<Api> | null {
	const sonnetLike = models.find((m) => m.reasoning && m.id.toLowerCase().includes("sonnet"));
	if (sonnetLike) return sonnetLike;
	return pickMostCapableReasoning(models);
}

export function suggestDefaults(models: Model<Api>[]): PiCrewConfig {
	const cfg = emptyConfig();
	if (models.length === 0) return cfg;

	const explore = pickCheapestNonReasoning(models) ?? models[0];
	const plan = pickMostCapableReasoning(models);
	const reviewer = pickMostCapableReasoning(models);
	const gp = pickGeneralPurpose(models);

	const set = (slot: string, m: Model<Api> | null) => {
		if (!m) return;
		cfg.agents[slot] = { provider: m.provider, modelId: m.id };
	};
	set("explore", explore);
	set("plan", plan);
	set("code-reviewer", reviewer);
	set("general-purpose", gp);
	return cfg;
}

export const AGENT_SLOT_NAMES = AGENTS;
