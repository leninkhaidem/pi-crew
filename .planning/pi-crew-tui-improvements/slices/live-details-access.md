# Slice: Live Details Access and Presentation

## Purpose
- Capture the chosen primary improvement branch: a cohesive live sub-agent TUI experience with emphasis on how details are presented and accessed.

## Shared Understanding

### DETAILS-ACCESS-001 — Primary branch is cohesive live sub-agent monitoring/control
The user accepted the recommendation to focus the first planning pass on a cohesive live sub-agent dashboard/control experience rather than starting with config-only polish or result-only triage.

The improvement should concentrate on the live running-agents experience: discoverability, presentation, and access to sub-agent details. This includes the relationship between the above-editor active widget, footer status, below-editor details panel, and keyboard access.

Implementation-shaping constraint: this is not yet authorization for a broad rewrite. Planning should identify the smallest coherent presentation/access change that makes live sub-agent details easier to discover and use.

Verification expectations:
- The plan should include before/after UX sketches or explicit interaction flow for accessing live sub-agent details.
- The plan should state how the new/changed surface relates to existing `mountWidget`, `mountFooter`, and `SubagentsPanel` behavior.

### DETAILS-ACCESS-002 — Details content is mostly acceptable; presentation/access is the problem
The user explicitly said the current information shown in sub-agent details is fine. The problem to solve is the presentation layer and how users access those details.

Current access paths: when active sub-agents exist and the editor is empty, Down focuses the footer status (`▸ ⟳ N running`), then Enter opens the below-editor details panel; `/tasks` can also open the current-batch active panel. The hidden Down-then-Enter interaction should not be treated as final without further design discussion, and `/tasks` may need to become more discoverable or be complemented by a better trigger.

Product boundary:
- Preserve the useful detail content unless a specific display/layout improvement requires restructuring it.
- Focus discovery and presentation: how the details panel is surfaced, framed, positioned, hinted, navigated, and visually related to running-agent status.
- Do not expand scope into changing sub-agent execution semantics merely because the panel is being touched.

Chosen access direction: use an explicit details panel entrypoint with visible hints. `/tasks` can remain or gain a clearer alias/rename, a dedicated shortcut can be considered, and the footer/widget should advertise how to open details. The current hidden Down-arrow path should not remain the primary or secondary shortcut.

### DETAILS-ACCESS-003 — Presentation options must respect active editor input
The current Down-arrow access is gated on an empty editor, which protects normal editing but also hides the feature. Any replacement or augmentation must preserve a safe editing experience: users should not accidentally open/focus the sub-agent panel while navigating or editing prompt text.

Implementation-shaping considerations:
- If using arrow keys, behavior must be obvious and must not steal normal editor navigation when the editor has content.
- If using a shortcut, it should be discoverable in hints/status and avoid conflicting with core pi defaults.
- If using an overlay, it should be cancellable with Escape/back, framed, width-safe, and avoid obscuring critical active-session context more than necessary.

Verification expectations:
- Tests should cover editor-empty and editor-nonempty behavior for whichever access path is chosen.
- Tests should prove Escape/back closes details presentation without unintentionally aborting sub-agents.

### DETAILS-ACCESS-004 — Remove Down-arrow shortcut for opening details
The user explicitly wants to remove the Down-arrow shortcut/path for sub-agent details. Down should remain normal editor/list navigation, not an ambient footer shortcut for focusing or opening pi-crew details.

Implementation-shaping detail:
- Current `mountFooter(...)` intercepts Down when active sub-agents exist and the editor is empty, then Enter opens the below-editor details panel. This behavior should be removed or replaced so Down no longer acts as the details discovery/open trigger from the normal editor surface.
- Up/Down navigation inside an already-open `SubagentsPanel` remains appropriate list navigation; the removal applies to the ambient footer shortcut, not list navigation within the panel.
- Details access should move to explicit entrypoints with visible hints, such as a slash command/alias and possibly a dedicated shortcut after conflict review.

