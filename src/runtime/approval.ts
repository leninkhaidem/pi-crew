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
	const inflight = new Map<string, Promise<boolean>>();

	const fn = async (args: ApprovalArgs): Promise<boolean> => {
		if (args.agentSource !== "project") return true;
		const enabled = await deps.isConfirmEnabled();
		if (!enabled) return true;
		if (approved.has(args.agentName)) return true;
		if (!args.hasUI) return false;

		const existing = inflight.get(args.agentName);
		if (existing) return existing;

		const p = (async () => {
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
		})();
		inflight.set(args.agentName, p);
		try {
			return await p;
		} finally {
			inflight.delete(args.agentName);
		}
	};

	return Object.assign(fn, {
		reset() {
			approved.clear();
			inflight.clear();
		},
	});
}
