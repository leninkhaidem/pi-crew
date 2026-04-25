// src/ui/overlay.ts
import path from "node:path";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { getRoot } from "../state/paths.js";
import type { SubagentState } from "../types.js";
import { formatToolCall, formatUsageStats } from "./format.js";
import { mountStateWatcher } from "./state-watcher.js";

const KEY_UP = "\x1b[A";
const KEY_DOWN = "\x1b[B";
const KEY_ENTER = "\r";
const KEY_ESC = "\x1b";
const KEY_K = "k";

interface OverlayDeps {
	agentDir: string;
	sessionId: string;
}

class TreeOverlay implements Component {
	private states: SubagentState[] = [];
	private selectedIdx = 0;
	private expanded = new Set<string>();

	constructor(
		private theme: Theme,
		private _deps: OverlayDeps,
		private onClose: () => void,
		private requestRender: () => void,
	) {}

	setStates(s: SubagentState[]) {
		this.states = s;
		if (this.selectedIdx >= s.length) this.selectedIdx = Math.max(0, s.length - 1);
		this.requestRender();
	}

	handleInput(data: string): void {
		if (data === KEY_UP) {
			this.selectedIdx = Math.max(0, this.selectedIdx - 1);
			this.requestRender();
			return;
		}
		if (data === KEY_DOWN) {
			this.selectedIdx = Math.min(this.states.length - 1, this.selectedIdx + 1);
			this.requestRender();
			return;
		}
		if (data === KEY_ENTER) {
			const cur = this.states[this.selectedIdx];
			if (cur) {
				if (this.expanded.has(cur.agentId)) this.expanded.delete(cur.agentId);
				else this.expanded.add(cur.agentId);
				this.requestRender();
			}
			return;
		}
		if (data === KEY_K) {
			const cur = this.states[this.selectedIdx];
			if (cur && cur.status === "running" && cur.pid) {
				try {
					process.kill(cur.pid, "SIGTERM");
				} catch {
					// ignore
				}
			}
			return;
		}
		if (data === KEY_ESC) {
			this.onClose();
		}
	}

	render(_width: number): string[] {
		const lines: string[] = [];
		lines.push(this.theme.fg("accent", `─── pi-crew tree (${this.states.length}) ───`));
		this.states.forEach((s, i) => {
			const cur = i === this.selectedIdx ? "▸ " : "  ";
			const icon = s.status === "done" ? "✓" : s.status === "running" || s.status === "starting" ? "⏳" : "✗";
			lines.push(`${cur}${icon} ${s.agent} #${s.agentId}  ${s.task.slice(0, 60)}`);
			if (this.expanded.has(s.agentId)) {
				lines.push(`    cwd=${s.cwd} branch=${s.branch ?? "?"}`);
				lines.push(`    ${formatUsageStats(s.usage, s.model)}`);
				if (s.lastToolCall) lines.push(`    last: ${formatToolCall(s.lastToolCall.name, s.lastToolCall.args)}`);
				if (s.lastText) lines.push(`    ${s.lastText.slice(0, 100)}`);
			}
		});
		lines.push(this.theme.fg("dim", "↑↓ nav · enter expand · k kill · esc close"));
		return lines;
	}

	invalidate(): void {
		// no cached state
	}
}

export async function openTreeOverlay(
	ctx: ExtensionCommandContext,
	agentDir: string,
	sessionId: string,
): Promise<void> {
	let watcherHandle: { stop: () => void } | null = null;
	await ctx.ui.custom<void>(
		(tui, theme, _kb, done) => {
			const overlay = new TreeOverlay(
				theme,
				{ agentDir, sessionId },
				() => {
					watcherHandle?.stop();
					done(undefined);
				},
				() => tui.requestRender(),
			);
			watcherHandle = mountStateWatcher({
				sessionDir: path.join(getRoot({ agentDir }), sessionId),
				onChange: (states) => overlay.setStates(states),
			});
			return overlay;
		},
		{ overlay: true, overlayOptions: { width: "80%", maxHeight: "80%", anchor: "center" } },
	);
}
