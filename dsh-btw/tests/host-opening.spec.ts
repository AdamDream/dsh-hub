import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { resolveChildAgentOptions } from '@deepseek-ai/dsh-subagent'
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

import { SideChatService, sanitizeBtwModel } from '../src/host/side-chat-service.ts'

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

function hostHarness(
  create: () => Promise<AgentHandle>,
  events: SessionEvent[] = seedEvents(),
  status: 'idle' | 'running' = 'idle',
  settingsSection?: { current: unknown },
) {
  const ctx = new Context()
  const parentId = nextParentId()
  let runSetup: ((childCtx: unknown) => void) | undefined
  const agents = {
    get: vi.fn(),
    create: vi.fn((options: { setup?: (childCtx: unknown) => void }) => {
      runSetup = options.setup
      return create()
    }),
    resume: vi.fn(async () => { throw new Error('no persisted session') }),
  }
  const parent = {
    status,
    session: { events },
    ctx: { agents, tools: { get: vi.fn(() => undefined) } },
  } as unknown as Agent
  agents.get.mockImplementation(() => parent)
  ctx.provide('agents', agents as never)
  ctx.provide('sessions', {} as never)
  // `dsh-btw` namespace stub; `settingsSection` (when given) is read by value
  // on every call, so mutating it simulates a settings.yaml hot edit.
  const settings = {
    get: vi.fn((namespace: string) => (namespace === 'dsh-btw' ? settingsSection?.current : undefined)),
  }
  ctx.provide('settings', settings as never)
  const service = new SideChatService(ctx)
  return {
    ctx, service, agents, parentId, settings,
    // The real `agents.create` runs `setup(childCtx)` (composeChild) before the
    // handle resolves; the harness replays it so `entry.modelSelection`
    // installs like production (reads the persisted request header).
    runSetup: (childCtx: unknown) => { runSetup?.(childCtx) },
  }
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
    //
    // Bound the wait by wall-clock, not by a fixed number of event-loop turns:
    // an event-loop turn carries no time, so on a loaded machine (concurrent
    // agents/subagents competing for the loop) the fs roundtrip can outlive 100
    // `setImmediate` ticks and fail the assertion spuriously — observed once at
    // 2026-09-17 17:54 under concurrent load, while 3/3 full-suite re-runs and
    // 10/10 isolated runs passed. `child` stays pending throughout, so the
    // assertion keeps its original meaning.
    const settleDeadline = Date.now() + 10_000
    while (!settled && Date.now() < settleDeadline) {
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

  it('defaults the side-chat model to deepseek-v4.1-flash without crashing', async () => {
    const child = Promise.withResolvers<AgentHandle>()
    const env = hostHarness(() => child.promise)
    contexts.push(env.ctx)
    const created = childHandle()

    const result = await env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })
    const read = env.service.read({ chatToken: TOKEN })
    child.resolve(created.handle)
    await Promise.resolve()

    // The default routes to adam/deepseek-v4.1-flash on start and on read;
    // no model selection installed yet degrades to the same default.
    expect(result).toMatchObject({ ok: true, value: { model: 'deepseek-v4.1-flash' } })
    expect(read).toMatchObject({ ok: true, value: { model: 'deepseek-v4.1-flash' } })
    expect(resolveChildAgentOptions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ provider: 'adam', model: 'deepseek-v4.1-flash' }),
      expect.anything(),
    )
  })

  it('resumes a persisted legacy deepseek-v4-flash header on deepseek-v4.1-flash (no white-screen)', async () => {
    const child = Promise.withResolvers<AgentHandle>()
    const env = hostHarness(() => child.promise)
    contexts.push(env.ctx)
    const created = childHandle()
    // Simulate a conversation persisted before the switch: the child session
    // request header carries the legacy model id, read by
    // `installBtwModelSelection` on every resume.
    ;(created.handle.agent.session as { requestHeader?: () => unknown }).requestHeader = () => ({
      config: { provider: 'adam', model: 'deepseek-v4-flash' },
    })

    const result = await env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })
    env.runSetup({ agent: created.handle.agent, on: vi.fn(), tools: { guard: vi.fn(), register: vi.fn() } })
    child.resolve(created.handle)
    await Promise.resolve()
    await Promise.resolve()

    // The legacy id never reaches the wire: it is mapped onto the replacement,
    // so strict client-side schema validation cannot reject the read.
    const read = env.service.read({ chatToken: TOKEN })
    expect(result).toMatchObject({ ok: true, value: { model: 'deepseek-v4.1-flash' } })
    expect(read).toMatchObject({ ok: true, value: { model: 'deepseek-v4.1-flash' } })
  })

  it('hot-reads the settings default model between starts (no restart)', async () => {
    const section: { current: unknown } = { current: { model: { default: 'glm-5.3' } } }
    const child = Promise.withResolvers<AgentHandle>()
    const env = hostHarness(() => child.promise, seedEvents(), 'idle', section)
    contexts.push(env.ctx)
    const created = childHandle()

    const first = await env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })
    expect(first).toMatchObject({ ok: true, value: { model: 'glm-5.3' } })
    expect(resolveChildAgentOptions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ provider: 'adam', model: 'glm-5.3' }),
      expect.anything(),
    )

    // Simulate editing `~/.dsh/settings.yaml` `dsh-btw.model.default` and
    // saving: the host re-reads the namespace per call, so the next start
    // picks up the new default in the same process — no restart.
    section.current = { model: { default: 'deepseek-v4-pro' } }
    const second = await env.service.start({ parentSessionId: nextParentId(), chatToken: ADOPTED_TOKEN })
    expect(second).toMatchObject({ ok: true, value: { model: 'deepseek-v4-pro' } })

    // Clearing the section falls back to the constant default.
    section.current = {}
    const third = await env.service.start({ parentSessionId: nextParentId(), chatToken: REQUEST })
    expect(third).toMatchObject({ ok: true, value: { model: 'deepseek-v4.1-flash' } })
    child.resolve(created.handle)
    await Promise.resolve()
    await Promise.resolve()
    expect(env.settings.get).toHaveBeenCalledWith('dsh-btw')
  })

  it('normalizes a setModel pick against the settings routable options', async () => {
    const section: { current: unknown } = { current: { model: { options: ['deepseek-v4.1-flash'] } } }
    const child = Promise.withResolvers<AgentHandle>()
    const env = hostHarness(() => child.promise, seedEvents(), 'idle', section)
    contexts.push(env.ctx)
    const created = childHandle()

    await env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })
    env.runSetup({ agent: created.handle.agent, on: vi.fn(), tools: { guard: vi.fn(), register: vi.fn() } })
    child.resolve(created.handle)
    await Promise.resolve()
    await Promise.resolve()

    // glm-5.3 was routed out of the list via settings: the pick degrades to
    // the default instead of routing off-list.
    const set = await env.service.setModel({ chatToken: TOKEN, model: 'glm-5.3' })
    expect(set).toMatchObject({ ok: true, value: { accepted: true } })
    expect(env.service.read({ chatToken: TOKEN })).toMatchObject({
      ok: true,
      value: { model: 'deepseek-v4.1-flash' },
    })
  })
})

