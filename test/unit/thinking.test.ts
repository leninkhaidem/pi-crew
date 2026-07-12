import { describe, expect, it, vi } from "vitest";
import {
	CAPABILITY_THINKING_LEVELS,
	type CapabilityThinkingLevel,
	type ThinkingModelMetadata,
	formatThinkingAdjustment,
	resolveThinkingLevel,
	supportsThinkingLevel,
} from "../../src/thinking.js";

const neverSupportsLegacyXhigh = (): boolean => false;

function supportForAllLevels(
	model: ThinkingModelMetadata,
	supportsLegacyXhigh: () => boolean = neverSupportsLegacyXhigh,
): Record<CapabilityThinkingLevel, boolean> {
	return Object.fromEntries(
		CAPABILITY_THINKING_LEVELS.map((level) => [level, supportsThinkingLevel(model, level, supportsLegacyXhigh)]),
	) as Record<CapabilityThinkingLevel, boolean>;
}

describe("supportsThinkingLevel", () => {
	it("supports only off for non-reasoning models regardless of map metadata", () => {
		const supportsLegacyXhigh = vi.fn(() => true);

		expect(
			supportForAllLevels(
				{ reasoning: false, thinkingLevelMap: { minimal: "minimal", xhigh: "xhigh", max: "max" } },
				supportsLegacyXhigh,
			),
		).toEqual({ off: true, minimal: false, low: false, medium: false, high: false, xhigh: false, max: false });
		expect(supportsLegacyXhigh).not.toHaveBeenCalled();
	});

	it.each([
		{ legacyXhigh: false, expectedXhigh: false },
		{ legacyXhigh: true, expectedXhigh: true },
	])(
		"uses the legacy xhigh answer only when the map property is absent: $legacyXhigh",
		({ legacyXhigh, expectedXhigh }) => {
			const supportsLegacyXhigh = vi.fn(() => legacyXhigh);

			expect(supportForAllLevels({ reasoning: true }, supportsLegacyXhigh)).toEqual({
				off: true,
				minimal: true,
				low: true,
				medium: true,
				high: true,
				xhigh: expectedXhigh,
				max: false,
			});
			expect(supportsLegacyXhigh).toHaveBeenCalledTimes(1);
		},
	);

	it("applies omitted standard defaults to a present empty record and fails extended levels closed", () => {
		const supportsLegacyXhigh = vi.fn(() => true);

		expect(supportForAllLevels({ reasoning: true, thinkingLevelMap: {} }, supportsLegacyXhigh)).toEqual({
			off: true,
			minimal: true,
			low: true,
			medium: true,
			high: true,
			xhigh: false,
			max: false,
		});
		expect(supportsLegacyXhigh).not.toHaveBeenCalled();
	});

	it("keeps omitted standard keys supported when another standard key is explicitly mapped", () => {
		expect(supportForAllLevels({ reasoning: true, thinkingLevelMap: { high: "provider-high" } })).toEqual({
			off: true,
			minimal: true,
			low: true,
			medium: true,
			high: true,
			xhigh: false,
			max: false,
		});
	});

	it.each([
		{ label: "string", value: "provider-high", supported: true },
		{ label: "null", value: null, supported: false },
		{ label: "number", value: 1, supported: false },
		{ label: "object", value: { effort: "high" }, supported: false },
		{ label: "array", value: ["high"], supported: false },
	])("treats an own standard-level $label entry according to its string shape", ({ value, supported }) => {
		expect(supportsThinkingLevel({ reasoning: true, thinkingLevelMap: { high: value } }, "high", vi.fn())).toBe(
			supported,
		);
	});

	it.each(["xhigh", "max"] as const)("requires an own string %s entry", (level) => {
		for (const [value, supported] of [
			["provider-value", true],
			[null, false],
			[1, false],
			[{ effort: level }, false],
			[[level], false],
		] as const) {
			expect(supportsThinkingLevel({ reasoning: true, thinkingLevelMap: { [level]: value } }, level, vi.fn())).toBe(
				supported,
			);
		}
		expect(supportsThinkingLevel({ reasoning: true, thinkingLevelMap: {} }, level, vi.fn())).toBe(false);
	});

	it.each([
		{ label: "undefined", map: undefined },
		{ label: "null", map: null },
		{ label: "array", map: ["high"] },
		{ label: "string primitive", map: "high" },
		{ label: "number primitive", map: 1 },
		{ label: "boolean primitive", map: false },
	])("uses standard defaults but fails extended levels closed for a present $label map", ({ map }) => {
		const supportsLegacyXhigh = vi.fn(() => true);

		expect(supportForAllLevels({ reasoning: true, thinkingLevelMap: map }, supportsLegacyXhigh)).toEqual({
			off: true,
			minimal: true,
			low: true,
			medium: true,
			high: true,
			xhigh: false,
			max: false,
		});
		expect(supportsLegacyXhigh).not.toHaveBeenCalled();
	});

	it("requires own map entries rather than inherited values", () => {
		const inheritedMap = Object.create({ high: null, xhigh: "xhigh", max: "max" }) as Record<string, unknown>;

		expect(supportsThinkingLevel({ reasoning: true, thinkingLevelMap: inheritedMap }, "high", vi.fn())).toBe(true);
		expect(supportsThinkingLevel({ reasoning: true, thinkingLevelMap: inheritedMap }, "xhigh", vi.fn())).toBe(false);
		expect(supportsThinkingLevel({ reasoning: true, thinkingLevelMap: inheritedMap }, "max", vi.fn())).toBe(false);
	});

	it("treats an inherited map property as absent", () => {
		const model = Object.assign(Object.create({ thinkingLevelMap: { xhigh: "xhigh", max: "max" } }), {
			reasoning: true,
		}) as ThinkingModelMetadata;
		const supportsLegacyXhigh = vi.fn(() => true);

		expect(supportsThinkingLevel(model, "xhigh", supportsLegacyXhigh)).toBe(true);
		expect(supportsThinkingLevel(model, "max", supportsLegacyXhigh)).toBe(false);
		expect(supportsLegacyXhigh).toHaveBeenCalledTimes(1);
	});

	it("consults legacy xhigh support for no other metadata or level combination", () => {
		const supportsLegacyXhigh = vi.fn(() => true);
		const models: ThinkingModelMetadata[] = [
			{ reasoning: false },
			{ reasoning: true, thinkingLevelMap: undefined },
			{ reasoning: true, thinkingLevelMap: null },
			{ reasoning: true, thinkingLevelMap: [] },
			{ reasoning: true, thinkingLevelMap: {} },
		];

		for (const model of models) supportForAllLevels(model, supportsLegacyXhigh);
		expect(supportsLegacyXhigh).not.toHaveBeenCalled();

		expect(supportsThinkingLevel({ reasoning: true }, "xhigh", supportsLegacyXhigh)).toBe(true);
		expect(supportsLegacyXhigh).toHaveBeenCalledTimes(1);
	});
});

