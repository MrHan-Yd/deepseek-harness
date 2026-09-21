/**
 * The rotating dock pill, rendered in jsdom against a stubbed metrics route.
 *
 * The pill carries no test hooks, so the assertions read it the way the eye
 * does: the text in the button, which reading the rotation has reached, and the
 * dialog a click opens. The cases are the behaviour the row promises — one
 * width, three readings taking turns, a click that holds the one on screen, and
 * a refused route that reads unavailable instead of showing stale numbers.
 *
 * Run from the repository root:
 *   node --test "plugins/dsh-system-stats/tests/*.test.mjs"
 *
 * @module dsh-system-stats/tests/client
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
for (const key of ['HTMLElement', 'Element', 'Node', 'Event', 'getComputedStyle']) {
  globalThis[key] = dom.window[key]
}
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** The rotation cadence the bundle holds one entry for. */
const ROTATE_MS = 5000

/** One reading of a machine under load, as the Host route serves it. */
const READING = {
  ok: true,
  intervalMs: 3000,
  at: 1_758_000_000_000,
  sampledOverMs: 3000,
  cpu: { percent: 12.4, cores: 10 },
  memory: { totalBytes: 25_769_803_776, usedBytes: 15_700_000_000, percent: 60.9, source: 'vm_stat' },
  network: { receivedBytesPerSecond: 1_258_291, sentBytesPerSecond: 245_760 },
}

/**
 * Boot the bundle and mount the registered dock entry.
 *
 * The mount is torn down through the test's own `after` hook, so a failing
 * assertion still unmounts the row: a live poll timer would otherwise keep
 * updating a component no test is watching and hold the process open.
 *
 * @param t - the running test, for its cleanup hook.
 * @param respond - the stubbed `fetch` implementation.
 * @param timers - the test's mocked timers, when the case drives the rotation.
 * @returns the rendered container, the captured registration, and handles.
 */
async function openRow(t, respond, timers) {
  globalThis.fetch = respond

  const repoRequire = createRequire(import.meta.url)
  const reactRequire = createRequire(repoRequire.resolve('@testing-library/react'))
  const React = reactRequire('react')
  const { createRoot } = reactRequire('react-dom/client')
  const { createPortal } = reactRequire('react-dom')

  let loaded
  dom.window.__ModuleLoader__ = { load: (mod) => { loaded = mod } }
  const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  new Function('window', 'document', source)(dom.window, dom.window.document)
  assert.equal(loaded.id, 'dsh-system-stats')

  const module = loaded.factory((id) => {
    if (id === 'react') return React
    if (id === 'react-dom') return { createPortal }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      return {
        // Placement is the shared primitive's own contract; the stub hands back
        // a placed panel so the suite reads the dialog's content.
        useAnchoredPosition: () => ({ position: 'fixed', left: '12px', top: '12px' }),
        useDismissOnOutsidePointer: () => {},
      }
    }
    throw new Error(`unexpected module request: ${id}`)
  })

  const dictionaries = {}
  let registration
  let section
  const ctx = {
    effect: (register) => register(),
    locale: {
      register: (namespace, dictionary) => {
        dictionaries[namespace] = dictionary
        return () => {}
      },
      bind: (namespace) => (key, params) => {
        const template = dictionaries[namespace]?.zh?.[key] ?? key
        if (params === undefined) return template
        return template.replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? `{${name}}`))
      },
    },
    slots: {
      inject: (_name, register) => register(),
      register: (spec, Component) => {
        registration = spec
        section = Component
        return () => {}
      },
    },
  }
  module.apply(ctx)

  const container = dom.window.document.createElement('div')
  dom.window.document.body.append(container)
  const act = React.act
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(section, { t: ctx.locale.bind('systemStats') }))
  })
  // Let the first request settle and the pill commit.
  await act(async () => {
    await new Promise((resolve) => { setTimeout(resolve, 0) })
  })

  const row = {
    container,
    registration,
    dictionaries,
    button: () => container.querySelector('button'),
    dialog: () => dom.window.document.querySelector('[role="dialog"]'),
    /** The visible pill's text: the measuring strip is never part of the reading. */
    text: () => container.querySelector('button')?.textContent ?? '',
    /** Dispatch one event the way the page would. */
    fire: async (node, event) => {
      await act(async () => { node.dispatchEvent(event) })
    },
    /** Advance the rotation by whole intervals. */
    rotate: async (times = 1) => {
      for (let at = 0; at < times; at += 1) {
        await act(async () => { timers.tick(ROTATE_MS) })
      }
    },
    /** Unmount, which also clears the row's poll timer. */
    close: async () => {
      await act(async () => { root.unmount() })
      container.remove()
    },
  }
  t.after(() => row.close())
  return row
}

