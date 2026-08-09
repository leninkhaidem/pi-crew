import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "./types.js";

export interface ScopedModelEntry {
	model: Model<Api>;
	thinkingLevel?: ThinkingLevel;
}

export interface ModelScopeSnapshot {
	restricted: boolean;
	entries: ScopedModelEntry[];
}

/** Read and validate the current context scope without caching or normalizing identities. */
export function modelScopeSnapshot(ctx: Pick<ExtensionContext, "scopedModels">): ModelScopeSnapshot {
	const raw: unknown = ctx.scopedModels;
	if (raw === undefined || (Array.isArray(raw) && raw.length === 0)) return { restricted: false, entries: [] };
	if (!Array.isArray(raw)) return { restricted: true, entries: [] };
	return { restricted: true, entries: raw.filter(isScopedModelEntry) };
}

export function isModelInScope(scope: ModelScopeSnapshot, provider: string, modelId: string): boolean {
	return (
		!scope.restricted || scope.entries.some((entry) => entry.model.provider === provider && entry.model.id === modelId)
	);
}

export function scopedThinkingLevel(
	scope: ModelScopeSnapshot,
	provider: string,
	modelId: string,
): ThinkingLevel | undefined {
	return scope.entries.find((entry) => entry.model.provider === provider && entry.model.id === modelId)?.thinkingLevel;
}

export function modelOutOfScopeMessage(provider: string, modelId: string): string {
	return `Model ${provider}/${modelId} is outside the current session model scope. Choose an available scoped model or update the parent session scope.`;
}

function isScopedModelEntry(value: unknown): value is ScopedModelEntry {
	if (!value || typeof value !== "object") return false;
	const entry = value as { model?: unknown; thinkingLevel?: unknown };
	if (!entry.model || typeof entry.model !== "object") return false;
	const model = entry.model as { provider?: unknown; id?: unknown };
	if (typeof model.provider !== "string" || typeof model.id !== "string") return false;
	return entry.thinkingLevel === undefined || isThinkingLevel(entry.thinkingLevel);
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(String(value));
}
