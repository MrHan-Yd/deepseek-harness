/**
 * dsh-usage-stats — token and activity statistics across every Session.
 *
 * The Settings page needs figures no single Session can answer: how many tokens
 * the whole installation has spent, which days were active, how the spend split
 * across models. This half folds every persisted Session log into per-day,
 * per-model token totals and serves the aggregate over a same-origin HTTP API.
 *
 * Attribution rules are copied from `@deepseek-ai/dsh-token-meter`'s
 * `tokenUsage` projection, which is the one definition of what a Session spent:
 * the model named by the newest preceding `request/context` owns a sample, a
 * sample for an already-settled turn/step REPLACES its predecessor, and
 * `llm/retry-started` closes that replacement slot so the retried attempt adds
 * instead. Folding anything else would disagree with the per-Session figure the
 * chat page shows.
 *
 * Folding is cached per Session under `$DSH_HOME/usage-stats-cache.json`, keyed
 * by the log file's size and modification time. The cache is a pure
 * optimization: a Session whose log cannot be stat-ed is always re-folded, and
 * `readSession` stays the only read path, so nothing here can invent a figure
 * the Session corpus does not hold.
 *
 * Security has one home: the `connection` service's `requestRejection` applies
 * DSH's own Host/Origin/Fetch-Metadata fence plus its browser login-token
 * authentication. A route registered through `ctx.webServer.register` receives
 * neither automatically, so every request asks for the rejection first, exactly
 * as `@deepseek-ai/dsh-open-in-app` does. A missing service is a refusal, never
 * a pass. The `x-dsh-usage-stats` header stays as a second, cheaper layer: a
 * cross-origin page cannot set it without a preflight this server never grants.
 *
 * Function plugin: named exports and no default export, so the Loader keeps the
 * namespace.
 *
 * @module dsh-usage-stats
 */

import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'usage-stats'

/** The Session corpus is the one hard service; a missing one is a load error. */
export const inject = ['sessionQuery']

/** Route prefix owned by this plugin. */
const API_PATH = '/usage-stats'

/** Request header a cross-origin page cannot set without a granted preflight. */
const GUARD_HEADER = 'x-dsh-usage-stats'

/**
 * Cache file schema version; a mismatch discards the whole file. Version 2 adds
 * the per-day turn count the heatmap's readout reports.
 */
const CACHE_VERSION = 2

/** How long one collected summary serves later reads, in milliseconds. */
const SUMMARY_TTL_MS = 5000

/** Model key attributed to usage that arrived before any `request/context`. */
const UNKNOWN_MODEL = 'unknown'

/** The four token buckets every figure is built from, in a fixed order. */
const BUCKETS = ['input', 'output', 'cacheRead', 'cacheWrite']

/**
 * Resolve the Harness home the same way the shipped Session persistence does.
 * @returns the absolute `$DSH_HOME` path.
 */
function resolveHome() {
  const configured = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return configured === '' ? join(homedir(), '.dsh') : configured
}

/**
 * Resolve the usage-stats cache file path.
 * @param config - raw plugin config.
 * @returns the absolute cache path.
 */
function cachePathOf(config) {
  const configured = typeof config?.cachePath === 'string' ? config.cachePath.trim() : ''
  return configured === '' ? join(resolveHome(), 'usage-stats-cache.json') : configured
}

/**
 * Map one instant onto its local calendar day.
 *
 * Days are bucketed in the Host's local timezone so a day boundary matches the
 * clock the person reading the page uses. A remote browser in another timezone
 * would see the Host's days; that is the documented boundary of this page.
 *
 * @param ms - epoch milliseconds.
 * @returns the `YYYY-MM-DD` key of the containing local day.
 */
function dateKeyOf(ms) {
  const date = new Date(ms)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Read the usage one durable Assistant settlement reports for its attempt.
 *
 * Mirrors `@deepseek-ai/dsh-token-meter`: a settled `assistant/message` states
 * its usage directly, and any other attempt carries the newest `usage` chunk of
 * its stream.
 *
 * @param event - one raw durable event.
 * @returns the reported usage, or undefined when the event settled no attempt.
 */
function usageOf(event) {
  if (event === null || typeof event !== 'object') return undefined
  const data = event.data
  if (data === null || typeof data !== 'object') return undefined
  if (event.type === 'assistant/message' && data.usage !== undefined) return data.usage
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  if (!Array.isArray(data.stream)) return undefined
  for (let at = data.stream.length - 1; at >= 0; at -= 1) {
    const chunk = data.stream[at]?.chunk
    if (chunk?.type === 'usage' && chunk.usage !== undefined) return chunk.usage
  }
  return undefined
}

/**
 * Normalize one reported usage into the four non-negative buckets.
 * @param usage - provider-reported usage.
 * @returns the bucket counts, with absent optional buckets read as 0.
 */
function bucketsOf(usage) {
  const count = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0)
  return {
    input: count(usage?.inputTokens),
    output: count(usage?.outputTokens),
    cacheRead: count(usage?.cacheReadTokens),
    cacheWrite: count(usage?.cacheWriteTokens),
  }
}

