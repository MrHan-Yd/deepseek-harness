/**
 * The `/` source that completes an MCP server name written inside a draft.
 *
 * The host command source owns a leading `/`: picking there starts the server's
 * delegated child, so it claims the composer for the task and withholds every
 * argument-taking command once the caret leaves the head of the draft. A server
 * name is also the model-facing tool namespace, so a `/name` inside a sentence
 * is text the model reads. This source supplies the names inline and settles a
 * pick by inserting the name as plain text.
 *
 * Run from the repository root:
 *   node plugins/dsh-mcp-scope/tests/mention.client.test.mjs
 *
 * @module dsh-mcp-scope/tests/mention
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadBundle, serverRow } from './harness.mjs'

/** One candidate request, with the position the pipeline derives from the draft. */
function req(query, position) {
  return { query, position, drilled: false, signal: new AbortController().signal }
}

test('the composer completes a server name written inside a sentence', async () => {
  const bundle = loadBundle()
  bundle.state.servers = [
    serverRow({ serverName: 'pgsql_9_warehouse_pro', commandName: 'pgsql_9_warehouse_pro', command: 'npx', args: ['pg-mcp'] }),
    serverRow({ serverName: 'mogo_9', commandName: 'mogo_9', transport: 'http', url: 'http://127.0.0.1:9000/mcp' }),
  ]
  const source = bundle.triggerSource
  assert.ok(source, 'the plugin registers a `/` source')
  assert.equal(source.trigger, '/')
  assert.equal(source.name, 'mcp')

  // The roll the draft decorates from is synchronous and fetches nothing: before
  // the list is read there is nothing to decorate, and a token stays plain text.
  assert.equal(source.lexicon(), undefined, 'an unread roll decorates nothing')
  const settled = []
  const stopWatching = source.subscribeLexicon({}, () => settled.push(source.lexicon()))

  // The head of the draft belongs to the host command source, which runs the
  // server; this source would only name it, so it stays out of the way.
  assert.deepEqual(await source.candidates({}, req('', 'leading')), [])

  const all = await source.candidates({}, req('', 'inline'))
  assert.deepEqual(all.map(row => row.name), ['pgsql_9_warehouse_pro', 'mogo_9'])
  assert.equal(all[0].description, 'npx pg-mcp', 'a stdio row reads its command')
  assert.equal(all[1].description, 'http://127.0.0.1:9000/mcp', 'an http row reads its url')

  // The same names decorate `/name` tokens typed in the draft, and the settle
  // has to reach the editor rather than wait for the next keystroke.
  assert.deepEqual(source.lexicon(), ['pgsql_9_warehouse_pro', 'mogo_9'], 'the settled roll names them')
  assert.deepEqual(settled, [['pgsql_9_warehouse_pro', 'mogo_9']], 'and reaches the render side')
  stopWatching()

  assert.deepEqual(
    (await source.candidates({}, req('WAREHOUSE', 'inline'))).map(row => row.name),
    ['pgsql_9_warehouse_pro'],
    'the query is case-insensitive',
  )

  // Picking lands an atomic chip: the composer shows the bare name, while the
  // clipboard projection and the model serialization stay the `/name` text the
  // plain insertion wrote. The rest of the draft is not the source's to touch,
  // so a sentence keeps everything around the name.
  assert.deepEqual(source.onPick({ candidate: { name: 'mogo_9' } }), {
    insert: { source: 'mcp', ref: 'mogo_9', label: 'mogo_9', clipboardText: '/mogo_9' },
  })
  assert.equal(source.codec.clipboardText('mogo_9'), '/mogo_9')
  assert.equal(await source.codec.serialize('mogo_9'), '/mogo_9')
})

test('a server that registers no command is never named', async () => {
  const bundle = loadBundle()
  bundle.state.servers = [
    // Uppercase: the command registry accepts lowercase only.
    serverRow({ serverName: 'Warehouse', commandName: null }),
    // Shadowed by a command another registration already owns.
    serverRow({ serverName: 'taken', commandName: 'taken', commandConflict: true }),
    // Disabled.
    serverRow({ serverName: 'off', commandName: 'off', enabled: false }),
    serverRow({ serverName: 'kept', commandName: 'kept' }),
  ]
  const rows = await bundle.triggerSource.candidates({}, req('', 'inline'))
  assert.deepEqual(rows.map(row => row.name), ['kept'])
})

test('an unreadable server list leaves the menu empty, not the composer broken', async () => {
  const bundle = loadBundle()
  globalThis.fetch = async () => { throw new Error('offline') }
  assert.deepEqual(await bundle.triggerSource.candidates({}, req('mogo', 'inline')), [])
})
