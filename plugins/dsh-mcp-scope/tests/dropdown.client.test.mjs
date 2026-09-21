/**
 * The Settings page's editor, driven in jsdom.
 *
 * Two behaviours this file exists for:
 *
 * 1. The scope selector used to be a native `<select>`, whose popup the
 *    operating system draws from its own palette: in the dark theme the
 *    highlighted row came out as white text on a light row, so the options
 *    could not be read. The page now opens the shared `Menu` primitive, and
 *    nothing here may reintroduce a native select.
 * 2. The create dialog offers a JSON paste beside the form, and the record it
 *    submits has to be exactly what the Host stores — including the fields the
 *    form no longer shows.
 *
 * The page is rendered through the shared jsdom harness in ./harness.mjs, which
 * stubs the `Menu` primitive with its documented props: the real one is a
 * TypeScript package with CSS modules, and what these tests own is how THIS
 * bundle wires it.
 *
 * Run from the repository root:
 *   node --test "plugins/dsh-mcp-scope/tests/*.test.mjs"
 *
 * @module dsh-mcp-scope/tests/dropdown
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadBundle, openEditor } from './harness.mjs'

test('the settings dialog opens its dropdowns instead of native selects', async () => {
  const bundle = loadBundle()
  const page = await openEditor(bundle)

  assert.deepEqual([...new Set(bundle.required)].sort(), [
    '@deepseek-ai/dsh-client-ui-primitives',
    'react',
  ])
  // The toolbar's selector is the pill itself: the menu measures its anchor, so
  // the glyph it used to sit beside now rides inside the trigger.
  assert.ok(page.trigger('作用域').querySelector('svg'), 'the toolbar selector leads with its glyph')
  assert.equal(page.trigger('作用域').textContent, '全局')

  await page.openCreate()

  assert.equal(page.container.querySelectorAll('select').length, 0, 'no native select is rendered')
  assert.ok(page.trigger('作用域'), 'the scope field is a menu trigger')
  assert.ok(page.trigger('类型'), 'the transport field is a menu trigger')
  assert.equal(page.container.querySelector('input[placeholder="/absolute/working/directory"]'), null, 'the working-directory field is gone')

  await page.flush(() => { page.trigger('作用域').click() })
  assert.deepEqual(page.rows().map(row => row.textContent), ['全局', '工作区 · deepseek-harness'])
  assert.equal(page.container.querySelector('[role="menuitem"][data-selected="true"]').textContent, '全局')

  await page.flush(() => { page.rows().find(row => row.textContent.startsWith('工作区')).click() })
  assert.equal(page.trigger('作用域').textContent.includes('工作区 · deepseek-harness'), true)
  assert.equal(page.container.querySelector('[role="menu"]'), null, 'choosing a row closes the list')

  await page.flush(() => { page.trigger('类型').click() })
  assert.deepEqual(page.rows().map(row => row.textContent), ['stdio（本地命令）', 'streamable-http（远程地址）'])
  await page.flush(() => { page.rows().find(row => row.textContent.startsWith('streamable-http')).click() })
  assert.ok(page.container.querySelector('input[placeholder="https://example.com/mcp"]'), 'the transport choice switched the form')

  await page.close()
})

test('editing keeps the stored working directory the form no longer shows', async () => {
  const bundle = loadBundle()
  bundle.state.servers = [{
    serverName: 'mongo',
    transport: 'stdio',
    scope: 'global',
    enabled: true,
    mounted: false,
    mountError: null,
    toolCallTimeoutMs: 30000,
    command: 'npx',
    args: ['-y', 'pkg'],
    cwd: '/srv/mongo',
    envKeys: [],
    commandName: 'mongo',
    commandConflict: false,
    sessions: 0,
    tools: [],
  }]
  const page = await openEditor(bundle)
  await page.flush(() => { page.container.querySelector('[role="button"][title="编辑"]').click() })

  // An edit opens on the form, whose secret fields carry the stored keys the
  // Host withholds; the paste tab is offered beside it.
  assert.ok(page.byText('JSON') !== undefined, 'edit mode offers the paste toggle')
  assert.equal(page.container.querySelector('input[placeholder="/absolute/working/directory"]'), null)
  assert.equal(page.container.querySelector('input[placeholder="my-mcp-server"]').value, 'mongo')

  await page.flush(() => { page.byText('保存').click() })
  assert.deepEqual(bundle.posts.at(-1), {
    serverName: 'mongo',
    server: {
      serverName: 'mongo',
      scope: 'global',
      transport: 'stdio',
      toolCallTimeoutMs: 30000,
      enabled: true,
      // The row above carries no `readOnly`, so the form opens on the Host's
      // default and submits it back unchanged.
      readOnly: true,
      command: 'npx',
      args: ['-y', 'pkg'],
      cwd: '/srv/mongo',
      env: {},
    },
  })

  await page.close()
})

test('the paste reads the name → server map this installation writes', async () => {
  const bundle = loadBundle()
  const page = await openEditor(bundle)
  await page.openCreate()
  const feedback = () => page.container.querySelector('[role="status"]')?.textContent ?? ''
  await page.flush(() => { page.byText('JSON').click() })

  // A Windows shim path and a single argument, the shape the MCP servers on
  // this machine are configured in.
  await page.paste(JSON.stringify({
    redis_9_dev_7: {
      type: 'stdio',
      command: 'C:\\Program Files\\nodejs\\redis.cmd',
      args: ['redis://localhost:6379/7'],
    },
  }))
  assert.equal(feedback(), '解析成功 · redis_9_dev_7 · C:\\Program Files\\nodejs\\redis.cmd')

  // One server object on its own still names itself.
  await page.paste(JSON.stringify({ name: 'solo', type: 'stdio', command: 'npx' }))
  assert.equal(feedback(), '解析成功 · solo · npx')

  // A port written as a number reaches the Host as the string it requires.
  await page.paste(JSON.stringify({ num: { type: 'stdio', command: 'npx', env: { PORT: 8080 } } }))
  await page.flush(() => { page.byText('保存').click() })
  assert.deepEqual(bundle.posts.at(-1).server.env, { PORT: '8080' })

  await page.close()
})

test('a server created under a scope filter starts in that scope', async () => {
  const bundle = loadBundle()
  const page = await openEditor(bundle)

  // Filter the list to the workspace, then open the create dialog.
  await page.flush(() => { page.trigger('作用域').click() })
  await page.flush(() => { page.rows().find(row => row.textContent.startsWith('工作区')).click() })
  await page.openCreate()

  assert.equal(page.trigger('作用域').textContent.includes('工作区 · deepseek-harness'), true)
  await page.flush(() => { page.byText('保存').click() })
  assert.equal(bundle.posts.at(-1).server.scope, 'D:/ws')

  await page.close()
})

test('the edit dialog rewrites a server from JSON without dropping stored credentials', async () => {
  const bundle = loadBundle()
  bundle.state.servers = [{
    serverName: 'mongo',
    transport: 'stdio',
    scope: 'global',
    enabled: true,
    mounted: false,
    mountError: null,
    toolCallTimeoutMs: 30000,
    command: 'npx',
    args: ['-y', 'pkg'],
    cwd: '/srv/mongo',
    envKeys: ['TOKEN'],
    commandName: 'mongo',
    commandConflict: false,
    sessions: 0,
    tools: [],
  }]
  const page = await openEditor(bundle)
  await page.flush(() => { page.container.querySelector('[role="button"][title="编辑"]').click() })

  const feedback = () => page.container.querySelector('[role="status"]')?.textContent ?? ''
  assert.ok(page.byText('JSON'), 'edit mode offers the paste toggle')
  await page.flush(() => { page.byText('JSON').click() })

  // The tab starts from the stored record, with credential keys blank because
  // the Host never sends their values to the page.
  assert.deepEqual(JSON.parse(page.container.querySelector('textarea').value), {
    mongo: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'pkg'],
      cwd: '/srv/mongo',
      env: { TOKEN: '' },
    },
  })

  // A paste that renames the server cannot be applied to this one.
  await page.paste(JSON.stringify({ other: { type: 'stdio', command: 'bunx' } }))
  assert.ok(feedback().includes('名称不可更改'))
  assert.equal(page.byText('保存').disabled, true)

  // The paste drops both the credential key and the working directory.
  await page.paste(JSON.stringify({ mongo: { type: 'stdio', command: 'bunx', args: ['-y', 'pkg'] } }))
  assert.equal(feedback().startsWith('解析成功 · mongo · bunx'), true)
  await page.flush(() => { page.byText('保存').click() })
  assert.deepEqual(bundle.posts.at(-1), {
    serverName: 'mongo',
    server: {
      serverName: 'mongo',
      transport: 'stdio',
      toolCallTimeoutMs: 30000,
      enabled: true,
      command: 'bunx',
      args: ['-y', 'pkg'],
      env: { TOKEN: '' },
      cwd: '/srv/mongo',
      scope: 'global',
    },
  })

  await page.close()
})

test('the create form adds a server from a pasted JSON configuration', async () => {
  const bundle = loadBundle()
  const page = await openEditor(bundle)
  await page.openCreate()
  const feedback = () => page.container.querySelector('[role="status"]')?.textContent ?? ''
  const save = () => page.byText('保存')

  await page.flush(() => { page.byText('JSON').click() })
  assert.ok(page.container.querySelector('textarea'), 'JSON mode renders its textarea')
  assert.equal(page.container.querySelector('input[placeholder="my-mcp-server"]'), null, 'JSON mode hides the form fields')
  assert.equal(save().disabled, true, 'an empty paste cannot be saved')

  await page.paste('{"command": "npx"}')
  assert.ok(feedback().includes('缺少服务器名称'), 'a nameless paste is named as such')
  assert.equal(save().disabled, true, 'an unreadable paste blocks saving')

  await page.paste('{"a": {"type": "stdio", "command": "npx"}, "b": {"type": "stdio", "command": "npx"}}')
  assert.ok(feedback().includes('一次只能添加一个'))

  await page.paste('{"a": {"type": "sse", "url": "https://example.com/sse"}}')
  assert.ok(feedback().includes('不支持的类型'))

  // The shape this installation's other MCP clients write: a bare map of name
  // to server, with `type` rather than `transport`.
  await page.paste('{"memory": {"type": "stdio", "command": "npx", "args": ["-y", "pkg"], "env": {"MEMORY_FILE_PATH": "/tmp/m.json"}, "cwd": "/tmp", "scope": "D:/ws"}}')
  assert.equal(feedback().startsWith('解析成功 · memory · npx'), true, 'a well-formed paste reports what it read')
  assert.equal(page.trigger('作用域').textContent.includes('工作区 · deepseek-harness'), true, 'the pasted scope seeds the selector')

  await page.flush(() => { save().click() })
  assert.deepEqual(bundle.posts.at(-1), {
    server: {
      serverName: 'memory',
      transport: 'stdio',
      enabled: true,
      toolCallTimeoutMs: 30000,
      command: 'npx',
      args: ['-y', 'pkg'],
      env: { MEMORY_FILE_PATH: '/tmp/m.json' },
      cwd: '/tmp',
      scope: 'D:/ws',
    },
  })
  assert.equal(page.container.querySelector('textarea'), null, 'saving returns to the list')

  await page.flush(() => { page.byText('新建').click() })
  await page.flush(() => { page.byText('JSON').click() })
  // The `mcpServers` wrapper other clients document is still read.
  await page.paste('{"mcpServers": {"a": {"type": "http", "url": "https://example.com/mcp", "headers": {"Authorization": "Bearer x"}}}}')
  assert.equal(feedback().startsWith('解析成功 · a · https://example.com/mcp'), true, 'a wrapped remote server parses')
  await page.flush(() => { save().click() })
  assert.deepEqual(bundle.posts.at(-1).server, {
    serverName: 'a',
    transport: 'streamable-http',
    enabled: true,
    toolCallTimeoutMs: 30000,
    url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer x' },
    scope: 'global',
  })

  await page.close()
})
