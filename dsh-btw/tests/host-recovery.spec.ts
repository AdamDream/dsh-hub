import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('@deepseek-ai/dsh-subagent', () => ({
  appendDelegatedPolicyOverrides: vi.fn(),
  applyChildComposition: vi.fn(),
  childSessionMeta: vi.fn(() => ({ parentSession: 'parent' })),
  resolveChildAgentOptions: vi.fn(() => ({})),
  resolveChildDepth: vi.fn(() => 1),
}))

import { SideChatService } from '../src/host/side-chat-service.ts'

const TOKEN = '00000000-0000-4000-8000-000000000001'

let home: string | undefined
const previousHome = process.env.DSH_HOME

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'btw-recovery-'))
  process.env.DSH_HOME = home
})

afterAll(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  if (home !== undefined) await rm(home, { recursive: true, force: true })
})

function userMessage(seq: number, text: string): SessionEvent {
  return {
    seq, time: seq, type: 'user/message',
    data: { id: `m${seq}`, content: [{ type: 'text', text }], source: { kind: 'user' } },
  } as unknown as SessionEvent
}

function seedEvents(): SessionEvent[] {
  return [userMessage(0, 'hi'), { seq: 1, time: 2, type: 'turn/end', data: {} } as unknown as SessionEvent]
}

function childHandle() {
  const inject = vi.fn()
  const followup = vi.fn()
  const cancel = vi.fn()
  const dispose = vi.fn(async () => {})
  const handle = {
    agent: {
      status: 'idle',
      session: { events: [], header: {} },
      inject,
      followup,
      cancel,
    },
    dispose,
  } as unknown as AgentHandle
  return { handle, inject, followup, cancel, dispose }
}

/**
 * A parent-shaped Agent double. `ctx.agents` is the harness's shared agents
 * mock so the btw child is created through the same create mock, and
 * `ctx.tools.get` resolves nothing (read-only tool candidates stay empty).
 */
function parentAgent(id: string, events: SessionEvent[], agents: { create: ReturnType<typeof vi.fn> }, status: 'idle' | 'running' = 'idle'): Agent {
  return {
    status,
    session: { events, header: { id, cwd: '/tmp' } },
    ctx: { agents, tools: { get: vi.fn(() => undefined) } },
  } as unknown as Agent
}

interface HarnessOptions {
  records?: readonly unknown[]
  subagents?: { materializeContinuableChild?: (parent: Agent, childId: unknown, options: unknown) => Promise<Agent> }
  resume?: (resumeSessionId: unknown) => AgentHandle | Promise<AgentHandle>
}

function harness(options: HarnessOptions = {}) {
  const ctx = new Context()
  const live = new Map<string, Agent>()
  const agents = {
    get: vi.fn((id: unknown) => live.get(String(id))),
    create: vi.fn(async () => childHandle().handle),
    resume: vi.fn(async ({ resumeSessionId }: { resumeSessionId: unknown }) => {
      if (options.resume === undefined) throw new Error('no persisted session')
      return options.resume(resumeSessionId)
    }),
  }
  ctx.provide('agents', agents as never)
  ctx.provide('sessions', {} as never)
  if (options.records !== undefined) {
    ctx.provide('sessionQuery', { listSessions: vi.fn(async () => options.records) } as never)
  }
  if (options.subagents !== undefined) {
    ctx.provide('subagents', options.subagents as never)
  }
  const service = new SideChatService(ctx)
  return { ctx, service, agents, live, subagents: options.subagents }
}

