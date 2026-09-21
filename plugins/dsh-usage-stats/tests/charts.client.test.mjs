/**
 * The usage page's hover readouts, driven in jsdom.
 *
 * Every chart answers the pointer with the numbers behind the mark under it: a
 * heatmap cell reads out its day, a trend band reads out that day and the model
 * breakdown that made it, and a donut slice reads out its share of the total.
 * Before this the heatmap relied on a native `<title>` and the two larger
 * charts answered nothing at all.
 *
 * The marks carry no test hooks, so the assertions reach them the way the eye
 * does: the trend's bands are the only rects in its SVG, the donut's arcs are
 * its circles after the track, and today's heatmap cell is the only one with a
 * stroke.
 *
 * Run from the repository root:
 *   node --test "plugins/dsh-usage-stats/tests/*.test.mjs"
 *
 * @module dsh-usage-stats/tests/charts
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
for (const key of ['HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  globalThis[key] = dom.window[key]
}
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** The `YYYY-MM-DD` key of one local date, as the Host folds it. */
function dayKeyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** The short date the tooltip titles a day with, in the page's own locale. */
function shortDay(date) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date)
}

/**
 * Boot the bundle with a stubbed summary and render the page.
 * @returns the page handles: the container, the document, and a hover helper.
 */
async function openPage() {
  const today = new Date()
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  const state = {
    ok: true,
    generatedAt: Date.now(),
    days: {
      [dayKeyOf(yesterday)]: { tokens: 200000000, models: { 'glm-5.3-flash': 150000000, 'deepseek-v4.1-flash': 50000000 }, turns: 8 },
      [dayKeyOf(today)]: { tokens: 50000000, models: { 'glm-5.3-flash': 50000000 }, turns: 12 },
    },
    models: [
      { model: 'glm-5.3-flash', input: 200000000, output: 0, cacheRead: 0, cacheWrite: 0, requests: 2 },
      { model: 'deepseek-v4.1-flash', input: 50000000, output: 0, cacheRead: 0, cacheWrite: 0, requests: 1 },
    ],
    sessions: [],
    totals: { tokens: 250000000, sessions: 1, skipped: 0 },
  }
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => state })

  const repoRequire = createRequire(import.meta.url)
  const reactRequire = createRequire(repoRequire.resolve('@testing-library/react'))
  const React = reactRequire('react')
  const { createRoot } = reactRequire('react-dom/client')

  let loaded
  dom.window.__ModuleLoader__ = { load: (mod) => { loaded = mod } }
  const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  new Function('window', 'document', source)(dom.window, dom.window.document)
  assert.equal(loaded.id, 'dsh-usage-stats')

  const module = loaded.factory(() => React)

  const dictionaries = {}
  let section
  let registration
  const ctx = {
    effect: (fn) => fn(),
    on: () => () => {},
    get: () => undefined,
    locale: {
      register: (namespace, dictionary) => { dictionaries[namespace] = dictionary; return () => {} },
      bind: (namespace) => (key) => dictionaries[namespace]?.zh?.[key] ?? key,
      getSnapshot: () => ({ active: 'zh-CN' }),
    },
    slots: {
      inject: (_name, register) => { register(); return () => {} },
      register: (spec, Component) => { registration = spec; section = Component; return () => {} },
    },
  }
  module.apply(ctx)
  assert.equal(registration.id, 'usage-stats')

  const container = dom.window.document.createElement('div')
  dom.window.document.body.append(container)
  const act = React.act ?? (async (fn) => { await fn() })
  const flush = async (work) => { await act(async () => { work(); await new Promise(resolve => { setTimeout(resolve, 0) }) }) }

  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(section, {
      t: ctx.locale.bind('settings.usageStats'),
      ...registration.inject(),
    }))
  })
  await flush(() => {})
  assert.ok(container.textContent.includes('模型用量'), 'the page rendered')

  return {
    container,
    /** Point at one mark and let the readout commit. */
    hover: async (element) => {
      assert.ok(element, 'the mark exists')
      await flush(() => { element.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true })) })
    },
    close: async () => { await act(async () => { root.unmount() }); container.remove() },
  }
}

test('a heatmap cell reads out its own day', async () => {
  const page = await openPage()
  const cell = page.container.querySelector('svg[aria-label="Token 活动"] rect[stroke="#4f8cff"]')
  const longDay = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date())
  assert.equal(page.container.textContent.includes(longDay), false, 'the page names no day before a hover')

  await page.hover(cell)
  const text = page.container.textContent
  assert.ok(text.includes(longDay), 'the card names the hovered day')
  assert.ok(text.includes('5000万 tokens · 12 轮消息'), 'and reads out the spend and the turns behind it')

  await page.close()
})

test('a trend band reads out that day and the models behind it', async () => {
  const page = await openPage()
  const bands = [...page.container.querySelectorAll('svg[aria-label="每日 Token 趋势图"] rect')]
  assert.equal(bands.length, 7, 'one band per day in the default range')

  await page.hover(bands.at(-2))
  const text = page.container.textContent
  assert.ok(text.includes(`${shortDay(new Date(Date.now() - 24 * 60 * 60 * 1000))} - 2亿 tokens`), 'the title carries the day and its total')
  assert.ok(text.includes('glm-5.3-flash'), 'the breakdown names the model that spent')
  assert.ok(text.includes('1.5亿'), 'with its own share of the day')
  assert.ok(text.includes('5000万'), 'and the smaller one beside it')

  await page.close()
})

test('a donut slice reads out its share of the total', async () => {
  const page = await openPage()
  const arcs = [...page.container.querySelectorAll('svg[aria-label="模型用量"] circle')]
  assert.ok(arcs.length >= 3, 'the ring holds a track and one arc per model')

  await page.hover(arcs[1])
  const text = page.container.textContent
  assert.ok(text.includes('glm-5.3-flash'), 'the card names the slice')
  assert.ok(text.includes('2亿 tokens'), 'with the slice’s own token count, not the grand total')
  assert.ok(text.includes('80%'), 'and its share of the whole')

  await page.close()
})
