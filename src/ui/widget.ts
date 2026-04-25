// src/ui/widget.ts
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { SubagentState } from "../types.js";
import { formatTokens } from "./format.js";

const MAX_ROWS = 10;
const AUTO_HIDE_MS = 10_000;

export interface WidgetController {
	update(states: SubagentState[]): void;
	stop(): void;
}

export function mountWidget(ctx: ExtensionContext): WidgetController {
	let hideTimer: NodeJS.Timeout | null = null;

	const renderLines = (states: SubagentState[]): string[] => {
		const sortable = [...states].sort((a, b) => {
			const ra = a.status === "running" || a.status === "starting" ? 0 : 1;
			const rb = b.status === "running" || b.status === "starting" ? 0 : 1;
			if (ra !== rb) return ra - rb;
			return ra === 0 ? a.startedAt - b.startedAt : (b.finishedAt ?? 0) - (a.finishedAt ?? 0);
		});
		const visible = sortable.slice(0, MAX_ROWS);
		const overflow = sortable.length - visible.length;
		const counts = countByStatus(states);
		const header = `─── pi-crew (${counts.running} running, ${counts.done} done) ───`;
		const lines: string[] = [header];
		for (const s of visible) {
			const icon = iconFor(s.status);
			const tokens = formatTokens(s.usage.input + s.usage.output);
			const branch = s.branch ?? "?";
			lines.push(
				`  ${icon} ${s.agent} #${s.agentId} → ${truncate(s.task, 30)}    ↑${tokens} cwd=${shorten(s.cwd)} ${branch}`,
			);
		}
		if (overflow > 0) lines.push(`  … +${overflow} more (run /subagents)`);
		return lines;
	};

	const update = (states: SubagentState[]) => {
		const active = states.filter((s) => s.status === "running" || s.status === "starting");
		if (active.length > 0) {
			if (hideTimer) {
				clearTimeout(hideTimer);
				hideTimer = null;
			}
			ctx.ui.setWidget("pi-crew", renderLines(states));
			return;
		}
		if (states.length > 0 && !hideTimer) {
			ctx.ui.setWidget("pi-crew", renderLines(states));
			hideTimer = setTimeout(() => {
				ctx.ui.setWidget("pi-crew", undefined);
				hideTimer = null;
			}, AUTO_HIDE_MS);
		} else if (states.length === 0) {
			ctx.ui.setWidget("pi-crew", undefined);
		}
	};

	return {
		update,
		stop() {
			if (hideTimer) clearTimeout(hideTimer);
			ctx.ui.setWidget("pi-crew", undefined);
		},
	};
}

function countByStatus(states: SubagentState[]) {
	let running = 0;
	let done = 0;
	let failed = 0;
	for (const s of states) {
		if (s.status === "running" || s.status === "starting") running++;
		else if (s.status === "done") done++;
		else failed++;
	}
	return { running, done, failed };
}

function iconFor(status: SubagentState["status"]): string {
	if (status === "running" || status === "starting") return "⏳";
	if (status === "done") return "✓";
	return "✗";
}

function truncate(s: string, n: number): string {
	return s.length > n ? `${s.slice(0, n)}…` : s;
}

function shorten(p: string): string {
	if (p.length > 24) return `…${p.slice(-22)}`;
	return p;
}
