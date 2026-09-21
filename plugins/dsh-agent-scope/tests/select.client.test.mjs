/**
 * The sub-agent editor's dropdowns, driven in jsdom.
 *
 * The 作用域 filter and the editor's 作用域 and 模型 fields used to be native
 * `<select>` elements, whose popup the operating system draws from its own
 * palette: in the dark theme the highlighted row came out as white text on a
 * light row, so the options could not be read. They now open the shared `Menu`
 * primitive, and the grouped model list keeps its provider headings through
 * that primitive's label rows — which is the part worth pinning, since nothing
 * else in the page renders one.
 *
 * The primitive is stubbed with its documented props rather than imported: the
 * real one is a TypeScript package with CSS modules, and what this test owns is
 * how THIS bundle wires it.
 *
 * Run from the repository root:
 *   node --test "plugins/dsh-agent-scope/tests/*.test.mjs"
 *
 * @module dsh-agent-scope/tests/select
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

// One document for the whole file: React DOM binds its element constructors to
// the globals present when it first renders, so a second JSDOM instance would
// leave the renderer creating elements the new document cannot query.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
for (const key of ['HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  globalThis[key] = dom.window[key]
}
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** Boot the bundle in the document and return its apply-time captures. */
function loadBundle() {
  const posts = []
  const state = {
    agents: [],
    workspaces: [{ path: 'D:/ws', title: 'deepseek-harness' }],
    availableTools: ['read', 'write'],
    models: {
      providers: [
        { id: 'oc', name: 'OC', models: [{ id: 'glm-5.3', name: 'glm-5.3' }] },
        { id: 'ds', name: 'DeepSeek', models: [{ id: 'deepseek-v4', name: 'deepseek-v4' }] },
      ],
    },
    storePath: 'C:/Users/x/.dsh/agent-scope.json',
  }
  globalThis.fetch = async (_url, init) => {
    if (init?.body !== undefined) posts.push(JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => ({ ok: true, ...state }) }
  }

  // React comes from the renderer the repository's own client tests use, so the
  // hook dispatcher and the renderer are one copy.
  const repoRequire = createRequire(import.meta.url)
  const reactRequire = createRequire(repoRequire.resolve('@testing-library/react'))
  const React = reactRequire('react')
  const { createRoot } = reactRequire('react-dom/client')

  /** The shared primitive, with the props its own contract documents. */
  const Menu = ({ open, anchor, items, selectedId, onSelect }) => React.createElement('span', null,
    anchor,
    open === true
      ? React.createElement('div', { role: 'menu' },
        items.map(entry => entry.type === 'label'
          ? React.createElement('div', { key: entry.id, role: 'presentation' }, entry.text)
          : React.createElement('button', {
            key: entry.id,
            type: 'button',
            role: 'menuitem',
            'data-selected': entry.id === selectedId ? 'true' : undefined,
            onClick: () => { onSelect(entry.id) },
          }, entry.label)))
      : null)
  const IconChevronDownOutline14 = () => React.createElement('svg')
  const IconTrashOutline16 = () => React.createElement('svg')

  let loaded
  dom.window.__ModuleLoader__ = { load: (mod) => { loaded = mod } }
  const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  const run = new Function('window', 'document', source)
  run(dom.window, dom.window.document)
  assert.equal(loaded.id, 'dsh-agent-scope')

  const required = []
  const module = loaded.factory((spec) => {
    required.push(spec)
    if (spec === 'react') return React
    if (spec === '@deepseek-ai/dsh-client-ui-primitives') return { IconChevronDownOutline14, IconTrashOutline16, Menu }
    throw new Error(`unexpected require(${JSON.stringify(spec)})`)
  })

  const dictionaries = {}
  let section
  let registration
  let triggerSource
  const ctx = {
    effect: (fn) => fn(),
    on: () => () => {},
    get: () => undefined,
    inject: (names, register) => {
      if (names.includes('inputTriggers')) {
        register({
          effect: (fn) => fn(),
          inputTriggers: { registerSource: (source) => { triggerSource = source; return () => {} } },
        })
      }
      return () => {}
    },
    locale: {
      register: (namespace, dictionary) => { dictionaries[namespace] = dictionary; return () => {} },
      bind: (namespace) => (key) => dictionaries[namespace]?.zh?.[key] ?? key,
    },
    slots: {
      inject: (_name, register) => { register(); return () => {} },
      register: (spec, Component) => { registration = spec; section = Component; return () => {} },
    },
  }
  module.apply(ctx)
  assert.equal(registration.id, 'agent-scope')

  return {
    React,
    createRoot,
    document: dom.window.document,
    required,
    posts,
    state,
    section,
    triggerSource,
    props: { t: ctx.locale.bind('settings.agentScope'), ...registration.inject() },
  }
}

