/**
 * dsh-git-tools — a git branch and commit/push panel for the workspace the
 * person is currently working in.
 *
 * The browser half renders one floating entry at the frame's top-right; this
 * half answers it over a same-origin HTTP API and runs the commands through the
 * composition's own `shell` service, so a command is confined by whatever
 * sandbox mode the deployment is in (a `read-only` session cannot commit) and
 * appears in the Host's own command execution rather than beside it.
 *
 * What the panel can do is deliberately narrow: read the state, switch to an
 * existing branch, commit (optionally staging every change first), and push.
 * Publishing history is the person's own click, never a model action.
 *
 * Function plugin: named exports and no default export, so the Loader keeps the
 * namespace.
 *
 * @module dsh-git-tools
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  capText, isAbsolutePath, isValidBranch, parseBranch, parseBranches, parseNumstat, parseStatus,
  quoteArg, requireMessage,
} from './git.js'

export const name = 'git-tools'

/** Hard service: every command runs through the composed shell executor. */
export const inject = ['shell']

/** Route prefix owned by this plugin. */
const API_PATH = '/git-tools/api'

/** Request header a cross-origin page cannot set without a granted preflight. */
const GUARD_HEADER = 'x-dsh-git-tools'

/** Cap on one request body, in bytes. */
const MAX_BODY_BYTES = 64 * 1024

/** Deadline for one git command, in milliseconds. */
const GIT_TIMEOUT_MS = 60_000

/** Cap on one command's captured standard output, in bytes. */
const GIT_STDOUT_MAX_BYTES = 256 * 1024

/** Cap on the text one response carries back to the page. */
const GIT_TEXT_LIMIT = 4000

/**
 * Cap on the text one state read keeps, in characters.
 *
 * The state is summed rather than shown, so the response's own cap would cut
 * the tally short — silently, and on exactly the large working trees where a
 * tally is worth reading. It is set at the byte cap the executor already
 * applies, which is the real limit.
 */
const GIT_STATE_TEXT_LIMIT = GIT_STDOUT_MAX_BYTES

/**
 * Largest new file whose lines are counted, in bytes.
 *
 * A file this big is treated the way git treats a binary one — as adding no
 * lines — rather than read into memory to be counted.
 */
const UNTRACKED_FILE_MAX_BYTES = 8 * 1024 * 1024

/** Deadline for the one model call that writes a commit message, in milliseconds. */
const MESSAGE_TIMEOUT_MS = 90_000

/**
 * Output cap for that call, in tokens.
 *
 * The cap covers everything the model emits for the call, including the
 * reasoning a thinking model produces before its answer: the panel does not want
 * that text, but it spends the same budget. So the cap is generous enough that a
 * commit message is never what runs out first.
 */
const MESSAGE_MAX_TOKENS = 4096

/** Cap on the diff text carried into that call's prompt. */
const DIFF_TEXT_LIMIT = 12_000

/** Cap on the accepted message, in characters. */
const MESSAGE_TEXT_LIMIT = 2000

/** Cap on the locale tag one request may carry. */
const LOCALE_LIMIT = 32

/**
 * What the model is asked for, in the language the panel is showing.
 *
 * The message is committed prose that the person reads for years, so it is
 * written in the language they are working in rather than in whichever one this
 * prompt happens to be written in. The type prefix stays English because that is
 * what the convention names.
 *
 * @param locale - the panel's locale tag, as the page reported it.
 * @returns the system prompt for the call.
 */
