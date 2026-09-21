/**
 * The floating git panel, driven in jsdom.
 *
 * The panel is registered into `shell.overlay`: a frame-level slot that hands it
 * no Session prop, so the Session it follows comes from the slot's `useSessions`
 * seat — the main view retains the Session it shows, and that reference moving
 * is what switching Sessions looks like from here. This file pins that
 * arrangement: the entry renders without any slot data, names the checkout the
 * Host resolved, names the Session on every call, and re-reads when the frame
 * switches Sessions.
 *
 * Run from the repository root:
 *   node --test "plugins/dsh-git-tools/tests/*.test.mjs"
 *
 * @module dsh-git-tools/tests/panel
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' })
for (const key of ['HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  globalThis[key] = dom.window[key]
}
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/**
 * Boot the bundle against a stubbed Host and render the overlay entry.
 * @param state - what `/state` answers for the Session the frame shows.
 * @param options - a first Session id, and per-Session answers for a panel that is switched.
 * @returns the page handles: the container, the recorded requests, and teardown.
 */
async function openPanel(state, options = {}) {
  const calls = []
  const first = options.sessionId ?? 'session-1'
  const listeners = new Set()
  let list = {
    ids: [first],
    byId: { [first]: { id: first, retainedBy: { mainView: 1 } } },
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
  }
  const sessions = {
    getSnapshot: () => list,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    /** Move the main view onto another Session, as picking one in the sidebar does. */
    show: (id) => {
      list = {
        ...list,
        ids: [...new Set([...list.ids, id])],
        byId: Object.fromEntries(Object.entries(list.byId)
          .map(([key, row]) => [key, { ...row, retainedBy: {} }])
          .concat([[id, { id, retainedBy: { mainView: 1 } }]])),
      }
      for (const listener of listeners) listener()
    },
  }

  globalThis.fetch = async (url, init) => {
    const target = String(url)
    calls.push({ url: target, body: init?.body === undefined ? undefined : JSON.parse(init.body) })
    if (target.endsWith('/message')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, message: options.messages ?? 'chore: tidy up' }) }
    }
    const named = /[?&]sessionId=([^&]+)/.exec(target)?.[1]
    return { ok: true, status: 200, json: async () => ({ ok: true, ...(options.states?.[named] ?? state) }) }
  }

  const repoRequire = createRequire(import.meta.url)
  const reactRequire = createRequire(repoRequire.resolve('@testing-library/react'))
  const React = reactRequire('react')
  const { createRoot } = reactRequire('react-dom/client')

  /** The shared primitives this bundle takes from the module table. */
  const Menu = ({ open, anchor, items, selectedId, onSelect }) => React.createElement('span', null,
    anchor,
    open === true
      ? React.createElement('div', { role: 'menu' },
        items.map(item => React.createElement('button', {
          key: item.id, type: 'button', role: 'menuitem',
          'data-selected': item.id === selectedId ? 'true' : undefined,
          onClick: () => { onSelect(item.id) },
        }, item.label)))
      : null)
  const IconChevronDownOutline14 = () => React.createElement('svg')

  /**
   * The store engine this bundle takes from the module table, as a test double:
   * one instance per handle, actions mutating a clone and notifying readers.
   */
  const defineStore = (spec) => ({
    spec,
    create: () => {
      let state = spec.init()
      const listeners = new Set()
      const actions = Object.fromEntries(Object.entries(spec.actions).map(([name, mutate]) => [
        name,
        (...args) => {
          const draft = structuredClone(state)
          mutate(draft, ...args)
          state = draft
          for (const listener of listeners) listener()
        },
      ]))
      return {
        actions,
        getSnapshot: () => state,
        subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      }
    },
  })

  let loaded
  dom.window.__ModuleLoader__ = { load: (mod) => { loaded = mod } }
  const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  new Function('window', 'document', source)(dom.window, dom.window.document)
  assert.equal(loaded.id, 'dsh-git-tools')

  const module = loaded.factory((spec) => {
    if (spec === 'react') return React
    if (spec === '@deepseek-ai/dsh-client-ui-primitives') return { IconChevronDownOutline14, Menu }
    if (spec === '@deepseek-ai/dsh-client-store') return { defineStore }
    throw new Error(`unexpected require(${JSON.stringify(spec)})`)
  })

  const dictionaries = {}
  const registrations = []
  const ctx = {
    effect: (fn) => fn(),
    on: () => () => {},
    get: () => undefined,
    locale: {
      register: (namespace, dictionary) => { dictionaries[namespace] = dictionary; return () => {} },
      bind: (namespace) => (key) => dictionaries[namespace]?.zh?.[key] ?? key,
      // The live locale is the snapshot's `active`, exactly as the real service
      // reports it: a stub carrying an `id` field would let a wrong read pass.
      getLocale: () => ({ active: 'zh', locales: [], revision: 1 }),
    },
    slots: {
      inject: (_name, register) => { register(); return () => {} },
      register: (spec, Component) => { registrations.push({ ...spec, component: Component }); return () => {} },
    },
  }
  module.apply(ctx)
  const registration = registrations.find(row => row.name === 'shell.overlay')
  const settingsRow = registrations.find(row => row.name === 'settings.general.item')
  assert.equal(registration.id, 'git-tools')
  assert.equal(settingsRow.id, 'git-tools-commit-language')
  assert.equal(registration.store, settingsRow.store, 'the row and the panel share one store handle')

  const container = dom.window.document.createElement('div')
  dom.window.document.body.append(container)
  const act = React.act ?? (async (fn) => { await fn() })
  const flush = async (work) => { await act(async () => { work(); await new Promise(resolve => { setTimeout(resolve, 0) }) }) }

  // The renderer caches one instance per handle, so both registrations read the
  // same state; the double has to do the same to prove they are wired together.
  const store = registration.store.create()
  const useStore = (selector) => {
    const [, force] = React.useState(0)
    React.useEffect(() => store.subscribe(() => { force(value => value + 1) }), [])
    return selector(store.getSnapshot())
  }
  const root = createRoot(container)
  /** The slot's standing `useSessions` seat, rebuilt whenever the list moves. */
  const useSessions = (selector) => {
    const [, force] = React.useState(0)
    React.useEffect(() => sessions.subscribe(() => { force(value => value + 1) }), [])
    return selector(sessions.getSnapshot())
  }
  const props = { ...registration.inject(), useSessions, useStore, actions: store.actions }
  await act(async () => { root.render(React.createElement(registration.component, props)) })
  await flush(() => {})

  return {
    container,
    calls,
    flush,
    /** The one interactive element the collapsed panel is. */
    pill: () => container.querySelector('button'),
    /** One card row, and the way the tests reach them. */
    byLabel: (label) => container.querySelector(`button[aria-label="${label}"]`),
    /** Let real time pass, for a transition that has to finish. */
    wait: async (ms) => { await act(async () => { await new Promise(resolve => { setTimeout(resolve, ms) }) }) },
    /**
     * Render the General-settings row this bundle registers, on its own.
     * @returns the row handles: its container, its selector, and the way to choose.
     */
    openRow: async () => {
      const rowContainer = dom.window.document.createElement('div')
      dom.window.document.body.append(rowContainer)
      const rowRoot = createRoot(rowContainer)
      await act(async () => {
        rowRoot.render(React.createElement(settingsRow.component, {
          ...settingsRow.inject(), useStore, actions: store.actions,
        }))
      })
      await flush(() => {})
      return {
        container: rowContainer,
        pill: () => rowContainer.querySelector('button'),
        /** The choices the selector offers. */
        options: () => [...rowContainer.querySelectorAll('[role="menuitem"]')],
        choose: async (label) => {
          await flush(() => { rowContainer.querySelector('button').click() })
          const item = [...rowContainer.querySelectorAll('[role="menuitem"]')]
            .find(candidate => candidate.textContent === label)
          assert.ok(item, `the selector offers ${label}`)
          await flush(() => { item.click() })
        },
        close: async () => { await act(async () => { rowRoot.unmount() }); rowContainer.remove() },
      }
    },
    /** Switch the frame to another Session, as picking it in the sidebar does. */
    switchTo: async (id) => { await flush(() => { sessions.show(id) }) },
    /** Type into one input the way a person does. */
    type: async (element, text) => {
      const prototype = element.tagName === 'TEXTAREA'
        ? dom.window.HTMLTextAreaElement.prototype
        : dom.window.HTMLInputElement.prototype
      await flush(() => {
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, text)
        element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      })
    },
    close: async () => { await act(async () => { root.unmount() }); container.remove() },
  }
}

