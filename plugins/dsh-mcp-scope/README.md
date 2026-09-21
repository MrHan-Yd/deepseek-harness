# dsh-mcp-scope

Workspace-scoped MCP server management for DeepSeek Harness. Adds a **MCP 服务器** page to Settings that creates, edits, and removes [`@deepseek-ai/dsh-mcp-client`](../../deepseek-harness/packages/mcp/mcp-client/README.md) servers at one of two scopes:

- **全局 (global)** — the server's tools are visible to every session.
- **工作区 (workspace)** — the server's tools are visible only to sessions whose canonical working directory is that workspace or a directory below it.

## Why this exists

DSH scopes MCP configuration by **profile**, not by workspace: a server row in the profile's patch layer applies to every session the profile runs. This plugin adds the missing workspace dimension without touching the profile composition or the official MCP client.

## How isolation works

Every enabled server is mounted **once** on the root context through the official client (`ctx.plugin(mcpClient, config)`), so a server connects at most once per process. Isolation happens per session:

1. `agent/created` fires with the new agent.
2. The plugin reads the session's canonical cwd from `agent.session.header.cwd`.
3. Servers whose scope is a workspace the session is not in contribute their tool names — discovered from the live tool registry under the `mcp__<serverName>__` prefix — to a deny list.
4. The deny list is applied with `agent.ctx.tools.restrict({ deny })`, which requires exactly that agent-scoped context. The disposer is held per agent and lifted on `agent/disposed` or replaced on the next sweep.

Tools are therefore hidden from the model, not merely discouraged. Servers stay mounted; only visibility is scoped.

## The Settings page

The toolbar's scope selector narrows the list to one scope and its count follows that filter, while the section count also answers the search box — which matches a server's name and, for a stdio server, its command line — so the two differ only while searching. A server created while the list is filtered to one workspace starts in that workspace: the filter is what the person is looking at.

Each row carries what the server *is*: its transport and its scope as chips, its command or URL beneath, and its connection state as the dot on the row's tile — green for a completed handshake, amber while the mount has answered nothing yet, red for a failed one or a mount that never applied, grey for a disabled server. That dot is the whole of the state on the row: its color is read at a glance and the words are its tooltip and accessible name. What can be read elsewhere stays off the line — the tool count the dot already answers, and the `/name` command, which the composer's `/` menu lists. The one command fact worth repeating is a name that would shadow a live `/` command, which is reported in red under the row. The row's actions are the ones it needs: a **探测** button that completes a real MCP handshake, a switch for the enable flag, and **delete**, which still arms on the first click and deletes on the second. Clicking the row body opens the editor.

Every dropdown here — the scope filter, the editor's scope and transport fields, and the tool picker — is the shared `Menu` primitive from `@deepseek-ai/dsh-client-ui-primitives`, the same control the 通用设置 rows open. A native `<select>` popup is drawn by the operating system and cannot follow the application theme, so in the dark theme its highlighted row rendered white-on-light and the options were unreadable.

Both dialogs offer two ways in: **表单** for name, transport, timeout, and command/arguments/environment (or URL/headers), and **JSON** for a pasted configuration, so a config copied from another tool can be added or rewritten verbatim:

```json
{
  "redis_9_dev_7": {
    "type": "stdio",
    "command": "C:\\Program Files\\nodejs\\redis.cmd",
    "args": ["redis://localhost:6379/7"]
  }
}
```

That name → server map is the shape the MCP clients in use here write. The same map under an `mcpServers` wrapper, and one server object on its own with `name`, are read too; `transport` is accepted wherever `type` is. `type` is `stdio` for `command`/`args`/`env`/`cwd`, or `http`/`streamable-http` for `url`/`headers`. Numbers and booleans inside `env`/`headers` become the strings the Host requires. A paste is parsed as it is typed, the record it will save is reported back, and saving waits until it can be read; more than one server in one paste is refused. A `scope` written in the paste seeds the scope selector, which remains the visible control that is saved.

An edit opens the paste on the stored record, credential keys included as blank values: the Host never sends a credential's value to the page, and a blank value keeps the stored one, so the template survives a round trip. A `cwd` the paste omits likewise keeps its stored value, and a paste that renames the server is refused — the record keeps the name it was created with.

