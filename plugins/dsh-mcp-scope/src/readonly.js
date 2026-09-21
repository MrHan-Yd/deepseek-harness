/**
 * The read-only tool policy shared by the mount runtime and its tests.
 *
 * An MCP server is external code someone else configured, so its tool set is
 * unknown at mount time and can change under a pinned server name. The policy
 * therefore cannot be a list of the tools this deployment happens to know: it
 * has to decide from the tool's own name, and it has to deny when the name
 * proves nothing. A tool is read-only only when its name carries a read verb
 * and carries no write verb.
 *
 * Measured against the servers in use: `query`, `mysql_query`, `get`, `list`,
 * `find`, `aggregate`, `count`, `explain`, `db-stats`, `collection-schema`,
 * `collection-indexes`, and `list-collections` pass; `set`, `delete`,
 * `insert-many`, `update-many`, `drop-collection`, `drop-database`,
 * `create-index`, and `rename-collection` do not.
 *
 * The vocabulary is a security invariant, not a per-deployment tunable. A read
 * verb is admitted only when it reads state and cannot persist it; `dump` and
 * `export` are absent because they write a file, and `aggregate` is present
 * because its own server refuses the persisting `$out`/`$merge` stages when
 * that server runs read-only.
 *
 * @module dsh-mcp-scope/readonly
 */

/**
 * Verbs whose presence marks a tool as reading state.
 *
 * `inspect`/`view`/`head`/`lookup` are here because a database server may name
 * a projection that way; every one of them reads and returns, never persists.
 */
const READ_VERBS = new Set([
  'get', 'list', 'find', 'count', 'read', 'query', 'describe', 'show', 'search',
  'explain', 'aggregate', 'stats', 'schema', 'indexes', 'info', 'ping', 'exists',
  'scan', 'keys', 'select', 'inspect', 'view', 'lookup', 'head',
])

/**
 * Verbs whose presence marks a tool as able to change state.
 *
 * Any one of them withdraws read-only status even beside a read verb, so a
 * compound name such as `get-or-create` is denied. `execute`, `call`, and
 * `run` are here because an unconstrained statement runner is a write path the
 * name alone cannot bound.
 */
const WRITE_VERBS = new Set([
  'insert', 'update', 'delete', 'remove', 'drop', 'create', 'rename', 'set',
  'unset', 'put', 'post', 'patch', 'write', 'add', 'append', 'push', 'pull',
  'replace', 'upsert', 'bulk', 'flush', 'truncate', 'alter', 'grant', 'revoke',
  'kill', 'shutdown', 'eval', 'execute', 'exec', 'run', 'apply', 'mutate',
  'modify', 'commit', 'rollback', 'migrate', 'import', 'restore', 'upload',
  'download', 'save', 'store', 'clear', 'purge', 'reset', 'start', 'stop',
  'restart', 'enable', 'disable', 'install', 'uninstall', 'deploy', 'teardown',
  'pause', 'resume', 'upgrade', 'sync', 'copy', 'move', 'transfer', 'send',
  'publish', 'trigger', 'invoke', 'cancel', 'abort', 'terminate', 'begin',
  'transaction', 'switch',
])

/**
 * Split a tool name into the words its author joined.
 *
 * MCP tool names are `snake_case`, `kebab-case`, or `camelCase` by convention,
 * and the split covers all three so `insertMany` and `insert_many` classify
 * alike.
 *
 * @param rawName - the server's own tool name.
 * @returns the lowercased words, empty when the name holds none.
 */
function wordsOf(rawName) {
  return String(rawName)
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(word => word !== '')
}

/**
 * Recover one server-owned MCP tool name from its model-facing public name.
 *
 * `@deepseek-ai/dsh-mcp-client` publishes `mcp__<serverName>__<rawName>` and
 * the server name cannot itself contain `__`, so the first separator after the
 * prefix ends the server name. A name that does not follow that contract — a
 * foreign tool that merely starts with `mcp__` — yields null rather than a
 * guessed owner.
 *
 * @param publicName - the model-facing tool name.
 * @returns the owner and raw name, or null when the name is not an MCP tool.
 */
export function mcpToolIdentity(publicName) {
  if (typeof publicName !== 'string' || !publicName.startsWith('mcp__')) return null
  const rest = publicName.slice('mcp__'.length)
  const at = rest.indexOf('__')
  if (at <= 0) return null
  const serverName = rest.slice(0, at)
  const rawName = rest.slice(at + 2)
  if (rawName === '') return null
  return { serverName, rawName }
}

/**
 * Whether one server-declared tool name proves a read.
 *
 * @param rawName - the server's own tool name.
 * @returns true only when a read verb is present and no write verb is.
 */
export function isReadOnlyToolName(rawName) {
  const words = wordsOf(rawName)
  if (words.length === 0) return false
  if (words.some(word => WRITE_VERBS.has(word))) return false
  return words.some(word => READ_VERBS.has(word))
}

/**
 * Whether one model-facing MCP tool name proves a read.
 *
 * A name outside the `mcp__<server>__<tool>` contract is not this policy's
 * subject and reports false, so a caller sweeping an MCP namespace withholds
 * what it cannot read rather than admitting it.
 *
 * @param publicName - the model-facing tool name.
 * @returns true only when the tool is a proven read.
 */
export function isReadOnlyTool(publicName) {
  const identity = mcpToolIdentity(publicName)
  return identity !== null && isReadOnlyToolName(identity.rawName)
}

/** Both vocabularies, for diagnostics and tests. */
export const READ_ONLY_VOCABULARY = { read: READ_VERBS, write: WRITE_VERBS }