function messageSystem(locale) {
  const chinese = String(locale ?? '').toLowerCase().startsWith('zh')
  if (chinese) {
    return [
      '你在为一个工作区里已经改好的内容写一条 git 提交信息，用简体中文。',
      '只回答提交信息本身：不要代码块、不要引号、不要解释、不要任何前言。',
      '使用 Conventional Commits 格式：类型(可选范围): 主题。',
      '类型只能从 feat、fix、docs、style、refactor、perf、test、build、ci、chore、revert 里选最贴切的一个。',
      '格式示例：feat(范围): 用中文说清楚改了什么。',
      '主题不超过 50 个字，用祈使语气，结尾不加句号。',
      '需要时在空行之后补一段正文说明原因，每行不超过 72 个字符。',
    ].join(' ')
  }
  return [
    'You write the commit message for one working tree, in English.',
    'Answer with the message alone: no code fences, no quotes, no explanation, no preamble.',
    'Use the Conventional Commits form: type(optional scope): subject.',
    'The type is whichever of feat, fix, docs, style, refactor, perf, test, build, ci, chore, or revert fits best.',
    'Example form: feat(scope): say what changed.',
    'The subject is at most 50 characters, imperative, with no trailing period.',
    'Add a short body after a blank line only when the change needs one, each line under 72 characters.',
  ].join(' ')
}

/**
 * Run one git command in one directory.
 *
 * A read passes `readOnly`: it asks for the `read-only` sandbox policy and
 * turns off git's optional index refresh. That policy is the one confined mode
 * whose backend needs no directory grant — the Windows ACL runner only edits an
 * ACL for `workspace-write` — so the page's reads work on every workspace,
 * including one whose ACL omits the owner's `WRITE_OWNER`. Without
 * `GIT_OPTIONAL_LOCKS=0` the read would try to write `.git/index` and be
 * refused by the same policy that makes it portable.
 *
 * A write leaves `sandboxPolicy` unset: the executor applies the deployment's
 * own mode, which is what makes a `read-only` setting mean what it says here
 * too. A denial therefore comes back as a failure with git's or the sandbox's
 * own words, not as a silently different outcome.
 *
 * @param ctx - plugin context carrying `shell`.
 * @param cwd - the workspace directory to run in.
 * @param args - the arguments, already validated by this module's helpers.
 * @param limit - characters of output this read keeps; a read whose output is
 * summed rather than shown passes {@link GIT_STATE_TEXT_LIMIT}.
 * @param readOnly - whether the command only reads the repository.
 * @returns the outcome the page reports.
 */
async function runGit(ctx, cwd, args, limit = GIT_TEXT_LIMIT, readOnly = false) {
  const request = {
    command: `git ${args.join(' ')}`,
    workdir: cwd,
    timeoutMs: GIT_TIMEOUT_MS,
    stdoutMaxBytes: GIT_STDOUT_MAX_BYTES,
  }
  if (readOnly) {
    request.env = { GIT_OPTIONAL_LOCKS: '0' }
    const policy = readOnlyPolicy(ctx)
    if (policy !== undefined) request.sandboxPolicy = policy
  }
  const spec = ctx.shell.resolve(request)
  const execution = await ctx.shell.execute(spec)
  const result = await execution.result()
  return {
    exitCode: result.exitCode,
    timedOut: result.timedOut === true,
    denied: result.sandbox?.denied === true,
    stdout: capText(result.stdout?.text, GIT_TEXT_LIMIT),
    stderr: capText(result.stderr?.text, GIT_TEXT_LIMIT),
  }
}

/**
 * Run one git query that does not write to the repository.
 * @param ctx - plugin context carrying `shell`.
 * @param cwd - the workspace directory to run in.
 * @param args - the arguments, already validated by this module's helpers.
 * @param limit - characters of output this read keeps.
 * @returns the outcome the page reports.
 */
function runGitRead(ctx, cwd, args, limit = GIT_TEXT_LIMIT) {
  return runGit(ctx, cwd, args, limit, true)
}

/**
 * The deployment's read-only policy, or `undefined` where no policy service is
 * mounted. A deployment that mounts one still owns the workspace root and the
 * session identity, so the mode is the only field this plugin chooses.
 * @param ctx - plugin context.
 * @returns the resolved read-only policy, when the deployment supplies policies.
 */
function readOnlyPolicy(ctx) {
  let policy
  try {
    policy = ctx.get('sandboxPolicy')?.resolve({ mode: 'read-only' })
  } catch {
    policy = undefined
  }
  return policy
}