test('the entry renders with no slot data and names the checkout the Host resolved', async () => {
  const page = await openPanel({
    cwd: 'D:\\ws\\repo', repo: true, branch: 'master', branches: ['master', 'dev'], changedFiles: 3,
    insertions: 2752, deletions: 380,
  })

  const pill = page.pill()
  assert.ok(pill, 'the panel renders without a Session prop')
  assert.ok(pill.textContent.startsWith('master'), 'collapsed, it leads with the branch')
  assert.ok(
    pill.textContent.includes('+2,752') && pill.textContent.includes('-380'),
    'and carries the same tally the open card shows',
  )
  assert.equal(page.calls.length, 1)
  assert.ok(page.calls[0].url.startsWith('/git-tools/api/state'), 'it reads the state from its own Host API')
  assert.ok(page.calls[0].url.includes('sessionId=session-1'), 'naming the Session the frame persisted')
  assert.equal(pill.getAttribute('title').includes('D:\\ws\\repo'), true, 'so the checkout is never a surprise')

  await page.close()
})

test('opening it shows the card: the branch and the way to commit', async () => {
  const page = await openPanel({
    cwd: 'D:\\ws\\repo', repo: true, branch: 'master', branches: ['master', 'dev'], changedFiles: 3,
    insertions: 2752, deletions: 380,
  })
  await page.flush(() => { page.pill().click() })

  const text = page.container.textContent
  assert.ok(text.includes('Git 工具'), 'the card is titled')
  assert.ok(text.includes('+2,752') && text.includes('-380'), 'the header carries the working tree tally')
  assert.equal(text.includes('更改'), false, 'with no label row of its own')
  assert.ok(text.includes('master'), 'the branch row names the branch')
  assert.ok(text.includes('提交或推送'), 'and the second row opens the commit box')
  assert.equal(page.container.querySelector('textarea'), null, 'which stays closed until asked for')

  await page.close()
})

