# pi-crew Design Spec

- **Date:** 2026-04-25
- **Status:** Draft (awaiting review)
- **Repo:** `github.com/leninkhaidem/pi-crew` (private, to be created)
- **Target pi version:** 0.70.x
- **License:** MIT

---

## 1. Summary

pi-crew is an extension for the [pi coding assistant](https://github.com/badlogic/pi-mono) that enables the main agent to delegate work to specialized sub-agents running in isolated subprocess pi instances. It mirrors the productive parts of the Claude Code Agent SDK's sub-agent feature while staying within pi's documented extension API.

**The core contract:** the main agent dispatches a sub-agent in the background, receives an `agentId` immediately, and continues conversing. The sub-agent runs to completion in a separate process with its own context window. When done, its final answer is automatically pushed back into the main conversation. At any time, the main agent can query progress, wait for results, or kill running sub-agents. A live TUI widget shows what every active sub-agent is doing.

**This document is the authoritative design.** Implementation work derives an executable plan from this spec.

---

## 2. Motivation

The main agent's context window is its most precious resource. Long-running search, planning, or review tasks consume turns and tokens that "rot" useful context. Delegating these tasks to sub-agents:

- **Preserves main context:** only the sub-agent's final summary lands in the main agent's context (typically 200-600 words). The trajectory — tool calls, intermediate thinking, large file dumps — stays out.
- **Enables parallelism:** several sub-agents can search/plan/review simultaneously. The main agent stays interactive while heavy work happens in the background.
- **Provides task specialization:** each sub-agent has a focused system prompt, tool restriction, and model choice. An "explore" sub-agent runs on a fast cheap model with read-only tools; a "plan" sub-agent runs on a capable reasoning model with stricter output format requirements.

Claude Code ships this pattern as a first-class feature (`Task` tool + `agents` config). Pi has the primitives (subprocess spawn, JSONL session protocol, extension API, TUI components) but not the integrated UX. pi-crew fills that gap.

---

## 3. Goals

1. **Background-first dispatch.** The default tool returns immediately with an `agentId`. The main agent stays responsive.
2. **Push-notification on completion.** When a sub-agent finishes, its summary is injected into the main session as a custom message — the main agent sees it on its next turn without polling.
3. **Live status visibility.** A widget above the editor shows every active sub-agent's status, branch, cwd, and recent activity. No command needed; auto-shown when sub-agents exist.
4. **Multi-provider model selection.** Each agent slot's model is configured via TUI from the user's authenticated providers — no hardcoded model IDs.
5. **Default agents bundled.** Four agents ship out-of-the-box (general-purpose, explore, plan, code-reviewer). User can override or customize freely.
6. **Cross-extension hooks.** Lifecycle events on `pi.events` allow other extensions to react (audit logs, telemetry, completion alerts).
7. **Optional tmux integration.** When enabled, sub-agents are visible in real time via tmux windows or a separate tmux session.
8. **Production-grade quality.** Strict TypeScript, atomic state writes, graceful failure modes, retention of completed sub-agent state for 7 days, recovery on restart, abort propagation.

---

## 4. Non-goals (v1)

Explicitly deferred:

- ❌ **Worktree isolation.** Users have separate skills for git worktree workflows. The sub-agent's `cwd` field accepts any path; if you want a worktree, create it externally and pass its path.
- ❌ **Resume / re-attach to a finished sub-agent.** A finished sub-agent is finished. v2 may add session resumption.
- ❌ **MCP server config per agent.** No `mcpServers` field. Sub-agents inherit pi's globally configured MCP servers.
- ❌ **`skills` frontmatter field on agents.** Sub-agents discover skills at runtime via pi's normal skill discovery; no preload list needed.
- ❌ **Per-agent permission modes.** No `permissionMode: "acceptEdits" | "bypassPermissions" | "plan"` mapping. The agent's `tools` allowlist is the boundary. Pi's existing `permission-gate.ts` / `protected-paths.ts` extensions remain orthogonal.
- ❌ **`pi-crew:update` event.** State updates happen frequently; subscribers can `fs.watch` the state directory directly. Defer until proven need.
- ❌ **Markdown system-prompt editor in TUI.** Users edit agent `.md` files in `$EDITOR` (`Ctrl-G` in pi).
- ❌ **Cross-session adoption of detached sub-agents.** When pi exits with sub-agents running, they become `detached` and can be inspected via `output.jsonl` but not reattached.
- ❌ **`pane-split` tmux mode.** v2 — `window` and `external-session` cover most cases.
- ❌ **CI / GitHub Actions.** Manual local testing for v1.
- ❌ **Sub-agent process supervisors that survive parent pi death.** When pi exits, in-flight sub-agents become orphaned. State is recovered by sweep on next startup.
- ❌ **Resource budgets / token caps beyond `maxTurns`.** Caller controls cost via the agent's tool allowlist and the sub-agent's prompt brevity rules.

---

## 5. Architecture overview

```
┌──────────────────────────────────────────────────────────────────┐
│  Main pi process                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  pi-crew extension                                            │ │
│  │                                                                │ │
│  │  Tools (LLM-callable, registered via pi.registerTool):       │ │
│  │    subagent_dispatch  subagent_run                           │ │
│  │    subagent_status    subagent_wait    subagent_kill         │ │
│  │                                                                │ │
│  │  Slash commands (registered via pi.registerCommand):          │ │
│  │    /subagent config   /subagent install-defaults              │ │
│  │    /subagents                                                  │ │
│  │                                                                │ │
│  │  Lifecycle handlers (pi.on):                                   │ │
│  │    session_start  session_shutdown  before_agent_start        │ │
│  │                                                                │ │
│  │  UI surfaces:                                                  │ │
│  │    widget (auto-show above editor)                             │ │
│  │    footer status (auto)                                         │ │
│  │    /subagents tree overlay (on demand)                         │ │
│  │                                                                │ │
│  │  Notifications:                                                │ │
│  │    on completion → pi.sendMessage (custom message in context) │ │
│  │    on lifecycle → pi.events.emit("pi-crew:<event>", payload)  │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
       │ spawn (background, detached stdio to file)
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  Sub-agent pi process (isolated context window)                   │
│  Command:                                                          │
│    pi -p --mode json --no-session                                  │
│       --model <provider>/<modelId>                                 │
│       --tools <list>                                               │
│       --append-system-prompt <prompt.md>                           │
│       "Task: <task text>"                                          │
│  Env:                                                              │
│    PI_SUBAGENT_PARENT_ID=<agentId>                                 │
│    PI_SUBAGENT_SESSION_ID=<sessionId>                              │
│  Stdio:                                                            │
│    stdout → output.jsonl (direct fd)                               │
│    stderr → stderr.log (direct fd)                                 │
│  State:                                                            │
│    ~/.pi/agent/subagents/<sessionId>/<agentId>/                    │
│      ├── state.json   (atomically rewritten by parent)             │
│      ├── output.jsonl (direct subprocess stdout)                   │
│      ├── stderr.log   (direct subprocess stderr)                   │
│      └── prompt.md    (system prompt body, audit trail)            │
└──────────────────────────────────────────────────────────────────┘
       │ optionally also visible in:
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  tmux (window or external-session mode)                           │
│    pi-crew tail <output.jsonl>                                    │
│    formats JSONL events into colored live view                     │
└──────────────────────────────────────────────────────────────────┘
```

### 5.1 Key invariants

1. **Isolation by OS process boundary.** Sub-agent has its own context window. No shared memory with parent.
2. **State always on disk.** All status reads go through `state.json`. Survives main pi crash, `/reload`, session swap.
3. **Async-first.** Every dispatch returns `agentId` immediately. `subagent_run` is sync sugar over dispatch + wait.
4. **Push notifications.** Completion injected into main session via `pi.sendMessage`; main agent sees it on next turn.
5. **Lifecycle events also on `pi.events`.** Other extensions integrate without coupling.
6. **No mutation of pi internals.** Only documented `ExtensionAPI` used. Survives pi version bumps.

### 5.2 Failure model

| Condition | Detection | Resolution |
|---|---|---|
| Subprocess spawn fails | `child_process` error | `state.status = "failed"`, error in tool result |
| Subprocess exits nonzero | `proc.on("close", code)` | `status = "failed"`, last 1 KB stderr in `errorMessage` |
| Subprocess hangs / runaway | None automatic in v1 (caller uses `maxTurns` or `subagent_kill`) | Manual abort |
| Pi parent process dies while sub-agent runs | Sweep on next session_start sees PID | Status flipped to `orphaned` |
| Main session ends, sub-agent still running | `session_shutdown` handler | Status set to `detached`; subprocess continues but state.json updates stop |
| Stale state file from old session | Retention sweep on session_start | Deleted after 7 days; sub-agents older than 7 days terminal |
| Tool result fails to inject | `pi.sendMessage` rejects | Logged via `ctx.ui.notify`; state.json finalized regardless |

---

## 6. Components / module boundaries

```
src/
├── index.ts                  Extension entry; wires modules.
├── types.ts                  Shared types (re-exported for consumers).
├── system-prompt.ts          before_agent_start handler (system prompt append).
├── config/
│   ├── schema.ts             ConfigSchema (typebox), validation.
│   ├── store.ts              Load/save ~/.pi/agent/pi-crew.json (atomic).
│   ├── tui.ts                /subagent config TUI command.
│   └── auto.ts               First-run auto-config heuristic.
├── agents/
│   ├── discovery.ts          Discovery + override + virtual default fallback.
│   ├── frontmatter.ts        Parse via parseFrontmatter from pi-coding-agent.
│   └── defaults/
│       ├── general-purpose.md
│       ├── explore.md
│       ├── plan.md
│       └── code-reviewer.md
├── state/
│   ├── paths.ts              Compute state-dir paths from sessionId/agentId.
│   ├── store.ts              Atomic readState/writeState; torn-read retry.
│   ├── sweep.ts              Retention + orphan detection on session_start.
│   └── id.ts                 Generate 8-char hex agentId.
├── runtime/
│   ├── spawn.ts              spawn pi subprocess; argv/env/stdio wiring.
│   ├── jsonl.ts              Line-buffered JSONL parser (chunk-safe).
│   ├── lifecycle.ts          dispatch() orchestrator; spawn → stream → finalize.
│   ├── invocation.ts         getPiInvocation() — resolve binary path.
│   └── tmux.ts               Optional tmux launcher (window/external-session).
├── notify/
│   ├── message.ts            pi.sendMessage on completion (with batching).
│   └── events.ts             pi.events.emit lifecycle events.
├── tools/
│   ├── dispatch.ts           subagent_dispatch
│   ├── run.ts                subagent_run (single + parallel + chain)
│   ├── status.ts             subagent_status
│   ├── wait.ts               subagent_wait
│   ├── kill.ts               subagent_kill
│   └── shared.ts             Shared parameter schemas (typebox).
├── ui/
│   ├── state-watcher.ts      Single fs.watch + poll fallback; emits events.
│   ├── widget.ts             Auto-show widget above editor.
│   ├── footer.ts             Compact footer status.
│   ├── overlay.ts            /subagents interactive tree overlay.
│   ├── render-call.ts        Per-tool renderCall.
│   ├── render-result.ts      Per-tool renderResult (collapsed + expanded).
│   └── format.ts             formatToolCall, formatUsageStats utilities.
├── cli/
│   └── tail.ts               Standalone CLI: `pi-crew tail <output.jsonl>`.
└── commands/
    ├── config.ts             /subagent config registration.
    ├── install-defaults.ts   /subagent install-defaults registration.
    └── tree.ts               /subagents tree overlay registration.

test/
├── unit/                     vitest, no subprocess
├── integration/              vitest, mock-pi binary
├── fixtures/
│   └── mock-pi.ts            Canned-JSONL replacement for pi
└── smoke/                    Real pi binary; PI_CREW_E2E=1 to run
```

### 6.1 Module contracts

| Module | Public API | Depends on |
|---|---|---|
| `types.ts` | `AgentConfig`, `SubagentState`, `DispatchOptions`, `Status`, `PiCrewConfig`, event payload types | typebox |
| `config/store.ts` | `loadConfig()`, `saveConfig()`, `validateAgainstAvailable(modelRegistry)` | node:fs, schema |
| `config/tui.ts` | `runConfigCommand(ctx)` | pi-tui (SelectList, DynamicBorder), modelRegistry |
| `config/auto.ts` | `suggestDefaults(modelRegistry)` returns prefilled `PiCrewConfig` | modelRegistry |
| `agents/discovery.ts` | `discoverAgents(cwd, scope)` returns `{agents: AgentConfig[], projectAgentsDir}` | parseFrontmatter, fs, bundled defaults path |
| `state/store.ts` | `writeState(s)` (atomic), `readState(p)` (retry), `listStates(sessionId, opts)` | node:fs |
| `state/sweep.ts` | `sweep(config, modelRegistry?)` runs retention + orphan recovery | node:fs, process.kill |
| `runtime/spawn.ts` | `spawnSubagent({agent, task, model, cwd, agentId, paths})` returns child process | node:child_process |
| `runtime/jsonl.ts` | `createJsonlParser(onEvent)` returns `(chunk: Buffer) => void` and `flush()` | none |
| `runtime/lifecycle.ts` | `dispatch(opts, ctx, pi)` returns `Promise<{agentId, paths}>`. Resolves before subprocess completes. | spawn, jsonl, state, notify |
| `runtime/tmux.ts` | `launchTmuxView(state, mode)` opens tmux window or session running `pi-crew tail` | child_process |
| `notify/message.ts` | `notifyCompletion(state, pi, batchKey?)` calls `pi.sendMessage`; batches inside 2s window per main session | pi.sendMessage |
| `notify/events.ts` | `emit(pi, event, payload)` | pi.events |
| `tools/*.ts` | each registers one tool via `pi.registerTool` | runtime, state |
| `ui/state-watcher.ts` | `mountStateWatcher(sessionId, onChange) → unsubscribe` | node:fs |
| `ui/widget.ts`, `footer.ts`, `overlay.ts` | `mount<X>(ctx, state-watcher) → unsubscribe` | ctx.ui, pi-tui |
| `cli/tail.ts` | Standalone Node script invoked via `node ./tail.ts <path>` | jsonl, format |

### 6.2 Boundary rationale

- **Tools never touch fs directly.** They go through `state/store.ts`. Single source of truth.
- **`runtime/lifecycle.ts` is the only writer of state files.** No race conditions across modules.
- **`ui/*` is read-only on state.** Renders what's there, watches for changes.
- **`config/*` is independent** — no runtime/state imports. TUI testable in isolation.
- **`notify/*` is the seam** for cross-extension integration.
- **Each module under ~250 LOC target.** If a module grows past that, refactor.

---

## 7. Data flow

### 7.1 Dispatch (background) — `subagent_dispatch`

```
main agent calls subagent_dispatch({ agent: "explore", task: "find auth code" })
  │
  ├─ 1. Load config; verify slot for "explore" is configured.
  │     If not: return error "configure first via /subagent config".
  │
  ├─ 2. Load agents (user → project → bundled-default fallback).
  │     Resolve agent name to AgentConfig (tools, system prompt body).
  │
  ├─ 3. Generate agentId (8-char hex, crypto.randomBytes).
  │
  ├─ 4. Compute paths:
  │     ~/.pi/agent/subagents/<sessionId>/<agentId>/
  │       state.json, output.jsonl, stderr.log, prompt.md
  │
  ├─ 5. Write prompt.md (mode 0600) — agent's system prompt body.
  │
  ├─ 6. Write initial state.json (atomic):
  │       { schemaVersion: 1, agentId, parentAgentId,
  │         sessionId, agent, task, cwd, branch, model, provider,
  │         tools, pid: null, startedAt: now,
  │         status: "starting", ... }
  │
  ├─ 7. Emit pi.events.emit("pi-crew:dispatch", { ... }).
  │
  ├─ 8. Spawn subprocess:
  │       cmd: pi (resolved via getPiInvocation)
  │       args: ["-p", "--mode", "json", "--no-session",
  │              "--model", `${provider}/${modelId}`,
  │              ...(tools ? ["--tools", tools.join(",")] : []),
  │              "--append-system-prompt", prompt.md path,
  │              `Task: ${task}`]
  │       env: { ...process.env,
  │              PI_SUBAGENT_PARENT_ID: agentId,
  │              PI_SUBAGENT_SESSION_ID: sessionId }
  │       cwd: opts.cwd ?? main_cwd
  │       stdio: ["ignore",
  │              fs.openSync(output_path, "a"),  // direct fd
  │              fs.openSync(stderr_path, "a")]
  │       detached: false  (parent owns lifecycle)
  │
  ├─ 9. Update state.json: pid = proc.pid, status = "running".
  │
  ├─ 10. Optionally launch tmux view if config.tmux.mode != "off":
  │       `pi-crew tail <output_path>` in window or external session.
  │
  ├─ 11. Emit pi.events.emit("pi-crew:start", { agentId, pid }).
  │
  └─ 12. Return tool result IMMEDIATELY:
         content: [{ type: "text", text:
            `Dispatched #${agentId} (${agent}): ${task}\n` +
            `State: ${state_path}\n` +
            `Output: ${output_path}` }]
         details: { agentId, agent, task, status: "running", paths }
