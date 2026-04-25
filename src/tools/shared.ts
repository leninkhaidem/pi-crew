// src/tools/shared.ts
import { Type } from "typebox";

export const TaskItemSchema = Type.Object({
	agent: Type.String({ description: "Agent name (e.g., 'explore')" }),
	task: Type.String({ description: "Task to delegate" }),
	cwd: Type.Optional(Type.String({ description: "Working directory" })),
	maxTurns: Type.Optional(Type.Integer({ minimum: 1, description: "Max agentic turns" })),
});

export const ChainItemSchema = Type.Object({
	agent: Type.String({ description: "Agent name" }),
	task: Type.String({ description: "Task with optional {previous} placeholder" }),
	cwd: Type.Optional(Type.String()),
	maxTurns: Type.Optional(Type.Integer({ minimum: 1 })),
});
