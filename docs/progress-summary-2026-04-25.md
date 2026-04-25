# pi-crew Progress Summary — 2026-04-25

This document summarizes the implementation and validation work completed on the `pi-crew` Pi extension so far.

## Repository state

- Repo: `/home/lenin/work-repos/pi-agents-v2`
- Branch: `v0.1.0-impl`
- Remote branch: `origin/v0.1.0-impl`
- Local package installed in Pi from this repo path.
- Current extension entrypoint uses TypeScript source: `src/index.ts`.

Recent commits pushed:

- `c6c652d` — `Polish sub-agent UI and interrupt handling`
- `a7ce420` — `Add session execution backend and live agent UX`
- `375b199` — `Match reference above-editor agent tracker`

## Implemented features

### Local installation and real delegation smoke tests

- Installed the extension locally with Pi.
- Verified real delegation through:
  - `subagent_dispatch`
  - `subagent_run`
  - `subagent_wait`
  - `subagent_status`
  - `subagent_kill`
- Confirmed state and transcript files are created under:
  - `~/.pi/agent/subagents/<sessionId>/<agentId>/state.json`
  - `~/.pi/agent/subagents/<sessionId>/<agentId>/output.jsonl`
  - `~/.pi/agent/subagents/<sessionId>/<agentId>/stderr.log`
  - `~/.pi/agent/subagents/<sessionId>/<agentId>/prompt.md`

### Per-slot thinking configuration

Added per-agent-slot thinking configuration instead of a single global thinking level.

Implemented in:

- `src/types.ts`
- `src/config/schema.ts`
- `src/config/auto.ts`
- `src/config/tui.ts`
- `src/runtime/lifecycle.ts`
- `src/runtime/spawn.ts`
- `src/state/store.ts`

Current configured slots in `~/.pi/agent/pi-crew.json`:

- `explore`: `openai-codex/gpt-5.4-mini`, thinking `low`
- `plan`: `openai-codex/gpt-5.5`, thinking `xhigh`
- `code-reviewer`: `openai-codex/gpt-5.3-codex`, thinking `xhigh`
- `general-purpose`: `openai-codex/gpt-5.3-codex`, thinking `xhigh`

### Global execution backend selector

Added top-level runtime selector:

```json
{
  "global": {
    "executionMode": "session"
  }
}
```

Supported values:

- `session` — default; uses `createAgentSession` in-process for the best live UX.
- `subprocess` — fallback/current child-process backend for stronger isolation and tmux compatibility.

Implemented in:

- `src/types.ts`
- `src/config/schema.ts`
- `src/config/tui.ts`
- `src/runtime/lifecycle.ts`
- `src/runtime/session-lifecycle.ts`
- `src/index.ts`

Important behavior:

- Execution mode is global only, not per-slot.
- If `session` mode is requested without an `ExtensionContext`, dispatch falls back to `subprocess` and records the actual execution mode correctly.
- `/subagent-config` now exposes execution mode selection.

### New `createAgentSession` backend

Added a session-mode backend in:

- `src/runtime/session-lifecycle.ts`

The backend:

- Uses Pi SDK `createAgentSession()` directly.
- Preserves existing `state.json` / `output.jsonl` / `stderr.log` / `prompt.md` contracts.
- Writes compatible persisted state.
- Streams transcript events to JSONL.
- Tracks active tools, tool use count, usage, turns, response preview, activity, and final output.
- Supports abort handles for `subagent_kill` and parent interrupt propagation.
- Enables extensions for parity with subprocess mode, while filtering pi-crew recursive tools from active session tools.

### Subprocess backend retained

The original subprocess backend remains available as `global.executionMode: "subprocess"`.

It is still useful for:

- stronger process isolation
- fallback compatibility
- tmux transcript viewing
- behavior closer to the original implementation

### Parent interrupt and kill handling

Implemented parent interrupt propagation:

- `Escape → Abort` aborts sub-agents launched by the current parent ask.
- Older unrelated active sub-agents are not killed.
- Session-mode in-memory handles are aborted directly before falling back to state-file/process abort.

Implemented/refined in:

- `src/runtime/kill.ts`
- `src/runtime/parent-abort.ts`
- `src/runtime/types.ts`
- `src/tools/dispatch.ts`
- `src/tools/run.ts`
- `src/tools/kill.ts`
- `src/index.ts`

Manual abort test confirmed a long-running `general-purpose` agent was marked:

```json
{
  "status": "aborted",
  "errorMessage": "parent ask interrupted",
  "exitCode": 143
}
```

### Active agent tracker UI

The first tracker implementation used a floating top-right overlay. After comparing with `/tmp/pi-subagents`, this was replaced with the reference-style above-editor widget.

Current behavior matches `/tmp/pi-subagents` more closely:

```text
● Agents
├─ ⠋ explore  task text · ⟳0≤3 · 1.2s
│    ⎿  running command
└─ ⠙ plan  task text · ⟳1≤4 · 4.8s
     ⎿  thinking…
```

Implemented in:

- `src/ui/widget.ts`

Behavior:

