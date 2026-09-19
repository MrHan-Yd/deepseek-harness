/**
 * dsh-agent-scope — workspace-scoped named sub-agents for DeepSeek Harness.
 *
 * Each stored definition becomes one real delegation target: the plugin mounts
 * the official `@deepseek-ai/dsh-tool-subagent` row with the definition's name
 * as its model-facing tool name, and passes the definition's system prompt as
 * the child persona, its checked tools as the child's tool filter, and its
 * selected route as the child's agent options. Delegation, provider capability
 * checks, depth limits, and child settlement therefore stay owned by the
 * official row; this plugin owns the definition store, the Settings API, and
 * where a definition applies.
 *
 * Two scopes per definition:
 *   'global'      every session may delegate to it.
 *   '<abs path>'  only sessions whose canonical cwd is that workspace directory
 *                 or a descendant of it may delegate to it.
 *
 * Scope is enforced per session, like `dsh-mcp-scope`: every enabled definition
 * is mounted once on the root context, and each agent receives a
 * `tools.restrict({ deny })` mask naming the tools of the definitions outside
 * its scope, plus an agent-scoped prompt section that advertises the ones
 * inside it. `tools.restrict` requires a scoped context, which `agent.ctx` is;
 * a context-global restriction would mask every agent, so the mask is always
 * applied per agent and lifted on disposal.
 *
 * The Settings page talks to this half over a same-origin HTTP API rather than
 * a typed Remote: the plugin ships no generated Remote assembly, and the route
 * handler is small enough to audit in place. Every request goes through the
 * `connection` service's `requestRejection`, which applies DSH's own Host,
 * Origin, and Fetch-Metadata fence plus browser login-token authentication.
 *
 * Function plugin: named exports and no default export, so the Loader keeps the
 * namespace.
 *
 * @module dsh-agent-scope
 */

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import * as toolSubagent from '@deepseek-ai/dsh-tool-subagent'

export const name = 'agent-scope'

/** Hard services: the tool registry the mask targets, and the agent lifecycle events. */
export const inject = ['tools', 'agents']

/** Request header a cross-origin page cannot set without a granted preflight. */
const GUARD_HEADER = 'x-dsh-agent-scope'

/** Cap on one request body, in bytes. */
const MAX_BODY_BYTES = 256 * 1024

/** The one scope value meaning "every workspace". */
const GLOBAL_SCOPE = 'global'

/** Sub-agent name contract: it becomes the model-facing tool name. */
const NAME_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/

/** Prompt-section name this plugin owns inside one agent's scope. */
const SECTION_NAME = 'agent-scope:catalog'

/** Instruction file appended to a definition's system prompt when injection is on. */
const INSTRUCTION_FILE = 'AGENTS.md'

/**
 * Resolve the harness home directory.
 * @returns the absolute `$DSH_HOME`, or `~/.dsh` when unset.
 */
function dshHome() {
  const configured = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return configured === '' ? join(homedir(), '.dsh') : resolve(configured)
}

/**
 * Resolve the definition store path.
 * @param config - raw plugin config.
 * @returns the absolute store path.
 */
function storePathOf(config) {
  const configured = typeof config?.storePath === 'string' ? config.storePath.trim() : ''
  return configured === '' ? join(dshHome(), 'agent-scope.json') : resolve(configured)
}

/**
 * Canonicalize a directory path so scope comparison survives symlinks.
 * @param path - candidate path.
 * @returns the realpath when it exists, otherwise the resolved path.
 */
function canonical(path) {
  const resolved = resolve(path)
  try {
    return realpathSync(resolved)
  } catch {
    // A workspace directory can be deleted while its record survives; the
    // resolved spelling is then the best identity available.
    return resolved
  }
}

/**
 * Whether a session cwd falls inside a workspace scope.
 * @param cwd - canonical session cwd, or '' when the header carries none.
 * @param scope - absolute workspace path.
 * @returns true when the session runs in that workspace or below it.
 */
function inScope(cwd, scope) {
  if (cwd === '') return false
  const target = canonical(scope)
  return cwd === target || cwd.startsWith(target.endsWith(sep) ? target : target + sep)
}

/**
 * Normalize one scope value.
 * @param value - 'global' or an absolute directory path.
 * @returns the normalized scope.
 */
function normalizeScope(value) {
  if (value === undefined || value === null || value === '') return GLOBAL_SCOPE
  const text = String(value).trim()
  if (text === GLOBAL_SCOPE) return GLOBAL_SCOPE
  if (!text.startsWith('/')) throw new Error('a workspace scope must be an absolute path')
  return resolve(text)
}

/**
 * Read the instruction file a definition would inject.
 * @param definition - the validated definition.
 * @returns the absolute path and whether it exists.
 */
