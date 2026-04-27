# Bug: Single Escape Kills Sub-Agents Instead of Showing Warning

**Status:** Open  
**Severity:** Medium  
**Reported:** 2026-04-27  

## Symptoms

When a blocking sub-agent is running, pressing Escape **once** terminates the sub-agent immediately. The expected behaviour is that a single Escape shows a warning *"Press Escape again within 3s to abort active sub-agents"*, and only a **double Escape** (within 3s) actually kills them.

## Expected Behaviour

1. Single Escape → warning notification, sub-agents continue running
2. Double Escape within 3s → sub-agents killed

## Actual Behaviour

1. Single Escape → sub-agents killed immediately (no warning shown)

## Root Cause Analysis

### TUI Input Pipeline

The pi-tui input pipeline processes key events in this order:

1. **`inputListeners` Set** — all registered listeners run in insertion order; if any returns `{ consume: true }`, processing stops.
2. **`focusedComponent.handleInput`** — editor's key handler runs only if no listener consumed the key.

Pi-crew registers its interrupt handler via `onTerminalInput` → `addInputListener`. The editor's `onEscape` is **not** an `inputListener` — it is called from `focusedComponent.handleInput`, which runs **after** all listeners. So pi-crew's handler fires first.

### The Likely Bug: Batch ID Mismatch

Pi-crew's escape handler calls `currentBatchActiveStates(latestStates, batchId)`, which filters active sub-agents **by batch ID**:

```ts
// src/ui/interrupt.ts
if (matchesKey(data, Key.escape)) {
    const targets = currentBatchActiveStates(latestStates, args.getBatchId());
    if (targets.length === 0) return undefined;  // ← passes through if no targets found!
    // ...show warning...
    return { consume: true };
}
```

If `targets.length === 0` (no sub-agents match the current batch), the handler returns `undefined` — the escape is **not consumed**. It then falls through to the editor's `onEscape`, which during streaming calls:

```js
// pi-coding-agent: interactive-mode.js
if (this.session.isStreaming) {
    this.restoreQueuedMessagesToEditor({ abort: true });
    // calls this.agent.abort() → fires parent AbortSignal
}
```

The parent AbortSignal fires → pi-crew's `parentAbortTracker` picks it up → kills all tracked sub-agents.

### Why Batch ID Might Not Match

`getBatchId()` returns `rt.getCurrentBatchId(ctx)` from `src/runtime/batch.ts`. The batch ID is set at dispatch time and advanced on each new user message. If:
- The state watcher hasn't updated `latestStates` yet (async FS watch with 1s polling fallback)
- The sub-agent state file doesn't have a `batchId` field yet (written after dispatch, state may be stale)
- The batch tracker's `currentBatchId()` returns `null` and sub-agents do have a batchId (so the filter returns only unscoped agents, which are none)

...then `currentBatchActiveStates()` returns an empty array, the escape is not consumed, and it reaches the editor.

## Files Involved

- `src/ui/interrupt.ts` — escape key handler and batch filtering
- `src/runtime/batch.ts` — batch ID tracking
- `src/ui/state-watcher.ts` — async state updates (potential timing issue)
- `pi-coding-agent: interactive-mode.js:1893` — editor `onEscape` that calls `agent.abort()`
- `src/runtime/parent-abort.ts` — parent abort → sub-agent kill propagation

## Suggested Investigation

1. Add logging to confirm whether `currentBatchActiveStates()` is returning an empty array on first Escape.
2. Check if `latestStates` is populated at the time the escape fires (state watcher timing).
3. Check if `getBatchId()` returns `null` when sub-agents are running (batch tracker state).
4. Consider making the escape handler fall back to **any** active sub-agent (not just current batch) when the current batch has no matches.

## Suggested Fix (Candidate)

In `src/ui/interrupt.ts`, if the batch-filtered list is empty but there **are** active sub-agents globally, still consume the escape and show the warning:

```ts
if (matchesKey(data, Key.escape)) {
    const batchTargets = currentBatchActiveStates(latestStates, args.getBatchId());
    const anyActive = latestStates.filter(isActiveState);
    const targets = batchTargets.length > 0 ? batchTargets : anyActive;
    if (targets.length === 0) return undefined;
    // ... rest unchanged
}
```

This prevents the escape from reaching the editor's abort handler whenever **any** sub-agent is active.

## Notes

- Ctrl+C works correctly because it calls `agent.abort()` directly (same as editor escape) and pi-crew's Ctrl+C handler consumes it when sub-agents are present.
- The double-Escape window is 3000ms (`doubleEscapeMs` default).
- This bug does not affect the Ctrl+B background feature (which has no fallback issue).
