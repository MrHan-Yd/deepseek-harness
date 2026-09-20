/**
 * dsh-mcp-scope — workspace-scoped MCP servers for DeepSeek Harness.
 *
 * Two scopes per server:
 *   'global'      every session sees the server's tools.
 *   '<abs path>'  only sessions whose canonical cwd is that workspace directory
 *                 or a descendant of it see the server's tools.
 *
 * Enforcement is per session. Every enabled server is mounted once on the root
 * context, and each agent receives a `tools.restrict({ deny })` mask naming the
 * tools of the servers outside its scope. `tools.restrict` requires a scoped
 * context, which `agent.ctx` is; a context-global restriction would mask every
 * agent, so the mask is always applied per agent and lifted on disposal.
 *
 * The Settings page talks to this half over a same-origin HTTP API rather than
 * a typed Remote: the plugin ships no generated Remote assembly, and the route
 * handler is small enough to audit in place. Every request must carry the
 * `x-dsh-mcp-scope` header, which a cross-origin page cannot set without a CORS
 * preflight this server never grants; an `Origin` present on the request must
 * also match the request `Host`.
 *
 * Function plugin: named exports and no default export, so the Loader keeps the
 * namespace.
 *
 * @module dsh-mcp-scope
 */

import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { DEFAULT_PROBE_TIMEOUT_MS, diagnose, probeServer, sanitizeText } from './probe.js'
import { GLOBAL_SCOPE, canonical, inScope, normalizeScope } from './scope.js'

export const name = 'mcp-scope'

/** Hard services: the tool registry the mask targets, and the agent lifecycle events. */
export const inject = ['tools', 'agents']

/** Route prefix owned by this plugin. */
const API_PATH = '/mcp-scope/api'

/** Request header a cross-origin page cannot set without a granted preflight. */
const GUARD_HEADER = 'x-dsh-mcp-scope'

/** Tool-name prefix the official MCP client registers under. */
const TOOL_PREFIX = 'mcp__'

/**
 * Command-name contract shared with the human-command registry.
 *
 * A server name is used verbatim as its slash command, and the registry accepts
 * lowercase names only, so a server named with capitals keeps its tools but
 * gets no command.
 */
const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/u

/** Cap on one request body, in bytes. */
const MAX_BODY_BYTES = 256 * 1024

/** Server name contract shared with the official MCP client. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/**
 * Resolve the server store path.
 * @param config - raw plugin config.
 * @returns the absolute store path.
 */
function storePathOf(config) {
  const configured = typeof config?.storePath === 'string' ? config.storePath.trim() : ''
  if (configured !== '') return resolve(configured)
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  return join(home, 'mcp-scope.json')
}

/**
 * Read a string map field, rejecting non-string entries.
 * @param value - candidate map.
 * @param label - field name used in the error.
 * @returns the validated map.
 */
function stringMap(value, label) {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  const result = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') throw new Error(`${label}.${key} must be a string`)
    if (key.trim() === '') throw new Error(`${label} keys must be non-empty`)
    result[key] = entry
  }
  return result
}

/**
 * Validate one incoming server record from the Settings page.
 * @param input - raw record.
 * @returns the normalized server record.
 */
