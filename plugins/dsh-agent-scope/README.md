# dsh-agent-scope

Workspace-scoped named sub-agents for DeepSeek Harness. Adds a **子智能体** page to Settings that creates, edits, and removes delegation targets at one of two scopes:

- **全局 (global)** — every session may delegate to it.
- **工作区 (workspace)** — only sessions whose canonical working directory is that workspace or a directory below it may delegate to it.

Each definition becomes one real delegation target named after it, mounted through the official [`@deepseek-ai/dsh-tool-subagent`](../../packages/subagent/tool-subagent/README.md) row.

## Why this exists

DSH composes delegation tools per **preset**, and every such row is authored YAML: `dsh-tool-subagent` takes a `persona`, a `toolFilter`, and `agentOptions`, but a person who wants "a code reviewer and a doc writer, the second one only in my docs repo" has nowhere to write that except a composition file, and no way to give two definitions different scopes. This plugin supplies the store, the Settings page, and the workspace dimension; it does not reimplement delegation.

## How a definition becomes a sub-agent

One stored definition is one mounted row:

```yaml
- name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
    toolName: <definition name>
    backgroundMode: continuable
    persona: <system prompt>
    toolFilter: { allow: [...] }        # only when tool access is "selected tools"
    agentOptions: { provider, model }   # only when a route is pinned
```

Everything after that — provider capability checks, child composition, the depth cap, background settlement, and the continuation inbox — stays owned by the official row. This plugin owns the store, the scope of each definition, the Settings page, and the model-facing catalog described below.

A definition's persona is its system prompt alone. Instruction files are **not** read here: the deployment's own `dsh-agent-instructions` row already injects the `AGENTS.md` chain for every agent, and a child inherits its parent's cwd ([`child-agent.ts`](../../packages/subagent/subagent/src/child-agent.ts)) and preset, so a sub-agent already receives its workspace's instructions with digest-based change tracking and the deployment's byte budget. Reading the file again here would flatten it into the persona at mount time and inject it twice.

`backgroundMode: continuable` matches the deployment's own `subagent` row: a delegation returns a durable child id immediately and the runtime delivers a settlement notice, so a long review never blocks the parent turn. `modelSelectionSettings` stays off because a definition owns a fixed route; the deployment row already registers the one global `list_subagent_models` tool.

## How scope is enforced

Every enabled definition is mounted **once** on the root context. Isolation happens per session, the same way `dsh-mcp-scope` scopes MCP servers:

1. `agent/created` fires with the new agent.
2. The plugin reads the session's canonical cwd from `agent.session.header.cwd`.
3. Definitions whose scope is a workspace the session is not in contribute their tool names to a deny list.
4. The deny list is applied with `agent.ctx.tools.restrict({ deny })`, which requires exactly that agent-scoped context. The disposer is held per agent and lifted on `agent/disposed` or replaced on the next sweep.

A `tools/change` sweep re-runs that mask, because a delegation tool appears only after the official row's own `apply` — an agent created while a definition was still mounting would otherwise hold an incomplete deny list.

## What the model sees

The official row's tool description is fixed wording derived from the provider, so a definition's **描述** would never reach the model through the tool schema. The plugin therefore registers one prompt section per agent, at the `TOOL_SUBAGENT` order, listing only the definitions inside that session's scope:

```
Named sub-agents are configured for this session. Delegate to one by calling the tool
named after it; the child runs in its own context and returns its own result.

- `code_reviewer` — Reviews a diff for correctness bugs and missing tests.
- `researcher` — Searches the web and summarises findings. (model: deepseek-official/deepseek-flash)
```

The section is registered in the agent's own scope, so it unwinds with the session, and it is skipped for child agents: a sub-agent's own depth cap refuses nested delegation, so advertising the tools there would invite a call that cannot succeed.

## The Settings page

The page lists the stored definitions. The toolbar's scope selector narrows the list to one scope and its count follows that filter, while the section count also answers the search box, so the two differ only while searching. A definition created while the list is filtered to one workspace starts in that workspace: the filter is what the person is looking at. A row shows the definition's colour marker in its tile, its scope, model, and tool policy as chips, the model-facing description, a switch for the enable flag, and a delete button that arms on the first click and deletes on the second; clicking the row body opens the editor. The name *is* the slash command, so the row does not repeat it — the composer's `/` menu is where it is listed. That delete is the shared `IconTrashOutline16` in a button with no box of its own — the shape the Models page rows use — painted only while the pointer is on it and tinted red once armed.

Every dropdown — the toolbar's scope selector and the editor's scope and model fields — is the shared `Menu` primitive from `@deepseek-ai/dsh-client-ui-primitives`, the same control the 通用设置 rows open. A native `<select>` popup is drawn by the operating system and cannot follow the application theme, so in the dark theme its highlighted row rendered white-on-light and the options were unreadable. The model list keeps its provider headings as the primitive's non-selectable label rows.

