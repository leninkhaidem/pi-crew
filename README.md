# pi-crew

Sub-agent extension for the [pi coding assistant](https://github.com/badlogic/pi-mono). Lets the main agent delegate work to specialized sub-agents that run in isolated processes with their own context windows. Inspired by Claude Code's Agent SDK.

## Features

- **Delegation tools.** `subagent_dispatch`, `subagent_run`, `subagent_resume`, `get_subagent_result`, and `steer_subagent` cover background, blocking, continuation, recovery, and steering workflows.
- **Background dispatch.** Sub-agents return an `agentId` immediately; the main agent stays interactive.
- **Push notification on completion.** Each sub-agent's final summary is auto-injected into the main session — no polling.
- **Live status.** Widget above the editor appears while sub-agents are active and shows status, model, and one-line current activity.
- **Session-scoped multi-provider policy.** When Pi supplies a model scope, prompt guidance, `/subagent-config`, launches, and every resumed turn are limited to the exact case-sensitive provider/model pairs in that scope. An empty scope uses all authenticated models.
- **Per-call model overrides.** `subagent_dispatch` and `subagent_run` accept optional `provider`, `model`, and `thinking` overrides; only currently permitted models are injected into the prompt.
- **Per-slot thinking budget.** Reasoning effort (`off|minimal|low|medium|high|xhigh|max`) is configurable for `explore`; `general-purpose` inherits the parent model and thinking effort by default. Levels are filtered from each model's structural `reasoning` and `thinkingLevelMap` metadata.
- **Two bundled defaults.** `general-purpose` and `explore`. Override by creating same-named `.md` in `~/.pi/agent/agents/`.
- **Tmux integration.** Optional live view of sub-agents in tmux windows or a separate session.
- **Deliberate cancellation.** `Ctrl+C` keeps its current-batch interrupt behavior; double `Esc` within 3 seconds aborts warned active sub-agents after a non-destructive first press.

## Install

`pi install git:github.com/leninkhaidem/pi-crew`

After install:

- `/subagent-config` — configure the `explore` model + thinking budget; `general-purpose` inherits the parent model/thinking by default
- `/subagent-install-defaults` — (optional) copy bundled `.md` files to `~/.pi/agent/agents/`

## Tools the main agent gets

| Tool | Purpose |
|---|---|
| `subagent_dispatch` | Background dispatch. Requires `alias`, a short instance/job name shown in UI. |
| `subagent_run` | Blocking single / parallel / chain execution with partial results preserved when a submitted model is outside the current session scope. |
| `get_subagent_result` | Check or wait for a background result; optionally request bounded sanitized `recentEvents` or explicit verbose transcript JSONL. |
| `steer_subagent` | Send a steering message to a running session-mode sub-agent. |
| `subagent_resume` | Continue a session-mode sub-agent; press Ctrl+B to move a pending resumed turn to the background and receive its completion automatically. |
| `subagent_status` | Default uncapped current active list (`starting`/`running`); `scope: 'stopped'` returns a capped problematic triage list; `agentId` does exact lookup. |
| `subagent_kill` | Abort a running sub-agent. |

## Thinking capability behavior

`max` is opt-in: a reasoning model supports it only when its own `thinkingLevelMap.max` value is a string. Model and provider names are never used as capability rules. Thinking precedence is per-call choice, an explicitly saved slot choice, the selected scoped-model pin, then inherited/default behavior; capability clamping runs last. When `max` is unsupported, pi-crew selects the first supported level in `xhigh`, `high`, `medium`, `low`, `minimal`, `off` order and reports requested/effective values. Non-reasoning models use `off`. If no lower level is supported, launch fails before dispatch.

## Compatibility and runtime

Pi-crew is built and locally verified against the public `@earendil-works/*` 0.84.1 SDK on Node.js 22.19 or newer. Its peer range permits 0.84.1 and later, but that range is not a claim that future pre-1.0 releases have been verified. Session-mode children use Pi's public session-services and model-runtime APIs, preserve runtime-only parent authentication in memory, and re-check scope and authentication before every resume. Subprocess mode rejects runtime-only authentication before spawning and never transports the key.

Configuration keeps the requested value; launch state and tool details show the effective value plus adjustment provenance when a downgrade occurred.

## Slash commands

| Command | Purpose |
|---|---|
| `/subagent-config` | TUI to set provider, model, and thinking level for `explore`. |
| `/subagent-install-defaults` | Copy bundled `.md` agents to `~/.pi/agent/agents/`. |
| `/subagent-agents` | Create, view, edit, eject, or delete simple `.md` agent definitions. |
| `/subagents` | Open the floating live sub-agent overlay for all active sub-agents in the current session. Current-batch agents are shown first; older or unbatched active agents remain visible. Wide terminals show an agent list with selected details; press `Enter` to expand long task/transcript details. Narrow terminals use list-to-detail drill-in. Press `Esc` to close/back out; press `d` to kill the selected agent with confirmation. |
| `/tasks` | Compatibility alias for `/subagents` with the same overlay, session-wide active scope, and kill behavior. |

## Hook events on `pi.events`

`pi-crew:dispatch`, `pi-crew:start`, `pi-crew:end`, `pi-crew:killed`, `pi-crew:orphaned`, `pi-crew:detached`, `pi-crew:config-changed`. See `src/types.ts` for payload shapes.

## State directory

```
~/.pi/agent/subagents/<sessionId>/<agentId>/
  state.json   live snapshot
  output.jsonl raw subprocess JSONL stream
  stderr.log   subprocess stderr
  prompt.md    system prompt body
```

## Spec / design

- `docs/superpowers/specs/2026-04-25-pi-crew-design.md`
- `docs/superpowers/plans/2026-04-25-pi-crew.md`

## License

MIT.