/** One JSON response for the metrics route. */
function ok(body) {
  return async () => ({ ok: true, status: 200, json: async () => body })
}

/** A click the page would deliver to the pill. */
function click() {
  return new dom.window.MouseEvent('click', { bubbles: true })
}

/** A pointer entering or leaving the pill, as React's enter/leave synthesis reads it. */
function pointer(type, relatedTarget) {
  return new dom.window.MouseEvent(type, { bubbles: true, relatedTarget })
}

test('the entry registers beside the Session statistics row', async (t) => {
  const row = await openRow(t, ok(READING))
  assert.equal(row.registration.name, 'conversation.composer.dock')
  assert.equal(row.registration.id, 'system-stats')
  assert.equal(row.registration.order, -1)
  assert.equal(row.registration.locale, 'systemStats')
  assert.deepEqual(Object.keys(row.dictionaries.systemStats).sort(), ['en', 'zh'])
})

test('the pill leads with the two figures alone', async (t) => {
  const row = await openRow(t, ok(READING))
  const text = row.text()
  // Each figure carries the glyph that names it; the words live in the accessible
  // name and the dialog, so the pill itself stays as narrow as its numbers.
  assert.ok(text.includes('12%'), `CPU figure in the pill: ${text}`)
  assert.ok(text.includes('61%'), `memory figure in the pill: ${text}`)
  assert.ok(!text.includes('CPU'), `no label in the pill: ${text}`)
  assert.ok(!text.includes('内存'), `and none for memory: ${text}`)
  assert.equal(row.button().getAttribute('aria-label'), 'CPU 12% · 内存 61%')
})

test('the rotation alternates the pair with the network rates', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const row = await openRow(t, ok(READING), t.mock.timers)

  await row.rotate()
  assert.ok(row.text().includes('1.2 MB/s'), `download after one interval: ${row.text()}`)
  assert.ok(row.text().includes('240 KB/s'), `upload after one interval: ${row.text()}`)
  assert.ok(!row.text().includes('61%'), 'the small readings are not beside the rates')
  await row.rotate()
  assert.ok(row.text().includes('12%'), `back around: ${row.text()}`)
  assert.ok(row.text().includes('61%'), `memory back too: ${row.text()}`)
})

test('each entry is laid out beside the pill for measuring', async (t) => {
  const row = await openRow(t, ok(READING))
  const copies = [...row.button().parentElement.children].filter(node => node.tagName === 'SPAN')
  assert.equal(copies.length, 2, 'one copy per entry')
  assert.ok(copies[0].textContent.includes('12%') && copies[0].textContent.includes('61%'), `the pair: ${copies[0].textContent}`)
  assert.ok(copies[1].textContent.includes('1.2 MB/s') && copies[1].textContent.includes('240 KB/s'), `the rates: ${copies[1].textContent}`)
  // A percentage width cap resolves against the container the copy sits in and
  // can report zero however wide its figures are, which is how this measurement
  // silently stopped applying before.
  for (const copy of copies) {
    assert.equal(copy.style.maxWidth, 'none', 'a copy is never width-capped')
    assert.equal(copy.style.position, 'absolute', 'and never takes part in the row layout')
    assert.equal(copy.getAttribute('aria-hidden'), 'true', 'and is never announced')
  }
})

test('the pill takes the wider entry as its own width', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const row = await openRow(t, ok(READING), t.mock.timers)
  const copies = [...row.button().parentElement.children].filter(node => node.tagName === 'SPAN')

  // jsdom lays nothing out, so the copies report the widths this case gives them.
  copies[0].getBoundingClientRect = () => ({ width: 128 })
  copies[1].getBoundingClientRect = () => ({ width: 181 })
  await row.rotate()

  assert.equal(row.button().style.minWidth, '181px', 'the wider entry sets the box')
  await row.rotate()
  assert.equal(row.button().style.minWidth, '181px', 'and it holds when the narrower one is shown')
  assert.equal(row.button().style.height, '22px', 'at the fixed row line height')
})

