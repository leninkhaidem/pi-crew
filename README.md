# pi-crew

Sub-agent extension for the [pi coding assistant](https://github.com/badlogic/pi-mono). Lets the main agent delegate work to specialized sub-agents that run in isolated processes with their own context windows. Inspired by Claude Code's Agent SDK.

## Features

- **Background dispatch.** Sub-agents return an `agentId` immediately; the main agent stays interactive.
- **Push notification on completion.** Each sub-agent's final summary is auto-injected into the main session — no polling.
- **Live status.** Widget above the editor shows every active sub-agent's status, branch, cwd, and recent activity.
- **Multi-provider.** Each agent slot's model is configured via TUI from your authenticated providers. No hardcoded model IDs.
- **Four bundled defaults.** `general-purpose`, `explore`, `plan`, `code-reviewer`. Override by creating same-named `.md` in `~/.pi/agent/agents/`.
- **Tmux integration.** Optional live view of sub-agents in tmux windows or a separate session.

## Install

`pi install git:github.com/leninkhaidem/pi-crew@v0.1.0`

After install:

- `/subagent-config` — configure model per agent slot
- `/subagent-install-defaults` — (optional) copy bundled `.md` files to `~/.pi/agent/agents/`

## Tools the main agent gets

| Tool | Purpose |
|---|---|
| `subagent_dispatch` | Background dispatch. Returns agentId. |
| `subagent_run` | Blocking single / parallel / chain modes. |
| `subagent_status` | Peek at running/recent sub-agents. |
| `subagent_wait` | Block on specified ids. |
| `subagent_kill` | Abort a running sub-agent. |

## Slash commands

| Command | Purpose |
|---|---|
| `/subagent-config` | TUI to set provider+model per agent slot. |
| `/subagent-install-defaults` | Copy bundled `.md` agents to `~/.pi/agent/agents/`. |
| `/subagents` | Open interactive tree overlay of all sub-agents. |

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
