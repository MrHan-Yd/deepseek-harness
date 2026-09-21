/**
 * The read-only policy as the runtime applies it.
 *
 * The unit suite proves the classifier; this one proves the wiring a session
 * actually feels: which names reach an agent's `tools.restrict({ deny })` mask,
 * that a server mounted outside this store is held to the same policy, that an
 * explicit `readOnly: false` is the only thing that lifts it, and that the page
 * can see what was withheld.
 *
 * The plugin is booted against a real store file on disk with a stubbed Cordis
 * context, because the enforcement point is the mask the plugin installs on
 * each agent — not a value any single function returns.
 *
 * Run from the repository root:
 *   node --test plugins/dsh-mcp-scope/tests/policy.host.test.mjs
 *
 * @module dsh-mcp-scope/tests/policy
 */

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

/**
 * The two workspace packages the host half imports, replaced by stubs.
 *
 * `apply()` mounts each server through `@deepseek-ai/dsh-mcp-client` and
 * registers its probe tool through `@deepseek-ai/dsh-tools`; both are
 * TypeScript workspaces the Loader resolves for the running Host and plain
 * `node` cannot. Stubbing them is what lets this suite drive the real
 * `apply()`, whose mask installation is the behavior under test.
 */
const WORKSPACE_STUBS = new Map([
  ['@deepseek-ai/dsh-mcp-client', 'export async function apply() {}\n'],
  ['@deepseek-ai/dsh-tools', 'export function defineTool(definition) { return definition }\n'],
  ['@deepseek-ai/dsh-subprocess', 'export function scrubbedParentEnv() { return {} }\n'],
])

registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = WORKSPACE_STUBS.get(specifier)
    if (stub !== undefined) return { url: `dsh-stub:${specifier}`, shortCircuit: true }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    const specifier = url.startsWith('dsh-stub:') ? url.slice('dsh-stub:'.length) : undefined
    const stub = specifier === undefined ? undefined : WORKSPACE_STUBS.get(specifier)
    if (stub !== undefined) return { format: 'module', source: stub, shortCircuit: true }
    return nextLoad(url, context)
  },
})

const { apply } = await import('../src/index.js')

/** The store row every case starts from. */
function stdioServer(overrides) {
  return {
    serverName: overrides.serverName,
    transport: 'stdio',
    scope: 'global',
    enabled: true,
    toolCallTimeoutMs: 30000,
    command: 'node',
    args: [],
    env: {},
    cwd: '',
    ...overrides,
  }
}

/**
 * Boot the plugin over a store written to a temporary file.
 *
 * @param servers - the stored server records.
 * @returns handles for registering tools, driving lifecycle events, and reading
 *   the two answers a person sees: the agent masks and the `/api/state` body.
 */
async function boot(servers) {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-scope-policy-'))
  const storePath = join(dir, 'mcp-scope.json')
  writeFileSync(storePath, JSON.stringify({ version: 1, servers }, null, 2))

  const registered = []
  const handlers = new Map()
  let stateHandler
  const tools = {
    schemas: () => registered.map(name => ({ name })),
    register: () => () => {},
    restrict: () => () => {},
    execute: async () => ({}),
  }
  const ctx = {
    tools,
    logger: { warn: () => {} },
    effect: () => () => {},
    on: (event, handler) => { handlers.set(event, handler); return () => {} },
    plugin: () => ({ dispose: () => {} }),
    get: (name) => {
      if (name === 'connection') return { requestRejection: () => undefined }
      if (name === 'agents') return { list: () => [] }
      return undefined
    },
    inject: (names, register) => {
      if (names.includes('webServer')) {
        register({
          effect: fn => fn(),
          webServer: {
            register: (spec) => { stateHandler = spec.handler; return () => {} },
          },
        })
      }
      return () => {}
    },
  }
  await apply(ctx, { storePath })

  return {
    /** Register tool names, as an MCP server's handshake would. */
    register: (...names) => {
      registered.push(...names)
      handlers.get('tools/change')?.()
    },
    /** Adopt one agent, returning its recorded deny masks. */
    agent: (cwd = 'D:\\ws') => {
      const masks = []
      const agent = {
        id: 'agent-1',
        session: { header: { cwd } },
        ctx: {
          tools: { restrict: (filter) => { masks.push(filter.deny ?? []); return () => {} } },
          inject: () => () => {},
        },
      }
      handlers.get('agent/created')?.({ agent })
      return masks
    },
    /** Read `/api/state` through the registered route. */
    state: async () => {
      let body
      await stateHandler(
        { method: 'GET', url: '/mcp-scope/api/state', headers: { 'x-dsh-mcp-scope': '1' } },
        { writeHead: () => {}, end: (payload) => { body = JSON.parse(payload) } },
      )
      return body
    },
  }
}

