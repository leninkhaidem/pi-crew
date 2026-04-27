# Config Inherit and Footer Details Specification

## Overview

Add an explicit inherit option to sub-agent model configuration and improve the below-input pi-crew running status so users can navigate into active sub-agent details and transcript output without changing the existing above-input tracker.

## Requirements

- REQ-1: `/subagent-config` must offer an `inherit parent model/thinking` option for every configurable sub-agent slot.
- REQ-2: Selecting inherit for a slot must inherit both the parent model and the parent thinking level.
- REQ-3: When inherit is selected for a slot, `/subagent-config` must not show a thinking selection step for that slot.
- REQ-4: Per-dispatch `provider`, `model`, and `thinking` parameters must continue to override both concrete configured slots and inherited slots.
- REQ-5: `general-purpose` must default to parent model/thinking inheritance when no explicit concrete slot is configured.
- REQ-6: The existing above-input active sub-agent tracker must remain unchanged.
- REQ-7: The below-input `⟳ N running` status must support keyboard navigation into active sub-agent information.
- REQ-8: When the editor is empty and active sub-agents exist, pressing Down must focus the below-input running status; pressing Down again or Enter must open active sub-agent details.
- REQ-9: The active sub-agent details UI must support selecting a running sub-agent with arrow keys.
- REQ-10: Drilling into a sub-agent must show metadata, the original task, and a formatted recent transcript excerpt directly in the detail view.
- REQ-11: The drilled-in detail view must not show separate current activity, active tools, last tool call, latest output, or file path sections.
- REQ-12: Left Arrow must navigate one level back from details to the active sub-agent list, and another Left Arrow must close the widget.
- REQ-13: Escape must close or back out of the details widget before triggering any active-sub-agent abort behavior.
- REQ-14: Transcript rendering must be readable, bounded to the last 64 KiB of persisted transcript data, tolerant of partial or unreadable transcript data, and must not expose hidden reasoning content.

## Acceptance Criteria

- AC-1: `/subagent-config` shows an inherit option for `explore`, `general-purpose`, and any future slot listed by the config flow.
- AC-2: A slot configured to inherit resolves to the current parent provider, model, and thinking level.
- AC-3: A concrete configured slot still resolves to its configured provider, model, and thinking level.
- AC-4: Per-call dispatch overrides still take precedence over inherit and concrete slot configuration.
- AC-5: Selecting inherit in `/subagent-config` saves a durable config state that can be reloaded and used by dispatch.
- AC-6: Selecting inherit skips the thinking picker; selecting a concrete model keeps the thinking picker.
- AC-7: The above-input active tracker behavior and rendering are unchanged.
- AC-8: With an empty editor and active sub-agents, Down focuses the below-input running status and Down or Enter opens the active sub-agent list; Down must not be consumed for this behavior when normal editor input should keep it.
- AC-9: In the active sub-agent list, arrows change selection and Enter or Right Arrow drills into the selected sub-agent.
- AC-10: The sub-agent detail view shows metadata, wrapped task text, and a formatted recent transcript excerpt.
- AC-11: The sub-agent detail view omits current activity, active tools, last tool call, latest output, and file path sections.
- AC-12: Left Arrow backs out one level and then closes the widget; Escape closes or backs out of the widget before abort handling.
- AC-13: Transcript content shown in the UI is based on sanitized persisted `output.jsonl` data, reads at most the last 64 KiB, ignores partial or malformed JSONL lines, formats the last 20 displayable events in chronological order, renders at most 30 wrapped lines, excludes hidden reasoning, and has a fallback for empty or unreadable transcript data.

## Constraints

- Keep changes focused and consistent with existing pi-crew TUI patterns.
- Preserve existing per-call model/thinking override behavior.
- Preserve the above-input tracker unchanged.
- Do not expose hidden reasoning or sensitive transcript fields.
- Do not redesign unrelated slash commands or state storage.

## Code References

- `src/config/tui.ts`: implements `/subagent-config` model and thinking selection flow.
- `src/config/schema.ts`: validates persisted pi-crew configuration.
- `src/config/auto.ts`: defines configurable slot names and default suggestions.
- `src/tools/slot.ts`: resolves configured, inherited, and overridden sub-agent model slots.
- `src/types.ts`: defines `AgentSlot`, `PiCrewConfig`, and sub-agent state types.
- `src/ui/footer.ts`: renders the below-input `⟳ N running` status.
- `src/ui/overlay.ts`: implements the existing active sub-agent panel and keyboard handling.
- `src/ui/interrupt.ts`: handles Escape and Ctrl+C abort behavior while sub-agents are running.
- `src/ui/widget.ts`: implements the above-input tracker that must remain unchanged.
- `src/runtime/transcript.ts`: sanitizes persisted transcript events.
- `src/runtime/jsonl.ts`: reads persisted JSONL state and transcript data.
- `src/index.ts`: wires session startup, footer, interrupt, and state watcher controllers.
- `src/commands/tree.ts`: opens the existing active sub-agent panel command.
- `test/unit/config-schema.test.ts`: covers config parsing behavior.
- `test/unit/slot.test.ts`: covers slot resolution behavior.
- `test/unit/footer.test.ts`: covers footer status behavior.
- `test/unit/overlay.test.ts`: covers active sub-agent panel rendering/interaction.
- `test/unit/interrupt.test.ts`: covers active sub-agent interrupt behavior.
- `test/unit/transcript.test.ts`: covers transcript sanitization.

## Out of Scope

- Changing the above-input active tracker.
- Showing hidden model reasoning or unsanitized transcript payloads.
- Replacing pi's main input editor or global footer implementation.
- Changing slash command names.
