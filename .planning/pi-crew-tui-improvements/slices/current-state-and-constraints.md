# Slice: Current State and Constraints

## Purpose
- Capture the existing pi-crew TUI shape, upstream pi TUI constraints, and known risk areas so later planning does not invent a greenfield UI or miss current behavior.

## Shared Understanding

### CREW-TUI-001 — Existing UI is already split across live status, details, config, and interrupts
pi-crew currently mounts its TUI behavior during `session_start` and updates it from persisted sub-agent state files. The existing surfaces are:

- Above-editor active agents widget via `mountWidget(ctx)` / `ctx.ui.setWidget("agents", ..., { placement: "aboveEditor" })` showing alias, agent slot, provider/model/thinking, turns/tool uses/usage, duration, and recent activity.
- Footer status via `mountFooter(ctx)` / `ctx.ui.setStatus("pi-crew", ...)` showing `⟳ N running`, with Down then Enter opening a below-editor `SubagentsPanel` only when the editor is empty.
- Below-editor details panel via `SubagentsPanel` / `renderSubagentsPanel(...)`, with list/detail modes, recent transcript excerpt, `d` kill confirmation only when an `onKill` callback is supplied, and Escape/Left to back out or close.
- Configuration flow via `runConfigTui(...)`, using `ctx.ui.custom`, `DynamicBorder`, `SelectList`, and stepwise prompts for execution mode, model, and thinking level.
- Slash command access via `/tasks`, implemented by `registerTreeCommand(...)` and `openTreeOverlay(...)`, opens a below-editor `SubagentsPanel` for current-batch active states with kill support.
- Global interrupt handling via `mountInterruptHandler(...)`: Ctrl+B backgrounds active detach scopes, Ctrl+C kills current-batch active states, and double Escape is intended to kill only after a warning.
- State reactivity is file-backed through `mountStateWatcher(...)`, using `fs.watch` plus a 1s poll fallback and a debounce before refreshing state files.

Implementation-shaping implication: improvements should account for this split instead of accidentally creating a fifth competing status surface. A likely planning question is whether to consolidate live monitoring/control into the footer/details panel, make the above-editor widget more actionable, or keep surfaces separate but improve discoverability.

Verification expectations:
- Planning should explicitly name which existing surfaces are retained, changed, merged, or intentionally left alone.
- Any new live UI should explain how it receives updates from state watcher data and how it avoids stale/duplicated information.

### CREW-TUI-002 — pi TUI implementation constraints are part of the design boundary
Future TUI work must follow pi extension/TUI conventions rather than rendering console-like text for interactive flows. Relevant constraints from the local pi docs and examples:

- Pick-one flows should use `SelectList`; settings/toggles should use `SettingsList`; cancellable waits should use `BorderedLoader`; persistent info should prefer `setStatus`, `setWidget`, `setFooter`, or `setWorkingIndicator` as appropriate.
- Custom components must return render/invalidate/handleInput behavior, call `tui.requestRender()` after state changes, and ensure every rendered line is width-safe with `visibleWidth`/`truncateToWidth` or equivalent.
- Modal/overlay interactions should be framed, themed through the callback `theme`, include concise key hints, and provide Escape-to-cancel/back behavior.
- Current repo imports use the `@mariozechner/pi-coding-agent` / `@mariozechner/pi-tui` package names; upstream docs/examples in this environment use `@earendil-works/...`. Implementation planning must confirm the correct package namespace for this repo before editing imports.

**Interface contract**
- Must exist: interactive pi-crew TUI flows use pi's extension UI/component APIs rather than ad hoc terminal printing.
- Consumer: pi-crew extension runtime and users operating in pi TUI mode.
- Exact interface: existing repo-facing APIs include `ctx.ui.setWidget(...)`, `ctx.ui.setStatus(...)`, `ctx.ui.custom(...)`, `ctx.ui.onTerminalInput(...)`, `DynamicBorder`, and components/utilities from the repo's configured pi TUI package namespace.
- Forbidden behaviors: do not replace interactive choices/control panels with static `console.log`-style output; do not render lines wider than the supplied `width`; do not create a focused modal/panel with no Escape/back path; do not import a global theme instead of using the callback/context theme.
- Expected evidence: code references to the chosen `ctx.ui` surface/component APIs, width-safety utilities or tests, keyboard-flow tests, and existing package namespace verification.
- Non-compliance: a UI that appears only as plain notifications/static text for interactive choices, traps focus, corrupts borders via over-wide lines, or uses the wrong package namespace.

### CREW-TUI-003 — Escape/interrupt behavior is a known risk if live-control scope changes
The repo contains an open bug note documenting that a single Escape may kill sub-agents instead of showing the intended warning. The suspected path is that `mountInterruptHandler(...)` only consumes Escape when `currentBatchActiveStates(...)` finds targets; if stale state/batch mismatch returns no targets, Escape can fall through to pi's editor abort path and trigger parent abort propagation.

Implementation-shaping implication: if the chosen TUI improvement touches live control, footer/panel focus, Escape handling, or interrupt semantics, planning should include this bug/risk explicitly. If the chosen improvement is purely visual or config-only, this can remain out of immediate scope by user decision.

Verification expectations:
- If interrupt behavior is in scope, tests should prove single Escape warns/consumes while any relevant sub-agent is active and double Escape is required to kill.
- If interrupt behavior is out of scope, planning should state that explicitly so later agents do not silently bundle behavior changes into visual polish.

## Source References
- `src/index.ts` — `session_start` mounts widget/footer/interrupt/state watcher; commands/tools are registered from the extension entrypoint.
- `src/ui/widget.ts` — above-editor active agents widget and spinner/activity rendering.
- `src/ui/footer.ts` — footer status, Down/Enter panel discovery flow, below-editor widget placement, editor-empty gating.
- `src/ui/subagents-panel.ts` and `src/ui/subagents-panel-render.ts` — list/detail panel, transcript excerpt loading, kill confirmation, key handling, framing, width handling.
- `src/config/tui.ts` — existing custom `SelectList` flows for execution mode, model, and thinking configuration.
- `src/ui/state-watcher.ts` — file watcher/polling data flow for live UI updates.
- `src/commands/tree.ts` and `src/ui/overlay.ts` — existing `/tasks` command path to the active sub-agents panel.
- `src/ui/interrupt.ts` — Ctrl+B/Ctrl+C/Escape sub-agent interrupt behavior.
- `docs/bugs/single-escape-kills-subagents.md` — documented Escape bug/risk and candidate fix direction.
- `/home/lenin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md` — upstream pi component, overlay, widget, theme, width, and keyboard rules.
- `/home/lenin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` — extension lifecycle and `ctx.ui` surface behavior.
- `/home/lenin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/keybindings.md` — keybinding defaults relevant to Escape/Ctrl+C/Ctrl+B conflicts and hints.

## Non-Goals / Deferred Scope
- Config/setup TUI polish is not part of the first-pass live details improvement.
- Recent stopped/problem-agent triage is not part of the first-pass live details improvement.
- Broad sub-agent execution semantics changes are out of scope except for the targeted Escape safety fix captured in `DETAILS-ACCESS-009`.

## Acceptance / Verification Expectations
- Planning must preserve or intentionally replace existing UI behavior with a named rationale; no hidden greenfield rewrite assumption.
- Any implementation plan should include TUI tests or render/key-handling tests for changed surfaces.
- Planning must reconcile existing `/tasks`, footer, widget, state watcher, and interrupt behavior with the approved `/subagents` overlay direction.

## Questions to Resolve Before Planning
- None.