```

Tool returns to main agent in ~100-300ms (process spawn time).

### 7.2 Streaming (background, while subprocess runs)

The parent reads `output.jsonl` (which is also the subprocess's direct stdout fd) by tailing it with a separate file-read loop. We can't share the fd, so:

**Approach:** parent opens a separate **read fd** on `output.jsonl` immediately after spawn and tails it via `fs.createReadStream` (with `start: 0` and a polling watcher to detect new bytes). Each line is parsed, state updates are applied to a fresh `state.json` write.

```
read loop:
  fs.createReadStream(output_path, { start: bytesRead })
  on data:
    bytesRead += chunk.length
    feed chunk to JSONL parser
  on each event:
    if event.type === "message_end" && event.message.role === "assistant":
      currentResult.usage += event.message.usage
      currentResult.turns++
      currentResult.lastText = first text content of message
      currentResult.model ||= event.message.model
      patch state.json (atomic):
        { lastUpdate: now, usage, lastText, turns, model }
    if event.type === "tool_call_start":
      currentResult.lastToolCall = { name, args }
      patch state.json
    if event.type === "agent_end":
      record final assistant text → state.finalOutput
```

**Backpressure:** state writes are debounced to 250ms — multiple `message_end` events within 250ms result in one atomic state write.

### 7.3 Completion

```
subprocess "close" event with exitCode:
  drain remaining output.jsonl read buffer
  finalize state.json (atomic write):
    { status: "done" | "failed" | "aborted",
      exitCode, stopReason, errorMessage,
      finishedAt: now, finalOutput, usage }
  if main session still alive:
    schedule completion notification (batched within 2s window):
      pi.sendMessage({
        customType: "pi-crew",
        display: true,
        content: <formatted message, see §11.4>
      }, { triggerTurn: false })
  emit pi.events.emit("pi-crew:end", { agentId, status, exitCode,
                                       finalOutput, usage, errorMessage })
  schedule widget auto-clear (10s after last active completes)
