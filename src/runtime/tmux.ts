// src/runtime/tmux.ts
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { SubagentState, TmuxSettings } from "../types.js";

export function tmuxAvailable(): boolean {
	const r = spawnSync("tmux", ["-V"], { stdio: "ignore" });
	return r.status === 0;
}

export function launchTmuxView(state: SubagentState, settings: TmuxSettings, packageRoot: string): boolean {
	if (settings.mode === "off") return false;
	if (!tmuxAvailable()) return false;
	const tailScript = path.join(packageRoot, "dist", "cli", "tail.js");
	const winName = `${state.agent}-${state.agentId}`;
	const sessionName = `pi-crew-${state.sessionId}`;
	const cmd = `node ${tailScript} ${state.paths.output}`;

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
	const winName = `${state.agent}-${state.agentId}`;
	const target = settings.mode === "external-session" ? `pi-crew-${state.sessionId}:${winName}` : winName;
	spawnSync("tmux", ["kill-window", "-t", target]);
}