function instructionFileOf(definition) {
  const path = definition.scope === GLOBAL_SCOPE
    ? join(dshHome(), INSTRUCTION_FILE)
    : join(definition.scope, INSTRUCTION_FILE)
  return { path, exists: existsSync(path) }
}

/**
 * Read the injected instruction text, tolerating an unreadable file.
 * @param definition - the validated definition.
 * @returns the file's text, or '' when absent or unreadable.
 */
function instructionTextOf(definition) {
  const file = instructionFileOf(definition)
  if (!file.exists) return ''
  try {
    return readFileSync(file.path, 'utf8').trim()
  } catch (error) {
    // An unreadable instruction file only costs the definition its injected
    // text; failing the mount over it would take the whole sub-agent offline.
    return ''
  }
}

/**
 * Validate one incoming definition record from the Settings page.
 * @param input - raw record.
 * @returns the normalized definition record.
 */
function validateAgent(input) {
  if (typeof input !== 'object' || input === null) throw new Error('agent must be an object')
  const agentName = String(input.name ?? '').trim()
  if (!NAME_PATTERN.test(agentName)) {
    throw new Error('name must match [a-z][a-z0-9_-]{0,63}: it becomes the model-facing delegation tool name')
  }
  const definition = {
    name: agentName,
    description: typeof input.description === 'string' ? input.description.trim() : '',
    color: typeof input.color === 'string' ? input.color.trim() : '',
    scope: normalizeScope(input.scope),
    enabled: input.enabled !== false,
    systemPrompt: typeof input.systemPrompt === 'string' ? input.systemPrompt : '',
    injectAgentsMd: input.injectAgentsMd === true,
    model: null,
    tools: { mode: 'all', allow: [] },
  }
  if (input.model !== undefined && input.model !== null) {
    const provider = String(input.model.provider ?? '').trim()
    const model = String(input.model.model ?? '').trim()
    if (provider === '' || model === '') throw new Error('a model route needs both a provider and a model id')
    definition.model = { provider, model }
  }
  if (input.tools !== undefined && input.tools !== null) {
    if (input.tools.mode === 'custom') {
      const allow = Array.isArray(input.tools.allow)
        ? [...new Set(input.tools.allow.map(entry => String(entry).trim()).filter(entry => entry !== ''))]
        : []
      if (allow.length === 0) throw new Error('custom tool access needs at least one selected tool')
      definition.tools = { mode: 'custom', allow: [...allow].sort() }
    } else if (input.tools.mode !== undefined && input.tools.mode !== 'all') {
      throw new Error('tools.mode must be "all" or "custom"')
    }
  }
  return definition
}

/**
 * The persona a definition gives every child.
 *
 * The official row's `persona` shadows `deployment:persona-prefix` for the
 * child alone, so an empty persona is omitted entirely: a definition that sets
 * neither a system prompt nor instruction injection must leave the deployment
 * persona in place rather than blank it.
 *
 * @param definition - the validated definition.
 * @returns the persona text, or '' when the definition contributes none.
 */
function personaOf(definition) {
  const parts = []
  const prompt = definition.systemPrompt.trim()
  if (prompt !== '') parts.push(prompt)
  if (definition.injectAgentsMd) {
    const instructions = instructionTextOf(definition)
    if (instructions !== '') parts.push(instructions)
  }
  return parts.join('\n\n')
}

/**
 * Project one stored definition onto the official delegation-tool config.
 * @param definition - the validated definition.
 * @returns the `@deepseek-ai/dsh-tool-subagent` config.
 */
function toolConfigOf(definition) {
  const persona = personaOf(definition)
  return {
    provider: 'spawn',
    toolName: definition.name,
    // Continuable matches the deployment's own `subagent` row: a delegation
    // returns a durable child id and settles with a notice, so a long review
    // never blocks the parent turn. Model selection stays off because this
    // instance owns a fixed route; the deployment row already registers the one
    // global `list_subagent_models` tool.
    backgroundMode: 'continuable',
    ...(definition.model === null ? {} : { agentOptions: { ...definition.model } }),
    ...(persona === '' ? {} : { persona }),
    ...(definition.tools.mode === 'custom' ? { toolFilter: { allow: [...definition.tools.allow] } } : {}),
  }
}

/**
 * The mounted-configuration signature of one definition.
 *
 * A disabled definition signs as `disabled` rather than as its own tool config:
 * the config of an enabled and a disabled definition is otherwise identical, so
 * a signature that ignored the flag would make reconciliation treat a
 * disabled mount as current and leave its tool registered.
 *
 * @param definition - the validated definition.
 * @returns the signature string.
 */
function signatureOf(definition) {
  return definition.enabled ? JSON.stringify(toolConfigOf(definition)) : 'disabled'
}

/** Sort definition records by name for a stable stored order. */
function byName(left, right) {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
}

/** Mutable definition store backed by one JSON file. */
class AgentStore {
  /** @param path - absolute store path. */
  constructor(path) {
    this.path = path
    this.agents = []
  }