- Uses `ctx.ui.setWidget("agents", ..., { placement: "aboveEditor" })`.
- Shows only while agents are active.
- Clears when no agents are active.
- Uses a stable signature to avoid unnecessary redraws from polling.
- Animates spinner without re-registering the widget.
- Shows activity such as `running command`, `searching`, `thinking…`, or response preview.

### `/subagents` overlay

Updated `/subagents` to render a larger bordered overlay panel with details and controls.

Implemented in:

- `src/ui/overlay.ts`
- `src/commands/tree.ts`

Notable fix:

- The `k` kill shortcut now works for session-mode agents with `pid: null` by routing through runtime abort logic instead of only calling `process.kill(pid)`.

### Footer/status cleanup

Improved footer/status behavior:

- Shows compact active count while agents are running.
- Clears `pi-crew` status when no sub-agents are active.

Implemented in:

- `src/ui/footer.ts`

### Notifications and completion rendering

Added custom notification rendering for pi-crew completion cards:

- `src/notify/batcher.ts`
- `src/notify/renderer.ts`
- `src/notify/message.ts`

Behavior:

- Successful background completion notifications are hidden via `display: false`.
- Failed/aborted/mixed batches remain visible.
- Blocking `subagent_run` still returns its result normally to the parent conversation.
- User confirmed the visible blocking completion output is acceptable.

### `subagent_run` failed/aborted output

Improved `subagent_run` terminal output for non-success states.

Example now reads like:

```text
[general-purpose #3d8234dc] aborted — parent ask interrupted
```

instead of returning only `(no output)`.

Implemented in:

- `src/tools/run.ts`
- `test/unit/run-result.test.ts`

## Tests added or updated

Added/updated unit and integration coverage across:

- `test/unit/config-auto.test.ts`
- `test/unit/config-schema.test.ts`
- `test/unit/config-store.test.ts`
- `test/unit/footer.test.ts`
- `test/unit/notify-batcher.test.ts`
- `test/unit/notify-message.test.ts`
- `test/unit/overlay.test.ts`
- `test/unit/parent-abort.test.ts`
- `test/unit/run-result.test.ts`
- `test/unit/spawn.test.ts`
- `test/unit/state-store.test.ts`
- `test/unit/sweep.test.ts`
- `test/unit/widget.test.ts`
- `test/integration/kill.test.ts`
- `test/integration/lifecycle.test.ts`

Latest full verification passed:

```text
npm run lint       ✅
npm run typecheck  ✅
npm test           ✅ 98 passed, 1 skipped
npm run build      ✅
```

## Live tests completed

### Simple session-mode background test

Agent:

- `explore #7e37afc9`

Result:

```text
LIVE_OK
```

State confirmed:

```json
{
  "executionMode": "session",
  "status": "done",
  "turns": 1
}
```

### Long-running background tracker test

Agent:

- `explore #959c9401`

Task ran a sleep command and returned:

```text
LIVE_PANEL_OK
```

State during run confirmed:

```json
{
  "status": "running",
  "executionMode": "session",
  "activeTools": ["bash"],
  "activity": "running command"
}
```

### Above-editor tracker test after reload

Agent:

- `explore #ac3a6032`

Result:

```text
ABOVE_EDITOR_OK
```

State during run confirmed:

```json
{
  "status": "running",
  "executionMode": "session",
  "activeTools": ["bash"],
  "activity": "running command"
}
```

### Blocking `subagent_run` tracker test

Agent:

- `explore #8c237607`

Result:

```text
BLOCKING_OK
```

This verified the blocking path still works with session mode and result delivery.

## Known issues / follow-ups

### `maxTurns` enforcement anomaly

Earlier subprocess-mode tests showed `maxTurns` was recorded but not strictly enforced.

Examples:

- `explore #22fe7c52`: configured `maxTurns: 2`, actual `turns: 5`
- `plan #eef788f1`: configured `maxTurns: 2`, actual `turns: 13`, cost about `$0.5721`

Session mode now has soft steering and hard abort logic, but max-turn behavior still deserves dedicated validation across both backends.

### Packaging issue for fresh installs

A fresh git/Pi install may fail because Pi uses `npm install --omit=dev`, but `prepare` runs `npm run build`, requiring `tsc` from dev dependencies.

Observed failure:

```text
sh: 1: tsc: not found
npm error code 127
```

This should be fixed before release.

### Documentation/release work still pending

Functionality has been prioritized first. Remaining release tasks include:

- Update README with current behavior.
- Document `global.executionMode`.
- Document session vs subprocess tradeoffs.
- Document `/subagents` and above-editor tracker behavior.
- Update changelog/release notes.
- Fix packaging before publishing.

## Current implementation direction

The desired UX is now:

- `session` backend by default.
- `/tmp/pi-subagents`-style above-editor live tracker.
- `subprocess` backend retained as global fallback.
- Existing public tool APIs and state/transcript contracts preserved.
- Successful background completions not spammy; failures/aborts remain visible.
- No hidden thinking content exposed; live activity uses generic text such as `thinking…`.