test('a clean working tree says nothing rather than a zero, collapsed or open', async () => {
  const page = await openPanel({
    cwd: 'D:\\ws\\repo', repo: true, branch: 'master', branches: ['master'],
    changedFiles: 0, insertions: 0, deletions: 0,
  })

  assert.equal(page.pill().textContent, 'master', 'the collapsed pill is the branch alone')

  await page.flush(() => { page.pill().click() })

  const text = page.container.textContent
  assert.ok(text.includes('Git 工具'), 'the card is still titled')
  assert.equal(text.includes('+0'), false, 'and the tally is absent, not zeroed')
  assert.equal(text.includes('-0'), false)

  await page.close()
})

test('opening and collapsing plays a transition rather than swapping', async () => {
  const page = await openPanel({ cwd: 'D:\\ws\\repo', repo: true, branch: 'master', branches: ['master'] })

  assert.match(page.pill().style.animation, /dsh-git-tools-open/, 'the pill unfolds to open')
  assert.equal(
    page.pill().getAttribute('data-dsh-git-tools-animated'), '',
    'and is marked so reduced motion can switch the animation off',
  )

  await page.flush(() => { page.pill().click() })
  const card = page.container.children[0]
  assert.match(card.style.animation, /dsh-git-tools-open/, 'and the card eases in')
  assert.equal(card.style.transformOrigin, 'top right', 'growing from the corner the pill sat in')

  await page.flush(() => { page.byLabel('收起').click() })
  assert.match(page.container.children[0].style.animation, /dsh-git-tools-close/, 'then it eases out')
  assert.ok(page.byLabel('收起'), 'staying mounted while it does')
  assert.equal(page.byLabel('收起').disabled, true, 'and taking no second click')

  await page.wait(250)
  assert.equal(page.byLabel('收起'), null, 'before it is gone')
  assert.match(page.pill().style.animation, /dsh-git-tools-open/, 'leaving the pill behind')

  await page.close()
})