  /** Load the file, tolerating a missing or unreadable store. */
  load() {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'))
      const rows = Array.isArray(parsed?.agents) ? parsed.agents : []
      this.agents = rows.map(row => validateAgent(row))
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        // A corrupt store must not take the page down; the next write replaces it.
        this.agents = []
        this.loadError = error instanceof Error ? error.message : String(error)
      }
    }
    return this.agents
  }

  /** Persist the store atomically and owner-only. */
  save() {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const body = JSON.stringify({ version: 1, agents: [...this.agents].sort(byName) }, null, 2)
    const temporary = `${this.path}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`
    writeFileSync(temporary, `${body}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    renameSync(temporary, this.path)
  }
}

/** Mounts delegation targets, masks per-session tools, and owns the store. */
class ScopeRuntime {
  /**
   * @param ctx - plugin context carrying `tools`.
   * @param store - the definition store.
   */
  constructor(ctx, store) {
    this.ctx = ctx
    this.store = store
    /** @type {Map<string, { fiber: unknown, signature: string }>} */
    this.mounts = new Map()
    /** @type {Map<string, { lift: () => void, deny: string[] }>} */
    this.masks = new Map()
    /** @type {Map<string, { lift: () => void, text: string }>} */
    this.sections = new Map()
    /** @type {Map<string, { agent: unknown, cwd: string, visible: string[], denied: string[] }>} */
    this.agents = new Map()
    /** @type {Map<string, string>} */
    this.mountErrors = new Map()
    /** @type {Map<string, { signature: string, fiber: unknown }>} */
    this.commands = new Map()
  }

  /**
   * Reconcile the mounted definitions with the store, then re-mask every live agent.
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
    for (const definition of this.store.agents) wanted.set(definition.name, definition)
    for (const [agentName, mount] of [...this.mounts]) {
      const definition = wanted.get(agentName)
      const signature = definition === undefined ? undefined : signatureOf(definition)
      if (definition !== undefined && mount.signature === signature) continue
      // Awaiting matters: the official row registers its tool under `toolName`,
      // so remounting before the old fiber released the name makes the new apply
      // fail — a failure `ctx.plugin` parks in the fiber instead of throwing here.
      await this.#unmount(agentName)
    }
    for (const [agentName, definition] of wanted) {
      if (this.mounts.has(agentName)) continue
      if (!definition.enabled) continue
      this.#mount(definition)
    }
    this.maskAll()
  }

  /**
   * Mount one definition on the root context.
   * @param definition - validated definition record.
   */
  #mount(definition) {
    const config = toolConfigOf(definition)
    try {
      const fiber = this.ctx.plugin(toolSubagent, config)
      this.mounts.set(definition.name, { fiber, signature: signatureOf(definition) })
      this.mountErrors.delete(definition.name)
      // `ctx.plugin` does not throw when the plugin refuses to apply: it parks
      // the rejection in the fiber. Without observing it a definition that never
      // mounted still reads as ready on the page — with no tool and no reason
      // shown — and its signature matches, so no later reconcile retries it.
      Promise.resolve(fiber).then(
        () => {},
        (error) => {
          if (this.mounts.get(definition.name)?.fiber !== fiber) return
          const message = error instanceof Error ? error.message : String(error)
          this.mountErrors.set(definition.name, message)
          this.ctx.logger?.warn?.(`agent-scope: "${definition.name}" failed to apply: ${message}`)
        },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.mountErrors.set(definition.name, message)
      this.ctx.logger?.warn?.(`agent-scope: "${definition.name}" failed to mount: ${message}`)
    }
  }

  /**
   * Dispose one mounted definition.
   *
   * Awaited by the caller: disposal releases the `toolName` registration, and
   * only after it settles can the same name mount again.
   *
   * @param agentName - the definition to unmount.
   * @returns a promise settling after disposal.
   */
  async #unmount(agentName) {
    const mount = this.mounts.get(agentName)
    if (mount === undefined) return
    this.mounts.delete(agentName)
    try {
      await mount.fiber?.dispose?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger?.warn?.(`agent-scope: "${agentName}" failed to unmount: ${message}`)
    }
  }

  /**
   * Record one live agent, mask its out-of-scope tools, and advertise the rest.
   * @param agent - the created agent.
   */
  addAgent(agent) {
    this.agents.set(agent.id, { agent, cwd: '', visible: [], denied: [] })
    this.#mask(agent)
  }

  /**
   * Forget one agent and lift its mask, prompt section, and commands.
   * @param agent - the disposed agent.
   */
  removeAgent(agent) {
    this.agents.delete(agent.id)
    const mask = this.masks.get(agent.id)
    if (mask !== undefined) {
      this.masks.delete(agent.id)
      try {
        mask.lift()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.ctx.logger?.warn?.(`agent-scope: agent ${agent.id} mask release failed: ${message}`)
      }
    }
    this.#dropCommands(agent.id)
    const section = this.sections.get(agent.id)
    if (section === undefined) return
    this.sections.delete(agent.id)
    try {
      section.lift()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger?.warn?.(`agent-scope: agent ${agent.id} catalog release failed: ${message}`)
    }
  }

  /** Re-mask every live agent after a store or mount change. */
  maskAll() {
    for (const record of this.agents.values()) this.#mask(record.agent)
  }

  /**
   * How many live sessions currently see each definition.
   * @returns definition name to the number of sessions whose mask admits it.
   */
  visibleSessionCounts() {
    const counts = new Map()
    for (const record of this.agents.values()) {
      for (const agentName of record.visible) counts.set(agentName, (counts.get(agentName) ?? 0) + 1)
    }
    return counts
  }

  /**
   * The catalog text one agent's prompt should carry.
   *
   * A child agent is skipped: the depth cap of the mounted delegation tools
   * refuses nested delegation, so advertising them inside a child would only
   * invite a call that cannot succeed.
   *
   * @param agent - the agent whose scope to resolve.
   * @param visible - definitions inside that scope, in name order.
   * @returns the section text, or '' when there is nothing to advertise.
   */
  #catalogText(agent, visible) {
    if (visible.length === 0) return ''
    const depth = Number(agent?.session?.header?.delegationDepth ?? 0)
    if (Number.isFinite(depth) && depth > 0) return ''
    const lines = visible.map(definition => {
      const route = definition.model === null ? '' : ` (model: ${definition.model.provider}/${definition.model.model})`
      const description = definition.description === '' ? '' : ` — ${definition.description}`
      return `- \`${definition.name}\`${description}${route}`
    })
    return [
      'Named sub-agents are configured for this session. Delegate to one by calling the tool',
      'named after it; the child runs in its own context and returns its own result.',
      '',
      ...lines,
    ].join('\n')
  }

  /**
   * Apply this agent's scope mask and refresh its catalog section.
   * @param agent - the agent to mask.
   */
  #mask(agent) {
    const record = this.agents.get(agent.id)
    const deny = []
    const visible = []
    const visibleDefinitions = []
    try {
      const cwd = typeof agent.session?.header?.cwd === 'string' ? canonical(agent.session.header.cwd) : ''
      if (record !== undefined) record.cwd = cwd
      for (const definition of this.store.agents) {
        if (!this.mounts.has(definition.name)) continue
        if (definition.scope === GLOBAL_SCOPE || inScope(cwd, definition.scope)) {
          visible.push(definition.name)
          visibleDefinitions.push(definition)
          continue
        }
        deny.push(definition.name)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger?.warn?.(`agent-scope: agent ${agent.id} scope resolution failed: ${message}`)
      return
    }
    if (record !== undefined) {
      record.visible = visible
      record.denied = deny
    }
    this.#applyMask(agent, deny)
    this.#applySection(agent, this.#catalogText(agent, visibleDefinitions))
    this.#applyCommands(agent, visibleDefinitions)
  }

  /**
   * Install one agent's deny mask, replacing the previous one.
   * @param agent - the agent to mask.
   * @param deny - out-of-scope delegation tool names.
   */
  #applyMask(agent, deny) {
    const previous = this.masks.get(agent.id)
    if (previous !== undefined && previous.deny.length === deny.length
      && previous.deny.every(entry => deny.includes(entry))) {
      // A re-sweep that computes the same mask must not churn the restriction.
      return
    }
    // Apply the new restriction BEFORE lifting the old one. `restrict` throws on
    // a name that is not registered — the state a definition is in while the
    // official row is still applying — and lifting first would leave the agent
    // unmasked, exposing exactly the tools this method exists to hide.
    let next
    if (deny.length > 0) {
      try {
        next = agent.ctx.tools.restrict({ deny })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.ctx.logger?.warn?.(`agent-scope: agent ${agent.id} mask not applied yet: ${message}`)
      }
    }
    if (previous !== undefined) {
      this.masks.delete(agent.id)
      try {
        previous.lift()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.ctx.logger?.warn?.(`agent-scope: agent ${agent.id} mask replace failed: ${message}`)
      }
    }
    if (next !== undefined) this.masks.set(agent.id, { lift: next, deny })
  }

  /**
   * Register or replace one agent's sub-agent catalog prompt section.
   *
   * The section lives in the agent's own scope, so its text is folded from that
   * session's cwd without a second scope lookup, and it unwinds with the agent.
   *
   * @param agent - the agent whose prompt to shape.
   * @param text - the catalog text, or '' for no section.
   */
  #applySection(agent, text) {
    const previous = this.sections.get(agent.id)
    if (previous !== undefined && previous.text === text) return
    if (previous !== undefined) {
      this.sections.delete(agent.id)
      try {
        previous.lift()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.ctx.logger?.warn?.(`agent-scope: agent ${agent.id} catalog replace failed: ${message}`)
      }
    }
    if (text === '') return
    try {
      const prompt = agent.ctx.systemPrompt
      const lift = prompt.section({
        name: SECTION_NAME,
        order: prompt.getSectionOrder('TOOL_SUBAGENT'),
        // The catalog is configuration prose, not a template: a definition's
        // description containing `{{…}}` must reach the model literally.
        interpolate: false,
        text,
      })
      this.sections.set(agent.id, { lift, text })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger?.warn?.(`agent-scope: agent ${agent.id} catalog not applied yet: ${message}`)
    }
  }

  /**
   * Register one agent's slash commands, one per visible definition.
   *
   * Commands are registered through a child of the agent's own context, which
   * is what scopes them: the registry resolves a definition's layer from the
   * calling context's scope key, so an out-of-scope sub-agent is absent from
   * that session's `/` menu instead of failing when invoked.
   *
   * @param agent - the agent whose composer to extend.
   * @param definitions - definitions inside that agent's scope.
   */
  #applyCommands(agent, definitions) {
    const signature = definitions.map(definition => `${definition.name}\u0000${definition.description}`).join('\u0001')
    const previous = this.commands.get(agent.id)
    if (previous !== undefined && previous.signature === signature) return
    this.#dropCommands(agent.id)
    if (definitions.length === 0) return
    try {
      const fiber = agent.ctx.inject(['commands'], (scope) => {
        for (const definition of definitions) {
          scope.commands.register(this.#commandFor(definition))
        }
      })
      this.commands.set(agent.id, { signature, fiber })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger?.warn?.(`agent-scope: agent ${agent.id} commands not registered: ${message}`)
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
      this.ctx.logger?.warn?.(`agent-scope: agent ${agentId} command release failed: ${message}`)
    }
  }

  /**
   * Build the slash command that runs one definition in the foreground.
   * @param definition - the definition to expose.
   * @returns the command registration.
   */
  #commandFor(definition) {
    return {
      definitionId: `agent-scope:${definition.name}`,
      name: definition.name,
      description: definition.description === ''
        ? `调用子智能体 ${definition.name}`
        : definition.description,
      // The hint becomes the composer's placeholder once a menu pick claims
      // this command, which is the moment a person needs to know that the task
      // still has to be typed and a second Enter runs it.
      input: { hint: '任务描述，再按回车运行' },
      handler: (invocation) => this.runFromCommand(definition.name, invocation),
    }
  }

  /**
   * Run one definition's sub-agent for a human-typed command.
   *
   * The command dispatches the definition's own mounted delegation tool through
   * the official pipeline rather than starting a child itself. That keeps one
   * owner for child composition, depth, and settlement, and it is what makes a
   * human invocation behave like a model one: the tool returns as soon as the
   * child accepts its prompt, so the composer frees immediately, and the child's
   * closing message reaches this session as a settlement notice that wakes the
   * agent — the sub-agent's work therefore lands in the conversation instead of
   * ending at a command result the model never sees.
   *
   * @param agentName - the definition's name.
   * @param invocation - the human command invocation.
   * @returns the command outcome rendered by the composer.
   */
  async runFromCommand(agentName, invocation) {
    const definition = this.store.agents.find(row => row.name === agentName)
    if (definition === undefined) return { kind: 'error', text: `子智能体「${agentName}」已不存在。` }
    if (!definition.enabled || !this.mounts.has(agentName)) {
      return { kind: 'error', text: `子智能体「${agentName}」当前未装载，先在「设置 → 子智能体」启用它。` }
    }
    const task = String(invocation.rawInput ?? '').trim()
    if (task === '') return { kind: 'error', text: `用法：/${agentName} <任务>` }
    // The delegation tool requires a short label; it becomes the child's durable
    // creation label in listings.
    const label = (definition.description === '' ? task : definition.description).slice(0, 60)
    let result
    try {
      result = await this.ctx.tools.execute({
        callId: `agent-scope-command-${++commandSeq}`,
        name: agentName,
        arguments: { description: label, prompt: task },
        agent: invocation.agent,
        signal: invocation.signal,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { kind: 'error', text: `子智能体「${agentName}」启动失败：${message}` }
    }
    if (result?.isError === true) {
      const failure = contentText(result.content)
      return { kind: 'error', text: failure === '' ? `子智能体「${agentName}」启动失败。` : failure }
    }
    const value = result?.value
    if (value?.kind === 'continuable' && typeof value.subagentId === 'string') {
      return {
        kind: 'success',
        text: `已启动子智能体 ${agentName}（${value.subagentId}）。它完成后，结果会作为一条通知回到这个会话。`,
      }
    }
    if (value?.kind === 'background' && typeof value.jobId === 'string') {
      return { kind: 'success', text: `已在后台启动子智能体任务 ${value.jobId}，用 job_output 收集。` }
    }
    const text = contentText(result?.content)
    return { kind: 'success', text: text === '' ? `已启动子智能体 ${agentName}。` : text }
  }

  /**
   * Command names already registered for a live session, excluding this plugin's.
   *
   * Read from the effective view of each live agent, so it covers both global
   * commands and another plugin's scoped ones. A deployment with no live
   * session yields an empty set rather than inventing names.
   *
   * @returns the names in use by other registrations.
   */
  commandNamesInUse() {
    const own = new Set(this.store.agents.map(definition => definition.name))
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
        this.ctx.logger?.warn?.(`agent-scope: command listing for agent ${record.agent.id} failed: ${message}`)
      }
    }
    return names
  }

  /**
   * Definitions one agent may delegate to, in stable name order.
   * @param agent - the agent whose scope to resolve.
   * @returns the stored definition records inside that agent's scope.
   */
  visibleAgents(agent) {
    const cwd = this.agents.get(agent?.id)?.cwd ?? ''
    return this.store.agents.filter(definition =>
      this.mounts.has(definition.name)
      && (definition.scope === GLOBAL_SCOPE || inScope(cwd, definition.scope)))
  }

  /**
   * Whether one agent may delegate to one definition.
   * @param agent - the agent whose scope to resolve.
   * @param agentName - the definition name.
   * @returns true when the definition is mounted and inside that agent's scope.
   */
  admits(agent, agentName) {
    return this.visibleAgents(agent).some(definition => definition.name === agentName)
  }

  /**
   * One line per live session, for the page's scope diagnostics.
   *
   * The session id is withheld: the page never needs it, and publishing it
   * would hand any reader of this endpoint a handle on every live session.
   *
   * @returns resolved cwd and the definitions each live session's mask admits.
   */
  sessionSummaries() {
    return [...this.agents.values()].map(record => ({
      cwd: record.cwd,
      visible: [...record.visible],
      denied: [...record.denied],
    }))
  }

  /**
   * Registered tool names owned by one definition.
   * @param agentName - the definition's tool name.
   * @returns the definition's tool name when it is registered, else an empty list.
   */
  toolNames(agentName) {
    return this.ctx.tools.schemas().some(schema => schema?.name === agentName) ? [agentName] : []
  }

  /**
   * The root context's visible tool schemas.
   * @returns the schemas this plugin's own context resolves.
   */
  rootSchemas() {
    try {
      return this.ctx.tools.schemas()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger?.warn?.(`agent-scope: root tool listing failed: ${message}`)
      return []
    }
  }

  /**
   * Tool names a person may grant to a definition.
   *
   * The root view holds only host-plane registrations, while the deployment's
   * ordinary tools (read, grep, bash, …) are registered by each session's
   * preset composition and resolve only when the lookup passes that agent's
   * scope. `schemas()` derives its layer chain from that argument alone, so a
   * union across live agents is the only listing that reflects what a child
   * could actually be granted; with no live session it degrades to the
   * host-plane set rather than inventing names.
   *
   * This plugin's own delegation tools are excluded: granting one sub-agent
   * another sub-agent's tool only meets the delegation depth cap.
   *
   * @returns sorted tool names from the host plane and every live session.
   */
  availableToolNames() {
    const own = new Set(this.store.agents.map(definition => definition.name))
    const names = new Set()
    const collect = (schemas) => {
      for (const schema of schemas) {
        const toolName = schema?.name
        if (typeof toolName === 'string' && !own.has(toolName)) names.add(toolName)
      }
    }
    collect(this.rootSchemas())
    for (const record of this.agents.values()) {
      try {
        collect(this.ctx.tools.schemas(record.agent))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.ctx.logger?.warn?.(`agent-scope: tool listing for agent ${record.agent.id} failed: ${message}`)
      }
    }
    return [...names].sort()
  }

  /**
   * Names of every stored definition, for the panel's tool picker.
   * @returns the definition names.
   */
  definitionNames() {
    return this.store.agents.map(definition => definition.name)
  }

  /** Drop every mount, mask, and section. */
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
    for (const agentId of [...this.sections.keys()]) {
      const section = this.sections.get(agentId)
      this.sections.delete(agentId)
      try {
        section?.lift()
      } catch {
        // Same as above: the enclosing scope is going away regardless.
      }
    }
    for (const agentId of [...this.commands.keys()]) this.#dropCommands(agentId)
    for (const agentName of [...this.mounts.keys()]) void this.#unmount(agentName)
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
 * re-resolves to 127.0.0.1, and such a page can define a sub-agent: its system
 * prompt and tool filter then shape a child agent that runs real tools. A
 * missing service is therefore a refusal, never a pass.
 *
 * The `x-dsh-agent-scope` header stays as a second, cheaper layer: a
 * cross-origin page cannot set it without a preflight this server never grants.
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