The form has no working-directory field: the scope above already decides where a server is visible, and a cwd is not something most servers need. An existing cwd survives an edit, and a paste is how a server that does need one gets it.

## Waking a server with `/`

An MCP server is a set of tools, not an agent, so "waking it" means giving it a worker that can call **that server and nothing else**:

```
/memory 把这个事实记进知识图谱：丁寒喜欢用 DSH。
```

Every visible server is a slash command named after it — the `/` menu lists the server with that description, and the command is scoped like the server, so a Session only offers the servers inside its own scope. Running it starts a continuable delegated child whose `toolFilter.allow` is exactly the server's `mcp__<server>__*` namespace, so the child cannot read files, run commands, or reach another server. Its result then returns to the Session that issued the command and wakes that Session's agent, exactly as any other delegation does. Nothing calls the model directly from the command: the command returns as soon as the child accepts its prompt.

Two consequences:

- **A server whose name is not a valid command name gets no command.** The registry accepts lowercase names only (`[a-z][a-z0-9_-]*`), so a server named `Memory` or `2fa` keeps its tools but is not invocable; the page marks that row. A name that another command already uses is marked as a conflict, because a Session-scoped command shadows the global one of the same name.
- **A server with no registered tools cannot be woken.** The child's filter names tools, so a server that is still connecting, or that failed to start, returns an error telling you to probe it first.

A server name written **inside a sentence** is a different intent, and the host command source does not offer one: an argument-taking command claims the whole line, so the message it submits is the command alone and anything typed before the name would be discarded. The plugin therefore registers its own `/` source — the menu group `mcp` — which answers only away from the head of the draft, lists every server that registers a command, and settles a pick by inserting the name as plain text. That keeps a multi-step request in one message, with each server named where its instruction is; the names reach the model as text, which reaches the server through its `mcp__<server>__*` namespace. At the head of the draft the source contributes nothing, so a leading `/name` behaves exactly as described above.

## Storage

Servers live in `$DSH_HOME/mcp-scope.json` (override with `storePath` in the plugin config), written atomically:

```json
{
  "version": 1,
  "servers": [
    {
      "serverName": "team_db",
      "transport": "stdio",
      "scope": "global",
      "enabled": true,
      "toolCallTimeoutMs": 30000,
      "command": "npx",
      "args": ["-y", "some-mcp-server"],
      "env": {},
      "cwd": ""
    },
    {
      "serverName": "shell_only",
      "transport": "stdio",
      "scope": "/Users/you/project/rust/shell",
      "enabled": true,
      "toolCallTimeoutMs": 30000,
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"],
      "env": {}
    }
  ]
}
```

## MCP capabilities

Beyond the Settings page, the plugin provides the operating surface for the servers it owns.

**`/mcp` command** — available inside a session (DSH runs commands against an existing agent, so it is not offered on an empty composer):

| Invocation | Output |
|---|---|
| `/mcp` or `/mcp list` | Every server this session can use, with its scope and tool count |
| `/mcp tools <server>` | That server's registered tool names |
| `/mcp health` | A real connectivity probe of every visible server |
| `/mcp probe <server>` | A real connectivity probe of one server |

**`mcp_probe` tool** — model-facing. It completes a real MCP `initialize` handshake against one server and returns the observed result, or the failure and its repair. The body refuses any server outside the calling agent's scope, so the tool cannot become a scope bypass.

**Failure diagnosis** — every failed probe is classified and paired with a repair: `command-not-found`, `permission`, `auth-401`, `auth-403`, `not-found-404`, `bad-port`, `connection-refused`, `dns`, `tls`, `timeout`, `process-exit`, `upstream-5xx`, or `unknown`. The classifier reads the whole `cause` chain, because `fetch` reports every transport failure as a bare `TypeError: fetch failed` and puts the real reason in `cause`; an unclassified failure says so instead of guessing a cause.

**`/servers/call` runs one registered tool on request.** It goes through the **official** `ctx.tools.execute` pipeline, so pre-execute permission policy, approval asks, guards, and post-execute all apply exactly as for a model call: another caller of that pipeline, never a way around it. The page's per-row trial console, which was its only caller, has been removed; the route remains for callers that are not the page.

**Probing is observation, not inference.** The official client ships no connection-status seam — `packages/mcp/mcp-client/src/status.ts` does not exist — so nothing here reports a server as connected because its config looks right. A stdio probe spawns the configured command with `scrubbedParentEnv()` from the official subprocess package, the same environment the real connection gives a child; an http probe sends the same `initialize` request.