test('the branch row opens the list, with search and create-and-check-out', async () => {
  const page = await openPanel({
    cwd: 'D:\\ws\\repo', repo: true, branch: 'master', branches: ['dev', 'feature/x', 'master'], changedFiles: 3,
    insertions: 1, deletions: 0,
  })
  await page.flush(() => { page.pill().click() })
  await page.flush(() => { page.byLabel('切换分支').click() })

  const text = page.container.textContent
  const search = page.container.querySelector('input[aria-label="搜索分支"]')
  assert.equal(search.getAttribute('placeholder'), '搜索分支', 'the list carries its search')
  assert.ok(text.includes('分支'), 'with its heading')
  assert.ok(text.includes('master') && text.includes('dev') && text.includes('feature/x'), 'every local branch is listed')
  assert.ok(text.includes('未提交的更改: 3 个文件'), 'the branch in use says what the working tree still holds')
  assert.ok(text.includes('创建并检出新分支…'), 'and creating one is offered')

  const list = search.parentElement.parentElement
  assert.deepEqual(
    [...list.querySelectorAll('button')].slice(0, 3).map(row => row.getAttribute('aria-label')),
    ['master', 'dev', 'feature/x'],
    'the branch in use leads, and the rest keep git’s order',
  )

  // Search narrows the list to what was typed.
  await page.type(search, 'feat')
  assert.ok(page.container.textContent.includes('feature/x'))
  assert.equal(page.container.textContent.includes('dev'), false, 'the other rows are filtered out')

  // Choosing a branch checks it out, and the floating list goes away with it.
  await page.flush(() => { page.byLabel('feature/x').click() })
  const call = page.calls.find(entry => entry.url.endsWith('/checkout'))
  assert.deepEqual(call.body, { sessionId: 'session-1', branch: 'feature/x' })
  assert.equal(page.container.querySelector('input[aria-label="搜索分支"]'), null, 'the list closes with the checkout')

  await page.close()
})

test('the commit box carries the message, the staging switch, and the three actions', async () => {
  const page = await openPanel({
    cwd: 'D:\\ws\\repo', repo: true, branch: 'master', branches: ['master'], changedFiles: 27,
    insertions: 2752, deletions: 380,
  })
  await page.flush(() => { page.pill().click() })
  await page.flush(() => { page.byLabel('提交或推送').click() })

  const text = page.container.textContent
  const dialog = page.container.querySelector('[role="dialog"]')
  assert.ok(dialog, 'the commit box is a dialog, not another row in the card')
  assert.equal(dialog.parentElement, page.container, 'so it floats over the frame instead of unfolding inside the card')
  assert.match(dialog.style.animation, /dsh-git-tools-dialog/, 'and eases in')
  assert.match(page.container.children[0].style.animation, /dsh-git-tools-veil/, 'over a veil that fades in')
  assert.equal(dialog.querySelector('textarea').getAttribute('placeholder'), '提交信息（留空将自动生成）')
  assert.ok(text.includes('包含未暂存的更改') && text.includes('27 个文件'), 'the staging switch sits beside the file count')
  assert.ok(text.includes('提交') && text.includes('提交并推送') && text.includes('推送'), 'all three actions are rows')
  assert.ok(text.includes('+2,752') && text.includes('-380'), 'with the line counts grouped')
  assert.ok(page.byLabel('生成提交信息'), 'and the box offers to have a message written')
  assert.equal(page.byLabel('提交').disabled, false, 'an empty box is not a blocked commit: the Host writes one')
  assert.equal(page.byLabel('推送').disabled, false)

  await page.type(dialog.querySelector('textarea'), 'fix the panel')
  await page.flush(() => { page.byLabel('提交').click() })
  const call = page.calls.find(entry => entry.url.endsWith('/commit'))
  assert.deepEqual(call.body, { sessionId: 'session-1', message: 'fix the panel', stageAll: true })

  await page.close()
})

