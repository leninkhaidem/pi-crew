import { describe, expect, it } from "vitest";
import {
	CAPABILITY_THINKING_LEVELS,
	type CapabilityThinkingLevel,
	type ThinkingModelMetadata,
	formatThinkingAdjustment,
	resolveThinkingLevel,
	supportsThinkingLevel,
} from "../../src/thinking.js";

function supportForAllLevels(model: ThinkingModelMetadata): Record<CapabilityThinkingLevel, boolean> {
	return Object.fromEntries(
		CAPABILITY_THINKING_LEVELS.map((level) => [level, supportsThinkingLevel(model, level)]),
	) as Record<CapabilityThinkingLevel, boolean>;
}

describe("supportsThinkingLevel", () => {
	it("supports only off for non-reasoning models", () => {
		expect(supportForAllLevels({ reasoning: false, thinkingLevelMap: { max: "max" } })).toEqual({
			off: true,
			minimal: false,
			low: false,
			medium: false,
			high: false,
			xhigh: false,
			max: false,
		});
	});

	it("uses standard defaults and fails extended levels closed when metadata is absent", () => {
		expect(supportForAllLevels({ reasoning: true })).toEqual({
			off: true,
			minimal: true,
			low: true,
			medium: true,
			high: true,
			xhigh: false,
			max: false,
		});
	});

	it.each([undefined, null, [], "high", 1, false])(
		"uses standard defaults and fails extended levels closed for malformed map %j",
		(map) => {
			expect(supportForAllLevels({ reasoning: true, thinkingLevelMap: map })).toEqual({
				off: true,
				minimal: true,
				low: true,
				medium: true,
				high: true,
				xhigh: false,
				max: false,
			});
		},
	);

	it("requires own string entries for extended levels and honors standard metadata holes", () => {
		const model = {
			reasoning: true,
			thinkingLevelMap: { high: null, medium: "provider-medium", xhigh: "provider-xhigh", max: "provider-max" },
		};
		expect(supportsThinkingLevel(model, "high")).toBe(false);
		expect(supportsThinkingLevel(model, "medium")).toBe(true);
		expect(supportsThinkingLevel(model, "xhigh")).toBe(true);
		expect(supportsThinkingLevel(model, "max")).toBe(true);
	});

	it("ignores inherited map properties", () => {
		const inheritedMap = Object.create({ high: null, xhigh: "xhigh", max: "max" }) as Record<string, unknown>;
		expect(supportsThinkingLevel({ reasoning: true, thinkingLevelMap: inheritedMap }, "high")).toBe(true);
		expect(supportsThinkingLevel({ reasoning: true, thinkingLevelMap: inheritedMap }, "xhigh")).toBe(false);
		expect(supportsThinkingLevel({ reasoning: true, thinkingLevelMap: inheritedMap }, "max")).toBe(false);
	});
});

describe("resolveThinkingLevel", () => {
	it("keeps structurally supported max exact", () => {
		const result = resolveThinkingLevel({ reasoning: true, thinkingLevelMap: { max: "provider-max" } }, "max");
		expect(result).toEqual({ ok: true, effective: "max" });
	});

	it("falls back from absent-map max to high without model/provider heuristics", () => {
		expect(resolveThinkingLevel({ reasoning: true }, "max")).toEqual({
			ok: true,
			effective: "high",
			adjustment: { requested: "max", effective: "high" },
		});
	});

	it.each([
		{ map: { max: null, xhigh: null, high: null, medium: "m" }, effective: "medium" },
		{ map: { max: null, xhigh: null, high: null, medium: null, low: "l" }, effective: "low" },
		{ map: { max: null, xhigh: null, high: null, medium: null, low: null, minimal: "m" }, effective: "minimal" },
		{
			map: { max: null, xhigh: null, high: null, medium: null, low: null, minimal: null, off: "off" },
			effective: "off",
		},
	])("falls through structural capability holes to $effective", ({ map, effective }) => {
		expect(resolveThinkingLevel({ reasoning: true, thinkingLevelMap: map }, "max")).toEqual({
			ok: true,
			effective,
			adjustment: { requested: "max", effective },
		});
	});

	it("fails explicitly when no level at or below max is supported", () => {
		const map = { max: null, xhigh: null, high: null, medium: null, low: null, minimal: null, off: null };
		expect(resolveThinkingLevel({ reasoning: true, thinkingLevelMap: map }, "max")).toEqual({
			ok: false,
			error: "no_supported_thinking_level",
			requested: "max",
		});
	});

	it("coerces reasoning requests on non-reasoning models to off", () => {
		expect(resolveThinkingLevel({ reasoning: false }, "high")).toEqual({
			ok: true,
			effective: "off",
			adjustment: { requested: "high", effective: "off" },
		});
	});
});

describe("formatThinkingAdjustment", () => {
	it.each([
		{ requested: "max", effective: "xhigh" },
		{ requested: "max", effective: "high" },
		{ requested: "high", effective: "off" },
	] as const)("formats the canonical $requested to $effective warning", (adjustment) => {
		expect(formatThinkingAdjustment(adjustment)).toMatchSnapshot();
	});

	it("emits no warning without a differing adjustment", () => {
		expect(formatThinkingAdjustment(undefined)).toBeUndefined();
		expect(formatThinkingAdjustment(null)).toBeUndefined();
		expect(formatThinkingAdjustment({ requested: "max", effective: "max" })).toBeUndefined();
	});
});
