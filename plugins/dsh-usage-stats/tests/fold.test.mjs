/**
 * Attribution and bucketing rules for the usage-stats Host half.
 *
 * These are the figures a person reads as "what this installation spent", so
 * the fold is pinned here rather than only observed on screen: the model a
 * sample belongs to, when a re-report replaces its predecessor, when a retry
 * adds instead, and which local day a sample lands on.
 *
 * Run from the repository root:
 *   node --test "plugins/dsh-usage-stats/tests/*.test.mjs"
 *
 * @module dsh-usage-stats/tests/fold
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

// Resolved when `apply` runs, so an isolated home keeps the log index and the
// fold cache away from the developer's real installation. The suite owns this
// directory and removes it, so a repeated run leaves nothing behind.
const HOME = mkdtempSync(join(tmpdir(), 'dsh-usage-stats-test-'))
process.env.DSH_HOME = HOME
after(() => {
  delete process.env.DSH_HOME
  rmSync(HOME, { recursive: true, force: true })
})

const { apply } = await import('../src/index.js')

/** @param hour - local hour of day. @returns epoch ms on 2026-09-19 at that hour. */
const at = hour => new Date(2026, 8, 19, hour, 30, 0).getTime()

/** @param id - Session id. @returns a Session header record. */
const header = (id, createdAt) => ({ type: 'session', version: 3, id, createdAt, cwd: '/workspace' })

/** @param time - event time. @param model - routed model. @returns a request/context event. */
const context = (time, model) => ({ type: 'request/context', seq: 1, time, data: { provider: 'test', model, contextWindow: 1000 } })

/** @param time - event time. @param turn - turn. @param step - step. @param usage - reported usage. */
const message = (time, turn, step, usage) => ({ type: 'assistant/message', seq: 2, time, data: { turn, step, usage, message: { role: 'assistant', content: [] } } })

/** @param time - event time. @param turn - turn. @param step - step. @param usage - reported usage inside the stream. */
const attempt = (time, turn, step, usage) => ({ type: 'assistant/attempt', seq: 3, time, data: { turn, step, stream: [{ type: 'chunk', chunk: { type: 'usage', usage } }] } })

/** @param time - event time. @param turn - turn. @param step - step. */
const retryStarted = (time, turn, step) => ({ type: 'llm/retry-started', seq: 4, time, data: { turn, step } })

/** @param time - event time. @param turn - turn. @returns a closed-turn event. */
const turnEnd = (time, turn) => ({ type: 'turn/end', seq: 5, time, data: { turn, reason: { kind: 'completed' } } })

/** @param input - input tokens. @param output - output tokens. @param cacheRead - cache-read tokens. */
const usage = (input, output, cacheRead = 0) => ({ inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, totalTokens: input + output + cacheRead })

/** Unique cache file counter, so one test's fold can never seed another's. */
let caches = 0

/**
 * Collect one summary from an in-memory Session corpus.
 * @param sessions - `{ header, events }` per Session; `fail: true` makes its read throw.
 * @param options - optional shared cache path and a read counter to increment.
 * @returns the parsed summary payload.
 */
async function collect(sessions, options = {}) {
  const readers = new Map(sessions.map(session => [session.header.id, session]))
  const query = {
    async listSessions() { return sessions.map(session => ({ header: session.header, live: false, persisted: true })) },
    async readSession(id) {
      if (options.counter !== undefined) options.counter.reads += 1
      const session = readers.get(id)
      if (session === undefined || session.fail === true) throw new Error(`unreadable ${id}`)
      return { session: session.header, events: [session.header, ...session.events] }
    },
  }
  let route = null
  const scopeCtx = { effect: fn => fn(), webServer: { register: spec => { route = spec } } }
  await apply({
    get: name => (name === 'sessionQuery' ? query : name === 'connection' ? { requestRejection: () => undefined } : undefined),
    effect: fn => fn(),
    inject: (_names, fn) => fn(scopeCtx),
  }, { cachePath: options.cachePath ?? join(process.env.DSH_HOME, `cache-${caches += 1}.json`) })
  const response = { status: 0, writeHead(status) { this.status = status }, end(body) { this.body = body } }
  await route.handler({ method: 'GET', url: '/usage-stats/api/summary?refresh=1', headers: { 'x-dsh-usage-stats': '1' } }, response)
  assert.equal(response.status, 200)
  return JSON.parse(response.body)
}

