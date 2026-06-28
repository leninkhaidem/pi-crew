# pi-crew

Sub-agent extension for the [pi coding assistant](https://github.com/badlogic/pi-mono). Lets the main agent delegate work to specialized sub-agents that run in isolated processes with their own context windows. Inspired by Claude Code's Agent SDK.

## Features

- **Claude-style tools.** `Agent`, `get_subagent_result`, and `steer_subagent` are available alongside the `subagent_*` tools.
- **Background dispatch.** Sub-agents return an `agentId` immediately; the main agent stays interactive.
- **Push notification on completion.** Each sub-agent's final summary is auto-injected into the main session — no polling.
- **Live status.** Widget above the editor appears while sub-agents are active and shows status, model, and one-line current activity.
- **Multi-provider.** Each agent slot's model is configured via TUI from your authenticated providers. No hardcoded model IDs.
- **Per-call model overrides.** `Agent`, `subagent_dispatch`, and `subagent_run` accept optional `provider`, `model`, and `thinking` overrides; available models are injected into the prompt.
- **Per-slot thinking budget.** Reasoning effort (`off|minimal|low|medium|high|xhigh`) is configurable for `explore`; `general-purpose` inherits the parent model and thinking effort by default.
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
| `Agent` | Claude-style foreground/background launch wrapper. Requires `alias`, a short instance/job name shown in UI. |
| Example | `await Agent({ subagent_type: 'general-purpose', alias: 'pr-summary', prompt: 'Summarize this PR', provider: 'openai-codex', model: 'gpt-5.4-mini', thinking: 'low', run_in_background: true })` |
| `get_subagent_result` | Check or wait for a background result; optionally request bounded sanitized `recentEvents` or explicit verbose transcript JSONL. |
| `steer_subagent` | Send a steering message to a running session-mode sub-agent. |
| `subagent_dispatch` | Background dispatch. Returns agentId. |
| `subagent_run` | Blocking single / parallel / chain modes. |
| `subagent_status` | Default uncapped current active list (`starting`/`running`); `scope: 'stopped'` returns a capped problematic triage list; `agentId` does exact lookup. |
| `subagent_kill` | Abort a running sub-agent. |

## Slash commands

| Command | Purpose |
|---|---|
| `/subagent-config` | TUI to set provider, model, and thinking level for `explore`. |
| `/subagent-install-defaults` | Copy bundled `.md` agents to `~/.pi/agent/agents/`. |
| `/subagent-agents` | Create, view, edit, eject, or delete simple `.md` agent definitions. |
| `/subagents` | Open the floating live sub-agent overlay for all active sub-agents in the current session. Current-batch agents are shown first; older or unbatched active agents remain visible. Press `Esc` to close/back out; press `d` to kill the selected agent with confirmation. |
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
