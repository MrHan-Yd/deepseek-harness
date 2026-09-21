/**
 * The read-only policy as the Settings page shows it, driven in jsdom.
 *
 * The page carries two facts the Host's mask cannot: which policy a server is
 * under, and which of its tools the policy took away. Both matter because a
 * withheld tool is invisible rather than refused — without them a server whose
 * every tool was withheld reads exactly like one that never answered, and a
 * server someone deliberately opened to writes reads exactly like a safe one.
 *
 * Run from the repository root:
 *   node --test "plugins/dsh-mcp-scope/tests/*.test.mjs"
 *
 * @module dsh-mcp-scope/tests/readonly-client
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadBundle, openEditor, openPage, serverRow } from './harness.mjs'

test('a row names the policy its server is under', async () => {
  const bundle = loadBundle()
  bundle.state.servers = [
    serverRow({ serverName: 'mongo' }),
    serverRow({ serverName: 'open', readOnly: false }),
  ]
  const page = await openPage(bundle)

  assert.ok(page.card('mongo').textContent.includes('只读'), 'the default reads as read-only')
  const waived = page.card('open').textContent
  assert.ok(waived.includes('可写'), 'a waived record says so')
  assert.equal(waived.includes('只读'), false, 'and is not also called read-only')

  await page.close()
})

test('withheld tools are reported, and a fully withheld server is still connected', async () => {
  const bundle = loadBundle()
  bundle.state.servers = [serverRow({
    serverName: 'mongo',
    // Every tool this server publishes was withheld, so `tools` is empty while
    // the handshake plainly succeeded.
    tools: [],
    withheld: ['mcp__mongo__delete-many', 'mcp__mongo__drop-database'],
  })]
  const page = await openPage(bundle)
  const card = page.card('mongo')

  assert.equal(page.status('mongo'), '已连接', 'a withheld tool set is not a failed handshake')
  assert.ok(card.textContent.includes('已拦截 2 个非只读工具'), 'the count is on the row')
  const note = [...card.querySelectorAll('div')].find(node => node.textContent.startsWith('已拦截'))
  assert.ok(note.getAttribute('title').includes('mcp__mongo__drop-database'), 'the names are in the tooltip')

  await page.close()
})

test('the editor opens the policy on the stored value and submits it back', async () => {
  const bundle = loadBundle()
  bundle.state.servers = [serverRow({ serverName: 'open', readOnly: false })]
  const page = await openEditor(bundle)
  await page.flush(() => { page.container.querySelector('[role="button"][title="编辑"]').click() })

  const box = page.container.querySelector('input[type="checkbox"]')
  assert.equal(box.checked, false, 'an edit opens on the stored record, not on the default')
  await page.flush(() => { box.click() })
  assert.equal(box.checked, true)

  await page.flush(() => { page.byText('保存').click() })
  assert.equal(bundle.posts.at(-1).server.readOnly, true, 'closing the policy is what the save carries')

  await page.close()
})
