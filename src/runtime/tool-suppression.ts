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
const SUPPRESSED_SESSIONS = new WeakSet<ToolNameSession>();

interface ToolNameSession {
	getActiveToolNames(): string[];
	setActiveToolsByName(toolNames: string[]): void;
}

export function isPiCrewOrchestrationTool(name: string): boolean {
	return PI_CREW_ORCHESTRATION_TOOL_NAME_SET.has(name);
}

export function withoutPiCrewOrchestrationTools<T extends string>(toolNames: readonly T[]): T[] {
	return toolNames.filter((name) => !isPiCrewOrchestrationTool(name));
}

export function suppressPiCrewOrchestrationTools(session: ToolNameSession): void {
	if (!SUPPRESSED_SESSIONS.has(session)) {
		const setActiveToolsByName = session.setActiveToolsByName.bind(session);
		session.setActiveToolsByName = (toolNames: string[]) => {
			setActiveToolsByName(withoutPiCrewOrchestrationTools(toolNames));
		};
		SUPPRESSED_SESSIONS.add(session);
	}
	session.setActiveToolsByName(session.getActiveToolNames());
}
