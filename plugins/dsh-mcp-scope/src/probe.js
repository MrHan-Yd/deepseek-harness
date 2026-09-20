/**
 * Connectivity probing and failure diagnosis for dsh-mcp-scope.
 *
 * A probe is a REAL connection attempt, not an inference from configuration:
 * a stdio server is spawned and asked for an MCP `initialize` handshake, and a
 * streamable-http server is sent the same request. That distinction matters
 * here — the official client ships no connection-status seam, so anything the
 * page reports about reachability has to be observed, never guessed.
 *
 * The stdio probe spawns with `scrubbedParentEnv()` from the official
 * subprocess package, the same environment the official client gives a child,
 * so a probe cannot leak credentials the real connection would not. A command
 * Windows cannot start directly — a `.cmd`/`.bat` shim, or a bare name that
 * only cmd.exe resolves through PATH — is started through the command
 * interpreter by `./spawn-target.js`, so a probe accepts exactly the commands
 * the real connection accepts.
 *
 * @module dsh-mcp-scope/probe
 */

import { spawn, spawnSync } from 'node:child_process'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { stdioSpawnTarget } from './spawn-target.js'

/** MCP protocol revision this probe announces. */
const INITIALIZE_PROTOCOL_VERSION = '2025-06-18'

/** Client identity reported in the handshake. */
const PROBE_CLIENT_INFO = { name: 'dsh-mcp-scope', version: '0.1.0' }

/** Cap on any single line of probe detail. */
const MAX_DETAIL_CHARS = 400

/** Default probe deadline in milliseconds. */
export const DEFAULT_PROBE_TIMEOUT_MS = 10000

/** Cap on buffered stdout while waiting for the initialize response, in characters. */
const MAX_STDOUT_BYTES = 256 * 1024

/** Cap on the child's buffered stderr, in characters. */
const MAX_STDERR_BYTES = 4 * 1024

/** Grace period between SIGTERM and SIGKILL for a probe child, and the ceiling on a tree kill. */
const KILL_GRACE_MS = 2000

/**
 * Collapse whitespace and cap length so no probe detail can flood a page.
 * @param value - raw text.
 * @returns the bounded single-line text.
 */
