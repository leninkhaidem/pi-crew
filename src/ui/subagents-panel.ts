import path from "node:path";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { type Component, Key, matchesKey } from "@mariozechner/pi-tui";
import { type TranscriptExcerpt, readRecentTranscriptExcerpt } from "../runtime/transcript.js";
import type { SubagentState } from "../types.js";
import { isActiveSubagentState, renderSubagentsPanel } from "./subagents-panel-render.js";

export { isActiveSubagentState, renderSubagentsPanel } from "./subagents-panel-render.js";

const MAX_PANEL_ITEMS = 5;

interface SubagentsPanelArgs {
	theme: Theme;
	onClose: () => void;
	requestRender: () => void;
	onKill?: (state: SubagentState) => void | Promise<void>;
	canKill?: boolean;
	loadTranscript?: (state: SubagentState) => Promise<TranscriptExcerpt>;
}

interface TranscriptCacheEntry {
	lastUpdate: number;
	transcriptKey: string | null;
	status: "loading" | "ready";
	excerpt?: TranscriptExcerpt;
}

export class SubagentsPanel implements Component {
	private states: SubagentState[] = [];
	private selectedIdx = 0;
	private scrollOffset = 0;
	private detailedAgentId: string | null = null;
	private pendingKillAgentId: string | null = null;
	private transcripts = new Map<string, TranscriptCacheEntry>();

	constructor(private args: SubagentsPanelArgs) {}

	setStates(s: SubagentState[]) {
		this.states = sortStates(s.filter(isActiveSubagentState));
		if (this.detailedAgentId && !this.states.some((state) => state.agentId === this.detailedAgentId)) {
			this.detailedAgentId = null;
		}
		if (this.pendingKillAgentId && !this.states.some((state) => state.agentId === this.pendingKillAgentId)) {
			this.pendingKillAgentId = null;
		}
		this.selectedIdx = this.states.length === 0 ? 0 : Math.min(Math.max(0, this.selectedIdx), this.states.length - 1);
		this.ensureSelectionVisible();
		this.loadDetailedTranscript();
		this.args.requestRender();
	}

	handleInput(data: string): boolean {
		if (matchesKey(data, Key.ctrl("c"))) return false;
		if (this.pendingKillAgentId) return this.handleKillConfirmation(data);
		if (this.states.length === 0) {
			if (matchesKey(data, Key.escape) || matchesKey(data, Key.left)) this.args.onClose();
			return true;
		}
		if (matchesKey(data, Key.left) || matchesKey(data, Key.escape)) return this.closeOrBackOut();
		if (this.detailedAgentId) {
			if (this.canKill() && (matchesKey(data, Key.shift("d")) || matchesKey(data, "d"))) this.requestKillSelected();
			return true;
		}
		if (matchesKey(data, Key.up) || matchesKey(data, "k")) return this.moveSelection(-1);
		if (matchesKey(data, Key.down) || matchesKey(data, "j")) return this.moveSelection(1);
		if (matchesKey(data, Key.enter) || matchesKey(data, Key.right)) {
			this.drillIntoSelected();
			return true;
		}
		if (this.canKill() && (matchesKey(data, Key.shift("d")) || matchesKey(data, "d"))) {
			this.requestKillSelected();
			return true;
		}
		return true;
	}

	render(width: number): string[] {
		const termRows = process.stdout.rows || 24;
		const maxHeight = Math.max(10, termRows - 2);
		return renderSubagentsPanel({
			states: this.states,
			selectedIdx: this.selectedIdx,
			width,
			theme: this.args.theme,
			scrollOffset: this.scrollOffset,
			detailedAgentId: this.detailedAgentId,
			pendingKillAgentId: this.pendingKillAgentId,
			canKill: this.canKill(),
			transcript: this.currentTranscript(),
			maxHeight,
		});
	}

	invalidate(): void {
		// no cached state
	}

	private handleKillConfirmation(data: string): boolean {
		const agentId = this.pendingKillAgentId;
		if (!agentId) return true;
		if (matchesKey(data, "y") || matchesKey(data, Key.shift("y"))) return this.confirmKill(agentId);
		if (matchesKey(data, "n") || matchesKey(data, Key.shift("n")) || matchesKey(data, Key.escape)) {
			this.pendingKillAgentId = null;
			this.args.requestRender();
		}
		return true;
	}

	private confirmKill(agentId: string): boolean {
		const state = this.states.find((candidate) => candidate.agentId === agentId);
		this.pendingKillAgentId = null;
		if (state && isActiveSubagentState(state) && this.args.onKill) {
			if (this.detailedAgentId === state.agentId) this.detailedAgentId = null;
			void Promise.resolve(this.args.onKill(state)).finally(() => this.args.requestRender());
		}
		this.args.requestRender();
		return true;
	}

