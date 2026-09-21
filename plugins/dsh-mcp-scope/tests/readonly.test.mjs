/**
 * The read-only tool policy's own decisions.
 *
 * The policy is the whole safety story for an MCP server this deployment did
 * not write, so every case here is one a person would ask about: the names the
 * configured servers actually publish, and the shapes a name can take when the
 * probe is wrong.
 *
 * Run from the repository root:
 *   node --test plugins/dsh-mcp-scope/tests/readonly.test.mjs
 *
 * @module dsh-mcp-scope/tests/readonly
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isReadOnlyTool, isReadOnlyToolName, mcpToolIdentity } from '../src/readonly.js'

describe('isReadOnlyToolName over the configured servers', () => {
  it('admits every read tool the four server kinds publish', () => {
    const reads = [
      'query',                // @modelcontextprotocol/server-postgres
      'mysql_query',          // mcp-server-mysql
      'get', 'list',          // @gongrzhe/server-redis-mcp
      'find', 'aggregate', 'aggregate-db', 'count', 'explain', 'db-stats',
      'list-collections', 'list-databases', 'collection-schema',
      'collection-indexes', 'search-knowledge', 'list-knowledge-sources',
    ]
    for (const name of reads) assert.equal(isReadOnlyToolName(name), true, `${name} is a read`)
  })

  it('withholds every write tool the four server kinds publish', () => {
    const writes = [
      'set', 'delete',                     // redis
      'insert-many', 'update-many', 'delete-many', 'drop-collection',
      'drop-database', 'create-collection', 'create-index', 'drop-index',
      'rename-collection', 'switch-connection',
      'atlas-local-create-deployment', 'atlas-local-delete-deployment',
    ]
    for (const name of writes) assert.equal(isReadOnlyToolName(name), false, `${name} is a write`)
  })

  it('withholds a name that only writes a file', () => {
    // `export` reads the database and writes a path the model chose, so it is
    // not a query tool however the server classifies it.
    assert.equal(isReadOnlyToolName('export'), false)
  })
})

describe('isReadOnlyToolName over unknown servers', () => {
  it('denies a name that proves nothing', () => {
    for (const name of ['sql', 'sqlite', 'jdbc', 'mongo', 'tool', 'x']) {
      assert.equal(isReadOnlyToolName(name), false, `${name} proves nothing`)
    }
  })

  it('denies a compound name that carries any write verb beside a read', () => {
    for (const name of ['get-or-create', 'list-and-delete', 'read_then_write', 'findAndModify']) {
      assert.equal(isReadOnlyToolName(name), false, `${name} can write`)
    }
  })

  it('admits a read verb in any of the three naming styles', () => {
    for (const name of ['get_user', 'get-user', 'getUser', 'GET_USER']) {
      assert.equal(isReadOnlyToolName(name), true, `${name} is a read`)
    }
  })

  it('denies an unconstrained statement runner', () => {
    for (const name of ['execute_sql', 'run_query', 'eval', 'call']) {
      assert.equal(isReadOnlyToolName(name), false, `${name} is not bounded by its name`)
    }
  })

  it('denies an empty or non-string name', () => {
    for (const name of ['', '___', undefined, null, 7]) {
      assert.equal(isReadOnlyToolName(name), false, `${String(name)} is not a tool name`)
    }
  })
})

describe('mcpToolIdentity', () => {
  it('splits the model-facing name into its owner and the server’s own name', () => {
    assert.deepEqual(mcpToolIdentity('mcp__pgsql_9_nbtp_pro__query'), {
      serverName: 'pgsql_9_nbtp_pro',
      rawName: 'query',
    })
  })

  it('reads the first separator as the owner boundary', () => {
    // The server name cannot contain `__`, so a raw name may: the split must
    // not take the last separator and invent a different owner.
    assert.deepEqual(mcpToolIdentity('mcp__demo__find__one'), {
      serverName: 'demo',
      rawName: 'find__one',
    })
  })

  it('refuses a name outside the contract', () => {
    for (const name of ['mcp_probe', 'mcp__demo', 'mcp__', 'read', '', undefined]) {
      assert.equal(mcpToolIdentity(name), null, `${String(name)} is not an MCP tool name`)
    }
  })
})

describe('isReadOnlyTool', () => {
  it('judges the model-facing name through its owner', () => {
    assert.equal(isReadOnlyTool('mcp__demo__find'), true)
    assert.equal(isReadOnlyTool('mcp__demo__insert-many'), false)
    // A read-shaped raw name owned by a foreign prefix still has to parse as an
    // MCP tool before the policy speaks about it.
    assert.equal(isReadOnlyTool('mcp_probe'), false)
  })
})