/** @param buckets - two bucket sets. @returns whether all four counts match. */
function bucketsEqual(left, right) {
  return BUCKETS.every(bucket => left[bucket] === right[bucket])
}

/** @returns the summed token count of one bucket set. */
function totalOf(buckets) {
  return BUCKETS.reduce((sum, bucket) => sum + buckets[bucket], 0)
}

/**
 * The replacement-slot key of one turn/step pair.
 * @param data - event data carrying `turn` and `step`.
 * @returns the slot key, or null when the event names no numeric pair.
 */
function slotKeyOf(data) {
  const turn = data?.turn
  const step = data?.step
  if (typeof turn !== 'number' || typeof step !== 'number') return null
  return `${turn}:${step}`
}

/** One model's running figures inside a fold. */
function emptyModel(provider) {
  return { provider, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 }
}

/**
 * Fold one Session's complete raw log into per-day and per-model totals.
 *
 * @param snapshot - the `readSession` observation: its header plus raw events.
 * @returns the Session's fold, or undefined when the observation is unusable.
 */
function foldSession(snapshot) {
  const header = snapshot?.session
  const events = snapshot?.events
  if (header === null || typeof header !== 'object' || !Array.isArray(events)) return undefined

  const createdAt = typeof header.createdAt === 'number' ? header.createdAt : 0
  const days = {}
  const models = {}
  /** Newest sample per settled turn/step, so a re-report replaces it. */
  const slots = new Map()
  /**
   * The day each turn's latest sample landed on. A turn is counted where it
   * spent, so a turn that closes after midnight still counts beside the tokens
   * it produced instead of leaving a lit day with no turns and a quiet one with
   * turns but no spend.
   */
  const turnDays = new Map()
  let provider = null
  let model = null
  let lastAt = createdAt
  let samples = 0

  /**
   * Add one bucket set to a day and a model.
   * @param day - local day key.
   * @param key - model key.
   * @param buckets - the bucket set.
   * @param sign - 1 to add, -1 to remove a replaced sample.
   */
  const post = (day, key, buckets, sign) => {
    const dayRow = days[day] ?? (days[day] = { tokens: 0, models: {}, turns: 0 })
    const modelRow = models[key] ?? (models[key] = emptyModel(provider))
    if (modelRow.provider === null && provider !== null) modelRow.provider = provider
    for (const bucket of BUCKETS) {
      dayRow.models[key] = (dayRow.models[key] ?? 0) + sign * buckets[bucket]
      modelRow[bucket] += sign * buckets[bucket]
    }
    dayRow.tokens += sign * totalOf(buckets)
  }

  for (const event of events) {
    const time = event?.time
    if (typeof time === 'number' && time > lastAt) lastAt = time

    if (event?.type === 'request/context') {
      if (typeof event.data?.model === 'string' && event.data.model !== '') model = event.data.model
      if (typeof event.data?.provider === 'string' && event.data.provider !== '') provider = event.data.provider
      continue
    }
    if (event?.type === 'llm/retry-started') {
      const slot = slotKeyOf(event.data)
      if (slot !== null) slots.delete(slot)
      continue
    }
    // A closed turn is the day's activity independent of what it spent: it is
    // what the heatmap's readout reports beside the tokens.
    if (event?.type === 'turn/end') {
      const turn = event.data?.turn
      const spentOn = typeof turn === 'number' ? turnDays.get(turn) : undefined
      const day = spentOn ?? dateKeyOf(typeof time === 'number' ? time : createdAt)
      const dayRow = days[day] ?? (days[day] = { tokens: 0, models: {}, turns: 0 })
      dayRow.turns += 1
      continue
    }

    const usage = usageOf(event)
    if (usage === undefined) continue
    const buckets = bucketsOf(usage)
    const slot = slotKeyOf(event.data)
    const previous = slot === null ? undefined : slots.get(slot)
    // token-meter leaves its state untouched when a re-report carries the same
    // counts, so a duplicate settlement neither moves totals nor the slot.
    if (previous !== undefined && bucketsEqual(previous.buckets, buckets)) continue
    if (previous !== undefined) {
      post(previous.day, previous.model, previous.buckets, -1)
      models[previous.model].requests -= 1
    }
    const key = model ?? UNKNOWN_MODEL
    const day = dateKeyOf(typeof event.time === 'number' ? event.time : createdAt)
    post(day, key, buckets, 1)
    models[key].requests += 1
    samples += 1
    if (typeof event.data?.turn === 'number') turnDays.set(event.data.turn, day)
    if (slot !== null) slots.set(slot, { day, model: key, buckets })
  }

  return { id: String(header.id ?? ''), cwd: typeof header.cwd === 'string' ? header.cwd : '', createdAt, lastAt, days, models, samples }
}