test('attributes each sample to the model named by the newest preceding request/context', async () => {
  const summary = await collect([{
    header: header('s1', at(9)),
    events: [
      context(at(9), 'model-a'),
      message(at(9), 1, 1, usage(100, 10)),
      context(at(10), 'model-b'),
      message(at(10), 1, 2, usage(200, 20)),
    ],
  }])
  const byModel = Object.fromEntries(summary.models.map(row => [row.model, row.input + row.output]))
  assert.deepEqual(byModel, { 'model-a': 110, 'model-b': 220 })
  assert.equal(summary.days['2026-09-19'].models['model-a'], 110)
  assert.equal(summary.days['2026-09-19'].models['model-b'], 220)
})

test('a re-reported sample for the same turn/step replaces its predecessor instead of adding', async () => {
  const summary = await collect([{
    header: header('s1', at(9)),
    events: [
      context(at(9), 'model-a'),
      message(at(9), 1, 1, usage(100, 10)),
      message(at(10), 1, 1, usage(100, 10)),
      message(at(11), 1, 1, usage(300, 30)),
    ],
  }])
  assert.equal(summary.totals.tokens, 330)
  assert.equal(summary.totals.requests, 1)
})

test('llm/retry-started closes the slot so the retried attempt adds to the total', async () => {
  const summary = await collect([{
    header: header('s1', at(9)),
    events: [
      context(at(9), 'model-a'),
      attempt(at(9), 1, 1, usage(0, 0)),
      retryStarted(at(9), 1, 1),
      attempt(at(10), 1, 1, usage(50, 5)),
    ],
  }])
  assert.equal(summary.totals.tokens, 55)
  assert.equal(summary.totals.requests, 2)
})

test('reads usage from an assistant/attempt stream chunk', async () => {
  const summary = await collect([{
    header: header('s1', at(9)),
    events: [context(at(9), 'model-a'), attempt(at(9), 1, 1, usage(7, 3, 90))],
  }])
  assert.deepEqual(
    { input: summary.totals.input, output: summary.totals.output, cacheRead: summary.totals.cacheRead },
    { input: 7, output: 3, cacheRead: 90 },
  )
  assert.equal(summary.totals.tokens, 100)
})

test('buckets samples onto the local calendar day that reported them', async () => {
  const summary = await collect([{
    header: header('s1', at(9)),
    events: [
      context(at(9), 'model-a'),
      { ...message(at(9), 1, 1, usage(1, 1)), time: new Date(2026, 8, 18, 23, 59, 0).getTime() },
      { ...message(at(10), 1, 2, usage(2, 2)), time: new Date(2026, 8, 19, 0, 1, 0).getTime() },
    ],
  }])
  assert.deepEqual(Object.keys(summary.days).sort(), ['2026-09-18', '2026-09-19'])
  assert.equal(summary.days['2026-09-18'].tokens, 2)
  assert.equal(summary.days['2026-09-19'].tokens, 4)
})

test('counts each closed turn on the day it spent, across midnight', async () => {
  const spent = new Date(2026, 8, 18, 23, 59, 0).getTime()
  const closed = new Date(2026, 8, 19, 0, 1, 0).getTime()
  const summary = await collect([{
    header: header('s1', at(9)),
    events: [
      context(spent, 'model-a'),
      message(spent, 1, 1, usage(1, 1)),
      turnEnd(closed, 1),
      message(at(10), 2, 1, usage(2, 2)),
      turnEnd(at(10), 2),
      // A turn that spent nothing still counts, on the day it closed.
      turnEnd(at(10), 3),
    ],
  }])
  assert.equal(summary.days['2026-09-18'].turns, 1, 'the turn that spent on the 18th counts there, though it closed after midnight')
  assert.equal(summary.days['2026-09-18'].tokens, 2)
  assert.equal(summary.days['2026-09-19'].turns, 2, 'the turn that spent on the 19th, and the one that spent nothing')
  assert.equal(summary.days['2026-09-19'].tokens, 4)
})

