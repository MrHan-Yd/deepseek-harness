/**
 * The panel's HTTP routes, driven against a stubbed Host.
 *
 * `webServer` matches a prefix but hands the handler the request untouched, so
 * the handler's own pathname is the whole one. This file pins that: every route
 * the page calls must reach its branch, and a request the trust fence refuses
 * must reach none of them.
 *
 * Run from the repository root:
 *   node --test "plugins/dsh-git-tools/tests/*.test.mjs"
 *
 * @module dsh-git-tools/tests/routes
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../src/index.js'

/** The directory every request in this file resolves to. */
const REPO = 'D:\\ws\\repo'

/** One git command's canned answer, in the executor's own result form. */
function commandAnswer(command, head, untracked) {
  const text = (value) => ({ exitCode: 0, stdout: { text: value }, stderr: { text: '' } })
  if (command.endsWith('rev-parse --is-inside-work-tree')) return text('true\n')
  if (command.endsWith('rev-parse --abbrev-ref HEAD')) return text(`${head}\n`)
  if (command.endsWith('branch --no-color')) return text('  dev\n* master\n  han\n')
  if (command.includes('--porcelain=v2')) {
    // `-z`: every record — the `#` headers included — ends in NUL rather than a
    // newline, which is what keeps a path unquoted.
    return text([
      '# branch.oid abcdef',
      `# branch.head ${head}`,
      '# branch.upstream origin/master',
      '# branch.ab +0 -0',
      '1 M. N... 100644 100644 100644 aaa bbb a.txt',
      ...untracked.map(path => `? ${path}`),
      '',
    ].join('\0'))
  }
  if (command.includes('diff --numstat')) return text('10\t2\ta.txt\n')
  if (command.endsWith('diff HEAD') || command.endsWith('diff --cached')) return text('+added\n-removed\n')
  return text('')
}

/**
 * Mount the plugin against a stubbed composition and reach its handler.
 * @param options - `llm: false` mounts a deployment with no model service.
 * @returns the handler, the recorded git commands, the directories, and the model calls.
 */
