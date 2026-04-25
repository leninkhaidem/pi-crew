import { homedir } from "node:os";

export function formatTokens(n: number): string {
	if (n < 1000) return n.toString();
	if (n < 10000) {
		const formatted = (n / 1000).toFixed(1);
		return formatted.endsWith(".0") ? `${formatted.slice(0, -2)}k` : `${formatted}k`;
	}
	if (n < 1000000) return `${Math.round(n / 1000)}k`;
	return `${(n / 1000000).toFixed(1)}M`;
}

export interface UsageStatsLike {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns?: number;
}

export function formatUsageStats(u: UsageStatsLike, model?: string): string {
	const parts: string[] = [];
	if (u.turns) parts.push(`${u.turns} turn${u.turns === 1 ? "" : "s"}`);
	if (u.input) parts.push(`↑${formatTokens(u.input)}`);
	if (u.output) parts.push(`↓${formatTokens(u.output)}`);
	if (u.cacheRead) parts.push(`R${formatTokens(u.cacheRead)}`);
	if (u.cacheWrite) parts.push(`W${formatTokens(u.cacheWrite)}`);
	if (u.cost) parts.push(`$${u.cost.toFixed(4)}`);
	if (u.contextTokens > 0) parts.push(`ctx:${formatTokens(u.contextTokens)}`);
	if (model) parts.push(model);
	return parts.join(" ");
}

function shortenPath(p: string): string {
	const home = homedir();
	return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

export function formatToolCall(name: string, args: Record<string, unknown>): string {
	switch (name) {
		case "bash": {
			const cmd = (args.command as string) ?? "...";
			return `$ ${cmd.length > 60 ? `${cmd.slice(0, 60)}...` : cmd}`;
		}
		case "read": {
			const fp = shortenPath((args.file_path ?? args.path ?? "...") as string);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let suffix = "";
			if (offset !== undefined || limit !== undefined) {
				const start = offset ?? 1;
				const end = limit !== undefined ? start + limit - 1 : "";
				suffix = `:${start}${end ? `-${end}` : ""}`;
			}
			return `read ${fp}${suffix}`;
		}
		case "write":
		case "edit": {
			const fp = shortenPath((args.file_path ?? args.path ?? "...") as string);
			return `${name} ${fp}`;
		}
		case "ls": {
			return `ls ${shortenPath((args.path ?? ".") as string)}`;
		}
		case "find": {
			return `find ${args.pattern ?? "*"} in ${shortenPath((args.path ?? ".") as string)}`;
		}
		case "grep": {
			return `grep /${args.pattern ?? ""}/ in ${shortenPath((args.path ?? ".") as string)}`;
		}
		default: {
			const s = JSON.stringify(args);
			return `${name} ${s.length > 50 ? `${s.slice(0, 50)}...` : s}`;
		}
	}
}
