/**
 * dsh-system-stats — live CPU, memory, and network readings for the Host machine.
 *
 * The browser shows these three figures under the composer, next to the Session
 * statistics the chat page already draws there. They describe the machine this
 * Host process runs on, not the Session: how much CPU the machine is using, how
 * much memory is in use, and how many bytes per second its interfaces are
 * moving. Nothing here is per-Session accounting, so nothing here is stored:
 * a reading answers one request and is replaced by the next.
 *
 * A reading costs one `node:os` sample plus, on macOS, `vm_stat` and
 * `netstat -ibn`. Nothing samples on a timer: the Host reads the machine only
 * when the page asks, at most once per `intervalMs`, so a closed page costs a
 * machine nothing at all. The first request after a long quiet period re-baselines
 * and measures a short sweep window instead of reporting an average over hours
 * of idling.
 *
 * Security has one home: the `connection` service's `requestRejection` applies
 * DSH's own Host/Origin/Fetch-Metadata fence plus browser login-token
 * authentication, exactly as `dsh-usage-stats` and `dsh-git-tools` do. A missing
 * service is a refusal, never a pass. The `x-dsh-system-stats` header stays as a
 * second, cheaper layer: a cross-origin page cannot set it without a preflight
 * this server never grants.
 *
 * Function plugin: named exports and no default export, so the Loader keeps the
 * namespace.
 *
 * @module dsh-system-stats
 */

import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { cpus, freemem, platform, totalmem } from 'node:os'
import {
  availableBytesOfVmStat, cpuPercentOf, cpuSnapshot, parseNetstatDarwin, parseProcMeminfo,
  parseProcNetDev, parseVmStat, percentOf, ratesOf,
} from './metrics.js'

export const name = 'system-stats'

/** Route prefix owned by this plugin. */
const API_PATH = '/system-stats'

/** Request header a cross-origin page cannot set without a granted preflight. */
const GUARD_HEADER = 'x-dsh-system-stats'

/** Gap between two samples when the composition configures none. */
const DEFAULT_INTERVAL_MS = 3000

/** Shortest configurable gap: below this a sample window says more about noise than load. */
const MIN_INTERVAL_MS = 500

/** Longest configurable gap: beyond this a reading is stale before the next one lands. */
const MAX_INTERVAL_MS = 60_000

/** Age at which a stored reading stops describing the current load. */
const STALE_READING_MS = 30_000

/** Window measured when no recent reading can serve as the difference's predecessor. */
const SWEEP_MS = 250

/** Deadline for one counter-reading command. */
const COMMAND_TIMEOUT_MS = 2000

/** Output cap for one counter-reading command, in bytes. */
const COMMAND_OUTPUT_MAX_BYTES = 1024 * 1024

/**
 * Resolve the configured sampling gap, refusing a value the page could not
 * follow rather than substituting a default the deployment did not ask for.
 *
 * @param config - raw plugin config.
 * @returns the gap between two samples, in milliseconds.
 */
function resolveInterval(config) {
  const configured = config?.intervalMs
  if (configured === undefined) return DEFAULT_INTERVAL_MS
  if (typeof configured !== 'number' || !Number.isFinite(configured) || configured < MIN_INTERVAL_MS || configured > MAX_INTERVAL_MS) {
    throw new Error(`system-stats: intervalMs must be a number between ${MIN_INTERVAL_MS} and ${MAX_INTERVAL_MS}, received ${JSON.stringify(configured)}`)
  }
  return configured
}

/**
 * Wait for a bounded window.
 * @param ms - milliseconds to wait.
 * @returns a promise settling after the window.
 */
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Run one counter-reading command.
 * @param command - the executable's name.
 * @param args - its arguments.
 * @returns the command's standard output, or null when it failed or timed out.
 */
function run(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: COMMAND_TIMEOUT_MS, maxBuffer: COMMAND_OUTPUT_MAX_BYTES }, (error, stdout) => {
      resolve(error === null ? stdout : null)
    })
  })
}

/**
 * Read a kernel counter file.
 * @param path - the file's absolute path.
 * @returns the file's contents, or null when it cannot be read.
 */
function readText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    // The caller has a portable fallback for every file read here, so an
    // unreadable counter file costs precision, not the reading.
    return null
  }
}