/**
 * Throw on a command that did not succeed, quoting what it said.
 * @param result - the outcome of {@link runGit}.
 * @param what - the operation name for the message.
 * @returns the result, when it succeeded.
 */
function assertOk(result, what) {
  if (result.exitCode === 0) return result
  const reason = result.denied
    ? 'the sandbox refused the command'
    : result.timedOut
      ? `git ${what} timed out`
      : failureText(result, what)
  throw new Error(reason)
}

/**
 * What to tell the page about a git command that failed.
 *
 * Git for Windows runs every hook through its own `sh.exe`, and a sandboxed
 * process is given no signal pipe — so MSYS dies before the hook body runs and
 * git reports its crash instead: a failing directory plus a stack trace several
 * dozen lines long, none of which names the commit. That text is replaced by
 * what actually happened, because the raw dump is unreadable in a dialog and
 * says nothing a person can act on.
 *
 * @param result - the outcome of {@link runGit}.
 * @param what - the operation name for the message.
 * @returns the reason to report.
 */
function failureText(result, what) {
  const said = `${result.stderr}\n${result.stdout}`
  if (/couldn't create signal pipe|cygheap_user::init/u.test(said)) {
    return `git ${what} could not run this repository's hooks: the sandbox blocks Git's own sh.exe. `
      + 'Commit from a session whose permission mode allows it, or skip the hooks.'
  }
  return result.stderr.trim() || result.stdout.trim() || `git ${what} exited ${String(result.exitCode)}`
}

/**
 * Count the lines an untracked file adds.
 *
 * `--numstat` only reports paths git already tracks, so a working tree whose
 * changes are mostly new files reads as almost nothing — the one case a tally is
 * consulted for. The last line of a file counts whether or not it ends in a
 * newline, which is how git counts an added file.
 *
 * A file git would call binary carries a NUL byte and counts as no lines, the
 * way `--numstat` prints `-` for one, and a file past the size cap is skipped
 * rather than read into memory.
 *
 * @param cwd - the directory the untracked paths are relative to.
 * @param paths - the untracked paths git reported.
 * @returns the lines they add in total.
 */
function countUntrackedLines(cwd, paths) {
  let lines = 0
  for (const path of paths) {
    const absolute = join(cwd, path)
    try {
      const stats = statSync(absolute)
      if (!stats.isFile() || stats.size > UNTRACKED_FILE_MAX_BYTES) continue
      const content = readFileSync(absolute)
      if (content.includes(0)) continue
      let newlines = 0
      for (const byte of content) if (byte === 10) newlines += 1
      lines += content.length > 0 && content[content.length - 1] !== 10 ? newlines + 1 : newlines
    } catch {
      // A path that vanished between git's read and this one adds nothing.
    }
  }
  return lines
}

/**
 * Read one workspace's git state.
 *
 * Four commands, no more: one to learn whether this is a repository at all, then
 * one round in parallel — `status --porcelain=v2 --branch -z` answers the
 * branch, its upstream, the unpushed count, how many paths changed, and which
 * are untracked, so no separate `rev-parse --abbrev-ref HEAD` or plain `status`
 * is needed. Every command is a process spawn on the Host, and this read runs
 * again on every Session switch.
 *
 * @param ctx - plugin context carrying `shell`.
 * @param cwd - the workspace directory.
 * @returns the state the panel renders.
 */
