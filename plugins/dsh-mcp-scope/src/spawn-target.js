/**
 * How one configured stdio command must be started.
 *
 * Windows cannot start a `.cmd`/`.bat` shim directly: the file has no
 * executable image, so `node:child_process.spawn` fails synchronously with
 * `EINVAL`. Only `.exe`/`.com` are directly startable, and running anything
 * else through the command interpreter is also what makes a command configured
 * as `npx` work, because cmd.exe applies PATH and PATHEXT where CreateProcess
 * does not. The official client reaches those commands through cross-spawn,
 * which is why the same configured command connects while a direct spawn
 * failed; this builds the equivalent command line so the probe accepts exactly
 * what the connection accepts.
 *
 * The escaping is cross-spawn's, kept here rather than imported so this plugin
 * stays dependency-free.
 *
 * @module dsh-mcp-scope/spawn-target
 */

/** Extensions Windows starts without a command interpreter. */
const WINDOWS_EXECUTABLE = /\.(?:com|exe)$/iu

/** cmd.exe metacharacters, matching the escaping table cross-spawn uses. */
const CMD_META_CHARS = /([()\][%!^"`<>&|;, *?])/gu

/**
 * Escape cmd.exe metacharacters in one token.
 * @param value - one token.
 * @returns the token with every metacharacter prefixed by `^`.
 */
function escapeCommandToken(value) {
  return String(value).replace(CMD_META_CHARS, '^$1')
}

/**
 * Escape one argument for a cmd.exe command line.
 *
 * A run of backslashes before a quote, and any run before the closing quote,
 * is doubled so the child's own argument parsing sees them literally; the
 * token is then quoted, and its quotes and metacharacters are escaped.
 *
 * @param value - one argument.
 * @returns the quoted, escaped argument.
 */
function escapeArgumentToken(value) {
  const doubled = String(value)
    .replace(/(\\*)"/gu, '$1$1\\"')
    .replace(/(\\*)$/u, '$1$1')
  return escapeCommandToken(`"${doubled}"`)
}

/**
 * Resolve the file, argv, and spawn options for one configured stdio command.
 * @param command - the configured executable.
 * @param args - the configured arguments.
 * @param platform - operating system family to build for.
 * @param comSpec - command interpreter path; an empty or absent value falls back to `cmd.exe`.
 * @returns the spawn target, whose `interpreted` flag reports whether a command interpreter holds the server.
 */
export function stdioSpawnTarget(command, args, platform = process.platform, comSpec = process.env.ComSpec) {
  const argv = [...(args ?? [])]
  if (platform !== 'win32' || WINDOWS_EXECUTABLE.test(String(command).trim())) {
    return { file: command, args: argv, options: {}, interpreted: false }
  }
  const line = [escapeCommandToken(command), ...argv.map(escapeArgumentToken)].join(' ')
  return {
    file: typeof comSpec === 'string' && comSpec !== '' ? comSpec : 'cmd.exe',
    args: ['/d', '/s', '/c', `"${line}"`],
    // The line is already escaped for cmd.exe; Node must pass it through as written.
    options: { windowsVerbatimArguments: true },
    interpreted: true,
  }
}
