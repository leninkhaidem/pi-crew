# Work Package: WP2 — Split-panel details presentation and responsive panel navigation

## Scope
Implement the approved details presentation on top of WP1's command overlay path. Convert the sub-agent panel from the current list-or-detail flow into a wide split dashboard with agent list/summary on the left and selected details on the right, where selection updates details immediately and Enter opens or focuses a full-width detail view for long task/transcript content. Add a readable narrow-terminal list-to-detail drill-in fallback, preserve the existing detail substance, keep `d kill` with confirmation for killable active agents while proving only the selected agent is targeted, show only implemented key hints, and keep all rendered lines width-safe and themed. The package must also verify the final integrated interaction defaults from WP1 remain intact: `/tasks` and `/subagents` present the same overlay, active-to-empty remains open, Ctrl+C is not overlay close, current-batch-first then start-time sorting remains visible when helpful, and ambient summary/footer hints remain present or intentionally replaced.

## Assigned Slices
### `.planning/pi-crew-tui-improvements/slices/current-state-and-constraints.md`
Must satisfy:
- `CREW-TUI-002` — Apply pi TUI component, theme, Escape/back, and width-safety constraints to the final panel renderer and navigation model.

Context only:
- `CREW-TUI-001` — WP1 owns surface reconciliation; this package must not reintroduce a competing status surface or stale duplicate data.
- `CREW-TUI-003` — WP1 owns interrupt safety; this package must preserve overlay Escape/back handling and avoid Ctrl+C-as-close behavior.

### `.planning/pi-crew-tui-improvements/slices/live-details-access.md`
Must satisfy:
- `DETAILS-ACCESS-001` — Deliver the smallest coherent live monitoring/control presentation/access improvement across the existing widget, footer, and details panel surfaces.
- `DETAILS-ACCESS-002` — Preserve detail content substance while improving presentation and access.
- `DETAILS-ACCESS-005` — Render the approved framed split panel on wide terminals, readable fallback on narrow terminals, implemented key hints only, and `d kill` confirmation.
- `DETAILS-ACCESS-011` — Verify the approved interaction defaults in final integrated form: `/tasks` exact alias, wide auto-details, Enter full-width detail, narrow drill-in, active-to-empty overlay, Ctrl+C unchanged, and current-batch-first sorting.

Context only:
- `DETAILS-ACCESS-003` — WP1 owns editor-surface input safety; this package must preserve safe Escape/back behavior inside the opened panel.
- `DETAILS-ACCESS-004` — WP1 removes ambient Down access; this package must preserve Up/Down list navigation after explicit open.
- `DETAILS-ACCESS-006` — WP1 owns no-shortcut registration; this package must not add or advertise a shortcut.
- `DETAILS-ACCESS-007` — WP1 owns the command overlay mount; this package renders and navigates inside that overlay.
- `DETAILS-ACCESS-008` — WP1 owns active-session filtering/sorting; this package must display the provided order and any helpful non-current labels.
- `DETAILS-ACCESS-009` — WP1 owns interrupt coordination; this package must keep overlay Escape/back non-destructive and not intercept Ctrl+C as close.
- `DETAILS-ACCESS-010` — WP1 owns initial no-active notification; this package owns readable in-overlay empty presentation after active-to-empty updates.

## Primary Paths
- `src/ui/subagents-panel.ts`
- `src/ui/subagents-panel-render.ts`
- `src/ui/overlay.ts`
- `src/ui/footer.ts`
- `src/ui/widget.ts`
- `src/ui/format.ts`
- `src/ui/activity.ts`
- `src/runtime/transcript.ts`
- `test/unit/overlay.test.ts`
- `test/unit/footer.test.ts`
- `test/unit/widget.test.ts`
- `README.md`

## Verification Expectations
- Add or update render tests proving wide terminals show a framed split layout with a left agent list/summary and right selected details pane, and every rendered line is within the supplied width.
- Add or update key-flow tests proving Up/Down selection changes the selected row and auto-updates right-side details in the wide layout without requiring Enter.
- Add or update key-flow/render tests proving Enter opens or focuses a full-width detail view for long task/transcript content, Escape/Left backs out or closes appropriately, and Ctrl+C is not used as overlay close.
- Add or update narrow-width tests proving the panel uses a readable single-column list-to-detail drill-in fallback, keeps Up/Down list navigation, and does not force a corrupt split layout.
- Add or update detail-content tests proving status, alias, model/thinking, cwd, elapsed, usage, task, and recent transcript remain present in substance, transcript text remains sanitized, and untrusted state text cannot inject terminal controls or embedded newlines.
- Add or update hint tests proving only implemented actions are advertised; omit `r refresh` unless a real refresh action is implemented, and do not advertise any new details-opening shortcut.
- Add or update kill-flow tests proving `d kill` remains available only for killable active agents, asks for confirmation identifying the selected agent, aborts only that selected agent, does not abort non-selected active agents or parent/session state, hides or disables the action/hint for non-killable agents, and clears or preserves selection safely after the selected agent exits.
- Add or update integrated overlay tests proving active-to-empty state renders the in-overlay empty state until Escape closes, `/tasks` and `/subagents` still share the same final presentation, current-batch-first then start-time sorting/labels remain comprehensible, ambient active summary/footer hints from WP1 remain present or are intentionally replaced with equivalent implemented wording and stay fresh across overlay display/dismissal cycles and agent start/finish updates, and stopped/recent triage is not included.
- Statically inspect UI text and README changes touched by this package to ensure user-facing wording is audience/domain language and contains no Super Developer planning/package terminology.
- Run `npm test -- test/unit/overlay.test.ts test/unit/footer.test.ts test/unit/widget.test.ts` and `npm run typecheck`, or document an equivalent narrower command only if it exercises the same changed presentation and navigation surfaces.
- Package verification must map each expectation to `VE-<n>` rows and must inspect package scope, assigned Slices, changed code/diff, tests, UI text, width-safety, selected-agent-only destructive behavior, ambient summary/hint preservation, and emergent interactive-UI risks; planner-provided seeds do not limit verifier discovery.

## Proof
- `.tasks/pi-crew-tui-improvements/proofs/WP2.proof.md`

## Package Verification Report
- `.tasks/pi-crew-tui-improvements/reports/WP2.package-verification.md`

## Dependencies
- `WP1`

## Notes
- Semgrep is disabled for this plan; do not require Semgrep setup, scans, helper output, internet, or cloud rule access.
- WP2 is serialized after WP1 to avoid divergent decisions in shared overlay/panel contracts, final hints, Escape/Ctrl+C handling, and `/tasks` compatibility.