function validateServer(input) {
  if (typeof input !== 'object' || input === null) throw new Error('server must be an object')
  const serverName = String(input.serverName ?? '').trim()
  if (!SERVER_NAME_PATTERN.test(serverName)) {
    throw new Error('serverName must match [A-Za-z0-9_-]{1,32}')
  }
  if (serverName.includes('__')) {
    // Tool names are `mcp__<serverName>__<tool>`, and this plugin attributes a
    // tool to a server by that prefix. `db` and `db__prod` would then both
    // claim `mcp__db__prod__*`, so one server's tools would be masked — or
    // reported — as the other's.
    throw new Error('serverName cannot contain "__": it would collide with the mcp__<serverName>__ tool prefix of another server')
  }
  const transport = input.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
  const timeout = Number(input.toolCallTimeoutMs)
  const toolCallTimeoutMs = Number.isInteger(timeout) && timeout > 0 ? timeout : 30000
  const server = {
    serverName,
    transport,
    scope: normalizeScope(input.scope),
    enabled: input.enabled !== false,
    toolCallTimeoutMs,
  }
  if (transport === 'stdio') {
    const command = String(input.command ?? '').trim()
    if (command === '') throw new Error('command is required for a stdio server')
    server.command = command
    server.args = Array.isArray(input.args) ? input.args.map(String) : []
    server.env = stringMap(input.env, 'env')
    server.cwd = typeof input.cwd === 'string' ? input.cwd.trim() : ''
  } else {
    const url = String(input.url ?? '').trim()
    if (!/^https?:\/\//u.test(url)) throw new Error('url must start with http:// or https://')
    server.url = url
    server.headers = stringMap(input.headers, 'headers')
  }
  return server
}

/**
 * Project one stored server onto the official MCP client's config.
 * @param server - validated server record.
 * @returns the `@deepseek-ai/dsh-mcp-client` config.
 */
function toClientConfig(server) {
  // `failOnStartupError: false` keeps one unreachable server from refusing the
  // whole mount; the official client retries in the background, so a failure
  // here is silent by design and the mount is verified separately.
  const base = {
    serverName: server.serverName,
    transport: server.transport,
    toolCallTimeoutMs: server.toolCallTimeoutMs,
    failOnStartupError: false,
  }
  if (server.transport === 'stdio') {
    return { ...base, command: server.command, args: server.args, env: server.env, cwd: server.cwd }
  }
  return { ...base, url: server.url, headers: server.headers }
}

/**
 * The mounted-configuration signature of one server.
 *
 * A disabled server signs as `disabled` rather than as its own client config:
 * the config of an enabled and a disabled server is otherwise identical, so a
 * signature that ignored the flag would make reconciliation treat a disabled
 * mount as current and leave its tools registered.
 *
 * @param server - the stored server record.
 * @returns the signature string.
 */
function signatureOf(server) {
  return server.enabled ? JSON.stringify(toClientConfig(server)) : 'disabled'
}

/**
 * Replace one server's credential values with their key names for the page.
 *
 * A stdio `env` and an http `headers` map routinely hold bearer tokens. The
 * page needs the keys to let a person edit them; it never needs the values,
 * and shipping them would place credentials in the DOM and in every fetch log
 * the browser keeps.
 *
 * @param server - the stored server record.
 * @returns the record with values withheld and key names exposed.
 */
function redactSecrets(server) {
  const { env, headers, ...rest } = server
  return {
    ...rest,
    ...(env === undefined ? {} : { envKeys: Object.keys(env) }),
    ...(headers === undefined ? {} : { headerKeys: Object.keys(headers) }),
  }
}

/**
 * Write a failed probe's own stderr to the Host log.
 *
 * A server explains on stderr why it refused to start, and that text can name
 * its credentials, so it stays out of the page, the `/mcp` output, and the
 * `mcp_probe` result. The Host log is the one place it can be read.
 *
 * @param ctx - the context whose logger receives it.
 * @param serverName - the probed server.
 * @param stderrTail - the child's bounded stderr, when the probe captured any.
 */
function logProbeStderr(ctx, serverName, stderrTail) {
  const tail = typeof stderrTail === 'string' ? stderrTail.trim() : ''
  if (tail === '') return
  ctx.logger?.warn?.(`mcp-scope: "${serverName}" stderr: ${tail}`)
}

/**
 * Keep the stored value for a key the page submitted blank.
 *
 * The page never receives credential values, so an untouched key round-trips
 * as an empty string. Taking that literally would erase the credential on the
 * first save that changed an unrelated field.
 *
 * @param submitted - the map from the request.
 * @param stored - the map already on disk.
 * @returns the merged map.
 */
function mergeSecrets(submitted, stored) {
  const result = {}
  for (const [key, value] of Object.entries(submitted ?? {})) {
    result[key] = value === '' && typeof stored?.[key] === 'string' ? stored[key] : value
  }
  return result
}

/** Mutable server store backed by one JSON file. */
class ServerStore {
  /** @param path - absolute store path. */
  constructor(path) {
    this.path = path
    this.servers = []
  }

  /** Load the file, tolerating a missing or unreadable store. */
  load() {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'))
      const rows = Array.isArray(parsed?.servers) ? parsed.servers : []
      this.servers = rows.map(row => validateServer(row))
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        // A corrupt store must not take the page down; the next write replaces it.
        this.servers = []
        this.loadError = error instanceof Error ? error.message : String(error)
      }
    }
    return this.servers
  }

  /** Persist the store atomically and owner-only. */
  save() {
    // The store holds credentials: a stdio `env` or an http `headers` map can
    // carry a bearer token. Create the directory and the file readable by the
    // owner alone, and use an unpredictable exclusive temp name so a second
    // writer is never handed another process's partial file.
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const body = JSON.stringify({ version: 1, servers: [...this.servers].sort(byName) }, null, 2)
    const temporary = `${this.path}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`
    writeFileSync(temporary, `${body}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    renameSync(temporary, this.path)
  }
}

/**
 * Sort server records by name for a stable stored order.
 * @param left - first record.
 * @param right - second record.
 * @returns the comparator result.
 */
function byName(left, right) {
  return left.serverName < right.serverName ? -1 : left.serverName > right.serverName ? 1 : 0
}

/** Mounts servers, masks per-session tools, and owns the store. */
class ScopeRuntime {
  /**
   * @param ctx - plugin context carrying `tools`.
   * @param store - the server store.
   */
  constructor(ctx, store) {
    this.ctx = ctx
    this.store = store
    /** @type {Map<string, { fiber: unknown, signature: string }>} */
    this.mounts = new Map()
    /** @type {Map<string, () => void>} */
    this.masks = new Map()
    /** @type {Map<string, unknown>} */
    this.agents = new Map()
    /** @type {Map<string, string>} */
    this.mountErrors = new Map()
    /** @type {Map<string, { reachable: boolean, detail: string }>} */
    this.verifyResults = new Map()
    /** @type {Set<string>} */
    this.verifying = new Set()
    /** @type {Map<string, { signature: string, fiber: unknown }>} */
    this.commands = new Map()
  }

  /**
   * Reconcile the mounted servers with the store, then re-mask every live agent.
   *
   * Serialized on one chain: remounting awaits the old fiber's disposal, so two
   * concurrent reconciles could otherwise interleave an unmount with the mount
   * that must follow it.
   *
   * @returns the reconcile outcome.
   */
  reconcile() {
    const next = (this.pending ?? Promise.resolve()).then(() => this.#reconcileNow())
    this.pending = next.then(() => {}, () => {})
    return next
  }

  /** @returns the reconcile outcome. */
  async #reconcileNow() {
    const wanted = new Map()
    for (const server of this.store.servers) {
      wanted.set(server.serverName, server)
    }
    for (const [serverName, mount] of [...this.mounts]) {
      const server = wanted.get(serverName)
      const signature = server === undefined ? undefined : signatureOf(server)
      if (server !== undefined && mount.signature === signature) continue
      // Awaiting matters: the official client reserves `serverName` per scope,
      // so remounting before the old fiber released it makes the new apply fail
      // with "already in use" — a failure `ctx.plugin` parks in the fiber
      // instead of throwing here.
      await this.#unmount(serverName)
    }
    for (const [serverName, server] of wanted) {
      if (this.mounts.has(serverName)) continue
      if (!server.enabled) continue
      this.#mount(server)
    }
    this.maskAll()
  }

  /**
   * Mount one server on the root context.
   * @param server - validated server record.
   */
  #mount(server) {
    const config = toClientConfig(server)
    try {
      const fiber = this.ctx.plugin(mcpClient, config)
      this.mounts.set(server.serverName, { fiber, signature: signatureOf(server) })
      this.mountErrors.delete(server.serverName)
      // `ctx.plugin` does not throw when the plugin refuses to apply: it parks
      // the rejection in the fiber. Without observing it a server that never
      // starts still reads as connected on the page — with zero tools and no
      // reason shown — and its signature matches, so no later reconcile
      // retries it.
      Promise.resolve(fiber).then(
        () => {},
        (error) => {
          if (this.mounts.get(server.serverName)?.fiber !== fiber) return
          const message = error instanceof Error ? error.message : String(error)
          this.mountErrors.set(server.serverName, message)
          this.ctx.logger?.warn?.(`mcp-scope: "${server.serverName}" failed to apply: ${message}`)
        },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.mountErrors.set(server.serverName, message)
      this.ctx.logger?.warn?.(`mcp-scope: "${server.serverName}" failed to mount: ${message}`)
    }
  }

  /**
   * Take one handshake reading per server that registered no tools.
   *
   * Nothing calls this on its own: the official client connects after
   * `ctx.plugin` returns and reports a failure only to the Host log, so a mount
   * that answers nothing is indistinguishable from a working one until
   * something handshakes — and the page, which is what shows that difference,
   * asks for this when it opens. A server that already has a reading is left
   * alone; the person's own 探测 is what asks again.
   *
   * @param serverNames - the servers to read, or null for every stored server.
   * @returns the names a reading was taken for.
   */
  async verify(serverNames) {
    const wanted = serverNames === null
      ? this.store.servers.map(server => server.serverName)
      : serverNames
    const taken = await Promise.all(wanted.map(serverName => this.#verify(serverName)))
    return taken.filter(name => name !== null)
  }

  /**
   * Read one server, when it is mounted, still tool-less, and never read.
   * @param serverName - the server to read.
   * @returns the name once its reading is stored, or null when it was skipped.
   */
  async #verify(serverName) {
    const server = this.serverByName(serverName)
    if (server === undefined || !this.mounts.has(serverName)) return null
    if (this.toolNames(serverName).length > 0) return null
    if (this.verifyResults.has(serverName) || this.verifying.has(serverName)) return null
    this.verifying.add(serverName)
    let reading
    let stderrTail = ''
    try {
      const outcome = await probeServer(server, DEFAULT_PROBE_TIMEOUT_MS)
      const reachable = outcome.status === 'completed'
      stderrTail = typeof outcome.stderrTail === 'string' ? outcome.stderrTail : ''
      reading = { reachable, detail: sanitizeText(outcome.detail) }
    } catch (error) {
      reading = { reachable: false, detail: sanitizeText(error instanceof Error ? error.message : String(error)) }
    } finally {
      this.verifying.delete(serverName)
    }
    if (reading.reachable === false) logProbeStderr(this.ctx, serverName, stderrTail)
    // The probe runs for seconds: the server may have connected, or been
    // unmounted, while it ran. Only a live, still tool-less server keeps it.
    if (!this.mounts.has(serverName) || this.toolNames(serverName).length > 0) return null
    this.verifyResults.set(serverName, reading)
    this.ctx.logger?.warn?.(
      `mcp-scope: "${serverName}" mounted without tools — probe on request: ${reading.detail}`,
    )
    return serverName
  }

  /**
   * The reading taken for one server, while it still carries meaning.
   *
   * Registered tools retire an earlier failed reading: they are newer evidence
   * that a handshake completed, and the failure they supersede is over.
   *
   * @param serverName - the server to read.
   * @returns the reading, or null when there is none to report.
   */
  healthOf(serverName) {
    if (this.toolNames(serverName).length > 0) return null
    return this.verifyResults.get(serverName) ?? null
  }

  /**
   * Dispose one mounted server.
   *
   * Awaited by the caller: disposal releases the `serverName` reservation the
   * official client holds per scope, and only after it settles can the same
   * name mount again.
   *
   * @param serverName - the server to unmount.
   * @returns a promise settling after disposal.
   */
  async #unmount(serverName) {
    const mount = this.mounts.get(serverName)
    if (mount === undefined) return
    this.mounts.delete(serverName)
    this.verifyResults.delete(serverName)
    try {
      await mount.fiber?.dispose?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger?.warn?.(`mcp-scope: "${serverName}" failed to unmount: ${message}`)
    }
  }

  /**
   * Record one live agent and mask its out-of-scope tools.
   * @param agent - the created agent.
   */
  addAgent(agent) {
    this.agents.set(agent.id, { agent, cwd: '', visible: [], denied: [] })
    this.#mask(agent)
  }

  /**
   * Forget one agent, lift its mask, and drop its commands.
   * @param agent - the disposed agent.
   */
  removeAgent(agent) {
    this.agents.delete(agent.id)
    this.#dropCommands(agent.id)
    const mask = this.masks.get(agent.id)
    if (mask === undefined) return
    this.masks.delete(agent.id)
    try {
      mask.lift()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger?.warn?.(`mcp-scope: agent ${agent.id} mask release failed: ${message}`)
    }
  }

  /** Re-mask every live agent after a store or mount change. */
  maskAll() {
    for (const record of this.agents.values()) this.#mask(record.agent)
  }

  /**
   * How many live sessions currently see each mounted server.
   * @returns server name to the number of sessions whose mask admits it.
   */
  visibleSessionCounts() {
    const counts = new Map()
    for (const record of this.agents.values()) {
      for (const serverName of record.visible) {
        counts.set(serverName, (counts.get(serverName) ?? 0) + 1)
      }
    }
    return counts
  }

  /**
   * Apply this agent's scope mask.
   * @param agent - the agent to mask.
   */
  #mask(agent) {
    const record = this.agents.get(agent.id)
    const deny = []
    const visible = []
    const visibleRecords = []
    try {
      const cwd = typeof agent.session?.header?.cwd === 'string' ? canonical(agent.session.header.cwd) : ''
      if (record !== undefined) record.cwd = cwd
      for (const server of this.store.servers) {
        if (!this.mounts.has(server.serverName)) continue
        if (server.scope === GLOBAL_SCOPE || inScope(cwd, server.scope)) {
          visible.push(server.serverName)
          visibleRecords.push(server)
          continue
        }
        deny.push(...this.toolNames(server.serverName))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger?.warn?.(`mcp-scope: agent ${agent.id} scope resolution failed: ${message}`)
      return
    }
    if (record !== undefined) {
      record.visible = visible
      record.denied = deny
    }
    this.#applyMask(agent, deny)
    // Command registration is driven by the visible set, which changes without
    // the deny list changing (a newly mounted in-scope server adds no denial),
    // so it runs on every sweep rather than behind the mask's own early return.
    this.#applyCommands(agent, visibleRecords)
  }

  /**
   * Install one agent's deny mask, replacing the previous one.
   * @param agent - the agent to mask.
   * @param deny - out-of-scope MCP tool names.
   */
  #applyMask(agent, deny) {
    const previous = this.masks.get(agent.id)
    if (previous !== undefined && previous.deny.length === deny.length
      && previous.deny.every(name => deny.includes(name))) {
      // A re-sweep that computes the same mask (a tool registered under an
      // unrelated server, a workspace event) must not churn the restriction.
      return
    }
    // Apply the new restriction BEFORE lifting the old one. `restrict` throws
    // on a name that is not registered — precisely the state a server is in
    // while it is still connecting — and lifting first would leave the agent
    // unmasked, exposing exactly the tools this method exists to hide.
    let next
    if (deny.length > 0) {
      try {
        next = agent.ctx.tools.restrict({ deny })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.ctx.logger?.warn?.(`mcp-scope: agent ${agent.id} mask not applied yet: ${message}`)
      }
    }
    if (previous !== undefined) {
      this.masks.delete(agent.id)
      try {
        previous.lift()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.ctx.logger?.warn?.(`mcp-scope: agent ${agent.id} mask replace failed: ${message}`)
      }
    }
    if (next !== undefined) this.masks.set(agent.id, { lift: next, deny })
  }

  /**
   * Register one agent's slash commands, one per visible MCP server.
   *
   * Registration through a child of the agent's own context is what scopes the
   * command: the registry resolves a definition's layer from the calling
   * context's scope key, so a server outside this Session is absent from its `/`
   * menu instead of failing when invoked. A server whose name cannot be a
   * command name (the registry accepts lowercase only) keeps its tools but gets
   * no command, which the Settings page reports.
   *
   * @param agent - the agent whose composer to extend.
   * @param servers - server records inside that agent's scope.
   */
  #applyCommands(agent, servers) {
    const usable = servers.filter(server => COMMAND_NAME_PATTERN.test(server.serverName))
    const signature = usable.map(server => server.serverName).join('\u0001')
    const previous = this.commands.get(agent.id)
    if (previous !== undefined && previous.signature === signature) return
    this.#dropCommands(agent.id)
    if (usable.length === 0) return
    try {
      const fiber = agent.ctx.inject(['commands'], (scope) => {
        for (const server of usable) {
          scope.commands.register(this.#commandFor(server.serverName))
        }
      })
      this.commands.set(agent.id, { signature, fiber })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger?.warn?.(`mcp-scope: agent ${agent.id} commands not registered: ${message}`)
    }
  }

  /**
   * Drop one agent's command registrations.
   * @param agentId - the agent whose registrations to release.
   */
  #dropCommands(agentId) {
    const previous = this.commands.get(agentId)
    if (previous === undefined) return
    this.commands.delete(agentId)
    try {
      previous.fiber?.dispose?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger?.warn?.(`mcp-scope: agent ${agentId} command release failed: ${message}`)
    }
  }

  /**
   * Build the slash command that works one server for a task.
   * @param serverName - the mounted server's name.
   * @returns the command registration.
   */
  #commandFor(serverName) {
    return {
      definitionId: `mcp-scope:${serverName}`,
      name: serverName,
      description: `用 MCP 服务器「${serverName}」完成任务（它只能调用这个服务器的工具）`,
      // The hint becomes the composer's placeholder once a menu pick claims this
      // command, which is where a person learns the task still has to be typed.
      input: { hint: '任务描述，再按回车运行' },
      handler: (invocation) => this.runFromCommand(serverName, invocation),
    }
  }

  /**
   * Start one continuable child limited to one server's tools.
   *
   * The child is a real delegated Session, so the run ends the way every other
   * delegation does: its settlement notice returns the result to the receiving
   * Session and wakes that Session's agent to continue from it. The tool filter
   * is the server's whole namespace, which is what makes this "wake the MCP
   * server" rather than "wake a sub-agent": the child can call those tools and
   * nothing else.
   *
   * @param serverName - the server to work through.
   * @param invocation - the human command invocation.
   * @returns the command outcome rendered by the composer.
   */
  async runFromCommand(serverName, invocation) {
    const server = this.serverByName(serverName)
    if (server === undefined) return { kind: 'error', text: `MCP 服务器「${serverName}」已不存在。` }
    if (!server.enabled || !this.mounts.has(serverName)) {
      return { kind: 'error', text: `MCP 服务器「${serverName}」当前未装载，先在「设置 → MCP 服务器」启用它。` }
    }
    const task = String(invocation.rawInput ?? '').trim()
    if (task === '') return { kind: 'error', text: `用法：/${serverName} <任务>` }
    const tools = this.toolNames(serverName)
    if (tools.length === 0) {
      return {
        kind: 'error',
        text: `MCP 服务器「${serverName}」还没有注册任何工具，可能仍在连接或启动失败；先在这个页面上「探测」它。`,
      }
    }
    const subagents = this.ctx.get('subagents')
    if (subagents === undefined || typeof subagents.startContinuable !== 'function') {
      return { kind: 'error', text: '当前组合没有装载可续聊的子智能体服务，无法运行。' }
    }
    let started
    try {
      started = await subagents.startContinuable({
        provider: 'spawn',
        label: `${serverName} MCP`,
        request: {
          prompt: [{ type: 'text', text: task }],
          parent: invocation.agent,
          toolFilter: { allow: [...tools] },
        },
        signal: invocation.signal,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { kind: 'error', text: `启动「${serverName}」的 MCP 子代理失败：${message}` }
    }
    const childId = typeof started?.childId === 'string' ? started.childId : ''
    return {
      kind: 'success',
      text: `已启动 MCP 子代理（${serverName}${childId === '' ? '' : `，${childId}`}），它只能调用这个服务器的 ${tools.length} 个工具。完成后结果会作为通知回到这个会话。`,
    }
  }

  /**
   * Registered tool names owned by one MCP server.
   * @param serverName - the server whose tools to list.
   * @returns the tool names registered under that server's namespace.
   */
  toolNames(serverName) {
    const prefix = `${TOOL_PREFIX}${serverName}__`
    const names = []
    for (const schema of this.ctx.tools.schemas()) {
      const toolName = schema?.name
      if (typeof toolName === 'string' && toolName.startsWith(prefix)) names.push(toolName)
    }
    return names
  }

  /**
   * Servers one agent may use, in stable name order.
   * @param agent - the agent whose scope to resolve.
   * @returns the stored server records inside that agent's scope.
   */
  visibleServers(agent) {
    const cwd = this.agents.get(agent?.id)?.cwd ?? ''
    return this.store.servers.filter(server =>
      this.mounts.has(server.serverName)
      && (server.scope === GLOBAL_SCOPE || inScope(cwd, server.scope)))
  }

  /**
   * Look one stored server up by name.
   * @param serverName - the server name.
   * @returns the record, or undefined.
   */
  serverByName(serverName) {
    return this.store.servers.find(server => server.serverName === serverName)
  }

  /**
   * Whether one agent may use one server.
   * @param agent - the agent whose scope to resolve.
   * @param serverName - the server name.
   * @returns true when the server is mounted and inside that agent's scope.
   */
  admits(agent, serverName) {
    return this.visibleServers(agent).some(server => server.serverName === serverName)
  }

  /**
   * Command names already registered for a live session, excluding this plugin's.
   *
   * A server-scoped command legally shadows a global one of the same name, so
   * the page reports the collision instead of letting `/plan` quietly become a
   * server. Read from each live agent's effective view, which covers global and
   * other-plugin scoped registrations; with no live session the set is empty.
   *
   * @returns the names in use by other registrations.
   */
  commandNamesInUse() {
    const own = new Set(this.store.servers.map(server => server.serverName))
    const names = new Set()
    let commands
    try {
      commands = this.ctx.get('commands')
    } catch {
      commands = undefined
    }
    if (commands === undefined || typeof commands.list !== 'function') return names
    for (const record of this.agents.values()) {
      try {
        for (const descriptor of commands.list(record.agent)) {
          if (!own.has(descriptor?.name)) names.add(descriptor.name)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.ctx.logger?.warn?.(`mcp-scope: command listing for agent ${record.agent.id} failed: ${message}`)
      }
    }
    return names
  }

  /**
   * One line per live session, for the page's scope diagnostics.
   *
   * The session id is withheld: the page never needs it (it reads its own
   * current session locally for approval routing), and publishing it would
   * hand any reader of this endpoint a handle on every live session.
   *
   * @returns resolved cwd and the servers each live session's mask admits.
   */
  sessionSummaries() {
    return [...this.agents.values()].map(record => ({
      cwd: record.cwd,
      visible: [...record.visible],
      denied: [...record.denied],
    }))
  }

  /** Drop every mount, mask, and command. */
  dispose() {
    for (const agentId of [...this.masks.keys()]) {
      const mask = this.masks.get(agentId)
      this.masks.delete(agentId)
      try {
        mask?.lift()
      } catch {
        // Disposal runs while the tree collapses; a failing lift is already inert.
      }
    }
    for (const agentId of [...this.commands.keys()]) this.#dropCommands(agentId)
    this.verifyResults.clear()
    for (const serverName of [...this.mounts.keys()]) void this.#unmount(serverName)
    this.agents.clear()
  }
}

/**
 * Read one request body with a size cap.
 * @param req - the incoming request.
 * @returns the parsed JSON body.
 */
async function readJson(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (total === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Reject a request the composition's trust fence refuses.
 *
 * Security has one home: the `connection` service's `requestRejection` applies
 * DSH's own Host/Origin/Fetch-Metadata fence — which is what defeats DNS
 * rebinding — plus its browser login-token authentication. A route registered
 * through `ctx.webServer.register` receives neither automatically; only the
 * RPC bridge does. Every request therefore asks for the rejection first,
 * exactly as `@deepseek-ai/dsh-open-in-app` does.
 *
 * Without that fence this API is reachable by any page whose hostname
 * re-resolves to 127.0.0.1, and such a page can create a stdio server, which
 * executes a command. A missing service is therefore a refusal, never a pass.
 *
 * The `x-dsh-mcp-scope` header stays as a second, cheaper layer: a
 * cross-origin page cannot set it without a preflight this server never
 * grants.
 *
 * @param ctx - context carrying the optional `connection` service.
 * @param req - the incoming request.
 * @returns the HTTP status to answer with, or null when the request may proceed.
 */
function rejectionOf(ctx, req) {
  let connection
  try {
    connection = ctx.get('connection')
  } catch {
    connection = undefined
  }
  if (connection === undefined || typeof connection.requestRejection !== 'function') return 403
  const rejection = connection.requestRejection(req)
  if (rejection !== undefined) return rejection
  return req.headers[GUARD_HEADER] === '1' ? null : 403
}

/**
 * Send one JSON response.
 * @param res - the response to write.
 * @param status - HTTP status code.
 * @param body - JSON-serializable body.
 */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/** Usage line shown by `/mcp` for an unrecognized subcommand. */
const MCP_USAGE = '用法：/mcp [list | tools <服务器> | health | probe <服务器>]'

/** Deadline for one panel tool trial, in milliseconds. */
const TRIAL_TIMEOUT_MS = 120000

/** Cap on the trial result JSON, in characters. */
const TRIAL_MAX_CHARS = 60000

/** Correlation suffix counter for panel trials. */
let trialCounter = 0

/**
 * Cap one trial result payload.
 * @param value - the serialized payload.
 * @returns the payload, truncated when oversize.
 */
function capTrial(value) {
  return value.length > TRIAL_MAX_CHARS
    ? `${value.slice(0, TRIAL_MAX_CHARS)}\n…[truncated at ${TRIAL_MAX_CHARS} characters]`
    : value
}

/**
 * Describe one server's scope for human output.
 * @param server - the stored server record.
 * @returns the scope label.
 */
function scopeLabel(server) {
  return server.scope === GLOBAL_SCOPE ? '全局' : `工作区 ${server.scope}`
}

/**
 * Probe one server and phrase the outcome for a person.
 * @param server - the stored server record.
 * @returns the multi-line report.
 */
async function probeReport(server) {
  const outcome = await probeServer(server, DEFAULT_PROBE_TIMEOUT_MS)
  if (outcome.status === 'completed') {
    return `✅ ${server.serverName}：可达 — ${outcome.detail}（${outcome.elapsedMs}ms）`
  }
  return `❌ ${server.serverName}：不可达\n${diagnose(outcome.detail, server).zh}`
}

/**
 * Build the `/mcp` command definition.
 * @param runtime - the mount runtime that owns the servers.
 * @returns the command registration.
 */
function mcpCommand(runtime) {
  return {
    definitionId: 'dsh-mcp-scope',
    name: 'mcp',
    description: '列出本会话可见的 MCP 服务器、它们的工具与可达性',
    handler: async (invocation) => {
      const agent = invocation.agent
      const parts = String(invocation.rawInput ?? '').trim().split(/\s+/u).filter(part => part !== '')
      const subcommand = parts[0] ?? 'list'
      const servers = runtime.visibleServers(agent)
      if (subcommand === 'list') {
        if (servers.length === 0) {
          return { kind: 'success', text: '本会话没有可见的 MCP 服务器。用「设置 → MCP 服务器」添加。' }
        }
        const lines = servers.map(server =>
          `• ${server.serverName} — ${scopeLabel(server)}，${runtime.toolNames(server.serverName).length} 个工具`)
        return { kind: 'success', text: `本会话可见的 MCP 服务器（${servers.length}）：\n${lines.join('\n')}` }
      }
      if (subcommand === 'tools') {
        const server = servers.find(candidate => candidate.serverName === parts[1])
        if (server === undefined) {
          return { kind: 'error', text: `本会话没有可见的服务器「${parts[1] ?? ''}」。先运行 /mcp 看列表。` }
        }
        const names = runtime.toolNames(server.serverName)
        return {
          kind: 'success',
          text: names.length === 0
            ? `「${server.serverName}」当前没有注册任何工具。`
            : `「${server.serverName}」的 ${names.length} 个工具：\n${names.map(name => `• ${name}`).join('\n')}`,
        }
      }
      if (subcommand === 'health') {
        if (servers.length === 0) return { kind: 'success', text: '本会话没有可见的 MCP 服务器。' }
        const reports = await Promise.all(servers.map(server => probeReport(server)))
        return { kind: 'success', text: reports.join('\n\n') }
      }
      if (subcommand === 'probe') {
        const server = servers.find(candidate => candidate.serverName === parts[1])
        if (server === undefined) {
          return { kind: 'error', text: `本会话没有可见的服务器「${parts[1] ?? ''}」。先运行 /mcp 看列表。` }
        }
        return { kind: 'success', text: await probeReport(server) }
      }
      return { kind: 'error', text: MCP_USAGE }
    },
  }
}

/**
 * Build the `mcp_probe` model-facing tool.
 * @param runtime - the mount runtime that owns the servers.
 * @returns the tool definition.
 */
function mcpProbeTool(runtime) {
  return defineTool({
    name: 'mcp_probe',
    description: [
      'Probe one configured MCP server for reachability by completing a real MCP initialize handshake,',
      'and return the observed result plus a diagnosis when it fails.',
      'Use it when an MCP tool call fails, when a server seems missing, or before relying on a server.',
      'It only reaches servers visible to this session; a server outside this session scope is refused.',
    ].join(' '),
    parameters: {
      serverName: {
        type: 'string',
        required: true,
        description: 'The MCP server name to probe, as shown by the /mcp command.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          serverName: { type: 'string', required: true, description: 'The probed server name.' },
          reachable: { type: 'boolean', required: true, description: 'Whether the handshake completed.' },
          detail: { type: 'string', required: true, description: 'Observed result, or the failure and its repair.' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.detail }],
    },
    async execute(args, exec) {
      const server = runtime.serverByName(args.serverName)
      if (server === undefined) throw new Error(`unknown MCP server "${args.serverName}"`)
      if (!runtime.admits(exec.agent, args.serverName)) {
        throw new Error(`MCP server "${args.serverName}" is outside this session's scope`)
      }
      const outcome = await probeServer(server, DEFAULT_PROBE_TIMEOUT_MS)
      const reachable = outcome.status === 'completed'
      const detail = reachable
        ? `${args.serverName}: reachable — ${outcome.detail} (${outcome.elapsedMs}ms)`
        : `${args.serverName}: unreachable\n${diagnose(outcome.detail, server).en}`
      return { serverName: args.serverName, reachable, detail }
    },
  })
}