/**
 * Index every on-disk Session log by its directory name, which is its id.
 *
 * Used only as a cache key. The layout is read defensively: an unreadable or
 * unexpected entry is skipped rather than failing the fold, and a Session with
 * no index entry is simply re-folded on every read.
 *
 * @param root - the `sessions` directory under the Harness home.
 * @returns a map from Session id to `"<mtimeMs>:<size>"`.
 */
function logIndex(root) {
  const index = new Map()
  let workspaces
  try {
    workspaces = readdirSync(root, { withFileTypes: true })
  } catch {
    // No on-disk corpus: every Session is re-folded and nothing is cached.
    return index
  }
  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue
    let sessions
    try {
      sessions = readdirSync(join(root, workspace.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue
      try {
        const stat = statSync(join(root, workspace.name, session.name, 'session.v3.jsonl.zstd'))
        index.set(session.name, `${stat.mtimeMs}:${stat.size}`)
      } catch {
        // Without a stat there is no change key, so this Session stays uncached.
      }
    }
  }
  return index
}

/** The per-Session fold cache, persisted as one JSON document. */
class FoldCache {
  /**
   * @param path - absolute cache file path.
   */
  constructor(path) {
    this.path = path
    this.rows = new Map()
    this.dirty = false
  }

  /** Load the cache, discarding any record that does not match this version. */
  load() {
    let parsed
    try {
      parsed = JSON.parse(readFileSync(this.path, 'utf8'))
    } catch {
      // A missing or unparsable cache is a cold cache, never an error: the fold
      // rebuilds every row from the Session corpus.
      return
    }
    if (parsed?.version !== CACHE_VERSION || typeof parsed.sessions !== 'object' || parsed.sessions === null) return
    for (const [id, row] of Object.entries(parsed.sessions)) {
      if (typeof row?.key === 'string' && row.fold !== null && typeof row.fold === 'object') {
        this.rows.set(id, row)
      }
    }
  }

  /**
   * The cached fold for one Session at one change key.
   * @param id - Session id.
   * @param key - change key, or null when the log could not be stat-ed.
   * @returns the cached fold, or undefined when the row is stale or absent.
   */
  get(id, key) {
    if (key === null) return undefined
    const row = this.rows.get(id)
    return row !== undefined && row.key === key ? row.fold : undefined
  }

  /**
   * Record one Session's fold.
   * @param id - Session id.
   * @param key - change key, or null when the Session must stay uncached.
   * @param fold - the folded figures.
   */
  set(id, key, fold) {
    if (key === null) return
    this.rows.set(id, { key, fold })
    this.dirty = true
  }

  /** Drop rows for Sessions that no longer exist, so the file stays bounded. */
  retain(ids) {
    for (const id of [...this.rows.keys()]) {
      if (!ids.has(id)) {
        this.rows.delete(id)
        this.dirty = true
      }
    }
  }

  /** Write the cache atomically, logging and continuing on any failure. */
  save() {
    if (!this.dirty) return
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const payload = JSON.stringify({ version: CACHE_VERSION, sessions: Object.fromEntries(this.rows) })
      const staging = `${this.path}.tmp`
      writeFileSync(staging, payload)
      renameSync(staging, this.path)
      this.dirty = false
    } catch (error) {
      // The cache only saves future work; the fold it caches is already served.
      console.warn(`usage-stats: could not write ${this.path}: ${String(error)}`)
    }
  }
}

/**
 * Collect the aggregate over every Session the corpus knows.
 *
 * @param query - the `sessionQuery` service.
 * @param cache - the per-Session fold cache.
 * @param root - the on-disk `sessions` directory.
 * @returns the JSON-serializable summary the Settings page renders.
 */
