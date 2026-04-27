import type { Theme } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { type TranscriptExcerpt, readRecentTranscriptExcerpt } from "../runtime/transcript.js";
import type { SubagentState } from "../types.js";
import { isActiveSubagentState, renderSubagentsPanel } from "./subagents-panel-render.js";

export { isActiveSubagentState, renderSubagentsPanel } from "./subagents-panel-render.js";

const KEY_UP = "\x1b[A";
const KEY_DOWN = "\x1b[B";
const KEY_LEFT = "\x1b[D";
const KEY_RIGHT = "\x1b[C";
const KEY_ENTER = "\r";
const KEY_ESC = "\x1b";
const KEY_D = "D";
const KEY_D_LOWER = "d";
const KEY_J = "j";
const KEY_K = "k";
const KEY_Y = "y";
const KEY_Y_UPPER = "Y";
const KEY_N = "n";
const KEY_N_UPPER = "N";
const KEY_CTRL_C = "\x03";
const MAX_PANEL_ITEMS = 5;

interface SubagentsPanelArgs {
	theme: Theme;
	onClose: () => void;
	requestRender: () => void;
	onKill: (state: SubagentState) => void | Promise<void>;
	loadTranscript?: (state: SubagentState) => Promise<TranscriptExcerpt>;
}

interface TranscriptCacheEntry {
	lastUpdate: number;
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
		this.loadDetailedTranscript(true);
		this.args.requestRender();
	}

	handleInput(data: string): boolean {
		if (data === KEY_CTRL_C) return false;
		if (this.pendingKillAgentId) return this.handleKillConfirmation(data);
		if (this.states.length === 0) {
			if (data === KEY_ESC || data === KEY_LEFT) this.args.onClose();
			return true;
		}
		if (data === KEY_LEFT || data === KEY_ESC) return this.closeOrBackOut();
		if (this.detailedAgentId) {
			if (data === KEY_D || data === KEY_D_LOWER) this.requestKillSelected();
			return true;
		}
		if (data === KEY_UP || data === KEY_K) return this.moveSelection(-1);
		if (data === KEY_DOWN || data === KEY_J) return this.moveSelection(1);
		if (data === KEY_ENTER || data === KEY_RIGHT) {
			this.drillIntoSelected();
			return true;
		}
		if (data === KEY_D || data === KEY_D_LOWER) {
			this.requestKillSelected();
			return true;
		}
		return true;
	}

	render(width: number): string[] {
		return renderSubagentsPanel({
			states: this.states,
			selectedIdx: this.selectedIdx,
			width,
			theme: this.args.theme,
			scrollOffset: this.scrollOffset,
			detailedAgentId: this.detailedAgentId,
			pendingKillAgentId: this.pendingKillAgentId,
			transcript: this.currentTranscript(),
		});
	}

	invalidate(): void {
		// no cached state
	}

	private handleKillConfirmation(data: string): boolean {
		const agentId = this.pendingKillAgentId;
		if (!agentId) return true;
		if (data === KEY_Y || data === KEY_Y_UPPER) return this.confirmKill(agentId);
		if (data === KEY_N || data === KEY_N_UPPER || data === KEY_ESC) {
			this.pendingKillAgentId = null;
			this.args.requestRender();
		}
		return true;
	}

	private confirmKill(agentId: string): boolean {
		const state = this.states.find((candidate) => candidate.agentId === agentId);
		this.pendingKillAgentId = null;
		if (state && isActiveSubagentState(state)) {
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
		if (!state || !isActiveSubagentState(state)) return;
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
		if (!force && cached?.lastUpdate === state.lastUpdate) return;
		if (cached?.status === "loading") return;
		this.transcripts.set(state.agentId, {
			lastUpdate: state.lastUpdate,
			status: cached?.excerpt ? "ready" : "loading",
			excerpt: cached?.excerpt,
		});
		void this.loadTranscript(state).then(
			(excerpt) => {
				this.transcripts.set(state.agentId, { lastUpdate: state.lastUpdate, status: "ready", excerpt });
				this.args.requestRender();
			},
			() => {
				const excerpt: TranscriptExcerpt = { kind: "unreadable", message: "Transcript unavailable." };
				this.transcripts.set(state.agentId, { lastUpdate: state.lastUpdate, status: "ready", excerpt });
				this.args.requestRender();
			},
		);
	}

	private loadTranscript(state: SubagentState): Promise<TranscriptExcerpt> {
		return this.args.loadTranscript?.(state) ?? readRecentTranscriptExcerpt(state.paths.output);
	}

	private currentTranscript(): TranscriptExcerpt | "loading" | undefined {
		const state = this.states.find((candidate) => candidate.agentId === this.detailedAgentId);
		if (!state) return undefined;
		const cached = this.transcripts.get(state.agentId);
		return cached?.status === "ready" ? cached.excerpt : "loading";
	}

	private ensureSelectionVisible(): void {
		if (this.selectedIdx < this.scrollOffset) this.scrollOffset = this.selectedIdx;
		const bottom = this.scrollOffset + MAX_PANEL_ITEMS - 1;
		if (this.selectedIdx > bottom) this.scrollOffset = this.selectedIdx - MAX_PANEL_ITEMS + 1;
		this.scrollOffset = Math.max(0, this.scrollOffset);
	}
}

function sortStates(states: SubagentState[]): SubagentState[] {
	return [...states].sort((a, b) => {
		const ra = isActiveSubagentState(a) ? 0 : 1;
		const rb = isActiveSubagentState(b) ? 0 : 1;
		if (ra !== rb) return ra - rb;
		return ra === 0 ? a.startedAt - b.startedAt : (b.finishedAt ?? 0) - (a.finishedAt ?? 0);
	});
}
