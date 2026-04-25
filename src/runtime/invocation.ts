export interface InvocationOptions {
	binary?: string;
	args: string[];
}

export interface ResolvedInvocation {
	command: string;
	args: string[];
}

export function resolvePiInvocation(opts: InvocationOptions): ResolvedInvocation {
	const command = opts.binary ?? process.env.PI_CREW_PI_BINARY ?? "pi";
	return { command, args: opts.args };
}