/**
 * Read physical memory in use on this platform.
 *
 * macOS `os.freemem()` counts only free pages, which reports a machine with a
 * full file cache as almost out of memory; `vm_stat` separates reclaimable pages
 * from memory in use, so it is preferred there. Linux is read from
 * `/proc/meminfo`, whose `MemAvailable` is the kernel's own answer. Every other
 * platform, and every failed read, falls back to the portable figure.
 *
 * @param osPlatform - `node:os` platform name.
 * @returns total bytes, bytes available to new allocations, and the reader used.
 */
async function readMemory(osPlatform) {
  const totalBytes = totalmem()
  if (osPlatform === 'darwin') {
    const text = await run('vm_stat', [])
    const availableBytes = text === null ? null : availableBytesOfVmStat(parseVmStat(text))
    if (availableBytes !== null) return { totalBytes, availableBytes, source: 'vm_stat' }
  }
  if (osPlatform === 'linux') {
    const text = readText('/proc/meminfo')
    if (text !== null) {
      const parsed = parseProcMeminfo(text)
      if (parsed.availableBytes !== null) {
        return { totalBytes: parsed.totalBytes ?? totalBytes, availableBytes: parsed.availableBytes, source: 'procfs' }
      }
    }
  }
  return { totalBytes, availableBytes: freemem(), source: 'os' }
}

/**
 * Read the byte counters of this machine's interfaces.
 *
 * @param osPlatform - `node:os` platform name.
 * @returns received and sent bytes over the non-loopback interfaces, or null on
 * a platform with no reader here.
 */
async function readNetwork(osPlatform) {
  if (osPlatform === 'linux') {
    const text = readText('/proc/net/dev')
    return text === null ? null : parseProcNetDev(text)
  }
  if (osPlatform === 'darwin') {
    const text = await run('netstat', ['-ibn'])
    return text === null ? null : parseNetstatDarwin(text)
  }
  return null
}

/**
 * Turn one memory reading into the figures the page shows.
 * @param reading - a `readMemory` reading.
 * @returns total and used bytes with the used share.
 */
function memoryOf(reading) {
  const usedBytes = Math.max(0, reading.totalBytes - reading.availableBytes)
  return {
    totalBytes: reading.totalBytes,
    usedBytes,
    percent: percentOf(usedBytes, reading.totalBytes),
  }
}

/**
 * Create the reader that turns two counter readings into current load.
 *
 * The first call stores a reading and returns figures measured over a short
 * sweep instead of answering null, so opening the page shows a real reading
 * immediately; later calls answer over the window since the previous call.
 *
 * @returns a reader whose `read()` resolves to the current reading.
 */
function createSampler() {
  const osPlatform = platform()
  let previous = null

  const take = async () => {
    const at = Date.now()
    const cpu = cpuSnapshot(cpus())
    const memory = await readMemory(osPlatform)
    const network = await readNetwork(osPlatform)
    return { at, cpu, memory, network }
  }

  return {
    async read() {
      if (previous === null || Date.now() - previous.at > STALE_READING_MS) {
        previous = await take()
        await delay(SWEEP_MS)
      }
      const next = await take()
      const elapsedMs = next.at - previous.at
      const reading = {
        at: next.at,
        sampledOverMs: elapsedMs,
        cpu: { percent: cpuPercentOf(previous.cpu, next.cpu), cores: next.cpu.length },
        memory: { ...memoryOf(next.memory), source: next.memory.source },
        network: previous.network === null || next.network === null
          ? null
          : ratesOf(previous.network, next.network, elapsedMs),
      }
      previous = next
      return reading
    },
  }
}

/**
 * Decide whether one request must be refused before it reaches a route.
 *
 * A missing `connection` service is a refusal: without its fence any page whose
 * hostname re-resolves to 127.0.0.1 could read this machine's load.
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
 * Install the sampler and its HTTP route.
 * @param ctx - the Host plugin context.
 * @param config - raw plugin config.
 */
export async function apply(ctx, config) {
  const intervalMs = resolveInterval(config)
  const sampler = createSampler()

  /** Newest reading, so a page reload inside one interval costs no new sample. */
  let memo = null
  /** In-flight reading, so concurrent requests share one sample. */
  let pending = null
  const metrics = () => {
    if (memo !== null && Date.now() - memo.at < intervalMs) return Promise.resolve(memo.value)
    if (pending === null) {
      pending = sampler.read()
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
  }, 'system-stats: metrics memo')

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
          if (req.method === 'GET' && route === '/api/metrics') {
            sendJson(res, 200, { ok: true, intervalMs, ...(await metrics()) })
            return
          }
          sendJson(res, 404, { ok: false, error: `unknown route "${route}"` })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    }), 'system-stats: http routes')
  })
}