test('the sparkle asks for a message and puts it in the box', async () => {
  const page = await openPanel(
    { cwd: 'D:\\ws\\repo', repo: true, branch: 'master', branches: ['master'], changedFiles: 3, insertions: 9, deletions: 1 },
    { messages: 'feat: follow the session' },
  )
  await page.flush(() => { page.pill().click() })
  await page.flush(() => { page.byLabel('提交或推送').click() })
  await page.flush(() => { page.byLabel('生成提交信息').click() })

  const written = page.calls.find(entry => entry.url.endsWith('/message'))
  assert.deepEqual(
    written.body,
    { sessionId: 'session-1', stageAll: true, locale: 'zh' },
    'written for the shown Session, in the language the panel is showing',
  )
  assert.equal(page.container.querySelector('textarea').value, 'feat: follow the session')
  assert.equal(page.calls.some(entry => entry.url.endsWith('/commit')), false, 'nothing is committed by asking')

  await page.close()
})

test('committing an empty box writes the message first, then commits with it', async () => {
  const page = await openPanel(
    { cwd: 'D:\\ws\\repo', repo: true, branch: 'master', branches: ['master'], changedFiles: 3, insertions: 9, deletions: 1 },
    { messages: 'fix: keep the panel on the session' },
  )
  await page.flush(() => { page.pill().click() })
  await page.flush(() => { page.byLabel('提交或推送').click() })
  await page.flush(() => { page.byLabel('提交').click() })

  const order = page.calls
    .filter(entry => entry.url.includes('/message') || entry.url.endsWith('/commit'))
    .map(entry => (entry.url.endsWith('/message') ? 'message' : 'commit'))
  assert.deepEqual(order, ['message', 'commit'], 'the message is written before it is committed')
  const committed = page.calls.find(entry => entry.url.endsWith('/commit'))
  assert.deepEqual(committed.body, {
    sessionId: 'session-1', message: 'fix: keep the panel on the session', stageAll: true,
  })

  await page.close()
})

test('pushing is grey only when the branch is level with its upstream', async () => {
  const page = await openPanel({
    cwd: 'D:\\ws\\repo', repo: true, branch: 'master', branches: ['master'], changedFiles: 1,
    insertions: 2, deletions: 0, upstream: 'origin/master', ahead: 0,
  })
  await page.flush(() => { page.pill().click() })
  await page.flush(() => { page.byLabel('提交或推送').click() })
  assert.equal(page.byLabel('推送').disabled, true, 'nothing is waiting to be published')

  await page.close()

  const pending = await openPanel({
    cwd: 'D:\\ws\\repo', repo: true, branch: 'master', branches: ['master'], changedFiles: 1,
    insertions: 2, deletions: 0, upstream: 'origin/master', ahead: 2,
  })
  await pending.flush(() => { pending.pill().click() })
  await pending.flush(() => { pending.byLabel('提交或推送').click() })
  assert.equal(pending.byLabel('推送').disabled, false, 'two commits are waiting')

  await pending.close()
})

