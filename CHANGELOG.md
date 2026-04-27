# Changelog

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
