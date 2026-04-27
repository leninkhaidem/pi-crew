# Subagent Nesting Guard and Config Slots Specification

## Overview

Ensure pi-crew configuration exposes the built-in `general-purpose` agent alongside `explore`, and prevent invoked sub-agents from launching further sub-agents by default. The nested-call prevention must be enforced by pi-crew runtime code, not by requiring users to know internal tool names in agent frontmatter.

## Requirements

- REQ-1: `/subagent-config` must include `general-purpose` in the agent-slot configuration flow, not only `explore`.
- REQ-2: `general-purpose` must remain usable without explicit configuration by inheriting the parent model/thinking when no slot is set.
- REQ-3: An explicitly configured `general-purpose` slot must be honored when present; inheritance applies only when the slot is unset.
- REQ-4: Invoked sub-agents must not receive pi-crew sub-agent orchestration tools by default.
- REQ-5: Nested sub-agent prevention must be code-level and apply even when a user-created agent `.md` omits `tools:` or accidentally includes pi-crew tool names.
- REQ-6: Nested sub-agent prevention must cover both session-mode and subprocess-mode sub-agents.
- REQ-7: Sub-agents must not receive pi-crew prompt guidance that advertises sub-agent delegation when nested sub-agent tools are unavailable.
- REQ-8: Parent sessions must continue to receive pi-crew tools and prompt guidance normally.

## Acceptance Criteria

- AC-1: Opening `/subagent-config` offers configuration for both `explore` and `general-purpose`.
- AC-2: A `general-purpose` call still inherits the parent model/thinking when no explicit `general-purpose` config slot exists.
- AC-3: A `general-purpose` call uses its configured provider/model/thinking when an explicit `general-purpose` config slot exists.
- AC-4: A session-mode sub-agent has no active `Agent`, `subagent_dispatch`, `subagent_run`, `subagent_status`, `get_subagent_result`, `steer_subagent`, or `subagent_kill` tools, including after extension binding.
- AC-5: A subprocess-mode sub-agent launched by pi-crew does not register pi-crew sub-agent orchestration tools in the child process.
- AC-6: A sub-agent prompt does not include the pi-crew sub-agent instruction block.
- AC-7: Parent sessions still expose the existing pi-crew tools after startup/reload.
- AC-8: Existing agent frontmatter remains simple; users are not required to add denylisted internal tool names to avoid nested subagents.

## Constraints

- Nested subagents are disabled by default; no configurable allow-nested option is required for this change.
- Do not rely on bundled/user/project agent frontmatter as the primary guard.
- Keep changes surgical and consistent with existing pi-crew style.
- Preserve existing session-mode extension/resource behavior for non-pi-crew extensions where practical.

## Code References

- `src/config/auto.ts`: defines which agent slots `/subagent-config` iterates.
- `src/config/tui.ts`: implements the model/thinking slot picker UI.
- `src/tools/slot.ts`: resolves `general-purpose` inheritance and configured fallback behavior.
- `src/runtime/session-lifecycle.ts`: creates in-process sub-agent sessions and currently filters only some sub-agent tools.
- `src/runtime/spawn.ts`: launches subprocess-mode sub-agents and controls child process environment.
- `src/index.ts`: registers pi-crew tools and injects the pi-crew sub-agent system prompt block.
- `src/system-prompt.ts`: builds the parent-facing pi-crew sub-agent guidance block.
- `src/agents/defaults/general-purpose.md`: bundled general-purpose agent currently has no explicit tools allowlist.
- `test/unit/config-auto.test.ts`: covers default slot suggestion behavior.
- `test/unit/slot.test.ts`: covers slot resolution and general-purpose inheritance behavior.
- `test/unit/session-lifecycle.test.ts`: covers session-mode tool filtering behavior.
- `test/unit/system-prompt.test.ts`: covers prompt block content.

## Out of Scope

- Adding a user-facing `allowNestedSubagents` configuration option.
- Changing the agent `.md` frontmatter format.
- Changing slash command names.
- Redesigning the `/subagent-config` TUI beyond adding the missing built-in slot.