```

The main agent sees the custom message in its context on next turn. No polling required.

### 7.4 Sync wrapper — `subagent_run`

```
subagent_run({ agent, task })
  = await dispatch({ agent, task })  [reuses lifecycle but does not return early]
  → wait for state to reach terminal status
  → return tool result with full trajectory in renderResult
    (LLM-visible content is just final assistant text)
```

For parallel mode `subagent_run({ tasks: [...] })`: dispatch all → wait all → aggregate. Concurrency capped at `config.global.maxConcurrent` (default 4); excess queued. Total tasks per call capped at 8.

For chain mode `subagent_run({ chain: [...] })`: dispatch step 1, wait, substitute output into step 2's `{previous}` placeholder, dispatch step 2, etc. Stops on first failure.

### 7.5 Status — `subagent_status`

```
subagent_status({ agentId?, scope = "active", includeDetached = false })
  if agentId: read one state.json by id, format
  else: listStates(sessionId, { scope, includeDetached }), format as compact table
returns text + structured details
```

### 7.6 Wait — `subagent_wait`

```
subagent_wait({ agentIds, timeoutMs? })
  for each id:
    fs.watch on state.json + 500ms poll fallback
    resolve when state.status is terminal
  on timeout: return partial results
```

### 7.7 Kill — `subagent_kill`

```
subagent_kill({ agentId, reason? })
  read state.json → get pid
  if pid alive: process.kill(pid, "SIGTERM")
                wait 5s
                if still alive: process.kill(pid, "SIGKILL")
  patch state: status = "aborted", exitCode = -1, errorMessage = reason
  emit pi.events.emit("pi-crew:killed", { agentId, reason })
  notify: pi.sendMessage("✗ subagent <name> #<id> killed: <reason>")
```

### 7.8 Recursive sub-agents

Sub-agent's subprocess inherits `PI_SUBAGENT_PARENT_ID=<its agentId>`. If the sub-agent itself loads pi-crew (via its own user/project extension dir), nested dispatches record `parentAgentId` correctly. Tree overlay renders the chain.

**Default behavior:** nested sub-agent dispatch is **not blocked** but **not actively encouraged**. The sub-agent has access to pi-crew tools the same as the main agent (unless its `tools:` allowlist excludes them). Nesting depth is not artificially capped — `maxTurns` and `maxConcurrent` provide indirect bounds.

**To prevent nesting per agent:** that agent's `.md` should set `tools: read, grep, find, ls` (or whatever) without including `subagent_*` tools. Since pi treats extension tools as part of the same allowlist as built-in tools, this works.

---

## 8. Default agents bundle

Four `.md` files ship in `src/agents/defaults/`. Each has frontmatter (`name`, `description`, `tools`) and a system prompt body. **No `model` field** — the model comes from `pi-crew.json` (configured by user via `/subagent config`).

### 8.1 `general-purpose.md`

```markdown
---
name: general-purpose
description: General delegation for any task. Use when the task does not fit explore/plan/code-reviewer. Has full tool access including write/edit/bash. Caller should provide explicit instructions.
---

You are a sub-agent dispatched from a parent pi session. You have full tool
access (read, write, edit, bash, grep, find, ls).

Operate autonomously. Do not ask the parent for clarification — make
reasonable judgement calls based on the task. If a task is ambiguous, pick
the most likely interpretation, state your assumption in the final answer,
and proceed.

When you finish:
- Lead with the conclusion / answer
- Then a brief log of what you did (key files touched, key findings)
- Then any caveats or risks

Be concise. The parent's context window is precious. Aim for under 400 words.
Cite file paths with line numbers (path:line) instead of pasting large code
blocks.
```

### 8.2 `explore.md`

```markdown
---
name: explore
description: Fast codebase reconnaissance. Use to find files, understand layout, locate symbols, or answer "where is X" questions. Read-only plus shell search commands. Returns compressed findings.
tools: read, grep, find, ls, bash
---

You are an exploration sub-agent. Your job is to find things in the codebase
fast and report back compressed, actionable findings.

You do NOT modify files. Your bash use is restricted to search and inspection
commands (rg, grep, find, ls, cat, git log, git grep, head, tail, wc). Do not
run build commands, tests, or anything that mutates state.

Report format:
- Lead line: direct answer to the question
- File list: `path:line` per match with one-line purpose
- Architectural notes if relevant: 1-3 bullets
- Total length under 300 words

