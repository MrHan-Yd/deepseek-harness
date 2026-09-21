/**
 * The jsdom harness the dsh-mcp-scope client tests drive the Settings page
 * through.
 *
 * The `Menu` primitive is stubbed with its documented props rather than
 * imported: the real one is a TypeScript package with CSS modules built for the
 * Web shell, and what these tests own is how THIS bundle wires it. React comes
 * from the copy the repository's own client tests use, so the hook dispatcher
 * and the renderer are one copy.
 *
 * One document serves a file: React DOM binds its element constructors to the
 * globals present when it first renders, so a second JSDOM instance would leave
 * the renderer creating elements the new document cannot query. `node --test`
 * gives every test file its own process, so the module-scope document is never
 * shared between files.
 *
 * Run from the repository root:
 *   node --test "plugins/dsh-mcp-scope/tests/*.test.mjs"
 *
 * @module dsh-mcp-scope/tests/harness
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
for (const key of ['HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  globalThis[key] = dom.window[key]
}
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/**
 * Boot the bundle in the document and return its apply-time captures.
 *
 * The returned `state` is what every stubbed response is built from, so a test
 * shapes the Host's answer by writing to it before rendering (or between
 * renders). `state.probe` answers the probe route alone. `posts` keeps every
 * request body and `calls` every request URL, in order, which is how a test
 * shows what the page asked for and what it did not.
 *
 * @returns the harness handles: the renderer, the stubbed responses, and the
 *   captured Settings section with its bound dictionary.
 */
export function loadBundle() {
  const posts = []
  const calls = []
  const repoRequire = createRequire(import.meta.url)
  const reactRequire = createRequire(repoRequire.resolve('@testing-library/react'))
  const React = reactRequire('react')
  const { createRoot } = reactRequire('react-dom/client')

  /** The shared primitive, with the props its own contract documents. */
  const Menu = ({ open, anchor, items, selectedId, onSelect }) => React.createElement('span', null,
    anchor,
    open === true
      ? React.createElement('div', { role: 'menu' },
        items.map((item) => {
          // The three entry kinds the primitive distinguishes: a row, a
          // hairline, and a heading. Rendering them all as rows would let a
          // separator read as a menu item in the callers' assertions.
          if (item.type === 'separator') return React.createElement('div', { key: item.id, role: 'separator' })
          if (item.type === 'label') return React.createElement('div', { key: item.id, role: 'presentation' }, item.text)
          return React.createElement('button', {
            key: item.id,
            type: 'button',
            role: 'menuitem',
            disabled: item.disabled === true,
            'data-selected': item.id === selectedId ? 'true' : undefined,
            // The real primitive portals the list out of the row, so a chosen
            // row never reaches the row's own click handler. This stub keeps
            // the list inline, and swallows the click instead.
            onClick: (event) => { event.stopPropagation(); onSelect(item.id) },
          }, item.label)
        }))
      : null)
  const IconChevronDownOutline14 = () => React.createElement('svg')
  const IconTrashOutline16 = () => React.createElement('svg')

  const state = {
    servers: [],
    workspaces: [{ path: 'D:/ws', title: 'deepseek-harness' }],
    probe: {},
  }
  globalThis.fetch = async (url, init) => {
    calls.push(String(url))
    if (init?.body !== undefined) posts.push(JSON.parse(init.body))
    const answer = String(url).endsWith('/servers/probe') ? { ...state.probe } : state
    return { ok: true, status: 200, json: async () => ({ ok: true, ...answer }) }
  }

  let loaded
  dom.window.__ModuleLoader__ = { load: (mod) => { loaded = mod } }
  const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  const run = new Function('window', 'document', source)
  run(dom.window, dom.window.document)
  assert.equal(loaded.id, 'dsh-mcp-scope')

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
  assert.equal(registration.id, 'mcp-scope')

  return {
    React,
    createRoot,
    document: dom.window.document,
    window: dom.window,
    required,
    posts,
    calls,
    state,
    section,
    triggerSource,
    props: { t: ctx.locale.bind('settings.mcpScope'), ...registration.inject() },
  }
}

/**
 * One row of the Host's `/state` answer, with every field the page reads.
 *
 * `health` is the handshake reading the Host stores; `null` is "never read",
 * which is not the same as "read and failed".
 *
 * @param overrides - the fields this row changes.
 * @returns the row.
 */
export function serverRow(overrides) {
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
    withheld: [],
    readOnly: true,
    health: null,
    ...overrides,
  }
}

/**
 * Render the Settings page into its own container.
 * @param bundle - the handles {@link loadBundle} returned.
 * @returns the page handles: the queries its assertions read it through, plus teardown.
 */
export async function openPage(bundle) {
  const { React, createRoot, document } = bundle
  const container = document.createElement('div')
  document.body.append(container)
  const act = React.act ?? (async (fn) => { await fn() })
  const flush = async (work) => { await act(async () => { work(); await new Promise(resolve => { setTimeout(resolve, 0) }) }) }

  const root = createRoot(container)
  await act(async () => { root.render(React.createElement(bundle.section, bundle.props)) })
  await flush(() => {})

  const card = (serverName) => [...container.querySelectorAll('[role="button"][title="编辑"]')]
    .find(head => head.textContent.startsWith(serverName))
    // The header is the clickable part; the status dot, the readings, and the
    // trial panel are its siblings inside the card.
    ?.parentElement

  return {
    container,
    act,
    flush,
    byText: (text) => [...container.querySelectorAll('button')].find(button => button.textContent === text),
    trigger: (label) => container.querySelector(`button[aria-haspopup="menu"][aria-label="${label}"]`),
    rows: () => [...container.querySelectorAll('[role="menuitem"]')],
    /** One installed server's whole card, found by the name it leads with. */
    card,
    /**
     * The connection state a card's dot carries: its color is the state, and
     * this accessible name is what that color stands for.
     * @param serverName - the server whose card to read.
     * @returns the dot's accessible name, or null when the card has no dot.
     */
    status: (serverName) => card(serverName)?.querySelector('[role="img"]')?.getAttribute('aria-label') ?? null,
    close: async () => { await act(async () => { root.unmount() }); container.remove() },
  }
}

/**
 * Render the page and open the create dialog.
 * @param bundle - the handles {@link loadBundle} returned.
 * @returns the page handles plus the editor's own interactions.
 */
export async function openEditor(bundle) {
  const page = await openPage(bundle)
  return {
    ...page,
    /** Open the create dialog; every editor test but the edit one starts here. */
    openCreate: async () => {
      assert.ok(page.byText('新建'), 'the create button renders')
      await page.flush(() => { page.byText('新建').click() })
    },
    /** Replace the JSON textarea's contents the way typing does. */
    paste: async (text) => {
      await page.flush(() => {
        const area = page.container.querySelector('textarea')
        const setter = Object.getOwnPropertyDescriptor(bundle.window.HTMLTextAreaElement.prototype, 'value').set
        setter.call(area, text)
        area.dispatchEvent(new bundle.window.Event('input', { bubbles: true }))
      })
    },
  }
}
