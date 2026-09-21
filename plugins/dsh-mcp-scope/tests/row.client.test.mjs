/**
 * What an installed server's row shows, driven in jsdom.
 *
 * Two rules this file exists for. The row's own line carries the facts about
 * the server — name, transport, scope, connection — and not the ones the person
 * reads elsewhere: the slash command it answers to and how many tools it
 * registered are both second-order, and the tool count is what the connection
 * dot already answers. The row's actions are the ones it needs: probe, the
 * enable switch, and delete, which still asks once before it acts.
 *
 * Run from the repository root:
 *   node --test "plugins/dsh-mcp-scope/tests/*.test.mjs"
 *
 * @module dsh-mcp-scope/tests/row
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadBundle, openPage, serverRow } from './harness.mjs'

test('a row shows the server, not its tool count or its slash command', async () => {
  const bundle = loadBundle()
  bundle.state.servers = [serverRow({ serverName: 'mongo', commandName: 'mongo', tools: ['mcp__mongo__find'] })]
  const page = await openPage(bundle)
  const text = page.card('mongo').textContent

  assert.equal(page.status('mongo'), '已连接', 'the connection is the tile dot, not a chip')
  assert.equal(text.includes('已连接'), false, 'and it carries no text of its own')
  assert.equal(text.includes('个工具'), false, 'the tool count is not repeated on the row')
  assert.equal(text.includes('/mongo'), false, 'the slash command is not repeated on the row')

  await page.close()
})

test('delete sits on the row and arms before it deletes', async () => {
  const bundle = loadBundle()
  bundle.state.servers = [serverRow({ serverName: 'mongo', tools: ['mcp__mongo__find'] })]
  const page = await openPage(bundle)

  // The word the trial console's entry used is gone, and the row offers no
  // overflow trigger to hide it in: delete is the row's own button.
  assert.equal(page.byText('试用'), undefined, 'trial is gone from the row')
  assert.equal(page.container.querySelector('button[aria-label="更多操作"]'), null, 'no overflow trigger')
  const remove = () => page.container.querySelector('button[title="删除"], button[title="确认删除"]')
  assert.ok(remove(), 'delete is its own button on the row')

  await page.flush(() => { remove().click() })
  assert.deepEqual(
    bundle.posts.filter(body => body.serverName === 'mongo'),
    [],
    'the first click arms instead of deleting',
  )
  assert.equal(remove().getAttribute('title'), '确认删除')

  await page.flush(() => { remove().click() })
  assert.deepEqual(bundle.posts.at(-1), { serverName: 'mongo' })

  await page.close()
})

test('a command name that would shadow a live one is still said out loud', async () => {
  const bundle = loadBundle()
  bundle.state.servers = [
    serverRow({ serverName: 'mongo', commandName: 'mongo', commandConflict: true }),
  ]
  const page = await openPage(bundle)

  assert.ok(
    page.card('mongo').textContent.includes('/mongo 命令名冲突'),
    'the shadowed command is reported even though the chip is gone',
  )

  await page.close()
})