**Interface contract**
- Must exist: no ambient Down-arrow shortcut from the editor/footer surface opens or focuses sub-agent details.
- Consumer: users typing or navigating in the pi editor while pi-crew is active.
- Exact interface: remove or disable the `mountFooter` Down-key focus/open path; keep Down only for normal editor behavior and in-panel list navigation after the panel is explicitly opened.
- Forbidden behaviors: do not consume Down globally to focus pi-crew status; do not require a hidden Down→Enter sequence to reach details; do not break Up/Down selection inside the opened `SubagentsPanel`.
- Expected evidence: tests around `mountFooter`/terminal input showing Down is not consumed for ambient details access, plus tests showing panel-internal Up/Down still work.
- Non-compliance: pressing Down from the normal editor/footer surface still focuses or opens pi-crew details, or removing the shortcut also breaks list navigation inside the details panel.

### DETAILS-ACCESS-005 — Approved split-panel details presentation mock
The approved target presentation is a more explicit live sub-agent details experience with:

- Ambient running-agents summary remains visible while agents are active.
- Footer/status hint advertises explicit access and safety controls, e.g. `/subagents · Ctrl+B background · Esc Esc abort`.
- Opening details shows a framed split panel: agent list/summary on the left, selected agent details on the right.
- Existing detail content is preserved in substance: status, alias, model/thinking, cwd, elapsed, usage, task, recent transcript.
- Narrow terminals may fall back to a single-column list → detail drill-in rather than forcing an unreadable split layout.
- The panel must preserve the approved `d kill` control with confirmation when active agents can be killed, consistent with existing `/tasks` panel behavior.
- The panel must only show key hints for implemented actions; if a manual refresh action is not implemented, omit `r refresh` from the final hint text.

Approved ASCII target sketch:

```text
Ambient state while agents are running
────────────────────────────────────────────────────────────
● Agents
├─ ⠹ ui-polish   (general-purpose) · gpt-5.5 · ⟳2 · 38s
│  ⎿ reading src/ui/footer.ts
└─ ⠴ tests       (general-purpose) · gpt-5.4-mini · ⟳1 · 12s
   ⎿ running vitest

You: improve the details panel_
────────────────────────────────────────────────────────────
⟳ 2 sub-agents running · /subagents · Ctrl+B background · Esc Esc abort
```

```text
╭─ pi-crew sub-agents ─────────────────────────────────────────────────────╮
│ 2 running · current session                                               │
│ ↑↓ select · enter expand · d kill · r refresh · esc close                 │
├─ agents ───────────────────────┬─ details ────────────────────────────────┤
│ ▸ ⠹ ui-polish                  │ status    running                         │
│   general-purpose · 38s         │ alias     ui-polish                       │
│   reading src/ui/footer.ts      │ model     openai-codex/gpt-5.5 · high     │
│                                │ cwd       /home/lenin/work-repos/pi-crew  │
│   ⠴ tests                      │ elapsed   38s                              │
│   general-purpose · 12s         │ usage     14k ctx · $0.03                 │
│   running vitest               ├─ task ────────────────────────────────────┤
│                                │ Improve the pi-crew TUI details access...  │
│                                ├─ recent transcript ───────────────────────┤
│                                │ assistant: inspected footer.ts             │
│                                │ tool: read src/ui/subagents-panel.ts       │
╰────────────────────────────────┴──────────────────────────────────────────╯
```

**Interface contract**
- Must exist: an explicit details entrypoint opens the approved split-panel presentation when sub-agents are active.
- Consumer: pi-crew users in TUI mode who need to inspect active sub-agent details without discovering hidden key paths.
- Exact interface: primary visible command should be `/subagents`; existing `/tasks` should remain as a backward-compatible alias unless the user later approves removing it; the details panel must render as a framed split list/details view when width permits and a readable fallback when width does not; `d kill` remains available with confirmation for killable active agents.
- Forbidden behaviors: do not require ambient Down-arrow access; do not remove `/tasks` compatibility without explicit approval; do not display unimplemented key hints; do not force a split layout at terminal widths where it would corrupt or obscure content; do not remove the existing kill affordance without an explicit user decision.
- Expected evidence: command registration/alias tests, render snapshots or string assertions for wide and narrow panel layouts, and key-flow tests for opening/closing/selecting details and kill confirmation.
- Non-compliance: details can only be opened through hidden Down/Enter behavior, `/subagents` is absent, `/tasks` breaks unexpectedly, wide layout is not split, narrow layout is unreadable, or killable agents cannot be killed from the panel despite the approved `d kill` affordance.

