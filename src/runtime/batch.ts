export interface BatchTrackerOptions {
	idFactory?: () => string;
}

interface SessionBatchState {
	currentRequestIndex: number;
	batchRequestIndex: number | null;
	batchId: string | null;
}

export interface BatchTracker {
	noteUserMessage(sessionId: string): void;
	noteTurn(sessionId: string, turnIndex: number): void;
	beginDispatch(sessionId: string): string;
	currentBatchId(sessionId: string): string | null;
}

export function createBatchTracker(options: BatchTrackerOptions = {}): BatchTracker {
	const sessions = new Map<string, SessionBatchState>();
	let sequence = 0;
	const idFactory = options.idFactory ?? (() => `batch-${Date.now()}-${++sequence}`);

	const stateFor = (sessionId: string): SessionBatchState => {
		let state = sessions.get(sessionId);
		if (!state) {
			state = { currentRequestIndex: 0, batchRequestIndex: null, batchId: null };
			sessions.set(sessionId, state);
		}
		return state;
	};

	return {
		noteUserMessage(sessionId) {
			stateFor(sessionId).currentRequestIndex++;
		},
		noteTurn(_sessionId, _turnIndex) {
			// Batches are keyed to user requests, not assistant turns. A single
			// request may dispatch multiple agents across several assistant turns.
		},
		beginDispatch(sessionId) {
			const state = stateFor(sessionId);
			if (state.batchId === null || state.batchRequestIndex !== state.currentRequestIndex) {
				state.batchId = idFactory();
				state.batchRequestIndex = state.currentRequestIndex;
			}
			return state.batchId;
		},
		currentBatchId(sessionId) {
			return stateFor(sessionId).batchId;
		},
	};
}
