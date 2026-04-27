# Changelog

## v0.4.0 — 2026-04-27

### Added

- **Background blocking sub-agents via Ctrl+B.** Press Ctrl+B while a blocking sub-agent is running (`subagent_run`, foreground `Agent`) to push it to the background. The parent agent resumes immediately and receives the result via completion notification when the sub-agent finishes.
- New `DetachController` module (`src/runtime/detach.ts`) providing scope-based signaling between TUI keyboard input and blocking tool execution.
- `subagent_run` tasks mode returns mixed completed/backgrounded results when detached mid-batch.
- `subagent_run` chain mode returns completed + backgrounded + abandoned step statuses when detached.
- 22 new unit tests covering the detach controller, tool integration, interrupt handler, concurrency tracking, and completion dispatcher.

### Changed

- Agent tool (`Agent`) now returns full sub-agent output instead of truncating at 1200 chars, matching `subagent_run` behavior and eliminating unnecessary `get_subagent_result` follow-up calls.
- `ExtensionRuntime` interface extended with `detach: DetachController` property.
- Interrupt handler (`src/ui/interrupt.ts`) extended with Ctrl+B key binding.

### Fixed

- Cross-terminal arrow key support for TUI panel navigation.
- Panel height capped to prevent viewport overflow flickering.

## v0.3.0 — 2026-04-27

### Added

- `/subagent-config` now supports an explicit `inherit parent model/thinking` option for every configurable sub-agent slot.
- The below-input `⟳ N running` footer status can be focused and opened with the keyboard when the editor is empty.
- Added an active sub-agent list and transcript-focused details view with metadata, task text, and sanitized recent transcript events.

### Changed

- Inherited sub-agent slots now resolve to the parent provider, model, and thinking level while preserving dispatch-time override precedence.
- Transcript details render recent assistant and tool events in a compact readable form instead of exposing raw JSON payloads.

### Fixed

- Footer/details Escape and Left handling now closes or backs out of the details UI before active-sub-agent abort handling.
- Transcript details omit the duplicated initial task prompt, ignore malformed or partial JSONL lines, and avoid hidden reasoning content.

## v0.2.0 — 2026-04-27

### Added

- `/subagent-config` now exposes the built-in `general-purpose` agent slot alongside `explore`.
- Added a shared pi-crew orchestration tool suppression contract for child sub-agents.
- Added subprocess child marker `PI_CREW_SUPPRESS_SUBAGENT_TOOLS=1` so invoked child processes suppress pi-crew orchestration tools and prompt guidance.

### Changed

- `general-purpose` now honors an explicit configured provider/model/thinking slot when present, while still inheriting the parent model/thinking when unset.
- Session-mode sub-agents filter pi-crew orchestration extensions before binding so child prompts do not advertise nested delegation.

### Fixed

- Invoked sub-agents no longer receive pi-crew orchestration tools (`Agent`, `subagent_dispatch`, `subagent_run`, `subagent_status`, `get_subagent_result`, `steer_subagent`, or `subagent_kill`) by default.
- Nested sub-agent prevention no longer depends on users adding internal pi-crew tool names to agent frontmatter.
- Child sub-agent prompts no longer include the `## pi-crew sub-agents` guidance block when nested delegation tools are suppressed.

### Known limitations

- Nested sub-agent suppression is not an OS sandbox or adversarial security boundary; a child with unrestricted process-launch capability can intentionally start a fresh unmarked `pi` process. Stronger prevention requires a separate parent-controlled capability or sandbox design.

## v0.1.0 — 2026-04-27

Initial release.

### Added

- Claude-style `Agent`, `get_subagent_result`, and `steer_subagent` tools.
- Background `subagent_dispatch` with proactive completion notifications.
- Blocking `subagent_run` supporting single, parallel, and chain modes.
- Two bundled agents: `general-purpose` and `explore`.
- `general-purpose` inherits the parent model/thinking by default; `explore` is configurable.
- Per-call `provider`, `model`, and `thinking` overrides with available-model guidance in the system prompt.
- Simple frontmatter + Markdown agent definitions and `/subagent-agents` management command.
- Session-mode execution with extension/skill resource inheritance, steering, and resume support.
- State, transcript, stderr, and prompt files under `~/.pi/agent/subagents/<sessionId>/<agentId>/`.
- Active above-editor tracker with alias, model, usage, and one-line current activity.
- `/tasks` below-input panel for current-batch active agents with inline details and `d` + confirmation kill.
- Current-batch tracking keyed to user requests.
- Tmux integration (`window` and `external-session` modes).
- Lifecycle events on `pi.events`: dispatch, start, end, killed, orphaned, detached, config-changed.

### Changed

- `explore` is the codebase reconnaissance owner; background `explore` launches are coerced to blocking to avoid duplicate exploration.
- Launch and blocking-result rendering are compact by default while preserving full final outputs for the parent agent.
- `get_subagent_result` is recovery/debug oriented and avoids re-injecting final output that was already delivered or consumed.
- Final outputs are preserved untruncated in proactive completion and primary result paths.
- Public max-turn controls and `subagent_wait` were removed from the LLM-facing workflow.
- `/subagents` was renamed to `/tasks`.

### Fixed

- Active tracker now shows tool/file activity instead of falling back to generic `thinking…` when useful tool context exists.
- `Ctrl+C` aborts all active sub-agents in the current batch.
- First `Esc` warns; second `Esc` within 3 seconds aborts all active sub-agents in the current batch.
- Interrupt cancellation refreshes state from disk before aborting so concurrent multi-agent batches are not partially missed.
- Lowercase `d` works in `/tasks` kill flow.
- Session-mode sub-agents are aborted on parent session shutdown instead of being left as hidden work.
- Compact TUI rendering avoids multiline corruption from task/activity text.

### Known limitations

- No built-in git worktree isolation; orchestrate worktrees manually or via skills.
- `/tasks` is an operational current-batch panel, not a historical transcript browser.
- Raw transcript inspection remains file/tool based for explicit debugging.