### DETAILS-ACCESS-006 — No dedicated keyboard shortcut in the first pass
The user chose not to include a dedicated keyboard shortcut in the first version. Access should rely on explicit slash command entrypoints and visible hints:

- `/subagents` is the primary visible command.
- Existing `/tasks` remains a compatibility alias unless later changed by user decision.
- Footer/widget hints should advertise `/subagents` rather than a key chord.
- A shortcut can be reconsidered later, but should not be bundled into the first implementation plan.

**Interface contract**
- Must exist: first-pass implementation has no new global keyboard shortcut for opening sub-agent details.
- Consumer: pi-crew users and pi keybinding space.
- Exact interface: command-based access via `/subagents` and compatible `/tasks`; no new `pi.registerShortcut(...)` entry for the details panel in the first-pass scope.
- Forbidden behaviors: do not add a hidden or undocumented shortcut; do not show a shortcut in footer/panel hints; do not remove command access in favor of a shortcut.
- Expected evidence: command registration evidence and absence of a new details-panel `registerShortcut` in changed code; render/hint assertions show command text rather than a key chord.
- Non-compliance: implementation registers a new global shortcut for the details panel, advertises a shortcut, or lacks command-based access.

### DETAILS-ACCESS-007 — `/subagents` opens a floating overlay
The user chose a floating overlay for the command-opened details panel, rather than a below-editor pinned panel.

Implementation-shaping detail:
- `/subagents` should open a framed, focused overlay using pi's custom UI/overlay surface when available.
- Escape closes the overlay; it must not kill sub-agents or trap focus.
- The overlay should implement the approved split list/details presentation on adequate widths and a readable narrow fallback.
- Existing `/tasks` command compatibility should remain by routing to the same command-opened details experience unless a later user decision explicitly changes or removes it.

**Interface contract**
- Must exist: `/subagents` opens the details panel as a floating overlay in TUI mode.
- Consumer: users inspecting active sub-agents from pi's TUI.
- Exact interface: use `ctx.ui.custom(..., { overlay: true, ... })` or the repo-compatible equivalent overlay API for the `/subagents` command path; close via Escape/back through the component's close/done path.
- Forbidden behaviors: do not implement `/subagents` as only a below-editor `setWidget`; do not leave focus trapped; do not let Escape from the overlay propagate into sub-agent abort behavior; do not remove `/tasks` compatibility without explicit approval.
- Expected evidence: command handler opens an overlay API path, overlay close/key-flow tests, and render tests for wide/narrow layouts.
- Non-compliance: `/subagents` only pins below the editor, Escape kills/backgrounds agents instead of closing, or the overlay cannot be closed cleanly.

### DETAILS-ACCESS-008 — Overlay shows all active sub-agents in the current session
The `/subagents` overlay should show all active sub-agents in the current session by default, not only the current prompt/batch. Active means sub-agent states that are currently `starting` or `running` unless later implementation evidence shows another status is needed for actively executing detached/background work.

Implementation-shaping detail:
- Current-batch agents should be sorted or visually prioritized first when that context is available.
- Older/background active sub-agents from the same session should still remain visible so the overlay acts as a true live dashboard.
- If batch/detached/background status matters for comprehension, label it in the list/detail metadata rather than hiding those agents.
- This is a deliberate divergence from the existing `/tasks` implementation, which filters to current-batch active states.

