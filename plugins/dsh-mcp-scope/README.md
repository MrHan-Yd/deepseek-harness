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

Tools are therefore hidden from the model, not merely discouraged. Servers stay connected; only visibility is scoped.

## The Settings page

The toolbar's scope selector narrows the list to one scope and its count follows that filter, while the section count also answers the search box — which matches a server's name and, for a stdio server, its command line — so the two differ only while searching. Each row shows the server's transport, its `/name` command, scope, connection state, and tool count as chips, its command or URL, a **探测** button that completes a real MCP handshake, a **试用** button that opens the tool console, a switch for the enable flag, and a delete button that arms on the first click and deletes on the second. Clicking the row body opens the editor.

## Waking a server with `/`

An MCP server is a set of tools, not an agent, so "waking it" means giving it a worker that can call **that server and nothing else**:

```
/memory 把这个事实记进知识图谱：丁寒喜欢用 DSH。
```

Every visible server is a slash command named after it — the `/` menu lists the server with that description, and the command is scoped like the server, so a Session only offers the servers inside its own scope. Running it starts a continuable delegated child whose `toolFilter.allow` is exactly the server's `mcp__<server>__*` namespace, so the child cannot read files, run commands, or reach another server. Its result then returns to the Session that issued the command and wakes that Session's agent, exactly as any other delegation does. Nothing calls the model directly from the command: the command returns as soon as the child accepts its prompt.

Two consequences:

- **A server whose name is not a valid command name gets no command.** The registry accepts lowercase names only (`[a-z][a-z0-9_-]*`), so a server named `Memory` or `2fa` keeps its tools but is not invocable; the page marks that row. A name that another command already uses is marked as a conflict, because a Session-scoped command shadows the global one of the same name.
- **A server with no registered tools cannot be woken.** The child's filter names tools, so a server that is still connecting, or that failed to start, returns an error telling you to probe it first.

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

**Tool trial console** — per server, in the page. It runs one registered `mcp__*` tool through the **official** `ctx.tools.execute` pipeline, so pre-execute permission policy, approval asks, guards, and post-execute all apply exactly as for a model call. The console is another caller of that pipeline, never a way around it. When the page forwards its session id, a live agent routes an approval ask through the ordinary web channel; the result is capped and stays on the page.

**Probing is observation, not inference.** The official client ships no connection-status seam — `packages/mcp/mcp-client/src/status.ts` does not exist — so nothing here reports a server as connected because its config looks right. A stdio probe spawns the configured command with `scrubbedParentEnv()` from the official subprocess package, the same environment the real connection gives a child; an http probe sends the same `initialize` request.

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
| GET | `/mcp-scope/api/state` | Servers, mount state, tool names, live-session visibility, workspace list. Credential values are withheld |
| POST | `/mcp-scope/api/servers/create` | Create one server |
| POST | `/mcp-scope/api/servers/update` | Replace one server (`serverName` is immutable) |
| POST | `/mcp-scope/api/servers/toggle` | Enable or disable one server |
| POST | `/mcp-scope/api/servers/delete` | Remove one server |
| POST | `/mcp-scope/api/servers/probe` | Probe one server and diagnose a failure |
| POST | `/mcp-scope/api/servers/call` | Run one `mcp__*` tool through the official pipeline |

A credential key submitted with an empty value keeps its stored value: the page never received the real one.

## Known limitations

- **Tool visibility, not connection isolation.** A server outside a session's scope still runs for the process. Only its tools are masked.
- **`scope` is a path, not a workspace id.** DSH keys workspace membership on the session header's canonical cwd, and so does this plugin; a workspace renamed on disk keeps its old path here until edited.
- **Disabled servers are unmounted, not masked.** Disabling disposes the client, so its tools disappear for every session.
- **No protocol-version field.** The official client negotiates the MCP protocol version itself and exposes no config for it.
- **Resources are reached through the official tools.** `@deepseek-ai/dsh-mcp-resources` owns `list_mcp_resources`, `list_mcp_resource_templates`, and `read_mcp_resource`; this plugin does not re-bridge them, and MCP prompt templates remain unbridged upstream.
- **`/mcp` needs an existing session.** DSH resolves a command against a live agent, so it is not offered on an empty composer.


## Install

```sh
dsh plugin --profile <profile> add /absolute/path/to/deepseek-harness/plugins/dsh-mcp-scope
```

The package declares `dsh.bundle`, so the profile appends it to `dsh.profile.bundles` and mounts it. Restart `dsh web` afterwards: the client half is part of the boot payload generated at server start, so a browser reload alone will not add the page.

This plugin takes no build step: `src/index.js`, `src/probe.js`, and `src/client.js` are the shipped sources.

## Why this lives in `plugins/` and not `packages/`

It is plain JavaScript with no build step, no `tsconfig` program, and no test suite, which the `packages/*/*` tier requires — the repository's per-file 100% coverage gate, its package-dependency and client-package verifiers, and its bilingual README rules all apply there. Keeping the plugin under `plugins/` lets it be committed alongside a fork of DSH without either side pretending the other's contract holds: the root `.gitignore` ignores `lib/`, so the runtime directory is named `src/` here to make clear that these files are the sources, not build output.

Promoting it to a native package means converting it to TypeScript, adding the test suite the coverage gate demands, wiring a `tsconfig` program and the aggregate references, and either shipping it as its own bundle or contributing it to `packages/bundle/web-app`.
