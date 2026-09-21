/**
 * The system-stats Host half at its request boundary.
 *
 * The route is the whole public surface: what the deployment's trust fence does
 * to a request before the route sees it, what a caller without the plugin's own
 * header gets, and what one accepted request answers. The readings themselves
 * come from the machine the suite runs on, so the assertions pin the payload's
 * contract — every field present, every figure of the right type — rather than
 * this machine's current load.
 *
 * Run from the repository root:
 *   node --test "plugins/dsh-system-stats/tests/*.test.mjs"
 *
 * @module dsh-system-stats/tests/host
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apply } from '../src/index.js'

/** The plugin's own request header. */
const GUARD = { 'x-dsh-system-stats': '1' }

/** A `connection` service that accepts the request's own fence. */
const ALLOWING = { requestRejection: () => undefined }

/**
 * Mount the plugin over a Host context exposing one route and one optional
 * `connection` service.
 * @param options.connection - the `connection` service, absent when omitted.
 * @param options.config - the plugin config to mount with.
 * @returns the captured route registrations.
 */
async function mount({ connection, config } = {}) {
  const routes = []
  const scope = {
    effect: (register) => register(),
    webServer: {
      register: (route) => {
        routes.push(route)
        return () => {}
      },
    },
  }
  const ctx = {
    effect: (register) => register(),
    get: (name) => (name === 'connection' ? connection : undefined),
    inject: (_names, callback) => callback(scope),
  }
  await apply(ctx, config)
  return routes
}

/**
 * Send one request through the mounted route.
 * @param routes - the captured routes.
 * @param request - method, url, and headers of the request.
 * @returns the response status and parsed body.
 */
async function send(routes, { method = 'GET', url = '/system-stats/api/metrics', headers = {} } = {}) {
  const seen = { status: 0, body: null }
  const res = {
    writeHead: (status) => { seen.status = status },
    end: (payload) => { seen.body = JSON.parse(payload) },
  }
  await routes[0].handler({ method, url, headers }, res)
  return seen
}

test('a request without the connection service is refused', async () => {
  const routes = await mount()
  const seen = await send(routes, { headers: GUARD })
  assert.equal(seen.status, 403)
  assert.equal(seen.body.ok, false)
})

test('the deployment fence decides before the route does', async () => {
  const routes = await mount({ connection: { requestRejection: () => 401 } })
  const seen = await send(routes, { headers: GUARD })
  assert.equal(seen.status, 401)
})

test('an accepted request still needs the plugin header', async () => {
  const routes = await mount({ connection: ALLOWING })
  const seen = await send(routes)
  assert.equal(seen.status, 403)
})

test('an unknown route under the prefix is a 404', async () => {
  const routes = await mount({ connection: ALLOWING })
  const seen = await send(routes, { url: '/system-stats/api/nothing', headers: GUARD })
  assert.equal(seen.status, 404)
  assert.equal(seen.body.ok, false)
})

test('an accepted request answers the machine reading', async () => {
  const routes = await mount({ connection: ALLOWING })
  const seen = await send(routes, { headers: GUARD })

  assert.equal(seen.status, 200)
  const body = seen.body
  assert.equal(body.ok, true)
  assert.equal(body.intervalMs, 3000)
  assert.equal(typeof body.at, 'number')
  assert.equal(typeof body.sampledOverMs, 'number')
  assert.ok(body.sampledOverMs > 0)

  assert.ok(body.cpu.cores > 0)
  assert.ok(body.cpu.percent === null || (body.cpu.percent >= 0 && body.cpu.percent <= 100))

  assert.ok(body.memory.totalBytes > 0)
  assert.ok(body.memory.usedBytes >= 0)
  assert.ok(body.memory.percent >= 0 && body.memory.percent <= 100)
  assert.ok(['vm_stat', 'procfs', 'os'].includes(body.memory.source))

  if (body.network !== null) {
    assert.ok(body.network.receivedBytesPerSecond >= 0)
    assert.ok(body.network.sentBytesPerSecond >= 0)
  }
})

test('a second request inside one interval serves the reading already taken', async () => {
  const routes = await mount({ connection: ALLOWING })
  const first = await send(routes, { headers: GUARD })
  const second = await send(routes, { headers: GUARD })
  assert.equal(second.body.at, first.body.at)
})

test('a configured sampling gap outside the supported range fails the mount', async () => {
  await assert.rejects(mount({ config: { intervalMs: 10 } }), /intervalMs must be a number between 500 and 60000/)
  await assert.rejects(mount({ config: { intervalMs: '3000' } }), /intervalMs must be a number between 500 and 60000/)
})