	private moveSelection(delta: number): true {
		this.selectedIdx = Math.min(this.states.length - 1, Math.max(0, this.selectedIdx + delta));
		this.ensureSelectionVisible();
		this.args.requestRender();
		return true;
	}

	private requestKillSelected(): void {
		const state = this.states[this.selectedIdx];
		if (!this.canKill() || !state || !isActiveSubagentState(state)) return;
		this.pendingKillAgentId = state.agentId;
		this.args.requestRender();
	}

	private closeOrBackOut(): true {
		if (this.detailedAgentId) this.detailedAgentId = null;
		else this.args.onClose();
		this.args.requestRender();
		return true;
	}

	private drillIntoSelected(): void {
		const cur = this.states[this.selectedIdx];
		if (!cur) return;
		this.detailedAgentId = cur.agentId;
		this.ensureTranscriptLoaded(cur, true);
		this.args.requestRender();
	}

	private loadDetailedTranscript(force = false): void {
		const state = this.states.find((candidate) => candidate.agentId === this.detailedAgentId);
		if (state) this.ensureTranscriptLoaded(state, force);
	}

	private ensureTranscriptLoaded(state: SubagentState, force = false): void {
		const cached = this.transcripts.get(state.agentId);
		const transcriptKey = getTranscriptKey(state);
		if (!force && cached?.transcriptKey === transcriptKey && transcriptKey !== null) return;
		if (!force && cached?.lastUpdate === state.lastUpdate && cached?.transcriptKey === transcriptKey) return;
		if (cached?.status === "loading") return;
		this.transcripts.set(state.agentId, {
			lastUpdate: state.lastUpdate,
			transcriptKey,
			status: cached?.excerpt ? "ready" : "loading",
			excerpt: cached?.excerpt,
		});
		void this.loadTranscript(state).then(
			(excerpt) => {
				this.transcripts.set(state.agentId, {
					lastUpdate: state.lastUpdate,
					transcriptKey,
					status: "ready",
					excerpt,
				});
				this.args.requestRender();
			},
			() => {
				const excerpt: TranscriptExcerpt = { kind: "unreadable", message: "Transcript unavailable." };
				this.transcripts.set(state.agentId, {
					lastUpdate: state.lastUpdate,
					transcriptKey,
					status: "ready",
					excerpt,
				});
				this.args.requestRender();
			},
		);
	}

	private loadTranscript(state: SubagentState): Promise<TranscriptExcerpt> {
		if (this.args.loadTranscript) return this.args.loadTranscript(state);
		if (!isExpectedTranscriptPath(state)) {
			return Promise.resolve({ kind: "unreadable", message: "Transcript unavailable." });
		}
		return readRecentTranscriptExcerpt(state.paths.output);
	}

	private currentTranscript(): TranscriptExcerpt | "loading" | undefined {
		const state = this.states.find((candidate) => candidate.agentId === this.detailedAgentId);
		if (!state) return undefined;
		const cached = this.transcripts.get(state.agentId);
		return cached?.status === "ready" ? cached.excerpt : "loading";
	}

	private canKill(): boolean {
		return this.args.canKill ?? Boolean(this.args.onKill);
	}

	private ensureSelectionVisible(): void {
		if (this.selectedIdx < this.scrollOffset) this.scrollOffset = this.selectedIdx;
		const bottom = this.scrollOffset + MAX_PANEL_ITEMS - 1;
		if (this.selectedIdx > bottom) this.scrollOffset = this.selectedIdx - MAX_PANEL_ITEMS + 1;
		this.scrollOffset = Math.max(0, this.scrollOffset);
	}
}

function getTranscriptKey(state: SubagentState): string | null {
	if (state.transcriptSize === undefined || state.transcriptMtimeMs === undefined) return null;
	return `${state.transcriptSize}:${state.transcriptMtimeMs}`;
}

function isExpectedTranscriptPath(state: SubagentState): boolean {
	const stateDir = path.dirname(path.resolve(state.paths.state));
	const outputPath = path.resolve(state.paths.output);
	return path.basename(outputPath) === "output.jsonl" && path.dirname(outputPath) === stateDir;
}

function sortStates(states: SubagentState[]): SubagentState[] {
	return [...states].sort((a, b) => {
		const ra = isActiveSubagentState(a) ? 0 : 1;
		const rb = isActiveSubagentState(b) ? 0 : 1;
		if (ra !== rb) return ra - rb;
		return ra === 0 ? a.startedAt - b.startedAt : (b.finishedAt ?? 0) - (a.finishedAt ?? 0);
	});
}