test('the sub-agent editor opens its dropdowns instead of native selects', async () => {
  const bundle = loadBundle()
  const { React, createRoot, document } = bundle
  const act = React.act ?? (async (fn) => { await fn() })
  const flush = async (work) => { await act(async () => { work(); await new Promise(resolve => { setTimeout(resolve, 0) }) }) }

  assert.deepEqual([...new Set(bundle.required)].sort(), [
    '@deepseek-ai/dsh-client-ui-primitives',
    'react',
  ])

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => { root.render(React.createElement(bundle.section, bundle.props)) })
  await flush(() => {})

  const byText = (text) => [...container.querySelectorAll('button')].find(button => button.textContent === text)
  const trigger = (label) => container.querySelector(`button[aria-haspopup="menu"][aria-label="${label}"]`)
  const rows = () => [...container.querySelectorAll('[role="menuitem"]')]
  const headings = () => [...container.querySelectorAll('[role="presentation"]')].map(node => node.textContent)

  // The toolbar's selector is the pill itself: the menu measures its anchor, so
  // the glyph it used to sit beside now rides inside the trigger.
  assert.ok(trigger('作用域').querySelector('svg'), 'the toolbar selector leads with its glyph')
  assert.equal(trigger('作用域').textContent, '全局')

  assert.ok(byText('新建'), 'the create button renders')
  await flush(() => { byText('新建').click() })

  assert.equal(container.querySelectorAll('select').length, 0, 'no native select is rendered')
  assert.equal(container.querySelectorAll('button[aria-label="作用域"]').length, 1, 'the dialog replaces the page')

  await flush(() => { trigger('作用域').click() })
  assert.deepEqual(rows().map(row => row.textContent), ['全局', '工作区 · deepseek-harness'])
  await flush(() => { rows().find(row => row.textContent.startsWith('工作区')).click() })
  assert.equal(trigger('作用域').textContent.includes('工作区 · deepseek-harness'), true)

  await flush(() => { trigger('模型').click() })
  // The provider names are heading rows, which is what `<optgroup>` used to draw.
  assert.deepEqual(headings(), ['OC', 'DeepSeek'])
  assert.deepEqual(rows().map(row => row.textContent), ['继承默认', 'oc/glm-5.3', 'ds/deepseek-v4'])
  assert.equal(container.querySelector('[role="menuitem"][data-selected="true"]').textContent, '继承默认')

  await flush(() => { rows().find(row => row.textContent === 'ds/deepseek-v4').click() })
  assert.equal(trigger('模型').textContent.includes('ds/deepseek-v4'), true)

  await flush(() => { byText('保存').click() })
  assert.deepEqual(bundle.posts.at(-1), {
    agent: {
      name: '',
      color: '#4f7cf7',
      scope: 'D:/ws',
      description: '',
      systemPrompt: '',
      enabled: true,
      model: { provider: 'ds', model: 'deepseek-v4' },
      tools: { mode: 'all', allow: [] },
    },
  })

  await act(async () => { root.unmount() })
  container.remove()
})

test('delete on a sub-agent row arms before it deletes', async () => {
  const bundle = loadBundle()
  bundle.state.agents = [{
    name: 'code-reviewer',
    color: '#e5484d',
    scope: 'global',
    enabled: true,
    mounted: true,
    sessions: 0,
    description: 'A demanding reviewer.',
    model: null,
    tools: { mode: 'all', allow: [] },
  }]
  const { React, createRoot, document } = bundle
  const act = React.act ?? (async (fn) => { await fn() })
  const flush = async (work) => { await act(async () => { work(); await new Promise(resolve => { setTimeout(resolve, 0) }) }) }

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => { root.render(React.createElement(bundle.section, bundle.props)) })
  await flush(() => {})

  // The row's delete is the shared trash glyph in a button with no box of its
  // own, and it still arms on the first click before it removes anything.
  const remove = () => container.querySelector('button[title="删除"], button[title="确认删除"]')
  assert.ok(remove(), 'the row carries its own delete button')
  assert.ok(remove().querySelector('svg'), 'the button is the glyph, not a labelled box')

  await flush(() => { remove().click() })
  assert.deepEqual(
    bundle.posts.filter(body => body.name === 'code-reviewer'),
    [],
    'the first click arms instead of deleting',
  )
  assert.equal(remove().getAttribute('title'), '确认删除')

  await flush(() => { remove().click() })
  assert.deepEqual(bundle.posts.at(-1), { name: 'code-reviewer' })

  await act(async () => { root.unmount() })
  container.remove()
})