test('a branch with no upstream can still be pushed', async () => {
  const page = await openPanel({
    cwd: 'D:\\ws\\repo', repo: true, branch: 'han-nbtp', branches: ['han-nbtp'], changedFiles: 1,
    insertions: 2, deletions: 0, upstream: null, ahead: null,
  })
  await page.flush(() => { page.pill().click() })
  await page.flush(() => { page.byLabel('提交或推送').click() })

  assert.equal(page.byLabel('推送').disabled, false, 'an unknown count is not a zero')

  await page.close()
})

test('while a message is being written the dialog only turns its sparkle', async () => {
  const page = await openPanel(
    { cwd: 'D:\\ws\\repo', repo: true, branch: 'master', branches: ['master'], changedFiles: 3, insertions: 9, deletions: 1 },
    { messages: 'feat: follow the session' },
  )
  await page.flush(() => { page.pill().click() })
  await page.flush(() => { page.byLabel('提交或推送').click() })

  // Hold the write open so the working state can be inspected.
  let answer
  globalThis.fetch = (url) => (String(url).endsWith('/message')
    ? new Promise((resolve) => { answer = resolve })
    : Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) }))
  await page.flush(() => { page.byLabel('生成提交信息').click() })

  assert.equal(page.byLabel('提交').disabled, true, 'nothing is committable while it is being written')
  assert.equal(page.byLabel('提交并推送').disabled, true)
  assert.equal(page.byLabel('推送').disabled, true, 'not even a push')
  assert.equal(page.byLabel('生成提交信息').disabled, true, 'and it cannot be asked twice')
  const glyph = page.byLabel('生成提交信息').querySelector('span')
  assert.ok(glyph.style.animation.includes('dsh-git-tools-spin'), 'the sparkle itself turns')
  assert.equal(page.container.textContent.includes('正在生成'), false, 'with no progress text anywhere')
  assert.equal(page.container.textContent.includes('执行中'), false, 'and nothing on the card behind it')

  answer({ ok: true, status: 200, json: async () => ({ ok: true, message: 'feat: follow the session' }) })
  await page.flush(() => {})
  assert.equal(page.byLabel('提交').disabled, false, 'and it can be committed again')
  assert.ok(page.container.textContent.includes('更改'), 'the card still reads as a repository')
  assert.equal(page.container.querySelector('textarea').value, 'feat: follow the session')

  await page.close()
})

test('the dialog’s branch button opens the list it names', async () => {
  const page = await openPanel({
    cwd: 'D:\\ws\\repo', repo: true, branch: 'master', branches: ['master', 'dev'], changedFiles: 1,
  })
  await page.flush(() => { page.pill().click() })
  await page.flush(() => { page.byLabel('提交或推送').click() })
  await page.flush(() => { page.byLabel('当前分支').click() })

  assert.equal(page.container.querySelector('[role="dialog"]'), null, 'the dialog steps aside')
  assert.ok(page.container.querySelector('input[aria-label="搜索分支"]'), 'and the branch list takes over')

  await page.close()
})

test('the branch list floats left of its row, on the panel surface', async () => {
  const page = await openPanel({
    cwd: 'D:\\ws\\repo', repo: true, branch: 'master', branches: ['master', 'dev'], changedFiles: 29,
    insertions: 3139, deletions: 717,
  })
  await page.flush(() => { page.pill().click() })
  const card = page.container.children[0]
  await page.flush(() => { page.byLabel('切换分支').click() })

  const search = page.container.querySelector('input[aria-label="搜索分支"]')
  const list = search.parentElement.parentElement
  assert.equal(list.style.position, 'absolute', 'the list is a floating surface, not a row in the card')
  assert.equal(list.style.right, '100%', 'hanging off the card’s left edge')
  assert.equal(list.style.top, '0px', 'level with the branch row it belongs to')
  assert.ok(list.style.background.includes('layer-2'), 'on the panel surface the reference draws')
  assert.equal(card.style.background, list.style.background, 'and the card is the same surface')
  assert.match(list.style.animation, /dsh-git-tools-open/, 'and it unfolds rather than appearing')
  assert.equal(list.style.transformOrigin, 'top right', 'out of the corner it shares with its row')

  await page.close()
})