export function sanitizeText(value) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim()
  return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS)}…` : text
}

/**
 * Render an unknown thrown value as bounded text, following the cause chain.
 *
 * `fetch` reports every transport failure as a bare `TypeError: fetch failed`
 * and puts the real reason — `ECONNREFUSED`, `ENOTFOUND`, a TLS error — in
 * `cause`. Reading only `message` would collapse all of them into one
 * unclassifiable string, so the chain is what gets classified.
 *
 * @param error - the thrown value.
 * @returns the bounded message chain.
 */
function errorText(error) {
  const parts = []
  let current = error
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth += 1) {
    const text = current instanceof Error ? `${current.name}: ${current.message}` : String(current)
    if (!parts.includes(text)) parts.push(text)
    current = current instanceof Error ? current.cause : undefined
  }
  return sanitizeText(parts.join(' ← '))
}

/**
 * Build the JSON-RPC initialize request this probe sends.
 * @returns the serialized request line.
 */
function initializeRequest() {
  return `${JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: INITIALIZE_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: PROBE_CLIENT_INFO,
    },
  })}\n`
}

/**
 * Read `serverInfo` out of an initialize result.
 * @param result - the JSON-RPC result object.
 * @returns a display string naming the server and version.
 */
function serverIdentity(result) {
  const info = result?.serverInfo ?? {}
  const name = typeof info.name === 'string' && info.name !== '' ? sanitizeText(info.name) : 'unnamed'
  const version = typeof info.version === 'string' && info.version !== '' ? sanitizeText(info.version) : 'unknown version'
  return `${name} ${version}`
}

/**
 * Terminate a child that a Windows command interpreter holds.
 *
 * The process this probe owns is cmd.exe, so killing it alone leaves the MCP
 * server it started running with the connection the probe opened; `taskkill
 * /t` ends that tree. The call is synchronous on purpose: the probe's caller
 * may exit the moment this probe resolves, and an outstanding kill would then
 * be abandoned with the server still running.
 *
 * @param child - the spawned probe child.
 */
function killInterpretedChild(child) {
  try {
    const result = spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: KILL_GRACE_MS,
    })
    if (result.error === undefined) return
  } catch {
    // Fall through to the direct kill: taskkill is unavailable or refused.
  }
  try {
    child.kill()
  } catch {
    // The child already exited; the exit path settled the outcome.
  }
}

/**
 * Spawn a stdio server and complete one MCP initialize handshake.
 * @param server - the stored server record.
 * @param timeoutMs - probe deadline.
 * @param signal - caller cancellation.
 * @returns the probe outcome.
 */
function probeStdio(server, timeoutMs, signal) {
  const started = Date.now()
  return new Promise((resolve) => {
    let settled = false
    let child
    let interpreted = false
    let buffer = ''
    let stderr = ''
    let timer
    let killTimer
    const onAbort = () => { finish('failed', `timeout after ${timeoutMs}ms or cancelled`) }
    const finish = (status, detail) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      if (killTimer !== undefined) clearTimeout(killTimer)
      signal?.removeEventListener('abort', onAbort)
      try {
        if (child !== undefined && child.exitCode === null && child.signalCode === null) {
          if (interpreted) {
            killInterpretedChild(child)
          } else {
            child.kill()
            // SIGTERM is a request: a server that ignores it (or an `npx` wrapper
            // holding the real process) would otherwise outlive the probe. Escalate
            // once, and do not keep the process alive for the escalation.
            killTimer = setTimeout(() => {
              try {
                child?.kill('SIGKILL')
              } catch {
                // Already gone between the check and the signal.
              }
            }, KILL_GRACE_MS)
            killTimer.unref?.()
          }
        }
      } catch {
        // The child already exited; the exit path settled the outcome.
      }
      resolve({ status, detail, elapsedMs: Date.now() - started, stderrTail: sanitizeText(stderr) })
    }
    timer = setTimeout(() => { finish('failed', `timeout after ${timeoutMs}ms`) }, timeoutMs)
    try {
      const target = stdioSpawnTarget(server.command, server.args)
      interpreted = target.interpreted
      child = spawn(target.file, target.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...scrubbedParentEnv(), ...(server.env ?? {}) },
        ...(typeof server.cwd === 'string' && server.cwd !== '' ? { cwd: server.cwd } : {}),
        windowsHide: true,
        ...target.options,
      })
    } catch (error) {
      finish('failed', errorText(error))
      return
    }
    child.on('error', error => finish('failed', errorText(error)))
    child.on('exit', (code, signalName) => {
      finish('failed', `process exited before initialize response (code ${code ?? 'null'}${signalName === null ? '' : `, signal ${signalName}`})`)
    })
    child.stdout?.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      // A server that streams without ever completing a line must not be able
      // to grow this buffer for the whole probe deadline.
      if (buffer.length > MAX_STDOUT_BYTES) {
        finish('failed', `initialize response exceeded ${MAX_STDOUT_BYTES} bytes`)
        return
      }
      let at
      while ((at = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, at).trim()
        buffer = buffer.slice(at + 1)
        if (line === '') continue
        let message
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }
        if (message !== null && typeof message === 'object' && message.id === 1 && message.result !== undefined) {
          finish('completed', `MCP initialize ok over stdio (server ${serverIdentity(message.result)})`)
          return
        }
      }
    })
    // stderr is consumed so a chatty child cannot block on a full pipe. Its tail
    // never reaches the page — a server may print credentials — but it is the
    // only place a server says why it refused to start, so the caller logs it.
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > MAX_STDERR_BYTES) stderr = stderr.slice(-MAX_STDERR_BYTES)
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      child.stdin?.write(initializeRequest())
    } catch {
      // The exit and error paths settle the outcome.
    }
  })
}

/**
 * Send one MCP initialize request to a streamable-http server.
 * @param server - the stored server record.
 * @param timeoutMs - probe deadline.
 * @param signal - caller cancellation, composed with the deadline.
 * @returns the probe outcome.
 */
async function probeHttp(server, timeoutMs, signal) {
  const started = Date.now()
  try {
    const deadline = AbortSignal.timeout(timeoutMs)
    const response = await fetch(server.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(server.headers ?? {}),
      },
      body: initializeRequest().trim(),
      signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
      // A probe measures this endpoint, not wherever it points next.
      redirect: 'error',
    })
    const elapsedMs = Date.now() - started
    if (!response.ok) {
      // Drain the body: an unread body holds the socket open past the probe.
      await response.body?.cancel().catch(() => {})
      return { status: 'failed', detail: `HTTP ${response.status} ${response.statusText}`.trim(), elapsedMs }
    }
    let identity = 'unnamed unknown version'
    try {
      const body = await response.json()
      if (body?.result !== undefined) identity = serverIdentity(body.result)
    } catch {
      // A 2xx without a JSON body still proves the endpoint answered.
    }
    return { status: 'completed', detail: `HTTP ${response.status}, MCP initialize ok (server ${identity})`, elapsedMs }
  } catch (error) {
    const elapsedMs = Date.now() - started
    if (signal?.aborted === true) {
      return { status: 'failed', detail: 'cancelled', elapsedMs }
    }
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { status: 'failed', detail: `timeout after ${timeoutMs}ms`, elapsedMs }
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return { status: 'failed', detail: `timeout after ${timeoutMs}ms or cancelled`, elapsedMs }
    }
    return { status: 'failed', detail: errorText(error), elapsedMs }
  }
}

/**
 * Probe one server's reachability.
 * @param server - the stored server record.
 * @param timeoutMs - probe deadline; defaults to {@link DEFAULT_PROBE_TIMEOUT_MS}.
 * @param signal - caller cancellation.
 * @returns the probe outcome.
 */
export async function probeServer(server, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS, signal) {
  if (server.transport === 'stdio') return probeStdio(server, timeoutMs, signal)
  return probeHttp(server, timeoutMs, signal)
}

/**
 * One diagnosed failure: a stable code, the operator-facing sentence pair, and
 * the repair the person can act on.
 */
const FAILURE_RULES = [
  {
    code: 'command-not-found',
    match: /\bENOENT\b|not found|no such file/iu,
    zh: '找不到要启动的命令。',
    en: 'The command to launch was not found.',
    fixZh: '确认该命令已安装且在 PATH 中，或在「命令」字段里写绝对路径（例如 /usr/local/bin/npx）。',
    fixEn: 'Install the command or put its absolute path in the Command field.',
  },
  {
    code: 'permission',
    match: /\bEACCES\b|\bEPERM\b|permission denied|not permitted/iu,
    zh: '命令存在但没有执行权限。',
    en: 'The command exists but is not executable.',
    fixZh: '用 chmod +x 赋权，或检查该路径的权限。',
    fixEn: 'Grant execute permission with chmod +x, or check the path permissions.',
  },
  {
    code: 'auth-401',
    match: /\b401\b|unauthorized/iu,
    zh: '服务器拒绝了凭据（HTTP 401）。',
    en: 'The server rejected the credentials (HTTP 401).',
    fixZh: '检查 Headers 里的 Authorization，或更换 token。',
    fixEn: 'Check the Authorization header or replace the token.',
  },
  {
    code: 'auth-403',
    match: /\b403\b|forbidden/iu,
    zh: '服务器拒绝访问（HTTP 403）—— 凭据有效但权限不足。',
    en: 'The server denied access (HTTP 403) — the credential lacks permission.',
    fixZh: '确认该 token 的 scope 是否覆盖这个端点。',
    fixEn: 'Confirm the token scope covers this endpoint.',
  },
  {
    code: 'not-found-404',
    match: /\b404\b|not found/iu,
    zh: '端点不存在（HTTP 404）。',
    en: 'The endpoint does not exist (HTTP 404).',
    fixZh: 'URL 通常需要精确到 MCP 路径（例如 https://host/mcp），检查是否漏写。',
    fixEn: 'The URL usually needs the exact MCP path (for example https://host/mcp).',
  },
  {
    code: 'bad-port',
    match: /bad port/iu,
    zh: '该端口被 fetch 列为禁止访问的端口。',
    en: 'That port is on the fetch blocklist.',
    fixZh: '换一个端口：9、19、25、465 等低位端口会被运行时直接拒绝。',
    fixEn: 'Use another port: low ports such as 9, 19, 25, and 465 are refused by the runtime.',
  },
  {
    code: 'connection-refused',
    match: /ECONNREFUSED|connection refused/iu,
    zh: '目标端口拒绝连接 —— 服务没有在监听。',
    en: 'The port refused the connection — nothing is listening.',
    fixZh: '先手动启动那个 MCP 服务，或确认端口号对不对。',
    fixEn: 'Start the MCP service first, or verify the port.',
  },
  {
    code: 'dns',
    match: /ENOTFOUND|EAI_AGAIN|getaddrinfo|name resolution/iu,
    zh: '域名解析失败。',
    en: 'Domain resolution failed.',
    fixZh: '检查主机名拼写和网络/DNS 设置。',
    fixEn: 'Check the host name and your DNS settings.',
  },
  {
    code: 'tls',
    match: /certificate|self.signed|TLS|SSL/iu,
    zh: 'TLS 证书校验失败。',
    en: 'TLS certificate validation failed.',
    fixZh: '确认证书链完整；自签名证书需要被系统信任。',
    fixEn: 'Verify the certificate chain; a self-signed certificate must be trusted.',
  },
  {
    code: 'timeout',
    match: /timeout|timed out|aborted|TimeoutError/iu,
    zh: '握手超时。',
    en: 'The handshake timed out.',
    fixZh: '服务可能启动很慢：把「超时时间」调大，或先手动跑一次那个命令看它是否能起来。',
    fixEn: 'The server may start slowly: raise the timeout, or run the command by hand once.',
  },
  {
    code: 'process-exit',
    match: /process exited before initialize/iu,
    zh: '进程在完成握手前就退出了。',
    en: 'The process exited before finishing the handshake.',
    fixZh: '在终端里手动执行「命令 + 参数」看它报什么错；常见原因是缺少运行时或参数写错。',
    fixEn: 'Run the command and arguments in a terminal to read its own error.',
  },
  {
    code: 'upstream-5xx',
    match: /\b5\d\d\b|internal server error|bad gateway/iu,
    zh: '服务器端报错（HTTP 5xx）。',
    en: 'The server returned a 5xx error.',
    fixZh: '这通常是对方服务的问题，看它自己的日志。',
    fixEn: 'This is usually the remote service; check its logs.',
  },
]

/**
 * Classify a failure and attach a repair suggestion.
 *
 * An unclassified failure still names what was observed; guessing a cause
 * would be worse than saying the cause is unknown.
 *
 * @param detail - the probe's failure detail.
 * @param server - the server that failed, for context in the suggestion.
 * @returns the classification.
 */
export function diagnose(detail, server) {
  const text = sanitizeText(detail)
  for (const rule of FAILURE_RULES) {
    if (!rule.match.test(text)) continue
    return {
      code: rule.code,
      zh: `${rule.zh}\n观察到的错误：${text}\n建议：${rule.fixZh}`,
      en: `${rule.en}\nObserved: ${text}\nFix: ${rule.fixEn}`,
    }
  }
  const transport = server?.transport === 'stdio'
    ? 'The command failed to complete an MCP handshake.'
    : 'The endpoint failed to complete an MCP handshake.'
  return {
    code: 'unknown',
    zh: `未能识别的失败。\n观察到的错误：${text}\n建议：手动跑一次确认它能正常启动，再对比这里的命令/URL 与真实配置。`,
    en: `${transport}\nObserved: ${text}\nFix: Run it by hand and compare with this configuration.`,
  }
}
