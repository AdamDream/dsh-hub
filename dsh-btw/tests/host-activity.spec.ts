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
  home = await mkdtemp(join(tmpdir(), 'btw-activity-'))
  process.env.DSH_HOME = home
})

afterAll(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  if (home !== undefined) await rm(home, { recursive: true, force: true })
})

let parentSequence = 0

function nextParentId(): string {
  parentSequence += 1
  return `parent-${parentSequence}`
}

function childHandle(events: SessionEvent[], status: 'idle' | 'running'): AgentHandle {
  return {
    agent: {
      status,
      session: { events, header: {} },
      inject: vi.fn(),
      followup: vi.fn(),
      cancel: vi.fn(),
    },
    dispose: vi.fn(async () => {}),
  } as unknown as AgentHandle
}

function hostHarness(handle: AgentHandle, parentEvents: SessionEvent[] = []) {
  const ctx = new Context()
  const parentId = nextParentId()
  const agents = {
    get: vi.fn(),
    create: vi.fn(async () => handle),
    resume: vi.fn(async () => { throw new Error('no persisted session') }),
  }
  const parent = {
    status: 'idle',
    session: { events: parentEvents },
    ctx: { agents, tools: { get: vi.fn(() => undefined) } },
  } as unknown as Agent
  agents.get.mockImplementation(id => String(id) === parentId ? parent : undefined)
  ctx.provide('agents', agents as never)
  ctx.provide('sessions', {} as never)
  const service = new SideChatService(ctx)
  return { ctx, service, parentId }
}

/** Open a fresh child and let the creation settle so `entry.handle` is live. */
async function opened(contexts: Context[], handle: AgentHandle): Promise<SideChatService> {
  const env = hostHarness(handle)
  contexts.push(env.ctx)
  await env.service.start({ parentSessionId: env.parentId, chatToken: TOKEN })
  await Promise.resolve()
  await Promise.resolve()
  return env.service
}

function stepStart(turn: number, step: number): SessionEvent {
  return { seq: 0, time: 1, type: 'step/start', data: { turn, step } } as unknown as SessionEvent
}

function assistantMessage(seq: number, id: string, text: string, turn: number, step: number): SessionEvent {
  return {
    seq, time: seq, type: 'assistant/message',
    data: { turn, step, message: { id, content: [{ type: 'text', text }] } },
  } as unknown as SessionEvent
}

function toolCall(seq: number, callId: string, name: string, args: string, turn: number, step: number): SessionEvent {
  return {
    seq, time: seq, type: 'tool/call',
    data: { turn, step, callId, name, arguments: args },
  } as unknown as SessionEvent
}

function toolResult(seq: number, callId: string, text: string, isError: boolean, turn: number, step: number): SessionEvent {
  return {
    seq, time: seq, type: 'tool/result',
    data: {
      turn, step,
      message: { id: `tr-${callId}`, role: 'user', content: [{
        type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text }], isError,
      }] },
    },
  } as unknown as SessionEvent
}

const RUNNING_TOOL_TURN: SessionEvent[] = [
  stepStart(1, 0),
  assistantMessage(1, 'a1', 'Checking…', 1, 0),
  toolCall(2, 'c1', 'read', '{"path":"a.ts"}', 1, 1),
  toolResult(3, 'c1', 'file body', false, 1, 1),
  toolCall(4, 'c2', 'search', '{"q":"btw"}', 1, 2),
]

describe('btw host transcript tool digests and running activity', () => {
  const contexts: Context[] = []

  afterEach(async () => {
    await Promise.all(contexts.splice(0).map(async ctx => ctx.fiber.dispose()))
  })

  it('projects settled and in-flight tool digests onto the preceding assistant message', async () => {
    const service = await opened(contexts, childHandle(RUNNING_TOOL_TURN, 'running'))
    const result = service.read({ chatToken: TOKEN })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.running).toBe(true)
    // The in-flight (unsettled) call is the current action, not the last name.
    expect(result.value.runningTool).toBe('search')
    expect(result.value.currentAction).toEqual({ kind: 'tool', tool: 'search', turn: 1, step: 2 })
    expect(result.value.messages).toHaveLength(1)
    const tools = result.value.messages[0]?.tools
    expect(tools).toHaveLength(2)
    expect(tools?.[0]).toEqual({ callId: 'c1', name: 'read', args: '{"path":"a.ts"}', result: 'file body', isError: false })
    expect(tools?.[1]).toEqual({ callId: 'c2', name: 'search', args: '{"q":"btw"}', running: true })
  })

  it('reports generating while the LLM streams after the last tool settles', async () => {
    const events: SessionEvent[] = [
      ...RUNNING_TOOL_TURN.slice(0, 4),
      stepStart(1, 3),
      assistantMessage(5, 'a2', 'Found it.', 1, 3),
    ]
    const service = await opened(contexts, childHandle(events, 'running'))
    const result = service.read({ chatToken: TOKEN })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.runningTool).toBeUndefined()
    expect(result.value.currentAction).toEqual({ kind: 'generating', turn: 1, step: 3 })
  })

  it('drops the banner data and the running flag once the child goes idle', async () => {
    const service = await opened(contexts, childHandle(RUNNING_TOOL_TURN, 'idle'))
    const result = service.read({ chatToken: TOKEN })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.running).toBe(false)
    expect(result.value.currentAction).toBeUndefined()
    expect(result.value.runningTool).toBeUndefined()
    // The unresolved call degrades to a settled (stopped-looking) row.
    expect(result.value.messages[0]?.tools?.[1]).toEqual({ callId: 'c2', name: 'search', args: '{"q":"btw"}' })
  })

  it('flags an errored tool result', async () => {
    const events: SessionEvent[] = [
      stepStart(1, 0),
      assistantMessage(1, 'a1', 'Trying…', 1, 0),
      toolCall(2, 'c1', 'read', '{}', 1, 1),
      toolResult(3, 'c1', 'no such file', true, 1, 1),
    ]
    const service = await opened(contexts, childHandle(events, 'idle'))
    const result = service.read({ chatToken: TOKEN })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.messages[0]?.tools?.[0]).toEqual({
      callId: 'c1', name: 'read', args: '{}', result: 'no such file', isError: true,
    })
  })

  it('keeps tool events before any visible assistant message attached to the next one', async () => {
    const events: SessionEvent[] = [
      toolCall(0, 'c1', 'read', '{"path":"a.ts"}', 1, 1),
      toolResult(1, 'c1', 'file body', false, 1, 1),
      assistantMessage(2, 'a1', 'Read it.', 1, 2),
    ]
    const service = await opened(contexts, childHandle(events, 'idle'))
    const result = service.read({ chatToken: TOKEN })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.messages).toHaveLength(1)
    expect(result.value.messages[0]?.tools).toHaveLength(1)
    expect(result.value.messages[0]?.tools?.[0]).toMatchObject({ callId: 'c1', name: 'read' })
  })
})