Do NOT paste large code blocks. Cite path:line ranges instead. The parent will
read the file if it needs full content.
```

### 8.3 `plan.md`

```markdown
---
name: plan
description: Implementation planning. Use when you need a step-by-step plan for a feature or refactor. Read-only — does not modify code. Outputs numbered steps, files to touch, risks.
tools: read, grep, find, ls
---

You are a planning sub-agent. You produce implementation plans without
writing code.

Method:
1. Read the relevant code to understand current structure
2. Identify the smallest set of changes that achieves the goal
3. Produce numbered steps, each step actionable in isolation

Output structure:

## Goal
<one paragraph>

## Steps
1. <step> — files: `path/a.ts`, `path/b.ts` — rationale: <one line>
2. ...

## Risks
- <risk and mitigation>

## Open questions
- <only if there is real ambiguity, otherwise omit>

Length: under 500 words. No code blocks unless the plan requires a specific
signature or schema. Tag every file you reference with backticks.
```

### 8.4 `code-reviewer.md`

```markdown
---
name: code-reviewer
description: Code review specialist. Use to review a PR, branch diff, or specific files for correctness, security, performance, and style issues. Read access plus bash for running linters/tests.
tools: read, grep, find, ls, bash
---

You are a code review sub-agent. You evaluate code for correctness, security,
performance, maintainability, and style.

You may run `git diff`, `git log`, linters, type checkers, and test runners
(read-only operations from a review perspective). You do NOT modify files.

Output structure (priority-ordered):

## Critical (must fix before merge)
- `path:line` — <issue> — <suggested fix>

## Important (should fix)
- ...

## Nits (style/preference)
- ...

## Approved
- <list of files reviewed without issues>

Each finding is one line with file:line. No prose paragraphs. Length: under
600 words. If there are zero critical issues, say so explicitly and recommend
approval.
```

### 8.5 Discovery and override rules

`agents/discovery.ts` returns the merged set:

1. Load user agents from `~/.pi/agent/agents/*.md` (always).
2. Load project agents from `<cwd>/.pi/agents/*.md` (only if `agentScope` is `"project"` or `"both"`).
3. Load bundled defaults from `<package_root>/src/agents/defaults/*.md`.
4. Merge with shadowing: a user/project agent with the same name shadows the bundled default. Bundled defaults appear only when no user/project file exists.

**Result:** If the user creates `~/.pi/agent/agents/explore.md`, theirs wins. If they don't, the bundled default is used. pi-crew works out-of-the-box without filesystem touch.

### 8.6 `/subagent install-defaults` command

```
/subagent install-defaults
```

Behavior:
- For each bundled agent, check if `~/.pi/agent/agents/<name>.md` exists.
- If exists: skip with notice "skipped: explore.md (already exists)".
- Otherwise: copy bundled file to `~/.pi/agent/agents/<name>.md` and notify "installed: explore.md".
- After install, the user can edit freely; their version shadows the bundled default going forward.

### 8.7 Project-level agents

Project agents at `<cwd>/.pi/agents/*.md` are loaded only when `config.global.agentScope` is `"project"` or `"both"`. Project agents are repo-controlled and can instruct the model to read files, run bash, etc.

Default `agentScope: "user"` for safety. When `"both"` or `"project"` is set and a sub-agent dispatch references a project-only agent, pi-crew prompts for confirmation (via `ctx.ui.confirm`) the first time per session unless `confirmProjectAgents: false`.

---

## 9. Configuration

### 9.1 Schema

```typescript
interface PiCrewConfig {
  version: 1;
  agents: Record<string, AgentSlot>;     // keyed by agent name
  global: GlobalSettings;
  tmux: TmuxSettings;
}

interface AgentSlot {
  provider: string;              // e.g., "anthropic"
  modelId: string;               // e.g., "claude-haiku-4-5"
  // future-proof; v1 leaves additional slots empty
}

interface GlobalSettings {
  maxConcurrent: number;         // default 4
  maxActive: number;             // default 16
  maxParallelTasksPerCall: number; // default 8
  retentionDays: number;         // default 7
  notifyOnCompletion: boolean;   // default true
  agentScope: "user" | "project" | "both"; // default "user"
  confirmProjectAgents: boolean; // default true
}

interface TmuxSettings {
  mode: "off" | "window" | "external-session"; // default "off"
  killOnComplete: "off" | "after-grace";        // default "off"
  graceSeconds: number;                          // default 30
}
```

Validated by typebox on load. Unknown fields preserved (forward compat).

### 9.2 Persistence

- **Global:** `~/.pi/agent/pi-crew.json`. Created by `/subagent config` on first save.
- **Project:** `<cwd>/.pi/pi-crew.json` (optional). Per-agent slots in project file override global slots; global settings unaffected.

Atomic write via tmp + rename (mode 0644).

### 9.3 `/subagent config` TUI

Opens overlay (`ctx.ui.custom(component, { overlay: true, overlayOptions: { width: "70%", maxHeight: "80%", anchor: "center" }})`).

**Layout:**

```
┌─ pi-crew configuration ───────────────────────────────┐
│                                                        │
│  Agent slots                                           │
│  ▸ general-purpose  →  claude-sonnet-4-5  (anthropic) ✓│
│    explore          →  claude-haiku-4-5   (anthropic) ✓│
│    plan             →  (not set) ✗                     │
│    code-reviewer    →  (not set) ✗                     │
│                                                        │
│  Global                                                │
│    max concurrent   →  4                               │
│    max active       →  16                              │
│    retention days   →  7                               │
│    notify on done   →  yes                             │
│    agent scope      →  user                            │
│                                                        │
│  Tmux                                                  │
│    mode             →  off                             │
│    kill on complete →  off                             │
│                                                        │
│  ↑↓ navigate · enter edit · ctrl+s save · esc cancel  │
└────────────────────────────────────────────────────────┘
```

**Interactions:**

- Arrow keys move selection.
- `Enter` on an agent slot → opens nested `SelectList` of all available models (`ctx.modelRegistry.getAvailable()`), grouped by provider, searchable.
- `Enter` on a numeric global → inline input for new value.
- `Enter` on an enum global (e.g., `agentScope`) → small enum picker.
- `Ctrl-S` → save. Atomic write to `pi-crew.json`. `ctx.ui.notify("Saved", "success")`. Emit `pi.events.emit("pi-crew:config-changed", { before, after, changedKeys })`.
- `Esc` → discard changes (warn if dirty).

### 9.4 Model enumeration

`ctx.modelRegistry.getAvailable(): Model<Api>[]` returns models with auth configured. The selector groups by `model.provider` and sorts each group by name. No shell-out or external calls needed.

### 9.5 First-run heuristic

`config/auto.ts:suggestDefaults(modelRegistry)` returns a `PiCrewConfig` with auto-picked slots. The TUI uses these as pre-filled suggestions.

```
1. Get available models from ctx.modelRegistry.getAvailable().
2. Score:
   - cheap-fast: low cost.input + reasoning=false
   - capable: high cost.input + reasoning=true
3. Suggested slots:
   - explore: cheapest reasoning=false (e.g., claude-haiku-4-5,
     gpt-5.5-mini, gemini-flash equivalent)
   - plan: most capable reasoning model
   - code-reviewer: most capable reasoning model
   - general-purpose: balanced (sonnet over opus when both present)
```

**TUI opens only via `/subagent config`.** Tool calls (`subagent_dispatch`, `subagent_run`) never trigger interactive UI on the user's behalf — they return an error that tells the LLM (and indirectly the user) to run the slash command:

```
Configuration required. Run /subagent config to set models for sub-agents.
Suggested defaults will be pre-filled — just review and save.
```

When the user runs `/subagent config` and the config is missing or any slot is unset, the TUI opens with `suggestDefaults()` results pre-filled. User can confirm with `Ctrl-S` to save the suggestions verbatim, or tweak first.

### 9.6 Validation on session_start

```typescript
on("session_start", async (_event, ctx) => {
  const config = await loadConfig();
  const stale: string[] = [];
  for (const [name, slot] of Object.entries(config.agents)) {
    const exists = ctx.modelRegistry.find(slot.provider, slot.modelId);
    if (!exists) stale.push(name);
  }
  if (stale.length > 0) {
    ctx.ui.notify(
      `pi-crew: model unavailable for ${stale.join(", ")}. ` +
      `Run /subagent config.`,
      "warning"
    );
  }
});
```

Stale slots stay registered but `subagent_dispatch` returns "model unavailable" if the LLM tries to use them.

### 9.7 Editing agent system prompts

For v1, system prompts are edited by opening the agent `.md` in `$EDITOR` directly (`Ctrl-G` in pi opens the editor with the current input; users open `.md` files manually).

v2 may add a markdown editor pane to `/subagent config`.

---

## 10. UI surfaces

Three surfaces share one state watcher.

### 10.1 Shared state watcher

`ui/state-watcher.ts`:

- One `fs.watch` on `~/.pi/agent/subagents/<sessionId>/` directory at extension load.
- Throttle to 250ms (debounce burst writes during streaming).
- 1-second poll fallback: if `fs.watch` fires fewer events in 5 seconds than the count of state.json mtime changes detected by polling, fall through to poll-only mode for the rest of the session and log a `ctx.ui.notify` warning.
- Emits internal event with `SubagentState[]` snapshot.
- Subscribers (widget, footer, overlay) attach via `subscribe(callback) → unsubscribe`.
- Memoizes parsed states by `(path, mtime)` — skips re-parse if file unchanged.

### 10.2 Widget (auto-show, above editor)

```typescript
ctx.ui.setWidget("pi-crew", (tui, theme) => ({
  render: (width) => renderWidgetLines(states, width, theme),
  invalidate: () => { /* clear cached render */ }
}));
```

**Auto-show rules:**
- ≥1 state with `status === "starting" | "running"` → widget visible.
- All terminal → keep visible 10s grace, then `setWidget("pi-crew", undefined)`.
- Reappears on next dispatch.

**Layout:**

```
─── pi-crew (2 running, 1 done) ─────────────────────────
  ⏳ explore #a1b2 → find auth code        ↑8k cwd=. main
  ⏳ plan #e5f6    → design retry          ↑15k cwd=api feat-x
  ✓ reviewer #g7h8 → review PR 42          ↑12k done 4s
