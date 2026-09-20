/**
 * The command line a stdio probe builds.
 *
 * Windows refuses to start a `.cmd`/`.bat` shim directly (`spawn` fails with
 * `EINVAL`), so the rule that decides when a command goes through the command
 * interpreter, and how its tokens are escaped there, is pinned here: it is the
 * difference between "探测" reporting a real handshake and reporting a spawn
 * failure for a server that is in fact connected.
 *
 * Run from the repository root:
 *   node --test "plugins/dsh-mcp-scope/tests/*.test.mjs"
 *
 * @module dsh-mcp-scope/tests/spawn-target
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stdioSpawnTarget } from '../src/spawn-target.js'

const CMD = 'C:\\Windows\\System32\\cmd.exe'

test('a posix command is spawned as configured', () => {
  const args = ['-y', '@modelcontextprotocol/server-memory']
  const target = stdioSpawnTarget('npx', args, 'linux')
  assert.equal(target.file, 'npx')
  assert.deepEqual(target.args, args)
  assert.equal(target.interpreted, false)
  assert.deepEqual(target.options, {})
})

test('the configured argument list is never mutated', () => {
  const args = ['--flag']
  stdioSpawnTarget('C:\\tools\\server.cmd', args, 'win32', CMD)
  assert.deepEqual(args, ['--flag'])
})

test('a windows executable is started directly', () => {
  const target = stdioSpawnTarget('C:\\tools\\server.exe', ['--flag'], 'win32', CMD)
  assert.equal(target.file, 'C:\\tools\\server.exe')
  assert.deepEqual(target.args, ['--flag'])
  assert.equal(target.interpreted, false)
})

test('a windows batch shim runs through the command interpreter', () => {
  const target = stdioSpawnTarget(
    'C:\\Program Files\\nodejs\\mongodb-mcp-server.cmd',
    ['--connectionString', 'mongodb://user:secret@example.test:27017/db?authSource=admin'],
    'win32',
    CMD,
  )
  assert.equal(target.file, CMD)
  assert.equal(target.interpreted, true)
  assert.equal(target.options.windowsVerbatimArguments, true)
  assert.deepEqual(target.args, [
    '/d',
    '/s',
    '/c',
    '"C:\\Program^ Files\\nodejs\\mongodb-mcp-server.cmd'
    + ' ^"--connectionString^"'
    + ' ^"mongodb://user:secret@example.test:27017/db^?authSource=admin^""',
  ])
})

test('a command with no executable extension takes the same path', () => {
  // cmd.exe applies PATH and PATHEXT; CreateProcess only appends `.exe`, so a
  // configured `npx` can only start through the interpreter.
  const target = stdioSpawnTarget('npx', ['-y', 'pkg'], 'win32', CMD)
  assert.equal(target.file, CMD)
  assert.equal(target.interpreted, true)
  assert.deepEqual(target.args, ['/d', '/s', '/c', '"npx ^"-y^" ^"pkg^""'])
})

test('a missing command interpreter falls back to cmd.exe', () => {
  assert.equal(stdioSpawnTarget('server.cmd', [], 'win32', '').file, 'cmd.exe')
  assert.equal(stdioSpawnTarget('server.cmd', [], 'win32', undefined).file, process.env.ComSpec ?? 'cmd.exe')
})

test('backslashes before a quote and before the end survive escaping', () => {
  // Cross-spawn's exact output for the same tokens, metacharacter escaping
  // included: `C:\dir\` doubles its trailing backslash, and each quote in
  // `say "hi"` becomes `\"` before cmd.exe sees `^"` around it.
  const target = stdioSpawnTarget('server.cmd', ['C:\\dir\\', 'say "hi"'], 'win32', CMD)
  assert.deepEqual(target.args, [
    '/d',
    '/s',
    '/c',
    '"server.cmd ^"C:\\dir\\\\^" ^"say^ \\^"hi\\^"^""',
  ])
})