test('the commit dialog closes on Escape and on a click outside it', async () => {
  const page = await openPanel({
    cwd: 'D:\\ws\\repo', repo: true, branch: 'master', branches: ['master'], changedFiles: 1,
  })
  const dialog = () => page.container.querySelector('[role="dialog"]')
  await page.flush(() => { page.pill().click() })
  await page.flush(() => { page.byLabel('提交或推送').click() })
  assert.ok(dialog(), 'the row opens it')

  await page.flush(() => { dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' })) })
  assert.equal(dialog(), null, 'Escape closes it')
  assert.ok(page.byLabel('提交或推送'), 'and leaves the card itself in place')

  await page.flush(() => { page.byLabel('提交或推送').click() })
  assert.ok(dialog(), 'it opens again')
  // The veil is the card's sibling, so the first child is the veil and the
  // second the card; pressing on the veil itself dismisses the dialog.
  await page.flush(() => { page.container.children[0].dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true })) })
  assert.equal(dialog(), null, 'clicking outside closes it')

  await page.close()
})

test('a workspace that is not a repository says so instead of offering actions', async () => {
  const page = await openPanel({ cwd: 'D:\\ws\\plain', repo: false, branch: null, branches: [], changedFiles: 0 })
  await page.flush(() => { page.pill().click() })

  const text = page.container.textContent
  assert.ok(text.includes('这个工作区不是 git 仓库'))
  assert.equal(page.container.querySelector('input[aria-label="搜索分支"]'), null, 'and offers no branch list')

  await page.close()
})

test('switching the Session the frame shows switches the checkout it acts on', async () => {
  const page = await openPanel(
    { cwd: 'D:\\ws\\one', repo: true, branch: 'master', branches: ['master'], changedFiles: 1, insertions: 4, deletions: 0 },
    {
      states: {
        'session-1': { cwd: 'D:\\ws\\one', repo: true, branch: 'master', branches: ['master'], changedFiles: 1, insertions: 4, deletions: 0 },
        'session-2': { cwd: 'D:\\ws\\two', repo: true, branch: 'feature/pay', branches: ['feature/pay'], changedFiles: 2, insertions: 9, deletions: 1 },
      },
    },
  )
  assert.ok(page.pill().textContent.startsWith('master'), 'the pill leads with the branch')
  assert.ok(page.pill().textContent.includes('+4'), 'and carries that checkout\'s tally')

  await page.switchTo('session-2')

  assert.ok(page.pill().textContent.startsWith('feature/pay'), 'the panel follows the Session')
  assert.ok(
    page.pill().textContent.includes('+9') && page.pill().textContent.includes('-1'),
    'and so does the other checkout\'s tally',
  )
  assert.ok(page.pill().getAttribute('title').includes('D:\\ws\\two'), 'and names the other checkout')
  assert.ok(page.calls.at(-1).url.includes('sessionId=session-2'), 're-read from the Host for that Session')

  await page.close()
})

test('switching Sessions drops the previous checkout before the next read lands', async () => {
  const page = await openPanel(
    { cwd: 'D:\\ws\\one', repo: true, branch: 'master', branches: ['master'], changedFiles: 3, insertions: 4, deletions: 1 },
  )
  await page.flush(() => { page.pill().click() })
  assert.ok(page.container.textContent.includes('D:\\ws\\one'), 'the card names the checkout it reads')

  // Hold the next read open: the old checkout must not sit beside the new Session.
  let answer
  globalThis.fetch = () => new Promise((resolve) => { answer = resolve })
  await page.switchTo('session-2')
  assert.equal(page.container.textContent.includes('D:\\ws\\one'), false, 'the previous checkout is dropped')

  answer({ ok: true, status: 200, json: async () => ({ ok: true, cwd: 'D:\\ws\\two', repo: true, branch: 'dev', branches: ['dev'] }) })
  await page.flush(() => {})
  // The card is open here, so the branch is its own row rather than the pill.
  assert.ok(page.byLabel('切换分支').textContent.includes('dev'), 'and the next read names the other checkout')

  await page.close()
})

