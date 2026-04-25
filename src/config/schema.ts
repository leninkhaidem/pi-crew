import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import { DEFAULT_GLOBAL_SETTINGS, DEFAULT_TMUX_SETTINGS, type PiCrewConfig } from "../types.js";

const AgentSlotSchema = Type.Object({
	provider: Type.String({ minLength: 1 }),
	modelId: Type.String({ minLength: 1 }),
});

const GlobalSettingsSchema = Type.Object({
	maxConcurrent: Type.Integer({ minimum: 1, maximum: 32 }),
	maxActive: Type.Integer({ minimum: 1, maximum: 256 }),
	maxParallelTasksPerCall: Type.Integer({ minimum: 1, maximum: 32 }),
	retentionDays: Type.Integer({ minimum: 0, maximum: 365 }),
	notifyOnCompletion: Type.Boolean(),
	agentScope: Type.Union([Type.Literal("user"), Type.Literal("project"), Type.Literal("both")]),
	confirmProjectAgents: Type.Boolean(),
});

const TmuxSettingsSchema = Type.Object({
	mode: Type.Union([Type.Literal("off"), Type.Literal("window"), Type.Literal("external-session")]),
	killOnComplete: Type.Union([Type.Literal("off"), Type.Literal("after-grace")]),
	graceSeconds: Type.Integer({ minimum: 0, maximum: 3600 }),
});

const RawSchema = Type.Object({
	version: Type.Literal(1),
	agents: Type.Record(Type.String(), AgentSlotSchema),
	global: Type.Optional(GlobalSettingsSchema),
	tmux: Type.Optional(TmuxSettingsSchema),
});

export type ParseResult = { ok: true; value: PiCrewConfig } | { ok: false; errors: string[] };

export function parsePiCrewConfig(input: unknown): ParseResult {
	if (!Value.Check(RawSchema, input)) {
		const errors: string[] = [];
		for (const err of Value.Errors(RawSchema, input)) {
			errors.push(`${err.path}: ${err.message}`);
		}
		return { ok: false, errors };
	}
	const parsed = input as Static<typeof RawSchema>;
	return {
		ok: true,
		value: {
			version: 1,
			agents: parsed.agents,
			global: { ...DEFAULT_GLOBAL_SETTINGS, ...parsed.global },
			tmux: { ...DEFAULT_TMUX_SETTINGS, ...parsed.tmux },
		},
	};
}

export function emptyConfig(): PiCrewConfig {
	return {
		version: 1,
		agents: {},
		global: { ...DEFAULT_GLOBAL_SETTINGS },
		tmux: { ...DEFAULT_TMUX_SETTINGS },
	};
}