──────────────────────────────────────────────────────────
```

- Status icons themed.
- Truncate per-line via `truncateToWidth`.
- Cap at 10 rows. If more, last line is `… +N more (run /subagents)`.
- Sort: running first (oldest dispatch first), then done desc by finish time.

### 10.3 Footer status

```typescript
ctx.ui.setStatus("pi-crew", computeStatusLine(states, theme));
```

One line: `⟳ 2 running · 1 done · 0 failed`. Cleared when no states.

### 10.4 Tree overlay — `/subagents`

Custom component implementing `Component + Focusable`. Opens via `ctx.ui.custom(component, { overlay: true, overlayOptions: { width: "80%", maxHeight: "80%", anchor: "center" } })`.

**Layout:** split top (tree, scrollable) / bottom (detail pane).

```
┌─ pi-crew tree ───────────────────────────────── 3/8 ─┐
│  ▸ ⏳ explore #a1b2  find all auth code              │
│      cwd=.  branch=main  ↑8k ↓2k  4 turns  $0.0021   │
│      last tool: grep /JWT/ in src/                    │
│                                                       │
│    └─ ⏳ explore #c3d4  check session module          │
│         cwd=.  branch=main  ↑3k ↓500  1 turn          │
│                                                       │
│  ▸ ✓ plan #e5f6  design retry strategy                │
│      cwd=api  branch=feat-x  ↑15k ↓4k  done 12s       │
│                                                       │
│  ▸ ✗ code-reviewer #g7h8  review PR 42                │
│      error: rate limit exceeded                       │
├─ details ──────────────────────────────────────────── │
│ <selected node's full task, tool calls, final output>│
└─ ↑↓ nav · enter expand · k kill · o output · esc ───┘
```

**Tree construction:**
- Top-level nodes: `parentAgentId === null`.
- Children: `parentAgentId === parent.agentId`.
- Collapsed by default; expand on demand.
- Live-updating: state-watcher → re-render.

**Keys:**

| Key | Action |
|---|---|
| `↑`/`↓` | Move selection in tree |
| `Enter` | Toggle node expansion |
| `Tab` | Toggle focus between tree and detail pane |
| `k` | Kill selected (running only) — confirmation prompt |
| `o` | Open `output.jsonl` in `$PAGER` |
| `c` | Copy selected `agentId` to clipboard (OSC 52) |
| `r` | Re-run with same task (dispatch new sub-agent) |
| `x` | Clean up — delete state files for terminal node |
| `esc` | Close overlay |
| `?` | Show keymap help |

### 10.5 Tmux modes

When `config.tmux.mode != "off"`, after `dispatch` completes step 9 (subprocess spawned, state written), `runtime/tmux.ts:launchTmuxView(state, mode)` runs.

#### `window` mode

Requires `$TMUX` env var. Launches:

```
tmux new-window -t pi-crew-<sessionId> -n <agent>-<agentId> \
  "node <pkg-root>/src/cli/tail.ts <output_path>"
```

If session `pi-crew-<sessionId>` doesn't exist within current server, `new-window` falls back to `new-session -d -s pi-crew-<sessionId>` first, then linking the window — actually we use the user's current session if `$TMUX` is set:

```
tmux new-window -n <agent>-<agentId> \
  "node <pkg-root>/src/cli/tail.ts <output_path>"
```

(creates window in user's current tmux session).

If `$TMUX` is unset, log warning and fall through to `external-session`.

#### `external-session` mode

Always works, no `$TMUX` requirement:

```
SESSION="pi-crew-<sessionId>"
if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  tmux new-session -d -s "$SESSION" -n "main" "echo pi-crew session; sleep infinity"
fi
tmux new-window -t "$SESSION" -n <agent>-<agentId> \
  "node <pkg-root>/src/cli/tail.ts <output_path>"
```

User attaches with `tmux attach -t pi-crew-<sessionId>`.

#### Cleanup

When `config.tmux.killOnComplete = "after-grace"`:
- On `pi-crew:end` event for that agent, after `config.tmux.graceSeconds` (default 30s), pi-crew runs:
  ```
  tmux kill-window -t <session>:<agent>-<agentId>
  ```

When `"off"` (default), windows persist for user inspection; user closes manually.

#### Failure handling

- `tmux` binary missing → log warning at extension load; force `mode = "off"` for session.
- `tmux new-window` fails → log warning, continue without tmux view (sub-agent still runs).

### 10.6 `pi-crew tail` CLI

Standalone Node script that follows a JSONL file and renders events to terminal. Reused for tmux views.

```
Usage: pi-crew tail <output.jsonl>

Tails the JSONL stream from a sub-agent's subprocess and renders:
  - assistant text (white)
  - tool calls (cyan, formatted via formatToolCall)
  - tool results (dim, truncated)
  - errors (red)
  - usage summary at bottom (dim)