/**
 * Mount the Settings API and the per-session scope mask.
 * @param ctx - context carrying `tools`.
 * @param config - raw plugin config.
 */
export async function apply(ctx, config) {
  const store = new ServerStore(storePathOf(config))
  store.load()
  const runtime = new ScopeRuntime(ctx, store)
  ctx.effect(() => () => runtime.dispose(), 'mcp-scope: runtime')

  ctx.on('agent/created', (payload) => { runtime.addAgent(payload.agent) })
  ctx.on('agent/disposed', (payload) => { runtime.removeAgent(payload.agent) })

  // A server's tools appear only after its handshake, which finishes long after
  // `ctx.plugin` returned — so an agent created while a server was still
  // connecting holds an incomplete deny list, and an agent created while a
  // server was down holds none at all. `tools/change` fires on every register
  // and unregister, so the sweep runs then. It re-enters: `restrict` goes
  // through the same layer notifier, so the flag makes the nested call a
  // no-op instead of recursing.
  let sweeping = false
  ctx.on('tools/change', () => {
    if (sweeping) return
    sweeping = true
    try {
      runtime.maskAll()
    } finally {
      sweeping = false
    }
  })

  await runtime.reconcile()

  // `agent/created` only covers agents born after this plugin applied. On an
  // HMR reload the previous instance lifted every mask on its way out, so the
  // sessions that were already live would stay unmasked for the rest of their
  // lives unless they are adopted here.
  const agents = ctx.get('agents')
  if (typeof agents?.list === 'function') {
    for (const agent of agents.list()) runtime.addAgent(agent)
  }

  // The `/mcp` command exists only where a human-command registry is composed.
  ctx.inject(['commands'], (scope) => {
    scope.effect(() => scope.commands.register(mcpCommand(runtime)), 'mcp-scope: /mcp command')
  })

  // The probe tool is registered globally; its body refuses any server outside
  // the calling agent's scope, so it cannot become a scope bypass.
  ctx.effect(() => ctx.tools.register(mcpProbeTool(runtime)), 'mcp-scope: probe tool')

  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => scope.webServer.register({
      kind: 'prefix',
      path: '/mcp-scope',
      handler: async (req, res) => {
        const rejection = rejectionOf(ctx, req)
        if (rejection !== null) {
          sendJson(res, rejection, { ok: false, error: 'refused by the deployment trust fence' })
          return
        }
        const url = new URL(req.url ?? '/', 'http://localhost')
        const route = url.pathname.slice('/mcp-scope'.length)
        try {
          if (req.method === 'GET' && route === '/api/state') {
            const counts = runtime.visibleSessionCounts()
            sendJson(res, 200, {
              ok: true,
              storePath: store.path,
              loadError: store.loadError ?? null,
              servers: store.servers.map(server => ({
                ...redactSecrets(server),
                mounted: runtime.mounts.has(server.serverName),
                mountError: runtime.mountErrors.get(server.serverName) ?? null,
                // A handshake this plugin took itself, for a mount whose tools
                // never arrived: the only reachability evidence the page has.
                health: runtime.healthOf(server.serverName),
                sessions: counts.get(server.serverName) ?? 0,
                tools: runtime.toolNames(server.serverName),
                // The command name is the server name, and the registry accepts
                // lowercase only; a collision means the command would shadow an
                // existing one for every Session in scope.
                commandName: COMMAND_NAME_PATTERN.test(server.serverName) ? server.serverName : null,
                commandConflict: COMMAND_NAME_PATTERN.test(server.serverName)
                  && runtime.commandNamesInUse().has(server.serverName),
              })),
              liveSessions: runtime.sessionSummaries(),
              probeTool: ctx.tools.schemas().some(schema => schema?.name === 'mcp_probe'),
              workspaces: workspaceList(scope),
            })
            return
          }
          if (req.method === 'POST' && route === '/api/servers/verify') {
            const body = await readJson(req)
            const serverNames = Array.isArray(body?.serverNames) ? body.serverNames.map(String) : null
            sendJson(res, 200, { ok: true, verified: await runtime.verify(serverNames) })
            return
          }
          if (req.method === 'POST' && route === '/api/servers/probe') {
            const body = await readJson(req)
            const server = runtime.serverByName(String(body?.serverName ?? ''))
            if (server === undefined) throw new Error(`unknown MCP server "${body?.serverName ?? ''}"`)
            const outcome = await probeServer(server, DEFAULT_PROBE_TIMEOUT_MS)
            const reachable = outcome.status === 'completed'
            if (!reachable) logProbeStderr(ctx, server.serverName, outcome.stderrTail)
            sendJson(res, 200, {
              ok: true,
              serverName: server.serverName,
              reachable,
              detail: sanitizeText(outcome.detail),
              elapsedMs: outcome.elapsedMs,
              diagnosis: reachable ? null : diagnose(outcome.detail, server),
            })
            return
          }
          if (req.method === 'POST' && route === '/api/servers/call') {
            sendJson(res, 200, await callTool(ctx, runtime, await readJson(req)))
            return
          }
          if (req.method === 'POST' && route.startsWith('/api/servers/')) {
            const action = route.slice('/api/servers/'.length)
            const body = await readJson(req)
            sendJson(res, 200, await mutate(action, body, store, runtime))
            return
          }
          sendJson(res, 404, { ok: false, error: 'not found' })
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    }), 'mcp-scope: settings api')
  })
}

