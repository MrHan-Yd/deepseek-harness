/**
 * Pure git helpers for dsh-git-tools: the parsing, validation, and quoting the
 * Host half needs, kept apart from the shell so they can be tested directly.
 *
 * Every command this plugin runs is built here rather than interpolated at the
 * call site, because a branch name and a commit message both reach a command
 * line: the branch name is validated against git's own ref rules and the commit
 * message never becomes an argument at all (it is written to a file and passed
 * with `-F`), so neither can carry shell syntax.
 *
 * @module dsh-git-tools/git
 */

import { isAbsolute } from 'node:path'

/**
 * Branch names this plugin is willing to put on a command line.
 *
 * Git's own rules are wider, but everything accepted here is a name no shell
 * treats as syntax: letters, digits, `.`, `_`, `-`, and `/`. A leading `-` is
 * refused because it would read as an option, and `..` because git refuses it.
 */
const BRANCH_PATTERN = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$/u

/**
 * Whether a branch name may be handed to git as an operand.
 * @param value - the candidate name.
 * @returns true when it is a plain ref name.
 */
export function isValidBranch(value) {
  return typeof value === 'string' && BRANCH_PATTERN.test(value)
}

/**
 * Whether a path may be used as a working directory.
 * @param value - the candidate path.
 * @returns true when it is a non-empty absolute path.
 */
export function isAbsolutePath(value) {
  return typeof value === 'string' && value.trim() !== '' && isAbsolute(value)
}

/**
 * Quote one argument for the shell the executor runs.
 *
 * The only argument this ever sees is a temporary file path this plugin created
 * itself; the check refuses anything that could close the quote rather than
 * trying to escape it, because a path that needs escaping means the caller
 * built something this module did not.
 *
 * @param value - the argument to quote.
 * @returns the quoted argument.
 * @throws when the value contains a quote or backtick.
 */
export function quoteArg(value) {
  const text = String(value)
  if (/["'`]/u.test(text)) throw new Error(`refusing to quote an argument containing a quote: ${text}`)
  return `"${text}"`
}

/**
 * Cap one command's captured output.
 * @param value - the raw text.
 * @param limit - maximum characters to keep.
 * @returns the capped text.
 */
export function capText(value, limit = 4000) {
  const text = String(value ?? '')
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… (${text.length - limit} more characters)`
}

/**
 * Read the branch name out of `git rev-parse --abbrev-ref HEAD`.
 * @param stdout - the command's standard output.
 * @returns the branch name, or null when HEAD is detached or unreadable.
 */
export function parseBranch(stdout) {
  const name = String(stdout ?? '').trim().split('\n')[0]?.trim() ?? ''
  return name === '' || name === 'HEAD' ? null : name
}

/**
 * Read the local branch list out of `git branch --no-color`.
 *
 * Git marks the branch in use with `*` and one checked out in another worktree
 * with `+`; a detached HEAD reports a parenthesised description instead of a
 * name, which is not a branch this panel would check out.
 *
 * @param stdout - the command's standard output.
 * @returns the branch names, in the order git printed them.
 */
export function parseBranches(stdout) {
  const names = []
  for (const line of String(stdout ?? '').split('\n')) {
    const name = line.replace(/^[*+]\s*/u, '').trim()
    if (name === '' || name.includes(' ') || name.startsWith('(')) continue
    names.push(name)
  }
  return names
}

/**
 * Read one `git status --porcelain=v2 --branch -z` stream into the state the
 * panel renders.
 *
 * One command answers everything the panel shows about a working tree: the
 * branch, its upstream and unpushed count, how many paths changed, and which of
 * them git has never seen. `-z` terminates every record — the `#` headers
 * included — with NUL rather than a newline, which is also what keeps a path
 * usable: the newline form quotes anything non-ASCII, and a quoted path is not
 * a path the caller could open to count its lines.
 *
 * A rename record carries its original path in a second NUL-terminated field,
 * which is consumed rather than read as a record of its own.
 *
 * @param stdout - the command's standard output.
 * @returns the branch, the upstream and ahead count, how many paths changed, and the untracked paths.
 */
export function parseStatus(stdout) {
  let branch = null
  let upstream = null
  let ahead = null
  let changed = 0
  const untracked = []
  /** Set while a rename record's second field is the next thing in the stream. */
  let readingOrigPath = false
  for (const record of String(stdout ?? '').split('\0')) {
    if (readingOrigPath) {
      readingOrigPath = false
      continue
    }
    if (record === '') continue
    if (record.startsWith('# ')) {
      const head = /^# branch\.head (.+)$/u.exec(record)
      if (head !== null) {
        // A detached HEAD is described in parentheses, not named.
        branch = head[1] === '(detached)' ? null : head[1]
        continue
      }
      const tracked = /^# branch\.upstream (.+)$/u.exec(record)
      if (tracked !== null) {
        upstream = tracked[1]
        continue
      }
      const counts = /^# branch\.ab \+(\d+) -\d+$/u.exec(record)
      if (counts !== null) ahead = Number(counts[1])
      continue
    }
    const kind = record.charAt(0)
    if (kind === '1' || kind === 'u') {
      changed += 1
    } else if (kind === '2') {
      changed += 1
      readingOrigPath = true
    } else if (kind === '?') {
      changed += 1
      untracked.push(record.slice(2))
    }
  }
  // An upstream git cannot compare against leaves the count unknown, which is
  // not the same as a real zero.
  return { branch, upstream, ahead: upstream === null ? null : ahead, changed, untracked }
}

/**
 * Sum `git diff --numstat` into the `+insertions -deletions` a changes row shows.
 *
 * A binary file reports `-` in both columns: it counts as a changed file (that
 * comes from `git status`) but adds no lines, which is what git itself prints.
 *
 * @param stdout - the command's standard output.
 * @returns the added and removed line counts.
 */
export function parseNumstat(stdout) {
  let insertions = 0
  let deletions = 0
  for (const line of String(stdout ?? '').split('\n')) {
    const [added, removed] = line.trim().split(/\s+/u)
    if (added === undefined || removed === undefined) continue
    if (/^\d+$/u.test(added)) insertions += Number(added)
    if (/^\d+$/u.test(removed)) deletions += Number(removed)
  }
  return { insertions, deletions }
}

/**
 * The commit message to store, refusing one that is only whitespace.
 * @param value - the message the page sent.
 * @returns the trimmed message.
 * @throws when the message is empty.
 */
export function requireMessage(value) {
  const message = String(value ?? '').trim()
  if (message === '') throw new Error('a commit message is required')
  return message
}