**A failed stdio probe writes the child's stderr to the Host log.** That text is where a server says why it refused to start — `process exited before initialize response (code 1)` is the handshake's verdict, not a cause — and because it can name credentials it reaches neither the page, the `/mcp` output, nor the `mcp_probe` result.

**A row claims a connection only on evidence.** Mounting and connecting are different events: `ctx.plugin` returns before the client's handshake finishes, and a failed connection reaches the Host log alone, so a mount that answers nothing looks exactly like a working one. The page therefore reports `已连接` for three observed states only — the server's tools are registered, the check the page itself asked for completed a handshake, or the person's own 探测 completed — and reports `连接中` for a mount with none of them.

**The MCP page takes that handshake once, when it is opened.** A silent mount is read only while that section is open, and only for the mounts that registered no tools and have no reading yet; the reading is stored and shown as `不可达 (页面检查)` with the observed reason, and dropped as soon as that server's tools arrive, because the tools are newer evidence that the handshake it called failed has since completed. The section is the trigger: the Settings shell renders only the active section, so the check runs when someone navigates to this page, never when the Settings dialog opens elsewhere. Nothing runs on a timer and nothing retries: a server that connects normally is never started a second time, a row already read is left as it is, and asking again for one server is what the person's own 探测 does.

**A Windows command that needs a shell gets one.** Node refuses to start a `.cmd`/`.bat` shim directly — `spawn` fails with `EINVAL` — and only `.exe`/`.com` are directly startable, so a probe builds the same cmd.exe command line cross-spawn builds for the official client (`src/spawn-target.js`). That is what makes a server configured as a full `…\npm\mongodb-mcp-server.cmd` path or as a bare `npx` probe as reachable as it is connected, and it keeps the probe's teardown honest: the process it owns is cmd.exe, so it ends the tree with `taskkill /t` rather than leaving the server behind.

## Security

Two confused-deputy paths a browser opens against a local HTTP API apply here, and one of them bites especially hard because this API can create a stdio server — which executes a command.

**The trust fence comes from the platform, not from this plugin.** Every request asks the composition's `connection` service for `requestRejection(req)` first, exactly as `@deepseek-ai/dsh-open-in-app` does. That applies DSH's own Host/Origin/Fetch-Metadata fence — which is what defeats DNS rebinding — plus its browser login-token authentication.

This matters because a route registered through `ctx.webServer.register` receives **neither** automatically; only the RPC bridge does. A page served from `http://attacker.example:3080` whose hostname re-resolves to 127.0.0.1 is same-origin, so it satisfies any `Origin == Host` rule, and it can set custom headers without a preflight. The Host fence is the header rebinding cannot forge, because the browser writes the name it believes it is talking to. If the `connection` service is absent, the request is refused — a missing fence is never a pass.

The `x-dsh-mcp-scope` header is kept as a second, cheaper layer. It is not the fence.

**Credentials stay on the host.** A stdio `env` or an http `headers` map routinely holds a bearer token. The page receives key names only, never values, so credentials do not reach the DOM or the browser's fetch log. The store file is written owner-only (`0600`, in a `0700` directory) with an unpredictable exclusive temp name, because the same values sit there at rest.

**Scope is enforced on every path that can run a tool.** The Settings page, the `/mcp` command, the `mcp_probe` tool, and the `/servers/call` route all resolve the caller's scope the same way, and a call with no resolvable session is treated as global-scope-only rather than as unlimited.

## HTTP API

The page talks to the host half over `/mcp-scope/api`. Every request passes the composition's trust fence (see [Security](#security)) and must also carry `x-dsh-mcp-scope: 1`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/mcp-scope/api/state` | Servers, mount state, tool names, the page's handshake reading, live-session visibility, workspace list. Credential values are withheld |
| POST | `/mcp-scope/api/servers/create` | Create one server |
| POST | `/mcp-scope/api/servers/update` | Replace one server (`serverName` is immutable) |
| POST | `/mcp-scope/api/servers/toggle` | Enable or disable one server |
| POST | `/mcp-scope/api/servers/delete` | Remove one server |
| POST | `/mcp-scope/api/servers/verify` | Take one handshake reading per named silent mount, or per every silent mount when the body names none |
| POST | `/mcp-scope/api/servers/probe` | Probe one server and diagnose a failure |
| POST | `/mcp-scope/api/servers/call` | Run one `mcp__*` tool through the official pipeline (the page does not call it) |