async function readState(ctx, cwd) {
  const inside = await runGitRead(ctx, cwd, ['rev-parse', '--is-inside-work-tree'])
  if (inside.exitCode !== 0) {
    return {
      cwd, repo: false, branch: null, branches: [], changedFiles: 0, insertions: 0, deletions: 0,
      upstream: null, ahead: null,
    }
  }
  const [refs, status, numstat] = await Promise.all([
    // `git branch`, not `for-each-ref --format=%(...)`: the executor runs the
    // command through a shell, and a format string carrying `%` and parentheses
    // is shell syntax there. A branch name is all this read needs.
    runGitRead(ctx, cwd, ['branch', '--no-color']),
    // `-uall` because the default collapses an untracked directory into one
    // record: that record names a directory, not a file to open and count, and
    // its lines would be lost. `-z` keeps a non-ASCII path unquoted, which is
    // what makes it a path the count below can open.
    runGitRead(ctx, cwd, ['status', '--porcelain=v2', '--branch', '-z', '-uall'], GIT_STATE_TEXT_LIMIT),
    // Against HEAD, so a staged change and an unstaged one each count once.
    runGitRead(ctx, cwd, ['diff', '--numstat', 'HEAD'], GIT_STATE_TEXT_LIMIT),
  ])
  // A repository with no commits yet has no HEAD to diff against, and no
  // tracked change to report either; its new files are counted as untracked.
  const lines = numstat.exitCode === 0 ? parseNumstat(numstat.stdout) : { insertions: 0, deletions: 0 }
  const parsed = parseStatus(status.stdout)
  return {
    cwd,
    repo: true,
    branch: parsed.branch,
    branches: parseBranches(refs.stdout),
    changedFiles: parsed.changed,
    // A new file is in no diff, so its lines are counted here. File count and
    // line count therefore rest on the same set of paths.
    insertions: lines.insertions + countUntrackedLines(cwd, parsed.untracked),
    deletions: lines.deletions,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
  }
}

/**
 * Commit the working tree, staging everything first when asked.
 *
 * The message goes to a file and reaches git as `-F <file>`: a message is free
 * text, and this way no part of it is ever parsed as command syntax.
 *
 * `skipHooks` adds `--no-verify`, the only way to commit a repository whose hooks
 * cannot start — Git for Windows runs every hook through its own `sh.exe`, which
 * a confined sandbox on that platform will not let start. The page asks for it
 * explicitly and says what it costs, because the hooks are the repository's own
 * gates and this is the caller's decision, not a fallback.
 *
 * @param ctx - plugin context carrying `shell`.
 * @param cwd - the workspace directory.
 * @param message - the commit message.
 * @param stageAll - whether to stage every change first.
 * @param skipHooks - whether to commit with `--no-verify`.
 * @returns the commit command's outcome.
 */
async function commit(ctx, cwd, message, stageAll, skipHooks) {
  if (stageAll) assertOk(await runGit(ctx, cwd, ['add', '-A']), 'add')
  const file = join(tmpdir(), `dsh-git-tools-${process.pid}-${randomBytes(6).toString('hex')}`)
  writeFileSync(file, message, { encoding: 'utf8', mode: 0o600 })
  try {
    const args = ['commit', ...skipHooks ? ['--no-verify'] : [], '-F', quoteArg(file)]
    return assertOk(await runGit(ctx, cwd, args), 'commit')
  } finally {
    rmSync(file, { force: true })
  }
}

/**
 * The model one Session is using.
 *
 * The Session's own choice comes first — the selection the composer shows, then
 * the header of its last request — because "write the message" should sound like
 * the conversation it belongs to. Only then does this fall back to the Agent's
 * configured route and the deployment default, which is what a Session that has
 * never made a request has.
 *
 * @param ctx - plugin context carrying the optional `sessionProjections` and `agentDefaultModel`.
 * @param agent - the Session's live Agent, when there is one.
 * @returns the provider, model, and reasoning effort to call.
 * @throws when nothing on this Host names a model.
 */
function modelTarget(ctx, agent) {
  const session = agent?.session
  const projection = session === undefined
    ? undefined
    : service(ctx, 'sessionProjections')?.stateOf?.(session, 'modelSelection')
  const picked = projection?.pending ?? projection?.lastUsed
  if (typeof picked?.provider === 'string' && typeof picked.model === 'string') return picked

  const logged = session?.requestHeader?.()?.config
  if (typeof logged?.provider === 'string' && typeof logged.model === 'string') {
    return { provider: logged.provider, model: logged.model, reasoningEffort: logged.reasoningEffort }
  }
  const options = agent?.options
  if (typeof options?.provider === 'string' && typeof options.model === 'string') {
    return { provider: options.provider, model: options.model, reasoningEffort: options.reasoningEffort }
  }
  const fallback = service(ctx, 'agentDefaultModel')?.currentSelection?.()
  if (typeof fallback?.provider === 'string' && typeof fallback.model === 'string') return fallback
  throw new Error('this Session has no model to write a commit message with')
}