test('switching back to a Session shows what it last read while the new read is in flight', async () => {
  const page = await openPanel(
    { cwd: 'D:\\ws\\one', repo: true, branch: 'master', branches: ['master'], changedFiles: 1, insertions: 4, deletions: 0 },
    {
      states: {
        'session-1': { cwd: 'D:\\ws\\one', repo: true, branch: 'master', branches: ['master'], changedFiles: 1, insertions: 4, deletions: 0 },
        'session-2': { cwd: 'D:\\ws\\two', repo: true, branch: 'feature/pay', branches: ['feature/pay'], changedFiles: 2, insertions: 9, deletions: 1 },
      },
    },
  )
  await page.switchTo('session-2')
  assert.ok(page.pill().textContent.startsWith('feature/pay'), 'the second checkout is read')

  // Hold the next read open, so only a cache could answer this render.
  globalThis.fetch = () => new Promise(() => {})
  await page.switchTo('session-1')

  assert.ok(page.pill().textContent.startsWith('master'), 'the Session’s own last read shows at once')
  assert.ok(page.pill().textContent.includes('+4'), 'with the tally it read')
  assert.equal(page.pill().textContent.includes('feature/pay'), false, 'and never the checkout it left')

  await page.close()
})

test('a Session the Host has not opened yet is asked again, never swapped for another checkout', async () => {
  const page = await openPanel({
    cwd: 'D:\\ws\\one', repo: true, branch: 'master', branches: ['master'], changedFiles: 1, insertions: 4,
  })
  assert.ok(page.pill().textContent.startsWith('master'))

  let opened = false
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => (opened
      ? { ok: true, cwd: 'D:\\ws\\two', repo: true, branch: 'dev', branches: ['dev'], changedFiles: 2, insertions: 9, deletions: 0 }
      : { ok: true, pending: true }),
  })
  await page.switchTo('session-2')

  assert.equal(page.pill().textContent, 'Git 工具', 'it holds its title rather than the branch it left')
  assert.equal(page.pill().textContent.includes('dev'), false)

  opened = true
  await page.wait(500)

  assert.ok(page.pill().textContent.startsWith('dev'), 'and settles once the Session is open')
  assert.ok(page.pill().textContent.includes('+9'), 'with the checkout it actually resolved to')

  await page.close()
})

test('the General settings row offers the language a message is written in', async () => {
  const page = await openPanel({ cwd: 'D:\\ws\\repo', repo: true, branch: 'master', branches: ['master'] })
  const row = await page.openRow()

  assert.ok(row.container.textContent.includes('提交信息语言'), 'the row is titled')
  assert.ok(row.container.textContent.includes('生成提交信息时使用哪种语言'), 'and explained')
  assert.ok(row.pill().textContent.includes('跟随界面'), 'and starts by following the interface')

  await page.flush(() => { row.pill().click() })
  assert.deepEqual(row.options().map(item => item.textContent), ['跟随界面', '中文', 'English'])

  await row.close()
  await page.close()
})

test('the chosen language is the one a written message is asked for in', async () => {
  const page = await openPanel(
    { cwd: 'D:\\ws\\repo', repo: true, branch: 'master', branches: ['master'], changedFiles: 1 },
    { messages: 'fix: keep the panel on the session' },
  )
  const row = await page.openRow()
  await row.choose('English')

  await page.flush(() => { page.pill().click() })
  await page.flush(() => { page.byLabel('提交或推送').click() })
  await page.flush(() => { page.byLabel('生成提交信息').click() })

  const written = page.calls.filter(entry => entry.url.endsWith('/message')).at(-1)
  assert.equal(written.body.locale, 'en', 'the choice wins over the interface the panel shows')

  await row.close()
  await page.close()
})
