export const CAPABILITY_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type CapabilityThinkingLevel = (typeof CAPABILITY_THINKING_LEVELS)[number];

export interface ThinkingModelMetadata {
	readonly reasoning: boolean;
	readonly thinkingLevelMap?: unknown;
}

export interface ThinkingAdjustment {
	readonly requested: CapabilityThinkingLevel;
	readonly effective: CapabilityThinkingLevel;
}

export type ThinkingResolution =
	| {
			readonly ok: true;
			readonly effective: CapabilityThinkingLevel;
			readonly adjustment?: ThinkingAdjustment;
	  }
	| {
			readonly ok: false;
			readonly error: "no_supported_thinking_level";
			readonly requested: "max";
	  };

const STANDARD_LEVELS: ReadonlySet<CapabilityThinkingLevel> = new Set(["off", "minimal", "low", "medium", "high"]);

const MAX_FALLBACK_LEVELS = ["xhigh", "high", "medium", "low", "minimal", "off"] as const;
const hasOwn = (value: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, key);

/** Evaluate a thinking level solely from current structural model metadata. */
export function supportsThinkingLevel(model: ThinkingModelMetadata, level: CapabilityThinkingLevel): boolean {
	if (!model.reasoning) return level === "off";

	if (!hasOwn(model, "thinkingLevelMap")) return STANDARD_LEVELS.has(level);

	const map = model.thinkingLevelMap;
	if (!isRecord(map)) return STANDARD_LEVELS.has(level);

	if (STANDARD_LEVELS.has(level) && !hasOwn(map, level)) return true;
	return hasOwn(map, level) && typeof map[level] === "string";
}

/**
 * Resolve only the runtime adjustments authorized by the capability policy:
 * non-reasoning coercion and unsupported max fallback. Lower requests on
 * reasoning models remain unchanged, even when metadata contains a hole.
 */
export function resolveThinkingLevel(
	model: ThinkingModelMetadata,
	requested: CapabilityThinkingLevel,
): ThinkingResolution {
	if (!model.reasoning) {
		return requested === "off" ? unchanged("off") : adjusted(requested, "off");
	}

	if (requested !== "max") return unchanged(requested);
	if (supportsThinkingLevel(model, "max")) return unchanged("max");

	for (const candidate of MAX_FALLBACK_LEVELS) {
		if (supportsThinkingLevel(model, candidate)) return adjusted("max", candidate);
	}

	return { ok: false, error: "no_supported_thinking_level", requested: "max" };
}

/** Format the canonical caller-facing warning for a genuine adjustment. */
export function formatThinkingAdjustment(adjustment: ThinkingAdjustment | null | undefined): string | undefined {
	if (!adjustment || adjustment.requested === adjustment.effective) return undefined;
	return `Warning: requested thinking level "${adjustment.requested}" is unsupported by the selected model; using "${adjustment.effective}" instead.`;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unchanged(effective: CapabilityThinkingLevel): ThinkingResolution {
	return { ok: true, effective };
}

function adjusted(requested: CapabilityThinkingLevel, effective: CapabilityThinkingLevel): ThinkingResolution {
	return { ok: true, effective, adjustment: { requested, effective } };
}
