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

let parentSequence = 0

function nextParentId(): string {
  parentSequence += 1
  return `parent-${parentSequence}`
}

const TOKEN = '00000000-0000-4000-8000-000000000001'
const REQUEST = '00000000-0000-4000-8000-000000000002'
const ADOPTED_TOKEN = '00000000-0000-4000-8000-000000000003'

let home: string | undefined
const previousHome = process.env.DSH_HOME

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'btw-opening-'))
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

/** A parent whose first turn is still in progress: no `turn/end` at all. */
function openTurnOnlyEvents(): SessionEvent[] {
  return [
    userMessage(0, 'still working'),
    { seq: 1, time: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'grep', arguments: '{"pattern":"btw"}' } } as unknown as SessionEvent,
    { seq: 2, time: 3, type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'thinking…' } } } as unknown as SessionEvent,
  ]
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

function hostHarness(create: () => Promise<AgentHandle>, events: SessionEvent[] = seedEvents(), status: 'idle' | 'running' = 'idle') {
  const ctx = new Context()
  const parentId = nextParentId()
  const agents = { get: vi.fn(), create: vi.fn(create), resume: vi.fn(async () => { throw new Error('no persisted session') }) }
  const parent = {
    status,
    session: { events },
    ctx: { agents, tools: { get: vi.fn(() => undefined) } },
  } as unknown as Agent
  agents.get.mockImplementation(id => String(id) === parentId ? parent : undefined)
  ctx.provide('agents', agents as never)
  ctx.provide('sessions', {} as never)
  const service = new SideChatService(ctx)
  return { ctx, service, agents, parentId }
}