describe('the read-only mask', () => {
  it('denies a server’s write tools while leaving its reads in place', async () => {
    const booted = await boot([stdioServer({ serverName: 'demo' })])
    booted.register(
      'mcp__demo__find',
      'mcp__demo__aggregate',
      'mcp__demo__collection-schema',
      'mcp__demo__insert-many',
      'mcp__demo__delete-many',
      'mcp__demo__drop-collection',
      'mcp__demo__set',
    )
    const masks = booted.agent()
    const deny = masks.at(-1)
    assert.deepEqual([...deny].sort(), [
      'mcp__demo__delete-many',
      'mcp__demo__drop-collection',
      'mcp__demo__insert-many',
      'mcp__demo__set',
    ])
  })

  it('holds a server mounted outside this store to the same policy', async () => {
    // No store record means no waiver: the composition's own MCP rows are
    // exactly the servers this plugin cannot scope, so the policy is what
    // covers them.
    const booted = await boot([])
    booted.register('mcp__foreign__read_file', 'mcp__foreign__write_file', 'mcp__foreign__health')
    const deny = booted.agent().at(-1)
    assert.deepEqual([...deny].sort(), ['mcp__foreign__health', 'mcp__foreign__write_file'])
  })

  it('lifts the policy only for a record that explicitly waives it', async () => {
    const booted = await boot([
      stdioServer({ serverName: 'closed' }),
      stdioServer({ serverName: 'open', readOnly: false }),
    ])
    booted.register(
      'mcp__closed__insert-many',
      'mcp__open__insert-many',
      'mcp__open__drop-database',
    )
    const deny = booted.agent().at(-1)
    assert.deepEqual(deny, ['mcp__closed__insert-many'])
  })

  it('never touches a tool outside the mcp namespace', async () => {
    const booted = await boot([])
    booted.register('bash', 'write', 'mcp_probe', 'mcp__demo__drop-database')
    const deny = booted.agent().at(-1)
    assert.deepEqual(deny, ['mcp__demo__drop-database'])
  })

  it('re-masks when a server’s tools arrive after the agent exists', async () => {
    // A server connects long after `agent/created`, so the mask an agent holds
    // at birth knows nothing about it; without the `tools/change` sweep the
    // write tools would appear unmasked for that session's whole life.
    const booted = await boot([stdioServer({ serverName: 'demo' })])
    const masks = booted.agent()
    // Nothing to deny yet, so the agent is left unmasked rather than handed an
    // empty restriction.
    assert.deepEqual(masks, [])
    booted.register('mcp__demo__find', 'mcp__demo__update-many')
    assert.deepEqual(masks.at(-1), ['mcp__demo__update-many'])
  })

  it('reports what it withheld, and the record’s policy, to the page', async () => {
    const booted = await boot([
      stdioServer({ serverName: 'demo' }),
      stdioServer({ serverName: 'open', readOnly: false }),
    ])
    booted.register('mcp__demo__find', 'mcp__demo__delete-many', 'mcp__open__delete-many')
    const state = await booted.state()
    const demo = state.servers.find(server => server.serverName === 'demo')
    const open = state.servers.find(server => server.serverName === 'open')
    assert.equal(demo.readOnly, true)
    assert.deepEqual(demo.tools, ['mcp__demo__find'])
    assert.deepEqual(demo.withheld, ['mcp__demo__delete-many'])
    assert.equal(open.readOnly, false)
    assert.deepEqual(open.tools, ['mcp__open__delete-many'])
    assert.deepEqual(open.withheld, [])
  })
})
