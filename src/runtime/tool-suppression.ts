export const PI_CREW_SUPPRESS_SUBAGENT_TOOLS_ENV = "PI_CREW_SUPPRESS_SUBAGENT_TOOLS";
export const PI_CREW_SUPPRESS_SUBAGENT_TOOLS_VALUE = "1";

export const PI_CREW_ORCHESTRATION_TOOL_NAMES = [
	"subagent_resume",
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

interface ToolRegisteringExtension {
	tools: Map<string, unknown>;
}

interface ExtensionLoadResult {
	extensions: ToolRegisteringExtension[];
}

export function isPiCrewOrchestrationTool(name: string): boolean {
	return PI_CREW_ORCHESTRATION_TOOL_NAME_SET.has(name);
}

export function withoutPiCrewOrchestrationTools<T extends string>(toolNames: readonly T[]): T[] {
	return toolNames.filter((name) => !isPiCrewOrchestrationTool(name));
}

export function shouldSuppressPiCrewSubagentTools(env: NodeJS.ProcessEnv = process.env): boolean {
	return env[PI_CREW_SUPPRESS_SUBAGENT_TOOLS_ENV] === PI_CREW_SUPPRESS_SUBAGENT_TOOLS_VALUE;
}

export function withoutPiCrewOrchestrationExtensions<T extends ExtensionLoadResult>(result: T): T {
	return {
		...result,
		extensions: result.extensions.filter((extension) => !hasPiCrewOrchestrationTool(extension)),
	};
}

function hasPiCrewOrchestrationTool(extension: ToolRegisteringExtension): boolean {
	for (const toolName of extension.tools.keys()) {
		if (isPiCrewOrchestrationTool(toolName)) return true;
	}
	return false;
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
