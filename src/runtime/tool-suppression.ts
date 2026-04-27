export const PI_CREW_ORCHESTRATION_TOOL_NAMES = [
	"Agent",
	"subagent_dispatch",
	"subagent_run",
	"subagent_status",
	"get_subagent_result",
	"steer_subagent",
	"subagent_kill",
] as const;

export type PiCrewOrchestrationToolName = (typeof PI_CREW_ORCHESTRATION_TOOL_NAMES)[number];

const PI_CREW_ORCHESTRATION_TOOL_NAME_SET = new Set<string>(PI_CREW_ORCHESTRATION_TOOL_NAMES);

export function isPiCrewOrchestrationTool(name: string): boolean {
	return PI_CREW_ORCHESTRATION_TOOL_NAME_SET.has(name);
}

export function withoutPiCrewOrchestrationTools<T extends string>(toolNames: readonly T[]): T[] {
	return toolNames.filter((name) => !isPiCrewOrchestrationTool(name));
}