## Tests

`tests/scope.test.mjs` pins the scope rules — `global`, or an absolute path in the spelling the running platform uses, which is what a Windows `D:\...` workspace needed. `tests/select.client.test.mjs` boots the browser half in jsdom and drives the editor's dropdowns: no native select may return, the scope rows follow the workspace registry, and the model list keeps its provider headings and saves the route it selected. It also drives a row's delete button, which arms on the first click and removes on the second, and the plugin's own `/` source — which answers inside a draft and never at its head, and settles a pick by inserting the catalog name as text.

```sh
node --test "plugins/dsh-agent-scope/tests/*.test.mjs"
```

## Slash commands

Every enabled definition is also a command, so a person can wake that sub-agent without asking the model to:

```
/code-reviewer 检查这段 diff 的并发问题
```

The command is registered through a child of each agent's own context, which is what scopes it: a session only ever offers the definitions inside its own scope, so the `/` menu lists exactly what that session may use, with each definition's description beside its name. Out-of-scope sub-agents are absent from the menu rather than failing when invoked.

A definition's command declares an input hint, so it needs a task: picking the row from the `/` menu **claims** the command and leaves `/name ` in the composer for the task (its placeholder says so), and only the next Enter dispatches it. Typing the whole line at once — menu closed by the space — dispatches on a single Enter.

A `/name` written **inside a sentence** is a different intent, and the host command source does not offer one: an argument-taking command claims the whole line, so the message it submits is the command alone and anything typed before the name would be discarded. The plugin therefore registers its own `/` source — the menu group 子智能体 — which answers only away from the head of the draft, lists the same enabled definitions, and settles a pick by inserting the catalog name as plain text. This keeps

```
需求：xxx。先让 /system-architect 设计架构，它出结果后再让 /ui-designer 设计 UI，
最后交给 /code-reviewer 检查。
```

as one message: the names reach the model as text, and the model delegates through the tools of the same names. Nothing is claimed and no command runs from the composer. At the head of the draft the source contributes nothing, so a leading `/name` behaves exactly as described above.

In a session that has not produced anything yet, a command still executes host-side, but the Web client has no materialized conversation to render its result into, so only a transient notice shows. Sending the task with the command avoids that: the child it starts gives the session something to render, and the settlement notice then arrives as a normal message.

Issuing a command from a Session the panel has not opened — the new-Session composer is the common case — also opens that Session, because the command's row lands in the Session log rather than the panel currently on screen. The panel would otherwise keep rendering the empty-Session hero while the sidebar marked the Session running, which reads as "the command did nothing".

A command **dispatches the definition's own mounted delegation tool** through the official tool pipeline rather than starting a child itself. One owner keeps child composition, depth policy, and settlement, and a human invocation then behaves like a model one:

1. The tool returns as soon as the child accepts its prompt, so the command answers with `已启动子智能体 <name>（<id>）` and the composer frees immediately. A command that waited for the child would hold the composer's frozen in-flight slot for the child's whole run.
2. The child runs in the background as a durable, continuable conversation.
3. When it settles, the runtime delivers a settlement notice to this session containing the child's closing message and wakes the agent with it. The sub-agent's work therefore lands in the conversation and the main agent continues from it, instead of ending at a command result the model never sees.

That third step is the reason the command does not simply print the child's answer: a command result is a direct UI outcome, never a model message, so a printed answer would leave the main session with the sub-agent's findings and nothing to do with them.

Two consequences are worth knowing:

- **The name is both a tool and a command.** A definition named `read` is refused at Save (a tool name is taken), and one named `compact` is refused too (a command name is in use) — an agent-scoped command would otherwise shadow the global one for every session in scope. The check reads the effective command list of each live session, so with no live session the collision cannot be detected and the definition is accepted.
- **Invocations are logged.** Each run appends `command/run` and `command/done` to the receiving session's log, and the child is a durable session of its own, visible in the sub-agent catalog.

## Storage

Definitions live in `$DSH_HOME/agent-scope.json` (override with `storePath` in the plugin config), written atomically and owner-only:

```json
{
  "version": 1,
  "agents": [
    {
      "name": "code_reviewer",
      "description": "Reviews a diff for correctness bugs and missing tests.",
      "color": "#d9a521",
      "scope": "global",
      "enabled": true,
      "systemPrompt": "You review diffs. Report only defects you can point at, with file and line.",
      "model": null,
      "tools": { "mode": "all", "allow": [] }
    },
    {
      "name": "doc_writer",
      "description": "Writes and restructures Markdown documentation.",
      "color": "#7c5cf7",
      "scope": "/Users/you/docs",
      "enabled": true,
      "systemPrompt": "",
      "model": { "provider": "deepseek-official", "model": "deepseek-flash" },
      "tools": { "mode": "custom", "allow": ["glob", "read", "write"] }
    }
  ]
}
```

