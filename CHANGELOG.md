# Changelog

## v0.6.2 — 2026-06-28

### Added

- **Live sub-agent overlay.** `/subagents` now opens a floating, session-wide view of active sub-agents, while `/tasks` remains a compatible alias for the same interface.
- **Responsive detail views.** Wide terminals now show a split list/details layout, and narrow terminals use a readable drill-in details flow with sanitized recent transcript content.

### Changed

- **Explicit sub-agent access.** The footer now advertises `/subagents` instead of relying on an ambient Down-arrow shortcut, keeping details access discoverable without stealing editor navigation.
- **Safer selected-agent controls.** The in-overlay `d kill` action confirms and targets only the selected active sub-agent.

### Fixed

- **Escape and interrupt safety.** Single Escape now warns before aborting active sub-agents, overlay Escape no longer arms ambient aborts, stale state is revalidated before destructive aborts, and Ctrl+C preserves current-batch or session-wide abort scope correctly.

## v0.6.1 — 2026-05-21

### Fixed

- **Timely background completion delivery.** Background and Ctrl+B-detached sub-agent completions now steer their notifications into active orchestrator turns instead of waiting for the parent to finish, so orchestrators receive results without delayed follow-up turns.

### Changed

- **Clearer background orchestration guidance.** Tool descriptions and the pi-crew prompt now tell agents not to poll, sleep, or repeatedly check status after backgrounding because completion notifications are injected automatically.
- **Less misleading result recovery wording.** Result recovery now describes already completed sub-agent results as already handled rather than already delivered when a completion notification was queued or consumed.

## v0.6.0 — 2026-05-19

### Breaking Changes

- **Reworked `subagent_status` history views.** The tool now exposes only `active` and `stopped` listing scopes. Broad `session` and `all` list scopes, plus `includeDetached` list mode, are no longer part of the public status listing contract.

### Added

- **Stopped-agent triage view.** `subagent_status({ scope: "stopped" })` now returns a small, bounded list of problematic terminal agents (`failed`, `orphaned`, `aborted`, `detached`) with compact triage fields and omission/status-count metadata.
- **Recent sanitized result output.** `get_subagent_result({ agent_id, recentEvents })` now returns bounded sanitized recent transcript events in both readable output and structured details without requiring callers to parse JSONL.

### Changed

- **Active status remains uncapped and current-session only.** The default status view lists only `starting` and `running` agents, while successful `done` agents stay retrievable by exact ID rather than appearing in broad history listings.
- **Transcript excerpt bounds.** Recent transcript output is capped by event count and per-event text length, while raw JSONL remains available only through explicit verbose result retrieval.

### Fixed

- **Abort and failure terminal status semantics.** Explicit kills, parent interruptions, max-turn hard aborts, and UI-triggered kills now preserve `aborted` status instead of being misreported as successful completion, while unexpected process failures remain `failed`.

## v0.5.1 — 2026-05-18

### Fixed

- **Sub-agent context overflow recovery.** Session-mode sub-agents now wait for Pi overflow compaction/retry outcomes instead of finalizing early with empty successful output.
- **Accurate overflow failure reporting.** Unrecovered overflow recovery now fails explicitly with context-overflow recovery details, while recovered runs clear stale error stop reasons.
- **Subprocess overflow lifecycle handling.** Subprocess-mode sub-agents now distinguish complete recovery streams from child exits while recovery is still pending.

### Changed

- **Compaction transcript minimization.** Stored compaction events now keep only minimal recovery diagnostics and omit compaction summaries/details and hidden reasoning content.
- **Recovery regression coverage.** Added deterministic session/subprocess coverage for successful recovery, failed recovery, retry-never-starts, abort/dispose, and non-overflow paths.

## v0.5.0 — 2026-04-30

### Breaking Changes

- **Removed the `Agent` tool.** The monolithic `Agent` tool (which combined launching, background/foreground toggle, and session-mode resumption) has been removed entirely. Use `subagent_dispatch` (background), `subagent_run` (blocking/parallel/chain), and the new `subagent_resume` (session-mode resumption) instead.

### Added

- **New `subagent_resume` tool.** A focused tool for resuming session-mode sub-agents. Takes `{ agent_id, prompt }` parameters. Supports optional `provider`, `model`, and `thinking` override parameters (reserved for future use).

### Changed

- **Tool suppression list updated.** `"Agent"` replaced with `"subagent_resume"` in the orchestration tools suppressed from sub-agents.
- **System prompt updated.** Dispatch model section now documents only `subagent_dispatch` and `subagent_run` for launching, with `subagent_resume` listed in the tracking section for session-mode resumption.

## v0.4.5 — 2026-04-29

### Changed

- **Clean transcript output in sub-agent details panel.** Transcript events now show only the content text without role/type prefixes (`tool:`, `assistant:`, `tool result:`, etc.). Tool invocation start events and agent lifecycle events are omitted entirely — only assistant text, tool output, and tool results are displayed.
- **Multi-line support in task and transcript sections.** The task and transcript sections in the sub-agent details panel now preserve newlines instead of collapsing everything to a single line. Long lines are wrapped to fit the panel width.

## v0.4.4 — 2026-04-29

### Fixed

- **Readable status output for multi-line tasks.** `subagent_status` now truncates the task and lastText fields to a single line in the display format, preventing unreadable output when task prompts contain paragraphs, markdown, or multi-line content. Full task text remains available in the structured `details` payload.

## v0.4.3 — 2026-04-29

### Changed

- **Sub-agents get all tools by default.** Frontmatter `tools` field in agent `.md` definitions no longer restricts the tools available to sub-agents at runtime. All sub-agents now have access to every tool (read, write, edit, bash, etc.) except the pi-crew orchestration tools (Agent, subagent_dispatch, subagent_run, subagent_status, get_subagent_result, steer_subagent, subagent_kill), which remain suppressed via three independent layers.

## v0.4.2 — 2026-04-29

### Changed

- **All sub-agents inherit parent model/thinking by default.** Unconfigured agents (e.g., custom project agents, `explore`) now automatically inherit the parent session's model, provider, and thinking effort instead of blocking with a "Configuration required" error. Explicit per-agent config and per-call overrides still take precedence.
- Removed the `"unconfigured"` error state from `SlotResolution`. The only failure mode for agents without explicit config is now `"no_parent_model"` (when no parent model is available to inherit from).
- System prompt no longer shows an "✗ Unconfigured" section — all discovered agents are listed as available.

## v0.4.1 — 2026-04-29

### Fixed

- **Frontmatter parser robustness.** `parseAgentMarkdown` now uses `Record<string, unknown>` instead of `Record<string, string>`, correctly handling YAML values that aren't plain strings.
- Support YAML list syntax for the `tools` field (e.g., `tools:\n  - read\n  - grep`) in addition to comma-separated strings.
- Explicitly coerce `name` and `description` frontmatter values to strings, preventing type mismatches from non-string YAML values.
- Normalize empty `tools` arrays to `null` after filtering, avoiding downstream empty-array edge cases.
- Wrap frontmatter parsing in a try/catch so malformed agent markdown files return `null` instead of crashing the discovery pipeline.

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