/**
 * Read the registered workspaces for the scope picker.
 * @param scope - a context carrying the optional workspace registry.
 * @returns workspace descriptors, or an empty list when unreregd.
 */
function workspaceList(scope) {
  try {
    const registry = scope.get('workspaceRegistry')
    if (registry === undefined || typeof registry.list !== 'function') return []
    return registry.list().map(workspace => ({
      id: workspace.id,
      path: workspace.path,
      title: typeof workspace.title === 'string' && workspace.title !== '' ? workspace.title : workspace.path,
    }))
  } catch {
    // A missing or half-initialized registry only costs the picker its options.
    return []
  }
}

/**
 * Run one registered MCP tool through the official execution pipeline.
 *
 * `ctx.tools.execute` applies pre-execute permission policy, approval asks,
 * guards, around-dispatch, and post-execute exactly as for a model call, so the
 * console is another caller of that pipeline rather than a way around it. When
 * the page forwards its session id, the live agent authorizes an approval ask
 * through the ordinary web channel; without one, a tool that needs approval
 * fails closed with the registry's own denial text.
 *
 * @param ctx - plugin context carrying `tools`.
 * @param runtime - the mount runtime that owns the servers.
 * @param body - `{ serverName, toolName, argumentsJson, sessionId }`.
 * @returns the capped trial result.
 */