function mount(options = {}) {
  const commands = []
  const workdirs = []
  const calls = []
  let head = 'master'
  let registered
  const services = {
    connection: { requestRejection: () => undefined },
    agents: {
      get: (id) => (id === 'session-1'
        ? {
          session: {
            id: 'session-1',
            header: { cwd: REPO },
            requestHeader: () => ({ config: { provider: 'deepseek', model: 'deepseek-v4-flash' } }),
          },
          options: {},
        }
        : undefined),
    },
  }
  if (options.llm !== false) {
    // The composer's own pick, which must win over the last request's header.
    if (options.projection !== false) {
      services.sessionProjections = {
        stateOf: () => ({ pending: { provider: 'chosen-provider', model: 'chosen-model' }, lastUsed: null }),
      }
    }
    services.llm = {
      stream: (request) => {
        calls.push(request)
        if (options.failing === true) {
          return (async function* refused() {
            yield { type: 'finish', reason: { kind: 'error', failure: { code: 'NO_API_KEY', message: 'no API key for deepseek' } } }
          })()
        }
        if (options.capped === 'empty') {
          return (async function* spent() {
            yield { type: 'finish', reason: { kind: 'max-tokens' } }
          })()
        }
        if (options.capped === true) {
          return (async function* truncated() {
            yield { type: 'text-delta', index: 0, text: 'fix: keep the panel on the session' }
            yield { type: 'finish', reason: { kind: 'max-tokens' } }
          })()
        }
        return (async function* answer() {
          yield { type: 'text-delta', index: 0, text: ' ```\n' }
          yield { type: 'text-delta', index: 0, text: 'fix: keep the panel on the session\n' }
          yield { type: 'text-delta', index: 0, text: '``` ' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    }
  }
  const ctx = {
    inject: (names, callback) => { assert.deepEqual(names, ['webServer']); callback(ctx) },
    effect: (fn) => fn(),
    get: (name) => services[name],
    shell: {
      resolve: (request) => request,
      run: async (spec) => {
        commands.push(spec.command)
        workdirs.push(spec.workdir)
        // Switching branches changes what HEAD answers afterwards, as it does.
        const checkout = /^git checkout (?:-b )?(\S+)$/.exec(spec.command)
        if (checkout !== null) {
          head = checkout[1]
          return { exitCode: 0, stdout: { text: '' }, stderr: { text: '' } }
        }
        return commandAnswer(spec.command, head, options.untracked ?? ['b.txt'])
      },
    },
    webServer: { register: (route) => { registered = route; return () => {} } },
  }
  apply(ctx)
  assert.equal(registered.kind, 'prefix')
  assert.equal(registered.path, '/git-tools')
  return { handler: registered.handler, commands, workdirs, calls }
}

/**
 * One request, as the page sends it.
 * @param method - HTTP method.
 * @param url - the request URL.
 * @param options - an optional JSON body, and whether to omit the guard header.
 * @returns the request and the response it will be written to.
 */
function exchange(method, url, options = {}) {
  const headers = options.unguarded === true ? {} : { 'x-dsh-git-tools': '1' }
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body)
  const req = payload === undefined
    ? { method, url, headers }
    : {
      method,
      url,
      headers: { ...headers, 'content-type': 'application/json' },
      async *[Symbol.asyncIterator]() { yield Buffer.from(payload) },
    }
  const res = { status: 0, body: '' }
  res.writeHead = (status) => { res.status = status }
  res.end = (written) => { res.body = written }
  return { req, res, json: () => JSON.parse(res.body) }
}

test('the state route answers with the workspace the named Session runs in', async () => {
  const { handler, workdirs } = mount()
  const call = exchange('GET', '/git-tools/api/state?sessionId=session-1')
  await handler(call.req, call.res)

  assert.equal(call.res.status, 200, 'a route the page calls never answers 404')
  const body = call.json()
  assert.equal(body.ok, true)
  assert.equal(body.repo, true)
  assert.equal(body.branch, 'master')
  assert.deepEqual(body.branches, ['dev', 'master', 'han'], 'as git printed them, minus its markers')
  assert.equal(body.changedFiles, 2)
  assert.equal(body.insertions, 10)
  assert.equal(body.deletions, 2)
  assert.equal(body.cwd, REPO)
  assert.equal(body.upstream, 'origin/master')
  assert.equal(body.ahead, 0, 'level with its upstream, so there is nothing to push')
  assert.deepEqual([...new Set(workdirs)], [REPO], 'every command runs in that directory')
})

test('a Session the Host has not opened yet is answered as pending, never as another checkout', async () => {
  const { handler, commands } = mount()
  const call = exchange('GET', '/git-tools/api/state?sessionId=session-not-open')
  await handler(call.req, call.res)

  assert.equal(call.res.status, 200, 'still opening is not a failure')
  assert.equal(call.json().pending, true)
  assert.equal(call.json().cwd, undefined, 'no checkout is named at all')
  assert.equal(commands.length, 0, 'and nothing runs in another directory')
})

test('a mutating route refuses while its Session is still opening', async () => {
  const { handler, commands } = mount()
  const call = exchange('POST', '/git-tools/api/checkout', {
    body: { sessionId: 'session-not-open', branch: 'dev' },
  })
  await handler(call.req, call.res)

  assert.equal(call.res.status, 400)
  assert.match(call.json().error, /still opening/)
  assert.equal(commands.length, 0, 'git never runs on a guessed directory')
})

test('a new file’s lines are counted, so a tree full of new files is not read as nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-git-tools-'))
  try {
    writeFileSync(join(root, 'fresh.txt'), 'one\ntwo\nthree\n')
    writeFileSync(join(root, 'no-newline.txt'), 'only line')
    writeFileSync(join(root, 'empty.txt'), '')
    writeFileSync(join(root, 'binary.bin'), Buffer.from([1, 0, 2, 10]))
    const { handler } = mount({
      untracked: ['fresh.txt', 'no-newline.txt', 'empty.txt', 'binary.bin', 'vanished.txt'],
    })
    const call = exchange('GET', `/git-tools/api/state?cwd=${encodeURIComponent(root)}`)
    await handler(call.req, call.res)

    const body = call.json()
    assert.equal(body.repo, true)
    assert.equal(body.changedFiles, 6, 'one modified path and five git has never seen')
    // 10 lines from the tracked diff, plus 3 and 1 from the two text files. An
    // empty file, a binary one, and a path that is not there add nothing — the
    // same way `--numstat` prints `-` for a binary side.
    assert.equal(body.insertions, 14)
    assert.equal(body.deletions, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a command route reaches git through the composed shell executor', async () => {
  const { handler, commands } = mount()
  const call = exchange('POST', '/git-tools/api/checkout', { body: { sessionId: 'session-1', branch: 'dev' } })
  await handler(call.req, call.res)

  assert.equal(call.res.status, 200)
  assert.equal(call.json().branch, 'dev', 'the state comes back as it now is')
  assert.ok(commands.includes('git checkout dev'), `checked out through the shell: ${commands.join(', ')}`)
})

test('the message route writes with the Session’s own model over the pending change', async () => {
  const { handler, commands, calls } = mount()
  const call = exchange('POST', '/git-tools/api/message', { body: { sessionId: 'session-1', stageAll: true } })
  await handler(call.req, call.res)

  assert.equal(call.res.status, 200)
  assert.equal(call.json().message, 'fix: keep the panel on the session', 'the fences and padding are stripped')

  assert.equal(calls.length, 1, 'one model call, not a turn')
  assert.equal(calls[0].provider, 'chosen-provider', 'the Session’s own selection wins over its last request')
  assert.equal(calls[0].model, 'chosen-model')
  assert.equal(calls[0].sessionId, 'session-1', 'the call is stamped with the Session it speaks for')
  assert.equal(calls[0].purpose, undefined, 'a commit message is an ordinary call, not a compaction')
  assert.equal(calls[0].tools, undefined, 'it cannot run anything')
  assert.equal(calls[0].messages.length, 1)
  assert.ok(calls[0].messages[0].content[0].text.includes('+added'), 'the prompt carries the diff')
  assert.ok(calls[0].messages[0].content[0].text.includes('master'), 'and the branch it is on')
  assert.ok(commands.includes('git diff HEAD'), 'reading everything the commit would take')
})

test('the message is asked for in the panel’s language, as a conventional commit', async () => {
  const chinese = mount()
  const zh = exchange('POST', '/git-tools/api/message', { body: { sessionId: 'session-1', locale: 'zh-CN' } })
  await chinese.handler(zh.req, zh.res)

  const prompt = chinese.calls[0].system
  assert.ok(prompt.includes('简体中文'), 'written in the language the panel is showing')
  assert.ok(prompt.includes('Conventional Commits'), 'in the commit convention, not free prose')
  for (const type of ['feat', 'fix', 'refactor', 'chore', 'revert']) {
    assert.ok(prompt.includes(type), `${type} is one of the offered types`)
  }

  const english = mount()
  const en = exchange('POST', '/git-tools/api/message', { body: { sessionId: 'session-1', locale: 'en' } })
  await english.handler(en.req, en.res)
  assert.ok(english.calls[0].system.includes('in English'))
  assert.equal(english.calls[0].system.includes('简体中文'), false, 'one language per call')
})

test('a locale tag that is not one is refused', async () => {
  const { handler, calls } = mount()
  const call = exchange('POST', '/git-tools/api/message', {
    body: { sessionId: 'session-1', locale: 'x'.repeat(64) },
  })
  await handler(call.req, call.res)

  assert.equal(call.res.status, 400)
  assert.match(call.json().error, /locale tag/)
  assert.equal(calls.length, 0, 'and no model call is spent on it')
})

test('a message for the index alone diffs what is staged', async () => {
  const { handler, commands } = mount()
  const call = exchange('POST', '/git-tools/api/message', { body: { sessionId: 'session-1', stageAll: false } })
  await handler(call.req, call.res)

  assert.equal(call.res.status, 200)
  assert.ok(commands.includes('git diff --cached'), 'the staged change is what would be committed')
  assert.equal(commands.includes('git diff HEAD'), false)
})

test('without a Session selection the model is the one the Session last used', async () => {
  const { handler, calls } = mount({ projection: false })
  const call = exchange('POST', '/git-tools/api/message', { body: { sessionId: 'session-1' } })
  await handler(call.req, call.res)

  assert.equal(call.res.status, 200)
  assert.equal(calls[0].provider, 'deepseek')
  assert.equal(calls[0].model, 'deepseek-v4-flash', 'the model that made the Session’s last request')
})

test('a deployment with no model service says so instead of committing nothing', async () => {
  const { handler, commands } = mount({ llm: false })
  const call = exchange('POST', '/git-tools/api/message', { body: { sessionId: 'session-1' } })
  await handler(call.req, call.res)

  assert.equal(call.res.status, 400)
  assert.match(call.json().error, /no model service/)
  assert.equal(commands.length, 0, 'and no git command runs for it')
})

test('a model failure is reported with the provider’s own words, not an empty message', async () => {
  const { handler } = mount({ failing: true })
  const call = exchange('POST', '/git-tools/api/message', { body: { sessionId: 'session-1' } })
  await handler(call.req, call.res)

  assert.equal(call.res.status, 400)
  assert.equal(call.json().error, 'no API key for deepseek')
})

test('a truncated answer is still used, and only an empty one is an error', async () => {
  const { handler: truncatedHandler } = mount({ capped: true })
  const written = exchange('POST', '/git-tools/api/message', { body: { sessionId: 'session-1' } })
  await truncatedHandler(written.req, written.res)
  assert.equal(written.res.status, 200, 'a model that ran out of budget still wrote a draft')
  assert.equal(written.json().message, 'fix: keep the panel on the session')

  const { handler: emptyHandler } = mount({ capped: 'empty' })
  const nothing = exchange('POST', '/git-tools/api/message', { body: { sessionId: 'session-1' } })
  await emptyHandler(nothing.req, nothing.res)
  assert.equal(nothing.res.status, 400)
  assert.match(nothing.json().error, /output cap/)
})

test('no command this plugin builds carries shell syntax', async () => {
  const { handler, commands } = mount()
  // Every read route, then a write, so the command set is the whole surface.
  for (const [url, body] of [
    ['/git-tools/api/state?sessionId=session-1', undefined],
    ['/git-tools/api/checkout', { sessionId: 'session-1', branch: 'dev' }],
    ['/git-tools/api/create-branch', { sessionId: 'session-1', branch: 'feature/x' }],
    ['/git-tools/api/message', { sessionId: 'session-1' }],
    ['/git-tools/api/commit', { sessionId: 'session-1', message: 'fix: it' }],
    ['/git-tools/api/push', { sessionId: 'session-1' }],
  ]) {
    const call = exchange(body === undefined ? 'GET' : 'POST', url, body === undefined ? {} : { body })
    await handler(call.req, call.res)
    assert.ok(call.res.status < 400, `${url} answered ${String(call.res.status)}`)
  }

  assert.ok(commands.length > 5, 'the surface ran a real command set')
  for (const command of commands) {
    // The executor runs these through a shell, so a `%`, a parenthesis, a
    // substitution, or a separator inside an argument would be read as syntax.
    // The one quoted path `git commit -F <file>` is allowed to carry quotes.
    assert.doesNotMatch(command, /[%()$`;|&<>*?!]/u, `${command} carries no shell syntax`)
    assert.equal(command.includes('\n'), false, `${command} is one line`)
  }
})

test('a request without the guard header is refused before any git runs', async () => {
  const { handler, commands } = mount()
  const call = exchange('GET', '/git-tools/api/state?sessionId=session-1', { unguarded: true })
  await handler(call.req, call.res)

  assert.equal(call.res.status, 403)
  assert.equal(commands.length, 0, 'the fence is not a formality')
})

test('an unknown route below the prefix is a 404, not a git command', async () => {
  const { handler, commands } = mount()
  const call = exchange('GET', '/git-tools/api/nothing')
  await handler(call.req, call.res)

  assert.equal(call.res.status, 404)
  assert.equal(commands.length, 0)
})
