import { shouldSuppressPiCrewSubagentTools } from "./tool-suppression.js";

export const PI_SUBAGENT_INITIATOR_ENV = "PI_SUBAGENT_INITIATOR";
export const PI_SUBAGENT_INITIATOR_AGENT = "agent";
export const GITHUB_COPILOT_PROVIDER = "github-copilot";
export const COPILOT_INITIATOR_HEADER = "X-Initiator";

export function shouldForceCopilotAgentInitiator(env: NodeJS.ProcessEnv = process.env): boolean {
	return env[PI_SUBAGENT_INITIATOR_ENV] === PI_SUBAGENT_INITIATOR_AGENT || shouldSuppressPiCrewSubagentTools(env);
}

export function withCopilotAgentInitiatorHeader(headers?: Record<string, string>): Record<string, string> {
	const next = { ...headers };
	for (const key of Object.keys(next)) {
		if (key.toLowerCase() === COPILOT_INITIATOR_HEADER.toLowerCase()) delete next[key];
	}
	return { ...next, [COPILOT_INITIATOR_HEADER]: PI_SUBAGENT_INITIATOR_AGENT };
}

export function registerCopilotAgentInitiatorProvider(
	pi: { registerProvider?: (name: string, config: { headers: Record<string, string> }) => void },
	env: NodeJS.ProcessEnv = process.env,
): void {
	if (!shouldForceCopilotAgentInitiator(env)) return;
	pi.registerProvider?.(GITHUB_COPILOT_PROVIDER, { headers: withCopilotAgentInitiatorHeader() });
}

export function withCopilotAgentInitiatorModelRegistry<T extends object>(registry: T): T {
	return new Proxy(registry, {
		get(target, prop, receiver) {
			if (prop === "getApiKeyAndHeaders") {
				const original = Reflect.get(target, prop, target);
				if (typeof original !== "function") return original;
				return async (model: { provider?: string }, ...args: unknown[]) => {
					const result = await original.apply(target, [model, ...args]);
					if (!result || result.ok !== true || model.provider !== GITHUB_COPILOT_PROVIDER) return result;
					return {
						...result,
						headers: withCopilotAgentInitiatorHeader(result.headers),
					};
				};
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}
