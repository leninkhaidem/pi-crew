// src/commands/install-defaults.ts
import fs from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ExtensionRuntime } from "../runtime/types.js";

const BUNDLED_NAMES = ["general-purpose", "explore", "plan", "code-reviewer"];

export function registerInstallDefaultsCommand(pi: ExtensionAPI, rt: ExtensionRuntime): void {
	pi.registerCommand("subagent-install-defaults", {
		description: "Copy bundled pi-crew agents to ~/.pi/agent/agents/.",
		handler: async (_args, ctx) => {
			await fs.mkdir(rt.userAgentsDir, { recursive: true });
			const installed: string[] = [];
			const skipped: string[] = [];
			for (const name of BUNDLED_NAMES) {
				const src = path.join(rt.bundledAgentsDir, `${name}.md`);
				const dst = path.join(rt.userAgentsDir, `${name}.md`);
				if (await exists(dst)) {
					skipped.push(name);
					continue;
				}
				await fs.copyFile(src, dst);
				installed.push(name);
			}
			ctx.ui.notify(`Installed: ${installed.join(", ") || "none"}. Skipped: ${skipped.join(", ") || "none"}.`, "info");
		},
	});
}

async function exists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}