Exits when the producing process closes the file (subprocess ends).
```

Implementation: `fs.createReadStream` with `start: 0`, polling for new bytes via `fs.watch` + `fs.statSync` fallback. Uses the same `runtime/jsonl.ts` parser and `ui/format.ts` helpers.

**Invocation strategy:** to run a TypeScript source file from a tmux command (where the host environment is a fresh shell, not pi's jiti context), the implementation will choose one of:

1. **Precompile `tail.ts` → `dist/cli/tail.js`** as part of the package's prepare step (small `tsc` build); tmux runs `node <pkg>/dist/cli/tail.js <output_path>`. Adds a build step but produces a stable `bin` entry.
2. **Use jiti directly:** tmux runs `node --import @mariozechner/pi-coding-agent/dist/jiti.js <pkg>/src/cli/tail.ts <output_path>`. No build step but couples to pi's internal jiti shim.
3. **Use Node 22+ type-stripping:** `node --experimental-strip-types <pkg>/src/cli/tail.ts <output_path>`. Cleanest if Node 22+ is required.

Decision deferred to implementation phase. Default plan: option 1 (precompile) — most stable. Build artifact lives in `dist/cli/tail.js` and is included via the `package.json` `files` field.

---

## 11. LLM self-documentation (tool descriptions + system prompt)

The LLM only knows what we tell it. To minimize per-turn context cost, cross-cutting information is in the system prompt append (paid once per session, cached). Tool descriptions are minimal — what the tool does + args + return shape.

### 11.1 Tool descriptions

#### `subagent_dispatch`

```
Dispatch a sub-agent in the background. Returns agentId immediately.
Args: { agent, task, cwd?, maxTurns? }
Available agents: see "pi-crew" section in system prompt.
Completion is auto-pushed into this conversation when the sub-agent finishes.
```

#### `subagent_run`

```
Run sub-agent(s) and BLOCK until done. Use only when the next step depends on the result.
Args: { agent, task } | { tasks: [...] } | { chain: [...] with {previous} placeholder }
Returns final assistant text. Prefer subagent_dispatch unless sequential.
```

#### `subagent_status`

```
Peek at running/recent sub-agents. Returns { agentId, agent, task, status, lastText, usage, paths }.
Args: { agentId? } | { scope?: "active"|"session"|"all" }
For full transcript, read paths.output (a JSONL file).
```

#### `subagent_wait`

```
Block until specified sub-agents finish, then return final outputs.
Args: { agentIds: string[], timeoutMs? }
```

#### `subagent_kill`

```
Abort a running sub-agent (SIGTERM, then SIGKILL after 5s).
Args: { agentId, reason? }
```

### 11.2 System prompt append (`before_agent_start`)

Static block, ~250 tokens. Inserted into system prompt for every turn the extension is loaded. Cached in prompt cache.

```
## pi-crew sub-agents

You can delegate tasks to specialized sub-agents that run in isolated
processes with their own context windows. Use this to keep your context
window clean while heavy work happens elsewhere.

When to delegate:
  - Codebase reconnaissance ("where is X", "find all Y") → use `explore`
  - Multi-file refactor planning → use `plan`
  - Code review of a diff or files → use `code-reviewer`
  - Anything else needing isolation or large search → use `general-purpose`

Dispatch model:
  - Default: `subagent_dispatch` (background) — returns immediately, you
    keep working. Completion is auto-injected into this conversation.
  - Sequential: `subagent_run` (blocks) — for chain mode where step N+1
    needs step N's full output.
  - Parallel: `subagent_run` with `tasks: [...]` — fans out, gathers.

Tracking:
  - `subagent_status` — peek at running/completed sub-agents.
  - `subagent_wait` — block on specific ids when you need their result.
  - `subagent_kill` — abort if you change your mind.

State directory:
  ~/.pi/agent/subagents/<sessionId>/<agentId>/
    state.json     — live snapshot (status, usage, last activity)
    output.jsonl   — full subprocess JSONL stream (assistant turns,
                     tool calls, results) — read this for the full
                     trajectory if status doesn't tell you enough.
    stderr.log     — subprocess stderr for debugging.
    prompt.md      — exact system prompt the sub-agent ran with.

Available agents:
  general-purpose: General delegation. Full tool access.
  explore: Codebase recon, read-only-ish, returns compressed findings.
  plan: Implementation planning, read-only.
  code-reviewer: Code review, can run linters/tests.
  (Slots ✗ not configured: <list, generated dynamically>)

When delegating: keep tasks specific and self-contained. The sub-agent has
no memory of this conversation — give it everything it needs in the task
text. Sub-agents return only their final assistant text — keep their
prompts focused so they don't bloat your context with verbose summaries.
```

The "Available agents" section is regenerated by the `before_agent_start` handler so the live agent list and configuration status are always accurate.

### 11.3 Estimated context cost

| Item | Tokens (approximate, per turn) |
|---|---|
| 5 tool descriptions | ~150-200 |
| System prompt append (one block) | ~250-300 |
| **Total persistent footprint** | **~400-500** |

### 11.4 Completion notification format

For a successful sub-agent:

```
✓ subagent <agent> #<agentId> finished (<modelId>, <turns> turns, $<cost>).

<final assistant text from sub-agent, verbatim>

Full transcript: ~/.pi/agent/subagents/<sess>/<agentId>/output.jsonl
State: ~/.pi/agent/subagents/<sess>/<agentId>/state.json
```

For a failed sub-agent:

```
✗ subagent <agent> #<agentId> failed (exit <code>, "<errorMessage>").
Stderr: ~/.pi/agent/subagents/<sess>/<agentId>/stderr.log
State: ~/.pi/agent/subagents/<sess>/<agentId>/state.json
```

For aborted:

```
✗ subagent <agent> #<agentId> aborted: <reason>.
State: ~/.pi/agent/subagents/<sess>/<agentId>/state.json
```

### 11.5 Batched notifications

If multiple sub-agents finish within a 2-second window, pi-crew batches them into a single message:

```
Sub-agent batch update:
  ✓ explore #a1b2 done (4 turns, $0.0021)
  ✓ plan #e5f6 done (8 turns, $0.012)
  ✗ code-reviewer #g7h8 failed: rate limit

Details for each:
  - #a1b2: <first 200 chars of finalOutput>
    Full: ~/.pi/agent/subagents/<sess>/a1b2/output.jsonl
  - #e5f6: <first 200 chars>
    Full: ~/.pi/agent/subagents/<sess>/e5f6/output.jsonl
  - #g7h8: <error>
    Stderr: ~/.pi/agent/subagents/<sess>/g7h8/stderr.log
```

Implementation: a 2-second timer per main session. Each `pi-crew:end` event is queued. After the timer fires, all queued events are formatted into one `pi.sendMessage` call.

---

## 12. Persistence

### 12.1 Directory layout

```
~/.pi/agent/subagents/
├── <sessionId>/                  ← parent main-session uuid
│   ├── <agentId>/                ← 8-char hex
│   │   ├── state.json            ← live status snapshot (atomically rewritten)
│   │   ├── output.jsonl          ← raw subprocess stdout (direct fd)
│   │   ├── stderr.log            ← subprocess stderr (direct fd)
│   │   └── prompt.md             ← system prompt body (mode 0600)
│   └── <agentId>/...
└── <sessionId>/...
```

For ephemeral / in-memory sessions: `sessionId = "ephemeral-<startTimestamp>"`.

### 12.2 `state.json` schema

```typescript
interface SubagentState {
  // identity
  schemaVersion: 1;
  agentId: string;                       // 8-char hex
  parentAgentId: string | null;          // null if dispatched from main session
  sessionId: string;                     // main session uuid
  agent: string;                         // agent name (e.g., "explore")
  agentSource: "user" | "project" | "bundled";

  // input
  task: string;                          // verbatim task text
  cwd: string;                           // absolute working directory
  branch: string | null;                 // git branch at spawn (null if not a repo)
  model: string;                         // resolved modelId
  provider: string;                      // resolved provider
  tools: string[] | null;                // tool filter (null = inherit pi default)
  maxTurns: number | null;               // optional ceiling

  // process
  pid: number | null;                    // null until spawned
  startedAt: number;                     // ms epoch
  finishedAt: number | null;
  lastUpdate: number;

  // status
  status:
    | "starting"
    | "running"
    | "done"
    | "failed"
    | "aborted"
    | "orphaned"
    | "detached";
  exitCode: number | null;
  stopReason: string | null;
  errorMessage: string | null;