test('reports one row per Session spanning its header creation to its last event', async () => {
  const summary = await collect([{
    header: header('s1', at(9)),
    events: [context(at(9), 'model-a'), message(at(11), 1, 1, usage(5, 5))],
  }])
  assert.equal(summary.sessions.length, 1)
  assert.equal(summary.sessions[0].createdAt, at(9))
  assert.equal(summary.sessions[0].lastAt, at(11))
  assert.equal(summary.sessions[0].tokens, 10)
})

test('counts a Session it cannot read as skipped without failing the summary', async () => {
  const summary = await collect([
    { header: header('s1', at(9)), events: [context(at(9), 'model-a'), message(at(9), 1, 1, usage(5, 5))] },
    { header: header('broken', at(9)), events: [], fail: true },
  ])
  assert.equal(summary.totals.skipped, 1)
  assert.equal(summary.totals.sessions, 1)
  assert.equal(summary.totals.tokens, 10)
})

test('refuses a request without the guard header before reading any Session', async () => {
  const sessions = [{ header: header('s1', at(9)), events: [context(at(9), 'model-a'), message(at(9), 1, 1, usage(5, 5))] }]
  const readers = new Map(sessions.map(session => [session.header.id, session]))
  const query = {
    async listSessions() { return sessions.map(session => ({ header: session.header, live: false, persisted: true })) },
    async readSession(id) { return { session: readers.get(id).header, events: readers.get(id).events } },
  }
  let route = null
  let rejections = 0
  const scopeCtx = { effect: fn => fn(), webServer: { register: spec => { route = spec } } }
  await apply({
    get: name => (name === 'sessionQuery' ? query : name === 'connection'
      ? { requestRejection: () => { rejections += 1; return 401 } }
      : undefined),
    effect: fn => fn(),
    inject: (_names, fn) => fn(scopeCtx),
  }, { cachePath: join(process.env.DSH_HOME, 'cache.json') })
  const response = { status: 0, writeHead(status) { this.status = status }, end(body) { this.body = body } }
  await route.handler({ method: 'GET', url: '/usage-stats/api/summary', headers: {} }, response)
  assert.equal(rejections, 1)
  assert.equal(response.status, 401)
  assert.equal(JSON.parse(response.body).ok, false)
})

test('reuses the cached fold until the Session log changes on disk', async () => {
  const log = join(process.env.DSH_HOME, 'sessions', 'workspace', 's1', 'session.v3.jsonl.zstd')
  mkdirSync(join(process.env.DSH_HOME, 'sessions', 'workspace', 's1'), { recursive: true })
  writeFileSync(log, 'stat-only stub: the fold reads through sessionQuery, never this file')
  const cachePath = join(process.env.DSH_HOME, 'shared-cache.json')
  const corpus = () => [{
    header: header('s1', at(9)),
    events: [context(at(9), 'model-a'), message(at(9), 1, 1, usage(5, 5))],
  }]
  const counter = { reads: 0 }

  const cold = await collect(corpus(), { cachePath, counter })
  assert.equal(counter.reads, 1, 'a cold cache reads the Session once')
  assert.equal(cold.totals.tokens, 10)

  const warm = await collect(corpus(), { cachePath, counter })
  assert.equal(counter.reads, 1, 'an unchanged log is served from the cache')
  assert.deepEqual(warm.totals, cold.totals)

  // Touching the log is the only signal the cache watches, so a moved stat must
  // force the re-read that a rewritten log would.
  writeFileSync(log, 'stat-only stub: the fold reads through sessionQuery, never this file')
  const moved = await collect(corpus(), { cachePath, counter })
  assert.equal(counter.reads, 2, 'a moved log stat forces a fresh read')
  assert.equal(moved.totals.tokens, 10)
})

test('drops cache rows for Sessions that no longer exist', async () => {
  const cachePath = join(process.env.DSH_HOME, 'retain-cache.json')
  const kept = { header: header('kept', at(9)), events: [context(at(9), 'model-a'), message(at(9), 1, 1, usage(5, 5))] }
  await collect([kept, { header: header('gone', at(9)), events: [context(at(9), 'model-a'), message(at(9), 1, 1, usage(7, 7))] }], { cachePath })
  const summary = await collect([kept], { cachePath })
  assert.equal(summary.totals.sessions, 1)
  assert.equal(summary.sessions[0].id, 'kept')
  assert.equal(summary.totals.tokens, 10)
})
