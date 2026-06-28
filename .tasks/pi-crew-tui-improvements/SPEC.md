# pi-crew TUI Improvements Specification

## Overview
Improve pi-crew's live sub-agent TUI by making active sub-agent details explicit, discoverable, and safe to inspect without hidden footer navigation. The first pass centers on a `/subagents` floating overlay, keeps `/tasks` as an exact compatibility alias, removes ambient Down-arrow access, and preserves deliberate sub-agent cancellation semantics with a targeted Escape safety fix.

## Conceptualize Inputs
- Index: `.planning/pi-crew-tui-improvements/index.md`

## Authoritative Slices
- `.planning/pi-crew-tui-improvements/slices/current-state-and-constraints.md`
- `.planning/pi-crew-tui-improvements/slices/live-details-access.md`

## Requirements
- REQ-1: Add `/subagents` as the primary visible live sub-agent details command, and keep `/tasks` as an exact compatibility alias to the same overlay path and active-session scope.
- REQ-2: `/subagents` and `/tasks` must open a framed floating overlay through the repo-compatible `ctx.ui.custom(..., { overlay: true, ... })` API when active sub-agents exist; the command path must not be below-editor-only.
- REQ-3: When invoked with no active current-session sub-agents, the command must notify info with `No active sub-agents in this session.` and must not mount the overlay.
- REQ-4: The overlay must list all current-session active sub-agents with `starting` or `running` status, not just the current batch; current-batch agents sort first, then other active session agents by start time, with non-current or unbatched labels when needed to make destructive scope and origin understandable.
- REQ-5: If all active agents finish while the overlay is already open, the overlay remains open and shows an in-overlay empty state until Escape closes it.
- REQ-6: Wide terminals must show a split live dashboard with agent list/summary on the left and selected details on the right; selecting a row auto-updates details, and Enter opens or focuses a full-width detail view for long task/transcript content.
- REQ-7: Narrow terminals must use a readable single-column list-to-detail drill-in fallback rather than forcing an unreadable split layout.
- REQ-8: The detail substance must be preserved: status, alias, model/thinking, cwd, elapsed, usage, task, and recent transcript.
- REQ-9: Preserve `d kill` with confirmation for killable active agents, and show key hints only for implemented actions.
- REQ-10: Remove the ambient footer Down-arrow details focus/open shortcut; Down remains normal editor navigation and remains list navigation inside an explicitly opened panel.
- REQ-11: Do not add a new global keyboard shortcut for opening sub-agent details in this first pass; visible hints should advertise `/subagents`, not a key chord.
- REQ-12: Escape behavior must be non-destructive on a single press: overlay Escape closes or backs out without propagating to parent abort or arming ambient double-Escape state; ambient single Escape with any active current-session sub-agent warns with target scope/count and is consumed; double Escape refreshes state once, aborts current-batch active agents when present, and falls back to all active current-session agents only when no current-batch active agents match.
- REQ-13: Ctrl+B backgrounding and Ctrl+C interrupt behavior are not redesigned; Ctrl+C is not an overlay close key.
- REQ-14: Update README or user-facing docs/hints that describe `/tasks`, `/subagents`, Down-arrow details access, or cancellation semantics so they are not stale.
- REQ-15: Preserve or intentionally replace the ambient active-agents summary and footer/status hint; the first-pass default is to retain the above-editor running-agents summary and advertise `/subagents · Ctrl+B background · Esc Esc abort` or an equivalently concise, implemented hint, with updates driven by the live state-watcher/session-state path so counts/status do not go stale across agent start, finish, overlay open, or overlay close.
- REQ-16: Overlay lifecycle must dispose or unsubscribe watchers/input handlers on close, must not capture input after close, and must support repeated open/close without duplicate listeners or stale destructive handlers.