async function callTool(ctx, runtime, body) {
  const serverName = String(body?.serverName ?? '')
  const toolName = String(body?.toolName ?? '')
  const server = runtime.serverByName(serverName)
  if (server === undefined) throw new Error(`unknown MCP server "${serverName}"`)
  if (!runtime.toolNames(serverName).includes(toolName)) {
    throw new Error(`tool "${toolName}" is not registered by "${serverName}" — the server may be down or still connecting`)
  }
  let args
  try {
    args = typeof body?.argumentsJson === 'string' && body.argumentsJson.trim() !== ''
      ? JSON.parse(body.argumentsJson)
      : {}
  } catch (error) {
    throw new Error(`argumentsJson is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const agents = ctx.get('agents')
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
  const agent = sessionId === '' ? undefined : agents?.get?.(sessionId)
  // Scope is enforced here for the same reason the mask exists: without an
  // agent, `ctx.tools.execute` resolves the name in the GLOBAL tool view, so an
  // unguarded call would run an out-of-scope server's tool. `admits` treats a
  // missing agent as "global scope only", exactly like `mcp_probe` and the
  // mask's unknown-cwd case, so a global server still trials from a fresh page.
  if (!runtime.admits(agent, serverName)) {
    throw new Error(agent === undefined
      ? `"${serverName}" is scoped to a workspace; open a session in that workspace to run its tools`
      : `"${serverName}" is outside this session's scope`)
  }
  const started = Date.now()
  const result = await ctx.tools.execute({
    callId: `mcp-scope-trial-${++trialCounter}`,
    name: toolName,
    arguments: args,
    ...(agent === undefined ? {} : { agent }),
    signal: AbortSignal.timeout(TRIAL_TIMEOUT_MS),
  })
  return {
    ok: true,
    serverName,
    toolName,
    isError: result?.isError === true,
    durationMs: Date.now() - started,
    resultJson: capTrial(JSON.stringify(result ?? null, null, 2)),
  }
}

/**
 * Apply one store mutation and reconcile the runtime.
 * @param action - create, update, toggle, or delete.
 * @param body - the request body.
 * @param store - the server store.
 * @param runtime - the mount runtime.
 * @returns the response body.
 */
async function mutate(action, body, store, runtime) {
  const serverName = String(body?.serverName ?? '').trim()
  if (action === 'create') {
    const server = validateServer(body.server)
    if (store.servers.some(row => row.serverName === server.serverName)) {
      throw new Error(`a server named "${server.serverName}" already exists`)
    }
    store.servers = [...store.servers, server]
  } else if (action === 'update') {
    const index = store.servers.findIndex(row => row.serverName === serverName)
    if (index < 0) throw new Error(`unknown server "${serverName}"`)
    const stored = store.servers[index]
    // Merge over the stored record. The page withholds credential values and
    // may omit a field entirely, and taking an absent field as its default
    // would silently erase what the person never touched.
    const submitted = { ...(body.server ?? {}), serverName: stored.serverName }
    if (submitted.env !== undefined) submitted.env = mergeSecrets(submitted.env, stored.env)
    if (submitted.headers !== undefined) submitted.headers = mergeSecrets(submitted.headers, stored.headers)
    const server = validateServer({ ...stored, ...submitted })
    store.servers = store.servers.map((row, at) => (at === index ? server : row))
  } else if (action === 'toggle') {
    const index = store.servers.findIndex(row => row.serverName === serverName)
    if (index < 0) throw new Error(`unknown server "${serverName}"`)
    const enabled = body?.enabled === true
    store.servers = store.servers.map((row, at) => (at === index ? { ...row, enabled } : row))
  } else if (action === 'delete') {
    if (!store.servers.some(row => row.serverName === serverName)) {
      throw new Error(`unknown server "${serverName}"`)
    }
    store.servers = store.servers.filter(row => row.serverName !== serverName)
  } else {
    throw new Error(`unknown action "${action}"`)
  }
  store.save()
  store.loadError = undefined
  await runtime.reconcile()
  return { ok: true, servers: store.servers }
}
