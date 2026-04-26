// src/tools/shared.ts
import { Type } from "typebox";

export const ThinkingLevelSchema = Type.Union(
	[
		Type.Literal("off"),
		Type.Literal("minimal"),
		Type.Literal("low"),
		Type.Literal("medium"),
		Type.Literal("high"),
		Type.Literal("xhigh"),
	],
	{ description: "Valid values: off|minimal|low|medium|high|xhigh. Non-reasoning models force off." },
);

export const SlotOverrideProperties = {
	provider: Type.Optional(Type.String({ description: "Provider override, e.g. openai-codex." })),
	model: Type.Optional(
		Type.String({ description: "Model override. If provider is omitted, it is inferred when possible." }),
	),
	thinking: Type.Optional(ThinkingLevelSchema),
};

export const AliasSchema = Type.String({
	minLength: 1,
	description: "Required instance alias shown in sub-agent UI, e.g. 'schema-validator'.",
});

export const TaskItemSchema = Type.Object({
	agent: Type.String({ description: "Agent name (e.g., 'explore')" }),
	alias: AliasSchema,
	task: Type.String({ description: "Task to delegate" }),
	cwd: Type.Optional(Type.String({ description: "Working directory" })),
	...SlotOverrideProperties,
});

export const ChainItemSchema = Type.Object({
	agent: Type.String({ description: "Agent name" }),
	alias: AliasSchema,
	task: Type.String({ description: "Task with optional {previous} placeholder" }),
	cwd: Type.Optional(Type.String()),
	...SlotOverrideProperties,
});