describe('btw Host opening: parent recovery (P0 — existence suffices)', () => {
  const contexts: Context[] = []

  afterEach(async () => {
    await Promise.all(contexts.splice(0).map(async ctx => ctx.fiber.dispose()))
  })

  it('keeps the live-parent path untouched (no recovery consultation)', async () => {
    const env = harness()
    contexts.push(env.ctx)
    env.live.set('main', parentAgent('main', seedEvents(), env.agents))

    const result = await env.service.start({ parentSessionId: 'main', chatToken: TOKEN })

    expect(result).toMatchObject({ ok: true, value: { parentSessionId: 'main' } })
    expect(env.agents.resume).not.toHaveBeenCalled()
    expect(env.agents.create).toHaveBeenCalledTimes(1)
  })

  it('cold-resumes a persisted top-level parent through agents.resume (official precedent)', async () => {
    const env = harness({
      records: [{ header: { id: 'top', cwd: '/tmp' } }],
      resume: async () => ({ agent: parentAgent('top', seedEvents(), env.agents), dispose: vi.fn(async () => {}) } as unknown as AgentHandle),
    })
    contexts.push(env.ctx)

    const result = await env.service.start({ parentSessionId: 'top', chatToken: TOKEN })

    expect(env.agents.resume).toHaveBeenCalledTimes(1)
    expect(env.agents.resume).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: expect.anything() }))
    expect(env.agents.create).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: true, value: { parentSessionId: 'top' } })
  })

  it('materializes a persisted subagent parent through dsh-subagent (route a, no model turn)', async () => {
    const materialize = vi.fn()
    const env = harness({
      records: [{ header: { id: 'sub', cwd: '/tmp', origin: 'subagent', parentSession: 'main' } }],
      subagents: { materializeContinuableChild: materialize },
    })
    contexts.push(env.ctx)
    const main = parentAgent('main', seedEvents(), env.agents)
    const subagent = parentAgent('sub', seedEvents(), env.agents)
    env.live.set('main', main)
    materialize.mockImplementation(async (parent: Agent, childId: unknown) => {
      expect(parent).toBe(main)
      expect(String(childId)).toBe('sub')
      return subagent
    })

    const result = await env.service.start({ parentSessionId: 'sub', chatToken: TOKEN })

    expect(materialize).toHaveBeenCalledTimes(1)
    expect(env.agents.resume).not.toHaveBeenCalled()
    expect(env.agents.create).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: true, value: { parentSessionId: 'sub' } })
  })

  it('recurses up a cold subagent chain before materializing the target', async () => {
    const materialize = vi.fn()
    const env = harness({
      records: [
        { header: { id: 'mid', cwd: '/tmp', origin: 'subagent', parentSession: 'main' } },
        { header: { id: 'leaf', cwd: '/tmp', origin: 'subagent', parentSession: 'mid' } },
      ],
      subagents: { materializeContinuableChild: materialize },
    })
    contexts.push(env.ctx)
    const main = parentAgent('main', seedEvents(), env.agents)
    const mid = parentAgent('mid', seedEvents(), env.agents)
    const leaf = parentAgent('leaf', seedEvents(), env.agents)
    env.live.set('main', main)
    materialize.mockImplementation(async (_parent: Agent, childId: unknown) => (String(childId) === 'mid' ? mid : leaf))

    const result = await env.service.start({ parentSessionId: 'leaf', chatToken: TOKEN })

    expect(materialize).toHaveBeenCalledTimes(2)
    expect(materialize.mock.calls[0]![0]).toBe(main)
    expect(String(materialize.mock.calls[0]![1])).toBe('mid')
    expect(materialize.mock.calls[1]![0]).toBe(mid)
    expect(String(materialize.mock.calls[1]![1])).toBe('leaf')
    expect(result).toMatchObject({ ok: true, value: { parentSessionId: 'leaf' } })
  })

  it('fails with parent-not-found when the parent session does not exist', async () => {
    const env = harness({ records: [{ header: { id: 'other', cwd: '/tmp' } }] })
    contexts.push(env.ctx)

    const result = await env.service.start({ parentSessionId: 'ghost', chatToken: TOKEN })

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'parent-not-found', message: 'The parent conversation does not exist.' },
    })
    expect(env.agents.resume).not.toHaveBeenCalled()
  })

  it('reports when the dsh-subagent materialize runtime patch is absent', async () => {
    const env = harness({
      records: [{ header: { id: 'sub', cwd: '/tmp', origin: 'subagent', parentSession: 'main' } }],
      subagents: {},
    })
    contexts.push(env.ctx)
    env.live.set('main', parentAgent('main', seedEvents(), env.agents))

    const result = await env.service.start({ parentSessionId: 'sub', chatToken: TOKEN })

    expect(result).toMatchObject({ ok: false, error: { code: 'parent-not-found' } })
    if (result.ok) throw new Error('expected the open to fail')
    expect(result.error.message).toContain('materializeContinuableChild')
  })

  it('reports a recovery failure for an existing parent whose resume throws', async () => {
    const env = harness({
      records: [{ header: { id: 'top', cwd: '/tmp' } }],
      resume: async () => { throw new Error('persistence backend unavailable') },
    })
    contexts.push(env.ctx)

    const result = await env.service.start({ parentSessionId: 'top', chatToken: TOKEN })

    expect(result).toMatchObject({ ok: false, error: { code: 'parent-not-found' } })
    if (result.ok) throw new Error('expected the open to fail')
    expect(result.error.message).toContain('could not be recovered')
    expect(env.agents.create).not.toHaveBeenCalled()
  })
})