test('the pointer on the pill holds the entry it is on', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const row = await openRow(t, ok(READING), t.mock.timers)

  await row.fire(row.button(), pointer('mouseover', null))
  await row.rotate()
  assert.ok(row.text().includes('12%'), `held while hovered: ${row.text()}`)

  await row.fire(row.button(), pointer('mouseout', dom.window.document.body))
  await row.rotate()
  assert.ok(row.text().includes('1.2 MB/s'), `rotating again: ${row.text()}`)
})

test('a click opens every reading, whichever entry the pill is on', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const row = await openRow(t, ok(READING), t.mock.timers)

  await row.fire(row.button(), click())
  const panel = row.dialog()
  assert.ok(panel, 'the dialog opened')
  assert.equal(panel.getAttribute('aria-label'), '系统状态详情')
  assert.equal(row.button().getAttribute('aria-expanded'), 'true')
  const fromPair = panel.textContent
  assert.ok(fromPair.includes('CPU'), `CPU heading: ${fromPair}`)
  assert.ok(fromPair.includes('使用率12%'), `usage row: ${fromPair}`)
  assert.ok(fromPair.includes('核心数10'), `core row: ${fromPair}`)
  assert.ok(fromPair.includes('采样窗口3.0 秒'), `window row: ${fromPair}`)
  assert.ok(fromPair.includes('内存'), `memory heading: ${fromPair}`)
  assert.ok(fromPair.includes('已用14.6 GB'), `used: ${fromPair}`)
  assert.ok(fromPair.includes('可用9.4 GB'), `available: ${fromPair}`)
  assert.ok(fromPair.includes('总计24.0 GB'), `total: ${fromPair}`)
  assert.ok(fromPair.includes('网络'), `network heading: ${fromPair}`)
  assert.ok(fromPair.includes('下行1.2 MB/s'), `download: ${fromPair}`)
  assert.ok(fromPair.includes('上行240 KB/s'), `upload: ${fromPair}`)

  // The rotation waits while the dialog is open, so the figures stay the ones clicked.
  await row.rotate()
  assert.equal(row.dialog().textContent, fromPair)

  await row.fire(dom.window.document, new dom.window.KeyboardEvent('keydown', { key: 'Escape' }))
  assert.equal(row.dialog(), null, 'Escape closed the dialog')

  // Opened from the other entry, the dialog is the same one rather than the
  // network's figures alone.
  await row.rotate()
  assert.ok(row.text().includes('1.2 MB/s'), `the rates are showing: ${row.text()}`)
  await row.fire(row.button(), click())
  assert.equal(row.dialog().textContent, fromPair, 'the same readings either way')
  assert.equal(row.dialog().getAttribute('aria-label'), '系统状态详情')
})

test('the network entry names both directions in its accessible name', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const row = await openRow(t, ok(READING), t.mock.timers)

  await row.rotate()
  assert.equal(row.button().getAttribute('aria-label'), '下行 1.2 MB/s · 上行 240 KB/s')
})

test('a refused route shows the readings as unavailable', async (t) => {
  const row = await openRow(t, async () => ({ ok: false, status: 403, json: async () => ({ ok: false }) }))
  assert.ok(row.text().includes('—'), `the pill reads unavailable: ${row.text()}`)
  assert.equal(row.button().getAttribute('aria-label'), 'CPU — · 内存 —')
  await row.fire(row.button(), click())
  assert.ok(row.dialog().textContent.includes('读取系统状态失败'), `dialog: ${row.dialog().textContent}`)
})

test('a platform without network counters names that in the network entry', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const row = await openRow(t, ok({ ...READING, network: null }), t.mock.timers)

  await row.rotate()
  assert.equal(row.button().getAttribute('aria-label'), '网络 —')
  await row.fire(row.button(), click())
  assert.ok(row.dialog().textContent.includes('此平台不提供网络字节计数'), `dialog: ${row.dialog().textContent}`)
})
