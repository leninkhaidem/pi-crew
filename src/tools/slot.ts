import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isModelInScope, modelOutOfScopeMessage, modelScopeSnapshot, scopedThinkingLevel } from "../model-scope.js";
import { resolveThinkingLevel } from "../thinking.js";
import {
	type AgentSlot,
	type PiCrewConfig,
	type ThinkingAdjustment,
	type ThinkingLevel,
	defaultThinkingForAgent,
	isInheritedAgentSlot,
} from "../types.js";

export interface SlotOverrides {
	provider?: string;
	model?: string;
	thinking?: ThinkingLevel;
}

export type SlotResolution =
	| { ok: true; slot: AgentSlot; inherited: boolean; thinkingAdjustment?: ThinkingAdjustment }
	| {
			ok: false;
			message: string;
			error:
				| "no_parent_model"
				| "provider_required"
				| "model_required"
				| "model_out_of_scope"
				| "model_not_found"
				| "no_supported_thinking_level";
			provider?: string;
			model?: string;
	  };

/** Resolve a canonical model and thinking level against the current uncached session policy. */
export function resolveAgentSlot(
	agentName: string,
	config: PiCrewConfig,
	ctx: ExtensionContext,
	pi: ExtensionAPI,
	overrides: SlotOverrides = {},
): SlotResolution {
	const configured = config.agents[agentName];
	const inherited = isInheritedAgentSlot(configured) || configured === undefined;
	const concrete = configured && !isInheritedAgentSlot(configured) ? configured : undefined;
	const provider = overrides.provider ?? concrete?.provider ?? ctx.model?.provider;
	const modelId = overrides.model ?? concrete?.modelId ?? ctx.model?.id;
	if (!provider) {
		return overrides.model
			? {
					ok: false,
					error: "provider_required",
					message: `Provider required for agent "${agentName}" when overriding model without an inferable provider. Pass provider explicitly.`,
				}
			: {
					ok: false,
					error: "no_parent_model",
					message: `${agentName} needs a current parent model to inherit. Select a model in the parent session first.`,
				};
	}
	if (!modelId) {
		return overrides.provider
			? {
					ok: false,
					error: "model_required",
					message: `Model required for agent "${agentName}" when overriding provider without an inferable model. Pass model explicitly.`,
				}
			: {
					ok: false,
					error: "no_parent_model",
					message: `${agentName} needs a current parent model to inherit. Select a model in the parent session first.`,
				};
	}

	const scope = modelScopeSnapshot(ctx);
	if (!isModelInScope(scope, provider, modelId)) {
		return {
			ok: false,
			error: "model_out_of_scope",
			provider,
			model: modelId,
			message: modelOutOfScopeMessage(provider, modelId),
		};
	}
	const model = findAvailableModel(ctx, provider, modelId);
	if (!model) return modelNotFound(provider, modelId);

	const configuredThinking =
		concrete && Object.prototype.hasOwnProperty.call(concrete, "thinking") ? concrete.thinking : undefined;
	const requested =
		overrides.thinking ??
		configuredThinking ??
		scopedThinkingLevel(scope, provider, modelId) ??
		(inherited ? safeThinking(pi) : undefined) ??
		defaultThinkingForAgent(agentName);
	const capability = resolveThinkingLevel(model, requested);
	if (!capability.ok) {
		return {
			ok: false,
			error: capability.error,
			message: `Model ${provider}/${modelId} supports no thinking level at or below "max". Choose another model or thinking level.`,
		};
	}
	return {
		ok: true,
		slot: { provider, modelId, thinking: capability.effective },
		inherited,
		...(capability.adjustment ? { thinkingAdjustment: capability.adjustment } : {}),
	};
}

function findAvailableModel(ctx: ExtensionContext, provider: string, modelId: string) {
	try {
		const registry = ctx.modelRegistry;
		if (typeof registry.getAvailable === "function") {
			return registry.getAvailable().find((model) => model.provider === provider && model.id === modelId);
		}
		return registry.find(provider, modelId);
	} catch {
		return undefined;
	}
}

function modelNotFound(provider: string, modelId: string): Extract<SlotResolution, { ok: false }> {
	return {
		ok: false,
		error: "model_not_found",
		provider,
		model: modelId,
		message: `Model not available: ${provider}/${modelId}. Use an authenticated Pi model/provider or adjust /model/login configuration.`,
	};
}

function safeThinking(pi: ExtensionAPI): ThinkingLevel | undefined {
	try {
		return pi.getThinkingLevel();
	} catch {
		return undefined;
	}
}