async function collectSummary(query, cache, root) {
  const records = await query.listSessions()
  const index = logIndex(root)
  const live = new Set()
  const days = {}
  const models = {}
  const sessions = []
  let skipped = 0

  for (const record of records) {
    const header = record?.header
    const id = String(header?.id ?? '')
    if (id === '') continue
    live.add(id)
    const key = index.get(id) ?? null
    let fold = cache.get(id, key)
    if (fold === undefined) {
      try {
        fold = foldSession(await query.readSession(id))
      } catch (error) {
        skipped += 1
        console.warn(`usage-stats: could not read session ${id}: ${String(error)}`)
        continue
      }
      if (fold === undefined) {
        skipped += 1
        continue
      }
      cache.set(id, key, fold)
    }
    sessions.push({ id, cwd: fold.cwd, createdAt: fold.createdAt, lastAt: fold.lastAt, tokens: sumFold(fold) })
    for (const [day, row] of Object.entries(fold.days)) {
      const target = days[day] ?? (days[day] = { tokens: 0, models: {}, turns: 0 })
      target.tokens += row.tokens
      target.turns += row.turns ?? 0
      for (const [model, tokens] of Object.entries(row.models)) {
        target.models[model] = (target.models[model] ?? 0) + tokens
      }
    }
    for (const [model, row] of Object.entries(fold.models)) {
      const target = models[model] ?? (models[model] = { model, provider: row.provider, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 })
      for (const bucket of BUCKETS) target[bucket] += row[bucket]
      target.requests += row.requests
      if (target.provider === null && row.provider !== null) target.provider = row.provider
    }
  }

  cache.retain(live)
  cache.save()

  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 }
  for (const row of Object.values(models)) {
    for (const bucket of BUCKETS) totals[bucket] += row[bucket]
    totals.requests += row.requests
  }
  const dayKeys = Object.keys(days).sort()
  return {
    ok: true,
    generatedAt: Date.now(),
    totals: {
      ...totals,
      tokens: dayKeys.reduce((sum, day) => sum + days[day].tokens, 0),
      sessions: sessions.length,
      skipped,
      firstDay: dayKeys[0] ?? null,
      lastDay: dayKeys[dayKeys.length - 1] ?? null,
    },
    days,
    models: Object.values(models).filter(row => row.requests > 0),
    sessions,
  }
}

/**
 * Sum one Session fold's four buckets.
 * @param fold - a Session fold.
 * @returns the Session's total token count.
 */
function sumFold(fold) {
  let total = 0
  for (const row of Object.values(fold.models)) {
    for (const bucket of BUCKETS) total += row[bucket]
  }
  return total
}

/**
 * Decide whether one request must be refused before it reaches a route.
 *
 * A missing `connection` service is a refusal: without its fence any page whose
 * hostname re-resolves to 127.0.0.1 could read the Session corpus.
 *
 * @param ctx - context carrying the optional `connection` service.
 * @param req - the incoming request.
 * @returns the HTTP status to answer with, or null when the request may proceed.
 */
function rejectionOf(ctx, req) {
  let connection
  try {
    connection = ctx.get('connection')
  } catch {
    connection = undefined
  }
  if (connection === undefined || typeof connection.requestRejection !== 'function') return 403
  const rejection = connection.requestRejection(req)
  if (rejection !== undefined) return rejection
  return req.headers[GUARD_HEADER] === '1' ? null : 403
}

/**
 * Send one JSON response.
 * @param res - the response to write.
 * @param status - HTTP status code.
 * @param body - JSON-serializable body.
 */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/**
 * Install the aggregation and its HTTP routes.
 * @param ctx - the Host plugin context.
 * @param config - raw plugin config.
 */
export async function apply(ctx, config) {
  const query = ctx.get('sessionQuery')
  if (query === undefined) {
    throw new Error('usage-stats requires the sessionQuery service; mount @deepseek-ai/dsh-session-query-sqlite in the profile bundle')
  }
  const cache = new FoldCache(cachePathOf(config))
  cache.load()
  const root = join(resolveHome(), 'sessions')

  /** In-flight or recently collected summary, so a page reload is cheap. */
  let memo = null
  let pending = null
  const summary = async (force) => {
    if (!force && memo !== null && Date.now() - memo.at < SUMMARY_TTL_MS) return memo.value
    if (pending === null) {
      pending = collectSummary(query, cache, root)
        .then((value) => {
          memo = { at: Date.now(), value }
          return value
        })
        .finally(() => {
          pending = null
        })
    }
    return pending
  }
  ctx.effect(() => () => {
    memo = null
  }, 'usage-stats: summary memo')

  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => scope.webServer.register({
      kind: 'prefix',
      path: API_PATH,
      handler: async (req, res) => {
        const rejection = rejectionOf(ctx, req)
        if (rejection !== null) {
          sendJson(res, rejection, { ok: false, error: 'refused by the deployment trust fence' })
          return
        }
        const url = new URL(req.url ?? '/', 'http://localhost')
        const route = url.pathname.slice(API_PATH.length)
        try {
          if (req.method === 'GET' && route === '/api/summary') {
            sendJson(res, 200, await summary(url.searchParams.get('refresh') === '1'))
            return
          }
          sendJson(res, 404, { ok: false, error: `unknown route "${route}"` })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    }), 'usage-stats: http routes')
  })
}
