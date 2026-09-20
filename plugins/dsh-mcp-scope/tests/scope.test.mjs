/**
 * The scope rules every stored server is validated against.
 *
 * A Windows workspace is `D:\...`, and the rule used to require a leading `/`:
 * saving any workspace scope on Windows failed with "a workspace scope must be
 * an absolute path" while the same selection saved on macOS. This pins what the
 * running platform calls absolute, and what it does not.
 *
 * Run from the repository root:
 *   node --test "plugins/dsh-mcp-scope/tests/*.test.mjs"
 *
 * @module dsh-mcp-scope/tests/scope
 */

import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { GLOBAL_SCOPE, inScope, normalizeScope } from '../src/scope.js'

/** An absolute workspace path spelled the way this platform spells one. */
const WORKSPACE = process.platform === 'win32' ? 'D:\\hzcloud-medical' : '/srv/hzcloud-medical'

/** A directory inside that workspace. */
const INSIDE = process.platform === 'win32' ? 'D:\\hzcloud-medical\\src' : '/srv/hzcloud-medical/src'

/** A sibling directory whose name merely starts with the workspace's. */
const BESIDE = process.platform === 'win32' ? 'D:\\hzcloud-medical-other' : '/srv/hzcloud-medical-other'

test('a workspace scope is accepted when the platform calls it absolute', () => {
  assert.equal(normalizeScope(WORKSPACE), resolve(WORKSPACE))
  assert.equal(normalizeScope(`  ${WORKSPACE}  `), resolve(WORKSPACE))
})

test('global is the absent, empty, and named scope', () => {
  for (const value of [undefined, null, '', 'global', ' global ']) {
    assert.equal(normalizeScope(value), GLOBAL_SCOPE)
  }
})

test('a relative path, a label, and a bare drive are refused', () => {
  for (const value of ['relative/dir', '工作区 · hzcloud-medical', 'C:', 'hzcloud-medical']) {
    assert.throws(() => normalizeScope(value), /absolute path/u, value)
  }
})

test('a session inside the workspace is in scope, one beside it is not', () => {
  assert.equal(inScope(resolve(INSIDE), WORKSPACE), true)
  assert.equal(inScope(resolve(BESIDE), WORKSPACE), false)
  assert.equal(inScope(resolve(WORKSPACE), WORKSPACE), true)
  assert.equal(inScope('', WORKSPACE), false)
})