  // progress
  turns: number;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    contextTokens: number;
  };
  lastText: string | null;               // ≤ 500 chars
  lastToolCall: { name: string; args: Record<string, unknown> } | null;
  finalOutput: string | null;

  // file pointers
  paths: {
    state: string;
    output: string;
    stderr: string;
    prompt: string;
  };
}
```

### 12.3 Atomic writes

```typescript
async function writeState(state: SubagentState): Promise<void> {
  const dir = path.dirname(state.paths.state);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = state.paths.state + ".tmp";
  await fs.promises.writeFile(tmp, JSON.stringify(state, null, 2), {
    encoding: "utf-8", mode: 0o600,
  });
  await fs.promises.rename(tmp, state.paths.state); // atomic on POSIX
}
```

### 12.4 Read-modify-write under concurrency

Only one writer per agentId (the lifecycle controller for that sub-agent in the parent process). No multi-writer races by design. Other readers (status tool, widget, overlay) are read-only.

For safety against torn reads:

```typescript
async function readState(p: string): Promise<SubagentState | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await fs.promises.readFile(p, "utf-8");
      return JSON.parse(raw) as SubagentState;
    } catch (err: any) {
      if (err.code === "ENOENT" || err instanceof SyntaxError) {
        await new Promise(r => setTimeout(r, 50));
        continue;
      }
      throw err;
    }
  }
  return null;
}
```

### 12.5 `output.jsonl` and `stderr.log`

Both opened with `fs.openSync(path, "a")` and passed to `child_process.spawn` as direct `stdio` file descriptors. Subprocess writes directly to file. Parent does not relay.

For state updates, the parent opens a separate **read** file descriptor on `output.jsonl` and tails it. This is independent of the subprocess's write fd.

### 12.6 `prompt.md`

Written once before spawn (mode 0600). Passed via `--append-system-prompt <path>`. Kept on disk after spawn for audit. Cleaned by retention sweep.

### 12.7 Retention sweep

Runs on `session_start`:

```typescript
async function sweep(config: PiCrewConfig): Promise<SweepReport> {
  const root = path.join(piAgentDir, "subagents");
  if (!fs.existsSync(root)) return emptyReport();
  const sessions = await fs.promises.readdir(root);
  const cutoff = Date.now() - config.global.retentionDays * 86400_000;
  const report = { swept: 0, orphans: 0, errors: 0 };

  for (const sessionDir of sessions) {
    for (const agentDir of await fs.promises.readdir(path.join(root, sessionDir))) {
      const statePath = path.join(root, sessionDir, agentDir, "state.json");
      const state = await readState(statePath);
      if (!state) continue;

      // 1. orphan detection (covers both "running" and "detached" with dead pid)
      if ((state.status === "running" || state.status === "detached") && !pidAlive(state.pid)) {
        state.status = "orphaned";
        state.errorMessage = "subprocess died without writing exit; pid no longer exists";
        state.finishedAt = Date.now();
        await writeState(state);
        report.orphans++;
      }

      // 2. retention
      if (isTerminal(state.status) && state.finishedAt && state.finishedAt < cutoff) {
        await fs.promises.rm(path.dirname(statePath), { recursive: true });
        report.swept++;
      }
    }
    const remaining = await fs.promises.readdir(path.join(root, sessionDir));
    if (remaining.length === 0) {
      await fs.promises.rmdir(path.join(root, sessionDir));
    }
  }
  return report;
}

function pidAlive(pid: number | null): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e: any) { return e.code === "EPERM"; }
}

function isTerminal(s: SubagentState["status"]): boolean {
  return s === "done" || s === "failed" || s === "aborted" || s === "orphaned" || s === "detached";
}
```

Result reported via `ctx.ui.notify("pi-crew swept: 4 expired, 1 orphan recovered", "info")` (only when non-zero).

### 12.8 Recovery on session_start

```typescript
on("session_start", async (event, ctx) => {
  await sweep(config);
  // Mark sub-agents from prior session as detached (only if status == "running" and pid still exists).
  // Detached state files are still readable; future sessions can inspect output.jsonl.
});
```

### 12.9 Cleanup on session_shutdown

```typescript
on("session_shutdown", async (event, ctx) => {
  // Close fs.watch handles.
  // For each "running" state in this session, mark as "detached" and stop tracking.
  // Do NOT kill running sub-agents — let them finish (their state.json will not be updated further).
});
```

After main pi exit, in-flight sub-agents continue running but their `state.json` is no longer updated. `output.jsonl` continues filling (subprocess writes directly via inherited fd). When the subprocess eventually exits, its parent (the main pi) is gone — there is no one to write the final state. Orphan detection on next session_start fixes the status.

This is an accepted limitation. v2 may introduce a supervisor process that survives parent death.

---

## 13. Hook events / cross-extension API

### 13.1 Events emitted on `pi.events`

| Event | When | Payload |
|---|---|---|
| `pi-crew:dispatch` | After state.json initial write, before spawn | `{ agentId, parentAgentId, agent, task, cwd, model, provider, sessionId }` |
| `pi-crew:start` | Subprocess spawned, pid known | `{ agentId, pid }` |
| `pi-crew:end` | Terminal status reached | `{ agentId, status, exitCode, stopReason, finalOutput, usage, errorMessage }` |
| `pi-crew:killed` | After successful kill | `{ agentId, reason, killed: boolean }` |
| `pi-crew:orphaned` | Sweep detects dead pid mid-running | `{ agentId, lastUpdate, pid }` |
| `pi-crew:detached` | Main session shutting down with running sub-agents | `{ agentId }` |
| `pi-crew:config-changed` | After `/subagent config` save | `{ before, after, changedKeys: string[] }` |

`pi-crew:update` (per-turn streaming progress) is **not** emitted in v1. Subscribers wanting live progress can `fs.watch` the state directory directly. Re-evaluate for v2.

### 13.2 Subscriber example

```typescript
// In another extension
import type { PiCrewEndEvent } from "@leninkhaidem/pi-crew";

export default function (pi: ExtensionAPI) {
  pi.events.on("pi-crew:end", (e: PiCrewEndEvent) => {
    if (e.status === "failed") {
      console.error(`Sub-agent ${e.agentId} failed: ${e.errorMessage}`);
    }
  });
}
```

### 13.3 Programmatic API

pi-crew exports a small programmatic surface for other extensions or scripts:

```typescript
import {
  dispatchSubagent,
  getSubagentState,
  listSubagentStates,
  waitForSubagent,
  killSubagent,
} from "@leninkhaidem/pi-crew";

