/**
 * Pure git helpers, driven directly.
 *
 * These are the rules that stand between free text and a command line: a branch
 * name is only accepted when git and the shell both read it as a plain ref, and
 * a commit message never reaches a command line at all.
 *
 * Run from the repository root:
 *   node --test "plugins/dsh-git-tools/tests/*.test.mjs"
 *
 * @module dsh-git-tools/tests/git
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  capText, isAbsolutePath, isValidBranch, parseBranch, parseBranches, parseNumstat, parseStatus,
  quoteArg, requireMessage,
} from '../src/git.js'

test('a branch name is accepted only when git and the shell agree on it', () => {
  for (const name of ['master', 'dev_jenkins', 'han-nbtp', 'feature/git-panel', 'release/2026.01']) {
    assert.equal(isValidBranch(name), true, `${name} is a branch name`)
  }
  // A leading dash reads as an option; a space, a quote, or a substitution is
  // shell syntax; `..` and an empty name are invalid refs.
  for (const name of ['-f', '--force', 'a b', 'a"b', "a'b", 'a`b`', 'a$(b)', 'a..b', '', 'a\nb', null, 42]) {
    assert.equal(isValidBranch(name), false, `${JSON.stringify(name)} is refused`)
  }
})

test('a workspace directory must be an absolute path', () => {
  assert.equal(isAbsolutePath(process.platform === 'win32' ? 'D:\\ws\\repo' : '/srv/repo'), true)
  assert.equal(isAbsolutePath('repo'), false)
  assert.equal(isAbsolutePath('   '), false)
  assert.equal(isAbsolutePath(undefined), false)
})

test('the one quoted argument refuses anything that could close the quote', () => {
  assert.equal(quoteArg('/tmp/message'), '"/tmp/message"')
  assert.equal(quoteArg('C:\\Temp\\message'), '"C:\\Temp\\message"')
  assert.throws(() => quoteArg('/tmp/a"b'), /refusing to quote/u)
  assert.throws(() => quoteArg('/tmp/a`b'), /refusing to quote/u)
})

test('git read commands are parsed into the state the panel renders', () => {
  assert.equal(parseBranch('master\n'), 'master')
  assert.equal(parseBranch('  dev_jenkins  \n'), 'dev_jenkins')
  assert.equal(parseBranch('HEAD\n'), null, 'a detached HEAD is not a branch')
  assert.equal(parseBranch(''), null)

  assert.deepEqual(
    parseBranches('  develop\n* master\n  feature/a\n\n'),
    ['develop', 'master', 'feature/a'],
    'git’s own markers are stripped and its order kept',
  )
  assert.deepEqual(parseBranches('+ worktree-branch\n'), ['worktree-branch'], 'another worktree’s branch is still one')
  assert.deepEqual(parseBranches('* (HEAD detached at 1a2b3c)\n  master\n'), ['master'], 'a detached HEAD names nothing')
  assert.deepEqual(parseBranches(''), [])
})

test('one status read answers the branch, its tracking, and which paths are new', () => {
  // `-z`: every record, the `#` headers included, ends in NUL.
  const records = (...rows) => `${rows.join('\0')}\0`

  assert.deepEqual(parseStatus(''), { branch: null, upstream: null, ahead: null, changed: 0, untracked: [] })

  assert.deepEqual(
    parseStatus(records(
      '# branch.oid 1234567',
      '# branch.head master',
      '# branch.upstream origin/master',
      '# branch.ab +3 -1',
      '1 M. N... 100644 100644 100644 aaa bbb src/a.ts',
      '1 .M N... 100644 100644 100644 aaa bbb src/b.ts',
      '? src/new.ts',
    )),
    {
      branch: 'master',
      upstream: 'origin/master',
      ahead: 3,
      changed: 3,
      untracked: ['src/new.ts'],
    },
  )

  // A staged rename carries its original path in a second field, which is not a
  // record of its own.
  assert.deepEqual(
    parseStatus(records('2 R. N... 100644 100644 100644 aaa bbb R100 src/new.ts', 'src/old.ts', '? fresh.ts')),
    { branch: null, upstream: null, ahead: null, changed: 2, untracked: ['fresh.ts'] },
  )

  // An unmerged path is one changed path, not two.
  assert.deepEqual(
    parseStatus(records('u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts')).changed,
    1,
  )

  // A detached HEAD is described in parentheses, not named.
  assert.equal(parseStatus(records('# branch.head (detached)')).branch, null)

  // No upstream at all leaves the count unknown, and being behind is not ahead.
  assert.deepEqual(
    (({ upstream, ahead }) => ({ upstream, ahead }))(parseStatus(records('# branch.head master'))),
    { upstream: null, ahead: null },
  )
  assert.deepEqual(
    (({ upstream, ahead }) => ({ upstream, ahead }))(
      parseStatus(records('# branch.head master', '# branch.upstream origin/master', '# branch.ab +0 -2')),
    ),
    { upstream: 'origin/master', ahead: 0 },
  )
  // An upstream git cannot compare against says nothing, so it stays unknown.
  assert.deepEqual(
    (({ upstream, ahead }) => ({ upstream, ahead }))(parseStatus(records('# branch.upstream origin/master'))),
    { upstream: 'origin/master', ahead: null },
  )
  // A non-ASCII path survives unquoted, which is what makes it openable.
  assert.deepEqual(parseStatus(records('? docs/密评/接口.md')).untracked, ['docs/密评/接口.md'])
})

test('numstat sums into the changes row, and a binary counts as no lines', () => {
  assert.deepEqual(
    parseNumstat('120\t30\tsrc/a.ts\n0\t5\tsrc/b.ts\n-\t-\tlogo.png\n'),
    { insertions: 120, deletions: 35 },
  )
  assert.deepEqual(parseNumstat(''), { insertions: 0, deletions: 0 })
  assert.deepEqual(parseNumstat('\n  \n'), { insertions: 0, deletions: 0 })
})

test('a commit message is required, and captured output is capped', () => {
  assert.equal(requireMessage('  fix the panel  '), 'fix the panel')
  assert.equal(requireMessage('line one\n\nline two'), 'line one\n\nline two')
  assert.throws(() => requireMessage('   '), /a commit message is required/u)

  assert.equal(capText('short', 10), 'short')
  assert.equal(capText('0123456789ab', 10), '0123456789\n… (2 more characters)')
})
