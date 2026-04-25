# Changelog

## v0.1.0 — 2026-04-25

Initial release.

### Added

- Background-first dispatch (`subagent_dispatch`) with auto-push completion notifications.
- Synchronous wrapper (`subagent_run`) supporting single, parallel (max 8), and chain modes.
- Status/wait/kill tools for tracking and abort.
- Four bundled default agents: `general-purpose`, `explore`, `plan`, `code-reviewer`.
- TUI configuration (`/subagent-config`) for picking provider+model per agent slot.
- `/subagent-install-defaults` to copy bundled agents to user dir.
- `/subagents` interactive tree overlay.
- Auto-show widget above editor; footer status; tree overlay.
- Tmux integration (`window` and `external-session` modes).
- Lifecycle events on `pi.events`: dispatch, start, end, killed, orphaned, detached, config-changed.
- Atomic state persistence with 7-day retention and orphan recovery sweep.

### Known limitations

- No worktree isolation — orchestrate via skill or manual git worktree.
- No resume / re-attach.
- No MCP server config per agent.
- Sub-agents become `detached` if parent pi exits while they run.