## Acceptance Criteria
- AC-1: Given active sub-agents in the current session, when the user runs `/subagents`, then a focused floating overlay opens via the custom overlay API with the approved live details experience.
- AC-2: Given the same active state, when the user runs `/tasks`, then the same command path, scope, presentation, and kill behavior are used as `/subagents`.
- AC-3: Given no active sub-agents, when `/subagents` or `/tasks` is invoked, then the exact info notification is shown and no overlay is mounted.
- AC-4: Given active agents from multiple batches in the current session, the overlay includes all `starting`/`running` agents, sorts current-batch agents first and other active agents by start time, labels non-current/unbatched agents when needed for clarity, excludes terminal states, and avoids the old current-batch-only default.
- AC-5: Given a wide terminal, row selection updates the right detail pane without requiring Enter; Enter opens or focuses a full-width detail view.
- AC-6: Given a narrow terminal, the panel remains width-safe and uses list-to-detail drill-in instead of a corrupt split layout.
- AC-7: Given the normal editor/footer surface, pressing Down is not consumed by pi-crew and does not focus or open sub-agent details.
- AC-8: Given an opened overlay or panel, Up/Down navigation still works inside the list, and `d` kill asks for confirmation before aborting a killable active agent.
- AC-9: Given active sub-agents, a single ambient Escape warns with target scope/count and consumes the key; a second Escape within the configured window refreshes state once and aborts current-batch active agents when present, otherwise all active current-session agents; Ctrl+B/Ctrl+C behavior remains as before.
- AC-10: Given the overlay is open, Escape closes or backs out of the overlay before ambient interrupt handling, does not arm ambient double-Escape state, and does not trigger parent abort or sub-agent kill; Ctrl+C remains interrupt behavior rather than closing the overlay.
- AC-11: Given the overlay is closed and opened repeatedly, watcher/input resources are cleaned up on close, closed overlays do not capture input, and repeated opens do not create duplicate handlers.
- AC-12: Render and key-flow tests cover wide split, narrow fallback, full-width detail focus, active-to-empty updates, empty invocation notification, command aliases, footer Down removal, ambient summary/hints, ordering/labels, selected-agent-only kill behavior, overlay cleanup/reopen, and Escape safety.
- AC-13: Given agents start, finish, or the overlay opens/closes, the ambient active-agents summary/footer hint updates from the live state-watcher/session-state path and does not retain stale counts/status or duplicate competing status surfaces.

## Constraints
- Use pi extension/TUI APIs and the repo's configured `@mariozechner/...` package namespace unless implementation evidence proves a namespace change is required.
- Interactive TUI work must use themed component APIs, cancellable Escape/back paths, and width-safe rendering with `visibleWidth`, `truncateToWidth`, or equivalent; do not replace the interactive flow with static console output.
- The slash-command overlay path must use `ctx.ui.custom(..., { overlay: true, ... })` or the repo-compatible equivalent, not only `setWidget(..., { placement: "belowEditor" })`.
- Semgrep is disabled by user decision for this plan; packages must not require Semgrep setup, scans, scan evidence, helper output, internet, or cloud rule access.
- Preserve current detail data/content except for layout and navigation restructuring needed by the approved presentation.
- Do not broaden this work into config/setup TUI polish, stopped/recent triage, broad execution semantic changes, new global shortcuts, or a Ctrl+B/Ctrl+C redesign.
- Destructive `d kill` and double-Escape behavior must target only the selected/declared agents; plans and verification must prove non-selected active agents and parent/session state are not accidentally aborted.

## Work Packages
- `.tasks/pi-crew-tui-improvements/packages/WP1.md` — Command overlay access, active-session scope, footer removal, and Escape safety
- `.tasks/pi-crew-tui-improvements/packages/WP2.md` — Split-panel details presentation and responsive panel navigation

## Code References
- `src/index.ts` — extension entrypoint registering commands and mounting widget, footer, interrupt handler, and state watcher.
- `src/commands/tree.ts` — current `/tasks` command registration and kill wiring.
- `src/ui/overlay.ts` — current below-editor current-batch panel command path and active-state filtering.
- `src/ui/footer.ts` — current footer status and ambient Down/Enter details access path.
- `src/ui/interrupt.ts` — current Ctrl+B, Ctrl+C, and double-Escape handling.
- `src/ui/subagents-panel.ts` — current interactive list/detail panel, transcript loading, and key handling.
- `src/ui/subagents-panel-render.ts` — current panel renderer, detail content, key hints, width handling, and active-state filtering.
- `src/ui/widget.ts` — ambient above-editor active sub-agent summary surface.
- `src/ui/state-watcher.ts` — file-backed live state refresh flow.
- `test/unit/footer.test.ts` — current tests asserting the Down/Enter footer path that must be inverted or removed.
- `test/unit/overlay.test.ts` — current tests for current-batch filtering, panel rendering, and kill behavior.
- `test/unit/interrupt.test.ts` — current tests for Ctrl+C and double-Escape behavior.
- `README.md` — user-visible slash command and cancellation documentation that may be stale.
- `docs/bugs/single-escape-kills-subagents.md` — documented single-Escape bug and input-listener precedence risk.

## Out of Scope
- Config/setup TUI polish is deferred by approved feature scope.
- Recent stopped/problem-agent triage is deferred by approved feature scope; `/subagents` remains a live active-agent dashboard in this first pass.
- Broad sub-agent execution semantic changes are out of scope except the targeted Escape safety fix.
- New global keyboard shortcuts for opening details are deferred by approved user decision for the first pass.
- Ctrl+B and Ctrl+C redesign is out of scope; Ctrl+C remains interrupt behavior.