describe("resolveThinkingLevel", () => {
	it("keeps supported max exact and unadjusted without a warning", () => {
		const result = resolveThinkingLevel({ reasoning: true, thinkingLevelMap: { max: "provider-max" } }, "max", vi.fn());

		expect(result).toEqual({ ok: true, effective: "max" });
		expect(formatThinkingAdjustment(result.ok ? result.adjustment : undefined)).toBeUndefined();
	});

	it.each([
		{ legacyXhigh: true, expected: "xhigh" },
		{ legacyXhigh: false, expected: "high" },
	] as const)("falls back from absent-map max to $expected", ({ legacyXhigh, expected }) => {
		expect(resolveThinkingLevel({ reasoning: true }, "max", () => legacyXhigh)).toEqual({
			ok: true,
			effective: expected,
			adjustment: { requested: "max", effective: expected },
		});
	});

	it.each([
		{
			label: "medium",
			map: { max: null, xhigh: null, high: null, medium: "provider-medium" },
			effective: "medium",
		},
		{
			label: "low",
			map: { max: null, xhigh: null, high: null, medium: null, low: "provider-low" },
			effective: "low",
		},
		{
			label: "minimal",
			map: { max: null, xhigh: null, high: null, medium: null, low: null, minimal: "provider-minimal" },
			effective: "minimal",
		},
		{
			label: "off",
			map: { max: null, xhigh: null, high: null, medium: null, low: null, minimal: null, off: "disabled" },
			effective: "off",
		},
	] as const)("falls through capability holes to $label", ({ map, effective }) => {
		expect(resolveThinkingLevel({ reasoning: true, thinkingLevelMap: map }, "max", vi.fn())).toEqual({
			ok: true,
			effective,
			adjustment: { requested: "max", effective },
		});
	});

	it("returns an explicit failure when every lower level is unsupported", () => {
		const map = { max: null, xhigh: null, high: null, medium: null, low: null, minimal: null, off: null };
		const result = resolveThinkingLevel({ reasoning: true, thinkingLevelMap: map }, "max", vi.fn());

		expect(result).toEqual({ ok: false, error: "no_supported_thinking_level", requested: "max" });
		expect(result).not.toHaveProperty("effective");
		expect(result).not.toHaveProperty("adjustment");
		expect(formatThinkingAdjustment("adjustment" in result ? result.adjustment : undefined)).toBeUndefined();
	});

	it.each(["max", "xhigh", "high", "medium", "low", "minimal"] as const)(
		"coerces non-reasoning %s to off with minimal provenance",
		(requested) => {
			const result = resolveThinkingLevel({ reasoning: false }, requested, vi.fn());

			expect(result).toEqual({
				ok: true,
				effective: "off",
				adjustment: { requested, effective: "off" },
			});
			if (result.ok) expect(Object.keys(result.adjustment ?? {})).toEqual(["requested", "effective"]);
		},
	);

	it("keeps non-reasoning off exact and unadjusted", () => {
		const result = resolveThinkingLevel({ reasoning: false }, "off", vi.fn());

		expect(result).toEqual({ ok: true, effective: "off" });
		expect(formatThinkingAdjustment(result.ok ? result.adjustment : undefined)).toBeUndefined();
	});

	it.each(["off", "minimal", "low", "medium", "high", "xhigh"] as const)(
		"does not normalize or warn for a reasoning-model %s request even when its own entry is unsupported",
		(requested) => {
			const result = resolveThinkingLevel(
				{ reasoning: true, thinkingLevelMap: { [requested]: null } },
				requested,
				vi.fn(),
			);

			expect(result).toEqual({ ok: true, effective: requested });
			expect(formatThinkingAdjustment(result.ok ? result.adjustment : undefined)).toBeUndefined();
		},
	);
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
