# Conceptualize Index: pi-crew TUI improvements

Workspace: `.planning/pi-crew-tui-improvements/`

## Summary
- User wants to improve the pi TUI for the pi-crew plugin.
- Primary branch: cohesive live sub-agent monitoring/control, especially details presentation and access.
- Repo already has several TUI surfaces for sub-agent tracking, footer navigation, details, config, and interrupts.
- The chosen access direction is explicit details entrypoints with visible hints, and the ambient Down-arrow shortcut should be removed.
- The approved target presentation is a split list/details panel, with narrow-terminal fallback and `/subagents` as the primary visible command while preserving `/tasks` compatibility.
- No dedicated keyboard shortcut should be included in the first pass.
- `/subagents` should open the approved details panel as a floating overlay.
- `/subagents` should show all active sub-agents in the current session by default, with current-batch agents prioritized when useful.
- First pass should include a targeted Escape safety fix: single Escape is non-destructive; double Escape aborts current-batch active agents first, falling back to all active session agents only after a clear warning.
- Empty `/subagents` state should show a simple info notification and not open the overlay.
- Approved preflight defaults: `/tasks` exact alias to `/subagents`, wide selection auto-shows details, Enter opens/focuses full detail, active-to-empty overlay stays open with empty state, Ctrl+C unchanged, current-batch-first sorting.

## Current Direction
- Shape a focused TUI improvement concept for pi-crew around `/subagents`/`/tasks` explicit details access, visible hints, no ambient Down-arrow shortcut, and an approved split-panel details presentation with existing kill control preserved.

## Slices
- `.planning/pi-crew-tui-improvements/slices/current-state-and-constraints.md` — Captures current pi-crew TUI surfaces, upstream pi TUI constraints, and known risk areas that planning must account for.
- `.planning/pi-crew-tui-improvements/slices/live-details-access.md` — Captures the accepted primary branch, approved split-panel overlay design, access rules, scope boundaries, and verification expectations.

## Durable Shared Understanding
- The feature concerns pi-crew's interactive pi TUI experience, not direct implementation yet.
- Primary scope is live sub-agent monitoring/control, especially details presentation/access.
- Current sub-agent detail content is mostly acceptable; the problem is how details are presented and triggered.
- Down-arrow should no longer be used as an ambient footer shortcut for opening/focusing details.
- Approved presentation is a framed split panel with agent list on the left and selected details on the right when width permits; narrow terminals may use a readable single-column fallback; Enter can focus/open full details; `d kill` with confirmation remains available for killable active agents.
- `/subagents` should be the primary visible command; existing `/tasks` should remain compatible unless later changed by user decision.
- No new global keyboard shortcut should be registered for opening details in the first pass.
- `/subagents` should use a floating overlay rather than a below-editor-only panel.
- `/subagents` defaults to a session-wide active-agent view, not current-batch-only filtering.
- Targeted Escape safety is in scope because overlay close behavior and the documented single-Escape bug intersect.
- If no active sub-agents exist at invocation, `/subagents` should notify `No active sub-agents in this session.` and avoid recent/stopped triage; if agents finish while overlay is open, show an in-overlay empty state until Escape closes it.
- Future implementation must fit pi extension/TUI APIs and avoid static console-style UI for interactive flows.

## Research and Source References
- Current pi-crew UI mounts widget/footer/interrupt/state watcher on `session_start` — Source: `src/index.ts`.
- Active sub-agent status is currently split across above-editor widget, footer status/details, `/tasks`, slash tools, config UI, and interrupt handlers — Source: `src/ui/widget.ts`, `src/ui/footer.ts`, `src/ui/subagents-panel.ts`, `src/commands/tree.ts`, `src/ui/overlay.ts`, `src/ui/interrupt.ts`, `src/config/tui.ts`.
- pi TUI APIs require width-safe component rendering, theme callback usage, cancellable custom UI, and built-in widgets where applicable — Source: `/home/lenin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md`.

## Open Questions
- None.

## Planning Handoff
- Conceptualize has enough settled product/design context for implementation planning if the user chooses to proceed.
- Planning must inspect the Slice inventory, especially `CREW-TUI-001`, `CREW-TUI-002`, `CREW-TUI-003`, `DETAILS-ACCESS-001`, `DETAILS-ACCESS-002`, `DETAILS-ACCESS-003`, `DETAILS-ACCESS-004`, `DETAILS-ACCESS-005`, `DETAILS-ACCESS-006`, `DETAILS-ACCESS-007`, `DETAILS-ACCESS-008`, `DETAILS-ACCESS-009`, `DETAILS-ACCESS-010`, and `DETAILS-ACCESS-011`.
