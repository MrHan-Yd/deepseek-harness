/**
 * The summary blank bit means "no transcript row yet", not "log empty": a
 * Session stays blank until it commits a turn, or an executed command's own
 * lifecycle rows. Standalone plugin events that render no conversation row —
 * plan/mode, permission knob events, session titles — never flip it, so
 * /permission or a title write on a fresh Session keeps it list-hidden and
 * reusable as the workspace's new-Session target.
 *
 * A command run is content because its rows render in the transcript. A Session
 * whose only row is `/name args → result` is not empty to the person reading it,
 * and keeping it blank leaves a client on the empty-Session hero, which covers
 * the command's entire outcome; a Session whose first action was a command
 * therefore stops being reusable as the blank new-Session target. The
 * host/session-added frame shares the same predicate function (covered by the
 * workspace spec's frame assertion).
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { CommandId } from '@deepseek-ai/dsh-commands/brand'
// Side-effect type imports: the configuration-event SessionEventMap merges.
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { createSessionTestRemote, type TestSessionRemote } from './test-remote.ts'

async function harness(): Promise<{ ctx: Context; remote: TestSessionRemote; attach: (session: Session) => Promise<void> }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  return {
    ctx,
    remote: createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' }),
    attach: async (session) => {
      await ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
    },
  }
}

/** Append the standalone events that render no conversation row. */
function appendNonTranscript(session: Session): void {
  session.append('plan/mode', { active: true })
  session.append('session/title', {
    title: 'standalone title', messageSeqs: [], source: { kind: 'fallback' },
  })
  // Permission configuration events from a /permission switch on a fresh session.
  session.append('permission/preset', { preset: 'danger-full-access' })
  session.append('sandbox/mode', { mode: 'danger-full-access' })
}

/** Append one executed command's lifecycle rows: the transcript content under test. */
function appendCommand(session: Session): void {
  session.append('command/run', {
    commandId: CommandId('blank-cmd-1'), name: 'plan', args: '', source: { kind: 'user' },
  })
  session.append('command/done', { commandId: CommandId('blank-cmd-1'), kind: 'success', text: 'Plan mode on.' })
}

async function listBlank(remote: TestSessionRemote, id: string): Promise<boolean | undefined> {
  const result = await remote.list({})
  if (!result.ok) throw new Error('list failed')
  return result.value.items.find(item => item.sessionId === id)?.blank
}

describe('summary blank = no transcript row', () => {
  it('rowless standalone events (plan/mode, title, permission knobs) keep the session blank', async () => {
    const { ctx, remote, attach } = await harness()
    const session = ctx.sessions.create()
    await attach(session)
    expect(await listBlank(remote, session.id)).toBe(true)
    appendNonTranscript(session)
    expect(await listBlank(remote, session.id)).toBe(true)
  })

  it('an executed command clears blank', async () => {
    const { ctx, remote, attach } = await harness()
    const session = ctx.sessions.create()
    await attach(session)
    appendNonTranscript(session)
    appendCommand(session)
    expect(await listBlank(remote, session.id)).toBe(false)
  })

  it('the first turn clears blank', async () => {
    const { ctx, remote, attach } = await harness()
    const session = ctx.sessions.create()
    await attach(session)
    appendNonTranscript(session)
    session.append('turn/start', { turn: 0 })
    expect(await listBlank(remote, session.id)).toBe(false)
  })
})
