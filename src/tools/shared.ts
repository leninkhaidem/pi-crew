// src/tools/shared.ts
import { Type } from "typebox";
import { THINKING_LEVELS } from "../types.js";

export const ThinkingLevelSchema = Type.Union(
	THINKING_LEVELS.map((level) => Type.Literal(level)),
	{
		description:
			"Valid values: off|minimal|low|medium|high|xhigh|max. Unsupported max uses the nearest supported lower level with a warning; non-reasoning models force off.",
	},
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
