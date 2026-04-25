import fs from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { discoverAgents } from "../agents/discovery.js";
import type { ExtensionRuntime } from "../runtime/types.js";
import type { AgentConfig } from "../types.js";

export function registerAgentsCommand(pi: ExtensionAPI, rt: ExtensionRuntime): void {
	pi.registerCommand("subagent-agents", {
		description: "Create, view, edit, eject, or delete pi-crew agents.",
		handler: async (_args, ctx) => {
			while (true) {
				const config = await rt.getConfig();
				const discovered = discoverAgents({
					cwd: ctx.cwd,
					scope: config.global.agentScope,
					userAgentsDir: rt.userAgentsDir,
					bundledDir: rt.bundledAgentsDir,
				});
				const entries = discovered.agents.sort((a, b) => a.name.localeCompare(b.name));
				const choices = [
					"Create user agent",
					"Install/eject bundled defaults",
					...entries.map((a) => `${sourceIcon(a.source)} ${a.name} — ${a.description}`),
					"Close",
				];
				const choice = await ctx.ui.select("pi-crew agents", choices);
				if (!choice || choice === "Close") return;
				if (choice === "Create user agent") {
					await createAgent(ctx, rt.userAgentsDir);
					continue;
				}
				if (choice === "Install/eject bundled defaults") {
					await ejectBundledDefaults(ctx, rt);
					continue;
				}
				const name = parseChoiceName(choice);
				const agent = entries.find((a) => a.name === name);
				if (agent) await manageAgent(ctx, rt, agent);
			}
		},
	});
}

async function manageAgent(ctx: ExtensionCommandContext, rt: ExtensionRuntime, agent: AgentConfig): Promise<void> {
	const actions =
		agent.source === "bundled" ? ["View", "Eject to user agents", "Back"] : ["View", "Edit", "Delete", "Back"];
	const action = await ctx.ui.select(`${agent.name} (${agent.source})`, actions);
	if (!action || action === "Back") return;
	if (action === "View") {
		const content = await fs.readFile(agent.filePath, "utf-8");
		await ctx.ui.editor(`View ${agent.name}`, content);
		return;
	}
	if (action === "Eject to user agents") {
		await fs.mkdir(rt.userAgentsDir, { recursive: true });
		const dst = path.join(rt.userAgentsDir, `${agent.name}.md`);
		const exists = await fileExists(dst);
		if (exists && !(await ctx.ui.confirm("Overwrite agent", `${dst} already exists. Overwrite?`))) return;
		await fs.copyFile(agent.filePath, dst);
		ctx.ui.notify(`Ejected ${agent.name} to ${dst}`, "info");
		return;
	}
	if (action === "Edit") {
		const content = await fs.readFile(agent.filePath, "utf-8");
		const edited = await ctx.ui.editor(`Edit ${agent.name}`, content);
		if (edited !== undefined && edited !== content) {
			await fs.writeFile(agent.filePath, edited, "utf-8");
			ctx.ui.notify(`Updated ${agent.filePath}`, "info");
		}
		return;
	}
	if (action === "Delete") {
		if (await ctx.ui.confirm("Delete agent", `Delete ${agent.name} at ${agent.filePath}?`)) {
			await fs.rm(agent.filePath, { force: true });
			ctx.ui.notify(`Deleted ${agent.filePath}`, "info");
		}
	}
}

async function createAgent(ctx: ExtensionCommandContext, userAgentsDir: string): Promise<void> {
	const rawName = await ctx.ui.input("Agent name", "my-agent");
	const name = sanitizeName(rawName ?? "");
	if (!name) {
		ctx.ui.notify("Agent name must contain letters, numbers, dots, underscores, or dashes.", "warning");
		return;
	}
	const description = await ctx.ui.input("Description", "Custom sub-agent");
	if (!description) return;
	const tools = await ctx.ui.input("Tools (comma-separated, empty = all)", "read, grep, find, ls, bash");
	const body = await ctx.ui.editor(
		"System prompt",
		"You are a focused sub-agent. Complete the assigned task and report concise findings.\n",
	);
	if (body === undefined) return;
	await fs.mkdir(userAgentsDir, { recursive: true });
	const filePath = path.join(userAgentsDir, `${name}.md`);
	if (
		(await fileExists(filePath)) &&
		!(await ctx.ui.confirm("Overwrite agent", `${filePath} already exists. Overwrite?`))
	)
		return;
	const content = [
		"---",
		`name: ${name}`,
		`description: ${description}`,
		...(tools?.trim() ? [`tools: ${tools.trim()}`] : []),
		"---",
		"",
		body.trimEnd(),
		"",
	].join("\n");
	await fs.writeFile(filePath, content, "utf-8");
	ctx.ui.notify(`Created ${filePath}`, "info");
}

async function ejectBundledDefaults(ctx: ExtensionCommandContext, rt: ExtensionRuntime): Promise<void> {
	await fs.mkdir(rt.userAgentsDir, { recursive: true });
	const files = await fs.readdir(rt.bundledAgentsDir).catch(() => [] as string[]);
	const installed: string[] = [];
	const skipped: string[] = [];
	for (const file of files.filter((f) => f.endsWith(".md"))) {
		const dst = path.join(rt.userAgentsDir, file);
		if (await fileExists(dst)) {
			skipped.push(file);
			continue;
		}
		await fs.copyFile(path.join(rt.bundledAgentsDir, file), dst);
		installed.push(file);
	}
	ctx.ui.notify(
		`Installed: ${installed.join(", ") || "none"}. Skipped existing: ${skipped.join(", ") || "none"}.`,
		"info",
	);
}

function parseChoiceName(choice: string): string {
	return (
		choice
			.replace(/^[•◦◆]\s+/, "")
			.split(" — ")[0]
			?.trim() ?? choice
	);
}

function sourceIcon(source: AgentConfig["source"]): string {
	if (source === "project") return "◆";
	if (source === "user") return "•";
	return "◦";
}

function sanitizeName(name: string): string {
	return name
		.trim()
		.replace(/[^a-zA-Z0-9._-]/g, "-")
		.replace(/^-+|-+$/g, "");
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}