/**
 * Reduce a model reply to the commit message inside it.
 * @param text - the model's raw text.
 * @returns the message, without fences, quotes, or a leading label.
 */
function cleanMessage(text) {
  let value = String(text ?? '').trim()
  const fenced = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/u.exec(value)
  if (fenced !== null) value = fenced[1].trim()
  value = value.replace(/^(?:commit message|提交信息)\s*[:：]\s*/iu, '').trim()
  const quoted = /^(["“'])([\s\S]*)(["”'])$/u.exec(value)
  if (quoted !== null && quoted[1] === quoted[3]) value = quoted[2].trim()
  return capText(value, MESSAGE_TEXT_LIMIT)
}

/**
 * Ask the Session's own model for one commit message.
 *
 * The call is a one-shot stream with no tools and its own system prompt, so it
 * cannot run a turn: it reads the working tree, answers, and stops. When it
 * fails, the failure is the report — no message is invented here.
 *
 * @param ctx - plugin context carrying `shell` and the optional `llm`.
 * @param request - `{ cwd?, sessionId?, stageAll? }` as the page sent them.
 * @returns the commit message.
 */
async function generateMessage(ctx, request) {
  const llm = service(ctx, 'llm')
  if (llm === undefined || typeof llm.stream !== 'function') {
    throw new Error('this deployment has no model service to write a commit message with')
  }
  if (typeof request?.locale === 'string' && request.locale.length > LOCALE_LIMIT) {
    throw new Error('the locale tag in this request is too long to be one')
  }
  const cwd = requiredCwd(ctx, request)
  const agent = agentFor(ctx, request)
  const target = modelTarget(ctx, agent)
  const stageAll = request?.stageAll === true
  const [head, status, diff] = await Promise.all([
    runGitRead(ctx, cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGitRead(ctx, cwd, ['status', '--porcelain']),
    // The same range the commit will use: everything, or the index alone.
    runGitRead(ctx, cwd, stageAll ? ['diff', 'HEAD'] : ['diff', '--cached']),
  ])
  const prompt = [
    `Branch: ${parseBranch(head.stdout) ?? '(unborn)'}`,
    'Changed files:',
    capText(status.stdout, GIT_TEXT_LIMIT).trim() || '(none reported)',
    '',
    'Diff:',
    capText(diff.stdout, DIFF_TEXT_LIMIT).trim() || '(no diff text)',
  ].join('\n')

  let text = ''
  let finish
  const options = {
    provider: target.provider,
    model: target.model,
    ...(target.reasoningEffort === undefined ? {} : { reasoningEffort: target.reasoningEffort }),
    system: messageSystem(request?.locale),
    messages: [{
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'plugin', plugin: 'dsh-git-tools' },
    }],
    maxTokens: MESSAGE_MAX_TOKENS,
    ...(agent === undefined ? {} : { sessionId: agent.session.id }),
    signal: AbortSignal.timeout(MESSAGE_TIMEOUT_MS),
  }
  // A provider failure arrives as the stream's terminal chunk, not as a throw.
  for await (const chunk of llm.stream(options)) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
    else if (chunk?.type === 'finish') finish = chunk.reason
  }
  if (finish?.kind === 'error' || finish?.kind === 'aborted') {
    const failure = finish.failure
    throw new Error(failure?.message ?? `the model call failed (${String(failure?.code ?? finish.kind)})`)
  }

  // A truncated answer is still an answer: whatever the model wrote before it
  // ran out is a draft the person can see and edit in the box.
  const message = cleanMessage(text)
  if (message !== '') return message
  if (finish?.kind === 'max-tokens') throw new Error('the model hit the output cap before it wrote anything')
  throw new Error('the model answered with no commit message')
}

/**
 * Read one request body with a size cap.
 * @param req - the incoming request.
 * @returns the parsed JSON body.
 */
async function readJson(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (total === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Reject a request the composition's trust fence refuses.
 *
 * Security has one home: the `connection` service's `requestRejection` applies
 * DSH's own Host/Origin/Fetch-Metadata fence — which is what defeats DNS
 * rebinding — plus its browser login-token authentication. A route registered
 * through `ctx.webServer.register` receives neither automatically; only the RPC
 * bridge does. Without the fence this API would let any page whose hostname
 * re-resolves to 127.0.0.1 run git in a directory of its choosing, which
 * includes running a hook. A missing service is therefore a refusal, never a
 * pass.
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
 * The workspace directory one Agent's Session runs in.
 * @param agent - a live Agent, or undefined.
 * @returns its absolute directory, or undefined.
 */
function cwdOfAgent(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
}

/**
 * Read one optional service without declaring a hard dependency on it.
 * @param ctx - plugin context.
 * @param name - service name.
 * @returns the service, or undefined when this composition provides none.
 */
function service(ctx, name) {
  try {
    return ctx.get(name)
  } catch {
    return undefined
  }
}

/**
 * The most recently created live Agent that names a directory.
 * @param ctx - plugin context carrying the optional `agents` service.
 * @returns that Agent, or undefined.
 */
function newestLiveAgent(ctx) {
  const agents = service(ctx, 'agents')
  return (typeof agents?.list === 'function' ? agents.list() : [])
    .map(agent => ({ agent, createdAt: Number(agent?.session?.header?.createdAt ?? 0) }))
    .filter(row => cwdOfAgent(row.agent) !== undefined)
    .sort((left, right) => right.createdAt - left.createdAt)[0]?.agent
}

/**
 * The Agent a request speaks for.
 *
 * A named Session with no live Agent resolves to nothing rather than to a
 * neighbour. Every number this panel shows belongs to one checkout, so answering
 * with another Session's Agent would put the wrong directory behind the name the
 * page asked about; the caller reports "not open yet" instead.
 *
 * @param ctx - plugin context carrying the optional `agents` service.
 * @param request - `{ sessionId? }` as the page sent it.
 * @returns the named Agent, or undefined.
 */
function agentFor(ctx, request) {
  const sessionId = typeof request?.sessionId === 'string' ? request.sessionId.trim() : ''
  if (sessionId === '') return newestLiveAgent(ctx)
  return service(ctx, 'agents')?.get?.(sessionId)
}

/**
 * Resolve the directory the panel acts on.
 *
 * The browser cannot always name it: a frame-level entry (`shell.overlay`) gets
 * no Session prop, and the Session list it can see carries no selection. So the
 * directory is resolved here, in the order that stays as close to what the
 * person is looking at as the Host can know: an explicit path, then the named
 * Session's live Agent, then — only when no Session was named — the most
 * recently created live Agent, then the first registered workspace. The chosen
 * directory travels back in every response, so the panel can say which checkout
 * it is on.
 *
 * @param ctx - plugin context carrying the optional `agents` and `workspaceRegistry`.
 * @param request - `{ cwd?, sessionId? }` as the page sent them.
 * @returns the absolute directory, or undefined while a named Session's Agent is
 * not live yet — a state the caller reports rather than papers over.
 * @throws when nothing on this Host names a workspace.
 */
function resolveCwd(ctx, request) {
  const explicit = typeof request?.cwd === 'string' ? request.cwd.trim() : ''
  if (isAbsolutePath(explicit)) return explicit

  const fromAgent = cwdOfAgent(agentFor(ctx, request))
  if (fromAgent !== undefined) return fromAgent

  // A Session the page named but the Host has no live Agent for is still
  // opening. Neither the newest Agent nor the first workspace is this Session's
  // checkout, so nothing is resolved and the caller answers "not yet".
  if (typeof request?.sessionId === 'string' && request.sessionId.trim() !== '') return undefined

  const workspaces = service(ctx, 'workspaceRegistry')
  const first = (typeof workspaces?.list === 'function' ? workspaces.list() : [])[0]
  if (first !== undefined && isAbsolutePath(first.path)) return first.path
  throw new Error('no workspace directory to act on — open a Session first')
}

/**
 * The directory a request that runs git must act on.
 * @param ctx - plugin context.
 * @param request - `{ cwd?, sessionId? }` as the page sent them.
 * @returns the absolute directory.
 * @throws when the named Session has not opened yet.
 */
function requiredCwd(ctx, request) {
  const cwd = resolveCwd(ctx, request)
  if (cwd === undefined) throw new Error('this Session is still opening — try again in a moment')
  return cwd
}

/**
 * Mount the panel's API.
 * @param ctx - plugin context carrying `shell`.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => scope.webServer.register({
      kind: 'prefix',
      path: '/git-tools',
      handler: async (req, res) => {
        const rejection = rejectionOf(ctx, req)
        if (rejection !== null) {
          sendJson(res, rejection, { ok: false, error: 'refused by the deployment trust fence' })
          return
        }
        // The route table matches a prefix but hands the handler the request
        // untouched, so the pathname here is the whole one.
        const url = new URL(req.url ?? '/', 'http://localhost')
        const route = url.pathname
        try {
          if (req.method === 'GET' && route === `${API_PATH}/state`) {
            const request = { cwd: url.searchParams.get('cwd'), sessionId: url.searchParams.get('sessionId') }
            const cwd = resolveCwd(ctx, request)
            // The named Session has no live Agent yet. The page keeps its
            // loading state and asks once more rather than being shown whichever
            // other checkout this Host happens to know about.
            if (cwd === undefined) {
              sendJson(res, 200, { ok: true, pending: true })
              return
            }
            sendJson(res, 200, { ok: true, ...(await readState(ctx, cwd)) })
            return
          }
          if (req.method === 'POST' && route === `${API_PATH}/checkout`) {
            const body = await readJson(req)
            const cwd = requiredCwd(ctx, body)
            const branch = String(body?.branch ?? '')
            if (!isValidBranch(branch)) throw new Error(`"${branch}" is not a branch name this panel switches to`)
            assertOk(await runGit(ctx, cwd, ['checkout', branch]), 'checkout')
            sendJson(res, 200, { ok: true, ...(await readState(ctx, cwd)) })
            return
          }
          if (req.method === 'POST' && route === `${API_PATH}/create-branch`) {
            const body = await readJson(req)
            const cwd = requiredCwd(ctx, body)
            const branch = String(body?.branch ?? '')
            if (!isValidBranch(branch)) throw new Error(`"${branch}" is not a branch name this panel creates`)
            assertOk(await runGit(ctx, cwd, ['checkout', '-b', branch]), 'checkout -b')
            sendJson(res, 200, { ok: true, ...(await readState(ctx, cwd)) })
            return
          }
          if (req.method === 'POST' && route === `${API_PATH}/commit`) {
            const body = await readJson(req)
            const cwd = requiredCwd(ctx, body)
            const message = requireMessage(body?.message)
            const result = await commit(ctx, cwd, message, body?.stageAll === true, body?.skipHooks === true)
            sendJson(res, 200, { ok: true, stdout: result.stdout, stderr: result.stderr, ...(await readState(ctx, cwd)) })
            return
          }
          if (req.method === 'POST' && route === `${API_PATH}/message`) {
            const body = await readJson(req)
            sendJson(res, 200, { ok: true, message: await generateMessage(ctx, body) })
            return
          }
          if (req.method === 'POST' && route === `${API_PATH}/push`) {
            const body = await readJson(req)
            const cwd = requiredCwd(ctx, body)
            assertOk(await runGit(ctx, cwd, ['push']), 'push')
            sendJson(res, 200, { ok: true, ...(await readState(ctx, cwd)) })
            return
          }
          sendJson(res, 404, { ok: false, error: 'not found' })
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    }), 'git-tools: routes')
  })
}
