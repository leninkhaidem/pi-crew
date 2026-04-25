// src/runtime/approval.ts

export interface ApprovalDeps {
	/** Read config: is confirmProjectAgents currently true? */
	isConfirmEnabled: () => boolean | Promise<boolean>;
}

export interface ApprovalArgs {
	agentName: string;
	agentSource: "user" | "project" | "bundled";
	hasUI: boolean;
	confirm: (title: string, message: string) => Promise<boolean>;
}

export interface ApprovalGate {
	(args: ApprovalArgs): Promise<boolean>;
	reset(): void;
}

export function createApprovalGate(deps: ApprovalDeps): ApprovalGate {
	const approved = new Set<string>();

	const fn = async (args: ApprovalArgs): Promise<boolean> => {
		if (args.agentSource !== "project") return true;
		const enabled = await deps.isConfirmEnabled();
		if (!enabled) return true;
		if (approved.has(args.agentName)) return true;
		if (!args.hasUI) return false;
		const ok = await args.confirm(
			"Run project-scoped sub-agent?",
			[
				`Agent "${args.agentName}" comes from <cwd>/.pi/agents/${args.agentName}.md.`,
				"Project agents are repo-controlled and may instruct the model to read",
				"files, run bash, etc. Only continue for repos you trust.",
			].join("\n"),
		);
		if (ok) approved.add(args.agentName);
		return ok;
	};

	const gate: ApprovalGate = Object.assign(fn, {
		reset() {
			approved.clear();
		},
	});
	return gate;
}