**Interface contract**
- Must exist: `/subagents` defaults to a session-wide active-agent view.
- Consumer: users monitoring multiple active sub-agents launched during the same pi session.
- Exact interface: read/list states from the current session directory and include `status === "starting" || status === "running"` regardless of `batchId`; sort current `batchId` matches first when `batchId` is known.
- Forbidden behaviors: do not filter `/subagents` down to only `batchId === currentBatchId`; do not hide older active session agents; do not include completed/failed/stopped agents in the default active dashboard unless a separate future filter is approved.
- Expected evidence: state-filtering tests with multiple batch IDs, render tests showing multiple active agents, and source evidence that `/subagents` does not use the old current-batch-only filter as its default.
- Non-compliance: an active sub-agent from the same session is absent solely because its `batchId` differs from the current batch, or completed/stopped agents appear in the default active dashboard.

### DETAILS-ACCESS-009 — Include targeted Escape safety fix
The first pass should include a targeted Escape safety fix because the approved overlay requires Escape to close safely and the repo documents a bug where single Escape may kill active sub-agents.

Implementation-shaping detail:
- When the `/subagents` overlay is open, Escape should close the overlay/back out of panel state and must not propagate to ambient sub-agent interrupt/abort behavior.
- Outside the overlay, a single ambient Escape should warn and be consumed when any active sub-agent exists in the current session; killing should require the existing double-Escape gesture within the configured window.
- Approved destructive target policy: double Escape aborts current-batch active agents when present; if no current-batch active agents match, the warning and second Escape target all active session agents. The warning should make the fallback scope/count clear before the destructive second Escape.
- Before performing the double-Escape abort, implementation should refresh sub-agent state once to reduce stale watcher risk.
- The fix should be targeted to Escape safety and should not broaden into redesigning all interrupt/background semantics.

**Interface contract**
- Must exist: single Escape is non-destructive for active sub-agents, both inside the `/subagents` overlay and in ambient TUI state.
- Consumer: pi-crew users who press Escape while sub-agents are active.
- Exact interface: overlay Escape closes/back-outs through the overlay component; ambient Escape with any active session sub-agent consumes the key and shows a warning naming the target scope/count; double Escape within the configured window refreshes state and aborts current-batch active agents when present, otherwise all active session agents.
- Forbidden behaviors: do not kill active sub-agents on a single Escape; do not let overlay Escape reach the parent editor abort path; do not perform the all-active fallback without first warning about that scope; do not remove the intentional double-Escape kill path; do not change Ctrl+B backgrounding or Ctrl+C kill semantics unless required by tests and explicitly scoped.
- Expected evidence: tests reproducing single Escape with active sub-agents, overlay Escape close tests, double-Escape current-batch and all-active fallback target tests, warning scope/count assertions, state refresh evidence, and source evidence around `mountInterruptHandler(...)` fallback behavior.
- Non-compliance: a single Escape kills or aborts active sub-agents, overlay Escape triggers parent abort behavior, fallback all-active abort happens without a matching warning, or double-Escape no longer kills when intended.

### DETAILS-ACCESS-010 — Empty state is a simple notification
When `/subagents` is invoked and there are no active sub-agents in the current session, the first pass should show a simple info notification rather than opening an empty overlay or expanding into recent/stopped triage.

Implementation-shaping detail:
- Suggested user-facing message: `No active sub-agents in this session.`
- This keeps `/subagents` focused on the live active-agent dashboard.
- If agents were active when the overlay opened but all finish while it is still open, the overlay may stay open and show an in-overlay empty state until Escape closes it; this differs from invoking `/subagents` when no active agents exist initially.
- Recent stopped/problem-agent triage remains outside this first pass unless later explicitly added.

**Interface contract**
- Must exist: `/subagents` handles the no-active-agents case with a non-disruptive info notification.
- Consumer: users invoking `/subagents` when no sub-agent is `starting` or `running` in the current session.
- Exact interface: if the active session-wide state list is empty, call the repo-compatible notification UI with info-level severity and do not mount the overlay.
- Forbidden behaviors: do not open a large empty overlay in the no-active case; do not include stopped/failed/orphaned/recent triage in this first-pass empty state; do not silently no-op.
- Expected evidence: command tests for empty active state showing notification and no overlay mount.
- Non-compliance: `/subagents` opens an empty panel when no active agents existed at invocation time, silently does nothing, or broadens into recent stopped-agent triage without a later user decision.

