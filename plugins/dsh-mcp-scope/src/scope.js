/**
 * Scope rules shared by the host half and its tests.
 *
 * A scope is `'global'` or the absolute path of one workspace. "Absolute" is
 * whatever the running platform calls absolute — `node:path.isAbsolute` —
 * because a Windows workspace is `D:\...`, and a rule spelled for POSIX paths
 * rejected every one of them with "a workspace scope must be an absolute path".
 *
 * @module dsh-mcp-scope/scope
 */

import { realpathSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'

/** The one scope value meaning "every workspace". */
export const GLOBAL_SCOPE = 'global'

/**
 * Canonicalize a directory path so scope comparison survives symlinks.
 * @param path - candidate path.
 * @returns the realpath when it exists, otherwise the resolved path.
 */
export function canonical(path) {
  const resolved = resolve(path)
  try {
    return realpathSync(resolved)
  } catch {
    // A workspace directory can be deleted while its record survives; the
    // resolved spelling is then the best identity available.
    return resolved
  }
}

/**
 * Whether a session cwd falls inside a workspace scope.
 * @param cwd - canonical session cwd, or '' when the header carries none.
 * @param scope - absolute workspace path.
 * @returns true when the session runs in that workspace or below it.
 */
export function inScope(cwd, scope) {
  if (cwd === '') return false
  const target = canonical(scope)
  return cwd === target || cwd.startsWith(target.endsWith(sep) ? target : target + sep)
}

/**
 * Normalize one scope value.
 * @param value - 'global' or an absolute directory path.
 * @returns the normalized scope.
 */
export function normalizeScope(value) {
  if (value === undefined || value === null || value === '' || value === GLOBAL_SCOPE) return GLOBAL_SCOPE
  const text = String(value).trim()
  if (text === GLOBAL_SCOPE) return GLOBAL_SCOPE
  if (!isAbsolute(text)) throw new Error('a workspace scope must be an absolute path')
  return resolve(text)
}
