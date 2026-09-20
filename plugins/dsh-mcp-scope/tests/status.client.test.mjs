/**
 * What the page claims about a server's connection, driven in jsdom.
 *
 * The claim this file pins: a mount is reported as connected only on evidence
 * of a finished MCP handshake — the tools the official client registered, or a
 * handshake taken for the page itself. The official client connects after
 * `ctx.plugin` returns and writes a failure to the Host log alone, so a mounted
 * server that answers nothing used to read as connected with zero tools while
 * the probe called it unreachable.
 *
 * It also pins when that handshake is taken: once, for the silent mounts, when
 * the MCP section is rendered — the Settings shell mounts only its active
 * section, so that is the person opening this page — and never again on its own.
 *
 * Run from the repository root:
 *   node --test "plugins/dsh-mcp-scope/tests/*.test.mjs"
 *
 * @module dsh-mcp-scope/tests/status
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadBundle, openPage } from './harness.mjs'

/**
 * One row of the Host's `/state` answer.
 * @param overrides - the fields this row changes.
 * @returns the row.
 */
function serverRow(overrides) {
  return {
    serverName: 'row',
    transport: 'stdio',
    scope: 'global',
    enabled: true,
    mounted: true,
    mountError: null,
    toolCallTimeoutMs: 30000,
    command: 'npx',
    args: [],
    cwd: '',
    envKeys: [],
    commandName: null,
    commandConflict: false,
    sessions: 0,
    tools: [],
    health: null,
    ...overrides,
  }
}

test('a mount is called connected only on evidence of a handshake', async () => {
  const bundle = loadBundle()
  bundle.state.servers = [
    // Tools arrived: the official client completed a handshake and synced.
    serverRow({ serverName: 'live', tools: ['mcp__live__find'] }),
    // Mounted a moment ago and nothing back yet: not connected, not failed.
    serverRow({ serverName: 'pending' }),
    // The page's own check failed for this mount.
    serverRow({
      serverName: 'dead',
      health: { reachable: false, detail: 'process exited before initialize response (code 1)' },
    }),
    // A server with no tools of its own, whose handshake the check watched complete.
    serverRow({ serverName: 'healed', health: { reachable: true, detail: 'MCP initialize ok' } }),
    // `ctx.plugin` itself never applied.
    serverRow({ serverName: 'unmounted', mounted: false }),
    serverRow({ serverName: 'off', enabled: false, mounted: false }),
  ]
  const page = await openPage(bundle)
  const text = (name) => page.card(name).textContent

  assert.ok(text('live').includes('● 已连接'), 'registered tools are proof of a handshake')
  assert.ok(text('pending').includes('◐ 连接中…'), 'a silent mount is not called connected')
  assert.ok(text('healed').includes('● 已连接'), 'a watched handshake counts even with no tools')
  assert.ok(text('unmounted').includes('○ 装载失败'))
  assert.ok(text('off').includes('○ 已停用'))

  assert.ok(text('dead').includes('○ 不可达'), 'a failed handshake is never reported as connected')
  assert.ok(text('dead').includes('不可达 (页面检查)'), 'the reading names where it came from')
  assert.ok(
    text('dead').includes('process exited before initialize response (code 1)'),
    'the reading carries the Host-observed reason',
  )
  assert.equal(text('pending').includes('页面检查'), false, 'a row with no reading claims nothing')

  await page.close()
})

test('a probe asked for by hand replaces the reading the page took', async () => {
  const bundle = loadBundle()
  bundle.state.servers = [
    serverRow({
      serverName: 'dead',
      health: { reachable: false, detail: 'spawn ENOENT' },
    }),
  ]
  const page = await openPage(bundle)
  assert.ok(page.card('dead').textContent.includes('不可达 (页面检查) — spawn ENOENT'))

  // The person probes once the server has been fixed: this handshake is newer
  // and is the one they asked for, so it supersedes the page's own reading.
  bundle.state.probe = { reachable: true, detail: 'MCP initialize ok', elapsedMs: 12 }
  await page.flush(() => { page.byText('探测').click() })

  const text = page.card('dead').textContent
  assert.ok(text.includes('可达 — MCP initialize ok'), 'the manual reading is shown as its own result')
  assert.equal(text.includes('页面检查'), false, 'the superseded reading is gone')
  assert.ok(text.includes('● 已连接'), 'a completed handshake is connection evidence')

  await page.close()
})

test('the MCP page reads the silent mounts once, when it is opened, and never again', async () => {
  const bundle = loadBundle()
  bundle.state.servers = [
    // Already answered: its tools are the reading.
    serverRow({ serverName: 'live', tools: ['mcp__live__find'] }),
    // The two the page has to ask about.
    serverRow({ serverName: 'pending' }),
    serverRow({ serverName: 'other' }),
    // Already read, and out of the mount set: neither is asked again.
    serverRow({ serverName: 'read', health: { reachable: false, detail: 'spawn ENOENT' } }),
    serverRow({ serverName: 'unmounted', mounted: false }),
    serverRow({ serverName: 'off', enabled: false, mounted: false }),
  ]
  const page = await openPage(bundle)
  await page.flush(() => {})
  assert.deepEqual(
    bundle.posts.filter(body => body.serverNames !== undefined),
    [{ serverNames: ['pending', 'other'] }],
    'the page asks about the silent mounts alone',
  )

  // Nothing re-asks behind the person's back: a row is read when the page is
  // opened or when they probe it, and at no other time.
  const settled = [...bundle.calls]
  await page.act(async () => { await new Promise(resolve => { setTimeout(resolve, 3300) }) })
  assert.deepEqual(bundle.calls, settled, 'no request is issued on its own')

  await page.close()
})