// In another extension's handler:
pi.on("session_start", async (_event, ctx) => {
  const { agentId } = await dispatchSubagent({
    agent: "explore",
    task: "find auth code",
    ctx,
    pi,
  });
  // ...
});
```

Same machinery as registered tools; just exposed as functions. Useful for:
- Custom slash commands wrapping dispatch with prefilled task templates.
- Workflow extensions chaining sub-agents conditionally.
- Vitest tests.

### 13.4 Type re-exports

`src/types.ts` is exposed via the package's `exports` field as `@leninkhaidem/pi-crew/events`:

```typescript
export type {
  AgentConfig,
  SubagentState,
  PiCrewConfig,
  AgentSlot,
  PiCrewDispatchEvent,
  PiCrewStartEvent,
  PiCrewEndEvent,
  PiCrewKilledEvent,
  PiCrewOrphanedEvent,
  PiCrewDetachedEvent,
  PiCrewConfigChangedEvent,
} from "./types.js";
```

---

## 14. Testing strategy

### 14.1 Unit tests (`test/unit/`, vitest)

| File | Covers |
|---|---|
| `state-store.test.ts` | atomic write (tmp + rename), torn-read retry, schema validation |
| `jsonl-parser.test.ts` | line buffering across chunks, malformed lines, unicode |
| `agent-discovery.test.ts` | bundled defaults, user override, project shadow, scope filters |
| `config-store.test.ts` | load/save, schema validation, model-availability check |
| `sweep.test.ts` | retention math, orphan detection (mocked `process.kill`) |
| `state-paths.test.ts` | path computation, sessionId edge cases (ephemeral) |
| `widget-render.test.ts` | snapshot tests for various state combos |
| `notify-message.test.ts` | message text format for done/failed/aborted/batched |
| `tmux.test.ts` | argv generation for `window` and `external-session` modes |

### 14.2 Integration tests (`test/integration/`, vitest)

Use a mock pi binary that emits canned JSONL events:

| File | Covers |
|---|---|
| `dispatch-roundtrip.test.ts` | full lifecycle with mock pi: dispatch → stream → finalize |
| `kill.test.ts` | SIGTERM path, SIGKILL fallback timing |
| `parallel.test.ts` | dispatch 4, all complete, state files updated |
| `chain.test.ts` | `{previous}` substitution, fail-fast on step error |
| `recovery.test.ts` | start with stale state files, sweep flips them |
| `notify-batching.test.ts` | 3 ends within 2s → single batched message |

Mock pi binary: `test/fixtures/mock-pi.ts` consumes argv, prints canned JSONL to stdout matching the schema in §7.2, exits with configurable code.

### 14.3 Smoke tests (`test/smoke/`)

Real `pi` binary (already installed at `/home/lenin/.local/bin/pi`). Skipped by default; run with `PI_CREW_E2E=1`:

```bash
PI_CREW_E2E=1 npm test test/smoke
```

Coverage:
- Real `pi -p --mode json --no-session` invocation.
- Real `--append-system-prompt` with file path.
- Real `--tools` allowlist enforcement.
- Real model selection via `--model` and `--provider`.
- Real `pi.events` propagation in a parent pi instance running pi-crew.
- Real tmux launch (skipped if `tmux` not installed).

Smoke tests run before tagging a release.

### 14.4 No CI

GitHub Actions deferred. Author runs tests locally before each commit and before tagging releases.

---

## 15. Repo / packaging / distribution

### 15.1 Repo

- **Path:** `github.com/leninkhaidem/pi-crew`
- **Visibility:** private until v0.1 ships and is verified.
- **Tooling:** `gh` CLI is authenticated. Repo creation deferred to plan/implementation phase via:
  ```
  gh repo create leninkhaidem/pi-crew --private --source . --description "Sub-agent extension for pi"
  ```

### 15.2 `package.json` skeleton

```json
{
  "name": "@leninkhaidem/pi-crew",
  "version": "0.1.0",
  "description": "Sub-agent extension for the pi coding assistant",
  "private": false,
  "license": "MIT",
  "repository": "github:leninkhaidem/pi-crew",
  "keywords": ["pi-package", "pi-extension", "subagent"],
  "type": "module",
  "main": "src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./events": "./src/types.ts"
  },
  "bin": {
    "pi-crew-tail": "./dist/cli/tail.js"
  },
  "files": ["src", "dist", "README.md", "LICENSE", "CHANGELOG.md"],
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "tsc -p tsconfig.build.json",
    "prepare": "npm run build",
    "lint": "biome check .",
    "format": "biome format --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "PI_CREW_E2E=1 vitest run test/smoke"
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-agent-core": "*",
    "@mariozechner/pi-tui": "*",
    "typebox": "*"
  },
  "devDependencies": {
    "@biomejs/biome": "^1",
    "@types/node": "^20",
    "typescript": "^5",
    "vitest": "^1"
  }
}
```

### 15.3 Tooling

- **Language:** TypeScript.
- **Extension entry (`src/index.ts`)** loaded by pi via jiti, no bundling — this is pi's standard extension loading path.
- **Standalone CLI (`pi-crew-tail`)** precompiled to `dist/cli/tail.js` by `npm run build` (and `npm prepare` on install). Runs in plain node — no jiti available. Compile step is the only build artifact published.
- **Lint/format:** Biome (matches pi-mono).
- **Tests:** Vitest.
- **Versioning:** semver tags (`v0.1.0`). Manual release.

### 15.4 Installation by users

```
pi install git:github.com/leninkhaidem/pi-crew@v0.1.0
```

For the private repo phase, users must have SSH or PAT access:

```
pi install git:git@github.com:leninkhaidem/pi-crew@v0.1.0
```

After install, on first run pi-crew prompts the user to run `/subagent config` to configure model slots.

### 15.5 Release workflow (manual)

```
# 1. local verification
npm run typecheck
npm run lint
npm test
PI_CREW_E2E=1 npm run test:e2e

# 2. tag
npm version 0.1.0
git push --follow-tags origin main

# 3. release notes
gh release create v0.1.0 --notes-file CHANGELOG.md --draft
# review draft, publish
```

---

## 16. Open risks (resolved during brainstorm)

| Risk | Resolution |
|---|---|
| Model enumeration API availability | ✅ `ctx.modelRegistry.getAvailable()` is documented and tested. Returns `Model<Api>[]` filtered by configured auth. |
| Pi flag combination `-p --mode json --no-session --append-system-prompt --tools --model` | ✅ Verified end-to-end with pi 0.70.2. Default provider `openai-codex` with gpt-5.5; user's authenticated providers determine available models. |
| Skill access in subprocess | ✅ Subprocess is a real pi instance. Skills loaded normally via pi's own discovery (`~/.pi/agent/skills/`, project, packages). No special wiring needed. |
| Completion notification API | ✅ `pi.sendMessage(message, options)` directly on `ExtensionAPI` (verified in `dist/core/extensions/types.d.ts:817`). `ReadonlySessionManager` on `ctx` cannot write — `pi.sendMessage` is the public path. |
| `pi.events` API surface | ✅ `events.emit(channel: string, data: unknown)` and `events.on(channel, handler) => unsubscribe()` (verified in `dist/core/event-bus.d.ts`). |
| `--list-models` JSON output | ⚠️ Plain text only. Mitigated: `ctx.modelRegistry.getAvailable()` is in-process, not needed. |
| `fs.watch` reliability on macOS | Documented. Polling fallback every 1s if event count looks suspiciously low. |
| Project agent discovery | ✅ PI's existing `subagent/` example uses `.pi/agents/*.md` with `agentScope` flag. We adopt the same pattern. |

---

## 17. Glossary

- **Sub-agent:** an isolated pi process spawned via `pi -p --mode json --no-session`, given a focused system prompt and tool allowlist, executing a single task.
- **Agent (definition):** a `.md` file with frontmatter (`name`, `description`, `tools`) and a system prompt body. Located at `~/.pi/agent/agents/`, `<cwd>/.pi/agents/`, or bundled defaults.
- **Slot:** the user's configured choice of `(provider, modelId)` for a particular agent name. Stored in `pi-crew.json`.
- **agentId:** an 8-character hex identifier for one specific sub-agent invocation. Globally unique per `~/.pi/agent/subagents/`.
- **sessionId:** the main pi session's UUID. Sub-agents are organized under their parent session's directory.
- **Push notification:** a `CustomMessageEntry` injected into the main session via `pi.sendMessage` so the main agent sees the result in its next-turn context.
- **Detached:** a sub-agent whose parent main session ended while it was still running. Its state file remains; no further updates land in `state.json`. On next session_start sweep, if the pid is dead, status is flipped to `orphaned`. The full transcript stays available in `output.jsonl` for inspection (no automatic state reconstruction).
- **Orphaned:** a sub-agent recorded as `running` but whose pid is no longer alive, detected by retention sweep.

---

## 18. References

- pi-coding-agent extension docs: `/home/lenin/.local/lib/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`
- pi subagent example: `/home/lenin/.local/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/subagent/`
- pi session format: `/home/lenin/.local/lib/node_modules/@mariozechner/pi-coding-agent/docs/session.md`
- pi TUI components: `/home/lenin/.local/lib/node_modules/@mariozechner/pi-coding-agent/docs/tui.md`
- pi packages docs: `/home/lenin/.local/lib/node_modules/@mariozechner/pi-coding-agent/docs/packages.md`
- pi custom providers: `/home/lenin/.local/lib/node_modules/@mariozechner/pi-coding-agent/docs/custom-provider.md`
- pi `ExtensionAPI` typedef: `/home/lenin/.local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts`
- Claude Code Agent SDK reference: https://code.claude.com/docs/en/agent-sdk/typescript.md
- pi binary: `/home/lenin/.local/bin/pi` (version 0.70.2)