describe('btw model resolution (v4-flash → v4.1-flash replacement)', () => {
  it('maps the persisted legacy id onto its replacement', () => {
    // A conversation persisted with `deepseek-v4-flash` before the switch
    // resumes on the replacement model — the schema itself never sees the
    // legacy id, so strict client validation cannot be tripped.
    expect(sanitizeBtwModel('deepseek-v4-flash')).toBe('deepseek-v4.1-flash')
  })

  it('passes current enum values through untouched', () => {
    expect(sanitizeBtwModel('deepseek-v4.1-flash')).toBe('deepseek-v4.1-flash')
    expect(sanitizeBtwModel('glm-5.3')).toBe('glm-5.3')
    expect(sanitizeBtwModel('deepseek-v4-pro')).toBe('deepseek-v4-pro')
  })

  it('degrades undefined and unknown values to the default', () => {
    expect(sanitizeBtwModel(undefined)).toBe('deepseek-v4.1-flash')
    expect(sanitizeBtwModel('garbage-model')).toBe('deepseek-v4.1-flash')
  })

  it('honors a settings-provided routable set (options 热读)', () => {
    const routable = ['deepseek-v4.1-flash', 'glm-5.3']
    expect(sanitizeBtwModel('glm-5.3', routable)).toBe('glm-5.3')
    expect(sanitizeBtwModel('deepseek-v4-pro', routable)).toBe('deepseek-v4.1-flash')
    expect(sanitizeBtwModel('deepseek-v4.1-flash', ['deepseek-v4.1-flash'])).toBe('deepseek-v4.1-flash')
    // The legacy id maps onto its replacement even when listed in options.
    expect(sanitizeBtwModel('deepseek-v4-flash', ['deepseek-v4-flash', 'glm-5.3'])).toBe('deepseek-v4.1-flash')
  })
})
