# Background Blocking Sub-Agents Specification

## Overview
Allow users to push currently-blocking sub-agents to the background via a keyboard shortcut, freeing the parent agent to continue conversation while the sub-agents finish asynchronously and deliver results via the existing completion notification path.

## Requirements
- REQ-1: When one or more blocking sub-agent tool calls are in progress, the user can press a keyboard shortcut to detach them and return control to the parent agent.
- REQ-2: Detached sub-agent processes continue running uninterrupted — only the parent's blocking await is released.
- REQ-3: When a detached sub-agent completes, the parent agent receives a completion notification via the existing `CompletionDispatcher` path (same as `subagent_dispatch`).
- REQ-4: The blocking tool returns an informative result to the LLM indicating the sub-agents were backgrounded and that results will arrive via notification.
- REQ-5: For `subagent_run` with `tasks: [...]`, all in-flight sub-agents in the batch are backgrounded together.
- REQ-6: For `subagent_run` with `chain: [...]`, only the currently-running step is backgrounded; remaining chain steps are abandoned.
- REQ-7: Concurrency tracking (`ActiveCounter`) must remain accurate — resources are released when sub-agents actually complete, not when they are detached.
- REQ-8: The keyboard shortcut must not conflict with existing Ctrl+C (kill) or double-Escape (kill with warning) bindings.

## Acceptance Criteria
- AC-1: Given a blocking `subagent_run` or foreground `Agent` call in progress, when the user presses the configured keyboard shortcut, then the parent agent's tool call resolves immediately with a "backgrounded" result.
- AC-2: Given a backgrounded sub-agent, when it completes, then a completion notification is injected into the parent conversation and triggers a new turn.
- AC-3: Given a backgrounded sub-agent, its process continues running and produces the same output as if it had never been detached.
- AC-4: Given a `subagent_run` with `tasks: [...]` where 3 of 4 sub-agents are still running, when the user backgrounds them, then all 3 running sub-agents are detached and the tool returns results for the 1 completed plus "backgrounded" status for the 3 in-flight.
- AC-5: Given a `subagent_run` with `chain: [...]` on step 2 of 4, when the user backgrounds, then step 2 is detached, steps 3-4 are abandoned, and the tool returns results for step 1 (done) plus "backgrounded" for step 2.
- AC-6: The `ActiveCounter` current count remains correct after detaching and after the detached sub-agent eventually completes.
- AC-7: The TUI active agents widget continues to display backgrounded sub-agents as running until they complete.

## Constraints
- Must work within the existing Pi extension API — specifically `onTerminalInput` for key interception and `sendMessage` with `deliverAs: "followUp"` for notifications.
- Must not require changes to the Pi framework (`@mariozechner/pi-coding-agent`); all changes are within pi-crew.
- The detach mechanism must be per-batch — only sub-agents from the current blocking call are affected, not unrelated background sub-agents.

## Code References
- `src/tools/run.ts`: Blocking `subagent_run` tool — the `oneShot` function awaits `handle.donePromise`.
- `src/tools/agent.ts`: Foreground `Agent` tool — awaits `handle.donePromise`.
- `src/ui/interrupt.ts`: Existing Ctrl+C and double-Escape key handlers.
- `src/notify/batcher.ts`: `CompletionDispatcher` — batches and injects background completion notifications.
- `src/runtime/concurrency.ts`: `ActiveCounter` and `PoolLimiter` for concurrency tracking.
- `src/runtime/types.ts`: `ExtensionRuntime` interface.
- `src/types.ts`: `SubagentState` and `DispatchHandle` types.
- `src/index.ts`: Extension entry point — wires tools, interrupt handler, and completion dispatcher.

## Out of Scope
- Changing the Pi framework's tool execution model.
- Backgrounding sub-agents that were already dispatched as background (`subagent_dispatch`).
- Automatic backgrounding (e.g., based on timeout) — this is user-initiated only.
- Re-foregrounding a backgrounded sub-agent (once backgrounded, it stays background).
