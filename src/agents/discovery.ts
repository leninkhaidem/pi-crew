import fs from "node:fs";
import path from "node:path";
import type { AgentConfig } from "../types.js";
import { parseAgentMarkdown } from "./frontmatter.js";

export type AgentScope = "user" | "project" | "both";

export interface DiscoverArgs {
	cwd: string;
	scope: AgentScope;
	userAgentsDir: string;
	bundledDir: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

function loadDir(dir: string, source: AgentConfig["source"]): AgentConfig[] {
	if (!fs.existsSync(dir)) return [];
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const out: AgentConfig[] = [];
	for (const e of entries) {
		if (!e.name.endsWith(".md")) continue;
		if (!e.isFile() && !e.isSymbolicLink()) continue;
		const filePath = path.join(dir, e.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}
		const parsed = parseAgentMarkdown(content, filePath);
		if (!parsed) continue;
		out.push({ ...parsed, source, filePath });
	}
	return out;
}

function findProjectAgentsDir(cwd: string): string | null {
	let dir = path.resolve(cwd);
	while (true) {
		const candidate = path.join(dir, ".pi", "agents");
		try {
			if (fs.statSync(candidate).isDirectory()) return candidate;
		} catch {
			// ignore
		}
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

export function discoverAgents(args: DiscoverArgs): AgentDiscoveryResult {
	const projectAgentsDir = findProjectAgentsDir(args.cwd);
	const bundled = loadDir(args.bundledDir, "bundled");
	const user = args.scope === "project" ? [] : loadDir(args.userAgentsDir, "user");
	const project = args.scope === "user" || !projectAgentsDir ? [] : loadDir(projectAgentsDir, "project");

	const map = new Map<string, AgentConfig>();
	// Lowest precedence first; later writes win.
	for (const a of bundled) map.set(a.name, a);
	if (args.scope !== "project") for (const a of user) map.set(a.name, a);
	if (args.scope !== "user") for (const a of project) map.set(a.name, a);

	return { agents: [...map.values()], projectAgentsDir };
}