/** Usage line shown by `/agents` for an unrecognized subcommand. */
const AGENTS_USAGE = '用法：/agents [list | show <名称>]'

/** Correlation suffix counter for command-dispatched delegations. */
let commandSeq = 0

/**
 * Join the text blocks of one tool result projection.
 * @param content - the result's content blocks, when present.
 * @returns the concatenated text.
 */
function contentText(content) {
  return (content ?? [])
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

/**
 * Describe one definition's scope for human output.
 * @param definition - the stored definition record.
 * @returns the scope label.
 */
function scopeLabel(definition) {
  return definition.scope === GLOBAL_SCOPE ? '全局' : `工作区 ${definition.scope}`
}

/**
 * Build the `/agents` command definition.
 * @param runtime - the mount runtime that owns the definitions.
 * @returns the command registration.
 */
function agentsCommand(runtime) {
  return {
    definitionId: 'dsh-agent-scope',
    name: 'agents',
    description: '列出本会话可见的子智能体、它们的工具与作用域',
    handler: async (invocation) => {
      const definitions = runtime.visibleAgents(invocation.agent)
      const parts = String(invocation.rawInput ?? '').trim().split(/\s+/u).filter(part => part !== '')
      const subcommand = parts[0] ?? 'list'
      if (subcommand === 'list') {
        if (definitions.length === 0) {
          return { kind: 'success', text: '本会话没有可见的子智能体。用「设置 → 子智能体」添加。' }
        }
        const lines = definitions.map(definition =>
          `• ${definition.name} — ${scopeLabel(definition)}，${runtime.toolNames(definition.name).length} 个工具`
          + (definition.description === '' ? '' : `\n  ${definition.description}`))
        return { kind: 'success', text: `本会话可见的子智能体（${definitions.length}）：\n${lines.join('\n')}` }
      }
      if (subcommand === 'show') {
        const definition = definitions.find(candidate => candidate.name === parts[1])
        if (definition === undefined) {
          return { kind: 'error', text: `本会话没有可见的子智能体「${parts[1] ?? ''}」。先运行 /agents 看列表。` }
        }
        const route = definition.model === null
          ? '继承会话（未指定模型）'
          : `${definition.model.provider}/${definition.model.model}`
        const tools = definition.tools.mode === 'all'
          ? '全部已注册工具'
          : definition.tools.allow.join('、')
        return {
          kind: 'success',
          text: [
            `${definition.name} — ${scopeLabel(definition)}`,
            definition.description === '' ? '（没有描述）' : definition.description,
            `模型：${route}`,
            `工具：${tools}`,
            `工具名：${definition.name}`,
          ].join('\n'),
        }
      }
      return { kind: 'error', text: AGENTS_USAGE }
    },
  }
}

/**
 * Read the deployment's model catalog for the route picker.
 * @param ctx - context carrying the optional LLM registry.
 * @returns provider groups, the current default route, and any failure text.
 */
async function modelCatalog(ctx) {
  let llm
  try {
    llm = ctx.get('llm')
  } catch {
    llm = undefined
  }
  if (llm === undefined || typeof llm.listProviders !== 'function') {
    return { default: null, providers: [], error: 'this composition provides no LLM registry' }
  }
  let fallback = null
  try {
    const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
    if (selection?.provider !== undefined && selection?.model !== undefined) {
      fallback = { provider: String(selection.provider), model: String(selection.model) }
    }
  } catch {
    // A composition without the default-model service only costs the picker its
    // "inherited" label; the catalog below is still the authoritative list.
    fallback = null
  }
  const providers = []
  let error = null
  for (const provider of llm.listProviders()) {
    try {
      const models = await llm.listModels(provider.id)
      providers.push({
        id: provider.id,
        name: typeof provider.name === 'string' && provider.name !== '' ? provider.name : provider.id,
        models: models.map(modelEntry => ({ id: modelEntry.id, name: modelEntry.name ?? modelEntry.id })),
      })
    } catch (cause) {
      // One unreachable provider must not empty the picker; it degrades to a
      // reported failure beside the groups that did answer.
      error = cause instanceof Error ? cause.message : String(cause)
    }
  }
  return { default: fallback, providers, error }
}

/**
 * Read the registered workspaces for the scope picker.
 * @param scope - a context carrying the optional workspace registry.
 * @returns workspace descriptors, or an empty list when unregistered.
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
 * Apply one store mutation and reconcile the runtime.
 * @param action - create, update, toggle, or delete.
 * @param body - the request body.
 * @param store - the definition store.
 * @param runtime - the mount runtime.
 * @returns the response body.
 */
async function mutate(action, body, store, runtime) {
  const agentName = String(body?.name ?? '').trim()
  if (action === 'create') {
    const definition = validateAgent(body.agent)
    if (store.agents.some(row => row.name === definition.name)) {
      throw new Error(`a sub-agent named "${definition.name}" already exists`)
    }
    if (runtime.availableToolNames().includes(definition.name)) {
      throw new Error(`the tool name "${definition.name}" is already registered by another plugin; pick another name`)
    }
    // The name is also a slash command, and an agent-scoped command shadows a
    // global one of the same name in every session this definition reaches.
    if (runtime.commandNamesInUse().has(definition.name)) {
      throw new Error(`the command name "/${definition.name}" is already registered; pick another name`)
    }
    store.agents = [...store.agents, definition]
  } else if (action === 'update') {
    const index = store.agents.findIndex(row => row.name === agentName)
    if (index < 0) throw new Error(`unknown sub-agent "${agentName}"`)
    const stored = store.agents[index]
    // Merge over the stored record: the page may omit a field, and taking an
    // absent field as its default would silently erase what the person never
    // touched. The name stays the stored one — it is the mounted tool name.
    const definition = validateAgent({ ...stored, ...(body.agent ?? {}), name: stored.name })
    store.agents = store.agents.map((row, at) => (at === index ? definition : row))
  } else if (action === 'toggle') {
    const index = store.agents.findIndex(row => row.name === agentName)
    if (index < 0) throw new Error(`unknown sub-agent "${agentName}"`)
    const enabled = body?.enabled === true
    store.agents = store.agents.map((row, at) => (at === index ? { ...row, enabled } : row))
  } else if (action === 'delete') {
    if (!store.agents.some(row => row.name === agentName)) {
      throw new Error(`unknown sub-agent "${agentName}"`)
    }
    store.agents = store.agents.filter(row => row.name !== agentName)
  } else {
    throw new Error(`unknown action "${action}"`)
  }
  store.save()
  store.loadError = undefined
  await runtime.reconcile()
  return { ok: true, agents: store.agents }
}

/**
 * Mount the Settings API, the per-session scope mask, and the catalog section.
 * @param ctx - context carrying `tools`.
 * @param config - raw plugin config.
 */
export async function apply(ctx, config) {
  const store = new AgentStore(storePathOf(config))
  store.load()
  const runtime = new ScopeRuntime(ctx, store)
  ctx.effect(() => () => runtime.dispose(), 'agent-scope: runtime')

  ctx.on('agent/created', (payload) => { runtime.addAgent(payload.agent) })
  ctx.on('agent/disposed', (payload) => { runtime.removeAgent(payload.agent) })

  // A delegation tool appears only after the official row's own apply, which
  // finishes after `ctx.plugin` returned — so an agent created while a
  // definition was still mounting holds an incomplete deny list, and an agent
  // created while mounting failed holds none at all. `tools/change` fires on
  // every register and unregister, so the sweep runs then. It re-enters:
  // `restrict` goes through the same layer notifier, so the flag makes the
  // nested call a no-op instead of recursing.
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

  // The `/agents` command exists only where a human-command registry is composed.
  ctx.inject(['commands'], (scope) => {
    scope.effect(() => scope.commands.register(agentsCommand(runtime)), 'agent-scope: /agents command')
  })

  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => scope.webServer.register({
      kind: 'prefix',
      path: '/agent-scope',
      handler: async (req, res) => {
        const rejection = rejectionOf(ctx, req)
        if (rejection !== null) {
          sendJson(res, rejection, { ok: false, error: 'refused by the deployment trust fence' })
          return
        }
        const url = new URL(req.url ?? '/', 'http://localhost')
        const route = url.pathname.slice('/agent-scope'.length)
        try {
          if (req.method === 'GET' && route === '/api/state') {
            const counts = runtime.visibleSessionCounts()
            sendJson(res, 200, {
              ok: true,
              storePath: store.path,
              dshHome: dshHome(),
              loadError: store.loadError ?? null,
              agents: store.agents.map(definition => ({
                ...definition,
                toolName: definition.name,
                mounted: runtime.mounts.has(definition.name),
                mountError: runtime.mountErrors.get(definition.name) ?? null,
                sessions: counts.get(definition.name) ?? 0,
                instructionFile: instructionFileOf(definition),
                // Character count of the persona this definition mounts, so a
                // surface can tell instruction injection apart from an
                // instruction file that resolved to nothing.
                personaChars: personaOf(definition).length,
              })),
              liveSessions: runtime.sessionSummaries(),
              workspaces: workspaceList(scope),
              models: await modelCatalog(ctx),
              // Every name a child could be granted, from the host plane and
              // from each live session's preset composition.
              availableTools: runtime.availableToolNames(),
            })
            return
          }
          if (req.method === 'POST' && route.startsWith('/api/agents/')) {
            const action = route.slice('/api/agents/'.length)
            const body = await readJson(req)
            sendJson(res, 200, await mutate(action, body, store, runtime))
            return
          }
          sendJson(res, 404, { ok: false, error: 'not found' })
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    }), 'agent-scope: settings api')
  })
}