A credential key submitted with an empty value keeps its stored value: the page never received the real one.

## Known limitations

- **Tool visibility, not connection isolation.** A server outside a session's scope still runs for the process. Only its tools are masked.
- **`scope` is a path, not a workspace id.** DSH keys workspace membership on the session header's canonical cwd, and so does this plugin; a workspace renamed on disk keeps its old path here until edited.
- **Disabled servers are unmounted, not masked.** Disabling disposes the client, so its tools disappear for every session.
- **The page's check starts a silent server one extra time.** While the official client is still retrying its own connection to a server that has produced no tools, opening the page starts that command once more. It happens once per page open per unread mount, never on a timer.
- **No protocol-version field.** The official client negotiates the MCP protocol version itself and exposes no config for it.
- **Resources are reached through the official tools.** `@deepseek-ai/dsh-mcp-resources` owns `list_mcp_resources`, `list_mcp_resource_templates`, and `read_mcp_resource`; this plugin does not re-bridge them, and MCP prompt templates remain unbridged upstream.
- **`/mcp` needs an existing session.** DSH resolves a command against a live agent, so it is not offered on an empty composer.


## Install

This fork mounts the plugin in its default web composition: `plugins/*` are pnpm workspace packages, and `packages/bundle/web-app/cordis.patch.yml` inserts the `mcp-scope` row, so `pnpm dsh web` serves the page from a checkout with no per-machine install step. Restart the host after changing the plugin: the client half is part of the boot payload generated at server start, so a browser reload alone will not add the page.

A profile may still install the bundle explicitly. The row id is the same, and the Loader mounts one entry per id, so installing it beside the bundle patch is harmless:

```sh
dsh plugin --profile <profile> add /absolute/path/to/deepseek-harness/plugins/dsh-mcp-scope
```

This plugin takes no build step: `src/index.js`, `src/probe.js`, `src/spawn-target.js`, `src/scope.js`, and `src/client.js` are the shipped sources.

## Tests

`tests/scope.test.mjs` pins the scope rules — `global`, or an absolute path in the spelling the running platform uses, which is what a Windows `D:\...` workspace needed. `tests/spawn-target.test.mjs` pins the rule that decides when a command goes through the command interpreter and the escaping it needs there, against the command line cross-spawn builds for the official client. `tests/mention.client.test.mjs` drives the plugin's own `/` source: it answers inside a draft and never at its head, it names only servers that register a command, and a pick inserts the name as plain text. `tests/dropdown.client.test.mjs`, `tests/status.client.test.mjs`, and `tests/row.client.test.mjs` boot the browser half in jsdom through the shared `tests/harness.mjs`: the first drives the editor — the dropdowns (which is what keeps a native `<select>` from returning), the configurations a paste accepts and the record each one saves in both dialogs, and the stored credentials and working directory an edit must keep; the second drives what a row claims about its connection, which is never `已连接` without a handshake to point at, and when that handshake is asked for — once for the silent mounts when the MCP section is opened, and never on its own; the third drives the row's own line, which drops the facts that can be read elsewhere and keeps the delete button on the row it belongs to.

```sh
node --test "plugins/dsh-mcp-scope/tests/*.test.mjs"
```

## Why this lives in `plugins/` and not `packages/`

It is plain JavaScript with no build step, no `tsconfig` program, and no test suite, which the `packages/*/*` tier requires — the repository's per-file 100% coverage gate, its package-dependency and client-package verifiers, and its bilingual README rules all apply there. The pnpm workspace lists `plugins/*` only so a profile boot can resolve the row name; that membership grants resolution and nothing else. Keeping the plugin under `plugins/` lets it be committed alongside a fork of DSH without either side pretending the other's contract holds: the root `.gitignore` ignores `lib/`, so the runtime directory is named `src/` here to make clear that these files are the sources, not build output.

Promoting it to a native package means converting it to TypeScript, adding the test suite the coverage gate demands, wiring a `tsconfig` program and the aggregate references, and either shipping it as its own bundle or contributing it to `packages/bundle/web-app`.