describe('btw Host opening admission', () => {
  const contexts: Context[] = []

  afterEach(async () => {
    await Promise.all(contexts.splice(0).map(async ctx => ctx.fiber.dispose()))
  })

  it('acknowledges start before child creation settles', async () => {
    const child = Promise.withResolvers<AgentHandle>()
    const env = hostHarness(() => child.promise)
    contexts.push(env.ctx)
    const created = childHandle()

    let settled = false
    const starting = env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })
      .then(result => {
        settled = true
        return result
      })
    // The durable index is consulted (one small fs roundtrip) before the
    // fresh fork is acknowledged; the child creation itself stays pending.
    for (let tick = 0; tick < 100 && !settled; tick += 1) {
      await new Promise(resolve => setImmediate(resolve))
    }
    const settledBeforeChild = settled

    child.resolve(created.handle)
    const result = await starting

    expect(settledBeforeChild).toBe(true)
    expect(result).toMatchObject({ ok: true, value: { chatToken: TOKEN } })
  })

  it('keeps transcript reads valid while child creation is pending', async () => {
    const child = Promise.withResolvers<AgentHandle>()
    const env = hostHarness(() => child.promise)
    contexts.push(env.ctx)
    const created = childHandle()

    await env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })
    const result = env.service.read({ chatToken: TOKEN })
    child.resolve(created.handle)

    expect(result).toMatchObject({
      ok: true,
      value: { chatToken: TOKEN, messages: [], partial: '', running: false },
    })
  })

  it('opens with an empty seed while the first parent turn is still running', async () => {
    const child = Promise.withResolvers<AgentHandle>()
    const env = hostHarness(() => child.promise, openTurnOnlyEvents(), 'running')
    contexts.push(env.ctx)
    const created = childHandle()

    const result = await env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })
    child.resolve(created.handle)
    await Promise.resolve()
    await Promise.resolve()

    expect(result).toMatchObject({ ok: true, value: { seedLength: 0, resumed: false } })
    expect(env.agents.create).toHaveBeenCalledTimes(1)
    expect(created.inject).toHaveBeenCalledTimes(2)
    const boundary = created.inject.mock.calls[0]![0] as { content: { text: string }[] }
    const digest = created.inject.mock.calls[1]![0] as { content: { text: string }[] }
    expect(boundary.content[0]!.text).toContain('Side conversation boundary')
    expect(digest.content[0]!.text).toContain('Main agent status: running')
    expect(digest.content[0]!.text).toContain('grep')
  })

  it('acknowledges a duplicate start without waiting for the same opening child', async () => {
    const child = Promise.withResolvers<AgentHandle>()
    const env = hostHarness(() => child.promise)
    contexts.push(env.ctx)
    const created = childHandle()

    await env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })
    let settled = false
    const duplicate = env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })
      .then(result => {
        settled = true
        return result
      })
    await Promise.resolve()
    const settledBeforeChild = settled

    child.resolve(created.handle)
    const result = await duplicate

    expect(settledBeforeChild).toBe(true)
    expect(result).toMatchObject({ ok: true, value: { chatToken: TOKEN } })
    expect(env.agents.create).toHaveBeenCalledTimes(1)
  })

  it('adopts a refreshed token while the existing child is still opening', async () => {
    const child = Promise.withResolvers<AgentHandle>()
    const env = hostHarness(() => child.promise)
    contexts.push(env.ctx)
    const created = childHandle()

    await env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })
    let settled = false
    const adopted = env.service.start({ parentSessionId: env.parentId, chatToken: ADOPTED_TOKEN })
      .then(result => {
        settled = true
        return result
      })
    await Promise.resolve()
    const settledBeforeChild = settled

    child.resolve(created.handle)
    const result = await adopted

    expect(settledBeforeChild).toBe(true)
    expect(result).toMatchObject({ ok: true, value: { chatToken: ADOPTED_TOKEN } })
    expect(env.service.read({ chatToken: TOKEN })).toMatchObject({ ok: false })
    expect(env.service.read({ chatToken: ADOPTED_TOKEN })).toMatchObject({ ok: true })
  })

  it('accepts a first message while opening and delivers it after the boundary', async () => {
    const child = Promise.withResolvers<AgentHandle>()
    const env = hostHarness(() => child.promise)
    contexts.push(env.ctx)
    const created = childHandle()

    await env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })
    const sent = await env.service.send({
      chatToken: TOKEN,
      requestId: REQUEST,
      text: 'Explain this.',
    })
    const openingTranscript = env.service.read({ chatToken: TOKEN })
    const deliveredBeforeChild = created.followup.mock.calls.length

    child.resolve(created.handle)
    await Promise.resolve()

    expect(sent).toMatchObject({ ok: true, value: { accepted: true } })
    expect(openingTranscript).toMatchObject({
      ok: true,
      value: {
        messages: [{ role: 'user', text: 'Explain this.' }],
        running: true,
      },
    })
    expect(deliveredBeforeChild).toBe(0)
    expect(created.followup).toHaveBeenCalledTimes(1)
    expect(created.inject.mock.invocationCallOrder[0])
      .toBeLessThan(created.followup.mock.invocationCallOrder[0]!)
  })

  it('delivers a duplicate opening request id only once', async () => {
    const child = Promise.withResolvers<AgentHandle>()
    const env = hostHarness(() => child.promise)
    contexts.push(env.ctx)
    const created = childHandle()

    await env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })
    const first = await env.service.send({ chatToken: TOKEN, requestId: REQUEST, text: 'Once.' })
    const duplicate = await env.service.send({ chatToken: TOKEN, requestId: REQUEST, text: 'Once.' })
    child.resolve(created.handle)
    await Promise.resolve()

    expect(first).toEqual(duplicate)
    expect(created.followup).toHaveBeenCalledTimes(1)
  })

  it('cancels an accepted message before the child is ready', async () => {
    const child = Promise.withResolvers<AgentHandle>()
    const env = hostHarness(() => child.promise)
    contexts.push(env.ctx)
    const created = childHandle()

    await env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })
    await env.service.send({ chatToken: TOKEN, requestId: REQUEST, text: 'Do not run this.' })
    const cancelled = await env.service.cancel({ chatToken: TOKEN })

    child.resolve(created.handle)
    await Promise.resolve()

    expect(cancelled).toMatchObject({ ok: true, value: { accepted: true } })
    expect(created.followup).not.toHaveBeenCalled()
    expect(env.service.read({ chatToken: TOKEN })).toMatchObject({
      ok: true,
      value: { messages: [{ role: 'user', text: 'Do not run this.' }], running: false },
    })
  })

  it('surfaces a background creation failure without losing the accepted message', async () => {
    const child = Promise.withResolvers<AgentHandle>()
    const env = hostHarness(() => child.promise)
    contexts.push(env.ctx)

    await env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })
    await env.service.send({ chatToken: TOKEN, requestId: REQUEST, text: 'Keep this question.' })
    child.reject(new Error('factory exploded'))
    await Promise.resolve()
    await Promise.resolve()

    expect(env.service.read({ chatToken: TOKEN })).toEqual({
      ok: false,
      error: { code: 'compatibility', message: 'factory exploded' },
    })
  })

  it('closes an opening chat without delivering its queued message', async () => {
    const child = Promise.withResolvers<AgentHandle>()
    const env = hostHarness(() => child.promise)
    contexts.push(env.ctx)
    const created = childHandle()

    await env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })
    await env.service.send({ chatToken: TOKEN, requestId: REQUEST, text: 'Never deliver.' })
    const closing = env.service.close({ chatToken: TOKEN })
    child.resolve(created.handle)
    const result = await closing
    await Promise.resolve()

    expect(result).toMatchObject({ ok: true, value: { closed: true } })
    expect(created.inject).not.toHaveBeenCalled()
    expect(created.followup).not.toHaveBeenCalled()
    expect(created.dispose).toHaveBeenCalledTimes(1)
  })
})