test('a row does not repeat the slash command its name already is', async () => {
  const bundle = loadBundle()
  bundle.state.agents = [{
    name: 'code-reviewer',
    color: '#e5484d',
    scope: 'global',
    enabled: true,
    mounted: true,
    sessions: 0,
    description: 'A demanding reviewer.',
    model: null,
    tools: { mode: 'all', allow: [] },
  }]
  const { React, createRoot, document } = bundle
  const act = React.act ?? (async (fn) => { await fn() })
  const flush = async (work) => { await act(async () => { work(); await new Promise(resolve => { setTimeout(resolve, 0) }) }) }

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => { root.render(React.createElement(bundle.section, bundle.props)) })
  await flush(() => {})

  // The name is the command, and the composer's `/` menu lists it: the row
  // names the definition once, without the `/`.
  assert.ok(container.textContent.includes('code-reviewer'), 'the row names the definition')
  assert.equal(container.textContent.includes('/code-reviewer'), false, 'and does not repeat it as a command')

  await act(async () => { root.unmount() })
  container.remove()
})

test('a definition created under a scope filter starts in that scope', async () => {
  const bundle = loadBundle()
  const { React, createRoot, document } = bundle
  const act = React.act ?? (async (fn) => { await fn() })
  const flush = async (work) => { await act(async () => { work(); await new Promise(resolve => { setTimeout(resolve, 0) }) }) }

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => { root.render(React.createElement(bundle.section, bundle.props)) })
  await flush(() => {})

  const byText = (text) => [...container.querySelectorAll('button')].find(button => button.textContent === text)
  const trigger = (label) => container.querySelector(`button[aria-haspopup="menu"][aria-label="${label}"]`)
  const rows = () => [...container.querySelectorAll('[role="menuitem"]')]

  // Filter the list to the workspace, then open the create dialog.
  await flush(() => { trigger('作用域').click() })
  await flush(() => { rows().find(row => row.textContent.startsWith('工作区')).click() })
  assert.equal(trigger('作用域').textContent.includes('工作区 · deepseek-harness'), true)

  await flush(() => { byText('新建').click() })
  assert.equal(container.querySelectorAll('button[aria-label="作用域"]').length, 1, 'the dialog replaces the page')
  assert.equal(trigger('作用域').textContent.includes('工作区 · deepseek-harness'), true, 'the editor inherits the filter')

  await flush(() => { byText('保存').click() })
  assert.equal(bundle.posts.at(-1).agent.scope, 'D:/ws')

  await act(async () => { root.unmount() })
  container.remove()
})

test('the composer completes a sub-agent name written inside a sentence', async () => {
  const bundle = loadBundle()
  bundle.state.agents = [
    { name: 'code-reviewer', description: 'A demanding reviewer.', enabled: true },
    { name: 'system-architect', description: 'Designs the topology.', enabled: true },
    { name: 'retired', description: '', enabled: false },
  ]
  const source = bundle.triggerSource
  assert.ok(source, 'the plugin registers a `/` source')
  assert.equal(source.trigger, '/')
  // The group title is the shared `slash.menu` dictionary's own key.
  assert.equal(source.name, 'subagent')

  const req = (query, position) => ({ query, position, drilled: false, signal: new AbortController().signal })

  // The head of the draft belongs to the host command source, which runs the
  // definition; this source would only name it, so it stays out of the way.
  assert.deepEqual(await source.candidates({}, req('', 'leading')), [])

  // Opening the menu lists every enabled definition with its description.
  const all = await source.candidates({}, req('', 'inline'))
  assert.deepEqual(all.map(row => row.name), ['code-reviewer', 'system-architect'])
  assert.equal(all[0].description, 'A demanding reviewer.')

  const filtered = await source.candidates({}, req('CODE', 'inline'))
  assert.deepEqual(filtered.map(row => row.name), ['code-reviewer'], 'the query is case-insensitive')
  assert.deepEqual(await source.candidates({}, req('retired', 'inline')), [], 'a disabled definition is not offered')

  // Picking inserts the catalog name as plain text; the rest of the draft is
  // not the source's to touch, so a sentence keeps everything around the name.
  assert.deepEqual(source.onPick({ candidate: { name: 'code-reviewer' } }), { text: '/code-reviewer ' })
})

test('an unreadable definition list leaves the menu empty, not the composer broken', async () => {
  const bundle = loadBundle()
  globalThis.fetch = async () => { throw new Error('offline') }
  const rows = await bundle.triggerSource.candidates({}, {
    query: 'code',
    position: 'inline',
    drilled: false,
    signal: new AbortController().signal,
  })
  assert.deepEqual(rows, [])
})
