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

let home: string | undefined
const previousHome = process.env.DSH_HOME

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'btw-lease-'))
  process.env.DSH_HOME = home
})

afterAll(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  if (home !== undefined) await rm(home, { recursive: true, force: true })
})

function seedEvents(): SessionEvent[] {
  return [
    {
      seq: 0, time: 1, type: 'user/message',
      data: { id: 'm0', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } },
    },
    { seq: 1, time: 2, type: 'turn/end', data: {} },
  ] as unknown as SessionEvent[]
}

function childHandle() {
  const handle = {
    agent: {
      status: 'idle',
      session: { events: [], header: {} },
      inject: vi.fn(),
      followup: vi.fn(),
      cancel: vi.fn(),
    },
    dispose: vi.fn(async () => {}),
  } as unknown as AgentHandle
  return handle
}

function hostHarness() {
  const ctx = new Context()
  const parentId = nextParentId()
  const agents = {
    get: vi.fn(),
    create: vi.fn(async () => childHandle()),
    resume: vi.fn(async () => { throw new Error('no persisted session') }),
  }
  const parent = {
    status: 'idle',
    session: { events: seedEvents() },
    ctx: { agents, tools: { get: vi.fn(() => undefined) } },
  } as unknown as Agent
  agents.get.mockImplementation(id => String(id) === parentId ? parent : undefined)
  ctx.provide('agents', agents as never)
  ctx.provide('sessions', {} as never)
  const service = new SideChatService(ctx)
  return { ctx, service, agents, parentId }
}

describe('btw host idle policy (no lease, no expiry)', () => {
  const contexts: Context[] = []

  afterEach(async () => {
    await Promise.all(contexts.splice(0).map(async ctx => ctx.fiber.dispose()))
  })

  it('keeps an idle conversation readable after far more than the old 30-minute lease', async () => {
    vi.useFakeTimers()
    const env = hostHarness()
    contexts.push(env.ctx)
    const started = await env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })
    expect(started).toMatchObject({ ok: true })

    await vi.advanceTimersByTimeAsync(31 * 60 * 1_000)
    const read = env.service.read({ chatToken: TOKEN })
    expect(read).toMatchObject({ ok: true, value: { chatToken: TOKEN, running: false } })
    vi.useRealTimers()
  })

  it('reports no expiry fields and no cleanup mode on the start value', async () => {
    const env = hostHarness()
    contexts.push(env.ctx)
    const started = await env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(started.value).not.toHaveProperty('expiresAt')
    expect(started.value).not.toHaveProperty('cleanupMode')
  })

  it('stays open while the parent keeps running and after both go idle', async () => {
    vi.useFakeTimers()
    const env = hostHarness()
    contexts.push(env.ctx)
    await env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })
    await vi.advanceTimersByTimeAsync(60 * 60 * 1_000)
    expect(env.service.read({ chatToken: TOKEN })).toMatchObject({ ok: true })
    vi.useRealTimers()
  })
})