### DETAILS-ACCESS-011 — Approved interaction defaults from design preflight
The user approved these defaults before implementation planning:

- `/tasks` becomes an exact compatibility alias to the same `/subagents` overlay, rather than preserving current-batch-only semantics.
- In wide split layout, selecting a row auto-updates the right details pane; Enter opens or focuses a full-width detail view for long task/transcript content. Narrow layout uses list → detail drill-in.
- If all active agents finish while the overlay is open, the overlay stays open and shows an in-overlay empty state until Escape closes it.
- Ctrl+C behavior is unchanged and is not a close key for the overlay. Escape closes/back-outs; double Escape remains the destructive ambient gesture.
- Current-batch agents sort first, then other active session agents by start time; label non-current or unbatched agents only when it helps avoid confusion.

**Interface contract**
- Must exist: the first-pass plan preserves these approved interaction defaults unless implementation evidence forces a user-approved change.
- Consumer: users opening `/subagents` or compatibility `/tasks` while active sub-agents are running.
- Exact interface: `/tasks` routes to the same overlay as `/subagents`; wide selection auto-populates details and Enter opens/focuses full detail; narrow layout drills from list to detail; Ctrl+C remains interrupt behavior, not overlay close; sorting prioritizes current-batch active agents before other active session agents.
- Forbidden behaviors: do not leave `/tasks` as current-batch-only in the first-pass plan; do not make Ctrl+C the overlay close key; do not auto-close the overlay abruptly when the last active agent finishes; do not require Enter before any detail information appears in wide split view.
- Expected evidence: command alias tests, wide/narrow key-flow tests, active-to-empty overlay update tests, Ctrl+C/Escape tests, and sorting/filtering tests.
- Non-compliance: `/tasks` and `/subagents` show different scopes/presentations, wide split has no details until Enter, Ctrl+C closes overlay instead of retaining interrupt behavior, or the overlay closes unexpectedly as soon as active agents finish.

## Source References
- User decision: accepted cohesive live sub-agent dashboard/control recommendation and asked to focus on sub-agent details presentation/access, while keeping current detail content mostly intact.
- `src/ui/footer.ts` — current Down-then-Enter footer focus/open flow and editor-empty gating.
- `src/commands/tree.ts` and `src/ui/overlay.ts` — current `/tasks` command path to a below-editor current-batch active panel.
- `src/ui/subagents-panel.ts` and `src/ui/subagents-panel-render.ts` — current detail/list panel behavior and presentation implementation.
- `src/ui/widget.ts` — current above-editor live running-agent summary surface.
- `/home/lenin/.agents/skills/pi-tui-interactive/references/overlays-and-ui-surfaces.md` — surface selection guidance for overlay vs status/widget/footer.
- `/home/lenin/.agents/skills/pi-tui-interactive/references/recipes.md` — modal framing/key-hint/width-safety pattern.
- `/home/lenin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/keybindings.md` — default app/TUI keybindings to avoid conflicts.

## Non-Goals / Deferred Scope
- Changing the underlying detail data/content is not the main goal unless required for presentation.
- Config/setup TUI polish is not part of this first pass.
- Recent stopped/problem-agent triage is not part of this first pass.
- Changing sub-agent execution semantics is not part of this branch except for the targeted Escape safety fix.

## Acceptance / Verification Expectations
- Later implementation must include keyboard-flow/render tests for details access, editor input safety, close/back behavior, empty-state behavior, active-to-empty overlay updates, kill confirmation, and Escape safety.
- Render/layout evidence should cover wide split-panel layout, full-width detail focus, and narrow fallback behavior.
- Command tests should cover `/subagents`, `/tasks` exact alias compatibility, all-active session filtering, current-batch-first sorting, and no new shortcut registration.

## Questions to Resolve Before Planning
- None.