`name` is the model-facing tool name, so it is fixed once created and must match `[a-z][a-z0-9_-]{0,63}`. It may not collide with a tool another plugin registers, including the deployment's own `subagent`, `read`, or `grep`.

`model: null` means the child inherits the parent session's route. `tools.mode: "all"` omits the filter entirely; `"custom"` sends the checked names as the child's `allow` list, which the official row validates at child creation — a name that the child's composition does not register fails that delegation loudly rather than being ignored.

## `/agents` command (inspection)

Available inside a session (DSH runs commands against an existing agent, so it is not offered on an empty composer):

```
/agents                list the definitions visible to this session
/agents show <名称>    scope, description, route, and tool policy of one definition
```

## Security

- The Settings API is registered through `ctx.webServer.register`, which does **not** apply DSH's Host/Origin/Fetch-Metadata fence by itself. Every request is therefore checked with the `connection` service's `requestRejection` — the platform's own fence, which also carries browser login-token authentication — and a missing `connection` service refuses rather than passes. A cross-origin page cannot reach these routes even if its hostname re-resolves to `127.0.0.1`.
- The `x-dsh-agent-scope` header is a second, cheaper layer: a cross-origin page cannot set it without a preflight this server never grants.
- The store holds no credentials. It does hold a system prompt and a tool list, which together shape a child agent that runs real tools; that is why the write path is behind the platform fence.
- `persona` text is registered with `interpolate: false`, so a definition's prose containing `{{…}}` reaches the child literally instead of being resolved as a prompt variable.
- Definition text reaches the model, so it is trusted input: a hostile system prompt shapes an agent with at least the tools the definition grants.

## HTTP API

All routes require the platform fence and the `x-dsh-agent-scope: 1` header.

| Method | Route | Purpose |
|---|---|---|
| GET | `/agent-scope/api/state` | Definitions with mount state and visible-session counts, live-session scopes, workspaces, model catalog, and the tool names a definition may be granted |
| POST | `/agent-scope/api/agents/create` | Create a definition |
| POST | `/agent-scope/api/agents/update` | Update a definition; the name is immutable |
| POST | `/agent-scope/api/agents/toggle` | Enable or disable a definition |
| POST | `/agent-scope/api/agents/delete` | Delete a definition |

`availableTools` is the union of the host-plane tool registry and every live session's resolved tool view. Preset-plane tools (`read`, `grep`, `bash`, …) resolve only through an agent's scope, so this union is the only listing that reflects what a child could actually be granted; with no live session it degrades to the host-plane set rather than inventing names.

## Known limitations

- **Definitions live on the host plane.** They are mounted on the root context, so a session whose scope admits a definition sees its tool regardless of which preset that session runs — including a deliberately minimal preset. This is the same trade-off `dsh-mcp-scope` makes, and it is what allows one definition to serve sessions that different presets compose.
- **Scope is a stored path, not a workspace id.** Scope comparison uses the same rule DSH uses for workspace membership (canonical session cwd equal to, or below, the scope path). Renaming a workspace on disk leaves the stored path stale until it is edited here.
- **Custom tool names are validated at child creation, not at Save.** The picker offers what live sessions resolve, but a name that the child's own composition does not register fails that delegation. This is the official row's behavior.
- **The catalog section is skipped inside child agents**, so a sub-agent cannot discover sibling definitions — deliberate, matching the depth cap.
- **No dry-run.** Validating a definition without spending a model call is not offered; the mounted/failed state is the only diagnostic available.

## Install

This fork mounts the plugin in its default web composition: `plugins/*` are pnpm workspace packages, and `packages/bundle/web-app/cordis.patch.yml` inserts the `agent-scope` row, so `pnpm dsh web` serves the page from a checkout with no per-machine install step. Restart the host after changing the plugin: the client half is part of the boot payload generated at server start, so a browser reload alone will not add the page.

A profile may still install the bundle explicitly. The row id is the same, and the Loader mounts one entry per id, so installing it beside the bundle patch is harmless:

```sh
pnpm dsh plugin --profile web add link:/absolute/path/to/plugins/dsh-agent-scope
```

## Why this lives in `plugins/` and not `packages/`

`plugins/` is outside the `packages/*/*` tier and its coverage gate, and its runtime files sit under `src/` rather than `lib/` (the repository root ignores `lib/`). The pnpm workspace lists `plugins/*` only so a profile boot can resolve the row name; that membership grants resolution and nothing else. The plugin is plain, directly auditable ESM with no build step, so `src/` is both the source and the artifact a reviewer reads.
