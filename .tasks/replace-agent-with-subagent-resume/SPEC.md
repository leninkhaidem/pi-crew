# Replace Agent Tool with Dedicated subagent_resume Specification

## Overview
Remove the `Agent` tool entirely and introduce a focused `subagent_resume` tool that handles session-mode agent resumption. The `run_in_background` toggle previously offered by `Agent` is already covered by choosing between `subagent_run` (blocking) and `subagent_dispatch` (background).

## Requirements
- REQ-1: Create a new `subagent_resume` tool that resumes a session-mode sub-agent by ID, injecting a new task/prompt.
- REQ-2: Remove the `Agent` tool registration, implementation file, and all references from the codebase.
- REQ-3: Update the system prompt to remove `Agent` references and document `subagent_resume` in the dispatch model section.
- REQ-4: Update the tool suppression list to replace `"Agent"` with `"subagent_resume"`.
- REQ-5: Update or remove tests that reference `Agent` or `registerAgentTool`, replacing them with equivalent coverage for `subagent_resume`.

## Acceptance Criteria
- AC-1: `subagent_resume` tool is callable with `{ agent_id, prompt }` parameters plus optional `provider`, `model`, and `thinking` overrides, acquires concurrency, calls `rt.resumeHandle`, and returns the resumed state or an error.
- AC-2: The `Agent` tool no longer exists — the file `src/tools/agent.ts` is deleted, its import/registration in `src/index.ts` is removed.
- AC-3: The system prompt mentions `subagent_resume` for session-mode resumption instead of `Agent`.
- AC-4: The tool suppression array in `src/runtime/tool-suppression.ts` includes `"subagent_resume"` and no longer includes `"Agent"`.
- AC-5: All existing tests pass after migration (`npm test` exits 0).
- AC-6: The explore-blocking behavior is unaffected — `subagent_run` and `subagent_dispatch` still force-block for explore agents, and this is tested.

## Constraints
- The `subagent_resume` tool must follow the same concurrency/semaphore pattern used by the other tools (`rt.concurrency.active.tryAcquire()`).
- The tool must consume the completion notification via `rt.consumeCompletion` before returning the final state.
- Parameters should include `provider`, `model`, and `thinking` overrides for consistency with other tools (future-proofing), even though `resumeHandle` currently does not use them.

## Code References
- `src/tools/agent.ts`: Current Agent tool implementation with resume logic to extract.
- `src/tools/dispatch.ts`: Pattern to follow for tool registration structure.
- `src/tools/steer.ts`: Similar focused session-mode tool (resume is analogous to steer).
- `src/runtime/types.ts`: `ExtensionRuntime.resumeHandle` interface method.
- `src/index.ts`: Tool registration site (lines 204-210) and `resumeHandle` implementation (line 173).
- `src/runtime/tool-suppression.ts`: Suppression list to update.
- `src/system-prompt.ts`: System prompt generation to update.
- `test/unit/tool-schema.test.ts`: Tests referencing `registerAgentTool` and `"Agent"`.
- `test/unit/explore-blocking.test.ts`: Tests referencing `registerAgentTool`.
- `test/unit/detach.test.ts`: Tests referencing `registerAgentTool`.
- `test/unit/session-lifecycle.test.ts`: Tests referencing `"Agent"` in tool name lists.

## Out of Scope
- Changing the `subagent_run` or `subagent_dispatch` tools themselves.
- Adding resume capability to `subagent_run` (only the dedicated tool handles this).
- Modifying session-mode lifecycle internals (`rt.resumeHandle` stays as-is).
- Changes to the `steer_subagent` tool.
