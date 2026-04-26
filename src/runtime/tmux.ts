// src/runtime/tmux.ts
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { SubagentState, TmuxSettings } from "../types.js";

export function tmuxAvailable(): boolean {
	const r = spawnSync("tmux", ["-V"], { stdio: "ignore" });
	return r.status === 0;
}

function shQuote(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

function safeWindowName(name: string): string {
	// tmux window names: keep alphanumerics, dash, dot, underscore. Replace others with '-'.
	return name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80) || "agent";
}

export function launchTmuxView(state: SubagentState, settings: TmuxSettings, packageRoot: string): boolean {
	if (settings.mode === "off") return false;
	if (!tmuxAvailable()) return false;
	const tailScript = path.join(packageRoot, "dist", "cli", "tail.js");
	const winName = safeWindowName(`${state.alias}-${state.agentId}`);
	const sessionName = safeWindowName(`pi-crew-${state.sessionId}`);
	const cmd = `node ${shQuote(tailScript)} ${shQuote(state.paths.output)}`;

	if (settings.mode === "window") {
		if (!process.env.TMUX) {
			return launchTmuxView(state, { ...settings, mode: "external-session" }, packageRoot);
		}
		const r = spawnSync("tmux", ["new-window", "-n", winName, cmd]);
		return r.status === 0;
	}

	// external-session
	spawnSync("tmux", ["new-session", "-d", "-s", sessionName, "-n", "main"]);
	const r = spawnSync("tmux", ["new-window", "-t", sessionName, "-n", winName, cmd]);
	return r.status === 0;
}

export function killTmuxWindow(state: SubagentState, settings: TmuxSettings): void {
	if (settings.mode === "off") return;
	const winName = safeWindowName(`${state.alias}-${state.agentId}`);
	const sessionName = safeWindowName(`pi-crew-${state.sessionId}`);
	const target = settings.mode === "external-session" ? `${sessionName}:${winName}` : winName;
	spawnSync("tmux", ["kill-window", "-t", target]);
}
