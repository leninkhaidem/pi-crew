# Work Package: WP1 — Command overlay access, active-session scope, footer removal, and Escape safety

## Scope
Implement the access and safety shell for live sub-agent details. Add `/subagents` as the primary visible command, route `/tasks` through the exact same handler, and open the details experience as a focused `ctx.ui.custom(..., { overlay: true, ... })` floating overlay when active current-session agents exist. The command path must read current-session state, include all `starting`/`running` agents across batches, prioritize the current batch when available, keep the overlay open with an in-overlay empty state if agents finish after mount, and show the exact info notification without mounting the overlay when no active agents exist at invocation. Remove the ambient footer Down/Enter details focus/open path while retaining the ambient active-agents summary and keeping a concise footer/status hint for `/subagents`, Ctrl+B background, and Esc Esc abort. Coordinate overlay Escape and ambient interrupt handling so overlay Escape closes/backs out before ambient interrupt handling and does not arm double-Escape state; ambient single Escape is non-destructive and consumed when any active current-session agent exists; double Escape refreshes state once, aborts current-batch active agents when present, and falls back to all active current-session agents only when no current-batch active agents match and the warning made that scope clear. Ctrl+B and Ctrl+C semantics are not redesigned, Ctrl+C is not overlay close, overlay resources are cleaned up on close/reopen, and no new details-opening shortcut is registered. Update user-facing docs for the command and cancellation surfaces. Excluded from this package: the final split-panel renderer and narrow/full-detail presentation polish owned by WP2.

## Assigned Slices
### `.planning/pi-crew-tui-improvements/slices/current-state-and-constraints.md`
Must satisfy:
- `CREW-TUI-001` — Reconcile the existing widget, footer, details command path, state watcher, and interrupt surfaces instead of adding a competing live status surface.
- `CREW-TUI-002` — Use pi extension/TUI component APIs, the repo package namespace, themed/width-safe UI surfaces, and cancellable overlay behavior for the access shell.
- `CREW-TUI-003` — Address the known Escape/interrupt risk for live-control changes.

### `.planning/pi-crew-tui-improvements/slices/live-details-access.md`
Must satisfy:
- `DETAILS-ACCESS-003` — Preserve editor input safety for the chosen explicit access path.
- `DETAILS-ACCESS-004` — Remove ambient Down-arrow details access while preserving in-panel list navigation.
- `DETAILS-ACCESS-006` — Keep the first pass command-based with no new global shortcut.
- `DETAILS-ACCESS-007` — Make `/subagents` open a floating overlay through the repo-compatible custom UI overlay API.
- `DETAILS-ACCESS-008` — Default the overlay to all active sub-agents in the current session with current-batch-first ordering.
- `DETAILS-ACCESS-009` — Implement the targeted Escape safety fix without redesigning Ctrl+B or Ctrl+C.
- `DETAILS-ACCESS-010` — Show the exact no-active info notification and avoid mounting an initially empty overlay.

Context only:
- `DETAILS-ACCESS-001` — Overall cohesive live dashboard closure is verified after WP2 adds the final presentation.
- `DETAILS-ACCESS-002` — Detail content preservation is owned by WP2; this package must avoid changing content semantics while wiring access.
- `DETAILS-ACCESS-005` — Final split-panel presentation is owned by WP2; this package supplies the floating command path it uses.
- `DETAILS-ACCESS-011` — Composite interaction defaults are closed by WP2 after this package establishes command aliasing, active-session scope, active-to-empty behavior, and Escape/Ctrl+C boundaries.

## Primary Paths
- `src/index.ts`
- `src/commands/tree.ts`
- `src/ui/overlay.ts`
- `src/ui/footer.ts`
- `src/ui/interrupt.ts`
- `src/ui/state-watcher.ts`
- `src/runtime/types.ts`
- `src/state/store.ts`
- `test/unit/footer.test.ts`
- `test/unit/interrupt.test.ts`
- `test/unit/overlay.test.ts`
- `README.md`
- `docs/bugs/single-escape-kills-subagents.md`

## Verification Expectations
- Add or update targeted tests proving `/subagents` is registered, `/tasks` invokes the same handler and scope, the command path uses `ctx.ui.custom` with `overlay: true`, and the old command path is not below-editor-only.
- Add or update state-filtering tests with current-batch, older-batch, unbatched, starting/running, and terminal states proving the overlay includes all active current-session agents, excludes terminal states, sorts current-batch agents first, sorts other active agents by start time, labels non-current/unbatched agents when needed for clarity, and does not use the old current-batch-only default.
- Add or update command tests proving the exact info notification `No active sub-agents in this session.` is emitted and no overlay is mounted when no active agents exist at invocation.
- Add or update overlay lifecycle tests proving active-to-empty updates keep the already-open overlay mounted with an in-overlay empty state until Escape closes it, killable active agents still use `d kill` confirmation and the shared abort path, and closing/reopening the overlay disposes or unsubscribes watchers/input handlers so closed overlays do not capture input and repeated opens do not create duplicate handlers.
- Add or update footer/widget/state-watcher tests or static inspections proving ambient Down and Enter are not consumed to focus/open pi-crew details from the editor/footer surface, including editor-empty and editor-nonempty cases, while panel-internal Up/Down remains outside this removal; also prove the ambient active-agents summary remains visible or is intentionally replaced, the footer/status hint advertises `/subagents · Ctrl+B background · Esc Esc abort` or an equivalently concise implemented hint, and both ambient surfaces update from the live state-watcher/session-state path without stale counts/status across agent start, finish, overlay open, and overlay close.
- Add or update Escape/interrupt tests reproducing the single-Escape risk: overlay Escape closes/backs out before ambient interrupt handling, does not reach parent abort or sub-agent kill, and does not arm ambient double-Escape state; the next ambient Escape after closing is treated as a first warning; ambient single Escape with any active current-session sub-agent warns with target scope/count and consumes; double Escape within the configured window refreshes state once and aborts current-batch active agents when present, otherwise all active current-session agents only after a matching all-active warning; stale watcher, no-current-batch, missing `batchId`, older-batch, and unbatched active cases are covered; Ctrl+B and Ctrl+C behavior remains unchanged.
- Statically inspect command and input registration to prove no new global shortcut or hidden details-opening key was added, Ctrl+C is not treated as overlay close, overlay Escape cannot be preempted by the ambient interrupt listener, overlay close cleans up listeners/watchers, and user-visible hints advertise `/subagents` rather than a key chord.
- Update README or user-facing docs/hints so `/subagents`, `/tasks` compatibility, live session-wide scope, and cancellation wording are accurate and audience-facing text contains no Super Developer planning/package terminology.
- Run `npm test -- test/unit/footer.test.ts test/unit/interrupt.test.ts test/unit/overlay.test.ts` and `npm run typecheck`, or document an equivalent narrower command only if it exercises the same changed surfaces.
- Package verification must map each expectation to `VE-<n>` rows and must inspect package scope, assigned Slices, changed code/diff, tests, UI text, ambient summary/footer state freshness, and known input-precedence risks; planner-provided seeds do not limit verifier discovery.

## Proof
- `.tasks/pi-crew-tui-improvements/proofs/WP1.proof.md`

## Package Verification Report
- `.tasks/pi-crew-tui-improvements/reports/WP1.package-verification.md`

## Dependencies
- None.

## Notes
- Semgrep is disabled for this plan; do not require Semgrep setup, scans, helper output, internet, or cloud rule access.
- This package is first because it establishes the command, state-scope, footer, and interrupt contracts that the final panel presentation must integrate with.
