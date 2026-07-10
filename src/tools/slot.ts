import { supportsXhigh } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { resolveThinkingLevel } from "../thinking.js";
import {
	type AgentSlot,
	type PiCrewConfig,
	type ThinkingAdjustment,
	type ThinkingLevel,
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
				| "model_not_found"
				| "no_supported_thinking_level";
	  };

/**
 * Resolve model/thinking for an agent invocation.
 *
 * All agents inherit the current parent model and thinking by default when
 * no explicit per-agent slot is configured. Explicit slots and per-call
 * overrides take precedence over inheritance. Capability adjustment happens
 * only after that precedence has selected one concrete provider/model pair.
 */
export function resolveAgentSlot(
	agentName: string,
	config: PiCrewConfig,
	ctx: ExtensionContext,
	pi: ExtensionAPI,
	overrides: SlotOverrides = {},
): SlotResolution {
	const hasOverrides = Boolean(overrides.provider || overrides.model || overrides.thinking);
	const resolved = hasOverrides
		? resolveOverriddenSlot(agentName, config, ctx, pi, overrides)
		: resolveConfiguredSlot(agentName, config, ctx, pi);
	if (!resolved.ok) return resolved;
	return applyThinkingCapability(resolved, ctx);
}

function resolveOverriddenSlot(
	agentName: string,
	config: PiCrewConfig,
	ctx: ExtensionContext,
	pi: ExtensionAPI,
	overrides: SlotOverrides,
): SlotResolution {
	const base = resolveBaseSlot(agentName, config, ctx, pi);
	const provider = overrides.provider ?? base?.slot.provider ?? ctx.model?.provider;
	const modelId = overrides.model ?? base?.slot.modelId ?? ctx.model?.id;
	if (!provider) {
		return {
			ok: false,
			error: "provider_required",
			message: `Provider required for agent "${agentName}" when overriding model without an inferable provider. Pass provider explicitly.`,
		};
	}
	if (!modelId) {
		return {
			ok: false,
			error: "model_required",
			message: `Model required for agent "${agentName}" when overriding provider without an inferable model. Pass model explicitly.`,
		};
	}
	if (!isKnownModel(ctx, provider, modelId)) return modelNotFound(provider, modelId);
	return {
		ok: true,
		slot: {
			provider,
			modelId,
			thinking: overrides.thinking ?? base?.slot.thinking,
		},
		inherited: base?.inherited ?? false,
	};
}

function resolveConfiguredSlot(
	agentName: string,
	config: PiCrewConfig,
	ctx: ExtensionContext,
	pi: ExtensionAPI,
): SlotResolution {
	const base = resolveBaseSlot(agentName, config, ctx, pi);
	if (base) return { ok: true, ...base };
	return {
		ok: false,
		error: "no_parent_model",
		message: `${agentName} needs a current parent model to inherit. Select a model in the parent session first.`,
	};
}

function resolveBaseSlot(
	agentName: string,
	config: PiCrewConfig,
	ctx: ExtensionContext,
	pi: ExtensionAPI,
): { slot: AgentSlot; inherited: boolean } | null {
	const configured = config.agents[agentName];
	if (isInheritedAgentSlot(configured)) {
		const inherited = inheritedParentSlot(ctx, pi);
		return inherited ? { slot: inherited, inherited: true } : null;
	}
	if (configured) return { slot: configured, inherited: false };
	const inherited = inheritedParentSlot(ctx, pi);
	if (inherited) return { slot: inherited, inherited: true };
	return null;
}

function applyThinkingCapability(
	resolved: Extract<SlotResolution, { ok: true }>,
	ctx: ExtensionContext,
): SlotResolution {
	const requested = resolved.slot.thinking;
	if (!requested) return resolved;

	const model = findRegistryModel(ctx, resolved.slot.provider, resolved.slot.modelId);
	if (requested === "max" && !model) return modelNotFound(resolved.slot.provider, resolved.slot.modelId);
	// Preserve baseline lower-level lookup behavior: absent registry metadata does
	// not create a new lower-level failure or clamp.
	if (!model) return resolved;

	const capability = resolveThinkingLevel(model, requested, () => supportsXhigh(model));
	if (!capability.ok) {
		return {
			ok: false,
			error: capability.error,
			message: `Model ${resolved.slot.provider}/${resolved.slot.modelId} supports no thinking level at or below "max". Choose another model or thinking level.`,
		};
	}
	return {
		...resolved,
		slot: { ...resolved.slot, thinking: capability.effective },
		...(capability.adjustment ? { thinkingAdjustment: capability.adjustment } : {}),
	};
}

function findRegistryModel(ctx: ExtensionContext, provider: string, modelId: string) {
	try {
		return ctx.modelRegistry?.find(provider, modelId);
	} catch {
		return undefined;
	}
}

function isKnownModel(ctx: ExtensionContext, provider: string, modelId: string): boolean {
	const registry = (ctx as { modelRegistry?: { find?: (provider: string, modelId: string) => unknown } }).modelRegistry;
	return registry?.find ? Boolean(registry.find(provider, modelId)) : true;
}

function modelNotFound(provider: string, modelId: string): Extract<SlotResolution, { ok: false }> {
	return {
		ok: false,
		error: "model_not_found",
		message: `Model not available: ${provider}/${modelId}. Use an authenticated Pi model/provider or adjust /model/login configuration.`,
	};
}

function inheritedParentSlot(ctx: ExtensionContext, pi: ExtensionAPI): AgentSlot | null {
	if (!ctx.model) return null;
	return {
		provider: ctx.model.provider,
		modelId: ctx.model.id,
		thinking: safeThinking(pi),
	};
}

function safeThinking(pi: ExtensionAPI): ThinkingLevel | undefined {
	try {
		return pi.getThinkingLevel();
	} catch {
		return undefined;
	}
}
